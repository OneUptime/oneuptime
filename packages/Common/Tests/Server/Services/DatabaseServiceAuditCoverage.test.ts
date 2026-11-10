import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import { FileOwners } from "../../../Server/Utils/File/FileOwnership";
import PublishedImages from "../../../Server/Utils/File/PublishedImages";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import MessageQueue from "../../../Models/DatabaseModels/MessageQueue";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../Models/DatabaseModels/WorkflowLog";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock, SpyInstance } from "jest-mock";

jest.mock("../../../Server/Utils/Logger");

/*
 * SAVING A WORKFLOW IN THE BUILDER IS RECORDED (issue #6187).
 *
 * The builder saves a workflow's graph with an ordinary update of the
 * Workflow row (Pages/Workflow/View/Builder.tsx, ModelAPI.updateById), and
 * DatabaseService hands every audited update to the audit log. Nothing was
 * recorded because Workflow did not opt in to audit logging - and nor did
 * the Queues product or most others. Every project-scoped model is audited
 * by default now (Types/AuditLog/AuditLogCoverage), so the same path that
 * always handled Monitor and Incident handles these.
 *
 * Pinned here through the real create, update and delete paths, with the
 * repository and the audit log's recorder stubbed: what reaches the
 * recorder, with what before-row. What the recorder then writes is pinned
 * in ee/Tests/Server/AuditLog.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const RECORD_ID: string = "eeeeeeee-0000-4000-8000-000000000001";

interface FakeRepository {
  find: Mock<(options: Record<string, unknown>) => Promise<Array<BaseModel>>>;
  save: Mock<(entity: unknown) => Promise<unknown>>;
  update: Mock<() => Promise<{ affected: number }>>;
  delete: Mock<() => Promise<{ affected: number }>>;
  manager: { query: Mock<() => Promise<unknown>> };
}

function useRepository(
  service: DatabaseService<BaseModel>,
  rows: Array<BaseModel>,
): FakeRepository {
  const repository: FakeRepository = {
    find: jest.fn(async (): Promise<Array<BaseModel>> => {
      return rows;
    }),
    save: jest.fn(async (entity: unknown): Promise<unknown> => {
      const saved: BaseModel = entity as BaseModel;

      if (!saved._id) {
        saved._id = RECORD_ID;
      }

      return saved;
    }),
    update: jest.fn(async (): Promise<{ affected: number }> => {
      return { affected: 1 };
    }),
    delete: jest.fn(async (): Promise<{ affected: number }> => {
      return { affected: rows.length };
    }),
    manager: {
      query: jest.fn(async (): Promise<unknown> => {
        return [];
      }),
    },
  };

  getJestSpyOn(service, "getRepository").mockReturnValue(repository as never);
  getJestSpyOn(service, "countBy").mockResolvedValue(
    new PositiveNumber(0) as never,
  );
  getJestSpyOn(service, "checkRequiredFields").mockImplementation(((
    data: unknown,
  ) => {
    return data;
  }) as never);
  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "autoOwnerOnCreate").mockResolvedValue(
    undefined as never,
  );

  return repository;
}

// A person in the dashboard: who the entry will name.
function personProps(): DatabaseCommonInteractionProps {
  return { isRoot: true, tenantId: PROJECT_ID, userId: USER_ID };
}

// The select each read of the repository was made with.
function selectsAsked(repository: FakeRepository): Array<Array<string>> {
  return repository.find.mock.calls.map(
    (call: [Record<string, unknown>]): Array<string> => {
      return Object.keys(
        (call[0]["select"] as Record<string, unknown>) || {},
      ).sort();
    },
  );
}

const GRAPH_BEFORE: JSONObject = {
  nodes: [
    {
      id: "n-1",
      type: "node",
      position: { x: 100, y: 100 },
      data: { id: "manual-1", metadataId: "manual", arguments: {} },
    },
  ],
  edges: [],
};

const GRAPH_AFTER: JSONObject = {
  nodes: [
    ...(GRAPH_BEFORE["nodes"] as Array<JSONObject>),
    {
      id: "n-2",
      type: "node",
      position: { x: 100, y: 320 },
      data: { id: "log-1", metadataId: "log", arguments: { value: "hi" } },
    },
  ],
  edges: [
    {
      id: "e-1",
      source: "n-1",
      target: "n-2",
      sourceHandle: "success",
      targetHandle: "in",
    },
  ],
};

function storedWorkflow(): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = RECORD_ID;
  workflow.projectId = PROJECT_ID;
  workflow.name = "Page the database team";
  workflow.graph = GRAPH_BEFORE;
  return workflow;
}

function storedQueue(): MessageQueue {
  const queue: MessageQueue = new MessageQueue();
  queue._id = RECORD_ID;
  queue.projectId = PROJECT_ID;
  queue.name = "orders";
  queue.description = "Checkout's order events";
  return queue;
}

let recordCreate: SpyInstance;
let recordUpdate: SpyInstance;
let recordDelete: SpyInstance;

beforeEach(() => {
  jest
    .spyOn(PublishedImages, "setImagesVisibility")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(FileService, "getFileOwners")
    .mockResolvedValue(new Map<string, FileOwners>() as never);
  recordCreate = jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never) as unknown as SpyInstance;
  recordUpdate = jest
    .spyOn(AuditLogService, "recordUpdate")
    .mockResolvedValue(undefined as never) as unknown as SpyInstance;
  recordDelete = jest
    .spyOn(AuditLogService, "recordDelete")
    .mockResolvedValue(undefined as never) as unknown as SpyInstance;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a workflow saved in the builder", () => {
  test("its graph update reaches the audit log, with the graph it replaced", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    const repository: FakeRepository = useRepository(service as never, [
      storedWorkflow(),
    ]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { graph: GRAPH_AFTER } as never,
      props: personProps(),
    });

    expect(recordUpdate).toHaveBeenCalledTimes(1);

    const call: {
      model: BaseModel;
      before: Workflow;
      updatedFields: JSONObject;
      itemId: ObjectID;
      props: DatabaseCommonInteractionProps;
    } = recordUpdate.mock.calls[0]![0] as never;

    expect(call.model).toBeInstanceOf(Workflow);
    expect(call.itemId.toString()).toBe(RECORD_ID);
    expect(call.updatedFields["graph"]).toEqual(GRAPH_AFTER);
    expect(call.before.graph).toEqual(GRAPH_BEFORE);
    expect(call.props.userId?.toString()).toBe(USER_ID.toString());

    // The row was read before the write with its graph and what names it.
    expect(selectsAsked(repository)[0]).toEqual(
      expect.arrayContaining(["_id", "graph", "name", "projectId"]),
    );
  });

  test("a save that writes back the graph it holds changes nothing, and reaches nothing", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    useRepository(service as never, [storedWorkflow()]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { graph: JSON.parse(JSON.stringify(GRAPH_BEFORE)) } as never,
      props: personProps(),
    });

    expect(recordUpdate).not.toHaveBeenCalled();
  });

  test("a workflow created and deleted is recorded too", async () => {
    const service: DatabaseService<Workflow> = new DatabaseService<Workflow>(
      Workflow,
    );
    const repository: FakeRepository = useRepository(service as never, [
      storedWorkflow(),
    ]);

    const workflow: Workflow = new Workflow();
    workflow.projectId = PROJECT_ID;
    workflow.name = "Page the database team";
    workflow.graph = GRAPH_BEFORE;

    await service.create({ data: workflow, props: personProps() });

    expect(recordCreate).toHaveBeenCalledTimes(1);
    expect(
      (recordCreate.mock.calls[0]![0] as { createdItem: Workflow }).createdItem
        .graph,
    ).toEqual(GRAPH_BEFORE);

    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: personProps(),
    });

    expect(recordDelete).toHaveBeenCalledTimes(1);
    // The row is read whole before it goes, so its entry can say what it held.
    expect(selectsAsked(repository).pop()).toEqual(
      expect.arrayContaining(["graph", "name", "description", "isEnabled"]),
    );
  });
});

describe("a queue (the Queues product)", () => {
  test("its create, update and delete reach the audit log", async () => {
    const service: DatabaseService<MessageQueue> =
      new DatabaseService<MessageQueue>(MessageQueue);
    useRepository(service as never, [storedQueue()]);

    const queue: MessageQueue = new MessageQueue();
    queue.projectId = PROJECT_ID;
    queue.name = "orders";

    await service.create({ data: queue, props: personProps() });
    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { description: "Every order Checkout places" } as never,
      props: personProps(),
    });
    await service.deleteOneById({
      id: new ObjectID(RECORD_ID),
      props: personProps(),
    });

    expect(recordCreate).toHaveBeenCalledTimes(1);
    expect(recordUpdate).toHaveBeenCalledTimes(1);
    expect(recordDelete).toHaveBeenCalledTimes(1);
    expect(
      (recordUpdate.mock.calls[0]![0] as { updatedFields: JSONObject })
        .updatedFields["description"],
    ).toBe("Every order Checkout places");
  });
});

describe("an exempt model", () => {
  test("a workflow run's log is not recorded: it is already the record of its run", async () => {
    const service: DatabaseService<WorkflowLog> =
      new DatabaseService<WorkflowLog>(WorkflowLog);
    const log: WorkflowLog = new WorkflowLog();
    log._id = RECORD_ID;
    log.projectId = PROJECT_ID;
    useRepository(service as never, [log]);

    await service.updateOneById({
      id: new ObjectID(RECORD_ID),
      data: { logs: "Step 1 ran" } as never,
      props: personProps(),
    });

    expect(recordUpdate).not.toHaveBeenCalled();
  });
});
