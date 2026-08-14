import { mockRouter } from "./Helpers";
import OnCallReadinessAPI from "../../../Server/API/OnCallReadinessAPI";
import TeamComplianceAPI from "../../../Server/API/TeamComplianceAPI";
import TeamComplianceService from "../../../Server/Services/TeamComplianceService";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import OnCallReadinessService, {
  IDENTIFIER_MASK,
  ReadinessMethodType,
  ReadinessStatus,
  ReadinessSummary,
  ResponderSource,
  UserReadiness,
} from "../../../Server/Services/OnCallReadinessService";
import AlertSeverityService from "../../../Server/Services/AlertSeverityService";
import IncidentSeverityService from "../../../Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "../../../Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleLayerUserService from "../../../Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyService from "../../../Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "../../../Server/Services/OnCallDutyPolicyUserOverrideService";
import ProjectService from "../../../Server/Services/ProjectService";
import TeamComplianceSettingService from "../../../Server/Services/TeamComplianceSettingService";
import TeamMemberService from "../../../Server/Services/TeamMemberService";
import TeamService from "../../../Server/Services/TeamService";
import UserCallService from "../../../Server/Services/UserCallService";
import UserEmailService from "../../../Server/Services/UserEmailService";
import UserNotificationRuleService from "../../../Server/Services/UserNotificationRuleService";
import UserPushService from "../../../Server/Services/UserPushService";
import UserService from "../../../Server/Services/UserService";
import UserSmsService from "../../../Server/Services/UserSmsService";
import UserTelegramService from "../../../Server/Services/UserTelegramService";
import UserWebhookService from "../../../Server/Services/UserWebhookService";
import UserWhatsAppService from "../../../Server/Services/UserWhatsAppService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import UserCall from "../../../Models/DatabaseModels/UserCall";
import UserEmail from "../../../Models/DatabaseModels/UserEmail";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import UserSMS from "../../../Models/DatabaseModels/UserSMS";
import UserTelegram from "../../../Models/DatabaseModels/UserTelegram";
import UserWebhook from "../../../Models/DatabaseModels/UserWebhook";
import UserWhatsApp from "../../../Models/DatabaseModels/UserWhatsApp";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import Dictionary from "../../../Types/Dictionary";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotificationRuleType from "../../../Types/NotificationRule/NotificationRuleType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import ComplianceRuleType from "../../../Types/Team/ComplianceRuleType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The HTTP face of Phase 2, plus the TeamComplianceService rebuild that now sits
 * behind it.
 *
 * Two different levels of test live in this file on purpose, because the two
 * risks are different:
 *
 *   TRANSPORT AND AUTHORISATION are tested against a stubbed
 *   OnCallReadinessService. What matters there is the shape of the payload and
 *   the order of the guards - specifically, that a caller is refused BEFORE any
 *   readiness work happens, and that "this policy is in another project", "this
 *   policy does not exist" and "this user is not in your project" are all
 *   answered identically so the endpoints cannot be used to enumerate ids
 *   across tenants.
 *
 *   MASKING AND THE COMPLIANCE REBUILD are tested end to end, with the REAL
 *   OnCallReadinessService and only the database-facing services stubbed. A
 *   masking test that stubs the service it is testing proves nothing: the whole
 *   claim is that a raw phone number put into the database cannot come out of
 *   the HTTP response, and the only way to test that claim is to put a raw phone
 *   number in one end and read the JSON out of the other. The same reasoning
 *   applies to the compliance rebuild - TeamComplianceServiceBehaviour.test.ts
 *   already pins its mapping with readiness stubbed, so what is left worth
 *   proving is that the real seam between the two behaves, which is exactly
 *   where the four defects used to live.
 *
 * These routes are mounted with UserMiddleware.getUserMiddleware, which admits
 * anonymous callers as UserType.Public and takes the project from a
 * caller-supplied `tenantid` header, and everything underneath reads with
 * isRoot: true. The handlers are therefore the only gate there is, which is why
 * a disproportionate share of this file is spent on who gets refused.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendJsonArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEntityArrayResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEntityResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn().mockImplementation((...args: []) => {
      return args;
    }),
  };
});

const POLICY_ROUTE: string = "/on-call-readiness/policy/:policyId";
const PROJECT_ROUTE: string = "/on-call-readiness/project";
const USER_ROUTE: string = "/on-call-readiness/user/:userId";
const COMPLIANCE_ROUTE: string = "/team/compliance-status/:teamId";

/*
 * The message every authorisation refusal on these routes carries. Asserting on
 * the literal is the only way to pin the property that matters: "wrong project"
 * and "does not exist" must be indistinguishable to the caller.
 */
const REFUSAL: string = "You are not authorized to access this project's data.";

/** Enough of a findBy argument to assert on, without importing FindBy generics. */
interface CapturedFindBy {
  query: Record<string, unknown>;
  select?: Record<string, unknown> | undefined;
  limit?: number | undefined;
  skip?: number | undefined;
  props?: { isRoot?: boolean | undefined } | undefined;
}

/*
 * Helpers.ts keeps its Route type private; this is the slice of it this file
 * uses, so a change to the harness's internals cannot silently retype these
 * assertions.
 */
interface RegisteredRoute {
  method: string;
  uri: string;
  middleware: unknown;
  handlerFunction: (
    req: ExpressRequest,
    res: ExpressResponse,
    next: NextFunction,
  ) => void | Promise<void>;
}

interface RouteCallResult {
  thrownToNext: unknown;
  nextCallCount: number;
}

/** A minimal user row, as UserService.findBy would hand one back. */
interface StubUser {
  id: ObjectID;
  name: string;
  email: string;
}

/** A minimal severity row - the shape both severity services return here. */
interface StubSeverity {
  id: ObjectID;
  name: string;
}

function buildMemberProps(data: {
  projectId: ObjectID;
  userId: ObjectID;
}): DatabaseCommonInteractionProps {
  const memberPermission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectMember,
    labelIds: [],
  };

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: data.projectId,
    permissions: [memberPermission],
  };

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[data.projectId.toString()] = tenantPermission;

  return {
    tenantId: data.projectId,
    userId: data.userId,
    userTenantAccessPermission: permissionMap,
  };
}

function routes(): Array<RegisteredRoute> {
  return mockRouter.routes as unknown as Array<RegisteredRoute>;
}

function routeFor(uri: string): RegisteredRoute {
  const route: RegisteredRoute | undefined = routes().find(
    (candidate: RegisteredRoute): boolean => {
      return candidate.method === "GET" && candidate.uri === uri;
    },
  );

  if (!route) {
    throw new Error(`No GET route registered for ${uri}`);
  }

  return route;
}

