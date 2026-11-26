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
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../../Server/Services/RunnerService";
import Runner from "../../../Models/DatabaseModels/Runner";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import DashboardRequestsOverHttp, {
  SentRequest,
} from "../TestingUtils/DashboardRequestsOverHttp";
import {
  InMemoryTable,
  StoredRow,
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
 * ONLY THOSE WHO MAY READ A RUNNER'S KEY CHOOSE ONE, THROUGH THE API.
 *
 * A Runner's key is the Runner: whoever holds it runs a Runner of their own
 * as this one, on a host of their choosing, and is sent its jobs with every
 * secret they carry. Only a Project Owner, Project Admin or Runbook Admin
 * reads one, as the docs say. But a Project Member, or Create Runner, could
 * create a Runner with a key of their own choosing, and Edit Runner could
 * change a Runner's key to one - knowing a key they may not read.
 *
 * Through Express, BaseAPI, the permission layer, RunnerService's hooks and
 * a table in memory:
 *
 *   - a create that chooses a key is refused for anyone who may not read
 *     one, from a person or an API key, and nothing is written;
 *   - a create that chooses none is given a key OneUptime generates, as the
 *     Runners page creates every Runner;
 *   - changing a key is refused for Edit Runner and a Project Member, and
 *     the key is left as it was;
 *   - a Project Owner, Project Admin and Runbook Admin choose and change it
 *     as before, and Edit Runner still changes the rest of a Runner.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1f5f0000-0000-4000-8000-000000000005",
);
const RUNNER_ID: string = "1f5f0000-0000-4000-8000-0000000000e1";
const STORED_KEY: string = "1f5f0000-0000-4000-8000-0000000000e2";

// A key the caller made up, and so knows.
const CHOSEN_KEY: string = "7a1b2c3d-4e5f-4061-8a7b-9c0d1e2f3a4b";

const KEY_REFUSAL_WORDS: string =
  "You need one of these permissions: Project Owner, Project Admin, Runbook Admin.";

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
let runners: InMemoryTable;
let props: DatabaseCommonInteractionProps;

async function create(data: JSONObject): Promise<SentRequest> {
  return await server.request("POST", "/api/runner", {
    data: {
      name: "laptop-runner",
      projectId: PROJECT_ID.toString(),
      ...data,
    },
  });
}

async function update(data: JSONObject): Promise<SentRequest> {
  return await server.request("PUT", `/api/runner/${RUNNER_ID}`, {
    data: data,
  });
}

function refusalOf(sent: SentRequest): string {
  const answer: JSONObject = (sent.answer || {}) as JSONObject;
  return String(answer["error"] || answer["message"] || "");
}

function createdRunners(): Array<StoredRow> {
  return runners.rows.filter((row: StoredRow) => {
    return row["name"] === "laptop-runner";
  });
}

// The key a row holds, as the service reads it back: decrypted.
async function keyOf(id: string): Promise<string | undefined> {
  const runner: Runner | null = await RunnerService.findOneById({
    id: new ObjectID(id),
    select: { _id: true, key: true },
    props: { isRoot: true },
  });

  return runner?.key;
}

