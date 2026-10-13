import * as Notifications from "expo-notifications";
import { Platform } from "react-native";
import {
  PREVIEW_DATA_KEY,
  previewCriticalAlertSound,
  stopCriticalAlertSoundPreview,
} from "./criticalAlertSoundPreview";
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  type CriticalAlertSoundIdValue,
  type CriticalAlertSoundOption,
} from "./criticalAlertSounds";
import logger from "../utils/logger";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * A preview is a notification, played the way a page is played, so that what
 * the responder hears when choosing is what a page will sound like - on
 * Android, through the very channel a page arrives on.
 */

function setPlatform(os: "ios" | "android"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function scheduleSpy(): jest.SpyInstance {
  return Notifications.scheduleNotificationAsync as unknown as jest.SpyInstance;
}

function lastRequest(): Notifications.NotificationRequestInput {
  const calls: Array<Array<unknown>> = scheduleSpy().mock.calls;

  return calls[calls.length - 1]![0] as Notifications.NotificationRequestInput;
}

const SOUNDS: Array<[CriticalAlertSoundIdValue, CriticalAlertSoundOption]> =
  CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
    return [option.id, option] as [
      CriticalAlertSoundIdValue,
      CriticalAlertSoundOption,
    ];
  });

beforeEach(() => {
  scheduleSpy().mockClear();
  scheduleSpy().mockResolvedValue("preview-1" as never);
});

afterEach(() => {
  setPlatform("ios");
});

describe("previewCriticalAlertSound on Android", () => {
  beforeEach(() => {
    setPlatform("android");
  });

  test.each(SOUNDS)(
    "%s plays on its own critical channel, at once",
    async (
      sound: CriticalAlertSoundIdValue,
      option: CriticalAlertSoundOption,
    ) => {
      await previewCriticalAlertSound(sound);

      expect(lastRequest().trigger).toEqual({ channelId: option.channelId });
    },
  );
});

describe("previewCriticalAlertSound on iOS", () => {
  beforeEach(() => {
    setPlatform("ios");
  });

  test.each(SOUNDS)(
    "%s plays its bundled file, at once",
    async (
      sound: CriticalAlertSoundIdValue,
      option: CriticalAlertSoundOption,
    ) => {
      await previewCriticalAlertSound(sound);

      expect(lastRequest().trigger).toBeNull();
      expect(lastRequest().content.sound).toBe(option.fileName ?? "default");
    },
  );

  test("is an ordinary notification, not a critical one - a local notification cannot be", async () => {
    await previewCriticalAlertSound("klaxon");

    expect(lastRequest().content.sound).not.toBe("defaultCritical");
    expect(lastRequest().content.interruptionLevel).toBeUndefined();
  });
});

describe("what the preview says", () => {
  test("names the sound and says it is a preview", async () => {
    await previewCriticalAlertSound("smoke_alarm");

    expect(lastRequest().content.title).toBe(
      "Smoke alarm - alarm sound preview",
    );
    expect(lastRequest().content.body).toContain("critical on-call page");
  });

  test("carries no incident or alert, so tapping it goes nowhere", async () => {
    await previewCriticalAlertSound("siren");

    expect(lastRequest().content.data).toEqual({ [PREVIEW_DATA_KEY]: "siren" });
    expect(lastRequest().content.data).not.toHaveProperty("entityType");
    expect(lastRequest().content.data).not.toHaveProperty("entityId");
  });

  test("an unknown sound previews the system sound rather than nothing", async () => {
    setPlatform("android");

    await previewCriticalAlertSound("foghorn" as CriticalAlertSoundIdValue);

    expect(lastRequest().trigger).toEqual({ channelId: "oncall_critical" });
    expect(lastRequest().content.data).toEqual({
      [PREVIEW_DATA_KEY]: "default",
    });
  });

  test("hands back the notification's id, to stop it with", async () => {
    await expect(previewCriticalAlertSound("rising")).resolves.toBe(
      "preview-1",
    );
  });

  test("a failure to schedule reaches the caller, which says so", async () => {
    scheduleSpy().mockRejectedValue(new Error("not allowed") as never);

    await expect(previewCriticalAlertSound("klaxon")).rejects.toThrow(
      "not allowed",
    );
  });
});

describe("stopCriticalAlertSoundPreview", () => {
  function dismissSpy(): jest.SpyInstance {
    return Notifications.dismissNotificationAsync as unknown as jest.SpyInstance;
  }

  beforeEach(() => {
    dismissSpy().mockClear();
    dismissSpy().mockResolvedValue(undefined as never);
  });

  test("takes the preview's notification away, which stops its sound", async () => {
    await stopCriticalAlertSoundPreview("preview-7");

    expect(dismissSpy()).toHaveBeenCalledWith("preview-7");
  });

  test("a preview already gone is not an error", async () => {
    dismissSpy().mockRejectedValue(new Error("no such notification") as never);
    const warn: jest.SpyInstance = jest.spyOn(logger, "warn");

    await expect(
      stopCriticalAlertSoundPreview("preview-7"),
    ).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
  });
});
