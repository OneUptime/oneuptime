import PdfDocument, { PAGE_MARGIN } from "../AIChat/Export/PdfDocument";
import PdfMarkdownRenderer from "../AIChat/Export/PdfMarkdown";
import { AutoTableFunction, PdfTable } from "../AIChat/Export/PdfTable";
import parseMarkdownBlocks from "Common/UI/Utils/AIChatExport/MarkdownBlocks";

/*
 * THE COMPLIANCE PAPERWORK AS PDF (#10375): a document's Markdown drawn by
 * the AI chat's export engine - its title on the first page, every page
 * numbered. This module, the Markdown parser and jsPDF are fetched only
 * when someone exports (CompliancePaperworkExport.downloadMarkdownPdf).
 */
export async function buildMarkdownPdf(data: {
  title: string;
  markdown: string;
}): Promise<Blob> {
  const [jsPdfModule, autoTableModule] = await Promise.all([
    import("jspdf"),
    import("jspdf-autotable"),
  ]);
  const doc: import("jspdf").jsPDF = new jsPdfModule.jsPDF({
    orientation: "portrait",
    unit: "pt",
    format: "a4",
    compress: true,
    putOnlyUsedFonts: true,
  });

  doc.setProperties({ title: data.title, creator: "OneUptime" });

  const pdf: PdfDocument = new PdfDocument(doc);

  pdf.y = PAGE_MARGIN.top;

  const renderer: PdfMarkdownRenderer = new PdfMarkdownRenderer(
    pdf,
    new PdfTable(pdf, autoTableModule.default as AutoTableFunction),
  );

  renderer.drawBlocks(parseMarkdownBlocks(data.markdown));
  pdf.stampFooters();

  return doc.output("blob");
}
