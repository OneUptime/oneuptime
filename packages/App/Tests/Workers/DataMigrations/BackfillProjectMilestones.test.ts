import ProjectMilestoneBackfill, {
  ProjectMilestoneBackfillResult,
} from "Common/Server/Utils/Activation/ProjectMilestoneBackfill";
import logger from "Common/Server/Utils/Logger";
import ActivationMilestone from "Common/Types/Analytics/ActivationMilestone";
import BackfillProjectMilestones from "../../../FeatureSet/Workers/DataMigrations/BackfillProjectMilestones";
import fs from "fs";
import path from "path";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The one-off backfill of activation milestones (issue #6830) as the
 * workers run it: registered once, after nothing it depends on and before
 * the slot AddAuditLogMcpClientColumns keeps last; named after itself, so
 * it runs once; it hands the work to ProjectMilestoneBackfill (whose
 * statements Common's ProjectMilestonePostgres suite runs on a real
 * Postgres) and says what it kept.
 */

const MIGRATION_NAME: string = "BackfillProjectMilestones";

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

describe("BackfillProjectMilestones", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named after itself, so it runs once", () => {
    expect(new BackfillProjectMilestones().name).toBe(MIGRATION_NAME);
  });

  test("is registered once, before the slot AddAuditLogMcpClientColumns keeps last", () => {
    const registered: Array<string> = registeredMigrations();

    expect(
      registered.filter((name: string): boolean => {
        return name === MIGRATION_NAME;
      }),
    ).toHaveLength(1);
    expect(registered[registered.length - 1]).toBe(
      "AddAuditLogMcpClientColumns",
    );
  });

  test("hands the work to ProjectMilestoneBackfill and says what it kept", async () => {
    const result: ProjectMilestoneBackfillResult = {
      projects: 42,
      keptByMilestone: {
        [ActivationMilestone.FirstMonitorCreated]: 30,
        [ActivationMilestone.SecondMemberJoined]: 0,
        [ActivationMilestone.FirstCheckResultReceived]: 25,
      },
    };

    const backfill: jest.SpiedFunction<typeof ProjectMilestoneBackfill.backfill> =
      jest.spyOn(ProjectMilestoneBackfill, "backfill").mockResolvedValue(result);
    const info: Array<string> = [];

    jest.spyOn(logger, "info").mockImplementation(((message: unknown): void => {
      info.push(String(message));
    }) as never);

    await new BackfillProjectMilestones().migrate();

    expect(backfill).toHaveBeenCalledTimes(1);
    expect(info).toEqual([
      "BackfillProjectMilestones: read 42 project(s) and kept 30 first_monitor_created, 25 first_check_result_received.",
    ]);
  });

  test("with nothing to keep it says so", async () => {
    jest
      .spyOn(ProjectMilestoneBackfill, "backfill")
      .mockResolvedValue({ projects: 0, keptByMilestone: {} });
    const info: Array<string> = [];

    jest.spyOn(logger, "info").mockImplementation(((message: unknown): void => {
      info.push(String(message));
    }) as never);

    await new BackfillProjectMilestones().migrate();

    expect(info).toEqual([
      "BackfillProjectMilestones: read 0 project(s) and kept no milestones.",
    ]);
  });

  test("a failure is the runner's to see: it is not swallowed, so the migration runs again", async () => {
    jest
      .spyOn(ProjectMilestoneBackfill, "backfill")
      .mockRejectedValue(new Error("statement timeout"));

    await expect(new BackfillProjectMilestones().migrate()).rejects.toThrow(
      "statement timeout",
    );
  });

  test("rolling it back undoes nothing", async () => {
    await expect(
      new BackfillProjectMilestones().rollback(),
    ).resolves.toBeUndefined();
  });
});
