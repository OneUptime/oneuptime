import { afterAll, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import os from "os";
import path from "path";
import {
  CODE_SCANNING_FIXES,
  CodeScanningFinding,
  PACKAGES_WITH_COMMON,
  SHARED_REGEXP_ESCAPE_FILE,
  findCodeScanningProblems,
  isProductCode,
  listProductFiles,
  reachesCommon,
  templateScripts,
} from "./CodeScanning";
import { REPOSITORY_DIRECTORY } from "./TagStripScan";

/*
 * PRODUCT CODE WRITES NOTHING CODE SCANNING REPORTS AS INCOMPLETE ESCAPING
 * OR AN OVERLY LARGE RANGE.
 *
 * Code scanning had thirteen js/incomplete-sanitization alerts open on
 * product code (FIXED_ALERTS below): Markdown table cells that escaped a "|"
 * but not a backslash before it, telemetry search tokens that escaped quotes
 * after another function had escaped the backslashes, an attribute key
 * quoted into ClickHouse by hand, GitHub's Link header taken apart with a
 * replace of its first "<" and first ">", and the site's FAQ structured data
 * escaped for JSON and then for HTML. Each now goes through a shared helper
 * or a walk - markdownTableCell, buildSearchTokenValue and
 * buildSearchTokenGlob, the query's parameter binding, readLinkHeader, the
 * JSON-LD partial - and regular expressions built from text escape it with
 * escapeRegExp (Common/Utils/RegExpEscape), the one copy of that escape.
 *
 * This guard reads every file of product code the way code scanning reads
 * it for js/incomplete-sanitization and js/overly-large-range (CodeScanning
 * says how, query by query), and fails on what it would report, so the next
 * one is found on its pull request instead of after the merge. Run over
 * master before these fixes, it reports exactly those thirteen alerts, on
 * their lines. It also fails on a copy of the regular expression escape
 * where the shared one can be imported, and on a pattern literal that
 * Unicode normalization would change.
 *
 * Product code is every code file and template of the repository's code
 * folders that is no test (TagStripScan's reading of which files are), no
 * build, and no vendored build checked in as published (Common/Server/
 * Static/Vendor - Tailwind, highlight.js - and minified files). Whether code
 * scanning reads the vendored builds is its configuration's choice; their
 * code is not edited. The Common Test job removes ee/ before it runs, so
 * ee/Tests/Server/ProductCodeScanningGuard.test.ts reads ee/'s product code
 * from the Enterprise Edition Test job.
 */

interface FixedAlert {
  // The code scanning alerts, by number.
  alerts: Array<number>;
  // The file they were on.
  file: string;
  // The code they were on, as it was, with what it needs to be read.
  original: string;
  // What code scanning said, once per alert.
  messages: Array<string>;
}

// Lines of code, as a file.
function code(...lines: Array<string>): string {
  return lines.join("\n");
}

// "${" without starting a substitution in this file.
const SUBSTITUTION_START: string = "$" + "{";

const DOES_NOT_ESCAPE_BACKSLASHES: string =
  "This does not escape backslash characters in the input.";

const FIXED_ALERTS: Array<FixedAlert> = [
  {
    alerts: [2169],
    file: "packages/Common/Utils/Markdown/FeedMarkdown.ts",
    original: code(
      "const TABLE_CELL_SEPARATOR_PATTERN: RegExp = /\\|/g;",
      "const escapeSentenceValue = (text: string, placed: PlacedValue): string => {",
      "  let escaped: string = escapeSentenceStyle(escapeMarkdownValue(text));",
      "  if (placed.inTableRow) {",
      '    escaped = escaped.replace(TABLE_CELL_SEPARATOR_PATTERN, "\\\\|");',
      "  }",
      "  return escaped;",
      "};",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1787],
    file: "packages/App/FeatureSet/Dashboard/src/Components/SecurityEvents/HowItWorks/SecurityEventsGuide.ts",
    original: code(
      "const escapeCell: (cell: string) => string = (cell: string): string => {",
      '  return cell.replace(/\\|/g, "\\\\|");',
      "};",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1748],
    file: "packages/App/FeatureSet/Docs/Utils/PermissionsTable.ts",
    original: code(
      "export function toTableCell(text: string): string {",
      "  return text",
      '    .replace(/\\r?\\n/g, " ")',
      '    .replace(/\\s+/g, " ")',
      '    .replace(/\\|/g, "\\\\|")',
      "    .trim();",
      "}",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1739],
    file: "packages/Common/Types/Telemetry/TelemetrySearchQuery.ts",
    original: code(
      'const QUOTE_REGEX: RegExp = /(")/g;',
      "const LEADING_OPERATOR_REGEX: RegExp = /^([-~!<>])/;",
      "const WRAPPED_LIST_REGEX: RegExp = /^(\\()(.*)(\\))$|^(\\[)(.*)(\\])$/;",
      "export const buildSearchTokenValue = (literal: string): string => {",
      "  const escaped: string = escapeWildcards(literal)",
      '    .replace(QUOTE_REGEX, "\\\\$1")',
      '    .replace(LEADING_OPERATOR_REGEX, "\\\\$1")',
      '    .replace(WRAPPED_LIST_REGEX, "\\\\$&");',
      "  return escaped;",
      "};",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1742],
    file: "packages/Common/Utils/Telemetry/LockedFilterSearch.ts",
    original: code(
      'const QUOTE_REGEX: RegExp = /(")/g;',
      "const LEADING_OPERATOR_REGEX: RegExp = /^([-~!<>])/;",
      "const WRAPPED_LIST_REGEX: RegExp = /^(\\()(.*)(\\))$|^(\\[)(.*)(\\])$/;",
      "const renderGlob = (glob: string): string => {",
      "  const escaped: string = glob",
      '    .replace(QUOTE_REGEX, "\\\\$1")',
      '    .replace(LEADING_OPERATOR_REGEX, "\\\\$1")',
      '    .replace(WRAPPED_LIST_REGEX, "\\\\$&");',
      "  return escaped;",
      "};",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1740],
    file: "packages/Common/UI/Components/Markdown.tsx/MarkdownConverters.ts",
    original: code(
      "const cellText = (cell: Element): string => {",
      "  return serializeChildren(cell)",
      '    .replace(/\\|/g, "\\\\|")',
      '    .replace(/\\n+/g, " ")',
      "    .trim();",
      "};",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1741],
    file: "packages/Common/UI/Utils/AIChatExport/ChatWidgetMarkdown.ts",
    original: code(
      "function escapeTableCell(value: string): string {",
      '  return value.replace(/\\|/g, "\\\\|").replace(/\\r?\\n/g, " ");',
      "}",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1749],
    file: "packages/Common/Server/Services/LogAggregationService.ts",
    original: code(
      "class LogAggregationService {",
      "  private static getAggregationExpression(request: AnalyticsRequest): string {",
      "    return `uniqExact(attributes['" +
        SUBSTITUTION_START +
        "request.aggregationField.replace(/'/g, \"\\\\'\")}'])`;",
      "  }",
      "}",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1743, 1744],
    file: "packages/Home/Routes.ts",
    original: code(
      'const link: string | undefined = response.headers["link"];',
      "const urlString: string | undefined = link",
      '  ?.split(",")[1]',
      '  ?.split(";")[0]',
      '  ?.replace("<", "")',
      '  .replace(">", "")',
      "  .trim();",
    ),
    // Both on the chain's line; the outer call, the ">" one, reads first.
    messages: [
      'This replaces only the first occurrence of ">".',
      'This replaces only the first occurrence of "<".',
    ],
  },
  {
    alerts: [1745],
    file: "packages/Home/Utils/AIDiscovery.ts",
    original: code(
      "function tableCell(value: string): string {",
      '  return value.replace(/\\|/g, "\\\\|").replace(/\\n/g, " ");',
      "}",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES],
  },
  {
    alerts: [1746, 1747],
    file: "packages/Home/Views/product-compare.ejs",
    original: code(
      '<script type="application/ld+json">',
      "{",
      '  "mainEntity": [',
      "    <% for(var faqIdx=0; faqIdx < productConfig.faq.length; faqIdx++) { %>",
      "    {",
      '      "@type": "Question",',
      '      "name": "<%= productConfig.faq[faqIdx].question.replace(/"/g, \'\\\\"\') %>",',
      '      "acceptedAnswer": {',
      '        "@type": "Answer",',
      '        "text": "<%= productConfig.faq[faqIdx].answer.replace(/"/g, \'\\\\"\') %>"',
      "      }",
      "    }<%= faqIdx < productConfig.faq.length - 1 ? ',' : '' %>",
      "    <% } %>",
      "  ]",
      "}",
      "</script>",
    ),
    messages: [DOES_NOT_ESCAPE_BACKSLASHES, DOES_NOT_ESCAPE_BACKSLASHES],
  },
];

const OPTIONS: {
  regExpEscapeFile: string;
  reachesSharedHelpers: (file: string) => boolean;
} = {
  regExpEscapeFile: SHARED_REGEXP_ESCAPE_FILE,
  reachesSharedHelpers: reachesCommon,
};

// What a file holds that the guard reports.
function problemsIn(file: string, text: string): Array<CodeScanningFinding> {
  return findCodeScanningProblems(file, text, OPTIONS);
}

function rulesAndMessages(
  findings: Array<CodeScanningFinding>,
): Array<[string, string]> {
  return findings.map((finding: CodeScanningFinding): [string, string] => {
    return [finding.rule, finding.message];
  });
}

// A finding as the guard prints it: where, what, and what to use instead.
function reported(finding: CodeScanningFinding): string {
  return `${finding.file}:${finding.line} [${finding.rule}] ${finding.message} ${finding.code} -> ${CODE_SCANNING_FIXES[finding.rule]}`;
}

describe("product code writes nothing code scanning reports", () => {
  const files: Array<string> = listProductFiles();

  test("the walk reads the product code of every package", () => {
    /*
     * Guards the guard: a moved folder or a broken walk would leave the scan
     * below passing over nothing.
     */
    expect(files.length).toBeGreaterThan(5000);

    for (const file of [
      "packages/Common/Utils/Markdown/FeedMarkdown.ts",
      "packages/Common/Utils/RegExpEscape.ts",
      "packages/App/FeatureSet/Dashboard/src/Components/Traces/TracesViewer.tsx",
      "packages/Home/Routes.ts",
      "packages/Home/Views/product-compare.ejs",
      "packages/Home/Views/Partials/json-ld.ejs",
      "packages/Home/Static/js/home.js",
      "Scripts/Lint/LintByProject.js",
    ]) {
      expect(files).toContain(file);
    }

    for (const file of files) {
      expect([file, isProductCode(file)]).toEqual([file, true]);
    }
  });

  test("no file holds an escape that misses a backslash, a first-only replace or an overly large range", () => {
    const findings: Array<CodeScanningFinding> = [];

    for (const file of files) {
      findings.push(
        ...problemsIn(
          file,
          fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
        ),
      );
    }

    expect(findings.map(reported)).toEqual([]);
  }, 300000);

  test("each fixed alert's file now reads clean", () => {
    for (const alert of FIXED_ALERTS) {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, alert.file),
        "utf8",
      );

      expect([alert.file, problemsIn(alert.file, text)]).toEqual([
        alert.file,
        [],
      ]);
    }
  });

  test("each fixed alert's original code is found again, with code scanning's own words", () => {
    for (const alert of FIXED_ALERTS) {
      const findings: Array<CodeScanningFinding> = problemsIn(
        alert.file,
        alert.original,
      );

      expect([alert.alerts, rulesAndMessages(findings)]).toEqual([
        alert.alerts,
        alert.messages.map((message: string): [string, string] => {
          return ["js/incomplete-sanitization", message];
        }),
      ]);
    }
  });
});

