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
 * ISSUE #8330: THE ON-CALL LOGS' LINES IN THE READER'S WORDS.
 *
 * A page's rows say why in their status message, in English: a person's
 * notifications (User Settings > On-Call Logs > a log's timeline), their
 * page (User Settings > On-Call Logs), a run's steps (On-Call > Execution
 * Logs > a run's timeline) and the run itself (On-Call > Execution Logs).
 * Each list's View Status Message dialog drew that English line as it was:
 * a German reader read "SMS not sent because phone +15550100 is not
 * verified." in English, and an Arabic or Persian reader got it laid out
 * right to left with the page, its full stop first and the number's "+"
 * after its digits.
 *
 * The dialogs now read OneUptime's own lines back into codes - the readers
 * a test page's result uses (OnCallTestPageLine, #7550), and a run's
 * endings (OnCallPolicyRunLine) - and word them in the reader's language: a
 * real page's row as what became of the page, never "the test"; a test
 * page's row as its result says it; what a live result says of now, a log
 * says of then. A line with no code is drawn as written, a line of its own
 * that reads left to right on an Arabic or Persian page.
 *
 * Drawn by the real pages and their real dialog, with the shipped Dashboard
 * locales, in English, German, Persian and Arabic.
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

import ExecutionLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTable";
import ExecutionLogTimelineTable from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/ExecutionLogsTimelineTable";
import {
  getOnCallLogLineSentence,
  getOnCallLogNotificationChannel,
  LOG_LINE_SENTENCES,
  ON_CALL_PAGE_CHANNEL_COLUMNS,
  REAL_PAGE_LINE_SENTENCES,
  REAL_PAGE_NOT_VERIFIED_SENTENCES,
  RUN_LINE_SENTENCES,
  RUN_RECORD_HANDLED_SENTENCES,
  RUN_RECORD_RESOLVED_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ExecutionLogs/OnCallLogLineWords";
import {
  getResultLineSentence,
  METHOD_NOT_VERIFIED_SENTENCES,
  NOT_PAGED_SENTENCES,
  RESULT_LINE_SENTENCES,
  SEND_FAILED_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageWords";
import UserOnCallLogsPage from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogs";
import UserOnCallLogsTimelinePage from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/OnCallLogsTimeline";
import OnCallDutyPolicyExecutionLog from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLog";
import OnCallDutyPolicyExecutionLogTimeline from "../../../Models/DatabaseModels/OnCallDutyPolicyExecutionLogTimeline";
import OnCallDutyPolicySchedule from "../../../Models/DatabaseModels/OnCallDutyPolicySchedule";
import User from "../../../Models/DatabaseModels/User";
import UserOnCallLog from "../../../Models/DatabaseModels/UserOnCallLog";
import UserOnCallLogTimeline from "../../../Models/DatabaseModels/UserOnCallLogTimeline";
import Route from "../../../Types/API/Route";
import OneUptimeDate from "../../../Types/Date";
import { setDateDisplayLanguage } from "../../../Types/DateLanguage";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import { ALREADY_PAGED_TIMELINE_MESSAGE } from "../../../Types/OnCallDutyPolicy/AlreadyPagedTimelineMessage";
import { getAwayTimelineMessage } from "../../../Types/OnCallDutyPolicy/AwayTimelineMessage";
import { ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE } from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyArchive";
import {
  getOnCallPolicyRunRecordHandledMessage,
  getOnCallPolicyRunRecordResolvedMessage,
  LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
  ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
  ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyRunEnding";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { getOnCallEmptyLevelTimelineMessage } from "../../../Types/OnCallDutyPolicy/OnCallEmptyLevel";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getOnCallOptedOutStatusMessage,
  NO_NOTIFICATION_RULES_STATUS_MESSAGE,
  NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE,
  NOT_A_PROJECT_MEMBER_STATUS_MESSAGE,
  NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE,
  SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallPageLine";
import {
  OnCallPolicyRunRecordKind,
  ON_CALL_POLICY_RUN_RECORD_KINDS,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunLine";
import {
  getNotificationServiceAnswerLine,
  getOnCallSendFailedMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallSendFailureLine";
import {
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { getOnCallTestPageNotVerifiedMessage } from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";
import { NEXT_IN_ROTATION_SCHEDULES_KEY } from "../../../Types/OnCallDutyPolicy/NextInRotation";
import { createTranslator, Translator } from "../../../Types/Translator";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserUtil from "../../../UI/Utils/User";
import { CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111118330";
const LOG_ID: string = "22222222-0000-4000-8000-000000008330";
const RUN_ID: string = "33333333-0000-4000-8000-000000008330";
const PHONE: string = "+15550100";

const LANGUAGES: Array<string> = ["en", "de", "fa", "ar"];

// A sentence that names a test: never a real page's row.
const SAYS_TEST: RegExp = /\btests?\b/i;

// How a sentence ends in the Dashboard's languages.
const SENTENCE_END: RegExp = /[.。।]$/u;
const RIGHT_TO_LEFT: Array<string> = ["fa", "ar"];

// A line OneUptime has no code for: a provider's own words.
const UNKNOWN_LINE: string =
  "Twilio: 21614 'To' number +15550100 is not a valid mobile number.";

// Back on Monday morning: when a person was away until.
const AWAY_UNTIL: Date = new Date("2026-11-23T09:00:00.000Z");

interface RecordedActionButton {
  title: string;
  onClick: (
    item: unknown,
    onCompleteAction: () => void,
    onError: (error: Error) => void,
  ) => Promise<void>;
}

interface RecordedTable {
  actionButtons: Array<RecordedActionButton>;
  selectMoreFields: Record<string, unknown>;
}

function lastTable(): RecordedTable {
  const calls: Array<Array<unknown>> = modelTableMock.mock.calls as Array<
    Array<unknown>
  >;

  return calls[calls.length - 1]![0] as RecordedTable;
}

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  setDateDisplayLanguage(language);
}

// The reader's sentence for `key`, its values filled in as written.
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let text: string =
    language === "en" ? key : readDashboardLocale(language)[key]!;

  expect({ language, key, worded: Boolean(text) }).toEqual({
    language,
    key,
    worded: true,
  });

  if (language !== "en") {
    expect(text).not.toBe(key);
  }

  for (const name of Object.keys(values)) {
    text = text.split(`{{${name}}}`).join(values[name]!);
  }

  return text;
}

// The pages, drawn as the Dashboard draws them.
const PAGES: Record<string, () => void> = {
  runs: (): void => {
    render(<ExecutionLogsTable />);
  },
  steps: (): void => {
    render(
      <ExecutionLogTimelineTable
        onCallPolicyExecutionLogId={new ObjectID(RUN_ID)}
      />,
    );
  },
  notifications: (): void => {
    window.history.replaceState(
      {},
      "",
      `/dashboard/${PROJECT_ID}/user-settings/on-call-logs/${LOG_ID}`,
    );
    render(
      <UserOnCallLogsTimelinePage
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
  },
  pages: (): void => {
    render(
      <UserOnCallLogsPage
        pageRoute={new Route("/")}
        currentProject={null}
        hasPaymentMethod={false}
      />,
    );
  },
};

const LINE_TEST_IDS: Record<string, string> = {
  runs: "execution-log-status-message",
  steps: "execution-log-timeline-status-message",
  notifications: "user-on-call-log-timeline-status-message",
  pages: "user-on-call-log-status-message",
};

// View Status Message on `item`, in `page`: the line its dialog draws.
async function statusLine(page: string, item: unknown): Promise<HTMLElement> {
  PAGES[page]!();

  const view: RecordedActionButton | undefined = lastTable().actionButtons.find(
    (button: RecordedActionButton): boolean => {
      return button.title === "View Status Message";
    },
  );

  expect(view).toBeDefined();

  await act(async () => {
    await view!.onClick(
      item,
      () => {},
      () => {},
    );
  });

  const description: HTMLElement = screen.getByTestId(
    "confirm-modal-description",
  );
  const line: HTMLElement = screen.getByTestId(LINE_TEST_IDS[page]!);

  expect(description.contains(line)).toBe(true);

  return line;
}

function text(line: HTMLElement): string {
  return withoutIsolateMarks(line.textContent || "");
}

function run(
  statusMessage: string,
  options: { isTestPage?: boolean; status?: OnCallDutyPolicyStatus } = {},
): OnCallDutyPolicyExecutionLog {
  const log: OnCallDutyPolicyExecutionLog = new OnCallDutyPolicyExecutionLog();
  log._id = RUN_ID;
  log.status = options.status || OnCallDutyPolicyStatus.Completed;
  log.statusMessage = statusMessage;

  if (options.isTestPage) {
    log.userNotificationEventType = UserNotificationEventType.TestPage;
  }

  return log;
}

function step(
  statusMessage: string,
  options: {
    isTestPage?: boolean;
    userName?: string;
    scheduleName?: string;
  } = {},
): OnCallDutyPolicyExecutionLogTimeline {
  const row: OnCallDutyPolicyExecutionLogTimeline =
    new OnCallDutyPolicyExecutionLogTimeline();
  row._id = "44444444-0000-4000-8000-000000008330";
  row.statusMessage = statusMessage;

  if (options.isTestPage) {
    row.userNotificationEventType = UserNotificationEventType.TestPage;
  }

  if (options.userName) {
    const user: User = new User();
    user.name = new Name(options.userName);
    user.email = new Email("jane@example.com");
    row.alertSentToUser = user;
  }

  if (options.scheduleName) {
    const schedule: OnCallDutyPolicySchedule = new OnCallDutyPolicySchedule();
    schedule.name = options.scheduleName;
    row.onCallDutySchedule = schedule;
  }

  return row;
}

function notification(
  statusMessage: string,
  options: { channelColumn?: string; isTestPage?: boolean } = {},
): UserOnCallLogTimeline {
  const row: UserOnCallLogTimeline = new UserOnCallLogTimeline();
  row._id = "55555555-0000-4000-8000-000000008330";
  row.statusMessage = statusMessage;

  if (options.channelColumn) {
    (row as unknown as Record<string, unknown>)[options.channelColumn] =
      new ObjectID("66666666-0000-4000-8000-000000008330");
  }

  if (options.isTestPage) {
    row.userNotificationEventType = UserNotificationEventType.TestPage;
  }

  return row;
}

function personPage(statusMessage: string): UserOnCallLog {
  const row: UserOnCallLog = new UserOnCallLog();
  row._id = "77777777-0000-4000-8000-000000008330";
  row.statusMessage = statusMessage;
  return row;
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
  jest.spyOn(UserUtil, "getName").mockReturnValue(new Name("Ana Lopez"));
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await inLanguage("en");
});

describe("what the lists read with every row, so a line can be worded (#8330)", () => {
  test("a person's notifications: the method columns, even of a method deleted since, and whether it was a test", () => {
    PAGES["notifications"]!();

    const select: Record<string, unknown> = lastTable().selectMoreFields;

    expect(select["statusMessage"]).toBe(true);
    expect(select["userNotificationEventType"]).toBe(true);

    for (const column of Object.keys(ON_CALL_PAGE_CHANNEL_COLUMNS)) {
      expect([column, select[column]]).toEqual([column, true]);
    }
  });

  test("a run's steps: whether it was a test", () => {
    PAGES["steps"]!();

    expect(lastTable().selectMoreFields["userNotificationEventType"]).toBe(
      true,
    );
  });

  test("runs and a person's pages read it already", () => {
    PAGES["runs"]!();
    expect(lastTable().selectMoreFields["userNotificationEventType"]).toBe(
      true,
    );
    cleanup();
    PAGES["pages"]!();
    expect(lastTable().selectMoreFields["userNotificationEventType"]).toBe(
      true,
    );
  });

  test("the method columns are every channel's, one each", () => {
    expect(Object.keys(ON_CALL_PAGE_CHANNEL_COLUMNS).sort()).toEqual(
      [
        "customNotificationChannelId",
        "userCallId",
        "userEmailId",
        "userMattermostId",
        "userMicrosoftTeamsId",
        "userPushId",
        "userSlackId",
        "userSmsId",
        "userTelegramId",
        "userWebhookId",
        "userWhatsAppId",
      ].sort(),
    );
  });
});

describe.each(LANGUAGES)(
  "a %s reader reads each log's line in their own words (#8330)",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    describe("On-Call > Execution Logs: a run's own line", () => {
      test("a run that went through every escalation rule", async () => {
        const line: HTMLElement = await statusLine(
          "runs",
          run(ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE),
        );

        expect(text(line)).toBe(
          worded(language, RUN_LINE_SENTENCES.wentThroughEveryRule),
        );
        expect(line).not.toHaveAttribute("dir");
      });

      test.each([...ON_CALL_POLICY_RUN_RECORD_KINDS])(
        "a run that stopped because its %s was acknowledged or resolved",
        async (recordKind: OnCallPolicyRunRecordKind) => {
          const line: HTMLElement = await statusLine(
            "runs",
            run(getOnCallPolicyRunRecordHandledMessage(recordKind)),
          );

          expect(text(line)).toBe(
            worded(language, RUN_RECORD_HANDLED_SENTENCES[recordKind]),
          );
        },
      );

      test.each([...ON_CALL_POLICY_RUN_RECORD_KINDS])(
        "a page again that stopped because its %s was resolved",
        async (recordKind: OnCallPolicyRunRecordKind) => {
          const line: HTMLElement = await statusLine(
            "runs",
            run(getOnCallPolicyRunRecordResolvedMessage(recordKind)),
          );

          expect(text(line)).toBe(
            worded(language, RUN_RECORD_RESOLVED_SENTENCES[recordKind]),
          );
        },
      );

      test("everybody it paged escalated it", async () => {
        const line: HTMLElement = await statusLine(
          "runs",
          run(ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE),
        );

        expect(text(line)).toBe(
          worded(language, RUN_LINE_SENTENCES.everybodyEscalated),
        );
      });

      test("a real run that paged nobody, in today's words and before: its own sentence, never a test's", async () => {
        for (const message of [
          ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
          LEGACY_ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
        ]) {
          cleanup();

          const line: HTMLElement = await statusLine("runs", run(message));

          expect(text(line)).toBe(
            worded(language, RUN_LINE_SENTENCES.nobodyNotified),
          );
          expect(text(line)).not.toBe(
            worded(language, RESULT_LINE_SENTENCES.nobodyPaged),
          );
        }
      });

      test("an archived policy's run", async () => {
        const line: HTMLElement = await statusLine(
          "runs",
          run(ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE),
        );

        expect(text(line)).toBe(
          worded(language, RUN_LINE_SENTENCES.policyArchivedNotRun),
        );
      });

      test("a test page's run is worded as its result words it", async () => {
        const line: HTMLElement = await statusLine(
          "runs",
          run(ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE, { isTestPage: true }),
        );

        expect(text(line)).toBe(
          worded(language, RESULT_LINE_SENTENCES.nobodyPaged),
        );
      });
    });

    describe("On-Call > Execution Logs > a run's timeline: a step's line", () => {
      test("a schedule nobody was on call in names it, and says then, not now", async () => {
        const line: HTMLElement = await statusLine(
          "steps",
          step(NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE, {
            scheduleName: "Primary",
          }),
        );

        expect(text(line)).toBe(
          worded(language, LOG_LINE_SENTENCES.nobodyOnCall, {
            name: "Primary",
          }),
        );
        // On a page read from the right, the name is set apart.
        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated("Primary"));
        }
      });

      test("a person who is not a member of the project is named", async () => {
        const line: HTMLElement = await statusLine(
          "steps",
          step(NOT_A_PROJECT_MEMBER_TIMELINE_MESSAGE, {
            userName: "Jane Doe",
          }),
        );

        expect(text(line)).toBe(
          worded(language, NOT_PAGED_SENTENCES.notProjectMember, {
            name: "Jane Doe",
          }),
        );
      });

      test("a person already paged: a real page's words, and a test's for a test page", async () => {
        const real: HTMLElement = await statusLine(
          "steps",
          step(ALREADY_PAGED_TIMELINE_MESSAGE),
        );

        expect(text(real)).toBe(
          worded(language, REAL_PAGE_LINE_SENTENCES.alreadyPaged),
        );

        cleanup();

        const test: HTMLElement = await statusLine(
          "steps",
          step(ALREADY_PAGED_TIMELINE_MESSAGE, { isTestPage: true }),
        );

        expect(text(test)).toBe(
          worded(language, RESULT_LINE_SENTENCES.alreadyPaged),
        );
      });

      test("a person being paged: a real page's words", async () => {
        const line: HTMLElement = await statusLine(
          "steps",
          step(SENDING_NOTIFICATION_TO_USER_TIMELINE_MESSAGE),
        );

        expect(text(line)).toBe(
          worded(language, REAL_PAGE_LINE_SENTENCES.sendingToPerson),
        );
      });

      test("a level with no responders", async () => {
        const line: HTMLElement = await statusLine(
          "steps",
          step(getOnCallEmptyLevelTimelineMessage({ namesAnybody: false })),
        );

        expect(text(line)).toBe(
          worded(language, RESULT_LINE_SENTENCES.levelHasNoResponders),
        );
      });

      test("a person who was away, with when they were back in the reader's date", async () => {
        const line: HTMLElement = await statusLine(
          "steps",
          step(getAwayTimelineMessage(AWAY_UNTIL), { userName: "Jane Doe" }),
        );

        expect(text(line)).toBe(
          worded(language, LOG_LINE_SENTENCES.awayWithNobodyCovering, {
            name: "Jane Doe",
            time: OneUptimeDate.getDateAsUserFriendlyFormattedString(
              AWAY_UNTIL,
            ),
          }),
        );
      });
    });

    describe("User Settings > On-Call Logs > a log's timeline: a notification's line", () => {
      test("a method that is not verified, on a real page: what became of it, never 'the test'", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(
            getOnCallTestPageNotVerifiedMessage({
              channel: OnCallPageChannel.SMS,
              address: PHONE,
            }),
            { channelColumn: "userSmsId" },
          ),
        );

        expect(text(line)).toBe(
          worded(
            language,
            REAL_PAGE_NOT_VERIFIED_SENTENCES[OnCallPageChannel.SMS]!,
          ),
        );
        expect(text(line)).not.toBe(
          worded(
            language,
            METHOD_NOT_VERIFIED_SENTENCES[OnCallPageChannel.SMS],
          ),
        );
      });

      test("the same line of a test page: the test's words", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(
            getOnCallTestPageNotVerifiedMessage({
              channel: OnCallPageChannel.SMS,
              address: PHONE,
            }),
            { channelColumn: "userSmsId", isTestPage: true },
          ),
        );

        expect(text(line)).toBe(
          worded(
            language,
            METHOD_NOT_VERIFIED_SENTENCES[OnCallPageChannel.SMS],
          ),
        );
      });

      test("a call that failed and said nothing more", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(getOnCallSendFailedMessage(OnCallPageChannel.Call), {
            channelColumn: "userCallId",
          }),
        );

        expect(text(line)).toBe(
          worded(language, SEND_FAILED_SENTENCES[OnCallPageChannel.Call]),
        );
      });

      test("the Notification service refused it: OneUptime's words, the service's as written", async () => {
        const words: string = "Invalid 'To' phone number.";
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(
            getNotificationServiceAnswerLine({ statusCode: 400, words: words }),
            { channelColumn: "userSmsId" },
          ),
        );

        expect(text(line)).toContain(words);
        expect(text(line)).toContain("400");
        // On a page read from the right, the service's words are set apart.
        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated(words));
        }
        expect(line).not.toHaveAttribute("dir");

        if (language !== "en") {
          expect(text(line)).not.toContain(
            "The Notification service refused to send this",
          );
        }
      });
    });

    describe("User Settings > On-Call Logs: a person's page", () => {
      test("not a member of the project: names you", async () => {
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(NOT_A_PROJECT_MEMBER_STATUS_MESSAGE),
        );

        expect(text(line)).toBe(
          worded(language, NOT_PAGED_SENTENCES.notProjectMember, {
            name: "Ana Lopez",
          }),
        );
      });

      test("opted out of the severity: a real page's words", async () => {
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(
            getOnCallOptedOutStatusMessage({
              severityName: "Critical",
              pagedFor: "incidents",
            }),
          ),
        );

        expect(text(line)).toBe(
          worded(language, REAL_PAGE_LINE_SENTENCES.optedOut),
        );
      });

      test("no on-call rule, and no fallback: a real page's words", async () => {
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(NO_NOTIFICATION_RULES_STATUS_MESSAGE),
        );

        expect(text(line)).toBe(
          worded(language, REAL_PAGE_LINE_SENTENCES.noRuleNoFallback),
        );
      });
    });

    if (language !== "en") {
      test("no dialog reads the server's English for a line it has a code for", async () => {
        const cases: Array<[string, unknown, string]> = [
          [
            "runs",
            run(getOnCallPolicyRunRecordHandledMessage("incident")),
            "Execution completed because",
          ],
          [
            "steps",
            step(NOBODY_ON_CALL_IN_SCHEDULE_TIMELINE_MESSAGE, {
              scheduleName: "Primary",
            }),
            "Skipped because",
          ],
          [
            "notifications",
            notification(
              getOnCallTestPageNotVerifiedMessage({
                channel: OnCallPageChannel.SMS,
                address: PHONE,
              }),
              { channelColumn: "userSmsId" },
            ),
            "not verified",
          ],
          [
            "pages",
            personPage(NOT_A_PROJECT_MEMBER_STATUS_MESSAGE),
            "not a member",
          ],
        ];

        for (const [page, item, english] of cases) {
          cleanup();

          const line: HTMLElement = await statusLine(page, item);

          expect([page, text(line).includes(english)]).toEqual([page, false]);
        }
      });
    }
  },
);

