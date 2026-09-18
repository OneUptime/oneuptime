import CalendarFeedToken, {
  CALENDAR_FEED_TOKEN_HINT_LENGTH,
  CALENDAR_FEED_TOKEN_LENGTH,
  CALENDAR_FEED_TOKEN_REGEX,
  CalendarFeedRotation,
  CalendarFeedRotationUpdateData,
  CalendarFeedTokenColumns,
  MintedCalendarFeedToken,
} from "../../../../Server/Utils/OnCall/CalendarFeedToken";
import { PREVIOUS_TOKEN_GRACE_DAYS } from "../../../../Types/OnCallDutyPolicy/CalendarFeedWindow";
import crypto from "crypto";
import { describe, expect, test } from "@jest/globals";

/*
 * The token is the only secret in the whole calendar-feed feature: it is the
 * feed URL. These tests pin its shape (what the public route's regex guard
 * accepts), its entropy (what makes guessing hopeless), its hash (what the
 * database indexes) and its hint (what the UI may show).
 */

const SAMPLE_COUNT: number = 200;

describe("CalendarFeedToken.mint", () => {
  test("mints a 43-character base64url token", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      const token: string = CalendarFeedToken.mint();

      expect(token).toHaveLength(CALENDAR_FEED_TOKEN_LENGTH);
      expect(token).toHaveLength(43);
      expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  test("never carries base64 padding or the standard-alphabet symbols", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      const token: string = CalendarFeedToken.mint();

      expect(token).not.toContain("=");
      expect(token).not.toContain("+");
      expect(token).not.toContain("/");
    }
  });

  test("decodes back to exactly 32 random bytes", () => {
    const token: string = CalendarFeedToken.mint();

    expect(Buffer.from(token, "base64url")).toHaveLength(32);
  });

  test("is unique across many mints", () => {
    const tokens: Set<string> = new Set<string>();

    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      tokens.add(CalendarFeedToken.mint());
    }

    expect(tokens.size).toBe(SAMPLE_COUNT);
  });

  test("uses both halves of the base64url alphabet (not hex)", () => {
    /*
     * A regression guard against somebody "simplifying" the mint to hex: hex
     * would still pass a length check if the byte count were adjusted, but
     * it would never contain an uppercase letter beyond F, nor '-' or '_'.
     */
    const joined: string = Array.from({ length: SAMPLE_COUNT }, () => {
      return CalendarFeedToken.mint();
    }).join("");

    expect(joined).toMatch(/[G-Zg-z]/);
    expect(joined).toMatch(/[-_]/);
  });
});

describe("CALENDAR_FEED_TOKEN_REGEX", () => {
  test("is the documented shape guard", () => {
    expect(CALENDAR_FEED_TOKEN_REGEX.source).toBe("^[A-Za-z0-9_-]{43}$");
    expect(CALENDAR_FEED_TOKEN_REGEX.flags).toBe("");
  });

  test("accepts every minted token", () => {
    for (let i: number = 0; i < SAMPLE_COUNT; i++) {
      expect(CALENDAR_FEED_TOKEN_REGEX.test(CalendarFeedToken.mint())).toBe(
        true,
      );
    }
  });

  test("rejects the wrong length, padding, and foreign characters", () => {
    const good: string = CalendarFeedToken.mint();

    expect(CALENDAR_FEED_TOKEN_REGEX.test(good.slice(0, 42))).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(good + "a")).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(good.slice(0, 42) + "=")).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(good.slice(0, 42) + "+")).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(good.slice(0, 42) + "/")).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(good.slice(0, 42) + " ")).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(good.slice(0, 42) + "\n")).toBe(
      false,
    );
    expect(CALENDAR_FEED_TOKEN_REGEX.test("")).toBe(false);
  });

  test("rejects a UUID and a 64-hex digest (other token shapes in the codebase)", () => {
    expect(
      CALENDAR_FEED_TOKEN_REGEX.test("11111111-1111-4111-8111-111111111111"),
    ).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test("a".repeat(64))).toBe(false);
  });

  test("is anchored: a valid token embedded in junk does not match", () => {
    const good: string = CalendarFeedToken.mint();

    expect(CALENDAR_FEED_TOKEN_REGEX.test(`x${good}`)).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(`${good}x`)).toBe(false);
    expect(CALENDAR_FEED_TOKEN_REGEX.test(`${good}\n${good}`)).toBe(false);
  });
});

