import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import IoTDevice from "../../../../Models/DatabaseModels/IoTDevice";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import RumApplication from "../../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import CloudResourceService from "../../../../Server/Services/CloudResourceService";
import DockerHostService from "../../../../Server/Services/DockerHostService";
import IoTDeviceService from "../../../../Server/Services/IoTDeviceService";
import NetworkDeviceService from "../../../../Server/Services/NetworkDeviceService";
import PodmanHostService from "../../../../Server/Services/PodmanHostService";
import RumApplicationService from "../../../../Server/Services/RumApplicationService";
import ServerlessFunctionService from "../../../../Server/Services/ServerlessFunctionService";
import {
  buildInventoryEntityModel,
  compactAttributes,
  ErasedInventorySource,
  hasCustomFieldValues,
  INVENTORY_SOURCES,
  inventoryEntityNeedsUpdate,
  InventoryRowProjection,
  OrphanPartition,
  partitionOrphanRows,
} from "../../../../Server/Utils/Telemetry/InventoryEntityRegistry";
import ColumnLength from "../../../../Types/Database/ColumnLength";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject } from "../../../../Types/JSON";
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

/*
 * Everything below covers the destructive half of the reconcile.
 *
 * The mapping tested above is worth getting right; this half is worth getting
 * right at a different order of magnitude. A mistake in `buildInventoryEntityModel`
 * shows up as an entity that looks wrong and can be fixed by fixing the code and
 * waiting fifteen minutes. A mistake here hard-deletes rows through
 * `hardDeleteBy`, which bypasses the audit hook — so the serial numbers, warranty
 * dates and owning-team names a person typed into the custom fields of a mirrored
 * row are gone with no undo and no record that they ever existed. Both functions
 * are pure and exported precisely so this can be pinned down without a database.
 */

const LIVE_RESOURCE_ID: ObjectID = new ObjectID(
  "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
);
const DEAD_RESOURCE_ID: ObjectID = new ObjectID(
  "9f8e7d6c-5b4a-4392-8180-7f6e5d4c3b2a",
);
const ROW_ID_ONE: ObjectID = new ObjectID(
  "2c1d0e9f-8a7b-4c6d-9e5f-0a1b2c3d4e5f",
);
const ROW_ID_TWO: ObjectID = new ObjectID(
  "3d2e1f0a-9b8c-4d7e-8f6a-1b2c3d4e5f60",
);
const ROW_ID_THREE: ObjectID = new ObjectID(
  "4e3f2a1b-0c9d-4e8f-9a7b-2c3d4e5f6071",
);
const ROW_ID_FOUR: ObjectID = new ObjectID(
  "5f4a3b2c-1d0e-4f9a-8b6c-3d4e5f607182",
);

/**
 * A registry row as the reverse pass actually reads it: only `_id`,
 * `resourceId`, `customFields` and `isArchived` are selected, so only those are
 * populated here. Keys are assigned rather than set to undefined because
 * `exactOptionalPropertyTypes` distinguishes the two, and so does the code under
 * test — an absent `customFields` is a different shape from a present empty one.
 */
function registryRow(
  overrides: {
    id?: ObjectID;
    resourceId?: ObjectID;
    customFields?: JSONObject;
    isArchived?: boolean;
  } = {},
): InventoryItem {
  const row: InventoryItem = new InventoryItem();

  if (overrides.id !== undefined) {
    row.id = overrides.id;
  }

  if (overrides.resourceId !== undefined) {
    row.resourceId = overrides.resourceId;
  }

  if (overrides.customFields !== undefined) {
    row.customFields = overrides.customFields;
  }

  if (overrides.isArchived !== undefined) {
    row.isArchived = overrides.isArchived;
  }

  return row;
}

function idStrings(ids: Array<ObjectID>): Array<string> {
  return ids.map((id: ObjectID) => {
    return id.toString();
  });
}

