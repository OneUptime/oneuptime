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
  within,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * EmbeddedMetricCardGroup: cards whose charts share one reason for being
 * empty (a scrape the Kubernetes agent leaves off) explain it once, in place
 * of the cards, when every card has loaded and found nothing.
 *
 * The cards and the group are real. MetricView is stood in for: each card's
 * stand-in reports Loading whenever it (re)fetches - on mount, on a new
 * window and on a refresh - and then whatever the test says its queries
 * found, at once or when the test settles it.
 */

type ResultsState = "loading" | "has-data" | "empty" | "error";

interface StandInView {
  report: ((state: ResultsState) => void) | undefined;
  refreshNonce: number;
  fetches: number;
}

// What each card's queries find, by the card's first query title.
const mockAnswers: Record<string, ResultsState | "manual"> = {};
const mockViews: Record<string, StandInView> = {};
const mockEventMarkerHook: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/MetricView",
  () => {
    const ReactInMock: typeof React = jest.requireActual(
      "react",
    ) as typeof React;

    return {
      __esModule: true,
      default: (props: {
        data: {
          queryConfigs: Array<{ metricAliasData?: { title?: string } }>;
          startAndEndDate?: { startValue: Date; endValue: Date };
        };
        refreshNonce?: number;
        onResultsStateChange?: (state: ResultsState) => void;
      }) => {
        const title: string =
          props.data.queryConfigs[0]?.metricAliasData?.title || "";
        const windowKey: string = props.data.startAndEndDate
          ? `${props.data.startAndEndDate.startValue.getTime()}-${props.data.startAndEndDate.endValue.getTime()}`
          : "";
        const view: StandInView = mockViews[title] || {
          report: undefined,
          refreshNonce: 0,
          fetches: 0,
        };
        view.report = props.onResultsStateChange;
        view.refreshNonce = props.refreshNonce || 0;
        mockViews[title] = view;

        ReactInMock.useEffect(() => {
          view.fetches++;
          props.onResultsStateChange?.("loading");
          const answer: ResultsState | "manual" | undefined =
            mockAnswers[title];
          if (answer && answer !== "manual") {
            props.onResultsStateChange?.(answer);
          }
        }, [props.refreshNonce, windowKey]);

        return (
          <div
            data-testid="metric-view"
            data-title={title}
            data-refresh-nonce={props.refreshNonce || 0}
          />
        );
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/UseEventTimeReferenceLines",
  () => {
    return {
      __esModule: true,
      default: (input: unknown) => {
        mockEventMarkerHook(input);
        return { lines: [], markerCount: 0 };
      },
    };
  },
);

jest.mock("../../../UI/Components/Date/RangeStartAndEndDateView", () => {
  return {
    __esModule: true,
    default: (props: { dashboardStartAndEndDate: { range: string } }) => {
      return (
        <span data-testid="card-picker">
          {props.dashboardStartAndEndDate.range}
        </span>
      );
    },
  };
});

import EmbeddedMetricCard from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCard";
import EmbeddedMetricCardGroup, {
  EMBEDDED_METRIC_CARD_GROUP_TEST_ID,
  EmbeddedMetricCardGroupEmptyStateProps,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/EmbeddedMetricCardGroup";
import { MetricResultsState } from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricResultsState";
import MetricQueryConfigData from "../../../Types/Metrics/MetricQueryConfigData";
import MetricsAggregationType from "../../../Types/Metrics/MetricsAggregationType";
import TimeRange from "../../../Types/Time/TimeRange";

const GROUP: string = EMBEDDED_METRIC_CARD_GROUP_TEST_ID;

function queries(title: string): Array<MetricQueryConfigData> {
  return [
    {
      metricAliasData: {
        metricVariable: "a",
        title: title,
        description: "",
        legend: "",
        legendUnit: "",
      },
      metricQueryData: {
        filterData: {
          metricName: `${title}_total`,
          attributes: {},
          aggegationType: MetricsAggregationType.Sum,
        },
      },
    } as unknown as MetricQueryConfigData,
  ];
}

const onCheckAgain: MockFunction = getJestMockFunction();
let emptyStateProps: Array<EmbeddedMetricCardGroupEmptyStateProps> = [];

function renderEmptyState(
  props: EmbeddedMetricCardGroupEmptyStateProps,
): React.ReactElement {
  emptyStateProps.push(props);
  return (
    <div data-testid="setup-hint" data-checking={String(props.isChecking)}>
      <span>Turn the scrape on.</span>
      <button type="button" onClick={props.checkAgain}>
        Check again
      </button>
    </div>
  );
}

function Group(props: {
  titles: Array<string>;
  withCustomChart?: string | undefined;
  withChildrenOnlyCard?: boolean | undefined;
  onCardState?: ((state: MetricResultsState) => void) | undefined;
}): React.ReactElement {
  return (
    <EmbeddedMetricCardGroup
      renderEmptyState={renderEmptyState}
      onCheckAgain={() => {
        onCheckAgain();
      }}
    >
      {props.titles.map((title: string) => {
        return (
          <EmbeddedMetricCard
            key={title}
            title={title}
            queryConfigs={queries(title)}
            defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
            onResultsStateChange={props.onCardState}
          >
            {props.withCustomChart === title ? (
              <div data-testid="custom-chart" />
            ) : undefined}
          </EmbeddedMetricCard>
        );
      })}
      {props.withChildrenOnlyCard ? (
        <EmbeddedMetricCard title="Spend">
          <div data-testid="children-only-chart" />
        </EmbeddedMetricCard>
      ) : (
        <></>
      )}
    </EmbeddedMetricCardGroup>
  );
}

function cards(): HTMLElement {
  return screen.getByTestId(`${GROUP}-cards`);
}

function settle(title: string, state: ResultsState): void {
  act(() => {
    mockViews[title]!.report?.(state);
  });
}

function hint(): HTMLElement | null {
  return screen.queryByTestId("setup-hint");
}

beforeEach(() => {
  for (const key of Object.keys(mockAnswers)) {
    delete mockAnswers[key];
  }
  for (const key of Object.keys(mockViews)) {
    delete mockViews[key];
  }
  mockEventMarkerHook.mockReset();
  onCheckAgain.mockReset();
  emptyStateProps = [];
});

afterEach(() => {
  cleanup();
});

describe("when the group explains itself", () => {
  test("not while the cards are still loading", () => {
    mockAnswers["etcd"] = "manual";
    mockAnswers["wal"] = "manual";

    render(<Group titles={["etcd", "wal"]} />);

    expect(hint()).toBeNull();
    expect(cards()).toBeVisible();
    expect(screen.getAllByTestId("metric-view")).toHaveLength(2);
  });

  test("once every card has loaded and found nothing: once, in place of the cards", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "empty";

    render(<Group titles={["etcd", "wal"]} />);

    expect(screen.getAllByTestId("setup-hint")).toHaveLength(1);
    expect(screen.getByTestId(GROUP)).toHaveAttribute(
      "data-group-empty",
      "true",
    );
    // Hidden, not gone: a new window or checking again runs their queries.
    expect(cards()).not.toBeVisible();
    expect(screen.getAllByTestId("metric-view")).toHaveLength(2);
  });

  test("not while one card is still on its first load, even if the others are empty", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "manual";

    render(<Group titles={["etcd", "wal"]} />);

    expect(hint()).toBeNull();

    settle("wal", "empty");

    expect(hint()).toBeInTheDocument();
  });

  test("never when a card has data", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "has-data";

    render(<Group titles={["etcd", "wal"]} />);

    expect(hint()).toBeNull();
    expect(cards()).toBeVisible();
  });

  test("never when a card's query failed: nobody knows whether there is data", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "error";

    render(<Group titles={["etcd", "wal"]} />);

    expect(hint()).toBeNull();
    expect(cards()).toBeVisible();
  });

  test("a card that draws charts of its own counts as having data", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "empty";

    render(<Group titles={["etcd", "wal"]} withCustomChart="wal" />);

    expect(hint()).toBeNull();
    expect(screen.getByTestId("custom-chart")).toBeVisible();
  });

  test("a card of custom charts with no queries is never hidden with the empty ones", () => {
    mockAnswers["etcd"] = "empty";

    render(<Group titles={["etcd"]} withChildrenOnlyCard={true} />);

    expect(hint()).toBeNull();
    expect(screen.getByTestId("children-only-chart")).toBeVisible();
  });

  test("a card that leaves the group no longer counts", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "has-data";

    const view: ReturnType<typeof render> = render(
      <Group titles={["etcd", "wal"]} />,
    );

    expect(hint()).toBeNull();

    view.rerender(<Group titles={["etcd"]} />);

    expect(hint()).toBeInTheDocument();
  });
});

