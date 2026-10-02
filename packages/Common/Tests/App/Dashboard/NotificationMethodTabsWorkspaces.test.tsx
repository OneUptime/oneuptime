import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { Mock } from "jest-mock";
import React, { ReactElement } from "react";

/*
 * User Settings > Notification Methods (and the same tabs an admin sees on
 * their own row under Users): Slack and Microsoft Teams are offered only for
 * the workspaces the project has connected. Adding either points at your own
 * account in a workspace the project is connected to, so a table for one it
 * never connected was a table nobody could add a row to.
 */

function stub(testId: string): () => ReactElement {
  return (): ReactElement => {
    return <div data-testid={testId} />;
  };
}

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Email",
  () => {
    return { __esModule: true, default: stub("email-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/SMS",
  () => {
    return { __esModule: true, default: stub("sms-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Call",
  () => {
    return { __esModule: true, default: stub("call-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/WhatsApp",
  () => {
    return { __esModule: true, default: stub("whatsapp-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Telegram",
  () => {
    return { __esModule: true, default: stub("telegram-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Slack",
  () => {
    return { __esModule: true, default: stub("slack-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/MicrosoftTeams",
  () => {
    return { __esModule: true, default: stub("teams-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Push",
  () => {
    return { __esModule: true, default: stub("push-methods") };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Webhook",
  () => {
    return { __esModule: true, default: stub("webhook-methods") };
  },
);

import NotificationMethodTabs, {
  getWorkspaceAppsTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethodTabs";
import UserSettingsNotificationMethods from "../../../../App/FeatureSet/Dashboard/src/Pages/UserSettings/NotificationMethods";
import ConnectedWorkspaces, {
  ConnectedWorkspacesFetcher,
  REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import Route from "../../../Types/API/Route";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { Tab } from "../../../UI/Components/Tabs/Tab";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

let fetcher: Mock<ConnectedWorkspacesFetcher>;

function connect(...types: Array<WorkspaceType>): void {
  ConnectedWorkspaces.setConnected(PROJECT_ID, types);
}

function tabNames(): Array<string> {
  return screen.queryAllByRole("tab").map((tab: HTMLElement): string => {
    return tab.textContent?.trim() || "";
  });
}

async function renderTabs(): Promise<void> {
  await act(async () => {
    render(<NotificationMethodTabs />);
  });
}

async function openTab(name: string): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("tab", { name }));
  });
}

beforeEach(() => {
  window.localStorage.clear();
  ConnectedWorkspaces.reset();
  fetcher = jest.fn<ConnectedWorkspacesFetcher>();
  fetcher.mockImplementation((): Promise<Array<WorkspaceType>> => {
    return new Promise<Array<WorkspaceType>>((): void => {});
  });
  ConnectedWorkspaces.setFetcher(fetcher);
  goTo(`/dashboard/${PROJECT_ID}/user-settings/notification-methods`);
});

afterEach(() => {
  cleanup();
  ConnectedWorkspaces.setFetcher(null);
  ConnectedWorkspaces.reset();
});

describe("the Workspace Apps tab", () => {
  test("nothing connected: no Workspace Apps tab, the other three as before", async () => {
    connect();
    await renderTabs();

    expect(tabNames()).toEqual([
      "Direct Contact",
      "Push Notifications",
      "Webhooks",
    ]);
  });

  test.each([
    [[WorkspaceType.Slack], ["slack-methods"], ["teams-methods"]],
    [[WorkspaceType.MicrosoftTeams], ["teams-methods"], ["slack-methods"]],
    [
      [WorkspaceType.Slack, WorkspaceType.MicrosoftTeams],
      ["slack-methods", "teams-methods"],
      [],
    ],
  ])(
    "%j connected: the tab holds %j and not %j",
    async (
      types: Array<WorkspaceType>,
      shown: Array<string>,
      hidden: Array<string>,
    ) => {
      connect(...types);
      await renderTabs();

      expect(tabNames()).toEqual([
        "Direct Contact",
        "Workspace Apps",
        "Push Notifications",
        "Webhooks",
      ]);

      await openTab("Workspace Apps");

      for (const testId of shown) {
        expect(screen.getByTestId(testId)).toBeInTheDocument();
      }

      for (const testId of hidden) {
        expect(screen.queryByTestId(testId)).not.toBeInTheDocument();
      }
    },
  );

  test("Direct Contact, Push Notifications and Webhooks are there whatever is connected", async () => {
    connect();
    await renderTabs();

    for (const testId of [
      "email-methods",
      "sms-methods",
      "call-methods",
      "whatsapp-methods",
      "telegram-methods",
    ]) {
      expect(screen.getByTestId(testId)).toBeInTheDocument();
    }

    await openTab("Push Notifications");
    expect(screen.getByTestId("push-methods")).toBeInTheDocument();

    await openTab("Webhooks");
    expect(screen.getByTestId("webhook-methods")).toBeInTheDocument();
  });

  test("if asking fails, both tables are offered, as before", async () => {
    fetcher.mockRejectedValue(new Error("Permission denied"));
    await renderTabs();

    await openTab("Workspace Apps");

    expect(screen.getByTestId("slack-methods")).toBeInTheDocument();
    expect(screen.getByTestId("teams-methods")).toBeInTheDocument();
  });

  test("on a first visit the page waits for the answer rather than adding or dropping a tab under the reader", async () => {
    await renderTabs();

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(tabNames()).toEqual([]);
  });

  test("after that it draws at once from the remembered answer", async () => {
    window.localStorage.setItem(
      `${REMEMBERED_CONNECTIONS_STORAGE_KEY_PREFIX}${PROJECT_ID}`,
      JSON.stringify([WorkspaceType.MicrosoftTeams]),
    );
    await renderTabs();

    expect(tabNames()).toEqual([
      "Direct Contact",
      "Workspace Apps",
      "Push Notifications",
      "Webhooks",
    ]);
  });

  test("getWorkspaceAppsTab is null with nothing to offer, and named Workspace Apps otherwise", () => {
    expect(getWorkspaceAppsTab([])).toBeNull();

    const tab: Tab | null = getWorkspaceAppsTab([WorkspaceType.Slack]);

    expect(tab?.name).toBe("Workspace Apps");
  });

  test("User Settings > Notification Methods is these tabs", async () => {
    connect(WorkspaceType.Slack);

    await act(async () => {
      render(
        <UserSettingsNotificationMethods
          pageRoute={new Route("/user-settings/notification-methods")}
          currentProject={null}
          hasPaymentMethod={false}
        />,
      );
    });

    expect(tabNames()).toEqual([
      "Direct Contact",
      "Workspace Apps",
      "Push Notifications",
      "Webhooks",
    ]);

    await openTab("Workspace Apps");

    expect(screen.getByTestId("slack-methods")).toBeInTheDocument();
    expect(screen.queryByTestId("teams-methods")).not.toBeInTheDocument();
  });
});
