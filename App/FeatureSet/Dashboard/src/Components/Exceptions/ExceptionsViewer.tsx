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

const SEARCH_HELP_ROWS: Array<SearchHelpRow> = [
  {
    syntax: "@type:<type>",
    description: "Filter by exception type",
    example: "@type:TypeError",
  },
  {
    syntax: "@service:<name>",
    description: "Filter by service",
    example: "@service:api",
  },
  {
    syntax: "@env:<environment>",
    description: "Filter by environment",
    example: "@env:production",
  },
];

const FIELD_ALIAS_MAP: Record<string, string> = {
  type: "exceptionType",
  service: "primaryEntityId",
  env: "environment",
};

export type ExceptionStatus = "unresolved" | "resolved" | "archived" | "all";

const EXCEPTION_STATUS_VALUES: ReadonlyArray<ExceptionStatus> = [
  "unresolved",
  "resolved",
  "archived",
  "all",
];

interface InitialUrlState {
  search: string;
  filters: Array<ActiveFilter>;
  timeRange: RangeStartAndEndDateTime;
  page: number;
  pageSize: number;
  status: ExceptionStatus | null;
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

  return { search, filters, timeRange, page, pageSize, status };
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
    if (timeRange.range !== TimeRange.PAST_ONE_DAY) {
      params.set("range", timeRange.range);
    }
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

