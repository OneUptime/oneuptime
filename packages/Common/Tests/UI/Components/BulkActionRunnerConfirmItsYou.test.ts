import { describe, expect, jest, test } from "@jest/globals";
import {
  BulkActionRunResult,
  isConfirmationRefusal,
  runBulkAction,
} from "../../../UI/Components/BulkUpdate/BulkActionRunner";
import {
  BulkActionOnClickProps,
  ProgressInfo,
} from "../../../UI/Components/BulkUpdate/BulkUpdateForm";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import {
  REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES,
  REAUTHENTICATION_PURPOSE_FIELD,
  REAUTHENTICATION_REQUIRED_MESSAGES,
  REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
  ReauthenticationPurpose,
} from "../../../Types/Accounts/Reauthentication";
import { REFUSAL_CODE_FIELD } from "../../../Types/Exception/NameTakenException";
import BadDataException from "../../../Types/Exception/BadDataException";

/*
 * A BULK ACTION STOPS ONCE A CONFIRMATION IS REFUSED (#10330).
 *
 * Deleting users, or no longer requiring their two-factor authentication,
 * from the Admin Dashboard's Users list waits until the master admin's
 * session confirms it's them (#10216, #10330). The API client asks on the
 * first refusal and sends the request again once they have confirmed, so
 * the rest of the run goes through. A refusal that still reaches a step
 * means they cancelled the prompt, or it could not be asked: every item
 * after it would be refused too, and open the prompt again, one after
 * another, with the progress dialog's Stop out of reach behind it. So the
 * run starts no more, and the items it never reached are not started -
 * nothing was done to them - as after a Stop.
 */

interface Row {
  _id: string;
  name: string;
}

function rows(count: number): Array<Row> {
  return Array.from({ length: count }, (_value: unknown, index: number) => {
    return { _id: `row-${index + 1}`, name: `Person ${index + 1}` };
  });
}

// The server's refusal of a change until the session confirms (#10216).
function confirmationRefusal(): HTTPErrorResponse {
  return new HTTPErrorResponse(
    400,
    {
      message:
        REAUTHENTICATION_REQUIRED_MESSAGES[ReauthenticationPurpose.AdminChange],
      [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
      [REAUTHENTICATION_PURPOSE_FIELD]: ReauthenticationPurpose.AdminChange,
    },
    {},
  );
}

function otherRefusal(message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(400, { message: message }, {});
}

interface Run {
  props: BulkActionOnClickProps<Row>;
  reports: Array<ProgressInfo<Row>>;
  ended: () => boolean;
}

function actionProps(items: Array<Row>): Run {
  const reports: Array<ProgressInfo<Row>> = [];
  let isEnded: boolean = false;

  return {
    props: {
      items: items,
      onProgressInfo: (info: ProgressInfo<Row>): void => {
        reports.push(info);
      },
      onBulkActionStart: (): void => {},
      onBulkActionEnd: (): void => {
        isEnded = true;
      },
    } as unknown as BulkActionOnClickProps<Row>,
    reports: reports,
    ended: (): boolean => {
      return isEnded;
    },
  };
}

function namesOf(list: Array<Row>): Array<string> {
  return list.map((row: Row): string => {
    return row.name;
  });
}

describe("a run whose item is refused until the session confirms it's its person's", () => {
  test("one at a time: that item fails with the refusal, and the rest are not started", async () => {
    const items: Array<Row> = rows(4);
    const run: Run = actionProps(items);
    const started: Array<string> = [];

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: run.props,
      concurrency: 1,
      progressIntervalInMs: 0,
      step: async (row: Row): Promise<void> => {
        started.push(row.name);

        if (row.name === "Person 2") {
          throw confirmationRefusal();
        }
      },
    });

    expect(started).toEqual(["Person 1", "Person 2"]);
    expect(namesOf(result.changed)).toEqual(["Person 1"]);
    expect(result.failed).toEqual([
      {
        item: items[1],
        failedMessage:
          REAUTHENTICATION_REQUIRED_MESSAGES[
            ReauthenticationPurpose.AdminChange
          ],
      },
    ]);
    expect(namesOf(result.notStarted)).toEqual(["Person 3", "Person 4"]);
    expect(run.ended()).toBe(true);

    // The dialog's last word says how many were never reached.
    expect(
      namesOf(run.reports[run.reports.length - 1]!.notStartedItems || []),
    ).toEqual(["Person 3", "Person 4"]);
  });

  test("several at a time: the ones already started finish, refused together, and no more start", async () => {
    const items: Array<Row> = rows(6);
    const run: Run = actionProps(items);
    const started: Array<string> = [];

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: run.props,
      concurrency: 2,
      progressIntervalInMs: 0,
      step: async (row: Row): Promise<void> => {
        started.push(row.name);
        // Both requests wait on the one prompt, and are refused with it.
        await Promise.resolve();
        throw confirmationRefusal();
      },
    });

    expect(started).toEqual(["Person 1", "Person 2"]);
    expect(
      result.failed.map((failed: { item: Row }): string => {
        return failed.item.name;
      }),
    ).toEqual(["Person 1", "Person 2"]);
    expect(namesOf(result.notStarted)).toEqual([
      "Person 3",
      "Person 4",
      "Person 5",
      "Person 6",
    ]);
  });

  test("the first item refused: nothing is done to anyone", async () => {
    const items: Array<Row> = rows(3);
    const step: jest.Mock<(row: Row) => Promise<void>> = jest.fn(
      async (): Promise<void> => {
        throw confirmationRefusal();
      },
    );

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: actionProps(items).props,
      concurrency: 1,
      progressIntervalInMs: 0,
      step: step,
    });

    expect(step).toHaveBeenCalledTimes(1);
    expect(result.changed).toEqual([]);
    expect(namesOf(result.notStarted)).toEqual(["Person 2", "Person 3"]);
  });

  test("an action that cannot be stopped stops for it too", async () => {
    const items: Array<Row> = rows(3);

    const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
      actionProps: actionProps(items).props,
      concurrency: 1,
      isStoppable: false,
      progressIntervalInMs: 0,
      step: async (): Promise<void> => {
        throw confirmationRefusal();
      },
    });

    expect(result.failed).toHaveLength(1);
    expect(namesOf(result.notStarted)).toEqual(["Person 2", "Person 3"]);
  });
});

