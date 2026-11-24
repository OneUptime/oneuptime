import { ExceptionGroupingContent } from "../../../FeatureSet/Telemetry/Utils/Exception";

/*
 * EXCEPTIONS AS THEY ARRIVE, AND AS THE SCRUB RULES LEAVE THEM (#10898).
 *
 * A corpus of what exceptions say, read by the tests that hold every
 * exception made before grouping v4 to the fingerprint it was made under
 * (ExceptionFingerprintsRecorded.test.ts): messages with no stack trace,
 * grouped by their text, holding the values grouping v4 folds - international
 * phone numbers, 15-digit American Express cards written 4-6-5, 19-digit
 * cards written 4-4-4-4-3 - and the ones v3 already folded, the near misses
 * no fold may take (order numbers, timestamps, version strings, ids), and
 * exceptions with a stack trace, grouped by their frames. An entry with
 * `stored` is one a scrub rule changed: `stored` is what the rule left.
 *
 * Add to it freely; never change or remove an entry once its fingerprints
 * are recorded (Fixtures/ExceptionFingerprintsRecorded), or record them
 * again on main's code first.
 */

export interface ExceptionCorpusEntry {
  name: string;
  arrived: ExceptionGroupingContent;
  stored?: ExceptionGroupingContent | undefined;
}

function message(
  exceptionType: string,
  text: string,
): ExceptionGroupingContent {
  return { exceptionType, message: text, stackTrace: "" };
}

// A message-only exception, and what a rule that hid `value` left of it.
function hidden(data: {
  name: string;
  exceptionType: string;
  template: string;
  value: string;
  shownAs: string;
}): ExceptionCorpusEntry {
  return {
    name: data.name,
    arrived: message(
      data.exceptionType,
      data.template.replace("{{value}}", data.value),
    ),
    stored: message(
      data.exceptionType,
      data.template.replace("{{value}}", data.shownAs),
    ),
  };
}

const JS_STACK: (text: string) => string = (text: string): string => {
  return [
    `TypeError: ${text}`,
    "    at sendCode (/app/src/notify/sms.ts:42:17)",
    "    at Layer.handle (/app/node_modules/express/lib/router/layer.js:95:5)",
    "    at verifyPhone (/app/src/account/verify.ts:118:9)",
  ].join("\n");
};

const PYTHON_STACK: (text: string) => string = (text: string): string => {
  return [
    "Traceback (most recent call last):",
    '  File "/srv/app/payments/charge.py", line 88, in charge',
    "    gateway.capture(card)",
    '  File "/srv/app/payments/gateway.py", line 31, in capture',
    "    raise CardDeclined(card)",
    `payments.errors.CardDeclined: ${text}`,
  ].join("\n");
};

const JAVA_STACK: (text: string) => string = (text: string): string => {
  return [
    `com.example.IdentityException: ${text}`,
    "\tat com.example.identity.SsnCheck.verify(SsnCheck.java:57)",
    "\tat com.example.identity.Onboarding.run(Onboarding.java:23)",
    "\tat java.base/java.lang.Thread.run(Thread.java:833)",
  ].join("\n");
};

// International phone numbers, as people write them.
export const INTERNATIONAL_PHONE_NUMBERS: ReadonlyArray<string> = [
  "+44 20 7946 0958",
  "+44 20 7946 0123",
  "+44 (0)20 7946 0958",
  "+44(0)20 7946 0958",
  "+44 (0) 20 7946 0958",
  "+44 207 946 0958",
  "+44 7911 123456",
  "+44 7911123456",
  "(+44) 20 7946 0958",
  "+49 30 123456",
  "+49 30 12345678",
  "+49-30-123456",
  "+33 1 23 45 67 89",
  "+33 6 12 34 56 78",
  "+91 98765 43210",
  "+91-98765-43210",
  "+91 9876543210",
  "+81 3-1234-5678",
  "+81 (3) 1234-5678",
  "+61 2 9876 5432",
  "+61 412 345 678",
  "+86 138 0013 8000",
  "+86 10 1234 5678",
  "+7 495 123-45-67",
  "+7 (495) 123-45-67",
  "+7 495 123 4567",
  "+55 11 91234-5678",
  "+55 (11) 91234-5678",
  "+353 1 234 5678",
  "+352 26 12 34 56",
  "+380 44 123 4567",
  "+971 4 123 4567",
  "+27 21 123 4567",
  "+64 9 123 4567",
  "+82 2-312-3456",
  "+34 912 34 56 78",
  "+39 06 1234 5678",
  "+31 20 123 4567",
  "+46 8 123 456 78",
  "+47 22 12 34 56",
  "+45 32 12 34 56",
  "+358 9 1234 5678",
  "+48 22 123 45 67",
  "+90 212 123 45 67",
  "+20 2 1234 5678",
  "+254 20 1234567",
  "+852 2123 4567",
  "+65 6123 4567",
  "+1 555 123 4567",
  "+1-555-123-4567",
  "+1 (555) 123-4567",
  "+1 5551234567",
  "+442079460958",
  "+15551234567",
];

