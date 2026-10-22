import { PRODUCTION_REVIEW_LIMITS } from "../../../../Types/CodeRepository/ProductionReview";
import {
  isAsciiLetterCode,
  isDigitCode,
  isWhiteSpaceCode,
} from "../../../../Utils/RegExpCharacterClasses";
import { normalizeCandidatePath } from "../StackTraceRepoResolver";

/*
 * WHAT A PULL REQUEST CHANGES, IN THE TERMS PRODUCTION CAN BE ASKED ABOUT.
 *
 * GitHub sends a pull request's diff file by file, each as unified-diff
 * hunks. A production review needs three things out of them, per file of
 * code:
 *
 *   - the LINES of the file as production runs it - the base, before this
 *     change - that the change edits, deletes or inserts code beside: a
 *     stack frame names a line of the deployed code, so a frame at a base
 *     line this change touches is thrown exactly where the change is;
 *   - the FUNCTIONS it touches: declared in a changed line, or named by a
 *     hunk's heading (git puts the enclosing function's line there), so a
 *     frame, a profile or a span in one of them is found;
 *   - the ROUTES its changed lines spell out ("/api/orders/:id"), so the
 *     operation that serves one is found among a service's spans.
 *
 * Everything here reads text a pull request's author wrote, so all of it
 * runs in time in line with the text: lines are read character by
 * character, never by a pattern that backtracks, and every line, file and
 * list is held to a length.
 *
 * Pure: no IO.
 */

// The longest line of a patch read for names and routes.
const MAX_LINE_READ: number = 500;

// The routes of one file looked up.
const MAX_ROUTES_PER_FILE: number = 10;

// The longest and shortest route literal taken.
const MAX_ROUTE_LENGTH: number = 200;
const MIN_ROUTE_LENGTH: number = 4;

// The longest identifier taken as a function's name.
const MAX_IDENTIFIER_LENGTH: number = 100;

/*
 * The extensions of files of code: what production runs, and what stack
 * frames, profiles and spans name. Everything else in a pull request -
 * docs, configuration, lockfiles, images, migrations of SQL - says nothing
 * a production lookup by file could find.
 */
export const CODE_FILE_EXTENSIONS: ReadonlySet<string> = new Set<string>([
  "ts",
  "tsx",
  "mts",
  "cts",
  "js",
  "jsx",
  "mjs",
  "cjs",
  "vue",
  "svelte",
  "py",
  "go",
  "java",
  "kt",
  "kts",
  "scala",
  "groovy",
  "rb",
  "php",
  "cs",
  "fs",
  "vb",
  "rs",
  "swift",
  "m",
  "mm",
  "c",
  "h",
  "cc",
  "cpp",
  "cxx",
  "hpp",
  "hh",
  "ex",
  "exs",
  "erl",
  "hrl",
  "clj",
  "cljs",
  "dart",
  "lua",
  "pl",
  "pm",
  "jl",
  "elm",
  "hs",
  "ml",
]);

/*
 * Words a line starts or a call is made with that are never the name of a
 * function being declared.
 */
const NOT_FUNCTION_NAMES: ReadonlySet<string> = new Set<string>([
  "if",
  "for",
  "foreach",
  "while",
  "switch",
  "catch",
  "return",
  "function",
  "typeof",
  "sizeof",
  "await",
  "new",
  "delete",
  "throw",
  "throws",
  "else",
  "elif",
  "do",
  "try",
  "with",
  "using",
  "lock",
  "except",
  "case",
  "when",
  "match",
  "yield",
  "super",
  "this",
  "self",
  "import",
  "require",
  "assert",
  "print",
  "defer",
  "go",
  "select",
]);

// Words that come before a declaration's name and say nothing of it.
const DECLARATION_MODIFIERS: ReadonlySet<string> = new Set<string>([
  "export",
  "default",
  "public",
  "private",
  "protected",
  "internal",
  "static",
  "async",
  "override",
  "final",
  "virtual",
  "abstract",
  "readonly",
  "synchronized",
  "inline",
  "suspend",
  "open",
  "pub",
  "unsafe",
  "extern",
  "const",
  "let",
  "var",
  "get",
  "set",
]);

// The words that declare a function, and the name after them.
const FUNCTION_KEYWORDS: ReadonlySet<string> = new Set<string>([
  "def",
  "defp",
  "function",
  "func",
  "fn",
  "fun",
  "sub",
  "proc",
]);

