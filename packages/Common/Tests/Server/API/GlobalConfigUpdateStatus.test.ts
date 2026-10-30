import GlobalConfigAPI, {
  UPDATE_STATUS_CONFIG_SELECT,
} from "../../../Server/API/GlobalConfigAPI";
import MasterAdminAuthorization from "../../../Server/Middleware/MasterAdminAuthorization";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import Response from "../../../Server/Utils/Response";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import SecurityAdvisoryUtil, {
  SecurityAdvisorySeverity,
} from "../../../Types/UpdateCheck/SecurityAdvisory";
import UpdateCheckFailure from "../../../Types/UpdateCheck/UpdateCheckFailure";
import UpdateStatusUtil, {
  AffectingAdvisory,
  UpdateState,
  UpdateStatus,
} from "../../../Types/UpdateCheck/UpdateStatus";
import {
  NextFunction,
  OneUptimeRequest,
  OneUptimeResponse,
} from "../../../Server/Utils/Express";
import { mockRouter } from "./Helpers";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * GET /global-config/update-status: whether this installation should be
 * upgraded, and why, for the footers' pill and the Admin Dashboard's
 * security notice.
 *
 *   - Only a master admin may read it: they are the ones who can upgrade,
 *     and telling anybody else that the server runs a version with a known
 *     security issue advertises an unpatched target. Nobody signed in is
 *     asked to sign in; a signed-in user who is no master admin is refused.
 *   - It is worked out from what the daily check stored and the version this
 *     process runs now, so an upgrade clears a security notice at once, and
 *     no browser ever calls GitHub.
 *   - OneUptime Cloud is never told to upgrade itself: nothing is read.
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
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

// CI's config.env sets BILLING_ENABLED=true; this suite pins it per test.
jest.mock("../../../Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  const mocked: Record<string, unknown> = billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );

  // The version this process runs, per test (APP_VERSION).
  Object.defineProperty(mocked, "AppVersion", {
    enumerable: true,
    get: (): unknown => {
      return (globalThis as unknown as Record<string, unknown>)[
        "__updateStatusTestAppVersion"
      ];
    },
  });

  return mocked;
});

const setAppVersion: (version: string) => void = (version: string): void => {
  (globalThis as unknown as Record<string, unknown>)[
    "__updateStatusTestAppVersion"
  ] = version;
};

jest.mock("../../../Server/Services/GlobalConfigService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: jest.fn(),
      updateOneById: jest.fn(),
    },
  };
});

const ROUTE: string = "/global-config/update-status";

// An advisory that affects every version a test can run.
const AFFECTING_EVERYTHING: JSONObject = SecurityAdvisoryUtil.toJSON({
  ghsaId: "GHSA-aaaa-bbbb-cccc",
  cveId: "CVE-2026-0001",
  summary: "Every version is affected",
  severity: SecurityAdvisorySeverity.Critical,
  url: "https://github.com/OneUptime/oneuptime/security/advisories/GHSA-aaaa-bbbb-cccc",
  publishedAt: "2026-10-01T00:00:00.000Z",
  vulnerabilities: [
    { vulnerableVersionRange: "< 999.0.0", patchedVersions: "999.0.0" },
  ],
});

const storedConfig: (overrides?: Partial<GlobalConfig>) => GlobalConfig = (
  overrides?: Partial<GlobalConfig>,
): GlobalConfig => {
  const config: GlobalConfig = new GlobalConfig();
  config.id = ObjectID.getZeroObjectID();
  config.latestReleaseVersion = "999.0.0";
  config.latestReleasePublishedAt = new Date("2026-10-20T00:00:00.000Z");
  config.latestReleaseCheckedAt = new Date("2026-10-30T08:00:00.000Z");
  config.securityAdvisories = [AFFECTING_EVERYTHING];
  config.securityAdvisoriesCheckedAt = new Date("2026-10-30T08:00:01.000Z");
  config.updateCheckLastAttemptAt = new Date("2026-10-30T08:00:00.000Z");
  return Object.assign(config, overrides || {});
};

