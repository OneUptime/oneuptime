import { describe, expect, test } from "@jest/globals";
import {
  ComponentArgumentSection,
  ComponentInputType,
} from "../../../../Types/Dashboard/DashboardComponents/ComponentArgument";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import { DataSourceValueReduce } from "../../../../Types/Dashboard/DashboardComponents/DashboardDataSourceValueComponent";
import DashboardComponentType, {
  DataSourceComponentTypes,
} from "../../../../Types/Dashboard/DashboardComponentType";
import DataSourceQueryConfig from "../../../../Types/DataSource/DataSourceQueryConfig";
import BadDataException from "../../../../Types/Exception/BadDataException";
import { ObjectType } from "../../../../Types/JSON";
import DashboardDataSourceChartComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceGaugeComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceGaugeComponent";
import { DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS } from "../../../../Utils/Dashboard/Components/DashboardDataSourceShared";
import DashboardDataSourceTableComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";
import DashboardDataSourceValueComponentUtil from "../../../../Utils/Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardComponentsUtil from "../../../../Utils/Dashboard/Components/Index";

/*
 * The four Data Source widgets (Chart / Value / Gauge / Table) were split out
 * of the metric widgets, where external queries used to live as an alternative
 * mode of the same component. Two things about that split are easy to get
 * wrong and impossible to catch with the compiler:
 *
 *  - A new widget type can be added to the DashboardComponentType enum and
 *    shipped with a util, but never wired into the if/else chain in
 *    Components/Index.ts. The settings panel then throws BadDataException the
 *    moment a user opens the widget's config.
 *  - The metric inputs (MetricsQueryConfig, TableColumns, ...) can be copied
 *    across when a Data Source widget is written by cloning its metric
 *    sibling. A Data Source widget that renders a metric-query editor is the
 *    exact confusion the split was meant to remove — and it would render an
 *    editor writing to an argument the renderer never reads.
 *
 * Defaults matter for the same reason: a widget is dropped on the canvas
 * before it is configured, so the seeded query must be blank (the canvas keys
 * "unconfigured" off an empty dataSourceId) and the whole component must
 * survive JSON.stringify, because it is persisted inside the dashboard's
 * JSONB view-config column rather than as its own table.
 */

interface DropdownOptionView {
  label: string;
  value: unknown;
}

/*
 * A structural view of ComponentArgument that drops the `keyof T["arguments"]`
 * id typing, so all four widgets' argument lists can be walked by one loop.
 */
interface ConfigArgumentView {
  name: string;
  description: string;
  required: boolean;
  type: ComponentInputType;
  id: string;
  isAdvanced?: boolean | undefined;
  placeholder?: string | undefined;
  section?: ComponentArgumentSection | undefined;
  dropdownOptions?: Array<DropdownOptionView> | undefined;
}

type AsArgumentViewsFunction = (
  componentArguments: unknown,
) => Array<ConfigArgumentView>;

const asArgumentViews: AsArgumentViewsFunction = (
  componentArguments: unknown,
): Array<ConfigArgumentView> => {
  return componentArguments as Array<ConfigArgumentView>;
};

type GetDefaultComponentFunction = () => DashboardBaseComponent;
type GetConfigArgumentsFunction = () => Array<ConfigArgumentView>;
type GetSeededQueriesFunction = (
  component: DashboardBaseComponent,
) => Array<DataSourceQueryConfig>;

interface DataSourceWidgetCase {
  label: string;
  componentType: DashboardComponentType;
  getDefaultComponent: GetDefaultComponentFunction;
  getConfigArguments: GetConfigArgumentsFunction;
  getSeededQueries: GetSeededQueriesFunction;
}

type GetSingleQueryFunction = (
  component: DashboardBaseComponent,
) => Array<DataSourceQueryConfig>;

// Value / Gauge / Table hold one query; the chart holds a list of them.
const getSingleQuery: GetSingleQueryFunction = (
  component: DashboardBaseComponent,
): Array<DataSourceQueryConfig> => {
  const componentArguments: { query?: DataSourceQueryConfig | undefined } =
    component.arguments as { query?: DataSourceQueryConfig | undefined };

  return componentArguments.query ? [componentArguments.query] : [];
};

