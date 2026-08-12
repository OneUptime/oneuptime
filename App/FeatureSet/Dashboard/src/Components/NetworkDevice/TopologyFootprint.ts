import { NetworkTopologyNode } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import { isEndpointNode } from "./EndpointNodeUtil";
import {
  DEVICE_NODE_BASE_RADIUS,
  ENDPOINT_NODE_BASE_RADIUS,
  TopologyShapeGeometry,
  geometryForShape,
  shapeGeometryForNode,
} from "./TopologyNodeShape";

/*
 * The drawing geometry of a topology node, in viewBox units.
 *
 * This module is imported by BOTH the layout and the graph component on
 * purpose. The old layout had no notion of node size at all: it placed
 * dimensionless points and the component then drew 32px circles with
 * 12px labels underneath them, so "correct" layouts routinely rendered as
 * overlapping glyphs and labels sliced by the frame edge. Anything that
 * decides where a node goes and anything that decides how big a node is
 * must read the same constants, or the two drift apart again.
 *
 * Label widths are estimated from character counts rather than measured,
 * because App/Tests runs under `testEnvironment: "node"` with no DOM.
 * Real text measurement would make the layout untestable, which is a
 * worse trade than a few pixels of estimation error — and the estimate
 * only ever needs to be good enough to keep labels from colliding.
 */

/*
 * The size class a node is drawn at. The SILHOUETTE is chosen by role in
 * TopologyNodeShape — a switch is a rounded square, a firewall a diamond
 * — and its half-extents come from there too, so the layout reserves room
 * for the shape that is actually painted. These constants remain the
 * unclassified case: a device with no role is still a circle of this
 * radius, and an endpoint still the 9 × 7 rect it has always been.
 */
export const DEVICE_NODE_RADIUS: number = DEVICE_NODE_BASE_RADIUS;
const ENDPOINT_RECT: TopologyShapeGeometry = geometryForShape(
  "rect",
  ENDPOINT_NODE_BASE_RADIUS,
);
export const ENDPOINT_NODE_HALF_WIDTH: number = ENDPOINT_RECT.halfWidth;
export const ENDPOINT_NODE_HALF_HEIGHT: number = ENDPOINT_RECT.halfHeight;

export const DEVICE_LABEL_FONT_SIZE: number = 12;
export const ENDPOINT_LABEL_FONT_SIZE: number = 10;
/*
 * Mean glyph advance as a fraction of font size for the UI sans stack.
 * 0.58 is a deliberate slight over-estimate: budgeting too much width
 * leaves a gap, budgeting too little overlaps two labels.
 */
export const LABEL_CHAR_WIDTH_RATIO: number = 0.58;

// Centre to the baseline of the first label line.
export const DEVICE_LABEL_BASELINE_OFFSET: number = DEVICE_NODE_RADIUS + 14;
export const ENDPOINT_LABEL_BASELINE_OFFSET: number =
  ENDPOINT_NODE_HALF_HEIGHT + 12;
// Baseline-to-baseline distance for a wrapped label.
export const DEVICE_LABEL_LINE_HEIGHT: number = 13;
export const ENDPOINT_LABEL_LINE_HEIGHT: number = 11;

export const DEVICE_LABEL_MAX_CHARS: number = 17;
export const DEVICE_LABEL_MAX_LINES: number = 2;
export const ENDPOINT_LABEL_MAX_CHARS: number = 11;
export const ENDPOINT_LABEL_MAX_LINES: number = 2;

/*
 * Hard cap on how much horizontal room a label may claim. Without it a
 * single long hostname would reserve a corridor wide enough to push the
 * rest of the graph apart; past this width the label is simply allowed to
 * overlap its neighbours' whitespace, which reads far better than a
 * layout distorted around one device name.
 */
export const LABEL_MAX_HALF_WIDTH: number = 60;

// Clearance kept between two node glyphs on top of their own radii.
export const NODE_COLLISION_PADDING: number = 8;

/*
 * Below this rendered scale, labels are hidden and a "zoom in" hint is
 * shown. There is no honest way to draw two thousand 12px labels at once;
 * pretending otherwise is what produces an unreadable hairball.
 */
export const LABEL_VISIBILITY_MIN_SCALE: number = 0.55;

