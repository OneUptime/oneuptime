import {
  FIRST_STRONG_ISOLATE,
  isRightToLeftLanguage,
  POP_DIRECTIONAL_ISOLATE,
} from "./ReadingDirection";

/*
 * CODE IN A SENTENCE READ FROM THE RIGHT, DRAWN AS IT IS WRITTEN.
 *
 * An Arabic or Persian sentence that names a function, a path or a flag -
 * "تُلتقط المقاييس المخصصة ... باستخدام oneuptime.captureMetric()." - is
 * laid out by the Unicode bidi algorithm as one paragraph read from the
 * right. The letters of the code are a run read from the left, but the
 * signs at its ends are not letters: they take the sentence's direction,
 * and the browser draws them at the code's other end. The brackets of
 * oneuptime.captureMetric() came out before its name, the slash of
 * /api/v1/users after it, and --help read help--. The words in the locale
 * files were right; only the drawing was wrong.
 *
 * So in a sentence of a language read from the right, each stretch of
 * text in letters read from the left that holds code is set apart in a
 * Unicode LEFT-TO-RIGHT ISOLATE (LRI ... PDI): inside it, it reads from
 * the left with every sign where it was written, and the sentence around
 * it still reads from the right, the isolate one piece of it. It is done
 * as the words are handed to the page, not in the locale files: every
 * frontend's i18next runs each translated sentence through it
 * (Common/UI/Utils/CodeReadsAsWritten), so a sentence added tomorrow, or
 * a language read from the right added next year, is drawn right without
 * anyone remembering to.
 *
 * Only what the browser would draw wrongly is set apart. A stretch whose
 * first and last signs are letters or digits is drawn right as it is
 * ("Node.js", "helm upgrade --reuse-values", "Pub/Sub"), and so is a
 * bracket round words ("track('signup')"), which the bidi algorithm pairs
 * with the letters before it. What is set apart starts or ends with a sign
 * that belongs to the code: a function's brackets, a path's slash, a
 * file's or a flag's leading dot or dash, a glob's star, a sign beside a
 * number ("+1", "-2", "{{count}}+"). So is an expression that starts
 * with a number - a cron line, "2^64", "2001:db8::1" - whose digits the
 * bidi algorithm reads as a number of the sentence's. What belongs to the
 * sentence stays outside: the full stop after the code, the brackets and
 * quotation marks the sentence puts round it, a slash or an arrow set off
 * by spaces between two words ("CPU / الذاكرة", "APM > الخدمات"), or a
 * slash joining a word to the sentence's own ("CPU/الذاكرة").
 *
 * A {{placeholder}} is one piece that is never cut. Inside code it is set
 * apart once more, in a first-strong isolate (FSI ... PDI), so a value in
 * Arabic letters still reads the way its own letters do; and one written
 * onto a word of the code ("v{{version}}", "{{url}}/otlp") sets the code
 * apart, as its value may come in an isolate of its own. Stretches of
 * nothing but values and signs - "~{{time}} {{count}}" - are read value by
 * value: a sign stays with the value it is written beside, and two values
 * keep the sentence's order. An HTML tag ("<p>"), a value's isolate or an
 * isolate already in the sentence is never entered, and a sentence with no
 * letter of a script read from the right - English left on the page, a
 * name, an example - is left as it is: it reads from the left already.
 */

// LEFT-TO-RIGHT ISOLATE: what follows it, up to its PDI, reads from the left.
export const LEFT_TO_RIGHT_ISOLATE: string = String.fromCharCode(0x2066);

const RIGHT_TO_LEFT_ISOLATE: string = String.fromCharCode(0x2067);

// A mark that reads from the left, placed by hand: it steadies a sign itself.
const LEFT_TO_RIGHT_MARK: string = String.fromCharCode(0x200e);

/*
 * A letter, a sign or a mark of a script read from the right: Arabic
 * (with its comma, semicolon and question mark, and its digits), Hebrew,
 * Syriac, Thaana, N'Ko and the others ReadingDirection names, and the
 * RIGHT-TO-LEFT MARK. Each ends a stretch of left-to-right text.
 */
const RIGHT_TO_LEFT_CHARACTER_REGEX: RegExp =
  /[\p{Script_Extensions=Arabic}\p{Script_Extensions=Hebrew}\p{Script_Extensions=Syriac}\p{Script_Extensions=Thaana}\p{Script_Extensions=Nko}\p{Script_Extensions=Adlam}\p{Script_Extensions=Hanifi_Rohingya}\p{Script_Extensions=Mandaic}\p{Script_Extensions=Samaritan}\u{200F}]/u;

// A run of them: one piece of the sentence's own, however long.
const RIGHT_TO_LEFT_RUN_REGEX: RegExp = new RegExp(
  `${RIGHT_TO_LEFT_CHARACTER_REGEX.source}+`,
  "uy",
);