// The base lines one change touches, as closed ranges.
export interface LineRange {
  start: number;
  end: number;
}

export interface ChangedCodeFile {
  // The file as the repository names it after the change.
  path: string;
  // Its name before the change, when the change renamed it.
  previousPath?: string | undefined;
  // GitHub's word for what happened to it: added, modified, removed, renamed.
  status: string;
  /*
   * The lines of the file as production runs it (the base) that the change
   * edits or deletes, or inserts code beside.
   */
  baseLines: Array<LineRange>;
  // The functions the change touches.
  functionNames: Array<string>;
  // The routes the changed lines spell out.
  routes: Array<string>;
  // GitHub sent no text diff (a binary file, or one too large).
  hasPatch: boolean;
}

export interface ChangedCode {
  files: Array<ChangedCodeFile>;
  // Every file of the pull request read, code or not.
  fileCount: number;
  // The files of code among them.
  codeFileCount: number;
  // Some files of code were left out (maxCodeFiles), or the pull request had more files than were read.
  isTruncated: boolean;
}

// One file of a pull request, as GitHub lists it.
export interface PullRequestFileInput {
  filename: string;
  previousFilename?: string | null | undefined;
  status: string;
  patch: string | null;
}

export interface PatchFacts {
  baseLines: Array<LineRange>;
  functionNames: Array<string>;
  routes: Array<string>;
}

function isIdentifierStart(code: number): boolean {
  return isAsciiLetterCode(code) || code === 0x5f || code === 0x24;
}

function isIdentifierPart(code: number): boolean {
  return isIdentifierStart(code) || isDigitCode(code);
}

// The index of the first character at or after `from` that is not white space.
function skipSpaces(text: string, from: number): number {
  let index: number = from;

  while (index < text.length && isWhiteSpaceCode(text.charCodeAt(index))) {
    index++;
  }

  return index;
}

// The identifier starting at `from`, or "" when none does.
function readIdentifier(text: string, from: number): string {
  if (from >= text.length || !isIdentifierStart(text.charCodeAt(from))) {
    return "";
  }

  let end: number = from + 1;

  while (end < text.length && isIdentifierPart(text.charCodeAt(end))) {
    end++;
  }

  return text.slice(from, end);
}

// A name a function may have: an identifier that is no keyword, not too long.
export function isFunctionName(name: string): boolean {
  return (
    name.length > 0 &&
    name.length <= MAX_IDENTIFIER_LENGTH &&
    !NOT_FUNCTION_NAMES.has(name) &&
    !FUNCTION_KEYWORDS.has(name) &&
    !DECLARATION_MODIFIERS.has(name)
  );
}

/*
 * Past a balanced "(...)" that starts at `open`, or -1 when it does not
 * close on the line. Go's receiver - func (s *Server) Charge( - is one.
 */
function skipParentheses(text: string, open: number): number {
  let depth: number = 0;

  for (let index: number = open; index < text.length; index++) {
    const character: string = text[index]!;

    if (character === "(") {
      depth++;
    } else if (character === ")") {
      depth--;

      if (depth === 0) {
        return index + 1;
      }
    }
  }

  return -1;
}

/*
 * Whether what is assigned (after "=", or after ":" in an object or a type
 * annotation) is a function: "function", "async ...", "(params) => ..." or
 * "param => ...". After a ":" that is a type annotation, the value is what
 * follows its "=". A call that takes a callback - items.reduce((a) => a) -
 * is not one: it starts with a name followed by ".".
 */
function isFunctionValue(value: string, isAfterColon: boolean): boolean {
  let rest: string = value.trimStart();

  const startsAsFunction: (text: string) => boolean = (
    text: string,
  ): boolean => {
    const word: string = readIdentifier(text, 0);

    if (word === "function" || word === "async") {
      return true;
    }

    if (text[0] === "(") {
      const close: number = skipParentheses(text, 0);

      if (close === -1) {
        // "(" with its parameters on the next lines.
        return text.trimEnd().endsWith("(");
      }

      const after: string = text.slice(close).trimStart();

      // "(a, b): Result =>", "(a) =>"
      return (
        after.startsWith("=>") || (after[0] === ":" && after.includes("=>"))
      );
    }

    // "param => ..."
    return (
      Boolean(word) && text.slice(word.length).trimStart().startsWith("=>")
    );
  };

  if (startsAsFunction(rest)) {
    return true;
  }

  if (!isAfterColon) {
    return false;
  }

  // "name: Type = (...) =>": the value is after the annotation's "=".
  const equals: number = rest.indexOf("=");

  if (equals === -1 || rest[equals + 1] === ">" || rest[equals + 1] === "=") {
    return false;
  }

  rest = rest.slice(equals + 1).trimStart();

  return startsAsFunction(rest);
}

