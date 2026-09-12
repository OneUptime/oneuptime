import Includes from "../../../Types/BaseDatabase/Includes";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";
import {
  DashboardTemplateType,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricQueryData from "../../../Types/Metrics/MetricQueryData";
import DashboardModelQueryInterpolation, {
  AttributeToColumnMap,
} from "../../../Utils/Dashboard/ModelQueryVariableInterpolation";
import DashboardVariableInterpolation, {
  ResolvedVariableValue,
} from "../../../Utils/Dashboard/VariableInterpolation";
import { describe, expect, test } from "@jest/globals";

/*
 * What the SLO template's Monitor variable actually scopes, established by
 * running the real interpolation code over the real template config rather
 * than by reading the template's comments.
 *
 * The template is two halves. Objective Health and Error Budget Trends read
 * one ServiceLevelObjective by stored id; Monitor Health reads two metric
 * series. Only the second half is reachable by a dashboard variable, and
 * getting that boundary wrong throws nothing — it ships a dashboard whose
 * halves silently disagree about what is selected: uptime narrowed to one
 * monitor, the SLI tile beside it still reporting the whole objective, and
 * no indication which number answers which question.
 *
 * The template's declarative facts — widget inventory, titles, layout,
 * unconfigured SLO ids — are pinned in
 * Common/Tests/Types/Dashboard/SloDashboardTemplate.test.ts. This file only
 * asserts behaviour under DashboardVariableInterpolation (metric widgets)
 * and DashboardModelQueryInterpolation (Postgres-backed list widgets).
 */

/*
 * The attribute key MonitorMetricUtil.buildAttributes stamps onto
 * `oneuptime.monitor.online` and `oneuptime.monitor.response.time`. It is a
 * BARE key: metric attributes written by OneUptime's own monitor workers are
 * not OTel collector resource attributes and carry no prefix.
 */
const MONITOR_ATTRIBUTE: string = "monitorName";

/*
 * The two plausible mis-spellings of that binding. Both fail SILENTLY, which
 * is why they are pinned here rather than left to review:
 *
 * - "resource.monitorName" is the prefix collector-sourced resource
 *   attributes carry. Nothing writes it for these two series, so the
 *   variable's picker would offer no options at all and any value forced
 *   into it would filter on an attribute no row has — every monitor widget
 *   renders empty, with no error anywhere.
 *
 * - "monitorNames" is the PLURAL key IncidentService stamps on incident
 *   metrics, comma-joined ("api-gateway,web-frontend"). It really exists in
 *   the metric store, so the picker would even populate — with comma-joined
 *   lists rather than monitor names — and an IN test for a single monitor
 *   would match none of the uptime rows, emptying exactly the widgets this
 *   variable exists to scope.
 */
const PREFIXED_MONITOR_ATTRIBUTE: string = "resource.monitorName";
const PLURAL_MONITOR_ATTRIBUTE: string = "monitorNames";

/*
 * Two picks on purpose. An objective is normally backed by several monitors,
 * so a single pick would not exercise what the variable is multi-select for.
 */
const PICKED_MONITORS: Array<string> = ["api-gateway", "web-frontend"];

/*
 * An attribute the reader could plausibly have added to a widget by hand
 * before using the toolbar. It has to survive every clear/pick cycle: the
 * Monitor variable owns exactly one key and must not tidy up its neighbours.
 */
const UNRELATED_ATTRIBUTE: string = "probeName";

// -- Helpers ---------------------------------------------------------------

type WidgetArguments = Record<string, unknown>;

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Slo,
  );

  expect(config).not.toBeNull();
  return mutateForFailureCheck(config as DashboardViewConfig);
}

