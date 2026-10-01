/*
 * Building an If / Else condition, in the real settings: ArgumentsForm, the
 * value picker in both values, the comparison list, Compare as, the Yes / No
 * lines and the settings dialog around them. Only the API is stood in for.
 *
 * The maintainer's words: "How can we make this UI better. Its extremely
 * hard to understand and use." It was five stacked fields (Input 1 Type,
 * Input 1, Operator, Input 2 Type, Input 2), each with "Pick this value from
 * other component or from variable" under it. These hold the sentence that
 * replaced them - If [value to check] [comparison] [compare with] - and that
 * every workflow already saved still opens as it is.
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

// The variables the picker lists: one of this workflow's and one global.
jest.mock("../../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async (args: { modelType: { name?: string } }) => {
        const isVariables: boolean =
          new (args.modelType as unknown as new () => { tableName?: string })()
            .tableName === "WorkflowVariable";

        const data: Array<Record<string, unknown>> = isVariables
          ? [
              { name: "DEPLOY_ENV", workflowId: "workflow-1", isSecret: false },
              { name: "API_KEY", workflowId: null, isSecret: true },
            ]
          : [];

        return { data: data, count: data.length, skip: 0, limit: 10 };
      }),
    },
  };
});

import ArgumentsForm from "../../../../../UI/Components/Workflow/ArgumentsForm";
import ComponentSettingsModal from "../../../../../UI/Components/Workflow/ComponentSettingsModal";
import { CHOOSE_FROM_LIST_LABEL } from "../../../../../UI/Components/Workflow/Condition/ConditionEditor";
import {
  chipsIn,
  editorValue,
  keys,
  placeCaret,
} from "../ValuePicker/ValuePickerTestUtils";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import Dictionary from "../../../../../Types/Dictionary";
import Components from "../../../../../Types/Workflow/Components";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React from "react";
import "@testing-library/jest-dom";
import {
  RenderResult,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import { afterEach, describe, expect, test } from "@jest/globals";

const ENVIRONMENT: string =
  "{{local.components.webhook-1.returnValues.request-body.environment}}";
const WEBHOOK_BODY: string =
  "{{local.components.webhook-1.returnValues.request-body}}";
const DEPLOY_ENV: string = "{{local.variables.DEPLOY_ENV}}";

// The If / Else of the "branch on a webhook" template, as stored.
const PRODUCTION_CHECK: JSONObject = {
  "input-1-type": "text",
  "input-1": ENVIRONMENT,
  operator: "==",
  "input-2-type": "text",
  "input-2": "production",
};

// Every Jira template's check of its script's decision, as stored.
const PROCEED_CHECK: JSONObject = {
  "input-1-type": "boolean",
  "input-1": "{{local.components.webhook-1.returnValues.request-body.proceed}}",
  operator: "==",
  "input-2-type": "boolean",
  "input-2": true,
};

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

interface RenderedStep {
  view: RenderResult;
  user: UserEvent;
  onFormChange: MockFunction;
  onErrors: MockFunction;
}

type RenderConditionFunction = (args?: JSONObject) => RenderedStep;

// An If / Else step's settings, after a Webhook trigger.
const renderCondition: RenderConditionFunction = (
  args: JSONObject = {},
): RenderedStep => {
  const node: NodeDataProp = step(ComponentID.IfElse, args, "if-else-1");
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

type LastErrorsFunction = (onErrors: MockFunction) => Dictionary<boolean>;

const lastErrors: LastErrorsFunction = (
  onErrors: MockFunction,
): Dictionary<boolean> => {
  const calls: Array<Array<unknown>> = onErrors.mock.calls as Array<
    Array<unknown>
  >;
  return (calls[calls.length - 1]?.[0] || {}) as Dictionary<boolean>;
};

type ElementFunction = () => HTMLElement;

const valueToCheck: ElementFunction = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Value to check" });
};

const compareWith: ElementFunction = (): HTMLElement => {
  return screen.getByRole("textbox", { name: "Compare with" });
};

const comparison: ElementFunction = (): HTMLElement => {
  return screen.getByRole("combobox", { name: "Comparison" });
};

const summaryYes: ElementFunction = (): HTMLElement => {
  return screen.getByTestId("if-else-summary-yes");
};

type ShownTextFunction = () => string | null;

// What the comparison list shows as chosen: its words, or null for none.
const comparisonShown: ShownTextFunction = (): string | null => {
  const control: Element | null = comparison().closest(".ou-select__control");
  const single: Element | null =
    control?.querySelector(".ou-select__single-value") || null;
  return single ? single.textContent : null;
};

type ChooseFunction = (label: string) => Promise<void>;

// Open the comparison list and choose one.
const chooseComparison: ChooseFunction = async (
  label: string,
): Promise<void> => {
  fireEvent.keyDown(comparison(), { key: "ArrowDown", code: "ArrowDown" });

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

type PickFunction = (reference: string) => Promise<void>;

// Pick a value from the open list.
const pick: PickFunction = async (reference: string): Promise<void> => {
  const option: HTMLElement = await waitFor(() => {
    const found: HTMLElement | undefined = screen
      .getAllByRole("option")
      .find((candidate: HTMLElement) => {
        return candidate.getAttribute("data-reference") === reference;
      });

    if (!found) {
      throw new Error(`No option for ${reference}`);
    }

    return found;
  });

  fireEvent.click(option);
};

type CompareAsHeaderFunction = () => HTMLElement;

const compareAsHeader: CompareAsHeaderFunction = (): HTMLElement => {
  return within(screen.getByTestId("if-else-compare-as")).getByRole("button");
};

afterEach(() => {
  cleanup();
});

describe("If / Else reads as a sentence", () => {
  test("If, the value to check, the comparison and what to compare with", () => {
    renderCondition();

    const condition: HTMLElement = screen.getByTestId("if-else-condition");

    expect(within(condition).getByText("If")).toBeInTheDocument();
    expect(condition).toContainElement(valueToCheck());
    expect(condition).toContainElement(comparison());
    expect(condition).toContainElement(compareWith());

    // Both values are picked the same way as every other setting's.
    expect(
      screen.getByTestId("workflow-argument-input-1-insert-value"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workflow-argument-input-2-insert-value"),
    ).toBeInTheDocument();
  });

  test("nothing of the old form is left: no Input 1, no types up front, no links", () => {
    renderCondition(PRODUCTION_CHECK);

    const text: string = document.body.textContent || "";

    expect(text).not.toMatch(/Input 1|Input 2|Operator|Type \(Optional\)/);
    expect(text).not.toMatch(/Pick this value from other component/);
    expect(text).not.toMatch(/Null|Undefined|Boolean/);
    expect(screen.queryByRole("button", { name: "component" })).toBeNull();
  });

  test("a new step starts on is equal to, and it is stored", async () => {
    const { onFormChange } = renderCondition();

    expect(comparisonShown()).toBe("is equal to");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["operator"]).toBe("==");
    });
  });

  test("Yes and No say where the run goes, read back from the condition", () => {
    renderCondition(PRODUCTION_CHECK);

    expect(summaryYes()).toHaveTextContent(
      "when Webhook›Request Body›environment is equal to “production”.",
    );
    expect(screen.getByTestId("if-else-summary-no")).toHaveTextContent(
      "otherwise.",
    );
    expect(
      within(screen.getByTestId("if-else-summary")).getByText("Yes"),
    ).toBeInTheDocument();
    expect(
      within(screen.getByTestId("if-else-summary")).getByText("No"),
    ).toBeInTheDocument();
  });

  test("a new step's sentence says what is still to be set", () => {
    renderCondition();

    expect(summaryYes()).toHaveTextContent(
      "when the value to check is equal to the value to compare with.",
    );
  });

  test("the value to check takes the focus as the settings open", async () => {
    renderCondition();

    await waitFor(() => {
      expect(valueToCheck()).toHaveFocus();
    });
  });

  test("the comparisons are in words, grouped by what they compare", async () => {
    renderCondition();

    fireEvent.keyDown(comparison(), { key: "ArrowDown", code: "ArrowDown" });

    await waitFor(() => {
      expect(
        document.querySelectorAll(".ou-select__option").length,
      ).toBeGreaterThan(0);
    });

    expect(
      Array.from(document.querySelectorAll(".ou-select__option")).map(
        (option: Element) => {
          return option.textContent;
        },
      ),
    ).toEqual([
      "is equal to",
      "is not equal to",
      "contains",
      "does not contain",
      "starts with",
      "ends with",
      "is greater than",
      "is greater than or equal to",
      "is less than",
      "is less than or equal to",
      "is empty",
      "is not empty",
      "is true",
      "is false",
    ]);
    expect(
      Array.from(document.querySelectorAll(".ou-select__group-heading")).map(
        (heading: Element) => {
          return heading.textContent;
        },
      ),
    ).toEqual(["Text", "Numbers", "Empty or not", "True or false"]);
  });
});

describe("building a condition", () => {
  test("typing what to compare with", async () => {
    const { user, onFormChange } = renderCondition({
      "input-1": ENVIRONMENT,
    });

    placeCaret(compareWith(), 0);
    await user.keyboard("production");

    await waitFor(() => {
      expect(lastArguments(onFormChange)).toEqual(
        expect.objectContaining({
          "input-1": ENVIRONMENT,
          operator: "==",
          "input-2": "production",
        }),
      );
    });
    expect(summaryYes()).toHaveTextContent("is equal to “production”.");
  });

  test("{ } picks the value to check, shown as a chip", async () => {
    const { user, onFormChange } = renderCondition();

    await user.click(
      screen.getByTestId("workflow-argument-input-1-insert-value"),
    );
    await pick(WEBHOOK_BODY);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["input-1"]).toBe(WEBHOOK_BODY);
    });
    expect(chipsIn(valueToCheck())).toHaveLength(1);
    expect(chipsIn(valueToCheck())[0]).toHaveTextContent(
      "Webhook›Request Body",
    );
    // The sentence names it the same way.
    expect(
      within(summaryYes()).getByTestId("if-else-summary-reference"),
    ).toHaveTextContent("Webhook›Request Body");
  });

  test("{ } picks what to compare with too: a variable", async () => {
    const { user, onFormChange } = renderCondition({ "input-1": ENVIRONMENT });

    await user.click(
      screen.getByTestId("workflow-argument-input-2-insert-value"),
    );
    await pick(DEPLOY_ENV);

    await waitFor(() => {
      expect(lastArguments(onFormChange)["input-2"]).toBe(DEPLOY_ENV);
    });
    expect(chipsIn(compareWith())[0]).toHaveTextContent("Variable›DEPLOY_ENV");
  });

  test("typing {{ offers the values, as in every other setting", async () => {
    const { user, onFormChange } = renderCondition();

    placeCaret(valueToCheck(), 0);
    await user.keyboard(keys("{{request bo"));

    expect(screen.getByTestId("value-picker-inline")).toBeInTheDocument();

    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(lastArguments(onFormChange)["input-1"]).toBe(WEBHOOK_BODY);
    });
  });

  test("a number comparison compares numbers, and says so", async () => {
    const { onFormChange } = renderCondition({
      "input-1": ENVIRONMENT,
      "input-2": "400",
    });

    await chooseComparison("is greater than or equal to");

    await waitFor(() => {
      expect(lastArguments(onFormChange)).toEqual(
        expect.objectContaining({
          operator: ">=",
          "input-1-type": "number",
          "input-2-type": "number",
        }),
      );
    });
    expect(comparisonShown()).toBe("is greater than or equal to");
    expect(screen.getByTestId("if-else-compare-as")).toHaveTextContent(
      "Compare asNumber",
    );
    expect(summaryYes()).toHaveTextContent(
      "is greater than or equal to 400, compared as numbers.",
    );
  });

  test("a text comparison compares text", async () => {
    const { onFormChange } = renderCondition({
      "input-1": ENVIRONMENT,
      operator: ">",
      "input-2": "9",
      "input-1-type": "number",
      "input-2-type": "number",
    });

    await chooseComparison("contains");

    await waitFor(() => {
      expect(lastArguments(onFormChange)).toEqual(
        expect.objectContaining({
          operator: "contains",
          "input-1-type": "text",
          "input-2-type": "text",
        }),
      );
    });
    // Contains compares text, so there is nothing to choose.
    expect(screen.queryByTestId("if-else-compare-as")).toBeNull();
  });

  test("is empty needs no Compare with, and choosing back brings it back", async () => {
    const { onFormChange, onErrors } = renderCondition(PRODUCTION_CHECK);

    await chooseComparison("is empty");

    await waitFor(() => {
      expect(
        screen.queryByRole("textbox", { name: "Compare with" }),
      ).toBeNull();
    });
    expect(lastArguments(onFormChange)).toEqual(
      expect.objectContaining({ operator: "is empty", "input-2": "" }),
    );
    expect(summaryYes()).toHaveTextContent(
      "when Webhook›Request Body›environment is empty.",
    );
    expect(lastErrors(onErrors)).toEqual({ arguments: false });

    await chooseComparison("is equal to");

    await waitFor(() => {
      expect(editorValue(compareWith())).toBe("production");
    });
    expect(lastArguments(onFormChange)).toEqual(
      expect.objectContaining({ operator: "==", "input-2": "production" }),
    );
  });

  test("is true sets what it compares with itself", async () => {
    const { onFormChange } = renderCondition(PRODUCTION_CHECK);

    await chooseComparison("is true");

    await waitFor(() => {
      expect(lastArguments(onFormChange)).toEqual(
        expect.objectContaining({
          operator: "==",
          "input-2": "true",
          "input-1-type": "boolean",
          "input-2-type": "boolean",
        }),
      );
    });
    expect(screen.queryByRole("textbox", { name: "Compare with" })).toBeNull();
    expect(screen.queryByTestId("if-else-compare-as")).toBeNull();
    expect(summaryYes()).toHaveTextContent(
      "when Webhook›Request Body›environment is true.",
    );
  });

  test("Compare as is folded away, showing its choice, and opens to change it", async () => {
    const { user, onFormChange } = renderCondition(PRODUCTION_CHECK);

    expect(compareAsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(compareAsHeader()).toHaveTextContent("Compare asText");

    await user.click(compareAsHeader());

    expect(compareAsHeader()).toHaveAttribute("aria-expanded", "true");

    const options: HTMLElement = screen.getByRole("radiogroup", {
      name: "Compare as",
    });
    expect(
      within(options)
        .getAllByRole("radio")
        .map((radio: HTMLElement) => {
          return radio.closest("label")?.textContent;
        }),
    ).toEqual(["Text", "Number", "True / False"]);
    expect(within(options).getByRole("radio", { name: "Text" })).toBeChecked();
    expect(screen.getByTestId("if-else-compare-as")).toHaveTextContent(
      'capital letters count: "Error" is not "error".',
    );

    await user.click(within(options).getByRole("radio", { name: "Number" }));

    await waitFor(() => {
      expect(lastArguments(onFormChange)).toEqual(
        expect.objectContaining({
          "input-1-type": "number",
          "input-2-type": "number",
        }),
      );
    });
    expect(
      within(options).getByRole("radio", { name: "Number" }),
    ).toBeChecked();
    expect(summaryYes()).toHaveTextContent("compared as numbers.");
  });

  test("text typed where a number is compared says what it will count as", () => {
    renderCondition({
      "input-1": ENVIRONMENT,
      operator: ">",
      "input-2": "abc",
      "input-1-type": "number",
      "input-2-type": "number",
    });

    expect(screen.getByTestId("if-else-notes")).toHaveTextContent(
      '"abc" is not a number, so it is compared as 0.',
    );
  });
});

describe("what has to be filled in", () => {
  test("a new step cannot be saved, and says nothing until a field is left", async () => {
    const { onErrors } = renderCondition();

    await waitFor(() => {
      expect(lastErrors(onErrors)).toEqual({ arguments: true });
    });
    expect(screen.queryByText("Pick or type the value to check.")).toBeNull();

    fireEvent.focus(valueToCheck());
    fireEvent.blur(valueToCheck());

    await waitFor(() => {
      expect(
        screen.getByText("Pick or type the value to check."),
      ).toBeInTheDocument();
    });
    expect(valueToCheck()).toHaveAttribute("aria-invalid", "true");

    fireEvent.focus(compareWith());
    fireEvent.blur(compareWith());

    await waitFor(() => {
      expect(
        screen.getByText("Type or pick what to compare with."),
      ).toBeInTheDocument();
    });
  });

  test("filled in, it can be saved", async () => {
    const { user, onErrors } = renderCondition();

    placeCaret(valueToCheck(), 0);
    await user.keyboard("staging");
    placeCaret(compareWith(), 0);
    await user.keyboard("production");

    await waitFor(() => {
      expect(lastErrors(onErrors)).toEqual({ arguments: false });
    });
  });

  test("a comparison the step does not know is shown as none, and must be chosen", async () => {
    const { onErrors, onFormChange } = renderCondition({
      ...PRODUCTION_CHECK,
      operator: "~=",
    });

    expect(comparisonShown()).toBeNull();
    expect(comparison().closest(".ou-select__control")).toHaveTextContent(
      "Choose a comparison",
    );
    await waitFor(() => {
      expect(lastErrors(onErrors)).toEqual({ arguments: true });
    });

    await chooseComparison("is not equal to");

    await waitFor(() => {
      expect(lastErrors(onErrors)).toEqual({ arguments: false });
    });
    expect(lastArguments(onFormChange)["operator"]).toBe("!=");
  });
});

describe("workflows saved before open as they are", () => {
  test("the template's production check, untouched", async () => {
    const { onFormChange, onErrors } = renderCondition(PRODUCTION_CHECK);

    expect(chipsIn(valueToCheck())).toHaveLength(1);
    expect(chipsIn(valueToCheck())[0]).toHaveTextContent(
      "Webhook›Request Body›environment",
    );
    expect(comparisonShown()).toBe("is equal to");
    expect(editorValue(compareWith())).toBe("production");

    await waitFor(() => {
      expect(lastErrors(onErrors)).toEqual({ arguments: false });
    });
    // Opening it writes nothing new.
    expect(lastArguments(onFormChange)).toEqual(PRODUCTION_CHECK);
  });

  test("a script's proceed flag reads is true", async () => {
    const { onFormChange } = renderCondition(PROCEED_CHECK);

    expect(comparisonShown()).toBe("is true");
    expect(screen.queryByRole("textbox", { name: "Compare with" })).toBeNull();
    expect(summaryYes()).toHaveTextContent("is true.");
    expect(lastArguments(onFormChange)).toEqual(PROCEED_CHECK);
  });

  test("=== reads as is equal to and is stored as it was", () => {
    const { onFormChange } = renderCondition({
      ...PRODUCTION_CHECK,
      operator: "===",
    });

    expect(comparisonShown()).toBe("is equal to");
    expect(lastArguments(onFormChange)["operator"]).toBe("===");
  });

  test("a value compared as Null opens with Compare as showing what that does", async () => {
    const { user, onFormChange } = renderCondition({
      ...PRODUCTION_CHECK,
      "input-2-type": "null",
    });

    expect(compareAsHeader()).toHaveAttribute("aria-expanded", "true");

    const options: HTMLElement = screen.getByRole("radiogroup", {
      name: "Compare as",
    });
    for (const radio of within(options).getAllByRole("radio")) {
      expect(radio).not.toBeChecked();
    }

    expect(screen.getByTestId("if-else-notes")).toHaveTextContent(
      "Compare with is compared as null, which ignores what it holds.",
    );
    expect(lastArguments(onFormChange)["input-2-type"]).toBe("null");

    await user.click(within(options).getByRole("radio", { name: "Text" }));

    await waitFor(() => {
      expect(lastArguments(onFormChange)).toEqual(
        expect.objectContaining({
          "input-1-type": "text",
          "input-2-type": "text",
        }),
      );
    });
    expect(screen.queryByTestId("if-else-notes")).toBeNull();
  });

  test("a comparison taken from a reference is shown as one, and can be chosen from the list instead", async () => {
    const { user, onFormChange } = renderCondition({
      ...PRODUCTION_CHECK,
      operator: DEPLOY_ENV,
    });

    const box: HTMLElement = screen.getByRole("textbox", {
      name: "Comparison",
    });
    expect(chipsIn(box)).toHaveLength(1);
    expect(screen.queryByRole("combobox", { name: "Comparison" })).toBeNull();

    await user.click(
      screen.getByRole("button", { name: CHOOSE_FROM_LIST_LABEL }),
    );

    await waitFor(() => {
      expect(comparisonShown()).toBe("is equal to");
    });
    expect(lastArguments(onFormChange)["operator"]).toBe("==");
  });
});

describe("in the step's settings dialog", () => {
  type RenderModalFunction = (args?: JSONObject) => {
    onSave: MockFunction;
    user: UserEvent;
  };

  const renderModal: RenderModalFunction = (
    args: JSONObject = {},
  ): { onSave: MockFunction; user: UserEvent } => {
    const node: NodeDataProp = step(ComponentID.IfElse, args, "if-else-1");
    const onSave: MockFunction = getJestMockFunction();

    render(
      <ComponentSettingsModal
        title={node.metadata.title}
        description={node.metadata.description}
        onClose={() => {}}
        onSave={(component: NodeDataProp) => {
          onSave(component);
        }}
        onDelete={() => {}}
        onRunStep={() => {}}
        component={node}
        graphComponents={[webhook, node]}
        valueSources={{
          upstream: [webhook],
          downstreamIds: [],
          hasIncomingConnection: true,
        }}
        workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      />,
    );

    return { onSave: onSave, user: userEvent.setup({ delay: null }) };
  };

  test("the settings are called Condition, and the outputs say what they mean", () => {
    renderModal(PRODUCTION_CHECK);

    expect(
      within(
        screen.getByTestId("workflow-component-section-settings"),
      ).getByRole("heading", { level: 4 }),
    ).toHaveTextContent("Condition");
    expect(
      screen.getByTestId("workflow-component-section-outputs"),
    ).toHaveTextContent(
      "YesRuns next when the condition is met.NoRuns next when the condition is not met.",
    );
    expect(
      screen.getByText("Checks a condition, then continues on Yes or No."),
    ).toBeInTheDocument();
  });

  test("a new step cannot be saved until its condition is whole, and then saves it", async () => {
    const { onSave, user } = renderModal();

    /*
     * The identifier's form and the condition both report as the dialog
     * opens; the dialog merged them into a stale copy, so one was lost and
     * Save was on.
     */
    await waitFor(() => {
      expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    });
    expect(
      screen.getByText("Some settings need fixing before this can be saved."),
    ).toBeInTheDocument();

    placeCaret(valueToCheck(), 0);
    await user.keyboard("staging");
    placeCaret(compareWith(), 0);
    await user.keyboard("production");

    await waitFor(() => {
      expect(screen.getByTestId("modal-footer-submit-button")).toBeEnabled();
    });

    await user.click(screen.getByTestId("modal-footer-submit-button"));

    expect(onSave).toHaveBeenCalledTimes(1);
    expect((onSave.mock.calls[0]![0] as NodeDataProp).arguments).toEqual({
      "input-1": "staging",
      operator: "==",
      "input-2": "production",
    });
  });

  test("a saved condition opens ready to save as it is", async () => {
    const { onSave, user } = renderModal(PRODUCTION_CHECK);

    await waitFor(() => {
      expect(screen.getByTestId("modal-footer-submit-button")).toBeEnabled();
    });

    await user.click(screen.getByTestId("modal-footer-submit-button"));

    expect((onSave.mock.calls[0]![0] as NodeDataProp).arguments).toEqual(
      PRODUCTION_CHECK,
    );
  });
});
