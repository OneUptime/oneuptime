import { describe, expect, test } from "@jest/globals";
import {
  WorkflowEditCause,
  WorkflowHistoryDirection,
  WorkflowHistoryStep,
  getWorkflowHistoryStep,
  recordWorkflowEdit,
  startWorkflowEditHistory,
  undoWorkflowEdit,
  WorkflowEditHistory,
} from "../../../../UI/Components/Workflow/WorkflowEditHistory";
import {
  WORKFLOW_HISTORY_SHORTCUT_TEMPLATE,
  WorkflowRedoCopy,
  WorkflowUndoCopy,
  getWorkflowHistoryActionText,
  getWorkflowHistoryTooltip,
} from "../../../../UI/Components/Workflow/WorkflowHistoryLabels";
import { Translator, createTranslator } from "../../../../Types/Translator";
import {
  WorkflowGraphChange,
  WorkflowGraphChangeKind,
} from "../../../../Utils/Workflow/WorkflowGraphChanges";
import {
  SavedWorkflowGraph,
  toSavedWorkflowGraph,
} from "../../../../Utils/Workflow/WorkflowGraphSnapshot";
import {
  CardSpec,
  EMAIL,
  IF_ELSE,
  LOG,
  MANUAL,
  graphOf,
  lookup,
} from "../../../Utils/Workflow/WorkflowGraphFixtures";

/*
 * What the builder's Undo and Redo say they would do (issue #6188): "Undo
 * deleting "Send Email" (send-email-1)", one sentence in the reader's
 * language with the steps named as the canvas names them.
 */

const english: Translator = createTranslator(undefined, "en");

const saved: (
  cards: Array<CardSpec>,
  connections?: Array<{ from: string; to: string; fromPort?: string }>,
) => SavedWorkflowGraph = (
  cards: Array<CardSpec>,
  connections: Array<{ from: string; to: string; fromPort?: string }> = [],
): SavedWorkflowGraph => {
  return toSavedWorkflowGraph(graphOf(cards, connections));
};

// What Undo says after the canvas went from `before` to `after`.
const undoText: (
  before: SavedWorkflowGraph,
  after: SavedWorkflowGraph,
  translator?: Translator,
) => string = (
  before: SavedWorkflowGraph,
  after: SavedWorkflowGraph,
  translator: Translator = english,
): string => {
  const history: WorkflowEditHistory = recordWorkflowEdit(
    startWorkflowEditHistory({ graph: before, now: 0 }),
    { graph: after, now: 10_000 },
  );

  return getWorkflowHistoryActionText({
    direction: WorkflowHistoryDirection.Undo,
    step: getWorkflowHistoryStep({
      history,
      direction: WorkflowHistoryDirection.Undo,
      lookup,
    }),
    translator,
  });
};

const stepWith: (data: {
  cause?: WorkflowEditCause;
  restoredVersionNumber?: number;
  changes?: Array<WorkflowGraphChange>;
  direction?: WorkflowHistoryDirection;
}) => WorkflowHistoryStep = (data: {
  cause?: WorkflowEditCause;
  restoredVersionNumber?: number;
  changes?: Array<WorkflowGraphChange>;
  direction?: WorkflowHistoryDirection;
}): WorkflowHistoryStep => {
  return {
    direction: data.direction || WorkflowHistoryDirection.Undo,
    cause: data.cause || WorkflowEditCause.Edit,
    restoredVersionNumber: data.restoredVersionNumber,
    changes: data.changes || [],
  };
};

const change: (
  kind: WorkflowGraphChangeKind,
  ...labels: Array<string>
) => WorkflowGraphChange = (
  kind: WorkflowGraphChangeKind,
  ...labels: Array<string>
): WorkflowGraphChange => {
  return {
    kind,
    line: kind,
    steps: labels.map((label: string, index: number) => {
      return { key: `${label}-${index}`, label };
    }),
  };
};

