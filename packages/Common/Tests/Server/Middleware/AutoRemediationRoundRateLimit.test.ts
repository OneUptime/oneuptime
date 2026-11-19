import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * THE LIMITS OF AN AI FIX'S ROUND AND OF TRY AGAIN (issue #6525).
 *
 * The Remediation step reads each fix's round (POST /auto-remediation/round)
 * once it has a run, on each change, and every 15 seconds while it is at
 * work; Try again (POST /auto-remediation/round-try-again, and the record's
 * POST /auto-remediation/try-again) starts OneUptime AI working. Pinned here:
 *
 *   - each bucket counts the signed-in person, in fixed 15-minute windows:
 *     1,800 reads (30 rounds at work in view at once) and 30 presses of
 *     either Try again together;
 *   - past the limit the route answers 429 with Retry-After - the seconds
 *     left in the window - and Try again's sentence, which the Dashboard
 *     words in every language; a read's never reaches the card;
 *   - one person's count never refuses another, and a read never spends a
 *     press;
 *   - a request that names nobody is not counted, and reaches its handler
 *     (which answers 401); a Valkey that cannot count lets everything
 *     through, with one warning a minute;
 *   - the three routes carry the limit, and no other route does.
 */

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: {
      getClient: jest.fn(),
      isConnected: jest.fn(),
    },
  };
});

jest.mock("../../../Server/Utils/Logger", () => {
  return {
    __esModule: true,
    default: {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    },
    getLogAttributesFromRequest: jest.fn().mockReturnValue({}),
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendErrorResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEmptySuccessResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
    },
  };
});

// The routes the API registers, recorded by the shared mock router.
jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: (): unknown => {
        return mockRouter;
      },
    },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import logger from "../../../Server/Utils/Logger";
import Response from "../../../Server/Utils/Response";
import AutoRemediationRoundRateLimit, {
  AutoRemediationRoundRateLimitBucket,
  AutoRemediationRoundRateLimitDecision,
  AutoRemediationRoundRateLimitOutcome,
} from "../../../Server/Middleware/AutoRemediationRoundRateLimit";
import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import {
  REMEDIATION_ROUND_PATH,
  REMEDIATION_ROUND_READ_TOO_OFTEN,
  REMEDIATION_ROUND_TRY_AGAIN_PATH,
  REMEDIATION_ROUND_TRY_AGAIN_REFUSALS,
  RemediationRoundTryAgainRefusal,
} from "../../../Types/AutoRemediation/RemediationRound";
import ObjectID from "../../../Types/ObjectID";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";
import { mockRouter } from "../API/Helpers";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const warnMock: MockedFn = logger.warn as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;

const USER_A: string = "1a2b3c4d-3333-4333-8333-333333333333";
const USER_B: string = "1a2b3c4d-4444-4444-8444-444444444444";

const WINDOW_SECONDS: number = 15 * 60;
const WINDOW_MS: number = WINDOW_SECONDS * 1000;

// The middle of a window, so a run of requests never crosses into the next.
const MID_WINDOW_MS: number = 1_000 * WINDOW_MS + WINDOW_MS / 2;

const READ: AutoRemediationRoundRateLimitBucket =
  AutoRemediationRoundRateLimitBucket.Read;
const TRY_AGAIN: AutoRemediationRoundRateLimitBucket =
  AutoRemediationRoundRateLimitBucket.TryAgain;

let redis: FakeCounterRedis;

function requestOf(userId?: string): ExpressRequest {
  return {
    headers: {},
    body: {},
    query: {},
    params: {},
    ...(userId ? { userAuthorization: { userId: new ObjectID(userId) } } : {}),
  } as unknown as ExpressRequest;
}

interface Answer {
  isHandedOn: boolean;
  refusal: TooManyRequestsException | undefined;
  retryAfter: string | undefined;
}

