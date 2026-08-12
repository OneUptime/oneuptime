import EntityType from "../../../Types/Telemetry/EntityType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import {
  INVENTORY_ENTITY_TYPES,
  isNonTelemetryEntityType,
  MANUAL_ENTITY_TYPES,
} from "../../../Types/Telemetry/EntityTypeGroups";
import { describe, expect, test } from "@jest/globals";

/*
 * These sets decide which entity types the stale-entity prune may reach and
 * which a user may create by hand. Both questions are answered by set
 * membership, so a type that drifts out of (or silently into) a set changes
 * behaviour with no other code change — which is exactly what these pin.
 */

describe("MANUAL_ENTITY_TYPES", () => {
  test("is non-empty", () => {
    expect(MANUAL_ENTITY_TYPES.size).toBeGreaterThan(0);
  });

  test("contains only real EntityType values", () => {
    const known: Set<string> = new Set<string>(Object.values(EntityType));
    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(known.has(entityType)).toBe(true);
    }
  });

  test("holds exactly the types with no discovery path", () => {
    expect(Array.from(MANUAL_ENTITY_TYPES).sort()).toEqual(
      [
        EntityType.Appliance,
        EntityType.ExternalDatabase,
        EntityType.ExternalService,
      ].sort(),
    );
  });

  test("excludes observable types", () => {
    /*
     * A hand-made row of an observable type would key off the manual
     * identity attribute and so could never converge with the row ingest
     * derives for the same thing. See MANUAL_ENTITY_TYPES.
     */
    expect(MANUAL_ENTITY_TYPES.has(EntityType.Service)).toBe(false);
    expect(MANUAL_ENTITY_TYPES.has(EntityType.Host)).toBe(false);
    expect(MANUAL_ENTITY_TYPES.has(EntityType.KubernetesPod)).toBe(false);
    expect(MANUAL_ENTITY_TYPES.has(EntityType.NetworkDevice)).toBe(false);
  });
});

describe("INVENTORY_ENTITY_TYPES", () => {
  test("contains only real EntityType values", () => {
    const known: Set<string> = new Set<string>(Object.values(EntityType));
    for (const entityType of INVENTORY_ENTITY_TYPES) {
      expect(known.has(entityType)).toBe(true);
    }
  });

  test("covers every inventory table the registry mirrors", () => {
    expect(Array.from(INVENTORY_ENTITY_TYPES).sort()).toEqual(
      [
        EntityType.CloudResource,
        EntityType.DockerHost,
        EntityType.IoTDevice,
        EntityType.NetworkDevice,
        EntityType.PodmanHost,
        EntityType.RumApplication,
        EntityType.ServerlessFunction,
      ].sort(),
    );
  });

  test("excludes OTLP-derived types", () => {
    expect(INVENTORY_ENTITY_TYPES.has(EntityType.Service)).toBe(false);
    expect(INVENTORY_ENTITY_TYPES.has(EntityType.KubernetesCluster)).toBe(
      false,
    );
    expect(INVENTORY_ENTITY_TYPES.has(EntityType.ProxmoxGuest)).toBe(false);
  });
});

describe("the two groups are disjoint", () => {
  test("no type is both manually creatable and inventory-mirrored", () => {
    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(INVENTORY_ENTITY_TYPES.has(entityType)).toBe(false);
    }
    for (const entityType of INVENTORY_ENTITY_TYPES) {
      expect(MANUAL_ENTITY_TYPES.has(entityType)).toBe(false);
    }
  });
});

describe("isNonTelemetryEntityType", () => {
  test("is true for every manual and inventory type", () => {
    for (const entityType of MANUAL_ENTITY_TYPES) {
      expect(isNonTelemetryEntityType(entityType)).toBe(true);
    }
    for (const entityType of INVENTORY_ENTITY_TYPES) {
      expect(isNonTelemetryEntityType(entityType)).toBe(true);
    }
  });

  test("is false for OTLP-derived types, which do have a heartbeat", () => {
    const telemetryTypes: Array<EntityType> = Object.values(EntityType).filter(
      (entityType: EntityType) => {
        return (
          !MANUAL_ENTITY_TYPES.has(entityType) &&
          !INVENTORY_ENTITY_TYPES.has(entityType)
        );
      },
    );

    expect(telemetryTypes.length).toBeGreaterThan(0);

    for (const entityType of telemetryTypes) {
      expect(isNonTelemetryEntityType(entityType)).toBe(false);
    }
  });

  test("every EntityType is classified one way or the other", () => {
    for (const entityType of Object.values(EntityType)) {
      expect(typeof isNonTelemetryEntityType(entityType)).toBe("boolean");
    }
  });
});

describe("EntitySource", () => {
  test("has exactly the three lifecycles the registry distinguishes", () => {
    expect(Object.values(EntitySource).sort()).toEqual(
      ["discovered", "inventory", "manual"].sort(),
    );
  });

  test("values are stable strings — they are persisted and queried on", () => {
    expect(EntitySource.Discovered).toBe("discovered");
    expect(EntitySource.Inventory).toBe("inventory");
    expect(EntitySource.Manual).toBe("manual");
  });
});
