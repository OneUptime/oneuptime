import {
  AIChatWidget,
  AIChatWidgetColumn,
  AIChatWidgetSpan,
  AIChatWidgetStat,
  AIChatWidgetType,
  getAIChatResourceCardStatusColor,
  isAIChatReadResourceCard,
} from "Common/Types/AI/AIChatTypes";
import { ResourceCardFact } from "Common/Types/AI/ResourceCardFacts";
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
  getExportedResourceCardFacts,
  isChartWidget,
  isEntityListWidget,
  toEntityListEntry,
  totalTraceDuration,
} from "Common/UI/Utils/AIChatExport/ChatWidgetData";
import PdfChart, { CHART_BLOCK_HEIGHT } from "./PdfChart";
import PdfDocument, { PAGE_MARGIN, PDF_COLORS } from "./PdfDocument";
import { PdfTable } from "./PdfTable";
import { getReaderNumberLocale } from "Common/Types/DateLanguage";

/*
 * A resource card's surface, edge and kind (issue #6968): a read's in the
 * export's greys, a write's in the green the chat draws it in.
 */
export const PDF_RESOURCE_CARD_LOOKS: {
  read: { fill: string; stroke: string; kind: string };
  write: { fill: string; stroke: string; kind: string };
} = {
  read: {
    fill: PDF_COLORS.surface,
    stroke: PDF_COLORS.border,
    kind: PDF_COLORS.muted,
  },
  write: { fill: "#ecfdf5", stroke: "#a7f3d0", kind: "#059669" },
};

/*
 * A read's status dot in the export (issue #6968): as a chart's legend
 * draws its colours, 5pt round, and the line's words 4pt after it.
 */
export const PDF_STATUS_DOT: { radius: number; indent: number } = {
  radius: 2.5,
  indent: 9,
};

/*
 * How many lines each part of a resource card may take in the export
 * (issue #7202). The card drew the first line of its heading, its status
 * line and each fact's value and left the rest out, with nothing to say
 * so: a long description, an on-call rule's targets, a status page's
 * resources ended mid-sentence. It draws them whole now, up to these -
 * the heading three, as the chat clamps it - and a part cut short ends
 * its last line with "...". A card taller than a page draws its values in
 * fewer lines, so it still moves to the next page whole.
 */
export const PDF_RESOURCE_CARD_MAX_LINES: {
  kind: number;
  heading: number;
  line: number;
  label: number;
  value: number;
} = { kind: 1, heading: 3, line: 4, label: 3, value: 8 };

// The most of the card's inner width a fact's name takes: the rest is its value's.
export const PDF_RESOURCE_CARD_LABEL_SHARE: number = 0.4;

// The most lines a stat's value takes, as the chat's stat card wraps it (issue #7202).
export const PDF_STAT_VALUE_MAX_LINES: number = 2;

// What ends a line cut short: three dots, as the core font has no ellipsis.
export const PDF_CUT_MARK: string = "...";

/*
 * A resource card's room, in points: its edge, the height of each of its
 * lines, the gap between its name and line and its facts (the chat's
 * mt-2.5: "No members" ran into "Description" under it), and the room
 * before a read's card, which has no title over it.
 */
export const PDF_RESOURCE_CARD_SPACING: {
  padding: number;
  kind: number;
  heading: number;
  line: number;
  factsGap: number;
  fact: number;
  factExtraLine: number;
  before: number;
  after: number;
} = {
  padding: 10,
  kind: 10,
  heading: 12,
  line: 11,
  factsGap: 4,
  fact: 11,
  factExtraLine: 9.5,
  before: 4,
  after: 6,
};

// A stat card's height with a one-line value, and each further line's.
const STAT_CARD_HEIGHT: number = 38;
const STAT_VALUE_LINE_HEIGHT: number = 14;

// The least room a fact's name takes, and the gap after it.
const FACT_LABEL_MIN_WIDTH: number = 70;
const FACT_LABEL_GAP: number = 8;

