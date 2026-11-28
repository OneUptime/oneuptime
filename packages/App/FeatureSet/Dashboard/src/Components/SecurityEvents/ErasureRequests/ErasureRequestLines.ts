import {
  ERASED_AT,
  ERASING_LINE,
  FAILED_LINE,
  FINAL_CHECK_LINE,
  FINAL_CHECK_STARTED_LINE,
  FINAL_CHECK_STARTS_LINE,
  QUEUED_LINE,
  READING_FINDINGS_LINE,
  READING_FINDINGS_STARTED_LINE,
  RETRYING_LINE,
  RETRYING_WITHOUT_REASON_LINE,
  STARTING_LINE,
  getErasureStatus,
} from "./ErasureRequestCopy";
import SecurityUserErasureRequest from "Common/Models/DatabaseModels/SecurityUserErasureRequest";
import OneUptimeDate from "Common/Types/Date";
import { SecurityUserErasureRequestStatus } from "Common/Types/SecurityEvent/SecurityUserErasure";
import {
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
} from "Common/Types/SecurityEvent/SecurityUserErasureProgressLine";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * The line under an erasure request's state on Security Events > Erasure
 * Requests (#10908, #11232), put into the reader's words: when it starts,
 * how far it has got, when it was done, why it failed. ErasureStatusCell
 * draws it. React-free, as ErasureRequestCopy is, so the App's tests read
 * every language's line without the Dashboard's packages
 * (AppTestsLoadDashboardWithoutItsPackages).
 */

/*
 * The soonest a time the request waits for is said to be: the worker runs
 * every minute, so a time that has passed, or is about to, is the next run's.
 */
const NEXT_RUN_IN_MS: number = 60 * 1000;

function fromNowAtTheEarliest(time: string, now: Date): string {
  return OneUptimeDate.fromNow(
    new Date(
      Math.max(new Date(time).getTime(), now.getTime() + NEXT_RUN_IN_MS),
    ),
    now,
  );
}

/*
 * How far an Erasing request has got (#11232), from the line the server
 * worked out of it: null when there is none to say, and the page says it
 * is waiting for the last of it to be applied.
 */
export function writeErasingLine(
  translator: Translator,
  progress: SecurityUserErasureProgressLine | undefined,
  now: Date,
): string | null {
  if (
    !progress ||
    progress.status !== SecurityUserErasureRequestStatus.InProgress
  ) {
    return null;
  }

  const pass: string = translator.formatNumber(progress.pass || 1);
  const date: string | null = progress.readUpTo
    ? OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(progress.readUpTo)
    : null;

  switch (progress.stage) {
    case SecurityUserErasureStage.Starting:
      return translator.translateText(STARTING_LINE) || STARTING_LINE;
    case SecurityUserErasureStage.Applying:
      return translator.translateText(ERASING_LINE) || ERASING_LINE;
    case SecurityUserErasureStage.ReadingFindings:
      return date
        ? translator.translateTemplate(READING_FINDINGS_LINE, { pass, date })
        : translator.translateTemplate(READING_FINDINGS_STARTED_LINE, {
            pass,
          });
    case SecurityUserErasureStage.FinalCheck:
      return date
        ? translator.translateTemplate(FINAL_CHECK_LINE, { date })
        : translator.translateText(FINAL_CHECK_STARTED_LINE) ||
            FINAL_CHECK_STARTED_LINE;
    case SecurityUserErasureStage.WaitingForFinalCheck:
      return progress.finalCheckAt
        ? translator.translateTemplate(FINAL_CHECK_STARTS_LINE, {
            time: fromNowAtTheEarliest(progress.finalCheckAt, now),
          })
        : null;
    case SecurityUserErasureStage.Retrying: {
      const time: string = fromNowAtTheEarliest(
        progress.retryAt || now.toISOString(),
        now,
      );

      return progress.failureReason
        ? translator.translateTemplate(RETRYING_LINE, {
            reason: progress.failureReason,
            time,
          })
        : translator.translateTemplate(RETRYING_WITHOUT_REASON_LINE, { time });
    }
    default:
      return null;
  }
}

/*
 * The line under a request's state: when it starts, how far it has got (the
 * server's line for it, #11232), when it was done, why it failed.
 */
export function writeErasureStatusLine(
  translator: Translator,
  request: SecurityUserErasureRequest,
  progress?: SecurityUserErasureProgressLine | undefined,
  now: Date = OneUptimeDate.getCurrentDate(),
): string {
  switch (getErasureStatus(request)) {
    case SecurityUserErasureRequestStatus.InProgress:
      return (
        writeErasingLine(translator, progress, now) ||
        translator.translateText(ERASING_LINE) ||
        ERASING_LINE
      );
    case SecurityUserErasureRequestStatus.Completed:
      return request.completedAt
        ? translator.translateTemplate(ERASED_AT, {
            time: OneUptimeDate.fromNow(request.completedAt),
          })
        : "";
    case SecurityUserErasureRequestStatus.Failed:
      return translator.translateTemplate(FAILED_LINE, {
        reason: (request.failureReason || "").trim(),
      });
    default:
      return translator.translateText(QUEUED_LINE) || QUEUED_LINE;
  }
}
