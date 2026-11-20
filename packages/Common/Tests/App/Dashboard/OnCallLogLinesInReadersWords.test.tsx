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
  LOG_CALL_ANSWERED_AND_LASTED,
  LOG_CALL_ID,
  LOG_CALL_OUTCOME_SENTENCES,
  LOG_DIRECT_PAGE_PAGED,
  LOG_LINE_SENTENCES,
  LOG_NOTIFICATION_STUCK,
  LOG_OWN_LINE_SENTENCES,
  LOG_PAGE_ACKNOWLEDGED_BY_SENTENCES,
  LOG_PAGE_LINE_SENTENCES,
  LOG_PAGE_RECORD_ACKNOWLEDGED_SENTENCES,
  LOG_PAGE_RECORD_DELETED_SENTENCES,
  LOG_PAGE_SEEN_BY_OBSERVER_SENTENCES,
  LOG_PROVIDER_STATUS_SENTENCES,
  LOG_PAGE_HANDED_OVER,
  LOG_PAGE_OUT_OF_TRIES,
  LOG_PAGE_OUT_OF_TRIES_NEXT,
  LOG_RUN_OUT_OF_TRIES_NEXT,
  LOG_RUN_OUT_OF_TRIES_PAGING,
  LOG_RUN_OUT_OF_TRIES_WAITING,
  LOG_TEST_PAGE_SENT,
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
import {
  OnCallPageChannel,
  ON_CALL_PAGE_SENT_STATUS_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  describeOnCallAcknowledgementTimeout,
  getOnCallPageAgainStatusMessage,
  ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
} from "../../../Types/OnCallDutyPolicy/OnCallAcknowledgementTimeout";
import {
  getOnCallDirectPagePagingMessage,
  ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
  ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
  ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallDirectPage";
import {
  LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
  ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
  ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallPagePassOn";
import {
  getOnCallPolicyRunOutOfTriesMessage,
  getUserOnCallLogOutOfTriesMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallPolicyRunRetry";
import {
  getUserOnCallLogHandedOverMessage,
  ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
  ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
  ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
  ON_CALL_RUN_PAGING_STARTED_MESSAGE,
  ON_CALL_RUN_SCHEDULED_MESSAGE,
  USER_LOG_TIMED_OUT_STATUS_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallRunStart";
import { getSentWithoutImagesStatusMessage } from "../../../../App/FeatureSet/Notification/Utils/EmailStatusMessage";
import { getOnCallObserverPageSeenMessage } from "../../../Types/OnCallDutyPolicy/OnCallObserverPage";
import {
  getOnCallPageAcknowledgedByMessage,
  getOnCallPageOverRecordResolvedReason,
  getUserOnCallLogEndedMessage,
  getUserOnCallLogRecordAcknowledgedMessage,
  ON_CALL_PAGE_OVER_PAGE_ACKNOWLEDGED_REASON,
  ON_CALL_PAGE_OVER_PAGE_AGAIN_ACKNOWLEDGED_REASON,
} from "../../../Types/OnCallDutyPolicy/OnCallPageEnding";
import { getOnCallPageRecordDeletedMessage } from "../../../Types/OnCallDutyPolicy/OnCallPageRecordGone";
import {
  CALL_ANSWERED_MESSAGE,
  CALL_BUSY_MESSAGE,
  CALL_FAX_MESSAGE,
  CALL_NOT_CONNECTED_MESSAGE,
  CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE,
  CALL_VOICEMAIL_NO_MESSAGE_MESSAGE,
  CALL_RANG_OUT_MESSAGE,
  CallOutcomeLine,
  EMAIL_SENT_STATUS_MESSAGE,
  getCallAnsweredAndLastedMessage,
  getCallIdStatusMessage,
  getCallOutcomeMessage,
  getMessageIdStatusMessage,
  getProviderDeliveryStatusMessage,
  getStuckNotificationStatusMessage,
  getWorkspaceMessageSentMessage,
  ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
  ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE,
  PUSH_NOTIFICATION_SENT_MESSAGE,
  TELEGRAM_MESSAGE_SENT_MESSAGE,
  WHATSAPP_MESSAGE_SENT_MESSAGE,
} from "../../../Types/OnCallDutyPolicy/OnCallSentLine";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import {
  getOnCallOptedOutStatusMessage,
  NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
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
  getOnCallTestPagePagingMessage,
  ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE,
  ON_CALL_TEST_PAGE_NOBODY_PAGED_MESSAGE,
  OnCallTestPageLine,
  OnCallTestPageLineCode,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import { getOnCallTestPageNotVerifiedMessage } from "../../../Types/OnCallDutyPolicy/OnCallTestPageLine";
import { NEXT_IN_ROTATION_SCHEDULES_KEY } from "../../../Types/OnCallDutyPolicy/NextInRotation";
import {
  createTranslator,
  PluralTemplate,
  Translator,
} from "../../../Types/Translator";
import UserNotificationEventType from "../../../Types/UserNotification/UserNotificationEventType";
import UserUtil from "../../../UI/Utils/User";
import { CLAMPED_LINES_ALIGNED_AS_THE_PAGE_CLASS_NAME } from "../../../UI/Utils/LineDirection";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { isolated, withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { withNumbersKeptWithUnits } from "../../../Types/NoBreakSpaces";

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

/*
 * The reader's sentence for `key`, its values filled in as written, set as
 * the page's Translator sets it: a figure held to the duration's word after
 * it (#8770).
 */
function worded(
  language: string,
  key: string,
  values: Record<string, string> = {},
): string {
  let text: string = withNumbersKeptWithUnits(
    language === "en" ? key : readDashboardLocale(language)[key]!,
    key,
    { durationWords: true },
  );

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
          // A line OneUptime never writes: "Alert Sent" is worded since #8434.
          return personPage("Paused by an operator.");
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

/*
 * THE REST OF A LOG'S OWN LINES, IN THE READER'S WORDS (#8434): a run on
 * its way, a direct page's, a page again's, a run or a page that timed out
 * or ran out of tries, a step skipped by escalating, a person's page, a
 * notification that went out or was acknowledged. Each was drawn as
 * written - English on every page. Read here on the real four pages, in
 * their real dialogs, with the shipped locales, in en, de, fa and ar.
 */
describe.each(LANGUAGES)(
  "a %s reader reads the rest of a log's own lines in their own words (#8434)",
  (language: string) => {
    const translator: Translator = dashboardTranslator(language);

    // A count-dependent sentence, in the form the reader's language picks.
    const pluralWorded: (
      template: PluralTemplate,
      count: number,
      values?: Record<string, string>,
    ) => string = (
      template: PluralTemplate,
      count: number,
      values: Record<string, string> = {},
    ): string => {
      const isOne: boolean =
        new Intl.PluralRules(language).select(count) === "one";
      const key: string = isOne ? `${template.other}_one` : template.other;
      // Set as the page's Translator sets it: a duration's figure held (#8770).
      let words: string = withNumbersKeptWithUnits(
        language === "en"
          ? isOne
            ? template.one
            : template.other
          : readDashboardLocale(language)[key]!,
        isOne ? template.one : template.other,
        { durationWords: true },
      );

      if (language !== "en") {
        expect({ language, key, worded: words !== key }).toEqual({
          language,
          key,
          worded: true,
        });
      }

      for (const [name, value] of Object.entries({
        count: translator.formatNumber(count),
        ...values,
      })) {
        words = words.split(`{{${name}}}`).join(value);
      }

      return words;
    };

    // The reader's language has no English left, but names and values.
    const expectNoEnglish: (line: HTMLElement, keep?: Array<string>) => void = (
      line: HTMLElement,
      keep: Array<string> = [],
    ): void => {
      if (language === "en") {
        return;
      }

      let words: string = text(line);

      for (const name of [
        "OneUptime",
        "Telegram",
        "WhatsApp",
        "Slack",
        ...keep,
      ]) {
        words = words.split(name).join("");
      }

      expect(words).not.toMatch(
        /\b(scheduled|execution|started|paging|paged|sent|skipped|escalated|notification|timed|tried|failed|again)\b/i,
      );
    };

    beforeEach(async () => {
      await inLanguage(language);
    });

    describe("On-Call > Execution Logs: a run on its way, and a direct page's, a page again's and a stuck run's", () => {
      test.each([
        [ON_CALL_RUN_SCHEDULED_MESSAGE, LOG_OWN_LINE_SENTENCES.runScheduled],
        [
          ON_CALL_RUN_EXECUTION_STARTED_MESSAGE,
          LOG_OWN_LINE_SENTENCES.runStarted,
        ],
        [
          ON_CALL_RUN_PAGING_STARTED_MESSAGE,
          LOG_OWN_LINE_SENTENCES.runPagingStarted,
        ],
        [
          ON_CALL_POLICY_RUN_TIMED_OUT_MESSAGE,
          LOG_OWN_LINE_SENTENCES.runTimedOut,
        ],
        [
          ON_CALL_POLICY_RUN_NEVER_STARTED_MESSAGE,
          LOG_OWN_LINE_SENTENCES.runNeverStarted,
        ],
        [
          ON_CALL_DIRECT_PAGE_NOBODY_PAGED_MESSAGE,
          LOG_OWN_LINE_SENTENCES.directPageNobodyPaged,
        ],
        [
          ON_CALL_DIRECT_PAGE_TIMED_OUT_MESSAGE,
          LOG_OWN_LINE_SENTENCES.directPageTimedOut,
        ],
        [
          ON_CALL_DIRECT_PAGE_NEVER_STARTED_MESSAGE,
          LOG_OWN_LINE_SENTENCES.directPageNeverStarted,
        ],
      ] as Array<[string, string]>)(
        "%s",
        async (message: string, key: string) => {
          const line: HTMLElement = await statusLine(
            "runs",
            run(message, { status: OnCallDutyPolicyStatus.Started }),
          );

          expect(text(line)).toBe(worded(language, key));
          expect(text(line)).not.toMatch(SAYS_TEST);
          expect(line).not.toHaveAttribute("dir");
          expectNoEnglish(line);
        },
      );

      test.each([1, 3, 21])(
        "a direct page that paged %i: how many, in the reader's plural and digits",
        async (count: number) => {
          const line: HTMLElement = await statusLine(
            "runs",
            run(getOnCallDirectPagePagingMessage(count)),
          );

          expect(text(line)).toBe(pluralWorded(LOG_DIRECT_PAGE_PAGED, count));
          expectNoEnglish(line);
        },
      );

      test("a page again: which of how many, and the policy's timeout in the reader's words", async () => {
        const line: HTMLElement = await statusLine(
          "runs",
          run(
            getOnCallPageAgainStatusMessage({
              pageAgainNumber: 2,
              minutes: 90,
            }),
          ),
        );

        expect(text(line)).toBe(
          withoutIsolateMarks(
            worded(language, LOG_OWN_LINE_SENTENCES.pagingAgain, {
              number: translator.formatNumber(2),
              max: translator.formatNumber(
                ON_CALL_ACKNOWLEDGEMENT_TIMEOUT_MAX_PAGES_AGAIN,
              ),
              duration: describeOnCallAcknowledgementTimeout(90, translator),
            }),
          ),
        );
        expectNoEnglish(line);
      });

      test("a run that ran out of tries: what happened, the error as written, and what to do", async () => {
        const error: string = "Connection terminated unexpectedly.";
        const line: HTMLElement = await statusLine(
          "runs",
          run(
            getOnCallPolicyRunOutOfTriesMessage({
              failures: {
                failedTries: 10,
                firstFailedAt: new Date("2026-11-15T09:00:00.000Z"),
                lastFailedAt: new Date("2026-11-15T09:37:00.000Z"),
                retryAt: new Date("2026-11-15T09:42:00.000Z"),
                lastError: error,
              },
              wasWaiting: false,
              recordKind: "incident",
            }),
            { status: OnCallDutyPolicyStatus.Error },
          ),
        );

        expect(text(line)).toBe(
          withoutIsolateMarks(
            joinSentences([
              pluralWorded(LOG_RUN_OUT_OF_TRIES_PAGING, 10, {
                duration: translator.translatePlural(
                  { one: "{{count}} minute", other: "{{count}} minutes" },
                  37,
                ),
              }),
              worded(language, LOG_OWN_LINE_SENTENCES.lastTryFailedWith, {
                error: error,
              }),
              worded(
                language,
                LOG_RUN_OUT_OF_TRIES_NEXT[OnCallPolicyRunRecordKind.Incident],
              ),
            ]),
          ),
        );
        // The error is the server's own words: set apart, as written, where a page reads from the right.
        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated(error));
        }
        expectNoEnglish(line, [error]);
      });

      test("a test page's paging lines are worded on a test page's row: it may say test there", async () => {
        const sent: HTMLElement = await statusLine(
          "runs",
          run(getOnCallTestPagePagingMessage(2), { isTestPage: true }),
        );

        expect(text(sent)).toBe(pluralWorded(LOG_TEST_PAGE_SENT, 2));
        cleanup();

        const firstLevel: HTMLElement = await statusLine(
          "runs",
          run(ON_CALL_TEST_PAGE_FIRST_LEVEL_PAGED_MESSAGE, {
            isTestPage: true,
          }),
        );

        expect(text(firstLevel)).toBe(
          worded(language, LOG_OWN_LINE_SENTENCES.testPageSentToFirstLevel),
        );
      });

      test("a test page's paging line on a real page's row is never worded as a test's: it is drawn as written", async () => {
        const message: string = getOnCallTestPagePagingMessage(2);
        const line: HTMLElement = await statusLine("runs", run(message));

        expect(line.textContent).toBe(message);
      });
    });

    describe("On-Call > Execution Logs > a run's timeline: a step skipped", () => {
      test.each([
        [
          ON_CALL_LEVEL_SKIPPED_BY_ESCALATION_TIMELINE_MESSAGE,
          LOG_OWN_LINE_SENTENCES.levelSkippedByEscalation,
        ],
        [
          ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
          LOG_OWN_LINE_SENTENCES.skippedAsEscalated,
        ],
        [
          LEGACY_ON_CALL_PAGE_PASSED_ON_SKIP_TIMELINE_MESSAGE,
          LOG_OWN_LINE_SENTENCES.skippedAsEscalated,
        ],
        [
          ON_CALL_DIRECT_PAGE_NOBODY_TO_PAGE_TIMELINE_MESSAGE,
          LOG_OWN_LINE_SENTENCES.directPageNobodyToPage,
        ],
      ] as Array<[string, string]>)(
        "%s",
        async (message: string, key: string) => {
          const line: HTMLElement = await statusLine("steps", step(message));

          expect(text(line)).toBe(worded(language, key));
          expect(text(line)).not.toMatch(SAYS_TEST);
          expectNoEnglish(line);
        },
      );
    });

    describe("User Settings > On-Call Logs: a person's page", () => {
      test.each([
        [ON_CALL_PAGE_SENT_STATUS_MESSAGE, LOG_OWN_LINE_SENTENCES.pageSent],
        [
          ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
          LOG_OWN_LINE_SENTENCES.pageEscalated,
        ],
        [
          LEGACY_ON_CALL_PAGE_PASSED_ON_STATUS_MESSAGE,
          LOG_OWN_LINE_SENTENCES.pageEscalated,
        ],
        [
          USER_LOG_TIMED_OUT_STATUS_MESSAGE,
          LOG_OWN_LINE_SENTENCES.pageTimedOut,
        ],
      ] as Array<[string, string]>)(
        "%s",
        async (message: string, key: string) => {
          const line: HTMLElement = await statusLine(
            "pages",
            personPage(message),
          );

          expect(text(line)).toBe(worded(language, key));
          expect(text(line)).not.toMatch(SAYS_TEST);
          expectNoEnglish(line);
        },
      );

      test("a page handed over: its minutes, in the reader's plural", async () => {
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(getUserOnCallLogHandedOverMessage(5)),
        );

        expect(text(line)).toBe(pluralWorded(LOG_PAGE_HANDED_OVER, 5));
        expectNoEnglish(line);
      });

      test("a page that ran out of tries, about an alert", async () => {
        const error: string = "Deadlock found when trying to get lock.";
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(
            getUserOnCallLogOutOfTriesMessage({
              failures: {
                failedTries: 10,
                firstFailedAt: new Date("2026-11-15T09:00:00.000Z"),
                lastFailedAt: new Date("2026-11-15T09:00:20.000Z"),
                retryAt: new Date("2026-11-15T09:05:00.000Z"),
                lastError: error,
              },
              recordKind: "alert",
            }),
          ),
        );

        expect(text(line)).toBe(
          withoutIsolateMarks(
            joinSentences([
              pluralWorded(LOG_PAGE_OUT_OF_TRIES, 10, {
                duration: worded(language, "less than a minute"),
              }),
              worded(language, LOG_OWN_LINE_SENTENCES.lastTryFailedWith, {
                error: error,
              }),
              worded(
                language,
                LOG_PAGE_OUT_OF_TRIES_NEXT[OnCallPolicyRunRecordKind.Alert],
              ),
            ]),
          ),
        );
        expectNoEnglish(line, [error]);
      });
    });

    describe("User Settings > On-Call Logs > a log's timeline: a notification", () => {
      test.each([
        [
          ON_CALL_NOTIFICATION_ACKNOWLEDGED_MESSAGE,
          "userSmsId",
          LOG_OWN_LINE_SENTENCES.notificationAcknowledged,
        ],
        [
          ON_CALL_PAGE_PASSED_ON_DELIVERY_MESSAGE,
          "userCallId",
          LOG_OWN_LINE_SENTENCES.notificationEscalatedFrom,
        ],
        [
          EMAIL_SENT_STATUS_MESSAGE,
          "userEmailId",
          LOG_OWN_LINE_SENTENCES.emailSent,
        ],
        [
          PUSH_NOTIFICATION_SENT_MESSAGE,
          "userPushId",
          LOG_OWN_LINE_SENTENCES.pushSent,
        ],
        [
          TELEGRAM_MESSAGE_SENT_MESSAGE,
          "userTelegramId",
          LOG_OWN_LINE_SENTENCES.telegramSent,
        ],
        [
          WHATSAPP_MESSAGE_SENT_MESSAGE,
          "userWhatsAppId",
          LOG_OWN_LINE_SENTENCES.whatsAppSent,
        ],
      ] as Array<[string, string, string]>)(
        "%s",
        async (message: string, column: string, key: string) => {
          const line: HTMLElement = await statusLine(
            "notifications",
            notification(message, { channelColumn: column }),
          );

          expect(text(line)).toBe(worded(language, key));
          expect(text(line)).not.toMatch(SAYS_TEST);
          expectNoEnglish(line);
        },
      );

      test("a message sent on a workspace names it, set apart", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(getWorkspaceMessageSentMessage("Slack"), {
            channelColumn: "userSlackId",
          }),
        );

        expect(text(line)).toBe(
          worded(language, LOG_OWN_LINE_SENTENCES.workspaceMessageSent, {
            name: "Slack",
          }),
        );
        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated("Slack"));
        }
      });

      test("an SMS and a call by their provider's ids, set apart", async () => {
        const sms: HTMLElement = await statusLine(
          "notifications",
          notification(getMessageIdStatusMessage("SM0123"), {
            channelColumn: "userSmsId",
          }),
        );

        expect(text(sms)).toBe(
          worded(language, LOG_OWN_LINE_SENTENCES.sentWithMessageId, {
            id: "SM0123",
          }),
        );
        if (RIGHT_TO_LEFT.includes(language)) {
          expect(sms.textContent).toContain(isolated("SM0123"));
        }
        cleanup();

        const call: HTMLElement = await statusLine(
          "notifications",
          notification(getCallIdStatusMessage("CA0123"), {
            channelColumn: "userCallId",
          }),
        );

        expect(text(call)).toBe(
          worded(language, LOG_OWN_LINE_SENTENCES.callPlaced, {
            id: "CA0123",
          }),
        );
        expectNoEnglish(call, ["CA0123"]);
      });
    });
  },
);

