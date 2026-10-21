// Utils.ts imports the database-model registry, which nothing here needs.
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

import {
  WorkflowLintIssue,
  WorkflowLintResult,
  WorkflowLintRule,
  WorkflowLintSeverity,
} from "../../../../UI/Components/Workflow/GraphLint";
import WorkflowIssuesModal from "../../../../UI/Components/Workflow/WorkflowIssuesModal";
import WorkflowStatusBar, {
  WorkflowSaveState,
} from "../../../../UI/Components/Workflow/WorkflowStatusBar";
import ManualTriggerPanel, {
  EXECUTE_WORKFLOW_COMPONENT_TITLE,
} from "../../../../UI/Components/Workflow/ManualTriggerPanel";
import ComponentReturnValueViewer from "../../../../UI/Components/Workflow/ComponentReturnValueViewer";
import ComponentPortViewer from "../../../../UI/Components/Workflow/ComponentPortViewer";
import ConditionEditor from "../../../../UI/Components/Workflow/Condition/ConditionEditor";
import ColumnValueInput from "../../../../UI/Components/Workflow/ColumnEditor/ColumnValueInput";
import ModelRecordForm from "../../../../UI/Components/Workflow/ColumnEditor/ModelRecordForm";
import {
  ColumnValueMode,
  ModelColumnControl,
} from "../../../../UI/Components/Workflow/ColumnEditor/ColumnRow";
import { ColumnUse } from "../../../../UI/Components/Workflow/ColumnEditor/ColumnUse";
import { ModelSchemaColumn } from "../../../../UI/Components/Workflow/ModelSchema";
import {
  DictionaryFilterOperator,
  getOperatorOption,
} from "../../../../UI/Components/Dictionary/DictionaryFilterOperator";
import {
  RUN_FAILED_MESSAGES,
  RUN_STARTING_MESSAGE,
  decideRunWatch,
} from "../../../../UI/Components/Workflow/RunStatusWatcher";
import { ComponentInputType } from "../../../../Types/Workflow/Component";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import WorkflowStatus from "../../../../Types/Workflow/WorkflowStatus";
import { JSONObject } from "../../../../Types/JSON";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React from "react";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  test,
} from "@jest/globals";

/*
 * The workflow builder in the reader's language. Each locale below is keyed
 * by the English text, exactly as the Dashboard's locale files are, and set
 * up on the global i18next instance the Dashboard uses: the components read
 * it through react-i18next, and the sentences built outside React (the lint
 * counts, the condition's notes, a column's type) through the global helpers.
 *
 * German has the sentences; Russian shows that the count picks the plural
 * form (21 takes the "one" form there); French has a few words but none of
 * the sentences, so every sentence stays wholly English - the words with it.
 */

