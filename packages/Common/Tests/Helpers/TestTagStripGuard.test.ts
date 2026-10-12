import { afterAll, beforeAll, describe, expect, it } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  REPOSITORY_DIRECTORY,
  TAG_STRIP_FIX,
  TEST_FILE,
  TagStrip,
  findTagStrips,
  importedModules,
  importedNames,
  isTestCode,
  listTestFiles,
  reportTagStrips,
  stripsMarkup,
} from "./TagStripScan";

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
 * a text known to start or end with a tag (anchored with ^ or $), one of
 * single characters, and a replace that writes a "<" back - an escape, such
 * as "</script" made "<\/script" inside a script.
 *
 * The test files are every file of code under a folder named Tests, tests or
 * __tests__, every *.test.* and *.spec.* file wherever it is, and all of
 * packages/E2E, a package of nothing but tests and their fixtures - outside
 * node_modules, builds and hidden folders.
 *
 * The reading - which files are test code, and what is a tag strip - is
 * Tests/Helpers/TagStripScan, and ee/Tests/Server/TestTagStripGuard.test.ts
 * runs it over ee/'s test files too. The Common Test job removes ee/ before
 * it runs (core passes without the Enterprise Edition), so in CI this walk
 * never meets an ee/ test; ee's own suite, in the Enterprise Edition Test
 * job, reads them with the same detector.
 */

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

const SCAN_TIMEOUT_IN_MS: number = 300000;

