import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import IncidentsScreen from "../screens/IncidentsScreen";
import IncidentDetailScreen from "../screens/IncidentDetailScreen";
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
          backgroundColor: theme.colors.backgroundSecondary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
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
        options={{ title: "Incident" }}
      />
    </Stack.Navigator>
  );
}
