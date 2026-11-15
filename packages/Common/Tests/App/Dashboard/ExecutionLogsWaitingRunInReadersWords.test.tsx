import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ISSUE #7552: A WAITING RUN'S LINE IN THE READER'S WORDS.
 *
 * A run held before it pages - an on-call rule that pages only during
 * working hours, or OneUptime AI while it works - showed its English status
 * message under its Waiting pill: English on a German or a Persian page,
 * and on an Arabic or Persian one laid out right to left with the page, so
 * its full stop came first and "(Europe/London)" turned round. The line is
 * now worded from the run itself - why it waits, read back from its
 * message, and when paging starts, its pagingStartsAt in the reader's own
 * date and time, set apart in a sentence read right to left - and a line
 * that cannot be read that way is drawn as written, a line of its own that
 * reads left to right (IsolatedLine). The View Status Message dialog of a
 * waiting run says the same line.
 *
 * Drawn by the real WaitingRunLine and ExecutionLogsTable's Status column,
 * with the shipped Dashboard locales.
 */

const modelTableMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: unknown): ReactElement => {
      modelTableMock(props);
      return <div data-testid="model-table" />;
    },
  };
});

jest.mock("../../../UI/Components/Pill/Pill", () => {
  return {
    __esModule: true,
    default: (props: { text: string }): ReactElement => {
      return <span data-testid="pill">{props.text}</span>;
    },
  };
});

import ExecutionLogsTable, {
  ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import {
  getWaitingRunSentence,
  WAITING_RUN_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/WaitingRunLine";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OneUptimeDate from "../../../Types/Date";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import {
  getOnCallPolicyRunWaitingMessage,
  OnCallPolicyRunWaitReason,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunWait";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import {
  FIRST_STRONG_ISOLATE,
  POP_DIRECTIONAL_ISOLATE,
} from "../../../Types/ReadingDirection";
import { createTranslator } from "../../../Types/Translator";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111552";

const LANGUAGES: Array<string> = ["en", "de", "fa", "ar"];
const RIGHT_TO_LEFT: Array<string> = ["fa", "ar"];

// When the run pages: a Wednesday morning, a little more than a day away.
const NOW: Date = new Date();
const PAGING_STARTS_AT: Date = new Date(NOW.getTime() + 30 * 60 * 60 * 1000);

const MESSAGES: Record<OnCallPolicyRunWaitReason, string> = {
  [OnCallPolicyRunWaitReason.WorkingHours]: getOnCallPolicyRunWaitingMessage({
    pagingStartsAt: PAGING_STARTS_AT,
    timezone: "Europe/London",
    now: NOW,
    isWaitingForWorkingHours: true,
  }),
  [OnCallPolicyRunWaitReason.OneUptimeAI]: getOnCallPolicyRunWaitingMessage({
    pagingStartsAt: PAGING_STARTS_AT,
    now: NOW,
    isWaitingForWorkingHours: false,
    isWaitingForOneUptimeAI: true,
  }),
  [OnCallPolicyRunWaitReason.Other]: getOnCallPolicyRunWaitingMessage({
    pagingStartsAt: PAGING_STARTS_AT,
    timezone: "Asia/Tehran",
    now: NOW,
    isWaitingForWorkingHours: false,
  }),
};

// A waiting line no reader can read: a caller's own words.
const UNKNOWN_MESSAGE: string =
  "Waiting until the change freeze ends (Europe/London).";

const REASONS: Array<OnCallPolicyRunWaitReason> = Object.values(
  OnCallPolicyRunWaitReason,
);

function waitingRun(
  statusMessage: string,
  // Null: a run with no moment to page at.
  pagingStartsAt: Date | null = PAGING_STARTS_AT,
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log._id = "aaaaaaaa-0000-4000-8000-000000007552";
  log.status = OnCallDutyPolicyStatus.Waiting;
  log.statusMessage = statusMessage;

  if (pagingStartsAt) {
    log.pagingStartsAt = pagingStartsAt;
  }

  return log;
}

// The reader's sentence for `reason`, the time as the reader writes it.
function worded(language: string, reason: OnCallPolicyRunWaitReason): string {
  const sentence: string =
    readDashboardLocale(language)[WAITING_RUN_SENTENCES[reason]]!;

  expect(sentence).toBeTruthy();

  return sentence.replace("{{time}}", readerTime());
}

// When paging starts, as the page's reader writes a date and a time.
function readerTime(): string {
  return OneUptimeDate.getDateAsLocalShortDateTimeString(PAGING_STARTS_AT, {
    showYear: !OneUptimeDate.isWindowInTheCurrentYear({
      start: PAGING_STARTS_AT,
      end: PAGING_STARTS_AT,
    }),
  });
}

interface RecordedColumn {
  title: string;
  getElement?: (item: unknown) => ReactElement;
}

interface RecordedActionButton {
  title: string;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => Promise<void>;
}

interface RecordedTable {
  columns: Array<RecordedColumn>;
  actionButtons: Array<RecordedActionButton>;
  selectMoreFields: Record<string, unknown>;
}

function lastTable(): RecordedTable {
  const calls: Array<Array<unknown>> = modelTableMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as RecordedTable;
}

// The Status column's cell for `log`, drawn on its own.
function statusCell(log: OnCallDutyPolicyExecutionLog): HTMLElement {
  render(<ExecutionLogsTable />);

  const status: RecordedColumn | undefined = lastTable().columns.find(
    (column: RecordedColumn): boolean => {
      return column.title === "Status";
    },
  );

  cleanup();

  return render(status!.getElement!(log)).container;
}

function waitingLine(container: HTMLElement): HTMLElement {
  const line: HTMLElement | null = container.querySelector(
    "[data-testid=execution-log-waiting-message]",
  );

  expect(line).not.toBeNull();

  return line!;
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  setDateDisplayLanguage(language);
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};

  for (const language of LANGUAGES) {
    resources[language] = { translation: readDashboardLocale(language) };
  }

  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  modelTableMock.mockClear();
  window.history.replaceState({}, "", `/dashboard/${PROJECT_ID}/on-call-duty`);
});

