import {
  computeEntityKey,
  INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
  keyForInventoryEntity,
  keyForManualEntity,
  MANUAL_ENTITY_IDENTITY_ATTRIBUTE,
} from "../../../Utils/Telemetry/EntityKey";
import EntityType from "../../../Types/Telemetry/EntityType";
import { describe, expect, test } from "@jest/globals";

/*
 * Identity for the two entity flavours that never pass through ingest:
 * manually registered CIs and rows mirrored from OneUptime's inventory
 * tables. Neither has an ingest-side resolver to byte-match, so the only
 * things that must hold are the ones tested here — determinism, tenant and
 * type separation, and the specific choice of what each keys on (a manual CI
 * on its name, an inventory mirror on its owning row's id).
 *
 * The consequence of getting these wrong is duplicate registry rows that
 * both look correct, so each property is pinned rather than assumed.
 */

const PROJECT: string = "proj1";
const OTHER_PROJECT: string = "proj2";
const RESOURCE_ID: string = "6f2e5c1a-0b3d-4e5f-8a9b-1c2d3e4f5a6b";

describe("keyForManualEntity", () => {
  test("is deterministic", () => {
    expect(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "Stripe API"),
    ).toBe(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "Stripe API"),
    );
  });

  test("is a 16-char lowercase hex key, like every other entity key", () => {
    const key: string = keyForManualEntity(
      PROJECT,
      EntityType.ExternalService,
      "Stripe API",
    );
    expect(key).toMatch(/^[0-9a-f]{16}$/);
  });

  test("canonicalizes the name, so casing and padding do not fork identity", () => {
    const canonical: string = keyForManualEntity(
      PROJECT,
      EntityType.ExternalService,
      "Stripe API",
    );

    expect(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "  stripe api "),
    ).toBe(canonical);
    expect(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "STRIPE API"),
    ).toBe(canonical);
  });

  test("separates tenants", () => {
    expect(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "Stripe API"),
    ).not.toBe(
      keyForManualEntity(
        OTHER_PROJECT,
        EntityType.ExternalService,
        "Stripe API",
      ),
    );
  });

  test("separates types, so one name can exist as two kinds of thing", () => {
    expect(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "payments"),
    ).not.toBe(
      keyForManualEntity(PROJECT, EntityType.ExternalDatabase, "payments"),
    );
  });

  test("distinct names within a type get distinct keys", () => {
    expect(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "Stripe API"),
    ).not.toBe(
      keyForManualEntity(PROJECT, EntityType.ExternalService, "Adyen API"),
    );
  });

  test("matches computeEntityKey over the documented identity attribute", () => {
    expect(
      keyForManualEntity(PROJECT, EntityType.Appliance, "Rack PDU 3"),
    ).toBe(
      computeEntityKey({
        projectId: PROJECT,
        entityType: EntityType.Appliance,
        identifyingAttributes: {
          [MANUAL_ENTITY_IDENTITY_ATTRIBUTE]: "rack pdu 3",
        },
      }),
    );
  });
});

describe("keyForInventoryEntity", () => {
  test("is deterministic", () => {
    expect(
      keyForInventoryEntity(PROJECT, EntityType.NetworkDevice, RESOURCE_ID),
    ).toBe(
      keyForInventoryEntity(PROJECT, EntityType.NetworkDevice, RESOURCE_ID),
    );
  });

  test("keys on the owning row id, so renaming the row keeps its identity", () => {
    /*
     * This is the whole reason inventory mirrors key on the id rather than
     * the name: a rename must update the existing registry row, not orphan
     * it and mint a second one alongside.
     */
    const key: string = keyForInventoryEntity(
      PROJECT,
      EntityType.NetworkDevice,
      RESOURCE_ID,
    );

    expect(
      keyForInventoryEntity(PROJECT, EntityType.NetworkDevice, RESOURCE_ID),
    ).toBe(key);
  });

  test("separates tenants and types", () => {
    const key: string = keyForInventoryEntity(
      PROJECT,
      EntityType.NetworkDevice,
      RESOURCE_ID,
    );

    expect(
      keyForInventoryEntity(
        OTHER_PROJECT,
        EntityType.NetworkDevice,
        RESOURCE_ID,
      ),
    ).not.toBe(key);
    expect(
      keyForInventoryEntity(PROJECT, EntityType.IoTDevice, RESOURCE_ID),
    ).not.toBe(key);
  });

  test("distinct rows get distinct keys", () => {
    expect(
      keyForInventoryEntity(PROJECT, EntityType.NetworkDevice, RESOURCE_ID),
    ).not.toBe(
      keyForInventoryEntity(
        PROJECT,
        EntityType.NetworkDevice,
        "11111111-2222-3333-4444-555555555555",
      ),
    );
  });

  test("matches computeEntityKey over the documented identity attribute", () => {
    expect(
      keyForInventoryEntity(PROJECT, EntityType.CloudResource, RESOURCE_ID),
    ).toBe(
      computeEntityKey({
        projectId: PROJECT,
        entityType: EntityType.CloudResource,
        identifyingAttributes: {
          [INVENTORY_ENTITY_IDENTITY_ATTRIBUTE]: RESOURCE_ID,
        },
      }),
    );
  });
});

describe("manual and inventory identities do not collide", () => {
  test("the two attributes are distinct", () => {
    expect(MANUAL_ENTITY_IDENTITY_ATTRIBUTE).not.toBe(
      INVENTORY_ENTITY_IDENTITY_ATTRIBUTE,
    );
  });

  test("same project, same type, same literal value still key differently", () => {
    /*
     * A manual CI literally named after a resource id would otherwise
     * collide with the mirror of that resource.
     */
    expect(
      keyForManualEntity(PROJECT, EntityType.Appliance, RESOURCE_ID),
    ).not.toBe(
      keyForInventoryEntity(PROJECT, EntityType.Appliance, RESOURCE_ID),
    );
  });
});
