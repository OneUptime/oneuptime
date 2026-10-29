import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { JSONObject } from "../../../Types/JSON";

/*
 * A Logs, Traces, Exceptions or Metrics monitor's criteria, edited as the
 * one rule most of them are: When to alert (a condition, a number and a
 * window, said back in one sentence over what the rule would have caught)
 * and What happens (an alert, an incident or both).
 *
 * Each edit is pinned by what reaches the stored step - the criteria the
 * monitor is saved with - and criteria that are more than one rule open in
 * the full criteria editor, unchanged, with the reason above them. The
 * preview chart is stood in for: it has its own suite.
 */

interface RecordedPreview {
  monitorType: string;
  settings: JSONObject;
  filterType: string;
  threshold: number | undefined;
  isGrouped?: boolean | undefined;
}

const previews: Array<RecordedPreview> = [];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TelemetryRule/TelemetryRulePreview",
  () => {
    return {
      __esModule: true,
      default: (
        props: RecordedPreview & {
          onUseSuggestedThreshold?: ((value: number) => void) | undefined;
        },
      ): ReactElement => {
        previews.push(props);
        return (
          <button
            type="button"
            data-testid="preview-stub"
            onClick={() => {
              props.onUseSuggestedThreshold?.(240);
            }}
          >
            Use 240
          </button>
        );
      },
    };
  },
);

import TelemetryRuleEditor, {
  getPreviewSettings,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Form/Monitor/TelemetryRule/TelemetryRuleEditor";
import {
  applyRecipe,
  getRecipe,
  METRIC_ABOVE_RECIPE,
  TelemetryRuleRecipe,
  TelemetryRuleRecipeKey,
  TelemetryRuleSeeds,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Form/Monitor/TelemetryRule/TelemetryRuleRecipes";
import LogSeverity from "../../../Types/Log/LogSeverity";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeType,
  FilterType,
} from "../../../Types/Monitor/CriteriaFilter";
import MonitorCriteria from "../../../Types/Monitor/MonitorCriteria";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import { MonitorStepLogMonitorUtil } from "../../../Types/Monitor/MonitorStepLogMonitor";
import { MonitorStepMetricMonitorUtil } from "../../../Types/Monitor/MonitorStepMetricMonitor";
import MonitorType from "../../../Types/Monitor/MonitorType";
import TelemetryAlertRuleUtil, {
  TelemetryAlertRule,
} from "../../../Types/Monitor/TelemetryAlertRule";
import ObjectID from "../../../Types/ObjectID";
import RollingTime from "../../../Types/RollingTime/RollingTime";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const ENGLISH: Translator = createTranslator(undefined, "en");

const OPERATIONAL: string = "11111111-1111-4111-8111-111111111111";
const DEGRADED: string = "22222222-2222-4222-8222-222222222222";
const OFFLINE: string = "33333333-3333-4333-8333-333333333333";
const INCIDENT_SEVERITY: string = "44444444-4444-4444-8444-444444444444";
const ALERT_SEVERITY: string = "55555555-5555-4555-8555-555555555555";

const SEEDS: TelemetryRuleSeeds = {
  monitorName: "Checkout",
  operationalStatusId: new ObjectID(OPERATIONAL),
  degradedStatusId: new ObjectID(DEGRADED),
  offlineStatusId: new ObjectID(OFFLINE),
  incidentSeverityId: new ObjectID(INCIDENT_SEVERITY),
  alertSeverityId: new ObjectID(ALERT_SEVERITY),
};

const STATUS_OPTIONS: Array<DropdownOption> = [
  { value: OPERATIONAL, label: "Operational" },
  { value: DEGRADED, label: "Degraded" },
  { value: OFFLINE, label: "Offline" },
];

interface Recorder {
  latest: MonitorStep | null;
  changes: number;
}

const Harness: React.FunctionComponent<{
  monitorType: MonitorType;
  initial: MonitorStep;
  recorder: Recorder;
  showErrors?: boolean | undefined;
}> = (props: {
  monitorType: MonitorType;
  initial: MonitorStep;
  recorder: Recorder;
  showErrors?: boolean | undefined;
}): ReactElement => {
  const [step, setStep] = React.useState<MonitorStep>(props.initial);

  return (
    <TelemetryRuleEditor
      monitorType={props.monitorType}
      monitorStep={step}
      defaultMonitorStatusId={new ObjectID(OPERATIONAL)}
      seeds={SEEDS}
      monitorStatusDropdownOptions={STATUS_OPTIONS}
      incidentSeverityDropdownOptions={[
        { value: INCIDENT_SEVERITY, label: "Critical" },
      ]}
      alertSeverityDropdownOptions={[{ value: ALERT_SEVERITY, label: "High" }]}
      onCallPolicyDropdownOptions={[]}
      labelDropdownOptions={[]}
      userDropdownOptions={[]}
      seriesAttributeKeys={[]}
      showErrors={props.showErrors}
      onChange={(next: MonitorStep) => {
        props.recorder.latest = next;
        props.recorder.changes += 1;
        setStep(next);
      }}
      customCriteria={
        <div data-testid="custom-criteria-stub">The full criteria editor</div>
      }
    />
  );
};

function recipeStep(key: TelemetryRuleRecipeKey): MonitorStep {
  const recipe: TelemetryRuleRecipe = getRecipe(key)!;
  const step: MonitorStep = new MonitorStep();

  return applyRecipe({
    monitorStep: step,
    recipe,
    seeds: SEEDS,
    translator: ENGLISH,
  });
}

function metricStep(aliases: Array<string> = ["a"]): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.setMetricMonitor({
    ...MonitorStepMetricMonitorUtil.getDefault(),
    metricViewConfig: {
      queryConfigs: aliases.map((alias: string) => {
        return {
          metricAliasData: {
            metricVariable: alias,
            title: alias === "a" ? "CPU" : "",
            description: "",
            legend: "",
            legendUnit: alias === "a" ? "%" : "",
          },
          metricQueryData: {
            filterData: { metricName: `metric.${alias}` },
          },
        };
      }),
      formulaConfigs: [],
    },
  });

  return applyRecipe({
    monitorStep: step,
    recipe: METRIC_ABOVE_RECIPE,
    seeds: SEEDS,
    translator: ENGLISH,
  });
}

