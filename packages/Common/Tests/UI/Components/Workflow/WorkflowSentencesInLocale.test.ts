// ArgumentsForm's Utils.ts imports the database-model registry, unused here.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import {
  LintGraphNode,
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
  lintWorkflowGraph,
} from "../../../../UI/Components/Workflow/GraphLint";
import {
  WORKFLOW_ISSUE_GRAPH_GROUP_TITLE,
  WorkflowIssueGroup,
  getWorkflowLintCountText,
  groupWorkflowLintIssues,
} from "../../../../UI/Components/Workflow/GraphLintSummary";
import { validateTypedValue } from "../../../../UI/Components/Workflow/ArgumentsForm";
import {
  ModelColumnEditorMode,
  classifyColumnValueCompatibility,
} from "../../../../UI/Components/Workflow/ModelColumnEditor";
import { ModelSchemaColumn } from "../../../../UI/Components/Workflow/ModelSchema";
import { columnTypeLabel } from "../../../../UI/Components/Workflow/ColumnEditor/ColumnControl";
import {
  ConditionNote,
  getConditionNotes,
  readConditionState,
} from "../../../../UI/Components/Workflow/Condition/ConditionModel";
import { getStepCountLabel } from "../../../../UI/Components/Workflow/ComponentPicker/PickerItems";
import {
  RUN_FAILED_MESSAGES,
  RUN_GOING_MESSAGES,
  decideRunWatch,
} from "../../../../UI/Components/Workflow/RunStatusWatcher";
import IconProp from "../../../../Types/Icon/IconProp";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import { JSONObject } from "../../../../Types/JSON";
import {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeType,
} from "../../../../Types/Workflow/Component";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import i18next from "i18next";
import { beforeAll, beforeEach, describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The workflow builder's sentences that are built outside React - the
 * checks' messages, the lint counts, the If / Else notes, a column's type,
 * a typed value's error - come from the global i18next instance the
 * Dashboard sets up (its Utils/i18n.ts). Here it is set up in German, and in
 * Russian for the plural forms.
 */

const GERMAN: Record<string, string> = {
  "This workflow has no trigger, so it can never start. Add a trigger and connect it to the first step.":
    "Dieser Workflow hat keinen Auslöser und kann nie starten. Fügen Sie einen Auslöser hinzu und verbinden Sie ihn mit dem ersten Schritt.",
  '"{{argument}}" is required but empty.':
    "„{{argument}}“ ist erforderlich, aber leer.",
  Message: "Nachricht",
  "{{count}} errors": "{{count}} Fehler",
  "{{count}} errors_one": "{{count}} Fehler",
  "{{count}} warnings": "{{count}} Warnungen",
  "{{count}} warnings_one": "{{count}} Warnung",
  "Email is not valid.": "Die E-Mail-Adresse ist ungültig.",
  "URL is not valid.": "Die URL ist ungültig.",
  Number: "Zahl",
  "Date and time": "Datum und Uhrzeit",
  '"{{key}}" isn\'t a known column on this model.':
    "„{{key}}“ ist keine bekannte Spalte dieses Modells.",
  '"{{key}}" holds a list. Use the "is any of" operator instead, or keep editing as JSON.':
    "„{{key}}“ enthält eine Liste. Verwenden Sie „ist eines von“ oder bearbeiten Sie weiter als JSON.",
  "Value to check": "Zu prüfender Wert",
  "Compare with": "Vergleichswert",
  "Compare as": "Vergleichen als",
  Undefined: "Undefiniert",
  "{{side}} and {{otherSide}} are compared as {{type}}, which ignores what they hold. This step no longer offers that: choose how to compare under {{compareAs}}, or choose is empty to check for a missing value.":
    "{{side}} und {{otherSide}} werden als {{type}} verglichen, was ihren Inhalt ignoriert. Wählen Sie unter {{compareAs}}, wie verglichen wird.",
  'Compared as text, letter by letter: "10" comes before "9". That suits dates written 2026-10-01. For numbers, choose Number under {{compareAs}}.':
    "Als Text verglichen, Zeichen für Zeichen: „10“ kommt vor „9“. Für Zahlen wählen Sie unter {{compareAs}} „Zahl“.",
  "{{count}} triggers": "{{count}} Auslöser",
  "{{count}} triggers_one": "{{count}} Auslöser",
  "{{count}} actions": "{{count}} Aktionen",
  "{{count}} actions_one": "{{count}} Aktion",
};

const RUSSIAN: Record<string, string> = {
  "{{count}} errors": "Ошибок: {{count}}",
  "{{count}} errors_one": "{{count}} ошибка",
  "{{count}} warnings": "Предупреждений: {{count}}",
  "{{count}} warnings_one": "{{count}} предупреждение",
  "{{count}} actions": "Действий: {{count}}",
  "{{count}} actions_one": "{{count}} действие",
};

beforeAll(async () => {
  await i18next.init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: { translation: GERMAN },
      ru: { translation: RUSSIAN },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

type MakeNodeFunction = (params: {
  nodeId: string;
  componentId: string;
  componentType: ComponentType;
  args?: Array<Argument> | undefined;
}) => LintGraphNode;

const makeNode: MakeNodeFunction = (params: {
  nodeId: string;
  componentId: string;
  componentType: ComponentType;
  args?: Array<Argument> | undefined;
}): LintGraphNode => {
  return {
    id: params.nodeId,
    data: {
      error: "",
      id: params.componentId,
      nodeType: NodeType.Node,
      metadata: {
        id: `${params.componentId}-metadata`,
        title: params.componentId,
        category: "Test",
        description: "A test component",
        iconProp: IconProp.Bolt,
        componentType: params.componentType,
        arguments: params.args || [],
        returnValues: [],
        inPorts: [],
        outPorts: [],
      },
      metadataId: `${params.componentId}-metadata`,
      internalId: `${params.nodeId}-internal`,
      arguments: {},
      returnValues: {},
      componentType: params.componentType,
    },
  };
};

const REQUIRED_MESSAGE: Argument = {
  id: "message",
  name: "Message",
  description: "Text to send",
  type: ComponentInputType.Text,
  required: true,
};

type MessageOfFunction = (
  result: WorkflowLintResult,
  rule: WorkflowLintRule,
) => string | undefined;

const messageOf: MessageOfFunction = (
  result: WorkflowLintResult,
  rule: WorkflowLintRule,
): string | undefined => {
  return result.issues.find((issue: WorkflowLintIssue) => {
    return issue.rule === rule;
  })?.message;
};

describe("the checks' messages", () => {
  test("a whole sentence in the reader's language", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeNode({
          nodeId: "n1",
          componentId: "log-1",
          componentType: ComponentType.Component,
        }),
      ],
      edges: [],
    });

    expect(messageOf(result, WorkflowLintRule.NoTrigger)).toBe(
      "Dieser Workflow hat keinen Auslöser und kann nie starten. Fügen Sie einen Auslöser hinzu und verbinden Sie ihn mit dem ersten Schritt.",
    );
  });

  test("the setting's name goes into the sentence in the same language", () => {
    const result: WorkflowLintResult = lintWorkflowGraph({
      nodes: [
        makeNode({
          nodeId: "n1",
          componentId: "manual-1",
          componentType: ComponentType.Trigger,
        }),
        makeNode({
          nodeId: "n2",
          componentId: "log-1",
          componentType: ComponentType.Component,
          args: [REQUIRED_MESSAGE],
        }),
      ],
      edges: [{ source: "n1", target: "n2" }],
    });

    expect(messageOf(result, WorkflowLintRule.MissingRequiredArgument)).toBe(
      "„Nachricht“ ist erforderlich, aber leer.",
    );
  });

  test("an issue about the whole graph is grouped under a key the panel translates", () => {
    const groups: Array<WorkflowIssueGroup> = groupWorkflowLintIssues({
      issues: [
        {
          rule: WorkflowLintRule.NoTrigger,
          severity: WorkflowLintSeverity.Error,
          nodeId: null,
          componentId: null,
          argumentId: null,
          message: "Dieser Workflow hat keinen Auslöser.",
        },
      ],
    });

    // English until drawn: WorkflowIssuesModal looks the title up.
    expect(groups[0]?.title).toBe(WORKFLOW_ISSUE_GRAPH_GROUP_TITLE);
    expect(WORKFLOW_ISSUE_GRAPH_GROUP_TITLE).toBe("This workflow");
  });
});

