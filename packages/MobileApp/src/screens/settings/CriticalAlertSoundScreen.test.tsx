import React from "react";
import { Platform } from "react-native";
import {
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react-native";
import CriticalAlertSoundScreen from "./CriticalAlertSoundScreen";
import type { CriticalAlertSoundState } from "../../hooks/useCriticalAlertSound";
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  type CriticalAlertSoundOption,
} from "../../notifications/criticalAlertSounds";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * Settings > Alarm sound, rendered against a stand-in for its hook whose
 * state each test sets (the hook is covered in useCriticalAlertSound.test),
 * so the screen's own decisions can be driven directly: which sound reads as
 * chosen, what a tap does, what is offered on which platform, and that every
 * message the hook raises is actually shown.
 */

const mockAlarmState: { current: CriticalAlertSoundState } = {
  current: {} as CriticalAlertSoundState,
};

jest.mock("../../hooks/useCriticalAlertSound", () => {
  return {
    useCriticalAlertSound: () => {
      return mockAlarmState.current;
    },
  };
});

const mockSelectionFeedback: jest.Mock = jest.fn();

jest.mock("../../hooks/useHaptics", () => {
  return {
    useHaptics: () => {
      return {
        successFeedback: jest.fn(),
        errorFeedback: jest.fn(),
        lightImpact: jest.fn(),
        mediumImpact: jest.fn(),
        selectionFeedback: mockSelectionFeedback,
      };
    },
  };
});

function setPlatform(os: "ios" | "android"): void {
  (Platform as unknown as { OS: string }).OS = os;
}

const ORIGINAL_PLATFORM: string = Platform.OS;

function stateWith(
  overrides: Partial<CriticalAlertSoundState> = {},
): CriticalAlertSoundState {
  return {
    sounds: CRITICAL_ALERT_SOUND_OPTIONS,
    sound: "default",
    volume: 100,
    isVolumeAdjustable: true,
    isLoaded: true,
    isSaving: false,
    error: "",
    channelWarning: "",
    previewingSound: null,
    openDoNotDisturbAccess: jest.fn(async () => {
      return undefined;
    }) as unknown as CriticalAlertSoundState["openDoNotDisturbAccess"],
    setSound: jest.fn(async () => {
      return undefined;
    }) as unknown as CriticalAlertSoundState["setSound"],
    setVolume: jest.fn(async () => {
      return undefined;
    }) as unknown as CriticalAlertSoundState["setVolume"],
    preview: jest.fn(async () => {
      return undefined;
    }) as unknown as CriticalAlertSoundState["preview"],
    stopPreview: jest.fn(async () => {
      return undefined;
    }) as unknown as CriticalAlertSoundState["stopPreview"],
    ...overrides,
  };
}

function isChecked(testID: string): boolean {
  return Boolean(
    (
      screen.getByTestId(testID).props as {
        accessibilityState?: { checked?: boolean };
      }
    ).accessibilityState?.checked,
  );
}

function isDisabled(testID: string): boolean {
  return Boolean(
    (
      screen.getByTestId(testID).props as {
        accessibilityState?: { disabled?: boolean };
      }
    ).accessibilityState?.disabled,
  );
}

async function renderScreen(
  overrides: Partial<CriticalAlertSoundState> = {},
): Promise<CriticalAlertSoundState> {
  const state: CriticalAlertSoundState = stateWith(overrides);
  mockAlarmState.current = state;

  await render(<CriticalAlertSoundScreen />);

  await waitFor(() => {
    expect(screen.getByTestId("critical-alert-sound-list")).toBeTruthy();
  });

  return state;
}

beforeEach(() => {
  mockSelectionFeedback.mockClear();
});

afterEach(() => {
  setPlatform(ORIGINAL_PLATFORM as "ios" | "android");
});