async function send(
  bucket: AutoRemediationRoundRateLimitBucket,
  userId?: string,
): Promise<Answer> {
  const headers: Record<string, string> = {};
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();
  const sentBefore: number = sendErrorResponseMock.mock.calls.length;

  await AutoRemediationRoundRateLimit.getMiddleware(bucket)(
    requestOf(userId),
    res,
    next as unknown as NextFunction,
  );

  const sent: Array<unknown> | undefined =
    sendErrorResponseMock.mock.calls[sentBefore];

  return {
    isHandedOn: next.mock.calls.length === 1,
    refusal: sent ? (sent[2] as TooManyRequestsException) : undefined,
    retryAfter: headers["Retry-After"],
  };
}

async function sendMany(
  count: number,
  bucket: AutoRemediationRoundRateLimitBucket,
  userId: string,
): Promise<Array<Answer>> {
  const answers: Array<Answer> = [];

  for (let index: number = 0; index < count; index++) {
    answers.push(await send(bucket, userId));
  }

  return answers;
}

beforeEach(() => {
  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);
  jest.spyOn(Date, "now").mockReturnValue(MID_WINDOW_MS);
  (
    AutoRemediationRoundRateLimit as unknown as {
      counterUnavailableLastLoggedAt: Map<string, number>;
    }
  ).counterUnavailableLastLoggedAt.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
  getClientMock.mockReset();
  isConnectedMock.mockReset();
  warnMock.mockReset();
  sendErrorResponseMock.mockReset();
});

describe("the limits in force", () => {
  it("reads: 1,800 per person in 15 minutes - every round at work read every 15 seconds, 30 of them at once", () => {
    expect(AutoRemediationRoundRateLimit.getConfig(READ)).toEqual({
      windowSeconds: WINDOW_SECONDS,
      perUserLimit: 1800,
    });
    // A round at work is read every 15 seconds.
    expect(1800 / (WINDOW_SECONDS / 15)).toBe(30);
  });

  it("Try again: 30 presses per person in 15 minutes", () => {
    expect(AutoRemediationRoundRateLimit.getConfig(TRY_AGAIN)).toEqual({
      windowSeconds: WINDOW_SECONDS,
      perUserLimit: 30,
    });
  });

  it("a refused Try again says so in the sentence the Dashboard words; a refused read in the API's English", () => {
    expect(AutoRemediationRoundRateLimit.getRefusalMessage(TRY_AGAIN)).toBe(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[
        RemediationRoundTryAgainRefusal.TooManyTries
      ],
    );
    expect(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[
        RemediationRoundTryAgainRefusal.TooManyTries
      ],
    ).toBe(
      "You have asked OneUptime AI to try again too many times in the last few minutes. Wait a few minutes, then try again.",
    );
    expect(AutoRemediationRoundRateLimit.getRefusalMessage(READ)).toBe(
      REMEDIATION_ROUND_READ_TOO_OFTEN,
    );

    for (const message of [
      AutoRemediationRoundRateLimit.getRefusalMessage(TRY_AGAIN),
      AutoRemediationRoundRateLimit.getRefusalMessage(READ),
    ]) {
      // A sentence: what happened, and what to do next.
      expect(message).toMatch(/^[A-Z].+\.$/);
      expect(message).toContain("Wait a few minutes");
    }
  });
});

