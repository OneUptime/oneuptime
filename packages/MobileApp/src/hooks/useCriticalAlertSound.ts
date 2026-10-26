import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CRITICAL_ALERT_SOUND_OPTIONS,
  DEFAULT_CRITICAL_ALERT_SOUND,
  DEFAULT_CRITICAL_ALERT_VOLUME,
  getCriticalAlertSoundOption,
  type CriticalAlertSoundIdValue,
  type CriticalAlertSoundOption,
} from "../notifications/criticalAlertSounds";
import {
  previewCriticalAlertSound,
  stopCriticalAlertSoundPreview,
} from "../notifications/criticalAlertSoundPreview";
import {
  CriticalAlertAvailability,
  CriticalAlertStatus,
  getCriticalAlertStatus,
  openAndroidDoNotDisturbAccessSettings,
} from "../notifications/criticalAlerts";
import {
  getCriticalAlertSound,
  getCriticalAlertVolume,
  setCriticalAlertSound as storeCriticalAlertSound,
  setCriticalAlertVolume as storeCriticalAlertVolume,
} from "../storage/preferences";
import {
  CriticalAlertPreferencesUnsupportedError,
  setCriticalAlertPreferencesOnServer,
} from "../api/pushDevice";
import { reportCriticalAlerts } from "../notifications/criticalAlertsReport";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
import logger from "../utils/logger";

export interface CriticalAlertSoundState {
  sounds: ReadonlyArray<CriticalAlertSoundOption>;
  // The alarm this phone's critical pages play, as far as the server knows it.
  sound: CriticalAlertSoundIdValue;
  // How loud, as a percentage. Only an iPhone plays it (isVolumeAdjustable).
  volume: number;
  /*
   * iOS takes a critical alert's volume from the page; Android plays it at
   * the phone's alarm volume, which no page can change.
   */
  isVolumeAdjustable: boolean;
  isLoaded: boolean;
  isSaving: boolean;
  // Why the last change did not stick, for the screen to show as it is.
  error: string;
  /*
   * Android only: set while the chosen sound's channel cannot ring through Do
   * Not Disturb, saying what to do about it.
   */
  channelWarning: string;
  // The sound whose preview is playing, if one is.
  previewingSound: CriticalAlertSoundIdValue | null;
  /*
   * Android only: opens the Do Not Disturb access list the warning names.
   * Coming back to the app checks the chosen sound's channel again.
   */
  openDoNotDisturbAccess: () => Promise<void>;
  setSound: (sound: CriticalAlertSoundIdValue) => Promise<void>;
  setVolume: (volume: number) => Promise<void>;
  preview: (sound: CriticalAlertSoundIdValue) => Promise<void>;
  stopPreview: () => Promise<void>;
}

const NO_DEVICE_ERROR: string =
  "This device is not registered for push notifications yet. Open the app while online and try again.";

const SOUND_SAVE_ERROR: string =
  "Could not change the alarm sound. Check your connection and try again.";

const VOLUME_SAVE_ERROR: string =
  "Could not change the alarm volume. Check your connection and try again.";

const PREVIEW_ERROR: string =
  "Could not play the preview. Check that notifications are allowed for this app.";

/*
 * While the chosen sound's channel cannot ring through Do Not Disturb, the
 * server is told this phone's critical alerts are off (criticalAlertsReport),
 * so pages come as ordinary notifications: said as it is, with where to fix it.
 */
export const CHANNEL_WARNING: string =
  "Critical alerts are off on this phone until it can: on-call pages arrive as ordinary notifications, silent while Do Not Disturb is on. Allow OneUptime On-Call in Settings > Notifications > Do Not Disturb access, or let this sound's channel override Do Not Disturb in the app's notification settings.";

/*
 * The alarm sound and volume for critical pages on this phone, for the screen
 * that chooses them.
 *
 * A change is shown at once and saved to the server, which is what puts the
 * sound in every page; it is kept on the phone only once the server has it,
 * and put back - with the reason - if the server refuses or cannot be
 * reached. The phone's copy is what registration restates.
 */
