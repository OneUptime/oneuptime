import ObjectID from "../../../../Types/ObjectID";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "../../TestingUtils/OnCallTimelineRows";

/*
 * WHAT A PERSON'S ON-CALL TIMELINE SAYS OF ONE NOTIFICATION OF A PAGE, AS
 * THE SEND AND THE PROVIDER'S LATER REPORT WRITE IT (issues #6682, #6683).
 *
 * The send writes it once the provider answered: Sent, or Error - over
 * Sending only. The provider's report - an SMS or a WhatsApp message not
 * delivered, a call not answered - writes it over Sent or Sending only. Each
 * write names the notification at the status and version read, so a write
 * that lands in between - the person acknowledging the page - is never
 * written over: the writer reads again, and decides again.
 *
 * The stuck check settles a notification still Sending after 15 minutes as
 * Error (OnCallStuckNotifications); a send that finishes after all writes
 * its result over that verdict - and over no other Error (issue #6873).
 *
 * The notification is stood in for by a row that a read returns as it is,
 * with its version, and that an update reaches only while it holds the
 * status and version the update names (OnCallTimelineRows).
 */

jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
  };
});

import UserOnCallLogTimelineService from "../../../../Server/Services/UserOnCallLogTimelineService";
import {
  isSettledAsStuck,
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  PROVIDER_REPORT_MOVES_ON_FROM,
  recordProviderReport,
  recordSendResult,
  SEND_RESULT_MOVES_ON_FROM,
  STUCK_NOTIFICATION_AFTER_MINUTES,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
  writeNotificationStatusWhileStill,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "0c0c0000-0000-4000-8000-0000000000a1",
);
const OTHER_NOTIFICATION_ID: ObjectID = new ObjectID(
  "0c0c0000-0000-4000-8000-0000000000a2",
);

const read: jest.Mock = UserOnCallLogTimelineService.findOneById as jest.Mock;
const write: jest.Mock = UserOnCallLogTimelineService.updateOneBy as jest.Mock;

let timeline: OnCallTimelineRows;

const ALL_STATUSES: Array<UserNotificationStatus> = Object.values(
  UserNotificationStatus,
);

function notification(): StoredOnCallNotification {
  return timeline.get(NOTIFICATION_ID)!;
}

beforeEach(() => {
  jest.clearAllMocks();

  timeline = new OnCallTimelineRows();
  timeline.add(NOTIFICATION_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

describe("what each writer moves a notification on from", () => {
  test("the send: Sending only", () => {
    expect(SEND_RESULT_MOVES_ON_FROM).toEqual([UserNotificationStatus.Sending]);
  });

  test("the provider's report: Sent or Sending", () => {
    expect([...PROVIDER_REPORT_MOVES_ON_FROM].sort()).toEqual(
      [UserNotificationStatus.Sent, UserNotificationStatus.Sending].sort(),
    );
  });

  test("a write is tried three times at most", () => {
    expect(MAX_NOTIFICATION_WRITE_ATTEMPTS).toBe(3);
  });
});

describe("the send's result (recordSendResult)", () => {
  test("taken by the provider: Sending becomes Sent, with the send's message", async () => {
    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Sent,
      statusMessage: "Message ID: SM1",
    });
  });

  test("refused: Sending becomes Error, with why", async () => {
    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: false,
      statusMessage: "The 'To' number is not a valid phone number.",
    });

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "The 'To' number is not a valid phone number.",
    });
  });

  test("reads the notification as root - its status, version and message - and writes it at its status and version, as root", async () => {
    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: true,
      statusMessage: "Message ID: SM1",
    });

    // The message tells the stuck check's verdict from any other Error.
    expect(read).toHaveBeenCalledWith({
      id: NOTIFICATION_ID,
      select: { _id: true, status: true, version: true, statusMessage: true },
      props: { isRoot: true },
    });
    expect(write).toHaveBeenCalledWith({
      query: {
        _id: NOTIFICATION_ID.toString(),
        status: UserNotificationStatus.Sending,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Sent,
        statusMessage: "Message ID: SM1",
      },
      props: { isRoot: true },
    });
  });

  test.each(
    ALL_STATUSES.filter((status: UserNotificationStatus) => {
      return status !== UserNotificationStatus.Sending;
    }),
  )(
    "a notification already %s - written first by someone who knows more - stays",
    async (status: UserNotificationStatus) => {
      notification().status = status;
      notification().statusMessage = "written first";

      await expect(
        recordSendResult({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          isSent: true,
          statusMessage: "Message ID: SM1",
        }),
      ).resolves.toBe(false);

      expect(write).not.toHaveBeenCalled();
      expect(notification()).toMatchObject({
        status: status,
        statusMessage: "written first",
      });
    },
  );
});

