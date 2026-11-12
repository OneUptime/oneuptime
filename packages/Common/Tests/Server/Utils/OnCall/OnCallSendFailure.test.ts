import { beforeEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";
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
 * A request the Notification service answered with an error does not
 * throw: API.post hands the answer back (issue #7083). The send hands it to
 * whenNotificationRequestAnswers, and the notification says Error with the
 * answer's own words - "refused" for a 4xx, "may not have been sent" for
 * any other - over Sending, or over the stuck check's verdict: the
 * request's own result, come late.
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
  getAnsweredFailureStatusMessage,
  MAX_ANSWER_WORDS_LENGTH,
  recordNotificationRequestAnswer,
  recordNotificationRequestFailure,
  recordSendFailure,
  whenNotificationRequestAnswers,
  whenNotificationRequestFails,
  whenSendFails,
} from "../../../../Server/Utils/OnCall/OnCallSendFailure";
import { getNotReachedStatusMessage } from "../../../../Server/Utils/OnCall/NotificationRequestFailure";
import {
  MAX_NOTIFICATION_WRITE_ATTEMPTS,
  STUCK_NOTIFICATION_STATUS_MESSAGE,
} from "../../../../Server/Utils/OnCall/OnCallNotificationStatus";
import { REDACTED } from "../../../../Server/Utils/LogRedaction";
import HTTPErrorResponse from "../../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../../Types/JSON";
import APIException from "../../../../Types/Exception/ApiException";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ExceptionMessages from "../../../../Types/Exception/ExceptionMessages";
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

/*
 * ISSUE #7083: A REQUEST THE NOTIFICATION SERVICE ANSWERED WITH AN ERROR.
 *
 * API.post hands an error answer back rather than throwing it, so no .catch
 * ever heard of one: the notification said Sending until the stuck check
 * said it may not have gone out, and the answer's words - why it was
 * refused - were lost.
 */

const REFUSED: string = "The Notification service refused to send this";
const ANSWERED_WITH_AN_ERROR: string =
  "The Notification service answered with an error";

// An answer as API.post hands one back: its status, and its body.
function answered(
  statusCode: number,
  body: JSONObject | string,
): HTTPErrorResponse {
  return new HTTPErrorResponse(statusCode, body as JSONObject, {});
}

function sayFor(answer: HTTPErrorResponse): string {
  return getAnsweredFailureStatusMessage({
    statusCode: answer.statusCode,
    message: answer.message,
  });
}

// What a proxy in front of the service answers when the service is down.
const PROXY_ERROR_PAGE: string =
  "<html>\r\n<head><title>502 Bad Gateway</title></head>\r\n<body>\r\n<center><h1>502 Bad Gateway</h1></center>\r\n<hr><center>nginx</center>\r\n</body>\r\n</html>\r\n";

describe("what an error answer says (getAnsweredFailureStatusMessage)", () => {
  test("a refusal - a 4xx - is sure, in the service's own words", () => {
    expect(
      sayFor(answered(400, { message: "Email ana@ is not in valid format." })),
    ).toBe(
      "The Notification service refused to send this (HTTP 400): Email ana@ is not in valid format.",
    );
  });

  test("any other error answer is not sure: the service may have failed after it went out", () => {
    expect(sayFor(answered(500, { message: "Server Error" }))).toBe(
      "The Notification service answered with an error (HTTP 500), so this may not have been sent: Server Error.",
    );
  });

  test.each([400, 401, 403, 404, 405, 409, 413, 415, 422, 429, 499])(
    "HTTP %i: refused",
    (statusCode: number) => {
      expect(
        getAnsweredFailureStatusMessage({
          statusCode: statusCode,
          message: "No",
        }),
      ).toBe(`${REFUSED} (HTTP ${statusCode}): No.`);
    },
  );

  test.each([500, 501, 502, 503, 504, 599, 399, 302, 200, 100])(
    "HTTP %i: may not have been sent",
    (statusCode: number) => {
      expect(
        getAnsweredFailureStatusMessage({
          statusCode: statusCode,
          message: "Server Error",
        }),
      ).toBe(
        `${ANSWERED_WITH_AN_ERROR} (HTTP ${statusCode}), so this may not have been sent: Server Error.`,
      );
    },
  );

  const NOT_A_STATUS: Array<[string, number | undefined]> = [
    ["none", undefined],
    ["HTTPResponse's -1, never set", -1],
    ["0", 0],
    ["99", 99],
    ["600", 600],
    ["a fraction", 400.5],
    ["NaN", Number.NaN],
    ["Infinity", Number.POSITIVE_INFINITY],
  ];

  test.each(NOT_A_STATUS)(
    "a status that is not one (%s): none named, and not sure",
    (_name: string, statusCode: number | undefined) => {
      expect(
        getAnsweredFailureStatusMessage({
          statusCode: statusCode,
          message: "Server Error",
        }),
      ).toBe(
        "The Notification service answered with an error, so this may not have been sent: Server Error.",
      );
    },
  );

  const NO_WORDS: Array<[string, string | undefined]> = [
    ["no words", undefined],
    ["empty words", ""],
    ["only white space", "  \n\t \r\n "],
  ];

  test.each(NO_WORDS)(
    "%s: the sentence alone",
    (_name: string, message: string | undefined) => {
      expect(
        getAnsweredFailureStatusMessage({ statusCode: 400, message: message }),
      ).toBe(`${REFUSED} (HTTP 400).`);
      expect(
        getAnsweredFailureStatusMessage({ statusCode: 503, message: message }),
      ).toBe(
        `${ANSWERED_WITH_AN_ERROR} (HTTP 503), so this may not have been sent.`,
      );
      expect(getAnsweredFailureStatusMessage({ message: message })).toBe(
        `${ANSWERED_WITH_AN_ERROR}, so this may not have been sent.`,
      );
    },
  );

  test("an answer with no body has no words", () => {
    expect(sayFor(answered(503, {}))).toBe(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 503), so this may not have been sent.`,
    );
  });

  test("an HTML error page from a proxy in front of the service has no words: no markup on a timeline", () => {
    const answer: HTTPErrorResponse = answered(502, PROXY_ERROR_PAGE);

    // HTTPErrorResponse hands the page back whole, as its message.
    expect(answer.message).toBe(PROXY_ERROR_PAGE);

    expect(sayFor(answer)).toBe(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 502), so this may not have been sent.`,
    );
  });

  test.each([
    "  <!DOCTYPE html><html><body>Service Unavailable</body></html>",
    '\n<?xml version="1.0"?><error>Service Unavailable</error>',
    "<h1>Forbidden</h1>",
  ])(
    "markup after white space, a doctype or a lone tag is markup too: %j",
    (page: string) => {
      expect(
        getAnsweredFailureStatusMessage({ statusCode: 403, message: page }),
      ).toBe(`${REFUSED} (HTTP 403).`);
    },
  );

  test("words that only mention a < are words", () => {
    expect(
      getAnsweredFailureStatusMessage({
        statusCode: 400,
        message: "Retries must be < 5",
      }),
    ).toBe(`${REFUSED} (HTTP 400): Retries must be < 5.`);
  });

  test("the answer's words, wherever HTTPErrorResponse finds them: a nested error's message", () => {
    expect(
      sayFor(answered(500, { error: { message: "SMTP is not configured" } })),
    ).toBe(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 500), so this may not have been sent: SMTP is not configured.`,
    );
  });

  test("on one line: a run of white space - new lines, tabs - is one space", () => {
    expect(
      getAnsweredFailureStatusMessage({
        statusCode: 400,
        message: "  Email\r\n  is not\tin valid\n\nformat  ",
      }),
    ).toBe(`${REFUSED} (HTTP 400): Email is not in valid format.`);
  });

  test.each([
    ["Not sent.", "Not sent."],
    ["Not sent!", "Not sent!"],
    ["Not sent?", "Not sent?"],
    ["Not sent…", "Not sent…"],
    ["Not sent", "Not sent."],
    ["Not sent. ", "Not sent."],
  ])("a sentence ends once: %j says %j", (message: string, said: string) => {
    expect(
      getAnsweredFailureStatusMessage({ statusCode: 400, message: message }),
    ).toBe(`${REFUSED} (HTTP 400): ${said}`);
  });

  test("an address in the words is never shown - the service's own, or anything it called", () => {
    expect(
      getAnsweredFailureStatusMessage({
        statusCode: 500,
        message:
          "Could not reach http://10.0.0.5:3002/api/notification/sms/send or smtps://mail.internal:465.",
      }),
    ).toBe(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 500), so this may not have been sent: Could not reach [address] or [address].`,
    );
  });

  test("an address with credentials in it is one word too: none of it is shown", () => {
    const said: string = getAnsweredFailureStatusMessage({
      statusCode: 502,
      message:
        "Webhook https://ops:hunter2@hooks.example.com/T000?token=abc failed",
    });

    expect(said).toBe(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 502), so this may not have been sent: Webhook [address] failed.`,
    );
    expect(said).not.toContain("hunter2");
    expect(said).not.toContain("example.com");
  });

  test("a credential in the words is never shown (redactLogString)", () => {
    const bearer: string = "sk_live_51HxYzAbCdEf0123456789";
    const slackToken: string = "xoxb-1234567890-abcdefghij";

    const said: string = getAnsweredFailureStatusMessage({
      statusCode: 401,
      message: `Twilio refused Authorization: Bearer ${bearer} and Slack refused ${slackToken}`,
    });

    expect(said.startsWith(`${REFUSED} (HTTP 401): Twilio refused`)).toBe(true);
    expect(said).toContain(REDACTED);
    expect(said).not.toContain(bearer);
    expect(said).not.toContain(slackToken);
  });

  test(`words of ${MAX_ANSWER_WORDS_LENGTH} characters are kept whole`, () => {
    const words: string = `${"word ".repeat(59)}word.`;

    expect(words).toHaveLength(MAX_ANSWER_WORDS_LENGTH);
    expect(
      getAnsweredFailureStatusMessage({ statusCode: 400, message: words }),
    ).toBe(`${REFUSED} (HTTP 400): ${words}`);
  });

  test(`longer words are cut to ${MAX_ANSWER_WORDS_LENGTH} characters, ending in an ellipsis and no period`, () => {
    const said: string = getAnsweredFailureStatusMessage({
      statusCode: 400,
      message: `${"word ".repeat(59)}words.`,
    });
    const kept: string = said.substring(`${REFUSED} (HTTP 400): `.length);

    expect(kept).toBe(`${"word ".repeat(59)}word…`);
    expect(kept).toHaveLength(MAX_ANSWER_WORDS_LENGTH);
  });

  test("a cut that lands on a space leaves no space before the ellipsis", () => {
    const said: string = getAnsweredFailureStatusMessage({
      statusCode: 400,
      message: "abcdefghijkl ".repeat(30),
    });

    expect(said).toBe(
      `${REFUSED} (HTTP 400): ${"abcdefghijkl ".repeat(22)}abcdefghijkl…`,
    );
  });

  test("however long the answer, what is said fits the notification's message - its 500 characters - whole", () => {
    const said: string = getAnsweredFailureStatusMessage({
      statusCode: 503,
      message: "a much longer answer ".repeat(1000),
    });

    expect(said.length).toBeLessThanOrEqual(500);
    expect(said.endsWith("…")).toBe(true);
  });
});

describe("a request the Notification service answered (recordNotificationRequestAnswer)", () => {
  async function answer(value: unknown): Promise<boolean> {
    return await recordNotificationRequestAnswer({
      userOnCallLogTimelineId: NOTIFICATION_ID,
      answer: value,
    });
  }

  const REFUSED_SMS: string = `${REFUSED} (HTTP 400): Phone number +1 555 is not valid.`;

  function refusedSms(): HTTPErrorResponse {
    return answered(400, { message: "Phone number +1 555 is not valid." });
  }

  test("an error answer: Sending becomes Error with its words, written at the status and the version read, as root", async () => {
    await expect(answer(refusedSms())).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: REFUSED_SMS,
      version: 2,
    });
    expect(read).toHaveBeenCalledWith({
      id: NOTIFICATION_ID,
      // Its message too: the stuck check's verdict is told by it.
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
        status: UserNotificationStatus.Error,
        statusMessage: REFUSED_SMS,
      },
      props: { isRoot: true },
    });
    expect(timeline.writes).toHaveLength(1);
  });

  test("logged as an error, with the id and what the notification says now", async () => {
    await answer(answered(503, { message: "Service Unavailable" }));

    expect(logError).toHaveBeenCalledTimes(1);

    const logged: string = String(logError.mock.calls[0]![0]);

    expect(logged).toContain(NOTIFICATION_ID.toString());
    expect(logged).toContain(
      "the Notification service answered the request to send it with an error",
    );
    expect(logged).toContain(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 503), so this may not have been sent: Service Unavailable.`,
    );
  });

  test("a proxy's error page: Error, without its markup", async () => {
    await answer(answered(502, PROXY_ERROR_PAGE));

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: `${ANSWERED_WITH_AN_ERROR} (HTTP 502), so this may not have been sent.`,
    });
  });

  const NOT_AN_ERROR_ANSWER: Array<[string, unknown]> = [
    [
      "a success answer",
      new HTTPResponse<JSONObject>(200, { message: "Sent." }, {}),
    ],
    [
      "an answer that says it was not delivered, but is not an error",
      new HTTPResponse<JSONObject>(
        200,
        { ok: false, statusCode: 503, message: "Not delivered." },
        {},
      ),
    ],
    ["nothing", undefined],
    ["null", null],
    ["words", "Server Error"],
    [
      "an object shaped like an error answer, which is not one",
      { statusCode: 500, message: "Server Error" },
    ],
    ["an error", new Error("Server Error")],
  ];

  test.each(NOT_AN_ERROR_ANSWER)(
    "%s: nothing read, nothing written - the Notification service writes its result",
    async (_name: string, value: unknown) => {
      await expect(answer(value)).resolves.toBe(false);

      expect(read).not.toHaveBeenCalled();
      expect(write).not.toHaveBeenCalled();
      expect(notification()).toMatchObject({
        status: UserNotificationStatus.Sending,
        version: 1,
      });
      expect(logError).not.toHaveBeenCalled();
    },
  );

  test("the stuck check's verdict is replaced: this is the request's own result, come late", async () => {
    notification().status = UserNotificationStatus.Error;
    notification().statusMessage = STUCK_NOTIFICATION_STATUS_MESSAGE;

    await expect(answer(refusedSms())).resolves.toBe(true);

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: REFUSED_SMS,
    });
    expect(write.mock.calls[0]![0]).toMatchObject({
      query: { status: UserNotificationStatus.Error, version: 1 },
    });
  });

  test.each(ALL_BUT_SENDING)(
    "a notification already %s - the service's own result, a report, the person's answer - stays",
    async (status: UserNotificationStatus) => {
      notification().status = status;
      notification().statusMessage = "written first";

      await expect(
        answer(answered(500, { message: "Server Error" })),
      ).resolves.toBe(false);

      expect(write).not.toHaveBeenCalled();
      expect(notification()).toMatchObject({
        status: status,
        statusMessage: "written first",
        version: 1,
      });
      expect(logError).not.toHaveBeenCalled();
    },
  );

  test("the service's own Error, written by its sender before the route failed, stays in the sender's words", async () => {
    notification().status = UserNotificationStatus.Error;
    notification().statusMessage = "Twilio: The 'To' number is not valid.";

    await expect(
      answer(answered(500, { message: "Server Error" })),
    ).resolves.toBe(false);

    expect(notification().statusMessage).toBe(
      "Twilio: The 'To' number is not valid.",
    );
  });

  test("a blocked project's refusal - written on the notification before the client answered with it - stays", async () => {
    const reason: string = `SMS not sent: ${ExceptionMessages.ProjectBlocked}`;

    notification().status = UserNotificationStatus.Error;
    notification().statusMessage = reason;

    await expect(answer(answered(403, { message: reason }))).resolves.toBe(
      false,
    );

    expect(notification().statusMessage).toBe(reason);
  });

  test.each([
    UserNotificationStatus.Sent,
    UserNotificationStatus.Acknowledged,
    UserNotificationStatus.PassedOn,
    UserNotificationStatus.Error,
  ])(
    "%s landing between the read and the write stays: the write names no row, the notification is read again, and left",
    async (status: UserNotificationStatus) => {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.status = status;
        row.statusMessage = "landed meanwhile";
      });

      await expect(answer(refusedSms())).resolves.toBe(false);

      expect(notification()).toMatchObject({
        status: status,
        statusMessage: "landed meanwhile",
      });
      expect(read).toHaveBeenCalledTimes(2);
      expect(write).toHaveBeenCalledTimes(1);
      expect(timeline.writes).toEqual([]);
      expect(logError).not.toHaveBeenCalled();
    },
  );

  test("a notification that is gone: nothing written", async () => {
    timeline.rows.clear();

    await expect(answer(refusedSms())).resolves.toBe(false);

    expect(write).not.toHaveBeenCalled();
  });

  test("a read that fails is logged with what it would have said, never thrown", async () => {
    read.mockRejectedValueOnce(new Error("connection terminated") as never);

    await expect(answer(refusedSms())).resolves.toBe(false);

    const logged: string = String(logError.mock.calls[0]![0]);

    expect(logged).toContain(
      `On-call notification ${NOTIFICATION_ID.toString()}: could not record that the Notification service answered with an error (${REFUSED_SMS})`,
    );
    expect(logged).toContain("connection terminated");
    expect(notification().status).toBe(UserNotificationStatus.Sending);
  });

  test("a write that fails is logged, never thrown", async () => {
    write.mockRejectedValueOnce(new Error("deadlock detected") as never);

    await expect(answer(refusedSms())).resolves.toBe(false);

    expect(String(logError.mock.calls[0]![0])).toContain("deadlock detected");
  });

  test("a notification that kept changing under every try is left, after three", async () => {
    for (let i: number = 0; i < MAX_NOTIFICATION_WRITE_ATTEMPTS; i++) {
      timeline.whenRead((row: StoredOnCallNotification) => {
        row.statusMessage = `changed ${i}`;
      });
    }

    await expect(answer(refusedSms())).resolves.toBe(false);

    expect(write).toHaveBeenCalledTimes(MAX_NOTIFICATION_WRITE_ATTEMPTS);
    expect(notification().status).toBe(UserNotificationStatus.Sending);
  });

  test("each answer is written on its own notification", async () => {
    const otherId: ObjectID = new ObjectID(
      "0c0c0000-0000-4000-8000-0000000000b3",
    );
    timeline.add(otherId, UserNotificationStatus.Sending);

    await Promise.all([
      answer(refusedSms()),
      recordNotificationRequestAnswer({
        userOnCallLogTimelineId: otherId,
        answer: answered(500, { message: "Server Error" }),
      }),
    ]);

    expect(notification().statusMessage).toBe(REFUSED_SMS);
    expect(timeline.get(otherId)!.statusMessage).toBe(
      `${ANSWERED_WITH_AN_ERROR} (HTTP 500), so this may not have been sent: Server Error.`,
    );
  });
});

