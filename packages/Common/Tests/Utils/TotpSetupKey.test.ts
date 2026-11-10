import { describe, expect, test } from "@jest/globals";
import * as OTPAuth from "otpauth";
import TotpAuth from "../../Server/Utils/TotpAuth";
import Email from "../../Types/Email";
import {
  getTotpSetupKey,
  getTotpSetupKeyGroups,
  TOTP_SETUP_KEY_GROUP_LENGTH,
} from "../../Utils/TotpSetupKey";
import { seededRandom, SeededRandom } from "../Helpers/SeededRandom";

/*
 * The setup key a person types into an authenticator app when they cannot
 * scan its QR code (issue #6638): read out of the otpauth:// URL the server
 * issues, and shown in groups of four.
 */

const SERVER_URL: string =
  "otpauth://totp/OneUptime:ada%40example.com?issuer=OneUptime&secret=MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ&algorithm=SHA1&digits=6&period=30";

describe("getTotpSetupKey", () => {
  test("reads the secret of the URL the server issues", () => {
    expect(getTotpSetupKey(SERVER_URL)).toBe(
      "MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ",
    );
  });

  test("reads the secret of every enrolment the server makes, whatever the secret and the address", () => {
    const random: SeededRandom = seededRandom(6638);

    for (let index: number = 0; index < 200; index++) {
      const secret: string = TotpAuth.generateSecret();
      const address: string = `person.${random(100000)}+tag@example${random(
        10,
      )}.com`;
      const url: string = TotpAuth.generateUri({
        secret: secret,
        userEmail: new Email(address),
      });

      expect(getTotpSetupKey(url)).toBe(secret);
    }
  });

  test("hands an authenticator app the secret the server checks codes against", () => {
    const secret: string = TotpAuth.generateSecret();
    const url: string = TotpAuth.generateUri({
      secret: secret,
      userEmail: new Email("ada@example.com"),
    });

    // What an app computes from the key typed in, the server accepts.
    const typedIn: OTPAuth.TOTP = new OTPAuth.TOTP({
      secret: OTPAuth.Secret.fromBase32(getTotpSetupKey(url)),
      algorithm: "SHA1",
      digits: 6,
      period: 30,
    });

    expect(
      TotpAuth.verifyToken({
        secret: secret,
        token: typedIn.generate(),
        email: new Email("ada@example.com"),
      }),
    ).toBe(true);
  });

  test("reads it wherever it is among the parameters", () => {
    expect(getTotpSetupKey("otpauth://totp/OneUptime?secret=ABCDEFGH")).toBe(
      "ABCDEFGH",
    );
    expect(
      getTotpSetupKey(
        "otpauth://totp/OneUptime?issuer=OneUptime&digits=6&secret=ABCDEFGH",
      ),
    ).toBe("ABCDEFGH");
  });

  test("writes it in capitals, as authenticator apps show keys", () => {
    expect(getTotpSetupKey("otpauth://totp/OneUptime?secret=abcd2345")).toBe(
      "ABCD2345",
    );
  });

  test("leaves off the padding authenticator apps do not want", () => {
    expect(getTotpSetupKey("otpauth://totp/OneUptime?secret=MZXW6===")).toBe(
      "MZXW6",
    );
    expect(
      getTotpSetupKey("otpauth://totp/OneUptime?secret=MZXW6%3D%3D%3D"),
    ).toBe("MZXW6");
  });

  test("stops at the fragment", () => {
    expect(
      getTotpSetupKey("otpauth://totp/OneUptime?secret=ABCDEFGH#ignored"),
    ).toBe("ABCDEFGH");
  });

  test("reads a URL with space around it, and a scheme in any case", () => {
    expect(getTotpSetupKey("  OTPAUTH://totp/OneUptime?secret=ABCDEFGH\n")).toBe(
      "ABCDEFGH",
    );
  });

  test("never takes a parameter that only ends in secret", () => {
    expect(
      getTotpSetupKey("otpauth://totp/OneUptime?client_secret=ABCDEFGH"),
    ).toBe("");
    expect(
      getTotpSetupKey(
        "otpauth://totp/OneUptime?client_secret=WRONGKEY&secret=ABCDEFGH",
      ),
    ).toBe("ABCDEFGH");
  });

  test.each([
    ["no URL at all", undefined],
    ["null", null],
    ["an empty URL", ""],
    ["a URL that is not otpauth://", "https://example.com/?secret=ABCDEFGH"],
    ["a URL with no parameters", "otpauth://totp/OneUptime"],
    ["a URL with no secret", "otpauth://totp/OneUptime?issuer=OneUptime"],
    ["an empty secret", "otpauth://totp/OneUptime?secret="],
    ["a secret with a separator", "otpauth://totp/OneUptime?secret=AB%26CD"],
    ["a secret with a space", "otpauth://totp/OneUptime?secret=AB%20CD"],
    ["a secret with a plus", "otpauth://totp/OneUptime?secret=AB+CD"],
    ["a secret with digits base32 has not", "otpauth://totp/x?secret=AB0189"],
    ["a secret with a broken escape", "otpauth://totp/x?secret=AB%2"],
    ["padding in the middle", "otpauth://totp/x?secret=AB==CD"],
    ["only padding", "otpauth://totp/x?secret====="],
  ])(
    "is empty for %s, so a page shows no key rather than one that cannot work",
    (_name: string, url: string | undefined | null) => {
      expect(getTotpSetupKey(url)).toBe("");
    },
  );
});

describe("getTotpSetupKeyGroups", () => {
  test("splits the key into groups of four, as it is shown", () => {
    expect(getTotpSetupKeyGroups("MTEA5EMEV46EOK5MXD7E3ES7YSRRR6LQ")).toEqual([
      "MTEA",
      "5EME",
      "V46E",
      "OK5M",
      "XD7E",
      "3ES7",
      "YSRR",
      "R6LQ",
    ]);
  });

  test("leaves a shorter last group", () => {
    expect(getTotpSetupKeyGroups("ABCDEFGHIJ")).toEqual(["ABCD", "EFGH", "IJ"]);
  });

  test("has nothing to show for no key", () => {
    expect(getTotpSetupKeyGroups("")).toEqual([]);
  });

  test("joined again, is the key: no character is lost or added", () => {
    const random: SeededRandom = seededRandom(64);

    for (let index: number = 0; index < 100; index++) {
      const key: string = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".slice(
        0,
        1 + random(32),
      );
      const groups: Array<string> = getTotpSetupKeyGroups(key);

      expect(groups.join("")).toBe(key);
      expect(
        groups.every((group: string): boolean => {
          return group.length <= TOTP_SETUP_KEY_GROUP_LENGTH && group !== "";
        }),
      ).toBe(true);
    }
  });
});
