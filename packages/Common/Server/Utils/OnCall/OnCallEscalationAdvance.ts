import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { getOnCallPolicyRepeatsAllowed } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import { isOnCallPageLineReached } from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import {
  ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE,
  isOnCallTestPage,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallRuleExecutionOutcome,
  PageContext,
} from "../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../Services/OnCallDutyPolicyExecutionLogTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import Select from "../../Types/Database/Select";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";
import { NotificationSchedule } from "../Telemetry/NotificationDeliveryMetrics";
import { toOnCallPolicyRunStatusMessage } from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import OnCallRunFailure from "./OnCallRunFailure";
import OnCallSendLag, { OnCallScheduledSend } from "./OnCallSendLag";
import OnCallPageTiming from "./OnCallPageTiming";
import { OnCallLevelInFlight } from "./OnCallLevelsInFlight";
import OnCallMoveOnsInFlight, {
  OnCallMoveOnInFlight,
} from "./OnCallMoveOnsInFlight";
import {
  getOnCallLevelsBefore,
  getOnCallPolicyFirstLevel,
  getOnCallRunLaterLevels,
  isOnCallRunPastFirstLevel,
  OnCallRunPlace,
  sortOnCallPolicyLevels,
} from "../../../Types/OnCallDutyPolicy/OnCallRunLevel";

/*
 * MOVING AN ON-CALL POLICY'S RUN ON TO ITS NEXT ESCALATION RULE.
 *
 * A run pages its first escalation rule when it starts, then waits the
 * rule's "Escalate after" for somebody to acknowledge. Three things move it
 * on, and all of them come here, so a run moves on in one way only:
 *
 * - the worker (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions),
 *   every minute, once the wait has run out;
 * - the person being paged passing the page on (OnCallPagePassOn), straight
 *   away, when nobody else on the current rule is left to take it;
 * - the run itself, straight away, when the rule it starts with pages
 *   nobody (moveOnAtOnce): there is nobody to wait for.
 *
 * Moving on is CLAIMED first: one atomic conditional UPDATE of the run
 * (claimEscalationAdvance), so a pass and a worker tick that land in the same
 * moment - or two people passing at once, or two worker replicas - move the
 * run on once, and page the next rule once. Whoever loses the claim does
 * nothing.
 *
 * Then: the rule after the one the run is on is paged. With none after it,
 * the policy starts again from its first rule if its Repeat Policy repeats
 * (getOnCallPolicyRepeatsAllowed), and otherwise the run ends - "nobody
 * acknowledged", "nobody was notified", or, when everybody it paged passed
 * the page on, "everybody it paged passed it on".
 *
 * A LEVEL WITH NOBODY TO PAGE IS PASSED AT ONCE (Types/OnCallDutyPolicy/
 * OnCallEmptyLevel). A rule that reached nobody - it names nobody, its
 * teams are empty, nobody is on call in its schedules, everybody it names is
 * away, has left, has passed the page on or cannot be reached - holds no
 * wait: the run moves past it at once (OnCallRuleExecutionOutcome.
 * movesOnAtOnce), claiming again for each such rule. So a policy whose Level
 * 1 has nobody pages Level 2 the moment it starts, not Level 1's wait later.
 *
 * A PASS THAT REACHED NOBODY IS NOT REPEATED. When the run comes to the end
 * of its rules and not one rule of the pass it is in reached anybody, going
 * round again at once would page nobody again, and going round with waits
 * would only wait: the run ends there, saying nobody was paged. A pass that
 * reached somebody repeats as its policy says.
 *
 * A LATER LEVEL PICKED BY THE PERSON ESCALATING. Somebody who escalates their
 * page may pick which later level to page (OnCallPagePassOn's level choice):
 * the run moves on to that level instead of the next, and each level
 * between gets a line on its timeline saying the page was escalated past it
 * (ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE) - written after the
 * claim, so once. From the level picked the run goes on as from any: its
 * wait, then the level after it, then the policy's Repeat Policy, whose next
 * pass starts from the first level again, skipping nothing. A rule that is
 * no longer a later level of the run's policy - deleted, moved up, or
 * another policy's - is not paged: the run moves on to its next level, as
 * it would have.
 *
 * WHAT IT PAGES IS TIMED FROM WHEN IT WAS DUE (OnCallSendLag,
 * notification.send.lag): the moment the wait ran out, for the worker's
 * move on, or now, for a person's. A level it moves on to at once, finding
 * nobody before it, was due at the same moment. A move on inside a page's
 * start (moveOnAtOnce, as a run starts) is timed by the page's start.
 *
 * THE NEXT LEVEL IS READ FROM THE POLICY'S LEVELS AS THEY ARE NOW
 * (OnCallRunLevel, issue #9036): the first level after the place of the
 * level the run is on - so a level added, moved or deleted before it while
 * it paged neither skips a level nor pages its own again, and gaps in the
 * numbering skip nothing, nor do two levels at one place (the second comes
 * after the first, by id). A run whose level was deleted under it (its rule
 * cleared, ON DELETE SET NULL; its place kept) has waited out the wait that
 * level started, and goes on to the first level after that place. A
 * level deleted between being read here and being paged is passed, as one
 * that reached nobody is, rather than ending the run in error. A new pass
 * starts from the policy's first level now, whatever its number.
 */

export enum OnCallEscalationAdvanceKind {
  // Somebody else moved the run on first: nothing was done.
  NotClaimed = "NotClaimed",
  // The next escalation rule was paged.
  RuleStarted = "RuleStarted",
  // The last rule was done, and the policy started again from its first.
  PolicyStartedAgain = "PolicyStartedAgain",
  // Nothing was left: the run ended.
  Ended = "Ended",
}

export interface OnCallEscalationAdvanceRule {
  id: ObjectID;
  order: number;
  name?: string | undefined;
}

