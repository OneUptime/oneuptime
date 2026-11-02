/*
 * The settings that are editors of their own, on a view (WorkflowViewOnly):
 * If / Else, Switch / Case, a record step's field list and its record or
 * query editor. Each holds what changes the step still and leaves what only
 * reads it usable:
 *
 *   - If / Else and Switch / Case: the sentence and the cases are held still
 *     (WorkflowViewOnlyFieldset), and Compare as still opens, to read how a
 *     value is compared. A Switch case's grip picks nothing up: the grip is
 *     no form control, so a disabled fieldset never stopped it, and from the
 *     keyboard Space picked a case up and the arrow keys moved it, in a view.
 *   - The field list and the record editor: their chips and rows are held
 *     still, and a value they keep as JSON is a code box to read, whose own
 *     Copy copies it.
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
    expect(
      screen.getByRole("button", { name: "Remove case 1" }),
    ).toBeDisabled();
    expect(screen.getByTestId(SWITCH_TEST_IDS.addCase)).toBeDisabled();
    expect(
      screen.getByRole("combobox", { name: "Comparison for case 1" }),
    ).toBeDisabled();
    // The values are read as they are.
    expect(screen.getByTestId("switch-case-value-0")).toHaveAttribute(
      "contenteditable",
      "false",
    );
    expect(screen.getByTestId("switch-case-value-0")).toHaveTextContent("300");
  });

  test("a case's grip picks nothing up: Space and the arrow keys move no case", async () => {
    const onFormChange: MockFunction = renderStep(
      true,
      step(ComponentID.Switch, CASES, "switch-1"),
    );

    const grip: HTMLElement = within(
      screen.getByTestId("switch-case-0"),
    ).getByTestId("drag-handle");

    // Locked, as every control on a view looks.
    expect(grip).toHaveAttribute("aria-disabled", "true");

    await dragFirstCaseDown();

    expect(
      Array.from(document.querySelectorAll("[data-case-id]")).map(
        (element: Element): string | null => {
          return element.getAttribute("data-case-id");
        },
      ),
    ).toEqual(["case-1", "case-2"]);
    expect(lastCases(onFormChange)).not.toEqual(["case-2", "case-1"]);
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
    expect(
      within(screen.getByTestId("switch-case-0")).getByTestId("drag-handle"),
    ).not.toHaveAttribute("aria-disabled");

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
});

describe("a record step's field list on a view", () => {
  const renderPicker: (
    isViewOnly: boolean,
    value: string | JSONObject,
  ) => MockFunction = (
    isViewOnly: boolean,
    value: string | JSONObject,
  ): MockFunction => {
    const onChange: MockFunction = getJestMockFunction();

    inView(
      isViewOnly,
      <ModelFieldPicker
        tableName="Incident"
        mode={FieldPickerMode.PassOn}
        initialValue={value}
        onChange={(next: string) => {
          onChange(next);
        }}
      />,
    );

    return onChange;
  };

  test("its chips are read, and nothing takes one off or adds one", async () => {
    renderPicker(true, { title: true, description: true });

    const chips: Array<HTMLElement> = await screen.findAllByTestId(
      "fields-to-pass-on-chip",
    );

    expect(chips).toHaveLength(2);
    expect(findLiveControls(harness())).toEqual([]);

    for (const remove of screen.getAllByTestId("fields-to-pass-on-remove")) {
      expect(remove).toBeDisabled();
    }

    expect(screen.getByTestId("fields-to-pass-on-add")).toBeDisabled();
    expect(screen.getByTestId("fields-to-pass-on-edit-json")).toBeDisabled();
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
    expect(screen.getByTestId("fields-to-pass-on-start-over")).toBeDisabled();
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

      await screen.findByTestId("model-column-json-toggle");

      expect(findLiveControls(harness())).toEqual([]);
      expect(screen.getByTestId("model-column-json-toggle")).toBeDisabled();
      expect(
        harness().querySelectorAll(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR).length,
      ).toBeGreaterThan(0);
    },
  );

  test("a value it keeps as JSON is a code box to read, whose own Copy copies it", async () => {
    const value: string = '{"labels":["a","b"]}';
    const onChange: MockFunction = renderEditor(
      true,
      ModelColumnEditorMode.Record,
      value,
    );

    await screen.findByText(/Editing as JSON, because/);

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

    expect(screen.getByTestId("code-editor-input")).not.toHaveAttribute(
      "readonly",
    );
    expect(
      document.querySelector(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR),
    ).toBeNull();
  });
});
