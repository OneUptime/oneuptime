import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import {
  buildInventoryEntityModel,
  compactAttributes,
  ErasedInventorySource,
  INVENTORY_SOURCES,
  inventoryEntityNeedsUpdate,
  InventoryRowProjection,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Dictionary from "../../../../Types/Dictionary";
import ObjectID from "../../../../Types/ObjectID";
import EntitySource from "../../../../Types/Telemetry/EntitySource";
import EntityType from "../../../../Types/Telemetry/EntityType";
import { INVENTORY_ENTITY_TYPES } from "../../../../Types/Telemetry/EntityTypeGroups";
import { keyForInventoryEntity } from "../../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";

/*
 * The pure half of the inventory mirror — the mapping from an inventory row
 * to its registry row, and the drift check that decides whether to write.
 *
 * Worth testing closely for two reasons. A mistake in the mapping mints a
 * duplicate entity that looks entirely correct, and a mistake in the drift
 * check either writes on every reconcile (seven table scans' worth of
 * needless UPDATEs every fifteen minutes) or never writes at all (renames
 * never propagate).
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "6f2e5c1a-0b3d-4e5f-8a9b-1c2d3e4f5a6b",
);
const NOW: Date = new Date("2026-03-04T05:06:07.000Z");

function projection(
  overrides: Partial<InventoryRowProjection> = {},
): InventoryRowProjection {
  return {
    id: RESOURCE_ID,
    projectId: PROJECT_ID,
    displayName: "core-switch-1",
    descriptiveAttributes: { "net.device.hostname": "core-switch-1.dc1" },
    ...overrides,
  };
}

const NETWORK_SOURCE: Pick<
  ErasedInventorySource,
  "entityType" | "resourceType"
> = {
  entityType: EntityType.NetworkDevice,
  resourceType: "NetworkDevice",
};

describe("compactAttributes", () => {
  test("keeps ordinary values", () => {
    expect(compactAttributes({ a: "1", b: "two" })).toEqual({
      a: "1",
      b: "two",
    });
  });

  test("drops undefined, null, empty and whitespace-only values", () => {
    const out: Dictionary<string> = compactAttributes({
      keep: "yes",
      undef: undefined,
      nul: null,
      empty: "",
      blank: "   ",
    });

    expect(out).toEqual({ keep: "yes" });
  });

  test("trims surviving values", () => {
    expect(compactAttributes({ a: "  spaced  " })).toEqual({ a: "spaced" });
  });

  test("returns an empty object when everything is dropped", () => {
    expect(compactAttributes({ a: undefined, b: "" })).toEqual({});
  });
});

describe("buildInventoryEntityModel", () => {
  test("marks the row as inventory-sourced", () => {
    const model: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });

    /*
     * The single most important assertion in this file: PruneStaleEntities
     * exempts rows by source, so a mirror that came out marked `discovered`
     * would be deleted the first time the sweep ran past its TTL.
     */
    expect(model.source).toBe(EntitySource.Inventory);
  });

  test("derives the key from the owning row id, matching keyForInventoryEntity", () => {
    const model: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });

    expect(model.entityKey).toBe(
      keyForInventoryEntity(
        PROJECT_ID.toString(),
        EntityType.NetworkDevice,
        RESOURCE_ID.toString(),
      ),
    );
  });

  test("a rename does not change identity", () => {
    const before: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection({ displayName: "core-switch-1" }),
      now: NOW,
    });
    const after: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection({ displayName: "core-switch-1-renamed" }),
      now: NOW,
    });

    expect(after.entityKey).toBe(before.entityKey);
    expect(after.displayName).not.toBe(before.displayName);
  });

  test("populates the polymorphic pointer back to the owning row", () => {
    const model: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });

    expect(model.resourceType).toBe("NetworkDevice");
    expect(model.resourceId?.toString()).toBe(RESOURCE_ID.toString());
  });

  test("carries project, type, attributes and timestamps through", () => {
    const model: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });

    expect(model.projectId?.toString()).toBe(PROJECT_ID.toString());
    expect(model.entityType).toBe(EntityType.NetworkDevice);
    expect(model.descriptiveAttributes).toEqual({
      "net.device.hostname": "core-switch-1.dc1",
    });
    expect(model.firstSeenAt).toEqual(NOW);
    expect(model.lastSeenAt).toEqual(NOW);
  });

  test("records the owning row id as the identifying attribute", () => {
    const model: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });

    expect(model.identifyingAttributes).toEqual({
      "oneuptime.resource.id": RESOURCE_ID.toString(),
    });
  });

  test("clamps displayName to the column width", () => {
    /*
     * displayName is a bounded varchar; an over-long name would otherwise
     * fail the INSERT with a 22001 and lose the row entirely.
     */
    const model: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection({ displayName: "n".repeat(ColumnLength.ShortText + 50) }),
      now: NOW,
    });

    expect(model.displayName!.length).toBe(ColumnLength.ShortText);
  });

  test("distinct rows of one type produce distinct keys", () => {
    const first: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });
    const second: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection({
        id: new ObjectID("11111111-2222-3333-4444-555555555555"),
      }),
      now: NOW,
    });

    expect(first.entityKey).not.toBe(second.entityKey);
  });

  test("the same row id under two types produces distinct keys", () => {
    const asDevice: InventoryItem = buildInventoryEntityModel({
      source: NETWORK_SOURCE,
      row: projection(),
      now: NOW,
    });
    const asIoT: InventoryItem = buildInventoryEntityModel({
      source: { entityType: EntityType.IoTDevice, resourceType: "IoTDevice" },
      row: projection(),
      now: NOW,
    });

    expect(asDevice.entityKey).not.toBe(asIoT.entityKey);
  });
});

