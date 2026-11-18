import TestPageAcknowledgementBackfill, {
  TestPageAcknowledgementBackfillResult,
} from "Common/Server/Utils/WelcomeChecklist/TestPageAcknowledgementBackfill";
import logger from "Common/Server/Utils/Logger";
import NoteTestPagesAcknowledgedBeforeFirstSteps from "../../../FeatureSet/Workers/DataMigrations/NoteTestPagesAcknowledgedBeforeFirstSteps";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";

/*
 * The one-off backfill of the members who acknowledged a test page before
 * the Welcome checklist noted it (#7042), as the workers run it: registered
 * once, before the slot AddAuditLogMcpClientColumns keeps last; named after
 * itself, so it runs once; it hands the work to
 * TestPageAcknowledgementBackfill (Common's suite of that name holds what it
 * reads and notes) and says what it did.
 */

const MIGRATION_NAME: string = "NoteTestPagesAcknowledgedBeforeFirstSteps";

const DATA_MIGRATIONS_DIR: string = path.join(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

function registeredMigrations(): Array<string> {
  const index: string = fs
    .readFileSync(path.join(DATA_MIGRATIONS_DIR, "Index.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/[^\n]*/g, "$1");

  expect(index).toContain(
    `import ${MIGRATION_NAME} from "./${MIGRATION_NAME}";`,
  );

  return Array.from(index.matchAll(/new ([A-Za-z0-9]+)\(\)/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1]!;
    },
  );
}

const captureInfo: () => Array<string> = (): Array<string> => {
  const info: Array<string> = [];

  jest.spyOn(logger, "info").mockImplementation(((message: unknown): void => {
    info.push(String(message));
  }) as never);

  return info;
};

describe("NoteTestPagesAcknowledgedBeforeFirstSteps", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(new NoteTestPagesAcknowledgedBeforeFirstSteps().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("runs on a clustered ClickHouse too: it is Postgres only", () => {
    expect(
      new NoteTestPagesAcknowledgedBeforeFirstSteps().runsInClusterMode(),
    ).toBe(true);
  });

  test("is registered once, after the migrations before it and before the last slot", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered.indexOf(MIGRATION_NAME)).toBeGreaterThan(
      registered.indexOf("BackfillNetworkDeviceManufacturer"),
    );
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("hands the work to TestPageAcknowledgementBackfill and says what it did", async () => {
    const result: TestPageAcknowledgementBackfillResult = {
      projects: 420,
      projectsWithTestPages: 12,
      membersNoted: 17,
    };

    const backfill: SpyInstance<
      typeof TestPageAcknowledgementBackfill.backfill
    > = jest
      .spyOn(TestPageAcknowledgementBackfill, "backfill")
      .mockResolvedValue(result);
    const info: Array<string> = captureInfo();

    await new NoteTestPagesAcknowledgedBeforeFirstSteps().migrate();

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(info).toEqual([
      "NoteTestPagesAcknowledgedBeforeFirstSteps: read 420 project(s); 12 had a test page acknowledged, and 17 member(s) are noted now.",
    ]);
  });

  test("with nothing to note it says so", async () => {
    jest.spyOn(TestPageAcknowledgementBackfill, "backfill").mockResolvedValue({
      projects: 3,
      projectsWithTestPages: 0,
      membersNoted: 0,
    });
    const info: Array<string> = captureInfo();

    await new NoteTestPagesAcknowledgedBeforeFirstSteps().migrate();

    expect(info).toEqual([
      "NoteTestPagesAcknowledgedBeforeFirstSteps: read 3 project(s); 0 had a test page acknowledged, and 0 member(s) are noted now.",
    ]);
  });

  test("a failure is the runner's to see: it is not swallowed, so the migration runs again", async () => {
    jest
      .spyOn(TestPageAcknowledgementBackfill, "backfill")
      .mockRejectedValue(new Error("statement timeout"));

    await expect(
      new NoteTestPagesAcknowledgedBeforeFirstSteps().migrate(),
    ).rejects.toThrow("statement timeout");
  });

  test("rolling it back undoes nothing", async () => {
    await expect(
      new NoteTestPagesAcknowledgedBeforeFirstSteps().rollback(),
    ).resolves.toBeUndefined();
  });
});
