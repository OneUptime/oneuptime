import { mockRouter } from "Common/Tests/Server/API/Helpers";
import TeamComplianceAPI, {
  TEAM_COMPLIANCE_STATUS_ROUTE,
} from "../../../Server/TeamCompliance/TeamComplianceAPI";
import TeamComplianceService from "../../../Server/TeamCompliance/TeamComplianceService";
import CommonAPI from "Common/Server/API/CommonAPI";
import UserMiddleware from "Common/Server/Middleware/UserAuthorization";
import OnCallReadinessService from "Common/Server/Services/OnCallReadinessService";
import AlertSeverityService from "Common/Server/Services/AlertSeverityService";
import IncidentSeverityService from "Common/Server/Services/IncidentSeverityService";
import OnCallDutyPolicyEscalationRuleScheduleService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleScheduleService";
import OnCallDutyPolicyEscalationRuleTeamService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleTeamService";
import OnCallDutyPolicyEscalationRuleUserService from "Common/Server/Services/OnCallDutyPolicyEscalationRuleUserService";
import OnCallDutyPolicyScheduleLayerUserService from "Common/Server/Services/OnCallDutyPolicyScheduleLayerUserService";
import OnCallDutyPolicyService from "Common/Server/Services/OnCallDutyPolicyService";
import OnCallDutyPolicyUserOverrideService from "Common/Server/Services/OnCallDutyPolicyUserOverrideService";
import ProjectService from "Common/Server/Services/ProjectService";
import TeamComplianceSettingService from "Common/Server/Services/TeamComplianceSettingService";
import TeamMemberService from "Common/Server/Services/TeamMemberService";
import TeamService from "Common/Server/Services/TeamService";
import UserCallService from "Common/Server/Services/UserCallService";
import UserEmailService from "Common/Server/Services/UserEmailService";
import UserMicrosoftTeamsService from "Common/Server/Services/UserMicrosoftTeamsService";
import UserNotificationRuleService from "Common/Server/Services/UserNotificationRuleService";
import UserPushService from "Common/Server/Services/UserPushService";
import UserService from "Common/Server/Services/UserService";
import UserSlackService from "Common/Server/Services/UserSlackService";
import UserSmsService from "Common/Server/Services/UserSmsService";
import UserTelegramService from "Common/Server/Services/UserTelegramService";
import UserWebhookService from "Common/Server/Services/UserWebhookService";
import UserWhatsAppService from "Common/Server/Services/UserWhatsAppService";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "Common/Server/Utils/Express";
import Response from "Common/Server/Utils/Response";
import Team from "Common/Models/DatabaseModels/Team";
import Color from "Common/Types/Color";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Dictionary from "Common/Types/Dictionary";
import BadDataException from "Common/Types/Exception/BadDataException";
import Exception from "Common/Types/Exception/Exception";
import ExceptionCode from "Common/Types/Exception/ExceptionCode";
import NotAuthenticatedException from "Common/Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "Common/Types/Exception/NotAuthorizedException";
import NotificationRuleType from "Common/Types/NotificationRule/NotificationRuleType";
import ObjectID from "Common/Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "Common/Types/Permission";
import ComplianceNotificationChannel from "Common/Types/Team/ComplianceNotificationChannel";
import ComplianceRuleType from "Common/Types/Team/ComplianceRuleType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * GET /team/compliance-status/:teamId - the Enterprise team compliance API,
 * with the TeamComplianceService rebuild that sits behind it.
 *
 * Moved out of packages/Common/Tests/Server/API/OnCallReadinessAPI.test.ts
 * with the route itself (the Community / Enterprise split): the route and the
 * service are Enterprise code in ee/Server/TeamCompliance now, while on-call
 * readiness stays core. The compliance rebuild is tested end to end, with the
 * REAL OnCallReadinessService (core) and only the database-facing services
 * stubbed: TeamComplianceServiceBehaviour.test.ts already pins its mapping with
 * readiness stubbed, so what is left worth proving is that the real seam
 * between the two behaves, which is exactly where the four defects used to
 * live.
 *
 * The route is mounted with UserMiddleware.getUserMiddleware, which admits
 * anonymous callers as UserType.Public and takes the project from a
 * caller-supplied `tenantid` header, and everything underneath reads with
 * isRoot: true. The handler is therefore the only gate there is, which is why
 * a disproportionate share of this file is spent on who gets refused.
 *
 * It is also a PLAIN router now. It used to extend BaseAPI<Team>, which
 * registered a second copy of the whole Team CRUD route set on it; the
 * registration block below pins that it carries this one route only. The
 * real-express side of that contract (no router.use() layers, the exact path)
 * is TeamComplianceRouter.test.ts.
 */