async function callGetRoute(data: {
  uri: string;
  params?: Dictionary<string> | undefined;
  query?: Dictionary<string> | undefined;
}): Promise<RouteCallResult> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: data.query || {},
    body: {},
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {
    send: jest.fn(),
    json: jest.fn(),
    status: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await routeFor(data.uri).handlerFunction(
    req,
    res,
    next as unknown as NextFunction,
  );

  return {
    thrownToNext: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

/*
 * The body the route handed to Response.sendJsonObjectResponse. Typed as a bag
 * of unknowns rather than as the contract's interfaces on purpose: the point of
 * these assertions is what actually crosses the wire, and typing the payload as
 * the thing it is supposed to be would let a missing field type-check its way
 * past the test.
 */
function jsonPayload(): Record<string, unknown> {
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  const calls: Array<Array<unknown>> = sender.mock.calls;
  const last: Array<unknown> | undefined = calls[calls.length - 1];

  if (!last) {
    throw new Error("The route sent no JSON response");
  }

  return last[2] as Record<string, unknown>;
}

function callsOf(spy: jest.SpyInstance): Array<CapturedFindBy> {
  return spy.mock.calls.map((args: Array<unknown>): CapturedFindBy => {
    return args[0] as CapturedFindBy;
  });
}

function firstCall(spy: jest.SpyInstance): CapturedFindBy {
  const call: CapturedFindBy | undefined = callsOf(spy)[0];

  if (!call) {
    throw new Error("Expected the service to have been read at least once");
  }

  return call;
}

let propsSpy: jest.SpyInstance;

// Every database-facing read the readiness / compliance path can make.
let policyFindOneById: jest.SpyInstance;
let escalationUserFindBy: jest.SpyInstance;
let escalationTeamFindBy: jest.SpyInstance;
let escalationScheduleFindBy: jest.SpyInstance;
let scheduleLayerUserFindBy: jest.SpyInstance;
let userOverrideFindBy: jest.SpyInstance;
let teamMemberFindBy: jest.SpyInstance;
let userFindBy: jest.SpyInstance;
let userPushFindBy: jest.SpyInstance;
let userEmailFindBy: jest.SpyInstance;
let userSmsFindBy: jest.SpyInstance;
let userCallFindBy: jest.SpyInstance;
let userWhatsAppFindBy: jest.SpyInstance;
let userTelegramFindBy: jest.SpyInstance;
let userWebhookFindBy: jest.SpyInstance;
let notificationRuleFindBy: jest.SpyInstance;
let incidentSeverityFindBy: jest.SpyInstance;
let alertSeverityFindBy: jest.SpyInstance;
let projectFindOneById: jest.SpyInstance;
let teamFindOneById: jest.SpyInstance;
let teamFindOneBy: jest.SpyInstance;
let complianceSettingFindBy: jest.SpyInstance;

function everyFindBySpy(): Array<jest.SpyInstance> {
  return [
    escalationUserFindBy,
    escalationTeamFindBy,
    escalationScheduleFindBy,
    scheduleLayerUserFindBy,
    userOverrideFindBy,
    teamMemberFindBy,
    userFindBy,
    userPushFindBy,
    userEmailFindBy,
    userSmsFindBy,
    userCallFindBy,
    userWhatsAppFindBy,
    userTelegramFindBy,
    userWebhookFindBy,
    notificationRuleFindBy,
    incidentSeverityFindBy,
    alertSeverityFindBy,
    complianceSettingFindBy,
  ];
}

let projectId: ObjectID;
let otherProjectId: ObjectID;
let callerUserId: ObjectID;
let policyId: ObjectID;
let subjectUserId: ObjectID;
let teamId: ObjectID;

beforeAll(() => {
  /*
   * OnCallReadinessAPI registers its routes when the MODULE is evaluated - it
   * exports a bare router rather than a class - so its three routes are already
   * on mockRouter by the time this runs. TeamComplianceAPI registers in its
   * constructor, so it needs the explicit `new`. Nothing clears
   * mockRouter.routes here for exactly that reason: doing so would throw away
   * the readiness routes, which cannot be re-registered without re-importing
   * the module.
   */
  new TeamComplianceAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  /*
   * The readiness service caches summaries and per-user answers for 60s, keyed
   * on project + scope. Ids are regenerated per test so keys would not collide
   * anyway, but a cache that survives between tests is the kind of thing that
   * makes one test's stub answer another test's assertion, so it is cleared
   * explicitly.
   */
  OnCallReadinessService.clearCache();

  projectId = ObjectID.generate();
  otherProjectId = ObjectID.generate();
  callerUserId = ObjectID.generate();
  policyId = ObjectID.generate();
  subjectUserId = ObjectID.generate();
  teamId = ObjectID.generate();
  stubEmailMethodId = ObjectID.generate();

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(
      buildMemberProps({ projectId: projectId, userId: callerUserId }),
    );

  policyFindOneById = jest
    .spyOn(OnCallDutyPolicyService, "findOneById")
    .mockResolvedValue({ id: policyId, projectId: projectId } as never);

  escalationUserFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleUserService, "findBy")
    .mockResolvedValue([] as never);
  escalationTeamFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleTeamService, "findBy")
    .mockResolvedValue([] as never);
  escalationScheduleFindBy = jest
    .spyOn(OnCallDutyPolicyEscalationRuleScheduleService, "findBy")
    .mockResolvedValue([] as never);
  scheduleLayerUserFindBy = jest
    .spyOn(OnCallDutyPolicyScheduleLayerUserService, "findBy")
    .mockResolvedValue([] as never);
  userOverrideFindBy = jest
    .spyOn(OnCallDutyPolicyUserOverrideService, "findBy")
    .mockResolvedValue([] as never);

  /*
   * A membership row by default: both the route's own
   * assertUserBelongsToProject and the readiness service's identical check read
   * this table, and "the caller is looking at somebody in their own project" is
   * the case most tests are about. The tests that care about the refusal
   * override it with [].
   */
  teamMemberFindBy = jest
    .spyOn(TeamMemberService, "findBy")
    .mockResolvedValue([{ _id: "tm-1", userId: subjectUserId }] as never);

  userFindBy = jest.spyOn(UserService, "findBy").mockResolvedValue([] as never);
  userPushFindBy = jest
    .spyOn(UserPushService, "findBy")
    .mockResolvedValue([] as never);
  userEmailFindBy = jest
    .spyOn(UserEmailService, "findBy")
    .mockResolvedValue([] as never);
  userSmsFindBy = jest
    .spyOn(UserSmsService, "findBy")
    .mockResolvedValue([] as never);
  userCallFindBy = jest
    .spyOn(UserCallService, "findBy")
    .mockResolvedValue([] as never);
  userWhatsAppFindBy = jest
    .spyOn(UserWhatsAppService, "findBy")
    .mockResolvedValue([] as never);
  userTelegramFindBy = jest
    .spyOn(UserTelegramService, "findBy")
    .mockResolvedValue([] as never);
  userWebhookFindBy = jest
    .spyOn(UserWebhookService, "findBy")
    .mockResolvedValue([] as never);
  notificationRuleFindBy = jest
    .spyOn(UserNotificationRuleService, "findBy")
    .mockResolvedValue([] as never);
  incidentSeverityFindBy = jest
    .spyOn(IncidentSeverityService, "findBy")
    .mockResolvedValue([] as never);
  alertSeverityFindBy = jest
    .spyOn(AlertSeverityService, "findBy")
    .mockResolvedValue([] as never);
  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockResolvedValue({
      id: projectId,
      disableOnCallNotificationFallback: false,
      enableSmsNotifications: true,
      enableCallNotifications: true,
      enableWhatsAppNotifications: true,
      enableTelegramNotifications: true,
    } as never);

  /*
   * The team is read TWICE on the compliance route, by two different methods,
   * and both are stubbed because they answer two different questions.
   *
   * findOneById is the route's authorisation read: it fetches the team's own
   * projectId so the handler can refuse a team that belongs to somebody else.
   * The stub therefore carries a projectId - a row without one is refused, which
   * is the behaviour the "foreign team" tests below rely on.
   *
   * findOneBy is the service's own read, scoped to id AND project in the query,
   * so that an in-process caller reaching the service directly cannot resolve a
   * foreign team either.
   */
  teamFindOneById = jest.spyOn(TeamService, "findOneById").mockResolvedValue({
    _id: teamId.toString(),
    projectId: projectId,
  } as never);
  teamFindOneBy = jest
    .spyOn(TeamService, "findOneBy")
    .mockResolvedValue({ name: "Platform On-Call" } as never);
  complianceSettingFindBy = jest
    .spyOn(TeamComplianceSettingService, "findBy")
    .mockResolvedValue([] as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

/*
 * --------------------------------------------------------------------------- *
 * Registration. The contract names three routes; a fourth, or a missing one, is
 * a contract change and should read as one.
 * ---------------------------------------------------------------------------
 */

describe("OnCallReadinessAPI - route registration", () => {
  test("exports the very router it registered its routes on", () => {
    /*
     * The module is `export default router`, not a class - App mounts it with
     * app.use(prefix, OnCallReadinessAPI). If it ever exported something else,
     * the routes below would be registered on a router nothing is serving.
     */
    const exported: unknown = OnCallReadinessAPI;

    expect(exported).toBe(mockRouter);
  });

  test("registers exactly the three contract routes, all GET", () => {
    const readinessUris: Array<string> = routes()
      .filter((route: RegisteredRoute): boolean => {
        return route.uri.startsWith("/on-call-readiness");
      })
      .map((route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      })
      .sort();

    expect(readinessUris).toEqual([
      `GET ${POLICY_ROUTE}`,
      `GET ${PROJECT_ROUTE}`,
      `GET ${USER_ROUTE}`,
    ]);
  });

  test.each<[string]>([[POLICY_ROUTE], [PROJECT_ROUTE], [USER_ROUTE]])(
    "%s runs behind the user middleware",
    (uri: string) => {
      /*
       * getUserMiddleware is not an authorisation gate - it admits anonymous
       * callers - but it is what populates the request with whatever identity
       * IS present, and without it every caller would arrive at the handler
       * looking anonymous and be refused.
       */
      expect(routeFor(uri).middleware).toBe(
        UserMiddleware.getUserMiddleware as unknown,
      );
    },
  );
});

/*
 * --------------------------------------------------------------------------- *
 * Transport and authorisation, against a stubbed readiness service.
 * ---------------------------------------------------------------------------
 */

/*
 * The id of the UserEmail ROW the stub summary's one method describes. Held on
 * the module rather than generated inside stubSummary() so an assertion can name
 * the value it expects on the wire, and deliberately NOT equal to subjectUserId:
 * the two are both ObjectIDs hanging off the same row, so confusing them
 * compiles and renders perfectly and is only discovered when a saved rule turns
 * out to reference a User where a UserEmail belongs.
 */
let stubEmailMethodId: ObjectID;

function stubSummary(): ReadinessSummary {
  const severityId: ObjectID = ObjectID.generate();
  const pictureId: ObjectID = ObjectID.generate();

  const user: UserReadiness = {
    userId: subjectUserId,
    userName: "Ada Lovelace",
    userEmail: "ada@example.com",
    userProfilePictureId: pictureId,
    status: ReadinessStatus.PartiallyReady,
    methods: [
      {
        methodId: stubEmailMethodId,
        methodType: ReadinessMethodType.Email,
        maskedIdentifier: `a${IDENTIFIER_MASK}@example.com`,
        isVerified: true,
      },
    ],
    coverage: [
      {
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        severityId: severityId,
        severityName: "Critical",
        hasRule: true,
        isOptOut: false,
      },
      /*
       * A cell with NO severity. The service does not emit these today, but the
       * contract allows them for the two go-on/off-call rule types and the
       * serialiser has to carry the distinction between "no severity" and "the
       * severity failed to load" rather than dropping the field.
       */
      {
        ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
        severityId: undefined,
        severityName: undefined,
        hasRule: false,
        isOptOut: false,
      },
    ],
    reasons: ["No rules for Sev4 incidents - pages fall back to Push, Email"],
    reachedVia: [ResponderSource.Team, ResponderSource.Override],
  };

  return {
    projectId: projectId,
    onCallDutyPolicyId: policyId,
    /*
     * Deliberately inconsistent with `users` below, which holds one row: these
     * are WHOLE-SCOPE counts and the users array is a page of that scope, so a
     * serialiser that recomputed either from the other would be caught here.
     */
    readyCount: 3,
    partiallyReadyCount: 1,
    notReachableCount: 2,
    isFallbackEnabled: true,
    isTruncated: false,
    users: [user],
  };
}

/** A summary carrying `count` responders, for the paging assertions. */
function stubSummaryWithUsers(count: number): ReadinessSummary {
  const summary: ReadinessSummary = stubSummary();
  const template: UserReadiness = summary.users[0]!;

  summary.users = [];

  for (let index: number = 0; index < count; index++) {
    summary.users.push({
      ...template,
      userId: ObjectID.generate(),
      userName: `Responder ${index}`,
    });
  }

  return summary;
}

describe("GET /on-call-readiness/policy/:policyId", () => {
  let policySpy: jest.SpyInstance;

  beforeEach(() => {
    policySpy = jest
      .spyOn(OnCallReadinessService, "getReadinessForPolicy")
      .mockResolvedValue(stubSummary() as never);
  });

  test("returns the ReadinessSummary contract, with every id flattened to a string", async () => {
    const summary: ReadinessSummary = stubSummary();
    policySpy.mockResolvedValue(summary as never);

    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(result.nextCallCount).toBe(0);
    expect(policySpy).toHaveBeenCalledTimes(1);
    expect(policySpy.mock.calls[0]).toEqual([policyId, projectId]);

    const payload: Record<string, unknown> = jsonPayload();

    /*
     * The key set, asserted exhaustively. A field quietly added to the payload
     * is how an unmasked value gets shipped, and a field quietly removed is how
     * the dashboard starts rendering blanks; both should fail here.
     */
    expect(Object.keys(payload).sort()).toEqual([
      "hasMore",
      "isFallbackEnabled",
      "isTruncated",
      "limit",
      "notReachableCount",
      "onCallDutyPolicyId",
      "partiallyReadyCount",
      "projectId",
      "readyCount",
      "skip",
      "totalCount",
      "users",
    ]);

    expect(payload["projectId"]).toBe(projectId.toString());
    expect(payload["onCallDutyPolicyId"]).toBe(policyId.toString());
    expect(payload["readyCount"]).toBe(3);
    expect(payload["partiallyReadyCount"]).toBe(1);
    expect(payload["notReachableCount"]).toBe(2);
    /*
     * The two scope-level facts. isFallbackEnabled is what stops a UI promising
     * "nothing is dropped" in a project where pages with no matching rule ARE
     * dropped; isTruncated is what stops it promising a complete answer when the
     * reads behind the summary hit their ceiling. Both must survive the
     * serialiser, on every page, or the UI cannot tell either story.
     */
    expect(payload["isFallbackEnabled"]).toBe(true);
    expect(payload["isTruncated"]).toBe(false);

    const users: Array<Record<string, unknown>> = payload["users"] as Array<
      Record<string, unknown>
    >;
    expect(users).toHaveLength(1);

    const user: Record<string, unknown> = users[0]!;
    expect(Object.keys(user).sort()).toEqual([
      "coverage",
      "methods",
      "reachedVia",
      "reasons",
      "status",
      "userEmail",
      "userId",
      "userName",
      "userProfilePictureId",
    ]);

    expect(user["userId"]).toBe(subjectUserId.toString());
    expect(user["userName"]).toBe("Ada Lovelace");
    expect(user["userEmail"]).toBe("ada@example.com");
    expect(typeof user["userProfilePictureId"]).toBe("string");
    expect(user["status"]).toBe(ReadinessStatus.PartiallyReady);
    expect(user["reachedVia"]).toEqual([
      ResponderSource.Team,
      ResponderSource.Override,
    ]);
    expect(user["reasons"]).toEqual([
      "No rules for Sev4 incidents - pages fall back to Push, Email",
    ]);

    /*
     * Four fields and no fifth. `methods` is the part of this payload that
     * describes rows an administrator is NOT permitted to read - the seven
     * method models are owner-scoped precisely because their columns are the raw
     * phone number, the webhook bearer url, the push token, the telegram chat id
     * and the verification code - so the wire shape is asserted exhaustively
     * rather than field by field. A field added to ReadinessMethod is a field
     * that ships to every administrator of the project, and it should have to
     * pass through here on the way.
     */
    expect(user["methods"]).toEqual([
      {
        methodId: stubEmailMethodId.toString(),
        methodType: ReadinessMethodType.Email,
        maskedIdentifier: `a${IDENTIFIER_MASK}@example.com`,
        isVerified: true,
      },
    ]);

    /*
     * And flattened to a plain string like every other id in this payload,
     * rather than handed over as ObjectID.toJSON()'s
     * `{ _type: "ObjectID", value: "..." }`. The rule form puts this value
     * straight into userEmailId; a caller that received the wrapper shape and
     * submitted it would be writing an object where a foreign key goes.
     */
    const method: Record<string, unknown> = (
      user["methods"] as Array<Record<string, unknown>>
    )[0]!;
    expect(typeof method["methodId"]).toBe("string");
    expect(method["methodId"]).not.toBe(subjectUserId.toString());
  });

  test("a coverage cell carries its severity id as a string, and undefined when it has none", async () => {
    await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    const users: Array<Record<string, unknown>> = jsonPayload()[
      "users"
    ] as Array<Record<string, unknown>>;
    const coverage: Array<Record<string, unknown>> = users[0]![
      "coverage"
    ] as Array<Record<string, unknown>>;

    expect(coverage).toHaveLength(2);
    expect(Object.keys(coverage[0]!).sort()).toEqual([
      "hasRule",
      "isOptOut",
      "ruleType",
      "severityId",
      "severityName",
    ]);
    expect(coverage[0]!["ruleType"]).toBe(
      NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
    );
    expect(typeof coverage[0]!["severityId"]).toBe("string");
    expect(coverage[0]!["severityName"]).toBe("Critical");
    expect(coverage[0]!["hasRule"]).toBe(true);
    expect(coverage[0]!["isOptOut"]).toBe(false);

    // The severity-less cell keeps the key, so "none" and "missing" stay apart.
    expect(coverage[1]!).toHaveProperty("severityId");
    expect(coverage[1]!["severityId"]).toBeUndefined();
    expect(coverage[1]!["ruleType"]).toBe(
      NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
    );
  });

  test("takes the owning project from the policy row, read as root", async () => {
    await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(policyFindOneById).toHaveBeenCalledTimes(1);
    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean | undefined };
    } = policyFindOneById.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean | undefined };
    };

    expect(read.id.toString()).toBe(policyId.toString());
    expect(read.select["projectId"]).toBe(true);
    expect(read.props.isRoot).toBe(true);
  });

  test("refuses an unauthenticated caller before reading anything", async () => {
    propsSpy.mockResolvedValue({} as never);

    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(policyFindOneById).not.toHaveBeenCalled();
    expect(policySpy).not.toHaveBeenCalled();
  });

  test("refuses a public caller that merely supplies a tenantid header", async () => {
    /*
     * The exact shape getUserMiddleware produces for an anonymous request that
     * carried a `tenantid` header: a project id, no user, no permissions. If
     * this got through, one header would be the whole authentication story for
     * every responder's configuration in that project.
     */
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: undefined,
      userTenantAccessPermission: undefined,
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(policyFindOneById).not.toHaveBeenCalled();
    expect(policySpy).not.toHaveBeenCalled();
  });

  test("a member of one project cannot read another project's policy", async () => {
    policyFindOneById.mockResolvedValue({
      id: policyId,
      projectId: otherProjectId,
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(policySpy).not.toHaveBeenCalled();
  });

  test("an unknown policy id is refused, and refused indistinguishably from a foreign one", async () => {
    /*
     * The dangerous alternative is not a crash - it is a 200 carrying an empty
     * summary, because every readiness query is projectId-scoped and would
     * simply match nothing. "0 responders, nothing wrong" is the worst possible
     * answer to "is this policy safe to rely on?". The second assertion is the
     * anti-enumeration one: identical wording means a caller cannot use this
     * endpoint to learn which policy ids exist in other projects.
     */
    policyFindOneById.mockResolvedValue(null as never);

    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(policySpy).not.toHaveBeenCalled();
  });

  test("a malformed policy id is rejected as bad data, not turned into a query", async () => {
    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: "not-a-uuid" },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(policyFindOneById).not.toHaveBeenCalled();
    expect(policySpy).not.toHaveBeenCalled();
  });

  test("a failure inside the readiness service reaches next(), not the client as a crash", async () => {
    policySpy.mockRejectedValue(
      new BadDataException("On-call duty policy not found") as never,
    );

    const result: RouteCallResult = await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
    });

    expect(result.nextCallCount).toBe(1);
    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

describe("GET /on-call-readiness/project", () => {
  let projectSpy: jest.SpyInstance;

  beforeEach(() => {
    const summary: ReadinessSummary = stubSummary();
    summary.onCallDutyPolicyId = undefined;

    projectSpy = jest
      .spyOn(OnCallReadinessService, "getReadinessForProject")
      .mockResolvedValue(summary as never);
  });

  test("returns the summary for the caller's own project", async () => {
    const result: RouteCallResult = await callGetRoute({
      uri: PROJECT_ROUTE,
    });

    expect(result.nextCallCount).toBe(0);
    expect(projectSpy).toHaveBeenCalledTimes(1);
    expect(projectSpy.mock.calls[0]).toEqual([projectId]);

    const payload: Record<string, unknown> = jsonPayload();
    expect(payload["projectId"]).toBe(projectId.toString());
    // No policy scope on this route - the key stays, carrying undefined.
    expect(payload).toHaveProperty("onCallDutyPolicyId");
    expect(payload["onCallDutyPolicyId"]).toBeUndefined();
    expect(payload["users"]).toHaveLength(1);
  });

  test("the project comes from the authenticated tenant, never from the query string", async () => {
    /*
     * There is no path parameter to tamper with on this route, so the only
     * plausible attack is a query parameter the handler might one day start
     * trusting. Pinning it now costs nothing and makes the regression loud.
     */
    await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { projectId: otherProjectId.toString() },
    });

    expect(projectSpy.mock.calls[0]).toEqual([projectId]);
  });

  test("refuses an unauthenticated caller", async () => {
    propsSpy.mockResolvedValue({} as never);

    const result: RouteCallResult = await callGetRoute({ uri: PROJECT_ROUTE });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(projectSpy).not.toHaveBeenCalled();
  });

  test("refuses a caller whose tenantid header names a project they are not in", async () => {
    /*
     * A real, logged-in user - the header is the only thing that is a lie. This
     * is the whole attack on a route with no path parameter: the project is
     * taken from a value the caller supplies, so the permission map has to be
     * consulted for that exact project rather than merely being present.
     */
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: callerUserId,
      userTenantAccessPermission: {},
    } as never);

    const result: RouteCallResult = await callGetRoute({ uri: PROJECT_ROUTE });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(projectSpy).not.toHaveBeenCalled();
  });
});

