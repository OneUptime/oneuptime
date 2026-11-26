import { describe, expect, test } from "@jest/globals";
import { MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH } from "../../../Types/DataSecurity/TelemetryLeakFix";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakTemplateOptions,
  VALUE_PLACEHOLDER,
  alignTelemetryLeakTemplates,
  buildTelemetryLeakTemplate,
  maskUnprovenWords,
  splitTemplateWords,
  toTypePlaceholder,
} from "../../../Utils/DataSecurity/TelemetryLeakTemplate";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";

/*
 * A LOG LINE AS A TEMPLATE: WHAT THE CODE WROTE, NEVER WHAT IT WROTE IT
 * WITH (#10367).
 *
 * The code agent finds the line that writes a leak by its constant words,
 * so a log line, an exception's message, a span's or a metric's name is
 * handed to it only as a template: every value a detector finds replaced
 * by its type's name, the rest collapsed to its pattern, a structured
 * line's fields kept by name only, anything still shaped like an address
 * or a masked value masked - and the reads of one line of code aligned, so
 * a word that differs between them is masked as the value it is.
 */

const namer: DataTypeNamer = DataTypeNamer.withoutCustomTypes();
const OPTIONS: TelemetryLeakTemplateOptions = {
  nameOf: (dataTypeId: string): string => {
    return namer.nameOf(dataTypeId);
  },
};

function template(text: string): string {
  return buildTelemetryLeakTemplate(text, OPTIONS);
}

describe("a value becomes its type's name", () => {
  test("an email address in a log line", () => {
    expect(template("User jane.doe@northwind-mail.com signed up")).toBe(
      `User ${toTypePlaceholder(namer.nameOf("email-address"))} signed up`,
    );
  });

  test("a card number, an id and a number: their types', and the pattern's", () => {
    const made: string = template(
      "Charged card 4111 1111 1111 1111 for order 7f3c2a9e-1b2c-4d5e-8f90-123456789abc, 3 items",
    );

    expect(made).not.toContain("4111");
    expect(made).not.toContain("7f3c2a9e");
    expect(made.startsWith("Charged card <")).toBe(true);
    expect(made).toContain("for order <");
  });

  test("an address no detector names - a test domain, a masked one - is masked all the same", () => {
    expect(template("Password reset sent to jane@example.com")).not.toContain(
      "example.com",
    );
    expect(template("Retrying for j***@e******.com now")).toBe(
      `Retrying for ${VALUE_PLACEHOLDER} now`,
    );
    expect(template("Card ****-****-****-4242 declined")).not.toContain("4242");
  });

  test("a type's name is one line, with no brackets of its own", () => {
    expect(toTypePlaceholder("Email <address>\nx")).toBe("<Email address x>");
    expect(toTypePlaceholder("  ")).toBe(VALUE_PLACEHOLDER);
  });
});

describe("a structured line keeps its message and its fields' names", () => {
  test("JSON: the message kept, every other value masked", () => {
    const made: string = template(
      '{"msg":"signup","email":"jane.doe@northwind-mail.com","plan":"pro","attempt":3}',
    );

    expect(made).toContain('"msg":"signup"');
    expect(made).toContain('"plan":<value>');
    expect(made).toContain('"attempt":<value>');
    expect(made).not.toContain("jane.doe");
    expect(made).not.toContain('pro"');
  });

  test("key=value: the message kept, every other value masked", () => {
    const made: string = template(
      "msg=signup user=jane.doe@northwind-mail.com plan=pro",
    );

    expect(made).toContain("msg=signup");
    expect(made).toContain("plan=<value>");
    expect(made).not.toContain("jane.doe");
  });
});

describe("what is left", () => {
  test("nothing but values and punctuation is no template", () => {
    expect(template("jane.doe@northwind-mail.com")).toBe("");
    expect(template("   ")).toBe("");
    expect(buildTelemetryLeakTemplate(undefined, OPTIONS)).toBe("");
  });

  test("one line, no control characters, held to its length", () => {
    const made: string = template(`Line one\nline two\t${"word ".repeat(200)}`);

    expect(made).not.toMatch(/[\n\t]/);
    expect(made.length).toBeLessThanOrEqual(MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH);
  });
});

describe("a template's words", () => {
  test("a placeholder is part of one word, whatever spaces it holds", () => {
    expect(splitTemplateWords("User <Email address> signed up")).toEqual([
      "User",
      "<Email address>",
      "signed",
      "up",
    ]);
    expect(splitTemplateWords("order id-<hex> shipped")).toEqual([
      "order",
      "id-<hex>",
      "shipped",
    ]);
    expect(splitTemplateWords("a < b")).toEqual(["a", "<", "b"]);
  });
});

