import { describe, expect, test } from "@jest/globals";
import {
  WIDGET_CATALOG,
  WIDGET_CATEGORY_GROUP_ORDER,
  WidgetCatalogCategory,
  WidgetCatalogItem,
  WidgetCategoryGroup,
  WidgetCategoryGroupSection,
  countWidgets,
  findCategoryByName,
  getFirstWidget,
  groupWidgetCategories,
  searchWidgetCatalog,
  tokenizeSearchTerm,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/WidgetCatalog";
import DashboardComponentType from "../../../Types/Dashboard/DashboardComponentType";

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

type GetMatchedTypesFunction = (searchTerm: string) => Array<string>;

const getMatchedTypes: GetMatchedTypesFunction = (
  searchTerm: string,
): Array<string> => {
  return getAllItems(searchWidgetCatalog(searchTerm)).map(
    (item: WidgetCatalogItem) => {
      return item.type.toString();
    },
  );
};

const ALL_COMPONENT_TYPES: Array<DashboardComponentType> = Object.values(
  DashboardComponentType,
);

describe("WidgetCatalog", () => {
  describe("catalog integrity", () => {
    test("covers every DashboardComponentType exactly once", () => {
      const catalogTypes: Array<DashboardComponentType> = getAllItems(
        WIDGET_CATALOG,
      ).map((item: WidgetCatalogItem) => {
        return item.type;
      });

      expect([...catalogTypes].sort()).toEqual([...ALL_COMPONENT_TYPES].sort());
      expect(catalogTypes).toHaveLength(ALL_COMPONENT_TYPES.length);
      expect(new Set(catalogTypes).size).toBe(catalogTypes.length);
    });

    test("has unique category names", () => {
      const names: Array<string> = WIDGET_CATALOG.map(
        (category: WidgetCatalogCategory) => {
          return category.name;
        },
      );

      expect(new Set(names).size).toBe(names.length);
    });

    test("puts every category in a known group", () => {
      for (const category of WIDGET_CATALOG) {
        expect(WIDGET_CATEGORY_GROUP_ORDER).toContain(category.group);
      }
    });

    test("gives every category a non-empty description and at least one widget", () => {
      for (const category of WIDGET_CATALOG) {
        expect(category.name.trim().length).toBeGreaterThan(0);
        expect(category.description.trim().length).toBeGreaterThan(0);
        expect(category.items.length).toBeGreaterThan(0);
      }
    });

    test("gives every widget a non-empty label and description", () => {
      for (const item of getAllItems(WIDGET_CATALOG)) {
        expect(item.label.trim().length).toBeGreaterThan(0);
        expect(item.description.trim().length).toBeGreaterThan(0);
      }
    });

    test("gives every widget lower-cased, de-duplicated search keywords", () => {
      for (const item of getAllItems(WIDGET_CATALOG)) {
        expect(item.keywords.length).toBeGreaterThan(0);
        expect(new Set(item.keywords).size).toBe(item.keywords.length);

        for (const keyword of item.keywords) {
          expect(keyword).toBe(keyword.toLowerCase());
          expect(keyword.trim()).toBe(keyword);
          expect(keyword.length).toBeGreaterThan(0);
        }
      }
    });

    test("keeps widget labels unique inside each category", () => {
      for (const category of WIDGET_CATALOG) {
        const labels: Array<string> = category.items.map(
          (item: WidgetCatalogItem) => {
            return item.label;
          },
        );

        expect(new Set(labels).size).toBe(labels.length);
      }
    });
  });

  describe("category grouping", () => {
    test("groups Text, Clock, and HTML under Essentials", () => {
      expect(getTypesIn("Essentials")).toEqual([
        DashboardComponentType.Text,
        DashboardComponentType.Clock,
        DashboardComponentType.Html,
      ]);
      expect(getCategory("Essentials").group).toBe(WidgetCategoryGroup.General);
    });

    test("groups the metrics-query widgets under Metrics", () => {
      expect(getTypesIn("Metrics")).toEqual([
        DashboardComponentType.Chart,
        DashboardComponentType.Value,
        DashboardComponentType.Gauge,
        DashboardComponentType.Table,
      ]);
      expect(getCategory("Metrics").group).toBe(WidgetCategoryGroup.General);
    });

    test("splits telemetry into separate Logs and Traces categories", () => {
      expect(getTypesIn("Logs")).toEqual([
        DashboardComponentType.LogStream,
        DashboardComponentType.LogChart,
      ]);
      expect(getTypesIn("Traces")).toEqual([
        DashboardComponentType.TraceList,
        DashboardComponentType.TraceChart,
        DashboardComponentType.TraceTable,
      ]);
    });

    test("splits alerts and status into Incidents, Alerts, Monitors, and SLOs", () => {
      expect(getTypesIn("Incidents")).toEqual([
        DashboardComponentType.IncidentList,
      ]);
      expect(getTypesIn("Alerts")).toEqual([DashboardComponentType.AlertList]);
      expect(getTypesIn("Monitors")).toEqual([
        DashboardComponentType.MonitorList,
      ]);
      expect(getTypesIn("SLOs")).toEqual([DashboardComponentType.Slo]);
    });

    test("keeps every observability category in the Observability group", () => {
      for (const name of [
        "Logs",
        "Traces",
        "Incidents",
        "Alerts",
        "Monitors",
        "SLOs",
      ]) {
        expect(getCategory(name).group).toBe(WidgetCategoryGroup.Observability);
      }
    });

    test("keeps every platform inventory category in the Infrastructure group", () => {
      for (const name of [
        "Hosts",
        "Kubernetes",
        "Docker",
        "Docker Swarm",
        "Podman",
        "Proxmox",
        "Ceph",
        "Network",
      ]) {
        expect(getCategory(name).group).toBe(
          WidgetCategoryGroup.Infrastructure,
        );
      }
    });

    test("lists General categories before Observability and Infrastructure ones", () => {
      const groupsInCatalogOrder: Array<WidgetCategoryGroup> =
        WIDGET_CATALOG.map((category: WidgetCatalogCategory) => {
          return category.group;
        });

      const firstIndexOfGroup: Array<number> = WIDGET_CATEGORY_GROUP_ORDER.map(
        (group: WidgetCategoryGroup) => {
          return groupsInCatalogOrder.indexOf(group);
        },
      );

      expect(firstIndexOfGroup).toEqual(
        [...firstIndexOfGroup].sort((a: number, b: number) => {
          return a - b;
        }),
      );
    });
  });

  describe("groupWidgetCategories", () => {
    test("returns sections in WIDGET_CATEGORY_GROUP_ORDER", () => {
      const sections: Array<WidgetCategoryGroupSection> =
        groupWidgetCategories(WIDGET_CATALOG);

      expect(
        sections.map((section: WidgetCategoryGroupSection) => {
          return section.group;
        }),
      ).toEqual([...WIDGET_CATEGORY_GROUP_ORDER]);
    });

    test("keeps every category and preserves catalog order inside a group", () => {
      const sections: Array<WidgetCategoryGroupSection> =
        groupWidgetCategories(WIDGET_CATALOG);

      const flattened: Array<string> = sections.flatMap(
        (section: WidgetCategoryGroupSection) => {
          return section.categories.map((category: WidgetCatalogCategory) => {
            return category.name;
          });
        },
      );

      expect(flattened).toHaveLength(WIDGET_CATALOG.length);

      const infrastructure: WidgetCategoryGroupSection | undefined =
        sections.find((section: WidgetCategoryGroupSection) => {
          return section.group === WidgetCategoryGroup.Infrastructure;
        });

      expect(
        infrastructure?.categories.map((category: WidgetCatalogCategory) => {
          return category.name;
        }),
      ).toEqual([
        "Hosts",
        "Kubernetes",
        "Docker",
        "Docker Swarm",
        "Podman",
        "Proxmox",
        "Ceph",
        "Network",
      ]);
    });

    test("drops groups that have no categories left", () => {
      const sections: Array<WidgetCategoryGroupSection> = groupWidgetCategories(
        [getCategory("Essentials")],
      );

      expect(sections).toHaveLength(1);
      expect(sections[0]?.group).toBe(WidgetCategoryGroup.General);
    });

    test("returns nothing for an empty category list", () => {
      expect(groupWidgetCategories([])).toEqual([]);
    });
  });

  describe("tokenizeSearchTerm", () => {
    test("lower-cases and splits on whitespace", () => {
      expect(tokenizeSearchTerm("Docker Volume")).toEqual(["docker", "volume"]);
    });

    test("collapses repeated and surrounding whitespace", () => {
      expect(tokenizeSearchTerm("   log    chart \n")).toEqual([
        "log",
        "chart",
      ]);
    });

    test("returns no tokens for empty or whitespace-only input", () => {
      expect(tokenizeSearchTerm("")).toEqual([]);
      expect(tokenizeSearchTerm("    ")).toEqual([]);
    });
  });

  describe("searchWidgetCatalog", () => {
    test("returns the whole catalog for an empty search", () => {
      expect(searchWidgetCatalog("")).toEqual([...WIDGET_CATALOG]);
      expect(searchWidgetCatalog("   ")).toEqual([...WIDGET_CATALOG]);
    });

    test("returns a new array so callers cannot mutate the catalog", () => {
      const result: Array<WidgetCatalogCategory> = searchWidgetCatalog("");

      expect(result).not.toBe(WIDGET_CATALOG);
      result.pop();
      expect(WIDGET_CATALOG).toHaveLength(result.length + 1);
    });

    test("matches widget labels regardless of case", () => {
      expect(getMatchedTypes("GAUGE")).toContain(DashboardComponentType.Gauge);
      expect(getMatchedTypes("gauge")).toContain(DashboardComponentType.Gauge);
    });

    test("matches text that only appears in the description", () => {
      expect(getMatchedTypes("honeycomb")).toEqual([
        DashboardComponentType.CephOsdList,
      ]);
    });

    test("matches keywords that are not in the visible copy", () => {
      expect(getMatchedTypes("burn rate")).toEqual([
        DashboardComponentType.Slo,
      ]);
      expect(getMatchedTypes("iframe")).toEqual([DashboardComponentType.Html]);
      expect(getMatchedTypes("timezone")).toEqual([
        DashboardComponentType.Clock,
      ]);
    });

    test("matches a category name and keeps all of its widgets", () => {
      expect(getMatchedTypes("kubernetes")).toEqual(getTypesIn("Kubernetes"));
    });

    test("matches a group name", () => {
      const matched: Array<string> = getMatchedTypes("observability");

      expect(matched).toContain(DashboardComponentType.IncidentList);
      expect(matched).toContain(DashboardComponentType.LogStream);
      expect(matched).not.toContain(DashboardComponentType.Text);
    });

    test("requires every token to match, so multi-word searches narrow results", () => {
      expect(getMatchedTypes("docker volume")).toEqual([
        DashboardComponentType.DockerVolumeList,
      ]);
      expect(getMatchedTypes("podman volume")).toEqual([
        DashboardComponentType.PodmanVolumeList,
      ]);
    });

    test("matches tokens spread across different fields", () => {
      expect(getMatchedTypes("essentials clock")).toEqual([
        DashboardComponentType.Clock,
      ]);
    });

    test("returns no categories when nothing matches", () => {
      expect(searchWidgetCatalog("zzzzz-not-a-widget")).toEqual([]);
    });

    test("drops categories that have no matching widgets", () => {
      const result: Array<WidgetCatalogCategory> = searchWidgetCatalog("gauge");

      /*
       * Both gauge widgets match — the metrics one and the external Data
       * Source one — and every other category drops out entirely.
       */
      expect(
        result.map((category: WidgetCatalogCategory) => {
          return category.name;
        }),
      ).toEqual(["Metrics", "External Data Sources"]);
      expect(result[0]?.items).toHaveLength(1);
      expect(result[1]?.items).toHaveLength(1);
    });

    test("does not mutate the source catalog", () => {
      const before: string = JSON.stringify(WIDGET_CATALOG);

      searchWidgetCatalog("docker");
      searchWidgetCatalog("");
      searchWidgetCatalog("nothing at all here");

      expect(JSON.stringify(WIDGET_CATALOG)).toBe(before);
    });

    test("searches the supplied catalog when one is passed", () => {
      const result: Array<WidgetCatalogCategory> = searchWidgetCatalog(
        "clock",
        [getCategory("Metrics")],
      );

      expect(result).toEqual([]);
    });
  });

  describe("countWidgets", () => {
    test("counts nothing for an empty list", () => {
      expect(countWidgets([])).toBe(0);
    });

    test("counts every widget in the catalog", () => {
      expect(countWidgets(WIDGET_CATALOG)).toBe(ALL_COMPONENT_TYPES.length);
    });

    test("counts only the widgets left after a search", () => {
      expect(countWidgets(searchWidgetCatalog("kubernetes"))).toBe(
        getCategory("Kubernetes").items.length,
      );
    });
  });

  describe("getFirstWidget", () => {
    test("returns the first widget in catalog order", () => {
      expect(getFirstWidget(WIDGET_CATALOG)?.type).toBe(
        DashboardComponentType.Text,
      );
    });

    test("returns the first match of a search", () => {
      expect(getFirstWidget(searchWidgetCatalog("trace"))?.type).toBe(
        DashboardComponentType.TraceList,
      );
    });

    test("returns null when there are no categories", () => {
      expect(getFirstWidget([])).toBeNull();
    });

    test("skips categories that have no widgets", () => {
      const emptyCategory: WidgetCatalogCategory = {
        ...getCategory("Metrics"),
        name: "Empty",
        items: [],
      };

      expect(
        getFirstWidget([emptyCategory, getCategory("Essentials")])?.type,
      ).toBe(DashboardComponentType.Text);
    });
  });

  describe("findCategoryByName", () => {
    test("finds a category by its exact name", () => {
      expect(findCategoryByName(WIDGET_CATALOG, "Docker Swarm")?.name).toBe(
        "Docker Swarm",
      );
    });

    test("returns null for an unknown name", () => {
      expect(findCategoryByName(WIDGET_CATALOG, "Nope")).toBeNull();
    });

    test("returns null when no name is selected", () => {
      expect(findCategoryByName(WIDGET_CATALOG, null)).toBeNull();
    });

    test("returns null when the name was filtered out of the given list", () => {
      expect(
        findCategoryByName(searchWidgetCatalog("kubernetes"), "Metrics"),
      ).toBeNull();
    });
  });
});
