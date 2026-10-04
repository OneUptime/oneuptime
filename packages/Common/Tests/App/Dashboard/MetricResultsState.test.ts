import { describe, expect, test } from "@jest/globals";
import {
  getMetricResultsState,
  getNextMetricCardGroupMemberState,
  hasMetricDataPoints,
  isMetricCardGroupChecking,
  isMetricCardGroupEmpty,
  MetricCardGroupMemberState,
  MetricResultsState,
  MetricResultsStateInput,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/MetricResultsState";
import AggregatedResult from "../../../Types/BaseDatabase/AggregatedResult";

/*
 * What a metric view's charts have to show, as its host is told it: the
 * rule a page such as the Kubernetes Control Plane page relies on to say
 * "turn this Helm value on" only when the charts have loaded and found
 * nothing - never while they load, never when the query failed.
 */

const POINT: AggregatedResult = {
  data: [{ timestamp: new Date("2026-10-04T10:00:00.000Z"), value: 0 }],
};
const NO_POINTS: AggregatedResult = { data: [] };

// A view whose first fetch came back with `results`.
function settled(
  results: Array<AggregatedResult>,
  overrides: Partial<MetricResultsStateInput> = {},
): MetricResultsStateInput {
  return {
    isCatalogLoading: false,
    catalogError: "",
    isFetching: false,
    fetchError: "",
    hasFetchedOnce: true,
    hasAnySelectedMetric: true,
    results: results,
    ...overrides,
  };
}

describe("getMetricResultsState", () => {
  test("results without a single data point are Empty", () => {
    expect(getMetricResultsState(settled([NO_POINTS, NO_POINTS]))).toBe(
      MetricResultsState.Empty,
    );
  });

  test("one data point in any result is data, a zero value included", () => {
    expect(getMetricResultsState(settled([NO_POINTS, POINT]))).toBe(
      MetricResultsState.HasData,
    );
  });

  test("a formula the evaluator refused is something to show, not 'no data'", () => {
    expect(
      getMetricResultsState(
        settled([NO_POINTS, { data: [], errorMessage: "Unknown variable c" }]),
      ),
    ).toBe(MetricResultsState.HasData);
  });

  test("before the first fetch has even started, the view is Loading, not Empty", () => {
    expect(getMetricResultsState(settled([], { hasFetchedOnce: false }))).toBe(
      MetricResultsState.Loading,
    );
  });

  test("while the metric catalog loads, or a fetch runs, the view is Loading", () => {
    expect(
      getMetricResultsState(settled([NO_POINTS], { isCatalogLoading: true })),
    ).toBe(MetricResultsState.Loading);
    expect(
      getMetricResultsState(settled([NO_POINTS], { isFetching: true })),
    ).toBe(MetricResultsState.Loading);
  });

  test("a failed fetch is an Error, never Empty: nobody knows whether there is data", () => {
    expect(
      getMetricResultsState(
        settled([], { hasFetchedOnce: false, fetchError: "Timed out" }),
      ),
    ).toBe(MetricResultsState.Error);
    // A refresh that failed after empty results is not "still empty".
    expect(
      getMetricResultsState(settled([NO_POINTS], { fetchError: "Timed out" })),
    ).toBe(MetricResultsState.Error);
  });

  test("a retry after a failure is Loading again", () => {
    expect(
      getMetricResultsState(
        settled([], {
          hasFetchedOnce: false,
          fetchError: "Timed out",
          isFetching: true,
        }),
      ),
    ).toBe(MetricResultsState.Loading);
  });

  test("a metric catalog that could not be read is an Error, even while a fetch runs", () => {
    expect(
      getMetricResultsState(
        settled([], { catalogError: "Forbidden", isFetching: true }),
      ),
    ).toBe(MetricResultsState.Error);
  });

  test("with no metric picked there is nothing to chart and nothing to wait for", () => {
    expect(
      getMetricResultsState(
        settled([], { hasAnySelectedMetric: false, hasFetchedOnce: false }),
      ),
    ).toBe(MetricResultsState.Empty);
  });
});

describe("hasMetricDataPoints", () => {
  test("no results, and results without points, have none", () => {
    expect(hasMetricDataPoints([])).toBe(false);
    expect(hasMetricDataPoints([NO_POINTS, NO_POINTS])).toBe(false);
  });

  test("a point or a formula's error is something to draw", () => {
    expect(hasMetricDataPoints([NO_POINTS, POINT])).toBe(true);
    expect(hasMetricDataPoints([{ data: [], errorMessage: "Bad" }])).toBe(true);
  });
});

describe("a group of cards that share one explanation for being empty", () => {
  const EMPTY: MetricCardGroupMemberState = {
    settled: MetricResultsState.Empty,
    isLoading: false,
  };

  test("a card checking again keeps the state it last settled on", () => {
    const checking: MetricCardGroupMemberState =
      getNextMetricCardGroupMemberState(EMPTY, MetricResultsState.Loading);

    expect(checking).toEqual({
      settled: MetricResultsState.Empty,
      isLoading: true,
    });
    expect(
      getNextMetricCardGroupMemberState(checking, MetricResultsState.HasData),
    ).toEqual({ settled: MetricResultsState.HasData, isLoading: false });
  });

  test("a card on its first load has settled on nothing yet", () => {
    expect(
      getNextMetricCardGroupMemberState(undefined, MetricResultsState.Loading),
    ).toEqual({ settled: null, isLoading: true });
  });

  test("is empty only when it has cards and every one has loaded and found nothing", () => {
    expect(isMetricCardGroupEmpty([])).toBe(false);
    expect(isMetricCardGroupEmpty([EMPTY, EMPTY])).toBe(true);
    expect(
      isMetricCardGroupEmpty([EMPTY, { settled: null, isLoading: true }]),
    ).toBe(false);
    expect(
      isMetricCardGroupEmpty([
        EMPTY,
        { settled: MetricResultsState.HasData, isLoading: false },
      ]),
    ).toBe(false);
    expect(
      isMetricCardGroupEmpty([
        EMPTY,
        { settled: MetricResultsState.Error, isLoading: false },
      ]),
    ).toBe(false);
  });

  test("stays empty while its cards check again", () => {
    expect(
      isMetricCardGroupEmpty([
        EMPTY,
        { settled: MetricResultsState.Empty, isLoading: true },
      ]),
    ).toBe(true);
    expect(
      isMetricCardGroupChecking([
        EMPTY,
        { settled: MetricResultsState.Empty, isLoading: true },
      ]),
    ).toBe(true);
    expect(isMetricCardGroupChecking([EMPTY, EMPTY])).toBe(false);
  });
});
