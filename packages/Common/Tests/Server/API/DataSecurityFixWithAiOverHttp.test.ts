jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
      getLogLevel: jest.fn().mockReturnValue("INFO"),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import CommonAPI from "../../../Server/API/CommonAPI";
import DataSecurityAPI from "../../../Server/API/DataSecurityAPI";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import AIService, {
  AI_DISABLED_MESSAGE,
  ProjectAiDailyLimitStatus,
  getProjectDailyLimitMessage,
} from "../../../Server/Services/AIService";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DataSecurityCustomDataTypeService from "../../../Server/Services/DataSecurityCustomDataTypeService";
import DataSecurityIssueFeedService from "../../../Server/Services/DataSecurityIssueFeedService";
import DataSecurityIssueService from "../../../Server/Services/DataSecurityIssueService";
import DataStoreFindingService from "../../../Server/Services/DataStoreFindingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProjectService from "../../../Server/Services/ProjectService";
import CodeFixReadiness, {
  CODE_FIX_AI_CREDITS_USED_UP_DETAIL,
  NO_GLOBAL_RUNNER_ONLINE_DETAIL,
} from "../../../Server/Utils/AI/CodeFix/CodeFixReadiness";
import CodeRepositoryRunnerChoice, {
  CodeRepositoryRunnerStatus,
} from "../../../Server/Utils/AI/CodeFix/CodeRepositoryRunnerChoice";
import CodeTaskAccess, {
  CODE_TASK_ASK_REFUSED_MESSAGE,
  CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
} from "../../../Server/Utils/AI/CodeTask/CodeTaskAccess";
import { CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE } from "../../../Server/Utils/AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../../../Server/Utils/AI/CodeTask/CodeTaskRuns";
import {
  DATA_SECURITY_FIX_STARTED_MESSAGE,
  DataSecurityFixCode,
  getDataSecurityFixNoRepositoryMessage,
  getDataSecurityFixPickRepositoryMessage,
} from "../../../Server/Utils/AI/DataSecurity/DataSecurityCodeTask";
import CodeHostAccess, {
  CodeHostConnectionState,
  CodeHostConnectionSummary,
} from "../../../Server/Utils/CodeRepository/CodeHost/CodeHostAccess";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Project from "../../../Models/DatabaseModels/Project";
import { ProjectAiDailyLimit } from "../../../Types/AI/ProjectAiDailyLimits";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { DATA_SECURITY_API_ROUTES } from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { CodeRepositoryRunnerChoiceKind } from "../../../Types/Runner/CodeRepositoryRunner";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { everyServerProductIsOn } from "../TestingUtils/ServerProductsOn";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * FIX WITH AI, THROUGH THE SERVER'S OWN ROUTE, FOR EACH ROLE (#10362).
 *
 * Fix with AI on a Data Security issue read the project's repositories as
 * OneUptime and started a code task in the one asked for, or the only one:
 * a Security Member whose team may not change - or read - the `infra`
 * repository in Code sent its id, and OneUptime AI pushed a branch and
 * opened a pull request there. With AI off, no Runner, no credits or the
 * limits reached, it still said "OneUptime AI is working on a fix" and
 * queued a run that failed later.
 *
 * Here the route runs as the App serves it - Express, its permission
 * check, the issue read - and Code's own checks run for real: the
 * repositories read with the caller's permissions (CodeTaskAccess, through
 * the permission layer, from tables held in memory) and the gate
 * (CodeTaskGate), whose sources - the project's AI switch and limits, the
 * repository's connection, the LLM provider and the Runner - are stood in
 * for. The run itself (CodeTaskRuns.start) is stood in for: it records the
 * work, and only once everything allowed it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10362000-0000-4000-8000-000000000001",
);
const ISSUE_ID: string = "10362000-0000-4000-8000-0000000000a1";
const STORE_ID: string = "10362000-0000-4000-8000-0000000000b1";
const INFRA_ID: string = "10362000-0000-4000-8000-0000000000c1";
const WEBSITE_ID: string = "10362000-0000-4000-8000-0000000000c2";
const RUN_ID: ObjectID = new ObjectID("10362000-0000-4000-8000-0000000000f1");

