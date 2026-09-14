import StatusPageGroup from "../../Models/DatabaseModels/StatusPageGroup";
import StatusPageResource from "../../Models/DatabaseModels/StatusPageResource";
import StatusPageGroupTreeUtil, { StatusPageGroupTreeIndex } from "./GroupTree";

export interface StatusPageResourceSearchResult {
  /* False when there is nothing to filter by; the page renders untouched. */
  isActive: boolean;
  /* Resource ids to render. Empty with isActive true means "no matches". */
  matchedResourceIds: Set<string>;
  matchedResourceCount: number;
  totalResourceCount: number;
  /*
   * Groups that must still be drawn: the ones holding a match, plus every
   * ancestor of those, so a match four levels down is reachable rather than
   * orphaned.
   */
  visibleGroupIds: Set<string>;
  /* Whether any resource that belongs to no group matched. */
  hasUngroupedMatches: boolean;
}

/*
 * Finding one service on a status page.
 *
 * A page with a few hundred resources spread over a nested group hierarchy has
 * no way to answer "is the thing I use up?" other than opening groups one at a
 * time and reading. This filters the page down to what a visitor typed.
 *
 * Two rules make it behave the way people expect rather than the way a naive
 * substring filter would:
 *
 *   - Typing a group's name keeps that whole group, including everything
 *     nested under it. Searching "Europe" is asking about a region, not about
 *     a service that happens to have Europe in its name.
 *   - A group is kept when anything in its subtree matched, and so is every
 *     group above it. Otherwise a match nested three levels deep would have
 *     nowhere to render.
 *
 * Pure and index-driven: one pass to match, one walk up per matched group. The
 * overview calls this on every keystroke against lists that reach four figures.
 */
export default class StatusPageResourceSearchUtil {
  /*
   * Below this the box is clutter - you can see the whole page at once, and a
   * search field over three rows reads as a mistake.
   */
  public static readonly MinimumResourcesForSearch: number = 8;
  public static readonly MinimumGroupsForSearch: number = 3;

  public static shouldShowSearch(data: {
    resourceCount: number;
    groupCount: number;
  }): boolean {
    return (
      data.resourceCount >= this.MinimumResourcesForSearch ||
      data.groupCount >= this.MinimumGroupsForSearch
    );
  }

  public static normalizeQuery(query: string | null | undefined): string {
    return (query || "").trim().toLowerCase();
  }

  private static matches(data: {
    haystack: string | null | undefined;
    needle: string;
  }): boolean {
    if (!data.haystack) {
      return false;
    }

    return data.haystack.toLowerCase().includes(data.needle);
  }

  private static getResourceText(
    resource: StatusPageResource,
  ): Array<string | null | undefined> {
    return [
      resource.displayName,
      resource.displayDescription,
      resource.monitor?.name,
    ];
  }

