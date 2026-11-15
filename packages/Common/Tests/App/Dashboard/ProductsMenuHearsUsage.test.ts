import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ProjectProducts, {
  DELETE_SETTLE_MS,
  EXPECT_CHANGE_EVERY_MS,
  NUDGE_JITTER_MS,
  NUDGE_MIN_INTERVAL_MS,
  NUDGE_SETTLE_MS,
  REFRESH_AFTER_MS,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/ProjectProducts/ProjectProductsStore";
import ObjectID from "../../../Types/ObjectID";
import ProductKey from "../../../Types/Product/ProductKey";
import { ProductUsage } from "../../../Types/Product/ProductUsage";
import {
  ProjectProductsAnswer,
  getEmptyProjectProductsAnswer,
} from "../../../Types/Product/ProjectProductsAnswer";
import { setOpenLiveConnection } from "../../../UI/Utils/LiveConnection";
import RecordChanges, {
  RecordChangeKind,
} from "../../../UI/Utils/ModelAPI/RecordChanges";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * THE PRODUCTS MENU HEARS WHAT THE PROJECT USES CHANGE, WHEREVER IT CHANGES
 * (#8626).
 *
 * After #8204 the menu caught up at once with what this browser did - a
 * create or delete on the page, a setup guide's data, another tab - and
 * with anything else only on its next look once its answer was 15 seconds
 * old: a teammate's first monitor in their own browser, an agent's first
 * host with no guide open, a product's last record deleted by a workflow.
 * Now the server tells the project's open pages (the project's usage room,
 * on the app's live connection), and the store:
 *
 *   - joins the room from the project's first look, once;
 *   - on a change, has the next look ask whatever the answer's age;
 *   - in a tab that is shown, on that project, asks by itself once every
 *     server knows (NUDGE_SETTLE_MS, spread over NUDGE_JITTER_MS), at most
 *     once per NUDGE_MIN_INTERVAL_MS - a burst is one ask, a long stream
 *     one every NUDGE_MIN_INTERVAL_MS;
 *   - asks nothing while nothing changes, in a hidden tab, or for a
 *     project the tab has left.
 *
 * The server's side - who hears it, and how often it is said - is
 * Tests/Server/Utils/Realtime/ProjectUsageLiveUpdates.test.ts; the
 * connection's, Tests/UI/Utils/Realtime.test.ts.
 */

const PROJECT_A: string = "a1000000-0000-4000-8000-00000000a001";
const PROJECT_B: string = "b2000000-0000-4000-8000-00000000b002";

const START: number = Date.UTC(2026, 10, 15, 23, 0, 0);

const NOT_SET_UP: ProjectProductsAnswer = {
  ...getEmptyProjectProductsAnswer(),
  usage: {
    [ProductKey.Monitors]: ProductUsage.NotSetUp,
    [ProductKey.Hosts]: ProductUsage.NotSetUp,
    [ProductKey.Logs]: ProductUsage.NotSetUp,
  },
};

const withInUse: (...products: Array<ProductKey>) => ProjectProductsAnswer = (
  ...products: Array<ProductKey>
): ProjectProductsAnswer => {
  const usage: ProjectProductsAnswer["usage"] = { ...NOT_SET_UP.usage };

  for (const product of products) {
    usage[product] = ProductUsage.InUse;
  }

  return { ...NOT_SET_UP, usage: usage };
};

// A room the store joined on the fake live connection.
interface Hearing {
  tenantId: string;
  onChange: () => void;
  isStopped: boolean;
}

let hearing: Array<Hearing>;
let serverAnswer: ProjectProductsAnswer;
let asks: Array<{ projectId: string; at: number }>;
let currentProjectId: string;

const fakeLiveConnection: {
  listenToProjectUsage: (
    tenantId: ObjectID,
    onChange: () => void,
  ) => () => void;
} = {
  listenToProjectUsage: (
    tenantId: ObjectID,
    onChange: () => void,
  ): (() => void) => {
    const room: Hearing = {
      tenantId: tenantId.toString(),
      onChange: onChange,
      isStopped: false,
    };
    hearing.push(room);

    return (): void => {
      room.isStopped = true;
    };
  },
};

function asksOf(projectId: string = PROJECT_A): number {
  return asks.filter((ask: { projectId: string }): boolean => {
    return ask.projectId === projectId;
  }).length;
}

function usageOf(product: ProductKey, projectId: string = PROJECT_A): unknown {
  return ProjectProducts.getState(projectId).answer.usage[product];
}

// The server telling the project's usage room that what it uses changed.
function serverTells(projectId: string = PROJECT_A): void {
  for (const room of hearing) {
    if (room.tenantId === projectId && !room.isStopped) {
      room.onChange();
    }
  }
}

async function flush(): Promise<void> {
  for (let tick: number = 0; tick < 10; tick++) {
    await Promise.resolve();
  }
}

// The clock and the timers move on together, 50 ms at a time.
async function pass(ms: number): Promise<void> {
  for (let passed: number = 0; passed < ms; passed += 50) {
    jest.advanceTimersByTime(Math.min(50, ms - passed));
    await flush();
  }
}

async function look(projectId: string = PROJECT_A): Promise<void> {
  await ProjectProducts.load(projectId);
  await flush();
}

function setVisibility(state: "visible" | "hidden"): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: (): string => {
      return state;
    },
  });
}

