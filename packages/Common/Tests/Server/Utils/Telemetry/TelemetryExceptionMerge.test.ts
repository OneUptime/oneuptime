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
  ExceptionSeen,
  ExceptionUnmergeResult,
  MAX_EXCEPTIONS_MERGED_AT_ONCE,
  getSurvivorSeenAfterUnmerge,
} from "../../../../Server/Utils/Telemetry/TelemetryExceptionMerge";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService, {
  TelemetryExceptionActivityActor,
  TelemetryExceptionActivityEntry,
} from "../../../../Server/Services/TelemetryExceptionActivityService";
import { TelemetryExceptionActivityType } from "../../../../Models/DatabaseModels/TelemetryExceptionActivity";
import ModelPermission from "../../../../Server/Types/Database/Permissions/Index";
import TelemetryException from "../../../../Models/DatabaseModels/TelemetryException";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../../Types/ObjectID";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import logger from "../../../../Server/Utils/Logger";
import { SeededRandom, seededRandom } from "../../../Helpers/SeededRandom";

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
// When ClickHouse says the survivor's own occurrences were seen.
let ownSeen: ExceptionSeen | null;
// What each merge and unmerge left on the exceptions' activity timelines.
let activity: Array<{
  entries: Array<TelemetryExceptionActivityEntry>;
  actor: TelemetryExceptionActivityActor;
}>;

function activityLines(): Array<
  [string, TelemetryExceptionActivityType, string]
> {
  return activity.flatMap(
    (call: {
      entries: Array<TelemetryExceptionActivityEntry>;
    }): Array<[string, TelemetryExceptionActivityType, string]> => {
      return call.entries.map(
        (
          entry: TelemetryExceptionActivityEntry,
        ): [string, TelemetryExceptionActivityType, string] => {
          return [
            entry.telemetryExceptionId.toString(),
            entry.activityType,
            entry.relatedTelemetryExceptionId?.toString() || "",
          ];
        },
      );
    },
  );
}

function writes(): Array<{ sql: string; params: Array<unknown> }> {
  return statements.filter((statement: { sql: string }): boolean => {
    return statement.sql.trim().startsWith("UPDATE");
  });
}

