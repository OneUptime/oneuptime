import { WorkflowGraphRevision } from "./WorkflowAutosave";
import { WorkflowEditCause } from "./WorkflowEditHistory";
import WriteSource from "../../../Types/BaseDatabase/WriteSource";
import {
  SavedWorkflowGraph,
  getWorkflowGraphKey,
  toSavedWorkflowGraph,
} from "../../../Utils/Workflow/WorkflowGraphSnapshot";

/*
 * WHAT ASK AI SAVED, AND WHAT OTHERS SAVED AROUND IT (issue #6274).
 *
 * When Ask AI changes the workflow from the panel beside the Builder, the
 * Builder reads the workflow again and draws it as a step of its own, which
 * Undo takes back ("Undo Ask AI's change"). Most of the time the Builder
 * knew the workflow up to Ask AI's save, and the step is Ask AI's change
 * alone: the workflow's graph revision moved by one.
 *
 * But someone else may have saved in between - a teammate, the API, another
 * tab - and an approved Ask AI change is made on top of what they saved.
 * Drawn as one step, Undo of "Ask AI's change" would take their work back
 * too, and the save after it would replace it with nobody asked. So when
 * the revision moved by more than one, the Builder reads the newest
 * versions (Version history keeps each Ask AI change as a version of its
 * own, the one before it the workflow just as Ask AI found it, #6258) and
 * draws one step per version since the graph it knew: Ask AI's as Ask AI's
 * change, everyone else's as their changes ("Undo showing their changes",
 * as when the person chose to see a teammate's change, #6257). Undo then
 * takes back Ask AI's change alone, and their work stays until the person
 * undoes it too, knowing whose it is.
 *
 * When the versions cannot say - the graph the Builder knew is not among
 * them - everything up to the first version read is their changes: it may
 * hold more than one save. Pure: no React, no server.
 */

// The most versions read to tell the saves apart.
export const MAX_WORKFLOW_VERSIONS_READ_FOR_SAVES: number = 10;

// A version as the Builder reads it here.
export interface WorkflowVersionOfSave {
  versionNumber: number;
  graph: unknown;
  // Ask AI, when it saved the version for a person; anything else is someone's own.
  savedThrough?: WriteSource | string | null | undefined;
}

// One step of what was saved elsewhere, for the Builder to draw in order.
export interface WorkflowSavedElsewhereStep {
  graph: SavedWorkflowGraph;
  cause: WorkflowEditCause.AskAi | WorkflowEditCause.TheirChanges;
}

/*
 * Whether the graph the server has now is Ask AI's save alone, over the one
 * this Builder knew: the revision moved by one at most. A revision not known
 * on either side tells nothing more, and the graph is drawn as it always
 * was, as Ask AI's.
 */
export const isAskAiSaveAlone: (data: {
  known: WorkflowGraphRevision;
  server: WorkflowGraphRevision;
}) => boolean = (data: {
  known: WorkflowGraphRevision;
  server: WorkflowGraphRevision;
}): boolean => {
  if (data.known === null || data.server === null) {
    return true;
  }

  return data.server - data.known <= 1;
};

/*
 * How many of the newest versions to read: one for every save since the
 * graph this Builder knew, and the version that held it.
 */
export const getWorkflowVersionsToRead: (data: {
  known: WorkflowGraphRevision;
  server: WorkflowGraphRevision;
}) => number = (data: {
  known: WorkflowGraphRevision;
  server: WorkflowGraphRevision;
}): number => {
  if (data.known === null || data.server === null) {
    return MAX_WORKFLOW_VERSIONS_READ_FOR_SAVES;
  }

  return Math.min(
    MAX_WORKFLOW_VERSIONS_READ_FOR_SAVES,
    Math.max(2, data.server - data.known + 1),
  );
};

const causeOf: (
  version: WorkflowVersionOfSave,
) => WorkflowEditCause.AskAi | WorkflowEditCause.TheirChanges = (
  version: WorkflowVersionOfSave,
): WorkflowEditCause.AskAi | WorkflowEditCause.TheirChanges => {
  return version.savedThrough === WriteSource.AskAi
    ? WorkflowEditCause.AskAi
    : WorkflowEditCause.TheirChanges;
};

/*
 * The steps from the graph this Builder knew the server had (`known`) to
 * the graph it has now (`server`), from the newest versions (`versions`, in
 * any order): one per version since `known`, each Ask AI's or theirs, then
 * whatever the server has that no version read says. Their changes next to
 * each other are one step; a step that changes nothing is none.
 */
export const getStepsSavedElsewhere: (data: {
  known: SavedWorkflowGraph | null;
  server: unknown;
  versions: Array<WorkflowVersionOfSave>;
}) => Array<WorkflowSavedElsewhereStep> = (data: {
  known: SavedWorkflowGraph | null;
  server: unknown;
  versions: Array<WorkflowVersionOfSave>;
}): Array<WorkflowSavedElsewhereStep> => {
  const knownKey: string | null = data.known
    ? getWorkflowGraphKey(data.known)
    : null;

  const newestFirst: Array<WorkflowVersionOfSave> = data.versions
    .slice()
    .sort((a: WorkflowVersionOfSave, b: WorkflowVersionOfSave): number => {
      return b.versionNumber - a.versionNumber;
    });

  // The newest version that held the graph this Builder knew.
  const knownAt: number =
    knownKey === null
      ? -1
      : newestFirst.findIndex((version: WorkflowVersionOfSave): boolean => {
          return getWorkflowGraphKey(version.graph) === knownKey;
        });

  const since: Array<WorkflowVersionOfSave> = (
    knownAt === -1 ? newestFirst : newestFirst.slice(0, knownAt)
  ).reverse();

  const proposed: Array<WorkflowSavedElsewhereStep> = since.map(
    (
      version: WorkflowVersionOfSave,
      index: number,
    ): WorkflowSavedElsewhereStep => {
      return {
        graph: toSavedWorkflowGraph(version.graph),
        /*
         * With the graph it knew not among the versions read, the first of
         * them may hold more saves than its own: their changes.
         */
        cause:
          knownAt === -1 && index === 0
            ? WorkflowEditCause.TheirChanges
            : causeOf(version),
      };
    },
  );

  proposed.push({
    graph: toSavedWorkflowGraph(data.server),
    cause: WorkflowEditCause.TheirChanges,
  });

  const steps: Array<{ step: WorkflowSavedElsewhereStep; key: string }> = [];

  for (const step of proposed) {
    const last: { step: WorkflowSavedElsewhereStep; key: string } | undefined =
      steps[steps.length - 1];

    // Their saves next to each other are one: this one takes the last one in.
    if (
      last &&
      last.step.cause === WorkflowEditCause.TheirChanges &&
      step.cause === WorkflowEditCause.TheirChanges
    ) {
      steps.pop();
    }

    const key: string = getWorkflowGraphKey(step.graph);
    const before: string | null =
      steps.length > 0 ? steps[steps.length - 1]!.key : knownKey;

    // No change from the step before it: nothing to draw, or undo.
    if (key === before) {
      continue;
    }

    steps.push({ step, key });
  }

  return steps.map(
    (each: {
      step: WorkflowSavedElsewhereStep;
      key: string;
    }): WorkflowSavedElsewhereStep => {
      return each.step;
    },
  );
};
