import CharacterSet from "../LinearRegExp/CharacterSet";
import {
  closeOverCase,
  getCaseVariants,
} from "../LinearRegExp/CaseCanonicalization";
import lookupTable from "../LookupTable";

/*
 * RE2'S CHARACTER CLASSES, WRITTEN FOR JAVASCRIPT'S RegExp.
 *
 * A bracket such as [a-z[:digit:]], an escape such as \s or \W, and a
 * letter matched under (?i) each stand for a set of code points in RE2
 * (Go's regexp/syntax, which Prometheus matches with). This file holds RE2's
 * named sets, computes a class's set as RE2 does (parseClass, parse.go), and
 * writes a set as JavaScript's RegExp without the u flag reads one: a
 * character class of UTF-16 code units, and each code point beyond U+FFFF
 * as its two code units.
 *
 * A set that holds every code point beyond U+FFFF - [^a], \S, \W - is
 * written as a class of single code units, surrogates included, as "."
 * reads text here: a character beyond U+FFFF, such as an emoji, is two
 * characters to it, where RE2 reads one. A set that holds some of them -
 * [\x{1F600}-\x{1F64F}] - matches each as one character, as RE2 does.
 */

export const MAX_CODE_POINT: number = 0x10ffff;

const BMP_LAST: number = 0xffff;
const ASTRAL_FIRST: number = 0x10000;
const SURROGATE_FIRST: number = 0xd800;
const SURROGATE_LAST: number = 0xdfff;
const HIGH_SURROGATE_FIRST: number = 0xd800;
const LOW_SURROGATE_FIRST: number = 0xdc00;
const LOW_SURROGATE_LAST: number = 0xdfff;

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

