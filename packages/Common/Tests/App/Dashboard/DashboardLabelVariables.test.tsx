import "@testing-library/jest-dom";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import DashboardVariable, {
  DashboardVariableOption,
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import ObjectID from "../../../Types/ObjectID";
import { VariableValueChange } from "../../../UI/Components/Dashboard/DashboardVariableControl";
import getJestMockFunction, { MockFunction } from "../../MockType";
import PrivateSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariableSelector";
import PublicSelector from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardVariableSelector";
import DashboardVariablesModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal";
import ProjectLabelVariableDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ProjectLabelVariableDropdown";
import ComponentInputTypeToFormFieldType from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Canvas/ComponentInputTypeToFormFieldType";
import { ComponentInputType } from "../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import DashboardVariableUrlState from "../../../Utils/Dashboard/VariableUrlState";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";

const getListMock: MockFunction = getJestMockFunction();
const telemetryMock: MockFunction = getJestMockFunction();
const publicPostMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): string => {
        return "44444444-4444-4444-8444-444444444444";
      },
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributeValues: (...args: Array<unknown>): unknown => {
          return telemetryMock(...args);
        },
      },
    };
  },
);
jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>): unknown => {
        return publicPostMock(...args);
      },
    },
  };
});

const OPTIONS: Array<DashboardVariableOption> = [
  { label: "0660", value: "11111111-1111-4111-8111-111111111111" },
  { label: "0661", value: "22222222-2222-4222-8222-222222222222" },
];
const FIRST: string = OPTIONS[0]!.value;
const SECOND: string = OPTIONS[1]!.value;
const DASHBOARD_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

function labelVariable(
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable {
  return {
    id: "unit",
    name: "UNIT",
    label: "Unit",
    type: DashboardVariableType.ProjectLabel,
    labelOptions: OPTIONS,
    ...overrides,
  };
}

interface SelectorState {
  variable: DashboardVariable;
  changes: Array<VariableValueChange>;
}

function renderSelector(
  isPublic: boolean,
  variable: DashboardVariable,
): SelectorState {
  const state: SelectorState = { variable, changes: [] };
  const Harness: React.FunctionComponent = (): React.ReactElement => {
    const [current, setCurrent] = React.useState<DashboardVariable>(variable);
    const onChange: (id: string, change: VariableValueChange) => void = (
      _id: string,
      change: VariableValueChange,
    ): void => {
      const next: DashboardVariable = {
        ...current,
        selectedValue: change.selectedValue,
        selectedValues: change.selectedValues,
      };
      state.variable = next;
      state.changes.push(change);
      setCurrent(next);
    };
    return isPublic ? (
      <PublicSelector
        variables={[current]}
        dashboardId={DASHBOARD_ID}
        onVariableValueChange={onChange}
      />
    ) : (
      <PrivateSelector variables={[current]} onVariableValueChange={onChange} />
    );
  };
  render(<Harness />);
  return state;
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockResolvedValue({
    data: OPTIONS.map((option: DashboardVariableOption) => {
      return {
        _id: option.value,
        name: option.label,
      };
    }),
    count: 2,
    skip: 0,
    limit: 1000,
  });
  telemetryMock.mockReset();
  publicPostMock.mockReset();
});
afterEach(cleanup);

