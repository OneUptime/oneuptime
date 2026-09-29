import { mockRouter } from "./Helpers";
import "../../../Server/API/AIInvestigationAPI";
import "../../../Server/API/AIInsightAPI";
import "../../../Server/API/AIReadinessAPI";
import "../../../Server/API/AutoRemediationAPI";
import CodeFixRunAPI from "../../../Server/API/CodeFixRunAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIInsightService from "../../../Server/Services/AIInsightService";
import AIRunEventService from "../../../Server/Services/AIRunEventService";
import AIRunService from "../../../Server/Services/AIRunService";
import AlertService from "../../../Server/Services/AlertService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import IncidentService from "../../../Server/Services/IncidentService";
import LlmLogService from "../../../Server/Services/LlmLogService";
import ProjectService from "../../../Server/Services/ProjectService";
import RunbookRuleEngineService from "../../../Server/Services/RunbookRuleEngineService";
import ServiceService from "../../../Server/Services/ServiceService";
import SpanService from "../../../Server/Services/SpanService";
import CodeFixReadiness from "../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import FixFromIncidentTaskTrigger from "../../../Server/Utils/AI/SRE/FixFromIncidentTaskTrigger";
import FixPerformanceTaskTrigger from "../../../Server/Utils/AI/SRE/FixPerformanceTaskTrigger";
import InvestigationEligibility from "../../../Server/Utils/AI/SRE/InvestigationEligibility";
import TelemetryImprovementTaskTrigger from "../../../Server/Utils/AI/SRE/TelemetryImprovementTaskTrigger";
import AIToolbox from "../../../Server/Utils/AI/Toolbox/Index";
import CommandPlanExecutor from "../../../Server/Utils/AutoRemediation/CommandPlanExecutor";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIInsightHumanVerdict from "../../../Types/AI/AIInsightHumanVerdict";
import AIRunHumanVerdict from "../../../Types/AI/AIRunHumanVerdict";
import CodeFixTaskType from "../../../Types/AI/CodeFixTaskType";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendJsonObjectResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
  };
});

