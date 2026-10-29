/*
 * Whether code in Go, Rust, PHP, Ruby or Elixir - or a Cargo.toml - is at
 * least well formed: what the tests can say about code they cannot run.
 *
 * A light reader, not a compiler. It knows each language's comments and
 * strings (escapes, raw strings, heredocs, Ruby's and Elixir's #{...}
 * holes, Elixir's sigils, Rust's lifetimes and PHP's attributes), so a
 * bracket inside a string is not a bracket, and it holds every bracket to
 * the one that closes it. Ruby and Elixir close their blocks with `end`, so
 * the reader holds those too: Ruby's def, class, module, do, begin, case
 * and a statement's if, unless, while, until and for; Elixir's do and fn
 * (never a keyword's do:). The end-to-end check runs the code that ships;
 * this holds every snippet to at least this much.
 */

export type SyntaxLanguage = "go" | "rust" | "php" | "ruby" | "elixir";

const OPENING_BRACKETS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
};
const CLOSING_BRACKETS: ReadonlyArray<string> = [")", "]", "}"];
const BLOCK_END: string = "end";

const IDENTIFIER_START: RegExp = /[A-Za-z_]/;
const IDENTIFIER_PART: RegExp = /[A-Za-z0-9_]/;
const UPPER_CASE_LETTER: RegExp = /[A-Z]/;
const LOWER_CASE_LETTER: RegExp = /[a-z]/;

// Ruby's keywords that open a block an `end` closes.
const RUBY_BLOCK_KEYWORDS: ReadonlyArray<string> = [
  "def",
  "class",
  "module",
  "do",
  "begin",
  "case",
];

/*
 * Ruby's keywords that open a block only when they start a statement:
 * `if ready` does, `return unless ready` does not.
 */
const RUBY_STATEMENT_KEYWORDS: ReadonlyArray<string> = [
  "if",
  "unless",
  "while",
  "until",
  "for",
];

/*
 * What may come right before a Ruby statement keyword on its line: nothing
 * (it starts the line), an assignment (x = if ...), or an opening bracket.
 */
const RUBY_STATEMENT_LEADS: ReadonlyArray<string> = ["", "=", "(", "[", "{"];

// What, before a /, makes it a Ruby regular expression rather than division.
const RUBY_REGEXP_LEADS: ReadonlyArray<string> = [
  "",
  "(",
  ",",
  "=",
  "[",
  "{",
  "|",
  "&",
  "!",
  ";",
  "~",
  ">",
  "<",
];
const RUBY_REGEXP_KEYWORDS: ReadonlyArray<string> = [
  "when",
  "if",
  "unless",
  "and",
  "or",
  "not",
  "return",
];

// The delimiters an Elixir sigil or a Ruby %-literal may use, and their closers.
const PAIRED_DELIMITERS: Record<string, string> = {
  "(": ")",
  "[": "]",
  "{": "}",
  "<": ">",
};
const ELIXIR_SIGIL_DELIMITERS: ReadonlyArray<string> = [
  "/",
  "|",
  '"',
  "'",
  "(",
  "[",
  "{",
  "<",
];

interface Opened {
  // What closes it: ")", "]", "}" or "end".
  closer: string;
  line: number;
}

interface ScanResult {
  // Where the scan stopped: the code's end, or the "}" that closed a hole.
  end: number;
  problem?: string | undefined;
}

function isIdentifierStart(character: string): boolean {
  return character.length === 1 && IDENTIFIER_START.test(character);
}

function isIdentifierPart(character: string): boolean {
  return character.length === 1 && IDENTIFIER_PART.test(character);
}

class SyntaxReader {
  private readonly code: string;
  private readonly language: SyntaxLanguage;
  /*
   * Ruby heredocs whose bodies start on the next line: their terminators,
   * and whether the terminator may be indented (<<~ and <<-).
   */
  private pendingHeredocs: Array<{ terminator: string; indented: boolean }> =
    [];

  public constructor(code: string, language: SyntaxLanguage) {
    this.code = code;
    this.language = language;
  }

  public problems(): Array<string> {
    const result: ScanResult = this.scan(this.startOfCode(), false);

    return result.problem ? [result.problem] : [];
  }

  private lineAt(index: number): number {
    return this.code.slice(0, index).split("\n").length;
  }

