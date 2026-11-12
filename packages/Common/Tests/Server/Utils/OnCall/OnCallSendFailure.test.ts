import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import OnCallTimelineRows, {
  StoredOnCallNotification,
} from "../../TestingUtils/OnCallTimelineRows";
import {
  hungUpRequestError,
  NOTIFICATION_SERVICE_URL,
  refusedOnEveryAddressRequestError,
  refusedRequestError,
  requestFailedWith,
  resetRequestError,
  socketError,
  timedOutRequestError,
  unresolvedNameRequestError,
} from "../../TestingUtils/NotificationRequestErrors";

/*
 * WHAT A PAGE'S NOTIFICATION SAYS WHEN ITS SEND THREW (issue #6873).
 *
 * The page writes the notification as Sending and asks the Notification
 * service to send it. Common's API.post throws only when no answer came
 * back. The notification then says:
 *
 *  - Error, "Could not reach the Notification service to send this (CODE)",
 *    when the request never reached the service - refused, or its name did
 *    not resolve: nothing was sent;
 *  - nothing new when it may have reached it - reset, hung up, timed out:
 *    the service may still send it and write how it went;
 *  - Error with the failure's words when it was not a request that got no
 *    answer at all.
 *
 * A push or a Slack, Microsoft Teams or Mattermost message, sent in this
 * process, is Error with the failure's words whatever threw.
 *
 * Each Error is written over Sending only, at the version read
 * (OnCallNotificationStatus): never over the send's own result, a
 * provider's report, the person's acknowledgement - nor over one of those
 * landing between the read and the write.
 *
 * The errors are the stand-ins NotificationRequestFailure.test.ts holds to
 * what a real request throws (NotificationRequestErrors). The notification
 * is a row a read returns with its version and an update reaches only at
 * the status and version it names (OnCallTimelineRows).
 */

