import * as AIServiceModule from "../../../../../Server/Services/AIService";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * NO DATA SECURITY FEATURE KEEPS WHAT IT SENDS OR GETS IN THE AI LOGS (#10361).
 *
 * The AI Logs (LlmLog) are read by every Project Owner, Admin, Member and
 * Viewer; Data Security's records only by Project Owners, Admins and the
 * Security roles. executeWithLogging keeps the first 5,000 characters of a
 * prompt and 2,000 of an answer in a row of them unless the call says
 * storeContentPreviews: false, and a provider's error - which can quote the
 * prompt - unless it says storeErrorDetails: false. Explain with AI said
 * neither, so the AI Logs named the bucket that holds card numbers, its
 * cloud id and the evidence that it is public.
 *
 * So every call to AIService.executeWithLogging of a Data Security feature
 * - one whose feature is a Data Security label (AI_DATA_SECURITY_*), or that
 * is made from Data Security's own code - says both, in the object it hands
 * the call, read through the TypeScript AST. A call whose request the scan
 * cannot read is a failure too: write the object at the call. Every
 * AI_DATA_SECURITY_* label is the feature of one such call, so a new one is
 * held to this from its first call. #10365 widens what a Data Security
 * feature may send at all.
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

interface DataSecurityAiCall {
  file: string;
  line: number;
  // The feature it names, as written.
  feature: string;
  // Each setting that keeps content out, as the object writes it, or null.
  storeContentPreviews: string | null;
  storeErrorDetails: string | null;
  // Whether the request is an object written at the call.
  isReadable: boolean;
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
      entry.name.endsWith(".ts") &&
      !entry.name.endsWith(".d.ts") &&
      !entry.name.endsWith(".test.ts")
    ) {
      found.push(full);
    }
  }

  return found;
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

// Every executeWithLogging call of a Data Security feature in `text`.
function findDataSecurityAiCalls(
  file: string,
  text: string,
): Array<DataSecurityAiCall> {
  const source: ts.SourceFile = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
  );
  const isDataSecurityFile: boolean = DATA_SECURITY_FILE.test(file);
  const calls: Array<DataSecurityAiCall> = [];

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      node.expression.name.text === "executeWithLogging"
    ) {
      const argument: ts.Expression | undefined = node.arguments[0];
      const request: ts.ObjectLiteralExpression | null =
        argument && ts.isObjectLiteralExpression(argument) ? argument : null;
      const feature: string = request
        ? propertyText(request, "feature", source) || ""
        : argument?.getText(source) || "";

      if (isDataSecurityFile || DATA_SECURITY_LABEL.test(feature)) {
        calls.push({
          file,
          line:
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1,
          feature,
          storeContentPreviews: request
            ? propertyText(request, "storeContentPreviews", source)
            : null,
          storeErrorDetails: request
            ? propertyText(request, "storeErrorDetails", source)
            : null,
          isReadable: Boolean(request),
        });
      }
    }

    ts.forEachChild(node, visit);
  };

  visit(source);

  return calls;
}

// What is wrong with a call, or nothing.
function getProblems(call: DataSecurityAiCall): Array<string> {
  if (!call.isReadable) {
    return [
      "its request is not an object written at the call, so what it keeps cannot be read",
    ];
  }

  const problems: Array<string> = [];

  if (call.storeContentPreviews !== "false") {
    problems.push("keeps previews: say storeContentPreviews: false");
  }

  if (call.storeErrorDetails !== "false") {
    problems.push("keeps a provider's error: say storeErrorDetails: false");
  }

  return problems;
}

const SERVER_FILES: Array<string> = SCAN_ROOTS.flatMap(
  (root: string): Array<string> => {
    return listSourceFiles(path.join(REPOSITORY_ROOT, root));
  },
);

const CALLS: Array<DataSecurityAiCall> = SERVER_FILES.flatMap(
  (file: string): Array<DataSecurityAiCall> => {
    const relative: string = path
      .relative(REPOSITORY_ROOT, file)
      .split(path.sep)
      .join("/");
    const text: string = fs.readFileSync(file, "utf8");

    return text.includes("executeWithLogging")
      ? findDataSecurityAiCalls(relative, text)
      : [];
  },
);

