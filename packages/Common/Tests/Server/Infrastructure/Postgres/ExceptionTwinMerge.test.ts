import { describe, expect, test } from "@jest/globals";
import { QueryRunner, getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";
import {
  EXCEPTION_TWIN_MERGE,
  ExceptionCopyTriage,
  ExceptionTriage,
  foldTwinErrorClass,
  foldTwinTriage,
  reopenedByTwin,
  reopensResolution,
  takeInExceptionTwin,
} from "../../../../Server/Infrastructure/Postgres/ExceptionTwinMerge";
import {
  ColumnsTakenTogether,
  TWIN_MERGES,
  TwinMerge,
} from "../../../../Server/Infrastructure/Postgres/DuplicateRowMerge";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

/*
 * Two copies of one exception, when the two copies of their host merge
 * (issue #5214's duplicate hosts, migration 1806700000000): the kept
 * exception takes the dropped twin in - its count, seen times and releases
 * as an exception merge adds them up, its triage by the rule ingest reopens
 * a resolved exception by, and, where exceptions were merged into others,
 * the kept copy keeps its place and the counts still add up. Here the
 * triage rules, pure, and the statements against a fake QueryRunner;
 * MergeDuplicateHostsAndAddUniqueHostIdentifierPostgres runs them on
 * Postgres, on the schema of today and on the schema the migration meets in
 * production, and App's ExceptionRegressionPostgres holds the reopen rule
 * to ingest's own.
 */

const KEPT: string = "30000000-0000-4000-8000-00000000000a";
const TWIN: string = "30000000-0000-4000-8000-00000000000b";
const SURVIVOR: string = "30000000-0000-4000-8000-00000000000c";
const TWIN_SURVIVOR: string = "30000000-0000-4000-8000-00000000000d";
const MEMBER: string = "30000000-0000-4000-8000-00000000000e";
const OTHER_MEMBER: string = "30000000-0000-4000-8000-00000000000f";
// A column a taken-together rule's condition reads: member."column".
const MEMBER_COLUMN: RegExp = /member\."([A-Za-z]+)"/g;

const ALICE: string = "90000000-0000-4000-8000-000000000001";
const BOB: string = "90000000-0000-4000-8000-000000000002";

function day(n: number): Date {
  return new Date(Date.UTC(2026, 9, n));
}

function copy(overrides: Partial<ExceptionCopyTriage> = {}): ExceptionCopyTriage {
  return {
    isResolved: false,
    markedAsResolvedAt: null,
    markedAsResolvedByUserId: null,
    resolvedInReleaseAfter: null,
    regressedAt: null,
    lastSeenAt: day(10),
    lastSeenInRelease: "1.0.0",
    ...overrides,
  };
}

function resolved(
  at: Date,
  by: string,
  overrides: Partial<ExceptionCopyTriage> = {},
): ExceptionCopyTriage {
  return copy({
    isResolved: true,
    markedAsResolvedAt: at,
    markedAsResolvedByUserId: by,
    ...overrides,
  });
}

const OPEN: ExceptionTriage = {
  isResolved: false,
  markedAsResolvedAt: null,
  markedAsResolvedByUserId: null,
  resolvedInReleaseAfter: null,
  regressedAt: null,
};

describe("the triage of two copies of one exception", () => {
  test("neither resolved: open, as the kept copy is", () => {
    expect(
      foldTwinTriage(copy(), copy({ lastSeenAt: day(20) })),
    ).toEqual(OPEN);
  });

  test("neither resolved, and one came back once: open and Regressed, from the later time", () => {
    expect(
      foldTwinTriage(
        copy({ regressedAt: day(4) }),
        copy({ regressedAt: day(7) }),
      ),
    ).toEqual({ ...OPEN, regressedAt: day(7) });

    expect(
      foldTwinTriage(copy(), copy({ regressedAt: day(7) })).regressedAt,
    ).toEqual(day(7));
  });

  test("the kept copy resolved after the twin was last seen: resolved, as the kept copy was", () => {
    expect(
      foldTwinTriage(
        resolved(day(12), ALICE),
        copy({ lastSeenAt: day(11) }),
      ),
    ).toEqual({
      isResolved: true,
      markedAsResolvedAt: day(12),
      markedAsResolvedByUserId: ALICE,
      resolvedInReleaseAfter: null,
      regressedAt: null,
    });
  });

  test("the kept copy resolved, the twin seen after it: open again, the resolution cleared, Regressed when the twin was last seen", () => {
    expect(
      foldTwinTriage(
        resolved(day(12), ALICE),
        copy({ lastSeenAt: day(15) }),
      ),
    ).toEqual({ ...OPEN, regressedAt: day(15) });
  });

  test("the twin resolved after the kept copy was last seen: resolved, by whoever resolved the twin, when they did", () => {
    expect(
      foldTwinTriage(
        copy({ lastSeenAt: day(10) }),
        resolved(day(12), BOB, { lastSeenAt: day(9) }),
      ),
    ).toEqual({
      isResolved: true,
      markedAsResolvedAt: day(12),
      markedAsResolvedByUserId: BOB,
      resolvedInReleaseAfter: null,
      regressedAt: null,
    });
  });

  test("the twin resolved, the kept copy seen after it: open, and Regressed when the kept copy was last seen", () => {
    expect(
      foldTwinTriage(
        copy({ lastSeenAt: day(14) }),
        resolved(day(12), BOB, { lastSeenAt: day(9) }),
      ),
    ).toEqual({ ...OPEN, regressedAt: day(14) });
  });

  test("both resolved: the resolution made last stands, with who and when - the kept copy's on a tie", () => {
    expect(
      foldTwinTriage(
        resolved(day(12), ALICE, { lastSeenAt: day(9) }),
        resolved(day(13), BOB, { lastSeenAt: day(8) }),
      ),
    ).toMatchObject({
      isResolved: true,
      markedAsResolvedAt: day(13),
      markedAsResolvedByUserId: BOB,
    });

    expect(
      foldTwinTriage(
        resolved(day(13), ALICE, { lastSeenAt: day(9) }),
        resolved(day(12), BOB, { lastSeenAt: day(8) }),
      ),
    ).toMatchObject({ isResolved: true, markedAsResolvedByUserId: ALICE });

    expect(
      foldTwinTriage(
        resolved(day(12), ALICE, { lastSeenAt: day(9) }),
        resolved(day(12), BOB, { lastSeenAt: day(8) }),
      ),
    ).toMatchObject({ isResolved: true, markedAsResolvedByUserId: ALICE });
  });

  test("resolved in the next release: an occurrence of the release it waits out, or of no release, does not reopen it; another release does", () => {
    const kept: ExceptionCopyTriage = resolved(day(12), ALICE, {
      resolvedInReleaseAfter: "2.0.0",
      lastSeenAt: day(11),
    });

    expect(
      foldTwinTriage(
        kept,
        copy({ lastSeenAt: day(15), lastSeenInRelease: "2.0.0" }),
      ),
    ).toMatchObject({ isResolved: true, resolvedInReleaseAfter: "2.0.0" });

    expect(
      foldTwinTriage(kept, copy({ lastSeenAt: day(15), lastSeenInRelease: "" })),
    ).toMatchObject({ isResolved: true, resolvedInReleaseAfter: "2.0.0" });

    expect(
      foldTwinTriage(
        kept,
        copy({ lastSeenAt: day(15), lastSeenInRelease: null }),
      ),
    ).toMatchObject({ isResolved: true });

    expect(
      foldTwinTriage(
        kept,
        copy({ lastSeenAt: day(15), lastSeenInRelease: "2.0.1" }),
      ),
    ).toEqual({ ...OPEN, regressedAt: day(15) });
  });

  test("a resolution whose time is not known counts from its own last occurrence, and is the older of two", () => {
    const unknownTime: ExceptionCopyTriage = resolved(day(10), ALICE, {
      markedAsResolvedAt: null,
      lastSeenAt: day(10),
    });

    expect(
      foldTwinTriage(unknownTime, copy({ lastSeenAt: day(8) })).isResolved,
    ).toBe(true);
    expect(
      foldTwinTriage(unknownTime, copy({ lastSeenAt: day(12) })),
    ).toEqual({ ...OPEN, regressedAt: day(12) });

    // A known time wins over an unknown one, however late that copy was seen.
    expect(
      foldTwinTriage(
        resolved(day(1), ALICE, { markedAsResolvedAt: null, lastSeenAt: day(20) }),
        resolved(day(25), BOB, { lastSeenAt: day(5) }),
      ),
    ).toMatchObject({ isResolved: true, markedAsResolvedByUserId: BOB });
  });

  test("Regressed from the earliest time it is known to have come back: a copy's own Regressed time after the resolve, else its last occurrence", () => {
    expect(
      foldTwinTriage(
        resolved(day(10), ALICE, { lastSeenAt: day(9) }),
        copy({ regressedAt: day(15), lastSeenAt: day(18) }),
      ).regressedAt,
    ).toEqual(day(15));

    // Its own Regressed time from before the resolve says nothing about after.
    expect(
      foldTwinTriage(
        resolved(day(10), ALICE, { lastSeenAt: day(9) }),
        copy({ regressedAt: day(5), lastSeenAt: day(18) }),
      ).regressedAt,
    ).toEqual(day(18));
  });

  test("a copy never seen reopens nothing", () => {
    expect(
      foldTwinTriage(
        resolved(day(10), ALICE, { lastSeenAt: day(9) }),
        copy({ lastSeenAt: null }),
      ).isResolved,
    ).toBe(true);
  });

  test("a seeded sweep: whichever copy is kept, the same state; resolved means nobody was seen after it; reopened means Regressed after it", () => {
    const random: SeededRandom = seededRandom(5214);

    // Distinct minutes, so no two times tie.
    const used: Set<number> = new Set<number>();
    const time: () => Date = (): Date => {
      let minute: number = random(60 * 24 * 30);
      while (used.has(minute)) {
        minute = random(60 * 24 * 30);
      }
      used.add(minute);
      return new Date(Date.UTC(2026, 9, 1) + minute * 60_000);
    };
    const releases: Array<string | null> = ["1.0.0", "2.0.0", "", null];
    const pick: () => string | null = (): string | null => {
      return releases[random(releases.length)]!;
    };
    const drawCopy: () => ExceptionCopyTriage = (): ExceptionCopyTriage => {
      const isResolved: boolean = random() < 0.6;
      return copy({
        isResolved: isResolved,
        markedAsResolvedAt: isResolved && random() < 0.9 ? time() : null,
        markedAsResolvedByUserId: isResolved ? ALICE : null,
        resolvedInReleaseAfter: isResolved && random() < 0.4 ? pick() : null,
        regressedAt: !isResolved && random() < 0.3 ? time() : null,
        lastSeenAt: random() < 0.95 ? time() : null,
        lastSeenInRelease: pick(),
      });
    };

    for (let round: number = 0; round < 1000; round++) {
      used.clear();
      const a: ExceptionCopyTriage = drawCopy();
      const b: ExceptionCopyTriage = drawCopy();

      const keptA: ExceptionTriage = foldTwinTriage(a, b);
      const keptB: ExceptionTriage = foldTwinTriage(b, a);

      expect(keptA.isResolved).toBe(keptB.isResolved);

      if (keptA.isResolved) {
        // Resolved as one of them was, and neither was seen after it.
        const standing: Array<ExceptionCopyTriage> = [a, b].filter(
          (one: ExceptionCopyTriage): boolean => {
            return (
              one.isResolved &&
              (one.markedAsResolvedAt?.getTime() ?? null) ===
                (keptA.markedAsResolvedAt?.getTime() ?? null) &&
              (one.resolvedInReleaseAfter ?? null) ===
                (keptA.resolvedInReleaseAfter ?? null) &&
              !reopensResolution(one, a) &&
              !reopensResolution(one, b)
            );
          },
        );
        expect({ a, b, kept: keptA, standing: standing.length > 0 }).toEqual({
          a,
          b,
          kept: keptA,
          standing: true,
        });
      } else if (a.isResolved || b.isResolved) {
        // Reopened: its resolution cleared, and Regressed.
        expect(keptA.markedAsResolvedAt).toBeNull();
        expect(keptA.markedAsResolvedByUserId).toBeNull();
        expect(keptA.resolvedInReleaseAfter).toBeNull();
        expect(keptA.regressedAt).not.toBeNull();
      } else {
        // Neither resolved: Regressed only if either was.
        expect(keptA.regressedAt?.getTime() ?? null).toBe(
          Math.max(
            a.regressedAt?.getTime() ?? -1,
            b.regressedAt?.getTime() ?? -1,
          ) < 0
            ? null
            : Math.max(
                a.regressedAt?.getTime() ?? -1,
                b.regressedAt?.getTime() ?? -1,
              ),
        );
      }
    }
  });
});

describe("the triage of the exception the kept copy was merged into", () => {
  test("open: it stays as it is", () => {
    expect(reopenedByTwin(copy(), copy({ lastSeenAt: day(20) }))).toBeNull();
  });

  test("resolved after the twin was last seen: it stays as it is", () => {
    expect(
      reopenedByTwin(
        resolved(day(12), ALICE, { lastSeenAt: day(9) }),
        copy({ lastSeenAt: day(11) }),
      ),
    ).toBeNull();
  });

  test("resolved before the twin was last seen: open again, and Regressed then", () => {
    expect(
      reopenedByTwin(
        resolved(day(12), ALICE, { lastSeenAt: day(9) }),
        copy({ lastSeenAt: day(16) }),
      ),
    ).toEqual({ ...OPEN, regressedAt: day(16) });
  });

  test("resolved in the next release, the twin last seen in that release: it stays", () => {
    expect(
      reopenedByTwin(
        resolved(day(12), ALICE, {
          lastSeenAt: day(9),
          resolvedInReleaseAfter: "2.0.0",
        }),
        copy({ lastSeenAt: day(16), lastSeenInRelease: "2.0.0" }),
      ),
    ).toBeNull();
  });
});

describe("the error class of two copies of one exception", () => {
  test.each([
    ["neither classified: the kept copy's", "default", "default", "kept"],
    ["the twin's declared by its code wins over the kept copy's AI verdict", "ai", "declared", "twin"],
    ["a person's wins over OneUptime AI's", "ai", "manual", "twin"],
    ["the kept copy's person's verdict stays over the twin's AI one", "manual", "ai", "kept"],
    ["the kept copy's declared class stays over a person's", "declared", "manual", "kept"],
    ["AI's over nobody's", "default", "ai", "twin"],
    ["a tie: the kept copy's", "manual", "manual", "kept"],
    ["a source nobody writes counts as none", "default", "legacy", "kept"],
    ["no source at all (a schema before error classes): the kept copy's", null, null, "kept"],
  ])(
    "%s",
    (
      _name: string,
      keptSource: string | null,
      twinSource: string | null,
      winner: string,
    ) => {
      const kept: { errorClass: string; errorClassSource: string | null } = {
        errorClass: "code-fault",
        errorClassSource: keptSource,
      };
      const twin: { errorClass: string; errorClassSource: string | null } = {
        errorClass: "user-error",
        errorClassSource: twinSource,
      };

      expect(foldTwinErrorClass(kept, twin)).toEqual(
        winner === "kept" ? kept : twin,
      );
    },
  );
});

describe("what reopens a resolution: ingest's rule", () => {
  const at12: ExceptionCopyTriage = resolved(day(12), ALICE);
  const at12InNext: ExceptionCopyTriage = resolved(day(12), ALICE, {
    resolvedInReleaseAfter: "2.0.0",
  });

  test.each([
    ["seen before the resolve", at12, day(11), "1.0.0", false],
    ["seen at the resolve", at12, day(12), "1.0.0", false],
    ["seen after the resolve", at12, day(13), "1.0.0", true],
    ["seen after, with no release", at12, day(13), null, true],
    ["next release, seen after in the release waited out", at12InNext, day(13), "2.0.0", false],
    ["next release, seen after with no release", at12InNext, day(13), "", false],
    ["next release, seen after in another release", at12InNext, day(13), "2.0.1", true],
    ["next release, seen before in another release", at12InNext, day(11), "2.0.1", false],
    ["never seen", at12, null, "1.0.0", false],
  ])(
    "%s",
    (
      _name: string,
      resolution: ExceptionCopyTriage,
      lastSeenAt: Date | null,
      lastSeenInRelease: string | null,
      reopens: boolean,
    ) => {
      expect(
        reopensResolution(resolution, {
          lastSeenAt: lastSeenAt,
          lastSeenInRelease: lastSeenInRelease,
        }),
      ).toBe(reopens);
    },
  );
});

// A row of the fake table: what the lock reads.
interface FakeRow {
  id: string;
  errorClass: string | null;
  errorClassSource: string | null;
  occuranceCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstSeenInRelease: string | null;
  lastSeenInRelease: string | null;
  unhandled: boolean;
  isResolved: boolean;
  markedAsResolvedAt: Date | null;
  markedAsResolvedByUserId: string | null;
  resolvedInReleaseAfter: string | null;
  regressedAt: Date | null;
  mergedIntoId: string | null;
}

function fakeRow(id: string, overrides: Partial<FakeRow> = {}): FakeRow {
  return {
    id: id,
    errorClass: "unknown",
    errorClassSource: "default",
    occuranceCount: 10,
    firstSeenAt: day(5),
    lastSeenAt: day(10),
    firstSeenInRelease: "1.0.0",
    lastSeenInRelease: "1.1.0",
    unhandled: false,
    isResolved: false,
    markedAsResolvedAt: null,
    markedAsResolvedByUserId: null,
    resolvedInReleaseAfter: null,
    regressedAt: null,
    mergedIntoId: null,
    ...overrides,
  };
}

// Every column of the table today, and those of the schema of 1806700000000.
const TODAY_COLUMNS: ReadonlySet<string> = new Set<string>(
  getMetadataArgsStorage()
    .columns.filter((column: ColumnMetadataArgs): boolean => {
      return column.target === TelemetryException;
    })
    .map((column: ColumnMetadataArgs): string => {
      return column.options.name || column.propertyName;
    }),
);

const ADDED_AFTER_THE_HOST_MERGE: Array<string> = [
  "regressedAt",
  "resolvedInReleaseAfter",
  "aiExplanation",
  "aiExplanationGeneratedAt",
  "mergedIntoTelemetryExceptionId",
  "mergedAt",
  "mergedByUserId",
];

const COLUMNS_OF_1806700000000: ReadonlySet<string> = new Set<string>(
  Array.from(TODAY_COLUMNS).filter((column: string): boolean => {
    return !ADDED_AFTER_THE_HOST_MERGE.includes(column);
  }),
);

interface Statement {
  sql: string;
  params: Array<unknown>;
}

async function takeIn(data: {
  rows: Array<FakeRow>;
  columns?: ReadonlySet<string>;
}): Promise<Array<Statement>> {
  const statements: Array<Statement> = [];

  const runner: QueryRunner = {
    query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
      statements.push({ sql, params });

      if (sql.trim().startsWith("SELECT")) {
        return data.rows;
      }

      return [];
    },
  } as unknown as QueryRunner;

  await takeInExceptionTwin(runner, {
    table: `"TelemetryException"`,
    keptId: KEPT,
    twinId: TWIN,
    columns: data.columns || TODAY_COLUMNS,
  });

  return statements;
}

