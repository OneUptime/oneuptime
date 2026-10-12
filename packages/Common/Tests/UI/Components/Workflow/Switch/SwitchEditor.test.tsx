/*
 * Setting up a Switch / Case, in the real settings: ArgumentsForm, the value
 * picker in the value to check and in every case, the comparison list, the
 * drag-ordered list of cases, Compare as, Default, where each output leads,
 * and the settings dialog around them. Only the API is stood in for.
 *
 * The maintainer asked for "case component in addition to just if/else". The
 * settings are where a person meets it: a value to check, then the cases,
 * each a comparison and a value, checked from the top; each case is an output
 * of the step, so the rows say where each leads, and taking out a case that
 * leads somewhere says that saving disconnects it, with a way to put it back.
 */

// Utils.ts imports the database-model registry, which nothing here needs.
jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
  };
});

jest.mock("../../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

// The variables the picker lists: one of this workflow's.
jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async (args: { modelType: { name?: string } }) => {
        const isVariables: boolean =
          new (args.modelType as unknown as new () => { tableName?: string })()
            .tableName === "WorkflowVariable";

        const data: Array<Record<string, unknown>> = isVariables
          ? [{ name: "CRITICAL", workflowId: "workflow-1", isSecret: false }]
          : [];

        return { data: data, count: data.length, skip: 0, limit: 10 };
      }),
    },
  };
});

import ArgumentsForm from "../../../../../UI/Components/Workflow/ArgumentsForm";
import ComponentSettingsModal from "../../../../../UI/Components/Workflow/ComponentSettingsModal";
import { SWITCH_TEST_IDS } from "../../../../../UI/Components/Workflow/Switch/SwitchEditor";
import { OutputConnections } from "../../../../../UI/Components/Workflow/Switch/SwitchModel";
import {
  editorValue,
  keys,
  placeCaret,
} from "../ValuePicker/ValuePickerTestUtils";
import Dictionary from "../../../../../Types/Dictionary";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import { MAX_SWITCH_CASES } from "../../../../../Types/Workflow/Components/Switch";
import {
  SwitchCase,
  getStarterSwitchCases,
  readSwitchCases,
  toStoredSwitchCases,
} from "../../../../../Types/Workflow/Components/SwitchCases";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  RenderResult,
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

const SEVERITY: string =
  "{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}";

type MetadataFunction = (id: ComponentID) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: ComponentID): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  }) as ComponentMetadata;
};

type StepFunction = (
  id: ComponentID,
  args?: JSONObject,
  stepId?: string,
) => NodeDataProp;