// TEMPORARY mutation harness - removed before commit.
function mutateForFailureCheck(
  config: DashboardViewConfig,
): DashboardViewConfig {
  const mutation: string = process.env["SLO_TEST_MUTATION"] || "";
  const variable: DashboardVariable = (config.variables ||
    [])[0] as DashboardVariable;

  if (mutation === "prefixedKey") {
    variable.attributeKey = "resource.monitorName";
  }

  if (mutation === "multiDefault") {
    variable.defaultValue = "api-gateway";
  }

  if (mutation === "singleSelectDefault") {
    variable.isMultiSelect = false;
    variable.defaultValue = "api-gateway";
  }

  if (mutation === "sloGainsQuery") {
    const slo: DashboardBaseComponent = config.components.filter(
      (component: DashboardBaseComponent): boolean => {
        return component.componentType === DashboardComponentType.Slo;
      },
    )[0] as DashboardBaseComponent;
    (slo.arguments as WidgetArguments)["metricQueryConfig"] = {
      metricQueryData: {
        filterData: { metricName: "x", aggegationType: "Avg" },
      },
    };
  }

  if (mutation === "storedFilter") {
    const widget: DashboardBaseComponent = config.components.filter(
      (component: DashboardBaseComponent): boolean => {
        return component.componentType === DashboardComponentType.Value;
      },
    )[0] as DashboardBaseComponent;
    const queryConfig: WidgetArguments = (widget.arguments as WidgetArguments)[
      "metricQueryConfig"
    ] as WidgetArguments;
    const queryData: WidgetArguments = queryConfig[
      "metricQueryData"
    ] as WidgetArguments;
    (queryData["filterData"] as WidgetArguments)["attributes"] = {
      monitorName: "api-gateway",
    };
  }

  if (mutation === "dropAValueWidget") {
    const index: number = config.components.findIndex(
      (component: DashboardBaseComponent): boolean => {
        return component.componentType === DashboardComponentType.Value;
      },
    );
    config.components.splice(index, 1);
  }

  return config;
}

/*
 * The variable is selected by being the template's ONLY one, never by its
 * attribute key — selecting it by the key would make the tests that pin the
 * key true by construction.
 */
function monitorVariable(config: DashboardViewConfig): DashboardVariable {
  const variables: Array<DashboardVariable> = config.variables || [];

  expect(variables).toHaveLength(1);
  return variables[0] as DashboardVariable;
}

function withSelection(
  variable: DashboardVariable,
  selectedValues: Array<string>,
): DashboardVariable {
  return { ...variable, selectedValues: selectedValues };
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

/*
 * Titles are the only stable handle on a template widget — componentIds are
 * regenerated on every getTemplateConfig call and array positions shift
 * whenever a row is inserted. Each widget family stores its title under a
 * different argument key.
 */
const TITLE_ARGUMENT_KEYS: Array<string> = [
  "title",
  "chartTitle",
  "gaugeTitle",
  "tableTitle",
  "widgetTitle",
  "text",
];

function titleOf(component: DashboardBaseComponent): string {
  const args: WidgetArguments = argumentsOf(component);

  for (const key of TITLE_ARGUMENT_KEYS) {
    const value: unknown = args[key];

    if (typeof value === "string") {
      return value;
    }
  }

  return "";
}

/*
 * Every metric query a widget owns. Chart widgets may carry an additional
 * `metricQueryConfigs` array beside the primary config, and
 * DashboardChartComponent interpolates all of them, so both are collected —
 * a second query added to a chart later is covered without editing here.
 */
function queryConfigsOf(
  component: DashboardBaseComponent,
): Array<MetricQueryConfigData> {
  const args: WidgetArguments = argumentsOf(component);
  const configs: Array<MetricQueryConfigData> = [];
  const primary: unknown = args["metricQueryConfig"];

  if (primary) {
    configs.push(primary as MetricQueryConfigData);
  }

  const additional: unknown = args["metricQueryConfigs"];

  if (Array.isArray(additional)) {
    configs.push(...(additional as Array<MetricQueryConfigData>));
  }

  return configs;
}

// The widgets a TelemetryAttribute variable can reach at all.
function widgetsWithMetricQuery(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return queryConfigsOf(component).length > 0;
    },
  );
}

