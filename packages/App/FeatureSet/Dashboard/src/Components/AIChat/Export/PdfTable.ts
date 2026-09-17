import type { jsPDF } from "jspdf";
import type { UserOptions } from "jspdf-autotable";
import PdfDocument, { PAGE_MARGIN, PDF_COLORS } from "./PdfDocument";

/*
 * Table drawing, delegated to jspdf-autotable.
 *
 * autotable owns column sizing, cell wrapping and row-level page breaking,
 * which is a meaningful amount of layout maths not worth reimplementing. This
 * wrapper keeps its styling consistent with the rest of the document and hands
 * the y cursor back afterwards.
 */

/*
 * jspdf-autotable v5's default export is the functional form. The old
 * `doc.autoTable(...)` prototype style needs applyPlugin() first, and mixing
 * the two is a common source of "autoTable is not a function".
 */
export type AutoTableFunction = (doc: jsPDF, options: UserOptions) => void;

/*
 * autoTable returns void and the package ships no `declare module "jspdf"`
 * augmentation, so the final cursor position has to be read off the document
 * through a locally declared shape.
 */
interface DocumentWithAutoTable {
  lastAutoTable?: { finalY?: number | undefined } | undefined;
}

export class PdfTable {
  private readonly pdf: PdfDocument;
  private readonly autoTable: AutoTableFunction;

  public constructor(pdf: PdfDocument, autoTable: AutoTableFunction) {
    this.pdf = pdf;
    this.autoTable = autoTable;
  }

  public draw(data: {
    headers: Array<string>;
    rows: Array<Array<string>>;
    alignments?: Array<"left" | "right" | "center"> | undefined;
  }): void {
    if (data.rows.length === 0 && data.headers.length === 0) {
      return;
    }

    const columnStyles: {
      [key: string]: { halign: "left" | "right" | "center" };
    } = {};

    (data.alignments || []).forEach(
      (align: "left" | "right" | "center", index: number) => {
        columnStyles[String(index)] = { halign: align };
      },
    );

    this.autoTable(this.pdf.doc, {
      head:
        data.headers.length > 0
          ? [
              data.headers.map((header: string) => {
                return this.pdf.sanitize(header);
              }),
            ]
          : [],
      body: data.rows.map((row: Array<string>) => {
        return row.map((cell: string) => {
          return this.pdf.sanitize(cell);
        });
      }),
      startY: this.pdf.y,
      margin: {
        top: PAGE_MARGIN.top,
        right: PAGE_MARGIN.right,
        bottom: PAGE_MARGIN.bottom,
        left: PAGE_MARGIN.left,
      },
      theme: "grid",
      styles: {
        font: "helvetica",
        fontSize: 8,
        cellPadding: 4,
        lineColor: PDF_COLORS.border,
        lineWidth: 0.5,
        textColor: PDF_COLORS.text,
        overflow: "linebreak",
        valign: "middle",
      },
      headStyles: {
        fillColor: PDF_COLORS.surface,
        textColor: PDF_COLORS.muted,
        fontStyle: "bold",
        fontSize: 7.5,
      },
      columnStyles: columnStyles,
      rowPageBreak: "avoid",
    });

    const finalY: number | undefined = (
      this.pdf.doc as unknown as DocumentWithAutoTable
    ).lastAutoTable?.finalY;

    /*
     * autotable moves the document to whatever page the table ended on, so the
     * cursor has to be resynced from its final Y rather than advanced by a
     * guessed height.
     */
    this.pdf.y = typeof finalY === "number" ? finalY + 10 : this.pdf.y + 10;

    // autotable leaves its own font/colour state behind.
    this.pdf.setStyle({ size: 9.5, color: PDF_COLORS.text });
  }
}
