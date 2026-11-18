import React from "react";
import { Platform } from "react-native";
import { createAdaptiveStackNavigator } from "./createAdaptiveStackNavigator";
import { useStackScreenOptions } from "./useStackScreenOptions";
import OnCallOverviewScreen from "../screens/OnCallOverviewScreen";
import MyOnCallPoliciesScreen from "../screens/MyOnCallPoliciesScreen";
import WhoIsOnCallScreen from "../screens/WhoIsOnCallScreen";
import OnCallOverridesScreen from "../screens/OnCallOverridesScreen";
import CreateOnCallOverrideScreen from "../screens/CreateOnCallOverrideScreen";
import EditOnCallOverrideScreen from "../screens/EditOnCallOverrideScreen";
import MyOnCallPagesScreen from "../screens/MyOnCallPagesScreen";
import OnCallCalendarFeedScreen from "../screens/OnCallCalendarFeedScreen";
import TestPageScreen from "../screens/TestPageScreen";
import GetReadyScreen from "../screens/GetReadyScreen";
import { TEST_PAGE_TEXT } from "../oncall/testPage";
import { GET_READY_TEXT } from "../onboarding/getReady";
import type { OnCallStackParamList } from "./types";

/*
 * Adaptive: on a wide window the overview stays on the left - am I on call,
 * my shifts - and the roster, pages, cover and policies open beside it.
 *
 * Until one is opened, the pane shows the team's roster rather than a
 * placeholder. The overview answers "am I on call?"; the next thing a
 * responder asks is "who else is on?", and the overview is a menu as much
 * as a list, so a pane asking them to choose would only repeat its tiles.
 * The roster's tile is marked as the one showing.
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
  "EditOnCallOverride",
  // A test page opened from its push, over the roster beside it.
  "TestPage",
  // The app's first steps (#7041), over whatever is open.
  "GetReady",
];

export default function OnCallStackNavigator(): React.JSX.Element {
  const screenOptions: ReturnType<typeof useStackScreenOptions> =
    useStackScreenOptions();

  return (
    <Stack.Navigator
      screenOptions={screenOptions}
      emptyDetail={WhoIsOnCallScreen}
      emptyDetailRouteName="WhoIsOnCall"
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
        name="EditOnCallOverride"
        component={EditOnCallOverrideScreen}
        options={{
          title: "Edit Override",

          // A sheet, as the cover form it mirrors (#7897).
          presentation: "modal",
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
      {/*
       * A test page's own screen (oncall/testPage.ts), opened from its
       * push: never from a list, so it is a sheet over whatever is open,
       * and Done - or a swipe - takes it away.
       */}
      <Stack.Screen
        name="TestPage"
        component={TestPageScreen}
        options={{
          title: TEST_PAGE_TEXT.screenTitle,
          presentation: "modal",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
      {/*
       * The app's first steps (#7041), opened by itself once on a new
       * install's first launch: a sheet, so Not Now - or a swipe - puts it
       * away, and a test page's own sheet opens over it.
       */}
      <Stack.Screen
        name="GetReady"
        component={GetReadyScreen}
        options={{
          title: GET_READY_TEXT.screenTitle,
          presentation: "modal",
          ...(Platform.OS === "ios" ? { headerLargeTitle: false } : {}),
        }}
      />
    </Stack.Navigator>
  );
}
