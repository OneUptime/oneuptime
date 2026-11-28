import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Includes from "Common/Types/BaseDatabase/Includes";
import IncludesNoneOrNull from "Common/Types/BaseDatabase/IncludesNoneOrNull";
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
  INVENTORY_CLUSTER_FACET_KEY,
  INVENTORY_DATACENTER_FACET_KEY,
  INVENTORY_FACET_QUERY_FIELDS,
  INVENTORY_HOST_FACET_KEY,
  INVENTORY_ITEMS_TABLE_ID,
  INVENTORY_PLACEMENT_FACET_WORDS,
  INVENTORY_PLACEMENT_ITEM_COUNT,
  InventoryPlacementOptionsLoader,
  getInventoryPlacementFacet,
  getInventoryPlacementFacets,
  toInventoryPlacementFacetOption,
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
  InventoryPlacementChoice,
  InventoryPlacementOptionsRequest,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryPlacementApi";
import {
  INVENTORY_PLACEMENT_LEVELS,
  InventoryPlacementLevel,
} from "Common/Utils/Inventory/InventoryItemPlacement";
import ObjectID from "Common/Types/ObjectID";
import IconProp from "Common/Types/Icon/IconProp";
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
    expect(INVENTORY_CLUSTER_FACET_KEY).toBe("inventoryCluster");
    expect(INVENTORY_HOST_FACET_KEY).toBe("inventoryHost");
    expect(INVENTORY_DATACENTER_FACET_KEY).toBe("inventoryDatacenter");
  });

  test("the chips are in reading order: what it is, where from, whether live, where it sits, then the rest", () => {
    expect(facetKeys(INVENTORY_BASE_FACETS)).toEqual([
      INVENTORY_TYPE_FACET_KEY,
      INVENTORY_SOURCE_FACET_KEY,
      INVENTORY_STATUS_FACET_KEY,
      INVENTORY_CLUSTER_FACET_KEY,
      INVENTORY_HOST_FACET_KEY,
      INVENTORY_DATACENTER_FACET_KEY,
      INVENTORY_LAST_SEEN_FACET_KEY,
      INVENTORY_SECURITY_PATCH_FACET_KEY,
      INVENTORY_AGENT_PERMISSIONS_FACET_KEY,
    ]);
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
    expect(facet(INVENTORY_CLUSTER_FACET_KEY).queryField).toBe(
      "placementCluster",
    );
    expect(facet(INVENTORY_HOST_FACET_KEY).queryField).toBe("placementHost");
    expect(facet(INVENTORY_DATACENTER_FACET_KEY).queryField).toBe(
      "placementDatacenter",
    );
  });
});

