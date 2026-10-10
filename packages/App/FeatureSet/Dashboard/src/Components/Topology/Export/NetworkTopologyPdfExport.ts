import type { jsPDF } from "jspdf";
import OneUptimeDate from "Common/Types/Date";
import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";
import { ExportPage } from "./ExportItems";
import {
  NetworkTopologyExportDocument,
  NetworkTopologyExportInput,
  buildNetworkTopologyExportDocument,
} from "./NetworkTopologyExportDocument";
import { TextMeasure } from "./ExportText";
import {
  PDF_FONT_NAME,
  TopologyPdfCanvas,
  paintNetworkTopologyDocument,
} from "./NetworkTopologyPdfPainter";

/*
 * The "Export PDF" button's entry point: lay the map out, draw it with
 * jsPDF, and hand the browser the file.
 *
 * jsPDF is loaded with a dynamic import, as the AI chat export loads it
 * (Components/AIChat/Export/ConversationPdf), so its few hundred kilobytes
 * stay out of the dashboard bundle and are fetched the first time somebody
 * exports. Everything is built in the browser from the data the map already
 * holds: no server renders anything, and nothing leaves the page but the
 * download.
 */

type JsPdfConstructor = new (options: {
  unit: "pt";
  format: Array<number> | string;
  orientation: "portrait" | "landscape";
  compress?: boolean | undefined;
  putOnlyUsedFonts?: boolean | undefined;
}) => jsPDF;

export interface PdfLibrary {
  jsPDF: JsPdfConstructor;
}

export interface NetworkTopologyPdfOptions {
  /*
   * Where jsPDF comes from. Defaults to the dashboard's own copy, loaded on
   * demand; the tests hand in a stand-in.
   */
  loadPdfLibrary?: (() => Promise<PdfLibrary>) | undefined;
  yieldToBrowser?: (() => Promise<void>) | undefined;
}

export interface NetworkTopologyPdf {
  blob: Blob;
  document: NetworkTopologyExportDocument;
}

const loadJsPdf: () => Promise<PdfLibrary> = async (): Promise<PdfLibrary> => {
  const module: typeof import("jspdf") = await import("jspdf");
  return { jsPDF: module.jsPDF as unknown as JsPdfConstructor };
};

/*
 * Measures with jsPDF's own Helvetica metrics (kerning included), without
 * touching the document's font state: the font objects are read once and
 * passed to every measurement.
 */
export function createPdfTextMeasure(doc: jsPDF): TextMeasure {
  doc.setFont(PDF_FONT_NAME, "normal");
  const regular: unknown = doc.getFont();
  doc.setFont(PDF_FONT_NAME, "bold");
  const bold: unknown = doc.getFont();
  doc.setFont(PDF_FONT_NAME, "normal");
  return (text: string, fontSize: number, isBold: boolean): number => {
    if (!text) {
      return 0;
    }
    return (
      doc.getStringUnitWidth(text, {
        font: isBold ? bold : regular,
        fontSize: 1,
      }) * fontSize
    );
  };
}

function orientationOf(page: ExportPage): "portrait" | "landscape" {
  return page.width > page.height ? "landscape" : "portrait";
}

/** Builds the PDF of one map. */
export async function buildNetworkTopologyPdf(
  input: NetworkTopologyExportInput,
  options?: NetworkTopologyPdfOptions | undefined,
): Promise<NetworkTopologyPdf> {
  const library: PdfLibrary = await (options?.loadPdfLibrary || loadJsPdf)();

  // A scratch document to measure text with; the real one needs the page size.
  const measuringDoc: jsPDF = new library.jsPDF({
    unit: "pt",
    format: "a4",
    orientation: "landscape",
  });
  const document: NetworkTopologyExportDocument =
    buildNetworkTopologyExportDocument(
      input,
      createPdfTextMeasure(measuringDoc),
    );

  const firstPage: ExportPage = document.pages[0]!;
  const doc: jsPDF = new library.jsPDF({
    unit: "pt",
    format: [firstPage.width, firstPage.height],
    orientation: orientationOf(firstPage),
    compress: true,
    putOnlyUsedFonts: true,
  });

  await paintNetworkTopologyDocument(
    doc as unknown as TopologyPdfCanvas,
    document,
    { yieldToBrowser: options?.yieldToBrowser },
  );

  return { blob: doc.output("blob"), document: document };
}

export type NetworkTopologyPdfRequest = Omit<
  NetworkTopologyExportInput,
  "exportedAtText"
>;

/**
 * Builds the PDF of the map on screen and downloads it. Resolves with the
 * file's name once the download has been handed to the browser.
 */
export async function exportNetworkTopologyAsPdf(
  request: NetworkTopologyPdfRequest,
  options?: NetworkTopologyPdfOptions | undefined,
): Promise<string> {
  const exportedAt: Date = OneUptimeDate.getCurrentDate();
  const pdf: NetworkTopologyPdf = await buildNetworkTopologyPdf(
    {
      ...request,
      exportedAtText:
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(exportedAt),
    },
    options,
  );
  const filename: string = getExportFilename({
    label: pdf.document.fileLabel,
    extension: "pdf",
    exportedAt: exportedAt,
  });
  downloadFile({ content: pdf.blob, filename: filename });
  return filename;
}
