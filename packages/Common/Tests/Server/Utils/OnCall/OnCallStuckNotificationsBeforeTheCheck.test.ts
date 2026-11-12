import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * NOTIFICATIONS LEFT SENDING BEFORE THE CHECK EXISTED (issue #7085).
 *
 * The stuck check reads the last 24 hours only, so a notification left
 * Sending longer ago than that - on a server that ran before the check
 * existed - said Sending for ever. settleNotificationsStuckBeforeTheCheck,
 * run once by the data migration SettleOnCallNotificationsStuckBeforeUpgrade,
 * settles each as the check would - Error, with its verdict - straight to
 * the table, in statements of MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT,
 * the oldest first, to the last.
 *
 * Here the table is rows held in memory, and the statement is read as the
 * statement says: the page of rows still Sending, not deleted, written
 * before the cut-off, oldest first, at most the limit; then each of them
 * that still says Sending as it is written - one that moved on meanwhile
 * stays - with its version moved on. What Postgres itself does with the
 * statement is pinned in OnCallStuckNotificationsPostgres.test.ts.
 */

jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      getRepository: jest.fn(),
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
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

import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import logger from "../../../../Server/Utils/Logger";
import {
  MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT,
  NotificationsSettledBeforeTheCheckSummary,
  settleNotificationsStuckBeforeTheCheck,
  STUCK_NOTIFICATION_LOOK_BACK_HOURS,
} from "../../../../Server/Utils/OnCall/OnCallStuckNotifications";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import { escapeRegExp } from "../../../../Utils/RegExpEscape";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-11-12T12:00:00.000Z");
const CUT_OFF: Date = new Date(NOW.getTime() - 24 * HOUR);

const TABLE_NAME: string = "UserOnCallLogTimeline";

/*
 * The page's whole condition, its order and its size, as one: a condition
 * that loosens it - another status, the age dropped - reads differently.
 */
const PAGE_CLAUSES_PATTERN: RegExp = new RegExp(
  [
    `WHERE "status" = '${UserNotificationStatus.Sending}' AND "deletedAt" IS NULL AND "createdAt" < $1`,
    'ORDER BY "createdAt" ASC',
    "LIMIT $2",
  ]
    .map(escapeRegExp)
    .join("\\s+"),
);

const getRepository: jest.Mock =
  UserOnCallLogTimelineService.getRepository as unknown as jest.Mock;
const info: jest.Mock = logger.info as jest.Mock;

interface Row {
  id: string;
  status: UserNotificationStatus;
  statusMessage: string;
  version: number;
  createdAt: Date;
  deletedAt?: Date | undefined;
}

interface Statement {
  sql: string;
  parameters: [Date, number, string];
}

let rows: Array<Row>;
let statements: Array<Statement>;
// Runs between a statement's page and its write: a write landing meanwhile.
let meanwhile: Array<(page: Array<Row>) => void>;
// What the count of a page comes back as: Postgres hands COUNT(*) back as text.
let countAs: (count: number) => string | number;

let counter: number;

function addRow(data: {
  status?: UserNotificationStatus | undefined;
  writtenAgo: number;
  deleted?: boolean | undefined;
}): Row {
  counter++;

  const row: Row = {
    id: `0c0c0000-0000-4000-8000-${String(counter).padStart(12, "0")}`,
    status: data.status || UserNotificationStatus.Sending,
    statusMessage: "Sending email.",
    version: 1,
    createdAt: new Date(NOW.getTime() - data.writtenAgo),
    ...(data.deleted ? { deletedAt: new Date(NOW.getTime() - HOUR) } : {}),
  };

  rows.push(row);

  return row;
}

// The statement, as it reads: a page, then a write of what still says Sending.
function runStatement(
  sql: string,
  parameters: [Date, number, string],
): Array<{ found: string | number; settled: string | number }> {
  statements.push({ sql: sql, parameters: parameters });

  const [writtenBefore, limit, statusMessage] = parameters;

  const page: Array<Row> = rows
    .filter((row: Row) => {
      return (
        row.status === UserNotificationStatus.Sending &&
        !row.deletedAt &&
        row.createdAt.getTime() < writtenBefore.getTime()
      );
    })
    .sort((a: Row, b: Row) => {
      return a.createdAt.getTime() - b.createdAt.getTime();
    })
    .slice(0, limit);

  const landing: ((page: Array<Row>) => void) | undefined = meanwhile.shift();

  if (landing) {
    landing(page);
  }

  let settled: number = 0;

  for (const row of page) {
    if (row.status !== UserNotificationStatus.Sending || row.deletedAt) {
      continue;
    }

    row.status = UserNotificationStatus.Error;
    row.statusMessage = statusMessage;
    row.version++;
    settled++;
  }

  return [{ found: countAs(page.length), settled: countAs(settled) }];
}

let query: Mock<(sql: unknown, parameters: unknown) => Promise<unknown>>;

beforeEach(() => {
  jest.clearAllMocks();

  rows = [];
  statements = [];
  meanwhile = [];
  counter = 0;
  countAs = (count: number): string => {
    return String(count);
  };

  query = jest.fn(
    async (sql: unknown, parameters: unknown): Promise<unknown> => {
      return runStatement(sql as string, parameters as [Date, number, string]);
    },
  );

  getRepository.mockReturnValue({
    metadata: { tableName: TABLE_NAME },
    manager: { query: query },
  });
});

async function settle(
  perStatement?: number | undefined,
): Promise<NotificationsSettledBeforeTheCheckSummary> {
  return await settleNotificationsStuckBeforeTheCheck({
    now: NOW,
    ...(perStatement !== undefined ? { perStatement: perStatement } : {}),
  });
}

function settledRows(): Array<Row> {
  return rows.filter((row: Row) => {
    return row.statusMessage === STUCK_NOTIFICATION_STATUS_MESSAGE;
  });
}

describe("what the statement reads and writes", () => {
  test("those written before the check's look-back - 24 hours - the check's verdict, a thousand a statement", async () => {
    await settle();

    expect(STUCK_NOTIFICATION_LOOK_BACK_HOURS).toBe(24);
    expect(MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT).toBe(1000);
    expect(statements).toHaveLength(1);
    expect(statements[0]!.parameters).toEqual([
      CUT_OFF,
      MAX_SETTLED_BEFORE_THE_CHECK_PER_STATEMENT,
      STUCK_NOTIFICATION_STATUS_MESSAGE,
    ]);
  });

  test("the table the service's repository names", async () => {
    getRepository.mockReturnValue({
      metadata: { tableName: "OtherTimelineTable" },
      manager: { query: query },
    });

    await settle();

    expect(statements[0]!.sql).toContain('FROM "OtherTimelineTable"');
    expect(statements[0]!.sql).toContain('UPDATE "OtherTimelineTable"');
    expect(statements[0]!.sql).not.toContain(`"${TABLE_NAME}"`);
  });

  test("Sending and Error as literals - as the partial index names Sending - never as parameters", async () => {
    await settle();

    const sql: string = statements[0]!.sql;

    expect(sql).toContain(`"status" = '${UserNotificationStatus.Sending}'`);
    expect(sql).toContain(`SET "status" = '${UserNotificationStatus.Error}'`);
    expect(sql).toContain(
      `"notification"."status" = '${UserNotificationStatus.Sending}'`,
    );
  });

  test("the page: not deleted, written before the cut-off, the oldest first, at most the limit", async () => {
    await settle();

    const sql: string = statements[0]!.sql;

    expect(sql).toContain('"deletedAt" IS NULL');
    expect(sql).toContain('"createdAt" < $1');
    expect(sql).toContain('ORDER BY "createdAt" ASC');
    expect(sql).toContain("LIMIT $2");
    // And nothing else: no other status, no condition that drops the age.
    expect(sql).toMatch(PAGE_CLAUSES_PATTERN);
  });

  test("the write: over Sending only, in the same statement, its version moved on, its message the verdict", async () => {
    await settle();

    const sql: string = statements[0]!.sql;

    expect(sql).toContain(
      `WHERE "notification"."_id" = "page"."_id" AND "notification"."status" = '${UserNotificationStatus.Sending}' AND "notification"."deletedAt" IS NULL`,
    );
    expect(sql).toContain('"version" = "notification"."version" + 1');
    expect(sql).toContain('"statusMessage" = $3');
    expect(sql).toContain('"updatedAt" = now()');
  });

  test("straight to the table, through the service's repository alone: none of its writes - so none of their hooks - runs", async () => {
    addRow({ writtenAgo: 3 * DAY });

    // The service stands in with its repository alone: a write of its would throw.
    expect(Object.keys(UserOnCallLogTimelineService)).toEqual([
      "getRepository",
    ]);

    await expect(settle()).resolves.toMatchObject({ settled: 1 });
    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledTimes(1);
  });

  test("now, when none is given, is the time it runs", async () => {
    const before: number = Date.now();

    await settleNotificationsStuckBeforeTheCheck();

    const after: number = Date.now();
    const cutOff: number = statements[0]!.parameters[0].getTime();

    expect(cutOff).toBeGreaterThanOrEqual(before - DAY);
    expect(cutOff).toBeLessThanOrEqual(after - DAY);
  });
});

describe("which notifications are settled", () => {
  test("those still Sending written before the cut-off: Error, with the check's verdict, their version moved on", async () => {
    const old: Row = addRow({ writtenAgo: 3 * DAY });
    const justBefore: Row = addRow({ writtenAgo: DAY + MINUTE });

    await settle();

    for (const row of [old, justBefore]) {
      expect(row).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
        version: 2,
      });
    }
  });

  test("those written since the cut-off are left to the stuck check", async () => {
    const recent: Row = addRow({ writtenAgo: 2 * HOUR });
    const atTheCutOff: Row = addRow({ writtenAgo: DAY });

    await settle();

    for (const row of [recent, atTheCutOff]) {
      expect(row).toMatchObject({
        status: UserNotificationStatus.Sending,
        statusMessage: "Sending email.",
        version: 1,
      });
    }
  });

  test.each(
    Object.values(UserNotificationStatus).filter(
      (status: UserNotificationStatus) => {
        return status !== UserNotificationStatus.Sending;
      },
    ),
  )(
    "an old notification already %s stays as it is",
    async (status: UserNotificationStatus) => {
      const row: Row = addRow({ status: status, writtenAgo: 3 * DAY });

      await settle();

      expect(row).toMatchObject({
        status: status,
        statusMessage: "Sending email.",
        version: 1,
      });
    },
  );

  test("a deleted notification is left", async () => {
    const row: Row = addRow({ writtenAgo: 3 * DAY, deleted: true });

    await settle();

    expect(row.status).toBe(UserNotificationStatus.Sending);
  });

  test("one that moves on as it is written - acknowledged at last - stays as it moved", async () => {
    const acknowledged: Row = addRow({ writtenAgo: 3 * DAY });
    const other: Row = addRow({ writtenAgo: 2 * DAY });

    meanwhile.push(() => {
      acknowledged.status = UserNotificationStatus.Acknowledged;
      acknowledged.statusMessage = "Notification Acknowledged";
      acknowledged.version++;
    });

    const summary: NotificationsSettledBeforeTheCheckSummary = await settle();

    expect(acknowledged).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      statusMessage: "Notification Acknowledged",
      version: 2,
    });
    expect(other.status).toBe(UserNotificationStatus.Error);
    expect(summary).toEqual({ found: 2, settled: 1, statements: 1 });
  });
});

