import { mockRouter } from "./Helpers";
import AlertAPI from "../../../Server/API/AlertAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import IncidentAPI from "../../../Server/API/IncidentAPI";
import IncidentEpisodeAPI from "../../../Server/API/IncidentEpisodeAPI";
import ScheduledMaintenanceAPI from "../../../Server/API/ScheduledMaintenanceAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIService from "../../../Server/Services/AIService";
import AlertService from "../../../Server/Services/AlertService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentService from "../../../Server/Services/IncidentService";
import ProjectService from "../../../Server/Services/ProjectService";
import ScheduledMaintenanceService from "../../../Server/Services/ScheduledMaintenanceService";
import AlertAIContextBuilder from "../../../Server/Utils/AI/AlertAIContextBuilder";
import IncidentAIContextBuilder, {
  AIGenerationContext,
} from "../../../Server/Utils/AI/IncidentAIContextBuilder";
import IncidentEpisodeAIContextBuilder from "../../../Server/Utils/AI/IncidentEpisodeAIContextBuilder";
import ScheduledMaintenanceAIContextBuilder from "../../../Server/Utils/AI/ScheduledMaintenanceAIContextBuilder";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Project from "../../../Models/DatabaseModels/Project";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import BadDataException from "../../../Types/Exception/BadDataException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * Project.enableAi is the per-project kill switch for AI. It is the switch a
 * project flips when it does not want its data going to a model, or does not
 * want it spending money — so "off" has to mean off everywhere, not off in the
 * places somebody remembered.
 *
 * It was enforced on the AI chat endpoint and, through
 * AIService.assertProjectCanUseAI, on the workflow component. It was NOT
 * enforced on the five synchronous "Generate with AI" endpoints below. Each of
 * those calls AIService.executeWithLogging directly, and executeWithLogging
 * meters, bills and logs the call but never reads the toggle — so a project
 * with AI switched off could still be made to spend provider tokens simply by
 * pressing the button in the UI.
 *
 * The table below is the point of this file. Every route that generates with
 * AI goes in it, gets the same battery of assertions, and — via
 * "no generate route escapes the table" at the bottom — a sixth such route
 * cannot be added without either joining the table or failing this suite.
 *
 * Each route asserts more than "it throws". It asserts the refusal lands
 * BEFORE the context builder runs and BEFORE any provider call, because a gate
 * that only fires after the expensive reads still leaks work, and one that
 * fires after executeWithLogging does not fix the bug at all.
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
    sendJsonObjectResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEmptySuccessResponse: jest.fn(),
    sendErrorResponse: jest.fn(),
    sendFileResponse: jest.fn(),
    setNoCacheHeaders: jest.fn(),
  };
});

const AI_DISABLED_MESSAGE: string =
  "AI features are disabled for this project. Enable them in Project Settings > AI Credits.";

// The project that owns the incident / alert / maintenance being generated for.
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

/*
 * A different project, used only to prove the gate reads the toggle for the
 * project that owns the ROW, not the one the caller named in `tenantid`.
 */
const HEADER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);

const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const INCIDENT_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);

const EPISODE_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);

const ALERT_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");

const MAINTENANCE_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const GENERATED_TEXT: string = "generated-by-the-model";

// The two spies every route in the table is asserted against.
type RouteStubs = {
  // The row lookup that hands the handler the projectId it must gate on.
  resourceLookup: jest.SpyInstance;

  /*
   * The context builder's expensive read. It must not run for a project with
   * AI switched off — it is the work the gate exists to skip.
   */
  contextBuild: jest.SpyInstance;
};

type GenerateRoute = {
  uri: string;
  params: Dictionary<string>;
  body: JSONObject;

  // The key the handler returns the generated text under.
  responseKey: string;

  /*
   * Installs this route's own stubs, with the resource row owned by
   * `projectId`, and hands back the spies the shared assertions use.
   */
  stub: (projectId: ObjectID) => RouteStubs;
};

