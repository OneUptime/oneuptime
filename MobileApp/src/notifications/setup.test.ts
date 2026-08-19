import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import { setupNotificationChannels } from "./setup";
import { CRITICAL_CHANNEL } from "./channels";
import { describe, expect, test, beforeEach, afterEach } from "@jest/globals";

/*
 * Creating the channels is what makes the server's channel ids mean anything.
 * The server names oncall_critical on every critical page; if the app never
 * created that channel, Android does not error - it delivers the page on a
 * default channel, silently, which is the failure this whole feature exists to
 * prevent.
 */

function setPlatform(os: "ios" | "android"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function createdChannelIds(spy: jest.SpyInstance): Array<string> {
  return spy.mock.calls.map((call: Array<unknown>) => {
    return call[0] as string;
  });
}

describe("setupNotificationChannels", () => {
  let channelSpy: jest.SpyInstance;

  beforeEach(() => {
    channelSpy = jest
      .spyOn(Notifications, "setNotificationChannelAsync")
      .mockResolvedValue(null as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("creates the critical channel on Android", async () => {
    setPlatform("android");

    await setupNotificationChannels();

    expect(createdChannelIds(channelSpy)).toContain("oncall_critical");
  });

  test("creates the critical channel with the Do Not Disturb bypass asked for", async () => {
    /*
     * Android freezes a channel's settings at creation. Passing a watered-down
     * object here would permanently silence critical pages on every handset
     * that installed this build, unfixable by an update.
     */
    setPlatform("android");

    await setupNotificationChannels();

    expect(channelSpy).toHaveBeenCalledWith(
      "oncall_critical",
      CRITICAL_CHANNEL,
    );
  });

  test("creates all four channels", async () => {
    setPlatform("android");

    await setupNotificationChannels();

    expect(createdChannelIds(channelSpy)).toEqual([
      "oncall_critical",
      "oncall_high",
      "oncall_normal",
      "oncall_low",
    ]);
  });

  test("creates nothing on iOS, which has no channels", async () => {
    setPlatform("ios");

    await setupNotificationChannels();

    expect(channelSpy).not.toHaveBeenCalled();
  });

  test("one failing channel does not stop the others being created", async () => {
    /*
     * The channels are independent, and the responder's ordinary pages
     * (oncall_high) matter even if the critical one could not be created.
     * Aborting the loop would take out every channel after the first failure.
     */
    setPlatform("android");

    channelSpy.mockRejectedValueOnce(new Error("channel refused") as never);

    await setupNotificationChannels();

    expect(createdChannelIds(channelSpy)).toEqual([
      "oncall_critical",
      "oncall_high",
      "oncall_normal",
      "oncall_low",
    ]);
  });

  test("a failing channel does not throw out of setup", async () => {
    /*
     * This runs from a useEffect on app launch. An unhandled rejection there
     * is an app-wide crash on start.
     */
    setPlatform("android");

    channelSpy.mockRejectedValue(new Error("channels unavailable") as never);

    await expect(setupNotificationChannels()).resolves.toBeUndefined();
  });

  test("is safe to run again on every launch", async () => {
    setPlatform("android");

    await setupNotificationChannels();
    await setupNotificationChannels();

    expect(channelSpy).toHaveBeenCalledTimes(8);
  });
});