function renderEditor(data: {
  monitorType: MonitorType;
  initial: MonitorStep;
  showErrors?: boolean | undefined;
}): Recorder {
  const recorder: Recorder = { latest: null, changes: 0 };

  render(
    <Harness
      monitorType={data.monitorType}
      initial={data.initial}
      recorder={recorder}
      showErrors={data.showErrors}
    />,
  );

  return recorder;
}

// The field's dropdown, found from its label.
function comboboxOf(title: string): HTMLElement {
  let node: HTMLElement | null = screen
    .getAllByText(title, { exact: true })
    .find((element: HTMLElement) => {
      return element.tagName === "LABEL" || element.closest("label");
    }) as HTMLElement | null;

  if (!node) {
    node = screen.getAllByText(title, { exact: true })[0] || null;
  }

  while (node) {
    const combobox: HTMLElement | null =
      node.querySelector<HTMLElement>('[role="combobox"]');

    if (combobox) {
      return combobox;
    }

    node = node.parentElement;
  }

  throw new Error(`No dropdown found for "${title}".`);
}

// Picks an option of a react-select, the way a pointer does.
function pick(combobox: HTMLElement, optionText: string): void {
  fireEvent.keyDown(combobox, { key: "ArrowDown" });
  const options: Array<HTMLElement> = screen.getAllByText(optionText, {
    exact: true,
  });
  const option: HTMLElement = options[options.length - 1]!;
  fireEvent.mouseDown(option);
  fireEvent.click(option);
}

function storedRule(
  recorder: Recorder,
  monitorType: MonitorType,
): TelemetryAlertRule {
  const rule: TelemetryAlertRule | null = TelemetryAlertRuleUtil.read({
    monitorType,
    monitorStep: recorder.latest!,
    defaultMonitorStatusId: new ObjectID(OPERATIONAL),
  }).rule;

  if (!rule) {
    throw new Error("The stored criteria are not one rule");
  }

  return rule;
}

