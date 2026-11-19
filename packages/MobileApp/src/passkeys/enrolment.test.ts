import * as Crypto from "expo-crypto";
import {
  canPhoneMakePasskeys,
  createPasskeyEnrolmentRequest,
  isPasskeyEnrolmentAvailable,
  isPasskeyEnrolmentCallbackFor,
  MINIMUM_ANDROID_API_FOR_PASSKEYS,
  MINIMUM_IOS_MAJOR_FOR_PASSKEYS,
  PASSKEY_ENROLMENT_CALLBACK_URL,
  parsePasskeyEnrolmentCallback,
  PasskeyEnrolmentCallback,
  PasskeyEnrolmentRequest,
} from "./enrolment";
import { describe, expect, test } from "@jest/globals";

/*
 * SETTING UP A PASSKEY FROM THE APP, IN THE PHONE'S BROWSER (#9817).
 *
 * What is offered where, the page the app opens, and - above all - which
 * answer from that page the app believes: only this attempt's, on this app's
 * scheme and host, from the server it started on, shaped like a new
 * passkey's. The answer is no credential (the password the app holds is what
 * saves it), but a forged or stale one must never reach the server.
 */

jest.mock("expo-crypto", () => {
  return { getRandomBytesAsync: jest.fn() };
});

const SERVER_ORIGIN: string = "https://oneuptime.example.com";
const HAND_OFF_ID: string = "H".repeat(43);
const STATE: string = "a".repeat(64);

const REQUEST: PasskeyEnrolmentRequest = {
  serverOrigin: SERVER_ORIGIN,
  state: STATE,
  url: `${SERVER_ORIGIN}/accounts/mobile-passkey-enrolment#handOff=${HAND_OFF_ID}&state=${STATE}`,
};

const CREDENTIAL: Record<string, unknown> = {
  id: "Y3JlZGVudGlhbC1pZA",
  rawId: "Y3JlZGVudGlhbC1pZA",
  type: "public-key",
  authenticatorAttachment: "platform",
  clientExtensionResults: { credProps: { rk: true } },
  response: {
    attestationObject: "o2NmbXRkbm9uZWdhdHRTdG10oGhhdXRoRGF0YQ",
    clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
    transports: ["internal", "hybrid"],
  },
};

// base64url of a JSON value, as the page writes it.
function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/[=]+$/g, "");
}

