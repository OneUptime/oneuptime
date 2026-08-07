import StatusPageGroup from "Common/Models/DatabaseModels/StatusPageGroup";
import StatusPageGroupTreeUtil, {
  StatusPageGroupIndex,
  StatusPageGroupIndexNode,
} from "Common/Utils/StatusPage/GroupTree";

/*
 * Status Page > Resources renders one resource table per group, and each of
 * those tables asks the API for its own rows and its own count the moment it
 * mounts. That is fine for the handful of groups most status pages have and
 * fatal for a page with a thousand of them: mounting every table at once is
 * thousands of requests and a DOM nothing can hold, which is the "Network
 * Error / high memory usage" crash on a large status page.
 *
 * So the page renders a *window* of groups instead of all of them. This module
 * owns the pure part of that: turning a flat list of groups into ordered,
 * labelled sections, narrowing them by a search box, and cutting the result
 * into pages. Nothing here mounts anything - it decides which groups the page
 * is allowed to mount.
 *
 * React-free on purpose (same reason as StatusPageGroupCsv): it must stay
 * importable from the node-env jest suite in App/Tests/Dashboard.
 */

/*
 * How many group sections a single page of the Resources tab may show.
 *
 * This is the ceiling on tables mounted at once, so it is also the ceiling on
 * requests fired on mount - at two per table, ten sections is twenty. Raising
 * it raises both.
 */
export const STATUS_PAGE_GROUP_SECTIONS_PER_PAGE: number = 10;

export interface StatusPageGroupSection {
  group: StatusPageGroup;
  groupId: string;
  /*
   * The group's ancestors and its own name - "Corporate › Region 1000". Two
   * groups at different levels are very often both called "Region 1000", so
   * the path, not the name, is what tells one section from another.
   */
  pathLabel: string;
  // 0 for a top level group, 1 for its children, and so on.
  depth: number;
}

export interface StatusPageGroupSectionPage {
  sections: Array<StatusPageGroupSection>;
  // 1 based, and always within [1, totalPageCount].
  pageNumber: number;
  pageSize: number;
  // Sections this page was cut from, i.e. after any search was applied.
  totalSectionCount: number;
  // At least 1, so an empty result still has a page to sit on.
  totalPageCount: number;
}

export type BuildStatusPageGroupSectionsFunction = (data: {
  statusPageGroups: Array<StatusPageGroup>;
}) => Array<StatusPageGroupSection>;

/*
 * Every group, in the order the status page renders them: a parent immediately
 * above the groups nested under it, siblings in `order`. A flat sort by `order`
 * would scatter children away from their parent.
 *
 * One tree walk labels all of them. Deriving each label on its own would mean
 * rebuilding the whole tree once per group, which is the quadratic that made
 * this page unusable well before the tables did.
 */
export const buildStatusPageGroupSections: BuildStatusPageGroupSectionsFunction =
  (data: {
    statusPageGroups: Array<StatusPageGroup>;
  }): Array<StatusPageGroupSection> => {
    const index: StatusPageGroupIndex = StatusPageGroupTreeUtil.buildIndex({
      statusPageGroups: data.statusPageGroups,
    });

    return index.getNodesInTreeOrder().map((node: StatusPageGroupIndexNode) => {
      return {
        group: node.group,
        groupId: StatusPageGroupTreeUtil.getGroupId(node.group),
        pathLabel: index.getGroupPathLabel(node.group),
        depth: node.depth,
      };
    });
  };

export type FilterStatusPageGroupSectionsFunction = (data: {
  sections: Array<StatusPageGroupSection>;
  searchText: string;
}) => Array<StatusPageGroupSection>;

/*
 * Narrow the sections to the ones a search matches.
 *
 * Matching runs against the whole path rather than the group's own name, and
 * every whitespace separated term has to appear somewhere in it. That is what
 * makes a path searchable at all: "corporate market" finds
 * "Corporate › Region 1000 › Market 1001", which a plain substring match on
 * the joined path never would, and searching for a parent's name brings back
 * its whole subtree.
 */
