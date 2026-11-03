import type FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAlertIncidentRuleWaitInMinutes } from "Common/Types/Alert/AlertIncidentRuleWait";
import {
  Translator,
  composedValue,
  getGlobalTranslator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import { formatGroupingDuration } from "../../Utils/GroupingRule/GroupingRuleSetup";
import {
  RULE_NAME_MAX_LENGTH,
  RuleNameFollowFunction,
  followPicksWithRuleName,
} from "../../Utils/Form/ResourceRuleForm";

/*
 * THE WORDS OF ALERTS → RULES → INCIDENT RULES (AlertIncidentRules).
 *
 * An alert incident rule declares an incident from the alerts it matches
 * (AlertIncidentRule). Its form asks what it matches, then what it
 * declares: the incident's severity - none picked is the alert's own,
 * mapped - and how long the alert must stay unresolved first. Its name is
 * filled in from the severity ("Declare SEV1 incidents") and follows the
 * pick while it is still the form's own, as every other rule form's does
 * (Utils/Form/ResourceRuleForm).
 *
 * Every sentence is a whole key, looked up when it is drawn, in the
 * reader's language.
 */

export const ALERT_INCIDENT_RULES_CARD_TITLE: string = "Alert Incident Rules";

export const ALERT_INCIDENT_RULES_CARD_DESCRIPTION: string = translationKey(
  "Declare an incident automatically from the alerts that match, right away or once an alert has stayed unresolved. The first rule that matches, from the top, decides.",
);

export const ALERT_INCIDENT_RULES_NO_ITEMS_MESSAGE: string = translationKey(
  "No alert incident rules yet. Alerts become incidents only when someone declares one.",
);

// The rule's name while no severity is picked: the alert's own, mapped.
export const ALERT_INCIDENT_RULE_DEFAULT_NAME: string =
  translationKey("Declare incidents");

// The rule's name once a severity is picked.
export const ALERT_INCIDENT_RULE_NAME_WITH_SEVERITY: string = translationKey(
  "Declare {{severity}} incidents",
);

export const ALERT_INCIDENT_RULE_NAME_DESCRIPTION: string = translationKey(
  "Filled in from the severity until you type a name of your own.",
);

export const ALERT_INCIDENT_RULE_SEVERITY_TITLE: string = "Incident Severity";

export const ALERT_INCIDENT_RULE_SEVERITY_DESCRIPTION: string = translationKey(
  "Leave empty to give each incident the severity that matches its alert's.",
);

// What no severity means, said where none is picked.
export const ALERT_INCIDENT_RULE_SAME_SEVERITY: string = translationKey(
  "Same as the alert's severity",
);

export const ALERT_INCIDENT_RULE_WAIT_TITLE: string = "Declare After (Minutes)";

export const ALERT_INCIDENT_RULE_WAIT_DESCRIPTION: string = translationKey(
  "0 declares the incident as soon as the alert is created. Otherwise, only if the alert is still unresolved after this many minutes.",
);

export const ALERT_INCIDENT_RULE_STATUS_PAGE_TITLE: string =
  "Show on Status Pages";

export const ALERT_INCIDENT_RULE_STATUS_PAGE_DESCRIPTION: string =
  translationKey(
    "Show the incident on the status pages that list its monitor, and notify their subscribers.",
  );

// The rules table's column of when a rule declares.
export const ALERT_INCIDENT_RULE_WHEN_COLUMN_TITLE: string = "Declares";

export const ALERT_INCIDENT_RULE_RIGHT_AWAY: string =
  translationKey("Right away");

export const ALERT_INCIDENT_RULE_IF_STILL_UNRESOLVED: string = translationKey(
  "If still unresolved after {{duration}}",
);

/*
 * "Declare SEV1 incidents", or "Declare incidents" when no severity is
 * picked, in the reader's language and cut to what the rule's Name column
 * holds.
 */
export const getAlertIncidentRuleName: (
  severityNames: Array<string>,
  translator?: Translator | undefined,
) => string = (
  severityNames: Array<string>,
  translator?: Translator | undefined,
): string => {
  const sentence: Translator = translator || getGlobalTranslator();

  const severityName: string = (
    severityNames.find((name: string): boolean => {
      return Boolean(name && name.trim());
    }) || ""
  ).trim();

  const name: string = severityName
    ? sentence.translateTemplate(ALERT_INCIDENT_RULE_NAME_WITH_SEVERITY, {
        severity: severityName,
      })
    : sentence.translateText(ALERT_INCIDENT_RULE_DEFAULT_NAME);

  return name.slice(0, RULE_NAME_MAX_LENGTH);
};

/*
 * A new rule picks no severity yet: it is named for declaring at the
 * alert's own, and declares right away until a wait is typed.
 */
export const getNewAlertIncidentRuleValues: <
  TEntity,
>() => FormValues<TEntity> = <TEntity>(): FormValues<TEntity> => {
  return {
    name: getAlertIncidentRuleName([]),
    declareAfterInMinutes: 0,
  } as unknown as FormValues<TEntity>;
};

// The severity picker's onChange: the name follows the severity picked.
export const followSeverityWithRuleName: <
  TEntity,
>() => RuleNameFollowFunction<TEntity> = <
  TEntity,
>(): RuleNameFollowFunction<TEntity> => {
  return followPicksWithRuleName<TEntity>(
    (severityNames: Array<string>): string => {
      return getAlertIncidentRuleName(severityNames);
    },
    (): string => {
      return getAlertIncidentRuleName([]);
    },
  );
};

/*
 * When a rule declares, as its row in the table says it: "Right away", or
 * "If still unresolved after 15 minutes" - the wait in the sentence's
 * language too, so a language that has not worded the sentence reads it
 * wholly in English.
 */
export const describeAlertIncidentRuleWhen: (
  declareAfterInMinutes: unknown,
  translator?: Translator | undefined,
) => string = (
  declareAfterInMinutes: unknown,
  translator?: Translator | undefined,
): string => {
  const sentence: Translator = translator || getGlobalTranslator();
  const minutes: number = getAlertIncidentRuleWaitInMinutes(
    declareAfterInMinutes,
  );

  if (minutes === 0) {
    return sentence.translateText(ALERT_INCIDENT_RULE_RIGHT_AWAY);
  }

  return sentence.translateTemplate(ALERT_INCIDENT_RULE_IF_STILL_UNRESOLVED, {
    duration: composedValue((wordsOf: Translator): string => {
      return formatGroupingDuration({
        minutes: minutes,
        translate: wordsOf.translateTemplate,
      });
    }),
  });
};