describe("hasCustomFieldValues", () => {
  test("false when the bag was never populated", () => {
    /*
     * The overwhelmingly common case: nobody has ever opened the custom fields
     * editor on this row, so it is a pure projection and safe to delete.
     */
    expect(hasCustomFieldValues(registryRow())).toBe(false);
  });

  test("false when the bag is explicitly null", () => {
    // Postgres hands back SQL NULL for a jsonb column that was never written.
    const row: InventoryItem = registryRow();
    (row as unknown as { customFields: unknown }).customFields = null;

    expect(hasCustomFieldValues(row)).toBe(false);
  });

  test("false when the stored value is not an object at all", () => {
    /*
     * Defensive: a jsonb column can legally hold a bare scalar. Object.keys on a
     * string would enumerate its character indices and report every row with a
     * corrupted bag as worth keeping forever, which quietly turns the delete pass
     * into a no-op.
     */
    const row: InventoryItem = registryRow();
    (row as unknown as { customFields: unknown }).customFields =
      "not-an-object";

    expect(hasCustomFieldValues(row)).toBe(false);
  });

  test("false for an empty bag", () => {
    /*
     * The UI writes `{}` rather than deleting the column when the last value is
     * cleared, so an empty bag is the fingerprint of "someone looked and then
     * changed their mind" — not of data worth preserving.
     */
    expect(hasCustomFieldValues(registryRow({ customFields: {} }))).toBe(false);
  });

  test("false when every value is null, undefined, empty string or empty array", () => {
    /*
     * Same story one level down: clearing a field leaves the key behind with an
     * empty value. A key-count check would keep these rows alive forever and the
     * registry would accumulate projections of devices that no longer exist.
     */
    const row: InventoryItem = registryRow({
      customFields: {
        "Serial Number": "",
        "Warranty Expires": null,
        "Owning Team": undefined,
        Tags: [],
      },
    });

    expect(hasCustomFieldValues(row)).toBe(false);
  });

  test("true when one real value survives among the emptied ones", () => {
    const row: InventoryItem = registryRow({
      customFields: {
        "Serial Number": "FTX1840ABCD",
        "Warranty Expires": "",
        Tags: [],
      },
    });

    expect(hasCustomFieldValues(row)).toBe(true);
  });

  test("true for a stored `false`", () => {
    /*
     * The classic bug this guards against: a truthiness test (`if (value)`) reads
     * `false` as absence, so a Boolean custom field answered "no" — the device is
     * NOT under warranty — would be counted as an empty bag and the row would be
     * routed to the hard delete. `false` is an answer somebody gave.
     */
    expect(
      hasCustomFieldValues(
        registryRow({ customFields: { "Under Warranty": false } }),
      ),
    ).toBe(true);
  });

  test("true for a stored `0`", () => {
    // Same trap as `false`: zero spare ports is a measurement, not a blank field.
    expect(
      hasCustomFieldValues(registryRow({ customFields: { "Spare Ports": 0 } })),
    ).toBe(true);
  });

  test("true for an array with entries", () => {
    /*
     * MultiSelectDropdown fields store arrays. Only the EMPTY array counts as
     * absence — a populated one is exactly as much user work as a typed string.
     */
    expect(
      hasCustomFieldValues(
        registryRow({ customFields: { Tags: ["dc1", "rack-4"] } }),
      ),
    ).toBe(true);
  });
});