describe("counting a person", () => {
  it("lets a person's presses through up to the limit, then answers 429 with Try again's words and the seconds left in the window", async () => {
    const answers: Array<Answer> = await sendMany(31, TRY_AGAIN, USER_A);

    expect(
      answers.slice(0, 30).every((answer: Answer): boolean => {
        return answer.isHandedOn && !answer.refusal;
      }),
    ).toBe(true);

    const refused: Answer = answers[30]!;

    expect(refused.isHandedOn).toBe(false);
    expect(refused.refusal).toBeInstanceOf(TooManyRequestsException);
    expect(refused.refusal?.message).toBe(
      REMEDIATION_ROUND_TRY_AGAIN_REFUSALS[
        RemediationRoundTryAgainRefusal.TooManyTries
      ],
    );
    // Half the window is left.
    expect(refused.retryAfter).toBe(String(WINDOW_SECONDS / 2));
  });

  it("lets a person's reads through up to 1,800, then answers 429", async () => {
    const answers: Array<Answer> = await sendMany(1801, READ, USER_A);

    expect(
      answers.filter((answer: Answer): boolean => {
        return answer.isHandedOn;
      }),
    ).toHaveLength(1800);
    expect(answers[1800]!.refusal?.message).toBe(
      REMEDIATION_ROUND_READ_TOO_OFTEN,
    );
    expect(answers[1800]!.retryAfter).toBe(String(WINDOW_SECONDS / 2));
  });

  it("counts each person apart: one over the limit never refuses another", async () => {
    await sendMany(31, TRY_AGAIN, USER_A);

    const other: Answer = await send(TRY_AGAIN, USER_B);

    expect(other.isHandedOn).toBe(true);
    expect((await send(TRY_AGAIN, USER_A)).isHandedOn).toBe(false);
  });

  it("counts reads and presses apart: reading the rounds never spends a press, nor a press a read", async () => {
    await sendMany(31, TRY_AGAIN, USER_A);

    expect((await send(READ, USER_A)).isHandedOn).toBe(true);
    expect(
      redis.keysHolding(`:read:u:${USER_A}:`).map((key: string): number => {
        return redis.count(key);
      }),
    ).toEqual([1]);
    expect(
      redis
        .keysHolding(`:try-again:u:${USER_A}:`)
        .map((key: string): number => {
          return redis.count(key);
        }),
    ).toEqual([31]);
  });

  it("counts every request, a refused one too: a caller who keeps asking stays refused for the window", async () => {
    await sendMany(40, TRY_AGAIN, USER_A);

    expect(
      redis
        .keysHolding(`:try-again:u:${USER_A}:`)
        .map((key: string): number => {
          return redis.count(key);
        }),
    ).toEqual([40]);
    expect((await send(TRY_AGAIN, USER_A)).isHandedOn).toBe(false);
  });

  it("counts in fixed windows: the next window starts from nothing, and only the request that made a key sets its expiry, two windows long", async () => {
    await sendMany(31, TRY_AGAIN, USER_A);

    const [key] = redis.keysHolding(`:try-again:u:${USER_A}:`);

    expect(redis.expiries.get(key!)).toEqual([2 * WINDOW_SECONDS]);

    jest.spyOn(Date, "now").mockReturnValue(MID_WINDOW_MS + WINDOW_MS);

    expect((await send(TRY_AGAIN, USER_A)).isHandedOn).toBe(true);
    expect(redis.keysHolding(`:try-again:u:${USER_A}:`)).toHaveLength(2);
  });

  it("keys the counter on the person's id alone, lowercased: never a caller's text", async () => {
    await send(READ, USER_A.toUpperCase());

    expect(redis.keys()).toEqual([
      `autoremediationround:rl:read:u:${USER_A}:${Math.floor(MID_WINDOW_MS / WINDOW_MS)}`,
    ]);
  });

  it("logs the first refusal of a window, once", async () => {
    await sendMany(35, TRY_AGAIN, USER_A);

    const refusalLines: Array<unknown> = warnMock.mock.calls.filter(
      (call: Array<unknown>): boolean => {
        return String(call[0]).includes("refused try-again requests");
      },
    );

    expect(refusalLines).toHaveLength(1);
    expect(String(refusalLines[0])).toContain(USER_A);
  });
});

