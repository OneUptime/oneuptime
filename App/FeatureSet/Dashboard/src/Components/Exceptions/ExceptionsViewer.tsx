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
  service: "serviceId",
  env: "environment",
};

export type ExceptionStatus = "unresolved" | "resolved" | "archived" | "all";

export interface ExceptionsViewerProps {
  defaultStatus?: ExceptionStatus;
  serviceId?: ObjectID | undefined;
}

const ExceptionsViewer: FunctionComponent<ExceptionsViewerProps> = (
  props: ExceptionsViewerProps,
): ReactElement => {
  const [status, setStatus] = useState<ExceptionStatus>(
    props.defaultStatus || "unresolved",
  );

  const [exceptions, setExceptions] = useState<Array<TelemetryException>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [page, setPage] = useState<number>(1);
  const [pageSize, setPageSize] = useState<number>(DEFAULT_PAGE_SIZE);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const [services, setServices] = useState<Array<Service>>([]);
  const [hosts, setHosts] = useState<Array<Host>>([]);
  const [dockerHosts, setDockerHosts] = useState<Array<DockerHost>>([]);
  const [kubernetesClusters, setKubernetesClusters] = useState<
    Array<KubernetesCluster>
  >([]);

  const [searchValue, setSearchValue] = useState<string>("");
  const [submittedSearch, setSubmittedSearch] = useState<string>("");
  const [activeFilters, setActiveFilters] = useState<Array<ActiveFilter>>([]);

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

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_DAY,
  });
  const [histogramBuckets, setHistogramBuckets] = useState<
    Array<HistogramBucket>
  >([]);
  const [histogramLoading, setHistogramLoading] = useState<boolean>(false);

  // Load services / hosts / docker hosts / k8s clusters once
  useEffect(() => {
    const loadResources: () => Promise<void> = async () => {
      try {
        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
        if (!projectId) {
          return;
        }
        const [serviceResult, hostResult, dockerHostResult, clusterResult]: [
          ModelListResult<Service>,
          ModelListResult<Host>,
          ModelListResult<DockerHost>,
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
    const tokens: Array<string> = raw.match(/@\S+:[^\s]+|\S+/g) || [];
    for (const token of tokens) {
      const match: RegExpMatchArray | null = token.match(/^@([^:]+):(.*)$/);
      if (match) {
        const alias: string = match[1]!;
        const value: string = match[2]!;
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

    if (props.serviceId) {
      q.serviceId = props.serviceId;
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
     * serviceId / hostId / dockerHostId / kubernetesClusterId all map
     * to the same underlying `serviceId` column on TelemetryException —
     * the discriminator only matters at facet bucketing time.
     */
    const resourceFacetKeys: Set<string> = new Set<string>([
      "serviceId",
      "hostId",
      "dockerHostId",
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
      (q as Record<string, unknown>).serviceId =
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
    props.serviceId,
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
            serviceId: true,
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

    // Scope histogram by the serviceId prop, if present
    if (props.serviceId) {
      if (!groups["serviceId"]) {
        groups["serviceId"] = [];
      }
      groups["serviceId"]!.push(props.serviceId.toString());
    }

    /*
     * Union serviceId / hostId / dockerHostId / kubernetesClusterId
     * into a single serviceIds list — they all filter the underlying
     * `serviceId` column.
     */
    const histogramResourceIds: Set<string> = new Set<string>();
    for (const k of [
      "serviceId",
      "hostId",
      "dockerHostId",
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
  }, [timeRange, activeFilters, submittedSearch, parseSearch, props.serviceId]);

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

  // Lookup maps for resource-type classification
  const hostIdSet: Set<string> = useMemo(() => {
    const set: Set<string> = new Set<string>();
    for (const host of hosts) {
      if (host.id) {
        set.add(host.id.toString());
      }
    }
    return set;
  }, [hosts]);

  const dockerHostIdSet: Set<string> = useMemo(() => {
    const set: Set<string> = new Set<string>();
    for (const dockerHost of dockerHosts) {
      if (dockerHost.id) {
        set.add(dockerHost.id.toString());
      }
    }
    return set;
  }, [dockerHosts]);

  const kubernetesClusterIdSet: Set<string> = useMemo(() => {
    const set: Set<string> = new Set<string>();
    for (const cluster of kubernetesClusters) {
      if (cluster.id) {
        set.add(cluster.id.toString());
      }
    }
    return set;
  }, [kubernetesClusters]);

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

    const clusterNameMap: Record<string, string> = {};
    for (const cluster of kubernetesClusters) {
      if (cluster.id) {
        clusterNameMap[cluster.id.toString()] =
          cluster.name || cluster.clusterIdentifier || "Unknown";
      }
    }

    return [
      {
        key: "serviceId",
        title: "Service",
        valueDisplayMap: serviceNameMap,
        valueColorMap: serviceColorMap,
        priority: 1,
      },
      {
        key: "hostId",
        title: "Host",
        valueDisplayMap: hostNameMap,
        priority: 2,
      },
      {
        key: "dockerHostId",
        title: "Docker Host",
        valueDisplayMap: dockerHostNameMap,
        priority: 3,
      },
      {
        key: "kubernetesClusterId",
        title: "Kubernetes Cluster",
        valueDisplayMap: clusterNameMap,
        priority: 4,
      },
      {
        key: "exceptionType",
        title: "Exception Type",
        priority: 5,
      },
      {
        key: "environment",
        title: "Environment",
        priority: 6,
      },
    ];
  }, [services, hosts, dockerHosts, kubernetesClusters]);

  const facetData: FacetData = useMemo(() => {
    /*
     * `serviceId` on the exception row is a polymorphic resource id
     * (Service / Host / DockerHost / KubernetesCluster — disambiguated
     * server-side by the `serviceType` ClickHouse column). The Postgres
     * TelemetryException projection doesn't expose serviceType, so we
     * classify each id client-side by looking it up in the project's
     * resource maps.
     */
    const byService: Record<string, number> = {};
    const byHost: Record<string, number> = {};
    const byDockerHost: Record<string, number> = {};
    const byCluster: Record<string, number> = {};
    const byType: Record<string, number> = {};
    const byEnv: Record<string, number> = {};
    for (const e of exceptions) {
      if (e.serviceId) {
        const k: string = e.serviceId.toString();
        if (hostIdSet.has(k)) {
          byHost[k] = (byHost[k] || 0) + 1;
        } else if (dockerHostIdSet.has(k)) {
          byDockerHost[k] = (byDockerHost[k] || 0) + 1;
        } else if (kubernetesClusterIdSet.has(k)) {
          byCluster[k] = (byCluster[k] || 0) + 1;
        } else {
          byService[k] = (byService[k] || 0) + 1;
        }
      }
      if (e.exceptionType) {
        byType[e.exceptionType] = (byType[e.exceptionType] || 0) + 1;
      }
      if (e.environment) {
        byEnv[e.environment] = (byEnv[e.environment] || 0) + 1;
      }
    }
    const toFacet: (m: Record<string, number>) => Array<FacetValue> = (
      m: Record<string, number>,
    ) => {
      return Object.entries(m)
        .map(([value, count]: [string, number]): FacetValue => {
          return { value, count };
        })
        .sort((a: FacetValue, b: FacetValue): number => {
          return b.count - a.count;
        })
        .slice(0, 20);
    };
    return {
      serviceId: toFacet(byService),
      hostId: toFacet(byHost),
      dockerHostId: toFacet(byDockerHost),
      kubernetesClusterId: toFacet(byCluster),
      exceptionType: toFacet(byType),
      environment: toFacet(byEnv),
    };
  }, [exceptions, hostIdSet, dockerHostIdSet, kubernetesClusterIdSet]);

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

  // Read-only chips for prop-level scoping (e.g. service view page)
  const mergedActiveFilters: Array<ActiveFilter> = useMemo(() => {
    const base: Array<ActiveFilter> = [];
    if (props.serviceId) {
      base.push({
        facetKey: "serviceId",
        value: props.serviceId.toString(),
        displayKey: "Service",
        displayValue: props.serviceId.toString(),
        readOnly: true,
      });
    }
    return [...base, ...activeFilters];
  }, [props.serviceId, activeFilters]);

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
        const service: Service | undefined = exception.serviceId
          ? serviceById[exception.serviceId.toString()]
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
         */
        const aliased: string | undefined =
          FIELD_ALIAS_MAP[fieldKey.toLowerCase()];
        if (aliased) {
          handleFacetInclude(aliased, value);
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
      facetLoading={false}
      onFacetInclude={handleFacetInclude}
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
