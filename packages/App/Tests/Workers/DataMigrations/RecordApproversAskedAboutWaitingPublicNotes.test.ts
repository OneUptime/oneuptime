import logger from "Common/Server/Utils/Logger";
import PublicNoteApproverChanges from "Common/Server/Utils/Notes/PublicNoteApproverChanges";
import RecordApproversAskedAboutWaitingPublicNotes from "../../../FeatureSet/Workers/DataMigrations/RecordApproversAskedAboutWaitingPublicNotes";
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
 * RecordApproversAskedAboutWaitingPublicNotes (#6353): the notes that waited
 * for approval before OneUptime recorded whom it asked take the people their
 * step asks now as asked, without asking anybody - so the first change of
 * their approvers asks only who is new
 * (PublicNoteApproverChanges.recordWaitingNotesAsAsked, held over notes of
 * every kind by the Common suite PublicNoteApproverChanges).
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it records the waiting notes and says how many requests it wrote;
 *   3. a failure to read the notes stops the chain rather than being
 *      swallowed: the migration runs again on the next start;
 *   4. rollback changes nothing.
 */

const MIGRATION_NAME: string = "RecordApproversAskedAboutWaitingPublicNotes";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("RecordApproversAskedAboutWaitingPublicNotes", () => {
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
    expect(registered.indexOf(MIGRATION_NAME)).toBeLessThan(
      registered.length - 1,
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("has the name it is recorded under", () => {
    expect(new RecordApproversAskedAboutWaitingPublicNotes().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("records the notes waiting for approval as asked, and says how many requests", async () => {
    const record: SpyInstance<
      typeof PublicNoteApproverChanges.recordWaitingNotesAsAsked
    > = jest
      .spyOn(PublicNoteApproverChanges, "recordWaitingNotesAsAsked")
      .mockResolvedValue(12);

    await new RecordApproversAskedAboutWaitingPublicNotes().migrate();

    expect(record).toHaveBeenCalledTimes(1);
    expect(infoLogs.join("\n")).toContain("recorded 12 request(s)");
  });

  test("a failure stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(PublicNoteApproverChanges, "recordWaitingNotesAsAsked")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new RecordApproversAskedAboutWaitingPublicNotes().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback changes nothing", async () => {
    const record: SpyInstance<
      typeof PublicNoteApproverChanges.recordWaitingNotesAsAsked
    > = jest.spyOn(PublicNoteApproverChanges, "recordWaitingNotesAsAsked");

    await new RecordApproversAskedAboutWaitingPublicNotes().rollback();

    expect(record).not.toHaveBeenCalled();
  });
});
