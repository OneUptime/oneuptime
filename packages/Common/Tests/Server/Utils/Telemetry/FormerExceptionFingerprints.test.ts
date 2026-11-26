import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import ExceptionInstanceService from "../../../../Server/Services/ExceptionInstanceService";
import FormerExceptionFingerprints, {
  FORMER_FINGERPRINTS_PER_BATCH,
  FORMER_FINGERPRINT_MIN_AGE_MS,
  FormerFingerprintsRetired,
} from "../../../../Server/Utils/Telemetry/FormerExceptionFingerprints";
import { Statement } from "../../../../Server/Utils/AnalyticsDatabase/Statement";
import JobDeadline from "../../../../Server/Utils/JobDeadline";
import logger from "../../../../Server/Utils/Logger";
import ObjectID from "../../../../Types/ObjectID";
import AnalyticsTableName from "../../../../Types/AnalyticsDatabase/AnalyticsTableName";

/*
 * ---------------------------------------------------------------------------
 * AN EXCEPTION'S FORMER FINGERPRINT IS KEPT ONLY WHILE AN OCCURRENCE CARRIES
 * IT (#10619).
 *
 * The row that keeps the fingerprint an exception had before it moved to a
 * private one is deleted once no occurrence ClickHouse keeps carries it, so
 * the unkeyed fingerprint is gone from Postgres when the occurrences that
 * carried it are gone from ClickHouse. Postgres and ClickHouse are faked
 * here; FormerExceptionFingerprintsClickhouseIntegration.test.ts runs the
 * occurrence read against a real ClickHouse.
 * ---------------------------------------------------------------------------
 */

const PROJECT_A: string = "10000000-0000-4000-8000-00000000a619";
const PROJECT_B: string = "10000000-0000-4000-8000-00000000b619";
const NOW: Date = new Date("2026-11-24T08:00:00.000Z");

interface FormerRow {
  id: string;
  projectId: string;
  fingerprint: string;
}

let formerRows: Array<FormerRow>;
let deleted: Array<string>;
let pages: Array<Array<unknown>>;
// The fingerprints an occurrence still carries, by project; a project absent fails.
let carried: Map<string, Array<string>>;
let reads: Array<Statement>;