describe("the list of sounds", () => {
  test("offers every sound, each with what it sounds like", async () => {
    await renderScreen();

    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(screen.getByText(option.title)).toBeTruthy();
      expect(screen.getByText(option.description)).toBeTruthy();
      expect(
        screen.getByTestId(`critical-alert-sound-${option.id}-preview`),
      ).toBeTruthy();
    }
  });

  test("explains what the screen is for", async () => {
    await renderScreen();

    expect(screen.getByText("Alarm sound")).toBeTruthy();
    expect(screen.getByText(/will not sleep through/)).toBeTruthy();
  });

  test.each(
    CRITICAL_ALERT_SOUND_OPTIONS.map((option: CriticalAlertSoundOption) => {
      return option.id;
    }),
  )("shows %s as chosen when it is, and only it", async (sound: string) => {
    await renderScreen({ sound: sound as CriticalAlertSoundState["sound"] });

    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(isChecked(`critical-alert-sound-${option.id}-select`)).toBe(
        option.id === sound,
      );
    }
  });

  test("shows nothing as chosen until the stored choice has loaded", async () => {
    /*
     * Before storage answers, "System default" would be a guess - and a
     * flash of the wrong sound as chosen reads as the choice being lost.
     */
    await renderScreen({ isLoaded: false, sound: "default" });

    for (const option of CRITICAL_ALERT_SOUND_OPTIONS) {
      expect(isChecked(`critical-alert-sound-${option.id}-select`)).toBe(false);
    }
  });

  test("each sound is a radio button a screen reader can name", async () => {
    await renderScreen();

    const row: { props: Record<string, unknown> } = screen.getByTestId(
      "critical-alert-sound-klaxon-select",
    ) as unknown as { props: Record<string, unknown> };

    expect(row.props["accessibilityRole"]).toBe("radio");
    expect(row.props["accessibilityLabel"]).toBe("Klaxon");
    expect(row.props["accessibilityHint"]).toBe(
      "A ship's horn, blast after blast.",
    );
  });
});

describe("choosing a sound", () => {
  test("tapping another sound chooses it, with a tap of feedback", async () => {
    const state: CriticalAlertSoundState = await renderScreen();

    fireEvent.press(screen.getByTestId("critical-alert-sound-siren-select"));

    expect(state.setSound).toHaveBeenCalledWith("siren");
    expect(mockSelectionFeedback).toHaveBeenCalledTimes(1);
  });

  test("tapping the chosen sound does nothing", async () => {
    const state: CriticalAlertSoundState = await renderScreen({
      sound: "rising",
    });

    fireEvent.press(screen.getByTestId("critical-alert-sound-rising-select"));

    expect(state.setSound).not.toHaveBeenCalled();
    expect(mockSelectionFeedback).not.toHaveBeenCalled();
  });

  test("the sounds cannot be tapped while a change is being saved", async () => {
    const state: CriticalAlertSoundState = await renderScreen({
      isSaving: true,
    });

    expect(isDisabled("critical-alert-sound-klaxon-select")).toBe(true);

    fireEvent.press(screen.getByTestId("critical-alert-sound-klaxon-select"));

    expect(state.setSound).not.toHaveBeenCalled();
  });

  test("nor before the stored choice has loaded", async () => {
    await renderScreen({ isLoaded: false });

    expect(isDisabled("critical-alert-sound-klaxon-select")).toBe(true);
  });
});

describe("previewing a sound", () => {
  test("the play button previews that sound - and does not choose it", async () => {
    const state: CriticalAlertSoundState = await renderScreen();

    fireEvent.press(screen.getByTestId("critical-alert-sound-klaxon-preview"));

    expect(state.preview).toHaveBeenCalledWith("klaxon");
    expect(state.setSound).not.toHaveBeenCalled();
  });

  test("the playing sound says so, and its button stops it", async () => {
    const state: CriticalAlertSoundState = await renderScreen({
      previewingSound: "smoke_alarm",
    });

    expect(
      screen.getByTestId("critical-alert-sound-smoke_alarm-playing"),
    ).toBeTruthy();
    expect(screen.getByLabelText("Stop Smoke alarm")).toBeTruthy();

    fireEvent.press(
      screen.getByTestId("critical-alert-sound-smoke_alarm-preview"),
    );

    expect(state.stopPreview).toHaveBeenCalledTimes(1);
    expect(state.preview).not.toHaveBeenCalled();
  });

  test("while one sound plays, another's button plays that one instead", async () => {
    const state: CriticalAlertSoundState = await renderScreen({
      previewingSound: "siren",
    });

    expect(screen.getByLabelText("Play Digital alarm")).toBeTruthy();

    fireEvent.press(screen.getByTestId("critical-alert-sound-digital-preview"));

    expect(state.preview).toHaveBeenCalledWith("digital");
    expect(
      screen.queryByTestId("critical-alert-sound-digital-playing"),
    ).toBeNull();
  });

  test("previews stay playable while a change is saving", async () => {
    const state: CriticalAlertSoundState = await renderScreen({
      isSaving: true,
    });

    fireEvent.press(screen.getByTestId("critical-alert-sound-rising-preview"));

    expect(state.preview).toHaveBeenCalledWith("rising");
  });
});

