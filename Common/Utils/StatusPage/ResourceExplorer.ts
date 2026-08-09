import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageGroupViewMode from "../../Types/StatusPage/StatusPageGroupViewMode";
import StatusPageGroupHierarchyViewUtil, {
  StatusPageGroupHierarchyRow,
} from "./GroupHierarchyView";
import StatusPageGroupTreeUtil, {
  StatusPageGroupTreeIndex,
  StatusPageGroupTreeNode,
} from "./GroupTree";

/*
 * The model behind the Resources tab: the screen where an operator puts
 * monitors into the group hierarchy they built on the Groups tab.
 *
 * That screen used to be a tree of group rows, and opening a row mounted a
 * whole ModelTable - card, title, description, create button, overflow menu,
 * checkbox column, pagination footer - inside it. Nesting a table's worth of
 * chrome inside a row of another tree made a simple question ("what is in this
 * group, and how do I add to it?") read as a stack of half-collapsed
 * dashboards, and it only got worse the deeper the group sat.
 *
 * So the screen is an explorer now: the hierarchy on the left, the contents of
 * exactly one selected group on the right. That is the shape every operator
 * already knows from a file browser, and it has a property the old tab could
 * not have - one group is loaded at a time, whatever the hierarchy costs, which
 * is what keeps a fifteen hundred group status page from firing fifteen hundred
 * requests the moment the tab opens (issue #3042).
 *
 * Everything here is the part of that explorer worth pinning down without a
 * renderer: what the navigator draws, which counts each row is allowed to
 * claim, what a selection resolves to, and how a drag turns into the one write
 * the server understands.
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
   * than present with a zero, so callers must read it through
   * getOwnResourceCount.
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
 * What the right hand pane is showing. "Ungrouped" is a real place on a status
 * page - the resources that sit above every group - so it is a selection like
 * any other rather than a group with a null id.
 */
export enum StatusPageResourceSelectionType {
  Group = "Group",
  Ungrouped = "Ungrouped",
}

export interface StatusPageResourceSelection {
  type: StatusPageResourceSelectionType;
  /* The group's id, or null for the ungrouped bucket. */
  statusPageGroupId: string | null;
}

/*
 * One row of the navigator. Everything the row draws is on it: the caller does
 * no tree walking, no counting and no lookups of its own.
 */
export interface StatusPageResourceNavigatorRow {
  statusPageGroup: StatusPageGroup;
  id: string;
  name: string;
  depth: number;
  viewMode: StatusPageGroupViewMode | undefined;

  /* Which ancestor rails are still running down beside this row. */
  ancestorRails: Array<boolean>;
  isLastVisibleSibling: boolean;
  visibleSiblingIndex: number;
  visibleSiblingCount: number;

  hasSubGroups: boolean;
  subGroupCount: number;
  hasVisibleSubGroups: boolean;
  isExpanded: boolean;

  /*
   * False for a row that is only on screen to give a match its place in the
   * hierarchy. Those rows are context, and are drawn as context.
   */
  isSearchMatch: boolean;

  /* What selecting this row puts in the pane. */
  ownResourceCount: number;
  /*
   * What selecting this row and every row under it would put in the pane. Worth
   * showing because it is the number that answers "is there anything down
   * there?" without opening anything.
   */
  subtreeResourceCount: number;
}

export interface StatusPageResourceNavigatorResult {
  rows: Array<StatusPageResourceNavigatorRow>;
  /* How many rows there were before the cap was applied. */
  totalRowCount: number;
  isTruncated: boolean;
}

/*
 * Where a group sits, as something the pane can draw one clickable step at a
 * time rather than as a single "A › B › C" string.
 */
export interface StatusPageResourceBreadcrumbStep {
  id: string;
  name: string;
}

/*
 * A grid group's resources, sorted into the matrix the public status page
 * draws them as - plus the ones that fell outside it.
 */
export interface StatusPageResourceGridModel {
  /* Keyed by getGridCellKey. */
  resourcesByCellKey: Map<string, Array<StatusPageResource>>;
  /*
   * Resources whose axis values are not among the group's. Usually the wake of
   * an axis value that was renamed after resources were assigned to it.
   */
  orphanResources: Array<StatusPageResource>;
}

