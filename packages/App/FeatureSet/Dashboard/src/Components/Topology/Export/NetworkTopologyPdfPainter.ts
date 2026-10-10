import {
  ExportItem,
  ExportLineItem,
  ExportPage,
  ExportPathCommand,
  ExportPathItem,
  ExportStroke,
  ExportTextItem,
} from "./ExportItems";
import { NetworkTopologyExportDocument } from "./NetworkTopologyExportDocument";

/*
 * Draws a laid-out export (NetworkTopologyExportDocument) onto a PDF.
 *
 * Deliberately dumb: every decision about what goes where was made by the
 * pure layout, so this only maps items to drawing calls. It talks to the
 * PDF through TopologyPdfCanvas — the handful of jsPDF methods it uses —
 * rather than to jsPDF itself, so it carries no dependency on the library
 * (which the dashboard loads on demand) and App/Tests can run it against a
 * recorder.
 *
 * It is asynchronous for one reason: a large network is tens of thousands of
 * items, and drawing them in one go would freeze the tab. It hands control
 * back to the browser every few thousand items, so the page keeps painting
 * and the button keeps spinning while the PDF is built.
 */

export type TopologyPdfDrawStyle = "F" | "S" | "FD";

export interface TopologyPdfTextOptions {
  align: "left" | "center" | "right";
  baseline: "alphabetic";
  renderingMode?: "stroke" | undefined;
}

/** The subset of jsPDF's API the painter draws with. */
export interface TopologyPdfCanvas {
  addPage: (format: Array<number>, orientation: "p" | "l") => unknown;
  setProperties: (properties: {
    title: string;
    subject: string;
    keywords: string;
  }) => unknown;
  setFillColor: (color: string) => unknown;
  setDrawColor: (color: string) => unknown;
  setTextColor: (color: string) => unknown;
  setLineWidth: (width: number) => unknown;
  setLineDashPattern: (dash: Array<number>, phase: number) => unknown;
  setLineCap: (style: "butt" | "round") => unknown;
  setLineJoin: (style: "miter" | "round") => unknown;
  setFont: (fontName: string, fontStyle: string) => unknown;
  setFontSize: (size: number) => unknown;
  text: (
    text: string,
    x: number,
    y: number,
    options: TopologyPdfTextOptions,
  ) => unknown;
  rect: (
    x: number,
    y: number,
    width: number,
    height: number,
    style: TopologyPdfDrawStyle,
  ) => unknown;
  roundedRect: (
    x: number,
    y: number,
    width: number,
    height: number,
    rx: number,
    ry: number,
    style: TopologyPdfDrawStyle,
  ) => unknown;
  circle: (
    x: number,
    y: number,
    r: number,
    style: TopologyPdfDrawStyle,
  ) => unknown;
  line: (x1: number, y1: number, x2: number, y2: number) => unknown;
  moveTo: (x: number, y: number) => unknown;
  lineTo: (x: number, y: number) => unknown;
  curveTo: (
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    x3: number,
    y3: number,
  ) => unknown;
  close: () => unknown;
  fill: () => unknown;
  stroke: () => unknown;
  fillStroke: () => unknown;
}

export interface PaintOptions {
  /*
   * Resolves once the browser has had a chance to paint. Defaults to a
   * zero-delay timeout; the tests pass one that records the pauses.
   */
  yieldToBrowser?: (() => Promise<void>) | undefined;
  // How many items are drawn between two pauses.
  itemsPerSlice?: number | undefined;
}

export const DEFAULT_ITEMS_PER_SLICE: number = 2500;

export const PDF_FONT_NAME: string = "helvetica";

const yieldWithTimeout: () => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 0);
  });
};

/*
 * The state the canvas was last set to, so a long run of items in the same
 * colour writes the colour once. jsPDF writes an operator for every setter
 * call, and on a large map most of them would repeat the one before. Forgot
 * at each new page: a page's content starts from the default state.
 */