  public static search(data: {
    query: string | null | undefined;
    statusPageResources: Array<StatusPageResource>;
    statusPageGroups: Array<StatusPageGroup>;
    statusPageGroupTreeIndex?: StatusPageGroupTreeIndex | undefined;
  }): StatusPageResourceSearchResult {
    const needle: string = this.normalizeQuery(data.query);

    const totalResourceCount: number = data.statusPageResources.length;

    if (!needle) {
      return {
        isActive: false,
        matchedResourceIds: new Set<string>(),
        matchedResourceCount: totalResourceCount,
        totalResourceCount: totalResourceCount,
        visibleGroupIds: new Set<string>(),
        hasUngroupedMatches: true,
      };
    }

    const index: StatusPageGroupTreeIndex =
      data.statusPageGroupTreeIndex ||
      StatusPageGroupTreeUtil.buildIndex({
        statusPageGroups: data.statusPageGroups,
      });

    /*
     * Groups whose own name or description matched. Everything below one of
     * these is kept wholesale.
     */
    const directlyMatchedGroupIds: Set<string> = new Set<string>();

    for (const group of data.statusPageGroups) {
      const groupId: string | undefined = group._id?.toString();

      if (!groupId) {
        continue;
      }

      if (
        this.matches({ haystack: group.name, needle: needle }) ||
        this.matches({ haystack: group.description, needle: needle })
      ) {
        directlyMatchedGroupIds.add(groupId);
      }
    }

    /*
     * A group is "inside a matched group" when it or any ancestor matched by
     * name. Walking up is bounded by a visited set - a parent pointer written
     * straight to the database can form a cycle, and this must not hang the
     * page (see GroupTree, which is defensive about exactly this).
     */
    const isInsideMatchedGroup: (groupId: string | null) => boolean = (
      groupId: string | null,
    ): boolean => {
      let currentId: string | null = groupId;
      const seen: Set<string> = new Set<string>();

      while (currentId) {
        if (seen.has(currentId)) {
          return false;
        }
        seen.add(currentId);

        if (directlyMatchedGroupIds.has(currentId)) {
          return true;
        }

        const group: StatusPageGroup | undefined = index.byId.get(currentId);

        if (!group) {
          return false;
        }

        currentId = StatusPageGroupTreeUtil.getParentId(group);
      }

      return false;
    };

    const matchedResourceIds: Set<string> = new Set<string>();
    const groupIdsHoldingMatches: Set<string> = new Set<string>();
    let hasUngroupedMatches: boolean = false;

    for (const resource of data.statusPageResources) {
      const resourceId: string | undefined = resource._id?.toString();
      const groupId: string | null =
        resource.statusPageGroupId?.toString() || null;

      const matchedByOwnText: boolean = this.getResourceText(resource).some(
        (text: string | null | undefined) => {
          return this.matches({ haystack: text, needle: needle });
        },
      );

      const isMatch: boolean =
        matchedByOwnText || isInsideMatchedGroup(groupId);

      if (!isMatch) {
        continue;
      }

      if (resourceId) {
        matchedResourceIds.add(resourceId);
      }

      if (groupId) {
        groupIdsHoldingMatches.add(groupId);
      } else {
        hasUngroupedMatches = true;
      }
    }

    /*
     * Every group holding a match, plus its ancestors. A group that matched by
     * name is kept even when it turns out to hold nothing - it is a real
     * answer to what was typed, and hiding it would read as "no such group".
     */
    const visibleGroupIds: Set<string> = new Set<string>();

    const keepWithAncestors: (groupId: string) => void = (
      groupId: string,
    ): void => {
      let currentId: string | null = groupId;
      const seen: Set<string> = new Set<string>();

      while (currentId) {
        if (seen.has(currentId)) {
          return;
        }
        seen.add(currentId);

        visibleGroupIds.add(currentId);

        const group: StatusPageGroup | undefined = index.byId.get(currentId);

        if (!group) {
          return;
        }

        currentId = StatusPageGroupTreeUtil.getParentId(group);
      }
    };

    for (const groupId of groupIdsHoldingMatches) {
      keepWithAncestors(groupId);
    }

    for (const groupId of directlyMatchedGroupIds) {
      keepWithAncestors(groupId);
    }

    return {
      isActive: true,
      matchedResourceIds: matchedResourceIds,
      matchedResourceCount: matchedResourceIds.size,
      totalResourceCount: totalResourceCount,
      visibleGroupIds: visibleGroupIds,
      hasUngroupedMatches: hasUngroupedMatches,
    };
  }

  /* Whether one resource survives a result. */
  public static isResourceVisible(data: {
    resource: StatusPageResource;
    result: StatusPageResourceSearchResult;
  }): boolean {
    if (!data.result.isActive) {
      return true;
    }

    const resourceId: string | undefined = data.resource._id?.toString();

    if (!resourceId) {
      /*
       * A resource with no id of its own cannot be in the matched set, and
       * showing it under every query would be worse than dropping it from a
       * filtered view - the visitor asked a question and this is not an
       * answer to it.
       */
      return false;
    }

    return data.result.matchedResourceIds.has(resourceId);
  }

  /* Whether one group is still drawn under a result. */
  public static isGroupVisible(data: {
    statusPageGroup: StatusPageGroup;
    result: StatusPageResourceSearchResult;
  }): boolean {
    if (!data.result.isActive) {
      return true;
    }

    const groupId: string | undefined = data.statusPageGroup._id?.toString();

    if (!groupId) {
      return false;
    }

    return data.result.visibleGroupIds.has(groupId);
  }
}
