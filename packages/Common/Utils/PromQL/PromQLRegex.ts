import LinearRegExp, {
  refusePatternTooLong,
} from "../LinearRegExp/LinearRegExp";
import {
  describePatternProblem,
  getLinearRegExp,
} from "../LinearRegExp/PatternCache";
import {
  PatternProblemError,
  PatternProblemReason,
} from "../LinearRegExp/PatternProblem";
import {
  CodePointRanges,
  complementOf,
  caseFoldedLetter,
  foldCase,
  MAX_CODE_POINT,
  namedSet,
  needsWrittenCaseFold,
  perlClass,
  POSIX_CLASS_NAMES,
  posixClass,
  toCodePointRanges,
  writeCodePoint,
  writeSet,
  WrittenSet,
} from "./RE2CharacterClass";

/*
 * PromQL's regular expressions, read in JavaScript.
 *
 * Prometheus matches with Go's RE2 and compiles a pattern as
 * `^(?s:<pattern>)$`: a label matcher in NewFastRegexMatcher
 * (model/labels/regexp.go, which reads the pattern with RE2's Perl flags
 * and DotNL first), label_replace() in evalLabelReplace
 * (promql/functions.go). So a pattern
 *  - is anchored at both ends of the whole value: `=~"api"` matches "api"
 *    and not "api-2";
 *  - reads `.` as any character, "\n" too: `=~"a.b"` matches "a\nb";
 *  - keeps its own flag groups inside: (?i), (?m), (?s) or (?U) applies from
 *    where it stands to the end of the group that holds it, as RE2 reads it
 *    (parsePerlFlags and parseRightParen in Go's regexp/syntax/parse.go).
 *    So `=~"(?m)api"` still means the whole value, and `=~"api(?i)SERVER"`
 *    matches "apiServer" and not "APIserver".
 *
 * A pattern is read here as RE2 reads it, in one pass, and written as
 * JavaScript's RegExp without the u flag reads it:
 *  - A flag group. JavaScript has no (?i) that runs to the end of a group,
 *    only a modifier group around a part, (?i: ... ), and no U at all. (?i),
 *    (?m) and (?s) become modifier groups around the rest of their group,
 *    its alternatives kept apart; (?U) swaps each repeat's greed (x* reads
 *    as x*?, and x*? as x*).
 *  - `.` without s matches anything but "\n" in RE2, and in JavaScript
 *    anything but "\n", "\r", U+2028 and U+2029: it is written [^\n].
 *  - ^ and $ with m match next to a "\n" in RE2, and in JavaScript next to
 *    "\r", U+2028 and U+2029 too: a look-around leaves those three out.
 *    \A and \z are the whole value's start and end, under (?m) too.
 *  - A bracket is read into the set of code points RE2 reads it as
 *    (parseClass, parse.go) - a "]" first is a character, [:digit:] and
 *    [:^digit:] are POSIX classes, \d \s \w and their negations are RE2's
 *    (\s is [\t\n\f\r ], without JavaScript's \v and other spaces), a
 *    range's ends are single characters - and the set is written as a
 *    class (RE2CharacterClass.ts). So are \d \s \w outside one.
 *  - (?i) joins the cases Go's case folding joins: JavaScript's i flag
 *    joins most of them, and the rest - the Kelvin sign with k, the long s
 *    with s, letters beyond U+FFFF - are written out.
 *  - An escape is read as RE2 reads it (parseEscape): \Q...\E is its text,
 *    \x{41} and \x41 the code point, \0 to \777 octal, \a the bell. The
 *    escapes RE2 does not have are refused, as Prometheus refuses them.
 *  - A repeat repeats what RE2's repeats: what comes before a flag group
 *    (a(?i)* is a*), an assertion (^*), or a repeat with a flag group
 *    between ((?:a*)*). A repeat of a repeat with nothing between, a*+, is
 *    refused, as are counts over 1000 - counting a repeat inside another
 *    as their product (repeatIsValid) - and a {n} with a leading zero is
 *    a "{", as RE2 reads it.
 *  - Named groups, (?P<name> ... ) and (?<name> ... ), become groups with
 *    no name, their names kept beside them (groupNames): RE2 takes a name
 *    such as 1a, and two groups of the same name, which JavaScript does
 *    not.
 *
 * Refused, as Prometheus refuses them, each said in a sentence that names
 * what is not read (PromQLPatternError): a POSIX class RE2 does not have
 * ([[:nosuch:]]; names are lowercase), \C, look-aheads and look-behinds, a
 * repeat over 1000, an escape RE2 does not have (\e, A), a group name
 * that is not letters, digits and _. A back-reference (\1, \k<name>) is
 * refused as the linear-time matcher refuses one.
 *
 * Where the reading still differs from Prometheus, decided:
 *  - \pL, \p{Greek} and other Unicode classes are refused: the linear-time
 *    matcher reads code units, not Unicode properties. Before, \pL was
 *    read as the letters "pL".
 *  - A character beyond U+FFFF, such as an emoji, is two characters to "."
 *    and to a negated class, where RE2 reads one: ^.$ does not match "😀"
 *    here. A bracket or escape that names such characters, [\x{1F600}-
 *    \x{1F64F}], matches each as one.
 *  - What label_replace()'s groups capture inside a repeat whose iteration
 *    can match nothing: (?:|x)+(\w*) on "xx" captures "xx" in Prometheus,
 *    whose automaton leaves the repeat for the empty alternative, and ""
 *    here, where the matcher repeats as JavaScript does (an iteration that
 *    matches nothing ends the repeat). Whether such a pattern matches is the
 *    same; only what a group captures in it differs. Kept: the matcher's
 *    captures are JavaScript's throughout.
 *  - label_replace() with parentheses that do not balance, a)|(b, or a \Q
 *    with no \E. Prometheus pastes the pattern into "^(?s:" ... ")$", so
 *    there a)|(b reads as ^(?s:a)|(b)$, and \Qa.b swallows the ")$" and is
 *    refused. Its label matchers read the pattern on its own: they refuse
 *    a)|(b and read \Qa.b as "a.b". Read here as those matchers read it,
 *    in label_replace() too.
 *
 * A matcher's pattern is written by a project's people, so it runs on the
 * linear-time matcher (Utils/LinearRegExp), as every such pattern does: in
 * time in line with the value it reads, as RE2 runs it. It is compiled once
 * and kept (PatternCache), by the pattern, so a query that asks it about
 * every series compiles it once.
 */