describe.each([false, true])(
  "Project Labels selector (public=%s)",
  (isPublic: boolean) => {
    test("shows names with leading zeroes and sends stable label IDs without a labels request", () => {
      const state: SelectorState = renderSelector(isPublic, labelVariable());
      expect(screen.getByRole("option", { name: "0660" })).toHaveValue(FIRST);
      fireEvent.change(screen.getByRole("combobox", { name: "Unit" }), {
        target: { value: FIRST },
      });
      expect(state.variable.selectedValue).toBe(FIRST);
      expect(screen.getByRole("combobox", { name: "Unit" })).toHaveValue(FIRST);
      expect(getListMock).not.toHaveBeenCalled();
      expect(telemetryMock).not.toHaveBeenCalled();
      expect(publicPostMock).not.toHaveBeenCalled();
    });

    test("All remains selected after clearing a configured default", () => {
      const state: SelectorState = renderSelector(
        isPublic,
        labelVariable({ defaultValue: FIRST }),
      );
      const select: HTMLElement = screen.getByRole("combobox", {
        name: "Unit",
      });
      expect(select).toHaveValue(FIRST);
      fireEvent.change(select, { target: { value: "" } });
      expect(state.variable.selectedValue).toBe("");
      expect(select).toHaveValue("");
    });

    test("multiple choices and Clear update selectedValues and remove stale scalar state", () => {
      const state: SelectorState = renderSelector(
        isPublic,
        labelVariable({
          isMultiSelect: true,
          selectedValue: FIRST,
          defaultValue: FIRST,
        }),
      );
      const button: HTMLElement = screen.getByRole("button", {
        name: /^Unit:/,
      });
      expect(button).toHaveTextContent("All");
      fireEvent.click(button);
      fireEvent.click(screen.getByRole("checkbox", { name: "0660" }));
      expect(button).toHaveTextContent("0660");
      fireEvent.click(screen.getByRole("checkbox", { name: "0661" }));
      expect(state.variable.selectedValues).toEqual([FIRST, SECOND]);
      expect(state.variable.selectedValue).toBeUndefined();
      fireEvent.click(screen.getByRole("button", { name: "Clear" }));
      expect(state.variable.selectedValues).toEqual([]);
      expect(button).toHaveTextContent("All");
    });

    test("a deleted or disallowed selected ID is visibly unavailable instead of appearing as All", () => {
      renderSelector(isPublic, labelVariable({ selectedValue: "missing" }));
      expect(
        screen.getByRole("option", { name: "Unavailable label" }),
      ).toHaveValue("missing");
      expect(screen.getByRole("combobox", { name: "Unit" })).toHaveValue(
        "missing",
      );
    });

    test("limits explicit multi-selection to 100 labels", () => {
      const options: Array<DashboardVariableOption> = Array.from(
        { length: 101 },
        (_unused: unknown, index: number) => {
          return {
            label: `Unit ${index}`,
            value: `label-${index}`,
          };
        },
      );
      renderSelector(
        isPublic,
        labelVariable({
          isMultiSelect: true,
          labelOptions: options,
          selectedValues: options
            .slice(0, 100)
            .map((option: DashboardVariableOption) => {
              return option.value;
            }),
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: /^Unit:/ }));
      expect(screen.getByRole("checkbox", { name: "Unit 100" })).toBeDisabled();
      expect(
        screen.getByRole("checkbox", { name: "Unit 0" }),
      ).not.toBeDisabled();
      expect(screen.getByText("Choose up to 100 labels.")).toBeInTheDocument();
    });
  },
);

function renderEditor(
  variable: DashboardVariable,
): Array<Array<DashboardVariable>> {
  const saved: Array<Array<DashboardVariable>> = [];
  render(
    <DashboardVariablesModal
      variables={[variable]}
      telemetryAttributeOptions={["host.name"]}
      onSave={(values: Array<DashboardVariable>) => {
        saved.push(values);
      }}
      onClose={() => {}}
    />,
  );
  return saved;
}

function chooseDropdown(name: string, option: string): void {
  fireEvent.keyDown(screen.getByRole("combobox", { name }), {
    key: "ArrowDown",
  });
  fireEvent.click(screen.getByRole("option", { name: option }));
}