describe("statement by statement, to the last", () => {
  test("a backlog is worked off a page at a time, the oldest first, to a page that is not full", async () => {
    const written: Array<Row> = [];

    for (let i: number = 0; i < 5; i++) {
      written.push(addRow({ writtenAgo: (10 - i) * DAY }));
    }

    const order: Array<Array<string>> = [];

    for (let i: number = 0; i < 3; i++) {
      meanwhile.push((page: Array<Row>) => {
        order.push(
          page.map((row: Row) => {
            return row.id;
          }),
        );
      });
    }

    const summary: NotificationsSettledBeforeTheCheckSummary = await settle(2);

    expect(summary).toEqual({ found: 5, settled: 5, statements: 3 });
    expect(order).toEqual([
      [written[0]!.id, written[1]!.id],
      [written[2]!.id, written[3]!.id],
      [written[4]!.id],
    ]);
    expect(settledRows()).toHaveLength(5);
  });

  test("a backlog that fills its last page exactly takes one statement more, which finds none", async () => {
    for (let i: number = 0; i < 4; i++) {
      addRow({ writtenAgo: (10 - i) * DAY });
    }

    await expect(settle(2)).resolves.toEqual({
      found: 4,
      settled: 4,
      statements: 3,
    });
  });

  test("none to settle: one statement", async () => {
    addRow({ writtenAgo: HOUR });

    await expect(settle()).resolves.toEqual({
      found: 0,
      settled: 0,
      statements: 1,
    });
  });

  test("a full page with some moved on meanwhile goes on to the next", async () => {
    const rowsWritten: Array<Row> = [];

    for (let i: number = 0; i < 3; i++) {
      rowsWritten.push(addRow({ writtenAgo: (10 - i) * DAY }));
    }

    meanwhile.push((page: Array<Row>) => {
      page[0]!.status = UserNotificationStatus.Sent;
    });

    const summary: NotificationsSettledBeforeTheCheckSummary = await settle(2);

    expect(summary).toEqual({ found: 3, settled: 2, statements: 2 });
    expect(rowsWritten[0]!.status).toBe(UserNotificationStatus.Sent);
    expect(rowsWritten[1]!.status).toBe(UserNotificationStatus.Error);
    expect(rowsWritten[2]!.status).toBe(UserNotificationStatus.Error);
  });

  test("a full page that settled none - every one moved on as it was written - ends the walk: it can never loop", async () => {
    for (let i: number = 0; i < 4; i++) {
      addRow({ writtenAgo: (10 - i) * DAY });
    }

    meanwhile.push((page: Array<Row>) => {
      for (const row of page) {
        row.status = UserNotificationStatus.Acknowledged;
      }
    });

    await expect(settle(2)).resolves.toEqual({
      found: 2,
      settled: 0,
      statements: 1,
    });
  });

  test("a statement that answers with no row at all is read as none: the walk ends", async () => {
    query.mockResolvedValueOnce([] as never);

    await expect(settle()).resolves.toEqual({
      found: 0,
      settled: 0,
      statements: 1,
    });
  });

  test("counts handed back as numbers are read the same", async () => {
    countAs = (count: number): number => {
      return count;
    };

    for (let i: number = 0; i < 3; i++) {
      addRow({ writtenAgo: (10 - i) * DAY });
    }

    await expect(settle(2)).resolves.toEqual({
      found: 3,
      settled: 3,
      statements: 2,
    });
  });

  test("run again, it finds none: settled once", async () => {
    for (let i: number = 0; i < 3; i++) {
      addRow({ writtenAgo: (10 - i) * DAY });
    }

    await settle();
    statements = [];

    await expect(settle()).resolves.toEqual({
      found: 0,
      settled: 0,
      statements: 1,
    });
    expect(settledRows()).toHaveLength(3);
    expect(
      rows.map((row: Row) => {
        return row.version;
      }),
    ).toEqual([2, 2, 2]);
  });
});

describe("what it says", () => {
  test("how many it found and settled, logged once", async () => {
    addRow({ writtenAgo: 3 * DAY });
    addRow({ writtenAgo: 2 * DAY, status: UserNotificationStatus.Sent });

    await settle();

    expect(info).toHaveBeenCalledTimes(1);
    expect(info).toHaveBeenCalledWith(
      "On-call notifications left Sending before the stuck check existed: 1 written more than 24 hours ago, 1 settled as not sent.",
    );
  });

  test("a statement that fails throws: the migration that runs it is tried again", async () => {
    query.mockRejectedValueOnce(new Error("connection terminated") as never);

    await expect(settle()).rejects.toThrow("connection terminated");
    expect(info).not.toHaveBeenCalled();
  });
});
