import SecurityUserErasureRequest from "../../../../Models/DatabaseModels/SecurityUserErasureRequest";
import { readErasureRequestProgress } from "../../../Services/SecurityUserErasureRequestService";
import { SecurityUserErasureRequestStatus } from "../../../../Types/SecurityEvent/SecurityUserErasure";
import {
  SecurityUserErasureProgressLine,
  SecurityUserErasureStage,
} from "../../../../Types/SecurityEvent/SecurityUserErasureProgressLine";
import SecurityUserErasure, {
  DETECTION_TURN_SETTLE_MS,
  RETRY_BACKOFF_MS,
} from "./SecurityUserErasure";
import {
  SecurityUserErasureFindingsPass,
  SecurityUserErasureProgress,
} from "./SecurityUserErasureProgress";

/*
 * HOW FAR AN ERASURE REQUEST HAS GOT, AS ITS PAGE SAYS IT (#11232).
 *
 * The worker keeps where a request got to (SecurityUserErasureProgress,
 * read by nobody: its cursor holds a finding's _id). This works out, from
 * that and the request's own state, the one line the page shows under
 * Erasing (Types/SecurityEvent/SecurityUserErasureProgressLine):
 *
 *   - its last run failed: it tries again once its wait is over
 *     (RETRY_BACKOFF_MS for each failed run), and why it failed;
 *   - a pass of the Detection Findings is reading: which pass, the first
 *     that changes what names the person or the final check, and the time
 *     of the last finding it read - the read goes from the project's first
 *     finding to its last, so that time says how far it is;
 *   - every change is applied and nothing names the person: when the final
 *     check starts, once no detection that read the name can still be
 *     running (DETECTION_TURN_SETTLE_MS) - a short wait, not a stuck one;
 *   - told, and waiting for ClickHouse to apply it;
 *   - claimed, and nothing kept yet.
 *
 * Times only - a finding's time is when it was written, nobody's - and
 * never the finding's id. A time it waits for that has passed reads as now:
 * the next run, within a minute, gets to it.
 */

// Nanoseconds since the epoch, as text: what a finding's time is kept as.
const NANOSECONDS: RegExp = /^[0-9]{1,20}$/;

// A finding's time, nanoseconds since the epoch as text, as an ISO 8601 time; undefined when it is none.
function nanosecondsToIso(value: string | undefined): string | undefined {
  if (!value || !NANOSECONDS.test(value)) {
    return undefined;
  }

  const milliseconds: number = Number(BigInt(value) / BigInt(1000000));
  const date: Date = new Date(milliseconds);

  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

function timeOf(value: Date | string | undefined | null): number {
  if (!value) {
    return 0;
  }

  const time: number = new Date(value).getTime();

  return Number.isNaN(time) ? 0 : time;
}

// A time it waits for, as the page says it: now when it has passed.
function notBefore(time: number, now: Date): string {
  return new Date(Math.max(time, now.getTime())).toISOString();
}

/*
 * The line for an open request (Queued or Erasing), or null for one that is
 * over. See the file's comment.
 */
export function getErasureProgressLine(
  request: SecurityUserErasureRequest,
  now: Date,
): SecurityUserErasureProgressLine | null {
  if (!request.id) {
    return null;
  }

  const requestId: string = request.id.toString();

  if (request.status === SecurityUserErasureRequestStatus.Pending) {
    return { requestId, status: request.status, stage: null };
  }

  if (request.status !== SecurityUserErasureRequestStatus.InProgress) {
    return null;
  }

  const status: SecurityUserErasureRequestStatus =
    SecurityUserErasureRequestStatus.InProgress;

  if (SecurityUserErasure.didLastRunFail(request)) {
    return {
      requestId,
      status,
      stage: SecurityUserErasureStage.Retrying,
      retryAt: notBefore(
        timeOf(request.updatedAt) +
          Math.max(1, request.attempts || 0) * RETRY_BACKOFF_MS,
        now,
      ),
      failureReason: (request.failureReason || "").trim(),
    };
  }

  const progress: SecurityUserErasureProgress =
    readErasureRequestProgress(request);
  const pass: SecurityUserErasureFindingsPass | null = progress.findings;

  if (pass && !pass.endedAt) {
    const readUpTo: string | undefined = nanosecondsToIso(pass.after?.time);

    return {
      requestId,
      status,
      stage: pass.isFinal
        ? SecurityUserErasureStage.FinalCheck
        : SecurityUserErasureStage.ReadingFindings,
      pass: pass.number,
      ...(readUpTo ? { readUpTo } : {}),
    };
  }

  if (!pass && !progress.toldAt) {
    return { requestId, status, stage: SecurityUserErasureStage.Starting };
  }

  if (progress.cleanSince) {
    return {
      requestId,
      status,
      stage: SecurityUserErasureStage.WaitingForFinalCheck,
      finalCheckAt: notBefore(
        timeOf(progress.cleanSince) + DETECTION_TURN_SETTLE_MS,
        now,
      ),
    };
  }

  return { requestId, status, stage: SecurityUserErasureStage.Applying };
}
