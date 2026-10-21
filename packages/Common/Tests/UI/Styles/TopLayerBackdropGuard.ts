import { toRelativePath } from "../../ForeignHiddenRuleGuard";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind Tests/UI/Styles/TopLayerBackdrop.test.ts: no stylesheet
 * a frontend ships may paint the ::backdrop of a top-layer element the app
 * does not own.
 *
 * Why the rule exists: the Dashboard went blank - nothing on screen but the
 * light grey page background - whenever 1Password's "Sign in" prompt came up.
 * The prompt is a <com-1password-uso popover> that 1Password's extension
 * appends to the page and shows in the browser's top layer. Every top-layer
 * element (a fullscreen element, a modal dialog, an open popover) gets a
 * viewport-sized ::backdrop drawn right under it, and a popover's is
 * see-through until the page paints it. The Dashboard's index.ejs and
 * Common's Theme.css painted a bare `::backdrop` in the page colour, meant
 * only for fullscreen dashboards, so the prompt's backdrop became an opaque
 * sheet over the entire app until the prompt went away.
 *
 * What it flags: a style rule whose selector puts ::backdrop (or
 * ::-webkit-backdrop) on an element it does not pin down as ours - `::backdrop`,
 * `*::backdrop`, `html.dark ::backdrop`, `[popover]::backdrop`,
 * `:popover-open::backdrop`, `:modal::backdrop`, `dialog::backdrop`,
 * `:not(.ours)::backdrop` - and that declares anything beyond custom
 * properties.
 *
 * What it lets through: a backdrop whose own element carries a class or an id
 * (`.ou-dialog::backdrop`, Tailwind's `backdrop:` variant, which compiles to
 * the element's class), the fullscreen backdrop (`:fullscreen::backdrop`; the
 * app is what asks for fullscreen, and the fullscreen element covers the
 * viewport anyway), and a rule that only sets custom properties, which paints
 * nothing (Tailwind's preflight declares its --tw-* defaults on ::backdrop).
 *
 * Where it reads: every .css file, every <style> block of the EJS and HTML
 * views, and every string or template literal in the TypeScript modules that
 * mentions a backdrop (CSS-in-JS such as the error boundary's sheet), across
 * every feature set, Common/UI, Common's server views, the website and, when
 * the checkout has it, ee/.
 */

export interface CssDeclaration {
  property: string;
  value: string;
}

export interface CssStyleRule {
  /** Whitespace-normalised, one entry per comma-separated selector. */
  selectors: Array<string>;
  declarations: Array<CssDeclaration>;
  /** 1-based line of the selector in the file the stylesheet came from. */
  line: number;
}

export interface EmbeddedStyleSheet {
  css: string;
  /** 1-based line in the file where `css` starts. */
  line: number;
}

export interface UnscopedBackdropFinding {
  file: string;
  line: number;
  selector: string;
  /** The declarations that paint: everything but custom properties. */
  properties: Array<string>;
}

export interface BackdropRule {
  file: string;
  line: number;
  selector: string;
}

/*
 * The rules that passed are kept as well as the ones that failed, split by
 * why they passed, so a suite can check what the scan actually read.
 */
export interface BackdropRuleVerdicts {
  findings: Array<UnscopedBackdropFinding>;
  // The backdrop of an element pinned down as ours: :fullscreen, a class, an id.
  scopedRules: Array<BackdropRule>;
  // An unscoped backdrop that is only handed custom properties.
  paintFreeRules: Array<BackdropRule>;
}

export interface TopLayerBackdropScan extends BackdropRuleVerdicts {
  /** Every file read, relative to the repository root. */
  files: Array<string>;
}

/*
 * At-rules whose block holds style rules. Anything else with a block
 * (@keyframes, @font-face, @page, @property) is skipped whole.
 */
const GROUPING_AT_RULES: ReadonlySet<string> = new Set<string>([
  "media",
  "supports",
  "layer",
  "container",
  "document",
  "-moz-document",
  "scope",
  "starting-style",
]);

const BACKDROP_PSEUDO_ELEMENT: RegExp = /::(?:-webkit-)?backdrop(?![-\w])/gi;

const FULLSCREEN_PSEUDO_CLASS: RegExp =
  /:(?:fullscreen|-webkit-full-screen|-moz-full-screen)(?![-\w])/i;

// A class or id selector: `.` or `#` that is not escaped, then a name.
const CLASS_OR_ID_SELECTOR: RegExp = /(?:^|[^\\])[.#](?:-?[_a-zA-Z\\]|--)/;

const AT_RULE_NAME: RegExp = /^@([-\w]+)/;
const WHITESPACE: RegExp = /\s/;
const MENTIONS_BACKDROP: RegExp = /backdrop/i;

const STYLESHEET_FILE: RegExp = /\.css$/i;
const MARKUP_FILE: RegExp = /\.(?:ejs|html?)$/i;
const MODULE_FILE: RegExp = /\.tsx?$/i;

const SKIPPED_DIRECTORIES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "dist",
  "build",
  "coverage",
  ".git",
]);

/*
 * Stands in for a template literal's `${...}` when its static text is read
 * as CSS. A bare identifier reads as a type selector, never as a class, so a
 * substitution can only make a rule look less scoped than it is - the guard
 * errs towards flagging, never towards waving a rule through.
 */
const SUBSTITUTION_PLACEHOLDER: string = "_";

export const WHY_PARAGRAPH: string =
  "Every element in the browser's top layer - a fullscreen element, a modal dialog, an open popover - gets a viewport-sized ::backdrop drawn under it. Browser extensions show their in-page UI as popovers (1Password's \"Sign in\" prompt is a <com-1password-uso popover>), and a popover's backdrop is see-through until the page paints it. A rule that reaches those backdrops turns them into an opaque sheet over the whole app: the Dashboard went blank whenever 1Password's prompt came up. Scope the rule to the element it is for - :fullscreen::backdrop for the Fullscreen API, or a class on your own dialog (.my-dialog::backdrop, or Tailwind's backdrop: variant on that element).";

function normalizeWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

/*
 * The index just past the quoted string that opens at `start`, honouring
 * backslash escapes. An unterminated string runs to the end.
 */
function skipQuoted(source: string, start: number): number {
  const quote: string = source[start]!;
  let index: number = start + 1;

  while (index < source.length) {
    const character: string = source[index]!;

    if (character === "\\") {
      index += 2;
      continue;
    }

    if (character === quote) {
      return index + 1;
    }

    index++;
  }

  return source.length;
}

/*
 * Comments blanked out to spaces, newlines kept, so every offset and line
 * number still points at the source. A comment marker inside a string is
 * string content, not a comment.
 */
export function blankCssComments(css: string): string {
  let result: string = "";
  let index: number = 0;

  while (index < css.length) {
    const character: string = css[index]!;

    if (character === '"' || character === "'") {
      const end: number = skipQuoted(css, index);
      result += css.slice(index, end);
      index = end;
      continue;
    }

    if (character === "/" && css[index + 1] === "*") {
      const close: number = css.indexOf("*/", index + 2);
      const end: number = close === -1 ? css.length : close + 2;
      result += css.slice(index, end).replace(/[^\n]/g, " ");
      index = end;
      continue;
    }

    result += character;
    index++;
  }

  return result;
}

// The index of the brace that closes the block opened at `open`.
function findClosingBrace(source: string, open: number, end: number): number {
  let depth: number = 0;
  let index: number = open;

  while (index < end) {
    const character: string = source[index]!;

    if (character === '"' || character === "'") {
      index = skipQuoted(source, index);
      continue;
    }

    if (character === "{") {
      depth++;
    } else if (character === "}") {
      depth--;

      if (depth === 0) {
        return index;
      }
    }

    index++;
  }

  return end;
}

/*
 * Splits on `separator` where it is not inside parentheses, brackets, braces
 * or a string: the commas of `:is(a, b)` and the semicolons of
 * `url(data:...;base64,...)` belong to what they are in.
 */
function splitTopLevel(text: string, separator: string): Array<string> {
  const pieces: Array<string> = [];
  let depth: number = 0;
  let pieceStart: number = 0;
  let index: number = 0;

  while (index < text.length) {
    const character: string = text[index]!;

    if (character === '"' || character === "'") {
      index = skipQuoted(text, index);
      continue;
    }

    if (character === "(" || character === "[" || character === "{") {
      depth++;
    } else if (character === ")" || character === "]" || character === "}") {
      depth = Math.max(0, depth - 1);
    } else if (character === separator && depth === 0) {
      pieces.push(text.slice(pieceStart, index));
      pieceStart = index + 1;
    }

    index++;
  }

  pieces.push(text.slice(pieceStart));

  return pieces;
}

// Whether `text` opens a block somewhere outside its strings.
function opensBlock(text: string): boolean {
  let index: number = 0;

  while (index < text.length) {
    const character: string = text[index]!;

    if (character === '"' || character === "'") {
      index = skipQuoted(text, index);
      continue;
    }

    if (character === "{") {
      return true;
    }

    index++;
  }

  return false;
}

function parseDeclarations(body: string): Array<CssDeclaration> {
  const declarations: Array<CssDeclaration> = [];

  for (const piece of splitTopLevel(body, ";")) {
    // A nested rule is not a declaration of this one.
    if (opensBlock(piece)) {
      continue;
    }

    const separatorAt: number = piece.indexOf(":");

    if (separatorAt === -1) {
      continue;
    }

    const property: string = normalizeWhitespace(piece.slice(0, separatorAt));

    if (!property) {
      continue;
    }

    declarations.push({
      property: property.startsWith("--") ? property : property.toLowerCase(),
      value: normalizeWhitespace(piece.slice(separatorAt + 1)),
    });
  }

  return declarations;
}

function lineStartsOf(source: string): Array<number> {
  const starts: Array<number> = [0];

  for (let index: number = 0; index < source.length; index++) {
    if (source[index] === "\n") {
      starts.push(index + 1);
    }
  }

  return starts;
}

// 1-based line of `offset`, by binary search over the line starts.
function lineAt(lineStarts: Array<number>, offset: number): number {
  let low: number = 0;
  let high: number = lineStarts.length - 1;

  while (low < high) {
    const middle: number = Math.ceil((low + high) / 2);

    if (lineStarts[middle]! <= offset) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }

  return low + 1;
}

function readBlock(
  source: string,
  start: number,
  end: number,
  lineStarts: Array<number>,
  firstLine: number,
  rules: Array<CssStyleRule>,
): void {
  let preludeStart: number = start;
  let index: number = start;

  while (index < end) {
    const character: string = source[index]!;

    if (character === '"' || character === "'") {
      index = skipQuoted(source, index);
      continue;
    }

    // The end of a statement (@import ...;) or an unbalanced brace.
    if (character === ";" || character === "}") {
      index++;
      preludeStart = index;
      continue;
    }

    if (character !== "{") {
      index++;
      continue;
    }

    const close: number = findClosingBrace(source, index, end);
    const prelude: string = source.slice(preludeStart, index);
    const selectorText: string = normalizeWhitespace(prelude);

    if (selectorText.startsWith("@")) {
      const atRuleName: string = (
        AT_RULE_NAME.exec(selectorText)?.[1] || ""
      ).toLowerCase();

      if (GROUPING_AT_RULES.has(atRuleName)) {
        readBlock(source, index + 1, close, lineStarts, firstLine, rules);
      }
    } else if (selectorText) {
      const selectorOffset: number =
        preludeStart + (prelude.length - prelude.trimStart().length);

      rules.push({
        selectors: splitTopLevel(selectorText, ",").map(normalizeWhitespace),
        declarations: parseDeclarations(source.slice(index + 1, close)),
        line: firstLine - 1 + lineAt(lineStarts, selectorOffset),
      });
    }

    index = close + 1;
    preludeStart = index;
  }
}

/*
 * Every style rule in a stylesheet, including those inside @media, @supports
 * and the other grouping at-rules. `firstLine` is the line the stylesheet
 * starts on in its file, so a <style> block or a string literal reports the
 * file's own line numbers.
 *
 * Deliberately not jsdom's CSS engine: it drops what it cannot model (it does
 * not know ::backdrop at all), and a dropped rule and a clean one would look
 * the same to the guard.
 */
export function parseCssStyleRules(
  css: string,
  firstLine: number = 1,
): Array<CssStyleRule> {
  const source: string = blankCssComments(css);
  const rules: Array<CssStyleRule> = [];

  readBlock(source, 0, source.length, lineStartsOf(source), firstLine, rules);

  return rules;
}

/*
 * For each ::backdrop in a selector, the compound selector it hangs off: the
 * element whose backdrop it is. `html.dark ::backdrop` hangs off an empty
 * compound - any element at all - and `html.dark :fullscreen::backdrop` off
 * `:fullscreen`.
 */
export function backdropOriginsOf(selector: string): Array<string> {
  const origins: Array<string> = [];

  for (const match of selector.matchAll(BACKDROP_PSEUDO_ELEMENT)) {
    const backdropAt: number = match.index || 0;
    let start: number = backdropAt;
    let depth: number = 0;

    while (start > 0) {
      const character: string = selector[start - 1]!;
      const isEscaped: boolean = selector[start - 2] === "\\";

      if (!isEscaped && (character === ")" || character === "]")) {
        depth++;
      } else if (!isEscaped && (character === "(" || character === "[")) {
        depth--;
      } else if (
        depth === 0 &&
        !isEscaped &&
        (WHITESPACE.test(character) ||
          character === ">" ||
          character === "+" ||
          character === "~")
      ) {
        break;
      }

      start--;
    }

    origins.push(selector.slice(start, backdropAt));
  }

  return origins;
}

/*
 * Whether a backdrop's element is pinned down as one of ours. An attribute
 * selector ([popover]) or a functional pseudo-class (:not(.ours), :is(...))
 * says nothing about whose element it is, so both are read past.
 */
export function isOwnedBackdropOrigin(origin: string): boolean {
  let bare: string = origin;
  let previous: string = "";

  while (bare !== previous) {
    previous = bare;
    bare = bare.replace(/\([^()]*\)/g, "").replace(/\[[^[\]]*\]/g, "");
  }

  return FULLSCREEN_PSEUDO_CLASS.test(bare) || CLASS_OR_ID_SELECTOR.test(bare);
}

export function isUnscopedBackdropSelector(selector: string): boolean {
  return backdropOriginsOf(selector).some((origin: string): boolean => {
    return !isOwnedBackdropOrigin(origin);
  });
}

export function paintingPropertiesOf(rule: CssStyleRule): Array<string> {
  return rule.declarations
    .filter((declaration: CssDeclaration): boolean => {
      return !declaration.property.startsWith("--");
    })
    .map((declaration: CssDeclaration): string => {
      return declaration.property;
    });
}

// EJS tags blanked to spaces, newlines kept: they are template code, not CSS.
export function maskEjsTags(source: string): string {
  return source.replace(/<%[\s\S]*?%>/g, (tag: string): string => {
    return tag.replace(/[^\n]/g, " ");
  });
}

function styleBlocksOf(markup: string): Array<EmbeddedStyleSheet> {
  const sheets: Array<EmbeddedStyleSheet> = [];
  const lineStarts: Array<number> = lineStartsOf(markup);

  for (const match of markup.matchAll(
    /(<style\b[^>]*>)([\s\S]*?)<\/style\s*>/gi,
  )) {
    const contentAt: number = (match.index || 0) + match[1]!.length;

    sheets.push({
      css: match[2]!,
      line: lineAt(lineStarts, contentAt),
    });
  }

  return sheets;
}

function stringLiteralsMentioningBackdrop(
  fileName: string,
  source: string,
): Array<EmbeddedStyleSheet> {
  const sheets: Array<EmbeddedStyleSheet> = [];
  const sourceFile: ts.SourceFile = ts.createSourceFile(
    fileName,
    source,
    ts.ScriptTarget.Latest,
    true,
    fileName.toLowerCase().endsWith(".tsx")
      ? ts.ScriptKind.TSX
      : ts.ScriptKind.TS,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let text: string | null = null;

    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
      text = node.text;
    } else if (ts.isTemplateExpression(node)) {
      text =
        node.head.text +
        node.templateSpans
          .map((span: ts.TemplateSpan): string => {
            return SUBSTITUTION_PLACEHOLDER + span.literal.text;
          })
          .join("");
    }

    if (text !== null && MENTIONS_BACKDROP.test(text)) {
      sheets.push({
        css: text,
        line:
          sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
            .line + 1,
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return sheets;
}

/*
 * The CSS a file carries: all of a stylesheet, the <style> blocks of a view,
 * and the string literals of a module that mention a backdrop.
 */
export function styleSheetsIn(
  fileName: string,
  source: string,
): Array<EmbeddedStyleSheet> {
  if (STYLESHEET_FILE.test(fileName)) {
    return [{ css: source, line: 1 }];
  }

  if (MARKUP_FILE.test(fileName)) {
    return styleBlocksOf(maskEjsTags(source));
  }

  if (MODULE_FILE.test(fileName) && !fileName.endsWith(".d.ts")) {
    return stringLiteralsMentioningBackdrop(fileName, source);
  }

  return [];
}

// Classifies every backdrop rule in one file's source.
export function analyzeSource(
  file: string,
  source: string,
): BackdropRuleVerdicts {
  const verdicts: BackdropRuleVerdicts = {
    findings: [],
    scopedRules: [],
    paintFreeRules: [],
  };

  if (!MENTIONS_BACKDROP.test(source)) {
    return verdicts;
  }

  for (const sheet of styleSheetsIn(file, source)) {
    for (const rule of parseCssStyleRules(sheet.css, sheet.line)) {
      const properties: Array<string> = paintingPropertiesOf(rule);

      for (const selector of rule.selectors) {
        if (backdropOriginsOf(selector).length === 0) {
          continue;
        }

        const backdropRule: BackdropRule = {
          file: file,
          line: rule.line,
          selector: selector,
        };

        if (!isUnscopedBackdropSelector(selector)) {
          verdicts.scopedRules.push(backdropRule);
        } else if (properties.length === 0) {
          verdicts.paintFreeRules.push(backdropRule);
        } else {
          verdicts.findings.push({ ...backdropRule, properties: properties });
        }
      }
    }
  }

  return verdicts;
}

function isDirectory(directory: string): boolean {
  try {
    return fs.statSync(directory).isDirectory();
  } catch {
    return false;
  }
}

function childDirectoriesOf(parent: string): Array<string> {
  if (!isDirectory(parent)) {
    return [];
  }

  return fs
    .readdirSync(parent, { withFileTypes: true })
    .map((entry: fs.Dirent): string => {
      return path.join(parent, entry.name);
    })
    .filter(isDirectory)
    .sort();
}

/*
 * Where the frontends' styles come from: every feature set whole (its src,
 * views, public pages and static assets), Common/UI, Common's server views,
 * the website, and the Enterprise screens when ee/ is in the checkout.
 */
export function listStyleRoots(repositoryRoot: string): Array<string> {
  const roots: Array<string> = childDirectoriesOf(
    path.join(repositoryRoot, "packages", "App", "FeatureSet"),
  );

  roots.push(path.join(repositoryRoot, "packages", "Common", "UI"));

  for (const serverViews of childDirectoriesOf(
    path.join(repositoryRoot, "packages", "Common", "Server"),
  )) {
    if (path.basename(serverViews).toLowerCase() === "views") {
      roots.push(serverViews);
    }
  }

  roots.push(path.join(repositoryRoot, "packages", "Home"));

  for (const enterpriseScreen of ["Dashboard", "AdminDashboard"]) {
    roots.push(path.join(repositoryRoot, "ee", enterpriseScreen));
  }

  const seen: Set<string> = new Set<string>();

  return roots.filter((root: string): boolean => {
    if (!isDirectory(root)) {
      return false;
    }

    const realPath: string = fs.realpathSync(root);

    if (seen.has(realPath)) {
      return false;
    }

    seen.add(realPath);
    return true;
  });
}

// Every stylesheet, view and module under a directory.
export function listStyleSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!isDirectory(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) {
        found.push(...listStyleSourceFiles(fullPath));
      }
      continue;
    }

    if (
      entry.isFile() &&
      (STYLESHEET_FILE.test(entry.name) ||
        MARKUP_FILE.test(entry.name) ||
        (MODULE_FILE.test(entry.name) && !entry.name.endsWith(".d.ts")))
    ) {
      found.push(fullPath);
    }
  }

  return found;
}

export function scanFiles(
  files: Array<string>,
  repositoryRoot: string,
): TopLayerBackdropScan {
  const scan: TopLayerBackdropScan = {
    files: [],
    findings: [],
    scopedRules: [],
    paintFreeRules: [],
  };

  for (const file of files) {
    const relative: string = toRelativePath(repositoryRoot, file);
    const verdicts: BackdropRuleVerdicts = analyzeSource(
      relative,
      fs.readFileSync(file, "utf8"),
    );

    scan.files.push(relative);
    scan.findings.push(...verdicts.findings);
    scan.scopedRules.push(...verdicts.scopedRules);
    scan.paintFreeRules.push(...verdicts.paintFreeRules);
  }

  return scan;
}

export function formatFindings(
  findings: Array<UnscopedBackdropFinding>,
): string {
  if (findings.length === 0) {
    return "";
  }

  return [
    `${findings.length} stylesheet rule(s) paint the ::backdrop of top-layer elements the app does not own:`,
    "",
    ...findings.map((finding: UnscopedBackdropFinding): string => {
      return `  ${finding.file}:${finding.line}  ${finding.selector} { ${finding.properties.join("; ")} }`;
    }),
    "",
    WHY_PARAGRAPH,
  ].join("\n");
}