describe("Cluster, Host and Datacenter facets (#11470)", () => {
  const PROJECT_ID: ObjectID = ObjectID.generate();
  const CHOICES: Array<InventoryPlacementChoice> = [
    { value: "esx-node-07.acme.lan", count: 10250 },
    { value: "esx-node-08.acme.lan", count: 1 },
  ];

  function recordingLoader(): {
    load: InventoryPlacementOptionsLoader;
    asked: Array<InventoryPlacementOptionsRequest>;
  } {
    const asked: Array<InventoryPlacementOptionsRequest> = [];
    return {
      asked,
      load: async (
        request: InventoryPlacementOptionsRequest,
      ): Promise<Array<InventoryPlacementChoice>> => {
        asked.push(request);
        return CHOICES;
      },
    };
  }

  test("one chip per level, named for the place, with its own search words and icon", () => {
    expect(
      getInventoryPlacementFacets().map((item: ResourceFacet) => {
        return {
          key: item.key,
          label: item.label,
          icon: item.icon,
          searchPlaceholder: item.searchPlaceholder,
        };
      }),
    ).toEqual([
      {
        key: INVENTORY_CLUSTER_FACET_KEY,
        label: "Cluster",
        icon: IconProp.RectangleStack,
        searchPlaceholder: "Search clusters...",
      },
      {
        key: INVENTORY_HOST_FACET_KEY,
        label: "Host",
        icon: IconProp.Server,
        searchPlaceholder: "Search hosts...",
      },
      {
        key: INVENTORY_DATACENTER_FACET_KEY,
        label: "Datacenter",
        icon: IconProp.BuildingOffice,
        searchPlaceholder: "Search datacenters...",
      },
    ]);
    expect(Object.keys(INVENTORY_PLACEMENT_FACET_WORDS)).toEqual(
      INVENTORY_PLACEMENT_LEVELS,
    );
  });

  test("each is a multi-select of is and is not, its choices loaded from the server as typed", () => {
    for (const item of getInventoryPlacementFacets()) {
      expect(item.isMultiSelect).toBe(true);
      expect(item.supportedOperators).toEqual(["is", "is_not"]);
      expect(item.loadOptions).toBeDefined();
      expect(item.resolveOptions).toBeDefined();
      expect(item.options).toBeUndefined();
      expect(item.fetchOptions).toBeUndefined();
    }
  });

  test("is builds an Includes of the names chosen; is not keeps the items with no place", () => {
    const host: ResourceFacet = facet(INVENTORY_HOST_FACET_KEY);
    const included: unknown = host.toQueryValue!(
      ["esx-node-07.acme.lan", "esx-node-08.acme.lan"],
      "is",
    );
    expect(included).toBeInstanceOf(Includes);
    expect((included as Includes).values).toEqual([
      "esx-node-07.acme.lan",
      "esx-node-08.acme.lan",
    ]);
    const excluded: unknown = host.toQueryValue!(
      ["esx-node-07.acme.lan"],
      "is_not",
    );
    expect(excluded).toBeInstanceOf(IncludesNoneOrNull);
  });

  test("asks the server for the level's places, with what was typed, trimmed", async () => {
    const { load, asked } = recordingLoader();
    const cluster: ResourceFacet = getInventoryPlacementFacet(
      InventoryPlacementLevel.Cluster,
      { loadPlacementOptions: load },
    );
    await cluster.loadOptions!(PROJECT_ID, "  alpha ");
    expect(asked).toEqual([
      {
        level: InventoryPlacementLevel.Cluster,
        search: "alpha",
        isArchived: false,
      },
    ]);
  });

  test("the Archived list's chips ask for the archived items' places", async () => {
    const { load, asked } = recordingLoader();
    const facets: Array<ResourceFacet> = buildInventoryFacets(
      {},
      { isArchived: true, loadPlacementOptions: load },
    );
    const datacenter: ResourceFacet = facets.find((item: ResourceFacet) => {
      return item.key === INVENTORY_DATACENTER_FACET_KEY;
    })!;
    await datacenter.loadOptions!(PROJECT_ID, "");
    expect(asked).toEqual([
      {
        level: InventoryPlacementLevel.Datacenter,
        search: "",
        isArchived: true,
      },
    ]);
  });

  test("each choice reads its name, and under it how many items are there", async () => {
    const { load } = recordingLoader();
    const host: ResourceFacet = getInventoryPlacementFacet(
      InventoryPlacementLevel.Host,
      { loadPlacementOptions: load },
    );
    const options: Array<FilterChipDropdownOption> = await host.loadOptions!(
      PROJECT_ID,
      "",
    );
    expect(options.map((option: FilterChipDropdownOption) => {
      return { value: option.value, label: option.label };
    })).toEqual([
      { value: "esx-node-07.acme.lan", label: "esx-node-07.acme.lan" },
      { value: "esx-node-08.acme.lan", label: "esx-node-08.acme.lan" },
    ]);
    expect(options[0]!.sublabel).toMatch(/10,?250 items/);
    expect(options[1]!.sublabel).toBe("1 item");
    expect(INVENTORY_PLACEMENT_ITEM_COUNT).toEqual({
      one: "{{count}} item",
      other: "{{count}} items",
    });
    expect(
      toInventoryPlacementFacetOption({ value: "cluster-a", count: 2 }),
    ).toEqual({ value: "cluster-a", label: "cluster-a", sublabel: "2 items" });
  });

  test("a saved choice reads as it was chosen, with nothing asked of the server", async () => {
    const { load, asked } = recordingLoader();
    const cluster: ResourceFacet = getInventoryPlacementFacet(
      InventoryPlacementLevel.Cluster,
      { loadPlacementOptions: load },
    );
    expect(
      await cluster.resolveOptions!(PROJECT_ID, ["cluster-alpha", "prod-eu"]),
    ).toEqual([
      { value: "cluster-alpha", label: "cluster-alpha" },
      { value: "prod-eu", label: "prod-eu" },
    ]);
    expect(asked).toEqual([]);
  });

  test("without the list's loader a chip offers no choices, and asks nobody", async () => {
    const host: ResourceFacet = getInventoryPlacementFacet(
      InventoryPlacementLevel.Host,
    );
    expect(await host.loadOptions!(PROJECT_ID, "esx")).toEqual([]);
    // The static list the saved-view keys are read from is the same chips.
    expect(facet(INVENTORY_HOST_FACET_KEY).queryField).toBe(host.queryField);
  });

  test("a server that fails leaves the chip's failure to the chip", async () => {
    const failing: ResourceFacet = getInventoryPlacementFacet(
      InventoryPlacementLevel.Host,
      {
        loadPlacementOptions: async (): Promise<
          Array<InventoryPlacementChoice>
        > => {
          throw new Error("offline");
        },
      },
    );
    await expect(failing.loadOptions!(PROJECT_ID, "")).rejects.toThrow(
      "offline",
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

  /*
   * "Is not" keeps the items with no value (#10581): IncludesNoneOrNull is
   * `NOT IN (...) OR IS NULL`, a class of its own and not a kind of
   * IncludesNone, as every "is not" chip builds it.
   */
  test("is not builds an IncludesNoneOrNull query", () => {
    const values: Array<string> = [EntityType.Host, EntityType.Container];
    const query: unknown = typeFacet.toQueryValue!(values, "is_not");

    expect(query).toBeInstanceOf(IncludesNoneOrNull);
    expect((query as IncludesNoneOrNull).values).toEqual(values);
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
    expect(excluded).toBeInstanceOf(IncludesNoneOrNull);
    expect((excluded as IncludesNoneOrNull).values).toEqual(values);
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
    // Its own column, answered by the server: nothing read first (#11211).
    expect(statusFacet.toLinkedTo).toBeUndefined();
    expect(statusFacet.toFilterGroups).toBeUndefined();
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
    expect(query).toBeInstanceOf(IncludesNoneOrNull);
    expect((query as IncludesNoneOrNull).values).toEqual(values);
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

  test("is builds an Includes query, is not an IncludesNoneOrNull one", () => {
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
    expect(notUpToDate).toBeInstanceOf(IncludesNoneOrNull);
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
    ["placementCluster", INVENTORY_CLUSTER_FACET_KEY],
    ["placementHost", INVENTORY_HOST_FACET_KEY],
    ["placementDatacenter", INVENTORY_DATACENTER_FACET_KEY],
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
      placementCluster: "cluster-alpha",
      placementHost: "esx-node-07.acme.lan",
      placementDatacenter: "DC-NORTH",
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

describe("the state facets read apart in every language", () => {
  /*
   * All Items draws the Status, Security Patch Level and Agent Permissions
   * chips side by side, and the same words in the pills of their columns.
   * Security Patch Level's Out of Date first read, in twelve languages,
   * word for word what Status draws for Stale ("Veraltet" in German, "古い"
   * in Japanese): a patch out of date and an item gone stale looked alike.
   * In every language the Dashboard speaks, no two of these states read the
   * same.
   */
  const LOCALES_DIR: string = path.join(
    __dirname,
    "..",
    "..",
    "FeatureSet",
    "Dashboard",
    "src",
    "Locales",
  );

  const STATES: Array<string> = [
    ...INVENTORY_STATUS_FACET_OPTIONS,
    ...INVENTORY_SECURITY_PATCH_FACET_OPTIONS,
    ...INVENTORY_AGENT_PERMISSIONS_FACET_OPTIONS,
  ].map((option: FilterChipDropdownOption): string => {
    return option.label;
  });

  const languages: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".json") && file !== "en.json";
    })
    .map((file: string): string => {
      return file.replace(/\.json$/, "");
    });

  test("the scan reads every state of the three chips, in every language", () => {
    expect(STATES).toEqual(
      expect.arrayContaining(["Stale", "Out of Date", "Missing"]),
    );
    expect(languages.length).toBeGreaterThanOrEqual(16);
  });

  test.each(languages)(
    "%s draws each state in words of its own",
    (language: string) => {
      const words: Record<string, unknown> = JSON.parse(
        fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
      ) as Record<string, unknown>;

      const byWord: Map<string, Array<string>> = new Map<
        string,
        Array<string>
      >();
      for (const state of STATES) {
        const drawn: unknown = words[state];
        const word: string = (typeof drawn === "string" ? drawn : state)
          .trim()
          .toLocaleLowerCase(language);
        byWord.set(word, [...(byWord.get(word) || []), state]);
      }

      const alike: Array<string> = [...byWord.entries()]
        .filter((entry: [string, Array<string>]): boolean => {
          return entry[1].length > 1;
        })
        .map((entry: [string, Array<string>]): string => {
          return `${entry[1].join(" and ")} both read "${entry[0]}"`;
        });

      expect(alike).toEqual([]);
    },
  );
});
