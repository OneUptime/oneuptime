import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
import OnCallTimelineRows, {
  FindByInput,
  readCreatedAtBetween,
  StoredOnCallNotification,
} from "../../TestingUtils/OnCallTimelineRows";

/*
 * ONE RUN OF THE STUCK CHECK (issue #7290).
 *
 * The check settles a notification still Sending 15 minutes after it was
 * written, but reads only those written in the last 24 hours. One that was
 * written while the check could not run - the workers down for more than a
 * day, the job queue stalled, a long maintenance window - left that window
 * before the check saw it, and said Sending for ever: the data migration
 * that settled the older ones (#7085) had run already. So each run of the
 * check (runStuckNotificationCheck, run every five minutes by the worker
 * job SettleStuckNotifications) now also settles those written before its
 * window, straight to the table (settleNotificationsStuckBeforeTheCheck),
 * with the check's own verdict, as of the same time.
 *
 * The table is rows held in memory (OnCallTimelineRows): the check's read
 * and its writes at the status and version read, and the statement that
 * settles the older ones as the statement says. What Postgres does with the
 * same run is pinned in OnCallStuckNotificationsPostgres.test.ts.
 */

jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneBy: jest.fn(),
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
  MAX_STUCK_NOTIFICATIONS_PER_RUN,
  runStuckNotificationCheck,
  StuckNotificationCheckRunSummary,
} from "../../../../Server/Utils/OnCall/OnCallStuckNotifications";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const NOW: Date = new Date("2026-11-13T09:00:00.000Z");

type AnyFunction = (...args: Array<unknown>) => unknown;

const find: Mock<AnyFunction> =
  UserOnCallLogTimelineService.findBy as unknown as Mock<AnyFunction>;
const write: Mock<AnyFunction> =
  UserOnCallLogTimelineService.updateOneBy as unknown as Mock<AnyFunction>;
const getRepository: Mock<AnyFunction> =
  UserOnCallLogTimelineService.getRepository as unknown as Mock<AnyFunction>;
const info: Mock<AnyFunction> = logger.info as unknown as Mock<AnyFunction>;
const logError: Mock<AnyFunction> =
  logger.error as unknown as Mock<AnyFunction>;

const WRITTEN_MESSAGE: string = "Sending SMS to +15550100.";

let timeline: OnCallTimelineRows;
let nextId: number;

// A notification written `ago` milliseconds before `at` (NOW when left out).
function written(
  ago: number,
  status: UserNotificationStatus,
  data?: { deleted?: boolean; at?: Date; statusMessage?: string },
): ObjectID {
  nextId++;

  const id: ObjectID = new ObjectID(
    `7290aaaa-0000-4000-8000-${nextId.toString(16).padStart(12, "0")}`,
  );
  const at: Date = data?.at || NOW;

  timeline.add(id, status, {
    createdAt: new Date(at.getTime() - ago),
    statusMessage: data?.statusMessage || WRITTEN_MESSAGE,
    ...(data?.deleted ? { deletedAt: at } : {}),
  });

  return id;
}

function row(id: ObjectID): StoredOnCallNotification {
  return timeline.get(id)!;
}

async function run(at?: Date): Promise<StuckNotificationCheckRunSummary> {
  return await runStuckNotificationCheck({ now: at || NOW });
}

// The ids every write landed on, in order: the check's and the statement's.
function writtenIds(): Array<string> {
  return timeline.writes.map((landed: { id: string }) => {
    return landed.id;
  });
}

const SETTLED_AS_STUCK: Partial<StoredOnCallNotification> = {
  status: UserNotificationStatus.Error,
  statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  nextId = 0;
  timeline = new OnCallTimelineRows();
  timeline.standIn(UserOnCallLogTimelineService, {
    find: true,
    settleStatement: true,
  });
});