export default class StatusPageResourceExplorerUtil {
  /*
   * How many navigator rows are drawn before the list stops and offers to draw
   * more.
   *
   * Collapsing a group already removes its whole subtree from the row list, so
   * the navigator is normally short. One shape gets past that: a status page
   * whose groups are all at the top level, where nothing is nested and so
   * nothing can be collapsed away. Fifteen hundred rows of that is a page that
   * will not scroll, so the list is capped and says so.
   */
  public static readonly MaxNavigatorRows: number = 200;

  /*
   * How many more rows each press of "Show more" adds.
   */
  public static readonly NavigatorRowsPerPage: number = 200;

  /*
   * A group with more resources than this is not worth drawing all at once.
   * The pane draws this many and offers the rest a page at a time - the list
   * stays scrollable and the DOM stays bounded, without a second request.
   */
  public static readonly ResourceRowsPerPage: number = 100;

  /*
   * "Expand all" opens every group in the navigator. That costs nothing but a
   * re-render - no group's resources are fetched until it is selected - but a
   * navigator with fifteen hundred rows in it is not a navigator, so the offer
   * is withdrawn past the point where the result would be usable.
   */
  public static readonly MaxGroupsToExpandAtOnce: number = 200;

  /* ------------------------------------------------------------------ */
  /* Counts                                                              */
  /* ------------------------------------------------------------------ */

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
   * numbers, and honest about it. The navigator does not wait on the counts, so
   * every row has to be drawable without them.
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
   * from that group's own pane.
   *
   * This is how the counts stay honest after a change without the page reading
   * every resource on the status page again. The selected group refetches after
   * every create, delete and bulk add and reports what came back; only that
   * group's number can have changed, so only that number is replaced - and the
   * page-wide total is moved by the difference.
   *
   * `statusPageGroupId` of null updates the ungrouped bucket.
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
       * The same object, so a pane reporting the number the page already had -
       * which is what every ordinary refetch does - does not re-render the
       * whole navigator.
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
   * How many resources sit under each group including every group below it,
   * worked out in one pass up the tree rather than once per row.
   */
  public static buildSubtreeResourceCountIndex(data: {
    statusPageGroups: Array<StatusPageGroup>;
    countIndex: StatusPageResourceCountIndex;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Map<string, number> {
    const subtreeCountByGroupId: Map<string, number> = new Map<
      string,
      number
    >();

    const tree: Array<StatusPageGroupTreeNode> =
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      });

    type VisitFunction = (node: StatusPageGroupTreeNode) => number;

    const visit: VisitFunction = (node: StatusPageGroupTreeNode): number => {
      const groupId: string = node.group._id?.toString() || "";

      let total: number = this.getOwnResourceCount({
        statusPageGroup: node.group,
        countIndex: data.countIndex,
      });

      for (const child of node.children) {
        total = total + visit(child);
      }

      if (groupId) {
        subtreeCountByGroupId.set(groupId, total);
      }

      return total;
    };

    for (const node of tree) {
      visit(node);
    }

    return subtreeCountByGroupId;
  }

  /* ------------------------------------------------------------------ */
  /* The navigator                                                       */
  /* ------------------------------------------------------------------ */