describe("the volume", () => {
  test("on an iPhone, offers the four steps with the chosen one checked", async () => {
    setPlatform("ios");
    await renderScreen({ volume: 75 });

    for (const volume of [25, 50, 75, 100]) {
      expect(screen.getByText(`${volume}%`)).toBeTruthy();
      expect(isChecked(`critical-alert-volume-${volume}`)).toBe(volume === 75);
    }
    expect(
      screen.getByText(
        /even when your iPhone is silenced or in Do Not Disturb/,
      ),
    ).toBeTruthy();
  });

  test("tapping a step chooses it", async () => {
    setPlatform("ios");
    const state: CriticalAlertSoundState = await renderScreen({ volume: 100 });

    fireEvent.press(screen.getByTestId("critical-alert-volume-50"));

    expect(state.setVolume).toHaveBeenCalledWith(50);
    expect(mockSelectionFeedback).toHaveBeenCalledTimes(1);
  });

  test("tapping the chosen step does nothing", async () => {
    setPlatform("ios");
    const state: CriticalAlertSoundState = await renderScreen({ volume: 25 });

    fireEvent.press(screen.getByTestId("critical-alert-volume-25"));

    expect(state.setVolume).not.toHaveBeenCalled();
  });

  test("the steps cannot be tapped while saving", async () => {
    setPlatform("ios");
    await renderScreen({ isSaving: true });

    expect(isDisabled("critical-alert-volume-50")).toBe(true);
  });

  test("on Android there is no volume to choose, and the screen says which volume applies", async () => {
    setPlatform("android");
    await renderScreen({ isVolumeAdjustable: false });

    expect(screen.queryByTestId("critical-alert-volume-picker")).toBeNull();
    expect(screen.getByTestId("critical-alert-volume-android")).toBeTruthy();
    expect(
      screen.getByText(/Critical pages play at your phone's alarm volume/),
    ).toBeTruthy();
  });
});

describe("what the screen tells the responder", () => {
  test("a failed change is shown, word for word", async () => {
    await renderScreen({
      error:
        "This OneUptime server does not support choosing an alarm sound yet. Ask your administrator to update OneUptime.",
    });

    expect(screen.getByTestId("critical-alert-sound-error")).toBeTruthy();
    expect(
      screen.getByText(
        "This OneUptime server does not support choosing an alarm sound yet. Ask your administrator to update OneUptime.",
      ),
    ).toBeTruthy();
  });

  test("a sound Android will not let through Do Not Disturb is called out", async () => {
    setPlatform("android");
    await renderScreen({
      isVolumeAdjustable: false,
      channelWarning: "Allow it in Settings.",
    });

    expect(
      screen.getByTestId("critical-alert-sound-channel-warning"),
    ).toBeTruthy();
    expect(
      screen.getByText("This sound cannot ring through Do Not Disturb"),
    ).toBeTruthy();
    expect(screen.getByText("Allow it in Settings.")).toBeTruthy();
  });

  test("the warning opens Do Not Disturb access, where the alarm is let through", async () => {
    setPlatform("android");
    const openDoNotDisturbAccess: jest.Mock = jest.fn(async () => {
      return undefined;
    });
    await renderScreen({
      isVolumeAdjustable: false,
      channelWarning: "Allow it in Settings.",
      openDoNotDisturbAccess:
        openDoNotDisturbAccess as unknown as CriticalAlertSoundState["openDoNotDisturbAccess"],
    });

    fireEvent.press(
      screen.getByRole("button", { name: "Open Do Not Disturb access" }),
    );

    expect(openDoNotDisturbAccess).toHaveBeenCalledTimes(1);
  });

  test("with nothing wrong, there is neither banner", async () => {
    await renderScreen();

    expect(screen.queryByTestId("critical-alert-sound-error")).toBeNull();
    expect(
      screen.queryByTestId("critical-alert-sound-channel-warning"),
    ).toBeNull();
  });

  test("on an iPhone, the preview's limits are explained", async () => {
    setPlatform("ios");
    await renderScreen();

    expect(
      screen.getByText(/Previews play at your ringer volume/),
    ).toBeTruthy();
  });

  test("on Android, the preview is said to play as a page does", async () => {
    setPlatform("android");
    await renderScreen({ isVolumeAdjustable: false });

    expect(
      screen.getByText(/Previews play exactly as a page does/),
    ).toBeTruthy();
  });
});
