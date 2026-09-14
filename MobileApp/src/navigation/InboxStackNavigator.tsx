import React, { useContext } from "react";
import { NavigationRouteContext } from "@react-navigation/native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import InboxScreen from "../screens/InboxScreen";
import IncidentDetailScreen from "../screens/IncidentDetailScreen";
import IncidentEpisodeDetailScreen from "../screens/IncidentEpisodeDetailScreen";
import AlertDetailScreen from "../screens/AlertDetailScreen";
import AlertEpisodeDetailScreen from "../screens/AlertEpisodeDetailScreen";
import { useStackScreenOptions } from "./useStackScreenOptions";
import type { InboxStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<InboxStackParamList>
> = createNativeStackNavigator<InboxStackParamList>();

export default function InboxStackNavigator(): React.JSX.Element {
  const screenOptions: ReturnType<typeof useStackScreenOptions> =
    useStackScreenOptions();
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
    <Stack.Navigator initialRouteName="InboxList" screenOptions={screenOptions}>
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
