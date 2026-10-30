import {
  EXCEPTION_USER_ID_ATTRIBUTE_KEYS,
  ExceptionAttributeBag,
  MAX_EXCEPTION_USER_ID_LENGTH,
  RESOURCE_ATTRIBUTE_PREFIX,
  readExceptionUserId,
  toExceptionUserId,
} from "../../../Utils/Exceptions/ExceptionUserId";
import { SeededRandom, seededRandom } from "../../Helpers/SeededRandom";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import { describe, expect, test } from "@jest/globals";

/*
 * Who an exception's occurrence happened to: the first of user.id,
 * enduser.id and enduser.pseudo.id it carries, on the exception event, then
 * on its span or log record, then on its resource. The exceptions list
 * counts the distinct values as the row's affected users.
 */

describe("the attributes that name a user", () => {
  test("are the user id keys of the OpenTelemetry conventions, user.id first", () => {
    expect([...EXCEPTION_USER_ID_ATTRIBUTE_KEYS]).toEqual([
      "user.id",
      "enduser.id",
      "enduser.pseudo.id",
    ]);
  });

  test("an email, a name, a session or a role is not a user id", () => {
    expect(
      readExceptionUserId([
        {
          "user.email": "ana@example.com",
          "user.name": "ana",
          "enduser.email": "ana@example.com",
          "session.id": "0af7651916cd43dd8448eb211c80319c",
          "enduser.role": "admin",
        },
      ]),
    ).toBe("");
  });

  test("each key is read on the bag, and under resource. for the resource", () => {
    for (const key of EXCEPTION_USER_ID_ATTRIBUTE_KEYS) {
      expect(readExceptionUserId([{ [key]: "u-1" }])).toBe("u-1");
      expect(
        readExceptionUserId([
          { [`${RESOURCE_ATTRIBUTE_PREFIX}${key}`]: "u-2" },
        ]),
      ).toBe("u-2");
    }
  });
});

describe("which one wins", () => {
  test("on one bag, the keys in their order", () => {
    expect(
      readExceptionUserId([
        { "enduser.pseudo.id": "pseudo", "enduser.id": "end", "user.id": "u" },
      ]),
    ).toBe("u");
    expect(
      readExceptionUserId([
        { "enduser.pseudo.id": "pseudo", "enduser.id": "end" },
      ]),
    ).toBe("end");
  });

  test("the exception event's own before its span's", () => {
    expect(
      readExceptionUserId([{ "enduser.id": "event" }, { "user.id": "span" }]),
    ).toBe("event");
  });

  test("the span's own before any resource attribute, the event's resource keys included", () => {
    expect(
      readExceptionUserId([
        { "resource.user.id": "event-resource" },
        { "enduser.pseudo.id": "span" },
      ]),
    ).toBe("span");
  });

  test("the resource only when no bag names a user of its own", () => {
    expect(
      readExceptionUserId([{}, { "resource.enduser.id": "process-user" }]),
    ).toBe("process-user");
  });

  test("an empty or blank value is passed over, not taken", () => {
    expect(
      readExceptionUserId([
        { "user.id": "", "enduser.id": "   " },
        { "user.id": "real" },
      ]),
    ).toBe("real");
  });

  test("missing bags are passed over", () => {
    expect(readExceptionUserId([null, undefined, { "user.id": "u" }])).toBe(
      "u",
    );
    expect(readExceptionUserId([])).toBe("");
  });
});

describe("a value as a user id", () => {
  test("a string is trimmed", () => {
    expect(toExceptionUserId("  user-42 \n")).toBe("user-42");
  });

  test("a number is its digits", () => {
    expect(toExceptionUserId(42)).toBe("42");
    expect(readExceptionUserId([{ "enduser.id": 7 }])).toBe("7");
  });

  test("anything else names nobody", () => {
    for (const value of [
      true,
      false,
      null,
      undefined,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      ["u-1"],
      { id: "u-1" },
    ]) {
      expect(toExceptionUserId(value)).toBe("");
    }
  });

  test("a long value is cut to the longest id kept", () => {
    expect(toExceptionUserId("u".repeat(1000))).toBe(
      "u".repeat(MAX_EXCEPTION_USER_ID_LENGTH),
    );
  });

  test("sixteen megabytes on one line are cut without being copied whole", () => {
    const huge: string = `${"a".repeat(16 * 1024 * 1024)}`;
    const startedAt: number = Date.now();

    expect(readExceptionUserId([{ "user.id": huge }])).toHaveLength(
      MAX_EXCEPTION_USER_ID_LENGTH,
    );
    expect(Date.now() - startedAt).toBeLessThan(1000);
  });
});

describe("a seeded sweep over generated attribute bags", () => {
  const KEYS: Array<string> = [
    ...EXCEPTION_USER_ID_ATTRIBUTE_KEYS,
    ...EXCEPTION_USER_ID_ATTRIBUTE_KEYS.map((key: string): string => {
      return `${RESOURCE_ATTRIBUTE_PREFIX}${key}`;
    }),
    "user.email",
    "session.id",
    "http.route",
  ];
  const VALUES: Array<string> = generatedTexts(400, 6021, [
    "a",
    "7",
    " ",
    "-",
    "\t",
    "é",
    "😀",
  ]);

  // The rule written out the slow, obvious way.
  function expected(bags: Array<ExceptionAttributeBag>): string {
    const tiers: Array<Array<string>> = [
      [...EXCEPTION_USER_ID_ATTRIBUTE_KEYS],
      EXCEPTION_USER_ID_ATTRIBUTE_KEYS.map((key: string): string => {
        return `${RESOURCE_ATTRIBUTE_PREFIX}${key}`;
      }),
    ];

    for (const tier of tiers) {
      for (const bag of bags) {
        for (const key of tier) {
          const value: unknown = bag?.[key];
          const trimmed: string = typeof value === "string" ? value.trim() : "";

          if (trimmed !== "") {
            return trimmed.slice(0, MAX_EXCEPTION_USER_ID_LENGTH);
          }
        }
      }
    }

    return "";
  }

  test("agrees with the rule written out, for 3000 bags", () => {
    const random: SeededRandom = seededRandom(4242);

    for (let round: number = 0; round < 3000; round++) {
      const bags: Array<ExceptionAttributeBag> = [];
      const bagCount: number = 1 + random(3);

      for (let b: number = 0; b < bagCount; b++) {
        const bag: { [key: string]: unknown } = {};
        const keyCount: number = random(5);

        for (let k: number = 0; k < keyCount; k++) {
          bag[KEYS[random(KEYS.length)]!] = VALUES[random(VALUES.length)];
        }

        bags.push(bag);
      }

      expect([round, readExceptionUserId(bags)]).toEqual([
        round,
        expected(bags),
      ]);
    }
  });
});
