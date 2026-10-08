import { mockRouter } from "./Helpers";
import { ToolImportAPIAccess } from "../../../Server/API/ToolImportAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import ToolImportRunService from "../../../Server/Services/ToolImportRunService";
import ToolImportProjectStateReader from "../../../Server/Utils/ToolImport/ToolImportProjectStateReader";
import ToolImportRunExecutor from "../../../Server/Utils/ToolImport/ToolImportRunExecutor";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import ToolImportRun from "../../../Models/DatabaseModels/ToolImportRun";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Dictionary from "../../../Types/Dictionary";
import NotAuthenticatedException from "../../../Types/Exception/NotAuthenticatedException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import {
  makeToolImportNote,
  ToolImportNoteCode,
} from "../../../Types/ToolImport/ToolImportNote";
import { ToolImportPlan } from "../../../Types/ToolImport/ToolImportPlan";
import ToolImportResourceKind from "../../../Types/ToolImport/ToolImportResourceKind";
import ToolImportRunStatus from "../../../Types/ToolImport/ToolImportRunStatus";
import ToolImportSource from "../../../Types/ToolImport/ToolImportSource";
import UserType from "../../../Types/UserType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";

/*
 * The import's HTTP face. Its runs are internal rows read as root, so these
 * handlers are the whole gate, and most of this file is about who gets what:
 * a signed-in person of the project only (never anonymous, never an API key),
 * the read only for someone who may create something it brings, a run's
 * preview and its start only for whoever read the tool, every import's status
 * for owners and admins - and the API key goes in once and never comes out.
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
    sendErrorResponse: jest.fn(),
  };
});

jest.mock("../../../Server/Services/ToolImportRunService", () => {
  return {
    __esModule: true,
    default: { findBy: jest.fn(), findOneBy: jest.fn() },
  };
});

jest.mock("../../../Server/Utils/ToolImport/ToolImportRunExecutor", () => {
  return {
    __esModule: true,
    default: {
      startRead: jest.fn(),
      startImport: jest.fn(),
      cancel: jest.fn(),
      getPlan: jest.fn(),
      isReviewExpired: jest.fn(() => {
        return false;
      }),
    },
  };
});

jest.mock("../../../Server/Utils/Billing/CallerPlan", () => {
  const actual: { default: Record<string, unknown> } = jest.requireActual(
    "../../../Server/Utils/Billing/CallerPlan",
  );

  /*
   * The props a test builds carry their plan already: withPlan hands them
   * back as they are, and every other rule is the real one.
   */
  const CallerPlanWithTestProps: Record<string, unknown> = Object.create(
    actual.default,
  );
  CallerPlanWithTestProps["withPlan"] = jest.fn(async (props: unknown) => {
    return props;
  });

  return { __esModule: true, default: CallerPlanWithTestProps };
});

const PROJECT_ID: ObjectID = ObjectID.generate();
const ME: ObjectID = ObjectID.generate();
const SOMEONE_ELSE: ObjectID = ObjectID.generate();
const KEY: string = "8b1e5a1c-3f4d-4f4b-9a5e-2d6c7b8a9f01";

function propsWith(
  permissions: Array<Permission>,
  userId: ObjectID = ME,
): DatabaseCommonInteractionProps {
  const rows: Array<UserPermission> = permissions.map(
    (permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission: permission,
        labelIds: [],
        isBlockPermission: false,
      };
    },
  );

  const tenant: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: rows,
  };

  return {
    tenantId: PROJECT_ID,
    userId: userId,
    userTenantAccessPermission: { [PROJECT_ID.toString()]: tenant },
    // As a request's props carry it on a billed install (CommonAPI).
    ...ON_HIGHEST_PLAN,
  };
}

let callerProps: DatabaseCommonInteractionProps;

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

function route(method: string, uri: string): RegisteredRoute {
  const found: RegisteredRoute | undefined = (
    mockRouter.routes as unknown as Array<RegisteredRoute>
  ).find((candidate: RegisteredRoute): boolean => {
    return candidate.method === method && candidate.uri === uri;
  });

  if (!found) {
    throw new Error(`No ${method} ${uri}`);
  }

  return found;
}