class CanvasState {
  private fillColor: string | null = null;
  private drawColor: string | null = null;
  private textColor: string | null = null;
  private lineWidth: number | null = null;
  private dashKey: string | null = null;
  private lineCap: string | null = null;
  private lineJoin: string | null = null;
  private fontKey: string | null = null;

  public constructor(private readonly canvas: TopologyPdfCanvas) {}

  public reset(): void {
    this.fillColor = null;
    this.drawColor = null;
    this.textColor = null;
    this.lineWidth = null;
    this.dashKey = null;
    this.lineCap = null;
    this.lineJoin = null;
    this.fontKey = null;
  }

  public fill(color: string): void {
    if (this.fillColor !== color) {
      this.canvas.setFillColor(color);
      this.fillColor = color;
    }
  }

  public text(color: string): void {
    if (this.textColor !== color) {
      this.canvas.setTextColor(color);
      this.textColor = color;
    }
  }

  /*
   * PDF fills glyphs with the FILL colour, so jsPDF writes the text colour
   * as the fill colour inside every text call — and it stays set after the
   * text. The next shape must set its own fill again, or it is painted in
   * the colour of the label before it.
   */
  public afterText(): void {
    this.fillColor = null;
  }

  public stroke(stroke: ExportStroke): void {
    if (this.drawColor !== stroke.color) {
      this.canvas.setDrawColor(stroke.color);
      this.drawColor = stroke.color;
    }
    if (this.lineWidth !== stroke.width) {
      this.canvas.setLineWidth(stroke.width);
      this.lineWidth = stroke.width;
    }
    const dash: Array<number> = stroke.dash || [];
    const dashKey: string = dash.join(",");
    if (this.dashKey !== dashKey) {
      this.canvas.setLineDashPattern(dash, 0);
      this.dashKey = dashKey;
    }
  }

  public cap(style: "butt" | "round"): void {
    if (this.lineCap !== style) {
      this.canvas.setLineCap(style);
      this.lineCap = style;
    }
  }

  public join(style: "miter" | "round"): void {
    if (this.lineJoin !== style) {
      this.canvas.setLineJoin(style);
      this.lineJoin = style;
    }
  }

  public font(isBold: boolean, size: number): void {
    const key: string = `${isBold ? "bold" : "normal"}:${size}`;
    if (this.fontKey !== key) {
      this.canvas.setFont(PDF_FONT_NAME, isBold ? "bold" : "normal");
      this.canvas.setFontSize(size);
      this.fontKey = key;
    }
  }
}

function styleFor(
  fill: string | undefined,
  stroke: ExportStroke | undefined,
): TopologyPdfDrawStyle | null {
  if (fill && stroke) {
    return "FD";
  }
  if (fill) {
    return "F";
  }
  if (stroke) {
    return "S";
  }
  return null;
}

function applyPaint(
  state: CanvasState,
  fill: string | undefined,
  stroke: ExportStroke | undefined,
): void {
  if (fill) {
    state.fill(fill);
  }
  if (stroke) {
    state.stroke(stroke);
  }
}

function paintPath(
  canvas: TopologyPdfCanvas,
  state: CanvasState,
  item: ExportPathItem,
): void {
  const style: TopologyPdfDrawStyle | null = styleFor(item.fill, item.stroke);
  if (!style || item.commands.length === 0) {
    return;
  }
  applyPaint(state, item.fill, item.stroke);
  state.join("round");
  for (const command of item.commands) {
    paintPathCommand(canvas, command);
  }
  if (item.closed) {
    canvas.close();
  }
  if (style === "FD") {
    canvas.fillStroke();
  } else if (style === "F") {
    canvas.fill();
  } else {
    canvas.stroke();
  }
}

function paintPathCommand(
  canvas: TopologyPdfCanvas,
  command: ExportPathCommand,
): void {
  const p: Array<number> = command.points;
  if (command.op === "m") {
    canvas.moveTo(p[0] || 0, p[1] || 0);
  } else if (command.op === "l") {
    canvas.lineTo(p[0] || 0, p[1] || 0);
  } else {
    canvas.curveTo(
      p[0] || 0,
      p[1] || 0,
      p[2] || 0,
      p[3] || 0,
      p[4] || 0,
      p[5] || 0,
    );
  }
}

