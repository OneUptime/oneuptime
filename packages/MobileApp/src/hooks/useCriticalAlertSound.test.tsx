import { AppState, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import {
  CHANNEL_WARNING,
  useCriticalAlertSound,
  type CriticalAlertSoundState,
} from "./useCriticalAlertSound";
import * as pushDeviceApi from "../api/pushDevice";
import {
  getCriticalAlertSound,
  getCriticalAlertVolume,
  setCriticalAlertSound,
  setCriticalAlertVolume,
} from "../storage/preferences";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
import { setupNotificationChannels } from "../notifications/setup";
import { FakeAndroidNotificationChannels } from "../__tests__/fakeAndroidNotificationChannels";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

jest.mock("../api/pushDevice", () => {
  const actual: Record<string, unknown> =
    jest.requireActual("../api/pushDevice");

  return {
    ...actual,
    registerPushDevice: jest.fn(),
    unregisterPushDevice: jest.fn(),
    setCriticalAlertsEnabledOnServer: jest.fn(),
    setCriticalAlertPreferencesOnServer: jest.fn(async () => {
      return undefined;
    }),
  };
});

/*
 * The hook behind Settings > Alarm sound. The rule it keeps: the screen shows
 * a sound or volume as chosen only once the server has it - the server is
 * what names the sound in every page - and the phone keeps its own copy (which
 * registration restates) only then. Anything else leaves a screen showing an
 * alarm the pages do not play.
 */

const DEVICE_TOKEN: string = "ExponentPushToken[handset]";

function setPlatform(os: "ios" | "android" | "web"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

function setIsDevice(isDevice: boolean): void {
  (Device as unknown as { isDevice: boolean }).isDevice = isDevice;
}

function serverSpy(): jest.SpyInstance {
  return pushDeviceApi.setCriticalAlertPreferencesOnServer as unknown as jest.SpyInstance;
}

function scheduleSpy(): jest.SpyInstance {
  return Notifications.scheduleNotificationAsync as unknown as jest.SpyInstance;
}

function dismissSpy(): jest.SpyInstance {
  return Notifications.dismissNotificationAsync as unknown as jest.SpyInstance;
}

type Rendered = {
  result: { current: CriticalAlertSoundState };
  unmount: () => Promise<void> | void;
};

async function renderAlarm(): Promise<Rendered> {
  const rendered: Rendered = (await renderHook(() => {
    return useCriticalAlertSound();
  })) as unknown as Rendered;

  await waitFor(() => {
    expect(rendered.result.current.isLoaded).toBe(true);
  });

  return rendered;
}

beforeEach(async () => {
  setPlatform("ios");
  setIsDevice(true);
  await AsyncStorage.clear();
  await AsyncStorage.setItem(PUSH_TOKEN_KEY, DEVICE_TOKEN);
  serverSpy().mockReset();
  serverSpy().mockResolvedValue(undefined as never);
  scheduleSpy().mockReset();
  scheduleSpy().mockResolvedValue("preview-1" as never);
  dismissSpy().mockReset();
  dismissSpy().mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("what the screen starts with", () => {
  test("a phone that never chose: the system sound at full volume", async () => {
    const { result } = await renderAlarm();

    expect(result.current.sound).toBe("default");
    expect(result.current.volume).toBe(100);
    expect(result.current.error).toBe("");
    expect(result.current.isSaving).toBe(false);
    expect(result.current.previewingSound).toBeNull();
  });

  test("the stored choice", async () => {
    await setCriticalAlertSound("rising");
    await setCriticalAlertVolume(50);

    const { result } = await renderAlarm();

    expect(result.current.sound).toBe("rising");
    expect(result.current.volume).toBe(50);
  });

  test("every sound the app bundles, the system sound first", async () => {
    const { result } = await renderAlarm();

    expect(
      result.current.sounds.map((option: { id: string }) => {
        return option.id;
      }),
    ).toEqual([
      "default",
      "klaxon",
      "siren",
      "digital",
      "smoke_alarm",
      "rising",
    ]);
  });

  test("the volume can be chosen on an iPhone, which takes it from the page", async () => {
    const { result } = await renderAlarm();

    expect(result.current.isVolumeAdjustable).toBe(true);
  });

  test("but not on Android, which plays critical pages at the alarm volume", async () => {
    setPlatform("android");
    new FakeAndroidNotificationChannels().install();

    const { result } = await renderAlarm();

    expect(result.current.isVolumeAdjustable).toBe(false);
  });

  test("storage that cannot be read still leaves a usable screen", async () => {
    (AsyncStorage.getItem as unknown as jest.SpyInstance).mockRejectedValueOnce(
      new Error("storage unavailable") as never,
    );

    const { result } = await renderAlarm();

    expect(result.current.sound).toBe("default");
    expect(result.current.volume).toBe(100);
  });
});

describe("choosing a sound", () => {
  test("tells the server, then keeps it on the phone", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(serverSpy()).toHaveBeenCalledTimes(1);
    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      sound: "klaxon",
    });
    expect(result.current.sound).toBe("klaxon");
    expect(result.current.error).toBe("");
    expect(await getCriticalAlertSound()).toBe("klaxon");
  });

  test("never sends the volume with it, so the server keeps the stored one", async () => {
    await setCriticalAlertVolume(25);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("siren");
    });

    expect(serverSpy().mock.calls[0]![0]).not.toHaveProperty("volume");
  });

  test("shows the new sound at once, while the server is still answering", async () => {
    let answer: () => void = (): void => {
      return undefined;
    };
    serverSpy().mockImplementation(() => {
      return new Promise<void>((resolve: () => void): void => {
        answer = resolve;
      });
    });

    const { result } = await renderAlarm();
    let saving: Promise<void> = Promise.resolve();

    await act(async () => {
      saving = result.current.setSound("digital");
    });

    expect(result.current.sound).toBe("digital");
    expect(result.current.isSaving).toBe(true);
    // Not kept on the phone until the server has it.
    expect(await getCriticalAlertSound()).toBe("default");

    await act(async () => {
      answer();
      await saving;
    });

    expect(result.current.isSaving).toBe(false);
    expect(await getCriticalAlertSound()).toBe("digital");
  });

  test("a server that refuses puts the stored sound back, says why, and keeps nothing", async () => {
    await setCriticalAlertSound("siren");
    serverSpy().mockRejectedValue(new Error("network unreachable") as never);

    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(result.current.sound).toBe("siren");
    expect(result.current.error).toBe(
      "Could not change the alarm sound. Check your connection and try again.",
    );
    expect(result.current.isSaving).toBe(false);
    expect(await getCriticalAlertSound()).toBe("siren");
  });

  test("a server too old for the choice says so, in words that point at the server", async () => {
    serverSpy().mockRejectedValue(
      new pushDeviceApi.CriticalAlertPreferencesUnsupportedError() as never,
    );

    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(result.current.sound).toBe("default");
    expect(result.current.error).toBe(
      "This OneUptime server does not support choosing an alarm sound yet. Ask your administrator to update OneUptime.",
    );
  });

  test("a phone not registered for push is told so, and nothing is sent or kept", async () => {
    await AsyncStorage.removeItem(PUSH_TOKEN_KEY);

    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(serverSpy()).not.toHaveBeenCalled();
    expect(result.current.sound).toBe("default");
    expect(result.current.error).toContain("not registered");
    expect(await getCriticalAlertSound()).toBe("default");
  });

  test("choosing the sound already chosen does nothing at all", async () => {
    await setCriticalAlertSound("rising");
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("rising");
    });

    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("a second choice while the first is saving is ignored, so the two cannot race", async () => {
    let answer: () => void = (): void => {
      return undefined;
    };
    serverSpy().mockImplementationOnce(() => {
      return new Promise<void>((resolve: () => void): void => {
        answer = resolve;
      });
    });

    const { result } = await renderAlarm();
    let first: Promise<void> = Promise.resolve();

    await act(async () => {
      first = result.current.setSound("klaxon");
    });

    await act(async () => {
      await result.current.setSound("siren");
    });

    await act(async () => {
      answer();
      await first;
    });

    expect(serverSpy()).toHaveBeenCalledTimes(1);
    expect(result.current.sound).toBe("klaxon");
    expect(await getCriticalAlertSound()).toBe("klaxon");
  });

  test("the next successful choice clears the last failure", async () => {
    serverSpy().mockRejectedValueOnce(new Error("offline") as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(result.current.error).not.toBe("");

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(result.current.error).toBe("");
    expect(result.current.sound).toBe("klaxon");
  });

  test("an unknown sound is treated as the system sound", async () => {
    await setCriticalAlertSound("klaxon");
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("foghorn" as never);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      sound: "default",
    });
  });

  test("on iOS no Android channel is touched", async () => {
    const write: jest.SpyInstance = jest.spyOn(
      Notifications,
      "setNotificationChannelAsync",
    );
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(write).not.toHaveBeenCalled();
    expect(result.current.channelWarning).toBe("");
  });
});

