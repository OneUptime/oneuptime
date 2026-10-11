import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The detector behind the tag-strip guards: which files are test code, and
 * where one takes markup out of a text with a pattern of its own instead of
 * reading it through removeHtmlMarkup (Common/Types/HtmlMarkup) or a reading
 * of Tests/Helpers/HtmlText. Two suites run it:
 *
 *   - packages/Common/Tests/Helpers/TestTagStripGuard.test.ts reads every
 *     test file of the checkout; its header says what it fails on, what it
 *     passes and why. It runs in the Common Test job, which removes ee/
 *     first: core has to pass without the Enterprise Edition.
 *   - ee/Tests/Server/TestTagStripGuard.test.ts reads ee/'s test files from
 *     ee's own jest run - the Enterprise Edition Test job, the only one with
 *     ee/ checked out - so an ee/ test cannot copy a tag strip past core's
 *     guard.
 *
 * So both read with one detector, it lives here, under Common/Tests, where
 * ee's suite reaches it through the "Common/..." specifier. It imports
 * nothing but node's fs and path and the TypeScript parser: nothing of App's,
 * and core never imports ee/.
 */

// The repository's root, found from this file's place in it.
export const REPOSITORY_DIRECTORY: string = path.resolve(
  __dirname,
  "../../../..",
);

const TEST_FOLDER_NAMES: ReadonlySet<string> = new Set<string>([
  "Tests",
  "tests",
  "__tests__",
]);
// Folders of dependencies and builds, never test code of the repository's.
const SKIPPED_FOLDER_NAMES: ReadonlySet<string> = new Set<string>([
  "node_modules",
  "build",
  "dist",
]);
// A package of nothing but tests: its fixtures and helpers are test code too.
const TEST_PACKAGE: string = "packages/E2E/";
const CODE_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
export const TEST_FILE: RegExp = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

export type IsTestCodeFunction = (relativePath: string) => boolean;

/*
 * Whether a file, by its path from the repository's root ("/" between
 * folders), is test code the guard reads.
 */
export const isTestCode: IsTestCodeFunction = (
  relativePath: string,
): boolean => {
  const parts: Array<string> = relativePath.split("/");
  const fileName: string = parts[parts.length - 1]!;
  const folders: Array<string> = parts.slice(0, -1);

  if (
    !CODE_FILE.test(fileName) ||
    DECLARATION_FILE.test(fileName) ||
    folders.some((folder: string): boolean => {
      return folder.startsWith(".") || SKIPPED_FOLDER_NAMES.has(folder);
    })
  ) {
    return false;
  }

  return (
    TEST_FILE.test(fileName) ||
    relativePath.startsWith(TEST_PACKAGE) ||
    folders.some((folder: string): boolean => {
      return TEST_FOLDER_NAMES.has(folder);
    })
  );
};

export type ListTestFilesFunction = (
  directory: string,
  root?: string,
) => Array<string>;

/*
 * Every test file under a directory, by its path from the root ("/" between
 * folders) - the repository's root unless another is given. A walk of one
 * folder (ee/) names its files exactly as the walk of the whole repository
 * does ("ee/Tests/..."), and a test can walk a tree it wrote elsewhere.
 */
export const listTestFiles: ListTestFilesFunction = (
  directory: string,
  root: string = REPOSITORY_DIRECTORY,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_FOLDER_NAMES.has(entry.name)) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTestFiles(fullPath, root));
      continue;
    }

    const relativePath: string = path
      .relative(root, fullPath)
      .split(path.sep)
      .join("/");

    if (entry.isFile() && isTestCode(relativePath)) {
      files.push(relativePath);
    }
  }

  return files.sort();
};

// Markup a tag strip takes out whole: what code scanning asks about.
const MARKUP_PROBES: Array<string> = [
  "<script>",
  '<script src="x.js">',
  "</script>",
  "<iframe src=x>",
  "<style>",
  "<!-- note -->",
];

// Words after the markup, which a tag strip leaves where they are.
const TEXT_AFTER_MARKUP: string = " and the words after it";

export type StripsMarkupFunction = (pattern: RegExp) => boolean;

/*
 * Whether a pattern takes markup out of a text: on one of the probes, with
 * words after it, the first thing it matches starts at the "<", is more than
 * the "<" alone, and stops before the words run out; and the same text
 * without its "<" gives it nothing to match at the start. So a pattern of
 * single characters ("[<>]", "<+"), one of any text that the "<" does not
 * decide ("[^a-z0-9]+", a slug), one that runs to the end of the text
 * ("<.*$"), one anchored to an end, and one for an element and all it holds
 * ("<svg[\s\S]*?</svg>") are not tag strips.
 */
