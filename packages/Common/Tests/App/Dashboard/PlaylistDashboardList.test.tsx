import { act, cleanup, render, screen } from "@testing-library/react";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { DashboardPlaylistDashboard } from "../../../Types/Dashboard/DashboardPlaylist";

/*
 * A playlist's dashboards on its page (issue #5235): in the order the
 * player shows them, numbered, each a link to its dashboard. One the
 * viewer cannot see, or one that is archived, is listed as such, so it is
 * plain why the player skips it.
 */

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyErrorMessage: (err: Error) => {
        return `Friendly: ${err.message}`;
      },
      getFriendlyMessage: (err: Error) => {
        return `Friendly: ${err.message}`;
      },
    },
  };
});

import PlaylistDashboardList, {
  PLAYLIST_DASHBOARD_LIST_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboardList";
import { PlaylistReadableDashboard } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";

const OVERVIEW: string = "db000000-0000-4000-8000-000000000001";
const CLUSTERS: string = "db000000-0000-4000-8000-000000000002";
const ARCHIVED: string = "db000000-0000-4000-8000-000000000004";
const HIDDEN: string = "db000000-0000-4000-8000-000000000005";

const READABLE: Array<PlaylistReadableDashboard> = [
  { id: CLUSTERS, name: "Kubernetes clusters", isArchived: false },
  { id: ARCHIVED, name: "Old checkout", isArchived: true },
  { id: OVERVIEW, name: "Production overview", isArchived: false },
];

function list(...ids: Array<string>): Array<DashboardPlaylistDashboard> {
  return ids.map((id: string): DashboardPlaylistDashboard => {
    return { dashboardId: id };
  });
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 4; turn++) {
      await Promise.resolve();
    }
  });
}

function items(): Array<HTMLElement> {
  return screen.queryAllByTestId(`${PLAYLIST_DASHBOARD_LIST_TEST_ID}-item`);
}

afterEach(() => {
  cleanup();
});

describe("a playlist's dashboards on its page", () => {
  test("lists them in the player's order, numbered, each a link to its dashboard", async () => {
    const asked: Array<Array<DashboardPlaylistDashboard>> = [];

    render(
      <PlaylistDashboardList
        dashboards={list(CLUSTERS, OVERVIEW, CLUSTERS)}
        readDashboards={(dashboards: Array<DashboardPlaylistDashboard>) => {
          asked.push(dashboards);
          return Promise.resolve(READABLE);
        }}
      />,
    );
    await settle();

    expect(
      items().map((item: HTMLElement): string => {
        return item.textContent || "";
      }),
    ).toEqual([
      "1Kubernetes clusters",
      "2Production overview",
      "3Kubernetes clusters",
    ]);

    const links: Array<HTMLElement> = screen.getAllByRole("link");

    expect(links).toHaveLength(3);
    expect(links[0]!.getAttribute("href")).toMatch(
      new RegExp(`/dashboards/${CLUSTERS}$`),
    );
    expect(links[1]!.getAttribute("href")).toMatch(
      new RegExp(`/dashboards/${OVERVIEW}$`),
    );
    // One read for the whole list, with the list as stored.
    expect(asked).toEqual([list(CLUSTERS, OVERVIEW, CLUSTERS)]);
  });

  test("says Loading in each row until the names are read", async () => {
    let answer: (value: Array<PlaylistReadableDashboard>) => void = () => {};

    render(
      <PlaylistDashboardList
        dashboards={list(OVERVIEW)}
        readDashboards={() => {
          return new Promise(
            (resolve: (value: Array<PlaylistReadableDashboard>) => void) => {
              answer = resolve;
            },
          );
        }}
      />,
    );

    expect(items()[0]).toHaveTextContent("Loading...");
    expect(screen.getByTestId(PLAYLIST_DASHBOARD_LIST_TEST_ID)).toHaveAttribute(
      "aria-busy",
      "true",
    );

    await act(async () => {
      answer(READABLE);
    });
    await settle();

    expect(items()[0]).toHaveTextContent("Production overview");
    expect(
      screen.getByTestId(PLAYLIST_DASHBOARD_LIST_TEST_ID),
    ).not.toHaveAttribute("aria-busy");
  });

  test("names a dashboard the viewer cannot see, and one that is archived, and says the player skips them", async () => {
    render(
      <PlaylistDashboardList
        dashboards={list(HIDDEN, ARCHIVED, OVERVIEW)}
        readDashboards={() => {
          return Promise.resolve(READABLE);
        }}
      />,
    );
    await settle();

    expect(items()[0]).toHaveTextContent(
      "Dashboard not availableDeleted, or you do not have access to it. The player skips it.",
    );
    // Not a link: there is nothing to open.
    expect(items()[0]!.querySelector("a")).toBeNull();
    expect(items()[1]).toHaveTextContent(
      "Old checkoutArchived. The player skips it until it is unarchived.",
    );
    expect(items()[2]).toHaveTextContent("Production overview");
    expect(items()[2]).not.toHaveTextContent("skips");
  });

  test("an empty playlist says how to add dashboards", async () => {
    render(
      <PlaylistDashboardList
        dashboards={[]}
        readDashboards={() => {
          return Promise.resolve([]);
        }}
      />,
    );
    await settle();

    expect(
      screen.getByTestId(`${PLAYLIST_DASHBOARD_LIST_TEST_ID}-empty`),
    ).toHaveTextContent("No dashboards yet. Edit the playlist to add them.");
    expect(screen.queryByTestId(PLAYLIST_DASHBOARD_LIST_TEST_ID)).toBeNull();
  });

  test("a failed read says why", async () => {
    render(
      <PlaylistDashboardList
        dashboards={list(OVERVIEW)}
        readDashboards={() => {
          return Promise.reject(new Error("The network is down."));
        }}
      />,
    );
    await settle();

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Friendly: The network is down.",
    );
  });

  test("reads again when the playlist's dashboards change, and not when the same list comes back", async () => {
    let reads: number = 0;
    const read: () => Promise<Array<PlaylistReadableDashboard>> = () => {
      reads++;
      return Promise.resolve(READABLE);
    };

    const view: ReturnType<typeof render> = render(
      <PlaylistDashboardList
        dashboards={list(OVERVIEW)}
        readDashboards={read}
      />,
    );
    await settle();

    view.rerender(
      <PlaylistDashboardList
        dashboards={list(OVERVIEW)}
        readDashboards={read}
      />,
    );
    await settle();
    expect(reads).toBe(1);

    view.rerender(
      <PlaylistDashboardList
        dashboards={list(OVERVIEW, CLUSTERS)}
        readDashboards={read}
      />,
    );
    await settle();

    expect(reads).toBe(2);
    expect(items()).toHaveLength(2);
  });
});
