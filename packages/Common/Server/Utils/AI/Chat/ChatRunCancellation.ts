import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import AIChatMessageStatus from "../../../../Types/AI/AIChatMessageStatus";
import AIRunEventType from "../../../../Types/AI/AIRunEventType";
import AIRunStatus from "../../../../Types/AI/AIRunStatus";
import AIRun from "../../../../Models/DatabaseModels/AIRun";
import AIRunEvent from "../../../../Models/DatabaseModels/AIRunEvent";
import AIConversationMessageService from "../../../Services/AIConversationMessageService";
import AIRunEventService from "../../../Services/AIRunEventService";
import AIRunService from "../../../Services/AIRunService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";

// Final message content and run error for a turn someone stopped.
export const STOPPED_BY_USER_TEXT: string = "Stopped by user.";

/*
 * The terminal event must sort after every progress event the runner
 * emitted — the same convention as the runner's own failure finalizer,
 * which starts its event sequence at 100000.
 */
export const CANCEL_EVENT_SEQUENCE: number = 100000;

export interface ChatRunCancellationResult {
  aiRunId: ObjectID;
  cancelled: boolean;
}

/*
 * Stops a conversation's in-flight turn — shared by the personal Ask AI chat
 * and an incident's shared investigation thread, so Stop behaves the same in
 * both. Flips the active run to Cancelled, finalizes its in-flight assistant
 * message as "Stopped by user." and emits a terminal run event so the
 * polling UI sees closure.
 *
 * Every write is guarded on the row's current status, so racing the runner
 * is safe: whichever side finalizes first wins and the loser's write matches
 * zero rows (the runner also checks for cancellation cooperatively between
 * its steps). Cancelling is also what releases the conversation for its
 * next question — sends only block on Running/WaitingForApproval runs.
 *
 * Returns null when nothing is in flight. The caller has already checked
 * the requester may see this conversation.
 */
export default class ChatRunCancellation {
  public static async cancelActiveRun(data: {
    projectId: ObjectID;
    conversationId: ObjectID;
    userId: ObjectID;
  }): Promise<ChatRunCancellationResult | null> {
    /*
     * The conversation's live run: actively generating (Running) or paused
     * for approval (WaitingForApproval). The per-conversation governor
     * allows at most one, so no sort is needed.
     */
    const activeRun: AIRun | null = await AIRunService.findOneBy({
      query: {
        conversationId: data.conversationId,
        projectId: data.projectId,
        status: QueryHelper.any([
          AIRunStatus.Running,
          AIRunStatus.WaitingForApproval,
        ]),
      },
      select: { _id: true },
      props: { isRoot: true },
    });

    if (!activeRun) {
      return null;
    }

    /*
     * Status-guarded finalization, the same shape as the runner's own
     * finalizer: only a still-in-flight run is flipped, so a run the runner
     * completed (or errored) inside the race window is never overwritten.
     * updateOneBy returns the matched-row count — zero from both guards
     * means the other side won and already wrote the final state.
     */
    let cancelledRunCount: number = 0;

    for (const inFlightRunStatus of [
      AIRunStatus.Running,
      AIRunStatus.WaitingForApproval,
    ]) {
      cancelledRunCount += await AIRunService.updateOneBy({
        query: {
          _id: activeRun.id!.toString(),
          status: inFlightRunStatus,
        },
        data: {
          status: AIRunStatus.Cancelled,
          completedAt: OneUptimeDate.getCurrentDate(),
          errorMessage: STOPPED_BY_USER_TEXT,
          // A cancelled turn must never be resumable.
          pausedState: null,
        } as never,
        props: { isRoot: true },
      });
    }

    /*
     * Finalize the run's in-flight assistant message the same guarded way:
     * a message another path already finalized — completed with its full
     * answer, or errored — keeps what it has.
     */
    for (const inFlightMessageStatus of [
      AIChatMessageStatus.InProgress,
      AIChatMessageStatus.WaitingForApproval,
    ]) {
      await AIConversationMessageService.updateOneBy({
        query: {
          aiRunId: activeRun.id!,
          status: inFlightMessageStatus,
        },
        data: {
          status: AIChatMessageStatus.Cancelled,
          contentInMarkdown: STOPPED_BY_USER_TEXT,
        } as never,
        props: { isRoot: true },
      });
    }

    /*
     * Terminal event, only when this request actually took the run —
     * emitting closure over a turn the runner finished would tell the UI a
     * completed answer failed. RunFailed is the event enum's terminal "did
     * not finish" member; the summary carries the human reason.
     */
    if (cancelledRunCount > 0) {
      try {
        const cancelEvent: AIRunEvent = new AIRunEvent();
        cancelEvent.projectId = data.projectId;
        cancelEvent.aiRunId = activeRun.id!;
        cancelEvent.userId = data.userId;
        cancelEvent.sequence = CANCEL_EVENT_SEQUENCE;
        cancelEvent.eventType = AIRunEventType.RunFailed;
        cancelEvent.resultSummary = { errorMessage: STOPPED_BY_USER_TEXT };

        await AIRunEventService.create({
          data: cancelEvent,
          props: { isRoot: true },
        });
      } catch (error) {
        // Events are progress telemetry — never fail the cancel over them.
        logger.error(
          `Failed to emit AI chat cancel event: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }

    return { aiRunId: activeRun.id!, cancelled: cancelledRunCount > 0 };
  }
}