/*
 * A pattern Prometheus refuses, or that is not read here, with the reason
 * in words: a SyntaxError, as any pattern that is not a regular expression.
 */
export class PromQLPatternError extends SyntaxError {
  // The rest of a sentence that starts "The pattern ...".
  public readonly problem: string;

  public constructor(pattern: string, problem: string) {
    super(`The pattern "${pattern}" ${problem}`);
    this.problem = problem;
  }
}

/*
 * Why a pattern cannot be matched, in words for the person who wrote it:
 * the end of a sentence that starts "The pattern ...". Null for an error
 * that says nothing more than that the pattern is not one.
 */
export const describePromQLPatternProblem: (error: unknown) => string | null = (
  error: unknown,
): string | null => {
  if (error instanceof PromQLPatternError) {
    return error.problem;
  }

  return describePatternProblem(error);
};

// The most times RE2 repeats a part (repeat and repeatIsValid, parse.go).
const MAX_REPEAT: number = 1000;

// ^ and $ with m, matching next to a "\n" only, as RE2's do.
const LINE_START: string = "^(?<![\\r\\u2028\\u2029])";
const LINE_END: string = "$(?![\\r\\u2028\\u2029])";

// . without s: anything but "\n", as RE2's.
const ANY_BUT_NEWLINE: string = "[^\\n]";

// RE2's flags at one point of a pattern.
interface RE2Flags {
  // i: a letter matches either case.
  ignoreCase: boolean;
  // m: ^ and $ match at each line's start and end (RE2 clears OneLine).
  multiline: boolean;
  // s: . matches "\n" too (DotNL).
  dotAll: boolean;
  // U: x* is lazy and x*? greedy (NonGreedy).
  ungreedy: boolean;
}

// The flags a flag group names, by their letters.
const FLAG_LETTERS: ReadonlyMap<string, keyof RE2Flags> = new Map<
  string,
  keyof RE2Flags
>([
  ["i", "ignoreCase"],
  ["m", "multiline"],
  ["s", "dotAll"],
  ["U", "ungreedy"],
]);

// The flags a JavaScript modifier group sets: i, m and s, not U.
const MODIFIER_LETTERS: ReadonlyArray<
  [string, "ignoreCase" | "multiline" | "dotAll"]
> = [
  ["i", "ignoreCase"],
  ["m", "multiline"],
  ["s", "dotAll"],
];

/*
 * The flags a pattern starts with in Prometheus: ^ and $ at the ends of the
 * whole value, and . matching "\n" (the `(?s:` around the pattern).
 */
const PROMETHEUS_FLAGS: RE2Flags = {
  ignoreCase: false,
  multiline: false,
  dotAll: true,
  ungreedy: false,
};

/*
 * What the current alternative ends with, which a repeat after it repeats:
 * where it is written (output[start] up to output[end]), and what repeating
 * it takes.
 */
interface LastAtom {
  start: number;
  end: number;
  /*
   * Whether JavaScript repeats it only inside a group: an assertion, two
   * code units, or a repeat.
   */
  needsGroup: boolean;
  /*
   * The most times its innermost part is repeated, the counts of the
   * {n,m} repeats around it multiplied (repeatIsValid, parse.go).
   */
  repeats: number;
}

// One group of the pattern, from its "(" to its ")"; the pattern is one too.
interface OpenGroup {
  // The flags in force now: a flag group changes them to the group's end.
  flags: RE2Flags;
  /*
   * The i, m and s the JavaScript written so far sets from here to the
   * group's end: the group's own, or the last modifier group opened to the
   * group's end (restModifierGroups).
   */
  restFlags: RE2Flags;
  // How many modifier groups are open to the group's end.
  restModifierGroups: number;
  /*
   * Whether a modifier group is open to the end of the current alternative:
   * one a flag group opened after the alternative's start.
   */
  alternativeModifierGroupOpen: boolean;
  // Whether the current alternative has anything in it yet.
  alternativeStarted: boolean;
  // What the current alternative ends with; null at its start.
  lastAtom: LastAtom | null;
  // Where the group's "(" is written.
  start: number;
  /*
   * The most any part of the group is repeated (LastAtom.repeats), but the
   * current alternative's last part, which a repeat may still change.
   */
  repeats: number;
}

const openGroup: (flags: RE2Flags, start: number) => OpenGroup = (
  flags: RE2Flags,
  start: number,
): OpenGroup => {
  return {
    flags: flags,
    restFlags: flags,
    restModifierGroups: 0,
    alternativeModifierGroupOpen: false,
    alternativeStarted: false,
    lastAtom: null,
    start: start,
    repeats: 1,
  };
};

/*
 * The JavaScript modifier group that turns `from`'s i, m and s into `to`'s,
 * such as "(?i-s:"; "" when they are the same.
 */