jest.mock("../../../../Server/Services/UserOnCallLogTimelineService", () => {
  return {
    __esModule: true,
    default: { findOneById: jest.fn(), updateOneBy: jest.fn() },
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
  recordNotificationRequestFailure,
  recordSendFailure,
  whenNotificationRequestFails,
  whenSendFails,
} from "../../../../Server/Utils/OnCall/OnCallSendFailure";
import { getNotReachedStatusMessage } from "../../../../Server/Utils/OnCall/NotificationRequestFailure";
import {
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import UserNotificationStatus from "../../../../Types/UserNotification/UserNotificationStatus";
import { AxiosError, AxiosResponse, InternalAxiosRequestConfig } from "axios";

const NOTIFICATION_ID: ObjectID = new ObjectID(
  "0c0c0000-0000-4000-8000-0000000000b1",
);

const FALLBACK: string = "Error sending SMS.";

const read: jest.Mock = UserOnCallLogTimelineService.findOneById as jest.Mock;
const write: jest.Mock = UserOnCallLogTimelineService.updateOneBy as jest.Mock;
const warn: jest.Mock = logger.warn as jest.Mock;
const logError: jest.Mock = logger.error as jest.Mock;

const ALL_STATUSES: Array<UserNotificationStatus> = Object.values(
  UserNotificationStatus,
);

const ALL_BUT_SENDING: Array<UserNotificationStatus> = ALL_STATUSES.filter(
  (status: UserNotificationStatus) => {
    return status !== UserNotificationStatus.Sending;
  },
);

let timeline: OnCallTimelineRows;

function notification(): StoredOnCallNotification {
  return timeline.get(NOTIFICATION_ID)!;
}

beforeEach(() => {
  jest.clearAllMocks();

  timeline = new OnCallTimelineRows();
  timeline.add(NOTIFICATION_ID, UserNotificationStatus.Sending);
  timeline.standIn(UserOnCallLogTimelineService);
});

function failedAt(code: string, syscall: string): APIException {
  return requestFailedWith(
    socketError({
      message: `${syscall} ${code} 10.0.0.5:3002`,
      code: code,
      syscall: syscall,
    }),
  );
}

// The ways a request that never reached the service throws.
const NOT_REACHED: Array<[string, () => unknown, string]> = [
  ["refused", refusedRequestError, "ECONNREFUSED"],
  [
    "refused on every address of the name",
    refusedOnEveryAddressRequestError,
    "ECONNREFUSED",
  ],
  [
    "a name not found",
    (): unknown => {
      return unresolvedNameRequestError("ENOTFOUND");
    },
    "ENOTFOUND",
  ],
  [
    "a name not resolved yet",
    (): unknown => {
      return unresolvedNameRequestError("EAI_AGAIN");
    },
    "EAI_AGAIN",
  ],
  [
    "a host unreachable, raised by connect()",
    (): unknown => {
      return failedAt("EHOSTUNREACH", "connect");
    },
    "EHOSTUNREACH",
  ],
  [
    "a connection not opened in time, raised by connect()",
    (): unknown => {
      return failedAt("ETIMEDOUT", "connect");
    },
    "ETIMEDOUT",
  ],
];

// The ways a request that may have reached the service throws.
const NO_ANSWER: Array<[string, () => unknown, string]> = [
  ["reset", resetRequestError, "ECONNRESET"],
  ["hung up", hungUpRequestError, "ECONNRESET"],
  ["timed out", timedOutRequestError, "ECONNABORTED"],
  [
    "a broken pipe while writing the request",
    (): unknown => {
      return failedAt("EPIPE", "write");
    },
    "EPIPE",
  ],
  [
    "a timeout on a connection already open",
    (): unknown => {
      return failedAt("ETIMEDOUT", "read");
    },
    "ETIMEDOUT",
  ],
  [
    "the AxiosError itself, unwrapped",
    (): unknown => {
      return resetRequestError().error;
    },
    "ECONNRESET",
  ],
];

describe("a request to the Notification service that threw (recordNotificationRequestFailure)", () => {
  async function fail(error: unknown): Promise<void> {
    await expect(
      recordNotificationRequestFailure({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        error: error,
        fallbackStatusMessage: FALLBACK,
      }),
    ).resolves.toBeUndefined();
  }

  describe("never reached the service: nothing was sent", () => {
    test.each(NOT_REACHED)(
      "%s: Sending becomes Error, saying the service could not be reached",
      async (_name: string, error: () => unknown, code: string) => {
        await fail(error());

        expect(notification()).toMatchObject({
          status: UserNotificationStatus.Error,
          statusMessage: `Could not reach the Notification service to send this (${code}).`,
        });
        expect(timeline.writes).toEqual([
          {
            id: NOTIFICATION_ID.toString(),
            data: {
              status: UserNotificationStatus.Error,
              statusMessage: getNotReachedStatusMessage(code),
            },
          },
        ]);
      },
    );

    test("written at the status and version read, as root", async () => {
      await fail(refusedRequestError());

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
          status: UserNotificationStatus.Error,
          statusMessage:
            "Could not reach the Notification service to send this (ECONNREFUSED).",
        },
        props: { isRoot: true },
      });
    });

    test("the message names no address of the service - the error's own words do", async () => {
      const error: APIException = refusedRequestError();

      expect(error.message).toContain(NOTIFICATION_SERVICE_URL);

      await fail(error);

      expect(notification().statusMessage).not.toMatch(
        /10\.0\.0\.5|app:3002|http|api\/notification|:\d{2,5}/,
      );
    });

    test.each(ALL_BUT_SENDING)(
      "a notification already %s - its result, a report, the person's answer - stays",
      async (status: UserNotificationStatus) => {
        notification().status = status;
        notification().statusMessage = "written first";

        await fail(refusedRequestError());

        expect(write).not.toHaveBeenCalled();
        expect(notification()).toMatchObject({
          status: status,
          statusMessage: "written first",
          version: 1,
        });
      },
    );

    test("the stuck check's verdict stays: only the send's own result may replace it", async () => {
      notification().status = UserNotificationStatus.Error;
      notification().statusMessage = STUCK_NOTIFICATION_STATUS_MESSAGE;

      await fail(refusedRequestError());

      expect(write).not.toHaveBeenCalled();
      expect(notification().statusMessage).toBe(
        STUCK_NOTIFICATION_STATUS_MESSAGE,
      );
    });

    test.each([
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.Sent,
      UserNotificationStatus.NotAnswered,
      UserNotificationStatus.Error,
    ])(
      "%s landing between the read and the write stays: the write names no row, the notification is read again, and left",
      async (status: UserNotificationStatus) => {
        timeline.whenRead((row: StoredOnCallNotification) => {
          row.status = status;
          row.statusMessage = "landed meanwhile";
        });

        await fail(refusedRequestError());

        expect(notification()).toMatchObject({
          status: status,
          statusMessage: "landed meanwhile",
        });
        expect(read).toHaveBeenCalledTimes(2);
        expect(write).toHaveBeenCalledTimes(1);
        expect(timeline.writes).toEqual([]);
      },
    );

    test("a message landing between the read and the write, Sending kept, moves the version on: read again, then written", async () => {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.statusMessage = "Sending SMS.";
      });

      await fail(refusedRequestError());

      expect(read).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenCalledTimes(2);
      expect(write.mock.calls[1]![0]).toMatchObject({
        query: { status: UserNotificationStatus.Sending, version: 2 },
      });
      expect(notification().status).toBe(UserNotificationStatus.Error);
    });

    test("a notification that is gone is left: nothing to write", async () => {
      timeline.rows.clear();

      await fail(refusedRequestError());

      expect(read).toHaveBeenCalledTimes(1);
      expect(write).not.toHaveBeenCalled();
    });

    test("logged as an error, with the id and the error the request threw", async () => {
      await fail(refusedRequestError());

      expect(warn).not.toHaveBeenCalled();
      expect(logError).toHaveBeenCalledTimes(1);

      const logged: string = String(logError.mock.calls[0]![0]);

      expect(logged).toContain(NOTIFICATION_ID.toString());
      expect(logged).toContain("never reached the Notification service");
      expect(logged).toContain("connect ECONNREFUSED 10.0.0.5:3002");
    });
  });

  describe("no answer: whether it was sent is not known here", () => {
    test.each(NO_ANSWER)(
      "%s: the notification is neither read nor written - it stays Sending for the service's own result",
      async (_name: string, error: () => unknown, code: string) => {
        await fail(error());

        expect(read).not.toHaveBeenCalled();
        expect(write).not.toHaveBeenCalled();
        expect(notification()).toMatchObject({
          status: UserNotificationStatus.Sending,
          version: 1,
        });

        expect(logError).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);

        const logged: string = String(warn.mock.calls[0]![0]);

        expect(logged).toContain(NOTIFICATION_ID.toString());
        expect(logged).toContain(`(${code})`);
        expect(logged).toContain("stuck check after 15 minutes");
      },
    );

    test.each([
      UserNotificationStatus.Sent,
      UserNotificationStatus.Acknowledged,
      UserNotificationStatus.NotAnswered,
      UserNotificationStatus.Error,
    ])(
      "the service's own %s, written before the answer was lost, stays",
      async (status: UserNotificationStatus) => {
        notification().status = status;
        notification().statusMessage = "the service's own";

        await fail(resetRequestError());

        expect(notification()).toMatchObject({
          status: status,
          statusMessage: "the service's own",
        });
        expect(write).not.toHaveBeenCalled();
      },
    );

    test("the warning carries what the request threw", async () => {
      await fail(timedOutRequestError());

      expect(String(warn.mock.calls[0]![0])).toContain(
        "timeout of 300ms exceeded",
      );
    });

    test("no answer touches no database: one that is down changes nothing, and logs no error", async () => {
      read.mockRejectedValue(new Error("connection terminated") as never);
      write.mockRejectedValue(new Error("connection terminated") as never);

      await fail(resetRequestError());

      expect(read).not.toHaveBeenCalled();
      expect(logError).not.toHaveBeenCalled();
    });
  });

  describe("not a request that got no answer: the send failed before the request", () => {
    test("Sending becomes Error, with the failure's words", async () => {
      await fail(new BadDataException("Email is not in valid format."));

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: "Email is not in valid format.",
      });
      expect(warn).not.toHaveBeenCalled();
    });

    test("an APIException with no request error in it: its words", async () => {
      await fail(new APIException("URL is required"));

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: "URL is required",
      });
    });

    test("an answer that is an HTTP error, were one thrown: Error with its words - the service said it did not send it", async () => {
      const answered: AxiosError = new AxiosError(
        "Request failed with status code 500",
        AxiosError.ERR_BAD_RESPONSE,
        {
          url: NOTIFICATION_SERVICE_URL,
        } as unknown as InternalAxiosRequestConfig,
        undefined,
        { status: 500, data: {} } as unknown as AxiosResponse,
      );

      await fail(answered);

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: "Request failed with status code 500",
      });
    });

    test.each([
      ["an Error with no words", new Error("")],
      ["undefined", undefined],
      ["null", null],
      ["an empty string", ""],
      ["an object", { reason: "unknown" }],
      ["a number", 500],
    ])("%s: the channel's own words", async (_name: string, error: unknown) => {
      await fail(error);

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: FALLBACK,
      });
    });

    test("a string thrown: its words", async () => {
      await fail("boom");

      expect(notification().statusMessage).toBe("boom");
    });

    test("a message longer than the column is cut to its 500 characters", async () => {
      await fail(new Error("x".repeat(900)));

      expect(notification().statusMessage).toBe("x".repeat(500));
    });

    test.each(ALL_BUT_SENDING)(
      "over Sending only: %s stays",
      async (status: UserNotificationStatus) => {
        notification().status = status;

        await fail(new Error("Email is not in valid format."));

        expect(write).not.toHaveBeenCalled();
        expect(notification().status).toBe(status);
      },
    );
  });

  describe("a database that fails", () => {
    test("a read that fails is logged, never thrown: a send's failure handler has nobody to hand it to", async () => {
      read.mockRejectedValueOnce(new Error("connection terminated") as never);

      await fail(refusedRequestError());

      expect(logError).toHaveBeenCalledWith(
        expect.stringContaining(
          `On-call notification ${NOTIFICATION_ID.toString()}: could not record that it was not sent`,
        ),
      );
      expect(
        String(logError.mock.calls[logError.mock.calls.length - 1]![0]),
      ).toContain("connection terminated");
      expect(notification().status).toBe(UserNotificationStatus.Sending);
    });

    test("a write that fails is logged with what it would have said, never thrown", async () => {
      write.mockRejectedValueOnce(new Error("deadlock detected") as never);

      await fail(new Error("Email is not in valid format."));

      const logged: string = String(
        logError.mock.calls[logError.mock.calls.length - 1]![0],
      );

      expect(logged).toContain("deadlock detected");
      expect(logged).toContain("Email is not in valid format.");
    });

    test("a notification that kept changing under every try is left, after three", async () => {
      for (let i: number = 0; i < MAX_NOTIFICATION_WRITE_ATTEMPTS; i++) {
        timeline.whenRead((row: StoredOnCallNotification) => {
          row.statusMessage = `changed ${i}`;
        });
      }

      await fail(refusedRequestError());

      expect(read).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
      expect(write).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
      expect(notification().status).toBe(UserNotificationStatus.Sending);
    });
  });
});

