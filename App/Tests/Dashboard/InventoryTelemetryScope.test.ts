import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import type { ActiveFilter } from "Common/UI/Components/TelemetryViewer/types";
/*
 * STATIC imports, on purpose: the shell hands this map to five viewers whose
 * chip builders run renderer-free, so the builder — and the type catalog it
 * reads — must load in plain Node. A change that drags RouteMap / Navigation
 * / Common/UI/Config into either fails this file at load with "window is not
 * defined", which is the point.
 */
import {
  INVENTORY_ITEM_FALLBACK_DISPLAY_KEY,
  buildInventoryEntityKeyDisplays,
} from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTelemetryScope";
import { getInventoryTypeLabel } from "../../FeatureSet/Dashboard/src/Components/Inventory/InventoryTypeCatalog";
import {
  LockedEntityKeyDisplayMap,
  buildLockedEntityKeyChips,
} from "../../FeatureSet/Dashboard/src/Utils/LockedEntityKeyChips";
import {
  EntityKeyScopedRows,
  describeLockedEntityKeyFilter,
} from "../../FeatureSet/Dashboard/src/Utils/LockedTelemetryScope";

/*
 * How an Inventory item names the locked pill on its Logs / Traces / Metrics
 * / Exceptions / Profiles pages. Those pages filter by the item's entity key
 * — a 16-hex hash — so without this map the pill reads "Resource:
 * 3f9a1b2c4d5e6f70"; with it, "Kubernetes Pod: checkout-7d9f", the shape a
 * Kubernetes cluster's pages already use ("Cluster: prod").
 *
 * Every failure pinned here is silent: a dotted wire type ("k8s.pod")
 * leaking onto the pill, a blank name rendering as "Kubernetes Pod: ", or a
 * map keyed differently from the scope, which drops the pill back to the raw
 * hash with nothing crashing.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const OTHER_KEY: string = "aaaaaaaaaaaaaaaa";
const POD_NAME: string = "checkout-7d9f";

const ALL_ENTITY_TYPES: Array<EntityType> = Object.values(EntityType);

const CANNOT_TRAVEL: string =
  "This filter cannot be copied or carried to the explorer.";
const NO_SYNTAX: string = "Entity keys have no search syntax.";

type PillTextFunction = (chip: ActiveFilter) => string;

/** The pill as the chip bar prints it: `<displayKey>: <displayValue>`. */
const pillText: PillTextFunction = (chip: ActiveFilter): string => {
  return `${chip.displayKey}: ${chip.displayValue}`;
};

type OnlyChipFunction = (
  rows: EntityKeyScopedRows,
  entityKeys: Array<string>,
  displays: LockedEntityKeyDisplayMap | undefined,
) => ActiveFilter;

/*
 * The one chip a viewer scoped to a single key shows — which is what every
 * Inventory signal page renders.
 */
const onlyChip: OnlyChipFunction = (
  rows: EntityKeyScopedRows,
  entityKeys: Array<string>,
  displays: LockedEntityKeyDisplayMap | undefined,
): ActiveFilter => {
  const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
    rows,
    entityKeys,
    displays,
  });

  expect(chips).toHaveLength(1);

  return chips[0]!;
};

const POD_DISPLAYS: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
  {
    entityKey: POD_KEY,
    entityType: EntityType.KubernetesPod,
    displayName: POD_NAME,
  },
);