describe("checking again", () => {
  test("reloads every card past the cache, asks the page to resolve its window again, and keeps the explanation until the cards answer", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "empty";

    render(<Group titles={["etcd", "wal"]} />);

    expect(mockViews["etcd"]!.refreshNonce).toBe(0);
    const fetchesBefore: number = mockViews["etcd"]!.fetches;

    // The cards' next answers are held, as a slow query would be.
    mockAnswers["etcd"] = "manual";
    mockAnswers["wal"] = "manual";

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(onCheckAgain).toHaveBeenCalledTimes(1);
    expect(mockViews["etcd"]!.refreshNonce).toBe(1);
    expect(mockViews["wal"]!.refreshNonce).toBe(1);
    expect(mockViews["etcd"]!.fetches).toBe(fetchesBefore + 1);

    // Still explained while the queries run, and the page knows it is checking.
    expect(hint()).toBeInTheDocument();
    expect(hint()).toHaveAttribute("data-checking", "true");

    settle("etcd", "empty");
    settle("wal", "empty");

    expect(hint()).toHaveAttribute("data-checking", "false");
    expect(cards()).not.toBeVisible();
  });

  test("the charts come back the moment one card finds data", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "empty";

    render(<Group titles={["etcd", "wal"]} />);

    mockAnswers["etcd"] = "manual";
    mockAnswers["wal"] = "has-data";

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(hint()).toBeNull();
    expect(cards()).toBeVisible();
  });

  test("a query that fails while checking shows the cards, not the explanation", () => {
    mockAnswers["etcd"] = "empty";
    mockAnswers["wal"] = "empty";

    render(<Group titles={["etcd", "wal"]} />);

    mockAnswers["etcd"] = "error";
    mockAnswers["wal"] = "empty";

    fireEvent.click(screen.getByRole("button", { name: "Check again" }));

    expect(hint()).toBeNull();
    expect(cards()).toBeVisible();
  });
});

