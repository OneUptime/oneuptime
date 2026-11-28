import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import i18next from "i18next";
import React, { ReactElement } from "react";
import { initReactI18next } from "react-i18next";

/*
 * THE NOTIFICATION LOGS' CALL TAB IS A PHONE CALL IN EVERY LANGUAGE (#11418).
 *
 * The Call and Push tabs looked up the shared "Call" and "Push", which
 * Chinese, Korean and Russian word as a function call (调用, 호출, Вызов),
 * Danish, Swedish and Traditional Chinese as a call-out (Kald, Anrop, 呼叫),
 * and Arabic's "Push" as a payment (الدفع). Each tab now looks up a key of
 * its own, the phone call and the push notification Notification Settings
 * already uses. Drawn here as the page draws them, from the Dashboard's own
 * locale files, in English and every language it ships.
 */

function stub(testId: string): () => ReactElement {
  const LogTableStub: () => ReactElement = (): ReactElement => {
    return <div data-testid={testId} />;
  };

  return LogTableStub;
}

const TABLES: ReadonlyArray<string> = [
  "EmailLogsTable",
  "SmsLogsTable",
  "WhatsAppLogsTable",
  "TelegramLogsTable",
  "WebhookLogsTable",
  "CallLogsTable",
  "PushLogsTable",
  "WorkspaceLogsTable",
];

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/EmailLogsTable",
  () => {
    return { __esModule: true, default: stub("email-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/SmsLogsTable",
  () => {
    return { __esModule: true, default: stub("sms-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WhatsAppLogsTable",
  () => {
    return { __esModule: true, default: stub("whatsapp-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/TelegramLogsTable",
  () => {
    return { __esModule: true, default: stub("telegram-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WebhookLogsTable",
  () => {
    return { __esModule: true, default: stub("webhook-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/CallLogsTable",
  () => {
    return { __esModule: true, default: stub("call-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/PushLogsTable",
  () => {
    return { __esModule: true, default: stub("push-logs") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/WorkspaceLogsTable",
  () => {
    return { __esModule: true, default: stub("workspace-logs") };
  },
);

import NotificationLogsTabs from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogsTabs";
import {
  NOTIFICATION_LOGS_TAB_NAMES,
  NotificationLogsTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogsTabQuery";
import { MEANING_KEYS } from "../../../Types/MeaningKeys";
import {
  DASHBOARD_LANGUAGES,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const PAGE: string = `/dashboard/${PROJECT_ID}/settings/notification-logs`;

const CALL_KEY: string = "Call (phone call)";
const PUSH_KEY: string = "Push (push notification)";

/*
 * The word each language read on the Call tab that is no phone call: a
 * function call, an invocation or a call-out - and the phone call it reads
 * now, as Notification Settings' column reads it.
 */
const CALL_WORDS: Readonly<Record<string, { was: string; is: string }>> = {
  "zh-CN": { was: "调用", is: "电话" },
  ko: { was: "호출", is: "전화" },
  ru: { was: "Вызов", is: "Звонок" },
  da: { was: "Kald", is: "Opkald" },
  sv: { was: "Anrop", is: "Samtal" },
  "zh-TW": { was: "呼叫", is: "電話" },
};

// Arabic read the Push tab as a payment.
const PUSH_WORDS: Readonly<Record<string, { was: string; is: string }>> = {
  ar: { was: "الدفع", is: "إشعار فوري" },
  "zh-TW": { was: "推送", is: "推播" },
};

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      ["en", ...DASHBOARD_LANGUAGES].map(
        (
          language: string,
        ): [string, { translation: Record<string, string> }] => {
          return [language, { translation: readDashboardLocale(language) }];
        },
      ),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(() => {
  cleanup();
  goTo(PAGE);
});

// The tabs' names, as the page draws them in `language`, in their order.
async function tabsIn(language: string): Promise<Array<string>> {
  await act(async () => {
    await i18next.changeLanguage(language);
  });
  goTo(PAGE);

  await act(async () => {
    render(<NotificationLogsTabs />);
  });

  return screen.getAllByRole("tab").map((tab: HTMLElement): string => {
    return tab.textContent?.trim() || "";
  });
}

const CALL_TAB: number = Object.keys(NOTIFICATION_LOGS_TAB_NAMES).indexOf(
  NotificationLogsTab.Call,
);
const PUSH_TAB: number = Object.keys(NOTIFICATION_LOGS_TAB_NAMES).indexOf(
  NotificationLogsTab.Push,
);

describe("the Call and Push tabs", () => {
  test("look up keys that name their meaning, a phone call and a push notification", () => {
    expect(NOTIFICATION_LOGS_TAB_NAMES[NotificationLogsTab.Call]).toBe(
      CALL_KEY,
    );
    expect(NOTIFICATION_LOGS_TAB_NAMES[NotificationLogsTab.Push]).toBe(
      PUSH_KEY,
    );
    expect(MEANING_KEYS).toContain(CALL_KEY);
    expect(MEANING_KEYS).toContain(PUSH_KEY);
    expect(TABLES).toHaveLength(
      Object.keys(NOTIFICATION_LOGS_TAB_NAMES).length,
    );
  });

  test("read Call and Push in English, as they always did", async () => {
    const tabs: Array<string> = await tabsIn("en");

    expect(tabs[CALL_TAB]).toBe("Call");
    expect(tabs[PUSH_TAB]).toBe("Push");
  });

  test.each(DASHBOARD_LANGUAGES)(
    "in %s, read as the language words a phone call and a push notification",
    async (language: string) => {
      const locale: Record<string, string> = readDashboardLocale(language);
      const tabs: Array<string> = await tabsIn(language);

      expect(tabs[CALL_TAB]).toBe(locale[CALL_KEY]);
      expect(tabs[PUSH_TAB]).toBe(locale[PUSH_KEY]);
      // Worded, never the key's own brackets.
      expect(tabs[CALL_TAB]).not.toContain("(");
      expect(tabs[PUSH_TAB]).not.toContain("(");
    },
  );

  test.each(Object.entries(CALL_WORDS))(
    "in %s, the Call tab is a phone call, never the function call or call-out it read",
    async (language: string, words: { was: string; is: string }) => {
      const tabs: Array<string> = await tabsIn(language);

      expect(tabs[CALL_TAB]).toBe(words.is);
      expect(tabs[CALL_TAB]).not.toBe(words.was);
    },
  );

  test.each(Object.entries(PUSH_WORDS))(
    "in %s, the Push tab is a push notification, never what it read",
    async (language: string, words: { was: string; is: string }) => {
      const tabs: Array<string> = await tabsIn(language);

      expect(tabs[PUSH_TAB]).toBe(words.is);
      expect(tabs[PUSH_TAB]).not.toBe(words.was);
    },
  );

  test("?tab=call still opens the Call tab, in any language", async () => {
    await act(async () => {
      await i18next.changeLanguage("zh-CN");
    });
    goTo(`${PAGE}?tab=call`);

    await act(async () => {
      render(<NotificationLogsTabs />);
    });

    const selected: HTMLElement | undefined = screen
      .getAllByRole("tab")
      .find((tab: HTMLElement): boolean => {
        return tab.getAttribute("aria-selected") === "true";
      });

    expect(selected?.textContent?.trim()).toBe("电话");
    expect(screen.getByTestId("call-logs")).toBeInTheDocument();
  });
});
