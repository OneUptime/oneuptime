/*
 * jest itself is the global one: @jest/globals types jest.fn() as a Mock the
 * global jest.Mock annotations here do not accept.
 */
import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * User Settings > Notification Methods > Push Notifications: the Critical
 * Alerts column of the Push Notification Devices card, as the Dashboard
 * renders it, against the list a person's devices come back as.
 *
 * The maintainer's words: the bare checkmark "looks like a toggle that I can
 * change from the web dashboard by editing this entry. If this is turned
 * off, please also show how to enable critical alerts ... We do not need
 * registeredat column to be shown."
 *
 * So, here: every state of a device's critical alerts drawn as a status and
 * never as a control; the steps that turn them on, per platform, as the app
 * really asks for them (held to the app's own source by
 * App/Tests/Dashboard/PushDeviceCriticalAlertsMatchMobileApp.test.ts); a
 * browser's way to them; the empty card; what a test notification says it
 * did; and no Registered At.
 */

const postMock: MockFunction = getJestMockFunction();
const getMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const getCommonHeadersMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: any) => {
        return error?.message || "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (...args: Array<any>) => {
        return getCommonHeadersMock(...args);
      },
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Config", () => {
  return {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
    VAPID_PUBLIC_KEY:
      "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U",
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import PushMethods from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/Push";
import {
  MOBILE_APP_ANDROID_URL,
  MOBILE_APP_IOS_URL,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppStoreLinks";
import { getMobileAppServerUrl } from "../../../../App/FeatureSet/Dashboard/src/Utils/MobileAppServerUrl";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";

const USER_ID: string = "7f000000-0000-4000-8000-0000000000a1";
const PROJECT_ID: string = "7f000000-0000-4000-8000-0000000000b1";

const PIXEL_ID: string = "7f000000-0000-4000-8000-0000000000d1";
const IPHONE_ID: string = "7f000000-0000-4000-8000-0000000000d2";
const GALAXY_ID: string = "7f000000-0000-4000-8000-0000000000d3";
const IPAD_ID: string = "7f000000-0000-4000-8000-0000000000d4";
const CHROME_ID: string = "7f000000-0000-4000-8000-0000000000d5";
const FIREFOX_ID: string = "7f000000-0000-4000-8000-0000000000d6";

const WINDOWS_CHROME: string =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

let devices: Array<UserPush>;

function device(data: {
  id: string;
  name: string;
  type: PushDeviceType;
  isCriticalAlertEnabled?: boolean;
  isVerified?: boolean;
}): UserPush {
  const model: UserPush = new UserPush();
  model.id = new ObjectID(data.id);
  model.deviceName = data.name;
  model.deviceType = data.type;
  model.isCriticalAlertEnabled = data.isCriticalAlertEnabled === true;
  model.isVerified = data.isVerified !== false;
  return model;
}

const PIXEL_ON: () => UserPush = (): UserPush => {
  return device({
    id: PIXEL_ID,
    name: "Pixel 10",
    type: PushDeviceType.Android,
    isCriticalAlertEnabled: true,
  });
};

const IPHONE_OFF: () => UserPush = (): UserPush => {
  return device({
    id: IPHONE_ID,
    name: "iPhone 15 Pro",
    type: PushDeviceType.iOS,
  });
};

const GALAXY_OFF: () => UserPush = (): UserPush => {
  return device({
    id: GALAXY_ID,
    name: "SM-S918B",
    type: PushDeviceType.Android,
  });
};

const CHROME: () => UserPush = (): UserPush => {
  return device({
    id: CHROME_ID,
    name: "Chrome on macOS",
    type: PushDeviceType.Web,
  });
};

function defineOn(target: unknown, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value: value,
    configurable: true,
    writable: true,
  });
}

/*
 * A browser that can do push, so the card's Register Device works; nothing
 * here registers one unless a test says so.
 */
function standInForTheBrowser(): void {
  const subscription: Record<string, unknown> = {
    endpoint: "https://fcm.googleapis.com/fcm/send/this-browser",
    options: { applicationServerKey: null },
    toJSON: (): JSONObject => {
      return {
        endpoint: "https://fcm.googleapis.com/fcm/send/this-browser",
        expirationTime: null,
        keys: { p256dh: "BNcR", auth: "tBHI" },
      };
    },
    unsubscribe: jest.fn(),
  };

  const registration: Record<string, unknown> = {
    scope: "http://localhost/dashboard/",
    installing: null,
    waiting: null,
    active: {
      scriptURL: "http://localhost/dashboard/sw.js",
      state: "activated",
      postMessage: jest.fn(),
    },
    pushManager: {
      getSubscription: async (): Promise<null> => {
        return null;
      },
      subscribe: jest.fn(async (): Promise<unknown> => {
        return subscription;
      }),
    },
  };

  let permission: NotificationPermission = "default";

  defineOn(window, "isSecureContext", true);
  defineOn(window, "PushManager", (): void => {});
  defineOn(window, "Notification", {
    get permission(): NotificationPermission {
      return permission;
    },
    requestPermission: jest.fn(async (): Promise<NotificationPermission> => {
      permission = "granted";
      return permission;
    }),
  });
  defineOn(window.navigator, "userAgent", WINDOWS_CHROME);
  defineOn(window.navigator, "serviceWorker", {
    getRegistration: async (): Promise<undefined> => {
      return undefined;
    },
    register: jest.fn(async (): Promise<unknown> => {
      return registration;
    }),
  });
}