function emptyAIContext(): AIGenerationContext {
  return {
    contextText: "",
    systemPrompt: "",
    messages: [],
  };
}

const GENERATE_ROUTES: Array<GenerateRoute> = [
  {
    uri: "/incident/generate-postmortem-from-ai/:incidentId",
    params: { incidentId: INCIDENT_ID.toString() },
    body: {},
    responseKey: "postmortemNote",
    stub: (projectId: ObjectID): RouteStubs => {
      const incident: Incident = new Incident(INCIDENT_ID);
      incident.projectId = projectId;

      const resourceLookup: jest.SpyInstance = jest.spyOn(
        IncidentService,
        "findOneById",
      );
      resourceLookup.mockResolvedValue(incident);

      const contextBuild: jest.SpyInstance = jest.spyOn(
        IncidentAIContextBuilder,
        "buildIncidentContext",
      );
      contextBuild.mockResolvedValue({});

      const format: jest.SpyInstance = jest.spyOn(
        IncidentAIContextBuilder,
        "formatIncidentContextForPostmortem",
      );
      format.mockReturnValue(emptyAIContext());

      return { resourceLookup, contextBuild };
    },
  },
  {
    uri: "/incident/generate-note-from-ai/:incidentId",
    params: { incidentId: INCIDENT_ID.toString() },
    body: { noteType: "internal" },
    responseKey: "note",
    stub: (projectId: ObjectID): RouteStubs => {
      const incident: Incident = new Incident(INCIDENT_ID);
      incident.projectId = projectId;

      const resourceLookup: jest.SpyInstance = jest.spyOn(
        IncidentService,
        "findOneById",
      );
      resourceLookup.mockResolvedValue(incident);

      const contextBuild: jest.SpyInstance = jest.spyOn(
        IncidentAIContextBuilder,
        "buildIncidentContext",
      );
      contextBuild.mockResolvedValue({});

      const format: jest.SpyInstance = jest.spyOn(
        IncidentAIContextBuilder,
        "formatIncidentContextForNote",
      );
      format.mockReturnValue(emptyAIContext());

      return { resourceLookup, contextBuild };
    },
  },
  {
    uri: "/incident-episode/generate-postmortem-from-ai/:episodeId",
    params: { episodeId: EPISODE_ID.toString() },
    body: {},
    responseKey: "postmortemNote",
    stub: (projectId: ObjectID): RouteStubs => {
      const episode: IncidentEpisode = new IncidentEpisode(EPISODE_ID);
      episode.projectId = projectId;

      const resourceLookup: jest.SpyInstance = jest.spyOn(
        IncidentEpisodeService,
        "findOneById",
      );
      resourceLookup.mockResolvedValue(episode);

      const contextBuild: jest.SpyInstance = jest.spyOn(
        IncidentEpisodeAIContextBuilder,
        "buildEpisodeContext",
      );
      contextBuild.mockResolvedValue({});

      const format: jest.SpyInstance = jest.spyOn(
        IncidentEpisodeAIContextBuilder,
        "formatEpisodeContextForPostmortem",
      );
      format.mockReturnValue(emptyAIContext());

      return { resourceLookup, contextBuild };
    },
  },
  {
    uri: "/alert/generate-note-from-ai/:alertId",
    params: { alertId: ALERT_ID.toString() },
    body: {},
    responseKey: "note",
    stub: (projectId: ObjectID): RouteStubs => {
      const alert: Alert = new Alert(ALERT_ID);
      alert.projectId = projectId;

      const resourceLookup: jest.SpyInstance = jest.spyOn(
        AlertService,
        "findOneById",
      );
      resourceLookup.mockResolvedValue(alert);

      const contextBuild: jest.SpyInstance = jest.spyOn(
        AlertAIContextBuilder,
        "buildAlertContext",
      );
      contextBuild.mockResolvedValue({});

      const format: jest.SpyInstance = jest.spyOn(
        AlertAIContextBuilder,
        "formatAlertContextForNote",
      );
      format.mockReturnValue(emptyAIContext());

      return { resourceLookup, contextBuild };
    },
  },
  {
    uri: "/scheduled-maintenance/generate-note-from-ai/:scheduledMaintenanceId",
    params: { scheduledMaintenanceId: MAINTENANCE_ID.toString() },
    body: { noteType: "public" },
    responseKey: "note",
    stub: (projectId: ObjectID): RouteStubs => {
      const maintenance: ScheduledMaintenance = new ScheduledMaintenance(
        MAINTENANCE_ID,
      );
      maintenance.projectId = projectId;

      const resourceLookup: jest.SpyInstance = jest.spyOn(
        ScheduledMaintenanceService,
        "findOneById",
      );
      resourceLookup.mockResolvedValue(maintenance);

      const contextBuild: jest.SpyInstance = jest.spyOn(
        ScheduledMaintenanceAIContextBuilder,
        "buildScheduledMaintenanceContext",
      );
      contextBuild.mockResolvedValue({});

      const format: jest.SpyInstance = jest.spyOn(
        ScheduledMaintenanceAIContextBuilder,
        "formatScheduledMaintenanceContextForNote",
      );
      format.mockReturnValue(emptyAIContext());

      return { resourceLookup, contextBuild };
    },
  },
];

