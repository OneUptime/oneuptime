import SiteTypeHierarchyFormUtil from "./SiteTypeHierarchyFormUtil";
import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
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

let cachedNetworkSiteTypes: Array<NetworkSiteType> = [];

export function isParentSiteRequired(values: FormValues<NetworkSite>): boolean {
  return SiteTypeHierarchyFormUtil.isParentSiteRequired({
    selectedNetworkSiteTypeValue:
      values.networkSiteType || values.networkSiteTypeId,
    networkSiteTypes: cachedNetworkSiteTypes,
  });
}

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

  cachedNetworkSiteTypes = networkSiteTypes;

  return cachedNetworkSiteTypes;
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

export async function fetchParentNetworkSiteOptions(
  values: FormValues<NetworkSite>,
  currentNetworkSiteId?: ObjectID | undefined,
): Promise<Array<DropdownOption>> {
  const networkSiteTypes: Array<NetworkSiteType> =
    await fetchNetworkSiteTypes();
  const parentNetworkSiteTypeId: string | null =
    SiteTypeHierarchyFormUtil.getConfiguredParentTypeId({
      selectedNetworkSiteTypeValue:
        values.networkSiteType || values.networkSiteTypeId,
      networkSiteTypes,
    });

  if (!parentNetworkSiteTypeId) {
    return [];
  }

  const parentSites: Array<NetworkSite> = [];
  let skip: number = 0;

  while (true) {
    const result: ListResult<NetworkSite> = await ModelAPI.getList<NetworkSite>(
      {
        modelType: NetworkSite,
        query: {
          networkSiteTypeId: new ObjectID(parentNetworkSiteTypeId),
        },
        limit: LIMIT_PER_PROJECT,
        skip,
        select: {
          _id: true,
          name: true,
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

  const currentId: string | null =
    currentNetworkSiteId?.toString() ||
    SiteTypeHierarchyFormUtil.getEntityId(values._id);
  const normalizedCurrentId: string | null = currentId
    ? currentId.toLowerCase()
    : null;

  return parentSites
    .filter((networkSite: NetworkSite) => {
      const candidateId: string | undefined = networkSite.id
        ?.toString()
        .toLowerCase();
      if (!candidateId || candidateId === normalizedCurrentId) {
        return false;
      }

      if (
        normalizedCurrentId &&
        networkSite.materializedPath
          ?.toLowerCase()
          .includes(`/${normalizedCurrentId}/`)
      ) {
        return false;
      }

      return true;
    })
    .map((networkSite: NetworkSite): DropdownOption => {
      return {
        value: networkSite.id!.toString(),
        label: networkSite.name || "Unnamed Network Site",
      };
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

  if (!parentNetworkSite?.networkSiteTypeId) {
    return [];
  }

  return SiteTypeHierarchyFormUtil.getChildTypeOptions({
    parentNetworkSiteTypeValue: parentNetworkSite.networkSiteTypeId,
    networkSiteTypes,
  });
}
