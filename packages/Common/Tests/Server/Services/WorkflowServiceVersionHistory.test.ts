import WorkflowService from "../../../Server/Services/WorkflowService";
import WorkflowVersionService from "../../../Server/Services/WorkflowVersionService";
import logger from "../../../Server/Utils/Logger";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import API from "../../../Utils/API";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Every save of a workflow's graph is recorded in its version history
 * (issue #6188), from WorkflowService's own hooks - the builder's saves, Ask
 * AI's, the API's, an import or a copy - and recording it never fails the
 * save. The hooks are called directly, with the database and the workflow
 * service stood in for; WorkflowVersionPostgres runs them for real.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-000000006188",
);
const OTHER_WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-000000006189",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-0000000000aa",
);
const USER_ID: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-0000000a11ce");

const GRAPH: JSONObject = {
  nodes: [
    {
      id: "card-manual",
      position: { x: 96, y: 32 },
      data: {
        id: "manual-1",
        metadataId: "manual",
        componentType: "Trigger",
        nodeType: "Node",
        arguments: {},
      },
    },
  ],
  edges: [],
};

type Hook = (...args: Array<unknown>) => Promise<unknown>;

const hook: (name: string) => Hook = (name: string): Hook => {
  return (
    (WorkflowService as unknown as Record<string, Hook>)[name] as Hook
  ).bind(WorkflowService);
};

let recordCreated: jest.SpyInstance;
let recordEarlier: jest.SpyInstance;
let recordSave: jest.SpyInstance;
let heldRows: Array<Workflow> = [];
let loggedErrors: Array<string> = [];

