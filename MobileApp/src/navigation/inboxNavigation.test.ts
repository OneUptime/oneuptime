import { describe, expect, test } from "@jest/globals";
import {
  buildInboxDetailNavigation,
  type InboxDetailRoute,
} from "./inboxNavigation";

interface NavigationCase {
  title: string;
  detailRoute: InboxDetailRoute;
  initialView: "incidents" | "alerts";
  initialSegment: "incidents" | "alerts" | "episodes";
}

const navigationCases: Array<NavigationCase> = [
  {
    title: "incident",
    detailRoute: {
      name: "IncidentDetail",
      params: { incidentId: "incident-1", projectId: "project-1" },
    },
    initialView: "incidents",
    initialSegment: "incidents",
  },
  {
    title: "incident episode",
    detailRoute: {
      name: "IncidentEpisodeDetail",
      params: { episodeId: "incident-episode-1", projectId: "project-1" },
    },
    initialView: "incidents",
    initialSegment: "episodes",
  },
  {
    title: "alert",
    detailRoute: {
      name: "AlertDetail",
      params: { alertId: "alert-1", projectId: "project-1" },
    },
    initialView: "alerts",
    initialSegment: "alerts",
  },
  {
    title: "alert episode",
    detailRoute: {
      name: "AlertEpisodeDetail",
      params: { episodeId: "alert-episode-1", projectId: "project-1" },
    },
    initialView: "alerts",
    initialSegment: "episodes",
  },
];

describe("buildInboxDetailNavigation", () => {
  test.each(navigationCases)(
    "builds a two-route Back stack for an $title",
    ({ detailRoute, initialView, initialSegment }: NavigationCase): void => {
      expect(buildInboxDetailNavigation(detailRoute)).toEqual({
        state: {
          stale: true,
          index: 1,
          routes: [
            {
              name: "InboxList",
              params: {
                initialView,
                initialSegment,
                initialFilter: "all",
              },
            },
            detailRoute,
          ],
        },
      });
    },
  );

  test("returns fresh list state without mutating the supplied detail route", () => {
    const detailRoute: InboxDetailRoute = {
      name: "AlertDetail",
      params: { alertId: "alert-1", projectId: "project-1" },
    };

    const first: ReturnType<typeof buildInboxDetailNavigation> =
      buildInboxDetailNavigation(detailRoute);
    const second: ReturnType<typeof buildInboxDetailNavigation> =
      buildInboxDetailNavigation(detailRoute);

    expect(first).not.toBe(second);
    expect(first.state).not.toBe(second.state);
    expect(detailRoute).toEqual({
      name: "AlertDetail",
      params: { alertId: "alert-1", projectId: "project-1" },
    });
  });
});
