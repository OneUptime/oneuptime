import "@testing-library/jest-dom";
import { render, screen, waitFor } from "@testing-library/react";
import React, { act } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ScheduledEventList from "../../../../App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/List";
import {
  getScheduledEventEventItem,
  getStateChangeIcon,
} from "../../../../App/FeatureSet/StatusPage/src/Pages/ScheduledEvent/Detail";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import Route from "../../../Types/API/Route";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import IconProp from "../../../Types/Icon/IconProp";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { ComponentProps as EventItemComponentProps } from "../../../UI/Components/EventItem/EventItem";
import LocalStorage from "../../../UI/Utils/LocalStorage";
import Navigation from "../../../UI/Utils/Navigation";

/*
 * THE STATUS PAGE LISTS AN EVENT BY ITS STATE'S PLACE.
 *
 * A project can add its own states between the built-in ones: "Confirmed"
 * before Ongoing, "Verifying" between Ongoing and Ended, "Reviewing" after
 * Ended. An event in "Verifying" is in progress
 * (Common/Utils/ScheduledMaintenanceStart), so the scheduled events page
 * lists it under Ongoing Events and its timeline shows the in-progress icon,
 * as Ongoing's does; one in "Reviewing" is over and sits under Completed
 * Events; one in "Confirmed" has not started and sits under Scheduled
 * Events. The server answers every list with the project's states, which
 * is what places a state of the project's own.
 */

const STATUS_PAGE_ID: string = "33333333-3333-4333-8333-333333333333";

type StateKind =
  | "scheduled"
  | "confirmed"
  | "ongoing"
  | "verifying"
  | "ended"
  | "reviewing"
  | "completed";

const STATE_ORDER: Array<StateKind> = [
  "scheduled",
  "confirmed",
  "ongoing",
  "verifying",
  "ended",
  "reviewing",
  "completed",
];

function stateId(kind: StateKind): string {
  return `5c000000-0000-4000-8000-0000000000a${STATE_ORDER.indexOf(kind) + 1}`;
}

// A state as the status page API answers it: its id, name, place and flags.
function stateJSON(kind: StateKind): JSONObject {
  return {
    _id: stateId(kind),
    name: kind.charAt(0).toUpperCase() + kind.slice(1),
    color: "#000000",
    order: STATE_ORDER.indexOf(kind) + 1,
    isScheduledState: kind === "scheduled",
    isOngoingState: kind === "ongoing",
    isEndedState: kind === "ended",
    isResolvedState: kind === "completed",
  };
}

function eventJSON(id: string, title: string, kind: StateKind): JSONObject {
  return {
    _id: id,
    title: title,
    startsAt: "2026-11-02T09:00:00.000Z",
    endsAt: "2026-11-02T11:00:00.000Z",
    currentScheduledMaintenanceState: stateJSON(kind),
    monitors: [],
  };
}

let mockResponse: JSONObject = {};

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isLoggedIn: () => {
        return true;
      },
      logout: () => {
        return Promise.resolve();
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/StatusPage/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: () => {
        return Promise.resolve(
          new HTTPResponse<JSONObject>(200, mockResponse, {}),
        );
      },
      getDefaultHeaders: () => {
        return {};
      },
      getFriendlyMessage: (error: { message?: string }) => {
        return error?.message || "Something went wrong";
      },
      refreshSession: () => {
        return Promise.resolve(true);
      },
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/StatusPage/src/Components/Page/Page",
  () => {
    return {
      __esModule: true,
      default: (props: { children: React.ReactNode }) => {
        return <div>{props.children}</div>;
      },
    };
  },
);

/*
 * The events of the section titled `title`: the section's label and its
 * list sit together in one block.
 */
function textOfSection(title: string): string {
  const label: HTMLElement = screen.getByText(title);
  const block: HTMLElement | null = label.parentElement?.parentElement || null;

  expect(block).not.toBeNull();

  return block!.textContent || "";
}

describe("the scheduled events page lists each event under its state's phase", () => {
  const navigate: typeof Navigation.navigate = Navigation.navigate;

  beforeEach(() => {
    localStorage.clear();
    LocalStorage.setItem("statusPageId", new ObjectID(STATUS_PAGE_ID));
    window.history.replaceState({}, "", "/scheduled-events");
    Navigation.navigate = (): void => {};

    mockResponse = {
      scheduledMaintenanceEvents: [
        eventJSON(
          "5c000000-0000-4000-8000-0000000000e1",
          "Database failover drill",
          "verifying",
        ),
        eventJSON(
          "5c000000-0000-4000-8000-0000000000e2",
          "Cache cluster resize",
          "reviewing",
        ),
        eventJSON(
          "5c000000-0000-4000-8000-0000000000e3",
          "Network switch swap",
          "confirmed",
        ),
        eventJSON(
          "5c000000-0000-4000-8000-0000000000e4",
          "Kernel patching",
          "ongoing",
        ),
      ],
      scheduledMaintenanceEventsPublicNotes: [],
      scheduledMaintenanceStateTimelines: [],
      statusPageResources: [],
      monitorsInGroup: {},
      scheduledMaintenanceStates: STATE_ORDER.map(stateJSON),
    };
  });

  afterEach(() => {
    Navigation.navigate = navigate;
    jest.clearAllMocks();
  });

  async function renderList(): Promise<void> {
    await act(async () => {
      render(
        <ScheduledEventList
          pageRoute={new Route("/scheduled-events")}
          onLoadComplete={() => {}}
        />,
      );
    });

    await waitFor(() => {
      expect(screen.getByText("Ongoing Events")).toBeInTheDocument();
    });
  }

  test("an event in a state of the project's own between Ongoing and Ended is ongoing, beside one in Ongoing", async () => {
    await renderList();

    const ongoing: string = textOfSection("Ongoing Events");

    expect(ongoing).toContain("Database failover drill");
    expect(ongoing).toContain("Kernel patching");
    expect(ongoing).not.toContain("Cache cluster resize");
    expect(ongoing).not.toContain("Network switch swap");
  });

  test("an event in a state of the project's own after Ended is completed", async () => {
    await renderList();

    const completed: string = textOfSection("Completed Events");

    expect(completed).toContain("Cache cluster resize");
    expect(completed).not.toContain("Database failover drill");
  });

  test("an event in a state of the project's own before Ongoing is still scheduled", async () => {
    await renderList();

    const upcoming: string = textOfSection("Scheduled Events");

    expect(upcoming).toContain("Network switch swap");
    expect(upcoming).not.toContain("Database failover drill");
  });
});

