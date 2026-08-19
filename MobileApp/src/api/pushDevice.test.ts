import apiClient from "./client";
import {
  registerPushDevice,
  setCriticalAlertsEnabledOnServer,
  unregisterPushDevice,
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
 * The two requests that carry the responder's critical-alert choice to the
 * server. The server is the authority - it is what stamps the flag onto the
 * push payload - so a request that silently drops the field leaves the phone
 * configured to ring while the server keeps sending ordinary notifications.
 */

function postSpy(): jest.SpyInstance {
  return apiClient.post as unknown as jest.SpyInstance;
}

function lastBody(): Record<string, unknown> {
  const calls: Array<Array<unknown>> = postSpy().mock.calls;

  return calls[calls.length - 1]![1] as Record<string, unknown>;
}

describe("registerPushDevice carries the critical alert opt-in", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { success: true } } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("sends the flag when the responder had it on", async () => {
    /*
     * Every project the responder belongs to gets its own device row, and a
     * row created without this defaults to off. Omitting it here is how a
     * phone silently stops overriding Do Not Disturb for a project the
     * responder joined yesterday.
     */
    await registerPushDevice({
      deviceToken: "ExponentPushToken[abc]",
      projectId: "project-1",
      isCriticalAlertEnabled: true,
    });

    expect(lastBody()["isCriticalAlertEnabled"]).toBe(true);
  });

  test("sends false when the responder has not opted in", async () => {
    await registerPushDevice({
      deviceToken: "ExponentPushToken[abc]",
      projectId: "project-1",
      isCriticalAlertEnabled: false,
    });

    expect(lastBody()["isCriticalAlertEnabled"]).toBe(false);
  });

  test("sends false rather than undefined when the caller omits it", async () => {
    await registerPushDevice({
      deviceToken: "ExponentPushToken[abc]",
      projectId: "project-1",
    });

    expect(lastBody()["isCriticalAlertEnabled"]).toBe(false);
  });

  test("still sends everything registration needed before this feature", async () => {
    await registerPushDevice({
      deviceToken: "ExponentPushToken[abc]",
      projectId: "project-1",
      isCriticalAlertEnabled: true,
    });

    const body: Record<string, unknown> = lastBody();

    expect(body["deviceToken"]).toBe("ExponentPushToken[abc]");
    expect(body["projectId"]).toBe("project-1");
    expect(body["deviceType"]).toBeDefined();
    expect(body["deviceName"]).toBeDefined();
  });

  test('an "already registered" response is still treated as success', async () => {
    postSpy().mockRejectedValue({
      response: {
        status: 400,
        data: { message: "This device is already registered" },
      },
    } as never);

    await expect(
      registerPushDevice({
        deviceToken: "ExponentPushToken[abc]",
        projectId: "project-1",
        isCriticalAlertEnabled: true,
      }),
    ).resolves.toBeUndefined();
  });
});

describe("setCriticalAlertsEnabledOnServer", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { success: true } } as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("posts to the critical alerts route", async () => {
    await setCriticalAlertsEnabledOnServer({
      deviceToken: "ExponentPushToken[abc]",
      isEnabled: true,
    });

    expect(postSpy().mock.calls[0]![0]).toBe("/api/user-push/critical-alerts");
  });

  test("identifies the handset by its push token", async () => {
    /*
     * The token, not a row id: the app holds no row ids, and one phone owns a
     * row per project. The server fans the change out across them.
     */
    await setCriticalAlertsEnabledOnServer({
      deviceToken: "ExponentPushToken[abc]",
      isEnabled: true,
    });

    expect(lastBody()["deviceToken"]).toBe("ExponentPushToken[abc]");
  });

  test("sends the requested state", async () => {
    await setCriticalAlertsEnabledOnServer({
      deviceToken: "ExponentPushToken[abc]",
      isEnabled: true,
    });

    expect(lastBody()["isEnabled"]).toBe(true);
  });

  test("can turn the override off again", async () => {
    await setCriticalAlertsEnabledOnServer({
      deviceToken: "ExponentPushToken[abc]",
      isEnabled: false,
    });

    expect(lastBody()["isEnabled"]).toBe(false);
  });

  test("a failed request is surfaced, not swallowed", async () => {
    /*
     * This is the difference between a switch that means something and one
     * that lies. If the server never heard about it, the responder must not be
     * left looking at an "on" toggle.
     */
    postSpy().mockRejectedValue(new Error("network unreachable") as never);

    await expect(
      setCriticalAlertsEnabledOnServer({
        deviceToken: "ExponentPushToken[abc]",
        isEnabled: true,
      }),
    ).rejects.toThrow("network unreachable");
  });
});

describe("unregisterPushDevice is unaffected", () => {
  beforeEach(() => {
    postSpy().mockClear();
    postSpy().mockResolvedValue({ data: { success: true } } as never);
  });

  test("still posts the token to the unregister route", async () => {
    await unregisterPushDevice("ExponentPushToken[abc]");

    expect(postSpy().mock.calls[0]![0]).toBe("/api/user-push/unregister");
  });

  test("still stays quiet on failure so logout is never blocked", async () => {
    postSpy().mockRejectedValue(new Error("offline") as never);

    await expect(
      unregisterPushDevice("ExponentPushToken[abc]"),
    ).resolves.toBeUndefined();
  });
});