/*
 * --------------------------------------------------------------------------- *
 * Paging on the two summary routes.
 *
 * A summary carries one coverage cell per (rule type, severity) pair per
 * responder, so a large project serialises to tens of megabytes. The response is
 * therefore bounded - and the whole risk of bounding it is that a client cannot
 * tell a short page from a complete list. Everything below is about the
 * difference between those two things.
 * ---------------------------------------------------------------------------
 */

describe("paging the readiness summaries", () => {
  let projectSpy: jest.SpyInstance;
  let policySpy: jest.SpyInstance;

  beforeEach(() => {
    projectSpy = jest
      .spyOn(OnCallReadinessService, "getReadinessForProject")
      .mockResolvedValue(stubSummaryWithUsers(250) as never);
    policySpy = jest
      .spyOn(OnCallReadinessService, "getReadinessForPolicy")
      .mockResolvedValue(stubSummaryWithUsers(250) as never);
  });

  test("defaults to one hundred responders, and says so", async () => {
    await callGetRoute({ uri: PROJECT_ROUTE });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["users"]).toHaveLength(100);
    expect(payload["limit"]).toBe(100);
    expect(payload["skip"]).toBe(0);
    expect(payload["totalCount"]).toBe(250);
    expect(payload["hasMore"]).toBe(true);
    expect(projectSpy).toHaveBeenCalledTimes(1);
  });

  test("the counts describe the WHOLE scope, never the page", async () => {
    /*
     * The single most important property of this design. A client that received
     * a page of 100 and a "2 not reachable" derived from it would print a
     * reassuring number under a partial list. The counts come from the service,
     * over the whole scope, and the page never touches them - which is why the
     * fixture's counts deliberately do not add up to the page size.
     */
    await callGetRoute({ uri: PROJECT_ROUTE, query: { limit: "5" } });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["users"]).toHaveLength(5);
    expect(payload["readyCount"]).toBe(3);
    expect(payload["partiallyReadyCount"]).toBe(1);
    expect(payload["notReachableCount"]).toBe(2);
    expect(payload["totalCount"]).toBe(250);
  });

  test("skip walks the list, and hasMore goes false only on the last page", async () => {
    await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { limit: "100", skip: "100" },
    });

    let payload: Record<string, unknown> = jsonPayload();
    expect(payload["users"]).toHaveLength(100);
    expect(payload["skip"]).toBe(100);
    expect(payload["hasMore"]).toBe(true);

    await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { limit: "100", skip: "200" },
    });

    payload = jsonPayload();
    expect(payload["users"]).toHaveLength(50);
    expect(payload["hasMore"]).toBe(false);
  });

  test("a skip past the end is an empty page, not an error and not a wrap-around", async () => {
    await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { limit: "100", skip: "1000" },
    });

    const payload: Record<string, unknown> = jsonPayload();
    expect(payload["users"]).toHaveLength(0);
    expect(payload["totalCount"]).toBe(250);
    expect(payload["hasMore"]).toBe(false);
  });

  test("a limit above the ceiling is REFUSED, not silently clamped", async () => {
    /*
     * Clamping is the failure this endpoint is supposed to prevent, one level
     * up: a caller who asks for 5,000 and receives 500 with no indication of the
     * difference believes it has the whole list. Refusing names the ceiling and
     * forces the caller to page.
     */
    const result: RouteCallResult = await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { limit: "5000" },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect((result.thrownToNext as BadDataException).message).toContain("500");
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test.each<[string]>([["0"], ["abc"], ["12abc"], ["-5"], ["1.5"]])(
    "a limit of %s is rejected rather than guessed at",
    async (limit: string) => {
      /*
       * parseInt("12abc") is 12 and parseInt("abc") is NaN. A page size taken
       * from either would be a page size nobody asked for, and NaN in
       * particular slices to an empty array - which renders as "this project has
       * no responders".
       */
      const result: RouteCallResult = await callGetRoute({
        uri: PROJECT_ROUTE,
        query: { limit: limit },
      });

      expect(result.thrownToNext).toBeInstanceOf(BadDataException);
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    },
  );

  test("a malformed skip is rejected too", async () => {
    const result: RouteCallResult = await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { skip: "not-a-number" },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
  });

  test("the policy route pages on the same contract", async () => {
    await callGetRoute({
      uri: POLICY_ROUTE,
      params: { policyId: policyId.toString() },
      query: { limit: "10", skip: "20" },
    });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["users"]).toHaveLength(10);
    expect(payload["limit"]).toBe(10);
    expect(payload["skip"]).toBe(20);
    expect(payload["totalCount"]).toBe(250);
    expect(payload["hasMore"]).toBe(true);
    expect(policySpy).toHaveBeenCalledTimes(1);
  });

  test("a truncated scope stays flagged on EVERY page, not just the first", async () => {
    /*
     * isTruncated says the scope itself is incomplete - responders may be
     * missing from it entirely - which is a different and worse thing than
     * hasMore. A client reading page three must still be told.
     */
    const truncated: ReadinessSummary = stubSummaryWithUsers(250);
    truncated.isTruncated = true;
    truncated.isFallbackEnabled = false;
    projectSpy.mockResolvedValue(truncated as never);

    await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { limit: "10", skip: "200" },
    });

    const payload: Record<string, unknown> = jsonPayload();

    expect(payload["isTruncated"]).toBe(true);
    expect(payload["isFallbackEnabled"]).toBe(false);
    expect(payload["skip"]).toBe(200);
  });

  test("paging is refused for a caller who is not a member, before any readiness work", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: undefined,
      userTenantAccessPermission: undefined,
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: PROJECT_ROUTE,
      query: { limit: "10" },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(projectSpy).not.toHaveBeenCalled();
  });
});

