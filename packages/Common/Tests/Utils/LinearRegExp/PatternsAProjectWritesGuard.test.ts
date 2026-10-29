import { listProductFiles } from "../../Helpers/CodeScanning";
import { REPOSITORY_DIRECTORY } from "../../Helpers/TagStripScan";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ---------------------------------------------------------------------------
 * A PATTERN A PROJECT'S PEOPLE WRITE RUNS ON THE LINEAR-TIME MATCHER.
 *
 * JavaScript's RegExp backtracks: a pattern such as (a+)+$ takes time that
 * doubles with every character of a text it does not match. The patterns a
 * project's people write - rule and grouping patterns, custom scrub rules,
 * metric pipeline filters, LIKE filters, grok - run on the servers, workers
 * and ingest every project shares, so they run on Utils/LinearRegExp
 * (getLinearRegExp), in time in line with the text they read.
 *
 * This guard reads the code the servers, workers and probes run - every
 * product file of packages/ and ee/ but what a feature set bundles for a
 * browser or a phone (its src/, beside its esbuild.config.js), which runs on
 * the device that opens it - and finds each RegExp built from text not
 * written in its file: a parameter, a field, a value read from somewhere.
 * Each file that builds one is listed below with how many it builds and
 * what they are built from. A new one fails here until it is moved onto the
 * linear-time matcher or listed with what it is built from.
 *
 * A string's match, matchAll and search build a RegExp too, from a text
 * they are handed: "title.match(rule.pattern)" runs the rule's pattern on
 * JavaScript's own engine as surely as new RegExp would. So each such call
 * whose argument is not a pattern written in its file is found as well, and
 * listed with what it reads as a pattern.
 * ---------------------------------------------------------------------------
 */

const CODE_FILE: RegExp = /\.(?:ts|tsx|js|jsx|mjs|cjs)$/;

// A module constant, by this code's naming: SECRET_BODY_PATTERN.
const CONSTANT_NAME: RegExp = /^[A-Z][A-Z0-9]*(?:_[A-Z0-9]+)*$/;

// A feature set's own source folder: packages/App/FeatureSet/<name>/src/.
const FEATURE_SET_SOURCE: RegExp = /^packages\/App\/FeatureSet\/([^/]+)\/src\//;

// ee/ is removed before the Common Test job runs; its files are read when it is there.
const EE_IS_CHECKED_OUT: boolean = fs.existsSync(
  path.join(REPOSITORY_DIRECTORY, "ee"),
);

interface BuiltPattern {
  file: string;
  line: number;
  // The text the RegExp is built from, as the code writes it.
  argument: string;
}

interface ListedFile {
  file: string;
  count: number;
  // What the file builds its patterns from.
  builtFrom: string;
}