// A letter of any script, with its accents.
const LETTER_REGEX: RegExp = /^[\p{L}\p{M}]$/u;

/*
 * Two letters, each with its accents or vowel signs, at the end of a text:
 * a word, not a letter written onto what follows it. Read on the last
 * WORD_END_LENGTH characters only.
 */
const WORD_AT_END_REGEX: RegExp = /\p{L}\p{M}{0,4}\p{L}\p{M}{0,4}$/u;

const WORD_END_LENGTH: number = 16;

// One decimal digit, of any script.
const DIGIT_REGEX: RegExp = /^\p{Nd}$/u;

// A space of any width.
const SPACE_REGEX: RegExp = /^\s$/u;

/*
 * A line's end, an embedding, an override or the end of an isolate: no
 * stretch of text runs across one.
 */
const STRETCH_BREAK_REGEX: RegExp =
  /^[\r\n\u{2028}\u{2029}\u{85}\u{202A}-\u{202E}\u{2069}]$/u;

// A {{placeholder}}, which a value fills: one piece, never cut.
const PLACEHOLDER_REGEX: RegExp = /\{\{[^{}]*\}\}/y;

// Every {{placeholder}} in a piece of code.
const PLACEHOLDERS_REGEX: RegExp = /\{\{[^{}]*\}\}/g;

/*
 * An HTML tag a sentence holds - "<p>", "</p>", "<br/>", "<a href=...>" -
 * or a numbered one a translation fills with an element ("<0>", "</0>"):
 * never entered, and no code runs across one. A placeholder of code's own
 * in angle brackets ("<token>", "<file>", "<link>") is not a tag: it is
 * part of the code.
 */
const MARKUP_TAG_REGEX: RegExp =
  /<\/?(?:\d{1,3}|a|abbr|b|bdi|bdo|blockquote|br|code|dd|del|div|dl|dt|em|h[1-6]|hr|i|img|ins|kbd|li|mark|ol|p|pre|q|s|samp|small|span|strong|sub|sup|table|tbody|td|th|thead|tr|u|ul)(?:\s[^<>]{0,256})?\/?>/y;

// An HTML entity - "&rsaquo;", "&#8250;": one sign, never cut.
const ENTITY_REGEX: RegExp =
  /&(?:[A-Za-z][A-Za-z0-9]{1,31}|#\d{1,7}|#[xX][\dA-Fa-f]{1,6});/y;

/*
 * A Markdown link's target - the "(/docs/...)" of "[words](/docs/...)":
 * never drawn, so never entered. A mark inside it would be part of the
 * address the link opens.
 */
const LINK_TARGET_REGEX: RegExp = /\([^()\s]{0,2048}\)/y;

/*
 * The signs a sentence ends a clause with. One right after the code is
 * the sentence's, not the code's: "grantConsent().", "webcal://.",
 * "{{itemsName}}…" - but not after a backslash ("^orders\.").
 */
const SENTENCE_STOPS: ReadonlyArray<string> = [
  ".",
  ",",
  ";",
  ":",
  "!",
  "?",
  "\u{2026}",
];

// Brackets and quotation marks that open, and the sign that closes each.
const CLOSING_SIGN_OF: Readonly<Record<string, string>> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "\u{00AB}": "\u{00BB}",
  "\u{201C}": "\u{201D}",
  "\u{2018}": "\u{2019}",
  "\u{2039}": "\u{203A}",
};

const CLOSING_SIGNS: ReadonlyArray<string> = Object.values(CLOSING_SIGN_OF);

/*
 * The brackets the bidi algorithm pairs (its paired brackets): one round
 * letters takes their direction. A quotation mark is never paired - the
 * closing quote of crossorigin="anonymous" went to the far end of the code.
 */
const BIDI_BRACKETS: ReadonlyArray<string> = ["(", ")", "[", "]", "{", "}"];

// Quotation marks that open and close with the same sign.
const SAME_SIGN_QUOTES: ReadonlyArray<string> = ['"', "'", "`"];

// Between two letters these are apostrophes ("it's"), not quotation marks.
const APOSTROPHES: ReadonlyArray<string> = ["'", "\u{2019}"];

/*
 * Signs that join the number beside them (the bidi algorithm's European
 * terminators): "#12", "$5", "90%", "21°" are drawn right as they are.
 * A plus or a minus is not one: "-2" and "+1" lost their sign to the
 * number's other end.
 */
const NUMBER_SIGNS: ReadonlyArray<string> = [
  "#",
  "$",
  "%",
  "\u{00B1}",
  "\u{00B0}",
  "\u{2030}",
  "\u{00A2}",
  "\u{00A3}",
  "\u{00A5}",
  "\u{20AC}",
  "\u{20B9}",
];