beforeEach(() => {
  rows = [row(A), row(B)];
  editableIds = [A, B, C, D];
  statements = [];
  activity = [];
  ownSeen = null;

  jest
    .spyOn(TelemetryExceptionMerge, "readOwnSeen")
    .mockImplementation((async () => {
      return ownSeen;
    }) as never);

  jest
    .spyOn(TelemetryExceptionActivityService, "record")
    .mockImplementation((async (data: {
      entries: Array<TelemetryExceptionActivityEntry>;
      actor: TelemetryExceptionActivityActor;
    }) => {
      activity.push(data);
      return data.entries.length;
    }) as never);

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
    expect(subtract!.params.slice(0, 2)).toEqual([7, A]);
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

/*
 * A merge or an unmerge changes what each exception's occurrences are read
 * by (TelemetryExceptionService.getGroupFingerprints), so once it is written
 * the group fingerprints kept of its project's exceptions are forgotten -
 * here at once, elsewhere through Redis. One that changed nothing, or was
 * refused, forgets nothing.
 */
describe("what a merge or an unmerge tells the reads of occurrences", () => {
  let forget: jest.SpiedFunction<
    typeof TelemetryExceptionService.forgetGroupFingerprints
  >;

  beforeEach(() => {
    forget = jest
      .spyOn(TelemetryExceptionService, "forgetGroupFingerprints")
      .mockResolvedValue(undefined);
  });

  function forgotAfterTheWrite(): void {
    expect(forget).toHaveBeenCalledTimes(1);
    expect(forget.mock.calls[0]![0].map(String)).toEqual([
      PROJECT_ID.toString(),
    ]);

    const written: number = Math.max(
      ...(TelemetryExceptionService.executeTransaction as unknown as jest.Mock)
        .mock.invocationCallOrder,
    );
    expect(forget.mock.invocationCallOrder[0]!).toBeGreaterThan(written);
  }

  test("a merge forgets its project's, once it is written", async () => {
    await merge(A, [B]);

    forgotAfterTheWrite();
  });

  test("merging again what is merged already, or a refused merge, forgets nothing", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];
    await merge(A, [B]);

    rows = [row(A), row(B, { primaryEntityId: OTHER_SERVICE_ID })];
    await expect(merge(A, [B])).rejects.toThrow(BadDataException);

    editableIds = [A];
    await expect(merge(A, [B])).rejects.toThrow(NotAuthorizedException);

    expect(forget).not.toHaveBeenCalled();
  });

  test("an unmerge forgets the project's of the one taken out, once it is written", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];

    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(B),
      props: CALLER,
    });

    forgotAfterTheWrite();
  });

  test("an unmerge of one that is not merged forgets nothing", async () => {
    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(B),
      props: CALLER,
    });

    expect(forget).not.toHaveBeenCalled();
  });

  test("what a merge and an unmerge change is read at once, though it was kept", async () => {
    forget.mockRestore();
    TelemetryExceptionService.clearGroupFingerprints();

    // What Postgres holds of what was merged into what.
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (sql: string, params: Array<unknown>) => {
          const ids: Array<string> = (params[1] as Array<string>) || [];
          return rows
            .filter((candidate: Row): boolean => {
              return (
                sql.includes("ROW_NUMBER()") &&
                candidate.mergedIntoId !== null &&
                ids.includes(candidate.mergedIntoId)
              );
            })
            .map((candidate: Row) => {
              return {
                survivorId: candidate.mergedIntoId,
                fingerprint: candidate.fingerprint,
              };
            });
        },
      },
    } as never);

    const groupOfA: () => Promise<Array<string>> = (): Promise<
      Array<string>
    > => {
      return TelemetryExceptionService.getGroupFingerprintsOf({
        projectId: PROJECT_ID,
        exception: { id: A, fingerprint: "fp-a" },
      });
    };

    expect(await groupOfA()).toEqual(["fp-a"]);

    await merge(A, [B]);
    rows = [row(A), row(B, { mergedIntoId: A })];
    expect(await groupOfA()).toEqual(["fp-a", "fp-b"]);

    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(B),
      props: CALLER,
    });
    rows = [row(A), row(B)];
    expect(await groupOfA()).toEqual(["fp-a"]);

    TelemetryExceptionService.clearGroupFingerprints();
  });
});

/*
 * Each merge and unmerge goes on the activity timeline of every exception it
 * moved, once it is written - never for a refused one, never for one that
 * changed nothing - crediting whoever made it.
 */
