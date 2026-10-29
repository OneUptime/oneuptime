import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import AIRunEventType from "Common/Types/AI/AIRunEventType";
import {
  InvestigationLogStall,
  InvestigationLogStallReason,
  parseInvestigationLogStall,
} from "Common/Utils/AI/InvestigationLogStall";
import {
  PluralTemplate,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * AN INVESTIGATION THAT COULD NOT TELL THE CAUSE FOR LACK OF LOGS says so on
 * the AI card, under its report, with the way forward
 * (Utils/AI/InvestigationLogStall decides it on the server, from the run's
 * own log searches and whether any log reached OneUptime; the run records it
 * as an InvestigationStalled event):
 *
 *   No logs to read            no log reached OneUptime from the hour before
 *                              the record started: send the logs, and the
 *                              next investigation reads them - Set up logs;
 *   No logs about this ...     some did, and none of its searches found a
 *                              line about it: check every service sends its
 *                              logs, and let Logs AI find the failures the
 *                              code does not log - Set up logs, Find
 *                              unlogged failures.
 *
 * Kept free of React, so the wording and the reading are tested on their own.
 */

export type InvestigationLogStallSubject = "incident" | "alert";

export const INVESTIGATION_LOG_STALL_TEST_IDS: {
  notice: string;
  actions: string;
  setUpLogs: string;
  logsAi: string;
} = {
  notice: "investigation-log-stall",
  actions: "investigation-log-stall-actions",
  setUpLogs: "investigation-log-stall-set-up-logs",
  logsAi: "investigation-log-stall-logs-ai",
};

export interface InvestigationLogStallWords {
  title: string;
  // NoLogs: a sentence; NoMatchingLogs: the count's sentence.
  text: string | PluralTemplate;
}

export const INVESTIGATION_LOG_STALL_COPY: Record<
  InvestigationLogStallSubject,
  Record<InvestigationLogStallReason, InvestigationLogStallWords>
> = {
  incident: {
    [InvestigationLogStallReason.NoLogs]: {
      title: translationKey("No logs to read"),
      text: translationKey(
        "No logs reached OneUptime from the hour before this incident started, so OneUptime AI had none to read. Send your services' logs to OneUptime, and the next investigation can use them.",
      ),
    },
    [InvestigationLogStallReason.NoMatchingLogs]: {
      title: translationKey("No logs about this incident"),
      text: {
        one: "OneUptime AI searched the logs once and found nothing about this incident. Check that every service involved sends its logs to OneUptime, and let Logs AI find the failures your code does not log.",
        other:
          "OneUptime AI searched the logs {{count}} times and found nothing about this incident. Check that every service involved sends its logs to OneUptime, and let Logs AI find the failures your code does not log.",
      },
    },
  },
  alert: {
    [InvestigationLogStallReason.NoLogs]: {
      title: translationKey("No logs to read"),
      text: translationKey(
        "No logs reached OneUptime from the hour before this alert started, so OneUptime AI had none to read. Send your services' logs to OneUptime, and the next investigation can use them.",
      ),
    },
    [InvestigationLogStallReason.NoMatchingLogs]: {
      title: translationKey("No logs about this alert"),
      text: {
        one: "OneUptime AI searched the logs once and found nothing about this alert. Check that every service involved sends its logs to OneUptime, and let Logs AI find the failures your code does not log.",
        other:
          "OneUptime AI searched the logs {{count}} times and found nothing about this alert. Check that every service involved sends its logs to OneUptime, and let Logs AI find the failures your code does not log.",
      },
    },
  },
};

// The way forward: where logs are set up, and where Logs AI finds what is not logged.
export const INVESTIGATION_LOG_STALL_LINKS: {
  setUpLogs: string;
  logsAi: string;
} = {
  setUpLogs: translationKey("Set up logs"),
  logsAi: translationKey("Find unlogged failures"),
};

/*
 * What a run recorded about its logs: the newest InvestigationStalled
 * event's, read as the server wrote it, or null when it recorded none (an
 * investigation that found a line, or the cause, or a run from before
 * OneUptime recorded it) or wrote something that does not hold together.
 */
export function getInvestigationLogStall(
  events: ReadonlyArray<AIRunEvent>,
): InvestigationLogStall | null {
  for (let index: number = events.length - 1; index >= 0; index--) {
    const event: AIRunEvent | undefined = events[index];

    if (event?.eventType !== AIRunEventType.InvestigationStalled) {
      continue;
    }

    return parseInvestigationLogStall(event.resultSummary?.logStall);
  }

  return null;
}

// Whether the way forward offers Logs AI too: only when logs reach OneUptime.
export function offersLogsAi(stall: InvestigationLogStall): boolean {
  return stall.reason === InvestigationLogStallReason.NoMatchingLogs;
}
