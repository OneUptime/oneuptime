import Hostname from "../../Types/API/Hostname";
import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import Color from "../../Types/Color";
import OneUptimeDate from "../../Types/Date";
import Domain from "../../Types/Domain";
import Email from "../../Types/Email";
import ObjectID from "../../Types/ObjectID";
import Phone from "../../Types/Phone";
import {
  MAX_REFUSED_VALUE_LENGTH,
  REFUSED_VALUE_CUT_MARK,
  refusedValue,
} from "../../Utils/RefusedValue";
import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../Helpers/FastestRun";

/*
 * ---------------------------------------------------------------------------
 * A VALIDATOR REPEATS AT MOST A FEW WORDS OF WHAT IT REFUSES.
 *
 * "Email x is not in valid format." tells whoever typed x what went wrong,
 * and the message goes back with the error and into the server's log. A
 * value can be as long as the request that carried it, so each validator
 * now repeats its first 80 characters and "…" - never the whole of a value
 * of any length. A value of 80 characters or fewer reads as it always did.
 * ---------------------------------------------------------------------------
 */

const LONG: number = 400000;

const repeat: (unit: string, length: number) => string = (
  unit: string,
  length: number,
): string => {
  return unit.repeat(Math.ceil(length / unit.length)).slice(0, length);
};

const messageOf: (run: () => unknown) => string = (
  run: () => unknown,
): string => {
  try {
    run();
  } catch (error: unknown) {
    return (error as Error).message;
  }

  throw new Error("expected the value to be refused");
};

describe("refusedValue", () => {
  test("a value up to the limit is repeated whole", () => {
    expect(refusedValue("abc")).toBe("abc");
    expect(refusedValue(repeat("a", MAX_REFUSED_VALUE_LENGTH))).toBe(
      repeat("a", MAX_REFUSED_VALUE_LENGTH),
    );
    expect(MAX_REFUSED_VALUE_LENGTH).toBe(80);
  });

  test("a longer value is cut at the limit and marked", () => {
    expect(refusedValue(repeat("a", MAX_REFUSED_VALUE_LENGTH + 1))).toBe(
      repeat("a", MAX_REFUSED_VALUE_LENGTH) + REFUSED_VALUE_CUT_MARK,
    );
    expect(refusedValue(repeat("b", LONG))).toHaveLength(
      MAX_REFUSED_VALUE_LENGTH + REFUSED_VALUE_CUT_MARK.length,
    );
  });

  test("never half of an astral character", () => {
    const astral: string = String.fromCodePoint(0x1f600);
    const value: string =
      repeat("a", MAX_REFUSED_VALUE_LENGTH - 1) + astral + "tail";

    expect(refusedValue(value)).toBe(
      repeat("a", MAX_REFUSED_VALUE_LENGTH - 1) + REFUSED_VALUE_CUT_MARK,
    );
  });

  test("a value that is not text reads as it did in a template", () => {
    expect(refusedValue(42)).toBe("42");
    expect(refusedValue(undefined)).toBe("undefined");
    expect(refusedValue(null)).toBe("null");
    expect(refusedValue({ a: 1 })).toBe("[object Object]");
  });

  test("a value that cannot be read as text is not repeated", () => {
    const unreadable: unknown = {
      toString: (): string => {
        throw new Error("no");
      },
    };

    expect(refusedValue(unreadable)).toBe("");
  });
});

/*
 * Every validator that repeats what it refused, given a value as long as a
 * request: its message stays short, starts the way it always did, and is
 * read in well under two seconds.
 */
const SHORT_MESSAGE: number = 300;

describe.each([
  [
    "an email address",
    () => {
      return new Email(repeat("a", LONG));
    },
    "Email aaaa",
  ],
  [
    "a stored email address that is not text",
    () => {
      return Email.fromDatabase(repeat("a", LONG).split("") as never);
    },
    "Email a,a,",
  ],
  [
    "a phone number",
    () => {
      return new Phone(repeat("1", LONG));
    },
    "Phone is not in valid format: 1111",
  ],
  [
    "a domain",
    () => {
      return new Domain(repeat("a.", LONG));
    },
    "Domain a.a.",
  ],
  [
    "a host name",
    () => {
      return new Hostname(repeat("-", LONG));
    },
    "Hostname ----",
  ],
  [
    "a URL's phone number",
    () => {
      return URL.fromString("tel:" + repeat("a", LONG));
    },
    "Phone number aaaa",
  ],
  [
    "a URL's scheme",
    () => {
      return URL.fromString(repeat("f", LONG) + "://x.example.com");
    },
    "URL scheme ffff",
  ],
  [
    "an ID",
    () => {
      return ObjectID.validateUUID(repeat("z", LONG));
    },
    'Invalid ID format: "zzzz',
  ],
  [
    "a colour",
    () => {
      return Color.colorToRgb(new Color(repeat("#", LONG)));
    },
    "Invalid color: ####",
  ],
  [
    "a route",
    () => {
      return new Route(repeat("^", LONG));
    },
    "Invalid route: ^^^^",
  ],
  [
    "a date",
    () => {
      return OneUptimeDate.fromString({ value: repeat("x", LONG) } as never);
    },
    "Invalid date: [object Object]",
  ],
])(
  "%s that is refused repeats only the start of the value",
  (_label: string, refuse: () => unknown, start: string) => {
    test("in a short message, quickly", () => {
      const timed: FastestRun<string> = fastestRun({
        run: (): string => {
          return messageOf(refuse);
        },
        limitInMs: 2000,
      });
      const message: string = timed.result;

      expect(timed.inMs).toBeLessThan(2000);
      expect(message.startsWith(start)).toBe(true);
      expect(message.length).toBeLessThan(SHORT_MESSAGE);
    });
  },
);

describe("a short refused value reads as it always did", () => {
  test.each([
    [
      "an email address",
      () => {
        return new Email("not an email");
      },
      "Email not an email is not in valid format.",
    ],
    [
      "a phone number",
      () => {
        return new Phone("278@$90>");
      },
      "Phone is not in valid format: 278@$90>",
    ],
    [
      "a URL's phone number",
      () => {
        return URL.fromString("tel:abc");
      },
      "Phone number abc is not in valid format.",
    ],
    [
      "a URL's scheme",
      () => {
        return URL.fromString("ftp://files.example.com/x");
      },
      "URL scheme ftp: is not supported.",
    ],
    [
      "an ID",
      () => {
        return ObjectID.validateUUID("not-a-uuid");
      },
      'Invalid ID format: "not-a-uuid". Expected a valid UUID (e.g., "550e8400-e29b-41d4-a716-446655440000").',
    ],
  ])("%s", (_label: string, refuse: () => unknown, message: string) => {
    expect(messageOf(refuse)).toBe(message);
  });
});
