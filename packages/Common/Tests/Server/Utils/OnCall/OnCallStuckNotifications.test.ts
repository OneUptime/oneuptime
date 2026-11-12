import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import OnCallTimelineRows, {
  FindByInput,
  readCreatedAtBetween,
  StoredOnCallNotification,
} from "../../TestingUtils/OnCallTimelineRows";

/*
 * NOTIFICATIONS THAT NEVER GOT A RESULT (issue #6873).
 *
 * A notification whose request to the Notification service got no answer
 * is left Sending for the service's own result - and a service that went
 * down with the request never writes one. Every five minutes the stuck
 * check settles each notification still Sending 15 minutes after it was
 * written, and written within the last 24 hours, as Error: it may not have
 * been sent. Over Sending only, at the version read: an acknowledgement, a
 * result or a report landing meanwhile stays. The oldest first, 500 a run.
 *
 * The notifications are rows held in memory that a read of several finds
 * by status and createdAt window, a read returns with its version, and an
 * update reaches only at the status and version it names
 * (OnCallTimelineRows). The same read against Postgres - its window, its
 * order and limit, deleted rows, the partial index that serves it - is
 * pinned in OnCallStuckNotificationsPostgres.test.ts.
 */

jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: {
      findBy: jest.fn(),
      findOneById: jest.fn(),
      updateOneBy: jest.fn(),
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
  settleStuckNotifications,
  STUCK_NOTIFICATION_CHECK_JOB_NAME,
  STUCK_NOTIFICATION_LOOK_BACK_HOURS,
  StuckNotificationCheckSummary,
} from "../../../../Server/Utils/OnCall/OnCallStuckNotifications";
import {
  recordSendResult,
  STUCK_NOTIFICATION_AFTER_MINUTES,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const NOW: Date = new Date("2026-11-11T12:00:00.000Z");

const find: jest.Mock = UserOnCallLogTimelineService.findBy as jest.Mock;
const read: jest.Mock = UserOnCallLogTimelineService.findOneById as jest.Mock;
const write: jest.Mock = UserOnCallLogTimelineService.updateOneBy as jest.Mock;
const info: jest.Mock = logger.info as jest.Mock;
const logError: jest.Mock = logger.error as jest.Mock;

let timeline: OnCallTimelineRows;
let nextId: number;

// A notification written `ago` milliseconds before NOW.
function written(
  ago: number,
  status: UserNotificationStatus,
  data?: { deleted?: boolean; statusMessage?: string },
): ObjectID {
  nextId++;

  const id: ObjectID = new ObjectID(
    `5c5c0000-0000-4000-8000-${nextId.toString(16).padStart(12, "0")}`,
  );

  timeline.add(id, status, {
    createdAt: new Date(NOW.getTime() - ago),
    statusMessage: data?.statusMessage || `Sending to the person (${ago}).`,
    ...(data?.deleted ? { deletedAt: NOW } : {}),
  });

  return id;
}

function row(id: ObjectID): StoredOnCallNotification {
  return timeline.get(id)!;
}

async function settle(): Promise<StuckNotificationCheckSummary> {
  return await settleStuckNotifications({ now: NOW });
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.restoreAllMocks();

  nextId = 0;
  timeline = new OnCallTimelineRows();
  timeline.standIn(UserOnCallLogTimelineService, { find: true });
});

describe("the check", () => {
  test("is the job UserOnCallLogTimeline:SettleStuckNotifications", () => {
    expect(STUCK_NOTIFICATION_CHECK_JOB_NAME).toBe(
      "UserOnCallLogTimeline:SettleStuckNotifications",
    );
  });

  test("settles after 15 minutes, reads back 24 hours, and settles 500 a run at most", () => {
    expect(STUCK_NOTIFICATION_AFTER_MINUTES).toBe(15);
    expect(STUCK_NOTIFICATION_LOOK_BACK_HOURS).toBe(24);
    expect(MAX_STUCK_NOTIFICATIONS_PER_RUN).toBe(500);
  });
});

describe("what it reads", () => {
  test("the notifications still Sending, written between 24 hours and 15 minutes ago, oldest first, 500 at most, their ids only, as root", async () => {
    await settle();

    expect(find).toHaveBeenCalledTimes(1);

    const input: FindByInput & {
      select: unknown;
      props: unknown;
    } = find.mock.calls[0]![0] as FindByInput & {
      select: unknown;
      props: unknown;
    };

    expect(input.query["status"]).toBe(UserNotificationStatus.Sending);
    expect(readCreatedAtBetween(input.query["createdAt"])).toEqual({
      from: new Date(NOW.getTime() - 24 * HOUR),
      to: new Date(NOW.getTime() - 15 * MINUTE),
    });
    expect(input.select).toEqual({ _id: true });
    expect(input.sort).toEqual({ createdAt: SortOrder.Ascending });
    expect(input.limit).toBe(500);
    expect(input.skip).toBe(0);
    expect(input.props).toEqual({ isRoot: true });
  });

  test("counted from now when no time is given", async () => {
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);

    await settleStuckNotifications();

    expect(
      readCreatedAtBetween(
        (find.mock.calls[0]![0] as FindByInput).query["createdAt"],
      ),
    ).toEqual({
      from: new Date(NOW.getTime() - 24 * HOUR),
      to: new Date(NOW.getTime() - 15 * MINUTE),
    });
  });
});

