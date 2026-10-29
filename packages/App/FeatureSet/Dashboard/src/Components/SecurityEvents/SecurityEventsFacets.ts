import SecurityEvent from "Common/Models/AnalyticsModels/SecurityEvent";
import Dictionary from "Common/Types/Dictionary";
import AggregateBy from "Common/Types/BaseDatabase/AggregateBy";
import AggregatedModel from "Common/Types/BaseDatabase/AggregatedModel";
import AggregationInterval from "Common/Types/BaseDatabase/AggregationInterval";
import AggregationType from "Common/Types/BaseDatabase/AggregationType";
import Query from "Common/Types/BaseDatabase/Query";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OcsfSeverity from "Common/Types/SecurityEvent/OcsfSeverity";
import {
  FacetConfig,
  FacetValue,
} from "Common/UI/Components/TelemetryViewer/types";
import {
  SECURITY_EVENT_SOURCE_FACET_KEY,
  getSecurityEventAttributeKey,
  getSecurityEventBaseFacetKey,
  isSecurityEventAttributeFacetKey,
} from "Common/Utils/SecurityEvent/SecurityEventSearch";
import { encodeRouteQueryParamValue } from "../../Utils/TelemetryTabScope";
import { SECURITY_EVENT_VOLUME_COLORS } from "./SecurityEventVolume";

/*
 * The Security Events explorer's facet sidebar: which dimensions it offers,
 * how a selection compiles into the list query, and the aggregate that counts
 * each dimension's values.
 *
 * Unlike logs / traces / exceptions, the counts are not served by a bespoke
 * `/telemetry/<signal>/facets` endpoint. Those endpoints run one ClickHouse
 * GROUP BY per facet in parallel and hand back the merged map; going through
 * the generic `/aggregate` route does the same GROUP BYs, keeps the Security
 * tiers' read ACL and any owned-scope narrowing byte-identical to the list
 * beside it (a second endpoint would be a second place to get that wrong),
 * and is what the volume chart above the list already does.
 *
 * Pure and React-free, so App/Tests can pin the query compilation and the
 * count parsing without mounting the viewer or reaching ClickHouse.
 */

/*
 * How a chip is keyed and compiled - `attributes.<key>` for a source
 * attribute, `!` before the key for an excluded value - is Common's
 * (Utils/SecurityEvent/SecurityEventSearch), shared with a hunt's scheduled
 * run on the server, and re-exported here for the page and its tests.
 */
export {
  SECURITY_EVENT_ATTRIBUTE_FACET_PREFIX,
  SECURITY_EVENT_EXCLUDE_FACET_PREFIX,
  SECURITY_EVENT_SOURCE_FACET_KEY,
  applySecurityEventFacetFiltersToQuery,
  getSecurityEventAttributeKey,
  getSecurityEventBaseFacetKey,
  isSecurityEventAttributeFacetKey,
  isSecurityEventExcludeFacetKey,
  toSecurityEventExcludeFacetKey,
} from "Common/Utils/SecurityEvent/SecurityEventSearch";

export interface SecurityEventFacetDefinition {
  /** The SecurityEvent column the facet groups and filters on. */
  key: string;
  title: string;
  /** Lower sorts first in the sidebar. */
  priority: number;
  /*
   * The section's title in plural, for the "N empty filters hidden" footer
   * and the revealed-but-empty message ("No Vendors seen in this window").
   */
  pluralTitle: string;
}

/*
 * The dimensions worth a sidebar section, in sidebar order.
 *
 * Severity first because it is how a responder triages, then what happened
 * (class / category / activity / outcome), then who it happened to and where
 * it came from. Every one of these is a typed OCSF column, so a selection is
 * an exact-match filter rather than a substring guess.
 *
 * Deliberately NOT here: `message` (free text — the search bar owns it),
 * `observables` / `mitreTactics` / `mitreTechniques` (arrays, whose GROUP BY
 * would count the array value rather than its members), `eventUid` and
 * `ruleId` (unique per row / opaque). Each of those is still filterable from
 * the search bar.
 */
