import React, { useEffect, useRef } from "react";
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
    setupNotificationChannels();
    setupNotificationCategories();
  }, []);

  // Set navigation ref for deep linking
  useEffect((): void => {
    if (navigationRef) {
      setNavigationRef(navigationRef);
    }
  }, [navigationRef]);

  // Register push token when authenticated and projects loaded
  useEffect((): (() => void) | undefined => {
    if (!isAuthenticated || projectList.length === 0) {
      return undefined;
    }

    let cancelled: boolean = false;

    const register: () => Promise<void> = async (): Promise<void> => {
      let token: string | null = null;
      let attempt: number = 0;

      // Retry obtaining the push token
      while (!token && attempt < MAX_RETRIES && !cancelled) {
        token = await requestPermissionsAndGetToken();
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

      // Register with each project
      for (const project of projectList) {
        if (cancelled) {
          break;
        }
        try {
          await registerPushDevice({
            deviceToken: token,
            projectId: project._id,
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
  }, [isAuthenticated, projectList]);

  // Set up notification listeners
  useEffect((): (() => void) => {
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
