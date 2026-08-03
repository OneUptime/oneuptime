import {
  NetworkTopologyEdge,
  NetworkTopologyNode,
} from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isEndpointNode, isFdbEdge } from "./EndpointNodeUtil";
import {
  LAYOUT_MARGIN,
  computeForceTopologyModel,
} from "./ForceTopologyLayout";
import { TopologyPoint, clamp } from "./TopologyGraphUtil";
import {
  TopologyComponentBox,
  TopologyGroupBox,
  TopologyLayoutModel,
} from "./TopologyModel";
import {
  ENDPOINT_LABEL_MAX_CHARS,
  ENDPOINT_LABEL_MAX_LINES,
  wrapNodeLabel,
} from "./TopologyFootprint";

/*
 * Pure, react-free layouts for the network topology graph.
 *
 * Kept out of the graph component so it can be imported (and unit-tested) in
 * a plain Node/TypeScript environment — the App project does not have
 * `react` on its resolution path, so importing this logic from the .tsx
 * component would drag `react` into the App compile/test context and fail
 * to resolve.
 *
 * This module owns the TIERED layout and re-exports the rest. The
 * force-directed layout moved to ForceTopologyLayout when it was rebuilt
 * around connected components and real node footprints; the radial layout
 * lives in RadialTopologyLayout. Everything is still reachable from here
 * so existing import sites keep working.
 */

export type {
  TopologyPoint,
  TopologyComponentBox,
  TopologyGroupBox,
  TopologyLayoutModel,
};
export {
  clamp,
  wrapNodeLabel,
  ENDPOINT_LABEL_MAX_CHARS,
  ENDPOINT_LABEL_MAX_LINES,
};

/** Clearance kept between the layout's content and the frame edge. */
export const TOPOLOGY_LAYOUT_MARGIN: number = LAYOUT_MARGIN;

/**
 * Positions-only view of the force-directed layout.
 *
 * Retained as the historical entry point. New callers should prefer
 * {@link computeForceTopologyModel}, which also reports the component
 * boxes and the content extent the viewport needs in order to fit the
 * graph.
 */
export const computeTopologyLayout: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  iterations?: number,
) => Map<string, TopologyPoint> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  iterations?: number,
): Map<string, TopologyPoint> => {
  return computeForceTopologyModel(
    nodes,
    edges,
    width,
    height,
    undefined,
    iterations,
  ).positions;
};

/*
 * ---------------------------------------------------------------------------
 * Tiered layout — for unit-scale graphs (one site's router, switches, and
 * the endpoints hanging off them) where the force layout's organic blob
 * hides the physical hierarchy. Three fixed tiers, top to bottom:
 *
 *   tier 0 — routers/core: managed devices with no FDB edges (plus
 *            degree-0 managed devices, which have nothing marking them as
 *            switches),
 *   tier 1 — switches (managed devices with FDB edges, i.e. anything
 *            endpoints attach to) and unmanaged discovery-protocol peers,
 *   tier 2 — endpoints.
 *
 * Tiers 1 and 2 are laid out together as vertical COLUMNS rather than as
 * two independent rows, because the question the graph has to answer is
 * "which devices hang off this switch?". One column = one tier-1 node plus
 * the block of endpoints attached to it; the switch sits exactly at its
 * block's horizontal centre, so every FDB edge is a short near-vertical
 * line instead of a strand in a tier-wide fan.
 *
 *   column order — tier-1 nodes that own endpoints first (by name, then
 *     id), then tier-1 nodes that own none (unmanaged peers, switches
 *     whose endpoints are out of view). Keeping the childless nodes to the
 *     right stops a peer from being wedged between two switches and
 *     splitting their blocks apart.
 *   unattached endpoints — endpoints whose switch is not in view (or that
 *     only hang off a tier-0 router) have no anchor, so they collect in a
 *     single trailing column at the right-hand end of the endpoint tier.
 *     Deterministic, contiguous, and visibly separate from the real
 *     switch groups.
 *   wrapping — a group too wide for the view wraps into extra rows WITHIN
 *     its own column (never across the tier), so the group stays a
 *     contiguous block. If the columns together are still too wide they
 *     wrap into bands, each band a self-contained switch row with its
 *     endpoint rows underneath.
 *
 * Fully deterministic: every ordering decision is a total sort on (name,
 * id) and no randomness is involved, so refreshes and re-orderings of the
 * input arrays keep identical coordinates.
 */

