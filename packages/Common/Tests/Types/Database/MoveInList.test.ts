import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import MoveInListUtil, {
  CONTIGUOUS_ORDER_TABLES,
  ListPlace,
  MOVE_IN_LIST_ROUTE,
  MoveInListChanges,
  MoveInListRequest,
  getMoveInListRoute,
} from "../../../Types/Database/MoveInList";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { describe, expect, test } from "@jest/globals";

/*
 * MOVING A ROW OF A NUMBERED LIST TO ANOTHER ROW'S PLACE (issue #9573).
 *
 * The arithmetic the server's move (ContiguousOrder.move) runs on the rows
 * it locks, and what the Dashboard and the server agree on: the order a list
 * is read in (by number, twins by id, rows without a number last), where a
 * moved row lands (just above the row named when it came from below, just
 * below it when it came from above), and that the list comes out numbered
 * 1..n - which, in a list numbered 1..n, changes only the rows between the
 * two places, as the Dashboard's drag always did.
 */

// Ids that sort as their letters do.
function id(letter: string): string {
  const code: string = letter.charCodeAt(0).toString(16).padStart(2, "0");
  return `00000000-0000-4000-8000-0000000000${code}`;
}

function places(entries: Array<[string, number | null]>): Array<ListPlace> {
  return entries.map(([letter, order]: [string, number | null]): ListPlace => {
    return { id: id(letter), order: order };
  });
}

// The list's letters in the order it is read in, after the changes.
function readAfter(
  rows: Array<ListPlace>,
  changes: MoveInListChanges,
): Array<string> {
  if (changes.kind !== "moved") {
    throw new Error(`no move: ${changes.kind}`);
  }

  const orders: Map<string, number | null | undefined> = new Map();

  for (const row of rows) {
    orders.set(row.id, row.order);
  }

  for (const changed of changes.changedRows) {
    orders.set(changed.id, changed.order);
  }

  return MoveInListUtil.sort(
    rows.map((row: ListPlace): ListPlace => {
      return { id: row.id, order: orders.get(row.id) };
    }),
  ).map((row: ListPlace): string => {
    return String.fromCharCode(parseInt(row.id.slice(-2), 16));
  });
}

function permutations<T>(items: Array<T>): Array<Array<T>> {
  if (items.length <= 1) {
    return [[...items]];
  }

  const result: Array<Array<T>> = [];

  items.forEach((item: T, index: number) => {
    const rest: Array<T> = [
      ...items.slice(0, index),
      ...items.slice(index + 1),
    ];

    for (const permutation of permutations(rest)) {
      result.push([item, ...permutation]);
    }
  });

  return result;
}

