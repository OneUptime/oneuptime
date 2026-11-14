import AIIncidentInvestigationRunner from "../../../../Server/Utils/AI/SRE/IncidentInvestigationRunner";
import AIAlertInvestigationRunner from "../../../../Server/Utils/AI/SRE/AlertInvestigationRunner";
import AIInvestigationEngine, {
  InvestigationRequest,
} from "../../../../Server/Utils/AI/SRE/AIInvestigationEngine";
import IncidentAIContextBuilder, {
  IncidentContextData,
} from "../../../../Server/Utils/AI/IncidentAIContextBuilder";
import AlertAIContextBuilder, {
  AlertContextData,
} from "../../../../Server/Utils/AI/AlertAIContextBuilder";
import AIMemory from "../../../../Server/Utils/AI/SRE/AIMemory";
import logger from "../../../../Server/Utils/Logger";
import Alert from "../../../../Models/DatabaseModels/Alert";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../../Types/ObjectID";
import fs from "fs";
import path from "path";
import ts from "typescript";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * WHO RECORDS, AND WHO MAY SKIP THE PROJECT'S MODEL (issue #6800).
 *
 * Incident and alert investigations keep what they saw for a replay
 * (recordForReplay on the engine request). Losing the flag is a silent
 * regression: investigations keep running, and there is quietly nothing to
 * replay. Setting it anywhere else would keep the telemetry of runs no
 * replay reads (a security case's triage, a remediation).
 *
 * A transport sends the agent loop's model calls somewhere other than the
 * project's LLM provider through AIService - past the project's AI switch,
 * its limits, its bill and its AI Logs - and answers its tool calls from
 * somewhere other than the project's data. Only the AI evals, run by an
 * operator from the command line, may do that (Server/Utils/AI/Eval).
 *
 * The runners are run with their reads replaced; the rest is read from the
 * source through the TypeScript AST, with negative controls.
 */

const REPOSITORY_ROOT: string = path.resolve(__dirname, "../../../../../..");

const SCAN_ROOTS: Array<string> = [
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

const EVAL_DIRECTORY: string = "packages/Common/Server/Utils/AI/Eval/";

const SOURCE_FILE: RegExp = /\.tsx?$/;
const DECLARATION_FILE: RegExp = /\.d\.ts$/;

const projectId: ObjectID = ObjectID.generate();
const aiRunId: ObjectID = ObjectID.generate();
const incidentId: ObjectID = ObjectID.generate();
const alertId: ObjectID = ObjectID.generate();

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file).split(path.sep).join("/");
}

function listSources(target: string): Array<string> {
  const full: string = path.join(REPOSITORY_ROOT, target);

  if (!fs.existsSync(full)) {
    return [];
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

function propertyName(node: ts.Node): string | null {
  if (
    (ts.isPropertyAssignment(node) ||
      ts.isShorthandPropertyAssignment(node) ||
      ts.isMethodDeclaration(node)) &&
    (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name))
  ) {
    return node.name.text;
  }

  return null;
}

// Every object property named `name` written anywhere inside `node`.
function propertiesNamed(node: ts.Node, name: string): Array<ts.Node> {
  const found: Array<ts.Node> = [];

  const visit: (child: ts.Node) => void = (child: ts.Node): void => {
    if (propertyName(child) === name) {
      found.push(child);
    }

    ts.forEachChild(child, visit);
  };

  visit(node);

  return found;
}

// The answerQuestion calls of a source whose request names a transport.
function answerQuestionCallsWithTransport(source: ts.SourceFile): number {
  let count: number = 0;

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "answerQuestion" &&
      node.arguments[0] &&
      propertiesNamed(node.arguments[0], "transport").length > 0
    ) {
      count++;
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return count;
}

// The text of each value a `recordForReplay:` property is set to in a source.
function recordForReplayValues(source: ts.SourceFile): Array<string> {
  return propertiesNamed(source, "recordForReplay").map(
    (node: ts.Node): string => {
      return ts.isPropertyAssignment(node)
        ? node.initializer.getText(source)
        : node.getText(source);
    },
  );
}

interface ScannedSource {
  file: string;
  source: ts.SourceFile;
}

interface SourceText {
  path: string;
  text: string;
}

let sourceTexts: Array<SourceText> | null = null;

// Every source under the scan roots, read once for the whole file.
function readSources(): Array<SourceText> {
  if (!sourceTexts) {
    sourceTexts = SCAN_ROOTS.flatMap((root: string): Array<SourceText> => {
      return listSources(root).map((file: string): SourceText => {
        return { path: file, text: fs.readFileSync(file, "utf8") };
      });
    });
  }

  return sourceTexts;
}

// The sources that mention `word`, parsed (most never do, and are not).
function sourcesMentioning(word: string): Array<ScannedSource> {
  return readSources()
    .filter((source: SourceText): boolean => {
      return source.text.includes(word);
    })
    .map((source: SourceText): ScannedSource => {
      return {
        file: relative(source.path),
        source: parse(source.path, source.text),
      };
    });
}

function sentRequest(
  executeRun: SpyInstance<typeof AIInvestigationEngine.executeRun>,
): InvestigationRequest {
  return executeRun.mock.calls[0]![0].request;
}

describe("the investigation runners keep what their runs saw", () => {
  let executeRun: SpyInstance<typeof AIInvestigationEngine.executeRun>;

  beforeEach(() => {
    executeRun = jest
      .spyOn(AIInvestigationEngine, "executeRun")
      .mockResolvedValue(undefined);
    // The runners' other reads find no database here, and say so.
    jest.spyOn(logger, "error").mockImplementation((): void => {});
    jest.spyOn(logger, "warn").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("an incident investigation asks the engine to record it", async () => {
    const incident: Incident = new Incident(incidentId);
    incident.title = "Checkout 500s";
    jest
      .spyOn(IncidentAIContextBuilder, "buildIncidentContext")
      .mockResolvedValue({
        incident,
        stateTimeline: [],
        internalNotes: [],
        publicNotes: [],
        workspaceMessages: [],
      } as unknown as IncidentContextData);
    jest
      .spyOn(AIMemory, "getPriorSimilarIncidentsContext")
      .mockResolvedValue("");

    await AIIncidentInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      incidentId,
      attemptCount: 1,
    });

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).recordForReplay).toBe(true);
    expect(sentRequest(executeRun).incidentId).toEqual(incidentId);
  });

  test("an alert investigation does too", async () => {
    const alert: Alert = new Alert(alertId);
    alert.title = "Error rate above threshold";
    jest.spyOn(AlertAIContextBuilder, "buildAlertContext").mockResolvedValue({
      alert,
      stateTimeline: [],
      internalNotes: [],
    } as unknown as AlertContextData);

    await AIAlertInvestigationRunner.executeInvestigation({
      aiRunId,
      projectId,
      alertId,
      attemptCount: 1,
    });

    expect(executeRun).toHaveBeenCalledTimes(1);
    expect(sentRequest(executeRun).recordForReplay).toBe(true);
    expect(sentRequest(executeRun).alertId).toEqual(alertId);
  });
});

