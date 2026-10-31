import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryExceptionService, {
  MergedFingerprintSurvivor,
  Service as TelemetryExceptionServiceClass,
} from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Includes from "../../../Types/BaseDatabase/Includes";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ObjectID from "../../../Types/ObjectID";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import FindBy from "../../../Server/Types/Database/FindBy";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * A merged exception's fingerprint finds the exception it was merged into
 * (TelemetryExceptionService.withMergedFingerprintAliases): a read that
 * looks exceptions up by the fingerprints of occurrences - the list
 * narrowed by an attribute filter, a link from a span or a log, the API -
 * finds the survivor of each merged fingerprint it names, which
 * hideMergedExceptions would otherwise leave it without; and a caller that
 * matches what it read back to the fingerprints it asked about is given
 * what was merged into what, from the same read. Postgres is mocked;
 * App/Tests/Telemetry/ExceptionMergePostgres.test.ts reads the survivor
 * through a real one.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "10000000-0000-4000-8000-000000000001",
);

// The merged rows the lookup finds: each merged fingerprint, and its survivor's.
let merged: Array<[string, string]>;
let reads: Array<FindBy<TelemetryException>>;

// The SQL a Raw condition writes for a column.
function sqlOf(condition: unknown): string {
  return (condition as { getSql: (alias: string) => string }).getSql("column");
}

function fingerprintsOf(query: Record<string, unknown>): Array<string> {
  return TelemetryExceptionServiceClass.readQueriedFingerprints(
    query["fingerprint"],
  );
}

// The id of the exception a test fingerprint ("fp-a" ... "fp-f") is.
function idOf(fingerprint: string): ObjectID {
  return new ObjectID(
    `30000000-0000-4000-8000-00000000000${fingerprint.slice(-1)}`,
  );
}

// A merged row, as the read of merged rows selects it.
function mergedRow(fingerprint: string, survivor: string): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  const into: TelemetryException = new TelemetryException();
  into.fingerprint = survivor;
  row.fingerprint = fingerprint;
  row.mergedIntoTelemetryExceptionId = idOf(survivor);
  row.mergedIntoTelemetryException = into;
  return row;
}

beforeEach(() => {
  merged = [];
  reads = [];

  jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
    findBy: FindBy<TelemetryException>,
  ) => {
    reads.push(findBy);
    const asked: Array<string> = fingerprintsOf(
      findBy.query as Record<string, unknown>,
    );

    return merged
      .filter(([fingerprint]: [string, string]): boolean => {
        return asked.includes(fingerprint);
      })
      .map(([fingerprint, survivor]: [string, string]): TelemetryException => {
        return mergedRow(fingerprint, survivor);
      });
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a lookup by fingerprint", () => {
  test("finds the exception a merged fingerprint was merged into", async () => {
    merged = [["fp-b", "fp-a"]];

    const query: Record<string, unknown> =
      await TelemetryExceptionService.withMergedFingerprintAliases({
        projectId: PROJECT_ID,
        fingerprint: new Includes(["fp-b", "fp-c"]),
        isResolved: false,
      });

    expect(fingerprintsOf(query)).toEqual(["fp-b", "fp-c", "fp-a"]);
    // The rest of what it asked for, as asked.
    expect(query["projectId"]).toBe(PROJECT_ID);
    expect(query["isResolved"]).toBe(false);
  });

  test("reads the project's merged rows of those fingerprints, as root", async () => {
    await TelemetryExceptionService.withMergedFingerprintAliases({
      projectId: PROJECT_ID,
      fingerprint: "fp-b",
    });

    expect(reads).toHaveLength(1);
    const read: FindBy<TelemetryException> = reads[0]!;
    const asked: Record<string, unknown> = read.query as Record<
      string,
      unknown
    >;
    expect(asked["projectId"]).toBe(PROJECT_ID);
    expect(fingerprintsOf(asked)).toEqual(["fp-b"]);
    expect(sqlOf(asked["mergedIntoTelemetryExceptionId"])).toBe(
      "(column IS NOT NULL)",
    );
    expect(read.props).toEqual({ isRoot: true });
    expect(read.select).toEqual({
      fingerprint: true,
      mergedIntoTelemetryExceptionId: true,
      mergedIntoTelemetryException: { fingerprint: true },
    });
  });

  test("one fingerprint, looked up by a link, finds the survivor too", async () => {
    merged = [["fp-b", "fp-a"]];

    expect(
      fingerprintsOf(
        await TelemetryExceptionService.withMergedFingerprintAliases({
          projectId: PROJECT_ID,
          fingerprint: "fp-b",
        }),
      ),
    ).toEqual(["fp-b", "fp-a"]);
  });

  test("with nothing merged, the query is left as it was", async () => {
    const asked: Record<string, unknown> = {
      projectId: PROJECT_ID,
      fingerprint: new Includes(["fp-b"]),
    };

    expect(
      await TelemetryExceptionService.withMergedFingerprintAliases(asked),
    ).toBe(asked);
  });

  test("a survivor already asked for, or one merged into twice, is named once", async () => {
    merged = [
      ["fp-b", "fp-a"],
      ["fp-c", "fp-a"],
      ["fp-d", "fp-b"],
    ];

    expect(
      fingerprintsOf(
        await TelemetryExceptionService.withMergedFingerprintAliases({
          fingerprint: new Includes(["fp-a", "fp-b", "fp-c"]),
        }),
      ),
    ).toEqual(["fp-a", "fp-b", "fp-c"]);
  });
});

