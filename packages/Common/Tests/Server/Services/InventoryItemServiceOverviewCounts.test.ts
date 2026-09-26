import InventoryItemService, {
  INVENTORY_OVERVIEW_GROUP_BY,
  INVENTORY_OVERVIEW_SELECT,
  InventoryOverviewCounts,
  readInventoryOverviewGroups,
} from "../../../Server/Services/InventoryItemService";
import AggregateBy, {
  AggregateColumn,
  AggregateRow,
} from "../../../Server/Types/Database/AggregateBy";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  InventoryLiveness,
  getInventoryLivenessSql,
} from "../../../Types/Telemetry/InventoryLiveness";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

/*
 * The Inventory Overview's tiles and breakdown used to be a fold in the
 * browser over one list read capped at ten thousand rows, so a bigger project
 * saw numbers for only part of its estate and nothing said so. They are
 * counted in Postgres now. These pin the read itself — what it scopes to, and
 * that nothing caps it — and the fold of its groups back into the numbers the
 * page renders. InventoryOverviewPostgres.test.ts runs the same columns
 * against a real database.
 */

const projectId: ObjectID = ObjectID.generate();
const props: DatabaseCommonInteractionProps = {
  tenantId: projectId,
  userId: ObjectID.generate(),
};

function columnFor(alias: string): AggregateColumn {
  const column: AggregateColumn | undefined = INVENTORY_OVERVIEW_SELECT.find(
    (candidate: AggregateColumn): boolean => {
      return candidate.alias === alias;
    },
  );

  if (!column) {
    throw new Error(`No overview column is aliased "${alias}".`);
  }

  return column;
}

describe("getOverviewCounts", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  type AggregateBySpy = jest.SpiedFunction<
    typeof InventoryItemService.aggregateBy
  >;

  function spyOnAggregate(rows: Array<AggregateRow>): AggregateBySpy {
    return jest
      .spyOn(InventoryItemService, "aggregateBy")
      .mockResolvedValue(rows);
  }

  function aggregateCall(spy: AggregateBySpy): AggregateBy<InventoryItem> {
    expect(spy).toHaveBeenCalledTimes(1);
    return spy.mock.calls[0]![0];
  }

  test("counts the project's unarchived estate, as the caller", async () => {
    /*
     * Archived rows are left out because every tile drills into the live
     * Items list, which leaves them out too — counting them would put 100 on
     * a tile that opens a list of 95. The caller's props go through so the
     * count runs the same permission pipeline the list does.
     */
    const spy: AggregateBySpy = spyOnAggregate([]);

    await InventoryItemService.getOverviewCounts({ projectId, props });

    const call: AggregateBy<InventoryItem> = aggregateCall(spy);

    expect(call.query).toEqual({ projectId: projectId, isArchived: false });
    expect(call.props).toBe(props);
  });

  test("is one statement grouped by type, so the tiles and the breakdown are one snapshot", async () => {
    const spy: AggregateBySpy = spyOnAggregate([]);

    await InventoryItemService.getOverviewCounts({ projectId, props });

    const call: AggregateBy<InventoryItem> = aggregateCall(spy);

    expect(call.groupBy).toEqual([
      { expression: `"InventoryItem"."entityType"`, alias: "entityType" },
    ]);
    expect(call.select).toBe(INVENTORY_OVERVIEW_SELECT);
  });

  test("is not capped — a limit on the groups would cap the totals summed from them", async () => {
    const spy: AggregateBySpy = spyOnAggregate([]);

    await InventoryItemService.getOverviewCounts({ projectId, props });

    expect(aggregateCall(spy).limit).toBeUndefined();
  });

  test("returns the fold of whatever the database grouped", async () => {
    const rows: Array<AggregateRow> = [
      {
        entityType: EntityType.Service,
        itemCount: "25000",
        discoveredCount: "24000",
        mirroredCount: "0",
        manualCount: "1000",
        staleCount: "300",
      },
    ];
    spyOnAggregate(rows);

    const counts: InventoryOverviewCounts =
      await InventoryItemService.getOverviewCounts({ projectId, props });

    expect(counts).toEqual(readInventoryOverviewGroups(rows));
    // Past the old ten-thousand-row cap, which is the point.
    expect(counts.total).toBe(25000);
  });

  test("a database failure reaches the caller rather than reading as an empty estate", async () => {
    jest
      .spyOn(InventoryItemService, "aggregateBy")
      .mockRejectedValue(new Error("connection reset"));

    await expect(
      InventoryItemService.getOverviewCounts({ projectId, props }),
    ).rejects.toThrow("connection reset");
  });
});

