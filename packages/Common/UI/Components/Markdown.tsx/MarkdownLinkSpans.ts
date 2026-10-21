import { isWhiteSpaceCode } from "../../../Utils/RegExpCharacterClasses";

/*
 * ---------------------------------------------------------------------------
 * THE IMAGES AND LINKS IN A LINE OF MARKDOWN, FOUND IN TIME IN LINE WITH
 * ITS LENGTH.
 *
 * The editor found images with
 *
 *   /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g
 *
 * and links with the same pattern after a "[" with at least one character
 * of words: the words up to the first "]", then "(", an address up to the
 * first ")" or white space, an optional title in double quotes after white
 * space, and ")". Each was looked for again from every opener, and each try
 * read on to the "]" that ends the words and to the end of the address
 * after it - so a run of openers that close nothing was read once for each
 * of them: time that grew with the square of the text's length. The editor
 * reads every line of a note, description or postmortem it opens, written
 * by whoever wrote it.
 *
 * findImageSpans and findLinkSpans find exactly what those patterns found,
 * in the same order: the same starts and ends, words, address and title.
 * The first "]" after a point, the end of an address and the title after
 * one are each read once and kept for every later opener that reaches
 * them; and once no "]" follows, no later opener can close either.
 * ---------------------------------------------------------------------------
 */

export interface LinkSpan {
  // Where the match starts: the "!" of an image, the "[" of a link.
  start: number;
  // Where it ends: just after its ")".
  end: number;
  // An image's alt text, a link's label: the pattern's first group.
  words: string;
  // The second group.
  address: string;
  // The third group: the title between the quotes, or undefined without one.
  title: string | undefined;
}

const OPEN_PAREN: number = 0x28;
const CLOSE_PAREN: number = 0x29;
const QUOTE: number = 0x22;

interface Found {
  // Where the character was looked for from, -1 before the first look.
  from: number;
  // Where it is, -1 when it is nowhere at or after `from`.
  at: number;
}

type FindSpansFunction = (
  text: string,
  opener: string,
  wordsMayBeEmpty: boolean,
) => Array<LinkSpan>;

const findSpans: FindSpansFunction = (
  text: string,
  opener: string,
  wordsMayBeEmpty: boolean,
): Array<LinkSpan> => {
  const length: number = text.length;
  const spans: Array<LinkSpan> = [];

  /*
   * The first `character` at or after `from`. Openers are tried left to
   * right, so `from` only grows: what was found is kept while it is still
   * at or after `from`, and each look starts past the last one found.
   */
  const firstAtOrAfter: (
    found: Found,
    character: string,
    from: number,
  ) => number = (found: Found, character: string, from: number): number => {
    if (
      found.from !== -1 &&
      found.from <= from &&
      (found.at === -1 || found.at >= from)
    ) {
      return found.at;
    }

    found.from = from;
    found.at = text.indexOf(character, from);

    return found.at;
  };

  const closingBracket: Found = { from: -1, at: -1 };
  const closingQuote: Found = { from: -1, at: -1 };

  /*
   * Where the address that starts at `from` ends: at the first ")" or white
   * space, or at the end of the text. Addresses start where the words end,
   * so `from` only grows; an address that starts inside the last one read
   * ends where it did.
   */
  const addressRun: { from: number; end: number } = { from: -1, end: -1 };

  const addressEnd: (from: number) => number = (from: number): number => {
    if (
      addressRun.from !== -1 &&
      addressRun.from <= from &&
      from <= addressRun.end
    ) {
      return addressRun.end;
    }

    let end: number = from;

    while (end < length) {
      const code: number = text.charCodeAt(end);

      if (code === CLOSE_PAREN || isWhiteSpaceCode(code)) {
        break;
      }

      end++;
    }

    addressRun.from = from;
    addressRun.end = end;

    return end;
  };

  /*
   * (?:\s+"([^"]*)")?\) after an address that ends in white space at
   * `whiteSpaceAt`: the white space, a quote, the title up to the next
   * quote, the quote and ")". Every opener whose address ends there gets
   * the same answer, so it is kept for the next one.
   */
  const title: {
    whiteSpaceAt: number;
    found: { end: number; title: string } | null;
  } = { whiteSpaceAt: -1, found: null };

  const titleAfter: (
    whiteSpaceAt: number,
  ) => { end: number; title: string } | null = (
    whiteSpaceAt: number,
  ): { end: number; title: string } | null => {
    if (title.whiteSpaceAt === whiteSpaceAt) {
      return title.found;
    }

    let quoteAt: number = whiteSpaceAt;

    while (quoteAt < length && isWhiteSpaceCode(text.charCodeAt(quoteAt))) {
      quoteAt++;
    }

    let found: { end: number; title: string } | null = null;

    if (quoteAt < length && text.charCodeAt(quoteAt) === QUOTE) {
      const closing: number = firstAtOrAfter(closingQuote, '"', quoteAt + 1);

      if (closing !== -1 && text.charCodeAt(closing + 1) === CLOSE_PAREN) {
        found = {
          end: closing + 2,
          title: text.slice(quoteAt + 1, closing),
        };
      }
    }

    title.whiteSpaceAt = whiteSpaceAt;
    title.found = found;

    return found;
  };

  let from: number = 0;

  while (from < length) {
    const start: number = text.indexOf(opener, from);

    if (start === -1) {
      break;
    }

    const wordsStart: number = start + opener.length;
    const bracket: number = firstAtOrAfter(closingBracket, "]", wordsStart);

    // No "]" after this opener: none after any later one either.
    if (bracket === -1) {
      break;
    }

    const addressStart: number = bracket + 2;

    if (
      (bracket === wordsStart && !wordsMayBeEmpty) ||
      text.charCodeAt(bracket + 1) !== OPEN_PAREN
    ) {
      from = start + 1;
      continue;
    }

    const end: number = addressEnd(addressStart);

    if (end === addressStart || end === length) {
      from = start + 1;
      continue;
    }

    if (text.charCodeAt(end) === CLOSE_PAREN) {
      spans.push({
        start: start,
        end: end + 1,
        words: text.slice(wordsStart, bracket),
        address: text.slice(addressStart, end),
        title: undefined,
      });
      from = end + 1;
      continue;
    }

    // The address ends in white space: only a title can close it.
    const titled: { end: number; title: string } | null = titleAfter(end);

    if (!titled) {
      from = start + 1;
      continue;
    }

    spans.push({
      start: start,
      end: titled.end,
      words: text.slice(wordsStart, bracket),
      address: text.slice(addressStart, end),
      title: titled.title,
    });
    from = titled.end;
  }

  return spans;
};

