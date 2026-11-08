import MonitorEvidenceRedaction from "../../../../Server/Utils/Monitor/MonitorEvidenceRedaction";
import Dictionary from "../../../../Types/Dictionary";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import { FastestRun, fastestRun } from "../../../Helpers/FastestRun";
import { describe, expect, test } from "@jest/globals";

/*
 * WHAT AN INCIDENT OR AN ALERT MAY KEEP OF A CHECK'S RESPONSE.
 *
 * The evaluation details and the monitor summary of an incident or an alert
 * are read by everyone who can read the record, Viewer included, for as long
 * as it lives. So what they keep of a response is redacted first, by one set
 * of rules (MonitorEvidenceRedaction): each class of secret and personal
 * data below is masked, and the evidence around it is kept.
 */

const REDACTED: string = "[REDACTED]";

describe("names that hold a credential or personal data", () => {
  test.each([
    // The credential headers every HTTP client sends or receives.
    "Authorization",
    "authorization",
    "Proxy-Authorization",
    "Cookie",
    "Set-Cookie",
    "set-cookie",
    "X-API-Key",
    "x-api-key",
    "X-Auth-Token",
    "X-Access-Token",
    "X-CSRF-Token",
    "X-Amz-Security-Token",
    "X-Goog-Api-Key",
    // JSON fields, in every spelling.
    "apiKey",
    "api_key",
    "APIKey",
    "access_token",
    "accessToken",
    "refresh_token",
    "client_secret",
    "clientSecret",
    "password",
    "Password",
    "passwd",
    "secret",
    "privateKey",
    "sessionId",
    "session_id",
    "jwt",
    "signature",
    // The whole words the logger's list leaves to context.
    "key",
    "Key",
    "secretKey",
    "publicKey",
    "session",
    "sessions",
    "auth",
    "x-auth",
    "pin",
    "pwd",
    // Personal data.
    "email",
    "Email",
    "userEmail",
    "email_address",
    "emails",
    "phone",
    "phoneNumber",
    "phone_number",
    "mobile",
    "telephone",
    "dateOfBirth",
    "date_of_birth",
    "dob",
    "birthDate",
    "ssn",
    "socialSecurityNumber",
    "iban",
    "cardNumber",
    "card_number",
    "creditCard",
    "cvv",
    "cvc",
    "passport",
    "passportNumber",
    "taxId",
    "nationalId",
  ])("%s is masked", (name: string) => {
    expect(MonitorEvidenceRedaction.isSensitiveName(name)).toBe(true);
    expect(MonitorEvidenceRedaction.isSensitiveHeaderName(name)).toBe(true);
  });

  test.each([
    // A response's ordinary evidence keeps its value.
    "Content-Type",
    "content-length",
    "Server",
    "Date",
    "X-Request-Id",
    "Location",
    "status",
    "message",
    "error",
    "region",
    "service",
    "items",
    "data",
    "statusCode",
    "errorCode",
    "responseTime",
    // A whole word, not a fragment: these are not keys or sessions.
    "monkey",
    "keyboard",
    "turkey",
    "possession",
    "passed",
    "pinned",
    "authenticated",
    // A numeric code in a response is an error code - the evidence.
    "code",
    "codes",
    // Token accounting, as the logger keeps it.
    "tokenCount",
    "totalTokens",
    "inputTokens",
  ])("%s keeps its value", (name: string) => {
    expect(MonitorEvidenceRedaction.isSensitiveName(name)).toBe(false);
  });

  test("a code that is numeric keeps its value, in a response", () => {
    expect(MonitorEvidenceRedaction.isSensitiveName("code", 50031)).toBe(false);
    expect(MonitorEvidenceRedaction.isSensitiveName("code", "E_TIMEOUT")).toBe(
      false,
    );
  });

  test("an authorization code is still masked", () => {
    expect(MonitorEvidenceRedaction.isSensitiveName("authCode")).toBe(true);
    expect(MonitorEvidenceRedaction.isSensitiveName("auth_code")).toBe(true);
  });

  test("a name nobody wrote on purpose is masked, not read", () => {
    expect(MonitorEvidenceRedaction.isSensitiveName("x".repeat(257))).toBe(
      true,
    );
  });

  test("nothing is not a name", () => {
    expect(MonitorEvidenceRedaction.isSensitiveName("")).toBe(false);
    expect(MonitorEvidenceRedaction.isSensitiveName("---")).toBe(false);
  });
});

