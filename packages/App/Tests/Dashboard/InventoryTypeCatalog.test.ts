import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  INVENTORY_ENTITY_TYPES,
  MANUAL_ENTITY_TYPES,
} from "Common/Types/Telemetry/EntityTypeGroups";
import {
  INVENTORY_CATEGORY_ORDER,
  INVENTORY_TYPE_DESCRIPTORS,
  InventoryCategory,
  InventoryCategoryBreakdown,
  InventoryCategoryBreakdownRow,
  InventoryTypeDescriptor,
  buildInventoryBreakdown,
  getEntityTypesInCategory,
  getInventoryTypeCategory,
  getInventoryTypeDescriptor,
  getInventoryTypeIcon,
  getInventoryTypeLabel,
  getInventoryTypePluralLabel,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import IconProp from "Common/Types/Icon/IconProp";

/*
 * The catalog is what stands between the wire vocabulary and the UI. Its two
 * load-bearing properties are total coverage (every EntityType has a
 * human-readable entry) and a clean partition (each type sits in exactly one
 * category, so the Overview's breakdown sums to the total). Both are the kind
 * of thing that decays silently when someone adds a type — a new type with no
 * entry renders as `docker.swarm.whatever` in the table and vanishes from the
 * breakdown, and nothing crashes.
 */

const ALL_ENTITY_TYPES: Array<EntityType> = Object.values(EntityType);

describe("the catalog covers the whole vocabulary", () => {
  test("there is at least one entity type to cover", () => {
    expect(ALL_ENTITY_TYPES.length).toBeGreaterThan(0);
  });

  test.each(ALL_ENTITY_TYPES)(
    "%s has a descriptor",
    (entityType: EntityType) => {
      expect(getInventoryTypeDescriptor(entityType)).not.toBeNull();
    },
  );

  test.each(ALL_ENTITY_TYPES)(
    "%s has a label that is not just its wire value",
    (entityType: EntityType) => {
      const label: string = getInventoryTypeLabel(entityType);

      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toBe(entityType);
      // A dot in the label means a dotted wire string leaked through.
      expect(label).not.toContain(".");
    },
  );

  test.each(ALL_ENTITY_TYPES)(
    "%s has a plural label and a description",
    (entityType: EntityType) => {
      const descriptor: InventoryTypeDescriptor | null =
        getInventoryTypeDescriptor(entityType);

      expect(descriptor!.pluralLabel.length).toBeGreaterThan(0);
      expect(descriptor!.description.length).toBeGreaterThan(0);
    },
  );

  test("INVENTORY_TYPE_DESCRIPTORS lists every type exactly once", () => {
    const listed: Array<string> = INVENTORY_TYPE_DESCRIPTORS.map(
      (descriptor: InventoryTypeDescriptor): string => {
        return descriptor.entityType;
      },
    );

    expect(listed.length).toBe(ALL_ENTITY_TYPES.length);
    expect(new Set(listed).size).toBe(ALL_ENTITY_TYPES.length);
    expect(new Set(listed)).toEqual(new Set<string>(ALL_ENTITY_TYPES));
  });

  test("singular labels are unique, or two rows read identically", () => {
    const labels: Array<string> = INVENTORY_TYPE_DESCRIPTORS.map(
      (descriptor: InventoryTypeDescriptor): string => {
        return descriptor.label;
      },
    );

    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe("categories partition the vocabulary", () => {
  test("every type's category is one of the declared ones", () => {
    for (const entityType of ALL_ENTITY_TYPES) {
      expect(INVENTORY_CATEGORY_ORDER).toContain(
        getInventoryTypeCategory(entityType),
      );
    }
  });

  test("the categories together cover every type exactly once", () => {
    const seen: Array<string> = [];

    for (const category of INVENTORY_CATEGORY_ORDER) {
      seen.push(...getEntityTypesInCategory(category));
    }

    expect(seen.length).toBe(ALL_ENTITY_TYPES.length);
    expect(new Set(seen).size).toBe(seen.length);
  });

  test("no category is declared but empty", () => {
    for (const category of INVENTORY_CATEGORY_ORDER) {
      expect(getEntityTypesInCategory(category).length).toBeGreaterThan(0);
    }
  });

  test("the declared order has no duplicates", () => {
    expect(new Set(INVENTORY_CATEGORY_ORDER).size).toBe(
      INVENTORY_CATEGORY_ORDER.length,
    );
  });

  test("INVENTORY_TYPE_DESCRIPTORS is grouped by category, not interleaved", () => {
    /*
     * The dropdown and the breakdown both render straight from this array, so
     * a type appearing after its category's block has closed shows up under
     * the wrong heading.
     */
    const categoriesInOrder: Array<InventoryCategory> =
      INVENTORY_TYPE_DESCRIPTORS.map(
        (descriptor: InventoryTypeDescriptor): InventoryCategory => {
          return descriptor.category;
        },
      );

    const firstAppearance: Array<InventoryCategory> = [];

    for (const category of categoriesInOrder) {
      if (firstAppearance[firstAppearance.length - 1] !== category) {
        expect(firstAppearance).not.toContain(category);
        firstAppearance.push(category);
      }
    }

    expect(firstAppearance).toEqual(
      INVENTORY_CATEGORY_ORDER.filter((category: InventoryCategory) => {
        return getEntityTypesInCategory(category).length > 0;
      }),
    );
  });

  test("the manual types the create form offers are all External", () => {
    /*
     * Not a rule the catalog enforces, but the one that makes the create
     * dropdown coherent: everything a user can add by hand is something
     * OneUptime cannot see, which is what the External category means.
     */
    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(getInventoryTypeCategory(entityType)).toBe(
        InventoryCategory.External,
      );
    }
  });

  test("no inventory-mirrored type is filed under External", () => {
    for (const entityType of INVENTORY_ENTITY_TYPES) {
      expect(getInventoryTypeCategory(entityType)).not.toBe(
        InventoryCategory.External,
      );
    }
  });
});

describe("unknown types degrade instead of breaking", () => {
  const UNKNOWN: string = "quantum.flux.capacitor";

  test("the descriptor is null", () => {
    expect(getInventoryTypeDescriptor(UNKNOWN)).toBeNull();
  });

  test("the label falls back to the raw value", () => {
    expect(getInventoryTypeLabel(UNKNOWN)).toBe(UNKNOWN);
    expect(getInventoryTypePluralLabel(UNKNOWN)).toBe(UNKNOWN);
  });

  test("the icon falls back to the generic cube, never undefined", () => {
    expect(getInventoryTypeIcon(UNKNOWN)).toBe(IconProp.Cube);
  });

  test("the category is null rather than a wrong guess", () => {
    expect(getInventoryTypeCategory(UNKNOWN)).toBeNull();
  });

  test("an empty string does not resolve to anything", () => {
    expect(getInventoryTypeDescriptor("")).toBeNull();
    expect(getInventoryTypeLabel("")).toBe("");
  });
});

describe("buildInventoryBreakdown", () => {
  type TotalOfFunction = (
    breakdown: Array<InventoryCategoryBreakdown>,
  ) => number;

  const totalOf: TotalOfFunction = (
    breakdown: Array<InventoryCategoryBreakdown>,
  ): number => {
    return breakdown.reduce(
      (sum: number, group: InventoryCategoryBreakdown): number => {
        return sum + group.total;
      },
      0,
    );
  };

  test("an empty count map produces no groups", () => {
    expect(buildInventoryBreakdown({})).toEqual([]);
  });

  test("types that counted zero are dropped", () => {
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.KubernetesPod]: 0,
        [EntityType.Host]: 3,
      });

    expect(breakdown.length).toBe(1);
    expect(breakdown[0]!.category).toBe(InventoryCategory.Compute);
    expect(breakdown[0]!.rows.length).toBe(1);
  });

  test("group totals sum to the input, so the tiles and the breakdown agree", () => {
    const counts: Record<string, number> = {
      [EntityType.Service]: 12,
      [EntityType.Host]: 4,
      [EntityType.KubernetesPod]: 40,
      [EntityType.NetworkDevice]: 7,
      [EntityType.ExternalService]: 1,
    };

    expect(totalOf(buildInventoryBreakdown(counts))).toBe(12 + 4 + 40 + 7 + 1);
  });

  test("rows within a group are ordered biggest first", () => {
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.KubernetesPod]: 5,
        [EntityType.KubernetesNode]: 30,
        [EntityType.KubernetesCluster]: 2,
      });

    const counts: Array<number> = breakdown[0]!.rows.map(
      (row: InventoryCategoryBreakdownRow): number => {
        return row.count;
      },
    );

    expect(counts).toEqual([30, 5, 2]);
  });

  test("groups appear in the declared category order", () => {
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.ExternalService]: 1,
        [EntityType.Service]: 1,
        [EntityType.KubernetesPod]: 1,
      });

    expect(
      breakdown.map((group: InventoryCategoryBreakdown) => {
        return group.category;
      }),
    ).toEqual([
      InventoryCategory.Applications,
      InventoryCategory.Kubernetes,
      InventoryCategory.External,
    ]);
  });

  test("rows carry the plural label, not the wire value", () => {
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.KubernetesPod]: 3,
      });

    expect(breakdown[0]!.rows[0]!.label).toBe("Kubernetes Pods");
    expect(breakdown[0]!.rows[0]!.entityType).toBe(EntityType.KubernetesPod);
  });

  test("a type this build does not know is collected, not discarded", () => {
    /*
     * The alternative — dropping it — makes the breakdown quietly understate
     * an estate when the dashboard is older than the server that wrote the
     * rows.
     */
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.Service]: 2,
        "future.thing": 5,
      });

    expect(totalOf(breakdown)).toBe(7);

    const other: InventoryCategoryBreakdown | undefined = breakdown.find(
      (group: InventoryCategoryBreakdown) => {
        return group.category === null;
      },
    );

    expect(other).toBeDefined();
    expect(other!.label).toBe("Other");
    expect(other!.rows[0]!.entityType).toBe("future.thing");
  });

  test("the unknown group sorts last", () => {
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        "future.thing": 5,
        [EntityType.Service]: 2,
      });

    expect(breakdown[breakdown.length - 1]!.category).toBeNull();
  });

  test("negative counts are treated as absent rather than subtracting", () => {
    // Defensive: a count map is built by summing, so this should be impossible.
    const breakdown: Array<InventoryCategoryBreakdown> =
      buildInventoryBreakdown({
        [EntityType.Service]: -3,
        [EntityType.Host]: 2,
      });

    expect(totalOf(breakdown)).toBe(2);
  });
});
