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
 * A WORD NO RECORD CAN PROVE IS THE CODE'S, MASKED (#11098, #11204).
 *
 * Nothing in a leak's records tells a word of the code's from a value no
 * detector names: not one record, nor records that all read alike, nor
 * records of a line aligned with different words - of those, the words
 * that differ are values, and the words they share are no more the
 * code's for it: every record of one user's session holds that user's
 * name. So a template keeps only the words code writes log lines with,
 * however many records share a word.
 */
function once(text: string): string {
  return maskUnprovenWords(template(text));
}

// The reads of one line of code, aligned and then masked as the places of a leak are.
function aligned(texts: ReadonlyArray<string>): Array<string> {
  const templates: Array<string> = texts.map(template);
  const lined: Map<string, string> = alignTelemetryLeakTemplates(templates);

  return templates.map((each: string): string => {
    return maskUnprovenWords(lined.get(each) || each);
  });
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
      expect(maskUnprovenWords(line)).toBe(line);
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
    expect(maskUnprovenWords('{"custRef":<value>,"ordNo":<value>}')).toBe(
      '{"custRef":<value>,"ordNo":<value>}',
    );
  });

  test("a page's path: its words kept, a name's segment masked", () => {
    expect(maskUnprovenWords("/profile/ada-lovelace/settings")).toBe(
      "/profile/<value>/settings",
    );
    expect(maskUnprovenWords("/checkout/[redacted]/pay")).toBe(
      "/checkout/[redacted]/pay",
    );
  });

  test("nothing of the code's words left is no template", () => {
    expect(once("Ada Lovelace")).toBe("");
    expect(once("Zahlung abgelehnt für Ada Lovelace")).toBe("");
    expect(maskUnprovenWords("")).toBe("");
    expect(maskUnprovenWords("<value> <value>")).toBe("");
  });

  test("the placeholders the detectors and patterns put in are kept as they are", () => {
    expect(
      maskUnprovenWords("Charged <Credit card number> at <timestamp>"),
    ).toBe("Charged <Credit card number> at <timestamp>");
  });
});

/*
 * #11204: the reads of one line of code aligned - a word that differs
 * between them is a value, masked whatever it is - keep no more of the
 * words they share than one read does: a value every record holds reads
 * the same in each.
 */
describe("an aligned template keeps only the code's words too, however many reads share a word", () => {
  test("a lower-case value every read shares - a username - is masked", () => {
    expect(
      aligned([
        "Ticket assigned to jdoe with priority urgent",
        "Ticket assigned to jdoe with priority normal",
      ]),
    ).toEqual([
      "Ticket assigned to <value> with priority <value>",
      "Ticket assigned to <value> with priority <value>",
    ]);
  });

  test("a name written in lower case, an email's local part and a tenant every read shares are masked", () => {
    for (const reads of [
      [
        "Login failed for ottilie quarrington from mobile",
        "Login failed for ottilie quarrington from desktop",
      ],
      [
        "Mailbox jane.doe quota exceeded on primary",
        "Mailbox jane.doe quota exceeded on archive",
      ],
      [
        "Export finished for tenant northwind in region eu",
        "Export finished for tenant northwind in region us",
      ],
    ]) {
      for (const made of aligned(reads)) {
        expect(made).not.toMatch(/ottilie|quarrington|jane\.doe|northwind/);
        expect(made).toContain("<value>");
      }
    }
  });

  test("a word written as a person's name is masked, however many reads hold it", () => {
    expect(
      aligned([
        "Payment declined for Ada Lovelace: insufficient funds",
        "Payment declined for Ada Lovelace: card expired",
      ]),
    ).toEqual([
      "Payment declined for <value>: <value> <value>",
      "Payment declined for <value>: <value> <value>",
    ]);
  });

  test("a word that differs between reads is masked though it is one of the code's", () => {
    expect(aligned(["Order status pending", "Order status shipped"])).toEqual([
      "Order status <value>",
      "Order status <value>",
    ]);
  });

  test("the code's words every read shares - lower case, an identifier, a technology's name - are kept", () => {
    expect(
      aligned([
        "Calling Stripe API for customer jane.doe@northwind-mail.com",
        "Calling Stripe API for customer sam.lee@northwind-mail.com",
      ]),
    ).toEqual([
      `Calling Stripe API for customer ${toTypePlaceholder(namer.nameOf("email-address"))}`,
      `Calling Stripe API for customer ${toTypePlaceholder(namer.nameOf("email-address"))}`,
    ]);
    expect(
      aligned([
        "Error in PaymentService: timeout",
        "Error in PaymentService: refused",
      ]),
    ).toEqual([
      "Error in PaymentService: <value>",
      "Error in PaymentService: <value>",
    ]);
  });

  test("a line in another language keeps none of its words: no record proves them the code's", () => {
    expect(
      aligned(["Zahlung abgelehnt für jdoe", "Zahlung abgelehnt für asmith"]),
    ).toEqual(["", ""]);
  });

  test("a word at a sentence's start is read as the code writes one", () => {
    expect(
      maskUnprovenWords("Order <value> shipped. Notified the customer"),
    ).toBe("Order <value> shipped. Notified the customer");
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
    ["lower-case values without end", repeat("jdoe ")],
    ["half placeholders without end", repeat("<a")],
    ["placeholders without end", repeat("<value> ")],
    ["a camel case identifier without end", repeat("aB")],
    ["letters of another script without end", repeat("张")],
    ["spaces before a full stop without end", `a${" ".repeat(399_996)}.b`],
    ["a field's name before spaces without end", `"a"${" ".repeat(399_996)}`],
    ["opening brackets without end", `a ${repeat("(")}b`],
  ])("reads %s", (_label: string, text: string) => {
    const timed: FastestRun<number> = fastestRun({
      run: (): number => {
        return maskUnprovenWords(text).length;
      },
      limitInMs: LIMIT_IN_MS,
    });

    expect(timed.inMs).toBeLessThan(LIMIT_IN_MS);
  });
});
