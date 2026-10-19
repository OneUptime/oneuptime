import CharacterSet from "./CharacterSet";
import { AssertionKind, ParsedPattern, SyntaxNode } from "./Syntax";
import { PatternProblemError, PatternProblemReason } from "./PatternProblem";

/*
 * READS A JAVASCRIPT REGULAR EXPRESSION THE WAY JAVASCRIPT DOES.
 *
 * The grammar is ECMAScript's for a pattern without the u or v flag, Annex B
 * included - the legacy forms browsers and Node accept: "{" and "]" as plain
 * characters, \1 as an octal escape when the pattern has no group 1, \c
 * without a letter as a backslash, a quantified (?=...), and so on - plus the
 * modifier groups of ECMAScript 2025, (?i:...) and (?-i:...).
 *
 * The pattern is first handed to the running engine's own RegExp constructor
 * (LinearRegExp.ts does that), which decides whether it is a regular
 * expression at all and says what is wrong when it is not; this parser then
 * builds the tree the linear matcher runs. A back-reference is the one thing
 * a valid pattern can hold that this matcher refuses (see PatternProblem.ts).
 */

const BACKSLASH: number = 0x5c;
const HYPHEN: number = 0x2d;

export const DIGIT_SET: CharacterSet = CharacterSet.fromPairs([0x30, 0x39]);

export const WORD_SET: CharacterSet = CharacterSet.fromPairs([
  0x30, 0x39, 0x41, 0x5a, 0x5f, 0x5f, 0x61, 0x7a,
]);

// WhiteSpace and LineTerminator, as \s reads them.
export const SPACE_SET: CharacterSet = CharacterSet.fromPairs([
  0x09, 0x0d, 0x20, 0x20, 0xa0, 0xa0, 0x1680, 0x1680, 0x2000, 0x200a, 0x2028,
  0x2029, 0x202f, 0x202f, 0x205f, 0x205f, 0x3000, 0x3000, 0xfeff, 0xfeff,
]);

export const LINE_TERMINATOR_SET: CharacterSet = CharacterSet.fromPairs([
  0x0a, 0x0a, 0x0d, 0x0d, 0x2028, 0x2029,
]);

const DOT_SET: CharacterSet = LINE_TERMINATOR_SET.complement();
const ALL_SET: CharacterSet = CharacterSet.all();

export interface PatternFlags {
  ignoreCase: boolean;
  multiline: boolean;
  dotAll: boolean;
}

interface ClassAtom {
  // A single code unit, or null when the atom is a set such as \d.
  codeUnit: number | null;
  set: CharacterSet;
}

interface Quantifier {
  min: number;
  max: number;
  greedy: boolean;
}

function isDecimalDigit(codeUnit: number): boolean {
  return codeUnit >= 0x30 && codeUnit <= 0x39;
}

function isOctalDigit(codeUnit: number): boolean {
  return codeUnit >= 0x30 && codeUnit <= 0x37;
}

function isAsciiLetter(codeUnit: number): boolean {
  return (
    (codeUnit >= 0x41 && codeUnit <= 0x5a) ||
    (codeUnit >= 0x61 && codeUnit <= 0x7a)
  );
}

function hexValue(codeUnit: number): number {
  if (codeUnit >= 0x30 && codeUnit <= 0x39) {
    return codeUnit - 0x30;
  }

  if (codeUnit >= 0x41 && codeUnit <= 0x46) {
    return codeUnit - 0x41 + 10;
  }

  if (codeUnit >= 0x61 && codeUnit <= 0x66) {
    return codeUnit - 0x61 + 10;
  }

  return -1;
}

function syntaxError(source: string, message: string): SyntaxError {
  return new SyntaxError(`Invalid regular expression: /${source}/: ${message}`);
}

class Parser {
  private readonly source: string;
  private position: number = 0;
  private flags: PatternFlags;
  private readonly totalCaptures: number;
  private readonly hasNamedGroups: boolean;
  private nextCapture: number = 1;
  private readonly captureNames: Array<string | null> = [];

