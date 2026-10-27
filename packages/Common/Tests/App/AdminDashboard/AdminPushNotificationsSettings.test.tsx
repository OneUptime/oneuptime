import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  within,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * ADMIN DASHBOARD > SETTINGS > PUSH NOTIFICATIONS.
 *
 * One switch for the whole server, saved the moment it is flipped (the
 * shared ModelSwitchCard, through AdminModelAPI): "Send push notifications",
 * on while GlobalConfig.disablePushNotifications is false - as every server
 * was before the switch. Turning it off stops pages to everyone whose only
 * way to be reached is a push device, so it asks first, with a red button,
 * and says to reach people through a custom channel instead. Turning it back
 * on asks nothing.
 *
 * The real page, card, switch and dialog are rendered with the Admin
 * Dashboard's English locale. Only the admin API, the page chrome and the
 * side menu are stand-ins; the signed-in user is a master admin, as
 * everyone in the admin dashboard is.
 */

const mockGetItem: MockFunction = getJestMockFunction();
const mockUpdateById: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Utils/ModelAPI",
  () => {
    return {
      __esModule: true,
      default: {
        getItem: (...args: Array<unknown>): unknown => {
          return mockGetItem(...args);
        },
        updateById: (...args: Array<unknown>): unknown => {
          return mockUpdateById(...args);
        },
      },
    };
  },
);

interface MockPageProps {
  title?: string | undefined;
  breadcrumbLinks?: Array<{ title: string; to: { toString: () => string } }>;
  children?: ReactNode | undefined;
}

// What the page handed its chrome: its title and breadcrumbs.
const mockPageRenders: Array<MockPageProps> = [];

jest.mock("../../../UI/Components/Page/Page", () => {
  return {
    __esModule: true,
    default: (props: MockPageProps): ReactElement => {
      mockPageRenders.push(props);
      return <main data-testid="admin-page">{props.children}</main>;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/SideMenu",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

import SettingsPushNotifications from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/PushNotifications/Index";
import {
  getPushNotificationsSwitchConfirmation,
  getPushNotificationsSwitchDescription,
  PUSH_NOTIFICATIONS_SWITCH_TEST_ID,
  TURN_OFF_PUSH_CONFIRMATION,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/PushNotifications/PushNotificationsCopy";
import PageMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/AdminDashboard/src/Utils/RouteMap";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import ObjectID from "../../../Types/ObjectID";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import UserUtil from "../../../UI/Utils/User";

const ADMIN_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

const ENGLISH: Record<string, unknown> = JSON.parse(
  fs.readFileSync(path.join(ADMIN_SRC, "Locales", "en.json"), "utf8"),
) as Record<string, unknown>;

const ZERO_ID: string = ObjectID.getZeroObjectID().toString();
const SIGNED_IN_ADMIN_ID: string = "dddddddd-0000-4000-8000-000000000001";

const SWITCH_TITLE: string = "Send push notifications";
const CARD_TITLE: string = "Push Notifications";
const CARD_DESCRIPTION: string =
  "Notifications pushed to the OneUptime mobile app and to browsers, through Expo, the push relay and the browsers' push services.";
const ON_DESCRIPTION: string =
  "People can register their phones and browsers, and on-call pages and notifications are pushed to them.";
const OFF_DESCRIPTION: string =
  "Nothing is pushed to phones or browsers, in any project, and no device can be registered. Reach people through a custom channel instead.";

// What the server holds on the one GlobalConfig row.
let stored: Record<string, unknown> = {};

interface ItemCall {
  modelType: unknown;
  id: ObjectID;
  select: Record<string, unknown>;
}

interface UpdateCall {
  modelType: unknown;
  id: ObjectID;
  data: Record<string, unknown>;
}

function itemCalls(): Array<ItemCall> {
  return mockGetItem.mock.calls.map((call: Array<unknown>): ItemCall => {
    return call[0] as ItemCall;
  });
}

function updateCalls(): Array<UpdateCall> {
  return mockUpdateById.mock.calls.map((call: Array<unknown>): UpdateCall => {
    return call[0] as UpdateCall;
  });
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 8; i++) {
      await Promise.resolve();
    }
  });
}

async function renderPage(): Promise<void> {
  const instance: i18n = createInstance();

  await instance.init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: ENGLISH } },
    interpolation: { escapeValue: false },
  });

  render(
    <I18nextProvider i18n={instance}>
      <SettingsPushNotifications />
    </I18nextProvider>,
  );

  await flush();
}

