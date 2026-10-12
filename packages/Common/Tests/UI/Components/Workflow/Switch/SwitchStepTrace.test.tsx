/*
 * A Switch / Case step in a run's Steps view: which case it took, by the
 * name the canvas gives that case's output, and why - which case matched,
 * what it asked, and that the ones above it did not.
 *
 * A case's output is named after the case - the person's own words, such as
 * "Critical" - so it is shown as written in every language: looked up as one
 * of the product's labels, a German reader would have read a value they typed
 * in English as a German word. Default and every other step's outputs are
 * the product's own labels and are translated as before.
 */

import StepTraceViewer from "../../../../../UI/Components/Workflow/StepTraceViewer";
import {
  StepOutcome,
  StepOutcomeKind,
  StepValueRow,
  TraceValueKind,
  describeSwitchCasesForTrace,
  getReceivedRows,
  getStepOutcome,
} from "../../../../../UI/Components/Workflow/StepTracePresentation";
import {
  WorkflowStepStatus,
  WorkflowStepTrace,
  WorkflowStepTraceEntry,
} from "../../../../../Types/Workflow/StepTrace";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  test,
} from "@jest/globals";

type StepOverrides = Partial<WorkflowStepTraceEntry>;

const aStep: (overrides?: StepOverrides) => WorkflowStepTraceEntry = (
  overrides?: StepOverrides,
): WorkflowStepTraceEntry => {
  return {
    componentId: "switch-1",
    metadataId: "switch",
    title: "Switch / Case",
    status: WorkflowStepStatus.Success,
    startedAt: "2026-10-12T10:00:00.000Z",
    completedAt: "2026-10-12T10:00:00.002Z",
    durationInMs: 2,
    argumentValues: {
      value: "Critical",
      cases: [
        {
          id: "case-1",
          comparison: "==",
          value: "Critical",
          compareAs: "text",
        },
      ],
    },
    argumentNames: [
      { id: "value", name: "Value to check" },
      { id: "cases", name: "Cases" },
    ],
    returnValues: {},
    returnValueNames: [],
    executedPort: "case-1",
    executedPortTitle: "Critical",
    executedPortTitleIsFromSettings: true,
    executedPortDescription: "Runs next when the value is equal to “Critical”.",
    executedPortReason: "Case 1 matched: the value is equal to “Critical”.",
    nextSteps: [{ componentId: "slack-1", title: "Send Message to Slack" }],
    ...overrides,
  };
};

const traceOf: (
  ...steps: Array<WorkflowStepTraceEntry>
) => WorkflowStepTrace = (
  ...steps: Array<WorkflowStepTraceEntry>
): WorkflowStepTrace => {
  return { steps: steps };
};

describe("what the Steps view reads off a Switch / Case step", () => {
  test("the case's output by its name, as the person's own words, and why it was taken", () => {
    const outcome: StepOutcome = getStepOutcome(traceOf(aStep()), 0);

    expect(outcome).toEqual(
      expect.objectContaining({
        kind: StepOutcomeKind.LedTo,
        portTitle: "Critical",
        isPortTitleFromSettings: true,
        portReason: "Case 1 matched: the value is equal to “Critical”.",
      }),
    );
  });

  test("Default is one of the step's own outputs", () => {
    const outcome: StepOutcome = getStepOutcome(
      traceOf(
        aStep({
          executedPort: "default",
          executedPortTitle: "Default",
          executedPortTitleIsFromSettings: undefined,
          executedPortReason:
            "None of the 1 cases matched, so the step took Default.",
          nextSteps: [],
        }),
      ),
      0,
    );

    expect(outcome.isPortTitleFromSettings).toBe(false);
    expect(outcome.kind).toBe(StepOutcomeKind.NothingConnected);
    expect(outcome.portReason).toBe(
      "None of the 1 cases matched, so the step took Default.",
    );
  });

  test("a trace written before these were recorded has no reason, and its titles are labels", () => {
    const outcome: StepOutcome = getStepOutcome(
      traceOf(
        aStep({
          executedPortTitleIsFromSettings: undefined,
          executedPortReason: undefined,
        }),
      ),
      0,
    );

    expect(outcome.portReason).toBeNull();
    expect(outcome.isPortTitleFromSettings).toBe(false);
  });

  test("a title from settings with no title recorded falls back to the port's id, which is not the person's words", () => {
    const outcome: StepOutcome = getStepOutcome(
      traceOf(aStep({ executedPortTitle: undefined })),
      0,
    );

    expect(outcome.portTitle).toBe("Case 1");
    expect(outcome.isPortTitleFromSettings).toBe(false);
  });

  test("anything that is not text in a reason, read back from JSON, is no reason", () => {
    expect(
      getStepOutcome(
        traceOf(aStep({ executedPortReason: 42 as unknown as string })),
        0,
      ).portReason,
    ).toBeNull();
    expect(
      getStepOutcome(traceOf(aStep({ executedPortReason: "" })), 0).portReason,
    ).toBeNull();
  });

  test("a step that took no output has no reason either", () => {
    const outcome: StepOutcome = getStepOutcome(
      traceOf(
        aStep({
          executedPort: null,
          executedPortTitle: undefined,
          status: WorkflowStepStatus.Error,
          errorMessage: 'Switch / Case cannot compare case 1 with "~=".',
        }),
      ),
      0,
    );

    expect(outcome.kind).toBe(StepOutcomeKind.NoPort);
    expect(outcome.portReason).toBeNull();
    expect(outcome.isPortTitleFromSettings).toBe(false);
  });
});