describe("inventoryEntityNeedsUpdate", () => {
  function pair(existingOverrides: Partial<InventoryRowProjection>): {
    existing: InventoryItem;
    desired: InventoryItem;
  } {
    return {
      existing: buildInventoryEntityModel({
        source: NETWORK_SOURCE,
        row: projection(existingOverrides),
        now: NOW,
      }),
      desired: buildInventoryEntityModel({
        source: NETWORK_SOURCE,
        row: projection(),
        now: NOW,
      }),
    };
  }

  test("false in the steady state, so a quiet reconcile writes nothing", () => {
    const { existing, desired } = pair({});
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(false);
  });

  test("true when the row was renamed", () => {
    const { existing, desired } = pair({ displayName: "old-name" });
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(true);
  });

  test("true when descriptive attributes changed", () => {
    const { existing, desired } = pair({
      descriptiveAttributes: { "net.device.hostname": "old-host" },
    });
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(true);
  });

  test("true when an attribute was added", () => {
    const { existing, desired } = pair({ descriptiveAttributes: {} });
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(true);
  });

  test("true when the polymorphic pointer is missing", () => {
    const { existing, desired } = pair({});
    // Deleted rather than assigned undefined: exactOptionalPropertyTypes.
    delete (existing as { resourceId?: ObjectID }).resourceId;
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(true);
  });

  test("true when the pointer type is wrong", () => {
    const { existing, desired } = pair({});
    existing.resourceType = "SomethingElse";
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(true);
  });

  test("ignores lastSeenAt, which never advances for mirrored rows", () => {
    const { existing, desired } = pair({});
    existing.lastSeenAt = new Date("2020-01-01T00:00:00.000Z");
    expect(inventoryEntityNeedsUpdate({ existing, desired })).toBe(false);
  });
});

describe("INVENTORY_SOURCES", () => {
  test("covers exactly the declared inventory entity types", () => {
    const covered: Array<EntityType> = INVENTORY_SOURCES.map(
      (source: ErasedInventorySource) => {
        return source.entityType;
      },
    );

    expect(covered.sort()).toEqual(Array.from(INVENTORY_ENTITY_TYPES).sort());
  });

  test("registers each entity type exactly once", () => {
    const seen: Set<EntityType> = new Set<EntityType>();

    for (const source of INVENTORY_SOURCES) {
      expect(seen.has(source.entityType)).toBe(false);
      seen.add(source.entityType);
    }
  });

  test("registers each resourceType exactly once", () => {
    const seen: Set<string> = new Set<string>();

    for (const source of INVENTORY_SOURCES) {
      expect(seen.has(source.resourceType)).toBe(false);
      seen.add(source.resourceType);
    }
  });

  test("every source names a non-empty resourceType", () => {
    for (const source of INVENTORY_SOURCES) {
      expect(source.resourceType.length).toBeGreaterThan(0);
    }
  });

  test("no source mirrors a manually creatable type", () => {
    for (const source of INVENTORY_SOURCES) {
      expect(INVENTORY_ENTITY_TYPES.has(source.entityType)).toBe(true);
    }
  });
});
