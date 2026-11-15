import CharacterSet from "../LinearRegExp/CharacterSet";
import {
  closeOverCase,
  getCaseVariants,
} from "../LinearRegExp/CaseCanonicalization";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../LinearRegExp/PatternProblem";
import lookupTable from "../LookupTable";

/*
 * RE2'S CHARACTER CLASSES, WRITTEN FOR JAVASCRIPT'S RegExp.
 *
 * A bracket such as [a-z[:digit:]], an escape such as \s, \W or \pL, and a
 * letter matched under (?i) each stand for a set of code points in RE2
 * (Go's regexp/syntax, which Prometheus matches with). This file holds RE2's
 * named sets, computes a class's set as RE2 does (parseClass, parse.go), and
 * writes a set as JavaScript's RegExp without the u flag reads one: a
 * character class of UTF-16 code units.
 *
 * A character beyond U+FFFF, such as an emoji, is two code units in
 * JavaScript and one character in RE2, which reads UTF-8. So the text a
 * pattern reads is written with each such character as one code unit, a
 * surrogate, which no other character of the text is (AstralAlphabet,
 * below): "." and [^a] read it as one character, as RE2 does, and a set
 * holds the surrogates of the characters beyond U+FFFF it holds.
 */

export const MAX_CODE_POINT: number = 0x10ffff;

const BMP_LAST: number = 0xffff;
const ASTRAL_FIRST: number = 0x10000;
const SURROGATE_FIRST: number = 0xd800;
const SURROGATE_LAST: number = 0xdfff;
const HIGH_SURROGATE_LAST: number = 0xdbff;
const LOW_SURROGATE_FIRST: number = 0xdc00;
const REPLACEMENT_CHARACTER: number = 0xfffd;

/*
 * The highest code point Go's case folding reaches (maxFold, parse.go):
 * above it, no code point has another case.
 */
const LAST_FOLDING_CODE_POINT: number = 0x1e943;

/*
 * A set of code points: [first0, last0, first1, last1, ...], sorted, each
 * bound inclusive, no two ranges overlapping or touching.
 */
export type CodePointRanges = ReadonlyArray<number>;

// The ranges of any [first, last] pairs, in the form CodePointRanges keeps.
export const toCodePointRanges: (
  pairs: ReadonlyArray<number>,
) => Array<number> = (pairs: ReadonlyArray<number>): Array<number> => {
  const ranges: Array<[number, number]> = [];

  for (let index: number = 0; index + 1 < pairs.length; index += 2) {
    ranges.push([pairs[index]!, pairs[index + 1]!]);
  }

  ranges.sort((one: [number, number], other: [number, number]): number => {
    return one[0] - other[0];
  });

  const merged: Array<number> = [];

  for (const [first, last] of ranges) {
    const end: number = merged.length;

    if (end > 0 && first <= merged[end - 1]! + 1) {
      merged[end - 1] = Math.max(merged[end - 1]!, last);
      continue;
    }

    merged.push(first, last);
  }

  return merged;
};

// Every code point the set does not hold.
export const complementOf: (set: CodePointRanges) => Array<number> = (
  set: CodePointRanges,
): Array<number> => {
  const complement: Array<number> = [];
  let next: number = 0;

  for (let index: number = 0; index < set.length; index += 2) {
    if (set[index]! > next) {
      complement.push(next, set[index]! - 1);
    }

    next = set[index + 1]! + 1;
  }

  if (next <= MAX_CODE_POINT) {
    complement.push(next, MAX_CODE_POINT);
  }

  return complement;
};

// The part of the set from `first` to `last`.
const partOf: (
  set: CodePointRanges,
  first: number,
  last: number,
) => Array<number> = (
  set: CodePointRanges,
  first: number,
  last: number,
): Array<number> => {
  const part: Array<number> = [];

  for (let index: number = 0; index < set.length; index += 2) {
    const from: number = Math.max(set[index]!, first);
    const to: number = Math.min(set[index + 1]!, last);

    if (from <= to) {
      part.push(from, to);
    }
  }

  return part;
};