/*
 * Signs the bidi algorithm keeps inside a number when they stand between
 * two digits (its common and European separators): "10.0.0.1", "1,000",
 * "24/7", "09:00", "1-5".
 */
const NUMBER_JOINERS: ReadonlyArray<string> = [
  ".",
  ",",
  "/",
  ":",
  "+",
  "-",
  "\u{00A0}",
  "\u{2212}",
];

/*
 * Signs that set a number off from what follows it - a dash between two
 * numbers, a dot between two items: "70–85%", "عاملون: 2 · Docker". The
 * sentence's own, drawn in its direction.
 */
const NUMBER_SEPARATORS: ReadonlyArray<string> = [
  "\u{2013}",
  "\u{2014}",
  "\u{00B7}",
  "\u{2022}",
];

// Markdown's emphasis: "**bold**", "__bold__" - drawn as style, not as signs.
const EMPHASIS_SIGNS: ReadonlyArray<string> = ["*", "_"];

/*
 * How deep brackets pair: as deep as the bidi algorithm pairs them (its
 * stack holds 63). Brackets opened deeper are left unpaired, so a text
 * of nothing but brackets is read in time that grows with its length.
 */
const MOST_OPEN_BRACKETS: number = 63;

// How far an expression from a number is read for the sign that makes it one.
const MOST_EXPRESSION_PIECES: number = 128;

/*
 * How many times a stretch is trimmed of what belongs to the sentence -
 * a space, a full stop, a quotation mark - before what is left is read:
 * a sentence needs a handful, and a text of thousands of signs is not
 * trimmed one sign at a time.
 */
const MOST_PEELS: number = 64;

type PieceKind =
  | "letter"
  | "digit"
  | "placeholder"
  | "mark"
  | "space"
  | "sign"
  // A letter, a sign or a mark of a script read from the right.
  | "sentence"
  // A line's end, an HTML tag, or a whole isolate.
  | "break";

interface Piece {
  kind: PieceKind;
  text: string;
  start: number;
  end: number;
}

// Where code sits in a sentence: [start, end) in the sentence's characters.
export interface CodeInSentence {
  start: number;
  end: number;
  text: string;
}

// The whole match of a sticky `regex` at `index` in `text`, or null.
const matchAt: (regex: RegExp, text: string, index: number) => string | null =
  (regex: RegExp, text: string, index: number): string | null => {
    regex.lastIndex = index;
    const match: RegExpExecArray | null = regex.exec(text);

    return match ? match[0] : null;
  };

/*
 * The sentence cut into pieces: a character, a {{placeholder}} or an HTML
 * entity whole, or a break - a line's end, an HTML tag, or a whole isolate
 * (LRI, RLI or FSI up to its PDI), which is never entered.
 */
const getPieces: (sentence: string) => Array<Piece> = (
  sentence: string,
): Array<Piece> => {
  const pieces: Array<Piece> = [];
  let index: number = 0;

  while (index < sentence.length) {
    const words: string | null = matchAt(
      RIGHT_TO_LEFT_RUN_REGEX,
      sentence,
      index,
    );

    if (words) {
      pieces.push({
        kind: "sentence",
        text: words,
        start: index,
        end: index + words.length,
      });
      index += words.length;
      continue;
    }

    const codePoint: number = sentence.codePointAt(index) as number;
    const character: string = String.fromCodePoint(codePoint);
    const next: number = index + character.length;

    if (
      character === LEFT_TO_RIGHT_ISOLATE ||
      character === RIGHT_TO_LEFT_ISOLATE ||
      character === FIRST_STRONG_ISOLATE
    ) {
      // To its PDI, counting the isolates inside it.
      let depth: number = 1;
      let end: number = next;

      while (end < sentence.length && depth > 0) {
        const inner: string = sentence.charAt(end);

        if (
          inner === LEFT_TO_RIGHT_ISOLATE ||
          inner === RIGHT_TO_LEFT_ISOLATE ||
          inner === FIRST_STRONG_ISOLATE
        ) {
          depth++;
        } else if (inner === POP_DIRECTIONAL_ISOLATE) {
          depth--;
        }

        end++;
      }

      pieces.push({
        kind: "break",
        text: sentence.slice(index, end),
        start: index,
        end: end,
      });
      index = end;
      continue;
    }

    let whole: string | null = null;
    let wholeKind: PieceKind = "sign";

    if (character === "{") {
      whole = matchAt(PLACEHOLDER_REGEX, sentence, index);
      wholeKind = "placeholder";
    } else if (character === "<") {
      whole = matchAt(MARKUP_TAG_REGEX, sentence, index);
      wholeKind = "break";
    } else if (character === "&") {
      whole = matchAt(ENTITY_REGEX, sentence, index);
      wholeKind = "sign";
    } else if (character === "(" && sentence.charAt(index - 1) === "]") {
      whole = matchAt(LINK_TARGET_REGEX, sentence, index);
      wholeKind = "break";
    }

    if (whole) {
      pieces.push({
        kind: wholeKind,
        text: whole,
        start: index,
        end: index + whole.length,
      });
      index += whole.length;
      continue;
    }

    let kind: PieceKind = "sign";

    if (STRETCH_BREAK_REGEX.test(character)) {
      kind = "break";
    } else if (character === LEFT_TO_RIGHT_MARK) {
      kind = "mark";
    } else if (LETTER_REGEX.test(character)) {
      kind = "letter";
    } else if (DIGIT_REGEX.test(character)) {
      kind = "digit";
    } else if (SPACE_REGEX.test(character)) {
      kind = "space";
    }

    pieces.push({ kind, text: character, start: index, end: next });
    index = next;
  }

  return pieces;
};

