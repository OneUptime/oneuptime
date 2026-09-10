import React, { useContext } from "react";
import { View } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { getTabBarBottom, layout } from "../theme/layout";
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import { Ionicons } from "@expo/vector-icons";
import { MainTabParamList } from "./types";
import HomeScreen from "../screens/HomeScreen";
import MonitorsStackNavigator from "./MonitorsStackNavigator";
import IncidentsStackNavigator from "./IncidentsStackNavigator";
import AlertsStackNavigator from "./AlertsStackNavigator";
import OnCallStackNavigator from "./OnCallStackNavigator";
import SettingsStackNavigator from "./SettingsStackNavigator";
import { useTheme } from "../theme";
import ProjectSwitcher from "../components/ProjectSwitcher";
import ProjectNavigationSync from "./ProjectNavigationSync";

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
    <View
      style={{
        alignItems: "center",
        justifyContent: "center",
        width: 42,
        height: 30,
        borderRadius: 12,
        backgroundColor: focused ? accentColor + "20" : "transparent",
      }}
    >
      <Ionicons name={focused ? focusedName : name} size={22} color={color} />
    </View>
  );
}

export default function MainTabNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  const insets: EdgeInsets | null = useContext(SafeAreaInsetsContext);

  return (
    <>
      <ProjectNavigationSync />
      <Tab.Navigator
        screenOptions={{
          headerTitle: () => {
            return <ProjectSwitcher />;
          },
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
            left: 8,
            right: 8,
            bottom: getTabBarBottom(insets?.bottom ?? 0),
            backgroundColor: theme.colors.backgroundElevated,
            borderTopWidth: 0,
            borderWidth: 1,
            borderColor: theme.colors.borderGlass,
            borderRadius: 20,
            height: layout.tabBarHeight,
            paddingBottom: 8,
            paddingTop: 8,
            shadowColor: "#000000",
            shadowOpacity: 0.35,
            shadowOffset: { width: 0, height: 8 },
            shadowRadius: 18,
            elevation: 16,
          },
          tabBarActiveTintColor: theme.colors.actionPrimary,
          tabBarInactiveTintColor: theme.colors.textTertiary,
          tabBarShowLabel: true,
          tabBarLabelPosition: "below-icon",
          tabBarHideOnKeyboard: true,
          tabBarButton: (props: BottomTabBarButtonProps) => {
            return (
              <PlatformPressable
                {...props}
                style={[props.style, { paddingHorizontal: 0 }]}
              />
            );
          },
          tabBarLabelStyle: {
            fontSize: 10,
            fontWeight: "600",
            marginTop: 1,
            letterSpacing: 0.2,
          },
          tabBarItemStyle: {
            borderRadius: 14,
            marginHorizontal: 0,
            minHeight: 48,
            paddingVertical: 2,
          },
        }}
      >
        {/*
         * Visible labels stay on at phone widths; explicit accessible names
         * keep VoiceOver and TalkBack consistent as well.
         */}
        <Tab.Screen
          name="Home"
          component={HomeScreen}
          options={{
            tabBarAccessibilityLabel: "Home",
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
          name="Monitors"
          component={MonitorsStackNavigator}
          options={{
            headerShown: false,
            tabBarAccessibilityLabel: "Monitors",
            tabBarIcon: ({
              color,
              focused,
            }: {
              color: string;
              focused: boolean;
            }) => {
              return (
                <TabIcon
                  name="pulse-outline"
                  focusedName="pulse"
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
            tabBarAccessibilityLabel: "Incidents",
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
            tabBarAccessibilityLabel: "Alerts",
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
          name="OnCall"
          component={OnCallStackNavigator}
          options={{
            headerShown: false,
            title: "On-Call",
            tabBarAccessibilityLabel: "On-Call",
            tabBarIcon: ({
              color,
              focused,
            }: {
              color: string;
              focused: boolean;
            }) => {
              return (
                <TabIcon
                  name="call-outline"
                  focusedName="call"
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
            tabBarAccessibilityLabel: "Settings",
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
    </>
  );
}