describe("choosing a sound on Android", () => {
  /*
   * Each sound pages on a channel of its own, and that channel has to ring
   * through Do Not Disturb. The screen warns when the chosen one cannot.
   */
  let android: FakeAndroidNotificationChannels;

  beforeEach(async () => {
    setPlatform("android");
    android = new FakeAndroidNotificationChannels();
    android.install();
    await setupNotificationChannels();
  });

  test("with Do Not Disturb access, a new sound's channel is through and there is no warning", async () => {
    android.grantDoNotDisturbAccess();
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("smoke_alarm");
    });

    expect(result.current.channelWarning).toBe("");
    expect(android.stored("oncall_critical_smoke_alarm")?.bypassDnd).toBe(true);
  });

  test("a sound whose channel Android will not let through is kept, with a warning that says what to do", async () => {
    android.userChangesChannel("oncall_critical_klaxon", {
      sound: "content://ringtone",
    });
    android.grantDoNotDisturbAccess();
    const { result } = await renderAlarm();

    expect(result.current.channelWarning).toBe("");

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(result.current.sound).toBe("klaxon");
    expect(result.current.channelWarning).toContain("Do Not Disturb");
  });

  test("switching back to a sound that is through clears the warning", async () => {
    android.userChangesChannel("oncall_critical_klaxon", { bypassDnd: false });
    android.grantDoNotDisturbAccess();
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    expect(result.current.channelWarning).not.toBe("");

    await act(async () => {
      await result.current.setSound("siren");
    });

    expect(result.current.channelWarning).toBe("");
  });

  test("the stored sound is checked when the screen opens", async () => {
    await setCriticalAlertSound("digital");

    const { result } = await renderAlarm();

    // No Do Not Disturb access yet: the digital alarm's channel is not through.
    await waitFor(() => {
      expect(result.current.channelWarning).toContain("Do Not Disturb");
    });
  });

  test("a sound the server refused is not checked, and raises no warning of its own", async () => {
    serverSpy().mockRejectedValue(new Error("offline") as never);
    const { result } = await renderAlarm();
    const writesBefore: number = android.writes.length;

    await act(async () => {
      await result.current.setSound("rising");
    });

    expect(android.writes.length).toBe(writesBefore);
  });

  /*
   * On Android each alarm rings through Do Not Disturb on a channel of its
   * own, so choosing an alarm can change whether critical pages ring through
   * at all. The server - and so the Dashboard's device list and every page -
   * is told when it does, not at the next return to the app.
   */
  test("an alarm whose channel cannot ring through tells the server critical pages will not; one that can tells it they will", async () => {
    const toldCriticalAlerts: jest.SpyInstance =
      pushDeviceApi.setCriticalAlertsEnabledOnServer as unknown as jest.SpyInstance;
    toldCriticalAlerts.mockReset();
    toldCriticalAlerts.mockResolvedValue(undefined as never);

    await AsyncStorage.setItem("oneuptime_critical_alerts_enabled", "true");
    android.userChangesChannel("oncall_critical_klaxon", { bypassDnd: false });
    android.grantDoNotDisturbAccess();

    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("klaxon");
    });

    await waitFor(() => {
      expect(toldCriticalAlerts).toHaveBeenLastCalledWith({
        deviceToken: DEVICE_TOKEN,
        isEnabled: false,
      });
    });

    await act(async () => {
      await result.current.setSound("siren");
    });

    await waitFor(() => {
      expect(toldCriticalAlerts).toHaveBeenLastCalledWith({
        deviceToken: DEVICE_TOKEN,
        isEnabled: true,
      });
    });
  });

  test("a sound the server refused tells it nothing about critical alerts", async () => {
    const toldCriticalAlerts: jest.SpyInstance =
      pushDeviceApi.setCriticalAlertsEnabledOnServer as unknown as jest.SpyInstance;
    toldCriticalAlerts.mockReset();
    serverSpy().mockRejectedValue(new Error("offline") as never);

    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("rising");
    });

    expect(toldCriticalAlerts).not.toHaveBeenCalled();
  });

  /*
   * While the chosen alarm cannot ring through Do Not Disturb, the server
   * is told this phone's critical alerts are off, so pages come as ordinary
   * notifications. The warning used to say pages "would arrive silently",
   * which undersold it and named no way back: it says what happens now, and
   * opens Do Not Disturb access.
   */
  test("the warning says pages come as ordinary notifications meanwhile", async () => {
    await setCriticalAlertSound("digital");

    const { result } = await renderAlarm();

    await waitFor(() => {
      expect(result.current.channelWarning).toBe(CHANNEL_WARNING);
    });
    expect(result.current.channelWarning).toBe(
      "Until it can, on-call pages arrive as ordinary notifications, silent in Do Not Disturb. Allow OneUptime On-Call in Do Not Disturb access, or let this sound's channel override Do Not Disturb in the app's notification settings.",
    );
    expect(result.current.channelWarning).not.toContain(
      "would arrive silently",
    );
    // The banner's button opens Do Not Disturb access: no path to follow.
    expect(result.current.channelWarning).not.toContain(" > ");
  });

  test("its button opens Do Not Disturb access", async () => {
    const intent: jest.SpyInstance = jest
      .spyOn(Linking, "sendIntent")
      .mockResolvedValue(undefined as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.openDoNotDisturbAccess();
    });

    expect(intent).toHaveBeenCalledWith(
      "android.settings.NOTIFICATION_POLICY_ACCESS_SETTINGS",
    );
  });

  test("access granted while away: coming back clears the warning", async () => {
    const addListener: jest.SpyInstance = jest.spyOn(
      AppState,
      "addEventListener",
    );
    await setCriticalAlertSound("digital");

    const { result } = await renderAlarm();

    await waitFor(() => {
      expect(result.current.channelWarning).not.toBe("");
    });

    android.grantDoNotDisturbAccess();

    const handler: ((state: string) => void) | undefined = (
      addListener.mock.calls as Array<Array<unknown>>
    )
      .map((call: Array<unknown>): unknown => {
        return call[1];
      })
      .pop() as ((state: string) => void) | undefined;

    expect(handler).toBeDefined();

    await act(async () => {
      handler!("active");
    });

    await waitFor(() => {
      expect(result.current.channelWarning).toBe("");
    });
  });
});