/*
 * Label wrapping. Device and endpoint names ("core-1.example.com", "Menu
 * Board 2") are long relative to node spacing, so they wrap onto a second
 * line at a word boundary and only truncate when even that cannot fit.
 * Pure and character-count based — no DOM text measurement, so it stays
 * usable from the react-free unit tests.
 */
export const wrapNodeLabel: (
  label: string,
  maxChars?: number,
  maxLines?: number,
) => Array<string> = (
  label: string,
  maxChars: number = ENDPOINT_LABEL_MAX_CHARS,
  maxLines: number = ENDPOINT_LABEL_MAX_LINES,
): Array<string> => {
  const text: string = (label || "").trim();
  if (!text) {
    return [];
  }
  const limit: number = Math.max(1, Math.floor(maxChars));
  const lineLimit: number = Math.max(1, Math.floor(maxLines));

  /*
   * Split into chunks that each fit on a line: words normally, and a hard
   * split for a single word longer than the limit (long hostnames).
   */
  const chunks: Array<string> = [];
  for (const word of text.split(/\s+/)) {
    if (word.length <= limit) {
      chunks.push(word);
      continue;
    }
    for (let i: number = 0; i < word.length; i += limit) {
      chunks.push(word.slice(i, i + limit));
    }
  }

  const lines: Array<string> = [];
  let current: string = "";
  let consumed: number = 0;
  for (const chunk of chunks) {
    const candidate: string = current ? `${current} ${chunk}` : chunk;
    if (candidate.length <= limit) {
      current = candidate;
      consumed++;
      continue;
    }
    // Starting a new line would need one more than the allowance.
    if (lines.length + 2 > lineLimit) {
      break;
    }
    lines.push(current);
    current = chunk;
    consumed++;
  }
  if (current) {
    lines.push(current);
  }

  // Anything that did not fit is folded into an ellipsis on the last line.
  const lastIndex: number = lines.length - 1;
  if (lastIndex >= 0 && consumed < chunks.length) {
    const lastLine: string = lines[lastIndex]!;
    const trimmed: string =
      lastLine.length + 1 > limit
        ? lastLine.slice(0, Math.max(1, limit - 1))
        : lastLine;
    lines[lastIndex] = `${trimmed.replace(/\s+$/, "")}…`;
  }
  return lines;
};

/** The wrapped label lines a node renders, per its kind. */
export const labelLinesForNode: (node: NetworkTopologyNode) => Array<string> = (
  node: NetworkTopologyNode,
): Array<string> => {
  if (isEndpointNode(node)) {
    return wrapNodeLabel(
      node.name || "",
      ENDPOINT_LABEL_MAX_CHARS,
      ENDPOINT_LABEL_MAX_LINES,
    );
  }
  return wrapNodeLabel(
    node.name || "",
    DEVICE_LABEL_MAX_CHARS,
    DEVICE_LABEL_MAX_LINES,
  );
};

export interface TopologyNodeFootprint {
  /** Half the glyph's width, label excluded. */
  halfWidth: number;
  /** Half the glyph's height, label excluded. */
  halfHeight: number;
  /**
   * The silhouette this node is painted as — carried here so the renderer
   * draws exactly the shape the layout reserved room for.
   */
  shape: TopologyShapeGeometry;
  /** Half the width of the widest label line, capped. */
  labelHalfWidth: number;
  /** Centre to the baseline of the FIRST label line. */
  labelBaselineOffset: number;
  /** Centre to the bottom of the last label line (positive, downward). */
  labelBottom: number;
  /** Radius used for glyph-vs-glyph separation, padding included. */
  collisionRadius: number;
  /** Half the total painted width — the wider of glyph and label. */
  inkHalfWidth: number;
}

/**
 * The drawing footprint of one node.
 *
 * Total: every field is finite for every node kind, including a node
 * with an empty or absent name. Every field is also strictly positive
 * except `labelHalfWidth`, which is exactly zero for an unnamed node —
 * it has no text, so it claims no text width, and `inkHalfWidth` falls
 * back to the glyph.
 */