function storedFilter(recorder: Recorder): CriteriaFilter {
  return recorder.latest!.data!.monitorCriteria!.data!
    .monitorCriteriaInstanceArray[0]!.data!.filters[0]!;
}

function sentence(): string {
  return screen.getByTestId("telemetry-rule-sentence").textContent || "";
}

function thresholdBox(): HTMLInputElement {
  return screen.getByTestId("telemetry-rule-threshold") as HTMLInputElement;
}

afterEach(() => {
  cleanup();
  previews.length = 0;
});

describe("When to alert, for a Logs monitor", () => {
  test("shows the rule as a condition, a number and a window, said back in one sentence", () => {
    renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    expect(screen.getByText("When to alert")).toBeInTheDocument();
    expect(screen.getByText("What happens")).toBeInTheDocument();
    expect(screen.getByText("Number of logs")).toBeInTheDocument();
    expect(thresholdBox().value).toBe("10");
    expect(
      within(screen.getByTestId("telemetry-rule-comparison")).getByText(
        "More than",
      ),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("telemetry-rule-window")).getByText(
        "Last 5 minutes",
      ),
    ).toBeInTheDocument();
    expect(sentence()).toBe(
      "Alerts when the number of matching logs in 5 minutes is more than 10.",
    );
    // The full editor is not drawn for one rule.
    expect(
      screen.queryByTestId("custom-criteria-stub"),
    ).not.toBeInTheDocument();
  });

  test("the preview reads the step's own query, without its grouping", () => {
    const step: MonitorStep = recipeStep(TelemetryRuleRecipeKey.ErrorLogs);
    step.setLogMonitor({
      ...step.data!.logMonitor!,
      body: "payment",
      groupByAttributes: ["tenant"],
      resolvedByAttributes: { status: "ok" },
    });

    renderEditor({ monitorType: MonitorType.Logs, initial: step });

    const preview: RecordedPreview = previews[previews.length - 1]!;
    expect(preview.monitorType).toBe(MonitorType.Logs);
    expect(preview.settings).toMatchObject({
      body: "payment",
      severityTexts: [LogSeverity.Error, LogSeverity.Fatal],
      lastXSecondsOfLogs: 300,
      groupByAttributes: [],
      resolvedByAttributes: {},
    });
    expect(preview.filterType).toBe(FilterType.GreaterThan);
    expect(preview.threshold).toBe(10);
    expect(preview.isGrouped).toBe(true);
  });

  test("typing a number writes it to the stored criteria and the sentence", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    fireEvent.change(thresholdBox(), { target: { value: "25" } });

    expect(storedFilter(recorder)).toMatchObject({
      checkOn: CheckOn.LogCount,
      filterType: FilterType.GreaterThan,
      value: 25,
    });
    expect(sentence()).toBe(
      "Alerts when the number of matching logs in 5 minutes is more than 25.",
    );
    // The recipe's title says what kind of rule it is, and stays.
    expect(
      recorder.latest!.data!.monitorCriteria!.data!
        .monitorCriteriaInstanceArray[0]!.data!.alerts[0]!.title,
    ).toBe("Checkout: too many errors");
  });

  test("an emptied number is said to be missing once left, and the rule waits for one", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    fireEvent.change(thresholdBox(), { target: { value: "" } });
    fireEvent.blur(thresholdBox());

    expect(storedFilter(recorder).value).toBeUndefined();
    expect(
      screen.getByText("Enter the value to compare with."),
    ).toBeInTheDocument();
    expect(sentence()).toBe(
      "Alerts when the number of matching logs in 5 minutes is more than the number you enter.",
    );
  });

  test("the suggested number from the preview becomes the rule's", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    fireEvent.click(screen.getByTestId("preview-stub"));

    expect(storedFilter(recorder).value).toBe(240);
    expect(thresholdBox().value).toBe("240");
  });

  test("another condition and window are written to the criteria and the step", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    pick(comboboxOf("Condition"), "Exactly");
    fireEvent.change(thresholdBox(), { target: { value: "0" } });
    pick(comboboxOf("Time window"), "Last 10 minutes");

    expect(storedFilter(recorder)).toMatchObject({
      filterType: FilterType.EqualTo,
      value: 0,
    });
    expect(recorder.latest!.data!.logMonitor!.lastXSecondsOfLogs).toBe(600);
    expect(sentence()).toBe(
      "Alerts when no matching logs arrive in 10 minutes.",
    );
    // Now a rule about silence: the title follows to that kind.
    expect(storedRule(recorder, MonitorType.Logs).alert?.title).toBe(
      "Checkout: logs stopped",
    );
  });

  test("an unusual-for-the-hour condition asks for a sensitivity instead of a number", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    pick(comboboxOf("Condition"), "Unusually high");

    expect(
      screen.queryByTestId("telemetry-rule-threshold"),
    ).not.toBeInTheDocument();
    expect(screen.getByTestId("telemetry-rule-sensitivity")).toHaveTextContent(
      "Medium",
    );
    expect(storedFilter(recorder).filterType).toBe(FilterType.AnomalouslyHigh);
    expect(sentence()).toBe(
      "Alerts when matching logs in 5 minutes are unusually many for this hour of the week.",
    );
  });

  test("an Exceptions monitor offers no unusual conditions", () => {
    renderEditor({
      monitorType: MonitorType.Exceptions,
      initial: recipeStep(TelemetryRuleRecipeKey.AnyException),
    });

    fireEvent.keyDown(comboboxOf("Condition"), { key: "ArrowDown" });

    expect(screen.queryByText("Unusually high")).not.toBeInTheDocument();
    expect(screen.getAllByText("At least").length).toBeGreaterThan(0);
    expect(screen.getByText("Number of exceptions")).toBeInTheDocument();
  });
});

