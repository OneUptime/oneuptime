import SiteTypeHierarchyFormUtil from "./SiteTypeHierarchyFormUtil";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import NetworkSiteTypeHierarchyUtil from "Common/Utils/NetworkSite/TypeHierarchyUtil";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import Includes from "Common/Types/BaseDatabase/Includes";
import ObjectID from "Common/Types/ObjectID";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";

const NETWORK_SITE_TYPE_SELECT: {
  _id: true;
  name: true;
  order: true;
  isUnitLevel: true;
  parentNetworkSiteTypeId: true;
} = {
  _id: true,
  name: true,
  order: true,
  isUnitLevel: true,
  parentNetworkSiteTypeId: true,
};

/*
 * Re-read on every picker open. Site types are a settings table an operator
 * can edit in another tab, and a stale catalog here would silently offer - or
 * withhold - parents the server then disagrees about.
 */
export async function fetchNetworkSiteTypes(): Promise<Array<NetworkSiteType>> {
  const networkSiteTypes: Array<NetworkSiteType> = [];
  let skip: number = 0;

  while (true) {
    const result: ListResult<NetworkSiteType> =
      await ModelAPI.getList<NetworkSiteType>({
        modelType: NetworkSiteType,
        query: {},
        limit: LIMIT_PER_PROJECT,
        skip,
        select: NETWORK_SITE_TYPE_SELECT,
        sort: {
          order: SortOrder.Ascending,
          name: SortOrder.Ascending,
        },
      });

    networkSiteTypes.push(...result.data);

    if (result.data.length < LIMIT_PER_PROJECT) {
      break;
    }

    skip += result.data.length;
  }

  return networkSiteTypes;
}

export async function fetchAllNetworkSiteTypeOptions(): Promise<
  Array<DropdownOption>
> {
  return SiteTypeHierarchyFormUtil.getAllTypeOptions({
    networkSiteTypes: await fetchNetworkSiteTypes(),
  });
}

export async function fetchParentNetworkSiteTypeOptions(
  values: FormValues<NetworkSiteType>,
): Promise<Array<DropdownOption>> {
  const networkSiteTypes: Array<NetworkSiteType> =
    await fetchNetworkSiteTypes();

  return SiteTypeHierarchyFormUtil.getValidParentTypeOptions({
    currentNetworkSiteTypeValue: values._id,
    networkSiteTypes,
  });
}

/*
 * The selected type's configured parent no longer FILTERS this list - it only
 * decides which candidates are offered first - because filtering on it left a
 * project whose types are all top-level with a permanently empty picker and no
 * way to link anything (GitHub issue #3744).
 *
 * What still narrows the read is the placement rule itself: the types a site of
 * this type may sit under are computable from the catalog the browser already
 * has, so the query asks for those types rather than for the whole project. In
 * a franchise estate that is the difference between reading a handful of
 * containers and reading every unit-level store. The self/subtree exclusion and
 * the final placement filter run in SiteTypeHierarchyFormUtil, where they are
 * testable without the API.
 */
export async function fetchParentNetworkSiteOptions(
  values: FormValues<NetworkSite>,
  currentNetworkSiteId?: ObjectID | undefined,
): Promise<Array<DropdownOption | DropdownOptionGroup>> {
  const networkSiteTypes: Array<NetworkSiteType> =
    await fetchNetworkSiteTypes();

  const childNetworkSiteTypeValue: unknown =
    values.networkSiteType || values.networkSiteTypeId;

  const allowedParentTypeIds: Array<string> =
    NetworkSiteTypeHierarchyUtil.getValidSiteParentTypes({
      networkSiteTypeId: SiteTypeHierarchyFormUtil.getEntityId(
        childNetworkSiteTypeValue,
      ),
      networkSiteTypes,
    })
      .map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.id!.toString();
      })
      .filter((id: string) => {
        return Boolean(id);
      });

  if (allowedParentTypeIds.length === 0) {
    return [];
  }

  const parentSites: Array<NetworkSite> = [];
  let skip: number = 0;

  while (true) {
    const result: ListResult<NetworkSite> = await ModelAPI.getList<NetworkSite>(
      {
        modelType: NetworkSite,
        query: {
          networkSiteTypeId: new Includes(allowedParentTypeIds),
        },
        limit: LIMIT_PER_PROJECT,
        skip,
        select: {
          _id: true,
          name: true,
          networkSiteTypeId: true,
          materializedPath: true,
        },
        sort: {
          name: SortOrder.Ascending,
        },
      },
    );

    parentSites.push(...result.data);

    if (result.data.length < LIMIT_PER_PROJECT) {
      break;
    }

    skip += result.data.length;
  }

  return SiteTypeHierarchyFormUtil.buildParentSiteOptions({
    networkSites: parentSites,
    childNetworkSiteTypeValue,
    networkSiteTypes,
    currentNetworkSiteId:
      currentNetworkSiteId?.toString() ||
      SiteTypeHierarchyFormUtil.getEntityId(values._id),
  });
}

export async function fetchChildNetworkSiteTypeOptions(
  parentNetworkSiteId: ObjectID,
): Promise<Array<DropdownOption>> {
  const [parentNetworkSite, networkSiteTypes]: [
    NetworkSite | null,
    Array<NetworkSiteType>,
  ] = await Promise.all([
    ModelAPI.getItem<NetworkSite>({
      modelType: NetworkSite,
      id: parentNetworkSiteId,
      select: {
        networkSiteTypeId: true,
      },
    }),
    fetchNetworkSiteTypes(),
  ]);

  return SiteTypeHierarchyFormUtil.getAllowedChildTypeOptions({
    parentNetworkSiteTypeValue: parentNetworkSite?.networkSiteTypeId || null,
    networkSiteTypes,
  });
}
