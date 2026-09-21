import {
  createLicenseClientRouter,
  LICENSE_REFRESH_ROUTE,
  LICENSE_ROUTE,
} from "../../../Server/License/API/LicenseClientAPI";
import licenseProvider from "../../../Server/License/LicenseProvider";
import { setTrustedLicenseKeysForTests } from "../../../Server/License/TrustedLicenseKeys";
import { LICENSE_TOKEN_MAX_LENGTH } from "../../../Server/License/LicenseToken";
import LicenseSigner, {
  ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV,
  LicenseTokenSubject,
} from "../../../Server/LicenseServer/LicenseSigner";
import { EnterpriseServerModuleShape } from "Common/Server/Enterprise/EnterpriseServerModule";
import MasterAdminAuthorization from "Common/Server/Middleware/MasterAdminAuthorization";
import GlobalConfigService from "Common/Server/Services/GlobalConfigService";
import UserService from "Common/Server/Services/UserService";
import Response from "Common/Server/Utils/Response";
import logger from "Common/Server/Utils/Logger";
import type { ExpressRouter } from "Common/Server/Utils/Express";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import BadDataException from "Common/Types/Exception/BadDataException";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import PositiveNumber from "Common/Types/PositiveNumber";
import API from "Common/Utils/API";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import {
  DAY_IN_MS,
  FakeGlobalConfigRow,
  findRoute,
  FoundRoute,
  generateEd25519,
  KeyPair,
  legacyToken,
  listRoutes,
  RecordedWrite,
  signLicense,
  trustedEntryFor,
} from "./Helpers/LicenseTestKit";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * The license client's write routes: activating a license (online with a key,
 * or offline with a signed token) and refreshing the license this
 * installation already holds.
 *
 * They moved out of core's GlobalConfigAPI into the Enterprise module; the GET
 * on the same path stays in core (packages/Common/Tests/Server/API/
 * GlobalConfigLicense.test.ts). What these pin, beyond the behaviour the core
 * routes had:
 *
 *   - both routes are master-admin only, checked per route (an ee router may
 *     hold no router.use() layers);
 *   - offline activation accepts only a VERIFIED token bound to THIS
 *     instance: one bound to another instance is refused, and so is one
 *     bound to none (the token an online installation receives, which the GET
 *     shows its master admins);
 *   - a refresh never downgrades the installed license;
 *   - every write lands as root with hooks off, and the license cache of this
 *     process sees it at once.
 */

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

jest.mock("Common/Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendJsonObjectResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
    },
  };
});

jest.mock("Common/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
      create: jest.fn(),
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      countBy: jest.fn(),
    },
  };
});

const SIGNING_KEY: KeyPair = generateEd25519();
const UNTRUSTED_KEY: KeyPair = generateEd25519();

const STORED_LICENSE_KEY: string = "acme-stored-license-key";
const INSTANCE_ID: ObjectID = ObjectID.generate();

let store: FakeGlobalConfigRow;
let router: ExpressRouter;

type LicenseServerPayloadFunction = (
  overrides?: Record<string, unknown>,
) => JSONObject;

// What oneuptime.com answers today: a legacy (HS256) token.
const licenseServerPayload: LicenseServerPayloadFunction = (
  overrides?: Record<string, unknown>,
): JSONObject => {
  return {
    companyName: "Acme Inc",
    expiresAt: new Date(Date.now() + 365 * DAY_IN_MS).toISOString(),
    licenseKey: STORED_LICENSE_KEY,
    token: legacyToken("from-server"),
    isEvaluationLicense: false,
    userLimit: 150,
    currentUserCount: 42,
    userCountUpdatedAt: "2026-01-01T00:00:00.000Z",
    instances: [],
    ...overrides,
  };
};

const respondWith: (payload: JSONObject) => void = (
  payload: JSONObject,
): void => {
  (API.post as unknown as jest.Mock).mockResolvedValue(
    new HTTPResponse<JSONObject>(200, payload, {}),
  );
};

const storedRow: (overrides?: Record<string, unknown>) => Record<
  string,
  unknown
> = (overrides?: Record<string, unknown>): Record<string, unknown> => {
  return {
    instanceId: INSTANCE_ID,
    enterpriseLicenseKey: STORED_LICENSE_KEY,
    enterpriseLicenseToken: legacyToken("stored"),
    enterpriseLicenseExpiresAt: new Date(Date.now() + 100 * DAY_IN_MS),
    enterpriseCompanyName: "Acme Inc",
    enterpriseLicenseUserLimit: 50,
    enterpriseEditionFirstSeenAt: new Date(Date.now() - 100 * DAY_IN_MS),
    ...(overrides || {}),
  };
};

interface CallResult {
  body: JSONObject | null;
  error: Error | null;
}