describe("what it settles", () => {
  test("only a notification still Sending past 15 minutes and within 24 hours: Error, saying it may not have been sent", async () => {
    const stuck: ObjectID = written(
      16 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const atTheLimit: ObjectID = written(
      15 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const almostADay: ObjectID = written(
      24 * HOUR - MINUTE,
      UserNotificationStatus.Sending,
    );
    const stillGoingOut: ObjectID = written(
      14 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const justWritten: ObjectID = written(0, UserNotificationStatus.Sending);
    const olderThanADay: ObjectID = written(
      24 * HOUR + MINUTE,
      UserNotificationStatus.Sending,
    );
    const deleted: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
      {
        deleted: true,
      },
    );

    const summary: StuckNotificationCheckSummary = await settle();

    for (const id of [stuck, atTheLimit, almostADay]) {
      expect(row(id)).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      });
    }

    for (const id of [stillGoingOut, justWritten, olderThanADay, deleted]) {
      expect(row(id).status).toBe(UserNotificationStatus.Sending);
    }

    expect(summary).toEqual({ found: 3, settled: 3, movedOn: 0, failed: 0 });
  });

  test.each(
    Object.values(UserNotificationStatus).filter(
      (status: UserNotificationStatus) => {
        return status !== UserNotificationStatus.Sending;
      },
    ),
  )(
    "a notification %s an hour ago stays as it is",
    async (status: UserNotificationStatus) => {
      const settled: ObjectID = written(HOUR, status, {
        statusMessage: "written by somebody who knew",
      });

      const summary: StuckNotificationCheckSummary = await settle();

      expect(row(settled)).toMatchObject({
        status: status,
        statusMessage: "written by somebody who knew",
      });
      expect(write).not.toHaveBeenCalled();
      expect(summary.found).toBe(0);
    },
  );

  test("each is written at the status and version read, as root", async () => {
    const stuck: ObjectID = written(
      16 * MINUTE,
      UserNotificationStatus.Sending,
    );

    await settle();

    expect(read).toHaveBeenCalledWith({
      id: stuck,
      select: { _id: true, status: true, version: true },
      props: { isRoot: true },
    });
    expect(write).toHaveBeenCalledWith({
      query: {
        _id: stuck.toString(),
        status: UserNotificationStatus.Sending,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      },
      props: { isRoot: true },
    });
  });

  test("the oldest first, 500 a run: the rest wait for the next run", async () => {
    const ids: Array<ObjectID> = [];

    // 502 notifications, written 16 to 517 minutes ago, the oldest last.
    for (let i: number = 0; i < 502; i++) {
      ids.push(written((16 + i) * MINUTE, UserNotificationStatus.Sending));
    }

    const firstRun: StuckNotificationCheckSummary = await settle();

    expect(firstRun).toEqual({
      found: 500,
      settled: 500,
      movedOn: 0,
      failed: 0,
    });
    // The two written last - the youngest - are left for the next run.
    expect(row(ids[0]!).status).toBe(UserNotificationStatus.Sending);
    expect(row(ids[1]!).status).toBe(UserNotificationStatus.Sending);
    expect(row(ids[2]!).status).toBe(UserNotificationStatus.Error);
    expect(row(ids[501]!).status).toBe(UserNotificationStatus.Error);

    const secondRun: StuckNotificationCheckSummary = await settle();

    expect(secondRun).toEqual({ found: 2, settled: 2, movedOn: 0, failed: 0 });
    expect(row(ids[0]!).status).toBe(UserNotificationStatus.Error);
  });

  test("nothing stuck: nothing read or written, nothing said", async () => {
    written(5 * MINUTE, UserNotificationStatus.Sending);

    const summary: StuckNotificationCheckSummary = await settle();

    expect(summary).toEqual({ found: 0, settled: 0, movedOn: 0, failed: 0 });
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
    expect(info).not.toHaveBeenCalled();
  });

  test("what it did is logged for whoever runs the deployment", async () => {
    written(16 * MINUTE, UserNotificationStatus.Sending);

    await settle();

    expect(info).toHaveBeenCalledWith(
      "Stuck on-call notifications: 1 still Sending after 15 minutes, 1 settled as not sent, 0 moved on meanwhile, 0 failed.",
    );
  });
});

