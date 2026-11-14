import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import logger from "../../../Server/Utils/Logger";
import {
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
} from "../../../Server/Utils/OnCall/OnCallNotificationStatus";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "../TestingUtils/OnCallTimelineRows";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * UserOnCallLogTimelineService.markNotSent: a page the Notification service
 * deliberately did not send (the balance could not pay for it, the channel
 * is off, the project is gone) says so on the person's on-call timeline -
 * not sent, with the reason the message's log gives - instead of "Sending"
 * for ever. It never throws: the skip is already logged, and a row that
 * could not be written must not turn it into a failed send.
 *
 * Written as every send's result is (OnCallNotificationStatus.
 * recordSendResult): over Sending, or over the stuck check's verdict, at
 * the version read - never over the person's answer, given meanwhile from
 * another of the page's messages (issue #7082).
 */

const TIMELINE_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000e1",
);

let timeline: OnCallTimelineRows;

function row(): StoredOnCallNotification {
  return timeline.get(TIMELINE_ID)!;
}

beforeEach(() => {
  timeline = new OnCallTimelineRows();
  timeline.add(TIMELINE_ID, UserNotificationStatus.Sending, {
    statusMessage: "Sending SMS to +15555550100.",
  });
  timeline.standIn(UserOnCallLogTimelineService);
  jest.spyOn(logger, "error").mockImplementation((): void => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("UserOnCallLogTimelineService.markNotSent", () => {
  test("records the row as not sent (Error), with the reason, as root", async () => {
    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: "This project's balance is used up.",
    });

    expect(row()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "This project's balance is used up.",
    });
    expect(timeline.writes).toEqual([
      {
        id: TIMELINE_ID.toString(),
        data: {
          status: UserNotificationStatus.Error,
          statusMessage: "This project's balance is used up.",
        },
      },
    ]);
    expect(UserOnCallLogTimelineService.updateOneBy).toHaveBeenCalledWith({
      query: {
        _id: TIMELINE_ID.toString(),
        status: UserNotificationStatus.Sending,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: "This project's balance is used up.",
      },
      props: { isRoot: true },
    });
  });

  test("a send that is no page (no timeline row) has nothing to read or update", async () => {
    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: undefined,
      reason: "SMS is off in this project.",
    });

    expect(UserOnCallLogTimelineService.findOneById).not.toHaveBeenCalled();
    expect(UserOnCallLogTimelineService.updateOneBy).not.toHaveBeenCalled();
  });

  test("a reason longer than the column fits is cut to fit, so the row is still written", async () => {
    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: "x".repeat(ColumnLength.LongText + 120),
    });

    expect(row().status).toBe(UserNotificationStatus.Error);
    expect(row().statusMessage).toHaveLength(ColumnLength.LongText);
  });

  test("acknowledged meanwhile from another of the page's messages: the acknowledgement stays", async () => {
    row().status = UserNotificationStatus.Acknowledged;
    row().statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;

    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: "This project's balance is used up.",
    });

    expect(row()).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    });
    expect(timeline.writes).toEqual([]);
  });

  test("acknowledged between the read and the write: the acknowledgement stays", async () => {
    timeline.whenRead((notification: StoredOnCallNotification) => {
      notification.status = UserNotificationStatus.Acknowledged;
      notification.statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;
    });

    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: "Calls are off in this project.",
    });

    expect(row().status).toBe(UserNotificationStatus.Acknowledged);
    expect(timeline.writes).toEqual([]);
  });

  test.each([UserNotificationStatus.PassedOn, UserNotificationStatus.Sent])(
    "a row already at %s is left as it is",
    async (status: UserNotificationStatus) => {
      row().status = status;
      row().statusMessage = "Written first.";

      await UserOnCallLogTimelineService.markNotSent({
        userOnCallLogTimelineId: TIMELINE_ID,
        reason: "Calls are off in this project.",
      });

      expect(row()).toMatchObject({
        status: status,
        statusMessage: "Written first.",
      });
    },
  );

  test("a row the stuck check settled says why it was not sent after all", async () => {
    row().status = UserNotificationStatus.Error;
    row().statusMessage = STUCK_NOTIFICATION_STATUS_MESSAGE;

    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: "This project's balance is used up.",
    });

    expect(row()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "This project's balance is used up.",
    });
  });

  test("a row that cannot be written never throws, and says why in the logs", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "updateOneBy")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      UserOnCallLogTimelineService.markNotSent({
        userOnCallLogTimelineId: TIMELINE_ID,
        reason: "Calls are off in this project.",
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        "could not record that a notification was not sent",
      ),
    );
  });

  test("a row that cannot be read never throws either", async () => {
    jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockRejectedValue(new Error("database unavailable"));

    await expect(
      UserOnCallLogTimelineService.markNotSent({
        userOnCallLogTimelineId: TIMELINE_ID,
        reason: "Calls are off in this project.",
      }),
    ).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalled();
  });
});