function theSwitch(): HTMLElement {
  return screen.getByTestId(PUSH_NOTIFICATIONS_SWITCH_TEST_ID);
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

function dialog(): HTMLElement {
  return screen.getByRole("dialog");
}

async function confirmWith(buttonName: string): Promise<void> {
  fireEvent.click(within(dialog()).getByRole("button", { name: buttonName }));
  await flush();
}

beforeEach(() => {
  stored = {};
  mockPageRenders.length = 0;

  mockGetItem.mockReset();
  mockGetItem.mockImplementation(async (options: unknown): Promise<unknown> => {
    const call: ItemCall = options as ItemCall;
    const item: GlobalConfig = new GlobalConfig();

    item._id = call.id.toString();
    Object.assign(item, stored);

    return item;
  });

  mockUpdateById.mockReset();
  mockUpdateById.mockImplementation(
    async (options: unknown): Promise<unknown> => {
      stored = { ...stored, ...(options as UpdateCall).data };
      return {};
    },
  );

  // Everyone in the admin dashboard is a master admin.
  getJestSpyOn(UserUtil, "isMasterAdmin").mockReturnValue(true);
  getJestSpyOn(UserUtil, "getUserId").mockReturnValue(
    new ObjectID(SIGNED_IN_ADMIN_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("what the page says (PushNotificationsCopy)", () => {
  test("the switch's test id", () => {
    expect(PUSH_NOTIFICATIONS_SWITCH_TEST_ID).toBe("push-notifications-switch");
  });

  test("under the switch: what on means, and what off means", () => {
    expect(getPushNotificationsSwitchDescription(true)).toBe(ON_DESCRIPTION);
    expect(getPushNotificationsSwitchDescription(false)).toBe(OFF_DESCRIPTION);
  });

  test("off says no device can be registered, and points at a custom channel", () => {
    expect(OFF_DESCRIPTION).toContain("no device can be registered");
    expect(OFF_DESCRIPTION).toContain("custom channel");
  });

  test("only turning push off asks first, and it is a danger", () => {
    expect(getPushNotificationsSwitchConfirmation(true)).toBeUndefined();
    expect(getPushNotificationsSwitchConfirmation(false)).toBe(
      TURN_OFF_PUSH_CONFIRMATION,
    );
    expect(TURN_OFF_PUSH_CONFIRMATION).toEqual({
      title: "Turn off push notifications?",
      description:
        "Phones and browsers get no pushes in any project, and none can register. People reached only by push will not be paged: add a custom channel first.",
      submitButtonText: "Turn Off Push Notifications",
      submitButtonType: ButtonStyleType.DANGER,
    });
  });

  test("the question says who stops being paged, and what to do about it", () => {
    expect(TURN_OFF_PUSH_CONFIRMATION.description).toContain(
      "People reached only by push will not be paged",
    );
    expect(TURN_OFF_PUSH_CONFIRMATION.description).toContain(
      "add a custom channel",
    );
  });
});

describe("Settings > Push Notifications", () => {
  test("is one switch, named for what it does, on its card - no Edit dialog", async () => {
    await renderPage();

    expect(screen.getAllByRole("switch")).toHaveLength(1);
    expect(screen.getByRole("switch", { name: SWITCH_TITLE })).toBe(
      theSwitch(),
    );
    expect(screen.getByText(CARD_TITLE)).toBeInTheDocument();
    expect(screen.getByText(CARD_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^Edit/ })).toBeNull();
  });

  test("reads the one GlobalConfig row's switch, through the admin API", async () => {
    await renderPage();

    expect(itemCalls()).toHaveLength(1);
    expect(itemCalls()[0]!.modelType).toBe(GlobalConfig);
    expect(itemCalls()[0]!.id.toString()).toBe(ZERO_ID);
    expect(itemCalls()[0]!.select).toEqual({ disablePushNotifications: true });
  });

  test("is titled with the settings page's title, and its breadcrumbs end on this page", async () => {
    await renderPage();

    const page: MockPageProps = mockPageRenders[mockPageRenders.length - 1]!;
    const breadcrumbs: Array<{ title: string; to: string }> = (
      page.breadcrumbLinks || []
    ).map((link: { title: string; to: { toString: () => string } }) => {
      return { title: link.title, to: link.to.toString() };
    });

    expect(page.title).toBe(
      (ENGLISH["pages"] as Record<string, Record<string, string>>)["settings"]![
        "title"
      ],
    );
    expect(breadcrumbs[breadcrumbs.length - 1]).toEqual({
      title: "Push Notifications",
      to: "/admin/settings/push-notifications",
    });
    expect(breadcrumbs).toHaveLength(3);
  });

  test("a server that never set it sends push: the switch is on, with what that means", async () => {
    await renderPage();

    expect(theSwitch()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(ON_DESCRIPTION)).toBeInTheDocument();
    expect(screen.queryByText(OFF_DESCRIPTION)).toBeNull();
  });

  test("a server with push turned off shows the switch off, with what that means", async () => {
    stored = { disablePushNotifications: true };

    await renderPage();

    expect(theSwitch()).toHaveAttribute("aria-checked", "false");
    expect(screen.getByText(OFF_DESCRIPTION)).toBeInTheDocument();
  });

  test("turning push off asks first, with a red button, and saves nothing yet", async () => {
    await renderPage();

    const control: HTMLElement = theSwitch();

    await press(control);

    expect(updateCalls()).toEqual([]);
    expect(dialog()).toHaveAccessibleName(TURN_OFF_PUSH_CONFIRMATION.title);
    expect(
      within(dialog()).getByTestId("confirm-modal-description"),
    ).toHaveTextContent(TURN_OFF_PUSH_CONFIRMATION.description);
    expect(
      within(dialog()).getByRole("button", {
        name: TURN_OFF_PUSH_CONFIRMATION.submitButtonText!,
      }),
    ).toHaveClass("bg-red-600");

    // While it asks, the switch shows where it is going, locked.
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(control).toHaveAttribute("aria-disabled", "true");
  });

  test("confirming saves disablePushNotifications: true on the one row, and says Saved", async () => {
    await renderPage();

    const control: HTMLElement = theSwitch();

    await press(control);
    await confirmWith(TURN_OFF_PUSH_CONFIRMATION.submitButtonText!);

    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.modelType).toBe(GlobalConfig);
    expect(updateCalls()[0]!.id.toString()).toBe(ZERO_ID);
    expect(updateCalls()[0]!.data).toEqual({ disablePushNotifications: true });
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      screen.getByTestId(`${PUSH_NOTIFICATIONS_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Saved");
    expect(screen.getByText(OFF_DESCRIPTION)).toBeInTheDocument();
  });

  test("cancelling keeps push on, and saves nothing", async () => {
    await renderPage();

    const control: HTMLElement = theSwitch();

    await press(control);
    await confirmWith("Cancel");

    expect(updateCalls()).toEqual([]);
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(ON_DESCRIPTION)).toBeInTheDocument();
  });

  test("turning push back on saves disablePushNotifications: false at once, with no dialog", async () => {
    stored = { disablePushNotifications: true };

    await renderPage();

    const control: HTMLElement = theSwitch();

    await press(control);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updateCalls()).toHaveLength(1);
    expect(updateCalls()[0]!.data).toEqual({ disablePushNotifications: false });
    expect(control).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(ON_DESCRIPTION)).toBeInTheDocument();
  });

  test("a refused save moves the switch back and says why", async () => {
    mockUpdateById.mockImplementation(async (): Promise<unknown> => {
      throw new Error("This setting cannot be changed right now.");
    });

    await renderPage();

    const control: HTMLElement = theSwitch();

    await press(control);
    await confirmWith(TURN_OFF_PUSH_CONFIRMATION.submitButtonText!);

    expect(control).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByText("This setting cannot be changed right now."),
    ).toBeInTheDocument();
  });
});

describe("the page's place in the Admin Dashboard", () => {
  test("has its own address under Settings", () => {
    expect(RouteMap[PageMap.SETTINGS_PUSH_NOTIFICATIONS]?.toString()).toBe(
      "/admin/settings/push-notifications",
    );
  });

  test("the Admin Dashboard routes that address to this page", () => {
    const app: string = fs.readFileSync(
      path.join(ADMIN_SRC, "App.tsx"),
      "utf8",
    );

    expect(app).toContain(
      'import SettingsPushNotifications from "./Pages/Settings/PushNotifications/Index";',
    );

    const route: string = app.slice(
      app.indexOf("PageMap.SETTINGS_PUSH_NOTIFICATIONS"),
    );

    // The route whose path is the page's address renders the page.
    expect(route).toMatch(
      /^PageMap\.SETTINGS_PUSH_NOTIFICATIONS\]\?\.toString\(\) \|\| ""\s*}\s*element=\{<SettingsPushNotifications \/>\}/,
    );
  });

  test("the settings side menu links to it, as Push Notifications", () => {
    const sideMenu: string = fs.readFileSync(
      path.join(ADMIN_SRC, "Pages", "Settings", "SideMenu.tsx"),
      "utf8",
    );

    const entry: string = sideMenu.slice(
      sideMenu.lastIndexOf(
        "<SideMenuItem",
        sideMenu.indexOf("PageMap.SETTINGS_PUSH_NOTIFICATIONS"),
      ),
      sideMenu.indexOf(
        "/>",
        sideMenu.indexOf("PageMap.SETTINGS_PUSH_NOTIFICATIONS"),
      ),
    );

    expect(entry).toContain('title: "Push Notifications"');
  });
});