describe("the overview columns", () => {
  test("group by the entity type and nothing else", () => {
    expect(INVENTORY_OVERVIEW_GROUP_BY).toEqual([
      { expression: `"InventoryItem"."entityType"`, alias: "entityType" },
    ]);
  });

  test("count every row for the total", () => {
    expect(columnFor("itemCount").expression).toBe("COUNT(*)");
  });

  test.each([
    ["discoveredCount", EntitySource.Discovered],
    ["mirroredCount", EntitySource.Inventory],
    ["manualCount", EntitySource.Manual],
  ])("%s filters on source %s", (alias: string, source: EntitySource) => {
    expect(columnFor(alias).expression).toBe(
      `COUNT(*) FILTER (WHERE "InventoryItem"."source" = '${source}')`,
    );
  });

  test("the stale count applies the Stale status facet's own SQL", () => {
    /*
     * "Gone Quiet" drills into the list filtered on `inventoryStatus =
     * stale`. Writing a second staleness predicate here — say `lastSeenAt <
     * now() - 1 day` — would disagree with that list at the boundary minute
     * and on never-seen and non-discovered rows. So the count uses the very
     * expression the virtual column is built from.
     */
    expect(columnFor("staleCount").expression).toBe(
      `COUNT(*) FILTER (WHERE (${getInventoryLivenessSql(`"InventoryItem"`)}) = '${InventoryLiveness.Stale}')`,
    );
  });

  test("the inventoryStatus virtual column is built from the same SQL", () => {
    const column: ColumnMetadataArgs | undefined =
      getMetadataArgsStorage().columns.find(
        (candidate: ColumnMetadataArgs): boolean => {
          return (
            candidate.target === InventoryItem &&
            candidate.propertyName === "inventoryStatus"
          );
        },
      );

    expect(column?.mode).toBe("virtual-property");

    const query: ((alias: string) => string) | undefined = (
      column?.options as { query?: (alias: string) => string } | undefined
    )?.query;

    expect(query).toBeDefined();
    expect(query!(`"InventoryItem"`)).toBe(
      getInventoryLivenessSql(`"InventoryItem"`),
    );
  });

  test("aliases are unique, plain identifiers", () => {
    const aliases: Array<string> = [
      ...INVENTORY_OVERVIEW_GROUP_BY,
      ...INVENTORY_OVERVIEW_SELECT,
    ].map((column: AggregateColumn): string => {
      return column.alias;
    });

    expect(new Set(aliases).size).toBe(aliases.length);

    for (const alias of aliases) {
      expect(alias).toMatch(/^[a-zA-Z][a-zA-Z0-9_]*$/);
    }
  });

  test("no expression carries a statement separator", () => {
    // aggregateBy rejects these; this fails at the definition instead of at runtime.
    for (const column of INVENTORY_OVERVIEW_SELECT) {
      expect(column.expression).not.toContain(";");
    }
  });
});

describe("readInventoryOverviewGroups", () => {
  test("no groups is an empty estate", () => {
    expect(readInventoryOverviewGroups([])).toEqual({
      total: 0,
      discovered: 0,
      mirrored: 0,
      manual: 0,
      stale: 0,
      countsByType: {},
    });
  });

  test("sums every group into the tiles and keys the groups by type", () => {
    const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
      {
        entityType: EntityType.Service,
        itemCount: "7",
        discoveredCount: "5",
        mirroredCount: "0",
        manualCount: "2",
        staleCount: "3",
      },
      {
        entityType: EntityType.Host,
        itemCount: "4",
        discoveredCount: "1",
        mirroredCount: "3",
        manualCount: "0",
        staleCount: "1",
      },
    ]);

    expect(counts).toEqual({
      total: 11,
      discovered: 6,
      mirrored: 3,
      manual: 2,
      stale: 4,
      countsByType: {
        [EntityType.Service]: 7,
        [EntityType.Host]: 4,
      },
    });
  });

  test("reads Postgres' bigint strings as numbers, not by concatenating them", () => {
    const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
      { entityType: EntityType.Service, itemCount: "10" },
      { entityType: EntityType.Host, itemCount: "9" },
    ]);

    expect(counts.total).toBe(19);
  });

  test("the breakdown adds up to the total whenever every group has a type", () => {
    const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
      { entityType: EntityType.Service, itemCount: "12" },
      { entityType: EntityType.Host, itemCount: "40" },
      { entityType: "some.future.type", itemCount: "3" },
    ]);

    const breakdownTotal: number = Object.values(counts.countsByType).reduce(
      (sum: number, count: number): number => {
        return sum + count;
      },
      0,
    );

    expect(breakdownTotal).toBe(counts.total);
    // A type this build has no descriptor for is kept, for the "Other" group.
    expect(counts.countsByType["some.future.type"]).toBe(3);
  });

  test("a group with no type counts towards every tile but has no breakdown row", () => {
    const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
      {
        entityType: null,
        itemCount: "2",
        discoveredCount: "2",
        staleCount: "1",
      },
      { entityType: "", itemCount: "1", manualCount: "1" },
    ]);

    expect(counts.total).toBe(3);
    expect(counts.discovered).toBe(2);
    expect(counts.manual).toBe(1);
    expect(counts.stale).toBe(1);
    expect(counts.countsByType).toEqual({});
  });

  test("rows of an unrecognised source count in the total and in no source tile", () => {
    // The database only puts a row in a source bucket its FILTER names.
    const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
      {
        entityType: EntityType.Service,
        itemCount: "5",
        discoveredCount: "3",
        mirroredCount: "0",
        manualCount: "0",
        staleCount: "0",
      },
    ]);

    expect(counts.total).toBe(5);
    expect(counts.discovered + counts.mirrored + counts.manual).toBe(3);
  });

  test("missing and unparseable columns read as zero", () => {
    const counts: InventoryOverviewCounts = readInventoryOverviewGroups([
      {
        entityType: EntityType.Service,
        itemCount: "not a number",
        discoveredCount: null,
      },
    ]);

    expect(counts.total).toBe(0);
    expect(counts.discovered).toBe(0);
    expect(counts.countsByType).toEqual({});
  });
});