/*
 * The customer report behind this file: a Dashboard tab left open past the
 * 15-minute access-token lifetime, one click, and "You are not authorized to
 * access this project's data." The access-token cookie expires together with
 * the JWT inside it, so the browser had simply stopped sending it.
 * getUserMiddleware lets such a request through as Public - no userId, but
 * the page's tenantid header - and every route below then answered it 422
 * with the message above. The browser client (Common/UI/Utils/API/API.ts)
 * refreshes the session and replays the request on a 401 and on nothing
 * else, so a signed-in user was left looking at an authorization error.
 *
 * These are the AI and automation routes that act AS A PERSON (they record
 * who confirmed, approved, dismissed or asked), so each requires a logged-in
 * user and each now goes through CommonAPI.assertAuthenticatedUser:
 *
 *   - no credentials at all       -> 401 NotAuthenticatedException
 *   - a project API key (no user) -> 422 NotAuthorizedException, unchanged.
 *     A key is authenticated; a 401 would only send its client off to
 *     refresh a session it never had.
 *   - a logged-in user            -> on to the route's own access check.
 *
 * Every refusal is also asserted to happen before any read, write, AI call
 * or command execution.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const SUBJECT_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUN_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const INSIGHT_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SUGGESTION_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);
const SERVICE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const USER_SESSION_REQUIRED: string = "A logged-in user session is required.";

// Every read, write, AI call or execution these routes can reach.
type SideEffect =
  | "incidentRead"
  | "alertRead"
  | "investigationRunsRead"
  | "investigationRunRead"
  | "investigationVerdictWrite"
  | "runEventsRead"
  | "notStartedReasonRead"
  | "toolExecution"
  | "spansRead"
  | "serviceRead"
  | "fixTaskCreate"
  | "performanceFixTaskCreate"
  | "telemetryTaskCreate"
  | "insightRead"
  | "insightVerdictWrite"
  | "insightResolve"
  | "insightReopen"
  | "insightTriageRead"
  | "suggestionRead"
  | "suggestionTransition"
  | "commandPlanExecution"
  | "runbookStart"
  | "projectRead"
  | "llmLogsRead"
  | "readinessRead";

type HumanOnlyRoute = {
  uri: string;
  params: Dictionary<string>;

  // A well-formed body, so a refusal is about the caller and never the input.
  body: JSONObject;

  // What a project API key is told: authenticated, but not a person.
  notAUserMessage: string;

  // The access-checked read a logged-in caller reaches first.
  firstRead: SideEffect;
};

const AI_INVESTIGATION_ROUTES: Array<HumanOnlyRoute> = [
  {
    uri: "/ai-investigation/incident",
    params: {},
    body: { incidentId: SUBJECT_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "incidentRead",
  },
  {
    uri: "/ai-investigation/alert",
    params: {},
    body: { alertId: SUBJECT_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "alertRead",
  },
  {
    uri: "/ai-investigation/evidence",
    params: {},
    body: {
      subjectType: "incident",
      subjectId: SUBJECT_ID.toString(),
      investigationRunId: RUN_ID.toString(),
      citationId: "C1",
    },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "incidentRead",
  },
  {
    uri: "/ai-investigation/verdict",
    params: {},
    body: {
      subjectType: "incident",
      subjectId: SUBJECT_ID.toString(),
      investigationRunId: RUN_ID.toString(),
      verdict: AIRunHumanVerdict.Confirmed,
    },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "incidentRead",
  },
  {
    uri: "/ai-investigation/create-fix-task",
    params: {},
    body: {
      subjectType: "alert",
      subjectId: SUBJECT_ID.toString(),
      investigationRunId: RUN_ID.toString(),
    },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "alertRead",
  },
  {
    uri: "/ai-investigation/create-performance-fix-task",
    params: {},
    body: { traceId: "4bf92f3577b34da6a3ce929d0e0e4736" },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "spansRead",
  },
  {
    uri: "/ai-investigation/create-telemetry-improvement-task",
    params: {},
    body: {
      telemetryServiceId: SERVICE_ID.toString(),
      taskType: CodeFixTaskType.ImproveLogging,
    },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "serviceRead",
  },
];

const AI_INSIGHT_ROUTES: Array<HumanOnlyRoute> = [
  {
    uri: "/ai-insight/verdict",
    params: {},
    body: {
      insightId: INSIGHT_ID.toString(),
      verdict: AIInsightHumanVerdict.Confirmed,
    },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "insightRead",
  },
  {
    uri: "/ai-insight/resolve",
    params: {},
    body: { insightId: INSIGHT_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "insightRead",
  },
  {
    uri: "/ai-insight/reopen",
    params: {},
    body: { insightId: INSIGHT_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "insightRead",
  },
  {
    uri: "/ai-insight/triage-run",
    params: {},
    body: { insightId: INSIGHT_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "insightRead",
  },
];

const AUTO_REMEDIATION_ROUTES: Array<HumanOnlyRoute> = [
  {
    uri: "/auto-remediation/approve",
    params: {},
    body: { suggestionId: SUGGESTION_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "suggestionRead",
  },
  {
    uri: "/auto-remediation/dismiss",
    params: {},
    body: { suggestionId: SUGGESTION_ID.toString() },
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "suggestionRead",
  },
];

const CODE_FIX_RUN_ROUTES: Array<HumanOnlyRoute> = [
  {
    uri: "/code-fix-run/get/:runId",
    params: { runId: RUN_ID.toString() },
    body: {},
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "projectRead",
  },
  {
    uri: "/code-fix-run/logs/:runId",
    params: { runId: RUN_ID.toString() },
    body: {},
    notAUserMessage: USER_SESSION_REQUIRED,
    firstRead: "projectRead",
  },
];

const AI_READINESS_ROUTES: Array<HumanOnlyRoute> = [
  {
    uri: "/ai-readiness/code-fix",
    params: {},
    body: {},
    // This route words its refusal for its own page.
    notAUserMessage: "AI readiness requires a logged-in user session.",
    firstRead: "readinessRead",
  },
];

const ALL_ROUTES: Array<HumanOnlyRoute> = [
  ...AI_INVESTIGATION_ROUTES,
  ...AI_INSIGHT_ROUTES,
  ...AUTO_REMEDIATION_ROUTES,
  ...CODE_FIX_RUN_ROUTES,
  ...AI_READINESS_ROUTES,
];

function tenantPermissions(
  permissions: Array<Permission>,
): Dictionary<UserTenantAccessPermission> {
  const dictionary: Dictionary<UserTenantAccessPermission> = {};

  dictionary[PROJECT_ID.toString()] = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: permissions.map((permission: Permission) => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      } as UserPermission;
    }),
    isBlockPermission: false,
  } as UserTenantAccessPermission;

  return dictionary;
}

/*
 * The request an expired session produces, as getDatabaseCommonInteractionProps
 * builds it: Public, no user, the page's tenantid header.
 */
function expiredSessionProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.Public,
    userId: undefined,
    userTenantAccessPermission: undefined,
  };
}

/*
 * A project API key: no userId, userType API, and the grants
 * ProjectMiddleware attached to the key itself - here, everything.
 */
function apiKeyProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.API,
    userId: undefined,
    userTenantAccessPermission: tenantPermissions([Permission.ProjectOwner]),
  };
}

// A signed-in project owner whose session is still valid.
function memberProps(): DatabaseCommonInteractionProps {
  return {
    tenantId: PROJECT_ID,
    userType: UserType.User,
    userId: USER_ID,
    userTenantAccessPermission: tenantPermissions([Permission.ProjectOwner]),
  };
}

function withProps(props: DatabaseCommonInteractionProps): void {
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(props);
}

type RouteCall = {
  thrown: unknown;
  nextCallCount: number;
};

async function callRoute(route: HumanOnlyRoute): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: route.params,
    query: {},
    body: route.body,
    headers: {},
  } as unknown as ExpressRequest;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", route.uri)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

let sideEffects: Record<SideEffect, jest.SpyInstance>;

/*
 * Every downstream call is stubbed to something harmless ("not found",
 * "nothing to do"), so no path can fall through to a real database, model
 * provider or Runner, and each one can be asserted as never reached.
 */
function stubSideEffects(): Record<SideEffect, jest.SpyInstance> {
  return {
    incidentRead: jest
      .spyOn(IncidentService, "findOneById")
      .mockResolvedValue(null),
    alertRead: jest.spyOn(AlertService, "findOneById").mockResolvedValue(null),
    investigationRunsRead: jest
      .spyOn(AIRunService, "findBy")
      .mockResolvedValue([]),
    investigationRunRead: jest
      .spyOn(AIRunService, "findOneBy")
      .mockResolvedValue(null),
    investigationVerdictWrite: jest
      .spyOn(AIRunService, "applyHumanVerdictToInvestigation")
      .mockResolvedValue(undefined as never),
    runEventsRead: jest
      .spyOn(AIRunEventService, "findBy")
      .mockResolvedValue([]),
    notStartedReasonRead: jest
      .spyOn(InvestigationEligibility, "getNotStartedReason")
      .mockResolvedValue(undefined as never),
    toolExecution: jest
      .spyOn(AIToolbox, "executeTool")
      .mockResolvedValue(undefined as never),
    spansRead: jest.spyOn(SpanService, "findBy").mockResolvedValue([]),
    serviceRead: jest
      .spyOn(ServiceService, "findOneById")
      .mockResolvedValue(null),
    fixTaskCreate: jest
      .spyOn(FixFromIncidentTaskTrigger, "createFixTaskFromInvestigation")
      .mockResolvedValue(undefined as never),
    performanceFixTaskCreate: jest
      .spyOn(FixPerformanceTaskTrigger, "createPerformanceFixTaskFromTrace")
      .mockResolvedValue(undefined as never),
    telemetryTaskCreate: jest
      .spyOn(TelemetryImprovementTaskTrigger, "createTelemetryImprovementTask")
      .mockResolvedValue(undefined as never),
    insightRead: jest
      .spyOn(AIInsightService, "findOneById")
      .mockResolvedValue(null),
    insightVerdictWrite: jest
      .spyOn(AIInsightService, "applyHumanVerdict")
      .mockResolvedValue(undefined as never),
    insightResolve: jest
      .spyOn(AIInsightService, "resolveInsight")
      .mockResolvedValue(undefined as never),
    insightReopen: jest
      .spyOn(AIInsightService, "reopenInsight")
      .mockResolvedValue(undefined as never),
    insightTriageRead: jest
      .spyOn(AIInsightService, "getLatestTriageRunWithEvents")
      .mockResolvedValue(undefined as never),
    suggestionRead: jest
      .spyOn(AutoRemediationSuggestionService, "findOneById")
      .mockResolvedValue(null),
    suggestionTransition: jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(0),
    commandPlanExecution: jest
      .spyOn(CommandPlanExecutor, "executeApprovedPlan")
      .mockResolvedValue(undefined as never),
    runbookStart: jest
      .spyOn(RunbookRuleEngineService, "startRunbookFor")
      .mockResolvedValue(undefined as never),
    projectRead: jest
      .spyOn(ProjectService, "findOneById")
      .mockResolvedValue(null),
    llmLogsRead: jest.spyOn(LlmLogService, "findBy").mockResolvedValue([]),
    readinessRead: jest
      .spyOn(CodeFixReadiness, "getProjectReadiness")
      .mockResolvedValue({ ready: true, checks: [] } as never),
  };
}

