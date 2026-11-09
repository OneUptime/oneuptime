import {
  WorkflowEditCause,
  WorkflowHistoryDirection,
  WorkflowHistoryStep,
} from "./WorkflowEditHistory";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "../../Utils/TranslateTemplate";
import {
  WorkflowGraphChange,
  WorkflowGraphChangeKind,
  WorkflowGraphChangedStep,
} from "../../../Utils/Workflow/WorkflowGraphChanges";

/*
 * WHAT THE BUILDER'S UNDO AND REDO SAY THEY WOULD DO: "Undo deleting "Send
 * Email" (send-email-1)", "Redo connecting "Webhook" (webhook-1) to "Log"
 * (log-1)", "Undo restoring version 7". Each is one sentence in the reader's
 * language, with the steps named as the canvas and the version history name
 * them - a step's title is the step's own, and stays as written.
 *
 * Worded from what the edit changed (WorkflowGraphChanges' `changes`):
 *   - one change: what it did to which step;
 *   - several, all adding (or all deleting) steps: how many;
 *   - several, all about one step (its settings, and the connection a
 *     removed Switch case took with it): "changes to" that step;
 *   - anything else: how many changes.
 * Pure: the page hands it the reader's Translator.
 */

interface DirectionWords {
  plain: string;
  nothing: string;
  adding: string;
  deleting: string;
  moving: string;
  connecting: string;
  disconnecting: string;
  changesTo: string;
  restoring: string;
  askAi: string;
  theirChanges: string;
  addingMany: PluralTemplate;
  deletingMany: PluralTemplate;
  movingMany: PluralTemplate;
  changes: PluralTemplate;
}

export const WorkflowUndoCopy: DirectionWords = {
  plain: translationKey("Undo"),
  nothing: translationKey("Nothing to undo"),
  adding: translationKey("Undo adding {{step}}"),
  deleting: translationKey("Undo deleting {{step}}"),
  moving: translationKey("Undo moving {{step}}"),
  connecting: translationKey("Undo connecting {{from}} to {{to}}"),
  disconnecting: translationKey("Undo disconnecting {{from}} from {{to}}"),
  changesTo: translationKey("Undo changes to {{step}}"),
  restoring: translationKey("Undo restoring version {{number}}"),
  askAi: translationKey("Undo Ask AI's change"),
  theirChanges: translationKey("Undo showing their changes"),
  addingMany: {
    one: translationKey("Undo adding {{count}} step"),
    other: translationKey("Undo adding {{count}} steps"),
  },
  deletingMany: {
    one: translationKey("Undo deleting {{count}} step"),
    other: translationKey("Undo deleting {{count}} steps"),
  },
  movingMany: {
    one: translationKey("Undo moving {{count}} step"),
    other: translationKey("Undo moving {{count}} steps"),
  },
  changes: {
    one: translationKey("Undo {{count}} change"),
    other: translationKey("Undo {{count}} changes"),
  },
};

export const WorkflowRedoCopy: DirectionWords = {
  plain: translationKey("Redo"),
  nothing: translationKey("Nothing to redo"),
  adding: translationKey("Redo adding {{step}}"),
  deleting: translationKey("Redo deleting {{step}}"),
  moving: translationKey("Redo moving {{step}}"),
  connecting: translationKey("Redo connecting {{from}} to {{to}}"),
  disconnecting: translationKey("Redo disconnecting {{from}} from {{to}}"),
  changesTo: translationKey("Redo changes to {{step}}"),
  restoring: translationKey("Redo restoring version {{number}}"),
  askAi: translationKey("Redo Ask AI's change"),
  theirChanges: translationKey("Redo showing their changes"),
  addingMany: {
    one: translationKey("Redo adding {{count}} step"),
    other: translationKey("Redo adding {{count}} steps"),
  },
  deletingMany: {
    one: translationKey("Redo deleting {{count}} step"),
    other: translationKey("Redo deleting {{count}} steps"),
  },
  movingMany: {
    one: translationKey("Redo moving {{count}} step"),
    other: translationKey("Redo moving {{count}} steps"),
  },
  changes: {
    one: translationKey("Redo {{count}} change"),
    other: translationKey("Redo {{count}} changes"),
  },
};

// The keyboard shortcut after what a button does: "Undo deleting X (⌘Z)".
export const WORKFLOW_HISTORY_SHORTCUT_TEMPLATE: string = translationKey(
  "{{action}} ({{shortcut}})",
);

const wordsFor: (direction: WorkflowHistoryDirection) => DirectionWords = (
  direction: WorkflowHistoryDirection,
): DirectionWords => {
  return direction === WorkflowHistoryDirection.Undo
    ? WorkflowUndoCopy
    : WorkflowRedoCopy;
};

const CHANGES_TO_ONE_STEP: ReadonlySet<WorkflowGraphChangeKind> =
  new Set<WorkflowGraphChangeKind>([
    WorkflowGraphChangeKind.Renamed,
    WorkflowGraphChangeKind.Replaced,
    WorkflowGraphChangeKind.SettingsChanged,
    WorkflowGraphChangeKind.SetUpChanged,
    WorkflowGraphChangeKind.Connected,
    WorkflowGraphChangeKind.Disconnected,
  ]);

/*
 * The one step every change is about, when there is one: a Switch whose case
 * was taken out, with the connection that went with it.
 */
