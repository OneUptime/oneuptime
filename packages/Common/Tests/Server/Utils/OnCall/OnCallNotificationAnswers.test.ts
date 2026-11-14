import ObjectID from "../../../../Types/ObjectID";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import OnCallTimelineRows, {
  OnCallNotificationWrite,
  StoredOnCallNotification,
} from "../../TestingUtils/OnCallTimelineRows";

/*
 * THE PERSON'S ANSWER ON ONE NOTIFICATION OF THEIR PAGE (issue #7082).
 *
 * A person answers a page from one of its messages: they acknowledge it -
 * its link, a call's 1, a custom channel's button - or escalate it ("Can't
 * take it? Escalate"). Each answer is written on the notification it was
 * given from, at the status and the version read, as every other writer of
 * a notification writes (OnCallNotificationStatus):
 *
 *   - an acknowledgement moves on from whatever the send or its provider
 *     wrote - Sending, Sent, an Error, a call Not Answered - and from an
 *     escalation: a page escalated and then taken after all is answered by
 *     the later answer. Never over an acknowledgement written already, so a
 *     page is acknowledged once from a message;
 *   - an escalation moves on from whatever the send or its provider wrote,
 *     never over an acknowledgement, nor an escalation written already.
 *
 * And a send that finishes late writes over neither: it moves on from
 * Sending only.
 *
 * The notification is stood in for by OnCallTimelineRows: a read returns it
 * as it is, with its version, and an update reaches it only while it holds
 * the status and the version the update names.
 */

jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
  };
});

import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import {
  ACKNOWLEDGEMENT_MOVES_ON_FROM,
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE,
  ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE,
  PASS_ON_MOVES_ON_FROM,
  recordAcknowledgement,
  recordPassOn,
  recordProviderReport,
  recordSendResult,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
  writeNotificationStatusWhileStill,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import { ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE } from "../../../../Types/OnCallDutyPolicy/OnCallPagePassOn";

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "0c0c7082-0000-4000-8000-0000000000a1",
);

const ACKNOWLEDGED_AT: Date = new Date("2026-11-12T09:30:00.000Z");

const read: jest.Mock = UserOnCallLogTimelineService.findOneById as jest.Mock;
const write: jest.Mock = UserOnCallLogTimelineService.updateOneBy as jest.Mock;

const ALL_STATUSES: Array<UserNotificationStatus> = Object.values(
  UserNotificationStatus,
);

let timeline: OnCallTimelineRows;

function notification(): StoredOnCallNotification {
  return timeline.get(NOTIFICATION_ID)!;
}

// A notification, as its page wrote it and as it was written since.
function given(
  status: UserNotificationStatus,
  statusMessage: string = `${status}.`,
): void {
  timeline = new OnCallTimelineRows();
  timeline.add(NOTIFICATION_ID, status, { statusMessage: statusMessage });
  timeline.standIn(UserOnCallLogTimelineService);
}

function acknowledge(): Promise<boolean> {
  return recordAcknowledgement({
    userOnCallLogTimelineId: NOTIFICATION_ID,
    statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    acknowledgedAt: ACKNOWLEDGED_AT,
  });
}