const GERMAN: Record<string, string> = {
  // The issues panel
  "Problems with this workflow": "Probleme mit diesem Workflow",
  "{{count}} errors": "{{count}} Fehler",
  "{{count}} errors_one": "{{count}} Fehler",
  "{{count}} warnings": "{{count}} Warnungen",
  "{{count}} warnings_one": "{{count}} Warnung",
  "across {{count}} places": "an {{count}} Stellen",
  "across {{count}} places_one": "an {{count}} Stelle",
  "Open settings for {{step}}": "Einstellungen für {{step}} öffnen",
  "Open step": "Schritt öffnen",
  Error: "Fehler",
  Warning: "Warnung",
  "This workflow": "Dieser Workflow",
  "Nothing to fix here": "Hier gibt es nichts zu beheben",
  "The checks found nothing wrong with this workflow.":
    "Die Prüfungen haben an diesem Workflow nichts gefunden.",
  // The status bar
  Saved: "Gespeichert",
  "Run error. Open the run log to see why.":
    "Ausführung fehlgeschlagen. Das Protokoll sagt, warum.",
  "Starting run…": "Ausführung startet…",
  "{{status}} Open the run log.": "{{status}} Protokoll öffnen.",
  "See this run's log": "Protokoll dieser Ausführung ansehen",
  "{{counts}} found in this workflow. Open the list.":
    "{{counts}} in diesem Workflow gefunden. Liste öffnen.",
  "See everything the checks found": "Alles ansehen, was die Prüfungen fanden",
  // The manual trigger
  "How to run it": "So starten Sie ihn",
  "Click {{button}} in the builder's toolbar and enter the JSON this run starts with.":
    "Klicken Sie in der Werkzeugleiste auf {{button}} und geben Sie das JSON ein, mit dem die Ausführung beginnt.",
  "Run Workflow": "Workflow ausführen",
  "Or start it from another workflow with an {{step}} step, which passes the JSON for you.":
    "Oder starten Sie ihn aus einem anderen Workflow mit einem Schritt {{step}}, der das JSON übergibt.",
  // What a step returns and where it goes
  "Copy the reference to {{name}}": "Verweis auf {{name}} kopieren",
  "Response Body": "Antworttext",
  "This step does not return any data.":
    "Dieser Schritt gibt keine Daten zurück.",
  "No connections.": "Keine Verbindungen.",
  // If / Else
  If: "Wenn",
  Yes: "Ja",
  No: "Nein",
  "otherwise.": "andernfalls.",
  "Compare as": "Vergleichen als",
  "Compare with": "Vergleichswert",
  "Value to check": "Zu prüfender Wert",
  Null: "Null",
  "e.g. {{example}}": "z. B. {{example}}",
  "{{side}} is compared as {{type}}, which ignores what it holds. This step no longer offers that: choose how to compare under {{compareAs}}, or choose is empty to check for a missing value.":
    "{{side}} wird als {{type}} verglichen, was seinen Inhalt ignoriert. Wählen Sie unter {{compareAs}}, wie verglichen wird.",
  '"{{value}}" is not a number, so it is compared as 0.':
    "„{{value}}“ ist keine Zahl und wird als 0 verglichen.",
  // A column's value
  True: "Wahr",
  False: "Falsch",
  "Not set": "Nicht gesetzt",
  "Remove {{option}}": "{{option}} entfernen",
  "Type a value and press Enter": "Wert eingeben und Enter drücken",
  "No value needed": "Kein Wert nötig",
  // A record's fields
  Monitors: "Monitore",
  Labels: "Labels",
  "{{fields}} and {{count}} other fields can only be set with Edit as JSON.":
    "{{fields}} und {{count}} weitere Felder lassen sich nur mit „Als JSON bearbeiten“ setzen.",
  "{{fields}} and {{count}} other fields can only be set with Edit as JSON._one":
    "{{fields}} und {{count}} weiteres Feld lassen sich nur mit „Als JSON bearbeiten“ setzen.",
  "{{fields}} can only be set with Edit as JSON.":
    "{{fields}} lassen sich nur mit „Als JSON bearbeiten“ setzen.",
  "No fields set yet": "Noch keine Felder gesetzt",
  "Pick a field below to start building this record.":
    "Wählen Sie unten ein Feld, um diesen Datensatz aufzubauen.",
  "Add a field": "Feld hinzufügen",
  "Search {{count}} fields": "{{count}} Felder durchsuchen",
  "Search {{count}} fields_one": "{{count}} Feld durchsuchen",
  Name: "Name",
  Text: "Text",
};

const RUSSIAN: Record<string, string> = {
  "{{count}} errors": "Ошибок: {{count}}",
  "{{count}} errors_one": "{{count}} ошибка",
  "{{count}} warnings": "Предупреждений: {{count}}",
  "{{count}} warnings_one": "{{count}} предупреждение",
};