  // PHP's opening tag is not code to read.
  private startOfCode(): number {
    if (this.language === "php" && this.code.startsWith("<?php")) {
      return "<?php".length;
    }

    return 0;
  }

  /*
   * Reads code from `from`: to its end, or - for the code inside a string's
   * #{...} hole - to the "}" that closes the hole.
   */
  private scan(from: number, isHole: boolean): ScanResult {
    const stack: Array<Opened> = [];
    let index: number = from;

    while (index < this.code.length) {
      const character: string = this.code.charAt(index);

      if (character === "\n" && this.pendingHeredocs.length > 0) {
        const afterHeredocs: number = this.skipHeredocBodies(index + 1);

        if (afterHeredocs < 0) {
          return {
            end: index,
            problem: `a heredoc that never ends, from line ${this.lineAt(index)}`,
          };
        }

        index = afterHeredocs;
        continue;
      }

      const afterComment: number = this.skipComment(index);

      if (afterComment < 0) {
        return {
          end: index,
          problem: `a comment that never closes on line ${this.lineAt(index)}`,
        };
      }

      if (afterComment > index) {
        index = afterComment;
        continue;
      }

      const afterLiteral: number = this.skipLiteral(index);

      if (afterLiteral < 0) {
        return {
          end: index,
          problem: `a string that never closes on line ${this.lineAt(index)}`,
        };
      }

      if (afterLiteral > index) {
        index = afterLiteral;
        continue;
      }

      if (OPENING_BRACKETS[character]) {
        stack.push({
          closer: OPENING_BRACKETS[character]!,
          line: this.lineAt(index),
        });
        index++;
        continue;
      }

      if (CLOSING_BRACKETS.includes(character)) {
        if (isHole && character === "}" && stack.length === 0) {
          return { end: index + 1 };
        }

        const problem: string | undefined = this.close(stack, character, index);

        if (problem) {
          return { end: index, problem: problem };
        }

        index++;
        continue;
      }

      if (
        isIdentifierStart(character) &&
        !isIdentifierPart(this.code.charAt(index - 1))
      ) {
        const word: string = this.wordAt(index);
        const problem: string | undefined = this.readKeyword(
          stack,
          word,
          index,
        );

        if (problem) {
          return { end: index, problem: problem };
        }

        index += word.length;
        continue;
      }

      index++;
    }

    if (isHole) {
      return {
        end: index,
        problem: `a #{ that never closes on line ${this.lineAt(from)}`,
      };
    }

    if (stack.length > 0) {
      return {
        end: index,
        problem: `${stack.length} block(s) never close: ${stack
          .map((opened: Opened): string => {
            return `"${opened.closer}" for line ${opened.line}`;
          })
          .reverse()
          .join(", ")}`,
      };
    }

    return { end: index };
  }

  private close(
    stack: Array<Opened>,
    closer: string,
    index: number,
  ): string | undefined {
    const expected: Opened | undefined = stack.pop();

    if (!expected) {
      return `"${closer}" on line ${this.lineAt(index)} closes nothing`;
    }

    if (expected.closer !== closer) {
      return `"${closer}" on line ${this.lineAt(index)} closes what "${expected.closer}" from line ${expected.line} should`;
    }

    return undefined;
  }

  private wordAt(index: number): string {
    let end: number = index;

    while (end < this.code.length && isIdentifierPart(this.code.charAt(end))) {
      end++;
    }

    return this.code.slice(index, end);
  }

  // The text before `index` on its line, without the spaces next to it.
  private beforeOnLine(index: number): string {
    const lineStart: number = this.code.lastIndexOf("\n", index - 1) + 1;

    return this.code.slice(lineStart, index).trim();
  }

  /*
   * A word that opens or closes a Ruby or Elixir block. A method call
   * (.end), a symbol (:end), a keyword's key (do:, end:) and a method whose
   * name ends in ? or ! are none of them.
   */
  private readKeyword(
    stack: Array<Opened>,
    word: string,
    index: number,
  ): string | undefined {
    if (this.language !== "ruby" && this.language !== "elixir") {
      return undefined;
    }

    const before: string = this.code.charAt(index - 1);
    const after: string = this.code.charAt(index + word.length);

    if (
      before === "." ||
      before === ":" ||
      before === "@" ||
      before === "$" ||
      after === ":" ||
      after === "?" ||
      after === "!"
    ) {
      return undefined;
    }

    if (word === BLOCK_END) {
      return this.close(stack, BLOCK_END, index);
    }

    if (this.opensBlock(word, index)) {
      stack.push({ closer: BLOCK_END, line: this.lineAt(index) });
    }

    return undefined;
  }

