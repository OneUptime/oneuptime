import InventoryItemService from "../../../../Server/Services/InventoryItemService";
import AggregateBy, {
  AggregateRow,
} from "../../../../Server/Types/Database/AggregateBy";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import {
  INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT,
  INVENTORY_PLACEMENT_OPTIONS_MAX_LIMIT,
  INVENTORY_PLACEMENT_OPTIONS_ORDER,
  INVENTORY_PLACEMENT_OPTIONS_SELECT,
  INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH,
  getInventoryPlacementOptionsGroupBy,
  getInventoryPlacementOptionsLimit,
  getInventoryPlacementSearch,
  readInventoryPlacementOptions,
} from "../../../../Server/Utils/Inventory/InventoryPlacementOptions";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotNull from "../../../../Types/BaseDatabase/NotNull";
import Search from "../../../../Types/BaseDatabase/Search";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import {
  INVENTORY_PLACEMENT_LEVELS,
  INVENTORY_PLACEMENT_LEVEL_COLUMNS,
  InventoryPlacementLevel,
  getInventoryPlacementSql,
} from "../../../../Utils/Inventory/InventoryItemPlacement";
import { getTableColumns } from "../../../../Types/Database/TableColumn";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * What Inventory's Cluster, Host and Datacenter chips offer (#11470): one
 * aggregate over the list's items, grouped by the same place the filter
 * matches, counted, in name order, read through the permission pipeline
 * as the caller. The SQL runs on Postgres in InventoryPlacementPostgres.
 */

describe("the aggregate", () => {
  test("groups by the place the filter matches, for each level", () => {
    for (const level of INVENTORY_PLACEMENT_LEVELS) {
      expect(getInventoryPlacementOptionsGroupBy(level)).toEqual([
        {
          expression: getInventoryPlacementSql(`"InventoryItem"`, level),
          alias: "place",
        },
      ]);
    }
  });

  test("counts the items of each place, in name order", () => {
    expect(INVENTORY_PLACEMENT_OPTIONS_SELECT).toEqual([
      { expression: "COUNT(*)", alias: "itemCount" },
    ]);
    expect(INVENTORY_PLACEMENT_OPTIONS_ORDER).toEqual([
      { expression: `"place"`, sortOrder: SortOrder.Ascending },
    ]);
  });
});

describe("reading the answer", () => {
  test("each place with its count, as Postgres hands COUNT back (as text)", () => {
    expect(
      readInventoryPlacementOptions([
        { place: "esx-node-07.acme.lan", itemCount: "10250" },
        { place: "esx-node-08.acme.lan", itemCount: 302 },
      ]),
    ).toEqual([
      { value: "esx-node-07.acme.lan", count: 10250 },
      { value: "esx-node-08.acme.lan", count: 302 },
    ]);
  });

  test("a group with no place is no choice", () => {
    expect(
      readInventoryPlacementOptions([
        { place: null, itemCount: "9" },
        { place: "", itemCount: "1" },
        { place: "cluster-alpha", itemCount: "4" },
      ] as Array<AggregateRow>),
    ).toEqual([{ value: "cluster-alpha", count: 4 }]);
  });
});

describe("what a request may ask", () => {
  test("a page of 1 to 100 choices, 50 unless it says", () => {
    expect(INVENTORY_PLACEMENT_OPTIONS_DEFAULT_LIMIT).toBe(50);
    expect(INVENTORY_PLACEMENT_OPTIONS_MAX_LIMIT).toBe(100);
    expect(getInventoryPlacementOptionsLimit(25)).toBe(25);
    expect(getInventoryPlacementOptionsLimit(250)).toBe(100);
    expect(getInventoryPlacementOptionsLimit(0)).toBe(1);
    expect(getInventoryPlacementOptionsLimit(3.9)).toBe(3);
    expect(getInventoryPlacementOptionsLimit("25")).toBe(50);
    expect(getInventoryPlacementOptionsLimit(Number.POSITIVE_INFINITY)).toBe(
      50,
    );
    expect(getInventoryPlacementOptionsLimit(undefined)).toBe(50);
  });

  test("what is typed, trimmed and no longer than any name", () => {
    expect(getInventoryPlacementSearch("  esx-07 ")).toBe("esx-07");
    expect(getInventoryPlacementSearch("   ")).toBe("");
    expect(getInventoryPlacementSearch(undefined)).toBe("");
    expect(getInventoryPlacementSearch(42)).toBe("");
    expect(
      getInventoryPlacementSearch("y".repeat(INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH * 2)),
    ).toHaveLength(INVENTORY_PLACEMENT_SEARCH_MAX_LENGTH);
  });
});

