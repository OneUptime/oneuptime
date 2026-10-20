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
 *   D. What the Slack and Microsoft Teams bots reply - to a button, a
 *      command, a reaction - is Markdown whatever its own text says, so in
 *      the integration (CHAT_DIRECTORY) the text of a reply is mdText: a
 *      template with values in it, a "+" that joins a value, or an error's
 *      message, handed to a reply as it is, is a finding
 *      (findUnescapedChatReplies). A person's name, a refusal naming a
 *      label or a record, a number prefix: each is text in a reply.
 *   E. What OneUptime tells its operator's own Slack channels - the
 *      incoming webhooks set with NOTIFICATION_SLACK_WEBHOOK_ON_* - is
 *      written by an OperatorSlackNotice builder and posted with
 *      OperatorSlackNotice.post. Those messages were Slack mrkdwn written by
 *      hand ("*Project Name:* ${name}"), which rule A does not read as
 *      Markdown, so a project or a company named "<!channel>" notified the
 *      whole channel. A webhook setting used other than checked or handed
 *      to that post, or a post whose text no builder wrote, is a finding
 *      (findOperatorSlackPosts).
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
  "packages/Common/Server/Utils/OperatorSlackNotice.ts",
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
    "describeRollbackCandidates",
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
  // A fix through the project's external MCP servers: its two personas.
  {
    file: "packages/Common/Server/Utils/AI/Remediation/McpRemediationRunner.ts",
    text: "You are OneUptime AI, OneUptime's autonomous AI Site Reliability Engineer",
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
  rule: "A" | "B" | "C" | "D" | "E";
  text: string;
}

// A log line or an error's message: never Markdown.
const LOG_OR_ERROR_CALLEE_PATTERN: RegExp = /^logger\.|^console\.|Error$/;

// The text of a code span FeedMarkdown.code (or codeWithId) writes around.
const CODE_CALLEE_PATTERN: RegExp = /(?:^|\.)code$|\.codeWithId$/;

// Markdown turned back into a string.
const TO_STRING_CALLEE_PATTERN: RegExp = /\.toString$/;

// A FeedMarkdown helper, which returns Markdown.
const FEED_MARKDOWN_CALLEE_PATTERN: RegExp = /^FeedMarkdown\./;

// An Array's join.
const JOIN_CALLEE_PATTERN: RegExp = /\.join$/;

// TypeScript source.
const SOURCE_FILE_PATTERN: RegExp = /\.tsx?$/;

// A test file.
const TEST_FILE_PATTERN: RegExp = /\.test\.tsx?$/;

