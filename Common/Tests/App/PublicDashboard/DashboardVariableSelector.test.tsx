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
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The public (anonymous) dashboard carries its own copy of the variable
 * selector, and it carried its own copy of the same defect: `||` folded the
 * empty string that "All" emits back into defaultValue, so the control snapped
 * to "prod" while the widgets, which read the selection through
 * Common/Utils/Dashboard/VariableInterpolation.ts (`??`), went on showing
 * everything unfiltered.
 *
 * A shared viewer has no way out of that — there is no edit mode, no variables
 * modal, nothing to reset. Which is why this copy gets its own tests rather
 * than being treated as covered by the private dashboard's.
 */

const apiPostMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the compiled
 * requires, so the mock variable above is still unassigned when the factory
 * runs. Dereferencing it lazily, at call time, is what makes this work.
 */
jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>): unknown => {
        return apiPostMock(...args);
      },
    },
  };
});

import DashboardVariableSelector from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardVariableSelector";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../../../Utils/Dashboard/VariableInterpolation";
import ObjectID from "../../../Types/ObjectID";

const DASHBOARD_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
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
    type: DashboardVariableType.TextInput,
    ...overrides,
  };
};

/*
 * Verbatim from DashboardViewPage.tsx: the page stores whatever the selector
 * hands it, empty string included, and re-renders. That round trip is where
 * the value used to change out from under the user.
 */
interface ViewerState {
  variables: Array<DashboardVariable>;
  changes: Array<{ variableId: string; value: string }>;
}

interface HarnessProps {
  state: ViewerState;
}

const ViewerHarness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const [variables, setVariables] = React.useState<Array<DashboardVariable>>(
    props.state.variables,
  );

  return (
    <DashboardVariableSelector
      variables={variables}
      dashboardId={DASHBOARD_ID}
      onVariableValueChange={(variableId: string, value: string) => {
        const updated: Array<DashboardVariable> = variables.map(
          (v: DashboardVariable): DashboardVariable => {
            if (v.id === variableId) {
              return { ...v, selectedValue: value };
            }
            return v;
          },
        );
        props.state.changes.push({ variableId: variableId, value: value });
        props.state.variables = updated;
        setVariables(updated);
      }}
    />
  );
};

type RenderViewerFunction = (
  variables: Array<DashboardVariable>,
) => ViewerState;

