import AggregatedResult from "Common/Types/BaseDatabase/AggregatedResult";

/*
 * What a metric view's charts have to show, as its host needs to know it.
 *
 * A page that explains an empty view (the Kubernetes Control Plane and
 * Service Mesh pages say which Helm value collects the metrics) may only say
 * so once the view has loaded and found nothing: never while it is still
 * loading, never when the query failed (then nobody knows whether there is
 * data), and never next to charts that have data. React-free, so App tests
 * and the shared components read the same rules.
 */
export enum MetricResultsState {
  // The view has not got its results yet, or is fetching them again.
  Loading = "loading",
  // The latest results hold at least one data point to chart.
  HasData = "has-data",
  // The latest results came back without a single data point.
  Empty = "empty",
  // The latest fetch failed, or the metric catalog could not be read.
  Error = "error",
}

/*
 * Whether any result has something to draw. A formula the evaluator refused
 * counts: its chart slot shows the formula's error, which is not "no data".
 */
export function hasMetricDataPoints(results: Array<AggregatedResult>): boolean {
  return results.some((result: AggregatedResult): boolean => {
    return (result.data?.length || 0) > 0 || Boolean(result.errorMessage);
  });
}

export interface MetricResultsStateInput {
  // The metric catalog is still loading (the view draws a page loader).
  isCatalogLoading: boolean;
  // Why the metric catalog could not be read, or "".
  catalogError: string;
  // A results fetch is running.
  isFetching: boolean;
  // Why the latest results fetch failed, or "".
  fetchError: string;
  // A results fetch has succeeded at least once.
  hasFetchedOnce: boolean;
  // Some query names a metric; without one there is nothing to fetch.
  hasAnySelectedMetric: boolean;
  // The latest successful results.
  results: Array<AggregatedResult>;
}

export function getMetricResultsState(
  input: MetricResultsStateInput,
): MetricResultsState {
  if (input.catalogError) {
    return MetricResultsState.Error;
  }

  if (input.isCatalogLoading || input.isFetching) {
    return MetricResultsState.Loading;
  }

  if (input.fetchError) {
    return MetricResultsState.Error;
  }

  // No query names a metric: there is nothing to chart, and nothing to wait for.
  if (!input.hasAnySelectedMetric) {
    return MetricResultsState.Empty;
  }

  // Before the first fetch has even started.
  if (!input.hasFetchedOnce) {
    return MetricResultsState.Loading;
  }

  return hasMetricDataPoints(input.results)
    ? MetricResultsState.HasData
    : MetricResultsState.Empty;
}

/*
 * A card in a group of cards that share one explanation for "nothing here"
 * (EmbeddedMetricCardGroup): the last state it settled on, and whether it is
 * fetching again right now.
 */
export interface MetricCardGroupMemberState {
  // The last state other than Loading; null until the first fetch settles.
  settled: MetricResultsState | null;
  isLoading: boolean;
}

/*
 * The member's state after the card reports `state`. A fetch that starts
 * again keeps the state it last settled on, so a group that explains why it
 * is empty does not flicker back to its charts every time it checks again.
 */
export function getNextMetricCardGroupMemberState(
  previous: MetricCardGroupMemberState | undefined,
  state: MetricResultsState,
): MetricCardGroupMemberState {
  if (state === MetricResultsState.Loading) {
    return {
      settled: previous ? previous.settled : null,
      isLoading: true,
    };
  }

  return { settled: state, isLoading: false };
}

/*
 * The group says why it is empty only when it has cards, and every one of
 * them has loaded and found nothing. A card still on its first load, a card
 * whose query failed, and a card with data each keep the charts on screen.
 */
export function isMetricCardGroupEmpty(
  members: Array<MetricCardGroupMemberState>,
): boolean {
  return (
    members.length > 0 &&
    members.every((member: MetricCardGroupMemberState): boolean => {
      return member.settled === MetricResultsState.Empty;
    })
  );
}

// Some card in the group is fetching (again).
export function isMetricCardGroupChecking(
  members: Array<MetricCardGroupMemberState>,
): boolean {
  return members.some((member: MetricCardGroupMemberState): boolean => {
    return member.isLoading;
  });
}
