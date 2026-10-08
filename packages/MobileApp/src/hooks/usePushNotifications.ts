import React, { useEffect, useRef, useState } from "react";
import { AppState, AppStateStatus, Platform } from "react-native";
import { type Subscription } from "expo-notifications";
import * as Notifications from "expo-notifications";
import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  setupNotificationChannels,
  setupNotificationCategories,
  requestPermissionsAndGetToken,
} from "../notifications/setup";
import {
  setNavigationRef,
  handleNotificationResponse,
} from "../notifications/handlers";
import { registerPushDevice } from "../api/pushDevice";
import { useAuth } from "./useAuth";
import { useProject } from "./useProject";
import { PUSH_TOKEN_KEY } from "./pushTokenUtils";
import { getCriticalAlertsEnabled } from "../storage/preferences";
import logger from "../utils/logger";

const RETRY_DELAY_MS: number = 5000;
const MAX_RETRIES: number = 3;

export function usePushNotifications(navigationRef: unknown): void {
  const { isAuthenticated }: { isAuthenticated: boolean } = useAuth();
  const { projectList }: { projectList: Array<{ _id: string }> } = useProject();
  const responseListenerRef: React.RefObject<Subscription | null> =
    useRef<Subscription | null>(null);
  const receivedListenerRef: React.RefObject<Subscription | null> =
    useRef<Subscription | null>(null);

  // Set up channels and categories on mount
  useEffect((): void => {
    if (Platform.OS === "web") {
      return;
    }
    setupNotificationChannels();
    setupNotificationCategories();
  }, []);

  // Set navigation ref for deep linking
  useEffect((): void => {
    if (navigationRef) {
      setNavigationRef(navigationRef);
    }
  }, [navigationRef]);

  /*
   * How many times the app has come back from the background. Registration
   * below runs again each time, not only when the app starts: opening the
   * app is what the server and OneUptime's pages tell a person to do when
   * this phone stopped receiving notifications (Expo said its push token was
   * gone), because registering asks Expo for the token again - which renews
   * it - and the server then verifies the phone again with its rules. A
   * phone that was only ever brought back from the background would
   * otherwise stay silent until the app was next started from scratch.
   *
   * Only a return from the background counts. iOS also passes through
   * "inactive" for a Face ID prompt or Control Center, and none of those
   * left the app.
   */
  const [returnsToForeground, setReturnsToForeground] = useState<number>(0);

  useEffect((): (() => void) | undefined => {
    if (Platform.OS === "web") {
      return undefined;
    }

    let wasInBackground: boolean = AppState.currentState === "background";

    const subscription: { remove: () => void } = AppState.addEventListener(
      "change",
      (nextState: AppStateStatus): void => {
        if (nextState === "background") {
          wasInBackground = true;
          return;
        }

        if (nextState === "active" && wasInBackground) {
          wasInBackground = false;
          setReturnsToForeground((count: number): number => {
            return count + 1;
          });
        }
      },
    );

    return (): void => {
      subscription.remove();
    };
  }, []);

  // Register push token when authenticated and projects loaded
  useEffect((): (() => void) | undefined => {
    if (Platform.OS === "web" || !isAuthenticated || projectList.length === 0) {
      return undefined;
    }

    let cancelled: boolean = false;

    /*
     * Asked for when the app starts. Coming back from the background
     * registers without asking (requestPermissionsAndGetToken).
     */
    const askForPermission: boolean = returnsToForeground === 0;

    const register: () => Promise<void> = async (): Promise<void> => {
      let token: string | null = null;
      let attempt: number = 0;

      // Retry obtaining the push token
      while (!token && attempt < MAX_RETRIES && !cancelled) {
        token = await requestPermissionsAndGetToken({
          askForPermission: askForPermission,
        });
        if (!token && !cancelled) {
          attempt++;
          if (attempt < MAX_RETRIES) {
            logger.warn(
              `[PushNotifications] Push token not available, retrying in ${RETRY_DELAY_MS}ms (attempt ${attempt}/${MAX_RETRIES})`,
            );
            await new Promise<void>((resolve: () => void): void => {
              setTimeout(resolve, RETRY_DELAY_MS);
            });
          }
        }
      }

      if (!token || cancelled) {
        if (!token) {
          logger.warn(
            "[PushNotifications] Could not obtain push token after all retries — device will not be registered",
          );
        }
        return;
      }

      await AsyncStorage.setItem(PUSH_TOKEN_KEY, token);

      /*
       * Carried into every registration below. Each project gets its own device
       * row, and a row created without this defaults to off - so without it a
       * responder who had critical alerts on would silently lose the override
       * for any project they joined after switching it on, and for every
       * project at all after a reinstall issued a new push token.
       */
      const isCriticalAlertEnabled: boolean = await getCriticalAlertsEnabled();

      // Register with each project
      for (const project of projectList) {
        if (cancelled) {
          break;
        }
        try {
          await registerPushDevice({
            deviceToken: token,
            projectId: project._id,
            isCriticalAlertEnabled: isCriticalAlertEnabled,
          });
        } catch (error: unknown) {
          logger.warn(
            `[PushNotifications] Failed to register device for project ${project._id}:`,
            error,
          );
        }
      }
    };

    register().catch((error: unknown): void => {
      logger.error(
        "[PushNotifications] Unexpected error during push registration:",
        error,
      );
    });

    return (): void => {
      cancelled = true;
    };
  }, [isAuthenticated, projectList, returnsToForeground]);

  // Set up notification listeners
  useEffect((): (() => void) | undefined => {
    // Expo's native notification APIs are unavailable in the browser preview.
    if (Platform.OS === "web") {
      return undefined;
    }
    receivedListenerRef.current = Notifications.addNotificationReceivedListener(
      (_notification: Notifications.Notification): void => {
        // Foreground notification received — handler in setup.ts shows it
      },
    );

    responseListenerRef.current =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse,
      );

    // Handle cold-start: check if app was opened via notification
    Notifications.getLastNotificationResponseAsync().then(
      (response: Notifications.NotificationResponse | null): void => {
        if (response) {
          handleNotificationResponse(response);
        }
      },
    );

    return (): void => {
      if (receivedListenerRef.current) {
        receivedListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, []);
}