describe("one run settles a notification still Sending, however long ago it was written", () => {
  test("one written 25 hours ago - the workers were down a day - as well as one written 20 minutes ago", async () => {
    const leftByTheWorkers: ObjectID = written(
      25 * HOUR,
      UserNotificationStatus.Sending,
    );
    const stuckJustNow: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );

    const summary: StuckNotificationCheckRunSummary = await run();

    expect(row(leftByTheWorkers)).toMatchObject({
      ...SETTLED_AS_STUCK,
      version: 2,
    });
    expect(row(stuckJustNow)).toMatchObject({
      ...SETTLED_AS_STUCK,
      version: 2,
    });

    expect(summary).toEqual({
      withinTheLookBack: { found: 1, settled: 1, movedOn: 0, failed: 0 },
      beforeTheLookBack: { found: 1, settled: 1, statements: 1 },
    });
  });

  test("the one from the last day through the check's own write - its hooks tell the feed and the chat message - the older straight to the table", async () => {
    const leftByTheWorkers: ObjectID = written(
      25 * HOUR,
      UserNotificationStatus.Sending,
    );
    const stuckJustNow: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );

    await run();

    // The check writes through the service, at the status and version read.
    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith({
      query: {
        _id: stuckJustNow.toString(),
        status: UserNotificationStatus.Sending,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      },
      props: { isRoot: true },
    });

    // The older one by the statement alone, with the check's own words.
    expect(timeline.settleStatements).toHaveLength(1);
    expect(timeline.settleStatements[0]!.parameters).toEqual([
      new Date(NOW.getTime() - DAY),
      1000,
      STUCK_NOTIFICATION_STATUS_MESSAGE,
    ]);
    expect(writtenIds()).toEqual([
      stuckJustNow.toString(),
      leftByTheWorkers.toString(),
    ]);
  });

  test("days and weeks ago too: nothing says Sending for ever", async () => {
    const ids: Array<ObjectID> = [2 * DAY, 9 * DAY, 90 * DAY].map(
      (ago: number) => {
        return written(ago, UserNotificationStatus.Sending);
      },
    );

    await run();

    for (const id of ids) {
      expect(row(id)).toMatchObject(SETTLED_AS_STUCK);
    }
  });

  test("leaves Sent, Acknowledged and deleted notifications alone, whenever they were written, and one still going out", async () => {
    const leftAlone: Array<[ObjectID, StoredOnCallNotification]> = [];

    for (const ago of [25 * HOUR, 20 * MINUTE]) {
      for (const status of [
        UserNotificationStatus.Sent,
        UserNotificationStatus.Acknowledged,
      ]) {
        const id: ObjectID = written(ago, status, {
          statusMessage: `${status}, written by somebody who knew.`,
        });
        leftAlone.push([id, { ...row(id) }]);
      }

      const deleted: ObjectID = written(ago, UserNotificationStatus.Sending, {
        deleted: true,
      });
      leftAlone.push([deleted, { ...row(deleted) }]);
    }

    const stillGoingOut: ObjectID = written(
      10 * MINUTE,
      UserNotificationStatus.Sending,
    );
    leftAlone.push([stillGoingOut, { ...row(stillGoingOut) }]);

    const summary: StuckNotificationCheckRunSummary = await run();

    for (const [id, before] of leftAlone) {
      expect(row(id)).toEqual(before);
    }

    expect(timeline.writes).toEqual([]);
    expect(summary).toEqual({
      withinTheLookBack: { found: 0, settled: 0, movedOn: 0, failed: 0 },
      beforeTheLookBack: { found: 0, settled: 0, statements: 1 },
    });
  });

  test.each(
    Object.values(UserNotificationStatus).filter(
      (status: UserNotificationStatus) => {
        return status !== UserNotificationStatus.Sending;
      },
    ),
  )(
    "a notification %s 25 hours ago stays as it is",
    async (status: UserNotificationStatus) => {
      const id: ObjectID = written(25 * HOUR, status, {
        statusMessage: "written by somebody who knew",
      });

      await run();

      expect(row(id)).toMatchObject({
        status: status,
        statusMessage: "written by somebody who knew",
        version: 1,
      });
    },
  );
});

describe("a run with nothing written before the look-back", () => {
  test("writes nothing there: one statement, which finds none", async () => {
    const stuckJustNow: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );
    written(25 * HOUR, UserNotificationStatus.Sent);
    written(3 * DAY, UserNotificationStatus.Acknowledged);
    written(25 * HOUR, UserNotificationStatus.Sending, { deleted: true });

    const summary: StuckNotificationCheckRunSummary = await run();

    expect(summary.beforeTheLookBack).toEqual({
      found: 0,
      settled: 0,
      statements: 1,
    });
    expect(timeline.settleStatements).toHaveLength(1);
    // The check's own write is the only one.
    expect(writtenIds()).toEqual([stuckJustNow.toString()]);
  });

  test("with no notification at all: one read, one statement, no write, nothing said", async () => {
    const summary: StuckNotificationCheckRunSummary = await run();

    expect(find).toHaveBeenCalledTimes(1);
    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(timeline.settleStatements).toHaveLength(1);
    expect(write).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
    expect(info).not.toHaveBeenCalled();
    expect(logError).not.toHaveBeenCalled();
    expect(summary).toEqual({
      withinTheLookBack: { found: 0, settled: 0, movedOn: 0, failed: 0 },
      beforeTheLookBack: { found: 0, settled: 0, statements: 1 },
    });
  });

  test("run again after a run that settled them, it finds none: each is settled once", async () => {
    const old: ObjectID = written(25 * HOUR, UserNotificationStatus.Sending);
    const recent: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );

    await run();

    const second: StuckNotificationCheckRunSummary = await run(
      new Date(NOW.getTime() + 5 * MINUTE),
    );

    expect(second).toEqual({
      withinTheLookBack: { found: 0, settled: 0, movedOn: 0, failed: 0 },
      beforeTheLookBack: { found: 0, settled: 0, statements: 1 },
    });
    expect(row(old).version).toBe(2);
    expect(row(recent).version).toBe(2);
    expect(timeline.writes).toHaveLength(2);
  });
});