const callRoute: (path: string, body?: JSONObject) => Promise<CallResult> =
  async (path: string, body?: JSONObject): Promise<CallResult> => {
    const route: FoundRoute = findRoute(router, "post", path);
    const next: jest.Mock = jest.fn();

    (Response.sendJsonObjectResponse as unknown as jest.Mock).mockClear();

    await route.handler({ body: body || {} }, {}, next);

    const errors: Array<Array<unknown>> = next.mock.calls as Array<
      Array<unknown>
    >;
    const responses: Array<Array<unknown>> = (
      Response.sendJsonObjectResponse as unknown as jest.Mock
    ).mock.calls as Array<Array<unknown>>;

    return {
      body: responses[0] ? (responses[0][2] as JSONObject) : null,
      error: errors[0] ? (errors[0][0] as Error) : null,
    };
  };

const sentToLicenseServer: () => JSONObject = (): JSONObject => {
  const calls: Array<Array<unknown>> = (API.post as unknown as jest.Mock).mock
    .calls as Array<Array<unknown>>;

  expect(calls).toHaveLength(1);

  return (calls[0]![0] as JSONObject)["data"] as JSONObject;
};

/*
 * A token as OneUptime issues it for offline activation: signed by a trusted
 * key and bound to this installation's instance id.
 */
const offlineToken: (
  overrides?: Parameters<typeof signLicense>[1],
) => string = (overrides?: Parameters<typeof signLicense>[1]): string => {
  return signLicense(SIGNING_KEY, {
    instanceId: INSTANCE_ID.toString(),
    ...(overrides || {}),
  });
};

const lastLicenseWrite: () => RecordedWrite = (): RecordedWrite => {
  const writes: Array<RecordedWrite> = store.licenseWrites();
  const write: RecordedWrite | undefined = writes[writes.length - 1];

  if (!write) {
    throw new Error("No license write happened.");
  }

  return write;
};

beforeEach(async () => {
  jest.clearAllMocks();
  setTestBillingEnabled(false);
  setTrustedLicenseKeysForTests([trustedEntryFor(SIGNING_KEY)]);
  jest.spyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });
  jest.spyOn(logger, "info").mockImplementation((): void => {
    return undefined;
  });

  store = new FakeGlobalConfigRow(storedRow());
  store.install(GlobalConfigService);

  (UserService as unknown as Record<string, unknown>)["countBy"] = jest
    .fn()
    .mockResolvedValue(new PositiveNumber(42) as never);

  respondWith(licenseServerPayload());
  router = createLicenseClientRouter();

  await licenseProvider.refresh();
});

