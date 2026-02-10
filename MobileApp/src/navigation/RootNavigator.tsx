import React, { useState, useEffect } from "react";
import {
  NavigationContainer,
  DefaultTheme,
  Theme,
  useNavigationContainerRef,
} from "@react-navigation/native";
import * as Linking from "expo-linking";
import { useTheme } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useProject } from "../hooks/useProject";
import { usePushNotifications } from "../hooks/usePushNotifications";
import { useBiometric } from "../hooks/useBiometric";
import AuthStackNavigator from "./AuthStackNavigator";
import MainTabNavigator from "./MainTabNavigator";
import ProjectSelectionScreen from "../screens/ProjectSelectionScreen";
import BiometricLockScreen from "../screens/BiometricLockScreen";
import { View, ActivityIndicator, StyleSheet } from "react-native";

const prefix: string = Linking.createURL("/");

const linking: React.ComponentProps<typeof NavigationContainer>["linking"] = {
  prefixes: [prefix, "oneuptime://"],
  config: {
    screens: {
      Home: "home",
      Incidents: {
        screens: {
          IncidentDetail: "incident/:incidentId",
        },
      },
      Alerts: {
        screens: {
          AlertDetail: "alert/:alertId",
        },
      },
      IncidentEpisodes: {
        screens: {
          IncidentEpisodeDetail: "incident-episode/:episodeId",
        },
      },
      AlertEpisodes: {
        screens: {
          AlertEpisodeDetail: "alert-episode/:episodeId",
        },
      },
    },
  },
};

export default function RootNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  const { isAuthenticated, isLoading, needsServerUrl } = useAuth();
  const { selectedProject, isLoadingProjects } = useProject();
  const navigationRef: ReturnType<typeof useNavigationContainerRef> = useNavigationContainerRef();
  const biometric: ReturnType<typeof useBiometric> = useBiometric();

  const [biometricPassed, setBiometricPassed] = useState(false);
  const [biometricChecked, setBiometricChecked] = useState(false);

  usePushNotifications(navigationRef);

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
      card: theme.colors.backgroundSecondary,
      text: theme.colors.textPrimary,
      border: theme.colors.borderDefault,
      notification: theme.colors.severityCritical,
    },
    fonts: DefaultTheme.fonts,
  };

  if (isLoading || !biometricChecked) {
    return (
      <View
        style={[
          styles.loading,
          { backgroundColor: theme.colors.backgroundPrimary },
        ]}
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

    if (isLoadingProjects) {
      return (
        <View
          style={[
            styles.loading,
            { backgroundColor: theme.colors.backgroundPrimary },
          ]}
        >
          <ActivityIndicator size="large" color={theme.colors.actionPrimary} />
        </View>
      );
    }

    if (!selectedProject) {
      return <ProjectSelectionScreen />;
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

const styles: ReturnType<typeof StyleSheet.create> = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
