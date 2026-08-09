import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
  StatusPageGroupTreeNode,
} from "./GroupTree";

/*
 * The admin side of the status page group hierarchy.
 *
 * Groups nest (Corporate Unit -> Region -> Market -> Site) and the page that
 * manages them used to be a flat table with a "Parent Group" column. A table
 * can tell you that "Market 1001" sits under "Region 1000"; it cannot show you
 * the shape of the thing you are building, which is the only question an
 * operator actually has in front of a hierarchy. So the page draws a tree, and
 * everything the tree needs to know - which rows are visible, how deep each one
 * sits, which guide rails are drawn beside it, which way it may be moved - is
 * worked out here rather than inline in the component.
 *
 * It lives next to GroupNestingLayout (which does the same job for the public
 * status page) for the same reason: this is the part that has to hold at depth 1
 * and still hold at depth 9 against data written straight to the database, and
 * that is worth pinning down in tests rather than in a render.
 */

/*
 * Ancestors are joined with this everywhere in the admin (Resources, Monitor
 * Rules, the parent picker), so a path reads the same wherever it is shown.
 */
export const STATUS_PAGE_GROUP_PATH_SEPARATOR: string = " › ";

export interface StatusPageGroupHierarchyRow {
  statusPageGroup: StatusPageGroup;
  /*
   * "" for a group with no id of its own, which is how the rest of the tree
   * utils read a missing id too.
   */
  id: string;
  name: string;
  /* 0 for a top level group, 1 for its children, and so on. */
  depth: number;

  /*
   * Whether the group has sub groups AT ALL, as opposed to whether any of them
   * survive the current search. The badge counts the real hierarchy - a search
   * narrows what is on screen, it does not change what the group contains.
   */
  hasSubGroups: boolean;
  subGroupCount: number;
  descendantCount: number;

  /*
   * Whether this row has children in the CURRENT view. A group whose sub groups
   * were all filtered out has nothing to disclose, so it draws no chevron.
   */
  hasVisibleSubGroups: boolean;
  isExpanded: boolean;

  /*
   * One entry per indent column left of this row's own connector, outermost
   * first. True means the ancestor that owns that column still has a sibling
   * below this row, so its guide rail continues past it; false means the rail
   * has already ended and the column is blank.
   *
   * Trimmed from the left at MaxIndentColumns - see getIndentColumnCount.
   */
  ancestorRails: Array<boolean>;
  /* Ends this row's own connector in an elbow rather than a tee. */
  isLastVisibleSibling: boolean;

  /*
   * This row's place among the siblings that are actually drawn, 0 based. A
   * tree tells a screen reader "3 of 7 at level 2", and the counts it quotes
   * have to be the ones on screen or they describe a tree nobody can see.
   */
  visibleSiblingIndex: number;
  visibleSiblingCount: number;

  /* Ancestor names, top level first, excluding the group itself. */
  ancestorNames: Array<string>;

  /*
   * True when the group itself matches the current search. Rows that are only
   * on screen because a descendant matched are drawn quieter - they are context,
   * not results.
   */
  isSearchMatch: boolean;

  /*
   * The group's REAL neighbours under the same parent, not its neighbours in the
   * filtered view. Reordering writes to `order`, which is a property of the
   * hierarchy rather than of whatever the operator happens to have typed into
   * the search box, so a move must always mean the same thing.
   */
  previousSiblingId: string | null;
  nextSiblingId: string | null;
  canMoveUp: boolean;
  canMoveDown: boolean;
}

/*
 * One level of the hierarchy: every group that shares a parent, and where each
 * of them sits in that level. Worked out once per parent by getRows so that a
 * fifteen hundred group level is not re-derived for every one of its rows.
 */
interface SiblingLevel {
  siblings: Array<StatusPageGroup>;
  positionById: Map<string, number>;
}

export interface StatusPageGroupHierarchySummary {
  totalCount: number;
  topLevelCount: number;
  nestedCount: number;
  /*
   * How many levels the hierarchy actually uses - 1 for a flat list, 0 when
   * there are no groups. Deliberately 1-based: it is shown to a human as
   * "3 levels", and a hierarchy that is one level deep is not zero levels deep.
   */
  levelCount: number;
}

