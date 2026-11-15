import { TopologyHierarchy } from "../NetworkDevice/TopologyModel";
import { TopologyOverrideStorage } from "./TopologyPositionOverrides";

/*
 * Branches of the network map's hierarchy (issue #6606): what a device has
 * below it, the path down to it, and which branches the reader folded away.
 *
 * The parent-child layout draws the network as the tree it is, and on a
 * large network that tree is too big to take in at once. The map lets the
 * reader fold a branch away - a switch and everything below it becomes the
 * switch and a count - and look at one branch on its own. Everything those
 * controls decide is decided here, against the hierarchy the layout
 * reports (TopologyHierarchy), so it can be tested without a browser.
 *
 * Folded branches are remembered per browser, per site, the way dragged
 * positions are (TopologyPositionOverrides): the network an operator folds
 * to read their way is the network they come back to. The storage is
 * injected, so persistence is testable without a DOM, and a stored value
 * is read as the untrusted text it is.
 */

const NO_CHILDREN: ReadonlyArray<string> = [];

export const EMPTY_COLLAPSED_BRANCHES: ReadonlySet<string> = new Set<string>();

const childrenOf: (
  hierarchy: TopologyHierarchy,
  nodeId: string,
) => ReadonlyArray<string> = (
  hierarchy: TopologyHierarchy,
  nodeId: string,
): ReadonlyArray<string> => {
  return hierarchy.childrenById.get(nodeId) || NO_CHILDREN;
};

/** True when the node has anything below it to fold away. */
export const hasBranch: (
  hierarchy: TopologyHierarchy | undefined,
  nodeId: string,
) => boolean = (
  hierarchy: TopologyHierarchy | undefined,
  nodeId: string,
): boolean => {
  return Boolean(hierarchy) && childrenOf(hierarchy!, nodeId).length > 0;
};

/**
 * Every node below `nodeId`, in the whole hierarchy - collapsed branches
 * included. Walked with an explicit stack: a chain of two thousand switches
 * is a legal network, and recursion that deep would take the page down.
 */
export const descendantIdsOf: (
  hierarchy: TopologyHierarchy,
  nodeId: string,
) => Array<string> = (
  hierarchy: TopologyHierarchy,
  nodeId: string,
): Array<string> => {
  const descendants: Array<string> = [];
  const seen: Set<string> = new Set<string>([nodeId]);
  const stack: Array<string> = [...childrenOf(hierarchy, nodeId)].reverse();
  while (stack.length > 0) {
    const current: string = stack.pop()!;
    if (seen.has(current)) {
      // A well-formed hierarchy never repeats a node; a hostile one may.
      continue;
    }
    seen.add(current);
    descendants.push(current);
    const children: ReadonlyArray<string> = childrenOf(hierarchy, current);
    for (let index: number = children.length - 1; index >= 0; index--) {
      stack.push(children[index]!);
    }
  }
  return descendants;
};

/** The node and everything below it: what "focus on this branch" shows. */
export const branchNodeIdsOf: (
  hierarchy: TopologyHierarchy,
  nodeId: string,
) => Set<string> = (
  hierarchy: TopologyHierarchy,
  nodeId: string,
): Set<string> => {
  return new Set<string>([nodeId, ...descendantIdsOf(hierarchy, nodeId)]);
};

/**
 * The path from the node's root down to its parent, root first. Empty for
 * a root. Bounded by the number of nodes, so a parent map that loops - it
 * never should - still returns.
 */
export const ancestorIdsOf: (
  hierarchy: TopologyHierarchy,
  nodeId: string,
) => Array<string> = (
  hierarchy: TopologyHierarchy,
  nodeId: string,
): Array<string> => {
  const ancestors: Array<string> = [];
  const seen: Set<string> = new Set<string>([nodeId]);
  let cursor: string | undefined = hierarchy.parentById.get(nodeId);
  while (cursor !== undefined && !seen.has(cursor)) {
    seen.add(cursor);
    ancestors.push(cursor);
    cursor = hierarchy.parentById.get(cursor);
  }
  return ancestors.reverse();
};

