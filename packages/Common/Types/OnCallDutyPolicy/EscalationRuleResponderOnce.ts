import {
  getRefusalText,
  RefusalWithValues,
} from "../Exception/RefusalWithValues";
import { translationKey } from "../Translator";

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

/*
 * The indexes, by name: each holds the rows not deleted (`"deletedAt" IS
 * NULL`), as every read reads them.
 */

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

/*
 * THE REFUSALS, IN THE READER'S LANGUAGE (#10465).
 *
 * Each refusal is a sentence with the names in it (RefusalWithValues): the
 * server refuses in English (getRefusalText), as the API, the CLI and
 * Terraform read it, and the Dashboard reads the names back out of the
 * English and says the sentence in the reader's language
 * (Common/UI/Utils/ErrorInSentence). Every value is a name someone typed - a
 * rule's, a policy's, a person's, a team's, a schedule's - said as written.
 *
 * One sentence for each kind of responder and each way a schedule is paged
 * (whoever is on call in it, or the next person in its rotation), and each
 * of them twice: for the rule by its name and its policy's, and for a rule
 * that could not be read ("This escalation rule ..."). A team's and a
 * schedule's names are required, and a person is named by their address
 * when they have no name, so none of them is blank; a team or a schedule
 * that is anyway is said in an English sentence of its own.
 *
 * A source of the Dashboard's string extractor (keys only).
 */

// A person named on a rule that pages them already.
export const PERSON_ON_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'The escalation rule "{{rule}}" of the on-call policy "{{policy}}" pages {{person}} already, so they were not added again.',
  ),
  terms: [],
};

export const PERSON_ON_UNREAD_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    "This escalation rule pages {{person}} already, so they were not added again.",
  ),
  terms: [],
};

// A team named on a rule that pages it already.
export const TEAM_ON_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'The escalation rule "{{rule}}" of the on-call policy "{{policy}}" pages the team "{{team}}" already, so it was not added again.',
  ),
  terms: [],
};

export const TEAM_ON_UNREAD_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'This escalation rule pages the team "{{team}}" already, so it was not added again.',
  ),
  terms: [],
};

// A schedule a rule pages whoever is on call in already.
export const SCHEDULE_ON_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'The escalation rule "{{rule}}" of the on-call policy "{{policy}}" pages whoever is on call in the on-call schedule "{{schedule}}" already, so the schedule was not added again.',
  ),
  terms: [],
};

export const SCHEDULE_ON_UNREAD_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'This escalation rule pages whoever is on call in the on-call schedule "{{schedule}}" already, so the schedule was not added again.',
  ),
  terms: [],
};

// A schedule a rule pages the next person in the rotation of already.
export const NEXT_IN_ROTATION_ON_RULE_ALREADY_REFUSAL: RefusalWithValues = {
  template: translationKey(
    'The escalation rule "{{rule}}" of the on-call policy "{{policy}}" pages the next person in the rotation of the on-call schedule "{{schedule}}" already, so the schedule was not added again.',
  ),
  terms: [],
};

export const NEXT_IN_ROTATION_ON_UNREAD_RULE_ALREADY_REFUSAL: RefusalWithValues =
  {
    template: translationKey(
      'This escalation rule pages the next person in the rotation of the on-call schedule "{{schedule}}" already, so the schedule was not added again.',
    ),
    terms: [],
  };

// Every refusal of a responder a rule pages already.
export const RESPONDER_ON_RULE_ALREADY_REFUSALS: ReadonlyArray<RefusalWithValues> =
  [
    PERSON_ON_RULE_ALREADY_REFUSAL,
    PERSON_ON_UNREAD_RULE_ALREADY_REFUSAL,
    TEAM_ON_RULE_ALREADY_REFUSAL,
    TEAM_ON_UNREAD_RULE_ALREADY_REFUSAL,
    SCHEDULE_ON_RULE_ALREADY_REFUSAL,
    SCHEDULE_ON_UNREAD_RULE_ALREADY_REFUSAL,
    NEXT_IN_ROTATION_ON_RULE_ALREADY_REFUSAL,
    NEXT_IN_ROTATION_ON_UNREAD_RULE_ALREADY_REFUSAL,
  ];