const HTML_TEXT_FILE: string = "packages/Common/Tests/Helpers/HtmlText.ts";
const HTML_MARKUP_FILE: string = "packages/Common/Types/HtmlMarkup.ts";
const TAG_STRIP_SCAN_FILE: string =
  "packages/Common/Tests/Helpers/TagStripScan.ts";

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
        "packages/E2E/EventOverview/EventOverview.spec.ts",
        "packages/E2E/EventOverview/Fixture/Fixture.js",
        /*
         * Core's own CI removes ee/ before its tests (core must pass without
         * the Enterprise Edition), so ee/'s test files are expected only
         * where ee/ is checked out.
         */
        ...(fs.existsSync(path.join(REPOSITORY_DIRECTORY, "ee"))
          ? ["ee/Tests/Server/FrontendRequestsUseRefreshAwareApi.test.ts"]
          : []),
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

  // Thousands of files are parsed: about ten seconds here, more on a runner.
  it(
    "finds no test file that takes markup out with a pattern of its own",
    () => {
      expect(reportTagStrips(testFiles)).toEqual([]);
    },
    SCAN_TIMEOUT_IN_MS,
  );

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

  /*
   * ee's own suite (ee/Tests/Server/TestTagStripGuard.test.ts) runs the
   * detector over ee/'s test files, reaching it as "Common/Tests/Helpers/
   * TagStripScan": it may import node's fs and path and the TypeScript
   * parser, and nothing of App's or ee's.
   */
  it("keeps the detector importable from ee's own suite", () => {
    expect(
      importedModules(TAG_STRIP_SCAN_FILE, read(TAG_STRIP_SCAN_FILE)),
    ).toEqual(["fs", "path", "typescript"]);
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
    ["a replacement of words", 'text.replace(/<[^>]*>/g, "[tag]");'],
    ["an entity in its place", 'text.replace(/<[^>]*>/g, "&lt;tag&gt;");'],
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
          'code.replace(/<\\/script/gi, "<\\\\/script");',
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

describe("listTestFiles and reportTagStrips, on a tree written here", () => {
  /*
   * A checkout in miniature: ee/ with tests, a helper and product code, the
   * folders a walk passes over, and a core package beside it.
   */
  const TREE: Record<string, string> = {
    "ee/Tests/Server/Email.test.ts": code(
      'import { expect, test } from "@jest/globals";',
      'const words: string = html.replace(/<[^>]+>/g, "");',
    ),
    "ee/Tests/Server/Helpers/Kit.ts": code(
      "const TAG: RegExp = /<[^>]*>/g;",
      "export const text = (html: string): string => {",
      '  return html.replace(TAG, " ");',
      "};",
    ),
    // It replaces, but only whitespace after the shared walk.
    "ee/Tests/Server/Clean.test.ts": code(
      'import { removeHtmlMarkup } from "Common/Types/HtmlMarkup";',
      'const words: string = removeHtmlMarkup(html).replace(/\\s+/g, " ");',
    ),
    "ee/Tests/UI/Banner.test.tsx": code(
      "const view = <p>{text}</p>;",
      'const words: string = html.split(/<[^>]*>/).join(" ");',
    ),
    // A test beside the code it tests.
    "ee/Dashboard/Widget.test.tsx": 'html.replace(/<[^>]*>/g, "");',
    // Product code, a declaration and a page: not test code.
    "ee/Server/Render.ts": 'html.replace(/<[^>]*>/g, "");',
    "ee/Tests/Server/Globals.d.ts": "declare const html: string;",
    "ee/Tests/Server/page.html": "<p>Hello</p>",
    // A dependency, builds and a hidden folder.
    "ee/node_modules/some-package/Tests/strip.test.js":
      'html.replace(/<[^>]*>/g, "");',
    "ee/build/Tests/Server/Email.test.js": 'html.replace(/<[^>]*>/g, "");',
    "ee/dist/Email.test.js": 'html.replace(/<[^>]*>/g, "");',
    "ee/.cache/Tests/Email.test.ts": 'html.replace(/<[^>]*>/g, "");',
    // Core, beside ee/.
    "packages/Some/Tests/Page.test.ts": 'html.replace(/<[^>]*>/g, "");',
  };

  const EE_TEST_FILES: Array<string> = [
    "ee/Dashboard/Widget.test.tsx",
    "ee/Tests/Server/Clean.test.ts",
    "ee/Tests/Server/Email.test.ts",
    "ee/Tests/Server/Helpers/Kit.ts",
    "ee/Tests/UI/Banner.test.tsx",
  ];

  let root: string = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tag-strip-scan-"));

    for (const [file, text] of Object.entries(TREE)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), text);
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("names a folder's test files from the root, as the walk of the whole tree does", () => {
    expect(listTestFiles(path.join(root, "ee"), root)).toEqual(EE_TEST_FILES);
    expect(listTestFiles(root, root)).toEqual([
      ...EE_TEST_FILES,
      "packages/Some/Tests/Page.test.ts",
    ]);
  });

  it("names files from the repository's root when given no root", () => {
    expect(
      listTestFiles(
        path.join(REPOSITORY_DIRECTORY, path.dirname(HTML_TEXT_FILE)),
      ),
    ).toEqual(
      expect.arrayContaining([
        HTML_TEXT_FILE,
        TAG_STRIP_SCAN_FILE,
        "packages/Common/Tests/Helpers/TestTagStripGuard.test.ts",
      ]),
    );
  });

  it("reports each tag strip by file and line, with what to read it with instead", () => {
    expect(
      reportTagStrips(listTestFiles(path.join(root, "ee"), root), root),
    ).toEqual([
      `ee/Dashboard/Widget.test.tsx:1 html.replace(/<[^>]*>/g, "") - ${TAG_STRIP_FIX}`,
      `ee/Tests/Server/Email.test.ts:2 html.replace(/<[^>]+>/g, "") - ${TAG_STRIP_FIX}`,
      `ee/Tests/Server/Helpers/Kit.ts:3 html.replace(TAG, " ") - ${TAG_STRIP_FIX}`,
      `ee/Tests/UI/Banner.test.tsx:2 html.split(/<[^>]*>/).join(" ") - ${TAG_STRIP_FIX}`,
    ]);
    expect(TAG_STRIP_FIX).toBe(
      "read the text with removeHtmlMarkup (Common/Types/HtmlMarkup) or a reading of Common/Tests/Helpers/HtmlText",
    );
  });

  it("reads the files from the repository's root when given no root", () => {
    expect(reportTagStrips([HTML_TEXT_FILE, TAG_STRIP_SCAN_FILE])).toEqual([]);
    // A file of the tree written here is no file of the repository's.
    expect(() => {
      return reportTagStrips(["packages/Some/Tests/Page.test.ts"]);
    }).toThrow(/ENOENT/);
    expect(
      reportTagStrips(["packages/Some/Tests/Page.test.ts"], root),
    ).toHaveLength(1);
  });
});