/**
 * How many nodes are below `nodeId`, counting only those `isCounted`
 * accepts - the node types the reader has switched on, so a folded switch
 * says "+12" for the twelve devices expanding it would actually show.
 */
export const countDescendants: (
  hierarchy: TopologyHierarchy,
  nodeId: string,
  isCounted?: ((descendantId: string) => boolean) | undefined,
) => number = (
  hierarchy: TopologyHierarchy,
  nodeId: string,
  isCounted?: ((descendantId: string) => boolean) | undefined,
): number => {
  let count: number = 0;
  for (const descendantId of descendantIdsOf(hierarchy, nodeId)) {
    if (!isCounted || isCounted(descendantId)) {
      count++;
    }
  }
  return count;
};

/*
 * The branches "Collapse all" folds: on the whole map, every branch below
 * the top of each tree - the roots stay open, so the map still shows the top
 * of the network and the branches hanging off it, each with what it holds;
 * narrowed to one branch, every branch below the one in focus, which stays
 * open: folding the branch being looked at would leave a single device on
 * the screen, and folding one outside it would change nothing anybody can
 * see.
 */
const branchesToCollapse: (
  hierarchy: TopologyHierarchy,
  focusedNodeId?: string | null | undefined,
) => Array<string> = (
  hierarchy: TopologyHierarchy,
  focusedNodeId?: string | null | undefined,
): Array<string> => {
  if (focusedNodeId) {
    return descendantIdsOf(hierarchy, focusedNodeId).filter(
      (nodeId: string): boolean => {
        return childrenOf(hierarchy, nodeId).length > 0;
      },
    );
  }
  const branchIds: Array<string> = [];
  for (const [nodeId, children] of hierarchy.childrenById) {
    if (children.length > 0 && (hierarchy.depthById.get(nodeId) || 0) >= 1) {
      branchIds.push(nodeId);
    }
  }
  return branchIds;
};

/**
 * What "Collapse all" leaves folded: everything already folded, and every
 * branch it folds (see branchesToCollapse). It only ever adds a fold - a
 * root the reader folded by hand stays folded.
 */
export const collapseAllBranches: (
  hierarchy: TopologyHierarchy,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
) => Set<string> = (
  hierarchy: TopologyHierarchy,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
): Set<string> => {
  const next: Set<string> = new Set<string>(collapsed);
  for (const nodeId of branchesToCollapse(hierarchy, focusedNodeId)) {
    next.add(nodeId);
  }
  return next;
};

/**
 * Whether "Collapse all" would fold anything that is not folded already.
 * The control is offered disabled rather than doing nothing when pressed.
 */
export const canCollapseMore: (
  hierarchy: TopologyHierarchy | undefined,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
) => boolean = (
  hierarchy: TopologyHierarchy | undefined,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
): boolean => {
  if (!hierarchy) {
    return false;
  }
  return branchesToCollapse(hierarchy, focusedNodeId).some(
    (nodeId: string): boolean => {
      return !collapsed.has(nodeId);
    },
  );
};

/**
 * What "Expand all" leaves folded: nothing, on the whole map; narrowed to one
 * branch, everything folded outside it - the folds in the branch in focus,
 * its own included, are what the reader can see being opened.
 */
export const expandAllBranches: (
  hierarchy: TopologyHierarchy,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
) => ReadonlySet<string> = (
  hierarchy: TopologyHierarchy,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
): ReadonlySet<string> => {
  if (!focusedNodeId) {
    return EMPTY_COLLAPSED_BRANCHES;
  }
  const branch: Set<string> = branchNodeIdsOf(hierarchy, focusedNodeId);
  const next: Set<string> = new Set<string>();
  for (const nodeId of collapsed) {
    if (!branch.has(nodeId)) {
      next.add(nodeId);
    }
  }
  return next;
};

