import "@testing-library/jest-dom";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import React, { ReactElement } from "react";
import { ErrorBoundary } from "react-error-boundary";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { Mock } from "jest-mock";

/*
 * THE BUDGET BANNER NEVER TAKES THE EXPLORER UNDER IT DOWN (#7167).
 *
 * Each explorer's layout - Logs, Traces, Metrics, Profiles, Security
 * Events - draws the daily ingestion budget banner above every page under
 * it. #6486 showed what a throw in the banner did: React unmounted the
 * whole layout, and the explorer went blank. PR #7138 fixed that cause
 * (an answer that is not a status draws nothing); these hold the next one,
 * whatever it is - a formatter, a translation, a date in an odd zone - to
 * the banner's own place: the banner is a part of its own
 * (ContainedErrorBoundary), and a part that failed draws nothing.
 *
 * The throw comes from the signal's title (TelemetryUsageWords), which the
 * banner words every notice with: as a bug there would, it throws while the
 * banner draws, after its status has arrived.
 */

let titleThrows: Error | null = null;

jest.mock("../../../../UI/Components/TelemetryUsage/TelemetryUsageWords", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Components/TelemetryUsage/TelemetryUsageWords",
  );

  return {
    ...actual,
    getTelemetryUsageSignalTitle: (...args: Array<unknown>): string => {
      if (titleThrows) {
        throw titleThrows;
      }

      return (
        actual["getTelemetryUsageSignalTitle"] as (
          ...callArgs: Array<unknown>
        ) => string
      )(...args);
    },
  };
});

import TelemetryIngestionBudgetBanner, {
  TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID,
  UnguardedTelemetryIngestionBudgetBanner,
} from "../../../../UI/Components/TelemetryIngestionBudget/TelemetryIngestionBudgetBanner";
import { CHUNK_LOAD_RELOAD_STORAGE_KEY } from "../../../../UI/Components/ErrorBoundary";
import Route from "../../../../Types/API/Route";
import {
  TelemetryIngestionBudgetState,
  TelemetryIngestionBudgetStatus,
} from "../../../../Types/Telemetry/TelemetryIngestionBudget";
import NewVersion from "../../../../UI/Utils/NewVersion/NewVersion";
import { budgeted, LOGS, status, TRACES } from "./TelemetryIngestionBudgetFixtures";

const EXPLORER_TEST_ID: string = "explorer-under-the-banner";

const BUDGETS_ROUTE: Route = new Route(
  "/dashboard/project/settings/usage-history",
);

// What a bug in the banner's own code throws while it draws.
const DRAWING_BUG: Error = new TypeError(
  "Cannot read properties of undefined (reading 'title')",
);

// The banner's code did not download: a new version went out meanwhile.
const MISSING_CODE: Error = new Error(
  "Failed to fetch dynamically imported module: /dashboard/dist/chunk-BUDGET.js",
);

// Today's Logs budget used up: the banner has something to say.
const usedUp: () => TelemetryIngestionBudgetStatus =
  (): TelemetryIngestionBudgetStatus => {
    return status({
      project: [
        budgeted(LOGS, { state: TelemetryIngestionBudgetState.Exhausted }),
        budgeted(TRACES, { state: TelemetryIngestionBudgetState.Exhausted }),
      ],
    });
  };

type FetchStatus = Mock<() => Promise<TelemetryIngestionBudgetStatus>>;

const ORIGINAL_LOCATION: Location = window.location;
let reloadMock: Mock<() => void>;
let consoleErrors: ReturnType<typeof jest.spyOn>;
let consoleWarnings: ReturnType<typeof jest.spyOn>;

// What was logged as an error, but React's notice that act() is deprecated.
function errorsLogged(): Array<string> {
  return consoleErrors.mock.calls
    .map((call: Array<unknown>): string => {
      return call
        .map((part: unknown): string => {
          return part instanceof Error ? part.message : String(part);
        })
        .join(" ");
    })
    .filter((text: string): boolean => {
      return !text.includes("ReactDOMTestUtils.act");
    });
}

// The banner over an explorer, as each explorer's layout draws it.
async function drawOverExplorer(data: {
  banner: typeof TelemetryIngestionBudgetBanner;
  signal?: typeof LOGS;
  fetchStatus?: FetchStatus;
}): Promise<FetchStatus> {
  const fetchStatus: FetchStatus =
    data.fetchStatus ||
    jest.fn(async (): Promise<TelemetryIngestionBudgetStatus> => {
      return usedUp();
    });
  const Banner: typeof TelemetryIngestionBudgetBanner = data.banner;

  render(
    <div>
      <Banner
        signal={data.signal || LOGS}
        fetchStatus={fetchStatus}
        budgetsRoute={BUDGETS_ROUTE}
      />
      <p data-testid={EXPLORER_TEST_ID}>Log lines</p>
    </div>,
  );

  await waitFor(() => {
    expect(fetchStatus).toHaveBeenCalledTimes(1);
  });
  // Let the answer land, and the banner draw what it makes of it.
  await act(async () => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });

  return fetchStatus;
}

beforeEach(() => {
  titleThrows = null;
  window.sessionStorage.clear();
  NewVersion.reset();
  reloadMock = jest.fn<() => void>();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...ORIGINAL_LOCATION, reload: reloadMock },
  });
  consoleErrors = jest.spyOn(console, "error").mockImplementation(() => {
    // Recorded, not printed: the tests read them (errorsLogged).
  });
  consoleWarnings = jest.spyOn(console, "warn").mockImplementation(() => {
    // A part whose code did not download is warned of; not printed.
  });
});