const holdsAll: (
  set: CodePointRanges,
  first: number,
  last: number,
) => boolean = (set: CodePointRanges, first: number, last: number): boolean => {
  const part: Array<number> = partOf(set, first, last);

  return part.length === 2 && part[0] === first && part[1] === last;
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
 * A named set as RE2 adds it to a class (appendGroup, parse.go): folded
 * under (?i), then turned inside out when negated, so (?i)[[:^upper:]]
 * holds no letter at all.
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
  const set: Array<number> = data.ignoreCase
    ? foldCase(data.set)
    : [...data.set];

  return data.negated ? complementOf(set) : set;
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

// A code point beyond U+FFFF as its two code units.
const surrogatePairOf: (codePoint: number) => [number, number] = (
  codePoint: number,
): [number, number] => {
  const offset: number = codePoint - ASTRAL_FIRST;

  return [
    HIGH_SURROGATE_FIRST + (offset >> 10),
    LOW_SURROGATE_FIRST + (offset & 0x3ff),
  ];
};

/*
 * Code points beyond U+FFFF as alternatives of two code units each, the
 * code points that share a high surrogate together:
 * \ud83d[\ude00-\ude4f], [\ud800-\udbff][\udc00-\udfff]. Read range by
 * range, so a set's alternatives cost in line with its ranges.
 */
const astralAlternatives: (set: CodePointRanges) => Array<string> = (
  set: CodePointRanges,
): Array<string> => {
  // High surrogates from `first` to `last`, each with these low ones.
  interface Block {
    first: number;
    last: number;
    lows: Array<number>;
  }

  const blocks: Array<Block> = [];
  const add: (first: number, last: number, lows: Array<number>) => void = (
    first: number,
    last: number,
    lows: Array<number>,
  ): void => {
    const previous: Block | undefined = blocks[blocks.length - 1];

    if (
      previous !== undefined &&
      previous.first === previous.last &&
      first === last &&
      previous.last === first
    ) {
      // Another range under the same high surrogate.
      previous.lows.push(...lows);
      return;
    }

    blocks.push({ first, last, lows });
  };

  for (let index: number = 0; index < set.length; index += 2) {
    const [firstHigh, firstLow] = surrogatePairOf(set[index]!);
    const [lastHigh, lastLow] = surrogatePairOf(set[index + 1]!);

    if (firstHigh === lastHigh) {
      add(firstHigh, firstHigh, [firstLow, lastLow]);
      continue;
    }

    add(firstHigh, firstHigh, [firstLow, LOW_SURROGATE_LAST]);

    if (lastHigh - firstHigh > 1) {
      add(firstHigh + 1, lastHigh - 1, [
        LOW_SURROGATE_FIRST,
        LOW_SURROGATE_LAST,
      ]);
    }

    add(lastHigh, lastHigh, [LOW_SURROGATE_FIRST, lastLow]);
  }

  // Neighbouring high surrogates with the same low surrogates go together.
  const merged: Array<{ first: number; last: number; lows: string }> = [];

  for (const block of blocks) {
    const lows: string = unitClass(toCodePointRanges(block.lows));
    const previous: { first: number; last: number; lows: string } | undefined =
      merged[merged.length - 1];

    if (
      previous !== undefined &&
      previous.lows === lows &&
      previous.last + 1 === block.first
    ) {
      previous.last = block.last;
      continue;
    }

    merged.push({ first: block.first, last: block.last, lows });
  }

  return merged.map(
    (block: { first: number; last: number; lows: string }): string => {
      return `${unitClass([block.first, block.last])}${block.lows}`;
    },
  );
};

export interface WrittenSet {
  // The set as JavaScript reads it.
  source: string;
  /*
   * Whether a repeat of it needs a group around it: a code point beyond
   * U+FFFF written as its two code units.
   */
  needsGroup: boolean;
}

/*
 * A set of code points, written for JavaScript's RegExp without u: as one
 * class of code units when it holds every code point beyond U+FFFF or none
 * of them, and otherwise as alternatives that match each code point beyond
 * U+FFFF whole, as its two code units, beside a class of the rest.
 */
export const writeSet: (set: CodePointRanges) => WrittenSet = (
  set: CodePointRanges,
): WrittenSet => {
  if (
    holdsAll(set, ASTRAL_FIRST, MAX_CODE_POINT) &&
    holdsAll(set, SURROGATE_FIRST, SURROGATE_LAST)
  ) {
    /*
     * A set that leaves out only some of U+0000 to U+FFFF, [^a] or \S:
     * each code unit of a character beyond U+FFFF, as "." reads it.
     */
    return { source: unitClass(partOf(set, 0, BMP_LAST)), needsGroup: false };
  }

  /*
   * Any other set's surrogates go: as code points, RE2 matches them in no
   * text, and as code units they are halves of a character beyond U+FFFF.
   */
  const units: Array<number> = toCodePointRanges([
    ...partOf(set, 0, SURROGATE_FIRST - 1),
    ...partOf(set, SURROGATE_LAST + 1, BMP_LAST),
  ]);
  const astral: Array<number> = partOf(set, ASTRAL_FIRST, MAX_CODE_POINT);

  if (astral.length === 0) {
    return {
      source: units.length === 0 ? "[]" : unitClass(units),
      needsGroup: false,
    };
  }

  const alternatives: Array<string> = [];

  if (units.length > 0) {
    alternatives.push(unitClass(units));
  }

  alternatives.push(...astralAlternatives(astral));

  if (alternatives.length === 1) {
    // One code point beyond U+FFFF, or one high surrogate's: two code units.
    return { source: alternatives[0]!, needsGroup: true };
  }

  return { source: `(?:${alternatives.join("|")})`, needsGroup: false };
};

// A code point as a literal: one code unit, or two beyond U+FFFF.
export const writeCodePoint: (codePoint: number) => WrittenSet = (
  codePoint: number,
): WrittenSet => {
  if (codePoint <= BMP_LAST) {
    return { source: literalCodeUnit(codePoint), needsGroup: false };
  }

  const [high, low] = surrogatePairOf(codePoint);

  return {
    source: `${plainCodeUnit(high)}${plainCodeUnit(low)}`,
    needsGroup: true,
  };
};
