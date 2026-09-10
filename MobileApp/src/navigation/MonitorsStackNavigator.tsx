import React from "react";
import ProjectSwitcher from "../components/ProjectSwitcher";
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