// A piece the bidi algorithm reads in its own direction: a word, a number, a value.
const isStrong: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  return (
    piece !== undefined &&
    (piece.kind === "letter" ||
      piece.kind === "digit" ||
      piece.kind === "placeholder" ||
      piece.kind === "mark")
  );
};

// What code is made of, beside its signs: a letter, a digit or a value.
const isContent: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  return (
    piece !== undefined &&
    (piece.kind === "letter" ||
      piece.kind === "digit" ||
      piece.kind === "placeholder")
  );
};

const isNumberLike: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  return (
    piece !== undefined &&
    (piece.kind === "digit" || piece.kind === "placeholder")
  );
};

const isSign: (
  piece: Piece | undefined,
  signs: ReadonlyArray<string>,
) => boolean = (
  piece: Piece | undefined,
  signs: ReadonlyArray<string>,
): boolean => {
  return (
    piece !== undefined && piece.kind === "sign" && signs.includes(piece.text)
  );
};

// A bracket or a quotation mark, opening or closing.
const isBracket: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  return (
    piece !== undefined &&
    piece.kind === "sign" &&
    (CLOSING_SIGN_OF[piece.text] !== undefined ||
      CLOSING_SIGNS.includes(piece.text) ||
      SAME_SIGN_QUOTES.includes(piece.text))
  );
};

// A bracket or a quotation mark that closes.
const isClosingSign: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  return (
    piece !== undefined &&
    piece.kind === "sign" &&
    (CLOSING_SIGNS.includes(piece.text) ||
      SAME_SIGN_QUOTES.includes(piece.text))
  );
};

// An apostrophe between two letters ("it's", "it’s"): part of the word.
const isApostrophe: (pieces: ReadonlyArray<Piece>, index: number) => boolean = (
  pieces: ReadonlyArray<Piece>,
  index: number,
): boolean => {
  return (
    isSign(pieces[index], APOSTROPHES) &&
    pieces[index - 1]?.kind === "letter" &&
    pieces[index + 1]?.kind === "letter"
  );
};

/*
 * Which bracket or quotation mark closes which, in one stretch of text:
 * partner[i] is the piece that opens or closes with piece i, or -1. A
 * quotation mark written with the same sign at both ends pairs with the
 * next one; an apostrophe between two letters ("it's") is not one.
 */
const getPartners: (pieces: ReadonlyArray<Piece>) => Array<number> = (
  pieces: ReadonlyArray<Piece>,
): Array<number> => {
  const partner: Array<number> = pieces.map((): number => {
    return -1;
  });
  const opened: Array<number> = [];
  const openQuote: Record<string, number> = {};

  pieces.forEach((piece: Piece, index: number): void => {
    if (!isBracket(piece) || isApostrophe(pieces, index)) {
      return;
    }

    if (SAME_SIGN_QUOTES.includes(piece.text)) {
      const before: number | undefined = openQuote[piece.text];

      if (before === undefined) {
        openQuote[piece.text] = index;
      } else {
        partner[before] = index;
        partner[index] = before;
        delete openQuote[piece.text];
      }

      return;
    }

    if (CLOSING_SIGN_OF[piece.text] !== undefined) {
      // As deep as the bidi algorithm pairs brackets, and no deeper.
      if (opened.length < MOST_OPEN_BRACKETS) {
        opened.push(index);
      }

      return;
    }

    // A closing sign pairs with the nearest bracket still open that it closes.
    for (let depth: number = opened.length - 1; depth >= 0; depth--) {
      const openerIndex: number = opened[depth] as number;
      const opener: Piece = pieces[openerIndex] as Piece;

      if (CLOSING_SIGN_OF[opener.text] === piece.text) {
        partner[openerIndex] = index;
        partner[index] = openerIndex;
        opened.length = depth;
        return;
      }
    }
  });

  return partner;
};

/*
 * Whether pieces (from, to) - both ends left out - hold a letter: a
 * bracket round letters takes their direction ("track('signup')"), one
 * round a number or a value only does not ("getItem(2)").
 */