function signIn(): void {
  localStorage.setItem("user_id", USER_ID);
  localStorage.setItem(
    "global_permissions",
    JSON.stringify({
      _type: "UserGlobalAccessPermission",
      globalPermissions: [Permission.CurrentUser],
      projectIds: [PROJECT_ID],
    }),
  );
  sessionStorage.setItem("current_project_id", PROJECT_ID);
}

function answerPosts(): void {
  postMock.mockImplementation(async (request: any): Promise<unknown> => {
    const url: string = request.url.toString();

    if (url.endsWith("/test-notification")) {
      return new HTTPResponse<JSONObject>(
        200,
        { success: true, message: "Test notification sent successfully" },
        {},
      );
    }

    if (url.endsWith("/user-push/register")) {
      devices.push(
        device({
          id: FIREFOX_ID,
          name: request.data.deviceName,
          type: PushDeviceType.Web,
        }),
      );

      return new HTTPResponse<JSONObject>(
        200,
        {
          success: true,
          deviceId: FIREFOX_ID,
          alreadyRegistered: false,
          isVerified: true,
        },
        {},
      );
    }

    throw new Error(`Unexpected POST ${url}`);
  });
}

// The card's reads of the device list, as the table made them.
function deviceListReads(): Array<any> {
  return getListMock.mock.calls
    .map((call: Array<any>) => {
      return call[0];
    })
    .filter((request: any) => {
      return request.modelType === UserPush;
    });
}

async function rowOf(deviceName: string): Promise<HTMLElement> {
  const name: HTMLElement = await screen.findByText(deviceName, {
    selector: "[data-testid='push-device'] span",
  });

  return name.closest("tr") as HTMLElement;
}

async function statusOf(deviceName: string): Promise<HTMLElement> {
  return within(await rowOf(deviceName)).getByTestId("critical-alert-status");
}

function dialog(): HTMLElement {
  return screen.getByTestId("modal");
}

// The numbered steps of the open dialog, as read.
function stepsOf(modal: HTMLElement): Array<string> {
  return Array.from(
    within(modal)
      .getByTestId("critical-alert-steps-list")
      .querySelectorAll("li > p"),
  ).map((step: Element): string => {
    return step.textContent || "";
  });
}

// The words the dialog draws in bold: the app's own labels.
function boldLabelsOf(element: HTMLElement): Array<string> {
  return Array.from(element.querySelectorAll("strong")).map(
    (label: Element): string => {
      return label.textContent || "";
    },
  );
}

async function openStepsFor(deviceName: string): Promise<HTMLElement> {
  fireEvent.click(
    within(await rowOf(deviceName)).getByTestId("critical-alert-steps-link"),
  );

  return await screen.findByTestId("modal");
}

