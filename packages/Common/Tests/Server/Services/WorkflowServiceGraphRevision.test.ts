import WorkflowService, {
  Service as WorkflowServiceClass,
} from "../../../Server/Services/WorkflowService";
import WorkflowVersionService from "../../../Server/Services/WorkflowVersionService";
import logger from "../../../Server/Utils/Logger";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import BadDataException from "../../../Types/Exception/BadDataException";
import ConflictException from "../../../Types/Exception/ConflictException";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  WORKFLOW_GRAPH_REVISION_KEY,
  readWorkflowGraphRevision,
} from "../../../Types/Workflow/WorkflowGraphRevision";
import API from "../../../Utils/API";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A SAVE OF A WORKFLOW'S GRAPH SAYS WHICH GRAPH IT WAS MADE TO (issue #6257).
 *
 * Workflow.graphRevision counts the saves of the graph, in the database's own
 * write. A save sent with the revision it was made to
 * (miscDataProps.graphRevision) is made only while the workflow is still at
 * that revision: refused with 409 Conflict once someone else saved a newer
 * graph, and otherwise held to the row's version, which the UPDATE asks
 * again - so a save landing between the check and the write is refused too.
 * WorkflowService's hooks are called directly, with the database and the
 * workflow service stood in for; WorkflowGraphRevisionPostgres runs them for
 * real.
 */

const WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-000000006257",
);
const OTHER_WORKFLOW_ID: ObjectID = new ObjectID(
  "0198c8ec-2a1d-7f0c-9e75-000000006258",
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

type Hook = (...args: Array<unknown>) => unknown;

const hook: (name: string) => Hook = (name: string): Hook => {
  return (
    (WorkflowService as unknown as Record<string, Hook>)[name] as Hook
  ).bind(WorkflowService);
};

interface AnUpdate {
  query: JSONObject;
  data: JSONObject;
  miscDataProps?: JSONObject | undefined;
  props: JSONObject;
}

const anUpdate: (data: JSONObject, miscDataProps?: JSONObject) => AnUpdate = (
  data: JSONObject,
  miscDataProps?: JSONObject,
): AnUpdate => {
  return {
    query: { _id: WORKFLOW_ID.toString() },
    data,
    miscDataProps,
    props: { userId: USER_ID, tenantId: PROJECT_ID },
  };
};

const row: (data: {
  id?: ObjectID | undefined;
  graphRevision: unknown;
  version?: number | undefined;
}) => Workflow = (data: {
  id?: ObjectID | undefined;
  graphRevision: unknown;
  version?: number | undefined;
}): Workflow => {
  const workflow: Workflow = new Workflow();
  const id: ObjectID = data.id || WORKFLOW_ID;
  workflow._id = id.toString();
  workflow.id = id;
  workflow.projectId = PROJECT_ID;
  (workflow as unknown as Record<string, unknown>)["graphRevision"] =
    data.graphRevision;
  workflow.version = data.version ?? 11;
  return workflow;
};

let heldRows: Array<Workflow> = [];
let storedAfterWrite: Workflow | null = null;
let recordEarlier: jest.SpyInstance;
let recordSave: jest.SpyInstance;
let workflowServiceTold: jest.SpyInstance;

beforeEach(() => {
  heldRows = [];
  storedAfterWrite = null;

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
  jest.spyOn(WorkflowService, "findOneById").mockImplementation((async (
    request: { select: JSONObject },
  ): Promise<unknown> => {
    // The workflow as the save found it once its write reached no row.
    if (request.select["graphRevision"]) {
      return storedAfterWrite;
    }

    return { graph: GRAPH };
  }) as never);
  jest
    .spyOn(WorkflowService, "updateOneById")
    .mockResolvedValue(undefined as never);
  workflowServiceTold = jest
    .spyOn(API, "post")
    .mockResolvedValue({} as never) as unknown as jest.SpyInstance;
  jest.spyOn(logger, "error").mockImplementation((() => {}) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const refusalOf: (run: () => unknown) => Promise<unknown> = async (
  run: () => unknown,
): Promise<unknown> => {
  try {
    await run();
  } catch (error) {
    return error;
  }

  throw new Error("It was not refused.");
};

describe("the revision a save names", () => {
  test("none - nothing sent, or nothing under the key - is a save made over whatever is there", () => {
    expect(WorkflowServiceClass.readBasedOnGraphRevision(undefined)).toBeNull();
    expect(WorkflowServiceClass.readBasedOnGraphRevision({})).toBeNull();
    expect(
      WorkflowServiceClass.readBasedOnGraphRevision({
        [WORKFLOW_GRAPH_REVISION_KEY]: null,
      }),
    ).toBeNull();
    expect(
      WorkflowServiceClass.readBasedOnGraphRevision({ notifySubscribers: true }),
    ).toBeNull();
  });

  test("a whole number, 0 or more - or one written as digits - is the revision", () => {
    for (const [sent, read] of [
      [0, 0],
      [7, 7],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
      ["12", 12],
      [" 3 ", 3],
      ["000", 0],
    ] as Array<[unknown, number]>) {
      expect({
        sent,
        read: WorkflowServiceClass.readBasedOnGraphRevision({
          [WORKFLOW_GRAPH_REVISION_KEY]: sent as never,
        }),
      }).toEqual({ sent, read });
    }
  });

  test("anything else is refused, saying what it should be", async () => {
    for (const sent of [
      -1,
      1.5,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.MAX_SAFE_INTEGER + 1,
      "",
      "   ",
      "abc",
      "1e3",
      "-2",
      "4.0",
      "1234567890123456",
      true,
      {},
      [],
    ]) {
      const refusal: unknown = await refusalOf(() => {
        return WorkflowServiceClass.readBasedOnGraphRevision({
          [WORKFLOW_GRAPH_REVISION_KEY]: sent as never,
        });
      });

      expect({ sent, refusal }).toEqual({
        sent,
        refusal: new BadDataException(
          WorkflowServiceClass.GRAPH_REVISION_NOT_A_NUMBER_PROBLEM,
        ),
      });
    }
  });

  test("property: seeded numbers read back as themselves; seeded text only when it is all digits", () => {
    const random: SeededRandom = seededRandom(6257);

    for (let draw: number = 0; draw < 2000; draw++) {
      const revision: number = random(1_000_000_000);

      expect(readWorkflowGraphRevision(revision)).toBe(revision);
      expect(readWorkflowGraphRevision(String(revision))).toBe(revision);
    }

    for (const text of generatedTexts(3000, 62570, [
      "0",
      "7",
      "9",
      " ",
      "-",
      ".",
      "e",
      "x",
      "٣",
    ])) {
      const trimmed: string = text.trim();
      const isDigits: boolean =
        trimmed.length > 0 && trimmed.length <= 15 && /^[0-9]+$/.test(trimmed);

      expect({ text, read: readWorkflowGraphRevision(text) }).toEqual({
        text,
        read: isDigits ? Number(trimmed) : undefined,
      });
    }
  });
});

describe("before a save is checked against anyone's permissions", () => {
  test("a Graph Revision sent as a column is dropped - OneUptime counts it - and the rest is saved", async () => {
    const updateBy: AnUpdate = anUpdate({ graph: GRAPH, graphRevision: 99 });

    await hook("onBeforeUpdate")(updateBy);

    expect(updateBy.data).toEqual({ graph: GRAPH });
  });

  test("a Graph Revision sent alone is refused, saying how a save names one", async () => {
    const refusal: unknown = await refusalOf(() => {
      return hook("onBeforeUpdate")(anUpdate({ graphRevision: 99 }));
    });

    expect(refusal).toEqual(
      new BadDataException(WorkflowServiceClass.GRAPH_REVISION_WRITTEN_PROBLEM),
    );
  });

  test("the signing secret's own refusals are as before", async () => {
    expect(
      await refusalOf(() => {
        return hook("onBeforeUpdate")(
          anUpdate({ webhookSigningSecret: "  ", graphRevision: 1 }),
        );
      }),
    ).toEqual(
      new BadDataException(WorkflowServiceClass.EMPTY_SIGNING_SECRET_PROBLEM),
    );
    expect(
      await refusalOf(() => {
        return hook("onBeforeUpdate")(
          anUpdate({ isWebhookSigningSecretSet: true, graphRevision: 1 }),
        );
      }),
    ).toEqual(
      new BadDataException(WorkflowServiceClass.SIGNING_SECRET_SAVED_PROBLEM),
    );
  });

  test("a revision named for anything but a save of the graph is refused: it would guard nothing", async () => {
    const refusal: unknown = await refusalOf(() => {
      return hook("onBeforeUpdate")(
        anUpdate({ isEnabled: true }, { [WORKFLOW_GRAPH_REVISION_KEY]: 3 }),
      );
    });

    expect(refusal).toEqual(
      new BadDataException(
        WorkflowServiceClass.GRAPH_REVISION_WITHOUT_GRAPH_PROBLEM,
      ),
    );
  });

  test("a revision that is not one is refused before anything is read", async () => {
    const refusal: unknown = await refusalOf(() => {
      return hook("onBeforeUpdate")(
        anUpdate({ graph: GRAPH }, { [WORKFLOW_GRAPH_REVISION_KEY]: "three" }),
      );
    });

    expect(refusal).toBeInstanceOf(BadDataException);
    expect(WorkflowService.findRowsAndHoldUpdateToThem).not.toHaveBeenCalled();
  });

  test("a graph saved with a revision, or with none, goes on", async () => {
    await expect(
      hook("onBeforeUpdate")(
        anUpdate({ graph: GRAPH }, { [WORKFLOW_GRAPH_REVISION_KEY]: 3 }),
      ),
    ).resolves.toBeDefined();
    await expect(
      hook("onBeforeUpdate")(anUpdate({ graph: GRAPH })),
    ).resolves.toBeDefined();
  });

  test("a workflow is created at revision 0: a Graph Revision sent with it is dropped", async () => {
    const workflow: Workflow = new Workflow();
    workflow.projectId = PROJECT_ID;
    workflow.graph = GRAPH;
    workflow.graphRevision = 12;

    await hook("onBeforeCreate")({ data: workflow, props: {} });

    expect(workflow.graphRevision).toBeUndefined();
  });
});

describe("once the save may be made, before it is written", () => {
  test("a save of the graph that names no revision is made over whatever is there, and counted", async () => {
    heldRows = [row({ graphRevision: 4 })];
    const updateBy: AnUpdate = anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);

    // Not held: the query names no version.
    expect(updateBy.query).toEqual({ _id: WORKFLOW_ID.toString() });
    // Counted by the database in the write itself.
    expect(Object.keys(updateBy.data).sort()).toEqual(["graph", "graphRevision"]);
    expect(
      hook("getRowWriteSql")(updateBy.data) as Record<string, string>,
    ).toEqual({ graphRevision: `"graphRevision" + 1` });
  });

  test("made to the revision the workflow is at: held to the row's version as it was read", async () => {
    heldRows = [row({ graphRevision: 4, version: 23 })];
    const updateBy: AnUpdate = anUpdate(
      { graph: GRAPH },
      { [WORKFLOW_GRAPH_REVISION_KEY]: 4 },
    );

    await hook("onUpdatePermitted")(updateBy);

    expect(updateBy.query).toEqual({
      _id: WORKFLOW_ID.toString(),
      version: 23,
    });
    expect(recordEarlier).toHaveBeenCalledTimes(1);
    expect(
      hook("getRowWriteSql")(updateBy.data) as Record<string, string>,
    ).toEqual({ graphRevision: `"graphRevision" + 1` });
  });

  test("made to an older revision: refused with 409 Conflict, saying which - and nothing is written, not even a first version", async () => {
    heldRows = [row({ graphRevision: 6 })];
    const updateBy: AnUpdate = anUpdate(
      { graph: GRAPH },
      { [WORKFLOW_GRAPH_REVISION_KEY]: 4 },
    );

    const refusal: unknown = await refusalOf(() => {
      return hook("onUpdatePermitted")(updateBy);
    });

    expect(refusal).toBeInstanceOf(ConflictException);
    expect((refusal as ConflictException).code).toBe(409);
    expect((refusal as ConflictException).code).toBe(
      ExceptionCode.ConflictException,
    );
    expect((refusal as ConflictException).message).toBe(
      WorkflowServiceClass.getStaleGraphRevisionProblem({
        basedOnRevision: 4,
        currentRevision: 6,
      }),
    );
    expect((refusal as ConflictException).message).toContain(
      "it was made to revision 4, and the workflow is at revision 6 now",
    );
    expect(recordEarlier).not.toHaveBeenCalled();
    expect(updateBy.query).toEqual({ _id: WORKFLOW_ID.toString() });
    expect(updateBy.data).toEqual({ graph: GRAPH });
  });

  test("made to a revision the workflow never reached is refused the same way", async () => {
    heldRows = [row({ graphRevision: 2 })];

    const refusal: unknown = await refusalOf(() => {
      return hook("onUpdatePermitted")(
        anUpdate({ graph: GRAPH }, { [WORKFLOW_GRAPH_REVISION_KEY]: 3 }),
      );
    });

    expect(refusal).toBeInstanceOf(ConflictException);
  });

  test("a workflow saved before revisions were counted is at revision 0", async () => {
    heldRows = [row({ graphRevision: null })];
    const updateBy: AnUpdate = anUpdate(
      { graph: GRAPH },
      { [WORKFLOW_GRAPH_REVISION_KEY]: 0 },
    );

    await hook("onUpdatePermitted")(updateBy);

    expect(updateBy.query["version"]).toBe(11);
  });

  test("a revision names one workflow: an update of several is refused", async () => {
    heldRows = [
      row({ graphRevision: 1 }),
      row({ id: OTHER_WORKFLOW_ID, graphRevision: 1 }),
    ];

    const refusal: unknown = await refusalOf(() => {
      return hook("onUpdatePermitted")(
        anUpdate({ graph: GRAPH }, { [WORKFLOW_GRAPH_REVISION_KEY]: 1 }),
      );
    });

    expect(refusal).toEqual(
      new BadDataException(
        WorkflowServiceClass.GRAPH_REVISION_ONE_WORKFLOW_PROBLEM,
      ),
    );
  });

  test("an update that writes no workflow holds nothing: it is answered as any update of a missing row", async () => {
    heldRows = [];
    const updateBy: AnUpdate = anUpdate(
      { graph: GRAPH },
      { [WORKFLOW_GRAPH_REVISION_KEY]: 1 },
    );

    await hook("onUpdatePermitted")(updateBy);

    expect(updateBy.query).toEqual({ _id: WORKFLOW_ID.toString() });
    await expect(
      hook("onUpdateSuccess")({ updateBy, carryForward: null }, []),
    ).resolves.toBeDefined();
  });

  test("anything but a save of the graph is not counted: a new name, the workflow turned on", async () => {
    for (const data of [{ name: "Renamed" }, { isEnabled: true }]) {
      const updateBy: AnUpdate = anUpdate(data);

      await hook("onUpdatePermitted")(updateBy);

      expect(updateBy.data).toEqual(data);
      expect(hook("getRowWriteSql")(updateBy.data)).toEqual({});
    }

    expect(WorkflowService.findRowsAndHoldUpdateToThem).not.toHaveBeenCalled();
  });

  test("a graph written without the hooks (OneUptime's own writes) is not counted by them", () => {
    expect(hook("getRowWriteSql")({ graph: GRAPH })).toEqual({});
  });
});

describe("once the save is written", () => {
  const heldSave: (revision: number) => Promise<AnUpdate> = async (
    revision: number,
  ): Promise<AnUpdate> => {
    heldRows = [row({ graphRevision: revision })];
    const updateBy: AnUpdate = anUpdate(
      { graph: GRAPH },
      { [WORKFLOW_GRAPH_REVISION_KEY]: revision },
    );

    await hook("onUpdatePermitted")(updateBy);

    return updateBy;
  };

  test("a held save that landed goes on as any save: its version is recorded, the workflow service told", async () => {
    const updateBy: AnUpdate = await heldSave(4);

    await hook("onUpdateSuccess")({ updateBy, carryForward: null }, [
      WORKFLOW_ID,
    ]);

    expect(recordSave).toHaveBeenCalledTimes(1);
    expect(workflowServiceTold).toHaveBeenCalled();
  });

  test("a held save that reached no row - someone saved a newer graph in between - is refused with 409, and nothing more is done", async () => {
    const updateBy: AnUpdate = await heldSave(4);
    storedAfterWrite = row({ graphRevision: 5 });

    const refusal: unknown = await refusalOf(() => {
      return hook("onUpdateSuccess")({ updateBy, carryForward: null }, []);
    });

    expect(refusal).toEqual(
      new ConflictException(
        WorkflowServiceClass.getStaleGraphRevisionProblem({
          basedOnRevision: 4,
          currentRevision: 5,
        }),
      ),
    );
    expect(recordSave).not.toHaveBeenCalled();
    expect(workflowServiceTold).not.toHaveBeenCalled();
  });

  test("one that reached no row because something else was written in between is refused too, saying to save again", async () => {
    const updateBy: AnUpdate = await heldSave(4);
    // The graph is as it was: the workflow was turned on, say, which moved its version.
    storedAfterWrite = row({ graphRevision: 4 });

    const refusal: unknown = await refusalOf(() => {
      return hook("onUpdateSuccess")({ updateBy, carryForward: null }, []);
    });

    expect(refusal).toEqual(
      new ConflictException(
        WorkflowServiceClass.GRAPH_CHANGED_WHILE_SAVING_PROBLEM,
      ),
    );
  });

  test("one whose workflow was deleted in between is answered as a missing workflow, not a conflict", async () => {
    const updateBy: AnUpdate = await heldSave(4);
    storedAfterWrite = null;

    await expect(
      hook("onUpdateSuccess")({ updateBy, carryForward: null }, []),
    ).resolves.toBeDefined();
  });

  test("is asked about once: the hook running again for the same update finds nothing held", async () => {
    const updateBy: AnUpdate = await heldSave(4);

    await hook("onUpdateSuccess")({ updateBy, carryForward: null }, [
      WORKFLOW_ID,
    ]);
    await expect(
      hook("onUpdateSuccess")({ updateBy, carryForward: null }, []),
    ).resolves.toBeDefined();
  });

  test("a save that named no revision and reached no row is answered as before", async () => {
    heldRows = [row({ graphRevision: 4 })];
    const updateBy: AnUpdate = anUpdate({ graph: GRAPH });

    await hook("onUpdatePermitted")(updateBy);

    await expect(
      hook("onUpdateSuccess")({ updateBy, carryForward: null }, []),
    ).resolves.toBeDefined();
    expect(recordSave).not.toHaveBeenCalled();
  });
});

describe("the refusal", () => {
  test("is a 409, a check doing its job - not an Issue", () => {
    const conflict: ConflictException = new ConflictException("moved on");

    expect(conflict.code).toBe(409);
    expect(conflict.message).toBe("moved on");
  });

  test("tells an API client how to read the workflow again, or save over it", () => {
    const words: string = WorkflowServiceClass.getStaleGraphRevisionProblem({
      basedOnRevision: 1,
      currentRevision: 3,
    });

    expect(words).toContain("Someone else saved this workflow's graph");
    expect(words).toContain("Read the workflow again");
    expect(words).toContain(
      `save without miscDataProps.${WORKFLOW_GRAPH_REVISION_KEY}`,
    );
  });
});
