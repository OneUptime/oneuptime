import React from "react";
import ProjectSwitcher from "../components/ProjectSwitcher";
import { Platform } from "react-native";
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
        headerTitle: () => {
          return <ProjectSwitcher />;
        },
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        headerTintColor: theme.colors.actionPrimary,
        headerTitleStyle: {
          fontSize: 17,
          fontWeight: "600",
          color: theme.colors.textPrimary,
        },
        headerShadowVisible: false,
        ...(Platform.OS === "ios"
          ? {
              headerLargeTitle: false,
              headerLargeStyle: {
                backgroundColor: theme.colors.backgroundPrimary,
              },
            }
          : {}),
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
        options={{
          title: "Alert",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
      <Stack.Screen
        name="AlertEpisodeDetail"
        component={AlertEpisodeDetailScreen}
        options={{
          title: "Episode",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
    </Stack.Navigator>
  );
}
