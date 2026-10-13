import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  getCriticalAlertSound,
  getCriticalAlertsEnabled,
  getCriticalAlertVolume,
  setCriticalAlertSound,
  setCriticalAlertsEnabled,
  setCriticalAlertVolume,
  subscribeToCriticalAlertSoundChoice,
  type CriticalAlertSoundChoice,
} from "./preferences";
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  type CriticalAlertSoundIdValue,
  type CriticalAlertSoundOption,
} from "../notifications/criticalAlertSounds";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The phone's copy of the alarm a critical page plays, and on an iPhone how
 * loud. Registration replays it to every project, so what it reads back for a
 * phone that never chose - or for a value it does not understand - decides
 * what a new project's pages sound like: it has to be the system sound at
 * full volume, exactly as every critical page played before the choice.
 */

const SOUND_KEY: string = "oneuptime_critical_alert_sound";
const VOLUME_KEY: string = "oneuptime_critical_alert_volume";

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("getCriticalAlertSound", () => {
  test("a phone that never chose plays the system sound", async () => {
    expect(await getCriticalAlertSound()).toBe("default");
  });

  test.each(
    CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
      return option.id;
    }),
  )("round-trips %s", async (sound: CriticalAlertSoundIdValue) => {
    await setCriticalAlertSound(sound);

    expect(await getCriticalAlertSound()).toBe(sound);
  });

  test.each(["foghorn", "KLAXON", " klaxon", "", "null", "0"])(
    "a stored value this build does not offer (%p) reads as the system sound",
    async (stored: string) => {
      /*
       * A newer build may have written a sound this one does not bundle.
       * Naming it would page on a channel this phone does not have.
       */
      await AsyncStorage.setItem(SOUND_KEY, stored);

      expect(await getCriticalAlertSound()).toBe("default");
    },
  );

  test("stores under its own key", async () => {
    await setCriticalAlertSound("smoke_alarm");

    expect(await AsyncStorage.getItem(SOUND_KEY)).toBe("smoke_alarm");
  });
});

describe("getCriticalAlertVolume", () => {
  test("a phone that never chose plays at full volume", async () => {
    expect(await getCriticalAlertVolume()).toBe(100);
  });

  test.each([25, 50, 75, 100])("round-trips %d%%", async (volume: number) => {
    await setCriticalAlertVolume(volume);

    expect(await getCriticalAlertVolume()).toBe(volume);
  });

  test.each(["0", "10", "60", "-25", "250", "loud", "", "NaN", "Infinity"])(
    "a stored value the app does not offer (%p) reads as full volume",
    async (stored: string) => {
      /*
       * Full, never quieter: a volume this build cannot show is not one to
       * guess at, and the loud answer is the one that still wakes somebody.
       */
      await AsyncStorage.setItem(VOLUME_KEY, stored);

      expect(await getCriticalAlertVolume()).toBe(100);
    },
  );

  test("stores the number as text under its own key", async () => {
    await setCriticalAlertVolume(75);

    expect(await AsyncStorage.getItem(VOLUME_KEY)).toBe("75");
  });
});

describe("the alarm choice is independent of the other settings", () => {
  test("changing the sound or volume leaves the critical alerts toggle alone", async () => {
    await setCriticalAlertsEnabled(true);
    await setCriticalAlertSound("siren");
    await setCriticalAlertVolume(25);

    expect(await getCriticalAlertsEnabled()).toBe(true);
  });

  test("turning critical alerts off keeps the chosen alarm for when they are on again", async () => {
    await setCriticalAlertSound("rising");
    await setCriticalAlertVolume(50);
    await setCriticalAlertsEnabled(false);

    expect(await getCriticalAlertSound()).toBe("rising");
    expect(await getCriticalAlertVolume()).toBe(50);
  });
});

describe("subscribeToCriticalAlertSoundChoice", () => {
  let unsubscribers: Array<() => void> = [];

  afterEach(() => {
    for (const unsubscribe of unsubscribers) {
      unsubscribe();
    }
    unsubscribers = [];
  });

  function listen(): Array<CriticalAlertSoundChoice> {
    const heard: Array<CriticalAlertSoundChoice> = [];

    unsubscribers.push(
      subscribeToCriticalAlertSoundChoice(
        (choice: CriticalAlertSoundChoice): void => {
          heard.push(choice);
        },
      ),
    );

    return heard;
  }

  test("hears a new sound, with the volume that goes with it", async () => {
    await setCriticalAlertVolume(75);
    const heard: Array<CriticalAlertSoundChoice> = listen();

    await setCriticalAlertSound("klaxon");

    expect(heard).toEqual([{ sound: "klaxon", volume: 75 }]);
  });

  test("hears a new volume, with the sound that goes with it", async () => {
    await setCriticalAlertSound("digital");
    const heard: Array<CriticalAlertSoundChoice> = listen();

    await setCriticalAlertVolume(25);

    expect(heard).toEqual([{ sound: "digital", volume: 25 }]);
  });

  test("every listener hears every change, in order", async () => {
    const first: Array<CriticalAlertSoundChoice> = listen();
    const second: Array<CriticalAlertSoundChoice> = listen();

    await setCriticalAlertSound("siren");
    await setCriticalAlertVolume(50);

    const expected: Array<CriticalAlertSoundChoice> = [
      { sound: "siren", volume: 100 },
      { sound: "siren", volume: 50 },
    ];

    expect(first).toEqual(expected);
    expect(second).toEqual(expected);
  });

  test("an unsubscribed listener hears nothing more", async () => {
    const heard: Array<CriticalAlertSoundChoice> = [];
    const unsubscribe: () => void = subscribeToCriticalAlertSoundChoice(
      (choice: CriticalAlertSoundChoice): void => {
        heard.push(choice);
      },
    );

    await setCriticalAlertSound("siren");
    unsubscribe();
    await setCriticalAlertSound("klaxon");

    expect(heard).toEqual([{ sound: "siren", volume: 100 }]);
  });

  test("a listener that unsubscribes while being told does not stop the others hearing", async () => {
    const heard: Array<string> = [];
    const unsubscribeFirst: () => void = subscribeToCriticalAlertSoundChoice(
      (): void => {
        heard.push("first");
        unsubscribeFirst();
      },
    );
    unsubscribers.push(
      subscribeToCriticalAlertSoundChoice((): void => {
        heard.push("second");
      }),
    );

    await setCriticalAlertSound("rising");
    await setCriticalAlertSound("klaxon");

    expect(heard).toEqual(["first", "second", "second"]);
  });

  test("with nobody listening, saving reads nothing back", async () => {
    /*
     * Saving is on the path of every change the responder makes; with no
     * screen showing the choice there is nobody to tell, so no extra reads.
     */
    const getItem: jest.SpyInstance = AsyncStorage.getItem as never;
    getItem.mockClear();

    await setCriticalAlertSound("siren");
    await setCriticalAlertVolume(50);

    expect(getItem).not.toHaveBeenCalled();
  });

  test("the toggle's own setting is not announced as an alarm change", async () => {
    const heard: Array<CriticalAlertSoundChoice> = listen();

    await setCriticalAlertsEnabled(true);

    expect(heard).toEqual([]);
  });
});
