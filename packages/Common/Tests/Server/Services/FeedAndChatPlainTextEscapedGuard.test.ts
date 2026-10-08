import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * FEED AND CHAT MARKDOWN IS WRITTEN WITH mdText, AND ONLY WITH mdText.
 *
 * Feed items - of incidents, alerts, both kinds of episode, scheduled
 * maintenance events, monitors, on-call policies, SLOs and every
 * infrastructure resource - are Markdown that the dashboard renders without
 * its safe mode, that emails render with marked and that is posted to Slack
 * and Microsoft Teams; so are the Slack and Teams messages OneUptime writes.
 * Each places text OneUptime did not write - a title, a name, a label, a
 * host an agent reported - and text placed into Markdown as it is becomes a
 * link whose words hide where it goes, an image, raw HTML or a Slack mention.
 *
 * Escaping each value by hand where it is placed missed values, one feed
 * sentence at a time. So that Markdown is written with the `mdText` tag
 * (Common/Utils/Markdown/FeedMarkdown), which escapes every value for the
 * place it sits in by default, and this guard holds the code to it:
 *
 *   A. In every file that writes feed or chat Markdown (below), a template
 *      literal with values in it that is Markdown - "**", "](", a "`", a
 *      heading, a list item or a quote at the start of a line, or assigned
 *      to something named for Markdown - is tagged `mdText`. A Markdown
 *      string is not joined to a value with "+" either.
 *   B. Nothing outside Common/Utils/Markdown imports MarkdownEscape or
 *      UntrustedMarkdown: FeedMarkdown is the one way into them, so there is
 *      no second path that escapes, or forgets to, by hand.
 *   C. No value placed into `mdText` is an Array's `.join(...)` or the
 *      `.toString()` of Markdown: a list of Markdown pieces is joined with
 *      FeedMarkdown.join, and Markdown stays a MarkdownText until it reaches
 *      its sink - placed as a string it would be escaped a second time.
 *
 * A template that is right to stay untagged - an LLM prompt, a log line -
 * goes in ALLOWED_UNTAGGED with its reason. The list only shrinks: the guard
 * fails on an entry that no longer matches anything.
 *
 * ee/Server is read when it is there (CI deletes ee/ for the open-source
 * build, so the guard must pass without it too).
 */

// packages/Common/Tests/Server/Services -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");
// packages/Common -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

// Where feed and chat Markdown is written (rules A and C).
const SINK_SCAN_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages", "Common", "Server"),
  path.join(REPOSITORY_ROOT, "packages", "Common", "Types"),
  path.join(REPOSITORY_ROOT, "packages", "Common", "Utils"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

// Every package's source, for imports of the escapers (rule B).
const IMPORT_SCAN_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages"),
  path.join(REPOSITORY_ROOT, "ee"),
];

// The one directory whose code may import the escapers.
const MARKDOWN_UTILS_DIRECTORY: string = "packages/Common/Utils/Markdown/";