// The part of the set from U+0000 to U+FFFF.
export const partUpToFFFF: (set: CodePointRanges) => Array<number> = (
  set: CodePointRanges,
): Array<number> => {
  return partOf(set, 0, BMP_LAST);
};

const holdsAll: (
  set: CodePointRanges,
  first: number,
  last: number,
) => boolean = (set: CodePointRanges, first: number, last: number): boolean => {
  const part: Array<number> = partOf(set, first, last);

  return part.length === 2 && part[0] === first && part[1] === last;
};

/*
 * Every code point of either set, in time in line with their ranges: a
 * bracket of many classes, [\pL\pN\pL...], adds each in turn.
 */
export const unionOf: (
  one: CodePointRanges,
  other: CodePointRanges,
) => Array<number> = (
  one: CodePointRanges,
  other: CodePointRanges,
): Array<number> => {
  const union: Array<number> = [];
  let inOne: number = 0;
  let inOther: number = 0;

  while (inOne < one.length || inOther < other.length) {
    let first: number;
    let last: number;

    if (
      inOther >= other.length ||
      (inOne < one.length && one[inOne]! <= other[inOther]!)
    ) {
      first = one[inOne]!;
      last = one[inOne + 1]!;
      inOne += 2;
    } else {
      first = other[inOther]!;
      last = other[inOther + 1]!;
      inOther += 2;
    }

    const end: number = union.length;

    if (end > 0 && first <= union[end - 1]! + 1) {
      union[end - 1] = Math.max(union[end - 1]!, last);
    } else {
      union.push(first, last);
    }
  }

  return union;
};

/*
 * RE2's POSIX classes, [[:name:]] in a bracket, by name (posixGroup,
 * perl_groups.go). A lookup table, so a name such as constructor, which
 * every object inherits, names no class.
 */
const POSIX_CLASSES: ReadonlyMap<string, CodePointRanges> =
  lookupTable<CodePointRanges>({
    alnum: [0x30, 0x39, 0x41, 0x5a, 0x61, 0x7a],
    alpha: [0x41, 0x5a, 0x61, 0x7a],
    ascii: [0x00, 0x7f],
    blank: [0x09, 0x09, 0x20, 0x20],
    cntrl: [0x00, 0x1f, 0x7f, 0x7f],
    digit: [0x30, 0x39],
    graph: [0x21, 0x7e],
    lower: [0x61, 0x7a],
    print: [0x20, 0x7e],
    punct: [0x21, 0x2f, 0x3a, 0x40, 0x5b, 0x60, 0x7b, 0x7e],
    space: [0x09, 0x0d, 0x20, 0x20],
    upper: [0x41, 0x5a],
    word: [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a],
    xdigit: [0x30, 0x39, 0x41, 0x46, 0x61, 0x66],
  });

// The POSIX class names, for the sentence that refuses one RE2 does not have.
export const POSIX_CLASS_NAMES: ReadonlyArray<string> = Array.from(
  POSIX_CLASSES.keys(),
);

/*
 * RE2's Perl classes, \d \s \w, by their letter (perlGroup,
 * perl_groups.go); \D \S \W are their complements. RE2's \s is
 * [\t\n\f\r ]: no \v, U+00A0 or other spaces, which JavaScript's \s holds.
 */
const PERL_CLASSES: ReadonlyMap<string, CodePointRanges> =
  lookupTable<CodePointRanges>({
    d: [0x30, 0x39],
    s: [0x09, 0x0a, 0x0c, 0x0d, 0x20, 0x20],
    w: [0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a],
  });