export interface OnCallEscalationAdvanceResult {
  kind: OnCallEscalationAdvanceKind;
  // RuleStarted, PolicyStartedAgain: the rule the run is on now.
  rule?: OnCallEscalationAdvanceRule | undefined;
  // Who that rule paged, in the order it paged them.
  pagedUserIds: Array<ObjectID>;
  // Ended: the status and the message the run ended with.
  endedWithStatus?: OnCallDutyPolicyStatus | undefined;
  endedWithMessage?: string | undefined;
}

/*
 * A level the run moved on to: paged, with what came of it - or found
 * deleted between being read and being paged, so passed (issue #9036).
 */
type OnCallLevelStart =
  | { isGone: false; outcome: OnCallRuleExecutionOutcome | undefined }
  | { isGone: true };

/*
 * What a run that went through every rule and reached nobody at all says,
 * and who can put it right (OnCallDutyPolicyRunEnding).
 */
export { ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE };

/*
 * How many rules one advance moves through at most, each paging nobody.
 * An empty pass is never repeated, so an advance goes through at most the
 * rest of one pass and one more; this is a guard against a loop, not a
 * limit anybody meets.
 */
const MAX_RULES_IN_ONE_ADVANCE: number = 200;

// The run, read as the worker reads it, for moving it on at once.
const RUN_SELECT: Select<OnCallDutyPolicyExecutionLog> = {
  _id: true,
  projectId: true,
  status: true,
  onCallDutyPolicyId: true,
  lastEscalationRuleExecutedAt: true,
  lastExecutedEscalationRuleId: true,
  lastExecutedEscalationRuleOrder: true,
  executeNextEscalationRuleInMinutes: true,
  userNotificationEventType: true,
  triggeredByIncidentId: true,
  triggeredByAlertId: true,
  triggeredByAlertEpisodeId: true,
  triggeredByIncidentEpisodeId: true,
  createdAt: true,
  pageAgainNumber: true,
  onCallDutyPolicy: {
    repeatPolicyIfNoOneAcknowledges: true,
    repeatPolicyIfNoOneAcknowledgesNoOfTimes: true,
  },
  onCallPolicyExecutionRepeatCount: true,
};

// What a run that could not be moved on at once says, when it says nothing.
export const ON_CALL_POLICY_RUN_MOVE_ON_FAILED_MESSAGE: string =
  "Error occurred while executing the on-call policy.";

export default class OnCallEscalationAdvance {
  /*
   * MOVES A RUN ON AT ONCE FROM THE RULE IT HAS JUST STARTED WITH, which
   * reached nobody (OnCallRuleExecutionOutcome.movesOnAtOnce): its first
   * rule, as it starts (OnCallDutyPolicyExecutionLogService), or the rule a
   * page again starts at. There is nobody on that rule to wait for.
   *
   * The run is read again first, as the worker reads it, so the claim
   * compares what starting the rule wrote. A run that is no longer paging
   * is left as it is. A move that fails for a reason a retry cannot fix ends
   * the run with an error that says why, as the worker's own would: its
   * record's feed and its Slack and Microsoft Teams message say so. One that
   * fails for a reason a retry can outlast is left to the worker, which
   * moves the run on at its next tick (issue #8167). Never throws: the run
   * starting is not to fail because moving it on did.
   */
  @CaptureSpan()
  public static async moveOnAtOnce(data: {
    runId: ObjectID;
  }): Promise<OnCallEscalationAdvanceResult | null> {
    try {
      const run: OnCallDutyPolicyExecutionLog | null =
        await OnCallDutyPolicyExecutionLogService.findOneById({
          id: data.runId,
          select: RUN_SELECT,
          props: {
            isRoot: true,
          },
        });

      if (!run || run.status !== OnCallDutyPolicyStatus.Executing) {
        return null;
      }

      return await this.advance({
        run: run,
        now: OneUptimeDate.getCurrentDate(),
        isCurrentRuleEmpty: true,
      });
    } catch (err) {
      logger.error(
        `Could not move on-call execution log ${data.runId.toString()} on at once from a rule that paged nobody.`,
      );
      logger.error(err as Error);

      try {
        /*
         * A failure a retry can outlast - the database, the network
         * (OnCallRunFailure) - leaves the run paging, its rule's wait cut to
         * nothing: the rule reached nobody, so there is nobody to wait for,
         * and the worker moves the run on at its next tick, in the same
         * claimed way, trying again as it tries any run's failed step. It
         * used to end the run in Error, and none of its later rules was
         * ever paged (issue #8167). A failure a retry cannot fix ends it,
         * saying why, as it did.
         */
        if (OnCallRunFailure.isRetryable(OnCallRunFailure.classify(err))) {
          await OnCallDutyPolicyExecutionLogService.updateOneById({
            id: data.runId,
            data: {
              executeNextEscalationRuleInMinutes: 0,
            },
            props: {
              isRoot: true,
            },
          });

          return null;
        }

        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: data.runId,
          data: {
            status: OnCallDutyPolicyStatus.Error,
            statusMessage: toOnCallPolicyRunStatusMessage(
              (err as Error)?.message ||
                ON_CALL_POLICY_RUN_MOVE_ON_FAILED_MESSAGE,
            ),
          },
          props: {
            isRoot: true,
          },
        });
      } catch (updateError) {
        logger.error(updateError as Error);
      }