/*
 * The name of the function a line of code declares, or null for a line that
 * declares none - read the way people write declarations in the languages
 * production runs, character by character:
 *
 *   def charge_card(self, card):            python, ruby, elixir (defp)
 *   function chargeCard(card) {             javascript, php, lua
 *   export async function chargeCard(       with modifiers before it
 *   func (s *Server) Charge(ctx context.Context) error {   go, with a receiver
 *   fn charge(card: &Card) -> Result<()> {  rust; fun in kotlin
 *   const chargeCard = async (card) => {    an arrow function, assigned
 *   chargeCard: function (card) {           a function in an object
 *   public async chargeCard(card: Card): Promise<void> {   a method
 *   public static Receipt charge(Card card) throws X {     a method with a type
 *
 * A call - chargeCard(card); app.get("/x", (req) => { ... - declares
 * nothing, and neither does a line that starts with a control word.
 */
export function extractDeclaredFunctionName(rawLine: string): string | null {
  const line: string = rawLine.slice(0, MAX_LINE_READ);
  let position: number = skipSpaces(line, 0);

  if (position >= line.length) {
    return null;
  }

  // Modifiers first, and what they are followed by.
  let first: string = readIdentifier(line, position);
  let hasModifiers: boolean = false;

  while (first && DECLARATION_MODIFIERS.has(first)) {
    const after: number = skipSpaces(line, position + first.length);

    if (after === position + first.length) {
      // "const(" or "async(" - a modifier must be followed by a space.
      break;
    }

    position = after;
    hasModifiers = true;
    first = readIdentifier(line, position);
  }

  if (!first) {
    return null;
  }

  // def / function / func / fn / fun / sub / proc NAME
  if (FUNCTION_KEYWORDS.has(first)) {
    let next: number = skipSpaces(line, position + first.length);

    // function* generator
    if (line[next] === "*") {
      next = skipSpaces(line, next + 1);
    }

    // func (receiver) Name(
    if (line[next] === "(") {
      const afterReceiver: number = skipParentheses(line, next);

      if (afterReceiver === -1) {
        return null;
      }

      next = skipSpaces(line, afterReceiver);
    }

    const name: string = readIdentifier(line, next);

    return isFunctionName(name) ? name : null;
  }

  const afterFirst: number = skipSpaces(line, position + first.length);
  const following: string = line[afterFirst] || "";

  // NAME = function / NAME = async (...) => / NAME: (...) =>
  if (following === "=" || following === ":") {
    if (line[afterFirst + 1] === "=" || line[afterFirst + 1] === ":") {
      // "==", "::" - a comparison or a scope, not an assignment.
      return null;
    }

    return isFunctionName(first) &&
      isFunctionValue(line.slice(afterFirst + 1), following === ":")
      ? first
      : null;
  }

  /*
   * A method: [Type ...] NAME(params) [...] {   - the line opens a body, or
   * (Java and C# with the brace on the next line) ends its signature after
   * a type or a modifier, which a call never has before it.
   */
  const open: number = line.indexOf("(", position);

  if (open === -1 || NOT_FUNCTION_NAMES.has(first)) {
    return null;
  }

  const trimmed: string = line.trimEnd();
  const opensBody: boolean = trimmed.endsWith("{");

  if ((!opensBody && !trimmed.endsWith(")")) || trimmed.includes(";")) {
    return null;
  }

  // The identifier right before "(", with only types and modifiers before it.
  let nameEnd: number = open;

  while (nameEnd > position && isWhiteSpaceCode(line.charCodeAt(nameEnd - 1))) {
    nameEnd--;
  }

  let nameStart: number = nameEnd;

  while (
    nameStart > position &&
    isIdentifierPart(line.charCodeAt(nameStart - 1))
  ) {
    nameStart--;
  }

  const name: string = line.slice(nameStart, nameEnd);

  if (!isFunctionName(name) || !isIdentifierStart(name.charCodeAt(0))) {
    return null;
  }

  // "chargeCard(card)" on a line of its own is a call.
  if (!opensBody && nameStart === position && !hasModifiers) {
    return null;
  }

  /*
   * What comes before the name may only be words, generic types and
   * array brackets - "public static Receipt", "Map<String, X>" - never "."
   * (a call on something), "=" (an assignment) or anything else.
   */
  for (let index: number = position; index < nameStart; index++) {
    const code: number = line.charCodeAt(index);

    if (
      !isIdentifierPart(code) &&
      !isWhiteSpaceCode(code) &&
      code !== 0x3c && // <
      code !== 0x3e && // >
      code !== 0x2c && // ,
      code !== 0x5b && // [
      code !== 0x5d && // ]
      code !== 0x3f && // ?
      code !== 0x2a // * (a pointer in C, a generator in TypeScript)
    ) {
      return null;
    }
  }

  // A declaration's parameters are names and types, never a value or a callback.
  const parameters: string = line.slice(open + 1);
  const firstParameter: string = parameters.trimStart()[0] || "";

  if (
    firstParameter === '"' ||
    firstParameter === "'" ||
    firstParameter === "`" ||
    parameters.includes("=>") ||
    parameters.includes("function")
  ) {
    return null;
  }

  return name;
}