afterEach(async () => {
  cleanup();
  await inLanguage("en");
});

describe("the table asks for when a waiting run pages", () => {
  test("pagingStartsAt is read with every row, beside its message", () => {
    render(<ExecutionLogsTable />);

    expect(lastTable().selectMoreFields["pagingStartsAt"]).toBe(true);
    expect(lastTable().selectMoreFields["statusMessage"]).toBe(true);
  });
});

describe.each(LANGUAGES)(
  "a %s reader reads a waiting run's line in their own words (#7552)",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    test.each(REASONS)(
      "a run waiting for %s says why, and when paging starts in the reader's date and time",
      (reason: OnCallPolicyRunWaitReason) => {
        const line: HTMLElement = waitingLine(
          statusCell(waitingRun(MESSAGES[reason])),
        );

        expect(withoutIsolateMarks(line.textContent || "")).toBe(
          worded(language, reason),
        );
        // A line of the page's own, drawn with the row's classes.
        expect(line.className).toBe(ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME);
        expect(line).not.toHaveAttribute("dir");
      },
    );

    if (language === "en") {
      test("an English reader reads the same sentence, the time in their own clock", () => {
        const line: HTMLElement = waitingLine(
          statusCell(
            waitingRun(MESSAGES[OnCallPolicyRunWaitReason.WorkingHours]),
          ),
        );

        expect(line.textContent).toBe(
          `Waiting for working hours. Paging starts ${readerTime()}.`,
        );
      });
    } else {
      test("none of the waiting lines reads the server's English", () => {
        for (const reason of REASONS) {
          const text: string = withoutIsolateMarks(
            waitingLine(statusCell(waitingRun(MESSAGES[reason]))).textContent ||
              "",
          );

          for (const english of [
            MESSAGES[reason],
            "Waiting for working hours",
            "Waiting for OneUptime AI. ",
            "Paging starts",
            "unless it resolves this",
            "(Europe/London)",
            "(Asia/Tehran)",
          ]) {
            expect([reason, english, text.includes(english)]).toEqual([
              reason,
              english,
              false,
            ]);
          }
        }
      });
    }
  },
);

describe.each(RIGHT_TO_LEFT)(
  "on a %s page, a waiting run's line reads right to left, its time set apart (#7552)",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    test("the time is a value of the sentence, set apart so it keeps its own order", () => {
      const line: HTMLElement = waitingLine(
        statusCell(
          waitingRun(MESSAGES[OnCallPolicyRunWaitReason.WorkingHours]),
        ),
      );

      expect(line.textContent).toContain(isolated(readerTime()));
      // The sentence is the page's own: no direction of its own, its full stop at its end.
      expect(line).not.toHaveAttribute("dir");
      expect(withoutIsolateMarks(line.textContent || "").trimEnd()).toMatch(
        /[.۔]$/,
      );
    });

    test("a waiting line no reader can read is drawn as written, a line of its own that reads left to right", () => {
      const line: HTMLElement = waitingLine(
        statusCell(waitingRun(UNKNOWN_MESSAGE)),
      );

      expect(line.textContent).toBe(UNKNOWN_MESSAGE);
      expect(line).toHaveAttribute("dir", "ltr");
      expect(line.className).toContain(
        CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
      );
      // It keeps the row's classes: it still wraps at a pill's width.
      expect(line.className).toContain(ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME);
    });

    test("a run with no moment to page at is drawn as its message, set apart", () => {
      const message: string = MESSAGES[OnCallPolicyRunWaitReason.WorkingHours];
      const line: HTMLElement = waitingLine(
        statusCell(waitingRun(message, null)),
      );

      expect(line.textContent).toBe(message);
      expect(line).toHaveAttribute("dir", "ltr");
    });
  },
);

