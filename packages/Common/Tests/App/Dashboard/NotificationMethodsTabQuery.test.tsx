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
} from "@testing-library/react";
import type { SpyInstance } from "jest-mock";
import React, { ReactElement } from "react";

/*
 * User Settings > Notification Methods opens on the tab a link asks for
 * (#8887): Notification Settings' "Set up" beside push sends somebody to
 * ?tab=push-notifications, not to Direct Contact to hunt for it. The tab
 * opened goes into the address in place, the first tab is the bare
 * address, and a tab that is not there opens the first.
 */

function stub(testId: string): () => ReactElement {
  const MethodTableStub: () => ReactElement = (): ReactElement => {
    return <div data-testid={testId} />;
  };

  return MethodTableStub;
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
  "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Mattermost",
  () => {
    return { __esModule: true, default: stub("mattermost-methods") };
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

import NotificationMethodTabs from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethodTabs";
import {
  DEFAULT_NOTIFICATION_METHODS_TAB,
  NOTIFICATION_METHODS_TAB_NAMES,
  NOTIFICATION_METHODS_TAB_QUERY_PARAM,
  NotificationMethodsTab,
  getNotificationMethodsTabByName,
  getNotificationMethodsTabQuery,
  readNotificationMethodsTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethodsTabQuery";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import API from "../../../UI/Utils/API/API";
import GlobalConfigUtil from "../../../UI/Utils/GlobalConfig";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

const PAGE: string = `/dashboard/${PROJECT_ID}/user-settings/notification-methods`;

describe("the tab an address asks for", () => {
  test("is read from its slug, and nothing else", () => {
    expect(readNotificationMethodsTab("push-notifications")).toBe(
      NotificationMethodsTab.PushNotifications,
    );
    expect(readNotificationMethodsTab("webhooks")).toBe(
      NotificationMethodsTab.Webhooks,
    );
    expect(readNotificationMethodsTab("workspace-apps")).toBe(
      NotificationMethodsTab.WorkspaceApps,
    );
    expect(readNotificationMethodsTab("Push Notifications")).toBeNull();
    expect(readNotificationMethodsTab("nonsense")).toBeNull();
    expect(readNotificationMethodsTab("")).toBeNull();
    expect(readNotificationMethodsTab(null)).toBeNull();
    expect(readNotificationMethodsTab(undefined)).toBeNull();
  });

  test("each tab's name maps back to its slug", () => {
    for (const tab of Object.values(NotificationMethodsTab)) {
      expect(
        getNotificationMethodsTabByName(NOTIFICATION_METHODS_TAB_NAMES[tab]),
      ).toBe(tab);
    }

    expect(getNotificationMethodsTabByName("Nope")).toBeNull();
  });

  test("the first tab is the bare address; every other carries ?tab=", () => {
    expect(DEFAULT_NOTIFICATION_METHODS_TAB).toBe(
      NotificationMethodsTab.DirectContact,
    );
    expect(
      getNotificationMethodsTabQuery(NotificationMethodsTab.DirectContact),
    ).toEqual({});

    for (const tab of Object.values(NotificationMethodsTab)) {
      if (tab === DEFAULT_NOTIFICATION_METHODS_TAB) {
        continue;
      }

      expect(getNotificationMethodsTabQuery(tab)).toEqual({
        [NOTIFICATION_METHODS_TAB_QUERY_PARAM]: tab,
      });
    }
  });
});

describe("Notification Methods, opened from a link", () => {
  let customChannelsRead: SpyInstance<
    (...args: Parameters<typeof API.post>) => ReturnType<typeof API.post>
  >;
  let fetchVars: SpyInstance<typeof GlobalConfigUtil.fetchVars>;

  beforeEach(() => {
    window.localStorage.clear();
    ConnectedWorkspaces.reset();
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    customChannelsRead = jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { channels: [] }, {}) as never,
      );
    fetchVars = jest.spyOn(GlobalConfigUtil, "fetchVars").mockResolvedValue({
      disableUserProjectCreation: false,
      disablePushNotifications: false,
      canSendEmail: true,
      canProjectsChooseCallVoice: false,
    });
  });

  afterEach(() => {
    cleanup();
    customChannelsRead.mockRestore();
    fetchVars.mockRestore();
    ConnectedWorkspaces.setFetcher(null);
    ConnectedWorkspaces.reset();
    goTo(PAGE);
  });

  async function renderTabs(): Promise<void> {
    await act(async () => {
      render(<NotificationMethodTabs />);
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

  test("every slug names a tab the page draws, by its name", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, [WorkspaceType.Slack]);
    customChannelsRead.mockResolvedValue(
      new HTTPResponse<JSONObject>(
        200,
        {
          channels: [
            { _id: "6a1f1b4e-9f0c-4d8e-8b2a-3c4d5e6f7a8b", name: "CorpoApp" },
          ],
        },
        {},
      ) as never,
    );
    goTo(PAGE);
    await renderTabs();

    const drawn: Array<string> = screen
      .getAllByRole("tab")
      .map((tab: HTMLElement): string => {
        return tab.textContent?.trim() || "";
      });

    expect([...drawn].sort()).toEqual(
      Object.values(NOTIFICATION_METHODS_TAB_NAMES).sort(),
    );
  });

  test.each([
    ["push-notifications", "Push Notifications", "push-methods"],
    ["webhooks", "Webhooks", "webhook-methods"],
    ["workspace-apps", "Workspace Apps", "slack-methods"],
  ])(
    "?tab=%s opens on %s",
    async (slug: string, tabName: string, testId: string) => {
      goTo(`${PAGE}?tab=${slug}`);
      await renderTabs();

      expect(selectedTab()).toBe(tabName);
      expect(screen.getByTestId(testId)).toBeInTheDocument();
      // The address keeps it, for a reload or a copied link.
      expect(window.location.search).toBe(`?tab=${slug}`);
    },
  );

  test("the bare address opens Direct Contact", async () => {
    goTo(PAGE);
    await renderTabs();

    expect(selectedTab()).toBe("Direct Contact");
    expect(screen.getByTestId("sms-methods")).toBeInTheDocument();
    expect(window.location.search).toBe("");
  });

  test("a tab that is not here opens the first, and the address drops it", async () => {
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);
    goTo(`${PAGE}?tab=workspace-apps`);
    await renderTabs();

    expect(selectedTab()).toBe("Direct Contact");
    expect(window.location.search).toBe("");
  });

  test("an unknown slug opens the first tab", async () => {
    goTo(`${PAGE}?tab=elsewhere`);
    await renderTabs();

    expect(selectedTab()).toBe("Direct Contact");
  });

  test("opening a tab puts it in the address; going back to the first takes it out", async () => {
    goTo(PAGE);
    await renderTabs();

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Webhooks" }));
    });

    expect(window.location.search).toBe("?tab=webhooks");

    await act(async () => {
      fireEvent.click(screen.getByRole("tab", { name: "Direct Contact" }));
    });

    expect(window.location.search).toBe("");
  });
});