  public constructor(source: string, flags: PatternFlags) {
    this.source = source;
    this.flags = { ...flags };

    const scan: { captures: number; named: boolean } =
      Parser.scanCaptures(source);

    this.totalCaptures = scan.captures;
    this.hasNamedGroups = scan.named;
  }

  /*
   * How many capturing groups the whole pattern has, and whether any is
   * named - both decide how an escape such as \1 or \k reads (the
   * specification's CountLeftCapturingParensWithin, and the
   * NamedCaptureGroups parameter).
   */
  private static scanCaptures(source: string): {
    captures: number;
    named: boolean;
  } {
    let captures: number = 0;
    let named: boolean = false;
    let inClass: boolean = false;

    for (let index: number = 0; index < source.length; index++) {
      const codeUnit: number = source.charCodeAt(index);

      if (codeUnit === BACKSLASH) {
        index++;
        continue;
      }

      if (inClass) {
        if (codeUnit === 0x5d) {
          inClass = false;
        }

        continue;
      }

      if (codeUnit === 0x5b) {
        inClass = true;
        continue;
      }

      if (codeUnit !== 0x28) {
        continue;
      }

      if (source.charCodeAt(index + 1) !== 0x3f) {
        captures++;
        continue;
      }

      if (source.charCodeAt(index + 2) === 0x3c) {
        const after: number = source.charCodeAt(index + 3);

        if (after !== 0x3d && after !== 0x21) {
          captures++;
          named = true;
        }
      }
    }

    return { captures: captures, named: named };
  }

  public parse(): ParsedPattern {
    const root: SyntaxNode = this.parseDisjunction();

    if (this.position < this.source.length) {
      // The only thing that stops a disjunction early is an unmatched ")".
      throw syntaxError(this.source, "Unmatched ')'");
    }

    return {
      root: root,
      captureCount: this.nextCapture - 1,
      captureNames: this.captureNames,
    };
  }

  private peek(offset: number = 0): number {
    return this.source.charCodeAt(this.position + offset);
  }

  private atEnd(): boolean {
    return this.position >= this.source.length;
  }

  private parseDisjunction(): SyntaxNode {
    const options: Array<SyntaxNode> = [this.parseAlternative()];

    while (!this.atEnd() && this.peek() === 0x7c) {
      this.position++;
      options.push(this.parseAlternative());
    }

    if (options.length === 1) {
      return options[0]!;
    }

    return { kind: "Alternation", options: options };
  }

  private parseAlternative(): SyntaxNode {
    const items: Array<SyntaxNode> = [];

    while (!this.atEnd() && this.peek() !== 0x7c && this.peek() !== 0x29) {
      items.push(this.parseTerm());
    }

    if (items.length === 0) {
      return { kind: "Empty" };
    }

    if (items.length === 1) {
      return items[0]!;
    }

    return { kind: "Sequence", items: items };
  }