  /*
   * The rows the navigator draws, in tree order, with collapsed subtrees
   * already gone and the counts already attached.
   *
   * The hierarchy itself - rails, expansion, what a search reveals - is the
   * same one the Groups tab draws, from the same util, so a group sits in the
   * same place in both and a search finds it the same way.
   */
  public static getNavigatorRows(data: {
    statusPageGroups: Array<StatusPageGroup>;
    countIndex: StatusPageResourceCountIndex;
    expandedGroupIds?: Set<string> | undefined;
    searchText?: string | undefined;
    maxRows?: number | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): StatusPageResourceNavigatorResult {
    const hierarchyRows: Array<StatusPageGroupHierarchyRow> =
      StatusPageGroupHierarchyViewUtil.getRows({
        statusPageGroups: data.statusPageGroups,
        expandedGroupIds: data.expandedGroupIds,
        searchText: data.searchText,
      });

    const subtreeCountByGroupId: Map<string, number> =
      this.buildSubtreeResourceCountIndex({
        statusPageGroups: data.statusPageGroups,
        countIndex: data.countIndex,
        index: data.index,
      });

    const maxRows: number =
      data.maxRows === undefined ? this.MaxNavigatorRows : data.maxRows;

    const visibleRows: Array<StatusPageGroupHierarchyRow> =
      maxRows >= 0 ? hierarchyRows.slice(0, maxRows) : hierarchyRows;

    const rows: Array<StatusPageResourceNavigatorRow> = visibleRows.map(
      (row: StatusPageGroupHierarchyRow): StatusPageResourceNavigatorRow => {
        return {
          statusPageGroup: row.statusPageGroup,
          id: row.id,
          name: row.name,
          depth: row.depth,
          viewMode: row.statusPageGroup.viewMode,
          ancestorRails: row.ancestorRails,
          isLastVisibleSibling: row.isLastVisibleSibling,
          visibleSiblingIndex: row.visibleSiblingIndex,
          visibleSiblingCount: row.visibleSiblingCount,
          hasSubGroups: row.hasSubGroups,
          subGroupCount: row.subGroupCount,
          hasVisibleSubGroups: row.hasVisibleSubGroups,
          isExpanded: row.isExpanded,
          isSearchMatch: row.isSearchMatch,
          ownResourceCount: this.getOwnResourceCount({
            statusPageGroup: row.statusPageGroup,
            countIndex: data.countIndex,
          }),
          subtreeResourceCount: subtreeCountByGroupId.get(row.id) || 0,
        };
      },
    );

    return {
      rows: rows,
      totalRowCount: hierarchyRows.length,
      isTruncated: rows.length < hierarchyRows.length,
    };
  }

  /*
   * The groups that have to be open for a group to be visible in the navigator.
   *
   * Selecting a group the operator cannot see - because a create landed in a
   * collapsed branch, or because a link arrived pointing at one - reads exactly
   * like the selection having failed.
   */
  public static getGroupIdsToReveal(data: {
    statusPageGroups: Array<StatusPageGroup>;
    statusPageGroupId: string | null | undefined;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Set<string> {
    const ids: Set<string> = new Set<string>();

    if (!data.statusPageGroupId) {
      return ids;
    }

    const statusPageGroup: StatusPageGroup | undefined =
      data.statusPageGroups.find((group: StatusPageGroup): boolean => {
        return group._id?.toString() === data.statusPageGroupId;
      });

    if (!statusPageGroup) {
      return ids;
    }

    const ancestors: Array<StatusPageGroup> =
      StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: statusPageGroup,
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      });

    for (const ancestor of ancestors) {
      const ancestorId: string = ancestor._id?.toString() || "";

      if (ancestorId) {
        ids.add(ancestorId);
      }
    }

    return ids;
  }

  /*
   * Every group id in the hierarchy, in tree order. What "expand all" opens.
   */
  public static getAllGroupIds(data: {
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<string> {
    const ids: Array<string> = [];

    type VisitFunction = (nodes: Array<StatusPageGroupTreeNode>) => void;

    const visit: VisitFunction = (
      nodes: Array<StatusPageGroupTreeNode>,
    ): void => {
      for (const node of nodes) {
        const groupId: string = node.group._id?.toString() || "";

        if (groupId) {
          ids.push(groupId);
        }

        visit(node.children);
      }
    };

    visit(
      StatusPageGroupTreeUtil.buildTree({
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      }),
    );

    return ids;
  }

  public static canExpandAll(data: { groupCount: number }): boolean {
    return (
      data.groupCount > 0 && data.groupCount <= this.MaxGroupsToExpandAtOnce
    );
  }

  /*
   * Where the selected group sits, root first, as steps the pane can make
   * clickable. The group itself is not a step - it is the heading the steps
   * lead to.
   */
  public static getBreadcrumbSteps(data: {
    statusPageGroup: StatusPageGroup;
    statusPageGroups: Array<StatusPageGroup>;
    index?: StatusPageGroupTreeIndex | undefined;
  }): Array<StatusPageResourceBreadcrumbStep> {
    const ancestors: Array<StatusPageGroup> =
      StatusPageGroupTreeUtil.getAncestorGroups({
        statusPageGroup: data.statusPageGroup,
        statusPageGroups: data.statusPageGroups,
        index: data.index,
      });

    /* getAncestorGroups walks upwards; a breadcrumb reads downwards. */
    return ancestors
      .slice()
      .reverse()
      .map((ancestor: StatusPageGroup): StatusPageResourceBreadcrumbStep => {
        return {
          id: ancestor._id?.toString() || "",
          name: ancestor.name || "Untitled group",
        };
      })
      .filter((step: StatusPageResourceBreadcrumbStep): boolean => {
        return step.id.length > 0;
      });
  }

  /*
   * The selection a freshly opened tab starts on.
   *
   * The ungrouped bucket, unless the status page has no ungrouped resources and
   * does have groups - in which case starting there would be an empty pane with
   * a full navigator beside it, which reads as a page that failed to load.
   */
  public static getInitialSelection(data: {
    statusPageGroups: Array<StatusPageGroup>;
    countIndex: StatusPageResourceCountIndex;
  }): StatusPageResourceSelection {
    const ungroupedSelection: StatusPageResourceSelection = {
      type: StatusPageResourceSelectionType.Ungrouped,
      statusPageGroupId: null,
    };

    if (data.statusPageGroups.length === 0) {
      return ungroupedSelection;
    }

    if (!data.countIndex.isComplete || data.countIndex.ungroupedCount > 0) {
      return ungroupedSelection;
    }

    const firstGroupId: string | undefined = this.getAllGroupIds({
      statusPageGroups: data.statusPageGroups,
    })[0];

    if (!firstGroupId) {
      return ungroupedSelection;
    }

    return {
      type: StatusPageResourceSelectionType.Group,
      statusPageGroupId: firstGroupId,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Resources in the selected group                                     */
  /* ------------------------------------------------------------------ */

  /*
   * What a resource is called on this screen.
   *
   * The monitor's name rather than the display name: the display name is what
   * visitors see, and an operator looking for the monitor they just created is
   * looking for the name they created it under. A resource whose monitor was
   * deleted falls back to whatever is left, because a row nobody can identify
   * is a row nobody can clean up.
   */
  public static getResourceName(resource: StatusPageResource): string {
    return (
      resource.monitor?.name ||
      resource.monitorGroup?.name ||
      resource.displayName ||
      "Unknown resource"
    );
  }

  /*
   * Free text over the two names a resource has. Client side, over the group's
   * own resources, because the group is already loaded - a round trip per
   * keystroke would be slower and would still only be searching the same rows.
   */
  public static filterResources(data: {
    statusPageResources: Array<StatusPageResource>;
    searchText?: string | undefined;
  }): Array<StatusPageResource> {
    const searchText: string = (data.searchText || "").trim().toLowerCase();

    if (!searchText) {
      return data.statusPageResources;
    }

    return data.statusPageResources.filter(
      (resource: StatusPageResource): boolean => {
        const haystack: Array<string> = [
          resource.monitor?.name || "",
          resource.monitorGroup?.name || "",
          resource.displayName || "",
        ];

        return haystack.some((value: string): boolean => {
          return value.toLowerCase().includes(searchText);
        });
      },
    );
  }

  /*
   * The `order` to write when a resource is dragged from one position to
   * another.
   *
   * The server renumbers the group's siblings around whatever order it is
   * given, so the write is "take the place of the resource currently sitting
   * there" rather than an index - the same write the old table's drag and drop
   * made, and the only one StatusPageResourceService knows how to rebalance.
   *
   * Null when the move is a no-op or the positions are not real.
   */
  public static getReorderTargetOrder(data: {
    statusPageResources: Array<StatusPageResource>;
    fromIndex: number;
    toIndex: number;
  }): number | null {
    const { statusPageResources, fromIndex, toIndex } = data;

    if (fromIndex === toIndex) {
      return null;
    }

    if (
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= statusPageResources.length ||
      toIndex >= statusPageResources.length
    ) {
      return null;
    }

    const target: StatusPageResource | undefined = statusPageResources[toIndex];

    if (!target || target.order === undefined || target.order === null) {
      return null;
    }

    return target.order;
  }

  /*
   * The list as it will look once the move lands, so the row can be drawn where
   * it was dropped rather than jumping back until the write returns.
   */
  public static getResourcesInNewOrder(data: {
    statusPageResources: Array<StatusPageResource>;
    fromIndex: number;
    toIndex: number;
  }): Array<StatusPageResource> {
    const { statusPageResources, fromIndex, toIndex } = data;

    if (
      fromIndex === toIndex ||
      fromIndex < 0 ||
      toIndex < 0 ||
      fromIndex >= statusPageResources.length ||
      toIndex >= statusPageResources.length
    ) {
      return statusPageResources;
    }

    const next: Array<StatusPageResource> = [...statusPageResources];
    const [moved] = next.splice(fromIndex, 1);

    if (!moved) {
      return statusPageResources;
    }

    next.splice(toIndex, 0, moved);

    return next;
  }

  /* ------------------------------------------------------------------ */
  /* Grid groups                                                         */
  /* ------------------------------------------------------------------ */

  /*
   * The comma separated axis values a grid group is defined by, as a list.
   */
  public static parseAxisValues(
    raw?: string | null | undefined,
  ): Array<string> {
    if (!raw) {
      return [];
    }

    return raw
      .split(",")
      .map((value: string): string => {
        return value.trim();
      })
      .filter((value: string): boolean => {
        return value.length > 0;
      });
  }

  /*
   * A NUL separator rather than a space or a dash: axis values are free text,
   * so any separator an operator could type would let ("A B", "C") and
   * ("A", "B C") collapse into the same cell.
   */
  public static getGridCellKey(rowValue: string, columnValue: string): string {
    return `${rowValue}\u0000${columnValue}`;
  }

  /*
   * Which resources land in which cell of a grid group, and which land nowhere
   * because their axis values are not among the group's own.
   *
   * The orphans matter: an axis value renamed on the Groups tab strands every
   * resource that referenced it, and a grid that silently drew fewer cells than
   * it has resources would hide monitors an operator believes are published.
   */
  public static buildGridModel(data: {
    statusPageResources: Array<StatusPageResource>;
    rowValues: Array<string>;
    columnValues: Array<string>;
  }): StatusPageResourceGridModel {
    const resourcesByCellKey: Map<string, Array<StatusPageResource>> = new Map<
      string,
      Array<StatusPageResource>
    >();
    const orphanResources: Array<StatusPageResource> = [];

    for (const resource of data.statusPageResources) {
      const rowValue: string = resource.rowAxisValue || "";
      const columnValue: string = resource.columnAxisValue || "";

      if (
        !rowValue ||
        !columnValue ||
        !data.rowValues.includes(rowValue) ||
        !data.columnValues.includes(columnValue)
      ) {
        orphanResources.push(resource);
        continue;
      }

      const key: string = this.getGridCellKey(rowValue, columnValue);
      const cell: Array<StatusPageResource> = resourcesByCellKey.get(key) || [];

      cell.push(resource);
      resourcesByCellKey.set(key, cell);
    }

    return {
      resourcesByCellKey: resourcesByCellKey,
      orphanResources: orphanResources,
    };
  }

  /* ------------------------------------------------------------------ */
  /* Labels                                                              */
  /* ------------------------------------------------------------------ */

  /*
   * "12 resources", or "1 resource".
   */
  public static getResourceCountLabel(data: { count: number }): string {
    if (data.count === 1) {
      return "1 resource";
    }

    return `${data.count.toLocaleString()} resources`;
  }

  /*
   * What a navigator row's count badge says, which is not always the same
   * number as the pane it opens.
   *
   * A group that holds nothing itself but has a hundred resources nested under
   * it is not empty, and a bare "0" beside it would send an operator hunting
   * through fifteen hundred groups for monitors that are right there. So the
   * badge shows what the group holds, and the tooltip explains the subtree when
   * the two differ.
   */
  public static getNavigatorCountLabel(data: {
    row: StatusPageResourceNavigatorRow;
    countIndex: StatusPageResourceCountIndex;
  }): string | null {
    if (!data.countIndex.isComplete) {
      return null;
    }

    if (
      data.row.ownResourceCount === 0 &&
      data.row.subtreeResourceCount > data.row.ownResourceCount
    ) {
      return `+${data.row.subtreeResourceCount.toLocaleString()}`;
    }

    return data.row.ownResourceCount.toLocaleString();
  }

  public static getNavigatorCountTooltip(data: {
    row: StatusPageResourceNavigatorRow;
    countIndex: StatusPageResourceCountIndex;
  }): string | undefined {
    if (!data.countIndex.isComplete) {
      return undefined;
    }

    const own: string = `${data.row.ownResourceCount.toLocaleString()} ${
      data.row.ownResourceCount === 1 ? "resource" : "resources"
    } in this group`;

    if (data.row.subtreeResourceCount === data.row.ownResourceCount) {
      return own;
    }

    return `${own} · ${data.row.subtreeResourceCount.toLocaleString()} including sub groups`;
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
