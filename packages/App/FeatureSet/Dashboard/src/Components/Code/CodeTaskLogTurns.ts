import {
  CODE_TASK_RECIPE_LABELS,
  CODE_TASK_STATE_COPY,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import {
  CodeTaskLinkedTurnJSON,
  CodeTaskState,
  CodeTaskTurnJSON,
} from "Common/Types/AI/CodeTask";
import AIRunStatus from "Common/Types/AI/AIRunStatus";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * WHICH TURN A TASK'S LOG PAGE SHOWS, AND THE OTHERS ONE PICK AWAY.
 *
 * A task's Log page in Code is the verbatim record of one of its turns (one
 * code-fix run): the `turn` query parameter names it, and without one it
 * is the task's first. The conversation links each turn's Log; the page
 * itself lists the task's turns in a picker, so the record of another turn
 * is one pick away rather than a trip back to the conversation and down to
 * that turn's Log link.
 *
 * Each turn is named by its place in the conversation and how it ended -
 * "Turn 2 · Failed" - with what was asked (or, for a turn nobody asked for
 * in Code, what started it) under it.
 *
 * A long task's page reads its first turn and its newest. A link can name
 * a turn between them - shared in chat, or bookmarked when the task was
 * shorter - and the page asks for that turn by name, shows its record and
 * lists it at its place (issue #7130). A link that names a run of another
 * task shows the task's first turn, and says so.
 *
 * React-free, so the page and the tests read one rule.
 */

// The picker's own words.
export const CODE_TASK_LOG_TURN_COPY: {
  label: string;
  option: string;
} = {
  // What the picker is, read out with the menu.
  label: translationKey("Turn"),
  // An option: "Turn 2".
  option: translationKey("Turn {{number}}"),
};

// The longest summary an option shows under its name.
export const MAX_TURN_SUMMARY_LENGTH: number = 120;

/*
 * The page's own sentences about the record under the picker. A task of
 * one turn's record is the task's, so they say "this task"; once the
 * picker lists more than one turn, the record is the turn picked, so they
 * say "this turn" - never "Every step this task took" over the record of
 * its second turn alone.
 */
export interface CodeTaskLogRecordCopy {
  // The Session Log card, while the turn is still working.
  stepsSoFar: string;
  // ... once it is done.
  steps: string;
  // The Session Log's empty state, while the turn is still working.
  nothingYet: string;
  // ... once it is done.
  nothing: string;
  // The LLM Calls card.
  calls: string;
}

export const CODE_TASK_LOG_TASK_RECORD_COPY: CodeTaskLogRecordCopy = {
  stepsSoFar: translationKey(
    "Every step this task has taken so far. New steps show as they happen.",
  ),
  steps: translationKey(
    "Every step this task took, in order. Expand a step to see what the model was sent and what it said.",
  ),
  nothingYet: translationKey(
    "This task has not reported a step yet. This page updates on its own.",
  ),
  nothing: translationKey(
    "This task recorded no steps. If it failed before starting, the reason is in the conversation.",
  ),
  calls: translationKey(
    "Each model call this task made, with its tokens and timing.",
  ),
};

export const CODE_TASK_LOG_TURN_RECORD_COPY: CodeTaskLogRecordCopy = {
  stepsSoFar: translationKey(
    "Every step this turn has taken so far. New steps show as they happen.",
  ),
  steps: translationKey(
    "Every step this turn took, in order. Expand a step to see what the model was sent and what it said.",
  ),
  nothingYet: translationKey(
    "This turn has not reported a step yet. This page updates on its own.",
  ),
  nothing: translationKey(
    "This turn recorded no steps. If it failed before starting, the reason is in the conversation.",
  ),
  calls: translationKey(
    "Each model call this turn made, with its tokens and timing.",
  ),
};

// The record's sentences for a task of this many turns.
export function getCodeTaskLogRecordCopy(
  turnCount: number,
): CodeTaskLogRecordCopy {
  return turnCount > 1
    ? CODE_TASK_LOG_TURN_RECORD_COPY
    : CODE_TASK_LOG_TASK_RECORD_COPY;
}

export interface CodeTaskLogTurn {
  runId: string;
  // Its place in the conversation, from 1.
  number: number;
  // How it stands, as the conversation's badge says it (a translation key).
  stateLabel: string;
  /*
   * What was asked in it - the first line of the request, as written - or,
   * for a turn nobody asked for in Code, its recipe's name (a translation
   * key: isSummaryTranslated).
   */
  summary: string;
  isSummaryTranslated: boolean;
}

// The first line of what was asked, cut to fit under an option's name.
export function getTurnSummaryLine(message: string): string {
  const firstLine: string = (message || "").trim().split("\n")[0]!.trim();

  if (firstLine.length <= MAX_TURN_SUMMARY_LENGTH) {
    return firstLine;
  }

  return `${firstLine.substring(0, MAX_TURN_SUMMARY_LENGTH - 1).trimEnd()}…`;
}

/*
 * A task's turns, in the order of its conversation. A long task's page
 * holds its first turn and its newest: the `turnsNotShown` between them
 * still count, so each newer turn keeps its place - "Turn 1", then
 * "Turn 7" when five are not shown.
 */
export function getCodeTaskLogTurns(
  turns: ReadonlyArray<CodeTaskTurnJSON>,
  turnsNotShown: number = 0,
): Array<CodeTaskLogTurn> {
  const skipped: number =
    Number.isInteger(turnsNotShown) && turnsNotShown > 0 ? turnsNotShown : 0;

  return turns.map((turn: CodeTaskTurnJSON, index: number): CodeTaskLogTurn => {
    return toCodeTaskLogTurn(turn, index === 0 ? 1 : index + 1 + skipped);
  });
}

// One turn, as the picker names it, at its place in the task.
export function toCodeTaskLogTurn(
  turn: CodeTaskTurnJSON,
  number: number,
): CodeTaskLogTurn {
  const isQueued: boolean =
    turn.state === CodeTaskState.Working && turn.status === AIRunStatus.Queued;

  const asked: string = getTurnSummaryLine(turn.request?.message || "");
  const recipe: string | undefined = CODE_TASK_RECIPE_LABELS[turn.recipe];

  return {
    runId: turn.runId,
    number,
    stateLabel: isQueued
      ? QUEUED_LABEL
      : CODE_TASK_STATE_COPY[turn.state]?.label ?? turn.state,
    summary: asked || recipe || "",
    isSummaryTranslated: !asked && Boolean(recipe),
  };
}

/*
 * One entry of the page's turn picker: a turn, or a line - never picked -
 * where turns between two listed ones are not listed ("7 earlier turns
 * are not shown").
 */
export type CodeTaskLogPickerEntry =
  | { kind: "turn"; turn: CodeTaskLogTurn }
  | { kind: "turnsNotShown"; count: number };

/*
 * The picker's entries, in the order of the task: the turns its page
 * shows, a turn not shown that the address names (`linkedTurn`) at its
 * place, and a line wherever turns between two listed ones are not listed.
 * Turn 1 then Turn 9 reads as the task's numbering, not as turns gone
 * missing; a turn named between them splits the line in two.
 */
export function getCodeTaskLogPickerEntries(data: {
  turns: ReadonlyArray<CodeTaskTurnJSON>;
  turnsNotShown?: number | undefined;
  linkedTurn?: CodeTaskLinkedTurnJSON | null | undefined;
}): Array<CodeTaskLogPickerEntry> {
  const listed: Array<CodeTaskLogTurn> = getCodeTaskLogTurns(
    data.turns,
    data.turnsNotShown || 0,
  );

  const linked: CodeTaskLinkedTurnJSON | null | undefined = data.linkedTurn;

  if (
    linked &&
    Number.isInteger(linked.number) &&
    linked.number > 1 &&
    !listed.some((turn: CodeTaskLogTurn): boolean => {
      return turn.runId.toLowerCase() === linked.turn.runId.toLowerCase();
    })
  ) {
    listed.push(toCodeTaskLogTurn(linked.turn, linked.number));
    listed.sort((left: CodeTaskLogTurn, right: CodeTaskLogTurn): number => {
      return left.number - right.number;
    });
  }

  const entries: Array<CodeTaskLogPickerEntry> = [];

  listed.forEach((turn: CodeTaskLogTurn, index: number): void => {
    const before: CodeTaskLogTurn | undefined = listed[index - 1];
    const notListed: number = before ? turn.number - before.number - 1 : 0;

    if (notListed > 0) {
      entries.push({ kind: "turnsNotShown", count: notListed });
    }

    entries.push({ kind: "turn", turn });
  });

  return entries;
}

// The turn an address names, as the page keys it: its run id in lower case, or "" for none.
export function getCodeTaskLogTurnKey(
  turnParam: string | null | undefined,
): string {
  const turn: string = (turnParam || "").trim();

  return turn && ObjectID.isValidUUID(turn) ? turn.toLowerCase() : "";
}

// What the page knows of a task's turns, as read.
export interface CodeTaskLogTurnsRead {
  turns: ReadonlyArray<{ runId: string }>;
  linkedTurn?: { turn: { runId: string } } | null | undefined;
}

/*
 * Whether a task as read holds the turn an address names (getCodeTaskLogTurnKey):
 * one of the turns its page shows, the turn not shown it was asked for, or
 * none named - the first.
 */
export function isCodeTaskLogTurnOf(
  task: CodeTaskLogTurnsRead,
  turnKey: string,
): boolean {
  if (!turnKey) {
    return true;
  }

  return (
    task.turns.some((turn: { runId: string }): boolean => {
      return turn.runId.toLowerCase() === turnKey;
    }) || task.linkedTurn?.turn.runId.toLowerCase() === turnKey
  );
}

// The turn the page shows, and whether it may show it yet.
export interface CodeTaskLogShownTurn {
  // The turn whose record the page reads.
  runId: string;
  /*
   * Whether the record may be shown: not while the task is read to tell
   * whether the turn the address names is one of its own - so a record of
   * another task's run is never shown under this task, not even while the
   * task is read.
   */
  isKnown: boolean;
  /*
   * The address names a run that is not one of the task's turns - or
   * something that is no run's id at all: the page shows the task's first
   * turn instead, and says so.
   */
  isNotOfTask: boolean;
}

/*
 * The turn the page shows: the one its address names, once the task's
 * read says it is one of the task's turns - shown, or not shown and asked
 * for by name; the task's first turn when the read says it is not (the
 * task's own id is its first run's). While the task is read, the named
 * turn's record is read too but not shown. A task that could not be read
 * leaves the address as it is: the record's own read decides who may see
 * it. A `turn` that is no run's id at all - a link cut short when it was
 * pasted, a typo - names no turn of any task: the first turn, said so at
 * once, with nothing to ask.
 */
export function getCodeTaskLogShownTurn(data: {
  taskId: string;
  turnParam: string | null | undefined;
  // The task as read, and the address's turn it was read for ("" for none).
  task?: CodeTaskLogTurnsRead | null | undefined;
  taskReadFor?: string | null | undefined;
  // The task's read for this address failed.
  hasTaskReadFailed?: boolean | undefined;
}): CodeTaskLogShownTurn {
  const turnKey: string = getCodeTaskLogTurnKey(data.turnParam);
  const turnParam: string = (data.turnParam || "").trim();

  if (!turnParam) {
    return { runId: data.taskId, isKnown: true, isNotOfTask: false };
  }

  // Never silently somewhere else (issue #7130), not even for a broken link.
  if (!turnKey) {
    return { runId: data.taskId, isKnown: true, isNotOfTask: true };
  }

  // The task's own first turn, by its id: nothing to ask.
  if (turnKey === data.taskId.toLowerCase()) {
    return { runId: turnParam, isKnown: true, isNotOfTask: false };
  }

  if (data.task) {
    if (isCodeTaskLogTurnOf(data.task, turnKey)) {
      return { runId: turnParam, isKnown: true, isNotOfTask: false };
    }

    if (data.taskReadFor === turnKey) {
      return { runId: data.taskId, isKnown: true, isNotOfTask: true };
    }
  }

  if (data.hasTaskReadFailed) {
    return { runId: turnParam, isKnown: true, isNotOfTask: false };
  }

  return { runId: turnParam, isKnown: false, isNotOfTask: false };
}

// The Log page at one of a task's turns.
export function getCodeTaskLogTurnRoute(data: {
  taskId: string;
  runId: string;
}): Route {
  return new Route(
    RouteUtil.populateRouteParams(
      RouteMap[PageMap.CODE_TASK_VIEW_LOG] as Route,
      { modelId: new ObjectID(data.taskId) },
    ).toString(),
  ).addQueryParams({ turn: data.runId });
}