const LISTED: ReadonlyArray<ListedFile> = [
  {
    file: "packages/App/FeatureSet/APIReference/Service/DataTypeDetail.ts",
    count: 1,
    builtFrom: "a type name of TypeToDocPath, checked to be letters only",
  },
  {
    file: "packages/App/FeatureSet/Workflow/Utils/SecretRedaction.ts",
    count: 1,
    builtFrom: "secret values, each escaped with escapeRegExp to match itself",
  },
  {
    file: "packages/Common/Server/Infrastructure/Postgres/QueryPropertyNames.ts",
    count: 1,
    builtFrom:
      "the aliases of a query TypeORM builds - entity and relation names - each escaped with escapeRegExp to match itself, as TypeORM's own function builds it",
  },
  {
    file: "packages/Common/Server/Types/MarkdownDocsExtensions.ts",
    count: 1,
    builtFrom: "the container names DOCS_CONTAINER_NAMES lists",
  },
  {
    file: "packages/Common/Server/Utils/AnalyticsDatabase/Statement.ts",
    count: 1,
    builtFrom: "a count of spaces",
  },
  {
    file: "packages/Common/Server/Utils/DataSource/SqlQueryGuard.ts",
    count: 1,
    builtFrom: "the keywords FORBIDDEN_KEYWORDS lists",
  },
  {
    file: "packages/Common/Server/Utils/LogRedaction.ts",
    count: 1,
    builtFrom: "the secret words the file lists",
  },
  {
    file: "packages/Common/Server/Utils/Mcp/McpOAuthSecret.ts",
    count: 1,
    builtFrom: "the token prefixes PREFIX_BY_TOKEN_TYPE lists",
  },
  {
    file: "packages/Common/Server/Utils/Monitor/MonitorPayloadRedaction.ts",
    count: 1,
    builtFrom: "the address prefixes its callers name: monitor, workflow",
  },
  {
    file: "packages/Common/Server/Utils/VM/VMAPI.ts",
    count: 1,
    builtFrom: "a random slot marker of letters and digits",
  },
  {
    file: "packages/Common/Types/HtmlMarkup.ts",
    count: 1,
    builtFrom: "the element names NAMED_ELEMENTS lists",
  },
  {
    file: "packages/Common/Types/Telemetry/ScrubRule.ts",
    count: 1,
    builtFrom: "a copy of one of the built-in scrub patterns",
  },
  {
    file: "packages/Common/UI/Components/Feed/FeedOptions.ts",
    count: 1,
    builtFrom: "the words EVENT_TYPE_WORDS lists",
  },
  {
    file: "packages/Common/UI/Components/Workflow/WebhookTriggerPanel.tsx",
    count: 1,
    builtFrom: "the HTTP method names WEBHOOK_TRIGGER_HTTP_METHODS lists",
  },
  {
    file: "packages/Common/Utils/AiRemediation/KubectlOutputRedactor.ts",
    count: 7,
    builtFrom:
      "the file's JSON string forms, quote marks, tool names and flag letters",
  },
  {
    file: "packages/Common/Utils/AiRemediation/Resource/ProxmoxCommandPolicy.ts",
    count: 1,
    builtFrom: "the reads GUEST_AGENT_READS lists",
  },
  {
    file: "packages/Common/Utils/AiRemediation/Resource/ResourceOutputRedactor.ts",
    count: 7,
    builtFrom:
      "the file's JSON string forms, quote marks, tool names and flag letters",
  },
  {
    file: "packages/Common/Utils/DeveloperDocs/TerraformSchema.ts",
    count: 1,
    builtFrom: "the words TERRAFORM_MIXED_CASE_WORDS lists",
  },
  {
    file: "packages/Common/Utils/LinearRegExp/LinearRegExp.ts",
    count: 1,
    builtFrom:
      "a pattern whose syntax JavaScript checks, for its own error message; it is never run",
  },
  {
    file: "packages/Common/Utils/Telemetry/LogErrorPattern.ts",
    count: 1,
    builtFrom: "the rules LOG_ERROR_PATTERN_RULES lists",
  },
  {
    file: "packages/Home/Static/js/book-reader-core.js",
    count: 1,
    builtFrom: "a chapter number",
  },
  {
    file: "packages/Home/Static/js/getCookies.js",
    count: 1,
    builtFrom: "a cookie name the site's own scripts pass",
  },
  {
    file: "packages/Home/Utils/Claims.ts",
    count: 1,
    builtFrom: "the edition and sign-on names the file lists",
  },
  {
    file: "packages/Probe/Utils/Monitors/SyntheticRuntime/PlaywrightCapabilityBroker.ts",
    count: 1,
    builtFrom:
      "a synthetic monitor script's own argument, in the process of that one run, which the probe stops at the run's time limit",
  },
];

/*
 * Calls of match, matchAll or search, with one argument, that is not a
 * pattern written in the file: what each file's calls read as a pattern.
 */
