import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import TelemetryViewer from "Common/UI/Components/TelemetryViewer/TelemetryViewer";
import {
  ActiveFilter,
  FacetConfig,
  FacetData,
  FacetValue,
  HistogramBucket,
  HistogramSeriesOption,
  SearchHelpRow,
} from "Common/UI/Components/TelemetryViewer/types";
import TelemetryException from "Common/Models/DatabaseModels/TelemetryException";
import Service from "Common/Models/DatabaseModels/Service";
import Host from "Common/Models/DatabaseModels/Host";
import DockerHost from "Common/Models/DatabaseModels/DockerHost";
import PodmanHost from "Common/Models/DatabaseModels/PodmanHost";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import ModelAPI, {
  ListResult as ModelListResult,
} from "Common/UI/Utils/ModelAPI/ModelAPI";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import Query from "Common/Types/BaseDatabase/Query";
import ObjectID from "Common/Types/ObjectID";
import Includes from "Common/Types/BaseDatabase/Includes";
import AnalyticsModelAPI, {
  ListResult as AnalyticsModelListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import ExceptionInstance from "Common/Models/AnalyticsModels/ExceptionInstance";
import {
  EXCEPTION_ATTRIBUTE_FACET_PREFIX,
  ExceptionInstanceScope,
  NO_MATCH_FINGERPRINT,
  MAX_SCOPED_FINGERPRINTS,
  applyExceptionFingerprintScope,
  buildExceptionInstanceScopeQuery,
  getExceptionAttributeSelections,
  getExceptionInstanceScopeKey,
  hasExceptionInstanceScope,
  isExceptionAttributeFacetKey,
} from "../../Utils/ExceptionsAttributeScope";
import {
  EXCEPTION_ERROR_CLASS_COLUMN,
  EXCEPTION_FIELD_ALIASES,
  EXCEPTION_SERVICE_COLUMN,
  ExceptionFieldFilters,
  ExceptionSearchFilters,
  ExceptionServiceOption,
  NO_MATCH_ENTITY_ID,
  ResolvedExceptionErrorClasses,
  ResolvedExceptionServices,
  canonicalizeExceptionErrorClass,
  hasSearchDsl,
  parseExceptionSearch,
  resolveExceptionErrorClasses,
  resolveExceptionServiceChipId,
  resolveExceptionServiceIds,
  splitExceptionFieldPredicates,
} from "../../Utils/ExceptionsSearchQuery";
import {
  SearchQueryValue,
  SearchValuePredicate,
  predicateToQueryValue,
} from "Common/Types/Telemetry/TelemetrySearchQuery";
import Dictionary from "Common/Types/Dictionary";
import Search from "Common/Types/BaseDatabase/Search";
import IncludesNone from "Common/Types/BaseDatabase/IncludesNone";
import ErrorClass, {
  NON_ACTIONABLE_ERROR_CLASSES,
  isNonActionableErrorClass,
} from "Common/Types/Telemetry/ErrorClass";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import ProjectUtil from "Common/UI/Utils/Project";
import UserUtil from "Common/UI/Utils/User";
import API from "Common/UI/Utils/API/API";
import URL from "Common/Types/API/URL";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import { APP_API_URL } from "Common/UI/Config";
import { JSONObject } from "Common/Types/JSON";
import Navigation from "Common/UI/Utils/Navigation";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageMap from "../../Utils/PageMap";
import ExceptionRow from "./ExceptionRow";
import { writeTelemetryViewerUrlState } from "../../Utils/TelemetryViewerUrlState";

const DEFAULT_PAGE_SIZE: number = 50;

const EXCEPTION_SERIES_COLORS: Record<string, string> = {
  unhandled: "#ef4444",
  handled: "#f59e0b",
};

async function postApi(
  path: string,
  data: JSONObject,
): Promise<HTTPResponse<JSONObject>> {
  const response: HTTPResponse<JSONObject> | HTTPErrorResponse = await API.post(
    {
      url: URL.fromString(APP_API_URL.toString()).addRoute(path),
      data,
      headers: ModelAPI.getCommonHeaders(),
    },
  );

  if (response instanceof HTTPErrorResponse) {
    throw response;
  }

  return response;
}

const POSITIVE_INT_REGEX: RegExp = /^\d+$/;

function computeBucketSizeInMinutes(startTime: Date, endTime: Date): number {
  const totalMs: number = endTime.getTime() - startTime.getTime();
  const targetBuckets: number = 40;
  const raw: number = Math.max(60000, Math.floor(totalMs / targetBuckets));
  return Math.max(1, Math.ceil(raw / 60000));
}

/*
 * The syntax table. Every row is honoured by the shared grammar in
 * Common/Types/Telemetry/TelemetrySearchQuery and pinned by a test, so the
 * help cannot drift back into advertising syntax the parser never had — the
 * three rows this replaces described the ONLY three filters that worked, and
 * one of them (`@service:api`) matched nothing at all.
 */
const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "free text",
    description: "Search exception messages",
    example: "connection refused",
  },
  {
    syntax: '"quoted phrase"',
    description: "Keep spaces together",
    example: '"out of memory"',
  },
  {
    syntax: "type:<type>",
    description: "Filter by exception type",
    example: "type:TypeError",
  },
  {
    syntax: "service:<name>",
    description: "Filter by service",
    example: "service:api",
  },
  {
    syntax: "env:<environment>",
    description: "Filter by environment",
    example: "env:production",
  },
  {
    syntax: "class:<class>",
    description:
      "Filter by fault class — code-fault, user-error, expected-denial, infrastructure, unknown",
    example: "class:user-error",
  },
  {
    syntax: "@<attr>:<value>",
    description: "Filter by attribute",
    example: "@http.status_code:500",
  },
  {
    syntax: "@<attr>:<value>*",
    description: "Wildcard — * is any text, ? is one character",
    example: "@platform.team:a*",
  },
  {
    syntax: "@<attr>:*",
    description: "Attribute is present",
    example: "@user.id:*",
  },
  {
    syntax: "@<attr>:~<text>",
    description: "Attribute contains",
    example: "@url.host:~internal",
  },
  {
    syntax: "-<filter>",
    description: "Exclude — works with every filter above",
    example: "-type:TypeError",
  },
  {
    syntax: "@<attr>:(a OR b)",
    description: "Any of these values",
    example: "@http.method:(GET OR POST)",
  },
  {
    syntax: "@<attr>:>N",
    description: "Numeric comparison (also >=, <, <=)",
    example: "@duration:>1000",
  },
];

/*
 * primaryEntityId / hostId / dockerHostId / kubernetesClusterId all map to
 * the same underlying `primaryEntityId` column — the discriminator only
 * matters at facet bucketing time.
 */
const RESOURCE_FACET_KEYS: Set<string> = new Set<string>([
  "primaryEntityId",
  "hostId",
  "dockerHostId",
  "podmanHostId",
  "kubernetesClusterId",
]);

export type ExceptionStatus = "unresolved" | "resolved" | "archived" | "all";

const EXCEPTION_STATUS_VALUES: ReadonlyArray<ExceptionStatus> = [
  "unresolved",
  "resolved",
  "archived",
  "all",
];

/**
 * Which fault classes the list is looking at.
 *
 * The split exists because an exception group carries an `errorClass` saying
 * WHOSE problem it is (see Common/Types/Telemetry/ErrorClass), and two of the
 * five classes — user-error and expected-denial — describe something working
 * as designed: a caller sent nonsense, or an auth check refused a request.
 * Those are worth keeping and worth counting, but they are not defects, and
 * left in the default list they bury the ones that are.
 *
 * - "issues"      — everything EXCEPT the non-actionable classes. The default.
 * - "user-errors" — only the non-actionable classes: the drawer the default
 *                   sweeps things into, one click away rather than invisible.
 * - "all"         — no class clause at all.
 */
export type ExceptionClassScope = "issues" | "user-errors" | "all";

const EXCEPTION_CLASS_SCOPE_VALUES: ReadonlyArray<ExceptionClassScope> = [
  "issues",
  "user-errors",
  "all",
];