jest.mock("Common/Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("Common/Server/Utils/Response", () => {
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

const COMPLIANCE_ROUTE: string = "/team/compliance-status/:teamId";

/*
 * The message every authorisation refusal on these routes carries. Asserting on
 * the literal is the only way to pin the property that matters: "wrong project"
 * and "does not exist" must be indistinguishable to the caller.
 */
const REFUSAL: string = "You are not authorized to access this project's data.";

/*
 * The refusal for a caller with no credentials. Deliberately NOT the sentence
 * above: it is decided before anything project-specific is consulted, so it is
 * the same answer for every project and every id and discloses nothing - and
 * it has to be a 401, because that is the only status the browser client
 * answers by refreshing the session.
 */
function expectAuthenticationRequired(thrown: unknown): void {
  expect(thrown).toBeInstanceOf(NotAuthenticatedException);
  expect((thrown as Exception).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((thrown as Exception).code).toBe(401);
  expect((thrown as Exception).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
}

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
  profilePictureId?: ObjectID | undefined;
}

/** A minimal severity row - the shape both severity services return here. */
interface StubSeverity {
  id: ObjectID;
  name: string;
  order?: number | undefined;
  color?: Color | undefined;
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
let userSlackFindBy: jest.SpyInstance;
let userMicrosoftTeamsFindBy: jest.SpyInstance;
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
    userSlackFindBy,
    userMicrosoftTeamsFindBy,
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

  propsSpy = jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(
      buildMemberProps({ projectId: projectId, userId: callerUserId }),
    );

  jest
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
  userSlackFindBy = jest
    .spyOn(UserSlackService, "findBy")
    .mockResolvedValue([] as never);
  userMicrosoftTeamsFindBy = jest
    .spyOn(UserMicrosoftTeamsService, "findBy")
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
 * Registration. The router carries exactly one route: the compliance status
 * read. The BaseAPI<Team> it used to extend put the whole Team CRUD route set
 * on it as well - a dead, shadowed second copy of routes the primary Team
 * mount already serves.
 * ---------------------------------------------------------------------------
 */

describe("TeamComplianceAPI - route registration", () => {
  test("exports the very router it registered its route on", () => {
    /*
     * The module is `export default router`, not a class: the enterprise
     * module hands it to core as-is from getApiRouters(). If it ever exported
     * something else, the route below would be registered on a router nothing
     * is serving.
     */
    const exported: unknown = TeamComplianceAPI;

    expect(exported).toBe(mockRouter);
  });

  test("registers exactly one route, the compliance status read, and no Team CRUD", () => {
    expect(
      routes().map((route: RegisteredRoute): string => {
        return `${route.method} ${route.uri}`;
      }),
    ).toEqual([`GET ${COMPLIANCE_ROUTE}`]);
  });

  test("the path is byte-identical to the one the Dashboard requests", () => {
    expect(TEAM_COMPLIANCE_STATUS_ROUTE).toBe(COMPLIANCE_ROUTE);
    expect(TEAM_COMPLIANCE_STATUS_ROUTE).toBe(
      `${new Team().getCrudApiPath()!.toString()}/compliance-status/:teamId`,
    );
  });

  test("runs behind the user middleware, and nothing else", () => {
    /*
     * getUserMiddleware is not an authorisation gate - it admits anonymous
     * callers - but it is what populates the request with whatever identity
     * IS present, and without it every caller would arrive at the handler
     * looking anonymous and be refused.
     */
    const route: RegisteredRoute & { middlewares?: Array<unknown> } =
      routeFor(COMPLIANCE_ROUTE);

    expect(route.middleware).toBe(UserMiddleware.getUserMiddleware as unknown);
    expect(route.middlewares).toEqual([
      UserMiddleware.getUserMiddleware as unknown,
    ]);
  });
});

/*
 * --------------------------------------------------------------------------- *
 * The compliance status, exercised through its own route with the REAL
 * readiness service underneath.
 *
 * Teams > View > Compliance renders this payload field for field - including
 * the reason strings, which it prints as prose - so the shape is a hard
 * contract: TeamComplianceStatusJSON in Common/Types/Team, which the Dashboard
 * is typed against too. TeamComplianceEvaluator.test.ts pins every judgement
 * and TeamComplianceServiceBehaviour.test.ts every read with readiness stubbed;
 * what is left worth proving here is that the real seams behave - the route to
 * the service, and the service to the real readiness computation, which is
 * where the old defects lived.
 * ---------------------------------------------------------------------------
 */

interface StubRule {
  _id: string;
  userId: ObjectID;
  ruleType: NotificationRuleType;
  incidentSeverityId?: ObjectID | undefined;
  alertSeverityId?: ObjectID | undefined;
  isOptOut?: boolean | null | undefined;
  userCallId?: ObjectID | undefined;
  userSmsId?: ObjectID | undefined;
  userEmailId?: ObjectID | undefined;
  userPushId?: ObjectID | undefined;
  userTelegramId?: ObjectID | undefined;
  userSlackId?: ObjectID | undefined;
  userMicrosoftTeamsId?: ObjectID | undefined;
  userWhatsAppId?: ObjectID | undefined;
  userWebhookId?: ObjectID | undefined;
}

/*
 * A compliance rule as the team's settings read hands it back. Severities are
 * the relation rows, so they carry their project.
 */
interface StubSetting {
  ruleType: ComplianceRuleType;
  enabled: boolean;
  notificationChannel?: ComplianceNotificationChannel | undefined;
  incidentSeverities?: Array<StubSeverity> | undefined;
  alertSeverities?: Array<StubSeverity> | undefined;
}

/*
 * A notification-method row. It carries both `_id` and the `id` a model would
 * have, because the real readiness service reads the one and the compliance
 * service the other - and both read these same stubs.
 */
interface StubMethod {
  _id: string;
  id: ObjectID;
  userId: ObjectID;
  isVerified: boolean;
  phone?: string | undefined;
  deviceName?: string | undefined;
}

function methodRow(data: {
  userId: ObjectID;
  isVerified: boolean;
}): StubMethod {
  const id: ObjectID = ObjectID.generate();

  return {
    _id: id.toString(),
    id: id,
    userId: data.userId,
    isVerified: data.isVerified,
    phone: "+15550100",
    deviceName: "Pixel",
  };
}

describe("GET /team/compliance-status/:teamId - the compliance status", () => {
  let ada: StubUser;
  let grace: StubUser;
  let critical: StubSeverity;
  let major: StubSeverity;
  let page: StubSeverity;

  function settingRows(
    settings: Array<StubSetting>,
  ): Array<Record<string, unknown>> {
    return settings.map(
      (stubSetting: StubSetting, index: number): Record<string, unknown> => {
        const relation: (
          severities: Array<StubSeverity> | undefined,
        ) => Array<Record<string, unknown>> = (
          severities: Array<StubSeverity> | undefined,
        ): Array<Record<string, unknown>> => {
          return (severities || []).map(
            (severity: StubSeverity): Record<string, unknown> => {
              return {
                _id: severity.id.toString(),
                name: severity.name,
                order: severity.order,
                color: severity.color,
                projectId: projectId,
              };
            },
          );
        };

        return {
          _id: `5e771000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          ruleType: stubSetting.ruleType,
          enabled: stubSetting.enabled,
          notificationChannel: stubSetting.notificationChannel,
          createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, index)),
          incidentSeverities: relation(stubSetting.incidentSeverities),
          alertSeverities: relation(stubSetting.alertSeverities),
        };
      },
    );
  }

  function stage(data: {
    settings: Array<StubSetting>;
    members: Array<StubUser>;
    rules: Array<StubRule>;
    incidentSeverities: Array<StubSeverity>;
    alertSeverities: Array<StubSeverity>;
    callMethods?: Array<StubMethod> | undefined;
    pushMethods?: Array<StubMethod> | undefined;
  }): void {
    complianceSettingFindBy.mockResolvedValue(
      settingRows(data.settings) as never,
    );

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

    /*
     * ONE list for every notification-rule read, the readiness service's and
     * the compliance service's alike. Neither may trust its query alone to have
     * filtered the rows, so a single list is the harder test.
     */
    notificationRuleFindBy.mockResolvedValue(data.rules as never);
    incidentSeverityFindBy.mockResolvedValue(data.incidentSeverities as never);
    alertSeverityFindBy.mockResolvedValue(data.alertSeverities as never);
    userCallFindBy.mockResolvedValue((data.callMethods || []) as never);
    userPushFindBy.mockResolvedValue((data.pushMethods || []) as never);
  }

  async function readCompliance(): Promise<Record<string, unknown>> {
    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.thrownToNext).toBeUndefined();
    expect(result.nextCallCount).toBe(0);

    return jsonPayload();
  }

  function statusesOf(
    payload: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    return payload["userComplianceStatuses"] as Array<Record<string, unknown>>;
  }

  function rulesOf(
    payload: Record<string, unknown>,
  ): Array<Record<string, unknown>> {
    return payload["complianceSettings"] as Array<Record<string, unknown>>;
  }

  function statusFor(
    payload: Record<string, unknown>,
    user: StubUser,
  ): Record<string, unknown> {
    const status: Record<string, unknown> | undefined = statusesOf(
      payload,
    ).find((candidate: Record<string, unknown>): boolean => {
      return candidate["userId"] === user.id.toString();
    });

    if (!status) {
      throw new Error(`No status for ${user.name}`);
    }

    return status;
  }

  function reasonsFor(
    payload: Record<string, unknown>,
    user: StubUser,
  ): Array<string> {
    return (
      statusFor(payload, user)["nonCompliantRules"] as Array<
        Record<string, unknown>
      >
    ).map((issue: Record<string, unknown>): string => {
      return issue["reason"] as string;
    });
  }

  beforeEach(() => {
    ada = { id: ObjectID.generate(), name: "Ada", email: "ada@example.com" };
    grace = {
      id: ObjectID.generate(),
      name: "Grace",
      email: "grace@example.com",
    };
    critical = { id: ObjectID.generate(), name: "Critical", order: 1 };
    major = { id: ObjectID.generate(), name: "Major", order: 2 };
    page = { id: ObjectID.generate(), name: "Page", order: 1 };
  });

  test("the response is exactly the TeamComplianceStatusJSON contract", async () => {
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

    /*
     * Object.keys counts a key whose value is undefined, so these pin that no
     * field is added, dropped or sent empty behind the Dashboard's back.
     */
    expect(Object.keys(payload).sort()).toEqual([
      "complianceSettings",
      "evaluatedAt",
      "teamId",
      "teamName",
      "userComplianceStatuses",
    ]);
    expect(payload["teamId"]).toBe(teamId.toString());
    expect(payload["teamName"]).toBe("Platform On-Call");
    expect(typeof payload["evaluatedAt"]).toBe("string");
    expect(new Date(payload["evaluatedAt"] as string).toISOString()).toBe(
      payload["evaluatedAt"],
    );

    const rules: Array<Record<string, unknown>> = rulesOf(payload);
    expect(rules).toHaveLength(2);

    for (const rule of rules) {
      expect(Object.keys(rule).sort()).toEqual([
        "appliesToAllSeverities",
        "compliantCount",
        "enabled",
        "nonCompliantCount",
        "notificationChannel",
        "ruleType",
        "settingId",
        "severities",
        "severityKind",
        "warnings",
      ]);
    }

    expect(rules[0]).toEqual({
      settingId: "5e771000-0000-4000-8000-000000000000",
      ruleType: ComplianceRuleType.HasNotificationEmailMethod,
      enabled: true,
      notificationChannel: null,
      severityKind: null,
      appliesToAllSeverities: false,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 1,
      warnings: [],
    });
    expect(rules[1]).toEqual({
      settingId: "5e771000-0000-4000-8000-000000000001",
      ruleType: ComplianceRuleType.HasIncidentOnCallRules,
      enabled: true,
      notificationChannel: null,
      severityKind: "Incident",
      appliesToAllSeverities: true,
      severities: [],
      compliantCount: 0,
      nonCompliantCount: 1,
      warnings: [],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(payload);
    expect(statuses).toHaveLength(1);
    // No profile picture: the key is omitted, not sent as undefined.
    expect(Object.keys(statuses[0]!).sort()).toEqual([
      "isCompliant",
      "nonCompliantRules",
      "userEmail",
      "userId",
      "userName",
    ]);
    expect(statuses[0]!["userId"]).toBe(ada.id.toString());
    expect(statuses[0]!["userName"]).toBe("Ada");
    expect(statuses[0]!["userEmail"]).toBe("ada@example.com");
    expect(statuses[0]!["isCompliant"]).toBe(false);
    /*
     * The reason strings are printed verbatim by the Dashboard, so their exact
     * wording is part of the payload contract. A method rule and an on-call
     * rule are asserted together to show neither vocabulary shifted.
     */
    expect(statuses[0]!["nonCompliantRules"]).toEqual([
      {
        settingId: "5e771000-0000-4000-8000-000000000000",
        ruleType: ComplianceRuleType.HasNotificationEmailMethod,
        reason: "No verified email address configured for notifications",
      },
      {
        settingId: "5e771000-0000-4000-8000-000000000001",
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        reason: "Missing notification rules for incident severities: Critical",
      },
    ]);

    // And the whole thing survives the trip through JSON unchanged.
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload);
  });

  test("a member's profile picture id is sent as a string", async () => {
    const pictureId: ObjectID = ObjectID.generate();

    stage({
      settings: [],
      members: [{ ...ada, profilePictureId: pictureId }],
      rules: [],
      incidentSeverities: [],
      alertSeverities: [],
    });

    expect(statusesOf(await readCompliance())[0]!["userProfilePictureId"]).toBe(
      pictureId.toString(),
    );
  });

  test("DEFECT closed: a rule on Telegram, WhatsApp, Slack, Teams or a webhook counts for an any-channel rule", async () => {
    /*
     * The old check read userCallId/userSmsId/userEmailId/userPushId off the
     * rule row and treated a row carrying none of them as no rule at all, so a
     * responder reachable only on Telegram, WhatsApp or a webhook was reported
     * non-compliant while the runtime was quite happily paging them. A false RED
     * teaches admins to ignore the table, which is worse than no table.
     */
    const minor: StubSeverity = { id: ObjectID.generate(), name: "Minor" };
    const warn: StubSeverity = { id: ObjectID.generate(), name: "Warn" };

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
          _id: "rule-slack",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: minor.id,
          userSlackId: ObjectID.generate(),
        },
        {
          _id: "rule-webhook",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: page.id,
          userWebhookId: ObjectID.generate(),
        },
        {
          _id: "rule-microsoft-teams",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: warn.id,
          userMicrosoftTeamsId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical, major, minor],
      alertSeverities: [page, warn],
    });

    const statuses: Array<Record<string, unknown>> = statusesOf(
      await readCompliance(),
    );

    expect(statuses[0]!["isCompliant"]).toBe(true);
    expect(statuses[0]!["nonCompliantRules"]).toEqual([]);
  });

  test("an any-channel rule reads no channel column - which channels count is readiness's judgement", async () => {
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

    // The one rule read is readiness's, and it selects none of the nine columns.
    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);

    for (const column of [
      "userCallId",
      "userSmsId",
      "userEmailId",
      "userPushId",
      "userTelegramId",
      "userSlackId",
      "userMicrosoftTeamsId",
      "userWhatsAppId",
      "userWebhookId",
    ]) {
      expect(call.select?.[column]).toBeUndefined();
    }

    expect(call.select?.["ruleType"]).toBe(true);
    expect(call.select?.["incidentSeverityId"]).toBe(true);
    expect(call.select?.["alertSeverityId"]).toBe(true);
    expect(call.select?.["isOptOut"]).toBe(true);
  });

  test("DEFECT closed: a WHEN_USER_GOES_OFF_CALL rule is no longer incident coverage", async () => {
    /*
     * The false GREEN, and the more dangerous of the two directions: the owner
     * was told a responder was covered for Sev1 incidents when their only rule
     * fired as they went off call.
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

    const payload: Record<string, unknown> = await readCompliance();

    expect(statusFor(payload, ada)["isCompliant"]).toBe(false);
    expect(reasonsFor(payload, ada)).toEqual([
      "Missing notification rules for incident severities: Critical",
    ]);
  });

  test("DEFECT closed: an alert rule does not satisfy an incident severity of the same id", async () => {
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

    expect(reasonsFor(await readCompliance(), ada)).toEqual([
      "Missing notification rules for incident severities: Critical",
    ]);
  });

  test("a legacy rule row with a NULL isOptOut still counts as coverage", async () => {
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
          isOptOut: null,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical],
      alertSeverities: [],
    });

    expect(statusFor(await readCompliance(), ada)["isCompliant"]).toBe(true);
  });

  test("for an any-channel rule, an explicitly opted-out severity is coverage, not a gap", async () => {
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

    // Deliberate silence is not a compliance failure of an any-channel rule.
    expect(statusFor(await readCompliance(), ada)["isCompliant"]).toBe(true);
  });

  test("episode rules are answered from the real readiness episode cells", async () => {
    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasIncidentEpisodeOnCallRules,
          enabled: true,
        },
      ],
      members: [ada, grace],
      rules: [
        {
          _id: "rule-ada-episode-critical",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          incidentSeverityId: critical.id,
          userEmailId: ObjectID.generate(),
        },
        {
          _id: "rule-ada-episode-major",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT_EPISODE,
          incidentSeverityId: major.id,
          userEmailId: ObjectID.generate(),
        },
        // Grace has plain incident rules only - not episode coverage.
        {
          _id: "rule-grace-incident",
          userId: grace.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical, major],
      alertSeverities: [],
    });

    const payload: Record<string, unknown> = await readCompliance();

    expect(statusFor(payload, ada)["isCompliant"]).toBe(true);
    expect(reasonsFor(payload, grace)).toEqual([
      "Missing notification rules for incident episode severities: Critical, Major",
    ]);
  });

  test("Call for Critical incidents, end to end: covered, missing, unverified - and the project's call switch", async () => {
    const carol: StubUser = {
      id: ObjectID.generate(),
      name: "Carol",
      email: "carol@example.com",
    };
    const adaPhone: StubMethod = methodRow({
      userId: ada.id,
      isVerified: true,
    });
    const carolPhone: StubMethod = methodRow({
      userId: carol.id,
      isVerified: false,
    });

    critical.color = new Color("#9f1239");

    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: true,
          notificationChannel: ComplianceNotificationChannel.Call,
          incidentSeverities: [critical],
        },
      ],
      members: [ada, grace, carol],
      rules: [
        {
          _id: "rule-ada-call",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userCallId: adaPhone.id,
        },
        // Grace would be emailed for Critical, never called.
        {
          _id: "rule-grace-email",
          userId: grace.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userEmailId: ObjectID.generate(),
        },
        // Carol's rule dials a number she never verified.
        {
          _id: "rule-carol-call",
          userId: carol.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userCallId: carolPhone.id,
        },
        // Major is out of the rule's scope, so nobody needs a rule for it.
      ],
      incidentSeverities: [critical, major],
      alertSeverities: [],
      callMethods: [adaPhone, carolPhone],
    });
    projectFindOneById.mockResolvedValue({
      id: projectId,
      enableCallNotifications: false,
    } as never);

    const payload: Record<string, unknown> = await readCompliance();

    expect(rulesOf(payload)).toEqual([
      {
        settingId: "5e771000-0000-4000-8000-000000000000",
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        enabled: true,
        notificationChannel: ComplianceNotificationChannel.Call,
        severityKind: "Incident",
        appliesToAllSeverities: false,
        severities: [
          { id: critical.id.toString(), name: "Critical", color: "#9f1239" },
        ],
        compliantCount: 1,
        nonCompliantCount: 2,
        warnings: [
          "Call notifications are switched off for this project, so members will not be notified by Call even when they meet this rule. Turn them on in Project Settings > Notification Settings.",
        ],
      },
    ]);

    // A project-wide switch is the rule's warning, not Ada's failure.
    expect(statusFor(payload, ada)["isCompliant"]).toBe(true);
    expect(reasonsFor(payload, grace)).toEqual([
      "No Call rule for incident severities: Critical",
    ]);
    expect(reasonsFor(payload, carol)).toEqual([
      "The Call rule for incident severities Critical points at an unverified phone number for calls",
    ]);

    // No readiness pass for a channel rule.
    expect(escalationUserFindBy).not.toHaveBeenCalled();

    // The one rule read, and the one read of the phones it points at.
    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);
    expect(firstCall(notificationRuleFindBy).select?.["userCallId"]).toBe(true);
    expect(userCallFindBy).toHaveBeenCalledTimes(1);
    expect(firstCall(userCallFindBy).query["projectId"]).toBe(projectId);
  });

  test("Push for critical alerts: an opt-out is not a push rule", async () => {
    const adaDevice: StubMethod = methodRow({
      userId: ada.id,
      isVerified: true,
    });

    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasAlertOnCallRules,
          enabled: true,
          notificationChannel: ComplianceNotificationChannel.Push,
          alertSeverities: [page],
        },
      ],
      members: [ada, grace],
      rules: [
        {
          _id: "rule-ada-push",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: page.id,
          userPushId: adaDevice.id,
        },
        {
          _id: "rule-grace-opt-out",
          userId: grace.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_ALERT,
          alertSeverityId: page.id,
          isOptOut: true,
        },
      ],
      incidentSeverities: [],
      alertSeverities: [page],
      pushMethods: [adaDevice],
    });

    const payload: Record<string, unknown> = await readCompliance();

    expect(statusFor(payload, ada)["isCompliant"]).toBe(true);
    expect(reasonsFor(payload, grace)).toEqual([
      "Opted out of alert notifications for: Page",
    ]);
    // Push has no project switch: no project read, no warning.
    expect(projectFindOneById).not.toHaveBeenCalled();
    expect(rulesOf(payload)[0]!["warnings"]).toEqual([]);
  });

  test("an any-channel rule and a channel rule side by side: readiness's rule read and the compliance rule read are separate", async () => {
    const adaPhone: StubMethod = methodRow({
      userId: ada.id,
      isVerified: true,
    });

    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: true,
          notificationChannel: ComplianceNotificationChannel.Call,
        },
      ],
      members: [ada],
      rules: [
        {
          _id: "rule-ada-call-critical",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userCallId: adaPhone.id,
        },
        {
          _id: "rule-ada-email-major",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: major.id,
          userEmailId: ObjectID.generate(),
        },
      ],
      incidentSeverities: [critical, major],
      alertSeverities: [],
      callMethods: [adaPhone],
    });

    const payload: Record<string, unknown> = await readCompliance();

    // Any channel: both severities have a rule. Call: only Critical does.
    expect(reasonsFor(payload, ada)).toEqual([
      "No Call rule for incident severities: Major",
    ]);

    const reads: Array<CapturedFindBy> = callsOf(notificationRuleFindBy);
    expect(reads).toHaveLength(2);

    const withChannel: Array<CapturedFindBy> = reads.filter(
      (call: CapturedFindBy): boolean => {
        return call.select?.["userCallId"] === true;
      },
    );
    expect(withChannel).toHaveLength(1);
    expect(Object.keys(withChannel[0]!.select || {}).sort()).toEqual([
      "_id",
      "alertSeverityId",
      "incidentSeverityId",
      "isOptOut",
      "ruleType",
      "userCall",
      "userCallId",
      "userEmail",
      "userId",
      "userMicrosoftTeams",
      "userPush",
      "userSlack",
      "userSms",
      "userTelegram",
      "userWebhook",
      "userWhatsApp",
    ]);
  });

  test("DEFECT closed: not one read in the whole render carries the literal limit 100", async () => {
    /*
     * The old code capped team members, users and alert severities at 100 while
     * capping incident severities at LIMIT_PER_PROJECT. Truncation is the worst
     * failure mode a compliance page has: the 101st member was not reported
     * non-compliant, they were simply absent. Sweeping every read the render
     * makes - the compliance service's and the readiness service's - is the
     * assertion that cannot be satisfied by fixing some call sites and missing
     * another.
     */
    const adaPhone: StubMethod = methodRow({
      userId: ada.id,
      isVerified: true,
    });

    stage({
      settings: [
        { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
        { ruleType: ComplianceRuleType.HasAlertOnCallRules, enabled: true },
        {
          ruleType: ComplianceRuleType.HasIncidentOnCallRules,
          enabled: true,
          notificationChannel: ComplianceNotificationChannel.Call,
        },
        {
          ruleType: ComplianceRuleType.HasNotificationEmailMethod,
          enabled: true,
        },
      ],
      members: [ada, grace],
      rules: [
        {
          _id: "rule-ada-call",
          userId: ada.id,
          ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
          incidentSeverityId: critical.id,
          userCallId: adaPhone.id,
        },
      ],
      incidentSeverities: [critical, major],
      alertSeverities: [page],
      callMethods: [adaPhone],
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
    expect(readsInspected).toBeGreaterThan(15);

    expect(firstCall(complianceSettingFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(teamMemberFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(userFindBy).limit).toBe(LIMIT_PER_PROJECT);
    // Both severity kinds, which is where the two halves used to disagree.
    expect(firstCall(incidentSeverityFindBy).limit).toBe(LIMIT_PER_PROJECT);
    expect(firstCall(alertSeverityFindBy).limit).toBe(LIMIT_PER_PROJECT);

    for (const call of callsOf(notificationRuleFindBy)) {
      expect(call.limit).toBe(LIMIT_PER_PROJECT);
    }
  });

  test("DEFECT closed: the read count does not grow with members or severities", async () => {
    /*
     * The N+1. The old service issued one findBy per severity per user, so a
     * team of 20 in a project with 5 severities cost 100 round trips to render
     * one page. The proof is comparative rather than absolute: the same render
     * with three times the members and four times the severities must cost the
     * same number of reads - of every table, readiness's included.
     */
    const settings: Array<StubSetting> = [
      { ruleType: ComplianceRuleType.HasIncidentOnCallRules, enabled: true },
      {
        ruleType: ComplianceRuleType.HasIncidentOnCallRules,
        enabled: true,
        notificationChannel: ComplianceNotificationChannel.Call,
      },
      {
        ruleType: ComplianceRuleType.HasAlertEpisodeOnCallRules,
        enabled: true,
        notificationChannel: ComplianceNotificationChannel.Push,
      },
      { ruleType: ComplianceRuleType.HasNotificationSMSMethod, enabled: true },
    ];

    function rulesFor(
      members: Array<StubUser>,
      severities: Array<StubSeverity>,
      phones: Array<StubMethod>,
    ): Array<StubRule> {
      const rules: Array<StubRule> = [];

      members.forEach((member: StubUser, index: number): void => {
        for (const severity of severities) {
          rules.push({
            _id: ObjectID.generate().toString(),
            userId: member.id,
            ruleType: NotificationRuleType.ON_CALL_EXECUTED_INCIDENT,
            incidentSeverityId: severity.id,
            userCallId: phones[index]!.id,
          });
        }
      });

      return rules;
    }

    const adaPhone: StubMethod = methodRow({
      userId: ada.id,
      isVerified: true,
    });

    stage({
      settings: settings,
      members: [ada],
      rules: rulesFor([ada], [critical], [adaPhone]),
      incidentSeverities: [critical],
      alertSeverities: [page],
      callMethods: [adaPhone],
    });

    await readCompliance();

    const smallCounts: Array<number> = everyFindBySpy().map(
      (spy: jest.SpyInstance): number => {
        return spy.mock.calls.length;
      },
    );

    expect(notificationRuleFindBy.mock.calls.length).toBe(2);

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
    const members: Array<StubUser> = [ada, grace, carol];
    const phones: Array<StubMethod> = members.map(
      (member: StubUser): StubMethod => {
        return methodRow({ userId: member.id, isVerified: true });
      },
    );

    stage({
      settings: settings,
      members: members,
      rules: rulesFor(members, [critical, major, minor, trivial], phones),
      incidentSeverities: [critical, major, minor, trivial],
      alertSeverities: [page, { id: ObjectID.generate(), name: "Ticket" }],
      callMethods: phones,
    });

    await readCompliance();

    expect(
      everyFindBySpy().map((spy: jest.SpyInstance): number => {
        return spy.mock.calls.length;
      }),
    ).toEqual(smallCounts);
  });

  test("one notification-rule read covers every member for an any-channel rule, batched on userId", async () => {
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

    const payload: Record<string, unknown> = await readCompliance();

    expect(notificationRuleFindBy).toHaveBeenCalledTimes(1);

    const call: CapturedFindBy = firstCall(notificationRuleFindBy);
    expect(call.query["userId"]).toBeDefined();
    expect(call.props?.isRoot).toBe(true);

    // The batched read still separates the two people: Ada's rule does not cover Grace.
    expect(statusFor(payload, ada)["isCompliant"]).toBe(true);
    expect(statusFor(payload, grace)["isCompliant"]).toBe(false);
  });

  test("readiness is not computed at all when no on-call rule is enabled", async () => {
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
    // The method rule it WAS asked about still runs - once, for everybody.
    expect(userEmailFindBy).toHaveBeenCalledTimes(1);
  });

  test("a disabled rule is listed, but checked against nobody", async () => {
    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasNotificationCallMethod,
          enabled: false,
        },
      ],
      members: [ada],
      rules: [],
      incidentSeverities: [],
      alertSeverities: [],
    });

    const payload: Record<string, unknown> = await readCompliance();

    expect(rulesOf(payload)[0]).toMatchObject({
      enabled: false,
      compliantCount: 0,
      nonCompliantCount: 0,
      warnings: [],
    });
    expect(statusFor(payload, ada)["isCompliant"]).toBe(true);
    expect(userCallFindBy).not.toHaveBeenCalled();
  });

  test("a team that does not exist is refused rather than described", async () => {
    /*
     * Refused by the ROUTE, before the service is reached, and with the same
     * words a team in another project gets - see the authorisation block below
     * for why those two cases must be indistinguishable. The service refuses it
     * as well, on its own; that guard is pinned in
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

  test("a failure underneath reaches the error handler instead of a half-built payload", async () => {
    stage({
      settings: [
        {
          ruleType: ComplianceRuleType.HasNotificationEmailMethod,
          enabled: true,
        },
      ],
      members: [ada],
      rules: [],
      incidentSeverities: [],
      alertSeverities: [],
    });
    userEmailFindBy.mockRejectedValue(new Error("connection reset") as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expect(result.nextCallCount).toBe(1);
    expect((result.thrownToNext as Error).message).toBe("connection reset");
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

  // Was a BadDataException (400) before the credential check.
  test("refuses an unauthenticated caller with 401 before reading anything", async () => {
    propsSpy.mockResolvedValue({} as never);

    const result: RouteCallResult = await callGetRoute({
      uri: COMPLIANCE_ROUTE,
      params: { teamId: teamId.toString() },
    });

    expectAuthenticationRequired(result.thrownToNext);
    expect(teamFindOneById).not.toHaveBeenCalled();
    expect(complianceSpy).not.toHaveBeenCalled();
  });

  test("refuses a public caller that merely supplies a tenantid header with 401", async () => {
    /*
     * THE hole, in its exact shape: the request getUserMiddleware produces for
     * an anonymous caller who sent a `tenantid` header. A project id, no user,
     * no permissions - and, until this change, a complete compliance report.
     *
     * Refused as unauthenticated (401), not with the member refusal it used to
     * get: this is also what a signed-in admin's request looks like once the
     * access-token cookie has expired, and only a 401 makes the dashboard
     * refresh the session and resend.
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

    expectAuthenticationRequired(result.thrownToNext);
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