describe("InventoryItemService.getPlacementOptions", () => {
  const projectId: ObjectID = ObjectID.generate();
  const props: DatabaseCommonInteractionProps = {
    tenantId: projectId,
    userId: ObjectID.generate(),
  };

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function spyAggregate(
    rows: Array<AggregateRow>,
  ): jest.SpiedFunction<typeof InventoryItemService.aggregateBy> {
    return jest
      .spyOn(InventoryItemService, "aggregateBy")
      .mockResolvedValue(rows);
  }

  test("reads the list's items of the project, as the caller, with a place at the level", async () => {
    const aggregate: jest.SpiedFunction<typeof InventoryItemService.aggregateBy> =
      spyAggregate([{ place: "cluster-alpha", itemCount: "10552" }]);

    expect(
      await InventoryItemService.getPlacementOptions({
        projectId,
        level: InventoryPlacementLevel.Cluster,
        search: "",
        isArchived: false,
        limit: 50,
        props,
      }),
    ).toEqual([{ value: "cluster-alpha", count: 10552 }]);

    const read: AggregateBy<InventoryItem> = aggregate.mock.calls[0]![0];
    expect(read.props).toBe(props);
    expect(read.limit).toBe(50);
    expect(read.groupBy).toEqual(
      getInventoryPlacementOptionsGroupBy(InventoryPlacementLevel.Cluster),
    );
    expect(read.select).toEqual(INVENTORY_PLACEMENT_OPTIONS_SELECT);
    expect(read.orderBy).toEqual(INVENTORY_PLACEMENT_OPTIONS_ORDER);
    const query: Record<string, unknown> = read.query as Record<
      string,
      unknown
    >;
    expect(query["projectId"]).toBe(projectId);
    expect(query["isArchived"]).toBe(false);
    expect(query["placementCluster"]).toBeInstanceOf(NotNull);
    expect(Object.keys(query).sort()).toEqual(
      ["isArchived", "placementCluster", "projectId"].sort(),
    );
  });

  test("what is typed narrows the places, on the level's own column", async () => {
    const aggregate: jest.SpiedFunction<typeof InventoryItemService.aggregateBy> =
      spyAggregate([]);
    await InventoryItemService.getPlacementOptions({
      projectId,
      level: InventoryPlacementLevel.Host,
      search: "esx-07",
      isArchived: true,
      limit: 10,
      props,
    });
    const query: Record<string, unknown> = aggregate.mock.calls[0]![0]
      .query as Record<string, unknown>;
    expect(query["placementHost"]).toBeInstanceOf(Search);
    expect((query["placementHost"] as Search<string>).toString()).toBe(
      "esx-07",
    );
    expect(query["isArchived"]).toBe(true);
    expect(query["placementCluster"]).toBeUndefined();
  });
});

describe("the InventoryItem columns the chips filter on", () => {
  test("are read-only, computed at read time, one per level", () => {
    const columns: Record<string, { title?: string; type?: string }> =
      getTableColumns(new InventoryItem()) as unknown as Record<
        string,
        { title?: string; type?: string }
      >;
    const model: InventoryItem = new InventoryItem();
    for (const level of INVENTORY_PLACEMENT_LEVELS) {
      const column: string = INVENTORY_PLACEMENT_LEVEL_COLUMNS[level];
      expect(columns[column]).toBeDefined();
      expect(model.getColumnAccessControlFor(column)?.create).toEqual([]);
      expect(model.getColumnAccessControlFor(column)?.update).toEqual([]);
      expect(
        (model.getColumnAccessControlFor(column)?.read || []).length,
      ).toBeGreaterThan(0);
    }
    expect(columns["placementCluster"]?.title).toBe("Cluster");
    expect(columns["placementHost"]?.title).toBe("Host");
    expect(columns["placementDatacenter"]?.title).toBe("Datacenter");
  });
});
