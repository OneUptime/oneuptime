/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The Maintenance Calendar with the calendars from outside the project
 * (issue #5084), rendered for real - react-big-calendar included - with the
 * reads answered by hand per table:
 *
 *   - the enabled calendars are read once, for whoever may read them, and
 *     each gets a toggle under the grid in its colour;
 *   - the period's events of the shown calendars are read beside the
 *     project's own, and drawn as overlay blocks - striped, nothing to open;
 *   - a toggle hides a calendar's events and asks again without it, and the
 *     choice is kept in the reader's browser for the project;
 *   - a calendar's events failing to load never keeps the project's own
 *     events off the page;
 *   - a calendar OneUptime could not read lately says so with a mark.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, options?: unknown): string => {
          return (
            (options as { defaultValue?: string } | undefined)?.defaultValue ??
            key
          );
        },
        i18n: { language: "en" },
      };
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return "65000000-0000-4000-8000-000000000001";
      },
    },
  };
});

import ScheduledMaintenanceCalendar, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceCalendar";
import {
  MAINTENANCE_CALENDAR_OVERLAY_LIMIT,
  getHiddenCalendarsStorageKey,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarOverlays";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceExternalCalendar from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendar";
import ScheduledMaintenanceExternalCalendarEvent from "../../../Models/DatabaseModels/ScheduledMaintenanceExternalCalendarEvent";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Route from "../../../Types/API/Route";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import Includes from "../../../Types/BaseDatabase/Includes";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import Query from "../../../Types/BaseDatabase/Query";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import { OVERLAY_EVENT_CLASS_NAME } from "../../../UI/Components/Calendar/CalendarEventTone";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";

const PROJECT_ID: string = "65000000-0000-4000-8000-000000000001";
const HOLIDAYS_ID: string = "65000000-0000-4000-8000-000000000002";
const FREEZES_ID: string = "65000000-0000-4000-8000-000000000003";

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

const SCHEDULED: ScheduledMaintenanceState = new ScheduledMaintenanceState();
SCHEDULED.id = new ObjectID("65000000-0000-4000-8000-000000000010");
SCHEDULED.name = "Scheduled";
SCHEDULED.color = new Color("#000000");
SCHEDULED.order = 1;

function maintenance(): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance();
  model.id = new ObjectID("65000000-0000-4000-8000-000000000020");
  model.title = "Database upgrade";
  model.startsAt = new Date("2026-10-20T22:00:00.000Z");
  model.endsAt = new Date("2026-10-20T23:00:00.000Z");
  model.currentScheduledMaintenanceState = SCHEDULED;
  return model;
}

function externalCalendar(
  id: string,
  name: string,
  color: string,
  lastReadError?: string,
): ScheduledMaintenanceExternalCalendar {
  const model: ScheduledMaintenanceExternalCalendar =
    new ScheduledMaintenanceExternalCalendar();
  model._id = id;
  model.name = name;
  model.color = new Color(color);
  if (lastReadError) {
    model.lastReadError = lastReadError;
  }
  return model;
}

function externalEvent(data: {
  calendarId: string;
  title: string;
  startsAt: string;
  endsAt: string;
  isAllDay?: boolean;
}): ScheduledMaintenanceExternalCalendarEvent {
  const model: ScheduledMaintenanceExternalCalendarEvent =
    new ScheduledMaintenanceExternalCalendarEvent();
  model.scheduledMaintenanceExternalCalendarId = new ObjectID(data.calendarId);
  model.title = data.title;
  model.startsAt = new Date(data.startsAt);
  model.endsAt = new Date(data.endsAt);
  model.isAllDay = data.isAllDay === true;
  return model;
}

const HOLIDAY: ScheduledMaintenanceExternalCalendarEvent = externalEvent({
  calendarId: HOLIDAYS_ID,
  title: "Founders' Day",
  startsAt: "2026-10-05T00:00:00.000Z",
  endsAt: "2026-10-06T00:00:00.000Z",
  isAllDay: true,
});

const FREEZE: ScheduledMaintenanceExternalCalendarEvent = externalEvent({
  calendarId: FREEZES_ID,
  title: "Quarter-end change freeze",
  startsAt: "2026-10-29T00:00:00.000Z",
  endsAt: "2026-10-31T18:00:00.000Z",
});

