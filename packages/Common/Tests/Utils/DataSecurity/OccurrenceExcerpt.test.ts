import { describe, expect, test } from "@jest/globals";
import {
  DataSecurityOccurrenceExcerpt,
  DataSecurityOccurrenceExcerptPart,
  DataSecurityOccurrenceExcerptPartKind,
} from "../../../Types/DataSecurity/DataSecurityApiTypes";
import { compileCustomDataType } from "../../../Utils/DataSecurity/CustomDataTypeDetector";
import {
  buildOccurrenceExcerpt,
  EXCERPT_CONTEXT_AFTER,
  EXCERPT_CONTEXT_BEFORE,
  maskSensitiveText,
  toReadableText,
} from "../../../Utils/DataSecurity/OccurrenceExcerpt";
import { ScanDetector } from "../../../Utils/DataSecurity/TextScanner";
import { generatedTexts } from "../../Helpers/GeneratedTexts";

/*
 * A RECORD'S VALUE, AROUND THE DATA A FINDING IS ABOUT, MASKED (issue
 * #9549).
 *
 * "Show maybe actual log lines where things are found and highlight
 * sections": a finding's records show the line itself, cut around the
 * finding's data, with that data masked and marked - and every other
 * sensitive value in it masked too, so no raw value of any kind is drawn.
 */

const Text: DataSecurityOccurrenceExcerptPartKind =
  DataSecurityOccurrenceExcerptPartKind.Text;
const Match: DataSecurityOccurrenceExcerptPartKind =
  DataSecurityOccurrenceExcerptPartKind.Match;
const Masked: DataSecurityOccurrenceExcerptPartKind =
  DataSecurityOccurrenceExcerptPartKind.Masked;

const EMAIL: string = "jane.doe@acme-corp.com";
const CARD: string = "4539 1488 0343 6467";
const IP: string = "34.120.7.19";
const GITHUB_TOKEN: string = [
  "ghp",
  "R8sK2mQ9vX4tL7wN1pZ6cB3yH5jD0fG2aE8u",
].join("_");

function excerptOf(
  value: string,
  dataTypeId: string,
  location: string = "body",
): DataSecurityOccurrenceExcerpt {
  return buildOccurrenceExcerpt({ value, dataTypeId, location });
}

function asText(excerpt: DataSecurityOccurrenceExcerpt): string {
  return (
    (excerpt.isCutAtStart ? "…" : "") +
    excerpt.parts
      .map((part: DataSecurityOccurrenceExcerptPart): string => {
        return part.kind === Text
          ? part.text
          : part.kind === Match
            ? `[${part.text}]`
            : `{${part.text}}`;
      })
      .join("") +
    (excerpt.isCutAtEnd ? "…" : "")
  );
}

