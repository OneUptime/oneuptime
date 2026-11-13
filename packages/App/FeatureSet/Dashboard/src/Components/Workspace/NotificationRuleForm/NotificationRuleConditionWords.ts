import {
  ConditionType,
  NotificationRuleConditionCheckOn,
  NotificationRuleConditionUtil,
} from "Common/Types/Workspace/NotificationRules/NotificationRuleCondition";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A RULE'S CONDITION READS AS A SENTENCE.
 *
 *   If   [Incident Owner ]  [is any of ]  (Platform) (Jane Doe)
 *   And  [Incident Labels]  [has any of]  (Production)
 *   Or   [Incident Title ]  [contains  ]  [database]
 *
 * The Conditions step's rows and the rule's card say how a condition
 * compares in these words. They said it by the operator's stored value -
 * "Incident Owner Contains Any Jane", "Incident State Not Contains
 * Resolved" - which is the matcher's name for it, not words a reader checks
 * a record against.
 *
 * A field a record has one of - its state, its severity, the policy an
 * on-call rule is about - and its owners, named in the singular ("Incident
 * Owner"), read "is any of" and "is none of". A field a record has several
 * of, named in the plural - labels, monitors - reads "has any of", "has
 * none of" and "has all of". Text reads "equals", "contains", "starts
 * with" and the rest.
 *
 * What the rule stores does not change: the words stand for the operators
 * (ConditionType) the matcher reads.
 */

export const CONDITION_SENTENCE_WORDS: {
  readonly isAnyOf: string;
  readonly isNoneOf: string;
  readonly hasAnyOf: string;
  readonly hasNoneOf: string;
  readonly hasAllOf: string;
  readonly equals: string;
  readonly doesNotEqual: string;
  readonly contains: string;
  readonly doesNotContain: string;
  readonly startsWith: string;
  readonly endsWith: string;
  readonly isEmpty: string;
  readonly isNotEmpty: string;
} = {
  isAnyOf: translationKey("is any of"),
  isNoneOf: translationKey("is none of"),
  hasAnyOf: translationKey("has any of"),
  hasNoneOf: translationKey("has none of"),
  hasAllOf: translationKey("has all of"),
  equals: translationKey("equals"),
  doesNotEqual: translationKey("does not equal"),
  contains: translationKey("contains"),
  doesNotContain: translationKey("does not contain"),
  startsWith: translationKey("starts with"),
  endsWith: translationKey("ends with"),
  isEmpty: translationKey("is empty"),
  isNotEmpty: translationKey("is not empty"),
};

// The fields a record has several of, named in the plural.
export const PLURAL_CONDITION_FIELDS: ReadonlyArray<NotificationRuleConditionCheckOn> =
  [
    NotificationRuleConditionCheckOn.IncidentLabels,
    NotificationRuleConditionCheckOn.AlertLabels,
    NotificationRuleConditionCheckOn.AlertEpisodeLabels,
    NotificationRuleConditionCheckOn.IncidentEpisodeLabels,
    NotificationRuleConditionCheckOn.ScheduledMaintenanceLabels,
    NotificationRuleConditionCheckOn.MonitorLabels,
    NotificationRuleConditionCheckOn.OnCallDutyPolicyLabels,
    NotificationRuleConditionCheckOn.SecurityCaseLabels,
    NotificationRuleConditionCheckOn.SloLabels,
    NotificationRuleConditionCheckOn.Monitors,
  ];

/*
 * How a condition compares, in the words of its sentence (in English, to
 * look up): "is any of" for an incident's state, "has any of" for its
 * labels, "contains" for its title. An operator with no words of its own
 * here is said by its stored value, as it was.
 */
export const getConditionOperatorWords: (data: {
  checkOn: NotificationRuleConditionCheckOn | undefined;
  conditionType: ConditionType | undefined;
}) => string = (data: {
  checkOn: NotificationRuleConditionCheckOn | undefined;
  conditionType: ConditionType | undefined;
}): string => {
  if (!data.conditionType) {
    return "";
  }

  const isPicked: boolean =
    Boolean(data.checkOn) &&
    (NotificationRuleConditionUtil.isDropdownValueField({
      checkOn: data.checkOn,
      conditionType: data.conditionType,
    }) ||
      NotificationRuleConditionUtil.isOwnerCheckOn(data.checkOn));

  if (isPicked) {
    const isPlural: boolean = PLURAL_CONDITION_FIELDS.includes(data.checkOn!);

    switch (data.conditionType) {
      case ConditionType.ContainsAny:
      case ConditionType.Contains:
        return isPlural
          ? CONDITION_SENTENCE_WORDS.hasAnyOf
          : CONDITION_SENTENCE_WORDS.isAnyOf;
      case ConditionType.NotContains:
        return isPlural
          ? CONDITION_SENTENCE_WORDS.hasNoneOf
          : CONDITION_SENTENCE_WORDS.isNoneOf;
      case ConditionType.ContainsAll:
        return CONDITION_SENTENCE_WORDS.hasAllOf;
      default:
        return data.conditionType;
    }
  }

  switch (data.conditionType) {
    case ConditionType.EqualTo:
      return CONDITION_SENTENCE_WORDS.equals;
    case ConditionType.NotEqualTo:
      return CONDITION_SENTENCE_WORDS.doesNotEqual;
    case ConditionType.Contains:
      return CONDITION_SENTENCE_WORDS.contains;
    case ConditionType.NotContains:
      return CONDITION_SENTENCE_WORDS.doesNotContain;
    case ConditionType.StartsWith:
      return CONDITION_SENTENCE_WORDS.startsWith;
    case ConditionType.EndsWith:
      return CONDITION_SENTENCE_WORDS.endsWith;
    case ConditionType.IsEmpty:
      return CONDITION_SENTENCE_WORDS.isEmpty;
    case ConditionType.IsNotEmpty:
      return CONDITION_SENTENCE_WORDS.isNotEmpty;
    default:
      return data.conditionType;
  }
};

/*
 * A line under a field in the Conditions step's field list, only where two
 * fields could be taken for each other: an on-call rule picks its policies
 * from a list, or matches words in their names. Every other field is read
 * by its name alone, so the list stays one name a line to scan.
 */
export const CONDITION_FIELD_HINTS: Readonly<
  Partial<Record<NotificationRuleConditionCheckOn, string>>
> = {
  [NotificationRuleConditionCheckOn.OnCallDutyPolicies]: translationKey(
    "Pick policies from the list. Keeps matching a policy after it is renamed.",
  ),
  [NotificationRuleConditionCheckOn.OnCallDutyPolicyName]: translationKey(
    "Matches words in a policy's name. To keep matching a policy after it is renamed, use On-Call Policy.",
  ),
};

/*
 * Under an owners condition's people picker: who counts as an owner. A team
 * picked matches what the team owns, not what one of its members owns, and
 * a person picked does not match what their team owns.
 */
export const OWNER_CONDITION_HINT: string = translationKey(
  "Matches the people and teams added as owners. Team membership does not count.",
);

/*
 * Under an On-Call Policy Name condition's words: a renamed policy no
 * longer matches them, and On-Call Policy is what keeps matching it - said
 * where a rule written before policies could be picked types its name.
 */
export const POLICY_NAME_CONDITION_HINT: string = translationKey(
  "To keep matching a policy after it is renamed, use On-Call Policy.",
);

// The line under a field in the field list, if it has one (English, to look up).
export const getConditionFieldHint: (
  checkOn: NotificationRuleConditionCheckOn,
) => string | undefined = (
  checkOn: NotificationRuleConditionCheckOn,
): string | undefined => {
  return CONDITION_FIELD_HINTS[checkOn];
};

/*
 * The line under a condition's value, read with it, if the value needs one
 * (English, to look up): who counts as an owner, and what keeps matching a
 * policy a name condition names. A value picked from a list of the
 * project's own needs none: the list says what can be picked.
 */
export const getConditionValueHint: (
  checkOn: NotificationRuleConditionCheckOn,
) => string | undefined = (
  checkOn: NotificationRuleConditionCheckOn,
): string | undefined => {
  if (NotificationRuleConditionUtil.isOwnerCheckOn(checkOn)) {
    return OWNER_CONDITION_HINT;
  }

  if (checkOn === NotificationRuleConditionCheckOn.OnCallDutyPolicyName) {
    return POLICY_NAME_CONDITION_HINT;
  }

  return undefined;
};

/*
 * What a rule's view says for an id its condition holds that names nothing
 * now: a person who has left the project, a team or an on-call policy since
 * deleted. The rule still loads, and the condition can be changed.
 */
export const VALUE_NOT_FOUND_NAME: string = translationKey(
  "No longer in this project",
);