describe("What happens", () => {
  test("a new rule creates an alert; declaring an incident instead writes the incident, titled like the alert", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    expect(
      screen.getByRole("radio", { name: /Create an alert/ }),
    ).toBeChecked();

    fireEvent.click(screen.getByRole("radio", { name: /Declare an incident/ }));

    const instance: MonitorCriteriaInstance =
      recorder.latest!.data!.monitorCriteria!.data!
        .monitorCriteriaInstanceArray[0]!;

    expect(instance.data).toMatchObject({
      createIncidents: true,
      createAlerts: false,
      changeMonitorStatus: true,
    });
    expect(instance.data!.incidents[0]!.title).toBe(
      "Checkout: too many errors",
    );
    expect(instance.data!.monitorStatusId?.toString()).toBe(OFFLINE);
  });

  test("both: the alert and the incident are each opened", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Traces,
      initial: recipeStep(TelemetryRuleRecipeKey.FailedSpans),
    });

    fireEvent.click(screen.getByRole("radio", { name: /^Both/ }));

    expect(
      recorder.latest!.data!.monitorCriteria!.data!
        .monitorCriteriaInstanceArray[0]!.data,
    ).toMatchObject({ createIncidents: true, createAlerts: true });
    expect(screen.getByTestId("telemetry-rule-alert")).toBeInTheDocument();
    expect(screen.getByTestId("telemetry-rule-incident")).toBeInTheDocument();
  });

  test("what it opens is set up under the choice and as wide as it, headed by whose settings they are", () => {
    renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    const alert: HTMLElement = screen.getByTestId("telemetry-rule-alert");

    /*
     * Indented under the radios (sm:ml-6, the criteria editor's nesting
     * under a switch), the box read as the last radio's - "Both" - though
     * "Create an alert" was the one picked.
     */
    expect(alert.className).not.toContain("ml-6");
    expect(alert.firstElementChild!.textContent).toBe("Alert");
    expect(alert).toHaveTextContent("Alert Title");

    // After the choice, not inside it.
    const choice: HTMLElement = screen.getByTestId("telemetry-rule-action");
    expect(choice).not.toContainElement(alert);
    expect(
      choice.compareDocumentPosition(alert) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    fireEvent.click(screen.getByRole("radio", { name: /^Both/ }));

    // Both: one box each, each saying whose it is.
    expect(
      screen.getByTestId("telemetry-rule-alert").firstElementChild!.textContent,
    ).toBe("Alert");
    expect(
      screen.getByTestId("telemetry-rule-incident").firstElementChild!
        .textContent,
    ).toBe("Incident");
    expect(screen.getByTestId("telemetry-rule-incident")).toHaveTextContent(
      "Incident Title",
    );
  });

  test("Only change the monitor's status is offered to a rule that already does just that", () => {
    const step: MonitorStep = recipeStep(TelemetryRuleRecipeKey.ErrorLogs);
    const rule: TelemetryAlertRule = TelemetryAlertRuleUtil.read({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      defaultMonitorStatusId: new ObjectID(OPERATIONAL),
    }).rule!;
    const statusOnly: MonitorStep = TelemetryAlertRuleUtil.write({
      monitorType: MonitorType.Logs,
      monitorStep: step,
      rule: { ...rule, action: "StatusOnly" as TelemetryAlertRule["action"] },
    });

    renderEditor({ monitorType: MonitorType.Logs, initial: statusOnly });

    expect(
      screen.getByRole("radio", { name: /Only change the monitor's status/ }),
    ).toBeChecked();
  });

  test("a new rule's status, name and the way to the full editor wait under More fields", () => {
    renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    const more: HTMLElement = within(
      screen.getByTestId("telemetry-rule-more-fields"),
    ).getAllByRole("button", { name: "More fields" })[0]!;

    expect(more).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("telemetry-rule-more-fields")).toHaveTextContent(
      "Monitor status while it matches",
    );
    expect(screen.getByTestId("telemetry-rule-more-fields")).toHaveTextContent(
      "Degraded",
    );
    /*
     * The way to several rules is named on the folded line too: folded,
     * it named only the status and the name.
     */
    expect(
      within(more).getByText("Edit as custom criteria", { exact: false }),
    ).toBeInTheDocument();
  });

  test("Edit as custom criteria opens the full editor, and Back to the simple rule closes it", () => {
    renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    fireEvent.click(
      within(screen.getByTestId("telemetry-rule-more-fields")).getAllByRole(
        "button",
        { name: "More fields" },
      )[0]!,
    );
    fireEvent.click(screen.getByTestId("telemetry-rule-edit-as-custom"));

    expect(screen.getByTestId("custom-criteria-stub")).toBeInTheDocument();
    expect(
      screen.queryByTestId("telemetry-rule-editor"),
    ).not.toBeInTheDocument();
    // One rule: no reason is given, and the way back is offered.
    expect(
      screen.queryByTestId("telemetry-rule-shape-problem"),
    ).not.toBeInTheDocument();

    /*
     * The way back switches what the card shows, so it sits in the card's
     * header with what every card offers - not under Add Criteria.
     */
    const back: HTMLElement = screen.getByTestId(
      "telemetry-rule-back-to-simple",
    );
    expect(screen.getByTestId("card-header-actions")).toContainElement(back);
    expect(
      screen.getByTestId("telemetry-rule-custom-criteria"),
    ).not.toContainElement(back);

    fireEvent.click(back);

    expect(screen.getByTestId("telemetry-rule-editor")).toBeInTheDocument();
  });

  test("the way to the full editor is one button, with a line saying when to use it", () => {
    renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    fireEvent.click(
      within(screen.getByTestId("telemetry-rule-more-fields")).getAllByRole(
        "button",
        { name: "More fields" },
      )[0]!,
    );

    const entry: HTMLElement = screen.getByTestId(
      "telemetry-rule-custom-criteria-entry",
    );

    expect(entry).toHaveTextContent(
      "For several rules, or a rule with more than one filter.",
    );
    // A label over the button said the button's own words a second time.
    expect(
      within(entry).getAllByText("Edit as custom criteria", { exact: true }),
    ).toHaveLength(1);
    expect(entry.querySelector("label")).toBeNull();
    expect(
      within(entry).getByRole("button", { name: "Edit as custom criteria" }),
    ).toBe(screen.getByTestId("telemetry-rule-edit-as-custom"));
  });
});