beforeEach(() => {
  jest.useFakeTimers({ now: START });
  window.localStorage.clear();
  ProjectProducts.reset();
  hearing = [];
  asks = [];
  serverAnswer = NOT_SET_UP;
  currentProjectId = PROJECT_A;
  setOpenLiveConnection(fakeLiveConnection as never);
  ProjectProducts.setFetcher(
    async (projectId: ObjectID): Promise<ProjectProductsAnswer> => {
      asks.push({ projectId: projectId.toString(), at: Date.now() });
      return serverAnswer;
    },
  );
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockImplementation(() => {
    return new ObjectID(currentProjectId);
  });
  // No spread unless a test asks for one.
  jest.spyOn(Math, "random").mockReturnValue(0);
});

afterEach(() => {
  ProjectProducts.setFetcher(null);
  ProjectProducts.reset();
  setOpenLiveConnection(null as never);
  delete (document as unknown as Record<string, unknown>)["visibilityState"];
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("joining the project's usage room", () => {
  test("the project's first look joins it, once, however often the products are looked at", async () => {
    await look();
    await look();
    await pass(REFRESH_AFTER_MS);
    await look();

    expect(hearing).toEqual([
      expect.objectContaining({ tenantId: PROJECT_A, isStopped: false }),
    ]);
  });

  test("each project its own room", async () => {
    await look(PROJECT_A);
    await look(PROJECT_B);

    expect(
      hearing.map((room: Hearing): string => {
        return room.tenantId;
      }),
    ).toEqual([PROJECT_A, PROJECT_B]);
  });

  test("no live connection open (a preview, a test): nothing is joined, and a later look joins once it is", async () => {
    setOpenLiveConnection(null as never);
    await look();
    expect(hearing).toEqual([]);

    setOpenLiveConnection(fakeLiveConnection as never);
    await look();
    expect(hearing).toHaveLength(1);
  });

  test("a connection that refuses to join leaves the looks to ask, and throws nothing", async () => {
    setOpenLiveConnection({
      listenToProjectUsage: (): never => {
        throw new Error("the socket is gone");
      },
    } as never);

    await expect(ProjectProducts.load(PROJECT_A)).resolves.toBeUndefined();
    expect(asksOf()).toBe(1);
  });

  test("reset leaves the room, and a change heard after it asks nothing", async () => {
    await look();

    ProjectProducts.reset();
    expect(hearing[0]!.isStopped).toBe(true);

    hearing[0]!.onChange();
    await pass(NUDGE_MIN_INTERVAL_MS);
    expect(asksOf()).toBe(1);
  });
});

describe("a change made elsewhere", () => {
  // When the server told: the tab's last ask is long enough ago by then.
  let toldAt: number;

  beforeEach(async () => {
    await look();
    expect(asksOf()).toBe(1);
    await pass(NUDGE_MIN_INTERVAL_MS);
    toldAt = Date.now();
  });

  test("a teammate's first monitor: the tab asks NUDGE_SETTLE_MS later, by itself, and shows it", async () => {
    serverAnswer = withInUse(ProductKey.Monitors);
    serverTells();

    await pass(NUDGE_SETTLE_MS - 50);
    expect(asksOf()).toBe(1);

    await pass(50);
    expect(asksOf()).toBe(2);
    expect(asks[1]!.at - toldAt).toBe(NUDGE_SETTLE_MS);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("an agent's first host, or a workflow deleting the last monitor: the same", async () => {
    serverAnswer = withInUse(ProductKey.Hosts);
    serverTells();
    await pass(NUDGE_SETTLE_MS);
    expect(usageOf(ProductKey.Hosts)).toBe(ProductUsage.InUse);

    await pass(NUDGE_MIN_INTERVAL_MS);
    serverAnswer = NOT_SET_UP;
    serverTells();
    await pass(NUDGE_SETTLE_MS);
    expect(usageOf(ProductKey.Hosts)).toBe(ProductUsage.NotSetUp);
  });

  test("the project's open tabs are spread over NUDGE_JITTER_MS", async () => {
    (Math.random as unknown as jest.Mock).mockReturnValue(0.999);

    serverTells();
    await pass(NUDGE_SETTLE_MS + NUDGE_JITTER_MS);

    expect(asksOf()).toBe(2);
    expect(asks[1]!.at - toldAt).toBeGreaterThan(NUDGE_SETTLE_MS);
    expect(asks[1]!.at - toldAt).toBeLessThan(
      NUDGE_SETTLE_MS + NUDGE_JITTER_MS,
    );
  });

  test("a burst of changes is two asks at most: once every server knows of the first, and once for those it came too early for", async () => {
    for (let change: number = 0; change < 10; change++) {
      serverTells();
      await pass(100);
    }

    await pass(NUDGE_MIN_INTERVAL_MS * 3);

    expect(asksOf()).toBe(1 + 2);
    expect(asks[1]!.at - toldAt).toBe(NUDGE_SETTLE_MS);
    expect(asks[2]!.at - asks[1]!.at).toBe(NUDGE_MIN_INTERVAL_MS);
  });

  test("a single change is one ask", async () => {
    serverTells();
    await pass(NUDGE_MIN_INTERVAL_MS * 3);

    expect(asksOf()).toBe(1 + 1);
  });

  test("a long stream (a retention purge): one ask per NUDGE_MIN_INTERVAL_MS at most, and one after it", async () => {
    for (let second: number = 0; second < 60; second++) {
      serverTells();
      await pass(1_000);
    }

    await pass(NUDGE_MIN_INTERVAL_MS * 2);

    const nudged: Array<number> = asks.slice(1).map((ask: { at: number }) => {
      return ask.at;
    });

    expect(nudged.length).toBeGreaterThanOrEqual(6);
    expect(nudged.length).toBeLessThanOrEqual(8);

    for (let index: number = 1; index < nudged.length; index++) {
      expect(nudged[index]! - nudged[index - 1]!).toBeGreaterThanOrEqual(
        NUDGE_MIN_INTERVAL_MS,
      );
    }

    // Over: nothing more is asked.
    await pass(60_000);
    expect(asks.length).toBe(1 + nudged.length);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("asked a moment ago: the store's ask waits until NUDGE_MIN_INTERVAL_MS after that one", async () => {
    await pass(NUDGE_MIN_INTERVAL_MS);
    await ProjectProducts.refresh(PROJECT_A);
    await pass(1_000);

    serverTells();
    await pass(NUDGE_MIN_INTERVAL_MS);

    expect(asksOf()).toBe(3);
    expect(asks[2]!.at - asks[1]!.at).toBe(NUDGE_MIN_INTERVAL_MS);
  });

  test("the next look after a change asks whatever the answer's age - and then the store's own ask is not made", async () => {
    (Math.random as unknown as jest.Mock).mockReturnValue(0.999);

    serverTells();
    await pass(NUDGE_SETTLE_MS + 100);

    // A page change, the menu opened: well within REFRESH_AFTER_MS.
    serverAnswer = withInUse(ProductKey.Monitors);
    await look();
    expect(asksOf()).toBe(2);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    await pass(NUDGE_MIN_INTERVAL_MS * 2);
    expect(asksOf()).toBe(2);
  });

  test("a look before every server knows: it asks, and the store still asks once they do", async () => {
    serverTells();
    await pass(500);

    await look();
    expect(asksOf()).toBe(2);

    serverAnswer = withInUse(ProductKey.Monitors);
    await pass(NUDGE_MIN_INTERVAL_MS + NUDGE_SETTLE_MS);

    expect(asksOf()).toBe(3);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
  });

  test("a change heard while a request is out: that answer, asked too early, is followed by one more", async () => {
    let release: () => void = (): void => {};
    ProjectProducts.setFetcher(
      (projectId: ObjectID): Promise<ProjectProductsAnswer | null> => {
        asks.push({ projectId: projectId.toString(), at: Date.now() });

        return new Promise(
          (resolve: (value: ProjectProductsAnswer | null) => void) => {
            release = (): void => {
              resolve(NOT_SET_UP);
            };
          },
        );
      },
    );

    const refreshing: Promise<void> = ProjectProducts.refresh(PROJECT_A);
    await pass(100);
    serverTells();
    await pass(100);
    release();
    await refreshing;
    await flush();

    expect(asksOf()).toBe(2);
    expect(jest.getTimerCount()).toBe(1);

    ProjectProducts.setFetcher(
      async (projectId: ObjectID): Promise<ProjectProductsAnswer> => {
        asks.push({ projectId: projectId.toString(), at: Date.now() });
        return withInUse(ProductKey.Monitors);
      },
    );
    await pass(NUDGE_MIN_INTERVAL_MS);

    expect(asksOf()).toBe(3);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);
  });
});

describe("a change heard where nobody looks asks nothing", () => {
  beforeEach(async () => {
    await look();
  });

  test("a hidden tab asks nothing; shown again, its look asks once", async () => {
    setVisibility("hidden");
    serverTells();
    serverTells();
    await pass(NUDGE_MIN_INTERVAL_MS * 3);
    expect(asksOf()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);

    // useProjectProductsKeptUpToDate looks as the tab is shown.
    setVisibility("visible");
    await look();
    await look();
    expect(asksOf()).toBe(2);
  });

  test("a project the tab has left: nothing now, and its next look asks", async () => {
    currentProjectId = PROJECT_B;

    serverTells(PROJECT_A);
    await pass(NUDGE_MIN_INTERVAL_MS * 2);
    expect(asksOf(PROJECT_A)).toBe(1);

    await look(PROJECT_A);
    expect(asksOf(PROJECT_A)).toBe(2);
  });

  test("nothing changed: a minute asks nothing more, and the store keeps no timer", async () => {
    await pass(60_000);

    expect(asksOf()).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });

  test("a project nothing here has drawn is let be", async () => {
    ProjectProducts.noteUsageChangedElsewhere(PROJECT_B);
    ProjectProducts.noteUsageChangedElsewhere(null);
    await pass(NUDGE_MIN_INTERVAL_MS * 2);

    expect(asks).toHaveLength(1);
  });
});

describe("with what this page does itself", () => {
  beforeEach(async () => {
    await look();
    await pass(NUDGE_MIN_INTERVAL_MS);
  });

  test("this tab's own first monitor, told back by the server: one ask, the mark kept, and no loop", async () => {
    RecordChanges.announce({
      kind: RecordChangeKind.Created,
      tableName: "Monitor",
      projectId: PROJECT_A,
    });
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    // Another server may not have the new generation yet: the mark holds.
    serverTells();
    await pass(NUDGE_SETTLE_MS);
    expect(asksOf()).toBe(2);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.InUse);

    await pass(60_000);
    expect(asksOf()).toBe(2);
  });

  test("a change heard while a setup guide's wait asks anyway: no ask of its own on top", async () => {
    ProjectProducts.expectProductsInUse({ products: [ProductKey.Logs] });
    await flush();
    serverTells();

    await pass(EXPECT_CHANGE_EVERY_MS * 2);

    // At once, and the wait's two: the change is known to the second.
    expect(asksOf()).toBe(1 + 3);
  });

  test("a change heard while a delete settles: the delete's ask covers it", async () => {
    serverAnswer = withInUse(ProductKey.Monitors);
    await ProjectProducts.refresh(PROJECT_A);
    await pass(NUDGE_MIN_INTERVAL_MS);

    RecordChanges.announce({
      kind: RecordChangeKind.Deleted,
      tableName: "Monitor",
      projectId: PROJECT_A,
    });
    serverTells();
    serverAnswer = NOT_SET_UP;

    await pass(DELETE_SETTLE_MS + NUDGE_MIN_INTERVAL_MS);

    expect(asksOf()).toBe(3);
    expect(usageOf(ProductKey.Monitors)).toBe(ProductUsage.NotSetUp);
  });
});