describe("GET /on-call-readiness/user/:userId", () => {
  let userSpy: jest.SpyInstance;

  function stubUserReadiness(): UserReadiness {
    return stubSummary().users[0]!;
  }

  beforeEach(() => {
    userSpy = jest
      .spyOn(OnCallReadinessService, "getReadinessForUser")
      .mockResolvedValue(stubUserReadiness() as never);
  });

  test("returns the UserReadiness contract for a member of the caller's project", async () => {
    const result: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    expect(result.nextCallCount).toBe(0);
    expect(userSpy).toHaveBeenCalledTimes(1);
    expect(userSpy.mock.calls[0]).toEqual([subjectUserId, projectId]);

    const payload: Record<string, unknown> = jsonPayload();
    expect(Object.keys(payload).sort()).toEqual([
      "coverage",
      "methods",
      "reachedVia",
      "reasons",
      "status",
      "userEmail",
      "userId",
      "userName",
      "userProfilePictureId",
    ]);
    expect(payload["userId"]).toBe(subjectUserId.toString());
    // Not wrapped in a summary - this route answers about one person.
    expect(payload).not.toHaveProperty("users");
  });

  test("the membership check names the path's user, in the caller's project, as root", async () => {
    await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    const call: CapturedFindBy = firstCall(teamMemberFindBy);
    expect((call.query["userId"] as ObjectID).toString()).toBe(
      subjectUserId.toString(),
    );
    expect((call.query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    // Existence check only.
    expect(call.limit).toBe(1);
    expect(call.skip).toBe(0);
    expect(call.props?.isRoot).toBe(true);
  });

  test("a user outside the caller's project is refused before their name is read", async () => {
    /*
     * User is a GLOBAL model - nothing about it is project-scoped - so without
     * this check the route hands back a stranger's display name and login email
     * to anyone holding any project's credentials. Every other query underneath
     * is project-scoped and would come back empty, which is precisely what makes
     * this the leak that would go unnoticed.
     */
    teamMemberFindBy.mockResolvedValue([] as never);

    const result: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(userSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a user id that does not exist is refused with the same words as a foreign user", async () => {
    // Both cases produce no membership row, and must be indistinguishable.
    teamMemberFindBy.mockResolvedValue([] as never);

    const unknown: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: ObjectID.generate().toString() },
    });
    const foreign: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    expect((unknown.thrownToNext as NotAuthorizedException).message).toBe(
      (foreign.thrownToNext as NotAuthorizedException).message,
    );
    expect((unknown.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
  });

  test("a malformed user id is rejected before the membership query", async () => {
    const result: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: "12345" },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(userSpy).not.toHaveBeenCalled();
  });

  test("refuses an unauthenticated caller before the membership query", async () => {
    propsSpy.mockResolvedValue({} as never);

    const result: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(userSpy).not.toHaveBeenCalled();
  });

  test("refuses a public caller that merely supplies a tenantid header", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: undefined,
      userTenantAccessPermission: undefined,
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(teamMemberFindBy).not.toHaveBeenCalled();
    expect(userSpy).not.toHaveBeenCalled();
  });
});

