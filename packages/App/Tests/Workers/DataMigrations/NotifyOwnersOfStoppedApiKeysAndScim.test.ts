import logger from "Common/Server/Utils/Logger";
import PlanDowngradeOwnerNotice from "Common/Server/Utils/Billing/PlanDowngradeOwnerNotice";
import NotifyOwnersOfStoppedApiKeysAndScim from "../../../FeatureSet/Workers/DataMigrations/NotifyOwnersOfStoppedApiKeysAndScim";
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
 * NotifyOwnersOfStoppedApiKeysAndScim emails, once, the owners of the
 * projects that were already below the plans their API keys (Growth) and
 * SCIM connections (Scale) need when that cut-off shipped - what stopped,
 * and how to turn it back on. Who is told, only once, and that billing off
 * sends nothing, is PlanDowngradeOwnerNotice's
 * (notifyProjectsAlreadyBelowPlan), held by its Common suite and, on real
 * rows, by PlanCutoffNoticePostgres.
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an unregistered
 *      migration never runs), once, before the slot AddAuditLogMcpClientColumns
 *      keeps last;
 *   2. it runs the notice once and says what it did;
 *   3. a failure to read the projects at all is not swallowed: the runner
 *      stops the chain and the migration runs again - safe, since nobody is
 *      told twice;
 *   4. rollback sends nothing, and takes back nothing it cannot.
 */

const MIGRATION_NAME: string = "NotifyOwnersOfStoppedApiKeysAndScim";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

describe("NotifyOwnersOfStoppedApiKeysAndScim", () => {
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
    expect(new NotifyOwnersOfStoppedApiKeysAndScim().name).toBe(
      MIGRATION_NAME,
    );
  });

  test("runs the one-time notice once and says what it did", async () => {
    const notice: SpyInstance<
      typeof PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan
    > = jest
      .spyOn(PlanDowngradeOwnerNotice, "notifyProjectsAlreadyBelowPlan")
      .mockResolvedValue({
        projects: 13,
        told: 7,
        alreadyTold: 2,
        nothingStopped: 1,
        noPlan: 1,
        noOwners: 1,
        failed: 1,
      });

    await new NotifyOwnersOfStoppedApiKeysAndScim().migrate();

    expect(notice).toHaveBeenCalledTimes(1);

    const log: string = infoLogs.join("\n");

    expect(log).toContain("13 project(s) with API keys or SCIM connections");
    expect(log).toContain("owners told for 7");
    expect(log).toContain("already told for 2");
    expect(log).toContain("nothing stopped for 1");
    expect(log).toContain("no plan for 1");
    expect(log).toContain("no owners for 1");
    expect(log).toContain("could not be told for 1");
  });

  test("a failure to read the projects stops the chain rather than being swallowed", async () => {
    jest
      .spyOn(PlanDowngradeOwnerNotice, "notifyProjectsAlreadyBelowPlan")
      .mockRejectedValue(new Error("db down"));

    await expect(
      new NotifyOwnersOfStoppedApiKeysAndScim().migrate(),
    ).rejects.toThrow("db down");
  });

  test("rollback sends nothing", async () => {
    const notice: SpyInstance<
      typeof PlanDowngradeOwnerNotice.notifyProjectsAlreadyBelowPlan
    > = jest.spyOn(PlanDowngradeOwnerNotice, "notifyProjectsAlreadyBelowPlan");

    await new NotifyOwnersOfStoppedApiKeysAndScim().rollback();

    expect(notice).not.toHaveBeenCalled();
  });

  test("runs in every deployment, a clustered ClickHouse included: it reads and writes Postgres only", () => {
    expect(new NotifyOwnersOfStoppedApiKeysAndScim().runsInClusterMode()).toBe(
      true,
    );
  });
});
