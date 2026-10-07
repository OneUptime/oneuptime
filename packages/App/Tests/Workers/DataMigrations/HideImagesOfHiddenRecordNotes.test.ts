import FileService from "Common/Server/Services/FileService";
import { HIDE_HIDDEN_RECORD_IMAGES_SQL } from "Common/Server/Utils/File/PublishedImages";
import logger from "Common/Server/Utils/Logger";
import HideImagesOfHiddenRecordNotes from "../../../FeatureSet/Workers/DataMigrations/HideImagesOfHiddenRecordNotes";
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
import type { Mock, SpyInstance } from "jest-mock";

/*
 * HideImagesOfHiddenRecordNotes makes private again the images public notes
 * made public whatever their incident, episode or scheduled maintenance
 * event showed - a note is shown on a status page only with its record
 * (PublishedImages) - and the images a private record kept public through
 * its own notes.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, after HideImagesOfPrivateIncidents and
 *      before the slot AddAuditLogMcpClientColumns keeps last;
 *   2. it runs FileService.hideImagesOfHiddenRecords - the one statement
 *      PublishedImages builds (HIDE_HIDDEN_RECORD_IMAGES_SQL), held by the
 *      Common suites and, on real rows, by PublishedImagesPostgres - and says
 *      how many files it made private;
 *   3. that statement never makes a file public;
 *   4. a failure is not swallowed: the runner stops the chain and the
 *      migrate job fails, rather than leaving images public unnoticed;
 *   5. rollback changes nothing.
 */

const MIGRATION_NAME: string = "HideImagesOfHiddenRecordNotes";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("HideImagesOfHiddenRecordNotes", () => {
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

  test("is registered once, after HideImagesOfPrivateIncidents and before the last slot", () => {
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
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("HideImagesOfPrivateIncidents"),
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("has the name it is recorded under", () => {
    expect(new HideImagesOfHiddenRecordNotes().name).toBe(MIGRATION_NAME);
  });

  test("makes the images of notes of records no status page shows private, and says how many", async () => {
    const hideImages: SpyInstance<
      typeof FileService.hideImagesOfHiddenRecords
    > = jest
      .spyOn(FileService, "hideImagesOfHiddenRecords")
      .mockResolvedValue(4);

    await new HideImagesOfHiddenRecordNotes().migrate();

    expect(hideImages).toHaveBeenCalledTimes(1);
    expect(infoLogs.join("\n")).toContain("made 4 image(s)");
  });

  test("runs the one statement PublishedImages builds for it", async () => {
    const query: Mock<(sql: string) => Promise<unknown>> = jest.fn(
      async (): Promise<unknown> => {
        return [[], 2];
      },
    );

    jest.spyOn(FileService, "getRepository").mockReturnValue({
      manager: { query },
    } as never);

    await expect(FileService.hideImagesOfHiddenRecords()).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(HIDE_HIDDEN_RECORD_IMAGES_SQL);
  });

  test("never makes a file public", () => {
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).toMatch(
      /^WITH .* UPDATE "File" AS "file" SET "isPublic" = false WHERE/,
    );
    expect(HIDE_HIDDEN_RECORD_IMAGES_SQL).not.toContain(
      `SET "isPublic" = true`,
    );
  });

  test("a failure stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(FileService, "hideImagesOfHiddenRecords")
      .mockRejectedValue(new Error("db down"));

    await expect(new HideImagesOfHiddenRecordNotes().migrate()).rejects.toThrow(
      "db down",
    );
  });

  test("rollback changes nothing", async () => {
    const hideImages: SpyInstance<
      typeof FileService.hideImagesOfHiddenRecords
    > = jest.spyOn(FileService, "hideImagesOfHiddenRecords");

    await new HideImagesOfHiddenRecordNotes().rollback();

    expect(hideImages).not.toHaveBeenCalled();
  });
});