// A character a route may hold, besides letters and digits.
const ROUTE_PUNCTUATION: string = "/_-.:{}*~$@+";

function isRouteCharacter(code: number): boolean {
  return (
    isAsciiLetterCode(code) ||
    isDigitCode(code) ||
    ROUTE_PUNCTUATION.includes(String.fromCharCode(code))
  );
}

/*
 * The route a string literal spells out, or null: it starts with "/", holds
 * only what a route holds, has a letter in it, and is no address ("//") or
 * file path with an extension at its end.
 */
export function readRouteLiteral(literal: string): string | null {
  if (
    literal.length < MIN_ROUTE_LENGTH ||
    literal.length > MAX_ROUTE_LENGTH ||
    literal[0] !== "/" ||
    literal.includes("//")
  ) {
    return null;
  }

  let hasLetter: boolean = false;

  for (let index: number = 0; index < literal.length; index++) {
    const code: number = literal.charCodeAt(index);

    if (!isRouteCharacter(code)) {
      return null;
    }

    if (isAsciiLetterCode(code)) {
      hasLetter = true;
    }
  }

  if (!hasLetter) {
    return null;
  }

  // "/assets/app.js", "/etc/hosts.conf": a file, not a route.
  const lastSegment: string = literal.slice(literal.lastIndexOf("/") + 1);
  const dot: number = lastSegment.lastIndexOf(".");

  if (dot > 0 && dot < lastSegment.length - 1) {
    const extension: string = lastSegment.slice(dot + 1);

    if (readIdentifier(extension, 0) === extension) {
      return null;
    }
  }

  return literal;
}

// The routes the string literals of one line spell out.
export function extractRouteLiterals(rawLine: string): Array<string> {
  const line: string = rawLine.slice(0, MAX_LINE_READ);
  const routes: Array<string> = [];
  let index: number = 0;

  while (index < line.length) {
    const quote: string = line[index]!;

    if (quote !== '"' && quote !== "'" && quote !== "`") {
      index++;
      continue;
    }

    const close: number = line.indexOf(quote, index + 1);

    if (close === -1) {
      break;
    }

    const route: string | null = readRouteLiteral(line.slice(index + 1, close));

    if (route && !routes.includes(route)) {
      routes.push(route);
    }

    index = close + 1;
  }

  return routes;
}

// "-12,3 +12,4" out of a hunk's header, or null for a header that is not one.
export interface HunkHeader {
  baseStart: number;
  headStart: number;
  // The text after the second "@@": the enclosing function, as git saw it.
  heading: string;
}

function readNumber(
  text: string,
  from: number,
): { value: number; end: number } | null {
  let end: number = from;

  while (
    end < text.length &&
    end - from < 10 &&
    isDigitCode(text.charCodeAt(end))
  ) {
    end++;
  }

  if (end === from) {
    return null;
  }

  return { value: Number(text.slice(from, end)), end };
}

export function parseHunkHeader(line: string): HunkHeader | null {
  if (!line.startsWith("@@ -")) {
    return null;
  }

  const base: { value: number; end: number } | null = readNumber(line, 4);

  if (!base) {
    return null;
  }

  let position: number = base.end;

  if (line[position] === ",") {
    const count: { value: number; end: number } | null = readNumber(
      line,
      position + 1,
    );

    if (!count) {
      return null;
    }

    position = count.end;
  }

  if (line[position] !== " " || line[position + 1] !== "+") {
    return null;
  }

  const head: { value: number; end: number } | null = readNumber(
    line,
    position + 2,
  );

  if (!head) {
    return null;
  }

  position = head.end;

  if (line[position] === ",") {
    const count: { value: number; end: number } | null = readNumber(
      line,
      position + 1,
    );

    if (!count) {
      return null;
    }

    position = count.end;
  }

  if (!line.startsWith(" @@", position)) {
    return null;
  }

  return {
    baseStart: base.value,
    headStart: head.value,
    heading: line.slice(position + 3).trim(),
  };
}