describe("Project Labels variable authoring", () => {
  test("switching sources clears incompatible settings and preserves the variable ID", () => {
    const saved: Array<Array<DashboardVariable>> = renderEditor(
      labelVariable({
        type: DashboardVariableType.CustomList,
        customListValues: "0660, 0661",
        isMultiSelect: true,
        selectedValues: ["0660"],
      }),
    );
    chooseDropdown("Variable source", "Text Input");
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(saved[0]?.[0]).toMatchObject({
      id: "unit",
      type: DashboardVariableType.TextInput,
      isMultiSelect: false,
    });
    expect(saved[0]?.[0]).not.toHaveProperty("selectedValue");
    expect(saved[0]?.[0]).not.toHaveProperty("selectedValues");
    expect(saved[0]?.[0]?.customListValues).toBeUndefined();
    expect(saved[0]?.[0]?.labelOptions).toBeUndefined();
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("clears a default and selection when its label is removed from the allowlist", async () => {
    const saved: Array<Array<DashboardVariable>> = renderEditor(
      labelVariable({ defaultValue: SECOND, selectedValue: SECOND }),
    );
    await screen.findByRole("combobox", { name: "Allowed project labels" });
    fireEvent.keyDown(
      screen.getByRole("combobox", { name: "Allowed project labels" }),
      { key: "Backspace", keyCode: 8 },
    );
    expect(screen.getByRole("combobox", { name: "Default label" })).toHaveValue(
      "",
    );
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(saved[0]?.[0]).toMatchObject({
      labelOptions: [OPTIONS[0]],
      defaultValue: "",
    });
    expect(saved[0]?.[0]).not.toHaveProperty("selectedValue");
    expect(saved[0]?.[0]).not.toHaveProperty("selectedValues");
  });

  test("shows an invalid saved default and requires an explicit valid choice", async () => {
    renderEditor(labelVariable({ defaultValue: "missing" }));
    await screen.findByRole("combobox", { name: "Allowed project labels" });
    const select: HTMLElement = screen.getByRole("combobox", {
      name: "Default label",
    });
    expect(select).toHaveValue("missing");
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    fireEvent.change(select, { target: { value: "" } });
    expect(screen.getByTestId("modal-footer-submit-button")).not.toBeDisabled();
  });

  test("creates an explicit allowlist and saves display labels separately from IDs", async () => {
    const saved: Array<Array<DashboardVariable>> = renderEditor(
      labelVariable({
        type: DashboardVariableType.TelemetryAttribute,
        labelOptions: undefined,
      }),
    );
    expect(getListMock).not.toHaveBeenCalled();
    chooseDropdown("Variable source", "Project Labels");
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    await screen.findByRole("combobox", { name: "Allowed project labels" });
    chooseDropdown("Allowed project labels", "0660");
    fireEvent.change(screen.getByRole("combobox", { name: "Default label" }), {
      target: { value: FIRST },
    });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(saved[0]?.[0]).toMatchObject({
      id: "unit",
      type: DashboardVariableType.ProjectLabel,
      labelOptions: [OPTIONS[0]],
      defaultValue: FIRST,
    });
    expect(getListMock.mock.calls[0]?.[0]).toMatchObject({
      query: { projectId: "44444444-4444-4444-8444-444444444444" },
      select: { _id: true, name: true },
      limit: 1000,
    });
  });

  test("keeps a saved label snapshot when no currently available project label has its ID", async () => {
    getListMock.mockResolvedValue({ data: [], count: 0, skip: 0, limit: 1000 });
    const saved: Array<Array<DashboardVariable>> = renderEditor(
      labelVariable({ defaultValue: FIRST }),
    );
    await screen.findByRole("combobox", { name: "Allowed project labels" });
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(saved[0]?.[0]?.labelOptions).toEqual(OPTIONS);
    expect(saved[0]?.[0]?.defaultValue).toBe(FIRST);
  });

  test.each([false, true])(
    "a newly configured default applies after a clean reload (public=%s)",
    async (isPublic: boolean) => {
      const saved: Array<Array<DashboardVariable>> = renderEditor(
        labelVariable({
          type: DashboardVariableType.TelemetryAttribute,
          labelOptions: undefined,
        }),
      );
      chooseDropdown("Variable source", "Project Labels");
      await screen.findByRole("combobox", { name: "Allowed project labels" });
      chooseDropdown("Allowed project labels", "0660");
      fireEvent.change(
        screen.getByRole("combobox", { name: "Default label" }),
        {
          target: { value: FIRST },
        },
      );
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      expect(saved[0]?.[0]).not.toHaveProperty("selectedValue");
      expect(saved[0]?.[0]).not.toHaveProperty("selectedValues");

      // Reload the JSON definition without any viewer-specific URL selection.
      const stored: Array<DashboardVariable> = JSON.parse(
        JSON.stringify(saved[0]),
      );
      const [restored]: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables(
          stored,
          DashboardVariableUrlState.parseFromSearch(""),
        );
      cleanup();
      renderSelector(isPublic, restored!);
      expect(screen.getByRole("combobox", { name: "Unit" })).toHaveValue(FIRST);
      expect(DashboardVariableInterpolation.resolveValue(restored!)).toEqual({
        scalar: FIRST,
      });
    },
  );

  test.each([false, true])(
    "saving definition edits does not publish runtime selections (multi=%s)",
    async (isMultiSelect: boolean) => {
      const original: DashboardVariable = labelVariable({
        isMultiSelect,
        defaultValue: FIRST,
        selectedValue: SECOND,
        selectedValues: [SECOND],
      });
      const saved: Array<Array<DashboardVariable>> = renderEditor(original);
      await screen.findByRole("combobox", { name: "Allowed project labels" });
      fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
      expect(saved[0]?.[0]).not.toHaveProperty("selectedValue");
      expect(saved[0]?.[0]).not.toHaveProperty("selectedValues");
      expect(original.selectedValue).toBe(SECOND);
      expect(original.selectedValues).toEqual([SECOND]);

      const stored: Array<DashboardVariable> = JSON.parse(
        JSON.stringify(saved[0]),
      );
      expect(DashboardVariableInterpolation.resolveValue(stored[0]!)).toEqual(
        isMultiSelect ? undefined : { scalar: FIRST },
      );
    },
  );

  test("loads additional project label pages so choices beyond the first page are available", async () => {
    getListMock.mockResolvedValueOnce({
      data: [{ _id: FIRST, name: "0660" }],
      count: 2,
      skip: 0,
      limit: 1000,
    });
    getListMock.mockResolvedValueOnce({
      data: [{ _id: SECOND, name: "0661" }],
      count: 2,
      skip: 1,
      limit: 1000,
    });
    renderEditor(labelVariable({ labelOptions: [] }));
    await screen.findByRole("combobox", { name: "Allowed project labels" });
    chooseDropdown("Allowed project labels", "0661");
    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(getListMock.mock.calls[1]?.[0]).toMatchObject({ skip: 1 });
    expect(screen.getByRole("option", { name: "0661" })).toHaveValue(SECOND);
  });

  test("reports a labels loading failure and prevents saving an empty allowlist", async () => {
    getListMock.mockRejectedValue(new Error("Labels could not be loaded"));
    const saved: Array<Array<DashboardVariable>> = renderEditor(
      labelVariable({ labelOptions: [] }),
    );
    await waitFor(() => {
      return expect(screen.queryByText("Loading project labels…")).toBeNull();
    });
    expect(
      screen.getByText("Choose between 1 and 1,000 allowed labels."),
    ).toBeInTheDocument();
    expect(screen.getByTestId("modal-footer-submit-button")).toBeDisabled();
    expect(saved).toEqual([]);
  });

  test("disables a single default for multi-select label variables", async () => {
    renderEditor(labelVariable({ isMultiSelect: true, defaultValue: FIRST }));
    await screen.findByRole("combobox", { name: "Allowed project labels" });
    expect(
      screen.getByRole("combobox", { name: "Default label" }),
    ).toBeDisabled();
  });

  test("preserves legacy custom-list source and values when saving unrelated edits", () => {
    const saved: Array<Array<DashboardVariable>> = renderEditor(
      labelVariable({
        type: DashboardVariableType.CustomList,
        labelOptions: undefined,
        customListValues: "0660, 0661",
        defaultValue: "0660",
      }),
    );
    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));
    expect(saved[0]?.[0]).toMatchObject({
      type: DashboardVariableType.CustomList,
      customListValues: "0660, 0661",
      defaultValue: "0660",
    });
    expect(getListMock).not.toHaveBeenCalled();
  });
});

