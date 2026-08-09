import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageGroupHierarchyViewUtil from "./GroupHierarchyView";
import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
  StatusPageGroupTreeNode,
} from "./GroupTree";

/*
 * The dashboard side of status page groups - the "Resources" tab, where an
 * operator attaches monitors to the hierarchy they built on the "Groups" tab.
 *
 * That tab used to render one resource table per group, all of them at once.
 * A status page with fifteen hundred groups therefore mounted fifteen hundred
 * tables and fired fifteen hundred list requests the moment the tab opened,
 * which is what took the browser to a gigabyte of memory and then to a network
 * error (issue #3042). The tab now draws a tree whose groups are closed until
 * they are opened, and nothing inside a closed group is fetched or mounted.
 *
 * Everything in this file is the part of that tree that is worth pinning down
 * in tests: what the tree looks like, how many resources sit under each level,
 * what a search over fifteen hundred names returns, and the caps that keep any
 * single render bounded. None of it touches React or the API.
 */

/*
 * How many resources belong to each group, worked out once from a single list
 * of every resource on the status page rather than one count request per group
 * - fifteen hundred count requests is the same stampede this file exists to
 * remove.
 */
export interface StatusPageResourceCountIndex {
  /*
   * Keyed by group id. A group with no resources of its own is absent rather
   * than present with a zero, so callers must read it through getOwnCount.
   */
  ownCountByGroupId: Map<string, number>;
  /* Resources that belong to no group at all. */
  ungroupedCount: number;
  totalCount: number;
  /*
   * False when the resource list the counts were built from was cut off by the
   * API's row limit. The numbers are then lower bounds, not counts, and the UI
   * has to say nothing rather than say something wrong - an operator deciding
   * which of fifteen hundred groups still needs monitors is going to trust
   * these numbers.
   */
  isComplete: boolean;
}

/*
 * One group in the editor tree, with the two numbers a collapsed row shows:
 * what the group holds itself, and what its whole subtree holds. Both matter -
 * a group that is empty on its own is not empty if it has a hundred resources
 * nested under it, and closing it hides all of them.
 */
export interface StatusPageResourceEditorNode {
  group: StatusPageGroup;
  depth: number;
  children: Array<StatusPageResourceEditorNode>;
  ownResourceCount: number;
  subtreeResourceCount: number;
  /* Direct children only. */
  subGroupCount: number;
  /* Every group below this one, at any depth. */
  descendantGroupCount: number;
}

export interface StatusPageGroupSearchMatch {
  group: StatusPageGroup;
  /* "Corporate › Region 1000 › Market 1001" - what tells two "Market 1001"s apart. */
  path: string;
  depth: number;
}

export interface StatusPageGroupSearchResult {
  matches: Array<StatusPageGroupSearchMatch>;
  /* How many groups matched before the cap was applied. */
  totalMatchCount: number;
  isTruncated: boolean;
}

export default class StatusPageResourceEditorTreeUtil {
  /*
   * A search over fifteen hundred groups can match most of them ("e" matches
   * nearly everything), and drawing every match is the same unbounded render
   * the tree exists to avoid. Matches beyond this are counted and reported
   * rather than drawn, so the operator is told to narrow the search instead of
   * being handed a page that will not scroll.
   */
  public static readonly MaxSearchResults: number = 100;

  /*
   * How many sibling rows one level of the tree draws before it stops and
   * offers to draw more. A hierarchy is normally wide at the bottom rather
   * than the top, but nothing stops a status page from having fifteen hundred
   * top level groups, and that flat shape has to stay openable too.
   */
  public static readonly RowsPerLevelPage: number = 50;

  /*
   * "Expand all" mounts a table and fires a request per group it opens, so it
   * is offered only while that is a handful of requests. Past this the button
   * is not the convenience it looks like - it is the original bug.
   */
  public static readonly MaxGroupsToExpandAtOnce: number = 25;

  /*
   * Past this depth the indent step tightens rather than growing.
   *
   * Indentation in this tree is structural: a sub group is drawn inside its
   * parent's open body, so the offset a row ends up at is the sum of the steps
   * of everything above it, not a number any single row sets. That is why this
   * returns a step rather than a total - a row that also set its own
   * depth-proportional padding would be indenting on top of an indent, and ten
   * legal levels of nesting would push the deepest rows off the side of the
   * card.
   */
  public static readonly MaxIndentedDepth: number = 4;
  public static readonly IndentStepPixels: number = 20;
  public static readonly TightIndentStepPixels: number = 10;

  /*
   * How far the sub groups of a group at this depth are stepped in from it.
   */
  public static getIndentStepPixels(data: { depth: number }): number {
    if (!Number.isFinite(data.depth)) {
      return this.IndentStepPixels;
    }

    const depth: number = Math.floor(data.depth);

    if (depth < 0) {
      return this.IndentStepPixels;
    }

    return depth < this.MaxIndentedDepth
      ? this.IndentStepPixels
      : this.TightIndentStepPixels;
  }