describe("criteria that are more than one rule", () => {
  test("open in the full editor, unchanged, with the reason and the window above them", () => {
    const step: MonitorStep = new MonitorStep();
    step.setLogMonitor({
      ...MonitorStepLogMonitorUtil.getDefault(),
      lastXSecondsOfLogs: 900,
    });

    const errors: MonitorCriteriaInstance = recipeStep(
      TelemetryRuleRecipeKey.ErrorLogs,
    ).data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!;
    const silence: MonitorCriteriaInstance = recipeStep(
      TelemetryRuleRecipeKey.LogsStop,
    ).data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!;
    const message: MonitorCriteriaInstance = recipeStep(
      TelemetryRuleRecipeKey.LogMessage,
    ).data!.monitorCriteria!.data!.monitorCriteriaInstanceArray[0]!;

    const criteria: MonitorCriteria = new MonitorCriteria();
    criteria.data = {
      monitorCriteriaInstanceArray: [errors, silence, message],
    };
    step.setMonitorCriteria(criteria);

    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Logs,
      initial: step,
    });

    expect(screen.getByTestId("custom-criteria-stub")).toBeInTheDocument();
    expect(
      screen.getByTestId("telemetry-rule-shape-problem"),
    ).toHaveTextContent(
      "These criteria are more than one rule, so each one is shown in full.",
    );
    expect(
      screen.queryByTestId("telemetry-rule-back-to-simple"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("telemetry-rule-window")).getByText(
        "Last 15 minutes",
      ),
    ).toBeInTheDocument();
    // Nothing is written just by showing them.
    expect(recorder.changes).toBe(0);

    // The window, set above them, is the step's.
    pick(comboboxOf("Time window"), "Last 30 minutes");

    expect(recorder.latest!.data!.logMonitor!.lastXSecondsOfLogs).toBe(1800);
    expect(
      recorder.latest!.data!.monitorCriteria!.data!
        .monitorCriteriaInstanceArray,
    ).toHaveLength(3);
  });
});

