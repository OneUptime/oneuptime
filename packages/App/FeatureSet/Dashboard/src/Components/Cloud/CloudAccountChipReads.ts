import {
  CloudAccountEnvironment,
  CloudAccountName,
  getCloudAccountFacetOptions,
} from "../AppPlatforms/AppPlatformsAccountFacet";
import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdownTypes";
import { getCloudAccountIdSpellings } from "./CloudAccountScope";
import CloudAccount from "Common/Models/DatabaseModels/CloudAccount";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * WHAT THE CLOUD ACCOUNT CHIP READS (AppPlatformsAccountFacet).
 *
 * The names Cloud > Accounts gives the accounts, and, for Cloud's All
 * Resources, the accounts its resources are in. Kept apart from the facet
 * itself, which App's tests read: these reads go through the app's API
 * client.
 */

/*
 * What Cloud > Accounts calls each account, as the reader may read them:
 * every account a cloud connection reaches has a row there, named by its
 * cloud until someone renames it. A reader who may not read the accounts
 * - the read is refused - gets none, and the chip offers ids, as it did; a
 * reader the accounts' labels limit gets the ones they may read.
 */
export async function fetchCloudAccountNames(): Promise<
  Array<CloudAccountName>
> {
  try {
    const result: ListResult<CloudAccount> =
      await ModelAPI.getList<CloudAccount>({
        modelType: CloudAccount,
        query: {},
        select: { provider: true, accountId: true, name: true },
        sort: {},
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

    const names: Array<CloudAccountName> = [];

    for (const account of result.data) {
      const accountId: string =
        typeof account.accountId === "string" ? account.accountId : "";
      const name: string = typeof account.name === "string" ? account.name : "";

      if (accountId.trim() && name.trim()) {
        names.push({
          provider:
            typeof account.provider === "string" ? account.provider : "",
          accountId,
          name,
        });
      }
    }

    return names;
  } catch {
    return [];
  }
}

// Rows read per look for accounts not found yet.
export const CLOUD_RESOURCE_ACCOUNT_READ_SIZE: number = 100;

/*
 * Looks at most, so a project with very many accounts still opens its chip
 * at once: one account found per look at least, so this many accounts are
 * always found.
 */
export const CLOUD_RESOURCE_ACCOUNT_MAX_READS: number = 20;

/*
 * The accounts All Resources' resources are in - its own, archived ones
 * left out - each once, in the case its id was first written in. A list
 * of every resource can hold thousands, so their accounts are found a few
 * rows at a time: each read leaves out the accounts found so far - every
 * way their ids were written - and resources that name none, so it brings
 * only accounts not seen yet, and the reads end once one comes back short.
 * A few small reads, one more than there are accounts.
 */
export async function fetchCloudResourceAccounts(): Promise<
  Array<CloudAccountEnvironment>
> {
  const accounts: Map<string, CloudAccountEnvironment> = new Map<
    string,
    CloudAccountEnvironment
  >();
  // Every way an id found is written, and the empty one: what the next read leaves out.
  const seen: Set<string> = new Set<string>([""]);

  for (let read: number = 0; read < CLOUD_RESOURCE_ACCOUNT_MAX_READS; read++) {
    const result: ListResult<CloudResource> =
      await ModelAPI.getList<CloudResource>({
        modelType: CloudResource,
        query: {
          isArchived: false,
          cloudResourceKind: CloudResourceKind.Resource,
          cloudAccountId: new IncludesNone(Array.from(seen)),
        },
        select: { cloudProvider: true, cloudAccountId: true },
        sort: {},
        skip: 0,
        limit: CLOUD_RESOURCE_ACCOUNT_READ_SIZE,
      });

    let isNew: boolean = false;

    for (const resource of result.data) {
      const written: string =
        typeof resource.cloudAccountId === "string"
          ? resource.cloudAccountId
          : "";

      if (!seen.has(written)) {
        seen.add(written);
        isNew = true;
      }

      const accountId: string = written.trim();

      if (!accountId) {
        continue;
      }

      for (const spelling of getCloudAccountIdSpellings(accountId)) {
        seen.add(spelling);
      }

      const key: string = accountId.toLowerCase();

      if (!accounts.has(key)) {
        accounts.set(key, {
          cloudProvider:
            typeof resource.cloudProvider === "string"
              ? resource.cloudProvider
              : "",
          cloudAccountId: accountId,
        });
      }
    }

    // A short read has brought every account left; one with nothing new would only repeat.
    if (result.data.length < CLOUD_RESOURCE_ACCOUNT_READ_SIZE || !isNew) {
      break;
    }
  }

  return Array.from(accounts.values());
}

/*
 * All Resources' Cloud Account chip: the accounts its resources are in,
 * named as Cloud > Accounts names them where the reader may read that.
 */
export async function fetchResourcesCloudAccountOptions(): Promise<
  Array<FilterChipDropdownOption>
> {
  const [accounts, names]: [
    Array<CloudAccountEnvironment>,
    Array<CloudAccountName>,
  ] = await Promise.all([
    fetchCloudResourceAccounts(),
    fetchCloudAccountNames(),
  ]);

  return getCloudAccountFacetOptions(accounts, names);
}
