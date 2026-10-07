import IncidentAlertAiLogsPage, {
  IncidentAlertAiLogsKindScan,
  IncidentAlertAiLogsPageResult,
} from "../../../../../Server/Utils/AI/IncidentAlertActivity/IncidentAlertAiLogsPage";
import {
  IncidentAlertAiLogEntry,
  IncidentAlertAiLogKind,
} from "../../../../../Types/AI/IncidentAlertAiLogs";
import { describe, expect, test } from "@jest/globals";

/*
 * How one page of the incident and alert AI Logs is cut from what each
 * kind's read found. Each kind is read on its own, newest first and a
 * bounded number of rows at a time, and rows about an incident or alert the
 * caller may not read never become entries - so the page has to stop where
 * a full read may be missing rows, and rows created in the same millisecond
 * as a page's edge must be neither skipped nor shown twice.
 */

const T: number = Date.parse("2026-10-05T10:00:00.000Z");

function at(offsetMs: number): string {
  return new Date(T + offsetMs).toISOString();
}

let nextId: number = 0;

function entry(
  kind: IncidentAlertAiLogKind,
  offsetMs: number,
  id?: string,
): IncidentAlertAiLogEntry {
  nextId++;
  return {
    kind,
    id: id || `row-${String(nextId).padStart(4, "0")}`,
    at: at(offsetMs),
    subject: { kind: "incident", id: "incident-1" },
  };
}

function scan(
  kind: IncidentAlertAiLogKind,
  entries: Array<IncidentAlertAiLogEntry>,
  options: { scanned?: number; limit?: number; oldestOffsetMs?: number } = {},
): IncidentAlertAiLogsKindScan {
  const offsets: Array<number> = entries.map(
    (e: IncidentAlertAiLogEntry): number => {
      return Date.parse(e.at) - T;
    },
  );
  const oldest: number | undefined =
    options.oldestOffsetMs !== undefined
      ? options.oldestOffsetMs
      : offsets.length > 0
        ? Math.min(...offsets)
        : undefined;

  return {
    kind,
    entries,
    scanned: options.scanned ?? entries.length,
    limit: options.limit ?? 100,
    oldestScannedAt: oldest === undefined ? undefined : new Date(T + oldest),
  };
}

function ids(result: IncidentAlertAiLogsPageResult): Array<string> {
  return result.entries.map((e: IncidentAlertAiLogEntry): string => {
    return e.id;
  });
}

describe("IncidentAlertAiLogsPage.compareEntries", () => {
  test("puts the newest first", () => {
    const older: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -5000,
    );
    const newer: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -1000,
    );

    expect([older, newer].sort(IncidentAlertAiLogsPage.compareEntries)).toEqual(
      [newer, older],
    );
  });

  test("orders one millisecond by kind: investigation, fix, fix task, command", () => {
    const command: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      0,
    );
    const fixTask: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.FixTask,
      0,
    );
    const fix: IncidentAlertAiLogEntry = entry(IncidentAlertAiLogKind.Fix, 0);
    const investigation: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      0,
    );

    expect(
      [command, fixTask, fix, investigation].sort(
        IncidentAlertAiLogsPage.compareEntries,
      ),
    ).toEqual([investigation, fix, fixTask, command]);
  });

  test("orders one millisecond and kind by id, the same way every time", () => {
    const b: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      0,
      "b",
    );
    const a: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      0,
      "a",
    );

    expect([b, a].sort(IncidentAlertAiLogsPage.compareEntries)).toEqual([a, b]);
    expect(IncidentAlertAiLogsPage.compareEntries(a, a)).toBe(0);
  });

  test("an entry with an unreadable time sorts last", () => {
    const broken: IncidentAlertAiLogEntry = {
      ...entry(IncidentAlertAiLogKind.Fix, 0),
      at: "not a date",
    };
    const fine: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Fix,
      -1000,
    );

    expect([broken, fine].sort(IncidentAlertAiLogsPage.compareEntries)).toEqual(
      [fine, broken],
    );
  });
});