interface World {
  calendars: Array<ScheduledMaintenanceExternalCalendar>;
  events: Array<ScheduledMaintenanceExternalCalendarEvent>;
  failEvents: boolean;
}

let world: World;
let gateSpy: SpyInstance<typeof PermissionGate.check>;

function requestsFor(tableName: string): Array<Record<string, any>> {
  return (getListMock.mock.calls as Array<Array<Record<string, any>>>)
    .map((call: Array<Record<string, any>>) => {
      return call[0]!;
    })
    .filter((request: Record<string, any>) => {
      return new request["modelType"]().tableName === tableName;
    });
}

function eventRequestedIds(request: Record<string, any>): Array<string> {
  return (
    request["query"]["scheduledMaintenanceExternalCalendarId"] as Includes
  ).values.map((id: unknown) => {
    return String(id);
  });
}

beforeEach(() => {
  window.localStorage.clear();
  getListMock.mockReset();

  world = {
    calendars: [
      externalCalendar(HOLIDAYS_ID, "Public holidays", "#0d9488"),
      externalCalendar(FREEZES_ID, "Change freezes", "#d97706", "NotFound"),
    ],
    events: [HOLIDAY, FREEZE],
    failEvents: false,
  };

  getListMock.mockImplementation(async (request: unknown) => {
    const options: Record<string, any> = request as Record<string, any>;
    const tableName: string = new options["modelType"]().tableName;

    if (tableName === "ScheduledMaintenance") {
      return { data: [maintenance()], count: 1, skip: 0, limit: 500 };
    }

    if (tableName === "ScheduledMaintenanceExternalCalendar") {
      return {
        data: world.calendars,
        count: world.calendars.length,
        skip: 0,
        limit: 100,
      };
    }

    if (tableName === "ScheduledMaintenanceExternalCalendarEvent") {
      if (world.failEvents) {
        throw new Error("The external calendars are not answering.");
      }

      const ids: Array<string> = eventRequestedIds(options);

      const data: Array<ScheduledMaintenanceExternalCalendarEvent> =
        world.events.filter(
          (item: ScheduledMaintenanceExternalCalendarEvent) => {
            return ids.includes(
              item.scheduledMaintenanceExternalCalendarId!.toString(),
            );
          },
        );

      return { data: data, count: data.length, skip: 0, limit: 500 };
    }

    return { data: [], count: 0, skip: 0, limit: 10 };
  });

  // Whoever reads the calendar here may read the external calendars too.
  const allowed: PermissionGateResult = { isAllowed: true };
  gateSpy = jest
    .spyOn(PermissionGate, "check")
    .mockImplementation((): PermissionGateResult => {
      return allowed;
    });

  jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  window.localStorage.clear();
});

function props(overrides?: Partial<ComponentProps>): ComponentProps {
  return {
    query: {
      projectId: new ObjectID(PROJECT_ID),
    } as Query<ScheduledMaintenance>,
    states: [SCHEDULED],
    title: "Maintenance Calendar",
    description: "Every scheduled maintenance event.",
    buttons: [],
    canCreate: false,
    getEventRoute: (maintenanceId: string) => {
      return new Route(
        `/dashboard/p/scheduled-maintenance-events/${maintenanceId}`,
      );
    },
    getCreateRoute: () => {
      return new Route("/dashboard/p/scheduled-maintenance-events/create");
    },
    onSubscribe: () => {},
    externalCalendarSettingsRoute: new Route(
      "/dashboard/p/scheduled-maintenance-events/settings/calendar",
    ),
    timezone: "UTC",
    now: NOW,
    ...overrides,
  };
}

function renderCalendar(overrides?: Partial<ComponentProps>): void {
  render(
    <MemoryRouter>
      <ScheduledMaintenanceCalendar {...props(overrides)} />
    </MemoryRouter>,
  );
}

function toggle(calendarId: string): HTMLElement {
  return screen
    .getAllByTestId("scheduled-maintenance-calendar-external-toggle")
    .find((element: HTMLElement) => {
      return element.getAttribute("data-calendar-id") === calendarId;
    })!;
}

function overlayTitles(): Array<string> {
  return screen
    .queryAllByTestId("scheduled-maintenance-calendar-overlay-event")
    .map((element: HTMLElement) => {
      return element.childNodes[0]?.textContent || "";
    });
}

