import { getBuiltInDetectorsOf } from "./Detectors/Index";
import { ScanDetector } from "./TextScanner";
import CharacterSet from "../LinearRegExp/CharacterSet";
import { parsePattern, PatternFlags } from "../LinearRegExp/Parser";
import { SyntaxNode } from "../LinearRegExp/Syntax";

/*
 * A DATA TYPE'S PATTERNS, FOR THE DATABASE TO NARROW A SEARCH BY.
 *
 * Looking for the telemetry records that carry a finding's data - an IP
 * address in a service's log lines - used to read the newest few hundred
 * records with any value at the place, and check each one here. In a busy
 * service those are the last seconds of its logs, and a type that turns up
 * in one line of four hundred was never among them (issue #9549). This
 * turns the type's own detectors into one regular expression ClickHouse can
 * run (RE2), so the database hands over only records that could hold it,
 * and each is still checked here with the detector itself.
 *
 * RE2 has no look-arounds and no back-references, and its \s and its case
 * folding are not JavaScript's, so the expression is written to match at
 * least everything the detector's pattern matches - more is fine, never
 * less - read from the pattern's syntax tree (LinearRegExp/Parser):
 *
 *  - a look-behind at the pattern's start and a look-ahead at its end are
 *    read as part of the match - the text is right there - so a type whose
 *    words sit in one (cvv: 123) still narrows by them;
 *  - every other look-around, and ^, $, \b and \B, are left out: each only
 *    narrows a match;
 *  - a back-reference becomes an optional copy of the group it names;
 *  - every character class, \s and the dot included, is written out as the
 *    code points JavaScript gives it, and a class holding UTF-16 surrogates
 *    takes every character beyond U+FFFF in their place;
 *  - a repeat beyond RE2's limit of 1000 has no upper bound;
 *  - case-insensitivity is RE2's (?i), which folds at least what
 *    JavaScript's i flag does.
 *
 * Anything it cannot write so - a u or v flag, a pattern the parser
 * refuses - gives no expression, and the search reads every record with a
 * value there, as it did.
 */

// RE2's largest repeat count.
export const RE2_MAX_REPEAT: number = 1000;

// The longest expression handed to the database.
export const MAX_PREFILTER_LENGTH: number = 32_768;

const HIGH_SURROGATE_FIRST: number = 0xd800;
const LOW_SURROGATE_FIRST: number = 0xdc00;
const SURROGATE_LAST: number = 0xdfff;
const FIRST_ASTRAL: number = 0x10000;
const LAST_CODE_POINT: number = 0x10ffff;

class NotWritable extends Error {}

function hex(codePoint: number): string {
  return `\\x{${codePoint.toString(16).toUpperCase()}}`;
}