const WIDGET_CASES: Array<DataSourceWidgetCase> = [
  {
    label: "DataSourceChart",
    componentType: DashboardComponentType.DataSourceChart,
    getDefaultComponent: (): DashboardBaseComponent => {
      return DashboardDataSourceChartComponentUtil.getDefaultComponent();
    },
    getConfigArguments: (): Array<ConfigArgumentView> => {
      return asArgumentViews(
        DashboardDataSourceChartComponentUtil.getComponentConfigArguments(),
      );
    },
    getSeededQueries: (
      component: DashboardBaseComponent,
    ): Array<DataSourceQueryConfig> => {
      const componentArguments: {
        queries?: Array<DataSourceQueryConfig> | undefined;
      } = component.arguments as {
        queries?: Array<DataSourceQueryConfig> | undefined;
      };

      return componentArguments.queries || [];
    },
  },
  {
    label: "DataSourceValue",
    componentType: DashboardComponentType.DataSourceValue,
    getDefaultComponent: (): DashboardBaseComponent => {
      return DashboardDataSourceValueComponentUtil.getDefaultComponent();
    },
    getConfigArguments: (): Array<ConfigArgumentView> => {
      return asArgumentViews(
        DashboardDataSourceValueComponentUtil.getComponentConfigArguments(),
      );
    },
    getSeededQueries: getSingleQuery,
  },
  {
    label: "DataSourceGauge",
    componentType: DashboardComponentType.DataSourceGauge,
    getDefaultComponent: (): DashboardBaseComponent => {
      return DashboardDataSourceGaugeComponentUtil.getDefaultComponent();
    },
    getConfigArguments: (): Array<ConfigArgumentView> => {
      return asArgumentViews(
        DashboardDataSourceGaugeComponentUtil.getComponentConfigArguments(),
      );
    },
    getSeededQueries: getSingleQuery,
  },
  {
    label: "DataSourceTable",
    componentType: DashboardComponentType.DataSourceTable,
    getDefaultComponent: (): DashboardBaseComponent => {
      return DashboardDataSourceTableComponentUtil.getDefaultComponent();
    },
    getConfigArguments: (): Array<ConfigArgumentView> => {
      return asArgumentViews(
        DashboardDataSourceTableComponentUtil.getComponentConfigArguments(),
      );
    },
    getSeededQueries: getSingleQuery,
  },
];

/*
 * Input types that belong exclusively to the OneUptime-telemetry widgets. A
 * Data Source widget must expose none of them.
 */
const METRIC_ONLY_INPUT_TYPES: Array<ComponentInputType> = [
  ComponentInputType.MetricsQueryConfig,
  ComponentInputType.MetricsQueryConfigs,
  ComponentInputType.MetricsFormulaConfigs,
  ComponentInputType.TableColumns,
  ComponentInputType.TableGroupBy,
];

