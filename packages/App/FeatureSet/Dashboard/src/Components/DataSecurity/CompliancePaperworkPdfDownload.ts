import downloadFile, { getExportFilename } from "Common/UI/Utils/DownloadFile";

/*
 * A document's Markdown (CompliancePaperworkExport) as a PDF: the engine,
 * CompliancePaperworkPdf and jsPDF, is fetched only now, when someone
 * exports. A module of its own, so the Markdown's module reaches no PDF
 * engine: App's tests read that Markdown, and App installs no jsPDF.
 */
export async function downloadMarkdownPdf(data: {
  title: string;
  markdown: string;
  label: string;
  exportedAt: Date;
}): Promise<void> {
  const { buildMarkdownPdf } = await import("./CompliancePaperworkPdf");
  const blob: Blob = await buildMarkdownPdf({
    title: data.title,
    markdown: data.markdown,
  });

  downloadFile({
    content: blob,
    filename: getExportFilename({
      label: data.label,
      extension: "pdf",
      exportedAt: data.exportedAt,
    }),
  });
}