// Vertical position of the first tier's first row.
export const TIERED_LAYOUT_TOP_MARGIN: number = 72;
// Vertical gap between the last row of one tier and the first of the next.
export const TIERED_TIER_GAP: number = 170;
// Vertical gap between wrapped rows within one tier.
export const TIERED_ROW_GAP: number = 92;
// Horizontal centre-to-centre spacing for device/unmanaged nodes.
export const TIERED_NODE_SPACING: number = 112;
// Endpoints are drawn smaller, so they pack tighter.
export const TIERED_ENDPOINT_NODE_SPACING: number = 76;
// Kept clear at each side of the widest possible row.
export const TIERED_SIDE_MARGIN: number = 48;
/*
 * Extra horizontal gap inserted between two adjacent columns when either
 * of them owns endpoints. This is what makes one switch's block read as
 * separate from the next one's — without it, the last endpoint of a group
 * would sit exactly one endpoint-spacing from the first endpoint of the
 * next group and the two blocks would merge visually.
 */
export const TIERED_GROUP_GAP: number = 32;
// Padding above the first endpoint row inside a group box.
export const TIERED_GROUP_BOX_TOP_PAD: number = 26;
// Padding below the last endpoint row — leaves room for two label lines.
export const TIERED_GROUP_BOX_BOTTOM_PAD: number = 36;

type TierIndex = 0 | 1 | 2;

/**
 * Assign a node to its tier. Exported for tests; pure.
 *
 * `nodeIdsWithFdbEdges` must contain the ids of every node touched by at
 * least one FDB edge (see computeTieredTopologyLayout).
 */
export const tierForNode: (
  node: NetworkTopologyNode,
  nodeIdsWithFdbEdges: Set<string>,
) => TierIndex = (
  node: NetworkTopologyNode,
  nodeIdsWithFdbEdges: Set<string>,
): TierIndex => {
  if (isEndpointNode(node)) {
    return 2;
  }
  if (!node.isManaged) {
    return 1;
  }
  // Managed: FDB edges mark it as a switch endpoints hang off.
  return nodeIdsWithFdbEdges.has(node.id) ? 1 : 0;
};

// Stable ordering within a tier: name (case-insensitive), then id.
const compareNodesForTier: (
  a: NetworkTopologyNode,
  b: NetworkTopologyNode,
) => number = (a: NetworkTopologyNode, b: NetworkTopologyNode): number => {
  const nameA: string = (a.name || "").toLowerCase();
  const nameB: string = (b.name || "").toLowerCase();
  if (nameA < nameB) {
    return -1;
  }
  if (nameA > nameB) {
    return 1;
  }
  if (a.id < b.id) {
    return -1;
  }
  if (a.id > b.id) {
    return 1;
  }
  return 0;
};

/** Positions plus the endpoint-group boxes that explain them. */
export interface TieredTopologyModel {
  positions: Map<string, TopologyPoint>;
  groups: Array<TopologyGroupBox>;
}

/*
 * One tier-1 node together with the endpoints attached to it. `anchor` is
 * null for the synthetic trailing column that collects endpoints with no
 * switch in view.
 */
interface TieredColumn {
  anchor: NetworkTopologyNode | null;
  endpoints: Array<NetworkTopologyNode>;
  // Endpoints per row inside this block (the block wraps into `rows` rows).
  columns: number;
  rows: number;
  /*
   * Half the block's footprint, including half an endpoint cell of padding
   * on each side. Adjacent columns are placed half-width to half-width, so
   * blocks never touch.
   */
  halfWidth: number;
  // Half the distance between the first and last endpoint centre in a row.
  spanHalf: number;
  centerX: number;
}

/*
 * Horizontal distance between two adjacent columns' centres. The group gap
 * only applies when at least one side actually owns endpoints, so a run of
 * childless tier-1 nodes keeps the plain device spacing.
 */
const columnPitch: (a: TieredColumn, b: TieredColumn) => number = (
  a: TieredColumn,
  b: TieredColumn,
): number => {
  const needsGap: boolean = a.endpoints.length > 0 || b.endpoints.length > 0;
  return a.halfWidth + b.halfWidth + (needsGap ? TIERED_GROUP_GAP : 0);
};