/*
 * A project admin of `tenantId`. Project Admin is accepted by all five
 * handlers' permission checks, so the permission gate is never what refuses a
 * request here — anything refused is refused by the AI toggle.
 */
function adminProps(tenantId: ObjectID): DatabaseCommonInteractionProps {
  const permission: UserPermission = {
    _type: "UserPermission",
    permission: Permission.ProjectAdmin,
    labelIds: [],
    isBlockPermission: false,
  } as UserPermission;

  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: tenantId,
    permissions: [permission],
  } as UserTenantAccessPermission;

  const permissionMap: Dictionary<UserTenantAccessPermission> = {};
  permissionMap[tenantId.toString()] = tenantPermission;

  return {
    userId: USER_ID,
    tenantId: tenantId,
    userTenantAccessPermission: permissionMap,
  };
}

type RouteCall = {
  thrown: unknown;
  nextCallCount: number;
};

async function callRoute(route: GenerateRoute): Promise<RouteCall> {
  const req: ExpressRequest = {
    params: route.params,
    query: {},
    body: route.body,
    headers: {},
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as ExpressResponse;

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", route.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
    nextCallCount: next.mock.calls.length,
  };
}

let projectLookup: jest.SpyInstance;
let executeWithLogging: jest.SpyInstance;

/*
 * The project row the gate reads. Passing `undefined` leaves enableAi off the
 * row entirely, which is what an unselected column actually looks like.
 */
function mockProject(enableAi: boolean | undefined): void {
  const project: Project = new Project(PROJECT_ID);

  if (enableAi !== undefined) {
    project.enableAi = enableAi;
  }

  projectLookup.mockResolvedValue(project);
}

function sentPayload(): JSONObject {
  const send: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  return send.mock.calls[0]![2] as JSONObject;
}

// The projectId the gate actually looked the toggle up for.
function gatedProjectId(): string {
  const call: { id: ObjectID } = projectLookup.mock.calls[0]![0] as {
    id: ObjectID;
  };
  return call.id.toString();
}

beforeAll(() => {
  mockRouter.routes.length = 0;
  new IncidentAPI();
  new IncidentEpisodeAPI();
  new AlertAPI();
  new ScheduledMaintenanceAPI();
});