async function call(
  method: string,
  uri: string,
  data: { params?: Dictionary<string>; body?: JSONObject } = {},
): Promise<{ thrown: unknown; payload: Record<string, unknown> | undefined }> {
  const next: jest.Mock = jest.fn();
  const sender: jest.Mock =
    Response.sendJsonObjectResponse as unknown as jest.Mock;
  sender.mockClear();

  await route(method, uri).handlerFunction(
    {
      params: data.params || {},
      query: {},
      body: data.body || {},
      headers: {},
    } as unknown as ExpressRequest,
    {} as ExpressResponse,
    next as unknown as NextFunction,
  );

  const last: Array<unknown> | undefined =
    sender.mock.calls[sender.mock.calls.length - 1];

  return {
    thrown: next.mock.calls[0]?.[0],
    payload: last ? (last[2] as Record<string, unknown>) : undefined,
  };
}

function run(overrides: Partial<ToolImportRun> = {}): ToolImportRun {
  const model: ToolImportRun = new ToolImportRun();
  model.id = ObjectID.generate();
  model.projectId = PROJECT_ID;
  model.source = ToolImportSource.OpsGenie;
  model.region = "EU";
  model.status = ToolImportRunStatus.ReadyToReview;
  model.createdByUserId = ME;
  model.createdAt = new Date("2026-10-08T12:00:00Z");
  Object.assign(model, overrides);
  return model;
}

const ROUTES: Array<[string, string]> = [
  ["GET", "/tool-import/runs"],
  ["POST", "/tool-import/read"],
  ["GET", "/tool-import/run/:runId"],
  ["POST", "/tool-import/run/:runId/start"],
  ["POST", "/tool-import/run/:runId/cancel"],
];