/*
 * THE REST OF A LOG'S SENTENCES, IN EVERY DASHBOARD LANGUAGE (#8434): a
 * value of their own, their placeholders kept, ended as the language ends
 * a sentence - plurals in both forms.
 */
describe("the rest of the logs' sentences, in every Dashboard language (#8434)", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(LOG_OWN_LINE_SENTENCES),
    ...Object.values(LOG_RUN_OUT_OF_TRIES_NEXT),
    ...Object.values(LOG_PAGE_OUT_OF_TRIES_NEXT),
  ];
  const PLURALS: Array<PluralTemplate> = [
    LOG_DIRECT_PAGE_PAGED,
    LOG_TEST_PAGE_SENT,
    LOG_PAGE_HANDED_OVER,
    LOG_RUN_OUT_OF_TRIES_WAITING,
    LOG_RUN_OUT_OF_TRIES_PAGING,
    LOG_PAGE_OUT_OF_TRIES,
  ];
  const KEYS: Array<string> = [
    ...SENTENCES,
    ...PLURALS.flatMap((template: PluralTemplate): Array<string> => {
      return [template.other, `${template.other}_one`];
    }),
  ];

  test("forty-six keys, each its own", () => {
    expect(SENTENCES).toHaveLength(34);
    expect(new Set(KEYS).size).toBe(KEYS.length);
    expect(KEYS).toHaveLength(46);
  });

  test("English has each, as itself, and its one forms", () => {
    const en: Record<string, string> = readDashboardLocale("en");

    for (const key of SENTENCES) {
      expect(en[key]).toBe(key);
    }

    for (const template of PLURALS) {
      expect(en[template.other]).toBe(template.other);
      expect(en[`${template.other}_one`]).toBe(template.one);
    }
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every one, its values kept",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        const value: string = locale[key] || "";
        const english: string = key.endsWith("_one")
          ? PLURALS.find((template: PluralTemplate): boolean => {
              return `${template.other}_one` === key;
            })!.one
          : key;

        expect({
          language,
          key,
          worded: Boolean(value) && value !== english,
        }).toEqual({ language, key, worded: true });
        expect({ language, key, placeholders: placeholdersOf(value) }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english),
        });

        // A sentence ends as its language ends one, but the error's line.
        if (english !== LOG_OWN_LINE_SENTENCES.lastTryFailedWith) {
          expect({ language, key, ended: SENTENCE_END.test(value) }).toEqual({
            language,
            key,
            ended: true,
          });
        }
      }
    },
  );

  test("a real page's sentences never say test; the two a test page's row says do", () => {
    for (const key of SENTENCES) {
      if (key === LOG_OWN_LINE_SENTENCES.testPageSentToFirstLevel) {
        expect(key).toMatch(SAYS_TEST);
        continue;
      }

      expect({ key, saysTest: SAYS_TEST.test(key) }).toEqual({
        key,
        saysTest: false,
      });
    }

    expect(LOG_TEST_PAGE_SENT.other).toMatch(SAYS_TEST);
  });

  test("each record kind a run names has what to do, for a run and for a page", () => {
    for (const words of [
      LOG_RUN_OUT_OF_TRIES_NEXT,
      LOG_PAGE_OUT_OF_TRIES_NEXT,
    ]) {
      expect(Object.keys(words).sort()).toEqual(
        [...ON_CALL_POLICY_RUN_RECORD_KINDS].sort(),
      );
    }
  });
});