/*
 * Distance from the leftmost to the rightmost NODE CENTRE across a run of
 * columns. Node centres (not the padded block boxes) are what has to stay
 * inside the side margins.
 */
const columnsExtent: (columns: Array<TieredColumn>) => number = (
  columns: Array<TieredColumn>,
): number => {
  if (columns.length === 0) {
    return 0;
  }
  let extent: number =
    columns[0]!.spanHalf + columns[columns.length - 1]!.spanHalf;
  for (let i: number = 1; i < columns.length; i++) {
    extent += columnPitch(columns[i - 1]!, columns[i]!);
  }
  return extent;
};

/**
 * Compute the tiered layout together with the endpoint-group boxes.
 *
 * Pure and deterministic (see the block comment above for tier, column and
 * ordering rules). Y coordinates grow downward without bound for very
 * large graphs — the graph component pans/zooms, so nothing is clipped
 * permanently.
 */
export const computeTieredTopologyModel: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
) => TieredTopologyModel = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
): TieredTopologyModel => {
  const positions: Map<string, TopologyPoint> = new Map();
  const groups: Array<TopologyGroupBox> = [];

  if (!nodes || nodes.length === 0) {
    return { positions: positions, groups: groups };
  }

  // Every node touched by an FDB edge (endpoint attachments).
  const nodeIdsWithFdbEdges: Set<string> = new Set<string>();
  for (const edge of edges || []) {
    if (isFdbEdge(edge)) {
      nodeIdsWithFdbEdges.add(edge.fromNodeId);
      nodeIdsWithFdbEdges.add(edge.toNodeId);
    }
  }

  const tiers: [
    Array<NetworkTopologyNode>,
    Array<NetworkTopologyNode>,
    Array<NetworkTopologyNode>,
  ] = [[], [], []];
  for (const node of nodes) {
    tiers[tierForNode(node, nodeIdsWithFdbEdges)].push(node);
  }
  for (const tier of tiers) {
    tier.sort(compareNodesForTier);
  }

  const nodeById: Map<string, NetworkTopologyNode> = new Map<
    string,
    NetworkTopologyNode
  >();
  for (const node of nodes) {
    if (!nodeById.has(node.id)) {
      nodeById.set(node.id, node);
    }
  }

  const tier1Ids: Set<string> = new Set<string>(
    tiers[1].map((node: NetworkTopologyNode) => {
      return node.id;
    }),
  );
  const endpointIds: Set<string> = new Set<string>(
    tiers[2].map((node: NetworkTopologyNode) => {
      return node.id;
    }),
  );

  /*
   * Resolve each endpoint's parent switch. FDB edges are the real
   * attachment signal, so they win outright; any other edge to a tier-1
   * node is only a fallback for payloads that never carried protocols. An
   * endpoint seen on two switches (a MAC learned on both) deterministically
   * picks the lower one by (name, id) so the layout cannot flap.
   */
  const fdbParents: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  const linkParents: Map<string, Array<string>> = new Map<
    string,
    Array<string>
  >();
  for (const edge of edges || []) {
    const target: Map<string, Array<string>> = isFdbEdge(edge)
      ? fdbParents
      : linkParents;
    const pairs: Array<[string, string]> = [
      [edge.fromNodeId, edge.toNodeId],
      [edge.toNodeId, edge.fromNodeId],
    ];
    for (const pair of pairs) {
      const endpointId: string = pair[0];
      const parentId: string = pair[1];
      if (!endpointIds.has(endpointId) || !tier1Ids.has(parentId)) {
        continue;
      }
      const candidates: Array<string> = target.get(endpointId) || [];
      candidates.push(parentId);
      target.set(endpointId, candidates);
    }
  }

  const groupsByAnchorId: Map<string, Array<NetworkTopologyNode>> = new Map<
    string,
    Array<NetworkTopologyNode>
  >();
  const unattachedEndpoints: Array<NetworkTopologyNode> = [];
  // tiers[2] is already sorted, so every group's list comes out sorted too.
  for (const endpoint of tiers[2]) {
    const candidates: Array<string> =
      fdbParents.get(endpoint.id) || linkParents.get(endpoint.id) || [];
    let best: NetworkTopologyNode | null = null;
    for (const candidateId of candidates) {
      const candidate: NetworkTopologyNode | undefined =
        nodeById.get(candidateId);
      if (!candidate) {
        continue;
      }
      if (best === null || compareNodesForTier(candidate, best) < 0) {
        best = candidate;
      }
    }
    if (best === null) {
      unattachedEndpoints.push(endpoint);
      continue;
    }
    const members: Array<NetworkTopologyNode> =
      groupsByAnchorId.get(best.id) || [];
    members.push(endpoint);
    groupsByAnchorId.set(best.id, members);
  }

  /*
   * Tier-1 order: nodes that own endpoints first, then the childless ones.
   * A childless peer sitting between two switches would otherwise push
   * their endpoint blocks apart and force every FDB edge to cross it.
   */
  const anchorOrder: Array<NetworkTopologyNode> = tiers[1]
    .slice()
    .sort((a: NetworkTopologyNode, b: NetworkTopologyNode): number => {
      const aHasEndpoints: number = groupsByAnchorId.has(a.id) ? 0 : 1;
      const bHasEndpoints: number = groupsByAnchorId.has(b.id) ? 0 : 1;
      if (aHasEndpoints !== bHasEndpoints) {
        return aHasEndpoints - bHasEndpoints;
      }
      return compareNodesForTier(a, b);
    });

  const usableWidth: number = Math.max(1, width - 2 * TIERED_SIDE_MARGIN);
  const endpointSpacing: number = TIERED_ENDPOINT_NODE_SPACING;
  /*
   * n endpoints spaced s apart span (n - 1) * s, so the widest row that
   * still keeps every centre inside the margins holds floor(u / s) + 1.
   */
  const maxEndpointsPerRow: number = Math.max(
    1,
    Math.floor(usableWidth / endpointSpacing) + 1,
  );

  type ColumnSeed = {
    anchor: NetworkTopologyNode | null;
    endpoints: Array<NetworkTopologyNode>;
  };
  const seeds: Array<ColumnSeed> = anchorOrder.map(
    (anchor: NetworkTopologyNode): ColumnSeed => {
      return {
        anchor: anchor,
        endpoints: groupsByAnchorId.get(anchor.id) || [],
      };
    },
  );
  if (unattachedEndpoints.length > 0) {
    seeds.push({ anchor: null, endpoints: unattachedEndpoints });
  }

  /*
   * All groups share one cap on endpoints-per-row, which keeps groups
   * visually comparable instead of squashing one to the floor while its
   * neighbours stay wide. The cap is chosen below by trying every value
   * and keeping the shortest resulting graph.
   */
  type BuildColumnsFunction = (cap: number) => Array<TieredColumn>;
  const buildColumns: BuildColumnsFunction = (
    cap: number,
  ): Array<TieredColumn> => {
    return seeds.map((seed: ColumnSeed): TieredColumn => {
      const count: number = seed.endpoints.length;
      const columns: number = Math.max(
        1,
        Math.min(count, cap, maxEndpointsPerRow),
      );
      const rows: number = count === 0 ? 0 : Math.ceil(count / columns);
      const perRow: number = Math.min(count, columns);
      return {
        anchor: seed.anchor,
        endpoints: seed.endpoints,
        columns: columns,
        rows: rows,
        halfWidth: Math.max(
          (perRow * endpointSpacing) / 2,
          TIERED_NODE_SPACING / 2,
        ),
        spanHalf: count === 0 ? 0 : ((perRow - 1) * endpointSpacing) / 2,
        centerX: 0,
      };
    });
  };

  /*
   * Pack columns into bands. A column is never split across bands, so a
   * switch always keeps its endpoints together. A single column always
   * fits by construction (its row width is capped by maxEndpointsPerRow).
   */
  type PackBandsFunction = (
    columns: Array<TieredColumn>,
  ) => Array<Array<TieredColumn>>;
  const packBands: PackBandsFunction = (
    columns: Array<TieredColumn>,
  ): Array<Array<TieredColumn>> => {
    const bands: Array<Array<TieredColumn>> = [];
    let currentBand: Array<TieredColumn> = [];
    for (const column of columns) {
      if (
        currentBand.length > 0 &&
        columnsExtent([...currentBand, column]) > usableWidth
      ) {
        bands.push(currentBand);
        currentBand = [];
      }
      currentBand.push(column);
    }
    if (currentBand.length > 0) {
      bands.push(currentBand);
    }
    return bands;
  };

  // Vertical space the bands need — mirrors the placement loop below.
  type BandsHeightFunction = (bands: Array<Array<TieredColumn>>) => number;
  const bandsHeight: BandsHeightFunction = (
    bands: Array<Array<TieredColumn>>,
  ): number => {
    let y: number = 0;
    for (const band of bands) {
      const hasAnchor: boolean = band.some((column: TieredColumn): boolean => {
        return column.anchor !== null;
      });
      const endpointsTop: number = hasAnchor ? y + TIERED_TIER_GAP : y;
      let maxRows: number = 0;
      for (const column of band) {
        maxRows = Math.max(maxRows, column.rows);
      }
      y =
        (maxRows > 0 ? endpointsTop + (maxRows - 1) * TIERED_ROW_GAP : y) +
        TIERED_TIER_GAP;
    }
    return y;
  };

  /*
   * Choose the cap that makes the graph shortest. A small cap packs more
   * switches per band but stacks each group into a tall narrow strip; a
   * large cap does the opposite. Minimising height balances the two, and
   * ties keep the largest cap (wider groups, fewer endpoint rows).
   */
  let capCeiling: number = 1;
  for (const seed of seeds) {
    capCeiling = Math.max(
      capCeiling,
      Math.min(seed.endpoints.length, maxEndpointsPerRow),
    );
  }
  let bands: Array<Array<TieredColumn>> = packBands(buildColumns(capCeiling));
  let bestHeight: number = bandsHeight(bands);
  for (let cap: number = capCeiling - 1; cap >= 1; cap--) {
    const candidateBands: Array<Array<TieredColumn>> = packBands(
      buildColumns(cap),
    );
    const candidateHeight: number = bandsHeight(candidateBands);
    if (candidateHeight < bestHeight) {
      bands = candidateBands;
      bestHeight = candidateHeight;
    }
  }

  let yCursor: number = TIERED_LAYOUT_TOP_MARGIN;

  // Tier 0 stays a plain centered row (wrapping if the core is wide).
  if (tiers[0].length > 0) {
    const maxPerRow: number = Math.max(
      1,
      Math.floor(usableWidth / TIERED_NODE_SPACING) + 1,
    );
    const rowCount: number = Math.ceil(tiers[0].length / maxPerRow);
    for (let row: number = 0; row < rowCount; row++) {
      const rowNodes: Array<NetworkTopologyNode> = tiers[0].slice(
        row * maxPerRow,
        (row + 1) * maxPerRow,
      );
      const rowSpan: number = (rowNodes.length - 1) * TIERED_NODE_SPACING;
      const startX: number = width / 2 - rowSpan / 2;
      const y: number = yCursor + row * TIERED_ROW_GAP;
      rowNodes.forEach((node: NetworkTopologyNode, index: number): void => {
        positions.set(node.id, {
          x: startX + index * TIERED_NODE_SPACING,
          y: y,
        });
      });
    }
    yCursor += (rowCount - 1) * TIERED_ROW_GAP + TIERED_TIER_GAP;
  }

  for (const band of bands) {
    // Centre the band on the widest pair of node centres it contains.
    let pitchSum: number = 0;
    for (let i: number = 1; i < band.length; i++) {
      pitchSum += columnPitch(band[i - 1]!, band[i]!);
    }
    const first: TieredColumn = band[0]!;
    const last: TieredColumn = band[band.length - 1]!;
    let centerX: number =
      width / 2 - (pitchSum - first.spanHalf + last.spanHalf) / 2;
    for (let i: number = 0; i < band.length; i++) {
      band[i]!.centerX = centerX;
      if (i + 1 < band.length) {
        centerX += columnPitch(band[i]!, band[i + 1]!);
      }
    }

    const hasAnchor: boolean = band.some((column: TieredColumn): boolean => {
      return column.anchor !== null;
    });
    const anchorY: number = yCursor;
    if (hasAnchor) {
      for (const column of band) {
        if (column.anchor) {
          positions.set(column.anchor.id, { x: column.centerX, y: anchorY });
        }
      }
    }

    /*
     * Endpoints sit one tier gap under their switch (or at the band top
     * when the band has no tier-1 node at all).
     */
    const endpointsTop: number = hasAnchor
      ? anchorY + TIERED_TIER_GAP
      : anchorY;
    let maxRows: number = 0;
    for (const column of band) {
      maxRows = Math.max(maxRows, column.rows);
      if (column.rows === 0) {
        continue;
      }
      for (let row: number = 0; row < column.rows; row++) {
        const rowNodes: Array<NetworkTopologyNode> = column.endpoints.slice(
          row * column.columns,
          (row + 1) * column.columns,
        );
        // Short final rows stay centered on the group, not left-aligned.
        const rowSpan: number = (rowNodes.length - 1) * endpointSpacing;
        const startX: number = column.centerX - rowSpan / 2;
        const y: number = endpointsTop + row * TIERED_ROW_GAP;
        rowNodes.forEach((node: NetworkTopologyNode, index: number): void => {
          positions.set(node.id, {
            x: startX + index * endpointSpacing,
            y: y,
          });
        });
      }
      /*
       * The box pads half an endpoint cell past the outermost endpoint,
       * which can reach past the side margin; clamp it to the view so it
       * is never sliced off by the frame edge.
       */
      const boxLeft: number = Math.max(0, column.centerX - column.halfWidth);
      const boxRight: number = Math.min(
        width,
        column.centerX + column.halfWidth,
      );
      groups.push({
        nodeIds: column.endpoints.map((node: NetworkTopologyNode): string => {
          return node.id;
        }),
        anchorNodeId: column.anchor ? column.anchor.id : null,
        x: boxLeft,
        y: endpointsTop - TIERED_GROUP_BOX_TOP_PAD,
        width: Math.max(0, boxRight - boxLeft),
        height:
          (column.rows - 1) * TIERED_ROW_GAP +
          TIERED_GROUP_BOX_TOP_PAD +
          TIERED_GROUP_BOX_BOTTOM_PAD,
        endpointCount: column.endpoints.length,
      });
    }

    const bandBottom: number =
      maxRows > 0 ? endpointsTop + (maxRows - 1) * TIERED_ROW_GAP : anchorY;
    yCursor = bandBottom + TIERED_TIER_GAP;
  }

  return { positions: positions, groups: groups };
};