beforeEach(() => {
  devices = [PIXEL_ON(), IPHONE_OFF(), GALAXY_OFF(), CHROME()];
  standInForTheBrowser();
  signIn();

  getCommonHeadersMock.mockReturnValue({});
  getListMock.mockImplementation(async (params: any): Promise<unknown> => {
    if (params.modelType === UserPush) {
      return {
        data: [...devices],
        count: devices.length,
        skip: 0,
        limit: 10,
      };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  });
  answerPosts();
});

afterEach(() => {
  cleanup();
  postMock.mockReset();
  getMock.mockReset();
  getListMock.mockReset();
  getCommonHeadersMock.mockReset();
  localStorage.clear();
  sessionStorage.clear();
});

describe("the Critical Alerts column draws each device's state as a status", () => {
  test("a phone with critical alerts on reads On, and what that does", async () => {
    render(<PushMethods />);

    const status: HTMLElement = await statusOf("Pixel 10");

    expect(status).toHaveAttribute("data-state", "on");
    expect(within(status).getByText("On")).toBeInTheDocument();
    expect(
      within(status).getByText("Rings through silent mode and Do Not Disturb"),
    ).toBeInTheDocument();
    // Nothing to do about it here: no steps.
    expect(
      within(status).queryByTestId("critical-alert-steps-link"),
    ).toBeNull();
  });

  test("a phone with them off reads Off, and offers how to turn them on - for that phone", async () => {
    render(<PushMethods />);

    const status: HTMLElement = await statusOf("iPhone 15 Pro");

    expect(status).toHaveAttribute("data-state", "off");
    expect(within(status).getByText("Off")).toBeInTheDocument();
    expect(
      within(status).getByTestId("critical-alert-steps-link"),
    ).toHaveTextContent("How to turn on");

    const link: HTMLElement = within(status).getByTestId(
      "critical-alert-steps-link",
    );

    expect(link.tagName).toBe("BUTTON");
    expect(link).toHaveAttribute("type", "button");
    expect(link).toHaveAttribute("aria-haspopup", "dialog");
    // Read out on its own, the link says which device it is about.
    expect(link).toHaveAccessibleName(
      "How to turn on critical alerts on iPhone 15 Pro",
    );
  });

  test("a browser reads Not available in browsers, and why, while a phone is listed", async () => {
    render(<PushMethods />);

    const status: HTMLElement = await statusOf("Chrome on macOS");

    expect(status).toHaveAttribute("data-state", "not-available");
    expect(
      within(status).getByText("Not available in browsers"),
    ).toBeInTheDocument();
    expect(
      within(status).getByText("A browser can't ring through silent mode"),
    ).toBeInTheDocument();
    // The phones listed above are where critical alerts are turned on.
    await waitFor(() => {
      expect(
        within(status).queryByTestId("critical-alert-steps-link"),
      ).toBeNull();
    });
  });

  test("a phone that no longer receives notifications shows nothing there, even with its switch on", async () => {
    devices = [
      device({
        id: IPAD_ID,
        name: "iPad Air",
        type: PushDeviceType.iOS,
        isCriticalAlertEnabled: true,
        isVerified: false,
      }),
    ];

    render(<PushMethods />);

    const row: HTMLElement = await rowOf("iPad Air");
    const status: HTMLElement = within(row).getByTestId(
      "critical-alert-status",
    );

    expect(status).toHaveAttribute("data-state", "not-receiving");
    expect(within(status).queryByText("On")).toBeNull();
    expect(
      within(status).queryByTestId("critical-alert-steps-link"),
    ).toBeNull();
    // A dash on screen; a screen reader hears why.
    expect(within(status).getByText("—")).toHaveAttribute(
      "aria-hidden",
      "true",
    );
    expect(
      within(status).getByText(
        "Nothing reaches this device until it is registered again.",
      ),
    ).toHaveClass("sr-only");
    // The Device column says what is wrong, once.
    expect(
      within(row).getByText("Not receiving notifications"),
    ).toBeInTheDocument();
  });

  test("a browser that no longer receives notifications still reads Not available in browsers", async () => {
    devices = [
      device({
        id: CHROME_ID,
        name: "Chrome on macOS",
        type: PushDeviceType.Web,
        isVerified: false,
      }),
      PIXEL_ON(),
    ];

    render(<PushMethods />);

    expect(await statusOf("Chrome on macOS")).toHaveAttribute(
      "data-state",
      "not-available",
    );
  });

  test("a browser row never reads On, whatever a stray stored value says", async () => {
    devices = [
      device({
        id: CHROME_ID,
        name: "Chrome on macOS",
        type: PushDeviceType.Web,
        isCriticalAlertEnabled: true,
      }),
    ];

    render(<PushMethods />);

    const status: HTMLElement = await statusOf("Chrome on macOS");

    expect(status).toHaveAttribute("data-state", "not-available");
    expect(within(status).queryByText("On")).toBeNull();
  });

  test("several devices: every row says its own state", async () => {
    devices = [
      PIXEL_ON(),
      IPHONE_OFF(),
      GALAXY_OFF(),
      device({
        id: IPAD_ID,
        name: "iPad Air",
        type: PushDeviceType.iOS,
        isVerified: false,
      }),
      CHROME(),
    ];

    render(<PushMethods />);

    await rowOf("Pixel 10");

    const states: Array<string | null> = screen
      .getAllByTestId("critical-alert-status")
      .map((status: HTMLElement): string | null => {
        return status.getAttribute("data-state");
      });

    expect(states).toEqual([
      "on",
      "off",
      "off",
      "not-receiving",
      "not-available",
    ]);
    expect(screen.getAllByTestId("critical-alert-steps-link")).toHaveLength(2);
  });

  test("nothing in the column is a control: no checkbox, no switch, no field - only the one link", async () => {
    render(<PushMethods />);

    await rowOf("Pixel 10");

    for (const status of screen.getAllByTestId("critical-alert-status")) {
      const cell: HTMLElement = status.closest("td") as HTMLElement;

      expect(within(cell).queryAllByRole("checkbox")).toHaveLength(0);
      expect(within(cell).queryAllByRole("switch")).toHaveLength(0);
      expect(cell.querySelectorAll("input, select, textarea")).toHaveLength(0);
      // The only button a cell may hold is the link to the steps.
      expect(
        within(cell)
          .queryAllByRole("button")
          .filter((button: HTMLElement): boolean => {
            return (
              button.getAttribute("data-testid") !== "critical-alert-steps-link"
            );
          }),
      ).toHaveLength(0);
    }
  });

  test("clicking a status does nothing: it opens no dialog and changes nothing", async () => {
    render(<PushMethods />);

    fireEvent.click(within(await statusOf("Pixel 10")).getByText("On"));
    fireEvent.click(within(await statusOf("iPhone 15 Pro")).getByText("Off"));

    expect(screen.queryByTestId("modal")).toBeNull();
    expect(postMock).not.toHaveBeenCalled();
  });

  test("the list reads each device's critical alerts, type and whether it still receives anything", async () => {
    render(<PushMethods />);

    await rowOf("Pixel 10");

    const select: Record<string, unknown> = deviceListReads()[0].select;

    expect(select["isCriticalAlertEnabled"]).toBe(true);
    expect(select["deviceType"]).toBe(true);
    expect(select["isVerified"]).toBe(true);
    expect(select["deviceName"]).toBe(true);
  });

  test("the column's header explains it, in an (i) beside its title", async () => {
    render(<PushMethods />);

    await rowOf("Pixel 10");

    expect(
      screen.getByRole("button", { name: "About Critical Alerts" }),
    ).toBeInTheDocument();
  });
});

describe("Registered At is gone", () => {
  test("the columns are the device and its critical alerts, then the actions", async () => {
    render(<PushMethods />);

    await rowOf("Pixel 10");

    const headers: Array<string> = screen
      .getAllByRole("columnheader")
      .map((header: HTMLElement): string => {
        return (header.textContent || "").trim();
      })
      .filter((text: string): boolean => {
        return text.length > 0;
      });

    // The select-all box the table always had, then the columns.
    expect(headers).toEqual([
      "Select all items",
      "Device",
      "Critical Alerts",
      "Actions",
    ]);
    expect(screen.queryByText("Registered At")).toBeNull();
  });

  test("each device says what kind it is instead, under its name", async () => {
    render(<PushMethods />);

    const platforms: Array<[string, string]> = [];

    for (const name of [
      "Pixel 10",
      "iPhone 15 Pro",
      "SM-S918B",
      "Chrome on macOS",
    ]) {
      platforms.push([
        name,
        within(await rowOf(name)).getByTestId("push-device-platform")
          .textContent || "",
      ]);
    }

    expect(platforms).toEqual([
      ["Pixel 10", "Android phone"],
      ["iPhone 15 Pro", "iPhone or iPad"],
      ["SM-S918B", "Android phone"],
      ["Chrome on macOS", "Web browser"],
    ]);
  });
});

describe("How to turn on: the steps on that phone, as its app asks", () => {
  test("an iPhone: open the app's Settings, turn the switch on, and allow iOS's prompt", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("iPhone 15 Pro");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Turn on critical alerts",
    );
    expect(within(modal).getByTestId("modal-description")).toHaveTextContent(
      "Critical alerts make on-call pages ring this phone even on silent or in Do Not Disturb. They are turned on in the app, on the phone itself.",
    );

    // Which phone this is about.
    expect(
      within(modal).getByTestId("critical-alert-steps-device"),
    ).toHaveTextContent("iPhone 15 ProiPhone or iPad");

    expect(stepsOf(modal)).toEqual([
      "Open OneUptime On-Call on this iPhone or iPad and tap Settings.",
      "Under Notifications, turn on Critical On-Call Alerts.",
      "When iOS asks whether OneUptime On-Call may send critical alerts, tap Allow.",
    ]);

    // The app's labels, in bold, exactly as the app draws them.
    expect(
      boldLabelsOf(within(modal).getByTestId("critical-alert-steps-list")),
    ).toEqual([
      "OneUptime On-Call",
      "Settings",
      "Notifications",
      "Critical On-Call Alerts",
      "OneUptime On-Call",
    ]);
  });

  test("an iPhone: what it does once on, how to hear it, and what to do when iOS did not ask or was told no", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("iPhone 15 Pro");

    const onceOn: HTMLElement = within(modal).getByTestId(
      "critical-alert-steps-once-on",
    );

    expect(onceOn).toHaveTextContent(
      "Once it's on, choose the alarm sound for on-call pages under Settings > Notifications > Alarm sound.",
    );
    expect(onceOn).toHaveTextContent(
      "To hear it, silence the phone and send it a Test Notification from this list.",
    );
    expect(boldLabelsOf(onceOn)).toEqual([
      "Settings",
      "Notifications",
      "Alarm sound",
    ]);

    const troubleshooting: HTMLElement = within(modal).getByTestId(
      "critical-alert-steps-troubleshooting",
    );

    // A section of the dialog, found as one: its title is the dialog's h3.
    expect(
      within(troubleshooting).getByRole("heading", {
        level: 4,
        name: "If it doesn't turn on",
      }),
    ).toBeInTheDocument();
    expect(
      Array.from(troubleshooting.querySelectorAll("li")).map(
        (item: Element): string => {
          return item.textContent || "";
        },
      ),
    ).toEqual([
      "Tapped Don't Allow? Turn on Critical Alerts in iOS Settings > Notifications > OneUptime On-Call, then turn on Critical On-Call Alerts in the app again.",
      "iOS didn't ask? Update OneUptime On-Call from the App Store: versions before 1.5.0 cannot receive critical alerts.",
    ]);
  });

  test("an Android phone: Android opens Do Not Disturb access, and the switch is turned on again after", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("SM-S918B");

    expect(
      within(modal).getByTestId("critical-alert-steps-device"),
    ).toHaveTextContent("SM-S918BAndroid phone");

    expect(stepsOf(modal)).toEqual([
      "Open OneUptime On-Call on this phone and tap Settings.",
      "Under Notifications, turn on Critical On-Call Alerts.",
      "Android opens Do Not Disturb access. Allow it for OneUptime On-Call.",
      "Go back to the app and turn on Critical On-Call Alerts again.",
    ]);

    expect(
      Array.from(
        within(modal)
          .getByTestId("critical-alert-steps-troubleshooting")
          .querySelectorAll("li"),
      ).map((item: Element): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "The app still asks for Do Not Disturb access? Allow OneUptime On-Call in the phone's Settings > Notifications > Do Not Disturb access, then turn on Critical On-Call Alerts again.",
    ]);
  });

  test("the note after the steps says what to do next, not again what the description said", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("SM-S918B");
    const description: string =
      within(modal).getByTestId("modal-description").textContent || "";
    const onceOn: string =
      within(modal).getByTestId("critical-alert-steps-once-on").textContent ||
      "";

    // The description says what critical alerts do; the note does not again.
    expect(description).toContain("silent");
    expect(description).toContain("Do Not Disturb");
    expect(onceOn).not.toContain("silent mode");
    expect(onceOn).not.toContain("Do Not Disturb");
  });

  test("the fixes are a plain list: their bullets are not icons that read as links, and are not read out", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("iPhone 15 Pro");
    const items: Array<Element> = Array.from(
      within(modal)
        .getByTestId("critical-alert-steps-troubleshooting")
        .querySelectorAll("li"),
    );

    expect(items).toHaveLength(2);

    for (const item of items) {
      const bullet: Element = item.firstElementChild!;

      expect(bullet.tagName).toBe("SPAN");
      expect(bullet).toHaveAttribute("aria-hidden", "true");
      expect(bullet).toBeEmptyDOMElement();
      // No chevron, or any other icon: a chevron reads as "go somewhere".
      expect(item.querySelector("svg")).toBeNull();
    }
  });

  test("a long device name is shown whole in the steps, wrapped, never cut short", async () => {
    const longName: string =
      "Galaxy S24 Ultra (work phone, second SIM for on-call rotations)";

    devices = [
      device({ id: GALAXY_ID, name: longName, type: PushDeviceType.Android }),
    ];

    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor(longName);
    const name: HTMLElement = within(modal).getByTestId(
      "critical-alert-steps-device-name",
    );

    expect(name.textContent).toBe(longName);
    expect(name).not.toHaveClass("truncate");
    expect(name).toHaveClass("break-words");
  });

  test("the steps are numbered in order, and the numbers are not read out on top of the list", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("SM-S918B");
    const list: HTMLElement = within(modal).getByTestId(
      "critical-alert-steps-list",
    );

    expect(list.tagName).toBe("OL");

    const numbers: Array<Element> = Array.from(
      list.querySelectorAll("li > span"),
    );

    expect(
      numbers.map((number: Element): string => {
        return number.textContent || "";
      }),
    ).toEqual(["1", "2", "3", "4"]);
    for (const number of numbers) {
      expect(number).toHaveAttribute("aria-hidden", "true");
    }
  });

  test("closing the steps reads the list again, so a phone turned on meanwhile reads On", async () => {
    render(<PushMethods />);

    await openStepsFor("iPhone 15 Pro");

    const readsBefore: number = deviceListReads().length;

    // The responder follows the steps on the phone; the app tells the server.
    devices = [
      PIXEL_ON(),
      device({
        id: IPHONE_ID,
        name: "iPhone 15 Pro",
        type: PushDeviceType.iOS,
        isCriticalAlertEnabled: true,
      }),
      GALAXY_OFF(),
      CHROME(),
    ];

    // The footer's Close; the header's X is the other way out.
    fireEvent.click(within(dialog()).getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    await waitFor(() => {
      expect(deviceListReads().length).toBe(readsBefore + 1);
    });

    await waitFor(async () => {
      expect(await statusOf("iPhone 15 Pro")).toHaveAttribute(
        "data-state",
        "on",
      );
    });
  });

  test("Escape closes the steps", async () => {
    render(<PushMethods />);

    await openStepsFor("iPhone 15 Pro");

    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
  });

  test("the steps change nothing on the server: opening and closing them sends no request", async () => {
    render(<PushMethods />);

    await openStepsFor("SM-S918B");
    fireEvent.keyDown(document, { key: "Escape" });

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(postMock).not.toHaveBeenCalled();
  });
});