const modifierGroup: (from: RE2Flags, to: RE2Flags) => string = (
  from: RE2Flags,
  to: RE2Flags,
): string => {
  let added: string = "";
  let removed: string = "";

  for (const [letter, flag] of MODIFIER_LETTERS) {
    if (to[flag] && !from[flag]) {
      added += letter;
    } else if (!to[flag] && from[flag]) {
      removed += letter;
    }
  }

  if (added.length === 0 && removed.length === 0) {
    return "";
  }

  return `(?${added}${removed.length > 0 ? `-${removed}` : ""}:`;
};

const sameFlags: (one: RE2Flags, other: RE2Flags) => boolean = (
  one: RE2Flags,
  other: RE2Flags,
): boolean => {
  return (
    one.ignoreCase === other.ignoreCase &&
    one.multiline === other.multiline &&
    one.dotAll === other.dotAll &&
    one.ungreedy === other.ungreedy
  );
};

const isDecimalDigit: (codeUnit: number) => boolean = (
  codeUnit: number,
): boolean => {
  return codeUnit >= 0x30 && codeUnit <= 0x39;
};

const isOctalDigit: (codeUnit: number) => boolean = (
  codeUnit: number,
): boolean => {
  return codeUnit >= 0x30 && codeUnit <= 0x37;
};

// isalnum in parse.go: ASCII letters and digits only.
const isAsciiAlphanumeric: (codePoint: number) => boolean = (
  codePoint: number,
): boolean => {
  return (
    isDecimalDigit(codePoint) ||
    (codePoint >= 0x41 && codePoint <= 0x5a) ||
    (codePoint >= 0x61 && codePoint <= 0x7a)
  );
};

const hexValue: (codeUnit: number) => number = (codeUnit: number): number => {
  if (isDecimalDigit(codeUnit)) {
    return codeUnit - 0x30;
  }

  if (codeUnit >= 0x41 && codeUnit <= 0x46) {
    return codeUnit - 0x41 + 10;
  }

  if (codeUnit >= 0x61 && codeUnit <= 0x66) {
    return codeUnit - 0x61 + 10;
  }

  return -1;
};

// A group's name RE2 takes: ASCII letters, digits and _ (isValidCaptureName).
const isCaptureName: (name: string) => boolean = (name: string): boolean => {
  if (name.length === 0) {
    return false;
  }

  for (let index: number = 0; index < name.length; index++) {
    const codeUnit: number = name.charCodeAt(index);

    if (codeUnit !== 0x5f && !isAsciiAlphanumeric(codeUnit)) {
      return false;
    }
  }

  return true;
};

// RE2's single-letter escapes for a control character (parseEscape).
const CONTROL_ESCAPES: ReadonlyMap<string, number> = new Map<string, number>([
  ["a", 0x07],
  ["f", 0x0c],
  ["n", 0x0a],
  ["r", 0x0d],
  ["t", 0x09],
  ["v", 0x0b],
]);

// What a refusal says Prometheus does too.
const PROMETHEUS_TOO: string = "which Prometheus does not read either";

// The POSIX classes RE2 has, for a sentence: "[:alnum:], ... and [:xdigit:]".
const POSIX_CLASS_LIST: string = ((): string => {
  const names: Array<string> = POSIX_CLASS_NAMES.map((name: string): string => {
    return `[:${name}:]`;
  });

  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
})();

// What a pattern says it repeats, for a sentence: "{1001}" or "*".
interface RepeatOperator {
  text: string;
  min: number;
  // -1: no upper bound.
  max: number;
  // Whether it is a {n,m} count, which RE2 checks against MAX_REPEAT.
  counted: boolean;
}

/*
 * A pattern read as RE2 reads it, written as JavaScript's RegExp reads it,
 * with the names of its groups.
 */
class RE2Translation {
  private readonly pattern: string;
  private position: number = 0;
  private readonly output: Array<string> = [];
  // The groups open where the reading is, the whole pattern first.
  private readonly groups: Array<OpenGroup> = [openGroup(PROMETHEUS_FLAGS, 0)];
  // Each capturing group's name, group 1 first; null for a group with none.
  private readonly groupNames: Array<string | null> = [];
  /*
   * Whether the last thing read is a repeat. RE2 refuses a repeat right
   * after one, x** or x*??, as a nested repetition (repeat, parse.go), and
   * repeats the repeat when anything comes between, even a flag group:
   * x*(?i)* is (?:x*)*.
   */
  private afterRepeat: boolean = false;
  /*
   * Where the first ":]" after the last "[:" read is, -1 for none: found
   * once for the "[:"s before it, as the reading only moves on, so a
   * pattern of many "[:" is read in time in line with its length.
   */
  private posixClassEnd: number = -2;

  public constructor(pattern: string) {
    this.pattern = pattern;
  }

  /*
   * The pattern in JavaScript, to be read inside `(?s:` ... `)`, and the
   * names of its groups. Throws a PromQLPatternError, or PatternProblemError
   * for a back-reference, for what RE2 refuses, and a SyntaxError for what
   * is no pattern at all: a group or bracket left open, a ")" that closes
   * nothing, a "\" at the end.
   */
  public translate(): {
    source: string;
    groupNames: Array<string | null>;
  } {
    while (this.position < this.pattern.length) {
      this.readNext();
    }

    if (this.groups.length > 1) {
      throw this.syntaxError("Unterminated group");
    }

    this.closeModifierGroups(this.group());

    return { source: this.output.join(""), groupNames: this.groupNames };
  }

  private group(): OpenGroup {
    return this.groups[this.groups.length - 1]!;
  }

  private syntaxError(message: string): SyntaxError {
    return new SyntaxError(
      `Invalid regular expression: /${this.pattern}/: ${message}`,
    );
  }

  private refuse(problem: string): PromQLPatternError {
    return new PromQLPatternError(this.pattern, problem);
  }