    const query: string = params.toString();
    const nextSearch: string = query ? `?${query}` : "";
    if (nextSearch !== window.location.search) {
      window.history.replaceState(
        null,
        "",
        `${window.location.pathname}${nextSearch}${window.location.hash}`,
      );
    }
  }, [
    submittedSearch,
    activeFilters,
    timeRange,
    page,
    pageSize,
    status,
    defaultStatus,
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

  // Parse search
  const parseSearch: (raw: string) => {
    freeText: string;
    fieldFilters: Record<string, Array<string>>;
  } = useCallback((raw: string) => {
    const fieldFilters: Record<string, Array<string>> = {};
    const freeTextParts: Array<string> = [];
    /*
     * Tokenizer also matches `@attr:"value with spaces"`. See the matching
     * block in TracesViewer for details on the merge logic that handles
     * `@type: "..."` (space after colon) and unclosed quotes.
     */
    const rawTokens: Array<string> =
      raw.match(/@?\S+:"[^"]*"|@\S+:[^\s]+|\S+/g) || [];
    const tokens: Array<string> = [];
    for (let i: number = 0; i < rawTokens.length; i++) {
      const token: string = rawTokens[i]!;
      if (
        token.endsWith(":") &&
        token.startsWith("@") &&
        i + 1 < rawTokens.length
      ) {
        let merged: string = token + rawTokens[i + 1]!;
        i++;
        if (merged.includes(':"') && !merged.endsWith('"')) {
          while (i + 1 < rawTokens.length && !merged.endsWith('"')) {
            i++;
            merged = merged + " " + rawTokens[i]!;
          }
        }
        tokens.push(merged);
        continue;
      }
      if (token.includes(':"') && !token.endsWith('"')) {
        let merged: string = token;
        while (i + 1 < rawTokens.length && !merged.endsWith('"')) {
          i++;
          merged = merged + " " + rawTokens[i]!;
        }
        tokens.push(merged);
        continue;
      }
      tokens.push(token);
    }
    const stripQuotes: (s: string) => string = (s: string): string => {
      if (s.length >= 2 && s.startsWith('"') && s.endsWith('"')) {
        return s.slice(1, -1);
      }
      return s;
    };
    for (const token of tokens) {
      const match: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);
      if (match) {
        const alias: string = match[1]!;
        const value: string = stripQuotes(match[2]!);
        if (value.length === 0) {
          continue;
        }
        const backendField: string = FIELD_ALIAS_MAP[alias] || alias;
        if (!fieldFilters[backendField]) {
          fieldFilters[backendField] = [];
        }
        fieldFilters[backendField]!.push(value);
      } else {
        freeTextParts.push(token);
      }
    }
    return { freeText: freeTextParts.join(" ").trim(), fieldFilters };
  }, []);

  // Build query
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

    // Facet filters
    const facetGroups: Record<string, Array<string>> = {};
    for (const f of activeFilters) {
      if (!facetGroups[f.facetKey]) {
        facetGroups[f.facetKey] = [];
      }
      facetGroups[f.facetKey]!.push(f.value);
    }

    /*
     * primaryEntityId / hostId / dockerHostId / kubernetesClusterId all map
     * to the same underlying `primaryEntityId` column on TelemetryException —
     * the discriminator only matters at facet bucketing time.
     */
    const resourceFacetKeys: Set<string> = new Set<string>([
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]);
    const resourceIds: Set<string> = new Set<string>();
    for (const key of resourceFacetKeys) {
      const values: Array<string> | undefined = facetGroups[key];
      if (values) {
        for (const v of values) {
          resourceIds.add(v);
        }
      }
    }
    if (resourceIds.size > 0) {
      (q as Record<string, unknown>)["primaryEntityId"] =
        resourceIds.size === 1
          ? Array.from(resourceIds)[0]!
          : new Includes(Array.from(resourceIds));
    }

    for (const key of Object.keys(facetGroups)) {
      if (resourceFacetKeys.has(key)) {
        continue;
      }
      const values: Array<string> = facetGroups[key]!;
      if (values.length === 1) {
        (q as Record<string, unknown>)[key] = values[0]!;
      } else {
        (q as Record<string, unknown>)[key] = new Includes(values);
      }
    }

    // Search field filters
    const { fieldFilters, freeText } = parseSearch(submittedSearch);
    for (const key of Object.keys(fieldFilters)) {
      const values: Array<string> = fieldFilters[key]!;
      if (values.length === 1) {
        (q as Record<string, unknown>)[key] = values[0]!;
      } else {
        (q as Record<string, unknown>)[key] = new Includes(values);
      }
    }
    if (freeText) {
      (q as Record<string, unknown>)["exceptionType"] = freeText;
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

    return q;
  }, [
    props.primaryEntityId,
    status,
    activeFilters,
    submittedSearch,
    parseSearch,
    timeRange,
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

    // Collect filter values from active facets + parsed search
    const groups: Record<string, Array<string>> = {};
    for (const f of activeFilters) {
      if (!groups[f.facetKey]) {
        groups[f.facetKey] = [];
      }
      groups[f.facetKey]!.push(f.value);
    }
    const { fieldFilters, freeText } = parseSearch(submittedSearch);
    for (const key of Object.keys(fieldFilters)) {
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key]!.push(...fieldFilters[key]!);
    }

    // Scope histogram by the primaryEntityId prop, if present
    if (props.primaryEntityId) {
      if (!groups["primaryEntityId"]) {
        groups["primaryEntityId"] = [];
      }
      groups["primaryEntityId"]!.push(props.primaryEntityId.toString());
    }

    /*
     * Union primaryEntityId / hostId / dockerHostId / kubernetesClusterId
     * into a single serviceIds list — they all filter the underlying
     * `primaryEntityId` column.
     */
    const histogramResourceIds: Set<string> = new Set<string>();
    for (const k of [
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]) {
      const values: Array<string> | undefined = groups[k];
      if (values) {
        for (const v of values) {
          histogramResourceIds.add(v);
        }
      }
    }
    if (histogramResourceIds.size > 0) {
      payload["serviceIds"] = Array.from(histogramResourceIds);
    }
    if (groups["exceptionType"] && groups["exceptionType"].length > 0) {
      payload["exceptionTypes"] = groups["exceptionType"];
    }
    if (groups["environment"] && groups["environment"].length > 0) {
      payload["environments"] = groups["environment"];
    }
    if (freeText && freeText.length > 0) {
      payload["messageSearchText"] = freeText;
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
    activeFilters,
    submittedSearch,
    parseSearch,
    props.primaryEntityId,
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
     * Collect filter values from active facets + parsed search (same shape
     * as the histogram payload above — keeps facet counts aligned with the
     * list scope).
     */
    const groups: Record<string, Array<string>> = {};
    for (const f of activeFilters) {
      if (!groups[f.facetKey]) {
        groups[f.facetKey] = [];
      }
      groups[f.facetKey]!.push(f.value);
    }
    const { fieldFilters, freeText } = parseSearch(submittedSearch);
    for (const key of Object.keys(fieldFilters)) {
      if (!groups[key]) {
        groups[key] = [];
      }
      groups[key]!.push(...fieldFilters[key]!);
    }
    if (props.primaryEntityId) {
      if (!groups["primaryEntityId"]) {
        groups["primaryEntityId"] = [];
      }
      groups["primaryEntityId"]!.push(props.primaryEntityId.toString());
    }

    const resourceIds: Set<string> = new Set<string>();
    for (const k of [
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "podmanHostId",
      "kubernetesClusterId",
    ]) {
      const values: Array<string> | undefined = groups[k];
      if (values) {
        for (const v of values) {
          resourceIds.add(v);
        }
      }
    }
    if (resourceIds.size > 0) {
      payload["serviceIds"] = Array.from(resourceIds);
    }
    if (groups["exceptionType"] && groups["exceptionType"].length > 0) {
      payload["exceptionTypes"] = groups["exceptionType"];
    }
    if (groups["environment"] && groups["environment"].length > 0) {
      payload["environments"] = groups["environment"];
    }
    if (freeText && freeText.length > 0) {
      payload["messageSearchText"] = freeText;
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
    activeFilters,
    submittedSearch,
    parseSearch,
    props.primaryEntityId,
    facetSearchText,
  ]);

  useEffect(() => {
    void fetchFacets();
  }, [fetchFacets]);

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
      searchPlaceholder="Search exceptions — e.g. @type:TypeError @service:api"
      /*
       * Exceptions treats every filter as `@alias:value` (no plain `field:value`
       * form), so the well-known aliases live alongside the user's attribute
       * keys in the @-mode dropdown.
       */
      searchAttributeSuggestions={[
        "type",
        "service",
        "env",
        ...telemetryAttributes.filter((attr: string): boolean => {
          return attr !== "type" && attr !== "service" && attr !== "env";
        }),
      ]}
      searchValueSuggestions={attributeValueSuggestions}
      searchAttributesLoading={attributesLoading}
      searchValuesLoading={attributeValuesLoading}
      onSearchFieldValueSelect={(fieldKey: string, value: string) => {
        /*
         * Known fields (type/service/env) become chips via their canonical
         * column name (e.g. `type` → `exceptionType`) so they filter
         * correctly. The TelemetryException model has no JSON attributes
         * column, so unknown keys go back through the search string path
         * — preserving the previous behavior rather than silently breaking
         * the filter. Alias detection is case-insensitive so users can type
         * `Type:` or `SERVICE:`; attribute keys keep their original case.
         *
         * Strip surrounding quotes before storing the chip so `type:"My Type"`
         * doesn't store `"My Type"` literally (which would never match).
         * The unknown-field branch keeps the quotes because the resulting
         * search string is re-parsed by `parseSearch`, which strips them.
         */
        const aliased: string | undefined =
          FIELD_ALIAS_MAP[fieldKey.toLowerCase()];
        if (aliased) {
          const cleanValue: string =
            value.length >= 2 && value.startsWith('"') && value.endsWith('"')
              ? value.slice(1, -1)
              : value;
          handleFacetInclude(aliased, cleanValue);
          return;
        }
        const newSearch: string = `@${fieldKey}:${value}`;
        setSearchValue(newSearch);
        setSubmittedSearch(newSearch);
        setPage(1);
      }}
      searchFieldAliasMap={FIELD_ALIAS_MAP}
      searchHelpRows={SEARCH_HELP_ROWS}
      searchHelpCombinedExample="@service:api @env:production TypeError"
      // Time — drives both the list (via lastSeenAt) and the histogram window
      timeRange={timeRange}
      onTimeRangeChange={(value: RangeStartAndEndDateTime) => {
        setTimeRange(value);
        setPage(1);
      }}
      toolbarLeadingActions={statusPills}
      toolbarTrailingActions={trailingActions}
      // Facets
      showFacetSidebar={true}
      facetData={facetData}
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