/*
 * THE LAST OF A LOG'S OWN LINES, IN THE READER'S WORDS (#8551): a person's
 * page that ended, was acknowledged or seen; a notification an observer
 * saw, or the stuck check settled; a provider's delivery report; an email
 * sent without its images. On the real pages, with the shipped locales.
 */
describe.each(LANGUAGES)(
  "a %s reader reads a person's page's and a notification's last lines in their own words (#8551)",
  (language: string) => {
    beforeEach(async () => {
      await inLanguage(language);
    });

    // What a German, Persian or Arabic line keeps of English: names and values.
    const expectNoEnglish: (line: HTMLElement, keep?: Array<string>) => void = (
      line: HTMLElement,
      keep: Array<string> = [],
    ): void => {
      if (language === "en") {
        return;
      }

      let words: string = text(line);

      for (const value of ["OneUptime", ...keep]) {
        words = words.split(value).join("");
      }

      expect(words).not.toMatch(
        /\b(execution|completed|acknowledged|deleted|seen|observer|sending|provider|delivered|stopped|email|images)\b/i,
      );
    };

    describe("User Settings > On-Call Logs: a person's page", () => {
      test.each([
        [
          getUserOnCallLogEndedMessage(
            ON_CALL_PAGE_OVER_PAGE_ACKNOWLEDGED_REASON,
          ),
          LOG_PAGE_LINE_SENTENCES.pageOverPageAcknowledged,
        ],
        [
          getUserOnCallLogEndedMessage(
            ON_CALL_PAGE_OVER_PAGE_AGAIN_ACKNOWLEDGED_REASON,
          ),
          LOG_PAGE_LINE_SENTENCES.pageOverPageAgainAcknowledged,
        ],
        [
          getOnCallPageRecordDeletedMessage(null),
          LOG_PAGE_LINE_SENTENCES.pageNamesNoRecord,
        ],
        [
          NO_LONGER_A_PROJECT_MEMBER_STATUS_MESSAGE,
          LOG_PAGE_LINE_SENTENCES.pageNoLongerProjectMember,
        ],
      ] as Array<[string, string]>)(
        "%s",
        async (message: string, key: string) => {
          const line: HTMLElement = await statusLine(
            "pages",
            personPage(message),
          );

          expect(text(line)).toBe(worded(language, key));
          expect(text(line)).not.toMatch(SAYS_TEST);
          expectNoEnglish(line);
        },
      );

      test.each([...ON_CALL_POLICY_RUN_RECORD_KINDS])(
        "its %s acknowledged, resolved or deleted",
        async (kind: OnCallPolicyRunRecordKind) => {
          for (const [message, key] of [
            [
              getUserOnCallLogRecordAcknowledgedMessage(kind),
              LOG_PAGE_RECORD_ACKNOWLEDGED_SENTENCES[kind],
            ],
            [
              getUserOnCallLogEndedMessage(
                getOnCallPageOverRecordResolvedReason(kind),
              ),
              RUN_RECORD_RESOLVED_SENTENCES[kind],
            ],
            [
              getOnCallPageRecordDeletedMessage(kind),
              LOG_PAGE_RECORD_DELETED_SENTENCES[kind],
            ],
          ] as Array<[string, string]>) {
            cleanup();

            const line: HTMLElement = await statusLine(
              "pages",
              personPage(message),
            );

            expect(text(line)).toBe(worded(language, key));
            expectNoEnglish(line);
          }
        },
      );

      test("acknowledged by its person: who, set apart, as written", async () => {
        const who: string = "Ana Lopez (ana@acme.example)";
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(
            getOnCallPageAcknowledgedByMessage({
              recordLabel: "Alert Episode",
              userName: "Ana Lopez",
              userEmail: "ana@acme.example",
            }),
          ),
        );

        expect(text(line)).toBe(
          worded(
            language,
            LOG_PAGE_ACKNOWLEDGED_BY_SENTENCES[
              OnCallPolicyRunRecordKind.AlertEpisode
            ],
            { name: who },
          ),
        );

        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated(who));
        }

        expectNoEnglish(line, ["Ana Lopez", "ana@acme.example"]);
      });

      test("seen by an observer: who, and the record not acknowledged by it", async () => {
        const line: HTMLElement = await statusLine(
          "pages",
          personPage(
            getOnCallObserverPageSeenMessage({
              kind: "incident",
              userName: "Ana Lopez",
              userEmail: "",
            }),
          ),
        );

        expect(text(line)).toBe(
          worded(
            language,
            LOG_PAGE_SEEN_BY_OBSERVER_SENTENCES[
              OnCallPolicyRunRecordKind.Incident
            ],
            { name: "Ana Lopez" },
          ),
        );
        expectNoEnglish(line, ["Ana Lopez"]);
      });
    });

    describe("User Settings > On-Call Logs > a log's timeline: a notification", () => {
      test("an observer's notification marked as seen", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(ON_CALL_OBSERVER_NOTIFICATION_SEEN_MESSAGE, {
            channelColumn: "userPushId",
          }),
        );

        expect(text(line)).toBe(
          worded(language, LOG_PAGE_LINE_SENTENCES.notificationSeenAsObserver),
        );
        expectNoEnglish(line);
      });

      test("a notification the stuck check settled, its minutes in the reader's plural", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(getStuckNotificationStatusMessage(15), {
            channelColumn: "userCallId",
          }),
        );
        const translator: Translator = dashboardTranslator(language);
        const words: string =
          language === "en"
            ? LOG_NOTIFICATION_STUCK.other
            : readDashboardLocale(language)[LOG_NOTIFICATION_STUCK.other]!;

        // As the page's Translator sets it: the figure held to its word (#8770).
        expect(text(line)).toBe(
          withNumbersKeptWithUnits(words, LOG_NOTIFICATION_STUCK.other, {
            durationWords: true,
          })
            .split("{{count}}")
            .join(translator.formatNumber(15)),
        );
        expectNoEnglish(line);
      });

      test("an SMS the provider delivered, and one it could not, with its id and error code", async () => {
        const delivered: HTMLElement = await statusLine(
          "notifications",
          notification(
            getProviderDeliveryStatusMessage({
              status: "Delivered",
              messageId: "SM0123",
            }),
            { channelColumn: "userSmsId" },
          ),
        );

        expect(text(delivered)).toBe(
          joinSentences([
            worded(language, LOG_PROVIDER_STATUS_SENTENCES["Delivered"]!),
            worded(language, LOG_PAGE_LINE_SENTENCES.providerMessageId, {
              id: "SM0123",
            }),
          ]),
        );
        cleanup();

        const undelivered: HTMLElement = await statusLine(
          "notifications",
          notification(
            getProviderDeliveryStatusMessage({
              status: "Undelivered",
              messageId: "SM0123",
              errorCode: "30003",
            }),
            { channelColumn: "userSmsId" },
          ),
        );

        expect(text(undelivered)).toBe(
          joinSentences([
            worded(language, LOG_PROVIDER_STATUS_SENTENCES["Undelivered"]!),
            worded(language, LOG_PAGE_LINE_SENTENCES.providerMessageId, {
              id: "SM0123",
            }),
            worded(language, LOG_PAGE_LINE_SENTENCES.providerErrorCode, {
              code: "30003",
            }),
          ]),
        );
        expectNoEnglish(undelivered, ["SM0123", "30003"]);
      });

      test("a WhatsApp message Meta could not send: Meta's words set apart, as written", async () => {
        const metaWords: string = "Message undeliverable (code 131026)";
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(
            getProviderDeliveryStatusMessage({
              status: "Failed",
              messageId: "wamid.HBgL",
              providerError: metaWords,
            }),
            { channelColumn: "userWhatsAppId" },
          ),
        );

        expect(text(line)).toBe(
          joinSentences([
            worded(language, LOG_PROVIDER_STATUS_SENTENCES["Failed"]!),
            worded(language, LOG_PAGE_LINE_SENTENCES.providerMessageId, {
              id: "wamid.HBgL",
            }),
            worded(language, LOG_PAGE_LINE_SENTENCES.providerError, {
              error: metaWords,
            }),
          ]),
        );

        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated(metaWords));
        }
      });

      test("an email sent without its images: the mail service's words, and that delivery is not tracked", async () => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(
            getSentWithoutImagesStatusMessage("Attachment too large"),
            {
              channelColumn: "userEmailId",
            },
          ),
        );

        expect(text(line)).toBe(
          joinSentences([
            worded(language, LOG_PAGE_LINE_SENTENCES.emailSentWithoutImages, {
              answer: "Attachment too large.",
            }),
            worded(language, LOG_PAGE_LINE_SENTENCES.emailDeliveryNotTracked),
          ]),
        );
        expectNoEnglish(line, ["Attachment too large."]);
      });
    });
  },
);

