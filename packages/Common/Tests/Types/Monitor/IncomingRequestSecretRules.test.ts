import IncomingRequestSecretRules, {
  INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME,
  INCOMING_REQUEST_SECRET_HEADER,
  INCOMING_REQUEST_SECRET_MAX_LENGTH,
  INCOMING_REQUEST_SECRET_MIN_LENGTH,
  INCOMING_REQUEST_SIGNATURE_FORMATS,
  IncomingRequestSecretValueProblem,
  IncomingRequestSignatureFormat,
  carriesIncomingRequestSignature,
} from "../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import { describe, expect, test } from "@jest/globals";

/*
 * Which values may be a project's incoming request secret (issue #7526),
 * when someone types one instead of letting OneUptime generate it. The
 * Dashboard shows these rules and the server enforces them, so a value is
 * judged the same in both places - and a secret that cannot travel in an
 * HTTP header unchanged is never accepted, because it would refuse every
 * request sent with it.
 */

describe("where a sender puts the secret", () => {
  test("the header and the Authorization scheme are the documented ones", () => {
    expect(INCOMING_REQUEST_SECRET_HEADER).toBe("X-OneUptime-Secret");
    expect(INCOMING_REQUEST_SECRET_AUTHORIZATION_SCHEME).toBe("Bearer");
  });
});

/*
 * Whether a request is signed, by the header names a relay sees (issue
 * #8500): a probe passes a signed request's body on as the bytes that came.
 */
describe("carriesIncomingRequestSignature", () => {
  test.each(
    INCOMING_REQUEST_SIGNATURE_FORMATS.map(
      (format: IncomingRequestSignatureFormat): [string] => {
        return [format.header];
      },
    ),
  )("is true for a request with %s, as Node names it", (header: string) => {
    expect(
      carriesIncomingRequestSignature({ [header.toLowerCase()]: "t=1,v1=00" }),
    ).toBe(true);
    expect(
      carriesIncomingRequestSignature({ [header.toLowerCase()]: ["v0=00"] }),
    ).toBe(true);
  });

  test("is false for a request that sends a secret, or nothing", () => {
    expect(
      carriesIncomingRequestSignature({
        "x-oneuptime-secret": "a-secret-of-the-project",
        authorization: "Bearer a-secret-of-the-project",
        "content-type": "application/json",
      }),
    ).toBe(false);
    expect(carriesIncomingRequestSignature({})).toBe(false);
  });

  test("is false for a signature header that is empty, or only a timestamp", () => {
    expect(
      carriesIncomingRequestSignature({ "x-oneuptime-signature": "" }),
    ).toBe(false);
    expect(carriesIncomingRequestSignature({ "stripe-signature": [] })).toBe(
      false,
    );
    expect(
      carriesIncomingRequestSignature({
        "x-slack-request-timestamp": "1800000000",
      }),
    ).toBe(false);
  });
});

describe("IncomingRequestSecretRules.getValueProblem", () => {
  test("accepts a value of exactly the shortest and the longest length", () => {
    expect(
      IncomingRequestSecretRules.getValueProblem(
        "a".repeat(INCOMING_REQUEST_SECRET_MIN_LENGTH),
      ),
    ).toBeNull();
    expect(
      IncomingRequestSecretRules.getValueProblem(
        "a".repeat(INCOMING_REQUEST_SECRET_MAX_LENGTH),
      ),
    ).toBeNull();
  });

  test("accepts every visible ASCII character a keyboard types", () => {
    expect(
      IncomingRequestSecretRules.getValueProblem(
        "Ab9!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~",
      ),
    ).toBeNull();
  });

  test("refuses a value one character too short", () => {
    expect(
      IncomingRequestSecretRules.getValueProblem(
        "a".repeat(INCOMING_REQUEST_SECRET_MIN_LENGTH - 1),
      ),
    ).toBe(IncomingRequestSecretValueProblem.TooShort);
  });

  test("refuses a value one character too long", () => {
    expect(
      IncomingRequestSecretRules.getValueProblem(
        "a".repeat(INCOMING_REQUEST_SECRET_MAX_LENGTH + 1),
      ),
    ).toBe(IncomingRequestSecretValueProblem.TooLong);
  });

  test("judges the value as it is sent: trimmed", () => {
    const padded: string = `   ${"a".repeat(INCOMING_REQUEST_SECRET_MIN_LENGTH)}   `;

    expect(IncomingRequestSecretRules.getValueProblem(padded)).toBeNull();

    // Spaces around a short value do not make it long enough.
    expect(
      IncomingRequestSecretRules.getValueProblem(
        `        ${"a".repeat(INCOMING_REQUEST_SECRET_MIN_LENGTH - 1)}        `,
      ),
    ).toBe(IncomingRequestSecretValueProblem.TooShort);
  });

  test.each([
    ["a space inside", "abcdefgh ijklmnopq"],
    ["a tab inside", "abcdefgh\tijklmnopq"],
    ["a newline inside", "abcdefgh\nijklmnopq"],
    ["a letter outside ASCII", "abcdefghijklmnopqé"],
    ["an emoji", "abcdefghijklmnop🔑"],
    ["a control character", "abcdefghijklmnop\u0007"],
  ])("refuses %s", (_name: string, value: string) => {
    expect(IncomingRequestSecretRules.getValueProblem(value)).toBe(
      IncomingRequestSecretValueProblem.UnsupportedCharacters,
    );
  });
});

describe("IncomingRequestSecretRules.getValueProblemMessage", () => {
  test.each(Object.values(IncomingRequestSecretValueProblem))(
    "%s is a sentence that says what to do next",
    (problem: IncomingRequestSecretValueProblem) => {
      const message: string =
        IncomingRequestSecretRules.getValueProblemMessage(problem);

      expect(message).toMatch(/^[A-Z]/);
      expect(message.endsWith(".")).toBe(true);
      // Every refusal offers the way out: let OneUptime generate one.
      expect(message).toContain("leave it empty and OneUptime generates");
    },
  );

  test("the length messages name the limits the rules enforce", () => {
    expect(
      IncomingRequestSecretRules.getValueProblemMessage(
        IncomingRequestSecretValueProblem.TooShort,
      ),
    ).toContain(`${INCOMING_REQUEST_SECRET_MIN_LENGTH} characters`);
    expect(
      IncomingRequestSecretRules.getValueProblemMessage(
        IncomingRequestSecretValueProblem.TooLong,
      ),
    ).toContain(`${INCOMING_REQUEST_SECRET_MAX_LENGTH} characters`);
  });
});
