import React from "react";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import IncidentEpisodesScreen from "../screens/IncidentEpisodesScreen";
import IncidentEpisodeDetailScreen from "../screens/IncidentEpisodeDetailScreen";
import type { IncidentEpisodesStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<IncidentEpisodesStackParamList>
> = createNativeStackNavigator<IncidentEpisodesStackParamList>();

export default function IncidentEpisodesStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundSecondary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
      }}
    >
      <Stack.Screen
        name="IncidentEpisodesList"
        component={IncidentEpisodesScreen}
        options={{ title: "Incident Episodes" }}
      />
      <Stack.Screen
        name="IncidentEpisodeDetail"
        component={IncidentEpisodeDetailScreen}
        options={{ title: "Episode" }}
      />
    </Stack.Navigator>
  );
}
