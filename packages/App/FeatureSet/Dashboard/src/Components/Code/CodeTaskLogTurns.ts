import {
  CODE_TASK_RECIPE_LABELS,
  CODE_TASK_STATE_COPY,
  QUEUED_LABEL,
} from "./CodeTaskCopy";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { CodeTaskState, CodeTaskTurnJSON } from "Common/Types/AI/CodeTask";
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

// A task's turns, in the order of its conversation.
export function getCodeTaskLogTurns(
  turns: ReadonlyArray<CodeTaskTurnJSON>,
): Array<CodeTaskLogTurn> {
  return turns.map((turn: CodeTaskTurnJSON, index: number): CodeTaskLogTurn => {
    const isQueued: boolean =
      turn.state === CodeTaskState.Working &&
      turn.status === AIRunStatus.Queued;

    const asked: string = getTurnSummaryLine(turn.request?.message || "");
    const recipe: string | undefined = CODE_TASK_RECIPE_LABELS[turn.recipe];

    return {
      runId: turn.runId,
      number: index + 1,
      stateLabel: isQueued
        ? QUEUED_LABEL
        : CODE_TASK_STATE_COPY[turn.state]?.label ?? turn.state,
      summary: asked || recipe || "",
      isSummaryTranslated: !asked && Boolean(recipe),
    };
  });
}

/*
 * The turn the page shows: the one its address names, when it is one of
 * the task's turns - else the task's first turn (the task's own id is its
 * first run's).
 */
export function getShownTurnRunId(data: {
  taskId: string;
  turnParam: string | null | undefined;
  turns?: ReadonlyArray<{ runId: string }> | undefined;
}): string {
  const turnParam: string = (data.turnParam || "").trim();

  if (!turnParam || !ObjectID.isValidUUID(turnParam)) {
    return data.taskId;
  }

  if (
    data.turns &&
    data.turns.length > 0 &&
    !data.turns.some((turn: { runId: string }): boolean => {
      return turn.runId.toLowerCase() === turnParam.toLowerCase();
    })
  ) {
    return data.taskId;
  }

  return turnParam;
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
