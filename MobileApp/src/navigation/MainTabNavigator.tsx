import React from "react";
import { View, Platform, useWindowDimensions } from "react-native";
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
    <View className="items-center justify-center">
      <Ionicons name={focused ? focusedName : name} size={22} color={color} />
      {focused ? (
        <View
          className="w-1 h-1 rounded-full mt-0.5"
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
  const { width } = useWindowDimensions();
  const isMobileWidth: boolean = width < 768;

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
          fontSize: 18,
          letterSpacing: -0.4,
        },
        tabBarStyle: {
          position: "absolute",
          left: 14,
          right: 14,
          bottom: Platform.OS === "ios" ? 14 : 10,
          backgroundColor: theme.colors.backgroundElevated,
          borderTopWidth: 0,
          borderWidth: 1,
          borderColor: theme.colors.borderGlass,
          borderRadius: 22,
          height: Platform.OS === "ios" ? 78 : 68,
          paddingBottom: Platform.OS === "ios" ? 18 : 10,
          paddingTop: 10,
          shadowColor: theme.isDark ? "#000000" : theme.colors.accentGradientMid,
          shadowOpacity: theme.isDark ? 0.35 : 0.12,
          shadowOffset: { width: 0, height: 8 },
          shadowRadius: 18,
          elevation: 16,
        },
        tabBarActiveTintColor: theme.colors.actionPrimary,
        tabBarInactiveTintColor: theme.colors.textTertiary,
        tabBarShowLabel: !isMobileWidth,
        tabBarLabelStyle: {
          fontSize: 10,
          fontWeight: "600",
          marginTop: 1,
          letterSpacing: 0.2,
        },
        tabBarItemStyle: {
          borderRadius: 14,
          marginHorizontal: 2,
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
                name="alert-circle-outline"
                focusedName="alert-circle"
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
