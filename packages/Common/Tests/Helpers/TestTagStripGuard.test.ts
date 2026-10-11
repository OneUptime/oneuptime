import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY TEST READS MARKUP THROUGH THE SHARED WALK.
 *
 * Tests read what OneUptime renders - a note or feed entry through marked, an
 * email through Handlebars, a Telegram message, a docs or API reference page
 * - as the words a person sees, and to do it they took the markup out. They
 * copied a single pass of a tag pattern for that, and code scanning reported
 * 21 of the copies as incomplete multi-character sanitization
 * (js/incomplete-multi-character-sanitization; FIXED_ALERTS below). Each now
 * reads through removeHtmlMarkup (Common/Types/HtmlMarkup) or a reading of
 * Tests/Helpers/HtmlText built on it. This guard reads every test file in
 * the repository and fails on:
 *
 *   1. a replace or replaceAll whose pattern takes a whole HTML tag or
 *      comment out of a text and keeps the text after it - "<script>",
 *      "</script>", "<iframe src=x>", "<!-- note -->", the markup code
 *      scanning asks about - written in place, held in a constant or a
 *      class's static field, built with new RegExp (from a string or another
 *      pattern's .source), whatever it is replaced with - nothing, a space,
 *      a callback - and whether or not it runs in a loop;
 *   2. the same pattern given to split, with the pieces joined back up: the
 *      same single pass, written another way;
 *   3. a file a code scanning alert was raised on that no longer reads its
 *      markup through the shared walk.
 *
 * Not a tag strip, and passed: a pattern for one element and all it holds
 * (an <svg> icon, an email's <style>), one that cuts a text at its first "<"
 * (a component's type arguments: "ModelTable<Incident>"), one that unwraps
 * a text known to start or end with a tag (anchored with ^ or $), and one of
 * single characters.
 *
 * The test files are every file of code under a folder named Tests, tests or
 * __tests__, every *.test.* and *.spec.* file wherever it is, and all of
 * packages/E2E, a package of nothing but tests and their fixtures - outside
 * node_modules, builds and hidden folders.
 */

const REPOSITORY_DIRECTORY: string = path.resolve(__dirname, "../../../..");

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
const TEST_FILE: RegExp = /\.(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

type IsTestCodeFunction = (relativePath: string) => boolean;

/*
 * Whether a file, by its path from the repository's root ("/" between
 * folders), is test code the guard reads.
 */
const isTestCode: IsTestCodeFunction = (relativePath: string): boolean => {
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

type ListTestFilesFunction = (directory: string) => Array<string>;

// Every test file under a directory, by its path from the repository's root.
const listTestFiles: ListTestFilesFunction = (
  directory: string,
): Array<string> => {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIPPED_FOLDER_NAMES.has(entry.name)) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTestFiles(fullPath));
      continue;
    }

    const relativePath: string = path
      .relative(REPOSITORY_DIRECTORY, fullPath)
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

type StripsMarkupFunction = (pattern: RegExp) => boolean;

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
const stripsMarkup: StripsMarkupFunction = (pattern: RegExp): boolean => {
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
  let isGrowing: boolean = true;

  while (isGrowing) {
    isGrowing = false;

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
  }

  return named;
};

const STRIP_CALLS: ReadonlyArray<string> = ["replace", "replaceAll"];
const WHITESPACE_RUN: RegExp = /\s+/g;

interface TagStrip {
  line: number;
  code: string;
}

type FindTagStripsFunction = (
  fileName: string,
  text: string,
) => Array<TagStrip>;

// Every place a file takes markup out with a pattern of its own.
const findTagStrips: FindTagStripsFunction = (
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

    if (STRIP_CALLS.includes(method) && stripsWith(node)) {
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

type ImportedNamesFunction = (fileName: string, text: string) => Array<string>;

// The names a file imports.
const importedNames: ImportedNamesFunction = (
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

type ImportedModulesFunction = (
  fileName: string,
  text: string,
) => Array<string>;

// The modules a file imports or re-exports from.
const importedModules: ImportedModulesFunction = (
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

interface FixedAlert {
  // The code scanning alerts (js/incomplete-multi-character-sanitization).
  alerts: Array<number>;
  file: string;
  // What the file reads its markup through now.
  readsThrough: Array<string>;
}

const FIXED_ALERTS: Array<FixedAlert> = [
  {
    alerts: [1757],
    file: "packages/App/Tests/FeatureSet/APIReference/Accessibility.test.ts",
    readsThrough: ["removeHtmlMarkup"],
  },
  {
    alerts: [1758],
    file: "packages/App/Tests/Notification/EmailActionContracts.test.ts",
    readsThrough: ["htmlAsText"],
  },
  {
    alerts: [2109],
    file: "packages/App/Tests/Notification/IncomingCallPolicyOwnerMissedCallTemplate.test.ts",
    readsThrough: ["htmlAsText", "visibleText"],
  },
  {
    alerts: [2188],
    file: "packages/App/Tests/Notification/MessagingProviderLimits.test.ts",
    readsThrough: ["telegramTextLength"],
  },
  {
    alerts: [1811],
    file: "packages/App/Tests/Notification/MonitorsAffectedByProbeStatusTemplate.test.ts",
    readsThrough: ["htmlAsText", "visibleText"],
  },
  {
    alerts: [1759],
    file: "packages/App/Tests/Notification/SubscriberEmailTemplateDefaults.test.ts",
    readsThrough: ["removeHtmlMarkup"],
  },
  {
    alerts: [1858],
    file: "packages/App/Tests/Workers/Jobs/IncidentSla/SendNoteReminders.test.ts",
    readsThrough: ["htmlAsText"],
  },
  {
    alerts: [2149, 2150],
    file: "packages/Common/Tests/Server/Services/AlertTitleMarkdownSinks.test.ts",
    readsThrough: ["removeHtmlMarkup", "htmlAsText"],
  },
  {
    alerts: [1859],
    file: "packages/Common/Tests/Server/Services/IncidentCreatedFeedTitle.test.ts",
    readsThrough: ["removeHtmlMarkup"],
  },
  {
    alerts: [1860, 1861],
    file: "packages/Common/Tests/Server/Services/IncidentTitleMarkdownSinks.test.ts",
    readsThrough: ["removeHtmlMarkup", "htmlAsText"],
  },
  {
    alerts: [2151],
    file: "packages/Common/Tests/Server/Services/OnCallDutyPolicyExecutionLogTimelineGapFeed.test.ts",
    readsThrough: ["htmlAsText"],
  },
  {
    alerts: [2152],
    file: "packages/Common/Tests/Server/Services/WorkspaceNotificationRuleSendTestNotification.test.ts",
    readsThrough: ["removeHtmlMarkup"],
  },
  {
    alerts: [2157],
    file: "packages/Common/Tests/Server/Utils/Monitor/MonitorReportedTextInDescriptions.test.ts",
    readsThrough: ["removeHtmlMarkup"],
  },
  {
    alerts: [2153],
    file: "packages/Common/Tests/Server/Utils/StatusPage/IncidentTemplateVariableBuilder.test.ts",
    readsThrough: ["htmlAsText"],
  },
  {
    alerts: [2154],
    file: "packages/Common/Tests/Server/Utils/Workspace/ChatNamesAndLinksAsText.test.ts",
    readsThrough: ["htmlAsText"],
  },
  {
    alerts: [2156],
    file: "packages/Common/Tests/Utils/Markdown/AiWrittenAndReportedMarkdown.test.ts",
    readsThrough: ["removeHtmlMarkup"],
  },
  {
    alerts: [2167, 2168],
    file: "packages/Common/Tests/Utils/Markdown/FeedMarkdown.test.ts",
    readsThrough: ["htmlAsText", "removeHtmlMarkup"],
  },
  {
    alerts: [2187],
    file: "packages/Common/Tests/Utils/TelegramAndWhatsAppFit.test.ts",
    readsThrough: ["telegramTextLength"],
  },
];

const HTML_TEXT_FILE: string = "packages/Common/Tests/Helpers/HtmlText.ts";
const HTML_MARKUP_FILE: string = "packages/Common/Types/HtmlMarkup.ts";

type ReadFunction = (relativePath: string) => string;

const read: ReadFunction = (relativePath: string): string => {
  return fs.readFileSync(path.join(REPOSITORY_DIRECTORY, relativePath), "utf8");
};

// Lines of code, as a file.
const code: (...lines: Array<string>) => string = (
  ...lines: Array<string>
): string => {
  return lines.join("\n");
};

describe("every test in the repository reads markup through the shared walk", () => {
  const testFiles: Array<string> = listTestFiles(REPOSITORY_DIRECTORY);

  it("reads the test files of every package", () => {
    expect(testFiles.length).toBeGreaterThan(5000);
    expect(testFiles).toEqual(
      expect.arrayContaining([
        HTML_TEXT_FILE,
        "packages/Common/Tests/Helpers/TestTagStripGuard.test.ts",
        "packages/Common/Tests/RenderedMarkup.ts",
        "packages/App/Tests/FeatureSet/Docs/DocsHtmlText.ts",
        "packages/Home/Tests/BooksRendering.test.ts",
        "packages/Home/Tests/PricingRendering.test.ts",
        "ee/Tests/Server/FrontendRequestsUseRefreshAwareApi.test.ts",
        "packages/E2E/EventOverview/EventOverview.spec.ts",
        "packages/E2E/EventOverview/Fixture/Fixture.js",
        ...FIXED_ALERTS.map((fixed: FixedAlert): string => {
          return fixed.file;
        }),
      ]),
    );
    // Test files beside the code they test, outside any Tests folder.
    expect(
      testFiles.some((file: string): boolean => {
        return (
          file.startsWith("packages/MobileApp/src/") && TEST_FILE.test(file)
        );
      }),
    ).toBe(true);
    // Every package that has tests: Probe, Runner, CLI, the agents ...
    for (const tree of [
      "packages/Probe/Tests/",
      "packages/Runner/Tests/",
      "packages/CLI/Tests/",
      "packages/App/FeatureSet/MCP/Tests/",
      "agents/ResourceAIAgent/Tests/",
      "Scripts/TerraformProvider/Tests/",
    ]) {
      expect([
        tree,
        testFiles.some((file: string): boolean => {
          return file.startsWith(tree);
        }),
      ]).toEqual([tree, true]);
    }
    // Nothing of a dependency, a build or a hidden folder.
    expect(
      testFiles.filter((file: string): boolean => {
        return (
          file.includes("/node_modules/") ||
          file.includes("/build/") ||
          file.includes("/dist/") ||
          file.startsWith(".") ||
          file.includes("/.")
        );
      }),
    ).toEqual([]);
  });

  it("finds no test file that takes markup out with a pattern of its own", () => {
    const findings: Array<string> = [];

    for (const file of testFiles) {
      const text: string = read(file);

      // A file that calls neither replace nor split takes nothing out.
      if (!text.includes("replace") && !text.includes("split")) {
        continue;
      }

      for (const strip of findTagStrips(file, text)) {
        findings.push(
          `${file}:${strip.line} ${strip.code} - read the text with removeHtmlMarkup (Common/Types/HtmlMarkup) or a reading of Common/Tests/Helpers/HtmlText`,
        );
      }
    }

    expect(findings).toEqual([]);
  });

  it.each(FIXED_ALERTS)(
    "$file (alerts $alerts) reads markup through $readsThrough",
    (fixed: FixedAlert) => {
      const text: string = read(fixed.file);

      expect(findTagStrips(fixed.file, text)).toEqual([]);
      expect(importedNames(fixed.file, text)).toEqual(
        expect.arrayContaining(fixed.readsThrough),
      );
    },
  );

  it("lists each alert code scanning raised on a test file once", () => {
    const alerts: Array<number> = FIXED_ALERTS.flatMap(
      (fixed: FixedAlert): Array<number> => {
        return fixed.alerts;
      },
    );

    expect(alerts).toHaveLength(21);
    expect(new Set<number>(alerts).size).toBe(21);
  });

  /*
   * Home's tests import HtmlText by a relative path from outside their own
   * package, and RenderedMarkup brings it to the Docs, API Reference and
   * website suites: it may import nothing but the walk, which imports
   * nothing at all.
   */
  it("keeps HtmlText importable from any package", () => {
    expect(importedModules(HTML_TEXT_FILE, read(HTML_TEXT_FILE))).toEqual([
      "../../Types/HtmlMarkup",
    ]);
    expect(importedModules(HTML_MARKUP_FILE, read(HTML_MARKUP_FILE))).toEqual(
      [],
    );
  });
});

describe("findTagStrips, on files written here", () => {
  const linesOf: (text: string, fileName?: string) => Array<number> = (
    text: string,
    fileName: string = "Some.test.ts",
  ): Array<number> => {
    return findTagStrips(fileName, text).map((strip: TagStrip): number => {
      return strip.line;
    });
  };

  it.each([
    ["the pattern most copies used", 'text.replace(/<[^>]+>/g, "");'],
    ["the other one", 'text.replace(/<[^>]*>/g, "");'],
    ["replaceAll", 'text.replaceAll(/<[^>]*>/g, "");'],
    ["a space in its place", 'text.replace(/<[^>]*>/g, " ");'],
    ["a callback", 'text.replace(/<[^>]+>/g, (): string => { return ""; });'],
    ["new RegExp", 'text.replace(new RegExp("<[^>]*>", "g"), "");'],
    ["RegExp without new", 'text.replace(RegExp("<[^>]*>", "g"), "");'],
    ["an end-tag-aware pattern", 'text.replace(/<\\/?[a-z][^>]*>/gi, "");'],
    ["a comment strip", 'text.replace(/<!--[\\s\\S]*?-->/g, " ");'],
    ["a pattern in parentheses", 'text.replace((/<[^>]*>/g), "");'],
    [
      "a strip that eats the spaces around a tag",
      'text.replace(/\\s*<[^>]+>\\s*/g, " ");',
    ],
    ["a strip that leaves the >", 'text.replace(/<\\/?[a-z]+/gi, "");'],
    ["the literal tag", 'text.replace(/<script>/g, "");'],
    ["a tag or an entity", 'text.replace(/<[^>]*>|&[a-z]+;/g, "");'],
  ])("finds %s", (_shape: string, line: string) => {
    expect(linesOf(line)).toEqual([1]);
  });

  it("finds a pattern held in a constant, a static field, or built from another's source", () => {
    expect(
      linesOf(
        code(
          "const TAG: RegExp = /<[^>]*>/g;",
          'html.replace(TAG, "");',
          "class Page {",
          "  private static readonly TAG: RegExp = /<[^>]+>/g;",
          '  public static text(html: string): string { return html.replace(Page.TAG, " "); }',
          "}",
          'html.replace(new RegExp(TAG.source, "g"), "");',
          "const AGAIN: RegExp = new RegExp(LATER.source, 'g');",
          "const LATER: RegExp = /<[^>]+>/;",
          'html.replace(AGAIN, "");',
        ),
      ),
    ).toEqual([2, 5, 7, 10]);
  });

  it("finds a tag strip repeated until nothing changes", () => {
    expect(
      linesOf(
        code(
          "let text: string = html;",
          "let previous: string;",
          "do {",
          "  previous = text;",
          '  text = text.replace(/<[^>]*>/g, "");',
          "} while (text !== previous);",
        ),
      ),
    ).toEqual([5]);
  });

  it("finds the pieces between the tags joined back up", () => {
    expect(
      linesOf(
        code(
          "const TAG: RegExp = /<[^>]+>/g;",
          'const text: string = html.split(TAG).join("");',
          'const spaced: string = html.split(/<[^>]*>/).join(" ");',
        ),
      ),
    ).toEqual([2, 3]);
  });

  it("reads JavaScript, JSX and TSX files", () => {
    expect(linesOf('html.replace(/<[^>]+>/g, "");', "fixture.js")).toEqual([1]);
    expect(
      linesOf(
        code(
          "const view = <div>{text}</div>;",
          'html.replace(/<[^>]+>/g, "");',
        ),
        "View.test.tsx",
      ),
    ).toEqual([2]);
    expect(
      linesOf(
        code("const view = <p>x</p>;", 'html.replace(/<[^>]+>/g, "");'),
        "view.jsx",
      ),
    ).toEqual([2]);
  });

  it("passes what is not a tag strip", () => {
    expect(
      linesOf(
        code(
          // An element and all it holds: an icon, an email's styles.
          'inner.replace(/<svg[\\s\\S]*?<\\/svg>/g, "");',
          'html.replace(/<style[\\s\\S]*?<\\/style>/gi, " ");',
          'html.replace(/<span\\b[^>]*aria-hidden=["\']true["\'][^>]*>[\\s\\S]*?<\\/span>/gi, " ");',
          // One element's tags, never the markup code scanning asks about.
          'cell.replace(/<\\/?strong>/g, "");',
          // A component's type arguments: everything from the first "<".
          "const TYPE_ARGUMENTS: RegExp = /<.*$/;",
          'name.replace(TYPE_ARGUMENTS, "");',
          // A text known to be wrapped in one element, unwrapped.
          'script.replace(/^<script type="module">/, "").replace(/<\\/script>$/, "");',
          // Single characters, runs of them, and a slug.
          'text.replace(/[<>]/g, "");',
          'text.replace(/<+/g, "");',
          'title.replace(/[^a-z0-9]+/g, "-");',
          // Escaping and unescaping are not taking markup out.
          'text.replace(/</g, "&lt;");',
          'text.replace(/&lt;/g, "<");',
          // EJS tags in a template's source.
          'source.replace(/<%[\\s\\S]*?%>/g, "");',
          // Reading markup is not taking it out.
          "const TAG: RegExp = /<[^>]*>/g;",
          "TAG.test(html);",
          "html.match(TAG);",
          "html.matchAll(TAG);",
          "html.split(TAG);",
          "html.split(TAG).map((piece: string): string => { return piece.trim(); });",
          // A string pattern, and the shared walk and its readings.
          'html.replace("<", "");',
          "removeHtmlMarkup(html);",
          "htmlAsText(html);",
          "markupAsSpaces(html);",
          // A pattern the runtime cannot build is passed over, not thrown on.
          'html.replace(new RegExp("(", "g"), "");',
          // A pattern from a name nothing in the file gives.
          'html.replace(imported, "");',
        ),
      ),
    ).toEqual([]);
  });

  it("decides on the pattern, not on how it is written", () => {
    expect(stripsMarkup(/<[^>]*>/)).toBe(true);
    expect(stripsMarkup(/<!--[\s\S]*?-->/)).toBe(true);
    expect(stripsMarkup(/<[a-z!/][^>]*>/i)).toBe(true);
    expect(stripsMarkup(/<.*$/)).toBe(false);
    expect(stripsMarkup(/<\/script>$/)).toBe(false);
    expect(stripsMarkup(/[^a-z0-9]+/)).toBe(false);
    expect(stripsMarkup(/<svg[\s\S]*?<\/svg>/)).toBe(false);
    expect(stripsMarkup(/<+/)).toBe(false);
  });
});

describe("isTestCode", () => {
  it.each([
    "packages/Common/Tests/Helpers/HtmlText.ts",
    "packages/App/Tests/Notification/EmailActionContracts.test.ts",
    "packages/Common/Tests/UI/Components/Some.test.tsx",
    "packages/MobileApp/src/utils/text.test.ts",
    "packages/E2E/EventOverview/Fixture/Fixture.js",
    "packages/E2E/Tests/Dashboard/Helpers/Monitors.ts",
    "packages/MobileApp/src/__tests__/App.test.tsx",
    "Tests/Ops/run-suite.mjs",
    "Scripts/TerraformProvider/Tests/Generator.test.ts",
  ])("reads %s", (file: string) => {
    expect(isTestCode(file)).toBe(true);
  });

  it.each([
    "packages/Common/Types/HtmlMarkup.ts",
    "packages/Common/Server/Utils/Workspace/MicrosoftTeams/ReactionNoteSync.ts",
    "packages/App/FeatureSet/Docs/Utils/SearchIndex.ts",
    "packages/Common/Tests/Types/Some.d.ts",
    "packages/Common/Tests/Fixtures/page.html",
    "packages/App/node_modules/some-package/Tests/index.test.js",
    "packages/Common/build/dist/Tests/Helpers/HtmlText.js",
    ".claude/worktrees/other/packages/Common/Tests/Some.test.ts",
  ])("leaves %s", (file: string) => {
    expect(isTestCode(file)).toBe(false);
  });
});

describe("importedNames and importedModules", () => {
  it("reads what a file imports, and from where", () => {
    const text: string = code(
      'import Default, { named, other as renamed } from "./a";',
      'import { removeHtmlMarkup } from "../../Types/HtmlMarkup";',
      'import "./side-effect";',
      'export { again } from "./b";',
    );

    expect(importedNames("Some.ts", text)).toEqual([
      "Default",
      "named",
      "renamed",
      "removeHtmlMarkup",
    ]);
    expect(importedModules("Some.ts", text)).toEqual([
      "./a",
      "../../Types/HtmlMarkup",
      "./side-effect",
      "./b",
    ]);
  });
});
