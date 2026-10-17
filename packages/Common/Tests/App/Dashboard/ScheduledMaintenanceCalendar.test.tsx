/** @timezone UTC */

import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
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
 * Scheduled Maintenance > Events as a calendar (ScheduledMaintenanceCalendar),
 * rendered for real - react-big-calendar included - with the list request
 * answered by hand: what it asks for (the range the grid shows, on top of
 * the page's query), what it draws (each event a link to its page, the
 * states' colours named under the grid), Schedule maintenance on a day to
 * come, the error and its Try again, and an answer that comes back after a
 * newer request was sent being dropped.
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

import ScheduledMaintenanceCalendar, {
  ComponentProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ScheduledMaintenanceCalendar";
import { MAINTENANCE_CALENDAR_VIEW_LIMIT } from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/MaintenanceCalendarView";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import Route from "../../../Types/API/Route";
import GreaterThanOrEqual from "../../../Types/BaseDatabase/GreaterThanOrEqual";
import LessThanOrEqual from "../../../Types/BaseDatabase/LessThanOrEqual";
import Query from "../../../Types/BaseDatabase/Query";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";

const PROJECT_ID: ObjectID = new ObjectID(
  "79500000-0000-4000-8000-000000000001",
);

const NOW: Date = new Date("2026-10-15T10:20:00.000Z");

function state(
  name: string,
  color: string,
  order: number,
): ScheduledMaintenanceState {
  const model: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  model.id = new ObjectID(`79600000-0000-4000-8000-00000000000${order}`);
  model.name = name;
  model.color = new Color(color);
  model.order = order;
  return model;
}

const STATES: Array<ScheduledMaintenanceState> = [
  state("Scheduled", "#000000", 1),
  state("Ongoing", "#ffbf53", 2),
  state("Ended", "#4a4a4a", 3),
  state("Completed", "#2ab57d", 4),
];

function maintenance(data: {
  id: string;
  title: string;
  startsAt: string;
  endsAt: string;
  state: ScheduledMaintenanceState;
}): ScheduledMaintenance {
  const model: ScheduledMaintenance = new ScheduledMaintenance();
  model.id = new ObjectID(data.id);
  model.title = data.title;
  model.startsAt = new Date(data.startsAt);
  model.endsAt = new Date(data.endsAt);
  model.currentScheduledMaintenanceState = data.state;
  return model;
}

const UPGRADE: ScheduledMaintenance = maintenance({
  id: "79700000-0000-4000-8000-000000000001",
  title: "Database upgrade",
  startsAt: "2026-10-20T22:00:00.000Z",
  endsAt: "2026-10-20T23:00:00.000Z",
  state: STATES[0]!,
});

const PATCHING: ScheduledMaintenance = maintenance({
  id: "79700000-0000-4000-8000-000000000002",
  title: "Kernel patching",
  startsAt: "2026-10-15T09:00:00.000Z",
  endsAt: "2026-10-15T12:00:00.000Z",
  state: STATES[1]!,
});

interface Deferred {
  resolve: (events: Array<ScheduledMaintenance>) => void;
  reject: (error: Error) => void;
}

function answer(events: Array<ScheduledMaintenance>): void {
  getListMock.mockImplementation(async () => {
    return { data: events, count: events.length, skip: 0, limit: 500 };
  });
}

// Each request waits until the test answers it.
function holdRequests(): Array<Deferred> {
  const held: Array<Deferred> = [];

  getListMock.mockImplementation(() => {
    return new Promise((resolve: (value: unknown) => void, reject) => {
      held.push({
        resolve: (events: Array<ScheduledMaintenance>) => {
          resolve({ data: events, count: events.length, skip: 0, limit: 500 });
        },
        reject: reject as (error: Error) => void,
      });
    });
  });

  return held;
}

let navigateSpy: jest.SpiedFunction<typeof Navigation.navigate>;
let onSubscribe: jest.Mock<() => void>;

beforeEach(() => {
  getListMock.mockReset();
  onSubscribe = jest.fn();
  navigateSpy = jest.spyOn(Navigation, "navigate").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function props(overrides?: Partial<ComponentProps>): ComponentProps {
  return {
    query: { projectId: PROJECT_ID } as Query<ScheduledMaintenance>,
    states: STATES,
    title: "Scheduled Maintenance Events",
    description: "Every scheduled maintenance event of this project.",
    buttons: [],
    canCreate: true,
    getEventRoute: (maintenanceId: string) => {
      return new Route(
        `/dashboard/p/scheduled-maintenance-events/${maintenanceId}`,
      );
    },
    getCreateRoute: (startsAt: Date) => {
      return new Route(
        `/dashboard/p/scheduled-maintenance-events/create?startsAt=${startsAt.toISOString()}`,
      );
    },
    onSubscribe: onSubscribe,
    timezone: "UTC",
    now: NOW,
    ...overrides,
  };
}

function renderCalendar(overrides?: Partial<ComponentProps>): {
  rerender: (next?: Partial<ComponentProps>) => void;
} {
  const view: ReturnType<typeof render> = render(
    <MemoryRouter>
      <ScheduledMaintenanceCalendar {...props(overrides)} />
    </MemoryRouter>,
  );

  return {
    rerender: (next?: Partial<ComponentProps>) => {
      view.rerender(
        <MemoryRouter>
          <ScheduledMaintenanceCalendar {...props({ ...overrides, ...next })} />
        </MemoryRouter>,
      );
    },
  };
}

function lastRequest(): Record<string, any> {
  const calls: Array<Array<unknown>> = getListMock.mock.calls as Array<
    Array<unknown>
  >;
  return calls[calls.length - 1]![0] as Record<string, any>;
}

describe("ScheduledMaintenanceCalendar: what it asks for", () => {
  test("the month around today and the days either side, on top of the page's query, earliest first", async () => {
    answer([]);
    renderCalendar();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    const request: Record<string, any> = lastRequest();

    expect(request["query"]["projectId"]).toEqual(PROJECT_ID);
    expect(request["query"]["startsAt"]).toBeInstanceOf(LessThanOrEqual);
    expect(
      (request["query"]["startsAt"] as LessThanOrEqual<Date>).value,
    ).toEqual(new Date("2026-11-08T00:00:00.000Z"));
    expect(request["query"]["endsAt"]).toBeInstanceOf(GreaterThanOrEqual);
    expect(
      (request["query"]["endsAt"] as GreaterThanOrEqual<Date>).value,
    ).toEqual(new Date("2026-09-24T00:00:00.000Z"));
    expect(request["limit"]).toBe(MAINTENANCE_CALENDAR_VIEW_LIMIT);
    expect(request["sort"]).toEqual({ startsAt: "ASC" });
    expect(request["select"]["currentScheduledMaintenanceState"]).toEqual({
      _id: true,
      name: true,
      color: true,
    });
  });

  test("the next month when the reader moves to it", async () => {
    answer([]);
    renderCalendar();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    fireEvent.click(screen.getByText("Next"));

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    expect(
      (lastRequest()["query"]["endsAt"] as GreaterThanOrEqual<Date>).value,
    ).toEqual(new Date("2026-11-01T00:00:00.000Z"));
  });

  test("again when the filter chips change, and not when the page merely renders", async () => {
    answer([]);
    const view: { rerender: (next?: Partial<ComponentProps>) => void } =
      renderCalendar();

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(1);
    });

    // The page renders again with an equal query: nothing to ask.
    view.rerender({
      query: { projectId: PROJECT_ID } as Query<ScheduledMaintenance>,
    });

    await act(async () => {
      await Promise.resolve();
    });

    expect(getListMock).toHaveBeenCalledTimes(1);

    view.rerender({
      query: {
        projectId: PROJECT_ID,
        title: "upgrade",
      } as Query<ScheduledMaintenance>,
    });

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalledTimes(2);
    });

    expect(lastRequest()["query"]["title"]).toBe("upgrade");
  });
});

