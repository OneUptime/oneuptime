import { LineageTone } from "./LineageGraphModel";
import { DataAssetFreshness } from "Common/Types/DataObservability/DataAssetFreshness";
import {
  DataLineageMap,
  DataLineageMapEdge,
  DataLineageMapNode,
  DataLineageMapNodeKind,
  DataLineageMapPipeline,
  DataLineageMapTrace,
  traceDataLineageMap,
} from "Common/Types/DataObservability/DataLineageMap";

/*
 * THE LINEAGE MAP, LAID OUT (#9114): which cards a reader's search and
 * choices leave on it, and where each card sits. Kept free of React, so
 * the Lineage Map page's drawing and its list read the same cards and can
 * be pinned in plain tests.
 *
 * Cards sit left to right as data flows: whatever writes a table to its
 * left, whatever is built from it or reads it to its right. Each group of
 * cards joined by arrows is laid out on its own, longest path first, its
 * cards in each column ordered to cross as few arrows as can be found
 * cheaply (the mean place of their neighbours, a few sweeps each way); the
 * groups are then packed in rows, the largest first, so a project of many
 * small flows fills a screen rather than one long column.
 */

export const LINEAGE_MAP_CARD_WIDTH: number = 224;
export const LINEAGE_MAP_CARD_HEIGHT: number = 60;
export const LINEAGE_MAP_COLUMN_GAP: number = 112;
export const LINEAGE_MAP_ROW_GAP: number = 20;
// Between two groups of cards no arrow joins.
export const LINEAGE_MAP_GROUP_GAP: number = 72;

const COLUMN: number = LINEAGE_MAP_CARD_WIDTH + LINEAGE_MAP_COLUMN_GAP;
const ROW: number = LINEAGE_MAP_CARD_HEIGHT + LINEAGE_MAP_ROW_GAP;
const ORDER_SWEEPS: number = 4;

// The kinds a reader can leave off the map: tables are what it is about.
export const LINEAGE_MAP_HIDEABLE_KINDS: ReadonlyArray<DataLineageMapNodeKind> =
  [
    DataLineageMapNodeKind.Service,
    DataLineageMapNodeKind.Pipeline,
    DataLineageMapNodeKind.Dashboard,
  ];

/*
 * The cards that go with a kind left off: a dashboard's datasets and data
 * sources (Power BI's own lineage) go with the dashboards.
 */
const KINDS_THAT_GO_WITH: Readonly<
  Partial<Record<DataLineageMapNodeKind, Array<DataLineageMapNodeKind>>>
> = {
  [DataLineageMapNodeKind.Dashboard]: [
    DataLineageMapNodeKind.Dataset,
    DataLineageMapNodeKind.Source,
  ],
};

// Whether a card is left off by the kinds a reader switched off.
export function isLineageMapKindHidden(
  kind: DataLineageMapNodeKind,
  hiddenKinds: ReadonlySet<DataLineageMapNodeKind>,
): boolean {
  if (hiddenKinds.has(kind)) {
    return true;
  }

  return Array.from(hiddenKinds).some(
    (hidden: DataLineageMapNodeKind): boolean => {
      return (KINDS_THAT_GO_WITH[hidden] || []).includes(kind);
    },
  );
}

export interface LineageMapFilter {
  // Words a card's name, database, tool or namespace holds, or a pipeline named on an arrow.
  search: string;
  hiddenKinds: ReadonlySet<DataLineageMapNodeKind>;
  // Only this card and what is upstream and downstream of it.
  focusNodeId: string | null;
}

export const EMPTY_LINEAGE_MAP_FILTER: LineageMapFilter = {
  search: "",
  hiddenKinds: new Set(),
  focusNodeId: null,
};

export interface LineageMapPoint {
  x: number;
  y: number;
}

export interface LineageMapLayout {
  positions: Map<string, LineageMapPoint>;
  width: number;
  height: number;
}

export function isLineageMapEmpty(map: DataLineageMap): boolean {
  return map.nodes.length === 0;
}

export function countLineageMapKinds(
  map: Pick<DataLineageMap, "nodes">,
): Record<DataLineageMapNodeKind, number> {
  const counts: Record<DataLineageMapNodeKind, number> = {
    [DataLineageMapNodeKind.Service]: 0,
    [DataLineageMapNodeKind.Table]: 0,
    [DataLineageMapNodeKind.Pipeline]: 0,
    [DataLineageMapNodeKind.Dashboard]: 0,
    [DataLineageMapNodeKind.Dataset]: 0,
    [DataLineageMapNodeKind.Source]: 0,
  };

  for (const node of map.nodes) {
    counts[node.kind]++;
  }

  return counts;
}

