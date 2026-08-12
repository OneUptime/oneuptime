import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A dashboard variable has two readers that must never disagree: the toolbar
 * control, which tells the user what the board is scoped to, and the query
 * interpolation in Common/Utils/Dashboard/VariableInterpolation.ts, which
 * decides what the widgets actually fetch.
 *
 * Picking "All" emits selectedValue: "" — an explicit choice, distinct from
 * "the user has not touched this yet" (undefined). The interpolation side has
 * always read it that way (`??`), so "" applies no filter. The toolbar used
 * `||`, which folds "" back into defaultValue: the dropdown snapped back to
 * "prod" while the widgets went right on showing every cluster, and no amount
 * of clicking could get out of it.
 *
 * So these tests assert both halves together — what the control displays AND
 * what the same variable resolves to for the query — because a selector that
 * merely looks right while the widgets are filtered differently is the exact
 * bug being pinned here.
 */

const getTelemetryAttributeValuesMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock variable above is still unassigned when the factory
 * runs. Dereferencing it lazily, at call time, is what makes this work.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributeValues: (...args: Array<any>): unknown => {
          return getTelemetryAttributeValuesMock(...args);
        },
      },
    };
  },
);

import DashboardVariableSelector, {
  VariableValueChange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariableSelector";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../../../Utils/Dashboard/VariableInterpolation";

const ATTRIBUTE_KEY: string = "k8s.cluster.name";
const OPTIONS: Array<string> = ["prod", "staging"];

type MakeVariableFunction = (
  overrides?: Partial<DashboardVariable>,
) => DashboardVariable;

const telemetryVariable: MakeVariableFunction = (
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable => {
  return {
    id: "cluster",
    name: "cluster",
    label: "Cluster",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: ATTRIBUTE_KEY,
    ...overrides,
  };
};

const customListVariable: MakeVariableFunction = (
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable => {
  return {
    id: "region",
    name: "region",
    label: "Region",
    type: DashboardVariableType.CustomList,
    customListValues: "eu-west-1, us-east-1",
    ...overrides,
  };
};

const textVariable: MakeVariableFunction = (
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable => {
  return {
    id: "service",
    name: "service",
    label: "Service",
    type: DashboardVariableType.TextInput,
    ...overrides,
  };
};

/*
 * Verbatim from DashboardView.tsx's onVariableValueChange. The bug only
 * appears on the render AFTER the parent stores the change, so a harness that
 * did not round-trip through the owner's state could not see it.
 */
type ApplyVariableChangeFunction = (
  variables: Array<DashboardVariable>,
  variableId: string,
  change: VariableValueChange,
) => Array<DashboardVariable>;

const applyVariableChange: ApplyVariableChangeFunction = (
  variables: Array<DashboardVariable>,
  variableId: string,
  change: VariableValueChange,
): Array<DashboardVariable> => {
  return variables.map((v: DashboardVariable): DashboardVariable => {
    if (v.id !== variableId) {
      return v;
    }

    if (change.selectedValues !== undefined) {
      return {
        ...v,
        selectedValues: change.selectedValues,
        selectedValue: undefined,
      };
    }

    return { ...v, selectedValue: change.selectedValue };
  });
};

interface RecordedChange {
  variableId: string;
  change: VariableValueChange;
}

/** What the dashboard owner is holding after the user's interactions. */
interface ToolbarState {
  variables: Array<DashboardVariable>;
  changes: Array<RecordedChange>;
}

interface HarnessProps {
  state: ToolbarState;
}

const ToolbarHarness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [variables, setVariables] = React.useState<Array<DashboardVariable>>(
    props.state.variables,
  );

  return (
    <DashboardVariableSelector
      variables={variables}
      onVariableValueChange={(
        variableId: string,
        change: VariableValueChange,
      ) => {
        const updated: Array<DashboardVariable> = applyVariableChange(
          variables,
          variableId,
          change,
        );
        props.state.changes.push({ variableId: variableId, change: change });
        props.state.variables = updated;
        setVariables(updated);
      }}
    />
  );
};

type RenderToolbarFunction = (
  variables: Array<DashboardVariable>,
) => ToolbarState;

const renderToolbar: RenderToolbarFunction = (
  variables: Array<DashboardVariable>,
): ToolbarState => {
  const state: ToolbarState = { variables: variables, changes: [] };
  render(<ToolbarHarness state={state} />);
  return state;
};

type GetSelectFunction = (index?: number) => HTMLSelectElement;

const getSelect: GetSelectFunction = (index: number = 0): HTMLSelectElement => {
  return screen.getAllByRole("combobox")[index] as HTMLSelectElement;
};

type GetTextInputFunction = (index?: number) => HTMLInputElement;

const getTextInput: GetTextInputFunction = (
  index: number = 0,
): HTMLInputElement => {
  return screen.getAllByRole("textbox")[index] as HTMLInputElement;
};

/*
 * A TelemetryAttribute select is disabled, and holds only the "All" option,
 * until its values come back — so every assertion about what it displays has
 * to wait for that.
 */
type WaitForOptionsFunction = (index?: number) => Promise<HTMLSelectElement>;

const waitForOptions: WaitForOptionsFunction = async (
  index: number = 0,
): Promise<HTMLSelectElement> => {
  await waitFor((): void => {
    expect(getSelect(index)).not.toBeDisabled();
  });
  return getSelect(index);
};

type SelectValueFunction = (element: HTMLElement, value: string) => void;

const selectValue: SelectValueFunction = (
  element: HTMLElement,
  value: string,
): void => {
  fireEvent.change(element, { target: { value: value } });
};

type OptionLabelsFunction = (select: HTMLSelectElement) => Array<string>;

const optionLabels: OptionLabelsFunction = (
  select: HTMLSelectElement,
): Array<string> => {
  return Array.from(select.options).map((option: HTMLOptionElement): string => {
    return option.textContent || "";
  });
};

/** What the widgets would be filtered by, given what the toolbar is holding. */
type ResolveFunction = (
  variable: DashboardVariable,
) => ResolvedVariableValue | undefined;

const resolvedFilter: ResolveFunction = (
  variable: DashboardVariable,
): ResolvedVariableValue | undefined => {
  return DashboardVariableInterpolation.resolveValue(variable);
};

beforeEach((): void => {
  getTelemetryAttributeValuesMock.mockReset();
  getTelemetryAttributeValuesMock.mockResolvedValue(OPTIONS);
});

afterEach((): void => {
  cleanup();
});

describe("DashboardVariableSelector", () => {
  describe('picking "All" on a variable that has a default', () => {
    test('the select stays on "All" instead of snapping back to the default', async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      const select: HTMLSelectElement = await waitForOptions();

      // Untouched, the variable shows its default. That part was never broken.
      expect(select).toHaveValue("prod");
      expect(select).toHaveDisplayValue("prod");

      selectValue(select, "");

      /*
       * The whole report in two assertions: the value is the empty string the
       * user picked, and what they read is "All" — not "prod".
       */
      expect(getSelect()).toHaveValue("");
      expect(getSelect()).toHaveDisplayValue("All");
      expect(state.variables[0]!.selectedValue).toBe("");
    });

    test("the change handed to the dashboard is an empty string, not undefined", async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");

      expect(state.changes).toEqual([
        { variableId: "cluster", change: { selectedValue: "" } },
      ]);
    });

    test("what the toolbar shows and what the widgets query agree", async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");

      /*
       * The damage the display bug did was not cosmetic: the toolbar claimed
       * "prod" while the interpolation, reading the same variable, applied no
       * filter at all and the widgets showed every cluster.
       */
      expect(getSelect()).toHaveDisplayValue("All");
      expect(resolvedFilter(state.variables[0]!)).toBeUndefined();
      expect(
        DashboardVariableInterpolation.applyToAttributes({}, state.variables),
      ).toEqual({});
    });

    test('a pre-existing filter on the attribute key is dropped when "All" is picked', async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");

      expect(
        DashboardVariableInterpolation.applyToAttributes(
          { [ATTRIBUTE_KEY]: "prod", "service.name": "checkout" },
          state.variables,
        ),
      ).toEqual({ "service.name": "checkout" });
    });

    test("the user can pick a real value again afterwards", async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");
      expect(getSelect()).toHaveDisplayValue("All");

      selectValue(getSelect(), "staging");

      expect(getSelect()).toHaveValue("staging");
      expect(resolvedFilter(state.variables[0]!)).toEqual({
        scalar: "staging",
      });
    });

    test('"All" survives a round trip through a concrete value', async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");
      selectValue(getSelect(), "staging");
      selectValue(getSelect(), "");

      expect(getSelect()).toHaveValue("");
      expect(getSelect()).toHaveDisplayValue("All");
      expect(state.variables[0]!.selectedValue).toBe("");
      expect(resolvedFilter(state.variables[0]!)).toBeUndefined();
    });

    test('a variable restored with an empty selection opens on "All"', async () => {
      /*
       * An explicit "All" that is already in place on the very first render,
       * with no change event to reveal it. DashboardVariableUrlState.
       * parseFromSearch produces exactly this from `var-cluster=`, and the
       * public dashboard's server-side variable policy passes an empty
       * string straight through.
       *
       * Note the asymmetry it implies: writeToBrowserUrl skips an empty
       * selectedValue (Common/Utils/Dashboard/VariableUrlState.ts:117), so
       * the URL cannot yet record an "All" the reader would happily restore.
       * That gap is untouched here — this pins only the render.
       */
      renderToolbar([
        telemetryVariable({ defaultValue: "prod", selectedValue: "" }),
      ]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(select).toHaveValue("");
      expect(select).toHaveDisplayValue("All");
    });
  });

  describe("the default value still works", () => {
    test("an untouched variable shows and queries its default", async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      expect(await waitForOptions()).toHaveValue("prod");
      expect(resolvedFilter(state.variables[0]!)).toEqual({ scalar: "prod" });
    });

    test("a selected value takes precedence over the default", async () => {
      renderToolbar([
        telemetryVariable({ defaultValue: "prod", selectedValue: "staging" }),
      ]);

      expect(await waitForOptions()).toHaveValue("staging");
    });

    test('a variable with no default and no selection opens on "All"', async () => {
      const state: ToolbarState = renderToolbar([telemetryVariable({})]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(select).toHaveValue("");
      expect(select).toHaveDisplayValue("All");
      expect(resolvedFilter(state.variables[0]!)).toBeUndefined();
    });

    test("a default the attribute no longer reports does not select some other value", async () => {
      /*
       * The attribute stopped reporting "prod" in this time range. There is no
       * option to select, so the control lands on "All" — the point being that
       * it does not silently scope the board to a different cluster.
       */
      getTelemetryAttributeValuesMock.mockResolvedValue(["staging"]);

      renderToolbar([telemetryVariable({ defaultValue: "prod" })]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(optionLabels(select)).toEqual(["All", "staging"]);
      expect(select).toHaveValue("");
    });
  });

  describe("fetching the options", () => {
    test("the variable's attribute key is what gets asked for", async () => {
      renderToolbar([telemetryVariable({ defaultValue: "prod" })]);

      await waitForOptions();

      expect(getTelemetryAttributeValuesMock).toHaveBeenCalledWith({
        attributeKey: ATTRIBUTE_KEY,
      });
    });

    test('while values load the select is disabled and reads "Loading…"', async () => {
      let releaseValues: (values: Array<string>) => void = (): void => {
        // Replaced synchronously by the executor below.
      };

      getTelemetryAttributeValuesMock.mockImplementation((): unknown => {
        return new Promise<Array<string>>(
          (resolve: (values: Array<string>) => void): void => {
            releaseValues = resolve;
          },
        );
      });

      renderToolbar([telemetryVariable({ defaultValue: "prod" })]);

      expect(getSelect()).toBeDisabled();
      expect(optionLabels(getSelect())).toEqual(["Loading…"]);

      await act(async (): Promise<void> => {
        releaseValues(OPTIONS);
      });

      expect(getSelect()).not.toBeDisabled();
      expect(optionLabels(getSelect())).toEqual(["All", "prod", "staging"]);
      expect(getSelect()).toHaveValue("prod");
    });

    test('a failed fetch leaves the control usable and on "All"', async () => {
      getTelemetryAttributeValuesMock.mockRejectedValue(
        new Error("attribute values unavailable"),
      );

      renderToolbar([telemetryVariable({ defaultValue: "prod" })]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(optionLabels(select)).toEqual(["All"]);
      expect(select).toHaveValue("");
    });
  });

  describe("custom list variables", () => {
    test("options come from the comma-separated list, trimmed", () => {
      renderToolbar([customListVariable({ defaultValue: "eu-west-1" })]);

      expect(optionLabels(getSelect())).toEqual([
        "All",
        "eu-west-1",
        "us-east-1",
      ]);
      expect(getSelect()).toHaveValue("eu-west-1");
    });

    test('picking "All" stays on "All"', () => {
      const state: ToolbarState = renderToolbar([
        customListVariable({ defaultValue: "eu-west-1" }),
      ]);

      selectValue(getSelect(), "");

      expect(getSelect()).toHaveValue("");
      expect(getSelect()).toHaveDisplayValue("All");
      expect(state.variables[0]!.selectedValue).toBe("");
    });

    test("no network call is made for a custom list", () => {
      renderToolbar([customListVariable({})]);

      expect(getTelemetryAttributeValuesMock).not.toHaveBeenCalled();
    });
  });

  describe("free-text variables", () => {
    test("the default is shown until the user types", () => {
      renderToolbar([textVariable({ defaultValue: "checkout" })]);

      expect(getTextInput()).toHaveValue("checkout");
    });

    test("clearing the box leaves it empty instead of restoring the default", () => {
      const state: ToolbarState = renderToolbar([
        textVariable({ defaultValue: "checkout" }),
      ]);

      fireEvent.change(getTextInput(), { target: { value: "" } });

      /*
       * Same defect, other control: with `||` the field refilled itself with
       * "checkout" the instant it was emptied, so the value could never be
       * cleared.
       */
      expect(getTextInput()).toHaveValue("");
      expect(state.variables[0]!.selectedValue).toBe("");
      expect(resolvedFilter(state.variables[0]!)).toBeUndefined();
    });

    test("typing replaces the default and is stored", () => {
      const state: ToolbarState = renderToolbar([
        textVariable({ defaultValue: "checkout" }),
      ]);

      fireEvent.change(getTextInput(), { target: { value: "payments" } });

      expect(getTextInput()).toHaveValue("payments");
      expect(state.variables[0]!.selectedValue).toBe("payments");
    });

    test("a cleared box can be typed into again", () => {
      renderToolbar([textVariable({ defaultValue: "checkout" })]);

      fireEvent.change(getTextInput(), { target: { value: "" } });
      fireEvent.change(getTextInput(), { target: { value: "payments" } });

      expect(getTextInput()).toHaveValue("payments");
    });
  });

  describe("several variables on one toolbar", () => {
    test("each is labelled and rendered with its own control", async () => {
      renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
        customListVariable({ defaultValue: "eu-west-1" }),
        textVariable({ defaultValue: "checkout" }),
      ]);

      await waitForOptions();

      expect(screen.getByText("Cluster")).toBeInTheDocument();
      expect(screen.getByText("Region")).toBeInTheDocument();
      expect(screen.getByText("Service")).toBeInTheDocument();
      expect(screen.getAllByRole("combobox")).toHaveLength(2);
      expect(screen.getAllByRole("textbox")).toHaveLength(1);
    });

    test('picking "All" on one leaves the others on their defaults', async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
        customListVariable({ defaultValue: "eu-west-1" }),
      ]);

      selectValue(await waitForOptions(0), "");

      expect(getSelect(0)).toHaveDisplayValue("All");
      expect(getSelect(1)).toHaveValue("eu-west-1");
      expect(state.variables[1]!.selectedValue).toBeUndefined();
      expect(resolvedFilter(state.variables[1]!)).toEqual({
        scalar: "eu-west-1",
      });
    });

    test("a second variable changing does not resurrect the first one's default", async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ defaultValue: "prod" }),
        customListVariable({ defaultValue: "eu-west-1" }),
      ]);

      selectValue(await waitForOptions(0), "");
      selectValue(getSelect(1), "us-east-1");

      /*
       * The re-render that the second variable forces is exactly where the
       * first one used to jump back to "prod".
       */
      expect(getSelect(0)).toHaveValue("");
      expect(getSelect(0)).toHaveDisplayValue("All");
      expect(getSelect(1)).toHaveValue("us-east-1");
      expect(state.variables[0]!.selectedValue).toBe("");
    });

    test("the variable label falls back to the name when unset", () => {
      renderToolbar([customListVariable({ label: undefined })]);

      expect(screen.getByText("region")).toBeInTheDocument();
    });
  });

  describe("multi-select variables", () => {
    test('the button reads "All" while nothing is picked, default or not', async () => {
      renderToolbar([
        telemetryVariable({ isMultiSelect: true, defaultValue: "prod" }),
      ]);

      await waitFor((): void => {
        expect(screen.getByRole("button")).not.toBeDisabled();
      });

      expect(screen.getByRole("button")).toHaveTextContent("All");
    });

    test("picking and then clearing values returns the button to All", async () => {
      const state: ToolbarState = renderToolbar([
        telemetryVariable({ isMultiSelect: true, defaultValue: "prod" }),
      ]);

      await waitFor((): void => {
        expect(screen.getByRole("button")).not.toBeDisabled();
      });

      fireEvent.click(screen.getByRole("button"));
      fireEvent.click(screen.getByRole("checkbox", { name: "staging" }));

      expect(state.variables[0]!.selectedValues).toEqual(["staging"]);
      expect(
        screen.getByRole("button", { name: /staging/ }),
      ).toBeInTheDocument();

      fireEvent.click(screen.getByRole("button", { name: "Clear" }));

      expect(state.variables[0]!.selectedValues).toEqual([]);
      expect(screen.getAllByRole("button")[0]).toHaveTextContent("All");
    });
  });

  test("no variables renders nothing at all", () => {
    const { container }: { container: HTMLElement } = render(
      <DashboardVariableSelector
        variables={[]}
        onVariableValueChange={(): void => {
          // Never called: there is nothing to change.
        }}
      />,
    );

    expect(container).toBeEmptyDOMElement();
  });
});
