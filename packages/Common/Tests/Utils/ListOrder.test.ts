import SortOrder from "../../Types/BaseDatabase/SortOrder";
import {
  ListOrderChange,
  ListOrderItem,
  ListOrderMove,
  compareListOrderItems,
  compareListOrderValues,
  getListOrderAppendValue,
  getListOrderReadSort,
  getListOrderChanges,
  getListOrderCollisionChanges,
  getListOrderMoveChanges,
  getListOrderValue,
  moveListItem,
  needsListOrderNormalization,
  sortListOrderItems,
  toListOrderNumber,
} from "../../Utils/ListOrder";
import { describe, expect, test } from "@jest/globals";

/*
 * The arithmetic every drag-ordered list shares (custom fields, rules,
 * pipelines, status page links): the server keeps the numbers with it and
 * the dashboard's tables show the list with it.
 *
 * The contract pinned here (issue #9609):
 *   - lower numbers first (highest first for a list that counts down), two
 *     rows at one number the older first;
 *   - a row without a number goes to the end;
 *   - a move (getListOrderMoveChanges, what a drop sends) takes the row to
 *     the place of the row named, the rows between stepping aside, and
 *     numbers the list 1..n (n..1 counting down) - so every drop lands where
 *     it was dropped, gaps, twins and rows without a number included;
 *   - a row the server places just above another (a new state above the
 *     resolved state) makes room for itself: the rows in the way step aside
 *     one place, along a run, until a free number
 *     (getListOrderCollisionChanges). A number a caller writes is never
 *     taken that way: it is kept as written, beside whoever holds it.
 */

type Row = ListOrderItem & { name: string };

const row: (name: string, value: number | null, createdAt?: string) => Row = (
  name: string,
  value: number | null,
  createdAt?: string,
): Row => {
  return {
    id: name,
    name: name,
    value: value,
    createdAt: createdAt || null,
  };
};

// The list the changes leave behind, top first, as names.
const applyChanges: (
  rows: Array<Row>,
  changes: Array<ListOrderChange>,
  moved?: { id: string; value: number },
  sortOrder?: SortOrder,
) => Array<string> = (
  rows: Array<Row>,
  changes: Array<ListOrderChange>,
  moved?: { id: string; value: number },
  sortOrder: SortOrder = SortOrder.Ascending,
): Array<string> => {
  const byId: Map<string, Row> = new Map();

  for (const item of rows) {
    byId.set(item.id, { ...item });
  }

  if (moved) {
    const existing: Row | undefined = byId.get(moved.id);
    byId.set(moved.id, {
      ...(existing || row(moved.id, null)),
      value: moved.value,
    });
  }

  for (const change of changes) {
    byId.set(change.id, { ...byId.get(change.id)!, value: change.value });
  }

  return sortListOrderItems(Array.from(byId.values()), sortOrder).map(
    (item: Row) => {
      return item.id;
    },
  );
};

// The numbers a list holds after the changes, by name.
const valuesAfter: (
  rows: Array<Row>,
  changes: Array<ListOrderChange>,
  moved?: { id: string; value: number },
) => Record<string, number | null> = (
  rows: Array<Row>,
  changes: Array<ListOrderChange>,
  moved?: { id: string; value: number },
): Record<string, number | null> => {
  const values: Record<string, number | null> = {};

  for (const item of rows) {
    values[item.id] = toListOrderNumber(item.value);
  }

  if (moved) {
    values[moved.id] = moved.value;
  }

  for (const change of changes) {
    values[change.id] = change.value;
  }

  return values;
};

describe("toListOrderNumber", () => {
  test.each([
    [3, 3],
    [0, 0],
    [-2, -2],
    [1.5, 1.5],
    ["4", 4],
    [" 7 ", 7],
  ])("reads %p as %p", (input: unknown, expected: number) => {
    expect(toListOrderNumber(input)).toBe(expected);
  });

  test.each([
    [null],
    [undefined],
    [""],
    ["   "],
    ["first"],
    [NaN],
    [Infinity],
    [{}],
    [[1]],
    [true],
  ])("treats %p as no number", (input: unknown) => {
    expect(toListOrderNumber(input)).toBeNull();
  });
});