// Words without the sentences they go in.
const FRENCH_WORDS_ONLY: Record<string, string> = {
  "Response Body": "Corps de la réponse",
  "Run Workflow": "Exécuter le workflow",
  Error: "Erreur",
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: {
      de: { translation: GERMAN },
      ru: { translation: RUSSIAN },
      fr: { translation: FRENCH_WORDS_ONLY },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(async () => {
  await i18next.changeLanguage("de");
});

afterEach(() => {
  cleanup();
});

type NoopFunction = () => void;

const noop: NoopFunction = (): void => {};

type MakeIssueFunction = (
  severity: WorkflowLintSeverity,
  message: string,
) => WorkflowLintIssue;

const makeIssue: MakeIssueFunction = (
  severity: WorkflowLintSeverity,
  message: string,
): WorkflowLintIssue => {
  return {
    rule: WorkflowLintRule.MissingRequiredArgument,
    severity: severity,
    nodeId: "n1",
    componentId: "monitor-secret-create-one-1",
    argumentId: null,
    message: message,
  };
};

type MakeLintResultFunction = (
  errorCount: number,
  warningCount: number,
) => WorkflowLintResult;

const makeLintResult: MakeLintResultFunction = (
  errorCount: number,
  warningCount: number,
): WorkflowLintResult => {
  const issues: Array<WorkflowLintIssue> = [
    ...Array.from({ length: errorCount }, (_x: unknown, i: number) => {
      return makeIssue(WorkflowLintSeverity.Error, `Error number ${i + 1}.`);
    }),
    ...Array.from({ length: warningCount }, (_x: unknown, i: number) => {
      return makeIssue(
        WorkflowLintSeverity.Warning,
        `Warning number ${i + 1}.`,
      );
    }),
  ];

  return {
    issues: issues,
    errorsByNodeId: {},
    errorCount: errorCount,
    warningCount: warningCount,
  };
};

describe("WorkflowIssuesModal in the reader's language", () => {
  test("counts each kind in the language's plural form, as one sentence", () => {
    render(
      <WorkflowIssuesModal
        lintResult={makeLintResult(1, 2)}
        stepTitlesByNodeId={{ n1: "Create Monitor Secret" }}
        onClose={noop}
        onGoToStep={noop}
      />,
    );

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Probleme mit diesem Workflow",
    );
    expect(screen.getByTestId("workflow-issues-error-count")).toHaveTextContent(
      /^1 Fehler$/,
    );
    expect(
      screen.getByTestId("workflow-issues-warning-count"),
    ).toHaveTextContent(/^2 Warnungen$/);
    expect(screen.getByText("an 1 Stelle")).toBeInTheDocument();
  });

  test("words the step's action around the step's own name", () => {
    render(
      <WorkflowIssuesModal
        lintResult={makeLintResult(1, 0)}
        stepTitlesByNodeId={{ n1: "Create Monitor Secret" }}
        onClose={noop}
        onGoToStep={noop}
      />,
    );

    const goToStep: HTMLElement = screen.getByTestId(
      "workflow-issue-go-to-step",
    );

    expect(goToStep).toHaveTextContent("Schritt öffnen");
    expect(goToStep).toHaveAttribute(
      "aria-label",
      "Einstellungen für Create Monitor Secret öffnen",
    );
    // A screen reader hears the severity in words before each issue.
    expect(screen.getByTestId("workflow-issue")).toHaveTextContent(
      "Fehler: Error number 1.",
    );
  });

  test("says the workflow is clean in the reader's language", () => {
    render(
      <WorkflowIssuesModal lintResult={makeLintResult(0, 0)} onClose={noop} />,
    );

    expect(screen.getByTestId("workflow-issues-empty")).toHaveTextContent(
      "Hier gibt es nichts zu beheben",
    );
    expect(screen.getByTestId("workflow-issues-empty")).toHaveTextContent(
      "Die Prüfungen haben an diesem Workflow nichts gefunden.",
    );
  });

  test("21 takes the 'one' form in Russian, 5 its general form", async () => {
    await i18next.changeLanguage("ru");

    render(
      <WorkflowIssuesModal lintResult={makeLintResult(21, 5)} onClose={noop} />,
    );

    expect(screen.getByTestId("workflow-issues-error-count")).toHaveTextContent(
      /^21 ошибка$/,
    );
    expect(
      screen.getByTestId("workflow-issues-warning-count"),
    ).toHaveTextContent(/^Предупреждений: 5$/);
  });
});

describe("WorkflowStatusBar in the reader's language", () => {
  test("the save state, the run's sentence and the checks' counts", () => {
    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        lintResult={makeLintResult(1, 2)}
        onShowIssues={noop}
        runStatusMessage={RUN_FAILED_MESSAGES[WorkflowStatus.Error]}
        runStatusFailed={true}
        onShowRunLog={noop}
      />,
    );

    expect(screen.getByText("Gespeichert")).toBeInTheDocument();

    const run: HTMLElement = screen.getByTestId("workflow-run-status-button");

    expect(run).toHaveTextContent(
      "Ausführung fehlgeschlagen. Das Protokoll sagt, warum.",
    );
    expect(run).toHaveAttribute(
      "aria-label",
      "Ausführung fehlgeschlagen. Das Protokoll sagt, warum. Protokoll öffnen.",
    );
    expect(run).toHaveAttribute("title", "Protokoll dieser Ausführung ansehen");

    const lint: HTMLElement = screen.getByTestId("workflow-lint-status-button");

    expect(lint).toHaveTextContent("1 Fehler, 2 Warnungen");
    expect(lint).toHaveAttribute(
      "aria-label",
      "1 Fehler, 2 Warnungen in diesem Workflow gefunden. Liste öffnen.",
    );
  });

  test("the watcher's sentences are keys the bar looks up as it draws", () => {
    const starting: string | null = decideRunWatch({
      run: null,
      pollCount: 0,
    }).message;

    // English until it is drawn, so a language switch re-words the strip.
    expect(starting).toBe(RUN_STARTING_MESSAGE);
    expect(starting).toBe("Starting run…");

    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        runStatusMessage={starting}
      />,
    );

    expect(screen.getByTestId("workflow-run-status")).toHaveTextContent(
      "Ausführung startet…",
    );
  });

  test("a locale without the sentence keeps it wholly English", async () => {
    await i18next.changeLanguage("fr");

    render(
      <WorkflowStatusBar
        saveState={WorkflowSaveState.Saved}
        runStatusMessage={RUN_FAILED_MESSAGES[WorkflowStatus.Error]}
        runStatusFailed={true}
        onShowRunLog={noop}
      />,
    );

    expect(screen.getByTestId("workflow-run-status-button")).toHaveAttribute(
      "aria-label",
      "Run error. Open the run log to see why. Open the run log.",
    );
  });
});