// The last sentences, in every Dashboard language (#8551).
describe("the last of the logs' sentences, in every Dashboard language (#8551)", () => {
  const SENTENCES: Array<string> = [
    ...Object.values(LOG_PAGE_LINE_SENTENCES),
    ...Object.values(LOG_PROVIDER_STATUS_SENTENCES),
    ...Object.values(LOG_PAGE_RECORD_ACKNOWLEDGED_SENTENCES),
    ...Object.values(LOG_PAGE_RECORD_DELETED_SENTENCES),
    ...Object.values(LOG_PAGE_ACKNOWLEDGED_BY_SENTENCES),
    ...Object.values(LOG_PAGE_SEEN_BY_OBSERVER_SENTENCES),
  ];
  const KEYS: Array<string> = [
    ...SENTENCES,
    LOG_NOTIFICATION_STUCK.other,
    `${LOG_NOTIFICATION_STUCK.other}_one`,
  ];

  test("thirty-four keys, each its own", () => {
    expect(KEYS).toHaveLength(34);
    expect(new Set(KEYS).size).toBe(34);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every one, its values kept",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        const english: string = key.endsWith("_one")
          ? LOG_NOTIFICATION_STUCK.one
          : key;
        const value: string = locale[key] || "";

        expect({
          language,
          key,
          worded: Boolean(value) && value !== english,
        }).toEqual({ language, key, worded: true });
        expect({ language, key, placeholders: placeholdersOf(value) }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english),
        });
      }
    },
  );

  test("none of a real page's sentences says test", () => {
    for (const key of KEYS) {
      expect({ key, saysTest: SAYS_TEST.test(key) }).toEqual({
        key,
        saysTest: false,
      });
    }
  });
});