const DEFAULT_EXCEPTION_CLASS_SCOPE: ExceptionClassScope = "issues";

/*
 * A class selection that cannot match anything (the "Issues" lens plus a
 * user-error chip, say) has to show NOTHING — the same rule `@service:` uses
 * for a name no service has. A string outside the ErrorClass vocabulary is a
 * value the NOT NULL column can never hold, which forces the empty result
 * rather than quietly dropping one of the two contradicting filters.
 */
const NO_MATCH_ERROR_CLASS: string = "__no_such_error_class__";

/*
 * Sentence-case labels for the raw enum values, used by the facet sidebar and
 * by the chips it creates. "Unclassified" rather than "Unknown" because the
 * value means "triage could not decide", which reads as an accusation of the
 * reader otherwise.
 */
const ERROR_CLASS_DISPLAY_NAMES: Record<string, string> = {
  [ErrorClass.CodeFault]: "Code fault",
  [ErrorClass.UserError]: "User error",
  [ErrorClass.ExpectedDenial]: "Expected denial",
  [ErrorClass.Infrastructure]: "Infrastructure",
  [ErrorClass.Unknown]: "Unclassified",
};

interface InitialUrlState {
  search: string;
  filters: Array<ActiveFilter>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
  status: ExceptionStatus | null;
  classScope: ExceptionClassScope | null;
}

/*
 * Parse filter state from `window.location.search` on first mount so refresh
 * + back-from-exception-detail restore the view rather than resetting it.
 * Defensive: malformed/unknown values fall back to defaults.
 */
function readInitialUrlState(): InitialUrlState {
  const params: URLSearchParams = new URLSearchParams(window.location.search);

  const rawSearch: string | null = params.get("search");
  let search: string = "";
  if (rawSearch) {
    try {
      search = decodeURIComponent(rawSearch);
    } catch {
      search = rawSearch;
    }
  }

  let filters: Array<ActiveFilter> = [];
  const filtersRaw: string | null = params.get("filters");
  if (filtersRaw) {
    try {
      const parsed: unknown = JSON.parse(filtersRaw);
      if (Array.isArray(parsed)) {
        filters = (parsed as Array<unknown>)
          .filter((pair: unknown): pair is [string, string] => {
            return (
              Array.isArray(pair) &&
              pair.length === 2 &&
              typeof pair[0] === "string" &&
              typeof pair[1] === "string"
            );
          })
          .map(([facetKey, value]: [string, string]): ActiveFilter => {
            return {
              facetKey,
              value,
              displayKey: facetKey,
              displayValue: value,
            };
          });
      }
    } catch {
      // malformed JSON → ignore
    }
  }

  let timeRange: RangeStartAndEndDateTime = { range: TimeRange.PAST_ONE_DAY };
  const rangeRaw: string | null = params.get("range");
  if (rangeRaw) {
    const knownRanges: Array<string> = Object.values(TimeRange);
    if (knownRanges.includes(rangeRaw)) {
      const matched: TimeRange = rangeRaw as TimeRange;
      if (matched === TimeRange.CUSTOM) {
        const startStr: string | null = params.get("start");
        const endStr: string | null = params.get("end");
        if (startStr && endStr) {
          const startDate: Date = new Date(startStr);
          const endDate: Date = new Date(endStr);
          if (!isNaN(startDate.getTime()) && !isNaN(endDate.getTime())) {
            timeRange = {
              range: matched,
              startAndEndDate: new InBetween<Date>(startDate, endDate),
            };
          }
        }
      } else {
        timeRange = { range: matched };
      }
    }
  }

  const pageRaw: string | null = params.get("page");
  const page: number =
    pageRaw && POSITIVE_INT_REGEX.test(pageRaw)
      ? Math.max(1, parseInt(pageRaw, 10))
      : 1;
  const pageSizeRaw: string | null = params.get("pageSize");
  const pageSize: number =
    pageSizeRaw && POSITIVE_INT_REGEX.test(pageSizeRaw)
      ? Math.max(1, parseInt(pageSizeRaw, 10))
      : DEFAULT_PAGE_SIZE;

  const statusRaw: string | null = params.get("status");
  const status: ExceptionStatus | null =
    statusRaw && EXCEPTION_STATUS_VALUES.includes(statusRaw as ExceptionStatus)
      ? (statusRaw as ExceptionStatus)
      : null;

  const classRaw: string | null = params.get("class");
  const classScope: ExceptionClassScope | null =
    classRaw &&
    EXCEPTION_CLASS_SCOPE_VALUES.includes(classRaw as ExceptionClassScope)
      ? (classRaw as ExceptionClassScope)
      : null;

  return { search, filters, timeRange, page, pageSize, status, classScope };
}

export interface ExceptionsViewerProps {
  defaultStatus?: ExceptionStatus;
  primaryEntityId?: ObjectID | undefined;
}

