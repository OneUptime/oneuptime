import StatusPageSubscriberUnsubscribeToken from "../../../../Server/Utils/StatusPage/StatusPageSubscriberUnsubscribeToken";
import StatusPageSubscriberUnsubscribe from "../../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import crypto from "crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The secret in a subscriber's unsubscribe link. Holding it is the whole
 * authorisation to unsubscribe - on a private status page too, without
 * signing in - so it has to be unguessable, and checking a guess must not
 * tell the guesser how close it was.
 */

const TOKEN: string =
  "3f9a1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e7f8";

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageSubscriberUnsubscribeToken.generate", () => {
  test("mints 32 random bytes from the CSPRNG, as 64 hex characters", () => {
    const randomBytes: jest.SpiedFunction<typeof crypto.randomBytes> =
      jest.spyOn(crypto, "randomBytes");

    const token: string = StatusPageSubscriberUnsubscribeToken.generate();

    expect(randomBytes).toHaveBeenCalledWith(32);
    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(StatusPageSubscriberUnsubscribe.isWellFormedToken(token)).toBe(true);
  });

  test("never repeats", () => {
    const tokens: Set<string> = new Set<string>();

    for (let i: number = 0; i < 2000; i++) {
      tokens.add(StatusPageSubscriberUnsubscribeToken.generate());
    }

    expect(tokens.size).toBe(2000);
  });

  test("is not the six-digit subscription confirmation code", () => {
    expect(StatusPageSubscriberUnsubscribeToken.generate()).not.toMatch(
      /^\d{6}$/,
    );
  });
});

describe("StatusPageSubscriberUnsubscribeToken.matches", () => {
  test("accepts the subscription's own token", () => {
    expect(
      StatusPageSubscriberUnsubscribeToken.matches({
        stored: TOKEN,
        presented: TOKEN,
      }),
    ).toBe(true);
  });

  test("accepts it in upper case, as a mail client may change it", () => {
    expect(
      StatusPageSubscriberUnsubscribeToken.matches({
        stored: TOKEN,
        presented: TOKEN.toUpperCase(),
      }),
    ).toBe(true);
  });

  test.each([
    ["a different token", `${TOKEN.slice(0, 63)}0`],
    ["the token with one character missing", TOKEN.slice(1)],
    ["the token with a character added", `${TOKEN}0`],
    ["nothing", ""],
    ["null", null],
    ["undefined", undefined],
  ])("refuses %s", (_label: string, presented: string | null | undefined) => {
    expect(
      StatusPageSubscriberUnsubscribeToken.matches({
        stored: TOKEN,
        presented: presented,
      }),
    ).toBe(false);
  });

  test.each([
    ["no stored token", null],
    ["an empty stored token", ""],
    ["a malformed stored token", "not-a-token"],
  ])(
    "refuses everything when the subscriber has %s",
    (_label: string, stored: string | null) => {
      expect(
        StatusPageSubscriberUnsubscribeToken.matches({
          stored: stored,
          presented: TOKEN,
        }),
      ).toBe(false);
      expect(
        StatusPageSubscriberUnsubscribeToken.matches({
          stored: stored,
          presented: stored,
        }),
      ).toBe(false);
    },
  );

  test("compares in constant time, on full-length buffers, whatever it is given", () => {
    const timingSafeEqual: jest.SpiedFunction<typeof crypto.timingSafeEqual> =
      jest.spyOn(crypto, "timingSafeEqual");

    const cases: Array<{
      stored: string | null;
      presented: string | null;
    }> = [
      // The right token.
      { stored: TOKEN, presented: TOKEN },
      // A wrong one.
      { stored: TOKEN, presented: `${TOKEN.slice(0, 63)}0` },
      // A short guess.
      { stored: TOKEN, presented: "abc" },
      // No subscriber to compare with at all.
      { stored: null, presented: TOKEN },
      { stored: null, presented: null },
    ];

    for (const testCase of cases) {
      StatusPageSubscriberUnsubscribeToken.matches(testCase);
    }

    /*
     * One constant-time comparison per check - including the ones that are
     * refused before the bytes could ever match - and never on buffers of
     * different lengths, which would throw.
     */
    expect(timingSafeEqual).toHaveBeenCalledTimes(cases.length);

    for (const call of timingSafeEqual.mock.calls) {
      const [a, b] = call as unknown as [Buffer, Buffer];

      expect(a.length).toBe(64);
      expect(b.length).toBe(64);
    }
  });

  test("does not use a plain string comparison on the token", () => {
    const source: string = StatusPageSubscriberUnsubscribeToken.matches
      .toString()
      .replace(/\s+/g, " ");

    expect(source).toContain("timingSafeEqual");
    expect(source).not.toMatch(
      /stored\s*===\s*presented|presented\s*===\s*stored/,
    );
  });
});
