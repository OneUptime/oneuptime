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
  render,
  renderHook,
  screen,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * HOME FOLLOWS WHAT IT COUNTS AS IT CHANGES (#8963).
 *
 * Home's headline, its five numbers and Needs attention are read in one
 * batch (UseHomeOverview), and used to be read again only on Refresh, or
 * when a background tab was looked at again a minute later. A monitor going
 * offline, an incident a probe opened, an alert a teammate resolved left
 * Home where it was. Every kind the batch counts is announced by the server
 * as it changes (enableRealtimeEventsOn), and Home now hears those
 * announcements for the open project and reads the batch again:
 *
 *   - for every kind it counts: incidents, alerts, monitors, maintenance
 *     events and SLOs, each kind of change;
 *   - at once, then at most once every five seconds however many changes
 *     arrive (one coalesced read);
 *   - quietly: what is on screen stays, the refresh button stays still, and
 *     a read that fails keeps it;
 *   - never while the tab is hidden: once when it is looked at again;
 *   - a change heard while a read is out waits for it, and is read after;
 *   - for the project on show, and never again once Home has gone.
 *
 * Upcoming maintenance follows its events the same way, so an event that
 * starts leaves it as it appears under maintenance in progress.
 *
 * The app's live connection is faked where Home asks for it
 * (LiveConnection); the batch and the card's reads are stubbed at their
 * edges.
 */

interface Subscription {
  modelName: string;
  eventType: string;
  tenantId: string;
  onEvent: (modelId: unknown) => void;
  isStopped: boolean;
}

interface ListenRequest {
  modelType: { new (): { tableName: string } };
  eventType: string;
  tenantId: { toString: () => string };
}

interface OpenConnection {
  listenToModelEvent: (
    listen: ListenRequest,
    onEvent: (modelId: unknown) => void,
  ) => () => void;
}

const subscriptions: Array<Subscription> = [];
let isConnectionStarted: boolean = true;

jest.mock("../../../UI/Utils/LiveConnection", () => {
  const connection: OpenConnection = {
    listenToModelEvent: (
      listen: ListenRequest,
      onEvent: (modelId: unknown) => void,
    ): (() => void) => {
      const subscription: Subscription = {
        modelName: new listen.modelType().tableName,
        eventType: listen.eventType,
        tenantId: listen.tenantId.toString(),
        onEvent: onEvent,
        isStopped: false,
      };

      subscriptions.push(subscription);

      return (): void => {
        subscription.isStopped = true;
      };
    },
  };

  return {
    __esModule: true,
    getOpenLiveConnection: (): OpenConnection | null => {
      return isConnectionStarted ? connection : null;
    },
  };
});

const fetchOverviewMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();
const cacheListMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData",
  () => {
    const actual: Record<string, unknown> = jest.requireActual(
      "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData",
    );

    return {
      __esModule: true,
      ...actual,
      fetchHomeOverview: (...args: Array<unknown>) => {
        return fetchOverviewMock(...args);
      },
    };
  },
);

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