describe("a Switch / Case step in the Steps view", () => {
  afterEach(() => {
    cleanup();
  });

  test("says which case it took and where that led, then why, under it", () => {
    render(<StepTraceViewer trace={traceOf(aStep())} />);

    const outcome: HTMLElement = screen.getByTestId(
      "workflow-run-step-outcome",
    );

    expect(
      within(outcome).getByTestId("workflow-run-step-port"),
    ).toHaveTextContent("Critical");
    expect(outcome).toHaveTextContent("Send Message to Slack");
    expect(screen.getByTestId("workflow-run-step-reason")).toHaveTextContent(
      "Case 1 matched: the value is equal to “Critical”.",
    );
  });

  test("Default, with nothing connected: the branch ended, and none of the cases matched", () => {
    render(
      <StepTraceViewer
        trace={traceOf(
          aStep({
            executedPort: "default",
            executedPortTitle: "Default",
            executedPortTitleIsFromSettings: undefined,
            executedPortReason:
              "None of the 2 cases matched, so the step took Default.",
            nextSteps: [],
          }),
        )}
      />,
    );

    expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
      "Default",
    );
    expect(screen.getByTestId("workflow-run-step-outcome")).toHaveTextContent(
      "Nothing is connected to it, so the run ended here.",
    );
    expect(screen.getByTestId("workflow-run-step-reason")).toHaveTextContent(
      "None of the 2 cases matched, so the step took Default.",
    );
  });

  test("a step that says no reason has no line for one: every other step, as before", () => {
    render(
      <StepTraceViewer
        trace={traceOf(
          aStep({
            componentId: "if-else-1",
            metadataId: "if-else",
            title: "If / Else",
            executedPort: "yes",
            executedPortTitle: "Yes",
            executedPortTitleIsFromSettings: undefined,
            executedPortReason: undefined,
          }),
        )}
      />,
    );

    expect(screen.queryByTestId("workflow-run-step-reason")).toBeNull();
  });
});

type CasesRowFunction = (step: WorkflowStepTraceEntry) => StepValueRow;

// The Received row of a step's cases.
const casesRow: CasesRowFunction = (
  step: WorkflowStepTraceEntry,
): StepValueRow => {
  const row: StepValueRow | undefined = getReceivedRows(step).find(
    (candidate: StepValueRow): boolean => {
      return candidate.id === "cases";
    },
  );

  if (!row) {
    throw new Error("The step received no cases.");
  }

  return row;
};

const TWO_CASES: Array<Record<string, string>> = [
  { id: "case-1", comparison: "==", value: "production", compareAs: "" },
  { id: "case-2", comparison: "==", value: "staging", compareAs: "" },
];

const TWO_CASES_TEXT: string =
  "Case 1: is equal to “production”\nCase 2: is equal to “staging”";

