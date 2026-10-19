import StatusPageSubscriberConfirmationCode from "../../../../Server/Utils/StatusPage/StatusPageSubscriberConfirmationCode";
import StatusPageSubscriberUnsubscribe from "../../../../Types/StatusPage/StatusPageSubscriberUnsubscribe";
import StatusPageSubscriber from "../../../../Models/DatabaseModels/StatusPageSubscriber";
import { getMaxLengthFromTableColumnType } from "../../../../Types/Database/ColumnLength";
import TableColumnType from "../../../../Types/Database/TableColumnType";
import crypto from "crypto";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

/*
 * The code in the link that asks a new subscriber to confirm. Opening the
 * link is the whole of what proves the inbox, or the phone, asked for the
 * subscription, so the code is one nobody can guess.
 */

afterEach(() => {
  jest.restoreAllMocks();
});

describe("StatusPageSubscriberConfirmationCode.generate", () => {
  test("draws 16 random bytes from the CSPRNG, as 32 lowercase hex characters", () => {
    const randomBytes: ReturnType<typeof jest.spyOn> = jest.spyOn(
      crypto,
      "randomBytes",
    );

    const code: string = StatusPageSubscriberConfirmationCode.generate();

    expect(randomBytes).toHaveBeenCalledWith(16);
    expect(code).toMatch(/^[0-9a-f]{32}$/);
    expect(code).toHaveLength(StatusPageSubscriberConfirmationCode.LENGTH);
  });

  test("owes nothing to Math.random", () => {
    jest.spyOn(Math, "random").mockReturnValue(0.5);

    const codes: Set<string> = new Set<string>();

    for (let i: number = 0; i < 50; i++) {
      codes.add(StatusPageSubscriberConfirmationCode.generate());
    }

    expect(codes.size).toBe(50);
  });

  test("never repeats", () => {
    const codes: Set<string> = new Set<string>();

    for (let i: number = 0; i < 2000; i++) {
      codes.add(StatusPageSubscriberConfirmationCode.generate());
    }

    expect(codes.size).toBe(2000);
  });

  test("uses every hex digit, in every position", () => {
    const seen: Array<Set<string>> = Array.from(
      { length: StatusPageSubscriberConfirmationCode.LENGTH },
      (): Set<string> => {
        return new Set<string>();
      },
    );

    for (let i: number = 0; i < 2000; i++) {
      const code: string = StatusPageSubscriberConfirmationCode.generate();

      for (let position: number = 0; position < code.length; position++) {
        seen[position]!.add(code[position]!);
      }
    }

    for (const digits of seen) {
      expect(digits.size).toBe(16);
    }
  });

  test("fits the column it is stored in, a short text", () => {
    const column: { type: TableColumnType } =
      new StatusPageSubscriber().getTableColumnMetadata(
        "subscriptionConfirmationToken",
      ) as {
        type: TableColumnType;
      };

    expect(column.type).toBe(TableColumnType.ShortText);
    expect(StatusPageSubscriberConfirmationCode.LENGTH).toBeLessThanOrEqual(
      getMaxLengthFromTableColumnType(column.type) as number,
    );
  });

  test("is kept out of a kept copy of the text that carries it", () => {
    const code: string = StatusPageSubscriberConfirmationCode.generate();
    const text: string = `Confirm: https://status.acme.com/confirm-subscription/7c9e6679-7425-40de-944b-e07fc1f90ae7?verification-token=${code}`;

    const kept: string =
      StatusPageSubscriberUnsubscribe.redactCredentials(text);

    expect(kept).not.toContain(code);
    expect(kept).toBe(
      "Confirm: https://status.acme.com/confirm-subscription/7c9e6679-7425-40de-944b-e07fc1f90ae7?verification-token=[redacted]",
    );
  });
});

describe("StatusPageSubscriberConfirmationCode.isCurrent", () => {
  test("takes a code minted now", () => {
    for (let i: number = 0; i < 50; i++) {
      expect(
        StatusPageSubscriberConfirmationCode.isCurrent(
          StatusPageSubscriberConfirmationCode.generate(),
        ),
      ).toBe(true);
    }
  });

  test.each([
    ["six digits, as codes were before", "482913"],
    ["31 hex characters", "a".repeat(31)],
    ["33 hex characters", "a".repeat(33)],
    ["32 characters in capitals", "A".repeat(32)],
    ["32 characters that are not hex", "g".repeat(32)],
    ["32 hex characters with a newline after them", "a".repeat(32) + "\n"],
    ["nothing", ""],
    ["no text at all", undefined],
    ["a number", 482913],
  ])("refuses %s", (_label: string, code: unknown) => {
    expect(StatusPageSubscriberConfirmationCode.isCurrent(code)).toBe(false);
  });
});

