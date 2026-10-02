import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from "@jest/globals";

/*
 * The rate limiter in front of the public form routes.
 *
 * Two buckets with opposite jobs. Reading a form is load control, like
 * reading a public dashboard, and fails open. Submitting one declares an
 * incident and pages on-call, so its counters are sized for people, add a
 * per-form ceiling no number of addresses gets around, and fail closed.
 *
 * What matters is less "does it count" than the handful of properties that
 * decide whether the limit can be walked around or turned against the form:
 * that the address is the one OUR proxy wrote, that rotating share keys buys
 * nothing, that junk keys share one bucket, that no request the middleware
 * counts - refused or not - spends the form's shared allowance (only a
 * submission about to declare an incident does, through
 * reserveFormSubmission), that windows do not slide, and that the two
 * buckets fail in opposite directions when Redis is gone.
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
    },
  };
});

import Redis from "../../../Server/Infrastructure/Redis";
import Response from "../../../Server/Utils/Response";
import logger from "../../../Server/Utils/Logger";
import FormRateLimit, {
  FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
  FORM_READ_RATE_LIMIT_MESSAGE,
  FORM_SUBMIT_RATE_LIMIT_MESSAGE,
  FORM_TOTAL_RATE_LIMIT_MESSAGE,
  FormCeilingException,
  FormRateLimitBucket,
  FormRateLimitBucketConfig,
  FormRateLimitDecision,
  FormRateLimitOutcome,
  FormRateLimitScope,
} from "../../../Server/Middleware/FormRateLimit";
import ExceptionCode from "../../../Types/Exception/ExceptionCode";
import Exception from "../../../Types/Exception/Exception";
import ServiceUnavailableException from "../../../Types/Exception/ServiceUnavailableException";
import TooManyRequestsException from "../../../Types/Exception/TooManyRequestsException";
import ObjectID from "../../../Types/ObjectID";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../../../Server/Utils/Express";

type MockedFn = ReturnType<typeof jest.fn>;

const getClientMock: MockedFn = Redis.getClient as unknown as MockedFn;
const isConnectedMock: MockedFn = Redis.isConnected as unknown as MockedFn;
const sendErrorResponseMock: MockedFn =
  Response.sendErrorResponse as unknown as MockedFn;
const loggerWarnMock: MockedFn = logger.warn as unknown as MockedFn;
const loggerErrorMock: MockedFn = logger.error as unknown as MockedFn;

// The defaults baked into the limiter; asserted directly in one test below.
const READ_WINDOW_SECONDS: number = 60;
const READ_PER_FORM_AND_IP_LIMIT: number = 120;
const READ_PER_IP_LIMIT: number = 600;
const SUBMIT_WINDOW_SECONDS: number = 15 * 60;
const SUBMIT_PER_FORM_AND_IP_LIMIT: number = 10;
const SUBMIT_PER_IP_LIMIT: number = 30;
const SUBMIT_PER_FORM_WINDOW_SECONDS: number = 60 * 60;
const SUBMIT_PER_FORM_LIMIT: number = 60;

const FORM_KEY: string = "k:7c9e6679-7425-40de-944b-e07fc1f90ae7";
const OTHER_FORM_KEY: string = "k:0f8fad5b-d9cb-469f-a165-70867728950e";
const CLIENT_IP: string = "203.0.113.7";

/*
 * A fake that behaves like a Redis counter store rather than a bag of
 * assertions: INCR really increments and EXPIRE really records a TTL, so the
 * window, reset and pinning tests exercise the limiter's arithmetic instead
 * of restating it.
 */
interface RecordedExpire {
  key: string;
  ttlSeconds: number;
}

class FakeRedisClient {
  public counters: Map<string, number> = new Map();
  public expires: Array<RecordedExpire> = [];

  // Set to make the next exec() reject, for the error-path tests.
  public failNextExec: Error | null = null;

  // Set to make the exec() with this 1-based number reject.
  public failExecNumber: number | null = null;

  // Set to make the next exec() resolve to something malformed.
  public malformedExecResult: unknown | undefined = undefined;

  public execCount: number = 0;
  public incrCallCount: number = 0;

  public pipeline(): FakePipeline {
    return new FakePipeline(this);
  }

  public expiresForKey(key: string): Array<RecordedExpire> {
    return this.expires.filter((recorded: RecordedExpire) => {
      return recorded.key === key;
    });
  }

  public keysMatching(fragment: string): Array<string> {
    return Array.from(this.counters.keys()).filter((key: string) => {
      return key.includes(fragment);
    });
  }
}

type QueuedCommand = () => [Error | null, unknown];

class FakePipeline {
  private commands: Array<QueuedCommand> = [];

  public constructor(private client: FakeRedisClient) {}

  public incr(key: string): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      this.client.incrCallCount++;
      const next: number = (this.client.counters.get(key) || 0) + 1;
      this.client.counters.set(key, next);
      return [null, next];
    });

    return this;
  }

  public expire(key: string, ttlSeconds: number): FakePipeline {
    this.commands.push((): [Error | null, unknown] => {
      this.client.expires.push({ key, ttlSeconds });
      return [null, 1];
    });

    return this;
  }

  public async exec(): Promise<unknown> {
    this.client.execCount++;

    if (this.client.failNextExec) {
      const error: Error = this.client.failNextExec;
      this.client.failNextExec = null;
      throw error;
    }

    if (this.client.failExecNumber === this.client.execCount) {
      throw new Error("connection reset");
    }

    if (typeof this.client.malformedExecResult !== "undefined") {
      const result: unknown = this.client.malformedExecResult;
      this.client.malformedExecResult = undefined;
      return result;
    }

    return this.commands.map((command: QueuedCommand) => {
      return command();
    });
  }
}

interface BuildRequestOverrides {
  params?: Record<string, unknown>;
  headers?: Record<string, string | Array<string>>;
  socketAddress?: string | undefined;
  ip?: string | undefined;
}