for (const widgetCase of WIDGET_CASES) {
  describe(`${widgetCase.label} widget util`, () => {
    test("declares its own component type and marks itself as a dashboard component", () => {
      const component: DashboardBaseComponent =
        widgetCase.getDefaultComponent();

      expect(component.componentType).toBe(widgetCase.componentType);
      expect(component._type).toBe(ObjectType.DashboardComponent);
    });

    test("drops onto the canvas origin at a positive size no smaller than its own minimum", () => {
      const component: DashboardBaseComponent =
        widgetCase.getDefaultComponent();

      expect(component.topInDashboardUnits).toBe(0);
      expect(component.leftInDashboardUnits).toBe(0);

      expect(component.widthInDashboardUnits).toBeGreaterThan(0);
      expect(component.heightInDashboardUnits).toBeGreaterThan(0);
      expect(component.minWidthInDashboardUnits).toBeGreaterThan(0);
      expect(component.minHeightInDashboardUnits).toBeGreaterThan(0);

      /*
       * A default smaller than its own minimum makes the grid snap the widget
       * larger the instant it is dropped, moving whatever sat below it.
       */
      expect(component.minWidthInDashboardUnits).toBeLessThanOrEqual(
        component.widthInDashboardUnits,
      );
      expect(component.minHeightInDashboardUnits).toBeLessThanOrEqual(
        component.heightInDashboardUnits,
      );
    });

    test("generates a fresh componentId and query id on every call", () => {
      const first: DashboardBaseComponent = widgetCase.getDefaultComponent();
      const second: DashboardBaseComponent = widgetCase.getDefaultComponent();

      // Two widgets of the same type on one dashboard must not share an id.
      expect(first.componentId.toString().length).toBeGreaterThan(0);
      expect(first.componentId.toString()).not.toBe(
        second.componentId.toString(),
      );

      const firstQueries: Array<DataSourceQueryConfig> =
        widgetCase.getSeededQueries(first);
      const secondQueries: Array<DataSourceQueryConfig> =
        widgetCase.getSeededQueries(second);

      expect(firstQueries[0]?.id).toBeTruthy();
      expect(firstQueries[0]?.id).not.toBe(secondQueries[0]?.id);
    });

    test("seeds exactly one blank query so the widget starts unconfigured", () => {
      const component: DashboardBaseComponent =
        widgetCase.getDefaultComponent();
      const queries: Array<DataSourceQueryConfig> =
        widgetCase.getSeededQueries(component);

      expect(queries).toHaveLength(1);

      /*
       * Blank on both fields: an empty dataSourceId is what the widget reads
       * as "not configured yet", and a non-empty default query would be run
       * against whichever source the user picks first.
       */
      expect(queries[0]?.dataSourceId).toBe("");
      expect(queries[0]?.query).toBe("");
    });

    test("survives the JSON round trip it takes through the dashboard's JSONB config", () => {
      const component: DashboardBaseComponent =
        widgetCase.getDefaultComponent();

      const roundTripped: DashboardBaseComponent = JSON.parse(
        JSON.stringify(component),
      ) as DashboardBaseComponent;

      expect(roundTripped.arguments).toEqual(component.arguments);
      expect(roundTripped.componentType).toBe(widgetCase.componentType);
      expect(roundTripped.widthInDashboardUnits).toBe(
        component.widthInDashboardUnits,
      );

      // The seeded query has to still be there and still be blank.
      const queries: Array<DataSourceQueryConfig> =
        widgetCase.getSeededQueries(roundTripped);

      expect(queries).toHaveLength(1);
      expect(queries[0]?.dataSourceId).toBe("");
      expect(queries[0]?.query).toBe("");
      expect(queries[0]?.id).toBe(
        widgetCase.getSeededQueries(component)[0]?.id,
      );
    });

    test("declares config arguments that are unique, labelled and sectioned", () => {
      const configArguments: Array<ConfigArgumentView> =
        widgetCase.getConfigArguments();

      expect(configArguments.length).toBeGreaterThan(0);

      const ids: Array<string> = configArguments.map(
        (configArgument: ConfigArgumentView): string => {
          return String(configArgument.id);
        },
      );

      // A duplicate id means the second field silently overwrites the first.
      expect(new Set<string>(ids).size).toBe(ids.length);

      const sectionsByName: Map<string, ComponentArgumentSection> = new Map<
        string,
        ComponentArgumentSection
      >();

      for (const configArgument of configArguments) {
        expect(String(configArgument.id).trim().length).toBeGreaterThan(0);
        expect(configArgument.name.trim().length).toBeGreaterThan(0);
        expect(configArgument.description.trim().length).toBeGreaterThan(0);
        expect(typeof configArgument.required).toBe("boolean");
        expect(Object.values(ComponentInputType)).toContain(
          configArgument.type,
        );

        // Section-less arguments render outside every collapsible group.
        expect(configArgument.section).toBeDefined();

        const section: ComponentArgumentSection =
          configArgument.section as ComponentArgumentSection;

        expect(section.name.trim().length).toBeGreaterThan(0);
        expect(typeof section.order).toBe("number");
        expect(Number.isFinite(section.order)).toBe(true);

        /*
         * The settings panel groups by section object, so two arguments that
         * name the same section must literally share it — otherwise the panel
         * renders the same heading twice.
         */
        const alreadySeen: ComponentArgumentSection | undefined =
          sectionsByName.get(section.name);

        if (alreadySeen) {
          expect(section).toBe(alreadySeen);
        } else {
          sectionsByName.set(section.name, section);
        }
      }
    });

    test("carries option lists on its dropdowns and nowhere else", () => {
      /*
       * Not every one of these widgets has a dropdown (the table has none), so
       * this checks the correspondence rather than a count: a Dropdown must
       * have usable options, and a non-Dropdown must not carry an option list
       * the renderer will never show.
       */
      for (const configArgument of widgetCase.getConfigArguments()) {
        if (configArgument.type !== ComponentInputType.Dropdown) {
          expect(configArgument.dropdownOptions).toBeUndefined();
          continue;
        }

        const options: Array<DropdownOptionView> =
          configArgument.dropdownOptions || [];

        // A dropdown with no options is a permanently empty, unusable field.
        expect(options.length).toBeGreaterThan(0);

        const values: Array<unknown> = options.map(
          (option: DropdownOptionView): unknown => {
            return option.value;
          },
        );

        // A duplicate value makes two rows that store the same thing.
        expect(new Set<unknown>(values).size).toBe(values.length);

        for (const option of options) {
          expect(option.label.trim().length).toBeGreaterThan(0);
          expect(option.value).toBeTruthy();
        }
      }
    });

    /*
     * The regression guard the whole split exists for. These widgets read an
     * external source; a metric input here would render a metric-explorer
     * editor writing to an argument nothing consumes.
     */
    test("exposes no metric or telemetry surface at all", () => {
      const configArguments: Array<ConfigArgumentView> =
        widgetCase.getConfigArguments();

      const usedTypes: Array<ComponentInputType> = configArguments.map(
        (configArgument: ConfigArgumentView): ComponentInputType => {
          return configArgument.type;
        },
      );

      for (const metricInputType of METRIC_ONLY_INPUT_TYPES) {
        expect(usedTypes).not.toContain(metricInputType);
      }

      // Nor a metric-named argument key left behind by a copied widget.
      for (const configArgument of configArguments) {
        expect(String(configArgument.id).toLowerCase()).not.toContain("metric");
      }
    });
  });
}

