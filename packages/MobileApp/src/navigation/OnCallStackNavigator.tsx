import React from "react";
import { Platform } from "react-native";
import { createAdaptiveStackNavigator } from "./createAdaptiveStackNavigator";
import { useStackScreenOptions } from "./useStackScreenOptions";
import { OnCallEmptyDetail } from "../screens/EmptyDetailScreens";
import OnCallOverviewScreen from "../screens/OnCallOverviewScreen";
import MyOnCallPoliciesScreen from "../screens/MyOnCallPoliciesScreen";
import WhoIsOnCallScreen from "../screens/WhoIsOnCallScreen";
import OnCallOverridesScreen from "../screens/OnCallOverridesScreen";
import CreateOnCallOverrideScreen from "../screens/CreateOnCallOverrideScreen";
import MyOnCallPagesScreen from "../screens/MyOnCallPagesScreen";
import OnCallCalendarFeedScreen from "../screens/OnCallCalendarFeedScreen";
import type { OnCallStackParamList } from "./types";

/*
 * Adaptive: on a wide window the overview stays on the left - am I on call,
 * my shifts - and the roster, pages, cover and policies open beside it.
 */
const Stack: ReturnType<
  typeof createAdaptiveStackNavigator<OnCallStackParamList>
> = createAdaptiveStackNavigator<OnCallStackParamList>();

/*
 * The cover form is a sheet over whatever it was opened from, never the
 * pane's content: opening it beside the roster keeps the roster beneath it.
 */
const OVERLAY_ROUTES: ReadonlyArray<keyof OnCallStackParamList> = [
  "CreateOnCallOverride",
];

export default function OnCallStackNavigator(): React.JSX.Element {
  const screenOptions: ReturnType<typeof useStackScreenOptions> =
    useStackScreenOptions();

  return (
    <Stack.Navigator
      screenOptions={screenOptions}
      emptyDetail={OnCallEmptyDetail}
      overlayRouteNames={OVERLAY_ROUTES}
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
      <Stack.Screen
        name="OnCallCalendarFeed"
        component={OnCallCalendarFeedScreen}
        options={{ title: "Calendar Feed" }}
      />
    </Stack.Navigator>
  );
}