describe("Monitor List variable binding editor", () => {
  test("offers only label variables and persists their stable IDs across renames", () => {
    const changes: Array<string> = [];
    const { rerender } = render(
      <ProjectLabelVariableDropdown
        variables={[
          labelVariable(),
          labelVariable({
            id: "telemetry",
            name: "host",
            type: DashboardVariableType.TelemetryAttribute,
          }),
        ]}
        onChange={(value: string) => {
          changes.push(value);
        }}
      />,
    );
    expect(screen.queryByRole("option", { name: "host" })).toBeNull();
    fireEvent.change(screen.getByRole("combobox", { name: "Label Variable" }), {
      target: { value: "unit" },
    });
    expect(changes).toEqual(["unit"]);
    rerender(
      <ProjectLabelVariableDropdown
        variables={[labelVariable({ name: "LOCATION" })]}
        value="unit"
        onChange={() => {}}
      />,
    );
    expect(screen.getByRole("combobox")).toHaveValue("unit");
    expect(
      screen.getByRole("option", { name: "Unit (LOCATION)" }),
    ).toBeInTheDocument();
  });

  test("flags a deleted binding and lets the author explicitly clear it", () => {
    const changes: Array<string> = [];
    render(
      <ProjectLabelVariableDropdown
        variables={[]}
        value="missing"
        onChange={(value: string) => {
          changes.push(value);
        }}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "removed or its source changed",
    );
    expect(screen.getByRole("combobox")).toHaveValue("missing");
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "" } });
    expect(changes).toEqual([""]);
  });

  test("explains how to create a variable when none exists", () => {
    render(<ProjectLabelVariableDropdown onChange={() => {}} />);
    expect(
      screen.getByText(
        "Add a Project Labels variable from the dashboard toolbar to use it here.",
      ),
    ).toBeInTheDocument();
  });

  test("registers the binding as a custom control instead of a free-text field", () => {
    expect(
      ComponentInputTypeToFormFieldType.getFormFieldTypeByComponentInputType(
        ComponentInputType.ProjectLabelVariable,
      ).fieldType,
    ).toBe(FormFieldSchemaType.CustomComponent);
  });
});