      return null;
    }
  }

  /*
   * Moves a run on to its next escalation rule now, as the worker does once
   * the current rule's wait has run out.
   *
   * `run` is the run as read (OnCallDutyPolicyExecutionLog:
   * ExecutePendingExecutions reads it this way): its id, project, policy
   * (with its repeat settings), the rule it is on (order), when that rule
   * started, its pass (onCallPolicyExecutionRepeatCount) and what it pages
   * about. Its lastEscalationRuleExecutedAt is what the claim compares: a
   * run read before somebody else moved it on loses the claim.
   *
   * `isCurrentRuleEmpty`: the rule the run is on reached nobody, and the
   * run moves on from it at once (moveOnAtOnce). Otherwise the rule reached
   * somebody - its wait ran out, or they passed the page on - and so has
   * the pass the run is in.
   *
   * `toRuleId`: the later level to page instead of the next, picked by the
   * person escalating (OnCallPagePassOn). The levels between are skipped.
   *
   * `dueAt`: when the move on was due - the worker's, when the wait ran out
   * (OnCallEscalationWait). What the run pages is timed from then
   * (notification.send.lag, OnCallSendLag): a later level as an
   * escalation, and from the moment it starts its policy again, a policy
   * repeat. Without it, the move on is due now: a person passing the page
   * on, a level with nobody to wait for.
   */
  @CaptureSpan()
  public static async advance(data: {
    run: OnCallDutyPolicyExecutionLog;
    now: Date;
    isCurrentRuleEmpty?: boolean | undefined;
    toRuleId?: ObjectID | undefined;
    dueAt?: Date | undefined;
  }): Promise<OnCallEscalationAdvanceResult> {
    const run: OnCallDutyPolicyExecutionLog = data.run;
    const runId: ObjectID = run.id!;
    const send: OnCallScheduledSend = {
      dueAt: this.getDueAt({ dueAt: data.dueAt, now: data.now }),
      schedule: NotificationSchedule.Escalation,
    };
    const claimTime: Date = this.getClaimTime({
      previous: run.lastEscalationRuleExecutedAt,
      now: data.now,
    });

    /*
     * What giving the claim back needs, kept in flight from just before the
     * claim until the move is done (OnCallMoveOnsInFlight, issue #8410): a
     * process that stops between the claim and the next rule is given its
     * claim back by the worker, rather than left to wait the rule's whole
     * wait again. Not a move a person asked for (toRuleId), which is never
     * given back.
     */
    const moveOn: OnCallMoveOnInFlight | null = data.toRuleId
      ? null
      : {
          claimedAt: claimTime,
          previousLastEscalationRuleExecutedAt: run.lastEscalationRuleExecutedAt
            ? new Date(run.lastEscalationRuleExecutedAt)
            : null,
          lastExecutedEscalationRuleId:
            run.lastExecutedEscalationRuleId?.toString() || null,
          onCallPolicyExecutionRepeatCount:
            run.onCallPolicyExecutionRepeatCount ?? null,
        };

    if (moveOn) {
      await OnCallMoveOnsInFlight.keep(runId, moveOn);
    }

    const claimed: boolean =
      await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
        executionLogId: runId,
        previousLastEscalationRuleExecutedAt:
          run.lastEscalationRuleExecutedAt || null,
        newLastEscalationRuleExecutedAt: claimTime,
      });

    if (!claimed) {
      if (moveOn) {
        await OnCallMoveOnsInFlight.forget(runId);
      }

      logger.debug(
        `Execution log ${runId.toString()} was already moved on by a concurrent run; skipping to avoid double-paging.`,
        {
          projectId: run.projectId?.toString(),
        } as LogAttributes,
      );

      return { kind: OnCallEscalationAdvanceKind.NotClaimed, pagedUserIds: [] };
    }

    let result: OnCallEscalationAdvanceResult;

    /*
     * The move's latest claim in flight: a move past a level that reached
     * nobody claims again (claimAgain), and that claim is the one to give
     * back (issue #8515).
     */
    const inFlight: { moveOn: OnCallMoveOnInFlight | null } = {
      moveOn: moveOn,
    };

    try {
      result = await this.moveOnClaimed({
        run: run,
        isCurrentRuleEmpty: data.isCurrentRuleEmpty,
        toRuleId: data.toRuleId,
        send: send,
        inFlight: inFlight,
      });
    } catch (err) {
      /*
       * The move failed after its claim, which started the wait of the rule
       * the run is on afresh. If it failed before it started its next rule,
       * nobody was paged: the claim is given back, and the worker's next
       * tick tries the move again at once rather than after the rule's whole
       * wait (issue #8167). One that got further keeps its claim, and pages
       * nobody twice (giveBackEscalationAdvance). A later level picked by the
       * person escalating is theirs to pick again: its claim is kept.
       */
      if (inFlight.moveOn) {
        await this.giveBackMoveOn({ runId: runId, moveOn: inFlight.moveOn });
      }

      throw err;
    }

    if (moveOn) {
      await OnCallMoveOnsInFlight.forget(runId);
    }

    return result;
  }

  /*
   * A move on that failed after its claim gives the claim back, as it is
   * given back by the worker for one whose process stopped (issue #8410).
   * Given back, or found moved past - its next rule started - there is
   * nothing left to settle; a give-back the database failed is left in
   * flight, for the worker to make at the run's next try. Never throws.
   */
  private static async giveBackMoveOn(data: {
    runId: ObjectID;
    moveOn: OnCallMoveOnInFlight;
  }): Promise<void> {
    try {
      await this.giveBackMoveOnClaim(data);
    } catch (err) {
      logger.error(
        `Could not give back the claim to move on-call execution log ${data.runId.toString()} on; the worker gives it back at the run's next try.`,
      );
      logger.error(err as Error);
      return;
    }

    await OnCallMoveOnsInFlight.forget(data.runId);
  }

  /*
   * Gives back a move on's claim while the run is still as it left it
   * (giveBackEscalationAdvance): returns whether it did. Throws as the
   * database does.
   */
  public static async giveBackMoveOnClaim(data: {
    runId: ObjectID;
    moveOn: OnCallMoveOnInFlight;
  }): Promise<boolean> {
    return await OnCallDutyPolicyExecutionLogService.giveBackEscalationAdvance({
      executionLogId: data.runId,
      claimedLastEscalationRuleExecutedAt: data.moveOn.claimedAt,
      previousLastEscalationRuleExecutedAt:
        data.moveOn.previousLastEscalationRuleExecutedAt,
      lastExecutedEscalationRuleId: data.moveOn.lastExecutedEscalationRuleId
        ? new ObjectID(data.moveOn.lastExecutedEscalationRuleId)
        : null,
      onCallPolicyExecutionRepeatCount:
        data.moveOn.onCallPolicyExecutionRepeatCount,
      throwOnError: true,
      clearWait: Boolean(data.moveOn.passesEmptyLevel),
    });
  }

  /*
   * The move on, once it is claimed: the rule after the one the run is on,
   * or the policy again from its first rule, or the end (see advance).
   */
  private static async moveOnClaimed(data: {
    run: OnCallDutyPolicyExecutionLog;
    isCurrentRuleEmpty?: boolean | undefined;
    toRuleId?: ObjectID | undefined;
    send: OnCallScheduledSend;
    // The move's latest claim in flight, for claimAgain to keep (issue #8515).
    inFlight?: { moveOn: OnCallMoveOnInFlight | null } | undefined;
  }): Promise<OnCallEscalationAdvanceResult> {
    const run: OnCallDutyPolicyExecutionLog = data.run;
    const runId: ObjectID = run.id!;
    const send: OnCallScheduledSend = data.send;

    // Who passed this run's page on: its later rules and repeats pass them over.
    const passedOnUserIds: Array<ObjectID> =
      await this.getPassedOnUserIds(runId);

    /*
     * Where the run is: the level it is on, placed among the policy's
     * levels as they are now (OnCallRunLevel) - or, that level deleted, at
     * the place it recorded. Moved on with each level started here.
     */
    let place: OnCallRunPlace = {
      lastExecutedEscalationRuleId: run.lastExecutedEscalationRuleId,
      lastExecutedEscalationRuleOrder: run.lastExecutedEscalationRuleOrder,
    };
    let repeatCount: number | undefined = run.onCallPolicyExecutionRepeatCount;
    let lastStarted: OnCallEscalationAdvanceResult | null = null;

    /*
     * Whether the pass the run is in - its levels from the first to the
     * last, once round - has reached anybody. A rule that reached somebody
     * holds the run until its wait runs out, so within one advance only the
     * rule the run is on can have; every rule started here and moved past
     * reached nobody. A pass that reached nobody is not repeated.
     *
     * A run that moves on at once from a level after the first - a page
     * again starts at the level that was paging - has not been through the
     * levels before it in this pass: it may repeat, to reach them. After
     * the first level, not after place 1: a policy's first level can be at
     * any place (OnCallRunLevel), and once read the levels say which it is.
     */
    let hasPassReachedAnybody: boolean = !data.isCurrentRuleEmpty;

    for (let step: number = 0; step < MAX_RULES_IN_ONE_ADVANCE; step++) {
      /*
       * The rule just started paged nobody - or was deleted as the run moved
       * on to it: the run moves past it at once, claimed again, as any move
       * on is. A run that ended meanwhile - its page was acknowledged - or
       * that somebody else moved on is left.
       */
      if (step > 0 && !(await this.claimAgain(runId, data.inFlight))) {
        return (
          lastStarted || {
            kind: OnCallEscalationAdvanceKind.NotClaimed,
            pagedUserIds: [],
          }
        );
      }

      // The policy's levels now, first to last.
      const levels: Array<OnCallDutyPolicyEscalationRule> =
        await this.readLevels(run);

      if (
        step === 0 &&
        isOnCallRunPastFirstLevel({ run: place, levels: levels })
      ) {
        hasPassReachedAnybody = true;
      }

      const laterLevels: Array<OnCallDutyPolicyEscalationRule> =
        getOnCallRunLaterLevels({ run: place, levels: levels });

      /*
       * The level the person escalating picked, on the first move only,
       * while it is still a later level of the run's policy: a level it
       * moves past at once afterwards is followed by the next, as any
       * level is.
       */
      const pickedRule: OnCallDutyPolicyEscalationRule | null =
        step === 0 && data.toRuleId
          ? this.findLaterLevel({
              run: run,
              laterLevels: laterLevels,
              ruleId: data.toRuleId,
            })
          : null;

      const nextRule: OnCallDutyPolicyEscalationRule | null =
        pickedRule || laterLevels[0] || null;

      if (nextRule) {
        if (pickedRule) {
          // The later levels before the one picked: two at one place included.
          await this.skipLevels({
            run: run,
            levels: getOnCallLevelsBefore({
              level: pickedRule,
              levels: laterLevels,
            }),
          });
        }

        logger.debug(
          `Starting execution of the next escalation rule: ${nextRule.id}`,
        );

        const started: OnCallLevelStart = await this.startLevelUnlessGone({
          run: run,
          rule: nextRule,
          passedOnUserIds: passedOnUserIds,
          send: send,
        });

        if (started.isGone) {
          // Passed: the run goes on to the level now at its place.
          place = {
            lastExecutedEscalationRuleId: null,
            lastExecutedEscalationRuleOrder: nextRule.order!,
          };
          continue;
        }

        const outcome: OnCallRuleExecutionOutcome | undefined = started.outcome;

        lastStarted = this.getStarted({
          kind: OnCallEscalationAdvanceKind.RuleStarted,
          rule: nextRule,
          fallbackOrder: nextRule.order!,
          outcome: outcome,
        });

        if (!outcome?.movesOnAtOnce) {
          return lastStarted;
        }

        place = {
          lastExecutedEscalationRuleId: nextRule.id,
          lastExecutedEscalationRuleOrder: lastStarted.rule!.order,
        };
        continue;
      }

      logger.debug(
        `No next escalation rule found. Checking if we need to repeat this execution.`,
      );

      /*
       * Not one rule of this pass reached anybody: going round again would
       * page nobody again - at once, or after waits that wait for nobody.
       * The run ends here, as one that went through every rule.
       */
      if (!hasPassReachedAnybody) {
        logger.debug(
          `Execution log ${runId.toString()} went through a pass that paged nobody; not repeating it.`,
          {
            projectId: run.projectId?.toString(),
          } as LogAttributes,
        );

        return await this.endAfterEveryRule({
          run: run,
          passedOnUserIds: passedOnUserIds,
        });
      }

      /*
       * check if we need to repeat this execution.
       * onCallPolicyExecutionRepeatCount is seeded to 1 on create (the initial
       * pass), and the policy's repeats (getOnCallPolicyRepeatsAllowed) are
       * the number of additional passes requested. Use <= so the policy
       * repeats exactly that many times: with a strict <, "repeat 1 time"
       * never repeated at all and "repeat N" only repeated N-1 times, leaving
       * unacknowledged incidents under-escalated.
       *
       * The repeats are 0 while "Repeat if no one acknowledges" is off, as
       * the policy's Repeat Policy card says: a policy whose repeats were
       * switched off, its number left as it was, runs once.
       */
      if (repeatCount && repeatCount <= this.getRepeatsAllowed(run)) {
        const newRepeatCount: number = repeatCount + 1;

        logger.debug(
          `Repeating execution. New repeat count: ${newRepeatCount}`,
        );

        await OnCallDutyPolicyExecutionLogService.updateOneById({
          id: runId,
          data: {
            onCallPolicyExecutionRepeatCount: newRepeatCount,
          },
          props: {
            isRoot: true,
          },
        });

        repeatCount = newRepeatCount;

        // A new pass: it has reached nobody yet.
        hasPassReachedAnybody = false;

        // The policy's first level now: the lowest place, whatever its number.
        const firstEscalationRule: OnCallDutyPolicyEscalationRule | null =
          getOnCallPolicyFirstLevel(levels);

        if (!firstEscalationRule) {
          logger.debug(
            `No first escalation rule found. Marking execution as complete.`,
          );

          return await this.end({
            run: run,
            status: OnCallDutyPolicyStatus.Completed,
            statusMessage: ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
          });
        }

        logger.debug(
          `Starting execution of the first escalation rule: ${firstEscalationRule.id}`,
        );

        /*
         * The policy's repeat: what it pages from here on - a level after
         * the first it moves on to at once included - is timed as one.
         */
        send.schedule = NotificationSchedule.PolicyRepeat;

        const started: OnCallLevelStart = await this.startLevelUnlessGone({
          run: run,
          rule: firstEscalationRule,
          passedOnUserIds: passedOnUserIds,
          send: send,
        });

        if (started.isGone) {
          // Passed: the new pass goes on from the level now at its place.
          place = {
            lastExecutedEscalationRuleId: null,
            lastExecutedEscalationRuleOrder: firstEscalationRule.order!,
          };
          continue;
        }

        const outcome: OnCallRuleExecutionOutcome | undefined = started.outcome;

        lastStarted = this.getStarted({
          kind: OnCallEscalationAdvanceKind.PolicyStartedAgain,
          rule: firstEscalationRule,
          fallbackOrder: 1,
          outcome: outcome,
        });

        if (!outcome?.movesOnAtOnce) {
          return lastStarted;
        }

        place = {
          lastExecutedEscalationRuleId: firstEscalationRule.id,
          lastExecutedEscalationRuleOrder: lastStarted.rule!.order,
        };
        continue;
      }

      logger.debug(
        `No rules to execute and no repeats left. Marking execution as complete.`,
      );

      return await this.endAfterEveryRule({
        run: run,
        passedOnUserIds: passedOnUserIds,
      });
    }

    logger.error(
      `Execution log ${runId.toString()} moved past ${MAX_RULES_IN_ONE_ADVANCE} escalation rules that paged nobody in one go; leaving it on the last one.`,
    );

    return (
      lastStarted || {
        kind: OnCallEscalationAdvanceKind.NotClaimed,
        pagedUserIds: [],
      }
    );
  }

  /*
   * RESUMES THE LEVEL A RUN IS ON, WHOSE PAGING STOPPED PART WAY
   * (issue #8406).
   *
   * A database error in the middle of a level, or a process that stopped
   * there, left the rest of its people unpaged: the level's rule was
   * recorded on the run, so the run waited out the level's wait and moved
   * on. The level was kept in flight (OnCallLevelsInFlight), and the
   * policy-run worker resumes it at the run's next try: its people this run
   * has not paged for the rule since the level started are paged now, as
   * the level pages them - nobody is paged twice - and a level that, all
   * told, reached nobody moves the run on at once, as one does when it
   * starts (OnCallEmptyLevel). Its wait runs from when the level started.
   * Throws as paging does: the level stays in flight, stopped, for the
   * run's next try.
   */
  @CaptureSpan()
  public static async resumeLevel(data: {
    run: OnCallDutyPolicyExecutionLog;
    level: OnCallLevelInFlight;
  }): Promise<void> {
    const run: OnCallDutyPolicyExecutionLog = data.run;

    logger.warn(
      `On-call execution log ${run.id?.toString()}: the paging of escalation rule ${data.level.ruleId}, started at ${data.level.startedAt.toISOString()}, stopped part way; paging the people it did not get to.`,
      { projectId: run.projectId?.toString() } as LogAttributes,
    );

    const passedOnUserIds: Array<ObjectID> = await this.getPassedOnUserIds(
      run.id!,
    );

    const resume: () => Promise<OnCallRuleExecutionOutcome> =
      (): Promise<OnCallRuleExecutionOutcome> => {
        return OnCallDutyPolicyEscalationRuleService.resumeRuleExecution(
          new ObjectID(data.level.ruleId),
          {
            ...this.getPageContext(run),
            onCallPolicyId: run.onCallDutyPolicyId!,
            passedOnUserIds: passedOnUserIds,
            level: data.level,
          },
        );
      };

    /*
     * Its pages are timed as the level's were as it started (issue #8471):
     * due when the wait before it ran out, or as its page started - so one
     * it sends now shows as late as it is (notification.send.lag).
     */
    const level: OnCallLevelInFlight = data.level;

    const outcome: OnCallRuleExecutionOutcome = level.pageStart
      ? await OnCallPageTiming.runInPageStart(
          {
            startedAt: level.pageStart.startedAt,
            start: level.pageStart.start,
          },
          resume,
        )
      : level.scheduledSend
        ? await OnCallSendLag.runAsScheduledSend(
            {
              dueAt: level.scheduledSend.dueAt,
              schedule: level.scheduledSend.schedule,
            },
            resume,
          )
        : await resume();

    if (outcome.movesOnAtOnce) {
      await this.moveOnAtOnce({ runId: run.id! });
    }
  }

  /*
   * The people who passed a run's page on (OnCallPagePassOn), once each:
   * the run's timeline lines that say so. The timeline is what is read,
   * rather than each person's notification log, because a line that says a
   * person passed the page on stays that way (UserOnCallLogService), while
   * the worker that sends a person's notifications may still be finishing
   * their log as they pass it on.
   *
   * If they cannot be read, the run pages as it did before anybody could
   * pass a page on, rather than paging nobody: a page sent to somebody who
   * passed it on is far better than one lost to a failed read.
   */
  @CaptureSpan()
  public static async getPassedOnUserIds(
    runId: ObjectID,
  ): Promise<Array<ObjectID>> {
    try {
      const lines: Array<OnCallDutyPolicyExecutionLogTimeline> =
        await OnCallDutyPolicyExecutionLogTimelineService.findBy({
          query: {
            onCallDutyPolicyExecutionLogId: runId,
            status: OnCallDutyExecutionLogTimelineStatus.PassedOn,
          },
          select: {
            alertSentToUserId: true,
          },
          skip: 0,
          limit: LIMIT_PER_PROJECT,
          props: {
            isRoot: true,
          },
        });

      return this.uniqueIds(
        (lines || []).map(
          (
            line: OnCallDutyPolicyExecutionLogTimeline,
          ): ObjectID | undefined => {
            return line.alertSentToUserId;
          },
        ),
      );
    } catch (err) {
      logger.error(
        `Could not read who passed the page of execution log ${runId.toString()} on; paging its next rule as if nobody had.`,
      );
      logger.error(err as Error);

      return [];
    }
  }

  /*
   * The time a claim writes: now, or - when now is no later than the time it
   * read, as for two people passing a page on within the same millisecond,
   * or a worker replica whose clock runs behind - a moment after it. A claim
   * only excludes the next one if it changes what the next one compares.
   */
  public static getClaimTime(data: {
    previous: Date | null | undefined;
    now: Date;
  }): Date {
    if (!data.previous) {
      return data.now;
    }

    const previous: number = new Date(data.previous).getTime();

    if (isNaN(previous) || data.now.getTime() > previous) {
      return data.now;
    }

    return new Date(previous + 1);
  }

  // Ids, once each and in order, none missing.
  public static uniqueIds(
    userIds: Array<ObjectID | null | undefined>,
  ): Array<ObjectID> {
    const seen: Set<string> = new Set<string>();
    const unique: Array<ObjectID> = [];

    for (const userId of userIds) {
      if (!userId) {
        continue;
      }

      const key: string = userId.toString().toLowerCase();

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);
      unique.push(userId);
    }

    return unique;
  }

  /*
   * Claims moving the run on again, from the rule it is on now - re-read,
   * since starting that rule moved its clock. A run that ended in between,
   * or that somebody else moved on, is left as it is.
   */
  private static async claimAgain(
    runId: ObjectID,
    inFlight?: { moveOn: OnCallMoveOnInFlight | null } | undefined,
  ): Promise<boolean> {
    const current: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneById({
        id: runId,
        select: {
          status: true,
          lastEscalationRuleExecutedAt: true,
          lastExecutedEscalationRuleId: true,
          onCallPolicyExecutionRepeatCount: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!current || current.status !== OnCallDutyPolicyStatus.Executing) {
      return false;
    }

    const claimTime: Date = this.getClaimTime({
      previous: current.lastEscalationRuleExecutedAt,
      now: OneUptimeDate.getCurrentDate(),
    });

    /*
     * This claim, past the level that reached nobody, is kept in flight in
     * place of the move's first (issue #8515): a process that stops before
     * the next level is recorded has it given back - the level's wait
     * cleared with it - rather than waiting out the wait of a level that
     * paged nobody.
     */
    if (inFlight?.moveOn) {
      inFlight.moveOn = {
        claimedAt: claimTime,
        previousLastEscalationRuleExecutedAt:
          current.lastEscalationRuleExecutedAt
            ? new Date(current.lastEscalationRuleExecutedAt)
            : null,
        lastExecutedEscalationRuleId:
          current.lastExecutedEscalationRuleId?.toString() || null,
        onCallPolicyExecutionRepeatCount:
          current.onCallPolicyExecutionRepeatCount ?? null,
        passesEmptyLevel: true,
      };

      await OnCallMoveOnsInFlight.keep(runId, inFlight.moveOn);
    }

    return await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
      executionLogId: runId,
      previousLastEscalationRuleExecutedAt:
        current.lastEscalationRuleExecutedAt || null,
      newLastEscalationRuleExecutedAt: claimTime,
    });
  }

  /*
   * When a move on was due, for the notifications it sends: `dueAt` - the
   * moment the wait ran out - or `now` without one; never later than now.
   */
  public static getDueAt(data: { dueAt?: Date | undefined; now: Date }): Date {
    const dueAt: number = data.dueAt ? new Date(data.dueAt).getTime() : NaN;

    if (isNaN(dueAt) || dueAt > data.now.getTime()) {
      return data.now;
    }

    return new Date(dueAt);
  }

  /*
   * Pages a rule as a scheduled send (OnCallSendLag): every notification it
   * writes is due when `send` says - copied, since the advance goes on to
   * change its schedule.
   */
  private static async startRule(data: {
    run: OnCallDutyPolicyExecutionLog;
    ruleId: ObjectID;
    passedOnUserIds: Array<ObjectID>;
    send: OnCallScheduledSend;
  }): Promise<OnCallRuleExecutionOutcome | undefined> {
    return await OnCallSendLag.runAsScheduledSend(
      { dueAt: data.send.dueAt, schedule: data.send.schedule },
      (): Promise<OnCallRuleExecutionOutcome> => {
        return OnCallDutyPolicyEscalationRuleService.startRuleExecution(
          data.ruleId,
          {
            ...this.getPageContext(data.run),
            onCallPolicyId: data.run.onCallDutyPolicyId!,
            passedOnUserIds: data.passedOnUserIds,
          },
        );
      },
    );
  }

  // What a run pages about, as its rules' lines on its timeline name it.
  private static getPageContext(
    run: OnCallDutyPolicyExecutionLog,
  ): PageContext {
    return {
      projectId: run.projectId!,
      triggeredByIncidentId: run.triggeredByIncidentId,
      triggeredByAlertId: run.triggeredByAlertId,
      triggeredByAlertEpisodeId: run.triggeredByAlertEpisodeId,
      triggeredByIncidentEpisodeId: run.triggeredByIncidentEpisodeId,
      userNotificationEventType: run.userNotificationEventType!,
      onCallPolicyExecutionLogId: run.id!,
      onCallPolicyId: run.onCallDutyPolicyId || undefined,
    };
  }

  /*
   * The run's policy's levels as they are now: its escalation rules, by
   * their place, first to last (OnCallRunLevel reads where the run is
   * among them).
   */
  private static async readLevels(
    run: OnCallDutyPolicyExecutionLog,
  ): Promise<Array<OnCallDutyPolicyEscalationRule>> {
    const levels: Array<OnCallDutyPolicyEscalationRule> =
      await OnCallDutyPolicyEscalationRuleService.findBy({
        query: {
          projectId: run.projectId!,
          onCallDutyPolicyId: run.onCallDutyPolicyId!,
        },
        select: {
          _id: true,
          order: true,
          name: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    return sortOnCallPolicyLevels(levels || []);
  }

  /*
   * The level picked to page, when it is still a level of the run's policy
   * after the one the run is on; null otherwise - it was deleted, moved up
   * past the run, or is another policy's - and the run moves on to its next
   * level instead.
   */
  private static findLaterLevel(data: {
    run: OnCallDutyPolicyExecutionLog;
    laterLevels: Array<OnCallDutyPolicyEscalationRule>;
    ruleId: ObjectID;
  }): OnCallDutyPolicyEscalationRule | null {
    const level: OnCallDutyPolicyEscalationRule | undefined =
      data.laterLevels.find(
        (candidate: OnCallDutyPolicyEscalationRule): boolean => {
          return (
            candidate.id?.toString().toLowerCase() ===
            data.ruleId.toString().toLowerCase()
          );
        },
      );

    if (!level) {
      logger.debug(
        `Escalation rule ${data.ruleId.toString()} is not a later level of execution log ${data.run.id?.toString()}; moving on to its next level instead.`,
        {
          projectId: data.run.projectId?.toString(),
        } as LogAttributes,
      );

      return null;
    }

    return level;
  }

  /*
   * The levels the run skips for a later level picked to page: each gets
   * its line on the run's timeline saying so. A line that cannot be written
   * is logged and left: the level picked is paged regardless.
   */
  private static async skipLevels(data: {
    run: OnCallDutyPolicyExecutionLog;
    levels: Array<OnCallDutyPolicyEscalationRule>;
  }): Promise<void> {
    try {
      for (const level of data.levels) {
        if (!level.id) {
          continue;
        }

        await OnCallDutyPolicyEscalationRuleService.recordLevelSkippedByEscalation(
          level.id,
          this.getPageContext(data.run),
          { order: level.order, name: level.name },
        );
      }
    } catch (err) {
      logger.error(
        `Could not write the levels execution log ${data.run.id?.toString()} skipped for a later level picked to page.`,
      );
      logger.error(err as Error);
    }
  }

  /*
   * Pages a level the run moves on to (startRule) - or finds it deleted
   * between being read and being paged (issue #9036): its rule is no
   * longer a level of the run's policy. Then nobody on it was paged, and
   * the run moves past it. Any other failure is the move's, as it was.
   */
  private static async startLevelUnlessGone(data: {
    run: OnCallDutyPolicyExecutionLog;
    rule: OnCallDutyPolicyEscalationRule;
    passedOnUserIds: Array<ObjectID>;
    send: OnCallScheduledSend;
  }): Promise<OnCallLevelStart> {
    try {
      return {
        isGone: false,
        outcome: await this.startRule({
          run: data.run,
          ruleId: data.rule.id!,
          passedOnUserIds: data.passedOnUserIds,
          send: data.send,
        }),
      };
    } catch (err) {
      if (!(await this.isLevelGone({ run: data.run, ruleId: data.rule.id! }))) {
        throw err;
      }

      logger.warn(
        `Escalation rule ${data.rule.id!.toString()} of on-call execution log ${data.run.id?.toString()} was deleted as the run moved on to it; moving on past it.`,
        {
          projectId: data.run.projectId?.toString(),
        } as LogAttributes,
      );

      return { isGone: true };
    }
  }

  // Whether a rule is no longer a level of the run's policy: it was deleted.
  private static async isLevelGone(data: {
    run: OnCallDutyPolicyExecutionLog;
    ruleId: ObjectID;
  }): Promise<boolean> {
    const levels: Array<OnCallDutyPolicyEscalationRule> = await this.readLevels(
      data.run,
    );

    return !levels.some((level: OnCallDutyPolicyEscalationRule): boolean => {
      return (
        level.id?.toString().toLowerCase() ===
        data.ruleId.toString().toLowerCase()
      );
    });
  }

  private static getStarted(data: {
    kind: OnCallEscalationAdvanceKind;
    rule: OnCallDutyPolicyEscalationRule;
    fallbackOrder: number;
    outcome: OnCallRuleExecutionOutcome | undefined;
  }): OnCallEscalationAdvanceResult {
    const order: number =
      typeof data.rule.order === "number" && data.rule.order > 0
        ? data.rule.order
        : data.fallbackOrder;

    const paged: Array<{ userId: ObjectID }> = Array.isArray(
      data.outcome?.paged,
    )
      ? data.outcome!.paged
      : [];

    return {
      kind: data.kind,
      rule: {
        id: data.rule.id!,
        order: order,
        name: data.rule.name || undefined,
      },
      pagedUserIds: paged.map((target: { userId: ObjectID }): ObjectID => {
        return target.userId;
      }),
    };
  }

  /*
   * The run went through every rule and every repeat with nobody
   * acknowledging. Derived from the timeline rather than tracked in a
   * counter column, so this cannot drift from what really happened: the
   * run notified somebody when a line of a person says their page went out
   * - sent, acknowledged or escalated. A person skipped (away, gone, opted
   * out) or whose page failed as it was sent was not notified.
   *
   * "Completed" on its own is ambiguous: a policy that walked every
   * escalation rule and paged nobody - because each rule targeted a schedule
   * with a coverage gap - would end with the same green "Execution
   * Completed" as one that paged the on-call engineer, so a policy could
   * notify no one indefinitely without anything on screen looking wrong.
   *
   * A run whose people ALL passed the page on says so: nobody could take it,
   * which its channel hears as such.
   */
  private static async endAfterEveryRule(data: {
    run: OnCallDutyPolicyExecutionLog;
    passedOnUserIds: Array<ObjectID>;
  }): Promise<OnCallEscalationAdvanceResult> {
    const lines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      await this.readPersonLines(data.run.id!);

    const notifiedSomeone: boolean = lines.some(
      (line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return isOnCallPageLineReached(line.status);
      },
    );

    if (!notifiedSomeone) {
      return await this.end({
        run: data.run,
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        statusMessage: ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      });
    }

    const everybodyPassedItOn: boolean =
      data.passedOnUserIds.length > 0 && this.isEverybodyReachedPassedOn(lines);

    let statusMessage: string = everybodyPassedItOn
      ? ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE
      : ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE;

    // A test that walked every level says it in a test's words (OnCallTestPage).
    if (isOnCallTestPage(data.run) && !everybodyPassedItOn) {
      statusMessage = ON_CALL_TEST_PAGE_WENT_THROUGH_EVERY_LEVEL_MESSAGE;
    }

    return await this.end({
      run: data.run,
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage: statusMessage,
    });
  }

  /*
   * How many more times a run's policy starts again once it has gone
   * through every level: what its Repeat Policy says - and none for a test
   * page (OnCallTestPage), which walks the levels once, so a test that
   * nobody answers does not page everybody again.
   */
  public static getRepeatsAllowed(run: OnCallDutyPolicyExecutionLog): number {
    if (isOnCallTestPage(run)) {
      return 0;
    }

    return getOnCallPolicyRepeatsAllowed(run.onCallDutyPolicy);
  }

  /*
   * Whether everybody a run paged passed its page on: nobody it reached is
   * left who might still take it. A page that was skipped or failed to
   * reach its person counts neither way.
   */
  @CaptureSpan()
  public static async hasEverybodyPassedItOn(
    runId: ObjectID,
  ): Promise<boolean> {
    return this.isEverybodyReachedPassedOn(await this.readPersonLines(runId));
  }

  // A run's timeline lines about a person: who, and how their page went.
  private static async readPersonLines(
    runId: ObjectID,
  ): Promise<Array<OnCallDutyPolicyExecutionLogTimeline>> {
    const lines: Array<OnCallDutyPolicyExecutionLogTimeline> =
      await OnCallDutyPolicyExecutionLogTimelineService.findBy({
        query: {
          onCallDutyPolicyExecutionLogId: runId,
          alertSentToUserId: QueryHelper.notNull(),
        },
        select: {
          alertSentToUserId: true,
          status: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    return lines || [];
  }

  /*
   * Given a run's timeline lines: everybody a line says was reached - paged,
   * being paged, or passed it on - has a line saying they passed it on.
   */
  public static isEverybodyReachedPassedOn(
    lines: Array<OnCallDutyPolicyExecutionLogTimeline>,
  ): boolean {
    const reached: Array<OnCallDutyPolicyExecutionLogTimeline> = lines.filter(
      (line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return (
          Boolean(line.alertSentToUserId) &&
          line.status !== OnCallDutyExecutionLogTimelineStatus.Skipped &&
          line.status !== OnCallDutyExecutionLogTimelineStatus.Error
        );
      },
    );

    if (reached.length === 0) {
      return false;
    }

    const passedOn: Set<string> = new Set<string>(
      reached
        .filter((line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
          return line.status === OnCallDutyExecutionLogTimelineStatus.PassedOn;
        })
        .map((line: OnCallDutyPolicyExecutionLogTimeline): string => {
          return line.alertSentToUserId!.toString().toLowerCase();
        }),
    );

    return reached.every(
      (line: OnCallDutyPolicyExecutionLogTimeline): boolean => {
        return passedOn.has(line.alertSentToUserId!.toString().toLowerCase());
      },
    );
  }

  private static async end(data: {
    run: OnCallDutyPolicyExecutionLog;
    status: OnCallDutyPolicyStatus;
    statusMessage: string;
  }): Promise<OnCallEscalationAdvanceResult> {
    await OnCallDutyPolicyExecutionLogService.updateOneById({
      id: data.run.id!,
      data: {
        status: data.status,
        statusMessage: data.statusMessage,
      },
      props: {
        isRoot: true,
      },
    });

    return {
      kind: OnCallEscalationAdvanceKind.Ended,
      pagedUserIds: [],
      endedWithStatus: data.status,
      endedWithMessage: data.statusMessage,
    };
  }
}