/*
 * The case-folding orbits of Go's unicode.SimpleFold that JavaScript's
 * RegExp with the i flag, and without u, does not join whole: the Kelvin
 * sign with k, the long s with s, the Angstrom sign with å, the Ohm sign
 * with ω, ẞ with ß, ϴ with θ and ϑ, and Greek letters with ypogegrammeni
 * with their capitals. JavaScript compares two code units by their upper
 * case (Canonicalize), never one at or above 128 with one below it, and
 * not a letter whose upper case is two characters.
 *
 * Found by comparing, for every code point up to U+FFFF, Go 1.27's orbits
 * (Unicode 17.0) with what Node 26's RegExp takes for one another (Unicode
 * 17.0): these 36 differ, Go's orbit holding all of JavaScript's and more,
 * and JavaScript never joins two code points Go keeps apart. A test holds
 * the running engine to that (PromQLParser.test.ts).
 */
export const WIDER_CASE_FOLDS: ReadonlyArray<ReadonlyArray<number>> = [
  [0x004b, 0x006b, 0x212a],
  [0x0053, 0x0073, 0x017f],
  [0x00c5, 0x00e5, 0x212b],
  [0x00df, 0x1e9e],
  [0x0390, 0x1fd3],
  [0x0398, 0x03b8, 0x03d1, 0x03f4],
  [0x03a9, 0x03c9, 0x2126],
  [0x03b0, 0x1fe3],
  [0x1f80, 0x1f88],
  [0x1f81, 0x1f89],
  [0x1f82, 0x1f8a],
  [0x1f83, 0x1f8b],
  [0x1f84, 0x1f8c],
  [0x1f85, 0x1f8d],
  [0x1f86, 0x1f8e],
  [0x1f87, 0x1f8f],
  [0x1f90, 0x1f98],
  [0x1f91, 0x1f99],
  [0x1f92, 0x1f9a],
  [0x1f93, 0x1f9b],
  [0x1f94, 0x1f9c],
  [0x1f95, 0x1f9d],
  [0x1f96, 0x1f9e],
  [0x1f97, 0x1f9f],
  [0x1fa0, 0x1fa8],
  [0x1fa1, 0x1fa9],
  [0x1fa2, 0x1faa],
  [0x1fa3, 0x1fab],
  [0x1fa4, 0x1fac],
  [0x1fa5, 0x1fad],
  [0x1fa6, 0x1fae],
  [0x1fa7, 0x1faf],
  [0x1fb3, 0x1fbc],
  [0x1fc3, 0x1fcc],
  [0x1ff3, 0x1ffc],
  [0xfb05, 0xfb06],
];

// Each code point of WIDER_CASE_FOLDS, by its orbit.
const WIDER_CASE_FOLD_OF: ReadonlyMap<number, ReadonlyArray<number>> = new Map<
  number,
  ReadonlyArray<number>
>(
  WIDER_CASE_FOLDS.flatMap(
    (orbit: ReadonlyArray<number>): Array<[number, ReadonlyArray<number>]> => {
      return orbit.map((codePoint: number): [number, ReadonlyArray<number>] => {
        return [codePoint, orbit];
      });
    },
  ),
);

/*
 * The other cases of a code point beyond U+FFFF, by its lower and upper
 * case: Deseret, Osage, Adlam and the other scripts with case up there.
 * JavaScript's case mappings join the same pairs Go's SimpleFold joins
 * (each a pair, Unicode 17.0 in both), but its RegExp without u reads each
 * such letter as two code units that have no case.
 */
const astralCaseVariants: (codePoint: number) => Array<number> = (
  codePoint: number,
): Array<number> => {
  const variants: Array<number> = [];
  const character: string = String.fromCodePoint(codePoint);

  for (const other of [character.toLowerCase(), character.toUpperCase()]) {
    const otherCodePoint: number | undefined = other.codePointAt(0);

    if (
      otherCodePoint !== undefined &&
      other.length === String.fromCodePoint(otherCodePoint).length &&
      otherCodePoint !== codePoint &&
      !variants.includes(otherCodePoint)
    ) {
      variants.push(otherCodePoint);
    }
  }

  return variants;
};

/*
 * The code points beyond U+FFFF that have another case, ascending, each
 * with its other cases: read once, when a pattern first asks.
 */
let astralCasePairs: Array<[number, Array<number>]> | null = null;

