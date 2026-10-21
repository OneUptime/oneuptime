import OneUptimeDate from "../../../Types/Date";
import { getOnCallPolicyRunWaitingMessage } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallRuleWhenToPage from "../../../Types/OnCallDutyPolicy/OnCallRuleWhenToPage";
import RestrictionTimes from "../../../Types/OnCallDutyPolicy/RestrictionTimes";
import WorkingHours from "../../../Types/OnCallDutyPolicy/WorkingHours";
import logger from "../Logger";

/*
 * WHEN THE POLICIES AN ON-CALL RULE ADDS TO A RECORD MAY PAGE.
 *
 * A rule that pages only during working hours (OnCallRuleWhenToPage) holds
 * the runs it starts outside them: each is created waiting, and pages its
 * first escalation rule when the hours begin (OnCallDutyPolicyRunWait). The
 * rule engines of alerts, incidents and episodes ask here, for each rule a
 * record matched, when its policies may page, and hand the record's service
 * the holds of the policies they added, which it passes to executePolicy.
 *
 * A record two rules page the same policy for pages it as soon as either
 * lets it: right away wins, and of two rules that wait, the one whose hours
 * begin first. A policy the record had before its rules ran - named when it
 * was created, or by its monitor - pages right away, as it always has.
 *
 * Inside the hours, a working-hours rule pages right away. Hours that never
 * open - none set, a window that ends where it starts, a time zone OneUptime
 * does not know - hold nothing either: the rule pages right away, and the
 * log says why. A page held for hours that never come is a page lost.
 */

// The hold on a run: when it starts paging, and what it says until then.
export interface OnCallRulePagingHold {
  pagingStartsAt: Date;
  waitingStatusMessage: string;
}

// What a rule says about when it pages (OnCallRuleBaseModel).
export interface OnCallRuleWhenToPageSettings {
  id?: { toString: () => string } | null | undefined;
  whenToPage?: OnCallRuleWhenToPage | string | null | undefined;
  workingHours?: RestrictionTimes | null | undefined;
  workingHoursTimezone?: string | null | undefined;
}

// The columns a rule engine reads to know when a rule pages.
export const ON_CALL_RULE_WHEN_TO_PAGE_SELECT: {
  whenToPage: true;
  workingHours: true;
  workingHoursTimezone: true;
} = {
  whenToPage: true,
  workingHours: true,
  workingHoursTimezone: true,
};

export default class OnCallRulePagingHoldUtil {
  /*
   * The hold a rule puts on the runs it starts now: null when they page
   * right away - a rule that pages right away, a working-hours rule inside
   * its hours, or one whose hours never open.
   */
  public static getHold(
    rule: OnCallRuleWhenToPageSettings,
    now: Date,
  ): OnCallRulePagingHold | null {
    if (rule.whenToPage !== OnCallRuleWhenToPage.WorkingHours) {
      return null;
    }

    const pagingStartsAt: Date | null = WorkingHours.getNextStart({
      hours: rule.workingHours,
      timezone: rule.workingHoursTimezone,
      at: now,
    });

    if (!pagingStartsAt) {
      logger.warn(
        `On-call rule ${rule.id?.toString() || ""} pages only during working hours, but its working hours never begin (${
          WorkingHours.getProblem({
            hours: rule.workingHours,
            timezone: rule.workingHoursTimezone,
          }) || "no window opens"
        }). Paging right away.`,
      );

      return null;
    }

    if (!OneUptimeDate.isAfter(pagingStartsAt, now)) {
      return null;
    }

    return {
      pagingStartsAt: pagingStartsAt,
      waitingStatusMessage: getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: pagingStartsAt,
        timezone: rule.workingHoursTimezone || undefined,
        now: now,
        isWaitingForWorkingHours: true,
      }),
    };
  }

  // Of two rules' holds on one policy, the one that lets it page first.
  public static getEarliest(
    first: OnCallRulePagingHold | null,
    second: OnCallRulePagingHold | null,
  ): OnCallRulePagingHold | null {
    if (!first || !second) {
      return null;
    }

    return second.pagingStartsAt.getTime() < first.pagingStartsAt.getTime()
      ? second
      : first;
  }
}

/*
 * The holds of one record's rules, policy by policy, as a rule engine goes
 * through the rules the record matched.
 */
export class OnCallRulePagingHolds {
  private readonly now: Date;

  // A policy's hold; null for a policy that pages right away.
  private readonly holdByPolicyId: Map<string, OnCallRulePagingHold | null> =
    new Map<string, OnCallRulePagingHold | null>();

  public constructor(now?: Date | undefined) {
    this.now = now || OneUptimeDate.getCurrentDate();
  }

  // A rule the record matched, and the policies it pages.
  public addRule(
    rule: OnCallRuleWhenToPageSettings,
    policyIds: Array<string>,
  ): void {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      rule,
      this.now,
    );

    for (const policyId of policyIds) {
      if (!policyId) {
        continue;
      }

      if (!this.holdByPolicyId.has(policyId)) {
        this.holdByPolicyId.set(policyId, hold);
        continue;
      }

      this.holdByPolicyId.set(
        policyId,
        OnCallRulePagingHoldUtil.getEarliest(
          this.holdByPolicyId.get(policyId) || null,
          hold,
        ),
      );
    }
  }

  /*
   * The holds of the policies the rules added to the record, by policy id:
   * only those that wait. A policy that pages right away has none.
   */
  public getHolds(
    addedPolicyIds: Array<string>,
  ): Map<string, OnCallRulePagingHold> {
    const holds: Map<string, OnCallRulePagingHold> = new Map<
      string,
      OnCallRulePagingHold
    >();

    for (const policyId of addedPolicyIds) {
      const hold: OnCallRulePagingHold | null | undefined =
        this.holdByPolicyId.get(policyId);

      if (hold) {
        holds.set(policyId, hold);
      }
    }

    return holds;
  }
}