describe("any other failure fails only its own item, as it always did", () => {
  test.each([
    [
      "a refusal of another kind",
      (): unknown => {
        return otherRefusal(
          "This account is a member of one or more projects, so it cannot be deleted.",
        );
      },
    ],
    [
      "the refusal of a request with no session, which no prompt can answer",
      (): unknown => {
        return otherRefusal(
          REAUTHENTICATION_NOT_FROM_A_SESSION_MESSAGES[
            ReauthenticationPurpose.AdminChange
          ],
        );
      },
    ],
    [
      "the refusal's words without its code",
      (): unknown => {
        return otherRefusal(
          REAUTHENTICATION_REQUIRED_MESSAGES[
            ReauthenticationPurpose.AdminChange
          ],
        );
      },
    ],
    [
      "an error thrown in the page",
      (): unknown => {
        return new BadDataException("User ID not found");
      },
    ],
  ] as Array<[string, () => unknown]>)(
    "%s: the run goes on",
    async (_name: string, failure: () => unknown) => {
      const items: Array<Row> = rows(3);

      const result: BulkActionRunResult<Row> = await runBulkAction<Row>({
        actionProps: actionProps(items).props,
        concurrency: 1,
        progressIntervalInMs: 0,
        step: async (row: Row): Promise<void> => {
          if (row.name === "Person 1") {
            throw failure();
          }
        },
      });

      expect(result.failed).toHaveLength(1);
      expect(namesOf(result.changed)).toEqual(["Person 2", "Person 3"]);
      expect(result.notStarted).toEqual([]);
    },
  );
});

describe("isConfirmationRefusal", () => {
  test("reads the refusal by its code, never its words", () => {
    expect(isConfirmationRefusal(confirmationRefusal())).toBe(true);

    for (const purpose of Object.values(ReauthenticationPurpose)) {
      expect(
        isConfirmationRefusal(
          new HTTPErrorResponse(
            400,
            {
              message: REAUTHENTICATION_REQUIRED_MESSAGES[purpose],
              [REFUSAL_CODE_FIELD]: REAUTHENTICATION_REQUIRED_REFUSAL_CODE,
              [REAUTHENTICATION_PURPOSE_FIELD]: purpose,
            },
            {},
          ),
        ),
      ).toBe(true);
    }

    expect(
      isConfirmationRefusal(
        otherRefusal(
          REAUTHENTICATION_REQUIRED_MESSAGES[
            ReauthenticationPurpose.AdminChange
          ],
        ),
      ),
    ).toBe(false);
    expect(
      isConfirmationRefusal(
        new Error(
          REAUTHENTICATION_REQUIRED_MESSAGES[
            ReauthenticationPurpose.AdminChange
          ],
        ),
      ),
    ).toBe(false);
    expect(isConfirmationRefusal(null)).toBe(false);
    expect(isConfirmationRefusal(undefined)).toBe(false);
  });
});
