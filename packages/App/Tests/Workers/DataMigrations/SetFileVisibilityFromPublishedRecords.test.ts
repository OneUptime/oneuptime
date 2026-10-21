import FileService from "Common/Server/Services/FileService";
import logger from "Common/Server/Utils/Logger";
import SetFileVisibilityFromPublishedRecords from "../../../FeatureSet/Workers/DataMigrations/SetFileVisibilityFromPublishedRecords";
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
 * SetFileVisibilityFromPublishedRecords sets the files from before a file
 * was public exactly while a record shows it to everyone (PublishedImages):
 * images published records show become public - public notes posted before
 * notes made their images public show them again - and public files nothing
 * published shows become private.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs FileService.setVisibilityFromPublishedRecords - the two
 *      statements PublishedImages builds, held by the Common suites - and
 *      says how many files moved each way;
 *   3. a failure is not swallowed: the runner stops the chain and the
 *      migrate job fails, rather than leaving files half set unnoticed;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "SetFileVisibilityFromPublishedRecords";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("SetFileVisibilityFromPublishedRecords", () => {
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
    expect(new SetFileVisibilityFromPublishedRecords().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("sets every file from before the rule, and says how many moved", async () => {
    const setVisibility: SpyInstance<
      typeof FileService.setVisibilityFromPublishedRecords
    > = jest
      .spyOn(FileService, "setVisibilityFromPublishedRecords")
      .mockResolvedValue({ madePublic: 4, madePrivate: 7 });

    await new SetFileVisibilityFromPublishedRecords().migrate();

    expect(setVisibility).toHaveBeenCalledTimes(1);
    expect(infoLogs.join("\n")).toContain("made 4 image(s)");
    expect(infoLogs.join("\n")).toContain("7 file(s)");
  });

  test("a failure stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(FileService, "setVisibilityFromPublishedRecords")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new SetFileVisibilityFromPublishedRecords().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const setVisibility: SpyInstance<
      typeof FileService.setVisibilityFromPublishedRecords
    > = jest.spyOn(FileService, "setVisibilityFromPublishedRecords");

    await new SetFileVisibilityFromPublishedRecords().rollback();

    expect(setVisibility).not.toHaveBeenCalled();
  });
});
