import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
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
 * A dashboard variable has two faces. The control in the toolbar tells the
 * user what the board is scoped to; DashboardVariableInterpolation decides
 * what the widgets actually query. They live in different files, and the
 * only bug they can produce together is disagreement — a control reading
 * "All" over widgets that are quietly filtered.
 *
 * That is exactly what shipped: an empty multi-select fell through to the
 * variable's Default, so the popover's own Clear button applied a filter
 * the popover then described as "All". The contract that closes it:
 *
 *   - A multi-select is its `selectedValues` and nothing else. Empty is
 *     "All". `defaultValue` is a single-select concept.
 *   - A single-select is `selectedValue ?? defaultValue`. The empty string
 *     is the "All" option — a real choice — not an absent one, so `||`
 *     would be wrong on both sides of the contract.
 *
 * Every assertion below drives the real components: the rendered control is
 * read for what the user sees, and the same variable is pushed through the
 * real interpolation for what the server would be asked. Agreement between
 * those two is the invariant, not either one alone.
 */

const getTelemetryAttributeValuesMock: MockFunction = getJestMockFunction();

/*
 * The toolbar selector fetches attribute values on mount for
 * TelemetryAttribute variables. The arrow wrapper is load bearing:
 * jest.mock is hoisted above the compiled requires, so the mock variable
 * above is still unassigned when the factory runs.
 */
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributeValues: (...args: Array<any>) => {
          return getTelemetryAttributeValuesMock(...args);
        },
      },
    };
  },
);

// The public selector reaches the anonymous dashboard API for the same list.
jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve({ data: { values: [] } });
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/Config", () => {
  return {
    __esModule: true,
    PUBLIC_DASHBOARD_API_URL: {
      toString: () => {
        return "https://localhost/api/public-dashboard";
      },
    },
  };
});

import DashboardVariableSelector, {
  VariableValueChange,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariableSelector";
import DashboardVariablesModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal";
import PublicDashboardVariableSelector from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardVariableSelector";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import ObjectID from "../../../Types/ObjectID";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";

const ATTRIBUTE_KEY: string = "k8s.cluster.name";

function makeVariable(
  overrides: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: "var-1",
    name: "cluster",
    label: "Cluster",
    /*
     * CustomList keeps the option list synchronous. The multi-select and
     * single-select branches of the selector are shared by both variable
     * types — only where the options come from differs — so the contract
     * is testable without an async fetch in the middle of it. The
     * TelemetryAttribute path is covered separately below.
     */
    type: DashboardVariableType.CustomList,
    customListValues: "eu-1,us-1,ap-1",
    ...overrides,
  } as DashboardVariable;
}

interface RecordedChange {
  variableId: string;
  change: VariableValueChange;
}

function renderToolbar(variable: DashboardVariable): Array<RecordedChange> {
  const changes: Array<RecordedChange> = [];
  render(
    React.createElement(DashboardVariableSelector, {
      variables: [variable],
      onVariableValueChange: (
        variableId: string,
        change: VariableValueChange,
      ): void => {
        changes.push({ variableId: variableId, change: change });
      },
    }),
  );
  return changes;
}

/** The multi-select popover's trigger — the only button the toolbar draws. */
function popoverButton(): HTMLButtonElement {
  return screen.getByTitle("Cluster") as HTMLButtonElement;
}

function openPopover(): void {
  fireEvent.click(popoverButton());
}

function isUnfiltered(variable: DashboardVariable): boolean {
  return (
    DashboardVariableInterpolation.resolveValue(variable) === undefined &&
    DashboardVariableInterpolation.applyToAttributes(
      { [ATTRIBUTE_KEY]: "already-here" },
      [
        {
          ...variable,
          type: DashboardVariableType.TelemetryAttribute,
          attributeKey: ATTRIBUTE_KEY,
        },
      ],
    )[ATTRIBUTE_KEY] === undefined
  );
}

afterEach(() => {
  cleanup();
  getTelemetryAttributeValuesMock.mockReset();
});

