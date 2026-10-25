import React from "react";
import {
  useNavigation,
  useRoute,
  type RouteProp,
} from "@react-navigation/native";
import type { NativeStackNavigationProp } from "@react-navigation/native-stack";
import EmptyDetailPane from "../components/EmptyDetailPane";
import type {
  InboxStackParamList,
  OnCallStackParamList,
} from "../navigation/types";

/*
 * What each detail pane says before anything is opened in it, on a window
 * wide enough to show a list and its detail side by side.
 *
 * Each one names what will appear and how to get it there, in the words the
 * list beside it uses. They are drawn in the list's own place in the stack,
 * so anything they open is opened "from the list" and fills the pane.
 */

/** Beside the Inbox: an incident or an alert, depending on the tab. */
export function InboxEmptyDetail(): React.JSX.Element {
  const route: RouteProp<InboxStackParamList, "InboxList"> =
    useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const alerts: boolean = route.params?.initialView === "alerts";

  return (
    <EmptyDetailPane
      icon={alerts ? "notifications-outline" : "warning-outline"}
      title={alerts ? "Choose an alert" : "Choose an incident"}
      message={
        alerts
          ? "Open an alert or an episode from the list to respond to it here."
          : "Open an incident or an episode from the list to respond to it here."
      }
    />
  );
}

/** Beside the monitor list. */
export function MonitorsEmptyDetail(): React.JSX.Element {
  return (
    <EmptyDetailPane
      icon="pulse-outline"
      title="Choose a monitor"
      message="Open a monitor from the list to see its status and history here."
    />
  );
}

type OnCallNavigation = NativeStackNavigationProp<
  OnCallStackParamList,
  "OnCallOverview"
>;

/**
 * Beside the on-call overview. The overview is a menu as much as a list, so
 * the pane offers the three places people go from it most.
 */
export function OnCallEmptyDetail(): React.JSX.Element {
  const navigation: OnCallNavigation = useNavigation<OnCallNavigation>();

  return (
    <EmptyDetailPane
      icon="people-outline"
      title="Your team's on-call"
      message="Open the roster, your pages or your cover here, beside your shifts."
      shortcuts={[
        {
          label: "Who's on call",
          icon: "people-outline",
          testID: "detail-pane-shortcut-roster",
          onPress: (): void => {
            navigation.navigate("WhoIsOnCall");
          },
        },
        {
          label: "Pages sent to me",
          icon: "notifications-outline",
          testID: "detail-pane-shortcut-pages",
          onPress: (): void => {
            navigation.navigate("MyOnCallPages");
          },
        },
        {
          label: "Coverage & overrides",
          icon: "swap-horizontal-outline",
          testID: "detail-pane-shortcut-overrides",
          onPress: (): void => {
            navigation.navigate("OnCallOverrides");
          },
        },
      ]}
    />
  );
}
