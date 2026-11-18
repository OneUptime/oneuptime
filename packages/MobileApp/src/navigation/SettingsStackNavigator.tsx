import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useStackScreenOptions } from "./useStackScreenOptions";
import SettingsScreen from "../screens/SettingsScreen";
import ProjectsScreen from "../screens/settings/ProjectsScreen";
import SSOProviderSelectScreen from "../screens/settings/SSOProviderSelectScreen";
import OnCallCalendarFeedScreen from "../screens/OnCallCalendarFeedScreen";
import CriticalAlertSoundScreen from "../screens/settings/CriticalAlertSoundScreen";
import GetReadyScreen from "../screens/GetReadyScreen";
import { GET_READY_TEXT } from "../onboarding/getReady";
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
        options={{ title: "Sign In with SSO" }}
      />
      <Stack.Screen
        name="OnCallCalendarFeed"
        component={OnCallCalendarFeedScreen}
        options={{ title: "Calendar Feed" }}
      />
      <Stack.Screen
        name="CriticalAlertSound"
        component={CriticalAlertSoundScreen}
        options={{ title: "Alarm Sound" }}
      />
      <Stack.Screen
        name="GetReady"
        component={GetReadyScreen}
        options={{ title: GET_READY_TEXT.screenTitle }}
      />
    </Stack.Navigator>
  );
}