  // Writes text the current alternative matches or asserts.
  private write(text: string): void {
    this.output.push(text);
    this.group().alternativeStarted = true;
    this.afterRepeat = false;
  }

  // Writes something a repeat after it repeats.
  private writeAtom(
    text: string,
    needsGroup: boolean,
    repeats: number = 1,
  ): void {
    const group: OpenGroup = this.group();
    const start: number = this.output.length;

    this.write(text);
    this.endAtom(group);
    group.lastAtom = {
      start: start,
      end: this.output.length,
      needsGroup: needsGroup,
      repeats: repeats,
    };
  }

  /*
   * The alternative's last part is no longer last: no repeat can change it
   * now, so the group counts it as it is.
   */
  private endAtom(group: OpenGroup): void {
    if (group.lastAtom !== null) {
      group.repeats = Math.max(group.repeats, group.lastAtom.repeats);
    }
  }

  private writeSet(set: CodePointRanges): void {
    const written: WrittenSet = writeSet(set);

    this.writeAtom(written.source, written.needsGroup);
  }

  /*
   * A code point matched as written, or under (?i) as Go folds it: the
   * Kelvin sign and k alike.
   */
  private writeLiteral(codePoint: number): void {
    if (this.group().flags.ignoreCase && needsWrittenCaseFold(codePoint)) {
      this.writeSet(caseFoldedLetter(codePoint));
      return;
    }

    const written: WrittenSet = writeCodePoint(codePoint);

    this.writeAtom(written.source, written.needsGroup);
  }

  // The code point at `index`: a surrogate pair is one, as RE2 reads UTF-8.
  private codePointAt(index: number): number {
    return this.pattern.codePointAt(index)!;
  }

  private static lengthOf(codePoint: number): number {
    return codePoint > 0xffff ? 2 : 1;
  }

  private readNext(): void {
    const character: string = this.pattern[this.position]!;
    const flags: RE2Flags = this.group().flags;

    switch (character) {
      case "\\":
        this.readEscape();
        return;
      case "[":
        this.readBracket();
        return;
      case "(":
        this.readGroupStart();
        return;
      case ")":
        this.readGroupEnd();
        return;
      case "|":
        this.readBar();
        return;
      case "*":
      case "+":
      case "?":
        this.position++;
        this.readRepeat({
          text: character,
          min: character === "+" ? 1 : 0,
          max: character === "?" ? 1 : -1,
          counted: false,
        });
        return;
      case "{": {
        const repeat: RepeatOperator | null = this.bracedRepeat();

        if (repeat !== null) {
          this.position += repeat.text.length;
          this.readRepeat(repeat);
          return;
        }

        // Not a repeat to RE2: a "{", {01} and {,5} included.
        this.writeLiteral(0x7b);
        this.position++;
        return;
      }
      case ".":
        this.writeAtom(flags.dotAll ? "." : ANY_BUT_NEWLINE, false);
        this.position++;
        return;
      case "^":
        this.writeAtom(flags.multiline ? LINE_START : "^", true);
        this.position++;
        return;
      case "$":
        this.writeAtom(flags.multiline ? LINE_END : "$", true);
        this.position++;
        return;
      default: {
        const codePoint: number = this.codePointAt(this.position);

        this.writeLiteral(codePoint);
        this.position += RE2Translation.lengthOf(codePoint);
        return;
      }
    }
  }

  // An escape outside a bracket (the "\\" case of parse, parse.go).
  private readEscape(): void {
    if (this.position + 1 >= this.pattern.length) {
      throw this.syntaxError("\\ at end of pattern");
    }

    const flags: RE2Flags = this.group().flags;
    const letter: string = this.pattern[this.position + 1]!;

    switch (letter) {
      case "A":
        // The value's start, under (?m) too.
        this.writeAtom(flags.multiline ? "(?-m:^)" : "^", true);
        this.position += 2;
        return;
      case "z":
        this.writeAtom(flags.multiline ? "(?-m:$)" : "$", true);
        this.position += 2;
        return;
      case "b":
      case "B":
        // A word boundary: ASCII word characters, in RE2 and JavaScript alike.
        this.writeAtom(`\\${letter}`, true);
        this.position += 2;
        return;
      case "C":
        throw this.refuse(
          `uses \\C, one byte of a character, ${PROMETHEUS_TOO}. Use . to match any one character.`,
        );
      case "Q":
        this.readQuoted();
        return;
      case "p":
      case "P":
        throw this.unicodeClassRefusal();
      default:
        break;
    }

    const perl: CodePointRanges | undefined = perlClass(letter.toLowerCase());

    if (perl !== undefined) {
      this.writeSet(
        namedSet({
          set: perl,
          negated: letter !== letter.toLowerCase(),
          ignoreCase: flags.ignoreCase,
        }),
      );
      this.position += 2;
      return;
    }

    this.writeLiteral(this.readEscapedCodePoint(false));
  }

  /*
   * \Q ... \E: every character between is itself, to the end of the pattern
   * when no \E follows.
   */
  private readQuoted(): void {
    const start: number = this.position + 2;
    const end: number = this.pattern.indexOf("\\E", start);
    const stop: number = end === -1 ? this.pattern.length : end;

    for (let index: number = start; index < stop; ) {
      const codePoint: number = this.codePointAt(index);

      this.writeLiteral(codePoint);
      index += RE2Translation.lengthOf(codePoint);
    }

    this.position = end === -1 ? this.pattern.length : end + 2;
    // \Q\E holds nothing, and still ends a repeat's run, as RE2 reads it.
    this.afterRepeat = false;
  }

