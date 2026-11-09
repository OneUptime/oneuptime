import { describe, expect, it } from "@jest/globals";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardComponentType, {
  DataSourceComponentTypes,
  MetricComponentTypes,
} from "../../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../../Types/Dashboard/DashboardVariable";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../../Types/Dashboard/DashboardViewConfig";
import Includes from "../../../../Types/BaseDatabase/Includes";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import JSONFunctions from "../../../../Types/JSONFunctions";
import ObjectID from "../../../../Types/ObjectID";
import TimeRange from "../../../../Types/Time/TimeRange";
import {
  PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES,
  PUBLIC_DASHBOARD_WIDGET_SETTINGS,
  PublicDashboardServedWidgetType,
  PublicDashboardWidgetSettings,
} from "../../../../Types/Dashboard/PublicDashboardServedSettings";
import StoredDashboardViewConfig from "../../../../Utils/Dashboard/StoredDashboardViewConfig";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

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
 * The tests below therefore care about three things that are easy to
 * regress: that every Data Source widget type disappears (driven off
 * DataSourceComponentTypes, so a fifth type added later is covered here the
 * day it is added); that what is served is what the public page draws, and
 * nothing more, in every shape and at every depth the config can be stored
 * in (issue #6327); and that the page still draws everything else as before
 * - a sanitizer that quietly drops variables, reorders widgets, or mutates
 * the stored entity would corrupt the dashboard for its authenticated owner
 * too.
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

/*
 * What is served of a well-formed widget: its id as text, its type, its
 * place on the board and its settings - the fields the public page reads.
 */
function served(component: DashboardBaseComponent): JSONObject {
  return {
    _type: ObjectType.DashboardComponent,
    componentId: component.componentId.toString(),
    componentType: component.componentType,
    topInDashboardUnits: component.topInDashboardUnits,
    leftInDashboardUnits: component.leftInDashboardUnits,
    widthInDashboardUnits: component.widthInDashboardUnits,
    heightInDashboardUnits: component.heightInDashboardUnits,
    minWidthInDashboardUnits: component.minWidthInDashboardUnits,
    minHeightInDashboardUnits: component.minHeightInDashboardUnits,
    arguments: component.arguments as JSONObject,
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

    it("serves each surviving widget as the page reads it: its id, type, place and the settings its type has", () => {
      const metricQueryConfigs: Array<JSONObject> = [{ metricAliasData: {} }];
      const metricChart: DashboardBaseComponent = {
        ...widget(DashboardComponentType.Chart, {
          chartTitle: "CPU",
          metricQueryConfigs: metricQueryConfigs,
          /*
           * A setting a chart does not have: no board reads it, so it is
           * not served (issue #6338). Before, every setting was.
           */
          queryConfigs: [{ metricAliasData: { title: "for the owner only" } }],
        }),
        // A key no board reads: kept for a save signed in, never served.
        notes: "for the owner only",
      } as DashboardBaseComponent;
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

      expect(result!.components).toEqual([
        served({
          ...metricChart,
          arguments: {
            chartTitle: "CPU",
            metricQueryConfigs: metricQueryConfigs,
          },
        }),
        served(clock),
      ]);
      expect(JSON.stringify(result)).not.toContain("for the owner only");

      // Each setting served is the stored one: nothing in it is rewritten.
      expect(
        (result!.components[0]!.arguments as JSONObject)["metricQueryConfigs"],
      ).toBe(metricQueryConfigs);
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

    it("serves the board's own settings as the board reads them, and no key no board reads", () => {
      const variables: Array<unknown> = [
        { id: "env", name: "Environment", defaultValue: "production" },
      ];

      const stored: DashboardViewConfig = config(
        [widget(DashboardComponentType.DataSourceValue)],
        {
          name: "Public Status",
          heightInDashboardUnits: 42,
          refreshInterval: AutoRefreshInterval.THIRTY_SECONDS,
          variables: variables,
          // A key no board reads, holding what a script kept of old widgets.
          backup: [
            widget(DashboardComponentType.DataSourceTable, {
              query: { query: "SELECT email FROM internal_users" },
            }),
          ],
        },
      );

      const result: DashboardViewConfig | null = sanitize(stored);

      expect(Object.keys(result!).sort()).toEqual(
        [
          "_type",
          "components",
          "heightInDashboardUnits",
          "refreshInterval",
          "variables",
        ].sort(),
      );
      expect(result!._type).toBe(ObjectType.DashboardViewConfig);
      expect(result!.heightInDashboardUnits).toBe(42);
      expect(result!.refreshInterval).toBe(AutoRefreshInterval.THIRTY_SECONDS);
      // The variables as the toolbar reads them, signed in or not.
      expect(result!.variables).toEqual([
        { id: "env", name: "Environment", defaultValue: "production" },
      ]);
      expect(result!.variables).toEqual(
        StoredDashboardViewConfig.read(stored).variables,
      );
      expect(JSON.stringify(result)).not.toContain("internal_users");
      expect(JSON.stringify(result)).not.toContain("Public Status");
    });

    it("serves a board setting the board cannot read as the board reads it: the fallback, or nothing", () => {
      const result: DashboardViewConfig | null = sanitize(
        config([widget(DashboardComponentType.Text)], {
          heightInDashboardUnits: "not a height",
          timeRange: "Custom",
          refreshInterval: "2s",
          variables: "not a list",
        }),
      );

      expect(Object.keys(result!).sort()).toEqual(
        ["_type", "components", "heightInDashboardUnits"].sort(),
      );
      expect(result!.heightInDashboardUnits).toBe(
        StoredDashboardViewConfig.read({}).heightInDashboardUnits,
      );

      // A height written as text is the number it says.
      expect(
        sanitize(config([], { heightInDashboardUnits: "24" }))!
          .heightInDashboardUnits,
      ).toBe(24);
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
     * an older or hand-edited client may have written. Nothing here throws,
     * and nothing is served that the page does not draw (issue #6327):
     *
     * - an entry no widget is read from - null, a number, text, a list - is
     *   drawn by no board, so it is not served at all, whatever it holds;
     * - a widget of a type no board draws is drawn as "This widget could
     *   not be shown" in its place, so only its type and its place are
     *   served, never what its settings say.
     *
     * `servedType` is the type each is served as, or null when it is not
     * served.
     */
    interface JunkCase {
      name: string;
      component: unknown;
      servedType: string | null;
    }

    const JUNK_COMPONENTS: Array<JunkCase> = [
      { name: "null", component: null, servedType: null },
      { name: "undefined", component: undefined, servedType: null },
      { name: "a number", component: 42, servedType: null },
      // A bare string is not a component, even when it spells a stripped type.
      {
        name: "a raw type string",
        component: "DataSourceChart",
        servedType: null,
      },
      { name: "a boolean", component: true, servedType: null },
      { name: "an array", component: [], servedType: null },
      {
        name: "an array holding a Data Source widget",
        component: [
          {
            componentType: DashboardComponentType.DataSourceChart,
            arguments: { queries: [{ query: "SELECT * FROM internal_list" }] },
          },
        ],
        servedType: null,
      },
      {
        name: "an object with no componentType",
        component: {},
        servedType: "",
      },
      {
        name: "componentType undefined",
        component: { componentType: undefined },
        servedType: "",
      },
      {
        name: "componentType null",
        component: { componentType: null },
        servedType: "",
      },
      {
        name: "componentType number",
        component: { componentType: 7 },
        servedType: "",
      },
      {
        name: "componentType object",
        component: {
          componentType: { name: DashboardComponentType.DataSourceChart },
        },
        servedType: "",
      },
      {
        name: "componentType array",
        component: {
          componentType: [DashboardComponentType.DataSourceChart],
        },
        servedType: "",
      },
      {
        name: "componentType empty string",
        component: { componentType: "" },
        servedType: "",
      },
      {
        name: "componentType whitespace",
        component: { componentType: "   " },
        servedType: "   ",
      },
      {
        name: "componentType padded with whitespace",
        component: {
          componentType: " DataSourceChart ",
          arguments: { queries: [{ query: "SELECT * FROM internal_padded" }] },
        },
        servedType: " DataSourceChart ",
      },
      {
        name: "componentType in the wrong case",
        component: {
          componentType: "datasourcechart",
          arguments: { queries: [{ query: "SELECT * FROM internal_case" }] },
        },
        servedType: "datasourcechart",
      },
      {
        name: "componentType from a newer client",
        component: {
          componentType: "SomeWidgetTypeFromTheFuture",
          arguments: { secretSetting: "internal_future" },
        },
        servedType: "SomeWidgetTypeFromTheFuture",
      },
    ];

    function junkComponents(): Array<unknown> {
      return JUNK_COMPONENTS.map((testCase: JunkCase) => {
        return testCase.component;
      });
    }

    const SERVED_TYPES: Array<string> = JUNK_COMPONENTS.filter(
      (testCase: JunkCase): boolean => {
        return testCase.servedType !== null;
      },
    ).map((testCase: JunkCase): string => {
      return testCase.servedType!;
    });

    it("serves no entry that is no widget, and a widget of no type the page draws as its place alone", () => {
      const result: DashboardViewConfig | null = sanitize(
        config(junkComponents()),
      );

      expect(result!.components).toEqual(
        SERVED_TYPES.map((servedType: string): JSONObject => {
          return {
            _type: ObjectType.DashboardComponent,
            componentType: servedType,
            topInDashboardUnits: 0,
            leftInDashboardUnits: 0,
            widthInDashboardUnits: 6,
            heightInDashboardUnits: 4,
            minWidthInDashboardUnits: 1,
            minHeightInDashboardUnits: 1,
          };
        }),
      );

      // What their settings say never leaves the server.
      for (const secret of [
        "internal_list",
        "internal_padded",
        "internal_case",
        "internal_future",
      ]) {
        expect(JSON.stringify(result)).not.toContain(secret);
      }
    });

    it("and the page draws each of them as the widget that could not be shown, as every board does", () => {
      const stored: DashboardViewConfig = config(junkComponents());

      const drawnTypes: Array<string> = StoredDashboardViewConfig.read(
        JSON.parse(JSON.stringify(sanitize(stored))),
      ).components.map((component: DashboardBaseComponent): string => {
        return component.componentType;
      });

      expect(drawnTypes).toEqual(SERVED_TYPES);
      expect(drawnTypes).toEqual(
        StoredDashboardViewConfig.read(stored).components.map(
          (component: DashboardBaseComponent): string => {
            return component.componentType;
          },
        ),
      );
    });

    it("still strips the real Data Source widgets sitting among the junk", () => {
      const result: DashboardViewConfig | null = sanitize(
        config([
          ...junkComponents(),
          widget(DashboardComponentType.DataSourceChart),
          widget(DashboardComponentType.Value),
        ]),
      );

      expect(componentTypesOf(result)).toEqual([
        ...SERVED_TYPES,
        DashboardComponentType.Value,
      ]);
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
      // The envelope's own settings, as the board reads them, and no others.
      expect(Object.keys(result!).sort()).toEqual(
        ["_type", "components", "heightInDashboardUnits"].sort(),
      );
      expect(result!.heightInDashboardUnits).toBe(60);
      expect(result!.components).toEqual([served(metricChart)]);
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

      expect(result!.components).toEqual([served(inner)]);
    });

    it("a widget list that is one widget object is served as a list", () => {
      const only: DashboardBaseComponent = widget(DashboardComponentType.Value);

      const result: DashboardViewConfig | null = sanitize({
        _type: ObjectType.DashboardViewConfig,
        heightInDashboardUnits: 10,
        components: only,
      });

      expect(result!.components).toEqual([served(only)]);
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

/*
 * Issue #6327. A widget can be stored inside layers of JSON text and of the
 * `{"_type": "DashboardComponent", "value": ...}` envelope - by a script
 * that writes back as text what it read, say, once on every run. Every
 * board reads an entry through at most five such layers, and a config
 * through at most four; past them is a widget of no type, or a board with
 * no widgets. The sanitizer used to pass on what it found after its own
 * five layers, and the public page then read five more: a Data Source
 * widget in six to ten envelopes was drawn as one, its query served with
 * it, and a deeper one was served all the same. Text no reader opens - a
 * widget written as JSON text twice, say - was served as it was stored.
 *
 * Now what is served is built from what the page draws, so nothing of a
 * widget the page does not draw leaves the server, at any depth.
 */
describe("what a visitor is served, in every shape and at every depth (issue #6327)", () => {
  // How far every board reads (StoredDashboardViewConfig's bound).
  const WIDGET_LAYERS_READ: number = 5;
  const CONFIG_LAYERS_READ: number = 4;

  // One layer around a stored value.
  type Layer = "envelope" | "text";

  // A value inside these layers, the first the outermost.
  const wrapped: (
    value: unknown,
    layers: ReadonlyArray<Layer>,
    envelopeType: string,
  ) => unknown = (
    value: unknown,
    layers: ReadonlyArray<Layer>,
    envelopeType: string,
  ): unknown => {
    let current: unknown = value;

    for (let index: number = layers.length - 1; index >= 0; index--) {
      current =
        layers[index] === "text"
          ? JSON.stringify(current)
          : { _type: envelopeType, value: current };
    }

    return current;
  };

  const repeated: (layers: Array<Layer>, times: number) => Array<Layer> = (
    layers: Array<Layer>,
    times: number,
  ): Array<Layer> => {
    const all: Array<Layer> = [];

    for (let time: number = 0; time < times; time++) {
      all.push(...layers);
    }

    return all;
  };

  type Reading = "the widget" | "no widget" | "a widget of no type";

  /*
   * What every board reads an entry stored in these layers as, worked out
   * from the layers alone by the rules StoredDashboardViewConfig keeps:
   * text is read once and must say an object, an envelope is opened when
   * its value is an object or text that says one, and at most five layers
   * are read through.
   */
  const readingOf: (layers: ReadonlyArray<Layer>) => Reading = (
    layers: ReadonlyArray<Layer>,
  ): Reading => {
    let index: number = 0;
    let read: number = 0;

    if (layers[0] === "text") {
      if (layers[1] === "text") {
        return "no widget";
      }

      index = 1;
      read = 1;
    }

    while (index < layers.length) {
      if (read === WIDGET_LAYERS_READ) {
        return "a widget of no type";
      }

      if (layers[index + 1] === "text") {
        if (layers[index + 2] === "text") {
          return "a widget of no type";
        }

        index += 2;
      } else {
        index += 1;
      }

      read++;
    }

    return "the widget";
  };

  /*
   * Each layer of JSON text escapes everything inside it again, so a widget
   * doubles in size with each one: 1.7 MB at 16 layers, gigabytes at 30. No
   * config can be stored that deep in text, so the wrappings with text in
   * them are swept as deep as a value can be made, and the envelope - and
   * a mix with no more than ten layers of text - far deeper.
   */
  const MAX_MIXED_TEXT_LAYERS: number = 10;

  const mixedLayers: (depth: number, seed: number) => Array<Layer> = (
    depth: number,
    seed: number,
  ): Array<Layer> => {
    const random: SeededRandom = seededRandom(seed);
    const layers: Array<Layer> = [];
    let textLayers: number = 0;

    for (let step: number = 0; step < depth; step++) {
      const kind: number = textLayers >= MAX_MIXED_TEXT_LAYERS ? 0 : random(3);

      if (kind === 0) {
        layers.push("envelope");
      } else if (kind === 1) {
        layers.push("envelope", "text");
        textLayers++;
      } else {
        layers.push("text");
        textLayers++;
      }
    }

    return layers;
  };

  interface Wrapping {
    name: string;
    deepest: number;
    layersAt: (depth: number) => Array<Layer>;
  }

  const WRAPPINGS: Array<Wrapping> = [
    {
      name: "the envelope",
      deepest: 48,
      layersAt: (depth: number): Array<Layer> => {
        return repeated(["envelope"], depth);
      },
    },
    {
      name: "the envelope with its value as JSON text",
      deepest: 14,
      layersAt: (depth: number): Array<Layer> => {
        return repeated(["envelope", "text"], depth);
      },
    },
    {
      name: "JSON text",
      deepest: 16,
      layersAt: (depth: number): Array<Layer> => {
        return repeated(["text"], depth);
      },
    },
    {
      name: "a mix of the three",
      deepest: 40,
      layersAt: (depth: number): Array<Layer> => {
        return mixedLayers(depth, 632700 + depth);
      },
    },
  ];

  const TEXT_WIDGET_ID: string = "7e57a000-0000-4000-a000-000000000001";
  const DATA_SOURCE_WIDGET_ID: string = "d5d5d5d5-0000-4000-a000-000000000001";

  // A Data Source widget whose every secret carries the token.
  const dataSourceWidget: (
    componentType: string,
    token: string,
    componentId?: string | undefined,
  ) => JSONObject = (
    componentType: string,
    token: string,
    componentId?: string | undefined,
  ): JSONObject => {
    return {
      ...(componentId ? { componentId: componentId } : {}),
      componentType: componentType,
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      arguments: {
        chartTitle: `Revenue by tenant ${token}`,
        query: {
          dataSourceId: `ds-${token}`,
          query: `SELECT secret FROM internal_${token}`,
        },
        queries: [
          {
            id: "query-1",
            dataSourceId: `ds-${token}`,
            query: `SELECT secret FROM internal_${token}`,
            legend: `{{customer_${token}}}`,
          },
        ],
      },
    };
  };

  const textWidget: () => JSONObject = (): JSONObject => {
    return {
      componentId: TEXT_WIDGET_ID,
      componentType: DashboardComponentType.Text,
      topInDashboardUnits: 4,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 2,
      arguments: { text: "Status of the public service" },
    };
  };

  // A chart stored without an id: it is drawn under one derived for it.
  const chartWidget: (title: string) => JSONObject = (
    title: string,
  ): JSONObject => {
    return {
      componentType: DashboardComponentType.Chart,
      topInDashboardUnits: 6,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 12,
      heightInDashboardUnits: 4,
      arguments: {
        chartTitle: title,
        metricQueryConfig: {
          metricQueryData: {
            filterData: { metricName: "system.cpu.utilization" },
          },
        },
      },
    };
  };

  // The id derived for the n-th widget the page draws without one.
  const derivedId: (sequence: number) => string = (
    sequence: number,
  ): string => {
    return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
  };

  // Everything /view-config sends, as text.
  const servedJSON: (stored: unknown) => string = (stored: unknown): string => {
    const served: DashboardViewConfig | null =
      PublicDashboardViewConfig.sanitize(stored as DashboardViewConfig);

    return JSON.stringify(
      served ? JSONFunctions.serialize(served as unknown as JSONObject) : null,
    );
  };

  // What the public page draws: the served config, sent as JSON, read.
  const pageDraws: (stored: unknown) => DashboardViewConfig = (
    stored: unknown,
  ): DashboardViewConfig => {
    return StoredDashboardViewConfig.read(JSON.parse(servedJSON(stored)));
  };

  const typesDrawn: (drawn: DashboardViewConfig) => Array<string> = (
    drawn: DashboardViewConfig,
  ): Array<string> => {
    return drawn.components.map((component: DashboardBaseComponent): string => {
      return component.componentType;
    });
  };

  // The settings a drawn widget was read with, as their JSON.
  const settingsJSON: (component: DashboardBaseComponent) => unknown = (
    component: DashboardBaseComponent,
  ): unknown => {
    return JSON.parse(
      JSON.stringify(
        JSONFunctions.serializeValue(component.arguments as JSONObject),
      ),
    );
  };

  describe("the issue's own widget: a Data Source table in six envelopes", () => {
    it("serves none of it, and the page draws it as the widget that could not be shown, as every board does", () => {
      let entry: unknown = {
        componentType: DashboardComponentType.DataSourceTable,
        arguments: { query: "SELECT secret FROM internal_table" },
      };

      for (let layer: number = 0; layer < 6; layer++) {
        entry = { _type: "DashboardComponent", value: entry };
      }

      const stored: JSONObject = { components: [entry as JSONObject] };

      expect(servedJSON(stored)).not.toContain("internal_table");
      expect(typesDrawn(pageDraws(stored))).toEqual([""]);
      expect(typesDrawn(StoredDashboardViewConfig.read(stored))).toEqual([""]);
      expect(PublicDashboardViewConfig.getDrawnConfig(stored)).toEqual(
        pageDraws(stored),
      );
    });
  });

  describe.each(WRAPPINGS)("a widget inside $name", (wrapping: Wrapping) => {
    const depths: Array<number> = [];

    for (let depth: number = 0; depth <= wrapping.deepest; depth++) {
      depths.push(depth);
    }

    it(`never serves a Data Source widget, from 0 to ${wrapping.deepest} layers deep, and the page draws the rest as every board does`, () => {
      for (const depth of depths) {
        const layers: Array<Layer> = wrapping.layersAt(depth);
        const reading: Reading = readingOf(layers);

        for (const componentType of DataSourceComponentTypes) {
          const label: string = `${depth} layers, ${componentType}`;
          const token: string = `leak${depth}${componentType}`;
          // Half of them stored without an id, so the page derives one.
          const ownId: string | undefined =
            depth % 2 === 0 ? DATA_SOURCE_WIDGET_ID : undefined;

          const stored: JSONObject = {
            _type: "DashboardViewConfig",
            heightInDashboardUnits: 24,
            components: [
              wrapped(
                dataSourceWidget(componentType, token, ownId),
                layers,
                "DashboardComponent",
              ) as JSONObject,
              textWidget(),
              chartWidget("Public CPU"),
            ],
          };

          // Not vacuous: the stored config holds every secret.
          expect([label, JSON.stringify(stored).includes(token)]).toEqual([
            label,
            true,
          ]);

          const json: string = servedJSON(stored);

          expect([
            label,
            json.includes(token),
            json.includes(DATA_SOURCE_WIDGET_ID),
          ]).toEqual([label, false, false]);

          // The public routes read exactly what the page draws.
          const drawn: DashboardViewConfig = pageDraws(stored);

          expect([
            label,
            PublicDashboardViewConfig.getDrawnConfig(stored),
          ]).toEqual([label, drawn]);

          // The page draws what every board draws, but the Data Source widget.
          const noType: Array<string> =
            reading === "a widget of no type" ? [""] : [];

          expect([label, typesDrawn(drawn)]).toEqual([
            label,
            [
              ...noType,
              DashboardComponentType.Text,
              DashboardComponentType.Chart,
            ],
          ]);
          expect([
            label,
            typesDrawn(StoredDashboardViewConfig.read(stored)),
          ]).toEqual([
            label,
            [
              ...(reading === "the widget" ? [componentType] : noType),
              DashboardComponentType.Text,
              DashboardComponentType.Chart,
            ],
          ]);

          // The rest, with their settings and under the ids the page derives.
          const [text, chart] = drawn.components.slice(noType.length);

          expect([
            label,
            text!.componentId.toString(),
            settingsJSON(text!),
          ]).toEqual([label, TEXT_WIDGET_ID, textWidget()["arguments"]]);
          expect([
            label,
            chart!.componentId.toString(),
            settingsJSON(chart!),
          ]).toEqual([
            label,
            derivedId(noType.length + 1),
            chartWidget("Public CPU")["arguments"],
          ]);
        }
      }
    });

    it(`serves a widget the page draws only while every board reads it as one, from 0 to ${wrapping.deepest} layers deep`, () => {
      for (const depth of depths) {
        const layers: Array<Layer> = wrapping.layersAt(depth);
        const reading: Reading = readingOf(layers);
        const label: string = `${depth} layers: ${reading}`;
        const title: string = `Deep chart ${depth}`;

        const stored: JSONObject = {
          components: [
            wrapped(
              chartWidget(title),
              layers,
              "DashboardComponent",
            ) as JSONObject,
          ],
        };

        const drawn: DashboardViewConfig = pageDraws(stored);
        const signedIn: DashboardViewConfig =
          StoredDashboardViewConfig.read(stored);

        const expected: Array<string> =
          reading === "the widget"
            ? [DashboardComponentType.Chart]
            : reading === "a widget of no type"
              ? [""]
              : [];

        expect([label, typesDrawn(drawn)]).toEqual([label, expected]);
        expect([label, typesDrawn(signedIn)]).toEqual([label, expected]);
        expect([label, servedJSON(stored).includes(title)]).toEqual([
          label,
          reading === "the widget",
        ]);

        if (reading === "the widget") {
          expect([label, settingsJSON(drawn.components[0]!)]).toEqual([
            label,
            settingsJSON(signedIn.components[0]!),
          ]);
        }
      }
    });
  });

  describe.each(WRAPPINGS)(
    "the whole config inside $name",
    (wrapping: Wrapping) => {
      it(`never serves a Data Source widget, from 0 to ${wrapping.deepest} layers deep, and opens with its widgets while every board can read it`, () => {
        for (let depth: number = 0; depth <= wrapping.deepest; depth++) {
          const layers: Array<Layer> = wrapping.layersAt(depth);
          const label: string = `${depth} layers (${layers.length} in all)`;
          const token: string = `configleak${depth}`;

          const stored: unknown = wrapped(
            {
              heightInDashboardUnits: 24,
              timeRange: TimeRange.PAST_ONE_DAY,
              components: [
                dataSourceWidget(DashboardComponentType.DataSourceChart, token),
                textWidget(),
              ],
              backup: dataSourceWidget(
                DashboardComponentType.DataSourceTable,
                token,
              ),
            },
            layers,
            "DashboardViewConfig",
          );

          expect([label, servedJSON(stored).includes(token)]).toEqual([
            label,
            false,
          ]);

          const drawn: DashboardViewConfig = pageDraws(stored);
          const isRead: boolean = layers.length <= CONFIG_LAYERS_READ;

          expect([label, typesDrawn(drawn)]).toEqual([
            label,
            isRead ? [DashboardComponentType.Text] : [],
          ]);
          expect([
            label,
            typesDrawn(StoredDashboardViewConfig.read(stored)),
          ]).toEqual([
            label,
            isRead
              ? [
                  DashboardComponentType.DataSourceChart,
                  DashboardComponentType.Text,
                ]
              : [],
          ]);
          expect([
            label,
            PublicDashboardViewConfig.getDrawnConfig(stored),
          ]).toEqual([label, drawn]);
        }
      });
    },
  );

  describe("the widget list, in every shape it can be stored in", () => {
    const keyed: (list: Array<unknown>) => JSONObject = (
      list: Array<unknown>,
    ): JSONObject => {
      const byIndex: JSONObject = {};

      list.forEach((entry: unknown, index: number) => {
        byIndex[String(index)] = entry as JSONObject;
      });

      return byIndex;
    };

    // Each shape, and whether every board reads a widget list out of it.
    const LIST_SHAPES: Array<
      [string, (list: Array<unknown>) => unknown, boolean]
    > = [
      [
        "a list",
        (list: Array<unknown>): unknown => {
          return list;
        },
        true,
      ],
      [
        "a list written as JSON text",
        (list: Array<unknown>): unknown => {
          return JSON.stringify(list);
        },
        true,
      ],
      ["a list keyed 0, 1, 2", keyed, true],
      [
        "a keyed list written as JSON text",
        (list: Array<unknown>): unknown => {
          return JSON.stringify(keyed(list));
        },
        true,
      ],
      [
        "a list written as JSON text twice",
        (list: Array<unknown>): unknown => {
          return JSON.stringify(JSON.stringify(list));
        },
        false,
      ],
      [
        "a list in the DashboardComponent envelope",
        (list: Array<unknown>): unknown => {
          return { _type: "DashboardComponent", value: list };
        },
        false,
      ],
      [
        "a list in the DashboardViewConfig envelope, as JSON text",
        (list: Array<unknown>): unknown => {
          return JSON.stringify({ _type: "DashboardViewConfig", value: list });
        },
        false,
      ],
    ];

    // The config around the list: the issue's "inside an envelope inside text".
    const CONFIG_SHAPES: Array<[string, (config: JSONObject) => unknown]> = [
      [
        "an object",
        (config: JSONObject): unknown => {
          return config;
        },
      ],
      [
        "the envelope inside JSON text",
        (config: JSONObject): unknown => {
          return JSON.stringify({
            _type: "DashboardViewConfig",
            value: config,
          });
        },
      ],
      [
        "JSON text inside the envelope inside JSON text",
        (config: JSONObject): unknown => {
          return JSON.stringify({
            _type: "DashboardViewConfig",
            value: JSON.stringify(config),
          });
        },
      ],
    ];

    it.each(LIST_SHAPES)(
      "%s: never a Data Source widget, and the page draws what every board draws",
      (
        _name: string,
        shape: (list: Array<unknown>) => unknown,
        isRead: boolean,
      ) => {
        for (const [configName, storeConfig] of CONFIG_SHAPES) {
          for (const depth of [0, 1, 5, 6, 12, 30]) {
            const label: string = `${configName}, ${depth} envelopes`;
            const token: string = `listleak${depth}`;

            const stored: unknown = storeConfig({
              components: shape([
                wrapped(
                  dataSourceWidget(
                    DashboardComponentType.DataSourceValue,
                    token,
                  ),
                  repeated(["envelope"], depth),
                  "DashboardComponent",
                ),
                textWidget(),
              ]) as JSONObject,
            });

            expect([label, servedJSON(stored).includes(token)]).toEqual([
              label,
              false,
            ]);

            const reading: Reading = readingOf(repeated(["envelope"], depth));

            expect([label, typesDrawn(pageDraws(stored))]).toEqual([
              label,
              isRead
                ? [
                    ...(reading === "a widget of no type" ? [""] : []),
                    DashboardComponentType.Text,
                  ]
                : [],
            ]);
            expect([
              label,
              PublicDashboardViewConfig.getDrawnConfig(stored),
            ]).toEqual([label, pageDraws(stored)]);
          }
        }
      },
    );
  });

  /*
   * Shapes that sent a Data Source widget's query - or a widget's settings
   * the page never draws - to visitors at any depth, because the
   * sanitizer passed on what it did not read.
   */
  describe("what no board draws as a widget is never served", () => {
    const TOKEN: string = "neverserved";

    const DATA_SOURCE: () => JSONObject = (): JSONObject => {
      return dataSourceWidget(DashboardComponentType.DataSourceChart, TOKEN);
    };

    const SHAPES: Array<[string, () => Array<unknown>, Array<string>]> = [
      [
        "a Data Source widget written as JSON text twice",
        (): Array<unknown> => {
          return [JSON.stringify(JSON.stringify(DATA_SOURCE()))];
        },
        [],
      ],
      [
        "an envelope whose value is JSON text twice",
        (): Array<unknown> => {
          return [
            {
              _type: "DashboardComponent",
              value: JSON.stringify(JSON.stringify(DATA_SOURCE())),
            },
          ];
        },
        [""],
      ],
      [
        "an envelope whose value is JSON text cut short",
        (): Array<unknown> => {
          return [
            {
              _type: "DashboardComponent",
              value: JSON.stringify(DATA_SOURCE()).slice(0, -2),
            },
          ];
        },
        [""],
      ],
      [
        "a list entry holding a Data Source widget",
        (): Array<unknown> => {
          return [[DATA_SOURCE()]];
        },
        [],
      ],
      [
        "a widget's key no board reads, holding a Data Source widget",
        (): Array<unknown> => {
          return [{ ...textWidget(), value: DATA_SOURCE() }];
        },
        [DashboardComponentType.Text],
      ],
      [
        "an envelope that also has a type, around a Data Source widget",
        (): Array<unknown> => {
          return [
            {
              _type: "DashboardComponent",
              componentType: DashboardComponentType.Text,
              value: DATA_SOURCE(),
            },
          ];
        },
        [DashboardComponentType.Text],
      ],
      [
        "a Data Source type spelt with spaces",
        (): Array<unknown> => {
          return [{ ...DATA_SOURCE(), componentType: " DataSourceChart " }];
        },
        [" DataSourceChart "],
      ],
      [
        "a Data Source type spelt in lower case",
        (): Array<unknown> => {
          return [{ ...DATA_SOURCE(), componentType: "datasourcechart" }];
        },
        ["datasourcechart"],
      ],
      [
        "a Data Source type written as an object",
        (): Array<unknown> => {
          return [
            {
              ...DATA_SOURCE(),
              componentType: { _type: "Name", value: "DataSourceChart" },
            },
          ];
        },
        [""],
      ],
      [
        "a widget of a removed type holding a query",
        (): Array<unknown> => {
          return [{ ...DATA_SOURCE(), componentType: "HostMetricChart" }];
        },
        ["HostMetricChart"],
      ],
    ];

    it.each(SHAPES)(
      "%s",
      (
        _name: string,
        entries: () => Array<unknown>,
        drawnTypes: Array<string>,
      ) => {
        const stored: JSONObject = {
          components: entries() as Array<JSONObject>,
          // Keys of the config no board reads.
          value: { components: [DATA_SOURCE()] },
          backup: DATA_SOURCE(),
        };

        expect(JSON.stringify(stored)).toContain(TOKEN);
        expect(servedJSON(stored)).not.toContain(TOKEN);

        // The page draws them as every board does.
        expect(typesDrawn(pageDraws(stored))).toEqual(drawnTypes);
        expect(typesDrawn(StoredDashboardViewConfig.read(stored))).toEqual(
          drawnTypes,
        );
        expect(PublicDashboardViewConfig.getDrawnConfig(stored)).toEqual(
          pageDraws(stored),
        );
      },
    );
  });

  describe("getServedComponent: one widget, as the page reads it", () => {
    const EDITOR_WIDGET: () => JSONObject = (): JSONObject => {
      return {
        _type: "DashboardComponent",
        componentId: {
          _type: "ObjectID",
          value: "0f8fad5b-d9cb-469f-a165-70867728950e",
        },
        componentType: DashboardComponentType.Value,
        topInDashboardUnits: 2,
        leftInDashboardUnits: 3,
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 2,
        minWidthInDashboardUnits: 2,
        minHeightInDashboardUnits: 1,
        arguments: {
          title: "Uptime",
          metricQueryConfig: {
            metricQueryData: {
              filterData: {
                telemetryServiceIds: [
                  {
                    _type: "ObjectID",
                    value: "7c9e6679-7425-40de-944b-e07fc1f90ae7",
                  },
                ],
              },
            },
          },
        },
      };
    };

    it("is its id as text, its type, its place and its settings as stored, as the editor saves them", () => {
      const stored: JSONObject = EDITOR_WIDGET();

      expect(PublicDashboardViewConfig.getServedComponent(stored)).toEqual({
        _type: ObjectType.DashboardComponent,
        componentId: "0f8fad5b-d9cb-469f-a165-70867728950e",
        componentType: DashboardComponentType.Value,
        topInDashboardUnits: 2,
        leftInDashboardUnits: 3,
        widthInDashboardUnits: 4,
        heightInDashboardUnits: 2,
        minWidthInDashboardUnits: 2,
        minHeightInDashboardUnits: 1,
        arguments: stored["arguments"],
      });
    });

    it.each([
      ["an id with spaces around it", " 0f8fad5b ", "0f8fad5b"],
      ["a numeric id", 42, "42"],
      ["an ObjectID's JSON without its _type", { value: "abc" }, "abc"],
    ])(
      "reads %s as the id every board draws it under",
      (_name: string, componentId: unknown, servedId: string) => {
        expect(
          PublicDashboardViewConfig.getServedComponent({
            ...EDITOR_WIDGET(),
            componentId: componentId as JSONObject,
          })["componentId"],
        ).toBe(servedId);
      },
    );

    it.each([
      ["no id", undefined],
      ["an empty id", "  "],
      ["an id that is an object", { nested: { query: "SELECT secret" } }],
      ["an id that is a list", ["abc"]],
    ])(
      "serves no id for %s, so the page derives one",
      (_name: string, componentId: unknown) => {
        const served: JSONObject = PublicDashboardViewConfig.getServedComponent(
          {
            ...EDITOR_WIDGET(),
            componentId: componentId as JSONObject,
          },
        );

        expect(Object.keys(served)).not.toContain("componentId");
        expect(JSON.stringify(served)).not.toContain("SELECT secret");
      },
    );

    it("reads its place as numbers, and a place it cannot read as the fallback", () => {
      expect(
        PublicDashboardViewConfig.getServedComponent({
          componentType: DashboardComponentType.Text,
          topInDashboardUnits: "3",
          leftInDashboardUnits: { query: "SELECT secret" },
          widthInDashboardUnits: "wide",
          heightInDashboardUnits: null,
          minWidthInDashboardUnits: "2",
        }),
      ).toEqual({
        _type: ObjectType.DashboardComponent,
        componentType: DashboardComponentType.Text,
        topInDashboardUnits: 3,
        leftInDashboardUnits: 0,
        widthInDashboardUnits: 6,
        heightInDashboardUnits: 4,
        minWidthInDashboardUnits: 2,
        minHeightInDashboardUnits: 1,
      });
    });

    it("reads settings written as JSON text as the object they say, and text that says no object as none", () => {
      const settings: JSONObject = { text: "Hello" };

      expect(
        PublicDashboardViewConfig.getServedComponent({
          componentType: DashboardComponentType.Text,
          arguments: JSON.stringify(settings),
        })["arguments"],
      ).toEqual(settings);

      for (const unreadable of [
        JSON.stringify(JSON.stringify(settings)),
        JSON.stringify([settings]),
        JSON.stringify(settings).slice(0, -1),
        [settings],
        7,
        null,
      ]) {
        expect(
          Object.keys(
            PublicDashboardViewConfig.getServedComponent({
              componentType: DashboardComponentType.Text,
              arguments: unreadable as unknown as JSONObject,
            }),
          ),
        ).not.toContain("arguments");
      }
    });

    it("keeps no settings for a type the page cannot draw, and no key no board reads", () => {
      for (const componentType of ["HostMetricChart", " Text ", "text", ""]) {
        const served: JSONObject = PublicDashboardViewConfig.getServedComponent(
          {
            ...EDITOR_WIDGET(),
            componentType: componentType,
            extra: "SELECT secret",
          },
        );

        expect([componentType, Object.keys(served).sort()]).toEqual([
          componentType,
          [
            "_type",
            "componentId",
            "componentType",
            "heightInDashboardUnits",
            "leftInDashboardUnits",
            "minHeightInDashboardUnits",
            "minWidthInDashboardUnits",
            "topInDashboardUnits",
            "widthInDashboardUnits",
          ],
        ]);
        expect(served["componentType"]).toBe(componentType);
      }
    });

    it("serves every type the page draws the settings its type is served, and is read back as the widget every board reads with them", () => {
      // The Data Source types never get here: sanitize leaves them out first.
      for (const componentType of Object.values(DashboardComponentType).filter(
        (componentType: DashboardComponentType): boolean => {
          return !DataSourceComponentTypes.includes(componentType);
        },
      )) {
        const decision: PublicDashboardWidgetSettings =
          PUBLIC_DASHBOARD_WIDGET_SETTINGS[
            componentType as PublicDashboardServedWidgetType
          ];
        const servedKeys: Array<string> = [
          ...decision.served,
          ...Object.keys(decision.servedWhileOn || {}),
        ];

        // Every setting it has, each holding a typed value, and two it has not.
        const settings: JSONObject = {};

        for (const key of [...servedKeys, ...decision.withheld]) {
          settings[key] = (EDITOR_WIDGET()["arguments"] as JSONObject)[
            "metricQueryConfig"
          ]!;
        }

        // Scripts on, so the HTML widget is served its script too.
        settings["allowScripts"] = true;
        settings["extra"] = "not served";
        settings["queryConfigs"] = [{ query: "SELECT secret" }];

        const stored: JSONObject = {
          ...EDITOR_WIDGET(),
          componentType: componentType,
          extra: "not served",
          arguments: settings,
        };
        const served: JSONObject =
          PublicDashboardViewConfig.getServedComponent(stored);

        const expectedSettings: JSONObject = {};

        for (const key of servedKeys) {
          expectedSettings[key] = settings[key]!;
        }

        expect([componentType, served["arguments"]]).toEqual([
          componentType,
          expectedSettings,
        ]);

        /*
         * Sent as JSON and read, it is the widget a board reads off the
         * store with the settings its type is served.
         */
        const [readBack] = StoredDashboardViewConfig.read({
          components: [JSON.parse(JSON.stringify(served))],
        }).components;
        const [readStored] = StoredDashboardViewConfig.read({
          components: [{ ...stored, arguments: expectedSettings }],
        }).components;

        expect([componentType, { ...readBack }]).toEqual([
          componentType,
          { ...readStored, extra: undefined },
        ]);
      }
    });
  });

  /*
   * PROPERTY: WHAT IS SERVED IS WHAT THE PAGE DRAWS, AND NOTHING OF A DATA
   * SOURCE WIDGET.
   *
   * Seeded configs of several entries: Data Source widgets, widgets of the
   * types the page draws, widgets the public page says it cannot draw (a
   * log chart, a trace chart or table, a security events widget), widgets
   * of types no board draws, and junk - each stored in random layers of
   * envelope and JSON text, now and then deeper than any board reads, with
   * an id of its own, none, one an earlier widget has, or one with spaces
   * around it, and its place written as text now and then. The widget list
   * is a list, JSON text or keyed by index; the config an object, JSON text
   * or in its envelope, with keys no board reads that hold Data Source
   * widgets, and variables. Every secret a Data Source widget, a widget the
   * page cannot draw, a setting its type does not have (issue #6338), a
   * junk entry or a key no board reads holds carries a token of its own.
   *
   * What the page draws is worked out from what was generated alone, and
   * checked against what it draws of what is served - which the public
   * routes read too - and against what a signed-in board draws.
   */
  describe("property: what is served is what the page draws, and nothing of a Data Source widget", () => {
    const DRAWN_TYPES: Array<DashboardComponentType> = [
      DashboardComponentType.Text,
      DashboardComponentType.Chart,
      DashboardComponentType.Value,
      DashboardComponentType.Gauge,
      DashboardComponentType.Table,
      DashboardComponentType.Clock,
      DashboardComponentType.IncidentList,
      DashboardComponentType.MonitorList,
      DashboardComponentType.Slo,
      DashboardComponentType.LogStream,
    ];

    /*
     * For each type the page draws: a setting of its own to carry a marker
     * that must be served, and one to carry a typed value that is served
     * as stored and revived by the page (issue #6338: a key a type does not
     * have is served no more, so the marker sits in one it has).
     */
    const DRAWN_SETTINGS: Record<string, [string, string]> = {
      [DashboardComponentType.Text]: ["text", "isMarkdown"],
      [DashboardComponentType.Chart]: ["chartTitle", "metricQueryConfigs"],
      [DashboardComponentType.Value]: ["title", "metricQueryConfig"],
      [DashboardComponentType.Gauge]: ["gaugeTitle", "metricQueryConfig"],
      [DashboardComponentType.Table]: ["tableTitle", "columns"],
      [DashboardComponentType.Clock]: ["label", "timezone"],
      [DashboardComponentType.IncidentList]: ["title", "stateFilter"],
      [DashboardComponentType.MonitorList]: ["title", "statusFilter"],
      [DashboardComponentType.Slo]: ["widgetTitle", "sloMetric"],
      [DashboardComponentType.LogStream]: ["title", "bodyContains"],
    };

    const UNDRAWN_TYPES: Array<string> = [
      "HostMetricChart",
      " Chart ",
      "chart",
      "datasourcetable",
      "SomeWidgetTypeFromTheFuture",
    ];

    /*
     * The settings a widget the public page cannot draw reads its data
     * with, by type: none of them is served, only its title (issue #6338).
     */
    const PLACEHOLDER_SECRETS: Record<string, Array<string>> = {
      [DashboardComponentType.LogChart]: [
        "bodyContains",
        "attributeFilterQuery",
      ],
      [DashboardComponentType.TraceChart]: [
        "spanNameContains",
        "groupByAttribute",
      ],
      [DashboardComponentType.TraceTable]: [
        "spanNameContains",
        "groupByAttribute",
      ],
      [DashboardComponentType.SecurityEventsList]: ["messageContains"],
      [DashboardComponentType.SecurityEventsFlow]: ["severityFilters"],
    };

    interface ExpectedWidget {
      ownId: string | null;
      componentType: string;
      layout: JSONObject;
      settings: unknown;
    }

    interface Generated {
      stored: unknown;
      // Secrets that must never be served.
      tokens: Array<string>;
      // Text every drawn widget's settings hold, which must be served.
      markers: Array<string>;
      // What the page draws, in order.
      expected: Array<ExpectedWidget>;
      // The types a signed-in board draws, in order.
      signedInTypes: Array<string>;
      // How many entries the widget list holds, junk included.
      entryCount: number;
    }

    const FALLBACK_LAYOUT: JSONObject = {
      topInDashboardUnits: 0,
      leftInDashboardUnits: 0,
      widthInDashboardUnits: 6,
      heightInDashboardUnits: 4,
      minWidthInDashboardUnits: 1,
      minHeightInDashboardUnits: 1,
    };

    const randomLayers: (random: SeededRandom) => Array<Layer> = (
      random: SeededRandom,
    ): Array<Layer> => {
      if (random(2) === 0) {
        return [];
      }

      const depth: number = 1 + random(10);
      const layers: Array<Layer> = [];
      let textLayers: number = 0;

      for (let step: number = 0; step < depth; step++) {
        if (textLayers < 5 && random(3) === 0) {
          layers.push("text");
          textLayers++;
        } else {
          layers.push("envelope");
        }
      }

      return layers;
    };

    const generate: (random: SeededRandom, name: string) => Generated = (
      random: SeededRandom,
      name: string,
    ): Generated => {
      const tokens: Array<string> = [];
      const markers: Array<string> = [];
      const expected: Array<ExpectedWidget> = [];
      const signedInTypes: Array<string> = [];
      const ownIds: Array<string> = [];
      const entries: Array<unknown> = [];

      const count: number = 1 + random(9);

      for (let index: number = 0; index < count; index++) {
        const token: string = `secret${name}x${index}`;
        const roll: number = random(10);

        if (roll === 0) {
          // Junk, now and then holding a Data Source widget no board reads.
          const junk: Array<unknown> = [
            null,
            7,
            "not a widget",
            [dataSourceWidget(DashboardComponentType.DataSourceTable, token)],
            JSON.stringify(
              JSON.stringify(
                dataSourceWidget(DashboardComponentType.DataSourceGauge, token),
              ),
            ),
          ];

          entries.push(junk[random(junk.length)]);
          tokens.push(token);
          continue;
        }

        // Its id: its own, none, an earlier one, or its own with spaces.
        const idRoll: number = random(10);
        let storedId: unknown = undefined;
        let ownId: string | null = null;

        if (idRoll < 6) {
          ownId = ObjectID.generate().toString();
          storedId = ownId;
        } else if (idRoll < 8 && ownIds.length > 0) {
          ownId = ownIds[random(ownIds.length)]!;
          storedId = ownId;
        } else if (idRoll === 8) {
          ownId = ObjectID.generate().toString();
          storedId = `  ${ownId} `;
        }

        if (ownId) {
          ownIds.push(ownId);
        }

        const top: number = random(20);
        const width: number = 1 + random(12);
        const layout: JSONObject = {
          topInDashboardUnits: random(4) === 0 ? String(top) : top,
          leftInDashboardUnits: random(12),
          widthInDashboardUnits: width,
          heightInDashboardUnits: 1 + random(8),
        };
        const readLayout: JSONObject = {
          ...FALLBACK_LAYOUT,
          ...layout,
          topInDashboardUnits: top,
        };

        let widget: JSONObject;
        let componentType: string;
        let isDataSource: boolean = false;
        let isDrawnType: boolean = false;
        let settings: JSONObject = {};

        if (roll < 4) {
          componentType =
            DataSourceComponentTypes[random(DataSourceComponentTypes.length)]!;
          widget = dataSourceWidget(componentType, token);
          isDataSource = true;
          tokens.push(token);
        } else if (roll < 8) {
          componentType = DRAWN_TYPES[random(DRAWN_TYPES.length)]!;
          const marker: string = `public${name}x${index}`;
          const [markerKey, typedKey] = DRAWN_SETTINGS[componentType]!;

          settings = {
            [markerKey]: marker,
            ...(random(2) === 0
              ? {
                  [typedKey]: [
                    {
                      _type: "ObjectID",
                      value: ObjectID.generate().toString(),
                    },
                  ],
                }
              : {}),
          };

          /*
           * Now and then a setting its type does not have - one a script
           * left there - holding a secret: never served (issue #6338).
           */
          const stored: JSONObject = { ...settings };

          if (random(3) === 0) {
            const settingToken: string = `${token}setting`;

            stored["serviceIds"] = [{ query: `SELECT ${settingToken}` }];
            tokens.push(settingToken);
          }

          widget = {
            componentType: componentType,
            arguments: random(4) === 0 ? JSON.stringify(stored) : stored,
          };
          isDrawnType = true;
          markers.push(marker);

          // Now and then a key no board reads, holding a Data Source widget.
          if (random(3) === 0) {
            widget["value"] = dataSourceWidget(
              DashboardComponentType.DataSourceChart,
              token,
            );
            tokens.push(token);
          }
        } else if (roll === 8) {
          /*
           * A widget the public page says it cannot draw: served its title,
           * which the page draws above its note, and none of the search
           * text and filters it reads its data with (issue #6338).
           */
          componentType =
            PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES[
              random(PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES.length)
            ]!;
          const marker: string = `public${name}x${index}`;
          const stored: JSONObject = { title: marker };

          for (const key of PLACEHOLDER_SECRETS[componentType]!) {
            stored[key] = `internal ${token} ${key}`;
          }

          stored["attributeFilters"] = { "url.host": `${token}.internal` };
          settings = { title: marker };
          widget = {
            componentType: componentType,
            arguments: random(4) === 0 ? JSON.stringify(stored) : stored,
          };
          isDrawnType = true;
          markers.push(marker);
          tokens.push(token);
        } else {
          componentType = UNDRAWN_TYPES[random(UNDRAWN_TYPES.length)]!;
          widget = {
            componentType: componentType,
            arguments: { query: `SELECT secret FROM internal_${token}` },
          };
          tokens.push(token);
        }

        const layers: Array<Layer> = randomLayers(random);
        const reading: Reading = readingOf(layers);

        entries.push(
          wrapped(
            {
              ...(storedId === undefined
                ? {}
                : { componentId: storedId as JSONObject }),
              ...layout,
              ...widget,
            },
            layers,
            "DashboardComponent",
          ),
        );

        if (reading === "no widget") {
          continue;
        }

        if (reading === "a widget of no type") {
          signedInTypes.push("");
          expected.push({
            ownId: null,
            componentType: "",
            layout: FALLBACK_LAYOUT,
            settings: {},
          });
          continue;
        }

        signedInTypes.push(componentType);

        if (isDataSource) {
          continue;
        }

        expected.push({
          ownId: ownId,
          componentType: componentType,
          layout: readLayout,
          settings: isDrawnType ? settings : {},
        });
      }

      // The list, and the config around it.
      const listRoll: number = random(5);
      const keyedList: JSONObject = {};

      entries.forEach((entry: unknown, index: number) => {
        keyedList[String(index)] = entry as JSONObject;
      });

      const backupToken: string = `secret${name}xbackup`;

      const config: JSONObject = {
        heightInDashboardUnits: 24,
        components: (listRoll < 3
          ? entries
          : listRoll === 3
            ? JSON.stringify(entries)
            : keyedList) as JSONObject,
        ...(random(2) === 0
          ? {
              variables: [
                {
                  id: "cluster",
                  name: "cluster",
                  type: DashboardVariableType.TelemetryAttribute,
                  attributeKey: "k8s.cluster.name",
                },
              ],
            }
          : {}),
        // Keys no board reads.
        backup: [
          dataSourceWidget(DashboardComponentType.DataSourceChart, backupToken),
        ],
      };

      tokens.push(backupToken);

      const configRoll: number = random(4);
      const stored: unknown =
        configRoll === 0
          ? config
          : configRoll === 1
            ? JSON.stringify(config)
            : configRoll === 2
              ? { _type: "DashboardViewConfig", value: config }
              : JSON.stringify({ _type: "DashboardViewConfig", value: config });

      return {
        stored: stored,
        tokens: tokens,
        markers: markers,
        expected: expected,
        signedInTypes: signedInTypes,
        entryCount: entries.length,
      };
    };

    // The ids the page draws the expected widgets under (getComponentIds).
    const expectedIds: (expected: Array<ExpectedWidget>) => Array<string> = (
      expected: Array<ExpectedWidget>,
    ): Array<string> => {
      const held: Set<string> = new Set<string>();

      for (const widget of expected) {
        if (widget.ownId) {
          held.add(widget.ownId);
        }
      }

      const claimed: Set<string> = new Set<string>();
      let sequence: number = 0;

      return expected.map((widget: ExpectedWidget): string => {
        if (widget.ownId && !claimed.has(widget.ownId)) {
          claimed.add(widget.ownId);
          return widget.ownId;
        }

        let id: string = "";

        do {
          sequence++;
          id = derivedId(sequence);
        } while (held.has(id) || claimed.has(id));

        claimed.add(id);

        return id;
      });
    };

    const SEEDS: Array<number> = [
      6327, 1, 2, 3, 42, 99, 1234, 2718, 31415, 65535, 99991, 271828,
    ];

    const RUNS_PER_SEED: number = 30;

    it("reaches every case: deep widgets, junk, Data Source widgets every board reads, derived and repeated ids", () => {
      const seen: Record<string, number> = {
        "a widget of no type": 0,
        "a Data Source widget the board draws": 0,
        "a widget of a type the page cannot draw": 0,
        "a widget the public page says it cannot draw": 0,
        "a widget drawn with its settings": 0,
        "an id derived": 0,
        "an id an earlier widget holds": 0,
        "an entry no widget is read from": 0,
      };

      for (const seed of SEEDS) {
        const random: SeededRandom = seededRandom(seed);

        for (let run: number = 0; run < RUNS_PER_SEED; run++) {
          const generated: Generated = generate(random, `${seed}r${run}`);
          const ownIds: Array<string> = [];

          for (const widget of generated.expected) {
            if (widget.componentType === "") {
              seen["a widget of no type"]!++;
            } else if (
              (PUBLIC_DASHBOARD_UNDRAWN_WIDGET_TYPES as Array<string>).includes(
                widget.componentType,
              )
            ) {
              seen["a widget the public page says it cannot draw"]!++;
            } else if (
              !(DRAWN_TYPES as Array<string>).includes(widget.componentType)
            ) {
              seen["a widget of a type the page cannot draw"]!++;
            } else {
              seen["a widget drawn with its settings"]!++;
            }

            if (!widget.ownId) {
              seen["an id derived"]!++;
            } else if (ownIds.includes(widget.ownId)) {
              seen["an id an earlier widget holds"]!++;
            }

            if (widget.ownId) {
              ownIds.push(widget.ownId);
            }
          }

          seen["a Data Source widget the board draws"]! +=
            generated.signedInTypes.filter((componentType: string): boolean => {
              return (DataSourceComponentTypes as Array<string>).includes(
                componentType,
              );
            }).length;
          seen["an entry no widget is read from"]! += Math.max(
            0,
            generated.entryCount - generated.signedInTypes.length,
          );
        }
      }

      for (const [name, count] of Object.entries(seen)) {
        expect([name, count >= 10]).toEqual([name, true]);
      }
    });

    it.each(SEEDS)("seed %i", (seed: number) => {
      const random: SeededRandom = seededRandom(seed);

      for (let run: number = 0; run < RUNS_PER_SEED; run++) {
        const generated: Generated = generate(random, `${seed}r${run}`);
        const label: string = `seed ${seed}, config ${run}`;
        const json: string = servedJSON(generated.stored);

        // Nothing of a Data Source widget, or of anything the page does not draw.
        for (const token of generated.tokens) {
          expect([label, token, json.includes(token)]).toEqual([
            label,
            token,
            false,
          ]);
        }

        // ...and everything of the widgets it draws.
        for (const marker of generated.markers) {
          const isDrawn: boolean = generated.expected.some(
            (widget: ExpectedWidget): boolean => {
              return JSON.stringify(widget.settings).includes(`"${marker}"`);
            },
          );

          expect([label, marker, json.includes(marker)]).toEqual([
            label,
            marker,
            isDrawn,
          ]);
        }

        // The served config has only what a board reads.
        const served: JSONObject = JSON.parse(json) as JSONObject;

        for (const key of Object.keys(served)) {
          expect([label, key]).toEqual([
            label,
            expect.stringMatching(
              /^(_type|components|heightInDashboardUnits|timeRange|refreshInterval|variables)$/,
            ),
          ]);
        }

        // The public routes read exactly what the page draws.
        const drawn: DashboardViewConfig = pageDraws(generated.stored);

        expect([
          label,
          PublicDashboardViewConfig.getDrawnConfig(generated.stored),
        ]).toEqual([label, drawn]);

        // The page draws what was generated, as worked out above.
        const ids: Array<string> = expectedIds(generated.expected);

        expect([
          label,
          drawn.components.map((component: DashboardBaseComponent) => {
            return {
              id: component.componentId.toString(),
              componentType: component.componentType,
              layout: {
                topInDashboardUnits: component.topInDashboardUnits,
                leftInDashboardUnits: component.leftInDashboardUnits,
                widthInDashboardUnits: component.widthInDashboardUnits,
                heightInDashboardUnits: component.heightInDashboardUnits,
                minWidthInDashboardUnits: component.minWidthInDashboardUnits,
                minHeightInDashboardUnits: component.minHeightInDashboardUnits,
              },
              settings: settingsJSON(component),
            };
          }),
        ]).toEqual([
          label,
          generated.expected.map((widget: ExpectedWidget, index: number) => {
            return {
              id: ids[index],
              componentType: widget.componentType,
              layout: widget.layout,
              settings: widget.settings,
            };
          }),
        ]);

        // And a signed-in board draws the same, with the Data Source widgets.
        expect([
          label,
          typesDrawn(StoredDashboardViewConfig.read(generated.stored)),
        ]).toEqual([label, generated.signedInTypes]);
      }
    });
  });
});
