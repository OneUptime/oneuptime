import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import AlertsScreen from "../screens/AlertsScreen";
import AlertDetailScreen from "../screens/AlertDetailScreen";
import AlertEpisodeDetailScreen from "../screens/AlertEpisodeDetailScreen";
import type { AlertsStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<AlertsStackParamList>
> = createNativeStackNavigator<AlertsStackParamList>();

export default function AlertsStackNavigator(): React.JSX.Element {
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
        name="AlertsList"
        component={AlertsScreen}
        options={{ title: "Alerts" }}
      />
      <Stack.Screen
        name="AlertDetail"
        component={AlertDetailScreen}
        options={{ title: "Alert" }}
      />
      <Stack.Screen
        name="AlertEpisodeDetail"
        component={AlertEpisodeDetailScreen}
        options={{ title: "Episode" }}
      />
    </Stack.Navigator>
  );
}
