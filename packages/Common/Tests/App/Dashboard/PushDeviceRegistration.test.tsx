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
 * User Settings > Notification Methods > Push Notifications > Register
 * Device, the component as the Dashboard renders it, with the browser's push
 * machinery stood in for.
 *
 * A customer allowed notifications, watched the page refresh and found no
 * new device; after a hard refresh, Register Device said "Project ID is
 * invalid". The page refresh lives in index.ejs
 * (ServiceWorkerTakeoverReload.test.ts) and the refusal on the server
 * (UserPushRegistration.test.ts). This covers the dialog: what it sends,
 * what it says when the browser cannot be registered, and what it offers
 * once it is.
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
  BROWSER_PUSH_PROBLEM_MESSAGES,
  BrowserPushProblem,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import UserPush from "../../../Models/DatabaseModels/UserPush";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";

const USER_ID: string = "7f000000-0000-4000-8000-0000000000a1";
const PROJECT_ID: string = "7f000000-0000-4000-8000-0000000000b1";
const NEW_DEVICE_ID: string = "7f000000-0000-4000-8000-0000000000c1";
const PHONE_DEVICE_ID: string = "7f000000-0000-4000-8000-0000000000c2";

const WINDOWS_CHROME: string =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const SUBSCRIPTION_JSON: JSONObject = {
  endpoint: "https://fcm.googleapis.com/fcm/send/this-browser",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
};

interface BrowserStandIn {
  permission: NotificationPermission;
  promptAnswer: NotificationPermission;
  requestPermission: jest.Mock;
  register: jest.Mock;
  subscribe: jest.Mock;
}

let browser: BrowserStandIn;
let devices: Array<UserPush>;

function device(id: string, name: string): UserPush {
  const model: UserPush = new UserPush();
  model.id = new ObjectID(id);
  model.deviceName = name;
  model.isCriticalAlertEnabled = false;
  return model;
}

function defineOn(target: unknown, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value: value,
    configurable: true,
    writable: true,
  });
}

/*
 * A browser that can do push: a secure page, service workers, the Push API
 * and notifications, with OneUptime's worker installing on request.
 */