const buildRequest: (overrides?: BuildRequestOverrides) => ExpressRequest = (
  overrides: BuildRequestOverrides = {},
) => {
  return {
    params: overrides.params || {},
    body: {},
    headers: overrides.headers || {},
    socket: { remoteAddress: overrides.socketAddress },
    ip: overrides.ip,
  } as unknown as ExpressRequest;
};

interface BuiltResponse {
  response: ExpressResponse;
  headers: Record<string, string>;
}

const buildResponse: () => BuiltResponse = () => {
  const headers: Record<string, string> = {};

  const response: ExpressResponse = {
    setHeader: (name: string, value: string): void => {
      headers[name] = value;
    },
  } as unknown as ExpressResponse;

  return { response, headers };
};

// Pinned to the start of an hour, so every window here starts together.
const HOUR_ALIGNED_TIME: number =
  1_700_000_000_000 -
  (1_700_000_000_000 % (SUBMIT_PER_FORM_WINDOW_SECONDS * 1000));

describe("FormRateLimit", () => {
  let client: FakeRedisClient;
  let nowSpy: ReturnType<typeof jest.spyOn>;
  let currentTime: number;

  beforeEach(() => {
    jest.clearAllMocks();

    client = new FakeRedisClient();
    getClientMock.mockReturnValue(client);
    isConnectedMock.mockReturnValue(true);

    currentTime = HOUR_ALIGNED_TIME;
    nowSpy = jest.spyOn(Date, "now").mockImplementation(() => {
      return currentTime;
    });
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  const consume: (data: {
    bucket: FormRateLimitBucket;
    formKey?: string;
    clientIp?: string;
  }) => Promise<FormRateLimitDecision> = (data: {
    bucket: FormRateLimitBucket;
    formKey?: string;
    clientIp?: string;
  }) => {
    return FormRateLimit.consume({
      formKey: data.formKey || FORM_KEY,
      clientIp: data.clientIp || CLIENT_IP,
      bucket: data.bucket,
    });
  };

  const consumeRead: (data?: {
    formKey?: string;
    clientIp?: string;
  }) => Promise<FormRateLimitDecision> = (
    data: { formKey?: string; clientIp?: string } = {},
  ) => {
    return consume({ ...data, bucket: FormRateLimitBucket.Read });
  };

  const consumeSubmit: (data?: {
    formKey?: string;
    clientIp?: string;
  }) => Promise<FormRateLimitDecision> = (
    data: { formKey?: string; clientIp?: string } = {},
  ) => {
    return consume({ ...data, bucket: FormRateLimitBucket.Submit });
  };

  // An address per index, all distinct: 10.1.x.y.
  const addressNumber: (index: number) => string = (index: number) => {
    return `10.1.${Math.floor(index / 250)}.${(index % 250) + 1}`;
  };

  describe("the budgets", () => {
    it("reads at 120 per minute per form and address, 600 per address, failing open", () => {
      const read: FormRateLimitBucketConfig =
        FormRateLimit.getBucketConfig(FormRateLimitBucket.Read);

      expect(read).toEqual({
        windowSeconds: READ_WINDOW_SECONDS,
        perFormAndIpLimit: READ_PER_FORM_AND_IP_LIMIT,
        perIpLimit: READ_PER_IP_LIMIT,
        perForm: undefined,
        failsClosed: false,
      });
    });

    it("submits at 10 per 15 minutes per form and address, 30 per address, 60 an hour per form, failing closed", () => {
      const submit: FormRateLimitBucketConfig =
        FormRateLimit.getBucketConfig(
          FormRateLimitBucket.Submit,
        );

      expect(submit).toEqual({
        windowSeconds: SUBMIT_WINDOW_SECONDS,
        perFormAndIpLimit: SUBMIT_PER_FORM_AND_IP_LIMIT,
        perIpLimit: SUBMIT_PER_IP_LIMIT,
        perForm: {
          windowSeconds: SUBMIT_PER_FORM_WINDOW_SECONDS,
          limit: SUBMIT_PER_FORM_LIMIT,
        },
        failsClosed: true,
      });
    });

    it("sizes submissions for people, far below the read budget", () => {
      expect(SUBMIT_PER_FORM_AND_IP_LIMIT).toBeLessThan(
        READ_PER_FORM_AND_IP_LIMIT,
      );
      expect(SUBMIT_PER_IP_LIMIT).toBeLessThan(READ_PER_IP_LIMIT);
    });

    it("hands out copies, so a caller cannot loosen the limits in force", async () => {
      const copy: FormRateLimitBucketConfig =
        FormRateLimit.getBucketConfig(
          FormRateLimitBucket.Submit,
        );

      copy.perFormAndIpLimit = 100000;
      copy.perForm!.limit = 100000;

      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        await consumeSubmit();
      }

      expect((await consumeSubmit()).outcome).toBe(
        FormRateLimitOutcome.RateLimited,
      );
      expect(
        FormRateLimit.getBucketConfig(
          FormRateLimitBucket.Submit,
        ).perForm?.limit,
      ).toBe(SUBMIT_PER_FORM_LIMIT);
    });
  });

  describe("resolveFormKey", () => {
    it("keys on the :shareKey parameter", () => {
      const shareKey: string = ObjectID.generate().toString();

      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({ params: { shareKey } }),
        ),
      ).toBe(`k:${shareKey.toLowerCase()}`);
    });

    /*
     * Casing and padding must not split a bucket, or the limit is bypassed
     * by varying them alone.
     */
    it("gives a differently cased key the same bucket", () => {
      const shareKey: string = ObjectID.generate().toString();

      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({ params: { shareKey: shareKey.toUpperCase() } }),
        ),
      ).toBe(
        FormRateLimit.resolveFormKey(
          buildRequest({ params: { shareKey: shareKey.toLowerCase() } }),
        ),
      );
    });

    it("ignores surrounding whitespace", () => {
      const shareKey: string = ObjectID.generate().toString();

      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({ params: { shareKey: `  ${shareKey}\t` } }),
        ),
      ).toBe(`k:${shareKey.toLowerCase()}`);
    });

    /*
     * Junk keys all share one bucket. That bounds Redis memory against a
     * caller feeding random garbage, and it is the right grouping: none of
     * those requests can reach a form.
     */
    it.each([
      ["a word", "not-a-share-key"],
      ["percent junk", "%%%%%%"],
      ["a UUID with a character too many", `${ObjectID.generate()}0`],
      ["a UUID with a stray character", "7c9e6679-7425-40de-944b-e07fc1f90aeZ"],
      ["a very long segment", "a".repeat(10000)],
      ["a Redis glob", "*"],
    ])(
      "collapses %s into the one invalid bucket",
      (_label: string, value: string) => {
        expect(
          FormRateLimit.resolveFormKey(
            buildRequest({ params: { shareKey: value } }),
          ),
        ).toBe("invalid");
      },
    );

    it("uses a stable key when no share key is named", () => {
      expect(FormRateLimit.resolveFormKey(buildRequest())).toBe("none");
      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({ params: { shareKey: "   " } }),
        ),
      ).toBe("none");
    });

    it("ignores a share key that is not text", () => {
      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({ params: { shareKey: { evil: true } } }),
        ),
      ).toBe("none");
    });

    it("never reads another parameter", () => {
      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({
            params: { id: ObjectID.generate().toString() },
          }),
        ),
      ).toBe("none");
    });
  });

  describe("resolveClientIp", () => {
    /*
     * The security-critical one. Nginx appends the peer to whatever the
     * caller sent, so the LEFT of X-Forwarded-For is the caller's to write.
     * Keying on it would give a forging caller a fresh bucket per request.
     */
    it("bills the hop our own proxy appended, not the one the caller forged", () => {
      expect(
        FormRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "9.9.9.9, 203.0.113.7" },
          }),
        ),
      ).toBe("203.0.113.7");
    });

    it("gives two forging callers from one real address the same bucket", () => {
      expect(
        FormRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "1.1.1.1, 203.0.113.7" },
          }),
        ),
      ).toBe(
        FormRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "2.2.2.2, 203.0.113.7" },
          }),
        ),
      );
    });

    it("falls back to the socket address with no forwarding header", () => {
      expect(
        FormRateLimit.resolveClientIp(
          buildRequest({ socketAddress: "198.51.100.4" }),
        ),
      ).toBe("198.51.100.4");
    });

    it("puts callers with no address at all in one shared bucket", () => {
      expect(FormRateLimit.resolveClientIp(buildRequest())).toBe(
        "unknown",
      );
    });

    it("puts a trusted entry that is not an address in the shared bucket", () => {
      expect(
        FormRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "1.2.3.4\n\r evil*key" },
          }),
        ),
      ).toBe("unknown");
    });

    it("keeps IPv6 addresses", () => {
      expect(
        FormRateLimit.resolveClientIp(
          buildRequest({
            headers: { "x-forwarded-for": "2001:db8::8a2e:370:7334" },
          }),
        ),
      ).toBe("2001:db8::8a2e:370:7334");
    });
  });

  describe("consume - reading a form", () => {
    it("allows 120 reads a minute from one address", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT; i++) {
        expect((await consumeRead()).outcome).toBe(
          FormRateLimitOutcome.Allowed,
        );
      }
    });

    it("refuses the next one, naming the form and address counter", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT; i++) {
        await consumeRead();
      }

      const decision: FormRateLimitDecision = await consumeRead();

      expect(decision.outcome).toBe(FormRateLimitOutcome.RateLimited);
      expect(decision.scope).toBe(FormRateLimitScope.FormAndIp);
      expect(decision.isFirstRejectionInWindow).toBe(true);
    });

    it("keeps separate budgets for separate addresses and separate forms", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT + 5; i++) {
        await consumeRead();
      }

      expect((await consumeRead({ clientIp: "198.51.100.4" })).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );
      expect((await consumeRead({ formKey: OTHER_FORM_KEY })).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );
    });

    /*
     * The bypass the address counter closes: a caller that rotates the share
     * key never fills a form bucket, while every request still costs a
     * Postgres lookup, 404 or not.
     */
    it("stops a caller rotating share keys at the per-address ceiling", async () => {
      let rejected: FormRateLimitDecision | null = null;
      let rejectedAt: number = -1;

      for (let i: number = 0; i < READ_PER_IP_LIMIT + 10; i++) {
        const decision: FormRateLimitDecision = await consumeRead({
          formKey: `k:rotating-${i}`,
        });

        if (
          decision.outcome === FormRateLimitOutcome.RateLimited &&
          !rejected
        ) {
          rejected = decision;
          rejectedAt = i;
        }
      }

      expect(rejectedAt).toBe(READ_PER_IP_LIMIT);
      expect(rejected?.scope).toBe(FormRateLimitScope.Ip);
    });

    it("reports the form and address counter first when both are over", async () => {
      for (let i: number = 0; i < READ_PER_IP_LIMIT + 10; i++) {
        await consumeRead();
      }

      expect((await consumeRead()).scope).toBe(
        FormRateLimitScope.FormAndIp,
      );
    });

    it("never counts a read against a form's submission ceiling", async () => {
      await consumeRead();

      expect(client.keysMatching(":f:")).toEqual([]);
      expect(client.keysMatching("form:rl:read:fi:")).toHaveLength(1);
      expect(client.keysMatching("form:rl:read:i:")).toHaveLength(1);
    });

    it("costs one round trip", async () => {
      await consumeRead();
      const afterFirst: number = client.execCount;

      await consumeRead();

      // The first created both keys (a second pipeline set their TTLs).
      expect(afterFirst).toBe(2);
      expect(client.execCount - afterFirst).toBe(1);
    });
  });

  describe("consume - submitting a form", () => {
    it("allows ten submissions from one address to one form in 15 minutes", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        expect((await consumeSubmit()).outcome).toBe(
          FormRateLimitOutcome.Allowed,
        );
      }
    });

    it("refuses the eleventh, naming the form and address counter", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        await consumeSubmit();
      }

      const decision: FormRateLimitDecision = await consumeSubmit();

      expect(decision.outcome).toBe(FormRateLimitOutcome.RateLimited);
      expect(decision.scope).toBe(FormRateLimitScope.FormAndIp);
    });

    it("caps one address across every form at thirty", async () => {
      let rejectedAt: number = -1;
      let rejected: FormRateLimitDecision | null = null;

      for (let i: number = 0; i < SUBMIT_PER_IP_LIMIT + 5; i++) {
        const decision: FormRateLimitDecision = await consumeSubmit({
          formKey: `k:form-${i}`,
        });

        if (
          decision.outcome === FormRateLimitOutcome.RateLimited &&
          !rejected
        ) {
          rejected = decision;
          rejectedAt = i;
        }
      }

      expect(rejectedAt).toBe(SUBMIT_PER_IP_LIMIT);
      expect(rejected?.scope).toBe(FormRateLimitScope.Ip);
    });

    it("tells a caller refused by an address counter to come back when its quarter hour rolls", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        await consumeSubmit();
      }

      currentTime = currentTime + 5 * 60 * 1000;

      const decision: FormRateLimitDecision = await consumeSubmit();

      expect(decision.scope).toBe(FormRateLimitScope.FormAndIp);
      expect(decision.retryAfterSeconds).toBe(10 * 60);
    });

    /*
     * The form's shared ceiling is spent only by a submission that passed
     * every check (consumeFormCeiling, from the service) - never by a request
     * the middleware counts, refused or not. Otherwise anyone holding the
     * link could use it up with requests the IP allowlist, the captcha or
     * the answers refuse, and lock the form for everybody.
     */
    it("never counts a submission's address counters against the form's ceiling", async () => {
      for (let i: number = 0; i < 200; i++) {
        await consumeSubmit({ clientIp: addressNumber(i % 20) });
      }

      expect(client.keysMatching("form:rl:submit:f:")).toEqual([]);
      expect(client.keysMatching(":f:")).toEqual([]);
    });

    it("never refuses for the form's ceiling: sixty-one addresses all pass their own counters", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT + 1; i++) {
        expect(
          (await consumeSubmit({ clientIp: addressNumber(i) })).outcome,
        ).toBe(FormRateLimitOutcome.Allowed);
      }
    });

    /*
     * Reading a form and submitting it must not draw on the same counters,
     * in either direction: a busy form page would otherwise block reports,
     * and reports would be laundered through the far larger read budget.
     */
    it("does not share counters with reading", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT + 5; i++) {
        await consumeSubmit();
      }

      expect((await consumeRead()).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );

      for (let i: number = 0; i < 100; i++) {
        await consumeRead({ formKey: OTHER_FORM_KEY });
      }

      expect((await consumeSubmit({ formKey: OTHER_FORM_KEY })).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );
    });
  });

  /*
   * The ceiling that survives address rotation: however many addresses hold
   * the link, the form declares at most this many incidents an hour. Spent
   * by FormService only for a submission about to create its record.
   */
  describe("consumeFormCeiling - the form's hourly ceiling", () => {
    const consumeCeiling: (
      formKey?: string,
    ) => Promise<FormRateLimitDecision> = (
      formKey: string = FORM_KEY,
    ) => {
      return FormRateLimit.consumeFormCeiling({ formKey });
    };

    it("allows sixty submissions an hour and refuses the next, naming the form ceiling", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT; i++) {
        expect((await consumeCeiling()).outcome).toBe(
          FormRateLimitOutcome.Allowed,
        );
      }

      const decision: FormRateLimitDecision = await consumeCeiling();

      expect(decision.outcome).toBe(FormRateLimitOutcome.RateLimited);
      expect(decision.scope).toBe(FormRateLimitScope.Form);
      expect(decision.isFirstRejectionInWindow).toBe(true);
      expect((await consumeCeiling()).isFirstRejectionInWindow).toBe(false);
    });

    it("tells a caller refused by it to come back when the hour rolls", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT; i++) {
        await consumeCeiling();
      }

      currentTime = currentTime + 20 * 60 * 1000;

      const decision: FormRateLimitDecision = await consumeCeiling();

      expect(decision.scope).toBe(FormRateLimitScope.Form);
      // Forty minutes left of the hour, not what is left of 15 minutes.
      expect(decision.retryAfterSeconds).toBe(40 * 60);
    });

    it("holds for the hour, and starts afresh with the next", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT; i++) {
        await consumeCeiling();
      }

      currentTime = currentTime + SUBMIT_WINDOW_SECONDS * 1000;

      expect((await consumeCeiling()).outcome).toBe(
        FormRateLimitOutcome.RateLimited,
      );

      currentTime = HOUR_ALIGNED_TIME + SUBMIT_PER_FORM_WINDOW_SECONDS * 1000;

      expect((await consumeCeiling()).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );
    });

    it("gives a reset link, which is a new share key, a fresh ceiling", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT + 5; i++) {
        await consumeCeiling();
      }

      expect((await consumeCeiling()).scope).toBe(
        FormRateLimitScope.Form,
      );
      expect((await consumeCeiling(OTHER_FORM_KEY)).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );
    });

    it("counts the form under the key the middleware gives it", async () => {
      await consumeCeiling();

      expect(client.keysMatching("form:rl:submit:f:")).toEqual([
        expect.stringMatching(
          new RegExp(`^form:rl:submit:f:${FORM_KEY}:\\d+$`),
        ),
      ]);
      expect(
        FormRateLimit.getFormKey(
          "  7C9E6679-7425-40DE-944B-E07FC1F90AE7 ",
        ),
      ).toBe(FORM_KEY);
      expect(
        FormRateLimit.resolveFormKey(
          buildRequest({
            params: { shareKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
          }),
        ),
      ).toBe(FORM_KEY);
    });

    it("gives the hour counter a TTL longer than the hour", async () => {
      await consumeCeiling();

      const formCounter: string = client.keysMatching(
        `form:rl:submit:f:${FORM_KEY}:`,
      )[0]!;

      expect(client.expiresForKey(formCounter)).toEqual([
        { key: formCounter, ttlSeconds: SUBMIT_PER_FORM_WINDOW_SECONDS * 2 },
      ]);
    });

    it.each([
      [
        "Redis has no client",
        (): void => {
          getClientMock.mockReturnValue(null);
        },
      ],
      [
        "Redis is not connected",
        (): void => {
          isConnectedMock.mockReturnValue(false);
        },
      ],
      [
        "the pipeline throws",
        (): void => {
          client.failNextExec = new Error("connection reset");
        },
      ],
      [
        "the pipeline returns nothing",
        (): void => {
          client.malformedExecResult = null;
        },
      ],
    ])(
      "reports unavailable when %s",
      async (_label: string, breakRedis: () => void) => {
        breakRedis();

        expect((await consumeCeiling()).outcome).toBe(
          FormRateLimitOutcome.CounterUnavailable,
        );
      },
    );
  });

  describe("reserveFormSubmission - what the service calls before declaring", () => {
    const SHARE_KEY: string = "7C9E6679-7425-40DE-944B-E07FC1F90AE7";

    const refusalOf: () => Promise<unknown> = async () => {
      try {
        await FormRateLimit.reserveFormSubmission({
          shareKey: SHARE_KEY,
        });
      } catch (err) {
        return err;
      }

      return undefined;
    };

    it("spends one of the form's submissions, and refuses the sixty-first with when to come back", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT; i++) {
        expect(await refusalOf()).toBeUndefined();
      }

      currentTime = currentTime + 15 * 60 * 1000;

      const error: unknown = await refusalOf();

      expect(error).toBeInstanceOf(FormCeilingException);
      expect(error).toBeInstanceOf(TooManyRequestsException);
      expect((error as Exception).code).toBe(429);
      expect((error as Exception).message).toBe(
        FORM_TOTAL_RATE_LIMIT_MESSAGE,
      );
      expect((error as FormCeilingException).retryAfterSeconds).toBe(
        45 * 60,
      );
      expect(
        client.keysMatching(`form:rl:submit:f:${FORM_KEY}:`),
      ).toHaveLength(1);
    });

    it("logs the first refusal of the hour, then stays quiet", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT; i++) {
        await refusalOf();
      }

      loggerWarnMock.mockClear();

      for (let i: number = 0; i < 20; i++) {
        await refusalOf();
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
      expect(String(loggerWarnMock.mock.calls[0]![0])).toContain("form limit");
    });

    it("fails closed with a 503 when the counter cannot be reached", async () => {
      isConnectedMock.mockReturnValue(false);

      const error: unknown = await refusalOf();

      expect(error).toBeInstanceOf(ServiceUnavailableException);
      expect((error as Exception).code).toBe(503);
      expect((error as Exception).message).toBe(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    });

    it("writes the refusal's Retry-After on the route's response, and nothing for any other error", () => {
      const built: BuiltResponse = buildResponse();

      FormRateLimit.setRetryAfterFor(
        built.response,
        new TooManyRequestsException("another limiter"),
      );

      expect(built.headers).toEqual({});

      FormRateLimit.setRetryAfterFor(
        built.response,
        new FormCeilingException(1234),
      );

      expect(built.headers).toEqual({ "Retry-After": "1234" });
    });
  });

  describe("consume - window behaviour", () => {
    it("sets a TTL only on the request that created a counter", async () => {
      await consumeRead();

      const formAndIpKey: string = client.keysMatching(":fi:")[0]!;

      expect(client.expiresForKey(formAndIpKey)).toHaveLength(1);

      for (let i: number = 0; i < 20; i++) {
        await consumeRead();
      }

      /*
       * Re-issuing EXPIRE on every increment would slide the window forward
       * for as long as the load continued, so a client that tripped the
       * limit could never recover.
       */
      expect(client.expiresForKey(formAndIpKey)).toHaveLength(1);
    });

    it("gives every counter a TTL of two of its windows", async () => {
      await consumeRead();
      await consumeSubmit();
      await FormRateLimit.consumeFormCeiling({ formKey: FORM_KEY });

      expect(client.expires.length).toBe(5);

      for (const recorded of client.expires) {
        const windowSeconds: number = recorded.key.startsWith("form:rl:read:")
          ? READ_WINDOW_SECONDS
          : recorded.key.includes(":f:")
            ? SUBMIT_PER_FORM_WINDOW_SECONDS
            : SUBMIT_WINDOW_SECONDS;

        expect(recorded.ttlSeconds).toBe(windowSeconds * 2);
      }
    });

    it("starts a fresh allowance when the window rolls, and not before", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT + 1; i++) {
        await consumeRead();
      }

      currentTime = currentTime + (READ_WINDOW_SECONDS - 1) * 1000;

      expect((await consumeRead()).outcome).toBe(
        FormRateLimitOutcome.RateLimited,
      );

      currentTime = HOUR_ALIGNED_TIME + READ_WINDOW_SECONDS * 1000;

      expect((await consumeRead()).outcome).toBe(
        FormRateLimitOutcome.Allowed,
      );
    });

    /*
     * A refused request still counts. Otherwise a client that keeps
     * hammering is handed a fresh allowance the moment it is refused.
     */
    it("counts refused requests too", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT; i++) {
        await consumeRead();
      }

      const before: number = client.incrCallCount;

      await consumeRead();
      await consumeRead();

      expect(client.incrCallCount).toBe(before + 4);
    });

    it("says to retry inside the current window, sooner as it drains, never after zero seconds", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT + 1; i++) {
        await consumeRead();
      }

      const atStart: FormRateLimitDecision = await consumeRead();

      expect(atStart.retryAfterSeconds).toBe(READ_WINDOW_SECONDS);

      currentTime = currentTime + 30_000;

      expect((await consumeRead()).retryAfterSeconds).toBe(30);

      currentTime = HOUR_ALIGNED_TIME + READ_WINDOW_SECONDS * 1000 - 1;

      expect((await consumeRead()).retryAfterSeconds).toBe(1);
    });

    it("marks only the crossing as the first refusal of the window", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT; i++) {
        await consumeRead();
      }

      expect((await consumeRead()).isFirstRejectionInWindow).toBe(true);
      expect((await consumeRead()).isFirstRejectionInWindow).toBe(false);
    });
  });

  describe("consume - counter unavailable", () => {
    it.each([
      [FormRateLimitBucket.Read],
      [FormRateLimitBucket.Submit],
    ])(
      "reports unavailable for %s when Redis has no client",
      async (bucket: FormRateLimitBucket) => {
        getClientMock.mockReturnValue(null);

        expect((await consume({ bucket })).outcome).toBe(
          FormRateLimitOutcome.CounterUnavailable,
        );
      },
    );

    it("reports unavailable when Redis is not connected", async () => {
      isConnectedMock.mockReturnValue(false);

      expect((await consumeSubmit()).outcome).toBe(
        FormRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when the pipeline throws", async () => {
      client.failNextExec = new Error("connection reset");

      expect((await consumeRead()).outcome).toBe(
        FormRateLimitOutcome.CounterUnavailable,
      );
    });

    it("reports unavailable when setting a new counter's TTL fails", async () => {
      // exec 1 counts the address counters, exec 2 sets their TTLs.
      client.failExecNumber = 2;

      expect((await consumeSubmit()).outcome).toBe(
        FormRateLimitOutcome.CounterUnavailable,
      );
    });

    it.each([
      ["returns null", null],
      ["returns too few results", [[null, 1]]],
      [
        "reports a failed command",
        [
          [new Error("READONLY"), null],
          [null, 1],
        ],
      ],
      [
        "returns a non-numeric count",
        [
          [null, "1"],
          [null, 1],
        ],
      ],
    ])(
      "reports unavailable when the pipeline %s",
      async (_label: string, result: unknown) => {
        client.malformedExecResult = result;

        expect((await consumeSubmit()).outcome).toBe(
          FormRateLimitOutcome.CounterUnavailable,
        );
      },
    );

    it("never throws out of consume", async () => {
      client.failNextExec = new Error("boom");

      await expect(consumeSubmit()).resolves.toBeDefined();
    });
  });

  describe("getMiddleware", () => {
    const runMiddleware: (data: {
      bucket?: FormRateLimitBucket;
      request?: ExpressRequest;
      response?: ExpressResponse;
    }) => Promise<{
      nextCalled: boolean;
      headers: Record<string, string>;
    }> = async (data: {
      bucket?: FormRateLimitBucket;
      request?: ExpressRequest;
      response?: ExpressResponse;
    }) => {
      const built: BuiltResponse = buildResponse();
      let nextCalled: boolean = false;

      await FormRateLimit.getMiddleware(data.bucket)(
        data.request ||
          buildRequest({
            params: { shareKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
            headers: { "x-forwarded-for": CLIENT_IP },
          }),
        data.response || built.response,
        (() => {
          nextCalled = true;
        }) as unknown as NextFunction,
      );

      return { nextCalled, headers: built.headers };
    };

    const lastError: () => Exception = () => {
      const calls: Array<Array<unknown>> = sendErrorResponseMock.mock
        .calls as Array<Array<unknown>>;

      return calls[calls.length - 1]![2] as Exception;
    };

    it("passes an allowed request through", async () => {
      expect(
        (await runMiddleware({ bucket: FormRateLimitBucket.Submit }))
          .nextCalled,
      ).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("counts on the read bucket unless told otherwise", async () => {
      await runMiddleware({});

      expect(client.keysMatching("form:rl:read:")).toHaveLength(2);
      expect(client.keysMatching("form:rl:submit:")).toHaveLength(0);
    });

    it("counts the share key in the path and the trusted client address", async () => {
      await runMiddleware({
        bucket: FormRateLimitBucket.Read,
        request: buildRequest({
          params: { shareKey: "7C9E6679-7425-40DE-944B-E07FC1F90AE7" },
          headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" },
        }),
      });

      expect(client.keysMatching(":fi:")).toEqual([
        expect.stringContaining(`:fi:${FORM_KEY}:203.0.113.7:`),
      ]);
    });

    /*
     * The property everything rests on: a refused request must not reach
     * the handler, or the incident is declared anyway and the limiter is
     * decoration.
     */
    it("stops a refused submission before the handler", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Submit });
      }

      const refused: { nextCalled: boolean; headers: Record<string, string> } =
        await runMiddleware({ bucket: FormRateLimitBucket.Submit });

      expect(refused.nextCalled).toBe(false);
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(1);
      expect(lastError().code).toBe(ExceptionCode.TooManyRequestsException);
      expect(lastError().code).toBe(429);
      expect(lastError().message).toBe(FORM_SUBMIT_RATE_LIMIT_MESSAGE);
      expect(Number(refused.headers["Retry-After"])).toBe(
        SUBMIT_WINDOW_SECONDS,
      );
    });

    it("words a refused read as a read", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT + 1; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Read });
      }

      expect(lastError().code).toBe(429);
      expect(lastError().message).toBe(FORM_READ_RATE_LIMIT_MESSAGE);
    });

    /*
     * The form's ceiling is the service's to spend, after every check: the
     * middleware lets sixty-one addresses through to be judged, and counts
     * none of them against it.
     */
    it("never refuses a submission for the form's own ceiling, nor spends it", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_LIMIT + 1; i++) {
        expect(
          (
            await runMiddleware({
              bucket: FormRateLimitBucket.Submit,
              request: buildRequest({
                params: { shareKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
                headers: { "x-forwarded-for": addressNumber(i) },
              }),
            })
          ).nextCalled,
        ).toBe(true);
      }

      expect(sendErrorResponseMock).not.toHaveBeenCalled();
      expect(client.keysMatching("form:rl:submit:f:")).toEqual([]);
    });

    it("never tells a refused caller the limit or its count", async () => {
      const messages: Array<string> = [
        FORM_READ_RATE_LIMIT_MESSAGE,
        FORM_SUBMIT_RATE_LIMIT_MESSAGE,
        FORM_TOTAL_RATE_LIMIT_MESSAGE,
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      ];

      for (const message of messages) {
        expect(message).not.toMatch(/\d/);
      }
    });

    it("survives a response object with no setHeader", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT + 2; i++) {
        await expect(
          runMiddleware({
            bucket: FormRateLimitBucket.Submit,
            response: {} as unknown as ExpressResponse,
          }),
        ).resolves.toBeDefined();
      }
    });

    /*
     * Reads fail OPEN when Redis is gone: showing a form's questions is
     * read-only, and turning every report form into an error page over a
     * Redis blip is worse than an unbounded window for its duration.
     */
    it("serves reads unthrottled when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      expect(
        (await runMiddleware({ bucket: FormRateLimitBucket.Read }))
          .nextCalled,
      ).toBe(true);
      expect(sendErrorResponseMock).not.toHaveBeenCalled();
    });

    it("still serves reads when the counter errors", async () => {
      client.failNextExec = new Error("connection reset");

      expect(
        (await runMiddleware({ bucket: FormRateLimitBucket.Read }))
          .nextCalled,
      ).toBe(true);
    });

    /*
     * Submits fail CLOSED: without the counter nothing bounds how many
     * incidents - and pages - a link can produce.
     */
    it("refuses submissions with a 503 when Redis is gone", async () => {
      isConnectedMock.mockReturnValue(false);

      const result: { nextCalled: boolean } = await runMiddleware({
        bucket: FormRateLimitBucket.Submit,
      });

      expect(result.nextCalled).toBe(false);
      expect(lastError().code).toBe(ExceptionCode.ServiceUnavailableException);
      expect(lastError().code).toBe(503);
      expect(lastError().message).toBe(
        FORM_RATE_LIMIT_UNAVAILABLE_MESSAGE,
      );
    });

    it("refuses submissions when the counter errors", async () => {
      client.failNextExec = new Error("connection reset");

      expect(
        (await runMiddleware({ bucket: FormRateLimitBucket.Submit }))
          .nextCalled,
      ).toBe(false);
      expect(lastError().code).toBe(503);
    });

    /*
     * A limiter exists because the caller keeps knocking. Logging every
     * refusal would turn their flood into a second one in the log pipeline.
     */
    it("logs the moment a caller crosses the line, then stays quiet", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Submit });
      }

      loggerWarnMock.mockClear();

      await runMiddleware({ bucket: FormRateLimitBucket.Submit });

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
      expect(String(loggerWarnMock.mock.calls[0]![0])).toContain(
        "form-and-ip limit",
      );

      for (let i: number = 0; i < 50; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Submit });
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    it("logs the crossing again once the window rolls", async () => {
      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT + 5; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Read });
      }

      currentTime = currentTime + READ_WINDOW_SECONDS * 1000;
      loggerWarnMock.mockClear();

      for (let i: number = 0; i < READ_PER_FORM_AND_IP_LIMIT + 5; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Read });
      }

      expect(loggerWarnMock).toHaveBeenCalledTimes(1);
    });

    /*
     * An outage puts EVERY request on the unavailable path, so an unguarded
     * log line there is one line per request for the whole outage.
     */
    it("does not log once per request while Redis is down", async () => {
      isConnectedMock.mockReturnValue(false);
      currentTime = currentTime + 10 * 60 * 1000;
      loggerWarnMock.mockClear();
      loggerErrorMock.mockClear();

      for (let i: number = 0; i < 100; i++) {
        await runMiddleware({ bucket: FormRateLimitBucket.Read });
        await runMiddleware({ bucket: FormRateLimitBucket.Submit });
      }

      /*
       * The read warning plus its attributes line, and one refusal line -
       * not two hundred. (The clock moved past any earlier test's line.)
       */
      expect(loggerWarnMock).toHaveBeenCalledTimes(2);
      expect(loggerErrorMock).toHaveBeenCalledTimes(1);

      // Every submission was still refused.
      expect(sendErrorResponseMock).toHaveBeenCalledTimes(100);
    });

    it("logs the outage again after the throttle interval", async () => {
      isConnectedMock.mockReturnValue(false);
      currentTime = currentTime + 20 * 60 * 1000;

      await runMiddleware({ bucket: FormRateLimitBucket.Submit });

      currentTime = currentTime + 60_000;
      loggerErrorMock.mockClear();

      await runMiddleware({ bucket: FormRateLimitBucket.Submit });

      expect(loggerErrorMock).toHaveBeenCalledTimes(1);
    });

    it("keeps one bucket for one real client however the header is forged", async () => {
      for (let i: number = 0; i < SUBMIT_PER_FORM_AND_IP_LIMIT; i++) {
        await runMiddleware({
          bucket: FormRateLimitBucket.Submit,
          request: buildRequest({
            params: { shareKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
            headers: { "x-forwarded-for": `10.0.0.${i}, ${CLIENT_IP}` },
          }),
        });
      }

      expect(
        (
          await runMiddleware({
            bucket: FormRateLimitBucket.Submit,
            request: buildRequest({
              params: { shareKey: "7c9e6679-7425-40de-944b-e07fc1f90ae7" },
              headers: { "x-forwarded-for": `1.2.3.4, ${CLIENT_IP}` },
            }),
          })
        ).nextCalled,
      ).toBe(false);
    });
  });
});

