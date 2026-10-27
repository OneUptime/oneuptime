import SqlResultShaper from "../../Server/Utils/DataSource/SqlResultShaper";
import {
  redactDsns,
  redactPasswordSettings,
} from "../../Utils/DatabaseErrorRedaction";
import { generatedTexts } from "../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A DATABASE'S ERROR MESSAGE IS READ IN TIME IN LINE WITH ITS LENGTH, AND
 * LOSES EXACTLY THE CREDENTIALS IT LOST BEFORE.
 *
 * The message is whatever the database - or a server pretending to be one -
 * sent back, and a data source (on the server) and a SQL or database
 * monitor (on a probe, a shared one too) redact it before anyone sees it: a
 * connection address that carries a login, and a password setting of a
 * connection string. Each was a pattern that read the rest of the message
 * again from every place a match could start, so a long message of the
 * right shape held up the server or the probe; each is now read once, and
 * replaces exactly what the pattern replaced.
 * ---------------------------------------------------------------------------
 */

const LENGTH: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

// The patterns as they were: the reference each reader must agree with.
const DSN_BEFORE: RegExp = /[a-zA-Z]+:\/\/[^\s]*@[^\s]*/g;
const PASSWORD_BEFORE: RegExp =
  /(password|pwd)\s*[=:]\s*(\{[^}]*\}|"[^"]*"|'[^']*'|[^;\r\n]+)/gi;

const dsnsBefore: (text: string) => string = (text: string): string => {
  return text.replace(
    new RegExp(DSN_BEFORE.source, DSN_BEFORE.flags),
    "[redacted-dsn]",
  );
};

const passwordsBefore: (text: string) => string = (text: string): string => {
  return text.replace(
    new RegExp(PASSWORD_BEFORE.source, PASSWORD_BEFORE.flags),
    "$1=***",
  );
};

const WORST_CASES: Array<[string, string]> = [
  ["schemes run together", repeat("A://", LENGTH) + "\tA://@"],
  ["one long run of letters", "x " + repeat("a", LENGTH)],
  ["schemes and slashes", repeat("ab://cd", LENGTH) + " end"],
  ["a brace with no closing one, line after line", repeat("pwd={\n", LENGTH)],
  ["a name and white space, line after line", repeat("password=  \n", LENGTH)],
  ["quotes with no closing one", repeat("pwd=\"\npwd='\n", LENGTH)],
  ["names and separators only", repeat("pwd:", LENGTH)],
  ["white space after a separator", "pwd=" + repeat(" \t", LENGTH) + ";"],
];

