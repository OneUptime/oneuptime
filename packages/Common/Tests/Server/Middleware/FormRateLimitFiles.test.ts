import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * THE FORM'S HOURLY ALLOWANCE OF FILES (FormRateLimit.reserveFormFileBytes).
 *
 * Anyone holding a form's link can send files with a submission. The
 * submission ceiling bounds how many records a link can make; this bounds
 * how much a link can make the database hold: so many megabytes of files a
 * form an hour, every address together. What must hold: the bytes of a
 * submission that fits are counted, one that would go past the allowance is
 * refused with when to come back and its bytes given back, and when the
 * counter cannot be reached nothing is taken in (503) - as the submission
 * ceiling fails closed.
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
import FormRateLimit, {
  FORM_FILES_RATE_LIMIT_MESSAGE,
  FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  FormCeilingException,
} from "../../../Server/Middleware/FormRateLimit";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;

const SHARE_KEY: string = "7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_SHARE_KEY: string = "0f8fad5b-d9cb-469f-a165-70867728950e";
const MB: number = 1024 * 1024;

// A counter store, as Redis keeps one: INCRBY, DECRBY and EXPIRE.
class FakeCounters {
  public values: Map<string, number> = new Map();
  public expiries: Map<string, number> = new Map();
  public failing: boolean = false;

  public async incrby(key: string, by: number): Promise<number> {
    if (this.failing) {
      throw new Error("READONLY");
    }

    const value: number = (this.values.get(key) || 0) + by;
    this.values.set(key, value);
    return value;
  }

  public async decrby(key: string, by: number): Promise<number> {
    const value: number = (this.values.get(key) || 0) - by;
    this.values.set(key, value);
    return value;
  }

  public async expire(key: string, seconds: number): Promise<number> {
    this.expiries.set(key, seconds);
    return 1;
  }

  public total(): number {
    return Array.from(this.values.values()).reduce(
      (sum: number, value: number): number => {
        return sum + value;
      },
      0,
    );
  }
}

let counters: FakeCounters;

beforeEach(() => {
  counters = new FakeCounters();
  getClientMock.mockReturnValue(counters);
  isConnectedMock.mockReturnValue(true);
});

afterEach(() => {
  jest.clearAllMocks();
});

type RefusalFunction = (promise: Promise<unknown>) => Promise<unknown>;

const refusalOf: RefusalFunction = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (err) {
    return err;
  }

  throw new Error("The files were not refused.");
};

describe("the allowance", () => {
  test("is 200 MB an hour for a form, unless an operator says otherwise", () => {
    expect(FormRateLimit.getFileCeiling()).toEqual({
      windowSeconds: 60 * 60,
      limitInBytes: 200 * MB,
    });
  });
});

describe("a submission's files", () => {
  test("that fit are counted, and the count expires after two windows", async () => {
    await FormRateLimit.reserveFormFileBytes({
      shareKey: SHARE_KEY,
      bytes: 15 * MB,
    });

    expect(counters.total()).toBe(15 * MB);
    expect(Array.from(counters.expiries.values())).toEqual([2 * 60 * 60]);
  });

  test("count up to the allowance exactly", async () => {
    for (let index: number = 0; index < 10; index++) {
      await FormRateLimit.reserveFormFileBytes({
        shareKey: SHARE_KEY,
        bytes: 20 * MB,
      });
    }

    expect(counters.total()).toBe(200 * MB);
  });

  test("that would go past it are refused with when to come back, and given back", async () => {
    for (let index: number = 0; index < 10; index++) {
      await FormRateLimit.reserveFormFileBytes({
        shareKey: SHARE_KEY,
        bytes: 20 * MB,
      });
    }

    const refusal: unknown = await refusalOf(
      FormRateLimit.reserveFormFileBytes({ shareKey: SHARE_KEY, bytes: 1 }),
    );

    expect(refusal).toBeInstanceOf(FormCeilingException);
    expect((refusal as FormCeilingException).message).toBe(
      FORM_FILES_RATE_LIMIT_MESSAGE,
    );
    expect((refusal as FormCeilingException).retryAfterSeconds).toBeGreaterThan(
      0,
    );
    expect(
      (refusal as FormCeilingException).retryAfterSeconds,
    ).toBeLessThanOrEqual(60 * 60);
    // Nothing was stored, so nothing stays counted.
    expect(counters.total()).toBe(200 * MB);
  });

  test("are counted for their own form: another form's allowance is its own", async () => {
    for (let index: number = 0; index < 10; index++) {
      await FormRateLimit.reserveFormFileBytes({
        shareKey: SHARE_KEY,
        bytes: 20 * MB,
      });
    }

    await expect(
      FormRateLimit.reserveFormFileBytes({
        shareKey: OTHER_SHARE_KEY,
        bytes: 20 * MB,
      }),
    ).resolves.toBeUndefined();
  });

  test("a form's link in any spelling counts against the one allowance", async () => {
    await FormRateLimit.reserveFormFileBytes({
      shareKey: SHARE_KEY.toUpperCase(),
      bytes: 100 * MB,
    });
    await FormRateLimit.reserveFormFileBytes({
      shareKey: ` ${SHARE_KEY} `,
      bytes: 100 * MB,
    });

    await expect(
      refusalOf(
        FormRateLimit.reserveFormFileBytes({ shareKey: SHARE_KEY, bytes: 1 }),
      ),
    ).resolves.toBeInstanceOf(FormCeilingException);
    expect(counters.values.size).toBe(1);
  });

  test("no bytes, or a count that is no count, is nothing to reserve", async () => {
    for (const bytes of [0, -5, Number.NaN]) {
      await FormRateLimit.reserveFormFileBytes({ shareKey: SHARE_KEY, bytes });
    }

    expect(counters.values.size).toBe(0);
  });
});

describe("when the counter cannot be reached, no file is taken in", () => {
  test("no client", async () => {
    getClientMock.mockReturnValue(null);

    const refusal: unknown = await refusalOf(
      FormRateLimit.reserveFormFileBytes({ shareKey: SHARE_KEY, bytes: MB }),
    );

    expect(refusal).toBeInstanceOf(ServiceUnavailableException);
    expect((refusal as Error).message).toBe(FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE);
  });

  test("not connected", async () => {
    isConnectedMock.mockReturnValue(false);

    await expect(
      refusalOf(
        FormRateLimit.reserveFormFileBytes({ shareKey: SHARE_KEY, bytes: MB }),
      ),
    ).resolves.toBeInstanceOf(ServiceUnavailableException);
  });

  test("a command that fails", async () => {
    counters.failing = true;

    await expect(
      refusalOf(
        FormRateLimit.reserveFormFileBytes({ shareKey: SHARE_KEY, bytes: MB }),
      ),
    ).resolves.toBeInstanceOf(ServiceUnavailableException);
  });
});

describe("the submit route says when to come back", () => {
  test("for the files ceiling, as for the submission ceiling", () => {
    const headers: Record<string, string> = {};
    const response: unknown = {
      setHeader: (name: string, value: string): void => {
        headers[name] = value;
      },
    };

    FormRateLimit.setRetryAfterFor(
      response as never,
      new FormCeilingException(321, FORM_FILES_RATE_LIMIT_MESSAGE),
    );

    expect(headers).toEqual({ "Retry-After": "321" });
  });
});
