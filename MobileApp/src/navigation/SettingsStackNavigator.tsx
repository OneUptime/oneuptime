import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import SettingsScreen from "../screens/SettingsScreen";
import NotificationPreferencesScreen from "../screens/NotificationPreferencesScreen";
import type { SettingsStackParamList } from "./types";

const Stack: ReturnType<typeof createNativeStackNavigator<SettingsStackParamList>> = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundSecondary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="SettingsList"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <Stack.Screen
        name="NotificationPreferences"
        component={NotificationPreferencesScreen}
        options={{ title: "Notifications" }}
      />
    </Stack.Navigator>
  );
}
