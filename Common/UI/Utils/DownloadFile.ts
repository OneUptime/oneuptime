/*
 * Triggers a browser download for content generated in the page.
 *
 * The object URL is revoked once the click has been dispatched so a large
 * export (a PDF can run to megabytes) is not pinned in memory until the user
 * navigates away.
 */
export default function downloadFile(data: {
  content: Blob | string;
  filename: string;
  mimeType?: string | undefined;
}): void {
  const blob: Blob =
    data.content instanceof Blob
      ? data.content
      : new Blob([data.content], {
          type: data.mimeType || "text/plain;charset=utf-8;",
        });

  const url: string = window.URL.createObjectURL(blob);
  const anchor: HTMLAnchorElement = document.createElement("a");
  anchor.href = url;
  anchor.download = data.filename;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  window.URL.revokeObjectURL(url);
}

/*
 * Slugifies a label and stamps it with the export time, so repeated exports of
 * the same conversation land as distinct files. Mirrors the naming used by the
 * CSV export (TableColumnsToCsv.getExportFilename).
 */
export function getExportFilename(data: {
  label: string;
  extension: string;
  exportedAt: Date;
}): string {
  const slug: string =
    data.label
      .replace(/[^a-zA-Z0-9-_]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .toLowerCase()
      .substring(0, 60) || "ai-conversation";

  const timestamp: string = data.exportedAt
    .toISOString()
    .replace(/[:.]/g, "-")
    .slice(0, 19);

  return `${slug}-${timestamp}.${data.extension}`;
}
