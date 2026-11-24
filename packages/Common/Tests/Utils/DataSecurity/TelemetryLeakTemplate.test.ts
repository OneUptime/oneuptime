import { describe, expect, test } from "@jest/globals";
import { MAX_TELEMETRY_LEAK_TEMPLATE_LENGTH } from "../../../Types/DataSecurity/TelemetryLeakFix";
import DataTypeNamer from "../../../Types/DataSecurity/DataTypeNamer";
import {
  TelemetryLeakTemplateOptions,
  VALUE_PLACEHOLDER,
  alignTelemetryLeakTemplates,
  buildTelemetryLeakTemplate,
  splitTemplateWords,
  toTypePlaceholder,
} from "../../../Utils/DataSecurity/TelemetryLeakTemplate";

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

  test("one read alone, or reads that agree, stay as they are", () => {
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
