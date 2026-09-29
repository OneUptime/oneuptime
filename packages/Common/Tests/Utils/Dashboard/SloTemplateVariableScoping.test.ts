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
import DashboardModelQueryInterpolation from "../../../Utils/Dashboard/ModelQueryVariableInterpolation";
import {
  resolveSloWidgetSource,
  SloWidgetSource,
  SloWidgetSourceState,
} from "../../../Utils/Dashboard/SloWidgetSource";
import DashboardVariableInterpolation from "../../../Utils/Dashboard/VariableInterpolation";
import { SLO_LIST_ATTRIBUTE_TO_COLUMN } from "../../../Utils/Slo/SloListWidgetFormat";
import { describe, expect, test } from "@jest/globals";

/*
 * What the SLO template's one toolbar variable actually scopes, established by
 * running the REAL resolution code over the REAL template config — never by
 * reading the template's comments.
 *
 * The template promises that one pick scopes the whole board. That promise is
 * three different mechanisms, and getting any one wrong throws nothing — it
 * ships a board whose sections silently disagree about what is selected:
 *
 *   - metric widgets (the Error Budget row) go through
 *     DashboardVariableInterpolation, which writes an attribute predicate;
 *   - the SLO List goes through DashboardModelQueryInterpolation, which
 *     writes a Postgres column predicate only for a key it has a column for
 *     (SLO_LIST_ATTRIBUTE_TO_COLUMN);
 *   - the Selected SLO widgets go through resolveSloWidgetSource, which turns
 *     the selection into the one objective they show.
 *
 * The template's declarative facts — inventory, titles, layout — are pinned in
 * Common/Tests/Types/Dashboard/SloDashboardTemplate.test.ts.
 */

// The bare key SloMetricUtil stamps on every `oneuptime.slo.*` row.
const SLO_NAME_ATTRIBUTE: string = "sloName";

const PICKED_SLO: string = "Checkout API";
const OTHER_SLO: string = "Search API";

/*
 * An attribute the reader could plausibly have added to a widget by hand. It
 * must survive every pick / clear cycle: the SLO variable owns exactly one key.
 */
const UNRELATED_ATTRIBUTE: string = "oneuptime.label.team";

// -- Helpers ---------------------------------------------------------------

type WidgetArguments = Record<string, unknown>;

function getConfig(): DashboardViewConfig {
  const config: DashboardViewConfig | null = getTemplateConfig(
    DashboardTemplateType.Slo,
  );

  expect(config).not.toBeNull();
  return config as DashboardViewConfig;
}

/*
 * Selected by being the template's ONLY variable, never by its key — selecting
 * it by key would make the tests that pin the key true by construction.
 */
function sloVariable(config: DashboardViewConfig): DashboardVariable {
  const variables: Array<DashboardVariable> = config.variables || [];

  expect(variables).toHaveLength(1);
  return variables[0] as DashboardVariable;
}

// The toolbar's single-select writes selectedValue; "" is its All option.
function picked(
  variable: DashboardVariable,
  selectedValue: string,
): DashboardVariable {
  return { ...variable, selectedValue: selectedValue };
}

function argumentsOf(component: DashboardBaseComponent): WidgetArguments {
  return (component.arguments as WidgetArguments | undefined) || {};
}

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

/*
 * Every metric query a widget owns — the primary config and any additional
 * `metricQueryConfigs`, both of which DashboardChartComponent interpolates.
 */
function queryConfigsOf(
  component: DashboardBaseComponent,
): Array<MetricQueryConfigData> {
  const args: WidgetArguments = argumentsOf(component);
  const configs: Array<MetricQueryConfigData> = [];

  if (args["metricQueryConfig"]) {
    configs.push(args["metricQueryConfig"] as MetricQueryConfigData);
  }

  if (Array.isArray(args["metricQueryConfigs"])) {
    configs.push(
      ...(args["metricQueryConfigs"] as Array<MetricQueryConfigData>),
    );
  }

  return configs;
}

function metricWidgets(
  config: DashboardViewConfig,
): Array<DashboardBaseComponent> {
  return config.components.filter(
    (component: DashboardBaseComponent): boolean => {
      return queryConfigsOf(component).length > 0;
    },
  );
}

function filterDataOf(queryConfig: MetricQueryConfigData): WidgetArguments {
  return (queryConfig.metricQueryData?.filterData ||
    {}) as unknown as WidgetArguments;
}

