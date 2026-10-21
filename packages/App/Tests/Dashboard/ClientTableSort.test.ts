import { describe, expect, test } from "@jest/globals";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import {
  ClientSort,
  ClientSortColumns,
  compareText,
  isClientSortKey,
  resolveClientSort,
  sortClientRows,
} from "../../FeatureSet/Dashboard/src/Utils/ClientTableSort";

/*
 * The rules behind the client-side sort of the Docker and Podman Containers
 * and Ceph Daemons lists. The rendered pages are covered by
 * Common/Tests/App/Dashboard/ContainersAndCephDaemonsSorting.test.tsx.
 */

interface Row {
  name: string;
  image: string | null;
  cpu: number | null;
  health: "ok" | "warning" | "error";
}

type SortKey = "name" | "image" | "cpu" | "health";

const SEVERITY: Record<Row["health"], number> = {
  ok: 0,
  warning: 1,
  error: 2,
};

const COLUMNS: ClientSortColumns<Row, SortKey> = {
  name: { firstSortOrder: SortOrder.Ascending },
  image: { firstSortOrder: SortOrder.Ascending },
  cpu: { firstSortOrder: SortOrder.Descending },
  health: {
    firstSortOrder: SortOrder.Descending,
    value: (row: Row): number => {
      return SEVERITY[row.health];
    },
  },
};

function row(
  name: string,
  cpu: number | null,
  image: string | null = "nginx",
  health: Row["health"] = "ok",
): Row {
  return { name: name, image: image, cpu: cpu, health: health };
}

function byName(a: Row, b: Row): number {
  return compareText(a.name, b.name);
}

function sortedNames(
  rows: Array<Row>,
  sortBy: SortKey,
  sortOrder: SortOrder,
): Array<string> {
  return sortClientRows({
    rows: rows,
    columns: COLUMNS,
    sort: { sortBy: sortBy, sortOrder: sortOrder },
    tieBreak: byName,
  }).map((sorted: Row): string => {
    return sorted.name;
  });
}

describe("compareText", () => {
  test("counts the numbers in names, as a reader does", () => {
    expect(["worker10", "worker2", "worker1"].sort(compareText)).toEqual([
      "worker1",
      "worker2",
      "worker10",
    ]);
    expect(["18.2.10", "18.2.4", "17.2.7"].sort(compareText)).toEqual([
      "17.2.7",
      "18.2.4",
      "18.2.10",
    ]);
  });

  test("ignores case for the order, but never calls two different texts equal", () => {
    expect(compareText("Beta", "alpha")).toBeGreaterThan(0);
    expect(compareText("api", "API")).not.toBe(0);
    expect(compareText("API", "api")).toBe(-compareText("api", "API"));
    expect(compareText("rgw.0", "rgw.00")).not.toBe(0);
    expect(compareText("same", "same")).toBe(0);
  });
});

describe("sortClientRows", () => {
  const rows: Array<Row> = [
    row("web", 0.5),
    row("cache", null),
    row("batch-10", 250),
    row("api", 9),
    row("batch-9", 12.35),
  ];

  test("sorts a number column by value, not by its text", () => {
    expect(sortedNames(rows, "cpu", SortOrder.Descending)).toEqual([
      "batch-10",
      "batch-9",
      "api",
      "web",
      "cache",
    ]);
  });

  test("puts a missing value last whichever way the column runs", () => {
    expect(sortedNames(rows, "cpu", SortOrder.Ascending)).toEqual([
      "web",
      "api",
      "batch-9",
      "batch-10",
      "cache",
    ]);
  });

  test("counts zero as a reading, not as a missing one", () => {
    expect(
      sortedNames(
        [row("idle", 0), row("silent", null), row("busy", 3)],
        "cpu",
        SortOrder.Ascending,
      ),
    ).toEqual(["idle", "busy", "silent"]);
  });

  test("treats empty text and a reading that is not a number as missing", () => {
    expect(
      sortedNames(
        [
          row("a", 1, ""),
          row("b", 1, "redis"),
          row("c", 1, null),
          row("d", 1, "  "),
        ],
        "image",
        SortOrder.Descending,
      ),
    ).toEqual(["b", "a", "c", "d"]);
    expect(
      sortedNames(
        [row("nan", Number.NaN), row("one", 1), row("inf", Infinity)],
        "cpu",
        SortOrder.Descending,
      ),
    ).toEqual(["one", "inf", "nan"]);
  });

  test("reads a column's own value when it has one", () => {
    const fleet: Array<Row> = [
      row("a", 1, "x", "ok"),
      row("b", 1, "x", "error"),
      row("c", 1, "x", "warning"),
    ];

    expect(sortedNames(fleet, "health", SortOrder.Descending)).toEqual([
      "b",
      "c",
      "a",
    ]);
  });

  test("ties keep the tie-break order both ways round", () => {
    const tied: Array<Row> = [
      row("c", 5),
      row("a", 5),
      row("b", 7),
      row("d", 5),
    ];

    expect(sortedNames(tied, "cpu", SortOrder.Descending)).toEqual([
      "b",
      "a",
      "c",
      "d",
    ]);
    expect(sortedNames(tied, "cpu", SortOrder.Ascending)).toEqual([
      "a",
      "c",
      "d",
      "b",
    ]);
  });

  test("sorts a copy and leaves the rows as they were", () => {
    const before: Array<string> = rows.map((original: Row): string => {
      return original.name;
    });

    sortedNames(rows, "name", SortOrder.Descending);

    expect(
      rows.map((original: Row): string => {
        return original.name;
      }),
    ).toEqual(before);
  });
});

describe("resolveClientSort", () => {
  const byNameAscending: ClientSort<SortKey> = {
    sortBy: "name",
    sortOrder: SortOrder.Ascending,
  };

  test("a newly picked column opens its own way, whatever the header asks", () => {
    // The header flips the last direction: after name A to Z it asks for descending.
    expect(
      resolveClientSort({
        columns: COLUMNS,
        current: byNameAscending,
        requestedSortBy: "image",
        requestedSortOrder: SortOrder.Descending,
      }),
    ).toEqual({ sortBy: "image", sortOrder: SortOrder.Ascending });

    // After CPU busiest first it asks for ascending; Health still opens worst first.
    expect(
      resolveClientSort({
        columns: COLUMNS,
        current: { sortBy: "cpu", sortOrder: SortOrder.Descending },
        requestedSortBy: "health",
        requestedSortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ sortBy: "health", sortOrder: SortOrder.Descending });
  });

  test("clicking the sorted column again flips it, as the header asks", () => {
    expect(
      resolveClientSort({
        columns: COLUMNS,
        current: byNameAscending,
        requestedSortBy: "name",
        requestedSortOrder: SortOrder.Descending,
      }),
    ).toEqual({ sortBy: "name", sortOrder: SortOrder.Descending });
  });

  test("a key that is not a sortable column leaves the sort as it was", () => {
    for (const requested of [null, undefined, "", "actions", "toString", 3]) {
      expect(
        resolveClientSort({
          columns: COLUMNS,
          current: byNameAscending,
          requestedSortBy: requested,
          requestedSortOrder: SortOrder.Descending,
        }),
      ).toBe(byNameAscending);
    }
  });
});

describe("isClientSortKey", () => {
  test("knows exactly the sortable columns", () => {
    expect(
      ["name", "image", "cpu", "health"].every((key: string): boolean => {
        return isClientSortKey(COLUMNS, key);
      }),
    ).toBe(true);
    expect(isClientSortKey(COLUMNS, "constructor")).toBe(false);
    expect(isClientSortKey(COLUMNS, "status")).toBe(false);
  });
});