describe("ScheduledMaintenanceCalendar: what it draws", () => {
  test("each event a link to its page, named with its state", async () => {
    answer([UPGRADE, PATCHING]);
    renderCalendar();

    const links: Array<HTMLElement> = await screen.findAllByTestId(
      "scheduled-maintenance-calendar-event",
    );

    const upgrade: HTMLElement = links.find((link: HTMLElement) => {
      return link.textContent === "Database upgrade";
    })!;

    expect(upgrade).toHaveAttribute(
      "href",
      `/dashboard/p/scheduled-maintenance-events/${UPGRADE.id!.toString()}`,
    );
    expect(upgrade).toHaveAttribute(
      "aria-label",
      "Database upgrade, Scheduled",
    );
  });

  test("a click on a block (outside its link) opens the event too", async () => {
    answer([UPGRADE]);
    renderCalendar();

    const link: HTMLElement = await screen.findByTestId(
      "scheduled-maintenance-calendar-event",
    );

    fireEvent.click(link.closest(".rbc-event") as HTMLElement);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
      `/dashboard/p/scheduled-maintenance-events/${UPGRADE.id!.toString()}`,
    );
  });

  test("names the project's states by their colours under the grid", async () => {
    answer([UPGRADE]);
    renderCalendar();

    const legend: HTMLElement = await screen.findByTestId(
      "scheduled-maintenance-calendar-legend",
    );

    expect(
      within(legend)
        .getAllByRole("listitem")
        .map((item: HTMLElement) => {
          return item.textContent;
        }),
    ).toEqual(["Scheduled", "Ongoing", "Ended", "Completed"]);
  });

  test("with nothing in the period, says so instead of the colours", async () => {
    answer([]);
    renderCalendar();

    expect(
      await screen.findByTestId("scheduled-maintenance-calendar-empty"),
    ).toHaveTextContent("No scheduled maintenance in this period.");
    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-legend"),
    ).not.toBeInTheDocument();
  });

  test("says when it shows only the first events of a busy period", async () => {
    const many: Array<ScheduledMaintenance> = [];

    for (
      let index: number = 0;
      index < MAINTENANCE_CALENDAR_VIEW_LIMIT;
      index++
    ) {
      many.push(
        maintenance({
          id: `79800000-0000-4000-8000-${index.toString().padStart(12, "0")}`,
          title: `Window ${index}`,
          startsAt: "2026-10-20T22:00:00.000Z",
          endsAt: "2026-10-20T23:00:00.000Z",
          state: STATES[0]!,
        }),
      );
    }

    answer(many);
    renderCalendar();

    expect(
      await screen.findByTestId("scheduled-maintenance-calendar-truncated"),
    ).toHaveTextContent(
      `Showing the first ${MAINTENANCE_CALENDAR_VIEW_LIMIT} events in this period.`,
    );
  });

  test("Subscribe to calendar opens the team's link", async () => {
    answer([]);
    renderCalendar();

    fireEvent.click(
      await screen.findByTestId("scheduled-maintenance-calendar-subscribe"),
    );

    expect(onSubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("ScheduledMaintenanceCalendar: schedule maintenance on a day", () => {
  test("each day still to come has it, for whoever may create events; days that are over do not", async () => {
    answer([]);
    renderCalendar();

    const buttons: Array<HTMLElement> = await screen.findAllByTestId(
      "scheduled-maintenance-calendar-add",
    );

    // 15 October (today) to 31 October.
    expect(buttons).toHaveLength(17);
    expect(buttons[0]).toHaveAttribute(
      "aria-label",
      expect.stringContaining("Schedule maintenance on"),
    );
  });

  test("opens the create form with Starts At on that day, at the hour the form would pick", async () => {
    answer([]);
    renderCalendar();

    const buttons: Array<HTMLElement> = await screen.findAllByTestId(
      "scheduled-maintenance-calendar-add",
    );

    // The sixth day to come: 20 October.
    fireEvent.click(buttons[5]!);

    expect(navigateSpy).toHaveBeenCalledTimes(1);
    expect(navigateSpy.mock.calls[0]![0]!.toString()).toBe(
      "/dashboard/p/scheduled-maintenance-events/create?startsAt=2026-10-20T11:00:00.000Z",
    );
  });

  test("a reader who may not create events gets none", async () => {
    answer([]);
    renderCalendar({ canCreate: false });

    await screen.findByTestId("scheduled-maintenance-calendar-empty");

    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-add"),
    ).not.toBeInTheDocument();
  });
});

describe("ScheduledMaintenanceCalendar: errors and slow answers", () => {
  test("a request that fails says so, and Try again asks again", async () => {
    // The first request fails; every one after it is answered.
    answer([UPGRADE]);
    getListMock.mockImplementationOnce(async () => {
      throw new Error("The server is not answering.");
    });

    renderCalendar();

    const alert: HTMLElement = await screen.findByTestId(
      "scheduled-maintenance-calendar-error",
    );

    expect(alert).toHaveTextContent("Could not load the events.");

    fireEvent.click(within(alert).getByText("Try again"));

    expect(
      await screen.findByTestId("scheduled-maintenance-calendar-event"),
    ).toHaveTextContent("Database upgrade");
    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-error"),
    ).not.toBeInTheDocument();
  });

  test("an answer that comes back after a newer request was sent is dropped", async () => {
    const held: Array<Deferred> = holdRequests();

    renderCalendar();

    await waitFor(() => {
      expect(held).toHaveLength(1);
    });

    // The reader moves on before October is answered.
    fireEvent.click(screen.getByText("Next"));

    await waitFor(() => {
      expect(held).toHaveLength(2);
    });

    await act(async () => {
      held[1]!.resolve([]);
    });

    await act(async () => {
      held[0]!.resolve([UPGRADE]);
    });

    expect(
      screen.queryByTestId("scheduled-maintenance-calendar-event"),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId("scheduled-maintenance-calendar-empty"),
    ).toBeInTheDocument();
  });

  test("says it is loading while a request is under way", async () => {
    holdRequests();
    renderCalendar();

    expect(
      await screen.findByTestId("scheduled-maintenance-calendar-loading"),
    ).toHaveTextContent("Loading events...");
  });
});