describe("the line around the finding's data", () => {
  test("a short log line is shown whole, the data masked and marked", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = excerptOf(
      `Ping to ${IP} succeeded in 120 ms`,
      "ip-address",
    );

    expect(excerpt.parts).toEqual([
      { kind: Text, text: "Ping to " },
      { kind: Match, text: "34.***.***.***" },
      { kind: Text, text: " succeeded in 120 ms" },
    ]);
    expect(excerpt.isCutAtStart).toBe(false);
    expect(excerpt.isCutAtEnd).toBe(false);
    expect(excerpt.field).toBeUndefined();
  });

  test("every place the line holds it is marked", () => {
    expect(
      asText(
        excerptOf(
          `Charge failed for ${CARD}, retried with 4111 1111 1111 1111 then ${CARD}`,
          "credit-card-number",
        ),
      ),
    ).toBe(
      "Charge failed for [**** **** **** 6467], retried with {**** **** **** 1111} then [**** **** **** 6467]",
    );
  });

  test("other sensitive data beside it is masked too, never drawn as it is", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = excerptOf(
      `user ${EMAIL} from ${IP} pushed with token ${GITHUB_TOKEN}`,
      "ip-address",
    );
    const drawn: string = asText(excerpt);

    expect(drawn).toBe(
      "user {j***@a********.com} from [34.***.***.***] pushed with token {ghp_************aE8u}",
    );
    expect(drawn).not.toContain(EMAIL);
    expect(drawn).not.toContain(GITHUB_TOKEN);
    expect(drawn).not.toContain(IP);
    // Masked, but not marked: the excerpt is about the IP address.
    expect(
      excerpt.parts
        .filter((part: DataSecurityOccurrenceExcerptPart): boolean => {
          return part.kind === Masked;
        })
        .map((part: DataSecurityOccurrenceExcerptPart): string => {
          return part.text;
        }),
    ).toEqual(["j***@a********.com", "ghp_************aE8u"]);
  });

  test("a long value is cut around the first place it holds the data, at word edges", () => {
    const before: string = "word ".repeat(60);
    const after: string = " more".repeat(80);
    const excerpt: DataSecurityOccurrenceExcerpt = excerptOf(
      `${before}contact ${EMAIL}${after}`,
      "email-address",
    );
    const text: string = excerpt.parts
      .map((part: DataSecurityOccurrenceExcerptPart): string => {
        return part.text;
      })
      .join("");

    expect(excerpt.isCutAtStart).toBe(true);
    expect(excerpt.isCutAtEnd).toBe(true);
    expect(text.indexOf("j***@a********.com")).toBeLessThanOrEqual(
      EXCERPT_CONTEXT_BEFORE,
    );
    expect(text.length).toBeLessThan(
      EXCERPT_CONTEXT_BEFORE + EXCERPT_CONTEXT_AFTER + 40,
    );
    // Whole words at both ends.
    expect(text.startsWith("word ") || text.startsWith("contact")).toBe(true);
    expect(text.endsWith("more")).toBe(true);
  });

  test("an edge never falls inside a sensitive value: it is taken whole, masked", () => {
    /*
     * A long address where the cut before the card falls, seven characters
     * in, with no space near enough to move the cut to.
     */
    const address: string = "jane.doe.from.the.accounts.team@acme-corp.com";
    const padding: string = "x".repeat(35);
    const value: string = `${address} ${padding} card ${CARD} end`;

    expect(value.indexOf(CARD) - EXCERPT_CONTEXT_BEFORE).toBe(7);

    const excerpt: DataSecurityOccurrenceExcerpt = excerptOf(
      value,
      "credit-card-number",
    );
    const drawn: string = asText(excerpt);

    expect(excerpt.isCutAtStart).toBe(false);
    expect(drawn.startsWith("{j***@a********.com}")).toBe(true);
    expect(drawn).not.toContain("accounts.team");
    expect(drawn).toContain("[**** **** **** 6467]");
  });

  test("the record's own text loses its control characters and terminal colours", () => {
    expect(
      asText(
        excerptOf(
          `\u001b[32mINFO\u001b[0m\tlogin from ${IP}\r\nnext\u0000 line`,
          "ip-address",
        ),
      ),
    ).toBe("INFO\tlogin from [34.***.***.***]\nnext line");
    expect(toReadableText("a\rb\r\nc\u007fd\u001b[1;31me")).toBe("a\nb\ncde");
  });

  test("a test value, or a value the project allows, is not marked as the data", () => {
    const allowed: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: `notify ${EMAIL} and kai.wu@acme-corp.com`,
      dataTypeId: "email-address",
      location: "body",
      options: { allowedValues: new Set([EMAIL]) },
    });

    // The allowed one is still masked, as any sensitive value is.
    expect(asText(allowed)).toBe(
      "notify {j***@a********.com} and [k***@a********.com]",
    );
  });
});

