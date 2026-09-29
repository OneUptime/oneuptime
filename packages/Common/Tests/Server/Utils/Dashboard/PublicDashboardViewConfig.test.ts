import { describe, expect, it } from "@jest/globals";
import PublicDashboardViewConfig from "../../../../Server/Utils/Dashboard/PublicDashboardViewConfig";
import DashboardComponentType, {
  DataSourceComponentTypes,
} from "../../../../Types/Dashboard/DashboardComponentType";
import DashboardBaseComponent from "../../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import DashboardViewConfig, {
  AutoRefreshInterval,
} from "../../../../Types/Dashboard/DashboardViewConfig";
import { JSONObject, ObjectType } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

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
  });
});