describe("buildInventoryEntityKeyDisplays", () => {
  test("the chip key for an item without a type", () => {
    expect(INVENTORY_ITEM_FALLBACK_DISPLAY_KEY).toBe("Inventory Item");
  });

  test("a Kubernetes pod is named by its type and its name, keyed by its entity key", () => {
    expect(POD_DISPLAYS).toStrictEqual({
      [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: POD_NAME },
    });
  });

  test("the catalog's words, spot-checked where the wire value reads worst", () => {
    const cases: Array<[EntityType, string]> = [
      [EntityType.KubernetesPod, "Kubernetes Pod"],
      [EntityType.KubernetesCluster, "Kubernetes Cluster"],
      [EntityType.Host, "Host"],
      [EntityType.ServiceInstance, "Service Instance"],
      [EntityType.RumApplication, "Browser Application"],
      [EntityType.VMwareVirtualMachine, "VMware Virtual Machine"],
      [EntityType.DockerSwarmTask, "Swarm Task"],
      [EntityType.ExternalDatabase, "External Database"],
    ];

    for (const [entityType, label] of cases) {
      expect(
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType,
          displayName: POD_NAME,
        }),
      ).toStrictEqual({
        [POD_KEY]: { displayKey: label, displayValue: POD_NAME },
      });
    }
  });

  test.each(ALL_ENTITY_TYPES)(
    "%s: the chip key is the catalog label, never the dotted wire value",
    (entityType: EntityType) => {
      const displays: LockedEntityKeyDisplayMap =
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType,
          displayName: POD_NAME,
        });

      expect(displays).toStrictEqual({
        [POD_KEY]: {
          displayKey: getInventoryTypeLabel(entityType),
          displayValue: POD_NAME,
        },
      });

      const displayKey: string = displays[POD_KEY]!.displayKey;

      expect(displayKey.length).toBeGreaterThan(0);
      expect(displayKey.trim()).toBe(displayKey);
      expect(displayKey).not.toBe(entityType);
      // A dot on the pill means the wire vocabulary leaked through.
      expect(displayKey).not.toContain(".");
      expect(displayKey).not.toBe(INVENTORY_ITEM_FALLBACK_DISPLAY_KEY);
    },
  );

  test("a type this build does not know renders as itself, trimmed", () => {
    /*
     * A dashboard running against a newer server can meet a type it has
     * never heard of; that has to name the pill rather than blank it.
     */
    for (const entityType of ["future.widget", "  future.widget \n"]) {
      expect(
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType,
          displayName: POD_NAME,
        }),
      ).toStrictEqual({
        [POD_KEY]: { displayKey: "future.widget", displayValue: POD_NAME },
      });
    }
  });

  test("a padded known type is trimmed before the catalog lookup", () => {
    expect(
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: "  k8s.pod\t",
        displayName: POD_NAME,
      }),
    ).toStrictEqual({
      [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: POD_NAME },
    });
  });

  test("a type named after an Object.prototype member renders as itself, never as a function's text", () => {
    for (const entityType of [
      "constructor",
      "toString",
      "valueOf",
      "hasOwnProperty",
      "__proto__",
    ]) {
      expect(
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType,
          displayName: POD_NAME,
        })[POD_KEY],
      ).toStrictEqual({ displayKey: entityType, displayValue: POD_NAME });
    }
  });

  test("a missing, blank or non-string type is named 'Inventory Item'", () => {
    for (const entityType of [
      undefined,
      "",
      "   ",
      42 as never,
      null as never,
      {} as never,
    ]) {
      expect(
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType,
          displayName: POD_NAME,
        }),
      ).toStrictEqual({
        [POD_KEY]: { displayKey: "Inventory Item", displayValue: POD_NAME },
      });
    }
  });

  test("the name is trimmed", () => {
    expect(
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: `  ${POD_NAME}\n`,
      }),
    ).toStrictEqual(POD_DISPLAYS);
  });

  test("a missing, blank or non-string name falls back to the entity key — never a bare 'Kubernetes Pod: '", () => {
    for (const displayName of [
      undefined,
      "",
      " \t ",
      null as never,
      7 as never,
    ]) {
      expect(
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType: EntityType.KubernetesPod,
          displayName,
        }),
      ).toStrictEqual({
        [POD_KEY]: { displayKey: "Kubernetes Pod", displayValue: POD_KEY },
      });
    }
  });

  test("no entity key, no map — whatever else the item carries", () => {
    for (const entityKey of [
      undefined,
      "",
      "   ",
      42 as never,
      null as never,
    ]) {
      const displays: LockedEntityKeyDisplayMap =
        buildInventoryEntityKeyDisplays({
          entityKey,
          entityType: EntityType.KubernetesPod,
          displayName: POD_NAME,
        });

      expect(displays).toStrictEqual({});
      expect(Object.keys(displays)).toEqual([]);
    }

    expect(buildInventoryEntityKeyDisplays({})).toStrictEqual({});
  });

  test("the map is keyed by the TRIMMED key and holds that one own entry only", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: ` ${POD_KEY}\n`,
        entityType: EntityType.Host,
      },
    );

    expect(Object.keys(displays)).toEqual([POD_KEY]);
    expect(displays).toStrictEqual({
      [POD_KEY]: { displayKey: "Host", displayValue: POD_KEY },
    });
    expect(Object.getPrototypeOf(displays)).toBe(Object.prototype);
  });

  test("an entity key of __proto__ becomes an own entry the chip builder can read, not a prototype swap", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: "__proto__",
        entityType: EntityType.KubernetesPod,
        displayName: POD_NAME,
      },
    );

    expect(Object.keys(displays)).toEqual(["__proto__"]);
    expect(Object.prototype.hasOwnProperty.call(displays, "__proto__")).toBe(
      true,
    );
    expect(Object.getPrototypeOf(displays)).toBe(Object.prototype);
    expect(pillText(onlyChip("logs", ["__proto__"], displays))).toBe(
      "Kubernetes Pod: checkout-7d9f",
    );
  });

  test("every call builds a fresh map, and the item is only read", () => {
    const item: Readonly<{
      entityKey: string;
      entityType: EntityType;
      displayName: string;
    }> = Object.freeze({
      entityKey: POD_KEY,
      entityType: EntityType.KubernetesPod,
      displayName: POD_NAME,
    });

    const first: LockedEntityKeyDisplayMap =
      buildInventoryEntityKeyDisplays(item);
    const second: LockedEntityKeyDisplayMap =
      buildInventoryEntityKeyDisplays(item);

    expect(first).not.toBe(second);
    expect(first[POD_KEY]).not.toBe(second[POD_KEY]);

    first[POD_KEY]!.displayValue = "mutated";

    expect(second[POD_KEY]!.displayValue).toBe(POD_NAME);
    expect(item.displayName).toBe(POD_NAME);
  });
});

