import * as AIServiceModule from "../../../../../Server/Services/AIService";
import { DATA_SECURITY_AI_CALL_LABELS } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import { NEVER_SENT_COLUMNS } from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiInput";
import {
  DATA_SECURITY_AI_FEATURES,
  DataSecurityAiFeature,
  DataSecurityAiFeatureInfo,
} from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * ONEUPTIME AI NEVER SEES A SENSITIVE VALUE IN DATA SECURITY (#10365), AND
 * NOTHING OF WHAT IT IS TOLD IS KEPT WHERE OTHERS READ IT (#10361).
 *
 * A data security product that sends its findings to a model has made a
 * new copy of what it protects. So every Data Security prompt is made one
 * way - DataSecurityAiInput, from an allow-list: names, shapes, counts and
 * configuration, never a value, a masked sample, a record or a connection
 * string - and asked one way - DataSecurityAiCall, which keeps no preview,
 * no provider error and no telemetry content. This guard fails on any
 * other way, read through the TypeScript AST:
 *
 *   A. Every Data Security AI feature is listed in DATA_SECURITY_AI_FEATURES
 *      (Types/DataSecurity/DataSecurityAiFeatures, what Settings and the
 *      docs say), and here with the file that makes its call - as
 *      AUTONOMOUS_AI_FEATURES is kept. A feature's call that is not listed,
 *      or a listed one that is gone, fails.
 *   B. The only executeWithLogging call a Data Security file makes - or
 *      that names a Data Security label (AI_DATA_SECURITY_*) - is
 *      DataSecurityAiCall's, and it says storeContentPreviews: false,
 *      storeErrorDetails: false and recordContentInTelemetry: false, takes
 *      its feature from the prompt's feature (DATA_SECURITY_AI_CALL_LABELS)
 *      and sends the prompt's messages. Every Data Security label is one of
 *      those.
 *   C. A prompt is one DataSecurityAiInput made: no other file names its
 *      brand or casts a value to a prompt or a request.
 *   D. No Data Security AI file names a column that holds a value
 *      (NEVER_SENT_COLUMNS: a finding's masked samples and sample records,
 *      a store's connection string, a cloud connection's secrets, a
 *      telemetry record's body), nor imports what reads telemetry records:
 *      a select cannot ask for one, and no fact can read one.
 *   E. What Settings says each feature keeps of a failed call is what its
 *      calls do: keepsProviderErrors is false exactly where every call of
 *      the feature says storeErrorDetails: false (#10457).
 *   F. Negative controls: each rule catches what it is for in a snippet.
 *
 * ee/ is scanned when it is there (Common Test runs without it).
 */

// packages/Common/Tests/Server/Utils/AI/DataSecurity -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../../..");

const SCAN_ROOTS: Array<string> = [
  "packages/Common/Server",
  "packages/App/FeatureSet",
  "ee/Server",
];

const SKIPPED_DIRECTORY_NAMES: Array<string> = [
  "node_modules",
  "build",
  "dist",
  "Tests",
];

// What makes a call one of Data Security's.
const DATA_SECURITY_LABEL: RegExp = /\bAI_DATA_SECURITY_[A-Z_]+_FEATURE\b/;
const DATA_SECURITY_FILE: RegExp = /(^|\/)DataSecurity(\/|[A-Za-z]*\.ts$)/;
// The types only the builder may give a value.
const PROMPT_TYPE: RegExp = /\bDataSecurityAi(?:Prompt|CodeRequest)\b/;

const AI_DIRECTORY: string = "packages/Common/Server/Utils/AI/DataSecurity";
const INPUT_FILE: string = `${AI_DIRECTORY}/DataSecurityAiInput.ts`;
const CALL_FILE: string = `${AI_DIRECTORY}/DataSecurityAiCall.ts`;
const TOOLS_FILE: string =
  "packages/Common/Server/Utils/AI/Toolbox/DataSecurityTools.ts";

/*
 * Every Data Security AI feature, and how its call is made: through
 * DataSecurityAiCall.ask, as a task in Code, or as Ask AI's tool rows.
 */
type FeatureCall =
  | { kind: "ask"; file: string }
  | { kind: "codeTask"; file: string; agentFile: string }
  | { kind: "askAiTools"; file: string; chatFile: string };

const FEATURE_CALLS: Record<DataSecurityAiFeature, FeatureCall> = {
  /*
   * OneUptime AI's analysis of an issue (#10369): a person's, from the
   * issue's page or Explain with AI, and its own of a new issue (#10364),
   * in its queue job - one file, one call.
   */
  [DataSecurityAiFeature.ExplainIssue]: {
    kind: "ask",
    file: `${AI_DIRECTORY}/DataSecurityIssueAnalysis.ts`,
  },
  [DataSecurityAiFeature.AnalyzeIssue]: {
    kind: "ask",
    file: `${AI_DIRECTORY}/DataSecurityIssueAnalysis.ts`,
  },
  [DataSecurityAiFeature.SuggestFieldTypes]: {
    kind: "ask",
    file: `${AI_DIRECTORY}/FieldSuggestion.ts`,
  },
  // Owners for a store with none (#10374), in the engine's and the daily run's jobs.
  [DataSecurityAiFeature.ProposeStoreOwners]: {
    kind: "ask",
    file: `${AI_DIRECTORY}/DataStoreOwnerPlanner.ts`,
  },
  [DataSecurityAiFeature.FixIssue]: {
    kind: "codeTask",
    file: `${AI_DIRECTORY}/DataSecurityCodeTask.ts`,
    // The coding agent's completions, which read the request.
    agentFile:
      "packages/Common/Server/Utils/AI/CodeFix/CodeFixAgentCompletion.ts",
  },
  [DataSecurityAiFeature.AskAi]: {
    kind: "askAiTools",
    file: TOOLS_FILE,
    // The chat whose next calls read the tools' rows.
    chatFile: "packages/Common/Server/Utils/AI/Chat/ChatAgentRunner.ts",
  },
};

/*
 * The files of Data Security's AI: every file under its folder, and the
 * tools Ask AI reads it with. None may name a column that holds a value.
 */
function isDataSecurityAiFile(file: string): boolean {
  return file.startsWith(`${AI_DIRECTORY}/`) || file === TOOLS_FILE;
}

// What reads telemetry records, which no Data Security AI file imports.
const RECORD_READERS: RegExp =
  /TelemetryFindingOccurrences|FindingSampleRecord|\/AnalyticsModels\/|Services\/(?:Log|Span|ExceptionInstance|Metric|MonitorLog)Service\b/;

// Every column that holds a value, by its name.
const NEVER_SENT: ReadonlySet<string> = new Set(
  Object.values(NEVER_SENT_COLUMNS).flat(),
);

interface SourceFile {
  file: string;
  text: string;
  source: ts.SourceFile;
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  if (!fs.existsSync(directory)) {
    return found;
  }

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORY_NAMES.includes(entry.name)) {
        found.push(...listSourceFiles(full));
      }

      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

function parse(file: string, text: string): SourceFile {
  return {
    file,
    text,
    source: ts.createSourceFile(
      file,
      text,
      ts.ScriptTarget.Latest,
      true,
      file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
    ),
  };
}

function propertyText(
  request: ts.ObjectLiteralExpression,
  name: string,
  source: ts.SourceFile,
): string | null {
  for (const property of request.properties) {
    if (
      ts.isPropertyAssignment(property) &&
      property.name.getText(source) === name
    ) {
      return property.initializer.getText(source).replace(/\s+/g, " ");
    }

    if (
      ts.isShorthandPropertyAssignment(property) &&
      property.name.getText(source) === name
    ) {
      return name;
    }
  }

  return null;
}

function lineOf(node: ts.Node, source: ts.SourceFile): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

function visitAll(node: ts.Node, visit: (node: ts.Node) => void): void {
  visit(node);
  ts.forEachChild(node, (child: ts.Node): void => {
    visitAll(child, visit);
  });
}

// A call of `object.method(...)`, by the method's name.
function isMethodCall(
  node: ts.Node,
  method: string,
): node is ts.CallExpression {
  return (
    ts.isCallExpression(node) &&
    ts.isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === method
  );
}

interface ModelCall {
  file: string;
  line: number;
  // The request, as written: an object at the call, or null.
  request: ts.ObjectLiteralExpression | null;
  feature: string;
  settings: Record<string, string | null>;
}

const SETTINGS: Array<string> = [
  "storeContentPreviews",
  "storeErrorDetails",
  "recordContentInTelemetry",
  "messages",
];

// Every executeWithLogging call in a file.
function findModelCalls(file: SourceFile): Array<ModelCall> {
  const calls: Array<ModelCall> = [];

  visitAll(file.source, (node: ts.Node): void => {
    if (!isMethodCall(node, "executeWithLogging")) {
      return;
    }

    const argument: ts.Expression | undefined = node.arguments[0];
    const request: ts.ObjectLiteralExpression | null =
      argument && ts.isObjectLiteralExpression(argument) ? argument : null;
    const settings: Record<string, string | null> = {};

    for (const name of SETTINGS) {
      settings[name] = request
        ? propertyText(request, name, file.source)
        : null;
    }

    calls.push({
      file: file.file,
      line: lineOf(node, file.source),
      request,
      feature: request
        ? propertyText(request, "feature", file.source) || ""
        : argument?.getText(file.source) || "",
      settings,
    });
  });

  return calls;
}

// Whether a call is one of Data Security's: from its code, or under its label.
function isDataSecurityModelCall(call: ModelCall): boolean {
  return (
    DATA_SECURITY_FILE.test(call.file) || DATA_SECURITY_LABEL.test(call.feature)
  );
}

// What is wrong with a Data Security model call, or nothing (rule B).
function getModelCallProblems(call: ModelCall): Array<string> {
  if (call.file !== CALL_FILE) {
    return [
      `asks a model itself: build the prompt with DataSecurityAiInput and ask through DataSecurityAiCall.ask (${CALL_FILE})`,
    ];
  }

  if (!call.request) {
    return [
      "its request is not an object written at the call, so what it keeps cannot be read",
    ];
  }

  const problems: Array<string> = [];

  if (call.settings["storeContentPreviews"] !== "false") {
    problems.push("keeps previews: say storeContentPreviews: false");
  }

  if (call.settings["storeErrorDetails"] !== "false") {
    problems.push("keeps a provider's error: say storeErrorDetails: false");
  }

  if (call.settings["recordContentInTelemetry"] !== "false") {
    problems.push(
      "puts the prompt on its span: say recordContentInTelemetry: false",
    );
  }

  if (call.settings["messages"] !== "request.prompt.messages") {
    problems.push(
      "sends messages of its own: send request.prompt.messages, a prompt DataSecurityAiInput made",
    );
  }

  if (call.feature !== "label") {
    problems.push(
      "files the call under a label of its own: take it from DATA_SECURITY_AI_CALL_LABELS",
    );
  }

  return problems;
}

interface NamedColumn {
  file: string;
  line: number;
  name: string;
}

/*
 * Every place a file names a column that holds a value: a property read or
 * written (finding.maskedSamples, select: { connectionString: true }), a
 * string naming it (select["sampleRecords"]), or an element access. The
 * list of those columns itself (NEVER_SENT_COLUMNS) is the one place that
 * may name them.
 */
function findNeverSentColumns(file: SourceFile): Array<NamedColumn> {
  const found: Array<NamedColumn> = [];

  const isInTheList: (node: ts.Node) => boolean = (node: ts.Node): boolean => {
    for (
      let ancestor: ts.Node | undefined = node.parent;
      ancestor;
      ancestor = ancestor.parent
    ) {
      if (
        ts.isVariableDeclaration(ancestor) &&
        ancestor.name.getText(file.source) === "NEVER_SENT_COLUMNS"
      ) {
        return true;
      }
    }

    return false;
  };

  const report: (node: ts.Node, name: string) => void = (
    node: ts.Node,
    name: string,
  ): void => {
    if (NEVER_SENT.has(name) && !isInTheList(node)) {
      found.push({ file: file.file, line: lineOf(node, file.source), name });
    }
  };

  visitAll(file.source, (node: ts.Node): void => {
    if (ts.isPropertyAccessExpression(node)) {
      report(node.name, node.name.text);
    } else if (
      ts.isPropertyAssignment(node) &&
      (ts.isArrayLiteralExpression(node.initializer)
        ? node.initializer.elements.length === 0
        : node.initializer.kind === ts.SyntaxKind.NullKeyword)
    ) {
      /*
       * Naming a column to say it holds nothing - an AI suggestion's
       * finding is written with no samples (maskedSamples: []) - reads
       * nothing.
       */
      return;
    } else if (
      (ts.isPropertyAssignment(node) ||
        ts.isShorthandPropertyAssignment(node) ||
        ts.isPropertySignature(node) ||
        ts.isPropertyDeclaration(node)) &&
      (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
    ) {
      report(node.name, node.name.text);
    } else if (ts.isStringLiteralLike(node)) {
      report(node, node.text);
    } else if (ts.isBindingElement(node)) {
      report(node, (node.propertyName || node.name).getText(file.source));
    }
  });

  return found;
}

// Every import of a module that reads telemetry records.
function findRecordReaders(file: SourceFile): Array<string> {
  const found: Array<string> = [];

  for (const statement of file.source.statements) {
    if (
      ts.isImportDeclaration(statement) &&
      ts.isStringLiteral(statement.moduleSpecifier) &&
      RECORD_READERS.test(statement.moduleSpecifier.text)
    ) {
      found.push(`${file.file}: ${statement.moduleSpecifier.text}`);
    }
  }

  return found;
}

// Every place a file makes a prompt by hand: its brand, or a cast to one.
function findHandMadePrompts(file: SourceFile): Array<string> {
  const found: Array<string> = [];

  visitAll(file.source, (node: ts.Node): void => {
    if (
      (ts.isAsExpression(node) || ts.isTypeAssertionExpression(node)) &&
      PROMPT_TYPE.test(node.type.getText(file.source))
    ) {
      found.push(
        `${file.file}:${lineOf(node, file.source)}: casts a value to ${node.type.getText(file.source)}`,
      );
    }

    if (ts.isIdentifier(node) && node.text === "PROMPT_MADE_HERE") {
      found.push(
        `${file.file}:${lineOf(node, file.source)}: names the brand only DataSecurityAiInput sets`,
      );
    }
  });

  return found;
}

// Every DataSecurityAiCall.ask call, and every Code task a file starts.
function findCalls(file: SourceFile, method: string): Array<ts.CallExpression> {
  const calls: Array<ts.CallExpression> = [];

  visitAll(file.source, (node: ts.Node): void => {
    if (
      isMethodCall(node, method) &&
      ts.isPropertyAccessExpression(node.expression)
    ) {
      calls.push(node);
    }
  });

  return calls;
}

function receiverOf(call: ts.CallExpression, source: ts.SourceFile): string {
  return (call.expression as ts.PropertyAccessExpression).expression.getText(
    source,
  );
}

const SERVER_FILES: Array<SourceFile> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root));
  },
).map((full: string): SourceFile => {
  return parse(
    path.relative(REPOSITORY_ROOT, full).split(path.sep).join("/"),
    fs.readFileSync(full, "utf8"),
  );
});

function serverFile(relative: string): SourceFile {
  const found: SourceFile | undefined = SERVER_FILES.find(
    (file: SourceFile): boolean => {
      return file.file === relative;
    },
  );

  expect({ file: relative, found: Boolean(found) }).toEqual({
    file: relative,
    found: true,
  });

  return found!;
}

const MODEL_CALLS: Array<ModelCall> = SERVER_FILES.filter(
  (file: SourceFile): boolean => {
    return file.text.includes("executeWithLogging");
  },
).flatMap(findModelCalls);

const DATA_SECURITY_MODEL_CALLS: Array<ModelCall> = MODEL_CALLS.filter(
  isDataSecurityModelCall,
);

const AI_FILES: Array<SourceFile> = SERVER_FILES.filter(
  (file: SourceFile): boolean => {
    return isDataSecurityAiFile(file.file);
  },
);

describe("A: every Data Security AI feature is listed, with the file that makes its call", () => {
  test("the list here is the catalog's: no feature without its call, no call without its feature", () => {
    expect(
      DATA_SECURITY_AI_FEATURES.map(
        (info: DataSecurityAiFeatureInfo): string => {
          return info.feature;
        },
      ).sort(),
    ).toEqual(Object.keys(FEATURE_CALLS).sort());
  });

  test("the files that ask OneUptime AI through DataSecurityAiCall are the listed ones", () => {
    const asking: Array<string> = SERVER_FILES.filter(
      (file: SourceFile): boolean => {
        return findCalls(file, "ask").some(
          (call: ts.CallExpression): boolean => {
            return receiverOf(call, file.source) === "DataSecurityAiCall";
          },
        );
      },
    )
      .map((file: SourceFile): string => {
        return file.file;
      })
      .sort();

    expect(asking).toEqual(
      Array.from(
        new Set(
          Object.values(FEATURE_CALLS)
            .filter((call: FeatureCall): boolean => {
              return call.kind === "ask";
            })
            .map((call: FeatureCall): string => {
              return call.file;
            }),
        ),
      ).sort(),
    );
  });

  test("each call it makes hands it a prompt the builder made, and the features that call a model are the labelled ones", () => {
    for (const [feature, call] of Object.entries(FEATURE_CALLS)) {
      if (call.kind !== "ask") {
        expect(
          DATA_SECURITY_AI_CALL_LABELS[feature as DataSecurityAiFeature],
        ).toBeUndefined();
        continue;
      }

      expect(
        DATA_SECURITY_AI_CALL_LABELS[feature as DataSecurityAiFeature],
      ).toBeDefined();

      const file: SourceFile = serverFile(call.file);

      for (const ask of findCalls(file, "ask")) {
        if (receiverOf(ask, file.source) !== "DataSecurityAiCall") {
          continue;
        }

        const request: ts.Expression | undefined = ask.arguments[0];

        expect(request && ts.isObjectLiteralExpression(request)).toBe(true);

        const prompt: string =
          propertyText(
            request as ts.ObjectLiteralExpression,
            "prompt",
            file.source,
          ) || "";

        // A builder's call, written at the ask: build...Prompt(...).
        expect({ file: call.file, prompt }).toEqual({
          file: call.file,
          prompt: expect.stringMatching(/^build[A-Za-z]*Prompt\(/),
        });
      }
    }
  });

  test("Data Security starts a task in Code only where its fix is listed, with a request the builder made", () => {
    const starting: Array<string> = SERVER_FILES.filter(
      (file: SourceFile): boolean => {
        return (
          DATA_SECURITY_FILE.test(file.file) &&
          ["start", "startForOneUptime"].some((method: string): boolean => {
            return findCalls(file, method).some(
              (call: ts.CallExpression): boolean => {
                return receiverOf(call, file.source) === "CodeTaskRuns";
              },
            );
          })
        );
      },
    ).map((file: SourceFile): string => {
      return file.file;
    });

    expect(starting).toEqual([
      (FEATURE_CALLS[DataSecurityAiFeature.FixIssue] as { file: string }).file,
    ]);

    const task: SourceFile = serverFile(starting[0]!);

    expect(task.text).toContain(
      "buildMessage: () => Promise<DataSecurityAiCodeRequest>;",
    );
    expect(task.text).toContain("message: request.text,");
    expect(task.text).toContain("isDataSecurityAiCodeRequest(request)");
  });

  test("Ask AI's tools make every row they hand the model with the builder", () => {
    const tools: SourceFile = serverFile(TOOLS_FILE);

    for (const row of [
      "DataSecurityAiInput.storeRow(",
      "DataSecurityAiInput.findingRow(",
      "DataSecurityAiInput.accessRow(",
      "DataSecurityAiInput.reachableStoreRow(",
      "DataSecurityAiInput.issueListRow(",
      "DataSecurityAiInput.storeIssueRow(",
      "DataSecurityAiInput.issueRow(",
    ]) {
      expect({ row, made: tools.text.includes(row) }).toEqual({
        row,
        made: true,
      });
    }

    // No row is an object literal of its own: each serializeRows is handed the builder's.
    const handMade: Array<string> = [];

    visitAll(tools.source, (node: ts.Node): void => {
      if (
        isMethodCall(node, "serializeRows") &&
        node.arguments[0] &&
        ts.isArrayLiteralExpression(node.arguments[0]) &&
        node.arguments[0].elements.some((element: ts.Expression): boolean => {
          return ts.isObjectLiteralExpression(element);
        })
      ) {
        handMade.push(`${TOOLS_FILE}:${lineOf(node, tools.source)}`);
      }
    });

    expect(handMade).toEqual([]);
  });
});

describe("B: Data Security asks a model one way, and keeps nothing of it", () => {
  test("the scan finds the one call", () => {
    expect(
      DATA_SECURITY_MODEL_CALLS.map((call: ModelCall): string => {
        return call.file;
      }),
    ).toEqual([CALL_FILE]);
  });

  test.each(
    DATA_SECURITY_MODEL_CALLS.map((call: ModelCall): [string, ModelCall] => {
      return [`${call.file}:${call.line}`, call];
    }),
  )(
    "%s keeps no preview, no provider error and no span content",
    (_where: string, call: ModelCall) => {
      expect({
        call: `${call.file}:${call.line}`,
        problems: getModelCallProblems(call),
      }).toEqual({ call: `${call.file}:${call.line}`, problems: [] });
    },
  );

  test("every Data Security label is a feature's, filed by the one call", () => {
    const labels: Array<string> = Object.keys(AIServiceModule)
      .filter((name: string): boolean => {
        return DATA_SECURITY_LABEL.test(name);
      })
      .map((name: string): string => {
        return (AIServiceModule as unknown as Record<string, string>)[name]!;
      })
      .sort();

    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(Object.values(DATA_SECURITY_AI_CALL_LABELS).sort()).toEqual(labels);
  });

  test("the label Explain with AI writes keeps the value its AI Logs rows were written with", () => {
    expect(AIServiceModule.AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE).toBe(
      "DataSecurityIssueExplanation",
    );
  });

  test("the field suggestions, which no person starts, count toward the autonomous budget", () => {
    expect(AIServiceModule.AUTONOMOUS_AI_FEATURES).toContain(
      AIServiceModule.AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE,
    );
    expect(AIServiceModule.AUTONOMOUS_AI_FEATURES).not.toContain(
      AIServiceModule.AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
    );
  });
});

describe("C: a prompt is one DataSecurityAiInput made", () => {
  test("no other file sets its brand or casts a value to a prompt", () => {
    const handMade: Array<string> = SERVER_FILES.filter(
      (file: SourceFile): boolean => {
        return file.file !== INPUT_FILE;
      },
    ).flatMap(findHandMadePrompts);

    expect(handMade).toEqual([]);
  });

  test("the call refuses what is not one, before it sends anything", () => {
    const call: SourceFile = serverFile(CALL_FILE);

    expect(call.text).toContain("if (!isDataSecurityAiPrompt(request.prompt))");
    expect(
      call.text.indexOf("isDataSecurityAiPrompt(request.prompt)"),
    ).toBeLessThan(call.text.indexOf("AIService.executeWithLogging("));
  });
});

describe("D: no Data Security AI file can read a value", () => {
  test("the scan reads the files it should", () => {
    expect(
      AI_FILES.map((file: SourceFile): string => {
        return file.file;
      }),
    ).toEqual(
      expect.arrayContaining([
        INPUT_FILE,
        CALL_FILE,
        `${AI_DIRECTORY}/DataSecurityAiReads.ts`,
        `${AI_DIRECTORY}/DataSecurityIssuePrompt.ts`,
        `${AI_DIRECTORY}/FieldSuggestion.ts`,
        `${AI_DIRECTORY}/FieldSuggestionPrompt.ts`,
        `${AI_DIRECTORY}/DataSecurityCodeTask.ts`,
        TOOLS_FILE,
      ]),
    );
  });

  test("none names a column that holds a value", () => {
    expect(
      AI_FILES.flatMap(findNeverSentColumns).map(
        (named: NamedColumn): string => {
          return `${named.file}:${named.line}: ${named.name}`;
        },
      ),
    ).toEqual([]);
  });

  test("none imports what reads a telemetry record", () => {
    expect(AI_FILES.flatMap(findRecordReaders)).toEqual([]);
  });
});

describe("E: what Settings says a feature keeps of a failed call is what its calls do", () => {
  test.each(
    DATA_SECURITY_AI_FEATURES.map(
      (
        info: DataSecurityAiFeatureInfo,
      ): [string, DataSecurityAiFeatureInfo] => {
        return [info.feature, info];
      },
    ),
  )("%s", (_feature: string, info: DataSecurityAiFeatureInfo) => {
    const call: FeatureCall = FEATURE_CALLS[info.feature];
    const files: Array<string> =
      call.kind === "ask"
        ? [CALL_FILE]
        : call.kind === "codeTask"
          ? [call.agentFile]
          : [call.chatFile];
    const calls: Array<ModelCall> = files.flatMap(
      (relative: string): Array<ModelCall> => {
        return findModelCalls(serverFile(relative));
      },
    );

    expect(calls.length).toBeGreaterThan(0);

    const keepsErrors: boolean = calls.some((each: ModelCall): boolean => {
      return each.settings["storeErrorDetails"] !== "false";
    });
    const keepsPreviews: boolean = calls.some((each: ModelCall): boolean => {
      return each.settings["storeContentPreviews"] !== "false";
    });

    expect({ feature: info.feature, keepsErrors }).toEqual({
      feature: info.feature,
      keepsErrors: info.keepsProviderErrors,
    });
    // Never what was sent or answered, for any of them.
    expect({ feature: info.feature, keepsPreviews }).toEqual({
      feature: info.feature,
      keepsPreviews: false,
    });
  });
});

// The scan itself, on snippets: what it catches and what it lets through.
describe("F: the scan", () => {
  test("catches a Data Security file that asks a model itself, whatever it says", () => {
    const calls: Array<ModelCall> = findModelCalls(
      parse(
        "packages/Common/Server/Utils/DataSecurity/Something.ts",
        `await AIService.executeWithLogging({ projectId, feature: "Something New", storeContentPreviews: false, storeErrorDetails: false, recordContentInTelemetry: false, messages });`,
      ),
    );

    expect(calls.filter(isDataSecurityModelCall)).toHaveLength(1);
    expect(getModelCallProblems(calls[0]!)[0]).toContain("asks a model itself");
  });

  test("catches a call under a Data Security label from anywhere", () => {
    const calls: Array<ModelCall> = findModelCalls(
      parse(
        "packages/Common/Server/API/SomeAPI.ts",
        `await AIService.executeWithLogging({ projectId, feature: AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE, messages });`,
      ),
    );

    expect(calls.filter(isDataSecurityModelCall)).toHaveLength(1);
  });

  test("catches the one call keeping a preview, an error, span content, or sending messages of its own", () => {
    const calls: Array<ModelCall> = findModelCalls(
      parse(
        CALL_FILE,
        `await AIService.executeWithLogging({ projectId, feature: "Explain", storeContentPreviews: true, messages: [{ role: "user", content: finding.maskedSamples.join() }] });`,
      ),
    );

    expect(getModelCallProblems(calls[0]!)).toEqual([
      "keeps previews: say storeContentPreviews: false",
      "keeps a provider's error: say storeErrorDetails: false",
      "puts the prompt on its span: say recordContentInTelemetry: false",
      "sends messages of its own: send request.prompt.messages, a prompt DataSecurityAiInput made",
      "files the call under a label of its own: take it from DATA_SECURITY_AI_CALL_LABELS",
    ]);
  });

  test("a request it cannot read is a failure, not a pass", () => {
    const calls: Array<ModelCall> = findModelCalls(
      parse(CALL_FILE, `await AIService.executeWithLogging(request);`),
    );

    expect(getModelCallProblems(calls[0]!)).toHaveLength(1);
  });

  test("lets the one call that says it all through, and leaves other features' calls alone", () => {
    const calls: Array<ModelCall> = findModelCalls(
      parse(
        CALL_FILE,
        `await AIService.executeWithLogging({ projectId, feature: label, storeContentPreviews: false, storeErrorDetails: false, recordContentInTelemetry: false, messages: request.prompt.messages });`,
      ),
    );

    expect(getModelCallProblems(calls[0]!)).toEqual([]);
    expect(
      findModelCalls(
        parse(
          "packages/Common/Server/API/IncidentAPI.ts",
          `await AIService.executeWithLogging({ feature: "IncidentNote", messages });`,
        ),
      ).filter(isDataSecurityModelCall),
    ).toEqual([]);
  });

  test("catches a column that holds a value, however it is named", () => {
    const named: Array<string> = findNeverSentColumns(
      parse(
        `${AI_DIRECTORY}/Planted.ts`,
        [
          "const a = finding.maskedSamples;",
          "const b = { select: { sampleRecords: true } };",
          'const c = store["connectionString"];',
          "const { secrets } = connection;",
          "const d = log?.body;",
          "interface E { maskedSamples: Array<string>; }",
        ].join("\n"),
      ),
    ).map((each: NamedColumn): string => {
      return each.name;
    });

    expect(named).toEqual([
      "maskedSamples",
      "sampleRecords",
      "connectionString",
      "secrets",
      "body",
      "maskedSamples",
    ]);
  });

  test("lets the list of those columns, a column said to hold nothing, and every other name, through", () => {
    expect(
      findNeverSentColumns(
        parse(
          INPUT_FILE,
          [
            'export const NEVER_SENT_COLUMNS = { DataStoreFinding: ["maskedSamples", "sampleRecords"] };',
            "const a = finding.location;",
            "const b = { select: { dataTypeId: true, matchCount: true } };",
            "const c = { maskedSamples: [], sampleRecords: null };",
          ].join("\n"),
        ),
      ),
    ).toEqual([]);
  });

  test("a column said to hold something is caught, however little", () => {
    expect(
      findNeverSentColumns(
        parse(
          `${AI_DIRECTORY}/Planted.ts`,
          [
            'const a = { maskedSamples: ["j***@e***.com"] };',
            "const b = { sampleRecords: finding.sampleRecords };",
          ].join("\n"),
        ),
      ).map((each: NamedColumn): string => {
        return each.name;
      }),
    ).toEqual(["maskedSamples", "sampleRecords", "sampleRecords"]);
  });

  test("catches an import of what reads telemetry records", () => {
    expect(
      findRecordReaders(
        parse(
          `${AI_DIRECTORY}/Planted.ts`,
          [
            'import { findTelemetryFindingOccurrences } from "../../DataSecurity/Telemetry/TelemetryFindingOccurrences";',
            'import Log from "../../../../Models/AnalyticsModels/Log";',
            'import LogService from "../../../Services/LogService";',
            'import DataStoreService from "../../../Services/DataStoreService";',
          ].join("\n"),
        ),
      ),
    ).toHaveLength(3);
  });

  test("catches a prompt made by hand", () => {
    expect(
      findHandMadePrompts(
        parse(
          `${AI_DIRECTORY}/Planted.ts`,
          [
            "const a = { messages } as DataSecurityAiPrompt;",
            "const b = <DataSecurityAiCodeRequest>{ text };",
            "const c = { [PROMPT_MADE_HERE]: true };",
            "const d: DataSecurityAiPrompt = buildExplainIssuePrompt({ issue });",
          ].join("\n"),
        ),
      ),
    ).toHaveLength(3);
  });
});