describe("the step's own panels in the reader's language", () => {
  test("the manual trigger's sentences keep their names in place", () => {
    render(<ManualTriggerPanel />);

    expect(screen.getByText("So starten Sie ihn")).toBeInTheDocument();

    const howToRun: HTMLElement = screen.getByTestId(
      "manual-trigger-how-to-run",
    );
    const items: Array<HTMLElement> = within(howToRun).getAllByRole("listitem");

    expect(items[0]).toHaveTextContent(
      "Klicken Sie in der Werkzeugleiste auf Workflow ausführen und geben Sie das JSON ein, mit dem die Ausführung beginnt.",
    );
    // The toolbar's button, as the toolbar labels it.
    expect(within(items[0]!).getByText("Workflow ausführen").tagName).toBe(
      "STRONG",
    );
    // The step's name as the canvas shows it.
    expect(items[1]).toHaveTextContent(
      `Oder starten Sie ihn aus einem anderen Workflow mit einem Schritt ${EXECUTE_WORKFLOW_COMPONENT_TITLE}, der das JSON übergibt.`,
    );
  });

  test("a return value's copy button names it in the sentence", () => {
    render(
      <ComponentReturnValueViewer
        name=""
        description=""
        componentId="api-get-1"
        returnValues={[
          {
            id: "response-body",
            name: "Response Body",
            description: "What came back",
            type: ComponentInputType.JSON,
            required: false,
          },
        ]}
      />,
    );

    expect(
      screen.getByLabelText("Verweis auf Antworttext kopieren"),
    ).toBeInTheDocument();
  });

  test("a locale with the name but not the sentence stays wholly English", async () => {
    await i18next.changeLanguage("fr");

    render(
      <ComponentReturnValueViewer
        name=""
        description=""
        componentId="api-get-1"
        returnValues={[
          {
            id: "response-body",
            name: "Response Body",
            description: "What came back",
            type: ComponentInputType.JSON,
            required: false,
          },
        ]}
      />,
    );

    expect(
      screen.getByLabelText("Copy the reference to Response Body"),
    ).toBeInTheDocument();
  });

  test("an empty list says so in the reader's language", () => {
    render(
      <>
        <ComponentReturnValueViewer name="" description="" returnValues={[]} />
        <ComponentPortViewer name="" description="" ports={[]} />
      </>,
    );

    expect(
      screen.getByText("Dieser Schritt gibt keine Daten zurück."),
    ).toBeInTheDocument();
    expect(screen.getByText("Keine Verbindungen.")).toBeInTheDocument();
  });
});

