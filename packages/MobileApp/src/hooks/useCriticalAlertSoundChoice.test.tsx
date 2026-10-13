import AsyncStorage from "@react-native-async-storage/async-storage";
import { act, renderHook, waitFor } from "@testing-library/react-native";
import { useCriticalAlertSoundChoice } from "./useCriticalAlertSoundChoice";
import {
  setCriticalAlertSound,
  setCriticalAlertVolume,
  type CriticalAlertSoundChoice,
} from "../storage/preferences";
import { beforeEach, describe, expect, test } from "@jest/globals";

/*
 * What the Settings row shows under the critical alerts switch: the alarm
 * this phone plays, kept current while the responder changes it on the
 * Alarm sound screen and comes back.
 */

type Rendered = {
  result: { current: CriticalAlertSoundChoice | null };
  unmount: () => Promise<void> | void;
};

async function renderChoice(): Promise<Rendered> {
  return (await renderHook(() => {
    return useCriticalAlertSoundChoice();
  })) as unknown as Rendered;
}

beforeEach(async () => {
  await AsyncStorage.clear();
});

describe("useCriticalAlertSoundChoice", () => {
  test("a phone that never chose shows the system sound at full volume", async () => {
    const { result } = await renderChoice();

    await waitFor(() => {
      expect(result.current).toEqual({ sound: "default", volume: 100 });
    });
  });

  test("shows what is stored", async () => {
    await setCriticalAlertSound("smoke_alarm");
    await setCriticalAlertVolume(50);

    const { result } = await renderChoice();

    await waitFor(() => {
      expect(result.current).toEqual({ sound: "smoke_alarm", volume: 50 });
    });
  });

  test("follows a change made elsewhere, without being shown again", async () => {
    const { result } = await renderChoice();

    await waitFor(() => {
      expect(result.current).not.toBeNull();
    });

    await act(async () => {
      await setCriticalAlertSound("klaxon");
    });

    expect(result.current).toEqual({ sound: "klaxon", volume: 100 });

    await act(async () => {
      await setCriticalAlertVolume(25);
    });

    expect(result.current).toEqual({ sound: "klaxon", volume: 25 });
  });

  test("a change announced while storage is still being read wins over the older stored value", async () => {
    let releaseRead: () => void = (): void => {
      return undefined;
    };
    const getItem: jest.SpyInstance = AsyncStorage.getItem as never;
    const realGetItem: (key: string) => Promise<string | null> =
      getItem.getMockImplementation() as never;

    // Hold the first read (the mount's) until the change has been announced.
    getItem.mockImplementationOnce(async (key: string) => {
      await new Promise<void>((resolve: () => void): void => {
        releaseRead = resolve;
      });
      return realGetItem(key);
    });

    const { result } = await renderChoice();

    await act(async () => {
      await setCriticalAlertSound("siren");
    });

    await act(async () => {
      releaseRead();
    });

    await waitFor(() => {
      expect(result.current).toEqual({ sound: "siren", volume: 100 });
    });
  });

  test("stops listening once unmounted", async () => {
    const rendered: Rendered = await renderChoice();

    await waitFor(() => {
      expect(rendered.result.current).not.toBeNull();
    });

    await rendered.unmount();

    // No state update on an unmounted hook: this would warn if it listened.
    await expect(setCriticalAlertSound("rising")).resolves.toBeUndefined();
    expect(rendered.result.current).toEqual({ sound: "default", volume: 100 });
  });
});
