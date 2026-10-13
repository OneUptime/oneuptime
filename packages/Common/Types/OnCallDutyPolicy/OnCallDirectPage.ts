import ObjectID from "../ObjectID";
import { DEFAULT_ESCALATE_AFTER_IN_MINUTES } from "./EscalationRuleDefaults";

/*
 * A DIRECT PAGE: PEOPLE PAGED WITH NO ON-CALL POLICY BEHIND THE PAGE.
 *
 * An on-call policy pages through its escalation rules: rule 1, wait, rule
 * 2, and round again. A direct page names who to page - people one by one,
 * every member of a team, whoever is on call in a schedule right now - and
 * pages all of them once, straight away. It has no rules, no waits and no
 * repeats; a workflow that wants more decides what happens next itself.
 *
 * Everything else is an on-call run's: it is about an incident or an alert,
 * each person is reached through their own On-Call Rules (call, SMS, push,
 * email, now or after some minutes, repeating until acknowledged),
 * acknowledging a page acknowledges the record and stops the paging, people
 * who are away are covered or skipped as their user overrides say, and the
 * run is one message in Slack and Microsoft Teams, edited as it goes.
 *
 * So a direct page is kept where an on-call run is - an
 * OnCallDutyPolicyExecutionLog, its timeline, a UserOnCallLog a person - with
 * no policy and no escalation rule on any of them. This file is what says
 * which is which, and holds the words a direct page's run is given.
 */

// Who a direct page names. A page names at least one of them.
export interface OnCallDirectPageTargets {
  userIds: Array<ObjectID>;
  teamIds: Array<ObjectID>;
  onCallScheduleIds: Array<ObjectID>;
}

/*
 * Whether a run - or a step of one, or a person's page - is a direct page's:
 * it names no on-call policy, by its id or by the policy read with it.
 * Asked only of a row read WITH its onCallDutyPolicyId or its policy: one
 * read without either would look like a direct page too.
 */
export function isOnCallDirectPage(run: {
  onCallDutyPolicyId?: ObjectID | string | null | undefined;
  onCallDutyPolicy?: unknown;
}): boolean {
  return !run.onCallDutyPolicyId && !run.onCallDutyPolicy;
}

// How many targets a page names, of every kind.
export function countOnCallDirectPageTargets(
  targets: OnCallDirectPageTargets,
): number {
  return (
    targets.userIds.length +
    targets.teamIds.length +
    targets.onCallScheduleIds.length
  );
}

/*
 * The most people, teams and schedules one direct page names. A page is a
 * phone call or an SMS for each person it reaches, at once: a list this
 * long is a mistake in whatever built it - a query that matched everybody -
 * rather than a page somebody meant.
 */
export const MAX_ON_CALL_DIRECT_PAGE_TARGETS: number = 100;

/*
 * How long a direct page waits for somebody to acknowledge before its run
 * ends as "nobody acknowledged": as long as a new escalation rule waits
 * before the next level is paged.
 *
 * A page is over once each person's On-Call Rules have sent everything they
 * had to send - for somebody with one rule that sends an SMS at once, a
 * minute after the page went out. Ending the run then would tell the
 * record's channel "nobody has acknowledged" before anybody could have. So
 * the run stays open for this long at least, and for as long after it as
 * pages are still going out (a call after an hour, a push that repeats).
 */
export const ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES: number =
  DEFAULT_ESCALATE_AFTER_IN_MINUTES;

/*
 * Whether a direct page whose paging started at `pagingStartedAt` has
 * waited that long by `at`. A start that cannot be read counts as waited:
 * a run is never held open by a date nobody can make sense of.
 */
export function hasOnCallDirectPageWaitedForAcknowledgement(data: {
  pagingStartedAt: Date | null | undefined;
  at: Date;
}): boolean {
  const startedAt: number = data.pagingStartedAt
    ? new Date(data.pagingStartedAt).getTime()
    : NaN;

  if (isNaN(startedAt)) {
    return true;
  }

  return (
    data.at.getTime() - startedAt >=
    ON_CALL_DIRECT_PAGE_ACKNOWLEDGE_WAIT_IN_MINUTES * 60 * 1000
  );
}

/*
 * What a create of an execution log that names no policy is told, unless it
 * is OneUptime's own direct page: an API call, or a workflow's Create One
 * On-Call Duty Execution Log step, still has to say which policy it runs.
 */
export const ON_CALL_POLICY_REQUIRED_MESSAGE: string =
  "On-Call Policy ID is required. To page people, a team or an on-call schedule without an on-call policy, use a workflow's Page Users, Page a Team or Page Whoever Is On Call step.";

/*
 * What a direct page's run says while its pages are out: how many people it
 * paged. The run's Slack and Microsoft Teams message and the record's feed
 * name them; this is the line the run itself carries.
 */
export function getOnCallDirectPagePagingMessage(pagedCount: number): string {
  return pagedCount === 1
    ? "1 person was paged."
    : `${pagedCount} people were paged.`;
}

/*
 * What the run of a direct page that reached nobody says. Why is on its
 * timeline, a line for each person, team and schedule it named.
 */
export const ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE: string =
  "Nobody was paged.";

/*
 * The timeline's line for a team a direct page names that has nobody in it:
 * no accepted member to page.
 */
export const ON_CALL_DIRECT_PAGE_EMPTY_TEAM_TIMELINE_MESSAGE: string =
  "Skipped because this team has no members.";

// The timeline's line for a direct page that found nobody to page at all.
export const ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE: string =
  "Skipped because there was nobody to page.";

/*
 * What the run of a direct page says when it was stopped for standing still:
 * its paging began and never finished, or never began at all
 * (OnCallDutyPolicyExecutionLog:TimeoutStuckExecutions). A policy's run is
 * told "Policy Execution timed out."; a direct page has no policy to name.
 */
export const ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE: string =
  "Paging timed out.";
export const ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE: string =
  "Paging never started and was timed out.";