describe("If / Else in the reader's language", () => {
  // A workflow saved when Compare with could still be compared as Null.
  const LEGACY_NULL_CHECK: JSONObject = {
    "input-1-type": "text",
    "input-1": "{{local.components.webhook-1.returnValues.request-body.env}}",
    operator: "==",
    "input-2-type": "null",
    "input-2": "production",
  };

  test("the sentence's words, its branches and the note about Null", () => {
    render(
      <ConditionEditor
        arguments={LEGACY_NULL_CHECK}
        onChange={noop}
        onValidationChange={noop}
      />,
    );

    const condition: HTMLElement = screen.getByTestId("if-else-condition");

    expect(within(condition).getByText("Wenn")).toBeInTheDocument();
    expect(within(condition).getByText("Ja")).toBeInTheDocument();
    expect(within(condition).getByText("Nein")).toBeInTheDocument();
    expect(screen.getByTestId("if-else-summary-no")).toHaveTextContent(
      "andernfalls.",
    );

    /*
     * Built outside React, from the global instance: the setting's name and
     * the type are translated with the sentence they are in.
     */
    expect(screen.getByTestId("if-else-notes")).toHaveTextContent(
      "Vergleichswert wird als Null verglichen, was seinen Inhalt ignoriert. Wählen Sie unter Vergleichen als, wie verglichen wird.",
    );
    // Open on load, as a workflow that still compares as Null opens it.
    expect(screen.getByText("Vergleichen als")).toBeInTheDocument();
  });

  test("a typed value that is not a number is quoted in the note", () => {
    render(
      <ConditionEditor
        arguments={{
          "input-1-type": "number",
          "input-1":
            "{{local.components.api-get-1.returnValues.response-status}}",
          operator: ">=",
          "input-2-type": "number",
          "input-2": "abc",
        }}
        onChange={noop}
        onValidationChange={noop}
      />,
    );

    expect(screen.getByTestId("if-else-notes")).toHaveTextContent(
      "„abc“ ist keine Zahl und wird als 0 verglichen.",
    );
  });

  test("the example to type is a value, written the same in every language", () => {
    render(
      <ConditionEditor
        arguments={{
          "input-1-type": "text",
          "input-1": "{{local.variables.DEPLOY_ENV}}",
          operator: "==",
          "input-2-type": "text",
          "input-2": "",
        }}
        onChange={noop}
        onValidationChange={noop}
      />,
    );

    expect(screen.getByText("z. B. production")).toBeInTheDocument();
  });
});