describe("in the source", () => {
  test("only the incident and alert investigation runners set recordForReplay, and they set it on", () => {
    const setters: Record<string, Array<string>> = {};

    for (const scanned of sourcesMentioning("recordForReplay")) {
      const values: Array<string> = recordForReplayValues(scanned.source);

      if (values.length > 0) {
        setters[scanned.file] = values;
      }
    }

    expect(setters).toEqual({
      "packages/Common/Server/Utils/AI/SRE/AlertInvestigationRunner.ts": [
        "true",
      ],
      "packages/Common/Server/Utils/AI/SRE/IncidentInvestigationRunner.ts": [
        "true",
      ],
    });
  });

  test("only the AI evals hand the agent loop a transport", () => {
    const withTransport: Array<string> = sourcesMentioning("answerQuestion")
      .filter((scanned: ScannedSource): boolean => {
        return answerQuestionCallsWithTransport(scanned.source) > 0;
      })
      .map((scanned: ScannedSource): string => {
        return scanned.file;
      });

    // The replay does: the scan finds what it looks for.
    expect(withTransport).toContain(
      "packages/Common/Server/Utils/AI/Eval/ReplayInvestigation.ts",
    );

    for (const file of withTransport) {
      expect({ file, isAnEval: file.startsWith(EVAL_DIRECTORY) }).toEqual({
        file,
        isAnEval: true,
      });
    }
  });

  test("the live callers of the loop are found, and hand it none", () => {
    const callers: Array<string> = sourcesMentioning("answerQuestion(")
      .filter((scanned: ScannedSource): boolean => {
        return !scanned.file.startsWith(EVAL_DIRECTORY);
      })
      .map((scanned: ScannedSource): string => {
        return scanned.file;
      });

    expect(callers).toEqual(
      expect.arrayContaining([
        "packages/Common/Server/API/SlackAPI.ts",
        "packages/Common/Server/Utils/AI/SRE/AIInvestigationEngine.ts",
        "packages/Common/Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeams.ts",
      ]),
    );
  });

  test("negative controls: the scans see a transport and a recordForReplay however they are written, and nothing else", () => {
    const snippet: ts.SourceFile = parse(
      "snippet.ts",
      [
        "ObservabilityAssistant.answerQuestion({ projectId, transport: fake });",
        "ObservabilityAssistant.answerQuestion({ projectId, ...(isEval ? { transport } : {}) });",
        "ObservabilityAssistant.answerQuestion({ projectId, feature: 'Slack' });",
        "other.answer({ transport: fake });",
        "const request = { recordForReplay: true, recordForReplayLater: false };",
        "const again = { 'recordForReplay': isOn };",
        "if (request.recordForReplay === true) {}",
      ].join("\n"),
    );

    expect(answerQuestionCallsWithTransport(snippet)).toBe(2);
    expect(recordForReplayValues(snippet)).toEqual(["true", "isOn"]);
  });
});
