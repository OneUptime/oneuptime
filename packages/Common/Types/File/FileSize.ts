import { formatReaderFigure } from "../DateLanguage";

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
 * The number is the reader's (formatReaderFigure, issue #7233): "۴۷ KB" and
 * "۱٫۵ MB" on a Persian page, beside the Persian digits of the rest of the
 * page, "1,5 MB" in German; the unit is written as it is in every language.
 * English, and wherever no page has set a language (the server, a worker),
 * reads exactly as it always has: "47 KB", "1.5 MB", "1023 B". A size is
 * drawn as a value that reads its own way (IsolatedText), so a page read
 * from the right draws "۴۷ KB", never "KB ۴۷".
 *
 * Pure, with no React imports.
 */

export interface FileSizeOptions {
  // The language to write it in: the page's (getDateDisplayLanguage) when left out.
  language?: string | undefined;
}

export type FormatFileSizeFunction = (
  bytes: number,
  options?: FileSizeOptions,
) => string;

export const formatFileSize: FormatFileSizeFunction = (
  bytes: number,
  options?: FileSizeOptions,
): string => {
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }

  const language: string | undefined = options?.language;

  if (bytes < 1024) {
    return `${formatReaderFigure(Math.floor(bytes), { decimals: 0, language })} B`;
  }

  if (bytes < 1024 * 1024) {
    return `${formatReaderFigure(Math.max(1, Math.round(bytes / 1024)), {
      decimals: 0,
      language,
    })} KB`;
  }

  /*
   * Rounded to a tenth as it always was, then written with that tenth
   * only when it is not a whole number: "1 MB", "1.5 MB".
   */
  const megabytes: number = Math.round((bytes / (1024 * 1024)) * 10) / 10;

  return `${formatReaderFigure(megabytes, {
    decimals: 1,
    dropTrailingZeros: true,
    language,
  })} MB`;
};

export default formatFileSize;
