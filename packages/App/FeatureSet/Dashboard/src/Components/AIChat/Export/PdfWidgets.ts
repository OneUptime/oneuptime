import {
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
} from "Common/Types/AI/AIChatTypes";
import { JSONObject } from "Common/Types/JSON";
import {
  EntityListEntry,
  MAX_ENTITY_ITEMS,
  MAX_SPANS,
  MAX_TABLE_ROWS,
  SpanBarMetrics,
  buildParentBySpanId,
  computeSpanBar,
  computeSpanDepth,
  formatStatValue,
  formatTableCell,
  isChartWidget,
  isEntityListWidget,
  toEntityListEntry,
  totalTraceDuration,
} from "Common/UI/Utils/AIChatExport/ChatWidgetData";
import PdfChart, { CHART_BLOCK_HEIGHT } from "./PdfChart";
import PdfDocument, { PDF_COLORS } from "./PdfDocument";
import { PdfTable } from "./PdfTable";

/*
 * Draws the inline widgets an assistant message produced.
 *
 * Each widget is rebuilt from its typed data rather than captured from the
 * screen, so the numbers, captions, ordering and display caps all come from the
 * same helpers the components use (ChatWidgetData). Where the chat's card
 * chrome exists only to bound a scrolling column — the surrounding border, the
 * "Open" button — it is dropped: a border that cannot survive a page break adds
 * nothing, and a button that cannot be clicked is a lie on paper.
 */

const TITLE_SIZE: number = 9.5;
const BODY_SIZE: number = 8.5;
const SMALL_SIZE: number = 7.5;

export default class PdfWidgets {
  private readonly pdf: PdfDocument;
  private readonly table: PdfTable;
  private readonly chart: PdfChart;

  public constructor(pdf: PdfDocument, table: PdfTable) {
    this.pdf = pdf;
    this.table = table;
    this.chart = new PdfChart(pdf);
  }

  /*
   * Roughly what drawHeader consumes: the title line, an optional description,
   * and the rule beneath them.
   */
  private headerHeight(widget: AIChatWidget): number {
    return 25 + (widget.description ? 10 : 0);
  }

  /*
   * How much of a widget's body must fit alongside its title for the pair to be
   * worth starting on this page. A chart is atomic, so it is the whole plot;
   * for the row-based widgets a couple of rows is enough to prove the title is
   * not stranded on its own.
   */
  private minimumBodyHeight(widget: AIChatWidget): number {
    if (isChartWidget(widget.type)) {
      return CHART_BLOCK_HEIGHT;
    }
    if (widget.type === AIChatWidgetType.StatCards) {
      return 44;
    }
    if (widget.type === AIChatWidgetType.ResourceCard) {
      return 56;
    }
    return 42;
  }

  private drawHeader(widget: AIChatWidget): void {
    this.pdf.moveDown(4);

    this.pdf.paragraph(widget.title, {
      size: TITLE_SIZE,
      fontStyle: "bold",
      color: PDF_COLORS.heading,
    });

    if (widget.description) {
      this.pdf.paragraph(widget.description, {
        size: SMALL_SIZE,
        color: PDF_COLORS.faint,
      });
    }

    this.pdf.moveDown(2);
    this.pdf.hairline(
      this.pdf.left,
      this.pdf.y,
      this.pdf.right,
      this.pdf.y,
      PDF_COLORS.border,
    );
    this.pdf.moveDown(7);
  }

  private drawEmpty(text: string): void {
    this.pdf.paragraph(text, { size: BODY_SIZE, color: PDF_COLORS.faint });
    this.pdf.moveDown(2);
  }

