import DashboardVariableUrlState, {
  VariableUrlSnapshot,
} from "../../../Utils/Dashboard/VariableUrlState";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";

function makeVariable(data: Partial<DashboardVariable>): DashboardVariable {
  return {
    id: data.id || "id",
    name: data.name || "cluster",
    type: data.type || DashboardVariableType.CustomList,
    ...data,
  };
}

describe("DashboardVariableUrlState", () => {
  describe("parseFromSearch", () => {
    test("returns an empty object for an empty search string", () => {
      expect(DashboardVariableUrlState.parseFromSearch("")).toEqual({});
    });

    test("ignores params that are not prefixed with var-", () => {
      const result: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch(
          "?token=abc&filter=on&page=2",
        );
      expect(result).toEqual({});
    });

    test("parses a single-value variable", () => {
      const result: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch("?var-cluster=prod");
      expect(result).toEqual({ cluster: { selectedValue: "prod" } });
    });

    test("works whether or not a leading ? is present", () => {
      expect(
        DashboardVariableUrlState.parseFromSearch("var-cluster=prod"),
      ).toEqual({ cluster: { selectedValue: "prod" } });
    });

    test("parses a comma-separated multi-value variable", () => {
      const result: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch(
          "?var-region=us-east,us-west,eu",
        );
      expect(result).toEqual({
        region: { selectedValues: ["us-east", "us-west", "eu"] },
      });
    });

    test("trims whitespace and drops empty entries in multi-value lists", () => {
      const result: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch("?var-region=a, ,b, c ,");
      expect(result["region"]?.selectedValues).toEqual(["a", "b", "c"]);
    });

    test("skips a var- param with an empty name", () => {
      expect(DashboardVariableUrlState.parseFromSearch("?var-=x")).toEqual({});
    });

    test("decodes url-encoded values", () => {
      const result: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch(
          "?var-service=" + encodeURIComponent("my service"),
        );
      expect(result["service"]?.selectedValue).toBe("my service");
    });

    test("parses several variables together", () => {
      const result: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch(
          "?var-cluster=prod&var-region=a,b&other=1",
        );
      expect(result).toEqual({
        cluster: { selectedValue: "prod" },
        region: { selectedValues: ["a", "b"] },
      });
    });
  });

  describe("applyUrlToVariables", () => {
    test("returns the same variable untouched when the url has no entry", () => {
      const variable: DashboardVariable = makeVariable({ name: "cluster" });
      const result: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables([variable], {});
      expect(result[0]).toBe(variable);
    });

    test("applies a single selected value from the url", () => {
      const variable: DashboardVariable = makeVariable({ name: "cluster" });
      const result: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables([variable], {
          cluster: { selectedValue: "prod" },
        });
      expect(result[0]?.selectedValue).toBe("prod");
      expect(result[0]?.selectedValues).toBeUndefined();
    });

    test("applies multi-selected values from the url", () => {
      const variable: DashboardVariable = makeVariable({ name: "region" });
      const result: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables([variable], {
          region: { selectedValues: ["a", "b"] },
        });
      expect(result[0]?.selectedValues).toEqual(["a", "b"]);
    });

    test("does not mutate the original variable object", () => {
      const variable: DashboardVariable = makeVariable({
        name: "cluster",
        selectedValue: "old",
      });
      DashboardVariableUrlState.applyUrlToVariables([variable], {
        cluster: { selectedValue: "new" },
      });
      expect(variable.selectedValue).toBe("old");
    });

    test("matches url state to variables by name", () => {
      const clusterVar: DashboardVariable = makeVariable({ name: "cluster" });
      const regionVar: DashboardVariable = makeVariable({ name: "region" });
      const result: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables([clusterVar, regionVar], {
          region: { selectedValue: "eu" },
        });
      expect(result[0]?.selectedValue).toBeUndefined();
      expect(result[1]?.selectedValue).toBe("eu");
    });
  });

  describe("parse -> apply round trip", () => {
    test("a shared url reproduces the selection on the variables", () => {
      const variables: Array<DashboardVariable> = [
        makeVariable({ name: "cluster" }),
        makeVariable({ name: "region" }),
      ];

      const fromUrl: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch(
          "?var-cluster=prod&var-region=us,eu",
        );
      const applied: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables(variables, fromUrl);

      expect(applied[0]?.selectedValue).toBe("prod");
      expect(applied[1]?.selectedValues).toEqual(["us", "eu"]);
    });

    /*
     * "All" is the absence of a var- param — writeToBrowserUrl emits
     * nothing for an empty selection, so a reload cannot tell "cleared"
     * from "never touched" and must treat both as All. That only holds
     * because resolveValue ignores defaultValue for a multi-select; if it
     * fell back, a viewer who cleared the popover would silently get the
     * author's Default back on every refresh and on every shared link.
     */
    test("a cleared multi-select survives a url round trip as All", () => {
      window.history.replaceState({}, "", "/dashboard");
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({
          name: "region",
          isMultiSelect: true,
          selectedValues: [],
          defaultValue: "us",
        }),
      ]);

      expect(window.location.search).toBe("");

      const applied: Array<DashboardVariable> =
        DashboardVariableUrlState.applyUrlToVariables(
          [
            makeVariable({
              name: "region",
              isMultiSelect: true,
              defaultValue: "us",
            }),
          ],
          DashboardVariableUrlState.parseFromSearch(window.location.search),
        );

      expect(applied[0]?.selectedValues).toBeUndefined();
      expect(
        DashboardVariableInterpolation.resolveValue(
          applied[0] as DashboardVariable,
        ),
      ).toBeUndefined();
    });
  });

  describe("writeToBrowserUrl", () => {
    /*
     * The test environment is jsdom, so window/history/location exist. Reset
     * the URL before each case so assertions don't leak between tests.
     */
    beforeEach(() => {
      window.history.replaceState({}, "", "/dashboard");
    });

    test("writes a single selected value as a var- param", () => {
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({ name: "cluster", selectedValue: "prod" }),
      ]);
      expect(window.location.search).toBe("?var-cluster=prod");
    });

    test("writes multi-selected values joined by commas", () => {
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({ name: "region", selectedValues: ["us", "eu"] }),
      ]);
      expect(
        DashboardVariableUrlState.parseFromSearch(window.location.search)[
          "region"
        ]?.selectedValues,
      ).toEqual(["us", "eu"]);
    });

    test("preserves unrelated query params while replacing var- params", () => {
      window.history.replaceState({}, "", "/dashboard?token=abc&var-old=gone");
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({ name: "cluster", selectedValue: "prod" }),
      ]);
      const params: URLSearchParams = new URLSearchParams(
        window.location.search,
      );
      expect(params.get("token")).toBe("abc");
      expect(params.get("var-cluster")).toBe("prod");
      // The previously-present var-old must be stripped.
      expect(params.has("var-old")).toBe(false);
    });

    test("omits variables that have no selection", () => {
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({ name: "cluster" }),
      ]);
      expect(window.location.search).toBe("");
    });

    test("does not push a new history entry (uses replaceState)", () => {
      const lengthBefore: number = window.history.length;
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({ name: "cluster", selectedValue: "prod" }),
      ]);
      expect(window.history.length).toBe(lengthBefore);
    });

    test("write -> parse round trip preserves the selection", () => {
      DashboardVariableUrlState.writeToBrowserUrl([
        makeVariable({ name: "cluster", selectedValue: "prod" }),
        makeVariable({ name: "region", selectedValues: ["us", "eu"] }),
      ]);
      const parsed: Record<string, VariableUrlSnapshot> =
        DashboardVariableUrlState.parseFromSearch(window.location.search);
      expect(parsed["cluster"]?.selectedValue).toBe("prod");
      expect(parsed["region"]?.selectedValues).toEqual(["us", "eu"]);
    });
  });
});
