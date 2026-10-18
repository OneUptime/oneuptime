import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * WHAT THIS FILE DEFENDS
 *
 * A probe, a Runner and an AI agent each prove who they are with the key
 * stored on their row (Probe.key, Runner.key, AIAgent.key). The server makes
 * a random one when a row is created without it, and the people who may
 * manage the component may write one themselves: on create, or as the
 * dashboard's Reset Key does (a new random id written by update).
 *
 * A value the OneUptime repository ships - "secret", a placeholder from
 * config.example.env (they all contain "please-change-this"), or a blank
 * key - is public, so it is never stored as such a key, whoever writes it.
 * Every write is made here through the real CRUD routes (BaseAPI and the
 * component's own API class, the services' hooks and the whole permission
 * layer), as each role the model lets write the key, with the table held in
 * memory; and through the services as the server itself (root).
 *
 * What still works: a create without a key gets a random one, an operator's
 * own long random key is stored as given, Reset Key stores its new key, and
 * a row from before this rule that holds a shipped key can still be renamed
 * - and given a real key.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
      sendFileResponse: jest.fn(),
      setNoCacheHeaders: jest.fn(),
    },
  };
});

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

import AIAgentAPI from "../../../Server/API/AIAgentAPI";
import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import ProbeAPI from "../../../Server/API/ProbeAPI";
import AIAgentService from "../../../Server/Services/AIAgentService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import ProbeService from "../../../Server/Services/ProbeService";
import RunnerService, {
  Service as RunnerServiceType,
} from "../../../Server/Services/RunnerService";
import ComponentKeyWrite from "../../../Server/Utils/ComponentKeyWrite";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { ColumnAccessControl } from "../../../Types/BaseDatabase/AccessControl";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { customDomainCaller } from "./CustomDomainCallers";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";

type MockedFn = ReturnType<typeof jest.fn>;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const ROW_ID: string = "22222222-2222-4222-8222-222222222222";
// A key the server made: what every row carries before these writes.
const STORED_KEY: string = "33333333-3333-4333-8333-333333333333";
// An operator's own long random key.
const OPERATORS_KEY: string = "3b9f1c7e5a2d48f6b0e9c3a7d1f5b8e2a4c6e8f0";
// What Reset Key writes: a new random id, made in the browser.
const RESET_KEY: string = "44444444-4444-4444-8444-444444444444";
const GENERATED_KEY: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

// The values the repository ships, as anybody would try them first.
const SHIPPED_KEYS: Array<[string, string]> = [
  ["the old fallback", "secret"],
  [
    "the placeholder config.example.env ships",
    "please-change-this-to-random-value",
  ],
  ["a bundled probe's placeholder", "probe-1-please-change-this-to-random-value"],
  ["a placeholder with something added", "please-change-this-to-random-value-2"],
  ["a padded placeholder", "  please-change-this-to-random-value  "],
  ["a padded fallback", " secret "],
  ["a key of spaces", "   "],
];

interface Kind {
  // As the refusal names it, with its article.
  component: string;
  // The row's name, without one.
  noun: string;
  /*
   * What lets a role that may only edit the row read it, as every such role
   * is given with it: an update needs the record to be readable too.
   */
  reader: Permission;
  route: string;
  modelType: { new (): BaseModel };
  service: DatabaseService<BaseModel>;
  registerApi: () => void;
}

const KINDS: Array<Kind> = [
  {
    component: "a probe",
    noun: "probe",
    reader: Permission.ReadProjectProbe,
    route: "/probe",
    modelType: Probe as unknown as { new (): BaseModel },
    service: ProbeService as unknown as DatabaseService<BaseModel>,
    registerApi: (): void => {
      new ProbeAPI();
    },
  },
  {
    component: "a Runner",
    noun: "Runner",
    reader: Permission.ReadRunner,
    route: "/runner",
    modelType: Runner as unknown as { new (): BaseModel },
    service: RunnerService as unknown as DatabaseService<BaseModel>,
    registerApi: (): void => {
      new BaseAPI<Runner, RunnerServiceType>(Runner, RunnerService);
    },
  },
  {
    component: "an AI agent",
    noun: "AI agent",
    reader: Permission.ReadProjectAIAgent,
    route: "/ai-agent",
    modelType: AIAgent as unknown as { new (): BaseModel },
    service: AIAgentService as unknown as DatabaseService<BaseModel>,
    registerApi: (): void => {
      new AIAgentAPI();
    },
  },
];

/*
 * The roles that may write the key, read from the model, so the suite
 * follows the model: each one is asked to store a shipped key below.
 */
function keyWriters(
  kind: Kind,
  operation: "create" | "update",
): Array<Permission> {
  const access: ColumnAccessControl | null =
    new kind.modelType().getColumnAccessControlFor("key");

  expect(access).not.toBeNull();

  return [...(access as ColumnAccessControl)[operation]];
}

let props: DatabaseCommonInteractionProps;
let table: InMemoryTable;

const sendEntityResponseMock: MockedFn =
  Response.sendEntityResponse as unknown as MockedFn;