export type FindLinkSpansFunction = (text: string) => Array<LinkSpan>;

// What /!\[([^\]]*)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g matched, in order.
export const findImageSpans: FindLinkSpansFunction = (
  text: string,
): Array<LinkSpan> => {
  return findSpans(text, "![", true);
};

// What /\[([^\]]+)\]\(([^)\s]+)(?:\s+"([^"]*)")?\)/g matched, in order.
export const findLinkSpans: FindLinkSpansFunction = (
  text: string,
): Array<LinkSpan> => {
  return findSpans(text, "[", false);
};

export type ReplaceLinkSpansFunction = (
  text: string,
  spans: ReadonlyArray<LinkSpan>,
  // What a span is written as; called once for each span, in order.
  write: (span: LinkSpan) => string,
) => string;

/*
 * The text with each span written over, as text.replace(pattern, callback)
 * wrote it: the callbacks run in the order of the spans.
 */
export const replaceLinkSpans: ReplaceLinkSpansFunction = (
  text: string,
  spans: ReadonlyArray<LinkSpan>,
  write: (span: LinkSpan) => string,
): string => {
  if (spans.length === 0) {
    return text;
  }

  let written: string = "";
  let copiedUpTo: number = 0;

  for (const span of spans) {
    written += text.slice(copiedUpTo, span.start) + write(span);
    copiedUpTo = span.end;
  }

  return written + text.slice(copiedUpTo);
};

export type FindAddressAtEndFunction = (text: string) => string | null;

/*
 * What /\(([^)]+)\)\s*$/ found in a text: what is between the "(" and the
 * ")" that end it - white space may follow the ")" - from the first "("
 * after the ")" before that one; null when nothing is. The editor reads an
 * image placeholder's address back this way. Read once from the end, where
 * the pattern was tried from every "(" and read on from each to the next
 * ")".
 */
export const findAddressAtEnd: FindAddressAtEndFunction = (
  text: string,
): string | null => {
  let end: number = text.length;

  while (end > 0 && isWhiteSpaceCode(text.charCodeAt(end - 1))) {
    end--;
  }

  const closing: number = end - 1;

  // "(", at least one character, ")".
  if (closing < 2 || text.charCodeAt(closing) !== CLOSE_PAREN) {
    return null;
  }

  const opening: number = text.indexOf(
    "(",
    text.lastIndexOf(")", closing - 1) + 1,
  );

  if (opening === -1 || opening >= closing - 1) {
    return null;
  }

  return text.slice(opening + 1, closing);
};