function callback(params: Record<string, string>): string {
  const query: string = Object.entries(params)
    .map(([key, value]: [string, string]): string => {
      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .join("&");
  return `${PASSKEY_ENROLMENT_CALLBACK_URL}?${query}`;
}

const success: (credential?: unknown) => string = (
  credential: unknown = CREDENTIAL,
): string => {
  return callback({
    state: STATE,
    serverOrigin: SERVER_ORIGIN,
    credential: encode(credential),
  });
};

describe("which phones make passkeys in their own browser", () => {
  test.each([
    ["ios", "16.0", true],
    ["ios", "17.4.1", true],
    ["ios", "15.8", false],
    ["ios", "", false],
    ["android", 28, true],
    ["android", 34, true],
    ["android", 27, false],
    ["android", "not a number", false],
    ["web", 100, false],
    ["windows", 10, false],
  ])("%s %s: %s", (os: string, version: string | number, expected: boolean) => {
    expect(canPhoneMakePasskeys({ os, version })).toBe(expected);
  });

  test("the minimums are iOS 16 and Android 9", () => {
    expect(MINIMUM_IOS_MAJOR_FOR_PASSKEYS).toBe(16);
    expect(MINIMUM_ANDROID_API_FOR_PASSKEYS).toBe(28);
  });
});

describe("when the app offers a passkey beside the authenticator app", () => {
  const phone: { os: string; version: number } = { os: "android", version: 34 };

  test("when the server offers it, over HTTPS, on a phone that can", () => {
    expect(
      isPasskeyEnrolmentAvailable({
        isOfferedByServer: true,
        serverUrl: SERVER_ORIGIN,
        platform: phone,
      }),
    ).toBe(true);
  });

  test("never when the server does not say it does: an older server", () => {
    expect(
      isPasskeyEnrolmentAvailable({
        isOfferedByServer: false,
        serverUrl: SERVER_ORIGIN,
        platform: phone,
      }),
    ).toBe(false);
  });

  test("never over plain HTTP: no browser makes a passkey on an insecure page", () => {
    expect(
      isPasskeyEnrolmentAvailable({
        isOfferedByServer: true,
        serverUrl: "http://oneuptime.internal",
        platform: phone,
      }),
    ).toBe(false);
  });

  test("never on a phone whose browser makes no passkeys", () => {
    expect(
      isPasskeyEnrolmentAvailable({
        isOfferedByServer: true,
        serverUrl: SERVER_ORIGIN,
        platform: { os: "ios", version: "15.7" },
      }),
    ).toBe(false);
  });

  test("never for a server address that is not a plain origin", () => {
    expect(
      isPasskeyEnrolmentAvailable({
        isOfferedByServer: true,
        serverUrl: "https://user:pass@oneuptime.example.com",
        platform: phone,
      }),
    ).toBe(false);
  });
});

describe("the page the app opens", () => {
  test("is on the server's own address, the hand-off and a fresh state in its fragment", async () => {
    jest
      .mocked(Crypto.getRandomBytesAsync)
      .mockResolvedValue(new Uint8Array(32).fill(0xab) as never);

    const request: PasskeyEnrolmentRequest =
      await createPasskeyEnrolmentRequest(`${SERVER_ORIGIN}/`, HAND_OFF_ID);

    expect(request.serverOrigin).toBe(SERVER_ORIGIN);
    expect(request.state).toBe("ab".repeat(32));
    expect(request.url).toBe(
      `${SERVER_ORIGIN}/accounts/mobile-passkey-enrolment#handOff=${HAND_OFF_ID}&state=${"ab".repeat(32)}`,
    );
    // Nothing in a query string: no server is ever sent the hand-off.
    expect(request.url).not.toContain("?");
  });

  test("refuses a server reached over plain HTTP", async () => {
    await expect(
      createPasskeyEnrolmentRequest("http://oneuptime.internal", HAND_OFF_ID),
    ).rejects.toThrow("HTTPS");
  });

  test("refuses a hand-off that is not one the server makes", async () => {
    for (const handOffId of [
      "",
      "short",
      `${"H".repeat(42)}#`,
      `${HAND_OFF_ID}&state=forged`,
      "H".repeat(44),
    ]) {
      await expect(
        createPasskeyEnrolmentRequest(SERVER_ORIGIN, handOffId),
      ).rejects.toThrow("The server did not start the passkey setup.");
    }
  });
});

describe("the page's answer", () => {
  test("a new passkey's answer is read back exactly", () => {
    expect(parsePasskeyEnrolmentCallback(success(), REQUEST)).toEqual({
      status: "success",
      credential: CREDENTIAL,
    });
  });

  test("a trailing slash after the host is the same callback", () => {
    const url: string = success().replace(
      "oneuptime://passkey-enrolment?",
      "oneuptime://passkey-enrolment/?",
    );

    expect(parsePasskeyEnrolmentCallback(url, REQUEST).status).toBe("success");
  });

  test("Cancel in the browser is a cancel", () => {
    expect(
      parsePasskeyEnrolmentCallback(
        callback({
          error: "access_denied",
          state: STATE,
          serverOrigin: SERVER_ORIGIN,
        }),
        REQUEST,
      ),
    ).toEqual({ status: "cancelled" });
  });

  test("a browser that makes no passkeys says so", () => {
    expect(
      parsePasskeyEnrolmentCallback(
        callback({
          error: "unsupported",
          state: STATE,
          serverOrigin: SERVER_ORIGIN,
        }),
        REQUEST,
      ),
    ).toEqual({ status: "unsupported" });
  });

  const refused: Array<[string, string]> = [
    [
      "another attempt's state",
      callback({
        state: "b".repeat(64),
        serverOrigin: SERVER_ORIGIN,
        credential: encode(CREDENTIAL),
      }),
    ],
    [
      "another server",
      callback({
        state: STATE,
        serverOrigin: "https://evil.example.com",
        credential: encode(CREDENTIAL),
      }),
    ],
    [
      "no state",
      callback({
        serverOrigin: SERVER_ORIGIN,
        credential: encode(CREDENTIAL),
      }),
    ],
    ["a key it does not know", `${success()}&code=${"c".repeat(43)}`],
    ["a key twice", `${success()}&state=${STATE}`],
    ["an error beside a passkey", `${success()}&error=access_denied`],
    [
      "an error it does not know",
      callback({
        error: "server_error",
        state: STATE,
        serverOrigin: SERVER_ORIGIN,
      }),
    ],
    [
      "the sign-in callback's host",
      success().replace("passkey-enrolment", "passkey"),
    ],
    ["SSO's callback", success().replace("passkey-enrolment", "sso-callback")],
    ["another scheme", success().replace("oneuptime://", "evil://")],
    ["a fragment", `${success()}#more`],
    ["surrounding space", ` ${success()}`],
    ["no query at all", PASSKEY_ENROLMENT_CALLBACK_URL],
    [
      "a credential that is not base64url",
      callback({
        state: STATE,
        serverOrigin: SERVER_ORIGIN,
        credential: "not*base64",
      }),
    ],
    [
      "a credential that is not JSON",
      callback({
        state: STATE,
        serverOrigin: SERVER_ORIGIN,
        credential: Buffer.from("not json").toString("base64url"),
      }),
    ],
    ["a credential that is a list", success(["a"])],
    [
      "a credential of another type",
      success({ ...CREDENTIAL, type: "password" }),
    ],
    [
      "a credential whose rawId is not its id",
      success({ ...CREDENTIAL, rawId: "other" }),
    ],
    [
      "a credential with no attestation",
      success({
        ...CREDENTIAL,
        response: { clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0" },
      }),
    ],
    [
      "a credential with markup in its parts",
      success({
        ...CREDENTIAL,
        response: {
          attestationObject: "<script>",
          clientDataJSON: "eyJ0eXBlIjoid2ViYXV0aG4uY3JlYXRlIn0",
        },
      }),
    ],
    [
      "an answer far larger than any passkey's",
      callback({
        state: STATE,
        serverOrigin: SERVER_ORIGIN,
        credential: "A".repeat(20000),
      }),
    ],
  ];

  test.each(refused)("refuses %s", (_name: string, url: string) => {
    expect(() => {
      return parsePasskeyEnrolmentCallback(url, REQUEST);
    }).toThrow("This passkey setup could not be verified. Please try again.");
    expect(isPasskeyEnrolmentCallbackFor(url, REQUEST)).toBe(false);
  });

  test("isPasskeyEnrolmentCallbackFor answers yes for this attempt's answers and never throws", () => {
    const answers: Array<string> = [
      success(),
      callback({
        error: "access_denied",
        state: STATE,
        serverOrigin: SERVER_ORIGIN,
      }),
      callback({
        error: "unsupported",
        state: STATE,
        serverOrigin: SERVER_ORIGIN,
      }),
    ];

    for (const url of answers) {
      expect(isPasskeyEnrolmentCallbackFor(url, REQUEST)).toBe(true);
    }

    expect(isPasskeyEnrolmentCallbackFor("%%%", REQUEST)).toBe(false);
  });

  test("the answer it reads back is exactly the page's, nothing added", () => {
    const parsed: PasskeyEnrolmentCallback = parsePasskeyEnrolmentCallback(
      success(),
      REQUEST,
    );

    expect(parsed.status === "success" && parsed.credential).toEqual(
      CREDENTIAL,
    );
  });
});
