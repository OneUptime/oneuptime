import { afterEach, describe, expect, jest, test } from "@jest/globals";
import NetworkDeviceService, {
  ManufacturerBackfillPage,
} from "Common/Server/Services/NetworkDeviceService";
import logger from "Common/Server/Utils/Logger";
import BackfillNetworkDeviceManufacturer, {
  PAGE_ATTEMPTS,
  PAGE_SIZE,
} from "../../../FeatureSet/Workers/DataMigrations/BackfillNetworkDeviceManufacturer";
import fs from "fs";
import type { SpyInstance } from "jest-mock";
import path from "path";

/*
 * BackfillNetworkDeviceManufacturer (#9363): NetworkDevice.manufacturer, the
 * maker each device's Vendor / Model column shows, which the Devices,
 * Archived and site lists now filter and sort by. A device created or changed
 * after the upgrade has it; this works it out for the devices that exist. The
 * page itself (NetworkDeviceService.backfillManufacturerPage) is pinned in
 * Common's NetworkDeviceManufacturer and, against Postgres,
 * NetworkDeviceManufacturerPostgres. Pinned here: its place among the data
 * migrations, after the schema migration that adds the column, that it pages
 * by id until a short page, that a failing page is tried again and one that
 * keeps failing stops the run unrecorded, and that rollback changes nothing.
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

const MIGRATION_NAME: string = "BackfillNetworkDeviceManufacturer";

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
 * A table of `rows` devices, as the page statement reads it: the next
 * `limit` after the cursor, by id, each one written.
 */
function stubPages(rows: number): Array<PageAsked> {
  const asked: Array<PageAsked> = [];

  jest
    .spyOn(NetworkDeviceService, "backfillManufacturerPage")
    .mockImplementation(
      async (data: PageAsked): Promise<ManufacturerBackfillPage> => {
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

describe("BackfillNetworkDeviceManufacturer", () => {
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

    test("is registered once, after the migrations before it and before the last slot", () => {
      const registered: Array<string> = registeredNames();

      expect(
        registered.filter((name: string): boolean => {
          return name === MIGRATION_NAME;
        }),
      ).toHaveLength(1);
      expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
        registered.indexOf("RestoreCutMicrosoftTeamsChatIds"),
      );
      expect(registered[registered.length - 1]).toBe(
        "AddAuditLogMcpClientColumns",
      );
    });

    test("carries its own name, the key the migration runner records as executed", () => {
      expect(new BackfillNetworkDeviceManufacturer().name).toBe(MIGRATION_NAME);
    });

    test("runs on a clustered ClickHouse too: it is Postgres only", () => {
      expect(new BackfillNetworkDeviceManufacturer().runsInClusterMode()).toBe(
        true,
      );
    });

    test("rollback changes nothing: the column goes with the schema migration", async () => {
      const page: ReturnType<typeof stubPages> = stubPages(5);

      await new BackfillNetworkDeviceManufacturer().rollback();

      expect(page).toHaveLength(0);
    });
  });

  describe("how it walks the table", () => {
    test("pages by id, each page after the last id of the one before, until a short page", async () => {
      const asked: Array<PageAsked> = stubPages(2 * PAGE_SIZE + 17);

      await new BackfillNetworkDeviceManufacturer().migrate();

      expect(asked).toEqual([
        { afterId: undefined, limit: PAGE_SIZE },
        { afterId: idOf(PAGE_SIZE - 1), limit: PAGE_SIZE },
        { afterId: idOf(2 * PAGE_SIZE - 1), limit: PAGE_SIZE },
      ]);
      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: the maker of ${2 * PAGE_SIZE + 17} network devices worked out, ${2 * PAGE_SIZE + 17} written, in 3 pages.`,
      );
    });

    test("a full last page reads one more, empty page, and stops", async () => {
      const asked: Array<PageAsked> = stubPages(PAGE_SIZE);

      await new BackfillNetworkDeviceManufacturer().migrate();

      expect(asked).toEqual([
        { afterId: undefined, limit: PAGE_SIZE },
        { afterId: idOf(PAGE_SIZE - 1), limit: PAGE_SIZE },
      ]);
    });

    test("a project with no devices reads once and stops", async () => {
      const asked: Array<PageAsked> = stubPages(0);

      await new BackfillNetworkDeviceManufacturer().migrate();

      expect(asked).toEqual([{ afterId: undefined, limit: PAGE_SIZE }]);
      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: the maker of 0 network devices worked out, 0 written, in 1 pages.`,
      );
    });

    test("counts what each page wrote apart from what it read: a device that names no maker, or was written meanwhile, is not written again", async () => {
      jest
        .spyOn(NetworkDeviceService, "backfillManufacturerPage")
        .mockResolvedValueOnce({
          read: PAGE_SIZE,
          written: PAGE_SIZE - 3,
          lastId: idOf(PAGE_SIZE - 1),
        })
        .mockResolvedValueOnce({ read: 4, written: 4, lastId: idOf(503) });

      await new BackfillNetworkDeviceManufacturer().migrate();

      expect(logger.info).toHaveBeenCalledWith(
        `${MIGRATION_NAME}: the maker of ${PAGE_SIZE + 4} network devices worked out, ${PAGE_SIZE + 1} written, in 2 pages.`,
      );
    });
  });

  describe("a page that fails", () => {
    test("is tried again, from the same cursor, and the walk goes on", async () => {
      const failure: Error = new Error(
        "canceling statement due to lock timeout",
      );
      const page: SpyInstance<
        typeof NetworkDeviceService.backfillManufacturerPage
      > = jest
        .spyOn(NetworkDeviceService, "backfillManufacturerPage")
        .mockRejectedValueOnce(failure)
        .mockResolvedValueOnce({ read: 2, written: 2, lastId: idOf(1) });

      await new BackfillNetworkDeviceManufacturer().migrate();

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
        typeof NetworkDeviceService.backfillManufacturerPage
      > = jest
        .spyOn(NetworkDeviceService, "backfillManufacturerPage")
        .mockRejectedValue(failure);

      await expect(
        new BackfillNetworkDeviceManufacturer().migrate(),
      ).rejects.toBe(failure);
      expect(page).toHaveBeenCalledTimes(PAGE_ATTEMPTS);
    });
  });
});
