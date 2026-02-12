import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import SettingsScreen from "../screens/SettingsScreen";
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
      }}
    >
      <Stack.Screen
        name="SettingsList"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
    </Stack.Navigator>
  );
}