export const SECURITY_EVENT_FACETS: ReadonlyArray<SecurityEventFacetDefinition> =
  [
    {
      /*
       * Which OneUptime source the event was attributed to — a Telemetry
       * Service standing for the SIEM or connector it arrived from ("Google
       * SecOps"), NOT an application service. It is also the column
       * @OwnedThrough narrows on, so it is the one dimension a scoped
       * reader's whole view is already sliced by.
       */
      key: SECURITY_EVENT_SOURCE_FACET_KEY,
      title: "Source",
      pluralTitle: "Sources",
      priority: 0,
    },
    {
      key: "severityName",
      title: "Severity",
      pluralTitle: "Severities",
      priority: 1,
    },
    {
      /*
       * How far the request behind an event got, as its trace shows
       * (Types/SecurityEvent/SecurityEventRequestOutcome): the cut between a
       * scanner the app turned away and an attack that reached the
       * database, so it sits right under severity.
       */
      key: "requestOutcome",
      title: "Request Outcome",
      pluralTitle: "Request Outcomes",
      priority: 2,
    },
    {
      key: "className",
      title: "Event Class",
      pluralTitle: "Event Classes",
      priority: 3,
    },
    {
      key: "categoryName",
      title: "Category",
      pluralTitle: "Categories",
      priority: 4,
    },
    {
      key: "activityName",
      title: "Activity",
      pluralTitle: "Activities",
      priority: 5,
    },
    {
      key: "statusName",
      title: "Status",
      pluralTitle: "Statuses",
      priority: 6,
    },
    {
      key: "vendorName",
      title: "Vendor",
      pluralTitle: "Vendors",
      priority: 7,
    },
    {
      key: "productName",
      title: "Product",
      pluralTitle: "Products",
      priority: 8,
    },
    {
      key: "ruleName",
      title: "Detection Rule",
      pluralTitle: "Detection Rules",
      priority: 9,
    },
    {
      key: "principalUser",
      title: "Principal User",
      pluralTitle: "Principal Users",
      priority: 10,
    },
    {
      key: "principalHost",
      title: "Principal Host",
      pluralTitle: "Principal Hosts",
      priority: 11,
    },
    {
      /*
       * The process the event is about (the one started, in a process
       * launch) and the one that started it, by file name: what a responder
       * scans an endpoint's events for. Their paths and command lines are
       * as unique as the events, so they are searched, not faceted.
       */
      key: "processName",
      title: "Process",
      pluralTitle: "Processes",
      priority: 12,
    },
    {
      key: "parentProcessName",
      title: "Parent Process",
      pluralTitle: "Parent Processes",
      priority: 13,
    },
  ];

export const SECURITY_EVENT_FACET_KEYS: ReadonlyArray<string> =
  SECURITY_EVENT_FACETS.map((facet: SecurityEventFacetDefinition): string => {
    return facet.key;
  });

const FACET_TITLES: Readonly<Record<string, string>> = Object.fromEntries(
  SECURITY_EVENT_FACETS.map(
    (facet: SecurityEventFacetDefinition): [string, string] => {
      return [facet.key, facet.title];
    },
  ),
);

/*
 * What a chip's key reads. An attribute chip drops the prefix so it reads as
 * `device.hostname: web-01`; a known facet gets its title; anything else
 * keeps its raw key rather than guessing at a label for it. An excluded
 * chip's key is the same name: the chip row says it excludes ("Severity is
 * not", in the reader's language - TelemetryActiveFilterChips), as it does
 * in every explorer.
 */
export function getSecurityEventFacetChipDisplayKey(facetKey: string): string {
  const baseKey: string = getSecurityEventBaseFacetKey(facetKey);

  return isSecurityEventAttributeFacetKey(baseKey)
    ? getSecurityEventAttributeKey(baseKey)
    : FACET_TITLES[baseKey] || baseKey;
}

/*
 * What a chip's VALUE reads. Only the Source facet needs translating — its
 * values are Service ObjectIDs — and an id with no loaded name keeps its id
 * rather than showing a blank chip beside a narrowed list.
 */
export function getSecurityEventFacetChipDisplayValue(
  facetKey: string,
  value: string,
  sourceNames?: Record<string, string> | undefined,
): string {
  if (
    getSecurityEventBaseFacetKey(facetKey) === SECURITY_EVENT_SOURCE_FACET_KEY
  ) {
    return sourceNames?.[value] || value;
  }

  return value;
}

/*
 * Severity is the one facet whose values carry meaning in their order and
 * their colour, and both are taken from the volume chart above the sidebar so
 * a colour means the same thing in both places.
 */
const SEVERITY_COLOR_MAP: Record<string, string> = Object.fromEntries(
  Object.values(OcsfSeverity).map(
    (severity: OcsfSeverity): [string, string] => {
      return [severity, SECURITY_EVENT_VOLUME_COLORS[severity]];
    },
  ),
);

export function buildSecurityEventFacetConfigs(options?: {
  /*
   * Source id -> the name of the Telemetry Service it stands for. The
   * aggregate route hands back the raw ObjectID (it cannot reach Postgres to
   * resolve one), so without this the Source facet would list uuids.
   */
  sourceNames?: Record<string, string> | undefined;
}): Array<FacetConfig> {
  return SECURITY_EVENT_FACETS.map(
    (facet: SecurityEventFacetDefinition): FacetConfig => {
      return {
        key: facet.key,
        title: facet.title,
        priority: facet.priority,
        /*
         * A source that never sends a vendor, a project with no detection
         * rules — the section would be an empty box on every visit. Folded
         * away while empty and counted in the "N empty filters hidden"
         * footer, the same deal the resource facets get in the other
         * explorers.
         */
        hideWhenEmpty: true,
        emptyStateNoun: facet.pluralTitle,
        ...(facet.key === "severityName"
          ? { valueColorMap: SEVERITY_COLOR_MAP }
          : {}),
        ...(facet.key === SECURITY_EVENT_SOURCE_FACET_KEY &&
        options?.sourceNames
          ? { valueDisplayMap: options.sourceNames }
          : {}),
      };
    },
  );
}