describe("dashboard variable All contract", () => {
  describe("a multi-select shows All exactly when it filters nothing", () => {
    /*
     * The regression, stated as the user meets it: a Default is set, the
     * popover says "All", and the widgets must be unscoped. Before the fix
     * the label said "All" and the query said "prod".
     */
    test("an untouched multi-select with a Default reads All and filters nothing", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        defaultValue: "prod",
      });

      renderToolbar(variable);

      expect(popoverButton()).toHaveTextContent("All");
      expect(isUnfiltered(variable)).toBe(true);
    });

    test("a cleared multi-select with a Default reads All and filters nothing", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "prod",
      });

      renderToolbar(variable);

      expect(popoverButton()).toHaveTextContent("All");
      expect(isUnfiltered(variable)).toBe(true);
    });

    /*
     * A variable that was single-select before the author ticked "Allow
     * multi-select" still carries the scalar it was left on. Neither face
     * of the variable may resurrect it.
     */
    test("a stale scalar under a multi-select changes neither face", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: [],
        selectedValue: "stale",
        defaultValue: "prod",
      });

      renderToolbar(variable);

      expect(popoverButton()).toHaveTextContent("All");
      expect(isUnfiltered(variable)).toBe(true);
    });

    test("one pick names itself on the button and filters", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["eu-1"],
        defaultValue: "prod",
      });

      renderToolbar(variable);

      expect(popoverButton()).toHaveTextContent("eu-1");
      expect(isUnfiltered(variable)).toBe(false);
    });

    test("several picks are counted on the button and filter", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["eu-1", "us-1"],
      });

      renderToolbar(variable);

      expect(popoverButton()).toHaveTextContent("2 selected");
      expect(isUnfiltered(variable)).toBe(false);
    });
  });

  describe("the popover writes back what the contract reads", () => {
    test("Clear emits an empty list, which is the All state", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["eu-1"],
        defaultValue: "prod",
      });

      const changes: Array<RecordedChange> = renderToolbar(variable);
      openPopover();
      fireEvent.click(screen.getByText("Clear"));

      expect(changes).toHaveLength(1);
      expect(changes[0]?.change).toEqual({ selectedValues: [] });

      // And what it wrote is a variable that filters nothing.
      const afterClear: DashboardVariable = {
        ...variable,
        selectedValues: changes[0]?.change.selectedValues,
      };
      expect(isUnfiltered(afterClear)).toBe(true);
    });

    test("Clear is unavailable when there is nothing to clear", () => {
      renderToolbar(
        makeVariable({
          isMultiSelect: true,
          selectedValues: [],
          defaultValue: "prod",
        }),
      );
      openPopover();

      expect(screen.getByText("Clear")).toBeDisabled();
    });

    test("ticking an option emits it and lands on a filtering variable", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "prod",
      });

      const changes: Array<RecordedChange> = renderToolbar(variable);
      openPopover();
      fireEvent.click(screen.getByLabelText("us-1"));

      expect(changes[0]?.change).toEqual({ selectedValues: ["us-1"] });
      expect(isUnfiltered({ ...variable, selectedValues: ["us-1"] })).toBe(
        false,
      );
    });

    test("unticking the last option returns to the All state", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["us-1"],
        defaultValue: "prod",
      });

      const changes: Array<RecordedChange> = renderToolbar(variable);
      openPopover();
      fireEvent.click(screen.getByLabelText("us-1"));

      expect(changes[0]?.change).toEqual({ selectedValues: [] });
      expect(isUnfiltered({ ...variable, selectedValues: [] })).toBe(true);
    });

    /*
     * The popover never sends a scalar, so nothing downstream can mistake
     * a multi-select for one.
     */
    test("the popover never writes selectedValue", () => {
      const changes: Array<RecordedChange> = renderToolbar(
        makeVariable({
          isMultiSelect: true,
          selectedValues: ["eu-1"],
          defaultValue: "prod",
        }),
      );
      openPopover();
      fireEvent.click(screen.getByText("Clear"));
      fireEvent.click(screen.getByLabelText("ap-1"));

      expect(changes.length).toBeGreaterThan(0);
      for (const recorded of changes) {
        expect(recorded.change.selectedValue).toBeUndefined();
        expect(recorded.change.selectedValues).toBeDefined();
      }
    });
  });

  describe("a single-select keeps its Default but not over an explicit All", () => {
    test("an untouched single-select shows its Default and filters on it", () => {
      const variable: DashboardVariable = makeVariable({
        defaultValue: "eu-1",
      });

      renderToolbar(variable);

      expect(screen.getByRole("combobox")).toHaveValue("eu-1");
      expect(isUnfiltered(variable)).toBe(false);
    });

    /*
     * The single-select twin of the same bug: "" is the "All" option's
     * value, and `||` treats it as absent — so the control snapped back to
     * the Default while the widgets stayed unfiltered. `??` keeps them
     * agreeing.
     */
    test("choosing All holds on All rather than snapping to the Default", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "",
        defaultValue: "eu-1",
      });

      renderToolbar(variable);

      expect(screen.getByRole("combobox")).toHaveValue("");
      expect(isUnfiltered(variable)).toBe(true);
    });

    test("choosing All emits an empty scalar", () => {
      const changes: Array<RecordedChange> = renderToolbar(
        makeVariable({ selectedValue: "eu-1", defaultValue: "eu-1" }),
      );

      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "" },
      });

      expect(changes[0]?.change).toEqual({ selectedValue: "" });
    });

    test("a picked value wins over the Default", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "us-1",
        defaultValue: "eu-1",
      });

      renderToolbar(variable);

      expect(screen.getByRole("combobox")).toHaveValue("us-1");
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "us-1",
      });
    });

    test("a cleared text variable stays cleared", () => {
      const variable: DashboardVariable = makeVariable({
        type: DashboardVariableType.TextInput,
        customListValues: undefined,
        selectedValue: "",
        defaultValue: "eu-1",
      });

      renderToolbar(variable);

      expect(screen.getByRole("textbox")).toHaveValue("");
      expect(isUnfiltered(variable)).toBe(true);
    });
  });

  describe("a TelemetryAttribute multi-select follows the same rule", () => {
    test("it reads All once its options arrive, Default or not", async () => {
      getTelemetryAttributeValuesMock.mockReturnValue(
        Promise.resolve(["eu-1", "us-1"]),
      );

      const variable: DashboardVariable = makeVariable({
        type: DashboardVariableType.TelemetryAttribute,
        customListValues: undefined,
        attributeKey: ATTRIBUTE_KEY,
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "prod",
      });

      renderToolbar(variable);

      /*
       * The button reads "Loading…" until the attribute values land. It
       * must settle on "All" — never on the Default — once they do.
       */
      expect(popoverButton()).toHaveTextContent("Loading…");
      await waitFor(() => {
        expect(popoverButton()).toHaveTextContent("All");
      });
      expect(popoverButton()).not.toBeDisabled();
      expect(isUnfiltered(variable)).toBe(true);
    });
  });

  describe("the public dashboard selector follows the same rule", () => {
    function renderPublic(variable: DashboardVariable): Array<string> {
      const values: Array<string> = [];
      render(
        React.createElement(PublicDashboardVariableSelector, {
          variables: [variable],
          dashboardId: new ObjectID("11111111-1111-4111-8111-111111111111"),
          onVariableValueChange: (_id: string, value: string): void => {
            values.push(value);
          },
        }),
      );
      return values;
    }

    test("choosing All holds on All rather than snapping to the Default", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "",
        defaultValue: "eu-1",
      });

      renderPublic(variable);

      expect(screen.getByRole("combobox")).toHaveValue("");
      expect(isUnfiltered(variable)).toBe(true);
    });

    test("an untouched variable still shows its Default", () => {
      renderPublic(makeVariable({ defaultValue: "eu-1" }));

      expect(screen.getByRole("combobox")).toHaveValue("eu-1");
    });
  });

  /*
   * The Default input sits directly beside the "Allow multi-select"
   * checkbox in the editor, which is how an author sets a default that a
   * multi-select can never honour. It has to stop accepting one rather
   * than accept it and ignore it.
   */
  describe("the editor does not offer a Default a multi-select ignores", () => {
    function renderModal(variable: DashboardVariable): void {
      render(
        React.createElement(DashboardVariablesModal, {
          variables: [variable],
          telemetryAttributeOptions: [],
          onClose: (): void => {},
          onSave: (): void => {},
        }),
      );
    }

    function defaultInput(): HTMLInputElement {
      return screen.getByPlaceholderText(
        /^\(none\)$|^All$/,
      ) as HTMLInputElement;
    }

    test("the Default input is disabled for a multi-select", () => {
      renderModal(
        makeVariable({
          type: DashboardVariableType.TelemetryAttribute,
          customListValues: undefined,
          attributeKey: ATTRIBUTE_KEY,
          isMultiSelect: true,
          defaultValue: "prod",
        }),
      );

      expect(defaultInput()).toBeDisabled();
      // The stored value survives so unticking the box restores it.
      expect(defaultInput()).toHaveValue("prod");
    });

    test("the Default input is editable for a single-select", () => {
      renderModal(
        makeVariable({
          type: DashboardVariableType.TelemetryAttribute,
          customListValues: undefined,
          attributeKey: ATTRIBUTE_KEY,
          defaultValue: "prod",
        }),
      );

      expect(defaultInput()).toBeEnabled();
    });

    test("ticking Allow multi-select disables the Default there and then", () => {
      renderModal(
        makeVariable({
          type: DashboardVariableType.TelemetryAttribute,
          customListValues: undefined,
          attributeKey: ATTRIBUTE_KEY,
          defaultValue: "prod",
        }),
      );

      expect(defaultInput()).toBeEnabled();

      fireEvent.click(screen.getByLabelText(/Allow multi-select/));

      expect(defaultInput()).toBeDisabled();
    });
  });
});