afterEach(() => {
  cleanup();
  NewVersion.reset();
  consoleErrors.mockRestore();
  consoleWarnings.mockRestore();
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: ORIGINAL_LOCATION,
  });
});

describe("the budget banner over an explorer", () => {
  test("draws its notice while nothing goes wrong", async () => {
    await drawOverExplorer({ banner: TelemetryIngestionBudgetBanner });

    expect(
      screen.getByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toHaveTextContent("today's ingestion budget of 10 GB is used up");
    expect(screen.getByTestId(EXPLORER_TEST_ID)).toHaveTextContent("Log lines");
    expect(errorsLogged()).toEqual([]);
  });

  test("a throw while it draws takes only its place: no banner, and the explorer whole", async () => {
    titleThrows = DRAWING_BUG;

    await drawOverExplorer({ banner: TelemetryIngestionBudgetBanner });

    expect(screen.getByTestId(EXPLORER_TEST_ID)).toHaveTextContent("Log lines");
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toBeNull();
    // Nothing in the banner's place either: no fallback, no "Try again".
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    // Caught by the banner's own boundary, which says what it caught.
    expect(
      errorsLogged().some((text: string): boolean => {
        return (
          text.includes("Uncaught error rendering part of the page") &&
          text.includes(DRAWING_BUG.message)
        );
      }),
    ).toBe(true);
  });

  /*
   * The control: the same throw with no boundary around the banner takes
   * the explorer with it, as #6486 did - so the throw above is a real one.
   */
  test("without its boundary, the same throw takes the explorer down", async () => {
    titleThrows = DRAWING_BUG;

    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return usedUp();
      },
    );

    /*
     * Nothing between the banner and the app's own boundary, which
     * replaces the whole page with its support screen.
     */
    render(
      <ErrorBoundary
        fallbackRender={(): ReactElement => {
          return <p data-testid="app-error-screen">Something went wrong</p>;
        }}
      >
        <div>
          <UnguardedTelemetryIngestionBudgetBanner
            signal={LOGS}
            fetchStatus={fetchStatus}
            budgetsRoute={BUDGETS_ROUTE}
          />
          <p data-testid={EXPLORER_TEST_ID}>Log lines</p>
        </div>
      </ErrorBoundary>,
    );

    expect(await screen.findByTestId("app-error-screen")).toBeInTheDocument();
    expect(screen.queryByTestId(EXPLORER_TEST_ID)).toBeNull();
  });

  /*
   * A notice whose code did not download draws nothing, as any other
   * failure of it does: it does not say, in the explorer's place, that the
   * latest version is loading, nor reload the page for a notice.
   */
  test("a banner whose code did not download draws nothing, and does not reload the page", async () => {
    titleThrows = MISSING_CODE;

    await drawOverExplorer({ banner: TelemetryIngestionBudgetBanner });

    expect(screen.getByTestId(EXPLORER_TEST_ID)).toHaveTextContent("Log lines");
    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toBeNull();
    expect(screen.queryByTestId("chunk-load-recovery")).toBeNull();
    expect(reloadMock).not.toHaveBeenCalled();
    expect(
      window.sessionStorage.getItem(CHUNK_LOAD_RELOAD_STORAGE_KEY),
    ).toBeNull();
  });

  test("another signal's banner tries again, and draws once it can", async () => {
    titleThrows = DRAWING_BUG;

    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return usedUp();
      },
    );

    const { rerender } = render(
      <div>
        <TelemetryIngestionBudgetBanner
          signal={LOGS}
          fetchStatus={fetchStatus}
          budgetsRoute={BUDGETS_ROUTE}
        />
        <p data-testid={EXPLORER_TEST_ID}>Log lines</p>
      </div>,
    );

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(
      screen.queryByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toBeNull();

    titleThrows = null;

    rerender(
      <div>
        <TelemetryIngestionBudgetBanner
          signal={TRACES}
          fetchStatus={fetchStatus}
          budgetsRoute={BUDGETS_ROUTE}
        />
        <p data-testid={EXPLORER_TEST_ID}>Spans</p>
      </div>,
    );

    expect(
      await screen.findByTestId(TELEMETRY_INGESTION_BUDGET_BANNER_TEST_ID),
    ).toHaveTextContent("today's ingestion budget of 10 GB is used up");
    expect(screen.getByTestId(EXPLORER_TEST_ID)).toHaveTextContent("Spans");
  });
});

// The fallback a notice draws: nothing at all, not an empty box.
describe("what a failed banner leaves", () => {
  test("is no element: the explorer starts where the page's content does", async () => {
    titleThrows = DRAWING_BUG;

    const fetchStatus: FetchStatus = jest.fn(
      async (): Promise<TelemetryIngestionBudgetStatus> => {
        return usedUp();
      },
    );

    const { container } = render(
      <TelemetryIngestionBudgetBanner
        signal={LOGS}
        fetchStatus={fetchStatus}
        budgetsRoute={BUDGETS_ROUTE}
      />,
    );

    await waitFor(() => {
      expect(fetchStatus).toHaveBeenCalledTimes(1);
    });
    await act(async () => {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    });

    expect(container).toBeEmptyDOMElement();
  });
});
