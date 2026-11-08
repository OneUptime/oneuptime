import { describe, expect, it } from "@jest/globals";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardComponentType, {
  DataSourceComponentTypes,
  MetricComponentTypes,
} from "../../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVariable from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../../Types/Dashboard/DashboardViewConfig";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import StoredDashboardViewConfig from "../../../../Utils/Dashboard/StoredDashboardViewConfig";

/*
 * A public dashboard is served to viewers who never authenticated, so
 * whatever the sanitizer leaves in dashboardViewConfig is world-readable.
 * For an external Data Source widget the stored config IS the query — raw
 * SQL naming internal tables and columns, PromQL naming internal jobs and
 * instances, and the id of the connected Data Source. The client already
 * refuses to render those widgets anonymously (it draws a placeholder), so
 * removing them costs the viewer nothing; leaving them in would publish the
 * query text to anyone who opens the page and reads the API response.
 *
 * The tests below therefore care about two things that are easy to regress:
 * that every Data Source widget type disappears (driven off
 * DataSourceComponentTypes, so a fifth type added later is covered here the
 * day it is added), and that nothing else about the dashboard changes —
 * a sanitizer that quietly drops variables, reorders widgets, or mutates the
 * stored entity would corrupt the dashboard for its authenticated owner too.
 */

function widget(
  componentType: DashboardComponentType,
  argumentsObject: Record<string, unknown> = {},
): DashboardBaseComponent {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: new ObjectID(`component-${componentType}`),
    componentType: componentType,
    topInDashboardUnits: 1,
    leftInDashboardUnits: 2,
    widthInDashboardUnits: 6,
    heightInDashboardUnits: 4,
    minWidthInDashboardUnits: 3,
    minHeightInDashboardUnits: 2,
    arguments: argumentsObject,
  };
}

function config(
  components: Array<unknown>,
  extra: Record<string, unknown> = {},
): DashboardViewConfig {
  return {
    _type: ObjectType.DashboardViewConfig,
    heightInDashboardUnits: 60,
    components: components,
    ...extra,
  } as unknown as DashboardViewConfig;
}

function sanitize(dashboardViewConfig: unknown): DashboardViewConfig | null {
  return PublicDashboardViewConfig.sanitize(
    dashboardViewConfig as DashboardViewConfig | null | undefined,
  );
}

function componentTypesOf(
  dashboardViewConfig: DashboardViewConfig | null,
): Array<DashboardComponentType> {
  if (!dashboardViewConfig) {
    throw new Error("Expected a sanitized config, got null.");
  }

  return dashboardViewConfig.components.map(
    (component: DashboardBaseComponent) => {
      return component.componentType;
    },
  );
}

// Widget types an anonymous viewer is allowed to keep seeing.
const PUBLIC_COMPONENT_TYPES: Array<DashboardComponentType> = [
  DashboardComponentType.Chart,
  DashboardComponentType.Value,
  DashboardComponentType.Gauge,
  DashboardComponentType.Table,
  DashboardComponentType.Text,
  DashboardComponentType.Clock,
  DashboardComponentType.IncidentList,
  DashboardComponentType.MonitorList,
];