  private drawTable(widget: AIChatWidget): void {
    const columns: Array<AIChatWidgetColumn> = widget.data.columns || [];
    const allRows: Array<JSONObject> = widget.data.rows || [];
    const rows: Array<JSONObject> = allRows.slice(0, MAX_TABLE_ROWS);

    if (columns.length === 0 || rows.length === 0) {
      this.drawEmpty("No rows.");
      return;
    }

    this.table.draw({
      headers: columns.map((column: AIChatWidgetColumn) => {
        return column.title;
      }),
      alignments: columns.map((column: AIChatWidgetColumn) => {
        return column.type === "number" ? "right" : "left";
      }),
      rows: rows.map((row: JSONObject) => {
        return columns.map((column: AIChatWidgetColumn) => {
          return formatTableCell(row[column.key], column);
        });
      }),
    });

    if (allRows.length > rows.length) {
      this.pdf.paragraph(`Showing ${rows.length} of ${allRows.length} rows.`, {
        size: SMALL_SIZE,
        color: PDF_COLORS.faint,
      });
    }
  }

  private drawStatCards(widget: AIChatWidget): void {
    const stats: Array<AIChatWidgetStat> = widget.data.stats || [];

    if (stats.length === 0) {
      return;
    }

    const columns: number = 3;
    const gap: number = 6;
    const cardWidth: number =
      (this.pdf.contentWidth - gap * (columns - 1)) / columns;
    const cardHeight: number = 38;

    for (let index: number = 0; index < stats.length; index += columns) {
      const row: Array<AIChatWidgetStat> = stats.slice(index, index + columns);
      this.pdf.ensureSpace(cardHeight + gap);
      const rowY: number = this.pdf.y;

      row.forEach((stat: AIChatWidgetStat, column: number) => {
        const x: number = this.pdf.left + column * (cardWidth + gap);

        this.pdf.rect(x, rowY, cardWidth, cardHeight, {
          fill: PDF_COLORS.surface,
          stroke: PDF_COLORS.border,
          radius: 3,
        });

        /*
         * The label is uppercased here because on screen that is a CSS
         * transform, not the stored text.
         */
        this.pdf.setStyle({
          size: 6.5,
          color: PDF_COLORS.faint,
          fontStyle: "bold",
        });
        this.pdf.drawLine(
          this.pdf.sanitize(stat.label.toUpperCase()),
          x + 7,
          rowY + 7,
        );

        this.pdf.setStyle({
          size: 12,
          fontStyle: "bold",
          color: PDF_COLORS.heading,
        });
        const value: string = this.pdf.sanitize(formatStatValue(stat));
        const lines: Array<string> = this.pdf.wrap(value, cardWidth - 14);
        this.pdf.drawLine(lines[0] || value, x + 7, rowY + 19);
      });

      this.pdf.y = rowY + cardHeight + gap;
    }

    this.pdf.moveDown(2);
  }

  private drawResourceCard(widget: AIChatWidget): void {
    const fields: Array<{ label: string; value: string }> =
      widget.data.fields || [];

    const padding: number = 10;

    // Measure first so the surface can be painted behind the text.
    this.pdf.setStyle({ size: BODY_SIZE });
    const estimatedHeight: number =
      padding * 2 +
      (widget.data.resourceType ? 10 : 0) +
      12 +
      (widget.data.subheading ? 11 : 0) +
      fields.length * 11;

    /*
     * The card is drawn from a captured origin, so the origin must be read
     * AFTER any page break — otherwise the surface lands at the previous
     * page's cursor.
     */
    this.pdf.ensureSpace(estimatedHeight);
    const startY: number = this.pdf.y;

    this.pdf.rect(
      this.pdf.left,
      startY,
      this.pdf.contentWidth,
      estimatedHeight,
      { fill: "#ecfdf5", stroke: "#a7f3d0", radius: 5 },
    );

    let y: number = startY + padding;
    const x: number = this.pdf.left + padding;
    const innerWidth: number = this.pdf.contentWidth - padding * 2;

    if (widget.data.resourceType) {
      this.pdf.setStyle({ size: 6.5, fontStyle: "bold", color: "#059669" });
      this.pdf.drawLine(
        this.pdf.sanitize(widget.data.resourceType.toUpperCase()),
        x,
        y,
      );
      y += 10;
    }

    if (widget.data.heading) {
      this.pdf.setStyle({
        size: 10,
        fontStyle: "bold",
        color: PDF_COLORS.heading,
      });
      const headingLines: Array<string> = this.pdf.wrap(
        this.pdf.sanitize(widget.data.heading),
        innerWidth,
      );
      this.pdf.drawLine(headingLines[0] || "", x, y);
      y += 12;
    }

    if (widget.data.subheading) {
      this.pdf.setStyle({ size: BODY_SIZE, color: PDF_COLORS.muted });
      const subLines: Array<string> = this.pdf.wrap(
        this.pdf.sanitize(widget.data.subheading),
        innerWidth,
      );
      this.pdf.drawLine(subLines[0] || "", x, y);
      y += 11;
    }

    for (const field of fields) {
      this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.faint });
      const label: string = this.pdf.sanitize(`${field.label}`);
      this.pdf.drawLine(label, x, y);
      const labelWidth: number = Math.max(this.pdf.textWidth(label) + 8, 70);

