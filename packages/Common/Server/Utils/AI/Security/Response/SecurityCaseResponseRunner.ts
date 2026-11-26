import AIRunStatus from "../../../../../Types/AI/AIRunStatus";
import AIRunEventType from "../../../../../Types/AI/AIRunEventType";
import OneUptimeDate from "../../../../../Types/Date";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityCaseHandOffReason } from "../../../../../Types/SecurityCase/SecurityCaseAi";
import Semaphore, {
  SemaphoreMutex,
} from "../../../../Infrastructure/Semaphore";
import AIRunEventService from "../../../../Services/AIRunEventService";
import AIRunService from "../../../../Services/AIRunService";
import logger from "../../../Logger";
import SecurityCaseAiHold from "../../../SecurityCase/SecurityCaseAiHold";
import SecurityCaseHandOff from "../../../SecurityCase/SecurityCaseHandOff";
import CaptureSpan from "../../../Telemetry/CaptureSpan";
import AIInvestigationQueue from "../../SRE/InvestigationQueue";
import SecurityCaseResponseLook, {
  LookOutcome,
} from "./SecurityCaseResponseLook";

/*
 * ONEUPTIME AI WORKING A SECURITY CASE: one run (AIRunType
 * SecurityCaseResponse, #10352), claimed by the AI queue
 * (InvestigationQueue) and run here - one look at the case
 * (SecurityCaseResponseLook).
 *
 * One write-capable run per case at a time: the starter queues one at a
 * time (SecurityCaseResponse), the queue's claim waits while another of the
 * case's runs executes, and the run holds the case's lock while it looks -
 * so even a run the stale sweep queued again while a server that lost its
 * heartbeat still worked never acts beside it. A server shutting down never
 * hands such a run back (InvestigationQueue.RUNS_NEVER_HANDED_BACK): what
 * it started goes on outside the attempt.
 *
 * A look that fails is tried again by the queue's retry policy - every
 * action is recorded before it starts, so the next attempt reads how each
 * went - and one that fails for good hands the case to people, saying
 * OneUptime AI could not tell what to do: it never stands down quietly.
 */

// The case's lock: as long as a look may take, renewed while it runs.
export const SECURITY_CASE_RESPONSE_LOCK_MS: number = 10 * 60 * 1000;
export const SECURITY_CASE_RESPONSE_LOCK_NAMESPACE: string =
  "SecurityCaseResponse";

export default class SecurityCaseResponseRunner {
  @CaptureSpan()
  public static async executeRun(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    securityCaseId: ObjectID;
    attemptCount: number;
  }): Promise<void> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.securityCaseId.toString(),
        namespace: SECURITY_CASE_RESPONSE_LOCK_NAMESPACE,
        lockTimeout: SECURITY_CASE_RESPONSE_LOCK_MS,
        acquireTimeout: 5000,
        onLockLost: (error: Error): void => {
          logger.error(
            `SecurityCaseResponseRunner: lost the lock of case ${data.securityCaseId.toString()} while looking at it: ${error.message}`,
          );
        },
      });
    } catch {
      // Another look at the case is under way: this one goes back to the queue.
      await AIInvestigationQueue.failOrRequeue({
        aiRunId: data.aiRunId,
        projectId: data.projectId,
        attemptCount: data.attemptCount,
        errorMessage:
          "OneUptime AI is already looking at this case in another run.",
        isPermanent: false,
      });
      return;
    }

    try {
      await this.recordEvent({
        ...data,
        eventType: AIRunEventType.RunStarted,
      });

      const outcome: LookOutcome = await SecurityCaseResponseLook.look({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
        aiRunId: data.aiRunId,
      });

      /*
       * A case OneUptime AI responds first to (#10353): whether this look
       * resolved it, asked a person, or handed it over ends its hold now,
       * not at the next minute's review. Never throws.
       */
      await SecurityCaseAiHold.reviewSoon({
        projectId: data.projectId,
        securityCaseId: data.securityCaseId,
      });

      const completed: number = await AIRunService.attemptStatusTransition({
        aiRunId: data.aiRunId,
        fromStatus: AIRunStatus.Running,
        expectedAttemptCount: data.attemptCount,
        set: {
          status: AIRunStatus.Completed,
          completedAt: OneUptimeDate.getCurrentDate(),
          lastHeartbeatAt: OneUptimeDate.getCurrentDate(),
          llmCallCount: 0,
          toolCallCount: outcome.carriedOut,
          totalTokens: 0,
        },
      });

      if (completed > 0) {
        await this.recordEvent({
          ...data,
          eventType: AIRunEventType.RunCompleted,
          message: this.describe(outcome),
        });
      }
    } catch (error) {
      const message: string =
        error instanceof Error ? error.message : String(error);

      logger.error(
        `SecurityCaseResponseRunner: the look at case ${data.securityCaseId.toString()} failed:`,
      );
      logger.error(error);

      const failed: "requeued" | "finalized" | "noop" =
        await AIInvestigationQueue.failOrRequeue({
          aiRunId: data.aiRunId,
          projectId: data.projectId,
          attemptCount: data.attemptCount,
          errorMessage: `OneUptime AI could not finish its look at the case: ${message}`,
          isPermanent: message.includes("Security case not found"),
          error,
        });

      // Out of attempts: the case is people's, and they are told.
      if (
        failed === "finalized" &&
        !message.includes("Security case not found")
      ) {
        await SecurityCaseHandOff.handToPeople({
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
          reason: SecurityCaseHandOffReason.CannotTell,
          aiRunId: data.aiRunId,
        });
      }
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (error) {
          logger.error(
            `SecurityCaseResponseRunner: could not release the lock of case ${data.securityCaseId.toString()}: ${error}`,
          );
        }
      }
    }
  }

  // What the look did, in a line, for the run's activity.
  public static describe(outcome: LookOutcome): string {
    if (outcome.handedOff) {
      return `Handed the case to people (${outcome.handedOff}).`;
    }

    // Handed to people before the look, or while it looked (#10816).
    if (outcome.isNoLongerWorking) {
      return outcome.carriedOut > 0
        ? `Carried out ${outcome.carriedOut} step(s), then stopped: the case was handed to people.`
        : "Did nothing: the case was handed to people.";
    }

    if (outcome.isFinished) {
      return "The case is closed.";
    }

    const waits: string =
      outcome.waits.length > 0
        ? ` Waiting for: ${outcome.waits.join(", ")}.`
        : "";

    return `Carried out ${outcome.carriedOut} step(s).${waits}`;
  }

  // Best-effort: the run's status says how it went either way.
  private static async recordEvent(data: {
    aiRunId: ObjectID;
    projectId: ObjectID;
    eventType: AIRunEventType;
    message?: string | undefined;
  }): Promise<void> {
    try {
      await AIRunEventService.appendEventToRun({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        eventType: data.eventType,
        resultSummary: data.message ? { message: data.message } : {},
        afterLastEvent: true,
      });
    } catch (error) {
      logger.error(
        `SecurityCaseResponseRunner: could not record ${data.eventType} on run ${data.aiRunId.toString()}: ${error}`,
      );
    }
  }
}