describe("a browser, and nobody's phone yet", () => {
  test("with no phone listed, a browser offers the way to critical alerts on a phone", async () => {
    devices = [CHROME()];

    render(<PushMethods />);

    const status: HTMLElement = await statusOf("Chrome on macOS");
    const link: HTMLElement = await within(status).findByTestId(
      "critical-alert-steps-link",
    );

    expect(link).toHaveTextContent("Get them on your phone");
    expect(link).toHaveAccessibleName(
      "How to get critical alerts on your phone",
    );
  });

  test("the steps get the app on a phone, from the stores, and the setting there", async () => {
    devices = [CHROME()];

    render(<PushMethods />);

    const status: HTMLElement = await statusOf("Chrome on macOS");

    fireEvent.click(
      await within(status).findByTestId("critical-alert-steps-link"),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Get the mobile app",
    );
    expect(within(modal).getByTestId("modal-description")).toHaveTextContent(
      "Get push notifications on your phone with the OneUptime On-Call app. Its critical alerts ring on-call pages through silent mode and Do Not Disturb, which a browser can't.",
    );

    expect(stepsOf(modal)).toEqual([
      "Install OneUptime On-Call on your phone from the App Store or Google Play.",
      `Open it, connect to ${getMobileAppServerUrl()} and sign in. Allow notifications, and your phone shows up in this list.`,
      "In the app, tap Settings and, under Notifications, turn on Critical On-Call Alerts. Allow what the phone asks for, then check the switch is on.",
    ]);

    // No phone to name, and nothing that only a phone does.
    expect(
      within(modal).queryByTestId("critical-alert-steps-device"),
    ).toBeNull();
    expect(
      within(modal).queryByTestId("critical-alert-steps-once-on"),
    ).toBeNull();
    expect(
      within(modal).queryByTestId("critical-alert-steps-troubleshooting"),
    ).toBeNull();
  });

  test("the stores are links to the OneUptime On-Call app, opened apart from the Dashboard", async () => {
    devices = [CHROME()];

    render(<PushMethods />);

    fireEvent.click(
      await within(await statusOf("Chrome on macOS")).findByTestId(
        "critical-alert-steps-link",
      ),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");
    const appStore: HTMLElement = within(modal).getByRole("link", {
      name: "App Store",
    });
    const googlePlay: HTMLElement = within(modal).getByRole("link", {
      name: "Google Play",
    });

    expect(appStore.getAttribute("href")).toBe(MOBILE_APP_IOS_URL);
    expect(googlePlay.getAttribute("href")).toBe(MOBILE_APP_ANDROID_URL);
    expect(MOBILE_APP_IOS_URL).toBe(
      "https://apps.apple.com/us/app/oneuptime-on-call/id6759615391",
    );
    expect(MOBILE_APP_ANDROID_URL).toBe(
      "https://play.google.com/store/apps/details?id=com.oneuptime.oncall",
    );

    for (const link of [appStore, googlePlay]) {
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
    }
  });

  test("the app is told which OneUptime to connect to: this one's address, drawn as code, as it is typed", async () => {
    devices = [CHROME()];

    render(<PushMethods />);

    fireEvent.click(
      await within(await statusOf("Chrome on macOS")).findByTestId(
        "critical-alert-steps-link",
      ),
    );

    const modal: HTMLElement = await screen.findByTestId("modal");
    const address: HTMLElement = within(modal).getByTestId(
      "critical-alert-steps-server-url",
    );

    expect(address.tagName).toBe("CODE");
    expect(address.textContent).toBe(getMobileAppServerUrl());
    expect(address).toHaveAttribute("dir", "ltr");
    // In the second step: after installing, before the switch.
    expect(
      within(modal)
        .getByTestId("critical-alert-steps-list")
        .querySelectorAll("li")[1]!,
    ).toContainElement(address);
    // An address the app can reach: a full origin, with nothing after it.
    const url: URL = new URL(getMobileAppServerUrl());

    expect(url.origin).toBe(getMobileAppServerUrl());
  });

  test("a phone's steps name no address: the phone is signed in already", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openStepsFor("SM-S918B");

    expect(
      within(modal).queryByTestId("critical-alert-steps-server-url"),
    ).toBeNull();
  });

  test("once a phone is listed, the browser's link goes: the phone is where they are turned on", async () => {
    devices = [CHROME(), IPHONE_OFF()];

    render(<PushMethods />);

    await waitFor(async () => {
      expect(
        within(await statusOf("Chrome on macOS")).queryByTestId(
          "critical-alert-steps-link",
        ),
      ).toBeNull();
    });
    expect(await statusOf("Chrome on macOS")).toHaveTextContent(
      "A browser can't ring through silent mode",
    );
  });
});