/*
 * The rule's names, as a refusal's sentence takes them: null for a rule
 * that could not be read, or whose name or policy's name is blank.
 */
const readRuleValues: (
  rule: EscalationRuleNames | null,
) => { rule: string; policy: string } | null = (
  rule: EscalationRuleNames | null,
): { rule: string; policy: string } | null => {
  if (!rule || !rule.ruleName.trim() || !rule.policyName.trim()) {
    return null;
  }

  return { rule: rule.ruleName.trim(), policy: rule.policyName.trim() };
};

/*
 * The rule as a sentence begins with it, for the one that names a responder
 * with a blank name (see above): English, as it always was.
 */
const theRule: (rule: EscalationRuleNames | null) => string = (
  rule: EscalationRuleNames | null,
): string => {
  const names: { rule: string; policy: string } | null = readRuleValues(rule);

  return names
    ? `The escalation rule "${names.rule}" of the on-call policy "${names.policy}"`
    : "This escalation rule";
};

// One of the two sentences of a responder: the rule by its names, or unread.
const fillRefusal: (data: {
  rule: EscalationRuleNames | null;
  named: RefusalWithValues;
  unread: RefusalWithValues;
  values: Record<string, string>;
}) => string = (data: {
  rule: EscalationRuleNames | null;
  named: RefusalWithValues;
  unread: RefusalWithValues;
  values: Record<string, string>;
}): string => {
  const names: { rule: string; policy: string } | null = readRuleValues(
    data.rule,
  );

  return names
    ? getRefusalText(data.named, { ...names, ...data.values })
    : getRefusalText(data.unread, data.values);
};

// A person named on a rule that pages them already.
export const getPersonOnRuleAlreadyRefusal: (data: {
  rule: EscalationRuleNames | null;
  person: string;
}) => string = (data: {
  rule: EscalationRuleNames | null;
  person: string;
}): string => {
  return fillRefusal({
    rule: data.rule,
    named: PERSON_ON_RULE_ALREADY_REFUSAL,
    unread: PERSON_ON_UNREAD_RULE_ALREADY_REFUSAL,
    values: { person: data.person.trim() || "this person" },
  });
};

// A team named on a rule that pages it already.
export const getTeamOnRuleAlreadyRefusal: (data: {
  rule: EscalationRuleNames | null;
  team: string;
}) => string = (data: {
  rule: EscalationRuleNames | null;
  team: string;
}): string => {
  if (!data.team.trim()) {
    return `${theRule(data.rule)} pages this team already, so it was not added again.`;
  }

  return fillRefusal({
    rule: data.rule,
    named: TEAM_ON_RULE_ALREADY_REFUSAL,
    unread: TEAM_ON_UNREAD_RULE_ALREADY_REFUSAL,
    values: { team: data.team.trim() },
  });
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
  if (!data.schedule.trim()) {
    const whom: string = data.pagesNextInRotation
      ? "the next person in the rotation of this on-call schedule"
      : "whoever is on call in this on-call schedule";

    return `${theRule(data.rule)} pages ${whom} already, so the schedule was not added again.`;
  }

  return fillRefusal({
    rule: data.rule,
    named: data.pagesNextInRotation
      ? NEXT_IN_ROTATION_ON_RULE_ALREADY_REFUSAL
      : SCHEDULE_ON_RULE_ALREADY_REFUSAL,
    unread: data.pagesNextInRotation
      ? NEXT_IN_ROTATION_ON_UNREAD_RULE_ALREADY_REFUSAL
      : SCHEDULE_ON_UNREAD_RULE_ALREADY_REFUSAL,
    values: { schedule: data.schedule.trim() },
  });
};