const ExceptionsViewer: FunctionComponent<ExceptionsViewerProps> = (
  props: ExceptionsViewerProps,
): ReactElement => {
  /*
   * Parse filter state from the URL once on first mount so refresh and
   * back-from-exception-detail restore the view.
   */
  const initialUrlState: InitialUrlState = useMemo(readInitialUrlState, []);

  const defaultStatus: ExceptionStatus = props.defaultStatus || "unresolved";

  const [status, setStatus] = useState<ExceptionStatus>(
    initialUrlState.status || defaultStatus,
  );

  const [classScope, setClassScope] = useState<ExceptionClassScope>(
    initialUrlState.classScope || DEFAULT_EXCEPTION_CLASS_SCOPE,
  );

  const [exceptions, setExceptions] = useState<Array<TelemetryException>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(initialUrlState.page);
  const [pageSize, setPageSize] = useState<number>(initialUrlState.pageSize);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);
  const [hosts, setHosts] = useState<Array<Host>>([]);
  const [dockerHosts, setDockerHosts] = useState<Array<DockerHost>>([]);
  const [podmanHosts, setPodmanHosts] = useState<Array<PodmanHost>>([]);
  const [kubernetesClusters, setKubernetesClusters] = useState<
    Array<KubernetesCluster>
  >([]);

  const [searchValue, setSearchValue] = useState<string>(
    initialUrlState.search,
  );
  const [submittedSearch, setSubmittedSearch] = useState<string>(
    initialUrlState.search,
  );
  const [activeFilters, setActiveFilters] = useState<Array<ActiveFilter>>(
    initialUrlState.filters,
  );

  /*
   * The search bar's X button (and full backspace) only updates `searchValue`
   * — it doesn't call `onSubmit`. Without this effect, `submittedSearch`
   * stays at the old value, results stay filtered, and the URL keeps the
   * stale `?search=...`. Treat an emptied input as an implicit submit.
   */
  useEffect(() => {
    if (searchValue === "" && submittedSearch !== "") {
      setSubmittedSearch("");
      setPage(1);
    }
  }, [searchValue, submittedSearch]);

  const [telemetryAttributes, setTelemetryAttributes] = useState<Array<string>>(
    [],
  );
  const [attributesLoading, setAttributesLoading] = useState<boolean>(false);
  const [attributeValueSuggestions, setAttributeValueSuggestions] = useState<
    Record<string, Array<string>>
  >({});
  const [attributeValuesLoading, setAttributeValuesLoading] =
    useState<boolean>(false);
  const lastValueSuggestionKeyRef: React.MutableRefObject<string> =
    useRef<string>("");

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(
    initialUrlState.timeRange,
  );
  const [histogramBuckets, setHistogramBuckets] = useState<
    Array<HistogramBucket>
  >([]);
  const [histogramLoading, setHistogramLoading] = useState<boolean>(false);
  const [facetData, setFacetData] = useState<FacetData>({});
  const [facetLoading, setFacetLoading] = useState<boolean>(false);
  /*
   * Per-facet search text for resource facets (primaryEntityId / hostId / etc.).
   * Updates trigger a backend refetch so the result includes resources from
   * the full Postgres source-of-truth, not just the loaded subset.
   */
  const [facetSearchText, setFacetSearchText] = useState<
    Record<string, string>
  >({});

  /*
   * Mirror filter state to the URL so refresh and back-from-exception-detail
   * restore the view. `replaceState` keeps history clean — individual filter
   * tweaks don't push extra entries.
   */
  useEffect(() => {
    const params: URLSearchParams = new URLSearchParams();
    if (submittedSearch) {
      params.set("search", submittedSearch);
    }
    if (activeFilters.length > 0) {
      const tuples: Array<[string, string]> = activeFilters.map(
        (f: ActiveFilter): [string, string] => {
          return [f.facetKey, f.value];
        },
      );
      params.set("filters", JSON.stringify(tuples));
    }
    /*
     * Written even when it equals this explorer's default: the status tabs
     * now hand their scope to each other through these params, and a window
     * that is not written down cannot be carried.
     */
    params.set("range", timeRange.range);
    if (timeRange.range === TimeRange.CUSTOM && timeRange.startAndEndDate) {
      params.set("start", timeRange.startAndEndDate.startValue.toISOString());
      params.set("end", timeRange.startAndEndDate.endValue.toISOString());
    }
    if (page > 1) {
      params.set("page", String(page));
    }
    if (pageSize !== DEFAULT_PAGE_SIZE) {
      params.set("pageSize", String(pageSize));
    }
    if (status !== defaultStatus) {
      params.set("status", status);
    }

    /*
     * The class lens rides in `class=`, written only when it differs from the
     * default — the same rule `status` follows above — but it needs the
     * explicit null. writeTelemetryViewerUrlState clears the params named in
     * TelemetryViewerUrlParamNames on every write, which is what lets `status`
     * DISAPPEAR when it returns to its default; `class` is not in that list
     * (it lives in a shared file this change does not own), so nothing would
     * ever delete it. Left to rot, a stale `class=user-errors` would sit in
     * the address bar after the user switched back to Issues and re-apply
     * itself on the next refresh, and on every link shared from that page.
     */
    writeTelemetryViewerUrlState({
      ...Object.fromEntries(params.entries()),
      class: classScope === DEFAULT_EXCEPTION_CLASS_SCOPE ? null : classScope,
    });
  }, [
    submittedSearch,
    activeFilters,
    timeRange,
    page,
    pageSize,
    status,
    defaultStatus,
    classScope,
  ]);

  // Load services / hosts / docker hosts / k8s clusters once
  useEffect(() => {
    const loadResources: () => Promise<void> = async () => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const [
          serviceResult,
          hostResult,
          dockerHostResult,
          podmanHostResult,
          clusterResult,
        ]: [
          ModelListResult<Service>,
          ModelListResult<Host>,
          ModelListResult<DockerHost>,
          ModelListResult<PodmanHost>,
          ModelListResult<KubernetesCluster>,
        ] = await Promise.all([
          ModelAPI.getList({
            modelType: Service,
            query: { projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, serviceColor: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: Host,
            query: { projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: DockerHost,
            query: { projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: PodmanHost,
            query: { projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, hostIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
          ModelAPI.getList({
            modelType: KubernetesCluster,
            query: { projectId },
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: { name: true, clusterIdentifier: true },
            sort: { name: SortOrder.Ascending },
          }),
        ]);
        setServices(serviceResult.data || []);
        setHosts(hostResult.data || []);
        setDockerHosts(dockerHostResult.data || []);
        setPodmanHosts(podmanHostResult.data || []);
        setKubernetesClusters(clusterResult.data || []);
      } catch {
        // non-critical
      }
    };
    void loadResources();
  }, []);

  useEffect(() => {
    const loadAttributes: () => Promise<void> = async () => {
      try {
        setAttributesLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/exceptions/get-attributes",
            ),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        setTelemetryAttributes(
          (response.data["attributes"] || []) as Array<string>,
        );
      } catch {
        // non-critical
      } finally {
        setAttributesLoading(false);
      }
    };
    void loadAttributes();
  }, []);

  /*
   * Lazily fetch values for the attribute the user is currently typing
   * (e.g. `@service:`) so the dropdown can populate suggestions.
   */
  useEffect(() => {
    const currentWord: string = (searchValue.split(/\s+/).pop() || "").trim();
    if (!currentWord.startsWith("@") || !currentWord.includes(":")) {
      return;
    }
    const colonIdx: number = currentWord.indexOf(":");
    const attrKey: string = currentWord.substring(1, colonIdx);

    if (!attrKey || attrKey === lastValueSuggestionKeyRef.current) {
      return;
    }
    lastValueSuggestionKeyRef.current = attrKey;

    const loadValues: () => Promise<void> = async () => {
      try {
        setAttributeValuesLoading(true);
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post({
            url: URL.fromString(APP_API_URL.toString()).addRoute(
              "/telemetry/exceptions/get-attribute-values",
            ),
            data: { attributeKey: attrKey },
            headers: ModelAPI.getCommonHeaders(),
          });
        if (response instanceof HTTPErrorResponse) {
          throw response;
        }
        const values: Array<string> = (response.data["values"] ||
          []) as Array<string>;
        setAttributeValueSuggestions(
          (
            prev: Record<string, Array<string>>,
          ): Record<string, Array<string>> => {
            return { ...prev, [attrKey]: values };
          },
        );
      } catch {
        // non-critical
      } finally {
        setAttributeValuesLoading(false);
      }
    };
    void loadValues();
  }, [searchValue]);

  const serviceById: Record<string, Service> = useMemo(() => {
    const map: Record<string, Service> = {};
    for (const service of services) {
      if (service.id) {
        map[service.id.toString()] = service;
      }
    }
    return map;
  }, [services]);

  /*
   * Parse the search bar with the shared telemetry grammar, so a filter
   * typed here means what the same filter means on logs, traces and metrics.
   * The hand-rolled tokenizer this replaces supported exact match only,
   * matched aliases case-sensitively (`@Type:X` became an attribute filter on
   * a key called "Type"), and had no bare `type:X` form at all.
   */
  const parsedSearch: ExceptionSearchFilters = useMemo(() => {
    return parseExceptionSearch(submittedSearch);
  }, [submittedSearch]);

  const searchFieldFilters: ExceptionFieldFilters = useMemo(() => {
    return splitExceptionFieldPredicates(parsedSearch.fieldPredicates);
  }, [parsedSearch]);

  const serviceOptions: Array<ExceptionServiceOption> = useMemo(() => {
    return services
      .filter((service: Service): boolean => {
        return Boolean(service.id);
      })
      .map((service: Service): ExceptionServiceOption => {
        return {
          id: service.id!.toString(),
          name: service.name?.toString() || "",
        };
      });
  }, [services]);

  /*
   * `@service:` is documented as taking a service NAME while the column
   * stores a uuid, so the name resolves against the service list this
   * component already loads — the same resolution MetricsViewer does. Bound
   * straight to the column, as it was, `@service:api` asked for an exception
   * whose service id is the literal string "api", which no row has.
   */
  const resolvedServices: ResolvedExceptionServices = useMemo(() => {
    return resolveExceptionServiceIds({
      predicates: parsedSearch.fieldPredicates["primaryEntityId"] || [],
      services: serviceOptions,
    });
  }, [parsedSearch, serviceOptions]);

  const facetGroups: Record<string, Array<string>> = useMemo(() => {
    const groups: Record<string, Array<string>> = {};
    for (const filter of activeFilters) {
      if (!groups[filter.facetKey]) {
        groups[filter.facetKey] = [];
      }
      groups[filter.facetKey]!.push(filter.value);
    }
    return groups;
  }, [activeFilters]);

  /*
   * Chip and typed values on one column are ONE any-of filter, shared by the
   * list, the chart and the facet counts. Written in sequence — as the list
   * used to — a typed `@type:` silently overwrote an exceptionType chip the
   * chart above it was still counting.
   */
  const columnLiterals: Record<string, Array<string>> = useMemo(() => {
    const merged: Record<string, Array<string>> = {};

    const add: (column: string, values: Array<string>) => void = (
      column: string,
      values: Array<string>,
    ): void => {
      for (const value of values) {
        if (!merged[column]) {
          merged[column] = [];
        }
        if (!merged[column]!.includes(value)) {
          merged[column]!.push(value);
        }
      }
    };

    for (const facetKey of Object.keys(facetGroups)) {
      if (
        RESOURCE_FACET_KEYS.has(facetKey) ||
        isExceptionAttributeFacetKey(facetKey)
      ) {
        continue;
      }
      add(facetKey, facetGroups[facetKey]!);
    }

    for (const column of Object.keys(searchFieldFilters.literals)) {
      add(column, searchFieldFilters.literals[column]!);
    }

    return merged;
  }, [facetGroups, searchFieldFilters]);

  /*
   * `class:` tokens, resolved against the ErrorClass vocabulary here rather
   * than compiled into a query, for the same reason `@service:` is: the
   * transports cannot all carry it. See resolveExceptionErrorClasses.
   */
  const resolvedErrorClasses: ResolvedExceptionErrorClasses = useMemo(() => {
    return resolveExceptionErrorClasses(
      parsedSearch.fieldPredicates[EXCEPTION_ERROR_CLASS_COLUMN] || [],
    );
  }, [parsedSearch]);

  /*
   * The ONE clause the `errorClass` column carries, combining every source
   * that has an opinion about it: the class lens, an `errorClass` facet chip,
   * and a typed `class:` token.
   *
   * They are intersected in one place rather than written one after another,
   * which is the whole point of building it here: a column can hold a single
   * clause, so written in sequence whichever ran last would silently win
   * while the other control stayed lit on screen. An empty intersection — the
   * "Issues" lens plus a `user-error` chip — is a real answer and shows an
   * empty list, with both controls visible and either one removable.
   */
  const errorClassClause: string | Includes | IncludesNone | null =
    useMemo(() => {
      /*
       * Canonicalised because a chip stores its value verbatim: the search
       * bar turns `class:User-Error` into a chip out of the raw token, and
       * the column only ever holds the kebab-case spelling.
       */
      const chipValues: Array<string> = (
        columnLiterals[EXCEPTION_ERROR_CLASS_COLUMN] || []
      ).map(canonicalizeExceptionErrorClass);

      // Positive constraints AND together; null means "nobody constrained it".
      let included: Array<string> | null =
        resolvedErrorClasses.includedClasses === null
          ? null
          : [...resolvedErrorClasses.includedClasses];

      if (chipValues.length > 0) {
        included =
          included === null
            ? [...chipValues]
            : included.filter((value: string): boolean => {
                return chipValues.includes(value);
              });
      }

      const excluded: Array<string> = [...resolvedErrorClasses.excludedClasses];

      if (classScope === "user-errors") {
        const nonActionable: Array<string> = [...NON_ACTIONABLE_ERROR_CLASSES];
        included =
          included === null
            ? nonActionable
            : included.filter((value: string): boolean => {
                return isNonActionableErrorClass(value);
              });
      } else if (classScope === "issues") {
        /*
         * The default is an EXCLUSION, never an allow-list of the classes we
         * consider real. It compiles to `"errorClass" NOT IN ('user-error',
         * 'expected-denial')`, so a row whose class this build has never
         * heard of — written by a newer release, or by a triage runner
         * echoing an LLM — stays in the Issues list; an allow-list would drop
         * exactly those rows, and an exception nobody could classify is the
         * one most likely to be a real bug. (The column is NOT NULL DEFAULT
         * 'unknown' for the same reason: in SQL `NULL NOT IN (...)` is NULL
         * rather than true, so over a nullable column this clause would have
         * hidden every unclassified row instead of showing it.)
         */
        for (const value of NON_ACTIONABLE_ERROR_CLASSES) {
          if (!excluded.includes(value)) {
            excluded.push(value);
          }
        }
      }

      if (resolvedErrorClasses.matchedNothing) {
        return NO_MATCH_ERROR_CLASS;
      }

      if (included !== null) {
        const allowed: Array<string> = included.filter(
          (value: string): boolean => {
            return !excluded.includes(value);
          },
        );

        if (allowed.length === 0) {
          return NO_MATCH_ERROR_CLASS;
        }

        return allowed.length === 1 ? allowed[0]! : new Includes(allowed);
      }

      return excluded.length > 0 ? new IncludesNone(excluded) : null;
    }, [classScope, columnLiterals, resolvedErrorClasses]);

  const resourceIds: Array<string> = useMemo(() => {
    const ids: Set<string> = new Set<string>(resolvedServices.serviceIds);
    for (const facetKey of RESOURCE_FACET_KEYS) {
      for (const value of facetGroups[facetKey] || []) {
        ids.add(value);
      }
    }
    return Array.from(ids);
  }, [facetGroups, resolvedServices]);

  // Build query
  /*
   * Instance scope. TelemetryException has no attributes column, and the
   * histogram/facet endpoints take literal lists only — so `attributes.<key>`
   * chips, `@key:value` attribute tokens and any field filter carrying an
   * operator (`@type:Type*`) all resolve against the ClickHouse instance rows
   * first, and the matching fingerprints narrow the list, the chart and the
   * counts together (the ExceptionsTable entity-scope pattern).
   */
  const instanceScope: ExceptionInstanceScope = useMemo(() => {
    const attributePredicates: Dictionary<Array<SearchQueryValue>> = {};

    for (const attributeKey of Object.keys(parsedSearch.attributePredicates)) {
      attributePredicates[attributeKey] = (
        parsedSearch.attributePredicates[attributeKey] || []
      ).map((predicate: SearchValuePredicate): SearchQueryValue => {
        return predicateToQueryValue(predicate);
      });
    }

    const columnPredicates: Dictionary<Array<SearchQueryValue>> = {
      ...searchFieldFilters.operators,
    };

    /*
     * A negated `@service:` cannot ride the `serviceIds` payloads — those
     * only include — so it resolves through the instance query like every
     * other operator.
     */
    if (resolvedServices.excludedServiceIds.length > 0) {
      columnPredicates["primaryEntityId"] = [
        new IncludesNone(resolvedServices.excludedServiceIds),
      ];
    }

    return {
      attributeSelections: getExceptionAttributeSelections({ facetGroups }),
      attributePredicates,
      columnPredicates,
    };
  }, [facetGroups, parsedSearch, searchFieldFilters, resolvedServices]);

  const instanceScopeKey: string | null = useMemo(() => {
    if (!hasExceptionInstanceScope(instanceScope)) {
      return null;
    }
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    return getExceptionInstanceScopeKey({
      scope: instanceScope,
      windowStartMs: dateRange.startValue.getTime(),
      windowEndMs: dateRange.endValue.getTime(),
    });
  }, [instanceScope, timeRange]);

  const [scopeResolution, setScopeResolution] = useState<{
    key: string;
    fingerprints: Array<string>;
  } | null>(null);

  useEffect(() => {
    if (!instanceScopeKey) {
      setScopeResolution(null);
      return;
    }

    let isCancelled: boolean = false;

    const resolveFingerprints: () => Promise<void> =
      async (): Promise<void> => {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }

        const dateRange: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        try {
          const instances: AnalyticsModelListResult<ExceptionInstance> =
            await AnalyticsModelAPI.getList<ExceptionInstance>({
              modelType: ExceptionInstance,
              query: buildExceptionInstanceScopeQuery({
                projectId,
                window: new InBetween<Date>(
                  dateRange.startValue,
                  dateRange.endValue,
                ),
                scope: instanceScope,
              }),
              groupBy: {
                fingerprint: true,
              },
              select: {
                fingerprint: true,
              },
              sort: {
                fingerprint: SortOrder.Ascending,
              },
              limit: MAX_SCOPED_FINGERPRINTS,
              skip: 0,
            });

          if (isCancelled) {
            return;
          }

          const fingerprints: Array<string> = [];
          for (const instance of instances.data || []) {
            const fingerprint: string = instance.fingerprint?.toString() || "";
            if (fingerprint !== "" && !fingerprints.includes(fingerprint)) {
              fingerprints.push(fingerprint);
            }
          }

          setScopeResolution({ key: instanceScopeKey, fingerprints });
        } catch {
          if (!isCancelled) {
            /*
             * Failed resolution keeps the sentinel-narrowed (empty) list
             * rather than quietly showing unfiltered exceptions under an
             * active-looking chip.
             */
            setScopeResolution({ key: instanceScopeKey, fingerprints: [] });
          }
        }
      };

    void resolveFingerprints();

    return () => {
      isCancelled = true;
    };
  }, [instanceScopeKey, instanceScope, timeRange]);

  /*
   * Fingerprints to carry into the histogram/facets payloads — only once
   * the resolution matches the CURRENT selections+window.
   */
  const resolvedScopeFingerprints: Array<string> | null =
    instanceScopeKey && scopeResolution?.key === instanceScopeKey
      ? scopeResolution.fingerprints
      : null;

  const query: Query<TelemetryException> = useMemo(() => {
    const q: Query<TelemetryException> = {};
    const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
    if (projectId) {
      q.projectId = projectId;
    }

    if (props.primaryEntityId) {
      q.primaryEntityId = props.primaryEntityId;
    }

    if (status === "unresolved") {
      q.isResolved = false;
      q.isArchived = false;
    } else if (status === "resolved") {
      q.isResolved = true;
      q.isArchived = false;
    } else if (status === "archived") {
      q.isArchived = true;
    }

    // Facet + search filters on the resource column, as one any-of.
    if (resourceIds.length > 0) {
      (q as Record<string, unknown>)["primaryEntityId"] =
        resourceIds.length === 1 ? resourceIds[0]! : new Includes(resourceIds);
    }

    /*
     * A `@service:` naming no existing service must show NOTHING. Dropping
     * the filter instead answers "exceptions from a service that does not
     * exist" with every exception in the project.
     */
    if (resolvedServices.matchedNothing) {
      (q as Record<string, unknown>)["primaryEntityId"] = NO_MATCH_ENTITY_ID;
    }

    /*
     * Literal column filters (`type:TypeError`, an environment chip). Filters
     * carrying an operator, and every attribute filter, narrow through the
     * fingerprint scope below instead — one filter cannot be split across two
     * stores and still mean one thing.
     */
    for (const column of Object.keys(columnLiterals)) {
      /*
       * errorClass is skipped: it is folded into the class lens below, which
       * intersects a typed / chipped class with the selected segment. Writing
       * it here as well would mean two assignments to one column, and the
       * loser would be a filter still showing as active in the UI.
       */
      if (column === EXCEPTION_ERROR_CLASS_COLUMN) {
        continue;
      }

      const values: Array<string> = columnLiterals[column]!;
      (q as Record<string, unknown>)[column] =
        values.length === 1 ? values[0]! : new Includes(values);
    }

    /*
     * The resolved class clause. Null only when nothing constrained the
     * column — "All" with no chip and no `class:` token.
     *
     * NOTE: this narrows the LIST and the error-class facet (counted from the
     * same Postgres rows), but NOT the chart or the other facet counts: those
     * are aggregated from the ClickHouse ExceptionInstance table, which has
     * no errorClass column because the class lives on the Postgres exception
     * group. See the note in fetchHistogram.
     */
    if (errorClassClause !== null) {
      (q as Record<string, unknown>)[EXCEPTION_ERROR_CLASS_COLUMN] =
        errorClassClause;
    }

    /*
     * Free text is a contains-match on the message — what the histogram and
     * the facet counts have always made of it, and what the placeholder
     * promises. It used to be assigned to `exceptionType` here, an EXACT
     * match on a different column, and assigned AFTER the field loop: typing
     * a word searched the wrong thing AND erased an explicit `@type:` filter
     * the chart above was still applying.
     *
     * Unlike attributes, this needs no cross-store join: TelemetryException
     * carries the group's own `message` column.
     */
    if (parsedSearch.freeText.length > 0) {
      (q as Record<string, unknown>)["message"] = new Search(
        parsedSearch.freeText,
      );
    }

    /*
     * Scope the list by the selected time range using lastSeenAt so the
     * viewer + histogram share the same window.
     */
    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    (q as Record<string, unknown>)["lastSeenAt"] = new InBetween<Date>(
      dateRange.startValue,
      dateRange.endValue,
    );

    /*
     * Instance scope: resolved fingerprints narrow the list; while the
     * resolution is still in flight the sentinel keeps the list EMPTY —
     * a flash of unfiltered exceptions under an active chip would be a
     * lie.
     */
    if (instanceScopeKey) {
      applyExceptionFingerprintScope(q, resolvedScopeFingerprints || []);
    }

    return q;
  }, [
    props.primaryEntityId,
    status,
    columnLiterals,
    errorClassClause,
    resourceIds,
    resolvedServices,
    parsedSearch,
    timeRange,
    instanceScopeKey,
    resolvedScopeFingerprints,
  ]);

  // Fetch exceptions
  const fetchExceptions: () => Promise<void> = useCallback(async () => {
    setIsLoading(true);
    setError("");
    try {
      const result: ModelListResult<TelemetryException> =
        await ModelAPI.getList({
          modelType: TelemetryException,
          query,
          limit: pageSize,
          skip: (page - 1) * pageSize,
          select: {
            fingerprint: true,
            exceptionType: true,
            message: true,
            occuranceCount: true,
            firstSeenAt: true,
            lastSeenAt: true,
            isResolved: true,
            isArchived: true,
            primaryEntityId: true,
            environment: true,
          },
          sort: { lastSeenAt: SortOrder.Descending },
        });
      setExceptions(result.data || []);
      setTotalCount(result.count);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    } finally {
      setIsLoading(false);
    }
  }, [query, page, pageSize]);

  useEffect(() => {
    void fetchExceptions();
  }, [fetchExceptions]);

  // Fetch histogram (occurrences over time, split by handled/unhandled)
  const fetchHistogram: () => Promise<void> = useCallback(async () => {
    setHistogramLoading(true);

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);
    const bucketSizeInMinutes: number = computeBucketSizeInMinutes(
      dateRange.startValue,
      dateRange.endValue,
    );

    const payload: JSONObject = {
      startTime: dateRange.startValue.toISOString(),
      endTime: dateRange.endValue.toISOString(),
      bucketSizeInMinutes,
    };

    /*
     * The chart reads the SAME filters as the list — chips and search
     * unioned per column, resource keys unioned into one serviceIds list
     * (they all filter the underlying `primaryEntityId` column), and the
     * prop-level scope on top.
     */
    const histogramResourceIds: Array<string> = [...resourceIds];
    if (
      props.primaryEntityId &&
      !histogramResourceIds.includes(props.primaryEntityId.toString())
    ) {
      histogramResourceIds.push(props.primaryEntityId.toString());
    }
    if (resolvedServices.matchedNothing) {
      payload["serviceIds"] = [NO_MATCH_ENTITY_ID];
    } else if (histogramResourceIds.length > 0) {
      payload["serviceIds"] = histogramResourceIds;
    }
    if (columnLiterals["exceptionType"]) {
      payload["exceptionTypes"] = columnLiterals["exceptionType"];
    }
    if (columnLiterals["environment"]) {
      payload["environments"] = columnLiterals["environment"];
    }
    if (parsedSearch.freeText.length > 0) {
      payload["messageSearchText"] = parsedSearch.freeText;
    }
    /*
     * The class lens is deliberately NOT sent, because there is nowhere to
     * send it: this endpoint aggregates ClickHouse ExceptionInstance rows and
     * the fault class is a column on the Postgres exception GROUP, so the
     * chart has no class dimension. The `fingerprints` escape hatch below
     * cannot carry it either — that list is capped at
     * MAX_SCOPED_FINGERPRINTS, and "every group that is an issue" is not a
     * bounded list.
     *
     * So the chart counts occurrences of every class while the list under it
     * shows one lens. That is the known cost of the storage split, and it is
     * part of why the lens is a labelled control the user can see rather than
     * a silent default. Carrying errorClass onto the instance rows at ingest
     * is what would close it.
     */

    /*
     * Instance scope: the endpoint has no attribute dimension and takes
     * literal lists only, but it accepts `fingerprints` — the resolved scope
     * is what carries an attribute or wildcard filter to the chart.
     */
    if (instanceScopeKey) {
      payload["fingerprints"] =
        resolvedScopeFingerprints && resolvedScopeFingerprints.length > 0
          ? resolvedScopeFingerprints
          : [NO_MATCH_FINGERPRINT];
    }

    try {
      const response: HTTPResponse<JSONObject> = await postApi(
        "/telemetry/exceptions/histogram",
        payload,
      );
      const buckets: Array<HistogramBucket> = (response.data["buckets"] ||
        []) as unknown as Array<HistogramBucket>;
      setHistogramBuckets(buckets);
    } catch {
      // non-critical
      setHistogramBuckets([]);
    } finally {
      setHistogramLoading(false);
    }
  }, [
    timeRange,
    columnLiterals,
    resourceIds,
    resolvedServices,
    parsedSearch,
    props.primaryEntityId,
    instanceScopeKey,
    resolvedScopeFingerprints,
  ]);

  useEffect(() => {
    void fetchHistogram();
  }, [fetchHistogram]);

  // Histogram series (handled/unhandled) — colored per level
  const histogramSeries: Array<HistogramSeriesOption> = useMemo(() => {
    return [
      {
        key: "unhandled",
        label: "Unhandled",
        color: EXCEPTION_SERIES_COLORS["unhandled"]!,
      },
      {
        key: "handled",
        label: "Handled",
        color: EXCEPTION_SERIES_COLORS["handled"]!,
      },
    ];
  }, []);

  // Histogram drag-to-zoom
  const handleHistogramTimeRangeSelect: (start: Date, end: Date) => void =
    useCallback((start: Date, end: Date) => {
      setTimeRange({
        range: TimeRange.CUSTOM,
        startAndEndDate: new InBetween<Date>(start, end),
      });
      setPage(1);
    }, []);

  // Facet configs
  const facetConfigs: Array<FacetConfig> = useMemo(() => {
    const serviceNameMap: Record<string, string> = {};
    const serviceColorMap: Record<string, string> = {};
    for (const service of services) {
      if (service.id) {
        serviceNameMap[service.id.toString()] = service.name || "Unknown";
        if (service.serviceColor) {
          serviceColorMap[service.id.toString()] =
            service.serviceColor.toString();
        }
      }
    }

    const hostNameMap: Record<string, string> = {};
    for (const host of hosts) {
      if (host.id) {
        hostNameMap[host.id.toString()] =
          host.name || host.hostIdentifier || "Unknown";
      }
    }

    const dockerHostNameMap: Record<string, string> = {};
    for (const dockerHost of dockerHosts) {
      if (dockerHost.id) {
        dockerHostNameMap[dockerHost.id.toString()] =
          dockerHost.name || dockerHost.hostIdentifier || "Unknown";
      }
    }

    const podmanHostNameMap: Record<string, string> = {};
    for (const podmanHost of podmanHosts) {
      if (podmanHost.id) {
        podmanHostNameMap[podmanHost.id.toString()] =
          podmanHost.name || podmanHost.hostIdentifier || "Unknown";
      }
    }

    const clusterNameMap: Record<string, string> = {};
    for (const cluster of kubernetesClusters) {
      if (cluster.id) {
        clusterNameMap[cluster.id.toString()] =
          cluster.name || cluster.clusterIdentifier || "Unknown";
      }
    }

    return [
      {
        key: "primaryEntityId",
        title: "Service",
        valueDisplayMap: serviceNameMap,
        valueColorMap: serviceColorMap,
        priority: 1,
        serverSearchable: true,
      },
      {
        key: "hostId",
        title: "Host",
        valueDisplayMap: hostNameMap,
        priority: 2,
        serverSearchable: true,
      },
      {
        key: "dockerHostId",
        title: "Docker Host",
        valueDisplayMap: dockerHostNameMap,
        priority: 3,
        serverSearchable: true,
      },
      {
        key: "podmanHostId",
        title: "Podman Host",
        valueDisplayMap: podmanHostNameMap,
        priority: 4,
        serverSearchable: true,
      },
      {
        key: "kubernetesClusterId",
        title: "Kubernetes Cluster",
        valueDisplayMap: clusterNameMap,
        priority: 5,
        serverSearchable: true,
      },
      {
        key: "exceptionType",
        title: "Exception Type",
        priority: 6,
      },
      {
        key: "environment",
        title: "Environment",
        priority: 7,
      },
      /*
       * Last on purpose: the segmented control above the list is the primary
       * way to move between lenses, and this facet is the breakdown behind it
       * — "how much is the Issues lens hiding, and of what".
       */
      {
        key: EXCEPTION_ERROR_CLASS_COLUMN,
        title: "Error Class",
        valueDisplayMap: ERROR_CLASS_DISPLAY_NAMES,
        priority: 8,
      },
    ];
  }, [services, hosts, dockerHosts, podmanHosts, kubernetesClusters]);

  /*
   * Fetch facets from the backend. Counts come from ClickHouse aggregation
   * over the current time window; resource facet values are resolved from
   * the Postgres source-of-truth so every project resource appears in the
   * sidebar (and search hits the full list, not just the loaded subset).
   */
  const fetchFacets: () => Promise<void> = useCallback(async () => {
    setFacetLoading(true);

    const dateRange: InBetween<Date> =
      RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

    const payload: JSONObject = {
      startTime: dateRange.startValue.toISOString(),
      endTime: dateRange.endValue.toISOString(),
      facetKeys: [
        "primaryEntityId",
        "hostId",
        "dockerHostId",
        "podmanHostId",
        "kubernetesClusterId",
        "exceptionType",
        "environment",
      ],
    };

    /*
     * The same filters the list and the chart read (see fetchHistogram) —
     * facet counts that disagree with the list are how a user learns not to
     * trust either.
     */
    const facetResourceIds: Array<string> = [...resourceIds];
    if (
      props.primaryEntityId &&
      !facetResourceIds.includes(props.primaryEntityId.toString())
    ) {
      facetResourceIds.push(props.primaryEntityId.toString());
    }
    if (resolvedServices.matchedNothing) {
      payload["serviceIds"] = [NO_MATCH_ENTITY_ID];
    } else if (facetResourceIds.length > 0) {
      payload["serviceIds"] = facetResourceIds;
    }
    if (columnLiterals["exceptionType"]) {
      payload["exceptionTypes"] = columnLiterals["exceptionType"];
    }
    if (columnLiterals["environment"]) {
      payload["environments"] = columnLiterals["environment"];
    }
    if (parsedSearch.freeText.length > 0) {
      payload["messageSearchText"] = parsedSearch.freeText;
    }

    const facetSearchTextActive: Record<string, string> = {};
    for (const [key, val] of Object.entries(facetSearchText)) {
      if (val && val.trim().length > 0) {
        facetSearchTextActive[key] = val.trim();
      }
    }
    if (Object.keys(facetSearchTextActive).length > 0) {
      payload["facetSearchText"] = facetSearchTextActive;
    }
    // The instance scope narrows facet counts too (see fetchHistogram).
    if (instanceScopeKey) {
      payload["fingerprints"] =
        resolvedScopeFingerprints && resolvedScopeFingerprints.length > 0
          ? resolvedScopeFingerprints
          : [NO_MATCH_FINGERPRINT];
    }

    try {
      const response: HTTPResponse<JSONObject> = await postApi(
        "/telemetry/exceptions/facets",
        payload,
      );
      const facets: FacetData = (response.data["facets"] ||
        {}) as unknown as FacetData;
      setFacetData(facets);
    } catch {
      // Facets are non-critical; silently degrade
      setFacetData({});
    } finally {
      setFacetLoading(false);
    }
  }, [
    timeRange,
    columnLiterals,
    resourceIds,
    resolvedServices,
    parsedSearch,
    props.primaryEntityId,
    facetSearchText,
    instanceScopeKey,
    resolvedScopeFingerprints,
  ]);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets]);

  const [errorClassFacetValues, setErrorClassFacetValues] = useState<
    Array<FacetValue>
  >([]);

  /*
   * The same query the list runs, minus the class clause.
   *
   * Counting the classes UNDER the lens would make the facet useless: from
   * inside "Issues" it would report "User error 0" and the drawer the lens
   * sweeps into would look empty. Every other filter still applies, so the
   * breakdown describes the slice the user is actually looking at.
   */
  const errorClassFacetQuery: Query<TelemetryException> = useMemo(() => {
    const scopeless: Query<TelemetryException> = { ...query };
    delete (scopeless as Record<string, unknown>)[EXCEPTION_ERROR_CLASS_COLUMN];
    return scopeless;
  }, [query]);

  /*
   * The error-class facet is counted here rather than by
   * /telemetry/exceptions/facets like every other facet, because that
   * endpoint aggregates the ClickHouse ExceptionInstance table and the fault
   * class is a column on the Postgres exception GROUP. Asked for this facet
   * it would fall through to its attributes-map branch and answer "No values
   * found" forever. Counting the same Postgres rows the list reads is also
   * the only way these numbers can agree with it.
   *
   * One count per class — five small indexed COUNTs, issued together, on the
   * same cadence as the list fetch beside them.
   */
  useEffect(() => {
    let isCancelled: boolean = false;

    const loadErrorClassCounts: () => Promise<void> =
      async (): Promise<void> => {
        const classes: Array<ErrorClass> = Object.values(ErrorClass);

        try {
          const counts: Array<number> = await Promise.all(
            classes.map((errorClass: ErrorClass): Promise<number> => {
              const classQuery: Query<TelemetryException> = {
                ...errorClassFacetQuery,
              };
              (classQuery as Record<string, unknown>)[
                EXCEPTION_ERROR_CLASS_COLUMN
              ] = errorClass;

              return ModelAPI.count({
                modelType: TelemetryException,
                query: classQuery,
              });
            }),
          );

          if (isCancelled) {
            return;
          }

          const values: Array<FacetValue> = [];

          classes.forEach((errorClass: ErrorClass, index: number): void => {
            const count: number = counts[index] || 0;
            // Empty classes are left out, as the server-side facets do.
            if (count > 0) {
              values.push({ value: errorClass, count });
            }
          });

          values.sort((a: FacetValue, b: FacetValue): number => {
            return b.count - a.count;
          });

          setErrorClassFacetValues(values);
        } catch {
          // Facets are non-critical; an empty section beats a broken page.
          if (!isCancelled) {
            setErrorClassFacetValues([]);
          }
        }
      };

    void loadErrorClassCounts();

    return () => {
      isCancelled = true;
    };
  }, [errorClassFacetQuery]);

  /*
   * The backend facets plus the one this component counts itself. Merged
   * here rather than into `facetData` state so a facet refetch cannot drop
   * the class counts, and a class recount cannot drop the rest.
   */
  const mergedFacetData: FacetData = useMemo(() => {
    return {
      ...facetData,
      [EXCEPTION_ERROR_CLASS_COLUMN]: errorClassFacetValues,
    };
  }, [facetData, errorClassFacetValues]);

  const handleFacetInclude: (facetKey: string, value: string) => void =
    useCallback(
      (facetKey: string, value: string) => {
        setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
          if (
            prev.some((f: ActiveFilter): boolean => {
              return f.facetKey === facetKey && f.value === value;
            })
          ) {
            return prev;
          }
          const config: FacetConfig | undefined = facetConfigs.find(
            (c: FacetConfig): boolean => {
              return c.key === facetKey;
            },
          );
          const displayKey: string = config?.title || facetKey;
          const displayValue: string =
            config?.valueDisplayMap?.[value] || value;
          return [...prev, { facetKey, value, displayKey, displayValue }];
        });
        setPage(1);
      },
      [facetConfigs],
    );

  const handleRemoveFilter: (facetKey: string, value: string) => void =
    useCallback((facetKey: string, value: string) => {
      setActiveFilters((prev: Array<ActiveFilter>): Array<ActiveFilter> => {
        return prev.filter((f: ActiveFilter): boolean => {
          return !(f.facetKey === facetKey && f.value === value);
        });
      });
      setPage(1);
    }, []);

  const handleClearAllFilters: () => void = useCallback(() => {
    setActiveFilters([]);
    setPage(1);
  }, []);

  /*
   * Read-only chips for prop-level scoping (e.g. service view page), merged
   * with user-added chips. Display labels are re-derived from facetConfigs so
   * URL-restored chips (which only carry facetKey/value) still render the
   * human-readable label once services/hosts/etc. load.
   */
  const mergedActiveFilters: Array<ActiveFilter> = useMemo(() => {
    const resolveDisplay: (chip: ActiveFilter) => ActiveFilter = (
      chip: ActiveFilter,
    ) => {
      const config: FacetConfig | undefined = facetConfigs.find(
        (c: FacetConfig): boolean => {
          return c.key === chip.facetKey;
        },
      );
      const displayKey: string = chip.facetKey.startsWith("attributes.")
        ? chip.facetKey.substring("attributes.".length)
        : config?.title || chip.displayKey || chip.facetKey;
      const displayValue: string =
        config?.valueDisplayMap?.[chip.value] ||
        chip.displayValue ||
        chip.value;
      return { ...chip, displayKey, displayValue };
    };

    const base: Array<ActiveFilter> = [];
    if (props.primaryEntityId) {
      base.push(
        resolveDisplay({
          facetKey: "primaryEntityId",
          value: props.primaryEntityId.toString(),
          displayKey: "Service",
          displayValue: props.primaryEntityId.toString(),
          readOnly: true,
        }),
      );
    }
    return [...base, ...activeFilters.map(resolveDisplay)];
  }, [props.primaryEntityId, activeFilters, facetConfigs]);

  // Row click → navigate to exception detail
  const handleRowClick: (exception: TelemetryException) => void = useCallback(
    (exception: TelemetryException) => {
      if (!exception._id && !exception.id) {
        return;
      }
      const route: Route = RouteUtil.populateRouteParams(
        RouteMap[PageMap.EXCEPTIONS_VIEW]!,
        { modelId: (exception._id || exception.id)!.toString() },
      );
      Navigation.navigate(route);
    },
    [],
  );

  // Bulk-ish actions via toolbar trailing
  const handleResolveAll: () => Promise<void> = useCallback(async () => {
    const ids: Array<ObjectID> = exceptions
      .filter((e: TelemetryException): boolean => {
        return !e.isResolved;
      })
      .map((e: TelemetryException): ObjectID => {
        return (e._id || e.id) as ObjectID;
      })
      .filter((id: ObjectID | null): id is ObjectID => {
        return Boolean(id);
      });
    if (ids.length === 0) {
      return;
    }
    try {
      for (const id of ids) {
        await ModelAPI.updateById<TelemetryException>({
          id,
          modelType: TelemetryException,
          data: {
            isResolved: true,
            markedAsResolvedAt: OneUptimeDate.getCurrentDate(),
            markedAsResolvedByUserId: UserUtil.getUserId() || null,
          },
        });
      }
      void fetchExceptions();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
  }, [exceptions, fetchExceptions]);

  const statusPills: ReactElement = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
      {(
        [
          ["unresolved", "Unresolved"],
          ["resolved", "Resolved"],
          ["archived", "Archived"],
          ["all", "All"],
        ] as Array<[ExceptionStatus, string]>
      ).map(([key, label]: [ExceptionStatus, string]): ReactElement => {
        const isActive: boolean = status === key;
        return (
          <button
            key={key}
            type="button"
            className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
              isActive
                ? "bg-indigo-50 text-indigo-700"
                : "text-gray-500 hover:text-gray-800"
            }`}
            onClick={() => {
              setStatus(key);
              setPage(1);
            }}
          >
            {label}
          </button>
        );
      })}
    </div>
  );

  /*
   * The class lens, built as a VISIBLE, removable control alongside the
   * status pills rather than a default baked into the query.
   *
   * The default hides every user error and expected denial, which is most of
   * what makes an Issues list unreadable — but a filter nobody can see is a
   * filter nobody can turn off. A developer hunting the BadDataException they
   * just triggered would find nothing and conclude the exception was never
   * recorded, which is a worse failure than the noise this removes. So the
   * lens says what it is doing and takes one click to widen.
   */
  const classPills: ReactElement = (
    <div className="inline-flex items-center gap-1 rounded-lg border border-gray-200 bg-white p-0.5">
      {(
        [
          ["issues", "Issues", "Hide user errors and expected denials"],
          [
            "user-errors",
            "User errors",
            "Only user errors and expected denials — the classes the Issues lens hides",
          ],
          ["all", "All", "Every exception, whatever its fault class"],
        ] as Array<[ExceptionClassScope, string, string]>
      ).map(
        ([key, label, description]: [
          ExceptionClassScope,
          string,
          string,
        ]): ReactElement => {
          const isActive: boolean = classScope === key;
          return (
            <button
              key={key}
              type="button"
              title={description}
              className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "bg-indigo-50 text-indigo-700"
                  : "text-gray-500 hover:text-gray-800"
              }`}
              onClick={() => {
                setClassScope(key);
                setPage(1);
              }}
            >
              {label}
            </button>
          );
        },
      )}
    </div>
  );

  /*
   * Two independent lenses on the same list — status and fault class — so
   * they read as two groups rather than one seven-button row.
   */
  const leadingActions: ReactElement = (
    <div className="flex flex-wrap items-center gap-2">
      {statusPills}
      {classPills}
    </div>
  );

  const trailingActions: ReactElement | null =
    status === "unresolved" && exceptions.length > 0 ? (
      <button
        type="button"
        className="inline-flex items-center gap-1.5 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1.5 text-xs font-medium text-emerald-700 shadow-sm transition-colors hover:border-emerald-400 hover:bg-emerald-100"
        onClick={() => {
          void handleResolveAll();
        }}
        title="Resolve all visible exceptions"
      >
        Resolve page
      </button>
    ) : null;

  return (
    <TelemetryViewer<TelemetryException>
      items={exceptions}
      isLoading={isLoading}
      error={error || undefined}
      onRefresh={() => {
        void fetchExceptions();
        void fetchHistogram();
      }}
      emptyMessage="No exceptions found"
      itemLabel="exceptions"
      renderRow={(exception: TelemetryException): ReactElement => {
        const service: Service | undefined = exception.primaryEntityId
          ? serviceById[exception.primaryEntityId.toString()]
          : undefined;
        return (
          <ExceptionRow
            exception={exception}
            service={service}
            onClick={() => {
              handleRowClick(exception);
            }}
          />
        );
      }}
      getRowKey={(exception: TelemetryException, index: number): string => {
        return `${
          (exception._id || exception.id)?.toString() ||
          exception.fingerprint ||
          "row"
        }-${index}`;
      }}
      // Search
      searchValue={searchValue}
      onSearchChange={setSearchValue}
      onSearchSubmit={() => {
        setSubmittedSearch(searchValue);
        setPage(1);
      }}
      searchPlaceholder="Search exceptions — e.g. type:TypeError @http.status_code:5*"
      /*
       * The well-known aliases live alongside the user's attribute keys in the
       * @-mode dropdown. `@type:` has meant the exception type here since this
       * explorer shipped, so both `@type:` and the bare `type:` resolve to the
       * column (see parseExceptionSearch).
       */
      searchAttributeSuggestions={[
        "type",
        "service",
        "env",
        "class",
        ...telemetryAttributes.filter((attr: string): boolean => {
          return (
            attr !== "type" &&
            attr !== "service" &&
            attr !== "env" &&
            attr !== "class"
          );
        }),
      ]}
      searchValueSuggestions={attributeValueSuggestions}
      searchAttributesLoading={attributesLoading}
      searchValuesLoading={attributeValuesLoading}
      onSearchFieldValueSelect={(fieldKey: string, value: string) => {
        /*
         * Enter turns `key:value` into a chip. A chip stores its value
         * verbatim and compiles it as ONE predicate, so a value carrying
         * operator syntax (`a*`, `~foo`, `(a OR b)`) must NOT be chipped —
         * returning false leaves the token in the input, where the parser
         * reads it as the operator the user typed. Chipping it would have
         * searched for a literal asterisk.
         */
        if (hasSearchDsl(value)) {
          return false;
        }

        /*
         * Strip surrounding quotes before storing the chip so `type:"My Type"`
         * doesn't store `"My Type"` literally (which would never match) —
         * a chip value is never re-tokenized, so it needs no quoting to keep
         * its spaces.
         */
        const cleanValue: string =
          value.length >= 2 && value.startsWith('"') && value.endsWith('"')
            ? value.slice(1, -1)
            : value;

        /*
         * Known fields (type/service/env) chip under their canonical column
         * name (e.g. `type` → `exceptionType`) so they filter correctly.
         * Alias detection is case-insensitive so users can type `Type:` or
         * `SERVICE:`; attribute keys keep their original case.
         */
        const aliased: string | undefined =
          EXCEPTION_FIELD_ALIASES[fieldKey.toLowerCase()];

        if (aliased === EXCEPTION_SERVICE_COLUMN) {
          /*
           * A service chip stores the id the column holds, so a typed NAME
           * has to resolve first. A name that is unknown, or that matches
           * several services, goes back to the search string instead — where
           * it resolves against every service at query time, rather than
           * chipping a `primaryEntityId = 'api'` filter no row can match.
           */
          const chipId: string | null = resolveExceptionServiceChipId({
            value: cleanValue,
            services: serviceOptions,
          });

          if (!chipId) {
            return false;
          }

          handleFacetInclude(EXCEPTION_SERVICE_COLUMN, chipId);
          return true;
        }

        if (aliased) {
          /*
           * A chip stores what the COLUMN holds, so a class is canonicalised
           * on the way in: chipped as typed, `class:User-Error` would match
           * no row, and the Error Class facet could not label it either.
           */
          handleFacetInclude(
            aliased,
            aliased === EXCEPTION_ERROR_CLASS_COLUMN
              ? canonicalizeExceptionErrorClass(cleanValue)
              : cleanValue,
          );
          return true;
        }

        /*
         * Unknown keys are instance attributes: chip them under the
         * attributes. prefix so they narrow via the fingerprint scope.
         */
        handleFacetInclude(
          `${EXCEPTION_ATTRIBUTE_FACET_PREFIX}${fieldKey}`,
          cleanValue,
        );
        return true;
      }}
      searchFieldAliasMap={EXCEPTION_FIELD_ALIASES}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="service:api env:production connection refused"
      // Time — drives both the list (via lastSeenAt) and the histogram window
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
        setPage(1);
      }}
      toolbarLeadingActions={leadingActions}
      toolbarTrailingActions={trailingActions}
      // Facets
      showFacetSidebar={true}
      facetData={mergedFacetData}
      facetConfigs={facetConfigs}
      facetLoading={facetLoading}
      onFacetInclude={handleFacetInclude}
      onFacetSearchChange={(facetKey: string, text: string) => {
        setFacetSearchText(
          (prev: Record<string, string>): Record<string, string> => {
            if ((prev[facetKey] || "") === text) {
              return prev;
            }
            const next: Record<string, string> = { ...prev };
            if (text.length === 0) {
              delete next[facetKey];
            } else {
              next[facetKey] = text;
            }
            return next;
          },
        );
      }}
      activeFilters={mergedActiveFilters}
      onRemoveFilter={handleRemoveFilter}
      onClearAllFilters={handleClearAllFilters}
      // Histogram: handled / unhandled occurrences over time
      showHistogram={true}
      histogramBuckets={histogramBuckets}
      histogramSeries={histogramSeries}
      histogramTitle="Exceptions over time"
      histogramLoading={histogramLoading}
      onHistogramTimeRangeSelect={handleHistogramTimeRangeSelect}
      // Pagination
      page={page}
      pageSize={pageSize}
      totalCount={totalCount}
      onPageChange={setPage}
      onPageSizeChange={(size: number) => {
        setPageSize(size);
        setPage(1);
      }}
    />
  );
};

export default ExceptionsViewer;