describe("partitionOrphanRows", () => {
  test("a row whose owning resource still exists is neither deleted nor archived", () => {
    /*
     * The steady state, and by far the most common one. A live row must fall out
     * of both lists entirely: putting it in `archivableIds` would hide every
     * mirrored device from the explorer on the next sweep.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [registryRow({ id: ROW_ID_ONE, resourceId: LIVE_RESOURCE_ID })],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    expect(partition.deletableIds).toEqual([]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("a live row carrying custom fields is still left alone", () => {
    // Custom fields must not be a reason to touch a row that is not an orphan.
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({
          id: ROW_ID_ONE,
          resourceId: LIVE_RESOURCE_ID,
          customFields: { "Serial Number": "FTX1840ABCD" },
        }),
      ],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    expect(partition.deletableIds).toEqual([]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("an orphan with no custom fields is deletable", () => {
    /*
     * Nothing on this row was authored by a person — every column is rewritten
     * from the owning table on each pass — so with the owning row gone there is
     * literally nothing left to keep.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [registryRow({ id: ROW_ID_ONE, resourceId: DEAD_RESOURCE_ID })],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    expect(idStrings(partition.deletableIds)).toEqual([ROW_ID_ONE.toString()]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("an orphan carrying custom fields is archived, never deleted", () => {
    /*
     * The data-loss guard, and the reason this function exists at all. Those
     * custom field values live on the registry row and nowhere else, so hard
     * -deleting this row destroys the only copy of the user's serial numbers and
     * warranty dates — with no audit trail, because `hardDeleteBy` bypasses the
     * audit hook, and no undo. Archiving produces the same visible outcome (the
     * row leaves the default list) and leaves the data recoverable.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({
          id: ROW_ID_ONE,
          resourceId: DEAD_RESOURCE_ID,
          customFields: { "Serial Number": "FTX1840ABCD" },
        }),
      ],
      liveResourceIds: new Set<string>(),
    });

    expect(idStrings(partition.archivableIds)).toEqual([ROW_ID_ONE.toString()]);
    expect(partition.deletableIds).toEqual([]);
  });

  test("an orphan that is already archived is skipped entirely", () => {
    /*
     * The sweep runs every fifteen minutes and this row will be an orphan on
     * every one of them. Re-archiving would rewrite `archivedAt` each time, so
     * the timestamp would report the last sweep rather than when the device
     * actually went away — which is the only thing that column is good for.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({
          id: ROW_ID_ONE,
          resourceId: DEAD_RESOURCE_ID,
          customFields: { "Serial Number": "FTX1840ABCD" },
          isArchived: true,
        }),
      ],
      liveResourceIds: new Set<string>(),
    });

    expect(partition.deletableIds).toEqual([]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("an already-archived orphan with no custom fields is still deletable", () => {
    /*
     * The archive flag only shields rows that hold something. An empty
     * projection that was archived by hand is still an empty projection, and
     * leaving it behind would let the registry grow without bound.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({
          id: ROW_ID_ONE,
          resourceId: DEAD_RESOURCE_ID,
          isArchived: true,
        }),
      ],
      liveResourceIds: new Set<string>(),
    });

    expect(idStrings(partition.deletableIds)).toEqual([ROW_ID_ONE.toString()]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("a row with no resourceId at all is an orphan by definition", () => {
    /*
     * Without a pointer there is nothing to match against the owning table, so
     * the row can never be proven live. Treating it as live instead would leave
     * pre-pointer rows in the registry permanently.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [registryRow({ id: ROW_ID_ONE })],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    expect(idStrings(partition.deletableIds)).toEqual([ROW_ID_ONE.toString()]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("a pointerless row carrying custom fields is archived, not deleted", () => {
    // The data-loss guard has to win over the pointerless-means-orphan rule too.
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({
          id: ROW_ID_ONE,
          customFields: { "Owning Team": "Network Engineering" },
        }),
      ],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    expect(idStrings(partition.archivableIds)).toEqual([ROW_ID_ONE.toString()]);
    expect(partition.deletableIds).toEqual([]);
  });

  test("a row with no id is skipped rather than emitted as a null target", () => {
    /*
     * Should not happen — `_id` is always selected — but an undefined slipping
     * into the id list would become a `WHERE _id IN (NULL)` and, depending on how
     * the query builder folds it, either a no-op or something much worse.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({
          resourceId: DEAD_RESOURCE_ID,
          customFields: { "Serial Number": "FTX1840ABCD" },
        }),
        registryRow({ resourceId: DEAD_RESOURCE_ID }),
      ],
      liveResourceIds: new Set<string>(),
    });

    expect(partition.deletableIds).toEqual([]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("a mixed page splits correctly and the two lists are disjoint", () => {
    /*
     * The realistic shape of one page: a live row, two orphans that differ only
     * in whether anyone typed anything, and one orphan already archived. Nothing
     * may appear in both lists — the reverse pass runs the delete and the update
     * as two separate statements, so an id in both would be deleted and then
     * "archived" into nothing.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({ id: ROW_ID_ONE, resourceId: LIVE_RESOURCE_ID }),
        registryRow({ id: ROW_ID_TWO, resourceId: DEAD_RESOURCE_ID }),
        registryRow({
          id: ROW_ID_THREE,
          resourceId: DEAD_RESOURCE_ID,
          customFields: { "Warranty Expires": "2027-01-31T00:00:00.000Z" },
        }),
        registryRow({
          id: ROW_ID_FOUR,
          resourceId: DEAD_RESOURCE_ID,
          customFields: { "Serial Number": "FTX1840ABCD" },
          isArchived: true,
        }),
      ],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    const deletable: Array<string> = idStrings(partition.deletableIds);
    const archivable: Array<string> = idStrings(partition.archivableIds);

    expect(deletable).toEqual([ROW_ID_TWO.toString()]);
    expect(archivable).toEqual([ROW_ID_THREE.toString()]);

    const overlap: Array<string> = deletable.filter((id: string) => {
      return archivable.includes(id);
    });
    expect(overlap).toEqual([]);
  });

  test("an empty page produces an empty partition rather than throwing", () => {
    // Every source hits this on its last page; a throw here would abort the sweep.
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [],
      liveResourceIds: new Set<string>([LIVE_RESOURCE_ID.toString()]),
    });

    expect(partition.deletableIds).toEqual([]);
    expect(partition.archivableIds).toEqual([]);
  });

  test("an empty live set orphans every row on the page", () => {
    /*
     * What a fully emptied inventory table looks like — a project deleted by FK
     * cascade, which is the case hooks could never have caught. The rows with
     * typed values must survive it.
     */
    const partition: OrphanPartition = partitionOrphanRows({
      rows: [
        registryRow({ id: ROW_ID_ONE, resourceId: LIVE_RESOURCE_ID }),
        registryRow({
          id: ROW_ID_TWO,
          resourceId: LIVE_RESOURCE_ID,
          customFields: { "Serial Number": "FTX1840ABCD" },
        }),
      ],
      liveResourceIds: new Set<string>(),
    });

    expect(idStrings(partition.deletableIds)).toEqual([ROW_ID_ONE.toString()]);
    expect(idStrings(partition.archivableIds)).toEqual([ROW_ID_TWO.toString()]);
  });
});

