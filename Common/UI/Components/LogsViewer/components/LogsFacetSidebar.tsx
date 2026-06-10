import React, { FunctionComponent, ReactElement, useMemo } from "react";
import {
  FacetData,
  FacetValue,
  ActiveFilter,
  LogsSavedViewOption,
} from "../types";
import FacetSection from "./FacetSection";
import Service from "../../../../Models/DatabaseModels/Service";
import Host from "../../../../Models/DatabaseModels/Host";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Dictionary from "../../../../Types/Dictionary";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import { getSeverityColor } from "./severityColors";
import LogSeverity from "../../../../Types/Log/LogSeverity";

export interface LogsFacetSidebarProps {
  facetData: FacetData;
  isLoading: boolean;
  serviceMap: Dictionary<Service>;
  hostMap?: Dictionary<Host>;
  dockerHostMap?: Dictionary<DockerHost>;
  kubernetesClusterMap?: Dictionary<KubernetesCluster>;
  onIncludeFilter: (facetKey: string, value: string) => void;
  onExcludeFilter: (facetKey: string, value: string) => void;
  activeFilters?: Array<ActiveFilter> | undefined;
  savedViews?: Array<LogsSavedViewOption> | undefined;
  selectedSavedViewId?: string | null | undefined;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
  /*
   * Called (debounced) when typing in a resource facet's search box. Lets
   * the parent re-issue the facets request with the typed text scoped to
   * that facet, so the result includes resources beyond the loaded subset.
   */
  onFacetSearchChange?:
    | ((facetKey: string, searchText: string) => void)
    | undefined;
}

const RESOURCE_FACET_KEYS: ReadonlySet<string> = new Set([
  "primaryEntityId",
  "hostId",
  "dockerHostId",
  "kubernetesClusterId",
]);

const SEVERITY_ORDER: Array<string> = [
  LogSeverity.Fatal,
  LogSeverity.Error,
  LogSeverity.Warning,
  LogSeverity.Information,
  LogSeverity.Debug,
  LogSeverity.Trace,
  LogSeverity.Unspecified,
];

function buildSeverityColorMap(): Record<string, string> {
  const map: Record<string, string> = {};

  for (const severity of SEVERITY_ORDER) {
    map[severity] = getSeverityColor(severity).fill;
  }

  return map;
}

function buildServiceDisplayMap(
  serviceMap: Dictionary<Service>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [id, service] of Object.entries(serviceMap)) {
    if (service?.name) {
      map[id] = service.name;
    }
  }

  return map;
}

function buildServiceColorMap(
  serviceMap: Dictionary<Service>,
): Record<string, string> {
  const map: Record<string, string> = {};

  for (const [id, service] of Object.entries(serviceMap)) {
    if (service?.serviceColor) {
      map[id] = service.serviceColor.toString();
    }
  }

  return map;
}

function buildHostDisplayMap(
  hostMap: Dictionary<Host> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!hostMap) {
    return map;
  }
  for (const [id, host] of Object.entries(hostMap)) {
    const label: string | undefined = host?.name || host?.hostIdentifier;
    if (label) {
      map[id] = label;
    }
  }
  return map;
}

function buildDockerHostDisplayMap(
  dockerHostMap: Dictionary<DockerHost> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!dockerHostMap) {
    return map;
  }
  for (const [id, dockerHost] of Object.entries(dockerHostMap)) {
    const label: string | undefined =
      dockerHost?.name || dockerHost?.hostIdentifier;
    if (label) {
      map[id] = label;
    }
  }
  return map;
}

function buildClusterDisplayMap(
  clusterMap: Dictionary<KubernetesCluster> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!clusterMap) {
    return map;
  }
  for (const [id, cluster] of Object.entries(clusterMap)) {
    const label: string | undefined =
      cluster?.name || cluster?.clusterIdentifier;
    if (label) {
      map[id] = label;
    }
  }
  return map;
}

function getFacetTitle(key: string): string {
  const titleMap: Record<string, string> = {
    severityText: "Severity",
    primaryEntityId: "Service",
    hostId: "Host",
    dockerHostId: "Docker Host",
    kubernetesClusterId: "Kubernetes Cluster",
    traceId: "Trace ID",
    spanId: "Span ID",
  };

  return titleMap[key] || key;
}