// How a card is now, as a table's lineage diagram says it.
export function getLineageMapNodeTone(node: DataLineageMapNode): LineageTone {
  if (node.kind === DataLineageMapNodeKind.Table) {
    if (node.isDropped) {
      return LineageTone.Dropped;
    }

    if (
      (node.openAlertCount || 0) > 0 ||
      node.freshness === DataAssetFreshness.Late
    ) {
      return LineageTone.Problem;
    }

    if (node.freshness === DataAssetFreshness.Fresh) {
      return LineageTone.Healthy;
    }

    return LineageTone.Neutral;
  }

  if (node.kind === DataLineageMapNodeKind.Pipeline) {
    if (node.lastRunState === "FAIL" || node.lastRunState === "ABORT") {
      return LineageTone.Problem;
    }

    if (node.lastRunState === "START" || node.lastRunState === "RUNNING") {
      return LineageTone.Running;
    }

    if (node.lastRunState === "COMPLETE") {
      return LineageTone.Healthy;
    }
  }

  return LineageTone.Neutral;
}

function normalize(text: string): string {
  return text.trim().toLowerCase();
}

// Whether a card answers a search: its name, or where it lives.
export function doesLineageMapNodeMatch(
  node: DataLineageMapNode,
  search: string,
): boolean {
  const words: string = normalize(search);

  if (!words) {
    return true;
  }

  return [node.name, node.database, node.tool, node.jobNamespace].some(
    (value: string | null | undefined): boolean => {
      return Boolean(value) && normalize(value as string).includes(words);
    },
  );
}

function keepEdges(
  edges: Array<DataLineageMapEdge>,
  kept: Set<string>,
): Array<DataLineageMapEdge> {
  return edges.filter((edge: DataLineageMapEdge): boolean => {
    return kept.has(edge.source) && kept.has(edge.target);
  });
}

/*
 * The cards a reader's choices leave on the map, with the arrows between
 * them: the kinds left off go, with their arrows; then, with a card
 * focused, that card and everything upstream and downstream of it; then,
 * with a search, every card it matches - or both ends of an arrow whose
 * pipeline it names - and everything upstream and downstream of them, so a
 * search for a table shows where its data comes from and where it goes.
 */
export function filterLineageMap(
  map: DataLineageMap,
  filter: LineageMapFilter,
): DataLineageMap {
  let nodes: Array<DataLineageMapNode> = map.nodes.filter(
    (node: DataLineageMapNode): boolean => {
      return !isLineageMapKindHidden(node.kind, filter.hiddenKinds);
    },
  );
  let kept: Set<string> = new Set(
    nodes.map((node: DataLineageMapNode): string => {
      return node.id;
    }),
  );
  let edges: Array<DataLineageMapEdge> = keepEdges(map.edges, kept);

  const keepAround: (ids: Array<string>) => void = (
    ids: Array<string>,
  ): void => {
    const around: Set<string> = new Set(ids);

    for (const id of ids) {
      const trace: DataLineageMapTrace = traceDataLineageMap({ edges }, id);
      trace.upstream.forEach((other: string) => {
        around.add(other);
      });
      trace.downstream.forEach((other: string) => {
        around.add(other);
      });
    }

    nodes = nodes.filter((node: DataLineageMapNode): boolean => {
      return around.has(node.id);
    });
    kept = around;
    edges = keepEdges(edges, kept);
  };

  if (filter.focusNodeId && kept.has(filter.focusNodeId)) {
    keepAround([filter.focusNodeId]);
  }

  const search: string = normalize(filter.search);

  if (search) {
    const matched: Set<string> = new Set();

    for (const node of nodes) {
      if (doesLineageMapNodeMatch(node, search)) {
        matched.add(node.id);
      }
    }

    for (const edge of edges) {
      if (
        edge.pipelines.some((pipeline: DataLineageMapPipeline): boolean => {
          return normalize(pipeline.name).includes(search);
        })
      ) {
        matched.add(edge.source);
        matched.add(edge.target);
      }
    }

    keepAround(Array.from(matched));
  }

  return { nodes, edges, isTruncated: map.isTruncated };
}

