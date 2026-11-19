import { describe, expect, test } from "@jest/globals";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { InventoryLiveness } from "Common/Types/Telemetry/InventoryLiveness";
import { AndroidSecurityPatchStatus } from "Common/Types/Host/AndroidSecurityPatch";
import { AndroidAgentPermissionsStatus } from "Common/Types/Host/AndroidAgentPermissions";
import {
  INVENTORY_AGENT_PERMISSIONS_FACET_KEY,
  INVENTORY_AGENT_PERMISSIONS_FACET_OPTIONS,
  INVENTORY_ARCHIVED_TABLE_ID,
  INVENTORY_BASE_FACETS,
  INVENTORY_FACET_QUERY_FIELDS,
  INVENTORY_ITEMS_TABLE_ID,
  INVENTORY_LAST_SEEN_FACET_KEY,
  INVENTORY_SECURITY_PATCH_FACET_KEY,
  INVENTORY_SECURITY_PATCH_FACET_OPTIONS,
  INVENTORY_SOURCE_FACET_KEY,
  INVENTORY_SOURCE_FACET_OPTIONS,
  INVENTORY_STATUS_FACET_KEY,
  INVENTORY_STATUS_FACET_OPTIONS,
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
    expect(INVENTORY_STATUS_FACET_KEY).toBe("inventoryStatus");
    expect(INVENTORY_LAST_SEEN_FACET_KEY).toBe("inventoryLastSeen");
    expect(INVENTORY_SECURITY_PATCH_FACET_KEY).toBe("inventorySecurityPatch");
    expect(INVENTORY_AGENT_PERMISSIONS_FACET_KEY).toBe(
      "inventoryAgentPermissions",
    );
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
    expect(facet(INVENTORY_STATUS_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.status,
    );
    expect(facet(INVENTORY_LAST_SEEN_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.lastSeen,
    );
    expect(facet(INVENTORY_SECURITY_PATCH_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.securityPatch,
    );
    expect(facet(INVENTORY_AGENT_PERMISSIONS_FACET_KEY).queryField).toBe(
      INVENTORY_FACET_QUERY_FIELDS.agentPermissions,
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

describe("Status facet", () => {
  const statusFacet: ResourceFacet = facet(INVENTORY_STATUS_FACET_KEY);

  test("offers every liveness state once in display order", () => {
    expect(
      INVENTORY_STATUS_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): string => {
          return option.value;
        },
      ),
    ).toEqual(Object.values(InventoryLiveness));
    expect(
      INVENTORY_STATUS_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): string => {
          return option.label;
        },
      ),
    ).toEqual(["Live", "Recent", "Stale", "Never seen", "Not tracked"]);
    for (const option of INVENTORY_STATUS_FACET_OPTIONS) {
      expect(option.sublabel).toBeTruthy();
    }
  });

  test("supports multi-select inclusion and exclusion without date/source collisions", () => {
    expect(statusFacet.isMultiSelect).toBe(true);
    expect(statusFacet.supportedOperators).toEqual(["is", "is_not"]);
    expect(statusFacet.queryField).toBe("inventoryStatus");
    expect(statusFacet.exclusiveWith).toBeUndefined();
    expect(statusFacet.computeMatchingResourceIds).toBeUndefined();
  });

  test.each(Object.values(InventoryLiveness))(
    "filters %s using the server's computed status",
    (status: InventoryLiveness) => {
      const query: unknown = statusFacet.toQueryValue!([status], "is");
      expect(query).toBeInstanceOf(Includes);
      expect((query as Includes).values).toEqual([status]);
    },
  );

  test("multiple states use OR within the status dimension", () => {
    const values: Array<string> = [
      InventoryLiveness.Stale,
      InventoryLiveness.Never,
    ];
    const query: unknown = statusFacet.toQueryValue!(values, "is");
    expect(query).toBeInstanceOf(Includes);
    expect((query as Includes).values).toEqual(values);
  });

  test("exclusion can include untracked and never-seen states", () => {
    const values: Array<string> = [
      InventoryLiveness.NotTracked,
      InventoryLiveness.Never,
    ];
    const query: unknown = statusFacet.toQueryValue!(values, "is_not");
    expect(query).toBeInstanceOf(IncludesNone);
    expect((query as IncludesNone).values).toEqual(values);
  });

  test("clearing or supplying a date operator removes the constraint", () => {
    expect(statusFacet.toQueryValue!([], "is")).toBeUndefined();
    expect(statusFacet.toQueryValue!([], "is_not")).toBeUndefined();
    expect(
      statusFacet.toQueryValue!([InventoryLiveness.Live], "before"),
    ).toBeUndefined();
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

/*
 * #9965: which Android devices are behind on their security patches, by
 * the rule the alert reads - more than 90 days old - computed by the
 * server (InventoryItem.securityPatchStatus, InventorySecurityPatchPostgres).
 */
describe("Security Patch Level facet", () => {
  const securityPatchFacet: ResourceFacet = facet(
    INVENTORY_SECURITY_PATCH_FACET_KEY,
  );

  test("is named as the asset detail is, and offers out of date first", () => {
    expect(securityPatchFacet.label).toBe("Security Patch Level");
    expect(
      INVENTORY_SECURITY_PATCH_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): string => {
          return option.value;
        },
      ),
    ).toEqual([
      AndroidSecurityPatchStatus.OutOfDate,
      AndroidSecurityPatchStatus.UpToDate,
    ]);
    expect(
      INVENTORY_SECURITY_PATCH_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): string => {
          return option.label;
        },
      ),
    ).toEqual(["Out of Date", "Up to Date"]);
  });

  test("says the baseline in each option, in a sentence", () => {
    expect(
      INVENTORY_SECURITY_PATCH_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): string => {
          return option.sublabel!;
        },
      ),
    ).toEqual([
      "Its security patch level is more than 90 days old.",
      "Its security patch level is 90 days old or newer.",
    ]);
  });

  test("reads the server's computed status, never the attributes themselves", () => {
    expect(securityPatchFacet.queryField).toBe("securityPatchStatus");
    expect(securityPatchFacet.isMultiSelect).toBe(true);
    expect(securityPatchFacet.supportedOperators).toEqual(["is", "is_not"]);
  });

  test("is builds an Includes query, is not an IncludesNone one", () => {
    const outOfDate: unknown = securityPatchFacet.toQueryValue!(
      [AndroidSecurityPatchStatus.OutOfDate],
      "is",
    );
    expect(outOfDate).toBeInstanceOf(Includes);
    expect((outOfDate as Includes).values).toEqual([
      AndroidSecurityPatchStatus.OutOfDate,
    ]);

    const notUpToDate: unknown = securityPatchFacet.toQueryValue!(
      [AndroidSecurityPatchStatus.UpToDate],
      "is_not",
    );
    expect(notUpToDate).toBeInstanceOf(IncludesNone);
  });
});

