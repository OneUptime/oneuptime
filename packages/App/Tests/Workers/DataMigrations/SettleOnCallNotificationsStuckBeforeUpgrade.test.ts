import logger from "Common/Server/Utils/Logger";
import {
  NotificationsSettledBeforeTheCheckSummary,
  settleNotificationsStuckBeforeTheCheck,
} from "Common/Server/Utils/OnCall/OnCallStuckNotifications";
import SettleOnCallNotificationsStuckBeforeUpgrade from "../../../FeatureSet/Workers/DataMigrations/SettleOnCallNotificationsStuckBeforeUpgrade";
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

jest.mock("Common/Server/Utils/OnCall/OnCallStuckNotifications", () => {
  return {
    __esModule: true,
    settleNotificationsStuckBeforeTheCheck: jest.fn(),
  };
});

/*
 * SettleOnCallNotificationsStuckBeforeUpgrade settles, once, every on-call
 * notification left at Sending from before the stuck check existed - longer
 * ago than the day the check reads - as the check would (issue #7085).
 *
 * Pinned here:
 *   1. it is registered in DataMigrations/Index.ts (as text - an
 *      unregistered migration never runs), once, before the slot
 *      AddAuditLogMcpClientColumns keeps last;
 *   2. it settles them through settleNotificationsStuckBeforeTheCheck, as
 *      of the time it runs, and says how many it settled;
 *   3. a failure is the runner's: it throws, and is tried again;
 *   4. rollback changes nothing.
 *
 * What settleNotificationsStuckBeforeTheCheck reads and writes is pinned in
 * Common's OnCallStuckNotificationsBeforeTheCheck suite, and against
 * Postgres in OnCallStuckNotificationsPostgres.
 */

const MIGRATION_NAME: string = "SettleOnCallNotificationsStuckBeforeUpgrade";

const DATA_MIGRATIONS_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Workers/DataMigrations",
);

const REGISTERED_MIGRATION: RegExp = /new ([A-Za-z0-9]+)\(\)/g;

/*
 * The source without its block comments, which may name a migration without
 * registering it. Read with indexOf, in time linear in the source.
 */
function withoutBlockComments(source: string): string {
  let kept: string = "";
  let from: number = 0;

  for (;;) {
    const start: number = source.indexOf("/*", from);

    if (start === -1) {
      return kept + source.slice(from);
    }

    const end: number = source.indexOf("*/", start + 2);

    if (end === -1) {
      return kept + source.slice(from, start);
    }

    kept += `${source.slice(from, start)} `;
    from = end + 2;
  }
}

type Settle = typeof settleNotificationsStuckBeforeTheCheck;

const settle: Mock<Settle> =
  settleNotificationsStuckBeforeTheCheck as unknown as Mock<Settle>;

describe("SettleOnCallNotificationsStuckBeforeUpgrade", () => {
  let infoLogs: Array<string>;
  let info: SpyInstance<typeof logger.info>;

  beforeEach(() => {
    infoLogs = [];

    settle.mockReset();
    settle.mockResolvedValue({ found: 0, settled: 0, statements: 1 });

    info = jest
      .spyOn(logger, "info")
      .mockImplementation((message: unknown): void => {
        infoLogs.push(String(message));
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("is named for itself: the name the runner records it as run under", () => {
    expect(new SettleOnCallNotificationsStuckBeforeUpgrade().name).toBe(
      MIGRATION_NAME,
    );
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
      withoutBlockComments(index).matchAll(REGISTERED_MIGRATION),
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

  test("runs on every deployment: a Postgres migration, nothing of ClickHouse in it", () => {
    expect(
      new SettleOnCallNotificationsStuckBeforeUpgrade().runsInClusterMode(),
    ).toBe(true);
  });

  test("settles them once, as of the time it runs - no time of its own - and says how many", async () => {
    const summary: NotificationsSettledBeforeTheCheckSummary = {
      found: 2412,
      settled: 2410,
      statements: 3,
    };
    settle.mockResolvedValue(summary);

    await new SettleOnCallNotificationsStuckBeforeUpgrade().migrate();

    expect(settle).toHaveBeenCalledTimes(1);
    expect(settle.mock.calls[0]).toEqual([]);
    expect(infoLogs).toContain(
      "SettleOnCallNotificationsStuckBeforeUpgrade: 2410 on-call notification(s) left Sending before the upgrade settled as not sent, in 3 statement(s).",
    );
  });

  test("none to settle: says so, and is done", async () => {
    await expect(
      new SettleOnCallNotificationsStuckBeforeUpgrade().migrate(),
    ).resolves.toBeUndefined();

    expect(infoLogs).toContain(
      "SettleOnCallNotificationsStuckBeforeUpgrade: 0 on-call notification(s) left Sending before the upgrade settled as not sent, in 1 statement(s).",
    );
  });

  test("a failure throws, for the runner to record and try again - nothing claims it ran", async () => {
    settle.mockRejectedValue(new Error("connection terminated"));

    await expect(
      new SettleOnCallNotificationsStuckBeforeUpgrade().migrate(),
    ).rejects.toThrow("connection terminated");
    expect(info).not.toHaveBeenCalled();
  });

  test("rollback changes nothing: Sending was never true of them", async () => {
    await expect(
      new SettleOnCallNotificationsStuckBeforeUpgrade().rollback(),
    ).resolves.toBeUndefined();

    expect(settle).not.toHaveBeenCalled();
  });
});
