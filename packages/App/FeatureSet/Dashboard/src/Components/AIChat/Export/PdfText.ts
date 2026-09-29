/*
 * jsPDF's built-in fonts (Helvetica and friends) are single-byte and
 * WinAnsi-encoded, so they can only draw Latin-1. Anything outside that — an
 * arrow, a checkmark, an emoji, Cyrillic, CJK — would come out as the wrong
 * glyph or a dropped byte, and because the width tables still return a width
 * for those characters the damage shows up as broken layout rather than an
 * obvious error.
 *
 * Embedding a Unicode TTF would fix it properly but costs hundreds of KB and
 * still would not cover emoji (colour emoji needs font tables jsPDF does not
 * implement). So the export transliterates what it reasonably can, drops
 * emoji, and replaces the rest — and, crucially, reports that it did so, so
 * the document can say as much rather than quietly handing someone a page of
 * question marks they cannot explain.
 */

/*
 * Characters jsPDF can draw directly: printable ASCII plus the Latin-1
 * supplement. Deliberately excludes the cp1252 0x80-0x9F block; those are
 * transliterated below so we never depend on jsPDF's handling of it.
 */
function isDirectlyRenderable(codePoint: number): boolean {
  const isAscii: boolean = codePoint >= 0x20 && codePoint <= 0x7e;
  const isLatin1Supplement: boolean = codePoint >= 0xa0 && codePoint <= 0xff;
  return isAscii || isLatin1Supplement;
}

/*
 * Characters that appear routinely in assistant answers and in this app's own
 * widget captions, mapped to something Helvetica can actually draw.
 */
const TRANSLITERATIONS: Map<string, string> = new Map<string, string>([
  // cp1252 punctuation block.
  ["‘", "'"],
  ["’", "'"],
  ["‚", ","],
  ["“", '"'],
  ["”", '"'],
  ["„", '"'],
  ["–", "-"],
  ["—", "-"],
  ["…", "..."],
  ["•", "-"],
  ["†", "+"],
  ["‡", "++"],
  ["‰", "%o"],
  ["€", "EUR"],
  ["™", "(TM)"],
  ["Š", "S"],
  ["š", "s"],
  ["Ž", "Z"],
  ["ž", "z"],
  ["Œ", "OE"],
  ["œ", "oe"],
  ["Ÿ", "Y"],
  ["ƒ", "f"],
  // Symbols the model reaches for constantly.
  ["→", "->"],
  ["←", "<-"],
  ["↔", "<->"],
  ["⇒", "=>"],
  ["✓", "[ok]"],
  ["✔", "[ok]"],
  ["✗", "[x]"],
  ["✘", "[x]"],
  ["✅", "[ok]"],
  ["❌", "[x]"],
  ["⚠", "[!]"],
  ["≠", "!="],
  ["≤", "<="],
  ["≥", ">="],
  ["≈", "~"],
  ["●", "*"],
  ["○", "o"],
  ["▪", "-"],
  ["─", "-"],
  ["│", "|"],
  [" ", " "],
]);

const EMOJI_PATTERN: RegExp =
  /\p{Extended_Pictographic}|\p{Emoji_Presentation}/u;

export interface SanitizedText {
  text: string;
  // True when something could not be represented and was dropped or replaced.
  isLossy: boolean;
}

/*
 * Converts a string into something jsPDF's core fonts can draw, reporting
 * whether meaning was lost on the way.
 */
export function sanitizeForPdf(input: string): SanitizedText {
  if (!input) {
    return { text: "", isLossy: false };
  }

  let isLossy: boolean = false;
  const out: Array<string> = [];

  // Array.from iterates code points, so surrogate pairs stay intact.
  for (const character of Array.from(input.normalize("NFC"))) {
    const codePoint: number = character.codePointAt(0) || 0;

    if (codePoint === 0x0a || codePoint === 0x09) {
      out.push(character);
      continue;
    }

    if (isDirectlyRenderable(codePoint)) {
      out.push(character);
      continue;
    }

    const mapped: string | undefined = TRANSLITERATIONS.get(character);
    if (mapped !== undefined) {
      out.push(mapped);
      continue;
    }

    if (EMOJI_PATTERN.test(character)) {
      // Dropped rather than replaced: a row of "?" reads worse than nothing.
      isLossy = true;
      continue;
    }

    /*
     * Last resort before giving up: strip the accent and keep the base letter,
     * which rescues scripts like Latin Extended (Ł, ā, ș).
     */
    const stripped: string = character.normalize("NFKD").replace(/[̀-ͯ]/g, "");

    const isStrippedRenderable: boolean =
      stripped.length > 0 &&
      Array.from(stripped).every((char: string) => {
        return isDirectlyRenderable(char.codePointAt(0) || 0);
      });

    if (isStrippedRenderable) {
      out.push(stripped);
      continue;
    }

    isLossy = true;
    out.push("?");
  }

  return { text: out.join(""), isLossy: isLossy };
}
