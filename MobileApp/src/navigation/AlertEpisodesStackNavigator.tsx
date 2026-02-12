import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import AlertEpisodesScreen from "../screens/AlertEpisodesScreen";
import AlertEpisodeDetailScreen from "../screens/AlertEpisodeDetailScreen";
import type { AlertEpisodesStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<AlertEpisodesStackParamList>
> = createNativeStackNavigator<AlertEpisodesStackParamList>();

export default function AlertEpisodesStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="AlertEpisodesList"
        component={AlertEpisodesScreen}
        options={{ title: "Alert Episodes" }}
      />
      <Stack.Screen
        name="AlertEpisodeDetail"
        component={AlertEpisodeDetailScreen}
        options={{ title: "Episode" }}
      />
    </Stack.Navigator>
  );
}
