import React, { useState, useEffect, useCallback } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  Theme,
  useNavigationContainerRef,
} from "@react-navigation/native";
import * as Linking from "expo-linking";
import * as SplashScreen from "expo-splash-screen";
import { useTheme } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useBiometric } from "../hooks/useBiometric";
import { processPendingNotification } from "../notifications/handlers";
import AuthStackNavigator from "./AuthStackNavigator";
import MainTabNavigator from "./MainTabNavigator";
import BiometricLockScreen from "../screens/BiometricLockScreen";
import { View, ActivityIndicator } from "react-native";

const prefix: string = Linking.createURL("/");

const linking: React.ComponentProps<typeof NavigationContainer>["linking"] = {
  prefixes: [prefix, "oneuptime://"],
  /*
   * Disable automatic deep link URL resolution via NavigationContainer.
   * On Android with React Native's new architecture (Fabric), the async
   * getInitialURL resolution inside NavigationContainer's useLinking hook
   * sets state inside a microtask callback which never triggers a re-render,
   * causing screens to never appear (blank screen after loading).
   * Deep link navigation from push notifications is handled separately in
   * usePushNotifications via Notifications.getLastNotificationResponseAsync().
   */
  enabled: false,
  config: {
    screens: {
      Home: "home",
      Incidents: {
        screens: {
          IncidentDetail: "incident/:projectId/:incidentId",
          IncidentEpisodeDetail: "incident-episode/:projectId/:episodeId",
        },
      },
      Alerts: {
        screens: {
          AlertDetail: "alert/:projectId/:alertId",
          AlertEpisodeDetail: "alert-episode/:projectId/:episodeId",
        },
      },
      OnCall: {
        screens: {
          OnCallList: "on-call",
        },
      },
    },
  },
};

export default function RootNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  const { isAuthenticated, isLoading, needsServerUrl } = useAuth();
  const navigationRef: ReturnType<typeof useNavigationContainerRef> =
    useNavigationContainerRef();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();

  const [biometricPassed, setBiometricPassed] = useState(false);

  usePushNotifications(navigationRef);

  // Hide the native splash screen once initial loading completes
  useEffect(() => {
    if (!isLoading) {
      SplashScreen.hideAsync();
    }
  }, [isLoading]);

  // Process pending notification when auth/biometric state settles and the
  // MainTabNavigator mounts (covers the case where onReady already fired for
  // AuthStackNavigator before the user logged in, or after biometric unlock).
  useEffect(() => {
    if (isAuthenticated && !isLoading) {
      const timer: ReturnType<typeof setTimeout> = setTimeout(
        processPendingNotification,
        100,
      );
      return () => {
        return clearTimeout(timer);
      };
    }
    return undefined;
  }, [isAuthenticated, isLoading, biometricPassed]);

  const handleNavigationReady: () => void = useCallback((): void => {
    processPendingNotification();
  }, []);

  const navigationTheme: Theme = {
    ...DefaultTheme,
    dark: true,
    colors: {
      ...DefaultTheme.colors,
      primary: theme.colors.actionPrimary,
      background: theme.colors.backgroundPrimary,
      card: theme.colors.backgroundPrimary,
      text: theme.colors.textPrimary,
      border: theme.colors.borderDefault,
      notification: theme.colors.severityCritical,
    },
    fonts: DefaultTheme.fonts,
  };

  if (isLoading) {
    return (
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          backgroundColor: theme.colors.backgroundPrimary,
        }}
      >
        <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
      </View>
    );
  }

  const renderContent: () => React.JSX.Element = (): React.JSX.Element => {
    if (!isAuthenticated) {
      return (
        <AuthStackNavigator
          initialRoute={needsServerUrl ? "ServerUrl" : "Login"}
        />
      );
    }

    // Show biometric lock screen if enabled and not yet passed
    if (biometric.isEnabled && !biometricPassed) {
      return (
        <BiometricLockScreen
          onSuccess={() => {
            return setBiometricPassed(true);
          }}
          biometricType={biometric.biometricType}
        />
      );
    }

    return <MainTabNavigator />;
  };

  return (
    <NavigationContainer
      ref={navigationRef}
      theme={navigationTheme}
      linking={linking}
      onReady={handleNavigationReady}
    >
      {renderContent()}
    </NavigationContainer>
  );
}