describe("choosing a volume", () => {
  test("tells the server, then keeps it on the phone", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setVolume(50);
    });

    expect(serverSpy()).toHaveBeenCalledWith({
      deviceToken: DEVICE_TOKEN,
      volume: 50,
    });
    expect(result.current.volume).toBe(50);
    expect(await getCriticalAlertVolume()).toBe(50);
  });

  test("never sends the sound with it", async () => {
    await setCriticalAlertSound("klaxon");
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setVolume(75);
    });

    expect(serverSpy().mock.calls[0]![0]).not.toHaveProperty("sound");
  });

  test("a refusal puts the stored volume back and says so", async () => {
    await setCriticalAlertVolume(75);
    serverSpy().mockRejectedValue(new Error("offline") as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setVolume(25);
    });

    expect(result.current.volume).toBe(75);
    expect(result.current.error).toBe(
      "Could not change the alarm volume. Check your connection and try again.",
    );
    expect(await getCriticalAlertVolume()).toBe(75);
  });

  test("choosing the volume already chosen does nothing", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setVolume(100);
    });

    expect(serverSpy()).not.toHaveBeenCalled();
  });

  test("a sound and a volume chosen one after the other are both kept", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.setSound("siren");
    });
    await act(async () => {
      await result.current.setVolume(25);
    });

    expect(result.current.sound).toBe("siren");
    expect(result.current.volume).toBe(25);
    expect(await getCriticalAlertSound()).toBe("siren");
    expect(await getCriticalAlertVolume()).toBe(25);
  });
});