/** Whether "Expand all" would open anything the reader can see. */
export const canExpandMore: (
  hierarchy: TopologyHierarchy | undefined,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
) => boolean = (
  hierarchy: TopologyHierarchy | undefined,
  collapsed: ReadonlySet<string>,
  focusedNodeId?: string | null | undefined,
): boolean => {
  if (!hierarchy || collapsed.size === 0) {
    return false;
  }
  if (!focusedNodeId) {
    return true;
  }
  const branch: Set<string> = branchNodeIdsOf(hierarchy, focusedNodeId);
  for (const nodeId of collapsed) {
    if (branch.has(nodeId)) {
      return true;
    }
  }
  return false;
};

/** Fold a branch away, or open it again. Always a new set. */
export const toggleCollapsedBranch: (
  collapsed: ReadonlySet<string>,
  nodeId: string,
) => Set<string> = (
  collapsed: ReadonlySet<string>,
  nodeId: string,
): Set<string> => {
  const next: Set<string> = new Set<string>(collapsed);
  if (next.has(nodeId)) {
    next.delete(nodeId);
  } else {
    next.add(nodeId);
  }
  return next;
};

/**
 * Open every folded branch that hides one of `nodeIds`: each node's
 * collapsed ancestors come out of the set, and nothing else does. Returns
 * the SAME set when nothing hid them, so a caller can tell that nothing
 * changed.
 */
export const revealNodes: (
  collapsed: ReadonlySet<string>,
  hierarchy: TopologyHierarchy,
  nodeIds: Iterable<string>,
) => ReadonlySet<string> = (
  collapsed: ReadonlySet<string>,
  hierarchy: TopologyHierarchy,
  nodeIds: Iterable<string>,
): ReadonlySet<string> => {
  if (collapsed.size === 0) {
    return collapsed;
  }
  let next: Set<string> | null = null;
  for (const nodeId of nodeIds) {
    for (const ancestorId of ancestorIdsOf(hierarchy, nodeId)) {
      if (collapsed.has(ancestorId)) {
        next = next || new Set<string>(collapsed);
        next.delete(ancestorId);
      }
    }
  }
  return next || collapsed;
};

/** True when a folded branch above the node keeps it off the map. */
export const isHiddenByCollapse: (
  hierarchy: TopologyHierarchy,
  nodeId: string,
) => boolean = (hierarchy: TopologyHierarchy, nodeId: string): boolean => {
  for (const ancestorId of ancestorIdsOf(hierarchy, nodeId)) {
    if (hierarchy.collapsedNodeIds.has(ancestorId)) {
      return true;
    }
  }
  return false;
};

/**
 * The nodes a search keeps bright as the way down to its matches: every
 * ancestor of every match. A match inside a folded branch lights the
 * folded node standing in for it, so the reader can see where it is
 * before opening anything.
 */
export const searchPathNodeIdsFor: (
  hierarchy: TopologyHierarchy,
  matchIds: Iterable<string>,
) => Set<string> = (
  hierarchy: TopologyHierarchy,
  matchIds: Iterable<string>,
): Set<string> => {
  const path: Set<string> = new Set<string>();
  for (const matchId of matchIds) {
    let cursor: string | undefined = hierarchy.parentById.get(matchId);
    // Stop at the first ancestor already on the path: the rest of it is too.
    while (cursor !== undefined && !path.has(cursor)) {
      path.add(cursor);
      cursor = hierarchy.parentById.get(cursor);
    }
  }
  return path;
};

/** The fold control under one branch node, as the map draws it. */
export interface BranchToggleView {
  nodeId: string;
  // The node's name, for the control's label.
  name: string;
  // The node's centre, in layout coordinates.
  x: number;
  // Where the node's name ends: the control hangs under it.
  labelBottomY: number;
  isCollapsed: boolean;
  /*
   * Collapsed: how many devices expanding it would show, counting only the
   * node types the reader has on. Zero when expanded.
   */
  hiddenCount: number;
  // Faded with its node, so a search or a hover does not leave it bright.
  isDimmed: boolean;
}

