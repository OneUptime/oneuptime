import React, { useContext, useMemo } from "react";
import { View, type ViewStyle } from "react-native";
import {
  SafeAreaInsetsContext,
  type EdgeInsets,
} from "react-native-safe-area-context";
import { layout } from "../theme/layout";
import { spacing } from "../theme/tokens";
import {
  useHeaderHeightOverride,
  useWindowLayout,
} from "../layout/WindowLayout";
import {
  NAVIGATION_RAIL_WIDTH,
  type WindowLayout,
} from "../layout/windowLayout";
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
  const windowLayout: WindowLayout = useWindowLayout();
  // Home's header is drawn in JavaScript; on the iPhone Duo held open it needs the regular bar's height.
  const headerHeight: number | undefined = useHeaderHeightOverride();

  /*
   * A bar along the bottom on a phone held upright, a rail down the left on
   * a wide window - an unfolded foldable, a tablet, a phone on its side -
   * where a bottom bar would cost a phone's landscape height a fifth of the
   * screen and stretch five tabs across a page meant for two panes. Apple's
   * own tab bars move to the side on the iPhone Duo's open screen for the
   * same reason. Changing sides never remounts a tab: React Navigation keys
   * the bar and the screens, so the screens keep their place in the tree.
   */
  const rail: boolean = windowLayout.navigation === "rail";

  /*
   * The rail covers the window's left edge, so the screens beside it have no
   * left inset to keep clear - a notch on that side is the rail's to avoid.
   */
  const contentInsets: EdgeInsets | null = useMemo((): EdgeInsets | null => {
    return insets && rail ? { ...insets, left: 0 } : insets;
  }, [insets, rail]);

  const railStyle: ViewStyle = {
    width: windowLayout.railWidth,
    paddingTop: (insets?.top ?? 0) + spacing.md,
    paddingBottom: (insets?.bottom ?? 0) + spacing.md,
    paddingStart: insets?.left ?? 0,
    paddingEnd: 0,
    backgroundColor: theme.colors.backgroundSecondary,
    borderTopWidth: 0,
    borderRightWidth: 1,
    borderRightColor: theme.colors.borderSubtle,
    elevation: 0,
  };

  const barStyle: ViewStyle = {
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
  };

  return (
    <SafeAreaInsetsContext.Provider value={contentInsets}>
      <ProjectNavigationSync />
      <Tab.Navigator
        safeAreaInsets={rail && insets ? insets : undefined}
        screenOptions={{
          headerTitle: () => {
            return <ProjectSwitcher />;
          },
          headerTitleAlign: "left",
          headerStyle: {
            backgroundColor: theme.colors.backgroundPrimary,
            ...(headerHeight === undefined ? {} : { height: headerHeight }),
          },
          headerShadowVisible: false,
          headerTintColor: theme.colors.textPrimary,
          headerTitleStyle: {
            fontWeight: "700",
            fontSize: 18,
            letterSpacing: -0.4,
          },
          sceneStyle: { backgroundColor: theme.colors.backgroundPrimary },
          tabBarPosition: rail ? "left" : "bottom",
          /*
           * Material's rail: the icon on its pill with the label beneath.
           * TabIcon draws the pill, so the item itself is not tinted too.
           */
          tabBarVariant: rail ? "material" : "uikit",
          tabBarActiveBackgroundColor: rail ? "transparent" : undefined,
          tabBarStyle: rail ? railStyle : barStyle,
          tabBarActiveTintColor: theme.colors.actionPrimary,
          tabBarInactiveTintColor: theme.colors.textSecondary,
          tabBarShowLabel: true,
          tabBarLabelPosition: "below-icon",
          /*
           * The bottom bar would ride up on the keyboard, so it hides. A
           * rail sits beside the keyboard rather than on it, and hiding it
           * only made it stop answering taps while somebody typed.
           */
          tabBarHideOnKeyboard: !rail,
          tabBarButton: (props: BottomTabBarButtonProps) => {
            return (
              <PlatformPressable
                {...props}
                style={[
                  props.style,
                  { paddingHorizontal: 0 },
                  rail ? { paddingVertical: spacing.xs + 2 } : null,
                ]}
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
          tabBarItemStyle: rail
            ? {
                /*
                 * Five 62-point items fit a phone's landscape height (393
                 * points, less the home indicator) with room to spare.
                 */
                width: NAVIGATION_RAIL_WIDTH,
                minHeight: 56,
                marginVertical: spacing.xxs,
                paddingVertical: 0,
              }
            : {
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
    </SafeAreaInsetsContext.Provider>
  );
}
