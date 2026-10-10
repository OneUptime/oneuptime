import { SanitizedText, sanitizeForPdf } from "../../AIChat/Export/PdfText";

/*
 * Text layout for the printed map, without a PDF library in sight.
 *
 * The document is laid out by a pure function (NetworkTopologyExportDocument)
 * so that what lands where — wrapped titles, a legend flowed into rows, a
 * table broken across pages — is decided by code App/Tests can run. The one
 * thing that needs the PDF library is how wide a string is, so that is
 * handed in as a TextMeasure: the real export measures with jsPDF's own font
 * metrics, and the tests with a stand-in.
 */

/** Width in points of `text` set at `fontSize` points. */
export type TextMeasure = (
  text: string,
  fontSize: number,
  isBold: boolean,
) => number;

// What a shortened string ends with. "…" is not in the PDF's Latin-1 fonts.
export const TEXT_ELLIPSIS: string = "...";

const WHITESPACE: RegExp = /\s+/;

/**
 * Collects the strings that go into one PDF, made drawable.
 *
 * jsPDF's built-in Helvetica only draws Latin-1. Names are the user's own
 * data and can be in any script, so each one goes through the same
 * sanitizer the AI chat export uses, and the document remembers whether
 * anything had to be replaced, so it can say so instead of handing the
 * reader a page of question marks without explanation.
 */
export class PdfStringCollector {
  private lossy: boolean = false;

  public get isLossy(): boolean {
    return this.lossy;
  }

  public clean(text: string | null | undefined): string {
    const result: SanitizedText = sanitizeForPdf(text || "");
    if (result.isLossy) {
      this.lossy = true;
    }
    return result.text;
  }
}

function breakWord(
  word: string,
  maxWidth: number,
  measure: TextMeasure,
  fontSize: number,
  isBold: boolean,
): Array<string> {
  const pieces: Array<string> = [];
  let current: string = "";
  for (const character of Array.from(word)) {
    const candidate: string = current + character;
    if (current && measure(candidate, fontSize, isBold) > maxWidth) {
      pieces.push(current);
      current = character;
      continue;
    }
    current = candidate;
  }
  if (current) {
    pieces.push(current);
  }
  return pieces;
}

/**
 * Greedy word wrap to `maxWidth` points. A word wider than a whole line is
 * broken between characters rather than allowed to run off the page (long
 * hostnames and FQDNs have no spaces to break at). Blank input wraps to no
 * lines at all.
 */
export function wrapText(
  text: string,
  maxWidth: number,
  measure: TextMeasure,
  fontSize: number,
  isBold: boolean = false,
): Array<string> {
  const words: Array<string> = (text || "")
    .split(WHITESPACE)
    .filter((word: string): boolean => {
      return word.length > 0;
    });
  const lines: Array<string> = [];
  let current: string = "";

  for (const word of words) {
    const candidate: string = current ? `${current} ${word}` : word;
    if (measure(candidate, fontSize, isBold) <= maxWidth) {
      current = candidate;
      continue;
    }
    if (current) {
      lines.push(current);
      current = "";
    }
    if (measure(word, fontSize, isBold) <= maxWidth) {
      current = word;
      continue;
    }
    const pieces: Array<string> = breakWord(
      word,
      maxWidth,
      measure,
      fontSize,
      isBold,
    );
    current = pieces.pop() || "";
    lines.push(...pieces);
  }
  if (current) {
    lines.push(current);
  }
  return lines;
}

/**
 * `text` shortened with "..." until it fits `maxWidth`. Returns the text
 * untouched when it already fits.
 */
export function truncateText(
  text: string,
  maxWidth: number,
  measure: TextMeasure,
  fontSize: number,
  isBold: boolean = false,
): string {
  if (measure(text, fontSize, isBold) <= maxWidth) {
    return text;
  }
  const characters: Array<string> = Array.from(text);
  let low: number = 0;
  let high: number = characters.length;
  // The longest prefix that still fits with the ellipsis after it.
  while (low < high) {
    const middle: number = Math.ceil((low + high) / 2);
    const candidate: string = `${characters.slice(0, middle).join("").trimEnd()}${TEXT_ELLIPSIS}`;
    if (measure(candidate, fontSize, isBold) <= maxWidth) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return `${characters.slice(0, low).join("").trimEnd()}${TEXT_ELLIPSIS}`;
}

/**
 * Wrapped to at most `maxLines` lines; whatever does not fit is folded into
 * an ellipsis on the last one.
 */
export function wrapTextToLines(
  text: string,
  maxWidth: number,
  maxLines: number,
  measure: TextMeasure,
  fontSize: number,
  isBold: boolean = false,
): Array<string> {
  const lines: Array<string> = wrapText(
    text,
    maxWidth,
    measure,
    fontSize,
    isBold,
  );
  const limit: number = Math.max(1, Math.floor(maxLines));
  if (lines.length <= limit) {
    return lines;
  }
  const kept: Array<string> = lines.slice(0, limit);
  const overflow: string = lines.slice(limit - 1).join(" ");
  kept[limit - 1] = truncateText(
    `${overflow}${TEXT_ELLIPSIS}`,
    maxWidth,
    measure,
    fontSize,
    isBold,
  );
  return kept;
}