const renderViewer: RenderViewerFunction = (
  variables: Array<DashboardVariable>,
): ViewerState => {
  const state: ViewerState = { variables: variables, changes: [] };
  render(<ViewerHarness state={state} />);
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

type ResolveFunction = (
  variable: DashboardVariable,
) => ResolvedVariableValue | undefined;

const resolvedFilter: ResolveFunction = (
  variable: DashboardVariable,
): ResolvedVariableValue | undefined => {
  return DashboardVariableInterpolation.resolveValue(variable);
};

beforeEach((): void => {
  apiPostMock.mockReset();
  apiPostMock.mockResolvedValue({ data: { values: OPTIONS } });
});

afterEach((): void => {
  cleanup();
});

describe("Public dashboard variable selector", () => {
  describe('picking "All" on a variable that has a default', () => {
    test('the select stays on "All" instead of snapping back to the default', async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(select).toHaveValue("prod");

      selectValue(select, "");

      expect(getSelect()).toHaveValue("");
      expect(getSelect()).toHaveDisplayValue("All");
      expect(state.variables[0]!.selectedValue).toBe("");
      expect(state.changes).toEqual([{ variableId: "cluster", value: "" }]);
    });

    test("what the viewer reads and what the widgets query agree", async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");

      expect(getSelect()).toHaveDisplayValue("All");
      expect(resolvedFilter(state.variables[0]!)).toBeUndefined();
      expect(
        DashboardVariableInterpolation.applyToAttributes(
          { [ATTRIBUTE_KEY]: "prod" },
          state.variables,
        ),
      ).toEqual({});
    });

    test("the user can pick a real value again afterwards", async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");

      /*
       * Load bearing: without this the test passes on the pre-fix code too,
       * because it never looks at the control between the two picks.
       */
      expect(getSelect()).toHaveDisplayValue("All");

      selectValue(getSelect(), "staging");

      expect(getSelect()).toHaveValue("staging");
      expect(resolvedFilter(state.variables[0]!)).toEqual({
        scalar: "staging",
      });
    });

    test('"All" survives a round trip through a concrete value', async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      selectValue(await waitForOptions(), "");
      selectValue(getSelect(), "staging");
      selectValue(getSelect(), "");

      expect(getSelect()).toHaveDisplayValue("All");
      expect(state.variables[0]!.selectedValue).toBe("");
    });

    test('a variable restored with an empty selection opens on "All"', async () => {
      renderViewer([
        telemetryVariable({ defaultValue: "prod", selectedValue: "" }),
      ]);

      expect(await waitForOptions()).toHaveDisplayValue("All");
    });
  });

  describe("the default value still works", () => {
    test("an untouched variable shows and queries its default", async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
      ]);

      expect(await waitForOptions()).toHaveValue("prod");
      expect(resolvedFilter(state.variables[0]!)).toEqual({ scalar: "prod" });
    });

    test("a selected value takes precedence over the default", async () => {
      renderViewer([
        telemetryVariable({ defaultValue: "prod", selectedValue: "staging" }),
      ]);

      expect(await waitForOptions()).toHaveValue("staging");
    });

    test('a variable with no default and no selection opens on "All"', async () => {
      renderViewer([telemetryVariable({})]);

      expect(await waitForOptions()).toHaveValue("");
    });
  });

  describe("fetching the options", () => {
    test("values are requested from the public endpoint for this dashboard", async () => {
      renderViewer([telemetryVariable({ defaultValue: "prod" })]);

      await waitForOptions();

      expect(apiPostMock).toHaveBeenCalledTimes(1);

      const call: { url: { toString: () => string }; data: unknown } =
        apiPostMock.mock.calls[0]![0] as {
          url: { toString: () => string };
          data: unknown;
        };

      expect(call.url.toString()).toContain(
        `/public-dashboard-api/attribute-values/${DASHBOARD_ID.toString()}`,
      );
      expect(call.data).toEqual({ attributeKey: ATTRIBUTE_KEY });
    });

    test("options render once the response arrives", async () => {
      renderViewer([telemetryVariable({})]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(optionLabels(select)).toEqual(["All", "prod", "staging"]);
    });

    test('a failed fetch leaves the control usable and on "All"', async () => {
      apiPostMock.mockRejectedValue(new Error("forbidden"));

      renderViewer([telemetryVariable({ defaultValue: "prod" })]);

      const select: HTMLSelectElement = await waitForOptions();

      expect(optionLabels(select)).toEqual(["All"]);
      expect(select).toHaveValue("");
    });

    test("a response with no values yields just the All option", async () => {
      apiPostMock.mockResolvedValue({ data: {} });

      renderViewer([telemetryVariable({})]);

      expect(optionLabels(await waitForOptions())).toEqual(["All"]);
    });
  });

  describe("custom list variables", () => {
    test("options come from the comma-separated list, trimmed", () => {
      renderViewer([customListVariable({ defaultValue: "eu-west-1" })]);

      expect(optionLabels(getSelect())).toEqual([
        "All",
        "eu-west-1",
        "us-east-1",
      ]);
      expect(getSelect()).toHaveValue("eu-west-1");
    });

    test('picking "All" stays on "All"', () => {
      const state: ViewerState = renderViewer([
        customListVariable({ defaultValue: "eu-west-1" }),
      ]);

      selectValue(getSelect(), "");

      expect(getSelect()).toHaveDisplayValue("All");
      expect(state.variables[0]!.selectedValue).toBe("");
    });

    test("no request is made for a custom list", () => {
      renderViewer([customListVariable({})]);

      expect(apiPostMock).not.toHaveBeenCalled();
    });
  });

  describe("free-text variables", () => {
    test("the default is shown until the viewer types", () => {
      renderViewer([textVariable({ defaultValue: "checkout" })]);

      expect(getTextInput()).toHaveValue("checkout");
    });

    test("clearing the box leaves it empty instead of restoring the default", () => {
      const state: ViewerState = renderViewer([
        textVariable({ defaultValue: "checkout" }),
      ]);

      fireEvent.change(getTextInput(), { target: { value: "" } });

      expect(getTextInput()).toHaveValue("");
      expect(state.variables[0]!.selectedValue).toBe("");
      expect(resolvedFilter(state.variables[0]!)).toBeUndefined();
    });

    test("typing replaces the default and is stored", () => {
      const state: ViewerState = renderViewer([
        textVariable({ defaultValue: "checkout" }),
      ]);

      fireEvent.change(getTextInput(), { target: { value: "payments" } });

      expect(getTextInput()).toHaveValue("payments");
      expect(state.variables[0]!.selectedValue).toBe("payments");
    });
  });

  describe("several variables on one dashboard", () => {
    test("each is labelled with its variable name", () => {
      renderViewer([customListVariable({}), textVariable({})]);

      expect(screen.getByText("region:")).toBeInTheDocument();
      expect(screen.getByText("service:")).toBeInTheDocument();
    });

    test('picking "All" on one leaves the others on their defaults', async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
        customListVariable({ defaultValue: "eu-west-1" }),
      ]);

      selectValue(await waitForOptions(0), "");

      expect(getSelect(0)).toHaveDisplayValue("All");
      expect(getSelect(1)).toHaveValue("eu-west-1");
      expect(state.variables[1]!.selectedValue).toBeUndefined();
    });

    test("a second variable changing does not resurrect the first one's default", async () => {
      const state: ViewerState = renderViewer([
        telemetryVariable({ defaultValue: "prod" }),
        customListVariable({ defaultValue: "eu-west-1" }),
      ]);

      selectValue(await waitForOptions(0), "");
      selectValue(getSelect(1), "us-east-1");

      expect(getSelect(0)).toHaveDisplayValue("All");
      expect(getSelect(1)).toHaveValue("us-east-1");
      expect(state.variables[0]!.selectedValue).toBe("");
    });
  });
});
