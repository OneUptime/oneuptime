import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";

export interface StatusPageGroupTreeNode {
  group: StatusPageGroup;
  depth: number;
  children: Array<StatusPageGroupTreeNode>;
}

/*
 * A parent -> children index over one list of groups, plus the id lookup that
 * goes with it.
 *
 * Every helper here used to answer "who are this group's children?" by
 * filtering the whole list, which made one walk of the tree cost O(groups) per
 * node it touched. That is invisible at a dozen groups and is not invisible at
 * fifteen hundred: a status page that size renders the same subtree walk once
 * per group per render. Building the buckets once turns each of those lookups
 * into a map read.
 *
 * Callers that walk the same list more than once (the status page overview
 * renders a rollup per group; the uptime endpoint rolls up per group) should
 * build one of these with buildIndex and hand it to every call. Callers that
 * only ask one question can leave it out - each method builds its own, which
 * still costs one pass over the list rather than one pass per node.
 */
export interface StatusPageGroupTreeIndex {
  /*
   * Keyed by StatusPageGroupTreeUtil.getParentId, so `null` is the bucket of
   * groups with no usable parent pointer. A plain string key would collide
   * with groups that carry no id of their own, which read as "" everywhere
   * else in this class.
   */
  childrenByParentId: Map<string | null, Array<StatusPageGroup>>;
  byId: Map<string, StatusPageGroup>;
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

  /*
   * One pass over the list. Siblings come out of each bucket in `order`, which
   * is the same order filtering the whole list and sorting it produced -
   * bucketing keeps the incoming order and the sort below is stable, so groups
   * that share an order (or have none) keep their incoming position.
   */
  public static buildIndex(data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): StatusPageGroupTreeIndex {
    const childrenByParentId: Map<
      string | null,
      Array<StatusPageGroup>
    > = new Map<string | null, Array<StatusPageGroup>>();

    const byId: Map<string, StatusPageGroup> = new Map<
      string,
      StatusPageGroup
    >();

    for (const group of data.statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (groupId) {
        byId.set(groupId, group);
      }

      const parentId: string | null = this.getParentId(group);
      const siblings: Array<StatusPageGroup> | undefined =
        childrenByParentId.get(parentId);

      if (siblings) {
        siblings.push(group);
      } else {
        childrenByParentId.set(parentId, [group]);
      }
    }

    for (const siblings of childrenByParentId.values()) {
      this.sortByOrderInPlace(siblings);
    }

    return {
      childrenByParentId: childrenByParentId,
      byId: byId,
    };
  }

  public static getChildGroups(data: {
    statusPageGroupId: string | null;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    /*
     * A copy rather than the index's own bucket: this is public, and handing a
     * caller the array the index is built on invites a mutation that would
     * quietly corrupt every later lookup.
     */
    return [
      ...this.getChildGroupsFromIndex({
        statusPageGroupId: data.statusPageGroupId,
        index: this.resolveIndex(data),
      }),
    ];
  }

  /*
   * Top level groups: no parent, or a parent that is not part of the supplied
   * list (an orphan still has to render somewhere).
   */
  public static getRootGroups(data: {
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    /*
     * A scan of the whole list rather than a concatenation of the orphan
     * buckets, so roots that share an order (or have none) keep the relative
     * position they arrived in.
     */
    const roots: Array<StatusPageGroup> = data.statusPageGroups.filter(
      (group: StatusPageGroup) => {
        const parentId: string | null = this.getParentId(group);
        return !parentId || !index.byId.has(parentId);
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
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroupTreeNode> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);
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

      const children: Array<StatusPageGroupTreeNode> =
        this.getChildGroupsFromIndex({
          statusPageGroupId: groupId,
          index: index,
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
      index: index,
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
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const descendants: Array<StatusPageGroup> = [];
    const visited: Set<string> = new Set<string>([
      data.statusPageGroup._id?.toString() || "",
    ]);

    let frontier: Array<StatusPageGroup> = this.getChildGroupsFromIndex({
      statusPageGroupId: data.statusPageGroup._id?.toString() || "",
      index: index,
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
          ...this.getChildGroupsFromIndex({
            statusPageGroupId: groupId,
            index: index,
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
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    return [
      data.statusPageGroup,
      ...this.getDescendantGroups({
        statusPageGroup: data.statusPageGroup,
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      }),
    ];
  }

  /*
   * Ancestors, closest parent first. Stops at a cycle instead of looping.
   */
  public static getAncestorGroups(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    const byId: Map<string, StatusPageGroup> = this.resolveIndex(data).byId;

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
    index?: StatusPageGroupTreeIndex | undefined;
  }): number {
    return this.getAncestorGroups({
      statusPageGroup: data.statusPageGroup,
      statusPageGroups: data.statusPageGroups,
      index: data.index,
    }).length;
  }

  public static isDescendantOf(data: {
    statusPageGroup: StatusPageGroup;
    possibleAncestorId: string;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): boolean {
    return this.getAncestorGroups({
      statusPageGroup: data.statusPageGroup,
      statusPageGroups: data.statusPageGroups,
      index: data.index,
    }).some((ancestor: StatusPageGroup) => {
      return ancestor._id?.toString() === data.possibleAncestorId;
    });
  }

  private static resolveIndex(data: {
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): StatusPageGroupTreeIndex {
    return (
      data.index ||
      this.buildIndex({
        statusPageGroups: data.statusPageGroups,
      })
    );
  }

  /*
   * The index's own bucket, not a copy. Internal callers below only ever read
   * it or spread it, and a tree walk that copies every sibling list at every
   * node is most of what this index exists to avoid.
   */
  private static getChildGroupsFromIndex(data: {
    statusPageGroupId: string | null;
    index: StatusPageGroupTreeIndex;
  }): Array<StatusPageGroup> {
    return data.index.childrenByParentId.get(data.statusPageGroupId) || [];
  }

  /*
   * Siblings render in `order`. Groups without an order keep their incoming
   * position, after the ordered ones.
   */
  private static sortByOrder(
    statusPageGroups: Array<StatusPageGroup>,
  ): Array<StatusPageGroup> {
    return this.sortByOrderInPlace([...statusPageGroups]);
  }

  private static sortByOrderInPlace(
    statusPageGroups: Array<StatusPageGroup>,
  ): Array<StatusPageGroup> {
    return statusPageGroups.sort((a: StatusPageGroup, b: StatusPageGroup) => {
      const orderA: number =
        typeof a.order === "number" ? a.order : Number.MAX_SAFE_INTEGER;
      const orderB: number =
        typeof b.order === "number" ? b.order : Number.MAX_SAFE_INTEGER;

      return orderA - orderB;
    });
  }
}
