import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import {
  getSloWidgetAmbiguousText,
  getSloWidgetNotFoundText,
  resolveSloWidgetSource,
  SLO_WIDGET_MULTIPLE_SELECTION_TEXT,
  SLO_WIDGET_NAME_MATCH_LIMIT,
  SLO_WIDGET_NO_SELECTION_TEXT,
  SLO_WIDGET_VARIABLE_MISSING_TEXT,
  SloWidgetSource,
  SloWidgetSourceState,
} from "../../../Utils/Dashboard/SloWidgetSource";
import { describe, expect, test } from "@jest/globals";

/*
 * resolveSloWidgetSource is the ONE decision about which objective a dashboard
 * SLO widget shows. The renderer and the unauthenticated public-dashboard
 * policy both call it, so every rule below is simultaneously a rendering rule
 * and an access rule: a case that resolves differently than intended here
 * either shows the wrong SLO or serves one the author never published.
 */

const SLO_ID: string = "33333333-3333-4333-8333-333333333333";
const VARIABLE_ID: string = "slo-variable";

type BuildVariableFunction = (
  overrides?: Partial<DashboardVariable>,
) => DashboardVariable;

const buildVariable: BuildVariableFunction = (
  overrides: Partial<DashboardVariable> = {},
): DashboardVariable => {
  return {
    id: VARIABLE_ID,
    name: "slo",
    label: "SLO",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "sloName",
    isMultiSelect: false,
    ...overrides,
  };
};

type ResolveFunction = (data: {
  serviceLevelObjectiveId?: string | undefined | null;
  serviceLevelObjectiveVariableId?: string | undefined | null;
  variables?: Array<DashboardVariable> | undefined;
}) => SloWidgetSource;

const resolve: ResolveFunction = (data: {
  serviceLevelObjectiveId?: string | undefined | null;
  serviceLevelObjectiveVariableId?: string | undefined | null;
  variables?: Array<DashboardVariable> | undefined;
}): SloWidgetSource => {
  return resolveSloWidgetSource(data);
};

