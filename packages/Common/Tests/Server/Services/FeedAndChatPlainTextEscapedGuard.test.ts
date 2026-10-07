import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * A TITLE OR A NAME GOES INTO A FEED ITEM OR A CHAT MESSAGE AS TEXT.
 *
 * The feed items of incidents, alerts and both kinds of episode are Markdown
 * that the dashboard renders without its safe mode and that is posted to the
 * record's Slack and Microsoft Teams channels; the Slack and Teams messages
 * OneUptime builds for them are Markdown too. A title is plain text that is
 * often not typed by a person at all - a monitor fills an alert's in from an
 * incoming email's subject or a field of an incoming request - and a name
 * (a state, a severity, a team, a person, a label, a rule, a policy) is plain
 * text as well. Placed into Markdown as it is, such text becomes a link
 * whose words hide where it goes, an image fetched when the text is shown,
 * raw HTML, or a Slack mention. So wherever it is placed it goes through
 * MarkdownEscape: escapeMarkdownValue in prose, escapeMarkdownInline inside a
 * link's own text.
 *
 * This reads every file that writes one of those feed items
 * (create{Incident,Alert,IncidentEpisode,AlertEpisode}FeedItem), every file
 * of the Slack and Teams integration (Server/Utils/Workspace), the incident
 * and alert worker jobs, and the shared chat builders listed below, and
 * requires, in every Markdown template literal and every concatenation with
 * Markdown in it:
 *
 *   - each `.title` or `.name` it reads is an argument of an escaper (or only
 *     decides something, as a condition does), and
 *   - each variable it reads that was set from such a read was set by an
 *     escaper.
 *
 * A template literal is Markdown when its text has Markdown in it ("**",
 * "](", a heading, a list item or a quote at the start of a line) or when it
 * is assigned to something named for Markdown (feedInfoInMarkdown,
 * moreInformationInMarkdown, markdownMessage, ...). A read that is right to
 * go in as it is - text that is not shown in a feed or a chat at all - goes in
 * ALLOWED_READS with its reason, and the guard fails when an entry no longer
 * matches anything, so the list cannot outlive the code it excuses.
 */

// packages/Common/Tests/Server/Services -> packages/Common.
const COMMON_ROOT: string = path.resolve(__dirname, "..", "..", "..");
// packages/Common -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(COMMON_ROOT, "..", "..");

const SCAN_ROOTS: Array<string> = [
  path.join(REPOSITORY_ROOT, "packages", "Common", "Server"),
  path.join(REPOSITORY_ROOT, "packages", "App", "FeatureSet", "Workers"),
  path.join(REPOSITORY_ROOT, "ee", "Server"),
];

// The feed items of incidents, alerts and both kinds of episode.
const FEED_ITEM_WRITERS: ReadonlySet<string> = new Set<string>([
  "createIncidentFeedItem",
  "createAlertFeedItem",
  "createIncidentEpisodeFeedItem",
  "createAlertEpisodeFeedItem",
]);

// The Slack and Microsoft Teams integration: every message it builds.
const CHAT_DIRECTORY: string = "packages/Common/Server/Utils/Workspace/";

/*
 * The incident and alert jobs (owners' notifications, status page
 * subscribers' Slack and Teams messages, reminders): every directory of
 * Workers/Jobs whose name starts with Incident or Alert.
 */
const INCIDENT_AND_ALERT_JOBS_PATTERN: RegExp =
  /^packages\/App\/FeatureSet\/Workers\/Jobs\/(?:Incident|Alert)[A-Za-z]*\//;

// Shared builders of the Markdown those feed items and messages carry.
const CHAT_BUILDER_FILES: ReadonlyArray<string> = [
  // The daily and weekly Slack / Teams summaries.
  "packages/Common/Server/Services/WorkspaceNotificationSummaryService.ts",
  // On-call messages in Slack and Teams.
  "packages/Common/Server/Services/UserNotificationRuleService.ts",
  // [Name](link) of a person, in feed items of every kind.
  "packages/Common/Server/Services/UserService.ts",
  // A note's attachments, listed in its feed item.
  "packages/Common/Server/Utils/FileAttachmentMarkdownUtil.ts",
  // An incident's custom Slack and Teams subscriber messages.
  "packages/Common/Server/Utils/StatusPage/IncidentTemplateVariableBuilder.ts",
  // The "Resources Affected" bullets of incident, alert and maintenance feeds.
  "packages/Common/Server/Utils/AffectedResources/LinkedAffectedResources.ts",
];