describe("a send in this process that threw (recordSendFailure)", () => {
  async function fail(error: unknown): Promise<void> {
    await expect(
      recordSendFailure({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        error: error,
        fallbackStatusMessage: "Error sending push notification.",
      }),
    ).resolves.toBeUndefined();
  }

  test("Sending becomes Error with the failure's words - its request errors were not to the Notification service", async () => {
    const slackRefused: APIException = refusedRequestError();

    await fail(slackRefused);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: slackRefused.message,
    });
  });

  test.each([...NOT_REACHED, ...NO_ANSWER])(
    "%s: Error too, with its words - the sender writes its own result, and this covers a failure before it",
    async (_name: string, error: () => unknown) => {
      const thrown: unknown = error();

      await fail(thrown);

      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Error,
        statusMessage: (thrown as Error).message,
      });
      expect(warn).not.toHaveBeenCalled();
    },
  );

  test.each([
    ["an Error with no words", new Error("")],
    ["undefined", undefined],
    ["an object", { reason: "unknown" }],
  ])("%s: the channel's own words", async (_name: string, error: unknown) => {
    await fail(error);

    expect(notification().statusMessage).toBe(
      "Error sending push notification.",
    );
  });

  test.each(ALL_BUT_SENDING)(
    "the sender's own %s, written before it threw, stays",
    async (status: UserNotificationStatus) => {
      notification().status = status;
      notification().statusMessage = "the sender's own";

      await fail(new Error("Failed to send push notification"));

      expect(write).not.toHaveBeenCalled();
      expect(notification()).toMatchObject({
        status: status,
        statusMessage: "the sender's own",
      });
    },
  );

  test("an acknowledgement between the read and the write stays", async () => {
    timeline.whenRead((row: StoredOnCallNotification) => {
      row.status = UserNotificationStatus.Acknowledged;
    });

    await fail(new Error("No devices provided"));

    expect(notification().status).toBe(UserNotificationStatus.Acknowledged);
    expect(timeline.writes).toEqual([]);
  });

  test("a database that fails is logged, never thrown", async () => {
    read.mockRejectedValueOnce(new Error("connection terminated") as never);

    await fail(new Error("No devices provided"));

    expect(
      String(logError.mock.calls[logError.mock.calls.length - 1]![0]),
    ).toContain("connection terminated");
  });
});