      this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.text });
      const valueLines: Array<string> = this.pdf.wrap(
        this.pdf.sanitize(field.value),
        innerWidth - labelWidth,
      );
      this.pdf.drawLine(valueLines[0] || "", x + labelWidth, y);
      y += 11;
    }

    this.pdf.y = startY + estimatedHeight + 6;
  }

  private drawEntityList(widget: AIChatWidget): void {
    const items: Array<JSONObject> = widget.data.items || [];
    const shown: Array<JSONObject> = items.slice(0, MAX_ENTITY_ITEMS);

    if (shown.length === 0) {
      this.drawEmpty("Nothing here.");
      return;
    }

    for (const item of shown) {
      const entry: EntityListEntry = toEntityListEntry(item, widget.type);

      const badgeText: string = entry.badges.join("  ·  ");
      this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.muted });
      const badgeWidth: number = badgeText
        ? this.pdf.textWidth(this.pdf.sanitize(badgeText)) + 10
        : 0;

      this.pdf.setStyle({
        size: BODY_SIZE,
        fontStyle: "bold",
        color: PDF_COLORS.heading,
      });
      const headingLines: Array<string> = this.pdf.wrap(
        this.pdf.sanitize(entry.heading),
        this.pdf.contentWidth - badgeWidth - 16,
      );

      const bodyLines: Array<string> = entry.body
        ? ((): Array<string> => {
            this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.muted });
            // The chat clamps this to two lines; do the same on paper.
            return this.pdf
              .wrap(this.pdf.sanitize(entry.body), this.pdf.contentWidth - 16)
              .slice(0, 2);
          })()
        : [];

      const height: number =
        10 +
        headingLines.length * 10 +
        bodyLines.length * 9 +
        (entry.footer ? 9 : 0);

      /*
       * Measured before reserving space, and the origin read after, so a card
       * whose heading wrapped still gets a box that fits the page it lands on.
       */
      this.pdf.ensureSpace(height + 4);
      const rowY: number = this.pdf.y;

      this.pdf.rect(this.pdf.left, rowY, this.pdf.contentWidth, height, {
        fill: PDF_COLORS.surface,
        stroke: PDF_COLORS.border,
        radius: 3,
      });

      let y: number = rowY + 5;

      this.pdf.setStyle({
        size: BODY_SIZE,
        fontStyle: "bold",
        color: PDF_COLORS.heading,
      });
      for (const line of headingLines) {
        this.pdf.drawLine(line, this.pdf.left + 8, y);
        y += 10;
      }

      if (badgeText) {
        this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.muted });
        this.pdf.doc.text(
          this.pdf.sanitize(badgeText),
          this.pdf.right - 8,
          rowY + 5,
          { baseline: "top", align: "right" },
        );
      }

      this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.muted });
      for (const line of bodyLines) {
        this.pdf.drawLine(line, this.pdf.left + 8, y);
        y += 9;
      }

      if (entry.footer) {
        this.pdf.setStyle({ size: 6.5, color: PDF_COLORS.faint });
        this.pdf.drawLine(
          this.pdf.sanitize(entry.footer),
          this.pdf.left + 8,
          y,
        );
      }

      this.pdf.y = rowY + height + 4;
    }

    if (items.length > shown.length) {
      this.pdf.paragraph(`Showing ${shown.length} of ${items.length}.`, {
        size: SMALL_SIZE,
        color: PDF_COLORS.faint,
      });
    }
  }

  private drawWaterfall(widget: AIChatWidget): void {
    const spans: Array<AIChatWidgetSpan> = widget.data.spans || [];
    const shown: Array<AIChatWidgetSpan> = spans.slice(0, MAX_SPANS);

    if (shown.length === 0) {
      this.drawEmpty("No spans.");
      return;
    }

    const parentBySpanId: Map<string, string | undefined> =
      buildParentBySpanId(spans);
    const totalDurationMs: number = totalTraceDuration(widget);

    const nameWidth: number = this.pdf.contentWidth * 0.42;
    const durationWidth: number = 46;
    const trackX: number = this.pdf.left + nameWidth + 6;
    const trackWidth: number =
      this.pdf.contentWidth - nameWidth - durationWidth - 12;
    const rowHeight: number = 11;
    const barHeight: number = 6;

    for (const span of shown) {
      this.pdf.ensureSpace(rowHeight + 2);
      const y: number = this.pdf.y;

      const depth: number = computeSpanDepth(span, parentBySpanId);
      const indent: number = Math.min(depth, 8) * 7;

      // Name, indented by nesting depth and truncated to its column.
      this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.text });
      const label: string = this.pdf.sanitize(
        `${span.isError ? "* " : ""}${span.name}`,
      );
      const labelLines: Array<string> = this.pdf.wrap(
        label,
        Math.max(20, nameWidth - indent),
      );
      this.pdf.setStyle({
        size: SMALL_SIZE,
        color: span.isError ? PDF_COLORS.error : PDF_COLORS.text,
      });
      this.pdf.drawLine(labelLines[0] || label, this.pdf.left + indent, y + 1);

      // Track.
      this.pdf.rect(trackX, y + 1, trackWidth, barHeight, {
        fill: PDF_COLORS.subtleBorder,
        radius: 1.5,
      });

      const metrics: SpanBarMetrics = computeSpanBar(span, totalDurationMs);
      const barX: number = trackX + (metrics.leftPercent / 100) * trackWidth;
      const barWidth: number = (metrics.widthPercent / 100) * trackWidth;

      this.pdf.rect(barX, y + 1, barWidth, barHeight, {
        fill: span.isError ? "#f43f5e" : "#374151",
        radius: 1.5,
      });

      // Duration.
      this.pdf.setStyle({ size: SMALL_SIZE, color: PDF_COLORS.muted });
      this.pdf.doc.text(
        this.pdf.sanitize(`${span.durationMs.toLocaleString()} ms`),
        this.pdf.right,
        y + 1,
        { baseline: "top", align: "right" },
      );

      this.pdf.y = y + rowHeight;
    }

    this.pdf.moveDown(2);

    if (spans.length > shown.length) {
      this.pdf.paragraph(`Showing ${shown.length} of ${spans.length} spans.`, {
        size: SMALL_SIZE,
        color: PDF_COLORS.faint,
      });
    }
  }

  public draw(widget: AIChatWidget): void {
    // Keep the title with its body rather than letting it widow.
    this.pdf.ensureSpace(
      this.headerHeight(widget) + this.minimumBodyHeight(widget),
    );

    this.drawHeader(widget);

    if (isChartWidget(widget.type)) {
      this.chart.draw(widget);
      return;
    }

    if (isEntityListWidget(widget.type)) {
      this.drawEntityList(widget);
      return;
    }

    switch (widget.type) {
      case AIChatWidgetType.Table:
        this.drawTable(widget);
        break;
      case AIChatWidgetType.TraceWaterfall:
        this.drawWaterfall(widget);
        break;
      case AIChatWidgetType.StatCards:
        this.drawStatCards(widget);
        break;
      case AIChatWidgetType.ResourceCard:
        this.drawResourceCard(widget);
        break;
      default:
        break;
    }
  }

  public drawAll(widgets: Array<AIChatWidget>): void {
    for (const widget of widgets) {
      this.draw(widget);
    }
  }
}
