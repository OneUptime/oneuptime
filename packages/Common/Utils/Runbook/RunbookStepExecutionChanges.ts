import { canStepTypeRequireApproval } from "../../Types/Runbook/RunbookStepApproval";
import RunbookStepExecutionStatus from "../../Types/Runbook/RunbookStepExecutionStatus";
import { limitLines } from "../Workflow/WorkflowGraphChanges";

/*
 * WHAT HAPPENED TO A RUNBOOK RUN'S STEPS, AS A PERSON WOULD SAY IT.
 *
 * A run keeps its steps as one JSON list (RunbookExecution.stepExecutions):
 * each step's own copy of the runbook step - its script, the Runner it runs
 * on - with its status, its output and error, who ticked it off or approved
 * it, and the note they left. The audit log records the list as what
 * changed in it (Server/Utils/AuditLog/AuditLogColumnSummaries), never as
 * the list: a diff of it would name positions in an array and copy every
 * step's output into the entry. So a step someone approved, completed,
 * skipped or cancelled reads as they would say it:
 *
 *   Approved "Restart the API" (step 3)
 *   Completed "Check the dashboards" (step 2)
 *   Skipped "Notify customers" (step 4)
 *   Cancelled "Verify the API" (step 5)
 *
 * and a step OneUptime moved on while running the run - a system event - as
 * where it went:
 *
 *   "Restart the API" (step 3) went from pending to running
 *
 * Only a step's title, type, status, and whether it was approved, are read.
 * Its output, its error and the note someone wrote with it are never quoted
 * - a script prints whatever it is handed, and a note is typed text - and a
 * change to them alone is no change here. Steps are numbered as the run's
 * page numbers them, from 1, in the order the run takes them. Pure: no
 * server.
 */

// The most characters of a step's title a line quotes; a longer one ends in "…".
export const RUNBOOK_STEP_TITLE_LIMIT: number = 120;

// A summary longer than this ends with "and N more step changes".
export const RUNBOOK_STEP_CHANGE_LINE_LIMIT: number = 25;

// A step of a run as the lines read it: nothing it printed, nothing typed.
export interface RunbookStepExecutionRead {
  // Its place in the run, from 1.
  number: number;
  // The step's own id, when it has one: what matches it across two lists.
  id: string | null;
  title: string;
  type: string | null;
  status: string | null;
  isApproved: boolean;
}

// Each status in the words a line uses, in the order counts are told.
const STATUS_WORDS: ReadonlyArray<[string, string]> = [
  [RunbookStepExecutionStatus.Completed, "done"],
  [RunbookStepExecutionStatus.Skipped, "skipped"],
  [RunbookStepExecutionStatus.Failed, "failed"],
  [RunbookStepExecutionStatus.Cancelled, "cancelled"],
  [RunbookStepExecutionStatus.Running, "running"],
  [RunbookStepExecutionStatus.WaitingForUser, "waiting for a person"],
  [RunbookStepExecutionStatus.Pending, "pending"],
];

const STATUS_WORD: ReadonlyMap<string, string> = new Map<string, string>(
  STATUS_WORDS,
);

const isPlainObject: (value: unknown) => value is Record<string, unknown> = (
  value: unknown,
): value is Record<string, unknown> => {
  return value !== null && typeof value === "object" && !Array.isArray(value);
};

const readText: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
};

const capitalize: (text: string) => string = (text: string): string => {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
};

/*
 * A text cut to `limit` characters, ending in "…" when it was longer. Cut
 * by code point, so a character written as two (an emoji) is never halved.
 */
export const boundRunbookStepText: (text: string, limit: number) => string = (
  text: string,
  limit: number,
): string => {
  if (text.length <= limit) {
    return text;
  }

  const characters: Array<string> = Array.from(text);

  return characters.length <= limit
    ? text
    : `${characters.slice(0, Math.max(1, limit - 1)).join("")}…`;
};

// A status's words; one OneUptime does not know is named as it is stored.
export const describeRunbookStepStatus: (status: string | null) => string = (
  status: string | null,
): string => {
  if (!status) {
    return "not started";
  }

  return (
    STATUS_WORD.get(status) ||
    boundRunbookStepText(status, RUNBOOK_STEP_TITLE_LIMIT)
  );
};