/*
 * The budgets are read from the environment when the module loads, so these
 * reload it rather than calling into the already configured one.
 */
describe("FormRateLimit configuration", () => {
  const originalEnv: NodeJS.ProcessEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    jest.resetModules();
  });

  interface ReloadedModule {
    limiter: typeof FormRateLimit;
    client: FakeRedisClient;
  }

  const reload: () => Promise<ReloadedModule> = async () => {
    jest.resetModules();

    const redisModule: {
      default: { getClient: MockedFn; isConnected: MockedFn };
    } = (await import("../../../Server/Infrastructure/Redis")) as unknown as {
      default: { getClient: MockedFn; isConnected: MockedFn };
    };

    const limiterModule: { default: typeof FormRateLimit } =
      (await import(
        "../../../Server/Middleware/FormRateLimit"
      )) as unknown as { default: typeof FormRateLimit };

    const client: FakeRedisClient = new FakeRedisClient();

    redisModule.default.getClient.mockReturnValue(client);
    redisModule.default.isConnected.mockReturnValue(true);

    return { limiter: limiterModule.default, client };
  };

  it.each([
    [
      "INCIDENT_FORM_RATE_LIMIT_WINDOW_SECONDS",
      FormRateLimitBucket.Read,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.windowSeconds;
      },
    ],
    [
      "INCIDENT_FORM_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW",
      FormRateLimitBucket.Read,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.perFormAndIpLimit;
      },
    ],
    [
      "INCIDENT_FORM_RATE_LIMIT_PER_IP_PER_WINDOW",
      FormRateLimitBucket.Read,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.perIpLimit;
      },
    ],
    [
      "INCIDENT_FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS",
      FormRateLimitBucket.Submit,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.windowSeconds;
      },
    ],
    [
      "INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW",
      FormRateLimitBucket.Submit,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.perFormAndIpLimit;
      },
    ],
    [
      "INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_IP_PER_WINDOW",
      FormRateLimitBucket.Submit,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.perIpLimit;
      },
    ],
    [
      "INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_WINDOW_SECONDS",
      FormRateLimitBucket.Submit,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.perForm?.windowSeconds;
      },
    ],
    [
      "INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW",
      FormRateLimitBucket.Submit,
      (config: FormRateLimitBucketConfig): unknown => {
        return config.perForm?.limit;
      },
    ],
  ])(
    "honours %s, under its own name and the incident forms' one",
    async (
      oldEnvKey: string,
      bucket: FormRateLimitBucket,
      read: (config: FormRateLimitBucketConfig) => unknown,
    ) => {
      const envKey: string = oldEnvKey.replace(/^INCIDENT_FORM_/, "FORM_");

      // The name forms read first.
      process.env[envKey] = "7";
      expect(read((await reload()).limiter.getBucketConfig(bucket))).toBe(7);

      // The name incident forms read: an installation that tuned them keeps
      // its limits.
      delete process.env[envKey];
      process.env[oldEnvKey] = "9";
      expect(read((await reload()).limiter.getBucketConfig(bucket))).toBe(9);

      // Both set: the new name wins.
      process.env[envKey] = "11";
      expect(read((await reload()).limiter.getBucketConfig(bucket))).toBe(11);

      // A new name that is not a limit falls back to the old one.
      process.env[envKey] = "zero";
      expect(read((await reload()).limiter.getBucketConfig(bucket))).toBe(9);
    },
  );

  it.each([["not-a-number"], ["0"], ["-5"], [""]])(
    "falls back to the default for %j",
    async (value: string) => {
      process.env["FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW"] = value;
      process.env["INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW"] =
        value;
      process.env["FORM_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW"] = value;
      process.env["INCIDENT_FORM_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW"] =
        value;

      const { limiter } = await reload();

      expect(
        limiter.getBucketConfig(FormRateLimitBucket.Submit).perForm
          ?.limit,
      ).toBe(SUBMIT_PER_FORM_LIMIT);
      expect(
        limiter.getBucketConfig(FormRateLimitBucket.Read)
          .perFormAndIpLimit,
      ).toBe(READ_PER_FORM_AND_IP_LIMIT);
    },
  );

  it("enforces a configured per-form ceiling", async () => {
    process.env["FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW"] = "3";

    const { limiter } = await reload();

    for (let i: number = 0; i < 3; i++) {
      expect(
        (await limiter.consumeFormCeiling({ formKey: FORM_KEY })).outcome,
      ).toBe(FormRateLimitOutcome.Allowed);
    }

    const decision: FormRateLimitDecision =
      await limiter.consumeFormCeiling({ formKey: FORM_KEY });

    expect(decision.outcome).toBe(FormRateLimitOutcome.RateLimited);
    expect(decision.scope).toBe(FormRateLimitScope.Form);
  });

  it("enforces a configured per-address read ceiling", async () => {
    process.env["FORM_RATE_LIMIT_PER_IP_PER_WINDOW"] = "4";

    const { limiter } = await reload();

    const outcomes: Array<FormRateLimitScope | undefined> = [];

    for (let i: number = 0; i < 6; i++) {
      outcomes.push(
        (
          await limiter.consume({
            formKey: `k:rotating-${i}`,
            clientIp: CLIENT_IP,
            bucket: FormRateLimitBucket.Read,
          })
        ).scope,
      );
    }

    expect(outcomes).toEqual([
      undefined,
      undefined,
      undefined,
      undefined,
      FormRateLimitScope.Ip,
      FormRateLimitScope.Ip,
    ]);
  });

  /*
   * Behind an extra load balancer the operator widens the instance-wide
   * TRUSTED_PROXY_HOPS, which the form's IP allowlist also reads. The
   * limiter has no private knob that could leave it reading the balancer's
   * address while the allowlist reads the visitor's.
   */
  it("counts back the instance-wide trusted hop count", async () => {
    process.env["TRUSTED_PROXY_HOPS"] = "2";

    const { limiter } = await reload();

    expect(
      limiter.resolveClientIp(
        buildRequest({
          headers: { "x-forwarded-for": "203.0.113.7, 10.0.0.5, 10.0.0.6" },
        }),
      ),
    ).toBe("10.0.0.5");
  });
});