describe("the cases a Switch / Case received", () => {
  afterEach(() => {
    cleanup();
  });

  test("read one case a line, in the words of the reason - not as the list's JSON", () => {
    const row: StepValueRow = casesRow(
      aStep({ argumentValues: { value: "staging", cases: TWO_CASES } }),
    );

    expect(row.name).toBe("Cases");
    expect(row.value).toEqual({
      kind: TraceValueKind.Text,
      text: TWO_CASES_TEXT,
      isBlock: true,
    });
    expect(row.value.text).not.toContain("compareAs");
    expect(row.template).toBeNull();
  });

  test("a number compared as a number reads as itself, and a comparison without a value reads alone", () => {
    expect(
      describeSwitchCasesForTrace([
        { id: "case-1", comparison: ">", value: "500", compareAs: "number" },
        { id: "case-2", comparison: "is empty", value: "", compareAs: "" },
        { id: "case-3", comparison: "contains", value: "timeout" },
      ]),
    ).toBe(
      "Case 1: is greater than 500\nCase 2: is empty\nCase 3: contains “timeout”",
    );
  });

  test("a case that does not say what it compares yet says so", () => {
    expect(
      describeSwitchCasesForTrace([
        { id: "case-1", comparison: "==", value: "", compareAs: "" },
        { id: "case-2", comparison: "~=", value: "x", compareAs: "" },
      ]),
    ).toBe("Case 1: not set up\nCase 2: not set up");
  });

  test("the list kept as JSON text reads the same", () => {
    expect(describeSwitchCasesForTrace(JSON.stringify(TWO_CASES))).toBe(
      TWO_CASES_TEXT,
    );
  });

  test("anything that is not a list of cases is shown as it was", () => {
    for (const notCases of [
      { not: "a list" },
      "not a list",
      [],
      null,
      undefined,
    ]) {
      expect(describeSwitchCasesForTrace(notCases)).toBeNull();
    }

    const row: StepValueRow = casesRow(
      aStep({
        argumentValues: { value: "staging", cases: { not: "a list" } },
      }),
    );

    expect(row.value.kind).toBe(TraceValueKind.Structured);
    expect(row.value.text).toContain('"not": "a list"');
  });

  test("a case compared with a reference: what it received, and what it was set up as", () => {
    const row: StepValueRow = casesRow(
      aStep({
        argumentValues: {
          value: "production",
          cases: [
            {
              id: "case-1",
              comparison: "==",
              value: "production",
              compareAs: "",
            },
          ],
        },
        argumentTemplates: {
          cases: [
            {
              id: "case-1",
              comparison: "==",
              value: "{{local.variables.liveEnvironment}}",
              compareAs: "",
            },
          ],
        },
      }),
    );

    expect(row.value.text).toBe("Case 1: is equal to “production”");
    expect(row.template).toBe("Case 1: is equal to liveEnvironment");
  });

  test("only a Switch / Case's cases: another step's setting of the same name is shown as it was", () => {
    const row: StepValueRow = casesRow(
      aStep({
        componentId: "custom-1",
        metadataId: "javascript",
        title: "Run Custom JavaScript",
        argumentValues: { cases: TWO_CASES },
        argumentNames: [{ id: "cases", name: "cases" }],
      }),
    );

    expect(row.value.kind).toBe(TraceValueKind.Structured);
    expect(row.value.text).toContain('"comparison": "=="');
  });

  test("the Steps view shows them under Received, one a line", () => {
    render(
      <StepTraceViewer
        trace={traceOf(
          aStep({ argumentValues: { value: "staging", cases: TWO_CASES } }),
        )}
      />,
    );

    const card: HTMLElement = screen.getByTestId("workflow-run-step");
    const toggle: HTMLElement = within(card).getByRole("button");

    if (toggle.getAttribute("aria-expanded") !== "true") {
      fireEvent.click(toggle);
    }

    const cases: HTMLElement | undefined = within(card)
      .getAllByTestId("workflow-run-step-value")
      .find((row: HTMLElement): boolean => {
        return (row.textContent || "").startsWith("Cases");
      });

    expect(cases).toBeDefined();
    expect((cases as HTMLElement).querySelector("pre")?.textContent).toBe(
      TWO_CASES_TEXT,
    );
  });
});

describe("in another language", () => {
  beforeAll(async () => {
    await i18next.use(initReactI18next).init({
      lng: "de",
      fallbackLng: false,
      resources: {
        de: {
          translation: {
            // A case's value that happens to be one of the product's words.
            Critical: "Kritisch",
            Default: "Standard",
            "Took {{port}}": "Nahm {{port}}",
          },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
    });
  });

  afterAll(async () => {
    await i18next.changeLanguage("en");
  });

  afterEach(() => {
    cleanup();
  });

  test("a case's output keeps the name the person gave it", () => {
    render(<StepTraceViewer trace={traceOf(aStep())} />);

    expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
      /^Critical$/,
    );
    // The sentence around it is translated as ever.
    expect(screen.getByTestId("workflow-run-step-outcome")).toHaveTextContent(
      "Nahm",
    );
  });

  test("Default, the step's own output, is translated as every product label is", () => {
    render(
      <StepTraceViewer
        trace={traceOf(
          aStep({
            executedPort: "default",
            executedPortTitle: "Default",
            executedPortTitleIsFromSettings: undefined,
            nextSteps: [],
          }),
        )}
      />,
    );

    expect(screen.getByTestId("workflow-run-step-port")).toHaveTextContent(
      /^Standard$/,
    );
  });
});
