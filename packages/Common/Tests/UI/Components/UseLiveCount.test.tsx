import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, renderHook } from "@testing-library/react";
import fs from "fs";
import { Mock } from "jest-mock";
import path from "path";

/*
 * useLiveCount: a side-menu count counts again when the server announces a
 * change to a record of its kind - at once for the first change, at most
 * once every interval however many follow (a bulk action announces every
 * record it changed), never while the tab is hidden, and never after the
 * count has gone. The app's live connection is faked where the count asks
 * for it (LiveConnection): every subscription is recorded, and a test
 * announces a change by calling what the count handed it.
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

// What a count uses of the connection the app opened (Realtime).
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

import useLiveCount, {
  UseLiveCountOptions,
} from "../../../UI/Components/SideMenu/UseLiveCount";
import { LIVE_ROWS_MIN_INTERVAL_IN_MS } from "../../../UI/Components/ModelTable/LiveRows";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../Models/DatabaseModels/ScheduledMaintenance";
import ObjectID from "../../../Types/ObjectID";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OTHER_PROJECT_ID: string = "11111111-2222-4333-8444-555555555555";
const INTERVAL: number = 5000;

const active: () => Array<Subscription> = (): Array<Subscription> => {
  return subscriptions.filter((subscription: Subscription): boolean => {
    return !subscription.isStopped;
  });
};

// Announces a change to every count listening for this kind of event.
const announce: (eventType?: string) => void = (
  eventType: string = "Update",
): void => {
  act((): void => {
    for (const subscription of active()) {
      if (subscription.eventType === eventType) {
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

// Lets a recount that was started finish (CoalescedRefresh awaits it).
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

type RecountFunction = () => Promise<void>;

interface Harness {
  recount: Mock<RecountFunction>;
  rerender: (options?: Partial<UseLiveCountOptions>) => void;
  unmount: () => void;
}

const mount: (options?: Partial<UseLiveCountOptions>) => Harness = (
  options?: Partial<UseLiveCountOptions>,
): Harness => {
  const recount: Mock<RecountFunction> = jest.fn<RecountFunction>(
    (): Promise<void> => {
      return Promise.resolve();
    },
  );

  const build: (
    overrides?: Partial<UseLiveCountOptions>,
  ) => UseLiveCountOptions = (
    overrides?: Partial<UseLiveCountOptions>,
  ): UseLiveCountOptions => {
    return {
      modelType: Alert,
      getTenantId: (): ObjectID => {
        return new ObjectID(PROJECT_ID);
      },
      isEnabled: true,
      recount: recount,
      minIntervalInMs: INTERVAL,
      ...options,
      ...overrides,
    };
  };

  const rendered: ReturnType<
    typeof renderHook<void, { options: UseLiveCountOptions }>
  > = renderHook(
    (props: { options: UseLiveCountOptions }): void => {
      useLiveCount(props.options);
    },
    { initialProps: { options: build() } },
  );

  return {
    recount: recount,
    rerender: (overrides?: Partial<UseLiveCountOptions>): void => {
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

describe("what a count listens for", () => {
  test("the pace is the list's and the header's: once every five seconds at most", () => {
    expect(LIVE_ROWS_MIN_INTERVAL_IN_MS).toBe(5000);
  });

  test("every change the server announces for its kind, in its project", () => {
    mount();

    expect(
      active()
        .map((subscription: Subscription): string => {
          return `${subscription.modelName}:${subscription.eventType}:${subscription.tenantId}`;
        })
        .sort(),
    ).toEqual([
      `Alert:Create:${PROJECT_ID}`,
      `Alert:Delete:${PROJECT_ID}`,
      `Alert:Update:${PROJECT_ID}`,
    ]);
  });

  test.each([
    ["Incident", Incident],
    ["IncidentEpisode", IncidentEpisode],
    ["Alert", Alert],
    ["AlertEpisode", AlertEpisode],
  ])(
    "the kinds the side menus count and the server announces (%s) are heard",
    (name: string, modelType: { new (): any }) => {
      mount({ modelType: modelType });

      expect(active()).toHaveLength(3);
      expect(
        active().every((subscription: Subscription): boolean => {
          return subscription.modelName === name;
        }),
      ).toBe(true);
    },
  );

  test.each([
    ["Monitor", Monitor],
    ["ScheduledMaintenance", ScheduledMaintenance],
  ])(
    "a kind the server announces nothing for (%s) is not listened for",
    (_name: string, modelType: { new (): any }) => {
      mount({ modelType: modelType });

      expect(subscriptions).toHaveLength(0);
    },
  );

  test("nothing while there is no question to count", () => {
    mount({ isEnabled: false });

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

  test("the project is not even asked for when nothing could be heard", () => {
    const getTenantId: Mock<() => ObjectID> = jest.fn<() => ObjectID>(
      (): ObjectID => {
        return new ObjectID(PROJECT_ID);
      },
    );

    // A kind the server announces nothing for.
    mount({ modelType: Monitor, getTenantId: getTenantId });
    // No question to count yet.
    mount({ isEnabled: false, getTenantId: getTenantId });

    // No live connection.
    isConnectionStarted = false;
    mount({ getTenantId: getTenantId });

    expect(getTenantId).not.toHaveBeenCalled();
    expect(subscriptions).toHaveLength(0);
  });

  test("nothing without a kind", () => {
    mount({ modelType: undefined });

    expect(subscriptions).toHaveLength(0);
  });

  test("no connection of its own: without the app's, nothing is heard", () => {
    isConnectionStarted = false;
    mount();

    expect(subscriptions).toHaveLength(0);
  });
});

describe("counting again", () => {
  test("the first change counts at once", () => {
    const harness: Harness = mount();

    announce("Create");

    expect(harness.recount).toHaveBeenCalledTimes(1);
  });

  test("a change, a deletion and a creation are all counted", async () => {
    const harness: Harness = mount();

    announce("Update");
    await settle();
    await advance(INTERVAL);
    announce("Delete");
    await settle();
    await advance(INTERVAL);
    announce("Create");

    expect(harness.recount).toHaveBeenCalledTimes(3);
  });

  test("a bulk action's thousand announcements count twice: at once, and once after the interval", async () => {
    const harness: Harness = mount();

    for (let index: number = 0; index < 1000; index++) {
      announce("Delete");
    }

    expect(harness.recount).toHaveBeenCalledTimes(1);

    await settle();
    await advance(INTERVAL - 1);
    expect(harness.recount).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(harness.recount).toHaveBeenCalledTimes(2);

    // Nothing more was announced: nothing more is counted.
    await settle();
    await advance(INTERVAL * 3);
    expect(harness.recount).toHaveBeenCalledTimes(2);
  });

  test("a change announced while a count is still being read is counted once that read is done", async () => {
    let finish: () => void = (): void => {};
    const harness: Harness = mount();
    harness.recount.mockImplementationOnce((): Promise<void> => {
      return new Promise<void>((resolve: () => void) => {
        finish = resolve;
      });
    });

    announce("Update");
    expect(harness.recount).toHaveBeenCalledTimes(1);

    // Mid-read: this one must not be lost.
    announce("Update");
    await advance(INTERVAL * 2);
    expect(harness.recount).toHaveBeenCalledTimes(1);

    await act(async (): Promise<void> => {
      finish();
      await Promise.resolve();
    });
    await settle();
    await advance(INTERVAL);

    expect(harness.recount).toHaveBeenCalledTimes(2);
  });

  test("a recount that fails does not stop the next change being counted", async () => {
    const harness: Harness = mount();
    harness.recount.mockImplementationOnce((): Promise<void> => {
      return Promise.reject(new Error("Network error"));
    });

    announce("Update");
    await settle();
    await advance(INTERVAL);
    announce("Update");

    expect(harness.recount).toHaveBeenCalledTimes(2);
  });

  test("the recount run is always the latest one handed over", async () => {
    const first: Mock<RecountFunction> = jest.fn<RecountFunction>(
      (): Promise<void> => {
        return Promise.resolve();
      },
    );
    const harness: Harness = mount({ recount: first });

    const latest: Mock<RecountFunction> = jest.fn<RecountFunction>(
      (): Promise<void> => {
        return Promise.resolve();
      },
    );
    harness.rerender({ recount: latest });

    announce("Update");

    expect(first).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledTimes(1);
    // Handing over a new recount is not a new subscription.
    expect(subscriptions).toHaveLength(3);
  });
});

describe("a hidden tab", () => {
  test("counts nothing while hidden, and once when it is looked at again", async () => {
    const harness: Harness = mount();

    setVisibility("hidden");
    announce("Update");
    announce("Delete");
    announce("Create");

    await advance(INTERVAL * 4);
    expect(harness.recount).not.toHaveBeenCalled();

    setVisibility("visible");

    expect(harness.recount).toHaveBeenCalledTimes(1);
  });

  test("a tab hidden and shown with nothing announced meanwhile counts nothing", async () => {
    const harness: Harness = mount();

    setVisibility("hidden");
    await advance(INTERVAL);
    setVisibility("visible");

    expect(harness.recount).not.toHaveBeenCalled();
  });
});

describe("starting over and stopping", () => {
  test("another project's count listens to that project, and stops listening to the first", () => {
    const harness: Harness = mount();

    harness.rerender({
      getTenantId: (): ObjectID => {
        return new ObjectID(OTHER_PROJECT_ID);
      },
    });

    expect(
      active().every((subscription: Subscription): boolean => {
        return subscription.tenantId === OTHER_PROJECT_ID;
      }),
    ).toBe(true);
    expect(active()).toHaveLength(3);
  });

  test("a count that no longer has a question stops listening", () => {
    const harness: Harness = mount();
    expect(active()).toHaveLength(3);

    harness.rerender({ isEnabled: false });

    expect(active()).toHaveLength(0);
  });

  test("once the count has gone: no subscription, no recount, no timer left behind", async () => {
    const harness: Harness = mount();

    announce("Update");
    expect(harness.recount).toHaveBeenCalledTimes(1);

    // A second change waits for the interval...
    await settle();
    announce("Update");

    // ...and the count goes before it passes.
    harness.unmount();

    expect(active()).toHaveLength(0);

    await advance(INTERVAL * 2);
    expect(harness.recount).toHaveBeenCalledTimes(1);

    setVisibility("hidden");
    setVisibility("visible");
    expect(harness.recount).toHaveBeenCalledTimes(1);
  });
});

/*
 * A status page's subscribe menu draws a side menu and opens no live
 * connection. Importing Realtime there put it - with socket.io and the
 * analytics models - in the page's first load: about 18 KiB gzipped
 * (packages/Common/Scripts/first-load-budgets.js holds the page to it). The
 * count asks LiveConnection for the connection the app opened instead.
 */
describe("what a count loads", () => {
  test("Realtime's type alone: the connection is asked for from LiveConnection", () => {
    const source: string = fs.readFileSync(
      path.join(__dirname, "../../../UI/Components/SideMenu/UseLiveCount.ts"),
      "utf8",
    );

    const imports: Array<string> = Array.from(
      source.matchAll(
        /^import[^;]*from "\.\.\/\.\.\/Utils\/(?:Realtime|LiveConnection)";$/gm,
      ),
    ).map((match: RegExpMatchArray): string => {
      return match[0];
    });

    expect(imports).toEqual([
      'import { getOpenLiveConnection } from "../../Utils/LiveConnection";',
      'import type Realtime from "../../Utils/Realtime";',
    ]);
  });
});