describe("Data Source widgets as a group", () => {
  test("covers exactly the widget types declared as data-source types", () => {
    /*
     * If a fifth Data Source widget is added to DataSourceComponentTypes, this
     * suite must grow with it rather than quietly skipping it.
     */
    const covered: Array<DashboardComponentType> = WIDGET_CASES.map(
      (widgetCase: DataSourceWidgetCase): DashboardComponentType => {
        return widgetCase.componentType;
      },
    );

    expect(covered.slice().sort()).toEqual(
      DataSourceComponentTypes.slice().sort(),
    );
  });

  test("uses one order per section name across all four widgets", () => {
    /*
     * The four widgets sit side by side in the same settings panel styling;
     * "Display Options" appearing above "Thresholds" in one widget and below
     * it in another is a UI inconsistency no single widget's test can see.
     */
    const orderBySectionName: Map<string, number> = new Map<string, number>();

    for (const widgetCase of WIDGET_CASES) {
      for (const configArgument of widgetCase.getConfigArguments()) {
        const section: ComponentArgumentSection | undefined =
          configArgument.section;

        if (!section) {
          continue;
        }

        const knownOrder: number | undefined = orderBySectionName.get(
          section.name,
        );

        if (knownOrder === undefined) {
          orderBySectionName.set(section.name, section.order);
          continue;
        }

        expect({ name: section.name, order: section.order }).toEqual({
          name: section.name,
          order: knownOrder,
        });
      }
    }

    expect(orderBySectionName.size).toBeGreaterThan(0);
  });

  test("keeps widget-specific defaults sane", () => {
    const value: DashboardBaseComponent =
      DashboardDataSourceValueComponentUtil.getDefaultComponent();
    const valueArguments: { title: string; reduce?: unknown } =
      value.arguments as { title: string; reduce?: unknown };

    // Empty title, not a placeholder string that would ship as real content.
    expect(valueArguments.title).toBe("");
    expect(valueArguments.reduce).toBe(DataSourceValueReduce.Last);

    const gauge: DashboardBaseComponent =
      DashboardDataSourceGaugeComponentUtil.getDefaultComponent();
    const gaugeArguments: {
      minValue?: number | undefined;
      maxValue?: number | undefined;
      reduce?: unknown;
    } = gauge.arguments as {
      minValue?: number | undefined;
      maxValue?: number | undefined;
      reduce?: unknown;
    };

    // An inverted or zero-width scale gives the needle nowhere to point.
    expect(gaugeArguments.minValue).toBe(0);
    expect(gaugeArguments.maxValue).toBe(100);
    expect(gaugeArguments.minValue as number).toBeLessThan(
      gaugeArguments.maxValue as number,
    );
    expect(gaugeArguments.reduce).toBe(DataSourceValueReduce.Last);

    const table: DashboardBaseComponent =
      DashboardDataSourceTableComponentUtil.getDefaultComponent();
    const tableArguments: { maxRows?: number | undefined } =
      table.arguments as { maxRows?: number | undefined };

    // Absent maxRows means "render every row the query returned".
    expect(tableArguments.maxRows).toBeUndefined();
  });
});