const LISTED_PATTERN_ARGUMENTS: ReadonlyArray<ListedFile> = [
  {
    file: "packages/Common/Types/StatusPage/SubscriberNotificationTemplateCompiler.ts",
    count: 1,
    builtFrom:
      "the placeholder pattern the class writes (getPlaceholderPattern)",
  },
  {
    file: "packages/Common/Types/Telemetry/ScrubRule.ts",
    count: 1,
    builtFrom:
      "nothing: the linear-time matcher's own matchAll, over the file's probe texts",
  },
  {
    file: "packages/Common/UI/Components/CommandPalette/UseProviderSearch.ts",
    count: 1,
    builtFrom:
      "nothing: a command palette provider's own search, handed what was typed",
  },
  {
    file: "packages/Common/Utils/Markdown/MarkdownDataUrls.ts",
    count: 1,
    builtFrom: "nothing: a scanner's own match method, handed a position",
  },
  {
    file: "packages/Common/Utils/Markdown/UntrustedMarkdown.ts",
    count: 1,
    builtFrom: "the global patterns the file passes, each written in it",
  },
  {
    file: "packages/Common/Utils/Monitor/MetricValueFormatter.ts",
    count: 1,
    builtFrom: "the braced-unit pattern the class writes",
  },
  {
    file: "packages/Common/Utils/Syslog/SyslogVendorParser.ts",
    count: 1,
    builtFrom: "the vendor parsers' own rule patterns, each a pattern literal",
  },
  {
    file: "packages/Common/Utils/VersionUtil.ts",
    count: 1,
    builtFrom: "the version pattern the class writes",
  },
  {
    file: "packages/Home/Static/js/animate.js",
    count: 1,
    builtFrom:
      "the number pattern the site's animation script writes, in a visitor's browser",
  },
  {
    file: "packages/Probe/Utils/Monitors/MonitorTypes/SqlMonitor.ts",
    count: 1,
    builtFrom: "the patterns FORBIDDEN_CONSTRUCTS lists",
  },
  {
    file: "packages/Probe/Utils/Monitors/SyntheticRuntime/ProcessTreeMemory.ts",
    count: 1,
    builtFrom: "the kilobyte-line patterns the file passes, each a literal",
  },
];

/*
 * The code that runs the patterns a project's people write: each imports
 * the linear-time matcher, or RulePatternMatchUtil, which runs them on it.
 */
const RUNS_PATTERNS_A_PROJECT_WRITES: ReadonlyArray<string> = [
  "packages/Common/Utils/Rules/RulePatternMatchUtil.ts",
  "packages/Common/Utils/Rules/RuleCriteriaMatcher.ts",
  "packages/Common/Types/Telemetry/ScrubRule.ts",
  "packages/Common/Utils/Grok/Grok.ts",
  "packages/App/FeatureSet/Telemetry/Services/MetricPipelineRuleService.ts",
  "packages/App/FeatureSet/Telemetry/Utils/LogFilterEvaluator.ts",
];

// The string methods that read their argument as a pattern.
const PATTERN_READING_METHODS: ReadonlySet<string> = new Set<string>([
  "match",
  "matchAll",
  "search",
]);

const PATTERN_READING_CALL: RegExp = /\.(?:match|matchAll|search)\(/;

// A class's name, by this code's naming: QueryHelper.
const CLASS_NAME: RegExp = /^[A-Z]/;

const LINEAR_REGEXP_IMPORT: RegExp =
  /from "[^"]*(?:\/LinearRegExp\/(?:LinearRegExp|PatternCache)|\/RulePatternMatchUtil)"/;

