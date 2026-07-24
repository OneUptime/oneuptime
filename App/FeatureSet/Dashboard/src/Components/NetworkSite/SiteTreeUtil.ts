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

  for (const node of nodesById.values()) {
    if (!seen.has(node)) {
      // Member of a parent cycle — break it by promoting to root.
      roots.push(node);
      stampDepthsAndRollups(node, 0);
    }
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
