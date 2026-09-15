import Dictionary from "Common/Types/Dictionary";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import Route from "Common/Types/API/Route";
import URL from "Common/Types/API/URL";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { buildSearchTokenValue } from "Common/Types/Telemetry/TelemetrySearchQuery";
import { TelemetrySignal } from "Common/Utils/Telemetry/LockedFilterSearch";
import { LockedFilterDetail } from "Common/Types/Telemetry/LockedFilterDetail";
import { LockedFilterActionOptions } from "Common/UI/Components/TelemetryViewer/components/LockedFilterActions";
import Navigation from "Common/UI/Utils/Navigation";
import ProjectUtil from "Common/UI/Utils/Project";
import PageMap from "./PageMap";
import RouteMap, { RouteUtil } from "./RouteMap";
import {
  ATTRIBUTE_FACET_PREFIX,
  CARRIED_FACET_KEYS_BY_SIGNAL,
  SERVICE_FACET_KEYS,
  buildLockedScopeCopyText,
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
  /*
   * How many locked filter values the URL actually carries: one per distinct
   * facet key + value in its `filters` param (so a repeated chip, or a
   * `serviceId` chip naming the same entity as a `primaryEntityId` one,
   * counts once — exactly as it appears once in the URL).
   *
   * Zero while the caller handed over at least one locked filter means the
   * URL holds the time window and nothing else: an "Open in <explorer>" link
   * built from it would open the UNFILTERED explorer under a label that
   * promises this page's scope. That is an Inventory item's entity-key scope
   * (no explorer URL grammar can spell an entity key), and the viewers read
   * this count to withhold the link rather than infer it from `notCarried`,
   * which is deduplicated by label and silent about blank chips.
   */
  carriedFilterCount: number;
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
  exceptionScope: "exception",
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

    let carriedFilterCount: number = 0;

    for (const values of carried.values()) {
      carriedFilterCount += values.length;
    }

    return { url, notCarried, carriedFilterCount };
  };

/** A chip as the "Copy filter" / "Open in <explorer>" actions read it. */
export interface LockedScopeActionChip {
  facetKey: string;
  value: string;
  readOnly?: boolean | undefined;
  lockedDetail?: LockedFilterDetail | undefined;
}

export interface BuildLockedScopeFilterActionsInput {
  signal: TelemetrySignal;
  /*
   * The chips on the viewer's bar. Only the read-only (locked) ones travel:
   * the user's own chips already live in the explorer's URL.
   */
  chips: ReadonlyArray<LockedScopeActionChip>;
  /** The viewer's current window, carried to the explorer as-is. */
  timeRange: RangeStartAndEndDateTime;
}

type BuildLockedScopeFilterActionsFunction = (
  input: BuildLockedScopeFilterActionsInput,
) => LockedFilterActionOptions | undefined;

/**
 * "Copy filter" and "Open in <Traces | Metrics>" for a viewer's locked scope,
 * or undefined when nothing is locked (the main explorer). The traces and
 * metrics viewers call this from their `lockedFilterActions` memo, so the
 * rules below are tested here on real chips rather than on a copy of a memo.
 * The logs viewer has its own glue (buildLogsLockedFilterActions), which also
 * hands the link each attribute's raw pinned value.
 *
 * Lives beside the link builder rather than with the describers because it
 * resolves the explorer route, which reads `window` at load.
 */
export const buildLockedScopeFilterActions: BuildLockedScopeFilterActionsFunction =
  (
    input: BuildLockedScopeFilterActionsInput,
  ): LockedFilterActionOptions | undefined => {
    const lockedChips: Array<LockedScopeActionChip> = input.chips.filter(
      (chip: LockedScopeActionChip): boolean => {
        return Boolean(chip.readOnly);
      },
    );

    if (lockedChips.length === 0) {
      return undefined;
    }

    const copyText: string = buildLockedScopeCopyText(
      input.signal,
      lockedChips,
    );

    try {
      const link: LockedScopeExplorerLink = buildLockedScopeExplorerLink({
        signal: input.signal,
        filters: lockedChips.map(
          (chip: LockedScopeActionChip): LockedScopeLinkFilter => {
            return { facetKey: chip.facetKey, value: chip.value };
          },
        ),
        timeRange: input.timeRange,
      });

      /*
       * No link when none of the locked filters could be carried (an
       * Inventory item's entity-key scope): the URL would hold the window
       * alone and open the UNFILTERED explorer under a label that promises
       * this page's scope. Copy stays governed by its own text — an empty one
       * renders no button, so the whole group disappears. A mixed scope keeps
       * its link and names what was left behind.
       */
      if (link.carriedFilterCount === 0) {
        return { copyText };
      }

      return {
        copyText,
        openExplorerRoute: link.url,
        notCarried: link.notCarried,
      };
    } catch {
      /*
       * No resolvable explorer route here (a preview outside the dashboard
       * shell): keep the copy affordance rather than take the chip bar down.
       */
      return { copyText };
    }
  };
