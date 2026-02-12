import React from "react";
import { StyleSheet, Platform } from "react-native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import { MainTabParamList } from "./types";
import HomeScreen from "../screens/HomeScreen";
import IncidentsStackNavigator from "./IncidentsStackNavigator";
import AlertsStackNavigator from "./AlertsStackNavigator";
import SettingsStackNavigator from "./SettingsStackNavigator";
import { useTheme } from "../theme";

const Tab: ReturnType<typeof createBottomTabNavigator<MainTabParamList>> =
  createBottomTabNavigator<MainTabParamList>();

export default function MainTabNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
          borderBottomWidth: StyleSheet.hairlineWidth,
          borderBottomColor: theme.colors.borderSubtle,
          ...Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOpacity: 0.03,
              shadowOffset: { width: 0, height: 1 },
              shadowRadius: 4,
            },
            default: { elevation: 1 },
          }),
        },
        headerShadowVisible: false,
        headerTintColor: theme.colors.textPrimary,
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
          borderTopColor: theme.colors.borderSubtle,
          borderTopWidth: StyleSheet.hairlineWidth,
          ...Platform.select({
            ios: {
              shadowColor: "#000",
              shadowOpacity: 0.04,
              shadowOffset: { width: 0, height: -1 },
              shadowRadius: 6,
            },
            default: { elevation: 3 },
          }),
        },
        tabBarActiveTintColor: theme.colors.actionPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
        },
        tabBarItemStyle: {
          paddingVertical: 4,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({ color, size }: { color: string; size: number }) => {
            return <Ionicons name="home-outline" size={size} color={color} />;
          },
        }}
      />
      <Tab.Screen
        name="Incidents"
        component={IncidentsStackNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => {
            return (
              <Ionicons name="warning-outline" size={size} color={color} />
            );
          },
        }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsStackNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => {
            return (
              <Ionicons
                name="notifications-outline"
                size={size}
                color={color}
              />
            );
          },
        }}
      />
      <Tab.Screen
        name="Settings"
        component={SettingsStackNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({ color, size }: { color: string; size: number }) => {
            return (
              <Ionicons name="settings-outline" size={size} color={color} />
            );
          },
        }}
      />
    </Tab.Navigator>
  );
}