describe("no devices yet", () => {
  beforeEach(() => {
    devices = [];
  });

  test("the empty card says what the list is for, and offers both ways onto it", async () => {
    render(<PushMethods />);

    expect(await screen.findByText("No devices yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Phones signed in to the OneUptime On-Call app, and browsers you register here, get push notifications for this project.",
      ),
    ).toBeInTheDocument();

    // This browser: the card's own button, repeated - once.
    expect(
      screen.getAllByRole("button", { name: "Register Device" }),
    ).toHaveLength(2);
    // A phone: the app.
    expect(screen.getByTestId("push-devices-empty-get-app")).toHaveTextContent(
      "Get the mobile app",
    );
  });

  test("Get the mobile app opens the steps that get it", async () => {
    render(<PushMethods />);

    fireEvent.click(await screen.findByTestId("push-devices-empty-get-app"));

    const modal: HTMLElement = await screen.findByTestId("modal");

    expect(within(modal).getByTestId("modal-title")).toHaveTextContent(
      "Get the mobile app",
    );
    expect(stepsOf(modal)).toHaveLength(3);
  });

  test("Register Device under the empty card registers this browser, as the card's button does", async () => {
    render(<PushMethods />);

    await screen.findByText("No devices yet");

    const buttons: Array<HTMLElement> = screen.getAllByRole("button", {
      name: "Register Device",
    });

    fireEvent.click(buttons[buttons.length - 1]!);

    expect(await screen.findByTestId("modal")).toHaveTextContent(
      "Register Device for Push Notifications",
    );
  });
});