beforeEach(() => {
  callerProps = propsWith([Permission.ProjectOwner]);
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async () => {
      return callerProps;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("ToolImportAPI: who may call it", () => {
  test("every route reads the session through the user middleware", () => {
    for (const [method, uri] of ROUTES) {
      expect(route(method, uri).middleware).toBe(
        UserMiddleware.getUserMiddleware,
      );
    }
  });

  test.each(ROUTES)(
    "%s %s answers a caller with no session with 401, before anything else",
    async (method: string, uri: string) => {
      callerProps = { userType: UserType.Public };

      const { thrown } = await call(method, uri, {
        params: { runId: ObjectID.generate().toString() },
        body: { source: "OpsGenie", apiKey: KEY },
      });

      expect(thrown).toBeInstanceOf(NotAuthenticatedException);
      expect(ToolImportRunExecutor.startRead).not.toHaveBeenCalled();
      expect(ToolImportRunService.findBy).not.toHaveBeenCalled();
    },
  );

  test.each(ROUTES)(
    "%s %s refuses someone who is not in the project",
    async (method: string, uri: string) => {
      callerProps = {
        tenantId: PROJECT_ID,
        userId: ME,
        userTenantAccessPermission: {},
      };

      const { thrown } = await call(method, uri, {
        params: { runId: ObjectID.generate().toString() },
      });

      expect(thrown).toBeInstanceOf(NotAuthorizedException);
    },
  );

  test("a project API key cannot start an import: an import acts as a person", async () => {
    callerProps = {
      ...propsWith([Permission.ProjectOwner]),
      userId: undefined,
      userType: UserType.API,
    };

    const { thrown } = await call("POST", "/tool-import/read", {
      body: { source: "OpsGenie", region: "US", apiKey: KEY },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect(ToolImportRunExecutor.startRead).not.toHaveBeenCalled();
  });
});

describe("ToolImportAPI: reading a tool", () => {
  test("starts a read as the person, in their project, and answers only the run's id", async () => {
    const runId: ObjectID = ObjectID.generate();
    (ToolImportRunExecutor.startRead as jest.Mock).mockResolvedValue(runId);

    const { thrown, payload } = await call("POST", "/tool-import/read", {
      body: { source: "OpsGenie", region: "EU", apiKey: KEY },
    });

    expect(thrown).toBeUndefined();
    expect(ToolImportRunExecutor.startRead).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      userId: ME,
      source: ToolImportSource.OpsGenie,
      region: "EU",
      apiKey: KEY,
    });
    expect(payload).toEqual({ runId: runId.toString() });
    expect(JSON.stringify(payload)).not.toContain(KEY);
  });

  test("an unknown tool is refused before anything else", async () => {
    const { thrown } = await call("POST", "/tool-import/read", {
      body: { source: "Rocket", apiKey: KEY },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(ToolImportRunExecutor.startRead).not.toHaveBeenCalled();
  });

  test("someone who may create nothing the tool brings over is refused before the tool is called", async () => {
    callerProps = propsWith([Permission.Viewer]);

    const { thrown } = await call("POST", "/tool-import/read", {
      body: { source: "OpsGenie", region: "US", apiKey: KEY },
    });

    expect(thrown).toBeInstanceOf(NotAuthorizedException);
    expect((thrown as Error).message).toContain(
      "You may not create anything an import brings over.",
    );
    expect(ToolImportRunExecutor.startRead).not.toHaveBeenCalled();
  });

  test("someone who may create only on-call policies may read: the rest is skipped in the preview", async () => {
    callerProps = propsWith([
      Permission.CreateProjectOnCallDutyPolicy,
      Permission.CreateProjectOnCallDutyPolicyEscalationRule,
    ]);
    (ToolImportRunExecutor.startRead as jest.Mock).mockResolvedValue(
      ObjectID.generate(),
    );

    const { thrown } = await call("POST", "/tool-import/read", {
      body: { source: "OpsGenie", region: "US", apiKey: KEY },
    });

    expect(thrown).toBeUndefined();
    expect(ToolImportRunExecutor.startRead).toHaveBeenCalled();
  });

  test("the check asks every kind the tool brings, people included", () => {
    const refusal: jest.SpyInstance = jest
      .spyOn(ToolImportProjectStateReader, "getCreateRefusal")
      .mockReturnValue(makeToolImportNote(ToolImportNoteCode.NoPermission));

    expect(() => {
      ToolImportAPIAccess.assertCanImportAnything({
        props: callerProps,
        kinds: [ToolImportResourceKind.Person, ToolImportResourceKind.Team],
      });
    }).toThrow(NotAuthorizedException);
    expect(refusal).toHaveBeenCalledTimes(2);

    refusal.mockReturnValueOnce(null);

    expect(() => {
      ToolImportAPIAccess.assertCanImportAnything({
        props: callerProps,
        kinds: [ToolImportResourceKind.Person, ToolImportResourceKind.Team],
      });
    }).not.toThrow();
  });
});

describe("ToolImportAPI: the list of imports", () => {
  test("an owner sees every import of the project; nothing selected is ever the key or what was read", async () => {
    (ToolImportRunService.findBy as jest.Mock).mockResolvedValue([
      run({
        createdByUserId: SOMEONE_ELSE,
        status: ToolImportRunStatus.Completed,
        accountName: "acme",
      }),
    ]);

    const { payload } = await call("GET", "/tool-import/runs");

    const args: Record<string, unknown> = (
      ToolImportRunService.findBy as jest.Mock
    ).mock.calls[0]![0] as Record<string, unknown>;

    expect(args["query"]).toEqual({ projectId: PROJECT_ID });
    expect(args["select"]).not.toHaveProperty("apiKey");
    expect(args["select"]).not.toHaveProperty("snapshot");
    expect(args["select"]).not.toHaveProperty("selection");
    expect(args["limit"]).toBe(20);

    const runs: Array<Record<string, unknown>> = payload!["runs"] as Array<
      Record<string, unknown>
    >;

    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({
      source: ToolImportSource.OpsGenie,
      status: ToolImportRunStatus.Completed,
      accountName: "acme",
      region: "EU",
      isMine: false,
    });
  });

  test("anyone else sees only the imports they started", async () => {
    callerProps = propsWith([Permission.ProjectMember]);
    (ToolImportRunService.findBy as jest.Mock).mockResolvedValue([]);

    await call("GET", "/tool-import/runs");

    expect(
      (
        (ToolImportRunService.findBy as jest.Mock).mock.calls[0]![0] as Record<
          string,
          unknown
        >
      )["query"],
    ).toEqual({ projectId: PROJECT_ID, createdByUserId: ME });
  });
});

describe("ToolImportAPI: one import", () => {
  test("the person who read the tool gets its preview while it waits to be started", async () => {
    const mine: ToolImportRun = run();
    const plan: ToolImportPlan = {
      source: ToolImportSource.OpsGenie,
      readAt: "2026-10-08T12:00:00.000Z",
      items: [],
      inviteTeams: [],
      defaultInviteTeamId: null,
      notes: [],
    };

    (ToolImportRunService.findOneBy as jest.Mock).mockResolvedValue(mine);
    (ToolImportRunExecutor.getPlan as jest.Mock).mockResolvedValue(plan);

    const { payload } = await call("GET", "/tool-import/run/:runId", {
      params: { runId: mine.id!.toString() },
    });

    expect(payload!["plan"]).toEqual(plan);
    expect((payload!["run"] as Record<string, unknown>)["isMine"]).toBe(true);

    const selects: Array<Record<string, unknown>> = (
      ToolImportRunService.findOneBy as jest.Mock
    ).mock.calls.map((args: Array<unknown>) => {
      return (args[0] as Record<string, unknown>)["select"] as Record<
        string,
        unknown
      >;
    });

    for (const select of selects) {
      expect(select).not.toHaveProperty("apiKey");
    }

    // Read pinned to the caller's project.
    expect(
      (
        (ToolImportRunService.findOneBy as jest.Mock).mock
          .calls[0]![0] as Record<string, Record<string, unknown>>
      )["query"],
    ).toEqual({ _id: mine.id!.toString(), projectId: PROJECT_ID });
  });

  test("an owner sees someone else's import, but not its preview: only its reader starts it", async () => {
    (ToolImportRunService.findOneBy as jest.Mock).mockResolvedValue(
      run({ createdByUserId: SOMEONE_ELSE }),
    );

    const { payload } = await call("GET", "/tool-import/run/:runId", {
      params: { runId: ObjectID.generate().toString() },
    });

    expect(payload!["plan"]).toBeUndefined();
    expect(ToolImportRunExecutor.getPlan).not.toHaveBeenCalled();
  });

  test("anyone else's import is not found for a member who is not an owner or admin", async () => {
    callerProps = propsWith([Permission.ProjectMember]);
    (ToolImportRunService.findOneBy as jest.Mock).mockResolvedValue(
      run({ createdByUserId: SOMEONE_ELSE }),
    );

    const { thrown } = await call("GET", "/tool-import/run/:runId", {
      params: { runId: ObjectID.generate().toString() },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect((thrown as Error).message).toBe("This import was not found.");
  });

  test("a preview past its day reads as expired, with nothing to start", async () => {
    (ToolImportRunService.findOneBy as jest.Mock).mockResolvedValue(run());
    (ToolImportRunExecutor.isReviewExpired as jest.Mock).mockReturnValue(true);

    const { payload } = await call("GET", "/tool-import/run/:runId", {
      params: { runId: ObjectID.generate().toString() },
    });

    expect((payload!["run"] as Record<string, unknown>)["status"]).toBe(
      ToolImportRunStatus.Expired,
    );
    expect(payload!["plan"]).toBeUndefined();
  });

  test("a finished import comes with its report and the counts of what happened", async () => {
    (ToolImportRunService.findOneBy as jest.Mock).mockResolvedValue(
      run({
        status: ToolImportRunStatus.Completed,
        report: {
          items: [
            {
              key: "Team:t",
              kind: "Team",
              sourceId: "t",
              name: "Platform",
              outcome: "Created",
              recordIds: [],
              notes: [],
            },
          ],
        },
      }),
    );

    const { payload } = await call("GET", "/tool-import/run/:runId", {
      params: { runId: ObjectID.generate().toString() },
    });

    expect(
      (payload!["report"] as { items: Array<unknown> }).items,
    ).toHaveLength(1);
    expect(
      (
        (payload!["run"] as Record<string, unknown>)["counts"] as Record<
          string,
          number
        >
      )["Created"],
    ).toBe(1);
  });

  test("a run id that is not an id is not found", async () => {
    const { thrown } = await call("GET", "/tool-import/run/:runId", {
      params: { runId: "../../etc" },
    });

    expect(thrown).toBeInstanceOf(BadDataException);
    expect(ToolImportRunService.findOneBy).not.toHaveBeenCalled();
  });

  test("starting and discarding go to the import as the person, for the run in the path", async () => {
    const runId: ObjectID = ObjectID.generate();

    await call("POST", "/tool-import/run/:runId/start", {
      params: { runId: runId.toString() },
      body: { selectedKeys: ["Person:a"], inviteTeamId: null },
    });

    expect(ToolImportRunExecutor.startImport).toHaveBeenCalledWith({
      runId: runId,
      projectId: PROJECT_ID,
      props: callerProps,
      selection: { selectedKeys: ["Person:a"], inviteTeamId: null },
    });

    await call("POST", "/tool-import/run/:runId/cancel", {
      params: { runId: runId.toString() },
    });

    expect(ToolImportRunExecutor.cancel).toHaveBeenCalledWith({
      runId: runId,
      projectId: PROJECT_ID,
      props: callerProps,
    });
  });
});
