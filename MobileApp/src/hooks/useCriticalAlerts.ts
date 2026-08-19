import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  CriticalAlertAvailability,
  CriticalAlertStatus,
  getCriticalAlertStatus,
  requestCriticalAlertPermission,
} from "../notifications/criticalAlerts";
import {
  getCriticalAlertsEnabled,
  setCriticalAlertsEnabled as storeCriticalAlertsEnabled,
} from "../storage/preferences";
import { setCriticalAlertsEnabledOnServer } from "../api/pushDevice";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
import logger from "../utils/logger";

export interface CriticalAlertsState {
  // Whether the platform can do this at all (false on simulators and web).
  isSupported: boolean;
  // Whether the OS has actually granted the capability right now.
  isPermissionGranted: boolean;
  // The responder's choice, as far as the server knows it.
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
   * Read the OS and the stored preference and reconcile them. Returns the
   * status so callers that care about the transition (the foreground listener
   * below) can act on it; `refresh` is the void-returning wrapper the settings
   * screen sees.
   */
  const syncStatus: () => Promise<CriticalAlertStatus> =
    useCallback(async (): Promise<CriticalAlertStatus> => {
      const [status, storedPreference]: [CriticalAlertStatus, boolean] =
        await Promise.all([
          getCriticalAlertStatus(),
          getCriticalAlertsEnabled(),
        ]);

      applyStatus(status);

      if (isMountedRef.current) {
        /*
         * A permission the responder revoked in system settings wins over the
         * stored preference. Showing the switch as on when the OS will no
         * longer honour it is the one reading that could let somebody sleep
         * through a page believing they were covered.
         */
        setIsEnabled(
          storedPreference &&
            status.availability === CriticalAlertAvailability.Granted,
        );
      }

      return status;
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
        let status: CriticalAlertStatus = await getCriticalAlertStatus();

        if (
          enabled &&
          status.availability === CriticalAlertAvailability.Denied
        ) {
          // Not granted yet: prompt on iOS, open the settings screen on Android.
          status = await requestCriticalAlertPermission();
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

        const deviceToken: string | null =
          await AsyncStorage.getItem(PUSH_TOKEN_KEY);

        if (!deviceToken) {
          if (isMountedRef.current) {
            setIsEnabled(false);
            setError(NO_DEVICE_ERROR);
          }
          return;
        }

        await setCriticalAlertsEnabledOnServer({
          deviceToken: deviceToken,
          isEnabled: enabled,
        });

        /*
         * Stored only after the server accepted it. The local copy is what
         * re-registration replays, so persisting an unsaved "on" would keep
         * telling the server something the responder was told had failed.
         */
        await storeCriticalAlertsEnabled(enabled);

        if (isMountedRef.current) {
          setIsEnabled(enabled);
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

  return {
    // Web has no ringer to override; the toggle is not offered there at all.
    isSupported: isSupported && Platform.OS !== "web",
    isPermissionGranted,
    isEnabled,
    isBusy,
    error,
    statusMessage,
    setEnabled,
    refresh,
  };
}
