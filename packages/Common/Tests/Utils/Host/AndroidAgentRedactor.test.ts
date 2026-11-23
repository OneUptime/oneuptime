import AndroidAgentRedactor, {
  REDACTOR_MAX_LENGTH,
} from "../../../Utils/Host/AndroidAgentRedactor";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * The Android agent's redaction, as OneUptime runs it over what it sends to
 * a device (a log session's note, #9966). Every case is one of the agent's
 * own (agents/AndroidAgent RedactorTest.kt), with the same answer: a text
 * reads the same on the device whichever of the two redacted it. Only the
 * token's own block at the end is ours: it holds the JavaScript form of the
 * agent's token pattern, read once per run, to the tokens the agent's finds.
 */

function redact(text: string | null | undefined): string {
  return AndroidAgentRedactor.redact(text);
}

describe("a card number", () => {
  test("is taken out, whichever way it is written", () => {
    expect(redact("Declined 4111111111111111 at terminal 4")).toBe(
      "Declined [card number] at terminal 4",
    );
    expect(redact("card=4111 1111 1111 1111;")).toBe("card=[card number];");
    expect(redact("pan 5500-0000-0000-0004")).toBe("pan [card number]");
    expect(redact("Amex 378282246310005 ok")).toBe("Amex [card number] ok");
  });

  test("a long number that is not a card is kept", () => {
    // Fails the Luhn check.
    expect(redact("order 4111111111111112")).toBe("order 4111111111111112");
    // Millisecond and nanosecond timestamps start with 1, which no card number does.
    expect(redact("at 1795076857467")).toBe("at 1795076857467");
    expect(redact("t=1795076857467123456")).toBe("t=1795076857467123456");
    // Too short, and inside a word.
    expect(redact("id 411111111111")).toBe("id 411111111111");
    expect(redact("x4111111111111111y")).toBe("x4111111111111111y");
  });

  test("the Luhn check", () => {
    expect(AndroidAgentRedactor.passesLuhn("4111111111111111")).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("79927398713")).toBe(true);
    expect(AndroidAgentRedactor.passesLuhn("79927398710")).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("")).toBe(false);
    expect(AndroidAgentRedactor.passesLuhn("41a1")).toBe(false);
    expect(AndroidAgentRedactor.looksLikeCardNumber("4111111111111111")).toBe(
      true,
    );
    expect(AndroidAgentRedactor.looksLikeCardNumber("1111111111111117")).toBe(
      false,
    );
  });
});

describe("an email address", () => {
  test("is taken out", () => {
    expect(redact("Receipt sent to jane.doe+kiosk@example.co.uk.")).toBe(
      "Receipt sent to [email].",
    );
    expect(redact("user=a@b.io")).toBe("user=[email]");
  });
});

describe("credentials and tokens", () => {
  test("are taken out, their names kept", () => {
    expect(redact("Authorization: Bearer abcdefghijklmnop")).toBe(
      "Authorization: Bearer [credential]",
    );
    expect(redact("authorization=Basic dXNlcjpwYXNzd29yZA==")).toBe(
      "authorization=Basic [credential]",
    );
    expect(redact("password=hunter2&user=7")).toBe(
      "password=[redacted]&user=7",
    );
    expect(redact('{"api_key": "sk_live_123", "n": 1}')).toBe(
      '{"api_key": "[redacted]", "n": 1}',
    );
    expect(redact("csrf_token: abc123 next")).toBe(
      "csrf_token: [redacted] next",
    );
    expect(redact("GET /pay?session_id=XYZ123&amount=5")).toBe(
      "GET /pay?session_id=[redacted]&amount=5",
    );
    expect(redact("pin=1234")).toBe("pin=[redacted]");

    const jwt: string =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";
    expect(redact(`token ${jwt} expired`)).toBe("token [token] expired");
    expect(redact(`id_token=${jwt}`)).toBe("id_token=[token]");
  });

  test("a name that only holds a secret's word, or a value already taken out, is kept", () => {
    expect(redact("max_tokens=5 spinner=3 mapping=x")).toBe(
      "max_tokens=5 spinner=3 mapping=x",
    );
    expect(redact("password=[redacted]")).toBe("password=[redacted]");
    expect(redact('password="[redacted]"')).toBe('password="[redacted]"');
  });
});

describe("what a crash is read by", () => {
  test("is kept", () => {
    const stack: string = [
      "java.lang.IllegalStateException: Printer offline (job 1234, pid 4321)",
      "\tat com.example.kiosk.TokenManager.refresh(TokenManager.kt:42)",
      "\tat com.example.kiosk.MainActivity.onCreate(MainActivity.kt:20)",
      "\tat android.app.Activity.performCreate(Activity.java:8595)",
    ].join("\n");

    expect(redact(stack)).toBe(stack);
    expect(
      redact(
        "  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190",
      ),
    ).toBe("  580  1029 I ActivityManager: Start proc 4321:com.example/u0a190");
  });
});

describe("its bounds", () => {
  test("nothing in, nothing out, and a huge text is cut first", () => {
    expect(redact(null)).toBe("");
    expect(redact(undefined)).toBe("");
    expect(redact("")).toBe("");
    expect(redact("a".repeat(REDACTOR_MAX_LENGTH + 10))).toHaveLength(
      REDACTOR_MAX_LENGTH,
    );
  });

  test("a long text costs time in proportion to its length", () => {
    // A long word before a secret's name, a long number, a long run of "@".
    const texts: Array<string> = [
      "a".repeat(200_000) + " password" + "b".repeat(50_000) + "=x",
      "1".repeat(200_000),
      "x@".repeat(100_000),
    ];
    // The fastest of up to three attempts: one timing on a busy runner is noisy.
    const redacted: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return texts.map(redact);
      },
      limitInMs: 5_000,
    });

    // None of them holds a secret, a card number or an address.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });

  test("the same text twice reads the same: no pattern keeps a place between calls", () => {
    const text: string = "Call dana@example.com about 4111 1111 1111 1111";

    expect(redact(text)).toBe("Call [email] about [card number]");
    expect(redact(text)).toBe("Call [email] about [card number]");
  });
});

describe("a token, looked for once per run of its characters", () => {
  const jwt: string =
    "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0In0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U";

  test("is taken out where the agent's word boundary lets one start, and only there", () => {
    // After a "-" in a run: the run's text before it stays.
    expect(redact(`trace-${jwt}`)).toBe("trace-[token]");
    expect(redact(`req a-b-${jwt}.more`)).toBe("req a-b-[token].more");
    // Glued to a word, no token starts: the agent keeps it too.
    expect(redact(`x${jwt}`)).toBe(`x${jwt}`);
  });

  test("a long run of a token's characters costs time in proportion to its length", () => {
    // Read once more from each "eyJ", these took seconds (TokenPatternsGuard).
    const texts: Array<string> = [
      "-eyJ-".repeat(40_000),
      "eyJab-".repeat(40_000),
      "eyJ".repeat(80_000),
    ];
    const redacted: FastestRun<Array<string>> = fastestRun({
      run: (): Array<string> => {
        return texts.map(redact);
      },
      limitInMs: 5_000,
    });

    // No token is whole in any of them.
    expect(redacted.result).toEqual(texts);
    expect(redacted.inMs).toBeLessThan(5_000);
  });
});