const LogsFacetSidebar: FunctionComponent<LogsFacetSidebarProps> = (
  props: LogsFacetSidebarProps,
): ReactElement => {
  const severityColorMap: Record<string, string> = useMemo(() => {
    return buildSeverityColorMap();
  }, []);

  const serviceDisplayMap: Record<string, string> = useMemo(() => {
    return buildServiceDisplayMap(props.serviceMap);
  }, [props.serviceMap]);

  const serviceColorMap: Record<string, string> = useMemo(() => {
    return buildServiceColorMap(props.serviceMap);
  }, [props.serviceMap]);

  const hostDisplayMap: Record<string, string> = useMemo(() => {
    return buildHostDisplayMap(props.hostMap);
  }, [props.hostMap]);

  const dockerHostDisplayMap: Record<string, string> = useMemo(() => {
    return buildDockerHostDisplayMap(props.dockerHostMap);
  }, [props.dockerHostMap]);

  const clusterDisplayMap: Record<string, string> = useMemo(() => {
    return buildClusterDisplayMap(props.kubernetesClusterMap);
  }, [props.kubernetesClusterMap]);

  const facetKeys: Array<string> = useMemo(() => {
    const priorityKeys: Array<string> = [
      "severityText",
      "primaryEntityId",
      "hostId",
      "dockerHostId",
      "kubernetesClusterId",
    ];
    const otherKeys: Array<string> = Object.keys(props.facetData).filter(
      (key: string) => {
        return !priorityKeys.includes(key);
      },
    );
    return [
      ...priorityKeys.filter((key: string) => {
        return props.facetData[key] !== undefined;
      }),
      ...otherKeys.sort(),
    ];
  }, [props.facetData]);

  // Build a map of facetKey -> Set<activeValue>
  const activeValuesByKey: Record<string, Set<string>> = useMemo(() => {
    const map: Record<string, Set<string>> = {};

    if (props.activeFilters) {
      for (const filter of props.activeFilters) {
        if (!map[filter.facetKey]) {
          map[filter.facetKey] = new Set<string>();
        }

        map[filter.facetKey]!.add(filter.value);
      }
    }

    return map;
  }, [props.activeFilters]);

  return (
    <div className="flex h-full w-56 flex-none flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-3 py-2.5">
        <h3 className="text-[11px] font-semibold uppercase tracking-widest text-gray-400">
          Filters
        </h3>
      </div>

      {props.isLoading && Object.keys(props.facetData).length === 0 && (
        <div className="flex flex-1 items-center justify-center py-8">
          <ComponentLoader />
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {props.savedViews && props.savedViews.length > 0 && (
          <div className="border-b border-gray-100 px-3 py-3">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-gray-400">
              Saved Views
            </p>

            <div className="space-y-1.5">
              {props.savedViews.map((view: LogsSavedViewOption) => {
                const isSelected: boolean =
                  view.id === props.selectedSavedViewId;

                return (
                  <button
                    key={view.id}
                    type="button"
                    className={`flex w-full items-center justify-between rounded-md px-2.5 py-2 text-left text-sm transition-colors ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-700"
                        : "text-gray-600 hover:bg-gray-50 hover:text-gray-800"
                    }`}
                    onClick={() => {
                      props.onSavedViewSelect?.(view.id);
                    }}
                  >
                    <span className="truncate">{view.name}</span>
                    {view.isDefault && (
                      <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                        Default
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {facetKeys.map((key: string) => {
          const values: Array<FacetValue> = props.facetData[key] || [];

          let valueDisplayMap: Record<string, string> | undefined;
          let valueColorMap: Record<string, string> | undefined;

          if (key === "primaryEntityId") {
            valueDisplayMap = serviceDisplayMap;
            valueColorMap = serviceColorMap;
          } else if (key === "hostId") {
            valueDisplayMap = hostDisplayMap;
          } else if (key === "dockerHostId") {
            valueDisplayMap = dockerHostDisplayMap;
          } else if (key === "kubernetesClusterId") {
            valueDisplayMap = clusterDisplayMap;
          } else if (key === "severityText") {
            valueColorMap = severityColorMap;
          }

          const onSearchChange: ((text: string) => void) | undefined =
            RESOURCE_FACET_KEYS.has(key) && props.onFacetSearchChange
              ? (text: string) => {
                  props.onFacetSearchChange!(key, text);
                }
              : undefined;

          return (
            <FacetSection
              key={key}
              facetKey={key}
              title={getFacetTitle(key)}
              values={values}
              onIncludeValue={props.onIncludeFilter}
              onExcludeValue={props.onExcludeFilter}
              valueDisplayMap={valueDisplayMap}
              valueColorMap={valueColorMap}
              activeValues={activeValuesByKey[key]}
              onSearchChange={onSearchChange}
            />
          );
        })}
      </div>
    </div>
  );
};

export default LogsFacetSidebar;
