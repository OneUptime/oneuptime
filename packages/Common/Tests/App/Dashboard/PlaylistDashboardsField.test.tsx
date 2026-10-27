import { act, cleanup, render, screen, within } from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import React from "react";
import { DashboardPlaylistDashboard } from "../../../Types/Dashboard/DashboardPlaylist";

/*
 * A playlist's Dashboards field (issue #5235), on the playlist's create and
 * edit forms: the dashboards in the order they are shown, numbered, each
 * with Move up, Move down and Remove, and under them a searchable picker of
 * the project's dashboards that adds one at the end. The field keeps an
 * entry its editor cannot see - deleted, or out of their reach - named as
 * such, so saving never drops a dashboard someone with more access put
 * there.
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

import PlaylistDashboardsField, {
  PLAYLIST_DASHBOARDS_FIELD_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboardsField";
import { PlaylistReadableDashboard } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Playlist/PlaylistDashboards";

const OVERVIEW: string = "db000000-0000-4000-8000-000000000001";
const CLUSTERS: string = "db000000-0000-4000-8000-000000000002";
const DATABASES: string = "db000000-0000-4000-8000-000000000003";
const ARCHIVED: string = "db000000-0000-4000-8000-000000000004";
const HIDDEN: string = "db000000-0000-4000-8000-000000000005";

const PROJECT_DASHBOARDS: Array<PlaylistReadableDashboard> = [
  { id: DATABASES, name: "Databases", isArchived: false },
  { id: CLUSTERS, name: "Kubernetes clusters", isArchived: false },
  { id: ARCHIVED, name: "Old checkout", isArchived: true },
  { id: OVERVIEW, name: "Production overview", isArchived: false },
];

function list(...ids: Array<string>): Array<DashboardPlaylistDashboard> {
  return ids.map((id: string): DashboardPlaylistDashboard => {
    return { dashboardId: id };
  });
}

interface Rendered {
  user: UserEvent;
  changes: Array<Array<DashboardPlaylistDashboard>>;
  rerender: (initialValue: unknown) => void;
}

async function settle(): Promise<void> {
  await act(async () => {
    for (let turn: number = 0; turn < 4; turn++) {
      await Promise.resolve();
    }
  });
}

async function renderField(
  initialValue: unknown,
  options: {
    dashboards?: Array<PlaylistReadableDashboard> | Error;
    error?: string;
  } = {},
): Promise<Rendered> {
  const changes: Array<Array<DashboardPlaylistDashboard>> = [];
  const dashboards: Array<PlaylistReadableDashboard> | Error =
    options.dashboards || PROJECT_DASHBOARDS;
  const read: () => Promise<Array<PlaylistReadableDashboard>> = () => {
    return dashboards instanceof Error
      ? Promise.reject(dashboards)
      : Promise.resolve(dashboards);
  };
  const element: (value: unknown) => React.ReactElement = (
    value: unknown,
  ): React.ReactElement => {
    return (
      <PlaylistDashboardsField
        initialValue={value as Array<DashboardPlaylistDashboard>}
        onChange={(next: Array<DashboardPlaylistDashboard>) => {
          changes.push(next);
        }}
        error={options.error}
        readDashboards={read}
      />
    );
  };

  const result: ReturnType<typeof render> = render(element(initialValue));

  await settle();

  return {
    user: userEvent.setup({ delay: null }),
    changes,
    rerender: (value: unknown): void => {
      result.rerender(element(value));
    },
  };
}

function rows(): Array<string> {
  return screen
    .queryAllByTestId(/^playlist-dashboard-\d+$/)
    .map((row: HTMLElement): string => {
      return row.querySelector("p")?.textContent || "";
    });
}

function lastChange(rendered: Rendered): Array<string> {
  return (rendered.changes[rendered.changes.length - 1] || []).map(
    (entry: DashboardPlaylistDashboard): string => {
      return entry.dashboardId;
    },
  );
}

async function pick(rendered: Rendered, name: string): Promise<void> {
  await rendered.user.click(
    screen.getByRole("combobox", { name: "Add a dashboard" }),
  );
  const options: Array<HTMLElement> = await screen.findAllByText(name, {
    exact: true,
  });
  await rendered.user.click(options[options.length - 1]!);
  await settle();
}

afterEach(() => {
  cleanup();
});

describe("the list", () => {
  test("shows the playlist's dashboards in order, numbered", async () => {
    await renderField(list(CLUSTERS, OVERVIEW, DATABASES));

    expect(rows()).toEqual([
      "Kubernetes clusters",
      "Production overview",
      "Databases",
    ]);
    const numbers: Array<string> = screen
      .getAllByTestId(/^playlist-dashboard-\d+$/)
      .map((row: HTMLElement): string => {
        return row.querySelector("span")?.textContent || "";
      });

    expect(numbers).toEqual(["1", "2", "3"]);
  });

  test("keeps a dashboard the editor cannot see, says why it is skipped, and lets it be removed", async () => {
    const rendered: Rendered = await renderField(list(OVERVIEW, HIDDEN));

    expect(rows()).toEqual(["Production overview", "Dashboard not available"]);
    expect(
      screen.getByText(
        "Deleted, or you do not have access to it. The player skips it.",
      ),
    ).toBeInTheDocument();
    // Reported as it was: nothing dropped on the way in.
    expect(lastChange(rendered)).toEqual([OVERVIEW, HIDDEN]);

    await rendered.user.click(
      screen.getByRole("button", { name: "Remove Dashboard not available" }),
    );

    expect(lastChange(rendered)).toEqual([OVERVIEW]);
  });

  test("says when a dashboard in it is archived", async () => {
    await renderField(list(ARCHIVED));

    expect(rows()).toEqual(["Old checkout"]);
    expect(
      screen.getByText("Archived. The player skips it until it is unarchived."),
    ).toBeInTheDocument();
  });

  test("an empty playlist says how to start", async () => {
    await renderField("");

    expect(screen.getByTestId("playlist-dashboards-empty")).toHaveTextContent(
      "No dashboards yet. Add the first one below.",
    );
    expect(screen.queryByTestId("playlist-dashboards-list")).toBeNull();
  });
});

describe("telling the form", () => {
  test("reports the list once as the field opens, so a create left as it is asks for a dashboard", async () => {
    const rendered: Rendered = await renderField("");

    expect(rendered.changes).toEqual([[]]);
  });

  test("takes the stored list the edit form reads after the field is on screen", async () => {
    const rendered: Rendered = await renderField("");

    await act(async () => {
      rendered.rerender(list(DATABASES, OVERVIEW));
    });
    await settle();

    expect(rows()).toEqual(["Databases", "Production overview"]);
  });

  test("its own last change coming back changes nothing", async () => {
    const rendered: Rendered = await renderField(list(OVERVIEW, CLUSTERS));

    await rendered.user.click(
      screen.getByRole("button", { name: "Move Kubernetes clusters up" }),
    );

    const changesBefore: number = rendered.changes.length;

    await act(async () => {
      rendered.rerender(list(CLUSTERS, OVERVIEW));
    });
    await settle();

    expect(rows()).toEqual(["Kubernetes clusters", "Production overview"]);
    expect(rendered.changes.length).toBe(changesBefore);
  });

  test("draws the form's error under the field", async () => {
    await renderField("", {
      error: "Add at least one dashboard to the playlist.",
    });

    expect(screen.getByTestId("error-message")).toHaveTextContent(
      "Add at least one dashboard to the playlist.",
    );
    expect(screen.getByTestId("error-message")).toHaveAttribute(
      "role",
      "alert",
    );
  });

  test("marks the picker - where a dashboard is added - invalid, and says the error once, as the form's other fields do", async () => {
    await renderField("", {
      error: "Add at least one dashboard to the playlist.",
    });

    expect(
      screen.getByRole("combobox", { name: "Add a dashboard" }),
    ).toHaveAttribute("aria-invalid", "true");
    expect(screen.getAllByTestId("error-message")).toHaveLength(1);
    // The colour every field's error line has (Input, Dropdown, Color).
    expect(screen.getByTestId("error-message").className).toContain(
      "text-red-400",
    );
  });

  test("without an error, the picker is not marked invalid", async () => {
    await renderField(list(OVERVIEW));

    expect(
      screen.getByRole("combobox", { name: "Add a dashboard" }),
    ).not.toHaveAttribute("aria-invalid", "true");
    expect(screen.queryByTestId("error-message")).toBeNull();
  });
});

describe("changing the order", () => {
  test("Move up and Move down swap a dashboard with its neighbour", async () => {
    const rendered: Rendered = await renderField(
      list(OVERVIEW, CLUSTERS, DATABASES),
    );

    await rendered.user.click(
      screen.getByRole("button", { name: "Move Databases up" }),
    );
    expect(rows()).toEqual([
      "Production overview",
      "Databases",
      "Kubernetes clusters",
    ]);
    expect(lastChange(rendered)).toEqual([OVERVIEW, DATABASES, CLUSTERS]);

    await rendered.user.click(
      screen.getByRole("button", { name: "Move Production overview down" }),
    );
    expect(lastChange(rendered)).toEqual([DATABASES, OVERVIEW, CLUSTERS]);
  });

  test("a row's buttons are grey-500, the 3:1 an icon-only control needs on white; a button that can't be pressed is faded", async () => {
    await renderField(list(OVERVIEW, CLUSTERS));

    for (const name of [
      "Move Production overview down",
      "Remove Production overview",
      "Move Kubernetes clusters up",
    ]) {
      const button: HTMLElement = screen.getByRole("button", { name });

      expect(button.className).toContain("text-gray-500");
      expect(button.className).not.toContain("text-gray-400");
      expect(button.className).not.toContain("opacity-40");
    }

    expect(
      screen.getByRole("button", { name: "Move Production overview up" })
        .className,
    ).toContain("opacity-40");
  });

  test("the first can't move up and the last can't move down", async () => {
    await renderField(list(OVERVIEW, CLUSTERS));

    expect(
      screen.getByRole("button", { name: "Move Production overview up" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Kubernetes clusters down" }),
    ).toBeDisabled();
    expect(
      screen.getByRole("button", { name: "Move Production overview down" }),
    ).toBeEnabled();
  });

  test("Remove takes out that one entry", async () => {
    const rendered: Rendered = await renderField(
      list(OVERVIEW, CLUSTERS, OVERVIEW),
    );

    const third: HTMLElement = screen.getByTestId("playlist-dashboard-2");

    await rendered.user.click(
      within(third).getByRole("button", { name: "Remove Production overview" }),
    );

    expect(lastChange(rendered)).toEqual([OVERVIEW, CLUSTERS]);
  });
});

describe("adding a dashboard", () => {
  test("the picker offers the project's dashboards not in the list yet, archived ones left out, and adds one at the end", async () => {
    const rendered: Rendered = await renderField(list(OVERVIEW));

    await rendered.user.click(
      screen.getByRole("combobox", { name: "Add a dashboard" }),
    );

    expect(await screen.findByText("Databases")).toBeInTheDocument();
    expect(screen.getAllByText("Kubernetes clusters").length).toBeGreaterThan(
      0,
    );
    // In the list already, or archived: not offered.
    expect(screen.getAllByText("Production overview")).toHaveLength(1);
    expect(screen.queryByText("Old checkout")).toBeNull();

    const options: Array<HTMLElement> = screen.getAllByText("Databases");
    await rendered.user.click(options[options.length - 1]!);
    await settle();

    expect(rows()).toEqual(["Production overview", "Databases"]);
    expect(lastChange(rendered)).toEqual([OVERVIEW, DATABASES]);
  });

  test("the picker opens empty again after each pick", async () => {
    const rendered: Rendered = await renderField(list());

    await pick(rendered, "Databases");
    await pick(rendered, "Kubernetes clusters");

    expect(lastChange(rendered)).toEqual([DATABASES, CLUSTERS]);
    expect(
      screen.getByRole("combobox", { name: "Add a dashboard" }),
    ).toHaveValue("");
  });

  test("says when every dashboard is in the list, or the project has none", async () => {
    await renderField(list(OVERVIEW, CLUSTERS, DATABASES));

    expect(
      screen.getByText("Every dashboard is in the list"),
    ).toBeInTheDocument();

    cleanup();

    await renderField(list(), { dashboards: [] });

    expect(
      screen.getByText("This project has no dashboards yet"),
    ).toBeInTheDocument();
  });

  test("stops at a hundred dashboards", async () => {
    await renderField(
      Array.from({ length: 100 }, () => {
        return { dashboardId: OVERVIEW };
      }),
    );

    expect(
      screen.getByText("A playlist shows at most 100 dashboards"),
    ).toBeInTheDocument();
  });

  test("a failed read of the project's dashboards says why, and keeps the list", async () => {
    await renderField(list(OVERVIEW), {
      dashboards: new Error("The network is down."),
    });

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Friendly: The network is down.",
    );
    expect(rows()).toEqual(["Dashboard not available"]);
  });
});

describe("the field's root", () => {
  test("carries its test id", async () => {
    await renderField("");

    expect(
      screen.getByTestId(PLAYLIST_DASHBOARDS_FIELD_TEST_ID),
    ).toBeInTheDocument();
  });
});
