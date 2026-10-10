/*
 * The drawing vocabulary of the topology PDF: what a laid-out page is made
 * of, in points, with the origin at the page's top-left corner and y running
 * down (the same way jsPDF draws).
 *
 * The layout modules (ExportChrome, ExportDiagram, ExportTables) produce
 * these; NetworkTopologyPdfPainter turns them into PDF drawing calls. Every
 * item carries a tag naming what it draws, which the painter ignores and the
 * tests read.
 */

export type ExportTextAlign = "left" | "center" | "right";

export interface ExportStroke {
  color: string;
  width: number;
  // Dash and gap lengths in points; absent for a solid line.
  dash?: Array<number> | undefined;
}

interface ExportItemBase {
  // What the item draws ("node-shape:<id>", "edge:<key>", "legend-text"...).
  tag: string;
}

export interface ExportRectItem extends ExportItemBase {
  type: "rect";
  x: number;
  y: number;
  width: number;
  height: number;
  radius: number;
  fill?: string | undefined;
  stroke?: ExportStroke | undefined;
}

export interface ExportCircleItem extends ExportItemBase {
  type: "circle";
  cx: number;
  cy: number;
  r: number;
  fill?: string | undefined;
  stroke?: ExportStroke | undefined;
}

export interface ExportPathCommand {
  // "m" move, "l" line, "c" cubic Bézier (two control points, then the end).
  op: "m" | "l" | "c";
  points: Array<number>;
}

export interface ExportPathItem extends ExportItemBase {
  type: "path";
  commands: Array<ExportPathCommand>;
  closed: boolean;
  fill?: string | undefined;
  stroke?: ExportStroke | undefined;
}

export interface ExportLineItem extends ExportItemBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  stroke: ExportStroke;
  roundCaps: boolean;
}

export interface ExportTextItem extends ExportItemBase {
  type: "text";
  x: number;
  // The baseline.
  y: number;
  text: string;
  fontSize: number;
  isBold: boolean;
  color: string;
  align: ExportTextAlign;
  /*
   * A paper-coloured outline drawn behind the glyphs, which keeps a device
   * name readable where it crosses a link — the live map does the same with
   * paint-order: stroke.
   */
  halo?: { color: string; width: number } | undefined;
}

export type ExportItem =
  | ExportRectItem
  | ExportCircleItem
  | ExportPathItem
  | ExportLineItem
  | ExportTextItem;

export type ExportPageKind = "diagram" | "table";

export interface ExportPage {
  kind: ExportPageKind;
  width: number;
  height: number;
  items: Array<ExportItem>;
}

/** A laid-out block of items and how tall it came out. */
export interface ExportBlock {
  items: Array<ExportItem>;
  height: number;
}

export const A4_SHORT_SIDE: number = 595.28;
export const A4_LONG_SIDE: number = 841.89;
export const PAGE_MARGIN: number = 36;

/*
 * The page's own palette (the map brings its own): the greys the dashboard
 * draws text and rules with, and the product's indigo for the one accent.
 */
export const PDF_INK: {
  heading: string;
  text: string;
  secondary: string;
  muted: string;
  faint: string;
  rule: string;
  surface: string;
  accent: string;
  warning: string;
} = {
  heading: "#111827",
  text: "#374151",
  secondary: "#4b5563",
  muted: "#6b7280",
  faint: "#9ca3af",
  rule: "#e5e7eb",
  surface: "#f9fafb",
  accent: "#4f46e5",
  warning: "#b45309",
};

// Helvetica's ascender as a fraction of the font size: top of line to baseline.
const ASCENT_RATIO: number = 0.78;

/** The baseline of a line of text whose box starts at `top`. */
export function baselineFor(top: number, fontSize: number): number {
  return top + fontSize * ASCENT_RATIO;
}

export function textItem(
  tag: string,
  text: string,
  x: number,
  y: number,
  fontSize: number,
  color: string,
  options?: {
    isBold?: boolean | undefined;
    align?: ExportTextAlign | undefined;
  },
): ExportTextItem {
  return {
    type: "text",
    tag: tag,
    x: x,
    y: y,
    text: text,
    fontSize: fontSize,
    isBold: Boolean(options?.isBold),
    color: color,
    align: options?.align || "left",
  };
}

function scaleStroke(
  stroke: ExportStroke | undefined,
  factor: number,
): ExportStroke | undefined {
  if (!stroke) {
    return undefined;
  }
  return {
    color: stroke.color,
    width: stroke.width * factor,
    dash: stroke.dash
      ? stroke.dash.map((length: number): number => {
          return length * factor;
        })
      : undefined,
  };
}

/**
 * One item enlarged by `factor` about the page's top-left corner, then moved
 * by (dx, dy). Sizes, line widths, dashes and fonts scale with it.
 */
export function transformExportItem(
  item: ExportItem,
  factor: number,
  dx: number = 0,
  dy: number = 0,
): ExportItem {
  if (factor === 1 && dx === 0 && dy === 0) {
    return item;
  }
  switch (item.type) {
    case "rect":
      return {
        ...item,
        x: item.x * factor + dx,
        y: item.y * factor + dy,
        width: item.width * factor,
        height: item.height * factor,
        radius: item.radius * factor,
        stroke: scaleStroke(item.stroke, factor),
      };
    case "circle":
      return {
        ...item,
        cx: item.cx * factor + dx,
        cy: item.cy * factor + dy,
        r: item.r * factor,
        stroke: scaleStroke(item.stroke, factor),
      };
    case "path":
      return {
        ...item,
        commands: item.commands.map(
          (command: ExportPathCommand): ExportPathCommand => {
            return {
              op: command.op,
              points: command.points.map(
                (value: number, index: number): number => {
                  return value * factor + (index % 2 === 0 ? dx : dy);
                },
              ),
            };
          },
        ),
        stroke: scaleStroke(item.stroke, factor),
      };
    case "line":
      return {
        ...item,
        x1: item.x1 * factor + dx,
        y1: item.y1 * factor + dy,
        x2: item.x2 * factor + dx,
        y2: item.y2 * factor + dy,
        stroke: scaleStroke(item.stroke, factor) as ExportStroke,
      };
    case "text":
      return {
        ...item,
        x: item.x * factor + dx,
        y: item.y * factor + dy,
        fontSize: item.fontSize * factor,
        halo: item.halo
          ? { color: item.halo.color, width: item.halo.width * factor }
          : undefined,
      };
    default:
      return item;
  }
}