function compareNodes(a: DataLineageMapNode, b: DataLineageMapNode): number {
  return a.name < b.name
    ? -1
    : a.name > b.name
      ? 1
      : a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0;
}

interface Group {
  ids: Array<string>;
  positions: Map<string, LineageMapPoint>;
  width: number;
  height: number;
}

// Each group of cards joined by arrows, the largest first.
function findGroups(
  nodes: Array<DataLineageMapNode>,
  neighbours: Map<string, Array<string>>,
): Array<Array<string>> {
  const seen: Set<string> = new Set();
  const groups: Array<Array<string>> = [];

  for (const node of nodes) {
    if (seen.has(node.id)) {
      continue;
    }

    const group: Array<string> = [];
    const stack: Array<string> = [node.id];
    seen.add(node.id);

    while (stack.length > 0) {
      const current: string = stack.pop()!;
      group.push(current);

      for (const other of neighbours.get(current) || []) {
        if (!seen.has(other)) {
          seen.add(other);
          stack.push(other);
        }
      }
    }

    groups.push(group);
  }

  return groups
    .map((group: Array<string>, index: number) => {
      return { group, index };
    })
    .sort(
      (
        a: { group: Array<string>; index: number },
        b: { group: Array<string>; index: number },
      ): number => {
        return b.group.length - a.group.length || a.index - b.index;
      },
    )
    .map((entry: { group: Array<string>; index: number }): Array<string> => {
      return entry.group;
    });
}

