import OneUptimeDate from "../../../Types/Date";
import { getOnCallPolicyRunWaitingMessage } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import { getAiHoldTimeInMinutes } from "../../../Types/OnCallDutyPolicy/OnCallPolicyAiHold";
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
 *
 * A rule set to After OneUptime AI holds its runs for its hold time, while
 * AI works (OnCallPolicyAiHold) - but only for a record the rule engine found
 * OneUptime AI may respond first to (AiFirstResponderEligibility), which it
 * says here. For any other record, and for an episode, the rule pages right
 * away: AI holds a page only where it can fix something.
 */

// The hold on a run: when it starts paging, and what it says until then.
export interface OnCallRulePagingHold {
  pagingStartsAt: Date;
  waitingStatusMessage: string;
  // Held while OneUptime AI works (OnCallPolicyAiHold), not for working hours.
  isAiHold?: boolean | undefined;
}

/*
 * What a rule engine found about one record before it asked for holds:
 * whether OneUptime AI may respond first to it (AiFirstResponderEligibility).
 * Absent, a rule set to After OneUptime AI pages right away.
 */
export interface OneUptimeAiHoldContext {
  canHold: boolean;
}

// What a rule says about when it pages (OnCallRuleBaseModel).
export interface OnCallRuleWhenToPageSettings {
  id?: { toString: () => string } | null | undefined;
  whenToPage?: OnCallRuleWhenToPage | string | null | undefined;
  workingHours?: RestrictionTimes | null | undefined;
  workingHoursTimezone?: string | null | undefined;
  aiHoldTimeInMinutes?: number | null | undefined;
}

// The columns a rule engine reads to know when a rule pages.
export const ON_CALL_RULE_WHEN_TO_PAGE_SELECT: {
  whenToPage: true;
  workingHours: true;
  workingHoursTimezone: true;
  aiHoldTimeInMinutes: true;
} = {
  whenToPage: true,
  workingHours: true,
  workingHoursTimezone: true,
  aiHoldTimeInMinutes: true,
};

export default class OnCallRulePagingHoldUtil {
  /*
   * The hold a rule puts on the runs it starts now: null when they page
   * right away - a rule that pages right away, a working-hours rule inside
   * its hours, one whose hours never open, or an After OneUptime AI rule for
   * a record AI may not respond first to.
   */
  public static getHold(
    rule: OnCallRuleWhenToPageSettings,
    now: Date,
    ai?: OneUptimeAiHoldContext | undefined,
  ): OnCallRulePagingHold | null {
    if (rule.whenToPage === OnCallRuleWhenToPage.AfterOneUptimeAI) {
      return this.getAiHold(rule, now, ai);
    }

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

  /*
   * Whether a rule a record matches pages its policies now: not while it
   * holds them. A rule set to After OneUptime AI never counts: the runs it
   * holds start when AI hands them off or their hold time runs out
   * (AiFirstResponder), not because a record changed - and one that holds
   * nothing started its runs at once already.
   */
  public static isPagingNow(
    rule: OnCallRuleWhenToPageSettings,
    now: Date,
  ): boolean {
    if (rule.whenToPage === OnCallRuleWhenToPage.AfterOneUptimeAI) {
      return false;
    }

    return this.getHold(rule, now) === null;
  }

  /*
   * An After OneUptime AI rule's hold: its hold time from now, for a record AI
   * may respond first to. Said in the run's waiting message, read in the
   * rule's working-hours time zone when it has one.
   */
  private static getAiHold(
    rule: OnCallRuleWhenToPageSettings,
    now: Date,
    ai: OneUptimeAiHoldContext | undefined,
  ): OnCallRulePagingHold | null {
    if (!ai?.canHold) {
      return null;
    }

    const pagingStartsAt: Date = OneUptimeDate.addRemoveMinutes(
      now,
      getAiHoldTimeInMinutes(rule.aiHoldTimeInMinutes),
    );

    return {
      pagingStartsAt: pagingStartsAt,
      waitingStatusMessage: getOnCallPolicyRunWaitingMessage({
        pagingStartsAt: pagingStartsAt,
        timezone: rule.workingHoursTimezone || undefined,
        now: now,
        isWaitingForWorkingHours: false,
        isWaitingForOneUptimeAI: true,
      }),
      isAiHold: true,
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

  /*
   * A rule the record matched, and the policies it pages. `ai` says whether
   * OneUptime AI may respond first to the record, for a rule set to After
   * OneUptime AI.
   */
  public addRule(
    rule: OnCallRuleWhenToPageSettings,
    policyIds: Array<string>,
    ai?: OneUptimeAiHoldContext | undefined,
  ): void {
    const hold: OnCallRulePagingHold | null = OnCallRulePagingHoldUtil.getHold(
      rule,
      this.now,
      ai,
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