export const stripsMarkup: StripsMarkupFunction = (
  pattern: RegExp,
): boolean => {
  return MARKUP_PROBES.some((probe: string): boolean => {
    const text: string = probe + TEXT_AFTER_MARKUP;
    const match: RegExpExecArray | null = pattern.exec(text);

    if (
      match === null ||
      match.index !== 0 ||
      match[0].length < 2 ||
      match[0].length >= text.length
    ) {
      return false;
    }

    const withoutOpening: RegExpExecArray | null = pattern.exec(text.slice(1));

    return withoutOpening === null || withoutOpening.index !== 0;
  });
};

type BuildPatternFunction = (source: string, flags: string) => RegExp | null;

// A pattern as it runs, or null when the runtime cannot build it.
const buildPattern: BuildPatternFunction = (
  source: string,
  flags: string,
): RegExp | null => {
  try {
    // Without g or y, exec() always reads from the start.
    return new RegExp(
      source,
      Array.from(flags)
        .filter((flag: string): boolean => {
          return flag !== "g" && flag !== "y";
        })
        .join(""),
    );
  } catch {
    return null;
  }
};

type ParseFunction = (fileName: string, text: string) => ts.SourceFile;

const parse: ParseFunction = (
  fileName: string,
  text: string,
): ts.SourceFile => {
  let kind: ts.ScriptKind = ts.ScriptKind.TS;

  if (fileName.endsWith(".tsx")) {
    kind = ts.ScriptKind.TSX;
  } else if (fileName.endsWith(".jsx")) {
    kind = ts.ScriptKind.JSX;
  } else if (!fileName.endsWith(".ts")) {
    kind = ts.ScriptKind.JS;
  }

  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    kind,
  );
};

type VisitFunction = (node: ts.Node, onNode: (node: ts.Node) => void) => void;

const visit: VisitFunction = (
  node: ts.Node,
  onNode: (node: ts.Node) => void,
): void => {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
};

type NamedPatterns = Map<string, RegExp>;

type PatternOfFunction = (
  node: ts.Expression,
  named: NamedPatterns,
) => RegExp | null;

/*
 * The pattern an expression gives: a /literal/, new RegExp("...", "...") or
 * new RegExp(OTHER.source, "..."), or a name for one - a constant, or a
 * class's static field read as Class.FIELD.
 */
const patternOf: PatternOfFunction = (
  node: ts.Expression,
  named: NamedPatterns,
): RegExp | null => {
  if (ts.isParenthesizedExpression(node)) {
    return patternOf(node.expression, named);
  }

  if (ts.isRegularExpressionLiteral(node)) {
    const lastSlash: number = node.text.lastIndexOf("/");

    return buildPattern(
      node.text.slice(1, lastSlash),
      node.text.slice(lastSlash + 1),
    );
  }

  if (ts.isIdentifier(node)) {
    return named.get(node.text) || null;
  }

  if (ts.isPropertyAccessExpression(node)) {
    return named.get(node.name.text) || null;
  }

  if (
    (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "RegExp" &&
    node.arguments !== undefined &&
    node.arguments.length > 0
  ) {
    const sourceArgument: ts.Expression = node.arguments[0]!;
    const flagsArgument: ts.Expression | undefined = node.arguments[1];
    let source: string | null = null;

    if (ts.isStringLiteralLike(sourceArgument)) {
      source = sourceArgument.text;
    } else if (
      ts.isPropertyAccessExpression(sourceArgument) &&
      sourceArgument.name.text === "source"
    ) {
      source = patternOf(sourceArgument.expression, named)?.source ?? null;
    }

    if (source === null) {
      return null;
    }

    return buildPattern(
      source,
      flagsArgument && ts.isStringLiteralLike(flagsArgument)
        ? flagsArgument.text
        : "",
    );
  }

  return null;
};

type NamedPatternsOfFunction = (source: ts.SourceFile) => NamedPatterns;

/*
 * The patterns a file names - const TAG: RegExp = /<[^>]*>/g, a class's
 * static field, one built from another's .source - read again until no new
 * name turns up, so the order they are written in does not matter.
 */
const namedPatternsOf: NamedPatternsOfFunction = (
  source: ts.SourceFile,
): NamedPatterns => {
  const named: NamedPatterns = new Map<string, RegExp>();

  // One reading of the file: whether it named a pattern not named before.
  const readOnce: () => boolean = (): boolean => {
    let isGrowing: boolean = false;

    visit(source, (node: ts.Node) => {
      if (
        (ts.isVariableDeclaration(node) || ts.isPropertyDeclaration(node)) &&
        ts.isIdentifier(node.name) &&
        node.initializer &&
        !named.has(node.name.text)
      ) {
        const pattern: RegExp | null = patternOf(node.initializer, named);

        if (pattern) {
          named.set(node.name.text, pattern);
          isGrowing = true;
        }
      }
    });

    return isGrowing;
  };

  let isGrowing: boolean = readOnce();

  while (isGrowing) {
    isGrowing = readOnce();
  }

  return named;
};

const STRIP_CALLS: ReadonlyArray<string> = ["replace", "replaceAll"];
const WHITESPACE_RUN: RegExp = /\s+/g;

type WritesMarkupBackFunction = (call: ts.CallExpression) => boolean;

/*
 * Whether a replace writes a "<" back where it matched: an escape, such as
 * "</script" made "<\/script" inside a script, which takes no markup out.
 */
const writesMarkupBack: WritesMarkupBackFunction = (
  call: ts.CallExpression,
): boolean => {
  const replacement: ts.Expression | undefined = call.arguments[1];

  return (
    replacement !== undefined &&
    ts.isStringLiteralLike(replacement) &&
    replacement.text.includes("<")
  );
};

export interface TagStrip {
  line: number;
  code: string;
}

export type FindTagStripsFunction = (
  fileName: string,
  text: string,
) => Array<TagStrip>;

// Every place a file takes markup out with a pattern of its own.
export const findTagStrips: FindTagStripsFunction = (
  fileName: string,
  text: string,
): Array<TagStrip> => {
  const source: ts.SourceFile = parse(fileName, text);
  const named: NamedPatterns = namedPatternsOf(source);
  const strips: Array<TagStrip> = [];

  const found: (node: ts.Node) => void = (node: ts.Node): void => {
    strips.push({
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      code: node.getText(source).replace(WHITESPACE_RUN, " ").slice(0, 100),
    });
  };

  const stripsWith: (call: ts.CallExpression) => boolean = (
    call: ts.CallExpression,
  ): boolean => {
    const argument: ts.Expression | undefined = call.arguments[0];
    const pattern: RegExp | null = argument ? patternOf(argument, named) : null;

    return pattern !== null && stripsMarkup(pattern);
  };

  visit(source, (node: ts.Node) => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression)
    ) {
      return;
    }

    const method: string = node.expression.name.text;

    if (
      STRIP_CALLS.includes(method) &&
      stripsWith(node) &&
      !writesMarkupBack(node)
    ) {
      found(node);
      return;
    }

    // text.split(TAG).join(""): the pieces between the tags, put back together.
    const receiver: ts.Expression = node.expression.expression;

    if (
      method === "join" &&
      ts.isCallExpression(receiver) &&
      ts.isPropertyAccessExpression(receiver.expression) &&
      receiver.expression.name.text === "split" &&
      stripsWith(receiver)
    ) {
      found(node);
    }
  });

  return strips;
};