function widgetsWithoutMetricQuery(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return queryConfigsOf(component).length === 0;
    },
  );
}

function componentsOfType(
  config: DashboardViewConfig,
  componentType: DashboardComponentType,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return component.componentType === componentType;
    },
  );
}

function filterDataOf(queryConfig: MetricQueryConfigData): WidgetArguments {
  return queryConfig.metricQueryData?.filterData as
    | WidgetArguments
    | undefined as WidgetArguments;
}

function attributesOf(queryConfig: MetricQueryConfigData): WidgetArguments {
  const filterData: WidgetArguments = filterDataOf(queryConfig) || {};

  return (filterData["attributes"] as WidgetArguments | undefined) || {};
}

/*
 * A widget's attribute filter rendered as one line, so a failing expectation
 * names the offending key and operator instead of dumping an object graph.
 * `Includes` renders as IN(...) and anything else as a plain assignment —
 * that distinction is load-bearing: the server's WHERE-builder emits
 * `attributes[key] IN (...)` only for an actual Includes instance, so a
 * plain array smuggled in here would read as `= a,b` and fail.
 */
function describeAttributes(queryConfig: MetricQueryConfigData): string {
  const attributes: WidgetArguments = attributesOf(queryConfig);
  const keys: Array<string> = Object.keys(attributes).sort();

  if (keys.length === 0) {
    return "no attribute filter";
  }

  return keys
    .map((key: string): string => {
      const value: unknown = attributes[key];

      if (value instanceof Includes) {
        const values: Array<string> = value.values as Array<string>;
        return `${key} IN (${values.join(", ")})`;
      }

      return `${key} = ${String(value)}`;
    })
    .join("; ");
}

function describeResolved(resolved: ResolvedVariableValue | undefined): string {
  if (!resolved) {
    return "All";
  }

  if (resolved.multi) {
    return `IN (${resolved.multi.join(", ")})`;
  }

  return `= ${String(resolved.scalar)}`;
}

/*
 * The predicate every scoped widget must end up with, written once so the
 * expectation for each widget is "<title>: <this>".
 */
const EXPECTED_PREDICATE: string = `${MONITOR_ATTRIBUTE} IN (${PICKED_MONITORS.join(
  ", ",
)})`;

/*
 * Applies the variables to every query a widget owns and labels the outcome
 * with the widget's title.
 */
function describeWidgetUnderVariables(
  component: DashboardBaseComponent,
  variables: Array<DashboardVariable>,
): string {
  const applied: Array<string> = queryConfigsOf(component).map(
    (queryConfig: MetricQueryConfigData): string => {
      return describeAttributes(
        DashboardVariableInterpolation.applyToQueryConfig(
          queryConfig,
          variables,
        ),
      );
    },
  );

  return `${titleOf(component)}: ${applied.join(" | ")}`;
}

function describeWidgetAsShipped(component: DashboardBaseComponent): string {
  const shipped: Array<string> = queryConfigsOf(component).map(
    (queryConfig: MetricQueryConfigData): string => {
      return describeAttributes(queryConfig);
    },
  );

  return `${titleOf(component)}: ${shipped.join(" | ")}`;
}

function typesPresentIn(
  components: Array<DashboardBaseComponent>,
): Array<string> {
  return Array.from(
    new Set(
      components.map((component: DashboardBaseComponent): string => {
        return component.componentType;
      }),
    ),
  ).sort();
}

function typeBreakdownOf(
  components: Array<DashboardBaseComponent>,
): Array<string> {
  const counts: Record<string, number> = {};

  for (const component of components) {
    counts[component.componentType] =
      (counts[component.componentType] || 0) + 1;
  }

  return Object.keys(counts)
    .sort()
    .map((componentType: string): string => {
      return `${componentType} x ${counts[componentType]}`;
    });
}

/*
 * A saved-dashboard state the template itself never ships: a widget whose
 * stored config already carries an attribute filter, because the reader
 * added one in the widget's own settings before touching the toolbar. Built
 * from a real template query config so the surrounding shape (metricName and
 * the misspelled `aggegationType` key the fetch layer reads) is the real one.
 */