/*
 * --------------------------------------------------------------------------- *
 * Masking, end to end.
 *
 * Nothing is stubbed between the raw rows below and the JSON the route returns
 * except the database reads themselves, because the claim under test is exactly
 * that: a raw identifier written into the database cannot come back out of this
 * endpoint. A masking test that stubbed OnCallReadinessService would assert only
 * that the API copies a field it was handed.
 * ---------------------------------------------------------------------------
 */

describe("GET /on-call-readiness/user/:userId - identifier masking", () => {
  /*
   * The login email and the notification email are deliberately DIFFERENT
   * addresses here. They are different values with different exposure - the
   * login email is admin-readable everywhere a user is listed, the notification
   * address is not - and keeping them distinct is what lets the leak test below
   * search the whole response body for the notification address without
   * tripping over the login one, which is supposed to be there in full.
   */
  const LOGIN_EMAIL: string = "jane@corp.example.com";
  const RAW_EMAIL: string = "jane.doe@personal.example.com";
  const RAW_SMS: string = "+14155554821";
  const RAW_CALL: string = "+442071234567";
  const RAW_WHATSAPP: string = "+14155559999";
  const RAW_HANDLE: string = "@jamesbond";
  const RAW_DEVICE: string = "Jane's iPhone 15 Pro";
  const RAW_WEBHOOK_NAME: string = "Payments Slack Hook";
  const RAW_WEBHOOK_URL: string =
    "https://hooks.slack.com/services/T000/B000/XXXXsecretXXXX";

  /*
   * One fixed id per channel, and fixed rather than generated so that a failure
   * prints a value a reader can match against the fixture that produced it.
   *
   * These are the ids UserNotificationRule's seven foreign keys reference -
   * userEmailId points at a UserEmail row, userSmsId at a UserSMS row - and they
   * are the reason `methodId` exists at all. An administrator building a rule
   * for somebody else may not READ any of these rows; what they get instead is
   * this id beside a mask, which is enough to point a rule at a method and not
   * enough to page anyone. So the id has to be on the wire, and it has to be the
   * id of the METHOD row: a rule carrying a user id or a rule id in userSmsId
   * references nothing, and a rule that references nothing pages nobody.
   */
  const PUSH_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000001",
  );
  const EMAIL_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000002",
  );
  const SMS_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000003",
  );
  const CALL_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000004",
  );
  const WHATSAPP_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000005",
  );
  const TELEGRAM_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000006",
  );
  const WEBHOOK_METHOD_ID: ObjectID = new ObjectID(
    "1a000000-0000-4000-8000-000000000007",
  );

  /*
   * The expected id per channel, in one place, so the sweep below is a sweep
   * over all seven rather than seven assertions that can each be forgotten
   * individually. Keyed by the wire's `methodType` string.
   */
  const METHOD_ID_BY_TYPE: Dictionary<string> = {
    [ReadinessMethodType.Push]: PUSH_METHOD_ID.toString(),
    [ReadinessMethodType.Email]: EMAIL_METHOD_ID.toString(),
    [ReadinessMethodType.SMS]: SMS_METHOD_ID.toString(),
    [ReadinessMethodType.Call]: CALL_METHOD_ID.toString(),
    [ReadinessMethodType.WhatsApp]: WHATSAPP_METHOD_ID.toString(),
    [ReadinessMethodType.Telegram]: TELEGRAM_METHOD_ID.toString(),
    [ReadinessMethodType.Webhook]: WEBHOOK_METHOD_ID.toString(),
  };

  /*
   * REAL model instances, not object literals shaped like rows.
   *
   * `_id` is a string column and `id` is a getter over it that hands back an
   * ObjectID; a plain object has the first and not the second, and the service
   * reads the second. Stubbing findBy with literals therefore produces rows the
   * service quietly DROPS for having no id of their own - which would empty the
   * `methods` array and turn every leak assertion in this block green for the
   * one reason that proves nothing. Constructing the models is what keeps these
   * tests honest about the path they claim to exercise.
   */
  beforeEach(() => {
    userFindBy.mockResolvedValue([
      {
        id: subjectUserId,
        name: "Jane Doe",
        email: LOGIN_EMAIL,
      },
    ] as never);

    const email: UserEmail = new UserEmail();
    email.id = EMAIL_METHOD_ID;
    email.userId = subjectUserId;
    email.email = new Email(RAW_EMAIL);
    email.isVerified = true;
    userEmailFindBy.mockResolvedValue([email] as never);

    const sms: UserSMS = new UserSMS();
    sms.id = SMS_METHOD_ID;
    sms.userId = subjectUserId;
    sms.phone = new Phone(RAW_SMS);
    sms.isVerified = true;
    userSmsFindBy.mockResolvedValue([sms] as never);

    const call: UserCall = new UserCall();
    call.id = CALL_METHOD_ID;
    call.userId = subjectUserId;
    call.phone = new Phone(RAW_CALL);
    call.isVerified = true;
    userCallFindBy.mockResolvedValue([call] as never);

    const whatsApp: UserWhatsApp = new UserWhatsApp();
    whatsApp.id = WHATSAPP_METHOD_ID;
    whatsApp.userId = subjectUserId;
    whatsApp.phone = new Phone(RAW_WHATSAPP);
    whatsApp.isVerified = true;
    userWhatsAppFindBy.mockResolvedValue([whatsApp] as never);

    const telegram: UserTelegram = new UserTelegram();
    telegram.id = TELEGRAM_METHOD_ID;
    telegram.userId = subjectUserId;
    telegram.telegramUserHandle = RAW_HANDLE;
    // On the row, and never selected: the chat id is the addressable target.
    telegram.telegramChatId = "998877";
    telegram.isVerified = true;
    userTelegramFindBy.mockResolvedValue([telegram] as never);

    const push: UserPush = new UserPush();
    push.id = PUSH_METHOD_ID;
    push.userId = subjectUserId;
    push.deviceName = RAW_DEVICE;
    push.isVerified = true;
    userPushFindBy.mockResolvedValue([push] as never);

    const webhook: UserWebhook = new UserWebhook();
    webhook.id = WEBHOOK_METHOD_ID;
    webhook.userId = subjectUserId;
    webhook.name = RAW_WEBHOOK_NAME;
    // Present on the row, and must never be selected or emitted.
    webhook.webhookUrl = RAW_WEBHOOK_URL;
    userWebhookFindBy.mockResolvedValue([webhook] as never);
  });

  async function readUser(): Promise<Record<string, unknown>> {
    const result: RouteCallResult = await callGetRoute({
      uri: USER_ROUTE,
      params: { userId: subjectUserId.toString() },
    });

    expect(result.nextCallCount).toBe(0);

    return jsonPayload();
  }

  function methodsOf(
    payload: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    return payload["methods"] as Array<Record<string, unknown>>;
  }

  test("every method identifier arrives masked, one per channel, in fallback order", async () => {
    const payload: Record<string, unknown> = await readUser();

    expect(payload["methods"]).toEqual([
      {
        methodId: PUSH_METHOD_ID.toString(),
        methodType: ReadinessMethodType.Push,
        maskedIdentifier: `Ja${IDENTIFIER_MASK}`,
        isVerified: true,
      },
      {
        methodId: EMAIL_METHOD_ID.toString(),
        methodType: ReadinessMethodType.Email,
        maskedIdentifier: `j${IDENTIFIER_MASK}@personal.example.com`,
        isVerified: true,
      },
      {
        methodId: SMS_METHOD_ID.toString(),
        methodType: ReadinessMethodType.SMS,
        maskedIdentifier: `+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4821`,
        isVerified: true,
      },
      {
        methodId: CALL_METHOD_ID.toString(),
        methodType: ReadinessMethodType.Call,
        maskedIdentifier: `+44 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 4567`,
        isVerified: true,
      },
      {
        methodId: WHATSAPP_METHOD_ID.toString(),
        methodType: ReadinessMethodType.WhatsApp,
        maskedIdentifier: `+1 ${IDENTIFIER_MASK} ${IDENTIFIER_MASK} 9999`,
        isVerified: true,
      },
      {
        methodId: TELEGRAM_METHOD_ID.toString(),
        methodType: ReadinessMethodType.Telegram,
        maskedIdentifier: `@ja${IDENTIFIER_MASK}`,
        isVerified: true,
      },
      {
        /*
         * UserWebhook has no verification concept at all - its presence is the
         * whole test, which is how the runtime fallback treats it too.
         */
        methodId: WEBHOOK_METHOD_ID.toString(),
        methodType: ReadinessMethodType.Webhook,
        maskedIdentifier: `Pa${IDENTIFIER_MASK}`,
        isVerified: true,
      },
    ]);
  });

  test("all seven channels reach the wire carrying the id of their OWN row", async () => {
    /*
     * The dropdown's entire premise, swept across every channel rather than
     * spot-checked on one, because the seven are seven separate code paths that
     * each build their own row and each have their own opportunity to hand over
     * somebody else's id - or none at all.
     *
     * Asserted through the ROUTE rather than against the service, because the
     * service is not where this can be lost any more: the serialiser copies the
     * fields it names, so a `methodId` the service computes and the API does not
     * copy is invisible everywhere except here, and it fails as an admin looking
     * at a rule form with no options in it.
     */
    const payload: Record<string, unknown> = await readUser();
    const methods: Array<Record<string, unknown>> = methodsOf(payload);

    expect(methods).toHaveLength(7);

    for (const method of methods) {
      const methodType: string = method["methodType"] as string;
      const expected: string | undefined = METHOD_ID_BY_TYPE[methodType];

      /*
       * Guards the sweep: an unrecognised channel would otherwise compare
       * undefined against undefined and pass. An eighth channel is a contract
       * change and must be added to the table above deliberately.
       */
      expect(expected).toBeDefined();
      expect(`${methodType}: ${String(method["methodId"])}`).toBe(
        `${methodType}: ${String(expected)}`,
      );
      expect(typeof method["methodId"]).toBe("string");
    }
  });

  test("no methodId is the responder's user id, which references no method at all", async () => {
    /*
     * `row.userId` and `row.id` are both ObjectIDs on the same row, and the
     * mistake of emitting the first where the second belongs type-checks,
     * renders identically and is only discovered when a rule saved against it
     * turns out to reference a User where a UserSMS was expected. That rule
     * dereferences to nothing at page time, which is the failure this whole
     * feature exists to make visible - so it must not be the failure the feature
     * introduces.
     */
    const payload: Record<string, unknown> = await readUser();
    const methods: Array<Record<string, unknown>> = methodsOf(payload);

    expect(methods).toHaveLength(7);

    for (const method of methods) {
      expect(method["methodId"]).not.toBe(subjectUserId.toString());
      // Nor the policy or the project the responder was reached through.
      expect(method["methodId"]).not.toBe(policyId.toString());
      expect(method["methodId"]).not.toBe(projectId.toString());
    }

    // And all seven are distinct - one id copied across channels is the same bug.
    const ids: Array<unknown> = methods.map(
      (method: Record<string, unknown>): unknown => {
        return method["methodId"];
      },
    );
    expect(new Set(ids).size).toBe(7);
  });

  test("a method carries its id, its type, its mask and its verification - and nothing else", async () => {
    /*
     * The containment assertion. Every field on this object ships to every
     * administrator of the project, about a row that administrator is not
     * allowed to read, so the key set is pinned exhaustively on all seven rather
     * than left to whatever the serialiser happens to copy. A `phone`, a
     * `webhookUrl` or a `telegramChatId` appearing here is not a formatting
     * change; it is the exposure this design was built to avoid.
     */
    const payload: Record<string, unknown> = await readUser();

    for (const method of methodsOf(payload)) {
      expect(Object.keys(method).sort()).toEqual([
        "isVerified",
        "maskedIdentifier",
        "methodId",
        "methodType",
      ]);
    }
  });

  test("not one raw identifier appears anywhere in the response body", async () => {
    const payload: Record<string, unknown> = await readUser();
    const body: string = JSON.stringify(payload);

    /*
     * Guards the guard, and it is not a formality here: the service drops any
     * method row it cannot find an id on, so a fixture regression that emptied
     * `methods` would satisfy every "not present" assertion below for the one
     * reason that proves nothing at all. The seven masks have to be in the body
     * before their absence of raw values means anything.
     */
    expect(methodsOf(payload)).toHaveLength(7);
    expect(body).toContain(IDENTIFIER_MASK);

    /*
     * Serialised and searched wholesale rather than field by field, because the
     * failure this guards against is a raw value appearing somewhere nobody
     * thought to assert on - a reason sentence, a new field, a nested object.
     */
    for (const raw of [
      RAW_EMAIL,
      RAW_SMS,
      RAW_CALL,
      RAW_WHATSAPP,
      RAW_HANDLE,
      RAW_DEVICE,
      RAW_WEBHOOK_NAME,
      RAW_WEBHOOK_URL,
      // The notification address's local part on its own, and the hook's host.
      "jane.doe@",
      "hooks.slack.com",
      // The telegram chat id - the addressable target, never the label.
      "998877",
      /*
       * The unmasked tails of the four phone-shaped identifiers. maskIdentifier
       * keeps the last four digits on purpose, so the numbers themselves are
       * spelled out here without their separators as well: a serialiser that
       * emitted E.164 alongside the mask would still be caught even though the
       * mask is present and correct beside it.
       */
      "4155554821",
      "442071234567",
      "4155559999",
    ]) {
      expect(body).not.toContain(raw);
    }
  });

  test("the id on the wire is the METHOD row's, told apart from the RULE that points at it", async () => {
    /*
     * The two ids a rule form juggles are the rule's own id and the method id it
     * writes into userSmsId, and they are indistinguishable by shape. This
     * stages a rule row whose id is a value nothing else in the fixture uses,
     * then asserts it does not turn up in `methods` - because a dropdown offering
     * rule ids would write userSmsId values that dereference to a
     * UserNotificationRule, which pages nobody and reads, on the readiness table
     * that would then describe it, as a method that exists.
     */
    const ruleId: ObjectID = new ObjectID(
      "1b000000-0000-4000-8000-0000000000ff",
    );

    notificationRuleFindBy.mockResolvedValue([
      {
        _id: ruleId.toString(),
        userId: subjectUserId,
        ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
        userSmsId: SMS_METHOD_ID,
      },
    ] as never);

    const payload: Record<string, unknown> = await readUser();
    const methods: Array<Record<string, unknown>> = methodsOf(payload);

    expect(methods).toHaveLength(7);

    for (const method of methods) {
      expect(method["methodId"]).not.toBe(ruleId.toString());
    }

    /*
     * And the SMS entry still carries the id that rule references, which is the
     * positive half: the value an admin picks and the value already stored on an
     * existing rule have to be the same value, or the form cannot show the
     * current selection.
     */
    const smsMethod: Record<string, unknown> | undefined = methods.find(
      (method: Record<string, unknown>): boolean => {
        return method["methodType"] === ReadinessMethodType.SMS;
      },
    );
    expect(smsMethod?.["methodId"]).toBe(SMS_METHOD_ID.toString());
  });

  test("the login email is NOT masked, but the notification email still is", async () => {
    /*
     * Deliberate, and worth pinning precisely because it looks like a leak: the
     * login email is already admin-readable everywhere a user is listed, and
     * masking it here would make the readiness table the one surface where two
     * people called "J. Doe" cannot be told apart. The NOTIFICATION email is a
     * different value with different exposure and is masked - the two are
     * separate fields with separate rules, not one value rendered twice.
     */
    const payload: Record<string, unknown> = await readUser();

    expect(payload["userEmail"]).toBe(LOGIN_EMAIL);

    const methods: Array<Record<string, unknown>> = payload["methods"] as Array<
      Record<string, unknown>
    >;
    const email: Record<string, unknown> | undefined = methods.find(
      (method: Record<string, unknown>): boolean => {
        return method["methodType"] === ReadinessMethodType.Email;
      },
    );

    expect(email?.["maskedIdentifier"]).toBe(
      `j${IDENTIFIER_MASK}@personal.example.com`,
    );
  });

  test("the webhook read never selects the bearer credential", async () => {
    /*
     * UserWebhook.webhookUrl is a bearer credential - anyone holding a
     * Slack/Discord/Teams hook URL can post as that integration. The strongest
     * available guarantee is that the column is never even SELECTed, so no
     * later serialiser change can start emitting a value the row does not carry.
     */
    await readUser();

    const call: CapturedFindBy = firstCall(userWebhookFindBy);

    expect(Object.keys(call.select || {}).sort()).toEqual([
      "_id",
      "name",
      "userId",
    ]);
    expect(call.select?.["webhookUrl"]).toBeUndefined();
    expect(call.select?.["url"]).toBeUndefined();
  });

  test("the telegram read takes the handle, never the addressable chat id", async () => {
    await readUser();

    const call: CapturedFindBy = firstCall(userTelegramFindBy);

    expect(call.select?.["telegramUserHandle"]).toBe(true);
    expect(call.select?.["telegramChatId"]).toBeUndefined();
  });
});

