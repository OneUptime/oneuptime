import LinearRegExp, {
  refusePatternTooLong,
} from "../LinearRegExp/LinearRegExp";
import { getLinearRegExp } from "../LinearRegExp/PatternCache";

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
 * JavaScript reads most of RE2 the same way. What it reads differently, and
 * people write in label matchers, is translated here, in one pass that knows
 * escapes, brackets and groups:
 *  - A flag group. JavaScript has no (?i) that runs to the end of a group,
 *    only a modifier group around a part, (?i: ... ), and no U at all. (?i),
 *    (?m) and (?s) become modifier groups around the rest of their group,
 *    its alternatives kept apart; (?U) swaps each repeat's greed (x* reads
 *    as x*?, and x*? as x*).
 *  - `.` without s matches anything but "\n" in RE2, and in JavaScript
 *    anything but "\n", "\r", U+2028 and U+2029: it is written [^\n].
 *  - ^ and $ with m match next to a "\n" in RE2, and in JavaScript next to
 *    "\r", U+2028 and U+2029 too: a look-around leaves those three out.
 *  - Named groups, (?P<name> ... ): (?<name> ... ).
 *  - POSIX classes in a bracket, such as [[:digit:]]: their characters.
 *  - A "]" first in a bracket is a character in RE2 ([]a] is "]" or "a"),
 *    and closes an empty bracket in JavaScript: it is written \].
 *
 * A matcher's pattern is written by a project's people, so it runs on the
 * linear-time matcher (Utils/LinearRegExp), as every such pattern does: in
 * time in line with the value it reads, as RE2 runs it. It is compiled once
 * and kept (PatternCache), by the pattern, so a query that asks it about
 * every series compiles it once.
 */

/*
 * RE2's POSIX classes, by name. A Map, so a name such as constructor, which
 * names no class, finds none.
 */
const POSIX_CLASSES: ReadonlyMap<string, string> = new Map<string, string>([
  ["alnum", "0-9A-Za-z"],
  ["alpha", "A-Za-z"],
  ["ascii", "\\x00-\\x7F"],
  ["blank", "\\t "],
  ["cntrl", "\\x00-\\x1F\\x7F"],
  ["digit", "0-9"],
  ["graph", "!-~"],
  ["lower", "a-z"],
  ["print", " -~"],
  ["punct", "!-\\/:-@\\[-`{-~"],
  ["space", "\\t\\n\\v\\f\\r "],
  ["upper", "A-Z"],
  ["word", "0-9A-Za-z_"],
  ["xdigit", "0-9A-Fa-f"],
]);

// A POSIX class inside a bracket, read where it starts: [:digit:], [:^digit:].
const POSIX_CLASS_AT: RegExp = /\[:(\^?)([a-z]+):\]/y;

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
}

