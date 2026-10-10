import { TopologyNodeFootprint } from "../../NetworkDevice/TopologyFootprint";
import { TopologyNodeView, TopologyViewModel } from "../NetworkTopologyViewModel";
import { HEALTH_STATE_COLORS } from "../TopologyHealthFilter";
import { TopologyHullView } from "../NetworkTopologyDrawing";
import { blendWithPaper, resolvePrintColor } from "./ExportColor";
import { ExportItem, textItem } from "./ExportItems";
import { shapeItems } from "./ExportShapes";
import { TextMeasure } from "./ExportText";

/*
 * The map itself, on paper.
 *
 * Everything here mirrors one decision of the live canvas
 * (NetworkDeviceGraph): hulls behind links behind nodes; a node as its
 * attention halo, its silhouette, its interface badge and its wrapped name;
 * the same colours, stroke widths and dash patterns, in layout units scaled
 * to points. Where the canvas makes something translucent (a dimmed node, a
 * hull's fill), the page draws the opaque colour that translucency makes on
 * white paper (see ExportColor).
 */

// Room kept under a label's last baseline for descenders, in layout units.
const LABEL_DESCENT: number = 4;
// Clearance around the drawing inside the frame, in layout units.
const DIAGRAM_BOUNDS_PADDING: number = 8;
// The hull caption sits this far above the hull, and is this tall.
const HULL_CAPTION_OFFSET: number = 6;
export const HULL_CAPTION_FONT_SIZE: number = 12;

/*
 * The opacities the live map draws with: a dimmed node's group, a dimmed
 * link, the glyph fills, the hulls and the attention halo.
 */
export const DIMMED_NODE_OPACITY: number = 0.2;
export const DIMMED_EDGE_OPACITY: number = 0.15;
const ENDPOINT_FILL_OPACITY: number = 0.85;
const DEVICE_FILL_OPACITY: number = 0.9;
const HULL_FILL_OPACITY: number = 0.4;
const DASHED_HULL_FILL_OPACITY: number = 0.65;
const HALO_FILL_OPACITY: number = 0.16;
const HALO_STROKE_OPACITY: number = 0.55;

const HULL_FILL: string = "var(--ou-surface-secondary, #f9fafb)";
const HULL_STROKE: string = "var(--ou-border-subtle, #e5e7eb)";
const HULL_CAPTION_COLOR: string = "var(--ou-text-muted, #6b7280)";
const LABEL_COLOR: string = "var(--ou-text-secondary, #374151)";
const LABEL_HALO_COLOR: string = "var(--ou-surface-primary, #ffffff)";
const DEVICE_BADGE_COLOR: string = "#ffffff";

/** A node's name as the page draws it: wrapped lines, cleaned for the font. */
export interface DrawnLabel {
  lines: Array<string>;
  // The widest line's width in layout units.
  widestLine: number;
}

export interface WorldBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DiagramTransform {
  // Points per layout unit.
  scale: number;
  // Where layout point (0, 0) lands on the page.
  offsetX: number;
  offsetY: number;
}

export function haloRadiusFor(footprint: TopologyNodeFootprint): number {
  return Math.max(footprint.halfWidth, footprint.halfHeight) + 5;
}

export function labelFontSizeFor(nodeView: TopologyNodeView): number {
  return nodeView.kind === "endpoint" ? 10 : 12;
}

function labelLineHeightFor(nodeView: TopologyNodeView): number {
  return nodeView.kind === "endpoint" ? 11 : 13;
}

function dashFor(
  pattern: string | undefined,
  scale: number,
): Array<number> | undefined {
  if (!pattern) {
    return undefined;
  }
  return pattern
    .trim()
    .split(" ")
    .map((length: string): number => {
      return Number(length) * scale;
    });
}

/**
 * How far the drawing reaches, in layout units: every node's glyph and its
 * label (measured, not estimated), the attention halos, and every hull with
 * its caption, plus a little clearance. Null when nothing is drawn.
 */
export function measureWorldBounds(
  nodeViews: ReadonlyArray<TopologyNodeView>,
  labels: ReadonlyMap<string, DrawnLabel>,
  hulls: ReadonlyArray<TopologyHullView>,
  showHalos: boolean,
  measure: TextMeasure,
): WorldBounds | null {
  if (nodeViews.length === 0) {
    return null;
  }
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;

  for (const nodeView of nodeViews) {
    const footprint: TopologyNodeFootprint = nodeView.footprint;
    const halo: number =
      showHalos && nodeView.isHealthMatch ? haloRadiusFor(footprint) : 0;
    const label: DrawnLabel | undefined = labels.get(nodeView.id);
    const halfInk: number = Math.max(
      footprint.halfWidth,
      halo,
      (label?.widestLine || 0) / 2 + 2,
    );
    minX = Math.min(minX, nodeView.x - halfInk);
    maxX = Math.max(maxX, nodeView.x + halfInk);
    minY = Math.min(minY, nodeView.y - Math.max(footprint.halfHeight, halo));
    maxY = Math.max(
      maxY,
      nodeView.y + Math.max(footprint.labelBottom + LABEL_DESCENT, halo),
    );
  }
  for (const hull of hulls) {
    const captionRight: number = hull.caption
      ? hull.x +
        HULL_CAPTION_OFFSET +
        measure(hull.caption, HULL_CAPTION_FONT_SIZE, true)
      : hull.x;
    minX = Math.min(minX, hull.x);
    maxX = Math.max(maxX, hull.x + hull.width, captionRight);
    minY = Math.min(
      minY,
      hull.caption
        ? hull.y - HULL_CAPTION_OFFSET - HULL_CAPTION_FONT_SIZE
        : hull.y,
    );
    maxY = Math.max(maxY, hull.y + hull.height);
  }
  return {
    minX: minX - DIAGRAM_BOUNDS_PADDING,
    minY: minY - DIAGRAM_BOUNDS_PADDING,
    maxX: maxX + DIAGRAM_BOUNDS_PADDING,
    maxY: maxY + DIAGRAM_BOUNDS_PADDING,
  };
}

