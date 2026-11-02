/*
 * A FILE'S SIZE AS PEOPLE READ IT: "640 B", "48 KB", "1.5 MB".
 *
 * Whole kilobytes under a megabyte, one decimal from a megabyte on: the
 * precision a person compares two files by, never "47.1 KB" beside
 * "240.0 KB". A file under a kilobyte is counted in bytes, so a tiny text
 * file never reads as "0.1 KB" - or as "0 KB", as if it were empty.
 *
 * Every place that lists files says their sizes this way: the Custom Fields
 * card, the file picker a form lists them in, a form's review step.
 *
 * Pure, with no React imports.
 */

export type FormatFileSizeFunction = (bytes: number) => string;

export const formatFileSize: FormatFileSizeFunction = (
  bytes: number,
): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  if (bytes < 1024) {
    return `${Math.floor(bytes)} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${Math.round((bytes / (1024 * 1024)) * 10) / 10} MB`;
};

export default formatFileSize;
