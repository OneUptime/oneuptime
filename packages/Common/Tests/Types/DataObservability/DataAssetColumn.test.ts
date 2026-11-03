import { describe, expect, test } from "@jest/globals";
import {
  DataAssetColumn,
  DataAssetColumnChange,
  DataAssetColumnChangeKind,
  diffDataAssetColumns,
  isBreakingColumnChange,
  MAX_COLUMN_NAME_LENGTH,
  MAX_COLUMNS_PER_DATA_ASSET,
  readDataAssetColumns,
} from "../../../Types/DataObservability/DataAssetColumn";

/*
 * A TABLE'S COLUMNS, COMPARED BETWEEN TWO COLLECTIONS.
 *
 * What a schema change is decides who gets paged: a dropped column breaks
 * readers, an added one does not, and a rename must not be reported as a
 * drop. These pin each case, and the reader that keeps a probe's or a JSON
 * column's list well-formed.
 */

function column(
  name: string,
  dataType: string,
  position: number,
  isNullable: boolean = true,
): DataAssetColumn {
  return { name, dataType, isNullable, position };
}

const ORDERS: Array<DataAssetColumn> = [
  column("id", "bigint", 1, false),
  column("customer_id", "bigint", 2, false),
  column("total", "numeric(10,2)", 3),
  column("created_at", "timestamp with time zone", 4, false),
];

describe("diffDataAssetColumns", () => {
  test("the same columns are no change", () => {
    expect(diffDataAssetColumns(ORDERS, [...ORDERS])).toEqual([]);
  });

  test("a new column is Added, and breaks nothing", () => {
    const changes: Array<DataAssetColumnChange> = diffDataAssetColumns(ORDERS, [
      ...ORDERS,
      column("discount_code", "character varying(32)", 5),
    ]);

    expect(changes).toEqual([
      {
        kind: DataAssetColumnChangeKind.Added,
        column: "discount_code",
        position: 5,
        dataType: "character varying(32)",
        isNullable: true,
      },
    ]);
    expect(isBreakingColumnChange(changes[0]!)).toBe(false);
  });

  test("a column that goes is Removed, and breaks readers", () => {
    const changes: Array<DataAssetColumnChange> = diffDataAssetColumns(
      ORDERS,
      ORDERS.filter((item: DataAssetColumn) => {
        return item.name !== "total";
      }),
    );

    expect(changes).toHaveLength(1);
    expect(changes[0]).toMatchObject({
      kind: DataAssetColumnChangeKind.Removed,
      column: "total",
      previousDataType: "numeric(10,2)",
    });
    expect(isBreakingColumnChange(changes[0]!)).toBe(true);
  });

  test("a column replaced at the same position by one of the same type is Renamed, not dropped and added", () => {
    const renamed: Array<DataAssetColumn> = ORDERS.map(
      (item: DataAssetColumn) => {
        return item.name === "customer_id"
          ? column("account_id", "bigint", 2, false)
          : item;
      },
    );

    expect(diffDataAssetColumns(ORDERS, renamed)).toEqual([
      {
        kind: DataAssetColumnChangeKind.Renamed,
        column: "account_id",
        position: 2,
        previousName: "customer_id",
        dataType: "bigint",
      },
    ]);
  });

  test("a different type at the same position is a drop and an add, not a rename", () => {
    const replaced: Array<DataAssetColumn> = ORDERS.map(
      (item: DataAssetColumn) => {
        return item.name === "total" ? column("note", "text", 3) : item;
      },
    );
    const kinds: Array<DataAssetColumnChangeKind> = diffDataAssetColumns(
      ORDERS,
      replaced,
    ).map((change: DataAssetColumnChange) => {
      return change.kind;
    });

    expect(kinds.sort()).toEqual(
      [
        DataAssetColumnChangeKind.Added,
        DataAssetColumnChangeKind.Removed,
      ].sort(),
    );
  });

  test("a type that moves is TypeChanged, compared without regard to case or spacing", () => {
    const widened: Array<DataAssetColumn> = ORDERS.map(
      (item: DataAssetColumn) => {
        return item.name === "id" ? column("id", "BIGINT ", 1, false) : item;
      },
    );

    expect(diffDataAssetColumns(ORDERS, widened)).toEqual([]);

    const retyped: Array<DataAssetColumn> = ORDERS.map(
      (item: DataAssetColumn) => {
        return item.name === "total"
          ? column("total", "numeric(12,2)", 3)
          : item;
      },
    );

    expect(diffDataAssetColumns(ORDERS, retyped)).toEqual([
      {
        kind: DataAssetColumnChangeKind.TypeChanged,
        column: "total",
        position: 3,
        previousDataType: "numeric(10,2)",
        dataType: "numeric(12,2)",
      },
    ]);
  });

  test("a column that starts allowing empty values breaks readers; one that stops does not", () => {
    const relaxed: Array<DataAssetColumn> = ORDERS.map(
      (item: DataAssetColumn) => {
        return item.name === "customer_id"
          ? column("customer_id", "bigint", 2, true)
          : item;
      },
    );
    const relaxing: DataAssetColumnChange = diffDataAssetColumns(
      ORDERS,
      relaxed,
    )[0]!;

    expect(relaxing.kind).toBe(DataAssetColumnChangeKind.NullabilityChanged);
    expect(isBreakingColumnChange(relaxing)).toBe(true);

    const tightening: DataAssetColumnChange = diffDataAssetColumns(
      relaxed,
      ORDERS,
    )[0]!;

    expect(tightening.isNullable).toBe(false);
    expect(isBreakingColumnChange(tightening)).toBe(false);
  });

  test("names are compared exactly, as PostgreSQL keeps quoted names apart", () => {
    const changes: Array<DataAssetColumnChange> = diffDataAssetColumns(
      [column("UserId", "integer", 1)],
      [column("userid", "integer", 1)],
    );

    expect(changes).toEqual([
      expect.objectContaining({
        kind: DataAssetColumnChangeKind.Renamed,
        previousName: "UserId",
        column: "userid",
      }),
    ]);
  });

  test("changes come back in column order", () => {
    const next: Array<DataAssetColumn> = [
      column("id", "integer", 1, false),
      column("customer_id", "bigint", 2, false),
      column("created_at", "timestamp with time zone", 4, false),
      column("status", "text", 5),
    ];
    const positions: Array<number> = diffDataAssetColumns(ORDERS, next).map(
      (change: DataAssetColumnChange) => {
        return change.position;
      },
    );

    expect(positions).toEqual(
      [...positions].sort((a: number, b: number) => {
        return a - b;
      }),
    );
  });
});

