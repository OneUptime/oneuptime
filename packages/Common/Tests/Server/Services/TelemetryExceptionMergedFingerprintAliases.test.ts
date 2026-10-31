import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryExceptionService, {
  Service as TelemetryExceptionServiceClass,
} from "../../../Server/Services/TelemetryExceptionService";
import TelemetryException from "../../../Models/DatabaseModels/TelemetryException";
import Includes from "../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../Types/ObjectID";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import logger from "../../../Server/Utils/Logger";
import FindBy from "../../../Server/Types/Database/FindBy";

/*
 * A merged exception's fingerprint finds the exception it was merged into
 * (TelemetryExceptionService.withMergedFingerprintAliases): a read that
 * looks exceptions up by the fingerprints of occurrences - the list
 * narrowed by an attribute filter, a link from a span or a log, the API -
 * finds the survivor of each merged fingerprint it names, which
 * hideMergedExceptions would otherwise leave it without. Postgres is
 * mocked; App/Tests/Telemetry/ExceptionMergePostgres.test.ts reads the
 * survivor through a real one.
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
      .map(([, survivor]: [string, string]): TelemetryException => {
        const row: TelemetryException = new TelemetryException();
        const into: TelemetryException = new TelemetryException();
        into.fingerprint = survivor;
        row.mergedIntoTelemetryException = into;
        return row;
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
