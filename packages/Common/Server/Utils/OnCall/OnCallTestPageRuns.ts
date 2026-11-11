import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import { isOnCallDirectPage } from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import {
  OnCallEscalationWaitRun,
  getOnCallEscalationDueAt,
  isOnCallEscalationWaitOver,
} from "../../../Types/OnCallDutyPolicy/OnCallEscalationWait";
import {
  ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
  getOnCallTestPageEscalationWaitInMinutes,
  hasOnCallTestPageAnswerWindowPassed,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import OnCallEscalationAdvance from "./OnCallEscalationAdvance";

/*
 * A TEST PAGE'S RUN, ONCE A MINUTE (OnCallTestPage).
 *
 * The worker that moves runs on (OnCallDutyPolicyExecutionLog:
 * ExecutePendingExecutions) hands every test page that is still paging to
 * `tick`, before anything that reads a run's record - a test has none.
 *
 *   - A test that has waited its whole answer window ends, saying nobody
 *     acknowledged it. Somebody acknowledging it ends it before then, where
 *     they acknowledge (UserOnCallLogTimelineService.acknowledgePage).
 *   - A test of people, or of a policy's first level only, has nothing more
 *     to page: it waits.
 *   - A test that walks a policy's every level moves on to the next level
 *     once the level's wait - cut to a test's short wait - is over, in the
 *     one way any run moves on (OnCallEscalationAdvance), which never
 *     repeats a test's policy.
 */

export enum OnCallTestPageTick {
  // It ended: nobody acknowledged it in time.
  Ended = "Ended",
  // It moved on to its next level, or to its end.
  MovedOn = "MovedOn",
  // Nothing to do yet.
  Waiting = "Waiting",
}

export default class OnCallTestPageRuns {
  /*
   * `run` is the run as the worker reads it: its id, policy, when it was
   * created, the level it is on and when that started, and its test page
   * columns.
   */
  @CaptureSpan()
  public static async tick(data: {
    run: OnCallDutyPolicyExecutionLog;
    now: Date;
  }): Promise<OnCallTestPageTick> {
    const run: OnCallDutyPolicyExecutionLog = data.run;

    if (
      hasOnCallTestPageAnswerWindowPassed({
        startedAt: run.createdAt,
        at: data.now,
      })
    ) {
      await OnCallDutyPolicyExecutionLogService.updateOneById({
        id: run.id!,
        data: {
          status: OnCallDutyPolicyStatus.Completed,
          statusMessage: ON_CALL_TEST_PAGE_ENDED_UNANSWERED_MESSAGE,
        },
        props: {
          isRoot: true,
        },
      });

      return OnCallTestPageTick.Ended;
    }

    if (isOnCallDirectPage(run) || !run.testPageWalksEscalation) {
      return OnCallTestPageTick.Waiting;
    }

    const waitRun: OnCallEscalationWaitRun = this.getTestWait(run);

    if (!isOnCallEscalationWaitOver(waitRun, data.now)) {
      return OnCallTestPageTick.Waiting;
    }

    await OnCallEscalationAdvance.advance({
      run: run,
      now: data.now,
      dueAt: getOnCallEscalationDueAt(waitRun),
    });

    return OnCallTestPageTick.MovedOn;
  }

  /*
   * The wait a test's level holds: the level's own, cut to a test's short
   * wait (getOnCallTestPageEscalationWaitInMinutes).
   */
  public static getTestWait(
    run: OnCallDutyPolicyExecutionLog,
  ): OnCallEscalationWaitRun {
    return {
      lastEscalationRuleExecutedAt: run.lastEscalationRuleExecutedAt,
      createdAt: run.createdAt,
      executeNextEscalationRuleInMinutes:
        getOnCallTestPageEscalationWaitInMinutes(
          run.executeNextEscalationRuleInMinutes,
        ),
    };
  }
}
