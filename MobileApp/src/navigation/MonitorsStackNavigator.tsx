import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import MonitorsScreen from "../screens/MonitorsScreen";
import MonitorDetailScreen from "../screens/MonitorDetailScreen";
import type { MonitorsStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<MonitorsStackParamList>
> = createNativeStackNavigator<MonitorsStackParamList>();

export default function MonitorsStackNavigator(): React.JSX.Element {
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
        name="MonitorsList"
        component={MonitorsScreen}
        options={{ title: "Monitors" }}
      />
      <Stack.Screen
        name="MonitorDetail"
        component={MonitorDetailScreen}
        options={{
          title: "Monitor",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
    </Stack.Navigator>
  );
}
