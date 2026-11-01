import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import TelemetryExceptionService, {
  ExceptionOfGroup,
  GROUP_FINGERPRINTS_GENERATION_NAMESPACE,
  GROUP_FINGERPRINTS_TTL_MS,
  MAX_KEPT_GROUP_FINGERPRINTS,
  MAX_MERGED_FINGERPRINTS_READ,
  MergedFingerprintsRead,
  Service as TelemetryExceptionServiceClass,
} from "../../../Server/Services/TelemetryExceptionService";
import CacheGenerations from "../../../Server/Infrastructure/CacheGenerations";
import GlobalCache from "../../../Server/Infrastructure/GlobalCache";
import logger from "../../../Server/Utils/Logger";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import {
  MAX_MERGED_FINGERPRINTS_PER_EXCEPTION,
  getOccurrenceFingerprintQuery,
  toExceptionGroupFingerprints,
} from "../../../Types/Telemetry/ExceptionGroupFingerprints";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * THE FINGERPRINTS AN EXCEPTION'S OCCURRENCES CARRY
 * (TelemetryExceptionService.getGroupFingerprints): its own, then those of
 * the exceptions merged into it, the most recently seen first, at most
 * MAX_MERGED_FINGERPRINTS_PER_EXCEPTION of them - read once for a batch,
 * kept for GROUP_FINGERPRINTS_TTL_MS under the project's generation, which
 * a merge or an unmerge moves on, here at once and elsewhere through Redis.
 * An exception nothing was merged into is its own fingerprint alone, read
 * exactly as before any merge; a read that fails is too, and is not kept.
 *
 * Postgres is a stand-in that answers the read's SQL from rows held here,
 * by the same rules (the rank of each survivor's members, the order, the
 * limit); Redis is one map every "process" shares. App/Tests/Telemetry/
 * ExceptionMergePostgres.test.ts reads through a real Postgres.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "20000000-0000-4000-8000-000000000002",
);
const SERVICE_ID: string = "20000000-0000-4000-8000-0000000000aa";

// A row of the stand-in TelemetryException table.
interface Row {
  id: string;
  projectId: string;
  primaryEntityId: string;
  fingerprint: string;
  mergedInto: string | null;
  lastSeenAt: Date | null;
  deleted?: boolean;
}

let rows: Array<Row>;
let queries: Array<{ sql: string; params: Array<unknown> }>;
let failReads: boolean;
let redis: Map<string, string>;
let now: number;