afterEach(() => {
  setTrustedLicenseKeysForTests(null);
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("the license client router", () => {
  it("serves exactly the two license writes", () => {
    expect(listRoutes(router)).toEqual(
      [`POST ${LICENSE_ROUTE}`, `POST ${LICENSE_REFRESH_ROUTE}`].sort(),
    );
  });

  it("keeps the paths the Admin Dashboard already calls", () => {
    expect(LICENSE_ROUTE).toBe("/global-config/license");
    expect(LICENSE_REFRESH_ROUTE).toBe("/global-config/license/refresh");
  });

  /*
   * Mounted under "/api" ahead of core's routers: a router.use() layer here
   * would run for every core request that passes through.
   */
  it("holds routes only, no router.use() layers", () => {
    expect(EnterpriseServerModuleShape.findLayersWithoutRoute(router)).toEqual(
      [],
    );
  });

  /*
   * The seat limit these routes store is the number UserService refuses new
   * users against. The GET on the same path serves the signed-out login page,
   * so its middleware is no guard here.
   */
  it.each([LICENSE_ROUTE, LICENSE_REFRESH_ROUTE])(
    "requires a master admin for POST %s",
    (path: string) => {
      expect(findRoute(router, "post", path).middlewares).toEqual([
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ]);
    },
  );

  it("turns away a request without a master admin's token before the handler runs", async () => {
    const next: jest.Mock = jest.fn();

    await MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware(
      { headers: {}, query: {}, cookies: {} } as never,
      {} as never,
      next as never,
    );

    expect(next).not.toHaveBeenCalled();
    expect(Response.sendErrorResponse).toHaveBeenCalled();
  });
});

describe("POST /global-config/license - activating a key online", () => {
  it("rejects a request with no licence key", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {});

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(API.post).not.toHaveBeenCalled();
  });

  it("rejects a licence key that is only whitespace", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: "   ",
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(API.post).not.toHaveBeenCalled();
  });

  it("validates the supplied key against oneuptime.com", async () => {
    await callRoute(LICENSE_ROUTE, { licenseKey: "  a-new-key  " });

    const sent: JSONObject = sentToLicenseServer();

    expect(sent["licenseKey"]).toBe("a-new-key");
    expect(sent["instanceId"]).toBe(INSTANCE_ID.toString());
    expect(sent).toHaveProperty("host");
    expect(sent).toHaveProperty("version");
  });

  it("stores the seat limit the licence server reported", async () => {
    await callRoute(LICENSE_ROUTE, { licenseKey: STORED_LICENSE_KEY });

    expect(lastLicenseWrite().data["enterpriseLicenseUserLimit"]).toBe(150);
  });

  it("writes as root with hooks off", async () => {
    await callRoute(LICENSE_ROUTE, { licenseKey: STORED_LICENSE_KEY });

    expect(lastLicenseWrite().props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
  });

  it("stores the key the licence server echoes back", async () => {
    respondWith(licenseServerPayload({ licenseKey: "CANONICAL-KEY" }));

    await callRoute(LICENSE_ROUTE, { licenseKey: "canonical-key" });

    expect(store.row?.["enterpriseLicenseKey"]).toBe("CANONICAL-KEY");
  });

  it("stores the typed key when the server echoes none", async () => {
    respondWith(licenseServerPayload({ licenseKey: undefined }));

    await callRoute(LICENSE_ROUTE, { licenseKey: "typed-key" });

    expect(store.row?.["enterpriseLicenseKey"]).toBe("typed-key");
  });

  it("answers with the master-admin view of the new license", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
    });

    expect(result.error).toBeNull();
    expect(result.body?.["edition"]).toBe("enterprise");
    expect(result.body?.["status"]).toBe("valid");
    expect(result.body?.["verification"]).toBe("unverified");
    expect(result.body?.["licenseValid"]).toBe(true);
    expect(result.body?.["licenseKey"]).toBe(STORED_LICENSE_KEY);
    expect(result.body?.["userLimit"]).toBe(150);
    expect(result.body?.["activationMode"]).toBe("online");
  });

  it("generates and persists an instance id for an install that predates them", async () => {
    store.row!["instanceId"] = undefined;

    await callRoute(LICENSE_ROUTE, { licenseKey: STORED_LICENSE_KEY });

    const reported: string = sentToLicenseServer()["instanceId"] as string;

    expect(reported.length).toBeGreaterThan(0);
    expect(String(store.row?.["instanceId"])).toBe(reported);
  });

  /*
   * An activation can run before the default GlobalConfig row is seeded; the
   * license client then creates it (as root) rather than dropping the license.
   */
  it("creates the config row when there is none yet", async () => {
    store.row = null;

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
    });

    expect(result.error).toBeNull();
    expect(GlobalConfigService.create).toHaveBeenCalledTimes(1);
    expect(lastLicenseWrite().kind).toBe("create");
    expect(lastLicenseWrite().props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
    expect(store.row?.["enterpriseLicenseUserLimit"]).toBe(150);
  });

  it("surfaces a failure from the licence server instead of storing anything", async () => {
    (API.post as unknown as jest.Mock).mockResolvedValue(
      new HTTPErrorResponse(400, { message: "License key is invalid" }, {}),
    );

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: "wrong-key",
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toBe("License key is invalid");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  /*
   * An explicit activation replaces the installed license, but never with one
   * that cannot work here at all.
   */
  it("refuses a returned license this installation cannot use, and stores nothing", async () => {
    respondWith(
      licenseServerPayload({
        token: signLicense(SIGNING_KEY, { instanceId: "another-instance" }),
      }),
    );

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("cannot use");
    expect(result.error?.message).toContain("different OneUptime instance");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("lets an administrator replace the installed license on purpose", async () => {
    store.row!["enterpriseLicenseToken"] = signLicense(SIGNING_KEY);
    await licenseProvider.refresh();

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: "another-license",
    });

    expect(result.error).toBeNull();
    expect(store.row?.["enterpriseLicenseToken"]).toBe(
      legacyToken("from-server"),
    );
  });

  it("makes the new license visible to this process's permission checks at once", async () => {
    store.row = storedRow({
      enterpriseLicenseToken: undefined,
      enterpriseLicenseKey: undefined,
      enterpriseEditionFirstSeenAt: new Date(Date.now() - 100 * DAY_IN_MS),
    });
    await licenseProvider.refresh();

    expect(licenseProvider.getCachedSnapshot()?.status).toBe("missing");

    await callRoute(LICENSE_ROUTE, { licenseKey: STORED_LICENSE_KEY });

    expect(licenseProvider.getCachedSnapshot()?.status).toBe("valid");
  });
});