// Sorted, merged ranges out of a set of line numbers.
export function toLineRanges(lines: Iterable<number>): Array<LineRange> {
  const sorted: Array<number> = Array.from(new Set<number>(lines))
    .filter((line: number): boolean => {
      return Number.isSafeInteger(line) && line > 0;
    })
    .sort((a: number, b: number): number => {
      return a - b;
    });

  const ranges: Array<LineRange> = [];

  for (const line of sorted) {
    const last: LineRange | undefined = ranges[ranges.length - 1];

    if (last && line <= last.end + 1) {
      last.end = Math.max(last.end, line);
    } else {
      ranges.push({ start: line, end: line });
    }
  }

  return ranges;
}

export function isLineInRanges(
  line: number,
  ranges: Array<LineRange>,
): boolean {
  return ranges.some((range: LineRange): boolean => {
    return line >= range.start && line <= range.end;
  });
}

function addName(names: Array<string>, name: string | null): void {
  if (
    name &&
    !names.includes(name) &&
    names.length < PRODUCTION_REVIEW_LIMITS.maxFunctionsPerFile
  ) {
    names.push(name);
  }
}

/*
 * The base lines, functions and routes one file's patch touches, read line
 * by line.
 */
export function readPatch(patch: string): PatchFacts {
  const baseLines: Set<number> = new Set<number>();
  const functionNames: Array<string> = [];
  const routes: Array<string> = [];

  let baseLine: number = 0;
  let inHunk: boolean = false;
  let previousWasRemoval: boolean = false;

  for (const rawLine of patch.split("\n")) {
    const line: string = rawLine.endsWith("\r")
      ? rawLine.slice(0, -1)
      : rawLine;

    if (line.startsWith("@@")) {
      const header: HunkHeader | null = parseHunkHeader(line);

      inHunk = Boolean(header);
      previousWasRemoval = false;

      if (header) {
        baseLine = header.baseStart;
        addName(functionNames, extractDeclaredFunctionName(header.heading));
      }

      continue;
    }

    if (!inHunk) {
      continue;
    }

    const marker: string = line[0] || " ";
    const code: string = line.slice(1);

    if (marker === "\\") {
      // "\ No newline at end of file"
      continue;
    }

    if (marker === "-") {
      baseLines.add(baseLine);
      baseLine++;
      previousWasRemoval = true;
    } else if (marker === "+") {
      /*
       * Code inserted between two lines of the base touches both: an
       * exception thrown at the line after it is thrown right where the
       * change is. A line that replaces a removed one is counted with it.
       */
      if (!previousWasRemoval) {
        baseLines.add(baseLine - 1);
        baseLines.add(baseLine);
      }
    } else {
      baseLine++;
      previousWasRemoval = false;
      continue;
    }

    addName(functionNames, extractDeclaredFunctionName(code));

    for (const route of extractRouteLiterals(code)) {
      if (!routes.includes(route) && routes.length < MAX_ROUTES_PER_FILE) {
        routes.push(route);
      }
    }
  }

  return {
    baseLines: toLineRanges(baseLines),
    functionNames,
    routes,
  };
}

// The extension of a path's file name, lower case, or "".
export function getFileExtension(path: string): string {
  const slash: number = path.lastIndexOf("/");
  const name: string = path.slice(slash + 1);
  const dot: number = name.lastIndexOf(".");

  return dot > 0 ? name.slice(dot + 1).toLowerCase() : "";
}

/*
 * Whether production could run the file: code, by its extension, and not
 * a dependency's copy (vendor/, node_modules/) - the same frames the
 * repository resolver leaves out.
 */
export function isCodeFile(path: string): boolean {
  if (!CODE_FILE_EXTENSIONS.has(getFileExtension(path))) {
    return false;
  }

  return normalizeCandidatePath(`/${path}`) !== null;
}

/*
 * The files of code a pull request changes, with what each change touches,
 * in GitHub's order: at most maxCodeFiles of them.
 */
