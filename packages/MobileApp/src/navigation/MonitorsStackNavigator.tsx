import React from "react";
import { Platform } from "react-native";
import { createAdaptiveStackNavigator } from "./createAdaptiveStackNavigator";
import { useStackScreenOptions } from "./useStackScreenOptions";
import MonitorsScreen from "../screens/MonitorsScreen";
import MonitorDetailScreen from "../screens/MonitorDetailScreen";
import { MonitorsEmptyDetail } from "../screens/EmptyDetailScreens";
import type { MonitorsStackParamList } from "./types";

// Adaptive: the monitor list and the monitor opened from it, side by side on a wide window.
const Stack: ReturnType<
  typeof createAdaptiveStackNavigator<MonitorsStackParamList>
> = createAdaptiveStackNavigator<MonitorsStackParamList>();

export default function MonitorsStackNavigator(): React.JSX.Element {
  const screenOptions: ReturnType<typeof useStackScreenOptions> =
    useStackScreenOptions();

  return (
    <Stack.Navigator
      screenOptions={screenOptions}
      emptyDetail={MonitorsEmptyDetail}
    >
      <Stack.Screen
        name="MonitorsList"
        component={MonitorsScreen}
        options={{ title: "Monitors" }}
      />
      <Stack.Screen
        name="MonitorDetail"
        component={MonitorDetailScreen}
        options={{
          title: "Monitor",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
    </Stack.Navigator>
  );
}
