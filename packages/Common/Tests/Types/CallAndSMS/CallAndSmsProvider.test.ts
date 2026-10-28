import CallAndSmsProviders, {
  CALL_AND_SMS_GATEWAY_URL_TITLE,
  CALL_AND_SMS_PROVIDERS,
  CALL_AND_SMS_PROVIDER_TITLE,
  CallAndSmsGateway,
  CallAndSmsProvider,
  DEFAULT_CALL_AND_SMS_PROVIDER,
} from "../../../Types/CallAndSMS/CallAndSmsProvider";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
} from "../../../Utils/RefusedValue";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT CARRIES THE SERVER'S SMS AND CALLS: TWILIO, OR THE INSTALLATION'S OWN
 * GATEWAY.
 *
 * Every installation sent through Twilio before the choice, so a server
 * that says nothing - and a row edited by hand to hold something that is
 * not a provider - keeps sending through Twilio. A server set to its own
 * gateway sends through it only once there is a URL to post to. These pin
 * the rule the server's write checks, the senders, the readiness checks and
 * the Admin Dashboard's card all read.
 */

const CHOICES: string = `${CALL_AND_SMS_PROVIDER_TITLE} must be "Twilio" or "Gateway"`;

// Values that are not a provider, of every kind a row or a request can hold.
const NOT_A_PROVIDER: Array<unknown> = [
  "twilio",
  "gateway",
  "TWILIO",
  "GATEWAY",
  " Twilio",
  "Gateway ",
  "Twilio\n",
  "SMS",
  "Calls",
  "",
  "__proto__",
  "constructor",
  "toString",
  0,
  1,
  true,
  false,
  {},
  [],
  ["Gateway"],
  { value: "Gateway" },
  NaN,
];

describe("the providers", () => {
  test("are Twilio and the installation's own gateway, in the order the form offers them", () => {
    expect([...CALL_AND_SMS_PROVIDERS]).toEqual([
      CallAndSmsProvider.Twilio,
      CallAndSmsProvider.Gateway,
    ]);
    // Stored, and sent over the API, as these words.
    expect([...CALL_AND_SMS_PROVIDERS]).toEqual(["Twilio", "Gateway"]);
    expect(Object.values(CallAndSmsProvider).sort()).toEqual(
      ["Gateway", "Twilio"].sort(),
    );
  });

  test("a server that says nothing sends through Twilio, as every installation did", () => {
    expect(DEFAULT_CALL_AND_SMS_PROVIDER).toBe(CallAndSmsProvider.Twilio);
  });

  test("the column titles the form and the API reference name", () => {
    expect(CALL_AND_SMS_PROVIDER_TITLE).toBe("Send SMS and Calls Through");
    expect(CALL_AND_SMS_GATEWAY_URL_TITLE).toBe("Gateway URL");
  });
});

describe("isProvider", () => {
  test.each(["Twilio", "Gateway"])("takes %s", (value: string) => {
    expect(CallAndSmsProviders.isProvider(value)).toBe(true);
  });

  test.each(
    NOT_A_PROVIDER.map((value: unknown) => {
      return [value];
    }),
  )("refuses %p", (value: unknown) => {
    expect(CallAndSmsProviders.isProvider(value)).toBe(false);
  });

  test("refuses nothing at all", () => {
    expect(CallAndSmsProviders.isProvider(undefined)).toBe(false);
    expect(CallAndSmsProviders.isProvider(null)).toBe(false);
  });

  test("refuses a String object, which is not text", () => {
    const boxed: unknown = Object("Gateway");

    expect(typeof boxed).toBe("object");
    expect(CallAndSmsProviders.isProvider(boxed)).toBe(false);
  });
});

