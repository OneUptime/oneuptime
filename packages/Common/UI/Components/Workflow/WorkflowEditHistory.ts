import {
  WorkflowComponentLookup,
  WorkflowGraphChange,
  WorkflowGraphChanges,
  getWorkflowGraphChanges,
} from "../../../Utils/Workflow/WorkflowGraphChanges";
import {
  SavedWorkflowGraph,
  getCardsOnlyMoved,
  getWorkflowGraphKey,
} from "../../../Utils/Workflow/WorkflowGraphSnapshot";

/*
 * THE BUILDER'S UNDO AND REDO (issue #6188): every graph the canvas has shown
 * since the workflow was opened, as it is saved (WorkflowGraphSnapshot), with
 * the one shown now. An edit adds a graph and drops whatever Redo had; Undo
 * and Redo move along the list, and the canvas shows - and autosave saves -
 * the graph they land on.
 *
 * Graphs are told apart by getWorkflowGraphKey, so whatever only the canvas
 * keeps - a card selected, measured, being dragged - is no edit: Undo never
 * stops at a selection.
 *
 * A burst of small edits is one step:
 *   - a drag is one edit once it is dropped (the page records nothing while a
 *     card is being dragged);
 *   - moving the same cards again within WORKFLOW_MOVE_FOLD_WINDOW_IN_MS -
 *     nudging a card with the arrow keys - folds into the move before, as
 *     long as nothing else happened in between.
 *
 * The list keeps the last WORKFLOW_EDIT_HISTORY_LIMIT edits. It is the
 * page's, not the workflow's: it starts again when the builder is opened
 * (the Version history is what keeps what was saved). Pure: no React.
 */

// How the canvas came to show a graph.
export enum WorkflowEditCause {
  // Something done on the canvas: a step added, deleted, moved, connected or set up.
  Edit = "Edit",
  // An earlier version, restored from the Version history.
  Restore = "Restore",
  // What Ask AI saved, from the panel beside the builder.
  AskAi = "AskAi",
}

export interface WorkflowEditHistoryEntry {
  graph: SavedWorkflowGraph;
  key: string;
  cause: WorkflowEditCause;
  // For a restore: the version restored.
  restoredVersionNumber?: number | undefined;
  // When the last edit taken into this entry was made.
  editedAt: number;
  /*
   * The cards this entry's edit did nothing but move, by id, or null for any
   * other edit: the next move of the same cards may fold into it.
   */
  movedCards: Array<string> | null;
}

export interface WorkflowEditHistory {
  entries: Array<WorkflowEditHistoryEntry>;
  // The entry the canvas shows.
  index: number;
  /*
   * Whether the entry shown is the last edit recorded, with nothing done
   * since (no undo, redo or restore): only then may a move fold into it.
   */
  canFold: boolean;
}

// How many edits back Undo goes.
export const WORKFLOW_EDIT_HISTORY_LIMIT: number = 100;

// Moves of the same cards this close together are one step.
export const WORKFLOW_MOVE_FOLD_WINDOW_IN_MS: number = 1500;

export enum WorkflowHistoryDirection {
  Undo = "Undo",
  Redo = "Redo",
}

// What an Undo or a Redo would do, for its button to say.
export interface WorkflowHistoryStep {
  direction: WorkflowHistoryDirection;
  // How the graph it undoes (or redoes) came about.
  cause: WorkflowEditCause;
  restoredVersionNumber?: number | undefined;
  // What that edit changed, as the version history says it.
  changes: Array<WorkflowGraphChange>;
}

export const startWorkflowEditHistory: (data: {
  graph: SavedWorkflowGraph;
  now: number;
}) => WorkflowEditHistory = (data: {
  graph: SavedWorkflowGraph;
  now: number;
}): WorkflowEditHistory => {
  return {
    entries: [
      {
        graph: data.graph,
        key: getWorkflowGraphKey(data.graph),
        cause: WorkflowEditCause.Edit,
        editedAt: data.now,
        movedCards: null,
      },
    ],
    index: 0,
    canFold: false,
  };
};

export const getShownWorkflowEntry: (
  history: WorkflowEditHistory,
) => WorkflowEditHistoryEntry = (
  history: WorkflowEditHistory,
): WorkflowEditHistoryEntry => {
  return history.entries[history.index] as WorkflowEditHistoryEntry;
};

const isSameCards: (first: Array<string>, second: Array<string>) => boolean = (
  first: Array<string>,
  second: Array<string>,
): boolean => {
  if (first.length !== second.length) {
    return false;
  }

  const firstSet: Set<string> = new Set<string>(first);

  return second.every((card: string): boolean => {
    return firstSet.has(card);
  });
};

/*
 * The graph the canvas shows now, after an edit (or a restore, or what Ask AI
 * saved). The same history when it is the graph shown already: a selection,
 * a measurement, the canvas reporting back what Undo just gave it.
 */