describe("what is not a lookup by fingerprint is not read for", () => {
  test("rows named by id, or by the merge column", async () => {
    for (const query of [
      { _id: "30000000-0000-4000-8000-00000000000a", fingerprint: "fp-b" },
      { id: "30000000-0000-4000-8000-00000000000a", fingerprint: "fp-b" },
      {
        mergedIntoTelemetryExceptionId: new ObjectID(
          "30000000-0000-4000-8000-00000000000a",
        ),
        fingerprint: "fp-b",
      },
    ]) {
      expect(
        await TelemetryExceptionService.withMergedFingerprintAliases(query),
      ).toBe(query);
    }

    expect(reads).toHaveLength(0);
  });

  test("a query without fingerprints, or with ones it cannot read", async () => {
    for (const query of [
      { projectId: PROJECT_ID },
      { fingerprint: "" },
      { fingerprint: QueryHelper.notNull() },
      { fingerprint: new Includes([]) },
    ]) {
      expect(
        await TelemetryExceptionService.withMergedFingerprintAliases(
          query as Record<string, unknown>,
        ),
      ).toBe(query);
    }

    expect(reads).toHaveLength(0);
  });

  test("a read that fails leaves the lookup as asked", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async () => {
        throw new Error("Postgres is away");
      }) as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    const asked: Record<string, unknown> = { fingerprint: "fp-b" };

    expect(
      await TelemetryExceptionService.withMergedFingerprintAliases(asked),
    ).toBe(asked);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("every read and count looks merged fingerprints up", () => {
  test("a find, before merged rows are left out and the reader's scope applied", async () => {
    merged = [["fp-b", "fp-a"]];

    const scoped: Array<Record<string, unknown>> = [];
    jest
      .spyOn(TelemetryExceptionService, "addExceptionScope")
      .mockImplementation((async (query: Record<string, unknown>) => {
        scoped.push(query);
        return query;
      }) as never);

    await (
      TelemetryExceptionService as unknown as {
        onBeforeFind: (findBy: FindBy<TelemetryException>) => Promise<unknown>;
      }
    ).onBeforeFind({
      query: { projectId: PROJECT_ID, fingerprint: "fp-b" },
      select: { _id: true },
      limit: 10,
      skip: 0,
      props: { tenantId: PROJECT_ID },
    } as FindBy<TelemetryException>);

    expect(scoped).toHaveLength(1);
    expect(fingerprintsOf(scoped[0]!)).toEqual(["fp-b", "fp-a"]);
    expect(sqlOf(scoped[0]!["mergedIntoTelemetryExceptionId"])).toBe(
      "(column IS NULL)",
    );
  });
});

/*
 * THE EXPLICIT MAPPING.
 *
 * A caller that matches the rows it looked up back to the fingerprints it
 * asked about cannot do it by each row's own fingerprint: the survivor a
 * merged fingerprint brought in carries a fingerprint of its own. So it is
 * given what was merged into what (getMergedFingerprintSurvivors) - the
 * same root read withMergedFingerprintAliases widens a lookup with - and
 * matches by it (getExceptionsByFingerprint, findByOccurrenceFingerprints).
 */

const CALLER: { tenantId: ObjectID; userId: ObjectID } = {
  tenantId: PROJECT_ID,
  userId: new ObjectID("10000000-0000-4000-8000-0000000000aa"),
};

// A row a lookup reads: an exception with its id and fingerprint.
function exceptionRow(id: string, fingerprint: string): TelemetryException {
  const row: TelemetryException = new TelemetryException();
  row._id = id;
  row.fingerprint = fingerprint;
  return row;
}

function idsOf(rows: Array<TelemetryException> | undefined): Array<string> {
  return (rows || []).map((row: TelemetryException): string => {
    return row.id!.toString();
  });
}

describe("what was merged into what (getMergedFingerprintSurvivors)", () => {
  test("names each merged fingerprint with the exception it was merged into", async () => {
    merged = [
      ["fp-b", "fp-a"],
      ["fp-c", "fp-a"],
      ["fp-e", "fp-d"],
    ];

    const survivors: Array<MergedFingerprintSurvivor> =
      await TelemetryExceptionService.getMergedFingerprintSurvivors({
        projectId: PROJECT_ID,
        fingerprints: ["fp-a", "fp-b", "fp-c", "fp-f"],
      });

    expect(
      survivors.map((survivor: MergedFingerprintSurvivor) => {
        return {
          fingerprint: survivor.fingerprint,
          survivorId: survivor.survivorId.toString(),
          survivorFingerprint: survivor.survivorFingerprint,
        };
      }),
    ).toEqual([
      {
        fingerprint: "fp-b",
        survivorId: idOf("fp-a").toString(),
        survivorFingerprint: "fp-a",
      },
      {
        fingerprint: "fp-c",
        survivorId: idOf("fp-a").toString(),
        survivorFingerprint: "fp-a",
      },
    ]);
  });

  test("is one read of the project's merged rows of those fingerprints, as root - the read a lookup is widened with", async () => {
    await TelemetryExceptionService.getMergedFingerprintSurvivors({
      projectId: PROJECT_ID,
      fingerprints: ["fp-b", "fp-c"],
    });
    await TelemetryExceptionService.withMergedFingerprintAliases({
      projectId: PROJECT_ID,
      fingerprint: new Includes(["fp-b", "fp-c"]),
    });

    expect(reads).toHaveLength(2);

    for (const read of reads) {
      const query: Record<string, unknown> = read.query as Record<
        string,
        unknown
      >;
      expect(query["projectId"]).toBe(PROJECT_ID);
      expect(fingerprintsOf(query)).toEqual(["fp-b", "fp-c"]);
      expect(sqlOf(query["mergedIntoTelemetryExceptionId"])).toBe(
        "(column IS NOT NULL)",
      );
      expect(read.props).toEqual({ isRoot: true });
    }

    expect(reads[0]!.select).toEqual(reads[1]!.select);
  });

  test("asks about each fingerprint once, and reads nothing for none", async () => {
    await TelemetryExceptionService.getMergedFingerprintSurvivors({
      projectId: PROJECT_ID,
      fingerprints: ["fp-b", "", "fp-b", "fp-c"],
    });

    expect(reads).toHaveLength(1);
    expect(fingerprintsOf(reads[0]!.query as Record<string, unknown>)).toEqual([
      "fp-b",
      "fp-c",
    ]);

    for (const fingerprints of [[], [""]]) {
      expect(
        await TelemetryExceptionService.getMergedFingerprintSurvivors({
          projectId: PROJECT_ID,
          fingerprints,
        }),
      ).toEqual([]);
    }

    expect(reads).toHaveLength(1);
  });

  test("without a project, every project's merged rows are read", async () => {
    await TelemetryExceptionService.getMergedFingerprintSurvivors({
      fingerprints: ["fp-b"],
    });

    expect("projectId" in (reads[0]!.query as Record<string, unknown>)).toBe(
      false,
    );
  });

  test("a merged row that does not say where it went is left out", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async () => {
        const noSurvivor: TelemetryException = mergedRow("fp-b", "fp-a");
        noSurvivor.mergedIntoTelemetryExceptionId = undefined;
        return [
          noSurvivor,
          mergedRow("fp-c", ""),
          mergedRow("", "fp-a"),
          mergedRow("fp-e", "fp-d"),
        ];
      }) as never);

    expect(
      (
        await TelemetryExceptionService.getMergedFingerprintSurvivors({
          projectId: PROJECT_ID,
          fingerprints: ["fp-b", "fp-c", "fp-e"],
        })
      ).map((survivor: MergedFingerprintSurvivor): string => {
        return survivor.fingerprint;
      }),
    ).toEqual(["fp-e"]);
  });

  test("a read that fails names none: each fingerprint finds its own exception only, as before any merge", async () => {
    jest
      .spyOn(TelemetryExceptionService, "findBy")
      .mockImplementation((async () => {
        throw new Error("Postgres is away");
      }) as never);
    jest.spyOn(logger, "error").mockImplementation(() => {
      return undefined as never;
    });

    expect(
      await TelemetryExceptionService.getMergedFingerprintSurvivors({
        projectId: PROJECT_ID,
        fingerprints: ["fp-b"],
      }),
    ).toEqual([]);
    expect(logger.error).toHaveBeenCalled();
  });
});

