import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * Notification Logs open on the tab a link asks for (#7374): the verify
 * dialog's "Open Notification Logs", under an SMS code that has not come,
 * opens ?tab=sms, not the Email tab every visit starts on. The first tab
 * is the bare address, and a tab that is not there opens the first.
 */

function stub(testId: string): () => ReactElement {
  const LogTableStub: () => ReactElement = (): ReactElement => {
    return <div data-testid={testId} />;
  };

  return LogTableStub;
}

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
  DEFAULT_NOTIFICATION_LOGS_TAB,
  NOTIFICATION_LOGS_TAB_NAMES,
  NotificationLogsTab,
  getNotificationLogsTabQueryString,
  readNotificationLogsTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationLogs/NotificationLogsTabQuery";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const PAGE: string = `/dashboard/${PROJECT_ID}/settings/notification-logs`;

afterEach(() => {
  cleanup();
  goTo(PAGE);
});

async function renderTabs(): Promise<void> {
  await act(async () => {
    render(<NotificationLogsTabs />);
  });
}

function selectedTab(): string {
  return (
    screen
      .getAllByRole("tab")
      .find((tab: HTMLElement): boolean => {
        return tab.getAttribute("aria-selected") === "true";
      })
      ?.textContent?.trim() || ""
  );
}

describe("the tab an address asks for", () => {
  test("is read from its slug, and nothing else", () => {
    expect(readNotificationLogsTab("sms")).toBe(NotificationLogsTab.SMS);
    expect(readNotificationLogsTab("whatsapp")).toBe(
      NotificationLogsTab.WhatsApp,
    );
    expect(readNotificationLogsTab("SMS")).toBeNull();
    expect(readNotificationLogsTab("nonsense")).toBeNull();
    expect(readNotificationLogsTab("")).toBeNull();
    expect(readNotificationLogsTab(null)).toBeNull();
    expect(readNotificationLogsTab(undefined)).toBeNull();
  });

  test("the first tab is the bare address; every other carries ?tab=", () => {
    expect(DEFAULT_NOTIFICATION_LOGS_TAB).toBe(NotificationLogsTab.Email);
    expect(getNotificationLogsTabQueryString(NotificationLogsTab.Email)).toBe(
      "",
    );
    expect(getNotificationLogsTabQueryString(NotificationLogsTab.SMS)).toBe(
      "?tab=sms",
    );
    expect(
      getNotificationLogsTabQueryString(NotificationLogsTab.WhatsApp),
    ).toBe("?tab=whatsapp");
  });
});

describe("Notification Logs, opened from a link", () => {
  test("every slug names a tab the page draws, by its name, in its order", async () => {
    goTo(PAGE);
    await renderTabs();

    expect(
      screen.getAllByRole("tab").map((tab: HTMLElement): string => {
        return tab.textContent?.trim() || "";
      }),
    ).toEqual(Object.values(NOTIFICATION_LOGS_TAB_NAMES));
  });

  test.each([
    ["sms", "SMS", "sms-logs"],
    ["whatsapp", "WhatsApp", "whatsapp-logs"],
    ["call", "Call", "call-logs"],
  ])(
    "?tab=%s opens on %s",
    async (slug: string, tabName: string, testId: string) => {
      goTo(`${PAGE}?tab=${slug}`);
      await renderTabs();

      expect(selectedTab()).toBe(tabName);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    },
  );

  test("the bare address, and a tab it does not know, open Email", async () => {
    for (const address of [PAGE, `${PAGE}?tab=nonsense`]) {
      goTo(address);
      await renderTabs();

      expect(selectedTab()).toBe("Email");
      expect(screen.getByTestId("email-logs")).toBeInTheDocument();
      cleanup();
    }
  });
});