// Card numbers, as people write them.
export const CARD_NUMBERS: ReadonlyArray<string> = [
  "4111-1111-1111-1234",
  "4111 1111 1111 9876",
  "5500 0000 0000 0004",
  "3782 822463 10005",
  "3714 496353 98431",
  "3782-822463-10005",
  "6011 1111 1111 1111 117",
  "6250 9460 0000 0016 117",
  "4111-1111-1111-1111-003",
  "3056 930902 5904",
  "4111111111111111",
];

// What no fold may take: values that are not a phone, a card or an SSN.
export const NEAR_MISSES: ReadonlyArray<string> = [
  "order ORD-2024-000123",
  "order #12345",
  "order 1234 5678",
  "order 123 456 789",
  "order 12-34-56-78",
  "2026-11-24T10:15:00Z",
  "2026-11-24 10:15:00 +0000",
  "Sat Nov 24 10:15:00 +0100 2026",
  "10:15:00 +05:30",
  "UTC+1",
  "UTC +1 2026",
  "GMT +12 2026-11-24",
  "epoch 1732443300",
  "v1.2.3+build.5",
  "release 2.10.3",
  "node 18.19.0+1",
  "+1.2.3",
  "version +2.3.4.5",
  "550e8400-e29b-41d4-a716-446655440000",
  "507f1f77bcf86cd799439011",
  "deadbeefcafe1234",
  "user 42 of 1000",
  "HTTP 503 after 3 retries",
  "step 2 of 3",
  "timeout after 3000ms",
  "10.0.0.12:5432",
  "+51.507217",
  "+12.345678",
  "+1 000 000",
  "+0044 20 7946 0958",
  "a+44 20 7946 0958",
  "++44 20 7946 0958",
  "+44",
  "+44 20",
  "+1 2 3 4 5 6 7 8",
  "+44 20 7946 0958 1234 5678",
  "ada@example.com",
];

const TEMPLATES: ReadonlyArray<[string, string]> = [
  ["CallError", "call {{value}} failed"],
  // A full stop right after it: where a sentence ends.
  ["ValidationError", "Invalid phone number: {{value}}."],
  ["PaymentDeclinedError", "card {{value}} declined"],
  ["Error", "{{value}}"],
];

function messagesOf(
  values: ReadonlyArray<string>,
  kind: string,
): Array<ExceptionCorpusEntry> {
  const entries: Array<ExceptionCorpusEntry> = [];

  for (const [exceptionType, template] of TEMPLATES) {
    for (const value of values) {
      entries.push({
        name: `${kind}: ${exceptionType}: ${template.replace("{{value}}", value)}`,
        arrived: message(exceptionType, template.replace("{{value}}", value)),
      });
    }
  }

  return entries;
}