describe("resolveSloWidgetSource", () => {
  describe("a pinned SLO", () => {
    test("is shown whatever the toolbar says", () => {
      expect(
        resolve({
          serviceLevelObjectiveId: SLO_ID,
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [buildVariable({ selectedValue: "Checkout API" })],
        }),
      ).toEqual({
        state: SloWidgetSourceState.Pinned,
        serviceLevelObjectiveId: SLO_ID,
      });
    });

    test("wins even when the bound variable is missing or on All", () => {
      for (const variables of [
        undefined,
        [],
        [buildVariable({ selectedValue: "" })],
      ]) {
        expect(
          resolve({
            serviceLevelObjectiveId: SLO_ID,
            serviceLevelObjectiveVariableId: VARIABLE_ID,
            variables,
          }).state,
        ).toBe(SloWidgetSourceState.Pinned);
      }
    });

    test("is trimmed, so the id the widget queries is the id the server validates", () => {
      expect(
        resolve({ serviceLevelObjectiveId: `  ${SLO_ID}  ` })
          .serviceLevelObjectiveId,
      ).toBe(SLO_ID);
    });

    test("does not count when it is blank, so a cleared pin falls back to the variable", () => {
      for (const blank of ["", "   ", null, undefined]) {
        expect(
          resolve({
            serviceLevelObjectiveId: blank,
            serviceLevelObjectiveVariableId: VARIABLE_ID,
            variables: [buildVariable({ selectedValue: "Checkout API" })],
          }),
        ).toEqual({
          state: SloWidgetSourceState.FollowsSelection,
          sloName: "Checkout API",
        });
      }
    });
  });

  describe("an unconfigured widget", () => {
    test("names neither an SLO nor a variable", () => {
      expect(resolve({})).toEqual({ state: SloWidgetSourceState.Unconfigured });
      expect(
        resolve({
          serviceLevelObjectiveId: "",
          serviceLevelObjectiveVariableId: "",
          variables: [buildVariable({ selectedValue: "Checkout API" })],
        }).state,
      ).toBe(SloWidgetSourceState.Unconfigured);
    });

    test("treats a whitespace-only binding as no binding", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: "   ",
          variables: [buildVariable({ selectedValue: "Checkout API" })],
        }).state,
      ).toBe(SloWidgetSourceState.Unconfigured);
    });

    test("never reports a name or an id", () => {
      const source: SloWidgetSource = resolve({});

      expect(source.sloName).toBeUndefined();
      expect(source.serviceLevelObjectiveId).toBeUndefined();
    });
  });

  describe("a binding the dashboard cannot honour", () => {
    test("is reported when the variable is gone", () => {
      for (const variables of [
        undefined,
        [],
        [buildVariable({ id: "some-other-variable", selectedValue: "x" })],
      ]) {
        expect(
          resolve({ serviceLevelObjectiveVariableId: VARIABLE_ID, variables })
            .state,
        ).toBe(SloWidgetSourceState.VariableMissing);
      }
    });

    /*
     * Only Telemetry Attribute selections are resolved from stored config by
     * the public route. A Custom List variable bound here would work in the
     * app and show nothing to an anonymous viewer — so it is refused in both.
     */
    test("is reported for every variable type other than Telemetry Attribute", () => {
      const otherTypes: Array<DashboardVariableType> = Object.values(
        DashboardVariableType,
      ).filter((type: DashboardVariableType): boolean => {
        return type !== DashboardVariableType.TelemetryAttribute;
      });

      expect(otherTypes.length).toBeGreaterThan(0);

      for (const type of otherTypes) {
        expect(
          `${type}: ${
            resolve({
              serviceLevelObjectiveVariableId: VARIABLE_ID,
              variables: [buildVariable({ type, selectedValue: "Checkout" })],
            }).state
          }`,
        ).toBe(`${type}: ${SloWidgetSourceState.VariableMissing}`);
      }
    });

    test("is reported when two variables share the bound id", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [
            buildVariable({ selectedValue: "Checkout API" }),
            buildVariable({ selectedValue: "Search API" }),
          ],
        }).state,
      ).toBe(SloWidgetSourceState.VariableMissing);
    });
  });

  describe("following a single-select variable", () => {
    test("follows the picked SLO name", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [buildVariable({ selectedValue: "Checkout API" })],
        }),
      ).toEqual({
        state: SloWidgetSourceState.FollowsSelection,
        sloName: "Checkout API",
      });
    });

    /*
     * The name is used verbatim. SLO names are free text and the metric
     * attribute carries exactly `slo.name`, so trimming here would look up an
     * objective that does not exist.
     */
    test("passes the name through verbatim", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [buildVariable({ selectedValue: " Checkout  API " })],
        }).sloName,
      ).toBe(" Checkout  API ");
    });

    test("on All shows no SLO, even when the variable has a default", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [
            buildVariable({ selectedValue: "", defaultValue: "Checkout API" }),
          ],
        }).state,
      ).toBe(SloWidgetSourceState.NoSelection);
    });

    test("with no selection and no default shows no SLO", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [buildVariable()],
        }).state,
      ).toBe(SloWidgetSourceState.NoSelection);
    });

    // The same rule every metric widget applies (VariableInterpolation).
    test("uses the default until the reader touches the picker", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [buildVariable({ defaultValue: "Checkout API" })],
        }),
      ).toEqual({
        state: SloWidgetSourceState.FollowsSelection,
        sloName: "Checkout API",
      });
    });
  });

  describe("following a multi-select variable", () => {
    test("follows the one pick when exactly one is made", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [
            buildVariable({
              isMultiSelect: true,
              selectedValues: ["Checkout API"],
            }),
          ],
        }),
      ).toEqual({
        state: SloWidgetSourceState.FollowsSelection,
        sloName: "Checkout API",
      });
    });

    test("refuses to pick one of several", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [
            buildVariable({
              isMultiSelect: true,
              selectedValues: ["Checkout API", "Search API"],
            }),
          ],
        }).state,
      ).toBe(SloWidgetSourceState.MultipleSelection);
    });

    test("ignores empty picks when counting", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [
            buildVariable({
              isMultiSelect: true,
              selectedValues: ["", "Checkout API", ""],
            }),
          ],
        }).sloName,
      ).toBe("Checkout API");
    });

    test("with nothing picked shows no SLO, and never applies a default", () => {
      expect(
        resolve({
          serviceLevelObjectiveVariableId: VARIABLE_ID,
          variables: [
            buildVariable({
              isMultiSelect: true,
              selectedValues: [],
              defaultValue: "Checkout API",
            }),
          ],
        }).state,
      ).toBe(SloWidgetSourceState.NoSelection);
    });
  });

  describe("copy and limits shared with the renderer and the policy", () => {
    /*
     * One row to show and one more to detect a shared name: raising it would
     * publish more rows than a single-SLO widget can render; lowering it would
     * hide ambiguity.
     */
    test("looks a name up with exactly two rows", () => {
      expect(SLO_WIDGET_NAME_MATCH_LIMIT).toBe(2);
    });

    test("points the reader at the toolbar, not at edit mode", () => {
      for (const text of [
        SLO_WIDGET_NO_SELECTION_TEXT,
        SLO_WIDGET_MULTIPLE_SELECTION_TEXT,
      ]) {
        expect(text).toContain("toolbar");
        expect(text.toLowerCase()).not.toContain("click");
      }

      expect(SLO_WIDGET_MULTIPLE_SELECTION_TEXT).toContain("single");
      expect(SLO_WIDGET_VARIABLE_MISSING_TEXT).toContain("Edit the widget");
    });

    test("names the SLO the reader picked in the not-found and ambiguous states", () => {
      expect(getSloWidgetNotFoundText("Checkout API")).toBe(
        "No active SLO is named “Checkout API”.",
      );
      expect(getSloWidgetAmbiguousText("Checkout API")).toContain(
        "More than one SLO is named “Checkout API”",
      );
    });
  });
});
