/**
 * @timezone UTC
 */
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
  RenderResult,
  screen,
  within,
} from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ChangeScheduledMaintenanceState is the header of the scheduled maintenance
 * overview: the state pills, the "Starts in / In progress for" duration and
 * the state actions. These tests drive it through a real render against a
 * fake list API and a fake clock, because the bugs it had were about time -
 * a countdown that kept counting up once the start passed, no word about an
 * event that should have started, and a worker transition that never showed
 * until a reload.
 */

const PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const EVENT_ID: string = "33333333-3333-4333-8333-333333333333";
const SCHEDULED_STATE_ID: string = "44444444-4444-4444-8444-444444444441";
const ONGOING_STATE_ID: string = "44444444-4444-4444-8444-444444444442";
const VERIFYING_STATE_ID: string = "44444444-4444-4444-8444-444444444443";
const ENDED_STATE_ID: string = "44444444-4444-4444-8444-444444444444";

const getListMock: MockFunction = getJestMockFunction();
const modalRenderMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      // ObjectID is imported below; it is only dereferenced when this is called.
      getCurrentProject: () => {
        return { id: new ObjectID(PROJECT_ID) };
      },
    },
  };
});

/*
 * The real modal is a full ModelForm with its own traffic. The header only
 * needs to hand it a title and react to onSuccess, so the stand-in exposes
 * exactly that.
 */
jest.mock("../../../UI/Components/ModelFormModal/ModelFormModal", () => {
  return {
    __esModule: true,
    default: (props: {
      title: string;
      submitButtonText: string;
      onSuccess: (model: unknown) => Promise<void> | void;
      onClose: () => void;
    }): React.ReactElement => {
      modalRenderMock(props);
      return React.createElement(
        "div",
        { "data-testid": "state-change-modal" },
        React.createElement("h3", {}, props.title),
        React.createElement("span", {}, props.submitButtonText),
      );
    },
  };
});