describe("email addresses in text", () => {
  test("an address is masked whole, the text around it kept", () => {
    expect(
      MonitorEvidenceRedaction.maskEmailAddresses(
        'owner is jane.doe+ops@example.co.uk, see "contacts"',
      ),
    ).toBe(`owner is ${REDACTED}, see "contacts"`);
  });

  test("every address in a text", () => {
    expect(
      MonitorEvidenceRedaction.maskEmailAddresses(
        '{"to":"a@x.io","cc":["b.c@y.org","d@z.net"]}',
      ),
    ).toBe(`{"to":"${REDACTED}","cc":["${REDACTED}","${REDACTED}"]}`);
  });

  test("a sentence's full stop is not part of the domain", () => {
    expect(
      MonitorEvidenceRedaction.maskEmailAddresses("Write to ops@example.com."),
    ).toBe(`Write to ${REDACTED}.`);
  });

  test.each([
    "@channel please look",
    "user@localhost",
    "a@b.c",
    "price: 10@ 3.5",
    "name@123.456",
    "@@@@",
    "trailing@",
  ])("%s is no email address", (text: string) => {
    expect(MonitorEvidenceRedaction.maskEmailAddresses(text)).toBe(text);
  });

  test("takes time in line with the text on its worst case", () => {
    const worstCases: Array<string> = [
      "a".repeat(400000) + "@example.com",
      "a@".repeat(200000),
      "@a".repeat(200000),
      "a@b.".repeat(100000),
    ];

    for (const text of worstCases) {
      const run: FastestRun<string> = fastestRun({
        run: (): string => {
          return MonitorEvidenceRedaction.maskEmailAddresses(text);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    }
  });
});

describe("card numbers in text", () => {
  test.each([
    ["Visa", "4111111111111111"],
    ["Visa, in groups", "4111 1111 1111 1111"],
    ["Visa, with hyphens", "4111-1111-1111-1111"],
    ["Mastercard", "5555555555554444"],
    ["Mastercard 2-series", "2223003122003222"],
    ["American Express", "378282246310005"],
    ["American Express, in groups", "3782 822463 10005"],
    ["Discover", "6011111111111117"],
    ["JCB", "3530111333300000"],
    ["Diners Club", "30569309025904"],
    ["UnionPay", "6200000000000005"],
  ])("a %s number is masked", (_network: string, number: string) => {
    expect(
      MonitorEvidenceRedaction.maskCardNumbers(`{"pan":"${number}","ok":1}`),
    ).toBe(`{"pan":"${REDACTED}","ok":1}`);
  });

  test.each([
    // A wrong check digit.
    "4111111111111112",
    // A millisecond timestamp, and a nanosecond one: they start with 1.
    "1730000000000",
    "1730000000000000000",
    // A record id of 19 digits (Discord, Twitter snowflakes).
    "1234567890123456789",
    // Too short, and too long a run of digits.
    "411111111111",
    "41111111111111111111111",
    // Part of a word or an id.
    "id4111111111111111",
    "4111111111111111x",
  ])("%s is no card number", (text: string) => {
    expect(MonitorEvidenceRedaction.maskCardNumbers(text)).toBe(text);
  });

  test("isCardNumber needs a network's prefix, length and check digit", () => {
    expect(MonitorEvidenceRedaction.isCardNumber("4242424242424242")).toBe(
      true,
    );
    expect(MonitorEvidenceRedaction.isCardNumber("4242424242424241")).toBe(
      false,
    );
    // Visa issues 13, 16 and 19 digits only.
    expect(MonitorEvidenceRedaction.isCardNumber("424242424242424")).toBe(
      false,
    );
    // No network starts with 9.
    expect(MonitorEvidenceRedaction.isCardNumber("9111111111111111")).toBe(
      false,
    );
  });

  test("takes time in line with the text on its worst case", () => {
    const worstCases: Array<string> = [
      "4".repeat(400000),
      "4 ".repeat(200000),
      "4111-".repeat(80000),
      "41111111111111111 ".repeat(22000),
    ];

    for (const text of worstCases) {
      const run: FastestRun<string> = fastestRun({
        run: (): string => {
          return MonitorEvidenceRedaction.maskCardNumbers(text);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    }
  });
});

describe("credential-shaped text", () => {
  test("a bearer token is masked, its scheme kept", () => {
    expect(
      MonitorEvidenceRedaction.redactText(
        "Authorization: Bearer abc123.def456-ghi789",
      ),
    ).not.toContain("abc123.def456-ghi789");
  });

  test("a JWT is masked wherever it stands", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

    const redacted: string = MonitorEvidenceRedaction.redactText(
      `{"note":"session ${jwt} expired"}`,
    );

    expect(redacted).not.toContain(jwt);
    expect(redacted).toContain(REDACTED);
    expect(redacted).toContain("expired");
  });

  test("a secret member of JSON text is masked", () => {
    const redacted: string = MonitorEvidenceRedaction.redactText(
      '{"status":"down","password":"hunter2"}',
    );

    expect(redacted).not.toContain("hunter2");
    expect(redacted).toContain('"status":"down"');
  });

  test("emails and card numbers are masked with the rest", () => {
    expect(
      MonitorEvidenceRedaction.redactText(
        "paid by jane@example.com with 4111 1111 1111 1111",
      ),
    ).toBe(`paid by ${REDACTED} with ${REDACTED}`);
  });

  test("reading a text it already redacted changes nothing", () => {
    const texts: Array<string> = [
      "token=abc123&page=2",
      '{"password":"hunter2","status":"down"}',
      "Authorization: Bearer abc123.def456-ghi789",
      "mail ops@example.com about 4111 1111 1111 1111",
      "https://u:p@example.com/a?api_key=k&sig=s",
    ];

    for (const text of texts) {
      const once: string = MonitorEvidenceRedaction.redactText(text);

      expect(MonitorEvidenceRedaction.redactText(once)).toBe(once);
      expect(once).not.toContain("]]");
    }
  });

  test("a URL redacted twice reads as once", () => {
    const once: string = MonitorEvidenceRedaction.redactUrl(
      "https://admin:pw@example.com/x?token=t&a=1",
    );

    expect(MonitorEvidenceRedaction.redactUrl(once)).toBe(once);
  });

  test("text with nothing in it stays as written", () => {
    const text: string =
      '{"service":"checkout","status":"error: connection refused","retry":3}';

    expect(MonitorEvidenceRedaction.redactText(text)).toBe(text);
  });
});

describe("JSON", () => {
  test("the values of sensitive fields are masked at every depth", () => {
    const input: JSONObject = {
      status: "down",
      user: {
        name: "Jane",
        email: "jane@example.com",
        session: { id: "s-1", expires: "tomorrow" },
      },
      items: [{ apiKey: "k-1", label: "one" }, { label: "two" }],
      headers: { Authorization: "Bearer xyz", "Content-Type": "json" },
    };

    expect(MonitorEvidenceRedaction.redactJson(input)).toEqual({
      status: "down",
      user: {
        name: "Jane",
        email: REDACTED,
        session: REDACTED,
      },
      items: [{ apiKey: REDACTED, label: "one" }, { label: "two" }],
      headers: { Authorization: REDACTED, "Content-Type": "json" },
    });
  });

  test("strings are swept wherever their field is named", () => {
    expect(
      MonitorEvidenceRedaction.redactJson({
        note: "contact ops@example.com",
      }),
    ).toEqual({ note: `contact ${REDACTED}` });
  });

  test("the input is not changed: the evaluator is still reading it", () => {
    const input: JSONObject = { password: "hunter2", nested: { token: "t" } };
    const copy: string = JSON.stringify(input);

    MonitorEvidenceRedaction.redactJson(input);

    expect(JSON.stringify(input)).toBe(copy);
  });

  test("past its depth a subtree is dropped, not passed through unread", () => {
    let deep: JSONValue = { password: "hunter2" };

    for (let index: number = 0; index < 20; index++) {
      deep = { next: deep };
    }

    expect(JSON.stringify(MonitorEvidenceRedaction.redactJson(deep))).not.toContain(
      "hunter2",
    );
  });
});

describe("headers", () => {
  test("credential headers keep their name and lose their value", () => {
    const headers: Dictionary<string> = {
      authorization: "Bearer abc.def.ghi",
      "proxy-authorization": "Basic dXNlcjpwYXNz",
      cookie: "sid=1",
      "set-cookie": "session=abc; HttpOnly",
      "x-api-key": "k_live_123",
      "content-type": "application/json",
      server: "nginx",
    };

    expect(MonitorEvidenceRedaction.redactHeaders(headers)).toEqual({
      authorization: REDACTED,
      "proxy-authorization": REDACTED,
      cookie: REDACTED,
      "set-cookie": REDACTED,
      "x-api-key": REDACTED,
      "content-type": "application/json",
      server: "nginx",
    });
  });

  test("a value that carries a secret in its URL is masked there", () => {
    const redacted: Dictionary<string> =
      MonitorEvidenceRedaction.redactHeaders({
        location: "https://example.com/next?token=abc123&page=2",
      })!;

    expect(redacted["location"]).toBe(
      `https://example.com/next?token=${REDACTED}&page=2`,
    );
  });

  test("no headers is no headers", () => {
    expect(MonitorEvidenceRedaction.redactHeaders(undefined)).toBeUndefined();
  });
});

describe("URLs", () => {
  test("a password in the URL is masked, the user kept", () => {
    expect(
      MonitorEvidenceRedaction.redactUrl("https://admin:hunter2@example.com/x"),
    ).toBe(`https://admin:${REDACTED}@example.com/x`);
  });

  test("a user with no password is masked: it can be a token", () => {
    expect(
      MonitorEvidenceRedaction.redactUrl(
        "https://ghp_abcdefghijklmnopqrstuvwxyz0123456789@github.com/acme/app",
      ),
    ).toBe(`https://${REDACTED}@github.com/acme/app`);
  });

  test("secret query values are masked, the others kept", () => {
    expect(
      MonitorEvidenceRedaction.redactUrl(
        "https://api.example.com/v1/health?api_key=abc&page=2&access_token=xyz&region=eu#top",
      ),
    ).toBe(
      `https://api.example.com/v1/health?api_key=${REDACTED}&page=2&access_token=${REDACTED}&region=eu#top`,
    );
  });

  test.each([
    "sig",
    "signature",
    "X-Amz-Signature",
    "X-Amz-Credential",
    "X-Amz-Security-Token",
    "X-Goog-Signature",
    "code",
    "token",
    "key",
    "password",
    "client_secret",
    "email",
  ])("the %s parameter is masked", (name: string) => {
    expect(
      MonitorEvidenceRedaction.redactUrl(
        `https://storage.example.com/file?${name}=value-1&id=7`,
      ),
    ).toBe(`https://storage.example.com/file?${name}=${REDACTED}&id=7`);
  });

  test("a monitor secret is shown by name, as it was configured", () => {
    const url: string =
      "https://api.example.com/status?key={{monitorSecrets.ApiKey}}";

    expect(MonitorEvidenceRedaction.redactUrl(url)).toBe(
      `https://api.example.com/status?key=${REDACTED}`,
    );
    expect(
      MonitorEvidenceRedaction.redactUrl(
        "https://api.example.com/{{monitorSecrets.Tenant}}/status",
      ),
    ).toBe("https://api.example.com/{{monitorSecrets.Tenant}}/status");
  });

  test("a JWT in the path is masked", () => {
    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

    expect(
      MonitorEvidenceRedaction.redactUrl(`https://example.com/verify/${jwt}`),
    ).toBe(`https://example.com/verify/${REDACTED}`);
  });

  test("a URL with nothing secret stays as written", () => {
    const url: string = "https://status.example.com/api/v2/summary.json?a=1";

    expect(MonitorEvidenceRedaction.redactUrl(url)).toBe(url);
  });

  test("URLs inside text are each redacted", () => {
    expect(
      MonitorEvidenceRedaction.redactUrlsInText(
        'moved to "https://u:p@example.com/a?token=t" and http://x.io/?sig=s',
      ),
    ).toBe(
      `moved to "https://u:${REDACTED}@example.com/a?token=${REDACTED}" and http://x.io/?sig=${REDACTED}`,
    );
  });

  test("redactUrlsInText takes time in line with the text", () => {
    const worstCases: Array<string> = [
      "a://".repeat(100000),
      "https://" + "a".repeat(400000),
      "aaaaaaaa".repeat(50000) + "://",
    ];

    for (const text of worstCases) {
      const run: FastestRun<string> = fastestRun({
        run: (): string => {
          return MonitorEvidenceRedaction.redactUrlsInText(text);
        },
        limitInMs: 2000,
      });

      expect(run.inMs).toBeLessThan(2000);
    }
  });
});