describe("the handlers a send's .catch takes", () => {
  test("whenNotificationRequestFails: the send's promise settles, and the notification says what the error says", async () => {
    await expect(
      Promise.reject(refusedRequestError()).catch(
        whenNotificationRequestFails({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          fallbackStatusMessage: FALLBACK,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage:
        "Could not reach the Notification service to send this (ECONNREFUSED).",
    });
  });

  test("whenNotificationRequestFails: no answer leaves it", async () => {
    await Promise.reject(timedOutRequestError()).catch(
      whenNotificationRequestFails({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        fallbackStatusMessage: FALLBACK,
      }),
    );

    expect(notification().status).toBe(UserNotificationStatus.Sending);
    expect(write).not.toHaveBeenCalled();
  });

  test("whenNotificationRequestFails: a failure before the request, with no words - the fallback given", async () => {
    await Promise.reject(new Error("")).catch(
      whenNotificationRequestFails({
        userOnCallLogTimelineId: NOTIFICATION_ID,
        fallbackStatusMessage: "Error sending email.",
      }),
    );

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "Error sending email.",
    });
  });

  test("whenSendFails: Error with the failure's words", async () => {
    await expect(
      Promise.reject(new Error("No devices provided")).catch(
        whenSendFails({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          fallbackStatusMessage: "Error sending push notification.",
        }),
      ),
    ).resolves.toBeUndefined();

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: "No devices provided",
    });
  });

  test("each handler is for its own notification: two at once write each their own", async () => {
    const otherId: ObjectID = new ObjectID(
      "0c0c0000-0000-4000-8000-0000000000b2",
    );
    timeline.add(otherId, UserNotificationStatus.Sending);

    await Promise.all([
      Promise.reject(refusedRequestError()).catch(
        whenNotificationRequestFails({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          fallbackStatusMessage: FALLBACK,
        }),
      ),
      Promise.reject(new Error("No devices provided")).catch(
        whenSendFails({
          userOnCallLogTimelineId: otherId,
          fallbackStatusMessage: FALLBACK,
        }),
      ),
    ]);

    expect(notification().statusMessage).toBe(
      "Could not reach the Notification service to send this (ECONNREFUSED).",
    );
    expect(timeline.get(otherId)!.statusMessage).toBe("No devices provided");
  });

  test("neither rejects when the database fails: nothing is left unhandled", async () => {
    read.mockRejectedValue(new Error("connection terminated") as never);

    await expect(
      Promise.reject(refusedRequestError()).catch(
        whenNotificationRequestFails({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          fallbackStatusMessage: FALLBACK,
        }),
      ),
    ).resolves.toBeUndefined();
    await expect(
      Promise.reject(new Error("boom")).catch(
        whenSendFails({
          userOnCallLogTimelineId: NOTIFICATION_ID,
          fallbackStatusMessage: FALLBACK,
        }),
      ),
    ).resolves.toBeUndefined();
  });
});