describe("the exceptions each fingerprint counts on (getExceptionsByFingerprint)", () => {
  const A: string = idOf("fp-a").toString();
  const C: string = idOf("fp-c").toString();
  // Another service's exception that happens to carry the survivor's fingerprint.
  const LOOKALIKE: string = "30000000-0000-4000-8000-0000000000ff";

  function survivor(
    fingerprint: string,
    survivorFingerprint: string,
    survivorId: ObjectID = idOf(survivorFingerprint),
  ): MergedFingerprintSurvivor {
    return { fingerprint, survivorId, survivorFingerprint };
  }

  test("a fingerprint's own exception, and a merged one's survivor - though it carries another fingerprint", () => {
    const answer: Map<
      string,
      Array<TelemetryException>
    > = TelemetryExceptionServiceClass.getExceptionsByFingerprint({
      fingerprints: ["fp-a", "fp-b", "fp-c", "fp-d"],
      rows: [exceptionRow(A, "fp-a"), exceptionRow(C, "fp-c")],
      survivors: [survivor("fp-b", "fp-a")],
    });

    expect(Array.from(answer.keys())).toEqual(["fp-a", "fp-b", "fp-c"]);
    expect(idsOf(answer.get("fp-a"))).toEqual([A]);
    expect(idsOf(answer.get("fp-b"))).toEqual([A]);
    expect(idsOf(answer.get("fp-c"))).toEqual([C]);
    // Nothing answers for it: left out, not an empty list.
    expect(answer.has("fp-d")).toBe(false);
  });

  test("the survivor is found by its id: a row that only shares its fingerprint is not it", () => {
    const answer: Map<
      string,
      Array<TelemetryException>
    > = TelemetryExceptionServiceClass.getExceptionsByFingerprint({
      fingerprints: ["fp-b"],
      // The widened lookup reads every row of the survivor's fingerprint.
      rows: [exceptionRow(LOOKALIKE, "fp-a"), exceptionRow(A, "fp-a")],
      survivors: [survivor("fp-b", "fp-a")],
    });

    expect(idsOf(answer.get("fp-b"))).toEqual([A]);
  });

  test("a fingerprint's own exceptions come first, then the ones it was merged into, each once", () => {
    const B: string = idOf("fp-b").toString();
    const answer: Map<
      string,
      Array<TelemetryException>
    > = TelemetryExceptionServiceClass.getExceptionsByFingerprint({
      fingerprints: ["fp-b", "fp-b"],
      rows: [exceptionRow(A, "fp-a"), exceptionRow(B, "fp-b")],
      // Merged in one service, its own in another; and named twice.
      survivors: [survivor("fp-b", "fp-a"), survivor("fp-b", "fp-a")],
    });

    expect(Array.from(answer.keys())).toEqual(["fp-b"]);
    expect(idsOf(answer.get("fp-b"))).toEqual([B, A]);
  });

  test("a survivor the lookup did not read - one the reader may not see - answers nothing", () => {
    const answer: Map<
      string,
      Array<TelemetryException>
    > = TelemetryExceptionServiceClass.getExceptionsByFingerprint({
      fingerprints: ["fp-b"],
      rows: [exceptionRow(LOOKALIKE, "fp-a")],
      survivors: [survivor("fp-b", "fp-a")],
    });

    expect(answer.size).toBe(0);
  });

  test("ids are matched whatever their case", () => {
    const answer: Map<
      string,
      Array<TelemetryException>
    > = TelemetryExceptionServiceClass.getExceptionsByFingerprint({
      fingerprints: ["fp-b"],
      rows: [exceptionRow(A.toUpperCase(), "fp-a")],
      survivors: [survivor("fp-b", "fp-a")],
    });

    expect(answer.get("fp-b")).toHaveLength(1);
  });

  /*
   * A seeded sweep: random projects of exceptions in a few services, some
   * merged into others of their service, some the reader may not see, and
   * random lookups. Whatever the shape, each fingerprint is answered with
   * exactly the exceptions its occurrences count on that the reader may
   * read - its own, then those it was merged into - and nothing else.
   */
  test("a seeded sweep holds every answer to what the occurrences count on", () => {
    interface WorldRow {
      id: string;
      fingerprint: string;
      mergedInto: number | null;
      readable: boolean;
    }

    const random: SeededRandom = seededRandom(5456);

    for (let round: number = 0; round < 400; round++) {
      const world: Array<WorldRow> = [];
      const rowCount: number = 1 + random(12);

      for (let index: number = 0; index < rowCount; index++) {
        world.push({
          id: `40000000-0000-4000-8000-${String(round * 100 + index).padStart(12, "0")}`,
          // Few fingerprints, so some repeat across services.
          fingerprint: `fp-${random(6)}`,
          mergedInto: null,
          readable: random(5) > 0,
        });
      }

      // Merge some into others, never into a merged one, nor one merged into.
      for (let index: number = 0; index < world.length; index++) {
        const into: number = random(world.length);

        if (
          random(3) === 0 &&
          into !== index &&
          world[into]!.mergedInto === null &&
          !world.some((entry: WorldRow): boolean => {
            return entry.mergedInto === index;
          })
        ) {
          world[index]!.mergedInto = into;
        }
      }

      const asked: Array<string> = [];
      const askedCount: number = 1 + random(6);

      for (let draw: number = 0; draw < askedCount; draw++) {
        asked.push(`fp-${random(7)}`);
      }

      const survivors: Array<MergedFingerprintSurvivor> = world
        .filter((entry: WorldRow): boolean => {
          return entry.mergedInto !== null && asked.includes(entry.fingerprint);
        })
        .map((entry: WorldRow): MergedFingerprintSurvivor => {
          const into: WorldRow = world[entry.mergedInto!]!;
          return survivor(
            entry.fingerprint,
            into.fingerprint,
            new ObjectID(into.id),
          );
        });

      // The widened lookup: the unmerged rows of the asked and survivors' fingerprints the reader may read.
      const looked: Array<string> = [
        ...asked,
        ...survivors.map((entry: MergedFingerprintSurvivor): string => {
          return entry.survivorFingerprint;
        }),
      ];
      const readRows: Array<WorldRow> = shuffled(
        world.filter((entry: WorldRow): boolean => {
          return (
            entry.mergedInto === null &&
            entry.readable &&
            looked.includes(entry.fingerprint)
          );
        }),
        random,
      );

      const answer: Map<
        string,
        Array<TelemetryException>
      > = TelemetryExceptionServiceClass.getExceptionsByFingerprint({
        fingerprints: asked,
        rows: readRows.map((entry: WorldRow): TelemetryException => {
          return exceptionRow(entry.id, entry.fingerprint);
        }),
        survivors,
      });

      for (const fingerprint of new Set(asked)) {
        const own: Array<string> = readRows
          .filter((entry: WorldRow): boolean => {
            return entry.fingerprint === fingerprint;
          })
          .map((entry: WorldRow): string => {
            return entry.id;
          });
        const mergedInto: Array<string> = world
          .filter((entry: WorldRow): boolean => {
            return (
              entry.mergedInto !== null && entry.fingerprint === fingerprint
            );
          })
          .map((entry: WorldRow): WorldRow => {
            return world[entry.mergedInto!]!;
          })
          .filter((entry: WorldRow): boolean => {
            return entry.readable;
          })
          .map((entry: WorldRow): string => {
            return entry.id;
          });
        const expected: Array<string> = Array.from(
          new Set([...own, ...mergedInto]),
        );

        expect([round, fingerprint, idsOf(answer.get(fingerprint))]).toEqual([
          round,
          fingerprint,
          expected,
        ]);
        expect([round, fingerprint, answer.has(fingerprint)]).toEqual([
          round,
          fingerprint,
          expected.length > 0,
        ]);
      }

      // Nothing is answered that was not asked about.
      for (const fingerprint of answer.keys()) {
        expect(asked).toContain(fingerprint);
      }
    }
  });
});

