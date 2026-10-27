import { describe, expect, test } from "@jest/globals";
import { scrubSecretsFromText } from "../../API/AdminHealthProbes";
import { FastestRun, fastestRun } from "Common/Tests/Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * THE HEALTH PAGE'S SECRET SCRUB READS A TEXT IN TIME IN LINE WITH ITS
 * LENGTH, AND MASKS WHAT IT MASKED BEFORE.
 *
 * scrubSecretsFromText runs over the failed jobs' messages and stacks and
 * the log lines the instance health page shows - text that quotes what
 * requests and jobs carried. The password of a connection string is looked
 * for from a scheme of at most 64 characters, and a JWT once per run of the
 * characters it is made of, so 400,000 characters of the most awkward text
 * are read in well under two seconds - and every password and token is
 * still masked, the text around it as it was.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

describe("scrubSecretsFromText reads a long text in time in line with its length", () => {
  test.each([
    ["letters", repeat("a", LENGTH)],
    ["letters and dots", repeat("a.", LENGTH)],
    ["a scheme and a user with no password", "a://" + repeat("b", LENGTH)],
    [
      "a scheme, a user and a password with no end",
      "a://b:" + repeat("c", LENGTH),
    ],
    ["token starts between hyphens", repeat("-eyJ-", LENGTH)],
    ["short token starts after hyphens", repeat("eyJab-", LENGTH)],
    ["token starts run together", repeat("eyJ", LENGTH)],
  ])("%s", (_label: string, text: string) => {
    const timed: FastestRun<void> = fastestRun({
      run: (): void => {
        scrubSecretsFromText(text);
      },
      limitInMs: 2000,
    });

    expect(timed.inMs).toBeLessThan(2000);
  });
});

describe("scrubSecretsFromText masks what it masked before", () => {
  const TOKEN: string =
    "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";

  test.each([
    [
      "a connection string's password",
      "connect postgres://oneuptime:hunter2@db:5432/x failed",
      "connect postgres://oneuptime:***REDACTED***@db:5432/x failed",
    ],
    [
      "a password holding an @",
      "mongodb+srv://admin:p@ss@cluster0.example.net/db",
      "mongodb+srv://admin:***REDACTED***@cluster0.example.net/db",
    ],
    [
      "a scheme glued to the text before it",
      "url=1postgres://u:secret@h/db",
      "url=1postgres://u:***REDACTED***@h/db",
    ],
    [
      "a long run of letters before the scheme",
      `${"x".repeat(100)}postgres://u:secret@h/db`,
      `${"x".repeat(100)}postgres://u:***REDACTED***@h/db`,
    ],
    ["a token", `jwt ${TOKEN} rejected`, "jwt ***REDACTED-JWT*** rejected"],
    [
      "a token after a hyphen",
      `session-${TOKEN} rejected`,
      "session-***REDACTED-JWT*** rejected",
    ],
    [
      "two tokens",
      `${TOKEN},${TOKEN}`,
      "***REDACTED-JWT***,***REDACTED-JWT***",
    ],
    [
      "a token with a header of kilobytes",
      `t=${"eyJ" + "x5cMIIC".repeat(700)}.eyJzdWIiOiIxIn0.abc123 end`,
      "t=***REDACTED-JWT*** end",
    ],
  ])("%s", (_label: string, text: string, masked: string) => {
    expect(scrubSecretsFromText(text)).toBe(masked);
  });
});
