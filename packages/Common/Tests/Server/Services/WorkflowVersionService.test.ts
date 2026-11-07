import WorkflowVersionService, {
  Service as WorkflowVersionServiceClass,
} from "../../../Server/Services/WorkflowVersionService";
import WorkflowVersion from "../../../Models/DatabaseModels/WorkflowVersion";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PositiveNumber from "../../../Types/PositiveNumber";
import {
  WORKFLOW_VERSIONS_KEPT,
  WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS,
  WorkflowVersionType,
} from "../../../Types/Workflow/WorkflowVersion";
import { toSavedWorkflowGraph } from "../../../Utils/Workflow/WorkflowGraphSnapshot";
import {
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
} from "../../Utils/Workflow/WorkflowGraphFixtures";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What each save of a workflow's graph writes to its version history
 * (issue #6188), with the service's reads and writes stood in for, so no
 * database is touched: WorkflowVersionPostgres runs the same against a real
 * one.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-000000006188",
);
const PROJECT_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-0000000000aa",
);
const ALICE: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-0000000a11ce");
const BOB: ObjectID = new ObjectID("0198c8ec-2a1d-7f0c-9e75-000000000b0b");

const NOW: Date = new Date("2026-11-07T12:00:00.000Z");

const GRAPH_1: JSONObject = graphOf([MANUAL, LOG]) as unknown as JSONObject;
const GRAPH_2: JSONObject = graphOf([MANUAL, LOG, EMAIL]) as unknown as JSONObject;
const GRAPH_3: JSONObject = graphOf([MANUAL]) as unknown as JSONObject;

const fingerprint: (graph: unknown) => string = (graph: unknown): string => {
  return WorkflowVersionServiceClass.getGraphFingerprint(graph);
};

// A version as the database would hand it back.
const stored: (data: {
  number: number;
  type: WorkflowVersionType;
  graph: JSONObject;
  savedBy?: ObjectID | undefined;
  createdAt?: Date | undefined;
}) => WorkflowVersion = (data: {
  number: number;
  type: WorkflowVersionType;
  graph: JSONObject;
  savedBy?: ObjectID | undefined;
  createdAt?: Date | undefined;
}): WorkflowVersion => {
  const version: WorkflowVersion = new WorkflowVersion();
  version._id = `0198c8ec-2a1d-7f0c-9e75-00000000${String(data.number).padStart(4, "0")}`;
  version.id = new ObjectID(version._id);
  version.workflowId = WORKFLOW_ID;
  version.projectId = PROJECT_ID;
  version.versionNumber = data.number;
  version.versionType = data.type;
  version.graph = toSavedWorkflowGraph(data.graph) as unknown as JSONObject;
  version.graphFingerprint = fingerprint(data.graph);
  version.createdAt = data.createdAt || new Date(NOW.getTime() - 60 * 1000);
  if (data.savedBy) {
    version.createdByUserId = data.savedBy;
  }
  return version;
};

// The version history the stand-in reads from, newest last.
let history: Array<WorkflowVersion> = [];

let created: Array<WorkflowVersion> = [];
let updated: Array<{ id: ObjectID; data: JSONObject }> = [];
let deleted: Array<JSONObject> = [];
let createFailures: number = 0;

const newestFirst: () => Array<WorkflowVersion> = (): Array<WorkflowVersion> => {
  return [...history].sort((a: WorkflowVersion, b: WorkflowVersion) => {
    return (b.versionNumber || 0) - (a.versionNumber || 0);
  });
};