function layoutGroup(data: {
  ids: Array<string>;
  byId: Map<string, DataLineageMapNode>;
  outgoing: Map<string, Array<string>>;
  incoming: Map<string, Array<string>>;
}): Group {
  const ids: Array<string> = [...data.ids].sort(
    (a: string, b: string): number => {
      return compareNodes(data.byId.get(a)!, data.byId.get(b)!);
    },
  );
  const inGroup: Set<string> = new Set(ids);

  /*
   * The arrows that close a cycle are left out of the layering: a walk
   * from the cards nothing feeds (then the rest, by name) marks an arrow
   * back to a card still on its path.
   */
  const backArrows: Set<string> = new Set();
  const state: Map<string, "open" | "done"> = new Map();
  const starts: Array<string> = [
    ...ids.filter((id: string): boolean => {
      return (data.incoming.get(id) || []).length === 0;
    }),
    ...ids,
  ];

  for (const start of starts) {
    if (state.has(start)) {
      continue;
    }

    const stack: Array<{ id: string; next: number }> = [{ id: start, next: 0 }];
    state.set(start, "open");

    while (stack.length > 0) {
      const top: { id: string; next: number } = stack[stack.length - 1]!;
      const targets: Array<string> = data.outgoing.get(top.id) || [];

      if (top.next >= targets.length) {
        state.set(top.id, "done");
        stack.pop();
        continue;
      }

      const target: string = targets[top.next]!;
      top.next++;

      if (!inGroup.has(target)) {
        continue;
      }

      const seen: "open" | "done" | undefined = state.get(target);

      if (seen === "open") {
        backArrows.add(`${top.id}>${target}`);
      } else if (!seen) {
        state.set(target, "open");
        stack.push({ id: target, next: 0 });
      }
    }
  }

  // Each card one column right of the furthest card that feeds it.
  const layer: Map<string, number> = new Map();
  const remaining: Map<string, number> = new Map();

  for (const id of ids) {
    remaining.set(
      id,
      (data.incoming.get(id) || []).filter((source: string): boolean => {
        return !backArrows.has(`${source}>${id}`);
      }).length,
    );
  }

  const ready: Array<string> = ids.filter((id: string): boolean => {
    return remaining.get(id) === 0;
  });

  const forwardTargets: (id: string) => Array<string> = (
    id: string,
  ): Array<string> => {
    return (data.outgoing.get(id) || []).filter((target: string): boolean => {
      return inGroup.has(target) && !backArrows.has(`${id}>${target}`);
    });
  };
  const topological: Array<string> = [];

  while (ready.length > 0) {
    const id: string = ready.shift()!;
    const at: number = layer.get(id) || 0;
    layer.set(id, at);
    topological.push(id);

    for (const target of forwardTargets(id)) {
      layer.set(target, Math.max(layer.get(target) || 0, at + 1));
      const left: number = (remaining.get(target) || 0) - 1;
      remaining.set(target, left);

      if (left === 0) {
        ready.push(target);
      }
    }
  }

  /*
   * Then each card that feeds others moves right, to just before the
   * nearest card it feeds, so a source sits beside what it writes rather
   * than in the first column, an arrow's length away. A card that feeds
   * nothing - a dashboard, a service that only reads - stays right after
   * what it reads.
   */
  for (const id of [...topological].reverse()) {
    const targets: Array<string> = forwardTargets(id);

    if (targets.length > 0) {
      layer.set(
        id,
        Math.min(
          ...targets.map((target: string): number => {
            return layer.get(target) || 0;
          }),
        ) - 1,
      );
    }
  }

  const first: number = Math.min(
    ...ids.map((id: string): number => {
      return layer.get(id) || 0;
    }),
  );
  const columns: Array<Array<string>> = [];

  for (const id of ids) {
    layer.set(id, (layer.get(id) || 0) - first);
  }

  for (const id of ids) {
    const at: number = layer.get(id) || 0;
    (columns[at] = columns[at] || []).push(id);
  }

  for (let index: number = 0; index < columns.length; index++) {
    columns[index] = columns[index] || [];
  }

  // Fewer crossings: each card at the mean place of its neighbours in the column beside it.
  const order: Map<string, number> = new Map();
  const place: () => void = (): void => {
    for (const column of columns) {
      column.forEach((id: string, index: number) => {
        order.set(id, index);
      });
    }
  };

  place();

  for (let sweep: number = 0; sweep < ORDER_SWEEPS; sweep++) {
    const downward: boolean = sweep % 2 === 0;
    const indexes: Array<number> = columns.map(
      (_c: Array<string>, i: number) => {
        return i;
      },
    );

    if (!downward) {
      indexes.reverse();
    }

    for (const index of indexes) {
      const column: Array<string> = columns[index]!;
      const neighboursOf: Map<string, Array<string>> = downward
        ? data.incoming
        : data.outgoing;
      const wanted: Map<string, number> = new Map();

      for (const id of column) {
        const beside: Array<number> = (neighboursOf.get(id) || [])
          .filter((other: string): boolean => {
            return inGroup.has(other) && order.has(other);
          })
          .map((other: string): number => {
            return order.get(other)!;
          });

        wanted.set(
          id,
          beside.length > 0
            ? beside.reduce((sum: number, value: number) => {
                return sum + value;
              }, 0) / beside.length
            : order.get(id)!,
        );
      }

      column.sort((a: string, b: string): number => {
        return wanted.get(a)! - wanted.get(b)! || order.get(a)! - order.get(b)!;
      });
      column.forEach((id: string, position: number) => {
        order.set(id, position);
      });
    }
  }

  const tallest: number = Math.max(
    ...columns.map((column: Array<string>): number => {
      return column.length;
    }),
  );
  const positions: Map<string, LineageMapPoint> = new Map();

  columns.forEach((column: Array<string>, index: number) => {
    // Each column centred on the tallest.
    const offset: number = ((tallest - column.length) * ROW) / 2;

    column.forEach((id: string, position: number) => {
      positions.set(id, { x: index * COLUMN, y: offset + position * ROW });
    });
  });

  return {
    ids,
    positions,
    width: (columns.length - 1) * COLUMN + LINEAGE_MAP_CARD_WIDTH,
    height: (tallest - 1) * ROW + LINEAGE_MAP_CARD_HEIGHT,
  };
}

/*
 * Where each card sits. The groups are packed in rows no wider than the
 * widest group or about as wide as all of them would stand square,
 * whichever is wider, each row as tall as its tallest group.
 */