/*
 * The per-source `query` is captured inside the closure `defineInventorySource`
 * returns, so the only way to observe it is to let the closure run and watch what
 * it asks the service for. `findBy` is a prototype method on DatabaseService, so
 * assigning a stub onto the singleton shadows it and deleting the own property
 * afterwards restores the real one — no module mocking, and nothing left behind
 * for the next test file in the worker.
 */
interface StubbableService {
  findBy?: (data: { query: JSONObject }) => Promise<Array<never>>;
}

const SERVICE_BY_RESOURCE_TYPE: Dictionary<StubbableService> = {
  NetworkDevice: NetworkDeviceService as unknown as StubbableService,
  CloudResource: CloudResourceService as unknown as StubbableService,
  ServerlessFunction: ServerlessFunctionService as unknown as StubbableService,
  RumApplication: RumApplicationService as unknown as StubbableService,
  IoTDevice: IoTDeviceService as unknown as StubbableService,
  DockerHost: DockerHostService as unknown as StubbableService,
  PodmanHost: PodmanHostService as unknown as StubbableService,
};

const MODEL_BY_RESOURCE_TYPE: Dictionary<BaseModel> = {
  NetworkDevice: new NetworkDevice(),
  CloudResource: new CloudResource(),
  ServerlessFunction: new ServerlessFunction(),
  RumApplication: new RumApplication(),
  IoTDevice: new IoTDevice(),
  DockerHost: new DockerHost(),
  PodmanHost: new PodmanHost(),
};

async function captureServiceQueries(data: {
  resourceType: string;
  run: () => Promise<void>;
}): Promise<Array<JSONObject>> {
  const service: StubbableService | undefined =
    SERVICE_BY_RESOURCE_TYPE[data.resourceType];

  if (!service) {
    throw new Error(
      `No service registered in this test for ${data.resourceType}. A new inventory source landed; add it here so its archive filter is covered too.`,
    );
  }

  const seen: Array<JSONObject> = [];

  service.findBy = (call: { query: JSONObject }): Promise<Array<never>> => {
    seen.push(call.query);
    return Promise.resolve([]);
  };

  try {
    await data.run();
  } finally {
    delete service.findBy;
  }

  return seen;
}

async function mirrorQueryFor(
  source: ErasedInventorySource,
): Promise<JSONObject> {
  const seen: Array<JSONObject> = await captureServiceQueries({
    resourceType: source.resourceType,
    run: async (): Promise<void> => {
      await source.fetchPage({ skip: 0, limit: 1 });
    },
  });

  expect(seen.length).toBe(1);
  return seen[0] || {};
}

function modelFor(resourceType: string): BaseModel {
  const model: BaseModel | undefined = MODEL_BY_RESOURCE_TYPE[resourceType];

  if (!model) {
    throw new Error(
      `No model registered in this test for ${resourceType}. A new inventory source landed; add it here so its archive filter is covered too.`,
    );
  }

  return model;
}

function hasArchiveColumn(resourceType: string): boolean {
  return modelFor(resourceType)
    .getTableColumns()
    .columns.includes("isArchived");
}

function sourceFor(resourceType: string): ErasedInventorySource {
  const source: ErasedInventorySource | undefined = INVENTORY_SOURCES.find(
    (candidate: ErasedInventorySource) => {
      return candidate.resourceType === resourceType;
    },
  );

  expect(source).toBeDefined();
  return source!;
}

