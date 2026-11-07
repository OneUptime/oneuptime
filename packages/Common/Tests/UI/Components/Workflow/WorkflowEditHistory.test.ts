import { describe, expect, test } from "@jest/globals";
import {
  WORKFLOW_EDIT_HISTORY_LIMIT,
  WORKFLOW_MOVE_FOLD_WINDOW_IN_MS,
  WorkflowEditCause,
  WorkflowEditHistory,
  WorkflowHistoryDirection,
  WorkflowHistoryStep,
  canRedoWorkflowEdit,
  canUndoWorkflowEdit,
  getShownWorkflowEntry,
  getWorkflowHistoryStep,
  recordWorkflowEdit,
  redoWorkflowEdit,
  startWorkflowEditHistory,
  undoWorkflowEdit,
} from "../../../../UI/Components/Workflow/WorkflowEditHistory";
import {
  WorkflowGraphChange,
  WorkflowGraphChangeKind,
} from "../../../../Utils/Workflow/WorkflowGraphChanges";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";
import {
  CardSpec,
  EMAIL,
  LOG,
  MANUAL,
  graphOf,
  lookup,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";

/*
 * The builder's Undo and Redo (issue #6188): every graph the canvas showed,
 * a step for each edit, a drag and a burst of nudges one step each.
 */

const saved: (
  cards: Array<CardSpec>,
  connections?: Array<{ from: string; to: string }>,
) => SavedWorkflowGraph = (
  cards: Array<CardSpec>,
  connections: Array<{ from: string; to: string }> = [],
): SavedWorkflowGraph => {
  return toSavedWorkflowGraph(graphOf(cards, connections));
};

const START: SavedWorkflowGraph = saved([MANUAL, LOG]);

const start: () => WorkflowEditHistory = (): WorkflowEditHistory => {
  return startWorkflowEditHistory({ graph: START, now: 0 });
};

const shownKey: (history: WorkflowEditHistory) => string = (
  history: WorkflowEditHistory,
): string => {
  return getShownWorkflowEntry(history).key;
};

const stepOf: (
  history: WorkflowEditHistory,
  direction: WorkflowHistoryDirection,
) => WorkflowHistoryStep | null = (
  history: WorkflowEditHistory,
  direction: WorkflowHistoryDirection,
): WorkflowHistoryStep | null => {
  return getWorkflowHistoryStep({ history, direction, lookup });
};

const kindsOf: (step: WorkflowHistoryStep | null) => Array<string> = (
  step: WorkflowHistoryStep | null,
): Array<string> => {
  return (step?.changes || []).map((change: WorkflowGraphChange): string => {
    return change.kind;
  });
};

describe("a history just started", () => {
  test("shows the workflow as it opened, with nothing to undo or redo", () => {
    const history: WorkflowEditHistory = start();

    expect(getShownWorkflowEntry(history).graph).toBe(START);
    expect(canUndoWorkflowEdit(history)).toBe(false);
    expect(canRedoWorkflowEdit(history)).toBe(false);
    expect(stepOf(history, WorkflowHistoryDirection.Undo)).toBeNull();
    expect(stepOf(history, WorkflowHistoryDirection.Redo)).toBeNull();
  });

  test("undo and redo with nothing to do change nothing", () => {
    const history: WorkflowEditHistory = start();

    expect(undoWorkflowEdit(history)).toBe(history);
    expect(redoWorkflowEdit(history)).toBe(history);
  });
});

describe("recording what the canvas shows", () => {
  test("the graph shown already is no edit: the same history comes back", () => {
    const history: WorkflowEditHistory = start();

    expect(
      recordWorkflowEdit(history, { graph: saved([MANUAL, LOG]), now: 10 }),
    ).toBe(history);
  });

  test("what only the canvas keeps - a card selected or measured - is no edit", () => {
    const history: WorkflowEditHistory = start();
    const selected: SavedWorkflowGraph = toSavedWorkflowGraph(
      graphOf([
        { ...MANUAL, withCanvasState: true, selected: true },
        { ...LOG, withCanvasState: true },
      ]),
    );

    expect(recordWorkflowEdit(history, { graph: selected, now: 10 })).toBe(
      history,
    );
  });

  test("an edit is a step Undo takes back", () => {
    const edited: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL, LOG, EMAIL]),
      now: 10,
    });

    expect(edited.entries).toHaveLength(2);
    expect(canUndoWorkflowEdit(edited)).toBe(true);
    expect(kindsOf(stepOf(edited, WorkflowHistoryDirection.Undo))).toEqual([
      WorkflowGraphChangeKind.Added,
    ]);

    const undone: WorkflowEditHistory = undoWorkflowEdit(edited);

    expect(shownKey(undone)).toBe(getWorkflowGraphKey(START));
    expect(canRedoWorkflowEdit(undone)).toBe(true);
    expect(kindsOf(stepOf(undone, WorkflowHistoryDirection.Redo))).toEqual([
      WorkflowGraphChangeKind.Added,
    ]);

    const redone: WorkflowEditHistory = redoWorkflowEdit(undone);

    expect(shownKey(redone)).toBe(
      getWorkflowGraphKey(saved([MANUAL, LOG, EMAIL])),
    );
  });

  test("an edit after an undo drops what Redo had", () => {
    let history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL, LOG, EMAIL]),
      now: 10,
    });
    history = undoWorkflowEdit(history);
    history = recordWorkflowEdit(history, { graph: saved([MANUAL]), now: 20 });

    expect(canRedoWorkflowEdit(history)).toBe(false);
    expect(
      history.entries.map((entry: { key: string }) => {
        return entry.key;
      }),
    ).toEqual([
      getWorkflowGraphKey(START),
      getWorkflowGraphKey(saved([MANUAL])),
    ]);
  });

  test("the canvas reporting back what Undo gave it is no edit, and keeps Redo", () => {
    let history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL, LOG, EMAIL]),
      now: 10,
    });
    history = undoWorkflowEdit(history);

    const reported: WorkflowEditHistory = recordWorkflowEdit(history, {
      graph: toSavedWorkflowGraph(
        graphOf([
          { ...MANUAL, withCanvasState: true },
          { ...LOG, withCanvasState: true },
        ]),
      ),
      now: 30,
    });

    expect(reported).toBe(history);
    expect(canRedoWorkflowEdit(reported)).toBe(true);
  });

  test("keeps the last edits, as many as the limit, and drops the oldest", () => {
    let history: WorkflowEditHistory = start();

    for (
      let index: number = 1;
      index <= WORKFLOW_EDIT_HISTORY_LIMIT + 25;
      index++
    ) {
      history = recordWorkflowEdit(history, {
        graph: saved([MANUAL, { ...LOG, args: { value: `edit ${index}` } }]),
        now: index * 10_000,
      });
    }

    expect(history.entries).toHaveLength(WORKFLOW_EDIT_HISTORY_LIMIT + 1);
    expect(history.index).toBe(WORKFLOW_EDIT_HISTORY_LIMIT);

    let undoneAll: WorkflowEditHistory = history;
    let undos: number = 0;

    while (canUndoWorkflowEdit(undoneAll)) {
      undoneAll = undoWorkflowEdit(undoneAll);
      undos++;
    }

    expect(undos).toBe(WORKFLOW_EDIT_HISTORY_LIMIT);
    expect(
      (
        getShownWorkflowEntry(undoneAll).graph.nodes[1]?.["data"] as {
          arguments: { value: string };
        }
      ).arguments.value,
    ).toBe("edit 25");
  });
});