describe("MoveInListUtil", () => {
  describe("the order a list is read in", () => {
    test("is by number, lowest first", () => {
      expect(
        MoveInListUtil.sort(
          places([
            ["c", 3],
            ["a", 1],
            ["b", 2],
          ]),
        ).map((row: ListPlace) => {
          return row.order;
        }),
      ).toEqual([1, 2, 3]);
    });

    test("puts rows that share a number by id, as the database reads them", () => {
      expect(
        MoveInListUtil.sort(
          places([
            ["z", 1],
            ["b", 2],
            ["a", 2],
            ["y", 1],
          ]),
        ).map((row: ListPlace) => {
          return row.id;
        }),
      ).toEqual([id("y"), id("z"), id("a"), id("b")]);
    });

    test("compares ids in any case", () => {
      expect(
        MoveInListUtil.compare(
          { id: id("a").toUpperCase(), order: 1 },
          { id: id("b"), order: 1 },
        ),
      ).toBeLessThan(0);
      expect(
        MoveInListUtil.compare(
          { id: id("a").toUpperCase(), order: 1 },
          { id: id("a"), order: 1 },
        ),
      ).toBe(0);
    });

    test("puts rows without a number last", () => {
      expect(
        MoveInListUtil.sort(
          places([
            ["a", null],
            ["b", 7],
            ["c", 1],
          ]),
        ).map((row: ListPlace) => {
          return row.id;
        }),
      ).toEqual([id("c"), id("b"), id("a")]);
    });

    test("leaves the rows it is handed as they were", () => {
      const rows: Array<ListPlace> = places([
        ["b", 2],
        ["a", 1],
      ]);

      MoveInListUtil.sort(rows);

      expect(rows[0]!.id).toBe(id("b"));
    });
  });

  describe("a move", () => {
    const list: Array<ListPlace> = places([
      ["a", 1],
      ["b", 2],
      ["c", 3],
      ["d", 4],
      ["e", 5],
    ]);

    test("up: the row lands just above the row named, and the rows between step down", () => {
      const changes: MoveInListChanges = MoveInListUtil.getChanges({
        rows: list,
        rowId: id("d"),
        placeOfId: id("b"),
      });

      expect(readAfter(list, changes)).toEqual(["a", "d", "b", "c", "e"]);
      expect(changes).toEqual({
        kind: "moved",
        changedRows: [
          { id: id("d"), order: 2 },
          { id: id("b"), order: 3 },
          { id: id("c"), order: 4 },
        ],
      });
    });

    test("down: the row lands just below the row named, and the rows between step up", () => {
      const changes: MoveInListChanges = MoveInListUtil.getChanges({
        rows: list,
        rowId: id("b"),
        placeOfId: id("d"),
      });

      expect(readAfter(list, changes)).toEqual(["a", "c", "d", "b", "e"]);
      expect(changes).toEqual({
        kind: "moved",
        changedRows: [
          { id: id("c"), order: 2 },
          { id: id("d"), order: 3 },
          { id: id("b"), order: 4 },
        ],
      });
    });

    test("to the top and to the bottom", () => {
      expect(
        readAfter(
          list,
          MoveInListUtil.getChanges({
            rows: list,
            rowId: id("e"),
            placeOfId: id("a"),
          }),
        ),
      ).toEqual(["e", "a", "b", "c", "d"]);

      expect(
        readAfter(
          list,
          MoveInListUtil.getChanges({
            rows: list,
            rowId: id("a"),
            placeOfId: id("e"),
          }),
        ),
      ).toEqual(["b", "c", "d", "e", "a"]);
    });

    test("to its own place changes nothing", () => {
      expect(
        MoveInListUtil.getChanges({
          rows: list,
          rowId: id("c"),
          placeOfId: id("c"),
        }),
      ).toEqual({ kind: "moved", changedRows: [] });
    });

    test("names its rows in any case", () => {
      expect(
        readAfter(
          list,
          MoveInListUtil.getChanges({
            rows: list,
            rowId: id("e").toUpperCase(),
            placeOfId: ` ${id("a")} `,
          }),
        ),
      ).toEqual(["e", "a", "b", "c", "d"]);
    });

    test("of a row not in the list is no move", () => {
      expect(
        MoveInListUtil.getChanges({
          rows: list,
          rowId: id("x"),
          placeOfId: id("a"),
        }),
      ).toEqual({ kind: "rowNotInList" });
    });

    test("to the place of a row not in the list is no move", () => {
      expect(
        MoveInListUtil.getChanges({
          rows: list,
          rowId: id("a"),
          placeOfId: id("x"),
        }),
      ).toEqual({ kind: "placeNotInList" });
    });

    test("in a list numbered from elsewhere, with gaps, numbers it 1..n", () => {
      const gappy: Array<ListPlace> = places([
        ["a", 10],
        ["b", 20],
        ["c", 30],
      ]);

      const changes: MoveInListChanges = MoveInListUtil.getChanges({
        rows: gappy,
        rowId: id("c"),
        placeOfId: id("b"),
      });

      expect(changes).toEqual({
        kind: "moved",
        changedRows: [
          { id: id("a"), order: 1 },
          { id: id("c"), order: 2 },
          { id: id("b"), order: 3 },
        ],
      });
    });

    /*
     * Twins: a configuration that gives two rows one number, or a list
     * caught mid-apply. Moving one twin to the other's place still swaps
     * them - a move by numbers alone would have found the row already at
     * that number and done nothing.
     */
    test("between twins swaps them", () => {
      const twins: Array<ListPlace> = places([
        ["a", 1],
        ["b", 2],
        ["c", 2],
      ]);

      expect(
        readAfter(
          twins,
          MoveInListUtil.getChanges({
            rows: twins,
            rowId: id("c"),
            placeOfId: id("b"),
          }),
        ),
      ).toEqual(["a", "c", "b"]);
    });

    test("of a row without a number gives it one", () => {
      const unnumbered: Array<ListPlace> = places([
        ["a", 1],
        ["b", null],
      ]);

      expect(
        MoveInListUtil.getChanges({
          rows: unnumbered,
          rowId: id("b"),
          placeOfId: id("a"),
        }),
      ).toEqual({
        kind: "moved",
        changedRows: [
          { id: id("b"), order: 1 },
          { id: id("a"), order: 2 },
        ],
      });
    });

    test("reads a number stored as text as its number", () => {
      const asText: Array<ListPlace> = [
        { id: id("a"), order: "1" as unknown as number },
        { id: id("b"), order: "2" as unknown as number },
      ];

      expect(
        MoveInListUtil.getChanges({
          rows: asText,
          rowId: id("b"),
          placeOfId: id("a"),
        }),
      ).toEqual({
        kind: "moved",
        changedRows: [
          { id: id("b"), order: 1 },
          { id: id("a"), order: 2 },
        ],
      });
    });

    /*
     * Every move in every list of up to six rows numbered 1..n, in any
     * order: the moved row lands at the row named's place, every other row
     * keeps its order relative to the rest, the list ends numbered 1..n, and
     * only the rows between the two places are written - what the
     * Dashboard's drag did before the move was a request of its own.
     */
    test("in a list numbered 1..n lands where it was dropped and writes only the rows between", () => {
      const letters: Array<string> = ["a", "b", "c", "d", "e", "f"];

      for (let size: number = 1; size <= letters.length; size++) {
        for (const arrangement of permutations(letters.slice(0, size))) {
          const rows: Array<ListPlace> = arrangement.map(
            (letter: string, index: number): ListPlace => {
              return { id: id(letter), order: index + 1 };
            },
          );

          for (let from: number = 0; from < size; from++) {
            for (let to: number = 0; to < size; to++) {
              const changes: MoveInListChanges = MoveInListUtil.getChanges({
                rows: rows,
                rowId: rows[from]!.id,
                placeOfId: rows[to]!.id,
              });

              const expected: Array<string> = [...arrangement];
              const [moved] = expected.splice(from, 1);
              expected.splice(to, 0, moved!);

              expect(readAfter(rows, changes)).toEqual(expected);

              if (changes.kind !== "moved") {
                throw new Error("no move");
              }

              const low: number = Math.min(from, to);
              const high: number = Math.max(from, to);

              expect(
                changes.changedRows
                  .map((changed: { id: string }) => {
                    return rows.findIndex((row: ListPlace) => {
                      return row.id === changed.id;
                    });
                  })
                  .sort(),
              ).toEqual(
                from === to
                  ? []
                  : Array.from(
                      { length: high - low + 1 },
                      (_value: unknown, index: number) => {
                        return low + index;
                      },
                    ),
              );
            }
          }
        }
      }
    });
  });

  describe("the request", () => {
    test("names the row whose place the moved row takes", () => {
      const request: MoveInListRequest = MoveInListUtil.parseRequest({
        placeOfId: id("a"),
      });

      expect(request.placeOfId.toString()).toBe(id("a"));
      expect(MoveInListUtil.requestToJSON(request)).toEqual({
        placeOfId: id("a"),
      });
    });

    test("is read with the id trimmed", () => {
      expect(
        MoveInListUtil.parseRequest({
          placeOfId: `  ${id("a")} `,
        }).placeOfId.toString(),
      ).toBe(id("a"));
    });

    test.each([
      ["no body", undefined],
      ["a list", [id("a")]],
      ["no placeOfId", {}],
      ["a placeOfId that is no id", { placeOfId: "the top" }],
      ["a placeOfId that is a number", { placeOfId: 1 }],
      ["the place as an order", { order: 1 }],
    ] as Array<[string, unknown]>)(
      "with %s is refused, saying what to send",
      (_label: string, body: unknown) => {
        expect(() => {
          MoveInListUtil.parseRequest(body);
        }).toThrow(BadDataException);

        expect(() => {
          MoveInListUtil.parseRequest(body);
        }).toThrow('{ "placeOfId": "<id>" }');
      },
    );
  });

  describe("the result", () => {
    test("is sent as the rows given another number, each with its number", () => {
      expect(
        MoveInListUtil.resultToJSON({
          changedRows: [{ id: id("a"), order: 2 }],
        }),
      ).toEqual({ changedRows: [{ _id: id("a"), order: 2 }] });
    });

    test("is read back as it was sent", () => {
      expect(
        MoveInListUtil.resultFromJSON(
          MoveInListUtil.resultToJSON({
            changedRows: [
              { id: id("a"), order: 2 },
              { id: id("b"), order: 1 },
            ],
          }),
        ),
      ).toEqual({
        changedRows: [
          { id: id("a"), order: 2 },
          { id: id("b"), order: 1 },
        ],
      });
    });

    test("read from anything else is no rows", () => {
      expect(MoveInListUtil.resultFromJSON(null)).toEqual({ changedRows: [] });
      expect(MoveInListUtil.resultFromJSON({ changedRows: "x" })).toEqual({
        changedRows: [],
      });
      expect(
        MoveInListUtil.resultFromJSON({
          changedRows: [null, { _id: 1, order: 2 }, { _id: id("a") }],
        }),
      ).toEqual({ changedRows: [] });
    });
  });

  describe("the route", () => {
    test("is the row's own, under the list's path", () => {
      expect(MOVE_IN_LIST_ROUTE).toBe("/:id/move");
      expect(getMoveInListRoute(id("a"))).toBe(`/${id("a")}/move`);
      expect(new ObjectID(id("a")).toString()).toBe(id("a"));
    });
  });
});