describe("the provider's report (recordProviderReport)", () => {
  test.each([UserNotificationStatus.Sent, UserNotificationStatus.Sending])(
    "a notification %s becomes Error, with the provider's words",
    async (status: UserNotificationStatus) => {
      notification().status = status;

      await expect(
        recordProviderReport({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          status: UserNotificationStatus.Error,
          statusMessage: "Delivery status: Undelivered.",
        }),
      ).resolves.toBe(true);

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: "Delivery status: Undelivered.",
      });
    },
  );

  test.each(
    ALL_STATUSES.filter((status: UserNotificationStatus) => {
      return (
        status !== UserNotificationStatus.Sent &&
        status !== UserNotificationStatus.Sending
      );
    }),
  )(
    "a notification %s - an acknowledgement, a skip, an escalation, a failure written already - stays",
    async (status: UserNotificationStatus) => {
      notification().status = status;

      await expect(
        recordProviderReport({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          status: UserNotificationStatus.Error,
          statusMessage: "Delivery status: Failed.",
        }),
      ).resolves.toBe(false);

      expect(write).not.toHaveBeenCalled();
      expect(notification().status).toBe(status);
    },
  );

  test("with no status - a call answered - only the message is written", async () => {
    notification().status = UserNotificationStatus.Sent;

    await recordProviderReport({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      statusMessage: "The call was answered and lasted 42 seconds.",
    });

    expect(timeline.writes).toEqual([
      {
        id: NOTIFICATION_ID.toString(),
        data: {
          statusMessage: "The call was answered and lasted 42 seconds.",
        },
      },
    ]);
    expect(notification().status).toBe(UserNotificationStatus.Sent);
  });
});

describe("a write that something else lands before", () => {
  test("an acknowledgement between the read and the write: the write names no row, the notification is read again, and left", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
    });

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
    expect(read).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenCalledTimes(1);
    expect(timeline.writes).toEqual([]);
  });

  test("a provider's failure between the send's read and its write: the failure stays", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Error;
      row.statusMessage = "Delivery status: Failed.";
    });

    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: true,
      statusMessage: "Message ID: SM1",
    });

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "Delivery status: Failed.",
    });
  });

  test("a write that moved the version but not the status: read again, and written", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.statusMessage = "Sending SMS to the person.";
    });

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Sent,
      statusMessage: "Message ID: SM1",
    });
    expect(write).toHaveBeenCalledTimes(2);
    expect(write.mock.calls[1]![0]).toMatchObject({
      query: { version: 2 },
    });
  });

  test("a notification that keeps changing under every try: given up after three", async () => {
    for (let i: number = 0; i < MAX_NOTIFICATION_WRITE_ATTEMPTS; i++) {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.statusMessage = `changed ${i}`;
      });
    }

    await expect(
      recordProviderReport({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        status: UserNotificationStatus.Error,
        statusMessage: "Delivery status: Failed.",
      }),
    ).resolves.toBe(false);

    expect(read).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(write).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(notification().status).toBe(UserNotificationStatus.Sending);
  });
});

describe("what else is never written", () => {
  test("a notification that is gone: nothing", async () => {
    await expect(
      recordSendResult({
        userOnCallLogTimelineId: OTHER_NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
  });

  test("a notification with no status: nothing - it says nothing a writer may move on from", async () => {
    notification().status = null;

    await expect(
      writeNotificationStatusWhileStill({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        from: [UserNotificationStatus.Sending],
        status: UserNotificationStatus.Sent,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
  });

  test("only the notification named: another stays as it is", async () => {
    timeline.add(OTHER_NOTIFICATION_ID, UserNotificationStatus.Sending);

    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: true,
      statusMessage: "Message ID: SM1",
    });

    expect(timeline.get(OTHER_NOTIFICATION_ID)!.status).toBe(
      UserNotificationStatus.Sending,
    );
  });
});

describe("the message", () => {
  test("is cut to the 500 characters the column holds", async () => {
    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: false,
      statusMessage: "x".repeat(800),
    });

    expect(notification().statusMessage).toBe("x".repeat(500));
  });
});

describe("a database that fails", () => {
  test("a read that fails throws: the caller decides", async () => {
    read.mockRejectedValueOnce(new Error("connection reset") as never);

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).rejects.toThrow("connection reset");
  });

  test("a write that fails throws", async () => {
    write.mockRejectedValueOnce(new Error("connection reset") as never);

    await expect(
      recordProviderReport({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        status: UserNotificationStatus.Error,
        statusMessage: "Delivery status: Failed.",
      }),
    ).rejects.toThrow("connection reset");
  });
});

describe("a notification read without its version", () => {
  test("is written at its status alone", async () => {
    read.mockImplementationOnce((() => {
      return Promise.resolve({
        id: NOTIFICATION_ID,
        status: UserNotificationStatus.Sending,
      });
    }) as never);

    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: true,
      statusMessage: "Message ID: SM1",
    });

    expect(write.mock.calls[0]![0]).toMatchObject({
      query: {
        _id: NOTIFICATION_ID.toString(),
        status: UserNotificationStatus.Sending,
      },
    });
    expect(
      (write.mock.calls[0]![0] as { query: Record<string, unknown> }).query,
    ).not.toHaveProperty("version");
  });
});