const step: StepFunction = (
  id: ComponentID,
  args: JSONObject = {},
  stepId: string = `${id}-1`,
): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(id);

  return {
    error: "",
    id: stepId,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${stepId}-internal`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const webhook: NodeDataProp = step(ComponentID.Webhook, {}, "webhook-1");

type CaseFunction = (
  id: string,
  comparison: string,
  value?: string,
  compareAs?: string,
) => JSONObject;

const aCase: CaseFunction = (
  id: string,
  comparison: string,
  value: string = "",
  compareAs: string = "text",
): JSONObject => {
  return { id: id, comparison: comparison, value: value, compareAs: compareAs };
};

const SEVERITY_SWITCH: JSONObject = {
  value: SEVERITY,
  cases: [
    aCase("case-1", "==", "Critical Incident"),
    aCase("case-2", "==", "Major Incident"),
  ],
};

const CONNECTIONS: OutputConnections = {
  "case-1": [{ componentId: "slack-critical", title: "Send Message to Slack" }],
  "case-2": [{ componentId: "slack-major", title: "Send Message to Slack" }],
  default: [{ componentId: "log-1", title: "Log" }],
};

interface RenderedSwitch {
  view: RenderResult;
  user: UserEvent;
  onFormChange: MockFunction;
  onErrors: MockFunction;
}

type RenderSwitchFunction = (
  args?: JSONObject,
  connections?: OutputConnections,
) => RenderedSwitch;

// A Switch / Case step's settings, after a Webhook trigger.
const renderSwitch: RenderSwitchFunction = (
  args: JSONObject = {},
  connections?: OutputConnections,
): RenderedSwitch => {
  const node: NodeDataProp = step(ComponentID.Switch, args, "switch-1");
  const onFormChange: MockFunction = getJestMockFunction();
  const onErrors: MockFunction = getJestMockFunction();

  const view: RenderResult = render(
    <ArgumentsForm
      component={node}
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      graphComponents={[webhook, node]}
      valueSources={{
        upstream: [webhook],
        downstreamIds: [],
        hasIncomingConnection: true,
      }}
      outputConnections={connections}
      onHasFormValidationErrors={(errors: Dictionary<boolean>): void => {
        onErrors(errors);
      }}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );

  return {
    view: view,
    user: userEvent.setup({ delay: null }),
    onFormChange: onFormChange,
    onErrors: onErrors,
  };
};

type LastArgumentsFunction = (onFormChange: MockFunction) => JSONObject;

const lastArguments: LastArgumentsFunction = (
  onFormChange: MockFunction,
): JSONObject => {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
    Array<unknown>
  >;
  return (calls[calls.length - 1]![0] as NodeDataProp).arguments;
};

type LastCasesFunction = (onFormChange: MockFunction) => Array<SwitchCase>;

const lastCases: LastCasesFunction = (
  onFormChange: MockFunction,
): Array<SwitchCase> => {
  return readSwitchCases(lastArguments(onFormChange)["cases"]);
};

type LastErrorsFunction = (onErrors: MockFunction) => Dictionary<boolean>;

const lastErrors: LastErrorsFunction = (
  onErrors: MockFunction,
): Dictionary<boolean> => {
  const calls: Array<Array<unknown>> = onErrors.mock.calls as Array<
    Array<unknown>
  >;
  return (calls[calls.length - 1]?.[0] || {}) as Dictionary<boolean>;
};

type RowFunction = (index: number) => HTMLElement;

const row: RowFunction = (index: number): HTMLElement => {
  return screen.getByTestId(`switch-case-${index}`);
};

const rows: () => Array<HTMLElement> = (): Array<HTMLElement> => {
  return screen.queryAllByTestId(/^switch-case-\d+$/);
};

const caseValue: RowFunction = (index: number): HTMLElement => {
  return screen.getByRole("textbox", { name: `Value for case ${index + 1}` });
};

const caseComparison: RowFunction = (index: number): HTMLElement => {
  return screen.getByRole("combobox", {
    name: `Comparison for case ${index + 1}`,
  });
};

const valueToCheck: () => HTMLElement = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Value to check" });
};

type ShownTextFunction = (index: number) => string | null;

// What a case's comparison list shows as chosen.
const comparisonShown: ShownTextFunction = (index: number): string | null => {
  const control: Element | null = caseComparison(index).closest(
    ".ou-select__control",
  );
  const single: Element | null =
    control?.querySelector(".ou-select__single-value") || null;
  return single ? single.textContent : null;
};

type ChooseFunction = (index: number, label: string) => Promise<void>;

// Open a case's comparison list and choose one.
const chooseComparison: ChooseFunction = async (
  index: number,
  label: string,
): Promise<void> => {
  fireEvent.keyDown(caseComparison(index), {
    key: "ArrowDown",
    code: "ArrowDown",
  });

  const option: HTMLElement = await waitFor(() => {
    const found: HTMLElement | undefined = Array.from(
      document.querySelectorAll<HTMLElement>(".ou-select__option"),
    ).find((candidate: HTMLElement) => {
      return candidate.textContent === label;
    });

    if (!found) {
      throw new Error(`No comparison "${label}"`);
    }

    return found;
  });

  fireEvent.click(option);
};

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_DOWN: { keyCode: number; key: string } = {
  keyCode: 40,
  key: "ArrowDown",
};
const ARROW_UP: { keyCode: number; key: string } = {
  keyCode: 38,
  key: "ArrowUp",
};

const wait: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, ms);
    });
  });
};

const press: (
  element: HTMLElement,
  key: { keyCode: number; key: string },
) => Promise<void> = async (
  element: HTMLElement,
  key: { keyCode: number; key: string },
): Promise<void> => {
  await act(async () => {
    fireEvent.keyDown(element, key);
  });
  await wait(30);
};

// Picks the case at `from` up by its grip, moves it, drops it: the keyboard way.
const dragCase: (from: number, steps: number) => Promise<void> = async (
  from: number,
  steps: number,
): Promise<void> => {
  const grip: HTMLElement = within(row(from)).getByTestId("drag-handle");
  grip.focus();

  await press(grip, SPACE);

  for (let i: number = 0; i < Math.abs(steps); i++) {
    await press(grip, steps < 0 ? ARROW_UP : ARROW_DOWN);
  }

  await press(grip, SPACE);
  await wait(400);
};

afterEach(() => {
  cleanup();
});

describe("what the settings show", () => {
  test("the value to check, then the cases in order, each a comparison and a value, then Default", () => {
    renderSwitch(SEVERITY_SWITCH, CONNECTIONS);

    const editor: HTMLElement = screen.getByTestId(SWITCH_TEST_IDS.root);

    expect(editor).toContainElement(valueToCheck());
    expect(rows()).toHaveLength(2);
    expect(comparisonShown(0)).toBe("is equal to");
    expect(editorValue(caseValue(0))).toBe("Critical Incident");
    expect(comparisonShown(1)).toBe("is equal to");
    expect(editorValue(caseValue(1))).toBe("Major Incident");

    const defaultOutput: HTMLElement = screen.getByTestId(
      SWITCH_TEST_IDS.defaultOutput,
    );

    expect(defaultOutput).toHaveTextContent("Default");
    expect(defaultOutput).toHaveTextContent("Runs when no case matches.");
  });

  test("says that the cases are checked from the top and the first match is taken", () => {
    renderSwitch(SEVERITY_SWITCH);

    expect(
      within(screen.getByTestId(SWITCH_TEST_IDS.cases)).getByText(
        "Checked from the top. The first case that matches is taken, and each case is an output on the canvas.",
      ),
    ).toBeInTheDocument();
  });

  test("each case says where its output leads, and Default where it does", () => {
    renderSwitch(SEVERITY_SWITCH, CONNECTIONS);

    expect(screen.getByTestId("switch-case-connection-0")).toHaveTextContent(
      "Send Message to Slack slack-critical",
    );
    expect(screen.getByTestId("switch-case-connection-1")).toHaveTextContent(
      "Send Message to Slack slack-major",
    );
    expect(screen.getByTestId("switch-default-connection")).toHaveTextContent(
      "Log log-1",
    );
  });

  test("an output nothing is connected to says so", () => {
    renderSwitch(SEVERITY_SWITCH, { "case-1": CONNECTIONS["case-1"]! });

    expect(screen.getByTestId("switch-case-connection-1")).toHaveTextContent(
      "Not connected",
    );
    expect(screen.getByTestId("switch-default-connection")).toHaveTextContent(
      "Not connected",
    );
  });

  test("without knowing the canvas, the rows say nothing about where they lead", () => {
    renderSwitch(SEVERITY_SWITCH);

    expect(screen.queryByTestId("switch-case-connection-0")).toBeNull();
    expect(screen.queryByTestId("switch-default-connection")).toBeNull();
  });

  test("the value to check and every case value pick values with { }, as every setting does", () => {
    renderSwitch(SEVERITY_SWITCH);

    expect(
      screen.getByTestId("workflow-argument-value-insert-value"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("switch-case-value-0-insert-value"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("switch-case-value-1-insert-value"),
    ).toBeInTheDocument();
  });

  test("each case can be picked up by its grip, named after its place", () => {
    renderSwitch(SEVERITY_SWITCH);

    expect(
      within(row(0)).getByRole("button", { name: "Drag to reorder Case 1" }),
    ).toBeInTheDocument();
    expect(
      within(row(1)).getByRole("button", { name: "Drag to reorder Case 2" }),
    ).toBeInTheDocument();
  });

  test("the value to check takes the focus as the settings open", () => {
    renderSwitch(SEVERITY_SWITCH);

    expect(valueToCheck()).toHaveFocus();
  });
});

describe("editing the cases", () => {
  test("typing a case's value writes it to that case alone", async () => {
    const { user, onFormChange } = renderSwitch({
      value: SEVERITY,
      cases: toStoredSwitchCases(getStarterSwitchCases()),
    });

    placeCaret(caseValue(1), 0);
    await user.keyboard("Major Incident");

    await waitFor(() => {
      expect(lastCases(onFormChange)).toEqual([
        { id: "case-1", comparison: "==", value: "", compareAs: "text" },
        {
          id: "case-2",
          comparison: "==",
          value: "Major Incident",
          compareAs: "text",
        },
      ]);
    });
    expect(lastArguments(onFormChange)["value"]).toBe(SEVERITY);
  });

  test("typing {{ in a case offers the values, as in every other setting", async () => {
    const { user } = renderSwitch(SEVERITY_SWITCH);

    placeCaret(caseValue(0), 0);
    await user.keyboard(keys("{{"));

    await waitFor(() => {
      expect(screen.getAllByRole("option").length).toBeGreaterThan(0);
    });
  });

  test("a number comparison compares numbers, as in If / Else", async () => {
    const { onFormChange } = renderSwitch(SEVERITY_SWITCH);

    await chooseComparison(0, "is greater than");

    await waitFor(() => {
      expect(lastCases(onFormChange)[0]).toEqual({
        id: "case-1",
        comparison: ">",
        value: "Critical Incident",
        compareAs: "number",
      });
    });
  });

  test("is empty takes the value away, and choosing a comparison with one puts it back", async () => {
    const { onFormChange } = renderSwitch(SEVERITY_SWITCH);

    await chooseComparison(0, "is empty");

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Value for case 1" }),
      ).toBeNull();
    });
    expect(lastCases(onFormChange)[0]).toEqual(
      expect.objectContaining({ comparison: "is empty", value: "" }),
    );

    await chooseComparison(0, "contains");

    await waitFor(() => {
      expect(lastCases(onFormChange)[0]).toEqual(
        expect.objectContaining({
          comparison: "contains",
          value: "Critical Incident",
        }),
      );
    });
    expect(editorValue(caseValue(0))).toBe("Critical Incident");
  });

  test("is true needs no value: it compares true or false", async () => {
    const { onFormChange } = renderSwitch(SEVERITY_SWITCH);

    await chooseComparison(1, "is true");

    await waitFor(() => {
      expect(lastCases(onFormChange)[1]).toEqual({
        id: "case-2",
        comparison: "==",
        value: "true",
        compareAs: "boolean",
      });
    });
    expect(
      screen.queryByRole("textbox", { name: "Value for case 2" }),
    ).toBeNull();
  });

  test("Add case adds an empty is-equal-to case at the end, with a new id, ready to type into", async () => {
    const { user, onFormChange } = renderSwitch(SEVERITY_SWITCH);

    await user.click(screen.getByTestId(SWITCH_TEST_IDS.addCase));

    await waitFor(() => {
      expect(rows()).toHaveLength(3);
    });
    expect(lastCases(onFormChange)[2]).toEqual({
      id: "case-3",
      comparison: "==",
      value: "",
      compareAs: "text",
    });
    await waitFor(() => {
      expect(caseValue(2)).toHaveFocus();
    });
  });

  test("a case added after one was removed never takes the removed one's id", async () => {
    const { user, onFormChange } = renderSwitch({
      value: SEVERITY,
      cases: [
        aCase("case-1", "==", "a"),
        aCase("case-2", "==", "b"),
        aCase("case-3", "==", "c"),
      ],
    });

    await user.click(screen.getByTestId("switch-case-remove-2"));
    await user.click(screen.getByTestId(SWITCH_TEST_IDS.addCase));

    await waitFor(() => {
      expect(
        lastCases(onFormChange).map((switchCase: SwitchCase): string => {
          return switchCase.id;
        }),
      ).toEqual(["case-1", "case-2", "case-4"]);
    });
  });

  test("removing a case takes it out of the list", async () => {
    const { user, onFormChange } = renderSwitch(SEVERITY_SWITCH);

    await user.click(screen.getByRole("button", { name: "Remove case 1" }));

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(lastCases(onFormChange)).toEqual([
      aCase("case-2", "==", "Major Incident"),
    ]);
  });

  test("a case dragged by its grip moves, keeping its id, so its connection follows it", async () => {
    const { onFormChange } = renderSwitch({
      value: SEVERITY,
      cases: [
        aCase("case-1", "==", "a"),
        aCase("case-2", "==", "b"),
        aCase("case-3", "==", "c"),
      ],
    });

    await dragCase(0, 2);

    await waitFor(() => {
      expect(
        lastCases(onFormChange).map((switchCase: SwitchCase): string => {
          return `${switchCase.id}:${switchCase.value}`;
        }),
      ).toEqual(["case-2:b", "case-3:c", "case-1:a"]);
    });
  });

  test("no more than the most a step holds", async () => {
    const cases: Array<JSONObject> = Array.from(
      { length: MAX_SWITCH_CASES },
      (_value: unknown, index: number): JSONObject => {
        return aCase(`case-${index + 1}`, "==", `value ${index + 1}`);
      },
    );

    renderSwitch({ value: SEVERITY, cases: cases });

    expect(screen.getByTestId(SWITCH_TEST_IDS.addCase)).toBeDisabled();
    expect(
      screen.getByText(`A step holds at most ${MAX_SWITCH_CASES} cases.`),
    ).toBeInTheDocument();
  });
});

describe("taking out a case that leads somewhere", () => {
  test("says saving disconnects it, naming the step it led to", async () => {
    const { user } = renderSwitch(SEVERITY_SWITCH, CONNECTIONS);

    expect(screen.queryByTestId(SWITCH_TEST_IDS.removedCases)).toBeNull();

    await user.click(screen.getByTestId("switch-case-remove-0"));

    const notice: HTMLElement = await screen.findByTestId(
      SWITCH_TEST_IDS.removedCases,
    );

    expect(notice).toHaveTextContent(
      "Saving removes the connections of the cases you took out",
    );
    expect(notice).toHaveTextContent(
      "Case “Critical Incident” led to Send Message to Slack (slack-critical).",
    );
    expect(notice).toHaveAttribute("role", "status");
  });

  test("Put back puts the case back where it was, and the notice goes", async () => {
    const { user, onFormChange } = renderSwitch(SEVERITY_SWITCH, CONNECTIONS);

    await user.click(screen.getByTestId("switch-case-remove-0"));
    await user.click(
      await screen.findByRole("button", {
        name: "Put case “Critical Incident” back",
      }),
    );

    await waitFor(() => {
      expect(screen.queryByTestId(SWITCH_TEST_IDS.removedCases)).toBeNull();
    });
    expect(lastCases(onFormChange)).toEqual(
      readSwitchCases(SEVERITY_SWITCH["cases"]),
    );
  });

  test("a case that led nowhere goes without a notice", async () => {
    const { user } = renderSwitch(SEVERITY_SWITCH, {
      "case-2": CONNECTIONS["case-2"]!,
    });

    await user.click(screen.getByTestId("switch-case-remove-0"));

    await waitFor(() => {
      expect(rows()).toHaveLength(1);
    });
    expect(screen.queryByTestId(SWITCH_TEST_IDS.removedCases)).toBeNull();
  });

  test("a case renamed keeps its output and its connection: no notice", async () => {
    const { user } = renderSwitch(SEVERITY_SWITCH, CONNECTIONS);

    placeCaret(caseValue(0), 0);
    await user.keyboard("Very ");

    await waitFor(() => {
      expect(editorValue(caseValue(0))).toBe("Very Critical Incident");
    });
    expect(screen.queryByTestId(SWITCH_TEST_IDS.removedCases)).toBeNull();
  });
});

describe("Compare as, case by case", () => {
  test("folded, and saying how the cases compare", () => {
    renderSwitch({
      value: SEVERITY,
      cases: [
        aCase("case-1", "<", "300", "number"),
        aCase("case-2", "<", "500", "number"),
      ],
    });

    const compareAs: HTMLElement = screen.getByTestId(
      SWITCH_TEST_IDS.compareAs,
    );

    expect(compareAs).toHaveTextContent("Compare as");
    expect(compareAs).toHaveTextContent("Number");
    // Folded: the choices stay mounted, but out of sight and out of reach.
    expect(within(compareAs).getByRole("button")).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  });

  test("Mixed when the cases compare different ways", () => {
    renderSwitch({
      value: SEVERITY,
      cases: [
        aCase("case-1", "<", "300", "number"),
        aCase("case-2", "==", "n/a", "text"),
      ],
    });

    expect(screen.getByTestId(SWITCH_TEST_IDS.compareAs)).toHaveTextContent(
      "Mixed",
    );
  });

  test("opened, each case that it decides something for can be changed on its own", async () => {
    const { user, onFormChange } = renderSwitch({
      value: SEVERITY,
      cases: [
        aCase("case-1", "==", "200"),
        aCase("case-2", "is empty"),
        aCase("case-3", "==", "404"),
      ],
    });

    await user.click(
      within(screen.getByTestId(SWITCH_TEST_IDS.compareAs)).getByRole("button"),
    );

    // is empty has nothing to compare as.
    expect(screen.getByTestId("switch-compare-as-0")).toBeInTheDocument();
    expect(screen.queryByTestId("switch-compare-as-1")).toBeNull();
    expect(screen.getByTestId("switch-compare-as-2")).toBeInTheDocument();

    await user.click(screen.getByTestId("switch-compare-as-2-number"));

    await waitFor(() => {
      expect(lastCases(onFormChange)[2]).toEqual(
        aCase("case-3", "==", "404", "number"),
      );
    });
    expect(lastCases(onFormChange)[0]).toEqual(aCase("case-1", "==", "200"));
  });

  test("not shown when no case compares a value", () => {
    renderSwitch({
      value: SEVERITY,
      cases: [aCase("case-1", "is empty"), aCase("case-2", "is not empty")],
    });

    expect(screen.queryByTestId(SWITCH_TEST_IDS.compareAs)).toBeNull();
  });
});

describe("what has to be filled in before saving", () => {
  test("a step that is set up can be saved", async () => {
    const { onErrors } = renderSwitch(SEVERITY_SWITCH);

    await waitFor(() => {
      expect(lastErrors(onErrors)["arguments"]).toBe(false);
    });
  });

  test("a new step cannot: nothing to check, and its starter cases are empty", async () => {
    const { onErrors } = renderSwitch({
      cases: toStoredSwitchCases(getStarterSwitchCases()),
    });

    await waitFor(() => {
      expect(lastErrors(onErrors)["arguments"]).toBe(true);
    });
  });

  test("filling in every case lets it be saved", async () => {
    const { user, onErrors } = renderSwitch({
      value: SEVERITY,
      cases: [aCase("case-1", "==")],
    });

    await waitFor(() => {
      expect(lastErrors(onErrors)["arguments"]).toBe(true);
    });

    placeCaret(caseValue(0), 0);
    await user.keyboard("Critical Incident");

    await waitFor(() => {
      expect(lastErrors(onErrors)["arguments"]).toBe(false);
    });
  });

  test("a case says what it needs once it has been left", async () => {
    const { user } = renderSwitch({
      value: SEVERITY,
      cases: [aCase("case-1", "==")],
    });

    expect(screen.queryByText("Type or pick what to compare with.")).toBeNull();

    // Going to its { } button is not leaving the field.
    placeCaret(caseValue(0), 0);
    await user.tab();

    expect(screen.queryByText("Type or pick what to compare with.")).toBeNull();

    fireEvent.blur(caseValue(0));

    expect(
      await screen.findByText("Type or pick what to compare with."),
    ).toBeInTheDocument();
  });

  test("the value to check says what it needs once it has been left", async () => {
    renderSwitch({ cases: [aCase("case-1", "==", "a")] });

    expect(screen.queryByText("Pick or type the value to check.")).toBeNull();

    fireEvent.blur(valueToCheck());

    expect(
      await screen.findByText("Pick or type the value to check."),
    ).toBeInTheDocument();
  });

  test("a step with no case at all cannot be saved, and says to add one", async () => {
    const { user, onErrors } = renderSwitch({
      value: SEVERITY,
      cases: [aCase("case-1", "==", "a")],
    });

    await user.click(screen.getByTestId("switch-case-remove-0"));

    expect(
      await screen.findByTestId(SWITCH_TEST_IDS.noCases),
    ).toHaveTextContent("Add a case for each way the workflow can go.");
    await waitFor(() => {
      expect(lastErrors(onErrors)["arguments"]).toBe(true);
    });
  });
});

describe("in the settings dialog", () => {
  type RenderDialogFunction = (
    args: JSONObject,
    connections?: OutputConnections,
  ) => { onSave: MockFunction; user: UserEvent };

  const renderDialog: RenderDialogFunction = (
    args: JSONObject,
    connections?: OutputConnections,
  ): { onSave: MockFunction; user: UserEvent } => {
    const node: NodeDataProp = step(ComponentID.Switch, args, "switch-1");
    const onSave: MockFunction = getJestMockFunction();

    render(
      <ComponentSettingsModal
        title="Switch / Case"
        description="Compares one value with each case in turn."
        component={node}
        graphComponents={[webhook, node]}
        workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
        outputConnections={connections}
        onClose={() => {}}
        onDelete={() => {}}
        onSave={(component: NodeDataProp) => {
          onSave(component);
        }}
      />,
    );

    return { onSave: onSave, user: userEvent.setup({ delay: null }) };
  };

  type OutputTitlesFunction = () => Array<string>;

  const outputTitles: OutputTitlesFunction = (): Array<string> => {
    return within(screen.getByTestId("workflow-component-section-outputs"))
      .getAllByTestId("workflow-port")
      .map((port: HTMLElement): string => {
        return port.querySelector("p")?.textContent || "";
      });
  };

  test("Outputs lists a case's output for each case, named after it, then Default", () => {
    renderDialog(SEVERITY_SWITCH);

    expect(outputTitles()).toEqual([
      "Critical Incident",
      "Major Incident",
      "Default",
    ]);
  });

  test("Outputs follow the cases as they are edited, before anything is saved", async () => {
    const { user } = renderDialog(SEVERITY_SWITCH);

    await user.click(screen.getByTestId(SWITCH_TEST_IDS.addCase));
    placeCaret(caseValue(2), 0);
    await user.keyboard("Minor Incident");

    await waitFor(() => {
      expect(outputTitles()).toEqual([
        "Critical Incident",
        "Major Incident",
        "Minor Incident",
        "Default",
      ]);
    });

    await user.click(screen.getByTestId("switch-case-remove-0"));

    await waitFor(() => {
      expect(outputTitles()).toEqual([
        "Major Incident",
        "Minor Incident",
        "Default",
      ]);
    });
  });

  test("Save hands back the cases as they were edited", async () => {
    const { user, onSave } = renderDialog(SEVERITY_SWITCH, CONNECTIONS);

    await user.click(screen.getByTestId("switch-case-remove-1"));

    // The dialog has the edit once its Outputs show it.
    await waitFor(() => {
      expect(outputTitles()).toEqual(["Critical Incident", "Default"]);
    });

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onSave).toHaveBeenCalledTimes(1);

    const saved: NodeDataProp = (
      onSave.mock.calls[0] as Array<unknown>
    )[0] as NodeDataProp;

    expect(readSwitchCases(saved.arguments["cases"])).toEqual([
      readSwitchCases(SEVERITY_SWITCH["cases"])[0],
    ]);
    expect(saved.arguments["value"]).toBe(SEVERITY);
  });

  test("Save is off while a case still needs a value, and says why", async () => {
    renderDialog({ value: SEVERITY, cases: [aCase("case-1", "==")] });

    await waitFor(() => {
      expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    });
    expect(
      screen.getByText("Some settings need fixing before this can be saved."),
    ).toBeInTheDocument();
  });

  test("the settings are titled as every step's are", () => {
    renderDialog(SEVERITY_SWITCH);

    expect(
      screen.getByTestId("workflow-component-section-settings"),
    ).toHaveTextContent("Settings");
  });
});