describe("the two parts of a run meet where the look-back starts", () => {
  test("as of the same time: the statement's cut-off is where the check's read starts", async () => {
    await run();

    const window: { from: Date; to: Date } = readCreatedAtBetween(
      (find.mock.calls[0]![0] as FindByInput).query["createdAt"],
    );

    expect(window).toEqual({
      from: new Date(NOW.getTime() - DAY),
      to: new Date(NOW.getTime() - 15 * MINUTE),
    });
    expect(timeline.settleStatements[0]!.parameters[0]).toEqual(window.from);
  });

  test("one written exactly 24 hours ago is the check's, one a millisecond older the statement's: neither is left", async () => {
    const atTheStart: ObjectID = written(DAY, UserNotificationStatus.Sending);
    const justBefore: ObjectID = written(
      DAY + 1,
      UserNotificationStatus.Sending,
    );

    const summary: StuckNotificationCheckRunSummary = await run();

    expect(row(atTheStart)).toMatchObject(SETTLED_AS_STUCK);
    expect(row(justBefore)).toMatchObject(SETTLED_AS_STUCK);
    expect(summary.withinTheLookBack.settled).toBe(1);
    expect(summary.beforeTheLookBack.settled).toBe(1);
    expect(write).toHaveBeenCalledTimes(1);
    expect(
      (write.mock.calls[0]![0] as { query: { _id: string } }).query._id,
    ).toBe(atTheStart.toString());
  });

  test("now, when none is given, is the time it runs, for both", async () => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    await runStuckNotificationCheck();

    expect(
      readCreatedAtBetween(
        (find.mock.calls[0]![0] as FindByInput).query["createdAt"],
      ).from,
    ).toEqual(new Date(NOW.getTime() - DAY));
    expect(timeline.settleStatements[0]!.parameters[0]).toEqual(
      new Date(NOW.getTime() - DAY),
    );
  });

  test("the check runs first - its pages may still be going on - then the statement", async () => {
    await run();

    expect(find.mock.invocationCallOrder[0]!).toBeLessThan(
      getRepository.mock.invocationCallOrder[0]!,
    );
  });

  test("a backlog the check did not reach before it aged out of the look-back is settled by the next run", async () => {
    const count: number = MAX_STUCK_NOTIFICATIONS_PER_RUN + 1;
    const ids: Array<ObjectID> = [];

    // Written a millisecond apart, 23 hours 58 minutes ago, the oldest first.
    for (let i: number = 0; i < count; i++) {
      ids.push(written(DAY - 2 * MINUTE - i, UserNotificationStatus.Sending));
    }

    const first: StuckNotificationCheckRunSummary = await run();

    expect(first.withinTheLookBack.settled).toBe(
      MAX_STUCK_NOTIFICATIONS_PER_RUN,
    );
    // The newest is left: the check reads the oldest first, 500 a run.
    expect(row(ids[count - 1]!).status).toBe(UserNotificationStatus.Sending);

    // Five minutes on, it is older than the look-back.
    const second: StuckNotificationCheckRunSummary = await run(
      new Date(NOW.getTime() + 5 * MINUTE),
    );

    expect(second).toEqual({
      withinTheLookBack: { found: 0, settled: 0, movedOn: 0, failed: 0 },
      beforeTheLookBack: { found: 1, settled: 1, statements: 1 },
    });
    expect(row(ids[count - 1]!)).toMatchObject(SETTLED_AS_STUCK);

    for (const id of ids) {
      expect(row(id).status).toBe(UserNotificationStatus.Error);
    }
  });
});