function withStoredAttributes(
  queryConfig: MetricQueryConfigData,
  attributes: WidgetArguments,
): MetricQueryConfigData {
  const filterData: WidgetArguments = filterDataOf(queryConfig) || {};

  return {
    ...queryConfig,
    metricQueryData: {
      ...queryConfig.metricQueryData,
      filterData: {
        ...filterData,
        attributes: attributes,
      },
    } as unknown as MetricQueryData,
  };
}

// -- Tests -----------------------------------------------------------------

describe("SLO template Monitor variable scoping", () => {
  describe("the binding itself", () => {
    /*
     * The variable only reaches a metric query through
     * applyToAttributes' TelemetryAttribute filter. Any other type — a
     * CustomList or Query variable bound to the same key — renders an
     * identical toolbar picker and scopes nothing.
     */
    test("is a TelemetryAttribute variable bound to the bare monitorName key", () => {
      const variable: DashboardVariable = monitorVariable(getConfig());

      expect(
        `${variable.name} -> ${variable.type} on ${variable.attributeKey}`,
      ).toBe(
        `monitor -> ${DashboardVariableType.TelemetryAttribute} on ${MONITOR_ATTRIBUTE}`,
      );
      expect(variable.attributeKey).not.toBe(PREFIXED_MONITOR_ATTRIBUTE);
      expect(variable.attributeKey).not.toBe(PLURAL_MONITOR_ATTRIBUTE);
    });

    /*
     * The key the variable is declared with is the key the predicate is
     * written under — asserted from the interpolation output rather than
     * from the declaration, because that output is what the fetch layer
     * compiles into `attributes['monitorName'] IN (...)`.
     */
    test("writes its predicate under that same bare key and no other", () => {
      const config: DashboardViewConfig = getConfig();
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);

      const keysWritten: Set<string> = new Set<string>();

      for (const widget of widgets) {
        for (const queryConfig of queryConfigsOf(widget)) {
          const applied: MetricQueryConfigData =
            DashboardVariableInterpolation.applyToQueryConfig(queryConfig, [
              withSelection(monitorVariable(config), PICKED_MONITORS),
            ]);

          for (const key of Object.keys(attributesOf(applied))) {
            keysWritten.add(key);
          }
        }
      }

      expect(Array.from(keysWritten).sort()).toEqual([MONITOR_ATTRIBUTE]);
    });

    /*
     * Multi-select is not cosmetic. The toolbar's multi picker writes
     * `selectedValues`, and resolveValue reads that list ONLY when
     * isMultiSelect is set — flip the flag and every pick the reader makes
     * is dropped on the floor while the picker keeps showing them.
     */
    test("is multi-select, which is what makes selectedValues resolve at all", () => {
      const config: DashboardViewConfig = getConfig();
      const picked: DashboardVariable = withSelection(
        monitorVariable(config),
        PICKED_MONITORS,
      );
      const asSingleSelect: DashboardVariable = {
        ...picked,
        isMultiSelect: false,
      };

      expect(
        `multi=${describeResolved(
          DashboardVariableInterpolation.resolveValue(picked),
        )} single=${describeResolved(
          DashboardVariableInterpolation.resolveValue(asSingleSelect),
        )}`,
      ).toBe(`multi=IN (${PICKED_MONITORS.join(", ")}) single=All`);
    });

    /*
     * Why the template ships no defaultValue, in the two ways it could be
     * added:
     *
     * - On this multi-select it is dead config. resolveValue never consults
     *   defaultValue for a multi-select, so the author gets no scoping and
     *   no warning that the field did nothing.
     * - Switched to single-select, the same default is worse than dead: it
     *   applies on first render, so a freshly created dashboard reports one
     *   monitor's uptime beside SLO tiles that report the whole objective.
     */
    test("ships no defaultValue", () => {
      const variable: DashboardVariable = monitorVariable(getConfig());

      expect(
        `${variable.name} multiSelect=${variable.isMultiSelect === true} default=${
          variable.defaultValue ?? "(none)"
        }`,
      ).toBe("monitor multiSelect=true default=(none)");
    });

    test("a defaultValue added to this multi-select would never apply", () => {
      const variable: DashboardVariable = {
        ...monitorVariable(getConfig()),
        defaultValue: PICKED_MONITORS[0] as string,
      };

      expect(
        describeResolved(DashboardVariableInterpolation.resolveValue(variable)),
      ).toBe("All");
    });
  });

  describe("with nothing selected the dashboard is project-wide", () => {
    test("the untouched variable resolves to All", () => {
      const variable: DashboardVariable = monitorVariable(getConfig());

      expect(
        `${variable.name}: ${describeResolved(
          DashboardVariableInterpolation.resolveValue(variable),
        )}`,
      ).toBe("monitor: All");
    });

    /*
     * The same statement at the level the reader actually sees: no widget's
     * query gains a filter, and applyToQueryConfig hands back the very same
     * object so the memoised widgets do not refetch on mount.
     *
     * This is also the test that catches a default being added to the
     * template: a single-select default would turn every line below into
     * "monitorName = ...".
     */
    test("no metric widget's query changes at all", () => {
      const config: DashboardViewConfig = getConfig();
      const variable: DashboardVariable = monitorVariable(config);
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);

      const outcomes: Array<string> = widgets.map(
        (widget: DashboardBaseComponent): string => {
          const results: Array<string> = queryConfigsOf(widget).map(
            (queryConfig: MetricQueryConfigData): string => {
              const applied: MetricQueryConfigData =
                DashboardVariableInterpolation.applyToQueryConfig(queryConfig, [
                  variable,
                ]);

              return applied === queryConfig
                ? "unchanged"
                : describeAttributes(applied);
            },
          );

          return `${titleOf(widget)}: ${results.join(" | ")}`;
        },
      );

      expect(outcomes).toEqual(
        widgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: unchanged`;
        }),
      );
    });

    test("and the widgets ship with no attribute filter of their own", () => {
      const config: DashboardViewConfig = getConfig();
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);
      expect(widgets.map(describeWidgetAsShipped)).toEqual(
        widgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: no attribute filter`;
        }),
      );
    });
  });

  describe("with monitors picked", () => {
    /*
     * The scoped half of the dashboard, established from the config rather
     * than from a list of titles: exactly the widgets that own a metric
     * query are the widgets a TelemetryAttribute variable can reach, and on
     * this template those are the three Monitor Health value tiles and the
     * two monitor charts.
     */
    test("the reachable widgets are exactly the three Value tiles and two Charts", () => {
      const config: DashboardViewConfig = getConfig();
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(typeBreakdownOf(widgets)).toEqual([
        `${DashboardComponentType.Chart} x 2`,
        `${DashboardComponentType.Value} x 3`,
      ]);
    });

    test("every one of them gains an Includes predicate on monitorName", () => {
      const config: DashboardViewConfig = getConfig();
      const picked: DashboardVariable = withSelection(
        monitorVariable(config),
        PICKED_MONITORS,
      );
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);
      expect(
        widgets.map((widget: DashboardBaseComponent): string => {
          return describeWidgetUnderVariables(widget, [picked]);
        }),
      ).toEqual(
        widgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: ${EXPECTED_PREDICATE}`;
        }),
      );
    });

    /*
     * Scoping must not cost the widget its identity. `metricName` says which
     * series to read and the aggregation is stored under the MISSPELLED key
     * `aggegationType` — that misspelling is the contract the fetch layer
     * reads, so a rewrite that dropped or corrected it would return an
     * unaggregated (or empty) result for a widget that still looks right.
     */
    test("the scoped query keeps its metric name and its aggegationType key", () => {
      const config: DashboardViewConfig = getConfig();
      const picked: DashboardVariable = withSelection(
        monitorVariable(config),
        PICKED_MONITORS,
      );
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);

      const before: Array<string> = [];
      const after: Array<string> = [];

      for (const widget of widgets) {
        for (const queryConfig of queryConfigsOf(widget)) {
          const shipped: WidgetArguments = filterDataOf(queryConfig);
          const applied: WidgetArguments = filterDataOf(
            DashboardVariableInterpolation.applyToQueryConfig(queryConfig, [
              picked,
            ]),
          );

          before.push(
            `${titleOf(widget)}: ${String(shipped["metricName"])} / ${String(
              shipped["aggegationType"],
            )}`,
          );
          after.push(
            `${titleOf(widget)}: ${String(applied["metricName"])} / ${String(
              applied["aggegationType"],
            )}`,
          );
        }
      }

      expect(after).toEqual(before);
      // Guards the comparison above from passing on two lists of undefineds.
      for (const line of before) {
        expect(line).not.toContain("undefined");
      }
    });

    /*
     * Interpolation is a render-time transform. If it wrote back into the
     * component's stored arguments, the first selection would be baked into
     * the dashboard the next time it was saved — and clearing the toolbar
     * afterwards would not undo it, because "All" only removes the filter
     * from the copy it is building.
     */
    test("the stored template config is never written back to", () => {
      const config: DashboardViewConfig = getConfig();
      const picked: DashboardVariable = withSelection(
        monitorVariable(config),
        PICKED_MONITORS,
      );
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);

      const shipped: Array<string> = widgets.map(describeWidgetAsShipped);

      for (const widget of widgets) {
        DashboardVariableInterpolation.applyToQueryConfigs(
          queryConfigsOf(widget),
          [picked],
        );
      }

      expect(widgets.map(describeWidgetAsShipped)).toEqual(shipped);
      expect(shipped).toEqual(
        widgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: no attribute filter`;
        }),
      );
    });
  });

  describe("the widgets the variable cannot reach", () => {
    /*
     * The unscoped half. A Slo widget resolves one objective from the
     * serviceLevelObjectiveId stored on it and issues no metric query, so
     * there is nothing for a TelemetryAttribute variable to interpolate —
     * picking a monitor narrows the uptime row and leaves every SLO number
     * reporting the whole objective, which is the correct reading of both.
     */
    test("no Slo widget owns a metric query", () => {
      const config: DashboardViewConfig = getConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);
      expect(
        sloWidgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: ${queryConfigsOf(widget).length} metric queries`;
        }),
      ).toEqual(
        sloWidgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: 0 metric queries`;
        }),
      );
    });

    /*
     * Stated as a closed set so a widget family added to this template later
     * has to be classified deliberately: everything outside the metric half
     * is a Text row, an Slo widget, or one of the three Postgres-backed
     * lists. All of them are immune to the Monitor variable, and the lists
     * are additionally project-wide and time-range-free — which is why they
     * are titled "All Monitors" / "Latest ..." rather than anything that
     * implies the toolbar narrows them.
     */
    test("the unreachable widgets are only text rows, Slo widgets and the model-backed lists", () => {
      const config: DashboardViewConfig = getConfig();
      const widgets: Array<DashboardBaseComponent> =
        widgetsWithoutMetricQuery(config);

      expect(widgets.length).toBeGreaterThan(0);
      expect(typesPresentIn(widgets)).toEqual(
        [
          DashboardComponentType.AlertList,
          DashboardComponentType.IncidentList,
          DashboardComponentType.MonitorList,
          DashboardComponentType.Slo,
          DashboardComponentType.Text,
        ].sort(),
      );
    });

    /*
     * The list widgets query Postgres by column, not by OTel attribute, so
     * they are interpolated — if at all — through
     * DashboardModelQueryInterpolation, which writes a predicate only for
     * attribute keys the widget itself declares a column for. None of the
     * three lists on this template declares one for `monitorName` (the list
     * components never call the helper, and the public-dashboard monitor
     * policy ships no attributeToColumn map), so a picked Monitor variable
     * leaves their queries byte-identical.
     *
     * The second half of the test is what keeps the first from being
     * vacuous: the very same variable DOES write a predicate the moment a
     * map claims the key, so what withholds it is the missing mapping and
     * not something inert about the variable.
     */
    test("a picked Monitor variable writes no model-query predicate unless a widget maps the key", () => {
      const config: DashboardViewConfig = getConfig();
      const picked: DashboardVariable = withSelection(
        monitorVariable(config),
        PICKED_MONITORS,
      );
      const query: Record<string, unknown> = { projectId: "project-1" };

      const unmapped: AttributeToColumnMap = { "host.name": "hostname" };
      expect(
        DashboardModelQueryInterpolation.applyToQuery(
          query,
          [picked],
          unmapped,
        ),
      ).toBe(query);

      const mapped: AttributeToColumnMap = { [MONITOR_ATTRIBUTE]: "name" };
      const scoped: Record<string, unknown> =
        DashboardModelQueryInterpolation.applyToQuery(query, [picked], mapped);

      expect(scoped["name"]).toBeInstanceOf(Includes);
      expect((scoped["name"] as Includes).values).toEqual(PICKED_MONITORS);
    });
  });

  describe("clearing the selection", () => {
    /*
     * The failure this prevents: the popover reads "All" the instant the
     * last pick is removed, so anything still filtered at that moment is
     * filtered behind a control that says it is not. A stored filter on the
     * variable's own key is therefore dropped, not merely left alone —
     * while every other attribute on the widget is left exactly as the
     * reader set it.
     */
    test("removes a stored monitorName filter and keeps the reader's other attributes", () => {
      const config: DashboardViewConfig = getConfig();
      const widget: DashboardBaseComponent = widgetsWithMetricQuery(
        config,
      )[0] as DashboardBaseComponent;
      const storedQuery: MetricQueryConfigData = withStoredAttributes(
        queryConfigsOf(widget)[0] as MetricQueryConfigData,
        {
          [MONITOR_ATTRIBUTE]: "api-gateway",
          [UNRELATED_ATTRIBUTE]: "us-west",
        },
      );

      const cleared: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(storedQuery, [
          withSelection(monitorVariable(config), []),
        ]);

      expect(`${titleOf(widget)}: ${describeAttributes(storedQuery)}`).toBe(
        `${titleOf(widget)}: ${MONITOR_ATTRIBUTE} = api-gateway; ${UNRELATED_ATTRIBUTE} = us-west`,
      );
      expect(`${titleOf(widget)}: ${describeAttributes(cleared)}`).toBe(
        `${titleOf(widget)}: ${UNRELATED_ATTRIBUTE} = us-west`,
      );
    });

    /*
     * The other direction, so the removal above cannot be mistaken for the
     * variable simply never writing: re-picking replaces the stale scalar
     * with the IN predicate rather than leaving both, or ANDing them.
     */
    test("re-picking replaces a stale scalar rather than adding to it", () => {
      const config: DashboardViewConfig = getConfig();
      const widget: DashboardBaseComponent = widgetsWithMetricQuery(
        config,
      )[0] as DashboardBaseComponent;
      const storedQuery: MetricQueryConfigData = withStoredAttributes(
        queryConfigsOf(widget)[0] as MetricQueryConfigData,
        {
          [MONITOR_ATTRIBUTE]: "some-other-monitor",
          [UNRELATED_ATTRIBUTE]: "us-west",
        },
      );

      const scoped: MetricQueryConfigData =
        DashboardVariableInterpolation.applyToQueryConfig(storedQuery, [
          withSelection(monitorVariable(config), PICKED_MONITORS),
        ]);

      expect(`${titleOf(widget)}: ${describeAttributes(scoped)}`).toBe(
        `${titleOf(widget)}: ${EXPECTED_PREDICATE}; ${UNRELATED_ATTRIBUTE} = us-west`,
      );
    });
  });
});