const getAstralCasePairs: () => Array<[number, Array<number>]> = (): Array<
  [number, Array<number>]
> => {
  if (astralCasePairs === null) {
    const found: Array<[number, Array<number>]> = [];

    for (
      let codePoint: number = ASTRAL_FIRST;
      codePoint <= LAST_FOLDING_CODE_POINT;
      codePoint++
    ) {
      const variants: Array<number> = astralCaseVariants(codePoint);

      if (variants.length > 0) {
        found.push([codePoint, variants]);
      }
    }

    astralCasePairs = found;
  }

  return astralCasePairs;
};

/*
 * The set and every code point Go's case folding joins to one of its code
 * points (appendFoldedRange, parse.go): what (?i) makes of a class.
 */
export const foldCase: (set: CodePointRanges) => Array<number> = (
  set: CodePointRanges,
): Array<number> => {
  const pairs: Array<number> = [...set];
  const bmp: Array<number> = partOf(set, 0, BMP_LAST);

  if (bmp.length > 0) {
    // JavaScript's own case pairs, as the linear-time matcher reads them.
    pairs.push(...closeOverCase(CharacterSet.fromPairs(bmp)).ranges);

    for (const orbit of WIDER_CASE_FOLDS) {
      if (
        orbit.some((codePoint: number): boolean => {
          return holdsCodePoint(bmp, codePoint);
        })
      ) {
        for (const codePoint of orbit) {
          pairs.push(codePoint, codePoint);
        }
      }
    }
  }

  if (partOf(set, ASTRAL_FIRST, LAST_FOLDING_CODE_POINT).length > 0) {
    for (const [codePoint, variants] of getAstralCasePairs()) {
      if (holdsCodePoint(set, codePoint)) {
        for (const variant of variants) {
          pairs.push(variant, variant);
        }
      }
    }
  }

  return toCodePointRanges(pairs);
};

/*
 * A letter under (?i), as the fewest of its cases that JavaScript's i flag
 * joins into all of Go's: [sſ] for s, the flag adding S. Kept short, since
 * a pattern runs only up to MAX_PATTERN_LENGTH once written out.
 */
export const caseFoldedLetter: (codePoint: number) => Array<number> = (
  codePoint: number,
): Array<number> => {
  const orbit: ReadonlyArray<number> | undefined =
    WIDER_CASE_FOLD_OF.get(codePoint);

  if (orbit === undefined) {
    // Beyond U+FFFF, where the i flag joins nothing: every case.
    return foldCase([codePoint, codePoint]);
  }

  const written: Array<number> = [codePoint, codePoint];
  const joined: Set<number> = new Set<number>(getCaseVariants(codePoint));

  for (const member of orbit) {
    if (!joined.has(member)) {
      written.push(member, member);

      for (const variant of getCaseVariants(member)) {
        joined.add(variant);
      }
    }
  }

  return toCodePointRanges(written);
};

/*
 * Whether a letter matched under (?i) needs its orbit written out: JavaScript's
 * i flag joins every other letter's cases itself.
 */
export const needsWrittenCaseFold: (codePoint: number) => boolean = (
  codePoint: number,
): boolean => {
  if (codePoint > BMP_LAST) {
    return (
      codePoint <= LAST_FOLDING_CODE_POINT &&
      astralCaseVariants(codePoint).length > 0
    );
  }

  return WIDER_CASE_FOLD_OF.has(codePoint);
};

export const holdsCodePoint: (
  set: CodePointRanges,
  codePoint: number,
) => boolean = (set: CodePointRanges, codePoint: number): boolean => {
  let low: number = 0;
  let high: number = set.length / 2 - 1;

  while (low <= high) {
    const middle: number = (low + high) >>> 1;

    if (codePoint < set[middle * 2]!) {
      high = middle - 1;
    } else if (codePoint > set[middle * 2 + 1]!) {
      low = middle + 1;
    } else {
      return true;
    }
  }

  return false;
};

