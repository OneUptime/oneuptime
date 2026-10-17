import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Subscribe to calendar on Scheduled Maintenance > Events: the team's
 * calendar link in a dialog (MaintenanceCalendarSubscribeModal).
 *
 * The link shows every event of the project, so what is asserted is as much
 * who gets what as what the buttons do: a reader of every event copies the
 * link, an editor publishes, regenerates and turns it off; a reader held to
 * some events is told why the link is not theirs - from a 200, since a 403
 * would send the Dashboard to its Forbidden page - with nothing to retry; a
 * server without the route says so. PermissionGate runs for real: only the
 * permission list is mocked.
 */

let permissionsForTest: Array<unknown> = [];

const getMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      get: (...args: Array<any>) => {
        return getMock(...args);
      },
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
      getFriendlyMessage: (error: unknown): string => {
        if (
          error &&
          typeof error === "object" &&
          "message" in (error as Record<string, unknown>)
        ) {
          return String((error as Record<string, unknown>)["message"]);
        }

        return "Something went wrong";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: (): Record<string, string> => {
        return {};
      },
      updateById: (...args: Array<any>) => {
        return updateByIdMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return permissionsForTest;
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): { globalPermissions: Array<unknown> } => {
        return { globalPermissions: [...permissionsForTest] };
      },
    },
  };
});

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: { defaultValue?: string }): string => {
          return options?.defaultValue ?? key;
        },
      };
    },
  };
});

import MaintenanceCalendarSubscribeModal, {
  MAINTENANCE_CALENDAR_DOCS_PATH,
  MAINTENANCE_CALENDAR_REFRESH_CADENCE_COPY,
  MAINTENANCE_LINK_OWNERSHIP_COPY,
  TEAM_FEED_CURRENT_PATH,
  TEAM_FEED_PUBLISH_PATH,
  TEAM_FEED_ROTATE_PATH,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarSubscribeModal";
import MaintenanceCalendarFeedAPI from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarFeedAPI";
import ScheduledMaintenanceCalendarFeed from "../../../Models/DatabaseModels/ScheduledMaintenanceCalendarFeed";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import Permission from "../../../Types/Permission";

const FEED_ID: string = "79900000-0000-4000-8000-000000000001";
const TOKEN: string = `maintenance${"A".repeat(32)}`;
const HTTPS_URL: string = `https://oneuptime.example.com/api/scheduled-maintenance-calendar/project/${TOKEN}/maintenance.ics`;
const WEBCAL_URL: string = HTTPS_URL.replace("https:", "webcal:");
const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

const REFUSED_REASON: string =
  "You can see only some of this project's scheduled maintenance events, so its calendar link, which shows every event, is not yours to use. Ask a project admin for access to every event.";

const EDITOR: Array<Permission> = [Permission.ScheduledMaintenanceAdmin];
const READER: Array<Permission> = [Permission.ScheduledMaintenanceViewer];

function statusJson(overrides?: JSONObject): JSONObject {
  return {
    exists: true,
    feedId: FEED_ID,
    isEnabled: true,
    needsRegeneration: false,
    tokenHint: "AAAA",
    rotatedAt: "2026-10-01T09:00:00.000Z",
    previousTokenExpiresAt: null,
    lastFetchedAt: "2026-10-15T09:00:00.000Z",
    lastFetchedClient: "Google Calendar",
    fetchCount: 12,
    lastRenderTruncated: false,
    settings: { pastDays: 90, futureDays: 365 },
    urls: {
      https: HTTPS_URL,
      webcal: WEBCAL_URL,
      googleAdd: `https://calendar.google.com/calendar/r?cid=${encodeURIComponent(WEBCAL_URL)}`,
    },
    hostWarning: null,
    protocolWarning: null,
    privateHost: null,
    refusedReason: null,
    ...overrides,
  };
}

const ABSENT_JSON: JSONObject = statusJson({
  exists: false,
  feedId: null,
  isEnabled: false,
  tokenHint: null,
  rotatedAt: null,
  lastFetchedAt: null,
  lastFetchedClient: null,
  fetchCount: 0,
  urls: null,
});

function ok(json: JSONObject): HTTPResponse<JSONObject> {
  return new HTTPResponse<JSONObject>(200, json, {});
}

function fail(status: number, message: string): HTTPErrorResponse {
  return new HTTPErrorResponse(status, { message: message }, {});
}

function urlOf(call: Array<unknown>): string {
  return String((call[0] as Record<string, unknown>)["url"]);
}

let onClose: Mock<() => void>;

function renderDialog(): void {
  render(<MaintenanceCalendarSubscribeModal onClose={onClose} now={NOW} />);
}

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  updateByIdMock.mockReset();
  updateByIdMock.mockResolvedValue(undefined);
  permissionsForTest = EDITOR;
  onClose = jest.fn<() => void>();
});

afterEach(() => {
  cleanup();
});

function openManageMenu(): HTMLElement {
  fireEvent.click(screen.getByRole("button", { name: "Manage link" }));

  return screen.getByRole("menu");
}

