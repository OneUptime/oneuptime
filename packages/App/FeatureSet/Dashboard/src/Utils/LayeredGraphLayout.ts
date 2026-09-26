/*
 * Deterministic layered ("Sugiyama-style") graph layout for directed
 * graphs, shared by the Service Map and Infrastructure topology views.
 * Hand-rolled on purpose — the project bundles no graph auto-layout
 * library (the network-device topology hand-rolls a force layout for the
 * same reason), and determinism matters: the same graph must always lay
 * out identically across renders and sessions.
 *
 * Pure and side-effect free. Three classic passes:
 *  1. Layer assignment — longest path from sources, linear in nodes plus
 *     edges. Cycles are broken first by dropping the back edges of a
 *     depth-first walk in id order, so a cyclic graph still lays out
 *     deterministically.
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

  /*
   * Adjacency is appended in place — copying a list per edge is quadratic
   * in a hub's degree (twenty thousand callers of one database). Layering
   * works on indexes into `ids`: sorting a successor list numerically sorts
   * it by id, so the walk below never depends on the order edges arrived in.
   */
  const outgoing: Map<string, Array<string>> = new Map<string, Array<string>>();
  const incoming: Map<string, Array<string>> = new Map<string, Array<string>>();
  const indexById: Map<string, number> = new Map<string, number>();
  ids.forEach((id: string, index: number) => {
    indexById.set(id, index);
    outgoing.set(id, []);
    incoming.set(id, []);
  });
  const successors: Array<Array<number>> = ids.map(() => {
    return [];
  });
  const inDegree: Array<number> = new Array<number>(ids.length).fill(0);
  for (const edge of cleanEdges) {
    outgoing.get(edge.from)!.push(edge.to);
    incoming.get(edge.to)!.push(edge.from);
    const toIndex: number = indexById.get(edge.to)!;
    successors[indexById.get(edge.from)!]!.push(toIndex);
    inDegree[toIndex] = inDegree[toIndex]! + 1;
  }
  for (const children of successors) {
    children.sort((a: number, b: number) => {
      return a - b;
    });
  }

  /*
   * Pass 1a — break cycles. One depth-first walk with an explicit stack (a
   * long chain must not overflow the call stack), rooted at the sources
   * first so a cycle is cut where traffic enters it, then at anything still
   * unvisited (a cycle nothing points into), each in id order. An edge
   * whose target finishes after its source points back at an ancestor on
   * the walk — it closes a cycle — and is ignored for layering. Every other
   * edge runs from a later finisher to an earlier one, so reverse finishing
   * order is a topological order of what remains. An acyclic graph has no
   * back edges, so nothing is ignored.
   */
  const visited: Array<boolean> = new Array<boolean>(ids.length).fill(false);
  const nextChild: Array<number> = new Array<number>(ids.length).fill(0);
  const finishOrder: Array<number> = [];
  const stack: Array<number> = [];
  const walkFrom: (root: number) => void = (root: number): void => {
    if (visited[root]) {
      return;
    }
    visited[root] = true;
    stack.push(root);
    while (stack.length > 0) {
      const node: number = stack[stack.length - 1]!;
      const children: Array<number> = successors[node]!;
      const cursor: number = nextChild[node]!;
      if (cursor < children.length) {
        nextChild[node] = cursor + 1;
        const child: number = children[cursor]!;
        if (!visited[child]) {
          visited[child] = true;
          stack.push(child);
        }
        continue;
      }
      stack.pop();
      finishOrder.push(node);
    }
  };
  for (let index: number = 0; index < ids.length; index++) {
    if (inDegree[index] === 0) {
      walkFrom(index);
    }
  }
  for (let index: number = 0; index < ids.length; index++) {
    walkFrom(index);
  }
  const finishRank: Array<number> = new Array<number>(ids.length).fill(0);
  finishOrder.forEach((node: number, rank: number) => {
    finishRank[node] = rank;
  });

  /*
   * Pass 1b — longest-path layering in one topological pass: sources sit on
   * layer 0 and every other node one layer below its deepest parent, which
   * is exactly what relaxing the edges to a fixed point gives on a DAG.
   */
  const layerOf: Array<number> = new Array<number>(ids.length).fill(0);
  for (let rank: number = finishOrder.length - 1; rank >= 0; rank--) {
    const node: number = finishOrder[rank]!;
    const childLayer: number = layerOf[node]! + 1;
    for (const child of successors[node]!) {
      if (finishRank[child]! < rank && layerOf[child]! < childLayer) {
        layerOf[child] = childLayer;
      }
    }
  }

  /*
   * A node below layer 0 sits directly under the parent that placed it, so
   * layers 0..max are all occupied and need no compacting. Pushing in id
   * order keeps each layer's starting order sorted.
   */
  const layers: Array<Array<string>> = [];
  ids.forEach((id: string, index: number) => {
    const layer: number = layerOf[index]!;
    while (layers.length <= layer) {
      layers.push([]);
    }
    layers[layer]!.push(id);
  });

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
