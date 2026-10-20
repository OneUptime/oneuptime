import {
  DashboardTemplate,
  DashboardTemplateCategories,
  DashboardTemplateCategory,
  DashboardTemplateType,
  DashboardTemplates,
  getDashboardTemplatesByCategory,
  getTemplateConfig,
} from "../../../Types/Dashboard/DashboardTemplates";
import DashboardViewConfig from "../../../Types/Dashboard/DashboardViewConfig";
import DashboardBaseComponent from "../../../Types/Dashboard/DashboardComponents/DashboardBaseComponent";
import AlertMetricType from "../../../Types/Alerts/AlertMetricType";
import IncidentMetricType from "../../../Types/Incident/IncidentMetricType";
import { JSONObject, ObjectType } from "../../../Types/JSON";
import { describe, expect, test } from "@jest/globals";

describe("DashboardTemplates", () => {
  test("exposes a non-empty template list", () => {
    expect(Array.isArray(DashboardTemplates)).toBe(true);
    expect(DashboardTemplates.length).toBeGreaterThan(0);
  });

  test("every template has all required non-empty fields", () => {
    for (const template of DashboardTemplates) {
      expect(template.name.length).toBeGreaterThan(0);
      expect(template.description.length).toBeGreaterThan(0);
      expect(template.icon.length).toBeGreaterThan(0);
      expect(Object.values(DashboardTemplateType).includes(template.type)).toBe(
        true,
      );
      expect(
        Object.values(DashboardTemplateCategory).includes(template.category),
      ).toBe(true);
    }
  });

  test("template types are unique", () => {
    const types: Array<DashboardTemplateType> = DashboardTemplates.map(
      (t: DashboardTemplate) => {
        return t.type;
      },
    );
    expect(new Set(types).size).toBe(types.length);
  });

  test("every template category is one of the declared categories", () => {
    for (const template of DashboardTemplates) {
      expect(DashboardTemplateCategories).toContain(template.category);
    }
  });

  test("declared categories are unique", () => {
    expect(new Set(DashboardTemplateCategories).size).toBe(
      DashboardTemplateCategories.length,
    );
  });

  describe("getDashboardTemplatesByCategory", () => {
    test("returns only templates of the requested category", () => {
      for (const category of DashboardTemplateCategories) {
        for (const template of getDashboardTemplatesByCategory(category)) {
          expect(template.category).toBe(category);
        }
      }
    });

    test("every declared category has at least one template", () => {
      for (const category of DashboardTemplateCategories) {
        expect(
          getDashboardTemplatesByCategory(category).length,
        ).toBeGreaterThan(0);
      }
    });

    test("categories partition the full template list", () => {
      const totalByCategory: number = DashboardTemplateCategories.reduce(
        (sum: number, category: DashboardTemplateCategory) => {
          return sum + getDashboardTemplatesByCategory(category).length;
        },
        0,
      );
      expect(totalByCategory).toBe(DashboardTemplates.length);
    });
  });

  describe("getTemplateConfig", () => {
    test("returns null for the Blank template", () => {
      expect(getTemplateConfig(DashboardTemplateType.Blank)).toBeNull();
    });

    test("returns a well-formed config for every non-Blank type", () => {
      for (const type of Object.values(DashboardTemplateType)) {
        if (type === DashboardTemplateType.Blank) {
          continue;
        }
        const config: DashboardViewConfig | null = getTemplateConfig(type);
        expect(config).not.toBeNull();
        expect(config!._type).toBe(ObjectType.DashboardViewConfig);
        expect(Array.isArray(config!.components)).toBe(true);
        expect(config!.components.length).toBeGreaterThan(0);
        expect(typeof config!.heightInDashboardUnits).toBe("number");
        expect(config!.heightInDashboardUnits).toBeGreaterThan(0);
      }
    });

    test("handles every enum value without throwing", () => {
      for (const type of Object.values(DashboardTemplateType)) {
        expect(() => {
          return getTemplateConfig(type);
        }).not.toThrow();
      }
    });
  });

  /*
   * "MTTR and MTTA Over Time" used to plot time to resolve alone. Each series
   * is the metric it reads and the legend it is drawn under.
   */
  describe.each([
    {
      type: DashboardTemplateType.Incident,
      timeToResolve: IncidentMetricType.TimeToResolve as string,
      timeToAcknowledge: IncidentMetricType.TimeToAcknowledge as string,
    },
    {
      type: DashboardTemplateType.Alert,
      timeToResolve: AlertMetricType.TimeToResolve as string,
      timeToAcknowledge: AlertMetricType.TimeToAcknowledge as string,
    },
  ])(
    "the $type template's MTTR and MTTA Over Time chart",
    (entry: {
      type: DashboardTemplateType;
      timeToResolve: string;
      timeToAcknowledge: string;
    }) => {
      test("plots both, as its title says", () => {
        const chart: DashboardBaseComponent | undefined = getTemplateConfig(
          entry.type,
        )!.components.find((component: DashboardBaseComponent): boolean => {
          return (
            (component.arguments as JSONObject)["chartTitle"] ===
            "MTTR and MTTA Over Time"
          );
        });

        expect(chart).toBeDefined();

        const args: JSONObject = chart!.arguments as JSONObject;
        const queries: Array<JSONObject> = [
          args["metricQueryConfig"] as JSONObject,
          ...((args["metricQueryConfigs"] as Array<JSONObject>) || []),
        ];

        expect(
          queries.map((query: JSONObject) => {
            const data: JSONObject = query["metricQueryData"] as JSONObject;
            const alias: JSONObject = query["metricAliasData"] as JSONObject;

            return {
              metricName: (data["filterData"] as JSONObject)["metricName"],
              legend: alias["legend"],
              variable: alias["metricVariable"],
            };
          }),
        ).toEqual([
          { metricName: entry.timeToResolve, legend: "MTTR", variable: "a" },
          {
            metricName: entry.timeToAcknowledge,
            legend: "MTTA",
            variable: "b",
          },
        ]);
      });
    },
  );
});
