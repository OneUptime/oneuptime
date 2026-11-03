import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import HuntRunHistory from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntRunHistory";
import {
  HUNTS_TEST_IDS,
  RUN_HISTORY_DESCRIPTION,
  RUN_HISTORY_TITLE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import SecurityHuntRun from "../../../Models/DatabaseModels/SecurityHuntRun";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import {
  SECURITY_HUNT_RUN_ERRORS,
  SecurityHuntRunResult,
  SecurityHuntRunWindow,
} from "../../../Types/SecurityEvent/SecurityHunt";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import OneUptimeDate from "../../../Types/Date";

/*
 * A HUNT'S RUN HISTORY (HuntRunHistory), beside its page: every scheduled
 * run of the last 90 days, newest first, ten at a time - when it ran and
 * the events it searched, then what it found with Show them (that run's
 * window on the explorer), that it found nothing, or, in red, why it could
 * not run.
 */

const HUNT_ID: ObjectID = new ObjectID("3b000000-0000-4000-8000-000000000001");
const HOUR: number = 60 * 60 * 1000;
// How a button is found by what it says or is called.
const NEXT_PAGE: RegExp = /next/i;
const CLOSE: RegExp = /close/i;

function run(
  id: string,
  values: {
    hoursAgo: number;
    eventCount?: number | null;
    error?: string | null;
  },
): SecurityHuntRun {
  const item: SecurityHuntRun = new SecurityHuntRun();
  item._id = id;
  item.createdAt = new Date(Date.now() - values.hoursAgo * HOUR);
  item.windowEndAt = new Date(Date.now() - values.hoursAgo * HOUR - 2 * 60000);
  item.windowStartAt = new Date(
    item.windowEndAt.getTime() - 24 * HOUR + 2 * 60000,
  );
  // A run that could not be made found no count: it says why instead.
  if (values.eventCount !== null) {
    item.eventCount = values.eventCount || 0;
  }

  if (values.error) {
    item.error = values.error;
  }

  return item;
}

const FOUND: SecurityHuntRun = run("a1000000-0000-4000-8000-000000000001", {
  hoursAgo: 1,
  eventCount: 3,
});
const NOTHING: SecurityHuntRun = run("a1000000-0000-4000-8000-000000000002", {
  hoursAgo: 25,
  eventCount: 0,
});
const FAILED: SecurityHuntRun = run("a1000000-0000-4000-8000-000000000003", {
  hoursAgo: 49,
  eventCount: null,
  error: SECURITY_HUNT_RUN_ERRORS.timedOut.message,
});

let runs: Array<SecurityHuntRun>;
let count: number;
let reads: Array<Record<string, unknown>>;
let readFailure: Error | null;
let shown: Array<SecurityHuntRunWindow>;
let closed: number;

beforeEach(() => {
  runs = [FOUND, NOTHING, FAILED];
  count = 3;
  reads = [];
  readFailure = null;
  shown = [];
  closed = 0;

  jest.spyOn(ModelAPI, "getList").mockImplementation((async (
    options: Record<string, unknown>,
  ) => {
    reads.push(options);

    if (readFailure) {
      throw readFailure;
    }

    return { data: runs, count, skip: options["skip"], limit: 10 };
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

async function renderPanel(): Promise<void> {
  await act(async () => {
    render(
      <MemoryRouter>
        <HuntRunHistory
          huntId={HUNT_ID}
          onClose={() => {
            closed++;
          }}
          onShowWindow={(window: SecurityHuntRunWindow) => {
            shown.push(window);
          }}
        />
      </MemoryRouter>,
    );
  });

  await waitFor(() => {
    expect(
      screen.queryByTestId(`${HUNTS_TEST_IDS.runRow}-${FOUND._id}`),
    ).not.toBeNull();
  });
}

function runRow(item: SecurityHuntRun): HTMLElement {
  return screen.getByTestId(`${HUNTS_TEST_IDS.runRow}-${item._id}`);
}

describe("a hunt's Run History", () => {
  test("is a panel beside the page, titled, saying how long runs are kept", async () => {
    await renderPanel();

    expect(screen.getByText(RUN_HISTORY_TITLE)).toBeInTheDocument();
    expect(screen.getByText(RUN_HISTORY_DESCRIPTION)).toBeInTheDocument();
    expect(screen.getByTestId(HUNTS_TEST_IDS.runHistory)).toBeInTheDocument();
  });

  test("reads the hunt's runs, newest first, ten at a time - only what a row draws", async () => {
    await renderPanel();

    expect(reads).toHaveLength(1);
    expect(reads[0]!["modelType"]).toBe(SecurityHuntRun);
    expect(reads[0]!["query"]).toEqual({ securityHuntId: HUNT_ID });
    expect(reads[0]!["sort"]).toEqual({ createdAt: SortOrder.Descending });
    expect(reads[0]!["skip"]).toBe(0);
    expect(reads[0]!["limit"]).toBe(10);
    expect(reads[0]!["select"]).toEqual({
      _id: true,
      createdAt: true,
      windowStartAt: true,
      windowEndAt: true,
      eventCount: true,
      error: true,
    });
  });

  test("a row each run, in the order read, each saying what it found", async () => {
    await renderPanel();

    expect(runRow(FOUND)).toHaveAttribute(
      "data-state",
      SecurityHuntRunResult.Found,
    );
    expect(runRow(NOTHING)).toHaveAttribute(
      "data-state",
      SecurityHuntRunResult.NothingFound,
    );
    expect(runRow(FAILED)).toHaveAttribute(
      "data-state",
      SecurityHuntRunResult.Failed,
    );

    const rows: Array<HTMLElement> = Array.from(
      document.querySelectorAll(`[data-testid^="${HUNTS_TEST_IDS.runRow}-a1"]`),
    );

    expect(
      rows.map((element: HTMLElement): string | null => {
        return element.getAttribute("data-testid");
      }),
    ).toEqual([
      `${HUNTS_TEST_IDS.runRow}-${FOUND._id}`,
      `${HUNTS_TEST_IDS.runRow}-${NOTHING._id}`,
      `${HUNTS_TEST_IDS.runRow}-${FAILED._id}`,
    ]);
  });

  test("a run that found events says how many, with Show them", async () => {
    await renderPanel();

    const found: HTMLElement = within(runRow(FOUND)).getByTestId(
      `${HUNTS_TEST_IDS.runRow}-found`,
    );

    expect(found).toHaveTextContent("3 events");
    expect(
      within(found).getByTestId(HUNTS_TEST_IDS.runShowThem),
    ).toHaveTextContent("Show them");
  });

  test("Show them hands over that run's window - the events it searched", async () => {
    await renderPanel();

    await act(async () => {
      fireEvent.click(
        within(runRow(FOUND)).getByTestId(HUNTS_TEST_IDS.runShowThem),
      );
    });

    expect(shown).toEqual([
      { startTime: FOUND.windowStartAt, endTime: FOUND.windowEndAt },
    ]);
  });

  test("a run that found nothing says so, and offers nothing to show", async () => {
    await renderPanel();

    expect(
      within(runRow(NOTHING)).getByTestId(`${HUNTS_TEST_IDS.runRow}-found`),
    ).toHaveTextContent("Nothing found");
    expect(
      within(runRow(NOTHING)).queryByTestId(HUNTS_TEST_IDS.runShowThem),
    ).toBeNull();
  });

  test("a run that could not run says so in red, and why", async () => {
    await renderPanel();

    const failed: HTMLElement = within(runRow(FAILED)).getByTestId(
      `${HUNTS_TEST_IDS.runRow}-found`,
    );

    expect(failed).toHaveTextContent("Couldn't run");
    expect(failed).toHaveTextContent(SECURITY_HUNT_RUN_ERRORS.timedOut.message);
    expect(failed.innerHTML).toContain("text-red-700");
    expect(
      within(runRow(FAILED)).queryByTestId(HUNTS_TEST_IDS.runShowThem),
    ).toBeNull();
  });

  test("each run says the events it searched, from its window's start to its end", async () => {
    await renderPanel();

    const times: Array<string | null> = Array.from(
      runRow(FOUND).querySelectorAll("time"),
    ).map((element: Element): string | null => {
      return element.getAttribute("datetime");
    });

    // When it ran - the moment, and how long ago - then the window it searched.
    expect(times).toEqual([
      new Date(FOUND.createdAt!).toISOString(),
      new Date(FOUND.createdAt!).toISOString(),
      FOUND.windowStartAt!.toISOString(),
      FOUND.windowEndAt!.toISOString(),
    ]);
    expect(runRow(FOUND)).toHaveTextContent(/Searched .+ to .+/);
  });

  test("writes each moment as every list writes a date: short, and whole under the pointer", async () => {
    await renderPanel();

    const times: Array<Element> = Array.from(
      runRow(FOUND).querySelectorAll("time"),
    );

    // When it ran, "1 hour ago" beside it, then the window's start and end.
    expect(times).toHaveLength(4);

    const moments: Array<Element> = [times[0]!, times[2]!, times[3]!];
    const dates: Array<Date> = [
      new Date(FOUND.createdAt!),
      FOUND.windowStartAt!,
      FOUND.windowEndAt!,
    ];

    moments.forEach((moment: Element, index: number) => {
      const date: Date = dates[index]!;

      // "Oct 14, 10:00 AM": the year only when it is not this year's, no zone.
      expect(moment.textContent).toBe(
        OneUptimeDate.getDateAsCompactLocalString(date),
      );
      // "Oct 14 2026, 10:00 AM GMT", for whoever wants the whole of it.
      expect(moment.getAttribute("title")).toBe(
        OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(date),
      );
      expect(moment.textContent).not.toBe(moment.getAttribute("title"));
    });
  });

  test("with no runs yet, says so, and when they will be listed", async () => {
    runs = [];
    count = 0;

    await act(async () => {
      render(
        <MemoryRouter>
          <HuntRunHistory
            huntId={HUNT_ID}
            onClose={() => {
              closed++;
            }}
            onShowWindow={() => {
              // Nothing to show.
            }}
          />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByText(/No runs in the last 90 days/),
    ).toBeInTheDocument();
  });

  test("the next page reads the next ten", async () => {
    count = 25;
    await renderPanel();

    const next: HTMLElement | undefined = screen
      .getAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return NEXT_PAGE.test(
          `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`,
        );
      });

    expect(next).toBeDefined();

    await act(async () => {
      fireEvent.click(next!);
    });

    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    expect(reads[1]!["skip"]).toBe(10);
    expect(reads[1]!["limit"]).toBe(10);
  });

  test("Rows per page reads that many runs, from the newest", async () => {
    count = 25;
    await renderPanel();

    const sizes: Array<HTMLElement> = screen.getAllByTestId(
      "pagination-items-on-page-select",
    );

    expect(sizes.length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.change(sizes[0]!, { target: { value: "25" } });
    });

    await waitFor(() => {
      expect(reads).toHaveLength(2);
    });
    expect(reads[1]!["skip"]).toBe(0);
    expect(reads[1]!["limit"]).toBe(25);
  });

  test("runs that could not be read say why, and are read again on Try again", async () => {
    readFailure = new Error("The server is unavailable.");

    await act(async () => {
      render(
        <MemoryRouter>
          <HuntRunHistory
            huntId={HUNT_ID}
            onClose={() => {
              closed++;
            }}
            onShowWindow={() => {
              // Nothing to show.
            }}
          />
        </MemoryRouter>,
      );
    });

    expect(
      await screen.findByText("The server is unavailable."),
    ).toBeInTheDocument();

    readFailure = null;

    const retry: HTMLElement = screen.getByRole("button", {
      name: /try again/i,
    });

    await act(async () => {
      fireEvent.click(retry);
    });

    await waitFor(() => {
      expect(runRow(FOUND)).toBeInTheDocument();
    });
    expect(reads).toHaveLength(2);
  });

  test("closes as every panel does", async () => {
    await renderPanel();

    const close: HTMLElement | undefined = screen
      .getAllByRole("button")
      .find((button: HTMLElement): boolean => {
        return CLOSE.test(
          `${button.getAttribute("aria-label") || ""} ${button.textContent || ""}`,
        );
      });

    expect(close).toBeDefined();

    await act(async () => {
      fireEvent.click(close!);
    });

    expect(closed).toBe(1);
  });
});