function standInForTheBrowser(): BrowserStandIn {
  const subscription: Record<string, unknown> = {
    endpoint: SUBSCRIPTION_JSON["endpoint"],
    options: { applicationServerKey: null },
    toJSON: (): JSONObject => {
      return SUBSCRIPTION_JSON;
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

  const standIn: BrowserStandIn = {
    permission: "default",
    promptAnswer: "granted",
    requestPermission: jest.fn(async (): Promise<NotificationPermission> => {
      standIn.permission = standIn.promptAnswer;
      return standIn.promptAnswer;
    }),
    register: jest.fn(async (): Promise<unknown> => {
      return registration;
    }),
    subscribe: (registration["pushManager"] as { subscribe: jest.Mock })
      .subscribe,
  };

  defineOn(window, "isSecureContext", true);
  defineOn(window, "PushManager", (): void => {});
  defineOn(window, "Notification", {
    get permission(): NotificationPermission {
      return standIn.permission;
    },
    requestPermission: standIn.requestPermission,
  });
  defineOn(window.navigator, "userAgent", WINDOWS_CHROME);
  defineOn(window.navigator, "serviceWorker", {
    getRegistration: async (): Promise<undefined> => {
      return undefined;
    },
    register: standIn.register,
  });

  return standIn;
}

// Signed in, with the permission every user holds over their own devices.
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

function answerPosts(answers: {
  register?: () => HTTPResponse<JSONObject>;
  testNotification?: () => HTTPResponse<JSONObject>;
}): void {
  postMock.mockImplementation(async (request: any): Promise<unknown> => {
    const url: string = request.url.toString();

    if (url.endsWith("/user-push/register")) {
      return (
        answers.register ||
        ((): HTTPResponse<JSONObject> => {
          devices.push(device(NEW_DEVICE_ID, request.data.deviceName));
          return new HTTPResponse<JSONObject>(
            200,
            {
              success: true,
              deviceId: NEW_DEVICE_ID,
              alreadyRegistered: false,
            },
            {},
          );
        })
      )();
    }

    if (url.endsWith("/test-notification")) {
      return (
        answers.testNotification ||
        ((): HTTPResponse<JSONObject> => {
          return new HTTPResponse<JSONObject>(
            200,
            { success: true, message: "Test notification sent successfully" },
            {},
          );
        })
      )();
    }

    throw new Error(`Unexpected POST ${url}`);
  });
}

function registerCalls(): Array<any> {
  return postMock.mock.calls
    .map((call: Array<any>) => {
      return call[0];
    })
    .filter((request: any) => {
      return request.url.toString().endsWith("/user-push/register");
    });
}

function testNotificationUrls(): Array<string> {
  return postMock.mock.calls
    .map((call: Array<any>) => {
      return call[0].url.toString();
    })
    .filter((url: string) => {
      return url.endsWith("/test-notification");
    });
}

async function openRegisterDialog(): Promise<HTMLElement> {
  await waitFor(() => {
    expect(getListMock).toHaveBeenCalled();
  });

  fireEvent.click(screen.getByRole("button", { name: "Register Device" }));

  return await screen.findByTestId("modal");
}

function modalTitle(): string {
  return screen.getByTestId("modal-title").textContent || "";
}

beforeEach(() => {
  devices = [device(PHONE_DEVICE_ID, "iPhone 14 Pro Max")];
  browser = standInForTheBrowser();
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
  answerPosts({});
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

describe("registering this browser", () => {
  test("names it after the browser and its system, not navigator.platform", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    expect(within(modal).getByRole("textbox")).toHaveValue("Chrome on Windows");
  });

  test("sends the project as a plain id - not the { _type, value } the server refused - and lists the new device as this browser", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(modalTitle()).toBe("Browser Registered");
    });

    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).toHaveBeenCalledWith("/dashboard/sw.js");

    const calls: Array<any> = registerCalls();

    expect(calls).toHaveLength(1);

    const sent: JSONObject = JSON.parse(JSON.stringify(calls[0].data));

    expect(sent).toEqual({
      projectId: PROJECT_ID,
      deviceToken: JSON.stringify(SUBSCRIPTION_JSON),
      deviceType: "web",
      deviceName: "Chrome on Windows",
    });

    // The table is read again, and the new row says it is this browser.
    await waitFor(() => {
      expect(screen.getByText("Chrome on Windows")).toBeInTheDocument();
    });

    const thisBrowserRow: HTMLElement = screen
      .getByText("Chrome on Windows")
      .closest("tr") as HTMLElement;

    expect(within(thisBrowserRow).getByText("This browser")).toBeVisible();

    const phoneRow: HTMLElement = screen
      .getByText("iPhone 14 Pro Max")
      .closest("tr") as HTMLElement;

    expect(within(phoneRow).queryByText("This browser")).toBeNull();
  });

  test("keeps the name typed into the dialog", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.change(within(modal).getByRole("textbox"), {
      target: { value: "  Work laptop  " },
    });
    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(registerCalls()).toHaveLength(1);
    });

    expect(registerCalls()[0].data.deviceName).toBe("Work laptop");
  });

  test("offers a test notification to the browser it just registered", async () => {
    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(modalTitle()).toBe("Browser Registered");
    });

    fireEvent.click(
      within(screen.getByTestId("modal")).getByRole("button", {
        name: "Send Test Notification",
      }),
    );

    await waitFor(() => {
      expect(modalTitle()).toBe("Test Notification Sent Successfully");
    });

    expect(testNotificationUrls()).toEqual([
      expect.stringMatching(
        new RegExp(`/user-push/${NEW_DEVICE_ID}/test-notification$`),
      ),
    ]);
  });

  test("a test notification that cannot be sent says why, and the dialog stays open", async () => {
    answerPosts({
      testNotification: (): HTTPResponse<JSONObject> => {
        return new HTTPErrorResponse(
          400,
          {
            message:
              "Failed to send test notification: Web push notifications not configured",
          },
          {},
        );
      },
    });

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(modalTitle()).toBe("Browser Registered");
    });

    fireEvent.click(
      within(screen.getByTestId("modal")).getByRole("button", {
        name: "Send Test Notification",
      }),
    );

    expect(
      await screen.findByText(
        "Failed to send test notification: Web push notifications not configured",
      ),
    ).toBeInTheDocument();
    expect(modalTitle()).toBe("Browser Registered");
  });

  test("a browser that is already registered is told so, with the test on offer, rather than shown an error", async () => {
    devices.push(device(NEW_DEVICE_ID, "Chrome on Windows"));

    answerPosts({
      register: (): HTTPResponse<JSONObject> => {
        return new HTTPResponse<JSONObject>(
          200,
          { success: true, deviceId: NEW_DEVICE_ID, alreadyRegistered: true },
          {},
        );
      },
    });

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(modalTitle()).toBe("This Browser Is Already Registered");
    });

    expect(
      within(screen.getByTestId("modal")).getByRole("button", {
        name: "Send Test Notification",
      }),
    ).toBeVisible();

    await waitFor(() => {
      const thisBrowserRow: HTMLElement = screen
        .getByText("Chrome on Windows")
        .closest("tr") as HTMLElement;

      expect(within(thisBrowserRow).getByText("This browser")).toBeVisible();
    });
  });

  test("a refusal from the server is shown in the dialog, which stays open", async () => {
    answerPosts({
      register: (): HTTPResponse<JSONObject> => {
        return new HTTPErrorResponse(
          400,
          { message: "Project ID is invalid" },
          {},
        );
      },
    });

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    expect(await screen.findByText("Project ID is invalid")).toBeVisible();
    expect(modalTitle()).toBe("Register Device for Push Notifications");
  });
});