describe("something that lands first", () => {
  test("an acknowledgement between the read of all and the read of one: left, and counted as moved on", async () => {
    const stuck: ObjectID = written(
      16 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const other: ObjectID = written(
      17 * MINUTE,
      UserNotificationStatus.Sending,
    );

    find.mockImplementationOnce(((input: FindByInput) => {
      const found: unknown = timeline.find(input);
      row(stuck).status = UserNotificationStatus.Acknowledged;
      row(stuck).version++;
      return Promise.resolve(found);
    }) as never);

    const summary: StuckNotificationCheckSummary = await settle();

    expect(row(stuck).status).toBe(UserNotificationStatus.Acknowledged);
    expect(row(other).status).toBe(UserNotificationStatus.Error);
    expect(summary).toEqual({ found: 2, settled: 1, movedOn: 1, failed: 0 });
  });

  test.each([
    [UserNotificationStatus.Acknowledged, "Notification Acknowledged"],
    [UserNotificationStatus.Sent, "Message ID: SM1"],
    [UserNotificationStatus.NotAnswered, "The call was not answered."],
    [UserNotificationStatus.Error, "Delivery status: Undelivered."],
  ])(
    "%s landing between the read of the notification and its write stays",
    async (status: UserNotificationStatus, statusMessage: string) => {
      const stuck: ObjectID = written(
        16 * MINUTE,
        UserNotificationStatus.Sending,
      );

      timeline.whenRead((stored: StoredOnCallNotification) => {
        stored.status = status;
        stored.statusMessage = statusMessage;
      });

      const summary: StuckNotificationCheckSummary = await settle();

      expect(row(stuck)).toMatchObject({
        status: status,
        statusMessage: statusMessage,
      });
      expect(summary).toEqual({ found: 1, settled: 0, movedOn: 1, failed: 0 });
    },
  );

  test("a send that finishes after the verdict writes its result over it", async () => {
    const stuck: ObjectID = written(
      16 * MINUTE,
      UserNotificationStatus.Sending,
    );

    await settle();

    expect(row(stuck).status).toBe(UserNotificationStatus.Error);

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: stuck,
        isSent: true,
        statusMessage: "Call ID: CA1",
      }),
    ).resolves.toBe(true);

    expect(row(stuck)).toMatchObject({
      status: UserNotificationStatus.Sent,
      statusMessage: "Call ID: CA1",
    });
  });
});

describe("a database that fails", () => {
  test("one notification that cannot be written is logged and tried by the next run; the rest are settled", async () => {
    const failing: ObjectID = written(
      18 * MINUTE,
      UserNotificationStatus.Sending,
    );
    const other: ObjectID = written(
      16 * MINUTE,
      UserNotificationStatus.Sending,
    );

    write.mockImplementationOnce((() => {
      return Promise.reject(new Error("deadlock detected"));
    }) as never);

    const summary: StuckNotificationCheckSummary = await settle();

    expect(summary).toEqual({ found: 2, settled: 1, movedOn: 0, failed: 1 });
    expect(row(failing).status).toBe(UserNotificationStatus.Sending);
    expect(row(other).status).toBe(UserNotificationStatus.Error);

    expect(logError).toHaveBeenCalledTimes(1);
    expect(String(logError.mock.calls[0]![0])).toContain(failing.toString());
    expect(String(logError.mock.calls[0]![0])).toContain("deadlock detected");

    const nextRun: StuckNotificationCheckSummary = await settle();

    expect(nextRun.settled).toBe(1);
    expect(row(failing).status).toBe(UserNotificationStatus.Error);
  });

  test("the read of all that fails throws: the run fails, as a job", async () => {
    find.mockImplementationOnce((() => {
      return Promise.reject(new Error("connection terminated"));
    }) as never);

    await expect(settle()).rejects.toThrow("connection terminated");
    expect(write).not.toHaveBeenCalled();
  });

  test("a notification read back with no id is passed over", async () => {
    const stuck: ObjectID = written(
      16 * MINUTE,
      UserNotificationStatus.Sending,
    );

    find.mockImplementationOnce(((input: FindByInput) => {
      return Promise.resolve([{}, ...timeline.find(input)]);
    }) as never);

    const summary: StuckNotificationCheckSummary = await settle();

    expect(summary).toEqual({ found: 2, settled: 1, movedOn: 0, failed: 0 });
    expect(row(stuck).status).toBe(UserNotificationStatus.Error);
  });
});