describe.each(RIGHT_TO_LEFT)(
  "on a %s page, a line no reader can read is drawn as written, reading left to right (#8330)",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    test.each([
      [
        "runs",
        (): unknown => {
          return run("Error: connect ECONNREFUSED 10.0.0.7:5432");
        },
      ],
      [
        "steps",
        (): unknown => {
          return step("Skipped because the moon was full.");
        },
      ],
      [
        "notifications",
        (): unknown => {
          return notification(UNKNOWN_LINE, { channelColumn: "userSmsId" });
        },
      ],
      [
        "pages",
        (): unknown => {
          return personPage("Alert Sent");
        },
      ],
    ] as Array<[string, () => unknown]>)(
      "in %s",
      async (page: string, item: () => unknown) => {
        const row: { statusMessage?: string } = item() as {
          statusMessage?: string;
        };
        const line: HTMLElement = await statusLine(page, row);

        expect(line.textContent).toBe(row.statusMessage);
        expect(line).toHaveAttribute("dir", "ltr");
        expect(line.className).toContain(
          CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME,
        );
      },
    );

    test("a phone number in it keeps its '+' in front: the line reads as written", async () => {
      const line: HTMLElement = await statusLine(
        "notifications",
        notification(UNKNOWN_LINE, { channelColumn: "userSmsId" }),
      );

      expect(line.textContent).toContain(PHONE);
      expect(line).toHaveAttribute("dir", "ltr");
    });
  },
);