export interface BranchToggleNode {
  id: string;
  x: number;
  y: number;
  labelBottom: number;
  isDimmed: boolean;
}

/**
 * The fold controls the map draws, one under each drawn node that has a
 * branch to fold or to open:
 *
 *   - an open branch gets one only while at least one of its children is
 *     drawn - a switch whose endpoints are all switched off by the type
 *     filter has nothing on screen to fold;
 *   - a folded branch gets one only while it holds something the reader
 *     has switched on, and says how many: "+12".
 */
export const buildBranchToggles: (input: {
  hierarchy: TopologyHierarchy | undefined;
  drawnNodes: ReadonlyArray<BranchToggleNode>;
  nameOf: (nodeId: string) => string;
  isCounted: (nodeId: string) => boolean;
}) => Array<BranchToggleView> = (input: {
  hierarchy: TopologyHierarchy | undefined;
  drawnNodes: ReadonlyArray<BranchToggleNode>;
  nameOf: (nodeId: string) => string;
  isCounted: (nodeId: string) => boolean;
}): Array<BranchToggleView> => {
  const hierarchy: TopologyHierarchy | undefined = input.hierarchy;
  if (!hierarchy || input.drawnNodes.length === 0) {
    return [];
  }
  const drawnIds: Set<string> = new Set<string>(
    input.drawnNodes.map((node: BranchToggleNode): string => {
      return node.id;
    }),
  );

  const toggles: Array<BranchToggleView> = [];
  for (const node of input.drawnNodes) {
    const children: ReadonlyArray<string> = childrenOf(hierarchy, node.id);
    if (children.length === 0) {
      continue;
    }
    const isCollapsed: boolean = hierarchy.collapsedNodeIds.has(node.id);
    let hiddenCount: number = 0;
    if (isCollapsed) {
      hiddenCount = countDescendants(hierarchy, node.id, input.isCounted);
      if (hiddenCount === 0) {
        continue;
      }
    } else {
      const hasDrawnChild: boolean = children.some(
        (childId: string): boolean => {
          return drawnIds.has(childId);
        },
      );
      if (!hasDrawnChild) {
        continue;
      }
    }
    toggles.push({
      nodeId: node.id,
      name: input.nameOf(node.id),
      x: node.x,
      labelBottomY: node.y + node.labelBottom,
      isCollapsed: isCollapsed,
      hiddenCount: hiddenCount,
      isDimmed: node.isDimmed,
    });
  }
  return toggles;
};

/*
 * ------------------------------------------------------------------
 * Remembering folded branches
 * ------------------------------------------------------------------
 */

export const PERSISTED_COLLAPSED_VERSION: number = 1;
/*
 * Upper bound on how many folded branches are read back, so a corrupt or
 * hostile entry cannot make the page allocate without limit. A network has
 * far fewer branches than it has devices.
 */
export const MAX_PERSISTED_COLLAPSED: number = 5000;
export const MAX_PERSISTED_COLLAPSED_KEY_LENGTH: number = 256;

/**
 * Storage key for one map's folded branches: per project and per site,
 * like a saved arrangement, but not per layout - only the parent-child
 * layout draws branches, so there is only one set to keep.
 */
export const collapsedBranchesStorageKey: (
  projectId: string,
  siteId: string | undefined,
) => string = (projectId: string, siteId: string | undefined): string => {
  return [
    "oneuptime.networkTopology.collapsedBranches",
    `v${PERSISTED_COLLAPSED_VERSION}`,
    projectId || "unknown",
    siteId || "project",
  ].join(".");
};

interface PersistedCollapsedPayload {
  version: number;
  nodeIds: Array<string>;
}

