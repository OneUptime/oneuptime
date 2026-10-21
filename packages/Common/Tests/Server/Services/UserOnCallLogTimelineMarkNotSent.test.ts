import UserOnCallLogTimelineService from "../../../Server/Services/UserOnCallLogTimelineService";
import logger from "../../../Server/Utils/Logger";
import ColumnLength from "../../../Types/Database/ColumnLength";
import ObjectID from "../../../Types/ObjectID";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * UserOnCallLogTimelineService.markNotSent: a page the Notification service
 * deliberately did not send (the balance could not pay for it, the channel
 * is off, the project is gone) says so on the person's on-call timeline -
 * not sent, with the reason the message's log gives - instead of "Sending"
 * for ever. It never throws: the skip is already logged, and a row that
 * could not be written must not turn it into a failed send.
 */

const TIMELINE_ID: ObjectID = new ObjectID(
  "7e000000-0000-4000-8000-0000000000e1",
);

let update: jest.SpyInstance;

beforeEach(() => {
  update = jest
    .spyOn(UserOnCallLogTimelineService, "updateOneById")
    .mockResolvedValue(undefined as never);
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

    expect(update).toHaveBeenCalledTimes(1);
    expect(update).toHaveBeenCalledWith({
      id: TIMELINE_ID,
      data: {
        status: UserNotificationStatus.Error,
        statusMessage: "This project's balance is used up.",
      },
      props: { isRoot: true },
    });
  });

  test("a send that is no page (no timeline row) has nothing to update", async () => {
    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: undefined,
      reason: "SMS is off in this project.",
    });

    expect(update).not.toHaveBeenCalled();
  });

  test("a reason longer than the column fits is cut to fit, so the row is still written", async () => {
    await UserOnCallLogTimelineService.markNotSent({
      userOnCallLogTimelineId: TIMELINE_ID,
      reason: "x".repeat(ColumnLength.LongText + 120),
    });

    const data: { statusMessage: string } = (
      update.mock.calls[0]![0] as { data: { statusMessage: string } }
    ).data;

    expect(data.statusMessage).toHaveLength(ColumnLength.LongText);
  });

  test("a row that cannot be written never throws, and says why in the logs", async () => {
    update.mockRejectedValue(new Error("database unavailable"));

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
});
