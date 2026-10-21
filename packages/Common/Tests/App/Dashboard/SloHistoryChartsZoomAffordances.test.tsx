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
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * What the SLO's Error Budget History cards (Components/Slo/
 * SloHistoryCharts.tsx) promise about their zoom (issue #4105):
 *
 * - each card names a gesture only where its body takes one: the chart
 *   takes the drag (and the double-click while zoomed), and the empty state
 *   takes the double-click while zoomed. The loader takes neither, not even
 *   while zoomed, and nor does an empty state with nothing to reset: a
 *   "Drag to zoom" over them promised a drag that did nothing.
 * - the hint's row stays in every state: it stands in for the card body's
 *   top margin on desktop, so a card whose body changes does not move.
 * - while an empty state takes the double-click, its text is not
 *   selectable, or the double-click would also select a word of it.
 *
 * The component is rendered for real, Card included, over a fake data
 * layer; the chart canvas resolves its zoom as the real chart wrapper does.
 */

const SLO_ID_STRING: string = "0193c0de-5555-4aaa-8bbb-000000000005";

const NOW: Date = new Date("2026-09-28T12:00:00.000Z");
const ZOOM_START: Date = new Date("2026-09-20T00:00:00.000Z");
const ZOOM_END: Date = new Date("2026-09-20T06:00:00.000Z");

type MockZoomHandlers = {
  onTimeRangeSelect: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset: (() => void) | undefined;
};

interface MockChartProps {
  data: Array<{ seriesName: string }>;
  xAxis: { options: { type: string; min: Date; max: Date } };
  onTimeRangeSelect?: ((startTime: Date, endTime: Date) => void) | undefined;
  onTimeRangeReset?: (() => void) | undefined;
  disableTimeRangeZoom?: boolean | undefined;
}

type MockZoomContextModule =
  typeof import("../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomContext");

const aggregateMock: MockFunction = getJestMockFunction();
const getItemMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      getList: (...args: Array<unknown>): unknown => {
        return getListMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      getFriendlyMessage: (): string => {
        return "Could not load";
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
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

let mockDragWindow: [Date, Date] = [ZOOM_START, ZOOM_END];

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
      const name: string = props.data[0]?.seriesName || "";
      return (
        <div data-testid="line-chart" data-series={name}>
          <button
            type="button"
            onClick={() => {
              zoom.onTimeRangeSelect?.(mockDragWindow[0], mockDragWindow[1]);
            }}
          >
            {`Drag across ${name}`}
          </button>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: {
      dashboardStartAndEndDate: { range: string };
    }): React.ReactElement => {
      return (
        <span data-testid="range-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
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

jest.mock("../../../UI/Components/EmptyState/EmptyState", () => {
  return {
    __esModule: true,
    default: (props: {
      title?: string;
      description?: string;
    }): React.ReactElement => {
      return (
        <div data-testid="empty-state">
          <span>{props.title}</span>
          <span>{props.description}</span>
        </div>
      );
    },
  };
});

jest.mock("../../../UI/Components/ErrorMessage/ErrorMessage", () => {
  return {
    __esModule: true,
    default: (props: { message: string }): React.ReactElement => {
      return <div data-testid="error-message">{props.message}</div>;
    },
  };
});

import SloHistoryCharts from "../../../../App/FeatureSet/Dashboard/src/Components/Slo/SloHistoryCharts";
import ServiceLevelObjective from "../../../Models/DatabaseModels/ServiceLevelObjective";
import ObjectID from "../../../Types/ObjectID";
import { TIME_RANGE_ZOOM_HINT_TEST_ID } from "../../../UI/Components/Charts/TimeRangeZoom/TimeRangeZoomHint";

const SLI_CHART: string = "SLI %";

interface AggregateCall {
  aggregateBy: { startTimestamp: Date; endTimestamp: Date };
}

type Answer = "history" | "quiet" | "never" | "fail";

// How the fake endpoint answers a window: by default, with history.
let answerFor: (start: number, end: number) => Answer = (): Answer => {
  return "history";
};

function arrange(): void {
  aggregateMock.mockImplementation((args: unknown) => {
    const call: AggregateCall = args as AggregateCall;
    const start: number = call.aggregateBy.startTimestamp.getTime();
    const end: number = call.aggregateBy.endTimestamp.getTime();
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
        {
          timestamp: new Date(start + 60 * 1000).toISOString(),
          value: "99.5",
        },
      ],
    });
  });
  getItemMock.mockImplementation(async () => {
    const slo: ServiceLevelObjective = new ServiceLevelObjective();
    slo.targetPercentage = 99.9;
    slo.atRiskThresholdPercentage = 25;
    return slo;
  });
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 10000 };
  });
}

function isZoomWindow(start: number, end: number): boolean {
  return start === ZOOM_START.getTime() && end === ZOOM_END.getTime();
}