describe("IncidentAlertAiLogsPage.getBoundary", () => {
  test("is null when every read came back short: each reached the start of its record", () => {
    expect(
      IncidentAlertAiLogsPage.getBoundary([
        scan(IncidentAlertAiLogKind.Investigation, [
          entry(IncidentAlertAiLogKind.Investigation, -10),
        ]),
        scan(IncidentAlertAiLogKind.Command, []),
      ]),
    ).toBeNull();
  });

  test("is the oldest row of a full read", () => {
    expect(
      IncidentAlertAiLogsPage.getBoundary([
        scan(
          IncidentAlertAiLogKind.Command,
          [entry(IncidentAlertAiLogKind.Command, -10)],
          { scanned: 2, limit: 2, oldestOffsetMs: -20 },
        ),
      ]),
    ).toBe(T - 20);
  });

  test("is the newest of the full reads' oldest rows", () => {
    expect(
      IncidentAlertAiLogsPage.getBoundary([
        scan(IncidentAlertAiLogKind.Investigation, [], {
          scanned: 5,
          limit: 5,
          oldestOffsetMs: -900,
        }),
        scan(IncidentAlertAiLogKind.Command, [], {
          scanned: 5,
          limit: 5,
          oldestOffsetMs: -300,
        }),
        scan(IncidentAlertAiLogKind.Fix, [], {
          scanned: 1,
          limit: 5,
          oldestOffsetMs: -100,
        }),
      ]),
    ).toBe(T - 300);
  });

  test("counts rows the caller could not see: a read is full by what it returned", () => {
    // Nothing became an entry, but the read came back full.
    expect(
      IncidentAlertAiLogsPage.getBoundary([
        scan(IncidentAlertAiLogKind.Fix, [], {
          scanned: 3,
          limit: 3,
          oldestOffsetMs: -50,
        }),
      ]),
    ).toBe(T - 50);
  });

  test("ignores a full read with no time to go by", () => {
    expect(
      IncidentAlertAiLogsPage.getBoundary([
        {
          kind: IncidentAlertAiLogKind.Fix,
          entries: [],
          scanned: 3,
          limit: 3,
          oldestScannedAt: undefined,
        },
        {
          kind: IncidentAlertAiLogKind.Command,
          entries: [],
          scanned: 3,
          limit: 3,
          oldestScannedAt: new Date(NaN),
        },
      ]),
    ).toBeNull();
  });
});

