import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * REGISTERING THIS BROWSER FOR PUSH, ONE WAY (#7149): Notification
 * Methods' Register Device and the on-call guided setup's "Use this
 * browser" both go through registerThisBrowserForPush. These hold it to
 * the browser's order - the permission prompt first, from the click, then
 * OneUptime's service worker, the subscription and the server - and to
 * saying plainly what stopped it: a server without push keys is refused
 * before anything is asked, and a refusal is said in the server's words.
 */

const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: { message?: string } | undefined) => {
        return error?.message || "Something went wrong";
      },
    },
  };
});

const VAPID_KEY: string =
  "BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U";
let vapidKey: string = VAPID_KEY;

// A getter laid over the real module lets each test say whether the server has push keys.
jest.mock("../../../UI/Config", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../UI/Config") as Record<string, unknown>),
  };

  Object.defineProperty(mocked, "VAPID_PUBLIC_KEY", {
    get: (): string => {
      return vapidKey;
    },
  });

  return mocked;
});

import {
  RegisteredBrowser,
  getProblemBeforeAsking,
  registerThisBrowserForPush,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/RegisterThisBrowser";
import {
  BrowserPushError,
  BrowserPushProblem,
  getThisBrowserDeviceId,
} from "../../../../App/FeatureSet/Dashboard/src/Components/NotificationMethods/BrowserPushRegistration";
import OnCallSetupApi from "../../../../App/FeatureSet/Dashboard/src/Components/GuidedSetup/OnCall/OnCallSetupApi";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import PushDeviceType from "../../../Types/PushNotification/PushDeviceType";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "7f000000-0000-4000-8000-0000000007a9";
const DEVICE_ID: string = "7f000000-0000-4000-8000-0000000007b1";
const WINDOWS_CHROME: string =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36";

const SUBSCRIPTION_JSON: JSONObject = {
  endpoint: "https://fcm.googleapis.com/fcm/send/this-browser",
  expirationTime: null,
  keys: { p256dh: "BNcR", auth: "tBHI" },
};

// The order the browser was asked things in.
let asked: Array<string>;
let promptAnswer: NotificationPermission;

function defineOn(target: unknown, name: string, value: unknown): void {
  Object.defineProperty(target, name, {
    value: value,
    configurable: true,
    writable: true,
  });
}

// A browser that can do push: a secure page, service workers, the Push API.
function standInForTheBrowser(): void {
  const registration: Record<string, unknown> = {
    scope: "http://localhost/dashboard/",
    installing: null,
    waiting: null,
    active: {
      scriptURL: "http://localhost/dashboard/sw.js",
      state: "activated",
      postMessage: (): void => {
        asked.push("tell the worker the server's key");
      },
    },
    pushManager: {
      getSubscription: async (): Promise<null> => {
        return null;
      },
      subscribe: async (): Promise<unknown> => {
        asked.push("subscribe");
        return {
          endpoint: SUBSCRIPTION_JSON["endpoint"],
          options: { applicationServerKey: null },
          toJSON: (): JSONObject => {
            return SUBSCRIPTION_JSON;
          },
        };
      },
    },
  };

  defineOn(window, "isSecureContext", true);
  defineOn(window, "PushManager", (): void => {});
  defineOn(window, "Notification", {
    permission: "default",
    requestPermission: async (): Promise<NotificationPermission> => {
      asked.push("permission");
      return promptAnswer;
    },
  });
  defineOn(window.navigator, "userAgent", WINDOWS_CHROME);
  defineOn(window.navigator, "serviceWorker", {
    getRegistration: async (): Promise<undefined> => {
      return undefined;
    },
    register: async (): Promise<unknown> => {
      asked.push("install the worker");
      return registration;
    },
  });
}

function registered(): HTTPResponse<JSONObject> {
  asked.push("register with the server");
  return new HTTPResponse<JSONObject>(
    200,
    { deviceId: DEVICE_ID, alreadyRegistered: false, isVerified: true },
    {},
  );
}

beforeEach(() => {
  asked = [];
  promptAnswer = "granted";
  vapidKey = VAPID_KEY;
  localStorage.clear();
  standInForTheBrowser();
  postMock.mockReset();
  postMock.mockImplementation(async (): Promise<unknown> => {
    return registered();
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("registering this browser for push (#7149)", () => {
  test("asks the person first, then installs the worker, subscribes and tells the server", async () => {
    const result: RegisteredBrowser = await registerThisBrowserForPush({
      projectId: PROJECT_ID,
      deviceName: "Chrome on Windows",
    });

    expect(result).toEqual({ deviceId: DEVICE_ID, alreadyRegistered: false });
    expect(asked).toEqual([
      "permission",
      "install the worker",
      "subscribe",
      "register with the server",
      "tell the worker the server's key",
    ]);

    const request: { url: unknown; data: JSONObject } = postMock.mock
      .calls[0]![0] as { url: unknown; data: JSONObject };

    expect(String(request.url)).toContain("/user-push/register");
    expect(request.data).toEqual({
      projectId: PROJECT_ID,
      deviceToken: JSON.stringify(SUBSCRIPTION_JSON),
      deviceType: PushDeviceType.Web,
      deviceName: "Chrome on Windows",
    });
    // The device table can say which row is this browser.
    expect(getThisBrowserDeviceId(PROJECT_ID)).toBe(DEVICE_ID);
  });

  test("a server without push keys is refused before anything is asked of the person", async () => {
    vapidKey = "";

    expect(getProblemBeforeAsking()).toBe(BrowserPushProblem.NotConfigured);
    await expect(
      registerThisBrowserForPush({
        projectId: PROJECT_ID,
        deviceName: "Chrome on Windows",
      }),
    ).rejects.toEqual(new BrowserPushError(BrowserPushProblem.NotConfigured));
    expect(asked).toEqual([]);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a prompt the person blocks says so, and nothing is registered", async () => {
    promptAnswer = "denied";

    await expect(
      registerThisBrowserForPush({
        projectId: PROJECT_ID,
        deviceName: "Chrome on Windows",
      }),
    ).rejects.toEqual(
      new BrowserPushError(BrowserPushProblem.PermissionBlocked),
    );
    expect(asked).toEqual(["permission"]);
    expect(postMock).not.toHaveBeenCalled();
  });

  test("a register the server refuses is said in its words", async () => {
    postMock.mockImplementation(async (): Promise<unknown> => {
      return new HTTPErrorResponse(
        400,
        { message: "Push notifications are turned off on this server." },
        {},
      );
    });

    await expect(
      registerThisBrowserForPush({
        projectId: PROJECT_ID,
        deviceName: "Chrome on Windows",
      }),
    ).rejects.toThrow("Push notifications are turned off on this server.");
  });

  test("the on-call guided setup registers it in the current project, named as Register Device names it", async () => {
    jest
      .spyOn(ProjectUtil, "getCurrentProjectId")
      .mockReturnValue(new ObjectID(PROJECT_ID));

    expect(OnCallSetupApi.getBrowserPushProblem()).toBeNull();

    await OnCallSetupApi.registerThisBrowser();

    expect((postMock.mock.calls[0]![0] as { data: JSONObject }).data).toEqual(
      expect.objectContaining({
        projectId: PROJECT_ID,
        deviceName: "Chrome on Windows",
      }),
    );
  });
});
