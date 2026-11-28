import FormFollowUpToken from "../../../../Server/Utils/Form/FormFollowUpToken";
import { isWellFormedFormFollowUpToken } from "../../../../Types/Form/FormFollowUp";
import { getJestSpyOn } from "../../../Spy";
import { describe, expect, test } from "@jest/globals";
import crypto from "crypto";

/*
 * The secret half of a follow-up link: minted from the CSPRNG, and compared
 * in constant time, the same way whatever is wrong with what was presented.
 */
describe("FormFollowUpToken", () => {
  test("mints 64 lowercase hex characters, a well-formed token", () => {
    const token: string = FormFollowUpToken.generate();

    expect(token).toMatch(/^[0-9a-f]{64}$/);
    expect(isWellFormedFormFollowUpToken(token)).toBe(true);
  });

  test("never mints the same token twice", () => {
    const tokens: Set<string> = new Set<string>();

    for (let i: number = 0; i < 200; i++) {
      tokens.add(FormFollowUpToken.generate());
    }

    expect(tokens.size).toBe(200);
  });

  test("matches the token it was given, whatever the case it is presented in", () => {
    const token: string = FormFollowUpToken.generate();

    expect(FormFollowUpToken.matches({ stored: token, presented: token })).toBe(
      true,
    );
    expect(
      FormFollowUpToken.matches({
        stored: token,
        presented: token.toUpperCase(),
      }),
    ).toBe(true);
  });

  test.each([
    ["another token", FormFollowUpToken.generate()],
    ["nothing", undefined],
    ["null", null],
    ["an empty text", ""],
    ["a token cut short", "ab"],
    ["the placeholder a refusal compares with", "0".repeat(64)],
  ])(
    "does not match %s",
    (_name: string, presented: string | null | undefined) => {
      expect(
        FormFollowUpToken.matches({
          stored: "1".repeat(64),
          presented: presented,
        }),
      ).toBe(false);
    },
  );

  test("matches nothing when there is no stored token, or one that is malformed", () => {
    const presented: string = FormFollowUpToken.generate();

    expect(
      FormFollowUpToken.matches({ stored: undefined, presented: presented }),
    ).toBe(false);
    expect(FormFollowUpToken.matches({ stored: null, presented: presented })).toBe(
      false,
    );
    expect(
      FormFollowUpToken.matches({ stored: "not-a-token", presented: "0".repeat(64) }),
    ).toBe(false);
  });

  test("compares in constant time, whatever is wrong with the presented token", () => {
    const spy: jest.SpyInstance<any, any> = getJestSpyOn(
      crypto,
      "timingSafeEqual",
    );

    try {
      FormFollowUpToken.matches({ stored: "1".repeat(64), presented: "x" });
      FormFollowUpToken.matches({ stored: undefined, presented: undefined });
      FormFollowUpToken.matches({
        stored: "1".repeat(64),
        presented: "1".repeat(64),
      });

      expect(spy).toHaveBeenCalledTimes(3);

      for (const call of spy.mock.calls) {
        expect((call[0] as Buffer).length).toBe(64);
        expect((call[1] as Buffer).length).toBe(64);
      }
    } finally {
      spy.mockRestore();
    }
  });
});