describe("CodeScanning - js/incomplete-sanitization, as code scanning reads it", () => {
  const FILE: string = "packages/Common/Utils/Example.ts";

  test("an escape that misses a backslash is reported; one that escapes it, in the pass or before, is not", () => {
    const reportedCode: Array<string> = [
      "x.replace(/\"/g, '\\\\\"');",
      'x.replace(/\\|/g, "\\\\|");',
      'x.replace(/([*?])/g, "\\\\$1");',
      'x.replace(new RegExp("[<>]", "g"), "\\\\$&");',
      "let y: string = f(x); y = y.replace(/'/g, \"\\\\'\");",
      'x.trim().replace(/\\|/g, "\\\\|");',
    ];
    const cleanCode: Array<string> = [
      'x.replace(/[\\\\"]/g, "\\\\$&");',
      'x.replace(/\'|\\\\/g, "\\\\$&");',
      'x.replace(/\\\\/g, "\\\\\\\\").replace(/"/g, \'\\\\"\');',
      "JSON.stringify(x).replace(/\"/g, '\\\\\"');",
      'let y: string = x.replace(/\\\\/g, "\\\\\\\\"); y = y.replace(/\'/g, "\\\\\'");',
      // A pattern that is not a union of constants: taken to match a backslash.
      'x.replace(/[^a-z]/g, "\\\\$&");',
      'x.replace(/\\W/g, "\\\\$&");',
      'x.replace(new RegExp(source, "g"), "\\\\$&");',
      // Not global: a first-only escape is the other message's business.
      'x.replace(/^([-~!<>])/, "\\\\$1");',
      // A string pattern: no regular expression for this query to read.
      'x.replaceAll("|", "\\\\|");',
      // Replacements that add no backslash.
      'x.replace(/</g, "&lt;");',
      'x.replace(/</g, "\\\\u003c");',
    ];

    for (const line of reportedCode) {
      expect([line, rulesAndMessages(problemsIn(FILE, line))]).toEqual([
        line,
        [["js/incomplete-sanitization", DOES_NOT_ESCAPE_BACKSLASHES]],
      ]);
    }

    for (const line of cleanCode) {
      expect([line, problemsIn(FILE, line)]).toEqual([line, []]);
    }
  });

  test("a constant, a variable or a class's field holding the pattern is followed to it", () => {
    expect(
      rulesAndMessages(
        problemsIn(
          FILE,
          code(
            "class Escaper {",
            "  private static readonly PIPE: RegExp = /\\|/g;",
            "  public static escape(x: string): string {",
            '    return x.replace(Escaper.PIPE, "\\\\|");',
            "  }",
            "}",
          ),
        ),
      ),
    ).toEqual([["js/incomplete-sanitization", DOES_NOT_ESCAPE_BACKSLASHES]]);

    expect(
      problemsIn(
        FILE,
        code(
          "const ALL: RegExp = /[\\\\|]/g;",
          "function escape(x: string): string {",
          "  const pattern: RegExp = ALL;",
          '  return x.replace(pattern, "\\\\$&");',
          "}",
        ),
      ),
    ).toEqual([]);
  });

  test("a replace of the first meta-character only is reported, with code scanning's exceptions", () => {
    const reportedCode: Array<[string, string]> = [
      ['x.replace("<", "");', "<"],
      ['x.replace(">", "&gt;");', ">"],
      ['x.replace(/"/, "");', '"'],
      ['x.replace("%20", " ");', "%20"],
      ['x.replace("../", "");', "../"],
      ['x.replace("\\n", "").replace("a", "b");', "\n"],
      ['x.replace("{{", "");', ""],
    ];

    for (const [line, character] of reportedCode) {
      const findings: Array<CodeScanningFinding> = problemsIn(FILE, line);

      if (character === "") {
        // "{{" is no single meta-character: not reported.
        expect([line, findings]).toEqual([line, []]);
        continue;
      }

      expect([line, rulesAndMessages(findings)]).toEqual([
        line,
        [
          [
            "js/incomplete-sanitization",
            `This replaces only the first occurrence of ${JSON.stringify(character)}.`,
          ],
        ],
      ]);
    }

    for (const line of [
      'x.replace(/</g, "");',
      'x.replaceAll("<", "");',
      // A pair that takes the delimiters off both ends.
      'x.replace("[", "").replace("]", "");',
      'x.replace("(", "").replace(")", "");',
      // A lone line break, percent or dollar taken out.
      'x.replace("\\n", "");',
      'price.replace("$", "");',
      // Anchored: no constant it replaces.
      'x.replace(/^"/, "");',
      // A loop that feeds the replace its own result.
      'while (s.includes("<")) { s = s.replace("<", ""); }',
      // Not a meta-character.
      'x.replace("a", "b");',
    ]) {
      expect([line, problemsIn(FILE, line)]).toEqual([line, []]);
    }
  });
});