  private parseTerm(): SyntaxNode {
    const capturesBefore: number = this.nextCapture;
    const codeUnit: number = this.peek();
    let atom: SyntaxNode;
    let quantifiable: boolean = true;

    switch (codeUnit) {
      case 0x5e: // ^
        this.position++;
        atom = {
          kind: "Assertion",
          assertion: AssertionKind.Start,
          multiline: this.flags.multiline,
        };
        quantifiable = false;
        break;
      case 0x24: // $
        this.position++;
        atom = {
          kind: "Assertion",
          assertion: AssertionKind.End,
          multiline: this.flags.multiline,
        };
        quantifiable = false;
        break;
      case BACKSLASH: {
        const next: number = this.peek(1);

        if (next === 0x62 || next === 0x42) {
          this.position += 2;
          atom = {
            kind: "Assertion",
            assertion:
              next === 0x62
                ? AssertionKind.WordBoundary
                : AssertionKind.NotWordBoundary,
            multiline: this.flags.multiline,
          };
          quantifiable = false;
        } else {
          atom = this.parseAtomEscape();
        }

        break;
      }
      case 0x28: {
        // (
        const group: { node: SyntaxNode; quantifiable: boolean } =
          this.parseGroup();

        atom = group.node;
        quantifiable = group.quantifiable;
        break;
      }
      case 0x2e: // .
        this.position++;
        atom = {
          kind: "Set",
          set: this.flags.dotAll ? ALL_SET : DOT_SET,
          negate: false,
          ignoreCase: this.flags.ignoreCase,
        };
        break;
      case 0x5b: // [
        atom = this.parseClass();
        break;
      case 0x2a: // *
      case 0x2b: // +
      case 0x3f: // ?
        throw syntaxError(this.source, "Nothing to repeat");
      case 0x7b: // {
        if (this.readBracedQuantifier(false) !== null) {
          throw syntaxError(this.source, "Nothing to repeat");
        }

        this.position++;
        atom = this.character(codeUnit);
        break;
      default:
        this.position++;
        atom = this.character(codeUnit);
        break;
    }

    const quantifier: Quantifier | null = this.parseQuantifier();

    if (quantifier === null) {
      return atom;
    }

    if (!quantifiable) {
      throw syntaxError(this.source, "Nothing to repeat");
    }

    return {
      kind: "Repeat",
      min: quantifier.min,
      max: quantifier.max,
      greedy: quantifier.greedy,
      body: atom,
      firstCapture: capturesBefore,
      captureCount: this.nextCapture - capturesBefore,
    };
  }

  private character(codeUnit: number): SyntaxNode {
    return {
      kind: "Character",
      codeUnit: codeUnit,
      ignoreCase: this.flags.ignoreCase,
    };
  }

  private set(set: CharacterSet, negate: boolean): SyntaxNode {
    return {
      kind: "Set",
      set: set,
      negate: negate,
      ignoreCase: this.flags.ignoreCase,
    };
  }

  private parseQuantifier(): Quantifier | null {
    if (this.atEnd()) {
      return null;
    }

    let min: number;
    let max: number;
    const codeUnit: number = this.peek();

    if (codeUnit === 0x2a) {
      min = 0;
      max = Infinity;
      this.position++;
    } else if (codeUnit === 0x2b) {
      min = 1;
      max = Infinity;
      this.position++;
    } else if (codeUnit === 0x3f) {
      min = 0;
      max = 1;
      this.position++;
    } else if (codeUnit === 0x7b) {
      const braced: { min: number; max: number } | null =
        this.readBracedQuantifier(true);

      if (braced === null) {
        return null;
      }

      min = braced.min;
      max = braced.max;
    } else {
      return null;
    }

    let greedy: boolean = true;

    if (!this.atEnd() && this.peek() === 0x3f) {
      greedy = false;
      this.position++;
    }

    return { min: min, max: max, greedy: greedy };
  }

  /*
   * {n}, {n,} or {n,m} at the current position, or null when what follows the
   * "{" is not one - it is then a plain "{". Moves past it only when consume
   * is set.
   */
  private readBracedQuantifier(
    consume: boolean,
  ): { min: number; max: number } | null {
    let index: number = this.position + 1;
    const minStart: number = index;

    while (isDecimalDigit(this.source.charCodeAt(index))) {
      index++;
    }

    if (index === minStart) {
      return null;
    }

    const min: number = Number(this.source.slice(minStart, index));
    let max: number = min;

    if (this.source.charCodeAt(index) === 0x2c) {
      index++;
      const maxStart: number = index;

      while (isDecimalDigit(this.source.charCodeAt(index))) {
        index++;
      }

      max =
        index === maxStart
          ? Infinity
          : Number(this.source.slice(maxStart, index));
    }

    if (this.source.charCodeAt(index) !== 0x7d) {
      return null;
    }

    if (max < min) {
      throw syntaxError(this.source, "numbers out of order in {} quantifier");
    }

    if (consume) {
      this.position = index + 1;
    }

    return { min: min, max: max };
  }

