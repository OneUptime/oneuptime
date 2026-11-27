import { CloudBudgetCostGroupOption } from "./CloudBudgetScopeTarget";
import useCloudCostRuleContext, {
  CloudCostRuleContext,
} from "../CostGroups/UseCloudCostRuleContext";
import useCloudAccounts, {
  CloudAccountRow,
  CloudAccountsRead,
} from "../UseCloudAccounts";
import CloudCostGroup from "Common/Models/DatabaseModels/CloudCostGroup";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { CLOUD_COST_MAX_GROUPS_PER_VIEW } from "Common/Types/Cloud/CloudCostAllocation";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useEffect, useState } from "react";

/*
 * WHAT A BUDGET'S FORM OFFERS (#11008): the project's accounts and cost
 * groups to count, and what a filter is written with - the cost groups'
 * rule editor's names and options. The currency a new budget starts in is
 * the one most of the accounts are billed in.
 */

export interface CloudBudgetFormContext {
  accountsRead: CloudAccountsRead;
  accounts: Array<{ id: string; name: string }>;
  costGroups: Array<CloudBudgetCostGroupOption>;
  ruleContext: CloudCostRuleContext;
  currency: string;
}

// The groups a budget can be for: every view's, each named with its view.
export async function fetchCloudBudgetCostGroups(): Promise<
  Array<CloudBudgetCostGroupOption>
> {
  const result: ListResult<CloudCostGroup> =
    await ModelAPI.getList<CloudCostGroup>({
      modelType: CloudCostGroup,
      query: {},
      select: {
        _id: true,
        name: true,
        cloudCostView: { name: true },
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: CLOUD_COST_MAX_GROUPS_PER_VIEW,
    });

  return result.data
    .filter((group: CloudCostGroup): boolean => {
      return Boolean(group.id);
    })
    .map((group: CloudCostGroup): CloudBudgetCostGroupOption => {
      return {
        id: group.id!.toString(),
        name: group.name || "",
        viewName: group.cloudCostView?.name || "",
      };
    });
}

export default function useCloudBudgetFormContext(): CloudBudgetFormContext {
  const accountsRead: CloudAccountsRead = useCloudAccounts();
  const currency: string = accountsRead.totals.costs.currency;
  const ruleContext: CloudCostRuleContext = useCloudCostRuleContext({
    accounts: accountsRead.accounts,
    currency,
  });
  const [costGroups, setCostGroups] = useState<
    Array<CloudBudgetCostGroupOption>
  >([]);

  useEffect(() => {
    let ignore: boolean = false;

    fetchCloudBudgetCostGroups()
      .then((groups: Array<CloudBudgetCostGroupOption>): void => {
        if (!ignore) {
          setCostGroups(groups);
        }
      })
      .catch((): void => {
        // No groups to offer: the form says so, and the other scopes stay.
      });

    return (): void => {
      ignore = true;
    };
  }, []);

  return {
    accountsRead,
    accounts: accountsRead.accounts.map(
      (account: CloudAccountRow): { id: string; name: string } => {
        return { id: account.id.toString(), name: account.name };
      },
    ),
    costGroups,
    ruleContext,
    currency,
  };
}
