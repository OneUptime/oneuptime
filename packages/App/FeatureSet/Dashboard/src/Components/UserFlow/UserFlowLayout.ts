import {
  UserFlowGraph,
  UserFlowLink,
  UserFlowNode,
} from "Common/Utils/Rum/UserFlow";

/*
 * Geometry for the flow map: where every node box, link band and drop-off
 * stub goes. Pure, so the arithmetic that decides whether a band lines up
 * with its node is pinned by node tests instead of eyeballed.
 *
 * The picture: one column per step. A node is a box whose height is
 * proportional to the sessions at it (with a floor so a label always fits).
 * Bands leave a node's right edge and enter the next column's left edge,
 * each as thick as the sessions it carries, stacked in the order of the
 * node they connect to so bands do not cross needlessly. What leaves the
 * map at a node - a drop-off going forward, a session START going backward
 * - is drawn as a short stub off the node's free side, so "where do people
 * give up" is visible without reading a number.
 *
 * Backward maps are drawn right-to-left: the anchor is the rightmost
 * column, and bands still run left-to-right in the order people lived them.
 */

export const USER_FLOW_NODE_WIDTH: number = 168;
export const USER_FLOW_COLUMN_GAP: number = 112;
/*
 * Fitting the map to its card: the gap between columns stretches between
 * these bounds, and a node narrows to the minimum before the map gives up
 * and scrolls sideways (a phone, or ten steps on a laptop).
 */
export const USER_FLOW_MIN_COLUMN_GAP: number = 64;
export const USER_FLOW_MAX_COLUMN_GAP: number = 260;
export const USER_FLOW_MIN_NODE_WIDTH: number = 136;
export const USER_FLOW_NODE_GAP: number = 14;
export const USER_FLOW_MIN_NODE_HEIGHT: number = 40;
export const USER_FLOW_PADDING_X: number = 52;
export const USER_FLOW_PADDING_TOP: number = 36;
export const USER_FLOW_PADDING_BOTTOM: number = 24;
/* Tallest a column is scaled to before node floors and gaps are added. */
export const USER_FLOW_TARGET_HEIGHT: number = 360;
/* How far a drop-off / entry stub reaches into the gap. */
export const USER_FLOW_STUB_LENGTH: number = 36;

