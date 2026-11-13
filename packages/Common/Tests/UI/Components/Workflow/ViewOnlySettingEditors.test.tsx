/*
 * The settings that are editors of their own, on a view (WorkflowViewOnly):
 * If / Else, Switch / Case, a record step's field list and its record or
 * query editor. Each holds what changes the step still and leaves what only
 * reads it usable:
 *
 *   - If / Else and Switch / Case: the sentence and the cases are held still
 *     (WorkflowViewOnlyFieldset), and Compare as still opens, to read how a
 *     value is compared. A Switch case has no grip on a view and is off as
 *     a draggable: the grip is no form control, so a disabled fieldset never
 *     stopped it, and from the keyboard Space picked a case up and the arrow
 *     keys moved it, in a view.
 *   - The field list and the record editor: their chips and rows are read
 *     as they are, and a value they keep as JSON is a code box to read,
 *     whose own Copy copies it.
 *
 * What only changes a setting is not drawn on a view at all - Add case,
 * Remove, a grip, Add field, a chip's remove, Edit as JSON, Start over, Add
 * a condition: held still, each looked as if it could be pressed.
 *
 * Everything else these editors do is tested in their own suites; here only
 * the view, beside the same editor outside one.
 */

import React, { ReactElement } from "react";

/*
 * Utils.ts imports the database-model registry, which nothing here needs: the
 * field list names a record by its table when the registry has no model.
 */
jest.mock("../../../../Models/DatabaseModels/Index", () => {
  return {
    __esModule: true,
    default: [],
    getModelTypeByName: (): null => {
      return null;
    },
  };
});

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

jest.mock("../../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: jest.fn(),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return error instanceof Error ? error.message : String(error);
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }),
    },
  };
});

import ArgumentsForm from "../../../../UI/Components/Workflow/ArgumentsForm";
import { SWITCH_TEST_IDS } from "../../../../UI/Components/Workflow/Switch/SwitchEditor";
import ModelColumnEditor, {
  ModelColumnEditorMode,
  RecordIntent,
} from "../../../../UI/Components/Workflow/ModelColumnEditor";
import ModelFieldPicker, {
  FieldPickerMode,
} from "../../../../UI/Components/Workflow/ModelFieldPicker";
import { WorkflowViewOnlyContext } from "../../../../UI/Components/Workflow/WorkflowViewOnly";
import { WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR } from "../../../../UI/Components/Workflow/WorkflowViewOnlyFieldset";
import API from "../../../../UI/Utils/API/API";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import {
  SwitchCase,
  readSwitchCases,
} from "../../../../Types/Workflow/Components/SwitchCases";
import getJestMockFunction, { MockFunction } from "../../../MockType";
import { INCIDENT_COLUMNS } from "./FieldPicker/FieldPickerFixture";
import {
  CODE_COPY_SELECTOR,
  LiveControl,
  findActionsAViewDraws,
  findLiveControls,
  isHeldStill,
} from "./ViewOnlyControls";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const SEVERITY: string =
  "{{local.components.webhook-1.returnValues.request-body.severity}}";

const metadataOf: (id: ComponentID) => ComponentMetadata = (
  id: ComponentID,
): ComponentMetadata => {
  return Components.find((component: ComponentMetadata) => {
    return component.id === id;
  }) as ComponentMetadata;
};