describe("a database's error message is read in time in line with its length", () => {
  test.each(WORST_CASES)(
    "connection addresses: %s",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactDsns(text, "[redacted-dsn]");
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  test.each(WORST_CASES)(
    "password settings: %s",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          redactPasswordSettings(text);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );

  // The real path: a data source's driver error, on its way to an API response.
  test.each(WORST_CASES)(
    "a data source's error: %s",
    (_label: string, text: string) => {
      const timed: FastestRun<void> = fastestRun({
        run: (): void => {
          SqlResultShaper.sanitizeError(new Error(text), ["hunter2"]);
        },
        limitInMs: 2000,
      });

      expect(timed.inMs).toBeLessThan(2000);
    },
  );
});

describe("the credentials are found where they were found before", () => {
  test("a connection address with a login, in a sentence", () => {
    expect(
      redactDsns(
        "could not connect to postgres://user:pw@db.example.com:5432/prod now",
        "[redacted-dsn]",
      ),
    ).toBe("could not connect to [redacted-dsn] now");
  });

  test("what a run holds before the scheme stays, the rest of the run goes", () => {
    expect(redactDsns("(url=mysql://root:x@h/db),next", "[R]")).toBe(
      "(url=[R]",
    );
    expect(redactDsns("1abc://u@h", "[R]")).toBe("1[R]");
  });

  test("an address with no login, or a login with no address, stays", () => {
    expect(redactDsns("see https://example.com/docs", "[R]")).toBe(
      "see https://example.com/docs",
    );
    expect(redactDsns("user@example.com failed", "[R]")).toBe(
      "user@example.com failed",
    );
    expect(redactDsns("://u@h", "[R]")).toBe("://u@h");
  });

  test("each address of a message, separately", () => {
    expect(redactDsns("a://u@h b c://v@i", "[R]")).toBe("[R] b [R]");
  });

  test("a password setting, in every way it is written", () => {
    expect(
      redactPasswordSettings("Login failed; password=hunter2; host=db"),
    ).toBe("Login failed; password=***; host=db");
    expect(redactPasswordSettings("PWD={a;b};Server=db")).toBe(
      "PWD=***;Server=db",
    );
    expect(redactPasswordSettings("pwd: 'secr3t!' rejected")).toBe(
      "pwd=*** rejected",
    );
    expect(redactPasswordSettings('Password : "two words"!')).toBe(
      "Password=***!",
    );
  });

  test("a braced value with no closing brace runs to the end of its line", () => {
    expect(redactPasswordSettings("pwd={open\nnext")).toBe("pwd=***\nnext");
  });

  test("white space before a ';' is given back, as the pattern gave it back", () => {
    // The last space becomes the value, so the setting is still replaced.
    expect(redactPasswordSettings("password=  ;x")).toBe("password=***;x");
    expect(passwordsBefore("password=  ;x")).toBe("password=***;x");

    // Line breaks cannot be a value: nothing is replaced.
    expect(redactPasswordSettings("password=\n\n;x")).toBe("password=\n\n;x");
    expect(passwordsBefore("password=\n\n;x")).toBe("password=\n\n;x");
  });
});

/*
 * On texts drawn from alphabets of the pieces each pattern reacts to, every
 * reader replaces exactly what its pattern replaced.
 */
const DSN_ALPHABET: ReadonlyArray<string> = [
  "a",
  "Z",
  "1",
  "_",
  ":",
  "/",
  "//",
  "://",
  "://",
  "@",
  "@",
  " ",
  "\t",
  "\n",
  "-",
  "é",
  "postgres",
  "x://",
  "A://u@h",
];

const PASSWORD_ALPHABET: ReadonlyArray<string> = [
  "pwd",
  "PWD",
  "password",
  "PassWord",
  "pw",
  "d",
  "=",
  ":",
  " ",
  "  ",
  "\t",
  "\n",
  "\r",
  ";",
  "{",
  "}",
  '"',
  "'",
  "a",
  "b c",
  "\u00a0",
  "x",
];

interface Mismatch {
  text: string;
  now: string;
  before: string;
}

describe("each reader replaces exactly what its pattern replaced", () => {
  test("connection addresses, on forty thousand drawn texts", () => {
    const mismatches: Array<Mismatch> = [];
    let replaced: number = 0;

    for (const text of generatedTexts(40000, 5150, DSN_ALPHABET, 16)) {
      const before: string = dsnsBefore(text);
      const now: string = redactDsns(text, "[redacted-dsn]");

      if (before !== text) {
        replaced++;
      }

      if (now !== before) {
        mismatches.push({ text, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(replaced).toBeGreaterThan(5000);
  });

  test("password settings, on forty thousand drawn texts", () => {
    const mismatches: Array<Mismatch> = [];
    let replaced: number = 0;

    for (const text of generatedTexts(40000, 6160, PASSWORD_ALPHABET, 16)) {
      const before: string = passwordsBefore(text);
      const now: string = redactPasswordSettings(text);

      if (before !== text) {
        replaced++;
      }

      if (now !== before) {
        mismatches.push({ text, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
    expect(replaced).toBeGreaterThan(2000);
  });

  test("a data source's whole sanitizing, on twenty thousand drawn messages", () => {
    const mismatches: Array<Mismatch> = [];

    for (const text of generatedTexts(
      20000,
      7170,
      [...DSN_ALPHABET, ...PASSWORD_ALPHABET],
      20,
    )) {
      const before: string = passwordsBefore(dsnsBefore(text));
      const now: string = SqlResultShaper.sanitizeError(new Error(text), []);

      if (now !== before) {
        mismatches.push({ text, now, before });
      }
    }

    expect(mismatches.slice(0, 5)).toEqual([]);
  });
});