export const EXCEPTION_FINGERPRINT_CORPUS: ReadonlyArray<ExceptionCorpusEntry> =
  [
    ...messagesOf(INTERNATIONAL_PHONE_NUMBERS, "international phone"),
    ...messagesOf(CARD_NUMBERS, "card"),
    ...messagesOf(NEAR_MISSES, "near miss"),
    {
      name: "a Social Security number",
      arrived: message("InvalidSsnError", "Invalid SSN 123-45-6789 on file"),
    },
    {
      name: "a US phone number",
      arrived: message("CallError", "call (555) 222-3333 failed"),
    },
    {
      name: "no value at all",
      arrived: message("Error", "Connection refused"),
    },
    {
      name: "an id the normalizer folds",
      arrived: message(
        "OrderError",
        "Order id=1042 not found for ada@example.com",
      ),
    },
    {
      name: "an empty exception",
      arrived: message("", ""),
    },
    {
      name: "two phone numbers",
      arrived: message(
        "CallError",
        "forward +44 20 7946 0958 to +49 30 123456 failed",
      ),
    },
    {
      name: "a phone number and a card",
      arrived: message(
        "PaymentDeclinedError",
        "card 3782 822463 10005 of +33 1 23 45 67 89 declined",
      ),
    },
    {
      name: "a phone number on a line of its own",
      arrived: message("CallError", "call failed:\n+44 20 7946 0958\nretrying"),
    },
    // With a stack trace: grouped by its frames, the message left out.
    {
      name: "a JavaScript stack, a phone number in its message",
      arrived: {
        exceptionType: "TypeError",
        message: "no code sent to +44 20 7946 0958",
        stackTrace: JS_STACK("no code sent to +44 20 7946 0958"),
      },
    },
    {
      name: "a Python traceback, an American Express card in its message",
      arrived: {
        exceptionType: "CardDeclined",
        message: "card 3782 822463 10005 declined",
        stackTrace: PYTHON_STACK("card 3782 822463 10005 declined"),
      },
    },
    {
      name: "a Java stack, an SSN in its message",
      arrived: {
        exceptionType: "com.example.IdentityException",
        message: "SSN 123-45-6789 does not match",
        stackTrace: JAVA_STACK("SSN 123-45-6789 does not match"),
      },
    },
    {
      name: "a stack trace of library frames only",
      arrived: {
        exceptionType: "Error",
        message: "socket hang up at +44 20 7946 0958",
        stackTrace: [
          "Error: socket hang up at +44 20 7946 0958",
          "    at connResetException (node:internal/errors:720:14)",
          "    at TLSSocket.socketOnEnd (node:_http_client:525:23)",
        ].join("\n"),
      },
    },
    // A scrub rule changed them: what it left is stored.
    hidden({
      name: "a rule redacted an international phone number",
      exceptionType: "CallError",
      template: "call {{value}} failed",
      value: "+44 20 7946 0958",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule masked an international phone number",
      exceptionType: "CallError",
      template: "call {{value}} failed",
      value: "+49 30 123456",
      shownAs: "+49 ** ****56",
    }),
    hidden({
      name: "the US Phone Number rule hid the end of an international number",
      exceptionType: "CallError",
      template: "call +44 {{value}} failed",
      value: "207 946 0958",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule hashed an American Express card",
      exceptionType: "PaymentDeclinedError",
      template: "card {{value}} declined",
      value: "3782 822463 10005",
      shownAs: "[HASHED:67e165957f4eb029]",
    }),
    hidden({
      name: "the Credit Card rule hid the first 16 digits of a 19-digit card",
      exceptionType: "PaymentDeclinedError",
      template: "card {{value}} 117 declined",
      value: "6011 1111 1111 1111",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule redacted a card in groups",
      exceptionType: "PaymentDeclinedError",
      template: "card {{value}} declined",
      value: "4111-1111-1111-4821",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule redacted an SSN",
      exceptionType: "InvalidSsnError",
      template: "Invalid SSN {{value}} on file",
      value: "123-45-6789",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule redacted a name",
      exceptionType: "AccountError",
      template: "No account for {{value}}",
      value: "Ada Lovelace",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule redacted an email address",
      exceptionType: "AccountError",
      template: "No account for {{value}}",
      value: "ada@example.com",
      shownAs: "[REDACTED]",
    }),
    hidden({
      name: "a rule redacted a name beside an international number",
      exceptionType: "CallError",
      template: "call {{value}} at +44 20 7946 0958 failed",
      value: "Ada Lovelace",
      shownAs: "[REDACTED]",
    }),
    {
      name: "a rule hid a phone number in a stack trace's message",
      arrived: {
        exceptionType: "TypeError",
        message: "no code sent to +44 20 7946 0958",
        stackTrace: JS_STACK("no code sent to +44 20 7946 0958"),
      },
      stored: {
        exceptionType: "TypeError",
        message: "no code sent to [REDACTED]",
        stackTrace: JS_STACK("no code sent to [REDACTED]"),
      },
    },
  ];