describe("IncidentAlertAiLogsPage.build", () => {
  test("an empty record is one empty page with nothing after it", () => {
    expect(
      IncidentAlertAiLogsPage.build({
        scans: [
          scan(IncidentAlertAiLogKind.Investigation, []),
          scan(IncidentAlertAiLogKind.Fix, []),
        ],
        pageSize: 50,
      }),
    ).toEqual({ entries: [], nextBefore: null });
  });

  test("merges the kinds newest first, and ends the record when every read came back short", () => {
    const investigation: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -300,
    );
    const fix: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Fix,
      -200,
    );
    const command: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -100,
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Investigation, [investigation]),
          scan(IncidentAlertAiLogKind.Fix, [fix]),
          scan(IncidentAlertAiLogKind.Command, [command]),
        ],
        pageSize: 50,
      },
    );

    expect(ids(result)).toEqual([command.id, fix.id, investigation.id]);
    expect(result.nextBefore).toBeNull();
  });

  test("stops where a full read may be missing rows, and starts the next page from the millisecond after it", () => {
    // Commands: a full read reaching back to -500. Investigations: all read.
    const commandNew: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -100,
    );
    const commandOldest: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -500,
    );
    const investigationNew: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -200,
    );
    const investigationOld: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -900,
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Command, [commandNew, commandOldest], {
            limit: 2,
          }),
          scan(IncidentAlertAiLogKind.Investigation, [
            investigationNew,
            investigationOld,
          ]),
        ],
        pageSize: 50,
      },
    );

    /*
     * Below -500 the commands may have more rows, so the older
     * investigation waits for the next page - and so does every entry of
     * the boundary's own millisecond, the oldest command among them.
     */
    expect(ids(result)).toEqual([commandNew.id, investigationNew.id]);
    expect(result.nextBefore).toBe(at(-499));
  });

  test("the next page, read from there, picks up what this one left out", () => {
    const commandOldest: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -500,
    );
    const investigationOld: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -900,
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Command, [commandOldest]),
          scan(IncidentAlertAiLogKind.Investigation, [investigationOld]),
        ],
        pageSize: 50,
        before: new Date(T - 499),
      },
    );

    expect(ids(result)).toEqual([commandOldest.id, investigationOld.id]);
    expect(result.nextBefore).toBeNull();
  });

  test("a full page ends on a millisecond it keeps whole, and the next page starts strictly before it", () => {
    const first: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -10,
    );
    const tieA: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -20,
      "tie-a",
    );
    const tieB: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -20,
      "tie-b",
    );
    const tieFix: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Fix,
      -20,
      "tie-fix",
    );
    const later: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -30,
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Command, [later, tieB, first, tieA]),
          scan(IncidentAlertAiLogKind.Fix, [tieFix]),
        ],
        pageSize: 2,
      },
    );

    // Two asked for; the second lands on -20, so all of -20 comes along.
    expect(ids(result)).toEqual([first.id, "tie-fix", "tie-a", "tie-b"]);
    expect(result.nextBefore).toBe(at(-20));
  });

  test("a full page is cut by size before the boundary when the boundary is further back", () => {
    const entries: Array<IncidentAlertAiLogEntry> = [-1, -2, -3, -4, -5].map(
      (offset: number): IncidentAlertAiLogEntry => {
        return entry(IncidentAlertAiLogKind.Investigation, offset);
      },
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Investigation, entries, {
            limit: 5,
            scanned: 5,
          }),
          scan(IncidentAlertAiLogKind.Command, [], {
            scanned: 4,
            limit: 4,
            oldestOffsetMs: -100,
          }),
        ],
        pageSize: 3,
      },
    );

    expect(ids(result)).toEqual([
      entries[0]!.id,
      entries[1]!.id,
      entries[2]!.id,
    ]);
    expect(result.nextBefore).toBe(at(-3));
  });

  test("a page of exactly the page size that reached the start of the record has nothing after it", () => {
    const entries: Array<IncidentAlertAiLogEntry> = [-1, -2].map(
      (offset: number): IncidentAlertAiLogEntry => {
        return entry(IncidentAlertAiLogKind.Fix, offset);
      },
    );

    expect(
      IncidentAlertAiLogsPage.build({
        scans: [scan(IncidentAlertAiLogKind.Fix, entries)],
        pageSize: 2,
      }).nextBefore,
    ).toBeNull();
  });

  /*
   * Rows carry microseconds and dates milliseconds: a row at
   * .499900 reads as .499. The page that stops at the boundary leaves the
   * whole millisecond out and the next one reads strictly before the
   * millisecond after it, which the database compares with the microseconds
   * - so a sibling at .499100 that this page did not show is read next.
   */
  test("leaves the boundary's whole millisecond to the next page", () => {
    const sameMillisecondA: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -500,
      "same-ms-investigation",
    );
    const commandAtBoundary: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -500,
      "boundary-command",
    );
    const newer: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Command,
      -499,
      "just-newer",
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Command, [newer, commandAtBoundary], {
            limit: 2,
          }),
          scan(IncidentAlertAiLogKind.Investigation, [sameMillisecondA]),
        ],
        pageSize: 50,
      },
    );

    expect(ids(result)).toEqual(["just-newer"]);
    expect(result.nextBefore).toBe(at(-499));
  });

  test("moves past a millisecond that holds more rows of one kind than its read takes", () => {
    /*
     * The page before ended at -499 (strictly before it). The command read
     * came back full with every row in -500: stopping below -500 again
     * would start the next page where this one started.
     */
    const stuck: Array<IncidentAlertAiLogEntry> = ["a", "b"].map(
      (id: string): IncidentAlertAiLogEntry => {
        return entry(IncidentAlertAiLogKind.Command, -500, id);
      },
    );
    const investigation: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Investigation,
      -500,
      "investigation",
    );

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [
          scan(IncidentAlertAiLogKind.Command, stuck, { limit: 2 }),
          scan(IncidentAlertAiLogKind.Investigation, [investigation]),
        ],
        pageSize: 50,
        before: new Date(T - 499),
      },
    );

    expect(ids(result)).toEqual(["investigation", "a", "b"]);
    // Strictly before -500: the record moves on.
    expect(result.nextBefore).toBe(at(-500));
    expect(Date.parse(result.nextBefore!)).toBeLessThan(T - 499);
  });

  test("never repeats an entry at or after the request's own before", () => {
    const repeated: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Fix,
      -100,
    );
    const fresh: IncidentAlertAiLogEntry = entry(
      IncidentAlertAiLogKind.Fix,
      -101,
    );

    expect(
      ids(
        IncidentAlertAiLogsPage.build({
          scans: [scan(IncidentAlertAiLogKind.Fix, [repeated, fresh])],
          pageSize: 50,
          before: new Date(T - 100),
        }),
      ),
    ).toEqual([fresh.id]);
  });

  test("a page size below one still takes one entry", () => {
    const one: IncidentAlertAiLogEntry = entry(IncidentAlertAiLogKind.Fix, -1);
    const two: IncidentAlertAiLogEntry = entry(IncidentAlertAiLogKind.Fix, -2);

    const result: IncidentAlertAiLogsPageResult = IncidentAlertAiLogsPage.build(
      {
        scans: [scan(IncidentAlertAiLogKind.Fix, [one, two])],
        pageSize: 0,
      },
    );

    expect(ids(result)).toEqual([one.id]);
    expect(result.nextBefore).toBe(at(-1));
  });

  test("an invalid before is ignored", () => {
    const one: IncidentAlertAiLogEntry = entry(IncidentAlertAiLogKind.Fix, -1);

    expect(
      ids(
        IncidentAlertAiLogsPage.build({
          scans: [scan(IncidentAlertAiLogKind.Fix, [one])],
          pageSize: 5,
          before: new Date(NaN),
        }),
      ),
    ).toEqual([one.id]);
  });

  /*
   * Walking a whole record page by page with the reads the reader would do,
   * every row is shown exactly once, in order - whatever the page size, the
   * read size and however many rows share a millisecond.
   */
  describe("walking a record from the newest to the oldest", () => {
    interface Row {
      kind: IncidentAlertAiLogKind;
      id: string;
      // Microseconds before T.
      ageInMicroseconds: number;
      visible: boolean;
    }

    function makeRecord(seed: number): Array<Row> {
      let state: number = seed;
      const random: () => number = (): number => {
        state = (state * 1103515245 + 12345) % 2147483648;
        return state / 2147483648;
      };
      const rows: Array<Row> = [];
      const kinds: Array<IncidentAlertAiLogKind> = [
        IncidentAlertAiLogKind.Investigation,
        IncidentAlertAiLogKind.Fix,
        IncidentAlertAiLogKind.FixTask,
        IncidentAlertAiLogKind.Command,
      ];

      for (let index: number = 0; index < 160; index++) {
        rows.push({
          kind: kinds[Math.floor(random() * kinds.length)]!,
          id: `r${String(index).padStart(3, "0")}`,
          // Clusters of rows inside a few milliseconds.
          ageInMicroseconds: Math.floor(random() * 40) * 250,
          visible: random() > 0.25,
        });
      }

      return rows;
    }

    // Read rows of one kind created before a moment, newest first, like the DB.
    function read(
      rows: Array<Row>,
      kind: IncidentAlertAiLogKind,
      before: Date | undefined,
      limit: number,
    ): IncidentAlertAiLogsKindScan {
      const beforeAgeInMicroseconds: number | null = before
        ? (T - before.getTime()) * 1000
        : null;
      const picked: Array<Row> = rows
        .filter((row: Row): boolean => {
          return (
            row.kind === kind &&
            (beforeAgeInMicroseconds === null ||
              row.ageInMicroseconds > beforeAgeInMicroseconds)
          );
        })
        .sort((a: Row, b: Row): number => {
          return a.ageInMicroseconds - b.ageInMicroseconds;
        })
        .slice(0, limit);

      // A Date keeps milliseconds: the microseconds are cut off.
      const toDate: (row: Row) => Date = (row: Row): Date => {
        return new Date(T - Math.ceil(row.ageInMicroseconds / 1000));
      };

      return {
        kind,
        scanned: picked.length,
        limit,
        oldestScannedAt:
          picked.length > 0 ? toDate(picked[picked.length - 1]!) : undefined,
        entries: picked
          .filter((row: Row): boolean => {
            return row.visible;
          })
          .map((row: Row): IncidentAlertAiLogEntry => {
            return {
              kind: row.kind,
              id: row.id,
              at: toDate(row).toISOString(),
              subject: { kind: "incident", id: "incident-1" },
            };
          }),
      };
    }

    test.each([
      [1, 5, 3],
      [2, 10, 7],
      [3, 50, 20],
      [4, 3, 2],
      [5, 25, 100],
      [6, 7, 1],
    ])(
      "record %i (page size %i, read size %i): every visible row once, newest first",
      (seed: number, pageSize: number, limit: number) => {
        const rows: Array<Row> = makeRecord(seed);
        const kinds: Array<IncidentAlertAiLogKind> = [
          IncidentAlertAiLogKind.Investigation,
          IncidentAlertAiLogKind.Fix,
          IncidentAlertAiLogKind.FixTask,
          IncidentAlertAiLogKind.Command,
        ];
        const shown: Array<IncidentAlertAiLogEntry> = [];
        let before: Date | undefined = undefined;

        for (let page: number = 0; page < 500; page++) {
          const readBefore: Date | undefined = before;
          const scans: Array<IncidentAlertAiLogsKindScan> = [];

          for (const kind of kinds) {
            scans.push(read(rows, kind, readBefore, limit));
          }

          const result: IncidentAlertAiLogsPageResult =
            IncidentAlertAiLogsPage.build({
              scans,
              pageSize,
              before: readBefore,
            });

          shown.push(...result.entries);

          if (!result.nextBefore) {
            break;
          }

          // Every page moves the record back in time.
          if (before) {
            expect(Date.parse(result.nextBefore)).toBeLessThan(
              before.getTime(),
            );
          }

          before = new Date(result.nextBefore);
        }

        const expected: Array<string> = rows
          .filter((row: Row): boolean => {
            return row.visible;
          })
          .map((row: Row): string => {
            return row.id;
          })
          .sort();

        const shownIds: Array<string> = shown.map(
          (e: IncidentAlertAiLogEntry): string => {
            return e.id;
          },
        );

        /*
         * Nothing twice; and with read sizes this small, the rare row in a
         * millisecond holding more than a read takes may be skipped.
         */
        expect(new Set(shownIds).size).toBe(shownIds.length);

        // Newest first across the pages.
        for (let index: number = 1; index < shown.length; index++) {
          expect(Date.parse(shown[index - 1]!.at)).toBeGreaterThanOrEqual(
            Date.parse(shown[index]!.at),
          );
        }

        if (limit >= 20) {
          expect([...shownIds].sort()).toEqual(expected);
        } else {
          for (const id of shownIds) {
            expect(expected).toContain(id);
          }
        }
      },
    );
  });
});