/*
 * One of RE2's named sets in a class: a POSIX class by its name, or a Perl
 * class by its letter; undefined for a name RE2 does not have.
 */
export const posixClass: (name: string) => CodePointRanges | undefined = (
  name: string,
): CodePointRanges | undefined => {
  return POSIX_CLASSES.get(name);
};

export const perlClass: (letter: string) => CodePointRanges | undefined = (
  letter: string,
): CodePointRanges | undefined => {
  return PERL_CLASSES.get(letter);
};

/*
 * Each named set folded under (?i), kept by the set: a Unicode class such as
 * \pL holds hundreds of ranges, and a pattern may name it many times.
 */
const foldedNamedSets: WeakMap<CodePointRanges, Array<number>> = new WeakMap<
  CodePointRanges,
  Array<number>
>();

/*
 * A named set as RE2 adds it to a class (appendGroup and parseUnicodeClass,
 * parse.go): folded under (?i), then turned inside out when negated, so
 * (?i)[[:^upper:]] holds no letter at all, and (?i)\P{Lu} no letter that
 * has an upper case.
 */
export const namedSet: (data: {
  set: CodePointRanges;
  negated: boolean;
  ignoreCase: boolean;
}) => Array<number> = (data: {
  set: CodePointRanges;
  negated: boolean;
  ignoreCase: boolean;
}): Array<number> => {
  let set: Array<number>;

  if (data.ignoreCase) {
    let folded: Array<number> | undefined = foldedNamedSets.get(data.set);

    if (folded === undefined) {
      folded = foldCase(data.set);
      foldedNamedSets.set(data.set, folded);
    }

    set = folded;
  } else {
    set = [...data.set];
  }

  return data.negated ? complementOf(set) : [...set];
};

// A code unit as it is written inside a JavaScript class: [...].
const classCodeUnit: (codeUnit: number) => string = (
  codeUnit: number,
): string => {
  switch (codeUnit) {
    case 0x5c: // \
    case 0x5d: // ]
    case 0x5b: // [
    case 0x5e: // ^
    case 0x2d: // -
      return `\\${String.fromCharCode(codeUnit)}`;
    default:
      return plainCodeUnit(codeUnit);
  }
};

/*
 * A code unit that needs no escape for what it means, written so it can be
 * read: control characters, line separators and surrogates by their code.
 */
const plainCodeUnit: (codeUnit: number) => string = (
  codeUnit: number,
): string => {
  switch (codeUnit) {
    case 0x09:
      return "\\t";
    case 0x0a:
      return "\\n";
    case 0x0b:
      return "\\v";
    case 0x0c:
      return "\\f";
    case 0x0d:
      return "\\r";
    default:
      break;
  }

  if (codeUnit < 0x20 || (codeUnit >= 0x7f && codeUnit <= 0x9f)) {
    return `\\x${codeUnit.toString(16).padStart(2, "0")}`;
  }

  const character: string = String.fromCharCode(codeUnit);

  if (codeUnit === 0x20 || PRINTABLE.test(character)) {
    return character;
  }

  // A surrogate, a separator, a mark, a private or unassigned code point.
  return `\\u${codeUnit.toString(16).padStart(4, "0")}`;
};

// A character that can be read as itself: a letter, digit, punctuation, symbol.
const PRINTABLE: RegExp = /^[\p{L}\p{N}\p{P}\p{S}]$/u;

// The characters JavaScript reads as syntax outside a class.
const SYNTAX_CODE_UNITS: ReadonlySet<number> = new Set<number>(
  Array.from("^$\\.*+?()[]{}|/").map((character: string): number => {
    return character.charCodeAt(0);
  }),
);

// A code unit as a literal outside a class.
export const literalCodeUnit: (codeUnit: number) => string = (
  codeUnit: number,
): string => {
  if (SYNTAX_CODE_UNITS.has(codeUnit)) {
    return `\\${String.fromCharCode(codeUnit)}`;
  }

  return plainCodeUnit(codeUnit);
};