/*
 * The steps of a run's list, in its order. Anything that is not a list
 * reads as no steps, and an entry that is not a step is passed over - it
 * still takes its place in the numbering, as it does on the run's page.
 */
export const readRunbookStepExecutions: (
  value: unknown,
) => Array<RunbookStepExecutionRead> = (
  value: unknown,
): Array<RunbookStepExecutionRead> => {
  if (!Array.isArray(value)) {
    return [];
  }

  const steps: Array<RunbookStepExecutionRead> = [];

  value.forEach((entry: unknown, index: number): void => {
    if (!isPlainObject(entry)) {
      return;
    }

    const step: Record<string, unknown> = isPlainObject(entry["step"])
      ? entry["step"]
      : {};

    steps.push({
      number: index + 1,
      id: readText(step["id"]),
      title: readText(step["title"]) || "",
      type: readText(step["type"]),
      status: readText(entry["status"]),
      isApproved: Boolean(readText(entry["approvedAt"])),
    });
  });

  return steps;
};

// "Restart the API" (step 3): the step's title, bounded, and its place.
export const describeRunbookStep: (step: RunbookStepExecutionRead) => string = (
  step: RunbookStepExecutionRead,
): string => {
  if (!step.title) {
    return `step ${step.number}`;
  }

  return `"${boundRunbookStepText(step.title, RUNBOOK_STEP_TITLE_LIMIT)}" (step ${step.number})`;
};

/*
 * What happened to one step, from `before` to `after`, as one line - or
 * null when neither its status nor its approval changed:
 *
 *   - approved, when it was not before: a step that waits for approval
 *     before it runs goes back to pending, approved, and the run runs it;
 *   - from waiting for a person to done: a Manual step ticked off reads
 *     "Completed", any other step approved so the run goes on (a run
 *     started before approvals moved) reads "Approved", as its button said;
 *   - skipped, or cancelled (a cancelled run cancels every step it had not
 *     finished);
 *   - anything else - OneUptime running the run - as where it went.
 */
export const describeRunbookStepChange: (data: {
  before: RunbookStepExecutionRead;
  after: RunbookStepExecutionRead;
}) => string | null = (data: {
  before: RunbookStepExecutionRead;
  after: RunbookStepExecutionRead;
}): string | null => {
  const { before, after } = data;
  const label: string = describeRunbookStep(after);

  if (after.isApproved && !before.isApproved) {
    return `Approved ${label}`;
  }

  if (before.status === after.status) {
    return null;
  }

  if (
    before.status === RunbookStepExecutionStatus.WaitingForUser &&
    after.status === RunbookStepExecutionStatus.Completed
  ) {
    return canStepTypeRequireApproval(after.type || undefined)
      ? `Approved ${label}`
      : `Completed ${label}`;
  }

  if (after.status === RunbookStepExecutionStatus.Skipped) {
    return `Skipped ${label}`;
  }

  if (after.status === RunbookStepExecutionStatus.Cancelled) {
    return `Cancelled ${label}`;
  }

  return `${capitalize(label)} went from ${describeRunbookStepStatus(
    before.status,
  )} to ${describeRunbookStepStatus(after.status)}`;
};

// An id two steps share names neither of them: null.
const indexById: (
  steps: Array<RunbookStepExecutionRead>,
) => Map<string, RunbookStepExecutionRead | null> = (
  steps: Array<RunbookStepExecutionRead>,
): Map<string, RunbookStepExecutionRead | null> => {
  const byId: Map<string, RunbookStepExecutionRead | null> = new Map<
    string,
    RunbookStepExecutionRead | null
  >();

  for (const step of steps) {
    if (step.id) {
      byId.set(step.id, byId.has(step.id) ? null : step);
    }
  }

  return byId;
};

/*
 * The step of `before` that is `step` of the list after: the one with its
 * id, or - for a step written without an id, or one whose id two steps
 * share - the one in its place. A run's list never gains, loses or moves a
 * step, so its place is the same in both.
 */