const sendEmptySuccessResponseMock: MockedFn =
  Response.sendEmptySuccessResponse as unknown as MockedFn;

function caller(
  permissions: Array<Permission>,
  extra: Partial<Parameters<typeof customDomainCaller>[0]> = {},
): DatabaseCommonInteractionProps {
  return {
    ...customDomainCaller({
      permissions: permissions,
      projectId: PROJECT_ID,
      ...extra,
    }),
    ...ON_HIGHEST_PLAN,
  };
}

// The row every update below writes: a component of the project, as created.
function storedRow(kind: Kind, overrides: StoredRow = {}): StoredRow {
  return {
    _id: ROW_ID,
    projectId: PROJECT_ID.toString(),
    name: `Site A ${kind.noun}`,
    slug: `site-a-${kind.noun.toLowerCase().replace(" ", "-")}`,
    key: STORED_KEY,
    createdAt: new Date("2026-10-01T09:00:00.000Z"),
    version: 1,
    ...overrides,
  };
}

async function callRoute(
  method: string,
  route: string,
  data: { body?: JSONObject; params?: Record<string, string> } = {},
): Promise<{ error: Error | undefined }> {
  const req: ExpressRequest = {
    params: data.params || {},
    query: {},
    headers: {},
    body: data.body || {},
  } as unknown as ExpressRequest;
  const next: MockedFn = jest.fn();

  await mockRouter
    .match(method, route)
    .handlerFunction(
      req,
      {} as ExpressResponse,
      next as unknown as NextFunction,
    );

  return { error: next.mock.calls[0]?.[0] as Error | undefined };
}

let created: number = 0;

// POST /<component>: what ModelAPI.create sends, with `key` when given.
async function create(
  kind: Kind,
  key: string | undefined,
): Promise<{ error: Error | undefined }> {
  created++;

  // A name of its own each time: a project's Runners have unique names.
  const data: JSONObject = {
    name: `New ${kind.noun} ${created}`,
    description: "Made by the test",
  };

  if (key !== undefined) {
    data["key"] = key;
  }

  return await callRoute("POST", kind.route, {
    body: { data: data, miscDataProps: {} },
  });
}

// PUT /<component>/:id: what ModelAPI.updateById sends.
async function update(
  kind: Kind,
  data: JSONObject,
): Promise<{ error: Error | undefined }> {
  return await callRoute("PUT", `${kind.route}/:id`, {
    params: { id: ROW_ID },
    body: { data: data },
  });
}

function expectShippedKeyRefusal(
  kind: Kind,
  error: Error | undefined,
): void {
  expect(error).toBeInstanceOf(BadDataException);
  expect((error as Error).message).toBe(
    ComponentKeyWrite.refusal(kind.component),
  );
}

beforeAll(() => {
  mockRouter.routes.length = 0;

  for (const kind of KINDS) {
    kind.registerApi();
  }
});