  private opensBlock(word: string, index: number): boolean {
    if (this.language === "elixir") {
      return word === "do" || word === "fn";
    }

    if (RUBY_STATEMENT_KEYWORDS.includes(word)) {
      const lead: string = this.beforeOnLine(index);

      return RUBY_STATEMENT_LEADS.includes(lead.slice(-1));
    }

    if (!RUBY_BLOCK_KEYWORDS.includes(word)) {
      return false;
    }

    if (word === "do") {
      // `while ready do` and `for x in list do` belong to their loop.
      const lead: string = this.beforeOnLine(index);
      const firstWord: string = lead.split(" ")[0] || "";

      return !["while", "until", "for"].includes(firstWord);
    }

    if (word === "def") {
      // An endless method, def total = price * count, has no end.
      const lineEnd: number = this.code.indexOf("\n", index);
      const line: string = this.code.slice(
        index,
        lineEnd < 0 ? this.code.length : lineEnd,
      );
      const signatureEnd: number = line.includes(")")
        ? line.indexOf(")") + 1
        : line.indexOf(" ", "def ".length);

      return !(
        signatureEnd > 0 &&
        line.slice(signatureEnd).trimStart().startsWith("=") &&
        !line.slice(signatureEnd).trimStart().startsWith("==")
      );
    }

    return true;
  }

  // Where a comment starting at `index` ends, `index` if none starts there, -1 if it never ends.
  private skipComment(index: number): number {
    const code: string = this.code;
    const toLineEnd: () => number = (): number => {
      const end: number = code.indexOf("\n", index);

      return end < 0 ? code.length : end;
    };

    switch (this.language) {
      case "go":
      case "rust":
      case "php":
        if (code.startsWith("//", index)) {
          return toLineEnd();
        }
        if (code.startsWith("/*", index)) {
          return this.skipBlockComment(index);
        }
        // PHP's # comments; #[...] is an attribute, whose brackets are code.
        if (
          this.language === "php" &&
          code.charAt(index) === "#" &&
          code.charAt(index + 1) !== "["
        ) {
          return toLineEnd();
        }
        return index;
      case "ruby":
        if (
          code.startsWith("=begin", index) &&
          (index === 0 || code.charAt(index - 1) === "\n")
        ) {
          const end: number = code.indexOf("\n=end", index);

          return end < 0 ? -1 : end + "\n=end".length;
        }
        return code.charAt(index) === "#" ? toLineEnd() : index;
      case "elixir":
        return code.charAt(index) === "#" ? toLineEnd() : index;
      default:
        return index;
    }
  }

  // A /* */ comment; Rust's nest, as Rust reads them.
  private skipBlockComment(index: number): number {
    let depth: number = 0;
    let at: number = index;

    while (at < this.code.length) {
      if (this.code.startsWith("/*", at)) {
        depth++;
        at += 2;
        if (this.language !== "rust" && depth > 1) {
          depth = 1;
        }
        continue;
      }

      if (this.code.startsWith("*/", at)) {
        depth--;
        at += 2;
        if (depth === 0) {
          return at;
        }
        continue;
      }

      at++;
    }

    return -1;
  }

  /*
   * Where a string, a character or another literal starting at `index`
   * ends; `index` when none starts there, -1 when it never ends.
   */
  private skipLiteral(index: number): number {
    switch (this.language) {
      case "go":
        return this.skipGoLiteral(index);
      case "rust":
        return this.skipRustLiteral(index);
      case "php":
        return this.skipPhpLiteral(index);
      case "ruby":
        return this.skipRubyLiteral(index);
      case "elixir":
        return this.skipElixirLiteral(index);
      default:
        return index;
    }
  }