/** Sorted, so the same set always writes the same text. */
export const serializeCollapsedBranches: (
  collapsed: ReadonlySet<string>,
) => string = (collapsed: ReadonlySet<string>): string => {
  const payload: PersistedCollapsedPayload = {
    version: PERSISTED_COLLAPSED_VERSION,
    nodeIds: Array.from(collapsed)
      .filter((nodeId: string): boolean => {
        return typeof nodeId === "string" && nodeId.length > 0;
      })
      .sort(),
  };
  return JSON.stringify(payload);
};

/**
 * Read folded branches back from untrusted text. Never throws; keeps the
 * valid ids of a partly corrupt entry, and nothing of a wrong version.
 */
export const parseCollapsedBranches: (
  raw: string | null | undefined,
) => Set<string> = (raw: string | null | undefined): Set<string> => {
  const result: Set<string> = new Set<string>();
  if (typeof raw !== "string" || raw.trim().length === 0) {
    return result;
  }

  let parsed: unknown = null;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return result;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return result;
  }

  const payload: Record<string, unknown> = parsed as Record<string, unknown>;
  if (payload["version"] !== PERSISTED_COLLAPSED_VERSION) {
    return result;
  }
  const nodeIds: unknown = payload["nodeIds"];
  if (!Array.isArray(nodeIds)) {
    return result;
  }
  for (const nodeId of nodeIds) {
    if (result.size >= MAX_PERSISTED_COLLAPSED) {
      break;
    }
    if (
      typeof nodeId === "string" &&
      nodeId.length > 0 &&
      nodeId.length <= MAX_PERSISTED_COLLAPSED_KEY_LENGTH
    ) {
      result.add(nodeId);
    }
  }
  return result;
};

/** Load folded branches, tolerating storage that throws or is absent. */
export const readCollapsedBranches: (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
) => ReadonlySet<string> = (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
): ReadonlySet<string> => {
  if (!storage) {
    return EMPTY_COLLAPSED_BRANCHES;
  }
  try {
    return parseCollapsedBranches(storage.getItem(key));
  } catch {
    // Safari in private mode throws on access, not just on write.
    return EMPTY_COLLAPSED_BRANCHES;
  }
};

/** Save folded branches, or clear the entry when none are folded. */
export const writeCollapsedBranches: (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
  collapsed: ReadonlySet<string>,
) => void = (
  storage: TopologyOverrideStorage | null | undefined,
  key: string,
  collapsed: ReadonlySet<string>,
): void => {
  if (!storage) {
    return;
  }
  try {
    if (collapsed.size === 0) {
      storage.removeItem(key);
      return;
    }
    storage.setItem(key, serializeCollapsedBranches(collapsed));
  } catch {
    // Quota exhausted or storage disabled: remembering is best effort.
  }
};

/**
 * Forget folded branches whose node left the network. Returns the SAME set
 * when nothing was dropped, so the minute-by-minute refresh does not hand
 * the map a new set - and a new layout - for nothing.
 */
export const pruneCollapsedBranches: (
  collapsed: ReadonlySet<string>,
  liveNodeIds: ReadonlySet<string>,
) => ReadonlySet<string> = (
  collapsed: ReadonlySet<string>,
  liveNodeIds: ReadonlySet<string>,
): ReadonlySet<string> => {
  let hasStale: boolean = false;
  for (const nodeId of collapsed) {
    if (!liveNodeIds.has(nodeId)) {
      hasStale = true;
      break;
    }
  }
  if (!hasStale) {
    return collapsed;
  }
  const pruned: Set<string> = new Set<string>();
  for (const nodeId of collapsed) {
    if (liveNodeIds.has(nodeId)) {
      pruned.add(nodeId);
    }
  }
  return pruned;
};

/**
 * A stable text form of a set of folded branches, for a memo to depend on:
 * the same branches always give the same text whatever order they were
 * folded in.
 */
export const collapsedBranchesSignature: (
  collapsed: ReadonlySet<string> | undefined,
) => string = (collapsed: ReadonlySet<string> | undefined): string => {
  if (!collapsed || collapsed.size === 0) {
    return "";
  }
  return Array.from(collapsed).sort().join("\u0000");
};