beforeAll(async () => {
  server = new DashboardRequestsOverHttp();
  await server.start([
    new BaseAPI<Runner, DatabaseService<BaseModel>>(
      Runner,
      RunnerService as unknown as DatabaseService<BaseModel>,
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

  getJestSpyOn(RunnerService, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );

  runners = useInMemoryTable(RunnerService, []);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("POST /api/runner with a key the caller chose", () => {
  test.each([
    ["a Project Member", caller([Permission.ProjectMember])],
    ["a Project Member's API key", caller([Permission.ProjectMember], true)],
    ["Create Runner", caller([Permission.CreateRunner, Permission.ReadRunner])],
    [
      "Create and Edit Runner",
      caller([
        Permission.CreateRunner,
        Permission.EditRunner,
        Permission.ReadRunner,
      ]),
    ],
  ])(
    "from %s, who may not read a key, is refused and nothing is written",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create({ key: CHOSEN_KEY });

      expect(sent.status).toBeGreaterThanOrEqual(400);
      expect(refusalOf(sent)).toContain("key");
      expect(refusalOf(sent)).toContain(KEY_REFUSAL_WORDS);
      expect(runners.inserts).toEqual([]);
      expect(createdRunners()).toEqual([]);
    },
  );

  test.each([
    ["a Project Owner", caller([Permission.ProjectOwner])],
    ["a Project Admin", caller([Permission.ProjectAdmin])],
    ["a Runbook Admin", caller([Permission.RunbookAdmin])],
    ["a Runbook Admin's API key", caller([Permission.RunbookAdmin], true)],
  ])(
    "from %s, who may read one, is created with it",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create({ key: CHOSEN_KEY });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(createdRunners()).toHaveLength(1);
      expect(await keyOf(String(createdRunners()[0]!["_id"]))).toBe(CHOSEN_KEY);
    },
  );
});

describe("POST /api/runner with no key, as the Runners page creates one", () => {
  test.each([
    ["a Project Member", caller([Permission.ProjectMember])],
    ["Create Runner", caller([Permission.CreateRunner, Permission.ReadRunner])],
    ["a Runbook Admin", caller([Permission.RunbookAdmin])],
  ])(
    "from %s is created, with a key OneUptime generates",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      for (const data of [{}, { key: "" }, { key: null }]) {
        runners.rows.length = 0;

        const sent: SentRequest = await create(data);

        expect({ data, status: sent.status, refusal: refusalOf(sent) }).toEqual(
          { data, status: 200, refusal: "" },
        );
        expect(createdRunners()).toHaveLength(1);

        const key: string | undefined = await keyOf(
          String(createdRunners()[0]!["_id"]),
        );

        expect(ObjectID.isValidUUID(key || "")).toBe(true);
        expect(key).not.toBe(CHOSEN_KEY);
      }
    },
  );

  test("the answer does not hand a Project Member the key it was given", async () => {
    props = caller([Permission.ProjectMember]);

    const sent: SentRequest = await create({});
    const key: string | undefined = await keyOf(
      String(createdRunners()[0]!["_id"]),
    );

    expect(sent.status).toBe(200);
    expect(ObjectID.isValidUUID(key || "")).toBe(true);
    expect(JSON.stringify(sent.answer)).not.toContain(key as string);
    expect((sent.answer as JSONObject)["name"]).toBe("laptop-runner");
  });

  test.each([
    ["a Runbook Admin", caller([Permission.RunbookAdmin])],
    ["a Project Admin", caller([Permission.ProjectAdmin])],
  ])(
    "%s, who may read keys, is answered with the key it was given, as before",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await create({});
      const key: string | undefined = await keyOf(
        String(createdRunners()[0]!["_id"]),
      );

      expect(sent.status).toBe(200);
      expect((sent.answer as JSONObject)["key"]).toBe(key);
    },
  );
});

describe("PUT /api/runner/:id that changes its key", () => {
  beforeEach(() => {
    runners = useInMemoryTable(RunnerService, [
      {
        _id: RUNNER_ID,
        projectId: PROJECT_ID.toString(),
        name: "prod-eu-west-1",
        slug: "prod-eu-west-1",
        key: STORED_KEY,
        canRunRunbooks: true,
        isGlobalRunner: false,
        isProjectDefault: false,
        version: 1,
      },
    ]);
  });

  test.each([
    [
      "Edit Runner, who may not read a key",
      caller([Permission.EditRunner, Permission.ReadRunner]),
    ],
    ["a Project Member", caller([Permission.ProjectMember])],
    ["a Runbook Member", caller([Permission.RunbookMember])],
  ])(
    "from %s is refused, and the key is as it was",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await update({ key: CHOSEN_KEY });

      expect(sent.status).toBeGreaterThanOrEqual(400);
      expect(runners.updates).toEqual([]);
      expect(await keyOf(RUNNER_ID)).toBe(STORED_KEY);
    },
  );

  test("Edit Runner is told who may", async () => {
    props = caller([Permission.EditRunner, Permission.ReadRunner]);

    const sent: SentRequest = await update({ key: CHOSEN_KEY });

    expect(refusalOf(sent)).toContain(KEY_REFUSAL_WORDS);
  });

  test.each([
    ["a Project Admin", caller([Permission.ProjectAdmin])],
    ["a Runbook Admin", caller([Permission.RunbookAdmin])],
  ])(
    "from %s changes it",
    async (_who: string, as: DatabaseCommonInteractionProps) => {
      props = as;

      const sent: SentRequest = await update({ key: CHOSEN_KEY });

      expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
        status: 200,
        refusal: "",
      });
      expect(await keyOf(RUNNER_ID)).toBe(CHOSEN_KEY);
    },
  );

  test("Edit Runner still changes the rest of a Runner", async () => {
    props = caller([Permission.EditRunner, Permission.ReadRunner]);

    const sent: SentRequest = await update({
      description: "Reaches the production network",
    });

    expect({ status: sent.status, refusal: refusalOf(sent) }).toEqual({
      status: 200,
      refusal: "",
    });
    expect(runners.get(RUNNER_ID)!["description"]).toBe(
      "Reaches the production network",
    );
    expect(await keyOf(RUNNER_ID)).toBe(STORED_KEY);
  });
});

describe("who may choose a Runner's key", () => {
  test("is who may read one: the key's create check, update list and read list name the same three", () => {
    const access: ReturnType<Runner["getColumnAccessControlFor"]> =
      new Runner().getColumnAccessControlFor("key");

    expect(access?.read).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.RunbookAdmin,
    ]);
    expect(access?.update).toEqual(access?.read);
  });

  test.each([
    [[Permission.ProjectMember], true],
    [[Permission.CreateRunner], true],
    [[Permission.EditRunner], true],
    [[Permission.ProjectOwner], false],
    [[Permission.ProjectAdmin], false],
    [[Permission.RunbookAdmin], false],
  ])(
    "assertMayChooseKey: %s refused -> %s",
    (permissions: Array<Permission>, refused: boolean) => {
      let error: unknown = undefined;

      try {
        RunnerServiceClass.assertMayChooseKey(
          { key: CHOSEN_KEY },
          caller(permissions),
        );
      } catch (caught) {
        error = caught;
      }

      expect(Boolean(error)).toBe(refused);
    },
  );

  test("a create that chooses no key is never refused, and OneUptime and a master admin choose any", () => {
    for (const key of [undefined, ""]) {
      expect(() => {
        RunnerServiceClass.assertMayChooseKey(
          { key: key },
          caller([Permission.ProjectMember]),
        );
      }).not.toThrow();
    }

    expect(() => {
      RunnerServiceClass.assertMayChooseKey(
        { key: CHOSEN_KEY },
        { isRoot: true },
      );
    }).not.toThrow();
    expect(() => {
      RunnerServiceClass.assertMayChooseKey(
        { key: CHOSEN_KEY },
        { isMasterAdmin: true },
      );
    }).not.toThrow();
  });
});