describe("CodeScanning - js/overly-large-range, as code scanning reads it", () => {
  const FILE: string = "packages/Common/Utils/Example.ts";

  test("a literal range across letters and punctuation, or sharing characters, is reported", () => {
    for (const pattern of [
      "/[A-z]/",
      "/[+-z]/",
      "/[0-z]/",
      "/[a-zA-Z0-9a-f]/",
      "/[a-z\\w]/",
      "/[0-9\\d]/",
    ]) {
      const findings: Array<CodeScanningFinding> = problemsIn(
        FILE,
        `const PATTERN: RegExp = ${pattern};`,
      );

      expect([pattern, findings.length > 0]).toEqual([pattern, true]);
      expect(
        findings.every((finding: CodeScanningFinding): boolean => {
          return finding.rule === "js/overly-large-range";
        }),
      ).toBe(true);
    }
  });

  test("exact ranges, code scanning's allowed wide ranges, escaped ranges and string patterns are not", () => {
    for (const pattern of [
      "/[0-9A-Fa-f]/",
      "/[a-zA-Z0-9_-]/",
      "/[ -~]/",
      "/[!-~]/",
      "/[@-_]/",
      "/[@-Z]/",
      "/[0-?]/",
      "/[\\x00-\\x1F]/",
      "/[\\x23-\\x5B\\x5D-\\x7E]/",
      "/[\\p{Script=Han}\\p{Script=Hiragana}]/u",
      'new RegExp("[A-z]")',
    ]) {
      expect([
        pattern,
        problemsIn(FILE, `const PATTERN: RegExp = ${pattern};`),
      ]).toEqual([pattern, []]);
    }
  });

  test("a pattern holding a character Unicode normalization changes is reported", () => {
    const compatibilityIdeograph: string = String.fromCodePoint(0xf900);
    const findings: Array<CodeScanningFinding> = problemsIn(
      FILE,
      `const PATTERN: RegExp = /[${compatibilityIdeograph}-${String.fromCodePoint(0xfaff)}]/u;`,
    );

    expect(rulesAndMessages(findings)).toEqual([
      ["normalized character", "NFC turns U+F900 into U+8C48."],
    ]);
  });
});

