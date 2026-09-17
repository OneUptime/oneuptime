import NetworkSite from "Common/Models/DatabaseModels/NetworkSite";
import NetworkSiteType from "Common/Models/DatabaseModels/NetworkSiteType";
import NetworkSiteTypeHierarchyUtil, {
  NetworkSiteTypeHierarchyIndex,
  NetworkSiteTypeHierarchyNode,
} from "Common/Utils/NetworkSite/TypeHierarchyUtil";
import {
  DropdownOption,
  DropdownOptionGroup,
} from "Common/UI/Components/Dropdown/Dropdown";

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

  /*
   * The type configured directly above the selected one. It is GUIDANCE, not
   * a constraint: a parent site is always optional, and any site the placement
   * rule permits may be chosen. Its only job is to float the most likely
   * parents to the top of the picker.
   */
  public static getPreferredParentTypeId(data: {
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

  /*
   * The shared site placement rule, in form terms. A site may sit under any
   * site except one whose type is below its own in the type tree, and except
   * one of a unit-level type. See
   * NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType, which the
   * server enforces against the same catalog.
   */
  public static isParentSitePlacementAllowed(data: {
    childNetworkSiteTypeValue: unknown;
    parentNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
    index?: NetworkSiteTypeHierarchyIndex | undefined;
  }): boolean {
    return NetworkSiteTypeHierarchyUtil.isTypeAllowedAsSiteParentOfType({
      childNetworkSiteTypeId: this.getEntityId(data.childNetworkSiteTypeValue),
      parentNetworkSiteTypeId: this.getEntityId(
        data.parentNetworkSiteTypeValue,
      ),
      networkSiteTypes: data.networkSiteTypes,
      index: data.index,
    });
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

  /*
   * Types a new site created UNDER a known parent site may take — the mirror
   * of the parent picker, so the two forms can never disagree. Everything
   * except the types above the parent's own is offered; nothing at all when
   * the parent is unit level, which is the one site that cannot own children.
   */
  public static getAllowedChildTypeOptions(data: {
    parentNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
  }): Array<DropdownOption> {
    const index: NetworkSiteTypeHierarchyIndex =
      NetworkSiteTypeHierarchyUtil.buildIndex(data);

    return this.toBreadcrumbOptions({
      networkSiteTypes: NetworkSiteTypeHierarchyUtil.getValidSiteChildTypes({
        networkSiteTypeId: this.getEntityId(data.parentNetworkSiteTypeValue),
        networkSiteTypes: data.networkSiteTypes,
        index,
      }),
      allNetworkSiteTypes: data.networkSiteTypes,
      index,
    });
  }

  /*
   * The parent-site picker's contents. Every site in the project is a
   * candidate except the site itself, its own subtree (which would be a
   * cycle), and the placements the type hierarchy forbids. Sites of the type
   * configured directly above this one are listed first because they are the
   * usual answer — but they are a suggestion, not the only choice, which is
   * the whole point of GitHub issue #3744.
   */
  public static buildParentSiteOptions(data: {
    networkSites: Array<NetworkSite>;
    childNetworkSiteTypeValue: unknown;
    networkSiteTypes: Array<NetworkSiteType>;
    currentNetworkSiteId?: string | null | undefined;
  }): Array<DropdownOption | DropdownOptionGroup> {
    const index: NetworkSiteTypeHierarchyIndex =
      NetworkSiteTypeHierarchyUtil.buildIndex(data);
    const normalizedCurrentId: string | null = data.currentNetworkSiteId
      ? data.currentNetworkSiteId.toString().toLowerCase()
      : null;
    const preferredParentTypeId: string | null = this.getPreferredParentTypeId({
      selectedNetworkSiteTypeValue: data.childNetworkSiteTypeValue,
      networkSiteTypes: data.networkSiteTypes,
    });
    const normalizedPreferredParentTypeId: string | null = preferredParentTypeId
      ? preferredParentTypeId.toLowerCase()
      : null;

    const preferred: Array<DropdownOption> = [];
    const others: Array<DropdownOption> = [];

    for (const networkSite of data.networkSites) {
      const candidateId: string | undefined = networkSite.id
        ?.toString()
        .toLowerCase();

      if (!candidateId || candidateId === normalizedCurrentId) {
        continue;
      }

      /*
       * The materialized path ends with the site's own id, so this single
       * containment test excludes the whole subtree below the current site.
       */
      if (
        normalizedCurrentId &&
        networkSite.materializedPath
          ?.toLowerCase()
          .includes(`/${normalizedCurrentId}/`)
      ) {
        continue;
      }

      const candidateTypeId: string | null = networkSite.networkSiteTypeId
        ? networkSite.networkSiteTypeId.toString().toLowerCase()
        : null;

      if (
        !this.isParentSitePlacementAllowed({
          childNetworkSiteTypeValue: data.childNetworkSiteTypeValue,
          parentNetworkSiteTypeValue: candidateTypeId,
          networkSiteTypes: data.networkSiteTypes,
          index,
        })
      ) {
        continue;
      }

      const candidateType: NetworkSiteType | undefined = candidateTypeId
        ? index.byId.get(candidateTypeId)
        : undefined;
      const option: DropdownOption = {
        value: networkSite.id!.toString(),
        label: candidateType?.name
          ? `${networkSite.name || "Unnamed Network Site"} (${candidateType.name})`
          : networkSite.name || "Unnamed Network Site",
      };

      if (
        normalizedPreferredParentTypeId &&
        candidateTypeId === normalizedPreferredParentTypeId
      ) {
        preferred.push(option);
      } else {
        others.push(option);
      }
    }

    /*
     * Two labelled groups rather than one concatenated list: a flat list that
     * restarts its alphabet halfway down reads as a sorting bug, not as a
     * recommendation. A project whose types are all top-level has no preferred
     * type at all, so it sees one plain list.
     */
    if (preferred.length === 0) {
      return others;
    }

    const preferredTypeName: string | undefined =
      normalizedPreferredParentTypeId
        ? index.byId.get(normalizedPreferredParentTypeId)?.name
        : undefined;

    const groups: Array<DropdownOptionGroup> = [
      {
        label: preferredTypeName
          ? `Suggested — ${preferredTypeName}`
          : "Suggested",
        options: preferred,
      },
    ];

    if (others.length > 0) {
      groups.push({ label: "Other sites", options: others });
    }

    return groups;
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
