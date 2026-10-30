import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionMergeResult,
  ExceptionUnmergeOutcome,
  ExceptionUnmergeResult,
  MAX_EXCEPTIONS_MERGED_AT_ONCE,
} from "../../../../Server/Utils/Telemetry/TelemetryExceptionMerge";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Merging exceptions that are the same bug, and undoing it, with Postgres
 * mocked: who may (an edit of every exception involved, checked before
 * anything is written), what is refused, and the statements that move the
 * counts. App/Tests/Telemetry/ExceptionMergePostgres.test.ts runs the same
 * statements against a real Postgres, with ingest in between.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);
const SERVICE_ID: string = "20000000-0000-4000-8000-000000000001";
const OTHER_SERVICE_ID: string = "20000000-0000-4000-8000-000000000002";
const USER_ID: ObjectID = new ObjectID("90000000-0000-4000-8000-000000000001");
const CALLER: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

const A: string = "30000000-0000-4000-8000-00000000000a";
const B: string = "30000000-0000-4000-8000-00000000000b";
const C: string = "30000000-0000-4000-8000-00000000000c";
const D: string = "30000000-0000-4000-8000-00000000000d";

interface Row {
  id: string;
  projectId: string;
  primaryEntityId: string;
  fingerprint: string;
  mergedIntoId: string | null;
  occuranceCount: number;
  firstSeenAt: Date | null;
  lastSeenAt: Date | null;
  firstSeenInRelease: string | null;
  lastSeenInRelease: string | null;
  unhandled: boolean;
}

function row(id: string, overrides: Partial<Row> = {}): Row {
  return {
    id,
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID,
    fingerprint: `fp-${id.slice(-1)}`,
    mergedIntoId: null,
    occuranceCount: 10,
    firstSeenAt: new Date("2026-10-20T00:00:00.000Z"),
    lastSeenAt: new Date("2026-10-29T00:00:00.000Z"),
    firstSeenInRelease: "1.0.0",
    lastSeenInRelease: "1.2.0",
    unhandled: false,
    ...overrides,
  };
}

let rows: Array<Row>;
let editableIds: Array<string> | "throw";
let statements: Array<{ sql: string; params: Array<unknown> }>;

function writes(): Array<{ sql: string; params: Array<unknown> }> {
  return statements.filter((statement: { sql: string }): boolean => {
    return statement.sql.trim().startsWith("UPDATE");
  });
}