const PERMISSION_MESSAGE: string =
  "You do not have permission to do this in Data Security.";

// What the permission layer answers a read of the repositories by a role that may read none.
const READ_REPOSITORY_REFUSED_MESSAGE: string =
  "You do not have permissions to read Code Repository. You need one of these permissions: Project Owner, Project Admin, Project Member, Viewer, Settings Admin, Settings Member, Settings Viewer, Read Code Repository";

interface World {
  enableAi: boolean;
  llmOk: boolean;
  llmDetail: string;
  reachedLimit: ProjectAiDailyLimitStatus | null;
  connection: CodeHostConnectionState;
  runnerOnline: boolean;
}

let world: World;
let server: DashboardRequestsOverHttp;
let caller: DatabaseCommonInteractionProps;
let codeRepositories: InMemoryTable;
let started: SpyInstance<typeof CodeTaskRuns.start>;
let feed: SpyInstance<
  typeof DataSecurityIssueFeedService.createDataSecurityIssueFeedItem
>;

function callerWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({ permissions: permissions, projectId: PROJECT_ID }),
    ...ON_HIGHEST_PLAN,
  };
}

function repositoryRow(id: string, name: string): StoredRow {
  return {
    _id: id,
    projectId: PROJECT_ID.toString(),
    name: name,
    repositoryHostedAt: CodeRepositoryType.GitHub,
    organizationName: "acme",
    repositoryName: name,
    mainBranchName: "main",
    labels: [],
  };
}

const asService: <T extends BaseModel>(
  service: unknown,
) => DatabaseService<T> = <T extends BaseModel>(
  service: unknown,
): DatabaseService<T> => {
  return service as DatabaseService<T>;
};

function passSessionGuards(): void {
  jest.spyOn(UserMiddleware, "getUserMiddleware").mockImplementation((async (
    _req: ExpressRequest,
    _res: ExpressResponse,
    next: NextFunction,
  ) => {
    next();
  }) as never);
  jest
    .spyOn(UserMiddleware, "requireUserAuthentication")
    .mockImplementation((async (
      _req: ExpressRequest,
      _res: ExpressResponse,
      next: NextFunction,
    ) => {
      next();
    }) as never);
}