function constInitializer(
  source: ts.SourceFile,
  name: string,
): ts.Expression | null {
  let found: ts.Expression | null = null;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer &&
      ts.isVariableDeclarationList(node.parent) &&
      (node.parent.flags & ts.NodeFlags.Const) !== 0
    ) {
      found = node.initializer;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

/*
 * Whether a pattern's text is written in its file: a literal, a module
 * constant, a const of the file that holds such text, the source of a
 * pattern literal or of a module constant, text escaped to match itself
 * (escapeRegExp), and templates and sums of these.
 */
function isWrittenHere(
  source: ts.SourceFile,
  expression: ts.Expression,
  depth: number = 0,
): boolean {
  if (depth > 6) {
    return false;
  }

  if (ts.isStringLiteralLike(expression) || ts.isNumericLiteral(expression)) {
    return true;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression)
  ) {
    return isWrittenHere(source, expression.expression, depth + 1);
  }

  if (ts.isTemplateExpression(expression)) {
    return expression.templateSpans.every((span: ts.TemplateSpan): boolean => {
      return isWrittenHere(source, span.expression, depth + 1);
    });
  }

  if (
    ts.isBinaryExpression(expression) &&
    expression.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    return (
      isWrittenHere(source, expression.left, depth + 1) &&
      isWrittenHere(source, expression.right, depth + 1)
    );
  }

  if (ts.isIdentifier(expression)) {
    if (CONSTANT_NAME.test(expression.text)) {
      return true;
    }

    const initializer: ts.Expression | null = constInitializer(
      source,
      expression.text,
    );

    return (
      initializer !== null && isWrittenHere(source, initializer, depth + 1)
    );
  }

  // A class's or a module's constant: this.WORKSPACE_NAME_PREFIX.
  if (
    ts.isPropertyAccessExpression(expression) &&
    CONSTANT_NAME.test(expression.name.text)
  ) {
    return true;
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    expression.name.text === "source"
  ) {
    const owner: ts.Expression = expression.expression;

    if (owner.kind === ts.SyntaxKind.RegularExpressionLiteral) {
      return true;
    }

    if (ts.isIdentifier(owner)) {
      const initializer: ts.Expression | null = constInitializer(
        source,
        owner.text,
      );

      return (
        CONSTANT_NAME.test(owner.text) ||
        initializer?.kind === ts.SyntaxKind.RegularExpressionLiteral
      );
    }

    return false;
  }

  return (
    ts.isCallExpression(expression) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "escapeRegExp"
  );
}

