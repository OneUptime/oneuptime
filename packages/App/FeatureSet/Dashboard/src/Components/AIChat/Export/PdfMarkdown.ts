import {
  MarkdownBlock,
  MarkdownBlockType,
  MarkdownInline,
} from "Common/UI/Utils/AIChatExport/MarkdownBlocks";
import PdfDocument, {
  PAGE_MARGIN,
  PDF_COLORS,
  PdfFontStyle,
  PdfTextStyle,
} from "./PdfDocument";
import { PdfTable } from "./PdfTable";

/*
 * Draws parsed markdown blocks into the PDF.
 *
 * The interesting part is inline layout: a run of text can change weight,
 * slant, or become code partway through a line, and jsPDF only draws one string
 * in one font at a time. So inlines are tokenized into words, measured in their
 * own font, packed into lines by hand, and drawn token by token.
 */

const BODY_SIZE: number = 9.5;
const CODE_SIZE: number = 8.5;

const HEADING_SIZES: { [level: number]: number } = {
  1: 15,
  2: 13,
  3: 11.5,
  4: 10.5,
  5: 10,
  6: 9.5,
};

const WHITESPACE_ONLY: RegExp = /^\s+$/;
const WHITESPACE_SPLIT: RegExp = /(\s+)/;

interface InlineToken {
  text: string;
  fontStyle: PdfFontStyle;
  isCode: boolean;
  isStrikethrough: boolean;
  isForcedBreak: boolean;
  isSpace: boolean;
}

function fontStyleFor(inline: MarkdownInline): PdfFontStyle {
  if (inline.isBold && inline.isItalic) {
    return "bolditalic";
  }
  if (inline.isBold) {
    return "bold";
  }
  if (inline.isItalic) {
    return "italic";
  }
  return "normal";
}

function tokenize(inlines: Array<MarkdownInline>): Array<InlineToken> {
  const tokens: Array<InlineToken> = [];

  for (const inline of inlines) {
    if (inline.text === "\n") {
      tokens.push({
        text: "",
        fontStyle: "normal",
        isCode: false,
        isStrikethrough: false,
        isForcedBreak: true,
        isSpace: false,
      });
      continue;
    }

    const fontStyle: PdfFontStyle = fontStyleFor(inline);

    /*
     * Split on whitespace but keep it: the spaces are what the line packer
     * breaks on, and dropping them would run words together.
     */
    for (const part of inline.text.split(WHITESPACE_SPLIT)) {
      if (part === "") {
        continue;
      }
      if (WHITESPACE_ONLY.test(part)) {
        if (part.includes("\n") && !inline.isCode) {
          tokens.push({
            text: " ",
            fontStyle: fontStyle,
            isCode: false,
            isStrikethrough: false,
            isForcedBreak: false,
            isSpace: true,
          });
          continue;
        }
        tokens.push({
          text: " ",
          fontStyle: fontStyle,
          isCode: Boolean(inline.isCode),
          isStrikethrough: false,
          isForcedBreak: false,
          isSpace: true,
        });
        continue;
      }

      tokens.push({
        text: part,
        fontStyle: fontStyle,
        isCode: Boolean(inline.isCode),
        isStrikethrough: Boolean(inline.isStrikethrough),
        isForcedBreak: false,
        isSpace: false,
      });
    }
  }

  return tokens;
}

export default class PdfMarkdownRenderer {
  private readonly pdf: PdfDocument;
  private readonly table: PdfTable;

  public constructor(pdf: PdfDocument, table: PdfTable) {
    this.pdf = pdf;
    this.table = table;
  }

  private applyTokenFont(
    token: InlineToken,
    size: number,
    color: string,
  ): void {
    if (token.isCode) {
      this.pdf.doc.setFont(
        "courier",
        token.fontStyle === "bold" ? "bold" : "normal",
      );
      this.pdf.doc.setFontSize(size - 0.5);
      this.pdf.doc.setTextColor(PDF_COLORS.heading);
      return;
    }
    this.pdf.doc.setFont("helvetica", token.fontStyle);
    this.pdf.doc.setFontSize(size);
    this.pdf.doc.setTextColor(color);
  }

  private measure(token: InlineToken, size: number, color: string): number {
    this.applyTokenFont(token, size, color);
    return this.pdf.textWidth(token.text);
  }