function expectNothingReached(): void {
  for (const name of Object.keys(sideEffects) as Array<SideEffect>) {
    expect({ [name]: sideEffects[name].mock.calls.length }).toEqual({
      [name]: 0,
    });
  }

  expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
  expect(Response.sendErrorResponse).not.toHaveBeenCalled();
}

function expectAuthenticationRequired(call: RouteCall): void {
  expect(call.nextCallCount).toBe(1);
  expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
  expect(call.thrown).not.toBeInstanceOf(NotAuthorizedException);
  expect((call.thrown as NotAuthenticatedException).code).toBe(
    ExceptionCode.NotAuthenticatedException,
  );
  expect((call.thrown as NotAuthenticatedException).message).toBe(
    CommonAPI.AUTHENTICATION_REQUIRED_MESSAGE,
  );
}

beforeAll(() => {
  new CodeFixRunAPI();
});

beforeEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
  sideEffects = stubSideEffects();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the table covers every route these APIs register", () => {
  /*
   * A new person-only route added to one of these APIs must join the table
   * (and so inherit every assertion below) or fail here.
   */
  test("every /ai-investigation, /ai-insight, /auto-remediation, /code-fix-run and /ai-readiness route is in the table", () => {
    const prefixes: Array<string> = [
      "/ai-investigation/",
      "/ai-insight/",
      "/auto-remediation/",
      "/code-fix-run/",
      "/ai-readiness/",
    ];

    const registered: Array<string> = mockRouter.routes
      .filter((route: { uri: string }) => {
        return prefixes.some((prefix: string) => {
          return route.uri.startsWith(prefix);
        });
      })
      .map((route: { uri: string }) => {
        return route.uri;
      })
      .sort();

    const covered: Array<string> = ALL_ROUTES.map((route: HumanOnlyRoute) => {
      return route.uri;
    }).sort();

    expect(registered).toEqual(covered);
  });
});