const holdsLetters: (
  pieces: ReadonlyArray<Piece>,
  from: number,
  to: number,
) => boolean = (
  pieces: ReadonlyArray<Piece>,
  from: number,
  to: number,
): boolean => {
  for (let index: number = from + 1; index < to; index++) {
    if (pieces[index]?.kind === "letter") {
      return true;
    }
  }

  return false;
};

/*
 * Whether the sentence's words right after a stretch start with a letter:
 * a sign between the two ("CPU/الذاكرة") joins two words. Before the
 * sentence's comma ("<key>،") or a mark, a sign is the code's own.
 */
const isBeforeWord: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  if (piece?.kind !== "sentence") {
    return false;
  }

  const character: string = String.fromCodePoint(
    piece.text.codePointAt(0) as number,
  );

  return LETTER_REGEX.test(character);
};

/*
 * Whether the sentence's words right before a stretch end in a word of
 * two letters or more ("الذاكرة/CPU"). A letter on its own is a prefix
 * written onto the code - "و/orders/2" is "and /orders/2" - and the sign
 * after it is the code's.
 */
const isAfterWord: (piece: Piece | undefined) => boolean = (
  piece: Piece | undefined,
): boolean => {
  if (piece?.kind !== "sentence") {
    return false;
  }

  // Its last letters, with their vowel signs: never more than a few.
  return WORD_AT_END_REGEX.test(piece.text.slice(-WORD_END_LENGTH));
};

/*
 * Whether a stretch is an expression that starts with a number - the cron
 * line "0 9 * * 1-5", "2^64", "0=inactive", "2001:db8::1". In a
 * sentence read from the right the bidi algorithm reads its digits as a
 * number of the sentence's, and a sign after them that does not join two
 * digits takes the sentence's direction: the expression was drawn back to
 * front. A star, or a sign written between two pieces of it, makes one.
 * A number on its own, with the signs it is written with ("10.0.0.1",
 * "99.9%", "1,000 USD"), and one the sentence sets off - by a space, a
 * bracket, a dash or a dot ("10 = ...", "1433 (SQL Server)", "70–85%") -
 * is the sentence's, drawn in its order.
 */
const isNumberExpression: (
  pieces: ReadonlyArray<Piece>,
  from: number,
  to: number,
) => boolean = (
  pieces: ReadonlyArray<Piece>,
  from: number,
  to: number,
): boolean => {
  // Read no further than an expression runs: a text of thousands of signs is no cron line.
  const end: number = Math.min(to, from + MOST_EXPRESSION_PIECES);
  let index: number = from;

  while (index < end && !isContent(pieces[index])) {
    index++;
  }

  if (index >= end || pieces[index]?.kind !== "digit") {
    return false;
  }

  for (; index < end; index++) {
    const piece: Piece = pieces[index] as Piece;

    if (piece.kind === "letter") {
      return false;
    }

    if (piece.kind !== "sign") {
      continue;
    }

    if (piece.text === "*") {
      return true;
    }

    const before: Piece | undefined =
      index > from ? pieces[index - 1] : undefined;
    const after: Piece | undefined =
      index < to - 1 ? pieces[index + 1] : undefined;

    const isBetweenPieces: boolean =
      before !== undefined &&
      after !== undefined &&
      before.kind !== "space" &&
      after.kind !== "space";

    const isNumbers: boolean =
      (isSign(piece, NUMBER_JOINERS) &&
        before?.kind === "digit" &&
        after?.kind === "digit") ||
      isSign(piece, NUMBER_SIGNS);

    if (
      isBetweenPieces &&
      !isNumbers &&
      !isBracket(piece) &&
      !isSign(piece, NUMBER_SEPARATORS)
    ) {
      return true;
    }
  }

  return false;
};

/*
 * The code in one stretch of left-to-right text, if it needs setting
 * apart: the stretch without what belongs to the sentence around it, or
 * null when it reads right as it is.
 */