// The body of a class of these code units, without its brackets.
const classBody: (units: CodePointRanges) => string = (
  units: CodePointRanges,
): string => {
  let body: string = "";

  for (let index: number = 0; index < units.length; index += 2) {
    const first: number = units[index]!;
    const last: number = units[index + 1]!;

    body += classCodeUnit(first);

    if (last === first + 1) {
      body += classCodeUnit(last);
    } else if (last > first) {
      body += `-${classCodeUnit(last)}`;
    }
  }

  return body;
};

/*
 * A class of code units, the shorter way round: [abc] or [^abc]. Either
 * reads the same under the i flag, for a set closed over case.
 */
const unitClass: (units: CodePointRanges) => string = (
  units: CodePointRanges,
): string => {
  if (units.length === 2 && units[0] === units[1]) {
    return literalCodeUnit(units[0]!);
  }

  const positive: string = `[${classBody(units)}]`;
  const negative: string = `[^${classBody(partOf(complementOf(units), 0, BMP_LAST))}]`;

  return negative.length < positive.length ? negative : positive;
};

// How much of U+10000 to U+10FFFF a set holds.
export enum AstralPart {
  None = "None",
  All = "All",
  Some = "Some",
}

export const astralPartOf: (set: CodePointRanges) => AstralPart = (
  set: CodePointRanges,
): AstralPart => {
  const astral: Array<number> = partOf(set, ASTRAL_FIRST, MAX_CODE_POINT);

  if (astral.length === 0) {
    return AstralPart.None;
  }

  return holdsAll(set, ASTRAL_FIRST, MAX_CODE_POINT)
    ? AstralPart.All
    : AstralPart.Some;
};

/*
 * How many classes of characters beyond U+FFFF a pattern can tell apart:
 * one surrogate each, U+D800 to U+DFFF.
 */
export const MAX_ASTRAL_CLASSES: number = SURROGATE_LAST - SURROGATE_FIRST + 1;