describe("PublicDashboardViewConfig", () => {
  describe("sanitize", () => {
    it.each([null, undefined])(
      "returns null for an absent stored config (%p)",
      (input: null | undefined) => {
        expect(sanitize(input)).toBeNull();
      },
    );

    it("keeps only the non-Data-Source widgets, in their stored order", () => {
      const metricChart: DashboardBaseComponent = widget(
        DashboardComponentType.Chart,
      );
      const dataSourceChart: DashboardBaseComponent = widget(
        DashboardComponentType.DataSourceChart,
      );
      const text: DashboardBaseComponent = widget(DashboardComponentType.Text);
      const dataSourceTable: DashboardBaseComponent = widget(
        DashboardComponentType.DataSourceTable,
      );
      const monitorList: DashboardBaseComponent = widget(
        DashboardComponentType.MonitorList,
      );

      const result: DashboardViewConfig | null = sanitize(
        config([
          metricChart,
          dataSourceChart,
          text,
          dataSourceTable,
          monitorList,
        ]),
      );

      expect(componentTypesOf(result)).toEqual([
        DashboardComponentType.Chart,
        DashboardComponentType.Text,
        DashboardComponentType.MonitorList,
      ]);
    });

    it("passes each surviving widget through untouched", () => {
      const metricChart: DashboardBaseComponent = widget(
        DashboardComponentType.Chart,
        { chartTitle: "CPU", queryConfigs: [{ metricAliasData: {} }] },
      );
      const clock: DashboardBaseComponent = widget(
        DashboardComponentType.Clock,
      );

      const result: DashboardViewConfig | null = sanitize(
        config([
          metricChart,
          widget(DashboardComponentType.DataSourceGauge),
          clock,
        ]),
      );

      // Same object identity: nothing is cloned, rewritten, or field-stripped.
      expect(result!.components[0]).toBe(metricChart);
      expect(result!.components[1]).toBe(clock);
    });

    it.each([...DataSourceComponentTypes])(
      "strips %s even when it is the only widget on the dashboard",
      (componentType: DashboardComponentType) => {
        const result: DashboardViewConfig | null = sanitize(
          config([widget(componentType)]),
        );

        expect(result!.components).toEqual([]);
      },
    );

    it("strips every Data Source type at once and keeps every public type", () => {
      const dataSourceWidgets: Array<DashboardBaseComponent> =
        DataSourceComponentTypes.map(
          (componentType: DashboardComponentType) => {
            return widget(componentType);
          },
        );
      const publicWidgets: Array<DashboardBaseComponent> =
        PUBLIC_COMPONENT_TYPES.map((componentType: DashboardComponentType) => {
          return widget(componentType);
        });

      const result: DashboardViewConfig | null = sanitize(
        config([...dataSourceWidgets, ...publicWidgets]),
      );

      expect(componentTypesOf(result)).toEqual(PUBLIC_COMPONENT_TYPES);
    });

    it("covers every enum member named like a Data Source widget", () => {
      /*
       * DataSourceComponentTypes is the single list the sanitizer trusts. If
       * someone adds a DataSourceX enum member and forgets that list, the
       * widget would ship its query to anonymous viewers — catch it here.
       */
      const namedLikeDataSource: Array<DashboardComponentType> = Object.values(
        DashboardComponentType,
      ).filter((componentType: DashboardComponentType) => {
        return componentType.startsWith("DataSource");
      });

      expect(namedLikeDataSource.length).toBeGreaterThan(0);
      expect(new Set(namedLikeDataSource)).toEqual(
        new Set(DataSourceComponentTypes),
      );
    });

    it("preserves every other top-level key of the stored config", () => {
      const variables: Array<unknown> = [
        { id: "env", name: "Environment", defaultValue: "production" },
      ];

      const result: DashboardViewConfig | null = sanitize(
        config([widget(DashboardComponentType.DataSourceValue)], {
          name: "Public Status",
          heightInDashboardUnits: 42,
          refreshInterval: AutoRefreshInterval.THIRTY_SECONDS,
          variables: variables,
        }),
      );

      expect(result!._type).toBe(ObjectType.DashboardViewConfig);
      expect(result!.heightInDashboardUnits).toBe(42);
      expect(result!.refreshInterval).toBe(AutoRefreshInterval.THIRTY_SECONDS);
      expect((result as unknown as Record<string, unknown>)["name"]).toBe(
        "Public Status",
      );
      expect(result!.variables).toBe(variables);
    });

    it("does not mutate the stored config it was handed", () => {
      const storedConfig: DashboardViewConfig = config([
        widget(DashboardComponentType.Chart),
        widget(DashboardComponentType.DataSourceChart, {
          queries: [{ dataSourceId: "ds", query: "SELECT 1" }],
        }),
        widget(DashboardComponentType.DataSourceTable),
      ]);
      const snapshotBefore: string = JSON.stringify(storedConfig);

      const result: DashboardViewConfig | null = sanitize(storedConfig);

      expect(JSON.stringify(storedConfig)).toBe(snapshotBefore);
      expect(storedConfig.components).toHaveLength(3);
      expect(result!.components).not.toBe(storedConfig.components);
      expect(result).not.toBe(storedConfig);
    });

    it.each([
      { name: "an empty array", components: [] },
      { name: "undefined", components: undefined },
      { name: "null", components: null },
    ])(
      "yields an empty components array when components is $name",
      (testCase: { name: string; components: unknown }) => {
        const result: DashboardViewConfig | null = sanitize({
          _type: ObjectType.DashboardViewConfig,
          heightInDashboardUnits: 10,
          components: testCase.components,
        });

        expect(result!.components).toEqual([]);
      },
    );

    it("yields an empty components array when the key is missing entirely", () => {
      const result: DashboardViewConfig | null = sanitize({
        _type: ObjectType.DashboardViewConfig,
        heightInDashboardUnits: 10,
      });

      expect(result!.components).toEqual([]);
      expect(Object.prototype.hasOwnProperty.call(result, "components")).toBe(
        true,
      );
    });
  });

  describe("malformed stored config", () => {
    /*
     * componentType is typed, but the value arrives from a JSONB column that
     * an older or hand-edited client may have written. The sanitizer removes;
     * it does not validate — junk must survive untouched rather than throw or
     * be silently swallowed, because the widget renderer is what decides how
     * to fail on it.
     */
    interface JunkCase {
      name: string;
      component: unknown;
    }

    const JUNK_COMPONENTS: Array<JunkCase> = [
      { name: "null", component: null },
      { name: "undefined", component: undefined },
      { name: "a number", component: 42 },
      // A bare string is not a component, even when it spells a stripped type.
      { name: "a raw type string", component: "DataSourceChart" },
      { name: "a boolean", component: true },
      { name: "an array", component: [] },
      { name: "an object with no componentType", component: {} },
      {
        name: "componentType undefined",
        component: { componentType: undefined },
      },
      { name: "componentType null", component: { componentType: null } },
      { name: "componentType number", component: { componentType: 7 } },
      {
        name: "componentType object",
        component: {
          componentType: { name: DashboardComponentType.DataSourceChart },
        },
      },
      {
        name: "componentType array",
        component: {
          componentType: [DashboardComponentType.DataSourceChart],
        },
      },
      { name: "componentType empty string", component: { componentType: "" } },
      { name: "componentType whitespace", component: { componentType: "   " } },
      {
        name: "componentType padded with whitespace",
        component: { componentType: " DataSourceChart " },
      },
      {
        name: "componentType in the wrong case",
        component: { componentType: "datasourcechart" },
      },
      {
        name: "componentType from a newer client",
        component: { componentType: "SomeWidgetTypeFromTheFuture" },
      },
    ];

    function junkComponents(): Array<unknown> {
      return JUNK_COMPONENTS.map((testCase: JunkCase) => {
        return testCase.component;
      });
    }

    it("keeps malformed components instead of throwing", () => {
      const result: DashboardViewConfig | null = sanitize(
        config(junkComponents()),
      );

      expect(result!.components).toEqual(junkComponents());
    });

    it("still strips the real Data Source widgets sitting among the junk", () => {
      const result: DashboardViewConfig | null = sanitize(
        config([
          ...junkComponents(),
          widget(DashboardComponentType.DataSourceChart),
          widget(DashboardComponentType.Value),
        ]),
      );

      expect(result!.components).toHaveLength(JUNK_COMPONENTS.length + 1);
      expect(
        result!.components[result!.components.length - 1]!.componentType,
      ).toBe(DashboardComponentType.Value);
    });

    it("reports isDataSourceComponent false for every malformed shape", () => {
      const actual: Array<JSONObject> = JUNK_COMPONENTS.map(
        (testCase: JunkCase) => {
          return {
            name: testCase.name,
            isDataSource: PublicDashboardViewConfig.isDataSourceComponent(
              testCase.component as DashboardBaseComponent,
            ),
          };
        },
      );

      expect(actual).toEqual(
        JUNK_COMPONENTS.map((testCase: JunkCase) => {
          return { name: testCase.name, isDataSource: false };
        }),
      );
    });

    it.each([...DataSourceComponentTypes])(
      "isDataSourceComponent is true for a %s widget",
      (componentType: DashboardComponentType) => {
        expect(
          PublicDashboardViewConfig.isDataSourceComponent(
            widget(componentType),
          ),
        ).toBe(true);
      },
    );

    it("reports isDataSourceComponent false for every public widget type", () => {
      const dataSourceTypes: Array<DashboardComponentType> =
        PUBLIC_COMPONENT_TYPES.filter(
          (componentType: DashboardComponentType) => {
            return PublicDashboardViewConfig.isDataSourceComponent(
              widget(componentType),
            );
          },
        );

      expect(dataSourceTypes).toEqual([]);
    });

    it("is true for a bare componentType-only object and needs no other field", () => {
      /*
       * A widget stored before a base field existed is still a Data Source
       * widget; recognition must not depend on the rest of the shape.
       */
      expect(
        PublicDashboardViewConfig.isDataSourceComponent({
          componentType: DashboardComponentType.DataSourceGauge,
        } as unknown as DashboardBaseComponent),
      ).toBe(true);
    });
  });

  describe("query text never reaches the anonymous viewer", () => {
    const SQL_SECRET: string = "SELECT * FROM internal_billing_accounts";
    const PROMQL_SECRET: string =
      'sum(rate(payments_failed_total{job="billing-internal"}[5m]))';
    const LEGEND_SECRET: string = "{{customer_email}}";
    const DATA_SOURCE_ID_SECRET: string = "ds-internal-warehouse-9f21";

    function leakyConfig(): DashboardViewConfig {
      return config([
        widget(DashboardComponentType.Chart, { chartTitle: "Public CPU" }),
        widget(DashboardComponentType.DataSourceChart, {
          chartTitle: "Revenue",
          queries: [
            {
              id: "query-1",
              dataSourceId: DATA_SOURCE_ID_SECRET,
              query: SQL_SECRET,
              legend: LEGEND_SECRET,
            },
          ],
        }),
        widget(DashboardComponentType.DataSourceValue, {
          title: "Failures",
          query: {
            dataSourceId: DATA_SOURCE_ID_SECRET,
            query: PROMQL_SECRET,
          },
        }),
        widget(DashboardComponentType.DataSourceGauge, {
          query: {
            dataSourceId: DATA_SOURCE_ID_SECRET,
            query: "SELECT pct FROM internal_capacity",
          },
        }),
        widget(DashboardComponentType.DataSourceTable, {
          maxRows: 10,
          query: {
            dataSourceId: DATA_SOURCE_ID_SECRET,
            query: "SELECT email FROM internal_users",
          },
        }),
      ]);
    }

    it.each([
      SQL_SECRET,
      PROMQL_SECRET,
      LEGEND_SECRET,
      DATA_SOURCE_ID_SECRET,
      "internal_capacity",
      "internal_users",
    ])("does not serialize %s", (secret: string) => {
      const serialized: string = JSON.stringify(sanitize(leakyConfig()));

      expect(serialized).not.toContain(secret);
    });

    it("still serializes the widgets a public viewer can actually render", () => {
      const serialized: string = JSON.stringify(sanitize(leakyConfig()));

      expect(serialized).toContain("Public CPU");
      expect(serialized).toContain(DashboardComponentType.Chart);
    });

    /*
     * Issue #4571. A config is stored as it is sent, and the API reference
     * documented it wrapped in `{"_type": "DashboardViewConfig", "value":
     * {...}}` (and one widget in `{"_type": "DashboardComponent", "value":
     * {...}}`). The dashboard now reads those shapes and draws their
     * widgets (StoredDashboardViewConfig) - and before this, the sanitizer
     * looked only at a top-level `components`, found none, and served the
     * whole stored value, queries included. Every shape the dashboard reads
     * is stripped the same way.
     */
    type StoredShape = (stored: DashboardViewConfig) => unknown;

    function wrapEachWidget(
      wrap: (component: unknown) => unknown,
    ): StoredShape {
      return (stored: DashboardViewConfig): unknown => {
        return {
          ...stored,
          components: stored.components.map((component: unknown) => {
            return wrap(component);
          }),
        };
      };
    }

    const STORED_SHAPES: Array<[string, StoredShape]> = [
      [
        "the DashboardViewConfig envelope",
        (stored: DashboardViewConfig): unknown => {
          return { _type: "DashboardViewConfig", value: stored };
        },
      ],
      [
        "the envelope without its _type",
        (stored: DashboardViewConfig): unknown => {
          return { value: stored };
        },
      ],
      [
        "JSON text",
        (stored: DashboardViewConfig): unknown => {
          return JSON.stringify(stored);
        },
      ],
      [
        "the envelope as JSON text",
        (stored: DashboardViewConfig): unknown => {
          return JSON.stringify({
            _type: "DashboardViewConfig",
            value: stored,
          });
        },
      ],
      [
        "a widget list keyed 0, 1, 2 ...",
        (stored: DashboardViewConfig): unknown => {
          const keyed: Record<string, unknown> = {};
          stored.components.forEach((component: unknown, index: number) => {
            keyed[String(index)] = component;
          });
          return { ...stored, components: keyed };
        },
      ],
      [
        "each widget in the DashboardComponent envelope",
        wrapEachWidget((component: unknown): unknown => {
          return { _type: "DashboardComponent", value: component };
        }),
      ],
      [
        "each widget as JSON text",
        wrapEachWidget((component: unknown): unknown => {
          return JSON.stringify(component);
        }),
      ],
    ];

    describe.each(STORED_SHAPES)(
      "stored as %s",
      (_name: string, shape: StoredShape) => {
        it.each([
          SQL_SECRET,
          PROMQL_SECRET,
          LEGEND_SECRET,
          DATA_SOURCE_ID_SECRET,
          "internal_capacity",
          "internal_users",
        ])("does not serialize %s", (secret: string) => {
          const serialized: string = JSON.stringify(
            sanitize(shape(leakyConfig())),
          );

          expect(serialized).not.toContain(secret);
        });

        it("serves the widgets a public viewer can render, as a widget list", () => {
          const result: DashboardViewConfig | null = sanitize(
            shape(leakyConfig()),
          );

          expect(Array.isArray(result!.components)).toBe(true);
          expect(componentTypesOf(result)).toEqual([
            DashboardComponentType.Chart,
          ]);
          expect(JSON.stringify(result)).toContain("Public CPU");
        });
      },
    );
  });

  describe("where the widgets are (issue #4571)", () => {
    it("serves the envelope's own config, not the envelope", () => {
      const metricChart: DashboardBaseComponent = widget(
        DashboardComponentType.Chart,
      );

      const result: DashboardViewConfig | null = sanitize({
        _type: "DashboardViewConfig",
        value: config([metricChart], { name: "Inner" }),
      });

      expect(Object.prototype.hasOwnProperty.call(result, "value")).toBe(false);
      expect((result as unknown as Record<string, unknown>)["name"]).toBe(
        "Inner",
      );
      // Each widget is still passed through untouched.
      expect(result!.components[0]).toBe(metricChart);
    });

    it("leaves another type's envelope alone: nothing in it is a widget list", () => {
      const result: DashboardViewConfig | null = sanitize({
        _type: "MonitorSteps",
        value: config([widget(DashboardComponentType.DataSourceChart)]),
      });

      expect(result!.components).toEqual([]);
    });

    it("a widget in the DashboardComponent envelope is served as the widget inside", () => {
      const inner: DashboardBaseComponent = widget(DashboardComponentType.Text);

      const result: DashboardViewConfig | null = sanitize(
        config([{ _type: "DashboardComponent", value: inner }]),
      );

      expect(result!.components).toEqual([inner]);
    });

    it("a widget list that is one widget object is served as a list", () => {
      const only: DashboardBaseComponent = widget(DashboardComponentType.Value);

      const result: DashboardViewConfig | null = sanitize({
        _type: ObjectType.DashboardViewConfig,
        heightInDashboardUnits: 10,
        components: only,
      });

      expect(result!.components).toEqual([only]);
    });

    it.each([
      ["a number", 42],
      ["text that is not JSON", "not json"],
      ["a boolean", true],
    ])(
      "a stored value that is %s serves an empty widget list",
      (_name: string, value: unknown) => {
        expect(sanitize(value)!.components).toEqual([]);
      },
    );
  });

  /*
   * Issue #6297: the public metric routes read the config the public page
   * draws - what /view-config serves, read as the page reads it - and from
   * it only the settings of the widgets that chart metrics, through one
   * walk. These pin each piece on its own.
   */
  describe("what the public page draws (issue #6297)", () => {
    const CHART_ARGUMENTS: () => JSONObject = (): JSONObject => {
      return {
        chartTitle: "Latency",
        metricQueryConfig: {
          metricQueryData: {
            filterData: {
              metricName: "http.server.duration",
              telemetryServiceIds: [
                {
                  _type: "ObjectID",
                  value: "0f8fad5b-d9cb-469f-a165-70867728950e",
                },
              ],
              attributes: {
                "host.name": { _type: "Includes", value: ["web-1"] },
              },
            },
          },
        },
      };
    };

    const storedWidget: (
      componentType: string,
      widgetArguments?: unknown,
    ) => JSONObject = (
      componentType: string,
      widgetArguments?: unknown,
    ): JSONObject => {
      return {
        _type: "DashboardComponent",
        componentId: ObjectID.generate().toString(),
        componentType: componentType,
        topInDashboardUnits: 0,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 4,
        ...(widgetArguments === undefined
          ? {}
          : { arguments: widgetArguments as JSONObject }),
      };
    };

    // What the public page draws: the served config, sent as JSON, read.
    const pageDraws: (stored: unknown) => DashboardViewConfig = (
      stored: unknown,
    ): DashboardViewConfig => {
      const served: DashboardViewConfig | null =
        PublicDashboardViewConfig.sanitize(stored as DashboardViewConfig);

      return StoredDashboardViewConfig.read(
        JSON.parse(
          JSON.stringify(
            JSONFunctions.serialize(served as unknown as JSONObject),
          ),
        ),
      );
    };

    describe("getDrawnConfig", () => {
      it("is what the page draws of the served config, every widget in every shape it is stored in", () => {
        const chart: JSONObject = storedWidget(
          DashboardComponentType.Chart,
          CHART_ARGUMENTS(),
        );
        const stored: JSONObject = {
          _type: "DashboardViewConfig",
          heightInDashboardUnits: 24,
          components: [
            chart,
            JSON.stringify(
              storedWidget(DashboardComponentType.Value, CHART_ARGUMENTS()),
            ),
            {
              _type: "DashboardComponent",
              value: JSON.stringify(
                storedWidget(DashboardComponentType.Gauge, CHART_ARGUMENTS()),
              ),
            },
            {
              ...storedWidget(DashboardComponentType.Table),
              arguments: JSON.stringify({ tableTitle: "Hosts" }),
            },
            storedWidget(DashboardComponentType.DataSourceChart, {
              queries: [{ query: "SELECT secret" }],
            }),
            "not a widget",
          ],
          variables: JSON.stringify([
            {
              id: "cluster",
              name: "cluster",
              type: "Telemetry Attribute",
              attributeKey: "k8s.cluster.name",
            },
          ]),
        };

        for (const shape of [
          stored,
          JSON.stringify(stored),
          { _type: "DashboardViewConfig", value: stored },
          { ...stored, components: JSON.stringify(stored["components"]) },
        ]) {
          const drawn: DashboardViewConfig =
            PublicDashboardViewConfig.getDrawnConfig(shape);

          expect(drawn).toEqual(pageDraws(shape));
          expect(
            drawn.components.map((component: DashboardBaseComponent) => {
              return component.componentType;
            }),
          ).toEqual([
            DashboardComponentType.Chart,
            DashboardComponentType.Value,
            DashboardComponentType.Gauge,
            DashboardComponentType.Table,
          ]);
          expect(drawn.components[3]!.arguments).toEqual({
            tableTitle: "Hosts",
          });
          expect(
            drawn.variables!.map(
              (variable: DashboardVariable): string | undefined => {
                return variable.attributeKey;
              },
            ),
          ).toEqual(["k8s.cluster.name"]);
          expect(JSON.stringify(drawn)).not.toContain("SELECT secret");
        }
      });

      it("deserializes every widget as the page does", () => {
        const drawn: DashboardViewConfig =
          PublicDashboardViewConfig.getDrawnConfig({
            components: [
              storedWidget(DashboardComponentType.Chart, CHART_ARGUMENTS()),
              storedWidget(
                DashboardComponentType.Chart,
                JSON.stringify(CHART_ARGUMENTS()),
              ),
            ],
          });

        for (const component of drawn.components) {
          const filterData: JSONObject = (
            (
              (component.arguments as JSONObject)[
                "metricQueryConfig"
              ] as JSONObject
            )["metricQueryData"] as JSONObject
          )["filterData"] as JSONObject;

          expect(
            (filterData["telemetryServiceIds"] as Array<unknown>)[0],
          ).toBeInstanceOf(ObjectID);
          expect(
            (filterData["attributes"] as JSONObject)["host.name"],
          ).toBeInstanceOf(Includes);
        }
      });

      it.each([null, undefined, "", "text", 42, [], {}])(
        "draws nothing out of %p",
        (stored: unknown) => {
          const drawn: DashboardViewConfig =
            PublicDashboardViewConfig.getDrawnConfig(stored);

          expect(drawn.components).toEqual([]);
          expect(drawn.variables).toBeUndefined();
        },
      );

      it("leaves the stored value as it was", () => {
        const stored: JSONObject = {
          components: [
            storedWidget(
              DashboardComponentType.Chart,
              JSON.stringify(CHART_ARGUMENTS()),
            ),
          ],
        };
        const before: string = JSON.stringify(stored);

        PublicDashboardViewConfig.getDrawnConfig(stored);

        expect(JSON.stringify(stored)).toBe(before);
      });
    });

    describe("getMetricWidgetSettings", () => {
      it("is the arguments of the chart, value, gauge and table widgets, in order, as drawn", () => {
        const drawn: DashboardViewConfig =
          PublicDashboardViewConfig.getDrawnConfig({
            components: [
              storedWidget(DashboardComponentType.Text, { text: "Hello" }),
              storedWidget(DashboardComponentType.Table, { tableTitle: "1" }),
              storedWidget(DashboardComponentType.Chart, { chartTitle: "2" }),
              storedWidget(DashboardComponentType.IncidentList, {
                title: "Incidents",
              }),
              storedWidget(DashboardComponentType.Gauge, { gaugeTitle: "3" }),
              storedWidget(DashboardComponentType.Value, { title: "4" }),
              storedWidget(DashboardComponentType.DataSourceValue, {
                title: "Data Source",
              }),
            ],
          });

        expect(
          PublicDashboardViewConfig.getMetricWidgetSettings(drawn),
        ).toEqual([
          { tableTitle: "1" },
          { chartTitle: "2" },
          { gaugeTitle: "3" },
          { title: "4" },
        ]);
      });

      it("gives a metric widget saved without arguments an empty set, as the page draws it", () => {
        expect(
          PublicDashboardViewConfig.getMetricWidgetSettings(
            PublicDashboardViewConfig.getDrawnConfig({
              components: [storedWidget(DashboardComponentType.Chart)],
            }),
          ),
        ).toEqual([{}]);
      });

      it("matches each widget type exactly, and reads every type that charts metrics and none other", () => {
        for (const componentType of [
          ...Object.values(DashboardComponentType),
          " Chart ",
          "chart",
          "CHART",
          "HostMetricChart",
          "constructor",
          "__proto__",
        ]) {
          const settings: Array<JSONObject> =
            PublicDashboardViewConfig.getMetricWidgetSettings(
              PublicDashboardViewConfig.getDrawnConfig({
                components: [storedWidget(componentType, { marker: 1 })],
              }),
            );

          expect([componentType, settings.length]).toEqual([
            componentType,
            (MetricComponentTypes as ReadonlyArray<string>).includes(
              componentType,
            )
              ? 1
              : 0,
          ]);
        }

        expect([...MetricComponentTypes].sort()).toEqual(
          [
            DashboardComponentType.Chart,
            DashboardComponentType.Gauge,
            DashboardComponentType.Table,
            DashboardComponentType.Value,
          ].sort(),
        );

        // None of them is a Data Source widget the sanitizer drops.
        for (const componentType of MetricComponentTypes) {
          expect(DataSourceComponentTypes).not.toContain(componentType);
        }
      });
    });

    describe("forEachSettingsObject", () => {
      const visited: (value: unknown) => Array<Record<string, unknown>> = (
        value: unknown,
      ): Array<Record<string, unknown>> => {
        const objects: Array<Record<string, unknown>> = [];

        PublicDashboardViewConfig.forEachSettingsObject(
          value,
          (settings: Record<string, unknown>): void => {
            objects.push(settings);
          },
        );

        return objects;
      };

      it("visits every plain object at any depth, through lists and objects, each before what it holds", () => {
        const inner: JSONObject = { name: "inner" };
        const listed: JSONObject = { name: "listed", inner: inner };
        const root: JSONObject = {
          name: "root",
          list: [1, "two", listed, [[{ name: "deep" }]]],
        };

        expect(
          visited([root]).map((settings: Record<string, unknown>) => {
            return settings["name"];
          }),
        ).toEqual(["root", "listed", "inner", "deep"]);
      });

      it("never walks into a deserialized value: an ObjectID, a query operator, a date", () => {
        const values: Array<unknown> = [
          new ObjectID("0f8fad5b-d9cb-469f-a165-70867728950e"),
          new Includes([{ metricName: "inside" } as unknown as string]),
          new Date(),
        ];

        expect(visited({ values: values })).toEqual([{ values: values }]);
      });

      it("never reads a value under a __proto__ key, which JSON keeps as an ordinary key", () => {
        const parsed: JSONObject = JSON.parse(
          '{"name": "root", "__proto__": {"name": "smuggled"}}',
        ) as JSONObject;

        expect(Object.keys(parsed)).toContain("__proto__");
        expect(
          visited(parsed).map((settings: Record<string, unknown>) => {
            return settings["name"];
          }),
        ).toEqual(["root"]);
      });

      it.each([null, undefined, 0, "text", true])(
        "visits nothing in %p",
        (value: unknown) => {
          expect(visited(value)).toEqual([]);
        },
      );
    });

    describe("isSettingsObject and getSettingsKeys", () => {
      it("a plain object, from JSON or the deserializer, is settings; nothing else is", () => {
        const nullPrototype: Record<string, unknown> = Object.create(null);

        for (const [value, expected] of [
          [{}, true],
          [{ a: 1 }, true],
          [JSON.parse('{"a": 1}'), true],
          [JSONFunctions.deserialize({ a: { b: 1 } } as JSONObject), true],
          [nullPrototype, true],
          [[], false],
          [null, false],
          [undefined, false],
          ["text", false],
          [7, false],
          [new ObjectID("0f8fad5b-d9cb-469f-a165-70867728950e"), false],
          [new Includes(["a"]), false],
          [new Date(), false],
        ] as Array<[unknown, boolean]>) {
          expect([
            value,
            PublicDashboardViewConfig.isSettingsObject(value),
          ]).toEqual([value, expected]);
        }
      });

      it("the keys are each own key but __proto__", () => {
        const parsed: Record<string, unknown> = JSON.parse(
          '{"b": 1, "__proto__": {"c": 2}, "a": 3}',
        ) as Record<string, unknown>;

        expect(PublicDashboardViewConfig.getSettingsKeys(parsed)).toEqual([
          "b",
          "a",
        ]);
        expect(
          PublicDashboardViewConfig.getSettingsKeys(
            Object.create({ inherited: true }) as Record<string, unknown>,
          ),
        ).toEqual([]);
      });
    });
  });
});