describe("compareListOrderItems and sortListOrderItems", () => {
  test("puts lower numbers first in a list that counts up", () => {
    expect(
      sortListOrderItems(
        [row("c", 3), row("a", 1), row("b", 2)],
        SortOrder.Ascending,
      ).map((item: Row) => {
        return item.id;
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("puts higher numbers first in a list that counts down", () => {
    expect(
      sortListOrderItems(
        [row("low", 1), row("high", 9), row("mid", 5)],
        SortOrder.Descending,
      ).map((item: Row) => {
        return item.id;
      }),
    ).toEqual(["high", "mid", "low"]);
  });

  test("puts rows without a number last, whichever way the list counts", () => {
    for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
      expect(
        sortListOrderItems(
          [row("none", null), row("two", 2), row("one", 1)],
          sortOrder,
        )[2]!.id,
      ).toBe("none");
    }
  });

  test("breaks a tie by the older row first", () => {
    expect(
      sortListOrderItems(
        [
          row("newer", 1, "2026-02-01T00:00:00.000Z"),
          row("older", 1, "2026-01-01T00:00:00.000Z"),
        ],
        SortOrder.Ascending,
      ).map((item: Row) => {
        return item.id;
      }),
    ).toEqual(["older", "newer"]);
  });

  test("orders rows without a number by age too, so the order is stable", () => {
    expect(
      sortListOrderItems(
        [
          row("b", null, "2026-03-01T00:00:00.000Z"),
          row("a", null, "2026-01-01T00:00:00.000Z"),
          row("c", null),
        ],
        SortOrder.Ascending,
      ).map((item: Row) => {
        return item.id;
      }),
    ).toEqual(["a", "b", "c"]);
  });

  test("falls back to the id when number and age are the same, so two calls never disagree", () => {
    const a: Row = row("a", 1, "2026-01-01T00:00:00.000Z");
    const b: Row = row("b", 1, "2026-01-01T00:00:00.000Z");

    expect(compareListOrderItems(a, b, SortOrder.Ascending)).toBeLessThan(0);
    expect(compareListOrderItems(b, a, SortOrder.Ascending)).toBeGreaterThan(0);
    expect(compareListOrderItems(a, a, SortOrder.Ascending)).toBe(0);
  });

  test("reads Date objects as well as ISO strings", () => {
    const older: ListOrderItem = {
      id: "older",
      value: 2,
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
    };
    const newer: ListOrderItem = {
      id: "newer",
      value: 2,
      createdAt: "2026-06-01T00:00:00.000Z",
    };

    expect(
      compareListOrderItems(older, newer, SortOrder.Ascending),
    ).toBeLessThan(0);
  });

  test("does not mutate the list it sorts", () => {
    const rows: Array<Row> = [row("b", 2), row("a", 1)];

    sortListOrderItems(rows, SortOrder.Ascending);

    expect(
      rows.map((item: Row) => {
        return item.id;
      }),
    ).toEqual(["b", "a"]);
  });
});

/*
 * THE ONE RULE FOR A ROW WITHOUT A NUMBER (issue #9655): after every row
 * that has one, whichever way the list counts. Readers that compare numbers
 * themselves - which config a host runs, the order a note's approval steps
 * go in, which naming or site rule is tried first - compare them with it,
 * where each used to make up a place of its own (its index in a read, 0).
 */
describe("compareListOrderValues: a row without a number comes last", () => {
  const NO_NUMBER: Array<unknown> = [null, undefined, Number.NaN, "", "x", {}];

  test("puts the top first: lower numbers counting up, higher counting down", () => {
    expect(compareListOrderValues(1, 2, SortOrder.Ascending)).toBeLessThan(0);
    expect(compareListOrderValues(2, 1, SortOrder.Ascending)).toBeGreaterThan(
      0,
    );
    expect(compareListOrderValues(9, 2, SortOrder.Descending)).toBeLessThan(0);
    expect(compareListOrderValues(2, 9, SortOrder.Descending)).toBeGreaterThan(
      0,
    );
  });

  test.each(NO_NUMBER)(
    "puts %p after every number, whichever way the list counts",
    (missing: unknown) => {
      for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
        for (const value of [-100, -1, 0, 1, 3, 10, 1000]) {
          expect(
            compareListOrderValues(value, missing, sortOrder),
          ).toBeLessThan(0);
          expect(
            compareListOrderValues(missing, value, sortOrder),
          ).toBeGreaterThan(0);
        }
      }
    },
  );

  test("is a tie for two rows at one number, and for two without one: the caller breaks it", () => {
    expect(compareListOrderValues(3, 3, SortOrder.Ascending)).toBe(0);
    expect(compareListOrderValues(3, "3", SortOrder.Descending)).toBe(0);
    expect(compareListOrderValues(null, undefined, SortOrder.Ascending)).toBe(
      0,
    );
  });

  test("never puts a row without a number at 0 or at its place in a read", () => {
    // Numbered 10, 20 and 30 with gaps, as Terraform may leave a list.
    const values: Array<number | null> = [null, 30, 10, 20];

    expect(
      [...values].sort((a: number | null, b: number | null): number => {
        return compareListOrderValues(a, b, SortOrder.Ascending);
      }),
    ).toEqual([10, 20, 30, null]);
    expect(
      [...values].sort((a: number | null, b: number | null): number => {
        return compareListOrderValues(a, b, SortOrder.Descending);
      }),
    ).toEqual([30, 20, 10, null]);
  });

  test("is what compareListOrderItems orders by before age", () => {
    const rows: Array<Row> = [
      row("none-old", null, "2026-01-01T00:00:00.000Z"),
      row("two", 2, "2026-01-05T00:00:00.000Z"),
      row("none-new", null, "2026-01-09T00:00:00.000Z"),
      row("one", 1, "2026-01-07T00:00:00.000Z"),
    ];

    for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
      const sorted: Array<Row> = sortListOrderItems(rows, sortOrder);

      for (let i: number = 1; i < sorted.length; i++) {
        expect(
          compareListOrderValues(
            sorted[i - 1]!.value,
            sorted[i]!.value,
            sortOrder,
          ),
        ).toBeLessThanOrEqual(0);
      }

      expect(
        sorted.slice(2).map((item: Row) => {
          return item.id;
        }),
      ).toEqual(["none-old", "none-new"]);
    }
  });
});

/*
 * THE ORDER THE SERVER READS A LIST'S ROWS IN (issue #9654). A lookup of a
 * project's created state, scheduled state or operational status by its
 * flag alone asked for no order, and a read in no order came newest first:
 * a project with two created states started every new incident in the
 * newer one, wherever it stood in the list. DatabaseService.getReadSort now
 * reads a drag-ordered list's rows the way the list shows them.
 */
describe("getListOrderReadSort", () => {
  const ascending: (
    sort: Record<string, unknown> | undefined | null,
  ) => unknown = (
    sort: Record<string, unknown> | undefined | null,
  ): unknown => {
    return getListOrderReadSort({
      sort: sort,
      column: "order",
      sortOrder: SortOrder.Ascending,
    });
  };

  const descending: (
    sort: Record<string, unknown> | undefined | null,
  ) => unknown = (
    sort: Record<string, unknown> | undefined | null,
  ): unknown => {
    return getListOrderReadSort({
      sort: sort,
      column: "priority",
      sortOrder: SortOrder.Descending,
    });
  };

  test.each([[undefined], [null], [{}], [{ order: undefined }]])(
    "reads a list asked for in no order (%p) in its own order: the top first, twins the older first",
    (sort: Record<string, unknown> | undefined | null) => {
      expect(ascending(sort)).toEqual({
        order: SortOrder.Ascending,
        createdAt: SortOrder.Ascending,
      });
    },
  );

  test("reads a list that counts down from its highest number", () => {
    expect(descending(undefined)).toEqual({
      priority: SortOrder.Descending,
      createdAt: SortOrder.Ascending,
    });
  });

  test("breaks a tie at the list's number the way the list does, read top first", () => {
    expect(ascending({ order: SortOrder.Ascending })).toEqual({
      order: SortOrder.Ascending,
      createdAt: SortOrder.Ascending,
    });
    expect(descending({ priority: SortOrder.Descending })).toEqual({
      priority: SortOrder.Descending,
      createdAt: SortOrder.Ascending,
    });
    expect(
      ascending({ isEnabled: SortOrder.Descending, order: "asc" }),
    ).toEqual({
      isEnabled: SortOrder.Descending,
      order: "asc",
      createdAt: SortOrder.Ascending,
    });
  });

  test("reads the list from the bottom up exactly in reverse: twins the newer first, then the higher id", () => {
    // "The least severe severity": the last row the list shows.
    expect(ascending({ order: SortOrder.Descending })).toEqual({
      order: SortOrder.Descending,
      createdAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
    expect(descending({ priority: SortOrder.Ascending })).toEqual({
      priority: SortOrder.Ascending,
      createdAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
  });

  test("reads a direction given with where nulls go", () => {
    expect(ascending({ order: { direction: "DESC", nulls: "LAST" } })).toEqual({
      order: { direction: "DESC", nulls: "LAST" },
      createdAt: SortOrder.Descending,
      _id: SortOrder.Descending,
    });
  });

  test.each([
    [{ createdAt: SortOrder.Descending }],
    [{ name: SortOrder.Ascending }],
    [{ order: SortOrder.Ascending, name: SortOrder.Ascending }],
    [{ order: SortOrder.Ascending, createdAt: SortOrder.Descending }],
    [{ order: SortOrder.Ascending, _id: SortOrder.Descending }],
    [{ createdAt: SortOrder.Descending, order: SortOrder.Ascending }],
    [{ order: 1 }],
    [{ incidentSeverity: { order: SortOrder.Ascending } }],
  ])("reads any other order as asked: %p", (sort: Record<string, unknown>) => {
    expect(ascending(sort)).toBe(sort);
  });

  test("leaves the sort it was given as it was", () => {
    const sort: Record<string, unknown> = { order: SortOrder.Descending };

    ascending(sort);

    expect(sort).toEqual({ order: SortOrder.Descending });
  });

  test("agrees with the order the list is shown in, read either way", () => {
    // Twins, a gap and a row without a number, saved in no order.
    const rows: Array<Row> = [
      row("c-newer", 3, "2026-01-09T00:00:00.000Z"),
      row("none", null, "2026-01-02T00:00:00.000Z"),
      row("a", 1, "2026-01-05T00:00:00.000Z"),
      row("c-older", 3, "2026-01-03T00:00:00.000Z"),
      row("e", 5, "2026-01-01T00:00:00.000Z"),
    ];

    // As Postgres orders: NULLS LAST ascending and NULLS FIRST descending.
    const readAs: (sort: Record<string, unknown>) => Array<string> = (
      sort: Record<string, unknown>,
    ): Array<string> => {
      return [...rows]
        .sort((a: Row, b: Row): number => {
          for (const [column, value] of Object.entries(sort)) {
            const sign: number = value === SortOrder.Descending ? -1 : 1;
            const left: unknown =
              column === "order"
                ? a.value
                : column === "createdAt"
                  ? a.createdAt
                  : a.id;
            const right: unknown =
              column === "order"
                ? b.value
                : column === "createdAt"
                  ? b.createdAt
                  : b.id;

            if (left === right) {
              continue;
            }

            if (left === null) {
              return sign;
            }

            if (right === null) {
              return -sign;
            }

            return (String(left) < String(right) ? -1 : 1) * sign;
          }

          return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
        })
        .map((item: Row) => {
          return item.id;
        });
    };

    const shown: Array<string> = sortListOrderItems(
      rows,
      SortOrder.Ascending,
    ).map((item: Row) => {
      return item.id;
    });

    expect(shown).toEqual(["a", "c-older", "c-newer", "e", "none"]);
    expect(readAs(ascending(undefined) as Record<string, unknown>)).toEqual(
      shown,
    );
    expect(
      readAs(
        ascending({ order: SortOrder.Descending }) as Record<string, unknown>,
      ),
    ).toEqual([...shown].reverse());
  });
});

describe("getListOrderAppendValue: a new row goes to the end", () => {
  test("is 1 in an empty list", () => {
    expect(
      getListOrderAppendValue({ siblings: [], sortOrder: SortOrder.Ascending }),
    ).toBe(1);
    expect(
      getListOrderAppendValue({
        siblings: [],
        sortOrder: SortOrder.Descending,
      }),
    ).toBe(1);
  });

  test("is one past the last row of a list that counts up", () => {
    expect(
      getListOrderAppendValue({
        siblings: [row("a", 1), row("b", 7), row("c", 3)],
        sortOrder: SortOrder.Ascending,
      }),
    ).toBe(8);
  });

  test("is one below the last row of a list that counts down", () => {
    expect(
      getListOrderAppendValue({
        siblings: [row("a", 5), row("b", 2), row("c", 9)],
        sortOrder: SortOrder.Descending,
      }),
    ).toBe(1);
  });

  test("keeps going below zero in a list that counts down, rather than renumbering the rest", () => {
    expect(
      getListOrderAppendValue({
        siblings: [row("a", 0), row("b", 4)],
        sortOrder: SortOrder.Descending,
      }),
    ).toBe(-1);
  });

  test("ignores rows without a number", () => {
    expect(
      getListOrderAppendValue({
        siblings: [row("a", null), row("b", 2)],
        sortOrder: SortOrder.Ascending,
      }),
    ).toBe(3);
  });

  test("is a whole number after a fractional one", () => {
    expect(
      getListOrderAppendValue({
        siblings: [row("a", 2.5)],
        sortOrder: SortOrder.Ascending,
      }),
    ).toBe(3);
  });

  test("puts the new row after every other row", () => {
    const siblings: Array<Row> = [row("a", 4), row("b", 1), row("c", 9)];
    const value: number = getListOrderAppendValue({
      siblings: siblings,
      sortOrder: SortOrder.Ascending,
    });

    expect(applyChanges(siblings, [], { id: "new", value: value })).toEqual([
      "b",
      "a",
      "c",
      "new",
    ]);
  });
});

describe("getListOrderCollisionChanges in a list numbered 1..n", () => {
  const list: () => Array<Row> = (): Array<Row> => {
    return [row("A", 1), row("B", 2), row("C", 3), row("D", 4), row("E", 5)];
  };

  // Drops a row onto another: the value a table sends is the target's number.
  const drop: (
    rows: Array<Row>,
    movedId: string,
    targetId: string,
  ) => { order: Array<string>; values: Record<string, number | null> } = (
    rows: Array<Row>,
    movedId: string,
    targetId: string,
  ): { order: Array<string>; values: Record<string, number | null> } => {
    const moved: Row = rows.find((item: Row) => {
      return item.id === movedId;
    })!;
    const target: Row = rows.find((item: Row) => {
      return item.id === targetId;
    })!;
    const requested: number = toListOrderNumber(target.value)!;

    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: movedId,
      previousValue: moved.value,
      requestedValue: requested,
      sortOrder: SortOrder.Ascending,
    });

    return {
      order: applyChanges(rows, changes, { id: movedId, value: requested }),
      values: valuesAfter(rows, changes, { id: movedId, value: requested }),
    };
  };

  test("dropping a row on the first row moves it to the top", () => {
    expect(drop(list(), "D", "A").order).toEqual(["D", "A", "B", "C", "E"]);
  });

  test("dropping a row on the last row moves it to the bottom", () => {
    expect(drop(list(), "B", "E").order).toEqual(["A", "C", "D", "E", "B"]);
  });

  test("dropping a row one place up swaps the two", () => {
    expect(drop(list(), "C", "B").order).toEqual(["A", "C", "B", "D", "E"]);
  });

  test("dropping a row one place down swaps the two", () => {
    expect(drop(list(), "B", "C").order).toEqual(["A", "C", "B", "D", "E"]);
  });

  test("a move keeps the numbers 1..n", () => {
    const values: Record<string, number | null> = drop(list(), "E", "B").values;

    expect(
      Object.values(values).sort((a: number | null, b: number | null) => {
        return (a as number) - (b as number);
      }),
    ).toEqual([1, 2, 3, 4, 5]);
    expect(values).toEqual({ A: 1, E: 2, B: 3, C: 4, D: 5 });
  });

  test("only the rows between the old and the new place are written", () => {
    const rows: Array<Row> = list();
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "D",
      previousValue: 4,
      requestedValue: 2,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([
      { id: "B", value: 3 },
      { id: "C", value: 4 },
    ]);
  });

  test("moving down shifts the rows in between up by one", () => {
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: list(),
      itemId: "A",
      previousValue: 1,
      requestedValue: 3,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([
      { id: "C", value: 2 },
      { id: "B", value: 1 },
    ]);
  });

  test("a row given the number it already has moves nothing", () => {
    expect(
      getListOrderCollisionChanges({
        siblings: list(),
        itemId: "C",
        previousValue: 3,
        requestedValue: 3,
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
  });

  test("a string number from a form counts as the same number", () => {
    expect(
      getListOrderCollisionChanges({
        siblings: list(),
        itemId: "C",
        previousValue: 3,
        requestedValue: "3",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
  });

  test("no number asked for moves nothing", () => {
    expect(
      getListOrderCollisionChanges({
        siblings: list(),
        itemId: "C",
        previousValue: 3,
        requestedValue: null,
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
  });

  test("the row being placed is ignored when it is among the siblings", () => {
    const withMoved: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: list(),
      itemId: "E",
      previousValue: 5,
      requestedValue: 1,
      sortOrder: SortOrder.Ascending,
    });
    const withoutMoved: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: list().filter((item: Row) => {
        return item.id !== "E";
      }),
      itemId: "E",
      previousValue: 5,
      requestedValue: 1,
      sortOrder: SortOrder.Ascending,
    });

    expect(withMoved).toEqual(withoutMoved);
    expect(
      withMoved.some((change: ListOrderChange) => {
        return change.id === "E";
      }),
    ).toBe(false);
  });
});

describe("getListOrderCollisionChanges keeps numbers nobody collides with", () => {
  test("a number no row holds moves nothing - an API caller reads back what it wrote", () => {
    expect(
      getListOrderCollisionChanges({
        siblings: [row("A", 10), row("B", 20), row("C", 30)],
        itemId: "C",
        previousValue: 30,
        requestedValue: 15,
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
  });

  test("in a list with gaps, only the row in the way steps aside", () => {
    const rows: Array<Row> = [row("A", 10), row("B", 20), row("C", 30)];
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "C",
      previousValue: 30,
      requestedValue: 10,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([{ id: "A", value: 11 }]);
    expect(applyChanges(rows, changes, { id: "C", value: 10 })).toEqual([
      "C",
      "A",
      "B",
    ]);
  });

  test("moving down into a list with gaps puts the row after the one it was dropped on", () => {
    const rows: Array<Row> = [row("A", 10), row("B", 20), row("C", 30)];
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "A",
      previousValue: 10,
      requestedValue: 30,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([{ id: "C", value: 29 }]);
    expect(applyChanges(rows, changes, { id: "A", value: 30 })).toEqual([
      "B",
      "C",
      "A",
    ]);
  });

  test("a run of neighbours steps along until a free number", () => {
    const rows: Array<Row> = [
      row("A", 10),
      row("B", 11),
      row("C", 12),
      row("D", 20),
      row("X", 30),
    ];
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "X",
      previousValue: 30,
      requestedValue: 10,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([
      { id: "A", value: 11 },
      { id: "B", value: 12 },
      { id: "C", value: 13 },
    ]);
    expect(applyChanges(rows, changes, { id: "X", value: 10 })).toEqual([
      "X",
      "A",
      "B",
      "C",
      "D",
    ]);
  });

  test("a new row given a taken number pushes the rest down from there", () => {
    const rows: Array<Row> = [row("A", 1), row("B", 2), row("C", 3)];
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "new",
      previousValue: null,
      requestedValue: 2,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([
      { id: "B", value: 3 },
      { id: "C", value: 4 },
    ]);
    expect(applyChanges(rows, changes, { id: "new", value: 2 })).toEqual([
      "A",
      "new",
      "B",
      "C",
    ]);
  });

  test("a row without a number is never in the way", () => {
    expect(
      getListOrderCollisionChanges({
        siblings: [row("A", 1), row("none", null)],
        itemId: "new",
        previousValue: null,
        requestedValue: 2,
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
  });

  test("rows sharing the number in the way step aside together", () => {
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: [row("A", 1), row("B", 1), row("C", 5)],
      itemId: "C",
      previousValue: 5,
      requestedValue: 1,
      sortOrder: SortOrder.Ascending,
    });

    expect(changes).toEqual([
      { id: "A", value: 2 },
      { id: "B", value: 2 },
    ]);
  });
});

describe("getListOrderCollisionChanges in a list that counts down (highest wins)", () => {
  const list: () => Array<Row> = (): Array<Row> => {
    // Top to bottom: A (3), B (2), C (1).
    return [row("A", 3), row("B", 2), row("C", 1)];
  };

  test("dropping the bottom row on the top one makes it the top", () => {
    const rows: Array<Row> = list();
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "C",
      previousValue: 1,
      requestedValue: 3,
      sortOrder: SortOrder.Descending,
    });

    expect(changes).toEqual([
      { id: "A", value: 2 },
      { id: "B", value: 1 },
    ]);
    expect(
      applyChanges(rows, changes, { id: "C", value: 3 }, SortOrder.Descending),
    ).toEqual(["C", "A", "B"]);
  });

  test("dropping the top row on the bottom one makes it the bottom", () => {
    const rows: Array<Row> = list();
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "A",
      previousValue: 3,
      requestedValue: 1,
      sortOrder: SortOrder.Descending,
    });

    expect(changes).toEqual([
      { id: "C", value: 2 },
      { id: "B", value: 3 },
    ]);
    expect(
      applyChanges(rows, changes, { id: "A", value: 1 }, SortOrder.Descending),
    ).toEqual(["B", "C", "A"]);
  });

  test("a new rule given a taken number pushes the rules below it further down", () => {
    const rows: Array<Row> = list();
    const changes: Array<ListOrderChange> = getListOrderCollisionChanges({
      siblings: rows,
      itemId: "new",
      previousValue: null,
      requestedValue: 2,
      sortOrder: SortOrder.Descending,
    });

    expect(changes).toEqual([
      { id: "B", value: 1 },
      { id: "C", value: 0 },
    ]);
    expect(
      applyChanges(
        rows,
        changes,
        { id: "new", value: 2 },
        SortOrder.Descending,
      ),
    ).toEqual(["A", "new", "B", "C"]);
  });
});

// A move's changes, or a failure of the test when it is no move.
const changesOf: (move: ListOrderMove) => Array<ListOrderChange> = (
  move: ListOrderMove,
): Array<ListOrderChange> => {
  if (move.kind !== "moved") {
    throw new Error(`Expected a move, got ${move.kind}`);
  }

  return move.changes;
};

describe("every drop in a 1..n list lands where it was dropped", () => {
  /*
   * Exhaustive over a five-row list: every row dropped on every other row,
   * both directions, both ways of counting. The result has to be exactly
   * what the table showed when the row was let go (moveListItem), the
   * numbers have to stay unique, and only the rows between the two places
   * may be written.
   */
  for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
    const rows: Array<Row> = ["A", "B", "C", "D", "E"].map(
      (name: string, index: number) => {
        return row(
          name,
          getListOrderValue({
            position: index + 1,
            count: 5,
            sortOrder: sortOrder,
          }),
        );
      },
    );

    for (let from: number = 0; from < rows.length; from++) {
      for (let to: number = 0; to < rows.length; to++) {
        if (from === to) {
          continue;
        }

        test(`${sortOrder}: row ${from + 1} dropped on row ${to + 1}`, () => {
          const moved: Row = rows[from]!;
          const changes: Array<ListOrderChange> = changesOf(
            getListOrderMoveChanges({
              items: rows,
              itemId: moved.id,
              placeOfId: rows[to]!.id,
              sortOrder: sortOrder,
            }),
          );

          const expected: Array<string> = moveListItem(rows, from, to).map(
            (item: Row) => {
              return item.id;
            },
          );

          expect(applyChanges(rows, changes, undefined, sortOrder)).toEqual(
            expected,
          );

          const values: Array<number | null> = Object.values(
            valuesAfter(rows, changes),
          );
          expect(new Set(values).size).toBe(rows.length);

          // The rows between the two places, the moved one among them, and no other.
          expect(changes).toHaveLength(Math.abs(from - to) + 1);
        });
      }
    }
  }
});

describe("getListOrderMoveChanges in a list that is not numbered 1..n", () => {
  /*
   * Every arrangement a list written through the API can be in - gaps,
   * twins (read the older first), rows without a number (at the bottom) -
   * for lists of one to five rows, both ways of counting: every row moved
   * to every other row's place lands exactly where the list showed that
   * row, and the list comes out numbered 1..n (n..1 counting down), only
   * the rows whose number changes written.
   */
  const NUMBERINGS: Array<Array<number | null>> = [
    [1],
    [null],
    [1, 1],
    [5, null],
    [10, 20, 30],
    [2, 2, 2],
    [1, null, 1],
    [3, 1, 2, 2],
    [10, null, 10, 4],
    [1, 2, 3, 4, 5],
    [7, 7, null, 2, 9],
    [null, null, 3, 3, 1],
  ];

  for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
    for (const numbering of NUMBERINGS) {
      const rows: Array<Row> = numbering.map(
        (value: number | null, index: number): Row => {
          // Created one minute apart, the first row first.
          return row(
            `R${index}`,
            value,
            new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
          );
        },
      );
      const shown: Array<Row> = sortListOrderItems(rows, sortOrder);

      for (let from: number = 0; from < shown.length; from++) {
        for (let to: number = 0; to < shown.length; to++) {
          test(`${sortOrder} [${numbering.join(", ")}]: shown row ${from + 1} moved to shown row ${to + 1}`, () => {
            const changes: Array<ListOrderChange> = changesOf(
              getListOrderMoveChanges({
                items: rows,
                itemId: shown[from]!.id,
                placeOfId: shown[to]!.id,
                sortOrder: sortOrder,
              }),
            );

            if (from === to) {
              expect(changes).toEqual([]);
              return;
            }

            const expected: Array<string> = moveListItem(shown, from, to).map(
              (item: Row): string => {
                return item.id;
              },
            );

            expect(applyChanges(rows, changes, undefined, sortOrder)).toEqual(
              expected,
            );

            const values: Record<string, number | null> = valuesAfter(
              rows,
              changes,
            );

            expected.forEach((id: string, index: number) => {
              expect([id, values[id]]).toEqual([
                id,
                getListOrderValue({
                  position: index + 1,
                  count: expected.length,
                  sortOrder: sortOrder,
                }),
              ]);
            });

            // Only the rows whose number changes are written.
            for (const change of changes) {
              const before: Row = rows.find((item: Row): boolean => {
                return item.id === change.id;
              })!;

              expect(toListOrderNumber(before.value)).not.toBe(change.value);
            }
          });
        }
      }
    }
  }
});

describe("getListOrderMoveChanges", () => {
  const rows: Array<Row> = [row("a", 1), row("b", 2), row("c", 3)];

  test("names the rows by id, however a caller wrote one", () => {
    const upper: Array<Row> = [
      row("1c000000-0000-4000-8000-0000000000aa", 1),
      row("1c000000-0000-4000-8000-0000000000bb", 2),
    ];

    expect(
      getListOrderMoveChanges({
        items: upper,
        itemId: " 1C000000-0000-4000-8000-0000000000BB ",
        placeOfId: "1C000000-0000-4000-8000-0000000000AA",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({
      kind: "moved",
      changes: [
        { id: "1c000000-0000-4000-8000-0000000000bb", value: 1 },
        { id: "1c000000-0000-4000-8000-0000000000aa", value: 2 },
      ],
    });
  });

  test("moves a row up to just above the row named, and down to just below it", () => {
    expect(
      getListOrderMoveChanges({
        items: rows,
        itemId: "c",
        placeOfId: "a",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({
      kind: "moved",
      changes: [
        { id: "c", value: 1 },
        { id: "a", value: 2 },
        { id: "b", value: 3 },
      ],
    });

    expect(
      getListOrderMoveChanges({
        items: rows,
        itemId: "a",
        placeOfId: "b",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({
      kind: "moved",
      changes: [
        { id: "b", value: 1 },
        { id: "a", value: 2 },
      ],
    });
  });

  test("changes nothing for a move to the row's own place", () => {
    expect(
      getListOrderMoveChanges({
        items: rows,
        itemId: "b",
        placeOfId: "b",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ kind: "moved", changes: [] });
  });

  test("says when the moved row is not in the list", () => {
    expect(
      getListOrderMoveChanges({
        items: rows,
        itemId: "gone",
        placeOfId: "a",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ kind: "rowNotInList" });
  });

  test("says when the row whose place it takes is not in the list", () => {
    expect(
      getListOrderMoveChanges({
        items: rows,
        itemId: "a",
        placeOfId: "elsewhere",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({ kind: "placeNotInList" });
  });

  test("puts the older of two rows at one number first, as the list shows them", () => {
    const twins: Array<Row> = [
      row("younger", 1, "2026-01-02T00:00:00.000Z"),
      row("older", 1, "2026-01-01T00:00:00.000Z"),
      row("last", 2, "2026-01-01T00:00:00.000Z"),
    ];

    // The younger twin, second on screen, dropped on the older one.
    expect(
      getListOrderMoveChanges({
        items: twins,
        itemId: "younger",
        placeOfId: "older",
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual({
      kind: "moved",
      changes: [
        { id: "older", value: 2 },
        { id: "last", value: 3 },
      ],
    });
  });

  test("numbers a list that counts down from the top, n..1", () => {
    const rules: Array<Row> = [row("a", 30), row("b", 20), row("c", 10)];

    expect(
      getListOrderMoveChanges({
        items: rules,
        itemId: "c",
        placeOfId: "a",
        sortOrder: SortOrder.Descending,
      }),
    ).toEqual({
      kind: "moved",
      changes: [
        { id: "c", value: 3 },
        { id: "a", value: 2 },
        { id: "b", value: 1 },
      ],
    });
  });

  test("leaves the rows it is handed as they are", () => {
    const list: Array<Row> = [row("a", 1), row("b", 2)];

    getListOrderMoveChanges({
      items: list,
      itemId: "b",
      placeOfId: "a",
      sortOrder: SortOrder.Ascending,
    });

    expect(list).toEqual([row("a", 1), row("b", 2)]);
  });
});

describe("getListOrderValue and getListOrderChanges", () => {
  test("numbers a list that counts up 1..n from the top", () => {
    expect(
      [1, 2, 3].map((position: number) => {
        return getListOrderValue({
          position: position,
          count: 3,
          sortOrder: SortOrder.Ascending,
        });
      }),
    ).toEqual([1, 2, 3]);
  });

  test("numbers a list that counts down n..1 from the top", () => {
    expect(
      [1, 2, 3].map((position: number) => {
        return getListOrderValue({
          position: position,
          count: 3,
          sortOrder: SortOrder.Descending,
        });
      }),
    ).toEqual([3, 2, 1]);
  });

  test("writes only the rows whose number changes", () => {
    expect(
      getListOrderChanges({
        orderedItems: [row("a", 1), row("b", 1), row("c", 3), row("d", null)],
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([
      { id: "b", value: 2 },
      { id: "d", value: 4 },
    ]);
  });

  test("an already numbered list needs nothing written", () => {
    expect(
      getListOrderChanges({
        orderedItems: [row("a", 1), row("b", 2)],
        sortOrder: SortOrder.Ascending,
      }),
    ).toEqual([]);
  });
});

describe("needsListOrderNormalization", () => {
  test("a list where every row has its own number is fine, gaps and all", () => {
    expect(
      needsListOrderNormalization([row("a", 10), row("b", 20), row("c", 3)]),
    ).toBe(false);
  });

  test("an empty list is fine", () => {
    expect(needsListOrderNormalization([])).toBe(false);
  });

  test("a list saved with the same number on every row needs numbering - every log pipeline used to be saved as 1", () => {
    expect(
      needsListOrderNormalization([row("a", 1), row("b", 1), row("c", 1)]),
    ).toBe(true);
  });

  test("a list with a row without a number needs numbering", () => {
    expect(needsListOrderNormalization([row("a", 1), row("b", null)])).toBe(
      true,
    );
  });
});

describe("moveListItem", () => {
  test("moves a row up", () => {
    expect(moveListItem(["a", "b", "c", "d"], 3, 1)).toEqual([
      "a",
      "d",
      "b",
      "c",
    ]);
  });

  test("moves a row down", () => {
    expect(moveListItem(["a", "b", "c", "d"], 0, 2)).toEqual([
      "b",
      "c",
      "a",
      "d",
    ]);
  });

  test("moves a row to the top", () => {
    expect(moveListItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  test("leaves the list alone for a move to the same place or out of range", () => {
    const list: Array<string> = ["a", "b", "c"];

    expect(moveListItem(list, 1, 1)).toEqual(list);
    expect(moveListItem(list, -1, 1)).toEqual(list);
    expect(moveListItem(list, 0, 3)).toEqual(list);
  });

  test("returns a new array and leaves the old one as it was", () => {
    const list: Array<string> = ["a", "b", "c"];
    const moved: Array<string> = moveListItem(list, 0, 2);

    expect(moved).not.toBe(list);
    expect(list).toEqual(["a", "b", "c"]);
  });
});
