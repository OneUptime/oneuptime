import React, { useContext } from "react";
import { View } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { layout } from "../theme/layout";
import {
  createBottomTabNavigator,
  type BottomTabBarButtonProps,
} from "@react-navigation/bottom-tabs";
import { PlatformPressable } from "@react-navigation/elements";
import { Ionicons } from "@expo/vector-icons";
import { MainTabParamList } from "./types";
import HomeScreen from "../screens/HomeScreen";
import MonitorsStackNavigator from "./MonitorsStackNavigator";
import InboxStackNavigator from "./InboxStackNavigator";
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
        width: 52,
        height: 28,
        borderRadius: 14,
        backgroundColor: focused ? accentColor : "transparent",
      }}
    >
      <Ionicons name={focused ? focusedName : name} size={21} color={color} />
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
          headerTitleAlign: "left",
          headerStyle: {
            backgroundColor: theme.colors.backgroundPrimary,
          },
          headerShadowVisible: false,
          headerTintColor: theme.colors.textPrimary,
          headerTitleStyle: {
            fontWeight: "700",
            fontSize: 18,
            letterSpacing: -0.4,
          },
          sceneStyle: { backgroundColor: theme.colors.backgroundPrimary },
          tabBarStyle: {
            position: "absolute",
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: theme.colors.backgroundSecondary,
            borderTopWidth: 1,
            borderTopColor: theme.colors.borderSubtle,
            height: layout.tabBarHeight + (insets?.bottom ?? 0),
            paddingBottom: 8 + (insets?.bottom ?? 0),
            paddingTop: 6,
            elevation: 0,
          },
          tabBarActiveTintColor: theme.colors.actionPrimary,
          tabBarInactiveTintColor: theme.colors.textSecondary,
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
            fontSize: 11,
            lineHeight: 15,
            fontWeight: "600",
            marginTop: 3,
            letterSpacing: 0,
          },
          tabBarItemStyle: {
            marginHorizontal: 0,
            minHeight: 48,
            paddingVertical: 0,
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
                  accentColor={theme.colors.cardAccent}
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
                  accentColor={theme.colors.cardAccent}
                />
              );
            },
          }}
        />
        <Tab.Screen
          name="Inbox"
          component={InboxStackNavigator}
          options={{
            headerShown: false,
            tabBarAccessibilityLabel: "Inbox",
            tabBarIcon: ({
              color,
              focused,
            }: {
              color: string;
              focused: boolean;
            }) => {
              return (
                <TabIcon
                  name="file-tray-outline"
                  focusedName="file-tray"
                  color={color}
                  focused={focused}
                  accentColor={theme.colors.cardAccent}
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
                  accentColor={theme.colors.cardAccent}
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
                  accentColor={theme.colors.cardAccent}
                />
              );
            },
          }}
        />
      </Tab.Navigator>
    </>
  );
}