describe("POST /global-config/license/refresh", () => {
  /*
   * The whole point of the route: no key in the body. A refresh that
   * accepted one would be an activation with a friendlier name, and a
   * mistyped key would be able to replace a working licence by accident.
   */
  it("refreshes using the stored key and ignores anything in the body", async () => {
    await callRoute(LICENSE_REFRESH_ROUTE, {
      licenseKey: "somebody-elses-key",
    });

    expect(sentToLicenseServer()["licenseKey"]).toBe(STORED_LICENSE_KEY);
  });

  it("never lets the response swap the key it refreshed with", async () => {
    respondWith(licenseServerPayload({ licenseKey: "somebody-elses-key" }));

    await callRoute(LICENSE_REFRESH_ROUTE);

    expect(lastLicenseWrite().data).not.toHaveProperty("enterpriseLicenseKey");
    expect(store.row?.["enterpriseLicenseKey"]).toBe(STORED_LICENSE_KEY);
  });

  it("refuses to refresh an installation that has no licence key yet", async () => {
    store.row!["enterpriseLicenseKey"] = undefined;
    store.row!["enterpriseLicenseToken"] = undefined;

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(API.post).not.toHaveBeenCalled();
  });

  it("refuses to refresh when there is no config row at all", async () => {
    store.row = null;

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(API.post).not.toHaveBeenCalled();
  });

  it("explains that an offline-activated installation has nothing to refresh", async () => {
    store.row!["enterpriseLicenseKey"] = undefined;
    store.row!["enterpriseLicenseToken"] = signLicense(SIGNING_KEY);

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("activated offline");
    expect(API.post).not.toHaveBeenCalled();
  });

  /*
   * The reason the button exists. The customer raised the limit on
   * oneuptime.com; the stored 50 is what this installation is refusing users
   * against until something writes the new number down.
   */
  it("applies a seat limit that has been raised on oneuptime.com", async () => {
    respondWith(licenseServerPayload({ userLimit: 500 }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(lastLicenseWrite().data["enterpriseLicenseUserLimit"]).toBe(500);
    expect(result.body?.["userLimit"]).toBe(500);
  });

  it("applies a seat limit that has been lowered on oneuptime.com", async () => {
    respondWith(licenseServerPayload({ userLimit: 5 }));

    await callRoute(LICENSE_REFRESH_ROUTE);

    expect(lastLicenseWrite().data["enterpriseLicenseUserLimit"]).toBe(5);
  });

  it("clears the seat limit when the licence no longer carries one", async () => {
    respondWith(licenseServerPayload({ userLimit: null }));

    await callRoute(LICENSE_REFRESH_ROUTE);

    expect(lastLicenseWrite().data["enterpriseLicenseUserLimit"]).toBeNull();
  });

  it("refreshes the expiry as well as the seat limit", async () => {
    respondWith(
      licenseServerPayload({ expiresAt: "2031-06-01T00:00:00.000Z" }),
    );

    await callRoute(LICENSE_REFRESH_ROUTE);

    expect(
      (
        lastLicenseWrite().data["enterpriseLicenseExpiresAt"] as Date
      ).toISOString(),
    ).toBe("2031-06-01T00:00:00.000Z");
  });

  /*
   * An installation that cannot reach oneuptime.com must be told so rather
   * than quietly keeping the old terms and reporting success — the
   * administrator pressed this button precisely because they believe the old
   * terms are wrong.
   */
  it("surfaces a failure from the licence server instead of storing anything", async () => {
    (API.post as unknown as jest.Mock).mockResolvedValue(
      new HTTPErrorResponse(500, { message: "License key is invalid" }, {}),
    );

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toBe("License key is invalid");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("does not store anything when the returned expiry is not a date", async () => {
    respondWith(licenseServerPayload({ expiresAt: "the-first-of-never" }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("upgrades a legacy license to a signed one", async () => {
    const signed: string = signLicense(SIGNING_KEY);
    respondWith(licenseServerPayload({ token: signed }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeNull();
    expect(store.row?.["enterpriseLicenseToken"]).toBe(signed);
    expect(result.body?.["verification"]).toBe("verified");
  });
});

describe("POST /global-config/license/refresh - never downgrade", () => {
  let installedToken: string;

  beforeEach(async () => {
    installedToken = signLicense(SIGNING_KEY, { userLimit: 50 });
    store.row!["enterpriseLicenseToken"] = installedToken;
    await licenseProvider.refresh();
  });

  it("keeps a verified license when the server answers with a legacy one", async () => {
    respondWith(licenseServerPayload({ userLimit: 100_000 }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("The installed license was kept");
    expect(store.row?.["enterpriseLicenseToken"]).toBe(installedToken);
    expect(licenseProvider.getCachedSnapshot()?.userLimit).toBe(50);
  });

  it("keeps a working license when the server sends no token at all", async () => {
    respondWith(licenseServerPayload({ token: undefined }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(store.row?.["enterpriseLicenseToken"]).toBe(installedToken);
  });

  it("keeps a working license when the server's signature does not verify", async () => {
    const forged: string = `${installedToken.split(".").slice(0, 2).join(".")}.${
      signLicense(UNTRUSTED_KEY).split(".")[2]
    }`;
    respondWith(licenseServerPayload({ token: forged }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(store.row?.["enterpriseLicenseToken"]).toBe(installedToken);
  });

  it("still stores the usage figures of a refused license", async () => {
    respondWith(
      licenseServerPayload({
        currentUserCount: 77,
        instances: [{ instanceId: "x", host: "h" }],
      }),
    );

    await callRoute(LICENSE_REFRESH_ROUTE);

    expect(store.row?.["enterpriseLicenseCurrentUserCount"]).toBe(77);
    expect(store.row?.["enterpriseLicenseInstances"]).toHaveLength(1);
    expect(store.row?.["enterpriseLicenseUserLimit"]).toBe(50);
  });

  it("accepts a renewal that ranks the same", async () => {
    const renewal: string = signLicense(SIGNING_KEY, { daysFromNow: 700 });
    respondWith(licenseServerPayload({ token: renewal }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeNull();
    expect(store.row?.["enterpriseLicenseToken"]).toBe(renewal);
  });
});

describe("the seat enforcement the response reports", () => {
  it("reports the seats in use against the freshly refreshed limit", async () => {
    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.body?.["isSeatLimitEnforced"]).toBe(true);
    expect(result.body?.["seatsInUse"]).toBe(42);
    expect(result.body?.["seatsRemaining"]).toBe(108);
    expect(result.body?.["canAddMoreUsers"]).toBe(true);
  });

  /*
   * The live count is what enforcement uses, and it is allowed to be higher
   * than the licence-wide figure oneuptime.com last computed — that figure is
   * up to a day old.
   */
  it("prefers the live user count over the licence server's stale one", async () => {
    (UserService as unknown as Record<string, unknown>)["countBy"] = jest
      .fn()
      .mockResolvedValue(new PositiveNumber(150) as never);

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.body?.["seatsInUse"]).toBe(150);
    expect(result.body?.["seatsRemaining"]).toBe(0);
    expect(result.body?.["canAddMoreUsers"]).toBe(false);
  });

  it("says the limit is not enforced when the licence has none", async () => {
    respondWith(licenseServerPayload({ userLimit: null }));

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.body?.["isSeatLimitEnforced"]).toBe(false);
    expect(result.body?.["seatsInUse"]).toBeNull();
    expect(result.body?.["canAddMoreUsers"]).toBe(true);
  });

  it("says the limit is not enforced where billing bounds seats", async () => {
    setTestBillingEnabled(true);

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.body?.["isSeatLimitEnforced"]).toBe(false);
    expect(result.body?.["canAddMoreUsers"]).toBe(true);
    expect(UserService.countBy).not.toHaveBeenCalled();
  });

  it("says the limit is not enforced once the license expired past its grace", async () => {
    respondWith(
      licenseServerPayload({
        expiresAt: new Date(Date.now() - 60 * DAY_IN_MS).toISOString(),
      }),
    );

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
    });

    expect(result.body?.["status"]).toBe("expired");
    expect(result.body?.["licenseValid"]).toBe(false);
    expect(result.body?.["isSeatLimitEnforced"]).toBe(false);
  });
});

describe("POST /global-config/license - activating offline with a signed token", () => {
  it("accepts a token signed by a trusted key and never calls home", async () => {
    const token: string = offlineToken({
      companyName: "Offline Corp",
      userLimit: 25,
    });

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: token,
    });

    expect(result.error).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
    expect(result.body?.["status"]).toBe("valid");
    expect(result.body?.["verification"]).toBe("verified");
    expect(result.body?.["companyName"]).toBe("Offline Corp");
    expect(result.body?.["userLimit"]).toBe(25);
    expect(result.body?.["activationMode"]).toBe("offline");
  });

  /*
   * No key is what marks the installation as offline-activated: it has
   * nothing to call home with, so the daily report and the boot refresh skip
   * it. The online usage figures are cleared rather than enforced forever.
   */
  it("stores the token without a key, mirrors the signed terms and clears the online usage", async () => {
    store.row!["enterpriseLicenseCurrentUserCount"] = 90;
    store.row!["enterpriseLicenseInstances"] = [{ instanceId: "x" }];
    const token: string = offlineToken({
      companyName: "Offline Corp",
      userLimit: 25,
      isEvaluation: true,
    });

    await callRoute(LICENSE_ROUTE, { licenseToken: token });

    const write: RecordedWrite = lastLicenseWrite();

    expect(write.props).toEqual({ isRoot: true, ignoreHooks: true });
    expect(write.data["enterpriseLicenseToken"]).toBe(token);
    expect(write.data["enterpriseLicenseKey"]).toBeNull();
    expect(write.data["enterpriseCompanyName"]).toBe("Offline Corp");
    expect(write.data["enterpriseLicenseUserLimit"]).toBe(25);
    expect(write.data["enterpriseLicenseIsEvaluation"]).toBe(true);
    expect(write.data["enterpriseLicenseCurrentUserCount"]).toBeNull();
    expect(write.data["enterpriseLicenseInstances"]).toEqual([]);
  });

  it("accepts a token bound to this instance", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY, {
        instanceId: INSTANCE_ID.toString(),
      }),
    });

    expect(result.error).toBeNull();
    expect(result.body?.["status"]).toBe("valid");
  });

  it("refuses a token bound to a different instance, and says which id to ask for", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY, {
        instanceId: "another-instance",
      }),
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("different OneUptime instance");
    expect(result.error?.message).toContain(INSTANCE_ID.toString());
    expect(store.licenseWrites()).toHaveLength(0);
  });

  /*
   * The token oneuptime.com hands an ONLINE installation is signed by the
   * same trusted key but bound to no instance, and GET /global-config/license
   * shows it to master admins. Accepting it here would let one online license
   * be pasted into any number of air-gapped installs, none of which reports
   * its usage.
   */
  it("refuses a verified token bound to no instance, and says which id to ask for", async () => {
    const unbound: string = signLicense(SIGNING_KEY);

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: unbound,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain(
      "not bound to a OneUptime instance",
    );
    expect(result.error?.message).toContain(INSTANCE_ID.toString());
    expect(result.error?.message).toContain("offline license token");
    expect(result.body).toBeNull();
    expect(API.post).not.toHaveBeenCalled();
    expect(store.licenseWrites()).toHaveLength(0);
    expect(store.row?.["enterpriseLicenseToken"]).toBe(legacyToken("stored"));
    expect(store.row?.["enterpriseLicenseKey"]).toBe(STORED_LICENSE_KEY);
  });

  it("refuses the online token of a valid license even inside its grace period", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY, { daysFromNow: -3 }),
    });

    expect(result.error?.message).toContain(
      "not bound to a OneUptime instance",
    );
    expect(store.licenseWrites()).toHaveLength(0);
  });

  /*
   * Negative control for the check above: the same claims, bound to this
   * instance, are accepted - so it is the missing binding that is refused,
   * not anything else about the token.
   */
  it("accepts the same claims once they are bound to this instance", async () => {
    const claims: Parameters<typeof signLicense>[1] = {
      companyName: "Bound Corp",
      userLimit: 12,
    };

    const unbound: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY, claims),
    });
    const bound: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: offlineToken(claims),
    });

    expect(unbound.error).toBeInstanceOf(BadDataException);
    expect(bound.error).toBeNull();
    expect(bound.body?.["companyName"]).toBe("Bound Corp");
    expect(bound.body?.["userLimit"]).toBe(12);
    expect(bound.body?.["activationMode"]).toBe("offline");
  });

  /*
   * A tampered token carries no trustworthy claims at all, so it is reported
   * as not valid rather than as unbound.
   */
  it("reports a tampered unbound token as not valid, not as unbound", async () => {
    const good: string = signLicense(SIGNING_KEY);
    const tampered: string = `${good.split(".").slice(0, 2).join(".")}.${
      signLicense(UNTRUSTED_KEY).split(".")[2]
    }`;

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: tampered,
    });

    expect(result.error?.message).toContain("not valid");
    expect(result.error?.message).not.toContain("not bound");
  });

  /*
   * An installation that predates instance ids has none stored. The id the
   * refusal quotes is the one a token must be issued for, so it is kept -
   * and a second attempt quotes the same id. The license itself is untouched.
   */
  it("keeps the instance id it quotes when the installation had none", async () => {
    store.row!["instanceId"] = undefined;

    const first: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY),
    });

    const storedId: string = String(store.row?.["instanceId"]);

    expect(first.error).toBeInstanceOf(BadDataException);
    expect(storedId.length).toBeGreaterThan(0);
    expect(storedId).not.toBe("undefined");
    expect(first.error?.message).toContain(storedId);
    expect(store.licenseWrites()).toHaveLength(1);
    expect(lastLicenseWrite().data).toEqual({
      instanceId: store.row?.["instanceId"],
    });
    expect(lastLicenseWrite().props).toEqual({
      isRoot: true,
      ignoreHooks: true,
    });
    expect(store.row?.["enterpriseLicenseToken"]).toBe(legacyToken("stored"));

    const second: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY),
    });

    // The id is stored now, so the second refusal writes nothing.
    expect(second.error?.message).toContain(storedId);
    expect(store.licenseWrites()).toHaveLength(1);
    expect(String(store.row?.["instanceId"])).toBe(storedId);

    // A token issued for the quoted id is then accepted.
    const accepted: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY, { instanceId: storedId }),
    });

    expect(accepted.error).toBeNull();
    expect(accepted.body?.["status"]).toBe("valid");
  });

  it("does not write anything for a refused token when the instance id is already stored", async () => {
    await callRoute(LICENSE_ROUTE, { licenseToken: signLicense(SIGNING_KEY) });
    await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY, {
        instanceId: "another-instance",
      }),
    });

    expect(store.licenseWrites()).toHaveLength(0);
  });

  /*
   * With an empty trust list every token is unverified. Accepting one here
   * would make this form a license forger.
   */
  it("refuses a token signed by a key this build does not trust", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(UNTRUSTED_KEY),
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain(
      "does not trust the key that signed this token",
    );
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("refuses everything while this build trusts no key at all", async () => {
    setTrustedLicenseKeysForTests([]);

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: signLicense(SIGNING_KEY),
    });

    expect(result.error?.message).toContain("does not trust the key");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("refuses a legacy HS256 token", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: legacyToken(),
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("does not trust the key");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("refuses a token whose signature does not verify", async () => {
    const good: string = signLicense(SIGNING_KEY);
    const tampered: string = `${good.split(".").slice(0, 2).join(".")}.${
      signLicense(UNTRUSTED_KEY).split(".")[2]
    }`;

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: tampered,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("not valid");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("refuses something that is not a license token", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: "definitely not a token",
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("not a OneUptime license token");
  });

  it("refuses an oversized paste before it can reach the database", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: `${"a".repeat(LICENSE_TOKEN_MAX_LENGTH)}.b.c`,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("refuses a token that expired past its grace period", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: offlineToken({ daysFromNow: -30 }),
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("expired");
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("accepts a token still inside its grace period", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: offlineToken({ daysFromNow: -3 }),
    });

    expect(result.error).toBeNull();
    expect(result.body?.["status"]).toBe("grace");
    expect(result.body?.["licenseValid"]).toBe(true);
  });

  it("ignores the whitespace and line breaks a copy-paste adds", async () => {
    const token: string = offlineToken();
    const wrapped: string = `\n  ${token.slice(0, 40)}\n${token.slice(40, 90)}\r\n${token.slice(90)}  \n`;

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: wrapped,
    });

    expect(result.error).toBeNull();
    expect(store.row?.["enterpriseLicenseToken"]).toBe(token);
  });

  it("refuses a request that sends both a key and a token", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
      licenseToken: signLicense(SIGNING_KEY),
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(API.post).not.toHaveBeenCalled();
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("refuses a token that is not a string", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: { alg: "none" } as unknown as JSONObject,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
  });
});

