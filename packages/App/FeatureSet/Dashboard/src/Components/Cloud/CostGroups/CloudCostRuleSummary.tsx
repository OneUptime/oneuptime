import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import {
  CloudCostRule,
  CloudCostRuleCondition,
  CloudCostRuleField,
  CloudCostRuleOperator,
} from "Common/Types/Cloud/CloudCostRules";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  CONDITION_OR,
  CONDITION_SENTENCES,
  EMPTY_VALUE,
  getFieldLabel,
  GROUP_RULES_NONE,
  RULE_EDITOR_AND,
  RULE_EDITOR_OR,
  TAG_FIELD,
  VALUE_GONE,
} from "./CloudCostGroupWords";

/*
 * A group's rules as sentences: "Tag team is payments", or "Account is
 * Production AWS", or "Owner team is Payments" - each condition one sentence
 * of the reader's language with its field and its values as slots, and the
 * values drawn as chips: a record's name as its project wrote it, a cloud's
 * value as the cloud writes it.
 */

// The names a rule's records are shown by, by their IDs in lower case.
export interface CloudCostRuleNames {
  accounts: Map<string, string>;
  teams: Map<string, string>;
  labels: Map<string, string>;
  clusters: Map<string, string>;
  environments: Map<string, string>;
  apps: Map<string, string>;
  /*
   * The IDs, in lower case, of values archived since (a label): still
   * named where a rule names them, never offered for a new pick.
   */
  archived: Set<string>;
}

export function emptyCloudCostRuleNames(): CloudCostRuleNames {
  return {
    accounts: new Map(),
    teams: new Map(),
    labels: new Map(),
    clusters: new Map(),
    environments: new Map(),
    apps: new Map(),
    archived: new Set(),
  };
}

// The names a field's values are shown by, when they are records' IDs.
export function getNamesOf(
  names: CloudCostRuleNames,
  field: CloudCostRuleField,
): Map<string, string> | null {
  switch (field) {
    case CloudCostRuleField.Account:
      return names.accounts;
    case CloudCostRuleField.OwnerTeam:
      return names.teams;
    case CloudCostRuleField.Label:
      return names.labels;
    case CloudCostRuleField.KubernetesCluster:
      return names.clusters;
    case CloudCostRuleField.Environment:
      return names.environments;
    case CloudCostRuleField.App:
      return names.apps;
    default:
      return null;
  }
}

export interface CloudCostValueText {
  text: string;
  // Written by its project or its cloud: drawn as written.
  isAsWritten: boolean;
}

// How a condition's value reads: a record's name, a cloud's name, or as written.
export function getCloudCostValueText(data: {
  field: CloudCostRuleField;
  value: string;
  names: CloudCostRuleNames;
}): CloudCostValueText {
  const names: Map<string, string> | null = getNamesOf(data.names, data.field);

  if (names) {
    const name: string | undefined = names.get(data.value.toLowerCase());
    return name
      ? { text: name, isAsWritten: true }
      : { text: VALUE_GONE, isAsWritten: false };
  }

  if (data.field === CloudCostRuleField.Provider) {
    return { text: getCloudProviderLabel(data.value), isAsWritten: true };
  }

  if (!data.value) {
    return { text: EMPTY_VALUE, isAsWritten: false };
  }

  return { text: data.value, isAsWritten: true };
}

export const CloudCostConditionSentence: FunctionComponent<{
  condition: CloudCostRuleCondition;
  names: CloudCostRuleNames;
}> = (props: {
  condition: CloudCostRuleCondition;
  names: CloudCostRuleNames;
}): ReactElement => {
  const translator: Translator = useTranslator();
  const field: string =
    props.condition.field === CloudCostRuleField.Tag
      ? translator.translateTemplate(TAG_FIELD, {
          key: props.condition.key || "",
        })
      : getFieldLabel(props.condition.field, translator);
  const isValueless: boolean =
    props.condition.operator === CloudCostRuleOperator.Exists ||
    props.condition.operator === CloudCostRuleOperator.DoesNotExist;

  return (
    <span data-testid="cloud-cost-condition">
      <TranslatedSentence
        template={CONDITION_SENTENCES[props.condition.operator]}
        slots={{
          field: <span className="font-medium text-gray-900">{field}</span>,
          values: isValueless ? (
            <></>
          ) : (
            <span className="inline-flex flex-wrap items-center gap-1 align-middle">
              {props.condition.values.map(
                (value: string, index: number): ReactElement => {
                  const shown: CloudCostValueText = getCloudCostValueText({
                    field: props.condition.field,
                    value,
                    names: props.names,
                  });

                  return (
                    <span
                      key={`${value}-${index}`}
                      className="inline-flex items-center gap-1"
                    >
                      {index > 0 ? (
                        <span className="text-xs text-gray-500">
                          {translator.translateText(CONDITION_OR)}
                        </span>
                      ) : (
                        <></>
                      )}
                      <Pill
                        text={shown.text}
                        isUserContent={shown.isAsWritten}
                        tone={PillTone.Neutral}
                        isDotHidden={true}
                        dataTestId="cloud-cost-condition-value"
                      />
                    </span>
                  );
                },
              )}
            </span>
          ),
        }}
      />
    </span>
  );
};

const CloudCostRuleSummary: FunctionComponent<{
  rules: Array<CloudCostRule>;
  names: CloudCostRuleNames;
}> = (props: {
  rules: Array<CloudCostRule>;
  names: CloudCostRuleNames;
}): ReactElement => {
  const translator: Translator = useTranslator();

  if (props.rules.length === 0) {
    return (
      <p
        className="text-sm text-gray-500"
        data-testid="cloud-cost-rule-summary-empty"
      >
        {translator.translateText(GROUP_RULES_NONE)}
      </p>
    );
  }

  return (
    <ul
      className="space-y-1.5 text-sm text-gray-700"
      data-testid="cloud-cost-rule-summary"
    >
      {props.rules.map((rule: CloudCostRule, ruleIndex: number) => {
        return (
          <li
            key={ruleIndex}
            className="flex flex-wrap items-center gap-x-2 gap-y-1"
          >
            {ruleIndex > 0 ? (
              <span className="text-xs font-medium uppercase text-gray-500">
                {translator.translateText(RULE_EDITOR_OR)}
              </span>
            ) : (
              <></>
            )}
            {rule.conditions.map(
              (condition: CloudCostRuleCondition, index: number) => {
                return (
                  <span
                    key={index}
                    className="inline-flex flex-wrap items-center gap-x-2"
                  >
                    {index > 0 ? (
                      <span className="text-xs text-gray-500">
                        {translator.translateText(RULE_EDITOR_AND)}
                      </span>
                    ) : (
                      <></>
                    )}
                    <CloudCostConditionSentence
                      condition={condition}
                      names={props.names}
                    />
                  </span>
                );
              },
            )}
          </li>
        );
      })}
    </ul>
  );
};

export default CloudCostRuleSummary;