export const filterStatusPageGroupSections: FilterStatusPageGroupSectionsFunction =
  (data: {
    sections: Array<StatusPageGroupSection>;
    searchText: string;
  }): Array<StatusPageGroupSection> => {
    const searchTerms: Array<string> = (data.searchText || "")
      .toLowerCase()
      .split(/\s+/)
      .filter((term: string) => {
        return term.length > 0;
      });

    if (searchTerms.length === 0) {
      return data.sections;
    }

    return data.sections.filter((section: StatusPageGroupSection) => {
      const pathLabel: string = section.pathLabel.toLowerCase();

      return searchTerms.every((term: string) => {
        return pathLabel.includes(term);
      });
    });
  };

export type GetStatusPageGroupSectionPageFunction = (data: {
  sections: Array<StatusPageGroupSection>;
  pageNumber: number;
  pageSize: number;
}) => StatusPageGroupSectionPage;

/*
 * One page worth of sections.
 *
 * The page number is clamped rather than trusted: the caller's page number
 * survives a search that shrinks the list under it, and clamping is what keeps
 * that from rendering an empty page the user cannot navigate out of.
 */
export const getStatusPageGroupSectionPage: GetStatusPageGroupSectionPageFunction =
  (data: {
    sections: Array<StatusPageGroupSection>;
    pageNumber: number;
    pageSize: number;
  }): StatusPageGroupSectionPage => {
    const pageSize: number = Math.max(1, Math.floor(data.pageSize || 0));
    const totalSectionCount: number = data.sections.length;
    const totalPageCount: number = Math.max(
      1,
      Math.ceil(totalSectionCount / pageSize),
    );

    const requestedPageNumber: number = Math.floor(data.pageNumber || 1);
    const pageNumber: number = Math.min(
      Math.max(1, requestedPageNumber),
      totalPageCount,
    );

    const startIndex: number = (pageNumber - 1) * pageSize;

    return {
      sections: data.sections.slice(startIndex, startIndex + pageSize),
      pageNumber: pageNumber,
      pageSize: pageSize,
      totalSectionCount: totalSectionCount,
      totalPageCount: totalPageCount,
    };
  };

export type ShouldExpandStatusPageGroupSectionsByDefaultFunction = (data: {
  totalSectionCount: number;
  pageSize: number;
}) => boolean;

/*
 * Whether sections start open.
 *
 * They do when every group on the status page fits on a single page, which is
 * the case for almost every status page and is exactly how the tab behaved
 * before it was windowed - nothing about a five group page changes. Past that
 * the sections start closed and mount their table on the first expand, so a
 * page of a thousand groups costs one request for the ungrouped table and
 * nothing else until the user asks for a group.
 *
 * Deliberately measured against the whole status page rather than the current
 * search: tables appearing and disappearing as someone types is a worse thing
 * to be surprised by than one extra click.
 */
export const shouldExpandStatusPageGroupSectionsByDefault: ShouldExpandStatusPageGroupSectionsByDefaultFunction =
  (data: { totalSectionCount: number; pageSize: number }): boolean => {
    return (
      data.totalSectionCount <= Math.max(1, Math.floor(data.pageSize || 0))
    );
  };

export type IsStatusPageGroupSectionExpandedFunction = (data: {
  groupId: string;
  expandedOverrides: Record<string, boolean>;
  isExpandedByDefault: boolean;
}) => boolean;

/*
 * A section the user has not touched follows the default; once they open or
 * close one it stays how they left it, including across searches and page
 * changes.
 */
export const isStatusPageGroupSectionExpanded: IsStatusPageGroupSectionExpandedFunction =
  (data: {
    groupId: string;
    expandedOverrides: Record<string, boolean>;
    isExpandedByDefault: boolean;
  }): boolean => {
    const override: boolean | undefined = data.expandedOverrides[data.groupId];

    if (override === undefined) {
      return data.isExpandedByDefault;
    }

    return override;
  };