  private parseGroup(): { node: SyntaxNode; quantifiable: boolean } {
    if (this.peek(1) !== 0x3f) {
      // ( ... ): a capturing group.
      this.position++;
      return { node: this.parseCapture(null), quantifiable: true };
    }

    const kind: number = this.peek(2);

    if (kind === 0x3a) {
      // (?: ... )
      this.position += 3;
      const body: SyntaxNode = this.parseDisjunction();
      this.expectClose();
      return { node: body, quantifiable: true };
    }

    if (kind === 0x3d || kind === 0x21) {
      // (?= ... ) or (?! ... ): Annex B lets a pattern repeat these.
      this.position += 3;
      const body: SyntaxNode = this.parseDisjunction();
      this.expectClose();
      return {
        node: {
          kind: "Lookaround",
          behind: false,
          negate: kind === 0x21,
          body: body,
        },
        quantifiable: true,
      };
    }

    if (kind === 0x3c) {
      const after: number = this.peek(3);

      if (after === 0x3d || after === 0x21) {
        // (?<= ... ) or (?<! ... )
        this.position += 4;
        const body: SyntaxNode = this.parseDisjunction();
        this.expectClose();
        return {
          node: {
            kind: "Lookaround",
            behind: true,
            negate: after === 0x21,
            body: body,
          },
          quantifiable: false,
        };
      }

      // (?<name> ... )
      const nameEnd: number = this.source.indexOf(">", this.position + 3);

      if (nameEnd === -1) {
        throw syntaxError(this.source, "Invalid capture group name");
      }

      const name: string = this.source.slice(this.position + 3, nameEnd);
      this.position = nameEnd + 1;
      return { node: this.parseCapture(name), quantifiable: true };
    }

    return { node: this.parseModifierGroup(), quantifiable: true };
  }

  private parseCapture(name: string | null): SyntaxNode {
    const captureIndex: number = this.nextCapture++;
    this.captureNames[captureIndex - 1] = name;

    const body: SyntaxNode = this.parseDisjunction();
    this.expectClose();

    return {
      kind: "Group",
      captureIndex: captureIndex,
      name: name,
      body: body,
    };
  }

  /*
   * (?ims-ims: ... ) - ECMAScript 2025 turns i, m or s on or off for the part
   * of the pattern inside.
   */
  private parseModifierGroup(): SyntaxNode {
    let index: number = this.position + 2;
    const added: Set<number> = new Set<number>();
    const removed: Set<number> = new Set<number>();
    let target: Set<number> = added;
    let sawHyphen: boolean = false;

    for (;;) {
      const codeUnit: number = this.source.charCodeAt(index);

      if (codeUnit === 0x3a) {
        break;
      }

      if (codeUnit === HYPHEN && !sawHyphen) {
        sawHyphen = true;
        target = removed;
        index++;
        continue;
      }

      if (
        (codeUnit === 0x69 || codeUnit === 0x6d || codeUnit === 0x73) &&
        !added.has(codeUnit) &&
        !removed.has(codeUnit)
      ) {
        target.add(codeUnit);
        index++;
        continue;
      }

      throw syntaxError(this.source, "Invalid group");
    }

    if (added.size === 0 && removed.size === 0) {
      throw syntaxError(this.source, "Invalid group");
    }

    this.position = index + 1;

    const outer: PatternFlags = this.flags;
    const inner: PatternFlags = { ...outer };

    for (const [codeUnit, value] of [
      ...Array.from(added).map((flag: number): [number, boolean] => {
        return [flag, true];
      }),
      ...Array.from(removed).map((flag: number): [number, boolean] => {
        return [flag, false];
      }),
    ]) {
      if (codeUnit === 0x69) {
        inner.ignoreCase = value;
      } else if (codeUnit === 0x6d) {
        inner.multiline = value;
      } else {
        inner.dotAll = value;
      }
    }

    this.flags = inner;
    const body: SyntaxNode = this.parseDisjunction();
    this.flags = outer;
    this.expectClose();

    return body;
  }