const openGroup: (flags: RE2Flags) => OpenGroup = (
  flags: RE2Flags,
): OpenGroup => {
  return {
    flags: flags,
    restFlags: flags,
    restModifierGroups: 0,
    alternativeModifierGroupOpen: false,
    alternativeStarted: false,
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

// A pattern read as RE2 reads it, written as JavaScript's RegExp reads it.
class RE2Translation {
  private readonly pattern: string;
  private position: number = 0;
  private readonly output: Array<string> = [];
  // The groups open where the reading is, the whole pattern first.
  private readonly groups: Array<OpenGroup> = [openGroup(PROMETHEUS_FLAGS)];

  public constructor(pattern: string) {
    this.pattern = pattern;
  }

  /*
   * The pattern in JavaScript, to be read inside `(?s:` ... `)`. Throws a
   * SyntaxError for what RE2 does not read as a pattern: a group or bracket
   * left open, a ")" that closes nothing, a flag group RE2 does not know, a
   * "\" at the end.
   */
  public translate(): string {
    while (this.position < this.pattern.length) {
      this.readNext();
    }

    if (this.groups.length > 1) {
      throw this.syntaxError("Unterminated group");
    }

    this.closeModifierGroups(this.group());

    return this.output.join("");
  }

  private group(): OpenGroup {
    return this.groups[this.groups.length - 1]!;
  }

  private syntaxError(message: string): SyntaxError {
    return new SyntaxError(
      `Invalid regular expression: /${this.pattern}/: ${message}`,
    );
  }

  // Writes something the current alternative matches or asserts.
  private write(text: string): void {
    this.output.push(text);
    this.group().alternativeStarted = true;
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
        this.readRepeat(1);
        return;
      case "{": {
        const length: number = this.bracedRepeatLength();

        if (length > 0) {
          this.readRepeat(length);
          return;
        }

        // Not a repeat: a "{" in RE2 and in JavaScript alike.
        this.write(character);
        this.position++;
        return;
      }
      case ".":
        this.write(flags.dotAll ? "." : ANY_BUT_NEWLINE);
        this.position++;
        return;
      case "^":
        this.write(flags.multiline ? LINE_START : "^");
        this.position++;
        return;
      case "$":
        this.write(flags.multiline ? LINE_END : "$");
        this.position++;
        return;
      default:
        this.write(character);
        this.position++;
        return;
    }
  }

  // An escape, written as it is: "\(" or "\|" stays a character.
  private readEscape(): void {
    if (this.position + 1 >= this.pattern.length) {
      throw this.syntaxError("\\ at end of pattern");
    }

    this.write(this.pattern.slice(this.position, this.position + 2));
    this.position += 2;
  }

  /*
   * A bracket, read to its "]" as RE2 reads it: a "]" first is a character,
   * a POSIX class is its characters, and nothing inside is a group, a
   * repeat, an anchor or a ".".
   */
  private readBracket(): void {
    const parts: Array<string> = ["["];
    this.position++;

    if (this.pattern[this.position] === "^") {
      parts.push("^");
      this.position++;
    }

    let first: boolean = true;

    for (;;) {
      if (this.position >= this.pattern.length) {
        throw this.syntaxError("Unterminated character class");
      }

      const character: string = this.pattern[this.position]!;

      if (character === "]" && !first) {
        parts.push("]");
        this.position++;
        break;
      }

      if (character === "]") {
        parts.push("\\]");
        this.position++;
      } else if (character === "\\") {
        if (this.position + 1 >= this.pattern.length) {
          throw this.syntaxError("\\ at end of pattern");
        }

        parts.push(this.pattern.slice(this.position, this.position + 2));
        this.position += 2;
      } else {
        const posixClass: string | null =
          character === "[" ? this.readPosixClass() : null;

        if (posixClass === null) {
          parts.push(character);
          this.position++;
        } else {
          parts.push(posixClass);
        }
      }

      first = false;
    }

    this.write(parts.join(""));
  }

  /*
   * The characters of the POSIX class at the reading position, such as
   * "0-9" for [:digit:], moving past it; null when there is none. A negated
   * one, [:^digit:], and a name that is no class are read as the characters
   * they are written with (RE2 reads the one as every other character, and
   * refuses the other).
   */
  private readPosixClass(): string | null {
    POSIX_CLASS_AT.lastIndex = this.position;
    const found: RegExpExecArray | null = POSIX_CLASS_AT.exec(this.pattern);

    if (found === null || found[1] === "^") {
      return null;
    }

    const members: string | undefined = POSIX_CLASSES.get(found[2]!);

    if (members === undefined) {
      return null;
    }

    this.position += found[0].length;
    return members;
  }

  /*
   * How long the {n}, {n,} or {n,m} at the reading position is, or 0 when
   * the "{" there starts none: JavaScript's reading, so a repeat it reads is
   * one whose greed (?U) swaps.
   */
  private bracedRepeatLength(): number {
    let end: number = this.position + 1;
    const digitsStart: number = end;

    while (isDecimalDigit(this.pattern.charCodeAt(end))) {
      end++;
    }

    if (end === digitsStart) {
      return 0;
    }

    if (this.pattern[end] === ",") {
      end++;

      while (isDecimalDigit(this.pattern.charCodeAt(end))) {
        end++;
      }
    }

    return this.pattern[end] === "}" ? end + 1 - this.position : 0;
  }

  /*
   * A repeat `length` long, and the "?" after it that makes it lazy. Under
   * (?U), RE2 reads x* as lazy and x*? as greedy (repeat, parse.go).
   */
  private readRepeat(length: number): void {
    this.output.push(this.pattern.slice(this.position, this.position + length));
    this.position += length;

    let lazy: boolean = false;

    if (this.pattern[this.position] === "?") {
      lazy = true;
      this.position++;
    }

    if (lazy !== this.group().flags.ungreedy) {
      this.output.push("?");
    }
  }

  private readGroupStart(): void {
    const flags: RE2Flags = this.group().flags;

    if (this.pattern[this.position + 1] !== "?") {
      // ( ... ): a capturing group.
      this.write("(");
      this.position++;
      this.groups.push(openGroup(flags));
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
      // A look-around: RE2 has none; it is passed on as JavaScript reads it.
      const opening: string = kind.startsWith("<")
        ? `(?${kind}`
        : `(?${kind[0]}`;

      this.write(opening);
      this.position += opening.length;
      this.groups.push(openGroup(flags));
      return;
    }

    if (kind.startsWith("P<") || kind.startsWith("<")) {
      this.readNamedGroupStart();
      return;
    }

    this.readFlagGroup();
  }

  // (?P<name> ... ) or (?<name> ... ): (?<name> ... ) in JavaScript.
  private readNamedGroupStart(): void {
    const flags: RE2Flags = this.group().flags;
    const nameStart: number =
      this.pattern[this.position + 2] === "P"
        ? this.position + 4
        : this.position + 3;
    const nameEnd: number = this.pattern.indexOf(">", nameStart);

    if (nameEnd === -1) {
      throw this.syntaxError("Invalid capture group name");
    }

    this.write(`(?<${this.pattern.slice(nameStart, nameEnd)}>`);
    this.position = nameEnd + 1;
    this.groups.push(openGroup(flags));
  }

  /*
   * (?flags) or (?flags: ... ): RE2's i, m, s and U, set, or cleared after
   * one "-", which a flag must follow (parsePerlFlags, parse.go).
   * (?flags: ... ) sets them inside its group; (?flags) from where it stands
   * to the end of the group that holds it.
   */
  private readFlagGroup(): void {
    const outer: RE2Flags = this.group().flags;
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
        throw this.syntaxError("Invalid group");
      }

      index++;
    }

    this.position = index + 1;

    if (this.pattern[index] === ")") {
      this.setFlags(flags);
      return;
    }

    const opening: string = modifierGroup(outer, flags);

    this.write(opening.length > 0 ? opening : "(?:");
    this.groups.push(openGroup(flags));
  }

  /*
   * (?flags): the flags change from here to the end of the group. What
   * follows in this alternative goes inside a modifier group that sets
   * them, closed at the alternative's end, and each later alternative
   * starts with one of its own (readBar). At an alternative's start, one
   * modifier group opened to the group's end does for this alternative and
   * every later one.
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
    this.openRestModifierGroup(group);
  }

  // ")": the flags go back to those the group opened under.
  private readGroupEnd(): void {
    if (this.groups.length === 1) {
      throw this.syntaxError("Unmatched ')'");
    }

    this.closeModifierGroups(this.groups.pop()!);
    this.output.push(")");
    this.position++;
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
}

/*
 * The regular expression a matcher's pattern means, anchored as Prometheus
 * anchors it. Throws a SyntaxError for a pattern that is not a regular
 * expression, and PatternProblemError for one the linear-time matcher
 * cannot run (a back-reference, or one too large), as getLinearRegExp does.
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

  const body: string = new RE2Translation(pattern).translate();

  return {
    regex: getLinearRegExp(`^(?s:${body})$`, "", {
      captures: options?.captures === true,
    }),
    anchoredPattern: `^(?s:${pattern})$`,
  };
};
