import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import ObjectID from "Common/Types/ObjectID";
import UserNotificationStatus from "Common/Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "Common/Tests/Server/TestingUtils/OnCallTimelineRows";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

/*
 * ONE RUN OF THE SettleStuckNotifications JOB, WITH THE REAL CHECK
 * (issue #7290).
 *
 * The job settles the on-call notifications still Sending 15 minutes after
 * their page wrote them. Its check reads only the last day, so a
 * notification written while the workers were down for longer than that
 * left the window before the check could see it, and said Sending for
 * ever. Now one run of the job settles it too.
 *
 * Real RunCron, JobDictionary and OnCallStuckNotifications; the queue is
 * stubbed, and the person's on-call timeline is rows held in memory
 * (Common/Tests/Server/TestingUtils/OnCallTimelineRows): the check's read
 * and its writes at the status and version read, and the statement that
 * settles the older ones, read as it is sent. The job runs on the real
 * clock - it takes none of its own - so each notification is written that
 * long before the run, with minutes to spare on either side.
 */

const mockAddJob: Mock<(...args: Array<unknown>) => Promise<void>> = jest
  .fn<(...args: Array<unknown>) => Promise<void>>()
  .mockResolvedValue(undefined);

jest.mock("Common/Server/Infrastructure/Queue", () => {
  return {
    __esModule: true,
    QueueName: {
      Workflow: "Workflow",
      Worker: "Worker",
      Telemetry: "Telemetry",
      Runbook: "Runbook",
      MarketingEvent: "MarketingEvent",
    },
    default: {
      addJob: mockAddJob,
    },
  };
});

jest.mock("Common/Server/Services/UserOnCallLogTimelineService", () => {
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

jest.mock("Common/Server/Utils/Logger", () => {
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

import UserOnCallLogTimelineService from "Common/Server/Services/UserOnCallLogTimelineService";
import logger from "Common/Server/Utils/Logger";
import { STUCK_NOTIFICATION_STATUS_MESSAGE } from "Common/Server/Utils/OnCall/OnCallNotificationStatus";
import { STUCK_NOTIFICATION_CHECK_JOB_NAME } from "Common/Server/Utils/OnCall/OnCallStuckNotifications";
import JobDictionary from "../../../../FeatureSet/Workers/Utils/JobDictionary";
import "../../../../FeatureSet/Workers/Jobs/UserOnCallLog/SettleStuckNotifications";

const MINUTE: number = 60 * 1000;
const HOUR: number = 60 * MINUTE;

const WRITTEN_MESSAGE: string = "Sending push notification to the phone.";

const write: Mock<(...args: Array<unknown>) => unknown> =
  UserOnCallLogTimelineService.updateOneBy as unknown as Mock<
    (...args: Array<unknown>) => unknown
  >;
const logError: Mock<(...args: Array<unknown>) => unknown> =
  logger.error as unknown as Mock<(...args: Array<unknown>) => unknown>;

let timeline: OnCallTimelineRows;
let nextId: number;

// A notification written `ago` milliseconds before now.
function written(
  ago: number,
  status: UserNotificationStatus,
  data?: { deleted?: boolean; statusMessage?: string },
): ObjectID {
  nextId++;

  const id: ObjectID = new ObjectID(
    `7290bbbb-0000-4000-8000-${nextId.toString(16).padStart(12, "0")}`,
  );
  const now: number = Date.now();

  timeline.add(id, status, {
    createdAt: new Date(now - ago),
    statusMessage: data?.statusMessage || WRITTEN_MESSAGE,
    ...(data?.deleted ? { deletedAt: new Date(now) } : {}),
  });

  return id;
}

function row(id: ObjectID): StoredOnCallNotification {
  return timeline.get(id)!;
}

async function runTheJob(): Promise<void> {
  const jobFunction: PromiseVoidFunction = JobDictionary.getJobFunction(
    STUCK_NOTIFICATION_CHECK_JOB_NAME,
  );

  await jobFunction();
}

beforeEach(() => {
  jest.clearAllMocks();

  nextId = 0;
  timeline = new OnCallTimelineRows();
  timeline.standIn(UserOnCallLogTimelineService, {
    find: true,
    settleStatement: true,
  });
});

describe("one run of the job", () => {
  test("settles a notification still Sending from 25 hours ago - the workers were down a day - as well as one from 20 minutes ago", async () => {
    const leftByTheWorkers: ObjectID = written(
      25 * HOUR,
      UserNotificationStatus.Sending,
    );
    const stuckJustNow: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );

    await runTheJob();

    for (const id of [leftByTheWorkers, stuckJustNow]) {
      expect(row(id)).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
        version: 2,
      });
    }

    // The newer through the check's own write, the older by the statement.
    expect(write).toHaveBeenCalledTimes(1);
    expect(timeline.settleStatements).toHaveLength(1);
    expect(logError).not.toHaveBeenCalled();
  });

  test("leaves Sent, Acknowledged and deleted notifications alone, from 25 hours and 20 minutes ago, and one still going out", async () => {
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
      5 * MINUTE,
      UserNotificationStatus.Sending,
    );
    leftAlone.push([stillGoingOut, { ...row(stillGoingOut) }]);

    await runTheJob();

    for (const [id, before] of leftAlone) {
      expect(row(id)).toEqual(before);
    }

    expect(timeline.writes).toEqual([]);
  });

  test("with nothing older than the check's day writes nothing there: its statement runs once and finds none", async () => {
    const stuckJustNow: ObjectID = written(
      20 * MINUTE,
      UserNotificationStatus.Sending,
    );
    written(25 * HOUR, UserNotificationStatus.Sent);
    written(25 * HOUR, UserNotificationStatus.Acknowledged);

    await runTheJob();

    expect(timeline.settleStatements).toHaveLength(1);
    expect(
      timeline.writes.map((landed: { id: string }) => {
        return landed.id;
      }),
    ).toEqual([stuckJustNow.toString()]);
  });

  test("with no notification at all writes nothing", async () => {
    await runTheJob();

    expect(write).not.toHaveBeenCalled();
    expect(timeline.writes).toEqual([]);
    expect(timeline.settleStatements).toHaveLength(1);
  });

  test("the next run finds nothing more to settle", async () => {
    const leftByTheWorkers: ObjectID = written(
      25 * HOUR,
      UserNotificationStatus.Sending,
    );
    written(20 * MINUTE, UserNotificationStatus.Sending);

    await runTheJob();
    await runTheJob();

    expect(timeline.writes).toHaveLength(2);
    expect(row(leftByTheWorkers).version).toBe(2);
  });
});