beforeEach(() => {
  jest.clearAllMocks();

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockResolvedValue(adminProps(PROJECT_ID));

  projectLookup = jest.spyOn(ProjectService, "findOneById");
  mockProject(true);

  executeWithLogging = jest.spyOn(AIService, "executeWithLogging");
  executeWithLogging.mockResolvedValue({
    content: GENERATED_TEXT,
    llmLog: {},
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(GENERATE_ROUTES)(
  "POST $uri - Project.enableAi kill switch",
  (route: GenerateRoute) => {
    test("refuses when AI is switched off for the project, and names where to turn it back on", async () => {
      route.stub(PROJECT_ID);
      mockProject(false);

      const call: RouteCall = await callRoute(route);

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        AI_DISABLED_MESSAGE,
      );
      expect(call.nextCallCount).toBe(1);
    });

    /*
     * The bug this file exists for: not "the request succeeded", but "the
     * provider was called and the project was billed for it".
     */
    test("spends no provider tokens when AI is switched off", async () => {
      route.stub(PROJECT_ID);
      mockProject(false);

      await callRoute(route);

      expect(executeWithLogging).not.toHaveBeenCalled();
      expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
    });

    /*
     * And it refuses early. Building the context reads incident/alert history
     * and workspace messages; a gate that fires after that has already done
     * the work the project asked it not to do.
     */
    test("refuses before the context builder reads anything", async () => {
      const stubs: RouteStubs = route.stub(PROJECT_ID);
      mockProject(false);

      await callRoute(route);

      expect(stubs.resourceLookup).toHaveBeenCalledTimes(1);
      expect(stubs.contextBuild).not.toHaveBeenCalled();
    });

    test("generates as before when AI is enabled", async () => {
      const stubs: RouteStubs = route.stub(PROJECT_ID);
      mockProject(true);

      const call: RouteCall = await callRoute(route);

      expect(call.nextCallCount).toBe(0);
      expect(stubs.contextBuild).toHaveBeenCalledTimes(1);
      expect(executeWithLogging).toHaveBeenCalledTimes(1);
      expect(sentPayload()[route.responseKey]).toBe(GENERATED_TEXT);
    });

    /*
     * enableAi is NOT NULL DEFAULT true, so an unselected column means "not
     * disabled". A gate that treated undefined as off would switch AI off for
     * every project that never touched the setting.
     */
    test("an unselected enableAi is not a disabled one", async () => {
      route.stub(PROJECT_ID);
      mockProject(undefined);

      const call: RouteCall = await callRoute(route);

      expect(call.nextCallCount).toBe(0);
      expect(executeWithLogging).toHaveBeenCalledTimes(1);
    });

    /*
     * Fail closed. If the toggle cannot be read there is no basis for saying
     * AI is enabled, and guessing "enabled" is the expensive guess.
     */
    test("fails closed when the project row cannot be read", async () => {
      route.stub(PROJECT_ID);
      projectLookup.mockResolvedValue(null);

      const call: RouteCall = await callRoute(route);

      expect(call.thrown).toBeInstanceOf(BadDataException);
      expect((call.thrown as BadDataException).message).toBe(
        "Project not found.",
      );
      expect(executeWithLogging).not.toHaveBeenCalled();
    });

    /*
     * The toggle that matters belongs to the project that owns the row, which
     * is also the project executeWithLogging bills. Reading the caller's
     * `tenantid` header instead would let a request gated by one project's
     * switch be billed to another's.
     */
    test("reads the toggle for the project that owns the row, not the tenantid header", async () => {
      route.stub(PROJECT_ID);
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(adminProps(HEADER_PROJECT_ID));

      await callRoute(route);

      expect(projectLookup).toHaveBeenCalledTimes(1);
      expect(gatedProjectId()).toBe(PROJECT_ID.toString());
    });
  },
);

/*
 * A project API key holding Project Admin in `tenantId`: what
 * getDatabaseCommonInteractionProps returns for a key - no userId, userType
 * API, and the permissions ProjectMiddleware attached to the key itself.
 */
function apiKeyProps(tenantId: ObjectID): DatabaseCommonInteractionProps {
  const props: DatabaseCommonInteractionProps = adminProps(tenantId);

  return {
    ...props,
    userId: undefined,
    userType: UserType.API,
  };
}

type GateResult = {
  // False when a middleware answered the request itself.
  handlerReached: boolean;
  thrown: unknown;
};

/*
 * Runs a registered route the way Express does once getUserMiddleware has
 * classified the caller as `userType`: every later middleware in order, then
 * the handler, stopping at the first middleware that answers instead of
 * calling next(). getUserMiddleware itself is not run - it needs a real
 * token to verify - so the request carries the userType it would have set.
 */
async function callThroughAuthGate(
  route: GenerateRoute,
  userType: UserType | undefined,
): Promise<GateResult> {
  const req: ExpressRequest = {
    params: route.params,
    query: {},
    body: route.body,
    headers: {},
    userType: userType,
  } as unknown as ExpressRequest;

  const res: ExpressResponse = {} as ExpressResponse;

  const registered: {
    middlewares: Array<
      (
        req: ExpressRequest,
        res: ExpressResponse,
        next: NextFunction,
      ) => void | Promise<void>
    >;
  } = mockRouter.match("post", route.uri);

  for (const middleware of registered.middlewares.slice(1)) {
    let calledNext: boolean = false;

    await middleware(req, res, ((): void => {
      calledNext = true;
    }) as NextFunction);

    if (!calledNext) {
      return { handlerReached: false, thrown: undefined };
    }
  }

  const next: jest.Mock = jest.fn();

  await mockRouter
    .match("post", route.uri)
    .handlerFunction(req, res, next as unknown as NextFunction);

  return {
    handlerReached: true,
    thrown: next.mock.calls[0] ? next.mock.calls[0][0] : undefined,
  };
}

/*
 * The expired-session half of these routes. The dashboard's access-token
 * cookie expires with the JWT inside it, so a tab left open past the token
 * lifetime sends "Generate with AI" with no credentials at all.
 * getUserMiddleware lets that through as Public; requireUserAuthentication,
 * mounted straight after it, answers 401 - the one status the browser client
 * refreshes the session on and replays. Before it was mounted the handler's
 * own permission check answered 400, which the client showed as an error.
 */
describe.each(GENERATE_ROUTES)(
  "POST $uri - expired session",
  (route: GenerateRoute) => {
    test("is mounted with requireUserAuthentication directly after getUserMiddleware", () => {
      expect(mockRouter.match("post", route.uri).middlewares).toEqual([
        UserMiddleware.getUserMiddleware,
        UserMiddleware.requireUserAuthentication,
      ]);
    });

    test.each([
      ["a Public caller", UserType.Public],
      ["a caller getUserMiddleware left unclassified", undefined],
    ])(
      "%s is answered 401 before the handler runs, and nothing is read or spent",
      async (_label: string, userType: UserType | undefined) => {
        const stubs: RouteStubs = route.stub(PROJECT_ID);

        const result: GateResult = await callThroughAuthGate(route, userType);

        expect(result.handlerReached).toBe(false);

        const sendError: jest.Mock =
          Response.sendErrorResponse as unknown as jest.Mock;
        expect(sendError).toHaveBeenCalledTimes(1);

        const error: unknown = sendError.mock.calls[0]![2];
        expect(error).toBeInstanceOf(NotAuthenticatedException);
        expect((error as NotAuthenticatedException).code).toBe(
          ExceptionCode.NotAuthenticatedException,
        );
        expect((error as NotAuthenticatedException).message).toBe(
          UserMiddleware.AUTHENTICATION_REQUIRED_MESSAGE,
        );

        expect(stubs.resourceLookup).not.toHaveBeenCalled();
        expect(stubs.contextBuild).not.toHaveBeenCalled();
        expect(projectLookup).not.toHaveBeenCalled();
        expect(executeWithLogging).not.toHaveBeenCalled();
        expect(Response.sendJsonObjectResponse).not.toHaveBeenCalled();
      },
    );

    /*
     * Generating from CI or a script is supported: the gate is about "no
     * credentials", not "no human". A key with the right permission still
     * gets its text, subject to the same kill switch as everyone else.
     */
    test("a project API key passes the gate and still generates", async () => {
      const stubs: RouteStubs = route.stub(PROJECT_ID);
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue(apiKeyProps(PROJECT_ID));

      const result: GateResult = await callThroughAuthGate(route, UserType.API);

      expect(result.handlerReached).toBe(true);
      expect(result.thrown).toBeUndefined();
      expect(Response.sendErrorResponse).not.toHaveBeenCalled();
      expect(stubs.contextBuild).toHaveBeenCalledTimes(1);
      expect(executeWithLogging).toHaveBeenCalledTimes(1);
      expect(sentPayload()[route.responseKey]).toBe(GENERATED_TEXT);
    });

    test("a logged-in user passes the gate unchanged", async () => {
      route.stub(PROJECT_ID);

      const result: GateResult = await callThroughAuthGate(
        route,
        UserType.User,
      );

      expect(result.handlerReached).toBe(true);
      expect(result.thrown).toBeUndefined();
      expect(executeWithLogging).toHaveBeenCalledTimes(1);
    });

    /*
     * Defence in depth: the handler does not rely on the middleware alone.
     * Its own tenant check refuses a credential-less caller with the same
     * 401 - ahead of the permission check that used to answer it with 400.
     */
    test("the handler itself answers credential-less props with 401 before reading the row", async () => {
      const stubs: RouteStubs = route.stub(PROJECT_ID);
      jest
        .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
        .mockResolvedValue({ tenantId: PROJECT_ID });

      const call: RouteCall = await callRoute(route);

      expect(call.thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(call.thrown).not.toBeInstanceOf(BadDataException);
      expect(stubs.resourceLookup).not.toHaveBeenCalled();
      expect(executeWithLogging).not.toHaveBeenCalled();
    });
  },
);

/*
 * The shape of the gate's own read is load-bearing, and wrong in a way no
 * route-level assertion above would notice — because getting either half
 * wrong leaves the switch silently dead rather than throwing:
 *
 *   - `select` must ask for enableAi. Drop it and project.enableAi comes back
 *     undefined on every row, which this gate deliberately reads as "not
 *     disabled" (the column is NOT NULL DEFAULT true). The kill switch would
 *     then pass every request and every test above would still be green.
 *   - `props` must be isRoot. The toggle has to be readable whatever the
 *     caller can see; a permission-filtered read returning null would flip the
 *     fail-closed branch into refusing legitimate callers.
 */
describe("the shape of the gate's project read", () => {
  test("asks for enableAi, and reads it as root", async () => {
    const route: GenerateRoute = GENERATE_ROUTES[0] as GenerateRoute;
    route.stub(PROJECT_ID);
    mockProject(true);

    await callRoute(route);

    expect(projectLookup).toHaveBeenCalledTimes(1);

    const read: {
      select: Dictionary<boolean>;
      props: { isRoot?: boolean };
    } = projectLookup.mock.calls[0]![0] as {
      select: Dictionary<boolean>;
      props: { isRoot?: boolean };
    };

    expect(read.select["enableAi"]).toBe(true);
    expect(read.props.isRoot).toBe(true);
  });
});

type RegisteredRoute = {
  method: string;
  uri: string;
};

/*
 * The table is only a guarantee if it is exhaustive. This is what makes a
 * sixth generate-with-AI route impossible to add silently: it either joins
 * GENERATE_ROUTES and inherits every assertion above, or it fails here.
 */
describe("no generate-with-AI route escapes the table", () => {
  test("every *-from-ai route these four APIs register is covered", () => {
    const registered: Array<string> = mockRouter.routes
      .filter((route: RegisteredRoute) => {
        return route.uri.includes("-from-ai");
      })
      .map((route: RegisteredRoute) => {
        return route.uri;
      })
      .sort();

    const covered: Array<string> = GENERATE_ROUTES.map(
      (route: GenerateRoute) => {
        return route.uri;
      },
    ).sort();

    expect(registered).toEqual(covered);
  });
});
