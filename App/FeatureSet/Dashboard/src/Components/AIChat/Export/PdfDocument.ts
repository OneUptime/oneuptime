import type { jsPDF } from "jspdf";
import { SanitizedText, sanitizeForPdf } from "./PdfText";

/*
 * A thin layout engine over jsPDF.
 *
 * jsPDF draws where you tell it and nothing more: no text wrapping, no flow, no
 * page breaks. This class owns the y cursor and the "will it fit" bookkeeping so
 * the widget and markdown renderers can think in blocks instead of coordinates.
 *
 * Everything is in points, and the document is created in points too. That is
 * deliberate: setFontSize is always in points regardless of the document unit,
 * so any other unit turns every height calculation into a scale-factor
 * conversion, and jspdf-autotable's own defaults are point-derived as well.
 */

export const PAGE_MARGIN: {
  top: number;
  right: number;
  bottom: number;
  left: number;
} = { top: 54, right: 46, bottom: 54, left: 46 };

export type PdfFontStyle = "normal" | "bold" | "italic" | "bolditalic";

export interface PdfTextStyle {
  size: number;
  fontStyle?: PdfFontStyle | undefined;
  color?: string | undefined;
}

// The greys the chat itself uses, so the export reads like the product.
export const PDF_COLORS: {
  text: string;
  muted: string;
  faint: string;
  heading: string;
  border: string;
  subtleBorder: string;
  surface: string;
  codeSurface: string;
  error: string;
  accent: string;
} = {
  text: "#374151",
  muted: "#6b7280",
  faint: "#9ca3af",
  heading: "#111827",
  border: "#e5e7eb",
  subtleBorder: "#f3f4f6",
  surface: "#f9fafb",
  codeSurface: "#f8fafc",
  error: "#be123c",
  accent: "#111827",
};

export default class PdfDocument {
  public readonly doc: jsPDF;
  public y: number;

  /*
   * Set when any string had to be transliterated or dropped to fit the core
   * font's Latin-1 encoding, so the document can disclose it on the last page.
   */
  public isLossy: boolean = false;

  public constructor(doc: jsPDF) {
    this.doc = doc;
    this.y = PAGE_MARGIN.top;
  }

  public get pageWidth(): number {
    return this.doc.internal.pageSize.getWidth();
  }

  public get pageHeight(): number {
    return this.doc.internal.pageSize.getHeight();
  }

  public get left(): number {
    return PAGE_MARGIN.left;
  }

  public get right(): number {
    return this.pageWidth - PAGE_MARGIN.right;
  }

  public get contentWidth(): number {
    return this.pageWidth - PAGE_MARGIN.left - PAGE_MARGIN.right;
  }

  public get bottomLimit(): number {
    return this.pageHeight - PAGE_MARGIN.bottom;
  }

  public get remainingHeight(): number {
    return this.bottomLimit - this.y;
  }

  /*
   * The page being drawn on. Lets callers that capture an origin detect that a
   * page break happened underneath them and re-anchor.
   */
  public get currentPage(): number {
    return this.doc.getCurrentPageInfo().pageNumber;
  }

  // Runs text through the Latin-1 sanitizer, remembering if anything was lost.
  public sanitize(text: string): string {
    const result: SanitizedText = sanitizeForPdf(text);
    if (result.isLossy) {
      this.isLossy = true;
    }
    return result.text;
  }

  public setStyle(style: PdfTextStyle): void {
    this.doc.setFont("helvetica", style.fontStyle || "normal");
    this.doc.setFontSize(style.size);
    this.doc.setTextColor(style.color || PDF_COLORS.text);
  }

  public lineHeight(size: number, factor: number = 1.25): number {
    return size * factor;
  }

  public addPage(): void {
    this.doc.addPage();
    this.y = PAGE_MARGIN.top;
  }

  /*
   * Ensures `height` points are available, breaking the page if not. Call this
   * per atomic unit — a single line, a single row — not per block, or long
   * blocks will refuse to break and overflow instead.
   */
  public ensureSpace(height: number): void {
    if (this.y + height > this.bottomLimit) {
      this.addPage();
    }
  }

  public moveDown(points: number): void {
    this.y += points;
  }

  public wrap(text: string, maxWidth: number): Array<string> {
    if (!text) {
      return [];
    }
    /*
     * splitTextToSize measures with whatever font state is current, so callers
     * must setStyle() before wrapping or the wrap width will be wrong.
     */
    return this.doc.splitTextToSize(text, maxWidth) as Array<string>;
  }

