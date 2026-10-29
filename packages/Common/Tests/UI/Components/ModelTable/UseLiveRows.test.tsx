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
 * useLiveRows: a list reads its page again when the server announces a
 * change to its table - at once for the first change, at most once every
 * interval however many follow, never while the reader is busy or the tab is
 * hidden, and never after the list has gone. The live connection is faked:
 * every subscription is recorded, and a test announces a change by calling
 * what the list handed it.
 */

interface Subscription {
  modelName: string;
  eventType: string;
  tenantId: string;
  onEvent: (modelId: unknown) => void;
  isStopped: boolean;
}

const subscriptions: Array<Subscription> = [];
let isConnectionStarted: boolean = true;

jest.mock("../../../../UI/Utils/Realtime", () => {
  return {
    __esModule: true,
    default: {
      isStarted: (): boolean => {
        return isConnectionStarted;
      },
      listenToModelEvent: (
        listen: {
          modelType: { new (): { tableName: string } };
          eventType: string;
          tenantId: { toString: () => string };
        },
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
    },
  };
});

import useLiveRows, {
  UseLiveRowsOptions,
} from "../../../../UI/Components/ModelTable/UseLiveRows";
import { LiveRowsHeard } from "../../../../UI/Components/ModelTable/LiveRows";
import Incident from "../../../../Models/DatabaseModels/Incident";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ServiceLevelObjective from "../../../../Models/DatabaseModels/ServiceLevelObjective";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";

const PROJECT_ID: string = "8f2a1b3c-4d5e-4f60-9a7b-1c2d3e4f5a6b";
const OTHER_PROJECT_ID: string = "11111111-2222-4333-8444-555555555555";
const INTERVAL: number = 5000;
const RECHECK: number = 2000;
const POINTER_REST: number = 3000;

const active: () => Array<Subscription> = (): Array<Subscription> => {
  return subscriptions.filter((subscription: Subscription): boolean => {
    return !subscription.isStopped;
  });
};

const CHANGED_ID: string = "7b3b1548-23cd-46ab-8359-280eb34362af";

// Announces a change to every list listening for this kind of event.
const announce: (eventType?: string, modelId?: unknown) => void = (
  eventType: string = "Update",
  modelId: unknown = CHANGED_ID,
): void => {
  act((): void => {
    for (const subscription of active()) {
      if (subscription.eventType === eventType) {
        subscription.onEvent(modelId);
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

let visibility: DocumentVisibilityState = "visible";

const setVisibility: (state: DocumentVisibilityState) => void = (
  state: DocumentVisibilityState,
): void => {
  visibility = state;
  act((): void => {
    document.dispatchEvent(new Event("visibilitychange"));
  });
};

type RefreshFunction = (heard: LiveRowsHeard) => Promise<void>;

interface Harness {
  refresh: Mock<RefreshFunction>;
  setHeld: (held: boolean) => void;
  rerender: (options?: Partial<UseLiveRowsOptions>) => void;
  unmount: () => void;
}

const mount: (options?: Partial<UseLiveRowsOptions>) => Harness = (
  options?: Partial<UseLiveRowsOptions>,
): Harness => {
  const refresh: Mock<RefreshFunction> = jest.fn<RefreshFunction>(
    (): Promise<void> => {
      return Promise.resolve();
    },
  );
  let held: boolean = false;

  const build: (
    overrides?: Partial<UseLiveRowsOptions>,
  ) => UseLiveRowsOptions = (
    overrides?: Partial<UseLiveRowsOptions>,
  ): UseLiveRowsOptions => {
    return {
      modelType: Incident as unknown as { new (): BaseModel },
      tenantId: new ObjectID(PROJECT_ID),
      isEnabled: true,
      isHeld: (): boolean => {
        return held;
      },
      refresh: refresh,
      minIntervalInMs: INTERVAL,
      holdRecheckInMs: RECHECK,
      ...options,
      ...overrides,
    };
  };

  const view: ReturnType<typeof renderHook<void, UseLiveRowsOptions>> =
    renderHook(
      (props: UseLiveRowsOptions): void => {
        useLiveRows(props);
      },
      { initialProps: build() },
    );

  return {
    refresh,
    setHeld: (value: boolean): void => {
      held = value;
    },
    rerender: (overrides?: Partial<UseLiveRowsOptions>): void => {
      view.rerender(build(overrides));
    },
    unmount: (): void => {
      view.unmount();
    },
  };
};

beforeEach(() => {
  subscriptions.length = 0;
  isConnectionStarted = true;
  visibility = "visible";
  jest.useFakeTimers();
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

describe("what a list listens for", () => {
  test("an Incidents list hears its project's created, changed and deleted incidents", () => {
    mount();

    expect(
      active().map((subscription: Subscription): string => {
        return `${subscription.modelName} ${subscription.eventType} ${subscription.tenantId}`;
      }),
    ).toEqual([
      `Incident Create ${PROJECT_ID}`,
      `Incident Update ${PROJECT_ID}`,
      `Incident Delete ${PROJECT_ID}`,
    ]);
  });

  test("an SLO list hears only what an SLO announces: its updates", () => {
    mount({
      modelType: ServiceLevelObjective as unknown as { new (): BaseModel },
    });

    expect(
      active().map((subscription: Subscription): string => {
        return subscription.eventType;
      }),
    ).toEqual(["Update"]);
  });

  test("a Monitors list hears nothing: monitors do not announce their changes", () => {
    mount({ modelType: Monitor as unknown as { new (): BaseModel } });
    expect(active()).toEqual([]);
  });

  test("a list told to stay as loaded hears nothing", () => {
    mount({ isEnabled: false });
    expect(active()).toEqual([]);
  });

  test("outside a project nothing is heard", () => {
    mount({ tenantId: null });
    expect(active()).toEqual([]);
  });

  test("a list never opens a live connection of its own", () => {
    isConnectionStarted = false;
    mount();
    expect(subscriptions).toEqual([]);
  });

  test("a list that stops being live stops listening; the other project's list listens anew", () => {
    const harness: Harness = mount();
    expect(active()).toHaveLength(3);

    harness.rerender({ isEnabled: false });
    expect(active()).toHaveLength(0);

    harness.rerender({ tenantId: new ObjectID(OTHER_PROJECT_ID) });
    expect(
      active().map((subscription: Subscription): string => {
        return subscription.tenantId;
      }),
    ).toEqual([OTHER_PROJECT_ID, OTHER_PROJECT_ID, OTHER_PROJECT_ID]);
  });

  test("a re-render with the same table and project keeps the one subscription", () => {
    const harness: Harness = mount();
    harness.rerender();
    harness.rerender();
    expect(subscriptions).toHaveLength(3);
    expect(active()).toHaveLength(3);
  });
});

describe("when the list reads again", () => {
  test("the first change reads at once", () => {
    const harness: Harness = mount();
    announce("Create");
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a burst of changes reads once at once and once more after the interval - never once per change", async () => {
    const harness: Harness = mount();

    announce("Update");
    await advance(0);

    for (let change: number = 0; change < 50; change += 1) {
      announce("Update");
    }

    expect(harness.refresh).toHaveBeenCalledTimes(1);

    await advance(INTERVAL - 1);
    expect(harness.refresh).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(harness.refresh).toHaveBeenCalledTimes(2);

    // Nothing more without another change.
    await advance(INTERVAL * 3);
    expect(harness.refresh).toHaveBeenCalledTimes(2);
  });

  test("every kind of change reads: created, changed and deleted", async () => {
    const harness: Harness = mount();

    announce("Create");
    await advance(INTERVAL);
    announce("Update");
    await advance(INTERVAL);
    announce("Delete");

    expect(harness.refresh).toHaveBeenCalledTimes(3);
  });

  test("it reads with the latest page the table would read", async () => {
    const harness: Harness = mount();
    const later: Mock<RefreshFunction> = jest.fn<RefreshFunction>(
      (): Promise<void> => {
        return Promise.resolve();
      },
    );

    harness.rerender({ refresh: later });
    announce("Update");

    expect(harness.refresh).not.toHaveBeenCalled();
    expect(later).toHaveBeenCalledTimes(1);
  });

  /*
   * A row read in for a record announced as created is tinted for a moment
   * (BaseModelTable): the read is told which records were created since
   * the last one - and not those changed or deleted.
   */
  test("each read is told the records announced as created since the last one", async () => {
    const harness: Harness = mount();
    const first: string = "11111111-1111-4111-8111-111111111111";
    const second: string = "22222222-2222-4222-8222-222222222222";
    const third: string = "33333333-3333-4333-8333-333333333333";

    announce("Create", new ObjectID(first));
    expect(harness.refresh).toHaveBeenLastCalledWith({ createdIds: [first] });

    // Within the interval: they wait for the next read, and come with it.
    announce("Create", new ObjectID(second));
    announce("Update", new ObjectID(third));
    announce("Delete", new ObjectID(third));
    await advance(INTERVAL);

    expect(harness.refresh).toHaveBeenCalledTimes(2);
    expect(harness.refresh).toHaveBeenLastCalledWith({
      createdIds: [second],
    });

    // A change with nothing created tells of none.
    await advance(INTERVAL);
    announce("Update", new ObjectID(first));
    expect(harness.refresh).toHaveBeenLastCalledWith({ createdIds: [] });
  });

  test("a creation heard while the reader is busy is told to the read that follows", async () => {
    const harness: Harness = mount();
    const created: string = "44444444-4444-4444-8444-444444444444";
    harness.setHeld(true);

    announce("Update");
    announce("Create", new ObjectID(created));

    harness.setHeld(false);
    await advance(RECHECK);

    expect(harness.refresh).toHaveBeenCalledTimes(1);
    expect(harness.refresh).toHaveBeenLastCalledWith({
      createdIds: [created],
    });
  });

  test("a read that fails is tried again by the next change", async () => {
    const harness: Harness = mount();
    harness.refresh.mockImplementationOnce((): Promise<void> => {
      return Promise.reject(new Error("Server is not reachable"));
    });

    announce("Update");
    await advance(INTERVAL);
    announce("Update");

    expect(harness.refresh).toHaveBeenCalledTimes(2);
  });
});

describe("a change waits for the reader", () => {
  test("while the reader is busy it does not read, and reads once when they are done", async () => {
    const harness: Harness = mount();
    harness.setHeld(true);

    announce("Update");
    announce("Create");
    expect(harness.refresh).not.toHaveBeenCalled();

    // Still busy at the next look.
    await advance(RECHECK);
    expect(harness.refresh).not.toHaveBeenCalled();

    harness.setHeld(false);
    await advance(RECHECK);
    expect(harness.refresh).toHaveBeenCalledTimes(1);

    // The changes that waited are all read by that one read.
    await advance(INTERVAL * 2);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a hidden tab reads nothing, then reads once when it is looked at again", async () => {
    const harness: Harness = mount();
    setVisibility("hidden");

    announce("Update");
    announce("Update");
    await advance(INTERVAL * 4);
    expect(harness.refresh).not.toHaveBeenCalled();

    setVisibility("visible");
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a tab that comes back with nothing changed reads nothing", () => {
    const harness: Harness = mount();
    setVisibility("hidden");
    setVisibility("visible");
    expect(harness.refresh).not.toHaveBeenCalled();
  });

  test("a tab that comes back while the reader is busy waits for them too", async () => {
    const harness: Harness = mount();
    setVisibility("hidden");
    announce("Update");

    harness.setHeld(true);
    setVisibility("visible");
    expect(harness.refresh).not.toHaveBeenCalled();

    harness.setHeld(false);
    await advance(RECHECK);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });
});

/*
 * A row read in above the one under the pointer moves that one down as it
 * is clicked: the click lands on the next incident and opens it. While the
 * pointer is at work on the rows - it moved over them, or pressed on them,
 * less than a rest ago - the rows hold still; a pointer left lying on a
 * list on a wall screen holds nothing.
 */
describe("a pointer on its way to a row holds the rows", () => {
  let rows: HTMLElement;
  let row: HTMLElement;
  let elsewhere: HTMLElement;

  beforeEach(() => {
    rows = document.createElement("tbody");
    row = document.createElement("button");
    rows.appendChild(row);
    elsewhere = document.createElement("div");
    document.body.appendChild(rows);
    document.body.appendChild(elsewhere);
  });

  afterEach(() => {
    rows.remove();
    elsewhere.remove();
  });

  const point: (
    target: HTMLElement,
    type?: "pointermove" | "pointerdown",
  ) => void = (
    target: HTMLElement,
    type: "pointermove" | "pointerdown" = "pointermove",
  ): void => {
    act((): void => {
      target.dispatchEvent(new Event(type, { bubbles: true }));
    });
  };

  const mountOverRows: () => Harness = (): Harness => {
    return mount({
      getRowsElement: (): Element | null => {
        return rows;
      },
      pointerRestInMs: POINTER_REST,
    });
  };

  test("a pointer moving over the rows holds them; they read once it has rested", async () => {
    const harness: Harness = mountOverRows();

    point(row);
    announce("Create");
    expect(harness.refresh).not.toHaveBeenCalled();

    // Two seconds on: the pointer has not rested yet.
    await advance(RECHECK);
    expect(harness.refresh).not.toHaveBeenCalled();

    // Four seconds on, three of them still: the rows read.
    await advance(RECHECK);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a pointer that keeps moving keeps holding them", async () => {
    const harness: Harness = mountOverRows();

    point(row);
    announce("Update");
    await advance(RECHECK);
    point(row);
    await advance(RECHECK);
    expect(harness.refresh).not.toHaveBeenCalled();

    await advance(RECHECK);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a press on the rows holds them too", async () => {
    const harness: Harness = mountOverRows();

    point(row, "pointerdown");
    announce("Update");
    expect(harness.refresh).not.toHaveBeenCalled();

    await advance(RECHECK * 2);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a pointer that moved off the rows holds nothing", () => {
    const harness: Harness = mountOverRows();

    point(row);
    point(elsewhere);
    announce("Create");

    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a pointer resting on the rows holds nothing once it has rested", async () => {
    const harness: Harness = mountOverRows();

    point(row);
    await advance(POINTER_REST);
    announce("Create");

    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a list that names no rows is not held by the pointer", () => {
    const harness: Harness = mount({ pointerRestInMs: POINTER_REST });

    point(row);
    announce("Create");

    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("the reader's own hold and the pointer's both have to end", async () => {
    const harness: Harness = mountOverRows();
    harness.setHeld(true);

    point(row);
    announce("Update");
    await advance(RECHECK * 2);
    expect(harness.refresh).not.toHaveBeenCalled();

    harness.setHeld(false);
    await advance(RECHECK);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a list that has gone stops listening to the pointer", () => {
    const listening: Map<string, number> = new Map();
    const originalAdd: typeof document.addEventListener =
      document.addEventListener;
    const originalRemove: typeof document.removeEventListener =
      document.removeEventListener;

    document.addEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions,
    ): void => {
      listening.set(type, (listening.get(type) || 0) + 1);
      originalAdd.call(document, type, listener, options);
    };
    document.removeEventListener = (
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | EventListenerOptions,
    ): void => {
      listening.set(type, (listening.get(type) || 0) - 1);
      originalRemove.call(document, type, listener, options);
    };

    try {
      const harness: Harness = mountOverRows();

      expect(listening.get("pointermove")).toBe(1);
      expect(listening.get("pointerdown")).toBe(1);

      harness.unmount();

      for (const type of ["pointermove", "pointerdown", "visibilitychange"]) {
        expect([type, listening.get(type)]).toEqual([type, 0]);
      }
    } finally {
      document.addEventListener = originalAdd;
      document.removeEventListener = originalRemove;
    }
  });
});

describe("a list that has gone", () => {
  test("stops listening and reads nothing that was waiting", async () => {
    const harness: Harness = mount();

    announce("Update");
    await advance(0);
    announce("Update");
    expect(harness.refresh).toHaveBeenCalledTimes(1);

    harness.unmount();
    expect(active()).toEqual([]);

    await advance(INTERVAL * 2);
    expect(harness.refresh).toHaveBeenCalledTimes(1);
  });

  test("a busy reader's list that goes never reads", async () => {
    const harness: Harness = mount();
    harness.setHeld(true);
    announce("Update");

    harness.unmount();
    harness.setHeld(false);
    await advance(RECHECK * 3);

    expect(harness.refresh).not.toHaveBeenCalled();
  });

  test("stops hearing the tab come back", () => {
    const harness: Harness = mount();
    setVisibility("hidden");
    announce("Update");

    harness.unmount();
    setVisibility("visible");

    expect(harness.refresh).not.toHaveBeenCalled();
  });
});
