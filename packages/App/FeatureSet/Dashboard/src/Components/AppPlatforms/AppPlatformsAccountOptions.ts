import {
  CloudAccountEnvironment,
  CloudAccountName,
  getCloudAccountFacetOptions,
} from "./AppPlatformsAccountFacet";
import { fetchCloudAccountNames } from "../Cloud/CloudAccountChipReads";
import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdownTypes";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The accounts All Environments' Cloud Account chip offers: those its
 * environments are in - the ones the list holds, archived ones left out -
 * read once when the list opens, each named as Cloud > Accounts names it
 * where the reader may read that (fetchCloudAccountNames).
 */
export async function fetchEnvironmentCloudAccountOptions(): Promise<
  Array<FilterChipDropdownOption>
> {
  const [result, names]: [ListResult<CloudResource>, Array<CloudAccountName>] =
    await Promise.all([
      ModelAPI.getList<CloudResource>({
        modelType: CloudResource,
        query: {
          isArchived: false,
          cloudResourceKind: CloudResourceKind.Environment,
        },
        select: { cloudProvider: true, cloudAccountId: true },
        sort: {},
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      }),
      fetchCloudAccountNames(),
    ]);

  return getCloudAccountFacetOptions(
    result.data.map((environment: CloudResource): CloudAccountEnvironment => {
      return {
        cloudProvider: environment.cloudProvider as string | undefined,
        cloudAccountId: environment.cloudAccountId as string | undefined,
      };
    }),
    names,
  );
}