import ChangeScheduledMaintenanceState, {
  ComponentProps,
  SCHEDULED_MAINTENANCE_STATE_LOADING_TEXT,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ScheduledMaintenance/ChangeState";
import { SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS } from "../../../../App/FeatureSet/Dashboard/src/Utils/ScheduledMaintenanceTiming";
import ScheduledMaintenanceNoteTemplate from "../../../Models/DatabaseModels/ScheduledMaintenanceNoteTemplate";
import ScheduledMaintenanceState from "../../../Models/DatabaseModels/ScheduledMaintenanceState";
import ScheduledMaintenanceStateTimeline from "../../../Models/DatabaseModels/ScheduledMaintenanceStateTimeline";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import Color from "../../../Types/Color";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";

const SECOND: number = 1000;
const MINUTE: number = 60 * SECOND;
const HOUR: number = 60 * MINUTE;
const DAY: number = 24 * HOUR;

const STARTS_AT: Date = new Date("2026-09-14T20:00:00.000Z");
const ENDS_AT: Date = new Date("2026-09-14T22:00:00.000Z");

type AtFunction = (offsetInMs: number, from?: Date) => Date;

const at: AtFunction = (offsetInMs: number, from?: Date): Date => {
  return new Date((from || STARTS_AT).getTime() + offsetInMs);
};

interface ListResult<T> {
  data: Array<T>;
  count: number;
  skip: number;
  limit: number;
}

interface ListRequest {
  modelType: unknown;
  query: Record<string, unknown>;
  select: Record<string, unknown>;
  sort: Record<string, unknown>;
  limit: number;
  skip: number;
}

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function createDeferred<T>(): Deferred<T> {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise: Promise<T> = new Promise<T>((resolve: (value: T) => void) => {
    resolvePromise = resolve;
  });

  return {
    promise,
    resolve: (value: T): void => {
      resolvePromise!(value);
    },
  };
}

function listResult<T>(data: Array<T>): ListResult<T> {
  return { data: data, count: data.length, skip: 0, limit: 99 };
}

function makeState(data: {
  id: string;
  name: string;
  color: string;
  flag?:
    | "isScheduledState"
    | "isOngoingState"
    | "isEndedState"
    | "isResolvedState"
    | undefined;
}): ScheduledMaintenanceState {
  const state: ScheduledMaintenanceState = new ScheduledMaintenanceState();
  state.id = new ObjectID(data.id);
  state.name = data.name;
  state.color = new Color(data.color);

  if (data.flag) {
    state[data.flag] = true;
  }

  return state;
}

const DEFAULT_STATES: Array<ScheduledMaintenanceState> = [
  makeState({
    id: SCHEDULED_STATE_ID,
    name: "Scheduled",
    color: "#6366f1",
    flag: "isScheduledState",
  }),
  makeState({
    id: ONGOING_STATE_ID,
    name: "Ongoing",
    color: "#f59e0b",
    flag: "isOngoingState",
  }),
  makeState({
    id: ENDED_STATE_ID,
    name: "Ended",
    color: "#10b981",
    flag: "isEndedState",
  }),
];

function makeTimeline(
  stateId: string,
  startsAt: Date,
): ScheduledMaintenanceStateTimeline {
  const timeline: ScheduledMaintenanceStateTimeline =
    new ScheduledMaintenanceStateTimeline();
  timeline.id = ObjectID.generate();
  timeline.scheduledMaintenanceStateId = new ObjectID(stateId);
  timeline.startsAt = startsAt;
  return timeline;
}

type TimelineResponse =
  | Array<ScheduledMaintenanceStateTimeline>
  | Promise<ListResult<ScheduledMaintenanceStateTimeline>>
  | Error;

interface FakeServer {
  states?: Array<ScheduledMaintenanceState> | Error | undefined;
  // One entry per timeline request, the last one repeating.
  timelines: Array<TimelineResponse>;
  templates?: Array<ScheduledMaintenanceNoteTemplate> | undefined;
}

function serve(server: FakeServer): void {
  let timelineRequestCount: number = 0;

  getListMock.mockImplementation((request: any) => {
    const listRequest: ListRequest = request as ListRequest;

    if (listRequest.modelType === ScheduledMaintenanceState) {
      if (server.states instanceof Error) {
        return Promise.reject(server.states);
      }

      return Promise.resolve(listResult(server.states || DEFAULT_STATES));
    }

    if (listRequest.modelType === ScheduledMaintenanceStateTimeline) {
      const response: TimelineResponse | undefined =
        server.timelines[
          Math.min(timelineRequestCount, server.timelines.length - 1)
        ];
      timelineRequestCount++;

      if (response instanceof Error) {
        return Promise.reject(response);
      }

      if (response instanceof Promise) {
        return response;
      }

      return Promise.resolve(listResult(response || []));
    }

    if (listRequest.modelType === ScheduledMaintenanceNoteTemplate) {
      return Promise.resolve(listResult(server.templates || []));
    }

    return Promise.reject(new Error("Unexpected list request"));
  });
}

function timelineRequests(): Array<ListRequest> {
  return getListMock.mock.calls
    .map((call: Array<any>): ListRequest => {
      return call[0] as ListRequest;
    })
    .filter((request: ListRequest): boolean => {
      return request.modelType === ScheduledMaintenanceStateTimeline;
    });
}

// Let resolved API promises and the state updates they trigger settle.
async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 20; i++) {
      await Promise.resolve();
    }
  });
}

/*
 * Moves the fake clock forward in small steps. React only re-renders (and so
 * only schedules the header's next timeout) once each act() finishes, so one
 * big jump would fire a single tick and leave the clock the header last read
 * far behind.
 */
async function advance(ms: number): Promise<void> {
  let remaining: number = ms;

  while (remaining > 0) {
    const step: number = Math.min(remaining, 5 * SECOND);
    remaining -= step;

    await act(async () => {
      jest.advanceTimersByTime(step);
    });
    await flush();
  }
}

// Structural, because @jest/globals' SpyInstance does not name cleanly here.
interface CallSpy {
  mock: { calls: Array<Array<unknown>> };
}

function renderHeader(overrides?: Partial<ComponentProps>): RenderResult {
  const props: ComponentProps = {
    scheduledMaintenanceId: new ObjectID(EVENT_ID),
    onActionComplete: jest.fn(),
    eventNumber: "#58",
    title: "Primary database failover drill",
    eventStartsAt: STARTS_AT,
    eventEndsAt: ENDS_AT,
    ...overrides,
  };

  return render(<ChangeScheduledMaintenanceState {...props} />);
}

interface DurationPill {
  prefix: string;
  value: string;
}