describe("on a page read left to right, a line no reader can read is drawn as it always was", () => {
  test.each(["en", "de"])("in %s", async (language: string) => {
    await inLanguage(language);

    const line: HTMLElement = await statusLine(
      "notifications",
      notification(UNKNOWN_LINE, { channelColumn: "userSmsId" }),
    );

    expect(line.textContent).toBe(UNKNOWN_LINE);
    expect(line).not.toHaveAttribute("dir");
    expect(line.querySelector("bdi")).toBeNull();
  });

  test("a line the Dashboard has as a key is still read in the reader's words, as the dialog always looked it up", async () => {
    await inLanguage("de");

    // A notification whose row names no method: no code, but a known line.
    const line: HTMLElement = await statusLine(
      "notifications",
      notification(getOnCallSendFailedMessage(OnCallPageChannel.SMS)),
    );

    expect(text(line)).toBe(
      worded("de", SEND_FAILED_SENTENCES[OnCallPageChannel.SMS]),
    );
  });

  test("a run with no line at all draws an empty line, not 'undefined'", async () => {
    const log: OnCallDutyPolicyExecutionLog = run("");
    const line: HTMLElement = await statusLine("runs", log);

    expect(line.textContent).toBe("");
  });

  test("a waiting run's dialog is still the waiting line (#7552)", async () => {
    const log: OnCallDutyPolicyExecutionLog = run(
      "Waiting until the change freeze ends (Europe/London).",
      { status: OnCallDutyPolicyStatus.Waiting },
    );

    PAGES["runs"]!();
    await act(async () => {
      await lastTable()
        .actionButtons.find((button: RecordedActionButton): boolean => {
          return button.title === "View Status Message";
        })!
        .onClick(
          log,
          () => {},
          () => {},
        );
    });

    expect(
      screen.getByTestId("execution-log-status-message-waiting"),
    ).toHaveTextContent("Waiting until the change freeze ends");
    expect(screen.queryByTestId("execution-log-status-message")).toBeNull();
  });
});