// A fact as the export lays it out: its name and its value, line by line.
interface PdfResourceCardFactLayout {
  labelLines: Array<string>;
  valueLines: Array<string>;
  // Where its value starts, from the card's inner edge.
  labelWidth: number;
  height: number;
}

// A resource card as the export lays it out, measured before it is painted.
interface PdfResourceCardLayout {
  kindLines: Array<string>;
  headingLines: Array<string>;
  statusLines: Array<string>;
  statusColor: string | null;
  // The room between the name and line over the facts and the facts.
  factsGap: number;
  facts: Array<PdfResourceCardFactLayout>;
  height: number;
}

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

// The styles a card's and a stat's parts are measured and drawn in.
const CARD_KIND_STYLE: { size: number; fontStyle: "bold" } = {
  size: 6.5,
  fontStyle: "bold",
};
const CARD_HEADING_STYLE: { size: number; fontStyle: "bold" } = {
  size: 10,
  fontStyle: "bold",
};
const CARD_LINE_STYLE: { size: number } = { size: BODY_SIZE };
const CARD_FACT_STYLE: { size: number } = { size: SMALL_SIZE };
const STAT_LABEL_STYLE: {
  size: number;
  fontStyle: "bold";
  color: string;
} = { size: 6.5, fontStyle: "bold", color: PDF_COLORS.faint };
const STAT_VALUE_STYLE: {
  size: number;
  fontStyle: "bold";
  color: string;
} = { size: 12, fontStyle: "bold", color: PDF_COLORS.heading };

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
   * Every widget has its title over it, but a read's card: its kind and
   * name are its title ("MONITOR", "payments-api"), as the chat draws it
   * with none over it - the PDF said "Monitor payments-api" and then the
   * same again inside the card. A write's card keeps its title, which says
   * what was done ("Alert created") where the chat says it with a check.
   */
  private hasHeader(widget: AIChatWidget): boolean {
    return !(
      widget.type === AIChatWidgetType.ResourceCard &&
      isAIChatReadResourceCard(widget.data)
    );
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
    /*
     * A card is atomic: the whole of it, so it moves to the next page with
     * its title rather than being cut by the page's end (issue #7202).
     */
    if (widget.type === AIChatWidgetType.ResourceCard) {
      return (
        this.fitResourceCard(widget).height + PDF_RESOURCE_CARD_SPACING.after
      );
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
    const textWidth: number = cardWidth - 14;

    for (let index: number = 0; index < stats.length; index += columns) {
      const row: Array<AIChatWidgetStat> = stats.slice(index, index + columns);

      /*
       * Measured before the row is painted (issue #7202): a value takes up
       * to two lines, the last one cut with "..." when it had more - it
       * drew its first line alone - and the row is as tall as its tallest
       * card, so the cards beside it keep one height. The label is one
       * line, cut the same way.
       */
      const laidOut: Array<{ label: string; valueLines: Array<string> }> =
        row.map((stat: AIChatWidgetStat) => {
          /*
           * The label is uppercased here because on screen that is a CSS
           * transform, not the stored text.
           */
          this.pdf.setStyle(STAT_LABEL_STYLE);
          const label: string =
            this.clampLines(
              this.pdf.wrap(
                this.pdf.sanitize(stat.label.toUpperCase()),
                textWidth,
              ),
              1,
              textWidth,
            )[0] || "";

          this.pdf.setStyle(STAT_VALUE_STYLE);
          const valueLines: Array<string> = this.clampLines(
            this.pdf.wrap(this.pdf.sanitize(formatStatValue(stat)), textWidth),
            PDF_STAT_VALUE_MAX_LINES,
            textWidth,
          );

          return { label, valueLines };
        });

      const cardHeight: number =
        STAT_CARD_HEIGHT +
        (Math.max(
          1,
          ...laidOut.map(
            (stat: { label: string; valueLines: Array<string> }): number => {
              return stat.valueLines.length;
            },
          ),
        ) -
          1) *
          STAT_VALUE_LINE_HEIGHT;

      this.pdf.ensureSpace(cardHeight + gap);
      const rowY: number = this.pdf.y;

      laidOut.forEach(
        (
          stat: { label: string; valueLines: Array<string> },
          column: number,
        ) => {
          const x: number = this.pdf.left + column * (cardWidth + gap);

          this.pdf.rect(x, rowY, cardWidth, cardHeight, {
            fill: PDF_COLORS.surface,
            stroke: PDF_COLORS.border,
            radius: 3,
          });

          this.pdf.setStyle(STAT_LABEL_STYLE);
          this.pdf.drawLine(stat.label, x + 7, rowY + 7);

          this.pdf.setStyle(STAT_VALUE_STYLE);
          stat.valueLines.forEach((line: string, lineIndex: number) => {
            this.pdf.drawLine(
              line,
              x + 7,
              rowY + 19 + lineIndex * STAT_VALUE_LINE_HEIGHT,
            );
          });
        },
      );

      this.pdf.y = rowY + cardHeight + gap;
    }

    this.pdf.moveDown(2);
  }

  /*
   * At most `max` of a text's wrapped lines (issue #7202). When it had
   * more, the last one kept ends with "...", shortened until it fits
   * `width`, so a part cut short never reads as the whole of it. Measured
   * in the style set now, as the lines were wrapped.
   */
  private clampLines(
    lines: Array<string>,
    max: number,
    width: number,
  ): Array<string> {
    if (lines.length <= max) {
      return lines;
    }

    const kept: Array<string> = lines.slice(0, Math.max(1, max));
    let last: string = kept[kept.length - 1]!.trimEnd();

    while (
      last.length > 0 &&
      this.pdf.textWidth(`${last}${PDF_CUT_MARK}`) > width
    ) {
      last = last.slice(0, -1).trimEnd();
    }

    kept[kept.length - 1] = `${last}${PDF_CUT_MARK}`;

    return kept;
  }

  /*
   * A card as the export draws it: every part wrapped to the card's width
   * and measured, before its surface is painted - the stored English, as
   * the exports print it, each fact once (Types/AI/ResourceCardFacts). A
   * fact's value takes up to `valueMaxLines`, and its name as many, up to
   * three.
   */
  private layoutResourceCard(
    widget: AIChatWidget,
    valueMaxLines: number,
  ): PdfResourceCardLayout {
    const spacing: typeof PDF_RESOURCE_CARD_SPACING = PDF_RESOURCE_CARD_SPACING;
    const innerWidth: number = this.pdf.contentWidth - spacing.padding * 2;

    // Each once, and a moment as the export writes its dates.
    const fields: Array<ResourceCardFact> =
      getExportedResourceCardFacts(widget);

    /*
     * The status the line names in its own colour, a dot before it, as
     * the chat draws it (issue #6968): Offline in its red, monitoring off
     * in gray. A stored colour that is not one draws none, and no line
     * none: the colour belongs to the status the line names.
     */
    const statusColor: string | null = widget.data.subheading
      ? getAIChatResourceCardStatusColor(widget.data.statusColor)
      : null;
    const statusWidth: number =
      innerWidth - (statusColor ? PDF_STATUS_DOT.indent : 0);

    // Wrapped in its style, at most `max` lines.
    const linesOf: (
      text: string | undefined,
      style: { size: number; fontStyle?: "bold" | undefined },
      width: number,
      max: number,
    ) => Array<string> = (
      text: string | undefined,
      style: { size: number; fontStyle?: "bold" | undefined },
      width: number,
      max: number,
    ): Array<string> => {
      if (!text) {
        return [];
      }

      this.pdf.setStyle(style);

      return this.clampLines(
        this.pdf.wrap(this.pdf.sanitize(text), width),
        max,
        width,
      );
    };

    const kindLines: Array<string> = linesOf(
      widget.data.resourceType
        ? widget.data.resourceType.toUpperCase()
        : undefined,
      CARD_KIND_STYLE,
      innerWidth,
      PDF_RESOURCE_CARD_MAX_LINES.kind,
    );
    const headingLines: Array<string> = linesOf(
      widget.data.heading,
      CARD_HEADING_STYLE,
      innerWidth,
      PDF_RESOURCE_CARD_MAX_LINES.heading,
    );
    const statusLines: Array<string> = linesOf(
      widget.data.subheading,
      CARD_LINE_STYLE,
      statusWidth,
      PDF_RESOURCE_CARD_MAX_LINES.line,
    );

    const labelMaxWidth: number = innerWidth * PDF_RESOURCE_CARD_LABEL_SHARE;
    const labelMaxLines: number = Math.min(
      PDF_RESOURCE_CARD_MAX_LINES.label,
      valueMaxLines,
    );

    /*
     * The names are one column, as wide as the widest of them - at least
     * 70pt, at most 40% of the card - so every value of the card starts
     * at one place, as the chat's grid lines them up: one long name
     * ("Error budget policy tier") moved its own value alone to the right.
     * A name wider than the column wraps within it.
     */
    this.pdf.setStyle(CARD_FACT_STYLE);
    const labelWidth: number = Math.min(
      labelMaxWidth,
      Math.max(
        FACT_LABEL_MIN_WIDTH,
        ...fields.map((field: ResourceCardFact): number => {
          return (
            this.pdf.textWidth(this.pdf.sanitize(`${field.label}`)) +
            FACT_LABEL_GAP
          );
        }),
      ),
    );

    const facts: Array<PdfResourceCardFactLayout> = fields.map(
      (field: ResourceCardFact): PdfResourceCardFactLayout => {
        const labelLines: Array<string> = linesOf(
          `${field.label}`,
          CARD_FACT_STYLE,
          labelWidth - FACT_LABEL_GAP,
          labelMaxLines,
        );
        const valueLines: Array<string> = linesOf(
          field.value,
          CARD_FACT_STYLE,
          innerWidth - labelWidth,
          valueMaxLines,
        );

        return {
          labelLines,
          valueLines,
          labelWidth,
          height:
            spacing.fact +
            (Math.max(1, labelLines.length, valueLines.length) - 1) *
              spacing.factExtraLine,
        };
      },
    );

    const factsGap: number =
      facts.length > 0 &&
      kindLines.length + headingLines.length + statusLines.length > 0
        ? spacing.factsGap
        : 0;

    return {
      kindLines,
      headingLines,
      statusLines,
      statusColor,
      factsGap,
      facts,
      height:
        spacing.padding * 2 +
        kindLines.length * spacing.kind +
        headingLines.length * spacing.heading +
        statusLines.length * spacing.line +
        factsGap +
        facts.reduce(
          (total: number, fact: PdfResourceCardFactLayout): number => {
            return total + fact.height;
          },
          0,
        ),
    };
  }

  /*
   * The card laid out to fit one page (with its title, when it has one -
   * a write's) (issue #7202): its values in fewer lines while it does not,
   * so it always moves to the next page whole rather than running past the
   * page's end. A card saved with more facts than a page holds even then
   * keeps those that fit.
   */
  private fitResourceCard(widget: AIChatWidget): PdfResourceCardLayout {
    const room: number =
      this.pdf.bottomLimit -
      PAGE_MARGIN.top -
      (this.hasHeader(widget) ? this.headerHeight(widget) : 0) -
      PDF_RESOURCE_CARD_SPACING.after;

    let layout: PdfResourceCardLayout = this.layoutResourceCard(
      widget,
      PDF_RESOURCE_CARD_MAX_LINES.value,
    );

    for (
      let valueMaxLines: number = PDF_RESOURCE_CARD_MAX_LINES.value - 1;
      layout.height > room && valueMaxLines >= 1;
      valueMaxLines--
    ) {
      layout = this.layoutResourceCard(widget, valueMaxLines);
    }

    while (layout.height > room && layout.facts.length > 0) {
      const dropped: PdfResourceCardFactLayout = layout.facts.pop()!;
      layout.height -= dropped.height;
      if (layout.facts.length === 0) {
        layout.height -= layout.factsGap;
        layout.factsGap = 0;
      }
    }

    return layout;
  }

  private drawResourceCard(widget: AIChatWidget): void {
    const spacing: typeof PDF_RESOURCE_CARD_SPACING = PDF_RESOURCE_CARD_SPACING;

    // Measure first so the surface can be painted behind the text.
    const layout: PdfResourceCardLayout = this.fitResourceCard(widget);

    /*
     * The card is drawn from a captured origin, so the origin must be read
     * AFTER any page break — otherwise the surface lands at the previous
     * page's cursor.
     */
    this.pdf.ensureSpace(layout.height);
    const startY: number = this.pdf.y;

    /*
     * Drawn as the chat draws it (issue #6968): a read's card plain, a
     * write's green - and one saved before cards said which, green.
     */
    const look: { fill: string; stroke: string; kind: string } =
      isAIChatReadResourceCard(widget.data)
        ? PDF_RESOURCE_CARD_LOOKS.read
        : PDF_RESOURCE_CARD_LOOKS.write;

    this.pdf.rect(this.pdf.left, startY, this.pdf.contentWidth, layout.height, {
      fill: look.fill,
      stroke: look.stroke,
      radius: 5,
    });

    let y: number = startY + spacing.padding;
    const x: number = this.pdf.left + spacing.padding;

    this.pdf.setStyle({ ...CARD_KIND_STYLE, color: look.kind });
    for (const line of layout.kindLines) {
      this.pdf.drawLine(line, x, y);
      y += spacing.kind;
    }

    this.pdf.setStyle({ ...CARD_HEADING_STYLE, color: PDF_COLORS.heading });
    for (const line of layout.headingLines) {
      this.pdf.drawLine(line, x, y);
      y += spacing.heading;
    }

    if (layout.statusLines.length > 0) {
      // The dot beside the line's first line; the lines after it keep its indent.
      const indent: number = layout.statusColor ? PDF_STATUS_DOT.indent : 0;
      if (layout.statusColor) {
        this.pdf.circle(
          x + PDF_STATUS_DOT.radius,
          y + BODY_SIZE / 2,
          PDF_STATUS_DOT.radius,
          layout.statusColor,
        );
      }
      this.pdf.setStyle({ ...CARD_LINE_STYLE, color: PDF_COLORS.muted });
      for (const line of layout.statusLines) {
        this.pdf.drawLine(line, x + indent, y);
        y += spacing.line;
      }
    }

    y += layout.factsGap;

    for (const fact of layout.facts) {
      // Its name's lines and its value's, each from the fact's own top.
      this.pdf.setStyle({ ...CARD_FACT_STYLE, color: PDF_COLORS.faint });
      for (let index: number = 0; index < fact.labelLines.length; index++) {
        this.pdf.drawLine(
          fact.labelLines[index]!,
          x,
          y + index * spacing.factExtraLine,
        );
      }

      this.pdf.setStyle({ ...CARD_FACT_STYLE, color: PDF_COLORS.text });
      for (let index: number = 0; index < fact.valueLines.length; index++) {
        this.pdf.drawLine(
          fact.valueLines[index]!,
          x + fact.labelWidth,
          y + index * spacing.factExtraLine,
        );
      }

      y += fact.height;
    }

    this.pdf.y = startY + layout.height + spacing.after;
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
        this.pdf.sanitize(
          `${span.durationMs.toLocaleString(getReaderNumberLocale())} ms`,
        ),
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
    // A read's card stands alone, as in the chat: it moves to the next page whole.
    if (!this.hasHeader(widget)) {
      this.pdf.moveDown(PDF_RESOURCE_CARD_SPACING.before);
      this.drawResourceCard(widget);
      return;
    }

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