describe("GET /global-config/update-status", () => {
  let request: OneUptimeRequest;
  let response: OneUptimeResponse;
  let next: NextFunction;

  const callHandler: () => Promise<UpdateStatus> =
    async (): Promise<UpdateStatus> => {
      await mockRouter
        .match("get", ROUTE)
        .handlerFunction(request, response, next);

      expect(next).not.toHaveBeenCalled();

      const calls: Array<Array<unknown>> = (
        Response.sendJsonObjectResponse as unknown as jest.Mock
      ).mock.calls as Array<Array<unknown>>;

      expect(calls).toHaveLength(1);

      return UpdateStatusUtil.fromJSON(calls[0]![2]) as UpdateStatus;
    };

  beforeEach(() => {
    jest.clearAllMocks();
    mockRouter.routes = [];
    setTestBillingEnabled(false);
    setAppVersion("14.0.60");

    new GlobalConfigAPI();

    (GlobalConfigService.findOneById as jest.Mock).mockResolvedValue(
      storedConfig() as never,
    );

    request = { body: {}, query: {} } as unknown as OneUptimeRequest;
    response = {
      send: jest.fn(),
      json: jest.fn(),
      status: jest.fn().mockReturnThis(),
    } as unknown as OneUptimeResponse;
    next = jest.fn();
  });

  afterEach(() => {
    setTestBillingEnabled(false);
    jest.restoreAllMocks();
  });

  describe("who may read it", () => {
    it("is behind the master admin check, and nothing else", () => {
      expect(mockRouter.match("get", ROUTE).middlewares).toEqual([
        MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware,
      ]);
    });

    const runMiddleware: (session: unknown) => Promise<{
      error: Exception | null;
      passed: boolean;
    }> = async (session: unknown) => {
      jest
        .spyOn(UserMiddleware, "readRequestSession")
        .mockResolvedValue(session as never);

      const passed: jest.Mock = jest.fn();

      await MasterAdminAuthorization.isAuthorizedMasterAdminMiddleware(
        request,
        response,
        passed as unknown as NextFunction,
      );

      const errorCalls: Array<Array<unknown>> = (
        Response.sendErrorResponse as unknown as jest.Mock
      ).mock.calls as Array<Array<unknown>>;

      return {
        error: errorCalls.length > 0 ? (errorCalls[0]![2] as Exception) : null,
        passed: passed.mock.calls.length > 0,
      };
    };

    it("asks somebody who is not signed in to sign in", async () => {
      const result: { error: Exception | null; passed: boolean } =
        await runMiddleware({ kind: "none" });

      expect(result.passed).toBe(false);
      expect(result.error).toBeInstanceOf(NotAuthenticatedException);
    });

    it("refuses a signed-in user who is no master admin", async () => {
      const result: { error: Exception | null; passed: boolean } =
        await runMiddleware({
          kind: "user",
          session: { userId: ObjectID.generate(), isMasterAdmin: false },
        });

      expect(result.passed).toBe(false);
      expect(result.error).toBeInstanceOf(NotAuthorizedException);
    });

    it("lets a master admin through", async () => {
      const result: { error: Exception | null; passed: boolean } =
        await runMiddleware({
          kind: "user",
          session: { userId: ObjectID.generate(), isMasterAdmin: true },
        });

      expect(result).toEqual({ error: null, passed: true });
    });

    it("refuses a blocked master admin", async () => {
      const result: { error: Exception | null; passed: boolean } =
        await runMiddleware({
          kind: "blocked",
          session: { userId: ObjectID.generate(), isMasterAdmin: true },
        });

      expect(result.passed).toBe(false);
      expect(result.error).not.toBeNull();
    });
  });

  describe("what it answers", () => {
    it("reads only the update check's columns, as OneUptime itself", async () => {
      await callHandler();

      expect(GlobalConfigService.findOneById).toHaveBeenCalledWith({
        id: ObjectID.getZeroObjectID(),
        select: UPDATE_STATUS_CONFIG_SELECT,
        props: { isRoot: true },
      });
      expect(Object.keys(UPDATE_STATUS_CONFIG_SELECT).sort()).toEqual(
        [
          "latestReleaseCheckedAt",
          "latestReleasePublishedAt",
          "latestReleaseVersion",
          "securityAdvisories",
          "securityAdvisoriesCheckedAt",
          "updateCheckLastAttemptAt",
          "updateCheckLastFailure",
        ].sort(),
      );
    });

    it("never hands out which advisories were emailed, or anything not about upgrading", async () => {
      await callHandler();

      const body: JSONObject = (
        (Response.sendJsonObjectResponse as unknown as jest.Mock).mock
          .calls[0] as Array<unknown>
      )[2] as JSONObject;

      expect(Object.keys(body).sort()).toEqual(
        [
          "advisories",
          "advisoriesCheckedAt",
          "currentVersion",
          "isMajorUpgrade",
          "isUpdateAvailable",
          "isUpdateCheckDisabled",
          "isVersionComparable",
          "lastCheckAttemptedAt",
          "lastCheckFailure",
          "latestVersion",
          "latestVersionCheckedAt",
          "latestVersionPublishedAt",
          "recommendedVersion",
          "state",
        ].sort(),
      );
    });

    it("works out a security update from what is stored and the version that runs", async () => {
      const status: UpdateStatus = await callHandler();

      expect(status.currentVersion).toBe("14.0.60");
      expect(status.state).toBe(UpdateState.SecurityUpdate);
      expect(status.recommendedVersion).toBe("999.0.0");
      expect(
        status.advisories.map((advisory: AffectingAdvisory): string => {
          return advisory.ghsaId;
        }),
      ).toEqual(["GHSA-aaaa-bbbb-cccc"]);
      expect(status.advisoriesCheckedAt).toBe("2026-10-30T08:00:01.000Z");
    });

    it("says why the last check failed, with the last good answer", async () => {
      (GlobalConfigService.findOneById as jest.Mock).mockResolvedValue(
        storedConfig({
          updateCheckLastAttemptAt: new Date("2026-10-31T08:00:00.000Z"),
          updateCheckLastFailure: UpdateCheckFailure.RateLimited,
        }) as never,
      );

      const status: UpdateStatus = await callHandler();

      expect(status.lastCheckFailure).toBe(UpdateCheckFailure.RateLimited);
      expect(status.lastCheckAttemptedAt).toBe("2026-10-31T08:00:00.000Z");
    });

    it("says nothing about a build that reports no release version", async () => {
      setAppVersion("unknown");

      const status: UpdateStatus = await callHandler();

      expect(status.currentVersion).toBe("unknown");
      expect(status.isVersionComparable).toBe(false);
      expect(status.state).toBe(UpdateState.Unknown);
      expect(status.advisories).toEqual([]);
    });

    it("clears the notice the moment an upgrade past the fix starts", async () => {
      setAppVersion("999.0.0");

      const status: UpdateStatus = await callHandler();

      expect(status.state).toBe(UpdateState.UpToDate);
      expect(status.advisories).toEqual([]);
    });

    it("answers with nothing to say before the first check, without failing", async () => {
      (GlobalConfigService.findOneById as jest.Mock).mockResolvedValue(
        null as never,
      );

      const status: UpdateStatus = await callHandler();

      expect(status.state).toBe(UpdateState.Unknown);
      expect(status.advisories).toEqual([]);
      expect(status.latestVersion).toBeNull();
    });

    it("hands a failed read to the error handler", async () => {
      const failure: Error = new Error("database is down");

      (GlobalConfigService.findOneById as jest.Mock).mockRejectedValue(
        failure as never,
      );

      await mockRouter
        .match("get", ROUTE)
        .handlerFunction(request, response, next);

      expect(next).toHaveBeenCalledWith(failure);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });
  });

  describe("on OneUptime Cloud", () => {
    it("reads nothing and says nothing: Cloud is not told to upgrade itself", async () => {
      setTestBillingEnabled(true);

      const status: UpdateStatus = await callHandler();

      expect(GlobalConfigService.findOneById).not.toHaveBeenCalled();
      expect(status.state).toBe(UpdateState.Unknown);
      expect(status.advisories).toEqual([]);
      expect(status.isUpdateAvailable).toBe(false);
    });
  });
});

describe("buildUpdateStatusResponse", () => {
  afterEach(() => {
    setTestBillingEnabled(false);
  });

  it("follows the version that runs now, not the one that ran when the check stored the advisories", () => {
    setTestBillingEnabled(false);
    setAppVersion("14.0.60");

    const body: JSONObject = GlobalConfigAPI.buildUpdateStatusResponse(
      storedConfig({
        securityAdvisories: [
          SecurityAdvisoryUtil.toJSON({
            ...SecurityAdvisoryUtil.fromJSON(AFFECTING_EVERYTHING)!,
            vulnerabilities: [
              { vulnerableVersionRange: "< 0.0.1", patchedVersions: "0.0.1" },
            ],
          }),
        ],
      }),
    );

    expect(UpdateStatusUtil.fromJSON(body)?.advisories).toEqual([]);
  });
});
