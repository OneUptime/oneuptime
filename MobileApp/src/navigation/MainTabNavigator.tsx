import React, { useContext } from "react";
import { View, useWindowDimensions } from "react-native";
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

// How far the floating bar sits in from each screen edge.
const TAB_BAR_INSET: number = 8;

// Home, Monitors, Incidents, Alerts, On-Call, Settings.
const TAB_COUNT: number = 6;

/*
 * Below this per-tab width the longest label ("Incidents") cannot be trusted
 * to fit at the full label size on every platform's default sans. Chosen by
 * measuring against a font 13% wider than the one a Mac picks - wider than
 * the substitution that actually truncated it - and then leaving room to
 * spare: at this threshold the tightest width on either side of it keeps
 * ~7px, where 56 left the 360px case clinging on by 2.
 */
const COMFORTABLE_TAB_WIDTH: number = 60;

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
  const { width: windowWidth } = useWindowDimensions();

  /*
   * Six tabs share the bar's width, and the bar is inset from both screen
   * edges, so each label gets (screenWidth - 2 * TAB_BAR_INSET) / 6. At the
   * narrowest phone we support that is ~50px, and "Incidents" at 10px renders
   * 48px in Helvetica and past 50px in the wider sans that non-Apple platforms
   * substitute - which is how it shipped truncated to "Incide..." there while
   * measuring fine on a Mac. Sizing off the real width instead of a font
   * guess keeps the label whole on whatever font the platform picks.
   */
  const compactLabels: boolean =
    (windowWidth - 2 * TAB_BAR_INSET) / TAB_COUNT < COMFORTABLE_TAB_WIDTH;

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
            left: TAB_BAR_INSET,
            right: TAB_BAR_INSET,
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
            fontSize: compactLabels ? 9 : 10,
            fontWeight: "600",
            marginTop: 1,
            /*
             * Tracking is a flourish worth ~2px across the longest label, so
             * it is the first thing to go when the label is fighting for room.
             */
            letterSpacing: compactLabels ? 0 : 0.2,
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
