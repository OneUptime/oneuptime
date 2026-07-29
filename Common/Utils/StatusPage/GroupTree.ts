import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";

export interface StatusPageGroupTreeNode {
  group: StatusPageGroup;
  depth: number;
  children: Array<StatusPageGroupTreeNode>;
}

/*
 * Status page groups form a tree: a group may be nested under another group
 * (Corporate Unit -> Region -> Market -> Site), and each level rolls up the
 * status and uptime of everything below it.
 *
 * Everything here is defensive about the shape of the data it is handed. The
 * parent pointer lives in a plain nullable column, so rows written directly to
 * the database (or a group whose parent the caller did not fetch) can point at
 * a missing parent, at themselves, or around a cycle. None of those may make a
 * group disappear from the status page or hang the render, so every walk is
 * bounded by a visited set and every group ends up in the tree exactly once.
 */
export default class StatusPageGroupTreeUtil {
  /*
   * How deep a group may be nested. Enforced on write (see
   * StatusPageGroupService) - reads never drop levels beyond it, they only
   * refuse to loop.
   */
  public static readonly MaxNestingDepth: number = 10;

  public static getParentId(statusPageGroup: StatusPageGroup): string | null {
    const parentId: string | null =
      statusPageGroup.parentStatusPageGroupId?.toString() || null;

    if (!parentId) {
      return null;
    }

    // a group that points at itself is a root, not an infinite loop.
    if (parentId === statusPageGroup._id?.toString()) {
      return null;
    }

    return parentId;
  }

