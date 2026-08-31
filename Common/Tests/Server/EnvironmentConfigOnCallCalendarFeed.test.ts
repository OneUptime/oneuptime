import { afterEach, describe, expect, it, jest } from "@jest/globals";

/*
 * The environment knobs the on-call calendar feeds read at boot, plus the
 * ENCRYPTION_SECRET boot warning that ships with them (the feed tokens are
 * one more thing that secret protects).
 *
 * EnvironmentConfig reads process.env at module load, so every case here
 * sets the environment, resets the module registry and imports afresh.
 */

interface EnvironmentConfigShape {
  DisableOnCallCalendarFeed: boolean;
  OnCallCalendarFeedRateLimitWindowSeconds: number;
  OnCallCalendarFeedRateLimitPerTokenPerWindow: number;
  OnCallCalendarFeedRateLimitPerIpPerWindow: number;
  IsEncryptionSecretInsecure: boolean;
  EncryptionSecretWarning: string | null;
}

const MANAGED_KEYS: Array<string> = [
  "DISABLE_ON_CALL_CALENDAR_FEED",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW",
  "ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW",
  "ENCRYPTION_SECRET",
];

const originalEnv: NodeJS.ProcessEnv = { ...process.env };

async function load(
  overrides: Record<string, string | undefined>,
): Promise<EnvironmentConfigShape> {
  for (const key of MANAGED_KEYS) {
    delete process.env[key];
  }

  for (const [key, value] of Object.entries(overrides)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }

  jest.resetModules();

  return (await import(
    "../../Server/EnvironmentConfig"
  )) as unknown as EnvironmentConfigShape;
}

afterEach(() => {
  process.env = { ...originalEnv };
  jest.resetModules();
});

describe("DISABLE_ON_CALL_CALENDAR_FEED", () => {
  it("is off by default", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.DisableOnCallCalendarFeed).toBe(false);
  });

  it("is on for the literal true", async () => {
    const config: EnvironmentConfigShape = await load({
      DISABLE_ON_CALL_CALENDAR_FEED: "true",
    });

    expect(config.DisableOnCallCalendarFeed).toBe(true);
  });

  it("is off for anything that is not the literal true", async () => {
    for (const value of ["false", "", "1", "yes", "TRUE", "True", " true"]) {
      const config: EnvironmentConfigShape = await load({
        DISABLE_ON_CALL_CALENDAR_FEED: value,
      });

      expect(config.DisableOnCallCalendarFeed).toBe(false);
    }
  });
});

describe("ON_CALL_CALENDAR_FEED_RATE_LIMIT_*", () => {
  it("defaults to a 60 second window, 60 per token and 3000 per address", async () => {
    const config: EnvironmentConfigShape = await load({});

    expect(config.OnCallCalendarFeedRateLimitWindowSeconds).toBe(60);
    expect(config.OnCallCalendarFeedRateLimitPerTokenPerWindow).toBe(60);
    expect(config.OnCallCalendarFeedRateLimitPerIpPerWindow).toBe(3000);
  });

  it("reads each value independently", async () => {
    const config: EnvironmentConfigShape = await load({
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS: "120",
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW: "10",
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW: "500",
    });

    expect(config.OnCallCalendarFeedRateLimitWindowSeconds).toBe(120);
    expect(config.OnCallCalendarFeedRateLimitPerTokenPerWindow).toBe(10);
    expect(config.OnCallCalendarFeedRateLimitPerIpPerWindow).toBe(500);
  });

  it("tolerates surrounding whitespace", async () => {
    const config: EnvironmentConfigShape = await load({
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW: "  25 ",
    });

    expect(config.OnCallCalendarFeedRateLimitPerTokenPerWindow).toBe(25);
  });

  it("treats a blank value as unset (compose passes ${VAR:-} through)", async () => {
    const config: EnvironmentConfigShape = await load({
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS: "",
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW: "   ",
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW: "",
    });

    expect(config.OnCallCalendarFeedRateLimitWindowSeconds).toBe(60);
    expect(config.OnCallCalendarFeedRateLimitPerTokenPerWindow).toBe(60);
    expect(config.OnCallCalendarFeedRateLimitPerIpPerWindow).toBe(3000);
  });

  it("falls back to the default for anything that is not a positive whole number", async () => {
    for (const bad of [
      "0",
      "-5",
      "1.5",
      "abc",
      "NaN",
      "Infinity",
      "1e3x",
      "60s",
    ]) {
      const config: EnvironmentConfigShape = await load({
        ON_CALL_CALENDAR_FEED_RATE_LIMIT_WINDOW_SECONDS: bad,
        ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_TOKEN_PER_WINDOW: bad,
        ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW: bad,
      });

      expect(config.OnCallCalendarFeedRateLimitWindowSeconds).toBe(60);
      expect(config.OnCallCalendarFeedRateLimitPerTokenPerWindow).toBe(60);
      expect(config.OnCallCalendarFeedRateLimitPerIpPerWindow).toBe(3000);
    }
  });

  it("does not round a fractional value into something the operator did not ask for", async () => {
    const config: EnvironmentConfigShape = await load({
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW: "2999.9",
    });

    expect(config.OnCallCalendarFeedRateLimitPerIpPerWindow).toBe(3000);
  });

  it("accepts a large but finite value", async () => {
    const config: EnvironmentConfigShape = await load({
      ON_CALL_CALENDAR_FEED_RATE_LIMIT_PER_IP_PER_WINDOW: "1000000",
    });

    expect(config.OnCallCalendarFeedRateLimitPerIpPerWindow).toBe(1000000);
  });
});