function idOf(index: number, project: number = 1): string {
  return `2${project}000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

function row(change: Partial<Row> & { id: string; fingerprint: string }): Row {
  return {
    projectId: PROJECT_ID.toString(),
    primaryEntityId: SERVICE_ID,
    mergedInto: null,
    lastSeenAt: new Date(Date.UTC(2026, 9, 1)),
    ...change,
  };
}

// ORDER BY "lastSeenAt" DESC NULLS LAST, "fingerprint" ASC
function byRecency(a: Row, b: Row): number {
  const aTime: number | null = a.lastSeenAt ? a.lastSeenAt.getTime() : null;
  const bTime: number | null = b.lastSeenAt ? b.lastSeenAt.getTime() : null;

  if (aTime !== bTime) {
    if (aTime === null) {
      return 1;
    }
    if (bTime === null) {
      return -1;
    }
    return bTime - aTime;
  }

  return a.fingerprint < b.fingerprint
    ? -1
    : a.fingerprint > b.fingerprint
      ? 1
      : 0;
}

// What Postgres answers the two reads with, from the rows held here.
async function answer(
  sql: string,
  params: Array<unknown>,
): Promise<Array<Record<string, unknown>>> {
  queries.push({ sql, params });

  if (failReads) {
    throw new Error("Postgres is down");
  }

  if (sql.includes("ROW_NUMBER()")) {
    const [projectId, ids, perSurvivor, limit] = params as [
      string,
      Array<string>,
      number,
      number,
    ];
    const ranked: Array<Row> = [];
    const bySurvivor: Map<string, Array<Row>> = new Map();

    for (const candidate of rows) {
      if (
        candidate.projectId === projectId &&
        candidate.mergedInto &&
        ids.includes(candidate.mergedInto) &&
        !candidate.deleted
      ) {
        bySurvivor.set(candidate.mergedInto, [
          ...(bySurvivor.get(candidate.mergedInto) || []),
          candidate,
        ]);
      }
    }

    for (const members of bySurvivor.values()) {
      ranked.push(...members.sort(byRecency).slice(0, perSurvivor));
    }

    return ranked
      .sort(byRecency)
      .slice(0, limit)
      .map((member: Row): Record<string, unknown> => {
        return {
          survivorId: member.mergedInto,
          fingerprint: member.fingerprint,
        };
      });
  }

  if (sql.includes(`"fingerprint" = $2`)) {
    const [projectId, fingerprint, limit, primaryEntityId] = params as [
      string,
      string,
      number,
      string | undefined,
    ];

    return rows
      .filter((candidate: Row): boolean => {
        return (
          candidate.projectId === projectId &&
          candidate.fingerprint === fingerprint &&
          candidate.mergedInto === null &&
          !candidate.deleted &&
          (primaryEntityId === undefined ||
            candidate.primaryEntityId === primaryEntityId)
        );
      })
      .map((found: Row): string => {
        return found.id;
      })
      .sort()
      .slice(0, limit)
      .map((id: string): Record<string, unknown> => {
        return { id };
      });
  }

  throw new Error(`Unexpected SQL: ${sql}`);
}

// Postgres, for a "process" (an instance of the service).
function connect(service: TelemetryExceptionServiceClass): void {
  jest.spyOn(service, "getRepository").mockReturnValue({
    manager: {
      query: (sql: string, params: Array<unknown>) => {
        return answer(sql, params);
      },
    },
  } as never);
}

function memberReads(): number {
  return queries.filter((query: { sql: string }): boolean => {
    return query.sql.includes("ROW_NUMBER()");
  }).length;
}

function exception(found: Row): ExceptionOfGroup {
  return { id: found.id, fingerprint: found.fingerprint };
}

async function groupOf(
  found: Row,
  service: TelemetryExceptionServiceClass = TelemetryExceptionService,
): Promise<Array<string>> {
  return service.getGroupFingerprintsOf({
    projectId: new ObjectID(found.projectId),
    exception: exception(found),
  });
}

beforeEach(() => {
  rows = [];
  queries = [];
  failReads = false;
  redis = new Map();
  now = Date.UTC(2026, 9, 31, 12, 0, 0);

  jest.spyOn(Date, "now").mockImplementation((): number => {
    return now;
  });

  for (const level of ["debug", "info", "warn", "error"] as const) {
    jest.spyOn(logger, level).mockImplementation((() => {
      return undefined;
    }) as never);
  }

  jest
    .spyOn(GlobalCache, "getString")
    .mockImplementation(
      async (namespace: string, key: string): Promise<string | null> => {
        return redis.get(`${namespace}-${key}`) || null;
      },
    );
  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string): Promise<void> => {
        redis.set(`${namespace}-${key}`, value);
      },
    );

  TelemetryExceptionService.clearGroupFingerprints();
  connect(TelemetryExceptionService);
});

afterEach(() => {
  jest.restoreAllMocks();
  TelemetryExceptionService.clearGroupFingerprints();
});

describe("an exception's group, pure", () => {
  test("its own fingerprint, then the merged ones as given, without blanks or repeats", () => {
    expect(toExceptionGroupFingerprints("a", [])).toEqual(["a"]);
    expect(toExceptionGroupFingerprints("a", ["b", "", "a", "c", "b"])).toEqual(
      ["a", "b", "c"],
    );
    expect(
      toExceptionGroupFingerprints("a", [
        "b",
        7,
        null,
        undefined,
        { fingerprint: "x" },
      ]),
    ).toEqual(["a", "b"]);
    // An exception without a fingerprint of its own has none to read by.
    expect(toExceptionGroupFingerprints("", ["b"])).toEqual(["b"]);
  });

  test(`at most ${MAX_MERGED_FINGERPRINTS_PER_EXCEPTION} merged ones, the first given`, () => {
    const merged: Array<string> = Array.from(
      { length: MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 30 },
      (_value: unknown, index: number): string => {
        return `m-${index}`;
      },
    );

    const group: Array<string> = toExceptionGroupFingerprints("own", [
      "own",
      ...merged,
    ]);

    expect(group).toHaveLength(MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 1);
    expect(group[0]).toBe("own");
    expect(group.slice(1)).toEqual(
      merged.slice(0, MAX_MERGED_FINGERPRINTS_PER_EXCEPTION),
    );
  });

  test("a group of one is read by that fingerprint alone, exactly as before any merge; more, by any of them", () => {
    expect(getOccurrenceFingerprintQuery(["a"])).toBe("a");

    const query: string | Includes = getOccurrenceFingerprintQuery([
      "a",
      "b",
      "c",
    ]);
    expect(query).toBeInstanceOf(Includes);
    expect((query as Includes).values).toEqual(["a", "b", "c"]);
  });
});

describe("what was merged into some exceptions, in one read", () => {
  test("one read of the merge column, as the project's, bounded per exception and in all", async () => {
    rows = [
      row({ id: idOf(1), fingerprint: "a" }),
      row({ id: idOf(2), fingerprint: "b", mergedInto: idOf(1) }),
    ];

    const read: MergedFingerprintsRead =
      await TelemetryExceptionService.readMergedFingerprints({
        projectId: PROJECT_ID,
        survivorIds: [idOf(1).toUpperCase(), idOf(1), "not-an-id", ""],
      });

    expect(read.bySurvivor.get(idOf(1))).toEqual(["b"]);
    expect(read.isComplete).toBe(true);
    expect(queries).toHaveLength(1);

    const { sql, params } = queries[0]!;
    // Once for each survivor, only ids, in lower case.
    expect(params).toEqual([
      PROJECT_ID.toString(),
      [idOf(1)],
      MAX_MERGED_FINGERPRINTS_PER_EXCEPTION,
      MAX_MERGED_FINGERPRINTS_READ,
    ]);
    expect(sql).toContain(`"projectId" = $1`);
    expect(sql).toContain(`"mergedIntoTelemetryExceptionId" = ANY($2::uuid[])`);
    expect(sql).toContain(`"deletedAt" IS NULL`);
    expect(sql).toContain(
      `ROW_NUMBER() OVER (PARTITION BY "mergedIntoTelemetryExceptionId" ORDER BY "lastSeenAt" DESC NULLS LAST, "fingerprint" ASC)`,
    );
    expect(sql).toContain(`WHERE "rank" <= $3`);
    expect(sql).toContain(
      `ORDER BY "lastSeenAt" DESC NULLS LAST, "fingerprint" ASC LIMIT $4`,
    );
  });

  test("nothing to ask about is no read", async () => {
    const read: MergedFingerprintsRead =
      await TelemetryExceptionService.readMergedFingerprints({
        projectId: PROJECT_ID,
        survivorIds: ["", "nope"],
      });

    expect(read.bySurvivor.size).toBe(0);
    expect(read.isComplete).toBe(true);
    expect(queries).toHaveLength(0);
  });

  test("rows of other exceptions, blank ones and repeats are left out; each one's are capped even if the database is not", async () => {
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async () => {
          return [
            { survivorId: idOf(1).toUpperCase(), fingerprint: "b" },
            { survivorId: idOf(1), fingerprint: "b" },
            { survivorId: idOf(1), fingerprint: "" },
            { survivorId: idOf(1), fingerprint: null },
            { survivorId: idOf(9), fingerprint: "z" },
            { survivorId: null, fingerprint: "y" },
            ...Array.from(
              { length: MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 5 },
              (_value: unknown, index: number) => {
                return { survivorId: idOf(1), fingerprint: `m-${index}` };
              },
            ),
          ];
        },
      },
    } as never);

    const read: MergedFingerprintsRead =
      await TelemetryExceptionService.readMergedFingerprints({
        projectId: PROJECT_ID,
        survivorIds: [idOf(1)],
      });

    expect(Array.from(read.bySurvivor.keys())).toEqual([idOf(1)]);
    const merged: Array<string> = read.bySurvivor.get(idOf(1))!;
    expect(merged).toHaveLength(MAX_MERGED_FINGERPRINTS_PER_EXCEPTION);
    expect(merged[0]).toBe("b");
    expect(merged[1]).toBe("m-0");
  });

  test(`past ${MAX_MERGED_FINGERPRINTS_READ} rows in all, the least recently seen are left out, and it says so`, async () => {
    // 101 survivors with 100 merged into each: 10,100 rows.
    for (let survivor: number = 0; survivor <= 100; survivor++) {
      rows.push(row({ id: idOf(survivor), fingerprint: `s-${survivor}` }));

      for (let member: number = 0; member < 100; member++) {
        rows.push(
          row({
            id: idOf(1000 + survivor * 100 + member),
            fingerprint: `s-${survivor}-m-${String(member).padStart(3, "0")}`,
            mergedInto: idOf(survivor),
            // Survivor 0's members were seen last of all.
            lastSeenAt: new Date(
              Date.UTC(2026, 9, 1) + (100 - survivor) * 1000,
            ),
          }),
        );
      }
    }

    const read: MergedFingerprintsRead =
      await TelemetryExceptionService.readMergedFingerprints({
        projectId: PROJECT_ID,
        survivorIds: Array.from(
          { length: 101 },
          (_value: unknown, i: number) => {
            return idOf(i);
          },
        ),
      });

    expect(read.isComplete).toBe(false);
    expect(read.bySurvivor.get(idOf(0))).toHaveLength(100);
    // The one seen longest ago is the one left out.
    expect(read.bySurvivor.has(idOf(100))).toBe(false);
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("the least recently seen are left out"),
    );
  });
});

describe("an exception's group fingerprints", () => {
  test("nothing merged into it: its own fingerprint alone", async () => {
    rows = [row({ id: idOf(1), fingerprint: "a" })];

    expect(await groupOf(rows[0]!)).toEqual(["a"]);
  });

  test("its own, then those merged into it, the most recently seen first", async () => {
    rows = [
      row({ id: idOf(1), fingerprint: "a" }),
      row({
        id: idOf(2),
        fingerprint: "b",
        mergedInto: idOf(1),
        lastSeenAt: new Date(Date.UTC(2026, 9, 2)),
      }),
      row({
        id: idOf(3),
        fingerprint: "c",
        mergedInto: idOf(1),
        lastSeenAt: new Date(Date.UTC(2026, 9, 5)),
      }),
      row({
        id: idOf(4),
        fingerprint: "d",
        mergedInto: idOf(1),
        lastSeenAt: null,
      }),
      // Deleted, or merged into another: not its.
      row({
        id: idOf(5),
        fingerprint: "e",
        mergedInto: idOf(1),
        deleted: true,
      }),
      row({ id: idOf(6), fingerprint: "f", mergedInto: idOf(7) }),
      row({ id: idOf(7), fingerprint: "g" }),
    ];

    expect(await groupOf(rows[0]!)).toEqual(["a", "c", "b", "d"]);
    expect(await groupOf(rows[6]!)).toEqual(["g", "f"]);
    // A merged exception has nothing merged into it.
    expect(await groupOf(rows[1]!)).toEqual(["b"]);
  });

  test("a batch is one read, by each exception's id in lower case; ones without an id or a fingerprint are left out", async () => {
    rows = [
      row({ id: idOf(1), fingerprint: "a" }),
      row({ id: idOf(2), fingerprint: "b", mergedInto: idOf(1) }),
      row({ id: idOf(3), fingerprint: "c" }),
    ];

    const groups: Map<
      string,
      Array<string>
    > = await TelemetryExceptionService.getGroupFingerprints({
      projectId: PROJECT_ID,
      exceptions: [
        { id: new ObjectID(idOf(1).toUpperCase()), fingerprint: "a" },
        { id: idOf(3), fingerprint: "c" },
        { id: idOf(1), fingerprint: "a" },
        { id: "not-an-id", fingerprint: "x" },
        { id: idOf(4), fingerprint: "" },
      ],
    });

    expect(Object.fromEntries(groups)).toEqual({
      [idOf(1)]: ["a", "b"],
      [idOf(3)]: ["c"],
    });
    expect(memberReads()).toBe(1);
    expect(queries[0]!.params[1]).toEqual([idOf(1), idOf(3)]);
  });

  test("no exception to ask about reads nothing, not even the generation", async () => {
    const getString: SpyInstance<typeof GlobalCache.getString> = jest.spyOn(
      GlobalCache,
      "getString",
    );

    expect(
      (
        await TelemetryExceptionService.getGroupFingerprints({
          projectId: PROJECT_ID,
          exceptions: [],
        })
      ).size,
    ).toBe(0);
    expect(queries).toHaveLength(0);
    expect(getString).not.toHaveBeenCalled();
  });

  test(`at most ${MAX_MERGED_FINGERPRINTS_PER_EXCEPTION} merged ones: those seen last`, async () => {
    rows = [row({ id: idOf(1), fingerprint: "own" })];

    for (let index: number = 0; index < 130; index++) {
      rows.push(
        row({
          id: idOf(100 + index),
          fingerprint: `m-${String(index).padStart(3, "0")}`,
          mergedInto: idOf(1),
          lastSeenAt: new Date(Date.UTC(2026, 9, 1) + index * 1000),
        }),
      );
    }

    const group: Array<string> = await groupOf(rows[0]!);

    expect(group).toHaveLength(MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 1);
    expect(group[0]).toBe("own");
    expect(group[1]).toBe("m-129");
    expect(group[MAX_MERGED_FINGERPRINTS_PER_EXCEPTION]).toBe("m-030");
    expect(group).not.toContain("m-029");
  });

  test("a read that fails reads each by its own fingerprint, as before any merge, and keeps nothing", async () => {
    rows = [
      row({ id: idOf(1), fingerprint: "a" }),
      row({ id: idOf(2), fingerprint: "b", mergedInto: idOf(1) }),
    ];
    failReads = true;

    expect(await groupOf(rows[0]!)).toEqual(["a"]);
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining("are read by their own fingerprints"),
    );

    // Postgres is back: read again, not the fallback.
    failReads = false;
    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(memberReads()).toBe(2);
  });

  test("a read that left some out is used, and read again next time", async () => {
    rows = [row({ id: idOf(1), fingerprint: "a" })];
    jest
      .spyOn(TelemetryExceptionService, "readMergedFingerprints")
      .mockResolvedValue({
        bySurvivor: new Map([[idOf(1), ["b"]]]),
        isComplete: false,
      });

    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(
      TelemetryExceptionService.readMergedFingerprints,
    ).toHaveBeenCalledTimes(2);
  });
});

describe("the group fingerprints kept", () => {
  beforeEach(() => {
    rows = [
      row({ id: idOf(1), fingerprint: "a" }),
      row({ id: idOf(2), fingerprint: "b", mergedInto: idOf(1) }),
      row({ id: idOf(3), fingerprint: "c" }),
    ];
  });

  test("are read once, and kept: nothing merged included", async () => {
    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(await groupOf(rows[2]!)).toEqual(["c"]);
    expect(memberReads()).toBe(2);

    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(await groupOf(rows[2]!)).toEqual(["c"]);
    expect(memberReads()).toBe(2);

    // A batch of kept ones and one not kept reads only the one not kept.
    rows.push(row({ id: idOf(4), fingerprint: "d" }));
    await TelemetryExceptionService.getGroupFingerprints({
      projectId: PROJECT_ID,
      exceptions: [exception(rows[0]!), exception(rows[3]!)],
    });
    expect(memberReads()).toBe(3);
    expect(queries[2]!.params[1]).toEqual([idOf(4)]);
  });

  test("a caller that changes what it was given changes nothing kept", async () => {
    const first: Array<string> = await groupOf(rows[0]!);
    first.push("changed");
    first[0] = "changed";

    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
  });

  test(`for ${GROUP_FINGERPRINTS_TTL_MS / 1000} seconds at most`, async () => {
    await groupOf(rows[0]!);
    rows[1]!.mergedInto = null;

    now += GROUP_FINGERPRINTS_TTL_MS;
    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(memberReads()).toBe(1);

    now += 1;
    expect(await groupOf(rows[0]!)).toEqual(["a"]);
    expect(memberReads()).toBe(2);
  });

  test("by project: the same exception asked of another project is another read", async () => {
    await groupOf(rows[0]!);

    expect(
      await TelemetryExceptionService.getGroupFingerprintsOf({
        projectId: OTHER_PROJECT_ID,
        exception: exception(rows[0]!),
      }),
    ).toEqual(["a"]);
    expect(memberReads()).toBe(2);
    expect(queries[1]!.params[0]).toBe(OTHER_PROJECT_ID.toString());
  });

  test("a merge or an unmerge in the project is read at once in this process, and no other project's is forgotten", async () => {
    const other: Row = row({
      id: idOf(1, 2),
      fingerprint: "other",
      projectId: OTHER_PROJECT_ID.toString(),
    });
    rows.push(other);

    await groupOf(rows[0]!);
    await groupOf(other);
    expect(memberReads()).toBe(2);

    // c is merged into a.
    rows[2]!.mergedInto = idOf(1);
    await TelemetryExceptionService.forgetGroupFingerprints([PROJECT_ID]);

    expect(await groupOf(rows[0]!)).toEqual(["a", "b", "c"]);
    expect(memberReads()).toBe(3);
    // The other project's is still kept.
    expect(await groupOf(other)).toEqual(["other"]);
    expect(memberReads()).toBe(3);

    // b is unmerged.
    rows[1]!.mergedInto = null;
    await TelemetryExceptionService.forgetGroupFingerprints([
      PROJECT_ID.toString().toUpperCase(),
      null,
      undefined,
      "",
    ]);
    expect(await groupOf(rows[0]!)).toEqual(["a", "c"]);
  });

  test("forgetting no project starts no generation", async () => {
    const setString: SpyInstance<typeof GlobalCache.setString> = jest.spyOn(
      GlobalCache,
      "setString",
    );

    await TelemetryExceptionService.forgetGroupFingerprints([
      null,
      "",
      undefined,
    ]);

    expect(setString).not.toHaveBeenCalled();
  });

  test("a merge in another process is read here once Redis says so, within a second", async () => {
    const otherProcess: TelemetryExceptionServiceClass =
      new TelemetryExceptionServiceClass();
    connect(otherProcess);

    await groupOf(rows[0]!);
    rows[2]!.mergedInto = idOf(1);
    await otherProcess.forgetGroupFingerprints([PROJECT_ID]);

    // The other process reads it at once.
    expect(await groupOf(rows[0]!, otherProcess)).toEqual(["a", "b", "c"]);

    // This one goes by the generation it read from Redis for a second...
    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);

    // ...then reads Redis again, and the group again.
    now += CacheGenerations.SHARED_READ_TTL_MS + 1;
    expect(await groupOf(rows[0]!)).toEqual(["a", "b", "c"]);
    expect(
      Array.from(redis.keys()).every((key: string): boolean => {
        return key.startsWith(`${GROUP_FINGERPRINTS_GENERATION_NAMESPACE}-`);
      }),
    ).toBe(true);
  });

  test("without Redis, a merge here still counts here at once", async () => {
    jest
      .spyOn(GlobalCache, "getString")
      .mockRejectedValue(new Error("Cache is not connected"));
    jest
      .spyOn(GlobalCache, "setString")
      .mockRejectedValue(new Error("Cache is not connected"));

    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(await groupOf(rows[0]!)).toEqual(["a", "b"]);
    expect(memberReads()).toBe(1);

    rows[2]!.mergedInto = idOf(1);
    await TelemetryExceptionService.forgetGroupFingerprints([PROJECT_ID]);
    expect(await groupOf(rows[0]!)).toEqual(["a", "b", "c"]);
  });

  test(`at most ${MAX_KEPT_GROUP_FINGERPRINTS} exceptions are kept, the oldest given up first`, async () => {
    const asked: Array<ExceptionOfGroup> = Array.from(
      { length: MAX_KEPT_GROUP_FINGERPRINTS + 1 },
      (_value: unknown, index: number): ExceptionOfGroup => {
        return { id: idOf(10_000 + index), fingerprint: `x-${index}` };
      },
    );

    for (const entry of asked) {
      await TelemetryExceptionService.getGroupFingerprints({
        projectId: PROJECT_ID,
        exceptions: [entry],
      });
    }
    expect(memberReads()).toBe(MAX_KEPT_GROUP_FINGERPRINTS + 1);

    // The last is kept; the first was given up for it.
    await TelemetryExceptionService.getGroupFingerprints({
      projectId: PROJECT_ID,
      exceptions: [asked[asked.length - 1]!],
    });
    expect(memberReads()).toBe(MAX_KEPT_GROUP_FINGERPRINTS + 1);

    await TelemetryExceptionService.getGroupFingerprints({
      projectId: PROJECT_ID,
      exceptions: [asked[0]!],
    });
    expect(memberReads()).toBe(MAX_KEPT_GROUP_FINGERPRINTS + 2);
  });
});

describe("the group of the exception a fingerprint is the own of", () => {
  beforeEach(() => {
    rows = [
      row({ id: idOf(1), fingerprint: "a" }),
      row({ id: idOf(2), fingerprint: "b", mergedInto: idOf(1) }),
      row({ id: idOf(3), fingerprint: "c", mergedInto: idOf(1) }),
    ];
  });

  test("a survivor's fingerprint is its group's", async () => {
    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: "a",
        primaryEntityId: new ObjectID(SERVICE_ID),
      }),
    ).toEqual(["a", "b", "c"]);

    const lookup: { sql: string; params: Array<unknown> } = queries[0]!;
    expect(lookup.sql).toContain(
      `"projectId" = $1 AND "fingerprint" = $2 AND "mergedIntoTelemetryExceptionId" IS NULL AND "deletedAt" IS NULL AND "primaryEntityId" = $4`,
    );
    expect(lookup.params).toEqual([PROJECT_ID.toString(), "a", 20, SERVICE_ID]);
  });

  test("without a service, every not merged exception that carries it", async () => {
    const elsewhere: string = "20000000-0000-4000-8000-0000000000bb";
    rows.push(
      row({ id: idOf(4), fingerprint: "a", primaryEntityId: elsewhere }),
      row({ id: idOf(5), fingerprint: "d", mergedInto: idOf(4) }),
    );

    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: "a",
      }),
    ).toEqual(["a", "b", "c", "d"]);
    expect(queries[0]!.sql).not.toContain(`"primaryEntityId"`);
    expect(queries[0]!.params).toEqual([PROJECT_ID.toString(), "a", 20]);
  });

  test("a merged exception's own fingerprint is answered by itself, as its own page reads it", async () => {
    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: "b",
      }),
    ).toEqual(["b"]);
  });

  test("a fingerprint no exception carries, longer than any is, or a read that fails: itself", async () => {
    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: "nobody",
      }),
    ).toEqual(["nobody"]);

    const longer: string = "f".repeat(101);
    const before: number = queries.length;
    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: longer,
      }),
    ).toEqual([longer]);
    expect(queries).toHaveLength(before);

    failReads = true;
    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: "a",
      }),
    ).toEqual(["a"]);

    expect(
      await TelemetryExceptionService.getGroupFingerprintsOfFingerprint({
        projectId: PROJECT_ID,
        fingerprint: "",
      }),
    ).toEqual([]);
  });
});

/*
 * A SEEDED SWEEP OF MERGES AND UNMERGES.
 *
 * Exceptions in three services of two projects - one service big enough for
 * an exception to have more than MAX_MERGED_FINGERPRINTS_PER_EXCEPTION
 * merged into it - are merged and unmerged at random by
 * TelemetryExceptionMerge's rules (only within a service; nothing is merged
 * into a merged one, so merging one others were merged into moves them
 * along; merging again what is merged changes nothing), seen at random, and
 * read in random batches while time passes, now and then with Postgres down.
 * Every answer is held to a model: what the rows say at the time it was
 * read, kept until GROUP_FINGERPRINTS_TTL_MS has passed or the project's
 * next merge or unmerge - and a batch reads Postgres exactly when one of
 * its exceptions is not kept.
 */
describe("a seeded sweep of merges and unmerges", () => {
  interface Kept {
    group: Array<string>;
    readAt: number;
    epoch: number;
  }

  test.each([1, 2, 3])(
    "seed %i: every group is the exception's own fingerprint and those merged into it, kept as long as it may be",
    async (seed: number) => {
      const random: SeededRandom = seededRandom(seed * 7919);
      const projects: Array<ObjectID> = [PROJECT_ID, OTHER_PROJECT_ID];
      const services: Array<{ project: number; id: string; size: number }> = [
        { project: 0, id: "20000000-0000-4000-8000-0000000000a1", size: 8 },
        { project: 0, id: "20000000-0000-4000-8000-0000000000a2", size: 170 },
        { project: 1, id: "20000000-0000-4000-8000-0000000000a3", size: 8 },
      ];

      let counter: number = 0;

      for (const service of services) {
        for (let index: number = 0; index < service.size; index++) {
          counter++;
          rows.push(
            row({
              id: idOf(counter, service.project + 1),
              fingerprint: `fp-${String(counter).padStart(4, "0")}`,
              projectId: projects[service.project]!.toString(),
              primaryEntityId: service.id,
              lastSeenAt:
                random(10) === 0
                  ? null
                  : new Date(Date.UTC(2026, 9, 1) + random(5000) * 1000),
            }),
          );
        }
      }

      // Each project's merges and unmerges so far.
      const epochs: Array<number> = [0, 0];
      const kept: Map<string, Kept> = new Map();

      const expectedGroup: (survivor: Row) => Array<string> = (
        survivor: Row,
      ): Array<string> => {
        return [
          survivor.fingerprint,
          ...rows
            .filter((member: Row): boolean => {
              return member.mergedInto === survivor.id;
            })
            .sort(byRecency)
            .slice(0, MAX_MERGED_FINGERPRINTS_PER_EXCEPTION)
            .map((member: Row): string => {
              return member.fingerprint;
            }),
        ];
      };

      const projectOf: (found: Row) => number = (found: Row): number => {
        return found.projectId === PROJECT_ID.toString() ? 0 : 1;
      };

      let largestGroup: number = 0;
      let readsChecked: number = 0;

      for (let round: number = 0; round < 1500; round++) {
        const action: number = random(20);

        if (action < 13) {
          /*
           * A merge, mostly into the first exception of the big service, so
           * that it gets more merged into it than a read takes.
           */
          const service: { project: number; id: string } =
            services[random(3) === 0 ? random(3) : 1]!;
          const inService: Array<Row> = rows.filter((found: Row): boolean => {
            return found.primaryEntityId === service.id;
          });
          const isHot: boolean =
            service.id === services[1]!.id && random(20) > 2;
          const survivor: Row = isHot
            ? inService[random(8) === 0 ? 1 : 0]!
            : inService[random(inService.length)]!;
          // Anything but the first: another one's may move into it, whole.
          const merged: Row = isHot
            ? inService[2 + random(inService.length - 2)]!
            : inService[1 + random(inService.length - 1)]!;

          if (
            survivor.mergedInto === null &&
            merged.id !== survivor.id &&
            merged.mergedInto === null
          ) {
            // What was merged into it moves along.
            for (const member of rows) {
              if (member.mergedInto === merged.id) {
                member.mergedInto = survivor.id;
              }
            }
            merged.mergedInto = survivor.id;
            epochs[service.project]!++;
            await TelemetryExceptionService.forgetGroupFingerprints([
              projects[service.project]!,
            ]);
          }
        } else if (action < 14) {
          // An unmerge.
          const merged: Array<Row> = rows.filter((found: Row): boolean => {
            return found.mergedInto !== null;
          });

          if (merged.length > 0) {
            const unmerged: Row = merged[random(merged.length)]!;
            unmerged.mergedInto = null;
            epochs[projectOf(unmerged)]!++;
            await TelemetryExceptionService.forgetGroupFingerprints([
              new ObjectID(unmerged.projectId),
            ]);
          }
        } else if (action < 17) {
          // An occurrence: seen now. Nothing is forgotten for it.
          rows[random(rows.length)]!.lastSeenAt = new Date(
            Date.UTC(2026, 9, 1) + (5000 + round) * 1000,
          );
        } else {
          // Time passes: under a second, or past what is kept.
          now +=
            random(2) === 0
              ? random(1000)
              : GROUP_FINGERPRINTS_TTL_MS + random(1000);
        }

        // A batch of one project's exceptions, now and then with Postgres down.
        const project: number = random(2);
        const ofProject: Array<Row> = rows.filter((found: Row): boolean => {
          return projectOf(found) === project;
        });
        const asked: Array<Row> = shuffled(ofProject, random).slice(
          0,
          1 + random(6),
        );

        // The two the big service's merges go into, often.
        if (project === 0 && random(2) === 0) {
          for (const hot of rows
            .filter((found: Row): boolean => {
              return found.primaryEntityId === services[1]!.id;
            })
            .slice(0, 2)) {
            if (!asked.includes(hot)) {
              asked.push(hot);
            }
          }
        }
        failReads = random(12) === 0;
        const readsBefore: number = memberReads();

        const groups: Map<
          string,
          Array<string>
        > = await TelemetryExceptionService.getGroupFingerprints({
          projectId: projects[project]!,
          exceptions: asked.map(exception),
        });

        let anyNotKept: boolean = false;

        for (const found of asked) {
          const entry: Kept | undefined = kept.get(found.id);
          const isKept: boolean =
            entry !== undefined &&
            entry.epoch === epochs[project] &&
            now - entry.readAt <= GROUP_FINGERPRINTS_TTL_MS;

          let expected: Array<string>;

          if (isKept) {
            expected = entry!.group;
          } else {
            anyNotKept = true;
            expected = failReads ? [found.fingerprint] : expectedGroup(found);

            if (!failReads) {
              kept.set(found.id, {
                group: expected,
                readAt: now,
                epoch: epochs[project]!,
              });
            }
          }

          expect([seed, round, found.id, groups.get(found.id)]).toEqual([
            seed,
            round,
            found.id,
            expected,
          ]);
          largestGroup = Math.max(largestGroup, expected.length);
          readsChecked++;
        }

        // Postgres is read exactly when one of them was not kept.
        expect([seed, round, memberReads() - readsBefore]).toEqual([
          seed,
          round,
          anyNotKept ? 1 : 0,
        ]);
        failReads = false;
      }

      // The sweep reached the bound, and read many groups.
      expect(largestGroup).toBe(MAX_MERGED_FINGERPRINTS_PER_EXCEPTION + 1);
      expect(readsChecked).toBeGreaterThan(3000);
    },
  );
});
