import { afterEach, describe, expect, jest, test } from "@jest/globals";
import NetworkEndpointService, {
  CoarseLastSeenAtBackfillPage,
} from "Common/Server/Services/NetworkEndpointService";
import logger from "Common/Server/Utils/Logger";
import BackfillNetworkEndpointCoarseLastSeenAt, {
  PAGE_ATTEMPTS,
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillNetworkEndpointCoarseLastSeenAt";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";

/*
 * BackfillNetworkEndpointCoarseLastSeenAt (#8092): NetworkEndpoint's
 * coarseLastSeenAt, which the age-out of discovered devices now finds its
 * candidates by, copied from lastSeenAt for the live endpoints that were
 * seen. A walk gives it to every endpoint it still sees; this is for the ones
 * nothing sees any more - the age-out's. The page itself
 * (NetworkEndpointService.backfillCoarseLastSeenAtPage) is pinned in
 * Common's NetworkEndpointServiceUpsert and, against Postgres,
 * NetworkEndpointWritesPostgres. Pinned here: its place among the data
 * migrations, that it pages by id until a short page, that a failing page is
 * tried again and one that keeps failing stops the run unrecorded, and that
 * rollback changes nothing.
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

const MIGRATION_NAME: string = "BackfillNetworkEndpointCoarseLastSeenAt";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

// Ids that sort as text, as Postgres orders a uuid.
function idOf(index: number): string {
  return `00000000-0000-4000-8000-${index.toString().padStart(12, "0")}`;
}

interface PageAsked {
  afterId?: string | undefined;
  limit: number;
}

/*
 * A table of `rows` endpoints still to write, as the page statement reads
 * it: the next `limit` after the cursor, by id.
 */
function stubPages(rows: number): Array<PageAsked> {
  const asked: Array<PageAsked> = [];

  jest
    .spyOn(NetworkEndpointService, "backfillCoarseLastSeenAtPage")
    .mockImplementation(
      async (data: PageAsked): Promise<CoarseLastSeenAtBackfillPage> => {
        asked.push({ afterId: data.afterId, limit: data.limit });
        const start: number = data.afterId
          ? Number(data.afterId.split("-").pop()) + 1
          : 0;
        const read: number = Math.max(0, Math.min(data.limit, rows - start));

        return {
          read: read,
          written: read,
          lastId: read > 0 ? idOf(start + read - 1) : undefined,
        };
      },
    );

  return asked;
}

function registeredNames(): Array<string> {
  const source: string = fs.readFileSync(
    path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
    "utf8",
  );

  return [...source.matchAll(/^\s+new (\w+)\(\),?$/gm)].map(
    (match: RegExpMatchArray) => {
      return match[1]!;
    },
  );
}

afterEach(() => {
  jest.restoreAllMocks();
  jest.clearAllMocks();
});

describe("BackfillNetworkEndpointCoarseLastSeenAt", () => {
  describe("registration", () => {
    test("is imported and instantiated in DataMigrations/Index.ts", () => {
      const source: string = fs.readFileSync(
        path.join(DATA_MIGRATIONS_DIR, "Index.ts"),
        "utf8",
      );

      expect(source).toContain(
        `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
      );
      expect(source).toContain(`new ${MIGRATION_NAME}(),`);
    });

    test("is registered once, above the runbook moves that keep their places before the last slot", () => {
      const registered: Array<string> = registeredNames();

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
        registered.indexOf("MoveRunbookApprovalsBeforeTheirSteps"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(new BackfillNetworkEndpointCoarseLastSeenAt().name).toBe(
        MIGRATION_NAME,
      );
    });

    test("runs on a clustered ClickHouse too: it is Postgres only", () => {
      expect(
        new BackfillNetworkEndpointCoarseLastSeenAt().runsInClusterMode(),
      ).toBe(true);
    });

    test("rollback changes nothing: the column goes with the schema migration", async () => {
      const page: ReturnType<typeof stubPages> = stubPages(5);

      await new BackfillNetworkEndpointCoarseLastSeenAt().rollback();

      expect(page).toHaveLength(0);
    });
  });

  describe("how it walks the table", () => {
    test("pages by id, each page after the last id of the one before, until a short page", async () => {
      const asked: Array<PageAsked> = stubPages(2 * PAGE_SIZE + 17);

      await new BackfillNetworkEndpointCoarseLastSeenAt().migrate();

      expect(asked).toEqual([
        { afterId: undefined, limit: PAGE_SIZE },
        { afterId: idOf(PAGE_SIZE - 1), limit: PAGE_SIZE },
        { afterId: idOf(2 * PAGE_SIZE - 1), limit: PAGE_SIZE },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: coarseLastSeenAt written for ${2 * PAGE_SIZE + 17} endpoints, in 3 pages.`,
      );
    });

    test("a full last page reads one more, empty page, and stops", async () => {
      const asked: Array<PageAsked> = stubPages(PAGE_SIZE);

      await new BackfillNetworkEndpointCoarseLastSeenAt().migrate();

      expect(asked).toEqual([
        { afterId: undefined, limit: PAGE_SIZE },
        { afterId: idOf(PAGE_SIZE - 1), limit: PAGE_SIZE },
      ]);
    });

    test("a table with nothing to write reads once and stops", async () => {
      const asked: Array<PageAsked> = stubPages(0);

      await new BackfillNetworkEndpointCoarseLastSeenAt().migrate();

      expect(asked).toEqual([{ afterId: undefined, limit: PAGE_SIZE }]);
      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: coarseLastSeenAt written for 0 endpoints, in 1 pages.`,
      );
    });

    test("counts what each page wrote, not what it read: a walk may have written a row first", async () => {
      jest
        .spyOn(NetworkEndpointService, "backfillCoarseLastSeenAtPage")
        .mockResolvedValueOnce({
          read: PAGE_SIZE,
          written: PAGE_SIZE - 3,
          lastId: idOf(PAGE_SIZE - 1),
        })
        .mockResolvedValueOnce({ read: 4, written: 4, lastId: idOf(1003) });

      await new BackfillNetworkEndpointCoarseLastSeenAt().migrate();

      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: coarseLastSeenAt written for ${PAGE_SIZE + 1} endpoints, in 2 pages.`,
      );
    });
  });

  describe("a page that fails", () => {
    test("is tried again, from the same cursor, and the walk goes on", async () => {
      const failure: Error = new Error(
        "canceling statement due to lock timeout",
      );
      const page: SpyInstance<
        typeof NetworkEndpointService.backfillCoarseLastSeenAtPage
      > = jest
        .spyOn(NetworkEndpointService, "backfillCoarseLastSeenAtPage")
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ read: 2, written: 2, lastId: idOf(1) });

      await new BackfillNetworkEndpointCoarseLastSeenAt().migrate();

      expect(page).toHaveBeenCalledTimes(2);
      expect(page.mock.calls[1]![0]).toEqual({
        afterId: undefined,
        limit: PAGE_SIZE,
      });
      expect(logger.warn).toHaveBeenCalledWith(failure);
    });

    test(`stops the run after ${PAGE_ATTEMPTS} tries, so it is not recorded as done and the next boot carries on`, async () => {
      const failure: Error = new Error("connection terminated");
      const page: SpyInstance<
        typeof NetworkEndpointService.backfillCoarseLastSeenAtPage
      > = jest
        .spyOn(NetworkEndpointService, "backfillCoarseLastSeenAtPage")
        .mockRejectedValue(failure);

      await expect(
        new BackfillNetworkEndpointCoarseLastSeenAt().migrate(),
      ).rejects.toBe(failure);
      expect(page).toHaveBeenCalledTimes(PAGE_ATTEMPTS);
    });
  });
});