// A feed item of any kind: createIncidentFeedItem, createHostFeedItem, ...
const FEED_ITEM_WRITER_PATTERN: RegExp = /\.create[A-Z][A-Za-z]*FeedItem\(/;

// The Slack and Microsoft Teams integration: every message it builds.
const CHAT_DIRECTORY: string = "packages/Common/Server/Utils/Workspace/";

// The worker jobs: owners' notifications, subscribers' messages, reminders.
const JOBS_DIRECTORY: string = "packages/App/FeatureSet/Workers/Jobs/";

// Code that writes with mdText reads as a sink, whatever else it does.
const FEED_MARKDOWN_IMPORT_PATTERN: RegExp = /Markdown\/FeedMarkdown"/;

/*
 * Shared builders of feed and chat Markdown, read even if one stopped
 * importing FeedMarkdown. The guard fails when one of them is gone.
 */
const BUILDER_FILES: ReadonlyArray<string> = [
  "packages/Common/Server/Services/WorkspaceNotificationSummaryService.ts",
  "packages/Common/Server/Services/UserNotificationRuleService.ts",
  "packages/Common/Server/Services/UserService.ts",
  "packages/Common/Server/Services/StatusPageSubscriberService.ts",
  "packages/Common/Server/Utils/AffectedResources/LinkedAffectedResources.ts",
  "packages/Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts",
  "packages/Common/Server/Utils/Monitor/RootCauseList.ts",
  "packages/Common/Server/Utils/Monitor/AffectedResourceList.ts",
  "packages/Common/Server/Utils/Monitor/PerSeriesResolutionRootCause.ts",
  "packages/Common/Server/Utils/Monitor/MonitorResource.ts",
  "packages/Common/Server/Utils/Rules/RuleFeedMarkdown.ts",
  "packages/Common/Server/Utils/VideoCall/VideoCallMessages.ts",
  "packages/Common/Server/Utils/Form/FormSubmissionNote.ts",
  "packages/Common/Server/Utils/StatusPage/SubscriberNotificationDeliveryRecord.ts",
  "packages/Common/Types/Monitor/SeriesContext/SeriesLabelDisplay.ts",
  "packages/Common/Types/Monitor/SeriesContext/SeriesDebugHints.ts",
  "packages/Common/Utils/Slo/SloFeedMarkdown.ts",
];

/*
 * Markdown in a template's own text: bold, a link, a code span, or a
 * heading, a list item or a quote at the start of a line.
 */
const MARKDOWN_TEXT_PATTERN: RegExp =
  /(?<!\*)\*\*(?!\*)|\]\(|`|(?:^|\n)[ \t]*(?:#{1,6} |- |> )/;

// A value named for Markdown: built as Markdown, placed as Markdown.
const MARKDOWN_VALUE_NAME_PATTERN: RegExp = /markdown$/i;

// Something a template is assigned to that is named for Markdown.
const MARKDOWN_TARGET_PATTERN: RegExp = /markdown|feedInfo|moreInformation/i;

/*
 * Untagged Markdown templates that are right as they are, each with its
 * reason: by file and either a piece of the template's own text or the
 * function the template is written in.
 */
interface AllowedUntagged {
  file: string;
  text?: string | undefined;
  inFunction?: string | undefined;
  reason: string;
}

const REMEDIATION_RUNNER: string =
  "packages/Common/Server/Utils/AI/Remediation/RemediationExecutionRunner.ts";
const PROMPT_REASON: string =
  "The text OneUptime AI is given to work from - a prompt, never shown in a feed or a chat.";

const ALLOWED_UNTAGGED: Array<AllowedUntagged> = [
  {
    file: REMEDIATION_RUNNER,
    text: "You are OneUptime AI, OneUptime's autonomous AI Site Reliability Engineer",
    reason: PROMPT_REASON,
  },
  ...[
    "buildClusterFramingRules",
    "buildResourceFramingRules",
    "buildExecutionContext",
    "describeResourceTarget",
    "describePreviousRounds",
  ].map((inFunction: string): AllowedUntagged => {
    return {
      file: REMEDIATION_RUNNER,
      inFunction: inFunction,
      reason: PROMPT_REASON,
    };
  }),
  {
    file: "packages/Common/Server/Utils/AI/Remediation/RemediationPlanRunner.ts",
    inFunction: "buildPlanningContext",
    reason: PROMPT_REASON,
  },
  {
    file: "packages/Common/Server/Utils/AI/SRE/AlertInvestigationRunner.ts",
    inFunction: "buildAlertSummary",
    reason: PROMPT_REASON,
  },
  {
    file: "packages/Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts",
    inFunction: "buildIncidentSummary",
    reason: PROMPT_REASON,
  },
  {
    file: "packages/Common/Server/Utils/Monitor/MonitorCriteriaEvaluator.ts",
    text: "`\\n- ${item}`",
    reason:
      "The evaluation summary's message, shown as plain text; the root cause beside it places each finding with mdText.",
  },
  {
    file: "packages/Common/Types/Monitor/SeriesContext/SeriesLabelDisplay.ts",
    inFunction: "buildTitleSuffix",
    reason:
      "A suffix of an alert's or incident's title, which is plain text: wherever a title is placed into Markdown, it is placed as text.",
  },
  {
    file: "packages/App/FeatureSet/Workers/Jobs/Rum/ProcessSessionErasureRequests.ts",
    inFunction: "buildErasedSessionTraceIdStatement",
    reason: "A ClickHouse statement, not Markdown.",
  },
];

export interface GuardFinding {
  file: string;
  line: number;
  rule: "A" | "B" | "C";
  text: string;
}

function lineOf(source: ts.SourceFile, node: ts.Node): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function templateText(template: ts.TemplateExpression): string {
  return [
    template.head.text,
    ...template.templateSpans.map((span: ts.TemplateSpan): string => {
      return span.literal.text;
    }),
  ].join("\u0000");
}

// The name of what an expression (through parentheses, `||`, `?:`, `+`, await) is assigned to.
function assignmentTargetName(node: ts.Node): string | null {
  let current: ts.Node = node;
  let parent: ts.Node | undefined = current.parent;

  while (
    parent &&
    (ts.isParenthesizedExpression(parent) ||
      ts.isConditionalExpression(parent) ||
      ts.isAwaitExpression(parent) ||
      (ts.isBinaryExpression(parent) &&
        (parent.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
          parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
          parent.operatorToken.kind === ts.SyntaxKind.PlusToken)))
  ) {
    current = parent;
    parent = current.parent;
  }

  if (!parent) {
    return null;
  }

  if (ts.isVariableDeclaration(parent) && ts.isIdentifier(parent.name)) {
    return parent.name.text;
  }

  if (ts.isPropertyAssignment(parent)) {
    return parent.name.getText();
  }

  if (
    ts.isBinaryExpression(parent) &&
    (parent.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
      parent.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken)
  ) {
    return parent.left.getText();
  }

  return null;
}

function calleeText(call: ts.CallExpression | ts.NewExpression): string {
  return call.expression.getText();
}

/*
 * Text that is not Markdown placed anywhere: a log line, an error, or the
 * text of a code span FeedMarkdown.code writes around it.
 */
function isOutsideMarkdown(node: ts.Node): boolean {
  let current: ts.Node = node;
  let parent: ts.Node | undefined = node.parent;

  while (parent && !ts.isSourceFile(parent)) {
    if (ts.isCallExpression(parent) || ts.isNewExpression(parent)) {
      const callee: string = calleeText(parent);

      if (/^logger\.|^console\.|Error$/.test(callee)) {
        return true;
      }

      const callArguments: ReadonlyArray<ts.Expression> = parent.arguments || [];

      if (
        /(?:^|\.)code$|\.codeWithId$/.test(callee) &&
        callArguments.includes(current as ts.Expression)
      ) {
        return true;
      }
    }

    if (ts.isThrowStatement(parent)) {
      return true;
    }

    if (
      ts.isBlock(parent) ||
      ts.isClassDeclaration(parent) ||
      ts.isTaggedTemplateExpression(parent)
    ) {
      return false;
    }

    current = parent;
    parent = parent.parent;
  }

  return false;
}

function isMdTextTag(node: ts.Node): node is ts.TaggedTemplateExpression {
  return ts.isTaggedTemplateExpression(node) && node.tag.getText() === "mdText";
}

function isMarkdownLiteral(expression: ts.Expression): boolean {
  return (
    (ts.isStringLiteral(expression) ||
      ts.isNoSubstitutionTemplateLiteral(expression)) &&
    MARKDOWN_TEXT_PATTERN.test(expression.text)
  );
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isNonNullExpression(current) ||
    ts.isAsExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

/*
 * A value - not a literal, not Markdown written with mdText or FeedMarkdown -
 * that a "+" would put into Markdown as it is.
 */
function isRawValue(expression: ts.Expression): boolean {
  const unwrapped: ts.Expression = unwrap(expression);

  if (MARKDOWN_VALUE_NAME_PATTERN.test(valueName(unwrapped))) {
    return false;
  }

  if (
    ts.isStringLiteral(unwrapped) ||
    ts.isNoSubstitutionTemplateLiteral(unwrapped) ||
    ts.isNumericLiteral(unwrapped) ||
    isMdTextTag(unwrapped)
  ) {
    return false;
  }

  if (ts.isTemplateExpression(unwrapped)) {
    return !MARKDOWN_TEXT_PATTERN.test(templateText(unwrapped));
  }

  if (ts.isCallExpression(unwrapped)) {
    const callee: string = calleeText(unwrapped);

    // mdText`...`.toString(), FeedMarkdown.join(...).toString(), ...
    if (/\.toString$/.test(callee)) {
      const target: ts.Expression = unwrap(
        (unwrapped.expression as ts.PropertyAccessExpression).expression,
      );

      return !(
        isMdTextTag(target) ||
        (ts.isCallExpression(target) &&
          /^FeedMarkdown\./.test(calleeText(target)))
      );
    }

    return !/^FeedMarkdown\./.test(callee);
  }

  if (ts.isConditionalExpression(unwrapped)) {
    return isRawValue(unwrapped.whenTrue) || isRawValue(unwrapped.whenFalse);
  }

  return (
    ts.isIdentifier(unwrapped) ||
    ts.isPropertyAccessExpression(unwrapped) ||
    ts.isElementAccessExpression(unwrapped)
  );
}

// The operands of a chain of "+", left to right.
function concatenationOperands(
  node: ts.BinaryExpression,
): Array<ts.Expression> {
  const operands: Array<ts.Expression> = [];

  const collect: (expression: ts.Expression) => void = (
    expression: ts.Expression,
  ): void => {
    const unwrapped: ts.Expression = ts.isParenthesizedExpression(expression)
      ? expression.expression
      : expression;

    if (
      ts.isBinaryExpression(unwrapped) &&
      unwrapped.operatorToken.kind === ts.SyntaxKind.PlusToken
    ) {
      collect(unwrapped.left);
      collect(unwrapped.right);
      return;
    }

    operands.push(expression);
  };

  collect(node);

  return operands;
}

// The name of the function or method a node is written in, if any.
function enclosingFunctionName(node: ts.Node): string | null {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isSourceFile(current)) {
    if (
      (ts.isFunctionDeclaration(current) || ts.isMethodDeclaration(current)) &&
      current.name
    ) {
      return current.name.getText();
    }

    if (
      (ts.isArrowFunction(current) || ts.isFunctionExpression(current)) &&
      ts.isVariableDeclaration(current.parent) &&
      ts.isIdentifier(current.parent.name)
    ) {
      return current.parent.name.text;
    }

    current = current.parent;
  }

  return null;
}

// The allowances a scan has used: one that is never used is stale.
const USED_ALLOWANCES: Set<AllowedUntagged> = new Set<AllowedUntagged>();

function isAllowedUntagged(file: string, node: ts.Node, text: string): boolean {
  const allowance: AllowedUntagged | undefined = ALLOWED_UNTAGGED.find(
    (entry: AllowedUntagged): boolean => {
      if (entry.file !== file) {
        return false;
      }

      if (entry.text !== undefined) {
        return text.includes(entry.text);
      }

      return enclosingFunctionName(node) === entry.inFunction;
    },
  );

  if (allowance) {
    USED_ALLOWANCES.add(allowance);
  }

  return Boolean(allowance);
}

// The name an expression goes by: a variable's, a property's or a function's.
function valueName(expression: ts.Expression): string {
  const unwrapped: ts.Expression = unwrap(expression);

  if (ts.isIdentifier(unwrapped)) {
    return unwrapped.text;
  }

  if (ts.isPropertyAccessExpression(unwrapped)) {
    return unwrapped.name.text;
  }

  if (ts.isCallExpression(unwrapped)) {
    if (
      ts.isPropertyAccessExpression(unwrapped.expression) &&
      unwrapped.expression.name.text === "toString"
    ) {
      return valueName(unwrapped.expression.expression);
    }

    return valueName(unwrapped.expression);
  }

  return "";
}

/**
 * Rules A and C over one file that writes feed or chat Markdown.
 */
export function findUntaggedFeedMarkdown(
  file: string,
  sourceText: string,
): Array<GuardFinding> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Array<GuardFinding> = [];

  const report: (node: ts.Node, rule: "A" | "C") => void = (
    node: ts.Node,
    rule: "A" | "C",
  ): void => {
    const text: string = node.getText(source);

    if (rule === "A" && isAllowedUntagged(file, node, text)) {
      return;
    }

    found.push({
      file: file,
      line: lineOf(source, node),
      rule: rule,
      text: text.slice(0, 120),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    // A: an untagged Markdown template with values in it.
    if (
      ts.isTemplateExpression(node) &&
      !ts.isTaggedTemplateExpression(node.parent) &&
      !isOutsideMarkdown(node)
    ) {
      const target: string | null = assignmentTargetName(node);

      if (
        MARKDOWN_TEXT_PATTERN.test(templateText(node)) ||
        (target !== null && MARKDOWN_TARGET_PATTERN.test(target))
      ) {
        report(node, "A");
      }
    }

    // A: a Markdown string joined to a value with "+".
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      !(
        ts.isBinaryExpression(node.parent) &&
        node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
      ) &&
      !isOutsideMarkdown(node)
    ) {
      const operands: Array<ts.Expression> = concatenationOperands(node);

      if (operands.some(isMarkdownLiteral) && operands.some(isRawValue)) {
        report(node, "A");
      }
    }

    // A: a value appended as it is to something named for Markdown.
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken &&
      MARKDOWN_TARGET_PATTERN.test(node.left.getText(source)) &&
      isRawValue(node.right)
    ) {
      report(node, "A");
    }

    // C: what goes into mdText is not a joined string or Markdown's string.
    if (isMdTextTag(node) && ts.isTemplateExpression(node.template)) {
      for (const span of node.template.templateSpans) {
        const value: ts.Expression = unwrap(span.expression);

        if (!ts.isCallExpression(value)) {
          continue;
        }

        const callee: string = calleeText(value);

        if (/\.join$/.test(callee) && !/^FeedMarkdown\./.test(callee)) {
          report(span.expression, "C");
        }

        if (/\.toString$/.test(callee)) {
          const target: ts.Expression = unwrap(
            (value.expression as ts.PropertyAccessExpression).expression,
          );

          if (
            isMdTextTag(target) ||
            (ts.isCallExpression(target) &&
              /^FeedMarkdown\./.test(calleeText(target)))
          ) {
            report(span.expression, "C");
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const ESCAPER_MODULE_PATTERN: RegExp = /(?:^|\/)(MarkdownEscape|UntrustedMarkdown)$/;

/**
 * Rule B over one file: its imports of MarkdownEscape and UntrustedMarkdown.
 */
export function findEscaperImports(
  file: string,
  sourceText: string,
): Array<GuardFinding> {
  if (file.startsWith(MARKDOWN_UTILS_DIRECTORY)) {
    return [];
  }

  const source: ts.SourceFile = ts.createSourceFile(
    file,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );
  const found: Array<GuardFinding> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    let specifier: string | null = null;

    if (
      (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
      node.moduleSpecifier &&
      ts.isStringLiteral(node.moduleSpecifier)
    ) {
      specifier = node.moduleSpecifier.text;
    }

    if (
      ts.isCallExpression(node) &&
      (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
        node.expression.getText(source) === "require") &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      specifier = node.arguments[0].text;
    }

    if (specifier !== null && ESCAPER_MODULE_PATTERN.test(specifier)) {
      found.push({
        file: file,
        line: lineOf(source, node),
        rule: "B",
        text: node.getText(source).slice(0, 120),
      });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function listSourceFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (
      [
        "node_modules",
        "build",
        "dist",
        "Tests",
        "coverage",
        ".git",
      ].includes(entry.name)
    ) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !entry.name.endsWith(".d.ts")
    ) {
      files.push(fullPath);
    }
  }

  return files;
}

function toRepositoryPath(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

interface SourceFile {
  file: string;
  sourceText: string;
}

function isSink(file: string, sourceText: string): boolean {
  return (
    file.startsWith(CHAT_DIRECTORY) ||
    file.startsWith(JOBS_DIRECTORY) ||
    BUILDER_FILES.includes(file) ||
    FEED_ITEM_WRITER_PATTERN.test(sourceText) ||
    FEED_MARKDOWN_IMPORT_PATTERN.test(sourceText)
  );
}

function readSinkFiles(): Array<SourceFile> {
  const sinks: Array<SourceFile> = [];

  for (const root of SINK_SCAN_ROOTS) {
    for (const fullPath of listSourceFiles(root)) {
      const file: string = toRepositoryPath(fullPath);

      if (file.startsWith(MARKDOWN_UTILS_DIRECTORY) || /\.tsx$/.test(file)) {
        continue;
      }

      const sourceText: string = fs.readFileSync(fullPath, "utf8");

      if (isSink(file, sourceText)) {
        sinks.push({ file: file, sourceText: sourceText });
      }
    }
  }

  return sinks;
}

function describeFindings(findings: Array<GuardFinding>): Array<string> {
  return findings.map((finding: GuardFinding): string => {
    return `${finding.file}:${finding.line} [${finding.rule}] ${finding.text}`;
  });
}

describe("feed and chat Markdown is written with mdText", () => {
  const sinks: Array<SourceFile> = readSinkFiles();

  let sinkFindings: Array<GuardFinding> | null = null;

  // Every sink read once; the allowances it used are recorded on the way.
  const scanSinks: () => Array<GuardFinding> = (): Array<GuardFinding> => {
    if (sinkFindings === null) {
      sinkFindings = [];

      for (const sink of sinks) {
        sinkFindings.push(
          ...findUntaggedFeedMarkdown(sink.file, sink.sourceText),
        );
      }
    }

    return sinkFindings;
  };

  test("reads the feed and chat code it is meant to read", () => {
    const files: Array<string> = sinks.map((sink: SourceFile): string => {
      return sink.file;
    });

    for (const builder of BUILDER_FILES) {
      expect(fs.existsSync(path.join(REPOSITORY_ROOT, builder))).toBe(true);
      expect(files).toContain(builder);
    }

    // Feed items of every kind, the chat integration and the worker jobs.
    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(CHAT_DIRECTORY);
      }).length,
    ).toBeGreaterThan(20);
    expect(
      files.filter((file: string): boolean => {
        return file.startsWith(JOBS_DIRECTORY);
      }).length,
    ).toBeGreaterThan(50);
    expect(files).toContain(
      "packages/Common/Server/Services/IncidentService.ts",
    );
    expect(files).toContain(
      "packages/Common/Server/Services/KubernetesClusterService.ts",
    );
    expect(files).toContain(
      "packages/Common/Server/Services/ServiceLevelObjectiveService.ts",
    );
    expect(sinks.length).toBeGreaterThan(300);
  });

  test("every Markdown template with values in it is mdText, and nothing places Markdown as a string", () => {
    expect(describeFindings(scanSinks())).toEqual([]);
  });

  test("nothing outside Utils/Markdown imports MarkdownEscape or UntrustedMarkdown", () => {
    const findings: Array<GuardFinding> = [];
    let scanned: number = 0;

    for (const root of IMPORT_SCAN_ROOTS) {
      for (const fullPath of listSourceFiles(root)) {
        scanned++;
        findings.push(
          ...findEscaperImports(
            toRepositoryPath(fullPath),
            fs.readFileSync(fullPath, "utf8"),
          ),
        );
      }
    }

    expect(scanned).toBeGreaterThan(5000);
    expect(describeFindings(findings)).toEqual([]);
  });

  test("every allowed untagged template still exists and still excuses one", () => {
    scanSinks();

    const stale: Array<string> = ALLOWED_UNTAGGED.filter(
      (entry: AllowedUntagged): boolean => {
        return !USED_ALLOWANCES.has(entry);
      },
    ).map((entry: AllowedUntagged): string => {
      return `${entry.file} ${entry.text || entry.inFunction}`;
    });

    expect(stale).toEqual([]);

    for (const entry of ALLOWED_UNTAGGED) {
      expect(entry.reason.length).toBeGreaterThan(10);
      expect(Boolean(entry.text) !== Boolean(entry.inFunction)).toBe(true);
    }
  });
});

describe("findUntaggedFeedMarkdown", () => {
  const FILE: string = "packages/Common/Server/Services/ExampleService.ts";

  function find(code: string): Array<string> {
    return findUntaggedFeedMarkdown(FILE, code).map(
      (finding: GuardFinding): string => {
        return `${finding.rule}: ${finding.text}`;
      },
    );
  }

  test("finds an untagged Markdown template with a value in it", () => {
    expect(
      find("const text: string = `Changed **${incident.title}**`;"),
    ).toHaveLength(1);
  });

  test("passes the same template tagged mdText", () => {
    expect(
      find("const text: MarkdownText = mdText`Changed **${incident.title}**`;"),
    ).toEqual([]);
  });

  test("finds a link written by hand", () => {
    expect(find("const link: string = `[${name}](${url})`;")).toHaveLength(1);
  });

  test("finds a code span written by hand", () => {
    expect(find("const code: string = `\\`${value}\\``;")).toHaveLength(1);
  });

  test("finds a list item written by hand", () => {
    expect(find("lines.push(`- ${label.name}`);")).toHaveLength(1);
  });

  test("finds a template assigned to something named for Markdown, Markdown or not", () => {
    expect(
      find("const feedInfoInMarkdown: string = `Changed ${title}`;"),
    ).toHaveLength(1);
  });

  test("leaves a template that is not Markdown alone: an SMS carries the title as written", () => {
    expect(find("const sms: string = `Incident ${title} declared`;")).toEqual(
      [],
    );
  });

  test("leaves a log line alone", () => {
    expect(find("logger.debug(`**${title}** failed`);")).toEqual([]);
  });

  test("leaves the text of a code span FeedMarkdown.code writes around alone", () => {
    expect(
      find(
        "const span: MarkdownText = FeedMarkdown.code(`kubectl logs ${pod} -c **x**`);",
      ),
    ).toEqual([]);
  });

  test("finds a Markdown string joined to a value with +", () => {
    expect(find('const text: string = "**Title:** " + incident.title;')).toHaveLength(
      1,
    );
  });

  test("passes Markdown joined to Markdown written with mdText", () => {
    expect(
      find(
        'const text: string = "**Title:** " + mdText`${incident.title}`.toString();',
      ),
    ).toEqual([]);
  });

  test("finds a value appended to something named for Markdown", () => {
    expect(find("feedInfoInMarkdown += incident.title;")).toHaveLength(1);
  });

  test("passes mdText appended to something named for Markdown", () => {
    expect(find("feedInfoInMarkdown += mdText` ${incident.title}`;")).toEqual(
      [],
    );
  });

  test("finds an Array's join placed into mdText", () => {
    expect(
      find("const text: MarkdownText = mdText`Labels: ${names.join(\", \")}`;"),
    ).toEqual([expect.stringMatching(/^C: /)]);
  });

  test("passes FeedMarkdown.join placed into mdText", () => {
    expect(
      find(
        "const text: MarkdownText = mdText`Labels: ${FeedMarkdown.join(names)}`;",
      ),
    ).toEqual([]);
  });

  test("finds Markdown turned into a string and placed into mdText again", () => {
    expect(
      find(
        "const text: MarkdownText = mdText`Owner: ${mdText`**${name}**`.toString()}`;",
      ),
    ).toEqual([expect.stringMatching(/^C: /)]);
  });

  test("passes Markdown named as Markdown appended to something named for Markdown", () => {
    expect(
      find(
        "feedInfoInMarkdown += fieldsMarkdown.toString(); feedInfoInMarkdown += await this.getMonitorChangeFeedMarkdown(data);",
      ),
    ).toEqual([]);
  });

  test("leaves a masked phone number alone: six asterisks are no bold", () => {
    expect(
      find("const masked: string = `${phone.slice(0, 2)}******${phone.slice(-2)}`;"),
    ).toEqual([]);
  });

  test("an allowed template must name its file", () => {
    expect(
      findUntaggedFeedMarkdown(
        "packages/Common/Server/Services/Other.ts",
        "const text: string = `**${title}**`;",
      ),
    ).toHaveLength(1);
  });
});