describe("the activity a merge or an unmerge leaves", () => {
  test("a merge: on the survivor, what was merged in; on the merged one, where it went", async () => {
    await merge(A, [B]);

    expect(activity).toHaveLength(1);
    expect(activity[0]!.actor).toEqual({ userId: USER_ID });
    expect(activityLines()).toEqual([
      [A, TelemetryExceptionActivityType.Merged, B],
      [B, TelemetryExceptionActivityType.MergedInto, A],
    ]);
    expect(
      activity[0]!.entries.every((entry: TelemetryExceptionActivityEntry) => {
        return entry.projectId.toString() === PROJECT_ID.toString();
      }),
    ).toBe(true);
  });

  test("the ones that came along with a merged one are merged into the survivor now, and say so", async () => {
    rows = [row(A), row(B), row(C, { mergedIntoId: B })];

    await merge(A, [B]);

    expect(activityLines()).toEqual([
      [A, TelemetryExceptionActivityType.Merged, B],
      [B, TelemetryExceptionActivityType.MergedInto, A],
      [C, TelemetryExceptionActivityType.MergedInto, A],
    ]);
  });

  test("several at once: one Merged on the survivor for each, nothing for the one already there", async () => {
    rows = [row(A), row(B), row(C), row(D, { mergedIntoId: A })];

    await merge(A, [B, C, D]);

    expect(activityLines()).toEqual([
      [A, TelemetryExceptionActivityType.Merged, B],
      [B, TelemetryExceptionActivityType.MergedInto, A],
      [A, TelemetryExceptionActivityType.Merged, C],
      [C, TelemetryExceptionActivityType.MergedInto, A],
    ]);
  });

  test("merging again what is merged already records nothing", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];

    await merge(A, [B]);

    expect(activityLines()).toEqual([]);
  });

  test("a refused merge records nothing", async () => {
    rows = [row(A), row(B, { primaryEntityId: OTHER_SERVICE_ID })];
    await expect(merge(A, [B])).rejects.toThrow(BadDataException);

    editableIds = [A];
    await expect(merge(A, [B])).rejects.toThrow(NotAuthorizedException);

    expect(activity).toHaveLength(0);
  });

  test("an unmerge: on the survivor, what was taken out; on the one taken out, where from", async () => {
    rows = [row(A), row(B, { mergedIntoId: A })];

    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(B),
      props: CALLER,
    });

    expect(activity[0]!.actor).toEqual({ userId: USER_ID });
    expect(activityLines()).toEqual([
      [A, TelemetryExceptionActivityType.Unmerged, B],
      [B, TelemetryExceptionActivityType.UnmergedFrom, A],
    ]);
  });

  test("an unmerge that changed nothing records nothing", async () => {
    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(B),
      props: CALLER,
    });

    expect(activity).toHaveLength(0);
  });

  test("a merge through an API key is credited to the key", async () => {
    await merge(A, [B], {
      tenantId: PROJECT_ID,
      apiKeyId: ObjectID.generate(),
      apiKeyName: "Cleanup script",
    });

    expect(activity[0]!.actor).toEqual({ apiKeyName: "Cleanup script" });
  });
});

/*
 * An unmerge gives the survivor back its own first and last seen, where the
 * one taken out had set them: from the survivor's own occurrences, as
 * ClickHouse holds them by its fingerprint, and from the exceptions still
 * merged into it, which keep their own seen times.
 */
