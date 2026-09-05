import {
  RESEND_COOLDOWN_SECONDS,
  VERIFICATION_CODE_EXPIRY_MINUTES,
} from "../../../Server/Utils/ChannelVerification";
import TelegramVerificationToken, {
  TELEGRAM_VERIFICATION_TOKEN_LENGTH,
} from "../../../Server/Utils/TelegramVerificationToken";

describe("TelegramVerificationToken", () => {
  const issuedAt: Date = new Date("2026-09-04T12:00:00.000Z");

  describe("mint", () => {
    test("creates a Telegram-safe 52-character bearer capability", () => {
      const token: string = TelegramVerificationToken.mint(issuedAt);

      expect(token).toHaveLength(TELEGRAM_VERIFICATION_TOKEN_LENGTH);
      expect(TelegramVerificationToken.isValidShape(token)).toBe(true);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(token).toMatch(/^[0-9a-z]{8}_[A-Za-z0-9_-]{43}$/);
    });

    test("uses fresh CSPRNG material for tokens issued in the same second", () => {
      const tokens: Set<string> = new Set(
        Array.from({ length: 32 }, () => {
          return TelegramVerificationToken.mint(issuedAt);
        }),
      );

      expect(tokens.size).toBe(32);
    });

    test("encodes the issue time to whole-second precision", () => {
      const token: string = TelegramVerificationToken.mint(
        new Date("2026-09-04T12:00:00.987Z"),
      );

      expect(TelegramVerificationToken.getIssuedAt(token)).toEqual(issuedAt);
    });

    test("stays below Telegram's 64-character start parameter limit", () => {
      expect(TELEGRAM_VERIFICATION_TOKEN_LENGTH).toBeLessThanOrEqual(64);
    });
  });

  describe("shape validation", () => {
    test.each([
      undefined,
      null,
      "",
      "123456",
      "00000000_short",
      "000000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "00000000_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA!",
      "ZZZZZZZZ_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      "00000000.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
      {},
    ])("rejects malformed token %#", (token: unknown) => {
      expect(TelegramVerificationToken.isValidShape(token)).toBe(false);
      expect(TelegramVerificationToken.getIssuedAt(token)).toBeNull();
    });

    test("rejects an all-zero timestamp", () => {
      const token: string = `00000000_${"A".repeat(43)}`;

      expect(TelegramVerificationToken.isValidShape(token)).toBe(true);
      expect(TelegramVerificationToken.getIssuedAt(token)).toBeNull();
      expect(
        TelegramVerificationToken.isExpired({ token, now: issuedAt }),
      ).toBe(true);
    });
  });

  describe("expiry", () => {
    const token: string = TelegramVerificationToken.mint(issuedAt);
    const expiryMs: number = VERIFICATION_CODE_EXPIRY_MINUTES * 60 * 1000;

    test("accepts a token immediately after issue", () => {
      expect(
        TelegramVerificationToken.isExpired({ token, now: issuedAt }),
      ).toBe(false);
    });

    test("accepts a token one millisecond before its deadline", () => {
      expect(
        TelegramVerificationToken.isExpired({
          token,
          now: new Date(issuedAt.getTime() + expiryMs - 1),
        }),
      ).toBe(false);
    });

    test("expires a token exactly at its deadline", () => {
      expect(
        TelegramVerificationToken.isExpired({
          token,
          now: new Date(issuedAt.getTime() + expiryMs),
        }),
      ).toBe(true);
    });

    test("rejects a token issued in the future", () => {
      expect(
        TelegramVerificationToken.isExpired({
          token,
          now: new Date(issuedAt.getTime() - 1),
        }),
      ).toBe(true);
    });

    test("treats a legacy six-digit code as expired", () => {
      expect(
        TelegramVerificationToken.isExpired({
          token: "123456",
          now: issuedAt,
        }),
      ).toBe(true);
    });
  });

  describe("rotation cooldown", () => {
    const token: string = TelegramVerificationToken.mint(issuedAt);

    test("requires the full cooldown immediately after issue", () => {
      expect(
        TelegramVerificationToken.getResendRetryAfterSeconds({
          token,
          now: issuedAt,
        }),
      ).toBe(RESEND_COOLDOWN_SECONDS);
    });

    test("rounds a partial remaining second up", () => {
      expect(
        TelegramVerificationToken.getResendRetryAfterSeconds({
          token,
          now: new Date(issuedAt.getTime() + 1_500),
        }),
      ).toBe(RESEND_COOLDOWN_SECONDS - 1);
    });

    test("allows rotation at the cooldown boundary", () => {
      expect(
        TelegramVerificationToken.getResendRetryAfterSeconds({
          token,
          now: new Date(issuedAt.getTime() + RESEND_COOLDOWN_SECONDS * 1000),
        }),
      ).toBe(0);
    });

    test("allows immediate replacement of legacy malformed values", () => {
      expect(
        TelegramVerificationToken.getResendRetryAfterSeconds({
          token: "123456",
          now: issuedAt,
        }),
      ).toBe(0);
    });
  });

  describe("one-time and rate-limit values", () => {
    test("hashes the live token before using it as a rate-limit key", () => {
      const token: string = TelegramVerificationToken.mint(issuedAt);
      const key: string = TelegramVerificationToken.getRateLimitKey(token);

      expect(key).toMatch(/^[0-9a-f]{64}$/);
      expect(key).not.toContain(token);
      expect(TelegramVerificationToken.getRateLimitKey(token)).toBe(key);
      expect(TelegramVerificationToken.getRateLimitKey(`${token}A`)).not.toBe(
        key,
      );
    });

    test("burned values can never pass live-token validation", () => {
      const first: string = TelegramVerificationToken.mintUnusableValue();
      const second: string = TelegramVerificationToken.mintUnusableValue();

      expect(first).toMatch(/^[0-9a-f]{64}$/);
      expect(second).not.toBe(first);
      expect(TelegramVerificationToken.isValidShape(first)).toBe(false);
    });
  });

  describe("webhook secret validation", () => {
    test.each([
      "oneuptime_telegram_secret_01234567",
      "ABCDEFGHIJKLMNOPQRSTUVWXYZ_12345",
      "abcdefghijklmnopqrstuvwxyz-12345",
    ])(
      "accepts strong Telegram-safe configured values %#",
      (secret: string) => {
        expect(TelegramVerificationToken.isWebhookSecretStrong(secret)).toBe(
          true,
        );
      },
    );

    test.each([
      undefined,
      "",
      "short-secret",
      "oneuptime.telegram.secret.01234567",
      "oneuptime telegram secret 01234567",
      "🔐oneuptime_telegram_secret_01234567",
      "a".repeat(101),
    ])(
      "rejects weak or unsupported configured values %#",
      (secret: unknown) => {
        expect(TelegramVerificationToken.isWebhookSecretStrong(secret)).toBe(
          false,
        );
      },
    );

    test("accepts an exact configured secret", () => {
      expect(
        TelegramVerificationToken.isWebhookSecretValid({
          configuredSecret: "a-strong-secret",
          providedSecret: "a-strong-secret",
        }),
      ).toBe(true);
    });

    test("normalizes administrator whitespace around the configured value", () => {
      expect(
        TelegramVerificationToken.isWebhookSecretValid({
          configuredSecret: "  a-strong-secret  ",
          providedSecret: "a-strong-secret",
        }),
      ).toBe(true);
    });

    test.each([
      { configuredSecret: undefined, providedSecret: "secret" },
      { configuredSecret: "", providedSecret: "secret" },
      { configuredSecret: "secret", providedSecret: undefined },
      { configuredSecret: "secret", providedSecret: "" },
      { configuredSecret: "secret", providedSecret: "Secret" },
      { configuredSecret: "secret", providedSecret: "secret " },
      { configuredSecret: "secret", providedSecret: "short" },
      { configuredSecret: "🔐secret", providedSecret: "🔐secrex" },
    ])(
      "rejects absent or mismatched values %#",
      (data: {
        configuredSecret: string | undefined;
        providedSecret: string | undefined;
      }) => {
        expect(TelegramVerificationToken.isWebhookSecretValid(data)).toBe(
          false,
        );
      },
    );
  });
});