export function layoutLineageMap(
  map: Pick<DataLineageMap, "nodes" | "edges">,
): LineageMapLayout {
  const byId: Map<string, DataLineageMapNode> = new Map(
    map.nodes.map((node: DataLineageMapNode): [string, DataLineageMapNode] => {
      return [node.id, node];
    }),
  );
  const outgoing: Map<string, Array<string>> = new Map();
  const incoming: Map<string, Array<string>> = new Map();
  const neighbours: Map<string, Array<string>> = new Map();
  const add: (
    into: Map<string, Array<string>>,
    a: string,
    b: string,
  ) => void = (
    into: Map<string, Array<string>>,
    a: string,
    b: string,
  ): void => {
    const list: Array<string> = into.get(a) || [];

    if (!list.includes(b)) {
      list.push(b);
    }

    into.set(a, list);
  };

  for (const edge of map.edges) {
    if (!byId.has(edge.source) || !byId.has(edge.target)) {
      continue;
    }

    add(outgoing, edge.source, edge.target);
    add(incoming, edge.target, edge.source);
    add(neighbours, edge.source, edge.target);
    add(neighbours, edge.target, edge.source);
  }

  // A card's arrows in the order of their other ends' names, so a layout is the same each time.
  const byName: (a: string, b: string) => number = (
    a: string,
    b: string,
  ): number => {
    return compareNodes(byId.get(a)!, byId.get(b)!);
  };

  for (const list of [...outgoing.values(), ...incoming.values()]) {
    list.sort(byName);
  }

  const sortedNodes: Array<DataLineageMapNode> = [...map.nodes].sort(
    compareNodes,
  );
  const groups: Array<Group> = findGroups(sortedNodes, neighbours).map(
    (ids: Array<string>): Group => {
      return layoutGroup({ ids, byId, outgoing, incoming });
    },
  );

  const positions: Map<string, LineageMapPoint> = new Map();

  if (groups.length === 0) {
    return { positions, width: 0, height: 0 };
  }

  const area: number = groups.reduce((sum: number, group: Group): number => {
    return (
      sum +
      (group.width + LINEAGE_MAP_GROUP_GAP) *
        (group.height + LINEAGE_MAP_GROUP_GAP)
    );
  }, 0);
  const rowWidth: number = Math.max(
    ...groups.map((group: Group): number => {
      return group.width;
    }),
    Math.sqrt(area) * 1.4,
  );

  let x: number = 0;
  let y: number = 0;
  let rowHeight: number = 0;
  let width: number = 0;

  for (const group of groups) {
    if (x > 0 && x + group.width > rowWidth) {
      x = 0;
      y += rowHeight + LINEAGE_MAP_GROUP_GAP;
      rowHeight = 0;
    }

    for (const [id, point] of group.positions) {
      positions.set(id, { x: x + point.x, y: y + point.y });
    }

    width = Math.max(width, x + group.width);
    rowHeight = Math.max(rowHeight, group.height);
    x += group.width + LINEAGE_MAP_GROUP_GAP;
  }

  return { positions, width, height: y + rowHeight };
}

// The least zoom a map opens at: below it a card's name cannot be read.
export const LINEAGE_MAP_READABLE_ZOOM: number = 0.7;
export const LINEAGE_MAP_CANVAS_MIN_HEIGHT: number = 360;
export const LINEAGE_MAP_CANVAS_MAX_HEIGHT: number = 720;
// Between the drawing and the canvas's edge.
export const LINEAGE_MAP_CANVAS_PADDING: number = 32;

export interface LineageMapView {
  x: number;
  y: number;
  zoom: number;
  // The canvas's height: as tall as the drawing needs, within bounds.
  height: number;
}

/*
 * How a map opens on a canvas this wide: whole, centred, when it can be
 * read whole (never past its own size); otherwise at the least zoom its
 * names can be read at, from its first column and its top, the rest a drag
 * or the fit button away. The canvas is as tall as the drawing at that
 * zoom, so a map of a few flows is not a box of empty space, nor a big one
 * taller than a screen.
 */
export function getLineageMapView(
  layout: Pick<LineageMapLayout, "width" | "height">,
  canvasWidth: number,
): LineageMapView {
  const padding: number = LINEAGE_MAP_CANVAS_PADDING;
  const room: number = Math.max(1, canvasWidth - 2 * padding);
  const zoom: number = Math.max(
    LINEAGE_MAP_READABLE_ZOOM,
    Math.min(1, layout.width > 0 ? room / layout.width : 1),
  );
  const drawnWidth: number = layout.width * zoom;
  const drawnHeight: number = layout.height * zoom;
  const height: number = Math.min(
    LINEAGE_MAP_CANVAS_MAX_HEIGHT,
    Math.max(LINEAGE_MAP_CANVAS_MIN_HEIGHT, drawnHeight + 2 * padding),
  );

  return {
    zoom,
    height,
    x:
      drawnWidth + 2 * padding <= canvasWidth
        ? (canvasWidth - drawnWidth) / 2
        : padding,
    y:
      drawnHeight + 2 * padding <= height
        ? (height - drawnHeight) / 2
        : padding,
  };
}