describe("CodeScanning - one regular expression escape", () => {
  const COPY: string =
    "export const quote = (text: string): string => { return text.replace(/[.*+?^$" +
    '{}()|[\\]\\\\]/g, "\\\\$&"); };';

  test("a copy of the escape is reported where Common can be imported", () => {
    for (const file of [
      "packages/Common/Utils/Example.ts",
      "packages/App/FeatureSet/Example.ts",
      "packages/Home/Utils/Example.ts",
      "ee/Server/Example.ts",
    ]) {
      expect([file, rulesAndMessages(problemsIn(file, COPY))]).toEqual([
        file,
        [
          [
            "own regular expression escape",
            "This escapes text for a pattern with a copy of escapeRegExp.",
          ],
        ],
      ]);
    }
  });

  test("a function named for the escape is reported too", () => {
    expect(
      rulesAndMessages(
        problemsIn(
          "packages/Common/Utils/Example.ts",
          code(
            "function escapeRegex(value: string): string {",
            "  return escapeRegExp(value);",
            "}",
          ),
        ),
      ),
    ).toEqual([
      [
        "own regular expression escape",
        "escapeRegex is a copy of escapeRegExp.",
      ],
    ]);
  });

  test("the shared escape itself, and code that cannot import it, are not", () => {
    expect(
      problemsIn(
        SHARED_REGEXP_ESCAPE_FILE,
        fs.readFileSync(
          path.join(REPOSITORY_DIRECTORY, SHARED_REGEXP_ESCAPE_FILE),
          "utf8",
        ),
      ),
    ).toEqual([]);

    for (const file of [
      "agents/KubernetesLogTailer/NamespaceFilter.ts",
      "packages/MobileApp/src/Example.ts",
      "Scripts/Example.ts",
    ]) {
      expect([file, problemsIn(file, COPY)]).toEqual([file, []]);
    }

    expect(PACKAGES_WITH_COMMON).toContain("packages/Common/");
    expect(reachesCommon("agents/ResourceAIAgent/Index.ts")).toBe(false);
  });
});