describe("findByOccurrenceFingerprints", () => {
  const A: string = idOf("fp-a").toString();
  const C: string = idOf("fp-c").toString();
  let lookups: Array<FindBy<TelemetryException>>;

  beforeEach(() => {
    lookups = [];
    merged = [["fp-b", "fp-a"]];

    jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
      findBy: FindBy<TelemetryException>,
    ) => {
      const query: Record<string, unknown> = findBy.query as Record<
        string,
        unknown
      >;
      const asked: Array<string> = fingerprintsOf(query);

      if ("mergedIntoTelemetryExceptionId" in query) {
        reads.push(findBy);
        return merged
          .filter(([fingerprint]: [string, string]): boolean => {
            return asked.includes(fingerprint);
          })
          .map(([fingerprint, into]: [string, string]): TelemetryException => {
            return mergedRow(fingerprint, into);
          });
      }

      lookups.push(findBy);

      // As the widened lookup reads them: the merged row left out, its survivor in.
      return [exceptionRow(A, "fp-a"), exceptionRow(C, "fp-c")];
    }) as never);
  });

  test("answers each fingerprint with the exceptions it counts on", async () => {
    const answer: Map<
      string,
      Array<TelemetryException>
    > = await TelemetryExceptionService.findByOccurrenceFingerprints({
      projectId: PROJECT_ID,
      fingerprints: ["fp-b", "fp-c", "fp-d"],
      select: { exceptionType: true },
      limit: 6,
      props: CALLER,
    });

    expect(Array.from(answer.keys())).toEqual(["fp-b", "fp-c"]);
    expect(idsOf(answer.get("fp-b"))).toEqual([A]);
    expect(idsOf(answer.get("fp-c"))).toEqual([C]);
  });

  test("looks the exceptions up as the caller, and what was merged as root", async () => {
    await TelemetryExceptionService.findByOccurrenceFingerprints({
      projectId: PROJECT_ID,
      fingerprints: ["fp-b", "fp-b", "fp-c"],
      select: { exceptionType: true },
      limit: 6,
      props: CALLER,
    });

    expect(lookups).toHaveLength(1);
    const lookup: FindBy<TelemetryException> = lookups[0]!;
    expect(lookup.props).toBe(CALLER);
    expect(lookup.limit).toBe(6);
    expect(lookup.skip).toBe(0);
    expect(lookup.select).toEqual({
      exceptionType: true,
      _id: true,
      fingerprint: true,
    });
    expect((lookup.query as Record<string, unknown>)["projectId"]).toBe(
      PROJECT_ID,
    );
    expect(fingerprintsOf(lookup.query as Record<string, unknown>)).toEqual([
      "fp-b",
      "fp-c",
    ]);

    expect(reads).toHaveLength(1);
    expect(reads[0]!.props).toEqual({ isRoot: true });
    expect((reads[0]!.query as Record<string, unknown>)["projectId"]).toBe(
      PROJECT_ID,
    );
  });

  test("nothing to ask about reads nothing", async () => {
    for (const fingerprints of [[], ["", ""]]) {
      expect(
        (
          await TelemetryExceptionService.findByOccurrenceFingerprints({
            projectId: PROJECT_ID,
            fingerprints,
            select: {},
            limit: 2,
            props: CALLER,
          })
        ).size,
      ).toBe(0);
    }

    expect(lookups).toHaveLength(0);
    expect(reads).toHaveLength(0);
  });

  test("a reader who may not read exceptions is refused, as by any read of them", async () => {
    jest.spyOn(TelemetryExceptionService, "findBy").mockImplementation((async (
      findBy: FindBy<TelemetryException>,
    ) => {
      if (
        "mergedIntoTelemetryExceptionId" in
        (findBy.query as Record<string, unknown>)
      ) {
        return [];
      }

      throw new NotAuthorizedException("You may not read exceptions");
    }) as never);

    await expect(
      TelemetryExceptionService.findByOccurrenceFingerprints({
        projectId: PROJECT_ID,
        fingerprints: ["fp-b"],
        select: {},
        limit: 2,
        props: CALLER,
      }),
    ).rejects.toBeInstanceOf(NotAuthorizedException);
  });
});