beforeAll(async () => {
  passSessionGuards();
  server = new DashboardRequestsOverHttp();
  await server.start([new DataSecurityAPI().getRouter()]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  caller = callerWith([Permission.ProjectOwner]);

  world = {
    enableAi: true,
    llmOk: true,
    llmDetail: "",
    reachedLimit: null,
    connection: CodeHostConnectionState.Connected,
    runnerOnline: true,
  };

  everyServerProductIsOn();
  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    });

  useInMemoryTable(asService(DataSecurityIssueService), [
    {
      _id: ISSUE_ID,
      projectId: PROJECT_ID.toString(),
      title: "Anyone on the internet can read it",
      checkId: "public-read",
      evidence: "The bucket policy grants s3:GetObject to *.",
      severity: "Critical",
      status: "Open",
      dataTypeIds: ["credit-card-number"],
      dataStoreId: STORE_ID,
      dataStore: {
        _id: STORE_ID,
        name: "acme-card-exports",
        kind: "AWS S3 Bucket",
        region: "eu-north-1",
        sensitivity: "Restricted",
        providerResourceId: "arn:aws:s3:::acme-card-exports",
      },
    },
  ]);
  codeRepositories = useInMemoryTable(asService(CodeRepositoryService), [
    repositoryRow(INFRA_ID, "infra"),
  ]);
  useInMemoryTable(asService(DataStoreFindingService), []);
  useInMemoryTable(asService(DataSecurityCustomDataTypeService), []);

  // The gate's sources, as the world says.
  jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async (): Promise<Project | null> => {
      const project: Project = new Project(PROJECT_ID);
      project.enableAi = world.enableAi;
      return project;
    });
  jest
    .spyOn(CodeHostAccess, "getConnectionSummaries")
    .mockImplementation(
      async (data: {
        repositoryIds: Array<ObjectID>;
      }): Promise<Map<string, CodeHostConnectionSummary>> => {
        return new Map(
          data.repositoryIds.map(
            (id: ObjectID): [string, CodeHostConnectionSummary] => {
              return [
                id.toString(),
                {
                  connectionId: null,
                  provider: CodeRepositoryType.GitHub,
                  hostUrl: null,
                  hostProduct: null,
                  accountLogin: "acme",
                  credentialHint: null,
                  state: world.connection,
                  isReachableFromServer: true,
                },
              ];
            },
          ),
        );
      },
    );
  jest
    .spyOn(CodeFixReadiness, "getLlmProviderCheck")
    .mockImplementation(async () => {
      return {
        id: "llmProvider",
        ok: world.llmOk,
        title: "An LLM provider is available",
        detail: world.llmDetail,
      } as never;
    });
  jest
    .spyOn(AIService, "getReachedProjectDailyLimit")
    .mockImplementation(async () => {
      return world.reachedLimit;
    });
  jest
    .spyOn(CodeRepositoryRunnerChoice, "getStatusForRepository")
    .mockImplementation(async (): Promise<CodeRepositoryRunnerStatus> => {
      return {
        decision: { kind: CodeRepositoryRunnerChoiceKind.Global },
        isOnline: world.runnerOnline,
      };
    });

  started = jest
    .spyOn(CodeTaskRuns, "start")
    .mockImplementation(async (): Promise<AIRun> => {
      return new AIRun(RUN_ID);
    });
  feed = jest
    .spyOn(DataSecurityIssueFeedService, "createDataSecurityIssueFeedItem")
    .mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  // The session guards stay as the router was built with them.
  passSessionGuards();
});

async function fixAs(
  permissions: Array<Permission>,
  body: JSONObject = {},
): Promise<SentRequest> {
  caller = callerWith(permissions);

  return await server.request(
    "POST",
    `/api${DATA_SECURITY_API_ROUTES.fixIssueWithAi(ISSUE_ID)}`,
    body,
  );
}

function answerOf(sent: SentRequest): JSONObject {
  return (sent.answer || {}) as JSONObject;
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = answerOf(sent);
  return String(answer["error"] || answer["message"] || "");
}

// What a role is answered, the project's one repository named or not.
interface Expected {
  name: string;
  permissions: Array<Permission>;
  // Refused by the route: they may not change the issue.
  isRefusedByTheRoute?: boolean;
  // The answer with no repository named, when the route lets them in.
  withNoneNamed?: { message: string; starts: boolean };
  // The answer with `infra` named: its status and words.
  withInfraNamed?: { status: number; message: string; starts: boolean };
}