describe("CodeScanning - the code of templates", () => {
  test("a template's own code is read at its lines; comments and literal text are not code", () => {
    const template: string = code(
      "<html>",
      '<%# a comment: x.replace("<", "") %>',
      "<p><%%= not code %></p>",
      "<% if (items.length > 0) { %>",
      '  <span><%= items[0].replace("<", "") %></span>',
      "<% } %>",
      "</html>",
    );
    const findings: Array<CodeScanningFinding> = problemsIn(
      "packages/Home/Views/example.ejs",
      template,
    );

    expect(
      findings.map((finding: CodeScanningFinding): [number, string] => {
        return [finding.line, finding.message];
      }),
    ).toEqual([[5, 'This replaces only the first occurrence of "<".']]);
  });

  test("an inline script is read on its own, and JSON-LD is not code", () => {
    const page: string = code(
      "<html><head>",
      '<script type="application/ld+json">{"a": "<"}</script>',
      "<script>",
      "  var x = location.hash;",
      '  var y = x.replace("<", "");',
      "</script>",
      "</head></html>",
    );

    expect(
      problemsIn("packages/App/FeatureSet/Example/index.html", page).map(
        (finding: CodeScanningFinding): number => {
          return finding.line;
        },
      ),
    ).toEqual([5]);
    expect(
      templateScripts(page).map((script: { kind: string }): string => {
        return script.kind;
      }),
    ).toEqual(["template code", "inline script"]);
  });
});

