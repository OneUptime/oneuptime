import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * The docs tests take tags out of rendered HTML in one place: stripHtmlTags
 * (DocsHtmlText.ts). Five translation suites each copied strayMarkers, and
 * with it `line.replace(/<[^>]*>/g, "")`; code scanning opened an alert on
 * every copy (js/incomplete-multi-character-sanitization, #2203, #2207,
 * #2208, #2209). This guard reads every TypeScript file in this folder and
 * fails on:
 *
 *   1. a strayMarkers declared anywhere but DocsTranslationChecks.ts: a
 *      suite imports that one;
 *   2. a replace or replaceAll whose pattern is a regular expression that
 *      takes out any HTML tag or comment - one that matches "<script>",
 *      "<iframe>", "<style>" or "<!-- -->", the markup code scanning asks
 *      about - written in place, held in a constant of the file or built
 *      with new RegExp, whatever it is replaced with and whether or not it
 *      runs in a loop. Read such text with stripHtmlTags instead.
 *
 * A pattern for one element and what it holds, such as the code samples
 * strayMarkers leaves out (<pre>...</pre>), is not a tag strip and passes.
 */

const DOCS_TESTS_DIR: string = __dirname;
const STRAY_MARKERS_HOME: string = "DocsTranslationChecks.ts";
const STRAY_MARKERS: string = "strayMarkers";
const SHARED_CHECKS_MODULE: string = "./DocsTranslationChecks";
const STRIP_CALLS: Array<string> = ["replace", "replaceAll"];

/*
 * Markup that a pattern stripping tags or comments matches: the strings code
 * scanning's incomplete multi-character sanitization query reasons about.
 */
const MARKUP_PROBES: Array<string> = [
  "<script>",
  '<script src="x.js">',
  "</script>",
  "<iframe src=x>",
  "<style>",
  "<!-- note -->",
];

const WHITESPACE_RUN: RegExp = /\s+/g;

type Problem = "tag strip" | "own strayMarkers";

interface Finding {
  file: string;
  line: number;
  problem: Problem;
  code: string;
}

// What each problem asks for instead.
const FIXES: Record<Problem, string> = {
  "tag strip": "read the text with stripHtmlTags from ./DocsHtmlText",
  "own strayMarkers": "import strayMarkers from ./DocsTranslationChecks",
};

function listTypeScriptFiles(directory: string): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith(".d.ts")) {
      files.push(fullPath);
    }
  }

  return files.sort();
}

function parse(fileName: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

// A pattern as it runs, or null when the runtime cannot build it.
function buildPattern(source: string, flags: string): RegExp | null {
  try {
    // Without g or y, test() always reads from the start.
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
}

// The pattern an expression writes: a /literal/ or new RegExp("...", "...").
function patternOf(node: ts.Expression): RegExp | null {
  if (ts.isParenthesizedExpression(node)) {
    return patternOf(node.expression);
  }

  if (ts.isRegularExpressionLiteral(node)) {
    const lastSlash: number = node.text.lastIndexOf("/");

    return buildPattern(
      node.text.slice(1, lastSlash),
      node.text.slice(lastSlash + 1),
    );
  }

  if (
    ts.isNewExpression(node) &&
    ts.isIdentifier(node.expression) &&
    node.expression.text === "RegExp" &&
    node.arguments !== undefined &&
    node.arguments.length > 0 &&
    ts.isStringLiteralLike(node.arguments[0] as ts.Expression)
  ) {
    const flags: ts.Expression | undefined = node.arguments[1];

    return buildPattern(
      (node.arguments[0] as ts.StringLiteralLike).text,
      flags && ts.isStringLiteralLike(flags) ? flags.text : "",
    );
  }

  return null;
}

/*
 * Whether a pattern takes out markup: on one of the probes, the first thing
 * it matches starts at the "<" and goes on past it. A pattern of single
 * characters ("[<>]", "\s+") or of other text matches no probe that way.
 */
function stripsMarkup(pattern: RegExp): boolean {
  return MARKUP_PROBES.some((probe: string): boolean => {
    const match: RegExpExecArray | null = pattern.exec(probe);

    return match !== null && match.index === 0 && match[0].length > 1;
  });
}

function declaresStrayMarkers(node: ts.Node): boolean {
  return (
    (ts.isFunctionDeclaration(node) || ts.isVariableDeclaration(node)) &&
    node.name !== undefined &&
    ts.isIdentifier(node.name) &&
    node.name.text === STRAY_MARKERS
  );
}

/*
 * What a file of this folder does that the docs tests leave to the shared
 * helpers. `fileName` is its name in the folder, `text` its source.
 */
function findTagStrips(fileName: string, text: string): Array<Finding> {
  const source: ts.SourceFile = parse(fileName, text);
  const findings: Array<Finding> = [];
  const constants: Map<string, RegExp> = new Map();

  const found: (node: ts.Node, problem: Problem) => Finding = (
    node: ts.Node,
    problem: Problem,
  ): Finding => {
    return {
      file: fileName,
      line:
        source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
      problem: problem,
      code: node.getText(source).replace(WHITESPACE_RUN, " ").slice(0, 80),
    };
  };

  // The patterns the file names, as in const HTML_TAG: RegExp = /<[^>]*>/g.
  visit(source, (node: ts.Node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.initializer
    ) {
      const pattern: RegExp | null = patternOf(node.initializer);

      if (pattern) {
        constants.set(node.name.text, pattern);
      }
    }
  });

  visit(source, (node: ts.Node) => {
    if (declaresStrayMarkers(node) && fileName !== STRAY_MARKERS_HOME) {
      findings.push(found(node, "own strayMarkers"));
    }

    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !STRIP_CALLS.includes(node.expression.name.text) ||
      node.arguments.length === 0
    ) {
      return;
    }

    const argument: ts.Expression = node.arguments[0] as ts.Expression;
    const pattern: RegExp | null = ts.isIdentifier(argument)
      ? constants.get(argument.text) || null
      : patternOf(argument);

    if (pattern && stripsMarkup(pattern)) {
      findings.push(found(node, "tag strip"));
    }
  });

  return findings;
}