const getStepEveryChangeIsAbout: (
  changes: Array<WorkflowGraphChange>,
) => WorkflowGraphChangedStep | null = (
  changes: Array<WorkflowGraphChange>,
): WorkflowGraphChangedStep | null => {
  if (
    !changes.every((change: WorkflowGraphChange): boolean => {
      return CHANGES_TO_ONE_STEP.has(change.kind);
    })
  ) {
    return null;
  }

  const first: WorkflowGraphChange | undefined = changes[0];

  if (!first) {
    return null;
  }

  for (const candidate of first.steps) {
    if (
      changes.every((change: WorkflowGraphChange): boolean => {
        return change.steps.some((step: WorkflowGraphChangedStep): boolean => {
          return step.key === candidate.key;
        });
      })
    ) {
      return candidate;
    }
  }

  return null;
};

const describeOneChange: (data: {
  change: WorkflowGraphChange;
  words: DirectionWords;
  translator: Translator;
}) => string = (data: {
  change: WorkflowGraphChange;
  words: DirectionWords;
  translator: Translator;
}): string => {
  const { change, words, translator } = data;
  const first: WorkflowGraphChangedStep | undefined = change.steps[0];
  const second: WorkflowGraphChangedStep | undefined = change.steps[1];

  switch (change.kind) {
    case WorkflowGraphChangeKind.Added:
      return translator.translateTemplate(words.adding, {
        step: first?.label || "",
      });
    case WorkflowGraphChangeKind.Removed:
      return translator.translateTemplate(words.deleting, {
        step: first?.label || "",
      });
    case WorkflowGraphChangeKind.Moved:
      return change.steps.length === 1
        ? translator.translateTemplate(words.moving, {
            step: first?.label || "",
          })
        : translator.translatePlural(words.movingMany, change.steps.length);
    case WorkflowGraphChangeKind.Connected:
      return translator.translateTemplate(words.connecting, {
        from: first?.label || "",
        to: second?.label || "",
      });
    case WorkflowGraphChangeKind.Disconnected:
      return translator.translateTemplate(words.disconnecting, {
        from: first?.label || "",
        to: second?.label || "",
      });
    default:
      return translator.translateTemplate(words.changesTo, {
        step: first?.label || "",
      });
  }
};

const isAll: (
  changes: Array<WorkflowGraphChange>,
  kind: WorkflowGraphChangeKind,
) => boolean = (
  changes: Array<WorkflowGraphChange>,
  kind: WorkflowGraphChangeKind,
): boolean => {
  return changes.every((change: WorkflowGraphChange): boolean => {
    return change.kind === kind;
  });
};

/*
 * What the button for `direction` says it would do. With no step - nothing
 * to undo or redo - it says so.
 */
export const getWorkflowHistoryActionText: (data: {
  direction: WorkflowHistoryDirection;
  step: WorkflowHistoryStep | null;
  translator: Translator;
}) => string = (data: {
  direction: WorkflowHistoryDirection;
  step: WorkflowHistoryStep | null;
  translator: Translator;
}): string => {
  const words: DirectionWords = wordsFor(data.direction);
  const translator: Translator = data.translator;

  if (!data.step) {
    return translator.translateText(words.nothing) || words.nothing;
  }

  if (data.step.cause === WorkflowEditCause.Restore) {
    return typeof data.step.restoredVersionNumber === "number"
      ? translator.translateTemplate(words.restoring, {
          number: translator.formatNumber(data.step.restoredVersionNumber),
        })
      : translator.translateText(words.plain) || words.plain;
  }

  if (data.step.cause === WorkflowEditCause.AskAi) {
    return translator.translateText(words.askAi) || words.askAi;
  }

  if (data.step.cause === WorkflowEditCause.TheirChanges) {
    return translator.translateText(words.theirChanges) || words.theirChanges;
  }

  const changes: Array<WorkflowGraphChange> = data.step.changes;
  const first: WorkflowGraphChange | undefined = changes[0];

  // A change the lines do not see - the empty trigger slot moved.
  if (!first) {
    return translator.translateText(words.plain) || words.plain;
  }

  if (changes.length === 1) {
    return describeOneChange({ change: first, words, translator });
  }

  if (isAll(changes, WorkflowGraphChangeKind.Added)) {
    return translator.translatePlural(words.addingMany, changes.length);
  }

  if (isAll(changes, WorkflowGraphChangeKind.Removed)) {
    return translator.translatePlural(words.deletingMany, changes.length);
  }

  const step: WorkflowGraphChangedStep | null =
    getStepEveryChangeIsAbout(changes);

  if (step) {
    return translator.translateTemplate(words.changesTo, {
      step: step.label,
    });
  }

  return translator.translatePlural(words.changes, changes.length);
};

/*
 * What the button says under the pointer: what it would do and, when it can
 * do something, its keyboard shortcut ("⌘Z", "Ctrl+Z").
 */
export const getWorkflowHistoryTooltip: (data: {
  direction: WorkflowHistoryDirection;
  step: WorkflowHistoryStep | null;
  shortcut: string;
  translator: Translator;
}) => string = (data: {
  direction: WorkflowHistoryDirection;
  step: WorkflowHistoryStep | null;
  shortcut: string;
  translator: Translator;
}): string => {
  const action: string = getWorkflowHistoryActionText(data);

  if (!data.step || !data.shortcut) {
    return action;
  }

  return data.translator.translateTemplate(WORKFLOW_HISTORY_SHORTCUT_TEMPLATE, {
    action,
    shortcut: data.shortcut,
  });
};