async function settle(): Promise<void> {
  for (let i: number = 0; i < 5; i++) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function cards(): Array<HTMLElement> {
  return screen.getAllByTestId("card");
}

function hints(): Array<HTMLElement> {
  return screen.queryAllByTestId(TIME_RANGE_ZOOM_HINT_TEST_ID);
}

/*
 * Each card's hint row: the row in its body that stands in for the body's
 * top margin on desktop, whether or not a hint is in it.
 */
function hintRows(): Array<HTMLElement> {
  return cards().map((card: HTMLElement): HTMLElement => {
    const rows: Array<Element> = Array.from(
      card.querySelectorAll(".h-4.md\\:flex"),
    );
    if (rows.length !== 1) {
      throw new Error(`Expected one hint row in a card, found ${rows.length}`);
    }
    return rows[0] as HTMLElement;
  });
}

function expectRowsInPlace(): void {
  for (const row of hintRows()) {
    expect(row).toHaveClass("max-md:hidden", "h-4", "md:flex");
    // First in the card body, in place of its top margin on desktop.
    expect(row.parentElement).toHaveClass("mt-4", "md:mt-0");
    expect(row.previousElementSibling).toBeNull();
  }
}

async function renderCharts(): Promise<void> {
  render(<SloHistoryCharts sloId={new ObjectID(SLO_ID_STRING)} />);
  await settle();
}

async function zoomIntoQuietStretch(): Promise<void> {
  answerFor = (start: number, end: number): Answer => {
    return isZoomWindow(start, end) ? "quiet" : "history";
  };
  await renderCharts();
  await waitFor(() => {
    expect(screen.getAllByTestId("line-chart")).toHaveLength(3);
  });
  fireEvent.click(
    screen.getByRole("button", { name: `Drag across ${SLI_CHART}` }),
  );
  await settle();
  await waitFor(() => {
    expect(screen.getAllByTestId("empty-state")).toHaveLength(3);
  });
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ["nextTick", "setImmediate"] });
  jest.setSystemTime(NOW);
  mockDragWindow = [ZOOM_START, ZOOM_END];
  answerFor = (): Answer => {
    return "history";
  };
  aggregateMock.mockReset();
  getItemMock.mockReset();
  getListMock.mockReset();
  arrange();
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("Error Budget History names a gesture only where a card's body takes one", () => {
  test("over each chart: Drag to zoom", async () => {
    await renderCharts();

    expect(screen.getAllByTestId("line-chart")).toHaveLength(3);
    expect(hints()).toHaveLength(3);
    for (const hint of hints()) {
      expect(hint).toHaveTextContent("Drag to zoom");
    }
    expectRowsInPlace();
  });

  test("while the first load is in flight: loaders, and no card names a gesture", async () => {
    answerFor = (): Answer => {
      return "never";
    };

    await renderCharts();

    expect(screen.getAllByTestId("component-loader")).toHaveLength(3);
    expect(hints()).toHaveLength(0);
    expectRowsInPlace();
  });

  test("over an empty range that was never zoomed: nothing to drag, nothing to reset, no hint", async () => {
    answerFor = (): Answer => {
      return "quiet";
    };

    await renderCharts();

    expect(screen.getAllByTestId("empty-state")).toHaveLength(3);
    expect(hints()).toHaveLength(0);
    expectRowsInPlace();
  });

  test("when the load fails with nothing drawn yet: the empty cards name nothing", async () => {
    answerFor = (): Answer => {
      return "fail";
    };

    await renderCharts();

    expect(screen.getByTestId("error-message")).toBeInTheDocument();
    expect(screen.getAllByTestId("empty-state")).toHaveLength(3);
    expect(hints()).toHaveLength(0);
    expectRowsInPlace();
  });

  test("zoomed into a quiet stretch: each empty card names the double-click it takes", async () => {
    await zoomIntoQuietStretch();

    expect(hints()).toHaveLength(3);
    for (const hint of hints()) {
      expect(hint).toHaveTextContent("Double-click to reset");
      const card: HTMLElement = hint.closest(
        '[data-testid="card"]',
      ) as HTMLElement;
      expect(within(card).getByTestId("empty-state")).toBeInTheDocument();
    }
    expectRowsInPlace();
  });

  test("zoomed, while the minute refresh of that quiet stretch loads: the loaders name nothing, not even the reset", async () => {
    await zoomIntoQuietStretch();
    answerFor = (): Answer => {
      return "never";
    };

    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });
    await settle();

    expect(screen.getAllByTestId("component-loader")).toHaveLength(3);
    expect(hints()).toHaveLength(0);
    expectRowsInPlace();
  });

  test("the rows stay put through every change of body: chart, loader, empty", async () => {
    await renderCharts();
    const rowsWithCharts: Array<HTMLElement> = hintRows();

    // The zoom's refetch (charts stay up), then the quiet answer.
    answerFor = (start: number, end: number): Answer => {
      return isZoomWindow(start, end) ? "quiet" : "history";
    };
    fireEvent.click(
      screen.getByRole("button", { name: `Drag across ${SLI_CHART}` }),
    );
    await settle();
    await waitFor(() => {
      expect(screen.getAllByTestId("empty-state")).toHaveLength(3);
    });

    // The very same rows, never unmounted or moved.
    for (const [index, row] of hintRows().entries()) {
      expect(row).toBe(rowsWithCharts[index]);
    }

    // The minute refresh of the quiet stretch: loaders.
    answerFor = (): Answer => {
      return "never";
    };
    act(() => {
      jest.advanceTimersByTime(60 * 1000);
    });
    await settle();
    expect(screen.getAllByTestId("component-loader")).toHaveLength(3);

    for (const [index, row] of hintRows().entries()) {
      expect(row).toBe(rowsWithCharts[index]);
    }
    expectRowsInPlace();
  });
});

describe("Error Budget History's empty cards take the reset double-click without selecting a word", () => {
  test("zoomed into a quiet stretch, each empty state's text is not selectable", async () => {
    await zoomIntoQuietStretch();

    for (const empty of screen.getAllByTestId("empty-state")) {
      expect(empty.parentElement).toHaveClass("select-none");
      // Still fitted into the card the established way.
      expect(empty.parentElement).toHaveClass("-my-16");
    }
  });

  test("an empty range that was never zoomed keeps its text selectable, as nothing takes a double-click there", async () => {
    answerFor = (): Answer => {
      return "quiet";
    };

    await renderCharts();

    for (const empty of screen.getAllByTestId("empty-state")) {
      expect(empty.parentElement).not.toHaveClass("select-none");
      expect(empty.parentElement).toHaveClass("-my-16");
    }
  });
});