describe("a burst of nudges is one step", () => {
  const movedTo: (x: number) => SavedWorkflowGraph = (
    x: number,
  ): SavedWorkflowGraph => {
    return saved([MANUAL, { ...LOG, x }]);
  };

  test("moving the same card again within the window folds into the move before", () => {
    let history: WorkflowEditHistory = start();
    history = recordWorkflowEdit(history, { graph: movedTo(112), now: 1000 });
    history = recordWorkflowEdit(history, { graph: movedTo(128), now: 1400 });
    history = recordWorkflowEdit(history, { graph: movedTo(144), now: 1800 });

    expect(history.entries).toHaveLength(2);
    expect(shownKey(history)).toBe(getWorkflowGraphKey(movedTo(144)));
    expect(shownKey(undoWorkflowEdit(history))).toBe(
      getWorkflowGraphKey(START),
    );
  });

  test("the window runs from the last nudge: a slow, steady run is one step", () => {
    let history: WorkflowEditHistory = start();

    for (let index: number = 1; index <= 10; index++) {
      history = recordWorkflowEdit(history, {
        graph: movedTo(96 + index * 16),
        now: index * (WORKFLOW_MOVE_FOLD_WINDOW_IN_MS - 100),
      });
    }

    expect(history.entries).toHaveLength(2);
  });

  test("a move after the window is a step of its own", () => {
    let history: WorkflowEditHistory = start();
    history = recordWorkflowEdit(history, { graph: movedTo(112), now: 1000 });
    history = recordWorkflowEdit(history, {
      graph: movedTo(128),
      now: 1000 + WORKFLOW_MOVE_FOLD_WINDOW_IN_MS + 1,
    });

    expect(history.entries).toHaveLength(3);
  });

  test("moving another card is a step of its own", () => {
    let history: WorkflowEditHistory = start();
    history = recordWorkflowEdit(history, { graph: movedTo(112), now: 1000 });
    history = recordWorkflowEdit(history, {
      graph: saved([
        { ...MANUAL, x: 0 },
        { ...LOG, x: 112 },
      ]),
      now: 1100,
    });

    expect(history.entries).toHaveLength(3);
  });

  test("anything but a move never folds: an edit, then a move, then an edit", () => {
    let history: WorkflowEditHistory = start();
    history = recordWorkflowEdit(history, {
      graph: saved([MANUAL, { ...LOG, args: { value: "a" } }]),
      now: 1000,
    });
    history = recordWorkflowEdit(history, {
      graph: saved([MANUAL, { ...LOG, args: { value: "a" }, x: 200 }]),
      now: 1100,
    });
    history = recordWorkflowEdit(history, {
      graph: saved([MANUAL, { ...LOG, args: { value: "b" }, x: 200 }]),
      now: 1200,
    });

    expect(history.entries).toHaveLength(4);
  });

  test("a move never folds into the workflow as it opened", () => {
    const history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: movedTo(112),
      now: 1,
    });

    expect(history.entries).toHaveLength(2);
    expect(canUndoWorkflowEdit(history)).toBe(true);
  });

  test("after an undo, a move is a new step and never rewrites the one Redo would make", () => {
    let history: WorkflowEditHistory = start();
    history = recordWorkflowEdit(history, { graph: movedTo(112), now: 1000 });
    history = recordWorkflowEdit(history, { graph: movedTo(128), now: 5000 });
    history = undoWorkflowEdit(history);
    history = recordWorkflowEdit(history, { graph: movedTo(400), now: 5100 });

    expect(history.entries).toHaveLength(3);
    expect(shownKey(undoWorkflowEdit(history))).toBe(
      getWorkflowGraphKey(movedTo(112)),
    );
  });

  test("after a redo too", () => {
    let history: WorkflowEditHistory = start();
    history = recordWorkflowEdit(history, { graph: movedTo(112), now: 1000 });
    history = undoWorkflowEdit(history);
    history = redoWorkflowEdit(history);
    history = recordWorkflowEdit(history, { graph: movedTo(128), now: 1100 });

    expect(history.entries).toHaveLength(3);
  });
});

