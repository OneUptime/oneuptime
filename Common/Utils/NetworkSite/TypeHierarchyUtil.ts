import NetworkSiteType from "../../Models/DatabaseModels/NetworkSiteType";

export interface NetworkSiteTypeHierarchyNode {
  networkSiteType: NetworkSiteType;
  depth: number;
  children: Array<NetworkSiteTypeHierarchyNode>;
}

export interface NetworkSiteTypeHierarchyIndex {
  byId: Map<string, NetworkSiteType>;
  childrenByParentId: Map<string | null, Array<NetworkSiteType>>;
}

/*
 * Network site types describe the shape of a project's site tree. Keep the
 * read-side helpers defensive: a direct database write or a partially applied
 * migration can still leave an orphan or a cycle, and neither should make a
 * settings page hang or hide a type from its operator.
 */
export default class NetworkSiteTypeHierarchyUtil {
  public static getParentId(networkSiteType: NetworkSiteType): string | null {
    const parentId: string | null =
      networkSiteType.parentNetworkSiteTypeId?.toString() ||
      networkSiteType.parentNetworkSiteType?.id?.toString() ||
      null;

    if (
      parentId &&
      parentId.toLowerCase() === networkSiteType.id?.toString().toLowerCase()
    ) {
      return null;
    }

    return parentId;
  }

  public static buildIndex(data: {
    networkSiteTypes: Array<NetworkSiteType>;
  }): NetworkSiteTypeHierarchyIndex {
    const byId: Map<string, NetworkSiteType> = new Map<
      string,
      NetworkSiteType
    >();
    const childrenByParentId: Map<
      string | null,
      Array<NetworkSiteType>
    > = new Map<string | null, Array<NetworkSiteType>>();

    for (const networkSiteType of data.networkSiteTypes) {
      const id: string | undefined = networkSiteType.id
        ?.toString()
        .toLowerCase();

      if (id) {
        byId.set(id, networkSiteType);
      }

      const parentId: string | null = this.getParentId(networkSiteType);
      const normalizedParentId: string | null = parentId
        ? parentId.toLowerCase()
        : null;
      const siblings: Array<NetworkSiteType> | undefined =
        childrenByParentId.get(normalizedParentId);

      if (siblings) {
        siblings.push(networkSiteType);
      } else {
        childrenByParentId.set(normalizedParentId, [networkSiteType]);
      }
    }

    for (const siblings of childrenByParentId.values()) {
      this.sortInPlace(siblings);
    }

    return { byId, childrenByParentId };
  }

  public static getAncestorNetworkSiteTypes(data: {
    networkSiteType: NetworkSiteType;
    networkSiteTypes: Array<NetworkSiteType>;
    index?: NetworkSiteTypeHierarchyIndex | undefined;
  }): Array<NetworkSiteType> {
    const index: NetworkSiteTypeHierarchyIndex =
      data.index || this.buildIndex(data);
    const ancestors: Array<NetworkSiteType> = [];
    const visited: Set<string> = new Set<string>();

    const ownId: string | undefined = data.networkSiteType.id
      ?.toString()
      .toLowerCase();
    if (ownId) {
      visited.add(ownId);
    }

    let parentId: string | null = this.getParentId(data.networkSiteType);

    while (parentId) {
      const normalizedParentId: string = parentId.toLowerCase();
      if (visited.has(normalizedParentId)) {
        break;
      }

      const parent: NetworkSiteType | undefined =
        index.byId.get(normalizedParentId);
      if (!parent) {
        break;
      }

      ancestors.push(parent);
      visited.add(normalizedParentId);
      parentId = this.getParentId(parent);
    }

    return ancestors;
  }

  public static getDescendantNetworkSiteTypes(data: {
    networkSiteType: NetworkSiteType;
    networkSiteTypes: Array<NetworkSiteType>;
    index?: NetworkSiteTypeHierarchyIndex | undefined;
  }): Array<NetworkSiteType> {
    const index: NetworkSiteTypeHierarchyIndex =
      data.index || this.buildIndex(data);
    const descendants: Array<NetworkSiteType> = [];
    const visited: Set<string> = new Set<string>();

    const ownId: string | undefined = data.networkSiteType.id
      ?.toString()
      .toLowerCase();
    if (ownId) {
      visited.add(ownId);
    }

    let frontier: Array<NetworkSiteType> = ownId
      ? [...(index.childrenByParentId.get(ownId) || [])]
      : [];

    while (frontier.length > 0) {
      const nextFrontier: Array<NetworkSiteType> = [];

      for (const networkSiteType of frontier) {
        const id: string | undefined = networkSiteType.id
          ?.toString()
          .toLowerCase();

        if (!id || visited.has(id)) {
          continue;
        }

        visited.add(id);
        descendants.push(networkSiteType);
        nextFrontier.push(...(index.childrenByParentId.get(id) || []));
      }

      frontier = nextFrontier;
    }

    return descendants;
  }

