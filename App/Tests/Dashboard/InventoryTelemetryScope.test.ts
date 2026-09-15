import { describe, expect, test } from "@jest/globals";
import EntityType from "Common/Types/Telemetry/EntityType";
import type { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
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
  ENTITY_KEY_NO_ATTRIBUTES_REASON,
  ENTITY_KEY_NO_SYNTAX_REASON,
  EntityKeyScopedRows,
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
 *
 * Which identifying attributes become the pill's search syntax is pinned in
 * InventoryEntitySearchSyntax.test.ts. Apart from the two tests that hand
 * them over, the pills here are built without them, so each carries no
 * search token: on the Logs / Traces / Metrics pages its tooltip says the
 * item has no attributes to search by, and on Exceptions / Profiles — lists
 * with no search bar — that entity keys have no search syntax.
 */

const POD_KEY: string = "3f9a1b2c4d5e6f70";
const OTHER_KEY: string = "aaaaaaaaaaaaaaaa";
const POD_NAME: string = "checkout-7d9f";

const ALL_ENTITY_TYPES: Array<EntityType> = Object.values(EntityType);

const NO_ATTRIBUTES: string = ENTITY_KEY_NO_ATTRIBUTES_REASON;
const NO_SYNTAX: string = ENTITY_KEY_NO_SYNTAX_REASON;

type PillTextFunction = (chip: ActiveFilter) => string;

/** The pill as the chip bar prints it: `<displayKey>: <displayValue>`. */
const pillText: PillTextFunction = (chip: ActiveFilter): string => {
  return `${chip.displayKey}: ${chip.displayValue}`;
};

type ExpectNoSearchSyntaxFunction = (
  chip: ActiveFilter,
  reason: string,
) => void;

/*
 * The chip's tooltip content, exactly: no search token, only the reason
 * there is none.
 */
const expectNoSearchSyntax: ExpectNoSearchSyntaxFunction = (
  chip: ActiveFilter,
  reason: string,
): void => {
  const expected: LockedFilterDetail = { searchTokenUnavailableReason: reason };

  expect(chip.lockedDetail).toStrictEqual(expected);
  expect(chip.lockedDetail?.searchToken).toBeUndefined();
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

    const chip: ActiveFilter = onlyChip("logs", ["__proto__"], displays);

    expect(pillText(chip)).toBe("Kubernetes Pod: checkout-7d9f");
    expectNoSearchSyntax(chip, NO_ATTRIBUTES);
  });

  test("identifying attributes ride along as the display's search attributes, leaving the pill's words alone", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: POD_NAME,
        identifyingAttributes: {
          "k8s.cluster.name": "prod",
          "k8s.namespace.name": "shop",
          "k8s.pod.name": POD_NAME,
        },
      },
    );

    expect(displays).toStrictEqual({
      [POD_KEY]: {
        displayKey: "Kubernetes Pod",
        displayValue: POD_NAME,
        searchAttributes: {
          "k8s.cluster.name": "prod",
          "k8s.namespace.name": "shop",
          "k8s.pod.name": POD_NAME,
        },
      },
    });

    /*
     * They reach the pill only as its search syntax: the same words, now with
     * a token on a surface that has a search bar, and still none on one
     * without.
     */
    const logsChip: ActiveFilter = onlyChip("logs", [POD_KEY], displays);

    expect(pillText(logsChip)).toBe("Kubernetes Pod: checkout-7d9f");
    expect(logsChip.lockedDetail).toStrictEqual({
      searchToken:
        "@resource.k8s.cluster.name:prod @resource.k8s.namespace.name:shop @resource.k8s.pod.name:checkout-7d9f",
    });
    expect(logsChip.lockedDetail?.searchTokenUnavailableReason).toBeUndefined();

    const exceptionsChip: ActiveFilter = onlyChip(
      "exceptions",
      [POD_KEY],
      displays,
    );

    expect(pillText(exceptionsChip)).toBe("Kubernetes Pod: checkout-7d9f");
    expectNoSearchSyntax(exceptionsChip, NO_SYNTAX);

    // Without them the entry holds the pill's two strings and nothing else.
    expect(Object.keys(POD_DISPLAYS[POD_KEY]!).sort()).toEqual([
      "displayKey",
      "displayValue",
    ]);
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
  test("a Kubernetes pod's Logs page without identifying attributes: 'Kubernetes Pod: checkout-7d9f', read-only, no search token, the no-attributes reason", () => {
    const chips: Array<ActiveFilter> = buildLockedEntityKeyChips({
      rows: "logs",
      entityKeys: [POD_KEY],
      displays: POD_DISPLAYS,
    });

    const lockedDetail: LockedFilterDetail = {
      searchTokenUnavailableReason: NO_ATTRIBUTES,
    };

    expect(chips).toStrictEqual([
      {
        facetKey: "entityKeys",
        value: POD_KEY,
        displayKey: "Kubernetes Pod",
        displayValue: "checkout-7d9f",
        readOnly: true,
        lockedDetail,
      },
    ]);
  });

  /*
   * Every surface gets the same pill; only the reason it has no search syntax
   * differs — the three explorers lack the item's attributes, while the
   * exceptions and profiles lists have no search bar at all.
   */
  const SURFACES: Array<[EntityKeyScopedRows, string]> = [
    ["logs", NO_ATTRIBUTES],
    ["traces", NO_ATTRIBUTES],
    ["metrics", NO_ATTRIBUTES],
    ["exceptions", NO_SYNTAX],
    ["profiles", NO_SYNTAX],
  ];

  test.each(SURFACES)(
    "%s: the same pill, with that surface's reason for having no search syntax",
    (rows: EntityKeyScopedRows, reason: string) => {
      const chip: ActiveFilter = onlyChip(rows, [POD_KEY], POD_DISPLAYS);

      expect(pillText(chip)).toBe("Kubernetes Pod: checkout-7d9f");
      expect(chip.readOnly).toBe(true);
      expect(chip.facetKey).toBe("entityKeys");
      expect(chip.value).toBe(POD_KEY);
      expectNoSearchSyntax(chip, reason);
    },
  );

  test.each(ALL_ENTITY_TYPES)(
    "%s: the pill uses the catalog label, and the type never changes its search syntax",
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
      expectNoSearchSyntax(chip, NO_ATTRIBUTES);
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
    expectNoSearchSyntax(chip, NO_ATTRIBUTES);
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
    expectNoSearchSyntax(chip, NO_ATTRIBUTES);
  });

  test("an item with neither a type nor a name", () => {
    const chip: ActiveFilter = onlyChip(
      "exceptions",
      [POD_KEY],
      buildInventoryEntityKeyDisplays({ entityKey: POD_KEY }),
    );

    expect(pillText(chip)).toBe("Inventory Item: 3f9a1b2c4d5e6f70");
    expectNoSearchSyntax(chip, NO_SYNTAX);
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
      expectNoSearchSyntax(chip, NO_ATTRIBUTES);
    }
  });

  test("a map built for one item never names another item's key", () => {
    const chip: ActiveFilter = onlyChip("profiles", [OTHER_KEY], POD_DISPLAYS);

    expect(pillText(chip)).toBe("Resource: aaaaaaaaaaaaaaaa");
    expectNoSearchSyntax(chip, NO_SYNTAX);
  });

  test("a map built for one item never lends its attributes' search syntax to another item's key", () => {
    const displays: LockedEntityKeyDisplayMap = buildInventoryEntityKeyDisplays(
      {
        entityKey: POD_KEY,
        entityType: EntityType.KubernetesPod,
        displayName: POD_NAME,
        identifyingAttributes: { "k8s.pod.name": POD_NAME },
      },
    );

    // The item's own key does carry the syntax, so the map is not empty-handed.
    expect(onlyChip("logs", [POD_KEY], displays).lockedDetail).toStrictEqual({
      searchToken: "@resource.k8s.pod.name:checkout-7d9f",
    });

    const chip: ActiveFilter = onlyChip("logs", [OTHER_KEY], displays);

    expect(pillText(chip)).toBe("Resource: aaaaaaaaaaaaaaaa");
    expectNoSearchSyntax(chip, NO_ATTRIBUTES);
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
    expectNoSearchSyntax(chip, NO_ATTRIBUTES);
  });

  test("the name is display only: the facet and value — what the query reads — are the key", () => {
    const chip: ActiveFilter = onlyChip("logs", [POD_KEY], POD_DISPLAYS);

    expect(chip.facetKey).toBe("entityKeys");
    expect(chip.value).toBe(POD_KEY);
    expectNoSearchSyntax(chip, NO_ATTRIBUTES);
    expect(JSON.stringify([chip.facetKey, chip.value])).not.toContain(POD_NAME);
    expect(JSON.stringify([chip.facetKey, chip.value])).not.toContain(
      "Kubernetes",
    );
  });
});
