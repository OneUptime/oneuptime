import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import {
  CriticalAlertAvailability,
  CriticalAlertStatus,
  type CriticalAlertsOffInPhoneSettings,
  getCriticalAlertStatus,
  openCriticalAlertSettings,
  requestCriticalAlertPermission,
} from "../notifications/criticalAlerts";
import {
  CriticalAlertsChoiceOutcome,
  type CriticalAlertsReading,
  readCriticalAlerts,
  reportCriticalAlerts,
  saveCriticalAlertsChoice,
} from "../notifications/criticalAlertsReport";
import { getCriticalAlertSound } from "../storage/preferences";
import type { CriticalAlertSoundIdValue } from "../notifications/criticalAlertSounds";
import logger from "../utils/logger";

export interface CriticalAlertsState {
  // Whether the platform can do this at all (false on simulators and web).
  isSupported: boolean;
  // Whether the OS has actually granted the capability right now.
  isPermissionGranted: boolean;
  /*
   * Whether a critical page rings through on this phone: the responder's
   * choice AND the OS allowing it - what the server is told, too
   * (notifications/criticalAlertsReport.ts).
   */
  isEnabled: boolean;
  isBusy: boolean;
  /*
   * Set when a toggle could not be honoured, cleared by the next successful
   * one. The UI shows it verbatim: every message names the specific thing the
   * responder has to do.
   */
  error: string;
  // What the current state means, in a sentence, for the settings screen.
  statusMessage: string;
  /*
   * Set while the responder has Critical On-Call Alerts on and the phone's
   * own settings turn them off (iOS Settings, Android's Do Not Disturb
   * access): the switch reads off, and this says why, what pages do
   * meanwhile and where to turn them back on. Null otherwise - the switch
   * off by choice, granted, or an OS read that failed.
   */
  offInPhoneSettings: CriticalAlertsOffInPhoneSettings | null;
  // Opens the place offInPhoneSettings names, in the phone's settings.
  openPhoneSettings: () => Promise<void>;
  setEnabled: (enabled: boolean) => Promise<void>;
  refresh: () => Promise<void>;
}

const NO_DEVICE_ERROR: string =
  "This device is not registered for push notifications yet. Open the app while online and try again.";

const SERVER_ERROR: string =
  "Could not save this setting. Check your connection and try again.";

