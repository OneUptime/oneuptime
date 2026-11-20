/*
 * A RESPONDER IS ON AN ESCALATION RULE ONCE (#10411).
 *
 * The people, teams and on-call schedules an escalation rule pages are rows
 * of their own: OnCallDutyPolicyEscalationRuleUser, ...Team and ...Schedule.
 * Only the Dashboard and Ask AI looked for a row before adding one; the API,
 * Terraform, a workflow and two adds at the same moment wrote a second row
 * for the same person. A level pages each person once, whichever of its
 * targets names them (OnCallDutyPolicyEscalationRuleService.pageTargets),
 * but each row told them again that they were added to the policy, wrote
 * "Added" to the policy's feed and its Slack and Microsoft Teams channels
 * again, and was listed on the policy's page; and taking either row out told
 * them they were removed, and ended their on-call time, while the other row
 * still paged them.
 *
 * Now the database holds one row per responder of a rule: a partial unique
 * index on each table, of the rows not deleted, which the migration that
 * builds it makes room for by soft-deleting the newer copies
 * (1809187100000-MakeEscalationRuleRespondersUnique). The services refuse a
 * second row before it is written, in words that name the responder and the
 * rule, and refuse an add that loses a race to the index in the same words
 * (OnCallDutyPolicyEscalationRuleResponderService).
 *
 * A schedule is a responder of a rule once for each way the rule pages it:
 * whoever is on call in it, and the next person in its rotation, are two
 * rows of one rule (pageNextInRotation).
 *
 * The people of a schedule's layer are no such list: a layer is a turn
 * order, and a person in it twice takes two turns ([Alice, Bob, Alice,
 * Carol], UserOverrideUtil.getNextInRotation). One turn is on call at a
 * time, so nobody is paged twice by it, and it keeps taking a person twice.
 */

// The rows each index holds: those not deleted.
export const ESCALATION_RULE_RESPONDER_ROWS: string = '"deletedAt" IS NULL';

// One row per person on a rule.
export const ESCALATION_RULE_USER_INDEX: string =
  "IDX_OnCallDutyPolicyEscalationRuleUser_rule_user";

// One row per team on a rule.
export const ESCALATION_RULE_TEAM_INDEX: string =
  "IDX_OnCallDutyPolicyEscalationRuleTeam_rule_team";

// One row per schedule on a rule, for each way the rule pages it.
export const ESCALATION_RULE_SCHEDULE_INDEX: string =
  "IDX_OnCallDutyPolicyEscalationRuleSchedule_rule_schedule";

/*
 * The rule a refusal names: its name (the name of its level when it has
 * none of its own) and its policy's. Null when it could not be read - gone
 * since, say - and the refusal says "this escalation rule".
 */
export interface EscalationRuleNames {
  ruleName: string;
  policyName: string;
}

// The rule, as a refusal's sentence begins with it.
const theRule: (rule: EscalationRuleNames | null) => string = (
  rule: EscalationRuleNames | null,
): string => {
  if (!rule || !rule.ruleName.trim() || !rule.policyName.trim()) {
    return "This escalation rule";
  }

  return `The escalation rule "${rule.ruleName.trim()}" of the on-call policy "${rule.policyName.trim()}"`;
};

// A person named on a rule that pages them already.
export const getPersonOnRuleAlreadyRefusal: (data: {
  rule: EscalationRuleNames | null;
  person: string;
}) => string = (data: {
  rule: EscalationRuleNames | null;
  person: string;
}): string => {
  return `${theRule(data.rule)} pages ${data.person.trim() || "this person"} already, so they were not added again.`;
};

// A team named on a rule that pages it already.
export const getTeamOnRuleAlreadyRefusal: (data: {
  rule: EscalationRuleNames | null;
  team: string;
}) => string = (data: {
  rule: EscalationRuleNames | null;
  team: string;
}): string => {
  const team: string = data.team.trim()
    ? `the team "${data.team.trim()}"`
    : "this team";

  return `${theRule(data.rule)} pages ${team} already, so it was not added again.`;
};

/*
 * A schedule named on a rule that pages it already, the same way: whoever is
 * on call in it, or the next person in its rotation.
 */
export const getScheduleOnRuleAlreadyRefusal: (data: {
  rule: EscalationRuleNames | null;
  schedule: string;
  pagesNextInRotation: boolean;
}) => string = (data: {
  rule: EscalationRuleNames | null;
  schedule: string;
  pagesNextInRotation: boolean;
}): string => {
  const schedule: string = data.schedule.trim()
    ? `the on-call schedule "${data.schedule.trim()}"`
    : "this on-call schedule";
  const whom: string = data.pagesNextInRotation
    ? `the next person in the rotation of ${schedule}`
    : `whoever is on call in ${schedule}`;

  return `${theRule(data.rule)} pages ${whom} already, so the schedule was not added again.`;
};
