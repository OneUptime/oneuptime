import { isStatusCallbackTokenValid } from "../../FeatureSet/Notification/Utils/StatusCallbackToken";
import ObjectID from "Common/Types/ObjectID";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A PROVIDER'S STATUS CALLBACK CARRIES THE TOKEN ITS URL WAS GIVEN.
 *
 * Twilio's callbacks - an SMS's delivery status, a call's outcome (#6586) -
 * are public webhooks: Twilio signs in as nobody, so the unguessable token
 * each message's URL carries is all that says the request is Twilio's. The
 * SMS and the call routes compare it the one same way, in constant time.
 */

const NOTIFICATION_API: string = path.join(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Notification",
  "API",
);

describe("isStatusCallbackTokenValid", () => {
  const token: string = ObjectID.generate().toString();

  test("the token the URL was given is valid", () => {
    expect(isStatusCallbackTokenValid(token, token)).toBe(true);
    expect(isStatusCallbackTokenValid(`${token}`, String(token))).toBe(true);
  });

  test("another token of the same length is not", () => {
    expect(
      isStatusCallbackTokenValid(ObjectID.generate().toString(), token),
    ).toBe(false);
    expect(isStatusCallbackTokenValid(token.toUpperCase(), token)).toBe(
      token.toUpperCase() === token,
    );
  });

  test("a token of another length is not - and is refused without throwing", () => {
    expect(isStatusCallbackTokenValid(token.slice(1), token)).toBe(false);
    expect(isStatusCallbackTokenValid(`${token}0`, token)).toBe(false);
    expect(isStatusCallbackTokenValid("", token)).toBe(false);
  });

  test("text of the same length but other bytes - a letter of two bytes - is refused without throwing", () => {
    const sameLengthInLetters: string = "ü".repeat(token.length);
    const sameLengthInBytes: string = "ü".repeat(token.length / 2);

    expect(isStatusCallbackTokenValid(sameLengthInLetters, token)).toBe(false);
    expect(isStatusCallbackTokenValid(sameLengthInBytes, token)).toBe(false);
  });
});

describe("the SMS and the call routes compare it the one same way", () => {
  test.each(["SMS.ts", "Call.ts"])(
    "%s reads the shared check, and compares no token of its own",
    (file: string) => {
      const source: string = fs.readFileSync(
        path.join(NOTIFICATION_API, file),
        "utf8",
      );

      expect(source).toContain(
        'import { isStatusCallbackTokenValid } from "../Utils/StatusCallbackToken";',
      );
      expect(source).not.toContain("timingSafeEqual");
      expect(source).not.toMatch(/statusCallbackToken\s*[!=]==/);
    },
  );
});
