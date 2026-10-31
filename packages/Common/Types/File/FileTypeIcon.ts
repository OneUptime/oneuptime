import IconProp from "../Icon/IconProp";
import MimeType from "./MimeType";

/*
 * THE ICON A FILE IS LISTED WITH, BY ITS KIND: a picture, a spreadsheet, an
 * archive (a packet capture is one), or any other document.
 *
 * The Custom Fields card and the file picker a form lists files in draw the
 * same icon for the same file, so a file reads as the same thing in the
 * dialog that adds it and on the card that shows it.
 *
 * Pure, with no React imports.
 */

export type GetFileTypeIconFunction = (fileType: unknown) => IconProp;

export const getFileTypeIcon: GetFileTypeIconFunction = (
  fileType: unknown,
): IconProp => {
  const type: string =
    typeof fileType === "string" ? fileType.trim().toLowerCase() : "";

  if (type.startsWith("image/")) {
    return IconProp.Photo;
  }

  if (
    type === MimeType.csv ||
    type === MimeType.xls ||
    type === MimeType.xlsx ||
    type === MimeType.ods
  ) {
    return IconProp.TableCells;
  }

  if (type === MimeType.zip || type === MimeType.pcap) {
    return IconProp.Archive;
  }

  return IconProp.DocumentText;
};

export default getFileTypeIcon;
