import React, { useCallback, useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import { NotificationPermissionState } from "../onboarding/getReady";
import { requestPushRegistration } from "./usePushNotifications";
import logger from "../utils/logger";

/*
 * WHETHER THIS APP MAY SHOW NOTIFICATIONS, as the OS says - the first of
 * the first steps (onboarding/getReady.ts) - read when the screen opens and
 * again whenever the app comes back to the front: the person may have
 * turned them on in the phone's settings meanwhile.
 *
 * allow() asks, when the OS still may: the system prompt. Once the person
 * has refused it, iOS and Android never show it again, so allow() opens
 * this app's page in the phone's settings instead. A phone just allowed
 * registers for pushes at once (requestPushRegistration), so a test page
 * reaches it without restarting the app.
 */

export interface NotificationPermission {
  state: NotificationPermissionState;
  isAsking: boolean;
  allow: () => Promise<void>;
}

type PermissionResponse = Awaited<
  ReturnType<typeof Notifications.getPermissionsAsync>
>;

export function toNotificationPermissionState(
  response: PermissionResponse,
): NotificationPermissionState {
  if (response.status === "granted") {
    return NotificationPermissionState.Granted;
  }

  /*
   * Refused, and the OS will not ask again: only its settings can change
   * it. Android asks a second time after one refusal (canAskAgain).
   */
  if (response.status === "denied" && response.canAskAgain !== true) {
    return NotificationPermissionState.Denied;
  }

  return NotificationPermissionState.NotAsked;
}

const isAvailable: () => boolean = (): boolean => {
  return (
    Device.isDevice && (Platform.OS === "ios" || Platform.OS === "android")
  );
};

export function useNotificationPermission(): NotificationPermission {
  const [state, setState] = useState<NotificationPermissionState>(
    isAvailable()
      ? NotificationPermissionState.Checking
      : NotificationPermissionState.Unavailable,
  );
  const [isAsking, setIsAsking] = useState<boolean>(false);
  const isMounted: React.MutableRefObject<boolean> = useRef<boolean>(true);

  useEffect((): (() => void) => {
    isMounted.current = true;

    return (): void => {
      isMounted.current = false;
    };
  }, []);

  const read: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!isAvailable()) {
      return;
    }

    try {
      const response: PermissionResponse =
        await Notifications.getPermissionsAsync();

      if (isMounted.current) {
        setState(toNotificationPermissionState(response));
      }
    } catch (error: unknown) {
      logger.warn("[GetReady] Could not read notification permission:", error);

      // Unknown: the button still asks, which reads it again.
      if (isMounted.current) {
        setState(NotificationPermissionState.NotAsked);
      }
    }
  }, []);

  useEffect((): (() => void) => {
    void read();

    const subscription: { remove: () => void } = AppState.addEventListener(
      "change",
      (next: AppStateStatus): void => {
        if (next === "active") {
          void read();
        }
      },
    );

    return (): void => {
      subscription.remove();
    };
  }, [read]);

  const allow: () => Promise<void> = useCallback(async (): Promise<void> => {
    if (!isAvailable()) {
      return;
    }

    if (state === NotificationPermissionState.Denied) {
      try {
        await Linking.openSettings();
      } catch (error: unknown) {
        logger.warn("[GetReady] Could not open the app's settings:", error);
      }

      return;
    }

    setIsAsking(true);

    try {
      const response: PermissionResponse =
        await Notifications.requestPermissionsAsync({
          ios: {
            allowAlert: true,
            allowBadge: true,
            allowSound: true,
          },
        });

      const next: NotificationPermissionState =
        toNotificationPermissionState(response);

      if (next === NotificationPermissionState.Granted) {
        requestPushRegistration();
      }

      if (isMounted.current) {
        setState(next);
      }
    } catch (error: unknown) {
      logger.warn("[GetReady] Could not ask for notifications:", error);
      await read();
    } finally {
      if (isMounted.current) {
        setIsAsking(false);
      }
    }
  }, [state, read]);

  return { state, isAsking, allow };
}