describe("the reads of one line of code, aligned", () => {
  test("a word that differs between two reads is a value, in both", () => {
    const aligned: Map<string, string> = alignTelemetryLeakTemplates([
      "Hello Jane, your order shipped",
      "Hello Bob, your order shipped",
    ]);

    expect(aligned.get("Hello Jane, your order shipped")).toBe(
      "Hello <value>, your order shipped",
    );
    expect(aligned.get("Hello Bob, your order shipped")).toBe(
      "Hello <value>, your order shipped",
    );
  });

  test("a value touching a placeholder is one word with it: the reads still line up", () => {
    const aligned: Map<string, string> = alignTelemetryLeakTemplates([
      "Signed up PLANTED-A from PLANTED-RECORD-<hex>",
      "Signed up PLANTED-B from PLANTED-SCAN-CURSOR",
    ]);

    expect(Array.from(aligned.values())).toEqual([
      "Signed up <value> from <value>",
      "Signed up <value> from <value>",
    ]);
  });

  test("reads that cannot be lined up keep only the words both start and end with", () => {
    const aligned: Map<string, string> = alignTelemetryLeakTemplates([
      "Welcome back Mary Ann Smith to the shop",
      "Welcome back Bob to the shop",
    ]);

    expect(aligned.get("Welcome back Mary Ann Smith to the shop")).toBe(
      "Welcome back <value> to the shop",
    );
    expect(aligned.get("Welcome back Bob to the shop")).toBe(
      "Welcome back <value> to the shop",
    );
  });

  test("one read alone, or reads that agree, stay as alignment leaves them", () => {
    expect(
      Array.from(
        alignTelemetryLeakTemplates([
          "User <Email address> signed up",
          "User <Email address> signed up",
          "",
        ]).entries(),
      ),
    ).toEqual([
      ["User <Email address> signed up", "User <Email address> signed up"],
    ]);
  });
});

/*
 * A WORD NO RECORD PROVES IS THE CODE'S, MASKED (#11098).
 *
 * Read once - or always alike - a line tells no word of the code's from a
 * value no detector names. So its template keeps only the words code
 * writes log lines with; an aligned one keeps what every read shares, but
 * for a word written as a person's name.
 */
function once(text: string): string {
  return maskUnprovenWords(template(text), { isAligned: false });
}

function aligned(text: string): string {
  return maskUnprovenWords(template(text), { isAligned: true });
}