describe("findEscaperImports", () => {
  test("finds MarkdownEscape imported outside Utils/Markdown", () => {
    expect(
      findEscaperImports(
        "packages/Common/Server/Services/ExampleService.ts",
        'import { escapeMarkdownValue } from "../../Utils/Markdown/MarkdownEscape";',
      ),
    ).toHaveLength(1);
  });

  test("finds UntrustedMarkdown imported by package path", () => {
    expect(
      findEscaperImports(
        "packages/App/FeatureSet/Workers/Jobs/Example.ts",
        'import { neutralizeAiWrittenMarkdown } from "Common/Utils/Markdown/UntrustedMarkdown";',
      ),
    ).toHaveLength(1);
  });

  test("finds a dynamic import and a require", () => {
    expect(
      findEscaperImports(
        "packages/Common/Server/Utils/Example.ts",
        'const a = await import("../Markdown/MarkdownEscape"); const b = require("./UntrustedMarkdown");',
      ),
    ).toHaveLength(2);
  });

  test("passes FeedMarkdown", () => {
    expect(
      findEscaperImports(
        "packages/Common/Server/Services/ExampleService.ts",
        'import FeedMarkdown, { mdText } from "../../Utils/Markdown/FeedMarkdown";',
      ),
    ).toEqual([]);
  });

  test("passes the Markdown utilities themselves", () => {
    expect(
      findEscaperImports(
        "packages/Common/Utils/Markdown/FeedMarkdown.ts",
        'import { escapeMarkdownValue } from "./MarkdownEscape";',
      ),
    ).toEqual([]);
  });
});