const ROLES: Array<Expected> = [
  {
    name: "a project owner",
    permissions: [Permission.ProjectOwner],
    withNoneNamed: { message: DATA_SECURITY_FIX_STARTED_MESSAGE, starts: true },
    withInfraNamed: {
      status: 200,
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      starts: true,
    },
  },
  {
    name: "a project admin",
    permissions: [Permission.ProjectAdmin],
    withNoneNamed: { message: DATA_SECURITY_FIX_STARTED_MESSAGE, starts: true },
    withInfraNamed: {
      status: 200,
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      starts: true,
    },
  },
  {
    // May change repositories, but not Data Security's issues.
    name: "a project member",
    permissions: [Permission.ProjectMember],
    isRefusedByTheRoute: true,
  },
  {
    name: "a viewer",
    permissions: [Permission.Viewer],
    isRefusedByTheRoute: true,
  },
  {
    // Works issues, and may not read the project's repositories in Code.
    name: "a security admin",
    permissions: [Permission.SecurityAdmin],
    withNoneNamed: {
      message: getDataSecurityFixNoRepositoryMessage(
        DataSecurityFixCode.Infrastructure,
      ),
      starts: false,
    },
    // Refused as Code refuses a read of a repository they may not read.
    withInfraNamed: {
      status: 422,
      message: READ_REPOSITORY_REFUSED_MESSAGE,
      starts: false,
    },
  },
  {
    name: "a security member",
    permissions: [Permission.SecurityMember],
    withNoneNamed: {
      message: getDataSecurityFixNoRepositoryMessage(
        DataSecurityFixCode.Infrastructure,
      ),
      starts: false,
    },
    withInfraNamed: {
      status: 422,
      message: READ_REPOSITORY_REFUSED_MESSAGE,
      starts: false,
    },
  },
  {
    name: "a security viewer",
    permissions: [Permission.SecurityViewer],
    isRefusedByTheRoute: true,
  },
  {
    // Reads the repository in Code, may not change it.
    name: "a security member who may read the repository",
    permissions: [Permission.SecurityMember, Permission.ReadCodeRepository],
    withNoneNamed: { message: CODE_TASK_ASK_REFUSED_MESSAGE, starts: false },
    withInfraNamed: {
      status: 422,
      message: CODE_TASK_ASK_REFUSED_MESSAGE,
      starts: false,
    },
  },
  {
    name: "a security member who may change the repository",
    permissions: [
      Permission.SecurityMember,
      Permission.ReadCodeRepository,
      Permission.EditCodeRepository,
    ],
    withNoneNamed: { message: DATA_SECURITY_FIX_STARTED_MESSAGE, starts: true },
    withInfraNamed: {
      status: 200,
      message: DATA_SECURITY_FIX_STARTED_MESSAGE,
      starts: true,
    },
  },
];

describe("who may have OneUptime AI fix an issue, and where", () => {
  test.each(ROLES)(
    "$name, with no repository named",
    async (role: Expected) => {
      const sent: SentRequest = await fixAs(role.permissions);

      if (role.isRefusedByTheRoute) {
        expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
          status: 422,
          refusal: PERMISSION_MESSAGE,
        });
        expect(started).not.toHaveBeenCalled();
        return;
      }

      expect(sent.status).toBe(200);
      expect(answerOf(sent)["message"]).toBe(role.withNoneNamed!.message);
      expect(started).toHaveBeenCalledTimes(role.withNoneNamed!.starts ? 1 : 0);
      expect(feed).toHaveBeenCalledTimes(role.withNoneNamed!.starts ? 1 : 0);

      if (role.withNoneNamed!.starts) {
        expect(answerOf(sent)["aiRunId"]).toBe(RUN_ID.toString());
        expect(
          (
            started.mock.calls[0]![0] as { repository: CodeRepository }
          ).repository.id!.toString(),
        ).toBe(INFRA_ID);
      }
    },
  );

  test.each(ROLES)(
    "$name, with the infra repository named, by the button or the API",
    async (role: Expected) => {
      const sent: SentRequest = await fixAs(role.permissions, {
        codeRepositoryId: INFRA_ID,
      });

      if (role.isRefusedByTheRoute) {
        expect(sent.status).toBe(422);
        expect(started).not.toHaveBeenCalled();
        return;
      }

      expect({ status: sent.status, message: refusalOf(sent) }).toEqual({
        status: role.withInfraNamed!.status,
        message: role.withInfraNamed!.message,
      });
      expect(started).toHaveBeenCalledTimes(
        role.withInfraNamed!.starts ? 1 : 0,
      );
    },
  );

  test("a repository of another project is not found, whoever asks", async () => {
    codeRepositories.rows.push({
      ...repositoryRow(WEBSITE_ID, "website"),
      projectId: ObjectID.generate().toString(),
    });

    const sent: SentRequest = await fixAs([Permission.ProjectOwner], {
      codeRepositoryId: WEBSITE_ID,
    });

    expect({ status: sent.status, message: refusalOf(sent) }).toEqual({
      status: 404,
      message: CODE_TASK_REPOSITORY_NOT_FOUND_MESSAGE,
    });
    expect(started).not.toHaveBeenCalled();
  });
});