export function useCriticalAlertSound(): CriticalAlertSoundState {
  const [sound, setSoundState] = useState<CriticalAlertSoundIdValue>(
    DEFAULT_CRITICAL_ALERT_SOUND,
  );
  const [volume, setVolumeState] = useState<number>(
    DEFAULT_CRITICAL_ALERT_VOLUME,
  );
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [channelWarning, setChannelWarning] = useState<string>("");
  const [previewingSound, setPreviewingSound] =
    useState<CriticalAlertSoundIdValue | null>(null);

  const isMountedRef: React.RefObject<boolean> = useRef<boolean>(true);

  // The preview playing now: its notification, and the timer that ends it.
  const previewIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);
  const previewTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Read whenever a change starts, so two quick taps cannot both save.
  const isSavingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * Android pages each sound on a channel of its own, and that channel has to
   * ring through Do Not Disturb. Reading the status writes the critical
   * channels again, which is what lets Android raise a channel's bypass once
   * the access is granted.
   */
  const checkChannel: (chosen: CriticalAlertSoundIdValue) => Promise<void> =
    useCallback(async (chosen: CriticalAlertSoundIdValue): Promise<void> => {
      if (Platform.OS !== "android") {
        return;
      }

      const status: CriticalAlertStatus = await getCriticalAlertStatus({
        sound: chosen,
      });

      if (isMountedRef.current) {
        setChannelWarning(
          status.availability === CriticalAlertAvailability.Granted
            ? ""
            : CHANNEL_WARNING,
        );
      }
    }, []);

  const clearPreview: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (previewTimerRef.current) {
        clearTimeout(previewTimerRef.current);
        previewTimerRef.current = null;
      }

      const identifier: string | null = previewIdRef.current;
      previewIdRef.current = null;

      if (identifier) {
        await stopCriticalAlertSoundPreview(identifier);
      }
    }, []);

  useEffect((): (() => void) => {
    isMountedRef.current = true;

    Promise.all([getCriticalAlertSound(), getCriticalAlertVolume()])
      .then(
        async ([storedSound, storedVolume]: [
          CriticalAlertSoundIdValue,
          number,
        ]): Promise<void> => {
          if (!isMountedRef.current) {
            return;
          }

          setSoundState(storedSound);
          setVolumeState(storedVolume);
          setIsLoaded(true);

          await checkChannel(storedSound);
        },
      )
      .catch((loadError: unknown): void => {
        logger.warn(
          "[CriticalAlerts] Could not load the alarm sound settings:",
          loadError,
        );

        if (isMountedRef.current) {
          setIsLoaded(true);
        }
      });

    return (): void => {
      isMountedRef.current = false;
      // Leaving the screen ends whatever preview it started.
      void clearPreview();
    };
  }, [checkChannel, clearPreview]);

  /*
   * Save one change: shown at once, sent to the server, kept on the phone
   * once the server has it, and put back with the reason if it fails.
   */
  const saveChange: <T>(options: {
    next: T;
    previous: T;
    apply: (value: T) => void;
    send: (deviceToken: string) => Promise<void>;
    store: () => Promise<void>;
    failureMessage: string;
  }) => Promise<boolean> = useCallback(
    async <T>(options: {
      next: T;
      previous: T;
      apply: (value: T) => void;
      send: (deviceToken: string) => Promise<void>;
      store: () => Promise<void>;
      failureMessage: string;
    }): Promise<boolean> => {
      isSavingRef.current = true;
      setIsSaving(true);
      setError("");
      options.apply(options.next);

      try {
        const deviceToken: string | null =
          await AsyncStorage.getItem(PUSH_TOKEN_KEY);

        if (!deviceToken) {
          if (isMountedRef.current) {
            options.apply(options.previous);
            setError(NO_DEVICE_ERROR);
          }
          return false;
        }

        await options.send(deviceToken);

        // Kept only once the server has it: registration restates this copy.
        await options.store();

        return true;
      } catch (saveError: unknown) {
        logger.error(
          "[CriticalAlerts] Could not save the alarm sound settings:",
          saveError,
        );

        if (isMountedRef.current) {
          options.apply(options.previous);
          setError(
            saveError instanceof CriticalAlertPreferencesUnsupportedError
              ? saveError.message
              : options.failureMessage,
          );
        }

        return false;
      } finally {
        isSavingRef.current = false;

        if (isMountedRef.current) {
          setIsSaving(false);
        }
      }
    },
    [],
  );

  const setSound: (next: CriticalAlertSoundIdValue) => Promise<void> =
    useCallback(
      async (next: CriticalAlertSoundIdValue): Promise<void> => {
        const chosen: CriticalAlertSoundIdValue =
          getCriticalAlertSoundOption(next).id;

        if (chosen === sound || isSavingRef.current) {
          return;
        }

        const isSaved: boolean = await saveChange<CriticalAlertSoundIdValue>({
          next: chosen,
          previous: sound,
          apply: setSoundState,
          send: (deviceToken: string): Promise<void> => {
            return setCriticalAlertPreferencesOnServer({
              deviceToken: deviceToken,
              sound: chosen,
            });
          },
          store: (): Promise<void> => {
            return storeCriticalAlertSound(chosen);
          },
          failureMessage: SOUND_SAVE_ERROR,
        });

        if (isSaved) {
          await checkChannel(chosen).catch((checkError: unknown): void => {
            logger.warn(
              "[CriticalAlerts] Could not check the alarm sound's channel:",
              checkError,
            );
          });

          /*
           * On Android each alarm rings through Do Not Disturb on a channel
           * of its own, so a new alarm can change whether a critical page
           * rings through at all: the server is told when it does. Never
           * throws, and the screen does not wait for it.
           */
          void reportCriticalAlerts();
        }
      },
      [checkChannel, saveChange, sound],
    );

  const setVolume: (next: number) => Promise<void> = useCallback(
    async (next: number): Promise<void> => {
      if (next === volume || isSavingRef.current) {
        return;
      }

      await saveChange<number>({
        next: next,
        previous: volume,
        apply: setVolumeState,
        send: (deviceToken: string): Promise<void> => {
          return setCriticalAlertPreferencesOnServer({
            deviceToken: deviceToken,
            volume: next,
          });
        },
        store: (): Promise<void> => {
          return storeCriticalAlertVolume(next);
        },
        failureMessage: VOLUME_SAVE_ERROR,
      });
    },
    [saveChange, volume],
  );

  const stopPreview: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      await clearPreview();

      if (isMountedRef.current) {
        setPreviewingSound(null);
      }
    }, [clearPreview]);

  const preview: (soundToPlay: CriticalAlertSoundIdValue) => Promise<void> =
    useCallback(
      async (soundToPlay: CriticalAlertSoundIdValue): Promise<void> => {
        // One preview at a time: a new one replaces whatever is playing.
        await clearPreview();

        const option: CriticalAlertSoundOption =
          getCriticalAlertSoundOption(soundToPlay);

        try {
          const identifier: string = await previewCriticalAlertSound(option.id);

          if (!isMountedRef.current) {
            await stopCriticalAlertSoundPreview(identifier);
            return;
          }

          previewIdRef.current = identifier;
          setPreviewingSound(option.id);
          setError("");

          // Over when the sound is: the notification goes with it.
          previewTimerRef.current = setTimeout((): void => {
            previewTimerRef.current = null;
            void stopPreview();
          }, option.previewSeconds * 1000);
        } catch (previewError: unknown) {
          logger.warn(
            "[CriticalAlerts] Could not play the alarm sound preview:",
            previewError,
          );

          if (isMountedRef.current) {
            setPreviewingSound(null);
            setError(PREVIEW_ERROR);
          }
        }
      },
      [clearPreview, stopPreview],
    );

  /*
   * Granting Do Not Disturb access happens in the phone's settings, with this
   * app in the background: coming back is the moment to check the channel
   * again, so the warning goes as soon as the alarm can ring through.
   */
  useEffect((): (() => void) => {
    if (Platform.OS !== "android" || !isLoaded) {
      return (): void => {
        // Nothing was listened to.
      };
    }

    const subscription: { remove: () => void } = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus): void => {
        if (nextState !== "active") {
          return;
        }

        checkChannel(sound).catch((checkError: unknown): void => {
          logger.warn(
            "[CriticalAlerts] Could not check the alarm sound's channel:",
            checkError,
          );
        });
      },
    );

    return (): void => {
      subscription.remove();
    };
  }, [checkChannel, isLoaded, sound]);

  const openDoNotDisturbAccess: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      await openAndroidDoNotDisturbAccessSettings();
    }, []);

  return {
    sounds: CRITICAL_ALERT_SOUND_OPTIONS,
    sound,
    volume,
    isVolumeAdjustable: Platform.OS === "ios",
    isLoaded,
    isSaving,
    error,
    channelWarning,
    previewingSound,
    openDoNotDisturbAccess,
    setSound,
    setVolume,
    preview,
    stopPreview,
  };
}