export default class StatusPageGroupHierarchyViewUtil {
  /*
   * How many indent columns a row may draw before the tree stops stepping
   * right. Nesting is capped on write at StatusPageGroupTreeUtil.MaxNestingDepth
   * (10, so the deepest legal row sits at depth 9 and needs 9 columns), but rows
   * written straight to the database are not capped, and a row that indents
   * itself off the right of the card is worse than a row whose outermost rails
   * are elided.
   */
  public static readonly MaxIndentColumns: number = 10;

  public static getIndentColumnCount(data: { depth: number }): number {
    if (!Number.isFinite(data.depth)) {
      return 0;
    }

    const depth: number = Math.floor(data.depth);

    if (depth <= 0) {
      return 0;
    }

    return Math.min(depth, this.MaxIndentColumns);
  }

  /*
   * The rows to render, in tree order, with everything each row needs to draw
   * itself. Collapsed subtrees are not in the result at all - the component
   * renders a flat list, so "collapsed" and "absent" have to be the same thing.
   */
  public static getRows(data: {
    statusPageGroups: Array<StatusPageGroup>;
    expandedGroupIds?: Set<string> | undefined;
    searchText?: string | undefined;
  }): Array<StatusPageGroupHierarchyRow> {
    const index: StatusPageGroupTreeIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: data.statusPageGroups,
    });

    const tree: Array<StatusPageGroupTreeNode> =
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: index,
      });

    const searchTerm: string = this.normalizeSearchText(data.searchText);
    const isSearching: boolean = searchTerm.length > 0;

    const matchedIds: Set<string> = isSearching
      ? this.getMatchingGroupIds({
          statusPageGroups: data.statusPageGroups,
          searchText: searchTerm,
        })
      : new Set<string>();

    const visibleIds: Set<string> | null = isSearching
      ? this.getSearchVisibleGroupIds({
          statusPageGroups: data.statusPageGroups,
          searchText: searchTerm,
          index: index,
        })
      : null;

    /*
     * An ancestor of a match is opened whatever the operator collapsed earlier:
     * a search that hides its own results behind a collapsed parent is a search
     * that found nothing as far as the operator can tell.
     */
    const forcedExpandedIds: Set<string> = isSearching
      ? this.getAncestorIdsOfMatches({
          statusPageGroups: data.statusPageGroups,
          matchedIds: matchedIds,
          index: index,
        })
      : new Set<string>();

    const expandedGroupIds: Set<string> =
      data.expandedGroupIds || new Set<string>();

    const rows: Array<StatusPageGroupHierarchyRow> = [];

    /*
     * Where each group sits among its siblings, worked out once per parent
     * rather than once per row.
     *
     * Without it, a status page whose groups are all at the top level asks for
     * the same fifteen hundred long sibling list fifteen hundred times and
     * scans it each time - two and a quarter million comparisons and fifteen
     * hundred copies of the array, which is seconds of work on every keystroke
     * and every group opened.
     */
    const siblingsByParentKey: Map<string, SiblingLevel> = new Map<
      string,
      SiblingLevel
    >();

    type GetSiblingLevelFunction = (
      statusPageGroup: StatusPageGroup,
    ) => SiblingLevel;

    const getSiblingLevel: GetSiblingLevelFunction = (
      statusPageGroup: StatusPageGroup,
    ): SiblingLevel => {
      const parentId: string | null =
        StatusPageGroupTreeUtil.getParentId(statusPageGroup);

      /*
       * The same key getSiblingGroups resolves to: a group whose parent is not
       * on this status page is a root, and its siblings are the other roots.
       */
      const parentKey: string =
        parentId && index.byId.has(parentId) ? parentId : "";

      const cached: SiblingLevel | undefined =
        siblingsByParentKey.get(parentKey);

      if (cached) {
        return cached;
      }

      const siblings: Array<StatusPageGroup> = this.getSiblingGroups({
        statusPageGroup: statusPageGroup,
        statusPageGroups: data.statusPageGroups,
        index: index,
      });

      const positionById: Map<string, number> = new Map<string, number>();

      siblings.forEach((sibling: StatusPageGroup, position: number): void => {
        positionById.set(this.getGroupId(sibling), position);
      });

      const level: SiblingLevel = {
        siblings: siblings,
        positionById: positionById,
      };

      siblingsByParentKey.set(parentKey, level);

      return level;
    };

    type WalkFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
      ancestorRails: Array<boolean>,
      ancestorNames: Array<string>,
    ) => void;

    const walk: WalkFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
      ancestorRails: Array<boolean>,
      ancestorNames: Array<string>,
    ): void => {
      /*
       * Filtered before the positions below are worked out, so "is this the last
       * one" is asked of the rows that are actually drawn. Skipping a whole node
       * is safe: a group is visible whenever anything in its subtree matched, so
       * an invisible node cannot be hiding a visible descendant.
       */
      const visibleNodes: Array<StatusPageGroupTreeNode> = visibleIds
        ? nodes.filter((node: StatusPageGroupTreeNode) => {
            return visibleIds.has(this.getGroupId(node.group));
          })
        : nodes;

      visibleNodes.forEach(
        (node: StatusPageGroupTreeNode, position: number): void => {
          const groupId: string = this.getGroupId(node.group);
          const isLastVisibleSibling: boolean =
            position === visibleNodes.length - 1;

          const visibleChildren: Array<StatusPageGroupTreeNode> = visibleIds
            ? node.children.filter((child: StatusPageGroupTreeNode) => {
                return visibleIds.has(this.getGroupId(child.group));
              })
            : node.children;

          const hasVisibleSubGroups: boolean = visibleChildren.length > 0;

          const isExpanded: boolean =
            hasVisibleSubGroups &&
            (expandedGroupIds.has(groupId) || forcedExpandedIds.has(groupId));

          const neighbours: {
            previousSiblingId: string | null;
            nextSiblingId: string | null;
          } = this.getSiblingNeighbours({
            statusPageGroup: node.group,
            statusPageGroups: data.statusPageGroups,
            index: index,
            siblingLevel: getSiblingLevel(node.group),
          });

          rows.push({
            statusPageGroup: node.group,
            id: groupId,
            name: node.group.name || "",
            depth: node.depth,
            hasSubGroups: node.children.length > 0,
            subGroupCount: node.children.length,
            descendantCount: this.countDescendants({ node: node }),
            hasVisibleSubGroups: hasVisibleSubGroups,
            isExpanded: isExpanded,
            ancestorRails: this.trimRails({
              rails: ancestorRails,
              depth: node.depth,
            }),
            isLastVisibleSibling: isLastVisibleSibling,
            visibleSiblingIndex: position,
            visibleSiblingCount: visibleNodes.length,
            ancestorNames: [...ancestorNames],
            isSearchMatch: !isSearching || matchedIds.has(groupId),
            previousSiblingId: neighbours.previousSiblingId,
            nextSiblingId: neighbours.nextSiblingId,
            canMoveUp: neighbours.previousSiblingId !== null,
            canMoveDown: neighbours.nextSiblingId !== null,
          });

          if (isExpanded) {
            walk(
              node.children,
              [...ancestorRails, !isLastVisibleSibling],
              [...ancestorNames, node.group.name || ""],
            );
          }
        },
      );
    };

    walk(tree, [], []);

    return rows;
  }

  /*
   * Groups whose name or description contains the search text. Case and
   * surrounding whitespace are ignored - an operator hunting for a group they
   * half remember should not have to match its capitalisation.
   */
  public static getMatchingGroupIds(data: {
    statusPageGroups: Array<StatusPageGroup>;
    searchText?: string | undefined;
  }): Set<string> {
    const searchTerm: string = this.normalizeSearchText(data.searchText);

    const matchedIds: Set<string> = new Set<string>();

    if (!searchTerm) {
      return matchedIds;
    }

    for (const group of data.statusPageGroups) {
      if (
        this.matchesSearch({ statusPageGroup: group, searchText: searchTerm })
      ) {
        matchedIds.add(this.getGroupId(group));
      }
    }

    return matchedIds;
  }

  public static matchesSearch(data: {
    statusPageGroup: StatusPageGroup;
    searchText?: string | undefined;
  }): boolean {
    const searchTerm: string = this.normalizeSearchText(data.searchText);

    if (!searchTerm) {
      return true;
    }

    const haystack: string = [
      data.statusPageGroup.name || "",
      data.statusPageGroup.description || "",
    ]
      .join(" ")
      .toLowerCase();

    return haystack.includes(searchTerm);
  }

  /*
   * Everything a search puts on screen: the matches, the ancestors that give
   * each match its place in the hierarchy, and the matches' own subtrees.
   *
   * The subtrees are there because a hierarchy is what the operator is looking
   * at. Searching "Region 1000" and being shown a Region with no contents would
   * be answering a different question from the one that was asked.
   */
  public static getSearchVisibleGroupIds(data: {
    statusPageGroups: Array<StatusPageGroup>;
    searchText?: string | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Set<string> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const matchedIds: Set<string> = this.getMatchingGroupIds({
      statusPageGroups: data.statusPageGroups,
      searchText: data.searchText,
    });

    const visibleIds: Set<string> = new Set<string>();

    for (const group of data.statusPageGroups) {
      if (!matchedIds.has(this.getGroupId(group))) {
        continue;
      }

      visibleIds.add(this.getGroupId(group));

      for (const ancestor of StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: group,
        statusPageGroups: data.statusPageGroups,
        index: index,
      })) {
        visibleIds.add(this.getGroupId(ancestor));
      }

      for (const descendant of StatusPageGroupTreeUtil.getDescendantGroups({
        statusPageGroup: group,
        statusPageGroups: data.statusPageGroups,
        index: index,
      })) {
        visibleIds.add(this.getGroupId(descendant));
      }
    }

    return visibleIds;
  }

  /* Every group that has sub groups - what "Expand all" turns on. */
  public static getExpandableGroupIds(data: {
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Set<string> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const expandableIds: Set<string> = new Set<string>();

    type VisitFunction = (nodes: Array<StatusPageGroupTreeNode>) => void;

    const visit: VisitFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
    ): void => {
      for (const node of nodes) {
        if (node.children.length > 0) {
          expandableIds.add(this.getGroupId(node.group));
        }

        visit(node.children);
      }
    };

    visit(
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: index,
      }),
    );

    return expandableIds;
  }

  /*
   * What the page opens with.
   *
   * Everything down to maxAutoExpandDepth is open, and deeper levels start
   * shut. A hierarchy that is fully expanded on arrival is unreadable at any
   * real size, and one that is fully collapsed hides the fact that it nests at
   * all - which is the single thing this page exists to show.
   */
  public static getDefaultExpandedGroupIds(data: {
    statusPageGroups: Array<StatusPageGroup>;
    maxAutoExpandDepth?: number | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Set<string> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const maxAutoExpandDepth: number =
      data.maxAutoExpandDepth === undefined ? 1 : data.maxAutoExpandDepth;

    const expandedIds: Set<string> = new Set<string>();

    type VisitFunction = (nodes: Array<StatusPageGroupTreeNode>) => void;

    const visit: VisitFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
    ): void => {
      for (const node of nodes) {
        if (node.children.length > 0 && node.depth <= maxAutoExpandDepth) {
          expandedIds.add(this.getGroupId(node.group));
        }

        visit(node.children);
      }
    };

    visit(
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: index,
      }),
    );

    return expandedIds;
  }

  public static getSummary(data: {
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): StatusPageGroupHierarchySummary {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    let topLevelCount: number = 0;
    let deepestDepth: number = -1;

    type VisitFunction = (nodes: Array<StatusPageGroupTreeNode>) => void;

    const visit: VisitFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
    ): void => {
      for (const node of nodes) {
        if (node.depth === 0) {
          topLevelCount++;
        }

        if (node.depth > deepestDepth) {
          deepestDepth = node.depth;
        }

        visit(node.children);
      }
    };

    visit(
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: index,
      }),
    );

    const totalCount: number = data.statusPageGroups.length;

    return {
      totalCount: totalCount,
      topLevelCount: topLevelCount,
      nestedCount: totalCount - topLevelCount,
      levelCount: deepestDepth + 1,
    };
  }

  /* "Corporate › Region 1000 › Market 1001", the group itself last. */
  public static getGroupPathLabel(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): string {
    const ancestors: Array<StatusPageGroup> =
      StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: data.statusPageGroup,
        statusPageGroups: data.statusPageGroups,
        index: this.resolveIndex(data),
      }).reverse();

    return [
      ...ancestors.map((ancestor: StatusPageGroup) => {
        return ancestor.name || "";
      }),
      data.statusPageGroup.name || "",
    ].join(STATUS_PAGE_GROUP_PATH_SEPARATOR);
  }

  /*
   * The groups that may legally be picked as a parent, in tree order.
   *
   * StatusPageGroupService is the only place that can decide this for real - it
   * is the one that sees the tree at write time - so this is not validation, it
   * is the picker refusing to offer a choice it already knows the API will
   * reject. The three rules it applies are the same three the service enforces:
   * a group is not its own parent, a group does not move under its own sub
   * group, and the moved subtree still has to fit inside MaxNestingDepth.
   */
  public static getParentGroupCandidates(data: {
    statusPageGroups: Array<StatusPageGroup>;
    /*
     * The group being edited. Omitted when creating, where nothing is excluded
     * on identity grounds and the subtree being placed is empty.
     */
    statusPageGroupId?: string | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const statusPageGroupId: string = data.statusPageGroupId || "";

    const group: StatusPageGroup | undefined = statusPageGroupId
      ? index.byId.get(statusPageGroupId)
      : undefined;

    const excludedIds: Set<string> = new Set<string>();
    let subtreeHeight: number = 0;

    if (group) {
      excludedIds.add(statusPageGroupId);

      for (const descendant of StatusPageGroupTreeUtil.getDescendantGroups({
        statusPageGroup: group,
        statusPageGroups: data.statusPageGroups,
        index: index,
      })) {
        excludedIds.add(this.getGroupId(descendant));
      }

      subtreeHeight = this.getSubtreeHeight({
        statusPageGroup: group,
        statusPageGroups: data.statusPageGroups,
        index: index,
      });
    }

    const candidates: Array<StatusPageGroup> = [];

    type VisitFunction = (nodes: Array<StatusPageGroupTreeNode>) => void;

    const visit: VisitFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
    ): void => {
      for (const node of nodes) {
        const nodeId: string = this.getGroupId(node.group);

        if (excludedIds.has(nodeId)) {
          /*
           * Its whole subtree is excluded too, and buildTree already nested
           * them under it, so there is nothing below worth walking.
           */
          continue;
        }

        if (
          node.depth + 1 + subtreeHeight <
          StatusPageGroupTreeUtil.MaxNestingDepth
        ) {
          candidates.push(node.group);
        }

        visit(node.children);
      }
    };

    visit(
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: index,
      }),
    );

    return candidates;
  }

  /*
   * How many levels hang below this group. 0 for a leaf, 1 for a group whose
   * children are all leaves. This is the part of a move the server also has to
   * account for: a group carries its subtree with it.
   */
  public static getSubtreeHeight(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): number {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const ownDepth: number = StatusPageGroupTreeUtil.getDepth({
      statusPageGroup: data.statusPageGroup,
      statusPageGroups: data.statusPageGroups,
      index: index,
    });

    let height: number = 0;

    for (const descendant of StatusPageGroupTreeUtil.getDescendantGroups({
      statusPageGroup: data.statusPageGroup,
      statusPageGroups: data.statusPageGroups,
      index: index,
    })) {
      const relativeDepth: number =
        StatusPageGroupTreeUtil.getDepth({
          statusPageGroup: descendant,
          statusPageGroups: data.statusPageGroups,
          index: index,
        }) - ownDepth;

      if (relativeDepth > height) {
        height = relativeDepth;
      }
    }

    return height;
  }

  /*
   * The `order` a group has to be given to swap places with the sibling above
   * or below it.
   *
   * `order` is one flat sequence across the whole status page rather than one
   * per parent, so a sibling's own order is the correct target: the service
   * renumbers everything between the two, which is what keeps every other
   * group's relative position intact.
   */
  public static getReorderTargetOrder(data: {
    statusPageGroups: Array<StatusPageGroup>;
    statusPageGroupId: string;
    direction: "up" | "down";
    index?: StatusPageGroupTreeIndex | undefined;
  }): number | null {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const group: StatusPageGroup | undefined = index.byId.get(
      data.statusPageGroupId,
    );

    if (!group) {
      return null;
    }

    const neighbours: {
      previousSiblingId: string | null;
      nextSiblingId: string | null;
    } = this.getSiblingNeighbours({
      statusPageGroup: group,
      statusPageGroups: data.statusPageGroups,
      index: index,
    });

    const neighbourId: string | null =
      data.direction === "up"
        ? neighbours.previousSiblingId
        : neighbours.nextSiblingId;

    if (!neighbourId) {
      return null;
    }

    const neighbour: StatusPageGroup | undefined = index.byId.get(neighbourId);

    if (!neighbour || typeof neighbour.order !== "number") {
      return null;
    }

    return neighbour.order;
  }

  /*
   * The groups drawn beside this one under the same parent, in render order.
   *
   * Top level rows read their neighbours from getRootGroups rather than from
   * the parent buckets, because that is the list buildTree put them in: an
   * orphan (a group whose parent was not fetched, or was deleted from under it)
   * renders at the top level, and reading the bucket for its dangling parent id
   * would tell it that it has no neighbours at all.
   */
  public static getSiblingGroups(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageGroup> {
    const index: StatusPageGroupTreeIndex = this.resolveIndex(data);

    const parentId: string | null = StatusPageGroupTreeUtil.getParentId(
      data.statusPageGroup,
    );

    if (parentId && index.byId.has(parentId)) {
      return StatusPageGroupTreeUtil.getChildGroups({
        statusPageGroupId: parentId,
        statusPageGroups: data.statusPageGroups,
        index: index,
      });
    }

    return StatusPageGroupTreeUtil.getRootGroups({
      statusPageGroups: data.statusPageGroups,
      index: index,
    });
  }

  private static getSiblingNeighbours(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
    index: StatusPageGroupTreeIndex;
    /*
     * This group's whole sibling level, when the caller has already worked it
     * out - which it has whenever it is drawing more than one row of it. See
     * getRows.
     */
    siblingLevel?: SiblingLevel | undefined;
  }): { previousSiblingId: string | null; nextSiblingId: string | null } {
    const siblings: Array<StatusPageGroup> =
      data.siblingLevel?.siblings ||
      this.getSiblingGroups({
        statusPageGroup: data.statusPageGroup,
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      });

    const groupId: string = this.getGroupId(data.statusPageGroup);

    const cachedPosition: number | undefined =
      data.siblingLevel?.positionById.get(groupId);

    const position: number =
      cachedPosition === undefined
        ? siblings.findIndex((sibling: StatusPageGroup) => {
            return this.getGroupId(sibling) === groupId;
          })
        : cachedPosition;

    if (position < 0) {
      return { previousSiblingId: null, nextSiblingId: null };
    }

    const previous: StatusPageGroup | undefined = siblings[position - 1];
    const next: StatusPageGroup | undefined = siblings[position + 1];

    return {
      previousSiblingId: previous ? this.getGroupId(previous) : null,
      nextSiblingId: next ? this.getGroupId(next) : null,
    };
  }

  private static getAncestorIdsOfMatches(data: {
    statusPageGroups: Array<StatusPageGroup>;
    matchedIds: Set<string>;
    index: StatusPageGroupTreeIndex;
  }): Set<string> {
    const ancestorIds: Set<string> = new Set<string>();

    for (const group of data.statusPageGroups) {
      if (!data.matchedIds.has(this.getGroupId(group))) {
        continue;
      }

      for (const ancestor of StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: group,
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      })) {
        ancestorIds.add(this.getGroupId(ancestor));
      }
    }

    return ancestorIds;
  }

  private static countDescendants(data: {
    node: StatusPageGroupTreeNode;
  }): number {
    let count: number = 0;

    for (const child of data.node.children) {
      count += 1 + this.countDescendants({ node: child });
    }

    return count;
  }

  /*
   * Past MaxIndentColumns the outermost rails are dropped rather than the
   * nearest ones: the columns closest to the row are the ones that say where it
   * sits, and a row that has walked off the right of the card says nothing at
   * all.
   */
  private static trimRails(data: {
    rails: Array<boolean>;
    depth: number;
  }): Array<boolean> {
    const columnCount: number = this.getIndentColumnCount({
      depth: data.depth,
    });

    /* One column is this row's own connector; the rest are ancestor rails. */
    const railCount: number = Math.max(0, columnCount - 1);

    if (data.rails.length <= railCount) {
      return [...data.rails];
    }

    return data.rails.slice(data.rails.length - railCount);
  }

  private static normalizeSearchText(searchText?: string | undefined): string {
    return (searchText || "").trim().toLowerCase();
  }

  private static getGroupId(statusPageGroup: StatusPageGroup): string {
    return statusPageGroup._id?.toString() || "";
  }

  private static resolveIndex(data: {
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): StatusPageGroupTreeIndex {
    return (
      data.index ||
      StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: data.statusPageGroups,
      })
    );
  }
}
