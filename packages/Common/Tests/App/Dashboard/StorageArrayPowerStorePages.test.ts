import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import StorageArrayResource from "../../../Models/DatabaseModels/StorageArrayResource";
import Column from "../../../UI/Components/ModelTable/Column";
import { StatusBadgeType } from "../../../UI/Components/StatusBadge/StatusBadge";
import StorageArrayPlatformRegistry from "../../../Types/StorageArray/StorageArrayPlatformRegistry";
import {
  StorageArrayInventoryColumns,
  StorageArrayKindDefinition,
} from "../../../Types/StorageArray/StorageArrayPlatform";
import DellPowerStorePlatform, {
  POWERSTORE_KIND,
} from "../../../Types/StorageArray/Platforms/Dell/PowerStore/PowerStorePlatform";
import {
  getInventoryColumns,
  getInventoryUsage,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/View/Inventory";
import {
  StorageUsage,
  StorageUsageLevel,
} from "../../../Utils/Storage/StorageUsage";
import { getResourceStatusBadgeType } from "../../../../App/FeatureSet/Dashboard/src/Pages/StorageArray/Utils/StorageArrayResourceUtils";

/*
 * A DELL POWERSTORE'S OWN TABS, AND THE COLOUR OF ITS PARTS' WORDS (#11002).
 *
 * Its appliances, volume groups and NAS servers are kinds of its own, which
 * the Inventory page lists (#11000). That page shows every column a volume
 * has, in a volume's words, unless the kind says what its objects report:
 * an appliance has no state of its own, its size is physical and how full
 * it is reads as the shared bar, with its latency beside it (its names,
 * which start with the cluster's, need the room); a volume group's size is
 * what its volumes were given; and a NAS server has no size at all. And a
 * part's pill is coloured by the words its platform declares: a NAS server
 * not started needs attention, one started and a port that is up are fine.
 */

const LOCALES: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

const ENGLISH: Record<string, string> = locale("en");
const GERMAN: Record<string, string> = locale("de");

function definitionOf(kind: string): StorageArrayKindDefinition {
  const definition: StorageArrayKindDefinition | null =
    StorageArrayPlatformRegistry.getKindDefinition(kind);
  expect(definition).not.toBeNull();
  return definition!;
}

function titles(columns: Array<Column<StorageArrayResource>>): Array<string> {
  return columns.map((column: Column<StorageArrayResource>): string => {
    return column.title;
  });
}

// The columns a reader sees before opening the column picker.
function shownAtFirst(
  columns: Array<Column<StorageArrayResource>>,
): Array<string> {
  return titles(
    columns.filter((column: Column<StorageArrayResource>): boolean => {
      return !column.isHiddenByDefault;
    }),
  );
}

function freshRow(data: {
  capacityBytes: number | null;
  usedBytes: number | null;
}): StorageArrayResource {
  const row: StorageArrayResource = new StorageArrayResource();
  row.kind = POWERSTORE_KIND.Appliance;
  row.capacityBytes = data.capacityBytes as number;
  row.usedBytes = data.usedBytes as number;
  row.metricsUpdatedAt = new Date();
  return row;
}

const TIB: number = 1024 * 1024 * 1024 * 1024;

function columnTitled(
  columns: Array<Column<StorageArrayResource>>,
  title: string,
): Column<StorageArrayResource> {
  const column: Column<StorageArrayResource> | undefined = columns.find(
    (candidate: Column<StorageArrayResource>): boolean => {
      return candidate.title === title;
    },
  );
  expect(column).toBeDefined();
  return column!;
}

// The latency, IOPS and bandwidth columns every performance table shows.
const PERFORMANCE: Array<string> = [
  "Read Latency",
  "Write Latency",
  "Read IOPS",
  "Write IOPS",
  "Read Bandwidth",
  "Write Bandwidth",
];

describe("the Inventory page lists a PowerStore's own kinds in their own words", () => {
  test("an appliance: how full it is as a bar, its physical capacity, its data reduction and latency, and no state", () => {
    const columns: Array<Column<StorageArrayResource>> = getInventoryColumns(
      definitionOf(POWERSTORE_KIND.Appliance),
    );
    expect(titles(columns)).toEqual([
      "ID",
      "Physical Capacity Used",
      "Physical Capacity",
      "Data Reduction",
      ...PERFORMANCE,
      "Last Seen",
    ]);
    // Its IOPS and bandwidth wait in the column picker: its names need the room.
    expect(shownAtFirst(columns)).toEqual([
      "ID",
      "Physical Capacity Used",
      "Physical Capacity",
      "Data Reduction",
      "Read Latency",
      "Write Latency",
    ]);
    expect(columnTitled(columns, "Physical Capacity").headerTooltip).toBe(
      "Usable physical capacity of each appliance in bytes.",
    );
    expect(
      columnTitled(columns, "Physical Capacity Used").headerTooltip,
    ).toContain("after deduplication and compression");
    // The bar sorts by nothing: what it would sort by is a size, not how full.
    expect(columnTitled(columns, "Physical Capacity Used").disableSort).toBe(
      true,
    );
  });

  test("how full an appliance is: what of its physical capacity is used, amber and red at the capacity lines", () => {
    const nearlyFull: StorageUsage | null = getInventoryUsage(
      freshRow({ capacityBytes: 110 * TIB, usedBytes: 101 * TIB }),
    );
    expect(nearlyFull).not.toBeNull();
    expect(nearlyFull!.capacity).toBe(110 * TIB);
    expect(nearlyFull!.used).toBe(101 * TIB);
    expect(nearlyFull!.level).toBe(StorageUsageLevel.Critical);
    expect(
      getInventoryUsage(
        freshRow({ capacityBytes: 110 * TIB, usedBytes: 92 * TIB }),
      )!.level,
    ).toBe(StorageUsageLevel.Warning);
    expect(
      getInventoryUsage(
        freshRow({ capacityBytes: 110 * TIB, usedBytes: 54 * TIB }),
      )!.level,
    ).toBe(StorageUsageLevel.Normal);
    // No size, or none used reported: no bar, never a 0% it never measured.
    expect(
      getInventoryUsage(freshRow({ capacityBytes: null, usedBytes: TIB })),
    ).toBeNull();
    expect(
      getInventoryUsage(freshRow({ capacityBytes: 0, usedBytes: 0 })),
    ).toBeNull();
    expect(
      getInventoryUsage(freshRow({ capacityBytes: TIB, usedBytes: null })),
    ).toBeNull();
    // A reading gone stale reads as none.
    const stale: StorageArrayResource = freshRow({
      capacityBytes: 110 * TIB,
      usedBytes: 54 * TIB,
    });
    stale.metricsUpdatedAt = new Date(Date.now() - 24 * 60 * 60 * 1000);
    expect(getInventoryUsage(stale)).toBeNull();
  });

  test("a volume group: what its volumes were given and what hosts wrote to them, and their performance", () => {
    const columns: Array<Column<StorageArrayResource>> = getInventoryColumns(
      definitionOf(POWERSTORE_KIND.VolumeGroup),
    );
    expect(titles(columns)).toEqual([
      "Logical Capacity Used",
      "Provisioned Capacity",
      ...PERFORMANCE,
      "Last Seen",
    ]);
    expect(shownAtFirst(columns)).toEqual([
      "Logical Capacity Used",
      "Provisioned Capacity",
      "Read Latency",
      "Write Latency",
      "Read IOPS",
      "Write IOPS",
    ]);
    expect(columnTitled(columns, "Provisioned Capacity").headerTooltip).toBe(
      "Capacity provisioned to each volume group's volumes, in bytes.",
    );
  });

  test("a NAS server: whether it is started, and the reads and writes it serves", () => {
    expect(
      titles(getInventoryColumns(definitionOf(POWERSTORE_KIND.NasServer))),
    ).toEqual(["Status", ...PERFORMANCE, "Last Seen"]);
  });

  test("a kind no platform describes keeps every column, in a volume's words, as before", () => {
    expect(titles(getInventoryColumns(null))).toEqual([
      "Status",
      "Provisioned",
      "Physical",
      "Data Reduction",
      ...PERFORMANCE,
      "Last Seen",
    ]);
  });

  test("no Pure word describes a PowerStore column", () => {
    const pureWords: RegExp = /Pure|FlashArray|FlashBlade|Purity/;
    const pure: Array<string> = [];
    for (const kind of Object.values(POWERSTORE_KIND)) {
      for (const column of getInventoryColumns(definitionOf(kind))) {
        const says: string = `${column.title} ${column.headerTooltip || ""}`;
        if (pureWords.test(says)) {
          pure.push(`${kind}: ${column.title}`);
        }
      }
    }
    expect(pure).toEqual([]);
    // Without its words, the page would say Pure's: the reason they exist.
    expect(
      getInventoryColumns(null).some(
        (column: Column<StorageArrayResource>): boolean => {
          return pureWords.test(column.headerTooltip || "");
        },
      ),
    ).toBe(true);
  });

  test("every title and description it gives is in the Dashboard's words, and German has its own", () => {
    const given: Array<string> = [];
    for (const definition of DellPowerStorePlatform.kindDefinitions) {
      const columns: StorageArrayInventoryColumns | undefined =
        definition.inventoryColumns;
      expect(columns).toBeDefined();
      for (const words of [
        columns!.idTitle,
        columns!.capacityTitle,
        columns!.capacityDescription,
        columns!.usedTitle,
        columns!.usedDescription,
      ]) {
        if (words) {
          given.push(words);
        }
      }
    }
    expect(given).toHaveLength(9);
    for (const words of given) {
      expect({ words, english: ENGLISH[words] }).toEqual({
        words,
        english: words,
      });
      expect(GERMAN[words]).toBeTruthy();
      // German writes an id "ID" too; every other word is its own.
      if (words !== "ID") {
        expect({ words, german: GERMAN[words] }).not.toEqual({
          words,
          german: words,
        });
      }
    }
  });
});

describe("a part's pill takes its colour from its platform's words", () => {
  test("a PowerStore NAS server not started needs attention; started, it is fine", () => {
    expect(getResourceStatusBadgeType("not started")).toBe(
      StatusBadgeType.Warning,
    );
    expect(getResourceStatusBadgeType("Not Started")).toBe(
      StatusBadgeType.Warning,
    );
    expect(getResourceStatusBadgeType("started")).toBe(StatusBadgeType.Success);
  });

  test("a port that is up is fine; one that is down is no problem by itself", () => {
    expect(getResourceStatusBadgeType("up")).toBe(StatusBadgeType.Success);
    // A port nothing is cabled to is always down.
    expect(getResourceStatusBadgeType("down")).toBe(StatusBadgeType.Neutral);
  });

  test("a node's lifecycle states: failed preparing and disconnected are red, the states in between amber", () => {
    for (const status of ["prepare_failed", "disconnected"]) {
      expect({ status, type: getResourceStatusBadgeType(status) }).toEqual({
        status,
        type: StatusBadgeType.Danger,
      });
    }
    for (const status of ["uninitialized", "initializing", "trigger_update"]) {
      expect({ status, type: getResourceStatusBadgeType(status) }).toEqual({
        status,
        type: StatusBadgeType.Warning,
      });
    }
  });

  test("the words every platform shares read as they always did", () => {
    const expected: Array<[string, StatusBadgeType]> = [
      ["critical", StatusBadgeType.Danger],
      ["failed", StatusBadgeType.Danger],
      ["unhealthy", StatusBadgeType.Danger],
      ["degraded", StatusBadgeType.Warning],
      ["not ready", StatusBadgeType.Warning],
      ["ok", StatusBadgeType.Success],
      ["healthy", StatusBadgeType.Success],
      ["ready", StatusBadgeType.Success],
      ["enabled", StatusBadgeType.Success],
      ["not_installed", StatusBadgeType.Neutral],
      ["unused", StatusBadgeType.Neutral],
      ["disabled", StatusBadgeType.Neutral],
      ["", StatusBadgeType.Neutral],
    ];
    for (const [status, type] of expected) {
      expect({ status, type: getResourceStatusBadgeType(status) }).toEqual({
        status,
        type,
      });
    }
    expect(getResourceStatusBadgeType(null)).toBe(StatusBadgeType.Neutral);
    expect(getResourceStatusBadgeType(undefined)).toBe(StatusBadgeType.Neutral);
  });

  test("each word PowerStore declares is coloured as its list says, and no list holds a word another holds", () => {
    const statuses: {
      critical: ReadonlyArray<string>;
      warning: ReadonlyArray<string>;
      healthy?: ReadonlyArray<string> | undefined;
    } = DellPowerStorePlatform.componentStatuses;
    const lists: Array<[ReadonlyArray<string>, StatusBadgeType]> = [
      [statuses.critical, StatusBadgeType.Danger],
      [statuses.warning, StatusBadgeType.Warning],
      [statuses.healthy || [], StatusBadgeType.Success],
    ];
    const seen: Set<string> = new Set();
    for (const [words, type] of lists) {
      for (const status of words) {
        expect({ status, type: getResourceStatusBadgeType(status) }).toEqual({
          status,
          type,
        });
        expect(seen.has(status)).toBe(false);
        seen.add(status);
      }
    }
    expect(statuses.healthy).toEqual(["started", "up"]);
  });
});