describe("registration in DashboardComponentsUtil", () => {
  for (const widgetCase of WIDGET_CASES) {
    test(`${widgetCase.label} resolves to its own non-empty argument list`, () => {
      const fromRegistry: Array<ConfigArgumentView> = asArgumentViews(
        DashboardComponentsUtil.getComponentSettingsArguments(
          widgetCase.componentType,
        ),
      );

      expect(fromRegistry.length).toBeGreaterThan(0);

      expect(
        fromRegistry.map((configArgument: ConfigArgumentView): string => {
          return String(configArgument.id);
        }),
      ).toEqual(
        widgetCase
          .getConfigArguments()
          .map((configArgument: ConfigArgumentView): string => {
            return String(configArgument.id);
          }),
      );
    });
  }

  test("still rejects a component type it does not know", () => {
    expect(() => {
      return DashboardComponentsUtil.getComponentSettingsArguments(
        "NotARealDataSourceWidget" as DashboardComponentType,
      );
    }).toThrow(BadDataException);
  });

  test("rejects an empty component type rather than falling back to a widget", () => {
    expect(() => {
      return DashboardComponentsUtil.getComponentSettingsArguments(
        "" as DashboardComponentType,
      );
    }).toThrow(BadDataException);
  });
});

/*
 * The other half of the split: the metric widgets must keep the metric inputs
 * that were never supposed to move. If a metric input disappeared from one of
 * these while the Data Source widgets stayed clean, the split gutted the
 * telemetry widget instead of separating from it.
 */
describe("metric widgets retain their metric inputs", () => {
  type MetricExpectation = [DashboardComponentType, Array<ComponentInputType>];

  const METRIC_EXPECTATIONS: Array<MetricExpectation> = [
    [
      DashboardComponentType.Chart,
      [
        ComponentInputType.MetricsQueryConfig,
        ComponentInputType.MetricsQueryConfigs,
        ComponentInputType.MetricsFormulaConfigs,
      ],
    ],
    [DashboardComponentType.Value, [ComponentInputType.MetricsQueryConfig]],
    [DashboardComponentType.Gauge, [ComponentInputType.MetricsQueryConfig]],
    [
      DashboardComponentType.Table,
      [ComponentInputType.TableColumns, ComponentInputType.TableGroupBy],
    ],
  ];

  for (const [componentType, expectedInputTypes] of METRIC_EXPECTATIONS) {
    test(`${componentType} still offers its telemetry inputs`, () => {
      const usedTypes: Array<ComponentInputType> = asArgumentViews(
        DashboardComponentsUtil.getComponentSettingsArguments(componentType),
      ).map((configArgument: ConfigArgumentView): ComponentInputType => {
        return configArgument.type;
      });

      for (const expectedInputType of expectedInputTypes) {
        expect(usedTypes).toContain(expectedInputType);
      }
    });
  }
});

describe("DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS", () => {
  test("offers every DataSourceValueReduce member exactly once", () => {
    /*
     * A missing member is a reduction the renderer supports but no user can
     * choose; a duplicated one renders the same choice twice.
     */
    const values: Array<unknown> = DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS.map(
      (option: DropdownOptionView): unknown => {
        return option.value;
      },
    );

    expect(values.slice().sort()).toEqual(
      Object.values(DataSourceValueReduce).slice().sort(),
    );
    expect(new Set<unknown>(values).size).toBe(values.length);

    // Including the reduction the Value and Gauge defaults fall back to.
    expect(values).toContain(DataSourceValueReduce.Last);
  });

  test("labels every option distinctly and non-blank", () => {
    const labels: Array<string> = DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS.map(
      (option: DropdownOptionView): string => {
        return option.label;
      },
    );

    for (const label of labels) {
      expect(label.trim().length).toBeGreaterThan(0);
    }

    // Two identical labels are two indistinguishable rows in the picker.
    expect(new Set<string>(labels).size).toBe(labels.length);
  });

  test("is the option list both the Value and Gauge reduce pickers use", () => {
    type FindReduceOptionsFunction = (
      configArguments: Array<ConfigArgumentView>,
    ) => Array<DropdownOptionView>;

    const findReduceOptions: FindReduceOptionsFunction = (
      configArguments: Array<ConfigArgumentView>,
    ): Array<DropdownOptionView> => {
      const found: ConfigArgumentView | undefined = configArguments.find(
        (configArgument: ConfigArgumentView): boolean => {
          return String(configArgument.id) === "reduce";
        },
      );

      if (!found) {
        throw new Error("No 'reduce' argument declared on this widget");
      }

      return found.dropdownOptions || [];
    };

    const valueOptions: Array<DropdownOptionView> = findReduceOptions(
      asArgumentViews(
        DashboardDataSourceValueComponentUtil.getComponentConfigArguments(),
      ),
    );
    const gaugeOptions: Array<DropdownOptionView> = findReduceOptions(
      asArgumentViews(
        DashboardDataSourceGaugeComponentUtil.getComponentConfigArguments(),
      ),
    );

    expect(valueOptions).toEqual(DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS);
    expect(gaugeOptions).toEqual(DATA_SOURCE_REDUCE_DROPDOWN_OPTIONS);
  });
});