describe("a restore, and what Ask AI saved", () => {
  test("are steps of their own, saying what they were", () => {
    let history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL]),
      now: 10,
      cause: WorkflowEditCause.Restore,
      restoredVersionNumber: 4,
    });

    expect(stepOf(history, WorkflowHistoryDirection.Undo)).toMatchObject({
      cause: WorkflowEditCause.Restore,
      restoredVersionNumber: 4,
    });

    history = recordWorkflowEdit(history, {
      graph: saved([MANUAL, EMAIL]),
      now: 20,
      cause: WorkflowEditCause.AskAi,
    });

    expect(stepOf(history, WorkflowHistoryDirection.Undo)).toMatchObject({
      cause: WorkflowEditCause.AskAi,
    });
    expect(
      stepOf(undoWorkflowEdit(history), WorkflowHistoryDirection.Redo),
    ).toMatchObject({ cause: WorkflowEditCause.AskAi });
  });

  test("a version number is kept only for a restore", () => {
    const history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL]),
      now: 10,
      restoredVersionNumber: 4,
    });

    expect(
      getShownWorkflowEntry(history).restoredVersionNumber,
    ).toBeUndefined();
  });

  test("a move right after a restore is a step of its own", () => {
    let history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL, { ...LOG, x: 112 }]),
      now: 10,
      cause: WorkflowEditCause.Restore,
      restoredVersionNumber: 2,
    });
    history = recordWorkflowEdit(history, {
      graph: saved([MANUAL, { ...LOG, x: 128 }]),
      now: 20,
    });

    expect(history.entries).toHaveLength(3);
  });
});