// Every RegExp a file's code builds from text not written in the file.
function builtPatternsIn(file: string, text: string): Array<BuiltPattern> {
  const found: Array<BuiltPattern> = [];

  if (!text.includes("RegExp")) {
    return found;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      (ts.isNewExpression(node) || ts.isCallExpression(node)) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "RegExp" &&
      node.arguments?.[0] &&
      !isWrittenHere(source, node.arguments[0])
    ) {
      found.push({
        file: file,
        line:
          source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1,
        argument: node.arguments[0]
          .getText(source)
          .replace(/\s+/g, " ")
          .slice(0, 80),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

// Whether an argument is a pattern written in the file: a RegExp, never a text.
function isPatternWrittenHere(
  source: ts.SourceFile,
  expression: ts.Expression,
  depth: number = 0,
): boolean {
  if (depth > 6) {
    return false;
  }

  if (expression.kind === ts.SyntaxKind.RegularExpressionLiteral) {
    return true;
  }

  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isAsExpression(expression) ||
    ts.isNonNullExpression(expression)
  ) {
    return isPatternWrittenHere(source, expression.expression, depth + 1);
  }

  if (ts.isConditionalExpression(expression)) {
    return (
      isPatternWrittenHere(source, expression.whenTrue, depth + 1) &&
      isPatternWrittenHere(source, expression.whenFalse, depth + 1)
    );
  }

  // Built where it is passed: the RegExp finder above judges what from.
  if (
    (ts.isNewExpression(expression) || ts.isCallExpression(expression)) &&
    ts.isIdentifier(expression.expression) &&
    expression.expression.text === "RegExp"
  ) {
    return true;
  }

  if (ts.isIdentifier(expression)) {
    if (CONSTANT_NAME.test(expression.text)) {
      return true;
    }

    const initializer: ts.Expression | null = constInitializer(
      source,
      expression.text,
    );

    return (
      initializer !== null &&
      isPatternWrittenHere(source, initializer, depth + 1)
    );
  }

  return (
    ts.isPropertyAccessExpression(expression) &&
    CONSTANT_NAME.test(expression.name.text)
  );
}

/*
 * Every call of a string's match, matchAll or search - one argument, on a
 * value rather than a class - whose argument is not a pattern written in the
 * file: a text handed to one is read as a pattern.
 */
function patternArgumentsIn(file: string, text: string): Array<BuiltPattern> {
  const found: Array<BuiltPattern> = [];

  if (!PATTERN_READING_CALL.test(text)) {
    return found;
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith("x") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      PATTERN_READING_METHODS.has(node.expression.name.text) &&
      node.arguments.length === 1
    ) {
      const argument: ts.Expression = node.arguments[0]!;
      const receiver: ts.Expression = node.expression.expression;
      // QueryHelper.search(...): a class's own method, not a string's.
      const isClass: boolean =
        ts.isIdentifier(receiver) && CLASS_NAME.test(receiver.text);

      if (
        !isClass &&
        !ts.isObjectLiteralExpression(argument) &&
        !isPatternWrittenHere(source, argument)
      ) {
        found.push({
          file: file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          argument: node.getText(source).replace(/\s+/g, " ").slice(0, 80),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

// Whether a file is bundled for a browser or a phone, so runs on the device.
function isBundledForADevice(file: string): boolean {
  const featureSet: string | undefined = FEATURE_SET_SOURCE.exec(file)?.[1];

  return (
    featureSet !== undefined &&
    fs.existsSync(
      path.join(
        REPOSITORY_DIRECTORY,
        "packages/App/FeatureSet",
        featureSet,
        "esbuild.config.js",
      ),
    )
  );
}

function builtPatternsInServerCode(
  finder: (file: string, text: string) => Array<BuiltPattern> = builtPatternsIn,
): Map<string, Array<BuiltPattern>> {
  const byFile: Map<string, Array<BuiltPattern>> = new Map();

  for (const file of listProductFiles(REPOSITORY_DIRECTORY, [
    "packages",
    "ee",
  ])) {
    if (!CODE_FILE.test(file) || isBundledForADevice(file)) {
      continue;
    }

    const built: Array<BuiltPattern> = finder(
      file,
      fs.readFileSync(path.join(REPOSITORY_DIRECTORY, file), "utf8"),
    );

    if (built.length > 0) {
      byFile.set(file, built);
    }
  }

  return byFile;
}

// What each file builds that is not listed as it is: empty when all are.
function unlistedIn(
  byFile: Map<string, Array<BuiltPattern>>,
  listedFiles: ReadonlyArray<ListedFile>,
): Array<string> {
  const problems: Array<string> = [];

  for (const [file, built] of byFile) {
    const listed: ListedFile | undefined = listedFiles.find(
      (entry: ListedFile): boolean => {
        return entry.file === file;
      },
    );

    if (!listed || listed.count !== built.length) {
      problems.push(
        [
          `${file} builds ${built.length} (listed: ${listed ? listed.count : 0}). Run a pattern a project's people write with getLinearRegExp (Common/Utils/LinearRegExp/PatternCache), or list what these are built from:`,
          ...built.map((entry: BuiltPattern): string => {
            return `    ${entry.line}: ${entry.argument}`;
          }),
        ].join("\n"),
      );
    }
  }

  for (const listed of listedFiles) {
    if (
      !byFile.has(listed.file) &&
      (EE_IS_CHECKED_OUT || !listed.file.startsWith("ee/"))
    ) {
      problems.push(`${listed.file} is listed, but builds none now.`);
    }
  }

  return problems;
}

describe("the finder", () => {
  function argumentsFound(code: string): Array<string> {
    return builtPatternsIn("Example.ts", code).map(
      (built: BuiltPattern): string => {
        return built.argument;
      },
    );
  }

  test("finds a RegExp built from a rule's field, a parameter, or another object's source", () => {
    expect(
      argumentsFound(
        [
          'const a: RegExp = new RegExp(rule.monitorNamePattern, "i");',
          "function b(pattern: string): boolean { return RegExp(pattern).test(x); }",
          "const c: RegExp = new RegExp(`^${value}$`);",
          "const d: RegExp = new RegExp(descriptor.source, descriptor.flags);",
          "let e: string = read(); const f: RegExp = new RegExp(e);",
        ].join("\n"),
      ),
    ).toEqual([
      "rule.monitorNamePattern",
      "pattern",
      "`^${value}$`",
      "descriptor.source",
      "e",
    ]);
  });

  test("passes over a RegExp built from text written in the file", () => {
    expect(
      argumentsFound(
        [
          'const A: RegExp = new RegExp("^api-");',
          'const PREFIX: string = "db"; const B: RegExp = new RegExp(`^${PREFIX}-\\\\d+`);',
          'const prefix: string = "db"; const C: RegExp = new RegExp(prefix + "$");',
          'const D: RegExp = new RegExp(/x+/.source, "g");',
          'const E: RegExp = new RegExp(WORD_PATTERN.source, "g");',
          "const F: RegExp = new RegExp(`^${escapeRegExp(name)}$`);",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("reads the code the servers run, and finds what it should there", () => {
    const byFile: Map<
      string,
      Array<BuiltPattern>
    > = builtPatternsInServerCode();

    expect(byFile.size).toBeGreaterThan(10);
    expect(
      byFile.has("packages/Common/Server/Utils/DataSource/SqlQueryGuard.ts"),
    ).toBe(true);
  });

  test("finds a string's match, matchAll or search handed a text, as a pattern", () => {
    expect(
      patternArgumentsIn(
        "Example.ts",
        [
          "const a: boolean = title.match(rule.alertTitlePattern) !== null;",
          "const b: number = value.search(pattern);",
          "for (const m of text.matchAll(source)) { use(m); }",
          "const c: unknown = name.match(`^${prefix}`);",
          'const d: unknown = name.match(enabled ? "a+" : PATTERN);',
        ].join("\n"),
      ).map((found: BuiltPattern): string => {
        return found.argument;
      }),
    ).toEqual([
      "title.match(rule.alertTitlePattern)",
      "value.search(pattern)",
      "text.matchAll(source)",
      "name.match(`^${prefix}`)",
      'name.match(enabled ? "a+" : PATTERN)',
    ]);
  });

  test("passes over a pattern written in the file, and calls that are not a string's", () => {
    expect(
      patternArgumentsIn(
        "Example.ts",
        [
          "const A: unknown = line.match(/^(\\d+)/);",
          "const B: unknown = line.match(WORD_PATTERN);",
          "const C: unknown = line.match(Parser.DIGITS);",
          "const local: RegExp = /x+/g; const D: unknown = line.matchAll(local);",
          "const E: unknown = line.match(first ? HEAD : TAIL);",
          'const F: unknown = line.match(new RegExp("^a"));',
          "const G: unknown = QueryHelper.search(text);",
          "const H: unknown = service.search({ text: text });",
          "const I: unknown = this.match(item, id, note);",
        ].join("\n"),
      ),
    ).toEqual([]);
  });

  test("leaves out what is bundled for a browser or a phone", () => {
    expect(
      isBundledForADevice(
        "packages/App/FeatureSet/Dashboard/src/Utils/ErrorPatternInsights.ts",
      ),
    ).toBe(true);
    expect(
      isBundledForADevice(
        "packages/App/FeatureSet/Telemetry/Utils/LogFilterEvaluator.ts",
      ),
    ).toBe(false);
    expect(isBundledForADevice("packages/Common/Utils/Grok/Grok.ts")).toBe(
      false,
    );
  });
});

describe("RegExps the servers, workers and probes build from text not written in their code", () => {
  test("each is in a file listed with what it builds them from", () => {
    expect(unlistedIn(builtPatternsInServerCode(), LISTED)).toEqual([]);
  });

  test("each listed file says what it builds them from", () => {
    for (const listed of [...LISTED, ...LISTED_PATTERN_ARGUMENTS]) {
      expect(listed.builtFrom.length).toBeGreaterThan(10);
      expect(listed.count).toBeGreaterThan(0);
    }
  });
});

describe("texts the servers, workers and probes hand a string's match, matchAll or search", () => {
  test("each is in a file listed with what it reads as a pattern", () => {
    expect(
      unlistedIn(
        builtPatternsInServerCode(patternArgumentsIn),
        LISTED_PATTERN_ARGUMENTS,
      ),
    ).toEqual([]);
  });
});

describe("the code that runs the patterns a project's people write", () => {
  test.each(RUNS_PATTERNS_A_PROJECT_WRITES)(
    "%s runs them on the linear-time matcher",
    (file: string) => {
      const text: string = fs.readFileSync(
        path.join(REPOSITORY_DIRECTORY, file),
        "utf8",
      );

      expect(text).toMatch(LINEAR_REGEXP_IMPORT);
      expect(builtPatternsIn(file, text).length).toBe(
        LISTED.find((entry: ListedFile): boolean => {
          return entry.file === file;
        })?.count || 0,
      );
    },
  );
});