const step: (
  id: ComponentID,
  args: JSONObject,
  stepId: string,
) => NodeDataProp = (
  id: ComponentID,
  args: JSONObject,
  stepId: string,
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

// Drawn on a view (true), or for someone who may change the workflow (false).
const inView: (isViewOnly: boolean, element: ReactElement) => void = (
  isViewOnly: boolean,
  element: ReactElement,
): void => {
  render(
    <WorkflowViewOnlyContext.Provider value={isViewOnly}>
      <div data-testid="harness">{element}</div>
    </WorkflowViewOnlyContext.Provider>,
  );
};

const renderStep: (isViewOnly: boolean, node: NodeDataProp) => MockFunction = (
  isViewOnly: boolean,
  node: NodeDataProp,
): MockFunction => {
  const onFormChange: MockFunction = getJestMockFunction();

  inView(
    isViewOnly,
    <ArgumentsForm
      component={node}
      workflowId={WORKFLOW_ID}
      graphComponents={[webhook, node]}
      valueSources={{
        upstream: [webhook],
        downstreamIds: [],
        hasIncomingConnection: true,
      }}
      onHasFormValidationErrors={(): void => {}}
      onFormChange={(value: NodeDataProp) => {
        onFormChange(value);
      }}
    />,
  );

  return onFormChange;
};

const harness: () => HTMLElement = (): HTMLElement => {
  return screen.getByTestId("harness");
};

const lastCases: (onFormChange: MockFunction) => Array<string> = (
  onFormChange: MockFunction,
): Array<string> => {
  const calls: Array<Array<unknown>> = onFormChange.mock.calls as Array<
    Array<unknown>
  >;
  const args: JSONObject =
    (calls[calls.length - 1]?.[0] as NodeDataProp | undefined)?.arguments || {};

  return readSwitchCases(args["cases"]).map((switchCase: SwitchCase) => {
    return switchCase.id;
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
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 30);
    });
  });
};

const SPACE: { keyCode: number; key: string } = { keyCode: 32, key: " " };
const ARROW_DOWN: { keyCode: number; key: string } = {
  keyCode: 40,
  key: "ArrowDown",
};

// Picks a case up by its grip, moves it down one place and drops it.
const dragFirstCaseDown: () => Promise<void> = async (): Promise<void> => {
  const grip: HTMLElement = within(
    screen.getByTestId("switch-case-0"),
  ).getByTestId("drag-handle");

  act(() => {
    grip.focus();
  });

  await press(grip, SPACE);
  await press(grip, ARROW_DOWN);
  await press(grip, SPACE);

  await act(async () => {
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 400);
    });
  });
};

let writeText: MockFunction;

