import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Home's "Upcoming maintenance" card (Components/Home/UpcomingMaintenance.tsx):
 * the next three windows, soonest first. An event is upcoming while it waits
 * for its Starts At - in the scheduled state, or a state of the project's
 * own placed after Scheduled and before Ongoing - the events its status
 * pages list as upcoming. With nothing coming up the card is left out.
 */

const getListMock: MockFunction = getJestMockFunction();
const cacheListMock: MockFunction = getJestMockFunction();

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
        i18n: { language: language },
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

jest.mock("../../../UI/Utils/ModelListCache", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return cacheListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        return currentProjectId;
      },
    },
  };
});

import UpcomingMaintenance, {
  formatCalendarPart,
  UPCOMING_MAINTENANCE_LIMIT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/UpcomingMaintenance";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import RouteMap from "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

let language: string = "en";

const PROJECT_ID: string = "65f00000000000000000cccc";
let currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

const NOW: Date = new Date("2026-10-13T12:00:00.000Z");
const HOUR: number = 60 * 60 * 1000;
const DAY: number = 24 * HOUR;

// Scheduled, a state of the project's own before Ongoing, then the rest.
const SCHEDULED: string = "65f000000000000000000021";
const CONFIRMED: string = "65f000000000000000000022";
const ONGOING: string = "65f000000000000000000023";
const ENDED: string = "65f000000000000000000024";
const COMPLETED: string = "65f000000000000000000025";

interface StateRow {
  id: ObjectID;
  _id: string;
  order: number;
  isScheduledState: boolean;
  isOngoingState: boolean;
  isEndedState: boolean;
  isResolvedState: boolean;
}

function stateRow(
  id: string,
  order: number,
  flag: keyof Omit<StateRow, "id" | "_id" | "order"> | null,
): StateRow {
  return {
    id: new ObjectID(id),
    _id: id,
    order,
    isScheduledState: flag === "isScheduledState",
    isOngoingState: flag === "isOngoingState",
    isEndedState: flag === "isEndedState",
    isResolvedState: flag === "isResolvedState",
  };
}

const STATES: Array<StateRow> = [
  stateRow(SCHEDULED, 1, "isScheduledState"),
  stateRow(CONFIRMED, 2, null),
  stateRow(ONGOING, 3, "isOngoingState"),
  stateRow(ENDED, 4, "isEndedState"),
  stateRow(COMPLETED, 5, "isResolvedState"),
];

let states: Array<StateRow> = STATES;

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
}

let listRequests: Array<ListRequest> = [];
let events: Array<ScheduledMaintenance> = [];
let failList: boolean = false;

function event(
  number: number,
  title: string,
  startsAt: Date,
): ScheduledMaintenance {
  return Object.assign(new ScheduledMaintenance(), {
    _id: `65f0000000000000000c${String(number).padStart(4, "0")}`,
    title,
    startsAt,
    endsAt: new Date(startsAt.getTime() + 2 * HOUR),
  });
}

beforeEach(() => {
  language = "en";
  currentProjectId = new ObjectID(PROJECT_ID);
  states = STATES;
  listRequests = [];
  failList = false;
  events = [
    event(1, "Kubernetes 1.31 upgrade", new Date(NOW.getTime() + 2 * DAY)),
    event(2, "CDN provider migration", new Date(NOW.getTime() + 6 * DAY)),
  ];
  cacheListMock.mockImplementation(() => {
    return Promise.resolve({
      data: states,
      count: states.length,
      skip: 0,
      limit: states.length,
    });
  });
  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: ListRequest = args[0] as ListRequest;
    listRequests.push(request);
    if (failList) {
      return Promise.reject(new Error("You may not read maintenance."));
    }
    return Promise.resolve({
      data: events.slice(0, request.limit),
      count: events.length,
      skip: 0,
      limit: request.limit,
    });
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
  cacheListMock.mockReset();
});

async function renderCard(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <UpcomingMaintenance projectId={new ObjectID(PROJECT_ID)} now={NOW} />
      </MemoryRouter>,
    );
  });
}