// Whether a file calls strayMarkers.
function callsStrayMarkers(source: ts.SourceFile): boolean {
  let calls: boolean = false;

  visit(source, (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === STRAY_MARKERS
    ) {
      calls = true;
    }
  });

  return calls;
}

// Whether a file imports strayMarkers from the shared module.
function importsSharedStrayMarkers(source: ts.SourceFile): boolean {
  return source.statements.some((statement: ts.Statement): boolean => {
    if (
      !ts.isImportDeclaration(statement) ||
      !ts.isStringLiteral(statement.moduleSpecifier) ||
      statement.moduleSpecifier.text !== SHARED_CHECKS_MODULE
    ) {
      return false;
    }

    const bindings: ts.NamedImportBindings | undefined =
      statement.importClause?.namedBindings;

    return (
      bindings !== undefined &&
      ts.isNamedImports(bindings) &&
      bindings.elements.some((element: ts.ImportSpecifier): boolean => {
        return element.name.text === STRAY_MARKERS;
      })
    );
  });
}

// Lines of TypeScript, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

describe("the docs tests strip tags only through stripHtmlTags", () => {
  const files: Array<string> = listTypeScriptFiles(DOCS_TESTS_DIR);

  const nameOf: (file: string) => string = (file: string): string => {
    return path.relative(DOCS_TESTS_DIR, file).split(path.sep).join("/");
  };

  it("reads every TypeScript file of the docs tests", () => {
    const names: Array<string> = files.map(nameOf);

    expect(names.length).toBeGreaterThan(200);
    expect(names).toEqual(
      expect.arrayContaining([
        "DocsHtmlText.ts",
        "DocsTranslationChecks.ts",
        "DocsContentRules.ts",
        "ProbeMonitorDocsTranslations.test.ts",
        "MonitorChecksDocsTranslations.test.ts",
        "ScriptAndInboundMonitorDocsTranslations.test.ts",
        "InfrastructureMonitorDocsTranslations.test.ts",
        "TelemetryDocsTranslations.test.ts",
      ]),
    );
  });

  it("finds no tag strip and no strayMarkers of a file's own", () => {
    const findings: Array<string> = [];

    for (const file of files) {
      for (const finding of findTagStrips(
        nameOf(file),
        fs.readFileSync(file, "utf8"),
      )) {
        findings.push(
          `${finding.file}:${finding.line} ${finding.code} - ${FIXES[finding.problem]}`,
        );
      }
    }

    expect(findings).toEqual([]);
  });

  it("has every file that checks stray markers import the shared strayMarkers", () => {
    const callers: Array<string> = [];
    const copies: Array<string> = [];

    for (const file of files) {
      const name: string = nameOf(file);
      const source: ts.SourceFile = parse(name, fs.readFileSync(file, "utf8"));

      if (name === STRAY_MARKERS_HOME || !callsStrayMarkers(source)) {
        continue;
      }

      callers.push(name);

      if (!importsSharedStrayMarkers(source)) {
        copies.push(name);
      }
    }

    expect(copies).toEqual([]);
    // The five suites that copied it, and the test of the shared one.
    expect(callers).toEqual(
      expect.arrayContaining([
        "DocsStrayMarkers.test.ts",
        "ProbeMonitorDocsTranslations.test.ts",
        "MonitorChecksDocsTranslations.test.ts",
        "ScriptAndInboundMonitorDocsTranslations.test.ts",
        "InfrastructureMonitorDocsTranslations.test.ts",
        "TelemetryDocsTranslations.test.ts",
      ]),
    );
  });
});