import { HomeOverviewData } from "../../../../App/FeatureSet/Dashboard/src/Components/Home/HomeOverviewData";
import useHomeOverview, {
  HOME_OVERVIEW_LIVE_MODEL_TYPES,
  HOME_OVERVIEW_STALE_AFTER_MS,
  UseHomeOverviewResult,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/UseHomeOverview";
import UpcomingMaintenance, {
  UPCOMING_MAINTENANCE_LIVE_MODEL_TYPES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Home/UpcomingMaintenance";
import { LIVE_ROWS_MIN_INTERVAL_IN_MS } from "../../../UI/Components/ModelTable/LiveRows";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "65f00000000000000000cccc";
const OTHER_PROJECT_ID: string = "65f00000000000000000dddd";
const currentProjectId: ObjectID | null = new ObjectID(PROJECT_ID);

const INTERVAL: number = LIVE_ROWS_MIN_INTERVAL_IN_MS;

// The batch's answer, with this many monitors not operational.
function overviewWith(notOperational: number): HomeOverviewData {
  return {
    activeIncidents: { items: [], count: 0 },
    activeAlerts: { items: [], count: 0 },
    notOperationalMonitors: { items: [], count: notOperational },
    ongoingMaintenance: { items: [], count: 0 },
    slosNeedingAttention: { items: [], count: 0 },
    totalMonitors: 4,
    totalSlos: 0,
  };
}

// The batch answers these in turn, the last one again.
let answers: Array<HomeOverviewData> = [];

function answerWith(...next: Array<HomeOverviewData>): void {
  answers = next;
}

const active: () => Array<Subscription> = (): Array<Subscription> => {
  return subscriptions.filter((subscription: Subscription): boolean => {
    return !subscription.isStopped;
  });
};

// Announces a change to every subscription of one kind and kind of event.
async function announce(
  modelName: string,
  eventType: string = "Update",
): Promise<void> {
  await act(async (): Promise<void> => {
    for (const subscription of active()) {
      if (
        subscription.modelName === modelName &&
        subscription.eventType === eventType
      ) {
        subscription.onEvent("7b3b1548-23cd-46ab-8359-280eb34362af");
      }
    }
    await Promise.resolve();
  });
}

// Lets every read started settle, and React draw what it read.
async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let index: number = 0; index < 5; index++) {
      await Promise.resolve();
    }
  });
}

async function advance(ms: number): Promise<void> {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
  await settle();
}

let visibility: DocumentVisibilityState = "visible";

async function setVisibility(state: DocumentVisibilityState): Promise<void> {
  visibility = state;
  await act(async (): Promise<void> => {
    document.dispatchEvent(new Event("visibilitychange"));
    await Promise.resolve();
  });
  await settle();
}

interface Mounted {
  result: { current: UseHomeOverviewResult };
  rerender: (props: { projectId: ObjectID | null }) => void;
  unmount: () => void;
}

async function mountOverview(
  projectId: string | null = PROJECT_ID,
): Promise<Mounted> {
  let mounted: Mounted | null = null;

  await act(async (): Promise<void> => {
    const rendered: ReturnType<
      typeof renderHook<UseHomeOverviewResult, { projectId: ObjectID | null }>
    > = renderHook(
      (props: { projectId: ObjectID | null }): UseHomeOverviewResult => {
        return useHomeOverview(props.projectId);
      },
      {
        initialProps: {
          projectId: projectId ? new ObjectID(projectId) : null,
        },
      },
    );

    mounted = {
      result: rendered.result,
      rerender: rendered.rerender,
      unmount: rendered.unmount,
    };
  });

  await settle();

  return mounted as unknown as Mounted;
}

function reads(): number {
  return fetchOverviewMock.mock.calls.length;
}

function notOperationalShown(mounted: Mounted): number | undefined {
  return mounted.result.current.data?.notOperationalMonitors.count;
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(new Date("2026-11-16T09:00:00.000Z"));
  subscriptions.length = 0;
  isConnectionStarted = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return visibility;
    },
  });

  answerWith(overviewWith(0));
  fetchOverviewMock.mockImplementation((): Promise<HomeOverviewData> => {
    const answer: HomeOverviewData =
      answers.length > 1 ? answers.shift()! : answers[0]!;
    return Promise.resolve(answer);
  });
});

afterEach(() => {
  cleanup();
  fetchOverviewMock.mockReset();
  getListMock.mockReset();
  cacheListMock.mockReset();
  jest.useRealTimers();
});