function attributesOf(queryConfig: MetricQueryConfigData): WidgetArguments {
  return (
    (filterDataOf(queryConfig)["attributes"] as WidgetArguments | undefined) ||
    {}
  );
}

/*
 * A filter as one line, so a failure names the offending key and operator.
 * `Includes` renders as IN(...) and anything else as `=` — load-bearing: the
 * server writes `attributes[key] IN (...)` only for a real Includes instance.
 */
function describeFilter(filter: WidgetArguments): string {
  const keys: Array<string> = Object.keys(filter).sort();

  if (keys.length === 0) {
    return "no filter";
  }

  return keys
    .map((key: string): string => {
      const value: unknown = filter[key];

      if (value instanceof Includes) {
        return `${key} IN (${(value.values as Array<string>).join(", ")})`;
      }

      return `${key} = ${String(value)}`;
    })
    .join("; ");
}

function describeMetricWidget(
  component: DashboardBaseComponent,
  variables: Array<DashboardVariable>,
): string {
  return `${titleOf(component)}: ${queryConfigsOf(component)
    .map((queryConfig: MetricQueryConfigData): string => {
      return describeFilter(
        attributesOf(
          DashboardVariableInterpolation.applyToQueryConfig(
            queryConfig,
            variables,
          ),
        ),
      );
    })
    .join(" | ")}`;
}

// The SLO List's base query, as the renderer and the public policy build it.
function sloListBaseQuery(): Record<string, unknown> {
  return { projectId: "project-1", isArchived: false };
}

function describeSloWidget(
  component: DashboardBaseComponent,
  variables: Array<DashboardVariable>,
): string {
  const args: WidgetArguments = argumentsOf(component);
  const source: SloWidgetSource = resolveSloWidgetSource({
    serviceLevelObjectiveId: args["serviceLevelObjectiveId"] as
      | string
      | undefined,
    serviceLevelObjectiveVariableId: args["serviceLevelObjectiveVariableId"] as
      | string
      | undefined,
    variables,
  });

  return `${titleOf(component)}: ${source.state}${
    source.sloName ? ` ${source.sloName}` : ""
  }`;
}

function withStoredAttributes(
  queryConfig: MetricQueryConfigData,
  attributes: WidgetArguments,
): MetricQueryConfigData {
  return {
    ...queryConfig,
    metricQueryData: {
      ...queryConfig.metricQueryData,
      filterData: {
        ...filterDataOf(queryConfig),
        attributes: attributes,
      },
    } as unknown as MetricQueryData,
  };
}

// -- Tests -----------------------------------------------------------------

