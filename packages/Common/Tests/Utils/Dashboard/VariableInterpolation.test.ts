import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";

function makeVariable(
  overrides: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: "var-1",
    name: "cluster",
    type: DashboardVariableType.TelemetryAttribute,
    ...overrides,
  } as DashboardVariable;
}

function makeQueryConfig(
  attributes: Record<string, unknown> | undefined,
): MetricQueryConfigData {
  return {
    metricQueryData: {
      filterData: attributes === undefined ? {} : { attributes },
    },
  } as unknown as MetricQueryConfigData;
}

function attributesOf(
  config: MetricQueryConfigData,
): Record<string, unknown> | undefined {
  return config.metricQueryData.filterData.attributes as unknown as
    | Record<string, unknown>
    | undefined;
}

describe("DashboardVariableInterpolation", () => {
  describe("resolveValue", () => {
    test("returns scalar for a single-select with selectedValue", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "prod",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "prod",
      });
    });

    test("falls back to defaultValue when selectedValue is unset", () => {
      const variable: DashboardVariable = makeVariable({
        defaultValue: "staging",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "staging",
      });
    });

    test("prefers selectedValue over defaultValue", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "prod",
        defaultValue: "staging",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "prod",
      });
    });

    test("returns undefined when nothing is selected", () => {
      expect(
        DashboardVariableInterpolation.resolveValue(makeVariable({})),
      ).toBeUndefined();
      expect(
        DashboardVariableInterpolation.resolveValue(
          makeVariable({ selectedValue: "" }),
        ),
      ).toBeUndefined();
    });

    test("returns multi for a multi-select with values", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["a", "b"],
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        multi: ["a", "b"],
      });
    });

    test("filters out empty values in multi-select", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: true,
        selectedValues: ["a", "", "b"],
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        multi: ["a", "b"],
      });
    });

    /*
     * The contract for multi-select, and the reason it is not simply
     * "reuse the single-select fallback": the selector renders "All"
     * whenever `selectedValues` is empty and has no way to render
     * anything else. If an empty list resolved to `defaultValue`, every
     * multi-select variable with a Default would filter its widgets from
     * behind a control that says the widgets are unfiltered — and the
     * popover's own Clear button is the fastest way to get there.
     */
    describe("an empty multi-select means All", () => {
      test("ignores defaultValue when the list is empty", () => {
        const variable: DashboardVariable = makeVariable({
          isMultiSelect: true,
          selectedValues: [],
          defaultValue: "d",
        });
        expect(
          DashboardVariableInterpolation.resolveValue(variable),
        ).toBeUndefined();
      });

      test("ignores defaultValue when the list is unset", () => {
        const variable: DashboardVariable = makeVariable({
          isMultiSelect: true,
          defaultValue: "d",
        });
        expect(
          DashboardVariableInterpolation.resolveValue(variable),
        ).toBeUndefined();
      });

      test("ignores defaultValue when every pick is blank", () => {
        const variable: DashboardVariable = makeVariable({
          isMultiSelect: true,
          selectedValues: ["", ""],
          defaultValue: "d",
        });
        expect(
          DashboardVariableInterpolation.resolveValue(variable),
        ).toBeUndefined();
      });

      /*
       * A variable that was single-select before the author ticked
       * "Allow multi-select" still carries the scalar it was left on.
       * The multi list is the only source of truth once the flag is set,
       * so that stale scalar must not resurface as a filter.
       */
      test("ignores a stale selectedValue left over from single-select", () => {
        const variable: DashboardVariable = makeVariable({
          isMultiSelect: true,
          selectedValues: [],
          selectedValue: "stale",
          defaultValue: "d",
        });
        expect(
          DashboardVariableInterpolation.resolveValue(variable),
        ).toBeUndefined();
      });

      test("still resolves once the user picks something", () => {
        const variable: DashboardVariable = makeVariable({
          isMultiSelect: true,
          selectedValues: ["a"],
          defaultValue: "d",
        });
        expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
          multi: ["a"],
        });
      });
    });

    /*
     * The mirror of the rule above on the single-select side. "" is the
     * value of the selector's "All" option — a real choice — so it must
     * not fall back to the default. `??` draws that line; `||` would not.
     */
    test("an explicit empty scalar is All, not a fallback to the default", () => {
      const variable: DashboardVariable = makeVariable({
        selectedValue: "",
        defaultValue: "staging",
      });
      expect(
        DashboardVariableInterpolation.resolveValue(variable),
      ).toBeUndefined();
    });

    test("defaultValue still applies to a single-select that is untouched", () => {
      expect(
        DashboardVariableInterpolation.resolveValue(
          makeVariable({ defaultValue: "staging", isMultiSelect: false }),
        ),
      ).toEqual({ scalar: "staging" });
    });

    test("an empty defaultValue is not a filter", () => {
      expect(
        DashboardVariableInterpolation.resolveValue(
          makeVariable({ defaultValue: "" }),
        ),
      ).toBeUndefined();
    });

    test("selectedValues on a single-select variable is ignored", () => {
      const variable: DashboardVariable = makeVariable({
        isMultiSelect: false,
        selectedValues: ["a", "b"],
        selectedValue: "prod",
      });
      expect(DashboardVariableInterpolation.resolveValue(variable)).toEqual({
        scalar: "prod",
      });
    });
  });

  describe("applyToAttributes", () => {
    test("returns the same reference when there are no variables", () => {
      const attrs: Record<string, unknown> = { foo: "bar" };
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, undefined),
      ).toBe(attrs);
      expect(DashboardVariableInterpolation.applyToAttributes(attrs, [])).toBe(
        attrs,
      );
    });

    test("injects a scalar attribute for a selected variable", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes({}, [variable]);
      expect(result).toEqual({ "k8s.cluster.name": "prod" });
    });

    test("emits an Includes operator for multi-select", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        isMultiSelect: true,
        selectedValues: ["a", "b"],
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes({}, [variable]);
      const value: unknown = result["k8s.cluster.name"];
      expect(value).toBeInstanceOf(Includes);
      expect((value as Includes).values).toEqual(["a", "b"]);
    });

    test("removes a previously-set filter when selection is cleared (All)", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(
          { "k8s.cluster.name": "prod", other: "keep" },
          [variable],
        );
      expect(result).toEqual({ other: "keep" });
    });

    test("ignores non-TelemetryAttribute variables", () => {
      const attrs: Record<string, unknown> = { foo: "bar" };
      const variable: DashboardVariable = makeVariable({
        type: DashboardVariableType.TextInput,
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("ignores TelemetryAttribute variables without an attributeKey", () => {
      const attrs: Record<string, unknown> = { foo: "bar" };
      const variable: DashboardVariable = makeVariable({
        selectedValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("returns same reference when scalar value is already set", () => {
      const attrs: Record<string, unknown> = { "k8s.cluster.name": "prod" };
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("handles undefined attributes map", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        selectedValue: "prod",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(undefined, [variable]);
      expect(result).toEqual({ "k8s.cluster.name": "prod" });
    });

    /*
     * The user-visible bug this contract exists for: the popover reads
     * "All" the moment the last pick is removed, so the widget has to be
     * unfiltered at that moment too — including dropping the widget's own
     * base filter on that key, exactly as an "All" single-select does.
     */
    test("a cleared multi-select with a default removes the filter", () => {
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "prod",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(
          { "k8s.cluster.name": "staging", other: "keep" },
          [variable],
        );
      expect(result).toEqual({ other: "keep" });
    });

    test("a cleared multi-select with a default adds nothing", () => {
      const attrs: Record<string, unknown> = { other: "keep" };
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "prod",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]);
      expect(result).toBe(attrs);
      expect(result["k8s.cluster.name"]).toBeUndefined();
    });

    test("an untouched multi-select with a default adds nothing", () => {
      const attrs: Record<string, unknown> = {};
      const variable: DashboardVariable = makeVariable({
        attributeKey: "k8s.cluster.name",
        isMultiSelect: true,
        defaultValue: "prod",
      });
      expect(
        DashboardVariableInterpolation.applyToAttributes(attrs, [variable]),
      ).toBe(attrs);
    });

    test("clearing one multi-select does not disturb another variable", () => {
      const cleared: DashboardVariable = makeVariable({
        id: "v1",
        attributeKey: "cluster",
        isMultiSelect: true,
        selectedValues: [],
        defaultValue: "prod",
      });
      const picked: DashboardVariable = makeVariable({
        id: "v2",
        attributeKey: "namespace",
        selectedValue: "default",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes(
          { cluster: "staging" },
          [cleared, picked],
        );
      expect(result).toEqual({ namespace: "default" });
    });

    test("applies multiple variables at once", () => {
      const v1: DashboardVariable = makeVariable({
        id: "v1",
        attributeKey: "cluster",
        selectedValue: "prod",
      });
      const v2: DashboardVariable = makeVariable({
        id: "v2",
        attributeKey: "namespace",
        selectedValue: "default",
      });
      const result: Record<string, unknown> =
        DashboardVariableInterpolation.applyToAttributes({}, [v1, v2]);
      expect(result).toEqual({ cluster: "prod", namespace: "default" });
    });
  });

  /*
   * Metric charts and gauges go through the query-config wrapper rather
   * than calling applyToAttributes directly, so the "All" contract is
   * pinned at that level too — this is the path a user actually watches
   * change when they clear the popover.
   */
  describe("applyToQueryConfig", () => {
    test("injects an Includes for a multi-select with picks", () => {
      const config: MetricQueryConfigData = makeQueryConfig({});
      const result: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(config, [
          makeVariable({
            attributeKey: "k8s.cluster.name",
            isMultiSelect: true,
            selectedValues: ["eu-1", "us-1"],
          }),
        ]);
      const value: unknown = attributesOf(result)?.["k8s.cluster.name"];
      expect(value).toBeInstanceOf(Includes);
      expect((value as Includes).values).toEqual(["eu-1", "us-1"]);
    });

    test("a cleared multi-select with a default leaves the query unfiltered", () => {
      const config: MetricQueryConfigData = makeQueryConfig({
        "k8s.cluster.name": "prod",
      });
      const result: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(config, [
          makeVariable({
            attributeKey: "k8s.cluster.name",
            isMultiSelect: true,
            selectedValues: [],
            defaultValue: "prod",
          }),
        ]);
      expect(attributesOf(result)).toEqual({});
    });

    test("returns the same config reference when nothing changes", () => {
      const config: MetricQueryConfigData = makeQueryConfig({});
      expect(
        DashboardVariableInterpolation.applyToQueryConfig(config, [
          makeVariable({
            attributeKey: "k8s.cluster.name",
            isMultiSelect: true,
            selectedValues: [],
            defaultValue: "prod",
          }),
        ]),
      ).toBe(config);
      expect(
        DashboardVariableInterpolation.applyToQueryConfig(config, []),
      ).toBe(config);
      expect(
        DashboardVariableInterpolation.applyToQueryConfig(config, undefined),
      ).toBe(config);
    });

    test("leaves a config with no filterData alone", () => {
      const config: MetricQueryConfigData = {
        metricQueryData: {},
      } as unknown as MetricQueryConfigData;
      expect(
        DashboardVariableInterpolation.applyToQueryConfig(config, [
          makeVariable({
            attributeKey: "k8s.cluster.name",
            selectedValue: "prod",
          }),
        ]),
      ).toBe(config);
    });

    test("applyToQueryConfigs maps every config", () => {
      const configs: Array<MetricQueryConfigData> = [
        makeQueryConfig({ "k8s.cluster.name": "prod" }),
        makeQueryConfig({ "k8s.cluster.name": "prod", keep: "me" }),
      ];
      const result: Array<MetricQueryConfigData> =
        DashboardVariableInterpolation.applyToQueryConfigs(configs, [
          makeVariable({
            attributeKey: "k8s.cluster.name",
            isMultiSelect: true,
            selectedValues: [],
            defaultValue: "prod",
          }),
        ]);
      expect(attributesOf(result[0] as MetricQueryConfigData)).toEqual({});
      expect(attributesOf(result[1] as MetricQueryConfigData)).toEqual({
        keep: "me",
      });
    });
  });

  /*
   * A query's fallback (MetricQueryConfigData.fallback) is drawn in its
   * place when it has no data, so it is scoped by the same variables: a
   * chart of one cluster falls back to that cluster's running count, never
   * to every cluster's.
   */
  describe("applyToQueryConfig with a fallback", () => {
    function withFallback(
      attributes: Record<string, unknown> | undefined,
      fallbackAttributes: Record<string, unknown> | undefined,
    ): MetricQueryConfigData {
      return {
        ...makeQueryConfig(attributes),
        fallback: {
          queryConfig: makeQueryConfig(fallbackAttributes),
          hint: { text: "Older agents send only the running count." },
        },
      };
    }

    function fallbackOf(config: MetricQueryConfigData): MetricQueryConfigData {
      return config.fallback!.queryConfig;
    }

    const cluster: DashboardVariable = makeVariable({
      attributeKey: "resource.k8s.cluster.name",
      selectedValue: "prod-eu",
    });

    const namespaces: DashboardVariable = makeVariable({
      id: "var-2",
      name: "namespace",
      attributeKey: "resource.k8s.namespace.name",
      isMultiSelect: true,
      selectedValues: ["payments", "checkout"],
    });

    test("applies every variable to the fallback as it does to the query", () => {
      const result: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(
          withFallback({}, {}),
          [cluster, namespaces],
        );

      for (const config of [result, fallbackOf(result)]) {
        expect(attributesOf(config)?.["resource.k8s.cluster.name"]).toBe(
          "prod-eu",
        );
        expect(
          (attributesOf(config)?.["resource.k8s.namespace.name"] as Includes)
            .values,
        ).toEqual(["payments", "checkout"]);
      }

      // The hint travels with it, as stored.
      expect(result.fallback?.hint).toEqual({
        text: "Older agents send only the running count.",
      });
    });

    test("All clears the filter from the fallback too", () => {
      const result: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(
          withFallback(
            { "resource.k8s.cluster.name": "prod-eu" },
            { "resource.k8s.cluster.name": "prod-eu", keep: "me" },
          ),
          [makeVariable({ attributeKey: "resource.k8s.cluster.name" })],
        );

      expect(attributesOf(result)).toEqual({});
      expect(attributesOf(fallbackOf(result))).toEqual({ keep: "me" });
    });

    test("scopes the fallback even when the query already had the value", () => {
      const config: MetricQueryConfigData = withFallback(
        { "resource.k8s.cluster.name": "prod-eu" },
        {},
      );

      const result: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(config, [cluster]);

      expect(result).not.toBe(config);
      expect(result.metricQueryData).toBe(config.metricQueryData);
      expect(attributesOf(fallbackOf(result))).toEqual({
        "resource.k8s.cluster.name": "prod-eu",
      });
    });

    test("returns the same config reference when neither changes", () => {
      const config: MetricQueryConfigData = withFallback(
        { "resource.k8s.cluster.name": "prod-eu" },
        { "resource.k8s.cluster.name": "prod-eu" },
      );

      expect(
        DashboardVariableInterpolation.applyToQueryConfig(config, [cluster]),
      ).toBe(config);
      expect(
        DashboardVariableInterpolation.applyToQueryConfig(config, []),
      ).toBe(config);
    });

    test("leaves the stored config as it was", () => {
      const config: MetricQueryConfigData = withFallback({}, {});
      const before: string = JSON.stringify(config);

      DashboardVariableInterpolation.applyToQueryConfig(config, [
        cluster,
        namespaces,
      ]);

      expect(JSON.stringify(config)).toBe(before);
    });

    test("a fallback with no filter is left alone, and the query still scoped", () => {
      const config: MetricQueryConfigData = {
        ...makeQueryConfig({}),
        fallback: {
          queryConfig: { metricQueryData: {} } as MetricQueryConfigData,
        },
      };

      const result: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(config, [cluster]);

      expect(attributesOf(result)?.["resource.k8s.cluster.name"]).toBe(
        "prod-eu",
      );
      expect(result.fallback).toBe(config.fallback);
    });
  });
});
