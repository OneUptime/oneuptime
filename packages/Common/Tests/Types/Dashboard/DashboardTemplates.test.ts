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
import { ObjectType } from "../../../Types/JSON";
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
});
