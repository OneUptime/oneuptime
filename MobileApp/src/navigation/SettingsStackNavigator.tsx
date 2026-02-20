import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import SettingsScreen from "../screens/SettingsScreen";
import ProjectsScreen from "../screens/settings/ProjectsScreen";
import type { SettingsStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<SettingsStackParamList>
> = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
        ...(Platform.OS === "ios"
          ? {
              headerLargeTitle: true,
              headerLargeStyle: {
                backgroundColor: theme.colors.backgroundPrimary,
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
    </Stack.Navigator>
  );
}