  public static getChildGroups(data: {
    statusPageGroupId: string | null;
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroup> {
    const children: Array<StatusPageGroup> = data.statusPageGroups.filter(
      (group: StatusPageGroup) => {
        return this.getParentId(group) === data.statusPageGroupId;
      },
    );

    return this.sortByOrder(children);
  }

  /*
   * Top level groups: no parent, or a parent that is not part of the supplied
   * list (an orphan still has to render somewhere).
   */
  public static getRootGroups(data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroup> {
    const idsInList: Set<string> = this.getIdSet(data.statusPageGroups);

    const roots: Array<StatusPageGroup> = data.statusPageGroups.filter(
      (group: StatusPageGroup) => {
        const parentId: string | null = this.getParentId(group);
        return !parentId || !idsInList.has(parentId);
      },
    );

    return this.sortByOrder(roots);
  }

  /*
   * The full tree, in render order. Every supplied group appears exactly once:
   * orphans are promoted to roots, and groups that are only reachable through a
   * cycle are promoted too (rather than being silently dropped).
   */
  public static buildTree(data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroupTreeNode> {
    const visited: Set<string> = new Set<string>();

    const buildNode: (
      group: StatusPageGroup,
      depth: number,
    ) => StatusPageGroupTreeNode = (
      group: StatusPageGroup,
      depth: number,
    ): StatusPageGroupTreeNode => {
      const groupId: string = group._id?.toString() || "";
      visited.add(groupId);

      const children: Array<StatusPageGroupTreeNode> = this.getChildGroups({
        statusPageGroupId: groupId,
        statusPageGroups: data.statusPageGroups,
      })
        .filter((child: StatusPageGroup) => {
          return !visited.has(child._id?.toString() || "");
        })
        .map((child: StatusPageGroup) => {
          return buildNode(child, depth + 1);
        });

      return {
        group: group,
        depth: depth,
        children: children,
      };
    };

    const tree: Array<StatusPageGroupTreeNode> = this.getRootGroups({
      statusPageGroups: data.statusPageGroups,
    }).map((root: StatusPageGroup) => {
      return buildNode(root, 0);
    });

    /*
     * Anything left unvisited is inside a cycle that no root points into. Pull
     * each one up to the top level so the page still shows it.
     */
    for (const group of this.sortByOrder(data.statusPageGroups)) {
      if (!visited.has(group._id?.toString() || "")) {
        tree.push(buildNode(group, 0));
      }
    }

    return tree;
  }

  /*
   * Every group below this one, at any depth. Excludes the group itself.
   */
  public static getDescendantGroups(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroup> {
    const descendants: Array<StatusPageGroup> = [];
    const visited: Set<string> = new Set<string>([
      data.statusPageGroup._id?.toString() || "",
    ]);

    let frontier: Array<StatusPageGroup> = this.getChildGroups({
      statusPageGroupId: data.statusPageGroup._id?.toString() || "",
      statusPageGroups: data.statusPageGroups,
    });

    while (frontier.length > 0) {
      const nextFrontier: Array<StatusPageGroup> = [];

      for (const group of frontier) {
        const groupId: string = group._id?.toString() || "";

        if (visited.has(groupId)) {
          continue;
        }

        visited.add(groupId);
        descendants.push(group);

        nextFrontier.push(
          ...this.getChildGroups({
            statusPageGroupId: groupId,
            statusPageGroups: data.statusPageGroups,
          }),
        );
      }

      frontier = nextFrontier;
    }

    return descendants;
  }

  /*
   * The group itself followed by all of its descendants - the set of groups a
   * rolled up number has to cover.
   */
  public static getGroupAndDescendants(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroup> {
    return [
      data.statusPageGroup,
      ...this.getDescendantGroups({
        statusPageGroup: data.statusPageGroup,
        statusPageGroups: data.statusPageGroups,
      }),
    ];
  }

  /*
   * Ancestors, closest parent first. Stops at a cycle instead of looping.
   */
  public static getAncestorGroups(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroup> {
    const byId: Map<string, StatusPageGroup> = this.getGroupsById(
      data.statusPageGroups,
    );

    const ancestors: Array<StatusPageGroup> = [];
    const visited: Set<string> = new Set<string>([
      data.statusPageGroup._id?.toString() || "",
    ]);

    let parentId: string | null = this.getParentId(data.statusPageGroup);

    while (parentId && !visited.has(parentId)) {
      const parent: StatusPageGroup | undefined = byId.get(parentId);

      if (!parent) {
        break;
      }

      ancestors.push(parent);
      visited.add(parentId);
      parentId = this.getParentId(parent);
    }

    return ancestors;
  }

  /*
   * 0 for a top level group, 1 for its children, and so on.
   */
  public static getDepth(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
  }): number {
    return this.getAncestorGroups({
      statusPageGroup: data.statusPageGroup,
      statusPageGroups: data.statusPageGroups,
    }).length;
  }

  public static isDescendantOf(data: {
    statusPageGroup: StatusPageGroup;
    possibleAncestorId: string;
    statusPageGroups: Array<StatusPageGroup>;
  }): boolean {
    return this.getAncestorGroups({
      statusPageGroup: data.statusPageGroup,
      statusPageGroups: data.statusPageGroups,
    }).some((ancestor: StatusPageGroup) => {
      return ancestor._id?.toString() === data.possibleAncestorId;
    });
  }

  private static getGroupsById(
    statusPageGroups: Array<StatusPageGroup>,
  ): Map<string, StatusPageGroup> {
    const byId: Map<string, StatusPageGroup> = new Map<
      string,
      StatusPageGroup
    >();

    for (const group of statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (groupId) {
        byId.set(groupId, group);
      }
    }

    return byId;
  }

  private static getIdSet(
    statusPageGroups: Array<StatusPageGroup>,
  ): Set<string> {
    const ids: Set<string> = new Set<string>();

    for (const group of statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (groupId) {
        ids.add(groupId);
      }
    }

    return ids;
  }

  /*
   * Siblings render in `order`. Groups without an order keep their incoming
   * position, after the ordered ones.
   */
  private static sortByOrder(
    statusPageGroups: Array<StatusPageGroup>,
  ): Array<StatusPageGroup> {
    return [...statusPageGroups].sort(
      (a: StatusPageGroup, b: StatusPageGroup) => {
        const orderA: number =
          typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
        const orderB: number =
          typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;

        return orderA - orderB;
      },
    );
  }
}
