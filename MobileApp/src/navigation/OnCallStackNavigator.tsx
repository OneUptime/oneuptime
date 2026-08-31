import React from "react";
import { Platform } from "react-native";
import { createNativeStackNavigator } from "@react-navigation/native-stack";
import { useTheme } from "../theme";
import OnCallOverviewScreen from "../screens/OnCallOverviewScreen";
import MyOnCallPoliciesScreen from "../screens/MyOnCallPoliciesScreen";
import WhoIsOnCallScreen from "../screens/WhoIsOnCallScreen";
import OnCallOverridesScreen from "../screens/OnCallOverridesScreen";
import CreateOnCallOverrideScreen from "../screens/CreateOnCallOverrideScreen";
import MyOnCallPagesScreen from "../screens/MyOnCallPagesScreen";
import type { OnCallStackParamList } from "./types";

const Stack: ReturnType<
  typeof createNativeStackNavigator<OnCallStackParamList>
> = createNativeStackNavigator<OnCallStackParamList>();

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
        name="OnCallOverview"
        component={OnCallOverviewScreen}
        options={{ title: "On-Call" }}
      />
      <Stack.Screen
        name="OnCallList"
        component={MyOnCallPoliciesScreen}
        options={{ title: "My On-Call Policies" }}
      />
      <Stack.Screen
        name="WhoIsOnCall"
        component={WhoIsOnCallScreen}
        options={{ title: "Who's On Call" }}
      />
      <Stack.Screen
        name="OnCallOverrides"
        component={OnCallOverridesScreen}
        options={{ title: "Overrides" }}
      />
      <Stack.Screen
        name="CreateOnCallOverride"
        component={CreateOnCallOverrideScreen}
        options={{
          title: "New Override",

          /*
           * Presented as a sheet, not pushed. It is a short, abandonable task
           * started from three different places, and a modal is what makes
           * "changed my mind" a swipe rather than a navigation decision.
           */
          presentation: "modal",

          /*
           * Gated the way every other pushed screen in the app gates it:
           * headerLargeTitle is an iOS option, and handing Android a value it
           * ignores today is how it ends up being interpreted tomorrow.
           */
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
      <Stack.Screen
        name="MyOnCallPages"
        component={MyOnCallPagesScreen}
        options={{ title: "Pages Sent To Me" }}
      />
    </Stack.Navigator>
  );
}
