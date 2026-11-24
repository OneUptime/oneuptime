/*
 * Client-side site tree builder for the Sites page hierarchy view.
 * Pure and react-free so the shape decisions (orphans become roots,
 * cycles cannot hang the page, stable name ordering, subtree device
 * rollups) can be unit-tested in a plain Node context.
 */

export interface SiteTreeRow {
  _id?: string | undefined;
  name?: string | undefined;
  siteType?: string | undefined;
  parentSiteId?: string | undefined;
  statusName?: string | undefined;
  statusColor?: string | undefined;
  isOperational?: boolean | undefined;
}

export interface SiteTreeNode {
  site: SiteTreeRow;
  children: Array<SiteTreeNode>;
  // Devices assigned directly to this site.
  deviceCount: number;
  // Devices in this site plus every descendant.
  subtreeDeviceCount: number;
  depth: number;
}

export function buildSiteTree(
  rows: Array<SiteTreeRow>,
  deviceCountBySiteId: Record<string, number>,
): Array<SiteTreeNode> {
  const nodesById: Map<string, SiteTreeNode> = new Map<string, SiteTreeNode>();

  for (const row of rows) {
    if (!row._id) {
      continue;
    }
    nodesById.set(row._id, {
      site: row,
      children: [],
      deviceCount: deviceCountBySiteId[row._id] || 0,
      subtreeDeviceCount: 0,
      depth: 0,
    });
  }

  const roots: Array<SiteTreeNode> = [];

  for (const node of nodesById.values()) {
    const parentId: string | undefined = node.site.parentSiteId;
    /*
     * A parent that is missing from the row set (deleted, or filtered by
     * permissions) must not hide the subtree — promote it to a root. A
     * self-parented row is treated the same way rather than trusted.
     */
    const parent: SiteTreeNode | undefined =
      parentId && parentId !== node.site._id
        ? nodesById.get(parentId)
        : undefined;

    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  /*
   * Cycle guard: nodes reachable from a root get depths stamped below. A
   * parent cycle (A→B→A) leaves its members unreachable — surface them as
   * roots instead of silently dropping them.
   */
  const byName: (a: SiteTreeNode, b: SiteTreeNode) => number = (
    a: SiteTreeNode,
    b: SiteTreeNode,
  ): number => {
    return (a.site.name || "").localeCompare(b.site.name || "");
  };

  const seen: Set<SiteTreeNode> = new Set<SiteTreeNode>();

  const stampDepthsAndRollups: (node: SiteTreeNode, depth: number) => number = (
    node: SiteTreeNode,
    depth: number,
  ): number => {
    if (seen.has(node)) {
      return 0;
    }
    seen.add(node);

    node.depth = depth;
    /*
     * Drop edges back into already-placed nodes — this is what actually
     * severs an A→B→A parent cycle, so the returned structure is a real
     * tree and callers can walk children without revisit guards.
     */
    node.children = node.children.filter((child: SiteTreeNode): boolean => {
      return !seen.has(child);
    });
    node.children.sort(byName);

    let subtreeDevices: number = node.deviceCount;
    for (const child of node.children) {
      subtreeDevices += stampDepthsAndRollups(child, depth + 1);
    }

    node.subtreeDeviceCount = subtreeDevices;
    return subtreeDevices;
  };

  roots.sort(byName);
  for (const root of roots) {
    stampDepthsAndRollups(root, 0);
  }

  let hasPromotedCycleMembers: boolean = false;
  for (const node of nodesById.values()) {
    if (!seen.has(node)) {
      // Member of a parent cycle — break it by promoting to root.
      roots.push(node);
      stampDepthsAndRollups(node, 0);
      hasPromotedCycleMembers = true;
    }
  }

  if (hasPromotedCycleMembers) {
    // Keep the root list name-ordered even when cycle members joined late.
    roots.sort(byName);
  }

  return roots;
}

// Count of every node in the tree, for "showing N sites" captions.
export function countTreeNodes(roots: Array<SiteTreeNode>): number {
  let total: number = 0;
  const stack: Array<SiteTreeNode> = [...roots];
  // Revisit guard: even a malformed tree must never hang the page.
  const counted: Set<SiteTreeNode> = new Set<SiteTreeNode>();

  while (stack.length > 0) {
    const node: SiteTreeNode = stack.pop() as SiteTreeNode;
    if (counted.has(node)) {
      continue;
    }
    counted.add(node);
    total++;
    stack.push(...node.children);
  }

  return total;
}

/*
 * WHAT THE HIERARCHY SHOWS OF A TREE OF HUNDREDS OF SITES (#10188).
 *
 * An import of a Meraki organization leaves one site per network - 700 of
 * them, all at the top - and the tree drew every one. The Sites page's
 * hierarchy now draws the sites at the top first, a page at a time, opens a
 * site's children when asked, and narrows the tree by what is searched and
 * by whether a site holds devices at all. This decides what it draws.
 */

// A search's words, without case: every one must be in a site's name.
export function getSiteSearchWords(search: string): Array<string> {
  return search
    .toLowerCase()
    .split(/\s+/)
    .map((word: string): string => {
      return word.trim();
    })
    .filter(Boolean);
}

export function siteNameMatches(
  name: string | undefined,
  words: Array<string>,
): boolean {
  const lower: string = (name || "").toLowerCase();

  return words.every((word: string): boolean => {
    return lower.includes(word);
  });
}

export interface SiteTreeFilter {
  // What the person typed: every word is in the name of a site it finds.
  search: string;
  // Leave out the sites with no device in them or anywhere below them.
  hideEmpty: boolean;
}

export interface FilteredSiteTree {
  // The tree as drawn: copies of the nodes kept, with the children kept.
  roots: Array<SiteTreeNode>;
  // The sites the search found; every site kept when nothing is searched.
  matchCount: number;
  // The sites drawn open so every match shows: each site above one.
  openIds: Set<string>;
  isSearching: boolean;
}

// A node the filter keeps, and whether it or a site below it was found.
interface KeptSiteNode {
  node: SiteTreeNode;
  hasMatch: boolean;
}

/*
 * The tree narrowed by a filter. A site the search finds is kept with the
 * sites above it, which are drawn open, and with the sites below it, drawn
 * closed - so a region found by its name still opens on its stores. Hiding
 * the sites with no devices leaves out a site, and everything below it,
 * only when its whole subtree holds none. Pure: the tree it is given is
 * left as it was.
 */
export function filterSiteTree(
  roots: Array<SiteTreeNode>,
  filter: SiteTreeFilter,
): FilteredSiteTree {
  const words: Array<string> = getSiteSearchWords(filter.search);
  const isSearching: boolean = words.length > 0;
  const openIds: Set<string> = new Set<string>();
  let matchCount: number = 0;

  const visit: (
    node: SiteTreeNode,
    isUnderMatch: boolean,
  ) => KeptSiteNode | null = (
    node: SiteTreeNode,
    isUnderMatch: boolean,
  ): KeptSiteNode | null => {
    if (filter.hideEmpty && node.subtreeDeviceCount === 0) {
      return null;
    }

    // Without a search, every site kept is one the list shows.
    const isMatch: boolean = isSearching
      ? siteNameMatches(node.site.name, words)
      : true;

    const children: Array<KeptSiteNode> = [];

    for (const child of node.children) {
      const kept: KeptSiteNode | null = visit(child, isUnderMatch || isMatch);

      if (kept) {
        children.push(kept);
      }
    }

    const hasMatchBelow: boolean = children.some(
      (child: KeptSiteNode): boolean => {
        return child.hasMatch;
      },
    );

    if (isSearching && !isMatch && !isUnderMatch && !hasMatchBelow) {
      return null;
    }

    if (isMatch) {
      matchCount++;
    }

    if (isSearching && hasMatchBelow && node.site._id) {
      openIds.add(node.site._id);
    }

    return {
      node: {
        ...node,
        children: children.map((child: KeptSiteNode): SiteTreeNode => {
          return child.node;
        }),
      },
      hasMatch: (isSearching && isMatch) || hasMatchBelow,
    };
  };

  const kept: Array<SiteTreeNode> = [];

  for (const root of roots) {
    const node: KeptSiteNode | null = visit(root, false);

    if (node) {
      kept.push(node.node);
    }
  }

  return {
    roots: kept,
    matchCount: matchCount,
    openIds: openIds,
    isSearching: isSearching,
  };
}