describe("the lint counts", () => {
  const counts: (errorCount: number, warningCount: number) => string = (
    errorCount: number,
    warningCount: number,
  ): string => {
    return getWorkflowLintCountText({
      errorCount: errorCount,
      warningCount: warningCount,
    });
  };

  test("each kind in the language's form for its count", () => {
    expect(counts(1, 0)).toBe("1 Fehler");
    expect(counts(2, 1)).toBe("2 Fehler, 1 Warnung");
    expect(counts(0, 3)).toBe("3 Warnungen");
    expect(counts(0, 0)).toBe("");
  });

  test("21 takes the 'one' form in Russian; 2 and 5 the general one", async () => {
    await i18next.changeLanguage("ru");

    expect(counts(21, 5)).toBe("21 ошибка, Предупреждений: 5");
    expect(counts(2, 1)).toBe("Ошибок: 2, 1 предупреждение");
  });

  test("the picker counts its steps the same way", async () => {
    expect(getStepCountLabel(1, ComponentType.Component)).toBe("1 Aktion");
    expect(getStepCountLabel(4, ComponentType.Component)).toBe("4 Aktionen");
    expect(getStepCountLabel(2, ComponentType.Trigger)).toBe("2 Auslöser");

    await i18next.changeLanguage("ru");

    expect(getStepCountLabel(31, ComponentType.Component)).toBe("31 действие");
  });
});