describe("the repositories the person chooses from", () => {
  test("several the person may read: the answer lists those they may ask in, and nothing starts", async () => {
    codeRepositories.rows.push(repositoryRow(WEBSITE_ID, "website"));

    // The website is one their team may read, but not change (its labels, CodeTaskAccess).
    const canAsk: typeof CodeTaskAccess.canAskInRepository =
      CodeTaskAccess.canAskInRepository.bind(CodeTaskAccess);
    jest
      .spyOn(CodeTaskAccess, "canAskInRepository")
      .mockImplementation(
        async (data: {
          props: DatabaseCommonInteractionProps;
          projectId: ObjectID;
          repositoryId: ObjectID;
        }): Promise<boolean> => {
          return data.repositoryId.toString() === WEBSITE_ID
            ? false
            : await canAsk(data);
        },
      );

    const sent: SentRequest = await fixAs([
      Permission.SecurityMember,
      Permission.ReadCodeRepository,
      Permission.EditCodeRepository,
    ]);

    expect(sent.status).toBe(200);
    expect(answerOf(sent)).toEqual({
      message: getDataSecurityFixPickRepositoryMessage(
        DataSecurityFixCode.Infrastructure,
      ),
      repositories: [{ id: INFRA_ID, name: "infra" }],
    });
    expect(started).not.toHaveBeenCalled();
  });

  test("an owner who may ask in both is offered both, by name", async () => {
    codeRepositories.rows.push(repositoryRow(WEBSITE_ID, "website"));

    const sent: SentRequest = await fixAs([Permission.ProjectOwner]);

    expect(answerOf(sent)["repositories"]).toEqual([
      { id: INFRA_ID, name: "infra" },
      { id: WEBSITE_ID, name: "website" },
    ]);
    expect(started).not.toHaveBeenCalled();
  });
});

describe("what stops AI is said, and nothing starts", () => {
  const BLOCKED: Array<{
    what: string;
    set: () => void;
    message: () => string;
  }> = [
    {
      what: "AI switched off for the project",
      set: () => {
        world.enableAi = false;
      },
      message: () => {
        return AI_DISABLED_MESSAGE;
      },
    },
    {
      what: "no AI credits",
      set: () => {
        world.llmOk = false;
        world.llmDetail = CODE_FIX_AI_CREDITS_USED_UP_DETAIL;
      },
      message: () => {
        return CODE_FIX_AI_CREDITS_USED_UP_DETAIL;
      },
    },
    {
      what: "the project's daily limits reached",
      set: () => {
        world.reachedLimit = {
          reachedLimit: ProjectAiDailyLimit.Tokens,
          tokenLimit: 100000,
          spendLimitInUSD: null,
          usage: { usedTokensToday: 100500, spentTodayInUSDCents: 0 },
        } as unknown as ProjectAiDailyLimitStatus;
      },
      message: () => {
        return getProjectDailyLimitMessage(world.reachedLimit!);
      },
    },
    {
      what: "no Runner online",
      set: () => {
        world.runnerOnline = false;
      },
      message: () => {
        return NO_GLOBAL_RUNNER_ONLINE_DETAIL;
      },
    },
    {
      what: "a repository the GitHub App no longer reaches",
      set: () => {
        world.connection = CodeHostConnectionState.GitHubNotConnected;
      },
      message: () => {
        return CODE_TASK_REPOSITORY_NOT_CONNECTED_MESSAGE;
      },
    },
  ];

  test.each(BLOCKED)(
    "$what: the button says what to fix",
    async (blocked: { set: () => void; message: () => string }) => {
      blocked.set();

      const sent: SentRequest = await fixAs([Permission.ProjectOwner]);

      expect(sent.status).toBe(200);
      expect(answerOf(sent)).toEqual({ message: blocked.message() });
      expect(started).not.toHaveBeenCalled();
      expect(feed).not.toHaveBeenCalled();
    },
  );

  test("with AI off, a project with several repositories is not asked which one first", async () => {
    codeRepositories.rows.push(repositoryRow(WEBSITE_ID, "website"));
    world.enableAi = false;

    const sent: SentRequest = await fixAs([Permission.ProjectOwner]);

    expect(answerOf(sent)).toEqual({ message: AI_DISABLED_MESSAGE });
  });
});