describe("INVENTORY_SOURCES archive filtering", () => {
  test("the NetworkDevice source excludes archived rows", async () => {
    /*
     * This one is pinned by name because it regressed once already: the query
     * was `{}` under a comment claiming NetworkDevice had no archive flag. It
     * does — NetworkDevice.isArchived — so archived switches were mirrored back
     * into the explorer on every sweep, and archiving one in the UI appeared to
     * do nothing at all.
     */
    const query: JSONObject = await mirrorQueryFor(sourceFor("NetworkDevice"));

    expect(query).toEqual({ isArchived: false });
  });

  test("NetworkDevice really does have the archive column the query filters on", () => {
    // The other half of the regression above: the claim, not just the query.
    expect(hasArchiveColumn("NetworkDevice")).toBe(true);
  });

  test("every source whose model has an archive column filters on it", async () => {
    /*
     * Checked against the real models rather than a hardcoded list, so adding a
     * source — or adding `isArchived` to a model that lacked it — fails here
     * instead of silently reintroducing the NetworkDevice bug somewhere else.
     */
    for (const source of INVENTORY_SOURCES) {
      if (!hasArchiveColumn(source.resourceType)) {
        continue;
      }

      const query: JSONObject = await mirrorQueryFor(source);
      expect({ resourceType: source.resourceType, query: query }).toEqual({
        resourceType: source.resourceType,
        query: { isArchived: false },
      });
    }
  });

  test("IoTDevice is the only model without an archive column", () => {
    /*
     * The exemption is a property of the schema, not a decision this module gets
     * to make: IoTDevice genuinely has no `isArchived`, so it is the only source
     * that may legitimately mirror everything.
     */
    const withoutArchiveColumn: Array<string> = INVENTORY_SOURCES.filter(
      (source: ErasedInventorySource) => {
        return !hasArchiveColumn(source.resourceType);
      },
    ).map((source: ErasedInventorySource) => {
      return source.resourceType;
    });

    expect(withoutArchiveColumn).toEqual(["IoTDevice"]);
  });

  test("IoTDevice is the only source with an unrestricted query", async () => {
    const unrestricted: Array<string> = [];

    for (const source of INVENTORY_SOURCES) {
      const query: JSONObject = await mirrorQueryFor(source);
      if (Object.keys(query).length === 0) {
        unrestricted.push(source.resourceType);
      }
    }

    expect(unrestricted).toEqual(["IoTDevice"]);
  });

  test("no source narrows the mirror on anything but the archive flag", async () => {
    /*
     * The mirror is meant to be a view of the whole live estate. A stray extra
     * condition here would silently hide a slice of it, and the missing devices
     * would look identical to devices that were never registered.
     */
    for (const source of INVENTORY_SOURCES) {
      const query: JSONObject = await mirrorQueryFor(source);
      for (const key of Object.keys(query)) {
        expect({ resourceType: source.resourceType, key: key }).toEqual({
          resourceType: source.resourceType,
          key: "isArchived",
        });
      }
    }
  });

  test("findLiveIds does not inherit the archive filter", async () => {
    /*
     * `findLiveIds` answers "does the owning row still exist", and an archived
     * row still exists. Reusing the mirror query here would make every archived
     * device look like a cascade delete, so the reverse pass would hard-delete
     * its registry row — turning archiving, a reversible UI action, into
     * permanent data loss for exactly the rows this feature set out to protect.
     */
    const source: ErasedInventorySource = sourceFor("NetworkDevice");

    const seen: Array<JSONObject> = await captureServiceQueries({
      resourceType: source.resourceType,
      run: async (): Promise<void> => {
        await source.findLiveIds([LIVE_RESOURCE_ID]);
      },
    });

    expect(seen.length).toBe(1);
    expect(Object.keys(seen[0] || {})).toEqual(["_id"]);
  });

  test("findLiveIds asks nothing at all for an empty id list", async () => {
    /*
     * An empty `WHERE _id IN ()` is a syntax error in some builders and a match
     * -everything in others; short-circuiting is the only safe answer, and it
     * also spares seven pointless round trips on an empty estate.
     */
    const source: ErasedInventorySource = sourceFor("NetworkDevice");

    const seen: Array<JSONObject> = await captureServiceQueries({
      resourceType: source.resourceType,
      run: async (): Promise<void> => {
        const live: Set<string> = await source.findLiveIds([]);
        expect(live.size).toBe(0);
      },
    });

    expect(seen).toEqual([]);
  });
});