describe("what Home listens for", () => {
  test("every kind the batch counts: incidents, alerts, monitors, maintenance events and SLOs", () => {
    expect(
      HOME_OVERVIEW_LIVE_MODEL_TYPES.map(
        (modelType: { new (): BaseModel }): string => {
          return modelType.name;
        },
      ),
    ).toEqual([
      Incident.name,
      Alert.name,
      Monitor.name,
      ScheduledMaintenance.name,
      ServiceLevelObjective.name,
    ]);
  });

  test("every change the server announces of them, in the project on show", async () => {
    await mountOverview();

    expect(
      active()
        .map((subscription: Subscription): string => {
          return `${subscription.modelName}:${subscription.eventType}:${subscription.tenantId}`;
        })
        .sort(),
    ).toEqual(
      [
        ...["Incident", "Alert", "Monitor", "ScheduledMaintenance"].flatMap(
          (name: string): Array<string> => {
            return ["Create", "Update", "Delete"].map(
              (eventType: string): string => {
                return `${name}:${eventType}:${PROJECT_ID}`;
              },
            );
          },
        ),
        // An SLO is announced as it changes: its status, its budget.
        `ServiceLevelObjective:Update:${PROJECT_ID}`,
      ].sort(),
    );
  });

  test("outside a project, and without the app's live connection, nothing is heard", async () => {
    await mountOverview(null);
    expect(subscriptions).toHaveLength(0);

    isConnectionStarted = false;
    await mountOverview();
    expect(subscriptions).toHaveLength(0);
    // The batch is read all the same.
    expect(reads()).toBe(1);
  });
});

describe("Home reads again as what it counts changes", () => {
  test("a monitor going offline moves its number at once, without a reload", async () => {
    answerWith(overviewWith(0), overviewWith(1));
    const mounted: Mounted = await mountOverview();

    expect(reads()).toBe(1);
    expect(notOperationalShown(mounted)).toBe(0);

    await announce("Monitor", "Update");

    expect(reads()).toBe(2);
    expect(notOperationalShown(mounted)).toBe(1);
  });

  test.each([
    ["an incident opened", "Incident", "Create"],
    ["an alert resolved", "Alert", "Update"],
    ["a maintenance event deleted", "ScheduledMaintenance", "Delete"],
    ["an SLO at risk", "ServiceLevelObjective", "Update"],
  ])(
    "%s reads the batch again",
    async (_what: string, modelName: string, eventType: string) => {
      await mountOverview();

      await announce(modelName, eventType);

      expect(reads()).toBe(2);
    },
  );

  test("it is read again for the project on show", async () => {
    await mountOverview();

    await announce("Monitor");

    expect((fetchOverviewMock.mock.calls[1]![0] as ObjectID).toString()).toBe(
      PROJECT_ID,
    );
  });

  test("quietly: what is on screen stays, and the refresh button stays still", async () => {
    answerWith(overviewWith(2));
    const mounted: Mounted = await mountOverview();

    let finish: (data: HomeOverviewData) => void = (): void => {};
    fetchOverviewMock.mockImplementationOnce((): Promise<HomeOverviewData> => {
      return new Promise<HomeOverviewData>(
        (resolve: (data: HomeOverviewData) => void): void => {
          finish = resolve;
        },
      );
    });

    await announce("Monitor");

    // Mid-read: the numbers stay, nothing spins, nothing loads.
    expect(reads()).toBe(2);
    expect(notOperationalShown(mounted)).toBe(2);
    expect(mounted.result.current.isRefreshing).toBe(false);
    expect(mounted.result.current.isLoading).toBe(false);

    await act(async (): Promise<void> => {
      finish(overviewWith(3));
      await Promise.resolve();
    });
    await settle();

    expect(notOperationalShown(mounted)).toBe(3);
    expect(mounted.result.current.loadedAt).not.toBeNull();
  });

  test("a burst of changes, of every kind, is two reads", async () => {
    await mountOverview();

    for (let index: number = 0; index < 300; index++) {
      await announce("Monitor", "Update");
      await announce("Incident", "Create");
      await announce("Alert", "Delete");
    }

    // The first load, and the first change at once.
    expect(reads()).toBe(2);

    await advance(INTERVAL);
    expect(reads()).toBe(3);

    // Nothing more was announced: nothing more is read.
    await advance(INTERVAL * 4);
    expect(reads()).toBe(3);
  });

  test("a read that fails keeps what is on screen, and says nothing", async () => {
    answerWith(overviewWith(5));
    const mounted: Mounted = await mountOverview();

    fetchOverviewMock.mockImplementationOnce((): Promise<HomeOverviewData> => {
      return Promise.reject(new Error("Network error"));
    });

    await announce("Monitor");

    expect(notOperationalShown(mounted)).toBe(5);
    expect(mounted.result.current.error).toBe("");

    // The next change reads again.
    answerWith(overviewWith(6));
    await advance(INTERVAL);
    await announce("Monitor");

    expect(notOperationalShown(mounted)).toBe(6);
  });

  test("a change heard while the first load is still out waits for it, and reads after it", async () => {
    let finishFirst: (data: HomeOverviewData) => void = (): void => {};
    fetchOverviewMock.mockImplementationOnce((): Promise<HomeOverviewData> => {
      return new Promise<HomeOverviewData>(
        (resolve: (data: HomeOverviewData) => void): void => {
          finishFirst = resolve;
        },
      );
    });
    answerWith(overviewWith(7));

    const mounted: Mounted = await mountOverview();
    expect(mounted.result.current.isLoading).toBe(true);

    await announce("Monitor");

    // The first load is not dropped for it: one read is out.
    expect(reads()).toBe(1);

    await act(async (): Promise<void> => {
      finishFirst(overviewWith(1));
      await Promise.resolve();
    });
    await settle();

    // Then the change is read.
    expect(reads()).toBe(2);
    expect(notOperationalShown(mounted)).toBe(7);
    expect(mounted.result.current.isLoading).toBe(false);
  });
});