describe("what Undo and Redo say they would do", () => {
  test("Undo describes the edit it takes back; Redo the one it makes again", () => {
    let history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL]),
      now: 10,
    });

    expect(stepOf(history, WorkflowHistoryDirection.Undo)).toMatchObject({
      direction: WorkflowHistoryDirection.Undo,
      cause: WorkflowEditCause.Edit,
      changes: [
        {
          kind: WorkflowGraphChangeKind.Removed,
          line: 'Removed "Log" (log-1)',
        },
      ],
    });

    history = undoWorkflowEdit(history);

    expect(stepOf(history, WorkflowHistoryDirection.Redo)).toMatchObject({
      direction: WorkflowHistoryDirection.Redo,
      changes: [{ kind: WorkflowGraphChangeKind.Removed }],
    });
  });

  test("a move is named, as the version history names it", () => {
    const history: WorkflowEditHistory = recordWorkflowEdit(start(), {
      graph: saved([MANUAL, { ...LOG, x: 400 }]),
      now: 10,
    });

    expect(
      stepOf(history, WorkflowHistoryDirection.Undo)?.changes[0]?.line,
    ).toBe('Moved "Log" (log-1)');
  });
});

describe("property: undo and redo walk the graphs the canvas showed, in order", () => {
  test("over 500 seeded sessions", () => {
    const random: SeededRandom = seededRandom(61886188);

    for (let session: number = 0; session < 500; session++) {
      let history: WorkflowEditHistory = start();
      // The graphs Undo can reach, oldest first, and the one shown.
      let reachable: Array<string> = [getWorkflowGraphKey(START)];
      let position: number = 0;
      let now: number = 0;

      for (let action: number = 0; action < 30; action++) {
        now += 10_000;
        const choice: number = random(4);

        if (choice === 0) {
          history = undoWorkflowEdit(history);
          position = Math.max(0, position - 1);
        } else if (choice === 1) {
          history = redoWorkflowEdit(history);
          position = Math.min(reachable.length - 1, position + 1);
        } else {
          const graph: SavedWorkflowGraph = saved([
            MANUAL,
            { ...LOG, args: { value: `value ${random(5)}` } },
          ]);
          const key: string = getWorkflowGraphKey(graph);

          history = recordWorkflowEdit(history, { graph, now });

          if (key !== reachable[position]) {
            reachable = [...reachable.slice(0, position + 1), key];
            position = reachable.length - 1;
          }
        }

        expect(shownKey(history)).toBe(reachable[position]);
        expect(canUndoWorkflowEdit(history)).toBe(position > 0);
        expect(canRedoWorkflowEdit(history)).toBe(
          position < reachable.length - 1,
        );
      }
    }
  });
});