export interface UserFlowNodeBox {
  node: UserFlowNode;
  column: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface UserFlowBand {
  link: UserFlowLink;
  path: string;
  thickness: number;
  /* Midpoint, for a tooltip anchor. */
  midX: number;
  midY: number;
}

export interface UserFlowStub {
  nodeId: string;
  kind: "exit" | "entry" | "continued";
  sessions: number;
  path: string;
  thickness: number;
}

export interface UserFlowColumnHeader {
  column: number;
  step: number;
  x: number;
  label: string;
  sessions: number;
}

export interface UserFlowLayoutOptions {
  /*
   * The width the map has to draw in. Given, the columns spread (or
   * squeeze) to fill it; left out, the fixed default spacing is used.
   */
  availableWidth?: number | undefined;
}

export interface UserFlowLayout {
  width: number;
  nodeWidth: number;
  columnGap: number;
  height: number;
  scale: number;
  nodes: Array<UserFlowNodeBox>;
  bands: Array<UserFlowBand>;
  stubs: Array<UserFlowStub>;
  columns: Array<UserFlowColumnHeader>;
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

/*
 * A closed ribbon between two vertical spans, with horizontal tangents at
 * both ends - the classic Sankey band.
 */
export function buildBandPath(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  thickness: number,
): string {
  const curve: number = (x1 - x0) / 2;

  return [
    `M${round(x0)},${round(y0)}`,
    `C${round(x0 + curve)},${round(y0)} ${round(x1 - curve)},${round(y1)} ${round(x1)},${round(y1)}`,
    `L${round(x1)},${round(y1 + thickness)}`,
    `C${round(x1 - curve)},${round(y1 + thickness)} ${round(x0 + curve)},${round(y0 + thickness)} ${round(x0)},${round(y0 + thickness)}`,
    "Z",
  ].join(" ");
}

/*
 * A stub off one side of a node that bends downward and tapers, reading as
 * "leaves here" without pointing at any node in the next column.
 */
function buildStubPath(
  x: number,
  y: number,
  thickness: number,
  direction: 1 | -1,
): string {
  const length: number = USER_FLOW_STUB_LENGTH * direction;
  const drop: number = Math.min(18, 6 + thickness / 2);
  const tipX: number = x + length;
  const tipY: number = y + thickness / 2 + drop;

  return [
    `M${round(x)},${round(y)}`,
    `C${round(x + length * 0.6)},${round(y)} ${round(tipX)},${round(tipY - thickness / 2)} ${round(tipX)},${round(tipY)}`,
    `C${round(tipX)},${round(tipY)} ${round(x + length * 0.5)},${round(y + thickness)} ${round(x)},${round(y + thickness)}`,
    "Z",
  ].join(" ");
}

export function describeUserFlowColumn(
  step: number,
  graph: Pick<UserFlowGraph, "anchorPage" | "direction">,
): string {
  if (!graph.anchorPage) {
    return step === 0 ? "Landing page" : `Page ${step + 1}`;
  }

  if (step === 0) {
    return "Selected page";
  }

  return graph.direction === "backward"
    ? `${step} ${step === 1 ? "page" : "pages"} before`
    : `${step} ${step === 1 ? "page" : "pages"} after`;
}

/*
 * Node width and column gap for a map of `columns` columns in `available`
 * pixels: the gap grows to fill a wide card (up to a limit, past which
 * bands get too flat to follow), then nodes narrow, then the map scrolls.
 */
export function fitUserFlowColumns(
  columns: number,
  available: number | undefined,
): { nodeWidth: number; columnGap: number } {
  if (!available || !Number.isFinite(available) || columns < 1) {
    return {
      nodeWidth: USER_FLOW_NODE_WIDTH,
      columnGap: USER_FLOW_COLUMN_GAP,
    };
  }

  const inner: number = available - USER_FLOW_PADDING_X * 2;

  if (columns === 1) {
    return {
      nodeWidth: Math.max(
        USER_FLOW_MIN_NODE_WIDTH,
        Math.min(USER_FLOW_NODE_WIDTH, inner),
      ),
      columnGap: USER_FLOW_COLUMN_GAP,
    };
  }

  const gapAtFullWidth: number =
    (inner - columns * USER_FLOW_NODE_WIDTH) / (columns - 1);

  if (gapAtFullWidth >= USER_FLOW_MIN_COLUMN_GAP) {
    return {
      nodeWidth: USER_FLOW_NODE_WIDTH,
      columnGap: Math.min(USER_FLOW_MAX_COLUMN_GAP, gapAtFullWidth),
    };
  }

  const nodeWidth: number = Math.max(
    USER_FLOW_MIN_NODE_WIDTH,
    (inner - (columns - 1) * USER_FLOW_MIN_COLUMN_GAP) / columns,
  );

  return { nodeWidth: nodeWidth, columnGap: USER_FLOW_MIN_COLUMN_GAP };
}

export function layoutUserFlow(
  graph: UserFlowGraph,
  options: UserFlowLayoutOptions = {},
): UserFlowLayout {
  const columns: number = Math.max(graph.steps, 1);
  const { nodeWidth, columnGap } = fitUserFlowColumns(
    columns,
    options.availableWidth,
  );
  const byStep: Array<Array<UserFlowNode>> = [];

  for (let step: number = 0; step < columns; step++) {
    byStep.push([]);
  }

  for (const node of graph.nodes) {
    if (node.step < columns) {
      (byStep[node.step] as Array<UserFlowNode>).push(node);
    }
  }

  /* One scale for every column, set by the busiest one. */
  let busiest: number = 1;

  for (const nodes of byStep) {
    const total: number = nodes.reduce((sum: number, node: UserFlowNode) => {
      return sum + node.sessions;
    }, 0);

    busiest = Math.max(busiest, total);
  }

  const scale: number = USER_FLOW_TARGET_HEIGHT / busiest;

  const columnX: (step: number) => number = (step: number): number => {
    const column: number =
      graph.direction === "backward" ? columns - 1 - step : step;

    return USER_FLOW_PADDING_X + column * (nodeWidth + columnGap);
  };

  const boxes: Map<string, UserFlowNodeBox> = new Map<
    string,
    UserFlowNodeBox
  >();
  let maxBottom: number = USER_FLOW_PADDING_TOP;

  byStep.forEach((nodes: Array<UserFlowNode>, step: number): void => {
    let y: number = USER_FLOW_PADDING_TOP;

    for (const node of nodes) {
      const height: number = Math.max(
        USER_FLOW_MIN_NODE_HEIGHT,
        node.sessions * scale,
      );

      boxes.set(node.id, {
        node: node,
        column: graph.direction === "backward" ? columns - 1 - step : step,
        x: columnX(step),
        y: y,
        width: nodeWidth,
        height: height,
      });

      y += height + USER_FLOW_NODE_GAP;
    }

    maxBottom = Math.max(maxBottom, y - USER_FLOW_NODE_GAP);
  });

  /*
   * Band endpoints. Each node's outgoing bands stack from the top of its
   * right edge in the order of their target's y; incoming bands stack on
   * the left edge in the order of their source's y. The stack is centred
   * on the box when the box is taller than its bands (a floored node).
   */
  const outgoing: Map<string, Array<UserFlowLink>> = new Map();
  const incoming: Map<string, Array<UserFlowLink>> = new Map();

  for (const link of graph.links) {
    if (!boxes.has(link.sourceId) || !boxes.has(link.targetId)) {
      continue;
    }

    outgoing.set(link.sourceId, [...(outgoing.get(link.sourceId) || []), link]);
    incoming.set(link.targetId, [...(incoming.get(link.targetId) || []), link]);
  }

  const boxY: (id: string) => number = (id: string): number => {
    return (boxes.get(id) as UserFlowNodeBox).y;
  };

  /*
   * What leaves a node without a band: going forward, drop-offs and the
   * sessions that continue past the last column leave from the RIGHT edge
   * (after the bands); going backward, session starts enter from the LEFT.
   */
  const rightExtras: (node: UserFlowNode) => number = (
    node: UserFlowNode,
  ): number => {
    return graph.direction === "forward" ? node.terminal + node.continued : 0;
  };

  const leftExtras: (node: UserFlowNode) => number = (
    node: UserFlowNode,
  ): number => {
    return graph.direction === "backward" ? node.terminal + node.continued : 0;
  };

  const sourceOffset: Map<string, number> = new Map<string, number>();
  const targetOffset: Map<string, number> = new Map<string, number>();
  const stubs: Array<UserFlowStub> = [];

  for (const box of boxes.values()) {
    const node: UserFlowNode = box.node;
    const out: Array<UserFlowLink> = (outgoing.get(node.id) || []).sort(
      (a: UserFlowLink, b: UserFlowLink): number => {
        return boxY(a.targetId) - boxY(b.targetId);
      },
    );
    const into: Array<UserFlowLink> = (incoming.get(node.id) || []).sort(
      (a: UserFlowLink, b: UserFlowLink): number => {
        return boxY(a.sourceId) - boxY(b.sourceId);
      },
    );

    const rightTotal: number =
      (out.reduce((sum: number, link: UserFlowLink) => {
        return sum + link.sessions;
      }, 0) +
        rightExtras(node)) *
      scale;
    const leftTotal: number =
      (into.reduce((sum: number, link: UserFlowLink) => {
        return sum + link.sessions;
      }, 0) +
        leftExtras(node)) *
      scale;

    let rightY: number = box.y + Math.max(0, (box.height - rightTotal) / 2);
    let leftY: number = box.y + Math.max(0, (box.height - leftTotal) / 2);

    for (const link of out) {
      sourceOffset.set(link.id, rightY);
      rightY += link.sessions * scale;
    }

    for (const link of into) {
      targetOffset.set(link.id, leftY);
      leftY += link.sessions * scale;
    }

    if (graph.direction === "forward") {
      if (node.continued > 0) {
        const thickness: number = node.continued * scale;

        stubs.push({
          nodeId: node.id,
          kind: "continued",
          sessions: node.continued,
          thickness: thickness,
          path: buildBandPath(
            box.x + box.width,
            rightY,
            box.x + box.width + USER_FLOW_STUB_LENGTH,
            rightY,
            thickness,
          ),
        });
        rightY += thickness;
      }

      if (node.terminal > 0) {
        const thickness: number = node.terminal * scale;

        stubs.push({
          nodeId: node.id,
          kind: "exit",
          sessions: node.terminal,
          thickness: thickness,
          path: buildStubPath(box.x + box.width, rightY, thickness, 1),
        });
      }
    } else if (node.terminal + node.continued > 0) {
      /*
       * Backward: a journey that ends at this column's node either started
       * here (terminal) or reaches further back than the map (continued).
       */
      if (node.continued > 0) {
        const thickness: number = node.continued * scale;

        stubs.push({
          nodeId: node.id,
          kind: "continued",
          sessions: node.continued,
          thickness: thickness,
          path: buildBandPath(
            box.x - USER_FLOW_STUB_LENGTH,
            leftY,
            box.x,
            leftY,
            thickness,
          ),
        });
        leftY += thickness;
      }

      if (node.terminal > 0) {
        const thickness: number = node.terminal * scale;

        stubs.push({
          nodeId: node.id,
          kind: "entry",
          sessions: node.terminal,
          thickness: thickness,
          path: buildStubPath(box.x, leftY, thickness, -1),
        });
      }
    }
  }

  const bands: Array<UserFlowBand> = [];

  for (const link of graph.links) {
    const source: UserFlowNodeBox | undefined = boxes.get(link.sourceId);
    const target: UserFlowNodeBox | undefined = boxes.get(link.targetId);

    if (!source || !target) {
      continue;
    }

    const thickness: number = Math.max(1, link.sessions * scale);
    const x0: number = source.x + source.width;
    const y0: number = sourceOffset.get(link.id) as number;
    const x1: number = target.x;
    const y1: number = targetOffset.get(link.id) as number;

    bands.push({
      link: link,
      path: buildBandPath(x0, y0, x1, y1, thickness),
      thickness: thickness,
      midX: (x0 + x1) / 2,
      midY: (y0 + y1) / 2 + thickness / 2,
    });
  }

  /* Thin bands last, so a thick band never hides one under it. */
  bands.sort((a: UserFlowBand, b: UserFlowBand): number => {
    return b.thickness - a.thickness;
  });

  const headers: Array<UserFlowColumnHeader> = byStep.map(
    (nodes: Array<UserFlowNode>, step: number): UserFlowColumnHeader => {
      return {
        column: graph.direction === "backward" ? columns - 1 - step : step,
        step: step,
        x: columnX(step),
        label: describeUserFlowColumn(step, graph),
        sessions: nodes.reduce((sum: number, node: UserFlowNode) => {
          return sum + node.sessions;
        }, 0),
      };
    },
  );

  return {
    width:
      USER_FLOW_PADDING_X * 2 + columns * nodeWidth + (columns - 1) * columnGap,
    nodeWidth: nodeWidth,
    columnGap: columnGap,
    height: maxBottom + USER_FLOW_PADDING_BOTTOM + 24,
    scale: scale,
    nodes: Array.from(boxes.values()),
    bands: bands,
    stubs: stubs,
    columns: headers,
  };
}
