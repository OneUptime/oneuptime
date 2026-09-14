import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import {
  ATTRIBUTE_FACET_PREFIX,
  CARRIED_FACET_KEYS_BY_SIGNAL,
  SERVICE_FACET_KEYS,
  isScalar,
} from "./LockedTelemetryScope";

/*
 * The "Open in <Logs | Traces | Metrics>" half of the locked-filter explainer:
 * every locked chip the main explorer's URL grammar can express, plus the
 * time window, as that explorer's own URL.
 *
 * Kept apart from the describers in LockedTelemetryScope on purpose. This
 * builder needs the route map and the current URL, and the route map's
 * import chain (RouteMap -> ProjectUtil -> Common/UI/Config) reads `window`
 * the moment it loads. The describers are imported by renderer-free chip
 * builders whose tests run in plain Node, so anything that drags the browser
 * in at load time has to stay out of that module — a single shared file
 * made every one of those suites fail with "window is not defined". The
 * tables of what each explorer carries live in the pure module (the
 * describers consult them) and are imported from there.
 */

/** One locked chip as the link builder reads it. */
export interface LockedScopeLinkFilter {
  facetKey: string;
  value: string;
  /*
   * The value as pinned, when the caller has it. An operator instance here
   * means the chip is an operator filter, which no explorer URL chip can
   * carry (chips are exact values re-parsed as search grammar).
   */
  rawValue?: unknown;
}

export interface LockedScopeExplorerLink {
  url: URL;
  /** Human labels of the locked filters the link could not carry. */
  notCarried: Array<string>;
}

export interface BuildLockedScopeExplorerLinkInput {
  signal: TelemetrySignal;
  filters: Array<LockedScopeLinkFilter>;
  timeRange: RangeStartAndEndDateTime;
}

/*
 * Labels for the chips a target cannot carry — the same words the pivot
 * tooltips use for the same fields, so "not carried over: session" reads
 * the same everywhere.
 */
const NOT_CARRIED_LABELS: Dictionary<string> = {
  sessionId: "session",
  severityText: "severity",
  traceId: "trace",
  spanId: "span",
  entityKeys: "resource",
  hostId: "host",
  dockerHostId: "docker host",
  podmanHostId: "podman host",
  kubernetesClusterId: "Kubernetes cluster",
  statusCode: "span status",
  kind: "span kind",
  hasException: "exception flag",
  name: "span name",
  statusMessage: "status message",
};

type NotCarriedLabelFunction = (facetKey: string) => string;

const notCarriedLabel: NotCarriedLabelFunction = (facetKey: string): string => {
  if (facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
    return `attribute ${facetKey.substring(ATTRIBUTE_FACET_PREFIX.length)}`;
  }

  return NOT_CARRIED_LABELS[facetKey] || facetKey;
};

type ExplorerPageMapFunction = (signal: TelemetrySignal) => PageMap;

const explorerPageMap: ExplorerPageMapFunction = (
  signal: TelemetrySignal,
): PageMap => {
  if (signal === "logs") {
    return PageMap.LOGS;
  }

  if (signal === "traces") {
    return PageMap.TRACES;
  }

  /*
   * The metrics LIST explorer, not METRIC_VIEW: only the list page parses
   * the `filters` chip grammar; the metric explorer speaks `metricQueries`.
   */
  return PageMap.METRICS;
};

/**
 * Thrown when no current project can be resolved (no project id in the URL,
 * the session or local storage). The route map would otherwise hand back
 * the literal `/dashboard/:projectId/...` template, and a link to that is
 * worse than no link — callers catch this and keep the copy affordance.
 */
export class ExplorerRouteUnavailableError extends Error {
  public constructor() {
    super("No current project: the explorer route cannot be resolved.");
    this.name = "ExplorerRouteUnavailableError";
  }
}

type BuildLockedScopeExplorerLinkFunction = (
  input: BuildLockedScopeExplorerLinkInput,
) => LockedScopeExplorerLink;