/*
 * --------------------------------------------------------------------------- *
 * The TeamComplianceService rebuild, exercised through its own route with the
 * REAL readiness service underneath.
 *
 * Teams > View > Compliance renders this payload field for field - including
 * the reason strings, which it prints as prose rather than mapping through any
 * lookup - so the shape is a hard contract. What changed underneath is where
 * the two "does this user have on-call rules?" answers come from, and the four
 * defects that lived in the old answer are re-tested here across the real seam
 * rather than against a stubbed readiness service.
 * ---------------------------------------------------------------------------
 */

interface StubRule {
  _id: string;
  userId: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  isOptOut?: boolean | undefined;
  userCallId?: ObjectID | undefined;
  userSmsId?: ObjectID | undefined;
  userEmailId?: ObjectID | undefined;
  userPushId?: ObjectID | undefined;
  userTelegramId?: ObjectID | undefined;
  userWhatsAppId?: ObjectID | undefined;
  userWebhookId?: ObjectID | undefined;
}

describe("GET /team/compliance-status/:teamId - the rebuilt service", () => {
  let ada: StubUser;
  let grace: StubUser;
  let critical: StubSeverity;
  let major: StubSeverity;
  let page: StubSeverity;

  function stage(data: {
    settings: Array<{ ruleType: ComplianceRuleType; enabled: boolean }>;
    members: Array<StubUser>;
    rules: Array<StubRule>;
    incidentSeverities: Array<StubSeverity>;
    alertSeverities: Array<StubSeverity>;
  }): void {
    complianceSettingFindBy.mockResolvedValue(data.settings as never);

    teamMemberFindBy.mockResolvedValue(
      data.members.map((member: StubUser): Record<string, unknown> => {
        return { _id: `tm-${member.id.toString()}`, userId: member.id };
      }) as never,
    );

    userFindBy.mockResolvedValue(data.members as never);

    /*
     * The members are attached DIRECTLY to an escalation rule, which is the
     * arrangement that lets the project-scope readiness summary answer for all
     * of them in one pass. It is also the arrangement TeamComplianceService is
     * designed around: a team on a compliance page exists because its members
     * are on call.
     */
    escalationUserFindBy.mockResolvedValue(
      data.members.map((member: StubUser): Record<string, unknown> => {
        return { _id: `er-${member.id.toString()}`, userId: member.id };
      }) as never,
    );

    notificationRuleFindBy.mockResolvedValue(data.rules as never);
    incidentSeverityFindBy.mockResolvedValue(data.incidentSeverities as never);
    alertSeverityFindBy.mockResolvedValue(data.alertSeverities as never);
  }

  async function readCompliance(): Promise<Record<string, unknown>> {
    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.nextCallCount).toBe(0);

    return jsonPayload();
  }

  function statusesOf(
    payload: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    return payload["userComplianceStatuses"] as Array<Record<string, unknown>>;
  }

  beforeEach(() => {
    ada = { id: ObjectID.generate(), name: "Ada", email: "ada@example.com" };
    grace = {
      id: ObjectID.generate(),
      name: "Grace",
      email: "grace@example.com",
    };
    critical = { id: ObjectID.generate(), name: "Critical" };
    major = { id: ObjectID.generate(), name: "Major" };
    page = { id: ObjectID.generate(), name: "Page" };
  });

  test("the response shape the dashboard renders is unchanged", async () => {
    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasNotificationEmailMethod,
          enabled: true,
        },
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    const payload: Record<string, unknown> = await readCompliance();

    expect(Object.keys(payload).sort()).toEqual([
      "complianceSettings",
      "teamId",
      "teamName",
      "userComplianceStatuses",
    ]);
    expect(payload["teamId"]).toBe(teamId.toString());
    expect(payload["teamName"]).toBe("Platform On-Call");
    expect(payload["complianceSettings"]).toEqual([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        enabled: true,
      },
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
    ]);

    const statuses: Array<Record<string, unknown>> = statusesOf(payload);
    expect(statuses).toHaveLength(1);
    expect(Object.keys(statuses[0]!).sort()).toEqual([
      "isCompliant",
      "nonCompliantRules",
      "userEmail",
      "userId",
      "userName",
      "userProfilePictureId",
    ]);
    expect(statuses[0]!["userId"]).toBe(ada.id.toString());
    expect(statuses[0]!["userName"]).toBe("Ada");
    expect(statuses[0]!["isCompliant"]).toBe(false);
    /*
     * The reason strings are printed verbatim by TeamComplianceStatusTable, so
     * their exact wording is part of the payload contract, not an internal
     * detail. Both an old-style channel rule and a rebuilt on-call rule are
     * asserted together to show neither vocabulary shifted.
     */
    expect(statuses[0]!["nonCompliantRules"]).toEqual([
      {
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        reason: "No verified email address configured for notifications",
      },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason: "Missing notification rules for incident severities: Critical",
      },
    ]);
  });

  test("DEFECT closed: a rule on Telegram, WhatsApp or a webhook now counts", async () => {
    /*
     * The old check read userCallId/userSmsId/userEmailId/userPushId off the
     * rule row and treated a row carrying none of them as no rule at all, so a
     * responder reachable only on Telegram, WhatsApp or a webhook was reported
     * non-compliant while the runtime was quite happily paging them. A false RED
     * teaches admins to ignore the table, which is worse than no table.
     *
     * All three channels are staged onto one user at once: whichever column the
     * rule carries, the row is a rule.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
        { ruleType: ComplianceRuleType.HasAlertOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [
        {
          _id: "rule-telegram",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userTelegramId: ObjectID.generate(),
        },
        {
          _id: "rule-whatsapp",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: major.id,
          userWhatsAppId: ObjectID.generate(),
        },
        {
          _id: "rule-webhook",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: page.id,
          userWebhookId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical, major],
      alertSeverities: [page],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    expect(statuses[0]!["isCompliant"]).toBe(true);
    expect(statuses[0]!["nonCompliantRules"]).toEqual([]);
  });

  test("DEFECT closed: no channel column is even read, so none can be missed", async () => {
    /*
     * The structural half of the fix. The three formerly-invisible channels were
     * invisible because they were never SELECTed; asserting that NONE of the
     * seven is selected means no future edit can reintroduce a partial column
     * list and quietly start under-counting again.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    await readCompliance();

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);

    for (const column of [
      "userCallId",
      "userSmsId",
      "userEmailId",
      "userPushId",
      "userTelegramId",
      "userWhatsAppId",
      "userWebhookId",
    ]) {
      expect(call.select?.[column]).toBeUndefined();
    }

    // What IS read: who, what kind of page, which severity, and opt-out state.
    expect(call.select?.["ruleType"]).toBe(true);
    expect(call.select?.["incidentSeverityId"]).toBe(true);
    expect(call.select?.["alertSeverityId"]).toBe(true);
    expect(call.select?.["isOptOut"]).toBe(true);
  });

  test("DEFECT closed: a WHEN_USER_GOES_OFF_CALL rule is no longer incident coverage", async () => {
    /*
     * The false GREEN, and the more dangerous of the two directions: the owner
     * was told a responder was covered for Sev1 incidents when their only rule
     * fired as they went off call. The row below carries an incidentSeverityId,
     * which is exactly what made the old severity-only match accept it.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [
        {
          _id: "rule-off-call",
          userId: ada.id,
          ruleType: NotificationRuleType.WHEN_USER_GOES_OFF_CALL,
          incidentSeverityId: critical.id,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    expect(statuses[0]!["isCompliant"]).toBe(false);
    expect(statuses[0]!["nonCompliantRules"]).toEqual([
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason: "Missing notification rules for incident severities: Critical",
      },
    ]);
  });

  test("DEFECT closed: an alert rule does not satisfy an incident severity of the same id", async () => {
    /*
     * The sharpest form of the ruleType fix. One rule row, one severity id, and
     * the two checks disagree about it - because the severity is taken from the
     * column the RULE TYPE dictates rather than from whichever one happens to be
     * populated.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
        { ruleType: ComplianceRuleType.HasAlertOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [
        {
          _id: "rule-alert-only",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: page.id,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical],
      alertSeverities: [page],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    expect(statuses[0]!["nonCompliantRules"]).toEqual([
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason: "Missing notification rules for incident severities: Critical",
      },
    ]);
  });

  test("a legacy rule row with a NULL isOptOut still counts as coverage", async () => {
    /*
     * isOptOut is nullable and was added long after these rows started
     * existing, so it is NULL on every rule in every existing install. An
     * implementation that classified coverage with `isOptOut === false` would
     * match none of them and report a fully-configured project as entirely
     * unready - which is why the split is `isOptOut === true`, the exact dual of
     * the notInOrNull predicate the paging path uses.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [
        {
          _id: "rule-legacy",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          isOptOut: undefined,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    expect(statuses[0]!["isCompliant"]).toBe(true);
  });

  test("an explicitly opted-out severity is coverage, not a gap", async () => {
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [
        {
          _id: "rule-opt-out",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          isOptOut: true,
        },
      ],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    // Deliberate silence is not a compliance failure.
    expect(statuses[0]!["isCompliant"]).toBe(true);
  });

  test("DEFECT closed: not one read in the whole render carries the literal limit 100", async () => {
    /*
     * The old code capped team members, users and alert severities at 100 while
     * capping incident severities at LIMIT_PER_PROJECT. Truncation is the worst
     * failure mode a compliance page has: the 101st member was not reported
     * non-compliant, they were simply absent, and an absent row reads as "no
     * problem here". Sweeping every read the render makes - the compliance
     * service's three and the readiness service's dozen - is the assertion that
     * cannot be satisfied by fixing three call sites and missing a fourth.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
        { ruleType: ComplianceRuleType.HasAlertOnCallRules, enabled: true },
      ],
      members: [ada, grace],
      rules: [],
      incidentSeverities: [critical, major],
      alertSeverities: [page],
    });

    await readCompliance();

    let readsInspected: number = 0;

    for (const spy of everyFindBySpy()) {
      for (const call of callsOf(spy)) {
        readsInspected++;
        expect(call.limit).not.toBe(100);
      }
    }

    // Guards the guard: an assertion over zero reads proves nothing.
    expect(readsInspected).toBeGreaterThan(10);

    expect(firstCall(complianceSettingFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(teamMemberFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(userFindBy).limit).toBe(LIMIT_PER_PROJECT);
    // Both severity kinds, which is where the two halves used to disagree.
    expect(firstCall(incidentSeverityFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(alertSeverityFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(notificationRuleFindBy).limit).toBe(LIMIT_PER_PROJECT);
  });

  test("DEFECT closed: the read count does not grow with members or severities", async () => {
    /*
     * The N+1. The old service issued one findBy per severity per user, so a
     * team of 20 in a project with 5 severities cost 100 round trips to render
     * one page. The proof is comparative rather than absolute: the same render
     * with three times the members and three times the severities must cost the
     * same number of reads, whatever that number happens to be.
     */
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada],
      rules: [],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    await readCompliance();

    const smallRuleReads: number = notificationRuleFindBy.mock.calls.length;
    const smallUserReads: number = userFindBy.mock.calls.length;
    const smallSeverityReads: number =
      incidentSeverityFindBy.mock.calls.length +
      alertSeverityFindBy.mock.calls.length;

    expect(smallRuleReads).toBe(1);

    /*
     * mockClear, not mockReset: the stubs' resolved values are implementations
     * and have to survive into the second render.
     */
    jest.clearAllMocks();
    OnCallReadinessService.clearCache();

    const carol: StubUser = {
      id: ObjectID.generate(),
      name: "Carol",
      email: "carol@example.com",
    };
    const minor: StubSeverity = { id: ObjectID.generate(), name: "Minor" };
    const trivial: StubSeverity = { id: ObjectID.generate(), name: "Trivial" };

    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada, grace, carol],
      rules: [],
      incidentSeverities: [critical, major, minor, trivial],
      alertSeverities: [page],
    });

    await readCompliance();

    expect(notificationRuleFindBy.mock.calls.length).toBe(smallRuleReads);
    expect(userFindBy.mock.calls.length).toBe(smallUserReads);
    expect(
      incidentSeverityFindBy.mock.calls.length +
        alertSeverityFindBy.mock.calls.length,
    ).toBe(smallSeverityReads);
  });

  test("one notification-rule read covers every member, batched on userId", async () => {
    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      ],
      members: [ada, grace],
      rules: [
        {
          _id: "rule-ada",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    // One query, scoped to the project, listing every user it is asking about.
    expect(call.query["userId"]).toBeDefined();
    expect(call.props?.isRoot).toBe(true);

    /*
     * And the batched read still separates the two people: Ada's rule must not
     * cover Grace. A batched query folded into a per-user map is exactly where
     * that mistake would hide.
     */
    expect(statuses[0]!["userName"]).toBe("Ada");
    expect(statuses[0]!["isCompliant"]).toBe(true);
    expect(statuses[1]!["userName"]).toBe("Grace");
    expect(statuses[1]!["isCompliant"]).toBe(false);
  });

  test("readiness is not computed at all when no on-call rule is enabled", async () => {
    /*
     * The four channel rules do not consult readiness, so a team that only
     * checks "has a verified email" must not pay for a project-wide readiness
     * pass on every render.
     */
    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasNotificationEmailMethod,
          enabled: true,
        },
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: false },
      ],
      members: [ada],
      rules: [],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    await readCompliance();

    expect(notificationRuleFindBy).not.toHaveBeenCalled();
    expect(incidentSeverityFindBy).not.toHaveBeenCalled();
    expect(escalationUserFindBy).not.toHaveBeenCalled();
    expect(projectFindOneById).not.toHaveBeenCalled();
    // The channel rule it WAS asked about still runs.
    expect(userEmailFindBy).toHaveBeenCalledTimes(1);
  });

  test("a team that does not exist is refused rather than described", async () => {
    /*
     * Refused by the ROUTE now, before the service is reached, and with the same
     * words a team in another project gets - see the authorisation block below
     * for why those two cases must be indistinguishable. The service refuses it
     * as well, on its own, with a BadDataException; that guard is pinned in
     * TeamComplianceServiceBehaviour.test.ts because it protects in-process
     * callers who never come through this route.
     */
    teamFindOneById.mockResolvedValue(null as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });
});