// A React component file: it renders, it writes no feed or chat Markdown.
const TSX_FILE_PATTERN: RegExp = /\.tsx$/;

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

      if (LOG_OR_ERROR_CALLEE_PATTERN.test(callee)) {
        return true;
      }

      const callArguments: ReadonlyArray<ts.Expression> =
        parent.arguments || [];

      if (
        CODE_CALLEE_PATTERN.test(callee) &&
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
    if (TO_STRING_CALLEE_PATTERN.test(callee)) {
      const target: ts.Expression = unwrap(
        (unwrapped.expression as ts.PropertyAccessExpression).expression,
      );

      return !(
        isMdTextTag(target) ||
        (ts.isCallExpression(target) &&
          FEED_MARKDOWN_CALLEE_PATTERN.test(calleeText(target)))
      );
    }

    return !FEED_MARKDOWN_CALLEE_PATTERN.test(callee);
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

        if (
          JOIN_CALLEE_PATTERN.test(callee) &&
          !FEED_MARKDOWN_CALLEE_PATTERN.test(callee)
        ) {
          report(span.expression, "C");
        }

        if (TO_STRING_CALLEE_PATTERN.test(callee)) {
          const target: ts.Expression = unwrap(
            (value.expression as ts.PropertyAccessExpression).expression,
          );

          if (
            isMdTextTag(target) ||
            (ts.isCallExpression(target) &&
              FEED_MARKDOWN_CALLEE_PATTERN.test(calleeText(target)))
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

/*
 * Rule D: what the Slack and Microsoft Teams bots reply.
 *
 * A reply is Markdown whatever its own text says - Teams shows a bot's text
 * as Markdown, and Slack's text and Markdown blocks are mrkdwn - so in the
 * integration a reply's text is mdText even when no "**" or "](" in it says
 * so. What a reply carries: a person's name, a refusal (which can name a
 * label, a record or a person), a reason a write gave, a number prefix.
 */

/*
 * The calls that post a bot's reply, by name, and which argument is its
 * text - or an object with the text as its `text`.
 */
const REPLY_TEXT_ARGUMENTS: Record<string, number> = {
  // Microsoft Teams: TurnContext.sendActivity(text | activity).
  sendActivity: 0,
  // MicrosoftTeamsReplies.sendBestEffort(turnContext, text | activity).
  sendBestEffort: 1,
  // A reply in a Microsoft Teams thread: ({ ..., text }).
  replyInThread: 0,
  sendTextReplyToChannelThread: 0,
  // A reply in a Slack thread: ({ ..., text }).
  sendMessageToThread: 0,
};

/*
 * The calls that answer a press where it was made - SlackActionAnswer in
 * Slack, MicrosoftTeamsActionAnswer in Microsoft Teams - by name, and which
 * argument carries the answer, as its `answer`: a WorkspaceAnswer, whose
 * `markdown` the chat shows.
 */
const ANSWER_ARGUMENTS: Record<string, number> = {
  answer: 0,
  reply: 0,
  sendToPlace: 0,
};

// A Slack or Microsoft Teams message block written as Markdown.
const MARKDOWN_PAYLOAD_TYPE: string = "WorkspacePayloadMarkdown";

// A function whose result a reply posts as it is: a reply of its own.
const REPLY_BUILDER_NAME_PATTERN: RegExp = /Message$/;

// A function whose result a press is answered with: an answer of its own.
const ANSWER_BUILDER_NAME_PATTERN: RegExp = /(?:Answer|Prompt)$/;

// What a scan read: how many replies, and the builders of their text.
export interface ChatRepliesSeen {
  replies: number;
  builders: Set<string>;
}

type FunctionLikeNode =
  | ts.FunctionDeclaration
  | ts.MethodDeclaration
  | ts.ArrowFunction
  | ts.FunctionExpression
  | ts.GetAccessorDeclaration
  | ts.ConstructorDeclaration;

function isFunctionLike(node: ts.Node): node is FunctionLikeNode {
  return (
    ts.isFunctionDeclaration(node) ||
    ts.isMethodDeclaration(node) ||
    ts.isArrowFunction(node) ||
    ts.isFunctionExpression(node) ||
    ts.isGetAccessorDeclaration(node) ||
    ts.isConstructorDeclaration(node)
  );
}

// The function a node is written in, or the file when it is at the top.
function enclosingFunctionOrFile(node: ts.Node): ts.Node {
  let current: ts.Node | undefined = node.parent;

  while (current && !ts.isSourceFile(current)) {
    if (isFunctionLike(current)) {
      return current;
    }

    current = current.parent;
  }

  return current || node.getSourceFile();
}

// Every node inside `container`, functions written inside it left out.
function forEachOwnNode(
  container: ts.Node,
  visit: (node: ts.Node) => void,
): void {
  const walk: (node: ts.Node) => void = (node: ts.Node): void => {
    visit(node);

    if (isFunctionLike(node)) {
      return;
    }

    ts.forEachChild(node, walk);
  };

  ts.forEachChild(container, walk);
}

/*
 * What a variable is given where it is used: its initializer and every
 * value assigned or appended to it, in the function it is used in - or at
 * the top of the file, for a constant of the file's own.
 */
function valuesGivenTo(identifier: ts.Identifier): Array<ts.Expression> {
  const name: string = identifier.text;
  const values: Array<ts.Expression> = [];

  const collect: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === name &&
      node.initializer
    ) {
      values.push(node.initializer);
    }

    if (
      ts.isBinaryExpression(node) &&
      (node.operatorToken.kind === ts.SyntaxKind.EqualsToken ||
        node.operatorToken.kind === ts.SyntaxKind.PlusEqualsToken) &&
      ts.isIdentifier(node.left) &&
      node.left.text === name
    ) {
      values.push(node.right);
    }
  };

  const container: ts.Node = enclosingFunctionOrFile(identifier);
  forEachOwnNode(container, collect);

  if (values.length === 0 && !ts.isSourceFile(container)) {
    forEachOwnNode(identifier.getSourceFile(), collect);
  }

  return values;
}

// The name a call is made by: `getConfirmationMessage` for `this.getConfirmationMessage(...)`.
function calledName(call: ts.CallExpression): string | null {
  if (ts.isPropertyAccessExpression(call.expression)) {
    return call.expression.name.text;
  }

  if (ts.isIdentifier(call.expression)) {
    return call.expression.text;
  }

  return null;
}

// What a function returns: each return of its own, or its expression body.
function returnedValues(fn: FunctionLikeNode): Array<ts.Expression> {
  if (!fn.body) {
    return [];
  }

  if (!ts.isBlock(fn.body)) {
    return [fn.body];
  }

  const values: Array<ts.Expression> = [];

  forEachOwnNode(fn.body, (node: ts.Node): void => {
    if (ts.isReturnStatement(node) && node.expression) {
      values.push(node.expression);
    }
  });

  return values;
}

// The name a function goes by, written as a declaration, a method or a variable.
function functionName(node: ts.Node): string | null {
  if (
    (ts.isFunctionDeclaration(node) || ts.isMethodDeclaration(node)) &&
    node.name
  ) {
    return node.name.getText();
  }

  if (
    (ts.isArrowFunction(node) || ts.isFunctionExpression(node)) &&
    ts.isVariableDeclaration(node.parent) &&
    ts.isIdentifier(node.parent.name)
  ) {
    return node.parent.name.text;
  }

  return null;
}

/**
 * Rule D over the Slack and Microsoft Teams integration: the text of every
 * reply the bots post is mdText. A template with values in it, a "+" that
 * joins a value, or an error's `.message`, given to a reply as it is, is a
 * finding - as the argument of a reply call (REPLY_TEXT_ARGUMENTS), as the
 * text of a WorkspacePayloadMarkdown, as the Markdown of an answer to a
 * press (ANSWER_ARGUMENTS), as a value of a variable any of these is built
 * in, or as what a ...Message function returns whose result a reply posts,
 * or a ...Answer or ...Prompt function whose result a press is answered
 * with.
 */
export function findUnescapedChatReplies(
  files: ReadonlyArray<SourceFile>,
  seen?: ChatRepliesSeen | undefined,
): Array<GuardFinding> {
  const found: Array<GuardFinding> = [];
  const reported: Set<ts.Node> = new Set<ts.Node>();
  const examined: Set<ts.Node> = new Set<ts.Node>();
  const builderNames: Set<string> = new Set<string>();
  const answerBuilderNames: Set<string> = new Set<string>();
  const examinedAnswers: Set<ts.Node> = new Set<ts.Node>();

  const sources: Array<{ file: string; source: ts.SourceFile }> = files.map(
    (entry: SourceFile): { file: string; source: ts.SourceFile } => {
      return {
        file: entry.file,
        source: ts.createSourceFile(
          entry.file,
          entry.sourceText,
          ts.ScriptTarget.Latest,
          true,
        ),
      };
    },
  );

  const fileOf: Map<ts.SourceFile, string> = new Map<ts.SourceFile, string>();

  for (const entry of sources) {
    fileOf.set(entry.source, entry.file);
  }

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    if (reported.has(node)) {
      return;
    }

    reported.add(node);

    const source: ts.SourceFile = node.getSourceFile();

    found.push({
      file: fileOf.get(source) || source.fileName,
      line: lineOf(source, node),
      rule: "D",
      text: node.getText(source).slice(0, 120),
    });
  };

  // Whether a reply's text, as written, places a value as it is.
  const examine: (expression: ts.Expression) => void = (
    expression: ts.Expression,
  ): void => {
    const value: ts.Expression = unwrap(expression);

    if (examined.has(value)) {
      return;
    }

    examined.add(value);

    if (ts.isTemplateExpression(value)) {
      report(value);
      return;
    }

    if (ts.isConditionalExpression(value)) {
      examine(value.whenTrue);
      examine(value.whenFalse);
      return;
    }

    if (ts.isBinaryExpression(value)) {
      const operator: ts.SyntaxKind = value.operatorToken.kind;

      if (
        operator === ts.SyntaxKind.BarBarToken ||
        operator === ts.SyntaxKind.QuestionQuestionToken
      ) {
        examine(value.left);
        examine(value.right);
        return;
      }

      if (operator === ts.SyntaxKind.PlusToken) {
        const operands: Array<ts.Expression> = concatenationOperands(value);

        if (
          operands.some((operand: ts.Expression): boolean => {
            return (
              ts.isTemplateExpression(unwrap(operand)) || isRawValue(operand)
            );
          })
        ) {
          report(value);
        }
      }

      return;
    }

    // An error's message: text, which can name a label, a record or a person.
    if (ts.isPropertyAccessExpression(value) && value.name.text === "message") {
      report(value);
      return;
    }

    if (ts.isIdentifier(value)) {
      for (const given of valuesGivenTo(value)) {
        examine(given);
      }

      return;
    }

    if (ts.isCallExpression(value)) {
      const callee: string = calleeText(value);

      // Markdown turned into the string a sink takes.
      if (TO_STRING_CALLEE_PATTERN.test(callee)) {
        const target: ts.Expression = unwrap(
          (value.expression as ts.PropertyAccessExpression).expression,
        );

        if (
          !isMdTextTag(target) &&
          !(
            ts.isCallExpression(target) &&
            FEED_MARKDOWN_CALLEE_PATTERN.test(calleeText(target))
          )
        ) {
          examine(target);
        }

        return;
      }

      const name: string | null = calledName(value);

      if (name && REPLY_BUILDER_NAME_PATTERN.test(name)) {
        builderNames.add(name);
        return;
      }

      // A helper that takes the text as `{ text }` and hands it back cut or wrapped.
      for (const argument of value.arguments) {
        const unwrapped: ts.Expression = unwrap(argument);

        if (!ts.isObjectLiteralExpression(unwrapped)) {
          continue;
        }

        for (const property of unwrapped.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText() === "text"
          ) {
            examine(property.initializer);
          }
        }
      }
    }
  };

  // An answer to a press, as written: the Markdown in it is examined.
  const examineAnswer: (expression: ts.Expression) => void = (
    expression: ts.Expression,
  ): void => {
    const value: ts.Expression = unwrap(expression);

    if (examinedAnswers.has(value)) {
      return;
    }

    examinedAnswers.add(value);

    if (ts.isObjectLiteralExpression(value)) {
      for (const property of value.properties) {
        if (
          ts.isPropertyAssignment(property) &&
          property.name.getText() === "markdown"
        ) {
          examine(property.initializer);
        }
      }

      return;
    }

    if (ts.isConditionalExpression(value)) {
      examineAnswer(value.whenTrue);
      examineAnswer(value.whenFalse);
      return;
    }

    if (ts.isIdentifier(value)) {
      for (const given of valuesGivenTo(value)) {
        examineAnswer(given);
      }

      return;
    }

    if (ts.isCallExpression(value)) {
      const name: string | null = calledName(value);

      if (name && ANSWER_BUILDER_NAME_PATTERN.test(name)) {
        answerBuilderNames.add(name);
      }
    }
  };

  // The text of every reply call and Markdown block.
  for (const entry of sources) {
    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const name: string | null = calledName(node);
        const index: number | undefined =
          name !== null &&
          Object.prototype.hasOwnProperty.call(REPLY_TEXT_ARGUMENTS, name)
            ? REPLY_TEXT_ARGUMENTS[name]
            : undefined;
        const argument: ts.Expression | undefined =
          index === undefined ? undefined : node.arguments[index];

        const answerIndex: number | undefined =
          name !== null &&
          Object.prototype.hasOwnProperty.call(ANSWER_ARGUMENTS, name)
            ? ANSWER_ARGUMENTS[name]
            : undefined;
        const answerArgument: ts.Expression | undefined =
          answerIndex === undefined ? undefined : node.arguments[answerIndex];

        if (
          answerArgument &&
          ts.isObjectLiteralExpression(unwrap(answerArgument))
        ) {
          for (const property of (
            unwrap(answerArgument) as ts.ObjectLiteralExpression
          ).properties) {
            if (
              ts.isPropertyAssignment(property) &&
              property.name.getText() === "answer"
            ) {
              if (seen) {
                seen.replies++;
              }

              examineAnswer(property.initializer);
            }
          }
        }

        if (argument) {
          if (seen) {
            seen.replies++;
          }

          const unwrapped: ts.Expression = unwrap(argument);

          if (ts.isObjectLiteralExpression(unwrapped)) {
            for (const property of unwrapped.properties) {
              if (
                ts.isPropertyAssignment(property) &&
                property.name.getText() === "text"
              ) {
                examine(property.initializer);
              }

              if (
                ts.isShorthandPropertyAssignment(property) &&
                property.name.text === "text"
              ) {
                examine(property.name);
              }
            }
          } else {
            examine(argument);
          }
        }
      }

      if (ts.isObjectLiteralExpression(node)) {
        const isMarkdownPayload: boolean = node.properties.some(
          (property: ts.ObjectLiteralElementLike): boolean => {
            return (
              ts.isPropertyAssignment(property) &&
              property.name.getText() === "_type" &&
              ts.isStringLiteralLike(property.initializer) &&
              property.initializer.text === MARKDOWN_PAYLOAD_TYPE
            );
          },
        );

        if (isMarkdownPayload) {
          if (seen) {
            seen.replies++;
          }

          for (const property of node.properties) {
            if (
              ts.isPropertyAssignment(property) &&
              property.name.getText() === "text"
            ) {
              examine(property.initializer);
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(entry.source);
  }

  /*
   * What each reply builder and answer builder returns, until no new
   * builder turns up.
   */
  const builtAlready: Set<string> = new Set<string>();
  const answersBuiltAlready: Set<string> = new Set<string>();
  let pending: Array<string> = Array.from(builderNames);
  let pendingAnswers: Array<string> = Array.from(answerBuilderNames);

  while (pending.length > 0 || pendingAnswers.length > 0) {
    for (const name of pending) {
      builtAlready.add(name);
    }

    for (const name of pendingAnswers) {
      answersBuiltAlready.add(name);
    }

    const names: Set<string> = new Set<string>(pending);
    const answerNames: Set<string> = new Set<string>(pendingAnswers);

    for (const entry of sources) {
      const visit: (node: ts.Node) => void = (node: ts.Node): void => {
        if (isFunctionLike(node)) {
          const name: string | null = functionName(node);

          if (name !== null && names.has(name)) {
            for (const returned of returnedValues(node)) {
              examine(returned);
            }
          }

          if (name !== null && answerNames.has(name)) {
            for (const returned of returnedValues(node)) {
              examineAnswer(returned);
            }
          }
        }

        ts.forEachChild(node, visit);
      };

      visit(entry.source);
    }

    pending = Array.from(builderNames).filter((name: string): boolean => {
      return !builtAlready.has(name);
    });
    pendingAnswers = Array.from(answerBuilderNames).filter(
      (name: string): boolean => {
        return !answersBuiltAlready.has(name);
      },
    );
  }

  if (seen) {
    for (const name of builderNames) {
      seen.builders.add(name);
    }

    for (const name of answerBuilderNames) {
      seen.builders.add(name);
    }
  }

  return found.sort((a: GuardFinding, b: GuardFinding): number => {
    return a.file === b.file ? a.line - b.line : a.file < b.file ? -1 : 1;
  });
}

/*
 * Rule E: what OneUptime tells its operator's own Slack channels.
 */

// The webhook settings: NotificationSlackWebhookOnCreateUser, ...OnSubscriptionUpdate.
const OPERATOR_WEBHOOK_SETTING_PATTERN: RegExp =
  /^NotificationSlackWebhookOn[A-Z][A-Za-z]*$/;

// What writes an operator's message: OperatorSlackNotice.getProjectCreatedText.
const OPERATOR_TEXT_BUILDER_PATTERN: RegExp =
  /^OperatorSlackNotice\.get[A-Za-z]+Text$/;

const OPERATOR_POST_CALLEE: string = "OperatorSlackNotice.post";

// A file that reads a webhook setting or posts to one.
const OPERATOR_SLACK_FILE_PATTERN: RegExp =
  /NotificationSlackWebhookOn|OperatorSlackNotice\.post/;

// The name of the property a node is the value of in OperatorSlackNotice.post({ ... }).
function operatorPostPropertyName(node: ts.Node): string | null {
  const property: ts.Node = node.parent;

  if (!ts.isPropertyAssignment(property) || property.initializer !== node) {
    return null;
  }

  const argument: ts.Node = property.parent;
  const call: ts.Node = argument.parent;

  if (
    !ts.isObjectLiteralExpression(argument) ||
    !ts.isCallExpression(call) ||
    calleeText(call) !== OPERATOR_POST_CALLEE ||
    call.arguments[0] !== argument
  ) {
    return null;
  }

  return property.name.getText();
}

/*
 * A setting named where it is declared or imported, or only checked:
 * `if (NotificationSlackWebhookOnCreateUser)`, `!NotificationSlackWebhookOn...`.
 */
function isSettingNamedOrChecked(identifier: ts.Identifier): boolean {
  const parent: ts.Node = identifier.parent;

  return (
    ts.isImportSpecifier(parent) ||
    (ts.isVariableDeclaration(parent) && parent.name === identifier) ||
    (ts.isIfStatement(parent) && parent.expression === identifier) ||
    (ts.isPrefixUnaryExpression(parent) &&
      parent.operator === ts.SyntaxKind.ExclamationToken)
  );
}

// A post's text as written: a builder's message, or a variable only ever given one.
function isOperatorBuilderText(expression: ts.Expression): boolean {
  const value: ts.Expression = unwrap(expression);

  if (ts.isCallExpression(value)) {
    return OPERATOR_TEXT_BUILDER_PATTERN.test(calleeText(value));
  }

  if (ts.isIdentifier(value)) {
    const given: Array<ts.Expression> = valuesGivenTo(value);

    return given.length > 0 && given.every(isOperatorBuilderText);
  }

  return false;
}

/**
 * Rule E over one file: every webhook setting (NotificationSlackWebhookOn...)
 * is only checked, or handed to OperatorSlackNotice.post as its webhookUrl,
 * and every such post's text is what an OperatorSlackNotice builder wrote.
 */
export function findOperatorSlackPosts(
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

  const report: (node: ts.Node) => void = (node: ts.Node): void => {
    found.push({
      file: file,
      line: lineOf(source, node),
      rule: "E",
      text: node.getText(source).slice(0, 120),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isIdentifier(node) &&
      OPERATOR_WEBHOOK_SETTING_PATTERN.test(node.text) &&
      !isSettingNamedOrChecked(node) &&
      operatorPostPropertyName(node) !== "webhookUrl"
    ) {
      report(node);
    }

    if (
      ts.isCallExpression(node) &&
      calleeText(node) === OPERATOR_POST_CALLEE
    ) {
      const argument: ts.Expression | undefined = node.arguments[0]
        ? unwrap(node.arguments[0])
        : undefined;
      let text: ts.Expression | undefined = undefined;

      if (argument && ts.isObjectLiteralExpression(argument)) {
        for (const property of argument.properties) {
          if (
            ts.isPropertyAssignment(property) &&
            property.name.getText() === "text"
          ) {
            text = property.initializer;
          }

          if (
            ts.isShorthandPropertyAssignment(property) &&
            property.name.text === "text"
          ) {
            text = property.name;
          }
        }
      }

      if (!text || !isOperatorBuilderText(text)) {
        report(node);
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

const ESCAPER_MODULE_PATTERN: RegExp =
  /(?:^|\/)(MarkdownEscape|UntrustedMarkdown)$/;

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
      ["node_modules", "build", "dist", "Tests", "coverage", ".git"].includes(
        entry.name,
      )
    ) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listSourceFiles(fullPath));
    } else if (
      SOURCE_FILE_PATTERN.test(entry.name) &&
      !TEST_FILE_PATTERN.test(entry.name) &&
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

      if (
        file.startsWith(MARKDOWN_UTILS_DIRECTORY) ||
        TSX_FILE_PATTERN.test(file)
      ) {
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

  test("every reply the Slack and Microsoft Teams bots post is mdText", () => {
    const chatFiles: Array<SourceFile> = sinks.filter(
      (sink: SourceFile): boolean => {
        return sink.file.startsWith(CHAT_DIRECTORY);
      },
    );
    const seen: ChatRepliesSeen = { replies: 0, builders: new Set<string>() };

    const findings: Array<GuardFinding> = findUnescapedChatReplies(
      chatFiles,
      seen,
    );

    // The replies of both bots are read: a renamed call must not hide them.
    expect(seen.replies).toBeGreaterThan(100);

    for (const builder of [
      "getUnexpectedErrorMessage",
      "getConfirmationMessage",
      "getIncidentCreateFailedMessage",
      "getFormNotAcceptedMessage",
      // What a press is answered with where it was made, in both chats.
      "getConnectPrompt",
      "getAlreadyAnswer",
      "getUnknownButtonAnswer",
    ]) {
      expect(seen.builders).toContain(builder);
    }

    expect(describeFindings(findings)).toEqual([]);
  });

  test("the operator's Slack channels are told only what an OperatorSlackNotice builder wrote", () => {
    const findings: Array<GuardFinding> = [];
    const scanned: Array<string> = [];

    for (const root of SINK_SCAN_ROOTS) {
      for (const fullPath of listSourceFiles(root)) {
        const sourceText: string = fs.readFileSync(fullPath, "utf8");

        if (!OPERATOR_SLACK_FILE_PATTERN.test(sourceText)) {
          continue;
        }

        const file: string = toRepositoryPath(fullPath);

        scanned.push(file);
        findings.push(...findOperatorSlackPosts(file, sourceText));
      }
    }

    // Every service that tells the operator is read: a renamed setting must not hide one.
    for (const poster of [
      "packages/Common/Server/Services/UserService.ts",
      "packages/Common/Server/Services/ProjectService.ts",
      "packages/Common/Server/Services/NotificationService.ts",
      "packages/Common/Server/Services/AIBillingService.ts",
    ]) {
      expect(scanned).toContain(poster);
    }

    expect(describeFindings(findings)).toEqual([]);
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
    expect(
      find('const text: string = "**Title:** " + incident.title;'),
    ).toHaveLength(1);
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
      find('const text: MarkdownText = mdText`Labels: ${names.join(", ")}`;'),
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
      find(
        "const masked: string = `${phone.slice(0, 2)}******${phone.slice(-2)}`;",
      ),
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

describe("findUnescapedChatReplies", () => {
  const FILE: string =
    "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Example.ts";

  function find(code: string): Array<string> {
    return findUnescapedChatReplies([{ file: FILE, sourceText: code }]).map(
      (finding: GuardFinding): string => {
        return `${finding.rule}: ${finding.text}`;
      },
    );
  }

  test("finds a person's name placed into a reply with a template", () => {
    expect(
      find(
        "async function f(): Promise<void> { await turnContext.sendActivity(`${userName}, you cannot do that.`); }",
      ),
    ).toEqual([expect.stringMatching(/^D: /)]);
  });

  test("passes the same reply written with mdText", () => {
    expect(
      find(
        "async function f(): Promise<void> { await turnContext.sendActivity(mdText`${userName}, you cannot do that.`.toString()); }",
      ),
    ).toEqual([]);
  });

  test("finds a value joined into a reply with +", () => {
    expect(
      find(
        'async function f(): Promise<void> { await turnContext.sendActivity("Sorry, the action " + actionType + " is not there."); }',
      ),
    ).toHaveLength(1);
  });

  test("finds an error's message sent as it is", () => {
    expect(
      find(
        "async function f(): Promise<void> { await MicrosoftTeamsReplies.sendBestEffort(turnContext, error.message); }",
      ),
    ).toHaveLength(1);
  });

  test("passes a fixed reply and a constant", () => {
    expect(
      find(
        'async function f(): Promise<void> { await turnContext.sendActivity("Done."); await turnContext.sendActivity(Actions.NO_STATES_MESSAGE); }',
      ),
    ).toEqual([]);
  });

  test("finds a thread reply's text built with a template", () => {
    expect(
      find(
        "async function f(): Promise<void> { await this.replyInThread({ channel: channel, text: `${name}, ${refusal}` }); }",
      ),
    ).toHaveLength(1);
  });

  test("finds a Slack Markdown block whose text is a template", () => {
    expect(
      find(
        'const block: WorkspacePayloadMarkdown = { _type: "WorkspacePayloadMarkdown", text: `@${slackUsername}, ${message}` };',
      ),
    ).toHaveLength(1);
  });

  test("follows a variable to the template it was built with", () => {
    expect(
      find(
        "async function f(): Promise<void> { let text: string = mdText`Hello`.toString(); text += `, ${name}`; await turnContext.sendActivity(text); }",
      ),
    ).toEqual([expect.stringMatching(/^D: `, \$\{name\}`/)]);
  });

  test("reads what a ...Message function returns when a reply posts it", () => {
    expect(
      find(
        [
          "class A {",
          "  static getGreetingMessage(name: string): string { return `Hello ${name}`; }",
          "  static async f(): Promise<void> { await turnContext.sendActivity(A.getGreetingMessage(n)); }",
          "}",
        ].join("\n"),
      ),
    ).toEqual([expect.stringMatching(/^D: `Hello/)]);
  });

  test("leaves a ...Message function alone when no reply posts it", () => {
    expect(
      find(
        "class A { static getLogMessage(name: string): string { return `Hello ${name}`; } }",
      ),
    ).toEqual([]);
  });

  test("follows the text handed to a helper that cuts it to size", () => {
    expect(
      find(
        "async function f(): Promise<void> { await turnContext.sendActivity(Size.fit({ text: `${title} is down` })); }",
      ),
    ).toHaveLength(1);
  });

  test("finds the Markdown of an answer to a press written with a template", () => {
    expect(
      find(
        "async function f(): Promise<void> { await MicrosoftTeamsActionAnswer.reply({ turnContext: t, answer: { markdown: `${name} was here`, text: name } }); }",
      ),
    ).toEqual([expect.stringMatching(/^D: `\$\{name\} was here`/)]);
  });

  test("passes the same answer written with mdText", () => {
    expect(
      find(
        "async function f(): Promise<void> { await SlackActionAnswer.answer({ place: p, answer: { markdown: mdText`${name} was here`.toString(), text: name } }); }",
      ),
    ).toEqual([]);
  });

  test("reads what a ...Answer or ...Prompt function returns when a press is answered with it", () => {
    expect(
      find(
        [
          "class A {",
          "  static getLateAnswer(name: string): WorkspaceAnswer { return { markdown: `Done by ${name}`, text: name }; }",
          "  static getConnectPrompt(purpose: string): WorkspaceAnswer { return { markdown: mdText`Connect to ${purpose}`.toString(), text: purpose }; }",
          "  static async f(): Promise<void> {",
          "    const answer: WorkspaceAnswer = A.getConnectPrompt(p);",
          "    await SlackActionAnswer.answer({ place: p, answer: answer });",
          "    await MicrosoftTeamsActionAnswer.sendToPlace({ place: p, answer: A.getLateAnswer(n) });",
          "  }",
          "}",
        ].join("\n"),
      ),
    ).toEqual([expect.stringMatching(/^D: `Done by/)]);
  });
});

describe("findOperatorSlackPosts", () => {
  const FILE: string = "packages/Common/Server/Services/ExampleService.ts";

  function find(code: string): Array<string> {
    return findOperatorSlackPosts(FILE, code).map(
      (finding: GuardFinding): string => {
        return `${finding.rule}: ${finding.text}`;
      },
    );
  }

  test("finds a webhook setting posted to with a message written by hand", () => {
    expect(
      find(
        "async function f(): Promise<void> { if (NotificationSlackWebhookOnCreateUser) { SlackUtil.sendMessageToChannelViaIncomingWebhook({ url: URL.fromString(NotificationSlackWebhookOnCreateUser), text: `*New OneUptime User:* ${user.name}` }); } }",
      ),
    ).toEqual(["E: NotificationSlackWebhookOnCreateUser"]);
  });

  test("finds a post whose text no builder wrote", () => {
    expect(
      find(
        "async function f(): Promise<void> { void OperatorSlackNotice.post({ webhookUrl: NotificationSlackWebhookOnCreateProject, text: `*Project Created:* ${project.name}`, about: 'project creation' }); }",
      ),
    ).toEqual([expect.stringMatching(/^E: OperatorSlackNotice\.post\(/)]);
  });

  test("finds a post whose text is a variable given a template", () => {
    expect(
      find(
        "async function f(): Promise<void> { let text: string = OperatorSlackNotice.getProjectPlanChangedText(d); text += `*Plan:* ${plan}`; await OperatorSlackNotice.post({ webhookUrl: NotificationSlackWebhookOnSubscriptionUpdate, text: text, about: 'plan change' }); }",
      ),
    ).toEqual([expect.stringMatching(/^E: OperatorSlackNotice\.post\(/)]);
  });

  test("passes a builder's message posted to a setting it checked", () => {
    expect(
      find(
        "async function f(): Promise<void> { if (!NotificationSlackWebhookOnCreateUser) { return; } void OperatorSlackNotice.post({ webhookUrl: NotificationSlackWebhookOnCreateUser, text: OperatorSlackNotice.getUserCreatedText({ user: user }), about: 'user creation' }); }",
      ),
    ).toEqual([]);
  });

  test("follows a variable to the builder that wrote it", () => {
    expect(
      find(
        "async function f(): Promise<void> { let text: string; try { text = OperatorSlackNotice.getProjectDeletedText(d); } catch (err) { return; } void OperatorSlackNotice.post({ webhookUrl: NotificationSlackWebhookOnDeleteProject, text, about: 'project deletion' }); }",
      ),
    ).toEqual([]);
  });

  test("leaves a setting's declaration and its import alone", () => {
    expect(
      find(
        'import { NotificationSlackWebhookOnCreateUser } from "../EnvironmentConfig"; export const NotificationSlackWebhookOnDeleteProject: string = process.env["NOTIFICATION_SLACK_WEBHOOK_ON_DELETED_PROJECT"] || "";',
      ),
    ).toEqual([]);
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
