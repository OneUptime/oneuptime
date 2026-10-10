import { TopologyNodeFootprint } from "../../NetworkDevice/TopologyFootprint";
import {
  TopologyNodeView,
  TopologyViewModel,
} from "../NetworkTopologyViewModel";
import { HEALTH_STATE_COLORS } from "../TopologyHealthFilter";
import {
  TOPOLOGY_DRAWING_STYLE,
  TopologyHullView,
  attentionHaloRadiusFor,
  glyphFillOpacityFor,
  glyphStrokeWidthFor,
  labelFontSizeFor,
  labelLineHeightFor,
} from "../NetworkTopologyDrawing";
import { resolvePrintColor } from "./ExportColor";
import { ExportItem, textItem } from "./ExportItems";
import { shapeItems } from "./ExportShapes";
import { TextMeasure } from "./ExportText";

/*
 * The map itself, on paper.
 *
 * Everything here is one decision of the live canvas (NetworkDeviceGraph),
 * read from the same place (TOPOLOGY_DRAWING_STYLE and the helpers beside
 * it): hulls behind links behind nodes; a node as its attention ring, its
 * silhouette, its interface badge and its wrapped name; the same colours,
 * opacities, stroke widths and dash patterns, in layout units scaled to
 * points. What the canvas draws see-through — a dimmed device, a hull, an
 * attention ring — the page draws see-through too, so a link under a faded
 * device is still there on paper.
 */

// Room kept under a label's last baseline for descenders, in layout units.
const LABEL_DESCENT: number = 4;
// Clearance around the drawing inside the frame, in layout units.
const DIAGRAM_BOUNDS_PADDING: number = 8;

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
 * label (measured, not estimated), the attention rings, and every hull with
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
  const style: typeof TOPOLOGY_DRAWING_STYLE = TOPOLOGY_DRAWING_STYLE;
  let minX: number = Infinity;
  let minY: number = Infinity;
  let maxX: number = -Infinity;
  let maxY: number = -Infinity;

  for (const nodeView of nodeViews) {
    const footprint: TopologyNodeFootprint = nodeView.footprint;
    const halo: number =
      showHalos && nodeView.isHealthMatch
        ? attentionHaloRadiusFor(footprint)
        : 0;
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
        style.hullCaptionOffset +
        measure(hull.caption, style.hullCaptionFontSize, true)
      : hull.x;
    minX = Math.min(minX, hull.x);
    maxX = Math.max(maxX, hull.x + hull.width, captionRight);
    minY = Math.min(
      minY,
      hull.caption
        ? hull.y - style.hullCaptionOffset - style.hullCaptionFontSize
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
 * then each node — attention ring, silhouette, badge, name.
 */
export function buildDiagramItems(
  viewModel: TopologyViewModel,
  hulls: ReadonlyArray<TopologyHullView>,
  labels: ReadonlyMap<string, DrawnLabel>,
  transform: DiagramTransform,
): Array<ExportItem> {
  const style: typeof TOPOLOGY_DRAWING_STYLE = TOPOLOGY_DRAWING_STYLE;
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
      radius: style.hullCornerRadius * s,
      fill: resolvePrintColor(style.hullFill),
      fillOpacity: hull.isDashed
        ? style.dashedHullFillOpacity
        : style.hullFillOpacity,
      stroke: {
        color: resolvePrintColor(style.hullStroke),
        width: style.hullStrokeWidth * s,
        dash: hull.isDashed ? dashFor(style.hullDash, s) : undefined,
      },
    });
    if (hull.caption) {
      items.push(
        textItem(
          `hull-caption:${hull.key}`,
          hull.caption,
          px(hull.x + style.hullCaptionOffset),
          py(hull.y - style.hullCaptionOffset),
          style.hullCaptionFontSize * s,
          resolvePrintColor(style.hullCaptionColor),
          { isBold: true },
        ),
      );
    }
  }

  // Links under the nodes, so a node is never covered by a line.
  for (const edgeView of viewModel.edges) {
    items.push({
      type: "line",
      tag: `edge:${edgeView.key}`,
      x1: px(edgeView.x1),
      y1: py(edgeView.y1),
      x2: px(edgeView.x2),
      y2: py(edgeView.y2),
      stroke: {
        color: resolvePrintColor(edgeView.color),
        width: edgeView.strokeWidth * s,
        dash: dashFor(edgeView.strokeDashArray, s),
      },
      strokeOpacity: edgeView.isDimmed ? style.dimmedEdgeOpacity : 1,
      roundCaps: true,
    });
  }

  const labelColor: string = resolvePrintColor(style.labelColor);
  const haloColor: string = resolvePrintColor(style.labelHaloColor);

  for (const nodeView of viewModel.nodes) {
    // The live map dims a device by drawing all of it see-through.
    const opacity: number = nodeView.isDimmed ? style.dimmedNodeOpacity : 1;
    const footprint: TopologyNodeFootprint = nodeView.footprint;
    const cx: number = px(nodeView.x);
    const cy: number = py(nodeView.y);

    if (viewModel.isHealthFilterActive && nodeView.isHealthMatch) {
      const color: string = resolvePrintColor(
        HEALTH_STATE_COLORS[nodeView.health],
      );
      items.push({
        type: "circle",
        tag: `node-halo:${nodeView.id}`,
        cx: cx,
        cy: cy,
        r: attentionHaloRadiusFor(footprint) * s,
        fill: color,
        fillOpacity: style.attentionHaloFillOpacity * opacity,
        stroke: { color: color, width: Math.max(0.5, 1.5 * s) },
        strokeOpacity: style.attentionHaloStrokeOpacity * opacity,
      });
    }

    for (const item of shapeItems(
      `node-shape:${nodeView.id}`,
      footprint.shape,
      cx,
      cy,
      s,
      {
        fill: resolvePrintColor(nodeView.fill),
        stroke: {
          color: resolvePrintColor(nodeView.stroke),
          width: glyphStrokeWidthFor(nodeView.kind) * s,
          dash: dashFor(nodeView.strokeDashArray, s),
        },
      },
    )) {
      items.push({
        ...item,
        fillOpacity: glyphFillOpacityFor(nodeView.kind) * opacity,
        strokeOpacity: opacity,
      });
    }

    if (nodeView.badge) {
      items.push({
        ...textItem(
          `node-badge:${nodeView.id}`,
          nodeView.badge,
          cx,
          py(nodeView.y + footprint.shape.badgeBaselineOffset),
          style.badgeFontSize * s,
          resolvePrintColor(
            nodeView.kind === "device" ? style.deviceBadgeColor : labelColor,
          ),
          { isBold: true, align: "center" },
        ),
        fillOpacity: opacity,
      });
    }

    const lines: Array<string> = labels.get(nodeView.id)?.lines || [];
    const fontSize: number = labelFontSizeFor(nodeView.kind);
    const lineHeight: number = labelLineHeightFor(nodeView.kind);
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
          labelColor,
          { align: "center" },
        ),
        halo: { color: haloColor, width: style.labelHaloWidth * s },
        fillOpacity: opacity,
        strokeOpacity: opacity,
      });
    }
  }

  return items;
}