describe("a template read from one record keeps only the code's words", () => {
  test("a person's name, which no detector names, is masked", () => {
    expect(once("Payment declined for Ada Lovelace")).toBe(
      "Payment declined for <value>",
    );
    expect(once("Sending welcome email to Grace Hopper now")).toBe(
      "Sending welcome email to <value> now",
    );
    expect(once("Payment declined for Tyra Banks")).toBe(
      "Payment declined for <value>",
    );
  });

  test("a name at a sentence's start, and one that is a word too, is masked", () => {
    expect(once("Ada Lovelace signed up")).toBe("<value> signed up");
    expect(once("[ERROR] Will Smith could not log in")).toBe(
      "[ERROR] <value> could not log in",
    );
    expect(once("Banks paid the invoice")).toBe("<value> paid the invoice");
  });

  test("a value with no digit and no detector's shape - a username, a code, a free text - is masked", () => {
    expect(once("User 'ada_lovelace' logged in")).toBe(
      "User '<value>' logged in",
    );
    expect(once("Retrying for PLANTED-LOGLINE-ONE now")).toBe(
      "Retrying for <value> now",
    );
    expect(
      once("Feedback received: my wife is pregnant and the app crashed"),
    ).toBe("Feedback received: my <value> is <value> and the app crashed");
  });

  test("a name in another script, or with an accent, is masked", () => {
    expect(once("Payment declined for José García")).toBe(
      "Payment declined for <value>",
    );
    expect(once("Payment declined for 张伟")).toBe(
      "Payment declined for <value>",
    );
  });

  test("words masked side by side are one value; punctuation between them is kept", () => {
    expect(once("Shared with Ada Lovelace, Grace Hopper and Alan Turing")).toBe(
      "Shared with <value>, <value> and <value>",
    );
  });

  test("the code's own words, as written, are kept", () => {
    for (const line of [
      "User <Email address> signed up",
      "Payment declined",
      "Error in PaymentService.processPayment: card declined",
      "Connected to PostgreSQL after <num> retries",
      "Calling Stripe API",
      "will retry in <num> seconds",
      "POST /signup",
      "GET /api/v<num>/users/{userId}/orders",
      "ECONNREFUSED <ip>:<num>",
      "order.step<num>",
    ]) {
      expect(maskUnprovenWords(line, { isAligned: false })).toBe(line);
    }
  });

  test("a structured line keeps its fields' names, and masks the words of its message no record proves", () => {
    expect(
      once(
        '{"msg":"Payment declined for Ada Lovelace","email":"jane.doe@northwind-mail.com","plan":"pro"}',
      ),
    ).toBe(
      `{"msg":"Payment declined for <value>","email":"${toTypePlaceholder(namer.nameOf("email-address"))}","plan":<value>}`,
    );
    expect(
      once(
        'msg="Payment declined for Grace" user=jane.doe@northwind-mail.com plan=pro',
      ),
    ).toBe(
      `msg="Payment declined for <value>" user=${toTypePlaceholder(namer.nameOf("email-address"))} plan=<value>`,
    );
    // A field's name the vocabulary does not hold is still the code's.
    expect(
      maskUnprovenWords('{"custRef":<value>,"ordNo":<value>}', {
        isAligned: false,
      }),
    ).toBe('{"custRef":<value>,"ordNo":<value>}');
  });

  test("a page's path: its words kept, a name's segment masked", () => {
    expect(
      maskUnprovenWords("/profile/ada-lovelace/settings", { isAligned: false }),
    ).toBe("/profile/<value>/settings");
    expect(
      maskUnprovenWords("/checkout/[redacted]/pay", { isAligned: false }),
    ).toBe("/checkout/[redacted]/pay");
  });

  test("nothing of the code's words left is no template", () => {
    expect(once("Ada Lovelace")).toBe("");
    expect(once("Zahlung abgelehnt für Ada Lovelace")).toBe("");
    expect(maskUnprovenWords("", { isAligned: false })).toBe("");
    expect(maskUnprovenWords("<value> <value>", { isAligned: false })).toBe("");
  });

  test("the placeholders the detectors and patterns put in are kept as they are", () => {
    expect(
      maskUnprovenWords("Charged <Credit card number> at <timestamp>", {
        isAligned: false,
      }),
    ).toBe("Charged <Credit card number> at <timestamp>");
  });
});

describe("an aligned template keeps the words every read shares, but a name", () => {
  test("a word written as a person's name is masked, however many records hold it", () => {
    expect(
      aligned("Payment declined for Ada Lovelace: insufficient funds"),
    ).toBe("Payment declined for <value>: insufficient funds");
    expect(aligned("Sending welcome email to Grace")).toBe(
      "Sending welcome email to <value>",
    );
  });

  test("the words alignment proved - lower case, an identifier, a technology's name - are kept", () => {
    expect(aligned("Calling Stripe API for customer <value>")).toBe(
      "Calling Stripe API for customer <value>",
    );
    expect(aligned("Zahlung abgelehnt für <value>")).toBe(
      "Zahlung abgelehnt für <value>",
    );
    expect(
      maskUnprovenWords("Error in PaymentService: <value>", {
        isAligned: true,
      }),
    ).toBe("Error in PaymentService: <value>");
  });

  test("a word at a sentence's start is the code's", () => {
    expect(
      maskUnprovenWords("Order <value> shipped. Notified the warehouse", {
        isAligned: true,
      }),
    ).toBe("Order <value> shipped. Notified the warehouse");
  });
});

describe("masking a template takes time in line with its length", () => {
  const LIMIT_IN_MS: number = 2000;

  function repeat(piece: string): string {
    return piece.repeat(Math.ceil(400_000 / piece.length)).slice(0, 400_000);
  }

  test.each([
    ["a word without end", repeat("a")],
    ["joiners without end", repeat("a-")],
    ["apostrophes without end", repeat("a'")],
    ["names without end", repeat("Ada Lovelace ")],
    ["half placeholders without end", repeat("<a")],
    ["placeholders without end", repeat("<value> ")],
    ["a camel case identifier without end", repeat("aB")],
    ["letters of another script without end", repeat("张")],
    ["spaces before a full stop without end", `a${" ".repeat(399_996)}.b`],
    ["a field's name before spaces without end", `"a"${" ".repeat(399_996)}`],
    ["opening brackets without end", `a ${repeat("(")}b`],
  ])("reads %s", (_label: string, text: string) => {
    for (const isAligned of [false, true]) {
      const timed: FastestRun<number> = fastestRun({
        run: (): number => {
          return maskUnprovenWords(text, { isAligned }).length;
        },
        limitInMs: LIMIT_IN_MS,
      });

      expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
    }
  });
});
