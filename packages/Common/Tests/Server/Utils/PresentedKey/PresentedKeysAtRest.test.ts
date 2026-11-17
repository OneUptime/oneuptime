import PresentedKeysAtRest, {
  EXECUTED_AT_SQL,
  LOOKUP_HASH_MIGRATION_NAME,
  PROTECTED_AT_REST_MARKER,
  PROTECTION_CHECK_TTL_MS,
  SETTLE_PERIOD_MS,
  SqlRunner,
} from "../../../../Server/Utils/PresentedKey/PresentedKeysAtRest";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * WHETHER A KEY PRESENTED TO ONEUPTIME MAY STILL BE STORED AS WRITTEN (#9012).
 *
 * Until the PresentedKeys:ProtectAtRest job has protected every key stored
 * before, and recorded so (PROTECTED_AT_REST_MARKER in the DataMigrations
 * table), a key not found by its hash is looked up as written too. This
 * holds the question to:
 *
 *   - yes until the record is there, no once it is;
 *   - asked of the database at most once a minute per process;
 *   - yes when the database cannot answer: an upgrade must lock no one out;
 *   - a day's wait after the lookup hashes are written, past any rolling
 *     upgrade, before any key is protected in place.
 */

jest.mock("../../../../Server/Utils/Logger");

// A DataMigrations table that holds `rows`, and counts how often it is read.
function tableHolding(rows: Record<string, Date>): {
  runner: SqlRunner;
  reads: Array<unknown>;
} {
  const reads: Array<unknown> = [];

  return {
    reads: reads,
    runner: {
      query: async (
        sql: string,
        parameters?: Array<unknown>,
      ): Promise<unknown> => {
        reads.push(parameters);
        expect(sql).toBe(EXECUTED_AT_SQL);

        const executedAt: Date | undefined = rows[String(parameters?.[0])];

        return [{ executedAt: executedAt || null }];
      },
    },
  };
}

beforeEach(() => {
  PresentedKeysAtRest.forget();
});

afterEach(() => {
  jest.useRealTimers();
  PresentedKeysAtRest.forget();
});

describe("mayHoldKeysAsWritten", () => {
  test("yes, until every key is recorded as protected", async () => {
    const { runner } = tableHolding({
      [LOOKUP_HASH_MIGRATION_NAME]: new Date(),
    });

    expect(await PresentedKeysAtRest.mayHoldKeysAsWritten(runner)).toBe(true);
  });

  test("no, once it is", async () => {
    const { runner } = tableHolding({
      [PROTECTED_AT_REST_MARKER]: new Date(),
    });

    expect(await PresentedKeysAtRest.mayHoldKeysAsWritten(runner)).toBe(false);
  });

  test("asks once a minute per process, then asks again", async () => {
    jest.useFakeTimers({ now: new Date("2026-11-17T10:00:00Z") });

    const { runner, reads } = tableHolding({});

    await PresentedKeysAtRest.mayHoldKeysAsWritten(runner);
    await PresentedKeysAtRest.mayHoldKeysAsWritten(runner);

    expect(reads.length).toBe(1);

    jest.setSystemTime(new Date(Date.now() + PROTECTION_CHECK_TTL_MS + 1));

    await PresentedKeysAtRest.mayHoldKeysAsWritten(runner);

    expect(reads.length).toBe(2);
  });

  test("yes when the database cannot answer: nobody is locked out", async () => {
    const runner: SqlRunner = {
      query: async (): Promise<unknown> => {
        throw new Error("the database is away");
      },
    };

    expect(await PresentedKeysAtRest.mayHoldKeysAsWritten(runner)).toBe(true);
  });

  test("reads the marker by its name, a recorded, live row", async () => {
    const { runner, reads } = tableHolding({});

    await PresentedKeysAtRest.mayHoldKeysAsWritten(runner);

    expect(reads).toEqual([[PROTECTED_AT_REST_MARKER]]);
    expect(EXECUTED_AT_SQL).toContain(`"executed" = true`);
    expect(EXECUTED_AT_SQL).toContain(`"deletedAt" IS NULL`);
  });
});

describe("getExecutedAt", () => {
  test("is when a migration was recorded, or null", async () => {
    const at: Date = new Date("2026-11-16T08:00:00Z");
    const { runner } = tableHolding({ [LOOKUP_HASH_MIGRATION_NAME]: at });

    expect(
      await PresentedKeysAtRest.getExecutedAt(
        runner,
        LOOKUP_HASH_MIGRATION_NAME,
      ),
    ).toEqual(at);
    expect(
      await PresentedKeysAtRest.getExecutedAt(runner, PROTECTED_AT_REST_MARKER),
    ).toBeNull();
  });

  test("reads a time the driver hands back as text", async () => {
    const runner: SqlRunner = {
      query: async (): Promise<unknown> => {
        return [{ executedAt: "2026-11-16T08:00:00.000Z" }];
      },
    };

    expect(await PresentedKeysAtRest.getExecutedAt(runner, "Anything")).toEqual(
      new Date("2026-11-16T08:00:00.000Z"),
    );
  });
});

describe("the wait before keys are protected in place", () => {
  test("is a day: long past any rolling upgrade of the release before", () => {
    expect(SETTLE_PERIOD_MS).toBe(24 * 60 * 60 * 1000);
  });

  test("starts from the data migration that writes the lookup hashes", () => {
    expect(LOOKUP_HASH_MIGRATION_NAME).toBe("HashPresentedKeysForLookup");
  });
});