/*
 * The functions a title or a name may be handed to on its way into
 * Markdown: the escapers themselves, and helpers that escape what they are
 * given (each one says so where it is defined).
 */
const ESCAPERS: ReadonlySet<string> = new Set<string>([
  "escapeMarkdownValue",
  "escapeMarkdownInline",
  // The episode members' feed items (IncidentEpisodeMemberService, AlertEpisodeMemberService).
  "getFeedTitle",
  // Linked alerts and incidents (IncidentAlertService).
  "describeLinkedRecord",
  // [Name](link) of a person (UserService).
  "getUserMarkdownString",
  // The monitors of a Teams summary line (MicrosoftTeamsUtil).
  "formatAffectedMonitorNames",
  // The resource names of a summary (WorkspaceNotificationSummaryService).
  "joinNames",
  // A state on a subscriber chat message (StateChangeNoteMessage).
  "getChatStatusLine",
]);

const PLAIN_TEXT_PROPERTIES: ReadonlySet<string> = new Set<string>([
  "title",
  "name",
]);

/*
 * Markdown in a template's own text: bold, a link, or a heading, a list item
 * or a quote at the start of a line.
 */
const MARKDOWN_TEXT_PATTERN: RegExp =
  /\*\*|\]\(|(?:^|\n)[ \t]*(?:#{1,6} |- |> )/;

// Something a template is assigned to that is named for Markdown.
const MARKDOWN_TARGET_PATTERN: RegExp = /markdown|feedInfo|moreInformation/i;

/*
 * Reads that go in as they are, by file and the read's own text, each with
 * its reason. The guard fails on an entry that matches nothing.
 */
const ALLOWED_READS: Record<string, string> = {
  /*
   * An AI access gap's title is OneUptime's own wording (AI access status),
   * not text anyone types.
   */
  "packages/Common/Server/Utils/AI/Remediation/RemediationExecutionRunner.ts: firstGap":
    "an AI access gap's title is OneUptime's own wording",
  // The candidate runbooks listed in a prompt to the model, not a feed item.
  "packages/Common/Server/Utils/AI/Remediation/RemediationPlanRunner.ts: runbook.name":
    "a prompt to the model lists the runbooks; it is not shown in a feed",
};

export interface UnescapedPlainText {
  file: string;
  line: number;
  read: string;
}

function calleeName(call: ts.CallExpression): string | null {
  const callee: ts.Expression = call.expression;

  if (ts.isIdentifier(callee)) {
    return callee.text;
  }

  if (ts.isPropertyAccessExpression(callee)) {
    return callee.name.text;
  }

  return null;
}

function unwrap(expression: ts.Expression): ts.Expression {
  let current: ts.Expression = expression;

  while (
    ts.isParenthesizedExpression(current) ||
    ts.isAwaitExpression(current) ||
    ts.isAsExpression(current) ||
    ts.isNonNullExpression(current)
  ) {
    current = current.expression;
  }

  return current;
}

function isEscaperCall(expression: ts.Expression): boolean {
  const unwrapped: ts.Expression = unwrap(expression);

  return (
    ts.isCallExpression(unwrapped) && ESCAPERS.has(calleeName(unwrapped) || "")
  );
}

/*
 * Whether `node` - somewhere inside `root` - goes into the text only through
 * an escaper, or does not go into it at all: an escaper's argument, a
 * condition, the left side of `&&`, the array whose length is counted.
 */
function isSafePosition(node: ts.Node, root: ts.Node): boolean {
  let current: ts.Node = node;

  while (current !== root) {
    const child: ts.Node = current;
    const parent: ts.Node | undefined = child.parent;

    if (!parent) {
      return false;
    }

    if (
      ts.isCallExpression(parent) &&
      parent.arguments.some((argument: ts.Expression): boolean => {
        return argument === child;
      }) &&
      ESCAPERS.has(calleeName(parent) || "")
    ) {
      return true;
    }

    if (ts.isConditionalExpression(parent) && parent.condition === current) {
      return true;
    }

    if (
      ts.isBinaryExpression(parent) &&
      parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken &&
      parent.left === current
    ) {
      return true;
    }

    if (
      ts.isPropertyAccessExpression(parent) &&
      parent.expression === current &&
      parent.name.text === "length"
    ) {
      return true;
    }

    current = parent;
  }

  return false;
}

// The declaration a name refers to: the nearest one in an enclosing scope.
function declarationOf(identifier: ts.Identifier): ts.Node | null {
  const name: string = identifier.text;
  let scope: ts.Node | undefined = identifier.parent;

  while (scope) {
    let found: ts.Node | null = null;
    const currentScope: ts.Node = scope;

    const visit: (node: ts.Node) => void = (node: ts.Node): void => {
      if (found) {
        return;
      }

      // A nested function's own declarations are not in scope here.
      if (node !== currentScope && ts.isFunctionLike(node)) {
        return;
      }

      if (
        (ts.isVariableDeclaration(node) || ts.isParameter(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === name
      ) {
        found = node;
        return;
      }

      ts.forEachChild(node, visit);
    };

    if (
      ts.isFunctionLike(scope) ||
      ts.isSourceFile(scope) ||
      ts.isBlock(scope) ||
      ts.isForOfStatement(scope) ||
      ts.isForStatement(scope) ||
      ts.isCaseClause(scope)
    ) {
      ts.forEachChild(scope, visit);

      if (found) {
        return found;
      }
    }

    scope = scope.parent;
  }

  return null;
}

// Each `.title` / `.name` read in `expression` that goes into the text raw.
function directPlainReads(expression: ts.Node): Array<ts.Node> {
  const reads: Array<ts.Node> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isPropertyAccessExpression(node) &&
      PLAIN_TEXT_PROPERTIES.has(node.name.text)
    ) {
      const isCallee: boolean =
        ts.isCallExpression(node.parent) && node.parent.expression === node;

      if (!isCallee && !isSafePosition(node, expression)) {
        reads.push(node);
      }

      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return reads;
}

/*
 * What `expression` puts into the text raw: its own `.title` / `.name`
 * reads, and each variable it reads that was set from one without an
 * escaper.
 */
function plainReads(expression: ts.Expression): Array<ts.Node> {
  const reads: Array<ts.Node> = directPlainReads(expression);

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isIdentifier(node)) {
      const parent: ts.Node = node.parent;
      const isPropertyName: boolean =
        (ts.isPropertyAccessExpression(parent) && parent.name === node) ||
        (ts.isPropertyAssignment(parent) && parent.name === node) ||
        (ts.isCallExpression(parent) && parent.expression === node);

      if (!isPropertyName && !isSafePosition(node, expression)) {
        const declaration: ts.Node | null = declarationOf(node);

        if (
          declaration &&
          ts.isVariableDeclaration(declaration) &&
          declaration.initializer &&
          !isEscaperCall(declaration.initializer) &&
          directPlainReads(declaration.initializer).length > 0
        ) {
          reads.push(node);
        }
      }
    }

    if (
      ts.isPropertyAccessExpression(node) &&
      PLAIN_TEXT_PROPERTIES.has(node.name.text)
    ) {
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(expression);

  return reads;
}

/*
 * A template's own text, with a placeholder where each value goes: a value
 * is never the start of a line, so the text after it is not read as one.
 */
function templateText(template: ts.TemplateExpression): string {
  return [
    template.head.text,
    ...template.templateSpans.map((span: ts.TemplateSpan): string => {
      return span.literal.text;
    }),
  ].join("\u0000");
}

// The name of what a template (through parentheses, `||`, `?:` and `+`) is assigned to.
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

function isMarkdownTemplate(template: ts.TemplateExpression): boolean {
  if (MARKDOWN_TEXT_PATTERN.test(templateText(template))) {
    return true;
  }

  const target: string | null = assignmentTargetName(template);

  return Boolean(target && MARKDOWN_TARGET_PATTERN.test(target));
}

// The operands of a chain of `+`, left to right.
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

/**
 * Every title or name read that goes into the Markdown of `sourceText` raw.
 */
export function findUnescapedPlainText(
  fileName: string,
  sourceText: string,
): Array<UnescapedPlainText> {
  const source: ts.SourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
  );

  const found: Array<UnescapedPlainText> = [];
  const seen: Set<ts.Node> = new Set<ts.Node>();

  const report: (read: ts.Node) => void = (read: ts.Node): void => {
    if (seen.has(read)) {
      return;
    }

    seen.add(read);
    found.push({
      file: fileName,
      line:
        source.getLineAndCharacterOfPosition(read.getStart(source)).line + 1,
      read: read.getText(source).replace(/\s+/g, " "),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isTemplateExpression(node) && isMarkdownTemplate(node)) {
      for (const span of node.templateSpans) {
        for (const read of plainReads(span.expression)) {
          report(read);
        }
      }
    }

    /*
     * A chain of `+` with Markdown in one of its strings, at the top of the
     * chain only.
     */
    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      !(
        ts.isBinaryExpression(node.parent) &&
        node.parent.operatorToken.kind === ts.SyntaxKind.PlusToken
      )
    ) {
      const operands: Array<ts.Expression> = concatenationOperands(node);

      const hasMarkdown: boolean = operands.some(
        (operand: ts.Expression): boolean => {
          const text: string | null = ts.isStringLiteral(operand)
            ? operand.text
            : ts.isNoSubstitutionTemplateLiteral(operand)
              ? operand.text
              : ts.isTemplateExpression(operand)
                ? templateText(operand)
                : null;

          return text !== null && MARKDOWN_TEXT_PATTERN.test(text);
        },
      );

      if (hasMarkdown) {
        for (const operand of operands) {
          if (
            ts.isStringLiteral(operand) ||
            ts.isNoSubstitutionTemplateLiteral(operand) ||
            ts.isTemplateExpression(operand)
          ) {
            continue;
          }

          for (const read of plainReads(operand)) {
            report(read);
          }
        }
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return found;
}

function writesFeedItemOfTheFourKinds(sourceText: string): boolean {
  for (const writer of FEED_ITEM_WRITERS) {
    if (sourceText.includes(`.${writer}(`)) {
      return true;
    }
  }

  return false;
}

function listTypeScriptFiles(directory: string): Array<string> {
  if (!fs.existsSync(directory)) {
    return [];
  }

  const files: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (["node_modules", "build", "dist"].includes(entry.name)) {
      continue;
    }

    const fullPath: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...listTypeScriptFiles(fullPath));
    } else if (
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".test.ts") &&
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

interface SinkFile {
  file: string;
  sourceText: string;
}

function readSinkFiles(): Array<SinkFile> {
  const sinks: Array<SinkFile> = [];

  for (const root of SCAN_ROOTS) {
    for (const fullPath of listTypeScriptFiles(root)) {
      const file: string = toRepositoryPath(fullPath);
      const sourceText: string = fs.readFileSync(fullPath, "utf8");

      if (
        file.startsWith(CHAT_DIRECTORY) ||
        INCIDENT_AND_ALERT_JOBS_PATTERN.test(file) ||
        CHAT_BUILDER_FILES.includes(file) ||
        writesFeedItemOfTheFourKinds(sourceText)
      ) {
        sinks.push({ file: file, sourceText: sourceText });
      }
    }
  }

  return sinks;
}

describe("feed items and chat messages place titles and names as text", () => {
  const sinks: Array<SinkFile> = readSinkFiles();

  test("reads the feed and chat code it is meant to read", () => {
    const files: Array<string> = sinks.map((sink: SinkFile): string => {
      return sink.file;
    });

    for (const expected of [
      "packages/Common/Server/Services/AlertService.ts",
      "packages/Common/Server/Services/AlertEpisodeService.ts",
      "packages/Common/Server/Services/AlertEpisodeMemberService.ts",
      "packages/Common/Server/Services/AlertStateTimelineService.ts",
      "packages/Common/Server/Services/IncidentService.ts",
      "packages/Common/Server/Services/IncidentEpisodeService.ts",
      "packages/Common/Server/Services/IncidentEpisodeMemberService.ts",
      "packages/Common/Server/Services/IncidentAlertService.ts",
      "packages/Common/Server/Services/OnCallDutyPolicyExecutionLogTimelineService.ts",
      "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
      "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/Alert.ts",
      "packages/Common/Server/Utils/Workspace/MicrosoftTeams/Actions/AlertEpisode.ts",
      "packages/App/FeatureSet/Workers/Jobs/AlertOwners/SendStateChangeNotification.ts",
      "packages/App/FeatureSet/Workers/Jobs/IncidentStateTimeline/SendNotificationToSubscribers.ts",
      ...CHAT_BUILDER_FILES,
    ]) {
      expect(files).toContain(expected);
    }
  });

  test("every title and name in their Markdown is escaped", () => {
    const unescaped: Array<string> = [];

    for (const sink of sinks) {
      for (const finding of findUnescapedPlainText(
        sink.file,
        sink.sourceText,
      )) {
        const key: string = `${finding.file}: ${finding.read}`;

        if (Object.prototype.hasOwnProperty.call(ALLOWED_READS, key)) {
          continue;
        }

        unescaped.push(`${finding.file}:${finding.line}: ${finding.read}`);
      }
    }

    expect(unescaped).toEqual([]);
  });

  test("every allowed read still exists", () => {
    const stillThere: Set<string> = new Set<string>();

    for (const sink of sinks) {
      for (const finding of findUnescapedPlainText(
        sink.file,
        sink.sourceText,
      )) {
        stillThere.add(`${finding.file}: ${finding.read}`);
      }
    }

    expect(
      Object.keys(ALLOWED_READS).filter((key: string): boolean => {
        return !stillThere.has(key);
      }),
    ).toEqual([]);
  });
});

describe("findUnescapedPlainText", () => {
  function reads(sourceText: string): Array<string> {
    return findUnescapedPlainText("Sample.ts", sourceText).map(
      (finding: UnescapedPlainText): string => {
        return finding.read;
      },
    );
  }

  test("finds a title placed into a feed item raw", () => {
    expect(
      reads("const markdown: string = `**${alert.title || 'No title'}**`;"),
    ).toEqual(["alert.title"]);
  });

  test("passes a title an escaper was given", () => {
    expect(
      reads(
        "const markdown: string = `**${escapeMarkdownValue(alert.title || 'No title')}**`;",
      ),
    ).toEqual([]);
  });

  test("finds a name inside a link's text", () => {
    expect(
      reads("const line: string = `- [${monitor.name}](${link})`;"),
    ).toEqual(["monitor.name"]);
  });

  test("passes a name inside a link's text that was escaped", () => {
    expect(
      reads(
        "const line: string = `- [${escapeMarkdownInline(monitor.name)}](${link})`;",
      ),
    ).toEqual([]);
  });

  test("finds a variable set from a name and placed raw", () => {
    expect(
      reads(
        "function f() { const stateName: string = state?.name || ''; return `to **${stateName}**`; }",
      ),
    ).toEqual(["stateName"]);
  });

  test("passes a variable an escaper set", () => {
    expect(
      reads(
        "function f() { const stateName: string = escapeMarkdownValue(state?.name || ''); return `to **${stateName}**`; }",
      ),
    ).toEqual([]);
  });

  test("finds a name joined into Markdown with +", () => {
    expect(
      reads(
        "const markdown: string = emoji + ' Changed state to **' + newState.name + '**';",
      ),
    ).toEqual(["newState.name"]);
  });

  test("passes a name that only decides what is written", () => {
    expect(
      reads(
        "const markdown: string = `${team?.name ? 'by the team **' + escapeMarkdownValue(team?.name) + '**' : ''}`;",
      ),
    ).toEqual([]);
  });

  test("passes a count of names", () => {
    expect(
      reads(
        "const markdown: string = `**Rules:** ${names.length} rule${names.length === 1 ? '' : 's'}`;",
      ),
    ).toEqual([]);
  });

  test("leaves text that is not Markdown alone: an SMS carries the title as written", () => {
    expect(
      reads(
        "const sms: string = `Alert ${alert.title} is down. Reply to stop.`;",
      ),
    ).toEqual([]);
  });

  test("reads a template named for Markdown even without Markdown in its text", () => {
    expect(
      reads("const feedInfoInMarkdown: string = `Alert: ${alert.title}`;"),
    ).toEqual(["alert.title"]);
  });

  test("finds a name turned into text by a call that does not escape it", () => {
    expect(
      reads("const markdown: string = `**${user.name.toString()}**`;"),
    ).toEqual(["user.name"]);
  });
});