describe("StatusPageSubscriberConfirmationCode.matches", () => {
  const CODE: string = "3f1c9a7be2d84f0a9c6b5e4d3a2f1e0d";

  test("the code matches itself, a six-digit one too", () => {
    expect(
      StatusPageSubscriberConfirmationCode.matches({
        stored: CODE,
        presented: CODE,
      }),
    ).toBe(true);
    expect(
      StatusPageSubscriberConfirmationCode.matches({
        stored: "482913",
        presented: "482913",
      }),
    ).toBe(true);
  });

  test.each([
    ["another code", "8a7b6c5d4e3f2a1b0c9d8e7f6a5b4c3d"],
    ["the code in capitals", CODE.toUpperCase()],
    ["the code with a space after it", CODE + " "],
    ["the code's first half", CODE.slice(0, 16)],
    ["the code with a character more", CODE + "0"],
    ["six digits", "482913"],
    ["nothing", ""],
    ["no text", undefined],
    ["a list of the code", [CODE]],
    ["an object", { $ne: "" }],
  ])("%s does not", (_label: string, presented: unknown) => {
    expect(
      StatusPageSubscriberConfirmationCode.matches({
        stored: CODE,
        presented: presented,
      }),
    ).toBe(false);
  });

  test("a subscription with no code is matched by nothing, an empty code included", () => {
    for (const stored of [undefined, null, ""]) {
      for (const presented of ["", undefined, CODE, "null", "undefined"]) {
        expect(
          StatusPageSubscriberConfirmationCode.matches({
            stored: stored,
            presented: presented,
          }),
        ).toBe(false);
      }
    }
  });

  test("compares in constant time, whether or not the lengths agree", () => {
    const timingSafeEqual: ReturnType<typeof jest.spyOn> = jest.spyOn(
      crypto,
      "timingSafeEqual",
    );

    StatusPageSubscriberConfirmationCode.matches({
      stored: CODE,
      presented: CODE.slice(0, 31) + "0",
    });
    expect(timingSafeEqual).toHaveBeenCalledTimes(1);

    StatusPageSubscriberConfirmationCode.matches({
      stored: CODE,
      presented: "482913",
    });
    expect(timingSafeEqual).toHaveBeenCalledTimes(2);
  });
});

describe("StatusPageSubscriberConfirmationCode: a link works for a day", () => {
  const SENT: Date = new Date("2032-03-01T09:00:00.000Z");
  const SECOND: number = 1000;
  const HOUR: number = 60 * 60 * SECOND;

  test("a day is 24 hours", () => {
    expect(StatusPageSubscriberConfirmationCode.VALID_FOR_HOURS).toBe(24);
    expect(StatusPageSubscriberConfirmationCode.VALID_FOR_MS).toBe(24 * HOUR);
    expect(
      StatusPageSubscriberConfirmationCode.getExpiresAt(SENT).toISOString(),
    ).toBe("2032-03-02T09:00:00.000Z");
  });

  test.each([
    ["when it is sent", 0, false],
    ["an hour on", HOUR, false],
    ["a second before its day is over", 24 * HOUR - SECOND, false],
    ["a millisecond before", 24 * HOUR - 1, false],
    ["when its day is over", 24 * HOUR, true],
    ["a second after", 24 * HOUR + SECOND, true],
    ["a year on", 365 * 24 * HOUR, true],
  ])(
    "%s, it has expired: %s",
    (_label: string, after: number, expired: boolean) => {
      expect(
        StatusPageSubscriberConfirmationCode.hasExpired(
          SENT,
          SENT.getTime() + after,
        ),
      ).toBe(expired);
    },
  );

  test("the time it was sent may come as text, as JSON hands it over", () => {
    expect(
      StatusPageSubscriberConfirmationCode.hasExpired(
        SENT.toISOString(),
        SENT.getTime() + HOUR,
      ),
    ).toBe(false);
    expect(
      StatusPageSubscriberConfirmationCode.hasExpired(
        SENT.toISOString(),
        SENT.getTime() + 25 * HOUR,
      ),
    ).toBe(true);
  });

  test.each([
    ["no time", undefined],
    ["an empty time", null],
    ["a time that is not one", "not a date"],
    ["an invalid date", new Date("not a date")],
  ])(
    "a link sent at %s is taken as expired, never on trust",
    (_label: string, sentAt: unknown) => {
      expect(
        StatusPageSubscriberConfirmationCode.hasExpired(
          sentAt as Date | undefined,
          SENT.getTime(),
        ),
      ).toBe(true);
      expect(
        StatusPageSubscriberConfirmationCode.getSecondsLeft(
          sentAt as Date | undefined,
          SENT.getTime(),
        ),
      ).toBe(0);
    },
  );

  test("reads the app's clock when it is not told the time", () => {
    jest.spyOn(Date, "now").mockReturnValue(SENT.getTime() + 2 * HOUR);

    expect(StatusPageSubscriberConfirmationCode.hasExpired(SENT)).toBe(false);
    expect(StatusPageSubscriberConfirmationCode.getSecondsLeft(SENT)).toBe(
      22 * 60 * 60,
    );

    jest.spyOn(Date, "now").mockReturnValue(SENT.getTime() + 24 * HOUR);

    expect(StatusPageSubscriberConfirmationCode.hasExpired(SENT)).toBe(true);
  });

  test.each([
    ["when it is sent", 0, 24 * 60 * 60],
    ["an hour on", HOUR, 23 * 60 * 60],
    ["a second and a half before its day is over", 24 * HOUR - 1500, 2],
    ["half a second before", 24 * HOUR - 500, 1],
    ["a millisecond before", 24 * HOUR - 1, 1],
    ["when its day is over", 24 * HOUR, 0],
    ["a week on", 7 * 24 * HOUR, 0],
  ])(
    "the seconds left %s: %s",
    (_label: string, after: number, seconds: number) => {
      expect(
        StatusPageSubscriberConfirmationCode.getSecondsLeft(
          SENT,
          SENT.getTime() + after,
        ),
      ).toBe(seconds);
    },
  );
});