describe("one change, said for what it is", () => {
  test("a step deleted: the issue's own example", () => {
    expect(undoText(saved([MANUAL, EMAIL]), saved([MANUAL]))).toBe(
      'Undo deleting "Send Email" (send-email-1)',
    );
  });

  test("a step added", () => {
    expect(undoText(saved([MANUAL]), saved([MANUAL, LOG]))).toBe(
      'Undo adding "Log" (log-1)',
    );
  });

  test("a card moved", () => {
    expect(
      undoText(saved([MANUAL, LOG]), saved([MANUAL, { ...LOG, x: 500 }])),
    ).toBe('Undo moving "Log" (log-1)');
  });

  test("several cards moved", () => {
    expect(
      undoText(
        saved([MANUAL, LOG, EMAIL]),
        saved([
          { ...MANUAL, x: 0 },
          { ...LOG, x: 0 },
          { ...EMAIL, x: 0 },
        ]),
      ),
    ).toBe("Undo moving 3 steps");
  });

  test("a connection made", () => {
    expect(
      undoText(
        saved([MANUAL, LOG]),
        saved([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
      ),
    ).toBe('Undo connecting "Manual" (manual-1) to "Log" (log-1)');
  });

  test("a connection removed", () => {
    expect(
      undoText(
        saved([MANUAL, LOG], [{ from: MANUAL.key, to: LOG.key }]),
        saved([MANUAL, LOG]),
      ),
    ).toBe('Undo disconnecting "Manual" (manual-1) from "Log" (log-1)');
  });

  test("a step's settings changed", () => {
    expect(
      undoText(
        saved([MANUAL, LOG]),
        saved([MANUAL, { ...LOG, args: { value: "other" } }]),
      ),
    ).toBe('Undo changes to "Log" (log-1)');
  });

  test("a step renamed", () => {
    expect(
      undoText(saved([LOG]), saved([{ ...LOG, stepId: "log-final" }])),
    ).toBe('Undo changes to "Log" (log-1)');
  });
});

describe("several changes", () => {
  test("all steps added: counted", () => {
    expect(undoText(saved([MANUAL]), saved([MANUAL, LOG, EMAIL]))).toBe(
      "Undo adding 2 steps",
    );
  });

  test("all steps deleted: counted", () => {
    expect(undoText(saved([MANUAL, LOG, EMAIL]), saved([MANUAL]))).toBe(
      "Undo deleting 2 steps",
    );
  });

  test("all about one step - a case taken out of a Switch with its connection - is a change to it", () => {
    expect(
      undoText(
        saved(
          [IF_ELSE, LOG],
          [{ from: IF_ELSE.key, to: LOG.key, fromPort: "yes" }],
        ),
        saved([{ ...IF_ELSE, args: { "compare-as": "number" } }, LOG]),
      ),
    ).toBe('Undo changes to "If / Else" (if-else-1)');
  });

  test("a connection moved from one step to another is a change to the step it leaves", () => {
    expect(
      undoText(
        saved([MANUAL, LOG, EMAIL], [{ from: MANUAL.key, to: LOG.key }]),
        saved([MANUAL, LOG, EMAIL], [{ from: MANUAL.key, to: EMAIL.key }]),
      ),
    ).toBe('Undo changes to "Manual" (manual-1)');
  });

  test("anything else: how many", () => {
    expect(undoText(saved([MANUAL, LOG]), saved([MANUAL, EMAIL]))).toBe(
      "Undo 2 changes",
    );
  });

  test("a step added and a card moved: how many", () => {
    expect(
      undoText(saved([MANUAL, LOG]), saved([{ ...MANUAL, x: 0 }, LOG, EMAIL])),
    ).toBe("Undo 2 changes");
  });
});

describe("a restore and Ask AI's change say what they were", () => {
  test("a restore names its version", () => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Undo,
        step: stepWith({
          cause: WorkflowEditCause.Restore,
          restoredVersionNumber: 7,
        }),
        translator: english,
      }),
    ).toBe("Undo restoring version 7");
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: stepWith({
          cause: WorkflowEditCause.Restore,
          restoredVersionNumber: 1234,
          direction: WorkflowHistoryDirection.Redo,
        }),
        translator: english,
      }),
    ).toBe("Redo restoring version 1,234");
  });

  test("a restore without its number is a plain Undo", () => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Undo,
        step: stepWith({ cause: WorkflowEditCause.Restore }),
        translator: english,
      }),
    ).toBe("Undo");
  });

  test("Ask AI's change", () => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Undo,
        step: stepWith({ cause: WorkflowEditCause.AskAi }),
        translator: english,
      }),
    ).toBe("Undo Ask AI's change");
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: stepWith({ cause: WorkflowEditCause.AskAi }),
        translator: english,
      }),
    ).toBe("Redo Ask AI's change");
  });
});