describe("findTagStrips, on files written here", () => {
  const problemsOf: (text: string, fileName?: string) => Array<string> = (
    text: string,
    fileName: string = "SomeDocsTranslations.test.ts",
  ): Array<string> => {
    return findTagStrips(fileName, text).map((finding: Finding): string => {
      return `${finding.line}: ${finding.problem}`;
    });
  };

  it("finds the copied tag strip: a constant, then a replace with it", () => {
    const findings: Array<Finding> = findTagStrips(
      "SomeDocsTranslations.test.ts",
      code(
        "const HTML_TAG: RegExp = /<[^>]*>/g;",
        "lines.map((line: string): string => {",
        '  return line.replace(HTML_TAG, "");',
        "});",
      ),
    );

    expect(findings).toEqual([
      {
        file: "SomeDocsTranslations.test.ts",
        line: 3,
        problem: "tag strip",
        code: 'line.replace(HTML_TAG, "")',
      },
    ]);
  });

  it.each([
    ["a pattern written in place", 'text.replace(/<[^>]+>/g, "");'],
    ["replaceAll", 'text.replaceAll(/<[^>]*>/g, "");'],
    ["a replacement that is not empty", 'text.replace(/<[^>]*>/g, " ");'],
    ["a callback", 'text.replace(/<[^>]*>/g, (): string => { return ""; });'],
    ["new RegExp", 'text.replace(new RegExp("<[^>]*>", "g"), "");'],
    ["an end-tag-aware pattern", 'text.replace(/<\\/?[a-z][^>]*>/gi, "");'],
    ["a comment strip", 'text.replace(/<!--[\\s\\S]*?-->/g, "");'],
    ["a pattern in parentheses", 'text.replace((/<[^>]*>/g), "");'],
  ])("finds %s", (_shape: string, line: string) => {
    expect(problemsOf(line)).toEqual(["1: tag strip"]);
  });

  it("finds a tag strip repeated until nothing changes", () => {
    expect(
      problemsOf(
        code(
          "const TAG: RegExp = new RegExp('<[^>]*>', 'g');",
          "let text: string = html;",
          "let before: string = '';",
          "while (text !== before) {",
          "  before = text;",
          "  text = text.replace(TAG, '');",
          "}",
        ),
      ),
    ).toEqual(["6: tag strip"]);
  });

  it("finds a strayMarkers of a file's own, written either way", () => {
    expect(
      problemsOf(
        code(
          "async function strayMarkers(markdown: string): Promise<Array<string>> {",
          "  return [];",
          "}",
        ),
      ),
    ).toEqual(["1: own strayMarkers"]);
    expect(
      problemsOf(
        "const strayMarkers: () => Array<string> = (): Array<string> => { return []; };",
      ),
    ).toEqual(["1: own strayMarkers"]);
    // Its home declares it.
    expect(
      problemsOf(
        "export async function strayMarkers(): Promise<Array<string>> { return []; }",
        STRAY_MARKERS_HOME,
      ),
    ).toEqual([]);
  });

  it("passes what is not a tag strip", () => {
    expect(
      problemsOf(
        code(
          // The code samples strayMarkers leaves out, with what they hold.
          "const RENDERED_CODE: RegExp = /<pre[\\s\\S]*?<\\/pre>|<code[\\s\\S]*?<\\/code>/g;",
          'html.replace(RENDERED_CODE, "");',
          // Reading markup is not taking it out.
          "html.matchAll(/<a\\b[^>]*>/g);",
          "const TAG: RegExp = /<[^>]*>/;",
          "TAG.test(html);",
          "html.match(TAG);",
          "html.split(TAG);",
          // A string pattern, and patterns of no markup at all.
          'html.replace("<", "");',
          'line.replace(/\\*\\*/g, "");',
          'line.replace(/[A-Za-z0-9]+(?:_[A-Za-z0-9]+)+/g, "");',
          // The shared helper.
          "stripHtmlTags(html);",
          // A pattern the runtime cannot build is passed over, not thrown on.
          'html.replace(new RegExp("(", "g"), "");',
        ),
      ),
    ).toEqual([]);
  });

  it("tells a suite that calls strayMarkers whether it imports the shared one", () => {
    const shared: ts.SourceFile = parse(
      "Shared.test.ts",
      code(
        'import { prose, strayMarkers } from "./DocsTranslationChecks";',
        'strayMarkers("# Title", "en");',
      ),
    );
    const elsewhere: ts.SourceFile = parse(
      "Elsewhere.test.ts",
      code(
        'import { strayMarkers } from "./SomeOtherHelpers";',
        'strayMarkers("# Title", "en");',
      ),
    );

    expect(callsStrayMarkers(shared)).toBe(true);
    expect(importsSharedStrayMarkers(shared)).toBe(true);
    expect(callsStrayMarkers(elsewhere)).toBe(true);
    expect(importsSharedStrayMarkers(elsewhere)).toBe(false);
    // Naming it in a string is not calling it.
    expect(
      callsStrayMarkers(parse("Text.test.ts", 'const s: string = "strayMarkers(";')),
    ).toBe(false);
  });
});