describe("an event's timeline icon follows the same rule", () => {
  function timelineIcon(kind: StateKind): IconProp | undefined {
    const event: ScheduledMaintenance = new ScheduledMaintenance();
    event._id = "5c000000-0000-4000-8000-0000000000e9";
    event.title = "Database failover drill";

    const row: ScheduledMaintenanceStateTimeline =
      new ScheduledMaintenanceStateTimeline();
    row._id = "5c000000-0000-4000-8000-0000000000f1";
    row.scheduledMaintenanceId = new ObjectID(event._id);
    row.startsAt = new Date("2026-11-02T09:30:00.000Z");
    /*
     * As the status page reads a timeline row's state: with its flags and
     * id - its place comes from the project's list.
     */
    const timelineState: ScheduledMaintenanceState =
      ScheduledMaintenanceState.fromJSON(
        { ...stateJSON(kind), order: undefined },
        ScheduledMaintenanceState,
      ) as ScheduledMaintenanceState;
    row.scheduledMaintenanceState = timelineState;

    const item: EventItemComponentProps = getScheduledEventEventItem({
      scheduledMaintenance: event,
      scheduledMaintenanceEventsPublicNotes: [],
      scheduledMaintenanceStateTimelines: [row],
      statusPageResources: [],
      monitorsInGroup: {},
      isPreviewPage: false,
      isSummary: false,
      scheduledMaintenanceStates: STATE_ORDER.map(
        (stateKind: StateKind): ScheduledMaintenanceState => {
          return ScheduledMaintenanceState.fromJSON(
            stateJSON(stateKind),
            ScheduledMaintenanceState,
          ) as ScheduledMaintenanceState;
        },
      ),
    });

    return item.eventTimeline[0]?.icon;
  }

  /*
   * "Confirmed" has not started: it shows the clock Scheduled shows - it
   * used to show the arrow of a state the event had moved on through.
   */
  test.each([
    ["Ongoing", "ongoing", IconProp.Settings],
    ["Verifying, in progress too", "verifying", IconProp.Settings],
    ["Scheduled", "scheduled", IconProp.Clock],
    ["Confirmed, not started", "confirmed", IconProp.Clock],
    ["Ended, over", "ended", IconProp.ArrowCircleRight],
    ["Reviewing, over", "reviewing", IconProp.ArrowCircleRight],
    ["Completed", "completed", IconProp.CheckCircle],
  ] as Array<[string, StateKind, IconProp]>)(
    "a move into %s shows its icon",
    (_label: string, kind: StateKind, icon: IconProp) => {
      expect(timelineIcon(kind)).toBe(icon);
    },
  );
});

/*
 * The icon by where the state sits, on a project's whole list: a state of
 * its own before Scheduled ("Draft") has not started, one after Completed
 * ("Archived") is complete.
 */
describe("getStateChangeIcon", () => {
  function state(data: {
    id: string;
    order: number;
    flag?: string;
  }): ScheduledMaintenanceState {
    return ScheduledMaintenanceState.fromJSON(
      {
        _id: data.id,
        order: data.order,
        isScheduledState: data.flag === "isScheduledState",
        isOngoingState: data.flag === "isOngoingState",
        isEndedState: data.flag === "isEndedState",
        isResolvedState: data.flag === "isResolvedState",
      },
      ScheduledMaintenanceState,
    ) as ScheduledMaintenanceState;
  }

  const draft: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-0000000000b1",
    order: 1,
  });
  const scheduled: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-0000000000b2",
    order: 2,
    flag: "isScheduledState",
  });
  const ongoing: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-0000000000b3",
    order: 3,
    flag: "isOngoingState",
  });
  const ended: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-0000000000b4",
    order: 4,
    flag: "isEndedState",
  });
  const completed: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-0000000000b5",
    order: 5,
    flag: "isResolvedState",
  });
  const archived: ScheduledMaintenanceState = state({
    id: "5c000000-0000-4000-8000-0000000000b6",
    order: 6,
  });

  const states: Array<ScheduledMaintenanceState> = [
    draft,
    scheduled,
    ongoing,
    ended,
    completed,
    archived,
  ];

  test.each([
    ["Draft, before Scheduled", draft, IconProp.Clock],
    ["Scheduled", scheduled, IconProp.Clock],
    ["Ongoing", ongoing, IconProp.Settings],
    ["Ended", ended, IconProp.ArrowCircleRight],
    ["Completed", completed, IconProp.CheckCircle],
    ["Archived, after Completed", archived, IconProp.CheckCircle],
  ] as Array<[string, ScheduledMaintenanceState, IconProp]>)(
    "%s",
    (_label: string, moveInto: ScheduledMaintenanceState, icon: IconProp) => {
      expect(getStateChangeIcon({ states: states, state: moveInto })).toBe(
        icon,
      );
    },
  );
});