describe("the handler a send's .then takes (whenNotificationRequestAnswers)", () => {
  // A send, as UserNotificationRuleService chains one.
  async function send(
    request: Promise<unknown>,
    notificationId: ObjectID = NOTIFICATION_ID,
  ): Promise<void> {
    await request
      .then(
        whenNotificationRequestAnswers({
          userOnCallLogTimelineId: notificationId,
        }),
      )
      .catch(
        whenNotificationRequestFails({
          userOnCallLogTimelineId: notificationId,
          fallbackStatusMessage: FALLBACK,
        }),
      );
  }

  test("an error answer settles the send's promise, and the notification says what the answer says", async () => {
    await expect(
      Promise.resolve(answered(503, { message: "Service Unavailable" })).then(
        whenNotificationRequestAnswers({
          userOnCallLogTimelineId: NOTIFICATION_ID,
        }),
      ),
    ).resolves.toBeUndefined();

    expect(notification()).toMatchObject({
      status: UserNotificationStatus.Error,
      statusMessage: `${ANSWERED_WITH_AN_ERROR} (HTTP 503), so this may not have been sent: Service Unavailable.`,
    });
  });

  test("a success answer leaves the notification to the service's own result", async () => {
    await send(
      Promise.resolve(new HTTPResponse<JSONObject>(200, {}, {}) as unknown),
    );

    expect(notification().status).toBe(UserNotificationStatus.Sending);
    expect(read).not.toHaveBeenCalled();
    expect(write).not.toHaveBeenCalled();
  });

  test("chained ahead of the .catch: an error answer is the answer handler's, a throw the failure handler's - each notification written once", async () => {
    const otherId: ObjectID = new ObjectID(
      "0c0c0000-0000-4000-8000-0000000000b4",
    );
    timeline.add(otherId, UserNotificationStatus.Sending);

    await Promise.all([
      send(Promise.resolve(answered(400, { message: "No" }) as unknown)),
      send(Promise.reject(refusedRequestError()), otherId),
    ]);

    expect(notification().statusMessage).toBe(`${REFUSED} (HTTP 400): No.`);
    expect(timeline.get(otherId)!.statusMessage).toBe(
      "Could not reach the Notification service to send this (ECONNREFUSED).",
    );
    expect(timeline.writes).toHaveLength(2);
  });

  test("a database that fails never rejects it: the .catch after it hears of the request only", async () => {
    read.mockRejectedValue(new Error("connection terminated") as never);

    const caught: Mock<(error: unknown) => void> = jest.fn();

    await expect(
      Promise.resolve(answered(500, { message: "Server Error" }) as unknown)
        .then(
          whenNotificationRequestAnswers({
            userOnCallLogTimelineId: NOTIFICATION_ID,
          }),
        )
        .catch(caught),
    ).resolves.toBeUndefined();

    expect(caught).not.toHaveBeenCalled();
  });
});