  /*
   * A string between `quote`s from `index` (the opening quote): its
   * escapes, whether it may span lines, and - for Ruby and Elixir - its
   * #{...} holes, read as code.
   */
  private skipQuoted(
    index: number,
    quote: string,
    options: {
      escapes: boolean;
      multiline: boolean;
      holes: boolean;
      closer?: string | undefined;
    },
  ): number {
    const closer: string = options.closer || quote;
    const nests: boolean = closer !== quote;
    let depth: number = 0;
    let at: number = index + quote.length;

    while (at < this.code.length) {
      const character: string = this.code.charAt(at);

      if (character === "\n" && !options.multiline) {
        return -1;
      }

      if (character === "\\" && options.escapes) {
        at += 2;
        continue;
      }

      if (options.holes && this.code.startsWith("#{", at)) {
        const hole: ScanResult = this.scan(at + 2, true);

        if (hole.problem) {
          return -1;
        }

        at = hole.end;
        continue;
      }

      if (nests && this.code.startsWith(quote, at)) {
        depth++;
        at += quote.length;
        continue;
      }

      if (this.code.startsWith(closer, at)) {
        if (depth === 0) {
          return at + closer.length;
        }
        depth--;
        at += closer.length;
        continue;
      }

      at++;
    }

    return -1;
  }

  private skipGoLiteral(index: number): number {
    const character: string = this.code.charAt(index);

    if (character === '"') {
      return this.skipQuoted(index, '"', {
        escapes: true,
        multiline: false,
        holes: false,
      });
    }

    if (character === "`") {
      return this.skipQuoted(index, "`", {
        escapes: false,
        multiline: true,
        holes: false,
      });
    }

    if (character === "'") {
      return this.skipCharacter(index);
    }

    return index;
  }

  // A character literal: 'a', '\n', 'é', '\''.
  private skipCharacter(index: number): number {
    const end: number = this.code.indexOf(
      "'",
      index + (this.code.charAt(index + 1) === "\\" ? 3 : 2),
    );

    if (
      end < 0 ||
      end - index > 12 ||
      this.code.slice(index, end).includes("\n")
    ) {
      return -1;
    }

    return end + 1;
  }

  private skipRustLiteral(index: number): number {
    const code: string = this.code;
    const character: string = code.charAt(index);
    const isWordBefore: boolean = isIdentifierPart(code.charAt(index - 1));

    // Raw strings: r"...", r#"..."#, br"...", with as many #s at each end.
    if (
      (character === "r" ||
        (character === "b" && code.charAt(index + 1) === "r")) &&
      !isWordBefore
    ) {
      const start: number = character === "b" ? index + 2 : index + 1;
      let hashes: number = 0;

      while (code.charAt(start + hashes) === "#") {
        hashes++;
      }

      if (code.charAt(start + hashes) === '"') {
        const terminator: string = `"${"#".repeat(hashes)}`;
        const end: number = code.indexOf(terminator, start + hashes + 1);

        return end < 0 ? -1 : end + terminator.length;
      }

      return index;
    }

    // Byte strings and byte characters: b"...", b'a'.
    if (character === "b" && !isWordBefore) {
      const next: string = code.charAt(index + 1);

      if (next === '"') {
        return this.skipQuoted(index + 1, '"', {
          escapes: true,
          multiline: true,
          holes: false,
        });
      }

      if (next === "'") {
        return this.skipCharacter(index + 1);
      }

      return index;
    }

    if (character === '"') {
      return this.skipQuoted(index, '"', {
        escapes: true,
        multiline: true,
        holes: false,
      });
    }

    if (character === "'") {
      // A character ('a', '\n') closes; a lifetime or a label ('static) does not.
      if (code.charAt(index + 1) === "\\" || code.charAt(index + 2) === "'") {
        return this.skipCharacter(index);
      }

      return index + 1;
    }

    return index;
  }

  private skipPhpLiteral(index: number): number {
    const code: string = this.code;
    const character: string = code.charAt(index);

    if (character === "'" || character === '"') {
      return this.skipQuoted(index, character, {
        escapes: true,
        multiline: true,
        holes: false,
      });
    }

    // A heredoc or a nowdoc: <<<LABEL, <<<"LABEL", <<<'LABEL'.
    if (code.startsWith("<<<", index)) {
      const lineEnd: number = code.indexOf("\n", index);

      if (lineEnd < 0) {
        return -1;
      }

      const label: string = code
        .slice(index + 3, lineEnd)
        .trim()
        .split('"')
        .join("")
        .split("'")
        .join("");

      if (!label) {
        return -1;
      }

      return this.lineStartingWith(label, lineEnd + 1, true);
    }

    return index;
  }

