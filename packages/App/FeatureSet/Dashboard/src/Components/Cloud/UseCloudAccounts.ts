import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  CloudAccountCostSummary,
  CloudAccountSavingsSummary,
  CloudCostTotals,
  CloudSavingsTotals,
  readCloudAccountCostSummary,
  readCloudAccountSavingsSummary,
  totalCloudCosts,
  totalCloudSavings,
} from "Common/Types/Cloud/CloudCost";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { useCallback, useEffect, useMemo, useState } from "react";

/*
 * The project's cloud accounts as the Cloud Overview, Costs, Savings and
 * Budgets read them: each with how it is read, how many resources it holds,
 * what it costs and what it could save (its summaries), and all of them as
 * one - costs and savings in the currency most of them are billed in. One
 * list read, since the summaries are on the accounts; Refresh reads it
 * again.
 */

export interface CloudAccountRow {
  id: ObjectID;
  name: string;
  provider: string;
  accountId: string;
  lastSeenAt: Date | null;
  hasConnection: boolean;
  resourceCount: number;
  costSummary: CloudAccountCostSummary | null;
  savingsSummary: CloudAccountSavingsSummary | null;
}

export interface CloudAccountsTotals {
  costs: CloudCostTotals;
  savings: CloudSavingsTotals;
  resources: number;
}

export interface CloudAccountsRead {
  accounts: Array<CloudAccountRow>;
  totals: CloudAccountsTotals;
  isLoading: boolean;
  error: string;
  refresh: () => void;
}

export function toCloudAccountRow(
  account: CloudAccount,
): CloudAccountRow | null {
  if (!account._id) {
    return null;
  }

  return {
    id: new ObjectID(account._id.toString()),
    name:
      (account.name as string) ||
      (account.providerAccountName as string) ||
      (account.accountId as string) ||
      "",
    provider: (account.provider as string) || "",
    accountId: (account.accountId as string) || "",
    lastSeenAt: account.lastSeenAt ? new Date(account.lastSeenAt) : null,
    hasConnection: Boolean(account.cloudConnectionId),
    resourceCount: Number(account.resourceCount) || 0,
    costSummary: readCloudAccountCostSummary(account.costSummary),
    savingsSummary: readCloudAccountSavingsSummary(account.savingsSummary),
  };
}

// Every account as one: costs first, savings in the costs' currency.
export function totalCloudAccounts(
  accounts: Array<CloudAccountRow>,
): CloudAccountsTotals {
  const costs: CloudCostTotals = totalCloudCosts(
    accounts.map((account: CloudAccountRow): CloudAccountCostSummary | null => {
      return account.costSummary;
    }),
  );

  return {
    costs,
    savings: totalCloudSavings({
      summaries: accounts.map(
        (account: CloudAccountRow): CloudAccountSavingsSummary | null => {
          return account.savingsSummary;
        },
      ),
      currency: costs.accountsRead > 0 ? costs.currency : undefined,
    }),
    resources: accounts.reduce((sum: number, account: CloudAccountRow) => {
      return sum + account.resourceCount;
    }, 0),
  };
}

// Every account, or the one of an account's own tab.
export async function fetchCloudAccounts(
  cloudAccountId?: ObjectID | undefined,
): Promise<Array<CloudAccountRow>> {
  const result: ListResult<CloudAccount> = await ModelAPI.getList<CloudAccount>(
    {
      modelType: CloudAccount,
      query: cloudAccountId ? { _id: cloudAccountId } : {},
      select: {
        _id: true,
        name: true,
        provider: true,
        accountId: true,
        providerAccountName: true,
        lastSeenAt: true,
        cloudConnectionId: true,
        resourceCount: true,
        costSummary: true,
        savingsSummary: true,
      },
      sort: { name: SortOrder.Ascending },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    },
  );

  return result.data
    .map(toCloudAccountRow)
    .filter((row: CloudAccountRow | null): row is CloudAccountRow => {
      return row !== null;
    });
}

export default function useCloudAccounts(
  cloudAccountId?: ObjectID | undefined,
): CloudAccountsRead {
  const [accounts, setAccounts] = useState<Array<CloudAccountRow>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);

  const refresh: () => void = useCallback((): void => {
    setAttempt((value: number): number => {
      return value + 1;
    });
  }, []);

  useEffect(() => {
    let ignore: boolean = false;

    setIsLoading(true);

    fetchCloudAccounts(cloudAccountId)
      .then((rows: Array<CloudAccountRow>): void => {
        if (!ignore) {
          setAccounts(rows);
          setError("");
          setIsLoading(false);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
          setIsLoading(false);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [attempt, cloudAccountId?.toString()]);

  const totals: CloudAccountsTotals = useMemo((): CloudAccountsTotals => {
    return totalCloudAccounts(accounts);
  }, [accounts]);

  return {
    accounts,
    totals,
    isLoading,
    error,
    refresh,
  };
}