/*
 * --------------------------------------------------------------------------- *
 * GET /team/compliance-status/:teamId - authorisation.
 *
 * PRE-EXISTING HOLE, not a Phase 2 regression, closed here because Phase 2
 * rebuilt what sits behind this route.
 *
 * The route was mounted with UserMiddleware.getUserMiddleware - which admits an
 * anonymous request as UserType.Public and calls next() - and then checked only
 * that `databaseProps.tenantId` was non-empty. tenantId comes from a
 * caller-supplied `tenantid` header. Everything underneath reads with
 * isRoot: true. So a `tenantid` header and a team id were the entire
 * authentication story for "which of these named people cannot be paged", which
 * is a roster of who to phone during an outage and who will never pick up.
 *
 * Worse in combination: the service read the team by id with no projectId in the
 * query, so the team did not even have to belong to the project in the header.
 *
 * Both halves are tested here - the caller has to be a member, AND the team has
 * to be theirs - and the refusals are asserted to be word-for-word identical so
 * the route cannot be used to enumerate team ids across tenants.
 * ---------------------------------------------------------------------------
 */

describe("GET /team/compliance-status/:teamId - authorisation", () => {
  let complianceSpy: jest.SpyInstance;

  beforeEach(() => {
    complianceSpy = jest.spyOn(
      TeamComplianceService,
      "getTeamComplianceStatus",
    );
  });

  test("refuses an unauthenticated caller before reading anything", async () => {
    propsSpy.mockResolvedValue({} as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(teamFindOneById).not.toHaveBeenCalled();
    expect(complianceSpy).not.toHaveBeenCalled();
  });

  test("refuses a public caller that merely supplies a tenantid header", async () => {
    /*
     * THE hole, in its exact shape: the request getUserMiddleware produces for
     * an anonymous caller who sent a `tenantid` header. A project id, no user,
     * no permissions - and, until this change, a complete compliance report.
     */
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: undefined,
      userTenantAccessPermission: undefined,
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(teamFindOneById).not.toHaveBeenCalled();
    expect(complianceSpy).not.toHaveBeenCalled();
  });

  test("refuses a logged-in caller whose tenantid names a project they are not in", async () => {
    propsSpy.mockResolvedValue({
      tenantId: projectId,
      userId: callerUserId,
      // Logged in, but with no permission entry for the project they named.
      userTenantAccessPermission: {},
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(complianceSpy).not.toHaveBeenCalled();
  });

  test("a member of one project cannot read another project's team", async () => {
    /*
     * The caller is a real member of their own project; only the team id is
     * borrowed. Without the resource check this is the whole exploit - every
     * read underneath runs as root, so the borrowed id resolves and the report
     * is rendered for a team the caller has nothing to do with.
     */
    teamFindOneById.mockResolvedValue({
      _id: teamId.toString(),
      projectId: otherProjectId,
    } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect((result.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
    expect(complianceSpy).not.toHaveBeenCalled();
    expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  });

  test("a foreign team and an unknown team are refused in identical words", async () => {
    teamFindOneById.mockResolvedValue({
      _id: teamId.toString(),
      projectId: otherProjectId,
    } as never);
    const foreign: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    teamFindOneById.mockResolvedValue(null as never);
    const unknown: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: ObjectID.generate().toString() },
    });

    expect((foreign.thrownToNext as NotAuthorizedException).message).toBe(
      (unknown.thrownToNext as NotAuthorizedException).message,
    );
    expect((foreign.thrownToNext as NotAuthorizedException).message).toBe(
      REFUSAL,
    );
  });

  test("a team row carrying no projectId at all is refused, not trusted", async () => {
    // The shape a `select` that forgot projectId would produce.
    teamFindOneById.mockResolvedValue({ _id: teamId.toString() } as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeInstanceOf(NotAuthorizedException);
    expect(complianceSpy).not.toHaveBeenCalled();
  });

  test("a malformed team id is rejected as bad data, not turned into a query", async () => {
    /*
     * The old handler built `new ObjectID(req.params.teamId)` from any string
     * and then tested it for truthiness - which an ObjectID always is - so a
     * malformed id travelled all the way to a query that matched nothing and
     * came back as "this team does not exist".
     */
    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: "not-a-uuid" },
    });

    expect(result.thrownToNext).toBeInstanceOf(BadDataException);
    expect(teamFindOneById).not.toHaveBeenCalled();
    expect(complianceSpy).not.toHaveBeenCalled();
  });

  test("the authorised path reads the team's own projectId, as root, and proceeds", async () => {
    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.nextCallCount).toBe(0);

    const read: {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean | undefined };
    } = teamFindOneById.mock.calls[0]![0] as {
      id: ObjectID;
      select: Record<string, unknown>;
      props: { isRoot?: boolean | undefined };
    };

    expect(read.id.toString()).toBe(teamId.toString());
    expect(read.select["projectId"]).toBe(true);
    expect(read.props.isRoot).toBe(true);

    // And the service is asked about the project the CALLER was authorised for.
    expect(complianceSpy).toHaveBeenCalledTimes(1);
    expect(complianceSpy.mock.calls[0]![1]).toEqual(projectId);

    /*
     * Underneath, the service scopes its OWN team read to id and project
     * together. The route's check and this one are not redundant: the route's
     * answers an authorisation question (403, and only for HTTP callers), this
     * one is a data-scoping guard that also covers the on-call banner and any
     * other in-process caller that never passes through the route at all.
     */
    const scoped: CapturedFindBy = firstCall(teamFindOneBy);
    expect(scoped.query["_id"]).toBe(teamId.toString());
    expect((scoped.query["projectId"] as ObjectID).toString()).toBe(
      projectId.toString(),
    );
    expect(scoped.props?.isRoot).toBe(true);
  });
});