describe("one part failing never keeps the other from running", () => {
  test("the check's read fails: the older ones are still settled, the run fails with the check's failure, and says which part failed", async () => {
    const old: ObjectID = written(25 * HOUR, UserNotificationStatus.Sending);
    const recent: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const failure: Error = new Error("canceling statement due to timeout");

    find.mockRejectedValueOnce(failure as never);

    await expect(run()).rejects.toBe(failure);

    expect(row(old)).toMatchObject(SETTLED_AS_STUCK);
    expect(row(recent).status).toBe(UserNotificationStatus.Sending);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "Stuck on-call notifications: could not settle those written in the last 24 hours: Error: canceling statement due to timeout",
    );
  });

  test("the statement fails: the check has settled its own, and the run fails with the statement's failure", async () => {
    const old: ObjectID = written(25 * HOUR, UserNotificationStatus.Sending);
    const recent: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const failure: Error = new Error("connection terminated");

    getRepository.mockReturnValueOnce({
      metadata: { tableName: "UserOnCallLogTimeline" },
      manager: {
        query: (): Promise<never> => {
          return Promise.reject(failure);
        },
      },
    });

    await expect(run()).rejects.toBe(failure);

    expect(row(recent)).toMatchObject(SETTLED_AS_STUCK);
    expect(row(old).status).toBe(UserNotificationStatus.Sending);
    expect(logError).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledWith(
      "Stuck on-call notifications: could not settle those written more than 24 hours ago: Error: connection terminated",
    );
  });

  test("both fail: both are tried and said, and the run fails with the first", async () => {
    const first: Error = new Error("the check's read failed");
    const second: Error = new Error("the statement failed");

    find.mockRejectedValueOnce(first as never);
    getRepository.mockImplementationOnce(() => {
      throw second;
    });

    await expect(run()).rejects.toBe(first);

    expect(getRepository).toHaveBeenCalledTimes(1);
    expect(logError).toHaveBeenCalledTimes(2);
    expect(String(logError.mock.calls[0]![0])).toContain(
      "the check's read failed",
    );
    expect(String(logError.mock.calls[1]![0])).toContain(
      "the statement failed",
    );
  });

  test("the next run, once the table answers again, settles what the failed run could not", async () => {
    const old: ObjectID = written(25 * HOUR, UserNotificationStatus.Sending);
    const recent: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );

    find.mockRejectedValueOnce(new Error("timeout") as never);
    getRepository.mockImplementationOnce(() => {
      throw new Error("timeout");
    });

    await expect(run()).rejects.toThrow("timeout");

    await expect(run(new Date(NOW.getTime() + 5 * MINUTE))).resolves.toEqual({
      withinTheLookBack: { found: 1, settled: 1, movedOn: 0, failed: 0 },
      beforeTheLookBack: { found: 1, settled: 1, statements: 1 },
    });
    expect(row(old)).toMatchObject(SETTLED_AS_STUCK);
    expect(row(recent)).toMatchObject(SETTLED_AS_STUCK);
  });
});

describe("the table held in memory reads the statement as it is sent", () => {
  /*
   * So a statement that no longer says what it settles fails these tests,
   * rather than settling in memory what Postgres would not.
   */
  test.each([
    [
      "its age",
      'SELECT "_id" FROM "UserOnCallLogTimeline" WHERE "status" = \'Sending\' AND "deletedAt" IS NULL ORDER BY "createdAt" ASC LIMIT $2',
    ],
    [
      "Sending in its write",
      'SELECT "_id" FROM "UserOnCallLogTimeline" WHERE "status" = \'Sending\' AND "deletedAt" IS NULL AND "createdAt" < $1 ORDER BY "createdAt" ASC LIMIT $2 UPDATE "UserOnCallLogTimeline" AS "notification" SET "status" = \'Error\', "statusMessage" = $3, "version" = "notification"."version" + 1 WHERE "notification"."_id" = "page"."_id"',
    ],
  ])("one without %s is refused", (_what: string, sql: string) => {
    expect(() => {
      timeline.settleStatement(sql, [NOW, 1000, "x"]);
    }).toThrow("OnCallTimelineRows: a statement it cannot read");
    expect(timeline.settleStatements).toEqual([]);
  });
});

describe("what a run says", () => {
  test("each part says how many it settled, once, only when it found any", async () => {
    written(25 * HOUR, UserNotificationStatus.Sending);
    written(20 * MINUTE, UserNotificationStatus.Sending);

    await run();

    expect(
      info.mock.calls.map((call: Array<unknown>) => {
        return call[0];
      }),
    ).toEqual([
      "Stuck on-call notifications: 1 still Sending after 15 minutes, 1 settled as not sent, 0 moved on meanwhile, 0 failed.",
      "On-call notifications still Sending more than 24 hours after they were written: 1 found, 1 settled as not sent.",
    ]);
  });
});
