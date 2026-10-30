import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import ts from "typescript";
import AllModelTypes from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import PrivateRecordParts from "../../../Types/PrivateRecord/PrivateRecordParts";

/*
 * EVERY DASHBOARD GATE ON A PRIVATE RECORD'S CHANGE ASKS WITH ITS SCOPE.
 *
 * A private incident, alert or episode is changed only with the permissions
 * of the teams that own it (block 33). Its view layouts provide what the
 * reader holds on it (PrivateRecordScopeProvider), and a gate that asks
 * about the record or a part of it - a note, an owner, a state change, a
 * role, a link, a member, a call - must ask with that
 * (usePrivateRecordGateOptions / usePrivateRecordGate), or the page offers
 * a change the server refuses. Read from source through the TypeScript
 * syntax tree:
 *
 *   1. the four view layouts wrap their pages in the provider;
 *   2. every PermissionGate check of a change of a part of a private kind,
 *      named by `new Model()`, passes options from the private record scope
 *      - or its file is listed below with why it needs none (a list's bulk
 *      action, a create page: no record's page, and the server holds each
 *      record to the rule);
 *   3. the shared cards and tables ask with the scope of the model they
 *      draw.
 *
 * Creating a new incident, alert or episode changes no private record and
 * is not asked about here; neither is a read, which is asked of the whole
 * snapshot.
 */

// packages/Common/Tests/App/Dashboard -> the repository root.
const REPOSITORY_ROOT: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "..",
);

const DASHBOARD: string = "packages/App/FeatureSet/Dashboard/src";

const LAYOUTS: Record<string, { model: string; ownerTeam: string }> = {
  "Pages/Incidents/View/Layout.tsx": {
    model: "Incident",
    ownerTeam: "IncidentOwnerTeam",
  },
  "Pages/Alerts/View/Layout.tsx": {
    model: "Alert",
    ownerTeam: "AlertOwnerTeam",
  },
  "Pages/Incidents/EpisodeView/Layout.tsx": {
    model: "IncidentEpisode",
    ownerTeam: "IncidentEpisodeOwnerTeam",
  },
  "Pages/Alerts/EpisodeView/Layout.tsx": {
    model: "AlertEpisode",
    ownerTeam: "AlertEpisodeOwnerTeam",
  },
};

/*
 * Files whose gates on a part of a private kind ask without the scope, and
 * why. The list only shrinks: an entry whose file no longer asks so fails.
 */
const ASKED_WITHOUT_THE_SCOPE: Record<string, string> = {
  "Components/Alert/BulkIncidentLinkActions.tsx":
    "The alerts list's bulk link: no record's page; the server refuses each private alert its owners' teams may not link.",
  "Components/Incident/AcknowledgeAlertsOnDeclare.ts":
    "The create-incident page acknowledging the alerts it declares from: no record's page; the server holds each alert to the rule.",
  "Components/Postmortem/BulkPostmortemStatusAction.tsx":
    "The postmortems list's bulk status change: no record's page; the server holds each incident to the rule.",
  "Components/Postmortem/PostmortemsTable.tsx":
    "The postmortems list's row status change: no record's page; the server holds each incident to the rule.",
  "Components/Alert/DeclareIncidentFromAlert.ts":
    "Takes its link's options from the alert header that calls it (ChangeAlertState hands it the alert's private record options).",
};

// The PermissionGate calls that decide whether a change is offered.
const GATES: Record<string, { model: number; action: number | null }> = {
  check: { model: 0, action: 1 },
  snapshotAllows: { model: 0, action: 1 },
  gateCardButton: { model: 1, action: 2 },
  checkFormUpdate: { model: 0, action: null },
  checkColumnUpdate: { model: 0, action: null },
};

// The options a gate takes from the private record scope.
const FROM_THE_SCOPE: RegExp = /privateRecord/;

const PRIVATE_KINDS: ReadonlySet<string> = new Set<string>([
  "Incident",
  "Alert",
  "IncidentEpisode",
  "AlertEpisode",
]);

// Each model class's name, and the kinds of private record it is a part of.
const KINDS_OF_MODEL: Map<string, Array<string>> = new Map(
  (AllModelTypes as Array<{ new (): BaseModel; name: string }>).map(
    (modelType: { new (): BaseModel; name: string }) => {
      return [modelType.name, PrivateRecordParts.getKindsOf(new modelType())];
    },
  ),
);

function read(relativePath: string): string {
  return fs.readFileSync(
    path.join(REPOSITORY_ROOT, DASHBOARD, relativePath),
    "utf8",
  );
}

function listSourceFiles(directory: string): Array<string> {
  const found: Array<string> = [];

  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full: string = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      if (entry.name !== "node_modules" && entry.name !== "Tests") {
        found.push(...listSourceFiles(full));
      }
      continue;
    }

    if (
      (entry.name.endsWith(".ts") || entry.name.endsWith(".tsx")) &&
      !entry.name.endsWith(".d.ts")
    ) {
      found.push(full);
    }
  }

  return found;
}

function parse(file: string, text: string): ts.SourceFile {
  return ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
}

function visit(node: ts.Node, onNode: (node: ts.Node) => void): void {
  onNode(node);
  ts.forEachChild(node, (child: ts.Node) => {
    visit(child, onNode);
  });
}

interface Gate {
  file: string;
  line: number;
  method: string;
  model: string;
  action: string;
  asksWithTheScope: boolean;
}

