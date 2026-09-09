import IdentityRateLimit, {
  IdentityRateLimitBucket,
  IdentityRateLimitOutcome,
  IdentityRateLimitDecision,
} from "../../../Server/Middleware/IdentityRateLimit";
import Redis from "../../../Server/Infrastructure/Redis";

jest.mock("../../../Server/Infrastructure/Redis", () => {
  return {
    __esModule: true,
    default: { getClient: jest.fn(), isConnected: jest.fn() },
  };
});
jest.mock("../../../Server/Utils/Logger", () => {
  return { __esModule: true, default: { warn: jest.fn(), error: jest.fn() } };
});
jest.mock("../../../Server/Utils/Response", () => {
  return { __esModule: true, default: { sendErrorResponse: jest.fn() } };
});

const counters: Map<string, number> = new Map();

type Command = () => [null, number];
class CounterPipeline {
  private commands: Array<Command> = [];

  public incr(key: string): this {
    this.commands.push((): [null, number] => {
      const count: number = (counters.get(key) || 0) + 1;
      counters.set(key, count);
      return [null, count];
    });
    return this;
  }

  public expire(): this {
    return this;
  }

  public async exec(): Promise<Array<[null, number]>> {
    return this.commands.map((command: Command): [null, number] => {
      return command();
    });
  }
}

beforeEach(() => {
  jest.spyOn(Date, "now").mockReturnValue(Date.UTC(2026, 8, 9, 12, 0, 0));
  counters.clear();
  jest.mocked(Redis.isConnected).mockReturnValue(true);
  jest.mocked(Redis.getClient).mockReturnValue({
    pipeline: (): CounterPipeline => {
      return new CounterPipeline();
    },
  } as unknown as ReturnType<typeof Redis.getClient>);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("discoverable passkey rate limits", () => {
  it("gives requests without an email the IP budget instead of the password account budget", () => {
    const config: ReturnType<typeof IdentityRateLimit.getBucketConfig> =
      IdentityRateLimit.getBucketConfig(IdentityRateLimitBucket.Passkey);
    expect(config.perAccountLimit).toBe(300);
    expect(config.perIpLimit).toBe(300);
    expect(config.windowSeconds).toBe(900);
  });

  it("allows a shared office address to finish 150 passkey ceremonies then limits further requests", async () => {
    for (let attempt: number = 0; attempt < 300; attempt++) {
      const result: IdentityRateLimitDecision = await IdentityRateLimit.consume(
        {
          accountKey: "none",
          clientIp: "203.0.113.5",
          bucket: IdentityRateLimitBucket.Passkey,
        },
      );
      expect(result.outcome).toBe(IdentityRateLimitOutcome.Allowed);
    }
    const result: IdentityRateLimitDecision = await IdentityRateLimit.consume({
      accountKey: "none",
      clientIp: "203.0.113.5",
      bucket: IdentityRateLimitBucket.Passkey,
    });
    expect(result.outcome).toBe(IdentityRateLimitOutcome.RateLimited);
    expect(result.retryAfterSeconds).toBeGreaterThan(0);
  });

  it("bounds requests even when callers rotate submitted email addresses", async () => {
    for (let attempt: number = 0; attempt < 300; attempt++) {
      await IdentityRateLimit.consume({
        accountKey: `user${attempt}@example.com`,
        clientIp: "203.0.113.5",
        bucket: IdentityRateLimitBucket.Passkey,
      });
    }
    const result: IdentityRateLimitDecision = await IdentityRateLimit.consume({
      accountKey: "another@example.com",
      clientIp: "203.0.113.5",
      bucket: IdentityRateLimitBucket.Passkey,
    });
    expect(result.outcome).toBe(IdentityRateLimitOutcome.RateLimited);
  });

  it("preserves password fallback and another client's passkey allowance", async () => {
    for (let attempt: number = 0; attempt < 301; attempt++) {
      await IdentityRateLimit.consume({
        accountKey: "none",
        clientIp: "203.0.113.5",
        bucket: IdentityRateLimitBucket.Passkey,
      });
    }
    const password: IdentityRateLimitDecision = await IdentityRateLimit.consume(
      {
        accountKey: "none",
        clientIp: "203.0.113.5",
        bucket: IdentityRateLimitBucket.Login,
      },
    );
    const otherClient: IdentityRateLimitDecision =
      await IdentityRateLimit.consume({
        accountKey: "none",
        clientIp: "203.0.113.6",
        bucket: IdentityRateLimitBucket.Passkey,
      });
    expect(password.outcome).toBe(IdentityRateLimitOutcome.Allowed);
    expect(otherClient.outcome).toBe(IdentityRateLimitOutcome.Allowed);
  });

  it("fails closed when Redis is unavailable", async () => {
    jest.mocked(Redis.isConnected).mockReturnValue(false);
    const result: IdentityRateLimitDecision = await IdentityRateLimit.consume({
      accountKey: "none",
      clientIp: "203.0.113.5",
      bucket: IdentityRateLimitBucket.Passkey,
    });
    expect(result.outcome).toBe(IdentityRateLimitOutcome.CounterUnavailable);
  });
});
