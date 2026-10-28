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
 * An alert or incident rule can also let OneUptime AI respond first
 * (OnCallPolicyAiHold): when AI may fix what the record is about, the run
 * waits while AI investigates and fixes, for at most the rule's
 * aiHoldTimeInMinutes, and pages only if AI hands it off or its time runs
 * out. When AI may not fix anything there, the rule pages right away. An
 * episode rule that names it pages right away: AI investigates alerts and
 * incidents, not episodes.
 *
 * A record that two rules page the same policy for pages it as soon as
 * either lets it: right away wins, and of two rules that wait, the one whose
 * wait ends first (OnCallRulePagingHold).
 */
enum OnCallRuleWhenToPage {
  RightAway = "Right Away",
  WorkingHours = "Working Hours",
  AfterOneUptimeAI = "After OneUptime AI",
}

export default OnCallRuleWhenToPage;