const getCodeInStretch: (
  pieces: ReadonlyArray<Piece>,
  touchesSentenceAtStart: boolean,
  touchesSentenceAtEnd: boolean,
) => { from: number; to: number } | null = (
  pieces: ReadonlyArray<Piece>,
  touchesSentenceAtStart: boolean,
  touchesSentenceAtEnd: boolean,
): { from: number; to: number } | null => {
  const partner: Array<number> = getPartners(pieces);
  let from: number = 0;
  let to: number = pieces.length;
  let gluedAtStart: boolean = touchesSentenceAtStart;
  let gluedAtEnd: boolean = touchesSentenceAtEnd;

  // Whether the sentence quotes the code: its last full stop is then the code's.
  let isQuoted: boolean = false;

  // A sign whose partner is inside the code: the code's own.
  const isPairedWithin: (index: number) => boolean = (
    index: number,
  ): boolean => {
    const other: number = partner[index] as number;
    return other >= from && other < to;
  };

  // Markdown's strong emphasis, "**" or "__", starting at `index`.
  const isEmphasisRun: (index: number) => boolean = (
    index: number,
  ): boolean => {
    return (
      isSign(pieces[index], EMPHASIS_SIGNS) &&
      pieces[index + 1]?.kind === "sign" &&
      pieces[index + 1]?.text === pieces[index]?.text
    );
  };

  // Whether a run of `sign` twice starts in [start, end - 1).
  const hasEmphasisRun: (sign: string, start: number, end: number) => boolean =
    (sign: string, start: number, end: number): boolean => {
      for (let index: number = start; index < end - 1; index++) {
        if (pieces[index]?.text === sign && isEmphasisRun(index)) {
          return true;
        }
      }

      return false;
    };

  let isChanged: boolean = true;
  let peeled: number = 0;

  while (isChanged && from < to && peeled < MOST_PEELS) {
    isChanged = false;
    peeled++;

    while (from < to && pieces[from]?.kind === "space") {
      from++;
      gluedAtStart = false;
      isChanged = true;
    }

    while (to > from && pieces[to - 1]?.kind === "space") {
      to--;
      gluedAtEnd = false;
      isChanged = true;
    }

    if (from >= to) {
      break;
    }

    const first: Piece = pieces[from] as Piece;
    const last: Piece = pieces[to - 1] as Piece;

    /*
     * A bracket or a quotation mark the sentence puts round the whole
     * code. What a quotation holds is quoted whole: its last full stop
     * is the code's own ("without «client.»").
     */
    if (isBracket(first) && partner[from] === to - 1 && from < to - 1) {
      isQuoted = isQuoted || !BIDI_BRACKETS.includes(first.text);
      from++;
      to--;
      gluedAtStart = false;
      gluedAtEnd = false;
      isChanged = true;
      continue;
    }

    // A bracket or a quotation mark whose partner is not here: the sentence's.
    if (isBracket(last) && !isPairedWithin(to - 1)) {
      to--;
      gluedAtEnd = false;
      isChanged = true;
      continue;
    }

    if (isBracket(first) && !isPairedWithin(from)) {
      from++;
      gluedAtStart = false;
      isChanged = true;
      continue;
    }

    /*
     * The sentence's full stop, comma or colon after the code: one sign
     * on its own ("grantConsent().", "webcal://."), or several after a
     * word, a number or a bracket ("Docker...", "{{count}}):"). Several
     * after a sign are the code's own: "x-oneuptime-token=...". A stop
     * after a backslash is the code's too: "^orders\.".
     */
    if (!isQuoted && isSign(last, SENTENCE_STOPS) && to - from >= 2) {
      let stops: number = to - 1;

      while (stops > from && isSign(pieces[stops - 1], SENTENCE_STOPS)) {
        stops--;
      }

      const before: Piece | undefined = pieces[stops - 1];
      const isOneStop: boolean = stops === to - 1;

      if (
        stops > from &&
        before?.text !== "\\" &&
        (isOneStop ||
          isStrong(before) ||
          isClosingSign(before) ||
          (isSign(before, NUMBER_SIGNS) && isNumberLike(pieces[stops - 2])))
      ) {
        to = stops;
        gluedAtEnd = false;
        isChanged = true;
        continue;
      }
    }

    /*
     * Markdown's emphasis at either end: "**CPU" is drawn as CPU in bold,
     * and "**Settings**" round the whole code is the sentence's. One that
     * closes inside the code is the code's: "**Settings → Command**
     * `--help`" is set apart from its first sign.
     */
    const isBoldAtStart: boolean = isEmphasisRun(from);
    const isBoldAtEnd: boolean = to - from >= 4 && isEmphasisRun(to - 2);

    if (
      isBoldAtStart &&
      isBoldAtEnd &&
      first.text === last.text &&
      to - from >= 5 &&
      !hasEmphasisRun(first.text, from + 2, to - 2)
    ) {
      from += 2;
      to -= 2;
      gluedAtStart = false;
      gluedAtEnd = false;
      isChanged = true;
      continue;
    }

    if (isBoldAtStart && !hasEmphasisRun(first.text, from + 2, to)) {
      from += 2;
      gluedAtStart = false;
      isChanged = true;
      continue;
    }

    if (isBoldAtEnd && !hasEmphasisRun(last.text, from, to - 2)) {
      to -= 2;
      gluedAtEnd = false;
      isChanged = true;
      continue;
    }

    // Emphasis round the whole code, "_{{name}}_", or a glob's "*api*": as written.
    if (
      isSign(first, EMPHASIS_SIGNS) &&
      last.text === first.text &&
      to - from >= 3
    ) {
      from++;
      to--;
      gluedAtStart = false;
      gluedAtEnd = false;
      isChanged = true;
      continue;
    }

    /*
     * Signs on their own between the code and the sentence - "/ LLM",
     * "CPU /", "APM >": a separator of the sentence's, set off by a space.
     */
    let firstSpace: number = -1;

    for (let index: number = from; index < to; index++) {
      if (pieces[index]?.kind === "space") {
        firstSpace = index;
        break;
      }

      if (isStrong(pieces[index])) {
        break;
      }
    }

    if (firstSpace > from) {
      from = firstSpace;
      gluedAtStart = false;
      isChanged = true;
      continue;
    }

    let lastSpace: number = -1;

    // An expression from a number keeps its stars and signs: "0 9 * * 1-5".
    const isExpression: boolean = isNumberExpression(pieces, from, to);

    for (let index: number = to - 1; !isExpression && index >= from; index--) {
      if (pieces[index]?.kind === "space") {
        lastSpace = index;
        break;
      }

      if (isStrong(pieces[index])) {
        break;
      }
    }

    if (lastSpace !== -1 && lastSpace < to - 1) {
      to = lastSpace;
      gluedAtEnd = false;
      isChanged = true;
      continue;
    }

    /*
     * Signs that join a word to the sentence's own with no space -
     * "CPU/الذاكرة": the sentence's, drawn between the two as it is. A
     * bracket closed or opened inside the code is the code's own.
     */
    if (gluedAtEnd && first !== last && last.kind === "sign") {
      let index: number = to - 1;

      while (
        index > from &&
        pieces[index]?.kind === "sign" &&
        !isPairedWithin(index)
      ) {
        index--;
      }

      if (
        index < to - 1 &&
        (isStrong(pieces[index]) || isPairedWithin(index))
      ) {
        to = index + 1;
        gluedAtEnd = false;
        isChanged = true;
        continue;
      }
    }

    if (gluedAtStart && first !== last && first.kind === "sign") {
      let index: number = from;

      while (
        index < to - 1 &&
        pieces[index]?.kind === "sign" &&
        !isPairedWithin(index)
      ) {
        index++;
      }

      if (index > from && (isStrong(pieces[index]) || isPairedWithin(index))) {
        from = index;
        gluedAtStart = false;
        isChanged = true;
        continue;
      }
    }
  }

  let hasContent: boolean = false;

  for (let index: number = from; index < to; index++) {
    if (isContent(pieces[index])) {
      hasContent = true;
      break;
    }
  }

  if (!hasContent) {
    return null;
  }

  // The first and last signs drawn: Markdown's "**" is drawn as bold, not as signs.
  let drawnFrom: number = from;
  let drawnTo: number = to;

  while (drawnTo - drawnFrom > 2 && isEmphasisRun(drawnFrom)) {
    drawnFrom += 2;
  }

  while (drawnTo - drawnFrom > 2 && isEmphasisRun(drawnTo - 2)) {
    drawnTo -= 2;
  }

  const first: Piece = pieces[drawnFrom] as Piece;
  const last: Piece = pieces[drawnTo - 1] as Piece;

  /*
   * Whether the piece at an edge of the code is drawn where it is written.
   * A {{placeholder}} written onto a word of the code is not -
   * "v{{version}}", "{{url}}/otlp", "{{allowWrites}}=true": the value it is
   * filled with may come in an isolate of its own (Translator's
   * setsValuesApart), which the bidi algorithm reads as a sign, and it was
   * drawn at the word's other end. Between values and signs only it is a
   * number's - "{{online}}/{{count}}", "{{min}}–{{max}} ms" - and drawn as
   * the sentence draws numbers.
   */
  const isDrawnRightAtEdge: (index: number, inward: number) => boolean = (
    index: number,
    inward: number,
  ): boolean => {
    const piece: Piece | undefined = pieces[index];

    if (piece?.kind !== "placeholder") {
      return isStrong(piece);
    }

    for (
      let next: number = index + inward;
      next >= drawnFrom && next < drawnTo;
      next += inward
    ) {
      const kind: PieceKind | undefined = pieces[next]?.kind;

      if (kind === "letter" || kind === "digit") {
        return false;
      }

      if (kind === "space") {
        return true;
      }
    }

    return true;
  };

  const startsRight: boolean =
    isDrawnRightAtEdge(drawnFrom, 1) ||
    (isSign(first, BIDI_BRACKETS) &&
      isPairedWithin(drawnFrom) &&
      holdsLetters(pieces, drawnFrom, partner[drawnFrom] as number)) ||
    (isSign(first, NUMBER_SIGNS) && isNumberLike(pieces[drawnFrom + 1]));

  const endsRight: boolean =
    isDrawnRightAtEdge(drawnTo - 1, -1) ||
    (isSign(last, BIDI_BRACKETS) &&
      isPairedWithin(drawnTo - 1) &&
      holdsLetters(pieces, partner[drawnTo - 1] as number, drawnTo - 1)) ||
    (isSign(last, NUMBER_SIGNS) && isNumberLike(pieces[drawnTo - 2]));

  if (startsRight && endsRight && !isNumberExpression(pieces, from, to)) {
    return null;
  }

  return { from, to };
};