/**
 * The main explorer's URL for the same slice: every locked chip the target
 * grammar can express as a `filters` chip, plus the time window.
 *
 * Attribute values are escaped through the search grammar because all three
 * explorers re-parse an `attributes.<key>` chip as a search value — a raw
 * `/api/*` would come back as a wildcard matching far more than the page
 * showed. The window travels as the picker token when it is a preset, so
 * the explorer keeps sliding with the clock exactly like the page did, and
 * as absolute `start` / `end` only for a Custom range.
 *
 * Throws {@link ExplorerRouteUnavailableError} when there is no current
 * project to build the route for.
 */
export const buildLockedScopeExplorerLink: BuildLockedScopeExplorerLinkFunction =
  (input: BuildLockedScopeExplorerLinkInput): LockedScopeExplorerLink => {
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

    if (!projectId) {
      throw new ExplorerRouteUnavailableError();
    }

    const notCarried: Array<string> = [];

    const addNotCarried: (label: string) => void = (label: string): void => {
      if (!notCarried.includes(label)) {
        notCarried.push(label);
      }
    };

    /*
     * facetKey -> values, first-seen order. Logs groups same-key chips into
     * one `[key, values[]]` tuple; traces and metrics fan them out into one
     * `[key, value]` pair each.
     */
    const carried: Map<string, Array<string>> = new Map<
      string,
      Array<string>
    >();

    const addCarried: (facetKey: string, value: string) => void = (
      facetKey: string,
      value: string,
    ): void => {
      const values: Array<string> = carried.get(facetKey) || [];

      if (!values.includes(value)) {
        values.push(value);
      }

      carried.set(facetKey, values);
    };

    const carriedFacetKeys: ReadonlySet<string> =
      CARRIED_FACET_KEYS_BY_SIGNAL[input.signal];

    for (const filter of input.filters) {
      if (!filter.facetKey || !filter.value) {
        continue;
      }

      if (filter.facetKey.startsWith(ATTRIBUTE_FACET_PREFIX)) {
        const isOperatorValue: boolean =
          filter.rawValue !== undefined &&
          filter.rawValue !== null &&
          !isScalar(filter.rawValue);

        if (isOperatorValue) {
          addNotCarried(notCarriedLabel(filter.facetKey));
          continue;
        }

        addCarried(filter.facetKey, buildSearchTokenValue(filter.value));
        continue;
      }

      if (SERVICE_FACET_KEYS.has(filter.facetKey)) {
        addCarried("primaryEntityId", filter.value);
        continue;
      }

      if (carriedFacetKeys.has(filter.facetKey)) {
        addCarried(filter.facetKey, filter.value);
        continue;
      }

      addNotCarried(notCarriedLabel(filter.facetKey));
    }

    const route: Route = RouteUtil.populateRouteParams(
      RouteMap[explorerPageMap(input.signal)]!,
    );
    const currentUrl: URL = Navigation.getCurrentURL();
    const url: URL = new URL(currentUrl.protocol, currentUrl.hostname, route);

    if (carried.size > 0) {
      let tuples: Array<[string, Array<string>] | [string, string]>;

      if (input.signal === "logs") {
        tuples = Array.from(carried.entries()).map(
          ([facetKey, values]: [string, Array<string>]): [
            string,
            Array<string>,
          ] => {
            return [facetKey, values];
          },
        );
      } else {
        tuples = [];

        for (const [facetKey, values] of carried.entries()) {
          for (const value of values) {
            tuples.push([facetKey, value]);
          }
        }
      }

      url.addQueryParam("filters", JSON.stringify(tuples), true);
    }

    if (input.timeRange.range === TimeRange.CUSTOM) {
      if (input.timeRange.startAndEndDate) {
        url.addQueryParam("range", TimeRange.CUSTOM, true);
        url.addQueryParam(
          "start",
          OneUptimeDate.toString(input.timeRange.startAndEndDate.startValue),
          true,
        );
        url.addQueryParam(
          "end",
          OneUptimeDate.toString(input.timeRange.startAndEndDate.endValue),
          true,
        );
      }
    } else {
      url.addQueryParam("range", input.timeRange.range, true);
    }

    return { url, notCarried };
  };