  public textWidth(text: string): number {
    return this.doc.getTextWidth(text);
  }

  /*
   * Draws a single pre-wrapped line. baseline "top" means y is the top edge of
   * the line box rather than the glyph baseline, which keeps cursor arithmetic
   * honest.
   */
  public drawLine(
    text: string,
    x: number,
    y: number,
    options?: { align?: "left" | "center" | "right" | undefined } | undefined,
  ): void {
    this.doc.text(text, x, y, {
      baseline: "top",
      align: options?.align || "left",
    });
  }

  /*
   * Wraps and draws a block of text at the cursor, breaking pages as needed.
   * Returns the height consumed.
   */
  public paragraph(
    text: string,
    style: PdfTextStyle,
    options?:
      | {
          x?: number | undefined;
          maxWidth?: number | undefined;
          gapAfter?: number | undefined;
          indent?: number | undefined;
        }
      | undefined,
  ): void {
    const indent: number = options?.indent || 0;
    const x: number = (options?.x ?? this.left) + indent;
    const maxWidth: number = (options?.maxWidth ?? this.contentWidth) - indent;

    this.setStyle(style);

    const lineHeight: number = this.lineHeight(style.size);
    const lines: Array<string> = this.wrap(this.sanitize(text), maxWidth);

    for (const line of lines) {
      this.ensureSpace(lineHeight);
      // Re-assert the style: a page break can leave jsPDF on another state.
      this.setStyle(style);
      this.drawLine(line, x, this.y);
      this.y += lineHeight;
    }

    this.moveDown(options?.gapAfter ?? 0);
  }

  public rect(
    x: number,
    y: number,
    width: number,
    height: number,
    options: {
      fill?: string | undefined;
      stroke?: string | undefined;
      radius?: number | undefined;
      lineWidth?: number | undefined;
    },
  ): void {
    if (options.fill) {
      this.doc.setFillColor(options.fill);
    }
    if (options.stroke) {
      this.doc.setDrawColor(options.stroke);
    }
    this.doc.setLineWidth(options.lineWidth ?? 0.5);

    const style: string =
      options.fill && options.stroke ? "FD" : options.fill ? "F" : "S";

    if (options.radius && options.radius > 0) {
      // A radius over half the box produces artifacts in jsPDF; clamp it.
      const radius: number = Math.min(
        options.radius,
        width / 2,
        Math.abs(height) / 2,
      );
      this.doc.roundedRect(x, y, width, height, radius, radius, style);
      return;
    }

    this.doc.rect(x, y, width, height, style);
  }

  public hairline(
    x1: number,
    y1: number,
    x2: number,
    y2: number,
    color: string,
  ): void {
    this.doc.setDrawColor(color);
    this.doc.setLineWidth(0.5);
    this.doc.line(x1, y1, x2, y2);
  }

  public circle(x: number, y: number, radius: number, fill: string): void {
    this.doc.setFillColor(fill);
    this.doc.circle(x, y, radius, "F");
  }

  /*
   * Draws page numbers, and the transliteration notice if anything was lost.
   * Runs as a final pass once the total page count is known.
   */
  public stampFooters(): void {
    const total: number = this.doc.getNumberOfPages();

    for (let page: number = 1; page <= total; page++) {
      this.doc.setPage(page);
      this.doc.setFont("helvetica", "normal");
      this.doc.setFontSize(8);
      this.doc.setTextColor(PDF_COLORS.faint);

      this.doc.text(
        `Page ${page} of ${total}`,
        this.pageWidth - PAGE_MARGIN.right,
        this.pageHeight - PAGE_MARGIN.bottom + 24,
        { baseline: "top", align: "right" },
      );

      this.doc.text(
        "Exported from OneUptime",
        PAGE_MARGIN.left,
        this.pageHeight - PAGE_MARGIN.bottom + 24,
        { baseline: "top" },
      );
    }

    if (this.isLossy) {
      this.doc.setPage(total);
      this.doc.setFontSize(7);
      this.doc.setTextColor(PDF_COLORS.faint);
      this.doc.text(
        "Some characters (emoji or non-Latin script) could not be rendered in this PDF and were replaced. See the Markdown export for the exact text.",
        PAGE_MARGIN.left,
        this.pageHeight - PAGE_MARGIN.bottom + 36,
        { baseline: "top", maxWidth: this.contentWidth },
      );
    }
  }
}