function paintLine(
  state: CanvasState,
  canvas: TopologyPdfCanvas,
  item: ExportLineItem,
): void {
  state.stroke(item.stroke);
  state.cap(item.roundCaps ? "round" : "butt");
  canvas.line(item.x1, item.y1, item.x2, item.y2);
}

function paintText(
  canvas: TopologyPdfCanvas,
  state: CanvasState,
  item: ExportTextItem,
): void {
  if (!item.text) {
    return;
  }
  state.font(item.isBold, item.fontSize);
  if (item.halo) {
    // The paper-coloured outline first, so the glyphs sit on top of it.
    state.stroke({ color: item.halo.color, width: item.halo.width });
    state.join("round");
    canvas.text(item.text, item.x, item.y, {
      align: item.align,
      baseline: "alphabetic",
      renderingMode: "stroke",
    });
  }
  state.text(item.color);
  canvas.text(item.text, item.x, item.y, {
    align: item.align,
    baseline: "alphabetic",
  });
  state.afterText();
}

/** Draws one item. Exported for the tests. */
export function paintExportItem(
  canvas: TopologyPdfCanvas,
  state: CanvasState,
  item: ExportItem,
): void {
  switch (item.type) {
    case "rect": {
      const style: TopologyPdfDrawStyle | null = styleFor(
        item.fill,
        item.stroke,
      );
      if (!style) {
        return;
      }
      applyPaint(state, item.fill, item.stroke);
      state.join("round");
      if (item.radius > 0) {
        canvas.roundedRect(
          item.x,
          item.y,
          item.width,
          item.height,
          item.radius,
          item.radius,
          style,
        );
      } else {
        canvas.rect(item.x, item.y, item.width, item.height, style);
      }
      return;
    }
    case "circle": {
      const style: TopologyPdfDrawStyle | null = styleFor(
        item.fill,
        item.stroke,
      );
      if (!style) {
        return;
      }
      applyPaint(state, item.fill, item.stroke);
      canvas.circle(item.cx, item.cy, item.r, style);
      return;
    }
    case "path":
      paintPath(canvas, state, item);
      return;
    case "line":
      paintLine(state, canvas, item);
      return;
    case "text":
      paintText(canvas, state, item);
      return;
    default:
      return;
  }
}

export function createCanvasState(canvas: TopologyPdfCanvas): CanvasState {
  return new CanvasState(canvas);
}

function orientationOf(page: ExportPage): "p" | "l" {
  return page.width > page.height ? "l" : "p";
}

/**
 * Draws every page of `document` onto `canvas`, whose first page must
 * already have the size of the document's first page (jsPDF creates it
 * with the document). Later pages are added at their own size.
 */
export async function paintNetworkTopologyDocument(
  canvas: TopologyPdfCanvas,
  document: NetworkTopologyExportDocument,
  options?: PaintOptions | undefined,
): Promise<void> {
  const yieldToBrowser: () => Promise<void> =
    options?.yieldToBrowser || yieldWithTimeout;
  const itemsPerSlice: number = Math.max(
    1,
    Math.floor(options?.itemsPerSlice || DEFAULT_ITEMS_PER_SLICE),
  );

  canvas.setProperties({
    title: document.title,
    subject: document.subject,
    keywords: "network topology",
  });

  const state: CanvasState = new CanvasState(canvas);
  let sinceLastPause: number = 0;

  for (
    let pageIndex: number = 0;
    pageIndex < document.pages.length;
    pageIndex++
  ) {
    const page: ExportPage = document.pages[pageIndex]!;
    if (pageIndex > 0) {
      canvas.addPage([page.width, page.height], orientationOf(page));
      await yieldToBrowser();
      sinceLastPause = 0;
    }
    state.reset();
    for (const item of page.items) {
      paintExportItem(canvas, state, item);
      sinceLastPause++;
      if (sinceLastPause >= itemsPerSlice) {
        await yieldToBrowser();
        sinceLastPause = 0;
      }
    }
  }
}

export type { CanvasState };