describe("a test notification says what it did on that device", () => {
  async function sendTestTo(deviceName: string): Promise<HTMLElement> {
    fireEvent.click(
      within(await rowOf(deviceName)).getByRole("button", {
        name: "Test Notification",
      }),
    );

    return await screen.findByTestId("confirm-modal-description");
  }

  test("a phone with critical alerts on: sent as a critical alert, which rings through silence", async () => {
    render(<PushMethods />);

    const description: HTMLElement = await sendTestTo("Pixel 10");

    expect(screen.getByTestId("modal-title")).toHaveTextContent(
      "Test Notification Sent",
    );
    expect(description).toHaveTextContent(
      "Sent to Pixel 10 as a critical alert: it rings even when the phone is on silent or in Do Not Disturb, as an on-call page would.",
    );
  });

  test("a phone with them off: an ordinary push, which a silenced phone keeps quiet", async () => {
    render(<PushMethods />);

    expect(await sendTestTo("iPhone 15 Pro")).toHaveTextContent(
      "Sent to iPhone 15 Pro. It follows the phone's sound settings, so a phone on silent or in Do Not Disturb stays quiet. Turn on critical alerts to have on-call pages ring through.",
    );
  });

  // The dialog's buttons, as its footer draws them, left to right.
  function footerButtons(): Array<string> {
    return Array.from(
      within(screen.getByTestId("modal-footer")).getAllByRole("button"),
    ).map((button: HTMLElement): string => {
      return button.textContent || "";
    });
  }

  test("a phone with them off: the dialog that says to turn them on leads to how, for that phone", async () => {
    render(<PushMethods />);

    await sendTestTo("iPhone 15 Pro");

    expect(footerButtons()).toEqual(["Close", "How to turn on"]);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    // One dialog after the other, never both.
    await waitFor(() => {
      expect(screen.getAllByTestId("modal")).toHaveLength(1);
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Turn on critical alerts",
      );
    });
    expect(
      within(dialog()).getByTestId("critical-alert-steps-device"),
    ).toHaveTextContent("iPhone 15 ProiPhone or iPad");
    expect(stepsOf(dialog())).toEqual([
      "Open OneUptime On-Call on this iPhone or iPad and tap Settings.",
      "Under Notifications, turn on Critical On-Call Alerts.",
      "When iOS asks whether OneUptime On-Call may send critical alerts, tap Allow.",
    ]);
    // Opening the steps sends nothing more than the test itself.
    expect(postMock).toHaveBeenCalledTimes(1);
  });

  test("an Android phone with them off gets Android's steps from its test dialog", async () => {
    render(<PushMethods />);

    await sendTestTo("SM-S918B");

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(stepsOf(dialog())).toHaveLength(4);
    });
    expect(
      within(dialog()).getByTestId("critical-alert-steps-device"),
    ).toHaveTextContent("SM-S918BAndroid phone");
  });

  test("a phone with them off can still just close the dialog, and nothing else opens", async () => {
    render(<PushMethods />);

    await sendTestTo("iPhone 15 Pro");

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });
  });

  test("a phone with them on, or a browser: the dialog only closes", async () => {
    render(<PushMethods />);

    await sendTestTo("Pixel 10");

    expect(footerButtons()).toEqual(["Close"]);

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    await sendTestTo("Chrome on macOS");

    expect(footerButtons()).toEqual(["Close"]);
  });

  test("a browser: shown where the site may show notifications", async () => {
    render(<PushMethods />);

    expect(await sendTestTo("Chrome on macOS")).toHaveTextContent(
      "Sent to Chrome on macOS. If it doesn't appear, check that this site may show notifications in that browser, and that Do Not Disturb or Focus is off on the computer.",
    );
  });

  test("the test goes to the row's own device", async () => {
    render(<PushMethods />);

    await sendTestTo("SM-S918B");

    const urls: Array<string> = postMock.mock.calls.map(
      (call: Array<any>): string => {
        return call[0].url.toString();
      },
    );

    expect(urls).toHaveLength(1);
    expect(urls[0]!.endsWith(`/user-push/${GALAXY_ID}/test-notification`)).toBe(
      true,
    );
  });

  test("the browser just registered: the browser's words, under its new name", async () => {
    devices = [PIXEL_ON()];

    render(<PushMethods />);

    await rowOf("Pixel 10");

    fireEvent.click(screen.getByRole("button", { name: "Register Device" }));

    const registerDialog: HTMLElement = await screen.findByTestId("modal");

    fireEvent.click(
      within(registerDialog).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Browser Registered",
      );
    });

    fireEvent.click(
      within(screen.getByTestId("modal")).getByRole("button", {
        name: "Send Test Notification",
      }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("modal-title")).toHaveTextContent(
        "Test Notification Sent",
      );
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Sent to Chrome on Windows. If it doesn't appear, check that this site may show notifications in that browser, and that Do Not Disturb or Focus is off on the computer.",
    );
  });
});

