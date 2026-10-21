/*
 * WHEN AN ON-CALL RULE'S POLICIES PAGE.
 *
 * An alert, incident or episode on-call rule pages its policies as soon as a
 * record matches it, as rules always have - or only during working hours: a
 * record that matches it outside them gets a run that waits, and pages its
 * first escalation rule when the hours begin (OnCallDutyPolicyRunWait).
 * Severity routing lives on the same rules, so one policy can serve a "right
 * away" rule for P1 and P2 and a "working hours" rule for P3 and P4.
 *
 * The hours are the rule's workingHours - a schedule layer's restriction
 * times - read on the clock of its workingHoursTimezone (WorkingHours).
 *
 * A record that two rules page the same policy for pages it as soon as
 * either lets it: right away wins, and of two rules that wait, the one whose
 * hours begin first (OnCallRulePagingHold).
 */
enum OnCallRuleWhenToPage {
  RightAway = "Right Away",
  WorkingHours = "Working Hours",
}

export default OnCallRuleWhenToPage;
