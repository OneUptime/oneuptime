import Includes from "Common/Types/BaseDatabase/Includes";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/Types/Translator";
import { buildEnumFacetQuery } from "../ResourceOwners/FacetColumnQuery";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";

/*
 * APP PLATFORMS' LISTS, BY CLOUD ACCOUNT.
 *
 * An environment is one per platform, account and Region, named by its own
 * telemetry (cloud.account.id): the account an app runs in. Both of App
 * Platforms' lists - All Environments and All Apps - have a Cloud Account
 * chip, which keeps to the environments of the accounts picked (an app by
 * its environment's account), or to every other one.
 *
 * It is also how a count shown elsewhere reaches the rows behind it: Cloud's
 * Overview counts the environments and apps in the accounts Cloud reads,
 * and each count links to its list with the chip already set to those
 * accounts (AppPlatformsListRoutes) - visibly, editable and clearable.
 *
 * React-free, and free of the route map, so App's tests can read it.
 */

// All Environments' table (Pages/AppPlatforms/Environments.tsx): its id, and the namespace of its URL state.
export const APP_PLATFORMS_ENVIRONMENTS_TABLE_ID: string =
  "cloud-resources-table";

// All Apps' table (Pages/AppPlatforms/Apps.tsx).
export const APP_PLATFORMS_APPS_TABLE_ID: string = "app-platforms-apps-table";

// The chip's key in each list's facet state, and the environment's column it reads.
export const CLOUD_ACCOUNT_FACET_KEY: string = "cloudAccountId";

export const CLOUD_ACCOUNT_FACET_LABEL: string =
  translationKey("Cloud Account");

// One of these accounts, or none of them.
export const CLOUD_ACCOUNT_FACET_OPERATORS: Array<FilterOperator> = [
  "is",
  "is_not",
];

/*
 * An id no environment has: a chip that leaves no environment lists no app,
 * rather than asking for none (an empty list of ids).
 */
export const NO_ENVIRONMENT_ID: string = "00000000-0000-0000-0000-000000000000";

// What the chip reads of an environment.
export interface CloudAccountEnvironment {
  cloudProvider?: string | null | undefined;
  cloudAccountId?: string | null | undefined;
}

/*
 * The accounts the environments are in, each once, as the chip offers them:
 * the account as its telemetry names it (the value the list is filtered
 * by, exactly as stored), under its cloud's name. An environment that names
 * no account offers none. By cloud, then by account.
 */
export function getCloudAccountFacetOptions(
  environments: ReadonlyArray<CloudAccountEnvironment>,
): Array<FilterChipDropdownOption> {
  const byAccount: Map<string, string> = new Map<string, string>();

  for (const environment of environments) {
    const accountId: string = (environment.cloudAccountId || "").trim();

    if (accountId && !byAccount.has(accountId)) {
      byAccount.set(
        accountId,
        getCloudProviderLabel((environment.cloudProvider || "").trim()),
      );
    }
  }

  return Array.from(byAccount.entries())
    .sort((first: [string, string], second: [string, string]): number => {
      return (
        first[1].localeCompare(second[1]) || first[0].localeCompare(second[0])
      );
    })
    .map(
      ([accountId, provider]: [string, string]): FilterChipDropdownOption => {
        return {
          value: accountId,
          label: accountId,
          icon: IconProp.Cloud,
          ...(provider ? { group: provider } : {}),
        };
      },
    );
}

/*
 * The environments in the accounts picked - or, for "is not", in every
 * other account - by id. An environment that names no account is in
 * neither, as All Environments' own chip answers it (the server's NOT IN
 * leaves out a column that holds nothing): the same chip set the same way
 * keeps the same environments on both lists.
 */
export function getEnvironmentIdsForAccounts(data: {
  environments: ReadonlyMap<string, CloudAccountEnvironment>;
  accountIds: ReadonlyArray<string>;
  operator: FilterOperator;
}): Array<string> {
  const accounts: Set<string> = new Set<string>(
    data.accountIds.map((accountId: string): string => {
      return accountId.trim();
    }),
  );
  const ids: Array<string> = [];

  for (const [id, environment] of Array.from(data.environments.entries())) {
    const accountId: string = (environment.cloudAccountId || "").trim();

    if (!accountId) {
      continue;
    }

    const isInAccounts: boolean = accounts.has(accountId);

    if (data.operator === "is_not" ? !isInAccounts : isInAccounts) {
      ids.push(id);
    }
  }

  return ids;
}

/*
 * What All Apps asks for once the chip is set: the apps of those
 * environments. It stands in for the list's own "every environment listed
 * here", which it narrows: archived environments stay out either way.
 */
export function getAppsCloudAccountQueryValue(data: {
  environments: ReadonlyMap<string, CloudAccountEnvironment>;
  accountIds: ReadonlyArray<string>;
  operator: FilterOperator;
}): Includes {
  const ids: Array<string> = getEnvironmentIdsForAccounts(data);

  return new Includes(
    (ids.length > 0 ? ids : [NO_ENVIRONMENT_ID]).map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
  );
}

// All Environments' chip: the accounts its environments are in, read once.
export function getEnvironmentsCloudAccountFacet(
  fetchOptions: (
    projectId: ObjectID,
  ) => Promise<Array<FilterChipDropdownOption>>,
): ResourceFacet {
  return {
    key: CLOUD_ACCOUNT_FACET_KEY,
    label: CLOUD_ACCOUNT_FACET_LABEL,
    icon: IconProp.Cloud,
    isMultiSelect: true,
    supportedOperators: CLOUD_ACCOUNT_FACET_OPERATORS,
    fetchOptions: fetchOptions,
    toQueryValue: (
      values: Array<string>,
      operator: FilterOperator,
    ): unknown => {
      return buildEnumFacetQuery(values, operator, true);
    },
  };
}

/*
 * All Apps' chip: the accounts of the environments the list holds, which it
 * has read already, so it offers them at once; an app is filtered by its
 * environment.
 */
export function getAppsCloudAccountFacet(
  environments: ReadonlyMap<string, CloudAccountEnvironment>,
): ResourceFacet {
  return {
    key: CLOUD_ACCOUNT_FACET_KEY,
    label: CLOUD_ACCOUNT_FACET_LABEL,
    icon: IconProp.Cloud,
    isMultiSelect: true,
    supportedOperators: CLOUD_ACCOUNT_FACET_OPERATORS,
    options: getCloudAccountFacetOptions(Array.from(environments.values())),
    queryField: "cloudResourceId",
    toQueryValue: (
      values: Array<string>,
      operator: FilterOperator,
    ): unknown => {
      return getAppsCloudAccountQueryValue({
        environments,
        accountIds: values,
        operator,
      });
    },
  };
}
