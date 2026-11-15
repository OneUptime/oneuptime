import { setPathApartInSentence } from "./PathInSentence";

/*
 * A PATH AS A PERSON READS IT: what User Flows draws for a page (its map,
 * tooltips, panel, tables, journeys and every sentence about a page), and
 * what product analytics draws for one (#8196): an event "Viewed /café", a
 * breakdown or a segment by page, an entry page.
 *
 * A page is stored as the URL parser writes it, and the parser escapes
 * every letter outside ASCII: "/الرئيسية" is "/%D8%A7%D9%84...", "/café" is
 * "/caf%C3%A9". The stored page stays so: it is what a read matches, a link
 * and a saved view hold, and what the session list compares with the URLs
 * the browser escaped the same way. Only the words drawn for it are
 * decoded.
 *
 * Only an escape of a letter, a mark or a digit beyond ASCII is decoded:
 * the words of a path in Arabic, Persian, Chinese or with accents, and the
 * joiners inside a Persian or Hindi word. None of them is a separator, so
 * decoding one never changes which page is named. The rest is drawn as
 * written:
 *  - an escaped "/", "?", "#" or "%", which would read as a separator, a
 *    query, a fragment or another escape: "/a%2Fb" is one page, and not
 *    "/a/b", which may be another;
 *  - any other escape of an ASCII character, which a page can hold
 *    unescaped too: "%20" stays "%20";
 *  - punctuation and symbols, among them the signs drawn like a slash
 *    ("∕", "／"); spaces, controls and the marks that turn text round,
 *    which would move the words drawn round the path; and characters with
 *    no width, which would hide part of it;
 *  - bytes that are not UTF-8: a lone "%", "%E0%A4" cut short.
 *
 * Neither this module nor PathInSentence is inlined into the browser
 * recorder, so the Unicode property escapes below are safe here.
 */

// One escaped byte: "%D8".
const ESCAPED_BYTE_REGEX: RegExp = /^%[0-9A-Fa-f]{2}$/;

// A letter, a mark (an accent, a vowel sign) or a digit, of any script.
const WORD_CHARACTER_REGEX: RegExp = /^[\p{L}\p{M}\p{N}]$/u;

// Drawn with no width at all: a filler that looks like nothing, a selector.
const NO_WIDTH_CHARACTER_REGEX: RegExp = /^\p{Default_Ignorable_Code_Point}$/u;

/*
 * ZERO WIDTH NON-JOINER and ZERO WIDTH JOINER have no width either, but
 * they are part of a word: Persian keeps the parts of one word apart
 * with the first, and Hindi parts and joins its letters with both.
 */
const WORD_JOINERS: ReadonlyArray<string> = [
  String.fromCharCode(0x200c),
  String.fromCharCode(0x200d),
];

/*
 * How many bytes the character led by `byte` takes in UTF-8: 2 to 4, or 0
 * for an ASCII byte, a byte in the middle of a character and a lead UTF-8
 * never writes ("%C0%AF" is "/" written too long, which no decoder takes).
 */
function getUtf8Length(byte: number): number {
  if (byte >= 0xc2 && byte <= 0xdf) {
    return 2;
  }

  if (byte >= 0xe0 && byte <= 0xef) {
    return 3;
  }

  if (byte >= 0xf0 && byte <= 0xf4) {
    return 4;
  }

  return 0;
}

/*
 * The character `escapes` spell, when it is one a person reads as part of
 * a word; null for anything else, and for bytes that are not UTF-8: a
 * sequence cut short, one written too long, a surrogate
 * (decodeURIComponent refuses each).
 */
function decodeWordCharacter(escapes: string): string | null {
  for (let at: number = 0; at < escapes.length; at += 3) {
    if (!ESCAPED_BYTE_REGEX.test(escapes.slice(at, at + 3))) {
      return null;
    }
  }

  let character: string;

  try {
    character = decodeURIComponent(escapes);
  } catch {
    return null;
  }

  if (WORD_JOINERS.includes(character)) {
    return character;
  }

  return WORD_CHARACTER_REGEX.test(character) &&
    !NO_WIDTH_CHARACTER_REGEX.test(character)
    ? character
    : null;
}

/*
 * `path` with each escape of a word's letter decoded, and nothing else
 * changed: for a sentence that sets its values apart itself
 * (SentenceOptions.setsValuesApart). Anywhere else, draw getPathText.
 */
export function decodePathWords(path: string): string {
  if (!path.includes("%")) {
    return path;
  }

  let decoded: string = "";
  let index: number = 0;

  while (index < path.length) {
    const escape: string = path.slice(index, index + 3);

    if (!ESCAPED_BYTE_REGEX.test(escape)) {
      decoded += path.charAt(index);
      index += 1;
      continue;
    }

    const length: number = getUtf8Length(parseInt(escape.slice(1), 16)) * 3;
    const character: string | null =
      length > 0
        ? decodeWordCharacter(path.slice(index, index + length))
        : null;

    if (character === null) {
      decoded += escape;
      index += 3;
      continue;
    }

    decoded += character;
    index += length;
  }

  return decoded;
}

/*
 * A path to draw: its words decoded (decodePathWords) and, when it has a
 * letter of a script read from the right, set apart left to right.
 *
 * A path reads from the left on every page, its "/" first, and the Arabic
 * or Persian words in it still read from the right (RFC 3987's
 * bidirectional IRIs, as a browser's address bar draws them). Read the way
 * its letters do, "/الرئيسية" would be drawn "الرئيسية/". So a path with a
 * letter of a script read from the right is set apart, left to right (LRI
 * ... PDI), and reads so wherever it is drawn: in a box of its own, in a
 * sentence, on either side of an arrow, in an option. A path in letters
 * read from the left needs nothing, and comes back exactly as before.
 */
export function getPathText(path: string): string {
  return setPathApartInSentence(decodePathWords(path));
}
