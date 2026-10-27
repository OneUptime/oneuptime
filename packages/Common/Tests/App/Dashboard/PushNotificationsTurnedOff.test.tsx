import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React, { ReactElement } from "react";

/*
 * THE DASHBOARD, WHILE THE SERVER HAS PUSH TURNED OFF.
 *
 * Whether the server has push notifications turned off comes from its
 * public settings (GlobalConfigUtil.fetchVars, GET /global-config/vars),
 * once per page: usePushNotificationsTurnedOff is null while that answer is
 * on its way, and false when it cannot be read - the server refuses to
 * register a device while push is off, so all a failed read loses is the
 * notice that says why.
 *
 * User Settings > Notification Methods waits for the answer like the other
 * things its tabs depend on, so the Push Notifications tab never shows the
 * devices and then a notice. While push is off, the tab is the notice: the
 * server's own words - who turns push back on, and where - and that pages
 * still reach the person through their other methods.
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
  getPushNotificationsTab,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/NotificationMethodTabs";
import PushNotificationsTurnedOff, {
  PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID,
  PUSH_NOTIFICATIONS_TURNED_OFF_HINT,
  PUSH_NOTIFICATIONS_TURNED_OFF_NOTICE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/PushNotificationsTurnedOff";
import { usePushNotificationsTurnedOff } from "../../../../App/FeatureSet/Dashboard/src/Utils/PushNotificationsTurnedOff";
import ConnectedWorkspaces from "../../../../App/FeatureSet/Dashboard/src/Utils/Workspace/ConnectedWorkspaces";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import { PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE } from "../../../Types/PushNotification/PushNotificationsTurnedOff";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";
import { Tab } from "../../../UI/Components/Tabs/Tab";
import API from "../../../UI/Utils/API/API";
import GlobalConfigUtil, {
  GlobalConfigVars,
} from "../../../UI/Utils/GlobalConfig";
import { PROJECT_ID, goTo } from "./SideMenuHarness";

interface PendingVars {
  promise: Promise<GlobalConfigVars>;
  resolve: (vars: GlobalConfigVars) => void;
  reject: (error: Error) => void;
}

// A read of the server's settings that answers when the test says.
function pendingVars(): PendingVars {
  let resolve: (vars: GlobalConfigVars) => void = (): void => {
    return undefined;
  };
  let reject: (error: Error) => void = (): void => {
    return undefined;
  };

  const promise: Promise<GlobalConfigVars> = new Promise<GlobalConfigVars>(
    (
      resolveRead: (vars: GlobalConfigVars) => void,
      rejectRead: (error: Error) => void,
    ): void => {
      resolve = resolveRead;
      reject = rejectRead;
    },
  );

  return { promise, resolve, reject };
}

function vars(disablePushNotifications: boolean): GlobalConfigVars {
  return {
    disableUserProjectCreation: false,
    disablePushNotifications: disablePushNotifications,
  };
}

let fetchVars: jest.SpyInstance;

// What usePushNotificationsTurnedOff answers, as a page would draw it.
function HookProbe(): ReactElement {
  const isTurnedOff: boolean | null = usePushNotificationsTurnedOff();

  return (
    <output data-testid="push-turned-off">
      {isTurnedOff === null ? "waiting" : String(isTurnedOff)}
    </output>
  );
}

function probed(): string {
  return screen.getByTestId("push-turned-off").textContent || "";
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 6; i++) {
      await Promise.resolve();
    }
  });
}

beforeEach(() => {
  fetchVars = jest
    .spyOn(GlobalConfigUtil, "fetchVars")
    .mockResolvedValue(vars(false));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("usePushNotificationsTurnedOff", () => {
  test("is null while the answer is on its way", async () => {
    fetchVars.mockReturnValue(pendingVars().promise);

    render(<HookProbe />);
    await settle();

    expect(probed()).toBe("waiting");
  });

  test.each([[true], [false]])(
    "answers what the server says: turned off = %p",
    async (isTurnedOff: boolean) => {
      fetchVars.mockResolvedValue(vars(isTurnedOff));

      render(<HookProbe />);
      await settle();

      expect(probed()).toBe(String(isTurnedOff));
    },
  );

  test("a read that fails answers on, as every server was before the switch", async () => {
    fetchVars.mockRejectedValue(new Error("Network Error"));

    render(<HookProbe />);
    await settle();

    expect(probed()).toBe("false");
  });

  test("goes from waiting to the answer when it comes", async () => {
    const read: PendingVars = pendingVars();
    fetchVars.mockReturnValue(read.promise);

    render(<HookProbe />);
    await settle();
    expect(probed()).toBe("waiting");

    read.resolve(vars(true));
    await settle();

    expect(probed()).toBe("true");
  });

  test("asks once for a page, however often it draws", async () => {
    const { rerender } = render(<HookProbe />);
    await settle();

    rerender(<HookProbe />);
    rerender(<HookProbe />);
    await settle();

    expect(fetchVars).toHaveBeenCalledTimes(1);
  });

  test("an answer that comes after the page was left changes nothing, and breaks nothing", async () => {
    const read: PendingVars = pendingVars();
    fetchVars.mockReturnValue(read.promise);

    const { unmount } = render(<HookProbe />);
    await settle();
    unmount();

    read.resolve(vars(true));
    await settle();

    expect(screen.queryByTestId("push-turned-off")).toBeNull();
  });
});

describe("the notice in place of the push devices", () => {
  test("is worded exactly as the server words it everywhere else", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_NOTICE).toBe(
      PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
    );
  });

  test("says how pages still reach the person", () => {
    expect(PUSH_NOTIFICATIONS_TURNED_OFF_HINT).toBe(
      "On-call pages and notifications reach you through your other notification methods, and through any custom channels your administrator set up.",
    );
  });

  test("is a card titled Push Notifications, with the server's words and the hint", () => {
    render(<PushNotificationsTurnedOff />);

    const card: HTMLElement = screen.getByTestId(
      PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID,
    );

    expect(card).toHaveTextContent("Push Notifications");
    expect(card).toHaveTextContent(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE);
    expect(card).toHaveTextContent(PUSH_NOTIFICATIONS_TURNED_OFF_HINT);
  });

  test("offers nothing to register or test: there is nothing a device could receive", () => {
    render(<PushNotificationsTurnedOff />);

    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByTestId("push-methods")).toBeNull();
  });
});

describe("getPushNotificationsTab", () => {
  test("is named Push Notifications, push on or off", () => {
    expect(getPushNotificationsTab(true).name).toBe("Push Notifications");
    expect(getPushNotificationsTab(false).name).toBe("Push Notifications");
  });

  test("push off: the notice, in place of the devices", () => {
    const tab: Tab = getPushNotificationsTab(true);

    render(<>{tab.children}</>);

    expect(
      screen.getByTestId(PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID),
    ).toBeInTheDocument();
    expect(screen.queryByTestId("push-methods")).toBeNull();
  });

  test("push on: the devices, as they always were", () => {
    const tab: Tab = getPushNotificationsTab(false);

    render(<>{tab.children}</>);

    expect(screen.getByTestId("push-methods")).toBeInTheDocument();
    expect(
      screen.queryByTestId(PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID),
    ).toBeNull();
  });
});

describe("User Settings > Notification Methods", () => {
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
    ConnectedWorkspaces.setFetcher((): Promise<Array<WorkspaceType>> => {
      return new Promise<Array<WorkspaceType>>((): void => {});
    });
    // No workspace connected, and no custom channel on: the three tabs every page has.
    ConnectedWorkspaces.setConnected(PROJECT_ID, []);
    jest
      .spyOn(API, "post")
      .mockResolvedValue(
        new HTTPResponse<JSONObject>(200, { channels: [] }, {}) as never,
      );
    goTo(`/dashboard/${PROJECT_ID}/user-settings/notification-methods`);
  });

  afterEach(() => {
    ConnectedWorkspaces.setFetcher(null);
    ConnectedWorkspaces.reset();
  });

  test("waits for whether push is off: no tab until it is known, then all of them", async () => {
    const read: PendingVars = pendingVars();
    fetchVars.mockReturnValue(read.promise);

    await renderTabs();

    expect(screen.getByTestId("bar-loader")).toBeInTheDocument();
    expect(tabNames()).toEqual([]);

    await act(async () => {
      read.resolve(vars(true));
    });

    expect(tabNames()).toEqual([
      "Direct Contact",
      "Push Notifications",
      "Webhooks",
    ]);
  });

  test("push off: the Push Notifications tab says push is off, and shows no devices", async () => {
    fetchVars.mockResolvedValue(vars(true));

    await renderTabs();
    await openTab("Push Notifications");

    expect(
      screen.getByTestId(PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID),
    ).toHaveTextContent(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE);
    expect(screen.queryByTestId("push-methods")).toBeNull();
  });

  test("push on: the tab holds the devices, as it always did", async () => {
    fetchVars.mockResolvedValue(vars(false));

    await renderTabs();
    await openTab("Push Notifications");

    expect(screen.getByTestId("push-methods")).toBeInTheDocument();
    expect(
      screen.queryByTestId(PUSH_NOTIFICATIONS_TURNED_OFF_CARD_TEST_ID),
    ).toBeNull();
  });

  test("a read that fails shows the devices: the server refuses a registration on its own", async () => {
    fetchVars.mockRejectedValue(new Error("Network Error"));

    await renderTabs();
    await openTab("Push Notifications");

    expect(screen.getByTestId("push-methods")).toBeInTheDocument();
  });

  test("push off leaves the other tabs as they are", async () => {
    fetchVars.mockResolvedValue(vars(true));

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

    await openTab("Webhooks");
    expect(screen.getByTestId("webhook-methods")).toBeInTheDocument();
  });

  test("the same tabs, in the same order, push on or off", async () => {
    fetchVars.mockResolvedValue(vars(false));
    await renderTabs();
    const withPushOn: Array<string> = tabNames();
    cleanup();

    fetchVars.mockResolvedValue(vars(true));
    await renderTabs();

    expect(tabNames()).toEqual(withPushOn);
  });
});
