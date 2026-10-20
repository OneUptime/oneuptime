import { afterEach, describe, expect, jest, test } from "@jest/globals";
import FirstPagedAt from "Common/Server/Utils/OnCall/FirstPagedAt";
import logger from "Common/Server/Utils/Logger";
import BackfillFirstPagedAt from "../../../FeatureSet/Workers/DataMigrations/BackfillFirstPagedAt";
import fs from "fs";
import path from "path";

/*
 * Incidents, alerts and episodes paged before the upgrade get their First
 * Paged At - what "Time to acknowledge after paging" counts from - from the
 * steps of their on-call runs, here and not in the schema migration that
 * added the columns: there an UPDATE of every row would hold ADD COLUMN's lock
 * on the incident and alert tables for as long as it took.
 *
 * Pinned here: it is registered once, before the last slot; it runs the
 * batched backfill (whose rules Common's FirstPagedAt suite pins) and says
 * what it did; and a failure reaches the runner, which stops the chain and
 * tries again on the next deploy, instead of being recorded as done.
 */
jest.mock("Common/Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
  };
});

const MIGRATION_NAME: string = "BackfillFirstPagedAt";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("BackfillFirstPagedAt", () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  test("is registered once, before the last slot", () => {
    const index: string = fs.readFileSync(
      path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
      "utf8",
    );

    expect(index).toContain(
      `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
    );

    const registered: Array<string> = Array.from(
      index
        .replace(/\/\*[\s\S]*?\*\//g, " ")
        .matchAll(/new ([A-Za-z0-9]+)\(\)/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    expect(new BackfillFirstPagedAt().name).toBe(MIGRATION_NAME);
  });

  test("runs the backfill and says what it filled", async () => {
    const backfill: jest.SpiedFunction<typeof FirstPagedAt.backfill> = jest
      .spyOn(FirstPagedAt, "backfill")
      .mockResolvedValue({
        filledByTable: {
          Incident: 3,
          Alert: 12,
          AlertEpisode: 1,
          IncidentEpisode: 0,
        },
        measurementsRequeued: 2,
      });

    await new BackfillFirstPagedAt().migrate();

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(logger.info).toHaveBeenCalledWith(
      "BackfillFirstPagedAt: recorded when somebody was first paged on 3 Incident, 12 Alert, 1 AlertEpisode, 0 IncidentEpisode, and asked 2 measurement(s) that start or end at it to be worked out again.",
    );
  });

  test("lets a failure reach the runner, so it is tried again rather than recorded as done", async () => {
    jest
      .spyOn(FirstPagedAt, "backfill")
      .mockRejectedValue(new Error("statement timeout"));

    await expect(new BackfillFirstPagedAt().migrate()).rejects.toThrow(
      "statement timeout",
    );
  });

  test("has nothing to roll back", async () => {
    const backfill: jest.SpiedFunction<typeof FirstPagedAt.backfill> =
      jest.spyOn(FirstPagedAt, "backfill");

    await expect(new BackfillFirstPagedAt().rollback()).resolves.toBe(
      undefined,
    );
    expect(backfill).not.toHaveBeenCalled();
  });
});
