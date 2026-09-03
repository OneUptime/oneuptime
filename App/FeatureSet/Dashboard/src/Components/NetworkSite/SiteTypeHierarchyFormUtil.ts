import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import NetworkSiteTypeHierarchyUtil, {
  NetworkSiteTypeHierarchyIndex,
  NetworkSiteTypeHierarchyNode,
} from "Common/Utils/NetworkSite/TypeHierarchyUtil";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";

/*
 * Pure form-facing helpers for the Network Site Type hierarchy. Keeping the
 * candidate and label rules here means every picker presents the same tree,
 * while API loading remains in NetworkSiteFormDropdownOptions.
 */
export default class SiteTypeHierarchyFormUtil {
  public static getEntityId(value: unknown): string | null {
    if (value === null || value === undefined || value === "") {
      return null;
    }

    if (
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    ) {
      return value.toString();
    }

    if (typeof value !== "object") {
      return null;
    }

    const record: Record<string, unknown> = value as Record<string, unknown>;

    for (const key of ["value", "_id", "id"]) {
      const candidate: unknown = record[key];
      if (typeof candidate === "string" || typeof candidate === "number") {
        return candidate.toString();
      }

      if (
        candidate &&
        typeof candidate === "object" &&
        "toString" in candidate
      ) {
        const text: string = (
          candidate as { toString: () => string }
        ).toString();
        if (text && text !== "[object Object]") {
          return text;
        }
      }
    }

    if ("toString" in record) {
      const text: string = (record as { toString: () => string }).toString();
      if (text && text !== "[object Object]") {
        return text;
      }
    }

    return null;
  }

  public static findNetworkSiteType(data: {
    value: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
  }): NetworkSiteType | null {
    const id: string | null = this.getEntityId(data.value);
    if (!id) {
      return null;
    }

    const normalizedId: string = id.toLowerCase();
    return (
      data.networkSiteTypes.find((networkSiteType: NetworkSiteType) => {
        return networkSiteType.id?.toString().toLowerCase() === normalizedId;
      }) || null
    );
  }

  public static getConfiguredParentTypeId(data: {
    selectedNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
  }): string | null {
    const selectedType: NetworkSiteType | null = this.findNetworkSiteType({
      value: data.selectedNetworkSiteTypeValue,
      networkSiteTypes: data.networkSiteTypes,
    });

    return selectedType
      ? NetworkSiteTypeHierarchyUtil.getParentId(selectedType)
      : null;
  }

  public static isParentSiteRequired(data: {
    selectedNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
  }): boolean {
    return Boolean(this.getConfiguredParentTypeId(data));
  }

  public static getAllTypeOptions(data: {
    networkSiteTypes: Array<NetworkSiteType>;
  }): Array<DropdownOption> {
    const index: NetworkSiteTypeHierarchyIndex =
      NetworkSiteTypeHierarchyUtil.buildIndex(data);
    const tree: Array<NetworkSiteTypeHierarchyNode> =
      NetworkSiteTypeHierarchyUtil.buildTree({ ...data, index });
    const orderedTypes: Array<NetworkSiteType> = [];

    const visit: (node: NetworkSiteTypeHierarchyNode) => void = (
      node: NetworkSiteTypeHierarchyNode,
    ): void => {
      orderedTypes.push(node.networkSiteType);
      for (const child of node.children) {
        visit(child);
      }
    };

    for (const root of tree) {
      visit(root);
    }

    return this.toBreadcrumbOptions({
      networkSiteTypes: orderedTypes,
      allNetworkSiteTypes: data.networkSiteTypes,
      index,
    });
  }

  public static getValidParentTypeOptions(data: {
    currentNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
  }): Array<DropdownOption> {
    const index: NetworkSiteTypeHierarchyIndex =
      NetworkSiteTypeHierarchyUtil.buildIndex(data);
    const currentNetworkSiteType: NetworkSiteType =
      this.findNetworkSiteType({
        value: data.currentNetworkSiteTypeValue,
        networkSiteTypes: data.networkSiteTypes,
      }) || new NetworkSiteType();

    return this.toBreadcrumbOptions({
      networkSiteTypes: NetworkSiteTypeHierarchyUtil.getValidParentCandidates({
        networkSiteType: currentNetworkSiteType,
        networkSiteTypes: data.networkSiteTypes,
        index,
      }),
      allNetworkSiteTypes: data.networkSiteTypes,
      index,
    });
  }

  public static getChildTypeOptions(data: {
    parentNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
  }): Array<DropdownOption> {
    const parentId: string | null = this.getEntityId(
      data.parentNetworkSiteTypeValue,
    );
    if (!parentId) {
      return [];
    }

    const index: NetworkSiteTypeHierarchyIndex =
      NetworkSiteTypeHierarchyUtil.buildIndex(data);
    const childTypes: Array<NetworkSiteType> =
      index.childrenByParentId.get(parentId.toLowerCase()) || [];

    return this.toBreadcrumbOptions({
      networkSiteTypes: childTypes,
      allNetworkSiteTypes: data.networkSiteTypes,
      index,
    });
  }

  private static toBreadcrumbOptions(data: {
    networkSiteTypes: Array<NetworkSiteType>;
    allNetworkSiteTypes: Array<NetworkSiteType>;
    index: NetworkSiteTypeHierarchyIndex;
  }): Array<DropdownOption> {
    return data.networkSiteTypes
      .filter((networkSiteType: NetworkSiteType) => {
        return Boolean(networkSiteType.id);
      })
      .map((networkSiteType: NetworkSiteType): DropdownOption => {
        return {
          value: networkSiteType.id!.toString(),
          label: NetworkSiteTypeHierarchyUtil.getBreadcrumbLabel({
            networkSiteType,
            networkSiteTypes: data.allNetworkSiteTypes,
            index: data.index,
          }),
        };
      });
  }
}
