import FileService from "Common/Server/Services/FileService";
import logger from "Common/Server/Utils/Logger";
import HideImagesOfPrivateIncidents from "../../../FeatureSet/Workers/DataMigrations/HideImagesOfPrivateIncidents";
import fs from "fs";
import path from "path";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * HideImagesOfPrivateIncidents makes private again the images a private
 * incident or episode had made public while its Visible on Status Page
 * switch was still on - a private record is never shown on a status page
 * (StatusPageVisibility), so nothing it holds is public (PublishedImages).
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs FileService.hideImagesOfPrivateRecords - the one statement
 *      PublishedImages builds, held by the Common suites, on real rows by
 *      PublishedImagesPostgres - and says how many files it made private;
 *   3. a failure is not swallowed: the runner stops the chain and the
 *      migrate job fails, rather than leaving images public unnoticed;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "HideImagesOfPrivateIncidents";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("HideImagesOfPrivateIncidents", () => {
  let infoLogs: Array<string>;

  beforeEach(() => {
    infoLogs = [];

    jest.spyOn(logger, "info").mockImplementation((message: unknown): void => {
      infoLogs.push(String(message));
      return undefined;
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
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
      index.matchAll(/new ([A-Za-z0-9]+)\(\)/g),
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
  });

  test("has the name it is recorded under", () => {
    expect(new HideImagesOfPrivateIncidents().name).toBe(MIGRATION_NAME);
  });

  test("makes the images of private records private, and says how many", async () => {
    const hideImages: SpyInstance<
      typeof FileService.hideImagesOfPrivateRecords
    > = jest
      .spyOn(FileService, "hideImagesOfPrivateRecords")
      .mockResolvedValue(3);

    await new HideImagesOfPrivateIncidents().migrate();

    expect(hideImages).toHaveBeenCalledTimes(1);
    expect(infoLogs.join("\n")).toContain("made 3 image(s)");
  });

  test("a failure stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(FileService, "hideImagesOfPrivateRecords")
      .mockRejectedValue(new Error("db down"));

    await expect(new HideImagesOfPrivateIncidents().migrate()).rejects.toThrow(
      "db down",
    );
  });

  test("rollback changes nothing", async () => {
    const hideImages: SpyInstance<
      typeof FileService.hideImagesOfPrivateRecords
    > = jest.spyOn(FileService, "hideImagesOfPrivateRecords");

    await new HideImagesOfPrivateIncidents().rollback();

    expect(hideImages).not.toHaveBeenCalled();
  });
});