/*
 * #9967: the devices the OneUptime Android agent still lacks a grant on,
 * which only adb gives, so a fleet's are found in one list and run device
 * by device (InventoryAgentPermissionsPostgres holds the server's status).
 */
describe("Agent Permissions facet", () => {
  const permissionsFacet: ResourceFacet = facet(
    INVENTORY_AGENT_PERMISSIONS_FACET_KEY,
  );

  test("offers the devices still missing a grant first, then those with all", () => {
    expect(permissionsFacet.label).toBe("Agent Permissions");
    expect(
      INVENTORY_AGENT_PERMISSIONS_FACET_OPTIONS.map(
        (option: FilterChipDropdownOption): Array<string> => {
          return [option.value, option.label];
        },
      ),
    ).toEqual([
      [AndroidAgentPermissionsStatus.Missing, "Missing"],
      [AndroidAgentPermissionsStatus.Granted, "All Granted"],
    ]);
    for (const option of INVENTORY_AGENT_PERMISSIONS_FACET_OPTIONS) {
      expect(option.sublabel).toMatch(/^The Android agent .+\.$/);
    }
  });

  test("reads the server's computed status, as an option list", () => {
    expect(permissionsFacet.queryField).toBe("agentPermissionsStatus");
    expect(permissionsFacet.isMultiSelect).toBe(true);
    expect(permissionsFacet.supportedOperators).toEqual(["is", "is_not"]);
    const missing: unknown = permissionsFacet.toQueryValue!(
      [AndroidAgentPermissionsStatus.Missing],
      "is",
    );
    expect(missing).toBeInstanceOf(Includes);
    expect((missing as Includes).values).toEqual([
      AndroidAgentPermissionsStatus.Missing,
    ]);
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
    ["inventoryStatus", INVENTORY_STATUS_FACET_KEY],
    ["securityPatchStatus", INVENTORY_SECURITY_PATCH_FACET_KEY],
    ["agentPermissionsStatus", INVENTORY_AGENT_PERMISSIONS_FACET_KEY],
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

  test("all locked fields leave no built-in chip able to replace them", () => {
    const query: InventoryFacetLockedQuery = {
      entityType: EntityType.Service,
      source: EntitySource.Discovered,
      lastSeenAt: "cutoff",
      inventoryStatus: InventoryLiveness.Stale,
      securityPatchStatus: AndroidSecurityPatchStatus.OutOfDate,
      agentPermissionsStatus: AndroidAgentPermissionsStatus.Missing,
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