describe("on a page read left to right, a line no reader can read is drawn exactly as it always was", () => {
  test.each(["en", "de"])("in %s", async (language: string) => {
    await inLanguage(language);

    const line: HTMLElement = waitingLine(
      statusCell(waitingRun(UNKNOWN_MESSAGE)),
    );

    expect(line.textContent).toBe(UNKNOWN_MESSAGE);
    expect(line).not.toHaveAttribute("dir");
    expect(line.className).toBe(ON_CALL_LOGS_WAITING_MESSAGE_CLASS_NAME);
    expect(line.querySelector("bdi")).toBeNull();
  });
});

describe("getWaitingRunSentence", () => {
  test("is the reader's sentence, or null when the run cannot say it", () => {
    const german: Translator = createTranslator((text: string) => {
      return readDashboardLocale("de")[text];
    }, "de");

    expect(
      getWaitingRunSentence(german, {
        statusMessage: MESSAGES[OnCallPolicyRunWaitReason.OneUptimeAI],
        pagingStartsAt: PAGING_STARTS_AT,
      }),
    ).toContain(
      readDashboardLocale("de")[
        WAITING_RUN_SENTENCES[OnCallPolicyRunWaitReason.OneUptimeAI]
      ]!.split("{{time}}")[0]!,
    );

    for (const run of [
      { statusMessage: UNKNOWN_MESSAGE, pagingStartsAt: PAGING_STARTS_AT },
      { statusMessage: MESSAGES[OnCallPolicyRunWaitReason.Other] },
      {
        statusMessage: MESSAGES[OnCallPolicyRunWaitReason.Other],
        pagingStartsAt: "not a date",
      },
      { statusMessage: undefined, pagingStartsAt: PAGING_STARTS_AT },
    ]) {
      expect(getWaitingRunSentence(german, run)).toBeNull();
    }
  });

  test("a moment in another year names its year", () => {
    const english: Translator = createTranslator(undefined, "en");
    const nextYear: Date = new Date(
      Date.UTC(new Date().getUTCFullYear() + 1, 5, 15, 9, 0, 0),
    );

    expect(
      getWaitingRunSentence(english, {
        statusMessage: MESSAGES[OnCallPolicyRunWaitReason.Other],
        pagingStartsAt: nextYear,
      }),
    ).toContain(String(nextYear.getUTCFullYear()));
  });

  test("the time it sets apart is the only mark in the sentence", () => {
    const persian: Translator = createTranslator((text: string) => {
      return readDashboardLocale("fa")[text];
    }, "fa");
    const sentence: string = getWaitingRunSentence(persian, {
      statusMessage: MESSAGES[OnCallPolicyRunWaitReason.WorkingHours],
      pagingStartsAt: PAGING_STARTS_AT,
    })!;

    expect(sentence.split(FIRST_STRONG_ISOLATE)).toHaveLength(2);
    expect(sentence.split(POP_DIRECTIONAL_ISOLATE)).toHaveLength(2);
  });
});

describe("View Status Message on a waiting run says the same line (#7552)", () => {
  async function openStatusMessage(
    log: OnCallDutyPolicyExecutionLog,
  ): Promise<HTMLElement> {
    render(<ExecutionLogsTable />);

    const view: RecordedActionButton | undefined =
      lastTable().actionButtons.find(
        (button: RecordedActionButton): boolean => {
          return button.title === "View Status Message";
        },
      );

    await act(async () => {
      await view!.onClick(
        log,
        () => {},
        () => {},
      );
    });

    return screen.getByTestId("confirm-modal-description");
  }

  test.each(["de", "fa"])(
    "in %s, the dialog words the waiting line as the row does",
    async (language: string) => {
      await inLanguage(language);

      const description: HTMLElement = await openStatusMessage(
        waitingRun(MESSAGES[OnCallPolicyRunWaitReason.WorkingHours]),
      );

      expect(withoutIsolateMarks(description.textContent || "")).toBe(
        worded(language, OnCallPolicyRunWaitReason.WorkingHours),
      );
      expect(description.textContent).not.toContain("Paging starts");
    },
  );

  test("a run that does not wait shows its message as it always did", async () => {
    const log: OnCallDutyPolicyExecutionLog = waitingRun(
      "Execution completed.",
    );
    log.status = OnCallDutyPolicyStatus.Completed;

    const description: HTMLElement = await openStatusMessage(log);

    expect(description.textContent).toBe("Execution completed.");
  });
});