describe("a hidden Home tab", () => {
  test("reads nothing while hidden, and once when it is looked at again", async () => {
    await mountOverview();

    await setVisibility("hidden");
    await announce("Monitor");
    await announce("Incident", "Create");
    await advance(INTERVAL * 3);

    expect(reads()).toBe(1);

    await setVisibility("visible");

    expect(reads()).toBe(2);
  });

  test("hidden for over a minute, with changes heard: still read once when it is looked at again", async () => {
    await mountOverview();

    await setVisibility("hidden");
    await announce("Monitor");
    await advance(HOME_OVERVIEW_STALE_AFTER_MS + 1000);

    await setVisibility("visible");

    expect(reads()).toBe(2);
  });

  test("hidden for over a minute with nothing heard: read once, as before", async () => {
    await mountOverview();

    await setVisibility("hidden");
    await advance(HOME_OVERVIEW_STALE_AFTER_MS + 1000);
    await setVisibility("visible");

    expect(reads()).toBe(2);
  });
});

describe("starting over and stopping", () => {
  test("another project: Home listens there, and no change of the first is read", async () => {
    const mounted: Mounted = await mountOverview();
    const first: Array<Subscription> = active();

    await act(async (): Promise<void> => {
      mounted.rerender({ projectId: new ObjectID(OTHER_PROJECT_ID) });
    });
    await settle();

    expect(
      first.every((subscription: Subscription): boolean => {
        return subscription.isStopped;
      }),
    ).toBe(true);
    expect(
      active().every((subscription: Subscription): boolean => {
        return subscription.tenantId === OTHER_PROJECT_ID;
      }),
    ).toBe(true);

    const readsBefore: number = reads();

    // The first project's subscriptions are stopped: a change there reads nothing.
    await act(async (): Promise<void> => {
      first[0]!.onEvent("7b3b1548-23cd-46ab-8359-280eb34362af");
      await Promise.resolve();
    });
    await settle();
    expect(reads()).toBe(readsBefore);

    await announce("Monitor");
    expect(reads()).toBe(readsBefore + 1);
    expect(
      (fetchOverviewMock.mock.calls[readsBefore]![0] as ObjectID).toString(),
    ).toBe(OTHER_PROJECT_ID);
  });

  test("once Home has gone: no subscription, no read, no timer left behind", async () => {
    const mounted: Mounted = await mountOverview();

    await announce("Monitor");
    expect(reads()).toBe(2);

    // A second change waits for the interval...
    await announce("Monitor");

    // ...and Home goes before it passes.
    mounted.unmount();

    expect(active()).toHaveLength(0);

    await advance(INTERVAL * 2);
    expect(reads()).toBe(2);
    expect(jest.getTimerCount()).toBe(0);
  });
});