beforeEach(() => {
  heldRows = [];
  loggedErrors = [];

  recordCreated = jest
    .spyOn(WorkflowVersionService, "recordCreated")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
  recordEarlier = jest
    .spyOn(WorkflowVersionService, "recordEarlierVersionIfNone")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;
  recordSave = jest
    .spyOn(WorkflowVersionService, "recordGraphSave")
    .mockResolvedValue(undefined as never) as unknown as jest.SpyInstance;

  jest
    .spyOn(WorkflowService, "findRowsAndHoldUpdateToThem")
    .mockImplementation((async (): Promise<Array<Workflow>> => {
      return heldRows;
    }) as never);
  jest
    .spyOn(WorkflowService, "findOneById")
    .mockResolvedValue({ graph: GRAPH } as never);
  jest
    .spyOn(WorkflowService, "updateOneById")
    .mockResolvedValue(undefined as never);
  jest.spyOn(API, "post").mockResolvedValue({} as never);
  jest.spyOn(logger, "error").mockImplementation(((message: string): void => {
    loggedErrors.push(String(message));
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const row: (id: ObjectID) => Workflow = (id: ObjectID): Workflow => {
  const workflow: Workflow = new Workflow();
  workflow._id = id.toString();
  workflow.id = id;
  workflow.projectId = PROJECT_ID;
  return workflow;
};

const anUpdate: (data: JSONObject) => {
  query: JSONObject;
  data: JSONObject;
  props: JSONObject;
} = (
  data: JSONObject,
): { query: JSONObject; data: JSONObject; props: JSONObject } => {
  return {
    query: { _id: WORKFLOW_ID.toString() },
    data,
    props: { userId: USER_ID, tenantId: PROJECT_ID },
  };
};

describe("a workflow created", () => {
  test("is recorded as its first version, by whoever created it", async () => {
    const created: Workflow = {
      _id: WORKFLOW_ID.toString(),
      id: WORKFLOW_ID,
      projectId: undefined,
      webhookSecretKey: "already-set",
      graph: GRAPH,
    } as unknown as Workflow;
    created.projectId = PROJECT_ID;

    await hook("onCreateSuccess")(
      {
        createBy: { data: created, props: { userId: USER_ID } },
        carryForward: null,
      },
      created,
    );

    expect(recordCreated).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      graph: GRAPH,
      userId: USER_ID,
    });
  });

  test("a version that cannot be recorded is logged, and the workflow is created anyway", async () => {
    recordCreated.mockRejectedValue(new Error("the database is busy") as never);
    const created: Workflow = {
      _id: WORKFLOW_ID.toString(),
      id: WORKFLOW_ID,
      webhookSecretKey: "already-set",
    } as unknown as Workflow;
    created.projectId = PROJECT_ID;

    await expect(
      hook("onCreateSuccess")(
        { createBy: { data: created, props: {} }, carryForward: null },
        created,
      ),
    ).resolves.toBeDefined();
    expect(loggedErrors.join("\n")).toContain("the database is busy");
  });
});

describe("before a graph is saved", () => {
  test("the rows the update writes are read as every update hook reads them, and each gets its first version if it has none", async () => {
    heldRows = [row(WORKFLOW_ID), row(OTHER_WORKFLOW_ID)];
    const updateBy: { query: JSONObject; data: JSONObject; props: JSONObject } =
      anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);

    expect(WorkflowService.findRowsAndHoldUpdateToThem).toHaveBeenCalledWith(
      updateBy,
      { _id: true, projectId: true },
    );
    expect(recordEarlier).toHaveBeenCalledTimes(2);
    expect(recordEarlier.mock.calls[0]?.[0]).toMatchObject({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
    });

    // It reads the workflow's graph as it is, before the save.
    const readGraph: () => Promise<unknown> = (
      recordEarlier.mock.calls[0]?.[0] as { readGraph: () => Promise<unknown> }
    ).readGraph;

    await expect(readGraph()).resolves.toEqual(GRAPH);
    expect(WorkflowService.findOneById).toHaveBeenCalledWith({
      id: WORKFLOW_ID,
      select: { graph: true },
      props: { isRoot: true },
    });
  });

  test("an update that saves no graph reads nothing for version history", async () => {
    await hook("onUpdatePermitted")(anUpdate({ name: "Renamed" }));

    expect(WorkflowService.findRowsAndHoldUpdateToThem).not.toHaveBeenCalled();
    expect(recordEarlier).not.toHaveBeenCalled();
  });

  test("a first version that cannot be recorded is logged, and the save goes on", async () => {
    heldRows = [row(WORKFLOW_ID)];
    recordEarlier.mockRejectedValue(new Error("no room") as never);

    await expect(
      hook("onUpdatePermitted")(anUpdate({ graph: GRAPH })),
    ).resolves.toBeUndefined();
    expect(loggedErrors.join("\n")).toContain("no room");
  });
});

describe("once a graph is saved", () => {
  test("each workflow it was saved to records the save, by the person who saved it", async () => {
    heldRows = [row(WORKFLOW_ID)];
    const updateBy: { query: JSONObject; data: JSONObject; props: JSONObject } =
      anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);
    await hook("onUpdateSuccess")({ updateBy, carryForward: null }, [
      WORKFLOW_ID,
    ]);

    expect(recordSave).toHaveBeenCalledWith({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      graph: GRAPH,
      userId: USER_ID,
    });
  });

  test("a row the write did not reach - deleted meanwhile - records nothing", async () => {
    heldRows = [row(WORKFLOW_ID), row(OTHER_WORKFLOW_ID)];
    const updateBy: { query: JSONObject; data: JSONObject; props: JSONObject } =
      anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);
    await hook("onUpdateSuccess")({ updateBy, carryForward: null }, [
      OTHER_WORKFLOW_ID,
    ]);

    expect(recordSave).toHaveBeenCalledTimes(1);
    expect(recordSave.mock.calls[0]?.[0]).toMatchObject({
      workflowId: OTHER_WORKFLOW_ID,
    });
  });

  test("is recorded once, even when the hook runs again for the same update", async () => {
    heldRows = [row(WORKFLOW_ID)];
    const updateBy: { query: JSONObject; data: JSONObject; props: JSONObject } =
      anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);
    await hook("onUpdateSuccess")({ updateBy, carryForward: null }, [
      WORKFLOW_ID,
    ]);
    await hook("onUpdateSuccess")({ updateBy, carryForward: null }, [
      WORKFLOW_ID,
    ]);

    expect(recordSave).toHaveBeenCalledTimes(1);
  });

  test("is recorded before the workflow service is told: telling it can fail, the save is made either way", async () => {
    heldRows = [row(WORKFLOW_ID)];
    (API.post as unknown as jest.SpyInstance).mockRejectedValue(
      new Error("the workflow service is down") as never,
    );
    const updateBy: { query: JSONObject; data: JSONObject; props: JSONObject } =
      anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);
    await expect(
      hook("onUpdateSuccess")({ updateBy, carryForward: null }, [WORKFLOW_ID]),
    ).rejects.toThrow("the workflow service is down");

    expect(recordSave).toHaveBeenCalledTimes(1);
  });

  test("a version that cannot be recorded is logged, and the save stands", async () => {
    heldRows = [row(WORKFLOW_ID)];
    recordSave.mockRejectedValue(new Error("deadlock detected") as never);
    const updateBy: { query: JSONObject; data: JSONObject; props: JSONObject } =
      anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);
    await expect(
      hook("onUpdateSuccess")({ updateBy, carryForward: null }, [WORKFLOW_ID]),
    ).resolves.toBeDefined();
    expect(loggedErrors.join("\n")).toContain("deadlock detected");
  });

  test("an update that never noted its rows - nothing saved a graph - records nothing", async () => {
    await hook("onUpdateSuccess")(
      { updateBy: anUpdate({ graph: GRAPH }), carryForward: null },
      [WORKFLOW_ID],
    );

    expect(recordSave).not.toHaveBeenCalled();
  });
});