// What a test file that takes markup out reads it through instead.
export const TAG_STRIP_FIX: string =
  "read the text with removeHtmlMarkup (Common/Types/HtmlMarkup) or a reading of Common/Tests/Helpers/HtmlText";

export type ReportTagStripsFunction = (
  files: ReadonlyArray<string>,
  root?: string,
) => Array<string>;

/*
 * Every tag strip in the given files - paths from the root, as listTestFiles
 * names them - one line each: "path:line code - what to read it with
 * instead". A guard expects none, and jest prints the lines it got, so a
 * failure names each file and line along with the fix.
 */
export const reportTagStrips: ReportTagStripsFunction = (
  files: ReadonlyArray<string>,
  root: string = REPOSITORY_DIRECTORY,
): Array<string> => {
  const findings: Array<string> = [];

  for (const file of files) {
    const text: string = fs.readFileSync(path.join(root, file), "utf8");

    // A file that calls neither replace nor split takes nothing out.
    if (!text.includes("replace") && !text.includes("split")) {
      continue;
    }

    for (const strip of findTagStrips(file, text)) {
      findings.push(`${file}:${strip.line} ${strip.code} - ${TAG_STRIP_FIX}`);
    }
  }

  return findings;
};

export type ImportedNamesFunction = (
  fileName: string,
  text: string,
) => Array<string>;

// The names a file imports.
export const importedNames: ImportedNamesFunction = (
  fileName: string,
  text: string,
): Array<string> => {
  const names: Array<string> = [];

  for (const statement of parse(fileName, text).statements) {
    if (!ts.isImportDeclaration(statement) || !statement.importClause) {
      continue;
    }

    const clause: ts.ImportClause = statement.importClause;

    if (clause.name) {
      names.push(clause.name.text);
    }

    if (clause.namedBindings && ts.isNamedImports(clause.namedBindings)) {
      for (const element of clause.namedBindings.elements) {
        names.push(element.name.text);
      }
    }
  }

  return names;
};

export type ImportedModulesFunction = (
  fileName: string,
  text: string,
) => Array<string>;

// The modules a file imports or re-exports from.
export const importedModules: ImportedModulesFunction = (
  fileName: string,
  text: string,
): Array<string> => {
  const modules: Array<string> = [];

  for (const statement of parse(fileName, text).statements) {
    if (
      (ts.isImportDeclaration(statement) ||
        ts.isExportDeclaration(statement)) &&
      statement.moduleSpecifier &&
      ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      modules.push(statement.moduleSpecifier.text);
    }
  }

  return modules;
};
