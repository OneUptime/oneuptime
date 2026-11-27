import {
  ALL_ACCOUNTS_LABEL,
  COST_GROUP_GONE,
  FILTERED_COSTS,
} from "./CloudBudgetWords";
import CloudCostRuleSummary, {
  CloudCostRuleNames,
} from "../CostGroups/CloudCostRuleSummary";
import AppLink from "../../AppLink/AppLink";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import CloudBudget from "Common/Models/DatabaseModels/CloudBudget";
import Route from "Common/Types/API/Route";
import {
  CloudBudgetScope,
  readCloudBudgetScope,
} from "Common/Types/Cloud/CloudBudget";
import {
  CloudCostRule,
  readCloudCostRules,
} from "Common/Types/Cloud/CloudCostRules";
import ObjectID from "Common/Types/ObjectID";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * WHAT A BUDGET COUNTS, as its row and its page say it (#11008): every
 * account; the account, its costs one click away; the cost group, its page
 * one click away - or that it was deleted; or the filter's conditions, each
 * a sentence as a cost group's rules are written.
 */

// A budget's filter as stored; nothing when it no longer reads.
export function readBudgetFilterRules(value: unknown): Array<CloudCostRule> {
  try {
    return readCloudCostRules(value);
  } catch {
    return [];
  }
}

export interface ComponentProps {
  budget: CloudBudget;
  ruleNames: CloudCostRuleNames;
}

const CloudBudgetScopeCell: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const budget: CloudBudget = props.budget;
  const scope: CloudBudgetScope = readCloudBudgetScope({
    scope: budget.scope,
    cloudAccountId: budget.cloudAccountId,
  });

  if (scope === CloudBudgetScope.Account && budget.cloudAccountId) {
    return (
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
          { modelId: new ObjectID(budget.cloudAccountId.toString()) },
        )}
        className="break-words text-sm text-gray-900 hover:underline"
        dataTestId="cloud-budget-scope-account-link"
      >
        <bdi>{budget.cloudAccount?.name || ""}</bdi>
      </AppLink>
    );
  }

  if (scope === CloudBudgetScope.CostGroup) {
    if (!budget.cloudCostGroupId) {
      return (
        <span
          className="text-sm text-amber-700"
          data-testid="cloud-budget-scope-group-gone"
        >
          {translator.translateText(COST_GROUP_GONE)}
        </span>
      );
    }

    const viewId: ObjectID | undefined =
      budget.cloudCostGroup?.cloudCostViewId || undefined;

    return viewId ? (
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.CLOUD_COST_GROUP_VIEW] as Route,
          {
            modelId: new ObjectID(viewId.toString()),
            subModelId: new ObjectID(budget.cloudCostGroupId.toString()),
          },
        )}
        className="break-words text-sm text-gray-900 hover:underline"
        dataTestId="cloud-budget-scope-group-link"
      >
        <bdi>{budget.cloudCostGroup?.name || ""}</bdi>
      </AppLink>
    ) : (
      <span className="break-words text-sm text-gray-900">
        <bdi>{budget.cloudCostGroup?.name || ""}</bdi>
      </span>
    );
  }

  if (scope === CloudBudgetScope.Filter) {
    return (
      <div className="min-w-0" data-testid="cloud-budget-scope-filter-cell">
        <p className="text-xs font-medium text-gray-500">
          {translator.translateText(FILTERED_COSTS)}
        </p>
        <CloudCostRuleSummary
          rules={readBudgetFilterRules(budget.filterRules)}
          names={props.ruleNames}
        />
      </div>
    );
  }

  return (
    <span className="text-sm text-gray-700">
      {translator.translateText(ALL_ACCOUNTS_LABEL)}
    </span>
  );
};

export default CloudBudgetScopeCell;