describe("getProvider and isGateway", () => {
  test("each provider reads as itself", () => {
    expect(CallAndSmsProviders.getProvider("Twilio")).toBe(
      CallAndSmsProvider.Twilio,
    );
    expect(CallAndSmsProviders.getProvider("Gateway")).toBe(
      CallAndSmsProvider.Gateway,
    );
    expect(CallAndSmsProviders.isGateway("Gateway")).toBe(true);
    expect(CallAndSmsProviders.isGateway("Twilio")).toBe(false);
  });

  test("unset - every installation before the choice - is Twilio", () => {
    for (const unset of [undefined, null]) {
      expect(CallAndSmsProviders.getProvider(unset)).toBe(
        CallAndSmsProvider.Twilio,
      );
      expect(CallAndSmsProviders.isGateway(unset)).toBe(false);
    }
  });

  test("a value that is not a provider is Twilio, so a row edited by hand keeps sending as before", () => {
    for (const value of NOT_A_PROVIDER) {
      expect({
        value: value,
        provider: CallAndSmsProviders.getProvider(value),
        isGateway: CallAndSmsProviders.isGateway(value),
      }).toEqual({
        value: value,
        provider: CallAndSmsProvider.Twilio,
        isGateway: false,
      });
    }
  });

  test("only the exact word Gateway is the gateway, however it is spelt otherwise", () => {
    const random: SeededRandom = seededRandom(5150);
    const letters: Array<string> = [
      "G",
      "g",
      "a",
      "A",
      "t",
      "e",
      "w",
      "y",
      " ",
    ];

    for (let index: number = 0; index < 2000; index++) {
      let value: string = "";
      const length: number = 1 + random(9);

      for (let position: number = 0; position < length; position++) {
        value += letters[random(letters.length)];
      }

      expect({
        value,
        isGateway: CallAndSmsProviders.isGateway(value),
      }).toEqual({ value, isGateway: value === "Gateway" });
    }
  });
});

describe("getProviderError", () => {
  test("nothing given is no error: the column keeps, or starts with, what it holds", () => {
    expect(CallAndSmsProviders.getProviderError(undefined)).toBeNull();
    expect(CallAndSmsProviders.getProviderError(null)).toBeNull();
  });

  test.each(["Twilio", "Gateway"])("%s is no error", (value: string) => {
    expect(CallAndSmsProviders.getProviderError(value)).toBeNull();
  });

  test("a text that is not a provider is refused, repeating it", () => {
    expect(CallAndSmsProviders.getProviderError("twilio")).toBe(
      `${CHOICES}, not "twilio".`,
    );
    expect(CallAndSmsProviders.getProviderError("")).toBe(
      `${CHOICES}, not "".`,
    );
    expect(CallAndSmsProviders.getProviderError("Gateway ")).toBe(
      `${CHOICES}, not "Gateway ".`,
    );
  });

  test("the refusal names both providers, as the API takes them", () => {
    expect(CallAndSmsProviders.getProviderError("SMS")).toBe(
      'Send SMS and Calls Through must be "Twilio" or "Gateway", not "SMS".',
    );
  });

  test("a long text is repeated only as far as a refusal repeats one", () => {
    const value: string = "x".repeat(MAX_REFUSED_VALUE_LENGTH * 50);
    const error: string = CallAndSmsProviders.getProviderError(value) || "";

    expect(error).toBe(
      `${CHOICES}, not "${"x".repeat(MAX_REFUSED_VALUE_LENGTH)}${REFUSED_VALUE_CUT_MARK}".`,
    );
    expect(error.length).toBeLessThan(CHOICES.length + 100);
  });

  test("anything that is not text is refused without being repeated", () => {
    for (const value of [0, 1, true, false, {}, [], ["Gateway"], NaN]) {
      expect({
        value,
        error: CallAndSmsProviders.getProviderError(value),
      }).toEqual({ value, error: `${CHOICES}.` });
    }
  });

  test("every value is refused exactly when it is given and is not a provider", () => {
    const random: SeededRandom = seededRandom(8086);
    const pieces: Array<string> = ["Twilio", "Gateway", "twilio", " ", "x", ""];

    for (let index: number = 0; index < 1000; index++) {
      const value: string =
        (pieces[random(pieces.length)] as string) +
        (random(3) === 0 ? (pieces[random(pieces.length)] as string) : "");

      const error: string | null = CallAndSmsProviders.getProviderError(value);

      if (value === "Twilio" || value === "Gateway") {
        expect({ value, error }).toEqual({ value, error: null });
      } else {
        expect({ value, error }).toEqual({
          value,
          error: `${CHOICES}, not "${value}".`,
        });
      }
    }
  });
});