describe("the cards inside", () => {
  test("still tell the page what they found", () => {
    mockAnswers["etcd"] = "empty";
    const seen: Array<MetricResultsState> = [];

    render(
      <Group
        titles={["etcd"]}
        onCardState={(state: MetricResultsState) => {
          seen.push(state);
        }}
      />,
    );

    expect(seen).toEqual([
      MetricResultsState.Loading,
      MetricResultsState.Empty,
    ]);
  });

  test("a card's own Refresh still reloads it inside a group", () => {
    mockAnswers["etcd"] = "has-data";

    render(<Group titles={["etcd"]} />);

    fireEvent.click(
      within(screen.getByTestId(`${GROUP}-cards`)).getByRole("button", {
        name: "Refresh",
      }),
    );

    expect(mockViews["etcd"]!.refreshNonce).toBe(1);
  });

  test("a card drawn in the empty state takes no part in the group", () => {
    mockAnswers["etcd"] = "empty";

    render(
      <EmbeddedMetricCardGroup
        renderEmptyState={(group: EmbeddedMetricCardGroupEmptyStateProps) => {
          return (
            <EmbeddedMetricCard
              title="etcd"
              defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
              onRefresh={group.checkAgain}
            >
              <div data-testid="setup-hint">Turn the scrape on.</div>
            </EmbeddedMetricCard>
          );
        }}
      >
        <EmbeddedMetricCard
          title="etcd"
          queryConfigs={queries("etcd")}
          defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        />
      </EmbeddedMetricCardGroup>,
    );

    // The note's card has children but no queries; it must not read as data.
    expect(hint()).toBeInTheDocument();

    // Its header Refresh checks the group again.
    mockAnswers["etcd"] = "has-data";
    fireEvent.click(
      within(screen.getByTestId(`${GROUP}-empty-state`)).getByRole("button", {
        name: "Refresh",
      }),
    );

    expect(hint()).toBeNull();
    expect(mockViews["etcd"]!.refreshNonce).toBe(1);
  });
});

describe("cards outside a group", () => {
  test("refresh only on their own Refresh, as before", () => {
    mockAnswers["etcd"] = "empty";

    render(
      <EmbeddedMetricCard
        title="etcd"
        queryConfigs={queries("etcd")}
        defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
      />,
    );

    expect(mockViews["etcd"]!.refreshNonce).toBe(0);

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    expect(mockViews["etcd"]!.refreshNonce).toBe(1);
    expect(screen.queryByTestId(GROUP)).toBeNull();
  });

  test("fetch event markers only for query charts, which are what draws them", () => {
    render(
      <>
        <EmbeddedMetricCard
          title="etcd"
          queryConfigs={queries("etcd")}
          defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        />
        <EmbeddedMetricCard
          title="Note"
          defaultTimeRange={{ range: TimeRange.PAST_ONE_HOUR }}
        >
          <div>Turn the scrape on.</div>
        </EmbeddedMetricCard>
      </>,
    );

    const enabledFlags: Array<boolean> = mockEventMarkerHook.mock.calls.map(
      (call: Array<unknown>): boolean => {
        return (call[0] as { enabled: boolean }).enabled;
      },
    );

    expect(enabledFlags).toContain(true);
    expect(enabledFlags).toContain(false);
    for (const call of mockEventMarkerHook.mock.calls) {
      const input: { enabled: boolean; queryConfigs?: unknown } = call[0] as {
        enabled: boolean;
        queryConfigs?: unknown;
      };
      expect(input.enabled).toBe(input.queryConfigs !== undefined);
    }
  });
});