  private unicodeClassRefusal(): PromQLPatternError {
    const letter: string = this.pattern[this.position + 1]!;
    const braced: boolean = this.pattern[this.position + 2] === "{";
    const close: number = this.pattern.indexOf("}", this.position);
    const written: string = braced
      ? this.pattern.slice(
          this.position,
          close === -1 ? this.pattern.length : close + 1,
        )
      : this.pattern.slice(this.position, this.position + 3);

    return this.refuse(
      `uses the Unicode class ${written.length > 2 ? written : `\\${letter}`}, which OneUptime cannot match yet, though Prometheus can. Write the characters it stands for in a bracket instead, such as [a-zA-Z].`,
    );
  }

  /*
   * The code point a one-character escape stands for, moving past it
   * (parseEscape, parse.go): \ and any ASCII character but a letter or a
   * digit is that character; \0 to \777 is octal; \x41 and \x{1F600} hex;
   * \a \f \n \r \t \v control characters. Every other escape is refused, as
   * RE2 refuses it.
   */
  private readEscapedCodePoint(inBracket: boolean): number {
    const escape: number = this.position;

    if (escape + 1 >= this.pattern.length) {
      throw this.syntaxError("\\ at end of pattern");
    }

    const codePoint: number = this.codePointAt(escape + 1);
    const letter: string = String.fromCodePoint(codePoint);

    if (codePoint < 0x80 && !isAsciiAlphanumeric(codePoint)) {
      this.position = escape + 2;
      return codePoint;
    }

    if (
      !inBracket &&
      ((codePoint >= 0x31 &&
        codePoint <= 0x39 &&
        !(
          codePoint <= 0x37 && isOctalDigit(this.pattern.charCodeAt(escape + 2))
        )) ||
        letter === "k")
    ) {
      // \1 or \k<name>: "what group 1 matched", which RE2 has not.
      throw new PatternProblemError(
        PatternProblemReason.BackReference,
        `The pattern refers back to a group (\\${letter}).`,
      );
    }

    if (
      codePoint === 0x30 ||
      (codePoint >= 0x31 &&
        codePoint <= 0x37 &&
        isOctalDigit(this.pattern.charCodeAt(escape + 2)))
    ) {
      // Up to three octal digits, the first one included.
      let value: number = codePoint - 0x30;
      let index: number = escape + 2;

      while (
        index < escape + 4 &&
        isOctalDigit(this.pattern.charCodeAt(index))
      ) {
        value = value * 8 + this.pattern.charCodeAt(index) - 0x30;
        index++;
      }

      this.position = index;
      return value;
    }

    if (letter === "x") {
      return this.readHexEscape();
    }

    const control: number | undefined = CONTROL_ESCAPES.get(letter);

    if (control !== undefined) {
      this.position = escape + 2;
      return control;
    }

    throw this.invalidEscape(
      this.pattern.slice(escape, escape + 1 + letter.length),
    );
  }

  private invalidEscape(written: string): PromQLPatternError {
    return this.refuse(
      `uses ${written}, an escape ${PROMETHEUS_TOO}. Write the character itself, or its code as \\x{...}, such as \\x{41} for A.`,
    );
  }

  // \x41 or \x{1F600}, the reading position on its "\".
  private readHexEscape(): number {
    const escape: number = this.position;

    if (this.pattern[escape + 2] === "{") {
      let value: number = 0;
      let index: number = escape + 3;

      while (index < this.pattern.length && this.pattern[index] !== "}") {
        const digit: number = hexValue(this.pattern.charCodeAt(index));

        if (digit < 0) {
          break;
        }

        value = value * 16 + digit;

        if (value > MAX_CODE_POINT) {
          break;
        }

        index++;
      }

      if (
        this.pattern[index] !== "}" ||
        index === escape + 3 ||
        value > MAX_CODE_POINT
      ) {
        const close: number = this.pattern.indexOf("}", escape);

        throw this.invalidEscape(
          this.pattern.slice(
            escape,
            close === -1 ? this.pattern.length : close + 1,
          ),
        );
      }

      this.position = index + 1;
      return value;
    }

    const high: number = hexValue(this.pattern.charCodeAt(escape + 2));
    const low: number = hexValue(this.pattern.charCodeAt(escape + 3));

    if (high < 0 || low < 0) {
      throw this.invalidEscape(this.pattern.slice(escape, escape + 4));
    }

    this.position = escape + 4;
    return high * 16 + low;
  }

  /*
   * A bracket, read to its "]" as RE2 reads it (parseClass, parse.go): a
   * "]" first is a character; [:name:] and [:^name:] are POSIX classes,
   * a name RE2 does not have refused; \d \s \w and their negations are
   * RE2's; a range's ends are single characters; and under (?i) each part
   * holds its other cases. Then turned inside out after a "^".
   */
  private readBracket(): void {
    const ignoreCase: boolean = this.group().flags.ignoreCase;
    let negated: boolean = false;

    this.position++;

    if (this.pattern[this.position] === "^") {
      negated = true;
      this.position++;
    }

    const pairs: Array<number> = [];
    let first: boolean = true;

    for (;;) {
      if (this.position >= this.pattern.length) {
        throw this.syntaxError("Unterminated character class");
      }

      const character: string = this.pattern[this.position]!;

      if (character === "]" && !first) {
        this.position++;
        break;
      }

      first = false;

      const named: Array<number> | null = this.readNamedClass(ignoreCase);

      if (named !== null) {
        pairs.push(...named);
        continue;
      }

      const rangeStart: number = this.position;
      const low: number = this.readBracketCharacter();
      let high: number = low;

      if (
        this.pattern[this.position] === "-" &&
        this.position + 1 < this.pattern.length &&
        this.pattern[this.position + 1] !== "]"
      ) {
        this.position++;
        this.refuseClassAsRangeEnd(rangeStart);
        high = this.readBracketCharacter();

        if (high < low) {
          throw this.refuse(
            `holds the range ${this.pattern.slice(rangeStart, this.position)}, whose end comes before its start, ${PROMETHEUS_TOO}. Write the lower character first.`,
          );
        }
      }

      pairs.push(...(ignoreCase ? foldCase([low, high]) : [low, high]));
    }

    const set: Array<number> = toCodePointRanges(pairs);

    this.writeSet(negated ? complementOf(set) : set);
  }