/*
 * Upcoming maintenance reads on its own, beside the batch: an event that
 * starts at its time leaves it as it shows up under maintenance in
 * progress, both without a reload.
 */
describe("Upcoming maintenance follows its events", () => {
  const SCHEDULED: string = "65f000000000000000000021";
  const ONGOING: string = "65f000000000000000000023";
  const NOW: Date = new Date("2026-11-16T09:00:00.000Z");

  let upcoming: Array<ScheduledMaintenance> = [];

  function event(title: string): ScheduledMaintenance {
    return Object.assign(new ScheduledMaintenance(), {
      _id: "65f0000000000000000c0001",
      title: title,
      startsAt: new Date(NOW.getTime() + 60 * 60 * 1000),
      endsAt: new Date(NOW.getTime() + 3 * 60 * 60 * 1000),
    });
  }

  beforeEach(() => {
    upcoming = [event("Database upgrade")];

    cacheListMock.mockImplementation(() => {
      const states: Array<Record<string, unknown>> = [
        {
          id: new ObjectID(SCHEDULED),
          _id: SCHEDULED,
          order: 1,
          isScheduledState: true,
        },
        {
          id: new ObjectID(ONGOING),
          _id: ONGOING,
          order: 2,
          isOngoingState: true,
        },
      ];
      return Promise.resolve({
        data: states,
        count: states.length,
        skip: 0,
        limit: states.length,
      });
    });
    getListMock.mockImplementation(() => {
      return Promise.resolve({
        data: upcoming,
        count: upcoming.length,
        skip: 0,
        limit: 3,
      });
    });
  });

  async function renderCard(): Promise<void> {
    await act(async (): Promise<void> => {
      render(
        <MemoryRouter>
          <UpcomingMaintenance projectId={new ObjectID(PROJECT_ID)} now={NOW} />
        </MemoryRouter>,
      );
    });
    await settle();
  }

  test("it hears the project's maintenance events, every kind of change, and nothing else", async () => {
    expect(
      UPCOMING_MAINTENANCE_LIVE_MODEL_TYPES.map(
        (modelType: { new (): BaseModel }): string => {
          return modelType.name;
        },
      ),
    ).toEqual([ScheduledMaintenance.name]);

    await renderCard();

    expect(
      active()
        .map((subscription: Subscription): string => {
          return `${subscription.modelName}:${subscription.eventType}:${subscription.tenantId}`;
        })
        .sort(),
    ).toEqual(
      [
        `ScheduledMaintenance:Create:${PROJECT_ID}`,
        `ScheduledMaintenance:Delete:${PROJECT_ID}`,
        `ScheduledMaintenance:Update:${PROJECT_ID}`,
      ].sort(),
    );
  });

  test("an event that starts at its time leaves the card, without a reload", async () => {
    await renderCard();

    expect(screen.getByText("Database upgrade")).toBeInTheDocument();
    expect(getListMock).toHaveBeenCalledTimes(1);

    // It moved to Ongoing: no longer waiting for its Starts At.
    upcoming = [];
    await announce("ScheduledMaintenance", "Update");

    expect(getListMock).toHaveBeenCalledTimes(2);
    expect(screen.queryByText("Database upgrade")).toBeNull();
  });

  test("an event scheduled shows up, and the card stays on screen while it is read", async () => {
    await renderCard();

    let finish: (value: unknown) => void = (): void => {};
    getListMock.mockImplementationOnce((): Promise<unknown> => {
      return new Promise<unknown>((resolve: (value: unknown) => void) => {
        finish = resolve;
      });
    });

    await announce("ScheduledMaintenance", "Create");

    // Mid-read: what was on screen stays.
    expect(screen.getByText("Database upgrade")).toBeInTheDocument();

    await act(async (): Promise<void> => {
      finish({
        data: [event("Database upgrade"), event("Network maintenance")],
        count: 2,
        skip: 0,
        limit: 3,
      });
      await Promise.resolve();
    });
    await settle();

    expect(screen.getByText("Network maintenance")).toBeInTheDocument();
  });
});