describe("Redo says the same, as Redo", () => {
  test("after an undo", () => {
    const history: WorkflowEditHistory = undoWorkflowEdit(
      recordWorkflowEdit(
        startWorkflowEditHistory({ graph: saved([MANUAL, EMAIL]), now: 0 }),
        { graph: saved([MANUAL]), now: 10_000 },
      ),
    );

    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: getWorkflowHistoryStep({
          history,
          direction: WorkflowHistoryDirection.Redo,
          lookup,
        }),
        translator: english,
      }),
    ).toBe('Redo deleting "Send Email" (send-email-1)');
  });

  test.each([
    [WorkflowGraphChangeKind.Added, 'Redo adding "A"'],
    [WorkflowGraphChangeKind.Removed, 'Redo deleting "A"'],
    [WorkflowGraphChangeKind.Moved, 'Redo moving "A"'],
    [WorkflowGraphChangeKind.SettingsChanged, 'Redo changes to "A"'],
    [WorkflowGraphChangeKind.SetUpChanged, 'Redo changes to "A"'],
    [WorkflowGraphChangeKind.Renamed, 'Redo changes to "A"'],
    [WorkflowGraphChangeKind.Replaced, 'Redo changes to "A"'],
  ])("%s", (kind: WorkflowGraphChangeKind, expected: string) => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: stepWith({ changes: [change(kind, '"A"')] }),
        translator: english,
      }),
    ).toBe(expected);
  });

  test("connections", () => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: stepWith({
          changes: [change(WorkflowGraphChangeKind.Connected, '"A"', '"B"')],
        }),
        translator: english,
      }),
    ).toBe('Redo connecting "A" to "B"');
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: stepWith({
          changes: [change(WorkflowGraphChangeKind.Disconnected, '"A"', '"B"')],
        }),
        translator: english,
      }),
    ).toBe('Redo disconnecting "A" from "B"');
  });
});

describe("nothing to undo or redo", () => {
  test("says so", () => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Undo,
        step: null,
        translator: english,
      }),
    ).toBe("Nothing to undo");
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Redo,
        step: null,
        translator: english,
      }),
    ).toBe("Nothing to redo");
  });

  test("an edit the lines do not see - the empty trigger slot moved - is a plain Undo", () => {
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Undo,
        step: stepWith({}),
        translator: english,
      }),
    ).toBe("Undo");
  });
});

describe("the tooltip", () => {
  test("adds the shortcut to what the button would do", () => {
    expect(
      getWorkflowHistoryTooltip({
        direction: WorkflowHistoryDirection.Undo,
        step: stepWith({
          changes: [change(WorkflowGraphChangeKind.Removed, '"Send Email"')],
        }),
        shortcut: "⌘Z",
        translator: english,
      }),
    ).toBe('Undo deleting "Send Email" (⌘Z)');
  });

  test("names no shortcut when there is nothing to do, or no shortcut", () => {
    expect(
      getWorkflowHistoryTooltip({
        direction: WorkflowHistoryDirection.Redo,
        step: null,
        shortcut: "Ctrl+Y",
        translator: english,
      }),
    ).toBe("Nothing to redo");
    expect(
      getWorkflowHistoryTooltip({
        direction: WorkflowHistoryDirection.Undo,
        step: stepWith({ cause: WorkflowEditCause.AskAi }),
        shortcut: "",
        translator: english,
      }),
    ).toBe("Undo Ask AI's change");
  });
});

describe("in the reader's language", () => {
  // A language that words every sentence, so the lookups are seen.
  const shouting: Translator = createTranslator((text: string): string => {
    return text.toUpperCase().replace(/{{(\w+)}}/gi, (match: string) => {
      return match.toLowerCase();
    });
  }, "de");

  test("the whole sentence is looked up, and the step's name put in as written", () => {
    expect(undoText(saved([MANUAL, EMAIL]), saved([MANUAL]), shouting)).toBe(
      'UNDO DELETING "Send Email" (send-email-1)',
    );
  });

  test("so is a plural, by its count, and nothing to do", () => {
    expect(
      undoText(saved([MANUAL, LOG, EMAIL]), saved([MANUAL]), shouting),
    ).toBe("UNDO DELETING 2 STEPS");
    expect(
      getWorkflowHistoryActionText({
        direction: WorkflowHistoryDirection.Undo,
        step: null,
        translator: shouting,
      }),
    ).toBe("NOTHING TO UNDO");
  });

  test("every sentence Undo and Redo say is a key of the copy, one for each direction", () => {
    const undoKeys: Array<string> = Object.values(WorkflowUndoCopy).flatMap(
      (value: unknown): Array<string> => {
        return typeof value === "string"
          ? [value]
          : [(value as { other: string }).other];
      },
    );
    const redoKeys: Array<string> = Object.values(WorkflowRedoCopy).flatMap(
      (value: unknown): Array<string> => {
        return typeof value === "string"
          ? [value]
          : [(value as { other: string }).other];
      },
    );

    expect(undoKeys).toHaveLength(redoKeys.length);
    expect(
      undoKeys.every((key: string): boolean => {
        return key.startsWith("Undo") || key === "Nothing to undo";
      }),
    ).toBe(true);
    expect(
      redoKeys.every((key: string): boolean => {
        return key.startsWith("Redo") || key === "Nothing to redo";
      }),
    ).toBe(true);
    expect(WORKFLOW_HISTORY_SHORTCUT_TEMPLATE).toBe(
      "{{action}} ({{shortcut}})",
    );
  });
});