  /*
   * A range's end is one character (parseClassChar, parse.go): [a-\d] is
   * refused, where JavaScript reads "a", "-" and a digit.
   */
  private refuseClassAsRangeEnd(rangeStart: number): void {
    if (this.pattern[this.position] !== "\\") {
      return;
    }

    const letter: string = this.pattern[this.position + 1] ?? "";

    if (
      perlClass(letter.toLowerCase()) === undefined &&
      letter !== "p" &&
      letter !== "P"
    ) {
      return;
    }

    throw this.refuse(
      `ends the range ${this.pattern.slice(rangeStart, this.position + 2)} with a class, ${PROMETHEUS_TOO}: a range runs from one character to another. Write the class beside the range, as in [a-z\\d].`,
    );
  }

  /*
   * A POSIX class, a Perl class or a Unicode class at the reading position
   * in a bracket, as its code points, moving past it; null when there is
   * none.
   */
  private readNamedClass(ignoreCase: boolean): Array<number> | null {
    const start: number = this.position;

    if (
      this.pattern[start] === "[" &&
      this.pattern[start + 1] === ":" &&
      start + 2 < this.pattern.length
    ) {
      // RE2 reads to the first ":]", wherever it is (parseNamedClass).
      if (this.posixClassEnd !== -1 && this.posixClassEnd < start + 2) {
        this.posixClassEnd = this.pattern.indexOf(":]", start + 2);
      }

      const end: number = this.posixClassEnd;

      if (end !== -1) {
        const written: string = this.pattern.slice(start, end + 2);
        const name: string = this.pattern.slice(start + 2, end);
        const negated: boolean = name.startsWith("^");
        const set: CodePointRanges | undefined = posixClass(
          negated ? name.slice(1) : name,
        );

        if (set === undefined) {
          throw this.refuse(
            `names the character class ${written}, ${PROMETHEUS_TOO}. The classes are ${POSIX_CLASS_LIST}, written in lowercase, and [:^digit:] matches every character [:digit:] does not.`,
          );
        }

        this.position = end + 2;
        return namedSet({ set, negated, ignoreCase });
      }
    }

    if (this.pattern[start] !== "\\") {
      return null;
    }

    const letter: string = this.pattern[start + 1] ?? "";

    if (letter === "p" || letter === "P") {
      throw this.unicodeClassRefusal();
    }

    const perl: CodePointRanges | undefined = perlClass(letter.toLowerCase());

    if (perl === undefined) {
      return null;
    }

    this.position = start + 2;
    return namedSet({
      set: perl,
      negated: letter !== letter.toLowerCase(),
      ignoreCase,
    });
  }

  // One character of a bracket (parseClassChar): itself, or an escape.
  private readBracketCharacter(): number {
    if (this.position >= this.pattern.length) {
      throw this.syntaxError("Unterminated character class");
    }

    if (this.pattern[this.position] === "\\") {
      return this.readEscapedCodePoint(true);
    }

    const codePoint: number = this.codePointAt(this.position);

    this.position += RE2Translation.lengthOf(codePoint);
    return codePoint;
  }

  /*
   * The {n}, {n,} or {n,m} at the reading position, as RE2 reads one
   * (parseRepeat, parse.go): digits with no leading zero; null when the
   * "{" starts none, so it is a "{".
   */
  private bracedRepeat(): RepeatOperator | null {
    const start: number = this.position;
    const readNumber: (
      index: number,
    ) => { value: number; end: number } | null = (
      index: number,
    ): { value: number; end: number } | null => {
      let end: number = index;

      while (isDecimalDigit(this.pattern.charCodeAt(end))) {
        end++;
      }

      if (end === index || (this.pattern[index] === "0" && end > index + 1)) {
        return null;
      }

      // Past 1e8 RE2 stops counting: a count that large is refused anyway.
      return {
        value: Math.min(Number(this.pattern.slice(index, end)), 1e8),
        end,
      };
    };
    const min: { value: number; end: number } | null = readNumber(start + 1);

    if (min === null) {
      return null;
    }

    let max: number = min.value;
    let end: number = min.end;

    if (this.pattern[end] === ",") {
      if (this.pattern[end + 1] === "}") {
        max = -1;
        end++;
      } else {
        const upper: { value: number; end: number } | null = readNumber(
          end + 1,
        );

        if (upper === null) {
          return null;
        }

        max = upper.value;
        end = upper.end;
      }
    }

    if (this.pattern[end] !== "}") {
      return null;
    }

    return {
      text: this.pattern.slice(start, end + 1),
      min: min.value,
      max,
      counted: true,
    };
  }

