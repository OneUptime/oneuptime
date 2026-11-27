import {
  ACCOUNT_REQUIRED,
  COST_GROUP_REQUIRED,
  FILTER_HELP,
  FILTER_REQUIRED,
  NO_COST_GROUPS,
  PICK_ACCOUNT,
  PICK_COST_GROUP,
} from "./CloudBudgetWords";
import CloudCostRuleEditor, {
  CloudCostRuleOptions,
} from "../CostGroups/CloudCostRuleEditor";
import { CloudCostRuleNames } from "../CostGroups/CloudCostRuleSummary";
import { CloudBudgetScope } from "Common/Types/Cloud/CloudBudget";
import {
  CloudCostRule,
  CloudCostRuleCondition,
} from "Common/Types/Cloud/CloudCostRules";
import Dropdown, {
  DropdownOption,
  DropdownOptionGroup,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import FieldError from "Common/UI/Components/Forms/Fields/FieldError";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A BUDGET OF ONE ACCOUNT, ONE COST GROUP OR A FILTER COUNTS: the one
 * pick its scope needs, under its Applies To, in a budget's form (#11008).
 * One account from the project's accounts; one cost group, listed under
 * its view's name; or a filter, written with the cost groups' own rule
 * editor - "Service is Amazon EC2 and Region is eu-west-1".
 *
 * It draws its own label (the pick a scope needs has a name of its own),
 * and hands its pick to the form, which keeps it in the budget's columns
 * (cloudAccountId, cloudCostGroupId, filterRules: CloudBudgetForm).
 */

export const ACCOUNT_LABEL: string = translationKey("Account");
export const COST_GROUP_LABEL: string = translationKey("Cost Group");
export const FILTER_LABEL: string = translationKey("Filter");

export interface CloudBudgetScopeTargetValue {
  cloudAccountId: string | null;
  cloudCostGroupId: string | null;
  filterRules: Array<CloudCostRule> | null;
}

export interface CloudBudgetCostGroupOption {
  id: string;
  name: string;
  viewName: string;
}

export interface ComponentProps {
  scope: CloudBudgetScope;
  value: CloudBudgetScopeTargetValue;
  onChange: (value: CloudBudgetScopeTargetValue) => void;
  accounts: Array<{ id: string; name: string }>;
  costGroups: Array<CloudBudgetCostGroupOption>;
  ruleNames: CloudCostRuleNames;
  ruleOptions: CloudCostRuleOptions;
  // The form asked for the pick: say what is missing, if anything.
  showProblem?: boolean | undefined;
}

// What a scope's pick is missing, as the form says it; null when it has it.
export function getCloudBudgetScopeTargetProblem(data: {
  scope: CloudBudgetScope;
  value: CloudBudgetScopeTargetValue;
}): string | null {
  if (data.scope === CloudBudgetScope.Account && !data.value.cloudAccountId) {
    return ACCOUNT_REQUIRED;
  }

  if (
    data.scope === CloudBudgetScope.CostGroup &&
    !data.value.cloudCostGroupId
  ) {
    return COST_GROUP_REQUIRED;
  }

  if (
    data.scope === CloudBudgetScope.Filter &&
    !(data.value.filterRules || []).some((rule: CloudCostRule): boolean => {
      return rule.conditions.some(
        (condition: CloudCostRuleCondition): boolean => {
          return Boolean(condition.field);
        },
      );
    })
  ) {
    return FILTER_REQUIRED;
  }

  return null;
}

// The cost groups as the picker lists them: each under its view's name.
export function getCloudBudgetCostGroupOptions(
  groups: Array<CloudBudgetCostGroupOption>,
): Array<DropdownOption | DropdownOptionGroup> {
  const byView: Map<string, Array<DropdownOption>> = new Map();

  for (const group of groups) {
    const options: Array<DropdownOption> = byView.get(group.viewName) || [];
    // A cost group's name, as its owner wrote it: never looked up.
    options.push({ label: group.name, value: group.id, isUserContent: true });
    byView.set(group.viewName, options);
  }

  return Array.from(byView.entries()).map(
    ([viewName, options]: [string, Array<DropdownOption>]) => {
      return { label: viewName, options };
    },
  );
}

const CloudBudgetScopeTarget: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const problem: string | null = props.showProblem
    ? getCloudBudgetScopeTargetProblem({
        scope: props.scope,
        value: props.value,
      })
    : null;
  const problemLine: ReactElement = problem ? (
    <FieldError message={problem} />
  ) : (
    <></>
  );

  if (props.scope === CloudBudgetScope.Account) {
    const options: Array<DropdownOption> = props.accounts.map(
      (account: { id: string; name: string }): DropdownOption => {
        return { label: account.name, value: account.id, isUserContent: true };
      },
    );

    return (
      <div data-testid="cloud-budget-scope-account">
        <label
          htmlFor="cloud-budget-account"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(ACCOUNT_LABEL)}
        </label>
        <div className="mt-1">
          <Dropdown
            inputId="cloud-budget-account"
            options={options}
            placeholder={PICK_ACCOUNT}
            isClearable={false}
            value={options.find((option: DropdownOption): boolean => {
              return option.value === props.value.cloudAccountId;
            })}
            onChange={(value: DropdownValue | Array<DropdownValue> | null) => {
              props.onChange({
                ...props.value,
                cloudAccountId: value ? String(value) : null,
              });
            }}
          />
        </div>
        {problemLine}
      </div>
    );
  }

  if (props.scope === CloudBudgetScope.CostGroup) {
    const options: Array<DropdownOption | DropdownOptionGroup> =
      getCloudBudgetCostGroupOptions(props.costGroups);
    const picked: DropdownOption | undefined = props.costGroups
      .filter((group: CloudBudgetCostGroupOption): boolean => {
        return group.id === props.value.cloudCostGroupId;
      })
      .map((group: CloudBudgetCostGroupOption): DropdownOption => {
        return { label: group.name, value: group.id, isUserContent: true };
      })[0];

    return (
      <div data-testid="cloud-budget-scope-cost-group">
        <label
          htmlFor="cloud-budget-cost-group"
          className="block text-sm font-medium text-gray-700"
        >
          {translator.translateText(COST_GROUP_LABEL)}
        </label>
        {props.costGroups.length === 0 ? (
          <p className="mt-1 text-sm text-gray-600">
            {translator.translateText(NO_COST_GROUPS)}
          </p>
        ) : (
          <div className="mt-1">
            <Dropdown
              inputId="cloud-budget-cost-group"
              options={options}
              placeholder={PICK_COST_GROUP}
              isClearable={false}
              value={picked}
              onChange={(
                value: DropdownValue | Array<DropdownValue> | null,
              ) => {
                props.onChange({
                  ...props.value,
                  cloudCostGroupId: value ? String(value) : null,
                });
              }}
            />
          </div>
        )}
        {problemLine}
      </div>
    );
  }

  if (props.scope === CloudBudgetScope.Filter) {
    return (
      <div data-testid="cloud-budget-scope-filter">
        <p className="block text-sm font-medium text-gray-700">
          {translator.translateText(FILTER_LABEL)}
        </p>
        <p className="mt-0.5 text-sm text-gray-500">
          {translator.translateText(FILTER_HELP)}
        </p>
        <div className="mt-2">
          <CloudCostRuleEditor
            value={props.value.filterRules || []}
            onChange={(rules: Array<CloudCostRule>) => {
              props.onChange({ ...props.value, filterRules: rules });
            }}
            names={props.ruleNames}
            options={props.ruleOptions}
            showProblem={Boolean(props.showProblem)}
          />
        </div>
        {problemLine}
      </div>
    );
  }

  return <></>;
};

export default CloudBudgetScopeTarget;