  /*
   * The end of the first line from `from` that holds only `terminator`
   * (with a semicolon or a comma after it, as PHP's heredocs may), its
   * indentation allowed or not; -1 when no line does.
   */
  private lineStartingWith(
    terminator: string,
    from: number,
    indented: boolean,
  ): number {
    let at: number = from;

    while (at <= this.code.length) {
      const lineEnd: number = this.code.indexOf("\n", at);
      const end: number = lineEnd < 0 ? this.code.length : lineEnd;
      const line: string = this.code.slice(at, end);
      const text: string = indented ? line.trimStart() : line;

      if (
        text === terminator ||
        (this.language === "php" &&
          text.startsWith(terminator) &&
          [";", ",", ")"].includes(text.charAt(terminator.length)))
      ) {
        return this.language === "php"
          ? at + line.indexOf(terminator) + terminator.length
          : end;
      }

      if (lineEnd < 0) {
        return -1;
      }

      at = lineEnd + 1;
    }

    return -1;
  }

  /*
   * Skips the bodies of the Ruby heredocs opened on the line that just
   * ended, from the start of the next line; -1 when one never ends.
   */
  private skipHeredocBodies(from: number): number {
    let at: number = from;

    for (const heredoc of this.pendingHeredocs) {
      const end: number = this.lineStartingWith(
        heredoc.terminator,
        at,
        heredoc.indented,
      );

      if (end < 0) {
        this.pendingHeredocs = [];
        return -1;
      }

      at = end;
    }

    this.pendingHeredocs = [];

    return at;
  }

  // The last character before `index` that is not a space, and the word it ends.
  private previousToken(index: number): { character: string; word: string } {
    let at: number = index - 1;

    while (at >= 0 && this.code.charAt(at) === " ") {
      at--;
    }

    if (at < 0 || this.code.charAt(at) === "\n") {
      return { character: "", word: "" };
    }

    let start: number = at;

    while (start > 0 && isIdentifierPart(this.code.charAt(start - 1))) {
      start--;
    }

    return {
      character: this.code.charAt(at),
      word: this.code.slice(start, at + 1),
    };
  }

  private skipRubyLiteral(index: number): number {
    const code: string = this.code;
    const character: string = code.charAt(index);

    if (character === "'") {
      return this.skipQuoted(index, "'", {
        escapes: true,
        multiline: true,
        holes: false,
      });
    }

    if (character === '"' || character === "`") {
      return this.skipQuoted(index, character, {
        escapes: true,
        multiline: true,
        holes: true,
      });
    }

    // Heredocs: <<~SQL, <<-EOS, <<EOS, <<~'EOS'; not an append (list << item).
    if (code.startsWith("<<", index) && !code.startsWith("<<=", index)) {
      let at: number = index + 2;
      const indented: boolean =
        code.charAt(at) === "~" || code.charAt(at) === "-";

      if (indented) {
        at++;
      }

      const quoted: boolean =
        code.charAt(at) === "'" || code.charAt(at) === '"';

      if (quoted) {
        at++;
      }

      const terminator: string = this.wordAt(at);

      if (
        terminator.length > 0 &&
        (indented || quoted || UPPER_CASE_LETTER.test(terminator.charAt(0)))
      ) {
        this.pendingHeredocs.push({
          terminator: terminator,
          indented: indented,
        });

        return at + terminator.length + (quoted ? 1 : 0);
      }

      return index;
    }

    // %w[...], %i(...), %q{...}, %Q<...>, %(...): their delimiters nest.
    if (character === "%" && !isIdentifierPart(code.charAt(index - 1))) {
      let at: number = index + 1;

      if (
        LOWER_CASE_LETTER.test(code.charAt(at)) ||
        UPPER_CASE_LETTER.test(code.charAt(at))
      ) {
        at++;
      }

      const open: string = code.charAt(at);

      if (PAIRED_DELIMITERS[open]) {
        return this.skipQuoted(at, open, {
          escapes: true,
          multiline: true,
          holes: true,
          closer: PAIRED_DELIMITERS[open],
        });
      }

      return index;
    }

    // A regular expression: /pattern/, where a value is expected.
    if (character === "/") {
      const previous: { character: string; word: string } =
        this.previousToken(index);
      const isRegExp: boolean =
        RUBY_REGEXP_LEADS.includes(previous.character) ||
        RUBY_REGEXP_KEYWORDS.includes(previous.word);

      if (isRegExp && code.charAt(index + 1) !== " ") {
        return this.skipQuoted(index, "/", {
          escapes: true,
          multiline: false,
          holes: true,
        });
      }
    }

    return index;
  }