function passOn(): Promise<boolean> {
  return recordPassOn({
    userOnCallLogTimelineId: NOTIFICATION_ID,
    statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  given(UserNotificationStatus.Sending, "Sending SMS to +15555550100.");
});

describe("what each answer moves a notification on from", () => {
  test("an acknowledgement: what the send or its provider wrote, and an escalation", () => {
    expect([...ACKNOWLEDGEMENT_MOVES_ON_FROM].sort()).toEqual(
      [
        UserNotificationStatus.Sending,
        UserNotificationStatus.Sent,
        UserNotificationStatus.Error,
        UserNotificationStatus.NotAnswered,
        UserNotificationStatus.PassedOn,
      ].sort(),
    );
  });

  test("an escalation: what the send or its provider wrote - never an answer", () => {
    expect([...PASS_ON_MOVES_ON_FROM].sort()).toEqual(
      [
        UserNotificationStatus.Sending,
        UserNotificationStatus.Sent,
        UserNotificationStatus.Error,
        UserNotificationStatus.NotAnswered,
      ].sort(),
    );
  });

  test("neither moves on from an acknowledgement, or a skip", () => {
    for (const from of [ACKNOWLEDGEMENT_MOVES_ON_FROM, PASS_ON_MOVES_ON_FROM]) {
      expect(from).not.toContain(UserNotificationStatus.Acknowledged);
      expect(from).not.toContain(UserNotificationStatus.Skipped);
    }
  });

  test("every status is decided by each answer: none is left out of the rule by accident", () => {
    const decided: Array<UserNotificationStatus> = [
      ...ACKNOWLEDGEMENT_MOVES_ON_FROM,
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.Skipped,
    ];

    expect([...decided].sort()).toEqual([...ALL_STATUSES].sort());
  });

  test("the words each answer writes", () => {
    expect(ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE).toBe(
      "Notification Acknowledged",
    );
    expect(ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE).toBe(
      "Marked as seen, paged as an observer",
    );
    expect(ON_CALL_NOTIFICATION_NOT_ACKNOWLEDGED_MESSAGE).toBe(
      "This notification could not be acknowledged just now. Please try again.",
    );
  });
});

describe("an acknowledgement (recordAcknowledgement)", () => {
  test.each(ACKNOWLEDGEMENT_MOVES_ON_FROM)(
    "over %s: Acknowledged, with when, in one write - the update hook acknowledges the page",
    async (status: UserNotificationStatus) => {
      given(status);

      await expect(acknowledge()).resolves.toBe(true);

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Acknowledged,
        statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
        isAcknowledged: true,
        acknowledgedAt: ACKNOWLEDGED_AT,
        version: 2,
      });
      expect(timeline.writes).toEqual([
        {
          id: NOTIFICATION_ID.toString(),
          data: {
            status: UserNotificationStatus.Acknowledged,
            statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
            isAcknowledged: true,
            acknowledgedAt: ACKNOWLEDGED_AT,
          },
        },
      ]);
    },
  );

  test.each(
    ALL_STATUSES.filter((status: UserNotificationStatus) => {
      return !ACKNOWLEDGEMENT_MOVES_ON_FROM.includes(status);
    }),
  )(
    "over %s: nothing - a page is acknowledged once from a message",
    async (status: UserNotificationStatus) => {
      given(status, "Acknowledged by SMS.");

      await expect(acknowledge()).resolves.toBe(false);

      expect(notification()).toMatchObject({
        status: status,
        statusMessage: "Acknowledged by SMS.",
        version: 1,
      });
      expect(timeline.writes).toEqual([]);
    },
  );

  test("written at the status and the version read, as root, naming the notification", async () => {
    await acknowledge();

    expect(read).toHaveBeenCalledWith({
      id: NOTIFICATION_ID,
      select: { _id: true, status: true, version: true },
      props: { isRoot: true },
    });
    expect(write).toHaveBeenCalledWith({
      query: {
        _id: NOTIFICATION_ID.toString(),
        status: UserNotificationStatus.Sending,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Acknowledged,
        statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
        acknowledgedAt: ACKNOWLEDGED_AT,
        isAcknowledged: true,
      },
      props: { isRoot: true },
    });
  });

  test("with no time given: now", async () => {
    const before: number = Date.now();

    await recordAcknowledgement({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
    });

    const acknowledgedAt: Date = notification().acknowledgedAt!;

    expect(acknowledgedAt).toBeInstanceOf(Date);
    expect(acknowledgedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(acknowledgedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("a second press landing between the first's read and its write: the first finds it acknowledged, and writes nothing", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
      row.statusMessage = "Acknowledged from the other phone.";
      row.isAcknowledged = true;
    });

    await expect(acknowledge()).resolves.toBe(false);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      statusMessage: "Acknowledged from the other phone.",
    });
    expect(timeline.writes).toEqual([]);
    // Read, refused at the version read, read again: acknowledged.
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
  });

  test("the send's result landing between its read and its write: read again, and acknowledged over Sent", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Sent;
      row.statusMessage = "Message ID: SM1";
    });

    await expect(acknowledge()).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      isAcknowledged: true,
    });
    expect(write).toHaveBeenCalledTimes(2);
  });

  test("a notification that is gone: nothing", async () => {
    timeline.rows.clear();

    await expect(acknowledge()).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
  });

  test(`a notification that keeps changing under every try: given up after ${MAX_NOTIFICATION_WRITE_ATTEMPTS}`, async () => {
    for (
      let attempt: number = 0;
      attempt < MAX_NOTIFICATION_WRITE_ATTEMPTS;
      attempt++
    ) {
      timeline.whenRead(() => {
        // Its version moves on, its status stays.
      });
    }

    await expect(acknowledge()).resolves.toBe(false);

    expect(notification().isAcknowledged).toBeUndefined();
    expect(write).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
  });
});