beforeEach(() => {
  jest.clearAllMocks();
  stubProjectDirectory({});

  props = caller([Permission.ProjectOwner]);

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation(async (): Promise<DatabaseCommonInteractionProps> => {
      return props;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("$component's key", (kind: Kind) => {
  beforeEach(() => {
    table = useInMemoryTable(kind.service, [storedRow(kind)]);
  });

  describe("on create", () => {
    test("the model lets some roles write the key, so the rule has someone to hold", () => {
      expect(keyWriters(kind, "create").length).toBeGreaterThan(0);
    });

    test.each(SHIPPED_KEYS)(
      "%s is refused, and nothing is stored",
      async (_label: string, key: string) => {
        const { error } = await create(kind, key);

        expectShippedKeyRefusal(kind, error);
        expect(table.inserts).toHaveLength(0);
        expect(sendEntityResponseMock).not.toHaveBeenCalled();
      },
    );

    test("every role that may write the key is refused a shipped one, and stores a real one", async () => {
      for (const permission of keyWriters(kind, "create")) {
        props = caller([permission]);

        const refused: { error: Error | undefined } = await create(
          kind,
          "please-change-this-to-random-value",
        );

        expect({ permission, refused: refused.error?.message }).toEqual({
          permission,
          refused: ComponentKeyWrite.refusal(kind.component),
        });

        // A key of its own each time: keys are unique.
        const stored: { error: Error | undefined } = await create(
          kind,
          `${OPERATORS_KEY}-${ObjectID.generate().toString()}`,
        );

        expect({ permission, error: stored.error }).toEqual({
          permission,
          error: undefined,
        });
      }

      // Only the real keys were stored, one per role.
      expect(table.inserts).toHaveLength(keyWriters(kind, "create").length);
      for (const row of table.inserts) {
        expect(String(row["key"]).startsWith(OPERATORS_KEY)).toBe(true);
      }
    });

    test("a project API key holding the role is refused a shipped key too", async () => {
      props = caller([Permission.ProjectAdmin], { isApiKey: true });

      const { error } = await create(kind, "secret");

      expectShippedKeyRefusal(kind, error);
      expect(table.inserts).toHaveLength(0);
    });

    test("without a key, the server makes a random one", async () => {
      const { error } = await create(kind, undefined);

      expect(error).toBeUndefined();
      expect(table.inserts).toHaveLength(1);
      expect(String(table.inserts[0]!["key"])).toMatch(GENERATED_KEY);
    });

    test("an empty key is a key left out: the server makes a random one", async () => {
      const { error } = await create(kind, "");

      expect(error).toBeUndefined();
      expect(table.inserts).toHaveLength(1);
      expect(String(table.inserts[0]!["key"])).toMatch(GENERATED_KEY);
    });

    test("an operator's own long random key is stored as given", async () => {
      const { error } = await create(kind, OPERATORS_KEY);

      expect(error).toBeUndefined();
      expect(table.inserts).toHaveLength(1);
      expect(table.inserts[0]!["key"]).toBe(OPERATORS_KEY);
    });

    test("the server itself (root) is refused a shipped key as well", async () => {
      const model: BaseModel = new kind.modelType();
      (model as unknown as JSONObject)["projectId"] = PROJECT_ID;
      (model as unknown as JSONObject)["name"] = `Root ${kind.noun}`;
      (model as unknown as JSONObject)["key"] =
        "probe-2-please-change-this-to-random-value";

      await expect(
        kind.service.create({ data: model, props: { isRoot: true } }),
      ).rejects.toThrow(ComponentKeyWrite.refusal(kind.component));
      expect(table.inserts).toHaveLength(0);
    });
  });

  describe("on update", () => {
    test("the model lets some roles write the key, so the rule has someone to hold", () => {
      expect(keyWriters(kind, "update").length).toBeGreaterThan(0);
    });

    test.each([
      ...SHIPPED_KEYS,
      ["an empty key", ""] as [string, string],
    ])(
      "%s is refused, and the stored key stays",
      async (_label: string, key: string) => {
        const { error } = await update(kind, { key: key });

        expectShippedKeyRefusal(kind, error);
        expect(table.get(ROW_ID)!["key"]).toBe(STORED_KEY);
        expect(table.updates).toHaveLength(0);
        expect(sendEmptySuccessResponseMock).not.toHaveBeenCalled();
      },
    );

    test("every role that may write the key is refused a shipped one, and resets it to a real one", async () => {
      for (const permission of keyWriters(kind, "update")) {
        props = caller([permission, kind.reader]);

        const refused: { error: Error | undefined } = await update(kind, {
          key: "please-change-this-to-random-value",
        });

        expect({ permission, refused: refused.error?.message }).toEqual({
          permission,
          refused: ComponentKeyWrite.refusal(kind.component),
        });
        expect(table.get(ROW_ID)!["key"]).not.toBe(
          "please-change-this-to-random-value",
        );

        // What Reset Key writes: a new random id each time.
        const newKey: string = ObjectID.generate().toString();
        const reset: { error: Error | undefined } = await update(kind, {
          key: newKey,
        });

        expect({ permission, error: reset.error }).toEqual({
          permission,
          error: undefined,
        });
        expect(table.get(ROW_ID)!["key"]).toBe(newKey);
      }
    });

    test("Reset Key stores its new random key", async () => {
      const { error } = await update(kind, { key: RESET_KEY });

      expect(error).toBeUndefined();
      expect(table.get(ROW_ID)!["key"]).toBe(RESET_KEY);
    });

    test("an update that leaves the key out is not held to it", async () => {
      const { error } = await update(kind, { description: "Moved racks" });

      expect(error).toBeUndefined();
      expect(table.get(ROW_ID)!["description"]).toBe("Moved racks");
      expect(table.get(ROW_ID)!["key"]).toBe(STORED_KEY);
    });

    test("a row from before this rule that holds a shipped key can still be edited, and given a real key", async () => {
      table = useInMemoryTable(kind.service, [
        storedRow(kind, { key: "please-change-this-to-random-value" }),
      ]);

      const edited: { error: Error | undefined } = await update(kind, {
        description: "Still here",
      });

      expect(edited.error).toBeUndefined();
      expect(table.get(ROW_ID)!["description"]).toBe("Still here");

      const reset: { error: Error | undefined } = await update(kind, {
        key: RESET_KEY,
      });

      expect(reset.error).toBeUndefined();
      expect(table.get(ROW_ID)!["key"]).toBe(RESET_KEY);
    });

    test("the server itself (root) is refused a shipped key as well", async () => {
      await expect(
        kind.service.updateOneById({
          id: new ObjectID(ROW_ID),
          data: { key: "secret" } as never,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(ComponentKeyWrite.refusal(kind.component));
      expect(table.get(ROW_ID)!["key"]).toBe(STORED_KEY);
      expect(table.updates).toHaveLength(0);
    });
  });
});

describe("the refusal", () => {
  test.each(KINDS)(
    "names $component, says why, and says what to do instead",
    (kind: Kind) => {
      const message: string = ComponentKeyWrite.refusal(kind.component);

      expect(message).toContain(`as ${kind.component}'s key.`);
      expect(message).toContain("public");
      expect(message).toContain("please-change-this-to-random-value");
      expect(message).toContain("long random value");
    },
  );
});
