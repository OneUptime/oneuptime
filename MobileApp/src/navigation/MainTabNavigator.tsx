import React from "react";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { MainTabParamList } from "./types";
import HomeScreen from "../screens/HomeScreen";
import IncidentsScreen from "../screens/IncidentsScreen";
import AlertsScreen from "../screens/AlertsScreen";
import SettingsScreen from "../screens/SettingsScreen";
import { useTheme } from "../theme";

const Tab = createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundSecondary,
        },
        headerTintColor: theme.colors.textPrimary,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundSecondary,
          borderTopColor: theme.colors.borderDefault,
        },
        tabBarActiveTintColor: theme.colors.actionPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
      }}
    >
      <Tab.Screen name="Home" component={HomeScreen} />
      <Tab.Screen name="Incidents" component={IncidentsScreen} />
      <Tab.Screen name="Alerts" component={AlertsScreen} />
      <Tab.Screen name="Settings" component={SettingsScreen} />
    </Tab.Navigator>
  );
}