export function useCriticalAlerts(): CriticalAlertsState {
  const [isSupported, setIsSupported] = useState<boolean>(false);
  const [isPermissionGranted, setIsPermissionGranted] =
    useState<boolean>(false);
  const [isEnabled, setIsEnabled] = useState<boolean>(false);
  const [isBusy, setIsBusy] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [statusMessage, setStatusMessage] = useState<string>("");
  const [offInPhoneSettings, setOffInPhoneSettings] =
    useState<CriticalAlertsOffInPhoneSettings | null>(null);

  /*
   * State updates are dropped once the screen is gone. The Android flow leaves
   * the app entirely (system settings) and resolves when the user returns, so
   * a resolution arriving after unmount is the normal case here, not an edge.
   */
  const isMountedRef: React.RefObject<boolean> = useRef<boolean>(true);

  useEffect((): (() => void) => {
    isMountedRef.current = true;
    return (): void => {
      isMountedRef.current = false;
    };
  }, []);

  const applyStatus: (status: CriticalAlertStatus) => void = useCallback(
    (status: CriticalAlertStatus): void => {
      if (!isMountedRef.current) {
        return;
      }

      setIsSupported(
        status.availability !== CriticalAlertAvailability.Unsupported,
      );
      setIsPermissionGranted(
        status.availability === CriticalAlertAvailability.Granted,
      );
      setStatusMessage(status.reason);
    },
    [],
  );

  /*
   * Read the OS and the stored preference and reconcile them, then make sure
   * the server holds the same. Returns the status so callers that care about
   * the transition (the foreground listener below) can act on it; `refresh`
   * is the void-returning wrapper the settings screen sees.
   */
  const syncStatus: () => Promise<CriticalAlertStatus> =
    useCallback(async (): Promise<CriticalAlertStatus> => {
      /*
       * The responder's stored choice and the OS's answer for the alarm they
       * chose (on Android each alarm rings through Do Not Disturb on a
       * channel of its own), read the way the server is told them.
       */
      const reading: CriticalAlertsReading = await readCriticalAlerts();

      applyStatus(reading.status);

      if (isMountedRef.current) {
        /*
         * A permission the responder revoked in system settings wins over the
         * stored preference. Showing the switch as on when the OS will no
         * longer honour it is the one reading that could let somebody sleep
         * through a page believing they were covered.
         */
        setIsEnabled(reading.isEffective);

        /*
         * And the switch says why it reads off: chosen, and turned off by
         * the phone's settings - an answer the OS gave, never a failed read.
         */
        setOffInPhoneSettings(
          reading.isChosen &&
            !reading.isEffective &&
            reading.isCertain &&
            reading.status.availability === CriticalAlertAvailability.Denied &&
            reading.status.offInPhoneSettings
            ? reading.status.offInPhoneSettings
            : null,
        );
      }

      /*
       * The server is told the same, when it does not hold it already: the
       * Dashboard shows it, and pages go out by it. Permission revoked in
       * system settings used to turn the switch off here and nowhere else.
       * Never throws, and the screen does not wait for it.
       */
      void reportCriticalAlerts();

      return reading.status;
    }, [applyStatus]);

  const refresh: () => Promise<void> = useCallback(async (): Promise<void> => {
    await syncStatus();
  }, [syncStatus]);

  useEffect((): void => {
    refresh().catch((refreshError: unknown): void => {
      logger.warn(
        "[CriticalAlerts] Could not load critical alert state:",
        refreshError,
      );
    });
  }, [refresh]);

  /*
   * Android grants Do Not Disturb access on a system screen, so the app is in
   * the background while the decision is made and the only signal that
   * something changed is coming back to the foreground. Re-checking on every
   * foreground also catches a permission revoked days later in iOS Settings.
   */
  useEffect((): (() => void) => {
    const subscription: { remove: () => void } = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus): void => {
        if (nextState !== "active") {
          return;
        }

        syncStatus()
          .then((status: CriticalAlertStatus): void => {
            /*
             * The responder has just come back from the system settings screen
             * this error sent them to. Leaving "you must grant Do Not Disturb
             * access" on screen after they granted it reads as though it did
             * not work.
             */
            if (
              status.availability === CriticalAlertAvailability.Granted &&
              isMountedRef.current
            ) {
              setError("");
            }
          })
          .catch((refreshError: unknown): void => {
            logger.warn(
              "[CriticalAlerts] Could not refresh critical alert state:",
              refreshError,
            );
          });
      },
    );

    return (): void => {
      subscription.remove();
    };
  }, [syncStatus]);

  const setEnabled: (enabled: boolean) => Promise<void> = useCallback(
    async (enabled: boolean): Promise<void> => {
      setIsBusy(true);
      setError("");

      try {
        const sound: CriticalAlertSoundIdValue = await getCriticalAlertSound();

        let status: CriticalAlertStatus = await getCriticalAlertStatus({
          sound: sound,
        });

        if (
          enabled &&
          status.availability === CriticalAlertAvailability.Denied
        ) {
          // Not granted yet: prompt on iOS, open the settings screen on Android.
          status = await requestCriticalAlertPermission({ sound: sound });
        }

        applyStatus(status);

        if (
          enabled &&
          status.availability !== CriticalAlertAvailability.Granted
        ) {
          /*
           * On Android this is the ordinary path, not a failure: the user has
           * been sent to system settings and has not come back yet. The
           * foreground listener re-checks when they do, so the message tells
           * them what to do rather than claiming the setting is broken.
           */
          if (isMountedRef.current) {
            setIsEnabled(false);
            setError(status.reason);
          }
          return;
        }

        /*
         * The server first, and the phone keeps the choice only once the
         * server took it (saveCriticalAlertsChoice). The local copy is what
         * re-registration replays, so persisting an unsaved "on" would keep
         * telling the server something the responder was told had failed.
         */
        const outcome: CriticalAlertsChoiceOutcome =
          await saveCriticalAlertsChoice(enabled);

        if (outcome === CriticalAlertsChoiceOutcome.NotRegistered) {
          /*
           * No device on the server to turn it on for: storing "on" anyway
           * would show a switch backed by nothing.
           */
          if (isMountedRef.current) {
            setIsEnabled(false);
            setError(NO_DEVICE_ERROR);
          }
          return;
        }

        /*
         * Saved, or - turning it off with no device on the server to turn
         * off - kept on the phone, which the registration that makes the
         * device restates. Either way the switch says what is in force, and
         * the phone's settings no longer turn off what was chosen.
         */
        if (isMountedRef.current) {
          setIsEnabled(enabled);
          setOffInPhoneSettings(null);
        }
      } catch (toggleError: unknown) {
        logger.error(
          "[CriticalAlerts] Could not update the critical alert setting:",
          toggleError,
        );

        if (isMountedRef.current) {
          // Leave the switch showing what is actually in force, not what was asked for.
          setIsEnabled(!enabled);
          setError(SERVER_ERROR);
        }

        // Re-read rather than assume; the failure may have been the permission check.
        await refresh().catch((): void => {
          // Already reported above.
        });
      } finally {
        if (isMountedRef.current) {
          setIsBusy(false);
        }
      }
    },
    [applyStatus, refresh],
  );

  /*
   * The phone's settings page that turns critical alerts back on. Coming
   * back to the app reads the phone again (the foreground listener above),
   * so the switch and its explanation follow what was changed there.
   */
  const openPhoneSettings: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      if (offInPhoneSettings) {
        await openCriticalAlertSettings(offInPhoneSettings.place);
      }
    }, [offInPhoneSettings]);

  return {
    // Web has no ringer to override; the toggle is not offered there at all.
    isSupported: isSupported && Platform.OS !== "web",
    isPermissionGranted,
    isEnabled,
    isBusy,
    error,
    statusMessage,
    offInPhoneSettings,
    openPhoneSettings,
    setEnabled,
    refresh,
  };
}