describe("CodeScanning - which files are product code", () => {
  let root: string = "";

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "product-code-scanning-"));

    for (const file of [
      "packages/Common/Utils/A.ts",
      "packages/Common/UI/B.tsx",
      "packages/Home/Static/js/c.js",
      "packages/Home/Views/d.ejs",
      "packages/App/FeatureSet/X/public/index.html",
      "ee/Server/E.ts",
      "agents/Agent/F.ts",
      "Scripts/G.js",
      // Not product code.
      "packages/Common/Tests/Utils/A.test.ts",
      "packages/Common/Tests/Helpers/Helper.ts",
      "packages/App/FeatureSet/Y/tests/h.ts",
      "packages/App/FeatureSet/Y/__tests__/i.ts",
      "packages/App/FeatureSet/Y/j.spec.ts",
      "packages/E2E/Specs/k.ts",
      "packages/E2E/Fixtures/l.ejs",
      "packages/Home/Tests/Views/m.ejs",
      "packages/Common/node_modules/n/index.js",
      "packages/Common/build/o.js",
      "packages/App/dist/p.js",
      "packages/Common/Server/Static/Vendor/tailwind/q.js",
      "packages/Home/Static/js/r.min.js",
      "packages/Common/Types/s.d.ts",
      "packages/Common/.hidden/t.ts",
      "packages/Common/README.md",
    ]) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), "");
    }
  });

  afterAll(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  test("code and templates outside tests, builds and vendored builds", () => {
    expect(listProductFiles(root)).toEqual([
      "Scripts/G.js",
      "agents/Agent/F.ts",
      "ee/Server/E.ts",
      "packages/App/FeatureSet/X/public/index.html",
      "packages/Common/UI/B.tsx",
      "packages/Common/Utils/A.ts",
      "packages/Home/Static/js/c.js",
      "packages/Home/Views/d.ejs",
    ]);
  });

  test("only the folders asked for, when they are named", () => {
    expect(listProductFiles(root, ["ee"])).toEqual(["ee/Server/E.ts"]);
  });
});
