import Includes from "Common/Types/BaseDatabase/Includes";
import { getCloudProviderLabel } from "Common/Types/Cloud/CloudPlatform";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { translationKey } from "Common/Types/Translator";
import { getCloudAccountIdSpellings } from "../Cloud/CloudAccountScope";
import { buildEnumFacetQuery } from "../ResourceOwners/FacetColumnQuery";
import {
  FilterChipDropdownOption,
  FilterOperator,
} from "../ResourceOwners/FilterChipDropdownTypes";
import { ResourceFacet } from "../ResourceOwners/ResourceFacet";

/*
 * THE CLOUD ACCOUNT CHIP: APP PLATFORMS' LISTS AND CLOUD'S ALL RESOURCES.
 *
 * An environment is one per platform, account and Region, named by its own
 * telemetry (cloud.account.id): the account an app runs in. Both of App
 * Platforms' lists - All Environments and All Apps - have a Cloud Account
 * chip, which keeps to the environments of the accounts picked (an app by
 * its environment's account), or to every other one. Cloud's All Resources
 * has the same chip over its resources (getResourcesCloudAccountFacet).
 *
 * It is also how a count shown elsewhere reaches the rows behind it: Cloud's
 * Overview counts the environments and apps in the accounts Cloud reads,
 * and each count links to its list with the chip already set to those
 * accounts (AppPlatformsListRoutes) - visibly, editable and clearable; a
 * connection's resource count on Cloud > Connect opens All Resources with
 * it set to the accounts the connection reads.
 *
 * Each account is offered by the name Cloud > Accounts gives it - its
 * cloud's own name until someone renames it - with its id under it, for a
 * reader who may read the accounts; by its id otherwise, and for an account
 * no connection reads (one found from telemetry alone has no such name).
 * The chip filters by the id either way, in any case it is written in: an
 * Azure subscription's id is lower case in one API's answer and upper case
 * in another's, and the server counts both as one account
 * (CloudAccountScope).
 *
 * React-free, and free of the route map, so App's tests can read it.
 */

// All Environments' table (Pages/AppPlatforms/Environments.tsx): its id, and the namespace of its URL state.
export const APP_PLATFORMS_ENVIRONMENTS_TABLE_ID: string =
  "cloud-resources-table";

// All Apps' table (Pages/AppPlatforms/Apps.tsx).
export const APP_PLATFORMS_APPS_TABLE_ID: string = "app-platforms-apps-table";

// Cloud's All Resources table (Pages/Cloud/MonitoredResources.tsx).
export const CLOUD_RESOURCES_TABLE_ID: string =
  "cloud-monitored-resources-table";

// The chip's key in each list's facet state, and the column it reads.
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

// What the chip reads of an environment, or of a resource.
export interface CloudAccountEnvironment {
  cloudProvider?: string | null | undefined;
  cloudAccountId?: string | null | undefined;
}

/*
 * What Cloud > Accounts calls an account (CloudAccount.name), by its cloud
 * and its id there: read where the reader may read the accounts.
 */
export interface CloudAccountName {
  provider: string;
  accountId: string;
  name: string;
}

// An account's id as the chip compares it: trimmed, in any case.
function comparable(accountId: string | null | undefined): string {
  return (accountId || "").trim().toLowerCase();
}

// An account by its cloud and its id, in any case.
function accountKey(provider: string, accountId: string): string {
  return `${provider.trim().toLowerCase()}|${comparable(accountId)}`;
}

/*
 * Every id picked, as written and in lower and upper case, each once:
 * what the chip asks the server for, so an account's rows match whichever
 * way their id is written. A blank pick - only a hand-edited address makes
 * one - is kept as it is, so it matches no account rather than lifting the
 * chip.
 */
export function getCloudAccountIdsInEveryCase(
  accountIds: ReadonlyArray<string>,
): Array<string> {
  const ids: Set<string> = new Set<string>();

  for (const accountId of accountIds) {
    const spellings: Array<string> = getCloudAccountIdSpellings(accountId);

    for (const spelling of spellings.length > 0
      ? spellings
      : [accountId.trim()]) {
      ids.add(spelling);
    }
  }

  return Array.from(ids);
}

/*
 * The accounts the environments (or resources) are in, each once - in
 * whichever case its id is first written - as the chip offers them: the id
 * is the option's value, the value the list is filtered by; its label is
 * the account's name in Cloud > Accounts, with the id under it, or the id
 * alone where no name is read (a reader who may not read the accounts, an
 * account no connection reads, a name that is only the id again). Under
 * its cloud's name; by cloud, then by what the option says. An
 * environment that names no account offers none.
 */