const findBefore: (data: {
  step: RunbookStepExecutionRead;
  before: Array<RunbookStepExecutionRead>;
  beforeById: Map<string, RunbookStepExecutionRead | null>;
}) => RunbookStepExecutionRead | undefined = (data: {
  step: RunbookStepExecutionRead;
  before: Array<RunbookStepExecutionRead>;
  beforeById: Map<string, RunbookStepExecutionRead | null>;
}): RunbookStepExecutionRead | undefined => {
  const byId: RunbookStepExecutionRead | null | undefined = data.step.id
    ? data.beforeById.get(data.step.id)
    : undefined;

  if (byId) {
    return byId;
  }

  return data.before.find((candidate: RunbookStepExecutionRead): boolean => {
    return candidate.number === data.step.number;
  });
};

export interface RunbookStepExecutionChanges {
  // One line per step that changed, in the run's order, cut to the limit.
  lines: Array<string>;
  // How many steps changed, before the lines were cut.
  totalChanges: number;
}

/*
 * What happened to a run's steps between two of its lists. A step the list
 * before did not have - which a run's list never gains - says where it
 * stands.
 */
export const getRunbookStepExecutionChanges: (data: {
  before: unknown;
  after: unknown;
  lineLimit?: number | undefined;
}) => RunbookStepExecutionChanges = (data: {
  before: unknown;
  after: unknown;
  lineLimit?: number | undefined;
}): RunbookStepExecutionChanges => {
  const before: Array<RunbookStepExecutionRead> = readRunbookStepExecutions(
    data.before,
  );
  const after: Array<RunbookStepExecutionRead> = readRunbookStepExecutions(
    data.after,
  );
  const beforeById: Map<string, RunbookStepExecutionRead | null> =
    indexById(before);
  const lines: Array<string> = [];

  for (const step of after) {
    const previous: RunbookStepExecutionRead | undefined = findBefore({
      step,
      before,
      beforeById,
    });

    const line: string | null = previous
      ? describeRunbookStepChange({ before: previous, after: step })
      : `${capitalize(describeRunbookStep(step))} is ${describeRunbookStepStatus(
          step.status,
        )}`;

    if (line) {
      lines.push(line);
    }
  }

  return {
    lines: limitLines({
      lines,
      limit: data.lineLimit || RUNBOOK_STEP_CHANGE_LINE_LIMIT,
      noun: "step change",
    }),
    totalChanges: lines.length,
  };
};

/*
 * "5 steps: 2 done, 1 waiting for a person, 2 pending": where a run's
 * steps stand, in a few words. "No steps" for a run with none.
 */
export const describeRunbookStepExecutions: (value: unknown) => string = (
  value: unknown,
): string => {
  const steps: Array<RunbookStepExecutionRead> =
    readRunbookStepExecutions(value);

  if (steps.length === 0) {
    return "No steps";
  }

  const counts: Map<string, number> = new Map<string, number>();

  for (const step of steps) {
    const word: string = describeRunbookStepStatus(step.status);
    counts.set(word, (counts.get(word) || 0) + 1);
  }

  // The known words in their order, then any other in the order first met.
  const order: Array<string> = [
    ...STATUS_WORDS.map((entry: [string, string]): string => {
      return entry[1];
    }),
    ...Array.from(counts.keys()),
  ];

  const parts: Array<string> = Array.from(new Set<string>(order))
    .filter((word: string): boolean => {
      return counts.has(word);
    })
    .map((word: string): string => {
      return `${counts.get(word)} ${word}`;
    });

  return `${steps.length} step${steps.length === 1 ? "" : "s"}: ${parts.join(", ")}`;
};

// A run's steps, one line each, for a run created or deleted.
export const listRunbookStepExecutions: (data: {
  value: unknown;
  lineLimit?: number | undefined;
}) => Array<string> = (data: {
  value: unknown;
  lineLimit?: number | undefined;
}): Array<string> => {
  const lines: Array<string> = readRunbookStepExecutions(data.value).map(
    (step: RunbookStepExecutionRead): string => {
      return `${capitalize(describeRunbookStep(step))}: ${describeRunbookStepStatus(
        step.status,
      )}`;
    },
  );

  return limitLines({
    lines,
    limit: data.lineLimit || RUNBOOK_STEP_CHANGE_LINE_LIMIT,
    noun: "step",
  });
};
