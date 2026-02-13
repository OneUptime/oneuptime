import React, { useState, useEffect } from "react";
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
import AuthStackNavigator from "./AuthStackNavigator";
import MainTabNavigator from "./MainTabNavigator";
import BiometricLockScreen from "../screens/BiometricLockScreen";
import { View, ActivityIndicator } from "react-native";

const prefix: string = Linking.createURL("/");

const linking: React.ComponentProps<typeof NavigationContainer>["linking"] = {
  prefixes: [prefix, "oneuptime://"],
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
  const [biometricChecked, setBiometricChecked] = useState(false);

  usePushNotifications(navigationRef);

  // Hide the native splash screen once initial loading completes
  useEffect(() => {
    if (!isLoading && biometricChecked) {
      SplashScreen.hideAsync();
    }
  }, [isLoading, biometricChecked]);

  // Check biometric on app launch
  useEffect(() => {
    const checkBiometric: () => Promise<void> = async (): Promise<void> => {
      if (!isAuthenticated || !biometric.isEnabled) {
        setBiometricPassed(true);
        setBiometricChecked(true);
        return;
      }

      setBiometricChecked(true);
      // Don't auto-pass — show lock screen
    };

    if (!isLoading) {
      checkBiometric();
    }
  }, [isAuthenticated, isLoading, biometric.isEnabled]);

  const navigationTheme: Theme = {
    ...DefaultTheme,
    dark: theme.isDark,
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

  if (isLoading || !biometricChecked) {
    return (
      <View
        className="flex-1 items-center justify-center bg-bg-primary"
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
    >
      {renderContent()}
    </NavigationContainer>
  );
}
