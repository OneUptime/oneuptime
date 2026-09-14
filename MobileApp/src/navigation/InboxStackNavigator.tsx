import React, { useContext } from "react";
import { Platform } from "react-native";
import { NavigationRouteContext } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import ProjectSwitcher from "../components/ProjectSwitcher";
import InboxScreen from "../screens/InboxScreen";
import IncidentDetailScreen from "../screens/IncidentDetailScreen";
import IncidentEpisodeDetailScreen from "../screens/IncidentEpisodeDetailScreen";
import AlertDetailScreen from "../screens/AlertDetailScreen";
import AlertEpisodeDetailScreen from "../screens/AlertEpisodeDetailScreen";
import { useTheme } from "../theme";
import type { InboxStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<InboxStackParamList>
> = createNativeStackNavigator<InboxStackParamList>();

export default function InboxStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();
  const parentRoute: React.ContextType<typeof NavigationRouteContext> =
    useContext(NavigationRouteContext);
  const incomingScreen: string | undefined = (
    parentRoute?.params as { screen?: string } | undefined
  )?.screen;
  // Native stacks may defer mounting the list until Back on a cold detail entry.
  const incomingCategory: "incidents" | "alerts" | null =
    incomingScreen?.startsWith("Alert")
      ? "alerts"
      : incomingScreen?.startsWith("Incident")
        ? "incidents"
        : null;
  const initialParams: InboxStackParamList["InboxList"] = incomingCategory
    ? {
        initialView: incomingCategory,
        initialSegment: incomingScreen?.includes("Episode")
          ? "episodes"
          : incomingCategory,
      }
    : undefined;

  return (
    <Stack.Navigator
      initialRouteName="InboxList"
      screenOptions={{
        headerTitle: () => {
          return <ProjectSwitcher />;
        },
        headerStyle: { backgroundColor: theme.colors.backgroundSecondary },
        headerTintColor: theme.colors.actionPrimary,
        headerShadowVisible: false,
        ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        headerBackButtonDisplayMode: "minimal",
        contentStyle: { backgroundColor: theme.colors.backgroundPrimary },
      }}
    >
      <Stack.Screen
        name="InboxList"
        component={InboxScreen}
        initialParams={initialParams}
        options={{ title: "Inbox" }}
      />
      <Stack.Screen
        name="IncidentDetail"
        component={IncidentDetailScreen}
        options={{ title: "Incident" }}
      />
      <Stack.Screen
        name="IncidentEpisodeDetail"
        component={IncidentEpisodeDetailScreen}
        options={{ title: "Incident group" }}
      />
      <Stack.Screen
        name="AlertDetail"
        component={AlertDetailScreen}
        options={{ title: "Alert" }}
      />
      <Stack.Screen
        name="AlertEpisodeDetail"
        component={AlertEpisodeDetailScreen}
        options={{ title: "Alert group" }}
      />
    </Stack.Navigator>
  );
}