describe("Data Security's calls to OneUptime AI keep nothing in the AI Logs", () => {
  test("the scan finds Explain with AI and the field suggestions", () => {
    expect(
      CALLS.map((call: DataSecurityAiCall): string => {
        return call.feature;
      }).sort(),
    ).toEqual(
      expect.arrayContaining([
        "AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE",
        "AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE",
      ]),
    );
  });

  test.each(
    CALLS.map((call: DataSecurityAiCall): [string, DataSecurityAiCall] => {
      return [`${call.file}:${call.line} (${call.feature})`, call];
    }),
  )(
    "%s keeps no preview and no provider error",
    (_where: string, call: DataSecurityAiCall) => {
      expect({
        call: `${call.file}:${call.line}`,
        problems: getProblems(call),
      }).toEqual({ call: `${call.file}:${call.line}`, problems: [] });
    },
  );

  test("every Data Security label is the feature of a call the scan holds to this", () => {
    const labels: Array<string> = Object.keys(AIServiceModule).filter(
      (name: string): boolean => {
        return DATA_SECURITY_LABEL.test(name);
      },
    );
    const used: Set<string> = new Set(
      CALLS.map((call: DataSecurityAiCall): string => {
        return call.feature;
      }),
    );

    expect(labels.length).toBeGreaterThanOrEqual(2);
    expect(
      labels.filter((label: string): boolean => {
        return !used.has(label);
      }),
    ).toEqual([]);
  });

  test("the label Explain with AI writes keeps the value its AI Logs rows were written with", () => {
    expect(AIServiceModule.AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE).toBe(
      "DataSecurityIssueExplanation",
    );
  });
});

// The scan itself, on snippets: what it catches and what it lets through.
describe("the scan", () => {
  test("catches a Data Security feature's call that keeps previews or errors", () => {
    const calls: Array<DataSecurityAiCall> = findDataSecurityAiCalls(
      "packages/Common/Server/API/SomeAPI.ts",
      `await AIService.executeWithLogging({
        projectId,
        feature: AI_DATA_SECURITY_ISSUE_EXPLANATION_FEATURE,
        messages,
      });`,
    );

    expect(calls).toHaveLength(1);
    expect(getProblems(calls[0]!)).toEqual([
      "keeps previews: say storeContentPreviews: false",
      "keeps a provider's error: say storeErrorDetails: false",
    ]);
  });

  test("catches any call from Data Security's own code, whatever its label", () => {
    const calls: Array<DataSecurityAiCall> = findDataSecurityAiCalls(
      "packages/Common/Server/Utils/DataSecurity/Something.ts",
      `await AIService.executeWithLogging({ projectId, feature: "Something New", storeContentPreviews: true, storeErrorDetails: false, messages });`,
    );

    expect(getProblems(calls[0]!)).toEqual([
      "keeps previews: say storeContentPreviews: false",
    ]);
  });

  test("a request it cannot read is a failure, not a pass", () => {
    const calls: Array<DataSecurityAiCall> = findDataSecurityAiCalls(
      "packages/Common/Server/API/DataSecurityAPI.ts",
      `await AIService.executeWithLogging(request);`,
    );

    expect(getProblems(calls[0]!)).toHaveLength(1);
  });

  test("lets a call that says both through, and leaves other features' calls alone", () => {
    expect(
      getProblems(
        findDataSecurityAiCalls(
          "packages/Common/Server/API/SomeAPI.ts",
          `await AIService.executeWithLogging({ feature: AI_DATA_SECURITY_FIELD_SUGGESTION_FEATURE, storeContentPreviews: false, storeErrorDetails: false, messages });`,
        )[0]!,
      ),
    ).toEqual([]);
    expect(
      findDataSecurityAiCalls(
        "packages/Common/Server/API/IncidentAPI.ts",
        `await AIService.executeWithLogging({ feature: "IncidentNote", messages });`,
      ),
    ).toEqual([]);
  });
});