/*
 * THE WORDS, ONE CODE AT A TIME: a real page's row never says "the test",
 * a test page's says what its result says, and a log says then.
 */
describe("getOnCallLogLineSentence (#8330)", () => {
  const english: Translator = createTranslator(undefined, "en");

  // A line for each code, with the values it carries.
  const LINES: Record<OnCallTestPageLineCode, OnCallTestPageLine> = {
    [OnCallTestPageLineCode.MethodNotVerified]: {
      code: OnCallTestPageLineCode.MethodNotVerified,
      channel: OnCallPageChannel.Email,
    },
    [OnCallTestPageLineCode.ChannelOff]: {
      code: OnCallTestPageLineCode.ChannelOff,
      channel: OnCallPageChannel.SMS,
    },
    [OnCallTestPageLineCode.PushDeviceNoLongerReceives]: {
      code: OnCallTestPageLineCode.PushDeviceNoLongerReceives,
      isMobileApp: true,
    },
    [OnCallTestPageLineCode.NotificationServiceRefused]: {
      code: OnCallTestPageLineCode.NotificationServiceRefused,
      statusCode: 400,
      words: "Bad number.",
    },
    [OnCallTestPageLineCode.NotificationServiceAnswerFailed]: {
      code: OnCallTestPageLineCode.NotificationServiceAnswerFailed,
      statusCode: 502,
    },
    [OnCallTestPageLineCode.NotificationServiceNotReached]: {
      code: OnCallTestPageLineCode.NotificationServiceNotReached,
      reason: "ECONNREFUSED",
    },
    [OnCallTestPageLineCode.SendFailed]: {
      code: OnCallTestPageLineCode.SendFailed,
      channel: OnCallPageChannel.SMS,
    },
    [OnCallTestPageLineCode.ProjectBalanceTooLow]: {
      code: OnCallTestPageLineCode.ProjectBalanceTooLow,
      channel: OnCallPageChannel.SMS,
    },
    [OnCallTestPageLineCode.WorkspaceNotConnected]: {
      code: OnCallTestPageLineCode.WorkspaceNotConnected,
      channel: OnCallPageChannel.Slack,
      isProjectConnection: true,
    },
    [OnCallTestPageLineCode.OptedOut]: {
      code: OnCallTestPageLineCode.OptedOut,
    },
    [OnCallTestPageLineCode.NoRuleNoFallback]: {
      code: OnCallTestPageLineCode.NoRuleNoFallback,
    },
    [OnCallTestPageLineCode.NoRuleFallsBack]: {
      code: OnCallTestPageLineCode.NoRuleFallsBack,
    },
    [OnCallTestPageLineCode.NoVerifiedMethod]: {
      code: OnCallTestPageLineCode.NoVerifiedMethod,
      name: "Jane Doe",
    },
    [OnCallTestPageLineCode.FallbackFailed]: {
      code: OnCallTestPageLineCode.FallbackFailed,
    },
    [OnCallTestPageLineCode.NotProjectMember]: {
      code: OnCallTestPageLineCode.NotProjectMember,
      name: "Jane Doe",
    },
    [OnCallTestPageLineCode.AwayWithNobodyCovering]: {
      code: OnCallTestPageLineCode.AwayWithNobodyCovering,
      name: "Jane Doe",
      awayUntil: AWAY_UNTIL.toISOString(),
    },
    [OnCallTestPageLineCode.TeamHasNoMembers]: {
      code: OnCallTestPageLineCode.TeamHasNoMembers,
      name: "Platform",
    },
    [OnCallTestPageLineCode.NobodyNextInRotation]: {
      code: OnCallTestPageLineCode.NobodyNextInRotation,
      name: "Primary",
    },
    [OnCallTestPageLineCode.NobodyOnCall]: {
      code: OnCallTestPageLineCode.NobodyOnCall,
      name: "Primary",
    },
    [OnCallTestPageLineCode.LevelHasNoResponders]: {
      code: OnCallTestPageLineCode.LevelHasNoResponders,
    },
    [OnCallTestPageLineCode.LevelPagedNobody]: {
      code: OnCallTestPageLineCode.LevelPagedNobody,
    },
    [OnCallTestPageLineCode.AlreadyPaged]: {
      code: OnCallTestPageLineCode.AlreadyPaged,
    },
    [OnCallTestPageLineCode.SendingToPerson]: {
      code: OnCallTestPageLineCode.SendingToPerson,
    },
    [OnCallTestPageLineCode.RulesRan]: {
      code: OnCallTestPageLineCode.RulesRan,
    },
    [OnCallTestPageLineCode.RunUnreadable]: {
      code: OnCallTestPageLineCode.RunUnreadable,
    },
    [OnCallTestPageLineCode.NobodyPaged]: {
      code: OnCallTestPageLineCode.NobodyPaged,
    },
    [OnCallTestPageLineCode.FirstLevelReachedNobody]: {
      code: OnCallTestPageLineCode.FirstLevelReachedNobody,
    },
    [OnCallTestPageLineCode.EndedUnanswered]: {
      code: OnCallTestPageLineCode.EndedUnanswered,
      minutes: 15,
    },
    [OnCallTestPageLineCode.WentThroughEveryLevel]: {
      code: OnCallTestPageLineCode.WentThroughEveryLevel,
    },
    [OnCallTestPageLineCode.PolicyHasNoLevels]: {
      code: OnCallTestPageLineCode.PolicyHasNoLevels,
    },
  } as Record<OnCallTestPageLineCode, OnCallTestPageLine>;

  // The codes whose lines only a test page writes.
  const TEST_ONLY: Array<OnCallTestPageLineCode> = [
    OnCallTestPageLineCode.RulesRan,
    OnCallTestPageLineCode.RunUnreadable,
    OnCallTestPageLineCode.NobodyPaged,
    OnCallTestPageLineCode.FirstLevelReachedNobody,
    OnCallTestPageLineCode.EndedUnanswered,
    OnCallTestPageLineCode.WentThroughEveryLevel,
    OnCallTestPageLineCode.PolicyHasNoLevels,
  ];

  test("every code has a line here", () => {
    expect(Object.keys(LINES).sort()).toEqual(
      Object.values(OnCallTestPageLineCode).sort(),
    );
  });

  test.each(Object.values(OnCallTestPageLineCode))(
    "%s, on a real page's row, never says 'test'",
    (code: OnCallTestPageLineCode) => {
      const sentence: string | null = getOnCallLogLineSentence(english, {
        line: LINES[code],
        isTestPage: false,
      });

      if (TEST_ONLY.includes(code)) {
        expect(sentence).toBeNull();
        return;
      }

      expect(sentence).toBeTruthy();
      expect([code, SAYS_TEST.test(sentence!)]).toEqual([code, false]);
    },
  );

  test.each(Object.values(OnCallTestPageLineCode))(
    "%s, on a test page's row, says what its result says - but of then",
    (code: OnCallTestPageLineCode) => {
      const sentence: string | null = getOnCallLogLineSentence(english, {
        line: LINES[code],
        isTestPage: true,
      });
      const live: string | null = getResultLineSentence(english, LINES[code]);

      if (
        code === OnCallTestPageLineCode.NobodyOnCall ||
        code === OnCallTestPageLineCode.NobodyNextInRotation ||
        code === OnCallTestPageLineCode.AwayWithNobodyCovering
      ) {
        expect(sentence).toBeTruthy();
        expect(sentence).not.toBe(live);
        return;
      }

      expect(sentence).toBe(live);
    },
  );

  test("a log says then: nobody was on call, was next, was away", () => {
    for (const isTestPage of [true, false]) {
      expect(
        withoutIsolateMarks(
          getOnCallLogLineSentence(english, {
            line: LINES[OnCallTestPageLineCode.NobodyOnCall],
            isTestPage,
          })!,
        ),
      ).toBe("Nobody was on call in schedule Primary.");
      expect(
        withoutIsolateMarks(
          getOnCallLogLineSentence(english, {
            line: LINES[OnCallTestPageLineCode.NobodyNextInRotation],
            isTestPage,
          })!,
        ),
      ).toBe("Nobody was next in the rotation of schedule Primary.");
      expect(
        withoutIsolateMarks(
          getOnCallLogLineSentence(english, {
            line: LINES[OnCallTestPageLineCode.AwayWithNobodyCovering],
            isTestPage,
          })!,
        ),
      ).toContain("Jane Doe was away until");
    }
  });

  test("a line about a schedule or a person that names none is no sentence", () => {
    for (const code of [
      OnCallTestPageLineCode.NobodyOnCall,
      OnCallTestPageLineCode.NobodyNextInRotation,
    ]) {
      expect(
        getOnCallLogLineSentence(english, {
          line: { code: code },
          isTestPage: false,
        }),
      ).toBeNull();
    }

    expect(
      getOnCallLogLineSentence(english, {
        line: { code: OnCallTestPageLineCode.AwayWithNobodyCovering },
        isTestPage: false,
      }),
    ).toBeNull();
    // Away with no name is "Someone", as a test's result says it.
    expect(
      withoutIsolateMarks(
        getOnCallLogLineSentence(english, {
          line: {
            code: OnCallTestPageLineCode.AwayWithNobodyCovering,
            awayUntil: AWAY_UNTIL.toISOString(),
          },
          isTestPage: false,
        })!,
      ),
    ).toMatch(/^Someone was away until/);
  });

  test("no line is no sentence", () => {
    for (const isTestPage of [true, false]) {
      expect(
        getOnCallLogLineSentence(english, { line: null, isTestPage }),
      ).toBeNull();
      expect(
        getOnCallLogLineSentence(english, { line: undefined, isTestPage }),
      ).toBeNull();
    }
  });

  test.each(Object.keys(REAL_PAGE_NOT_VERIFIED_SENTENCES))(
    "a %s method that is not verified, on a real page, names what was not sent",
    (channel: string) => {
      const sentence: string = getOnCallLogLineSentence(english, {
        line: {
          code: OnCallTestPageLineCode.MethodNotVerified,
          channel: channel as OnCallPageChannel,
        },
        isTestPage: false,
      })!;

      expect(sentence).toBe(
        REAL_PAGE_NOT_VERIFIED_SENTENCES[channel as OnCallPageChannel],
      );
      expect(sentence).toMatch(/not (sent|made)/i);
    },
  );

  test("every channel the readers say is not verified has a real page's sentence", () => {
    expect(Object.keys(REAL_PAGE_NOT_VERIFIED_SENTENCES).sort()).toEqual(
      [
        OnCallPageChannel.Email,
        OnCallPageChannel.SMS,
        OnCallPageChannel.WhatsApp,
        OnCallPageChannel.Call,
        OnCallPageChannel.Telegram,
        OnCallPageChannel.Slack,
        OnCallPageChannel.MicrosoftTeams,
        OnCallPageChannel.Mattermost,
        OnCallPageChannel.CustomChannel,
      ].sort(),
    );
  });
});