function updates(statements: Array<Statement>): Array<Statement> {
  return statements.filter((statement: Statement): boolean => {
    return statement.sql.trim().startsWith("UPDATE");
  });
}

// The take-in statement on one exception, by its id parameter.
function takeInOn(
  statements: Array<Statement>,
  id: string,
): Statement | undefined {
  return updates(statements).find((statement: Statement): boolean => {
    return (
      statement.sql.includes('"occuranceCount" = COALESCE("occuranceCount", 0) +') &&
      statement.params[6] === id
    );
  });
}

describe("the statements that take a twin in", () => {
  test("locks the rows in the ingest upsert's order, the twin's survivor and members with them", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [fakeRow(KEPT), fakeRow(TWIN)],
    });

    const lock: string = statements[0]!.sql;
    expect(lock).toContain('ORDER BY "projectId", "primaryEntityId", "fingerprint"');
    expect(lock).toContain("FOR UPDATE");
    expect(lock).toContain('"_id" = ANY($1::uuid[])');
    // The exceptions the two were merged into, and those merged into the twin.
    expect(lock).toContain(
      `"_id" IN (SELECT "mergedIntoTelemetryExceptionId" FROM "TelemetryException" WHERE "_id" = ANY($1::uuid[]))`,
    );
    expect(lock).toContain(`"mergedIntoTelemetryExceptionId" = $2::uuid`);
    expect(statements[0]!.params).toEqual([[KEPT, TWIN], TWIN]);
  });

  test("neither merged: the kept one takes in the twin's whole count, seen times, releases and unhandled", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(KEPT, { occuranceCount: 10 }),
        fakeRow(TWIN, {
          occuranceCount: 7,
          firstSeenAt: day(1),
          firstSeenInRelease: "0.9.0",
          lastSeenAt: day(9),
          lastSeenInRelease: "1.0.5",
          unhandled: true,
        }),
      ],
    });

    expect(takeInOn(statements, KEPT)!.params).toEqual([
      7,
      "0.9.0",
      day(1),
      "1.0.5",
      day(9),
      true,
      KEPT,
    ]);
    // Nothing else moves; the triage did not change.
    expect(updates(statements)).toHaveLength(1);
  });

  test("on the schema the host merge meets in production: no merges to read, no Regressed time or release to write", async () => {
    const statements: Array<Statement> = await takeIn({
      columns: COLUMNS_OF_1806700000000,
      rows: [
        fakeRow(KEPT, {
          isResolved: true,
          markedAsResolvedAt: day(8),
          markedAsResolvedByUserId: ALICE,
          lastSeenAt: day(7),
        }),
        fakeRow(TWIN, { occuranceCount: 4, lastSeenAt: day(12) }),
      ],
    });

    const lock: string = statements[0]!.sql;
    expect(lock).not.toContain('FROM "TelemetryException" WHERE "_id" = ANY');
    expect(lock).toContain(`NULL::text AS "mergedIntoId"`);
    expect(lock).toContain(`NULL::timestamptz AS "regressedAt"`);
    expect(lock).toContain(`NULL::text AS "resolvedInReleaseAfter"`);
    expect(statements[0]!.params).toEqual([[KEPT, TWIN]]);

    expect(takeInOn(statements, KEPT)!.params[0]).toBe(4);

    // Seen after the resolve: open again - with the columns it has.
    const triage: Statement = updates(statements).find(
      (statement: Statement): boolean => {
        return statement.sql.includes('"isResolved" =');
      },
    )!;
    expect(triage.sql).toBe(
      `UPDATE "TelemetryException" SET "isResolved" = $1::boolean, "markedAsResolvedAt" = $2::timestamptz, "markedAsResolvedByUserId" = $3::uuid, "updatedAt" = now() WHERE "_id" = $4::uuid`,
    );
    expect(triage.params).toEqual([false, null, null, KEPT]);
    expect(
      statements.some((statement: Statement): boolean => {
        return statement.sql.includes("mergedIntoTelemetryExceptionId\" =");
      }),
    ).toBe(false);
  });

  test("the exceptions merged into the twin follow it to the kept one, which counts them with the twin's own", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(KEPT, { occuranceCount: 10 }),
        // Its own 4, and its members' 3 and 2.
        fakeRow(TWIN, { occuranceCount: 9 }),
        fakeRow(MEMBER, { occuranceCount: 3, mergedIntoId: TWIN }),
        fakeRow(OTHER_MEMBER, { occuranceCount: 2, mergedIntoId: TWIN }),
      ],
    });

    expect(takeInOn(statements, KEPT)!.params[0]).toBe(9);

    const move: Statement = updates(statements).find(
      (statement: Statement): boolean => {
        return statement.sql.includes(
          `SET "mergedIntoTelemetryExceptionId" = $1::uuid`,
        );
      },
    )!;
    expect(move.sql).toContain(
      `WHERE "mergedIntoTelemetryExceptionId" = $2::uuid AND "_id" <> $3::uuid`,
    );
    expect(move.params).toEqual([KEPT, TWIN, KEPT]);
  });

  test("the kept one merged into another: it takes in the twin's own, the one it was merged into the twin's whole group - members and all", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(SURVIVOR, { occuranceCount: 30 }),
        fakeRow(KEPT, { occuranceCount: 10, mergedIntoId: SURVIVOR }),
        fakeRow(TWIN, { occuranceCount: 9 }),
        fakeRow(MEMBER, { occuranceCount: 3, mergedIntoId: TWIN }),
      ],
    });

    expect(takeInOn(statements, KEPT)!.params[0]).toBe(6);
    expect(takeInOn(statements, SURVIVOR)!.params[0]).toBe(9);

    const move: Statement = updates(statements).find(
      (statement: Statement): boolean => {
        return statement.sql.includes(
          `SET "mergedIntoTelemetryExceptionId" = $1::uuid`,
        );
      },
    )!;
    // Nothing is merged into a merged one: they go to its survivor.
    expect(move.params[0]).toBe(SURVIVOR);
  });

  test("the twin merged into another: taken back off it first, and no longer merged", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(KEPT, { occuranceCount: 10 }),
        fakeRow(TWIN, { occuranceCount: 4, mergedIntoId: TWIN_SURVIVOR }),
        fakeRow(TWIN_SURVIVOR, { occuranceCount: 20 }),
      ],
    });

    const writes: Array<Statement> = updates(statements);
    const takeBack: number = writes.findIndex(
      (statement: Statement): boolean => {
        return statement.sql.includes(
          '"occuranceCount" = GREATEST(0, COALESCE("occuranceCount", 0) - $1)',
        );
      },
    );
    const detach: number = writes.findIndex((statement: Statement): boolean => {
      return statement.sql.includes(
        `SET "mergedIntoTelemetryExceptionId" = NULL, "updatedAt" = now() WHERE "_id" = $1::uuid`,
      );
    });

    expect(writes[takeBack]!.params).toEqual([4, TWIN_SURVIVOR]);
    expect(writes[detach]!.params).toEqual([TWIN]);
    expect(takeInOn(statements, KEPT)!.params[0]).toBe(4);
    // Taken back before the kept one takes it in.
    expect(takeBack).toBeLessThan(
      writes.indexOf(takeInOn(statements, KEPT)!),
    );
  });

  test("the kept one merged into the twin: it takes the twin's place, and the twin's count no longer holds it", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(KEPT, { occuranceCount: 5, mergedIntoId: TWIN }),
        // Its own 8, the kept one's 5 and the member's 2.
        fakeRow(TWIN, { occuranceCount: 15 }),
        fakeRow(MEMBER, { occuranceCount: 2, mergedIntoId: TWIN }),
      ],
    });

    const writes: Array<Statement> = updates(statements);
    expect(writes[0]!.sql).toContain(
      `SET "mergedIntoTelemetryExceptionId" = NULL, "mergedAt" = NULL, "mergedByUserId" = NULL`,
    );
    expect(writes[0]!.params).toEqual([KEPT]);

    // Its own 5, then the twin's own 8 and the member's 2: 15, as before.
    expect(takeInOn(statements, KEPT)!.params[0]).toBe(10);
    const move: Statement = writes.find((statement: Statement): boolean => {
      return statement.sql.includes(
        `SET "mergedIntoTelemetryExceptionId" = $1::uuid`,
      );
    })!;
    expect(move.params).toEqual([KEPT, TWIN, KEPT]);
  });

  test("either row gone already: nothing is written", async () => {
    expect(updates(await takeIn({ rows: [fakeRow(KEPT)] }))).toHaveLength(0);
    expect(updates(await takeIn({ rows: [fakeRow(TWIN)] }))).toHaveLength(0);
    expect(updates(await takeIn({ rows: [] }))).toHaveLength(0);
  });

  test("the triage: written when it changes, each column as it is typed", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(KEPT, { lastSeenAt: day(9) }),
        fakeRow(TWIN, {
          isResolved: true,
          markedAsResolvedAt: day(12),
          markedAsResolvedByUserId: BOB,
          resolvedInReleaseAfter: "2.0.0",
          lastSeenAt: day(11),
        }),
      ],
    });

    const triage: Statement = updates(statements).find(
      (statement: Statement): boolean => {
        return statement.sql.includes('"isResolved" =');
      },
    )!;

    expect(triage.sql).toBe(
      `UPDATE "TelemetryException" SET "isResolved" = $1::boolean, "markedAsResolvedAt" = $2::timestamptz, "markedAsResolvedByUserId" = $3::uuid, "resolvedInReleaseAfter" = $4::text, "regressedAt" = $5::timestamptz, "updatedAt" = now() WHERE "_id" = $6::uuid`,
    );
    expect(triage.params).toEqual([true, day(12), BOB, "2.0.0", null, KEPT]);
  });

  test("the error class: written when the twin's comes from a stronger source", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(KEPT, { errorClass: "code-fault", errorClassSource: "ai" }),
        fakeRow(TWIN, {
          errorClass: "user-error",
          errorClassSource: "manual",
        }),
      ],
    });

    const write: Statement = updates(statements).find(
      (statement: Statement): boolean => {
        return statement.sql.includes('"errorClass" =');
      },
    )!;
    expect(write.sql).toBe(
      `UPDATE "TelemetryException" SET "errorClass" = $1::text, "errorClassSource" = $2::text, "updatedAt" = now() WHERE "_id" = $3::uuid`,
    );
    expect(write.params).toEqual(["user-error", "manual", KEPT]);

    // The kept copy's from the stronger source: nothing to write.
    expect(
      updates(
        await takeIn({
          rows: [
            fakeRow(KEPT, {
              errorClass: "code-fault",
              errorClassSource: "declared",
            }),
            fakeRow(TWIN, {
              errorClass: "user-error",
              errorClassSource: "manual",
            }),
          ],
        }),
      ).some((statement: Statement): boolean => {
        return statement.sql.includes('"errorClass" =');
      }),
    ).toBe(false);
  });

  test("the exception the kept one was merged into, resolved before the twin was last seen: open again, and Regressed", async () => {
    const statements: Array<Statement> = await takeIn({
      rows: [
        fakeRow(SURVIVOR, {
          isResolved: true,
          markedAsResolvedAt: day(8),
          markedAsResolvedByUserId: ALICE,
          lastSeenAt: day(7),
        }),
        fakeRow(KEPT, { mergedIntoId: SURVIVOR, lastSeenAt: day(7) }),
        fakeRow(TWIN, { lastSeenAt: day(14) }),
      ],
    });

    const survivorTriage: Statement = updates(statements).find(
      (statement: Statement): boolean => {
        return (
          statement.sql.includes('"isResolved" =') &&
          statement.params[statement.params.length - 1] === SURVIVOR
        );
      },
    )!;

    expect(survivorTriage.params).toEqual([
      false,
      null,
      null,
      null,
      day(14),
      SURVIVOR,
    ]);
  });
});