describe("what is not counted, and when it cannot count", () => {
  it("a request that names nobody is not counted and reaches its handler, which answers it 401", async () => {
    const answer: Answer = await send(TRY_AGAIN);

    expect(answer.isHandedOn).toBe(true);
    expect(answer.refusal).toBeUndefined();
    expect(redis.sent).toEqual([]);

    const decision: AutoRemediationRoundRateLimitDecision =
      await AutoRemediationRoundRateLimit.consume({
        bucket: READ,
        userKey: null,
      });

    expect(decision.outcome).toBe(
      AutoRemediationRoundRateLimitOutcome.NotCounted,
    );
  });

  it("a person whose id is no id is not counted either", () => {
    expect(
      AutoRemediationRoundRateLimit.resolveUserKey({
        userAuthorization: {
          userId: {
            toString: (): string => {
              return "not-a-uuid:*";
            },
          },
        },
      } as unknown as ExpressRequest),
    ).toBeNull();
    expect(
      AutoRemediationRoundRateLimit.resolveUserKey(requestOf(USER_B)),
    ).toBe(USER_B);
  });

  it.each([
    [
      "no client",
      (): void => {
        getClientMock.mockReturnValue(null);
      },
    ],
    [
      "a client that is not connected",
      (): void => {
        isConnectedMock.mockReturnValue(false);
      },
    ],
    [
      "a count that fails",
      (): void => {
        redis.failNextExec = new Error("connection reset");
      },
    ],
  ])(
    "fails open with %s: the request is let through",
    async (_name: string, breakIt: () => void) => {
      breakIt();

      const answer: Answer = await send(TRY_AGAIN, USER_A);

      expect(answer.isHandedOn).toBe(true);
      expect(answer.refusal).toBeUndefined();
      expect(
        (
          await AutoRemediationRoundRateLimit.consume({
            bucket: READ,
            userKey: USER_A,
          })
        ).outcome,
      ).toBe(
        getClientMock() && isConnectedMock()
          ? AutoRemediationRoundRateLimitOutcome.Allowed
          : AutoRemediationRoundRateLimitOutcome.CounterUnavailable,
      );
    },
  );

  it("says a counter that cannot be read once a minute per bucket, not once a request", async () => {
    getClientMock.mockReturnValue(null);

    for (let index: number = 0; index < 5; index++) {
      await send(READ, USER_A);
    }

    const lines: () => Array<unknown> = (): Array<unknown> => {
      return warnMock.mock.calls.filter((call: Array<unknown>): boolean => {
        return String(call[0]).includes("counter unavailable");
      });
    };

    expect(lines()).toHaveLength(1);

    await send(TRY_AGAIN, USER_A);
    expect(lines()).toHaveLength(2);

    jest.spyOn(Date, "now").mockReturnValue(MID_WINDOW_MS + 61 * 1000);
    await send(READ, USER_A);
    expect(lines()).toHaveLength(3);
  });
});

describe("the routes it stands in front of", () => {
  beforeAll(async () => {
    mockRouter.routes.length = 0;
    await import("../../../Server/API/AutoRemediationAPI");
  });

  function bucketsOf(uri: string): Array<string> {
    return mockRouter
      .match("POST", uri)
      .middlewares.map((middleware: unknown): string | undefined => {
        return AutoRemediationRoundRateLimit.bucketOf(middleware);
      })
      .filter((bucket: string | undefined): boolean => {
        return bucket !== undefined;
      }) as Array<string>;
  }

  it.each([
    [REMEDIATION_ROUND_PATH, [READ]],
    [REMEDIATION_ROUND_TRY_AGAIN_PATH, [TRY_AGAIN]],
    ["/auto-remediation/try-again", [TRY_AGAIN]],
  ])(
    "POST %s is limited by %j, right behind the signed-in user",
    (uri: string, buckets: Array<AutoRemediationRoundRateLimitBucket>) => {
      const middlewares: Array<unknown> = mockRouter.match(
        "POST",
        uri,
      ).middlewares;

      expect(bucketsOf(uri)).toEqual(buckets);
      expect(middlewares[0]).toBe(UserMiddleware.getUserMiddleware);
      expect(AutoRemediationRoundRateLimit.bucketOf(middlewares[1])).toBe(
        buckets[0],
      );
    },
  );

  it("no other route of the API is limited: each is a person's decision on one fix", () => {
    const limited: Array<string> = mockRouter.routes
      .filter((route: { middlewares: Array<unknown> }): boolean => {
        return route.middlewares.some((middleware: unknown): boolean => {
          return (
            AutoRemediationRoundRateLimit.bucketOf(middleware) !== undefined
          );
        });
      })
      .map((route: { uri: string }): string => {
        return route.uri;
      })
      .sort();

    expect(limited).toEqual(
      [
        REMEDIATION_ROUND_PATH,
        REMEDIATION_ROUND_TRY_AGAIN_PATH,
        "/auto-remediation/try-again",
      ].sort(),
    );
  });

  it("a function that is not one of its middlewares counts in no bucket", () => {
    expect(
      AutoRemediationRoundRateLimit.bucketOf(UserMiddleware.getUserMiddleware),
    ).toBeUndefined();
    expect(AutoRemediationRoundRateLimit.bucketOf("read")).toBeUndefined();
  });
});