export const footprintForNode: (
  node: NetworkTopologyNode,
) => TopologyNodeFootprint = (
  node: NetworkTopologyNode,
): TopologyNodeFootprint => {
  const isEndpoint: boolean = isEndpointNode(node);

  const shape: TopologyShapeGeometry = shapeGeometryForNode(node);
  const halfWidth: number = shape.halfWidth;
  const halfHeight: number = shape.halfHeight;

  const lines: Array<string> = labelLinesForNode(node);
  const fontSize: number = isEndpoint
    ? ENDPOINT_LABEL_FONT_SIZE
    : DEVICE_LABEL_FONT_SIZE;
  const lineHeight: number = isEndpoint
    ? ENDPOINT_LABEL_LINE_HEIGHT
    : DEVICE_LABEL_LINE_HEIGHT;
  /*
   * The clearance between the bottom of the glyph and the first baseline
   * is what the fixed offsets encode for a circle; a taller silhouette
   * (the firewall diamond overshoots the circle by a couple of units)
   * pushes its label down by the difference rather than letting the two
   * touch.
   */
  const labelGap: number = isEndpoint
    ? ENDPOINT_LABEL_BASELINE_OFFSET - ENDPOINT_NODE_HALF_HEIGHT
    : DEVICE_LABEL_BASELINE_OFFSET - DEVICE_NODE_RADIUS;
  const baselineOffset: number = Math.max(
    isEndpoint ? ENDPOINT_LABEL_BASELINE_OFFSET : DEVICE_LABEL_BASELINE_OFFSET,
    halfHeight + labelGap,
  );

  let longestLine: number = 0;
  for (const line of lines) {
    longestLine = Math.max(longestLine, line.length);
  }
  const labelHalfWidth: number = Math.min(
    LABEL_MAX_HALF_WIDTH,
    (longestLine * fontSize * LABEL_CHAR_WIDTH_RATIO) / 2,
  );

  /*
   * A node with no name still reserves the first baseline: the graph
   * draws an empty <text> there and a later rename must not need a
   * re-layout to fit.
   */
  const labelBottom: number =
    baselineOffset + Math.max(0, lines.length - 1) * lineHeight;

  return {
    halfWidth: halfWidth,
    halfHeight: halfHeight,
    shape: shape,
    labelHalfWidth: labelHalfWidth,
    labelBaselineOffset: baselineOffset,
    labelBottom: labelBottom,
    collisionRadius: Math.max(halfWidth, halfHeight) + NODE_COLLISION_PADDING,
    inkHalfWidth: Math.max(halfWidth, labelHalfWidth),
  };
};

/** Footprints for a whole topology, keyed by node id. */
export const buildFootprints: (
  nodes: Array<NetworkTopologyNode>,
) => Map<string, TopologyNodeFootprint> = (
  nodes: Array<NetworkTopologyNode>,
): Map<string, TopologyNodeFootprint> => {
  const footprints: Map<string, TopologyNodeFootprint> = new Map<
    string,
    TopologyNodeFootprint
  >();
  for (const node of nodes || []) {
    if (!node || typeof node.id !== "string" || node.id.length === 0) {
      continue;
    }
    if (!footprints.has(node.id)) {
      footprints.set(node.id, footprintForNode(node));
    }
  }
  return footprints;
};

/*
 * Fallback used when a position exists for an id with no footprint — a
 * pinned coordinate for a node that has since left the graph, say. Sized
 * as a device so it can never under-reserve space.
 */
export const DEFAULT_FOOTPRINT: TopologyNodeFootprint = {
  halfWidth: DEVICE_NODE_RADIUS,
  halfHeight: DEVICE_NODE_RADIUS,
  shape: geometryForShape("circle", DEVICE_NODE_BASE_RADIUS),
  labelHalfWidth: 0,
  labelBaselineOffset: DEVICE_LABEL_BASELINE_OFFSET,
  labelBottom: DEVICE_LABEL_BASELINE_OFFSET,
  collisionRadius: DEVICE_NODE_RADIUS + NODE_COLLISION_PADDING,
  inkHalfWidth: DEVICE_NODE_RADIUS,
};

export const footprintOrDefault: (
  footprints: Map<string, TopologyNodeFootprint>,
  nodeId: string,
) => TopologyNodeFootprint = (
  footprints: Map<string, TopologyNodeFootprint>,
  nodeId: string,
): TopologyNodeFootprint => {
  return footprints.get(nodeId) || DEFAULT_FOOTPRINT;
};
