/*
 * Deterministic layered ("Sugiyama-style") graph layout for directed
 * graphs, shared by the Service Map and Infrastructure topology views.
 * Hand-rolled on purpose — the project bundles no graph auto-layout
 * library (the network-device topology hand-rolls a force layout for the
 * same reason), and determinism matters: the same graph must always lay
 * out identically across renders and sessions.
 *
 * Pure and side-effect free. Three classic passes:
 *  1. Layer assignment — longest-path relaxation from sources, cycle-safe
 *     (iteration count and layer values are capped by node count).
 *  2. Crossing reduction — a few barycenter ordering sweeps (down, then
 *     up), with node-id tiebreaks so ordering is stable.
 *  3. Coordinates — each layer is centered horizontally; y grows with
 *     layer index (sources at the top).
 */

export interface LayoutEdge {
  from: string;
  to: string;
}

export interface LayoutPoint {
  x: number;
  y: number;
}

export interface LayeredLayoutOptions {
  xGap: number;
  yGap: number;
}

const ORDERING_SWEEPS: number = 4;

export default function computeLayeredLayout(
  nodeIds: Array<string>,
  edges: Array<LayoutEdge>,
  options: LayeredLayoutOptions,
): Map<string, LayoutPoint> {
  const result: Map<string, LayoutPoint> = new Map<string, LayoutPoint>();

  if (nodeIds.length === 0) {
    return result;
  }

  // Deterministic node order regardless of input order.
  const ids: Array<string> = Array.from(new Set<string>(nodeIds)).sort();
  const idSet: Set<string> = new Set<string>(ids);

  // Keep only edges whose both endpoints are laid-out nodes; drop self-loops.
  const cleanEdges: Array<LayoutEdge> = edges.filter((edge: LayoutEdge) => {
    return edge.from !== edge.to && idSet.has(edge.from) && idSet.has(edge.to);
  });

  const outgoing: Map<string, Array<string>> = new Map<string, Array<string>>();
  const incoming: Map<string, Array<string>> = new Map<string, Array<string>>();
  for (const edge of cleanEdges) {
    outgoing.set(edge.from, [...(outgoing.get(edge.from) || []), edge.to]);
    incoming.set(edge.to, [...(incoming.get(edge.to) || []), edge.from]);
  }

  /*
   * Pass 1 — longest-path layering by relaxation. A DAG stabilizes within
   * |V| sweeps; a cycle would relax forever, so both the sweep count and
   * the layer value are capped at |V| and the result stays deterministic.
   */
  const layerById: Map<string, number> = new Map<string, number>();
  for (const id of ids) {
    layerById.set(id, 0);
  }
  const maxLayer: number = ids.length;
  for (let sweep: number = 0; sweep < ids.length; sweep++) {
    let changed: boolean = false;
    for (const edge of cleanEdges) {
      const fromLayer: number = layerById.get(edge.from)!;
      const toLayer: number = layerById.get(edge.to)!;
      const wanted: number = Math.min(maxLayer, fromLayer + 1);
      if (toLayer < wanted) {
        layerById.set(edge.to, wanted);
        changed = true;
      }
    }
    if (!changed) {
      break;
    }
  }

  // Compact layer indexes (drop empty layers, keep relative order).
  const usedLayers: Array<number> = Array.from(
    new Set<number>(Array.from(layerById.values())),
  ).sort((a: number, b: number) => {
    return a - b;
  });
  const compactIndexByLayer: Map<number, number> = new Map<number, number>();
  usedLayers.forEach((layer: number, index: number) => {
    compactIndexByLayer.set(layer, index);
  });

  const layers: Array<Array<string>> = usedLayers.map(() => {
    return [];
  });
  for (const id of ids) {
    layers[compactIndexByLayer.get(layerById.get(id)!)!]!.push(id);
  }

  /*
   * Pass 2 — barycenter crossing reduction. Order each layer by the mean
   * position of its neighbors in the adjacent (already ordered) layer;
   * nodes without neighbors keep their current position. Node-id tiebreak
   * keeps every sort stable and deterministic.
   */
  const positionOf: Map<string, number> = new Map<string, number>();
  const recordPositions: (layer: Array<string>) => void = (
    layer: Array<string>,
  ): void => {
    layer.forEach((id: string, index: number) => {
      positionOf.set(id, index);
    });
  };
  layers.forEach(recordPositions);

  const orderByBarycenter: (
    layer: Array<string>,
    neighborsOf: Map<string, Array<string>>,
  ) => Array<string> = (
    layer: Array<string>,
    neighborsOf: Map<string, Array<string>>,
  ): Array<string> => {
    const barycenter: Map<string, number> = new Map<string, number>();
    for (const id of layer) {
      const neighbors: Array<string> = (neighborsOf.get(id) || []).filter(
        (neighbor: string) => {
          return positionOf.has(neighbor);
        },
      );
      if (neighbors.length === 0) {
        barycenter.set(id, positionOf.get(id) || 0);
        continue;
      }
      const total: number = neighbors.reduce(
        (sum: number, neighbor: string) => {
          return sum + (positionOf.get(neighbor) || 0);
        },
        0,
      );
      barycenter.set(id, total / neighbors.length);
    }
    return [...layer].sort((a: string, b: string) => {
      const diff: number = barycenter.get(a)! - barycenter.get(b)!;
      if (diff !== 0) {
        return diff;
      }
      return a.localeCompare(b);
    });
  };

  for (let sweep: number = 0; sweep < ORDERING_SWEEPS; sweep++) {
    // Downward: order each layer by its parents in the layer above.
    for (let i: number = 1; i < layers.length; i++) {
      layers[i] = orderByBarycenter(layers[i]!, incoming);
      recordPositions(layers[i]!);
    }
    // Upward: order each layer by its children in the layer below.
    for (let i: number = layers.length - 2; i >= 0; i--) {
      layers[i] = orderByBarycenter(layers[i]!, outgoing);
      recordPositions(layers[i]!);
    }
  }

  // Pass 3 — coordinates. Center each layer around the widest one.
  const widest: number = Math.max(
    ...layers.map((layer: Array<string>) => {
      return layer.length;
    }),
  );
  layers.forEach((layer: Array<string>, layerIndex: number) => {
    const offsetX: number = ((widest - layer.length) / 2) * options.xGap;
    layer.forEach((id: string, index: number) => {
      result.set(id, {
        x: offsetX + index * options.xGap,
        y: layerIndex * options.yGap,
      });
    });
  });

  return result;
}