  private expectClose(): void {
    if (this.atEnd() || this.peek() !== 0x29) {
      throw syntaxError(this.source, "Unterminated group");
    }

    this.position++;
  }

  // At a backslash outside a class, not followed by b or B.
  private parseAtomEscape(): SyntaxNode {
    this.position++;

    if (this.atEnd()) {
      throw syntaxError(this.source, "\\ at end of pattern");
    }

    const codeUnit: number = this.peek();

    const classEscape: CharacterSet | null = this.readClassEscape(codeUnit);

    if (classEscape !== null) {
      this.position++;
      return this.set(classEscape, false);
    }

    if (codeUnit >= 0x31 && codeUnit <= 0x39) {
      // \1 .. \9...: a back-reference when the pattern has that many groups.
      let end: number = this.position;

      while (isDecimalDigit(this.source.charCodeAt(end))) {
        end++;
      }

      const groupNumber: number = Number(this.source.slice(this.position, end));

      if (groupNumber <= this.totalCaptures) {
        throw new PatternProblemError(
          PatternProblemReason.BackReference,
          `The pattern refers back to group ${groupNumber} (\\${groupNumber}).`,
        );
      }
    }

    if (codeUnit === 0x6b && this.hasNamedGroups) {
      // \k<name>
      throw new PatternProblemError(
        PatternProblemReason.BackReference,
        "The pattern refers back to a named group (\\k<name>).",
      );
    }

    if (codeUnit === 0x63 && !isAsciiLetter(this.peek(1))) {
      /*
       * \c without a letter after it: a backslash, and the "c" is read on its
       * own after it.
       */
      return this.character(BACKSLASH);
    }

    return this.character(this.readCharacterEscape(false));
  }

  /*
   * \d \D \s \S \w \W - the escapes that stand for a set. Null for any other
   * code unit after the backslash. Does not move.
   */
  private readClassEscape(codeUnit: number): CharacterSet | null {
    switch (codeUnit) {
      case 0x64:
        return DIGIT_SET;
      case 0x44:
        return DIGIT_SET.complement();
      case 0x73:
        return SPACE_SET;
      case 0x53:
        return SPACE_SET.complement();
      case 0x77:
        return WORD_SET;
      case 0x57:
        return WORD_SET.complement();
      default:
        return null;
    }
  }

  /*
   * The code unit an escape stands for, the position on the code unit after
   * the backslash. Moves past the escape. Inside a class, \b is a backspace,
   * \c may take a digit or "_", and there are no back-references.
   */
  private readCharacterEscape(inClass: boolean): number {
    const codeUnit: number = this.peek();

    switch (codeUnit) {
      case 0x66: // f
        this.position++;
        return 0x0c;
      case 0x6e: // n
        this.position++;
        return 0x0a;
      case 0x72: // r
        this.position++;
        return 0x0d;
      case 0x74: // t
        this.position++;
        return 0x09;
      case 0x76: // v
        this.position++;
        return 0x0b;
      case 0x63: {
        // \cX
        const letter: number = this.peek(1);
        this.position += 2;
        return letter % 32;
      }
      case 0x78: {
        // \xHH, or an "x"
        const high: number = hexValue(this.peek(1));
        const low: number = hexValue(this.peek(2));

        if (high >= 0 && low >= 0) {
          this.position += 3;
          return high * 16 + low;
        }

        this.position++;
        return codeUnit;
      }
      case 0x75: {
        // \uHHHH, or a "u"
        let value: number = 0;

        for (let digit: number = 1; digit <= 4; digit++) {
          const hex: number = hexValue(this.peek(digit));

          if (hex < 0) {
            this.position++;
            return codeUnit;
          }

          value = value * 16 + hex;
        }

        this.position += 5;
        return value;
      }
      case 0x30:
      case 0x31:
      case 0x32:
      case 0x33:
      case 0x34:
      case 0x35:
      case 0x36:
      case 0x37:
        return this.readLegacyOctal();
      default:
        // An identity escape: \8, \9, \., \/, \a, \- ... stand for themselves.
        this.position++;

        if (inClass && codeUnit === 0x62) {
          return 0x08;
        }

        return codeUnit;
    }
  }