export const recordWorkflowEdit: (
  history: WorkflowEditHistory,
  data: {
    graph: SavedWorkflowGraph;
    now: number;
    cause?: WorkflowEditCause | undefined;
    restoredVersionNumber?: number | undefined;
  },
) => WorkflowEditHistory = (
  history: WorkflowEditHistory,
  data: {
    graph: SavedWorkflowGraph;
    now: number;
    cause?: WorkflowEditCause | undefined;
    restoredVersionNumber?: number | undefined;
  },
): WorkflowEditHistory => {
  const shown: WorkflowEditHistoryEntry = getShownWorkflowEntry(history);
  const key: string = getWorkflowGraphKey(data.graph);

  if (key === shown.key) {
    return history;
  }

  const cause: WorkflowEditCause = data.cause || WorkflowEditCause.Edit;
  const movedCards: Array<string> | null =
    cause === WorkflowEditCause.Edit
      ? getCardsOnlyMoved(shown.graph, data.graph)
      : null;

  const foldsIntoShown: boolean =
    history.canFold &&
    history.index > 0 &&
    history.index === history.entries.length - 1 &&
    cause === WorkflowEditCause.Edit &&
    shown.cause === WorkflowEditCause.Edit &&
    movedCards !== null &&
    shown.movedCards !== null &&
    isSameCards(shown.movedCards, movedCards) &&
    data.now - shown.editedAt >= 0 &&
    data.now - shown.editedAt <= WORKFLOW_MOVE_FOLD_WINDOW_IN_MS;

  if (foldsIntoShown) {
    const entries: Array<WorkflowEditHistoryEntry> = history.entries.slice();
    entries[history.index] = {
      ...shown,
      graph: data.graph,
      key,
      editedAt: data.now,
    };

    return { entries, index: history.index, canFold: true };
  }

  const entries: Array<WorkflowEditHistoryEntry> = history.entries
    .slice(0, history.index + 1)
    .concat([
      {
        graph: data.graph,
        key,
        cause,
        restoredVersionNumber:
          cause === WorkflowEditCause.Restore
            ? data.restoredVersionNumber
            : undefined,
        editedAt: data.now,
        movedCards: movedCards && movedCards.length > 0 ? movedCards : null,
      },
    ]);

  // The oldest edits go first: the start counts as one of the list.
  const kept: Array<WorkflowEditHistoryEntry> = entries.slice(
    Math.max(0, entries.length - (WORKFLOW_EDIT_HISTORY_LIMIT + 1)),
  );

  return {
    entries: kept,
    index: kept.length - 1,
    canFold: cause === WorkflowEditCause.Edit,
  };
};

export const canUndoWorkflowEdit: (history: WorkflowEditHistory) => boolean = (
  history: WorkflowEditHistory,
): boolean => {
  return history.index > 0;
};

export const canRedoWorkflowEdit: (history: WorkflowEditHistory) => boolean = (
  history: WorkflowEditHistory,
): boolean => {
  return history.index < history.entries.length - 1;
};

// One step back; the same history when there is nothing to undo.
export const undoWorkflowEdit: (
  history: WorkflowEditHistory,
) => WorkflowEditHistory = (
  history: WorkflowEditHistory,
): WorkflowEditHistory => {
  if (!canUndoWorkflowEdit(history)) {
    return history;
  }

  return { ...history, index: history.index - 1, canFold: false };
};

// One step forward again; the same history when there is nothing to redo.
export const redoWorkflowEdit: (
  history: WorkflowEditHistory,
) => WorkflowEditHistory = (
  history: WorkflowEditHistory,
): WorkflowEditHistory => {
  if (!canRedoWorkflowEdit(history)) {
    return history;
  }

  return { ...history, index: history.index + 1, canFold: false };
};

/*
 * What Undo (or Redo) would do now, or null when there is nothing to do: the
 * edit it would take back (or make again), and what that edit changed.
 */
export const getWorkflowHistoryStep: (data: {
  history: WorkflowEditHistory;
  direction: WorkflowHistoryDirection;
  lookup?: WorkflowComponentLookup | undefined;
}) => WorkflowHistoryStep | null = (data: {
  history: WorkflowEditHistory;
  direction: WorkflowHistoryDirection;
  lookup?: WorkflowComponentLookup | undefined;
}): WorkflowHistoryStep | null => {
  const isUndo: boolean = data.direction === WorkflowHistoryDirection.Undo;

  if (
    isUndo
      ? !canUndoWorkflowEdit(data.history)
      : !canRedoWorkflowEdit(data.history)
  ) {
    return null;
  }

  // The edit in question goes from `before` to `edit`.
  const editIndex: number = isUndo
    ? data.history.index
    : data.history.index + 1;
  const before: WorkflowEditHistoryEntry = data.history.entries[
    editIndex - 1
  ] as WorkflowEditHistoryEntry;
  const edit: WorkflowEditHistoryEntry = data.history.entries[
    editIndex
  ] as WorkflowEditHistoryEntry;

  const changes: WorkflowGraphChanges = getWorkflowGraphChanges({
    before: before.graph,
    after: edit.graph,
    lookup: data.lookup,
    includeMoves: true,
  });

  return {
    direction: data.direction,
    cause: edit.cause,
    restoredVersionNumber: edit.restoredVersionNumber,
    changes: changes.changes,
  };
};
