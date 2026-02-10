import React from "react";
import { NavigationContainer, DefaultTheme, Theme, useNavigationContainerRef } from "@react-navigation/native";
import { useTheme } from "../theme";
import { useAuth } from "../hooks/useAuth";
import { useProject } from "../hooks/useProject";
import { usePushNotifications } from "../hooks/usePushNotifications";
import AuthStackNavigator from "./AuthStackNavigator";
import MainTabNavigator from "./MainTabNavigator";
import ProjectSelectionScreen from "../screens/ProjectSelectionScreen";
import { ActivityIndicator, View, StyleSheet } from "react-native";

export default function RootNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  const { isAuthenticated, isLoading, needsServerUrl } = useAuth();
  const { selectedProject, isLoadingProjects } = useProject();
  const navigationRef = useNavigationContainerRef();

  usePushNotifications(navigationRef);

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

  if (isLoading) {
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

  const renderContent = (): React.JSX.Element => {
    if (!isAuthenticated) {
      return (
        <AuthStackNavigator
          initialRoute={needsServerUrl ? "ServerUrl" : "Login"}
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
    <NavigationContainer ref={navigationRef} theme={navigationTheme}>
      {renderContent()}
    </NavigationContainer>
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
  },
});
