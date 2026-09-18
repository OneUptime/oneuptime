import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useStackScreenOptions } from "./useStackScreenOptions";
import SettingsScreen from "../screens/SettingsScreen";
import ProjectsScreen from "../screens/settings/ProjectsScreen";
import SSOProviderSelectScreen from "../screens/settings/SSOProviderSelectScreen";
import OnCallCalendarFeedScreen from "../screens/OnCallCalendarFeedScreen";
import type { SettingsStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<SettingsStackParamList>
> = createNativeStackNavigator<SettingsStackParamList>();

export default function SettingsStackNavigator(): React.JSX.Element {
  const screenOptions: ReturnType<typeof useStackScreenOptions> =
    useStackScreenOptions();

  return (
    <Stack.Navigator screenOptions={screenOptions}>
      <Stack.Screen
        name="SettingsList"
        component={SettingsScreen}
        options={{ title: "Settings" }}
      />
      <Stack.Screen
        name="ProjectsList"
        component={ProjectsScreen}
        options={{ title: "Projects" }}
      />
      <Stack.Screen
        name="SSOProviderSelect"
        component={SSOProviderSelectScreen}
        options={{ title: "SSO Login" }}
      />
      <Stack.Screen
        name="OnCallCalendarFeed"
        component={OnCallCalendarFeedScreen}
        options={{ title: "Calendar Feed" }}
      />
    </Stack.Navigator>
  );
}