// Every PermissionGate call naming its model with `new Model()`.
function gatesIn(file: string, text: string): Array<Gate> {
  const sourceFile: ts.SourceFile = parse(file, text);
  const gates: Array<Gate> = [];

  visit(sourceFile, (node: ts.Node): void => {
    if (
      !ts.isCallExpression(node) ||
      !ts.isPropertyAccessExpression(node.expression) ||
      !ts.isIdentifier(node.expression.expression) ||
      node.expression.expression.text !== "PermissionGate"
    ) {
      return;
    }

    const method: string = node.expression.name.text;
    const shape: { model: number; action: number | null } | undefined =
      GATES[method];

    if (!shape) {
      return;
    }

    const modelArgument: ts.Expression | undefined =
      node.arguments[shape.model];

    if (
      !modelArgument ||
      !ts.isNewExpression(modelArgument) ||
      !ts.isIdentifier(modelArgument.expression)
    ) {
      return;
    }

    const actionArgument: ts.Expression | undefined =
      shape.action === null ? undefined : node.arguments[shape.action];
    const action: string = actionArgument
      ? actionArgument.getText(sourceFile).replace("ModelAction.", "")
      : "Update";
    const optionsText: string = node.arguments
      .slice(shape.action === null ? shape.model + 1 : shape.action + 1)
      .map((argument: ts.Expression): string => {
        return argument.getText(sourceFile);
      })
      .join(" ");

    gates.push({
      file: file,
      line:
        sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile))
          .line + 1,
      method: method,
      model: modelArgument.expression.text,
      action: action,
      asksWithTheScope: FROM_THE_SCOPE.test(optionsText),
    });
  });

  return gates;
}

const DASHBOARD_FILES: Array<string> = listSourceFiles(
  path.join(REPOSITORY_ROOT, DASHBOARD),
);

const GATES_ON_PRIVATE_PARTS: Array<Gate> = DASHBOARD_FILES.flatMap(
  (file: string): Array<Gate> => {
    const text: string = fs.readFileSync(file, "utf8");

    if (!text.includes("PermissionGate.")) {
      return [];
    }

    return gatesIn(
      path.relative(path.join(REPOSITORY_ROOT, DASHBOARD), file),
      text,
    );
  },
).filter((gate: Gate): boolean => {
  const kinds: Array<string> = KINDS_OF_MODEL.get(gate.model) || [];

  if (kinds.length === 0 || gate.action === "Read") {
    return false;
  }

  // A new incident, alert or episode is no change of a private one.
  return !(PRIVATE_KINDS.has(gate.model) && gate.action === "Create");
});

describe("a private record's view layouts", () => {
  test.each(Object.entries(LAYOUTS))(
    "%s wraps its pages in the private record scope",
    (layout: string, record: { model: string; ownerTeam: string }) => {
      const code: string = read(layout).replace(/\s+/g, "");

      expect(code).toContain(
        `<PrivateRecordScopeProvidermodelType={${record.model}}modelId={modelId}ownerTeamModelType={${record.ownerTeam}}`,
      );
      expect(code).toContain("<Outlet/></PrivateRecordScopeProvider>");
    },
  );
});

describe("every gate on a change of a private record or a part of one", () => {
  test("the sweep finds the record's own gates", () => {
    const files: Array<string> = GATES_ON_PRIVATE_PARTS.map(
      (gate: Gate): string => {
        return gate.file;
      },
    );

    // The state buttons, roles, links and calls, at least.
    expect(files).toEqual(
      expect.arrayContaining([
        "Components/Incident/ChangeState.tsx",
        "Components/Alert/ChangeState.tsx",
        "Components/IncidentEpisode/ChangeState.tsx",
        "Components/AlertEpisode/ChangeState.tsx",
        "Components/Incident/IncidentMemberRoleAssignment.tsx",
        "Pages/Incidents/View/Alerts.tsx",
        "Pages/Alerts/View/Incidents.tsx",
        "Components/AI/CallSummary/CallSummarySection.tsx",
      ]),
    );
  });

  test("asks with the private record scope, or its file says why not", () => {
    const unasked: Array<string> = GATES_ON_PRIVATE_PARTS.filter(
      (gate: Gate): boolean => {
        return !gate.asksWithTheScope && !ASKED_WITHOUT_THE_SCOPE[gate.file];
      },
    ).map((gate: Gate): string => {
      return `${gate.file}:${gate.line} PermissionGate.${gate.method}(new ${gate.model}(), ${gate.action})`;
    });

    expect(unasked).toEqual([]);
  });

  test("the files listed as asking without the scope still ask so, and say why", () => {
    for (const [file, reason] of Object.entries(ASKED_WITHOUT_THE_SCOPE)) {
      expect([
        file,
        GATES_ON_PRIVATE_PARTS.some((gate: Gate): boolean => {
          return gate.file === file && !gate.asksWithTheScope;
        }),
      ]).toEqual([file, true]);
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});

describe("the shared cards and tables", () => {
  const SHARED: Array<string> = [
    "packages/Common/UI/Components/ModelDetail/CardModelDetail.tsx",
    "packages/Common/UI/Components/ModelTable/BaseModelTable.tsx",
    "packages/Common/UI/Components/ModelTable/ModelTable.tsx",
    "packages/Common/UI/Components/ModelDelete/ModelDelete.tsx",
    "packages/Common/UI/Components/ModelList/ModelList.tsx",
    "packages/Common/UI/Components/StatusTimeline/ModelStatusTimeline.tsx",
    "packages/Common/UI/Components/CustomFields/CustomFieldsDetail.tsx",
  ];

  test.each(SHARED)(
    "%s asks with the scope of the model it draws",
    (file: string) => {
      const code: string = fs
        .readFileSync(path.join(REPOSITORY_ROOT, file), "utf8")
        .replace(/\s+/g, " ");

      expect(code).toContain("usePrivateRecordGateOptions(");
      expect(code).toContain('from "../../Utils/PrivateRecordScope"');
    },
  );
});
