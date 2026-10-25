import React from "react";
import { useRoute, type RouteProp } from "@react-navigation/native";
import EmptyDetailPane from "../components/EmptyDetailPane";
import type { InboxStackParamList } from "../navigation/types";

/*
 * What each detail pane says before anything is opened in it, on a window
 * wide enough to show a list and its detail side by side.
 *
 * The title says what the pane holds right now - nothing selected - rather
 * than giving an order, because it must stay true when the list beside it is
 * empty or filtered to nothing ("Choose an incident" beside "No incidents"
 * asked for the impossible). One short line says how to fill it.
 *
 * On-Call has no placeholder: its overview is a menu as much as a list, so
 * its pane shows the team's roster until something else is opened
 * (OnCallStackNavigator).
 */

/** Beside the Inbox: an incident or an alert, depending on the tab. */
export function InboxEmptyDetail(): React.JSX.Element {
  const route: RouteProp<InboxStackParamList, "InboxList"> =
    useRoute<RouteProp<InboxStackParamList, "InboxList">>();
  const alerts: boolean = route.params?.initialView === "alerts";

  return (
    <EmptyDetailPane
      icon={alerts ? "notifications-outline" : "warning-outline"}
      title={alerts ? "No alert selected" : "No incident selected"}
      message="Choose one from the list to see it here."
    />
  );
}

/** Beside the monitor list. */
export function MonitorsEmptyDetail(): React.JSX.Element {
  return (
    <EmptyDetailPane
      icon="pulse-outline"
      title="No monitor selected"
      message="Choose one from the list to see its status and history here."
    />
  );
}
