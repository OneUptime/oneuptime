import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import IncidentsScreen from "../screens/IncidentsScreen";
import IncidentDetailScreen from "../screens/IncidentDetailScreen";
import IncidentEpisodeDetailScreen from "../screens/IncidentEpisodeDetailScreen";
import type { IncidentsStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<IncidentsStackParamList>
> = createNativeStackNavigator<IncidentsStackParamList>();

export default function IncidentsStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
        ...(Platform.OS === "ios" ? { headerLargeTitle: true, headerLargeStyle: { backgroundColor: theme.colors.backgroundPrimary } } : {}),
      }}
    >
      <Stack.Screen
        name="IncidentsList"
        component={IncidentsScreen}
        options={{ title: "Incidents" }}
      />
      <Stack.Screen
        name="IncidentDetail"
        component={IncidentDetailScreen}
        options={{
          title: "Incident",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
      <Stack.Screen
        name="IncidentEpisodeDetail"
        component={IncidentEpisodeDetailScreen}
        options={{
          title: "Episode",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
    </Stack.Navigator>
  );
}