describe("SLO template variable scoping", () => {
  describe("the binding itself", () => {
    test("is a single-select Telemetry Attribute variable on the bare sloName key", () => {
      const variable: DashboardVariable = sloVariable(getConfig());

      expect(
        `${variable.name} -> ${variable.type} on ${variable.attributeKey} multi=${variable.isMultiSelect === true}`,
      ).toBe(
        `slo -> ${DashboardVariableType.TelemetryAttribute} on ${SLO_NAME_ATTRIBUTE} multi=false`,
      );
    });

    /*
     * The key the variable is declared with is the key the predicate is
     * written under — asserted from the interpolation OUTPUT, which is what
     * the fetch layer compiles into `attributes['sloName'] = ...`.
     */
    test("writes its metric predicate under that bare key and no other", () => {
      const config: DashboardViewConfig = getConfig();
      const keysWritten: Set<string> = new Set<string>();

      for (const widget of metricWidgets(config)) {
        for (const queryConfig of queryConfigsOf(widget)) {
          const applied: MetricQueryConfigData =
            DashboardVariableInterpolation.applyToQueryConfig(queryConfig, [
              picked(sloVariable(config), PICKED_SLO),
            ]);

          for (const key of Object.keys(attributesOf(applied))) {
            keysWritten.add(key);
          }
        }
      }

      expect(Array.from(keysWritten)).toEqual([SLO_NAME_ATTRIBUTE]);
    });

    /*
     * A single-select resolves to a SCALAR equality, never an IN-list — the
     * same shape on the metric store, on the SLO list's name column, and in
     * the one-SLO widgets.
     */
    test("resolves a pick to one scalar value", () => {
      expect(
        DashboardVariableInterpolation.resolveValue(
          picked(sloVariable(getConfig()), PICKED_SLO),
        ),
      ).toEqual({ scalar: PICKED_SLO });
    });
  });

  describe("every widget on the board answers to the toolbar", () => {
    /*
     * The closed classification. A widget family added to the template later
     * has to be placed in one of these routes deliberately, or this fails:
     * there is no fourth route, and a widget the toolbar cannot reach is
     * exactly the "project-wide data beside one objective" the template
     * removed.
     */
    test("metric widgets, the SLO List and the SLO widgets are each reached; only headings are not", () => {
      const config: DashboardViewConfig = getConfig();
      const routes: Array<string> = config.components.map(
        (component: DashboardBaseComponent): string => {
          if (queryConfigsOf(component).length > 0) {
            return `${component.componentType}: metric predicate`;
          }

          if (component.componentType === DashboardComponentType.SloList) {
            return `${component.componentType}: name column`;
          }

          if (component.componentType === DashboardComponentType.Slo) {
            return `${component.componentType}: followed selection`;
          }

          return `${component.componentType}: not reached`;
        },
      );

      expect(Array.from(new Set(routes)).sort()).toEqual(
        [
          `${DashboardComponentType.Chart}: metric predicate`,
          `${DashboardComponentType.Value}: metric predicate`,
          `${DashboardComponentType.SloList}: name column`,
          `${DashboardComponentType.Slo}: followed selection`,
          `${DashboardComponentType.Text}: not reached`,
        ].sort(),
      );
    });
  });

  describe("with the toolbar on All the board is the fleet", () => {
    test("the untouched variable resolves to All", () => {
      expect(
        DashboardVariableInterpolation.resolveValue(sloVariable(getConfig())),
      ).toBeUndefined();
    });

    /*
     * applyToQueryConfig hands back the very same object, so the memoised
     * widgets do not refetch on mount — and no widget gains a filter.
     */
    test("no metric widget's query changes at all", () => {
      const config: DashboardViewConfig = getConfig();
      const variable: DashboardVariable = sloVariable(config);
      const widgets: Array<DashboardBaseComponent> = metricWidgets(config);

      expect(widgets.length).toBeGreaterThan(0);

      for (const widget of widgets) {
        for (const queryConfig of queryConfigsOf(widget)) {
          expect(
            `${titleOf(widget)}: ${
              DashboardVariableInterpolation.applyToQueryConfig(queryConfig, [
                variable,
              ]) === queryConfig
                ? "unchanged"
                : "changed"
            }`,
          ).toBe(`${titleOf(widget)}: unchanged`);
        }
      }
    });

    test("the SLO List keeps its fleet query", () => {
      const query: Record<string, unknown> = sloListBaseQuery();

      expect(
        DashboardModelQueryInterpolation.applyToQuery(
          query,
          [sloVariable(getConfig())],
          SLO_LIST_ATTRIBUTE_TO_COLUMN,
        ),
      ).toBe(query);
    });

    /*
     * The one section that waits — and it waits for the TOOLBAR (NoSelection),
     * not for edit mode (Unconfigured) and not on a broken binding.
     */
    test("every SLO widget asks for a toolbar pick", () => {
      const config: DashboardViewConfig = getConfig();
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(sloWidgets.length).toBeGreaterThan(0);
      expect(
        sloWidgets.map((widget: DashboardBaseComponent): string => {
          return describeSloWidget(widget, config.variables || []);
        }),
      ).toEqual(
        sloWidgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: ${SloWidgetSourceState.NoSelection}`;
        }),
      );
    });

    test("picking All explicitly is the same as never picking", () => {
      const config: DashboardViewConfig = getConfig();
      const all: DashboardVariable = picked(sloVariable(config), "");

      for (const widget of metricWidgets(config)) {
        expect(describeMetricWidget(widget, [all])).toBe(
          `${titleOf(widget)}: no filter`,
        );
      }

      for (const widget of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        expect(describeSloWidget(widget, [all])).toBe(
          `${titleOf(widget)}: ${SloWidgetSourceState.NoSelection}`,
        );
      }
    });
  });

  describe("with one SLO picked the whole board is that SLO", () => {
    test("every metric widget gains the sloName predicate", () => {
      const config: DashboardViewConfig = getConfig();
      const variables: Array<DashboardVariable> = [
        picked(sloVariable(config), PICKED_SLO),
      ];
      const widgets: Array<DashboardBaseComponent> = metricWidgets(config);

      expect(widgets.length).toBeGreaterThan(0);
      expect(
        widgets.map((widget: DashboardBaseComponent): string => {
          return describeMetricWidget(widget, variables);
        }),
      ).toEqual(
        widgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: ${SLO_NAME_ATTRIBUTE} = ${PICKED_SLO}`;
        }),
      );
    });

    test("the SLO List narrows to the objective's row, and still excludes archived SLOs", () => {
      const scoped: Record<string, unknown> =
        DashboardModelQueryInterpolation.applyToQuery(
          sloListBaseQuery(),
          [picked(sloVariable(getConfig()), PICKED_SLO)],
          SLO_LIST_ATTRIBUTE_TO_COLUMN,
        );

      expect(describeFilter(scoped)).toBe(
        `isArchived = false; name = ${PICKED_SLO}; projectId = project-1`,
      );
    });

    test("every SLO widget follows the picked objective", () => {
      const config: DashboardViewConfig = getConfig();
      const variables: Array<DashboardVariable> = [
        picked(sloVariable(config), PICKED_SLO),
      ];
      const sloWidgets: Array<DashboardBaseComponent> = componentsOfType(
        config,
        DashboardComponentType.Slo,
      );

      expect(
        sloWidgets.map((widget: DashboardBaseComponent): string => {
          return describeSloWidget(widget, variables);
        }),
      ).toEqual(
        sloWidgets.map((widget: DashboardBaseComponent): string => {
          return `${titleOf(widget)}: ${SloWidgetSourceState.FollowsSelection} ${PICKED_SLO}`;
        }),
      );
    });

    /*
     * Scoping must not cost a widget its identity: the series, the misspelled
     * `aggegationType` the fetch layer reads, and the per-SLO fan-out all
     * survive. A chart that lost `groupByAttributeKeys` under a pick would
     * collapse to one unlabelled line.
     */
    test("a scoped query keeps its metric, aggregation and fan-out", () => {
      const config: DashboardViewConfig = getConfig();
      const variables: Array<DashboardVariable> = [
        picked(sloVariable(config), PICKED_SLO),
      ];

      for (const widget of metricWidgets(config)) {
        for (const queryConfig of queryConfigsOf(widget)) {
          const applied: MetricQueryConfigData =
            DashboardVariableInterpolation.applyToQueryConfig(
              queryConfig,
              variables,
            );

          expect(filterDataOf(applied)["metricName"]).toBe(
            filterDataOf(queryConfig)["metricName"],
          );
          expect(filterDataOf(applied)["aggegationType"]).toBe(
            filterDataOf(queryConfig)["aggegationType"],
          );
          expect(applied.metricQueryData.groupByAttributeKeys).toEqual(
            queryConfig.metricQueryData.groupByAttributeKeys,
          );
          expect(String(filterDataOf(queryConfig)["metricName"])).not.toBe(
            "undefined",
          );
        }
      }
    });

    /*
     * Interpolation is a render-time transform. Written back into the stored
     * arguments, the first pick would be baked into the dashboard on its next
     * save, and "All" could never undo it.
     */
    test("the stored template config is never written back to", () => {
      const config: DashboardViewConfig = getConfig();
      const before: string = JSON.stringify(config);
      const variables: Array<DashboardVariable> = [
        picked(sloVariable(config), PICKED_SLO),
      ];

      for (const widget of metricWidgets(config)) {
        DashboardVariableInterpolation.applyToQueryConfigs(
          queryConfigsOf(widget),
          variables,
        );
      }

      for (const widget of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        describeSloWidget(widget, variables);
      }

      expect(JSON.stringify(config)).toBe(before);
    });
  });

  describe("moving and clearing the selection", () => {
    test("picking a different SLO replaces the scope rather than adding to it", () => {
      const config: DashboardViewConfig = getConfig();
      const widget: DashboardBaseComponent = metricWidgets(
        config,
      )[0] as DashboardBaseComponent;
      const stored: MetricQueryConfigData = withStoredAttributes(
        queryConfigsOf(widget)[0] as MetricQueryConfigData,
        {
          [SLO_NAME_ATTRIBUTE]: OTHER_SLO,
          [UNRELATED_ATTRIBUTE]: "payments",
        },
      );

      expect(
        describeFilter(
          attributesOf(
            DashboardVariableInterpolation.applyToQueryConfig(stored, [
              picked(sloVariable(config), PICKED_SLO),
            ]),
          ),
        ),
      ).toBe(
        `${UNRELATED_ATTRIBUTE} = payments; ${SLO_NAME_ATTRIBUTE} = ${PICKED_SLO}`,
      );
    });

    /*
     * The toolbar reads "All" the instant it is cleared, so anything still
     * filtered at that moment is filtered behind a control that says it is
     * not. The variable's own key is dropped; the reader's others are kept.
     */
    test("clearing drops the variable's own key and keeps the reader's attributes", () => {
      const config: DashboardViewConfig = getConfig();
      const widget: DashboardBaseComponent = metricWidgets(
        config,
      )[0] as DashboardBaseComponent;
      const stored: MetricQueryConfigData = withStoredAttributes(
        queryConfigsOf(widget)[0] as MetricQueryConfigData,
        {
          [SLO_NAME_ATTRIBUTE]: PICKED_SLO,
          [UNRELATED_ATTRIBUTE]: "payments",
        },
      );

      expect(
        describeFilter(
          attributesOf(
            DashboardVariableInterpolation.applyToQueryConfig(stored, [
              picked(sloVariable(config), ""),
            ]),
          ),
        ),
      ).toBe(`${UNRELATED_ATTRIBUTE} = payments`);
    });

    test("clearing removes a stale name filter from the SLO List", () => {
      const cleared: Record<string, unknown> =
        DashboardModelQueryInterpolation.applyToQuery(
          { ...sloListBaseQuery(), name: OTHER_SLO },
          [picked(sloVariable(getConfig()), "")],
          SLO_LIST_ATTRIBUTE_TO_COLUMN,
        );

      expect(describeFilter(cleared)).toBe(
        "isArchived = false; projectId = project-1",
      );
    });
  });

  describe("variables the reader adds later", () => {
    /*
     * A second Telemetry Attribute variable (say, a team label) still filters
     * the metric charts — that is what it is for — but it must neither move
     * the SLO widgets off the SLO the SLO variable names, nor write a filter
     * onto the SLO List, which has no column for it.
     */
    test("an unrelated attribute variable neither redirects the SLO widgets nor filters the SLO List", () => {
      const config: DashboardViewConfig = getConfig();
      const team: DashboardVariable = {
        id: "team-variable",
        name: "team",
        type: DashboardVariableType.TelemetryAttribute,
        attributeKey: UNRELATED_ATTRIBUTE,
        isMultiSelect: false,
        selectedValue: "payments",
      };
      const variables: Array<DashboardVariable> = [
        picked(sloVariable(config), PICKED_SLO),
        team,
      ];

      for (const widget of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        expect(describeSloWidget(widget, variables)).toBe(
          `${titleOf(widget)}: ${SloWidgetSourceState.FollowsSelection} ${PICKED_SLO}`,
        );
      }

      expect(
        describeFilter(
          DashboardModelQueryInterpolation.applyToQuery(
            sloListBaseQuery(),
            [team],
            SLO_LIST_ATTRIBUTE_TO_COLUMN,
          ),
        ),
      ).toBe("isArchived = false; projectId = project-1");
    });
  });

  describe("why the template ships a single-select", () => {
    /*
     * If a reader switches the variable to multi-select, the metric charts
     * compare the picks — and the one-SLO widgets, which cannot, ask for a
     * single pick instead of guessing. Pinned so that trade-off stays visible.
     */
    test("a multi-pick compares on the charts and leaves the SLO widgets asking for one", () => {
      const config: DashboardViewConfig = getConfig();
      const multi: DashboardVariable = {
        ...sloVariable(config),
        isMultiSelect: true,
        selectedValues: [PICKED_SLO, OTHER_SLO],
      };

      for (const widget of metricWidgets(config)) {
        expect(describeMetricWidget(widget, [multi])).toBe(
          `${titleOf(widget)}: ${SLO_NAME_ATTRIBUTE} IN (${PICKED_SLO}, ${OTHER_SLO})`,
        );
      }

      for (const widget of componentsOfType(
        config,
        DashboardComponentType.Slo,
      )) {
        expect(describeSloWidget(widget, [multi])).toBe(
          `${titleOf(widget)}: ${SloWidgetSourceState.MultipleSelection}`,
        );
      }
    });
  });
});
