import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * FAILED SIGN-INS INTO THE AUDIT LOG (issue #6788), as core hands them to
 * the recorder: nothing before the sign-in route has answered, only what
 * the count lets through, and only what OneUptime spells out of where the
 * request came from - never what the person typed. The count itself, in a
 * real Valkey, is FailedSignInAuditLogValkey.test.ts's.
 */

const evalMock: jest.Mock = jest.fn();
const isConnectedMock: jest.Mock = jest.fn();
const getClientMock: jest.Mock = jest.fn();
const hasRecorderMock: jest.Mock = jest.fn();
const recordSignInFailuresMock: jest.Mock = jest.fn();
const warnMock: jest.Mock = jest.fn();

jest.mock("../../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: (...args: Array<unknown>): unknown => {
        return getClientMock(...args);
      },
      isConnected: (...args: Array<unknown>): unknown => {
        return isConnectedMock(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Services/AuditLogService", () => {
  return {
    __esModule: true,
    default: {
      hasRecorder: (...args: Array<unknown>): unknown => {
        return hasRecorderMock(...args);
      },
      recordSignInFailures: (...args: Array<unknown>): unknown => {
        return recordSignInFailuresMock(...args);
      },
    },
  };
});

jest.mock("../../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: (...args: Array<unknown>): unknown => {
        return warnMock(...args);
      },
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

import FailedSignInAuditLog, {
  FailedSignInCount,
  FailedSignInInput,
} from "../../../../Server/Utils/AuditLog/FailedSignInAuditLog";
import {
  FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS,
  FAILED_SIGN_IN_WINDOW_IN_MINUTES,
  FAILED_SIGN_INS_RECORDED_PER_WINDOW,
  SignInFailureAuditEvent,
  SignInFailureReason,
} from "../../../../Types/AuditLog/AuditLogSignInFailure";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { SignInMethod } from "../../../../Types/UserSession/SessionSignIn";

const USER_ID: ObjectID = new ObjectID("6b1c0000-0000-4000-8000-0000000067a8");

const CHROME_ON_MAC: string =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const NOW: Date = new Date("2026-11-16T09:30:00.000Z");

type RequestStandIn = FailedSignInInput["req"];

function request(overrides?: {
  remoteAddress?: string | undefined;
  headers?: Record<string, string> | undefined;
}): RequestStandIn {
  return {
    headers: { "user-agent": CHROME_ON_MAC, ...(overrides?.headers || {}) },
    socket: {
      remoteAddress:
        overrides && "remoteAddress" in overrides
          ? overrides.remoteAddress
          : "203.0.113.7",
    },
  } as unknown as RequestStandIn;
}

function input(overrides?: Partial<FailedSignInInput>): FailedSignInInput {
  return {
    req: request(),
    userId: USER_ID,
    reason: SignInFailureReason.WrongPassword,
    signIn: { method: SignInMethod.Password },
    ...(overrides || {}),
  };
}

// Runs what record() left for after the answer.
async function afterTheAnswer(): Promise<void> {
  await new Promise<void>((resolve: () => void): void => {
    setTimeout(resolve, 0);
  });
  // The count and the write each take a turn of the loop.
  for (let turn: number = 0; turn < 5; turn++) {
    await Promise.resolve();
  }
}

function recordedEvents(): Array<SignInFailureAuditEvent> {
  return recordSignInFailuresMock.mock.calls.flatMap(
    (call: Array<unknown>): Array<SignInFailureAuditEvent> => {
      return call[0] as Array<SignInFailureAuditEvent>;
    },
  );
}

beforeEach(() => {
  evalMock.mockReset();
  isConnectedMock.mockReset();
  getClientMock.mockReset();
  hasRecorderMock.mockReset();
  recordSignInFailuresMock.mockReset();
  warnMock.mockReset();

  getClientMock.mockReturnValue({ eval: evalMock });
  isConnectedMock.mockReturnValue(true);
  hasRecorderMock.mockReturnValue(true);
  recordSignInFailuresMock.mockResolvedValue(undefined as never);
  // The first attempt of a window: recorded, standing for itself.
  evalMock.mockResolvedValue([1, 1, NOW.getTime()] as never);

  jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
});

afterEach(async () => {
  // What a test left for after the answer lands in that test's stand-ins.
  await afterTheAnswer();
  jest.restoreAllMocks();
});

describe("nothing happens before the sign-in route has answered", () => {
  test("record() returns at once, having counted and written nothing", () => {
    FailedSignInAuditLog.record(input());

    expect(evalMock).not.toHaveBeenCalled();
    expect(hasRecorderMock).not.toHaveBeenCalled();
    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  test("it returns nothing to wait for", () => {
    expect(FailedSignInAuditLog.record(input())).toBeUndefined();
  });

  test("after the answer, the attempt is counted and recorded", async () => {
    FailedSignInAuditLog.record(input());

    await afterTheAnswer();

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(recordSignInFailuresMock).toHaveBeenCalledTimes(1);
  });

  test("a recording that breaks never reaches the route", async () => {
    recordSignInFailuresMock.mockRejectedValue(
      new Error("ClickHouse is down") as never,
    );
    evalMock.mockRejectedValue(new Error("Valkey is down") as never);

    expect(() => {
      FailedSignInAuditLog.record(input());
    }).not.toThrow();

    await afterTheAnswer();

    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  test("a request with no headers or socket is still no error", async () => {
    expect(() => {
      FailedSignInAuditLog.record(
        input({ req: {} as unknown as RequestStandIn }),
      );
    }).not.toThrow();

    await afterTheAnswer();

    // Recorded all the same, saying nothing of where it came from.
    expect(recordedEvents()).toHaveLength(1);
    expect(recordedEvents()[0]?.device).toBeUndefined();
    expect(recordedEvents()[0]?.ipAddress).toBeUndefined();
  });

  /*
   * The socket's address is gone once its connection closes, which can be
   * before the entry is written: it is kept when the attempt is refused.
   */
  test("where the request came from is kept while the request is open", async () => {
    const req: RequestStandIn = request({ remoteAddress: "198.51.100.23" });

    FailedSignInAuditLog.record(input({ req }));

    (req as unknown as { socket: { remoteAddress?: string } }).socket = {};
    (req as unknown as { headers: Record<string, string> }).headers = {};

    await afterTheAnswer();

    expect(recordedEvents()[0]?.ipAddress).toBe("198.51.100.23");
    expect(recordedEvents()[0]?.device).toBe("Chrome 130 on macOS");
  });
});

describe("what an entry says of an attempt", () => {
  test("whose account, why it failed and how it tried", async () => {
    await FailedSignInAuditLog.recordNow(
      input({
        reason: SignInFailureReason.SingleSignOnRefused,
        signIn: {
          method: SignInMethod.Saml,
          ssoProviderName: "Acme Okta",
          ssoProjectId: new ObjectID("6b1c0000-0000-4000-8000-0000000067b9"),
        },
      }),
    );

    const event: SignInFailureAuditEvent = recordedEvents()[0]!;

    expect(event.userId.toString()).toBe(USER_ID.toString());
    expect(event.reason).toBe(SignInFailureReason.SingleSignOnRefused);
    expect(event.signIn).toEqual({
      method: SignInMethod.Saml,
      ssoProviderName: "Acme Okta",
      ssoProjectId: new ObjectID("6b1c0000-0000-4000-8000-0000000067b9"),
    });
    expect(ObjectID.isValidUUID(event.attemptId.toString())).toBe(true);
  });

  test("where it came from, in words OneUptime spells out, never the User-Agent itself", async () => {
    await FailedSignInAuditLog.recordNow(input());

    const event: SignInFailureAuditEvent = recordedEvents()[0]!;

    expect(event.device).toBe("Chrome 130 on macOS");
    expect(event.ipAddress).toBe("203.0.113.7");
    expect(JSON.stringify(event)).not.toContain("Mozilla");
  });

  test("an attempt recorded on its own stands for itself, with no first attempt", async () => {
    await FailedSignInAuditLog.recordNow(input());

    const event: SignInFailureAuditEvent = recordedEvents()[0]!;

    expect(event.failedAttempts).toBe(1);
    expect(event.firstFailedAt).toBeUndefined();
  });

  test("an entry that stands for the attempts counted before it says how many, and since when", async () => {
    const firstAt: Date = new Date("2026-11-16T08:12:44.000Z");
    evalMock.mockResolvedValue([1, 37, firstAt.getTime()] as never);

    await FailedSignInAuditLog.recordNow(input());

    const event: SignInFailureAuditEvent = recordedEvents()[0]!;

    expect(event.failedAttempts).toBe(37);
    expect(event.firstFailedAt?.toISOString()).toBe(firstAt.toISOString());
  });

  test("every attempt is its own, a fresh id each time", async () => {
    await FailedSignInAuditLog.recordNow(input());
    await FailedSignInAuditLog.recordNow(input());

    const [first, second] = recordedEvents();

    expect(first!.attemptId.toString()).not.toBe(second!.attemptId.toString());
  });
});

describe("what is not recorded", () => {
  test("an attempt the count holds back is only counted", async () => {
    evalMock.mockResolvedValue([0, 4, NOW.getTime()] as never);

    await FailedSignInAuditLog.recordNow(input());

    expect(evalMock).toHaveBeenCalledTimes(1);
    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  // The Community Edition has no recorder: not even a Valkey call.
  test("nothing is counted where nothing records", async () => {
    hasRecorderMock.mockReturnValue(false);

    await FailedSignInAuditLog.recordNow(input());

    expect(evalMock).not.toHaveBeenCalled();
    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  test("without Valkey nothing is recorded: the bound cannot be kept", async () => {
    isConnectedMock.mockReturnValue(false);

    await FailedSignInAuditLog.recordNow(input());

    expect(evalMock).not.toHaveBeenCalled();
    expect(recordSignInFailuresMock).not.toHaveBeenCalled();

    getClientMock.mockReturnValue(null);
    isConnectedMock.mockReturnValue(true);

    await FailedSignInAuditLog.recordNow(input());

    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  test("a count that fails records nothing, and never throws", async () => {
    evalMock.mockRejectedValue(new Error("NOSCRIPT") as never);

    await expect(
      FailedSignInAuditLog.recordNow(input()),
    ).resolves.toBeUndefined();
    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  test("an answer the script cannot have given records nothing", async () => {
    for (const answer of [
      null,
      "OK",
      [1, 1],
      [1, "1", NOW.getTime()],
      [1, 0, NOW.getTime()],
      [1, 1, 0],
      [1, 1.5, NOW.getTime()],
    ]) {
      evalMock.mockResolvedValue(answer as never);

      await FailedSignInAuditLog.recordNow(input());
    }

    expect(recordSignInFailuresMock).not.toHaveBeenCalled();
  });

  test("a recorder that fails never throws", async () => {
    recordSignInFailuresMock.mockRejectedValue(new Error("boom") as never);

    await expect(
      FailedSignInAuditLog.recordNow(input()),
    ).resolves.toBeUndefined();
  });
});

describe("the count", () => {
  test("is asked of the account, with the window, the bound and how long it is kept", async () => {
    await FailedSignInAuditLog.countAttempt({ userId: USER_ID, now: NOW });

    const args: Array<unknown> = evalMock.mock.calls[0] as Array<unknown>;

    expect(args[1]).toBe(1);
    expect(args[2]).toBe(FailedSignInAuditLog.getKey(USER_ID));
    expect(args.slice(3)).toEqual([
      String(NOW.getTime()),
      String(FAILED_SIGN_IN_WINDOW_IN_MINUTES * 60 * 1000),
      String(FAILED_SIGN_INS_RECORDED_PER_WINDOW),
      String(FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS * 24 * 60 * 60),
    ]);
  });

  test("ten an hour, and a count kept for thirty days", () => {
    expect(FAILED_SIGN_INS_RECORDED_PER_WINDOW).toBe(10);
    expect(FAILED_SIGN_IN_WINDOW_IN_MINUTES).toBe(60);
    expect(FAILED_SIGN_IN_COUNT_KEPT_FOR_DAYS).toBe(30);
  });

  // One node of a Valkey cluster holds an account's keys.
  test("an account's key is under the hash tag of its id", () => {
    expect(FailedSignInAuditLog.getKey(USER_ID)).toBe(
      `audit-log:failed-sign-ins:{${USER_ID.toString()}}`,
    );
  });

  test("reads what the script answered", () => {
    const count: FailedSignInCount | null = FailedSignInAuditLog.readCount([
      0,
      12,
      NOW.getTime(),
    ]);

    expect(count).toEqual({
      isRecorded: false,
      attempts: 12,
      firstAttemptAt: NOW,
    });
    expect(
      FailedSignInAuditLog.readCount([1, 1, NOW.getTime()])?.isRecorded,
    ).toBe(true);
  });

  test("a failing count is said once a minute at most", async () => {
    evalMock.mockRejectedValue(new Error("Valkey is down") as never);

    // A minute after whenever an earlier test last said so.
    const later: number = Date.now() + 10 * 60 * 1000;
    jest.spyOn(Date, "now").mockReturnValue(later);

    for (let attempt: number = 0; attempt < 5; attempt++) {
      await FailedSignInAuditLog.recordNow(input());
    }

    expect(
      warnMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return (
          call[0] === "FailedSignInAuditLog: could not record a failed sign-in"
        );
      }),
    ).toHaveLength(1);
  });
});
