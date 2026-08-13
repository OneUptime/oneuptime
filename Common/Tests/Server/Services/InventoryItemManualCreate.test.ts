import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemService from "../../../Server/Services/InventoryItemService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import ObjectID from "../../../Types/ObjectID";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import { keyForManualEntity } from "../../../Utils/Telemetry/EntityKey";
import { describe, expect, test } from "@jest/globals";

/*
 * InventoryItemService.onBeforeCreate is the whole of the manual-CI
 * write path: it is what decides a create is manual, validates it, and
 * derives the identity the registry needs from the two fields a human can
 * supply. It also has to leave machine creates — ingest and the inventory
 * mirror, which arrive with their keys already computed — completely alone.
 *
 * Every assertion below is one of those two duties.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0f8b9c0d-e1a2-4b3c-8d5e-6f7a8b9c0d1e",
);

type CallCreate = (createBy: CreateBy<InventoryItem>) => Promise<unknown>;

const callOnBeforeCreate: CallCreate = (
  createBy: CreateBy<InventoryItem>,
): Promise<unknown> => {
  return (
    InventoryItemService as unknown as {
      onBeforeCreate: (c: CreateBy<InventoryItem>) => Promise<unknown>;
    }
  ).onBeforeCreate(createBy);
};

/*
 * Explicitly admits `undefined` per field. The suite needs to build creates
 * with a field genuinely absent (that is what the validation tests are), and
 * `Partial<InventoryItem>` rejects an explicit undefined under this
 * project's `exactOptionalPropertyTypes`.
 */
interface ManualCreateOverrides {
  projectId?: ObjectID | undefined;
  entityType?: EntityType | undefined;
  displayName?: string | undefined;
  description?: string | undefined;
}

function manualCreate(
  overrides: ManualCreateOverrides = {},
): CreateBy<InventoryItem> {
  const data: InventoryItem = new InventoryItem();
  data.projectId = PROJECT_ID;
  data.entityType = EntityType.ExternalService;
  data.displayName = "Stripe Payments API";
  Object.assign(data, overrides);

  return { data, props: { isRoot: true } } as CreateBy<InventoryItem>;
}

describe("manual entity creation", () => {
  test("a create with no entity key is treated as manual", async () => {
    const createBy: CreateBy<InventoryItem> = manualCreate();
    await callOnBeforeCreate(createBy);

    expect(createBy.data.source).toBe(EntitySource.Manual);
  });

  test("derives the entity key from project, type and name", async () => {
    const createBy: CreateBy<InventoryItem> = manualCreate();
    await callOnBeforeCreate(createBy);

    expect(createBy.data.entityKey).toBe(
      keyForManualEntity(
        PROJECT_ID.toString(),
        EntityType.ExternalService,
        "Stripe Payments API",
      ),
    );
  });

  test("records the canonicalized name as the identifying attribute", async () => {
    const createBy: CreateBy<InventoryItem> = manualCreate({
      displayName: "  Stripe Payments API  ",
    });
    await callOnBeforeCreate(createBy);

    expect(createBy.data.identifyingAttributes).toEqual({
      "oneuptime.entity.name": "stripe payments api",
    });
  });

  test("trims the stored display name but keeps its original casing", async () => {
    const createBy: CreateBy<InventoryItem> = manualCreate({
      displayName: "  Stripe Payments API  ",
    });
    await callOnBeforeCreate(createBy);

    expect(createBy.data.displayName).toBe("Stripe Payments API");
  });

  test("two names differing only by case resolve to one identity", async () => {
    const first: CreateBy<InventoryItem> = manualCreate({
      displayName: "Stripe API",
    });
    const second: CreateBy<InventoryItem> = manualCreate({
      displayName: "stripe api",
    });

    await callOnBeforeCreate(first);
    await callOnBeforeCreate(second);

    /*
     * The unique index on (projectId, entityType, entityKey) then rejects
     * the second as a duplicate rather than admitting a near-identical row.
     */
    expect(second.data.entityKey).toBe(first.data.entityKey);
  });

  test("stamps first and last seen so the row sorts with the rest", async () => {
    const createBy: CreateBy<InventoryItem> = manualCreate();
    await callOnBeforeCreate(createBy);

    expect(createBy.data.firstSeenAt).toBeInstanceOf(Date);
    expect(createBy.data.lastSeenAt).toBeInstanceOf(Date);
  });

  test("accepts every manually creatable type", async () => {
    for (const entityType of [
      EntityType.ExternalService,
      EntityType.ExternalDatabase,
      EntityType.Appliance,
    ]) {
      const createBy: CreateBy<InventoryItem> = manualCreate({ entityType });
      await callOnBeforeCreate(createBy);

      expect(createBy.data.entityType).toBe(entityType);
      expect(createBy.data.entityKey).toBeTruthy();
    }
  });
});