/*
 * The same pair of tokens the license server really issues, signed by the
 * real LicenseSigner with a key this build trusts: the online token (what
 * /validate answers an online installation with) is refused offline, and the
 * offline token issued for this instance is accepted.
 */
describe("POST /global-config/license - the license server's own tokens, offline", () => {
  const subject: LicenseTokenSubject = {
    licenseId: "license-0042",
    licenseKey: "OU-ENT-0042",
    companyName: "Signer Corp",
    userLimit: 30,
    isEvaluation: false,
    expiresAt: new Date(Date.now() + 200 * DAY_IN_MS),
  };

  beforeEach(() => {
    process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV] =
      SIGNING_KEY.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    LicenseSigner.resetForTests();
    LicenseSigner.init();
  });

  afterEach(() => {
    delete process.env[ENTERPRISE_LICENSE_SIGNING_PRIVATE_KEY_ENV];
    LicenseSigner.resetForTests();
  });

  it("signs with EdDSA in this setup, so the online token verifies here", () => {
    expect(LicenseSigner.isEdDsaEnabled()).toBe(true);
  });

  it("refuses the online token", async () => {
    const onlineToken: string | null = LicenseSigner.signOnlineToken(subject);

    expect(onlineToken).not.toBeNull();

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: onlineToken,
    });

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain(
      "not bound to a OneUptime instance",
    );
    expect(store.licenseWrites()).toHaveLength(0);
  });

  it("accepts the offline token issued for this instance", async () => {
    const token: string = LicenseSigner.signOfflineToken({
      subject,
      instanceId: INSTANCE_ID.toString(),
    });

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: token,
    });

    expect(result.error).toBeNull();
    expect(result.body?.["verification"]).toBe("verified");
    expect(result.body?.["companyName"]).toBe("Signer Corp");
    expect(result.body?.["activationMode"]).toBe("offline");
    expect(store.row?.["enterpriseLicenseToken"]).toBe(token);
  });

  it("refuses the offline token issued for another instance", async () => {
    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseToken: LicenseSigner.signOfflineToken({
        subject,
        instanceId: ObjectID.generate().toString(),
      }),
    });

    expect(result.error?.message).toContain("different OneUptime instance");
    expect(store.licenseWrites()).toHaveLength(0);
  });
});

