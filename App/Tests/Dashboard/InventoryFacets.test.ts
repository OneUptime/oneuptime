import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  INVENTORY_ARCHIVED_TABLE_ID,
  INVENTORY_BASE_FACETS,
  INVENTORY_FACET_QUERY_FIELDS,
  INVENTORY_ITEMS_TABLE_ID,
  INVENTORY_LAST_SEEN_FACET_KEY,
  INVENTORY_SOURCE_FACET_KEY,
  INVENTORY_SOURCE_FACET_OPTIONS,
  INVENTORY_TYPE_FACET_KEY,
  INVENTORY_TYPE_FACET_OPTIONS,
  InventoryFacetLockedQuery,
  buildInventoryFacets,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryFacets";
import {
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryTypeDescriptor,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  INVENTORY_SOURCE_ORDER,
  InventorySourceDescriptor,
  getInventorySourceDescriptor,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventorySource";
import { ResourceFacet } from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/ResourceFacet";
import {
  DATE_FACET_OPERATORS,
  FilterChipDropdownOption,
} from "../../FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";

/*
 * Facet keys and option values are persisted in saved views and shared URLs,
 * while queryField is the database column the lit chip claims to constrain.
 * A mismatch in any of those does not crash: it quietly renders a plausible
 * chip over the wrong row set. These tests therefore pin the vocabulary, the
 * human presentation, and the query operators together.
 */

function facet(key: string): ResourceFacet {
  return INVENTORY_BASE_FACETS.find((item: ResourceFacet): boolean => {
    return item.key === key;
  })!;
}

function facetKeys(facets: Array<ResourceFacet>): Array<string> {
  return facets.map((item: ResourceFacet): string => {
    return item.key;
  });
}

describe("Inventory table namespaces", () => {
  test("live and archived tables keep stable, distinct persistence keys", () => {
    expect(INVENTORY_ITEMS_TABLE_ID).toBe("inventory-items-table");
    expect(INVENTORY_ARCHIVED_TABLE_ID).toBe("inventory-archived-table");
    expect(INVENTORY_ITEMS_TABLE_ID).not.toBe(INVENTORY_ARCHIVED_TABLE_ID);
  });
});

describe("Inventory facet identity", () => {
  test("facet keys are stable saved-view vocabulary", () => {
    expect(INVENTORY_TYPE_FACET_KEY).toBe("inventoryType");
    expect(INVENTORY_SOURCE_FACET_KEY).toBe("inventorySource");
    expect(INVENTORY_LAST_SEEN_FACET_KEY).toBe("inventoryLastSeen");
  });

  test("keys and query fields are non-empty and distinct", () => {
    const keys: Array<string> = facetKeys(INVENTORY_BASE_FACETS);
    const fields: Array<string> = INVENTORY_BASE_FACETS.map(
      (item: ResourceFacet): string => {
        return item.queryField || item.key;
      },
    );

    expect(new Set(keys).size).toBe(keys.length);
    expect(new Set(fields).size).toBe(fields.length);

    for (const value of [...keys, ...fields]) {
      expect(value.trim()).toBe(value);
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("each chip owns the intended database column", () => {
    expect(facet(INVENTORY_TYPE_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.type,
    );
    expect(facet(INVENTORY_SOURCE_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.source,
    );
    expect(facet(INVENTORY_LAST_SEEN_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.lastSeen,
    );
  });
});

describe("Type facet", () => {
  const typeFacet: ResourceFacet = facet(INVENTORY_TYPE_FACET_KEY);

  test("offers every entity type exactly once in catalog order", () => {
    expect(
      INVENTORY_TYPE_FACET_OPTIONS.map((option: { value: string }): string => {
        return option.value;
      }),
    ).toEqual(
      INVENTORY_TYPE_DESCRIPTORS.map(
        (descriptor: InventoryTypeDescriptor): EntityType => {
          return descriptor.entityType;
        },
      ),
    );
    expect(
      new Set(
        INVENTORY_TYPE_FACET_OPTIONS.map(
          (item: FilterChipDropdownOption): string => {
            return item.value;
          },
        ),
      ).size,
    ).toBe(Object.values(EntityType).length);
  });

  test("uses the catalog's human label, description, icon and category", () => {
    for (
      let index: number = 0;
      index < INVENTORY_TYPE_DESCRIPTORS.length;
      index++
    ) {
      const descriptor: InventoryTypeDescriptor =
        INVENTORY_TYPE_DESCRIPTORS[index]!;
      const option: FilterChipDropdownOption =
        INVENTORY_TYPE_FACET_OPTIONS[index]!;

      expect(option.label).toBe(descriptor.label);
      expect(option.label).not.toBe(descriptor.entityType);
      expect(option.sublabel).toBe(descriptor.description);
      expect(option.icon).toBe(descriptor.icon);
      expect(option.group).toBe(descriptor.category);
    }
  });

  test("is a multi-select with only meaningful operators", () => {
    expect(typeFacet.isMultiSelect).toBe(true);
    expect(typeFacet.supportedOperators).toEqual(["is", "is_not"]);
  });

  test("is builds an Includes query without changing value order", () => {
    const values: Array<string> = [
      EntityType.KubernetesPod,
      EntityType.Service,
    ];
    const query: unknown = typeFacet.toQueryValue!(values, "is");

    expect(query).toBeInstanceOf(Includes);
    expect((query as Includes).values).toEqual(values);
  });

  test("is not builds an IncludesNone query", () => {
    const values: Array<string> = [EntityType.Host, EntityType.Container];
    const query: unknown = typeFacet.toQueryValue!(values, "is_not");

    expect(query).toBeInstanceOf(IncludesNone);
    expect((query as IncludesNone).values).toEqual(values);
  });

  test("an empty or nonsensical value operation constrains nothing", () => {
    expect(typeFacet.toQueryValue!([], "is")).toBeUndefined();
    expect(
      typeFacet.toQueryValue!([EntityType.Host], "before"),
    ).toBeUndefined();
  });
});

describe("Source facet", () => {
  const sourceFacet: ResourceFacet = facet(INVENTORY_SOURCE_FACET_KEY);

  test("offers every source once in product display order", () => {
    expect(
      INVENTORY_SOURCE_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): string => {
          return option.value;
        },
      ),
    ).toEqual(INVENTORY_SOURCE_ORDER);
    expect(
      new Set(
        INVENTORY_SOURCE_FACET_OPTIONS.map(
          (item: FilterChipDropdownOption): string => {
            return item.value;
          },
        ),
      ),
    ).toEqual(new Set<string>(Object.values(EntitySource)));
  });

  test("uses source descriptors rather than wire values", () => {
    for (
      let index: number = 0;
      index < INVENTORY_SOURCE_ORDER.length;
      index++
    ) {
      const descriptor: InventorySourceDescriptor =
        getInventorySourceDescriptor(INVENTORY_SOURCE_ORDER[index]!)!;
      const option: FilterChipDropdownOption =
        INVENTORY_SOURCE_FACET_OPTIONS[index]!;

      expect(option.label).toBe(descriptor.label);
      expect(option.label).not.toBe(descriptor.source);
      expect(option.sublabel).toBe(descriptor.description);
    }
  });

  test("is and is not use multi-value enum queries", () => {
    const values: Array<string> = [
      EntitySource.Discovered,
      EntitySource.Manual,
    ];
    const included: unknown = sourceFacet.toQueryValue!(values, "is");
    const excluded: unknown = sourceFacet.toQueryValue!(values, "is_not");

    expect(included).toBeInstanceOf(Includes);
    expect((included as Includes).values).toEqual(values);
    expect(excluded).toBeInstanceOf(IncludesNone);
    expect((excluded as IncludesNone).values).toEqual(values);
  });

  test("is a multi-select with no meaningless empty operator", () => {
    expect(sourceFacet.isMultiSelect).toBe(true);
    expect(sourceFacet.supportedOperators).toEqual(["is", "is_not"]);
  });
});

describe("Last Seen facet", () => {
  const lastSeenFacet: ResourceFacet = facet(INVENTORY_LAST_SEEN_FACET_KEY);

  test("uses the standard OneUptime date-range control and operators", () => {
    expect(lastSeenFacet.type).toBe("dateRange");
    expect(lastSeenFacet.supportedOperators).toEqual(DATE_FACET_OPERATORS);
  });

  test("leaves date query construction to the shared facet implementation", () => {
    expect(lastSeenFacet.toQueryValue).toBeUndefined();
    expect(lastSeenFacet.options).toBeUndefined();
  });
});

describe("scoped list protection", () => {
  test("an unscoped list gets every built-in facet", () => {
    expect(facetKeys(buildInventoryFacets())).toEqual(
      facetKeys(INVENTORY_BASE_FACETS),
    );
  });

  test.each([
    ["entityType", INVENTORY_TYPE_FACET_KEY],
    ["source", INVENTORY_SOURCE_FACET_KEY],
    ["lastSeenAt", INVENTORY_LAST_SEEN_FACET_KEY],
  ])(
    "a page-owned %s constraint removes only the colliding facet",
    (queryField: string, removedFacetKey: string) => {
      const facets: Array<ResourceFacet> = buildInventoryFacets({
        [queryField]: "locked",
      });
      const keys: Array<string> = facetKeys(facets);

      expect(keys).not.toContain(removedFacetKey);
      expect(keys).toHaveLength(INVENTORY_BASE_FACETS.length - 1);
    },
  );

  test("all three locked fields leave no built-in chip able to replace them", () => {
    const query: InventoryFacetLockedQuery = {
      entityType: EntityType.Service,
      source: EntitySource.Discovered,
      lastSeenAt: "cutoff",
    };

    expect(buildInventoryFacets(query)).toEqual([]);
  });

  test("unrelated query fields do not hide any facet", () => {
    expect(
      facetKeys(buildInventoryFacets({ isArchived: false, projectId: "p1" })),
    ).toEqual(facetKeys(INVENTORY_BASE_FACETS));
  });

  test("inherited properties are not mistaken for page-owned constraints", () => {
    const inherited: InventoryFacetLockedQuery = Object.create({
      source: EntitySource.Manual,
    }) as InventoryFacetLockedQuery;

    expect(facetKeys(buildInventoryFacets(inherited))).toContain(
      INVENTORY_SOURCE_FACET_KEY,
    );
  });

  test("an explicitly present undefined field is still protected", () => {
    expect(
      facetKeys(buildInventoryFacets({ source: undefined })),
    ).not.toContain(INVENTORY_SOURCE_FACET_KEY);
  });
});