/*
 * The aggregate that counts one facet's values over exactly the rows the list
 * is showing.
 *
 * `AggregationInterval.Total` collapses the whole window into one row per
 * group, which is what a facet count is — without it the server would bucket
 * by time and hand back one row per (bucket, value) for the caller to re-add.
 *
 * eventUid is counted because it is non-nullable with a '' default, so
 * count() over it is a row count (the same reason the volume chart counts
 * it).
 */
export function buildSecurityEventFacetAggregateBy(data: {
  query: Query<SecurityEvent>;
  facetKey: string;
  startDate: Date;
  endDate: Date;
  limit: number;
}): AggregateBy<SecurityEvent> {
  return {
    query: data.query,
    aggregationType: AggregationType.Count,
    aggregateColumnName: "eventUid",
    aggregationTimestampColumnName: "time",
    aggregationInterval: AggregationInterval.Total,
    startTimestamp: data.startDate,
    endTimestamp: data.endDate,
    groupBy: { [data.facetKey]: true } as AggregateBy<SecurityEvent>["groupBy"],
    limit: data.limit,
    skip: 0,
    /*
     * By the COUNT, descending — the limit above is a Top-N, and which N it
     * keeps is decided here, in SQL, not by the client sort below.
     *
     * Under Total the select aliases the aggregate back onto the column name
     * (`count(eventUid) as eventUid`), so this orders by the count. Ordering
     * by `time` instead would order by `min(time)` and keep the N groups
     * whose FIRST event in the window is oldest: on any column with more
     * than N distinct values — a principal user, a host, a rule name — the
     * busiest value would be missing from its own facet whenever it first
     * appeared late in the window, and the list that came back would still
     * look like a plausible top-N.
     */
    sort: { eventUid: SortOrder.Descending },
  };
}

// The largest value list a facet section is given; the rest of the tail is cut.
export const SECURITY_EVENT_FACET_VALUE_LIMIT: number = 100;

/*
 * Aggregate rows -> facet values, highest count first.
 *
 * Rows whose group value is empty are dropped rather than shown as a blank
 * choice: every one of these columns defaults to '' meaning "the source did
 * not say", and a facet value that filters to "said nothing" is not a filter
 * a responder wants to click. Two rows that normalize to the same value are
 * added together, not overwritten.
 */
export function buildSecurityEventFacetValues(data: {
  rows: Array<AggregatedModel>;
  facetKey: string;
  limit?: number | undefined;
}): Array<FacetValue> {
  const counts: Map<string, number> = new Map<string, number>();

  for (const row of data.rows) {
    const raw: unknown = (row as Record<string, unknown>)[data.facetKey];

    if (typeof raw !== "string" && typeof raw !== "number") {
      continue;
    }

    const value: string = String(raw);

    if (value.length === 0) {
      continue;
    }

    const count: number = Number(row.value);

    if (!Number.isFinite(count) || count <= 0) {
      continue;
    }

    counts.set(value, (counts.get(value) || 0) + count);
  }

  return Array.from(counts.entries())
    .map((entry: [string, number]): FacetValue => {
      return { value: entry[0], count: entry[1] };
    })
    .sort((a: FacetValue, b: FacetValue): number => {
      if (b.count !== a.count) {
        return b.count - a.count;
      }

      return a.value.localeCompare(b.value);
    })
    .slice(0, data.limit ?? SECURITY_EVENT_FACET_VALUE_LIMIT);
}

/*
 * The query params a LINK carries so the explorer opens with these chips —
 * the `filters` grammar the traces and metrics explorers already speak, one
 * `[key, value]` pair per selection.
 *
 * Values are encoded here because Route.addQueryParams takes them verbatim,
 * and they are read back through URLSearchParams, which is a single decode.
 * Returns {} when there is nothing to filter on, so a caller can spread it
 * unconditionally.
 */
export function buildSecurityEventFacetLinkParams(
  pairs: Array<[string, string]>,
): Dictionary<string> {
  const usable: Array<[string, string]> = pairs.filter(
    (pair: [string, string]): boolean => {
      return Boolean(pair[0]) && Boolean(pair[1]);
    },
  );

  if (usable.length === 0) {
    return {};
  }

  return {
    filters: encodeRouteQueryParamValue(JSON.stringify(usable)),
  };
}