describe("a column's value in the reader's language", () => {
  test("a yes / no column's three states", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Boolean}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        onChange={noop}
      />,
    );

    expect(screen.getByRole("button", { name: "Wahr" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Falsch" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Nicht gesetzt" }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  test("a list's chips and its box", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Text}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={["production"]}
        operatorOption={getOperatorOption(DictionaryFilterOperator.IsAnyOf)}
        onChange={noop}
      />,
    );

    expect(
      screen.getByRole("button", { name: "production entfernen" }),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Wert eingeben und Enter drücken"),
    ).toBeInTheDocument();
  });

  test("a comparison that takes no value says so", () => {
    render(
      <ColumnValueInput
        control={ModelColumnControl.Text}
        valueMode={ColumnValueMode.Literal}
        text=""
        values={[]}
        operatorOption={getOperatorOption(DictionaryFilterOperator.IsEmpty)}
        onChange={noop}
      />,
    );

    expect(screen.getByText("Kein Wert nötig")).toBeInTheDocument();
  });
});

describe("a record's fields in the reader's language", () => {
  type MakeColumnFunction = (
    id: string,
    title: string,
    type: TableColumnType,
    isRelation: boolean,
  ) => ModelSchemaColumn;

  const makeColumn: MakeColumnFunction = (
    id: string,
    title: string,
    type: TableColumnType,
    isRelation: boolean,
  ): ModelSchemaColumn => {
    return { id: id, title: title, type: type, isRelation: isRelation };
  };

  // Relations with no ID field of their own: only JSON can set them.
  const JSON_ONLY: Array<ModelSchemaColumn> = [
    makeColumn("monitors", "Monitors", TableColumnType.EntityArray, true),
    makeColumn("labels", "Labels", TableColumnType.EntityArray, true),
    makeColumn("ownerUsers", "Owner Users", TableColumnType.EntityArray, true),
    makeColumn("ownerTeams", "Owner Teams", TableColumnType.EntityArray, true),
  ];

  const NAME: ModelSchemaColumn = makeColumn(
    "name",
    "Name",
    TableColumnType.ShortText,
    false,
  );

  const DESCRIPTION: ModelSchemaColumn = makeColumn(
    "description",
    "Description",
    TableColumnType.LongText,
    false,
  );

  test("names three fields that need JSON and counts the rest, as one sentence", () => {
    render(
      <ModelRecordForm
        rows={[]}
        columns={[NAME, ...JSON_ONLY]}
        use={ColumnUse.Create}
        onChange={noop}
      />,
    );

    expect(
      screen.getByText(
        "Monitore, Labels, Owner Users und 1 weiteres Feld lassen sich nur mit „Als JSON bearbeiten“ setzen.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("Noch keine Felder gesetzt")).toBeInTheDocument();
  });

  test("three or fewer are all named", () => {
    render(
      <ModelRecordForm
        rows={[]}
        columns={[NAME, ...JSON_ONLY.slice(0, 2)]}
        use={ColumnUse.Create}
        onChange={noop}
      />,
    );

    expect(
      screen.getByText(
        "Monitore, Labels lassen sich nur mit „Als JSON bearbeiten“ setzen.",
      ),
    ).toBeInTheDocument();
  });

  test("the picker's button and search box", () => {
    render(
      <ModelRecordForm
        rows={[]}
        columns={[NAME, DESCRIPTION]}
        use={ColumnUse.Create}
        onChange={noop}
      />,
    );

    const trigger: HTMLElement = screen.getByTestId("model-column-add");

    expect(trigger).toHaveTextContent("Feld hinzufügen");

    fireEvent.click(trigger);

    expect(
      screen.getByPlaceholderText("2 Felder durchsuchen"),
    ).toBeInTheDocument();
    expect(screen.getByRole("listbox")).toHaveAttribute(
      "aria-label",
      "Feld hinzufügen",
    );
  });
});