export function getCloudAccountFacetOptions(
  environments: ReadonlyArray<CloudAccountEnvironment>,
  names: ReadonlyArray<CloudAccountName> = [],
): Array<FilterChipDropdownOption> {
  const nameOf: Map<string, string> = new Map<string, string>();

  for (const account of names) {
    const name: string = (account.name || "").trim();
    const key: string = accountKey(account.provider || "", account.accountId);

    if (name && comparable(account.accountId) && !nameOf.has(key)) {
      nameOf.set(key, name);
    }
  }

  const byAccount: Map<string, { accountId: string; provider: string }> =
    new Map<string, { accountId: string; provider: string }>();

  for (const environment of environments) {
    const accountId: string = (environment.cloudAccountId || "").trim();

    if (accountId && !byAccount.has(comparable(accountId))) {
      byAccount.set(comparable(accountId), {
        accountId,
        provider: (environment.cloudProvider || "").trim(),
      });
    }
  }

  return Array.from(byAccount.values())
    .map(
      (account: {
        accountId: string;
        provider: string;
      }): FilterChipDropdownOption => {
        const name: string =
          nameOf.get(accountKey(account.provider, account.accountId)) || "";
        const isNamed: boolean = Boolean(name) && name !== account.accountId;
        const group: string = getCloudProviderLabel(account.provider);

        return {
          value: account.accountId,
          label: isNamed ? name : account.accountId,
          ...(isNamed ? { sublabel: account.accountId } : {}),
          icon: IconProp.Cloud,
          ...(group ? { group } : {}),
        };
      },
    )
    .sort(
      (
        first: FilterChipDropdownOption,
        second: FilterChipDropdownOption,
      ): number => {
        return (
          (first.group || "").localeCompare(second.group || "") ||
          first.label.localeCompare(second.label) ||
          first.value.localeCompare(second.value)
        );
      },
    );
}

/*
 * What a chip over a list's own account column asks for (All Environments,
 * All Resources): one of the accounts picked, or none of them, whichever
 * way each id is written. "Is not" leaves out a row that names no account,
 * as the server's NOT IN does.
 */
export function getCloudAccountColumnQueryValue(
  accountIds: ReadonlyArray<string>,
  operator: FilterOperator,
): unknown {
  return buildEnumFacetQuery(
    getCloudAccountIdsInEveryCase(accountIds),
    operator,
    true,
  );
}

/*
 * The environments in the accounts picked - or, for "is not", in every
 * other account - by id, whichever way an account's id is written. An
 * environment that names no account is in neither, as All Environments'
 * own chip answers it (the server's NOT IN leaves out a column that holds
 * nothing): the same chip set the same way keeps the same environments on
 * both lists.
 */
export function getEnvironmentIdsForAccounts(data: {
  environments: ReadonlyMap<string, CloudAccountEnvironment>;
  accountIds: ReadonlyArray<string>;
  operator: FilterOperator;
}): Array<string> {
  const accounts: Set<string> = new Set<string>(
    data.accountIds.map((accountId: string): string => {
      return comparable(accountId);
    }),
  );
  const ids: Array<string> = [];

  for (const [id, environment] of Array.from(data.environments.entries())) {
    const accountId: string = comparable(environment.cloudAccountId);

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

// A chip over a list's own account column, its options read once.
function getAccountColumnFacet(
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
      return getCloudAccountColumnQueryValue(values, operator);
    },
  };
}

// All Environments' chip: the accounts its environments are in, read once.
export function getEnvironmentsCloudAccountFacet(
  fetchOptions: (
    projectId: ObjectID,
  ) => Promise<Array<FilterChipDropdownOption>>,
): ResourceFacet {
  return getAccountColumnFacet(fetchOptions);
}

/*
 * Cloud's All Resources' chip: the accounts its resources are in, read
 * once (CloudAccountChipReads). It replaces the list's typed Account
 * filter, which matched only an id typed exactly as stored.
 */
export function getResourcesCloudAccountFacet(
  fetchOptions: (
    projectId: ObjectID,
  ) => Promise<Array<FilterChipDropdownOption>>,
): ResourceFacet {
  return getAccountColumnFacet(fetchOptions);
}

/*
 * All Apps' chip: the accounts of the environments the list holds, which it
 * has read already; an app is filtered by its environment. Their names are
 * read once (`fetchNames`), so it offers them named as the other lists do -
 * or by their ids, as it did, where the names cannot be read.
 */
export function getAppsCloudAccountFacet(
  environments: ReadonlyMap<string, CloudAccountEnvironment>,
  fetchNames: () => Promise<Array<CloudAccountName>> = async (): Promise<
    Array<CloudAccountName>
  > => {
    return [];
  },
): ResourceFacet {
  return {
    key: CLOUD_ACCOUNT_FACET_KEY,
    label: CLOUD_ACCOUNT_FACET_LABEL,
    icon: IconProp.Cloud,
    isMultiSelect: true,
    supportedOperators: CLOUD_ACCOUNT_FACET_OPERATORS,
    fetchOptions: async (): Promise<Array<FilterChipDropdownOption>> => {
      let names: Array<CloudAccountName> = [];

      try {
        names = await fetchNames();
      } catch {
        // No names to read: the accounts are offered by their ids.
        names = [];
      }

      return getCloudAccountFacetOptions(
        Array.from(environments.values()),
        names,
      );
    },
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
