import OnCallDutyPolicyEscalationRule from "../../../Models/DatabaseModels/OnCallDutyPolicyEscalationRule";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { getOnCallPolicyRepeatsAllowed } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRepeat";
import {
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyExecutionLogTimelineStatus from "../../../Types/OnCallDutyPolicy/OnCalDutyExecutionLogTimelineStatus";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import PositiveNumber from "../../../Types/PositiveNumber";
import OnCallDutyPolicyEscalationRuleService, {
  OnCallRuleExecutionOutcome,
} from "../../Services/OnCallDutyPolicyEscalationRuleService";
import OnCallDutyPolicyExecutionLogService from "../../Services/OnCallDutyPolicyExecutionLogService";
import OnCallDutyPolicyExecutionLogTimelineService from "../../Services/OnCallDutyPolicyExecutionLogTimelineService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger, { LogAttributes } from "../Logger";
import CaptureSpan from "../Telemetry/CaptureSpan";

/*
 * MOVING AN ON-CALL POLICY'S RUN ON TO ITS NEXT ESCALATION RULE.
 *
 * A run pages its first escalation rule when it starts, then waits the
 * rule's "Escalate after" for somebody to acknowledge. Two things move it
 * on, and both come here, so a run moves on in one way only:
 *
 * - the worker (OnCallDutyPolicyExecutionLog:ExecutePendingExecutions),
 *   every minute, once the wait has run out;
 * - the person being paged passing the page on (OnCallPagePassOn), straight
 *   away, when nobody else on the current rule is left to take it.
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
 * A rule whose people have ALL passed the page on already pages nobody, and
 * waiting out its wait would only hold up the people the page is passed on
 * to: the run moves past it at once (OnCallRuleExecutionOutcome.movesOnAtOnce),
 * claiming again for each such rule.
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
 * What a run that went through every rule and every repeat and reached
 * nobody at all says.
 */
export const ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE: string =
  "Execution completed, but no one was notified. Every escalation rule in this policy reached no one - usually because the on-call schedules it targets had nobody on call.";

/*
 * How many rules one advance moves through at most, each paging nobody
 * because everybody in it passed the page on. Far more than any policy has
 * rules times repeats; a guard against a loop, not a limit anybody meets.
 */
const MAX_RULES_IN_ONE_ADVANCE: number = 200;

export default class OnCallEscalationAdvance {
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
   */
  @CaptureSpan()
  public static async advance(data: {
    run: OnCallDutyPolicyExecutionLog;
    now: Date;
  }): Promise<OnCallEscalationAdvanceResult> {
    const run: OnCallDutyPolicyExecutionLog = data.run;
    const runId: ObjectID = run.id!;

    const claimed: boolean =
      await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
        executionLogId: runId,
        previousLastEscalationRuleExecutedAt:
          run.lastEscalationRuleExecutedAt || null,
        newLastEscalationRuleExecutedAt: data.now,
      });

    if (!claimed) {
      logger.debug(
        `Execution log ${runId.toString()} was already moved on by a concurrent run; skipping to avoid double-paging.`,
        {
          projectId: run.projectId?.toString(),
        } as LogAttributes,
      );

      return { kind: OnCallEscalationAdvanceKind.NotClaimed, pagedUserIds: [] };
    }

    // Who passed this run's page on: its later rules and repeats pass them over.
    const passedOnUserIds: Array<ObjectID> =
      await this.getPassedOnUserIds(runId);

    let lastOrder: number = run.lastExecutedEscalationRuleOrder || 0;
    let repeatCount: number | undefined = run.onCallPolicyExecutionRepeatCount;
    let lastStarted: OnCallEscalationAdvanceResult | null = null;

    for (let step: number = 0; step < MAX_RULES_IN_ONE_ADVANCE; step++) {
      /*
       * The rule just started paged nobody, because everybody in it had
       * passed the page on: the run moves past it at once - claimed again,
       * as any move on is.
       */
      if (step > 0 && !(await this.claimAgain(runId))) {
        return lastStarted!;
      }

      const nextRule: OnCallDutyPolicyEscalationRule | null =
        await OnCallDutyPolicyEscalationRuleService.findOneBy({
          query: {
            projectId: run.projectId!,
            onCallDutyPolicyId: run.onCallDutyPolicyId!,
            order: lastOrder + 1,
          },
          props: {
            isRoot: true,
          },
          select: {
            _id: true,
            order: true,
            name: true,
          },
        });

      if (nextRule) {
        logger.debug(
          `Starting execution of the next escalation rule: ${nextRule.id}`,
        );

        const outcome: OnCallRuleExecutionOutcome | undefined =
          await this.startRule({
            run: run,
            ruleId: nextRule.id!,
            passedOnUserIds: passedOnUserIds,
          });

        lastStarted = this.getStarted({
          kind: OnCallEscalationAdvanceKind.RuleStarted,
          rule: nextRule,
          fallbackOrder: lastOrder + 1,
          outcome: outcome,
        });

        if (!outcome?.movesOnAtOnce) {
          return lastStarted;
        }

        lastOrder = lastStarted.rule!.order;
        continue;
      }

      logger.debug(
        `No next escalation rule found. Checking if we need to repeat this execution.`,
      );

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
      if (
        repeatCount &&
        repeatCount <= getOnCallPolicyRepeatsAllowed(run.onCallDutyPolicy)
      ) {
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

        // get first escalation rule.
        const firstEscalationRule: OnCallDutyPolicyEscalationRule | null =
          await OnCallDutyPolicyEscalationRuleService.findOneBy({
            query: {
              projectId: run.projectId!,
              onCallDutyPolicyId: run.onCallDutyPolicyId!,
              order: 1,
            },
            props: {
              isRoot: true,
            },
            select: {
              _id: true,
              order: true,
              name: true,
            },
          });

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

        const outcome: OnCallRuleExecutionOutcome | undefined =
          await this.startRule({
            run: run,
            ruleId: firstEscalationRule.id!,
            passedOnUserIds: passedOnUserIds,
          });

        lastStarted = this.getStarted({
          kind: OnCallEscalationAdvanceKind.PolicyStartedAgain,
          rule: firstEscalationRule,
          fallbackOrder: 1,
          outcome: outcome,
        });

        if (!outcome?.movesOnAtOnce) {
          return lastStarted;
        }

        lastOrder = lastStarted.rule!.order;
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

    return lastStarted!;
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
          (line: OnCallDutyPolicyExecutionLogTimeline): ObjectID | undefined => {
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
  private static async claimAgain(runId: ObjectID): Promise<boolean> {
    const current: OnCallDutyPolicyExecutionLog | null =
      await OnCallDutyPolicyExecutionLogService.findOneById({
        id: runId,
        select: {
          status: true,
          lastEscalationRuleExecutedAt: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!current || current.status !== OnCallDutyPolicyStatus.Executing) {
      return false;
    }

    return await OnCallDutyPolicyExecutionLogService.claimEscalationAdvance({
      executionLogId: runId,
      previousLastEscalationRuleExecutedAt:
        current.lastEscalationRuleExecutedAt || null,
      newLastEscalationRuleExecutedAt: OneUptimeDate.getCurrentDate(),
    });
  }

  private static async startRule(data: {
    run: OnCallDutyPolicyExecutionLog;
    ruleId: ObjectID;
    passedOnUserIds: Array<ObjectID>;
  }): Promise<OnCallRuleExecutionOutcome | undefined> {
    const run: OnCallDutyPolicyExecutionLog = data.run;

    return await OnCallDutyPolicyEscalationRuleService.startRuleExecution(
      data.ruleId,
      {
        projectId: run.projectId!,
        triggeredByIncidentId: run.triggeredByIncidentId,
        triggeredByAlertId: run.triggeredByAlertId,
        triggeredByAlertEpisodeId: run.triggeredByAlertEpisodeId,
        triggeredByIncidentEpisodeId: run.triggeredByIncidentEpisodeId,
        userNotificationEventType: run.userNotificationEventType!,
        onCallPolicyExecutionLogId: run.id!,
        onCallPolicyId: run.onCallDutyPolicyId!,
        passedOnUserIds: data.passedOnUserIds,
      },
    );
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
   * counter column: a row has a recipient exactly when somebody was
   * notified, so this cannot drift from what really happened.
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
    const notifiedCount: PositiveNumber =
      await OnCallDutyPolicyExecutionLogTimelineService.countBy({
        query: {
          onCallDutyPolicyExecutionLogId: data.run.id!,
          alertSentToUserId: QueryHelper.notNull(),
        },
        props: {
          isRoot: true,
        },
      });

    const notifiedSomeone: boolean = notifiedCount.toNumber() > 0;

    if (!notifiedSomeone) {
      return await this.end({
        run: data.run,
        status: OnCallDutyPolicyStatus.CompletedWithNoNotifications,
        statusMessage: ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
      });
    }

    const everybodyPassedItOn: boolean =
      data.passedOnUserIds.length > 0 &&
      (await this.hasEverybodyPassedItOn(data.run.id!));

    return await this.end({
      run: data.run,
      status: OnCallDutyPolicyStatus.Completed,
      statusMessage: everybodyPassedItOn
        ? ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE
        : ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    });
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

    return this.isEverybodyReachedPassedOn(lines || []);
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
