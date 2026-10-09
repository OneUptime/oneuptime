import fs from "fs";
import path from "path";
import ts from "typescript";
import { describe, expect, test } from "@jest/globals";

/*
 * A RECORD'S TEXT GOES INTO A PROMPT THROUGH PromptText (issue #4587).
 *
 * A description, a root cause, a note can hold a synthetic monitor's
 * screenshot - hundreds of kilobytes of base64 that a model cannot read and
 * is billed for, on every call that carries it - or a log pasted whole. So
 * each builder of a prompt puts such a field in through PromptText.field
 * (or draftField), which leaves embedded files out and holds the field to a
 * length. AIService.executeWithLogging leaves embedded data out of every
 * message as well (AIServiceEmbeddedData.test.ts), but only the builder can
 * hold one field to its length and say what was left out.
 *
 * This guard holds the code to it, reading real syntax through the
 * TypeScript AST:
 *
 *   A. In the code that builds prompts, a record's free-text field -
 *      `.description`, `.rootCause`, `.note`, `.notes`, `.remediationNotes`,
 *      `.postmortemNote` - is never placed into a template literal or joined
 *      with "+" as it is: it goes in through a PromptText call. A log line,
 *      an error, and feed Markdown written with mdText are not prompts. A
 *      field that is OneUptime's own words goes in ALLOWED with its reason;
 *      the list only shrinks.
 *   B. Every file that calls AIService.executeWithLogging is listed below
 *      with the record text it sends and how that text is held. A new
 *      prompt builder fails here until it is read and listed.
 *   C. Only the coding agent's completion keeps embedded data
 *      (keepEmbeddedData): its messages are source files.
 *   D. Negative controls: the scan finds a raw field in a snippet, and lets
 *      a PromptText call, a log line and mdText through.
 *
 * ee/ is scanned when it is there (Common Test runs without it).
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

// Where prompts are built from records (rule A).
const PROMPT_BUILDER_ROOTS: Array<string> = [
  "packages/Common/Server/Utils/AI",
  "packages/Common/Server/Types/Workflow/Components/AI",
  "packages/App/FeatureSet/Runbook/Services/AIStepExecutor.ts",
];

// Where a call to a model may be made from (rules B and C).
const CALLER_SCAN_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/Common/Utils",
  "packages/App/FeatureSet",
  "packages/Runner",
  "ee/Server",
];

const SKIPPED_DIRECTORY_NAMES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
  "Locales",
  "public",
];

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

// A record's free text: what a person or a monitor's template wrote.
const FREE_TEXT_FIELDS: ReadonlySet<string> = new Set<string>([
  "description",
  "rootCause",
  "note",
  "notes",
  "remediationNotes",
  "postmortemNote",
]);

// Calls whose template literals are a log line or an error, not a prompt.
const NOT_A_PROMPT_CALLEE: RegExp =
  /^(?:logger|console)\.\w+$|(?:Error|Exception)$/;

/*
 * Free-text fields placed as they are on purpose: by file, the expression
 * as written, and why.
 */
interface AllowedField {
  file: string;
  expression: string;
  reason: string;
}

const ONEUPTIME_WORDS: string =
  "OneUptime's own words about another AI round (what it is doing), not a record's text.";