  /*
   * Packs tokens into lines that fit maxWidth and draws them. A single token
   * wider than the line (a long URL in a code span) is hard-split by jsPDF's
   * own splitter so it cannot run off the page.
   */
  public drawInlines(
    inlines: Array<MarkdownInline>,
    options: {
      x: number;
      maxWidth: number;
      size: number;
      color: string;
      gapAfter?: number | undefined;
    },
  ): void {
    /*
     * Sanitize before tokenizing, not at draw time: the core fonts return a
     * width for characters they cannot actually draw, so measuring the raw text
     * would pack lines against widths that never materialize.
     */
    const safeInlines: Array<MarkdownInline> = inlines.map(
      (inline: MarkdownInline) => {
        return { ...inline, text: this.pdf.sanitize(inline.text) };
      },
    );

    const tokens: Array<InlineToken> = tokenize(safeInlines);
    const lineHeight: number = this.pdf.lineHeight(options.size);

    let line: Array<InlineToken> = [];
    let lineWidth: number = 0;

    const flush: () => void = (): void => {
      if (line.length === 0) {
        return;
      }

      this.pdf.ensureSpace(lineHeight);

      let x: number = options.x;
      for (const token of line) {
        const width: number = this.measure(token, options.size, options.color);

        if (token.isCode && !token.isSpace) {
          this.pdf.rect(x - 1, this.pdf.y - 1, width + 2, options.size + 2, {
            fill: PDF_COLORS.subtleBorder,
            radius: 1.5,
          });
          this.applyTokenFont(token, options.size, options.color);
        }

        this.pdf.drawLine(token.text, x, this.pdf.y);

        if (token.isStrikethrough) {
          this.pdf.hairline(
            x,
            this.pdf.y + options.size * 0.45,
            x + width,
            this.pdf.y + options.size * 0.45,
            options.color,
          );
        }

        x += width;
      }

      this.pdf.y += lineHeight;
      line = [];
      lineWidth = 0;
    };

    for (const token of tokens) {
      if (token.isForcedBreak) {
        flush();
        continue;
      }

      // Never open a line with a space.
      if (token.isSpace && line.length === 0) {
        continue;
      }

      const width: number = this.measure(token, options.size, options.color);

      if (lineWidth + width > options.maxWidth && line.length > 0) {
        flush();
        if (token.isSpace) {
          continue;
        }
      }

      /*
       * A word that cannot fit even on its own line has to be broken, or it
       * would be drawn straight past the margin.
       */
      if (width > options.maxWidth && line.length === 0 && !token.isSpace) {
        this.applyTokenFont(token, options.size, options.color);
        const pieces: Array<string> = this.pdf.wrap(
          token.text,
          options.maxWidth,
        );
        for (const piece of pieces) {
          line = [{ ...token, text: piece }];
          lineWidth = this.measure(
            { ...token, text: piece },
            options.size,
            options.color,
          );
          flush();
        }
        continue;
      }

      line.push(token);
      lineWidth += width;
    }

    flush();
    this.pdf.moveDown(options.gapAfter ?? 0);
  }

  private drawCodeBlock(block: MarkdownBlock): void {
    const code: string = this.pdf.sanitize(block.code || "");
    const paddingX: number = 8;
    const paddingY: number = 7;

    this.pdf.doc.setFont("courier", "normal");
    this.pdf.doc.setFontSize(CODE_SIZE);

    const lines: Array<string> = this.pdf.wrap(
      code,
      this.pdf.contentWidth - paddingX * 2,
    );
    const lineHeight: number = this.pdf.lineHeight(CODE_SIZE, 1.35);

    /*
     * Code blocks are drawn a page-chunk at a time: the surface is painted for
     * however many lines fit, then the block continues on the next page. This
     * keeps a long snippet from either overflowing or being forced whole onto a
     * page it cannot fit.
     */
    let index: number = 0;
    while (index < lines.length) {
      this.pdf.ensureSpace(lineHeight * 2 + paddingY * 2);

      const available: number = Math.max(
        1,
        Math.floor((this.pdf.remainingHeight - paddingY * 2) / lineHeight),
      );
      const chunk: Array<string> = lines.slice(index, index + available);
      const height: number = chunk.length * lineHeight + paddingY * 2;

      this.pdf.rect(this.pdf.left, this.pdf.y, this.pdf.contentWidth, height, {
        fill: PDF_COLORS.codeSurface,
        stroke: PDF_COLORS.border,
        radius: 3,
      });

      let y: number = this.pdf.y + paddingY;
      for (const line of chunk) {
        this.pdf.doc.setFont("courier", "normal");
        this.pdf.doc.setFontSize(CODE_SIZE);
        this.pdf.doc.setTextColor(PDF_COLORS.heading);
        this.pdf.drawLine(line, this.pdf.left + paddingX, y);
        y += lineHeight;
      }

      this.pdf.y += height;
      index += chunk.length;
    }

    this.pdf.moveDown(6);
  }