describe("an escalation from a notification (recordPassOn)", () => {
  test.each(PASS_ON_MOVES_ON_FROM)(
    "over %s: Passed On, saying so",
    async (status: UserNotificationStatus) => {
      given(status);

      await expect(passOn()).resolves.toBe(true);

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.PassedOn,
        statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
        version: 2,
      });
      // Not an acknowledgement.
      expect(notification().isAcknowledged).toBeUndefined();
      expect(timeline.writes).toEqual([
        {
          id: NOTIFICATION_ID.toString(),
          data: {
            status: UserNotificationStatus.PassedOn,
            statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
          },
        },
      ]);
    },
  );

  test.each([
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.Skipped,
  ])(
    "over %s: nothing - the person's own answer stands",
    async (status: UserNotificationStatus) => {
      given(status, "Answered.");

      await expect(passOn()).resolves.toBe(false);

      expect(notification()).toMatchObject({
        status: status,
        statusMessage: "Answered.",
        version: 1,
      });
    },
  );

  test("an acknowledgement landing between its read and its write stays", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
      row.statusMessage = ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE;
    });

    await expect(passOn()).resolves.toBe(false);

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
    expect(timeline.writes).toEqual([]);
  });
});

describe("an answer and a send that finishes late (the race of #7082)", () => {
  test("acknowledged while the send was in flight: the send's Sent is not written over it", async () => {
    await acknowledge();

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Email sent.",
      }),
    ).resolves.toBe(false);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      statusMessage: ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
      isAcknowledged: true,
    });
  });

  test("acknowledged while the send was in flight: the send's Error is not written over it either", async () => {
    await acknowledge();

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: false,
        statusMessage: "SMTP connection refused.",
      }),
    ).resolves.toBe(false);

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("escalated while the send was in flight: the send's result is not written over it", async () => {
    await passOn();

    for (const isSent of [true, false]) {
      await expect(
        recordSendResult({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          isSent: isSent,
          statusMessage: "Late.",
        }),
      ).resolves.toBe(false);
    }

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.PassedOn,
      statusMessage: ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
    });
  });

  test("a provider's report after an answer is not written over it", async () => {
    await acknowledge();

    await expect(
      recordProviderReport({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        status: UserNotificationStatus.Error,
        statusMessage: "Undelivered (30003).",
      }),
    ).resolves.toBe(false);

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("escalated, then taken after all: the acknowledgement is the answer that stands", async () => {
    await passOn();
    await expect(acknowledge()).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Acknowledged,
      isAcknowledged: true,
    });

    // And an escalation after that is not written over it.
    await expect(passOn()).resolves.toBe(false);
    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("an answer over the stuck check's verdict stands, and a late send does not undo it", async () => {
    given(UserNotificationStatus.Error, STUCK_NOTIFICATION_STATUS_MESSAGE);

    await expect(acknowledge()).resolves.toBe(true);
    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Sent after all.",
      }),
    ).resolves.toBe(false);

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("the writes, in order: the answer only", async () => {
    await acknowledge();
    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: true,
      statusMessage: "Email sent.",
    });

    expect(
      timeline.writes.map((written: OnCallNotificationWrite) => {
        return written.data.status;
      }),
    ).toEqual([UserNotificationStatus.Acknowledged]);
  });
});

describe("the write itself (writeNotificationStatusWhileStill)", () => {
  test("names no acknowledgement unless it is given one", async () => {
    await writeNotificationStatusWhileStill({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      from: [UserNotificationStatus.Sending],
      status: UserNotificationStatus.Sent,
      statusMessage: "Sent.",
    });

    const data: Record<string, unknown> = (
      write.mock.calls[0]![0] as { data: Record<string, unknown> }
    ).data;

    expect(data).toEqual({
      status: UserNotificationStatus.Sent,
      statusMessage: "Sent.",
    });
    expect("acknowledgedAt" in data).toBe(false);
    expect("isAcknowledged" in data).toBe(false);
  });
});
