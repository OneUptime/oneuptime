import React from "react";
import { View, Platform } from "react-native";
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

function TabIcon({
  name,
  focusedName,
  color,
  focused,
  accentColor,
}: {
  name: keyof typeof Ionicons.glyphMap;
  focusedName: keyof typeof Ionicons.glyphMap;
  color: string;
  focused: boolean;
  accentColor: string;
}): React.JSX.Element {
  return (
    <View className="items-center">
      <Ionicons name={focused ? focusedName : name} size={22} color={color} />
      {focused ? (
        <View
          className="w-1 h-1 rounded-full mt-1"
          style={{
            backgroundColor: accentColor,
          }}
        />
      ) : null}
    </View>
  );
}

export default function MainTabNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Tab.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
          borderBottomWidth: 1,
          borderBottomColor: theme.colors.borderSubtle,
        },
        headerShadowVisible: false,
        headerTintColor: theme.colors.textPrimary,
        headerTitleStyle: {
          fontWeight: "700",
          fontSize: 17,
          letterSpacing: -0.3,
        },
        tabBarStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
          borderTopColor: theme.colors.borderSubtle,
          borderTopWidth: 1,
          height: Platform.OS === "ios" ? 88 : 64,
          paddingBottom: Platform.OS === "ios" ? 28 : 8,
          paddingTop: 8,
        },
        tabBarActiveTintColor: theme.colors.actionPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: "600",
          marginTop: 2,
        },
        tabBarItemStyle: {
          paddingVertical: 2,
        },
      }}
    >
      <Tab.Screen
        name="Home"
        component={HomeScreen}
        options={{
          tabBarIcon: ({
            color,
            focused,
          }: {
            color: string;
            focused: boolean;
          }) => {
            return (
              <TabIcon
                name="home-outline"
                focusedName="home"
                color={color}
                focused={focused}
                accentColor={theme.colors.actionPrimary}
              />
            );
          },
        }}
      />
      <Tab.Screen
        name="Incidents"
        component={IncidentsStackNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({
            color,
            focused,
          }: {
            color: string;
            focused: boolean;
          }) => {
            return (
              <TabIcon
                name="warning-outline"
                focusedName="warning"
                color={color}
                focused={focused}
                accentColor={theme.colors.actionPrimary}
              />
            );
          },
        }}
      />
      <Tab.Screen
        name="Alerts"
        component={AlertsStackNavigator}
        options={{
          headerShown: false,
          tabBarIcon: ({
            color,
            focused,
          }: {
            color: string;
            focused: boolean;
          }) => {
            return (
              <TabIcon
                name="notifications-outline"
                focusedName="notifications"
                color={color}
                focused={focused}
                accentColor={theme.colors.actionPrimary}
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
          tabBarIcon: (props: { color: string; focused: boolean }) => {
            return (
              <TabIcon
                name="settings-outline"
                focusedName="settings"
                color={props.color}
                focused={props.focused}
                accentColor={theme.colors.actionPrimary}
              />
            );
          },
        }}
      />
    </Tab.Navigator>
  );
}