function idOf(index: number): string {
  return `20000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

beforeEach(() => {
  formerRows = [];
  deleted = [];
  pages = [];
  carried = new Map();
  reads = [];

  jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
    manager: {
      query: async (sql: string, params: Array<unknown>): Promise<unknown> => {
        if (sql.startsWith("SELECT")) {
          pages.push(params);
          const after: string = params[1] as string;
          const limit: number = params[2] as number;

          return formerRows
            .filter((row: FormerRow): boolean => {
              return row.id > after && !deleted.includes(row.id);
            })
            .slice(0, limit);
        }

        if (sql.startsWith("DELETE")) {
          expect(sql).toContain(
            `"formerFingerprintOfTelemetryExceptionId" IS NOT NULL`,
          );
          deleted.push(...(params[0] as Array<string>));
          return [];
        }

        throw new Error(`unexpected statement ${sql}`);
      },
    },
  } as never);

  jest
    .spyOn(ExceptionInstanceService, "executeQuery")
    .mockImplementation((async (statement: Statement) => {
      reads.push(statement);
      const projectId: string = String(
        Object.values(statement.query_params).find((value: unknown) => {
          return (
            typeof value === "string" &&
            (value === PROJECT_A || value === PROJECT_B)
          );
        }),
      );
      const fingerprints: Array<string> | undefined = carried.get(projectId);

      if (!fingerprints) {
        throw new Error("ClickHouse is unreachable");
      }

      return {
        json: async () => {
          return {
            data: fingerprints.map((fingerprint: string) => {
              return { fingerprint };
            }),
          };
        },
      };
    }) as never);

  jest
    .spyOn(TelemetryExceptionService, "forgetGroupFingerprints")
    .mockResolvedValue(undefined as never);
  jest.spyOn(logger, "warn").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("retiring former exception fingerprints", () => {
  test("deletes those no occurrence carries any more, and keeps those one still does", async () => {
    formerRows = [
      { id: idOf(1), projectId: PROJECT_A, fingerprint: "fp-gone" },
      { id: idOf(2), projectId: PROJECT_A, fingerprint: "fp-carried" },
      { id: idOf(3), projectId: PROJECT_B, fingerprint: "fp-b-gone" },
    ];
    carried.set(PROJECT_A, ["fp-carried"]);
    carried.set(PROJECT_B, []);

    const result: FormerFingerprintsRetired =
      await FormerExceptionFingerprints.retireUncarried({ now: NOW });

    expect(result).toEqual({ read: 3, retired: 2 });
    expect(deleted).toEqual([idOf(1), idOf(3)]);
    // Their exceptions' groups changed, in both projects.
    expect(
      TelemetryExceptionService.forgetGroupFingerprints,
    ).toHaveBeenCalledWith([PROJECT_A, PROJECT_B]);
  });

  test("reads only rows moved a day or more ago, after the last one read, a batch at a time", async () => {
    await FormerExceptionFingerprints.retireUncarried({ now: NOW });

    expect(pages).toEqual([
      [
        new Date(NOW.getTime() - FORMER_FINGERPRINT_MIN_AGE_MS),
        "00000000-0000-0000-0000-000000000000",
        FORMER_FINGERPRINTS_PER_BATCH,
      ],
    ]);
  });

  test("pages through more rows than a batch holds", async () => {
    for (
      let index: number = 1;
      index <= FORMER_FINGERPRINTS_PER_BATCH + 3;
      index++
    ) {
      formerRows.push({
        id: idOf(index),
        projectId: PROJECT_A,
        fingerprint: `fp-${index}`,
      });
    }
    carried.set(PROJECT_A, []);

    const result: FormerFingerprintsRetired =
      await FormerExceptionFingerprints.retireUncarried({ now: NOW });

    expect(result).toEqual({
      read: FORMER_FINGERPRINTS_PER_BATCH + 3,
      retired: FORMER_FINGERPRINTS_PER_BATCH + 3,
    });
    expect(pages[1]![1]).toBe(idOf(FORMER_FINGERPRINTS_PER_BATCH));
  });

  test("a project whose occurrences cannot be read keeps its rows for the next run", async () => {
    formerRows = [
      { id: idOf(1), projectId: PROJECT_A, fingerprint: "fp-a" },
      { id: idOf(2), projectId: PROJECT_B, fingerprint: "fp-b" },
    ];
    carried.set(PROJECT_B, []);

    const result: FormerFingerprintsRetired =
      await FormerExceptionFingerprints.retireUncarried({ now: NOW });

    expect(result).toEqual({ read: 2, retired: 1 });
    expect(deleted).toEqual([idOf(2)]);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("stops once its deadline has passed", async () => {
    formerRows = [{ id: idOf(1), projectId: PROJECT_A, fingerprint: "fp" }];
    carried.set(PROJECT_A, []);
    const deadline: JobDeadline = new JobDeadline();
    deadline.end();

    expect(
      await FormerExceptionFingerprints.retireUncarried({ now: NOW, deadline }),
    ).toEqual({ read: 0, retired: 0 });
    expect(pages).toEqual([]);
  });

  test("asks ClickHouse about the project's own occurrences that are kept still, any of them", () => {
    const statement: Statement =
      FormerExceptionFingerprints.buildCarriedStatement({
        projectId: new ObjectID(PROJECT_A),
        fingerprints: ["fp-1", "fp-2"],
      });

    expect(statement.query).toBe(
      "SELECT fingerprint FROM {p0:Identifier} WHERE projectId = {p1:String} AND fingerprint IN ({p2:Array(String)}) AND retentionDate >= now() GROUP BY fingerprint",
    );
    // A repeat of a crash carries it too: duplicateOf is not read.
    expect(statement.query).not.toContain("duplicateOf");
    expect(statement.query_params).toEqual({
      p0: AnalyticsTableName.ExceptionInstance,
      p1: PROJECT_A,
      p2: ["fp-1", "fp-2"],
    });
  });
});