describe("what is upcoming", () => {
  test("events waiting for their Starts At: Scheduled, and a state of the project's own before Ongoing", async () => {
    await renderCard();

    await waitFor(() => {
      expect(listRequests).toHaveLength(1);
    });
    const request: ListRequest = listRequests[0]!;

    expect(request.modelType).toBe(ScheduledMaintenance);
    expect(request.query["currentScheduledMaintenanceStateId"]).toBeInstanceOf(
      Includes,
    );
    expect(
      (
        request.query["currentScheduledMaintenanceStateId"] as Includes
      ).values.map((value: unknown): string => {
        return String(value);
      }),
    ).toEqual([SCHEDULED, CONFIRMED]);
  });

  test("soonest first, three at most", async () => {
    await renderCard();

    await waitFor(() => {
      expect(listRequests).toHaveLength(1);
    });
    expect(listRequests[0]!.sort).toEqual({ startsAt: SortOrder.Ascending });
    expect(listRequests[0]!.limit).toBe(UPCOMING_MAINTENANCE_LIMIT);
    expect(UPCOMING_MAINTENANCE_LIMIT).toBe(3);
  });

  test("a project whose states have no waiting one asks for nothing, and shows nothing", async () => {
    states = STATES.filter((state: StateRow): boolean => {
      return state._id !== SCHEDULED && state._id !== CONFIRMED;
    });

    await renderCard();

    await waitFor(() => {
      expect(cacheListMock).toHaveBeenCalled();
    });
    expect(listRequests).toHaveLength(0);
    await waitFor(() => {
      expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();
    });
  });
});

describe("the card", () => {
  test("each event: its title, when it starts and the day as a calendar leaf, opening the event", async () => {
    await renderCard();

    await waitFor(() => {
      expect(screen.getAllByTestId("home-upcoming-row")).toHaveLength(2);
    });
    const [first]: Array<HTMLElement> =
      screen.getAllByTestId("home-upcoming-row");

    expect(first).toHaveTextContent("Kubernetes 1.31 upgrade");
    expect(first).toHaveTextContent("Starts in 2 days");
    expect(first).toHaveTextContent(
      formatCalendarPart({
        date: new Date(NOW.getTime() + 2 * DAY),
        part: "month",
        language: "en",
      }),
    );
    expect(first!.closest("a")?.getAttribute("href")).toBe(
      RouteMap[PageMap.SCHEDULED_MAINTENANCE_VIEW]!.toString()
        .replace(":projectId", PROJECT_ID)
        .replace(":id", events[0]!._id!.toString()),
    );
  });

  test("View all opens the scheduled maintenance list", async () => {
    await renderCard();

    await waitFor(() => {
      expect(screen.getByTestId("home-upcoming-view-all")).toBeVisible();
    });
    expect(
      screen
        .getByTestId("home-upcoming-view-all")
        .closest("a")
        ?.getAttribute("href"),
    ).toBe(
      RouteMap[PageMap.SCHEDULED_MAINTENANCE_EVENTS]!.toString().replace(
        ":projectId",
        PROJECT_ID,
      ),
    );
  });

  test("an event still waiting after its time says it was due", async () => {
    events = [
      event(3, "Payments provider window", new Date(NOW.getTime() - HOUR)),
    ];
    await renderCard();

    await waitFor(() => {
      expect(screen.getByTestId("home-upcoming-row")).toHaveTextContent(
        "Due to start 1 hour ago",
      );
    });
  });

  test("nothing coming up: the card is left out", async () => {
    events = [];
    await renderCard();

    await waitFor(() => {
      expect(listRequests).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();
    });
  });

  test("a role that may not read maintenance: the card is left out", async () => {
    failList = true;
    await renderCard();

    await waitFor(() => {
      expect(listRequests).toHaveLength(1);
    });
    await waitFor(() => {
      expect(screen.queryByTestId("home-upcoming-maintenance")).toBeNull();
    });
  });

  test("while loading, placeholders", async () => {
    getListMock.mockImplementation(() => {
      return new Promise(() => {
        // never answered
      });
    });
    await renderCard();

    expect(screen.getByTestId("home-upcoming-loading")).toBeInTheDocument();
  });
});

describe("the calendar leaf", () => {
  test("the month and day in the reader's language and the dashboard's time zone", () => {
    const date: Date = new Date("2026-10-15T09:00:00.000Z");
    const timezone: string = OneUptimeDate.getCurrentTimezone().toString();

    expect(formatCalendarPart({ date, part: "month", language: "en" })).toBe(
      new Intl.DateTimeFormat("en", {
        month: "short",
        timeZone: timezone,
      }).format(date),
    );
    expect(formatCalendarPart({ date, part: "day", language: "de" })).toBe(
      new Intl.DateTimeFormat("de", {
        day: "numeric",
        timeZone: timezone,
      }).format(date),
    );
    expect(formatCalendarPart({ date, part: "month", language: "fr" })).toBe(
      new Intl.DateTimeFormat("fr", {
        month: "short",
        timeZone: timezone,
      }).format(date),
    );
  });

  test("a language tag Intl rejects falls back to English", () => {
    const date: Date = new Date("2026-10-15T09:00:00.000Z");

    expect(
      formatCalendarPart({ date, part: "month", language: "not a language!" }),
    ).toBe(new Intl.DateTimeFormat("en", { month: "short" }).format(date));
  });
});
