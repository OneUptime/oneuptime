import { describe, expect, test } from "@jest/globals";
import {
  WIDGET_CATALOG,
  WidgetCatalogCategory,
  WidgetCatalogItem,
  WidgetCategoryGroup,
  WidgetCategoryGroupSection,
  countWidgets,
  getFirstWidget,
  groupWidgetCategories,
  searchWidgetCatalog,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import DashboardComponentType, {
  DataSourceComponentTypes,
  isDataSourceComponentType,
} from "../../../Types/Dashboard/DashboardComponentType";

/*
 * External Data Source widgets used to be a hidden mode of the metric widgets:
 * you added a "Chart", then discovered a toggle that swapped its metrics query
 * for a Prometheus/SQL/Loki one. Nobody found it. They are now four first-class
 * component types with their own picker category, so the choice between "chart
 * of OneUptime telemetry" and "chart of a system we do not own" is made up
 * front, where it is visible.
 *
 * That only pays off if the picker keeps its half of the bargain, which is what
 * this file pins down: the category exists and holds exactly the data-source
 * types (driven off isDataSourceComponentType, so a fifth one cannot be added
 * to the enum and quietly left out of the picker), the metric widgets stay put
 * rather than drifting back into one pile, and someone who types the name of
 * their own system — "prometheus", "clickhouse", "loki" — lands on these
 * widgets and not on the metric ones. The category copy also has to keep
 * carrying the public-dashboard restriction, because the picker is the last
 * place a user sees it before building a dashboard they intend to share.
 */

type GetCategoryFunction = (name: string) => WidgetCatalogCategory;

const getCategory: GetCategoryFunction = (
  name: string,
): WidgetCatalogCategory => {
  const category: WidgetCatalogCategory | undefined = WIDGET_CATALOG.find(
    (candidate: WidgetCatalogCategory) => {
      return candidate.name === name;
    },
  );

  if (!category) {
    throw new Error(`Category "${name}" is missing from the widget catalog.`);
  }

  return category;
};

type GetTypesInFunction = (name: string) => Array<DashboardComponentType>;

const getTypesIn: GetTypesInFunction = (
  name: string,
): Array<DashboardComponentType> => {
  return getCategory(name).items.map((item: WidgetCatalogItem) => {
    return item.type;
  });
};

type GetAllItemsFunction = (
  categories: ReadonlyArray<WidgetCatalogCategory>,
) => Array<WidgetCatalogItem>;

const getAllItems: GetAllItemsFunction = (
  categories: ReadonlyArray<WidgetCatalogCategory>,
): Array<WidgetCatalogItem> => {
  return categories.flatMap((category: WidgetCatalogCategory) => {
    return [...category.items];
  });
};

type GetMatchedTypesFunction = (
  searchTerm: string,
) => Array<DashboardComponentType>;

const getMatchedTypes: GetMatchedTypesFunction = (
  searchTerm: string,
): Array<DashboardComponentType> => {
  return getAllItems(searchWidgetCatalog(searchTerm)).map(
    (item: WidgetCatalogItem) => {
      return item.type;
    },
  );
};

type GetMatchedCategoryNamesFunction = (searchTerm: string) => Array<string>;

const getMatchedCategoryNames: GetMatchedCategoryNamesFunction = (
  searchTerm: string,
): Array<string> => {
  return searchWidgetCatalog(searchTerm).map(
    (category: WidgetCatalogCategory) => {
      return category.name;
    },
  );
};

const EXTERNAL_CATEGORY_NAME: string = "External Data Sources";

const ALL_COMPONENT_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

/*
 * Derived from the predicate rather than written out by hand: a new
 * DataSource* member of the enum has to show up here, and therefore in the
 * category, without anyone remembering to edit this test.
 */
const DATA_SOURCE_TYPES: Array<DashboardComponentType> =
  ALL_COMPONENT_TYPES.filter((componentType: DashboardComponentType) => {
    return isDataSourceComponentType(componentType);
  });

/*
 * Every search a user might reasonably type when they are looking for "the
 * widget that reads my Prometheus". Each has to reach the external category.
 */
const SYSTEM_SEARCH_TERMS: Array<string> = [
  "prometheus",
  "promql",
  "sql",
  "clickhouse",
  "loki",
  "elasticsearch",
  "rest api",
  "external",
];

describe("External Data Sources widget catalog category", () => {
  describe("category shape", () => {
    test("exists exactly once in the catalog", () => {
      const matching: Array<WidgetCatalogCategory> = WIDGET_CATALOG.filter(
        (category: WidgetCatalogCategory) => {
          return category.name === EXTERNAL_CATEGORY_NAME;
        },
      );

      expect(matching).toHaveLength(1);
    });

    test("sits in the General group, next to Essentials and Metrics", () => {
      expect(getCategory(EXTERNAL_CATEGORY_NAME).group).toBe(
        WidgetCategoryGroup.General,
      );
    });

    test("holds the four data-source widgets in chart, value, gauge, table order", () => {
      expect(getTypesIn(EXTERNAL_CATEGORY_NAME)).toEqual([
        DashboardComponentType.DataSourceChart,
        DashboardComponentType.DataSourceValue,
        DashboardComponentType.DataSourceGauge,
        DashboardComponentType.DataSourceTable,
      ]);
    });

    test("mirrors the visualization vocabulary of the Metrics category", () => {
      const labels: Array<string> = getCategory(
        EXTERNAL_CATEGORY_NAME,
      ).items.map((item: WidgetCatalogItem) => {
        return item.label;
      });

      expect(labels).toEqual(["Chart", "Value", "Gauge", "Table"]);
    });

    test("tells the user in the picker that public dashboards cannot use these", () => {
      const description: string = getCategory(
        EXTERNAL_CATEGORY_NAME,
      ).description.toLowerCase();

      expect(description).toContain("public dashboard");
      expect(description).toContain("not available");
    });

    test("names the supported systems in its description so the picker is self-explaining", () => {
      const description: string = getCategory(
        EXTERNAL_CATEGORY_NAME,
      ).description.toLowerCase();

      for (const system of [
        "prometheus",
        "postgresql",
        "mysql",
        "sql server",
        "clickhouse",
        "loki",
        "elasticsearch",
        "rest api",
      ]) {
        expect(description).toContain(system);
      }
    });

    test("appears after Metrics, so the built-in widgets are offered first", () => {
      const names: Array<string> = WIDGET_CATALOG.map(
        (category: WidgetCatalogCategory) => {
          return category.name;
        },
      );

      expect(names.indexOf(EXTERNAL_CATEGORY_NAME)).toBeGreaterThan(
        names.indexOf("Metrics"),
      );
    });
  });

  describe("data-source types are exactly this category", () => {
    test("isDataSourceComponentType agrees with DataSourceComponentTypes", () => {
      expect(DATA_SOURCE_TYPES).toEqual([...DataSourceComponentTypes]);
      expect(DATA_SOURCE_TYPES).toHaveLength(4);
    });

    test("every data-source type is listed in the External Data Sources category", () => {
      expect([...getTypesIn(EXTERNAL_CATEGORY_NAME)].sort()).toEqual(
        [...DATA_SOURCE_TYPES].sort(),
      );
    });

    test("no data-source type leaks into any other category", () => {
      for (const category of WIDGET_CATALOG) {
        if (category.name === EXTERNAL_CATEGORY_NAME) {
          continue;
        }

        for (const item of category.items) {
          expect(isDataSourceComponentType(item.type)).toBe(false);
        }
      }
    });

    test("no non-data-source widget hides inside the External Data Sources category", () => {
      for (const item of getCategory(EXTERNAL_CATEGORY_NAME).items) {
        expect(isDataSourceComponentType(item.type)).toBe(true);
      }
    });

    test("keeps the metrics-driven widgets in the Metrics category", () => {
      expect(getTypesIn("Metrics")).toEqual([
        DashboardComponentType.Chart,
        DashboardComponentType.Value,
        DashboardComponentType.Gauge,
        DashboardComponentType.Table,
      ]);
      expect(getCategory("Metrics").group).toBe(WidgetCategoryGroup.General);
    });
  });

  describe("group rendering", () => {
    test("lands in the General section alongside Essentials and Metrics", () => {
      const sections: Array<WidgetCategoryGroupSection> =
        groupWidgetCategories(WIDGET_CATALOG);

      const general: WidgetCategoryGroupSection | undefined = sections.find(
        (section: WidgetCategoryGroupSection) => {
          return section.group === WidgetCategoryGroup.General;
        },
      );

      expect(
        general?.categories.map((category: WidgetCatalogCategory) => {
          return category.name;
        }),
      ).toEqual(["Essentials", "Metrics", EXTERNAL_CATEGORY_NAME]);
    });

    test("collapses to a single General section when a search leaves only this category", () => {
      const sections: Array<WidgetCategoryGroupSection> = groupWidgetCategories(
        searchWidgetCatalog("prometheus"),
      );

      expect(sections).toHaveLength(1);
      expect(sections[0]?.group).toBe(WidgetCategoryGroup.General);
      expect(sections[0]?.categories).toHaveLength(1);
      expect(sections[0]?.categories[0]?.name).toBe(EXTERNAL_CATEGORY_NAME);
    });
  });

  describe("searching by the name of the system", () => {
    test.each(SYSTEM_SEARCH_TERMS)(
      '"%s" surfaces the External Data Sources category and nothing but external widgets',
      (searchTerm: string) => {
        expect(getMatchedCategoryNames(searchTerm)).toContain(
          EXTERNAL_CATEGORY_NAME,
        );

        const matched: Array<DashboardComponentType> =
          getMatchedTypes(searchTerm);

        expect(matched.length).toBeGreaterThan(0);

        for (const type of matched) {
          expect(isDataSourceComponentType(type)).toBe(true);
        }
      },
    );

    test("naming any supported system offers the whole set of four widgets", () => {
      for (const searchTerm of [
        "prometheus",
        "sql",
        "clickhouse",
        "loki",
        "elasticsearch",
        "rest api",
        "external",
      ]) {
        expect(getMatchedTypes(searchTerm)).toEqual(DATA_SOURCE_TYPES);
      }
    });

    test("a search is case-insensitive, so Prometheus and PROMETHEUS work too", () => {
      expect(getMatchedTypes("Prometheus")).toEqual(DATA_SOURCE_TYPES);
      expect(getMatchedTypes("PROMETHEUS")).toEqual(DATA_SOURCE_TYPES);
    });

    test('"promql" reaches the query-language widgets', () => {
      /*
       * The Table widget is deliberately not asserted here: its keyword list
       * omits "promql". See SOURCE NOTES in the review for that gap.
       */
      const matched: Array<DashboardComponentType> = getMatchedTypes("promql");

      expect(matched).toContain(DashboardComponentType.DataSourceChart);
      expect(matched).toContain(DashboardComponentType.DataSourceValue);
      expect(matched).toContain(DashboardComponentType.DataSourceGauge);
    });

    test('a plain "metric" search does not surface the external widgets', () => {
      const matched: Array<DashboardComponentType> = getMatchedTypes("metric");

      expect(matched).toEqual([
        DashboardComponentType.Chart,
        DashboardComponentType.Value,
        DashboardComponentType.Gauge,
        DashboardComponentType.Table,
      ]);
      expect(getMatchedCategoryNames("metric")).toEqual(["Metrics"]);
    });

    test("searching a system name that nobody supports returns nothing", () => {
      expect(searchWidgetCatalog("cassandra")).toEqual([]);
      expect(countWidgets(searchWidgetCatalog("cassandra"))).toBe(0);
      expect(getFirstWidget(searchWidgetCatalog("cassandra"))).toBeNull();
    });
  });

  describe("token-AND narrowing inside the category", () => {
    test('"external table" matches only the external Table widget', () => {
      expect(getMatchedTypes("external table")).toEqual([
        DashboardComponentType.DataSourceTable,
      ]);
    });

    test('"external gauge" and "external chart" narrow the same way', () => {
      expect(getMatchedTypes("external gauge")).toEqual([
        DashboardComponentType.DataSourceGauge,
      ]);
      expect(getMatchedTypes("external chart")).toEqual([
        DashboardComponentType.DataSourceChart,
      ]);
    });

    test('"prometheus kpi" reaches the Value widget only', () => {
      expect(getMatchedTypes("prometheus kpi")).toEqual([
        DashboardComponentType.DataSourceValue,
      ]);
    });

    test("a bare table search offers both tables, with the metric one first", () => {
      const matched: Array<DashboardComponentType> = getMatchedTypes("table");

      expect(matched).toContain(DashboardComponentType.Table);
      expect(matched).toContain(DashboardComponentType.DataSourceTable);
      expect(matched.indexOf(DashboardComponentType.Table)).toBeLessThan(
        matched.indexOf(DashboardComponentType.DataSourceTable),
      );
      expect(getMatchedCategoryNames("table")).toContain(
        EXTERNAL_CATEGORY_NAME,
      );
    });

    test('"data source" is ambiguous copy and also hits Essentials', () => {
      /*
       * Essentials is described as needing no data source, so both tokens are
       * in its haystack. Kept as a regression guard: if that copy is reworded
       * the search behaviour changes underneath the picker.
       */
      const names: Array<string> = getMatchedCategoryNames("data source");

      expect(names).toContain(EXTERNAL_CATEGORY_NAME);
      expect(names).toContain("Essentials");
    });

    test("an unmatched second token drops the category entirely", () => {
      expect(searchWidgetCatalog("prometheus kubernetes")).toEqual([]);
    });

    test("surrounding and repeated whitespace does not change the result", () => {
      expect(getMatchedTypes("   external    table \n")).toEqual([
        DashboardComponentType.DataSourceTable,
      ]);
    });
  });

  describe("counts and first match", () => {
    test("the picker offers every DashboardComponentType, external ones included", () => {
      expect(countWidgets(WIDGET_CATALOG)).toBe(ALL_COMPONENT_TYPES.length);
    });

    test("counts exactly the external widgets after an external-only search", () => {
      expect(countWidgets(searchWidgetCatalog("external"))).toBe(
        DATA_SOURCE_TYPES.length,
      );
    });

    test("counts nothing for an empty category list", () => {
      expect(countWidgets([])).toBe(0);
    });

    test("Enter on an external search adds the external Chart, not the metric one", () => {
      const first: WidgetCatalogItem | null = getFirstWidget(
        searchWidgetCatalog("prometheus"),
      );

      expect(first?.type).toBe(DashboardComponentType.DataSourceChart);
      expect(first?.label).toBe("Chart");
    });

    test("Enter on a plain chart search still adds the metrics Chart", () => {
      expect(getFirstWidget(searchWidgetCatalog("chart"))?.type).toBe(
        DashboardComponentType.Chart,
      );
    });
  });
});