describe("getGateway", () => {
  const URL_TEXT: string = "https://sms-gateway.internal.example.com/oneuptime";
  const SECRET: string = "f".repeat(64);

  test("the gateway, once the server is set to it and has a URL", () => {
    expect(
      CallAndSmsProviders.getGateway({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: URL_TEXT,
        callAndSmsGatewaySecret: SECRET,
      }),
    ).toEqual({ url: URL_TEXT, secret: SECRET });
  });

  test("none for a server that sends through Twilio, whatever URL and secret it still holds", () => {
    for (const provider of ["Twilio", undefined, null, "gateway", 1]) {
      expect(
        CallAndSmsProviders.getGateway({
          callAndSmsProvider: provider,
          callAndSmsGatewayUrl: URL_TEXT,
          callAndSmsGatewaySecret: SECRET,
        }),
      ).toBeNull();
    }
  });

  test("none for a server set to the gateway without a URL - only a row edited by hand holds one", () => {
    for (const url of [undefined, null, "", " ", "\n\t ", 42, {}, []]) {
      expect({
        url,
        gateway: CallAndSmsProviders.getGateway({
          callAndSmsProvider: "Gateway",
          callAndSmsGatewayUrl: url,
          callAndSmsGatewaySecret: SECRET,
        }),
      }).toEqual({ url, gateway: null });
    }
  });

  test("the URL is posted to without the spaces around it", () => {
    expect(
      CallAndSmsProviders.getGateway({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: `  ${URL_TEXT}\n`,
        callAndSmsGatewaySecret: SECRET,
      })?.url,
    ).toBe(URL_TEXT);
  });

  test("a gateway with no secret is signed with an empty one, not refused", () => {
    for (const secret of [undefined, null, 7, {}, ["s"]]) {
      expect(
        CallAndSmsProviders.getGateway({
          callAndSmsProvider: "Gateway",
          callAndSmsGatewayUrl: URL_TEXT,
          callAndSmsGatewaySecret: secret,
        }),
      ).toEqual({ url: URL_TEXT, secret: "" });
    }

    expect(
      CallAndSmsProviders.getGateway({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: URL_TEXT,
      }),
    ).toEqual({ url: URL_TEXT, secret: "" });
  });

  test("the secret is used exactly as stored, its spaces included", () => {
    expect(
      CallAndSmsProviders.getGateway({
        callAndSmsProvider: "Gateway",
        callAndSmsGatewayUrl: URL_TEXT,
        callAndSmsGatewaySecret: " a secret ",
      })?.secret,
    ).toBe(" a secret ");
  });

  test("a config with nothing in it has no gateway", () => {
    expect(CallAndSmsProviders.getGateway({})).toBeNull();
  });

  test("reads only the three columns: a GlobalConfig row is handed over as it is", () => {
    const row: Record<string, unknown> = {
      callAndSmsProvider: "Gateway",
      callAndSmsGatewayUrl: URL_TEXT,
      callAndSmsGatewaySecret: SECRET,
      twilioAccountSID: "AC1",
      twilioAuthToken: "token",
    };

    const gateway: CallAndSmsGateway | null =
      CallAndSmsProviders.getGateway(row);

    expect(gateway).toEqual({ url: URL_TEXT, secret: SECRET });
    expect(Object.keys(gateway || {}).sort()).toEqual(["secret", "url"]);
  });

  test("for every mix of provider, URL and secret: a gateway exactly when the server is set to it and its URL is not blank", () => {
    const random: SeededRandom = seededRandom(31337);
    const providers: Array<unknown> = [
      "Gateway",
      "Twilio",
      undefined,
      null,
      "gateway",
      "",
      0,
    ];
    const urls: Array<unknown> = [
      URL_TEXT,
      `  ${URL_TEXT}  `,
      "http://10.0.0.5:8080/sms",
      "",
      "   ",
      undefined,
      null,
      123,
      { url: URL_TEXT },
    ];
    const secrets: Array<unknown> = [SECRET, "", " s ", undefined, null, 9];

    for (let index: number = 0; index < 3000; index++) {
      const config: {
        callAndSmsProvider: unknown;
        callAndSmsGatewayUrl: unknown;
        callAndSmsGatewaySecret: unknown;
      } = {
        callAndSmsProvider: providers[random(providers.length)],
        callAndSmsGatewayUrl: urls[random(urls.length)],
        callAndSmsGatewaySecret: secrets[random(secrets.length)],
      };

      const trimmed: string =
        typeof config.callAndSmsGatewayUrl === "string"
          ? config.callAndSmsGatewayUrl.trim()
          : "";

      const expected: CallAndSmsGateway | null =
        config.callAndSmsProvider === "Gateway" && trimmed
          ? {
              url: trimmed,
              secret:
                typeof config.callAndSmsGatewaySecret === "string"
                  ? config.callAndSmsGatewaySecret
                  : "",
            }
          : null;

      expect({
        config,
        gateway: CallAndSmsProviders.getGateway(config),
      }).toEqual({ config, gateway: expected });
    }
  });
});
