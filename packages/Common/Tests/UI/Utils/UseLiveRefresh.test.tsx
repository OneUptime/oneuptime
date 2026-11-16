import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, renderHook } from "@testing-library/react";
import { Mock } from "jest-mock";

/*
 * useLiveRefresh: a part of a page that shows records of several kinds -
 * Home's overview counts incidents, alerts, monitors, maintenance events and
 * SLOs - reads again when the server announces a change to a record of any
 * of them, in the project it is drawn in: at once for the first change, at
 * most once every interval however many follow and of whichever kind, never
 * while the tab is hidden, never after it has gone, and only on the live
 * connection the app opened. The connection is faked where the hook asks for
 * it (LiveConnection): every subscription is recorded, and a test announces
 * a change by calling what the hook handed it.
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

import useLiveRefresh, {
  UseLiveRefreshOptions,
  getAnnouncedTables,
} from "../../../UI/Utils/UseLiveRefresh";
import Alert from "../../../Models/DatabaseModels/Alert";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OTHER_PROJECT_ID: string = "11111111-2222-4333-8444-555555555555";
const INTERVAL: number = 5000;

const KINDS: Array<{ new (): BaseModel }> = [
  Incident,
  Alert,
  Monitor,
  ScheduledMaintenance,
  ServiceLevelObjective,
];

const active: () => Array<Subscription> = (): Array<Subscription> => {
  return subscriptions.filter((subscription: Subscription): boolean => {
    return !subscription.isStopped;
  });
};

const described: (list: Array<Subscription>) => Array<string> = (
  list: Array<Subscription>,
): Array<string> => {
  return list
    .map((subscription: Subscription): string => {
      return `${subscription.modelName}:${subscription.eventType}:${subscription.tenantId}`;
    })
    .sort();
};

// Announces a change to the subscriptions of one kind and kind of event.
const announce: (modelName: string, eventType?: string) => void = (
  modelName: string,
  eventType: string = "Update",
): void => {
  act((): void => {
    for (const subscription of active()) {
      if (
        subscription.modelName === modelName &&
        subscription.eventType === eventType
      ) {
        subscription.onEvent("7b3b1548-23cd-46ab-8359-280eb34362af");
      }
    }
  });
};

const advance: (ms: number) => Promise<void> = async (
  ms: number,
): Promise<void> => {
  await act(async (): Promise<void> => {
    jest.advanceTimersByTime(ms);
    await Promise.resolve();
  });
};

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
  });
};

let visibility: DocumentVisibilityState = "visible";

const setVisibility: (state: DocumentVisibilityState) => void = (
  state: DocumentVisibilityState,
): void => {
  visibility = state;
  act((): void => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

type RefreshFunction = () => Promise<void>;

interface Harness {
  refresh: Mock<RefreshFunction>;
  rerender: (options?: Partial<UseLiveRefreshOptions>) => void;
  unmount: () => void;
}

const mount: (options?: Partial<UseLiveRefreshOptions>) => Harness = (
  options?: Partial<UseLiveRefreshOptions>,
): Harness => {
  const refresh: Mock<RefreshFunction> = jest.fn<RefreshFunction>(
    (): Promise<void> => {
      return Promise.resolve();
    },
  );

  const build: (
    overrides?: Partial<UseLiveRefreshOptions>,
  ) => UseLiveRefreshOptions = (
    overrides?: Partial<UseLiveRefreshOptions>,
  ): UseLiveRefreshOptions => {
    return {
      // A new list every render, as a caller writing it inline hands over.
      modelTypes: [...KINDS],
      getTenantId: (): ObjectID => {
        return new ObjectID(PROJECT_ID);
      },
      isEnabled: true,
      refresh: refresh,
      minIntervalInMs: INTERVAL,
      ...options,
      ...overrides,
    };
  };

  const rendered: ReturnType<
    typeof renderHook<void, { options: UseLiveRefreshOptions }>
  > = renderHook(
    (props: { options: UseLiveRefreshOptions }): void => {
      useLiveRefresh(props.options);
    },
    { initialProps: { options: build() } },
  );

  return {
    refresh: refresh,
    rerender: (overrides?: Partial<UseLiveRefreshOptions>): void => {
      rendered.rerender({ options: build(overrides) });
    },
    unmount: rendered.unmount,
  };
};

beforeEach(() => {
  jest.useFakeTimers();
  subscriptions.length = 0;
  isConnectionStarted = true;
  visibility = "visible";
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): DocumentVisibilityState => {
      return visibility;
    },
  });
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("what it listens for", () => {
  test("every change the server announces, of every kind it shows, in its project", () => {
    mount();

    expect(described(active())).toEqual(
      [
        "Incident",
        "Alert",
        "Monitor",
        "ScheduledMaintenance",
        "ServiceLevelObjective",
      ]
        .flatMap((name: string): Array<string> => {
          return name === "ServiceLevelObjective"
            ? [`${name}:Update:${PROJECT_ID}`]
            : [
                `${name}:Create:${PROJECT_ID}`,
                `${name}:Update:${PROJECT_ID}`,
                `${name}:Delete:${PROJECT_ID}`,
              ];
        })
        .sort(),
    );
  });

  test("a kind the server announces nothing for is left out, and the others are heard", () => {
    mount({ modelTypes: [StatusPage, Monitor] });

    expect(
      active().every((subscription: Subscription): boolean => {
        return subscription.modelName === "Monitor";
      }),
    ).toBe(true);
    expect(active()).toHaveLength(3);
  });

  test("a kind named twice is heard once", () => {
    mount({ modelTypes: [Monitor, Monitor] });

    expect(active()).toHaveLength(3);
  });

  test("only kinds the server announces nothing for: nothing is heard, and the project is not asked", () => {
    const getTenantId: Mock<() => ObjectID> = jest.fn<() => ObjectID>(
      (): ObjectID => {
        return new ObjectID(PROJECT_ID);
      },
    );

    mount({ modelTypes: [StatusPage], getTenantId: getTenantId });
    mount({ modelTypes: [], getTenantId: getTenantId });
    mount({ isEnabled: false, getTenantId: getTenantId });

    isConnectionStarted = false;
    mount({ getTenantId: getTenantId });

    expect(getTenantId).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(0);
  });

  test("nothing outside a project", () => {
    mount({
      getTenantId: (): null => {
        return null;
      },
    });

    expect(subscriptions).toHaveLength(0);
  });

  test("the same kinds handed over again on every render are not a new subscription", () => {
    const harness: Harness = mount();
    const first: number = subscriptions.length;

    harness.rerender();
    harness.rerender();

    expect(subscriptions).toHaveLength(first);
    expect(active()).toHaveLength(first);
  });

  test("getAnnouncedTables: the kinds the server announces, each once, with their kinds of change", () => {
    expect(
      getAnnouncedTables([
        StatusPage,
        Monitor,
        ServiceLevelObjective,
        Monitor,
      ]).map((table: { tableName: string; eventTypes: Array<string> }) => {
        return `${table.tableName}:${table.eventTypes.join(",")}`;
      }),
    ).toEqual(["Monitor:Create,Update,Delete", "ServiceLevelObjective:Update"]);
  });
});

describe("reading again", () => {
  test("the first change of any kind reads at once", () => {
    const harness: Harness = mount();

    announce("Monitor");

    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("changes of several kinds share one pace: a burst is two reads", async () => {
    const harness: Harness = mount();

    for (let index: number = 0; index < 200; index++) {
      announce("Incident", "Create");
      announce("Monitor", "Update");
      announce("Alert", "Delete");
      announce("ServiceLevelObjective", "Update");
      announce("ScheduledMaintenance", "Update");
    }

    expect(harness.refresh).toHaveBeenCalledTimes(1);

    await settle();
    await advance(INTERVAL);

    expect(harness.refresh).toHaveBeenCalledTimes(2);

    await settle();
    await advance(INTERVAL * 3);

    expect(harness.refresh).toHaveBeenCalledTimes(2);
  });

  test("the read run is always the latest one handed over", () => {
    const first: Mock<RefreshFunction> = jest.fn<RefreshFunction>(
      (): Promise<void> => {
        return Promise.resolve();
      },
    );
    const harness: Harness = mount({ refresh: first });

    const latest: Mock<RefreshFunction> = jest.fn<RefreshFunction>(
      (): Promise<void> => {
        return Promise.resolve();
      },
    );
    harness.rerender({ refresh: latest });

    announce("Alert");

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
  });

  test("a read that fails does not stop the next change being read", async () => {
    const harness: Harness = mount();
    harness.refresh.mockImplementationOnce((): Promise<void> => {
      return Promise.reject(new Error("Network error"));
    });

    announce("Monitor");
    await settle();
    await advance(INTERVAL);
    announce("Monitor");

    expect(harness.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("a hidden tab", () => {
  test("reads nothing while hidden, and once when it is looked at again", async () => {
    const harness: Harness = mount();

    setVisibility("hidden");
    announce("Incident", "Create");
    announce("Monitor");
    announce("Alert", "Delete");

    await advance(INTERVAL * 4);
    expect(harness.refresh).not.toHaveBeenCalled();

    setVisibility("visible");

    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("hidden and shown with nothing announced meanwhile reads nothing", async () => {
    const harness: Harness = mount();

    setVisibility("hidden");
    await advance(INTERVAL);
    setVisibility("visible");

    expect(harness.refresh).not.toHaveBeenCalled();
  });
});

describe("starting over and stopping", () => {
  test("another project: it listens there, and stops listening to the first", () => {
    const harness: Harness = mount();
    const count: number = active().length;

    harness.rerender({
      getTenantId: (): ObjectID => {
        return new ObjectID(OTHER_PROJECT_ID);
      },
    });

    expect(active()).toHaveLength(count);
    expect(
      active().every((subscription: Subscription): boolean => {
        return subscription.tenantId === OTHER_PROJECT_ID;
      }),
    ).toBe(true);
  });

  test("other kinds: it listens to those, and stops listening to the others", () => {
    const harness: Harness = mount({ modelTypes: [Monitor] });

    harness.rerender({ modelTypes: [Alert] });

    expect(described(active())).toEqual(
      [
        `Alert:Create:${PROJECT_ID}`,
        `Alert:Delete:${PROJECT_ID}`,
        `Alert:Update:${PROJECT_ID}`,
      ].sort(),
    );
  });

  test("once it has gone: no subscription, no read, no timer left behind", async () => {
    const harness: Harness = mount();

    announce("Monitor");
    expect(harness.refresh).toHaveBeenCalledTimes(1);

    await settle();
    announce("Monitor");

    harness.unmount();

    expect(active()).toHaveLength(0);

    await advance(INTERVAL * 2);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
