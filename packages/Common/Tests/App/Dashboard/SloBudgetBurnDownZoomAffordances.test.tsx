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
} from "@testing-library/react";
import * as React from "react";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What the SLO overview's budget burn-down card (Components/Slo/
 * SloBudgetBurnDownCard.tsx) promises about its zoom (issue #4105):
 *
 * - it names a gesture only where its body takes one: the chart takes the
 *   drag (and the double-click while zoomed), and the empty state takes
 *   the double-click while zoomed. The loader, the error and an empty
 *   state with nothing to reset take neither: a "Drag to zoom" over them
 *   promised a drag that did nothing (a new SLO reads "No budget history
 *   yet" for its first minutes).
 * - the hint's row stays in every state: it stands in for the card body's
 *   top margin on desktop.
 * - while the empty state takes the double-click, its text is not
 *   selectable, or the double-click would also select a word of it.
 */

type MockZoomHandlers = {
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
};

interface MockChartProps {
  xAxis: { options: { type: string } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

type MockZoomContextModule =
  typeof import("../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext");

const NOW: Date = new Date("2026-09-15T12:00:00.000Z");
const MINUTE_MS: number = 60 * 1000;
const ZOOM_START: Date = new Date("2026-09-14T00:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-14T06:00:00.000Z");

const aggregateMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI", () => {
  return {
    __esModule: true,
    default: {
      aggregate: (...args: Array<unknown>): unknown => {
        return aggregateMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("7d3f1a2b-4c5d-4e6f-8a9b-0c1d2e3f4a5b");
      },
    },
  };
});

jest.mock("../../../UI/Components/Charts/Line/LineChart", () => {
  const zoomContext: MockZoomContextModule = jest.requireActual(
    "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext",
  ) as MockZoomContextModule;
  return {
    __esModule: true,
    default: (props: MockChartProps): React.ReactElement => {
      const zoom: MockZoomHandlers = zoomContext.resolveChartTimeRangeZoom({
        onTimeRangeSelect: props.onTimeRangeSelect,
        onTimeRangeReset: props.onTimeRangeReset,
        isTimeAxis:
          props.xAxis.options.type === "time" ||
          props.xAxis.options.type === "date",
        disableTimeRangeZoom: props.disableTimeRangeZoom,
        pageZoom: zoomContext.useChartTimeRangeZoom(),
      });
      return (
        <div data-testid="line-chart">
          <button
            type="button"
            onClick={() => {
              zoom.onTimeRangeSelect?.(ZOOM_START, ZOOM_END);
            }}
          >
            Drag across the burn-down
          </button>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/ComponentLoader/ComponentLoader", () => {
  return {
    __esModule: true,
    default: (): React.ReactElement => {
      return <div data-testid="component-loader" />;
    },
  };
});

import SloBudgetBurnDownCard from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloBudgetBurnDownCard";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import OneUptimeDate from "../../../Types/Date";
import ObjectID from "../../../Types/ObjectID";
import SloWindowType from "../../../Types/ServiceLevelObjective/SloWindowType";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";

const SLO_ID: ObjectID = new ObjectID("5f8b7c1e2d3a4b5c6d7e8f90");

interface AggregateRequest {
  aggregateBy: { startTimestamp: Date; endTimestamp: Date };
}

type Answer = "history" | "quiet" | "never" | "fail";

let answerFor: (start: number, end: number) => Answer = (): Answer => {
  return "history";
};

function buildSlo(lastEvaluatedAt: Date | undefined): ServiceLevelObjective {
  const slo: ServiceLevelObjective = new ServiceLevelObjective();
  slo.targetPercentage = 99.9;
  slo.windowType = SloWindowType.Rolling;
  slo.windowDays = 30;
  slo.timezone = "UTC";
  slo.atRiskThresholdPercentage = 25;
  if (lastEvaluatedAt) {
    slo.lastEvaluatedAt = lastEvaluatedAt;
  }
  return slo;
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function renderCard(
  options: { neverEvaluated?: boolean } = {},
): Promise<void> {
  render(
    <MemoryRouter>
      <SloBudgetBurnDownCard
        sloId={SLO_ID}
        slo={buildSlo(
          options.neverEvaluated
            ? undefined
            : new Date("2026-09-15T11:58:00.000Z"),
        )}
        refreshToken="t1"
      />
    </MemoryRouter>,
  );
  await settle();
}

function hint(): HTMLElement | null {
  return screen.queryByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
}

// The card body's hint row, whether or not a hint is in it.
function hintRow(): HTMLElement {
  const rows: Array<Element> = Array.from(
    document.querySelectorAll(".h-4.md\\:flex"),
  );
  if (rows.length !== 1) {
    throw new Error(`Expected one hint row, found ${rows.length}`);
  }
  return rows[0] as HTMLElement;
}

function expectRowInPlace(): void {
  const row: HTMLElement = hintRow();
  expect(row).toHaveClass("max-md:hidden", "h-4", "md:flex");
  // First in the card body, in place of its top margin on desktop.
  expect(row.parentElement).toHaveClass("mt-4", "md:mt-0");
  expect(row.previousElementSibling).toBeNull();
}

async function zoomIntoQuietStretch(): Promise<void> {
  answerFor = (start: number, end: number): Answer => {
    return start === ZOOM_START.getTime() && end === ZOOM_END.getTime()
      ? "quiet"
      : "history";
  };
  await renderCard();
  fireEvent.click(
    await screen.findByRole("button", { name: "Drag across the burn-down" }),
  );
  await settle();
  await screen.findByTestId("slo-burn-down-empty");
}

beforeEach(() => {
  answerFor = (): Answer => {
    return "history";
  };
  jest.spyOn(OneUptimeDate, "getCurrentDate").mockImplementation(() => {
    return new Date(NOW.getTime());
  });
  aggregateMock.mockReset();
  aggregateMock.mockImplementation((args: unknown) => {
    const request: AggregateRequest = args as AggregateRequest;
    const start: number = request.aggregateBy.startTimestamp.getTime();
    const end: number = request.aggregateBy.endTimestamp.getTime();
    const answer: Answer = answerFor(start, end);
    if (answer === "never") {
      return new Promise(() => {
        // Intentionally never settles: the load is still in flight.
      });
    }
    if (answer === "fail") {
      return Promise.reject(new Error("boom"));
    }
    if (answer === "quiet") {
      return Promise.resolve({ data: [] });
    }
    return Promise.resolve({
      data: [
        { timestamp: new Date(start + 5 * MINUTE_MS).toISOString(), value: 80 },
        { timestamp: new Date(end - 5 * MINUTE_MS).toISOString(), value: 62.5 },
      ],
    });
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("the burn-down names a gesture only where its body takes one", () => {
  test("over the chart: Drag to zoom", async () => {
    await renderCard();

    expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    expect(hint()).toHaveTextContent("Drag to zoom");
    expectRowInPlace();
  });

  test("while the first load is in flight: the loader, and no hint", async () => {
    answerFor = (): Answer => {
      return "never";
    };

    await renderCard();

    expect(screen.getByTestId("component-loader")).toBeInTheDocument();
    expect(hint()).toBeNull();
    expectRowInPlace();
  });

  test("when the first load fails: the error, and no hint", async () => {
    answerFor = (): Answer => {
      return "fail";
    };

    await renderCard();

    await waitFor(() => {
      expect(screen.queryByTestId("component-loader")).toBeNull();
    });
    expect(screen.queryByTestId("line-chart")).toBeNull();
    expect(hint()).toBeNull();
    expectRowInPlace();
  });

  test('a new SLO with "No budget history yet": nothing to drag, nothing to reset, no hint', async () => {
    answerFor = (): Answer => {
      return "quiet";
    };

    await renderCard({ neverEvaluated: true });

    expect(await screen.findByTestId("slo-burn-down-empty")).toHaveTextContent(
      "No budget history yet",
    );
    expect(hint()).toBeNull();
    expectRowInPlace();
  });

  test("an evaluated SLO with no history in its window: no hint either", async () => {
    answerFor = (): Answer => {
      return "quiet";
    };

    await renderCard();

    expect(await screen.findByTestId("slo-burn-down-empty")).toHaveTextContent(
      "No budget history in this window yet",
    );
    expect(hint()).toBeNull();
    expectRowInPlace();
  });

  test("zoomed into a quiet stretch: the empty state names the double-click it takes", async () => {
    await zoomIntoQuietStretch();

    expect(hint()).toHaveTextContent("Double-click to reset");
    expectRowInPlace();
  });

  test("the row stays put from the chart to the zoomed empty state", async () => {
    answerFor = (start: number, end: number): Answer => {
      return start === ZOOM_START.getTime() && end === ZOOM_END.getTime()
        ? "quiet"
        : "history";
    };
    await renderCard();
    const rowWithChart: HTMLElement = hintRow();

    fireEvent.click(
      screen.getByRole("button", { name: "Drag across the burn-down" }),
    );
    await settle();
    await screen.findByTestId("slo-burn-down-empty");

    expect(hintRow()).toBe(rowWithChart);
  });
});

describe("the burn-down's empty state takes the reset double-click without selecting a word", () => {
  test("zoomed into a quiet stretch, its text is not selectable", async () => {
    await zoomIntoQuietStretch();

    const empty: HTMLElement = screen.getByTestId("slo-burn-down-empty");
    expect(empty.closest(".select-none")).not.toBeNull();
  });

  test("and the double-click still takes the card back to its whole window", async () => {
    await zoomIntoQuietStretch();

    fireEvent.doubleClick(screen.getByTestId("slo-burn-down-empty"));
    await settle();

    await waitFor(() => {
      expect(screen.getByTestId("line-chart")).toBeInTheDocument();
    });
    expect(hint()).toHaveTextContent("Drag to zoom");
  });

  test("with nothing to reset, its text stays selectable", async () => {
    answerFor = (): Answer => {
      return "quiet";
    };

    await renderCard();

    const empty: HTMLElement = await screen.findByTestId("slo-burn-down-empty");
    expect(empty.closest(".select-none")).toBeNull();
  });
});
