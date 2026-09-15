import { describe, expect, test } from "@jest/globals";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import {
  formatLastSeen,
  isEntityActive,
  partitionByActivity,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";

/*
 * A topology is a picture of what is running. Inventory keeps a silent
 * discovered resource for its whole TTL (30 days for a host), which is how a
 * few dozen live pods became hundreds of boxes. These tests pin which rows
 * count as part of the picture.
 */

const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");

function item(
  source: EntitySource | undefined,
  lastSeenAt: Date | undefined,
  key: string = "k",
): InventoryItem {
  const entity: InventoryItem = new InventoryItem();
  entity.entityKey = key;
  entity.entityType = EntityType.Host;
  if (source) {
    entity.source = source;
  }
  if (lastSeenAt) {
    entity.lastSeenAt = lastSeenAt;
  }
  return entity;
}

describe("isEntityActive", () => {
  test("a discovered resource is active only if it reported in the range", () => {
    expect(
      isEntityActive(
        item(EntitySource.Discovered, new Date("2026-09-07T09:58:00Z")),
        RANGE_START,
      ),
    ).toBe(true);
    expect(
      isEntityActive(
        item(EntitySource.Discovered, new Date("2026-09-01T09:58:00Z")),
        RANGE_START,
      ),
    ).toBe(false);
  });

  test("the range start itself counts as inside the range", () => {
    expect(
      isEntityActive(item(EntitySource.Discovered, RANGE_START), RANGE_START),
    ).toBe(true);
  });

  test("manual and inventory rows have no heartbeat, so they are always active", () => {
    const old: Date = new Date("2025-01-01T00:00:00Z");
    expect(isEntityActive(item(EntitySource.Manual, old), RANGE_START)).toBe(
      true,
    );
    expect(isEntityActive(item(EntitySource.Inventory, old), RANGE_START)).toBe(
      true,
    );
  });

  test("a row without a usable timestamp is never hidden", () => {
    expect(
      isEntityActive(item(EntitySource.Discovered, undefined), RANGE_START),
    ).toBe(true);
    expect(
      isEntityActive(
        item(EntitySource.Discovered, new Date("not a date")),
        RANGE_START,
      ),
    ).toBe(true);
  });

  test("a row with no recorded source is judged by its timestamp", () => {
    expect(
      isEntityActive(
        item(undefined, new Date("2026-08-01T00:00:00Z")),
        RANGE_START,
      ),
    ).toBe(false);
  });
});

describe("partitionByActivity", () => {
  test("splits a catalog without losing or duplicating rows", () => {
    const live: InventoryItem = item(
      EntitySource.Discovered,
      new Date("2026-09-07T09:00:00Z"),
      "live",
    );
    const gone: InventoryItem = item(
      EntitySource.Discovered,
      new Date("2026-08-20T09:00:00Z"),
      "gone",
    );
    const manual: InventoryItem = item(
      EntitySource.Manual,
      new Date("2026-01-01T00:00:00Z"),
      "manual",
    );
    const result: {
      active: Array<InventoryItem>;
      inactive: Array<InventoryItem>;
    } = partitionByActivity([live, gone, manual], RANGE_START);
    expect(result.active).toEqual([live, manual]);
    expect(result.inactive).toEqual([gone]);
  });
});

describe("formatLastSeen", () => {
  const now: Date = new Date("2026-09-07T10:00:00Z");

  test.each([
    ["2026-09-07T09:59:30Z", "just now"],
    ["2026-09-07T09:48:00Z", "12 min ago"],
    ["2026-09-07T05:00:00Z", "5 h ago"],
    ["2026-09-04T10:00:00Z", "3 days ago"],
  ])("%s → %s", (at: string, expected: string) => {
    expect(formatLastSeen(new Date(at), now)).toBe(expected);
  });

  test("a clock skewed into the future reads as just now", () => {
    expect(formatLastSeen(new Date("2026-09-07T10:05:00Z"), now)).toBe(
      "just now",
    );
  });

  test("unknown timestamps render a dash", () => {
    expect(formatLastSeen(undefined, now)).toBe("—");
  });
});