/*
 * A license server that answers with a TOKEN and no expiresAt. Activation
 * (LicenseClient.mapValidationResponse) writes every term it was sent and
 * writes the expiry as null when none arrived, so this is the shortest path
 * to an installation holding a token with no expiry beside it.
 *
 * That state used to classify "invalid": activation refused outright, and an
 * installation that reached it some other way lost SSO, SCIM and audit
 * logging at once. It is now the unlicensed trial - a countdown, with the
 * reason and the message saying what is actually wrong.
 */
describe("a license-server response with a token and no expiry", () => {
  const payloadWithoutExpiry: () => JSONObject = (): JSONObject => {
    const payload: JSONObject = licenseServerPayload();
    delete payload["expiresAt"];
    return payload;
  };

  it("activates onto the trial instead of being refused, on an install inside its trial", async () => {
    store.row!["enterpriseLicenseToken"] = null;
    store.row!["enterpriseLicenseExpiresAt"] = null;
    store.row!["enterpriseEditionFirstSeenAt"] = new Date(
      Date.now() - 3 * DAY_IN_MS,
    );
    respondWith(payloadWithoutExpiry());

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
    });

    expect(result.error).toBeNull();
    expect(result.body?.["status"]).toBe("grace");
    expect(result.body?.["graceReason"]).toBe("unlicensed");
    expect(result.body?.["licenseValid"]).toBe(true);
    expect(store.row?.["enterpriseLicenseToken"]).toBe(
      legacyToken("from-server"),
    );
    expect(String(result.body?.["message"])).toContain(
      "no expiry is recorded for it",
    );
  });

  /*
   * The same response on an installation older than the trial: it is stored
   * (the license IS installed, it is the expiry that is missing) and the
   * install reads as lapsed rather than invalid, with the message naming the
   * problem. Before, activation threw "cannot use" and stored nothing.
   */
  it("is stored on an install past its trial, and reads as lapsed rather than invalid", async () => {
    store.row!["enterpriseLicenseToken"] = null;
    store.row!["enterpriseLicenseExpiresAt"] = null;
    respondWith(payloadWithoutExpiry());

    const result: CallResult = await callRoute(LICENSE_ROUTE, {
      licenseKey: STORED_LICENSE_KEY,
    });

    expect(result.error).toBeNull();
    expect(result.body?.["status"]).toBe("missing");
    expect(result.body?.["licenseValid"]).toBe(false);
    expect(String(result.body?.["message"])).toContain(
      "no expiry is recorded for it",
    );
  });

  /*
   * Activation answers 200 here on purpose - the license IS stored, and the
   * daily sync may yet complete it - so the only thing standing between a
   * master admin and a green "License validated successfully." while single
   * sign-on stays off is what this body says. It has to carry the verdict AND
   * the reason, for both sides of the trial.
   */
  it.each([
    ["inside its trial", 3 * DAY_IN_MS, "grace", true],
    ["past its trial", 400 * DAY_IN_MS, "missing", false],
  ])(
    "answers an activation %s with enough for the dialog to warn instead of celebrate",
    async (
      _label: string,
      firstSeenAgo: number,
      expectedStatus: string,
      expectedLicenseValid: boolean,
    ) => {
      store.row!["enterpriseLicenseToken"] = null;
      store.row!["enterpriseLicenseExpiresAt"] = null;
      store.row!["enterpriseEditionFirstSeenAt"] = new Date(
        Date.now() - firstSeenAgo,
      );
      respondWith(payloadWithoutExpiry());

      const result: CallResult = await callRoute(LICENSE_ROUTE, {
        licenseKey: STORED_LICENSE_KEY,
      });

      // Not a refusal: the token is stored either way.
      expect(result.error).toBeNull();
      expect(store.row?.["enterpriseLicenseToken"]).toBe(
        legacyToken("from-server"),
      );

      expect(result.body?.["status"]).toBe(expectedStatus);
      expect(result.body?.["licenseValid"]).toBe(expectedLicenseValid);
      /*
       * graceReason "unlicensed" is what tells the dialog that this "grace" is
       * the trial and not a license's own grace period - without it, an
       * activation inside the trial looks like a perfectly good license in
       * grace and would still be reported as a success.
       */
      expect(result.body?.["graceReason"]).toBe(
        expectedStatus === "grace" ? "unlicensed" : null,
      );

      const message: string = String(result.body?.["message"]);

      expect(message).toContain("no expiry is recorded for it");
      expect(message).toContain("re-activate the license");
    },
  );

  /*
   * The never-downgrade rule doing its job on the same response: a refresh
   * must not swap a working license for one with no expiry, whatever the
   * new classification ranks as.
   */
  it("cannot replace a working license through a refresh", async () => {
    const installed: string = store.row?.[
      "enterpriseLicenseToken"
    ] as string;
    const expiresAt: Date = store.row?.[
      "enterpriseLicenseExpiresAt"
    ] as Date;
    respondWith(payloadWithoutExpiry());

    const result: CallResult = await callRoute(LICENSE_REFRESH_ROUTE);

    expect(result.error).toBeInstanceOf(BadDataException);
    expect(result.error?.message).toContain("The installed license was kept.");
    expect(store.row?.["enterpriseLicenseToken"]).toBe(installed);
    expect(store.row?.["enterpriseLicenseExpiresAt"]).toBe(expiresAt);
  });
});