// The last run that starts at or before the code point.
const runAt: (starts: ReadonlyArray<number>, codePoint: number) => number = (
  starts: ReadonlyArray<number>,
  codePoint: number,
): number => {
  let low: number = 0;
  let high: number = starts.length - 1;

  while (low < high) {
    const middle: number = (low + high + 1) >>> 1;

    if (starts[middle]! <= codePoint) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low;
};

// Whether a text holds a surrogate: a character beyond U+FFFF, or half of one.
const HOLDS_SURROGATE: RegExp = /[\ud800-\udfff]/;

// A text of these code units, written in slices: each is an argument.
const fromCodeUnits: (units: ReadonlyArray<number>) => string = (
  units: ReadonlyArray<number>,
): string => {
  let text: string = "";

  for (let start: number = 0; start < units.length; start += 8192) {
    text += String.fromCharCode(...units.slice(start, start + 8192));
  }

  return text;
};

/*
 * A text as a pattern reads it (AstralAlphabet.read), and where each of its
 * code units came from in the text itself.
 */
export interface AstralText {
  text: string;
  /*
   * Asked for, and the text holds a surrogate: for each code unit of
   * `text`, and for its end, the position it stands for in the text read,
   * so a match from i to j is `wellFormed` from positions[i] to
   * positions[j]. Null otherwise: `text` is the text itself.
   */
  positions: ReadonlyArray<number> | null;
  // The text read, a lone surrogate as U+FFFD, as Go holds it.
  wellFormed: string;
}

/*
 * THE CHARACTERS BEYOND U+FFFF, ONE CODE UNIT EACH.
 *
 * JavaScript's RegExp without u, and the linear-time matcher, which reads as
 * it does, read a text as UTF-16 code units, where a character beyond
 * U+FFFF (an emoji, a letter of Deseret) is two of them, a surrogate pair.
 * RE2 reads UTF-8, where it is one character (issue #8215). So the text a
 * pattern reads is written with each such character as one code unit: a
 * surrogate, which no other character of the text is. A lone surrogate,
 * half a character, is read as U+FFFD, as Go reads a byte that is not
 * UTF-8.
 *
 * Which surrogate: the sets of the pattern that hold some characters beyond
 * U+FFFF and leave out others - \x{1F600}, [\x{1F600}-\x{1F64F}], \pL -
 * split them into classes, each the characters no set of the pattern tells
 * apart, and each class is one surrogate. A set holds the surrogates of the
 * classes it holds; ".", [^a] and \S, which hold every character beyond
 * U+FFFF, hold every surrogate. So "." reads "😀" as one character, as RE2
 * does, and so does \x{1F600}.
 */
export class AstralAlphabet {
  // Where each run of characters of one class starts, from U+10000 up.
  private readonly starts: Array<number> = [];
  // The code unit each run's characters are written as.
  private readonly codeUnits: Array<number> = [];
  // How many classes there are.
  public readonly size: number;

  /*
   * The classes the sets tell apart. Throws PatternProblemError when they
   * are more than MAX_ASTRAL_CLASSES: a pattern that names more than 2,000
   * characters beyond U+FFFF apart is too large to run.
   */
  public constructor(sets: ReadonlyArray<CodePointRanges>) {
    const parts: Array<Array<number>> = sets.map(
      (set: CodePointRanges): Array<number> => {
        return partOf(set, ASTRAL_FIRST, MAX_CODE_POINT);
      },
    );
    const cuts: Set<number> = new Set<number>([ASTRAL_FIRST]);

    for (const part of parts) {
      for (let index: number = 0; index < part.length; index += 2) {
        cuts.add(part[index]!);

        if (part[index + 1]! < MAX_CODE_POINT) {
          cuts.add(part[index + 1]! + 1);
        }
      }
    }

    const starts: Array<number> = Array.from(cuts).sort(
      (one: number, other: number): number => {
        return one - other;
      },
    );
    // Each run's class, refined set by set: the runs a set holds move apart.
    const classes: Int32Array = new Int32Array(starts.length);
    let nextClass: number = 1;

    for (const part of parts) {
      const moved: Map<number, number> = new Map<number, number>();

      for (let index: number = 0; index < part.length; index += 2) {
        for (
          let run: number = runAt(starts, part[index]!);
          run < starts.length && starts[run]! <= part[index + 1]!;
          run++
        ) {
          let renamed: number | undefined = moved.get(classes[run]!);

          if (renamed === undefined) {
            renamed = nextClass++;
            moved.set(classes[run]!, renamed);
          }

          classes[run] = renamed;
        }
      }
    }

    // Numbered as they first come, neighbouring runs of one class as one.
    const numbers: Map<number, number> = new Map<number, number>();

    for (let run: number = 0; run < starts.length; run++) {
      let number: number | undefined = numbers.get(classes[run]!);

      if (number === undefined) {
        number = numbers.size;
        numbers.set(classes[run]!, number);
      }

      const codeUnit: number = SURROGATE_FIRST + number;

      if (this.codeUnits[this.codeUnits.length - 1] !== codeUnit) {
        this.starts.push(starts[run]!);
        this.codeUnits.push(codeUnit);
      }
    }

    this.size = numbers.size;

    if (this.size > MAX_ASTRAL_CLASSES) {
      throw new PatternProblemError(
        PatternProblemReason.TooLarge,
        `The pattern tells apart more than ${MAX_ASTRAL_CLASSES} kinds of characters beyond U+FFFF.`,
      );
    }
  }

  // The code unit a character beyond U+FFFF is read as.
  public codeUnitOf(codePoint: number): number {
    return this.codeUnits[runAt(this.starts, codePoint)]!;
  }

  /*
   * The code units of the characters beyond U+FFFF a set holds, as ranges:
   * one of the sets the alphabet was built from.
   */
  public codeUnitsOf(set: CodePointRanges): Array<number> {
    const astral: Array<number> = partOf(set, ASTRAL_FIRST, MAX_CODE_POINT);
    const units: Array<number> = [];

    for (let index: number = 0; index < astral.length; index += 2) {
      for (
        let run: number = runAt(this.starts, astral[index]!);
        run < this.starts.length && this.starts[run]! <= astral[index + 1]!;
        run++
      ) {
        units.push(this.codeUnits[run]!, this.codeUnits[run]!);
      }
    }

    return toCodePointRanges(units);
  }

  /*
   * The text as the pattern reads it: each character beyond U+FFFF as its
   * class's code unit, a lone surrogate as U+FFFD, the rest as it is. With
   * positions, where each code unit came from, for what a group captured.
   */
  public read(value: string, withPositions: boolean): AstralText {
    if (!HOLDS_SURROGATE.test(value)) {
      return { text: value, positions: null, wellFormed: value };
    }

    const units: Array<number> = [];
    const positions: Array<number> = [];
    // Where the value holds a lone surrogate, which reads as U+FFFD.
    const loneSurrogates: Array<number> = [];

    for (let index: number = 0; index < value.length; index++) {
      const unit: number = value.charCodeAt(index);

      positions.push(index);

      if (unit < SURROGATE_FIRST || unit > SURROGATE_LAST) {
        units.push(unit);
        continue;
      }

      const next: number = value.charCodeAt(index + 1);

      if (
        unit <= HIGH_SURROGATE_LAST &&
        next >= LOW_SURROGATE_FIRST &&
        next <= SURROGATE_LAST
      ) {
        units.push(this.codeUnitOf(value.codePointAt(index)!));
        index++;
        continue;
      }

      units.push(REPLACEMENT_CHARACTER);
      loneSurrogates.push(index);
    }

    positions.push(value.length);

    let wellFormed: string = value;

    if (withPositions && loneSurrogates.length > 0) {
      wellFormed = "";
      let from: number = 0;

      for (const index of loneSurrogates) {
        wellFormed += `${value.slice(from, index)}${String.fromCharCode(REPLACEMENT_CHARACTER)}`;
        from = index + 1;
      }

      wellFormed += value.slice(from);
    }

    return {
      text: fromCodeUnits(units),
      positions: withPositions ? positions : null,
      wellFormed,
    };
  }
}

/*
 * A set of code points as a class of code units for JavaScript's RegExp:
 * its characters up to U+FFFF as themselves, the surrogates left out (RE2
 * matches them in no text), and its characters beyond U+FFFF as the
 * alphabet reads them - every surrogate, for a set that holds all of them.
 * A set that holds some characters beyond U+FFFF and leaves out others
 * needs the alphabet built from the pattern's such sets.
 */
export const writeSet: (
  set: CodePointRanges,
  alphabet?: AstralAlphabet | undefined,
) => string = (
  set: CodePointRanges,
  alphabet?: AstralAlphabet | undefined,
): string => {
  const units: Array<number> = partOf(set, 0, SURROGATE_FIRST - 1);

  switch (astralPartOf(set)) {
    case AstralPart.All:
      units.push(SURROGATE_FIRST, SURROGATE_LAST);
      break;
    case AstralPart.Some:
      if (alphabet === undefined) {
        throw new Error(
          "A set that holds some characters beyond U+FFFF is written with the pattern's alphabet.",
        );
      }

      units.push(...alphabet.codeUnitsOf(set));
      break;
    default:
      break;
  }

  units.push(...partOf(set, SURROGATE_LAST + 1, BMP_LAST));

  const ranges: Array<number> = toCodePointRanges(units);

  return ranges.length === 0 ? "[]" : unitClass(ranges);
};

/*
 * A code point up to U+FFFF as a literal: one code unit, or a class that
 * matches nothing for a surrogate, which RE2 reads in no text. A code point
 * beyond U+FFFF is a set, written with the pattern's alphabet.
 */
export const writeCodePoint: (codePoint: number) => string = (
  codePoint: number,
): string => {
  if (codePoint >= SURROGATE_FIRST && codePoint <= SURROGATE_LAST) {
    return "[]";
  }

  return literalCodeUnit(codePoint);
};
