import { useEffect, useRef } from "react";
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
import { registerPushDevice, unregisterPushDevice } from "../api/pushDevice";
import { useAuth } from "./useAuth";
import { useProject } from "./useProject";

const PUSH_TOKEN_KEY = "oneuptime_expo_push_token";

export function usePushNotifications(navigationRef: unknown): void {
  const { isAuthenticated } = useAuth();
  const { projectList } = useProject();
  const responseListenerRef = useRef<Subscription | null>(null);
  const receivedListenerRef = useRef<Subscription | null>(null);

  // Set up channels and categories on mount
  useEffect(() => {
    setupNotificationChannels();
    setupNotificationCategories();
  }, []);

  // Set navigation ref for deep linking
  useEffect(() => {
    if (navigationRef) {
      setNavigationRef(navigationRef);
    }
  }, [navigationRef]);

  // Register push token when authenticated and projects loaded
  useEffect(() => {
    if (!isAuthenticated || projectList.length === 0) {
      return;
    }

    let cancelled = false;

    const register = async (): Promise<void> => {
      const token = await requestPermissionsAndGetToken();
      if (!token || cancelled) {
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
        } catch {
          // Continue registering with other projects
        }
      }
    };

    register();

    return () => {
      cancelled = true;
    };
  }, [isAuthenticated, projectList]);

  // Set up notification listeners
  useEffect(() => {
    receivedListenerRef.current = Notifications.addNotificationReceivedListener(
      (_notification) => {
        // Foreground notification received — handler in setup.ts shows it
      },
    );

    responseListenerRef.current =
      Notifications.addNotificationResponseReceivedListener(
        handleNotificationResponse,
      );

    // Handle cold-start: check if app was opened via notification
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) {
        handleNotificationResponse(response);
      }
    });

    return () => {
      if (receivedListenerRef.current) {
        receivedListenerRef.current.remove();
      }
      if (responseListenerRef.current) {
        responseListenerRef.current.remove();
      }
    };
  }, []);
}

export async function unregisterPushToken(): Promise<void> {
  try {
    const token = await AsyncStorage.getItem(PUSH_TOKEN_KEY);
    if (token) {
      await unregisterPushDevice(token);
      await AsyncStorage.removeItem(PUSH_TOKEN_KEY);
    }
  } catch {
    // Best-effort: don't block logout
  }
}