describe("the Inventory item's pill, end to end", () => {
  test("a Kubernetes pod's Logs page: 'Kubernetes Pod: checkout-7d9f', read-only, explained, no search token", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS,
    });

    // The explanation's wording is owned by LockedTelemetryScope.test.ts.
    expect(chips).toStrictEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail: describeLockedEntityKeyFilter({
          rows: "logs",
          entityKey: POD_KEY,
          entityKeys: [POD_KEY],
          entityTypeLabel: "Kubernetes Pod",
        }),
      },
    ]);
    expect(chips[0]!.lockedDetail?.summary).toBe(
      "Only logs linked to this Kubernetes Pod are shown.",
    );
    expect(chips[0]!.lockedDetail?.searchTokenUnavailableReason).toBe(
      CANNOT_TRAVEL,
    );
  });

  const SURFACES: Array<[EntityKeyScopedRows, string, string]> = [
    [
      "logs",
      "Only logs linked to this Kubernetes Pod are shown.",
      CANNOT_TRAVEL,
    ],
    [
      "traces",
      "Only traces linked to this Kubernetes Pod are shown.",
      CANNOT_TRAVEL,
    ],
    [
      "metrics",
      "Only metrics linked to this Kubernetes Pod are shown.",
      CANNOT_TRAVEL,
    ],
    [
      "exceptions",
      "Only exceptions linked to this Kubernetes Pod are shown.",
      NO_SYNTAX,
    ],
    [
      "profiles",
      "Only profiles linked to this Kubernetes Pod are shown.",
      NO_SYNTAX,
    ],
  ];

  test.each(SURFACES)(
    "%s: the same pill, explained in that surface's words",
    (rows: EntityKeyScopedRows, summary: string, reason: string) => {
      const chip: ActiveFilter = onlyChip(rows, [POD_KEY], POD_DISPLAYS);

      expect(pillText(chip)).toBe("Kubernetes Pod: checkout-7d9f");
      expect(chip.readOnly).toBe(true);
      expect(chip.facetKey).toBe("entityKeys");
      expect(chip.value).toBe(POD_KEY);
      expect(chip.lockedDetail?.summary).toBe(summary);
      expect(chip.lockedDetail?.searchTokenUnavailableReason).toBe(reason);
      expect(chip.lockedDetail?.searchToken).toBeUndefined();
    },
  );

  test.each(ALL_ENTITY_TYPES)(
    "%s: the pill and its summary both use the catalog label",
    (entityType: EntityType) => {
      const label: string = getInventoryTypeLabel(entityType);
      const chip: ActiveFilter = onlyChip(
        "traces",
        [POD_KEY],
        buildInventoryEntityKeyDisplays({
          entityKey: POD_KEY,
          entityType,
          displayName: POD_NAME,
        }),
      );

      expect(pillText(chip)).toBe(`${label}: ${POD_NAME}`);
      expect(chip.lockedDetail?.summary).toBe(
        `Only traces linked to this ${label} are shown.`,
      );
    },
  );

  test("an item with no name shows its key as the value", () => {
    const chip: ActiveFilter = onlyChip(
      "metrics",
      [POD_KEY],
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
      }),
    );

    expect(pillText(chip)).toBe("Kubernetes Pod: 3f9a1b2c4d5e6f70");
    expect(chip.lockedDetail?.summary).toBe(
      "Only metrics linked to this Kubernetes Pod are shown.",
    );
  });

  test("an item with no type is an 'Inventory Item'", () => {
    const chip: ActiveFilter = onlyChip(
      "logs",
      [POD_KEY],
      buildInventoryEntityKeyDisplays({
        entityKey: POD_KEY,
        displayName: POD_NAME,
      }),
    );

    expect(pillText(chip)).toBe("Inventory Item: checkout-7d9f");
    expect(chip.lockedDetail?.summary).toBe(
      "Only logs linked to this Inventory Item are shown.",
    );
  });

  test("an item with neither a type nor a name", () => {
    const chip: ActiveFilter = onlyChip(
      "exceptions",
      [POD_KEY],
      buildInventoryEntityKeyDisplays({ entityKey: POD_KEY }),
    );

    expect(pillText(chip)).toBe("Inventory Item: 3f9a1b2c4d5e6f70");
    expect(chip.lockedDetail?.summary).toBe(
      "Only exceptions linked to this Inventory Item are shown.",
    );
  });

  test("without the map — or with an empty one — the scoped viewer STILL shows the pill, on its fallback", () => {
    /*
     * A filtered list under an empty chip bar is the bug this pill fixes, so
     * losing the name must never lose the pill.
     */
    for (const displays of [
      undefined,
      {},
      buildInventoryEntityKeyDisplays({ entityKey: undefined }),
    ]) {
      const chip: ActiveFilter = onlyChip("logs", [POD_KEY], displays);

      expect(pillText(chip)).toBe("Resource: 3f9a1b2c4d5e6f70");
      expect(chip.lockedDetail?.summary).toBe(
        "Only logs linked to this resource are shown.",
      );
    }
  });

  test("a map built for one item never names another item's key", () => {
    const chip: ActiveFilter = onlyChip("profiles", [OTHER_KEY], POD_DISPLAYS);

    expect(pillText(chip)).toBe("Resource: aaaaaaaaaaaaaaaa");
    expect(chip.lockedDetail?.summary).toBe(
      "Only profiles linked to this resource are shown.",
    );
  });

  test("a padded key on either side still finds its name", () => {
    const chip: ActiveFilter = onlyChip(
      "traces",
      [`${POD_KEY}  `],
      buildInventoryEntityKeyDisplays({
        entityKey: ` ${POD_KEY}`,
        entityType: EntityType.KubernetesPod,
        displayName: POD_NAME,
      }),
    );

    expect(pillText(chip)).toBe("Kubernetes Pod: checkout-7d9f");
    expect(chip.value).toBe(POD_KEY);
  });

  test("the name is display only: the facet and value — what a query or an explorer link reads — are the key", () => {
    const chip: ActiveFilter = onlyChip("logs", [POD_KEY], POD_DISPLAYS);

    expect(chip.facetKey).toBe("entityKeys");
    expect(chip.value).toBe(POD_KEY);
    expect(JSON.stringify([chip.facetKey, chip.value])).not.toContain(POD_NAME);
    expect(JSON.stringify([chip.facetKey, chip.value])).not.toContain(
      "Kubernetes",
    );
  });
});