beforeEach(() => {
  (API.get as unknown as MockFunction).mockResolvedValue(
    new HTTPResponse<JSONObject>(
      200,
      {
        tableName: "Incident",
        columns: INCIDENT_COLUMNS,
      } as unknown as JSONObject,
      {},
    ),
  );

  writeText = getJestMockFunction();
  writeText.mockImplementation(() => {
    return Promise.resolve();
  });

  Object.defineProperty(navigator, "clipboard", {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  cleanup();
  (API.get as unknown as MockFunction).mockReset();
  Object.defineProperty(navigator, "clipboard", {
    value: undefined,
    configurable: true,
  });
});

describe("Switch / Case on a view", () => {
  const CASES: JSONObject = {
    value: SEVERITY,
    cases: [
      { id: "case-1", comparison: "<", value: "300", compareAs: "number" },
      { id: "case-2", comparison: "==", value: "n/a", compareAs: "text" },
    ],
  };

  test("holds every case still: nothing in it can be changed, only read", () => {
    renderStep(true, step(ComponentID.Switch, CASES, "switch-1"));

    const live: Array<LiveControl> = findLiveControls(harness());

    expect(live).toEqual([]);
    // What only changes the cases is not drawn: no Remove, no Add case.
    expect(screen.queryByRole("button", { name: "Remove case 1" })).toBeNull();
    expect(screen.queryByTestId(SWITCH_TEST_IDS.addCase)).toBeNull();
    expect(findActionsAViewDraws(harness())).toEqual([]);
    expect(
      screen.getByRole("combobox", { name: "Comparison for case 1" }),
    ).toBeDisabled();
    // Each case still says which it is.
    expect(screen.getByTestId("switch-case-place-0")).toHaveTextContent("1");
    expect(screen.getByTestId("switch-case-place-1")).toHaveTextContent("2");
    // The values are read as they are.
    expect(screen.getByTestId("switch-case-value-0")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.getByTestId("switch-case-value-0")).toHaveTextContent("300");
  });

  test("no case can be picked up: no grip is drawn, and Space and the arrow keys move no case", async () => {
    const onFormChange: MockFunction = renderStep(
      true,
      step(ComponentID.Switch, CASES, "switch-1"),
    );

    expect(screen.queryAllByTestId("drag-handle")).toEqual([]);
    // Nothing carries what makes a row's grip: each case is off as a draggable.
    expect(
      harness().querySelectorAll("[data-rbd-drag-handle-draggable-id]"),
    ).toHaveLength(0);

    // From the keyboard on the case itself, where a grip would be.
    const firstCase: HTMLElement = screen.getByTestId("switch-case-0");

    await press(firstCase, SPACE);
    await press(firstCase, ARROW_DOWN);
    await press(firstCase, SPACE);

    expect(
      Array.from(document.querySelectorAll("[data-case-id]")).map(
        (element: Element): string | null => {
          return element.getAttribute("data-case-id");
        },
      ),
    ).toEqual(["case-1", "case-2"]);
    expect(lastCases(onFormChange)).not.toEqual(["case-2", "case-1"]);
  });

  test("each case sits beside its number, as a list is read", () => {
    renderStep(true, step(ComponentID.Switch, CASES, "switch-1"));

    // Two columns, the case in the second from a phone up; no Remove column.
    const fields: HTMLElement = screen.getByTestId("switch-case-fields-0");

    expect(fields.className).toContain("col-start-2");
    expect(fields.className).toContain("row-start-1");
    expect(fields.className).not.toContain("col-span-3");
    expect(fields.parentElement!.className).toContain(
      "grid-cols-[auto_minmax(0,1fr)]",
    );
  });

  test("Compare as still opens, to read how each case compares - its choices held still", () => {
    renderStep(true, step(ComponentID.Switch, CASES, "switch-1"));

    const header: HTMLElement = within(
      screen.getByTestId(SWITCH_TEST_IDS.compareAs),
    ).getByRole("button");

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(isHeldStill(header)).toBe(false);

    fireEvent.click(header);

    expect(header).toHaveAttribute("aria-expanded", "true");

    for (const radio of within(
      screen.getByTestId(SWITCH_TEST_IDS.compareAs),
    ).getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }

    expect(
      within(screen.getByTestId("switch-compare-as-0")).getByRole("radio", {
        name: "Number",
      }),
    ).toBeChecked();
  });

  test("outside a view, the same cases are set up as they always were", async () => {
    const onFormChange: MockFunction = renderStep(
      false,
      step(ComponentID.Switch, CASES, "switch-1"),
    );

    expect(
      document.querySelector(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR),
    ).toBeNull();
    expect(screen.getByRole("button", { name: "Remove case 1" })).toBeEnabled();
    expect(screen.getByTestId(SWITCH_TEST_IDS.addCase)).toBeEnabled();
    expect(
      within(screen.getByTestId("switch-case-0")).getByTestId("drag-handle"),
    ).not.toHaveAttribute("aria-disabled");
    expect(screen.getByTestId("switch-case-fields-0").className).toContain(
      "col-span-3",
    );

    await dragFirstCaseDown();

    await waitFor(() => {
      expect(lastCases(onFormChange)).toEqual(["case-2", "case-1"]);
    });
  });
});

describe("If / Else on a view", () => {
  const PRODUCTION_CHECK: JSONObject = {
    "input-1-type": "text",
    "input-1": SEVERITY,
    operator: "==",
    "input-2-type": "text",
    "input-2": "production",
  };

  test("holds the condition still: nothing in it can be changed, only read", () => {
    renderStep(true, step(ComponentID.IfElse, PRODUCTION_CHECK, "if-else-1"));

    expect(findLiveControls(harness())).toEqual([]);
    expect(screen.getByRole("combobox", { name: "Comparison" })).toBeDisabled();
    expect(
      screen.getByRole("textbox", { name: "Compare with" }),
    ).toHaveAttribute("contenteditable", "false");
    expect(
      screen.getByRole("textbox", { name: "Compare with" }),
    ).toHaveTextContent("production");
  });

  test("Compare as still opens, to read how the values compare - its choices held still", () => {
    renderStep(true, step(ComponentID.IfElse, PRODUCTION_CHECK, "if-else-1"));

    const header: HTMLElement = within(
      screen.getByTestId("if-else-compare-as"),
    ).getByRole("button");

    expect(isHeldStill(header)).toBe(false);

    // From the keyboard, as the header is a widget of its own.
    fireEvent.keyDown(header, { key: "Enter" });

    expect(header).toHaveAttribute("aria-expanded", "true");

    const options: HTMLElement = screen.getByRole("radiogroup", {
      name: "Compare as",
    });

    for (const radio of within(options).getAllByRole("radio")) {
      expect(radio).toBeDisabled();
    }

    expect(within(options).getByRole("radio", { name: "Text" })).toBeChecked();
  });

  test("outside a view, the condition is set up as it always was", () => {
    renderStep(false, step(ComponentID.IfElse, PRODUCTION_CHECK, "if-else-1"));

    expect(
      document.querySelector(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR),
    ).toBeNull();
    expect(screen.getByRole("combobox", { name: "Comparison" })).toBeEnabled();
    expect(
      screen.getByRole("textbox", { name: "Compare with" }),
    ).toHaveAttribute("contenteditable", "true");
  });

  // The comparison itself taken from an earlier step, as a workflow may hold it.
  const COMPARISON_FROM_A_STEP: JSONObject = {
    ...PRODUCTION_CHECK,
    operator: "{{local.components.webhook-1.returnValues.request-body.op}}",
  };

  test("a comparison taken from an earlier step is read as its value, with no Choose from the list", () => {
    renderStep(
      true,
      step(ComponentID.IfElse, COMPARISON_FROM_A_STEP, "if-else-1"),
    );

    expect(screen.getByTestId("workflow-argument-operator")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.queryByTestId("if-else-choose-comparison")).toBeNull();
    expect(findActionsAViewDraws(harness())).toEqual([]);
  });

  test("outside a view, such a comparison has Choose from the list, to pick one instead", () => {
    renderStep(
      false,
      step(ComponentID.IfElse, COMPARISON_FROM_A_STEP, "if-else-1"),
    );

    expect(screen.getByTestId("if-else-choose-comparison")).toBeEnabled();
  });
});

describe("a record step's field list on a view", () => {
  const renderPicker: (
    isViewOnly: boolean,
    value: string | JSONObject,
    error?: string,
  ) => MockFunction = (
    isViewOnly: boolean,
    value: string | JSONObject,
    error?: string,
  ): MockFunction => {
    const onChange: MockFunction = getJestMockFunction();

    inView(
      isViewOnly,
      <ModelFieldPicker
        tableName="Incident"
        mode={FieldPickerMode.PassOn}
        initialValue={value}
        error={error}
        onChange={(next: string) => {
          onChange(next);
        }}
      />,
    );

    return onChange;
  };

  test("a list with an error still says what is wrong, with no way out to JSON beside it", async () => {
    renderPicker(true, {}, "Fields to pass on is required.");

    await screen.findByTestId("fields-to-pass-on-empty");

    expect(harness()).toHaveTextContent("Pick at least one field.");
    expect(screen.queryByTestId("fields-to-pass-on-edit-json")).toBeNull();
    expect(findActionsAViewDraws(harness())).toEqual([]);
  });

  test("outside a view, the same list has Edit as JSON beside its error", async () => {
    renderPicker(false, {}, "Fields to pass on is required.");

    await screen.findByTestId("fields-to-pass-on-empty");

    expect(screen.getByTestId("fields-to-pass-on-edit-json")).toBeEnabled();
  });

  test("its chips are read, and nothing to take one off or add one is drawn", async () => {
    renderPicker(true, { title: true, description: true });

    const chips: Array<HTMLElement> = await screen.findAllByTestId(
      "fields-to-pass-on-chip",
    );

    expect(chips).toHaveLength(2);
    expect(findLiveControls(harness())).toEqual([]);
    expect(findActionsAViewDraws(harness())).toEqual([]);

    expect(screen.queryAllByTestId("fields-to-pass-on-remove")).toEqual([]);
    expect(screen.queryByTestId("fields-to-pass-on-add")).toBeNull();
    expect(screen.queryByTestId("fields-to-pass-on-edit-json")).toBeNull();
  });

  test("a chip is read as a chip, and an unknown field still says why", async () => {
    renderPicker(true, { title: true, notAField: true });

    const chips: Array<HTMLElement> = await screen.findAllByTestId(
      "fields-to-pass-on-chip",
    );
    const unknown: HTMLElement = chips.find((chip: HTMLElement): boolean => {
      return chip.getAttribute("data-unknown") === "true";
    })!;

    // Its reason is its title, which the pointer reaches on a view too.
    expect(unknown.getAttribute("title")).toContain("notAField");
    expect(isHeldStill(unknown)).toBe(false);
    // As tall as a chip with its remove button, which it has not.
    expect(unknown.className).toContain("py-0.5");
    expect(unknown.className).toContain("pr-2");
  });

  test("a list it keeps as JSON is a code box to read, whose own Copy copies it", async () => {
    // A field set to something other than true: the list cannot show it.
    const kept: string = '{"title": "yes"}';
    const onChange: MockFunction = renderPicker(true, kept);

    await screen.findByTestId("fields-to-pass-on-kept-as-json");

    const box: HTMLElement = harness().querySelector(
      "[data-code-type]",
    ) as HTMLElement;
    const input: HTMLTextAreaElement = within(box).getByTestId(
      "code-editor-input",
    ) as HTMLTextAreaElement;

    expect(input.value).toBe(kept);
    expect(input).toHaveAttribute("readonly");
    expect(isHeldStill(input)).toBe(false);
    // How to change it is not said: Start over and its sentence are left out.
    expect(screen.queryByTestId("fields-to-pass-on-start-over")).toBeNull();
    expect(
      screen.getByTestId("fields-to-pass-on-kept-as-json"),
    ).not.toHaveTextContent("Start over");
    // What it says is read, and selected, as it is.
    expect(
      isHeldStill(screen.getByTestId("fields-to-pass-on-kept-as-json")),
    ).toBe(false);
    expect(findLiveControls(harness())).toEqual([]);

    const copy: HTMLElement = box.querySelector(
      CODE_COPY_SELECTOR,
    ) as HTMLElement;

    expect(isHeldStill(copy)).toBe(false);

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith(kept);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("when the fields cannot load, the JSON it shows instead is read and copied", async () => {
    (API.get as unknown as MockFunction).mockReset();
    (API.get as unknown as MockFunction).mockRejectedValue(
      new Error("The fields could not be loaded."),
    );

    const value: string = '{"title": true}';

    renderPicker(true, value);

    await screen.findByTestId("fields-to-pass-on-load-error");

    const input: HTMLTextAreaElement = screen.getByTestId(
      "code-editor-input",
    ) as HTMLTextAreaElement;

    expect(input.value).toBe(value);
    expect(input).toHaveAttribute("readonly");
    expect(
      harness().querySelector(CODE_COPY_SELECTOR) as HTMLElement,
    ).toBeEnabled();
  });

  test("outside a view, the same list is changed as it always was", async () => {
    renderPicker(false, '{"title": "yes"}');

    await screen.findByTestId("fields-to-pass-on-kept-as-json");

    expect(screen.getByTestId("code-editor-input")).not.toHaveAttribute(
      "readonly",
    );
    expect(screen.getByTestId("fields-to-pass-on-start-over")).toBeEnabled();
  });
});

describe("a record step's record and query editor on a view", () => {
  const renderEditor: (
    isViewOnly: boolean,
    mode: ModelColumnEditorMode,
    value: string,
  ) => MockFunction = (
    isViewOnly: boolean,
    mode: ModelColumnEditorMode,
    value: string,
  ): MockFunction => {
    const onChange: MockFunction = getJestMockFunction();

    inView(
      isViewOnly,
      <ModelColumnEditor
        tableName="Incident"
        mode={mode}
        initialValue={value}
        recordIntent={RecordIntent.Update}
        onChange={(next: string) => {
          onChange(next);
        }}
      />,
    );

    return onChange;
  };

  test.each([
    [ModelColumnEditorMode.Record, '{"title": "Checkout is down"}'],
    [ModelColumnEditorMode.Query, '{"title": "Checkout is down"}'],
  ])(
    "a %s's rows are read, and nothing in them can be changed",
    async (mode: ModelColumnEditorMode, value: string) => {
      renderEditor(true, mode, value);

      await screen.findAllByTestId("model-column-row");

      expect(findLiveControls(harness())).toEqual([]);
      expect(
        harness().querySelectorAll(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR).length,
      ).toBeGreaterThan(0);
      // Nothing that only changes them: Edit as JSON, Add, Remove.
      expect(screen.queryByTestId("model-column-json-toggle")).toBeNull();
      expect(screen.queryByTestId("model-column-add")).toBeNull();
      expect(
        harness().querySelectorAll('[data-testid^="model-column-remove-"]'),
      ).toHaveLength(0);
      expect(findActionsAViewDraws(harness())).toEqual([]);
    },
  );

  test("a query's pickers have nothing to clear, and its columns line up with their header", async () => {
    renderEditor(
      true,
      ModelColumnEditorMode.Query,
      '{"title": "Checkout is down"}',
    );

    const row: HTMLElement = (
      await screen.findAllByTestId("model-column-row")
    )[0]!;

    expect(row.className).toContain(
      "sm:grid-cols-[minmax(0,1fr)_minmax(0,0.85fr)_minmax(0,1.3fr)]",
    );
    expect(row.className).not.toContain("_auto]");
    // The column and the comparison, each as it is, with nothing to clear.
    expect(
      row.querySelectorAll(".ou-select__control--is-disabled"),
    ).toHaveLength(2);
    expect(harness().querySelector(".ou-select__clear-indicator")).toBeNull();
  });

  test("a record with no fields says so, with no word on how to add one", async () => {
    renderEditor(true, ModelColumnEditorMode.Record, "{}");

    await screen.findByText("No fields set yet");

    expect(
      screen.queryByText("Pick a field below to start building this record."),
    ).toBeNull();
  });

  test("a value it keeps as JSON is a code box to read, whose own Copy copies it", async () => {
    const value: string = '{"labels":["a","b"]}';
    const onChange: MockFunction = renderEditor(
      true,
      ModelColumnEditorMode.Record,
      value,
    );

    // What it shows, not that it is being edited.
    await screen.findByText("Shown as JSON, because:");

    expect(harness().textContent?.includes("Editing")).toBe(false);
    expect(
      screen.getByText("The raw JSON this step will send."),
    ).toBeInTheDocument();

    const input: HTMLTextAreaElement = screen.getByTestId(
      "code-editor-input",
    ) as HTMLTextAreaElement;

    expect(input.value).toBe(value);
    expect(input).toHaveAttribute("readonly");
    expect(isHeldStill(input)).toBe(false);
    expect(findLiveControls(harness())).toEqual([]);

    const copy: HTMLElement = harness().querySelector(
      CODE_COPY_SELECTOR,
    ) as HTMLElement;

    expect(isHeldStill(copy)).toBe(false);

    await act(async () => {
      fireEvent.click(copy);
    });

    expect(writeText).toHaveBeenCalledWith(value);
    expect(onChange).not.toHaveBeenCalled();
  });

  test("outside a view, the same rows and JSON are changed as they always were", async () => {
    renderEditor(false, ModelColumnEditorMode.Record, '{"labels":["a","b"]}');

    await screen.findByText(/Editing as JSON, because/);

    expect(
      screen.getByText("Editing the raw JSON this step will send."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("code-editor-input")).not.toHaveAttribute(
      "readonly",
    );
    expect(
      document.querySelector(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR),
    ).toBeNull();
  });

  test("outside a view, rows come with Edit as JSON, Add and Remove", async () => {
    renderEditor(
      false,
      ModelColumnEditorMode.Query,
      '{"title": "Checkout is down"}',
    );

    await screen.findByTestId("model-column-json-toggle");

    expect(screen.getByTestId("model-column-add")).toBeInTheDocument();
    expect(
      harness().querySelectorAll('[data-testid^="model-column-remove-"]')
        .length,
    ).toBeGreaterThan(0);
    // The column picker can be cleared, to pick another.
    await waitFor(() => {
      expect(
        harness().querySelector(".ou-select__clear-indicator"),
      ).not.toBeNull();
    });
    expect(
      harness().querySelectorAll(".ou-select__control--is-disabled"),
    ).toHaveLength(0);
  });

  test("when the columns cannot load, a view says the JSON is shown, not that it can be written", async () => {
    (API.get as unknown as MockFunction).mockReset();
    (API.get as unknown as MockFunction).mockRejectedValue(
      new Error("The columns could not be loaded."),
    );

    renderEditor(true, ModelColumnEditorMode.Query, '{"title": "x"}');

    await screen.findByText(
      "Couldn't load this model's columns. The columns could not be loaded. The query is shown as JSON.",
    );

    expect(harness().textContent?.includes("You can still write")).toBe(false);
  });
});