/*
 * The maintainer's report: the phone had critical alerts off, the list
 * still said On, and the test's dialog said "Sent to iPhone 14 Pro Max as a
 * critical alert: it rings even when the phone is on silent". The dialog
 * worded the list as it was read. The server now says how the test went
 * (isCriticalAlert), the dialog words that, and when it differs from the
 * row the list is read again, so the row says the same.
 */
describe("a test notification says what the server sent, not what the list showed", () => {
  // What the server answers about each device's test, by device id.
  let answers: Map<string, boolean>;

  beforeEach(() => {
    answers = new Map<string, boolean>();

    postMock.mockImplementation(async (request: any): Promise<unknown> => {
      const url: string = request.url.toString();

      for (const [deviceId, isCriticalAlert] of answers) {
        if (url.endsWith(`/user-push/${deviceId}/test-notification`)) {
          return new HTTPResponse<JSONObject>(
            200,
            {
              success: true,
              message: "Test notification sent successfully",
              isCriticalAlert: isCriticalAlert,
            },
            {},
          );
        }
      }

      if (url.endsWith("/test-notification")) {
        // A server from before the answer said how the test went.
        return new HTTPResponse<JSONObject>(
          200,
          { success: true, message: "Test notification sent successfully" },
          {},
        );
      }

      throw new Error(`Unexpected POST ${url}`);
    });
  });

  async function sendTestTo(deviceName: string): Promise<HTMLElement> {
    fireEvent.click(
      within(await rowOf(deviceName)).getByRole("button", {
        name: "Test Notification",
      }),
    );

    return await screen.findByTestId("confirm-modal-description");
  }

  function footerButtons(): Array<string> {
    return Array.from(
      within(screen.getByTestId("modal-footer")).getAllByRole("button"),
    ).map((button: HTMLElement): string => {
      return button.textContent || "";
    });
  }

  test("the phone turned them off since the list was read: an ordinary push, how to turn them on, and the row catches up", async () => {
    devices = [PIXEL_ON()];

    render(<PushMethods />);

    expect((await statusOf("Pixel 10")).getAttribute("data-state")).toBe("on");
    const readsBefore: number = deviceListReads().length;

    // The phone's app reported off; the list on screen has not been read since.
    answers.set(PIXEL_ID, false);
    devices = [
      device({
        id: PIXEL_ID,
        name: "Pixel 10",
        type: PushDeviceType.Android,
        isCriticalAlertEnabled: false,
      }),
    ];

    const description: HTMLElement = await sendTestTo("Pixel 10");

    expect(description).toHaveTextContent(
      "Sent to Pixel 10. It follows the phone's sound settings, so a phone on silent or in Do Not Disturb stays quiet. Turn on critical alerts to have on-call pages ring through.",
    );
    expect(description).not.toHaveTextContent("as a critical alert");
    expect(footerButtons()).toEqual(["Close", "How to turn on"]);

    // The list is read again, and the row says Off like the dialog.
    await waitFor(() => {
      expect(deviceListReads().length).toBe(readsBefore + 1);
    });

    fireEvent.click(screen.getByTestId("modal-footer-close-button"));

    await waitFor(async () => {
      expect((await statusOf("Pixel 10")).getAttribute("data-state")).toBe(
        "off",
      );
    });
  });

  test("the phone turned them on since: a critical alert, and the row catches up", async () => {
    devices = [IPHONE_OFF()];

    render(<PushMethods />);

    expect((await statusOf("iPhone 15 Pro")).getAttribute("data-state")).toBe(
      "off",
    );
    const readsBefore: number = deviceListReads().length;

    answers.set(IPHONE_ID, true);
    devices = [
      device({
        id: IPHONE_ID,
        name: "iPhone 15 Pro",
        type: PushDeviceType.iOS,
        isCriticalAlertEnabled: true,
      }),
    ];

    expect(await sendTestTo("iPhone 15 Pro")).toHaveTextContent(
      "Sent to iPhone 15 Pro as a critical alert: it rings even when the phone is on silent or in Do Not Disturb, as an on-call page would.",
    );
    // Nothing to turn on: the dialog only closes.
    expect(footerButtons()).toEqual(["Close"]);

    await waitFor(() => {
      expect(deviceListReads().length).toBe(readsBefore + 1);
    });

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(async () => {
      expect((await statusOf("iPhone 15 Pro")).getAttribute("data-state")).toBe(
        "on",
      );
    });
  });

  test("the answer agrees with the list: the list is not read again", async () => {
    devices = [PIXEL_ON()];
    answers.set(PIXEL_ID, true);

    render(<PushMethods />);

    await rowOf("Pixel 10");
    const readsBefore: number = deviceListReads().length;

    expect(await sendTestTo("Pixel 10")).toHaveTextContent(
      "Sent to Pixel 10 as a critical alert",
    );

    // Give a read that should not happen the time to happen.
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 50);
    });

    expect(deviceListReads().length).toBe(readsBefore);
  });

  test("a server that does not say how the test went: the list decides, as before", async () => {
    devices = [PIXEL_ON(), IPHONE_OFF()];

    render(<PushMethods />);

    expect(await sendTestTo("Pixel 10")).toHaveTextContent(
      "Sent to Pixel 10 as a critical alert",
    );

    fireEvent.click(screen.getByTestId("modal-footer-submit-button"));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    expect(await sendTestTo("iPhone 15 Pro")).toHaveTextContent(
      "Sent to iPhone 15 Pro. It follows the phone's sound settings",
    );
  });

  test("a browser's dialog is a browser's, whatever the answer says", async () => {
    devices = [PIXEL_ON(), CHROME()];
    answers.set(CHROME_ID, true);

    render(<PushMethods />);

    await rowOf("Chrome on macOS");
    const readsBefore: number = deviceListReads().length;

    const description: HTMLElement = await sendTestTo("Chrome on macOS");

    expect(description).toHaveTextContent(
      "Sent to Chrome on macOS. If it doesn't appear, check that this site may show notifications in that browser",
    );
    expect(description).not.toHaveTextContent("critical alert");
    expect(footerButtons()).toEqual(["Close"]);
    expect(deviceListReads().length).toBe(readsBefore);
  });

  test("the column's (i) says the app keeps it up to date", async () => {
    devices = [PIXEL_ON()];

    render(<PushMethods />);

    await rowOf("Pixel 10");

    const header: HTMLElement = screen.getByRole("columnheader", {
      name: "Critical Alerts",
    });

    fireEvent.mouseEnter(
      within(header).getByRole("button", { name: "About Critical Alerts" }),
    );

    expect(
      await screen.findByText(
        "On-call pages to this device override silent mode and Do Not Disturb, except from on-call rules set to Standard. Set in the OneUptime On-Call mobile app, which updates it here each time it's opened. Browsers can't override a device's ringer.",
      ),
    ).toBeInTheDocument();
  });
});