describe("when this browser cannot be registered, the dialog says why and what to do", () => {
  test("notifications blocked for the site: the browser says so when asked, and the dialog says how to unblock them", async () => {
    browser.permission = "denied";
    browser.promptAnswer = "denied";

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    // Nothing is claimed before the browser is asked.
    expect(
      within(modal).queryByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionBlocked],
      ),
    ).toBeNull();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    expect(
      await screen.findByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionBlocked],
      ),
    ).toBeVisible();
    expect(browser.requestPermission).toHaveBeenCalledTimes(1);
    expect(browser.register).not.toHaveBeenCalled();
    expect(registerCalls()).toHaveLength(0);
  });

  test("blocked at the prompt", async () => {
    browser.promptAnswer = "denied";

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    expect(
      await screen.findByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionBlocked],
      ),
    ).toBeVisible();
    expect(registerCalls()).toHaveLength(0);
  });

  test("the prompt closed without an answer, and the typed name survives the attempt", async () => {
    browser.promptAnswer = "default";

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.change(within(modal).getByRole("textbox"), {
      target: { value: "Work laptop" },
    });
    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    expect(
      await screen.findByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionDismissed],
      ),
    ).toBeVisible();
    expect(
      await within(screen.getByTestId("modal")).findByRole("textbox"),
    ).toHaveValue("Work laptop");
  });

  test("a page served over plain HTTP", async () => {
    defineOn(window, "isSecureContext", false);
    delete (window.navigator as unknown as Record<string, unknown>)[
      "serviceWorker"
    ];

    render(<PushMethods />);

    await openRegisterDialog();

    expect(
      screen.getByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.InsecureConnection],
      ),
    ).toBeVisible();
  });

  test("Safari on an iPhone, not opened from the Home Screen", async () => {
    defineOn(
      window.navigator,
      "userAgent",
      "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1",
    );
    delete (window as unknown as Record<string, unknown>)["PushManager"];
    delete (window as unknown as Record<string, unknown>)["Notification"];

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    expect(
      screen.getByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.NeedsHomeScreen],
      ),
    ).toBeVisible();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await waitFor(() => {
      expect(
        screen.getByText(
          BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.NeedsHomeScreen],
        ),
      ).toBeVisible();
    });

    expect(registerCalls()).toHaveLength(0);
  });

  test("a push service that refuses, as Chrome does in an incognito window", async () => {
    browser.subscribe.mockImplementation(async (): Promise<unknown> => {
      const error: Error = new Error("Registration failed - permission denied");
      error.name = "AbortError";
      throw error;
    });

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    expect(
      await screen.findByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[
          BrowserPushProblem.PushServiceUnavailable
        ],
      ),
    ).toBeVisible();
    expect(registerCalls()).toHaveLength(0);
  });

  test("a service worker that cannot be installed", async () => {
    browser.register.mockImplementation(async (): Promise<unknown> => {
      throw new TypeError(
        "Failed to register a ServiceWorker: A bad HTTP response code (404) was received when fetching the script.",
      );
    });

    render(<PushMethods />);

    const modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    expect(
      await screen.findByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.ServiceWorkerFailed],
      ),
    ).toBeVisible();
  });

  test("closing the dialog and opening it again starts clean", async () => {
    browser.promptAnswer = "default";

    render(<PushMethods />);

    let modal: HTMLElement = await openRegisterDialog();

    fireEvent.click(
      within(modal).getByRole("button", { name: "Register Device" }),
    );

    await screen.findByText(
      BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionDismissed],
    );

    fireEvent.click(within(modal).getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByTestId("modal")).toBeNull();
    });

    modal = await openRegisterDialog();

    expect(
      within(modal).queryByText(
        BROWSER_PUSH_PROBLEM_MESSAGES[BrowserPushProblem.PermissionDismissed],
      ),
    ).toBeNull();
  });
});

test("a row's Test Notification still sends a test to that device", async () => {
  render(<PushMethods />);

  await waitFor(() => {
    expect(screen.getByText("iPhone 14 Pro Max")).toBeInTheDocument();
  });

  const phoneRow: HTMLElement = screen
    .getByText("iPhone 14 Pro Max")
    .closest("tr") as HTMLElement;

  fireEvent.click(
    within(phoneRow).getByRole("button", { name: "Test Notification" }),
  );

  await waitFor(() => {
    expect(modalTitle()).toBe("Test Notification Sent Successfully");
  });

  expect(testNotificationUrls()).toEqual([
    expect.stringMatching(
      new RegExp(`/user-push/${PHONE_DEVICE_ID}/test-notification$`),
    ),
  ]);

  // The body names the project as a plain id, as every user-push call does.
  expect(JSON.parse(JSON.stringify(postMock.mock.calls[0]![0].data))).toEqual({
    projectId: PROJECT_ID,
  });
});