describe("When to alert, for a Metrics monitor", () => {
  test("asks how the metric is measured, over which window, and the value, without a preview of counts", () => {
    renderEditor({ monitorType: MonitorType.Metrics, initial: metricStep() });

    expect(screen.getByTestId("telemetry-rule-aggregation")).toHaveTextContent(
      "The average",
    );
    expect(screen.getByTestId("telemetry-rule-window")).toHaveTextContent(
      "Last 5 minutes",
    );
    expect(thresholdBox().value).toBe("");
    // One query: it is the metric the rule reads, so no metric is asked.
    expect(
      screen.queryByTestId("telemetry-rule-metric"),
    ).not.toBeInTheDocument();
    expect(sentence()).toBe(
      "Alerts when the average of CPU over the last 5 minutes is above the value you enter.",
    );
    expect(previews).toHaveLength(0);
  });

  test("its four fields sit two by two - what is measured over which window, then how it compares - with the sentence right under them", () => {
    renderEditor({ monitorType: MonitorType.Metrics, initial: metricStep() });

    const aggregation: HTMLElement = screen.getByTestId(
      "telemetry-rule-aggregation",
    );
    const grid: HTMLElement = aggregation.parentElement!;

    // Two columns: three left the third empty beside two fields a row.
    expect(grid).toHaveClass("grid", "sm:grid-cols-2");
    expect(grid.className).not.toContain("sm:grid-cols-3");
    expect(
      Array.from(grid.children).map((child: Element) => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual([
      "telemetry-rule-aggregation",
      "telemetry-rule-window",
      "telemetry-rule-comparison",
      "telemetry-rule-value",
    ]);

    // The sentence follows the fields; what is rarely set comes after it.
    const sentenceBox: HTMLElement = screen.getByTestId(
      "telemetry-rule-sentence",
    );
    const more: HTMLElement = screen.getByTestId(
      "telemetry-rule-condition-more-fields",
    );
    expect(
      grid.compareDocumentPosition(sentenceBox) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      sentenceBox.compareDocumentPosition(more) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("with several queries the metric takes the whole first row", () => {
    renderEditor({
      monitorType: MonitorType.Metrics,
      initial: metricStep(["a", "b"]),
    });

    const metric: HTMLElement = screen.getByTestId("telemetry-rule-metric");

    expect(metric).toHaveClass("sm:col-span-2");
    expect(metric.parentElement!.firstElementChild).toBe(metric);
  });

  test("a count rule keeps one row: the condition, the number and the window", () => {
    renderEditor({
      monitorType: MonitorType.Logs,
      initial: recipeStep(TelemetryRuleRecipeKey.ErrorLogs),
    });

    const grid: HTMLElement = screen.getByTestId(
      "telemetry-rule-comparison",
    ).parentElement!;

    expect(grid).toHaveClass("grid", "sm:grid-cols-3");
    expect(
      Array.from(grid.children).map((child: Element) => {
        return child.getAttribute("data-testid");
      }),
    ).toEqual([
      "telemetry-rule-comparison",
      "telemetry-rule-value",
      "telemetry-rule-window",
    ]);
  });

  test("a value is required once the form is sent", () => {
    renderEditor({
      monitorType: MonitorType.Metrics,
      initial: metricStep(),
      showErrors: true,
    });

    expect(
      screen.getByText("Enter the value to compare with."),
    ).toBeInTheDocument();
  });

  test("a value, a measure and a window are written to the stored criteria and the step", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Metrics,
      initial: metricStep(),
    });

    fireEvent.change(thresholdBox(), { target: { value: "80" } });
    pick(comboboxOf("Measured as"), "The highest value");
    pick(comboboxOf("Time window"), "Last 15 minutes");

    expect(storedFilter(recorder)).toMatchObject({
      checkOn: CheckOn.MetricValue,
      filterType: FilterType.GreaterThan,
      value: 80,
    });
    expect(
      storedFilter(recorder).metricMonitorOptions?.metricAggregationType,
    ).toBe(EvaluateOverTimeType.MaximumValue);
    expect(recorder.latest!.data!.metricMonitor!.rollingTime).toBe(
      RollingTime.Past15Minutes,
    );
    expect(sentence()).toBe(
      "Alerts when the highest value of CPU over the last 15 minutes is above 80 %.",
    );
  });

  test("with several queries, the metric the rule reads is asked for, and kept", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Metrics,
      initial: metricStep(["a", "b"]),
    });

    expect(screen.getByTestId("telemetry-rule-metric")).toHaveTextContent(
      "CPU",
    );

    pick(comboboxOf("Metric"), "metric.b");

    expect(storedFilter(recorder).metricMonitorOptions?.metricAlias).toBe("b");
    expect(sentence()).toContain("of metric.b over the last 5 minutes");
  });

  test("what an empty window counts as waits under More fields", () => {
    const recorder: Recorder = renderEditor({
      monitorType: MonitorType.Metrics,
      initial: metricStep(),
    });

    const more: HTMLElement = within(
      screen.getByTestId("telemetry-rule-condition-more-fields"),
    ).getAllByRole("button", { name: "More fields" })[0]!;

    expect(more).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(more);
    pick(comboboxOf("If there is no data"), "Alert, as if it matched");

    expect(storedFilter(recorder).metricMonitorOptions?.onNoDataPolicy).toBe(
      "Trigger",
    );
  });
});

describe("the preview's settings", () => {
  test("each count signal hands its own settings; a metric none", () => {
    expect(
      getPreviewSettings({
        monitorType: MonitorType.Traces,
        monitorStep: recipeStep(TelemetryRuleRecipeKey.FailedSpans),
      }),
    ).toMatchObject({ spanStatuses: [2], lastXSecondsOfSpans: 300 });
    expect(
      getPreviewSettings({
        monitorType: MonitorType.Exceptions,
        monitorStep: recipeStep(TelemetryRuleRecipeKey.AnyException),
      }),
    ).toMatchObject({ lastXSecondsOfExceptions: 300 });
    expect(
      getPreviewSettings({
        monitorType: MonitorType.Metrics,
        monitorStep: metricStep(),
      }),
    ).toBeNull();
    expect(
      getPreviewSettings({
        monitorType: MonitorType.Logs,
        monitorStep: new MonitorStep(),
      }),
    ).toMatchObject({ groupByAttributes: [], resolvedByAttributes: {} });
  });
});
