import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * THE RATE OF A PROJECT'S QUERIES TO THE PROMETHEUS- AND LOKI-COMPATIBLE
 * APIS (issue #7700). Pinned here:
 *
 *   - each project's queries are counted per API in fixed one-minute
 *     windows, 1,200 by default (COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE);
 *   - past the limit a query is refused, with Retry-After - the seconds
 *     left in the window - in the API's own shape;
 *   - one project's count never refuses another's, and Prometheus' never
 *     Loki's;
 *   - a request that names no project is not counted; a Valkey that cannot
 *     count lets every query through, with one warning a minute.
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

import Redis from "../../../Server/Infrastructure/Redis";
import logger from "../../../Server/Utils/Logger";
import CompatibleQueryRateLimit, {
  COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE,
  COMPATIBLE_QUERY_TOO_MANY_MESSAGE,
  CompatibleQueryApi,
  CompatibleQueryRateLimitDecision,
  CompatibleQueryRateLimitOutcome,
} from "../../../Server/Middleware/CompatibleQueryRateLimit";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";
import ObjectID from "../../../Types/ObjectID";
import FakeCounterRedis from "../TestingUtils/Redis/FakeCounterRedis";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const warnMock: MockedFn = logger.warn as unknown as MockedFn;

const PROJECT_A: string = "1a2b3c4d-1111-4111-8111-111111111111";
const PROJECT_B: string = "1a2b3c4d-2222-4222-8222-222222222222";

const WINDOW_MS: number = 60 * 1000;

// 15 seconds into a window: 45 left.
const IN_WINDOW_MS: number = 29_000_000 * WINDOW_MS + 15_000;

let redis: FakeCounterRedis;

const requestOf: (projectId?: string) => ExpressRequest = (
  projectId?: string,
): ExpressRequest => {
  return {
    headers: {},
    ...(projectId ? { tenantId: new ObjectID(projectId) } : {}),
  } as unknown as ExpressRequest;
};

interface Answer {
  isHandedOn: boolean;
  refusedWith: string | undefined;
  retryAfter: string | undefined;
}

const send: (
  api: CompatibleQueryApi,
  projectId?: string,
) => Promise<Answer> = async (
  api: CompatibleQueryApi,
  projectId?: string,
): Promise<Answer> => {
  const headers: Record<string, string> = {};
  const res: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;
  const next: MockedFn = jest.fn();
  let refusedWith: string | undefined;

  await CompatibleQueryRateLimit.getMiddleware({
    api,
    refuse: (data: { message: string }): void => {
      refusedWith = data.message;
    },
  })(requestOf(projectId), res, next as unknown as NextFunction);

  return {
    isHandedOn: next.mock.calls.length === 1,
    refusedWith,
    retryAfter: headers["Retry-After"],
  };
};

const sendMany: (
  count: number,
  api: CompatibleQueryApi,
  projectId: string,
) => Promise<Array<Answer>> = async (
  count: number,
  api: CompatibleQueryApi,
  projectId: string,
): Promise<Array<Answer>> => {
  const answers: Array<Answer> = [];

  for (let index: number = 0; index < count; index++) {
    answers.push(await send(api, projectId));
  }

  return answers;
};

beforeEach(() => {
  redis = new FakeCounterRedis();
  getClientMock.mockReturnValue(redis);
  isConnectedMock.mockReturnValue(true);
  warnMock.mockClear();
  jest.spyOn(Date, "now").mockReturnValue(IN_WINDOW_MS);
  process.env["COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE"] = "3";
  (
    CompatibleQueryRateLimit as unknown as {
      counterUnavailableLastLoggedAt: number;
    }
  ).counterUnavailableLastLoggedAt = 0;
});

afterEach(() => {
  delete process.env["COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE"];
  jest.restoreAllMocks();
});

describe("CompatibleQueryRateLimit", () => {
  it("is 1,200 queries a minute unless set otherwise", () => {
    delete process.env["COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE"];
    expect(CompatibleQueryRateLimit.getLimitPerMinute()).toBe(
      COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE,
    );
    expect(COMPATIBLE_QUERY_DEFAULT_LIMIT_PER_MINUTE).toBe(1200);

    process.env["COMPATIBLE_QUERY_RATE_LIMIT_PER_MINUTE"] = "not a number";
    expect(CompatibleQueryRateLimit.getLimitPerMinute()).toBe(1200);
  });

  it("refuses a project's queries over the limit until the minute ends", async () => {
    const answers: Array<Answer> = await sendMany(
      4,
      CompatibleQueryApi.Loki,
      PROJECT_A,
    );

    expect(
      answers.map((answer: Answer): boolean => {
        return answer.isHandedOn;
      }),
    ).toEqual([true, true, true, false]);
    expect(answers[3]).toEqual({
      isHandedOn: false,
      refusedWith: COMPATIBLE_QUERY_TOO_MANY_MESSAGE,
      retryAfter: "45",
    });
    // The first refusal of the window is the one logged.
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("counts every query on the project's own key, per API", async () => {
    await send(CompatibleQueryApi.Prometheus, PROJECT_A);

    expect(Array.from(redis.counters.keys())).toEqual([
      `compatquery:rl:prometheus:p:${PROJECT_A}:${Math.floor(IN_WINDOW_MS / WINDOW_MS)}`,
    ]);
  });

  it("never refuses one project for another's queries, nor Loki for Prometheus'", async () => {
    await sendMany(4, CompatibleQueryApi.Prometheus, PROJECT_A);

    expect(
      (await send(CompatibleQueryApi.Prometheus, PROJECT_B)).isHandedOn,
    ).toBe(true);
    expect((await send(CompatibleQueryApi.Loki, PROJECT_A)).isHandedOn).toBe(
      true,
    );
  });

  it("starts again in the next minute", async () => {
    await sendMany(4, CompatibleQueryApi.Loki, PROJECT_A);
    jest.spyOn(Date, "now").mockReturnValue(IN_WINDOW_MS + WINDOW_MS);

    expect((await send(CompatibleQueryApi.Loki, PROJECT_A)).isHandedOn).toBe(
      true,
    );
  });

  it("hands on a request that names no project, uncounted, for its route to refuse", async () => {
    expect((await send(CompatibleQueryApi.Loki)).isHandedOn).toBe(true);
    expect(redis.counters.size).toBe(0);

    const decision: CompatibleQueryRateLimitDecision =
      await CompatibleQueryRateLimit.consume({
        api: CompatibleQueryApi.Loki,
        projectKey: null,
      });
    expect(decision.outcome).toBe(CompatibleQueryRateLimitOutcome.NotCounted);
  });

  it("lets queries through while Valkey cannot count, with one warning a minute", async () => {
    isConnectedMock.mockReturnValue(false);

    const answers: Array<Answer> = await sendMany(
      5,
      CompatibleQueryApi.Loki,
      PROJECT_A,
    );

    expect(
      answers.every((answer: Answer): boolean => {
        return answer.isHandedOn;
      }),
    ).toBe(true);
    expect(warnMock).toHaveBeenCalledTimes(1);
  });

  it("lets a query through when the count fails mid-way", async () => {
    redis.failNextExec = new Error("connection reset");

    expect(
      (await send(CompatibleQueryApi.Prometheus, PROJECT_A)).isHandedOn,
    ).toBe(true);
  });
});
