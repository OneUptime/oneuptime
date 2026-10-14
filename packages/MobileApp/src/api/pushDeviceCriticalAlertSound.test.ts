import apiClient from "./client";
import {
  CriticalAlertPreferencesUnsupportedError,
  registerPushDevice,
  setCriticalAlertPreferencesOnServer,
} from "./pushDevice";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

jest.mock("./client", () => {
  return {
    __esModule: true,
    default: {
      post: jest.fn(async () => {
        return { data: { success: true } };
      }),
    },
  };
});

/*
 * The two requests that carry the alarm a critical page plays, and on an
 * iPhone how loud. The server is what names the sound in every page, so a
 * request that drops the choice leaves the screen showing a sound the pages
 * do not play.
 */

const TOKEN: string = "ExponentPushToken[handset]";

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastCall(): { url: string; body: Record<string, unknown> } {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;
  const call: Array<unknown> = calls[calls.length - 1]!;

  return { url: call[0] as string, body: call[1] as Record<string, unknown> };
}

beforeEach(() => {
  postSpy().mockClear();
  postSpy().mockResolvedValue({ data: { success: true } } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("registerPushDevice restates the alarm the phone chose", () => {
  test("sends the sound and the volume when the phone has them", async () => {
    /*
     * A project the responder joins later gets a new device row; without
     * these it would page them with the system sound at full volume.
     */
    await registerPushDevice({
      deviceToken: TOKEN,
      projectId: "project-1",
      isCriticalAlertEnabled: true,
      criticalAlertSound: "klaxon",
      criticalAlertVolume: 75,
    });

    expect(lastCall().body["criticalAlertSound"]).toBe("klaxon");
    expect(lastCall().body["criticalAlertVolume"]).toBe(75);
  });

  test("sends the system sound as a choice like any other", async () => {
    await registerPushDevice({
      deviceToken: TOKEN,
      projectId: "project-1",
      criticalAlertSound: "default",
      criticalAlertVolume: 100,
    });

    expect(lastCall().body["criticalAlertSound"]).toBe("default");
    expect(lastCall().body["criticalAlertVolume"]).toBe(100);
  });

  test("leaves both out when the caller has none, so the server keeps its defaults", async () => {
    await registerPushDevice({
      deviceToken: TOKEN,
      projectId: "project-1",
    });

    expect("criticalAlertSound" in lastCall().body).toBe(false);
    expect("criticalAlertVolume" in lastCall().body).toBe(false);
  });

  test("sends a sound without a volume, and a volume without a sound", async () => {
    await registerPushDevice({
      deviceToken: TOKEN,
      projectId: "project-1",
      criticalAlertSound: "siren",
    });

    expect(lastCall().body["criticalAlertSound"]).toBe("siren");
    expect("criticalAlertVolume" in lastCall().body).toBe(false);

    await registerPushDevice({
      deviceToken: TOKEN,
      projectId: "project-1",
      criticalAlertVolume: 25,
    });

    expect("criticalAlertSound" in lastCall().body).toBe(false);
    expect(lastCall().body["criticalAlertVolume"]).toBe(25);
  });

  test("carries the alarm alongside everything registration sends", async () => {
    await registerPushDevice({
      deviceToken: "ExponentPushToken[new]",
      projectId: "project-1",
      isCriticalAlertEnabled: true,
      criticalAlertSound: "rising",
      criticalAlertVolume: 50,
      previousDeviceToken: "ExponentPushToken[old]",
    });

    expect(Object.keys(lastCall().body).sort()).toEqual(
      [
        "criticalAlertSound",
        "criticalAlertVolume",
        "deviceName",
        "deviceToken",
        "deviceType",
        "isCriticalAlertEnabled",
        "previousDeviceToken",
        "projectId",
      ].sort(),
    );
  });
});

describe("setCriticalAlertPreferencesOnServer", () => {
  test("posts to the preferences route, keyed on the push token", async () => {
    await setCriticalAlertPreferencesOnServer({
      deviceToken: TOKEN,
      sound: "smoke_alarm",
    });

    expect(lastCall().url).toBe("/api/user-push/critical-alert-preferences");
    expect(lastCall().body["deviceToken"]).toBe(TOKEN);
  });

  test("a sound alone leaves the volume out, so the server keeps the stored one", async () => {
    await setCriticalAlertPreferencesOnServer({
      deviceToken: TOKEN,
      sound: "digital",
    });

    expect(lastCall().body).toEqual({ deviceToken: TOKEN, sound: "digital" });
  });

  test("a volume alone leaves the sound out", async () => {
    await setCriticalAlertPreferencesOnServer({
      deviceToken: TOKEN,
      volume: 25,
    });

    expect(lastCall().body).toEqual({ deviceToken: TOKEN, volume: 25 });
  });

  test("sends both together when asked", async () => {
    await setCriticalAlertPreferencesOnServer({
      deviceToken: TOKEN,
      sound: "klaxon",
      volume: 50,
    });

    expect(lastCall().body).toEqual({
      deviceToken: TOKEN,
      sound: "klaxon",
      volume: 50,
    });
  });

  test("a server without the route is told apart from every other failure", async () => {
    /*
     * A self-hosted server older than the choice answers 404. Nothing the
     * responder does on the phone fixes that, so it gets its own message.
     */
    postSpy().mockRejectedValue({
      response: { status: 404, data: { message: "Page not found" } },
    } as never);

    const attempt: Promise<void> = setCriticalAlertPreferencesOnServer({
      deviceToken: TOKEN,
      sound: "klaxon",
    });

    await expect(attempt).rejects.toBeInstanceOf(
      CriticalAlertPreferencesUnsupportedError,
    );
    await expect(attempt).rejects.toThrow(
      "This OneUptime server does not support choosing an alarm sound yet. Ask your administrator to update OneUptime.",
    );
  });

  test.each([400, 401, 403, 500, 502])(
    "any other status (%d) is passed on as it came",
    async (status: number) => {
      const failure: { response: { status: number } } = {
        response: { status },
      };
      postSpy().mockRejectedValue(failure as never);

      await expect(
        setCriticalAlertPreferencesOnServer({ deviceToken: TOKEN, volume: 50 }),
      ).rejects.toBe(failure);
    },
  );

  test("a network failure is passed on, not swallowed", async () => {
    postSpy().mockRejectedValue(new Error("network unreachable") as never);

    await expect(
      setCriticalAlertPreferencesOnServer({
        deviceToken: TOKEN,
        sound: "siren",
      }),
    ).rejects.toThrow("network unreachable");
  });

  test("the unsupported-server error is an Error with a name of its own", () => {
    const error: CriticalAlertPreferencesUnsupportedError =
      new CriticalAlertPreferencesUnsupportedError();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe("CriticalAlertPreferencesUnsupportedError");
  });
});
