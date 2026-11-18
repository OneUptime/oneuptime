import SortOrder from "../../Types/BaseDatabase/SortOrder";
import MoveInListUtil, {
  MoveInListChanges,
} from "../../Types/Database/MoveInList";
import {
  ListOrderItem,
  compareListOrderItems,
  getDropTargetId,
  getListOrderAppendValue,
  getListOrderChanges,
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
 * the dashboard's tables decide what a drop sends with it.
 *
 * The contract pinned here (issue #9609):
 *   - lower numbers first (highest first for a list that counts down);
 *   - rows that share a number by id, the order the database reads them in,
 *     and rows without a number last;
 *   - a row without a number goes to the end;
 *   - a drop sends the id of the row it landed on, and the move that names
 *     it (Types/Database/MoveInList) lands the row exactly where the table
 *     showed it when it was let go.
 */

type Row = ListOrderItem & { name: string };

const row: (name: string, value: number | null) => Row = (
  name: string,
  value: number | null,
): Row => {
  return {
    id: name,
    name: name,
    value: value,
  };
};

const names: (rows: Array<Row>) => Array<string> = (
  rows: Array<Row>,
): Array<string> => {
  return rows.map((item: Row) => {
    return item.id;
  });
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
      names(
        sortListOrderItems(
          [row("c", 3), row("a", 1), row("b", 2)],
          SortOrder.Ascending,
        ),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("puts higher numbers first in a list that counts down", () => {
    expect(
      names(
        sortListOrderItems(
          [row("low", 1), row("high", 9), row("mid", 5)],
          SortOrder.Descending,
        ),
      ),
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

  test("puts two rows at one number in the order of their ids, as the database reads them", () => {
    expect(
      names(
        sortListOrderItems(
          [row("b", 1), row("c", 2), row("a", 1)],
          SortOrder.Ascending,
        ),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("puts twins in the order of their ids in a list that counts down too", () => {
    expect(
      names(
        sortListOrderItems(
          [row("b", 5), row("a", 5), row("c", 9)],
          SortOrder.Descending,
        ),
      ),
    ).toEqual(["c", "a", "b"]);
  });

  test("compares ids however their letters are cased, as Postgres renders a uuid", () => {
    const upper: ListOrderItem = {
      id: "B1000000-0000-4000-8000-000000000000",
      value: 1,
    };
    const lower: ListOrderItem = {
      id: "a1000000-0000-4000-8000-000000000000",
      value: 1,
    };

    expect(
      compareListOrderItems(lower, upper, SortOrder.Ascending),
    ).toBeLessThan(0);
  });

  test("orders rows without a number by id, so the order is stable", () => {
    expect(
      names(
        sortListOrderItems(
          [row("b", null), row("a", null), row("c", null)],
          SortOrder.Ascending,
        ),
      ),
    ).toEqual(["a", "b", "c"]);
  });

  test("is a total order: two calls never disagree", () => {
    const a: Row = row("a", 1);
    const b: Row = row("b", 1);

    expect(compareListOrderItems(a, b, SortOrder.Ascending)).toBeLessThan(0);
    expect(compareListOrderItems(b, a, SortOrder.Ascending)).toBeGreaterThan(0);
    expect(compareListOrderItems(a, a, SortOrder.Ascending)).toBe(0);
  });

  test("reads a number sent as a string as that number", () => {
    expect(
      names(
        sortListOrderItems(
          [
            { id: "ten", name: "ten", value: "10" },
            { id: "two", name: "two", value: 2 },
          ],
          SortOrder.Ascending,
        ),
      ),
    ).toEqual(["two", "ten"]);
  });

  test("agrees with the order a move reads the list in", () => {
    const rows: Array<Row> = [
      row("d", 2),
      row("b", null),
      row("c", 1),
      row("a", 2),
    ];

    for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
      expect(names(sortListOrderItems(rows, sortOrder))).toEqual(
        MoveInListUtil.sort(
          rows.map((item: Row) => {
            return { id: item.id, order: toListOrderNumber(item.value) };
          }),
          sortOrder,
        ).map((place: { id: string }) => {
          return place.id;
        }),
      );
    }
  });

  test("does not mutate the list it sorts", () => {
    const rows: Array<Row> = [row("b", 2), row("a", 1)];

    sortListOrderItems(rows, SortOrder.Ascending);

    expect(names(rows)).toEqual(["b", "a"]);
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

    expect(
      names(
        sortListOrderItems(
          [...siblings, row("new", value)],
          SortOrder.Ascending,
        ),
      ),
    ).toEqual(["b", "a", "c", "new"]);
  });
});

describe("every drop in a list lands where it was dropped", () => {
  /*
   * Exhaustive over a five-row list: every row dropped on every other row,
   * both directions, both ways of counting, numbered from scratch, with
   * gaps, and with twins. The drop sends the id of the row it landed on
   * (getDropTargetId); the move that names it has to leave the list exactly
   * as the table showed it when the row was let go (moveListItem), numbered
   * from scratch, every number its own.
   */
  const NUMBERINGS: Array<{
    name: string;
    numbers: (sortOrder: SortOrder) => Array<number>;
  }> = [
    {
      name: "numbered from scratch",
      numbers: (sortOrder: SortOrder): Array<number> => {
        return [1, 2, 3, 4, 5].map((position: number) => {
          return getListOrderValue({ position, count: 5, sortOrder });
        });
      },
    },
    {
      name: "with gaps",
      numbers: (sortOrder: SortOrder): Array<number> => {
        return sortOrder === SortOrder.Descending
          ? [50, 40, 30, 20, 10]
          : [10, 20, 30, 40, 50];
      },
    },
    {
      name: "with twins",
      numbers: (sortOrder: SortOrder): Array<number> => {
        return sortOrder === SortOrder.Descending
          ? [3, 3, 2, 1, 1]
          : [1, 1, 2, 3, 3];
      },
    },
  ];

  for (const sortOrder of [SortOrder.Ascending, SortOrder.Descending]) {
    for (const numbering of NUMBERINGS) {
      // Ids in the order a list of twins reads them: A, B, C, D, E.
      const rows: Array<Row> = ["A", "B", "C", "D", "E"].map(
        (name: string, index: number) => {
          return row(name, numbering.numbers(sortOrder)[index]!);
        },
      );

      for (let from: number = 0; from < rows.length; from++) {
        for (let to: number = 0; to < rows.length; to++) {
          if (from === to) {
            continue;
          }

          test(`${sortOrder}, ${numbering.name}: row ${from + 1} dropped on row ${to + 1}`, () => {
            expect(names(sortListOrderItems(rows, sortOrder))).toEqual(
              names(rows),
            );

            const placeOfId: string | null = getDropTargetId<Row>({
              items: rows,
              sourceIndex: from,
              destinationIndex: to,
              getId: (item: Row): unknown => {
                return item.id;
              },
            });

            expect(placeOfId).toBe(rows[to]!.id);

            const changes: MoveInListChanges = MoveInListUtil.getChanges({
              rows: rows.map((item: Row) => {
                return { id: item.id, order: toListOrderNumber(item.value) };
              }),
              rowId: rows[from]!.id,
              placeOfId: placeOfId!,
              sortOrder: sortOrder,
            });

            expect(changes.kind).toBe("moved");

            const numberById: Map<string, number> = new Map();

            for (const item of rows) {
              numberById.set(item.id, toListOrderNumber(item.value)!);
            }

            if (changes.kind === "moved") {
              for (const changed of changes.changedRows) {
                numberById.set(changed.id, changed.order);
              }
            }

            const after: Array<Row> = rows.map((item: Row) => {
              return row(item.id, numberById.get(item.id)!);
            });

            expect(names(sortListOrderItems(after, sortOrder))).toEqual(
              names(moveListItem(rows, from, to)),
            );

            expect(
              sortListOrderItems(after, sortOrder).map((item: Row) => {
                return item.value;
              }),
            ).toEqual(
              [1, 2, 3, 4, 5].map((position: number) => {
                return getListOrderValue({ position, count: 5, sortOrder });
              }),
            );
          });
        }
      }
    }
  }
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

describe("getDropTargetId", () => {
  const rows: Array<Row> = [row("a", 1), row("b", 2), row("c", null)];

  const target: (from: number, to: number) => string | null = (
    from: number,
    to: number,
  ): string | null => {
    return getDropTargetId<Row>({
      items: rows,
      sourceIndex: from,
      destinationIndex: to,
      getId: (item: Row): unknown => {
        return item.id;
      },
    });
  };

  test("is the id of the row that sat where the row was dropped", () => {
    expect(target(1, 0)).toBe("a");
    expect(target(0, 1)).toBe("b");
  });

  test("names the row it landed on even when that row has no number yet", () => {
    expect(target(0, 2)).toBe("c");
  });

  test("is null for a drop back where the row started", () => {
    expect(target(1, 1)).toBeNull();
  });

  test("is null for a drop past the end of the list", () => {
    expect(target(0, 5)).toBeNull();
  });

  test("is null when the row there has no id", () => {
    expect(
      getDropTargetId<Row>({
        items: rows,
        sourceIndex: 0,
        destinationIndex: 1,
        getId: (): unknown => {
          return undefined;
        },
      }),
    ).toBeNull();

    expect(
      getDropTargetId<Row>({
        items: rows,
        sourceIndex: 0,
        destinationIndex: 1,
        getId: (): unknown => {
          return "  ";
        },
      }),
    ).toBeNull();
  });

  test("reads an id kept as an object by its text", () => {
    expect(
      getDropTargetId<Row>({
        items: rows,
        sourceIndex: 0,
        destinationIndex: 1,
        getId: (): unknown => {
          return {
            toString: (): string => {
              return "b2000000-0000-4000-8000-000000000000";
            },
          };
        },
      }),
    ).toBe("b2000000-0000-4000-8000-000000000000");
  });
});
