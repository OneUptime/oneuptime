import FileService from "Common/Server/Services/FileService";
import { HIDE_NOT_YET_SHOWN_IMAGES_SQL } from "Common/Server/Utils/File/PublishedImages";
import logger from "Common/Server/Utils/Logger";
import HideImagesOfScheduledAnnouncements from "../../../FeatureSet/Workers/DataMigrations/HideImagesOfScheduledAnnouncements";
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
 * HideImagesOfScheduledAnnouncements makes private, until their
 * announcement is shown, the images announcements scheduled for later made
 * public when they were created: an announcement shows its images only from
 * the time it is shown from (PublishedImages).
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs FileService.hideImagesNotShownYet - the one statement
 *      PublishedImages builds (HIDE_NOT_YET_SHOWN_IMAGES_SQL), held by the
 *      Common suites and, on real rows, by PublishedImagesPostgres - and says
 *      how many files it made private;
 *   3. that statement never makes a file public;
 *   4. a failure is not swallowed: the runner stops the chain and the
 *      migrate job fails, rather than leaving images public unnoticed;
 *   5. rollback changes nothing.
 */

const MIGRATION_NAME: string = "HideImagesOfScheduledAnnouncements";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("HideImagesOfScheduledAnnouncements", () => {
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

  test("is registered once, after the earlier image migrations and before the last slot", () => {
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
      registered.indexOf("HideImagesOfHiddenRecordNotes"),
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("has the name it is recorded under", () => {
    expect(new HideImagesOfScheduledAnnouncements().name).toBe(MIGRATION_NAME);
  });

  test("makes the images of announcements scheduled for later private, and says how many", async () => {
    const hideImages: SpyInstance<typeof FileService.hideImagesNotShownYet> =
      jest.spyOn(FileService, "hideImagesNotShownYet").mockResolvedValue(3);

    await new HideImagesOfScheduledAnnouncements().migrate();

    expect(hideImages).toHaveBeenCalledTimes(1);
    expect(infoLogs.join("\n")).toContain("made 3 image(s)");
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

    await expect(FileService.hideImagesNotShownYet()).resolves.toBe(2);
    expect(query).toHaveBeenCalledWith(HIDE_NOT_YET_SHOWN_IMAGES_SQL);
  });

  test("never makes a file public", () => {
    expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).toMatch(
      /^WITH .* UPDATE "File" AS "file" SET "isPublic" = false WHERE/,
    );
    expect(HIDE_NOT_YET_SHOWN_IMAGES_SQL).not.toContain(
      `SET "isPublic" = true`,
    );
  });

  test("a failure stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(FileService, "hideImagesNotShownYet")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new HideImagesOfScheduledAnnouncements().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const hideImages: SpyInstance<typeof FileService.hideImagesNotShownYet> =
      jest.spyOn(FileService, "hideImagesNotShownYet");

    await new HideImagesOfScheduledAnnouncements().rollback();

    expect(hideImages).not.toHaveBeenCalled();
  });
});
