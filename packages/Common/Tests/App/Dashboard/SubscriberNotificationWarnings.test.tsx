import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The warning on a status page's subscriber pages while the page hides an
 * event type it could notify about: a page that does not show incidents
 * (episodes, announcements, scheduled maintenance) does not notify its
 * subscribers about them either. It names what is hidden and links to the
 * one place those are switched: the "What your status page shows" card on
 * Advanced Settings (it used to send people to "Status Page Settings").
 */

const getItemMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
    },
  };
});

import SubscriberNotificationWarnings, {
  SubscriberNotificationWarningsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/StatusPage/SubscriberNotificationWarnings";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

let stored: Record<string, unknown> | null | Error = {};

beforeEach(() => {
  stored = {
    showIncidentsOnStatusPage: true,
    showEpisodesOnStatusPage: true,
    showAnnouncementsOnStatusPage: true,
    showScheduledMaintenanceEventsOnStatusPage: true,
  };

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    if (stored instanceof Error) {
      throw stored;
    }

    if (!stored) {
      return null;
    }

    const page: StatusPage = new StatusPage();
    page._id = STATUS_PAGE_ID;
    Object.assign(page, stored);
    return page;
  });

  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderWarnings(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <SubscriberNotificationWarnings
          statusPageId={new ObjectID(STATUS_PAGE_ID)}
        />
      </MemoryRouter>,
    );
  });

  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
}

function warning(): HTMLElement | null {
  return screen.queryByTestId("subscriber-notification-warnings");
}

describe("SubscriberNotificationWarnings", () => {
  test("asks for the four event types' switches of this page, and nothing else", async () => {
    await renderWarnings();

    expect(getItemMock).toHaveBeenCalledTimes(1);

    const request: Record<string, unknown> = getItemMock.mock
      .calls[0]![0] as Record<string, unknown>;

    expect(request["modelType"]).toBe(StatusPage);
    expect((request["id"] as ObjectID).toString()).toBe(STATUS_PAGE_ID);
    expect(request["select"]).toEqual({
      showIncidentsOnStatusPage: true,
      showEpisodesOnStatusPage: true,
      showAnnouncementsOnStatusPage: true,
      showScheduledMaintenanceEventsOnStatusPage: true,
    });
  });

  test("says nothing while the page shows all four", async () => {
    await renderWarnings();

    expect(warning()).not.toBeInTheDocument();
  });

  test("says nothing for a page that holds no value for them: each defaults to shown", async () => {
    stored = {};

    await renderWarnings();

    expect(warning()).not.toBeInTheDocument();
  });

  test("says nothing when the page cannot be read", async () => {
    stored = new Error("Request failed");

    await renderWarnings();

    expect(warning()).not.toBeInTheDocument();
  });

  test("names each hidden event type, in the order the card lists them", async () => {
    stored = {
      showIncidentsOnStatusPage: true,
      showEpisodesOnStatusPage: false,
      showAnnouncementsOnStatusPage: true,
      showScheduledMaintenanceEventsOnStatusPage: false,
    };

    await renderWarnings();

    const shown: HTMLElement = warning()!;

    expect(shown).toBeInTheDocument();
    expect(
      within(shown).getByText(SubscriberNotificationWarningsCopy.title),
    ).toBeInTheDocument();
    expect(
      within(shown).getByText(SubscriberNotificationWarningsCopy.description),
    ).toBeInTheDocument();
    expect(
      within(shown)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual(["Episodes", "Scheduled Maintenance"]);
  });

  test("lists all four when all four are hidden", async () => {
    stored = {
      showIncidentsOnStatusPage: false,
      showEpisodesOnStatusPage: false,
      showAnnouncementsOnStatusPage: false,
      showScheduledMaintenanceEventsOnStatusPage: false,
    };

    await renderWarnings();

    expect(
      within(warning()!)
        .getAllByRole("listitem")
        .map((item: HTMLElement): string => {
          return item.textContent || "";
        }),
    ).toEqual([
      "Incidents",
      "Episodes",
      "Announcements",
      "Scheduled Maintenance",
    ]);
  });

  test("links to Advanced Settings of this status page, where they are switched", async () => {
    stored = {
      showIncidentsOnStatusPage: false,
    };

    await renderWarnings();

    const link: HTMLElement = within(warning()!).getByRole("link", {
      name: SubscriberNotificationWarningsCopy.link,
    });

    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/status-pages/${STATUS_PAGE_ID}/settings`,
    );
    expect(warning()!).not.toHaveTextContent("Status Page Settings");
  });
});