describe("CalendarFeedToken.isValidShape", () => {
  test("agrees with the regex and refuses non-strings", () => {
    const good: string = CalendarFeedToken.mint();

    expect(CalendarFeedToken.isValidShape(good)).toBe(true);
    expect(CalendarFeedToken.isValidShape(good.slice(1))).toBe(false);
    expect(CalendarFeedToken.isValidShape(undefined)).toBe(false);
    expect(CalendarFeedToken.isValidShape(null)).toBe(false);
    expect(CalendarFeedToken.isValidShape(42)).toBe(false);
    expect(CalendarFeedToken.isValidShape([good])).toBe(false);
    expect(CalendarFeedToken.isValidShape({ token: good })).toBe(false);
  });
});

describe("CalendarFeedToken.hash", () => {
  test("is the unkeyed SHA-256 hex digest of the token", () => {
    const token: string = CalendarFeedToken.mint();

    expect(CalendarFeedToken.hash(token)).toBe(
      crypto.createHash("sha256").update(token, "utf8").digest("hex"),
    );
  });

  test("is 64 lowercase hex characters", () => {
    for (let i: number = 0; i < 20; i++) {
      expect(CalendarFeedToken.hash(CalendarFeedToken.mint())).toMatch(
        /^[0-9a-f]{64}$/,
      );
    }
  });

  test("matches a known SHA-256 test vector", () => {
    // sha256("abc") from FIPS 180-4.
    expect(CalendarFeedToken.hash("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
    // sha256("") — the empty message.
    expect(CalendarFeedToken.hash("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  test("is deterministic and differs between tokens", () => {
    const a: string = CalendarFeedToken.mint();
    const b: string = CalendarFeedToken.mint();

    expect(CalendarFeedToken.hash(a)).toBe(CalendarFeedToken.hash(a));
    expect(CalendarFeedToken.hash(a)).not.toBe(CalendarFeedToken.hash(b));
  });

  test("does not depend on any instance secret", () => {
    /*
     * The token is looked up by hash on the public route; if the hash were
     * keyed by ENCRYPTION_SECRET, rotating that secret would orphan every
     * subscribed calendar. Pin that the digest is a function of the token
     * alone by comparing with the plain library call under a changed env.
     */
    const token: string = CalendarFeedToken.mint();
    const before: string = CalendarFeedToken.hash(token);

    const previous: string | undefined = process.env["ENCRYPTION_SECRET"];
    process.env["ENCRYPTION_SECRET"] = "a-completely-different-secret";

    try {
      expect(CalendarFeedToken.hash(token)).toBe(before);
    } finally {
      if (previous === undefined) {
        delete process.env["ENCRYPTION_SECRET"];
      } else {
        process.env["ENCRYPTION_SECRET"] = previous;
      }
    }
  });

  test("fits the ShortText column it is stored in", () => {
    // ColumnLength.ShortText is 100; a hex SHA-256 is 64.
    expect(CalendarFeedToken.hash(CalendarFeedToken.mint()).length).toBe(64);
    expect(64).toBeLessThanOrEqual(100);
  });
});

describe("CalendarFeedToken.hint", () => {
  test("is the last four characters of the token", () => {
    const token: string = CalendarFeedToken.mint();

    expect(CalendarFeedToken.hint(token)).toBe(token.slice(-4));
    expect(CalendarFeedToken.hint(token)).toHaveLength(
      CALENDAR_FEED_TOKEN_HINT_LENGTH,
    );
    expect(token.endsWith(CalendarFeedToken.hint(token))).toBe(true);
  });

  test("reveals nothing but the tail", () => {
    const token: string = CalendarFeedToken.mint();
    const hint: string = CalendarFeedToken.hint(token);

    // 43 - 4 = 39 characters remain unknown from the hint alone.
    expect(token.length - hint.length).toBe(39);
    expect(token.startsWith(hint)).toBe(false);
  });

  test("copes with short inputs without throwing", () => {
    expect(CalendarFeedToken.hint("ab")).toBe("ab");
    expect(CalendarFeedToken.hint("")).toBe("");
  });
});

describe("CalendarFeedToken.mintSet", () => {
  test("returns a consistent token/hash/hint triple", () => {
    const set: MintedCalendarFeedToken = CalendarFeedToken.mintSet();

    expect(CalendarFeedToken.isValidShape(set.token)).toBe(true);
    expect(set.tokenHash).toBe(CalendarFeedToken.hash(set.token));
    expect(set.tokenHint).toBe(CalendarFeedToken.hint(set.token));
    expect(Object.keys(set).sort()).toEqual([
      "token",
      "tokenHash",
      "tokenHint",
    ]);
  });

  test("mints a different token every call", () => {
    const a: MintedCalendarFeedToken = CalendarFeedToken.mintSet();
    const b: MintedCalendarFeedToken = CalendarFeedToken.mintSet();

    expect(a.token).not.toBe(b.token);
    expect(a.tokenHash).not.toBe(b.tokenHash);
  });
});

describe("CalendarFeedToken.isHashEqual", () => {
  test("is true for equal digests and false otherwise", () => {
    const token: string = CalendarFeedToken.mint();
    const digest: string = CalendarFeedToken.hash(token);

    expect(CalendarFeedToken.isHashEqual(digest, digest)).toBe(true);
    expect(
      CalendarFeedToken.isHashEqual(
        digest,
        CalendarFeedToken.hash(CalendarFeedToken.mint()),
      ),
    ).toBe(false);
  });

  test("answers false on a length mismatch instead of throwing", () => {
    const digest: string = CalendarFeedToken.hash(CalendarFeedToken.mint());

    expect(CalendarFeedToken.isHashEqual(digest, digest.slice(0, 63))).toBe(
      false,
    );
    expect(CalendarFeedToken.isHashEqual("", digest)).toBe(false);
    expect(CalendarFeedToken.isHashEqual("", "")).toBe(true);
  });
});

describe("CalendarFeedToken.applyTokenColumnsOnCreate", () => {
  function expectConsistent(data: CalendarFeedTokenColumns): void {
    expect(CalendarFeedToken.isValidShape(data.token)).toBe(true);
    expect(data.tokenHash).toBe(CalendarFeedToken.hash(data.token as string));
    expect(data.tokenHint).toBe(CalendarFeedToken.hint(data.token as string));
    expect(data.rotatedAt).toBeInstanceOf(Date);
    expect(data.previousTokenHash).toBeUndefined();
    expect(data.previousTokenExpiresAt).toBeUndefined();
  }

  test("mints a consistent set onto an empty row", () => {
    const data: CalendarFeedTokenColumns = {};
    const minted: MintedCalendarFeedToken =
      CalendarFeedToken.applyTokenColumnsOnCreate(data, {
        trustSuppliedToken: true,
      });

    expectConsistent(data);
    expect(minted).toEqual({
      token: data.token,
      tokenHash: data.tokenHash,
      tokenHint: data.tokenHint,
    });
  });

  test("keeps a trusted, well-formed token and derives hash and hint from it", () => {
    const token: string = CalendarFeedToken.mint();
    const data: CalendarFeedTokenColumns = {
      token,
      tokenHash: "chosen",
      tokenHint: "zzzz",
    };

    CalendarFeedToken.applyTokenColumnsOnCreate(data, {
      trustSuppliedToken: true,
    });

    expect(data.token).toBe(token);
    expect(data.tokenHash).toBe(CalendarFeedToken.hash(token));
    expect(data.tokenHint).toBe(CalendarFeedToken.hint(token));
  });

  test("discards a supplied token when it is not trusted", () => {
    const token: string = CalendarFeedToken.mint();
    const data: CalendarFeedTokenColumns = {
      token,
      tokenHash: CalendarFeedToken.hash(token),
    };

    CalendarFeedToken.applyTokenColumnsOnCreate(data, {
      trustSuppliedToken: false,
    });

    expect(data.token).not.toBe(token);
    expect(data.tokenHash).not.toBe(CalendarFeedToken.hash(token));
    expectConsistent(data);
  });

  test("replaces a malformed token even when trusted", () => {
    const data: CalendarFeedTokenColumns = { token: "nope" };

    CalendarFeedToken.applyTokenColumnsOnCreate(data, {
      trustSuppliedToken: true,
    });

    expect(data.token).not.toBe("nope");
    expectConsistent(data);
  });

  test("never trusts a bare hash without its token", () => {
    const data: CalendarFeedTokenColumns = { tokenHash: "chosen-hash" };

    CalendarFeedToken.applyTokenColumnsOnCreate(data, {
      trustSuppliedToken: true,
    });

    expect(data.tokenHash).not.toBe("chosen-hash");
    expectConsistent(data);
  });

  test("clears any grace-period columns the caller set and stamps rotatedAt now", () => {
    const before: number = Date.now();
    const data: CalendarFeedTokenColumns = {
      previousTokenHash: "stale",
      previousTokenExpiresAt: new Date(0),
      rotatedAt: new Date(0),
    };

    CalendarFeedToken.applyTokenColumnsOnCreate(data, {
      trustSuppliedToken: false,
    });

    expect(data.previousTokenHash).toBeUndefined();
    expect(data.previousTokenExpiresAt).toBeUndefined();
    expect(data.rotatedAt!.getTime()).toBeGreaterThanOrEqual(before);
    expect(data.rotatedAt!.getTime()).toBeLessThanOrEqual(Date.now());
  });
});

describe("CalendarFeedToken.buildRotation", () => {
  test("mints a new consistent token and parks the old hash for the grace period", () => {
    const now: Date = new Date("2026-09-01T12:00:00.000Z");
    const rotation: CalendarFeedRotation = CalendarFeedToken.buildRotation({
      currentTokenHash: "old-hash",
      now,
    });

    expect(CalendarFeedToken.isValidShape(rotation.token)).toBe(true);
    expect(rotation.tokenHash).toBe(CalendarFeedToken.hash(rotation.token));
    expect(rotation.tokenHint).toBe(CalendarFeedToken.hint(rotation.token));
    expect(rotation.tokenHash).not.toBe("old-hash");
    expect(rotation.rotatedAt).toBe(now);
    expect(rotation.previousTokenHash).toBe("old-hash");

    const graceMs: number = PREVIOUS_TOKEN_GRACE_DAYS * 24 * 60 * 60 * 1000;
    const expiresAt: number = rotation.previousTokenExpiresAt!.getTime();
    // moment.add(days) is DST-aware; allow an hour either side.
    expect(Math.abs(expiresAt - (now.getTime() + graceMs))).toBeLessThanOrEqual(
      60 * 60 * 1000,
    );
    expect(PREVIOUS_TOKEN_GRACE_DAYS).toBe(30);
  });

  test("a first mint (no current hash) parks nothing", () => {
    for (const current of [undefined, null, ""]) {
      const rotation: CalendarFeedRotation = CalendarFeedToken.buildRotation({
        currentTokenHash: current,
      });

      expect(rotation.previousTokenHash).toBeNull();
      expect(rotation.previousTokenExpiresAt).toBeNull();
      expect(rotation.rotatedAt).toBeInstanceOf(Date);
    }
  });

  test("defaults `now` to the current time", () => {
    const before: number = Date.now();
    const rotation: CalendarFeedRotation = CalendarFeedToken.buildRotation({
      currentTokenHash: "old-hash",
    });

    expect(rotation.rotatedAt.getTime()).toBeGreaterThanOrEqual(before);
    expect(rotation.rotatedAt.getTime()).toBeLessThanOrEqual(Date.now());
  });

  test("two rotations never share a token", () => {
    const a: CalendarFeedRotation = CalendarFeedToken.buildRotation({
      currentTokenHash: "x",
    });
    const b: CalendarFeedRotation = CalendarFeedToken.buildRotation({
      currentTokenHash: "x",
    });

    expect(a.token).not.toBe(b.token);
  });
});

describe("CalendarFeedToken.toRotationUpdateData", () => {
  test("carries exactly the six token columns, nulls included", () => {
    const rotation: CalendarFeedRotation = CalendarFeedToken.buildRotation({
      currentTokenHash: "old-hash",
      now: new Date("2026-09-01T12:00:00.000Z"),
    });

    const data: CalendarFeedRotationUpdateData =
      CalendarFeedToken.toRotationUpdateData(rotation);

    expect(Object.keys(data).sort()).toEqual(
      [
        "token",
        "tokenHash",
        "tokenHint",
        "rotatedAt",
        "previousTokenHash",
        "previousTokenExpiresAt",
      ].sort(),
    );
    expect(data.token).toBe(rotation.token);
    expect(data.tokenHash).toBe(rotation.tokenHash);
    expect(data.tokenHint).toBe(rotation.tokenHint);
    expect(data.rotatedAt).toBe(rotation.rotatedAt);
    expect(data.previousTokenHash).toBe("old-hash");
    expect(data.previousTokenExpiresAt).toBe(rotation.previousTokenExpiresAt);

    const first: CalendarFeedRotationUpdateData =
      CalendarFeedToken.toRotationUpdateData(
        CalendarFeedToken.buildRotation({ currentTokenHash: null }),
      );

    expect(first.previousTokenHash).toBeNull();
    expect(first.previousTokenExpiresAt).toBeNull();
  });
});