describe("the provider's report reads only what it decides by", () => {
  test("its status and version, as root", async () => {
    notification().status = UserNotificationStatus.Sent;

    await recordProviderReport({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      status: UserNotificationStatus.Error,
      statusMessage: "Delivery status: Failed.",
    });

    expect(read).toHaveBeenCalledWith({
      id: NOTIFICATION_ID,
      select: { _id: true, status: true, version: true },
      props: { isRoot: true },
    });
  });
});

describe("the stuck check's verdict", () => {
  function settledAsStuck(): void {
    notification().status = UserNotificationStatus.Error;
    notification().statusMessage = STUCK_NOTIFICATION_STATUS_MESSAGE;
  }

  test("says the send did not finish within 15 minutes, and that it may not have gone out", () => {
    expect(STUCK_NOTIFICATION_AFTER_MINUTES).toBe(15);
    expect(STUCK_NOTIFICATION_STATUS_MESSAGE).toBe(
      "Sending did not finish within 15 minutes, so this notification may not have been sent.",
    );
  });

  test("is told by its status and its exact message", () => {
    expect(
      isSettledAsStuck({
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      }),
    ).toBe(true);

    for (const status of ALL_STATUSES.filter(
      (candidate: UserNotificationStatus) => {
        return candidate !== UserNotificationStatus.Error;
      },
    )) {
      expect(
        isSettledAsStuck({
          status: status,
          statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
        }),
      ).toBe(false);
    }

    expect(
      isSettledAsStuck({
        status: UserNotificationStatus.Error,
        statusMessage: "Delivery status: Failed.",
      }),
    ).toBe(false);
    expect(
      isSettledAsStuck({
        status: UserNotificationStatus.Error,
        statusMessage: `${STUCK_NOTIFICATION_STATUS_MESSAGE} `,
      }),
    ).toBe(false);
    expect(isSettledAsStuck({ status: UserNotificationStatus.Error })).toBe(
      false,
    );
  });

  test("a send that finished late writes its result over it: Sent", async () => {
    settledAsStuck();

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Call ID: CA1",
      }),
    ).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Sent,
      statusMessage: "Call ID: CA1",
    });
    expect(write).toHaveBeenCalledWith({
      query: {
        _id: NOTIFICATION_ID.toString(),
        status: UserNotificationStatus.Error,
        version: 1,
      },
      data: {
        status: UserNotificationStatus.Sent,
        statusMessage: "Call ID: CA1",
      },
      props: { isRoot: true },
    });
  });

  test("a send that finished late and was refused says why instead", async () => {
    settledAsStuck();

    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: false,
      statusMessage: "The 'To' number is not a valid phone number.",
    });

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "The 'To' number is not a valid phone number.",
    });
  });

  test("any other Error stays: a provider's report, a refusal, a request that never reached the service", async () => {
    notification().status = UserNotificationStatus.Error;
    notification().statusMessage = "Delivery status: Undelivered.";

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
    expect(notification().statusMessage).toBe("Delivery status: Undelivered.");
  });

  test("a provider's report does not move on from it: it moves on from Sent or Sending only", async () => {
    settledAsStuck();

    await expect(
      recordProviderReport({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        status: UserNotificationStatus.NotAnswered,
        statusMessage: "The call was not answered.",
      }),
    ).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
    expect(notification().statusMessage).toBe(
      STUCK_NOTIFICATION_STATUS_MESSAGE,
    );
  });

  test("a report landing on it between the send's read and its write stays: the write names the version read", async () => {
    settledAsStuck();

    timeline.whenRead((row: StoredOnCallNotification) => {
      row.statusMessage = "Delivery status: Failed.";
    });

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "Delivery status: Failed.",
    });
    expect(read).toHaveBeenCalledTimes(2);
  });

  test("an acknowledgement landing on it meanwhile stays", async () => {
    settledAsStuck();

    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
      row.statusMessage = "Notification Acknowledged";
    });

    await recordSendResult({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      isSent: true,
      statusMessage: "Message ID: SM1",
    });

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
  });

  test("read without its version, it is left: an Error is only written over at the version read", async () => {
    read.mockImplementationOnce((() => {
      return Promise.resolve({
        id: NOTIFICATION_ID,
        status: UserNotificationStatus.Error,
        statusMessage: STUCK_NOTIFICATION_STATUS_MESSAGE,
      });
    }) as never);

    await expect(
      recordSendResult({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        isSent: true,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
  });

  test("only with orSettledAsStuck: a write from Sending alone leaves it", async () => {
    settledAsStuck();

    await expect(
      writeNotificationStatusWhileStill({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        from: [UserNotificationStatus.Sending],
        status: UserNotificationStatus.Sent,
        statusMessage: "Message ID: SM1",
      }),
    ).resolves.toBe(false);

    expect(read).toHaveBeenCalledWith({
      id: NOTIFICATION_ID,
      select: { _id: true, status: true, version: true },
      props: { isRoot: true },
    });
    expect(write).not.toHaveBeenCalled();
  });
});
