import {
  AI_READ_CARD_NOT_CHECKED_YET_LINES,
  AI_READ_CARD_VALUES,
  AI_READ_TABLE_LINES,
  AI_READ_TABLE_TITLES,
  AIActionFigure,
  AIActionSentence,
  AIActionTableCell,
  AIActionTableWords,
  aiActionFigure,
  aiActionSentence,
  aiActionTerm,
} from "../../../../Types/AI/AIActionWords";
import {
  AIChatCitationTargetType,
  AIChatWidget,
} from "../../../../Types/AI/AIChatTypes";
import { JSONObject } from "../../../../Types/JSON";
import { translationKey } from "../../../../Types/Translator";
import { getMonitorTypeTitle } from "./ReadCardWords";
import WidgetBuilder from "./WidgetBuilder";

/*
 * THE TABLE OF MONITORS query_monitors LEAVES, AS WORDS (issue #7394).
 *
 * "Which monitors are down right now?" leaves a card for each monitor the
 * model looked up and, under them, the table of the monitors it listed.
 * Since #7175 the cards are in the reader's language - "Deaktiviert",
 * "Eingehende Anfrage" - while the row under them said "Disabled" and
 * "Incoming Request" of the same monitor, under the English title
 * "Monitors (4)" and its English order line. The table says them as words
 * of Types/AI/AIActionWords now, the same words the card says:
 *
 *   - its title, what it lists and how many (the count a figure, written
 *     the reader's way), and the line under it, what it holds and in what
 *     order;
 *   - a monitor's type by the type picker's name for it, as the card's
 *     Type fact says it ("Docker Container" for Docker);
 *   - Disabled for a monitor whose monitoring is off, as the Monitors
 *     table and the card's line say it, never the status it was frozen at;
 *   - for a monitor nothing has checked yet, the Monitors table's words for
 *     why (Waiting for data, No results yet, ... - issue #8899), never the
 *     operational status it was created in.
 *
 * A monitor's name and a status the project named ("Offline") are data,
 * as written. The table stores the same words in English
 * (WidgetBuilder.table): the exports print them, and a Dashboard that
 * cannot read the words draws them.
 *
 * Plain data in, a table out - no reads - so the tool, its tests and the
 * offline browser fixture build it the same way.
 */

/*
 * What the table says for a monitor whose monitoring is off - its Status,
 * and the card's line under its name (AI_READ_CARD_LINES.disabled): the
 * Monitors table's word. The card names the status the monitor was frozen
 * at as its last one (AI_READ_CARD_FACTS.lastStatus).
 */
export const MONITORING_OFF_STATUS_TEXT: string = AI_READ_CARD_VALUES.disabled;

/*
 * What the line under the title says, on one line beside Open: about 40
 * English characters fit there on a 360px phone, and the line is cut
 * where it is longer.
 */
export const MONITOR_TABLE_PROBLEMS_ONLY_TEXT: string =
  AI_READ_TABLE_LINES.notOperationalOnly;
export const MONITOR_TABLE_ORDER_TEXT: string =
  AI_READ_TABLE_LINES.notOperationalFirst;
export const MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT: string =
  AI_READ_TABLE_LINES.notOperationalFirstDisabledLast;

export interface MonitorsTableData {
  // Only monitors whose status is not operational (problemsOnly).
  problemsOnly: boolean;
  /*
   * Only monitors in one status (monitorStatusName): the status, by the
   * name the project gave it.
   */
  statusName?: string | undefined;
  /*
   * The rows, as query_monitors lists them: each monitor's name, its type
   * (a MonitorType), its currentStatus, monitoringOff when its monitoring
   * is off, notCheckedYet - the Monitors table's words for why - when
   * nothing has checked it yet, and whatever else the row carries, kept as
   * given.
   */
  rows: Array<JSONObject>;
}

function isMonitoringOffRow(row: JSONObject): boolean {
  return row["monitoringOff"] === true;
}

/*
 * Why nothing has checked the row's monitor yet, in one of the card's
 * lines for it - anything else the row carries there is not said.
 */
function getNotCheckedYetText(row: JSONObject): string | undefined {
  const words: unknown = row["notCheckedYet"];

  return typeof words === "string" &&
    AI_READ_CARD_NOT_CHECKED_YET_LINES.includes(words)
    ? words
    : undefined;
}

// The table's title: what it lists, and how many.
function getTitle(data: MonitorsTableData): AIActionSentence {
  const count: AIActionFigure = aiActionFigure(data.rows.length);

  if (data.statusName) {
    return aiActionSentence(AI_READ_TABLE_TITLES.monitorsInStatus, {
      status: data.statusName,
      count,
    });
  }

  return aiActionSentence(
    data.problemsOnly
      ? AI_READ_TABLE_TITLES.monitorsWithProblems
      : AI_READ_TABLE_TITLES.monitors,
    { count },
  );
}

/*
 * The line under it: what it holds, or its order - Disabled ones said to
 * come last only when one is there, so the line stays short enough to be
 * read whole.
 */
function getDescription(data: MonitorsTableData): AIActionSentence {
  if (data.problemsOnly) {
    return aiActionSentence(MONITOR_TABLE_PROBLEMS_ONLY_TEXT);
  }

  return aiActionSentence(
    data.rows.some(isMonitoringOffRow)
      ? MONITOR_TABLE_ORDER_WITH_MONITORING_OFF_TEXT
      : MONITOR_TABLE_ORDER_TEXT,
  );
}

/*
 * A row's cells that are OneUptime's words: its type by the type picker's
 * name for it - a type it does not list is data, as stored - and Disabled
 * when its monitoring is off, or why nothing has checked it when nothing
 * has.
 */
function getCells(row: JSONObject): Record<string, AIActionTableCell> {
  const cells: Record<string, AIActionTableCell> = {};
  const type: unknown = row["type"];
  const typeTitle: string | null =
    typeof type === "string" ? getMonitorTypeTitle(type) : null;

  if (typeTitle) {
    cells["type"] = aiActionTerm(typeTitle);
  }

  const notCheckedYet: string | undefined = getNotCheckedYetText(row);

  if (isMonitoringOffRow(row)) {
    cells["currentStatus"] = aiActionTerm(MONITORING_OFF_STATUS_TEXT);
  } else if (notCheckedYet) {
    cells["currentStatus"] = aiActionSentence(notCheckedYet);
  }

  return cells;
}

export function getMonitorsTableWords(
  data: MonitorsTableData,
): AIActionTableWords {
  return {
    title: getTitle(data),
    description: getDescription(data),
    cells: data.rows.map(getCells),
  };
}

/*
 * The table itself, under the monitors' cards: each monitor by name, type
 * and status, with an Open to the Monitors list.
 */
export function getMonitorsTable(data: MonitorsTableData): AIChatWidget {
  return WidgetBuilder.table({
    words: getMonitorsTableWords(data),
    columns: [
      { key: "name", title: translationKey("Monitor"), type: "text" },
      { key: "type", title: translationKey("Type"), type: "text" },
      {
        key: "currentStatus",
        title: translationKey("Status"),
        type: "text",
      },
    ],
    rows: data.rows,
    link: { type: AIChatCitationTargetType.Monitors },
  });
}
