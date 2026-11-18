import UserOnCallLogService from "../../../../Server/Services/UserOnCallLogService";
import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import OnCallTestPageService, {
  ON_CALL_TEST_PAGE_MESSAGE_NOT_FOUND_MESSAGE,
} from "../../../../Server/Services/OnCallTestPageService";
import OnCallTestPageAcknowledge, {
  OnCallTestPageAnswer,
  isOnCallTestPageAnswer,
} from "../../../../Server/Utils/OnCall/OnCallTestPageAcknowledge";
import * as OnCallNotificationStatus from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import { ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallTestPage";
import UserNotificationEventType from "../../../../Types/UserNotification/UserNotificationEventType";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * ACKNOWLEDGING A TEST PAGE FROM ONE OF ITS MESSAGES (#7014): the one rule
 * the link's page and the On-Call app's Acknowledge test page both ask.
 *
 *   - a test is the person's to acknowledge once, whichever message they
 *     answer: one acknowledged already - this message, or another of theirs
 *     - writes nothing again;
 *   - otherwise this message is written Acknowledged, in a test's words,
 *     as any acknowledgement is (recordAcknowledgement), and its update hook
 *     does the rest (UserOnCallLogTimelineTestPageAcknowledge);
 *   - a write that did not land is never said to be acknowledged.
 *
 * And the app asks it only of the signed-in person's own message of a test
 * page, in the project the request names: anything else is not found.
 */

const PROJECT: ObjectID = new ObjectID("7e5b1000-0000-4000-8000-000000000001");
const OTHER_PROJECT: ObjectID = new ObjectID(
  "7e5b1000-0000-4000-8000-000000000002",
);
const MESSAGE: ObjectID = new ObjectID("7e5b1000-0000-4000-8000-000000000003");
const LOG: ObjectID = new ObjectID("7e5b1000-0000-4000-8000-000000000004");
const ANA: ObjectID = new ObjectID("7e5b1000-0000-4000-8000-0000000000a1");
const BOB: ObjectID = new ObjectID("7e5b1000-0000-4000-8000-0000000000b1");

let recordAcknowledgement: jest.SpyInstance;
let isNotificationAcknowledged: jest.SpyInstance;
let readLog: jest.SpyInstance;

beforeEach(() => {
  recordAcknowledgement = jest
    .spyOn(OnCallNotificationStatus, "recordAcknowledgement")
    .mockResolvedValue(true as never);
  isNotificationAcknowledged = jest
    .spyOn(OnCallNotificationStatus, "isNotificationAcknowledged")
    .mockResolvedValue(false as never);
  readLog = jest
    .spyOn(UserOnCallLogService, "findOneById")
    .mockResolvedValue({ _id: LOG.toString() } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("whether the person answered the test already", () => {
  test("this message acknowledged: yes, and their page is not read", async () => {
    await expect(
      OnCallTestPageAcknowledge.isAnswered({
        isAcknowledged: true,
        userNotificationLogId: LOG,
      }),
    ).resolves.toBe(true);
    expect(readLog).not.toHaveBeenCalled();
  });

  test("another of their messages acknowledged it: their page says so", async () => {
    readLog.mockResolvedValue({
      _id: LOG.toString(),
      acknowledgedAt: new Date("2026-11-17T09:00:00.000Z"),
    } as never);

    await expect(
      OnCallTestPageAcknowledge.isAnswered({
        isAcknowledged: false,
        userNotificationLogId: LOG,
      }),
    ).resolves.toBe(true);
    expect(readLog).toHaveBeenCalledWith(
      expect.objectContaining({ id: LOG, props: { isRoot: true } }),
    );
  });

  test("neither: no", async () => {
    await expect(
      OnCallTestPageAcknowledge.isAnswered({
        isAcknowledged: false,
        userNotificationLogId: LOG,
      }),
    ).resolves.toBe(false);
  });

  test("a message with no page of the person's: no, and nothing is read", async () => {
    await expect(
      OnCallTestPageAcknowledge.isAnswered({ isAcknowledged: false }),
    ).resolves.toBe(false);
    expect(readLog).not.toHaveBeenCalled();
  });
});

describe("acknowledging the test from a message", () => {
  test("writes this message Acknowledged, in a test's words, once", async () => {
    await expect(
      OnCallTestPageAcknowledge.acknowledge({
        userOnCallLogTimelineId: MESSAGE,
        message: { isAcknowledged: false, userNotificationLogId: LOG },
      }),
    ).resolves.toBe(OnCallTestPageAnswer.Acknowledged);

    expect(recordAcknowledgement).toHaveBeenCalledTimes(1);
    expect(recordAcknowledgement).toHaveBeenCalledWith({
      userOnCallLogTimelineId: MESSAGE,
      statusMessage: ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    });
  });

  test("one the person answered already - from this message or another - writes nothing again", async () => {
    await expect(
      OnCallTestPageAcknowledge.acknowledge({
        userOnCallLogTimelineId: MESSAGE,
        message: { isAcknowledged: true, userNotificationLogId: LOG },
      }),
    ).resolves.toBe(OnCallTestPageAnswer.AlreadyAcknowledged);

    readLog.mockResolvedValue({
      _id: LOG.toString(),
      acknowledgedAt: new Date("2026-11-17T09:00:00.000Z"),
    } as never);

    await expect(
      OnCallTestPageAcknowledge.acknowledge({
        userOnCallLogTimelineId: MESSAGE,
        message: { isAcknowledged: false, userNotificationLogId: LOG },
      }),
    ).resolves.toBe(OnCallTestPageAnswer.AlreadyAcknowledged);

    expect(recordAcknowledgement).not.toHaveBeenCalled();
  });

  test("a write that lost the race to a second press is already acknowledged", async () => {
    recordAcknowledgement.mockResolvedValue(false as never);
    isNotificationAcknowledged.mockResolvedValue(true as never);

    await expect(
      OnCallTestPageAcknowledge.acknowledge({
        userOnCallLogTimelineId: MESSAGE,
        message: { isAcknowledged: false, userNotificationLogId: LOG },
      }),
    ).resolves.toBe(OnCallTestPageAnswer.AlreadyAcknowledged);
  });

  test("a write that lost the race to another of the person's messages is already acknowledged too", async () => {
    recordAcknowledgement.mockResolvedValue(false as never);
    readLog
      .mockResolvedValueOnce({ _id: LOG.toString() } as never)
      .mockResolvedValueOnce({
        _id: LOG.toString(),
        acknowledgedAt: new Date("2026-11-17T09:00:00.000Z"),
      } as never);

    await expect(
      OnCallTestPageAcknowledge.acknowledge({
        userOnCallLogTimelineId: MESSAGE,
        message: { isAcknowledged: false, userNotificationLogId: LOG },
      }),
    ).resolves.toBe(OnCallTestPageAnswer.AlreadyAcknowledged);
  });

  test("a write that did not land, with nothing acknowledged, is never said to be acknowledged", async () => {
    recordAcknowledgement.mockResolvedValue(false as never);

    await expect(
      OnCallTestPageAcknowledge.acknowledge({
        userOnCallLogTimelineId: MESSAGE,
        message: { isAcknowledged: false, userNotificationLogId: LOG },
      }),
    ).resolves.toBe(OnCallTestPageAnswer.NotAcknowledged);
  });

  test("its answers are the three the On-Call app reads", () => {
    expect(Object.values(OnCallTestPageAnswer)).toEqual([
      "Acknowledged",
      "AlreadyAcknowledged",
      "NotAcknowledged",
    ]);
    expect(isOnCallTestPageAnswer("Acknowledged")).toBe(true);
    expect(isOnCallTestPageAnswer("acknowledged")).toBe(false);
    expect(isOnCallTestPageAnswer(undefined)).toBe(false);
  });
});

describe("the On-Call app answers only the person's own message of a test page", () => {
  let readMessage: jest.SpyInstance;

  function message(
    data: Record<string, unknown> = {},
  ): Record<string, unknown> {
    return {
      _id: MESSAGE.toString(),
      id: MESSAGE,
      projectId: PROJECT,
      userId: ANA,
      userNotificationEventType: UserNotificationEventType.TestPage,
      isAcknowledged: false,
      userNotificationLogId: LOG,
      ...data,
    };
  }

  beforeEach(() => {
    readMessage = jest
      .spyOn(UserOnCallLogTimelineService, "findOneById")
      .mockResolvedValue(message() as never);
  });

  test("their own message of a test page, in their project, is acknowledged by the rule", async () => {
    await expect(
      OnCallTestPageService.acknowledgeOwnTestPage({
        projectId: PROJECT,
        userId: ANA,
        userOnCallLogTimelineId: MESSAGE,
      }),
    ).resolves.toBe(OnCallTestPageAnswer.Acknowledged);

    expect(readMessage).toHaveBeenCalledWith(
      expect.objectContaining({ id: MESSAGE, props: { isRoot: true } }),
    );
    expect(recordAcknowledgement).toHaveBeenCalledWith({
      userOnCallLogTimelineId: MESSAGE,
      statusMessage: ON_CALL_TEST_PAGE_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    });
  });

  test("and whether it is answered is read by the same rule", async () => {
    await expect(
      OnCallTestPageService.isOwnTestPageAnswered({
        projectId: PROJECT,
        userId: ANA,
        userOnCallLogTimelineId: MESSAGE,
      }),
    ).resolves.toBe(false);

    readMessage.mockResolvedValue(message({ isAcknowledged: true }) as never);

    await expect(
      OnCallTestPageService.isOwnTestPageAnswered({
        projectId: PROJECT,
        userId: ANA,
        userOnCallLogTimelineId: MESSAGE,
      }),
    ).resolves.toBe(true);
  });

  test.each([
    ["somebody else's", { userId: BOB }],
    ["another project's", { projectId: OTHER_PROJECT }],
    [
      "a real page's",
      { userNotificationEventType: UserNotificationEventType.IncidentCreated },
    ],
    ["one with no event type", { userNotificationEventType: undefined }],
  ] as Array<[string, Record<string, unknown>]>)(
    "%s message is not found, and nothing is acknowledged",
    async (_kind: string, data: Record<string, unknown>) => {
      readMessage.mockResolvedValue(message(data) as never);

      await expect(
        OnCallTestPageService.acknowledgeOwnTestPage({
          projectId: PROJECT,
          userId: ANA,
          userOnCallLogTimelineId: MESSAGE,
        }),
      ).rejects.toThrow(
        new BadDataException(ON_CALL_TEST_PAGE_MESSAGE_NOT_FOUND_MESSAGE),
      );
      await expect(
        OnCallTestPageService.isOwnTestPageAnswered({
          projectId: PROJECT,
          userId: ANA,
          userOnCallLogTimelineId: MESSAGE,
        }),
      ).rejects.toThrow(ON_CALL_TEST_PAGE_MESSAGE_NOT_FOUND_MESSAGE);
      expect(recordAcknowledgement).not.toHaveBeenCalled();
    },
  );

  test("a message that does not exist is not found the same way", async () => {
    readMessage.mockResolvedValue(null as never);

    await expect(
      OnCallTestPageService.acknowledgeOwnTestPage({
        projectId: PROJECT,
        userId: ANA,
        userOnCallLogTimelineId: MESSAGE,
      }),
    ).rejects.toThrow(ON_CALL_TEST_PAGE_MESSAGE_NOT_FOUND_MESSAGE);
    expect(recordAcknowledgement).not.toHaveBeenCalled();
  });
});