/**
 * The drawing's items, in paint order: hulls (and their captions), links,
 * then each node — halo, silhouette, badge, name.
 */
export function buildDiagramItems(
  viewModel: TopologyViewModel,
  hulls: ReadonlyArray<TopologyHullView>,
  labels: ReadonlyMap<string, DrawnLabel>,
  transform: DiagramTransform,
): Array<ExportItem> {
  const s: number = transform.scale;
  const px: (x: number) => number = (x: number): number => {
    return transform.offsetX + x * s;
  };
  const py: (y: number) => number = (y: number): number => {
    return transform.offsetY + y * s;
  };
  const items: Array<ExportItem> = [];

  // Islands and endpoint groups, behind everything.
  for (const hull of hulls) {
    items.push({
      type: "rect",
      tag: `hull:${hull.key}`,
      x: px(hull.x),
      y: py(hull.y),
      width: hull.width * s,
      height: hull.height * s,
      radius: 14 * s,
      fill: blendWithPaper(
        HULL_FILL,
        hull.isDashed ? DASHED_HULL_FILL_OPACITY : HULL_FILL_OPACITY,
      ),
      stroke: {
        color: resolvePrintColor(HULL_STROKE),
        width: 1 * s,
        dash: hull.isDashed ? [5 * s, 4 * s] : undefined,
      },
    });
    if (hull.caption) {
      items.push(
        textItem(
          `hull-caption:${hull.key}`,
          hull.caption,
          px(hull.x + HULL_CAPTION_OFFSET),
          py(hull.y - HULL_CAPTION_OFFSET),
          HULL_CAPTION_FONT_SIZE * s,
          resolvePrintColor(HULL_CAPTION_COLOR),
          { isBold: true },
        ),
      );
    }
  }

  // Links under the nodes, so a node is never covered by a line.
  for (const edgeView of viewModel.edges) {
    const alpha: number = edgeView.isDimmed ? DIMMED_EDGE_OPACITY : 1;
    items.push({
      type: "line",
      tag: `edge:${edgeView.key}`,
      x1: px(edgeView.x1),
      y1: py(edgeView.y1),
      x2: px(edgeView.x2),
      y2: py(edgeView.y2),
      stroke: {
        color: blendWithPaper(edgeView.color, alpha),
        width: edgeView.strokeWidth * s,
        dash: dashFor(edgeView.strokeDashArray, s),
      },
      roundCaps: true,
    });
  }

  const labelColor: string = resolvePrintColor(LABEL_COLOR);
  const haloColor: string = resolvePrintColor(LABEL_HALO_COLOR);

  for (const nodeView of viewModel.nodes) {
    // The live map dims a node by drawing its whole group translucent.
    const alpha: number = nodeView.isDimmed ? DIMMED_NODE_OPACITY : 1;
    const footprint: TopologyNodeFootprint = nodeView.footprint;
    const cx: number = px(nodeView.x);
    const cy: number = py(nodeView.y);

    if (viewModel.isHealthFilterActive && nodeView.isHealthMatch) {
      const color: string = HEALTH_STATE_COLORS[nodeView.health];
      items.push({
        type: "circle",
        tag: `node-halo:${nodeView.id}`,
        cx: cx,
        cy: cy,
        r: haloRadiusFor(footprint) * s,
        fill: blendWithPaper(color, HALO_FILL_OPACITY * alpha),
        stroke: {
          color: blendWithPaper(color, HALO_STROKE_OPACITY * alpha),
          width: Math.max(0.5, 1.5 * s),
        },
      });
    }

    const isEndpoint: boolean = nodeView.kind === "endpoint";
    const fillOpacity: number = isEndpoint
      ? ENDPOINT_FILL_OPACITY
      : nodeView.kind === "device"
        ? DEVICE_FILL_OPACITY
        : 1;
    items.push(
      ...shapeItems(`node-shape:${nodeView.id}`, footprint.shape, cx, cy, s, {
        fill: blendWithPaper(nodeView.fill, fillOpacity * alpha),
        stroke: {
          color: blendWithPaper(nodeView.stroke, alpha),
          width: (isEndpoint ? 1.5 : 2) * s,
          dash: dashFor(nodeView.strokeDashArray, s),
        },
      }),
    );

    if (nodeView.badge) {
      items.push(
        textItem(
          `node-badge:${nodeView.id}`,
          nodeView.badge,
          cx,
          py(nodeView.y + footprint.shape.badgeBaselineOffset),
          9 * s,
          blendWithPaper(
            nodeView.kind === "device" ? DEVICE_BADGE_COLOR : labelColor,
            alpha,
          ),
          { isBold: true, align: "center" },
        ),
      );
    }

    const lines: Array<string> = labels.get(nodeView.id)?.lines || [];
    const fontSize: number = labelFontSizeFor(nodeView);
    const lineHeight: number = labelLineHeightFor(nodeView);
    for (let lineIndex: number = 0; lineIndex < lines.length; lineIndex++) {
      items.push({
        ...textItem(
          `node-label:${nodeView.id}`,
          lines[lineIndex]!,
          cx,
          py(
            nodeView.y + footprint.labelBaselineOffset + lineIndex * lineHeight,
          ),
          fontSize * s,
          blendWithPaper(labelColor, alpha),
          { align: "center" },
        ),
        halo: { color: haloColor, width: 3 * s },
      });
    }
  }

  return items;
}
