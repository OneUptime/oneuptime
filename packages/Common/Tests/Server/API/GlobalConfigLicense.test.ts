import GlobalConfigAPI, {
  LICENSE_RESPONSE_CONFIG_SELECT,
} from "../../../Server/API/GlobalConfigAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import Response from "../../../Server/Utils/Response";
import { AppVersion } from "../../../Server/EnvironmentConfig";
import EnterpriseEdition from "../../../Server/Enterprise/EnterpriseEdition";
import EnterpriseFeature from "../../../Server/Enterprise/EnterpriseFeature";
import {
  EnterpriseLicenseSnapshot,
  EnterpriseLicenseStatus,
  SeatUsage,
} from "../../../Server/Enterprise/EnterpriseLicenseSnapshot";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import FakeEnterpriseModule, {
  createLicenseSnapshot,
  createLicenseSnapshotWithStatus,
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "../Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * GET /global-config/license: the one license route that stays in core.
 *
 * Activating and refreshing a license moved into the Enterprise license client
 * (ee/Server/License, tested in ee/Tests/Server/License). What stays here is
 * the read, because the Community Edition still needs the version and
 * update-check half of the edition dialog, and because the answer has to be
 * cut down per caller:
 *
 *   - this route serves the signed-out login page, so it cannot require
 *     authentication, and anonymous callers used to be told the seat limit,
 *     the current user count and more;
 *   - any signed-in user - including a status-page subscriber, whose token
 *     also decodes to a userId - used to receive the license key, the token
 *     and the host of every instance on the license.
 *
 * Now a master admin gets everything and everybody else gets only what the
 * edition pill shows.
 */

jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/VerificationCode", () => {
  return {
    __esModule: true,
    default: {
      generate: jest.fn(),
      hashCode: jest.fn(),
      isHashEqual: jest.fn(),
      generateUnusableHash: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

// CI's config.env sets BILLING_ENABLED=true; this suite pins it per test.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

const LICENSE_ROUTE: string = "/global-config/license";
const REFRESH_ROUTE: string = "/global-config/license/refresh";

const STORED_LICENSE_KEY: string = "acme-stored-license-key";
const STORED_TOKEN: string = "stored.license.token";
const INSTANCE_ID: ObjectID = ObjectID.generate();
const DAY_IN_MS: number = 24 * 60 * 60 * 1000;

// Exactly what anybody but a master admin may learn.
const PUBLIC_KEYS: Array<string> = [
  "companyName",
  "edition",
  "expiresAt",
  "features",
  "graceEndsAt",
  "graceReason",
  "isEvaluation",
  "isEvaluationLicense",
  "licenseValid",
  "status",
  "verification",
].sort();

// Never in a response to anybody but a master admin.
const MASTER_ADMIN_ONLY_KEYS: Array<string> = [
  "activationMode",
  "canAddMoreUsers",
  "currentUserCount",
  "currentVersion",
  "instanceId",
  "instances",
  "isSeatLimitEnforced",
  "isUpdateAvailable",
  "isUpdateCheckDisabled",
  "latestVersion",
  "latestVersionCheckedAt",
  "latestVersionPublishedAt",
  "licenseKey",
  "message",
  "seatsInUse",
  "seatsRemaining",
  "token",
  "userCountUpdatedAt",
  "userLimit",
].sort();

type MakeStoredConfigFunction = (
  overrides?: Record<string, unknown>,
) => GlobalConfig;

const makeStoredConfig: MakeStoredConfigFunction = (
  overrides?: Record<string, unknown>,
): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();
  config.id = ObjectID.getZeroObjectID();
  config.instanceId = INSTANCE_ID;
  config.enterpriseLicenseKey = STORED_LICENSE_KEY;
  config.enterpriseLicenseToken = STORED_TOKEN;
  config.enterpriseLicenseUserLimit = 999;
  config.enterpriseLicenseCurrentUserCount = 42;
  config.enterpriseLicenseUserCountUpdatedAt = new Date(
    "2026-09-01T00:00:00.000Z",
  );
  config.enterpriseLicenseInstances = [
    {
      instanceId: INSTANCE_ID.toString(),
      host: "prod.acme.internal",
      userCount: 42,
      lastReportedAt: "2026-09-01T00:00:00.000Z",
      version: "13.0.0",
    },
  ];
  config.latestReleaseVersion = "99.0.0";
  config.latestReleasePublishedAt = new Date("2026-09-10T00:00:00.000Z");
  config.latestReleaseCheckedAt = new Date("2026-09-11T00:00:00.000Z");

  return Object.assign(config, overrides || {});
};

const ENFORCED_SEAT_USAGE: SeatUsage = {
  isEnforced: true,
  userLimit: 50,
  seatsInUse: 49,
  seatsRemaining: 1,
  hasSeatForNewUser: true,
  seatsUsedByOtherInstances: 0,
};

type CallerKind = "anonymous" | "signed-in user" | "master admin";

describe("GET /global-config/license", () => {
  let mockRequest: OneUptimeRequest;
  let mockResponse: OneUptimeResponse;
  let nextFunction: NextFunction;

  const setCaller: (caller: CallerKind) => void = (
    caller: CallerKind,
  ): void => {
    const request: Record<string, unknown> = mockRequest as unknown as Record<
      string,
      unknown
    >;

    if (caller === "anonymous") {
      delete request["userAuthorization"];
      return;
    }

    request["userAuthorization"] = {
      userId: ObjectID.generate(),
      isMasterAdmin: caller === "master admin",
    };
  };

  const callGet: () => Promise<JSONObject> = async (): Promise<JSONObject> => {
    await mockRouter
      .match("get", LICENSE_ROUTE)
      .handlerFunction(mockRequest, mockResponse, nextFunction);

    expect(nextFunction).not.toHaveBeenCalled();

    const calls: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    expect(calls).toHaveLength(1);

    return calls[0]![2] as JSONObject;
  };

  const installWithSnapshot: (
    snapshot: EnterpriseLicenseSnapshot | null,
    seatUsage?: SeatUsage | null,
  ) => FakeEnterpriseModule = (
    snapshot: EnterpriseLicenseSnapshot | null,
    seatUsage?: SeatUsage | null,
  ): FakeEnterpriseModule => {
    return installFakeEnterpriseModule({
      snapshot,
      seatUsage: seatUsage === undefined ? ENFORCED_SEAT_USAGE : seatUsage,
    });
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes = [];
    setTestBillingEnabled(false);
    uninstallEnterpriseModule();

    new GlobalConfigAPI();

    GlobalConfigService.findOneById = jest
      .fn()
      .mockResolvedValue(makeStoredConfig());

    /*
     * Express always gives a request a `query` object; the licence GET reads
     * `signedIn` from it before anything else.
     */
    mockRequest = {
      body: {},
      query: {},
    } as unknown as OneUptimeRequest;

    mockResponse = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;

    nextFunction = jest.fn();
  });

  afterEach(() => {
    uninstallEnterpriseModule();
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("the routes core still serves", () => {
    it("serves the GET to anyone, so the login page keeps working", () => {
      const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
        "get",
        LICENSE_ROUTE,
      );

      expect(route.middlewares).toEqual([UserMiddleware.getUserMiddleware]);
      expect(route.middlewares).not.toContain(
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      );
    });

    /*
     * Activation and refresh are the Enterprise license client's now. A copy
     * left behind in core would be a second writer of the license, served
     * even by the Community Edition.
     */
    it.each([LICENSE_ROUTE, REFRESH_ROUTE])(
      "no longer registers POST %s in core",
      (route: string) => {
        const posts: Array<string> = mockRouter.routes
          .filter((registered: { method: string; uri: string }): boolean => {
            return registered.method === "POST";
          })
          .map((registered: { uri: string }): string => {
            return registered.uri;
          });

        expect(posts).not.toContain(route);
      },
    );

    it("keeps /global-config/vars", () => {
      expect(
        mockRouter.match("get", "/global-config/vars").handlerFunction,
      ).toBeDefined();
    });
  });

  describe("on the Community Edition", () => {
    it.each([
      "anonymous",
      "signed-in user",
      "master admin",
    ] as Array<CallerKind>)(
      "says community with no license to a %s",
      async (caller: CallerKind) => {
        setCaller(caller);

        const body: JSONObject = await callGet();

        expect(body["edition"]).toBe("community");
        expect(body["status"]).toBeNull();
        expect(body["verification"]).toBeNull();
        expect(body["licenseValid"]).toBe(false);
        expect(body["companyName"]).toBeNull();
        expect(body["expiresAt"]).toBeNull();
      },
    );

    /*
     * The Community Edition dialog still has a version card: which build is
     * running and whether a newer one exists is a property of the
     * installation, not of a license.
     */
    it("still gives a master admin the version and update-check fields", async () => {
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["currentVersion"]).toBe(AppVersion);
      expect(body["latestVersion"]).toBe("99.0.0");
      expect(body["latestVersionPublishedAt"]).toBe("2026-09-10T00:00:00.000Z");
      expect(body["latestVersionCheckedAt"]).toBe("2026-09-11T00:00:00.000Z");
      expect(typeof body["isUpdateAvailable"]).toBe("boolean");
      expect(typeof body["isUpdateCheckDisabled"]).toBe("boolean");
    });

    /*
     * A key or token left over from an earlier Enterprise image licenses
     * nothing on the Community Edition, so it is not reported as if it did.
     */
    it("reports no license key, token, topology or seats even when old license columns remain", async () => {
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["licenseKey"]).toBeNull();
      expect(body["token"]).toBeNull();
      expect(body["activationMode"]).toBeNull();
      expect(body["instances"]).toEqual([]);
      expect(body["instanceId"]).toBeNull();
      expect(body["userLimit"]).toBeNull();
      expect(body["currentUserCount"]).toBeNull();
      expect(body["isSeatLimitEnforced"]).toBe(false);
      expect(body["canAddMoreUsers"]).toBe(true);
    });

    it("gives everybody else only the public fields and reads nothing", async () => {
      setCaller("signed-in user");

      const body: JSONObject = await callGet();

      expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
      expect(GlobalConfigService.findOneById).not.toHaveBeenCalled();
    });
  });

  describe("on the Enterprise Edition - what each caller gets", () => {
    beforeEach(() => {
      installWithSnapshot(createLicenseSnapshot({ userLimit: 50 }));
    });

    it.each(["anonymous", "signed-in user"] as Array<CallerKind>)(
      "gives a %s exactly the public fields",
      async (caller: CallerKind) => {
        setCaller(caller);

        const body: JSONObject = await callGet();

        expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);

        for (const key of MASTER_ADMIN_ONLY_KEYS) {
          expect(body).not.toHaveProperty(key);
        }
      },
    );

    /*
     * The finding this closes: a signed-in (non-admin) user, or anybody whose
     * token decodes to a userId, used to receive the license key, the token
     * and every instance's host.
     */
    it("never gives a signed-in user who is not a master admin the key, the token or the topology", async () => {
      setCaller("signed-in user");

      const body: JSONObject = await callGet();
      const serialized: string = JSON.stringify(body);

      expect(serialized).not.toContain(STORED_LICENSE_KEY);
      expect(serialized).not.toContain(STORED_TOKEN);
      expect(serialized).not.toContain("prod.acme.internal");
      expect(serialized).not.toContain(INSTANCE_ID.toString());
    });

    it("does not read the config row or count seats for anybody but a master admin", async () => {
      const fake: FakeEnterpriseModule = installWithSnapshot(
        createLicenseSnapshot(),
      );
      const seatUsageSpy: jest.SpyInstance = jest.spyOn(
        fake.licensing,
        "getSeatUsage",
      );

      setCaller("anonymous");

      await callGet();

      expect(GlobalConfigService.findOneById).not.toHaveBeenCalled();
      expect(seatUsageSpy).not.toHaveBeenCalled();
    });

    it("gives a master admin the public fields plus everything needed to manage the license", async () => {
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(Object.keys(body).sort()).toEqual(
        [...PUBLIC_KEYS, ...MASTER_ADMIN_ONLY_KEYS].sort(),
      );
      expect(body["licenseKey"]).toBe(STORED_LICENSE_KEY);
      expect(body["token"]).toBe(STORED_TOKEN);
      expect(body["instanceId"]).toBe(INSTANCE_ID.toString());
      expect(body["instances"]).toHaveLength(1);
      expect(body["currentUserCount"]).toBe(42);
      expect(body["userCountUpdatedAt"]).toBe("2026-09-01T00:00:00.000Z");
      expect(body["currentVersion"]).toBe(AppVersion);
      expect(body["activationMode"]).toBe("online");
    });

    it("reads the row with exactly the columns the response needs, as root", async () => {
      setCaller("master admin");

      await callGet();

      const call: Record<string, unknown> = (
        GlobalConfigService.findOneById as unknown as jest.Mock
      ).mock.calls[0]![0] as Record<string, unknown>;

      expect(call["select"]).toEqual(LICENSE_RESPONSE_CONFIG_SELECT);
      expect((call["props"] as Record<string, unknown>)["isRoot"]).toBe(true);
    });

    /*
     * A verified license's limits come from its signed claims; the column is
     * only a mirror a master admin could once overwrite. The snapshot is the
     * truth, so the response reports its limit, not the column's 999.
     */
    it("reports the seat limit from the license snapshot, not the stored column", async () => {
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["userLimit"]).toBe(50);
    });

    it("reports the seat enforcement the license client computed", async () => {
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["isSeatLimitEnforced"]).toBe(true);
      expect(body["seatsInUse"]).toBe(49);
      expect(body["seatsRemaining"]).toBe(1);
      expect(body["canAddMoreUsers"]).toBe(true);
    });

    it("says the limit is not enforced when the license client reports no usage", async () => {
      installWithSnapshot(createLicenseSnapshot(), null);
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["isSeatLimitEnforced"]).toBe(false);
      expect(body["seatsInUse"]).toBeNull();
      expect(body["seatsRemaining"]).toBeNull();
      expect(body["canAddMoreUsers"]).toBe(true);
    });

    it("calls an installation with a token but no key offline-activated", async () => {
      GlobalConfigService.findOneById = jest
        .fn()
        .mockResolvedValue(
          makeStoredConfig({ enterpriseLicenseKey: undefined }),
        );
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["activationMode"]).toBe("offline");
      expect(body["licenseKey"]).toBeNull();
    });

    it("has no activation mode when there is no token at all", async () => {
      GlobalConfigService.findOneById = jest.fn().mockResolvedValue(
        makeStoredConfig({
          enterpriseLicenseToken: undefined,
        }),
      );
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["activationMode"]).toBeNull();
    });

    it("survives a missing config row", async () => {
      GlobalConfigService.findOneById = jest.fn().mockResolvedValue(null);
      setCaller("master admin");

      const body: JSONObject = await callGet();

      expect(body["licenseKey"]).toBeNull();
      expect(body["instances"]).toEqual([]);
      expect(body["latestVersion"]).toBeNull();
      expect(body["edition"]).toBe("enterprise");
    });
  });

  describe("on the Enterprise Edition - what each license status looks like", () => {
    /*
     * licenseValid is the pill's verdict. Grace must read as valid: nothing
     * has changed yet, and telling an administrator the license is gone while
     * everything still works would be a false alarm.
     */
    it.each<[EnterpriseLicenseStatus, boolean]>([
      ["valid", true],
      ["grace", true],
      ["expired", false],
      ["missing", false],
      ["invalid", false],
    ])(
      "status %s reads as licenseValid=%s to everybody",
      async (status: EnterpriseLicenseStatus, expected: boolean) => {
        installWithSnapshot(createLicenseSnapshotWithStatus(status));

        for (const caller of [
          "anonymous",
          "signed-in user",
          "master admin",
        ] as Array<CallerKind>) {
          (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
          setCaller(caller);

          const body: JSONObject = await callGet();

          expect(body["edition"]).toBe("enterprise");
          expect(body["status"]).toBe(status);
          expect(body["licenseValid"]).toBe(expected);
        }
      },
    );

    it("tells everybody when an expired license's grace period ends", async () => {
      const graceEndsAt: Date = new Date(Date.now() + 5 * DAY_IN_MS);
      const expiresAt: Date = new Date(Date.now() - 9 * DAY_IN_MS);

      installWithSnapshot(
        createLicenseSnapshotWithStatus("grace", {
          graceReason: "expired",
          graceEndsAt,
          expiresAt,
        }),
      );
      setCaller("anonymous");

      const body: JSONObject = await callGet();

      expect(body["graceReason"]).toBe("expired");
      expect(body["graceEndsAt"]).toBe(graceEndsAt.toISOString());
      expect(body["expiresAt"]).toBe(expiresAt.toISOString());
    });

    it("reports an unlicensed installation inside its first-seen grace as a trial", async () => {
      const graceEndsAt: Date = new Date(Date.now() + 10 * DAY_IN_MS);

      installWithSnapshot({
        status: "grace",
        verification: "none",
        graceReason: "unlicensed",
        graceEndsAt,
        userLimit: null,
        isEvaluation: false,
        features: "all",
      });
      setCaller("signed-in user");

      const body: JSONObject = await callGet();

      expect(body["status"]).toBe("grace");
      expect(body["graceReason"]).toBe("unlicensed");
      expect(body["verification"]).toBe("none");
      expect(body["licenseValid"]).toBe(true);
      expect(body["graceEndsAt"]).toBe(graceEndsAt.toISOString());
      expect(body["companyName"]).toBeNull();
    });

    it("reports an unverified legacy license as valid but unverified", async () => {
      installWithSnapshot(
        createLicenseSnapshot({ verification: "unverified" }),
      );
      setCaller("anonymous");

      const body: JSONObject = await callGet();

      expect(body["licenseValid"]).toBe(true);
      expect(body["verification"]).toBe("unverified");
    });

    it("reports the evaluation flag under both its names", async () => {
      installWithSnapshot(createLicenseSnapshot({ isEvaluation: true }));
      setCaller("anonymous");

      const body: JSONObject = await callGet();

      expect(body["isEvaluation"]).toBe(true);
      expect(body["isEvaluationLicense"]).toBe(true);
    });

    it("explains an invalid license to a master admin only", async () => {
      installWithSnapshot(
        createLicenseSnapshotWithStatus("invalid", {
          message: "The license is bound to a different OneUptime instance.",
        }),
      );

      setCaller("master admin");
      expect((await callGet())["message"]).toBe(
        "The license is bound to a different OneUptime instance.",
      );

      (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();
      setCaller("signed-in user");
      expect(await callGet()).not.toHaveProperty("message");
    });

    /*
     * The snapshot could not be read at all (the facade falls back to the
     * cached snapshot, and there is none yet). The answer is "not licensed",
     * never an error page on the login screen.
     */
    it("reads as not licensed when no snapshot is available", async () => {
      const fake: FakeEnterpriseModule = installWithSnapshot(null);
      fake.licensing.getSnapshotError = new Error("database is down");
      setCaller("anonymous");

      const body: JSONObject = await callGet();

      expect(body["edition"]).toBe("enterprise");
      expect(body["status"]).toBeNull();
      expect(body["licenseValid"]).toBe(false);
    });

    it("asks the facade for the snapshot rather than reading license columns itself", async () => {
      installWithSnapshot(createLicenseSnapshot());
      const snapshotSpy: jest.SpyInstance = jest.spyOn(
        EnterpriseEdition,
        "getLicenseSnapshot",
      );
      setCaller("anonymous");

      await callGet();

      expect(snapshotSpy).toHaveBeenCalledTimes(1);
    });
  });

  /*
   * THE EXPIRED-SESSION CASE
   *
   * The dashboard's access-token cookie expires with the JWT inside it, so a
   * signed-in tab left idle past the token lifetime asks for the licence
   * with no session at all. On its own this route cannot tell that apart
   * from the login page, and answers with the reduced anonymous payload and
   * a 200 - which the edition pill reads as "no licence, no instances". The
   * dashboards now say `?signedIn=true`; a caller that says so but carries
   * no credentials is answered 401, the one status the browser client
   * refreshes the session and replays on.
   */
  describe("?signedIn=true", () => {
    const setRequest: (fields: Record<string, unknown>) => void = (
      fields: Record<string, unknown>,
    ): void => {
      Object.assign(mockRequest as unknown as Record<string, unknown>, fields);
    };

    const callGetExpectingError: () => Promise<Error> =
      async (): Promise<Error> => {
        await mockRouter
          .match("get", LICENSE_ROUTE)
          .handlerFunction(mockRequest, mockResponse, nextFunction);

        expect(nextFunction).toHaveBeenCalledTimes(1);

        return (nextFunction as unknown as jest.Mock).mock
          .calls[0]![0] as Error;
      };

    it.each([
      ["no userType at all", {}],
      [
        "userType Public (what getUserMiddleware stamps)",
        { userType: UserType.Public },
      ],
    ])(
      "answers an anonymous caller (%s) with a 401 before reading anything",
      async (_label: string, caller: Record<string, unknown>) => {
        installWithSnapshot(createLicenseSnapshot());
        const snapshotSpy: jest.SpyInstance = jest.spyOn(
          EnterpriseEdition,
          "getLicenseSnapshot",
        );

        setRequest({ ...caller, query: { signedIn: "true" } });

        const error: Error = await callGetExpectingError();

        expect(error).toBeInstanceOf(NotAuthenticatedException);
        expect((error as Exception).code).toBe(401);
        expect(error.message).toBe(
          UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
        );
        expect(snapshotSpy).not.toHaveBeenCalled();
        expect(GlobalConfigService.findOneById).not.toHaveBeenCalled();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      },
    );

    it("answers the 401 on the Community Edition too", async () => {
      setRequest({ userType: UserType.Public, query: { signedIn: "true" } });

      const error: Error = await callGetExpectingError();

      expect(error).toBeInstanceOf(NotAuthenticatedException);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    // The login page does not send the flag and must keep working.
    it("still serves an anonymous caller without the flag the public payload", async () => {
      installWithSnapshot(createLicenseSnapshot());
      setRequest({ userType: UserType.Public, query: {} });

      const body: JSONObject = await callGet();

      expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
      expect(body["licenseKey"]).toBeUndefined();
    });

    it.each([
      ["signedIn=false", { signedIn: "false" }],
      ["an empty signedIn", { signedIn: "" }],
      ["signedIn=1", { signedIn: "1" }],
    ])(
      'only the exact string "true" asks for a 401 (%s serves the public payload)',
      async (_label: string, query: Record<string, unknown>) => {
        setRequest({ userType: UserType.Public, query: query });

        const body: JSONObject = await callGet();

        expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
      },
    );

    it("serves a signed-in master admin the full payload with the flag", async () => {
      installWithSnapshot(createLicenseSnapshot({ userLimit: 50 }));
      setCaller("master admin");
      setRequest({ userType: UserType.User, query: { signedIn: "true" } });

      const body: JSONObject = await callGet();

      expect(body["licenseKey"]).toBe(STORED_LICENSE_KEY);
      expect(body["instanceId"]).toBe(INSTANCE_ID.toString());
    });

    it("serves a signed-in user who is not a master admin the public payload with the flag", async () => {
      installWithSnapshot(createLicenseSnapshot());
      setCaller("signed-in user");
      setRequest({ userType: UserType.User, query: { signedIn: "true" } });

      const body: JSONObject = await callGet();

      expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    });

    /*
     * A project API key has credentials, so it is not an expired session:
     * no 401. It has no user either, so it still gets only what an
     * anonymous caller gets.
     */
    it("does not 401 an API-key caller that sends the flag", async () => {
      installWithSnapshot(createLicenseSnapshot());
      setRequest({ userType: UserType.API, query: { signedIn: "true" } });

      const body: JSONObject = await callGet();

      expect(Object.keys(body).sort()).toEqual(PUBLIC_KEYS);
    });
  });

  describe("errors", () => {
    it("passes a database failure to next instead of answering", async () => {
      GlobalConfigService.findOneById = jest
        .fn()
        .mockRejectedValue(new Error("database is down"));
      setCaller("master admin");

      await mockRouter
        .match("get", LICENSE_ROUTE)
        .handlerFunction(mockRequest, mockResponse, nextFunction);

      expect(nextFunction).toHaveBeenCalledTimes(1);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });
});

describe("GlobalConfigAPI.buildLicenseResponse", () => {
  it("ignores a snapshot handed to it when the Enterprise Edition is not loaded", () => {
    const body: JSONObject = GlobalConfigAPI.buildLicenseResponse({
      audience: "master-admin",
      isEnterpriseEditionLoaded: false,
      snapshot: createLicenseSnapshot(),
      config: makeStoredConfig(),
      seatUsage: ENFORCED_SEAT_USAGE,
    });

    expect(body["edition"]).toBe("community");
    expect(body["licenseValid"]).toBe(false);
    expect(body["licenseKey"]).toBeNull();
    expect(body["isSeatLimitEnforced"]).toBe(false);
  });

  it("has the same keys for every audience whatever the license state", () => {
    const statuses: Array<EnterpriseLicenseStatus> = [
      "valid",
      "grace",
      "expired",
      "missing",
      "invalid",
    ];

    for (const status of statuses) {
      const publicBody: JSONObject = GlobalConfigAPI.buildLicenseResponse({
        audience: "public",
        isEnterpriseEditionLoaded: true,
        snapshot: createLicenseSnapshotWithStatus(status),
        config: makeStoredConfig(),
        seatUsage: ENFORCED_SEAT_USAGE,
      });
      const adminBody: JSONObject = GlobalConfigAPI.buildLicenseResponse({
        audience: "master-admin",
        isEnterpriseEditionLoaded: true,
        snapshot: createLicenseSnapshotWithStatus(status),
        config: makeStoredConfig(),
        seatUsage: ENFORCED_SEAT_USAGE,
      });

      expect(Object.keys(publicBody).sort()).toEqual(PUBLIC_KEYS);
      expect(Object.keys(adminBody).sort()).toEqual(
        [...PUBLIC_KEYS, ...MASTER_ADMIN_ONLY_KEYS].sort(),
      );
    }
  });

  describe("features", () => {
    const buildPublic: (
      snapshot: EnterpriseLicenseSnapshot | null,
      isEnterpriseEditionLoaded?: boolean,
    ) => JSONObject = (
      snapshot: EnterpriseLicenseSnapshot | null,
      isEnterpriseEditionLoaded?: boolean,
    ): JSONObject => {
      return GlobalConfigAPI.buildLicenseResponse({
        audience: "public",
        isEnterpriseEditionLoaded: isEnterpriseEditionLoaded !== false,
        snapshot,
        config: null,
        seatUsage: null,
      });
    };

    it('is "all" for a license that covers everything', () => {
      expect(buildPublic(createLicenseSnapshot())["features"]).toBe("all");
    });

    /*
     * A valid license that leaves SSO out stops SSO (isFeatureActive), and
     * licenseValid alone cannot tell a settings page that.
     */
    it("lists the features of a license that names them, so a page can tell one is left out", () => {
      const body: JSONObject = buildPublic(
        createLicenseSnapshot({
          features: [EnterpriseFeature.SCIM, EnterpriseFeature.AuditLogs],
        }),
      );

      expect(body["licenseValid"]).toBe(true);
      expect(body["features"]).toEqual(["scim", "audit-logs"]);
      expect(body["features"]).not.toContain(EnterpriseFeature.SSO);
    });

    it("is an empty list when the license entitles nothing", () => {
      expect(
        buildPublic(createLicenseSnapshotWithStatus("missing"))["features"],
      ).toEqual([]);
    });

    it("is null on the Community Edition, whatever snapshot is handed in", () => {
      expect(buildPublic(null)["features"]).toBeNull();
      expect(
        buildPublic(createLicenseSnapshot(), false)["features"],
      ).toBeNull();
    });

    it("hands out a copy, never the snapshot's own list", () => {
      const snapshot: EnterpriseLicenseSnapshot = createLicenseSnapshot({
        features: [EnterpriseFeature.SSO],
      });
      const features: Array<string> = buildPublic(snapshot)[
        "features"
      ] as Array<string>;

      features.push("mutated");

      expect(snapshot.features).toEqual([EnterpriseFeature.SSO]);
    });

    it("is the same for a master admin", () => {
      const body: JSONObject = GlobalConfigAPI.buildLicenseResponse({
        audience: "master-admin",
        isEnterpriseEditionLoaded: true,
        snapshot: createLicenseSnapshot({ features: [EnterpriseFeature.SSO] }),
        config: makeStoredConfig(),
        seatUsage: ENFORCED_SEAT_USAGE,
      });

      expect(body["features"]).toEqual(["sso"]);
    });
  });

  it("maps unenforced seat usage to the 'nothing to enforce' fields", () => {
    expect(
      GlobalConfigAPI.getSeatUsageResponseFields({
        ...ENFORCED_SEAT_USAGE,
        isEnforced: false,
      }),
    ).toEqual({
      isSeatLimitEnforced: false,
      seatsInUse: null,
      seatsRemaining: null,
      canAddMoreUsers: true,
    });
  });

  it("reports a full license as unable to take more users", () => {
    expect(
      GlobalConfigAPI.getSeatUsageResponseFields({
        ...ENFORCED_SEAT_USAGE,
        seatsInUse: 50,
        seatsRemaining: 0,
        hasSeatForNewUser: false,
      }),
    ).toEqual({
      isSeatLimitEnforced: true,
      seatsInUse: 50,
      seatsRemaining: 0,
      canAddMoreUsers: false,
    });
  });
});