describe("readDataAssetColumns", () => {
  test("keeps well-formed columns, sorted by position", () => {
    expect(
      readDataAssetColumns([
        { name: "b", dataType: "TEXT", isNullable: true, position: 2 },
        { name: "a", dataType: "integer", isNullable: false, position: 1 },
      ]),
    ).toEqual([column("a", "integer", 1, false), column("b", "text", 2, true)]);
  });

  test("drops anything that is not a column, and repeated names", () => {
    expect(
      readDataAssetColumns([
        null,
        "id",
        { dataType: "text" },
        { name: "", dataType: "text" },
        { name: "id", dataType: "integer", position: 1 },
        { name: "id", dataType: "text", position: 2 },
      ]),
    ).toEqual([column("id", "integer", 1, true)]);
  });

  test("reads anything that is not a list as no columns", () => {
    expect(readDataAssetColumns(undefined)).toEqual([]);
    expect(readDataAssetColumns({ id: "integer" })).toEqual([]);
  });

  test("cuts over-long names and keeps at most the columns a table can have", () => {
    const many: Array<unknown> = Array.from(
      { length: MAX_COLUMNS_PER_DATA_ASSET + 50 },
      (_: unknown, index: number) => {
        return { name: `c${index}`, dataType: "int", position: index + 1 };
      },
    );

    expect(readDataAssetColumns(many)).toHaveLength(MAX_COLUMNS_PER_DATA_ASSET);
    expect(
      readDataAssetColumns([{ name: "x".repeat(10_000), dataType: "text" }])[0]!
        .name,
    ).toHaveLength(MAX_COLUMN_NAME_LENGTH);
  });
});