describe("the survivor's first and last seen after an unmerge", () => {
  const DAY: number = 24 * 60 * 60 * 1000;
  const BASE: number = new Date("2026-10-01T00:00:00.000Z").getTime();

  function day(n: number): Date {
    return new Date(BASE + n * DAY);
  }

  function seen(
    first: number | null,
    last: number | null,
    firstRelease: string | null = null,
    lastRelease: string | null = null,
  ): ExceptionSeen {
    return {
      firstSeenAt: first === null ? null : day(first),
      lastSeenAt: last === null ? null : day(last),
      firstSeenInRelease: firstRelease,
      lastSeenInRelease: lastRelease,
    };
  }

  // The survivor's write: its count, then its seen times and releases.
  async function unmergeB(): Promise<Array<unknown>> {
    await TelemetryExceptionMerge.unmerge({
      telemetryExceptionId: new ObjectID(B),
      props: CALLER,
    });

    return writes()[0]!.params;
  }

  test("set by the one taken out, they go back to the survivor's own", async () => {
    // A was first seen on day 5 and last on day 20; B on days 1 and 25.
    rows = [
      row(A, {
        occuranceCount: 17,
        firstSeenAt: day(1),
        lastSeenAt: day(25),
        firstSeenInRelease: "b-1",
        lastSeenInRelease: "b-9",
      }),
      row(B, {
        occuranceCount: 7,
        mergedIntoId: A,
        firstSeenAt: day(1),
        lastSeenAt: day(25),
        firstSeenInRelease: "b-1",
        lastSeenInRelease: "b-9",
      }),
    ];
    ownSeen = seen(5, 20, "a-1", "a-4");

    expect(await unmergeB()).toEqual([7, A, day(5), day(20), "a-1", "a-4"]);
    expect(TelemetryExceptionMerge.readOwnSeen).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      primaryEntityId: new ObjectID(SERVICE_ID),
      fingerprint: "fp-a",
    });
  });

  test("one the one taken out did not set stays", async () => {
    // B set the first seen only: A's own last occurrence is the latest.
    rows = [
      row(A, { firstSeenAt: day(1), lastSeenAt: day(30) }),
      row(B, { mergedIntoId: A, firstSeenAt: day(1), lastSeenAt: day(12) }),
    ];
    ownSeen = seen(4, 30, "a-1", "a-7");

    expect((await unmergeB()).slice(2)).toEqual([
      day(4),
      day(30),
      "a-1",
      "1.2.0",
    ]);
  });

  test("another exception still merged into it counts as its own", async () => {
    rows = [
      row(A, { firstSeenAt: day(1), lastSeenAt: day(25) }),
      row(B, { mergedIntoId: A, firstSeenAt: day(1), lastSeenAt: day(25) }),
      row(C, {
        mergedIntoId: A,
        firstSeenAt: day(2),
        lastSeenAt: day(24),
        firstSeenInRelease: "c-1",
        lastSeenInRelease: "c-3",
      }),
    ];
    ownSeen = seen(6, 18, "a-1", "a-2");

    expect((await unmergeB()).slice(2)).toEqual([
      day(2),
      day(24),
      "c-1",
      "c-3",
    ]);
  });

  test("with nothing left to say otherwise, they stay as they were", async () => {
    // ClickHouse holds none of A's own occurrences, and nothing else is merged in.
    rows = [
      row(A, { firstSeenAt: day(1), lastSeenAt: day(25) }),
      row(B, { mergedIntoId: A, firstSeenAt: day(1), lastSeenAt: day(25) }),
    ];
    ownSeen = null;

    expect((await unmergeB()).slice(2)).toEqual([
      day(1),
      day(25),
      "1.0.0",
      "1.2.0",
    ]);
  });

  test("a seeded sweep: each seen time goes back to what is left where the one taken out set it, and stays otherwise", () => {
    const random: SeededRandom = seededRandom(5445);

    function maybeSeen(): ExceptionSeen | null {
      if (random(5) === 0) {
        return null;
      }
      const first: number = random(40);
      return seen(first, first + random(40), `r-${first}`, `r-${random(9)}`);
    }

    function firstsOf(entries: Array<ExceptionSeen>): Array<number> {
      return entries
        .filter((entry: ExceptionSeen): boolean => {
          return entry.firstSeenAt !== null;
        })
        .map((entry: ExceptionSeen): number => {
          return entry.firstSeenAt!.getTime();
        });
    }

    function lastsOf(entries: Array<ExceptionSeen>): Array<number> {
      return entries
        .filter((entry: ExceptionSeen): boolean => {
          return entry.lastSeenAt !== null;
        })
        .map((entry: ExceptionSeen): number => {
          return entry.lastSeenAt!.getTime();
        });
    }

    for (let round: number = 0; round < 2000; round++) {
      const own: ExceptionSeen | null = maybeSeen();
      const members: Array<ExceptionSeen> = [];
      for (let index: number = random(4); index > 0; index--) {
        members.push(maybeSeen() || seen(null, null));
      }
      const merged: ExceptionSeen = maybeSeen() || seen(null, null);
      const left: Array<ExceptionSeen> = [...(own ? [own] : []), ...members];

      // The survivor's seen times take in everyone's, as a merge leaves them.
      const allFirsts: Array<number> = firstsOf([...left, merged]);
      const allLasts: Array<number> = lastsOf([...left, merged]);
      const survivor: ExceptionSeen = {
        firstSeenAt: allFirsts.length ? new Date(Math.min(...allFirsts)) : null,
        lastSeenAt: allLasts.length ? new Date(Math.max(...allLasts)) : null,
        firstSeenInRelease: "survivor-first",
        lastSeenInRelease: "survivor-last",
      };

      const after: ExceptionSeen = getSurvivorSeenAfterUnmerge({
        survivor,
        merged,
        members,
        own,
      });

      const mergedSetFirst: boolean =
        survivor.firstSeenAt !== null &&
        merged.firstSeenAt !== null &&
        merged.firstSeenAt.getTime() <= survivor.firstSeenAt.getTime();
      const mergedSetLast: boolean =
        survivor.lastSeenAt !== null &&
        merged.lastSeenAt !== null &&
        merged.lastSeenAt.getTime() >= survivor.lastSeenAt.getTime();
      const leftFirsts: Array<number> = firstsOf(left);
      const leftLasts: Array<number> = lastsOf(left);

      expect(after.firstSeenAt ? after.firstSeenAt.getTime() : null).toBe(
        mergedSetFirst && leftFirsts.length
          ? Math.min(...leftFirsts)
          : survivor.firstSeenAt
            ? survivor.firstSeenAt.getTime()
            : null,
      );
      expect(after.lastSeenAt ? after.lastSeenAt.getTime() : null).toBe(
        mergedSetLast && leftLasts.length
          ? Math.max(...leftLasts)
          : survivor.lastSeenAt
            ? survivor.lastSeenAt.getTime()
            : null,
      );

      // Taking one out only ever narrows the window.
      if (after.firstSeenAt && survivor.firstSeenAt) {
        expect(after.firstSeenAt.getTime()).toBeGreaterThanOrEqual(
          survivor.firstSeenAt.getTime(),
        );
      }
      if (after.lastSeenAt && survivor.lastSeenAt) {
        expect(after.lastSeenAt.getTime()).toBeLessThanOrEqual(
          survivor.lastSeenAt.getTime(),
        );
      }
    }
  });
});