describe("the external calendars on the calendar", () => {
  test("are read once - the enabled ones, by name - and each gets a toggle in its colour", async () => {
    renderCalendar();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("scheduled-maintenance-calendar-external-toggle"),
      ).toHaveLength(2);
    });

    const calendarReads: Array<Record<string, any>> = requestsFor(
      "ScheduledMaintenanceExternalCalendar",
    );

    expect(calendarReads).toHaveLength(1);
    expect(calendarReads[0]!["query"]).toEqual({ isEnabled: true });
    expect(calendarReads[0]!["sort"]).toEqual({ name: "ASC" });
    expect(Object.keys(calendarReads[0]!["select"])).not.toContain(
      "calendarUrl",
    );

    const group: HTMLElement = screen.getByTestId(
      "scheduled-maintenance-calendar-external",
    );

    expect(within(group).getByText("External calendars")).toBeInTheDocument();
    expect(toggle(HOLIDAYS_ID)).toHaveAttribute("aria-pressed", "true");
    expect(toggle(HOLIDAYS_ID)).toHaveTextContent("Public holidays");
    expect(
      (toggle(HOLIDAYS_ID).querySelector("span") as HTMLElement).style
        .backgroundColor,
    ).toBe("rgb(13, 148, 136)");
    expect(
      screen.getByTestId("scheduled-maintenance-calendar-external-settings"),
    ).toHaveAttribute(
      "href",
      "/dashboard/p/scheduled-maintenance-events/settings/calendar",
    );
  });

  test("their events for the period are read for the shown calendars, a day wider each side, and drawn as overlays", async () => {
    renderCalendar();

    await waitFor(() => {
      expect(overlayTitles()).toEqual(
        expect.arrayContaining(["Founders' Day", "Quarter-end change freeze"]),
      );
    });

    const eventReads: Array<Record<string, any>> = requestsFor(
      "ScheduledMaintenanceExternalCalendarEvent",
    );
    const read: Record<string, any> = eventReads[eventReads.length - 1]!;

    expect(eventRequestedIds(read).sort()).toEqual(
      [HOLIDAYS_ID, FREEZES_ID].sort(),
    );
    expect(read["limit"]).toBe(MAINTENANCE_CALENDAR_OVERLAY_LIMIT);
    expect((read["query"]["startsAt"] as LessThanOrEqual<Date>).value).toEqual(
      new Date("2026-11-09T00:00:00.000Z"),
    );
    expect((read["query"]["endsAt"] as GreaterThanOrEqual<Date>).value).toEqual(
      new Date("2026-09-23T00:00:00.000Z"),
    );

    // An overlay block: striped, with no link to open.
    const block: HTMLElement = screen
      .getAllByTestId("scheduled-maintenance-calendar-overlay-event")[0]!
      .closest(".rbc-event") as HTMLElement;

    expect(block).toHaveClass(OVERLAY_EVENT_CLASS_NAME);
    expect(block.querySelector("a")).toBeNull();

    // The project's own event is still there, as a link.
    expect(
      screen.getByTestId("scheduled-maintenance-calendar-event"),
    ).toHaveTextContent("Database upgrade");
  });

  test("an overlay says its calendar to a screen reader, and a click on it opens nothing", async () => {
    renderCalendar();

    await waitFor(() => {
      expect(overlayTitles()).toContain("Founders' Day");
    });

    const label: HTMLElement = screen
      .getAllByTestId("scheduled-maintenance-calendar-overlay-event")
      .find((element: HTMLElement) => {
        return element.textContent?.includes("Founders' Day");
      })!;

    expect(label).toHaveTextContent("Founders' Day (Public holidays)");
    expect(label.querySelector(".sr-only")).toHaveTextContent(
      "(Public holidays)",
    );

    fireEvent.click(label.closest(".rbc-event") as HTMLElement);

    expect(Navigation.navigate).not.toHaveBeenCalled();
  });

  test("hiding a calendar takes its events off, asks again without it, and is remembered for the project", async () => {
    renderCalendar();

    await waitFor(() => {
      expect(overlayTitles()).toContain("Quarter-end change freeze");
    });

    fireEvent.click(toggle(FREEZES_ID));

    await waitFor(() => {
      expect(overlayTitles()).not.toContain("Quarter-end change freeze");
    });

    expect(toggle(FREEZES_ID)).toHaveAttribute("aria-pressed", "false");
    expect(toggle(FREEZES_ID)).toHaveAccessibleName(
      "Show Change freezes on the calendar",
    );
    expect(overlayTitles()).toContain("Founders' Day");

    const eventReads: Array<Record<string, any>> = requestsFor(
      "ScheduledMaintenanceExternalCalendarEvent",
    );
    expect(eventRequestedIds(eventReads[eventReads.length - 1]!)).toEqual([
      HOLIDAYS_ID,
    ]);

    expect(
      JSON.parse(
        window.localStorage.getItem(getHiddenCalendarsStorageKey(PROJECT_ID))!,
      ),
    ).toEqual([FREEZES_ID]);

    // And back.
    fireEvent.click(toggle(FREEZES_ID));

    await waitFor(() => {
      expect(overlayTitles()).toContain("Quarter-end change freeze");
    });

    expect(
      window.localStorage.getItem(getHiddenCalendarsStorageKey(PROJECT_ID)),
    ).toBeNull();
  });

  test("a calendar the reader hid before is not asked for, and with every one hidden nothing is", async () => {
    window.localStorage.setItem(
      getHiddenCalendarsStorageKey(PROJECT_ID),
      JSON.stringify([HOLIDAYS_ID, FREEZES_ID]),
    );

    renderCalendar();

    await waitFor(() => {
      expect(
        screen.getAllByTestId("scheduled-maintenance-calendar-external-toggle"),
      ).toHaveLength(2);
    });

    expect(toggle(HOLIDAYS_ID)).toHaveAttribute("aria-pressed", "false");
    expect(requestsFor("ScheduledMaintenanceExternalCalendarEvent")).toEqual(
      [],
    );
    expect(overlayTitles()).toEqual([]);
  });

  test("a calendar that could not be read lately is marked, saying so", async () => {
    renderCalendar();

    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-maintenance-calendar-external-warning"),
      ).toBeInTheDocument();
    });

    expect(
      screen.getAllByTestId("scheduled-maintenance-calendar-external-warning"),
    ).toHaveLength(1);
    expect(
      screen.getByRole("img", {
        name: "Change freezes could not be read lately",
      }),
    ).toBeInTheDocument();
  });

  test("their events failing to load keeps the project's own on the page, with no error", async () => {
    world.failEvents = true;

    renderCalendar();

    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-maintenance-calendar-event"),
      ).toHaveTextContent("Database upgrade");
    });

    await waitFor(() => {
      expect(
        requestsFor("ScheduledMaintenanceExternalCalendarEvent").length,
      ).toBeGreaterThan(0);
    });

    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-error"),
    ).toBeNull();
    expect(overlayTitles()).toEqual([]);
  });

  test("a period with more of their events than one read takes says so", async () => {
    world.events = Array.from({
      length: MAINTENANCE_CALENDAR_OVERLAY_LIMIT,
    }).map((_value: unknown, index: number) => {
      return externalEvent({
        calendarId: HOLIDAYS_ID,
        title: `Shift ${index}`,
        startsAt: "2026-10-12T08:00:00.000Z",
        endsAt: "2026-10-12T09:00:00.000Z",
      });
    });

    renderCalendar();

    await waitFor(() => {
      expect(
        screen.getByTestId("scheduled-maintenance-calendar-overlay-truncated"),
      ).toHaveTextContent(
        `Showing the first ${MAINTENANCE_CALENDAR_OVERLAY_LIMIT} events of the external calendars in this period.`,
      );
    });
  });

  test("a project with none shows the calendar as it was: no toggles, no event reads", async () => {
    world.calendars = [];

    renderCalendar();

    await waitFor(() => {
      expect(requestsFor("ScheduledMaintenanceExternalCalendar")).toHaveLength(
        1,
      );
    });

    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-external"),
    ).toBeNull();
    expect(requestsFor("ScheduledMaintenanceExternalCalendarEvent")).toEqual(
      [],
    );
  });

  test("whoever may not read them is never asked for them", async () => {
    gateSpy.mockImplementation((model: unknown, actionAsked: unknown) => {
      return {
        isAllowed: !(
          model instanceof ScheduledMaintenanceExternalCalendar &&
          actionAsked === ModelAction.Read
        ),
      };
    });

    renderCalendar();

    await waitFor(() => {
      expect(requestsFor("ScheduledMaintenance")).toHaveLength(1);
    });

    expect(requestsFor("ScheduledMaintenanceExternalCalendar")).toEqual([]);
    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-external"),
    ).toBeNull();
  });
});