  /*
   * Where a row at this depth sits, given that every level above it already
   * stepped its body in. Only useful for reasoning about (and testing) the
   * total; the components themselves only ever apply one step at a time.
   */
  public static getTotalIndentPixels(data: { depth: number }): number {
    if (!Number.isFinite(data.depth)) {
      return 0;
    }

    const depth: number = Math.floor(data.depth);
    let total: number = 0;

    for (let level: number = 0; level < depth; level++) {
      total = total + this.getIndentStepPixels({ depth: level });
    }

    return total;
  }

  /*
   * One pass over every resource on the status page. The caller fetches those
   * resources with only their id and their group id selected, so this stays
   * one small request however many groups exist.
   *
   * `totalCount` is what the API reported the query matched, which is not the
   * same as how many rows came back when the page hit the row limit - see
   * isComplete.
   */
  public static buildResourceCountIndex(data: {
    statusPageResources: Array<StatusPageResource>;
    totalCount?: number | undefined;
  }): StatusPageResourceCountIndex {
    const ownCountByGroupId: Map<string, number> = new Map<string, number>();
    let ungroupedCount: number = 0;

    for (const resource of data.statusPageResources) {
      const groupId: string | null =
        resource.statusPageGroupId?.toString() || null;

      if (!groupId) {
        ungroupedCount = ungroupedCount + 1;
        continue;
      }

      ownCountByGroupId.set(groupId, (ownCountByGroupId.get(groupId) || 0) + 1);
    }

    const fetchedCount: number = data.statusPageResources.length;
    const totalCount: number =
      data.totalCount === undefined ? fetchedCount : data.totalCount;

    return {
      ownCountByGroupId: ownCountByGroupId,
      ungroupedCount: ungroupedCount,
      totalCount: totalCount,
      isComplete: fetchedCount >= totalCount,
    };
  }

  /*
   * The count index a page has before its resource list has come back: no
   * numbers, and honest about it. Rendering the tree does not wait on the
   * counts, so every row has to be drawable without them.
   */
  public static getEmptyResourceCountIndex(): StatusPageResourceCountIndex {
    return {
      ownCountByGroupId: new Map<string, number>(),
      ungroupedCount: 0,
      totalCount: 0,
      isComplete: false,
    };
  }

  /*
   * The index with one group's count replaced by a number that came straight
   * from that group's own table.
   *
   * This is how the counts stay honest after a change without the page reading
   * every resource on the status page again. An open group's table refetches
   * after every create, edit, delete and bulk delete, and reports the total the
   * server gave it; only that group's number can have changed, so only that
   * number is replaced - and the page-wide total is moved by the difference.
   *
   * `statusPageGroupId` of null updates the bucket of resources that belong to
   * no group.
   */
  public static withGroupResourceCount(data: {
    countIndex: StatusPageResourceCountIndex;
    statusPageGroupId: string | null;
    count: number;
  }): StatusPageResourceCountIndex {
    const previousCount: number = data.statusPageGroupId
      ? data.countIndex.ownCountByGroupId.get(data.statusPageGroupId) || 0
      : data.countIndex.ungroupedCount;

    if (previousCount === data.count) {
      /*
       * The same object, so a table reporting the number the page already had
       * (which is what every ordinary refetch does) does not re-render the
       * whole tree.
       */
      return data.countIndex;
    }

    const ownCountByGroupId: Map<string, number> = new Map<string, number>(
      data.countIndex.ownCountByGroupId,
    );

    if (data.statusPageGroupId) {
      ownCountByGroupId.set(data.statusPageGroupId, data.count);
    }

    return {
      ownCountByGroupId: ownCountByGroupId,
      ungroupedCount: data.statusPageGroupId
        ? data.countIndex.ungroupedCount
        : data.count,
      totalCount: Math.max(
        0,
        data.countIndex.totalCount - previousCount + data.count,
      ),
      isComplete: data.countIndex.isComplete,
    };
  }

  public static getOwnResourceCount(data: {
    statusPageGroup: StatusPageGroup;
    countIndex: StatusPageResourceCountIndex;
  }): number {
    const groupId: string = data.statusPageGroup._id?.toString() || "";

    return data.countIndex.ownCountByGroupId.get(groupId) || 0;
  }

  /*
   * The tree the Resources tab draws. Same shape and same order as the tree
   * the public status page renders, with the two resource counts folded in on
   * the way back up.
   */
  public static buildTree(data: {
    statusPageGroups: Array<StatusPageGroup>;
    countIndex?: StatusPageResourceCountIndex | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageResourceEditorNode> {
    const countIndex: StatusPageResourceCountIndex =
      data.countIndex || this.getEmptyResourceCountIndex();

    const groupTree: Array<StatusPageGroupTreeNode> =
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      });

    type DecorateFunction = (
      node: StatusPageGroupTreeNode,
    ) => StatusPageResourceEditorNode;

    const decorate: DecorateFunction = (
      node: StatusPageGroupTreeNode,
    ): StatusPageResourceEditorNode => {
      const children: Array<StatusPageResourceEditorNode> =
        node.children.map(decorate);

      const ownResourceCount: number = this.getOwnResourceCount({
        statusPageGroup: node.group,
        countIndex: countIndex,
      });

      let subtreeResourceCount: number = ownResourceCount;
      let descendantGroupCount: number = children.length;

      for (const child of children) {
        subtreeResourceCount =
          subtreeResourceCount + child.subtreeResourceCount;
        descendantGroupCount =
          descendantGroupCount + child.descendantGroupCount;
      }

      return {
        group: node.group,
        depth: node.depth,
        children: children,
        ownResourceCount: ownResourceCount,
        subtreeResourceCount: subtreeResourceCount,
        subGroupCount: children.length,
        descendantGroupCount: descendantGroupCount,
      };
    };

    return groupTree.map(decorate);
  }

