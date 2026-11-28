/** @timezone UTC */

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
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import i18next from "i18next";
import React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";

/*
 * Read by a self-hosted server's member, whatever the environment says, as
 * the Who Was Told card's own suite reads it.
 */
jest.mock("../../../UI/Config", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = { ...actualConfig };

  Object.defineProperty(mockedConfig, "BILLING_ENABLED", {
    get: (): boolean => {
      return false;
    },
  });

  return mockedConfig;
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/OnCallTestPageApi",
  () => {
    return {
      __esModule: true,
      default: {
        preview: () => {
          return new Promise(() => {});
        },
        send: () => {
          return new Promise(() => {});
        },
        getResult: () => {
          return new Promise(() => {});
        },
      },
    };
  },
);

import WhoWasToldCard, {
  WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/WhoWasTold/WhoWasToldCard";
import WhoWasToldApi from "../../../../App/FeatureSet/Dashboard/src/Components/WhoWasTold/WhoWasToldApi";
import {
  TEST_PAGE_DELIVERY_STATUS_TEST_ID,
  TestPageResultView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallTestPage/TestPageResult";
import OnCallLogNotificationStatus, {
  ON_CALL_LOG_NOTIFICATION_STATUS_TEST_ID,
  OnCallLogNotificationStatusRow,
} from "../../../../App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallLogNotificationStatus";
import { NOTIFICATION_LOG_STATUS_TONES } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogStatus";
import NotificationLogStatusPill, {
  getNotificationLogStatusExplanation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogStatusPill";
import CallStatus from "../../../Types/Call/CallStatus";
import { getSentToCallAndSmsGatewayMessage } from "../../../Types/CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "../../../Types/Mail/MailStatus";
import {
  NotificationLogKind,
  NotificationLogStatusLine,
  NotificationLogStatusReading,
  NotificationLogStatusWords,
  getNotificationLogStatusWords,
} from "../../../Types/Notification/NotificationLogStatus";
import {
  WhoWasToldLogKind,
  WhoWasToldLogRow,
  WhoWasToldResult,
  buildWhoWasTold,
} from "../../../Types/Notification/WhoWasTold";
import ObjectID from "../../../Types/ObjectID";
import OnCallDutyPolicyStatus from "../../../Types/OnCallDutyPolicy/OnCallDutyPolicyStatus";
import { OnCallPageChannel } from "../../../Types/OnCallDutyPolicy/OnCallPageChannel";
import {
  getCallAnsweredAndLastedMessage,
  getCallIdStatusMessage,
  getCallOutcomeMessage,
  getMessageIdStatusMessage,
  getProviderDeliveryStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallSentLine";
import {
  OnCallTestPageDelivery,
  OnCallTestPageDeliveryStatus,
  OnCallTestPageKind,
  OnCallTestPageRecordKind,
  OnCallTestPageResult,
  OnCallTestPageStatus,
  OnCallTestPageStepStatus,
} from "../../../Types/OnCallDutyPolicy/OnCallTestPage";
import SmsStatus from "../../../Types/SmsStatus";
import TelegramStatus from "../../../Types/TelegramStatus";
import UserNotificationStatus from "../../../Types/UserNotification/UserNotificationStatus";
import WhatsAppStatus from "../../../Types/WhatsAppStatus";
import { PillSize } from "../../../UI/Components/Pill/Pill";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import ProjectUtil from "../../../UI/Utils/Project";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * WHAT BECAME OF A MESSAGE READS ALIKE WHEREVER IT IS SHOWN (#11416).
 *
 * The notification logs say what each status means: an SMS its carrier
 * accepted is Sent in blue, its receipt still to come, and one the server's
 * own gateway took is Sent in green, its last status; a call still ringing
 * is Calling in blue, and an answered one Success in green. Who Was Told, a
 * test page's result and a person's On-Call Logs said "Sent" of them all,
 * so during an incident a ringing call read as "they got it".
 *
 * Each now draws a message's status with the logs' own pill: the same word,
 * the same colour, and on hover, tap or focus the same explanation - without
 * the sentence that names one of the log's own columns, which the card, the
 * result and the timeline have not got. Drawn here as each draws it, from
 * the Dashboard's own locale files, in English, German and Japanese.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11416000-0000-4000-8000-000000000001",
);
const INCIDENT_ID: ObjectID = new ObjectID(
  "11416000-0000-4000-8000-000000000002",
);
const SMS_SID: string = "SM1342fe1b2c904d1ab04f0fc7a58abca9";
const CALL_SID: string = "CA1342fe1b2c904d1ab04f0fc7a58abca9";
const ANSWERED: string = getCallOutcomeMessage({
  callId: CALL_SID,
  sentence: getCallAnsweredAndLastedMessage(42),
});
const GATEWAY: string = getSentToCallAndSmsGatewayMessage(200);

const LOG_PARTS: ReadonlyArray<string> = [
  "View Status Message",
  "Error Code",
  "HTTP Status",
  "Reason",
];

const AT: (minute: number) => string = (minute: number): string => {
  return new Date(Date.UTC(2026, 10, 28, 10, minute, 0)).toISOString();
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      en: { translation: readDashboardLocale("en") },
      de: { translation: readDashboardLocale("de") },
      ja: { translation: readDashboardLocale("ja") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

let get: SpyInstance<typeof WhoWasToldApi.get>;

beforeEach(async () => {
  await act(async () => {
    await i18next.changeLanguage("en");
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(PROJECT_ID as never);
  get = jest.spyOn(WhoWasToldApi, "get");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function inLanguage(language: string): Promise<void> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
}

interface DrawnStatus {
  text: string;
  tone: string | null;
  explanation: string;
}

// A status the logs' pill drew: its word, its tone, and what it says it means.
function readPill(button: HTMLElement): DrawnStatus {
  // A plain pill carries the test id itself; the logs' pill is a button around one.
  const pill: HTMLElement = (
    button.hasAttribute("data-tone")
      ? button
      : button.querySelector('[data-testid="pill"]')
  ) as HTMLElement;
  const describedBy: string = button.getAttribute("aria-describedby") || "";

  return {
    text: (
      pill.querySelector('[data-testid="pill-text"]') as HTMLElement
    ).textContent!.trim(),
    tone: pill.getAttribute("data-tone"),
    explanation: describedBy
      ? (document.getElementById(describedBy)?.textContent || "").trim()
      : "",
  };
}

// What the logs' pill draws for a log's status, away from its log, in `language`.
function asTheLogsDrawIt(
  language: string,
  reading: NotificationLogStatusReading,
): DrawnStatus {
  const locale: Record<string, string> = readDashboardLocale(language);
  const english: Record<string, string> = readDashboardLocale("en");
  const words: NotificationLogStatusWords =
    getNotificationLogStatusWords(reading)!;

  return {
    text: locale[words.text] || english[words.text] || words.text,
    tone: NOTIFICATION_LOG_STATUS_TONES[words.meaning],
    explanation: joinSentences(
      getNotificationLogStatusExplanation(words, true).map(
        (sentence: string): string => {
          return locale[sentence] || sentence;
        },
      ),
    ),
  };
}

/*
 * A record's notifications that all read "Sent" before: a call still
 * ringing, an answered one, an SMS waiting for its receipt, one the gateway
 * took, a Telegram message - and an SMS that failed, an email that went.
 */
const LOGS: ReadonlyArray<{
  row: WhoWasToldLogRow;
  drawn: NotificationLogStatusReading;
}> = [
  {
    row: {
      id: "ringing",
      kind: WhoWasToldLogKind.Call,
      status: CallStatus.Calling,
      statusMessage: getCallIdStatusMessage(CALL_SID),
      createdAt: AT(1),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: { kind: NotificationLogKind.Call, status: CallStatus.Calling },
  },
  {
    row: {
      id: "answered",
      kind: WhoWasToldLogKind.Call,
      status: CallStatus.Success,
      statusMessage: ANSWERED,
      createdAt: AT(2),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: {
      kind: NotificationLogKind.Call,
      status: CallStatus.Success,
      line: NotificationLogStatusLine.Answered,
    },
  },
  {
    row: {
      id: "waiting",
      kind: WhoWasToldLogKind.SMS,
      status: SmsStatus.Sent,
      statusMessage: getProviderDeliveryStatusMessage({
        status: SmsStatus.Sent,
        messageId: SMS_SID,
      }),
      createdAt: AT(3),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: { kind: NotificationLogKind.SMS, status: SmsStatus.Sent },
  },
  {
    row: {
      id: "gateway",
      kind: WhoWasToldLogKind.SMS,
      status: SmsStatus.Sent,
      statusMessage: GATEWAY,
      createdAt: AT(4),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: {
      kind: NotificationLogKind.SMS,
      status: SmsStatus.Sent,
      line: NotificationLogStatusLine.SentToGateway,
    },
  },
  {
    row: {
      id: "telegram",
      kind: WhoWasToldLogKind.Telegram,
      status: TelegramStatus.Sent,
      createdAt: AT(5),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: { kind: NotificationLogKind.Telegram, status: TelegramStatus.Sent },
  },
  {
    row: {
      id: "undelivered",
      kind: WhoWasToldLogKind.SMS,
      status: SmsStatus.Undelivered,
      statusMessage: getProviderDeliveryStatusMessage({
        status: SmsStatus.Undelivered,
        messageId: SMS_SID,
        errorCode: "30003",
      }),
      createdAt: AT(6),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: { kind: NotificationLogKind.SMS, status: SmsStatus.Undelivered },
  },
  {
    row: {
      id: "email",
      kind: WhoWasToldLogKind.Email,
      status: MailStatus.Success,
      createdAt: AT(7),
      isOnCallPage: false,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: { kind: NotificationLogKind.Email, status: MailStatus.Success },
  },
  {
    row: {
      id: "warned",
      kind: WhoWasToldLogKind.WhatsApp,
      status: WhatsAppStatus.Warning,
      createdAt: AT(8),
      isOnCallPage: true,
      userId: "ana",
      userName: "Ana Lopez",
    },
    drawn: {
      kind: NotificationLogKind.WhatsApp,
      status: WhatsAppStatus.Warning,
    },
  },
];

function answer(logs: ReadonlyArray<WhoWasToldLogRow>): WhoWasToldResult {
  return buildWhoWasTold({
    recordKind: OnCallTestPageRecordKind.Incident,
    recordId: INCIDENT_ID.toString(),
    checkedAt: AT(30),
    runs: [
      {
        id: "run-1",
        policyId: "policy-1",
        policyName: "Primary",
        isDirectPage: false,
        status: OnCallDutyPolicyStatus.Executing,
        statusMessage: "",
        startedAt: AT(0),
      },
    ],
    steps: [],
    logs: logs,
    hiddenNotificationCount: 0,
    hiddenRunCount: 0,
    isTruncated: false,
  });
}

// The card, its details open: each notification's line, in order of time.
async function openWhoWasTold(
  result: WhoWasToldResult,
): Promise<Array<HTMLElement>> {
  get.mockResolvedValue(result);

  render(
    <MemoryRouter>
      <WhoWasToldCard
        recordKind={OnCallTestPageRecordKind.Incident}
        recordId={INCIDENT_ID}
        isLive={false}
      />
    </MemoryRouter>,
  );

  fireEvent.click(await screen.findByTestId("who-was-told-details-toggle"));

  return screen.getAllByTestId("who-was-told-notification");
}

describe("Who Was Told draws each notification as its log does", () => {
  test("a ringing call, an answered one, an SMS on its way, one the gateway took, a Telegram message, a failure, an email and a warning: each its log's word and colour", async () => {
    const lines: Array<HTMLElement> = await openWhoWasTold(
      answer(
        LOGS.map((entry: { row: WhoWasToldLogRow }): WhoWasToldLogRow => {
          return entry.row;
        }),
      ),
    );

    expect(lines).toHaveLength(LOGS.length);

    LOGS.forEach(
      (
        entry: { row: WhoWasToldLogRow; drawn: NotificationLogStatusReading },
        index: number,
      ) => {
        const drawn: DrawnStatus = readPill(
          within(lines[index]!).getByTestId(
            WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID,
          ),
        );

        expect({ id: entry.row.id, ...drawn }).toEqual({
          id: entry.row.id,
          ...asTheLogsDrawIt("en", entry.drawn),
        });
      },
    );
  });

  test("the four that all said Sent no longer read alike: Calling and Sent in blue, Success and Sent in green", async () => {
    const lines: Array<HTMLElement> = await openWhoWasTold(
      answer(
        LOGS.slice(0, 4).map(
          (entry: { row: WhoWasToldLogRow }): WhoWasToldLogRow => {
            return entry.row;
          },
        ),
      ),
    );

    expect(
      lines.map((line: HTMLElement): [string, string | null] => {
        const drawn: DrawnStatus = readPill(
          within(line).getByTestId(WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID),
        );

        return [drawn.text, drawn.tone];
      }),
    ).toEqual([
      ["Calling", PillTone.Info],
      ["Success", PillTone.Success],
      ["Sent", PillTone.Info],
      ["Sent", PillTone.Success],
    ]);
  });

  test("what each means is said on hover, tap or focus - and never points at a log's column the card has not got", async () => {
    const lines: Array<HTMLElement> = await openWhoWasTold(
      answer(
        LOGS.map((entry: { row: WhoWasToldLogRow }): WhoWasToldLogRow => {
          return entry.row;
        }),
      ),
    );

    const answered: DrawnStatus = readPill(
      within(lines[1]!).getByTestId(WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID),
    );

    expect(answered.explanation).toBe("The call was answered.");

    for (const line of lines) {
      const button: HTMLElement = within(line).getByTestId(
        WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID,
      );

      // A button Tab reaches, whose description a screen reader reads.
      expect(button.tagName).toBe("BUTTON");
      expect(readPill(button).explanation).not.toBe("");

      for (const part of LOG_PARTS) {
        expect(readPill(button).explanation).not.toContain(part);
      }
    }
  });

  test("a failure still says why, on its own line, under its log's word", async () => {
    const lines: Array<HTMLElement> = await openWhoWasTold(
      answer([LOGS[5]!.row]),
    );

    expect(
      readPill(
        within(lines[0]!).getByTestId(WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID),
      ).text,
    ).toBe("Undelivered");
    expect(lines[0]).toHaveAttribute(
      "data-status",
      OnCallTestPageDeliveryStatus.Failed,
    );
    expect(
      within(lines[0]!).getByTestId("who-was-told-reason"),
    ).toHaveTextContent("30003");
  });

  test("an answer from a server that does not say its logs' statuses keeps the card's own word", async () => {
    const result: WhoWasToldResult = answer([LOGS[2]!.row]);

    delete result.people[0]!.notifications[0]!.logStatus;

    const lines: Array<HTMLElement> = await openWhoWasTold(result);

    expect(
      within(lines[0]!).queryByTestId(WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(within(lines[0]!).getByTestId("pill")).toHaveAttribute(
      "data-tone",
      PillTone.Info,
    );
    expect(within(lines[0]!).getByTestId("pill")).toHaveTextContent("Sent");
  });

  test.each(["de", "ja"])(
    "in %s, each says its log's word and explanation from the locale",
    async (language: string) => {
      await inLanguage(language);

      const lines: Array<HTMLElement> = await openWhoWasTold(
        answer(
          LOGS.map((entry: { row: WhoWasToldLogRow }): WhoWasToldLogRow => {
            return entry.row;
          }),
        ),
      );

      LOGS.forEach(
        (
          entry: { row: WhoWasToldLogRow; drawn: NotificationLogStatusReading },
          index: number,
        ) => {
          expect({
            id: entry.row.id,
            ...readPill(
              within(lines[index]!).getByTestId(
                WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID,
              ),
            ),
          }).toEqual({
            id: entry.row.id,
            ...asTheLogsDrawIt(language, entry.drawn),
          });
        },
      );

      // Calling is never the English word in the language.
      expect(
        readPill(
          within(lines[0]!).getByTestId(
            WHO_WAS_TOLD_NOTIFICATION_STATUS_TEST_ID,
          ),
        ).text,
      ).toBe(readDashboardLocale(language)["Calling"]);
    },
  );
});

/*
 * A TEST PAGE'S RESULT, each message as its log says it: the server hands
 * the result each message's log status (logStatus); acknowledged from it,
 * the result's own word comes first.
 */
function delivery(
  data: Partial<OnCallTestPageDelivery> & { id: string },
): OnCallTestPageDelivery {
  return {
    channel: OnCallPageChannel.SMS,
    status: OnCallTestPageDeliveryStatus.Sent,
    statusMessage: "",
    canAcknowledge: true,
    sentAt: AT(1),
    ...data,
  };
}

function testResult(
  deliveries: Array<OnCallTestPageDelivery>,
): OnCallTestPageResult {
  return {
    executionLogId: "11416000-0000-4000-8000-000000000003",
    kind: OnCallTestPageKind.Self,
    recordKind: OnCallTestPageRecordKind.Incident,
    severityName: "Critical",
    walksEscalation: false,
    status: OnCallTestPageStatus.Paging,
    statusMessage: "",
    startedAt: AT(0),
    endsAt: AT(15),
    steps: [
      {
        id: "step-ana",
        status: OnCallTestPageStepStatus.Paged,
        statusMessage: "",
        userId: "ana",
        userName: "Ana Lopez",
        deliveries: deliveries,
      },
    ],
  } as unknown as OnCallTestPageResult;
}

function renderTestResult(
  deliveries: Array<OnCallTestPageDelivery>,
): Array<HTMLElement> {
  render(
    <MemoryRouter>
      <TestPageResultView result={testResult(deliveries)} />
    </MemoryRouter>,
  );

  return screen.getAllByTestId("test-page-delivery");
}

describe("a test page's result draws each message as its log does", () => {
  const SENT_THREE_WAYS: Array<OnCallTestPageDelivery> = [
    delivery({
      id: "sms",
      logStatus: { kind: NotificationLogKind.SMS, status: SmsStatus.Sent },
    }),
    delivery({
      id: "ringing",
      channel: OnCallPageChannel.Call,
      logStatus: { kind: NotificationLogKind.Call, status: CallStatus.Calling },
    }),
    delivery({
      id: "answered",
      channel: OnCallPageChannel.Call,
      status: OnCallTestPageDeliveryStatus.Delivered,
      logStatus: {
        kind: NotificationLogKind.Call,
        status: CallStatus.Success,
        line: NotificationLogStatusLine.Answered,
      },
    }),
    delivery({
      id: "email",
      channel: OnCallPageChannel.Email,
      canAcknowledge: true,
      logStatus: {
        kind: NotificationLogKind.Email,
        status: MailStatus.Success,
      },
    }),
    delivery({
      id: "gateway",
      logStatus: {
        kind: NotificationLogKind.SMS,
        status: SmsStatus.Sent,
        line: NotificationLogStatusLine.SentToGateway,
      },
    }),
  ];

  test("an SMS on its way, a ringing call, an answered one, an email that went and a gateway's SMS: each its log's word and colour", () => {
    const lines: Array<HTMLElement> = renderTestResult(SENT_THREE_WAYS);

    expect(lines).toHaveLength(SENT_THREE_WAYS.length);

    SENT_THREE_WAYS.forEach((sent: OnCallTestPageDelivery, index: number) => {
      expect({
        id: sent.id,
        ...readPill(
          within(lines[index]!).getByTestId(TEST_PAGE_DELIVERY_STATUS_TEST_ID),
        ),
      }).toEqual({ id: sent.id, ...asTheLogsDrawIt("en", sent.logStatus!) });
    });

    expect(
      lines.map((line: HTMLElement): [string, string | null] => {
        const drawn: DrawnStatus = readPill(
          within(line).getByTestId(TEST_PAGE_DELIVERY_STATUS_TEST_ID),
        );

        return [drawn.text, drawn.tone];
      }),
    ).toEqual([
      ["Sent", PillTone.Info],
      ["Calling", PillTone.Info],
      ["Success", PillTone.Success],
      ["Success", PillTone.Success],
      ["Sent", PillTone.Success],
    ]);
  });

  test("acknowledged from it: the result's own Acknowledged, whatever its log says", () => {
    const lines: Array<HTMLElement> = renderTestResult([
      delivery({
        id: "acknowledged",
        status: OnCallTestPageDeliveryStatus.Acknowledged,
        logStatus: {
          kind: NotificationLogKind.SMS,
          status: SmsStatus.Delivered,
        },
      }),
    ]);

    expect(
      within(lines[0]!).queryByTestId(TEST_PAGE_DELIVERY_STATUS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(within(lines[0]!).getByTestId("pill")).toHaveTextContent(
      "Acknowledged",
    );
  });

  test("a message whose log is not known keeps the result's own word", () => {
    const lines: Array<HTMLElement> = renderTestResult([
      delivery({
        id: "custom",
        channel: OnCallPageChannel.CustomChannel,
        canAcknowledge: false,
      }),
    ]);

    expect(
      within(lines[0]!).queryByTestId(TEST_PAGE_DELIVERY_STATUS_TEST_ID),
    ).not.toBeInTheDocument();
    expect(within(lines[0]!).getByTestId("pill")).toHaveTextContent("Sent");
  });

  test("in German, each its log's German word", async () => {
    await inLanguage("de");

    const lines: Array<HTMLElement> = renderTestResult(SENT_THREE_WAYS);

    SENT_THREE_WAYS.forEach((sent: OnCallTestPageDelivery, index: number) => {
      expect({
        id: sent.id,
        ...readPill(
          within(lines[index]!).getByTestId(TEST_PAGE_DELIVERY_STATUS_TEST_ID),
        ),
      }).toEqual({ id: sent.id, ...asTheLogsDrawIt("de", sent.logStatus!) });
    });
  });
});

/*
 * A PERSON'S ON-CALL LOGS: a notification drawn as its log draws it where
 * the notification says that for certain, and otherwise its own status in
 * the colour of where it stands - never every Sent in the green of
 * Acknowledged, nor an error in yellow.
 */
function timelineRow(
  data: Partial<OnCallLogNotificationStatusRow> & {
    channel?: OnCallPageChannel | undefined;
  },
): OnCallLogNotificationStatusRow {
  const fields: Partial<Record<OnCallPageChannel, string>> = {
    [OnCallPageChannel.Email]: "userEmailId",
    [OnCallPageChannel.SMS]: "userSmsId",
    [OnCallPageChannel.Call]: "userCallId",
    [OnCallPageChannel.Push]: "userPushId",
    [OnCallPageChannel.WhatsApp]: "userWhatsAppId",
    [OnCallPageChannel.Telegram]: "userTelegramId",
    [OnCallPageChannel.Slack]: "userSlackId",
  };
  const { channel, ...rest } = data;
  const field: string | undefined = channel ? fields[channel] : undefined;

  return {
    ...(field
      ? { [field]: new ObjectID("11416000-0000-4000-8000-000000000009") }
      : {}),
    ...rest,
  } as OnCallLogNotificationStatusRow;
}

function drawTimelineStatus(row: OnCallLogNotificationStatusRow): HTMLElement {
  render(<OnCallLogNotificationStatus notification={row} />);

  return screen.getByTestId(ON_CALL_LOG_NOTIFICATION_STATUS_TEST_ID);
}

describe("a person's On-Call Logs draw each notification in the logs' colours", () => {
  test("an email, a push and a Slack message that went: their logs' last status, green", () => {
    for (const [channel, reading] of [
      [
        OnCallPageChannel.Email,
        { kind: NotificationLogKind.Email, status: MailStatus.Success },
      ],
      [
        OnCallPageChannel.Push,
        { kind: NotificationLogKind.Push, status: "Success" },
      ],
      [
        OnCallPageChannel.Slack,
        { kind: NotificationLogKind.Workspace, status: "Success" },
      ],
      [
        OnCallPageChannel.Telegram,
        { kind: NotificationLogKind.Telegram, status: TelegramStatus.Sent },
      ],
    ] as Array<[OnCallPageChannel, NotificationLogStatusReading]>) {
      const drawn: DrawnStatus = readPill(
        drawTimelineStatus(
          timelineRow({
            channel: channel,
            status: UserNotificationStatus.Sent,
          }),
        ),
      );

      expect({ channel, ...drawn }).toEqual({
        channel,
        ...asTheLogsDrawIt("en", reading),
      });
      expect(drawn.tone).toBe(PillTone.Success);
      cleanup();
    }
  });

  test("an answered call and a gateway's SMS: as their logs draw them, from the line the notification keeps", () => {
    const answered: DrawnStatus = readPill(
      drawTimelineStatus(
        timelineRow({
          channel: OnCallPageChannel.Call,
          status: UserNotificationStatus.Sent,
          statusMessage: ANSWERED,
        }),
      ),
    );

    expect(answered).toEqual(
      asTheLogsDrawIt("en", {
        kind: NotificationLogKind.Call,
        status: CallStatus.Success,
        line: NotificationLogStatusLine.Answered,
      }),
    );
    expect(answered.explanation).toBe("The call was answered.");
    cleanup();

    const gateway: DrawnStatus = readPill(
      drawTimelineStatus(
        timelineRow({
          channel: OnCallPageChannel.SMS,
          status: UserNotificationStatus.Sent,
          statusMessage: GATEWAY,
        }),
      ),
    );

    expect([gateway.text, gateway.tone]).toEqual(["Sent", PillTone.Success]);
  });

  test("an SMS or a call its log has more to say of: its own Sent, in the blue of a message still on its way - never green", () => {
    for (const row of [
      timelineRow({
        channel: OnCallPageChannel.SMS,
        status: UserNotificationStatus.Sent,
        statusMessage: getMessageIdStatusMessage(SMS_SID),
      }),
      timelineRow({
        channel: OnCallPageChannel.Call,
        status: UserNotificationStatus.Sent,
        statusMessage: getCallIdStatusMessage(CALL_SID),
      }),
      timelineRow({
        channel: OnCallPageChannel.WhatsApp,
        status: UserNotificationStatus.Sent,
      }),
    ]) {
      const drawn: DrawnStatus = readPill(drawTimelineStatus(row));

      expect([drawn.text, drawn.tone]).toEqual(["Sent", PillTone.Info]);
      cleanup();
    }
  });

  test.each([
    [UserNotificationStatus.Sending, "Sending", PillTone.Neutral],
    [UserNotificationStatus.Acknowledged, "Acknowledged", PillTone.Success],
    [UserNotificationStatus.NotAnswered, "Not answered", PillTone.Warning],
    [UserNotificationStatus.PassedOn, "Escalated", PillTone.Warning],
    [UserNotificationStatus.Skipped, "Skipped", PillTone.Warning],
    // Red, as every log draws an error: it was yellow.
    [UserNotificationStatus.Error, "Error", PillTone.Danger],
  ])(
    "%s: '%s', in its colour",
    (status: UserNotificationStatus, text: string, tone: PillTone) => {
      const drawn: DrawnStatus = readPill(
        drawTimelineStatus(
          timelineRow({ channel: OnCallPageChannel.Email, status: status }),
        ),
      );

      expect([drawn.text, drawn.tone]).toEqual([text, tone]);
    },
  );

  test("a status this build does not know is drawn as written, grey; none at all is the quiet dash", () => {
    const drawn: DrawnStatus = readPill(
      drawTimelineStatus(
        timelineRow({ channel: OnCallPageChannel.Email, status: "Paused" }),
      ),
    );

    expect([drawn.text, drawn.tone]).toEqual(["Paused", PillTone.Neutral]);
    cleanup();

    render(
      <OnCallLogNotificationStatus
        notification={timelineRow({ channel: OnCallPageChannel.Email })}
      />,
    );

    expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
  });

  test("in German, each word is the locale's", async () => {
    await inLanguage("de");

    const locale: Record<string, string> = readDashboardLocale("de");
    const sent: DrawnStatus = readPill(
      drawTimelineStatus(
        timelineRow({
          channel: OnCallPageChannel.SMS,
          status: UserNotificationStatus.Sent,
        }),
      ),
    );

    expect(sent.text).toBe(locale["Sent"]);
    cleanup();

    const email: DrawnStatus = readPill(
      drawTimelineStatus(
        timelineRow({
          channel: OnCallPageChannel.Email,
          status: UserNotificationStatus.Sent,
        }),
      ),
    );

    expect(email).toEqual(
      asTheLogsDrawIt("de", {
        kind: NotificationLogKind.Email,
        status: MailStatus.Success,
      }),
    );
  });
});

describe("the logs' pill away from its log", () => {
  test("leaves out the sentence that names the log's column, and keeps what happened", () => {
    render(
      <NotificationLogStatusPill
        kind={NotificationLogKind.SMS}
        status={SmsStatus.Undelivered}
        isAwayFromItsLog={true}
        dataTestId="away"
      />,
    );
    render(
      <NotificationLogStatusPill
        kind={NotificationLogKind.SMS}
        status={SmsStatus.Undelivered}
        dataTestId="in-the-log"
      />,
    );

    expect(readPill(screen.getByTestId("away")).explanation).toBe(
      "The carrier could not deliver the SMS, for example because the phone was off or the number cannot receive texts.",
    );
    expect(readPill(screen.getByTestId("in-the-log")).explanation).toBe(
      "The carrier could not deliver the SMS, for example because the phone was off or the number cannot receive texts. Error Code says why.",
    );
  });

  test("reads what a message's line says as the log reads the message itself", () => {
    render(
      <NotificationLogStatusPill
        kind={NotificationLogKind.Call}
        status={CallStatus.Success}
        line={NotificationLogStatusLine.Answered}
        dataTestId="by-line"
      />,
    );
    render(
      <NotificationLogStatusPill
        kind={NotificationLogKind.Call}
        status={CallStatus.Success}
        statusMessage={ANSWERED}
        dataTestId="by-message"
      />,
    );

    expect(readPill(screen.getByTestId("by-line"))).toEqual(
      readPill(screen.getByTestId("by-message")),
    );
  });

  test("draws at the size a list's chips are", () => {
    render(
      <NotificationLogStatusPill
        kind={NotificationLogKind.SMS}
        status={SmsStatus.Sent}
        size={PillSize.Small}
        dataTestId="small"
      />,
    );
    render(
      <NotificationLogStatusPill
        kind={NotificationLogKind.SMS}
        status={SmsStatus.Sent}
        dataTestId="normal"
      />,
    );

    const small: HTMLElement = within(screen.getByTestId("small")).getByTestId(
      "pill",
    );
    const normal: HTMLElement = within(
      screen.getByTestId("normal"),
    ).getByTestId("pill");

    expect(small.style.fontSize).toBe(PillSize.Small.toString());
    expect(normal.style.fontSize).not.toBe(small.style.fontSize);
  });
});
