import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import MyOnCallPoliciesScreen from "../screens/MyOnCallPoliciesScreen";
import type { OnCallStackParamList } from "./types";

const Stack: ReturnType<typeof createNativeStackNavigator<OnCallStackParamList>> =
  createNativeStackNavigator<OnCallStackParamList>();

export default function OnCallStackNavigator(): React.JSX.Element {
  const { theme } = useTheme();

  return (
    <Stack.Navigator
      screenOptions={{
        headerStyle: {
          backgroundColor: theme.colors.backgroundPrimary,
        },
        headerTintColor: theme.colors.textPrimary,
        headerShadowVisible: false,
        ...(Platform.OS === "ios"
          ? {
              headerLargeTitle: true,
              headerLargeStyle: {
                backgroundColor: theme.colors.backgroundPrimary,
              },
            }
          : {}),
      }}
    >
      <Stack.Screen
        name="OnCallList"
        component={MyOnCallPoliciesScreen}
        options={{ title: "My On-Call Policies" }}
      />
    </Stack.Navigator>
  );
}