export function readChangedCode(data: {
  files: Array<PullRequestFileInput>;
  // The pull request has more files than were read.
  hasMoreFiles?: boolean | undefined;
}): ChangedCode {
  const files: Array<ChangedCodeFile> = [];
  let codeFileCount: number = 0;
  let functionCount: number = 0;

  for (const file of data.files) {
    const path: string = (file.filename || "").trim();

    if (!path || !isCodeFile(path)) {
      continue;
    }

    codeFileCount++;

    if (files.length >= PRODUCTION_REVIEW_LIMITS.maxCodeFiles) {
      continue;
    }

    const facts: PatchFacts = file.patch
      ? readPatch(file.patch)
      : { baseLines: [], functionNames: [], routes: [] };

    // The whole change's functions are held to a number too.
    const functionNames: Array<string> = facts.functionNames.slice(
      0,
      Math.max(0, PRODUCTION_REVIEW_LIMITS.maxFunctions - functionCount),
    );

    functionCount += functionNames.length;

    const changed: ChangedCodeFile = {
      path,
      status: file.status || "modified",
      baseLines: facts.baseLines,
      functionNames,
      routes: facts.routes,
      hasPatch: Boolean(file.patch),
    };

    const previousPath: string = (file.previousFilename || "").trim();

    if (previousPath && previousPath !== path) {
      changed.previousPath = previousPath;
    }

    files.push(changed);
  }

  return {
    files,
    fileCount: data.files.length,
    codeFileCount,
    isTruncated:
      Boolean(data.hasMoreFiles) ||
      codeFileCount > PRODUCTION_REVIEW_LIMITS.maxCodeFiles,
  };
}

// How many trailing path segments two paths share.
export function sharedTrailingSegments(first: string, second: string): number {
  const a: Array<string> = first.split("/");
  const b: Array<string> = second.split("/");
  let shared: number = 0;

  while (
    shared < a.length &&
    shared < b.length &&
    a[a.length - 1 - shared] === b[b.length - 1 - shared]
  ) {
    shared++;
  }

  return shared;
}

export interface ChangedFileMatch {
  file: ChangedCodeFile;
  // The repository path the runtime path matched: the file's path, or its name before a rename.
  matchedPath: string;
  sharedSegments: number;
}

/*
 * The changed file a path production reports - a stack frame's file, a
 * profile's, a span's code.filepath - is, or null.
 *
 * Runtime paths are not repository paths: "/app/src/billing/charge.ts" is
 * the repository's "src/billing/charge.ts", or "services/billing/src/
 * billing/charge.ts" in a monorepo, and a Java frame names only
 * "Charge.java". So the two are matched from the end, segment by segment,
 * as the repository resolver matches them: one path must be the other's
 * whole tail. Two or more segments in common is a match; the file name
 * alone is one only when the runtime path is no more than a file name and
 * no other changed file has that name. A dependency's file never matches.
 */
export function matchChangedFile(
  runtimePath: string,
  files: Array<ChangedCodeFile>,
): ChangedFileMatch | null {
  const candidate: string | null = normalizeCandidatePath(
    runtimePath.length > 1000 ? "" : runtimePath,
  );

  if (!candidate) {
    return null;
  }

  const candidateSegments: number = candidate.split("/").length;
  let best: ChangedFileMatch | null = null;
  let isAmbiguous: boolean = false;

  for (const file of files) {
    for (const path of file.previousPath
      ? [file.path, file.previousPath]
      : [file.path]) {
      const shared: number = sharedTrailingSegments(candidate, path);
      const shorter: number = Math.min(
        candidateSegments,
        path.split("/").length,
      );

      if (shared === 0 || shared !== shorter) {
        continue;
      }

      if (shared === 1 && candidateSegments > 1) {
        // "lib/x/charge.ts" is not "src/charge.ts".
        continue;
      }

      if (!best || shared > best.sharedSegments) {
        best = { file, matchedPath: path, sharedSegments: shared };
        isAmbiguous = false;
      } else if (shared === best.sharedSegments && best.file !== file) {
        isAmbiguous = true;
      }
    }
  }

  if (!best || isAmbiguous) {
    return null;
  }

  return best;
}

// Every function the change touches, across its files, once each.
export function getChangedFunctionNames(changed: ChangedCode): Array<string> {
  const names: Array<string> = [];

  for (const file of changed.files) {
    for (const name of file.functionNames) {
      if (!names.includes(name)) {
        names.push(name);
      }
    }
  }

  return names;
}
