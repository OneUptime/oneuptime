import AuditLogRecorder, {
  AuditLogStore,
} from "../../../Server/AuditLog/AuditLogRecorder";
import {
  installFakeEnterpriseModule,
  uninstallEnterpriseModule,
} from "Common/Tests/Server/Enterprise/FakeEnterpriseModule";
import { setTestBillingEnabled } from "Common/Tests/Server/Enterprise/TestBillingFlag";
import DatabaseService from "Common/Server/Services/DatabaseService";
import AuditLog from "Common/Models/AnalyticsModels/AuditLog";
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dashboard from "Common/Models/DatabaseModels/Dashboard";
import MessageQueue from "Common/Models/DatabaseModels/MessageQueue";
import MessageQueueOwnerUser from "Common/Models/DatabaseModels/MessageQueueOwnerUser";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import Probe from "Common/Models/DatabaseModels/Probe";
import Project from "Common/Models/DatabaseModels/Project";
import RunbookExecution from "Common/Models/DatabaseModels/RunbookExecution";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import TelemetryIngestionKey from "Common/Models/DatabaseModels/TelemetryIngestionKey";
import ToolImportRecord from "Common/Models/DatabaseModels/ToolImportRecord";
import User from "Common/Models/DatabaseModels/User";
import Workflow from "Common/Models/DatabaseModels/Workflow";
import AuditLogAction from "Common/Types/AuditLog/AuditLogAction";
import { AUDIT_LOG_REDACTED_VALUE } from "Common/Types/AuditLog/AuditLogRedaction";
import DatabaseCommonInteractionProps from "Common/Types/BaseDatabase/DatabaseCommonInteractionProps";
import Email from "Common/Types/Email";
import { JSONObject } from "Common/Types/JSON";
import Name from "Common/Types/Name";
import ObjectID from "Common/Types/ObjectID";
import UserType from "Common/Types/UserType";
import ComponentID from "Common/Types/Workflow/ComponentID";
import { AUDIT_LOG_JSON_LIMIT } from "Common/Utils/AuditLog/AuditLogValues";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHAT AN ENTRY SAYS ABOUT EACH VALUE (issue #6187).
 *
 * Every project-scoped model is audited now, so entries hold every kind of
 * value: a workflow's whole canvas, a dashboard's layout, a monitor's
 * request headers, descriptions as long as a pasted log. Pinned here against
 * the entry that reaches the insert:
 *
 *   - a workflow's graph is the lines of what changed, and a save that only
 *     moved or selected a card adds no entry at all;
 *   - JSON is recorded without its secrets, with the paths that changed, and
 *     by its size once it is large;
 *   - long text keeps the part around where it changed;
 *   - the defaults' secrets are redacted, and what only OneUptime writes
 *     adds no entry;
 *   - a child's entries roll up to its resource, named after its person;
 *   - a name nobody may read does not name the entry;
 *   - the change that turns audit logging on or off is always recorded.
 *
 * Billing and the edition are pinned as in AuditLogRecorder.test.ts; nothing
 * here touches ClickHouse or Postgres.
 */

const findProjectMock: jest.Mock = jest.fn();
const findUserMock: jest.Mock = jest.fn();

jest.mock("Common/Server/Services/ProjectService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findProjectMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/Services/UserService", () => {
  return {
    __esModule: true,
    default: {
      findOneById: (...args: Array<unknown>): unknown => {
        return findUserMock(...args);
      },
    },
  };
});

jest.mock("Common/Server/EnvironmentConfig", () => {
  const billingFlag: typeof import("Common/Tests/Server/Enterprise/TestBillingFlag") =
    jest.requireActual(
      "Common/Tests/Server/Enterprise/TestBillingFlag",
    ) as typeof import("Common/Tests/Server/Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("Common/Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OWNER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const RECORD_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const QUEUE_ID: ObjectID = new ObjectID("55555555-5555-4555-8555-555555555555");

const USER_PROPS: DatabaseCommonInteractionProps = {
  userId: USER_ID,
  userType: UserType.User,
  tenantId: PROJECT_ID,
};

let project: Project;
let inserted: Array<AuditLog>;
let recorder: AuditLogRecorder;

function makeProject(enableAuditLogs: boolean): Project {
  const item: Project = new Project();
  item._id = PROJECT_ID.toString();
  item.enableAuditLogs = enableAuditLogs;
  item.auditLogsRetentionInDays = 30;
  item.storeSystemEventsInAuditLogs = false;
  return item;
}

function makeUser(id: ObjectID, name: string, email: string): User {
  const user: User = new User();
  user._id = id.toString();
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

function onlyEntry(): AuditLog {
  expect(inserted).toHaveLength(1);
  return inserted[0]!;
}

function changeFor(entry: AuditLog, field: string): JSONObject | undefined {
  return ((entry.changes || []) as Array<JSONObject>).find(
    (change: JSONObject): boolean => {
      return change["field"] === field;
    },
  );
}

function fieldsOf(entry: AuditLog): Array<string> {
  return ((entry.changes || []) as Array<JSONObject>).map(
    (change: JSONObject): string => {
      return String(change["field"]);
    },
  );
}

async function recordUpdate<TModel extends BaseModel>(data: {
  model: TModel;
  before: TModel;
  updatedFields: JSONObject;
  props?: DatabaseCommonInteractionProps;
}): Promise<void> {
  await recorder.recordUpdate({
    model: data.model,
    before: data.before,
    updatedFields: data.updatedFields,
    itemId: RECORD_ID,
    props: data.props || USER_PROPS,
  });
}

function canvasStep(data: {
  key: string;
  stepId: string;
  componentId: string;
  args?: JSONObject;
  x?: number;
  selected?: boolean;
}): JSONObject {
  return {
    id: data.key,
    type: "node",
    position: { x: data.x ?? 100, y: 100 },
    width: 256,
    height: 120,
    selected: Boolean(data.selected),
    data: {
      id: data.stepId,
      metadataId: data.componentId,
      nodeType: "Node",
      componentType: "Component",
      internalId: `i-${data.key}`,
      error: "",
      arguments: data.args || {},
      returnValues: {},
    },
  };
}

const MANUAL: JSONObject = canvasStep({
  key: "a",
  stepId: "manual-1",
  componentId: ComponentID.Manual,
});

const POST: JSONObject = canvasStep({
  key: "b",
  stepId: "api-post-1",
  componentId: ComponentID.ApiPost,
  args: { "request-headers": '{"Authorization":"Bearer sk-live-OLD"}' },
});

function workflowWith(graph: JSONObject): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = RECORD_ID.toString();
  workflow.projectId = PROJECT_ID;
  workflow.name = "Page the database team";
  workflow.graph = graph;
  return workflow;
}

beforeEach(() => {
  setTestBillingEnabled(false);
  project = makeProject(true);
  inserted = [];

  const insert: jest.Mock = jest.fn(((createBy: { data: AuditLog }) => {
    inserted.push(createBy.data);
    return Promise.resolve(createBy.data);
  }) as never);

  recorder = new AuditLogRecorder({
    store: { create: insert } as unknown as AuditLogStore,
  });

  findProjectMock.mockReset();
  findProjectMock.mockImplementation(() => {
    return Promise.resolve(project);
  });

  const users: Map<string, User> = new Map<string, User>([
    [USER_ID.toString(), makeUser(USER_ID, "Ada Lovelace", "ada@example.com")],
    [
      OWNER_ID.toString(),
      makeUser(OWNER_ID, "Grace Hopper", "grace@example.com"),
    ],
  ]);

  findUserMock.mockReset();
  findUserMock.mockImplementation(((findOneById: { id: ObjectID }) => {
    return Promise.resolve(users.get(findOneById.id.toString()) || null);
  }) as never);

  installFakeEnterpriseModule({ auditLogRecorder: recorder });
});

afterEach(() => {
  uninstallEnterpriseModule();
  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a workflow saved in the builder", () => {
  test("is recorded as what changed, with the graph before and after in a few words", async () => {
    await recordUpdate({
      model: new Workflow(),
      before: workflowWith({ nodes: [MANUAL], edges: [] }),
      updatedFields: {
        graph: {
          nodes: [MANUAL, POST],
          edges: [
            {
              id: "e",
              source: "a",
              target: "b",
              sourceHandle: "success",
              targetHandle: "in",
            },
          ],
        },
      },
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.action).toBe(AuditLogAction.Update);
    expect(entry.resourceType).toBe("Workflow");
    expect(entry.resourceName).toBe("Page the database team");
    expect(changeFor(entry, "graph")).toEqual({
      field: "graph",
      oldValue: "1 step and no connections",
      newValue: "2 steps and 1 connection",
      summary: [
        'Added "API Post (JSON)" (api-post-1)',
        'Connected "Manual" (manual-1) to "API Post (JSON)" (api-post-1)',
      ],
    });
    // Neither the canvas nor what was typed into a step is copied.
    expect(JSON.stringify(entry.changes)).not.toContain("sk-live");
    expect(JSON.stringify(entry.changes)).not.toContain("position");
  });

  test("a save that only moved or selected a card adds no entry", async () => {
    await recordUpdate({
      model: new Workflow(),
      before: workflowWith({ nodes: [MANUAL, POST], edges: [] }),
      updatedFields: {
        graph: {
          nodes: [
            { ...MANUAL, position: { x: 900, y: 40 }, selected: true },
            POST,
          ],
          edges: [],
        },
      },
    });

    expect(inserted).toHaveLength(0);
  });

  test("a save that moved a card and renamed the workflow records the rename alone", async () => {
    await recordUpdate({
      model: new Workflow(),
      before: workflowWith({ nodes: [MANUAL], edges: [] }),
      updatedFields: {
        name: "Page the on-call database team",
        graph: { nodes: [{ ...MANUAL, position: { x: 1, y: 2 } }], edges: [] },
      },
    });

    expect(fieldsOf(onlyEntry())).toEqual(["name"]);
  });

  test("a setting changed in a step is named, and its secret value never recorded", async () => {
    await recordUpdate({
      model: new Workflow(),
      before: workflowWith({ nodes: [POST], edges: [] }),
      updatedFields: {
        graph: {
          nodes: [
            canvasStep({
              key: "b",
              stepId: "api-post-1",
              componentId: ComponentID.ApiPost,
              args: {
                "request-headers": '{"Authorization":"Bearer sk-live-NEW"}',
              },
            }),
          ],
          edges: [],
        },
      },
    });

    expect(changeFor(onlyEntry(), "graph")?.["summary"]).toEqual([
      'Changed "Request Headers" in "API Post (JSON)" (api-post-1)',
    ]);
    expect(JSON.stringify(onlyEntry().changes)).not.toContain("sk-live");
  });

  test("a workflow created is its steps, listed, and its keys are redacted", async () => {
    const workflow: Workflow = workflowWith({
      nodes: [MANUAL, POST],
      edges: [],
    });
    workflow.webhookSecretKey = "whsec-should-not-be-recorded";
    workflow.incomingEmailSecretKey = new ObjectID(
      "66666666-6666-4666-8666-666666666666",
    );

    await recorder.recordCreate({
      model: new Workflow(),
      createdItem: workflow,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(changeFor(entry, "graph")).toEqual({
      field: "graph",
      newValue: "2 steps and no connections",
      summary: ['"API Post (JSON)" (api-post-1)', '"Manual" (manual-1)'],
    });
    expect(changeFor(entry, "webhookSecretKey")?.["newValue"]).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(changeFor(entry, "incomingEmailSecretKey")?.["newValue"]).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(JSON.stringify(entry.changes)).not.toContain("whsec");
    expect(JSON.stringify(entry.changes)).not.toContain("66666666");
  });
});

describe("JSON in an entry", () => {
  test("a secret under a secret-looking key is redacted, and the path that changed is named", async () => {
    const before: Monitor = new Monitor();
    before._id = RECORD_ID.toString();
    before.projectId = PROJECT_ID;
    before.name = "Checkout API";
    (before as unknown as JSONObject)["monitorSteps"] = {
      steps: [
        {
          requestHeaders: { Authorization: "Bearer OLD-TOKEN", Accept: "json" },
        },
      ],
    };

    await recordUpdate({
      model: new Monitor(),
      before,
      updatedFields: {
        monitorSteps: {
          steps: [
            {
              requestHeaders: {
                Authorization: "Bearer NEW-TOKEN",
                Accept: "json",
              },
            },
          ],
        },
      },
    });

    const change: JSONObject | undefined = changeFor(
      onlyEntry(),
      "monitorSteps",
    );

    expect(change).toEqual({
      field: "monitorSteps",
      oldValue: {
        steps: [
          {
            requestHeaders: {
              Authorization: AUDIT_LOG_REDACTED_VALUE,
              Accept: "json",
            },
          },
        ],
      },
      newValue: {
        steps: [
          {
            requestHeaders: {
              Authorization: AUDIT_LOG_REDACTED_VALUE,
              Accept: "json",
            },
          },
        ],
      },
      summary: ["Changed steps › 1 › requestHeaders › Authorization"],
    });
    expect(JSON.stringify(change)).not.toContain("TOKEN");
  });

  test("large JSON is recorded by its size, with the paths that changed", async () => {
    const widgets: (title: string) => Array<JSONObject> = (
      title: string,
    ): Array<JSONObject> => {
      const list: Array<JSONObject> = [];

      for (let index: number = 0; index < 80; index++) {
        list.push({
          id: `widget-${index}`,
          title: index === 7 ? title : `Widget ${index}`,
          query: "x".repeat(200),
        });
      }

      return list;
    };

    const before: Dashboard = new Dashboard();
    before._id = RECORD_ID.toString();
    before.projectId = PROJECT_ID;
    before.name = "Checkout";
    (before as unknown as JSONObject)["dashboardViewConfig"] = {
      components: widgets("Latency"),
    };

    const after: JSONObject = { components: widgets("p99 latency") };

    expect(JSON.stringify(after).length).toBeGreaterThan(AUDIT_LOG_JSON_LIMIT);

    await recordUpdate({
      model: new Dashboard(),
      before,
      updatedFields: { dashboardViewConfig: after },
    });

    const change: JSONObject | undefined = changeFor(
      onlyEntry(),
      "dashboardViewConfig",
    );

    expect(String(change?.["oldValue"])).toMatch(/^\[\d+\.\d KB of JSON\]$/);
    expect(String(change?.["newValue"])).toMatch(/^\[\d+\.\d KB of JSON\]$/);
    expect(change?.["summary"]).toEqual([
      "Changed components › widget-7 › title",
    ]);
  });

  test("a created record's JSON is redacted too", async () => {
    const key: TelemetryIngestionKey = new TelemetryIngestionKey();
    key._id = RECORD_ID.toString();
    key.projectId = PROJECT_ID;
    key.name = "Browser";
    key.secretKey = new ObjectID("77777777-7777-4777-8777-777777777777");
    (key as unknown as JSONObject)["allowedOrigins"] = [
      "https://app.example.com",
    ];

    await recorder.recordCreate({
      model: new TelemetryIngestionKey(),
      createdItem: key,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(changeFor(entry, "secretKey")?.["newValue"]).toBe(
      AUDIT_LOG_REDACTED_VALUE,
    );
    expect(changeFor(entry, "allowedOrigins")?.["newValue"]).toEqual([
      "https://app.example.com",
    ]);
    expect(JSON.stringify(entry.changes)).not.toContain("77777777");
  });
});

describe("long text in an entry", () => {
  test("keeps the part around where it changed", async () => {
    const start: string = "Runbook step. ".repeat(4000);

    const before: Workflow = workflowWith({ nodes: [], edges: [] });
    before.description = `${start}Call the DBA.`;

    await recordUpdate({
      model: new Workflow(),
      before,
      updatedFields: { description: `${start}Page the DBA.` },
    });

    const change: JSONObject | undefined = changeFor(
      onlyEntry(),
      "description",
    );

    expect(String(change?.["oldValue"])).toContain("Call the DBA.");
    expect(String(change?.["newValue"])).toContain("Page the DBA.");
    expect(String(change?.["newValue"]).startsWith("[… ")).toBe(true);
    expect(String(change?.["newValue"]).length).toBeLessThan(11000);
  });
});

describe("the defaults of a model that declares nothing", () => {
  test("a probe's key is recorded as changed, never with its value", async () => {
    const before: Probe = new Probe();
    before._id = RECORD_ID.toString();
    before.projectId = PROJECT_ID;
    before.name = "Frankfurt";
    before.key = "old-probe-key";

    await recordUpdate({
      model: new Probe(),
      before,
      updatedFields: { key: "new-probe-key" },
    });

    expect(changeFor(onlyEntry(), "key")).toEqual({
      field: "key",
      oldValue: AUDIT_LOG_REDACTED_VALUE,
      newValue: AUDIT_LOG_REDACTED_VALUE,
    });
  });

  test("a probe's heartbeat adds no entry: only OneUptime's bookkeeping changed", async () => {
    const before: Probe = new Probe();
    before._id = RECORD_ID.toString();
    before.projectId = PROJECT_ID;
    before.name = "Frankfurt";

    await recordUpdate({
      model: new Probe(),
      before,
      updatedFields: { lastAlive: new Date(), probeVersion: "1.2.3" },
      props: { ...USER_PROPS },
    });

    expect(inserted).toHaveLength(0);
  });

  test("telemetry seeing a queue again adds no entry; a person renaming it does", async () => {
    const before: MessageQueue = new MessageQueue();
    before._id = QUEUE_ID.toString();
    before.projectId = PROJECT_ID;
    before.name = "orders";

    await recordUpdate({
      model: new MessageQueue(),
      before,
      updatedFields: { lastSeenAt: new Date(), brokerAddress: "kafka:9092" },
    });

    expect(inserted).toHaveLength(0);

    await recordUpdate({
      model: new MessageQueue(),
      before,
      updatedFields: { name: "orders-v2" },
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceType).toBe("Queue");
    expect(entry.rootResourceType).toBe("Queue");
    expect(entry.rootResourceId?.toString()).toBe(RECORD_ID.toString());
    expect(changeFor(entry, "name")).toEqual({
      field: "name",
      oldValue: "orders",
      newValue: "orders-v2",
    });
  });

  test("a queue's owner rolls up to the queue, named after its person", async () => {
    const owner: MessageQueueOwnerUser = new MessageQueueOwnerUser();
    owner._id = RECORD_ID.toString();
    owner.projectId = PROJECT_ID;
    owner.messageQueueId = QUEUE_ID;
    owner.userId = OWNER_ID;

    await recorder.recordCreate({
      model: new MessageQueueOwnerUser(),
      createdItem: owner,
      props: USER_PROPS,
    });

    const entry: AuditLog = onlyEntry();

    expect(entry.resourceType).toBe("Queue User Owner");
    expect(entry.resourceName).toBe("Grace Hopper");
    expect(entry.rootResourceType).toBe("Queue");
    expect(entry.rootResourceId?.toString()).toBe(QUEUE_ID.toString());
  });
});

describe("what names an entry", () => {
  test("a name nobody may read does not name the entry", async () => {
    const record: ToolImportRecord = new ToolImportRecord();
    record._id = RECORD_ID.toString();
    record.projectId = PROJECT_ID;
    record.name = "Imported from a tool nobody may read the name of";

    await recorder.recordCreate({
      model: new ToolImportRecord(),
      createdItem: record,
      props: USER_PROPS,
    });

    expect(onlyEntry().resourceName).toBeUndefined();
    expect(JSON.stringify(onlyEntry().changes)).not.toContain(
      "nobody may read",
    );
  });
});

describe("the change that turns audit logging on or off", () => {
  function projectBefore(enableAuditLogs: boolean): Project {
    const before: Project = makeProject(enableAuditLogs);
    before.name = "Acme";
    return before;
  }

  test("turning it off is recorded, even when the settings already read off", async () => {
    project = makeProject(false);

    await recordUpdate({
      model: new Project(),
      before: projectBefore(true),
      updatedFields: { enableAuditLogs: false },
    });

    expect(changeFor(onlyEntry(), "enableAuditLogs")).toEqual({
      field: "enableAuditLogs",
      oldValue: true,
      newValue: false,
    });
  });

  test("turning it on is recorded, even when the settings still read off", async () => {
    project = makeProject(false);

    await recordUpdate({
      model: new Project(),
      before: projectBefore(false),
      updatedFields: { enableAuditLogs: true },
    });

    expect(fieldsOf(onlyEntry())).toEqual(["enableAuditLogs"]);
  });

  test("any other change to the project while it is off is not", async () => {
    project = makeProject(false);

    await recordUpdate({
      model: new Project(),
      before: projectBefore(false),
      updatedFields: { name: "Acme Inc" },
    });

    expect(inserted).toHaveLength(0);
  });

  test("the plan still decides: on OneUptime Cloud below Enterprise, nothing is", async () => {
    setTestBillingEnabled(true);
    project = makeProject(true);

    await recordUpdate({
      model: new Project(),
      before: projectBefore(true),
      updatedFields: { enableAuditLogs: false },
    });

    expect(inserted).toHaveLength(0);
  });
});

/*
 * What names the entry of a row with no name of its own (issue #6287):
 * every exception's entry in the project-wide audit log read "Unnamed".
 */
describe("a row named by other columns than a name", () => {
  function exception(data: {
    type?: string;
    message?: string;
  }): TelemetryException {
    const item: TelemetryException = new TelemetryException(RECORD_ID);
    item.projectId = PROJECT_ID;

    if (data.type !== undefined) {
      item.exceptionType = data.type;
    }

    if (data.message !== undefined) {
      item.message = data.message;
    }

    return item;
  }

  async function resolve(before: TelemetryException): Promise<void> {
    await recorder.recordUpdate({
      model: new TelemetryException(),
      before,
      updatedFields: { isResolved: true },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });
  }

  test("an exception is named by its type and the start of its message", async () => {
    await resolve(
      exception({
        type: "TypeError",
        message:
          "Cannot read properties of undefined (reading 'map')\n    at render (app.js:1:1)",
      }),
    );

    expect(onlyEntry().resourceName).toBe(
      "TypeError: Cannot read properties of undefined (reading 'map')",
    );
  });

  test("never with an id, an address or anything that looks like a secret", async () => {
    await resolve(
      exception({
        type: "AuthError",
        message:
          "order 550e8400-e29b-41d4-a716-446655440000 by ada@example.com from 203.0.113.7 sent Bearer abcdefghijklmnop1234567890",
      }),
    );

    const name: string = onlyEntry().resourceName!;

    expect(name.startsWith("AuthError: order ")).toBe(true);
    expect(name).not.toContain("550e8400-e29b-41d4-a716-446655440000");
    expect(name).not.toContain("ada@example.com");
    expect(name).not.toContain("203.0.113.7");
    expect(name).not.toContain("abcdefghijklmnop1234567890");
  });

  test("a row handed over with only its id is named from the row, read in its project", async () => {
    const findOneBy: jest.SpyInstance = jest
      .spyOn(DatabaseService.prototype, "findOneBy")
      .mockImplementation((async () => {
        return exception({
          type: "TimeoutError",
          message: "upstream timed out",
        });
      }) as never);

    await resolve(exception({}));

    expect(onlyEntry().resourceName).toBe("TimeoutError: upstream timed out");

    const query: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(String(query["projectId"])).toBe(PROJECT_ID.toString());
    expect(String(query["_id"])).toBe(RECORD_ID.toString());
  });

  test("a read that fails records the entry without a name", async () => {
    jest
      .spyOn(DatabaseService.prototype, "findOneBy")
      .mockRejectedValue(new Error("database down"));

    await resolve(exception({}));

    expect(onlyEntry().resourceName).toBeUndefined();
  });

  test("a runbook run is named by its runbook", async () => {
    const run: RunbookExecution = new RunbookExecution(RECORD_ID);
    run.projectId = PROJECT_ID;
    run.runbookNameSnapshot = "Restart the API";

    await recorder.recordUpdate({
      model: new RunbookExecution(),
      before: run,
      updatedFields: { completedAt: new Date("2026-11-08T10:00:00.000Z") },
      itemId: RECORD_ID,
      props: USER_PROPS,
    });

    expect(onlyEntry().resourceName).toBe("Restart the API");
  });
});