describe("what a setting says about its value", () => {
  test("a typed address or link that is not valid", () => {
    expect(validateTypedValue(ComponentInputType.Email, "not an address")).toBe(
      "Die E-Mail-Adresse ist ungültig.",
    );
    // A value with a reference in it is not known until the step runs.
    expect(
      validateTypedValue(
        ComponentInputType.Email,
        "{{local.variables.ADDRESS}}",
      ),
    ).toBeNull();
  });

  test("a column's type, in the reader's language", () => {
    const column: (type: string) => ModelSchemaColumn = (
      type: string,
    ): ModelSchemaColumn => {
      return { id: "c", title: "C", type: type, isRelation: false };
    };

    expect(columnTypeLabel(column(TableColumnType.Number))).toBe("Zahl");
    expect(columnTypeLabel(column(TableColumnType.Date))).toBe(
      "Datum und Uhrzeit",
    );
  });

  test("why the rows can't show a value, and whether that locks the editor", () => {
    const columns: Array<ModelSchemaColumn> = [
      { id: "name", title: "Name", type: "ShortText", isRelation: false },
    ];

    // An unknown column is worth saying, but only as a warning.
    const unknown: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { nmae: "x" },
        columns,
        ModelColumnEditorMode.Query,
      );

    expect(unknown.reasons).toEqual([
      "„nmae“ ist keine bekannte Spalte dieses Modells.",
    ]);
    expect(unknown.compatible).toBe(true);

    // A list locks it, however the reason is worded.
    const list: { compatible: boolean; reasons: Array<string> } =
      classifyColumnValueCompatibility(
        { name: ["a", "b"] },
        columns,
        ModelColumnEditorMode.Query,
      );

    expect(list.reasons).toEqual([
      "„name“ enthält eine Liste. Verwenden Sie „ist eines von“ oder bearbeiten Sie weiter als JSON.",
    ]);
    expect(list.compatible).toBe(false);
  });
});

describe("the If / Else notes", () => {
  const notes: (args: JSONObject) => Array<string> = (
    args: JSONObject,
  ): Array<string> => {
    return getConditionNotes(readConditionState(args)).map(
      (note: ConditionNote) => {
        return note.text;
      },
    );
  };

  test("both settings compared as a type the step no longer offers", () => {
    expect(
      notes({
        "input-1-type": "undefined",
        "input-1": "{{local.variables.ENV}}",
        operator: "==",
        "input-2-type": "undefined",
        "input-2": "production",
      }),
    ).toEqual([
      "Zu prüfender Wert und Vergleichswert werden als Undefiniert verglichen, was ihren Inhalt ignoriert. Wählen Sie unter Vergleichen als, wie verglichen wird.",
    ]);
  });

  test("an order comparison of text, with the setting named in the sentence", () => {
    expect(
      notes({
        "input-1-type": "text",
        "input-1": "{{local.variables.VERSION}}",
        operator: ">",
        "input-2-type": "text",
        "input-2": "10",
      }),
    ).toEqual([
      "Als Text verglichen, Zeichen für Zeichen: „10“ kommt vor „9“. Für Zahlen wählen Sie unter Vergleichen als „Zahl“.",
    ]);
  });

  test("the notes' ids stay English, whatever the language", () => {
    const ids: Array<string> = getConditionNotes(
      readConditionState({
        "input-1-type": "number",
        "input-1": "{{local.variables.STATUS}}",
        operator: ">=",
        "input-2-type": "number",
        "input-2": "abc",
      }),
    ).map((note: ConditionNote) => {
      return note.id;
    });

    expect(ids).toEqual(["not-a-number-Compare with"]);
  });
});

describe("the run strip's sentences", () => {
  /*
   * They stay English until the builder draws them (translateText), so each
   * must be a key in the Dashboard's en.json - or it is never translated.
   */
  const EN: Record<string, string> = JSON.parse(
    fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "Dashboard",
        "src",
        "Locales",
        "en.json",
      ),
      "utf8",
    ),
  );

  test("every sentence the watcher can say is in en.json", () => {
    const said: Array<string> = [
      ...Object.values(WorkflowStatus).map((status: WorkflowStatus) => {
        return (
          decideRunWatch({
            run: { runId: "a", status: status },
            pollCount: 0,
          }).message || ""
        );
      }),
      decideRunWatch({ run: null, pollCount: 0 }).message || "",
      decideRunWatch({ run: null, pollCount: 1000 }).message || "",
    ];

    for (const sentence of said) {
      expect(EN[sentence]).toBe(sentence);
    }

    expect(Object.keys(RUN_FAILED_MESSAGES).length).toBe(3);
    expect(RUN_GOING_MESSAGES[WorkflowStatus.Scheduled]).toBe("Run scheduled…");
  });
});