function isPlainCharacter(codePoint: number): boolean {
  return (
    (codePoint >= 0x30 && codePoint <= 0x39) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
}

function literal(codePoint: number): string {
  return isPlainCharacter(codePoint)
    ? String.fromCodePoint(codePoint)
    : hex(codePoint);
}

function isHighSurrogate(codeUnit: number): boolean {
  return codeUnit >= HIGH_SURROGATE_FIRST && codeUnit < LOW_SURROGATE_FIRST;
}

function isLowSurrogate(codeUnit: number): boolean {
  return codeUnit >= LOW_SURROGATE_FIRST && codeUnit <= SURROGATE_LAST;
}

// Any one character beyond U+FFFF: what a lone surrogate stands for here.
const ANY_ASTRAL: string = `[${hex(FIRST_ASTRAL)}-${hex(LAST_CODE_POINT)}]`;

/*
 * A class's members as RE2 writes them: the code points JavaScript gives
 * it, surrogates taken out - for a class written as itself, every
 * character beyond U+FFFF takes their place.
 */
function writeSet(set: CharacterSet, negate: boolean): string {
  const ranges: ReadonlyArray<number> = set.ranges;
  const parts: Array<string> = [];
  let hadSurrogates: boolean = false;

  const add: (first: number, last: number) => void = (
    first: number,
    last: number,
  ): void => {
    if (first > last) {
      return;
    }

    parts.push(first === last ? hex(first) : `${hex(first)}-${hex(last)}`);
  };

  for (let index: number = 0; index < ranges.length; index += 2) {
    const first: number = ranges[index]!;
    const last: number = ranges[index + 1]!;

    if (last < HIGH_SURROGATE_FIRST || first > SURROGATE_LAST) {
      add(first, last);
      continue;
    }

    hadSurrogates = true;
    add(first, HIGH_SURROGATE_FIRST - 1);
    add(SURROGATE_LAST + 1, last);
  }

  if (negate) {
    // [^...] in RE2 takes every character beyond U+FFFF already.
    return parts.length > 0 ? `[^${parts.join("")}]` : "(?s:.)";
  }

  if (hadSurrogates) {
    parts.push(`${hex(FIRST_ASTRAL)}-${hex(LAST_CODE_POINT)}`);
  }

  if (parts.length === 0) {
    // A class of nothing: the pattern can match nothing, and is no prefilter.
    throw new NotWritable("An empty class.");
  }

  return `[${parts.join("")}]`;
}

function withCase(
  text: string,
  ignoreCase: boolean,
  outerIgnoreCase: boolean,
): string {
  if (ignoreCase === outerIgnoreCase || text.length === 0) {
    return text;
  }

  return ignoreCase ? `(?i:${text})` : `(?-i:${text})`;
}

function quantifier(min: number, max: number): string {
  const low: number = Math.min(min, RE2_MAX_REPEAT);
  const isUnbounded: boolean =
    !Number.isFinite(max) || max > RE2_MAX_REPEAT || max < min;

  if (isUnbounded) {
    if (low === 0) {
      return "*";
    }

    return low === 1 ? "+" : `{${low},}`;
  }

  if (low === 0 && max === 1) {
    return "?";
  }

  return low === max ? `{${low}}` : `{${low},${max}}`;
}

function writeNode(node: SyntaxNode, outerIgnoreCase: boolean): string {
  switch (node.kind) {
    case "Empty":
    case "Assertion":
    case "Lookaround":
      return "";
    case "Character":
      return withCase(
        isHighSurrogate(node.codeUnit) || isLowSurrogate(node.codeUnit)
          ? ANY_ASTRAL
          : literal(node.codeUnit),
        node.ignoreCase,
        outerIgnoreCase,
      );
    case "Set":
      return withCase(
        writeSet(node.set, node.negate),
        node.ignoreCase,
        outerIgnoreCase,
      );
    case "Group": {
      const body: string = writeNode(node.body, outerIgnoreCase);

      return body ? `(?:${body})` : "";
    }
    case "Repeat": {
      const body: string = writeNode(node.body, outerIgnoreCase);

      return body ? `(?:${body})${quantifier(node.min, node.max)}` : "";
    }
    case "Alternation": {
      const options: Array<string> = node.options.map(
        (option: SyntaxNode): string => {
          return writeNode(option, outerIgnoreCase);
        },
      );

      // An option that can match nothing at all makes the whole optional.
      return `(?:${options.join("|")})`;
    }
    case "Sequence":
      return writeSequence(node.items, outerIgnoreCase);
    default:
      throw new NotWritable("A node the writer does not know.");
  }
}

/*
 * A sequence's items one after another, a surrogate pair written as the one
 * character beyond U+FFFF it is.
 */
function writeSequence(
  items: ReadonlyArray<SyntaxNode>,
  outerIgnoreCase: boolean,
): string {
  let text: string = "";

  for (let index: number = 0; index < items.length; index++) {
    const item: SyntaxNode = items[index]!;
    const next: SyntaxNode | undefined = items[index + 1];

    if (
      item.kind === "Character" &&
      next?.kind === "Character" &&
      isHighSurrogate(item.codeUnit) &&
      isLowSurrogate(next.codeUnit) &&
      item.ignoreCase === next.ignoreCase
    ) {
      const codePoint: number =
        FIRST_ASTRAL +
        (item.codeUnit - HIGH_SURROGATE_FIRST) * 0x400 +
        (next.codeUnit - LOW_SURROGATE_FIRST);

      text += withCase(hex(codePoint), item.ignoreCase, outerIgnoreCase);
      index++;
      continue;
    }

    text += writeNode(item, outerIgnoreCase);
  }

  return text;
}

interface GroupSpan {
  index: number;
  name: string | null;
  // The group's own text, between its opening and its ")".
  inner: string;
}

interface OpenGroup {
  // Its number when it captures; null for (?:...) and the look-arounds.
  index: number | null;
  name: string | null;
  innerStart: number;
}

function isZeroWidth(node: SyntaxNode): boolean {
  return (
    node.kind === "Lookaround" ||
    node.kind === "Assertion" ||
    node.kind === "Empty"
  );
}

/*
 * A pattern whose words sit in a look-behind at its start - (?<=cvv: )[0-9]{3}
 * - or in a look-ahead at its end keeps them: the text before or after the
 * match is right there, so it can be read as part of it, and the expression
 * still matches every text the pattern does. One look-behind and one
 * look-ahead are kept so - two that start at the same place overlap - and
 * any other look-around is left out.
 */
function withEdgeLookaroundsRead(root: SyntaxNode): SyntaxNode {
  if (root.kind !== "Sequence") {
    return root;
  }

  const items: ReadonlyArray<SyntaxNode> = root.items;
  const firstConsumed: number = items.findIndex((item: SyntaxNode): boolean => {
    return !isZeroWidth(item);
  });

  if (firstConsumed < 0) {
    return root;
  }

  let lastConsumed: number = items.length - 1;

  while (isZeroWidth(items[lastConsumed]!)) {
    lastConsumed--;
  }

  // Every other zero-width item would be written as nothing anyway.
  const before: SyntaxNode | undefined = items
    .slice(0, firstConsumed)
    .find((item: SyntaxNode): boolean => {
      return item.kind === "Lookaround" && item.behind && !item.negate;
    });
  const after: SyntaxNode | undefined = items
    .slice(lastConsumed + 1)
    .find((item: SyntaxNode): boolean => {
      return item.kind === "Lookaround" && !item.behind && !item.negate;
    });

  const asRead: (node: SyntaxNode | undefined) => Array<SyntaxNode> = (
    node: SyntaxNode | undefined,
  ): Array<SyntaxNode> => {
    return node?.kind === "Lookaround"
      ? [{ kind: "Group", captureIndex: 0, name: null, body: node.body }]
      : [];
  };

  return {
    kind: "Sequence",
    items: [
      ...asRead(before),
      ...items.slice(firstConsumed, lastConsumed + 1),
      ...asRead(after),
    ],
  };
}

/*
 * Whether a node can match the empty text, as it is written for RE2: an
 * expression that can is no narrowing at all.
 */
function canMatchEmpty(node: SyntaxNode): boolean {
  switch (node.kind) {
    case "Character":
    case "Set":
      return false;
    case "Group":
      return canMatchEmpty(node.body);
    case "Repeat":
      return node.min === 0 || canMatchEmpty(node.body);
    case "Alternation":
      return node.options.some(canMatchEmpty);
    case "Sequence":
      return node.items.every(canMatchEmpty);
    default:
      return true;
  }
}

/*
 * Each capturing group's text, numbered as JavaScript numbers them, and
 * whether the pattern has named ones. Escapes and classes are stepped over
 * as JavaScript reads them.
 */
function readGroups(source: string): {
  groups: Map<number, GroupSpan>;
  count: number;
  hasNamed: boolean;
} {
  const groups: Map<number, GroupSpan> = new Map();
  const open: Array<OpenGroup> = [];
  let count: number = 0;
  let hasNamed: boolean = false;
  let inClass: boolean = false;

  for (let position: number = 0; position < source.length; position++) {
    const character: string = source[position]!;

    if (character === "\\") {
      position++;
      continue;
    }

    if (inClass) {
      inClass = character !== "]";
      continue;
    }

    if (character === "[") {
      inClass = true;
      continue;
    }

    if (character === "(") {
      if (source[position + 1] !== "?") {
        count++;
        open.push({ index: count, name: null, innerStart: position + 1 });
        continue;
      }

      const named: RegExpMatchArray | null = source
        .slice(position)
        .match(/^\(\?<([A-Za-z_$][A-Za-z0-9_$]*)>/);

      if (named) {
        count++;
        hasNamed = true;
        open.push({
          index: count,
          name: named[1]!,
          innerStart: position + named[0].length,
        });
        continue;
      }

      open.push({ index: null, name: null, innerStart: position + 1 });
      continue;
    }

    if (character === ")") {
      const group: OpenGroup | undefined = open.pop();

      if (group?.index) {
        groups.set(group.index, {
          index: group.index,
          name: group.name,
          inner: source.slice(group.innerStart, position),
        });
      }
    }
  }

  return { groups, count, hasNamed };
}

// How many times back-references inside back-references are followed.
const MAX_BACK_REFERENCE_DEPTH: number = 8;

/*
 * The pattern with each back-reference - \1, \k<name> - written as an
 * optional copy of the group it names: the copy matches whatever the group
 * matched, and nothing when the group took no part.
 */
export function expandBackReferences(
  source: string,
  depth: number = 0,
): string {
  const { groups, count, hasNamed } = readGroups(source);

  if (count === 0) {
    return source;
  }

  if (depth > MAX_BACK_REFERENCE_DEPTH) {
    throw new NotWritable("Back-references nested too deep.");
  }

  const byName: Map<string, GroupSpan> = new Map();

  for (const group of groups.values()) {
    if (group.name) {
      byName.set(group.name, group);
    }
  }

  const copyOf: (group: GroupSpan | undefined) => string = (
    group: GroupSpan | undefined,
  ): string => {
    return group
      ? `(?:${expandBackReferences(group.inner, depth + 1)})?`
      : "(?:)";
  };

  let written: string = "";
  let inClass: boolean = false;

  for (let position: number = 0; position < source.length; position++) {
    const character: string = source[position]!;

    if (character !== "\\") {
      if (inClass) {
        inClass = character !== "]";
      } else if (character === "[") {
        inClass = true;
      }

      written += character;
      continue;
    }

    const next: string = source[position + 1] || "";

    if (!inClass && next >= "1" && next <= "9") {
      const digits: string = (source.slice(position + 1).match(/^[0-9]+/) || [
        "",
      ])[0];
      const number: number = Number(digits);

      if (number <= count) {
        written += copyOf(groups.get(number));
        position += digits.length;
        continue;
      }
    }

    if (!inClass && next === "k" && hasNamed) {
      const named: RegExpMatchArray | null = source
        .slice(position)
        .match(/^\\k<([A-Za-z_$][A-Za-z0-9_$]*)>/);

      if (named) {
        written += copyOf(byName.get(named[1]!));
        position += named[0].length - 1;
        continue;
      }
    }

    written += character + next;
    position++;
  }

  return written;
}

/*
 * A JavaScript pattern as an RE2 expression that matches at least what the
 * pattern matches, or null when it cannot be written so.
 */
export function toRe2Prefilter(source: string, flags: string): string | null {
  if (flags.includes("u") || flags.includes("v")) {
    return null;
  }

  const patternFlags: PatternFlags = {
    ignoreCase: flags.includes("i"),
    multiline: flags.includes("m"),
    dotAll: flags.includes("s"),
  };

  try {
    // The engine decides what is a pattern at all, as LinearRegExp does.
    new RegExp(source, flags.replace(/[^gimsy]/g, ""));

    const root: SyntaxNode = withEdgeLookaroundsRead(
      parsePattern(expandBackReferences(source), patternFlags).root,
    );

    // An expression that can match the empty text narrows nothing.
    if (canMatchEmpty(root)) {
      return null;
    }

    const written: string = writeNode(root, patternFlags.ignoreCase);

    if (!written || written.length > MAX_PREFILTER_LENGTH) {
      return null;
    }

    return patternFlags.ignoreCase ? `(?i:${written})` : written;
  } catch {
    return null;
  }
}

// Where a detector's pattern is written: its own, or the one a project wrote.
function patternOf(
  detector: ScanDetector,
): { source: string; flags: string } | null {
  if ("pattern" in detector && detector.pattern instanceof RegExp) {
    return { source: detector.pattern.source, flags: detector.pattern.flags };
  }

  if ("patternSource" in detector && detector.patternSource) {
    return detector.patternSource;
  }

  return null;
}

/*
 * One RE2 expression for every detector of a data type - the built-in
 * ones, or the project's own type's - that matches at least what any of
 * them matches: null when the type has none, or one of them cannot be
 * written so, since the search would then miss what that one finds.
 */
export function getDataTypePrefilter(data: {
  dataTypeId: string;
  // The project's own types, compiled (ContentScanOptions.customDetectors).
  customDetectors?: ReadonlyArray<ScanDetector> | undefined;
}): string | null {
  const builtIn: ReadonlyArray<ScanDetector> = getBuiltInDetectorsOf(
    data.dataTypeId,
  );
  const detectors: ReadonlyArray<ScanDetector> =
    builtIn.length > 0
      ? builtIn
      : (data.customDetectors || []).filter(
          (detector: ScanDetector): boolean => {
            return detector.dataTypeId === data.dataTypeId;
          },
        );

  if (detectors.length === 0) {
    return null;
  }

  const expressions: Array<string> = [];

  for (const detector of detectors) {
    const pattern: { source: string; flags: string } | null =
      patternOf(detector);
    const expression: string | null = pattern
      ? toRe2Prefilter(pattern.source, pattern.flags)
      : null;

    if (!expression) {
      return null;
    }

    if (!expressions.includes(expression)) {
      expressions.push(expression);
    }
  }

  const combined: string =
    expressions.length === 1
      ? expressions[0]!
      : expressions
          .map((expression: string): string => {
            return `(?:${expression})`;
          })
          .join("|");

  return combined.length <= MAX_PREFILTER_LENGTH ? combined : null;
}