  /*
   * A repeat of what the alternative ends with, and the "?" after it that
   * makes it lazy: under (?U), RE2 reads x* as lazy and x*? as greedy
   * (repeat, parse.go). Written right after what it repeats, before any
   * modifier group a flag group opened since, and around a group when
   * JavaScript repeats it only so.
   */
  private readRepeat(repeat: RepeatOperator): void {
    if (repeat.counted && repeat.max >= 0 && repeat.min > repeat.max) {
      throw this.refuse(
        `repeats a part ${repeat.text} times, the least more than the most, ${PROMETHEUS_TOO}. Write the smaller count first, as in {${repeat.max},${repeat.min}}.`,
      );
    }

    if (
      repeat.counted &&
      (repeat.min > MAX_REPEAT || repeat.max > MAX_REPEAT)
    ) {
      throw this.repeatCountRefusal(repeat.text);
    }

    if (this.afterRepeat) {
      throw this.refuse(
        `repeats a repeat with ${repeat.text} right after it, ${PROMETHEUS_TOO}. Put the first repeat in a group to repeat it again, as in (?:a*)${repeat.text}.`,
      );
    }

    const group: OpenGroup = this.group();
    const atom: LastAtom | null = group.lastAtom;

    if (atom === null) {
      throw this.refuse(
        `has the repeat ${repeat.text} with nothing before it to repeat, ${PROMETHEUS_TOO}. Write \\${repeat.text[0]} to match the character itself.`,
      );
    }

    /*
     * The count repeatIsValid reads: the most, or the least when unbounded.
     * A count of 0 repeats nothing, so the counts inside it no longer count.
     */
    const count: number = repeat.max === -1 ? repeat.min : repeat.max;
    let repeats: number = atom.repeats;

    if (repeat.counted) {
      repeats = count === 0 ? 1 : count * atom.repeats;

      if ((repeat.min >= 2 || repeat.max >= 2) && repeats > MAX_REPEAT) {
        throw this.repeatCountRefusal(repeat.text);
      }
    }

    let lazy: boolean = false;

    if (this.pattern[this.position] === "?") {
      lazy = true;
      this.position++;
    }

    const operator: string =
      repeat.text + (lazy !== group.flags.ungreedy ? "?" : "");

    if (atom.needsGroup) {
      this.output.splice(atom.end, 0, `)${operator}`);
      this.output.splice(atom.start, 0, "(?:");
    } else {
      this.output.splice(atom.end, 0, operator);
    }

    group.lastAtom = {
      start: atom.start,
      end: atom.end + (atom.needsGroup ? 2 : 1),
      needsGroup: true,
      repeats: repeats,
    };
    this.afterRepeat = true;
  }

  private repeatCountRefusal(written: string): PromQLPatternError {
    return this.refuse(
      `repeats a part more than ${MAX_REPEAT} times (${written}), counting a repeat inside another as the two counts multiplied, and Prometheus repeats a part at most ${MAX_REPEAT} times. Repeat it fewer times, or use * or + for any number of times.`,
    );
  }

  private readGroupStart(): void {
    const flags: RE2Flags = this.group().flags;

    if (this.pattern[this.position + 1] !== "?") {
      // ( ... ): a capturing group.
      this.openCapture(null);
      this.position++;
      return;
    }

    const kind: string = this.pattern.slice(
      this.position + 2,
      this.position + 4,
    );

    if (
      kind === "<=" ||
      kind === "<!" ||
      kind.startsWith("=") ||
      kind.startsWith("!")
    ) {
      throw this.refuse(
        `uses the look-${kind.startsWith("<") ? "behind" : "ahead"} (?${kind.startsWith("<") ? kind : kind[0]}, ${PROMETHEUS_TOO}. Match the text itself instead, or leave values out with a second matcher that uses !~.`,
      );
    }

    if (
      (kind === "P<" && this.position + 4 < this.pattern.length) ||
      (kind.startsWith("<") && this.position + 3 < this.pattern.length)
    ) {
      this.readNamedGroupStart();
      return;
    }

    this.readFlagGroup(flags);
  }

  // A capturing group's "(", and its name, if any.
  private openCapture(name: string | null): void {
    const start: number = this.output.length;

    this.write("(");
    this.groupNames.push(name);
    this.groups.push(openGroup(this.group().flags, start));
  }

  /*
   * (?P<name> ... ) or (?<name> ... ): a group with no name in JavaScript,
   * its name kept in groupNames. RE2 reads to the first ">" and takes a
   * name of letters, digits and _ (parsePerlFlags, isValidCaptureName).
   */
  private readNamedGroupStart(): void {
    const nameStart: number =
      this.pattern[this.position + 2] === "P"
        ? this.position + 4
        : this.position + 3;
    const nameEnd: number = this.pattern.indexOf(">", nameStart);

    if (
      nameEnd === -1 ||
      !isCaptureName(this.pattern.slice(nameStart, nameEnd))
    ) {
      const written: string =
        nameEnd === -1
          ? this.pattern.slice(this.position)
          : this.pattern.slice(this.position, nameEnd + 1);

      throw this.refuse(
        `names a group ${written}, ${PROMETHEUS_TOO}. A group's name is letters, digits and _, closed by ">": (?P<host>...).`,
      );
    }

    this.openCapture(this.pattern.slice(nameStart, nameEnd));
    this.position = nameEnd + 1;
  }

  /*
   * (?flags) or (?flags: ... ): RE2's i, m, s and U, set, or cleared after
   * one "-", which a flag must follow (parsePerlFlags, parse.go).
   * (?flags: ... ) sets them inside its group; (?flags) from where it stands
   * to the end of the group that holds it.
   */
  private readFlagGroup(outer: RE2Flags): void {
    const flags: RE2Flags = { ...outer };
    let index: number = this.position + 2;
    let clearing: boolean = false;
    let sawFlag: boolean = false;

    for (;;) {
      const character: string = this.pattern[index] ?? "";
      const flag: keyof RE2Flags | undefined = FLAG_LETTERS.get(character);

      if (flag !== undefined) {
        flags[flag] = !clearing;
        sawFlag = true;
      } else if (character === "-" && !clearing) {
        clearing = true;
        sawFlag = false;
      } else if (
        (character === ":" || character === ")") &&
        (!clearing || sawFlag)
      ) {
        break;
      } else {
        throw this.refuse(
          `opens a group with ${this.pattern.slice(this.position, Math.min(index + 1, this.pattern.length))}, ${PROMETHEUS_TOO}. A group is (...), (?:...) or (?P<name>...), and a flag group (?i), (?m), (?s) or (?U), or (?i:...) for a part.`,
        );
      }

      index++;
    }

    this.position = index + 1;
    this.afterRepeat = false;

    if (this.pattern[index] === ")") {
      this.setFlags(flags);
      return;
    }

    const opening: string = modifierGroup(outer, flags);
    const start: number = this.output.length;

    this.write(opening.length > 0 ? opening : "(?:");
    this.groups.push(openGroup(flags, start));
  }