  /*
   * Parent picker candidates. A leaf/unit type cannot own child types, and a
   * type cannot be placed under itself or anything already below it.
   */
  public static getValidParentCandidates(data: {
    networkSiteType: NetworkSiteType;
    networkSiteTypes: Array<NetworkSiteType>;
    index?: NetworkSiteTypeHierarchyIndex | undefined;
  }): Array<NetworkSiteType> {
    const index: NetworkSiteTypeHierarchyIndex =
      data.index || this.buildIndex(data);
    const excludedIds: Set<string> = new Set<string>();
    const ownId: string | undefined = data.networkSiteType.id
      ?.toString()
      .toLowerCase();

    if (ownId) {
      excludedIds.add(ownId);
    }

    for (const descendant of this.getDescendantNetworkSiteTypes({
      ...data,
      index,
    })) {
      const descendantId: string | undefined = descendant.id
        ?.toString()
        .toLowerCase();
      if (descendantId) {
        excludedIds.add(descendantId);
      }
    }

    return this.sort(
      data.networkSiteTypes.filter((candidate: NetworkSiteType) => {
        const candidateId: string | undefined = candidate.id
          ?.toString()
          .toLowerCase();
        return (
          Boolean(candidateId) &&
          !excludedIds.has(candidateId!) &&
          candidate.isUnitLevel !== true
        );
      }),
    );
  }

  public static getBreadcrumbLabel(data: {
    networkSiteType: NetworkSiteType;
    networkSiteTypes: Array<NetworkSiteType>;
    separator?: string | undefined;
    index?: NetworkSiteTypeHierarchyIndex | undefined;
  }): string {
    const ancestors: Array<NetworkSiteType> =
      this.getAncestorNetworkSiteTypes(data).reverse();

    return [...ancestors, data.networkSiteType]
      .map((networkSiteType: NetworkSiteType) => {
        return networkSiteType.name || "Unnamed Site Type";
      })
      .join(data.separator || " › ");
  }

  public static buildTree(data: {
    networkSiteTypes: Array<NetworkSiteType>;
    index?: NetworkSiteTypeHierarchyIndex | undefined;
  }): Array<NetworkSiteTypeHierarchyNode> {
    const index: NetworkSiteTypeHierarchyIndex =
      data.index || this.buildIndex(data);
    const visited: Set<string> = new Set<string>();

    const buildNode: (
      networkSiteType: NetworkSiteType,
      depth: number,
    ) => NetworkSiteTypeHierarchyNode = (
      networkSiteType: NetworkSiteType,
      depth: number,
    ): NetworkSiteTypeHierarchyNode => {
      const id: string | undefined = networkSiteType.id
        ?.toString()
        .toLowerCase();
      if (id) {
        visited.add(id);
      }

      const children: Array<NetworkSiteTypeHierarchyNode> = id
        ? (index.childrenByParentId.get(id) || [])
            .filter((child: NetworkSiteType) => {
              const childId: string | undefined = child.id
                ?.toString()
                .toLowerCase();
              return Boolean(childId) && !visited.has(childId!);
            })
            .map((child: NetworkSiteType) => {
              return buildNode(child, depth + 1);
            })
        : [];

      return { networkSiteType, depth, children };
    };

    const roots: Array<NetworkSiteType> = this.sort(
      data.networkSiteTypes.filter((networkSiteType: NetworkSiteType) => {
        const parentId: string | null = this.getParentId(networkSiteType);
        return !parentId || !index.byId.has(parentId.toLowerCase());
      }),
    );

    const tree: Array<NetworkSiteTypeHierarchyNode> = roots.map(
      (networkSiteType: NetworkSiteType) => {
        return buildNode(networkSiteType, 0);
      },
    );

    /*
     * A component containing only a cycle has no natural root. Promote one
     * member so all rows remain visible, and the visited set breaks the loop.
     */
    for (const networkSiteType of this.sort(data.networkSiteTypes)) {
      const id: string | undefined = networkSiteType.id
        ?.toString()
        .toLowerCase();
      if (!id || visited.has(id)) {
        continue;
      }

      tree.push(buildNode(networkSiteType, 0));
    }

    return tree;
  }

  private static sort(
    networkSiteTypes: Array<NetworkSiteType>,
  ): Array<NetworkSiteType> {
    const copy: Array<NetworkSiteType> = [...networkSiteTypes];
    this.sortInPlace(copy);
    return copy;
  }

  private static sortInPlace(networkSiteTypes: Array<NetworkSiteType>): void {
    networkSiteTypes.sort((a: NetworkSiteType, b: NetworkSiteType) => {
      const aOrder: number = a.order ?? Number.MAX_SAFE_INTEGER;
      const bOrder: number = b.order ?? Number.MAX_SAFE_INTEGER;

      if (aOrder !== bOrder) {
        return aOrder - bOrder;
      }

      return (a.name || "").localeCompare(b.name || "");
    });
  }
}
