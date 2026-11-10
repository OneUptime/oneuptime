import ToolResultSerializer, {
  REDACTION_PLACEHOLDERS,
  SECURITY_OBSERVABLE_RULE_NAMES,
} from "../../../../../Server/Utils/AI/Toolbox/Serializer";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * ISSUE #6364: THE PLACEHOLDERS REDACTION WRITES, AS A CODE CHANGE IS HELD
 * TO THEM.
 *
 * A code change Ask AI writes whole is checked for the placeholders the
 * serializer showed it in place of hidden values (CodeFilesSeen). So the
 * list it checks for is every placeholder a rule writes - read here from
 * the serializer's own source, so a rule added without its placeholder
 * fails - each distinct, none inside another, and each written by its
 * rule. And what the rules make of a text is pinned, byte for byte: the
 * model reads exactly what it read before.
 */

const SERIALIZER: string = path.join(
  __dirname,
  "../../../../../Server/Utils/AI/Toolbox/Serializer.ts",
);

// Every "[redacted...]" the serializer's source spells out.
const placeholdersInSource: () => Array<string> = (): Array<string> => {
  const source: string = fs.readFileSync(SERIALIZER, "utf8");
  const found: Set<string> = new Set<string>();
  let at: number = source.indexOf("[redacted");

  while (at !== -1) {
    const end: number = source.indexOf("]", at);
    found.add(source.slice(at, end + 1));
    at = source.indexOf("[redacted", at + 1);
  }

  return Array.from(found);
};

// A value each rule hides, and what it reads as once hidden.
const SAMPLES: Array<[string, string, string]> = [
  [
    "jwt",
    "token eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U",
    "token [redacted-jwt]",
  ],
  [
    "bearer",
    "auth Bearer abcdefghijklmnopqrstuvwxyz0123",
    "auth Bearer [redacted-token]",
  ],
  [
    "private-key",
    "key:\n-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAAKCAQEA\n-----END RSA PRIVATE KEY-----\ndone",
    "key:\n[redacted-private-key]\ndone",
  ],
  ["aws-access-key-id", "id AKIAIOSFODNN7EXAMPLE", "id [redacted-aws-key]"],
  [
    "github-token",
    "gh ghp_abcdefghijklmnopqrstuvwxyz0123456789",
    "gh [redacted-github-token]",
  ],
  [
    "slack-token",
    "slack xoxb-1234567890-abcdefghij",
    "slack [redacted-slack-token]",
  ],
  [
    "google-api-key",
    "maps AIzaSyA1234567890abcdefghijklmnopqrstuv",
    "maps [redacted-google-api-key]",
  ],
  ["email", "to ops@acme.com", "to [redacted-email]"],
  ["ipv4", "host 10.0.0.12", "host [redacted-ip]"],
  ["credit-card", "card 4111 1111 1111 1111", "card [redacted-card]"],
  [
    "hex-secret",
    "digest 9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
    "digest [redacted-hex]",
  ],
  ["key-value-secret", 'password = "hunter22"', "password = [redacted]"],
];

describe("the placeholders a code change is held to", () => {
  test("are every placeholder the serializer writes, read from its source", () => {
    expect([...REDACTION_PLACEHOLDERS].sort()).toEqual(
      placeholdersInSource().sort(),
    );
  });

  test("are distinct, bracketed, one line, and none holds another", () => {
    expect(new Set(REDACTION_PLACEHOLDERS).size).toBe(
      REDACTION_PLACEHOLDERS.length,
    );

    for (const placeholder of REDACTION_PLACEHOLDERS) {
      expect(placeholder.startsWith("[redacted")).toBe(true);
      expect(placeholder.endsWith("]")).toBe(true);
      expect(placeholder).not.toContain("\n");
      // One "[" and one "]": no placeholder can start inside another.
      expect(placeholder.split("[")).toHaveLength(2);
      expect(placeholder.split("]")).toHaveLength(2);

      for (const other of REDACTION_PLACEHOLDERS) {
        if (other !== placeholder) {
          expect({ placeholder, holds: placeholder.includes(other) }).toEqual({
            placeholder,
            holds: false,
          });
        }
      }
    }
  });

  test("one for each rule, in the rules' order", () => {
    expect(REDACTION_PLACEHOLDERS).toEqual([
      "[redacted-jwt]",
      "[redacted-token]",
      "[redacted-private-key]",
      "[redacted-aws-key]",
      "[redacted-github-token]",
      "[redacted-slack-token]",
      "[redacted-google-api-key]",
      "[redacted-email]",
      "[redacted-ip]",
      "[redacted-card]",
      "[redacted-hex]",
      "[redacted]",
    ]);
    expect(SAMPLES).toHaveLength(REDACTION_PLACEHOLDERS.length);
  });
});

describe("each rule writes its placeholder, and the model reads what it always read", () => {
  test.each(SAMPLES)("%s", (_rule: string, text: string, redacted: string) => {
    const result: { text: string; count: number } =
      ToolResultSerializer.redact(text);

    expect(result.text).toBe(redacted);
    expect(result.count).toBe(1);
    expect(
      REDACTION_PLACEHOLDERS.filter((placeholder: string): boolean => {
        return redacted.includes(placeholder);
      }),
    ).toHaveLength(1);
  });

  test("a security result keeps its observables, and hides the same secrets", () => {
    const text: string = SAMPLES.map(
      (sample: [string, string, string]): string => {
        return sample[1];
      },
    ).join("\n");
    const kept: string = ToolResultSerializer.redact(text, {
      keepSecurityObservables: true,
    }).text;

    expect(SECURITY_OBSERVABLE_RULE_NAMES).toEqual([
      "email",
      "ipv4",
      "hex-secret",
    ]);
    expect(kept).toContain("ops@acme.com");
    expect(kept).toContain("10.0.0.12");
    expect(kept).toContain("[redacted-github-token]");
    expect(kept).not.toContain("[redacted-ip]");
  });
});