  /*
   * Every group id in the tree, in render order. What "expand all" opens, and
   * what tells the page how much "expand all" would cost before it offers it.
   */
  public static getGroupIdsInTreeOrder(
    nodes: Array<StatusPageResourceEditorNode>,
  ): Array<string> {
    const ids: Array<string> = [];

    type VisitFunction = (
      visitNodes: Array<StatusPageResourceEditorNode>,
    ) => void;

    const visit: VisitFunction = (
      visitNodes: Array<StatusPageResourceEditorNode>,
    ): void => {
      for (const node of visitNodes) {
        const groupId: string = node.group._id?.toString() || "";

        if (groupId) {
          ids.push(groupId);
        }

        visit(node.children);
      }
    };

    visit(nodes);

    return ids;
  }

  /*
   * Find a group by name across the whole hierarchy.
   *
   * Results are a flat list rather than a filtered tree on purpose. Filtering
   * a tree of fifteen hundred groups down to the matches plus every ancestor
   * of every match still leaves an unbounded, mostly irrelevant tree on the
   * screen; a list of "here are the twelve groups called Market 1001, and here
   * is where each one lives" is both smaller and the answer to the question
   * that was actually asked.
   *
   * Matching is on the group's own name, not on its path: a page whose top
   * level group is called "Corporate" would otherwise return all fifteen
   * hundred groups for the search "corp".
   */
  public static searchGroups(data: {
    statusPageGroups: Array<StatusPageGroup>;
    searchText: string;
    limit?: number | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): StatusPageGroupSearchResult {
    const searchText: string = (data.searchText || "").trim().toLowerCase();

    if (!searchText) {
      return {
        matches: [],
        totalMatchCount: 0,
        isTruncated: false,
      };
    }

    const limit: number =
      data.limit === undefined ? this.MaxSearchResults : data.limit;

    const index: StatusPageGroupTreeIndex =
      data.index ||
      StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: data.statusPageGroups,
      });

    const matches: Array<StatusPageGroupSearchMatch> = [];
    let totalMatchCount: number = 0;

    type VisitFunction = (nodes: Array<StatusPageGroupTreeNode>) => void;

    /*
     * Walked in tree order rather than in the order the groups arrived, so the
     * results keep the order the tree below them uses and stay stable as the
     * operator types.
     */
    const visit: VisitFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
    ): void => {
      for (const node of nodes) {
        const name: string = node.group.name || "";

        if (name.toLowerCase().includes(searchText)) {
          totalMatchCount = totalMatchCount + 1;

          if (matches.length < limit) {
            matches.push({
              group: node.group,
              /*
               * The admin's one path formatter, shared with the Groups tab and
               * the parent picker, so a path reads the same wherever it shows.
               */
              path: StatusPageGroupHierarchyViewUtil.getGroupPathLabel({
                statusPageGroup: node.group,
                statusPageGroups: data.statusPageGroups,
                index: index,
              }),
              depth: node.depth,
            });
          }
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

    return {
      matches: matches,
      totalMatchCount: totalMatchCount,
      isTruncated: totalMatchCount > matches.length,
    };
  }

  /*
   * Whether the page may offer to open every group at once. See
   * MaxGroupsToExpandAtOnce - this is the guard that keeps the convenience
   * button from reintroducing the stampede.
   */
  public static canExpandAll(data: { groupCount: number }): boolean {
    return (
      data.groupCount > 0 && data.groupCount <= this.MaxGroupsToExpandAtOnce
    );
  }

  /*
   * "12 resources", "1 resource", or nothing at all.
   *
   * Nothing at all covers two different cases and both have to stay silent: the
   * counts have not arrived yet, and the counts arrived truncated. A row that
   * renders "0 resources" in either case is telling the operator the group is
   * empty when the page simply does not know.
   */
  public static getResourceCountLabel(data: {
    count: number;
    countIndex: StatusPageResourceCountIndex;
  }): string | null {
    if (!data.countIndex.isComplete) {
      return null;
    }

    if (data.count === 1) {
      return "1 resource";
    }

    return `${data.count.toLocaleString()} resources`;
  }

  public static getSubGroupCountLabel(data: {
    subGroupCount: number;
  }): string | null {
    if (data.subGroupCount <= 0) {
      return null;
    }

    if (data.subGroupCount === 1) {
      return "1 sub group";
    }

    return `${data.subGroupCount.toLocaleString()} sub groups`;
  }
}