describe("ENCRYPTION_SECRET boot warning", () => {
  it("warns when the secret is unset", async () => {
    const config: EnvironmentConfigShape = await load({
      ENCRYPTION_SECRET: undefined,
    });

    expect(config.IsEncryptionSecretInsecure).toBe(true);
    expect(config.EncryptionSecretWarning).toEqual(expect.any(String));
  });

  it("warns when the secret is the shipped placeholder", async () => {
    const config: EnvironmentConfigShape = await load({
      ENCRYPTION_SECRET: "secret",
    });

    expect(config.IsEncryptionSecretInsecure).toBe(true);
    expect(config.EncryptionSecretWarning).not.toBeNull();
  });

  it("warns when the secret is blank or whitespace", async () => {
    for (const value of ["", "   ", "\t"]) {
      const config: EnvironmentConfigShape = await load({
        ENCRYPTION_SECRET: value,
      });

      expect(config.IsEncryptionSecretInsecure).toBe(true);
    }
  });

  it("warns when the placeholder is padded with whitespace", async () => {
    const config: EnvironmentConfigShape = await load({
      ENCRYPTION_SECRET: " secret ",
    });

    expect(config.IsEncryptionSecretInsecure).toBe(true);
  });

  it("is silent for a real secret", async () => {
    const config: EnvironmentConfigShape = await load({
      ENCRYPTION_SECRET: "b2f0c1e9d8a7f6e5d4c3b2a1908f7e6d5c4b3a2918f7e6d5",
    });

    expect(config.IsEncryptionSecretInsecure).toBe(false);
    expect(config.EncryptionSecretWarning).toBeNull();
  });

  it("is case-sensitive about the placeholder, since the encryption key is", async () => {
    /*
     * "Secret" is a different (still terrible) key; the warning is about the
     * one value the repository ships, which is what an attacker would try.
     * Anything else is the operator's own choice.
     */
    const config: EnvironmentConfigShape = await load({
      ENCRYPTION_SECRET: "Secret",
    });

    expect(config.IsEncryptionSecretInsecure).toBe(false);
  });

  it("says what is at stake and what to do, without echoing any secret", async () => {
    const config: EnvironmentConfigShape = await load({
      ENCRYPTION_SECRET: "secret",
    });

    const warning: string = config.EncryptionSecretWarning || "";

    expect(warning).toContain("ENCRYPTION_SECRET");
    expect(warning).toMatch(/encrypted/i);
    expect(warning).toMatch(/calendar feed/i);
    expect(warning).toMatch(/config\.env|Helm/);
    /* It names the placeholder in quotes as a fact, never an operator's own value. */
    expect(warning).toContain('"secret"');
    expect(warning).not.toContain("b2f0c1e9");
  });

  it("still exposes a usable EncryptionSecret when warning, so nothing refuses to boot", async () => {
    const config: EnvironmentConfigShape & {
      EncryptionSecret: { toString: () => string };
    } = (await load({
      ENCRYPTION_SECRET: undefined,
    })) as EnvironmentConfigShape & {
      EncryptionSecret: { toString: () => string };
    };

    expect(config.EncryptionSecret.toString()).toBe("secret");
    expect(config.IsEncryptionSecretInsecure).toBe(true);
  });
});