  /*
   * (?flags): the flags change from here to the end of the group. What
   * follows in this alternative goes inside a modifier group that sets
   * them, closed at the alternative's end, and each later alternative
   * starts with one of its own (readBar). At an alternative's start, one
   * modifier group opened to the group's end does for this alternative and
   * every later one. Written after what the alternative ends with, so a
   * repeat right after the flag group still repeats it (readRepeat).
   */
  private setFlags(flags: RE2Flags): void {
    const group: OpenGroup = this.group();

    if (sameFlags(group.flags, flags)) {
      return;
    }

    group.flags = flags;

    if (!group.alternativeStarted) {
      this.openRestModifierGroup(group);
      return;
    }

    if (group.alternativeModifierGroupOpen) {
      this.output.push(")");
      group.alternativeModifierGroupOpen = false;
    }

    const opening: string = modifierGroup(group.restFlags, group.flags);

    if (opening.length > 0) {
      this.output.push(opening);
      group.alternativeModifierGroupOpen = true;
    }
  }

  // A modifier group from here to the group's end, for its flags now.
  private openRestModifierGroup(group: OpenGroup): void {
    const opening: string = modifierGroup(group.restFlags, group.flags);

    if (opening.length === 0) {
      return;
    }

    this.output.push(opening);
    group.restModifierGroups++;
    group.restFlags = group.flags;
  }

  /*
   * "|": RE2 keeps the flags a flag group set to the end of the group, so
   * the next alternative starts under them too.
   */
  private readBar(): void {
    const group: OpenGroup = this.group();

    if (group.alternativeModifierGroupOpen) {
      this.output.push(")");
      group.alternativeModifierGroupOpen = false;
    }

    this.output.push("|");
    this.position++;
    group.alternativeStarted = false;
    this.endAtom(group);
    group.lastAtom = null;
    this.afterRepeat = false;
    this.openRestModifierGroup(group);
  }

  /*
   * ")": the flags go back to those the group opened under, and the group
   * is what a repeat after it repeats.
   */
  private readGroupEnd(): void {
    if (this.groups.length === 1) {
      throw this.syntaxError("Unmatched ')'");
    }

    const closed: OpenGroup = this.groups.pop()!;
    const parent: OpenGroup = this.group();

    this.endAtom(closed);
    this.closeModifierGroups(closed);
    this.output.push(")");
    this.position++;
    this.afterRepeat = false;
    this.endAtom(parent);
    parent.lastAtom = {
      start: closed.start,
      end: this.output.length,
      needsGroup: false,
      repeats: closed.repeats,
    };
  }

  // Closes the modifier groups opened inside a group, at its end.
  private closeModifierGroups(group: OpenGroup): void {
    const count: number =
      group.restModifierGroups + (group.alternativeModifierGroupOpen ? 1 : 0);

    this.output.push(")".repeat(count));
  }
}

export interface PromQLRegexOptions {
  /*
   * Whether exec reports what the groups captured, as label_replace() reads
   * them. Off, a match says only that the value matched.
   */
  captures?: boolean | undefined;
}

export interface CompiledPromQLRegex {
  regex: LinearRegExp;
  // The pattern as Prometheus anchors it, for engines that speak RE2.
  anchoredPattern: string;
  /*
   * Each group's name, group 1 first, null for a group with none: the
   * regex's groups have none, since RE2 takes names JavaScript does not.
   */
  groupNames: ReadonlyArray<string | null>;
}

/*
 * The regular expression a matcher's pattern means, anchored as Prometheus
 * anchors it. Throws a SyntaxError for a pattern that is not a regular
 * expression - a PromQLPatternError, which says why, for one Prometheus
 * refuses or OneUptime cannot read - and PatternProblemError for one the
 * linear-time matcher cannot run (a back-reference, or one too large), as
 * getLinearRegExp does.
 */
export const compilePromQLRegex: (
  pattern: string,
  options?: PromQLRegexOptions,
) => CompiledPromQLRegex = (
  pattern: string,
  options?: PromQLRegexOptions,
): CompiledPromQLRegex => {
  // Refused before it is read: a query can carry megabytes.
  refusePatternTooLong(pattern);

  const translation: { source: string; groupNames: Array<string | null> } =
    new RE2Translation(pattern).translate();

  return {
    regex: getLinearRegExp(`^(?s:${translation.source})$`, "", {
      captures: options?.captures === true,
    }),
    anchoredPattern: `^(?s:${pattern})$`,
    groupNames: translation.groupNames,
  };
};

/*
 * What the first group of this name that took part in the match captured,
 * as Go's Expand reads $name and ${name}; undefined when none did.
 */
export const readNamedCapture: (data: {
  captures: ReadonlyArray<string | undefined>;
  groupNames: ReadonlyArray<string | null>;
  name: string;
}) => string | undefined = (data: {
  captures: ReadonlyArray<string | undefined>;
  groupNames: ReadonlyArray<string | null>;
  name: string;
}): string | undefined => {
  for (let index: number = 0; index < data.groupNames.length; index++) {
    if (
      data.groupNames[index] === data.name &&
      data.captures[index] !== undefined
    ) {
      return data.captures[index];
    }
  }

  return undefined;
};