/**
 * Positions-only view of {@link computeTieredTopologyModel}.
 */
export const computeTieredTopologyLayout: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
) => Map<string, TopologyPoint> = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
): Map<string, TopologyPoint> => {
  return computeTieredTopologyModel(nodes, edges, width).positions;
};

/**
 * The tiered layout in the shape every other layout returns.
 *
 * The tiered layout grows downward without bound — a site with two
 * thousand endpoints is genuinely a very tall picture — so its content
 * extent is derived from where the nodes and group boxes actually ended
 * up, and the viewport zooms to fit it. The old component instead grew
 * the SVG viewBox to a hard-coded cap and rendered whatever fell inside,
 * which is why a large tiered graph appeared at a third of its size
 * between two wide empty bars.
 */
export const computeTieredTopologyLayoutModel: (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  pinned?: ReadonlyMap<string, TopologyPoint> | undefined,
) => TopologyLayoutModel = (
  nodes: Array<NetworkTopologyNode>,
  edges: Array<NetworkTopologyEdge>,
  width: number,
  height: number,
  pinned?: ReadonlyMap<string, TopologyPoint> | undefined,
): TopologyLayoutModel => {
  const model: TieredTopologyModel = computeTieredTopologyModel(
    nodes,
    edges,
    width,
  );
  const positions: Map<string, TopologyPoint> = model.positions;

  if (pinned && pinned.size > 0) {
    for (const [nodeId, point] of pinned) {
      if (
        positions.has(nodeId) &&
        Number.isFinite(point.x) &&
        Number.isFinite(point.y)
      ) {
        positions.set(nodeId, { x: point.x, y: point.y });
      }
    }
  }

  let maxX: number = width;
  let maxY: number = 0;
  for (const point of positions.values()) {
    maxX = Math.max(maxX, point.x);
    maxY = Math.max(maxY, point.y);
  }
  for (const group of model.groups) {
    maxX = Math.max(maxX, group.x + group.width);
    maxY = Math.max(maxY, group.y + group.height);
  }

  return {
    positions: positions,
    componentBoxes: [],
    groups: model.groups,
    contentWidth: Math.max(width, maxX + TOPOLOGY_LAYOUT_MARGIN),
    contentHeight: Math.max(height, maxY + TOPOLOGY_LAYOUT_MARGIN),
  };
};