describe("manual entity validation", () => {
  test("rejects a type that OneUptime discovers on its own", async () => {
    await expect(
      callOnBeforeCreate(manualCreate({ entityType: EntityType.Service })),
    ).rejects.toThrow(/cannot be created manually/);
  });

  test("rejects an inventory-mirrored type", async () => {
    /*
     * These arrive from the mirror with a precomputed key; a hand-made one
     * would be a permanent duplicate of the row the mirror maintains.
     */
    await expect(
      callOnBeforeCreate(
        manualCreate({ entityType: EntityType.NetworkDevice }),
      ),
    ).rejects.toThrow(/cannot be created manually/);
  });

  test("rejects a missing name", async () => {
    await expect(
      callOnBeforeCreate(manualCreate({ displayName: undefined })),
    ).rejects.toThrow(/Name is required/);
  });

  test("rejects a whitespace-only name", async () => {
    await expect(
      callOnBeforeCreate(manualCreate({ displayName: "   " })),
    ).rejects.toThrow(/Name is required/);
  });

  test("rejects a missing entity type", async () => {
    await expect(
      callOnBeforeCreate(manualCreate({ entityType: undefined })),
    ).rejects.toThrow(/Entity Type is required/);
  });

  test("rejects a missing project", async () => {
    await expect(
      callOnBeforeCreate(manualCreate({ projectId: undefined })),
    ).rejects.toThrow(/Project ID is required/);
  });
});

describe("machine creates are left alone", () => {
  test("a discovered create keeps its precomputed key and source", async () => {
    const data: InventoryItem = new InventoryItem();
    data.projectId = PROJECT_ID;
    data.entityType = EntityType.KubernetesPod;
    data.entityKey = "210dac24142f1baa";
    data.source = EntitySource.Discovered;
    data.displayName = "checkout-7d9f";
    data.identifyingAttributes = { "k8s.pod.name": "checkout-7d9f" };

    const createBy: CreateBy<InventoryItem> = {
      data,
      props: { isRoot: true },
    } as CreateBy<InventoryItem>;

    await callOnBeforeCreate(createBy);

    expect(createBy.data.entityKey).toBe("210dac24142f1baa");
    expect(createBy.data.source).toBe(EntitySource.Discovered);
    expect(createBy.data.identifyingAttributes).toEqual({
      "k8s.pod.name": "checkout-7d9f",
    });
  });

  test("a discovered create of an otherwise un-creatable type is not rejected", async () => {
    /*
     * The manual-type restriction must apply to users, not to ingest — which
     * legitimately creates services, pods and hosts.
     */
    const data: InventoryItem = new InventoryItem();
    data.projectId = PROJECT_ID;
    data.entityType = EntityType.Service;
    data.entityKey = "abcdef0123456789";
    data.source = EntitySource.Discovered;

    await expect(
      callOnBeforeCreate({
        data,
        props: { isRoot: true },
      } as CreateBy<InventoryItem>),
    ).resolves.toBeDefined();
  });

  test("an inventory mirror create keeps its precomputed key and source", async () => {
    const data: InventoryItem = new InventoryItem();
    data.projectId = PROJECT_ID;
    data.entityType = EntityType.NetworkDevice;
    data.entityKey = "9f8e7d6c5b4a3210";
    data.source = EntitySource.Inventory;
    data.displayName = "core-switch-1";

    const createBy: CreateBy<InventoryItem> = {
      data,
      props: { isRoot: true },
    } as CreateBy<InventoryItem>;

    await callOnBeforeCreate(createBy);

    expect(createBy.data.entityKey).toBe("9f8e7d6c5b4a3210");
    expect(createBy.data.source).toBe(EntitySource.Inventory);
  });
});