describe("reading when an exception's own occurrences were seen", () => {
  function answer(data: Array<Record<string, unknown>>): void {
    jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockImplementation((async () => {
        return {
          json: async () => {
            return { data };
          },
        };
      }) as never);
  }

  async function read(): Promise<ExceptionSeen | null> {
    // The real read, not the suite's stand-in for it.
    (
      TelemetryExceptionMerge.readOwnSeen as unknown as {
        mockRestore: () => void;
      }
    ).mockRestore();

    return TelemetryExceptionMerge.readOwnSeen({
      projectId: PROJECT_ID,
      primaryEntityId: new ObjectID(SERVICE_ID),
      fingerprint: "fp-a",
    });
  }

  test("by its fingerprint and service, within retention", async () => {
    answer([
      {
        occurrences: "3",
        firstSeenAt: String(Date.parse("2026-10-05T10:00:00.000Z")),
        lastSeenAt: String(Date.parse("2026-10-20T08:30:00.000Z")),
        firstSeenInRelease: "a-1",
        lastSeenInRelease: "",
      },
    ]);

    expect(await read()).toEqual({
      firstSeenAt: new Date("2026-10-05T10:00:00.000Z"),
      lastSeenAt: new Date("2026-10-20T08:30:00.000Z"),
      firstSeenInRelease: "a-1",
      lastSeenInRelease: null,
    });

    const statement: { query: string } = (
      ExceptionInstanceService.executeQuery as unknown as {
        mock: { calls: Array<Array<unknown>> };
      }
    ).mock.calls[0]![0] as { query: string };
    expect(statement.query).toContain("AND fingerprint = {p");
    expect(statement.query).toContain("AND primaryEntityId = {p");
    expect(statement.query).toContain("AND retentionDate >= now()");
  });

  test("none held, or a read that fails: nothing to say", async () => {
    answer([{ occurrences: "0", firstSeenAt: "0", lastSeenAt: "0" }]);
    expect(await read()).toBeNull();

    jest
      .spyOn(ExceptionInstanceService, "executeQuery")
      .mockImplementation((async () => {
        throw new Error("ClickHouse is away");
      }) as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    expect(
      await TelemetryExceptionMerge.readOwnSeen({
        projectId: PROJECT_ID,
        primaryEntityId: new ObjectID(SERVICE_ID),
        fingerprint: "fp-a",
      }),
    ).toBeNull();
    expect(logger.error).toHaveBeenCalled();
  });
});