const ALLOWED: Array<AllowedField> = [
  {
    file: "packages/Common/Server/Utils/AI/Remediation/RemediationCommandTools.ts",
    expression: "hold.description",
    reason: ONEUPTIME_WORDS,
  },
  {
    file: "packages/Common/Server/Utils/AI/Remediation/RemediationExecutionRunner.ts",
    expression: "resolution.inFlightRound.description",
    reason: ONEUPTIME_WORDS,
  },
  {
    file: "packages/Common/Server/Utils/AI/Remediation/RemediationExecutionRunner.ts",
    expression: "held.hold.description",
    reason: ONEUPTIME_WORDS,
  },
  {
    file: "packages/Common/Server/Utils/AI/SRE/InvestigationEligibility.ts",
    expression: "reasons[code].description",
    reason:
      "OneUptime's own sentence for why an investigation did not start, shown on the AI card.",
  },
  ...["data.note", "scope.note"].map((expression: string): AllowedField => {
    return {
      file: "packages/Common/Server/Utils/AI/Toolbox/ResourceTools.ts",
      expression,
      reason:
        "OneUptime's own note on what a resource's data covers, not a record's text.",
    };
  }),
  {
    file: "packages/Common/Server/Utils/AI/Toolbox/TimelineTools.ts",
    expression: "item.rootCause",
    reason:
      "Part of a tool row's entry: ToolResultSerializer.serializeRows leaves embedded data out of every field and holds it to MAX_FIELD_LENGTH.",
  },
  {
    file: "packages/Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts",
    expression: "contextData.incident.rootCause",
    reason:
      "Matched against the device's port names to pick the transceivers to show; never sent to a model.",
  },
  {
    file: "packages/Common/Server/Utils/AI/SRE/AlertInvestigationRunner.ts",
    expression: "contextData.alert.rootCause",
    reason:
      "Matched against the device's port names to pick the transceivers to show; never sent to a model.",
  },
];

/*
 * Every file that calls AIService.executeWithLogging, and how the record
 * text it sends is held (rule B).
 */
const PROMPT_BUILDERS: Record<string, string> = {
  "packages/Common/Server/Services/IncidentService.ts":
    "The postmortem draft: IncidentAIContextBuilder.formatIncidentContextForPostmortem, every field a draftField.",
  "packages/Common/Server/API/IncidentAPI.ts":
    "Postmortem and note drafts: IncidentAIContextBuilder, every field a draftField.",
  "packages/Common/Server/API/AlertAPI.ts":
    "Note drafts: AlertAIContextBuilder.formatAlertContextForNote, every field a draftField.",
  "packages/Common/Server/API/IncidentEpisodeAPI.ts":
    "Postmortem drafts: IncidentEpisodeAIContextBuilder, every field a draftField or a field.",
  "packages/Common/Server/API/ScheduledMaintenanceAPI.ts":
    "Note drafts: ScheduledMaintenanceAIContextBuilder, every field a draftField.",
  "packages/Common/Server/Types/Workflow/Components/AI/GenerateText.ts":
    "A workflow's own prompt and context: PromptText.omitEmbeddedData before the input is measured.",
  "packages/App/FeatureSet/Runbook/Services/AIStepExecutor.ts":
    "The linked record through its context builder; step outputs through redactAndOmitEmbeddedData; descriptions and notes as fields.",
  "packages/Common/Server/Utils/AI/Chat/ObservabilityAssistant.ts":
    "The agent loop of investigations and chat-ops: the seed is built through PromptText (the runners, the engine), tool results through the serializer.",
  "packages/Common/Server/Utils/AI/Chat/ChatAgentRunner.ts":
    "Ask AI and the investigation thread: the thread's subject through InvestigationThread (fields), tool results through the serializer.",
  "packages/Common/Server/Utils/AI/SRE/ConfidenceSignal.ts":
    "The run's own analysis, written by the model: no record text.",
  "packages/Common/Server/Utils/AI/SRE/InvestigationTldr.ts":
    "The run's own analysis, written by the model: no record text.",
  "packages/Common/Server/Utils/AI/SRE/InvestigationGrader.ts":
    "The recorded root cause as a field of MAX_ROOT_CAUSE_CHARS.",
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts":
    "The coding agent's own messages: source files, sent as they are (keepEmbeddedData).",
};

// The one caller that may keep embedded data (rule C).
const KEEPS_EMBEDDED_DATA: Array<string> = [
  "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
];

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function listSources(target: string): Array<string> {
  const full: string = path.join(REPOSITORY_ROOT, target);

  if (!fs.existsSync(full)) {
    return [];
  }

  if (fs.statSync(full).isFile()) {
    return [full];
  }

  const found: Array<string> = [];

  for (const entry of fs.readdirSync(full, { withFileTypes: true })) {
    const child: string = path.join(full, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.includes(entry.name)) {
        found.push(...listSources(relative(child)));
      }
    } else if (
      SOURCE_FILE.test(entry.name) &&
      !DECLARATION_FILE.test(entry.name)
    ) {
      found.push(child);
    }
  }

  return found;
}

