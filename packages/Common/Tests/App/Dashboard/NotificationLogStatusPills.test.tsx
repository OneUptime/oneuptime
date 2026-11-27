import "@testing-library/jest-dom";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React, { FunctionComponent, ReactElement } from "react";
import { initReactI18next } from "react-i18next";
import {
  afterAll,
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../Types/ObjectID";
import CallStatus from "../../../Types/Call/CallStatus";
import { getSentToCallAndSmsGatewayMessage } from "../../../Types/CallAndSMS/CallAndSmsGatewayLine";
import MailStatus from "../../../Types/Mail/MailStatus";
import {
  getCallAnsweredAndLastedMessage,
  getCallOutcomeMessage,
  getProviderDeliveryStatusMessage,
} from "../../../Types/OnCallDutyPolicy/OnCallSentLine";
import PushStatus from "../../../Types/PushNotification/PushStatus";
import SmsStatus from "../../../Types/SmsStatus";
import TelegramStatus from "../../../Types/TelegramStatus";
import WebhookStatus from "../../../Types/WebhookStatus";
import WhatsAppStatus from "../../../Types/WhatsAppStatus";
import WorkspaceNotificationStatus from "../../../Types/Workspace/WorkspaceNotificationStatus";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import { TABLE_EMPTY_VALUE_TEST_ID } from "../../../UI/Components/Table/TableEmptyValue";
import { PillTone } from "../../../UI/Components/Pill/PillTone";
import ProjectUtil from "../../../UI/Utils/Project";
import { joinSentences } from "../../../UI/Utils/SentenceSeparator";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";

/*
 * THE NOTIFICATION LOGS DRAW EVERY STATUS SAYING WHAT IT MEANS (#11138).
 *
 * Each of the eight logs - email, SMS, WhatsApp, Telegram, webhook, call,
 * push, workspace - runs as it is and hands its columns and filters to
 * ModelTable, replaced by a recorder. Its Status column is drawn for a row:
 *
 *   - a pill in the colour of where the message stands (data-tone), in the
 *     reader's word for the status, inside a button - a pointer, a tap or
 *     Tab reaches it - whose description a screen reader reads, and whose
 *     tooltip a tap opens: what the status means and what comes next;
 *   - an SMS the carrier accepted is Sent in blue, never the green it was;
 *     one the server's own gateway took is Sent in green, its last status.
 *
 * Its Status filter offers every status the log can hold, in the pills'
 * words: on six of the eight it was handed no choices, and drew a Status
 * row with nothing to pick.
 *
 * In English, German, Japanese (whose sentences run together with no space
 * between them) and Arabic, from the Dashboard's own locale files.
 */

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

type LogRow = Record<string, unknown> & { _id: string };

interface CapturedColumn {
  field?: Record<string, unknown> | undefined;
  getElement?: ((item: LogRow) => ReactElement) | undefined;
}

interface CapturedFilter {
  field?: Record<string, unknown> | undefined;
  filterDropdownOptions?: Array<DropdownOption> | undefined;
}

let capturedColumns: Array<CapturedColumn> = [];
let capturedFilters: Array<CapturedFilter> = [];

jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (props: {
      columns: Array<CapturedColumn>;
      filters: Array<CapturedFilter>;
    }) => {
      capturedColumns = props.columns;
      capturedFilters = props.filters;
      return null;
    },
  };
});

import SmsLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable";
import CallLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/CallLogsTable";
import EmailLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable";
import PushLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/PushLogsTable";
import WebhookLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WebhookLogsTable";
import TelegramLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/TelegramLogsTable";
import WhatsAppLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WhatsAppLogsTable";
import WorkspaceLogsTable from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable";
import {
  getNotificationLogStatusFilterOptions,
  NotificationLogKind,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogStatus";
import { NOTIFICATION_LOG_STATUS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogStatusPill";

const PROJECT_ID: ObjectID = new ObjectID(
  "11138000-0000-4000-8000-0000000000b1",
);

const TABLES: Array<
  [NotificationLogKind, FunctionComponent<Record<string, never>>]
> = [
  [
    NotificationLogKind.Email,
    EmailLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.SMS,
    SmsLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.WhatsApp,
    WhatsAppLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.Telegram,
    TelegramLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.Webhook,
    WebhookLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.Call,
    CallLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.Push,
    PushLogsTable as FunctionComponent<Record<string, never>>,
  ],
  [
    NotificationLogKind.Workspace,
    WorkspaceLogsTable as FunctionComponent<Record<string, never>>,
  ],
];

function tableOf(
  kind: NotificationLogKind,
): FunctionComponent<Record<string, never>> {
  return TABLES.find(([tableKind]: [NotificationLogKind, unknown]): boolean => {
    return tableKind === kind;
  })![1];
}

// A table's Status column and Status filter, as it hands them to ModelTable.
function statusOf(kind: NotificationLogKind): {
  column: CapturedColumn;
  filter: CapturedFilter;
} {
  capturedColumns = [];
  capturedFilters = [];
  render(React.createElement(tableOf(kind)));
  cleanup();

  const column: CapturedColumn | undefined = capturedColumns.find(
    (candidate: CapturedColumn): boolean => {
      return Boolean(candidate.field && "status" in candidate.field);
    },
  );
  const filter: CapturedFilter | undefined = capturedFilters.find(
    (candidate: CapturedFilter): boolean => {
      return Boolean(candidate.field && "status" in candidate.field);
    },
  );

  expect(column?.getElement).toBeDefined();
  expect(filter).toBeDefined();

  return { column: column!, filter: filter! };
}

interface DrawnStatus {
  text: string;
  tone: string | null;
  explanation: string;
  button: HTMLElement;
}

// A row's status, drawn as the table draws it: its pill, and what it says it means.
function drawStatus(
  kind: NotificationLogKind,
  row: { status?: string | undefined; statusMessage?: string | undefined },
): DrawnStatus {
  const { column } = statusOf(kind);

  render(
    <div>
      {column.getElement!({
        _id: "11138000-0000-4000-8000-0000000000b2",
        ...(kind === NotificationLogKind.Workspace
          ? { workspaceType: WorkspaceType.Slack }
          : {}),
        ...row,
      })}
    </div>,
  );

  const button: HTMLElement = screen.getByTestId(
    NOTIFICATION_LOG_STATUS_TEST_ID,
  );
  const pill: HTMLElement = button.querySelector(
    '[data-testid="pill"]',
  ) as HTMLElement;
  const describedBy: string = button.getAttribute("aria-describedby") || "";
  const description: HTMLElement | null = document.getElementById(describedBy);

  return {
    text: (
      pill.querySelector('[data-testid="pill-text"]') as HTMLElement
    ).textContent!.trim(),
    tone: pill.getAttribute("data-tone"),
    explanation: (description?.textContent || "").trim(),
    button: button,
  };
}

async function readIn(language: string): Promise<void> {
  await i18next.use(initReactI18next).init({
    lng: language,
    fallbackLng: "en",
    resources: {
      [language]: { translation: readDashboardLocale(language) },
      en: { translation: readDashboardLocale("en") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  await i18next.changeLanguage(language);
}

// What a locale says for each sentence, run together as the reader's script writes a paragraph.
function paragraphIn(language: string, sentences: Array<string>): string {
  const locale: Record<string, string> = readDashboardLocale(language);

  return joinSentences(
    sentences.map((sentence: string): string => {
      return locale[sentence] || sentence;
    }),
  );
}

const TWILIO_SENT_LINE: string = getProviderDeliveryStatusMessage({
  status: SmsStatus.Sent,
  messageId: "SM1342fe1b2c904d1ab04f0fc7a58abca9",
});

beforeEach(async () => {
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
  await readIn("en");
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await i18next.changeLanguage("en");
});

describe("each log's Status column", () => {
  test.each([
    [NotificationLogKind.Email, MailStatus.Success, PillTone.Success],
    [NotificationLogKind.Email, MailStatus.Error, PillTone.Danger],
    [NotificationLogKind.SMS, SmsStatus.Sending, PillTone.Neutral],
    [NotificationLogKind.SMS, SmsStatus.Sent, PillTone.Info],
    [NotificationLogKind.SMS, SmsStatus.Delivered, PillTone.Success],
    [NotificationLogKind.SMS, SmsStatus.Undelivered, PillTone.Danger],
    [NotificationLogKind.WhatsApp, WhatsAppStatus.Sent, PillTone.Info],
    [NotificationLogKind.WhatsApp, WhatsAppStatus.Read, PillTone.Success],
    [NotificationLogKind.Telegram, TelegramStatus.Sent, PillTone.Success],
    [NotificationLogKind.Telegram, TelegramStatus.LowBalance, PillTone.Danger],
    [NotificationLogKind.Webhook, WebhookStatus.Success, PillTone.Success],
    [NotificationLogKind.Call, CallStatus.Calling, PillTone.Info],
    [NotificationLogKind.Call, CallStatus.MissedCall, PillTone.Warning],
    [NotificationLogKind.Push, PushStatus.Error, PillTone.Danger],
    [
      NotificationLogKind.Workspace,
      WorkspaceNotificationStatus.Success,
      PillTone.Success,
    ],
  ])(
    "%s %s: a pill in its tone, saying what it means",
    (kind: NotificationLogKind, status: string, tone: PillTone) => {
      const drawn: DrawnStatus = drawStatus(kind, { status: status });

      expect(drawn.tone).toBe(tone);
      expect(drawn.text).not.toBe("");
      expect(drawn.explanation).not.toBe("");
      // A real button: Tab reaches it, and a screen reader reads why.
      expect(drawn.button.tagName).toBe("BUTTON");
    },
  );

  test("an SMS the carrier accepted: Sent, blue, and what comes next", () => {
    const drawn: DrawnStatus = drawStatus(NotificationLogKind.SMS, {
      status: SmsStatus.Sent,
      statusMessage: TWILIO_SENT_LINE,
    });

    expect(drawn).toMatchObject({
      text: "Sent",
      tone: PillTone.Info,
      explanation:
        "The carrier accepted the SMS. It moves to Delivered or Undelivered once the carrier reports back. Some carriers never report back, so an SMS can stay Sent.",
    });
  });

  test("an SMS the server's own gateway took: Sent, green - its last status", () => {
    const drawn: DrawnStatus = drawStatus(NotificationLogKind.SMS, {
      status: SmsStatus.Sent,
      statusMessage: getSentToCallAndSmsGatewayMessage(200),
    });

    expect(drawn).toMatchObject({
      text: "Sent",
      tone: PillTone.Success,
      explanation:
        "Your SMS and call gateway accepted the SMS. Gateways do not report delivery, so this is its last status.",
    });
  });

  test("an answered call: Success, and where to read how long it lasted", () => {
    const drawn: DrawnStatus = drawStatus(NotificationLogKind.Call, {
      status: CallStatus.Success,
      statusMessage: getCallOutcomeMessage({
        callId: "CA1342fe1b2c904d1ab04f0fc7a58abca9",
        sentence: getCallAnsweredAndLastedMessage(42),
      }),
    });

    expect(drawn).toMatchObject({
      text: "Success",
      tone: PillTone.Success,
      explanation:
        "The call was answered. View Status Message says how long it lasted.",
    });
  });

  test("a call's stored Missed Call reads in the call lists' words", () => {
    expect(
      drawStatus(NotificationLogKind.Call, { status: CallStatus.MissedCall })
        .text,
    ).toBe("Missed call");
  });

  test("a tap opens what it means, as a tooltip, and the press goes no further", () => {
    const onRowClick: jest.Mock = jest.fn();
    const { column } = statusOf(NotificationLogKind.SMS);

    render(
      <div onClick={onRowClick}>
        {column.getElement!({
          _id: "11138000-0000-4000-8000-0000000000b3",
          status: SmsStatus.Delivered,
        })}
      </div>,
    );

    fireEvent.click(screen.getByTestId(NOTIFICATION_LOG_STATUS_TEST_ID));

    expect(
      screen.getAllByText(
        "The carrier confirmed the SMS reached the phone. This is its last status.",
      ).length,
    ).toBeGreaterThanOrEqual(1);
    expect(onRowClick).not.toHaveBeenCalled();
  });

  test.each(
    TABLES.map(([kind]: [NotificationLogKind, unknown]) => {
      return [kind];
    }),
  )(
    "%s: a row with no status draws the quiet dash, never an empty pill",
    (kind: NotificationLogKind) => {
      const { column } = statusOf(kind);

      render(
        <div>
          {column.getElement!({ _id: "11138000-0000-4000-8000-0000000000b4" })}
        </div>,
      );

      expect(
        screen.queryByTestId(NOTIFICATION_LOG_STATUS_TEST_ID),
      ).not.toBeInTheDocument();
      expect(screen.getByTestId(TABLE_EMPTY_VALUE_TEST_ID)).toBeInTheDocument();
    },
  );
});

describe("each log's Status filter", () => {
  test.each(
    TABLES.map(([kind]: [NotificationLogKind, unknown]) => {
      return [kind];
    }),
  )(
    "%s: offers every status the log can hold, in the pills' words",
    (kind: NotificationLogKind) => {
      const { filter } = statusOf(kind);

      expect(filter.filterDropdownOptions).toEqual(
        getNotificationLogStatusFilterOptions(kind),
      );
      expect(filter.filterDropdownOptions!.length).toBeGreaterThanOrEqual(2);
    },
  );

  test("the SMS filter starts where an SMS starts, and ends with how it did not go", () => {
    const { filter } = statusOf(NotificationLogKind.SMS);

    expect(
      filter.filterDropdownOptions!.map((option: DropdownOption) => {
        return option.value;
      }),
    ).toEqual([
      "Sending",
      "Sent",
      "Delivered",
      "Undelivered",
      "Failed",
      "Error",
      "Low Balance",
      "Success",
    ]);
  });
});

describe("in the reader's language", () => {
  test("German: Gesendet, in blue, and the German sentences", async () => {
    await readIn("de");

    const drawn: DrawnStatus = drawStatus(NotificationLogKind.SMS, {
      status: SmsStatus.Sent,
      statusMessage: TWILIO_SENT_LINE,
    });

    expect(drawn.text).toBe(readDashboardLocale("de")["Sent"]);
    expect(drawn.tone).toBe(PillTone.Info);
    expect(drawn.explanation).toBe(
      paragraphIn("de", [
        "The carrier accepted the SMS.",
        "It moves to Delivered or Undelivered once the carrier reports back.",
        "Some carriers never report back, so an SMS can stay Sent.",
      ]),
    );
    expect(drawn.explanation).toContain("„Zugestellt“");
    expect(drawn.explanation).not.toContain("carrier");
  });

  test("German: a WhatsApp message read is Gelesen, never the verb Lesen", async () => {
    await readIn("de");

    const drawn: DrawnStatus = drawStatus(NotificationLogKind.WhatsApp, {
      status: WhatsAppStatus.Read,
    });

    expect(drawn.text).toBe("Gelesen");
    expect(drawn.text).not.toBe(readDashboardLocale("de")["Read"]);
  });

  test("German: Undelivered and Low Balance are worded, where they read English before", async () => {
    await readIn("de");

    expect(
      drawStatus(NotificationLogKind.SMS, { status: SmsStatus.Undelivered })
        .text,
    ).toBe(readDashboardLocale("de")["Undelivered"]);
    cleanup();
    expect(
      drawStatus(NotificationLogKind.SMS, { status: SmsStatus.LowBalance })
        .text,
    ).toBe(readDashboardLocale("de")["Low Balance"]);
    expect(readDashboardLocale("de")["Undelivered"]).not.toBe("Undelivered");
    expect(readDashboardLocale("de")["Low Balance"]).not.toBe("Low Balance");
  });

  test("Japanese: the sentences run together with no space after a full-width stop", async () => {
    await readIn("ja");

    const drawn: DrawnStatus = drawStatus(NotificationLogKind.SMS, {
      status: SmsStatus.Delivered,
    });
    const japanese: Record<string, string> = readDashboardLocale("ja");

    expect(drawn.explanation).toBe(
      `${japanese["The carrier confirmed the SMS reached the phone."]}${japanese["This is its last status."]}`,
    );
  });

  test("Arabic: a call that is ringing, in its words", async () => {
    await readIn("ar");

    const drawn: DrawnStatus = drawStatus(NotificationLogKind.Call, {
      status: CallStatus.Calling,
    });
    const arabic: Record<string, string> = readDashboardLocale("ar");

    expect(drawn.text).toBe(arabic["Calling"]);
    expect(drawn.tone).toBe(PillTone.Info);
    expect(drawn.explanation).toBe(
      paragraphIn("ar", [
        "Twilio placed the call.",
        "It changes once Twilio says how the call ended.",
      ]),
    );
  });
});
