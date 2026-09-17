import BaseAPI from "../../../Server/API/BaseAPI";
import ApiKeyPermissionService from "../../../Server/Services/ApiKeyPermissionService";
import ApiKeyService from "../../../Server/Services/ApiKeyService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import ProjectService from "../../../Server/Services/ProjectService";
import JSONWebToken from "../../../Server/Utils/JsonWebToken";
import {
  ExpressResponse,
  NextFunction,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import { mockRouter } from "./Helpers";
import LogPipeline from "../../../Models/DatabaseModels/LogPipeline";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import BadDataException from "../../../Types/Exception/BadDataException";
import Exception from "../../../Types/Exception/Exception";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { beforeEach, describe, expect, it, jest } from "@jest/globals";

/*
 * PasswordHash has a known, pre-existing TS5.9 compile failure under ts-jest
 * (Buffer vs BinaryLike) that breaks every suite whose import graph reaches
 * it. Nothing here touches password hashing; stub the module before the
 * service import graph drags it into compilation.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: class PasswordHashStub {},
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
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * Issue #3004: a caller sent a valid project API key to
 * POST /api/log-pipeline/get-list and got
 * 401 {"error":"A user should be logged in to read record of Log Pipeline."}
 * They read that as a broken RBAC path on Log Pipeline specifically.
 *
 * It was neither Log-Pipeline-specific nor an RBAC failure. That message was
 * what the codebase produced for ANY request it had already decided was
 * anonymous - and a request whose `ApiKey` header arrived empty or malformed
 * was decided to be anonymous, because the "does this caller present a key"
 * test asked whether the key was USABLE rather than whether it was PRESENT.
 * The caller was then told to log in (they never tried to) about a model
 * (which was never the problem). Issue #1754 is the same string on a
 * different model.
 *
 * Nothing below is Log-Pipeline-specific. This is the generic CRUD auth
 * contract of every model registered through BaseAPI; LogPipeline is here
 * only because it is the resource named in the report, and the control block
 * at the bottom re-runs the two decisive cases against Monitor to show the
 * outcome does not depend on the model.
 *
 * The whole real chain runs: the route's own middleware is
 * UserMiddleware.getUserMiddleware, which routes to
 * ProjectMiddleware.isValidProjectIdAndApiKeyMiddleware, and the handler runs
 * the real DatabaseService read with the real permission pipeline. Only the
 * TypeORM repository and the three lookup services are stubbed.
 *
 * On the status codes asserted here: every failure below leaves via
 * `next(err)`, and Express's error handler in Server/Utils/StartServer.ts
 * answers `res.status(err.code).send({ error: err.message })`. So the
 * exception's `code` IS the HTTP status the caller sees -
 * BadDataException=400, NotAuthenticatedException=401,
 * NotAuthorizedException=422 (Types/Exception/ExceptionCode.ts).
 */

/*
 * Any hex UUID is accepted by ObjectID.isValidUUID (any version,
 * case-insensitive), so these only have to be well formed.
 */
const API_KEY_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const KNOWN_API_KEY: string = "33333333-3333-4333-8333-333333333333";
const UNKNOWN_API_KEY: string = "44444444-4444-4444-8444-444444444444";

/*
 * A project the key does NOT belong to, used only to prove a caller-supplied
 * `tenantid` header cannot redirect a key at another project.
 */
const OTHER_PROJECT_ID: string = "55555555-5555-4555-8555-555555555555";

/*
 * Registered once, at module load, because mockRouter.match returns the FIRST
 * route with a given method+uri and that route closes over the instance that
 * registered it. Re-registering per test would leave the matched route
 * pointing at a stale service that the per-test spies never touch.
 */
const logPipelineService: DatabaseService<LogPipeline> =
  new DatabaseService<LogPipeline>(LogPipeline);
const logPipelineApi: BaseAPI<
  LogPipeline,
  DatabaseService<LogPipeline>
> = new BaseAPI<LogPipeline, DatabaseService<LogPipeline>>(
  LogPipeline,
  logPipelineService,
);

const monitorService: DatabaseService<Monitor> = new DatabaseService<Monitor>(
  Monitor,
);
const monitorApi: BaseAPI<Monitor, DatabaseService<Monitor>> = new BaseAPI<
  Monitor,
  DatabaseService<Monitor>
>(Monitor, monitorService);

const LOG_PIPELINE_PATH: string = new logPipelineApi.entityType()
  .getCrudApiPath()!
  .toString();

const MONITOR_PATH: string = new monitorApi.entityType()
  .getCrudApiPath()!
  .toString();

/*
 * Stands in for the TypeORM repository so the read stops at the DB boundary
 * and everything above it - permission checks included - is the real thing.
 * Mocking service.findBy instead would delete the very checks under test.
 */
type RepositoryStub = {
  find: () => Promise<Array<never>>;
  count: () => Promise<number>;
};

const repository: RepositoryStub = {
  find: (): Promise<Array<never>> => {
    return Promise.resolve([]);
  },
  count: (): Promise<number> => {
    return Promise.resolve(0);
  },
};

type HeaderBag = Record<string, string | Array<string> | undefined>;

type RouteOutcome = {
  error: Exception | null;
  request: OneUptimeRequest;
};

type CallGetListFunction = (data: {
  crudApiPath: string;
  headers: HeaderBag;
}) => Promise<RouteOutcome>;

/*
 * Drives the registered POST /<model>/get-list route the way Express would:
 * middleware first, then - only if the middleware did not hand an error to
 * next() - the handler. Both report failure through next(err).
 */
const callGetList: CallGetListFunction = async (data: {
  crudApiPath: string;
  headers: HeaderBag;
}): Promise<RouteOutcome> => {
  const route: ReturnType<typeof mockRouter.match> = mockRouter.match(
    "POST",
    `${data.crudApiPath}/get-list`,
  );

  const request: OneUptimeRequest = {
    headers: data.headers,
    params: {},
    query: {},
    body: { query: {}, select: { _id: true }, sort: {} },
  } as unknown as OneUptimeRequest;

  const response: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const captured: { error: Exception | null } = { error: null };

  const next: NextFunction = ((error?: unknown): void => {
    if (error) {
      captured.error = error as Exception;
    }
  }) as unknown as NextFunction;

  await route.middleware(request, response, next);

  if (!captured.error) {
    await route.handlerFunction(request, response, next);
  }

  return { error: captured.error, request: request };
};

describe("BaseAPI CRUD auth contract for the ApiKey header (issue #3004)", () => {
  let repositoryFind: ReturnType<typeof getJestSpyOn>;
  let findApiKey: ReturnType<typeof getJestSpyOn>;
  let findApiKeyPermissions: ReturnType<typeof getJestSpyOn>;
  let decodeAccessToken: ReturnType<typeof getJestSpyOn>;

  type GrantPermissionFunction = (permission: Permission) => void;

  /*
   * Makes KNOWN_API_KEY resolve to a key on PROJECT_ID carrying exactly one
   * permission. isBlockPermission has to be an explicit false: getUserPermissions
   * keeps a row only when `isBlockPermission === (permissionType === Block)`, so
   * an undefined here silently drops the grant and turns a 200 into a 422.
   */
  const grantApiKeyPermission: GrantPermissionFunction = (
    permission: Permission,
  ): void => {
    findApiKey.mockResolvedValue({ id: API_KEY_ID, projectId: PROJECT_ID });

    findApiKeyPermissions.mockResolvedValue([
      {
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      },
    ]);
  };

  beforeEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();

    repositoryFind = getJestSpyOn(repository, "find");

    getJestSpyOn(logPipelineService, "getRepository").mockReturnValue(
      repository,
    );
    getJestSpyOn(monitorService, "getRepository").mockReturnValue(repository);

    // Default: no key in the table, no permissions, and no master key configured.
    findApiKey = getJestSpyOn(ApiKeyService, "findApiKey").mockResolvedValue(
      null,
    );
    findApiKeyPermissions = getJestSpyOn(
      ApiKeyPermissionService,
      "findPermissionsByApiKeyId",
    ).mockResolvedValue([]);
    getJestSpyOn(GlobalConfigService, "findOneBy").mockResolvedValue(null);

    /*
     * getUserMiddleware fires this off (unawaited) whenever a `tenantid`
     * header is present. It is a write we never assert on; stubbing it keeps
     * a stray Postgres round-trip from landing after the test has finished.
     */
    getJestSpyOn(ProjectService, "updateLastActive").mockResolvedValue(
      undefined,
    );

    /*
     * getDatabaseCommonInteractionProps reads the project's billing plan on
     * every request that resolved a tenant, but ONLY when BILLING_ENABLED is
     * set - and the Common Test CI job sets it while a bare local jest run
     * does not. Unstubbed, that is a real ProjectService.findOneById on a
     * service this file never stubs, so the five cases that get as far as a
     * tenant died with "Database not connected" in CI and passed locally.
     *
     * Answering as the no-plan project keeps the auth contract below reading
     * the same either way: BillingPermissions short-circuits on an undefined
     * currentPlan, which is exactly the billing-disabled path.
     */
    getJestSpyOn(ProjectService, "getCurrentPlan").mockResolvedValue({
      plan: null,
      isSubscriptionUnpaid: false,
    });

    /*
     * Never stubbed to succeed - it exists so tests can assert whether the
     * session branch of getUserMiddleware was entered at all. Reaching it is
     * always the regression, never the expectation.
     */
    decodeAccessToken = getJestSpyOn(JSONWebToken, "decode");
  });

  it("registers the route the issue reported against", () => {
    expect(LOG_PIPELINE_PATH).toBe("/log-pipeline");
    expect(
      mockRouter.match("POST", `${LOG_PIPELINE_PATH}/get-list`),
    ).toBeTruthy();
  });

  describe("A) no ApiKey header at all", () => {
    /*
     * The genuinely anonymous request - no key, no session. This is the one
     * case where the "authenticate first" answer is correct, and it must name
     * BOTH accepted credentials so an API caller who reads it is not sent off
     * to audit session login or the model's roles. The old wording
     * ("A user should be logged in to read record of Log Pipeline.") is what
     * made #3004 and #1754 look like per-model RBAC bugs.
     */
    it("answers 401 naming both a session and an API key", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: {},
      });

      expect(outcome.error).toBeInstanceOf(NotAuthenticatedException);
      expect(outcome.error?.message).toBe(
        "Authenticated user or a valid API key is needed to read record of Log Pipeline.",
      );
      expect(outcome.error?.code).toBe(401);
      expect(outcome.error?.message).not.toContain("should be logged in");
      expect(repositoryFind).not.toHaveBeenCalled();
      expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
    });
  });

  describe("B) ApiKey header present but empty", () => {
    /*
     * THE #3004 FIX, stated as an assertion.
     *
     * Before it, an empty header was "no usable key" and therefore treated as
     * "no key", so the request fell through to the anonymous path and produced
     * case A above: a 401 about logging in, naming Log Pipeline. An unset shell
     * variable, a client that serializes a missing credential as "", and our own
     * CLI's partial-credential path all land here.
     *
     * Presence now claims the request for the API-key branch, so it fails where
     * the caller actually went wrong: 400 Invalid API Key.
     */
    it("answers 400 Invalid API Key instead of the anonymous 401", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "" },
      });

      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect(outcome.error?.message).toBe("Invalid API Key");
      expect(outcome.error?.code).toBe(400);
    });

    it("does not mention logging in, or the model, for a key problem", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "" },
      });

      expect(outcome.error?.message).not.toContain("logged in");
      expect(outcome.error?.message).not.toContain("Log Pipeline");
      expect(outcome.error).not.toBeInstanceOf(NotAuthenticatedException);
    });

    /*
     * Where the request is decided, not just what it is told.
     *
     * The empty key must be claimed by the API-key branch: the request is
     * never classified as an anonymous `Public` caller (which is exactly what
     * the pre-fix `hasApiKey` did to it, and the only reason the permission
     * layer ever saw it), and it never reaches the key table either, because
     * "" is not a lookup-able value. Nothing is disclosed and no response is
     * written - the failure leaves via next(err).
     *
     * Stopping at "no rows were read" would not have pinned this down: the
     * old anonymous path did not read any rows either, it just failed later
     * and in the wrong words.
     */
    it("is claimed by the API key branch rather than treated as an anonymous caller", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "" },
      });

      expect(outcome.request.userType).not.toBe(UserType.Public);
      expect(findApiKey).not.toHaveBeenCalled();
      expect(repositoryFind).not.toHaveBeenCalled();
      expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
    });

    /*
     * Which credential wins when the caller presents two.
     *
     * This is the one behaviour the presence-vs-usability change alters for
     * callers who were NOT broken before: a request carrying a session token
     * AND a blank `ApiKey` header used to ignore the blank header and
     * authenticate by session; now the key branch claims it and it fails 400.
     * That is the intended reading - a credential that was sent and is
     * unusable is an error, not something to silently paper over with another
     * credential, because the alternative is a caller whose key has quietly
     * stopped being used and who has no way to find out.
     *
     * It is asserted rather than left implicit because it is the change most
     * likely to be "fixed" back by someone who sees only half the picture
     * (e.g. re-gating line ~303 of UserAuthorization on getApiKey, or on the
     * absence of an access token). Both of those rewrites reach
     * JSONWebToken.decode, which is exactly what this pins shut.
     */
    it("prefers the malformed key over a session token rather than silently falling back", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "", authorization: "Bearer some.session.token" },
      });

      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect(outcome.error?.message).toBe("Invalid API Key");
      expect(outcome.error?.code).toBe(400);

      // The session branch was never entered, so no token was ever decoded.
      expect(decodeAccessToken).not.toHaveBeenCalled();
      expect(outcome.request.userType).not.toBe(UserType.Public);
      expect(repositoryFind).not.toHaveBeenCalled();
    });
  });

  describe("C) whitespace-only ApiKey header", () => {
    /*
     * `ApiKey: $ONEUPTIME_API_KEY` with the variable unset arrives as spaces,
     * not as an absent header. Trimming makes it empty, so it is the same
     * malformed-key failure as B - not the anonymous 401.
     */
    it("answers 400 Invalid API Key", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "   " },
      });

      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect(outcome.error?.message).toBe("Invalid API Key");
      expect(outcome.error?.code).toBe(400);
      expect(repositoryFind).not.toHaveBeenCalled();
    });
  });

  describe("D) non-UUID ApiKey header", () => {
    /*
     * ApiKey.apiKey is a Postgres `uuid` column. A non-UUID value used to be
     * handed straight to the lookup, which raised 22P02 "invalid input syntax
     * for type uuid" as a raw QueryFailedError - not a OneUptime Exception, so
     * it slipped past the error translator and answered 500 to what is really a
     * malformed request. The shape is rejected before the query now, which is
     * why findApiKey must not be called at all.
     */
    it("answers 400 Invalid API Key without ever querying the key table", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "not-a-uuid" },
      });

      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect(outcome.error?.message).toBe("Invalid API Key");
      expect(outcome.error?.code).toBe(400);
      expect(findApiKey).not.toHaveBeenCalled();
      expect(outcome.error?.code).not.toBe(500);
    });

    /*
     * A caller that sets the header twice. Node normally collapses repeated
     * headers into one comma-separated value, and IncomingHttpHeaders also
     * types a header as string[]; the middleware handles both by joining
     * before it validates. Either way it is never a usable key - but it is
     * unmistakably someone authenticating by key, so it has to be claimed as a
     * key problem rather than fall through to the anonymous 401.
     */
    it("treats a duplicated ApiKey header as a malformed key, not as an absent one", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: [KNOWN_API_KEY, UNKNOWN_API_KEY] },
      });

      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect(outcome.error?.message).toBe("Invalid API Key");
      expect(outcome.error?.code).toBe(400);
      expect(findApiKey).not.toHaveBeenCalled();
    });
  });

  describe("E) well-formed but unknown API key", () => {
    /*
     * A key that is the right shape but is not in the table (revoked, expired,
     * or from another install) and is not the instance master key. Same 400 as
     * a malformed one: the API deliberately does not distinguish "wrong shape"
     * from "unknown key" to a caller.
     */
    it("answers 400 Invalid API Key after the lookup misses", async () => {
      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: UNKNOWN_API_KEY },
      });

      expect(findApiKey).toHaveBeenCalledTimes(1);
      expect(outcome.error).toBeInstanceOf(BadDataException);
      expect(outcome.error?.message).toBe("Invalid API Key");
      expect(outcome.error?.code).toBe(400);
      expect(repositoryFind).not.toHaveBeenCalled();
    });
  });

  describe("F) valid key holding a permission the model accepts", () => {
    /*
     * TelemetryAdmin is in LogPipeline's read list. The request must reach the
     * handler and complete: this is the case the reporter believed was broken,
     * and it is what proves the 401 they saw was about the header never
     * arriving, not about the key's roles.
     */
    it("reaches the handler and returns the list", async () => {
      grantApiKeyPermission(Permission.TelemetryAdmin);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: KNOWN_API_KEY },
      });

      expect(outcome.error).toBeNull();
      expect(repositoryFind).toHaveBeenCalledTimes(1);
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);
    });

    /*
     * The tenant is taken from the KEY, and the caller is typed as an API
     * principal - that UserType.API is what lets the logged-in check in
     * PublicPermission return early instead of throwing case A at a caller
     * who has no userId and never will.
     */
    it("scopes the request to the key's own project and marks it an API caller", async () => {
      grantApiKeyPermission(Permission.TelemetryAdmin);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: KNOWN_API_KEY },
      });

      expect(outcome.request.userType).toBe(UserType.API);
      expect(outcome.request.tenantId?.toString()).toBe(PROJECT_ID.toString());
    });

    /*
     * ...and never from a caller-supplied header. getUserMiddleware sets
     * req.tenantId from the `tenantid` header before it has looked at the key
     * at all, so the key's own projectId has to overwrite it - otherwise a key
     * for project A would be evaluated against project B's id just because the
     * caller said so, and the key's permissions (registered under its real
     * project) would not be found for the claimed one.
     */
    it("ignores a tenantid header that points at a different project", async () => {
      grantApiKeyPermission(Permission.TelemetryAdmin);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: KNOWN_API_KEY, tenantid: OTHER_PROJECT_ID },
      });

      expect(outcome.request.tenantId?.toString()).toBe(PROJECT_ID.toString());
      expect(outcome.request.tenantId?.toString()).not.toBe(OTHER_PROJECT_ID);
      expect(outcome.error).toBeNull();
      expect(repositoryFind).toHaveBeenCalledTimes(1);
    });

    /*
     * A padded value is a usable key, not a malformed one - trimming happens
     * before validation, so a header that picked up whitespace still works.
     * The lookup has to receive the TRIMMED value: the padded string is not a
     * valid uuid literal, so passing it through would raise 22P02 in the query
     * layer and answer 500 to a request that was only untidy.
     */
    it("trims a key padded with whitespace instead of querying the padded value", async () => {
      grantApiKeyPermission(Permission.TelemetryAdmin);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: `  ${KNOWN_API_KEY}  ` },
      });

      expect(findApiKey).toHaveBeenCalledWith(new ObjectID(KNOWN_API_KEY));
      expect(outcome.error).toBeNull();
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe("G) valid key holding ProjectAdmin", () => {
    // A second accepted permission, so F is not passing off one lucky enum.
    it("reaches the handler and returns the list", async () => {
      grantApiKeyPermission(Permission.ProjectAdmin);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: KNOWN_API_KEY },
      });

      expect(outcome.error).toBeNull();
      expect(repositoryFind).toHaveBeenCalledTimes(1);
      expect(Response.sendEntityArrayResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe("H) valid key holding an unrelated permission", () => {
    /*
     * This is what a real per-model RBAC failure looks like, and it is nothing
     * like what #3004 saw: 422, not 401; it names the operation and the model
     * AND lists the permissions that would have worked, so the key's owner can
     * fix it. If the reported bug had been what it appeared to be, this is the
     * response they would have received.
     */
    it("answers 422 listing the permissions that would have worked", async () => {
      grantApiKeyPermission(Permission.CreateProjectApiKey);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: KNOWN_API_KEY },
      });

      expect(outcome.error).toBeInstanceOf(NotAuthorizedException);
      expect(outcome.error?.code).toBe(422);
      expect(outcome.error?.message).toContain(
        "You do not have permissions to read Log Pipeline",
      );
      expect(outcome.error?.message).toContain(
        "You need one of these permissions:",
      );
      expect(outcome.error?.message).toContain("Telemetry Admin");
      expect(Response.sendEntityArrayResponse).not.toHaveBeenCalled();
    });

    /*
     * An authenticated key that lacks a role is never reported as
     * unauthenticated. The request must still be refused - asserting only the
     * two negatives would pass if the read had been allowed through, so the
     * refusal itself is asserted first.
     */
    it("does not answer the anonymous 401 for an authenticated key", async () => {
      grantApiKeyPermission(Permission.CreateProjectApiKey);

      const outcome: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: KNOWN_API_KEY },
      });

      expect(outcome.error).not.toBeNull();
      expect(repositoryFind).not.toHaveBeenCalled();
      expect(outcome.error).not.toBeInstanceOf(NotAuthenticatedException);
      expect(outcome.error?.code).not.toBe(401);
      expect(outcome.error?.message).not.toContain("needed to read record of");
    });
  });

  /*
   * I) CONTROL.
   *
   * The issue premise was that the fault was "specific to the Log Pipeline CRUD
   * authentication path". Monitor is registered through the same BaseAPI in the
   * same way and behaves identically - same exception, same status, same
   * wording apart from the model name. One run of this block refutes that
   * premise: nothing above belongs to Log Pipeline.
   */
  describe("I) control: a different model registered the same way", () => {
    it("answers the same 401 with no ApiKey header, differing only in the model name", async () => {
      const logPipeline: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: {},
      });

      const monitor: RouteOutcome = await callGetList({
        crudApiPath: MONITOR_PATH,
        headers: {},
      });

      expect(monitor.error).toBeInstanceOf(NotAuthenticatedException);
      expect(monitor.error?.code).toBe(401);
      expect(monitor.error?.message).toBe(
        "Authenticated user or a valid API key is needed to read record of Monitor.",
      );

      expect(monitor.error?.message.replace("Monitor", "Log Pipeline")).toBe(
        logPipeline.error?.message,
      );
      expect(monitor.error?.code).toBe(logPipeline.error?.code);
    });

    it("answers the same 400 Invalid API Key for an empty ApiKey header", async () => {
      const logPipeline: RouteOutcome = await callGetList({
        crudApiPath: LOG_PIPELINE_PATH,
        headers: { apikey: "" },
      });

      const monitor: RouteOutcome = await callGetList({
        crudApiPath: MONITOR_PATH,
        headers: { apikey: "" },
      });

      expect(monitor.error).toBeInstanceOf(BadDataException);
      expect(monitor.error?.code).toBe(400);
      expect(monitor.error?.message).toBe("Invalid API Key");

      // Byte for byte the same answer, because the model plays no part in it.
      expect(monitor.error?.message).toBe(logPipeline.error?.message);
      expect(monitor.error?.code).toBe(logPipeline.error?.code);
    });
  });
});