describe("the twins DuplicateRowMerge takes in", () => {
  test("an exception both copies had is taken in, whichever table's copies merge", () => {
    expect(
      TWIN_MERGES.map((merge: TwinMerge): string => {
        return merge.table;
      }),
    ).toEqual(["TelemetryException"]);
    expect(TWIN_MERGES).toContain(EXCEPTION_TWIN_MERGE);
  });

  /*
   * A column the table lacks is left out of what is taken over (the
   * migration meets older schemas), so a name that is wrong - or one a
   * rename leaves behind - would be left out silently. Every one is a
   * column of the model today.
   */
  test("names only columns the exception table has today", () => {
    const named: Array<string> = [
      ...EXCEPTION_TWIN_MERGE.keptOrFirstOf,
      ...EXCEPTION_TWIN_MERGE.takenTogether.flatMap(
        (together: ColumnsTakenTogether): ReadonlyArray<string> => {
          return together.columns;
        },
      ),
      EXCEPTION_TWIN_MERGE.latestBy,
      // What takeInExceptionTwin reads and writes.
      "occuranceCount",
      "firstSeenAt",
      "lastSeenAt",
      "firstSeenInRelease",
      "lastSeenInRelease",
      "unhandled",
      "isResolved",
      "markedAsResolvedAt",
      "markedAsResolvedByUserId",
      "errorClass",
      "errorClassSource",
      ...ADDED_AFTER_THE_HOST_MERGE,
    ];

    for (const column of named) {
      expect([column, TODAY_COLUMNS.has(column)]).toEqual([column, true]);
    }
  });

  test("a column is in one rule only, and each group taken together reads only its own columns", () => {
    const seen: Array<string> = [...EXCEPTION_TWIN_MERGE.keptOrFirstOf];

    for (const together of EXCEPTION_TWIN_MERGE.takenTogether) {
      for (const column of together.columns) {
        expect(seen).not.toContain(column);
        seen.push(column);
      }

      const named: Array<string> = Array.from(
        together.where.matchAll(MEMBER_COLUMN),
      ).map((match: RegExpMatchArray): string => {
        return match[1]!;
      });

      expect(named.length).toBeGreaterThan(0);

      for (const column of named) {
        expect([column, together.columns.includes(column)]).toEqual([
          column,
          true,
        ]);
      }
    }
  });

  test("what decides the counts, the triage and the merges is never taken over as a person's value", () => {
    const takenOver: Array<string> = [
      ...EXCEPTION_TWIN_MERGE.keptOrFirstOf,
      ...EXCEPTION_TWIN_MERGE.takenTogether.flatMap(
        (together: ColumnsTakenTogether): ReadonlyArray<string> => {
          return together.columns;
        },
      ),
    ];

    for (const column of [
      "occuranceCount",
      "firstSeenAt",
      "lastSeenAt",
      "firstSeenInRelease",
      "lastSeenInRelease",
      "unhandled",
      "isResolved",
      "markedAsResolvedAt",
      "markedAsResolvedByUserId",
      "resolvedInReleaseAfter",
      "regressedAt",
      "errorClass",
      "errorClassSource",
      "mergedIntoTelemetryExceptionId",
      "projectId",
      "primaryEntityId",
      "fingerprint",
    ]) {
      expect(takenOver).not.toContain(column);
    }
  });
});