/*
 * Two drag-ordered lists (@ListOrderColumn, issue #9609) count down: the top
 * is the highest number - network site assignment and device naming rules,
 * where the higher priority wins. A move reads them highest first, twins
 * still by id, and numbers them n..1 from the top.
 */
describe("a list whose top is its highest number", () => {
  // The letters top first, as a list that counts down reads them.
  function readDescending(
    rows: Array<ListPlace>,
    changes: MoveInListChanges,
  ): Array<string> {
    if (changes.kind !== "moved") {
      throw new Error(`no move: ${changes.kind}`);
    }

    const orders: Map<string, number | null | undefined> = new Map();

    for (const row of rows) {
      orders.set(row.id, row.order);
    }

    for (const changed of changes.changedRows) {
      orders.set(changed.id, changed.order);
    }

    return MoveInListUtil.sort(
      rows.map((row: ListPlace): ListPlace => {
        return { id: row.id, order: orders.get(row.id) };
      }),
      SortOrder.Descending,
    ).map((row: ListPlace): string => {
      return String.fromCharCode(parseInt(row.id.slice(-2), 16));
    });
  }

  test("is read highest first, twins by id, rows without a number last", () => {
    expect(
      MoveInListUtil.sort(
        places([
          ["c", 1],
          ["n", null],
          ["b", 5],
          ["a", 5],
          ["d", 9],
        ]),
        SortOrder.Descending,
      ).map((row: ListPlace): string => {
        return row.id;
      }),
    ).toEqual([id("d"), id("a"), id("b"), id("c"), id("n")]);
  });

  test("a row moved up takes the top row's place, and the list is numbered n..1", () => {
    const rows: Array<ListPlace> = places([
      ["a", 3],
      ["b", 2],
      ["c", 1],
    ]);

    const changes: MoveInListChanges = MoveInListUtil.getChanges({
      rows: rows,
      rowId: id("c"),
      placeOfId: id("a"),
      sortOrder: SortOrder.Descending,
    });

    expect(changes).toEqual({
      kind: "moved",
      changedRows: [
        { id: id("c"), order: 3 },
        { id: id("a"), order: 2 },
        { id: id("b"), order: 1 },
      ],
    });
    expect(readDescending(rows, changes)).toEqual(["c", "a", "b"]);
  });

  test("a list with gaps comes out numbered n..1, the bottom row at 1", () => {
    const rows: Array<ListPlace> = places([
      ["a", 100],
      ["b", 50],
      ["c", -7],
    ]);

    const changes: MoveInListChanges = MoveInListUtil.getChanges({
      rows: rows,
      rowId: id("a"),
      placeOfId: id("c"),
      sortOrder: SortOrder.Descending,
    });

    expect(readDescending(rows, changes)).toEqual(["b", "c", "a"]);
    expect(changes).toEqual({
      kind: "moved",
      changedRows: [
        { id: id("b"), order: 3 },
        { id: id("c"), order: 2 },
        { id: id("a"), order: 1 },
      ],
    });
  });

  test("every move in every list of up to five rows lands where it was dropped", () => {
    const letters: Array<string> = ["a", "b", "c", "d", "e"];

    for (let size: number = 1; size <= letters.length; size++) {
      for (const arrangement of permutations(letters.slice(0, size))) {
        // Top first: the highest number first.
        const rows: Array<ListPlace> = arrangement.map(
          (letter: string, index: number): ListPlace => {
            return { id: id(letter), order: size - index };
          },
        );

        for (let from: number = 0; from < size; from++) {
          for (let to: number = 0; to < size; to++) {
            const changes: MoveInListChanges = MoveInListUtil.getChanges({
              rows: rows,
              rowId: rows[from]!.id,
              placeOfId: rows[to]!.id,
              sortOrder: SortOrder.Descending,
            });

            const expected: Array<string> = [...arrangement];
            const [moved] = expected.splice(from, 1);
            expected.splice(to, 0, moved!);

            expect(readDescending(rows, changes)).toEqual(expected);
          }
        }
      }
    }
  });

  test("getNumberAt numbers from the top: 1..n, or n..1 counting down", () => {
    expect(
      [0, 1, 2].map((position: number) => {
        return MoveInListUtil.getNumberAt({ position, count: 3 });
      }),
    ).toEqual([1, 2, 3]);
    expect(
      [0, 1, 2].map((position: number) => {
        return MoveInListUtil.getNumberAt({
          position,
          count: 3,
          sortOrder: SortOrder.Descending,
        });
      }),
    ).toEqual([3, 2, 1]);
  });
});

describe("which lists have the move", () => {
  test("every drag-ordered list and the five numbered lists, and no other", () => {
    expect(
      MoveInListUtil.hasMoveRequest({
        tableName: "IncidentSeverity",
        getListOrder: (): unknown => {
          return { column: "order" };
        },
      }),
    ).toBe(true);

    for (const table of CONTIGUOUS_ORDER_TABLES) {
      expect(
        MoveInListUtil.hasMoveRequest({
          tableName: table,
          getListOrder: (): unknown => {
            return null;
          },
        }),
      ).toBe(true);
    }

    expect(
      MoveInListUtil.hasMoveRequest({
        tableName: "Monitor",
        getListOrder: (): unknown => {
          return null;
        },
      }),
    ).toBe(false);
    expect(MoveInListUtil.hasMoveRequest({ tableName: null })).toBe(false);
  });

  test("the five are the lists ContiguousOrder keeps", () => {
    expect([...CONTIGUOUS_ORDER_TABLES].sort()).toEqual(
      [
        "OnCallDutyPolicyEscalationRule",
        "OnCallDutyPolicyScheduleLayer",
        "OnCallDutyPolicyScheduleLayerUser",
        "StatusPageGroup",
        "StatusPageResource",
      ].sort(),
    );
  });
});