  private drawQuote(block: MarkdownBlock): void {
    const startY: number = this.pdf.y;
    const startPage: number = this.pdf.currentPage;
    const barX: number = this.pdf.left + 2;

    this.drawInlines(block.inlines || [], {
      x: this.pdf.left + 12,
      maxWidth: this.pdf.contentWidth - 12,
      size: BODY_SIZE,
      color: PDF_COLORS.muted,
      gapAfter: 4,
    });

    /*
     * The bar is drawn after the text, because only then is its height known.
     * If the quote broke across pages the captured origin belongs to a page we
     * have already left, so the bar is re-anchored to the top of the current
     * one and marks the part that is actually visible here.
     */
    const barTop: number =
      this.pdf.currentPage === startPage ? startY : PAGE_MARGIN.top;
    const barBottom: number = Math.min(this.pdf.y - 4, this.pdf.bottomLimit);

    if (barBottom > barTop) {
      this.pdf.doc.setDrawColor(PDF_COLORS.border);
      this.pdf.doc.setLineWidth(2);
      this.pdf.doc.line(barX, barTop, barX, barBottom);
    }
  }

  private drawHeading(block: MarkdownBlock): void {
    const size: number = HEADING_SIZES[block.level || 1] || BODY_SIZE;

    // Keep a heading with at least one line of what follows it.
    this.pdf.ensureSpace(
      this.pdf.lineHeight(size) + this.pdf.lineHeight(BODY_SIZE),
    );
    this.pdf.moveDown(4);

    this.drawInlines(block.inlines || [], {
      x: this.pdf.left,
      maxWidth: this.pdf.contentWidth,
      size: size,
      color: (block.level || 1) >= 6 ? PDF_COLORS.text : PDF_COLORS.heading,
      gapAfter: 3,
    });
  }

  private drawListItem(block: MarkdownBlock): void {
    const indent: number = (block.indent || 0) * 14;
    const markerWidth: number = 12;
    const x: number = this.pdf.left + indent;

    const style: PdfTextStyle = { size: BODY_SIZE, color: PDF_COLORS.muted };
    this.pdf.setStyle(style);
    this.pdf.ensureSpace(this.pdf.lineHeight(BODY_SIZE));
    this.pdf.setStyle(style);
    this.pdf.drawLine(this.pdf.sanitize(block.marker || "-"), x, this.pdf.y);

    this.drawInlines(block.inlines || [], {
      x: x + markerWidth,
      maxWidth: this.pdf.contentWidth - indent - markerWidth,
      size: BODY_SIZE,
      color: PDF_COLORS.text,
      gapAfter: 2,
    });
  }

  public drawBlocks(blocks: Array<MarkdownBlock>): void {
    for (const block of blocks) {
      switch (block.type) {
        case MarkdownBlockType.Heading:
          this.drawHeading(block);
          break;

        case MarkdownBlockType.Paragraph:
          this.drawInlines(block.inlines || [], {
            x: this.pdf.left + (block.indent || 0) * 14,
            maxWidth: this.pdf.contentWidth - (block.indent || 0) * 14,
            size: BODY_SIZE,
            color: PDF_COLORS.text,
            gapAfter: 6,
          });
          break;

        case MarkdownBlockType.ListItem:
          this.drawListItem(block);
          break;

        case MarkdownBlockType.Code:
          this.drawCodeBlock(block);
          break;

        case MarkdownBlockType.Quote:
          this.drawQuote(block);
          break;

        case MarkdownBlockType.Table:
          this.table.draw({
            headers: block.headers || [],
            rows: block.rows || [],
            alignments: block.alignments || [],
          });
          break;

        case MarkdownBlockType.Rule:
          this.pdf.ensureSpace(10);
          this.pdf.moveDown(4);
          this.pdf.hairline(
            this.pdf.left,
            this.pdf.y,
            this.pdf.right,
            this.pdf.y,
            PDF_COLORS.border,
          );
          this.pdf.moveDown(6);
          break;

        default:
          break;
      }
    }
  }
}