describe("a value that is the data whole", () => {
  test("a field found by its name - a first name - is the whole value, masked", () => {
    expect(
      buildOccurrenceExcerpt({
        value: "Alice",
        dataTypeId: "person-name",
        location: "attributes.user.first_name",
        field: "user.first_name",
      }),
    ).toEqual({
      field: "user.first_name",
      parts: [{ kind: Match, text: "A****" }],
      isCutAtStart: false,
      isCutAtEnd: false,
    });
  });

  test("a value found by its field's shape - a cvv field's three digits - is masked whole", () => {
    expect(
      asText(
        buildOccurrenceExcerpt({
          value: " 123 ",
          dataTypeId: "card-verification-code",
          location: "attributes.card.cvv",
          field: "card.cvv",
        }),
      ),
    ).toBe("[*23]");
  });

  test("a span event's attribute names its event and its key", () => {
    const excerpt: DataSecurityOccurrenceExcerpt = buildOccurrenceExcerpt({
      value: GITHUB_TOKEN,
      dataTypeId: "github-token",
      location: "events.login.token",
      field: "token",
      event: "login",
    });

    expect(excerpt.event).toBe("login");
    expect(excerpt.field).toBe("token");
    expect(asText(excerpt)).toBe("[ghp_************aE8u]");
  });
});

describe("a project's own data type", () => {
  test("is found with its own detector, and marked", () => {
    const employee: ScanDetector | null = compileCustomDataType({
      dataTypeId: "custom:employee",
      pattern: "EMP-[0-9]{6}",
    });

    expect(
      asText(
        buildOccurrenceExcerpt({
          value: "Badge EMP-123456 scanned at door 4",
          dataTypeId: "custom:employee",
          location: "body",
          options: { customDetectors: [employee!] },
        }),
      ),
    ).toBe("Badge [***-**3456] scanned at door 4");
  });
});

describe("whatever the value", () => {
  test("no part is empty, the parts read in order, and nothing the detectors find is drawn raw", () => {
    const texts: Array<string> = generatedTexts(300, 9549, [
      " ",
      "a",
      "Z",
      "0",
      "7",
      ".",
      "@",
      "-",
      "\n",
      "é",
      "\u{1F600}",
    ]);

    for (const noise of texts) {
      const value: string = `${noise} ${EMAIL} ${noise}`;
      const excerpt: DataSecurityOccurrenceExcerpt = excerptOf(
        value,
        "email-address",
      );

      for (const part of excerpt.parts) {
        expect(part.text.length).toBeGreaterThan(0);
      }

      expect(asText(excerpt)).not.toContain(EMAIL);
      expect(
        excerpt.parts.some(
          (part: DataSecurityOccurrenceExcerptPart): boolean => {
            return part.kind === Match;
          },
        ),
      ).toBe(true);
      // Never half a character beyond U+FFFF.
      expect(asText(excerpt)).not.toMatch(
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/,
      );
    }
  });
});

/*
 * A SHORT TEXT THAT NAMES A RECORD, MASKED (issue #9604): a metric's name
 * is shown with every sensitive value in it masked, and says whether
 * anything was - a name with nothing masked is a key, which may open the
 * metrics explorer.
 */
describe("a record's name", () => {
  test("with nothing sensitive in it, as written, and a key", () => {
    expect(maskSensitiveText("http.server.request.duration")).toEqual({
      text: "http.server.request.duration",
      isMasked: false,
    });
  });

  test("every sensitive value in it masked, of any type, and no key", () => {
    const masked: { text: string; isMasked: boolean } = maskSensitiveText(
      "logins/jane.doe@acme-corp.com/from/81.2.69.160",
    );

    expect(masked.isMasked).toBe(true);
    expect(masked.text).toBe("logins/j***@a********.com/from/81.***.***.***");
  });

  test("a project's own type, and control characters taken out", () => {
    const loyalty: ScanDetector = compileCustomDataType({
      dataTypeId: "custom:loyalty",
      pattern: "LOY-[0-9]{6}",
    })!;

    expect(
      maskSensitiveText("orders.LOY-123456.total", {
        customDetectors: [loyalty],
      }).isMasked,
    ).toBe(true);
    expect(maskSensitiveText("orders.LOY-123456.total").isMasked).toBe(false);
    expect(maskSensitiveText("queue\u001b[31m.depth\u0007").text).toBe(
      "queue.depth",
    );
  });
});