const DURATION_PREFIX_PATTERN: RegExp =
  /^(Starts in|Start overdue by|In progress for|Overrunning by|Completed in|Ongoing for)$/;

function readDuration(): DurationPill | null {
  const prefix: HTMLElement | null = screen.queryByText(
    DURATION_PREFIX_PATTERN,
  );

  if (!prefix) {
    return null;
  }

  return {
    prefix: prefix.textContent || "",
    value: prefix.nextElementSibling?.textContent || "",
  };
}

function currentStatePill(): string {
  return screen.getAllByTestId("pill")[0]?.textContent || "";
}

function overdueNotice(): HTMLElement | null {
  return screen.queryByTestId("scheduled-maintenance-overdue-notice");
}

describe("ChangeScheduledMaintenanceState", () => {
  beforeEach(() => {
    jest.useFakeTimers({ doNotFake: ["performance"] });
    getListMock.mockReset();
    modalRenderMock.mockReset();
  });

  afterEach(() => {
    cleanup();
    jest.clearAllTimers();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  describe("loading", () => {
    test("shows a header-sized placeholder instead of a page loader while the states load", async () => {
      jest.setSystemTime(at(-HOUR));
      const states: Deferred<ListResult<ScheduledMaintenanceState>> =
        createDeferred<ListResult<ScheduledMaintenanceState>>();
      getListMock.mockImplementation((request: any) => {
        if ((request as ListRequest).modelType === ScheduledMaintenanceState) {
          return states.promise;
        }

        return Promise.resolve(listResult([]));
      });

      const { container } = renderHeader();

      const placeholder: HTMLElement = screen.getByTestId(
        "scheduled-maintenance-state-loading",
      );

      expect(placeholder).toHaveAttribute("role", "status");
      expect(placeholder).toHaveAttribute("aria-live", "polite");
      expect(
        within(placeholder).getByText(SCHEDULED_MAINTENANCE_STATE_LOADING_TEXT),
      ).toHaveClass("sr-only");
      expect(
        placeholder.querySelector(".motion-safe\\:animate-pulse"),
      ).not.toBe(null);
      // The old PageLoader pushed the page down by 208px where the header belongs.
      expect(container.querySelector(".mt-52")).toBe(null);
      expect(screen.queryByRole("heading")).toBe(null);
      expect(screen.queryByRole("button")).toBe(null);

      states.resolve(listResult(DEFAULT_STATES));
      await flush();

      expect(screen.queryByTestId("scheduled-maintenance-state-loading")).toBe(
        null,
      );
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Primary database failover drill",
        }),
      ).toBeInTheDocument();
    });

    test("requests states, timeline and note templates together", async () => {
      jest.setSystemTime(at(-HOUR));
      getListMock.mockImplementation(() => {
        return new Promise(() => {
          // Never resolves: this test only looks at what was asked for.
        });
      });

      renderHeader();
      await flush();

      const requestedModels: Array<unknown> = getListMock.mock.calls.map(
        (call: Array<any>) => {
          return (call[0] as ListRequest).modelType;
        },
      );

      expect(requestedModels).toHaveLength(3);
      expect(requestedModels).toEqual(
        expect.arrayContaining([
          ScheduledMaintenanceState,
          ScheduledMaintenanceStateTimeline,
          ScheduledMaintenanceNoteTemplate,
        ]),
      );

      const timelineRequest: ListRequest = timelineRequests()[0]!;

      expect(timelineRequest.query["scheduledMaintenanceId"]?.toString()).toBe(
        EVENT_ID,
      );
      expect(timelineRequest.sort).toEqual({ startsAt: SortOrder.Ascending });
      expect(timelineRequest.select).toEqual({
        _id: true,
        scheduledMaintenanceStateId: true,
        startsAt: true,
      });
    });

    test("replaces the header with a retryable error when the states fail to load", async () => {
      jest.setSystemTime(at(-HOUR));
      serve({
        states: new Error("Could not reach the server"),
        timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]],
      });

      renderHeader();
      await flush();

      expect(
        screen.getByText("Could not reach the server"),
      ).toBeInTheDocument();
      expect(screen.queryByRole("heading")).toBe(null);

      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });
      fireEvent.click(screen.getByTestId("refresh-button"));
      await flush();

      expect(screen.queryByText("Could not reach the server")).toBe(null);
      expect(currentStatePill()).toBe("Scheduled");
    });
  });

  describe("header content", () => {
    test("renders the number, title, current state, step rail and facts", async () => {
      jest.setSystemTime(at(-HOUR));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });

      renderHeader({
        facts: [
          { label: "Status pages", value: "Acme Internal Status" },
          { label: "Created by", value: "" },
        ],
      });
      await flush();

      expect(screen.getByTitle("Number")).toHaveTextContent("#58");
      expect(
        screen.getByRole("heading", {
          level: 2,
          name: "Primary database failover drill",
        }),
      ).toBeInTheDocument();
      expect(currentStatePill()).toBe("Scheduled");

      const facts: HTMLElement = screen.getByTestId("event-status-facts");

      expect(facts.tagName).toBe("DL");
      expect(within(facts).getByText("Status pages")).toBeInTheDocument();
      expect(
        within(facts).getByText("Acme Internal Status"),
      ).toBeInTheDocument();
      // Empty facts are skipped rather than rendered as a bare label.
      expect(within(facts).queryByText("Created by")).toBe(null);
    });

    test("keeps the action ids, icons and styles the rest of the product relies on while scheduled", async () => {
      jest.setSystemTime(at(-HOUR));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });

      const { container } = renderHeader();
      await flush();

      const group: HTMLElement = screen.getByRole("group", {
        name: "Event actions",
      });
      const buttons: Array<HTMLElement> = within(group).getAllByRole("button");
      const ongoingButton: HTMLElement = container.querySelector(
        "#sm-mark-ongoing-btn",
      ) as HTMLElement;
      const completeButton: HTMLElement = container.querySelector(
        "#sm-mark-complete-btn",
      ) as HTMLElement;

      expect(buttons[0]).toBe(ongoingButton);
      expect(buttons[1]).toBe(completeButton);
      expect(ongoingButton).toHaveTextContent("Mark as Ongoing");
      expect(ongoingButton).toHaveClass("bg-indigo-600");
      expect(ongoingButton).toHaveAttribute("type", "button");
      expect(completeButton).toHaveTextContent("Mark as Ended");
      expect(completeButton).toHaveClass("bg-white");
      expect(completeButton).not.toHaveClass("bg-indigo-600");
    });

    test("promotes completing to the primary action once in progress", async () => {
      jest.setSystemTime(at(HOUR));
      serve({
        timelines: [
          [
            makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
            makeTimeline(ONGOING_STATE_ID, at(0)),
          ],
        ],
      });

      const { container } = renderHeader();
      await flush();

      expect(container.querySelector("#sm-mark-ongoing-btn")).toBe(null);

      const completeButton: HTMLElement = container.querySelector(
        "#sm-mark-complete-btn",
      ) as HTMLElement;

      expect(completeButton).toHaveTextContent("Mark as Ended");
      expect(completeButton).toHaveClass("bg-indigo-600");
      expect(container.querySelectorAll("#sm-mark-complete-btn")).toHaveLength(
        1,
      );
    });

    test("treats a custom state after the ongoing state as still in progress", async () => {
      jest.setSystemTime(at(HOUR));
      serve({
        states: [
          DEFAULT_STATES[0]!,
          DEFAULT_STATES[1]!,
          makeState({
            id: VERIFYING_STATE_ID,
            name: "Verifying",
            color: "#0ea5e9",
          }),
          DEFAULT_STATES[2]!,
        ],
        timelines: [
          [
            makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
            makeTimeline(ONGOING_STATE_ID, at(0)),
            makeTimeline(VERIFYING_STATE_ID, at(30 * MINUTE)),
          ],
        ],
      });

      const { container } = renderHeader();
      await flush();

      expect(currentStatePill()).toBe("Verifying");
      expect(readDuration()).toEqual({
        prefix: "In progress for",
        value: "1 hour",
      });
      expect(
        container.querySelector("#sm-mark-complete-btn"),
      ).toHaveTextContent("Mark as Ended");
    });

    test("offers no actions and no duration without a timeline", async () => {
      jest.setSystemTime(at(HOUR));
      serve({ timelines: [[]] });

      const { container } = renderHeader();
      await flush();

      expect(container.querySelector("#sm-mark-ongoing-btn")).toBe(null);
      expect(container.querySelector("#sm-mark-complete-btn")).toBe(null);
      expect(readDuration()).toBe(null);
      expect(overdueNotice()).toBe(null);
    });
  });

  describe("timing", () => {
    test("counts down to the start", async () => {
      jest.setSystemTime(at(-(2 * HOUR + 30 * SECOND)));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });

      renderHeader();
      await flush();

      expect(readDuration()).toEqual({
        prefix: "Starts in",
        value: "2 hours",
      });

      await advance(5 * MINUTE);

      expect(readDuration()).toEqual({
        prefix: "Starts in",
        value: "1 hour, 55 minutes",
      });
      expect(overdueNotice()).toBe(null);
    });

    test("stops saying 'Starts in' once the start passes, and warns only after the grace period", async () => {
      jest.setSystemTime(at(-45 * SECOND));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });

      renderHeader();
      await flush();

      expect(readDuration()).toEqual({
        prefix: "Starts in",
        value: "less than a minute",
      });

      await advance(30 * SECOND);

      expect(readDuration()?.prefix).toBe("Starts in");

      // The next tick lands on the start itself rather than up to 30s late.
      await advance(15 * SECOND);

      expect(readDuration()).toEqual({
        prefix: "Start overdue by",
        value: "less than a minute",
      });
      expect(currentStatePill()).toBe("Scheduled");
      expect(overdueNotice()).toBe(null);

      await advance(90 * SECOND);

      expect(readDuration()).toEqual({
        prefix: "Start overdue by",
        value: "1 minute",
      });
      expect(overdueNotice()).toBe(null);

      await advance(
        SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS - 90 * SECOND,
      );

      const notice: HTMLElement = overdueNotice() as HTMLElement;

      expect(notice).not.toBe(null);
      expect(within(notice).getByText("Start overdue")).toBeInTheDocument();
      expect(notice).toHaveTextContent(
        "Planned to start at " +
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(STARTS_AT) +
          ", but it has not been marked as Ongoing yet.",
      );
      // The label's own span sits inside the amber pill.
      expect(
        within(notice).getByText("Start overdue").parentElement,
      ).toHaveClass("bg-amber-50", "text-amber-800", "ring-amber-200");
      // The notice sits inside the header card, after the pills.
      expect(notice.parentElement).toHaveClass("mt-3");
    });

    test("shows an overdue start straight away when the page is opened late", async () => {
      jest.setSystemTime(at(3 * HOUR));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });

      const { container } = renderHeader();
      await flush();

      expect(readDuration()).toEqual({
        prefix: "Start overdue by",
        value: "3 hours",
      });
      expect(overdueNotice()).toHaveTextContent("Start overdue");
      // The actions are unchanged: the fix is still to mark it ongoing.
      expect(container.querySelector("#sm-mark-ongoing-btn")).toHaveTextContent(
        "Mark as Ongoing",
      );
    });

    test("counts an event in progress from its ongoing timeline entry and flags an overrun", async () => {
      jest.setSystemTime(at(-1 * MINUTE, ENDS_AT));
      serve({
        timelines: [
          [
            makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
            makeTimeline(ONGOING_STATE_ID, at(5 * MINUTE)),
          ],
        ],
      });

      renderHeader();
      await flush();

      expect(readDuration()).toEqual({
        prefix: "In progress for",
        value: "1 hour, 54 minutes",
      });

      await advance(MINUTE);

      expect(readDuration()).toEqual({
        prefix: "Overrunning by",
        value: "less than a minute",
      });
      expect(overdueNotice()).toBe(null);

      await advance(SCHEDULED_MAINTENANCE_OVERDUE_GRACE_PERIOD_IN_MS + MINUTE);

      expect(readDuration()).toEqual({
        prefix: "Overrunning by",
        value: "3 minutes",
      });

      const notice: HTMLElement = overdueNotice() as HTMLElement;

      expect(within(notice).getByText("Overrunning")).toBeInTheDocument();
      expect(notice).toHaveTextContent(
        "Planned to end at " +
          OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(ENDS_AT) +
          ", but it has not been marked as Ended yet.",
      );
    });

    test("shows how long an ended event took and stops the clock", async () => {
      jest.setSystemTime(at(DAY, ENDS_AT));
      serve({
        timelines: [
          [
            makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
            makeTimeline(ONGOING_STATE_ID, at(5 * MINUTE)),
            makeTimeline(ENDED_STATE_ID, at(90 * MINUTE)),
          ],
        ],
      });
      const setTimeoutSpy: CallSpy = jest.spyOn(
        global,
        "setTimeout",
      ) as unknown as CallSpy;

      const { container } = renderHeader();
      await flush();

      expect(currentStatePill()).toBe("Ended");
      expect(readDuration()).toEqual({
        prefix: "Completed in",
        value: "1 hour, 25 minutes",
      });
      expect(container.querySelector("#sm-mark-ongoing-btn")).toBe(null);
      expect(container.querySelector("#sm-mark-complete-btn")).toBe(null);
      expect(overdueNotice()).toBe(null);

      const clockTimeouts: Array<Array<unknown>> =
        setTimeoutSpy.mock.calls.filter((call: Array<unknown>): boolean => {
          return typeof call[1] === "number" && (call[1] as number) >= SECOND;
        });

      expect(clockTimeouts).toHaveLength(0);

      await advance(10 * MINUTE);

      expect(readDuration()?.value).toBe("1 hour, 25 minutes");
      expect(timelineRequests()).toHaveLength(1);
    });

    test("clears its clock when unmounted", async () => {
      jest.setSystemTime(at(-HOUR));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });
      const clearTimeoutSpy: CallSpy = jest.spyOn(
        global,
        "clearTimeout",
      ) as unknown as CallSpy;

      const { unmount } = renderHeader();
      await flush();

      const clearsBeforeUnmount: number = clearTimeoutSpy.mock.calls.length;

      unmount();

      expect(clearTimeoutSpy.mock.calls.length).toBeGreaterThan(
        clearsBeforeUnmount,
      );

      // Nothing left running can update an unmounted header.
      await advance(10 * MINUTE);

      expect(timelineRequests()).toHaveLength(1);
    });
  });

  describe("state rechecks after a missed boundary", () => {
    test("picks up the worker's transition without a reload and tells the page", async () => {
      jest.setSystemTime(at(10 * SECOND));
      serve({
        timelines: [
          [makeTimeline(SCHEDULED_STATE_ID, at(-DAY))],
          [
            makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
            makeTimeline(ONGOING_STATE_ID, at(20 * SECOND)),
          ],
        ],
      });
      const onActionComplete: MockFunction = getJestMockFunction();

      const { container } = renderHeader({
        onActionComplete: onActionComplete,
      });
      await flush();

      expect(readDuration()?.prefix).toBe("Start overdue by");
      // The timeline was only just read; no immediate second request.
      expect(timelineRequests()).toHaveLength(1);

      await advance(30 * SECOND);

      expect(timelineRequests()).toHaveLength(2);
      expect(currentStatePill()).toBe("Ongoing");
      expect(readDuration()?.prefix).toBe("In progress for");
      expect(container.querySelector("#sm-mark-ongoing-btn")).toBe(null);
      expect(container.querySelector("#sm-mark-complete-btn")).toHaveClass(
        "bg-indigo-600",
      );
      expect(onActionComplete).toHaveBeenCalledTimes(1);

      // Back within the window: no further polling.
      await advance(5 * MINUTE);

      expect(timelineRequests()).toHaveLength(2);
    });

    test("does not tell the page anything when the state has not changed, and stops polling a stuck event", async () => {
      jest.setSystemTime(at(-10 * SECOND));
      serve({ timelines: [[makeTimeline(SCHEDULED_STATE_ID, at(-DAY))]] });
      const onActionComplete: MockFunction = getJestMockFunction();

      renderHeader({ onActionComplete: onActionComplete });
      await flush();

      expect(readDuration()?.prefix).toBe("Starts in");

      // Past the start and through the whole recheck window.
      for (let tick: number = 0; tick < 14; tick++) {
        await advance(30 * SECOND);
      }

      const requestsAfterWindow: number = timelineRequests().length;

      expect(requestsAfterWindow).toBeGreaterThan(1);
      // At most one re-read per tick inside the five minute window.
      expect(requestsAfterWindow).toBeLessThanOrEqual(1 + 11);
      expect(onActionComplete).not.toHaveBeenCalled();

      for (let tick: number = 0; tick < 10; tick++) {
        await advance(30 * SECOND);
      }

      expect(timelineRequests()).toHaveLength(requestsAfterWindow);
      expect(overdueNotice()).toHaveTextContent("Start overdue");
    });

    test("keeps the last known state when a background re-read fails", async () => {
      jest.setSystemTime(at(10 * SECOND));
      serve({
        timelines: [
          [makeTimeline(SCHEDULED_STATE_ID, at(-DAY))],
          new Error("Network down"),
        ],
      });

      renderHeader();
      await flush();
      await advance(30 * SECOND);

      expect(timelineRequests().length).toBeGreaterThanOrEqual(2);
      expect(currentStatePill()).toBe("Scheduled");
      expect(screen.queryByText("Network down")).toBe(null);
      expect(screen.getByRole("heading", { level: 2 })).toBeInTheDocument();
    });
  });

  describe("changing state", () => {
    test("opens the state change modal and shows the new state before the refetch returns", async () => {
      jest.setSystemTime(at(-HOUR));
      const refetch: Deferred<ListResult<ScheduledMaintenanceStateTimeline>> =
        createDeferred<ListResult<ScheduledMaintenanceStateTimeline>>();
      serve({
        timelines: [
          [makeTimeline(SCHEDULED_STATE_ID, at(-DAY))],
          refetch.promise,
        ],
      });
      const onActionComplete: MockFunction = getJestMockFunction();

      const { container } = renderHeader({
        onActionComplete: onActionComplete,
      });
      await flush();

      fireEvent.click(
        container.querySelector("#sm-mark-ongoing-btn") as HTMLElement,
      );

      const modal: HTMLElement = screen.getByTestId("state-change-modal");

      expect(
        within(modal).getByText("Mark Scheduled Maintenance as Ongoing"),
      ).toBeInTheDocument();
      expect(within(modal).getByText("Mark as Ongoing")).toBeInTheDocument();

      const modalProps: {
        onSuccess: (model: ScheduledMaintenanceStateTimeline) => Promise<void>;
      } = modalRenderMock.mock.calls[modalRenderMock.mock.calls.length - 1]![0];

      const created: ScheduledMaintenanceStateTimeline =
        new ScheduledMaintenanceStateTimeline();
      created.scheduledMaintenanceStateId = new ObjectID(ONGOING_STATE_ID);

      let success: Promise<void> | undefined = undefined;

      await act(async () => {
        success = modalProps.onSuccess(created);
      });
      await flush();

      expect(screen.queryByTestId("state-change-modal")).toBe(null);
      expect(currentStatePill()).toBe("Ongoing");
      expect(readDuration()?.prefix).toBe("In progress for");
      expect(onActionComplete).not.toHaveBeenCalled();

      refetch.resolve(
        listResult([
          makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
          makeTimeline(ONGOING_STATE_ID, at(-HOUR)),
        ]),
      );
      await act(async () => {
        await success;
      });
      await flush();

      expect(currentStatePill()).toBe("Ongoing");
      expect(onActionComplete).toHaveBeenCalledTimes(1);
      expect(timelineRequests()).toHaveLength(2);
    });

    test("still completes the action when the refetch after it fails", async () => {
      jest.setSystemTime(at(HOUR));
      serve({
        timelines: [
          [
            makeTimeline(SCHEDULED_STATE_ID, at(-DAY)),
            makeTimeline(ONGOING_STATE_ID, at(0)),
          ],
          new Error("Refetch failed"),
        ],
      });
      const onActionComplete: MockFunction = getJestMockFunction();

      const { container } = renderHeader({
        onActionComplete: onActionComplete,
      });
      await flush();

      fireEvent.click(
        container.querySelector("#sm-mark-complete-btn") as HTMLElement,
      );

      const modalProps: {
        onSuccess: (model: ScheduledMaintenanceStateTimeline) => Promise<void>;
      } = modalRenderMock.mock.calls[modalRenderMock.mock.calls.length - 1]![0];

      await act(async () => {
        await modalProps.onSuccess(new ScheduledMaintenanceStateTimeline());
      });
      await flush();

      expect(currentStatePill()).toBe("Ended");
      expect(screen.queryByText("Refetch failed")).toBe(null);
      expect(container.querySelector("#sm-mark-complete-btn")).toBe(null);
      expect(onActionComplete).toHaveBeenCalledTimes(1);
    });
  });
});