  /*
   * \0 to \377 (Annex B's LegacyOctalEscapeSequence, which also covers \0
   * on its own): up to three octal digits while the value stays within 255.
   */
  private readLegacyOctal(): number {
    const first: number = this.peek() - 0x30;
    this.position++;

    if (!isOctalDigit(this.peek())) {
      return first;
    }

    const second: number = this.peek() - 0x30;

    if (first <= 3 && isOctalDigit(this.peek(1))) {
      const third: number = this.peek(1) - 0x30;
      this.position += 2;
      return first * 64 + second * 8 + third;
    }

    this.position++;
    return first * 8 + second;
  }

  private parseClass(): SyntaxNode {
    this.position++;

    let negate: boolean = false;

    if (!this.atEnd() && this.peek() === 0x5e) {
      negate = true;
      this.position++;
    }

    const pairs: Array<number> = [];
    const addAtom: (atom: ClassAtom) => void = (atom: ClassAtom): void => {
      pairs.push(...atom.set.ranges);
    };

    for (;;) {
      if (this.atEnd()) {
        throw syntaxError(this.source, "Unterminated character class");
      }

      if (this.peek() === 0x5d) {
        this.position++;
        break;
      }

      const first: ClassAtom = this.parseClassAtom();

      if (
        !this.atEnd() &&
        this.peek() === HYPHEN &&
        this.position + 1 < this.source.length &&
        this.peek(1) !== 0x5d
      ) {
        this.position++;
        const second: ClassAtom = this.parseClassAtom();

        if (first.codeUnit !== null && second.codeUnit !== null) {
          if (first.codeUnit > second.codeUnit) {
            throw syntaxError(
              this.source,
              "Range out of order in character class",
            );
          }

          pairs.push(first.codeUnit, second.codeUnit);
          continue;
        }

        // [\d-z] without the u flag: \d, "-" and "z".
        addAtom(first);
        pairs.push(HYPHEN, HYPHEN);
        addAtom(second);
        continue;
      }

      addAtom(first);
    }

    return this.set(CharacterSet.fromPairs(pairs), negate);
  }

  private parseClassAtom(): ClassAtom {
    const codeUnit: number = this.peek();

    if (codeUnit !== BACKSLASH) {
      this.position++;
      return { codeUnit: codeUnit, set: CharacterSet.of(codeUnit) };
    }

    this.position++;

    if (this.atEnd()) {
      throw syntaxError(this.source, "\\ at end of pattern");
    }

    const escaped: number = this.peek();
    const classEscape: CharacterSet | null = this.readClassEscape(escaped);

    if (classEscape !== null) {
      this.position++;
      return { codeUnit: null, set: classEscape };
    }

    if (escaped === 0x63) {
      const after: number = this.peek(1);

      if (!isAsciiLetter(after) && !isDecimalDigit(after) && after !== 0x5f) {
        // [\c] or [\c-]: a backslash; the "c" is read on its own.
        return { codeUnit: BACKSLASH, set: CharacterSet.of(BACKSLASH) };
      }
    }

    if (escaped === 0x6b && this.hasNamedGroups) {
      throw syntaxError(this.source, "Invalid escape");
    }

    const value: number = this.readCharacterEscape(true);

    return { codeUnit: value, set: CharacterSet.of(value) };
  }
}

/*
 * The tree for a pattern the running engine's RegExp constructor accepted.
 * Throws PatternProblemError for a back-reference, and SyntaxError for what
 * is not a pattern at all.
 */
export function parsePattern(
  source: string,
  flags: PatternFlags,
): ParsedPattern {
  return new Parser(source, flags).parse();
}
