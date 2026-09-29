import { describe, expect, test } from "@jest/globals";
import DashboardComponentType, {
  DataSourceComponentTypes,
  isDataSourceComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import {
  DashboardTemplate,
  DashboardTemplates,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardChartComponent";
import DashboardValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardValueComponent";
import DashboardGaugeComponentUtil from "../../../Utils/Dashboard/Components/DashboardGaugeComponent";
import DashboardTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardTableComponent";
import DashboardDataSourceChartComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceChartComponent";
import DashboardDataSourceValueComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceValueComponent";
import DashboardDataSourceGaugeComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceGaugeComponent";
import DashboardDataSourceTableComponentUtil from "../../../Utils/Dashboard/Components/DashboardDataSourceTableComponent";

/*
 * External Data Source widgets used to be a *mode* of the metric widgets:
 * one component type, two mutually exclusive argument shapes, and a runtime
 * branch everywhere that read them. They are now four component types of
 * their own. This file guards the taxonomy that split created, because the
 * component type is persisted by value inside Dashboard.dashboardViewConfig
 * (JSONB) — a renamed member, a key/value drift, or a widget that quietly
 * joins/leaves the DataSource set orphans every dashboard already saved,
 * and nothing else in the build would notice.
 */

type HasOwnFunction = (target: Record<string, unknown>, key: string) => boolean;

const hasOwn: HasOwnFunction = (
  target: Record<string, unknown>,
  key: string,
): boolean => {
  return Object.prototype.hasOwnProperty.call(target, key);
};

type ArgumentsOfFunction = (
  component: DashboardBaseComponent,
) => Record<string, unknown>;

const argumentsOf: ArgumentsOfFunction = (
  component: DashboardBaseComponent,
): Record<string, unknown> => {
  return (component.arguments as Record<string, unknown> | undefined) || {};
};

const ALL_COMPONENT_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

const EXPECTED_DATA_SOURCE_TYPES: Array<DashboardComponentType> = [
  DashboardComponentType.DataSourceChart,
  DashboardComponentType.DataSourceValue,
  DashboardComponentType.DataSourceGauge,
  DashboardComponentType.DataSourceTable,
];

interface WidgetDefault {
  label: string;
  component: DashboardBaseComponent;
}

/*
 * Built once through the same utils the "add widget" flow uses, so these
 * are literally the objects that get written to the database.
 */
const METRIC_WIDGET_DEFAULTS: Array<WidgetDefault> = [
  {
    label: "Chart",
    component: DashboardChartComponentUtil.getDefaultComponent(),
  },
  {
    label: "Value",
    component: DashboardValueComponentUtil.getDefaultComponent(),
  },
  {
    label: "Gauge",
    component: DashboardGaugeComponentUtil.getDefaultComponent(),
  },
  {
    label: "Table",
    component: DashboardTableComponentUtil.getDefaultComponent(),
  },
];

const DATA_SOURCE_WIDGET_DEFAULTS: Array<WidgetDefault> = [
  {
    label: "DataSourceChart",
    component: DashboardDataSourceChartComponentUtil.getDefaultComponent(),
  },
  {
    label: "DataSourceValue",
    component: DashboardDataSourceValueComponentUtil.getDefaultComponent(),
  },
  {
    label: "DataSourceGauge",
    component: DashboardDataSourceGaugeComponentUtil.getDefaultComponent(),
  },
  {
    label: "DataSourceTable",
    component: DashboardDataSourceTableComponentUtil.getDefaultComponent(),
  },
];

/*
 * Argument keys that mean "this widget reads an external Data Source" — the
 * keys the four new widgets ACTUALLY use. A metric widget carrying either of
 * these would be the crammed-together design creeping back.
 */
const DATA_SOURCE_ONLY_ARGUMENT_KEYS: Array<string> = ["query", "queries"];

/*
 * The keys the pre-split design used to hang external queries off the metric
 * widgets. Kept as a separate list because they name a shape that no longer
 * exists anywhere: an assertion over them can only ever pass, so it guards
 * the old names coming back rather than the current invariant.
 */
const REMOVED_DATA_SOURCE_ARGUMENT_KEYS: Array<string> = [
  "dataSourceQueryConfig",
  "dataSourceQueryConfigs",
];

// Argument keys that mean "this widget reads OneUptime's own telemetry".
const METRIC_ONLY_ARGUMENT_KEYS: Array<string> = [
  "metricQueryConfig",
  "metricQueryConfigs",
  "metricFormulaConfigs",
  "columns",
  "groupByAttributes",
];

interface TemplateComponent {
  templateName: string;
  component: DashboardBaseComponent;
}

type CollectTemplateComponentsFunction = () => Array<TemplateComponent>;

const collectTemplateComponents: CollectTemplateComponentsFunction =
  (): Array<TemplateComponent> => {
    const collected: Array<TemplateComponent> = [];

    for (const template of DashboardTemplates) {
      const config: DashboardViewConfig | null = getTemplateConfig(
        template.type,
      );

      if (!config) {
        // Blank is a catalog entry with no config, by design.
        continue;
      }

      for (const component of config.components) {
        collected.push({
          templateName: template.name,
          component: component,
        });
      }
    }

    return collected;
  };

describe("DashboardComponentType taxonomy", () => {
  test("the enum declares exactly the four DataSource* members", (): void => {
    const dataSourceKeys: Array<string> = Object.keys(
      DashboardComponentType,
    ).filter((key: string): boolean => {
      return key.startsWith("DataSource");
    });

    expect(dataSourceKeys.sort()).toEqual(
      [
        "DataSourceChart",
        "DataSourceGauge",
        "DataSourceTable",
        "DataSourceValue",
      ].sort(),
    );
  });

  test("DataSourceComponentTypes lists precisely those four members", (): void => {
    const listed: Array<string> = DataSourceComponentTypes.map(
      (type: DashboardComponentType): string => {
        return type.toString();
      },
    ).sort();

    const expected: Array<string> = EXPECTED_DATA_SOURCE_TYPES.map(
      (type: DashboardComponentType): string => {
        return type.toString();
      },
    ).sort();

    expect(listed).toEqual(expected);
  });

  test("DataSourceComponentTypes contains no duplicates", (): void => {
    const unique: Set<DashboardComponentType> = new Set<DashboardComponentType>(
      DataSourceComponentTypes,
    );

    expect(unique.size).toBe(DataSourceComponentTypes.length);
  });

  test("every DataSourceComponentTypes entry is a real enum member", (): void => {
    for (const type of DataSourceComponentTypes) {
      expect(ALL_COMPONENT_TYPES).toContain(type);
    }
  });

  /*
   * The enum is persisted by VALUE. A key/value drift (renaming the key but
   * not the string, or vice versa) reads fine in TypeScript but silently
   * orphans every widget already stored under the old string.
   */
  test("every enum key equals its string value", (): void => {
    const entries: Array<[string, string]> = Object.entries(
      DashboardComponentType,
    ) as Array<[string, string]>;

    expect(entries.length).toBeGreaterThan(EXPECTED_DATA_SOURCE_TYPES.length);

    for (const [key, value] of entries) {
      expect(`${key} => ${value}`).toBe(`${key} => ${key}`);
    }
  });

  test("enum values are unique, so two widget types cannot collide in storage", (): void => {
    const unique: Set<string> = new Set<string>(
      ALL_COMPONENT_TYPES.map((type: DashboardComponentType): string => {
        return type.toString();
      }),
    );

    expect(unique.size).toBe(ALL_COMPONENT_TYPES.length);
  });
});

describe("isDataSourceComponentType", () => {
  /*
   * Iterating the enum rather than hard-coding a deny list is the point: a
   * widget type added later cannot silently join the external-data class
   * (which is, among other things, what the public dashboard excludes).
   */
  test("returns true for exactly the four DataSource types and false for every other member", (): void => {
    for (const type of ALL_COMPONENT_TYPES) {
      const expected: boolean = EXPECTED_DATA_SOURCE_TYPES.includes(type);

      expect(`${type}: ${isDataSourceComponentType(type)}`).toBe(
        `${type}: ${expected}`,
      );
    }
  });

  test("returns true for each of the four DataSource types by name", (): void => {
    expect(
      isDataSourceComponentType(DashboardComponentType.DataSourceChart),
    ).toBe(true);
    expect(
      isDataSourceComponentType(DashboardComponentType.DataSourceValue),
    ).toBe(true);
    expect(
      isDataSourceComponentType(DashboardComponentType.DataSourceGauge),
    ).toBe(true);
    expect(
      isDataSourceComponentType(DashboardComponentType.DataSourceTable),
    ).toBe(true);
  });

  test("the metric widgets it replaced are not data source types", (): void => {
    expect(isDataSourceComponentType(DashboardComponentType.Chart)).toBe(false);
    expect(isDataSourceComponentType(DashboardComponentType.Value)).toBe(false);
    expect(isDataSourceComponentType(DashboardComponentType.Gauge)).toBe(false);
    expect(isDataSourceComponentType(DashboardComponentType.Table)).toBe(false);
  });

  /*
   * Stored dashboards are JSONB: the componentType reaching this guard is
   * whatever string was written, including strings from an older or newer
   * build. It must answer false rather than throw.
   */
  test("tolerates arbitrary strings cast in from stored JSONB", (): void => {
    const garbageValues: Array<string> = [
      "",
      "   ",
      "\n\t",
      "datasourcechart",
      "DATASOURCECHART",
      "DataSourceChart ",
      " DataSourceChart",
      "DataSource",
      "DataSourceHeatmap",
      "DataSourceChart,DataSourceValue",
      "Chart",
      "{}",
      "[object Object]",
      "0",
      "null",
      "undefined",
    ];

    for (const value of garbageValues) {
      const type: DashboardComponentType = value as DashboardComponentType;

      expect((): boolean => {
        return isDataSourceComponentType(type);
      }).not.toThrow();

      expect(
        `${JSON.stringify(value)}: ${isDataSourceComponentType(type)}`,
      ).toBe(`${JSON.stringify(value)}: false`);
    }
  });

  /*
   * Object.prototype keys are the classic way a "set" implemented as a plain
   * object lies. Array.includes does not, and this pins that down.
   */
  test("prototype-inherited names are not treated as data source types", (): void => {
    const prototypeNames: Array<string> = [
      "__proto__",
      "constructor",
      "toString",
      "hasOwnProperty",
      "valueOf",
    ];

    for (const name of prototypeNames) {
      expect(
        `${name}: ${isDataSourceComponentType(name as DashboardComponentType)}`,
      ).toBe(`${name}: false`);
    }
  });

  test("null and undefined do not throw and are not data source types", (): void => {
    const nullish: Array<unknown> = [null, undefined, 0, NaN, false];

    for (const value of nullish) {
      expect((): boolean => {
        return isDataSourceComponentType(value as DashboardComponentType);
      }).not.toThrow();

      expect(isDataSourceComponentType(value as DashboardComponentType)).toBe(
        false,
      );
    }
  });
});

/*
 * THE INVARIANT THE WHOLE CHANGE EXISTS TO ESTABLISH.
 *
 * Before the split, a single widget's arguments could carry both a metric
 * query config and a data source query config, and which one won was decided
 * at render time. The two argument shapes are now disjoint by construction:
 * a metric widget never carries data source config, and a data source widget
 * never carries metric config. Every consumer downstream (the settings form,
 * the fetch layer, the public dashboard filter) relies on that, so the
 * defaults these utils produce are asserted to have no overlapping keys at
 * all — not merely undefined values, but no own property whatsoever, since
 * `key: undefined` still survives into stored JSON as a present key in some
 * serializers and still trips `"key" in args` branches.
 */
describe("metric widget defaults carry no data source config", () => {
  /*
   * Non-vacuity guard. DATA_SOURCE_ONLY_ARGUMENT_KEYS is only a real test of
   * the metric widgets if the Data Source widgets are the ones using those
   * keys — otherwise every assertion below passes against a list of names
   * nothing in the product has ever written.
   */
  test("the data source key list names keys the new widgets really use", (): void => {
    for (const key of DATA_SOURCE_ONLY_ARGUMENT_KEYS) {
      const usedBy: Array<string> = DATA_SOURCE_WIDGET_DEFAULTS.filter(
        (widget: WidgetDefault): boolean => {
          return hasOwn(argumentsOf(widget.component), key);
        },
      ).map((widget: WidgetDefault): string => {
        return widget.label;
      });

      expect(`${key} used by: ${usedBy.length}`).not.toBe(`${key} used by: 0`);
    }
  });

  test("neither pre-split data source key survives anywhere", (): void => {
    for (const widget of [
      ...METRIC_WIDGET_DEFAULTS,
      ...DATA_SOURCE_WIDGET_DEFAULTS,
    ]) {
      const args: Record<string, unknown> = argumentsOf(widget.component);

      for (const key of REMOVED_DATA_SOURCE_ARGUMENT_KEYS) {
        expect(`${widget.label}.${key}: ${hasOwn(args, key)}`).toBe(
          `${widget.label}.${key}: false`,
        );
      }
    }
  });

  test("no metric widget default declares a data source argument key", (): void => {
    for (const widget of METRIC_WIDGET_DEFAULTS) {
      const args: Record<string, unknown> = argumentsOf(widget.component);

      for (const key of DATA_SOURCE_ONLY_ARGUMENT_KEYS) {
        expect(`${widget.label}.${key}: ${hasOwn(args, key)}`).toBe(
          `${widget.label}.${key}: false`,
        );
      }
    }
  });

  test("metric widget defaults still carry their own metric config", (): void => {
    const chartArgs: Record<string, unknown> = argumentsOf(
      METRIC_WIDGET_DEFAULTS[0]!.component,
    );
    const valueArgs: Record<string, unknown> = argumentsOf(
      METRIC_WIDGET_DEFAULTS[1]!.component,
    );
    const gaugeArgs: Record<string, unknown> = argumentsOf(
      METRIC_WIDGET_DEFAULTS[2]!.component,
    );
    const tableArgs: Record<string, unknown> = argumentsOf(
      METRIC_WIDGET_DEFAULTS[3]!.component,
    );

    expect(hasOwn(chartArgs, "metricQueryConfig")).toBe(true);
    expect(hasOwn(valueArgs, "metricQueryConfig")).toBe(true);
    expect(hasOwn(gaugeArgs, "metricQueryConfig")).toBe(true);
    expect(hasOwn(tableArgs, "columns")).toBe(true);
    expect(hasOwn(tableArgs, "groupByAttributes")).toBe(true);
  });

  test("metric widget defaults keep their original component types", (): void => {
    const types: Array<DashboardComponentType> = METRIC_WIDGET_DEFAULTS.map(
      (widget: WidgetDefault): DashboardComponentType => {
        return widget.component.componentType;
      },
    );

    expect(types).toEqual([
      DashboardComponentType.Chart,
      DashboardComponentType.Value,
      DashboardComponentType.Gauge,
      DashboardComponentType.Table,
    ]);
  });
});

describe("data source widget defaults carry no metric config", () => {
  test("no data source widget default declares a metric argument key", (): void => {
    for (const widget of DATA_SOURCE_WIDGET_DEFAULTS) {
      const args: Record<string, unknown> = argumentsOf(widget.component);

      for (const key of METRIC_ONLY_ARGUMENT_KEYS) {
        expect(`${widget.label}.${key}: ${hasOwn(args, key)}`).toBe(
          `${widget.label}.${key}: false`,
        );
      }
    }
  });

  test("each data source widget default is typed as its own component type", (): void => {
    const types: Array<DashboardComponentType> =
      DATA_SOURCE_WIDGET_DEFAULTS.map(
        (widget: WidgetDefault): DashboardComponentType => {
          return widget.component.componentType;
        },
      );

    expect(types).toEqual(EXPECTED_DATA_SOURCE_TYPES);

    for (const type of types) {
      expect(`${type} is data source: ${isDataSourceComponentType(type)}`).toBe(
        `${type} is data source: true`,
      );
    }
  });

  test("the chart default seeds exactly one blank query in a queries array", (): void => {
    const args: Record<string, unknown> = argumentsOf(
      DATA_SOURCE_WIDGET_DEFAULTS[0]!.component,
    );

    expect(hasOwn(args, "queries")).toBe(true);
    expect(hasOwn(args, "query")).toBe(false);

    const queries: Array<Record<string, unknown>> = args["queries"] as Array<
      Record<string, unknown>
    >;

    expect(Array.isArray(queries)).toBe(true);
    expect(queries.length).toBe(1);
    expect(queries[0]!["dataSourceId"]).toBe("");
    expect(queries[0]!["query"]).toBe("");
    expect(typeof queries[0]!["id"]).toBe("string");
    expect((queries[0]!["id"] as string).length).toBeGreaterThan(0);
  });

  test("the value, gauge and table defaults each seed a single blank query object", (): void => {
    const singleQueryWidgets: Array<WidgetDefault> =
      DATA_SOURCE_WIDGET_DEFAULTS.slice(1);

    expect(singleQueryWidgets.length).toBe(3);

    for (const widget of singleQueryWidgets) {
      const args: Record<string, unknown> = argumentsOf(widget.component);

      expect(`${widget.label} has query: ${hasOwn(args, "query")}`).toBe(
        `${widget.label} has query: true`,
      );
      expect(`${widget.label} has queries: ${hasOwn(args, "queries")}`).toBe(
        `${widget.label} has queries: false`,
      );

      const query: Record<string, unknown> = args["query"] as Record<
        string,
        unknown
      >;

      expect(Array.isArray(query)).toBe(false);
      expect(`${widget.label} dataSourceId: ${query["dataSourceId"]}`).toBe(
        `${widget.label} dataSourceId: `,
      );
      expect(`${widget.label} query: ${query["query"]}`).toBe(
        `${widget.label} query: `,
      );
    }
  });

  /*
   * The blank query ids must be distinct per widget instance, otherwise two
   * widgets dropped on the same dashboard share React keys in the editor.
   */
  test("blank query ids are unique across freshly built data source widgets", (): void => {
    const ids: Array<string> = [];

    for (const widget of DATA_SOURCE_WIDGET_DEFAULTS) {
      const args: Record<string, unknown> = argumentsOf(widget.component);
      const query: Record<string, unknown> | undefined = (args["query"] ||
        (
          args["queries"] as Array<Record<string, unknown>> | undefined
        )?.[0]) as Record<string, unknown> | undefined;

      expect(query).toBeDefined();

      ids.push(String((query as Record<string, unknown>)["id"]));
    }

    expect(new Set<string>(ids).size).toBe(ids.length);
  });
});

describe("shipped dashboard templates", () => {
  /*
   * Templates are seeded into a project the moment someone clicks "Create
   * from Template". A data source widget in one would point at a DataSource
   * record the target project has never connected, so it can only ever
   * render an error.
   */
  test("no template component uses a DataSource widget type", (): void => {
    const offenders: Array<string> = collectTemplateComponents()
      .filter((entry: TemplateComponent): boolean => {
        return isDataSourceComponentType(entry.component.componentType);
      })
      .map((entry: TemplateComponent): string => {
        return `${entry.templateName}/${entry.component.componentType}`;
      });

    expect(offenders).toEqual([]);
  });

  test("no template component carries a data source argument key", (): void => {
    const offenders: Array<string> = [];

    for (const entry of collectTemplateComponents()) {
      const args: Record<string, unknown> = argumentsOf(entry.component);

      for (const key of DATA_SOURCE_ONLY_ARGUMENT_KEYS) {
        if (hasOwn(args, key)) {
          offenders.push(`${entry.templateName}/${key}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  /*
   * Guards the two assertions above from passing vacuously if the template
   * walk ever stops finding components.
   */
  test("the template walk actually visits components", (): void => {
    const visited: Array<TemplateComponent> = collectTemplateComponents();

    expect(visited.length).toBeGreaterThan(20);
    expect(DashboardTemplates.length).toBeGreaterThan(1);

    const templatesWithComponents: Set<string> = new Set<string>(
      visited.map((entry: TemplateComponent): string => {
        return entry.templateName;
      }),
    );

    const catalogNames: Array<string> = DashboardTemplates.map(
      (template: DashboardTemplate): string => {
        return template.name;
      },
    );

    expect(templatesWithComponents.size).toBe(catalogNames.length - 1);
  });
});
