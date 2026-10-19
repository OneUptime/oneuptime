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
