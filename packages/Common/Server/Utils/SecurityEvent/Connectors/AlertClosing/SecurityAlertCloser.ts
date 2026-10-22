import SecurityCaseVerdict from "../../../../../Types/SecurityCase/SecurityCaseVerdict";
import { SecurityConnectorSettings } from "../Types";

/*
 * Closing the loop with the products a case's alerts came from: when a
 * security case is closed in OneUptime, the alerts that opened it are
 * closed in their own product too, with the case's verdict and closing
 * note, so a team working in both does the work once
 * (SecurityCaseSourceAlerts). A product OneUptime can close alerts in has a
 * closer here and the "Close alerts when their case closes" option in its
 * connector catalog entry; a connection closes alerts only with the option
 * on.
 */

// What the case says about its alerts as it closes.
export interface SourceAlertClosing {
  verdict: SecurityCaseVerdict;
  closingNote: string;
  // "CASE-42".
  caseLabel: string;
  caseUrl: string;
}

export interface SourceAlertCloseResult {
  // Alerts the product closed.
  closed: number;
  // Alerts the product does not have, or that are not alerts there.
  notFound: number;
  // Alerts the product refused to close, one by one.
  refused: number;
  // Alerts not tried, because the closing stopped first.
  notTried: number;
  // Why the closing stopped before the last alert; "" when it did not.
  failure: string;
  // Whether trying again later can close the rest: rate limited, unreachable, a 5xx.
  retryable: boolean;
}

export interface SecurityAlertCloser {
  closeAlerts(data: {
    settings: SecurityConnectorSettings;
    // The product's own ids of the alerts, as their events carry them (eventUid).
    alertIds: Array<string>;
    closing: SourceAlertClosing;
  }): Promise<SourceAlertCloseResult>;
}

// The most alerts one case closes in one product, so one case cannot flood it.
export const SOURCE_ALERTS_PER_CLOSE_LIMIT: number = 200;

// The comment a product's alert is closed with, at most this long.
export const SOURCE_ALERT_COMMENT_MAX_LENGTH: number = 1000;

/*
 * What the closed alert is told, the same for every product: where it was
 * closed, the verdict, the closing note and the link back to the case.
 */
export function sourceAlertClosingComment(closing: SourceAlertClosing): string {
  const note: string = closing.closingNote.trim();
  const head: string = `Closed in OneUptime with ${closing.caseLabel || "its security case"} as ${closing.verdict}.`;
  const tail: string = closing.caseUrl ? ` ${closing.caseUrl}` : "";
  const room: number =
    SOURCE_ALERT_COMMENT_MAX_LENGTH - head.length - tail.length - 1;
  const body: string =
    note && room > 1
      ? ` ${note.length > room ? `${note.slice(0, room - 1)}…` : note}`
      : "";

  return `${head}${body}${tail}`;
}

export function emptySourceAlertCloseResult(): SourceAlertCloseResult {
  return {
    closed: 0,
    notFound: 0,
    refused: 0,
    notTried: 0,
    failure: "",
    retryable: false,
  };
}