function parse(fileName: string, sourceText: string): ts.SourceFile {
  return ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

// The field an expression places as it is, or null (a call, a literal, ...).
function rawFreeTextField(expression: ts.Expression): ts.Expression | null {
  if (
    ts.isParenthesizedExpression(expression) ||
    ts.isNonNullExpression(expression) ||
    ts.isAsExpression(expression)
  ) {
    return rawFreeTextField(expression.expression);
  }

  if (
    ts.isBinaryExpression(expression) &&
    (expression.operatorToken.kind === ts.SyntaxKind.BarBarToken ||
      expression.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken)
  ) {
    return (
      rawFreeTextField(expression.left) || rawFreeTextField(expression.right)
    );
  }

  if (ts.isConditionalExpression(expression)) {
    return (
      rawFreeTextField(expression.whenTrue) ||
      rawFreeTextField(expression.whenFalse)
    );
  }

  if (
    ts.isPropertyAccessExpression(expression) &&
    FREE_TEXT_FIELDS.has(expression.name.text)
  ) {
    return expression;
  }

  return null;
}

// Whether a node sits in a log line, an error, or feed Markdown.
function isInsideNonPrompt(node: ts.Node): boolean {
  for (
    let ancestor: ts.Node | undefined = node.parent;
    ancestor;
    ancestor = ancestor.parent
  ) {
    if (ts.isTaggedTemplateExpression(ancestor)) {
      return true;
    }

    if (
      (ts.isCallExpression(ancestor) || ts.isNewExpression(ancestor)) &&
      NOT_A_PROMPT_CALLEE.test(ancestor.expression.getText())
    ) {
      return true;
    }
  }

  return false;
}

interface RawField {
  file: string;
  line: number;
  expression: string;
}

// Every free-text field placed into a template or joined with "+" as it is.
function findRawFields(fileName: string, sourceText: string): Array<RawField> {
  const sourceFile: ts.SourceFile = parse(fileName, sourceText);
  const found: Array<RawField> = [];

  const report: (placed: ts.Expression) => void = (
    placed: ts.Expression,
  ): void => {
    const field: ts.Expression | null = rawFreeTextField(placed);

    if (!field || isInsideNonPrompt(placed)) {
      return;
    }

    found.push({
      file: fileName,
      line: sourceFile.getLineAndCharacterOfPosition(field.getStart()).line + 1,
      expression: field.getText().replace(/\?\./g, "."),
    });
  };

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (ts.isTemplateSpan(node)) {
      report(node.expression);
    }

    if (
      ts.isBinaryExpression(node) &&
      node.operatorToken.kind === ts.SyntaxKind.PlusToken &&
      (ts.isStringLiteralLike(node.left) ||
        ts.isTemplateExpression(node.left) ||
        ts.isStringLiteralLike(node.right) ||
        ts.isTemplateExpression(node.right))
    ) {
      report(node.left);
      report(node.right);
    }

    ts.forEachChild(node, visit);
  };

  visit(sourceFile);

  return found;
}

function isAllowed(field: RawField): boolean {
  return ALLOWED.some((allowed: AllowedField): boolean => {
    return (
      allowed.file === field.file && allowed.expression === field.expression
    );
  });
}

function scanPromptBuilders(): Array<RawField> {
  return PROMPT_BUILDER_ROOTS.flatMap((root: string): Array<RawField> => {
    return listSources(root).flatMap((file: string): Array<RawField> => {
      return findRawFields(relative(file), fs.readFileSync(file, "utf8"));
    });
  });
}

