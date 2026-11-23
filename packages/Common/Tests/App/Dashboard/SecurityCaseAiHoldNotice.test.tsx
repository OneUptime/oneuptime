import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";

/*
 * A SECURITY CASE ONEUPTIME AI RESPONDS FIRST TO (#10353): the first thing
 * on the case's page says OneUptime AI is on it and when people are
 * alerted, with Page now - one click - for anyone who wants people on it at
 * once. Nothing shows for a case that is not held, and the notice goes as
 * soon as the hold ends, telling the page to read the case again.
 *
 * Driven through the real notice; only the case's read (ModelAPI.getItem)
 * and Page now's request (SecurityCaseApi.pageNowForAiHold) are stubbed.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
        i18n: { language: "en", resolvedLanguage: "en" },
      };
    },
  };
});

import SecurityCaseAiHoldNotice, {
  SECURITY_CASE_AI_HOLD_NOTICE_REFRESH_MS,
  SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/AiResponse/SecurityCaseAiHoldNotice";
import SecurityCaseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityCase/SecurityCaseApi";
import SecurityCase from "../../../Models/DatabaseModels/SecurityCase";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import { SecurityCaseAiHoldOutcome } from "../../../Types/SecurityCase/SecurityCaseAiHold";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";

const CASE_ID: ObjectID = new ObjectID("c4500000-0000-4000-8000-000000000001");

interface Hold {
  outcome: SecurityCaseAiHoldOutcome | null;
  until: Date | null;
}

// What each read answers, in turn; the last one stays.
let holds: Array<Hold> = [];
let lastHold: Hold = { outcome: null, until: null };
let reads: Array<{ id: ObjectID; select: Record<string, unknown> }> = [];
let pageNow: jest.Mock;

function held(until: Date): Hold {
  return { outcome: SecurityCaseAiHoldOutcome.Holding, until };
}

function ended(outcome: SecurityCaseAiHoldOutcome): Hold {
  return { outcome, until: null };
}

beforeEach(() => {
  holds = [];
  lastHold = { outcome: null, until: null };
  reads = [];

  jest.spyOn(ModelAPI, "getItem").mockImplementation((async (args: {
    id: ObjectID;
    select: Record<string, unknown>;
  }) => {
    reads.push({ id: args.id, select: args.select });
    const answer: Hold = holds.shift() || lastHold;
    const row: SecurityCase = new SecurityCase(CASE_ID);

    if (answer.outcome) {
      row.aiHoldOutcome = answer.outcome;
    }

    if (answer.until) {
      row.aiHoldUntil = answer.until;
    }

    return row;
  }) as never);

  pageNow = jest
    .spyOn(SecurityCaseApi, "pageNowForAiHold")
    .mockResolvedValue(undefined) as unknown as jest.Mock;
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function shownTime(at: Date): string {
  return OneUptimeDate.getLocalTimeString(at, {
    use12HourFormat: OneUptimeDate.getUserPrefers12HourFormat(),
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
  });
}

describe("a case that is not held", () => {
  test("shows nothing, having read only the case's hold", async () => {
    lastHold = ended(SecurityCaseAiHoldOutcome.Resolved);

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} />);

    await waitFor(() => {
      expect(reads).toHaveLength(1);
    });
    await settle();

    expect(screen.queryByTestId(SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID)).toBeNull();
    expect(reads[0]).toEqual({
      id: CASE_ID,
      select: { _id: true, aiHoldOutcome: true, aiHoldUntil: true },
    });
  });

  test("a case that cannot be read shows nothing", async () => {
    jest
      .spyOn(ModelAPI, "getItem")
      .mockRejectedValue(new Error("You do not have permission to read."));

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} />);
    await settle();
    await settle();

    expect(screen.queryByTestId(SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID)).toBeNull();
  });
});

describe("a case OneUptime AI is responding first to", () => {
  const until: Date = OneUptimeDate.addRemoveMinutes(
    OneUptimeDate.getCurrentDate(),
    8,
  );

  test("says OneUptime AI is on it, when people are alerted, and offers Page now", async () => {
    lastHold = held(until);

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} />);

    const notice: HTMLElement = await screen.findByTestId(
      SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID,
    );

    expect(notice).toHaveTextContent("OneUptime AI is on it");
    expect(notice).toHaveTextContent(
      `People are alerted at ${shownTime(until)} unless OneUptime AI contains this case first.`,
    );
    expect(screen.getByRole("button", { name: /Page now/ })).toBeEnabled();
  });

  test("Page now alerts people in one click, and the notice goes once the hold has ended", async () => {
    holds = [held(until)];
    lastHold = ended(SecurityCaseAiHoldOutcome.PageNow);
    const onChanged: jest.Mock = jest.fn();

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} onChanged={onChanged} />);

    fireEvent.click(await screen.findByRole("button", { name: /Page now/ }));

    await waitFor(() => {
      expect(
        screen.queryByTestId(SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID),
      ).toBeNull();
    });
    expect(pageNow).toHaveBeenCalledTimes(1);
    expect(pageNow).toHaveBeenCalledWith(CASE_ID);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  test("Page now refused - the hold ended meanwhile - reads the case again, and the notice goes", async () => {
    holds = [held(until)];
    lastHold = ended(SecurityCaseAiHoldOutcome.Resolved);
    pageNow.mockRejectedValue(
      new Error(
        "OneUptime AI is not holding this case's alerts any more, so there is nobody left to alert.",
      ),
    );

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /Page now/ }));

    await waitFor(() => {
      expect(
        screen.queryByTestId(SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID),
      ).toBeNull();
    });
    expect(reads.length).toBeGreaterThanOrEqual(2);
  });

  test("Page now that fails while the case is still held says why, and keeps the button", async () => {
    lastHold = held(until);
    pageNow.mockRejectedValue(new Error("The server could not be reached."));

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} />);

    fireEvent.click(await screen.findByRole("button", { name: /Page now/ }));

    expect(
      await screen.findByTestId(`${SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID}-error`),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Page now/ })).toBeEnabled();
  });

  test("reads the hold again every 15 seconds, and goes as soon as OneUptime AI contains the case", async () => {
    jest.useFakeTimers();
    holds = [held(until), held(until)];
    lastHold = ended(SecurityCaseAiHoldOutcome.Resolved);
    const onChanged: jest.Mock = jest.fn();

    render(<SecurityCaseAiHoldNotice caseId={CASE_ID} onChanged={onChanged} />);

    await act(async () => {
      await Promise.resolve();
    });
    expect(
      screen.getByTestId(SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID),
    ).toBeInTheDocument();

    expect(SECURITY_CASE_AI_HOLD_NOTICE_REFRESH_MS).toBe(15000);

    for (let tick: number = 0; tick < 2; tick++) {
      await act(async () => {
        jest.advanceTimersByTime(SECURITY_CASE_AI_HOLD_NOTICE_REFRESH_MS);
        await Promise.resolve();
      });
    }

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByTestId(SECURITY_CASE_AI_HOLD_NOTICE_TEST_ID)).toBeNull();
    expect(reads).toHaveLength(3);
    expect(onChanged).toHaveBeenCalledTimes(1);
  });
});