describe("MaintenanceCalendarFeedAPI.parse", () => {
  test("a reason is all a refused reader is told", () => {
    expect(
      MaintenanceCalendarFeedAPI.parse({
        ...statusJson(),
        refusedReason: REFUSED_REASON,
      }),
    ).toEqual({
      status: null,
      refusedReason: REFUSED_REASON,
      isUnsupported: false,
    });
  });

  test("otherwise the on-call links' status shape", () => {
    const read: ReturnType<typeof MaintenanceCalendarFeedAPI.parse> =
      MaintenanceCalendarFeedAPI.parse(statusJson());

    expect(read.refusedReason).toBeNull();
    expect(read.status?.exists).toBe(true);
    expect(read.status?.urls?.https).toBe(HTTPS_URL);
  });
});

describe("MaintenanceCalendarSubscribeModal: a published link", () => {
  test("reads the team link's /current, and offers it to subscribe to or copy", async () => {
    getMock.mockResolvedValue(ok(statusJson()));

    renderDialog();

    expect(
      await screen.findByTestId("maintenance-calendar-feed-active"),
    ).toBeInTheDocument();
    expect(urlOf(getMock.mock.calls[0] as Array<unknown>)).toContain(
      TEAM_FEED_CURRENT_PATH,
    );

    const links: HTMLElement = screen.getByTestId(
      "maintenance-calendar-feed-links",
    );

    expect(
      within(links).getByTestId("maintenance-calendar-feed-webcal"),
    ).toHaveAttribute("href", WEBCAL_URL);
    expect(
      within(links)
        .getByTestId("maintenance-calendar-feed-google")
        .getAttribute("href"),
    ).toContain("calendar.google.com");
    expect(
      screen.getByTestId("maintenance-calendar-feed-ownership"),
    ).toHaveTextContent(MAINTENANCE_LINK_OWNERSHIP_COPY);
  });

  test("says Google refreshes slowly in words about maintenance, and points to the maintenance calendar's docs", async () => {
    getMock.mockResolvedValue(ok(statusJson()));

    renderDialog();

    expect(
      await screen.findByTestId(
        "maintenance-calendar-feed-google-refresh-note",
      ),
    ).toHaveTextContent(MAINTENANCE_CALENDAR_REFRESH_CADENCE_COPY);

    const docs: HTMLAnchorElement = within(
      screen.getByTestId("maintenance-calendar-feed-docs-link"),
    ).getByRole("link") as HTMLAnchorElement;

    expect(docs.getAttribute("href")).toContain(MAINTENANCE_CALENDAR_DOCS_PATH);
  });

  test("an editor regenerates the link from the header's menu, after confirming", async () => {
    getMock.mockResolvedValue(ok(statusJson()));
    postMock.mockResolvedValue(
      ok(
        statusJson({
          urls: {
            https: HTTPS_URL.replace(TOKEN, `maintenance${"D".repeat(32)}`),
            webcal: WEBCAL_URL.replace(TOKEN, `maintenance${"D".repeat(32)}`),
            googleAdd: "https://calendar.google.com/calendar/r?cid=x",
          },
        }),
      ),
    );

    renderDialog();
    await screen.findByTestId("maintenance-calendar-feed-active");

    fireEvent.click(
      within(openManageMenu()).getByText("Regenerate link").closest("button")!,
    );

    fireEvent.click(
      within(screen.getByRole("dialog", { name: "Regenerate calendar link?" }))
        .getAllByText("Regenerate link")
        .pop()!
        .closest("button")!,
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      TEAM_FEED_ROTATE_PATH,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("maintenance-calendar-feed-webcal"),
      ).toHaveAttribute(
        "href",
        WEBCAL_URL.replace(TOKEN, `maintenance${"D".repeat(32)}`),
      );
    });
  });

  test("an editor disables the link through the model's own update", async () => {
    getMock.mockResolvedValue(ok(statusJson()));

    renderDialog();
    await screen.findByTestId("maintenance-calendar-feed-active");

    fireEvent.click(
      within(openManageMenu()).getByText("Disable link").closest("button")!,
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    const update: Record<string, any> = updateByIdMock.mock
      .calls[0]![0] as Record<string, any>;

    expect(update["modelType"]).toBe(ScheduledMaintenanceCalendarFeed);
    expect(update["id"].toString()).toBe(FEED_ID);
    expect(update["data"]).toEqual({ isEnabled: false });

    // And reads the link again.
    await waitFor(() => {
      expect(getMock).toHaveBeenCalledTimes(2);
    });
  });

  test("a reader of every event may copy the link; managing it is locked, with the permission named", async () => {
    permissionsForTest = READER;
    getMock.mockResolvedValue(ok(statusJson()));

    renderDialog();
    await screen.findByTestId("maintenance-calendar-feed-links");

    const menu: HTMLElement = openManageMenu();

    for (const label of ["Regenerate link", "Disable link"]) {
      const item: HTMLElement = within(menu)
        .getByText(label)
        .closest("button")!;

      expect(item).toHaveAttribute("aria-disabled", "true");
      // The reason is read with the item, and it names a permission.
      expect(
        document.getElementById(item.getAttribute("aria-describedby") || ""),
      ).toHaveTextContent("permission");
    }

    // A locked item does nothing.
    fireEvent.click(within(menu).getByText("Disable link").closest("button")!);
    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("a disabled link: the menu and the Status panel offer it back in the same words, Enable link", async () => {
    getMock.mockResolvedValue(ok(statusJson({ isEnabled: false })));

    renderDialog();
    await screen.findByTestId("maintenance-calendar-feed-active");

    // The panel's own button, under its Disabled badge.
    expect(
      screen.getByTestId("maintenance-calendar-feed-status-pill"),
    ).toHaveAttribute("data-health", "disabled");
    expect(
      screen.getByRole("button", { name: "Enable link" }),
    ).toBeInTheDocument();

    /*
     * The menu's item reads the same: the on-call links' words, not a
     * second pair of its own.
     */
    const menu: HTMLElement = openManageMenu();

    expect(within(menu).getByText("Enable link")).toBeInTheDocument();
    expect(within(menu).queryByText("Disable link")).not.toBeInTheDocument();
    expect(within(menu).queryByText("Turn on link")).not.toBeInTheDocument();

    fireEvent.click(within(menu).getByText("Enable link").closest("button")!);

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });

    expect(
      (updateByIdMock.mock.calls[0]![0] as Record<string, any>)["data"],
    ).toEqual({ isEnabled: true });
  });

  test("Done closes the dialog", async () => {
    getMock.mockResolvedValue(ok(statusJson()));

    renderDialog();
    await screen.findByTestId("maintenance-calendar-feed-active");

    fireEvent.click(screen.getByText("Done"));

    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("MaintenanceCalendarSubscribeModal: no link yet", () => {
  test("an editor publishes one", async () => {
    getMock.mockResolvedValue(ok(ABSENT_JSON));
    postMock.mockResolvedValue(ok(statusJson()));

    renderDialog();

    fireEvent.click(
      await screen.findByTestId("maintenance-calendar-feed-publish"),
    );

    await waitFor(() => {
      expect(postMock).toHaveBeenCalledTimes(1);
    });

    expect(urlOf(postMock.mock.calls[0] as Array<unknown>)).toContain(
      TEAM_FEED_PUBLISH_PATH,
    );
    expect(
      await screen.findByTestId("maintenance-calendar-feed-active"),
    ).toBeInTheDocument();
  });

  test("a reader who may not create events finds Publish locked", async () => {
    permissionsForTest = READER;
    getMock.mockResolvedValue(ok(ABSENT_JSON));

    renderDialog();

    expect(
      await screen.findByTestId("maintenance-calendar-feed-publish"),
    ).toBeDisabled();
  });

  test("a failed publish says why and keeps the dialog", async () => {
    getMock.mockResolvedValue(ok(ABSENT_JSON));
    postMock.mockResolvedValue(
      fail(400, "This project already has a calendar link."),
    );

    renderDialog();

    fireEvent.click(
      await screen.findByTestId("maintenance-calendar-feed-publish"),
    );

    expect(
      await screen.findByTestId("maintenance-calendar-feed-error"),
    ).toHaveTextContent("This project already has a calendar link.");
  });
});

describe("MaintenanceCalendarSubscribeModal: when the link is not to be had", () => {
  test("a reader held to some events is told why, with nothing to retry and no menu", async () => {
    getMock.mockResolvedValue(
      ok({ ...ABSENT_JSON, refusedReason: REFUSED_REASON }),
    );

    renderDialog();

    const restricted: HTMLElement = await screen.findByTestId(
      "maintenance-calendar-feed-restricted",
    );

    expect(restricted).toHaveTextContent(REFUSED_REASON);
    expect(screen.queryByText("Try again")).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Manage link" }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("maintenance-calendar-feed-links"),
    ).not.toBeInTheDocument();
  });

  test("a server without the route says it does not offer the link yet", async () => {
    getMock.mockResolvedValue(fail(404, "Not found"));

    renderDialog();

    expect(
      await screen.findByTestId("maintenance-calendar-feed-unsupported"),
    ).toHaveTextContent(
      "does not offer calendar links for scheduled maintenance",
    );
  });

  test("any other failure can be tried again", async () => {
    getMock.mockResolvedValueOnce(fail(500, "The server is not answering."));
    getMock.mockResolvedValue(ok(statusJson()));

    renderDialog();

    const error: HTMLElement = await screen.findByTestId(
      "maintenance-calendar-feed-load-error",
    );

    expect(error).toHaveTextContent("Could not load the calendar link.");

    fireEvent.click(within(error).getByText("Try again"));

    expect(
      await screen.findByTestId("maintenance-calendar-feed-active"),
    ).toBeInTheDocument();
  });
});