describe.each(ALL_ROUTES)(
  "POST $uri with an expired session",
  (route: HumanOnlyRoute) => {
    /*
     * getUserMiddleware is a context loader, not a gate, which is why the
     * handler has to answer the anonymous caller itself.
     */
    test("is mounted behind getUserMiddleware, so an anonymous request reaches the handler", () => {
      expect(mockRouter.match("post", route.uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
      ]);
    });

    test("answers a caller with no credentials (only a tenantid header) with 401, not 422", async () => {
      withProps(expiredSessionProps());

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingReached();
    });

    test("answers a caller with no credentials and no tenantid header with 401, not 400", async () => {
      withProps({ userType: UserType.Public });

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingReached();
    });

    test("answers a caller getUserMiddleware left unclassified with 401", async () => {
      withProps({ tenantId: PROJECT_ID });

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingReached();
    });

    /*
     * Tenant grants on a request with no user, no key and no master-admin
     * session prove nothing about who sent it.
     */
    test("does not let stray tenant permissions stand in for a credential", async () => {
      withProps({
        ...expiredSessionProps(),
        userTenantAccessPermission: tenantPermissions([
          Permission.ProjectOwner,
        ]),
      });

      const call: RouteCall = await callRoute(route);

      expectAuthenticationRequired(call);
      expectNothingReached();
    });

    test("still refuses a project API key with 422 - it is authenticated, just not a person", async () => {
      withProps(apiKeyProps());

      const call: RouteCall = await callRoute(route);

      expect(call.nextCallCount).toBe(1);
      expect(call.thrown).toBeInstanceOf(NotAuthorizedException);
      expect(call.thrown).not.toBeInstanceOf(NotAuthenticatedException);
      expect((call.thrown as NotAuthorizedException).code).toBe(
        ExceptionCode.NotAuthorizedException,
      );
      expect((call.thrown as NotAuthorizedException).message).toBe(
        route.notAUserMessage,
      );
      expectNothingReached();
    });

    test("lets a signed-in user through to the route's own access check", async () => {
      withProps(memberProps());

      const call: RouteCall = await callRoute(route);

      expect(sideEffects[route.firstRead]).toHaveBeenCalled();
      expect(call.thrown).not.toBeInstanceOf(NotAuthenticatedException);
      expect((call.thrown as Error | undefined)?.message).not.toBe(
        route.notAUserMessage,
      );
    });
  },
);

/*
 * The refusal must not depend on the body. An expired session replays
 * exactly what the page sent, and the client can only recover from a 401 -
 * so an anonymous caller is told to authenticate even when its body would
 * also have been rejected.
 */
describe.each(ALL_ROUTES)(
  "POST $uri - order of checks",
  (route: HumanOnlyRoute) => {
    test("an anonymous caller with an empty body still gets 401 rather than a validation error", async () => {
      withProps(expiredSessionProps());

      const call: RouteCall = await callRoute({
        ...route,
        body: {},
        params: {},
      });

      expectAuthenticationRequired(call);
      expectNothingReached();
    });
  },
);

describe("the refusals end-users actually hit", () => {
  test("a signed-in user on /ai-readiness/code-fix gets the readiness report", async () => {
    withProps(memberProps());

    const call: RouteCall = await callRoute(
      AI_READINESS_ROUTES[0] as HumanOnlyRoute,
    );

    expect(call.nextCallCount).toBe(0);
    expect(sideEffects.readinessRead).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
    });
    expect(Response.sendJsonObjectResponse).toHaveBeenCalledTimes(1);
  });

  test("the code-fix-run access check reads the project under the user's own props", async () => {
    const props: DatabaseCommonInteractionProps = memberProps();
    withProps(props);

    await callRoute(CODE_FIX_RUN_ROUTES[0] as HumanOnlyRoute);

    expect(sideEffects.projectRead).toHaveBeenCalledWith(
      expect.objectContaining({ id: PROJECT_ID, props: props }),
    );
  });

  test("an AI insight action by a signed-in user is recorded against that user", async () => {
    withProps(memberProps());
    sideEffects.insightRead.mockResolvedValue({ id: INSIGHT_ID } as never);
    sideEffects.insightResolve.mockResolvedValue({
      insightId: INSIGHT_ID,
      status: "Resolved",
    } as never);

    const call: RouteCall = await callRoute(
      AI_INSIGHT_ROUTES[1] as HumanOnlyRoute,
    );

    expect(call.nextCallCount).toBe(0);
    expect(sideEffects.insightResolve).toHaveBeenCalledWith({
      insightId: INSIGHT_ID,
      byUserId: USER_ID,
    });
  });
});
