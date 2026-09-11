import React from "react";
import ProjectSwitcher from "../components/ProjectSwitcher";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import SettingsScreen from "../screens/SettingsScreen";
import ProjectsScreen from "../screens/settings/ProjectsScreen";
import SSOProviderSelectScreen from "../screens/settings/SSOProviderSelectScreen";
import OnCallCalendarFeedScreen from "../screens/OnCallCalendarFeedScreen";
import type { SettingsStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<SettingsStackParamList>
> = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerTitle: () => {
          return <ProjectSwitcher />;
        },
        headerStyle: {
          backgroundColor: theme.colors.backgroundSecondary,
        },
        headerTintColor: theme.colors.actionPrimary,
        headerTitleStyle: {
          fontSize: 17,
          fontWeight: "600",
          color: theme.colors.textPrimary,
        },
        headerShadowVisible: false,
        headerBackButtonDisplayMode: "minimal",
        ...(Platform.OS === "ios"
          ? {
              headerLargeTitle: false,
              headerLargeStyle: {
                backgroundColor: theme.colors.backgroundSecondary,
              },
            }
          : {}),
      }}
    >
      <Stack.Screen
        name="SettingsList"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <Stack.Screen
        name="ProjectsList"
        component={ProjectsScreen}
        options={{ title: "Projects" }}
      />
      <Stack.Screen
        name="SSOProviderSelect"
        component={SSOProviderSelectScreen}
        options={{ title: "SSO Login" }}
      />
      <Stack.Screen
        name="OnCallCalendarFeed"
        component={OnCallCalendarFeedScreen}
        options={{ title: "Calendar Feed" }}
      />
    </Stack.Navigator>
  );
}
