import {
  CloudAccountEnvironment,
  getCloudAccountFacetOptions,
} from "./AppPlatformsAccountFacet";
import { FilterChipDropdownOption } from "../ResourceOwners/FilterChipDropdownTypes";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import { CloudResourceKind } from "Common/Types/Cloud/CloudResourceKind";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * The accounts All Environments' Cloud Account chip offers: those its
 * environments are in - the ones the list holds, archived ones left out -
 * read once when the list opens.
 */
export async function fetchEnvironmentCloudAccountOptions(): Promise<
  Array<FilterChipDropdownOption>
> {
  const result: ListResult<CloudResource> =
    await ModelAPI.getList<CloudResource>({
      modelType: CloudResource,
      query: {
        isArchived: false,
        cloudResourceKind: CloudResourceKind.Environment,
      },
      select: { cloudProvider: true, cloudAccountId: true },
      sort: {},
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

  return getCloudAccountFacetOptions(
    result.data.map((environment: CloudResource): CloudAccountEnvironment => {
      return {
        cloudProvider: environment.cloudProvider as string | undefined,
        cloudAccountId: environment.cloudAccountId as string | undefined,
      };
    }),
  );
}