describe("the channel a notification went by (#8330)", () => {
  test("its method column says it, even with the method gone", () => {
    expect(
      getOnCallLogNotificationChannel(
        notification("x", { channelColumn: "userWhatsAppId" }),
      ),
    ).toBe(OnCallPageChannel.WhatsApp);
  });

  test("or the method read with it", () => {
    const row: UserOnCallLogTimeline = notification("x");
    (row as unknown as Record<string, unknown>)["userCall"] = {
      phone: PHONE,
    };

    expect(getOnCallLogNotificationChannel(row)).toBe(OnCallPageChannel.Call);
  });

  test("or none", () => {
    expect(getOnCallLogNotificationChannel(notification("x"))).toBeNull();
    expect(getOnCallLogNotificationChannel({})).toBeNull();
  });
});

/*
 * THE NEW SENTENCES ARE WORDED IN EVERY DASHBOARD LANGUAGE, their values
 * kept: never the English left as a placeholder.
 */
describe("the logs' sentences, in every Dashboard language (#8330)", () => {
  const KEYS: Array<string> = [
    ...Object.values(REAL_PAGE_NOT_VERIFIED_SENTENCES),
    ...Object.values(REAL_PAGE_LINE_SENTENCES),
    ...Object.values(LOG_LINE_SENTENCES),
    ...Object.values(RUN_LINE_SENTENCES),
    ...Object.values(RUN_RECORD_HANDLED_SENTENCES),
    ...Object.values(RUN_RECORD_RESOLVED_SENTENCES),
  ] as Array<string>;

  test("thirty-one sentences, each a key of its own", () => {
    expect(KEYS).toHaveLength(31);
    expect(new Set(KEYS).size).toBe(31);
  });

  test.each(KEYS)("English has %s, as itself", (key: string) => {
    expect(readDashboardLocale("en")[key]).toBe(key);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every one, its values kept",
    (language: string) => {
      for (const key of KEYS) {
        const value: string = readDashboardLocale(language)[key] || "";

        expect({
          language,
          key,
          worded: isWordedInDashboardLocale(key, language),
        }).toEqual({
          language,
          key,
          worded: true,
        });
        expect({ language, key, value: value !== key }).toEqual({
          language,
          key,
          value: true,
        });
        expect({ language, key, placeholders: placeholdersOf(value) }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(key),
        });
        // A sentence, ended as its language ends one.
        expect({ language, key, ended: SENTENCE_END.test(value) }).toEqual({
          language,
          key,
          ended: true,
        });
      }
    },
  );

  test("the run's English is the worker's own line, byte for byte, where it names no record", () => {
    expect(RUN_LINE_SENTENCES.wentThroughEveryRule).toBe(
      ON_CALL_POLICY_RUN_WENT_THROUGH_EVERY_RULE_MESSAGE,
    );
    expect(RUN_LINE_SENTENCES.everybodyEscalated).toBe(
      ON_CALL_POLICY_RUN_EVERYBODY_PASSED_ON_MESSAGE,
    );
    expect(RUN_LINE_SENTENCES.nobodyNotified).toBe(
      ON_CALL_POLICY_RUN_NOBODY_NOTIFIED_MESSAGE,
    );
    expect(RUN_LINE_SENTENCES.policyArchivedNotRun).toBe(
      ON_CALL_POLICY_ARCHIVED_NOT_EXECUTED_MESSAGE,
    );
  });

  test("every kind of record a run names has its two sentences", () => {
    expect(Object.keys(RUN_RECORD_HANDLED_SENTENCES).sort()).toEqual(
      [...ON_CALL_POLICY_RUN_RECORD_KINDS].sort(),
    );
    expect(Object.keys(RUN_RECORD_RESOLVED_SENTENCES).sort()).toEqual(
      [...ON_CALL_POLICY_RUN_RECORD_KINDS].sort(),
    );
  });

  test("negative control: the check tells an English placeholder apart", () => {
    expect(NEXT_IN_ROTATION_SCHEDULES_KEY).toBeTruthy();
    expect(
      isWordedInDashboardLocale(
        `${RUN_LINE_SENTENCES.wentThroughEveryRule} (no such key)`,
        "de",
      ),
    ).toBe(false);
  });
});
