import "@testing-library/jest-dom";
/*
 * jest itself is the global one: @jest/globals types jest.spyOn() as a mock
 * the global jest.SpiedFunction annotations here do not accept.
 */
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import * as React from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";
import Route from "../../../Types/API/Route";
import {
  DataObservabilityCollector,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import ObjectID from "../../../Types/ObjectID";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { FAILED_COLLECTION_RETRY_IN_MINUTES } from "../../../Server/Utils/DataObservability/DataObservabilityProbeCollect";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  COLLECTION_CLOCK_SKEW_IN_MS,
  COLLECTION_POLL_DELAYS_IN_MS,
  COLLECTION_POLL_INTERVAL_IN_MS,
  COLLECTION_WAIT_IN_MS,
  CollectionRequest,
  getCollectionPollDelayInMs,
  hasRequestedCollectionEnded,
  hasWaitedForCollectionTooLong,
  startCollectionRequest,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/CollectionProgress";
import DataObservabilityApi, {
  DataObservabilityApiError,
} from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataObservabilityApi";
import StoreStatusPill from "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/StoreStatusPill";
import DataObservabilityStoresPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/Stores";
import StoreOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/Overview";
import { StoreViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/StoreViewContext";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";

jest.setTimeout(60000);

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

// The Databases list's other cards read routes of their own: pinned elsewhere, nothing here.
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/WatchedTablesCost",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/DataSourceSuggestionsCard",
  () => {
    return {
      __esModule: true,
      default: () => {
        return null;
      },
    };
  },
);

/*
 * The store's record line (who created it and who last modified it,
 * #10461) reads the store's activity columns itself: pinned in
 * OverviewRecordLines, nothing here.
 */
jest.mock("../../../UI/Components/Detail/RecordActivityLine", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

/*
 * COLLECT NOW, PRESSED AFTER A COLLECTION FAILED (#9506).
 *
 * The person who saw "Collection failed" presses Collect Now and must see
 * that it is collecting, then how it went - collected, or failed again,
 * with when it tried - without reloading the page. Collect Now only queues
 * the collection, so the page reads the store again, often at first and
 * then less, until the store says a collection ended after it was asked
 * for (attemptedAt), and stops waiting after as long as a collection may
 * take. The store's page and the Databases list do the same.
 */

const STORE_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-11-18T12:00:00.000Z");
const FAILURE: string =
  "Dataverse answered 500 while listing the tables (EntityDefinitions), with no error message. Tried 3 times.";

function minutesAgo(minutes: number): string {
  return new Date(NOW.getTime() - minutes * 60 * 1000).toISOString();
}

function secondsLater(seconds: number): string {
  return new Date(NOW.getTime() + seconds * 1000).toISOString();
}

function store(
  fields: Partial<DataObservabilityStoreSummary> = {},
): DataObservabilityStoreSummary {
  return {
    dataStoreId: STORE_ID,
    name: "contoso",
    kind: "Microsoft Dataverse",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Failed",
    message: FAILURE,
    collectedAt: null,
    attemptedAt: minutesAgo(10),
    assetCount: 0,
    lateAssetCount: 0,
    alertMonitorCount: 0,
    ...fields,
  };
}

const COLLECTED: Partial<DataObservabilityStoreSummary> = {
  status: "Collected",
  message: null,
  collectedAt: secondsLater(1),
  attemptedAt: secondsLater(2),
  assetCount: 5,
};

describe("what Collect Now waits for", () => {
  const before: DataObservabilityStoreSummary = store();
  const request: CollectionRequest = startCollectionRequest({
    store: before,
    requestedAt: NOW.toISOString(),
    nowMs: NOW.getTime(),
  });

  test("the store as it stood: no collection has ended yet", () => {
    expect(hasRequestedCollectionEnded(before, request)).toBe(false);
  });

  test("a collection that ended after it was asked for has ended, collected or failed", () => {
    expect(hasRequestedCollectionEnded(store(COLLECTED), request)).toBe(true);
    expect(
      hasRequestedCollectionEnded(
        store({ attemptedAt: secondsLater(3) }),
        request,
      ),
    ).toBe(true);
  });

  test("a worker whose clock runs a little behind still ends it", () => {
    expect(
      hasRequestedCollectionEnded(
        store({
          attemptedAt: new Date(
            NOW.getTime() - COLLECTION_CLOCK_SKEW_IN_MS / 2,
          ).toISOString(),
        }),
        request,
      ),
    ).toBe(true);
  });

  test("a collection the schedule ran well before, on a page left open, is not the one asked for", () => {
    const stale: CollectionRequest = startCollectionRequest({
      store: store({ attemptedAt: minutesAgo(30) }),
      requestedAt: NOW.toISOString(),
      nowMs: NOW.getTime(),
    });

    expect(
      hasRequestedCollectionEnded(
        store({ attemptedAt: minutesAgo(10) }),
        stale,
      ),
    ).toBe(false);
  });

  test("from a server that keeps no attemptedAt: a new collectedAt, or any new time when it says no time", () => {
    const older: CollectionRequest = startCollectionRequest({
      store: store({ attemptedAt: undefined, collectedAt: minutesAgo(20) }),
      requestedAt: null,
      nowMs: NOW.getTime(),
    });

    expect(
      hasRequestedCollectionEnded(
        store({ attemptedAt: undefined, collectedAt: minutesAgo(20) }),
        older,
      ),
    ).toBe(false);
    expect(
      hasRequestedCollectionEnded(
        store({ attemptedAt: undefined, collectedAt: secondsLater(5) }),
        older,
      ),
    ).toBe(true);
  });

  test("looked at often at first, then every fifteen seconds, for seven minutes at most", () => {
    expect(
      COLLECTION_POLL_DELAYS_IN_MS.map((_: number, index: number) => {
        return getCollectionPollDelayInMs(index);
      }),
    ).toEqual([2_000, 3_000, 5_000, 5_000, 10_000]);
    expect(getCollectionPollDelayInMs(5)).toBe(COLLECTION_POLL_INTERVAL_IN_MS);
    expect(getCollectionPollDelayInMs(50)).toBe(15_000);
    expect(
      hasWaitedForCollectionTooLong(request, NOW.getTime() + 6 * 60 * 1000),
    ).toBe(false);
    expect(
      hasWaitedForCollectionTooLong(
        request,
        NOW.getTime() + COLLECTION_WAIT_IN_MS,
      ),
    ).toBe(true);
  });
});

describe("the store's status while it collects", () => {
  afterEach(() => {
    cleanup();
  });

  test("Collecting, with a pulse, until it ends", () => {
    render(<StoreStatusPill store={store()} isCollecting={true} />);

    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(screen.getByTestId("pill-dot-pulse")).toBeInTheDocument();
    expect(screen.queryByText("Collection failed")).not.toBeInTheDocument();
  });

  test("a database nobody watches is not watched, whatever was asked", () => {
    render(
      <StoreStatusPill
        store={store({ isTableHealthEnabled: false })}
        isCollecting={true}
      />,
    );

    expect(screen.getByText("Not watched")).toBeInTheDocument();
  });
});

// The store's page, inside a layout that reads the store again when asked, from the reads queued.
let queuedReads: Array<DataObservabilityStoreSummary> = [];
let reads: number = 0;

function StoreLayout(props: {
  initial: DataObservabilityStoreSummary;
}): React.ReactElement {
  const [current, setCurrent] = React.useState<DataObservabilityStoreSummary>(
    props.initial,
  );
  const refresh: () => void = React.useCallback((): void => {
    reads++;

    const next: DataObservabilityStoreSummary | undefined = queuedReads.shift();

    if (next) {
      setCurrent(next);
    }
  }, []);
  const context: StoreViewOutletContext = {
    dataStoreId: new ObjectID(STORE_ID),
    store: current,
    refresh,
  };

  return <Outlet context={context} />;
}

const pageProps: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/data-observability`),
  currentProject: null,
  hasPaymentMethod: true,
};

async function openStorePage(
  initial: DataObservabilityStoreSummary,
): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter initialEntries={["/store"]}>
        <Routes>
          <RouterRoute
            path="/store"
            element={<StoreLayout initial={initial} />}
          >
            <RouterRoute index element={<StoreOverviewPage {...pageProps} />} />
          </RouterRoute>
        </Routes>
      </MemoryRouter>,
    );
  });
}

async function pressCollectNow(): Promise<void> {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: /Collect Now/ }));
  });
}

// Lets the page's timers run, then the reads they started.
async function wait(ms: number): Promise<void> {
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const LAST_TRIED: RegExp =
  /^Last tried .+\. OneUptime tries again every 15 minutes until it collects\.$/;

describe("Collect Now on the store's page, after a failed collection", () => {
  let collectNowSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    goTo(`/dashboard/${PROJECT_ID}/data-observability`);
    queuedReads = [];
    reads = 0;
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      new ObjectID(PROJECT_ID),
    );
    getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
      return;
    });
    collectNowSpy = getJestSpyOn(
      DataObservabilityApi,
      "collectNow",
    ).mockResolvedValue(NOW.toISOString());
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("the failure says what Dataverse answered, when it last tried, and that it tries again by itself", async () => {
    await openStorePage(store());

    expect(screen.getByText("Collection failed")).toBeInTheDocument();
    expect(screen.getByText(FAILURE)).toBeInTheDocument();
    expect(screen.getByText(LAST_TRIED)).toBeInTheDocument();
    // The sentence's fifteen minutes are the server's.
    expect(FAILED_COLLECTION_RETRY_IN_MINUTES).toBe(15);
  });

  test("it collects, then shows that it collected, without reloading", async () => {
    await openStorePage(store());

    // The first read after the press still has the failure: the collection runs.
    queuedReads = [store(), store(COLLECTED)];
    await pressCollectNow();

    expect(collectNowSpy).toHaveBeenCalledTimes(1);
    expect(String(collectNowSpy.mock.calls[0]![0])).toBe(STORE_ID);
    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(
      screen.getByText(
        "Collecting now. This page shows how it went when it ends.",
      ),
    ).toBeInTheDocument();
    // The old failure gives way while it runs, and the button waits.
    expect(screen.queryByText(FAILURE)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Collect Now/ })).toBeDisabled();

    await wait(2_000);

    expect(screen.getByText("Collected")).toBeInTheDocument();
    expect(screen.queryByText("Collecting")).not.toBeInTheDocument();
    expect(screen.queryByText(FAILURE)).not.toBeInTheDocument();
    expect(screen.queryByText(LAST_TRIED)).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Collect Now/ }),
    ).not.toBeDisabled();

    // Nothing is read again once it ended.
    const readsWhenEnded: number = reads;

    await wait(60_000);

    expect(reads).toBe(readsWhenEnded);
  });

  test("it fails again: the failure is back, with the time it tried just now", async () => {
    await openStorePage(store());

    queuedReads = [store(), store({ attemptedAt: secondsLater(3) })];
    await pressCollectNow();
    await wait(2_000);

    expect(screen.queryByText("Collecting")).not.toBeInTheDocument();
    expect(screen.getByText("Collection failed")).toBeInTheDocument();
    expect(screen.getByText(FAILURE)).toBeInTheDocument();
    expect(screen.getByText(LAST_TRIED)).toBeInTheDocument();
  });

  test("a collection that takes longer than any should stops being waited for, and says so", async () => {
    await openStorePage(store());

    await pressCollectNow();
    await wait(COLLECTION_WAIT_IN_MS + 20_000);

    expect(screen.queryByText("Collecting")).not.toBeInTheDocument();
    expect(
      screen.getByText(
        "The collection is taking longer than usual. Come back in a few minutes to see how it went.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /Collect Now/ }),
    ).not.toBeDisabled();
    // Read often at first, then every fifteen seconds: a few dozen reads in seven minutes, then none.
    expect(reads).toBeGreaterThan(20);
    expect(reads).toBeLessThan(40);

    const readsWhenStopped: number = reads;

    await wait(10 * 60_000);

    expect(reads).toBe(readsWhenStopped);
  });

  test("a probe's database says its probe collects it at its next check", async () => {
    await openStorePage(
      store({
        collector: DataObservabilityCollector.Probe,
        probeName: "eu-probe",
      }),
    );

    await pressCollectNow();

    expect(
      screen.getByText(
        "Probe eu-probe collects it at its next check, within five minutes. This page shows how it went.",
      ),
    ).toBeInTheDocument();
  });

  test("a Collect Now the server refuses says why, and nothing is waited for", async () => {
    collectNowSpy.mockRejectedValue(
      new DataObservabilityApiError(
        "You do not have permission to do this in Data Observability.",
        403,
      ),
    );
    await openStorePage(store());

    await pressCollectNow();

    expect(
      screen.getAllByText(/You do not have permission to do this/).length,
    ).toBeGreaterThan(0);
    expect(screen.queryByText("Collecting")).not.toBeInTheDocument();
    expect(screen.getByText("Collection failed")).toBeInTheDocument();

    await wait(30_000);

    expect(reads).toBe(0);
  });
});

describe("Collect Now in the Databases list", () => {
  let storesRead: Array<Array<DataObservabilityStoreSummary>>;
  let storeReads: number;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    goTo(`/dashboard/${PROJECT_ID}/data-observability/databases`);
    storeReads = 0;
    getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
      new ObjectID(PROJECT_ID),
    );
    getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
    jest.spyOn(Navigation, "navigate").mockImplementation((): void => {
      return;
    });
    getJestSpyOn(DataObservabilityApi, "getStores").mockImplementation(
      async (): Promise<Array<DataObservabilityStoreSummary>> => {
        storeReads++;

        return storesRead.length > 1 ? storesRead.shift()! : storesRead[0]!;
      },
    );
    getJestSpyOn(DataObservabilityApi, "collectNow").mockResolvedValue(
      NOW.toISOString(),
    );
  });

  afterEach(() => {
    cleanup();
    jest.useRealTimers();
    jest.restoreAllMocks();
  });

  test("a failed database collects, then says it collected, in its row", async () => {
    storesRead = [[store()], [store()], [store(COLLECTED)]];

    await act(async () => {
      render(
        <MemoryRouter>
          <DataObservabilityStoresPage {...pageProps} />
        </MemoryRouter>,
      );
    });

    expect(screen.getByText("Collection failed")).toBeInTheDocument();
    expect(screen.getByText(FAILURE)).toBeInTheDocument();
    expect(screen.getByText(LAST_TRIED)).toBeInTheDocument();

    await pressCollectNow();

    expect(screen.getByText("Collecting")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Collect Now/ })).toBeDisabled();

    await wait(2_000);

    expect(screen.getByText("Collected")).toBeInTheDocument();
    expect(screen.queryByText(FAILURE)).not.toBeInTheDocument();
    expect(storeReads).toBe(3);
  });
});