beforeEach(() => {
  rows = [row(A), row(B)];
  editableIds = [A, B, C, D];
  statements = [];

  jest.spyOn(ModelPermission, "getUpdatableQuery").mockImplementation((async (
    _type: unknown,
    query: Record<string, unknown>,
  ) => {
    if (editableIds === "throw") {
      throw new NotAuthorizedException("You do not have Edit permission");
    }
    return query;
  }) as never);

  jest
    .spyOn(TelemetryExceptionService, "addExceptionScope")
    .mockImplementation((async (query: unknown) => {
      return query;
    }) as never);

  jest
    .spyOn(TelemetryExceptionService, "findBy")
    .mockImplementation((async () => {
      const editable: Array<string> =
        editableIds === "throw" ? [] : editableIds;
      return rows
        .filter((candidate: Row): boolean => {
          return editable.includes(candidate.id);
        })
        .map((candidate: Row): TelemetryException => {
          const model: TelemetryException = new TelemetryException();
          model._id = candidate.id;
          model.primaryEntityId = new ObjectID(candidate.primaryEntityId);
          model.fingerprint = candidate.fingerprint;
          if (candidate.mergedIntoId) {
            model.mergedIntoTelemetryExceptionId = new ObjectID(
              candidate.mergedIntoId,
            );
          }
          return model;
        });
    }) as never);

  jest
    .spyOn(TelemetryExceptionService, "executeTransaction")
    .mockImplementation((async (
      run: (manager: unknown) => Promise<unknown>,
    ) => {
      return run({
        query: async (sql: string, params: Array<unknown>) => {
          statements.push({ sql, params });
          if (sql.trim().startsWith("SELECT")) {
            const ids: Array<string> = (params[0] as Array<string>) || [];
            const mergedIds: Array<string> = (params[1] as Array<string>) || [];
            return rows.filter((candidate: Row): boolean => {
              return (
                ids.includes(candidate.id) ||
                (candidate.mergedIntoId !== null &&
                  mergedIds.includes(candidate.mergedIntoId))
              );
            });
          }
          return [];
        },
      });
    }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

async function merge(
  survivor: string,
  merged: Array<string>,
  props: DatabaseCommonInteractionProps = CALLER,
): Promise<ExceptionMergeResult> {
  return TelemetryExceptionMerge.merge({
    telemetryExceptionId: new ObjectID(survivor),
    mergedTelemetryExceptionIds: merged.map((id: string): ObjectID => {
      return new ObjectID(id);
    }),
    props,
  });
}

describe("who may merge", () => {
  test("someone who may only read exceptions is refused before anything is written", async () => {
    editableIds = "throw";

    await expect(merge(A, [B])).rejects.toThrow(NotAuthorizedException);
    expect(statements).toHaveLength(0);
  });

  test("an exception the caller may not edit - the survivor or a merged one - is refused before anything is written", async () => {
    editableIds = [A];
    await expect(merge(A, [B])).rejects.toThrow(NotAuthorizedException);

    editableIds = [B];
    await expect(merge(A, [B])).rejects.toThrow(NotAuthorizedException);

    expect(statements).toHaveLength(0);
  });

  test("the edit is checked on the caller's project and both ids, as an edit of them would be", async () => {
    await merge(A, [B]);

    const [, query, props] = (
      ModelPermission.getUpdatableQuery as unknown as jest.Mock
    ).mock.calls[0]! as [unknown, Record<string, unknown>, unknown];
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(props).toBe(CALLER);
    expect(TelemetryExceptionService.addExceptionScope).toHaveBeenCalled();
  });

  test("no project: refused", async () => {
    await expect(
      merge(A, [B], { userId: USER_ID } as DatabaseCommonInteractionProps),
    ).rejects.toThrow(BadDataException);
  });
});

describe("what cannot be merged", () => {
  test("an exception into itself", async () => {
    await expect(merge(A, [A])).rejects.toThrow(
      "An exception cannot be merged into itself",
    );
  });

  test("exceptions of two services", async () => {
    rows = [row(A), row(B, { primaryEntityId: OTHER_SERVICE_ID })];

    await expect(merge(A, [B])).rejects.toThrow(
      "Only exceptions of the same service can be merged.",
    );
    expect(writes()).toHaveLength(0);
  });

  test("into an exception that was itself merged", async () => {
    rows = [row(A, { mergedIntoId: C }), row(B), row(C)];

    await expect(merge(A, [B])).rejects.toThrow(
      "This exception was merged into another one. Merge into that one instead.",
    );
    expect(writes()).toHaveLength(0);
  });

  test("one already merged into another exception", async () => {
    rows = [row(A), row(B, { mergedIntoId: C }), row(C)];

    await expect(merge(A, [B])).rejects.toThrow(
      "One of these exceptions is already merged into another one. Unmerge it first.",
    );
    expect(writes()).toHaveLength(0);
  });

  test("no ids, malformed ids or too many, read off a request", () => {
    expect(() => {
      return TelemetryExceptionMerge.readIds([]);
    }).toThrow(BadDataException);
    expect(() => {
      return TelemetryExceptionMerge.readIds(["nope"]);
    }).toThrow(BadDataException);
    expect(() => {
      return TelemetryExceptionMerge.readIds("not-a-list");
    }).toThrow(BadDataException);
    expect(() => {
      return TelemetryExceptionMerge.readIds(
        new Array(MAX_EXCEPTIONS_MERGED_AT_ONCE + 1).fill(B),
      );
    }).toThrow(BadDataException);
    expect(
      TelemetryExceptionMerge.readIds([B, B.toUpperCase(), C]).map(
        (id: ObjectID): string => {
          return id.toString();
        },
      ),
    ).toEqual([B, C]);
  });
});

describe("merging", () => {
  test("locks the rows in the ingest upsert's order, then marks the merged one and adds its count to the survivor", async () => {
    rows = [
      row(A, { occuranceCount: 5 }),
      row(B, {
        occuranceCount: 7,
        firstSeenAt: new Date("2026-10-01T00:00:00.000Z"),
        firstSeenInRelease: "0.9.0",
        unhandled: true,
      }),
    ];

    const result: ExceptionMergeResult = await merge(A, [B]);

    expect(result).toEqual({
      telemetryExceptionId: A,
      merged: [
        { telemetryExceptionId: B, outcome: ExceptionMergeOutcome.Merged },
      ],
    });

    const lock: string = statements[0]!.sql;
    expect(lock).toContain("FOR UPDATE");
    expect(lock).toContain(
      'ORDER BY "projectId", "primaryEntityId", "fingerprint"',
    );
    expect(lock).toContain('"deletedAt" IS NULL');

    const [markMerged, addToSurvivor] = writes();
    expect(markMerged!.sql).toContain(
      '"mergedIntoTelemetryExceptionId" = $1, "mergedAt" = now(), "mergedByUserId" = $2',
    );
    // B had nothing merged into it, so it keeps its whole count.
    expect(markMerged!.params).toEqual([A, USER_ID.toString(), 0, B]);

    expect(addToSurvivor!.sql).toContain(
      '"occuranceCount" = COALESCE("occuranceCount", 0) + $1',
    );
    expect(addToSurvivor!.sql).toContain(
      '"firstSeenAt" = LEAST("firstSeenAt", $3::timestamptz)',
    );
    expect(addToSurvivor!.sql).toContain(
      '"lastSeenAt" = GREATEST("lastSeenAt", $5::timestamptz)',
    );
    expect(addToSurvivor!.params).toEqual([
      7,
      "0.9.0",
      new Date("2026-10-01T00:00:00.000Z"),
      "1.2.0",
      new Date("2026-10-29T00:00:00.000Z"),
      true,
      A,
    ]);
  });

  test("the exceptions merged into a merged one move to the survivor, and their counts with them", async () => {
    rows = [
      row(A, { occuranceCount: 5 }),
      // B counts its own 4 and C's 3.
      row(B, { occuranceCount: 7 }),
      row(C, { occuranceCount: 3, mergedIntoId: B }),
    ];

    await merge(A, [B]);

    const [markMerged, moveMembers, addToSurvivor] = writes();
    // B keeps only its own.
    expect(markMerged!.params).toEqual([A, USER_ID.toString(), 3, B]);
    expect(moveMembers!.sql).toContain(
      'SET "mergedIntoTelemetryExceptionId" = $1, "updatedAt" = now() WHERE "mergedIntoTelemetryExceptionId" = $2',
    );
    expect(moveMembers!.params).toEqual([A, B]);
    // A gains B's own and C's: what B counted.
    expect(addToSurvivor!.params[0]).toBe(7);
  });

  test("merging again what is already merged into the survivor changes nothing", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];

    const result: ExceptionMergeResult = await merge(A, [B]);

    expect(result.merged).toEqual([
      { telemetryExceptionId: B, outcome: ExceptionMergeOutcome.AlreadyMerged },
    ]);
    expect(writes()).toHaveLength(0);
  });

  test("several at once: one survivor update with all of their counts", async () => {
    rows = [
      row(A, { occuranceCount: 1 }),
      row(B, { occuranceCount: 2 }),
      row(C, { occuranceCount: 4 }),
      row(D, { occuranceCount: 8, mergedIntoId: A }),
    ];

    const result: ExceptionMergeResult = await merge(A, [B, C, D]);

    expect(
      result.merged.map((entry: { outcome: ExceptionMergeOutcome }) => {
        return entry.outcome;
      }),
    ).toEqual([
      ExceptionMergeOutcome.Merged,
      ExceptionMergeOutcome.Merged,
      ExceptionMergeOutcome.AlreadyMerged,
    ]);

    const survivorUpdates: Array<{ sql: string; params: Array<unknown> }> =
      writes().filter((statement: { sql: string }): boolean => {
        return statement.sql.includes(
          '"occuranceCount" = COALESCE("occuranceCount", 0) +',
        );
      });
    expect(survivorUpdates).toHaveLength(1);
    expect(survivorUpdates[0]!.params[0]).toBe(6);
  });
});

describe("unmerging", () => {
  async function unmerge(
    id: string,
    props: DatabaseCommonInteractionProps = CALLER,
  ): Promise<ExceptionUnmergeResult> {
    return TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(id),
      props,
    });
  }

  test("takes exactly the merged one's count back off the survivor, and gives it back its place", async () => {
    rows = [
      row(A, { occuranceCount: 17 }),
      row(B, { occuranceCount: 7, mergedIntoId: A }),
    ];

    const result: ExceptionUnmergeResult = await unmerge(B);

    expect(result).toEqual({
      telemetryExceptionId: B,
      unmergedFromTelemetryExceptionId: A,
      outcome: ExceptionUnmergeOutcome.Unmerged,
    });

    const [subtract, release] = writes();
    expect(subtract!.sql).toContain(
      '"occuranceCount" = GREATEST(0, COALESCE("occuranceCount", 0) - $1)',
    );
    expect(subtract!.params).toEqual([7, A]);
    expect(release!.sql).toContain(
      '"mergedIntoTelemetryExceptionId" = NULL, "mergedAt" = NULL, "mergedByUserId" = NULL',
    );
    expect(release!.params).toEqual([B]);
  });

  test("an exception that is not merged: nothing to do, nothing written", async () => {
    const result: ExceptionUnmergeResult = await unmerge(B);

    expect(result.outcome).toBe(ExceptionUnmergeOutcome.NotMerged);
    expect(result.unmergedFromTelemetryExceptionId).toBeNull();
    expect(statements).toHaveLength(0);
  });

  test("unmerged by someone else meanwhile: nothing written", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];
    (
      TelemetryExceptionService.executeTransaction as unknown as jest.Mock
    ).mockImplementation(
      async (run: (manager: unknown) => Promise<unknown>) => {
        return run({
          query: async (sql: string) => {
            statements.push({ sql, params: [] });
            return [row(B), row(A)];
          },
        });
      },
    );

    const result: ExceptionUnmergeResult = await unmerge(B);

    expect(result.outcome).toBe(ExceptionUnmergeOutcome.NotMerged);
    expect(writes()).toHaveLength(0);
  });

  test("needs permission to edit the merged one and the one it was merged into", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];

    editableIds = [A];
    await expect(unmerge(B)).rejects.toThrow(NotAuthorizedException);

    editableIds = [B];
    await expect(unmerge(B)).rejects.toThrow(
      "You do not have permission to edit the exception this one was merged into.",
    );

    editableIds = "throw";
    await expect(unmerge(B)).rejects.toThrow(NotAuthorizedException);

    expect(statements).toHaveLength(0);
  });
});
