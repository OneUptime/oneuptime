import type { NavigatorScreenParams } from "@react-navigation/native";
import type { InboxStackParamList } from "./types";

type InboxDetailRouteName = Exclude<keyof InboxStackParamList, "InboxList">;

export type InboxDetailRoute = {
  [RouteName in InboxDetailRouteName]: {
    name: RouteName;
    params: InboxStackParamList[RouteName];
  };
}[InboxDetailRouteName];

type InboxListParams = NonNullable<InboxStackParamList["InboxList"]>;

const backDestinationByDetail: Record<
  InboxDetailRouteName,
  Pick<InboxListParams, "initialView" | "initialSegment">
> = {
  IncidentDetail: {
    initialView: "incidents",
    initialSegment: "incidents",
  },
  IncidentEpisodeDetail: {
    initialView: "incidents",
    initialSegment: "episodes",
  },
  AlertDetail: {
    initialView: "alerts",
    initialSegment: "alerts",
  },
  AlertEpisodeDetail: {
    initialView: "alerts",
    initialSegment: "episodes",
  },
};

/** Build an Inbox stack whose detail route always has a useful Back target. */
export function buildInboxDetailNavigation(
  detailRoute: InboxDetailRoute,
): NavigatorScreenParams<InboxStackParamList> {
  const backDestination: Pick<
    InboxListParams,
    "initialView" | "initialSegment"
  > = backDestinationByDetail[detailRoute.name];

  /*
   * Navigating to a nested detail does not rewrite an already-mounted
   * InboxList. Relying on that inactive list to observe the detail and repair
   * its own params makes Back depend on screen lifecycle timing. Supplying both
   * routes in one partial state is deterministic on cold and warm stacks and
   * also clears stale detail pages.
   */
  return {
    state: {
      stale: true,
      index: 1,
      routes: [
        {
          name: "InboxList",
          params: {
            ...backDestination,
            initialFilter: "all",
          },
        },
        detailRoute,
      ],
    },
  };
}