/*
 * Where the code that needs setting apart sits in `sentence`, read as a
 * sentence of a language read from the right. Empty when the sentence has
 * no letter of such a script.
 */
export const getCodeInSentence: (sentence: string) => Array<CodeInSentence> =
  (sentence: string): Array<CodeInSentence> => {
    if (!sentence || !RIGHT_TO_LEFT_CHARACTER_REGEX.test(sentence)) {
      return [];
    }

    const pieces: Array<Piece> = getPieces(sentence);
    const found: Array<CodeInSentence> = [];

    const readPart: (
      part: ReadonlyArray<Piece>,
      touchesSentenceAtStart: boolean,
      touchesSentenceAtEnd: boolean,
    ) => void = (
      part: ReadonlyArray<Piece>,
      touchesSentenceAtStart: boolean,
      touchesSentenceAtEnd: boolean,
    ): void => {
      if (part.length === 0) {
        return;
      }

      const code: { from: number; to: number } | null = getCodeInStretch(
        part,
        touchesSentenceAtStart,
        touchesSentenceAtEnd,
      );

      if (code) {
        const start: number = (part[code.from] as Piece).start;
        const end: number = (part[code.to - 1] as Piece).end;

        found.push({ start, end, text: sentence.slice(start, end) });
      }
    };

    /*
     * One stretch of left-to-right text, read part by part: a bracket or a
     * quotation mark whose partner is beyond the stretch belongs to the
     * sentence and ends a part ("--reset-then-reuse-values (Helm 3.14 أو
     * أحدث)"), and so does a space in a stretch of nothing but values and
     * signs ("~{{time}} {{count}}").
     */
    const readStretch: (start: number, end: number) => void = (
      start: number,
      end: number,
    ): void => {
      const stretch: Array<Piece> = pieces.slice(start, end);

      // A space or a sign between the sentence's words holds no code.
      if (!stretch.some(isContent)) {
        return;
      }

      const touchesSentenceAtStart: boolean = isAfterWord(pieces[start - 1]);
      const touchesSentenceAtEnd: boolean = isBeforeWord(pieces[end]);
      const partner: Array<number> = getPartners(stretch);
      const isValuesOnly: boolean = !stretch.some((piece: Piece): boolean => {
        return piece.kind === "letter" || piece.kind === "digit";
      });
      let partStart: number = 0;

      stretch.forEach((piece: Piece, index: number): void => {
        const endsPart: boolean =
          (isBracket(piece) &&
            !SAME_SIGN_QUOTES.includes(piece.text) &&
            partner[index] === -1 &&
            !isApostrophe(stretch, index)) ||
          (isValuesOnly && piece.kind === "space");

        if (!endsPart) {
          return;
        }

        readPart(
          stretch.slice(partStart, index),
          partStart === 0 && touchesSentenceAtStart,
          false,
        );
        partStart = index + 1;
      });

      readPart(
        stretch.slice(partStart),
        partStart === 0 && touchesSentenceAtStart,
        touchesSentenceAtEnd,
      );
    };

    let stretchStart: number = 0;

    pieces.forEach((piece: Piece, index: number): void => {
      if (piece.kind === "sentence" || piece.kind === "break") {
        readStretch(stretchStart, index);
        stretchStart = index + 1;
      }
    });

    readStretch(stretchStart, pieces.length);

    return found;
  };

/*
 * `sentence` as a page shows it to a reader of `language`: in a language
 * read from the right, each piece of code set apart in a left-to-right
 * isolate, and each {{placeholder}} inside it in a first-strong one (see
 * above); in any other language, as it is.
 */
export const setCodeApartInSentence: (
  sentence: string,
  language: string | null | undefined,
) => string = (
  sentence: string,
  language: string | null | undefined,
): string => {
  if (!sentence || !isRightToLeftLanguage(language)) {
    return sentence;
  }

  const code: Array<CodeInSentence> = getCodeInSentence(sentence);

  if (code.length === 0) {
    return sentence;
  }

  let result: string = "";
  let at: number = 0;

  for (const piece of code) {
    const text: string = piece.text.replace(
      PLACEHOLDERS_REGEX,
      (placeholder: string): string => {
        return `${FIRST_STRONG_ISOLATE}${placeholder}${POP_DIRECTIONAL_ISOLATE}`;
      },
    );

    result += `${sentence.slice(at, piece.start)}${LEFT_TO_RIGHT_ISOLATE}${text}${POP_DIRECTIONAL_ISOLATE}`;
    at = piece.end;
  }

  return `${result}${sentence.slice(at)}`;
};
