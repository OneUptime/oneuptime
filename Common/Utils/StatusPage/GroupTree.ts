import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";

export interface StatusPageGroupTreeNode {
  group: StatusPageGroup;
  depth: number;
  children: Array<StatusPageGroupTreeNode>;
}

export interface StatusPageGroupIndexNode {
  group: StatusPageGroup;
  // 0 for a top level group, 1 for its children, and so on.
  depth: number;
  // Ancestors outermost first, excluding the group itself.
  ancestors: Array<StatusPageGroup>;
}

/*
 * What separates the levels of a group path when it is shown to a human -
 * "Corporate › Region 1000 › Market 1001".
 */
export const STATUS_PAGE_GROUP_PATH_SEPARATOR: string = " › ";

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

  public static getGroupId(statusPageGroup: StatusPageGroup): string {
    return statusPageGroup._id?.toString() || "";
  }

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
    return this.buildIndex(data).getTree();
  }

  /*
   * One walk of the tree, kept around to answer every question about it.
   *
   * Reach for this whenever a caller needs an answer for *every* group rather
   * than for one of them: the static helpers each rederive the tree from the
   * array they are handed, so asking 1500 groups for their ancestors rebuilds a
   * 1500 entry map 1500 times. See StatusPageGroupIndex.
   */
  public static buildIndex(data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): StatusPageGroupIndex {
    return new StatusPageGroupIndex(data);
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
  public static sortByOrder(
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

/*
 * A snapshot of one set of status page groups, with the tree already walked.
 *
 * Every static helper above rederives what it needs from the array it is
 * handed. That is the right shape for a single question, and the wrong shape
 * for asking the same question about every group: a page that labels 1500
 * groups with their ancestor path calls getAncestorGroups 1500 times, and each
 * of those builds a fresh 1500 entry map before it walks anything. The index
 * does that walk once, in the constructor, and every lookup afterwards reads
 * what the walk recorded.
 *
 * Build a new index when the group list changes - it does not observe the
 * groups it was given.
 *
 * The walk is the same one buildTree does (buildTree is implemented on top of
 * this), so `depth` and `ancestors` describe where a group actually renders.
 * For data with a cycle in it that is not the same as following parent
 * pointers: a group only reachable through a cycle is promoted to the top
 * level, so the index reports it with no ancestors, while the static
 * getAncestorGroups still walks the cycle until it closes.
 */
export class StatusPageGroupIndex {
  private statusPageGroups: Array<StatusPageGroup> = [];
  private groupsById: Map<string, StatusPageGroup> = new Map<
    string,
    StatusPageGroup
  >();

  private childGroupsByParentId: Map<string, Array<StatusPageGroup>> = new Map<
    string,
    Array<StatusPageGroup>
  >();

  private rootGroups: Array<StatusPageGroup> = [];
  private tree: Array<StatusPageGroupTreeNode> = [];
  private nodesInTreeOrder: Array<StatusPageGroupIndexNode> = [];
  private nodesById: Map<string, StatusPageGroupIndexNode> = new Map<
    string,
    StatusPageGroupIndexNode
  >();

  public constructor(data: { statusPageGroups: Array<StatusPageGroup> }) {
    this.statusPageGroups = data.statusPageGroups;

    for (const group of data.statusPageGroups) {
      const groupId: string = StatusPageGroupTreeUtil.getGroupId(group);

      if (groupId) {
        this.groupsById.set(groupId, group);
      }
    }

    const roots: Array<StatusPageGroup> = [];

    for (const group of data.statusPageGroups) {
      const parentId: string | null =
        StatusPageGroupTreeUtil.getParentId(group);

      /*
       * No parent, or a parent that is not part of the supplied list - an
       * orphan still has to render somewhere, so it becomes a root.
       */
      if (!parentId || !this.groupsById.has(parentId)) {
        roots.push(group);
        continue;
      }

      const siblings: Array<StatusPageGroup> =
        this.childGroupsByParentId.get(parentId) || [];

      siblings.push(group);
      this.childGroupsByParentId.set(parentId, siblings);
    }

    this.rootGroups = StatusPageGroupTreeUtil.sortByOrder(roots);

    for (const parentId of Array.from(this.childGroupsByParentId.keys())) {
      this.childGroupsByParentId.set(
        parentId,
        StatusPageGroupTreeUtil.sortByOrder(
          this.childGroupsByParentId.get(parentId) || [],
        ),
      );
    }

    this.walkTree();
  }

  private walkTree(): void {
    const visited: Set<string> = new Set<string>();

    const buildNode: (
      group: StatusPageGroup,
      depth: number,
      ancestors: Array<StatusPageGroup>,
    ) => StatusPageGroupTreeNode = (
      group: StatusPageGroup,
      depth: number,
      ancestors: Array<StatusPageGroup>,
    ): StatusPageGroupTreeNode => {
      const groupId: string = StatusPageGroupTreeUtil.getGroupId(group);
      visited.add(groupId);

      const indexNode: StatusPageGroupIndexNode = {
        group: group,
        depth: depth,
        ancestors: ancestors,
      };

      this.nodesInTreeOrder.push(indexNode);

      if (groupId && !this.nodesById.has(groupId)) {
        this.nodesById.set(groupId, indexNode);
      }

      /*
       * Built once per group rather than once per child: siblings all share
       * the same ancestor path, so the whole index holds one array per level
       * of nesting instead of one per group.
       */
      const ancestorsOfChildren: Array<StatusPageGroup> = [...ancestors, group];

      const children: Array<StatusPageGroupTreeNode> = (
        this.childGroupsByParentId.get(groupId) || []
      )
        .filter((child: StatusPageGroup) => {
          return !visited.has(StatusPageGroupTreeUtil.getGroupId(child));
        })
        .map((child: StatusPageGroup) => {
          return buildNode(child, depth + 1, ancestorsOfChildren);
        });

      return {
        group: group,
        depth: depth,
        children: children,
      };
    };

    this.tree = this.rootGroups.map((root: StatusPageGroup) => {
      return buildNode(root, 0, []);
    });

    /*
     * Anything left unvisited is inside a cycle that no root points into. Pull
     * each one up to the top level so the page still shows it.
     */
    for (const group of StatusPageGroupTreeUtil.sortByOrder(
      this.statusPageGroups,
    )) {
      if (!visited.has(StatusPageGroupTreeUtil.getGroupId(group))) {
        this.tree.push(buildNode(group, 0, []));
      }
    }
  }

  // The groups this index was built from, in the order they were supplied.
  public getStatusPageGroups(): Array<StatusPageGroup> {
    return this.statusPageGroups;
  }

  public getGroupCount(): number {
    return this.statusPageGroups.length;
  }

  public getTree(): Array<StatusPageGroupTreeNode> {
    return this.tree;
  }

  /*
   * The tree flattened back out, parents immediately above their children -
   * the order the status page renders them in.
   */
  public getNodesInTreeOrder(): Array<StatusPageGroupIndexNode> {
    return this.nodesInTreeOrder;
  }

  public getGroupsInTreeOrder(): Array<StatusPageGroup> {
    return this.nodesInTreeOrder.map((node: StatusPageGroupIndexNode) => {
      return node.group;
    });
  }

  public getGroupById(
    statusPageGroupId: string | null | undefined,
  ): StatusPageGroup | null {
    if (!statusPageGroupId) {
      return null;
    }

    return this.groupsById.get(statusPageGroupId) || null;
  }

  public getNode(
    statusPageGroup: StatusPageGroup,
  ): StatusPageGroupIndexNode | null {
    return (
      this.nodesById.get(StatusPageGroupTreeUtil.getGroupId(statusPageGroup)) ||
      null
    );
  }

  public getRootGroups(): Array<StatusPageGroup> {
    return this.rootGroups;
  }

  /*
   * The children of a group, in `order`. `null` asks for the top level, which
   * is the tree's roots - top level groups plus any orphan promoted to one.
   */
  public getChildGroups(
    statusPageGroupId: string | null,
  ): Array<StatusPageGroup> {
    if (!statusPageGroupId) {
      return this.rootGroups;
    }

    return this.childGroupsByParentId.get(statusPageGroupId) || [];
  }

  /*
   * Ancestors, closest parent first - the same order the static
   * getAncestorGroups returns them in.
   */
  public getAncestorGroups(
    statusPageGroup: StatusPageGroup,
  ): Array<StatusPageGroup> {
    const node: StatusPageGroupIndexNode | null = this.getNode(statusPageGroup);

    if (node) {
      return [...node.ancestors].reverse();
    }

    /*
     * A group the index was not built from. Walk its parent pointers through
     * what the index does know, bounded by a visited set so a cycle stops
     * instead of looping.
     */
    const ancestors: Array<StatusPageGroup> = [];
    const visited: Set<string> = new Set<string>([
      StatusPageGroupTreeUtil.getGroupId(statusPageGroup),
    ]);

    let parentId: string | null =
      StatusPageGroupTreeUtil.getParentId(statusPageGroup);

    while (parentId && !visited.has(parentId)) {
      const parent: StatusPageGroup | undefined = this.groupsById.get(parentId);

      if (!parent) {
        break;
      }

      ancestors.push(parent);
      visited.add(parentId);
      parentId = StatusPageGroupTreeUtil.getParentId(parent);
    }

    return ancestors;
  }

  // 0 for a top level group, 1 for its children, and so on.
  public getDepth(statusPageGroup: StatusPageGroup): number {
    const node: StatusPageGroupIndexNode | null = this.getNode(statusPageGroup);

    if (node) {
      return node.depth;
    }

    return this.getAncestorGroups(statusPageGroup).length;
  }

  /*
   * Every group below this one, at any depth. Excludes the group itself, and
   * comes back in render order.
   */
  public getDescendantGroups(
    statusPageGroup: StatusPageGroup,
  ): Array<StatusPageGroup> {
    const descendants: Array<StatusPageGroup> = [];
    const visited: Set<string> = new Set<string>([
      StatusPageGroupTreeUtil.getGroupId(statusPageGroup),
    ]);

    const frontier: Array<StatusPageGroup> = [
      ...(this.childGroupsByParentId.get(
        StatusPageGroupTreeUtil.getGroupId(statusPageGroup),
      ) || []),
    ];

    while (frontier.length > 0) {
      const group: StatusPageGroup = frontier.shift()!;
      const groupId: string = StatusPageGroupTreeUtil.getGroupId(group);

      if (visited.has(groupId)) {
        continue;
      }

      visited.add(groupId);
      descendants.push(group);
      frontier.push(...(this.childGroupsByParentId.get(groupId) || []));
    }

    return descendants;
  }

  /*
   * The names from the top of the tree down to and including this group. Two
   * groups can easily both be called "Region 1000" at different levels, so
   * anywhere a group is picked from a list it is the path, not the name, that
   * tells them apart.
   */
  public getGroupPathNames(statusPageGroup: StatusPageGroup): Array<string> {
    const node: StatusPageGroupIndexNode | null = this.getNode(statusPageGroup);

    const ancestors: Array<StatusPageGroup> = node
      ? node.ancestors
      : [...this.getAncestorGroups(statusPageGroup)].reverse();

    return [
      ...ancestors.map((ancestor: StatusPageGroup) => {
        return ancestor.name || "";
      }),
      statusPageGroup.name || "",
    ];
  }

  public getGroupPathLabel(
    statusPageGroup: StatusPageGroup,
    separator: string = STATUS_PAGE_GROUP_PATH_SEPARATOR,
  ): string {
    return this.getGroupPathNames(statusPageGroup).join(separator);
  }
}