  private skipElixirLiteral(index: number): number {
    const code: string = this.code;
    const character: string = code.charAt(index);

    if (code.startsWith('"""', index) || code.startsWith("'''", index)) {
      const quote: string = code.slice(index, index + 3);

      return this.skipQuoted(index, quote, {
        escapes: true,
        multiline: true,
        holes: true,
      });
    }

    if (character === '"' || character === "'") {
      return this.skipQuoted(index, character, {
        escapes: true,
        multiline: true,
        holes: true,
      });
    }

    // A character's code point: ?a, ?\n; a name ending in ? is a name (valid?).
    if (character === "?" && !isIdentifierPart(code.charAt(index - 1))) {
      if (code.charAt(index + 1) === "\\") {
        return index + 3;
      }

      return code.charAt(index + 1) ? index + 2 : index + 1;
    }

    // Sigils: ~s(...), ~r/.../, ~w[...], ~S"""...""", ~HTML{...}, and their modifiers.
    if (
      character === "~" &&
      (LOWER_CASE_LETTER.test(code.charAt(index + 1)) ||
        UPPER_CASE_LETTER.test(code.charAt(index + 1)))
    ) {
      let at: number = index + 1;
      const isUpper: boolean = UPPER_CASE_LETTER.test(code.charAt(at));

      while (
        UPPER_CASE_LETTER.test(code.charAt(at)) ||
        (at === index + 1 && LOWER_CASE_LETTER.test(code.charAt(at)))
      ) {
        at++;
      }

      const open: string = code.charAt(at);

      if (!ELIXIR_SIGIL_DELIMITERS.includes(open)) {
        return index;
      }

      const isHeredoc: boolean =
        code.startsWith(open.repeat(3), at) && (open === '"' || open === "'");
      const quote: string = isHeredoc ? open.repeat(3) : open;
      let end: number = this.skipQuoted(at, quote, {
        escapes: !isUpper,
        multiline: true,
        holes: !isUpper,
        closer: isHeredoc ? quote : PAIRED_DELIMITERS[open] || open,
      });

      if (end < 0) {
        return -1;
      }

      while (LOWER_CASE_LETTER.test(code.charAt(end))) {
        end++;
      }

      return end;
    }

    return index;
  }
}

// What keeps code in one of these languages from reading as well formed, or nothing.
export function syntaxProblems(
  code: string,
  language: SyntaxLanguage,
): Array<string> {
  return new SyntaxReader(code, language).problems();
}

/*
 * What is not a line of a TOML file, such as a Cargo.toml: a [table] or
 * [[array]] header, a key = value, a comment, or a line inside an array
 * or an inline table that spans lines.
 */
export function tomlProblems(code: string): Array<string> {
  const problems: Array<string> = [];
  let depth: number = 0;

  for (const rawLine of code.split("\n")) {
    const line: string = rawLine.trim();
    const isContinuation: boolean = depth > 0;

    depth += bracketBalance(line);

    if (isContinuation || line.length === 0 || line.startsWith("#")) {
      continue;
    }

    const isHeader: boolean =
      line.startsWith("[") && line.endsWith("]") && !line.includes("=");
    const equals: number = line.indexOf("=");
    const key: string = equals > 0 ? line.slice(0, equals).trim() : "";

    if (isHeader) {
      continue;
    }

    if (equals <= 0 || key.length === 0 || key.includes(" ")) {
      problems.push(`not a TOML line: "${line}"`);
    }
  }

  if (depth !== 0) {
    problems.push(`${depth} bracket(s) never close`);
  }

  return problems;
}

// How many brackets a TOML line leaves open, strings and comments aside.
function bracketBalance(line: string): number {
  let balance: number = 0;
  let quote: string = "";

  for (let at: number = 0; at < line.length; at++) {
    const character: string = line.charAt(at);

    if (quote) {
      if (character === "\\" && quote === '"') {
        at++;
      } else if (character === quote) {
        quote = "";
      }
      continue;
    }

    if (character === '"' || character === "'") {
      quote = character;
    } else if (character === "#") {
      break;
    } else if (character === "[" || character === "{") {
      balance++;
    } else if (character === "]" || character === "}") {
      balance--;
    }
  }

  return balance;
}