const EXECUTE_WITH_LOGGING_CALL: RegExp = /\.executeWithLogging\(/;
const KEEP_EMBEDDED_DATA: RegExp = /\bkeepEmbeddedData\s*:/;

function callerFiles(pattern: RegExp): Array<string> {
  return CALLER_SCAN_ROOTS.flatMap((root: string): Array<string> => {
    return listSources(root);
  })
    .filter((file: string): boolean => {
      return pattern.test(fs.readFileSync(file, "utf8"));
    })
    .map(relative)
    .filter((file: string): boolean => {
      // AIService defines it (and its interface names the flag).
      return file !== "packages/Common/Server/Services/AIService.ts";
    })
    .sort();
}

describe("a record's text goes into a prompt through PromptText", () => {
  test("the scan reads the prompt builders", () => {
    const files: Array<string> = PROMPT_BUILDER_ROOTS.flatMap(
      (root: string): Array<string> => {
        return listSources(root).map(relative);
      },
    );

    expect(files).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts",
        "packages/Common/Server/Utils/AI/SRE/AlertInvestigationRunner.ts",
        "packages/Common/Server/Utils/AI/SRE/InvestigationThread.ts",
        "packages/Common/Server/Utils/AI/IncidentAIContextBuilder.ts",
        "packages/Common/Server/Utils/AI/AlertAIContextBuilder.ts",
        "packages/Common/Server/Utils/AI/IncidentEpisodeAIContextBuilder.ts",
        "packages/Common/Server/Utils/AI/ScheduledMaintenanceAIContextBuilder.ts",
        "packages/Common/Server/Types/Workflow/Components/AI/GenerateText.ts",
        "packages/App/FeatureSet/Runbook/Services/AIStepExecutor.ts",
      ]),
    );
  });

  test("A: no prompt builder places a free-text field as it is", () => {
    const raw: Array<string> = scanPromptBuilders()
      .filter((field: RawField): boolean => {
        return !isAllowed(field);
      })
      .map((field: RawField): string => {
        return `${field.file}:${field.line}: ${field.expression} - put it in through PromptText.field (or draftField)`;
      });

    expect(raw).toEqual([]);
  });

  test("A: every allowed field is still there (the list only shrinks)", () => {
    const found: Array<RawField> = scanPromptBuilders();
    const stale: Array<string> = ALLOWED.filter(
      (allowed: AllowedField): boolean => {
        return !found.some((field: RawField): boolean => {
          return (
            field.file === allowed.file &&
            field.expression === allowed.expression
          );
        });
      },
    ).map((allowed: AllowedField): string => {
      return `${allowed.file}: ${allowed.expression}`;
    });

    expect(stale).toEqual([]);
  });

  test("B: every caller of executeWithLogging is a listed prompt builder", () => {
    expect(callerFiles(EXECUTE_WITH_LOGGING_CALL)).toEqual(
      Object.keys(PROMPT_BUILDERS).sort(),
    );
  });

  test("C: only the coding agent keeps embedded data", () => {
    expect(callerFiles(KEEP_EMBEDDED_DATA)).toEqual(KEEPS_EMBEDDED_DATA);
  });
});

describe("the scan itself (negative controls)", () => {
  test("finds a field placed as it is, however it is wrapped", () => {
    const found: Array<string> = findRawFields(
      "snippet.ts",
      [
        "const a = `Description: ${incident.description}`;",
        'const b = `Root cause: ${alert?.rootCause || "N/A"}`;',
        "const c = `- ${note.note!}`;",
        "const d = 'Notes: ' + step.notes;",
        "const e = `${x ? episode.remediationNotes : ''}`;",
        "const f = `${(incident.postmortemNote as string)}`;",
      ].join("\n"),
    ).map((field: RawField): string => {
      return field.expression;
    });

    expect(found).toEqual([
      "incident.description",
      "alert.rootCause",
      "note.note",
      "step.notes",
      "episode.remediationNotes",
      "incident.postmortemNote",
    ]);
  });

  test("lets a PromptText call, a log line, an error and feed Markdown through", () => {
    expect(
      findRawFields(
        "snippet.ts",
        [
          "const a = `Description: ${PromptText.field(incident.description)}`;",
          "const b = `${PromptText.draftField(note.note) || 'N/A'}`;",
          "logger.error(`could not read ${incident.description}`);",
          "throw new BadDataException(`bad ${runbook.description}`);",
          "const c = mdText`**${incident.description}**`;",
          "const d = `${incident.title} ${monitor.name}`;",
        ].join("\n"),
      ),
    ).toEqual([]);
  });
});