beforeEach(() => {
  history = [];
  created = [];
  updated = [];
  deleted = [];
  createFailures = 0;

  jest
    .spyOn(WorkflowVersionService, "findOneBy")
    .mockImplementation((async (request: {
      query: JSONObject;
    }): Promise<WorkflowVersion | null> => {
      const query: JSONObject = request.query;
      let candidates: Array<WorkflowVersion> = newestFirst();

      if (query["graphFingerprint"]) {
        candidates = candidates.filter((version: WorkflowVersion): boolean => {
          return version.graphFingerprint === query["graphFingerprint"];
        });
      }

      if (query["versionNumber"]) {
        // QueryHelper.lessThan: below the newest asked about.
        const newest: number = newestFirst()[0]?.versionNumber || 0;
        candidates = candidates.filter((version: WorkflowVersion): boolean => {
          return (version.versionNumber || 0) < newest;
        });
      }

      return candidates[0] || null;
    }) as never);

  jest
    .spyOn(WorkflowVersionService, "findOneById")
    .mockImplementation((async (request: {
      id: ObjectID;
    }): Promise<WorkflowVersion | null> => {
      return (
        history.find((version: WorkflowVersion): boolean => {
          return version.id?.toString() === request.id.toString();
        }) || null
      );
    }) as never);

  jest
    .spyOn(WorkflowVersionService, "countBy")
    .mockImplementation((async (): Promise<PositiveNumber> => {
      return new PositiveNumber(history.length);
    }) as never);

  jest
    .spyOn(WorkflowVersionService, "create")
    .mockImplementation((async (request: {
      data: WorkflowVersion;
      props: JSONObject;
    }): Promise<WorkflowVersion> => {
      expect(request.props).toEqual({ isRoot: true });

      if (createFailures > 0) {
        createFailures--;
        // Another save claimed the number first.
        history.push(
          stored({
            number: request.data.versionNumber || 0,
            type: WorkflowVersionType.Changed,
            graph: GRAPH_3,
            savedBy: BOB,
          }),
        );
        throw new Error("duplicate key value violates unique constraint");
      }

      created.push(request.data);
      history.push(request.data);
      return request.data;
    }) as never);

  jest
    .spyOn(WorkflowVersionService, "updateOneById")
    .mockImplementation((async (request: {
      id: ObjectID;
      data: JSONObject;
      props: JSONObject;
    }): Promise<void> => {
      expect(request.props).toEqual({ isRoot: true });
      updated.push({ id: request.id, data: request.data });
    }) as never);

  jest
    .spyOn(WorkflowVersionService, "deleteBy")
    .mockImplementation((async (request: {
      query: JSONObject;
      props: JSONObject;
    }): Promise<number> => {
      expect(request.props).toEqual({ isRoot: true });
      deleted.push(request.query);
      return 0;
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

// A save of `graph` by `userId`; null is a save by nobody (an API key).
const save: (
  graph: JSONObject,
  userId?: ObjectID | null,
  now?: Date,
) => Promise<void> = async (
  graph: JSONObject,
  userId: ObjectID | null = ALICE,
  now: Date = NOW,
): Promise<void> => {
  await WorkflowVersionService.recordGraphSave({
    workflowId: WORKFLOW_ID,
    projectId: PROJECT_ID,
    graph,
    userId: userId || undefined,
    now,
  });
};

describe("a graph's fingerprint", () => {
  test("is SHA-256, the same for the same workflow however it is ordered, selected or styled", () => {
    const selected: JSONObject = graphOf([
      { ...LOG, withCanvasState: true, selected: true },
      { ...MANUAL, withCanvasState: true },
    ]) as unknown as JSONObject;

    expect(fingerprint(GRAPH_1)).toMatch(/^[0-9a-f]{64}$/);
    expect(fingerprint(selected)).toBe(fingerprint(GRAPH_1));
    expect(fingerprint(JSON.stringify(GRAPH_1))).toBe(fingerprint(GRAPH_1));
  });

  test("differs for a different workflow, and for a card that moved", () => {
    expect(fingerprint(GRAPH_2)).not.toBe(fingerprint(GRAPH_1));
    expect(
      fingerprint(graphOf([MANUAL, { ...LOG, x: 640 }])),
    ).not.toBe(fingerprint(GRAPH_1));
  });
});

describe("a workflow created", () => {
  test("is version 1, by whoever created it, listing what it was created with", async () => {
    await WorkflowVersionService.recordCreated({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      graph: graphOf([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
      userId: ALICE,
    });

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      versionNumber: 1,
      versionType: WorkflowVersionType.Created,
      changes: [
        'Added "Log" (log-1)',
        'Added "Manual" (manual-1)',
        'Connected "Manual" (manual-1) to "Log" (log-1)',
      ],
      changeCount: 3,
    });
    expect(created[0]?.createdByUserId?.toString()).toBe(ALICE.toString());
    expect(created[0]?.workflowId?.toString()).toBe(WORKFLOW_ID.toString());
    expect(created[0]?.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(created[0]?.graphFingerprint).toBe(
      fingerprint(graphOf([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }])),
    );
    expect(created[0]?.restoredFromVersionNumber).toBeUndefined();
  });

  test("from scratch, with no graph at all, is version 1 of an empty workflow", async () => {
    await WorkflowVersionService.recordCreated({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      graph: undefined,
      userId: undefined,
    });

    expect(created[0]).toMatchObject({
      versionNumber: 1,
      versionType: WorkflowVersionType.Created,
      graph: { nodes: [], edges: [] },
      changes: [],
      changeCount: 0,
    });
    expect(created[0]?.createdByUserId).toBeUndefined();
  });

  test("keeps the graph as saved: nothing of the canvas's", async () => {
    await WorkflowVersionService.recordCreated({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      graph: graphOf([{ ...MANUAL, withCanvasState: true, selected: true }]),
      userId: ALICE,
    });

    const text: string = JSON.stringify(created[0]?.graph);

    expect(text).not.toContain('"selected"');
    expect(text).not.toContain('"metadata"');
    expect(text).not.toContain('"width"');
  });
});

describe("a version that changed nothing a line says", () => {
  /*
   * Regression: the workflow before version history began, and one created
   * empty, have 0 changes - and the create's required check read 0 as no
   * value, refusing the version ("changeCount is required"). Found against a
   * real database (WorkflowVersionPostgres); the stand-ins above never run
   * the check.
   */
  test("passes the create's required check with 0 changes", () => {
    const version: WorkflowVersion = new WorkflowVersion();
    version.projectId = PROJECT_ID;
    version.workflowId = WORKFLOW_ID;
    version.versionNumber = 1;
    version.versionType = WorkflowVersionType.Earlier;
    version.graph = { nodes: [], edges: [] };
    version.graphFingerprint = fingerprint({ nodes: [], edges: [] });
    version.changes = [];
    version.changeCount = 0;

    const checkRequiredFields: (data: WorkflowVersion) => WorkflowVersion = (
      WorkflowVersionService as unknown as {
        checkRequiredFields: (data: WorkflowVersion) => WorkflowVersion;
      }
    ).checkRequiredFields.bind(WorkflowVersionService);

    expect(() => {
      checkRequiredFields(version);
    }).not.toThrow();
    expect(version.isDefaultValueColumn("changeCount")).toBe(true);
  });
});

describe("a workflow saved before version history began", () => {
  test("gets its graph as it is now as version 1, saved by nobody known", async () => {
    const readGraph: MockFunction = getJestMockFunction();
    readGraph.mockImplementation(async () => {
      return GRAPH_1;
    });

    await WorkflowVersionService.recordEarlierVersionIfNone({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      readGraph: readGraph as never,
    });

    expect(readGraph).toHaveBeenCalledTimes(1);
    expect(created[0]).toMatchObject({
      versionNumber: 1,
      versionType: WorkflowVersionType.Earlier,
      changes: [],
      changeCount: 0,
      graphFingerprint: fingerprint(GRAPH_1),
    });
    expect(created[0]?.createdByUserId).toBeUndefined();
  });

  test("a workflow with a version already: nothing is read or written", async () => {
    history = [stored({ number: 4, type: WorkflowVersionType.Changed, graph: GRAPH_1 })];
    const readGraph: MockFunction = getJestMockFunction();
    readGraph.mockImplementation(async () => {
      return GRAPH_1;
    });

    await WorkflowVersionService.recordEarlierVersionIfNone({
      workflowId: WORKFLOW_ID,
      projectId: PROJECT_ID,
      readGraph: readGraph as never,
    });

    expect(readGraph).not.toHaveBeenCalled();
    expect(created).toHaveLength(0);
  });
});

describe("a save of the graph", () => {
  test("the newest version's graph again - a card selected - writes nothing", async () => {
    history = [stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: BOB })];

    await save(
      graphOf([
        { ...MANUAL, withCanvasState: true, selected: true },
        { ...LOG, withCanvasState: true },
      ]) as unknown as JSONObject,
    );

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(0);
    expect(deleted).toHaveLength(0);
  });

  test("someone else's change is a new version, saying what changed since the newest", async () => {
    history = [stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: BOB })];

    await save(GRAPH_2, ALICE);

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      versionNumber: 4,
      versionType: WorkflowVersionType.Changed,
      changes: ['Added "Send Email" (send-email-1)'],
      changeCount: 1,
      graphFingerprint: fingerprint(GRAPH_2),
    });
    expect(created[0]?.createdByUserId?.toString()).toBe(ALICE.toString());
  });

  test("a version of cards moved says so", async () => {
    history = [stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: BOB })];

    await save(graphOf([MANUAL, { ...LOG, x: 512 }]) as unknown as JSONObject);

    expect(created[0]?.changes).toEqual(['Moved "Log" (log-1)']);
  });

  test("the same person again within the window: the newest version takes it in, its changes counted from the version before it", async () => {
    history = [
      stored({ number: 2, type: WorkflowVersionType.Changed, graph: GRAPH_3, savedBy: BOB }),
      stored({
        number: 3,
        type: WorkflowVersionType.Changed,
        graph: GRAPH_1,
        savedBy: ALICE,
        createdAt: new Date(NOW.getTime() - WORKFLOW_VERSION_GROUPING_WINDOW_IN_MS + 1000),
      }),
    ];

    await save(GRAPH_2, ALICE);

    expect(created).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]?.id.toString()).toBe(history[1]?.id?.toString());
    expect(updated[0]?.data).toMatchObject({
      graphFingerprint: fingerprint(GRAPH_2),
      // From version 2 (the trigger alone) to the graph now.
      changes: ['Added "Log" (log-1)', 'Added "Send Email" (send-email-1)'],
      changeCount: 2,
    });
    expect(deleted).toHaveLength(0);
  });

  test("an earlier version's graph is a Restored version naming it, even by the same person within the window", async () => {
    history = [
      stored({ number: 2, type: WorkflowVersionType.Changed, graph: GRAPH_2, savedBy: BOB }),
      stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: ALICE }),
    ];

    await save(GRAPH_2, ALICE);

    expect(updated).toHaveLength(0);
    expect(created[0]).toMatchObject({
      versionNumber: 4,
      versionType: WorkflowVersionType.Restored,
      restoredFromVersionNumber: 2,
      changes: ['Added "Send Email" (send-email-1)'],
    });
  });

  test("a save through the API, by nobody, is always a version of its own", async () => {
    history = [stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1 })];

    await save(GRAPH_2, null);

    expect(created[0]).toMatchObject({ versionNumber: 4 });
    expect(created[0]?.createdByUserId).toBeUndefined();
  });

  test("only the newest versions are kept: the ones below the oldest kept go", async () => {
    history = [stored({ number: 250, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: BOB })];

    await save(GRAPH_2, ALICE);

    expect(created[0]?.versionNumber).toBe(251);
    expect(deleted).toHaveLength(1);
    expect(deleted[0]?.["workflowId"]).toEqual(WORKFLOW_ID);
    // The query asks for versions below 251 - 100 + 1.
    expect(JSON.stringify(deleted[0]?.["versionNumber"])).toContain(
      String(251 - WORKFLOW_VERSIONS_KEPT + 1),
    );
  });

  test("two saves claiming the same number: the one refused is decided again from the other's version", async () => {
    history = [stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: BOB })];
    createFailures = 1;

    await save(GRAPH_2, ALICE);

    // Bob's version 4 got in first; Alice's save is version 5.
    expect(created).toHaveLength(1);
    expect(created[0]?.versionNumber).toBe(5);
  });

  test("a save that cannot be recorded twice over says why, for the caller to log", async () => {
    history = [stored({ number: 3, type: WorkflowVersionType.Changed, graph: GRAPH_1, savedBy: BOB })];
    createFailures = 2;

    await expect(save(GRAPH_2, ALICE)).rejects.toThrow(
      "duplicate key value violates unique constraint",
    );
  });

  test("a workflow with no version at all gets version 1 of the save", async () => {
    await save(GRAPH_2, ALICE);

    expect(created[0]).toMatchObject({
      versionNumber: 1,
      versionType: WorkflowVersionType.Changed,
    });
    expect(deleted).toHaveLength(1);
  });
});