/*
 * A CALL'S OUTCOME, IN THE READER'S WORDS (#8576): on a person's on-call
 * log's timeline, with the shipped locales, in en, de, fa and ar.
 */
describe.each(LANGUAGES)(
  "a %s reader reads how a call ended in their own words (#8576)",
  (language: string) => {
    const CALL_SID: string = "CA0123456789abcdef0123456789abcdef";

    beforeEach(async () => {
      await inLanguage(language);
    });

    test.each([
      [CALL_ANSWERED_MESSAGE, CallOutcomeLine.Answered],
      [CALL_RANG_OUT_MESSAGE, CallOutcomeLine.RangOut],
      [CALL_BUSY_MESSAGE, CallOutcomeLine.Busy],
      [CALL_NOT_CONNECTED_MESSAGE, CallOutcomeLine.NotConnected],
      // Twilio's answering machine detection (#6594).
      [
        CALL_VOICEMAIL_MESSAGE_LEFT_MESSAGE,
        CallOutcomeLine.VoicemailMessageLeft,
      ],
      [CALL_VOICEMAIL_NO_MESSAGE_MESSAGE, CallOutcomeLine.VoicemailNoMessage],
      [CALL_FAX_MESSAGE, CallOutcomeLine.Fax],
    ] as Array<[string, CallOutcomeLine]>)(
      "%s, after the call's id, set apart",
      async (sentence: string, outcome: CallOutcomeLine) => {
        const line: HTMLElement = await statusLine(
          "notifications",
          notification(
            getCallOutcomeMessage({ callId: CALL_SID, sentence: sentence }),
            { channelColumn: "userCallId" },
          ),
        );

        expect(text(line)).toBe(
          joinSentences([
            worded(language, LOG_CALL_ID, { id: CALL_SID }),
            worded(language, LOG_CALL_OUTCOME_SENTENCES[outcome]),
          ]),
        );

        if (RIGHT_TO_LEFT.includes(language)) {
          expect(line.textContent).toContain(isolated(CALL_SID));
        }

        if (language !== "en") {
          expect(text(line).split(CALL_SID).join("")).not.toMatch(
            /\b(call|answered|rang|busy|declined|connected|voicemail|message|fax machine)\b/i,
          );
        }
      },
    );

    test("an answered call, how long it lasted in the reader's plural and digits", async () => {
      const line: HTMLElement = await statusLine(
        "notifications",
        notification(
          getCallOutcomeMessage({
            callId: null,
            sentence: getCallAnsweredAndLastedMessage(42),
          }),
          { channelColumn: "userCallId" },
        ),
      );
      const words: string =
        language === "en"
          ? LOG_CALL_ANSWERED_AND_LASTED.other
          : readDashboardLocale(language)[LOG_CALL_ANSWERED_AND_LASTED.other]!;

      // As the page's Translator sets it: the figure held to its word (#8770).
      expect(text(line)).toBe(
        withNumbersKeptWithUnits(words, LOG_CALL_ANSWERED_AND_LASTED.other, {
          durationWords: true,
        })
          .split("{{count}}")
          .join(dashboardTranslator(language).formatNumber(42)),
      );
    });
  },
);

describe("a call's outcome, in every Dashboard language (#8576)", () => {
  const KEYS: Array<string> = [
    ...Object.values(LOG_CALL_OUTCOME_SENTENCES),
    LOG_CALL_ID,
    LOG_CALL_ANSWERED_AND_LASTED.other,
    `${LOG_CALL_ANSWERED_AND_LASTED.other}_one`,
  ];

  // Answered, rang out, busy, not connected, voicemail with a message left or not, a fax (#6594).
  test("ten keys, each its own", () => {
    expect(new Set(KEYS).size).toBe(10);
  });

  test.each([...DASHBOARD_LANGUAGES])(
    "%s words every one",
    (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);

      for (const key of KEYS) {
        const english: string = key.endsWith("_one")
          ? LOG_CALL_ANSWERED_AND_LASTED.one
          : key;
        const value: string = locale[key] || "";

        expect({
          language,
          key,
          worded: Boolean(value) && value !== english,
        }).toEqual({ language, key, worded: true });
        expect({ language, key, placeholders: placeholdersOf(value) }).toEqual({
          language,
          key,
          placeholders: placeholdersOf(english),
        });
      }
    },
  );
});