describe("previewing a sound", () => {
  test("plays it and says which one is playing", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("klaxon");
    });

    expect(scheduleSpy()).toHaveBeenCalledTimes(1);
    expect(result.current.previewingSound).toBe("klaxon");
  });

  test("previewing does not choose: the stored sound and the server are untouched", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("siren");
    });

    expect(result.current.sound).toBe("default");
    expect(serverSpy()).not.toHaveBeenCalled();
    expect(await getCriticalAlertSound()).toBe("default");
  });

  test("stopping takes the preview away", async () => {
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("klaxon");
    });
    await act(async () => {
      await result.current.stopPreview();
    });

    expect(dismissSpy()).toHaveBeenCalledWith("preview-1");
    expect(result.current.previewingSound).toBeNull();
  });

  test("a second preview replaces the first rather than playing over it", async () => {
    scheduleSpy()
      .mockResolvedValueOnce("preview-1" as never)
      .mockResolvedValueOnce("preview-2" as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("klaxon");
    });
    await act(async () => {
      await result.current.preview("siren");
    });

    expect(dismissSpy()).toHaveBeenCalledWith("preview-1");
    expect(dismissSpy()).not.toHaveBeenCalledWith("preview-2");
    expect(result.current.previewingSound).toBe("siren");
  });

  test("ends by itself when the sound does, and takes its notification with it", async () => {
    jest.useFakeTimers();
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("digital");
    });

    expect(result.current.previewingSound).toBe("digital");

    // The digital alarm is 15 seconds long.
    await act(async () => {
      jest.advanceTimersByTime(14000);
    });

    expect(result.current.previewingSound).toBe("digital");
    expect(dismissSpy()).not.toHaveBeenCalled();

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(result.current.previewingSound).toBeNull();
    });
    expect(dismissSpy()).toHaveBeenCalledWith("preview-1");
  });

  test("the rising alarm's preview runs its full 25 seconds", async () => {
    jest.useFakeTimers();
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("rising");
    });
    await act(async () => {
      jest.advanceTimersByTime(24000);
    });

    expect(result.current.previewingSound).toBe("rising");

    await act(async () => {
      jest.advanceTimersByTime(1500);
    });

    await waitFor(() => {
      expect(result.current.previewingSound).toBeNull();
    });
  });

  test("a stopped preview's timer does not end a later one early", async () => {
    jest.useFakeTimers();
    scheduleSpy()
      .mockResolvedValueOnce("preview-1" as never)
      .mockResolvedValueOnce("preview-2" as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("klaxon");
    });
    await act(async () => {
      jest.advanceTimersByTime(10000);
    });
    await act(async () => {
      await result.current.preview("siren");
    });
    // Past the end of the klaxon's 15 seconds, well inside the siren's.
    await act(async () => {
      jest.advanceTimersByTime(8000);
    });

    expect(result.current.previewingSound).toBe("siren");
    expect(dismissSpy()).not.toHaveBeenCalledWith("preview-2");
  });

  test("leaving the screen ends the preview it started", async () => {
    const rendered: Rendered = await renderAlarm();

    await act(async () => {
      await rendered.result.current.preview("smoke_alarm");
    });

    await rendered.unmount();

    await waitFor(() => {
      expect(dismissSpy()).toHaveBeenCalledWith("preview-1");
    });
  });

  test("a preview that cannot play says so and plays nothing", async () => {
    scheduleSpy().mockRejectedValue(new Error("not allowed") as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("klaxon");
    });

    expect(result.current.previewingSound).toBeNull();
    expect(result.current.error).toBe(
      "Could not play the preview. Check that notifications are allowed for this app.",
    );
  });

  test("a preview that plays clears an earlier failure", async () => {
    scheduleSpy().mockRejectedValueOnce(new Error("not allowed") as never);
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("klaxon");
    });
    await act(async () => {
      await result.current.preview("klaxon");
    });

    expect(result.current.error).toBe("");
    expect(result.current.previewingSound).toBe("klaxon");
  });

  test("on Android the preview plays on the sound's own channel", async () => {
    setPlatform("android");
    new FakeAndroidNotificationChannels().install();
    const { result } = await renderAlarm();

    await act(async () => {
      await result.current.preview("siren");
    });

    expect(
      (scheduleSpy().mock.calls[0]![0] as { trigger: unknown }).trigger,
    ).toEqual({ channelId: "oncall_critical_siren" });
  });
});
