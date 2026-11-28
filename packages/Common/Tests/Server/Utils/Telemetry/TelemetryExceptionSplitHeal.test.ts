import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import TelemetryExceptionService from "../../../../Server/Services/TelemetryExceptionService";
import TelemetryExceptionActivityService from "../../../../Server/Services/TelemetryExceptionActivityService";
import TelemetryExceptionMerge, {
  ExceptionMergeOutcome,
  ExceptionMergeResult,
} from "../../../../Server/Utils/Telemetry/TelemetryExceptionMerge";
import TelemetryExceptionSplitHeal, {
  ExceptionSplitHealOutcome,
  SPLIT_HEAL_ROWS_SQL,
  SPLIT_HEAL_ROW_BY_ID_SQL,
} from "../../../../Server/Utils/Telemetry/TelemetryExceptionSplitHeal";
import { TelemetryExceptionActivityType } from "../../../../Models/DatabaseModels/TelemetryExceptionActivity";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import logger from "../../../../Server/Utils/Logger";

/*
 * ---------------------------------------------------------------------------
 * A DUPLICATE A FAILED LOOKUP MADE IS MERGED BACK (#11027).
 *
 * Until #11027 an occurrence whose exceptions could not be read was filed
 * under grouping v1's fingerprint, where an exception made since grouping v2
 * has none: the upsert made a duplicate, and every later occurrence, trying
 * v1 first, went to it. TelemetryExceptionSplitHeal merges such a duplicate
 * into the exception it was split from - the older one survives - as
 * OneUptime, through the merge a person's Merge goes through. These hold
 * what it reads, what it decides and what it asks the merge for, with
 * Postgres and the merge faked; App's ExceptionLookupFailure.test.ts runs it
 * through ingest.
 * ---------------------------------------------------------------------------
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000011027";
const SERVICE_ID: string = "20000000-0000-4000-8000-000000011027";
const DUPLICATE_ID: string = "30000000-0000-4000-8000-000000011027";
const ORIGINAL_ID: string = "40000000-0000-4000-8000-000000011027";
const SURVIVOR_ID: string = "50000000-0000-4000-8000-000000011027";
const MOVED_ID: string = "60000000-0000-4000-8000-000000011027";
const V1: string = "1".repeat(64);
const V2: string = "2".repeat(64);

const BEFORE: Date = new Date("2026-11-01T00:00:00Z");
const AFTER: Date = new Date("2026-11-20T00:00:00Z");

interface Row {
  id: string;
  fingerprint: string;
  createdAt: Date | string | null;
  mergedIntoId: string | null;
  formerFingerprintOfId: string | null;
}

let rows: Array<Row>;
let statements: Array<{ sql: string; params: Array<unknown> }>;
let unmergedBefore: number;
let mergeCalls: Array<{
  telemetryExceptionId: ObjectID;
  mergedTelemetryExceptionIds: Array<ObjectID>;
  props: DatabaseCommonInteractionProps;
}>;
let mergeOutcome: ExceptionMergeOutcome | "throws";
let activityQueries: Array<Record<string, unknown>>;

function row(data: Partial<Row> & { id: string; fingerprint: string }): Row {
  return {
    createdAt: null,
    mergedIntoId: null,
    formerFingerprintOfId: null,
    ...data,
  };
}

function heal(): Promise<ExceptionSplitHealOutcome> {
  return TelemetryExceptionSplitHeal.heal({
    projectId: PROJECT_ID,
    primaryEntityId: SERVICE_ID,
    duplicate: V1,
    original: V2,
  });
}

describe("TelemetryExceptionSplitHeal", () => {
  beforeEach(() => {
    rows = [];
    statements = [];
    unmergedBefore = 0;
    mergeCalls = [];
    mergeOutcome = ExceptionMergeOutcome.Merged;
    activityQueries = [];

    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (
          sql: string,
          params: Array<unknown>,
        ): Promise<unknown> => {
          statements.push({ sql, params });

          if (sql === SPLIT_HEAL_ROWS_SQL) {
            const fingerprints: Array<string> = params[2] as Array<string>;

            return rows.filter((each: Row) => {
              return fingerprints.includes(each.fingerprint);
            });
          }

          if (sql === SPLIT_HEAL_ROW_BY_ID_SQL) {
            return rows.filter((each: Row) => {
              return each.id === params[0];
            });
          }

          throw new Error(`unexpected statement ${sql}`);
        },
      },
    } as never);

    jest
      .spyOn(TelemetryExceptionActivityService, "countBy")
      .mockImplementation((async (data: {
        query: Record<string, unknown>;
      }): Promise<PositiveNumber> => {
        activityQueries.push(data.query);
        return new PositiveNumber(unmergedBefore);
      }) as never);

    jest.spyOn(TelemetryExceptionMerge, "merge").mockImplementation((async (
      data: (typeof mergeCalls)[number],
    ): Promise<ExceptionMergeResult> => {
      mergeCalls.push(data);

      if (mergeOutcome === "throws") {
        throw new Error("deadlock detected");
      }

      return {
        telemetryExceptionId: data.telemetryExceptionId.toString(),
        merged: data.mergedTelemetryExceptionIds.map((id: ObjectID) => {
          return {
            telemetryExceptionId: id.toString(),
            outcome: mergeOutcome as ExceptionMergeOutcome,
          };
        }),
      };
    }) as never);

    jest.spyOn(logger, "warn").mockImplementation((() => {
      return undefined;
    }) as never);
    jest.spyOn(logger, "info").mockImplementation((() => {
      return undefined;
    }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("a duplicate made after the exception it was split from is merged into it, as OneUptime", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.Merged);
    expect(mergeCalls).toHaveLength(1);
    expect(mergeCalls[0]!.telemetryExceptionId.toString()).toBe(ORIGINAL_ID);
    expect(
      mergeCalls[0]!.mergedTelemetryExceptionIds.map((id: ObjectID) => {
        return id.toString();
      }),
    ).toEqual([DUPLICATE_ID]);
    // No person asked: no user, the project's own.
    expect(mergeCalls[0]!.props.isRoot).toBe(true);
    expect(mergeCalls[0]!.props.userId).toBeUndefined();
    expect(mergeCalls[0]!.props.tenantId?.toString()).toBe(PROJECT_ID);
  });

  test("reads both by project, resource and fingerprint, deleted ones left out, in one statement", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];

    await heal();

    expect(statements[0]).toEqual({
      sql: SPLIT_HEAL_ROWS_SQL,
      params: [PROJECT_ID, SERVICE_ID, [V1, V2]],
    });
    expect(SPLIT_HEAL_ROWS_SQL).toContain(`"deletedAt" IS NULL`);
    expect(SPLIT_HEAL_ROWS_SQL).toContain(`"primaryEntityId" = $2`);
    expect(SPLIT_HEAL_ROW_BY_ID_SQL).toContain(`"projectId" = $2`);
    expect(SPLIT_HEAL_ROW_BY_ID_SQL).toContain(`"deletedAt" IS NULL`);
  });

  test("times read as text are compared as times", async () => {
    rows = [
      row({
        id: DUPLICATE_ID,
        fingerprint: V1,
        createdAt: "2026-11-20 10:00:00.5+00",
      }),
      row({
        id: ORIGINAL_ID,
        fingerprint: V2,
        createdAt: "2026-11-20 10:00:00.25+00",
      }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.Merged);
  });

  test.each([
    ["made before the other", BEFORE, AFTER],
    ["made at the same moment", AFTER, AFTER],
    ["of unknown age", null, BEFORE],
    ["beside one of unknown age", AFTER, null],
  ])(
    "an exception under v1 %s is no duplicate: nothing is merged",
    async (
      _case: string,
      duplicateAt: Date | null,
      originalAt: Date | null,
    ) => {
      rows = [
        row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: duplicateAt }),
        row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: originalAt }),
      ];

      expect(await heal()).toBe(ExceptionSplitHealOutcome.NotADuplicate);
      expect(mergeCalls).toEqual([]);
    },
  );

  test("a row that only keeps a former fingerprint is no duplicate", async () => {
    rows = [
      row({
        id: DUPLICATE_ID,
        fingerprint: V1,
        createdAt: AFTER,
        formerFingerprintOfId: MOVED_ID,
        mergedIntoId: MOVED_ID,
      }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.NotADuplicate);
    expect(mergeCalls).toEqual([]);
  });

  test("the exception it was split from, moved to a private fingerprint since, is found where it went", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({
        id: ORIGINAL_ID,
        fingerprint: V2,
        createdAt: AFTER,
        formerFingerprintOfId: MOVED_ID,
        mergedIntoId: MOVED_ID,
      }),
      row({ id: MOVED_ID, fingerprint: "k".repeat(64), createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.Merged);
    expect(mergeCalls[0]!.telemetryExceptionId.toString()).toBe(MOVED_ID);
  });

  test("its age is the moved exception's, not its former fingerprint row's", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: BEFORE }),
      row({
        id: ORIGINAL_ID,
        fingerprint: V2,
        createdAt: BEFORE,
        formerFingerprintOfId: MOVED_ID,
        mergedIntoId: MOVED_ID,
      }),
      // Made after the exception under v1: that one is no duplicate.
      row({ id: MOVED_ID, fingerprint: "k".repeat(64), createdAt: AFTER }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.NotADuplicate);
    expect(mergeCalls).toEqual([]);
  });

  test("merged into another one since, the one it was split from stands for that one", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({
        id: ORIGINAL_ID,
        fingerprint: V2,
        createdAt: BEFORE,
        mergedIntoId: SURVIVOR_ID,
      }),
      row({ id: SURVIVOR_ID, fingerprint: "s".repeat(64), createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.Merged);
    expect(mergeCalls[0]!.telemetryExceptionId.toString()).toBe(SURVIVOR_ID);
  });

  test("merged already, either way round, nothing is merged again", async () => {
    rows = [
      row({
        id: DUPLICATE_ID,
        fingerprint: V1,
        createdAt: AFTER,
        mergedIntoId: ORIGINAL_ID,
      }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.AlreadyMerged);

    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({
        id: ORIGINAL_ID,
        fingerprint: V2,
        createdAt: BEFORE,
        mergedIntoId: DUPLICATE_ID,
      }),
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.AlreadyMerged);
    expect(mergeCalls).toEqual([]);
  });

  test("merged into another exception by a person: their call stands", async () => {
    rows = [
      row({
        id: DUPLICATE_ID,
        fingerprint: V1,
        createdAt: AFTER,
        mergedIntoId: SURVIVOR_ID,
      }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.LeftToAPerson);
    expect(mergeCalls).toEqual([]);
  });

  test("taken out of a merge by a person before: their call stands", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];
    unmergedBefore = 1;

    expect(await heal()).toBe(ExceptionSplitHealOutcome.LeftToAPerson);
    expect(mergeCalls).toEqual([]);
    expect(activityQueries).toHaveLength(1);
    expect(activityQueries[0]!["activityType"]).toBe(
      TelemetryExceptionActivityType.UnmergedFrom,
    );
    expect(String(activityQueries[0]!["telemetryExceptionId"])).toBe(
      DUPLICATE_ID,
    );
    expect(String(activityQueries[0]!["projectId"])).toBe(PROJECT_ID);
  });

  test.each([
    ["the duplicate", [V2]],
    ["the one it was split from", [V1]],
    ["both", []],
  ])(
    "gone: %s - nothing is merged",
    async (_case: string, left: Array<string>) => {
      rows = [
        row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
        row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
      ].filter((each: Row) => {
        return left.includes(each.fingerprint);
      });

      expect(await heal()).toBe(ExceptionSplitHealOutcome.NotFound);
      expect(mergeCalls).toEqual([]);
    },
  );

  test("the one it was split from moved, and that one gone: nothing is merged", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({
        id: ORIGINAL_ID,
        fingerprint: V2,
        createdAt: BEFORE,
        formerFingerprintOfId: MOVED_ID,
      }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.NotFound);
    expect(mergeCalls).toEqual([]);
  });

  test("what is not asked well is not read", async () => {
    for (const data of [
      { duplicate: "", original: V2 },
      { duplicate: V1, original: "" },
      { duplicate: V1, original: V1 },
    ]) {
      expect(
        await TelemetryExceptionSplitHeal.heal({
          projectId: PROJECT_ID,
          primaryEntityId: SERVICE_ID,
          ...data,
        }),
      ).toBe(ExceptionSplitHealOutcome.NotFound);
    }

    expect(
      await TelemetryExceptionSplitHeal.heal({
        projectId: "",
        primaryEntityId: SERVICE_ID,
        duplicate: V1,
        original: V2,
      }),
    ).toBe(ExceptionSplitHealOutcome.NotFound);
    expect(statements).toEqual([]);
  });

  test("a merge that fails never throws: it says so, and the next occurrence tries again", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];
    mergeOutcome = "throws";

    expect(await heal()).toBe(ExceptionSplitHealOutcome.Failed);
    expect(logger.warn).toHaveBeenCalled();
  });

  test("a read that fails never throws either", async () => {
    jest.spyOn(TelemetryExceptionService, "getRepository").mockReturnValue({
      manager: {
        query: async (): Promise<unknown> => {
          throw new Error("connection reset");
        },
      },
    } as never);

    expect(await heal()).toBe(ExceptionSplitHealOutcome.Failed);
    expect(mergeCalls).toEqual([]);
  });

  test("merged already by the time the merge runs (another process): already merged", async () => {
    rows = [
      row({ id: DUPLICATE_ID, fingerprint: V1, createdAt: AFTER }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];
    mergeOutcome = ExceptionMergeOutcome.AlreadyMerged;

    expect(await heal()).toBe(ExceptionSplitHealOutcome.AlreadyMerged);
  });

  test("ids are compared whatever their case", async () => {
    rows = [
      row({
        id: DUPLICATE_ID,
        fingerprint: V1,
        createdAt: AFTER,
        mergedIntoId: ORIGINAL_ID.toUpperCase(),
      }),
      row({ id: ORIGINAL_ID, fingerprint: V2, createdAt: BEFORE }),
    ];

    expect(await heal()).toBe(ExceptionSplitHealOutcome.AlreadyMerged);
  });
});
