import React, {
  FunctionComponent,
  ReactElement,
  useId,
  useMemo,
  useState,
} from "react";
import {
  FacetData,
  FacetValue,
  ActiveFilter,
  LogsSavedViewOption,
} from "../types";
import FacetSection from "./FacetSection";
import SavedViewsFacetSection from "../../SavedViews/SavedViewsFacetSection";
import Service from "../../../../Models/DatabaseModels/Service";
import Host from "../../../../Models/DatabaseModels/Host";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import Dictionary from "../../../../Types/Dictionary";
import ComponentLoader from "../../ComponentLoader/ComponentLoader";
import { getSeverityColor } from "./severityColors";
import LogSeverity from "../../../../Types/Log/LogSeverity";
import { TelemetryEntityNameMap } from "../../../Utils/Telemetry/TelemetryEntityNames";
import { mergeFacetValueDisplayMap } from "../LogsEntityNames";
import IconProp from "../../../../Types/Icon/IconProp";
import {
  RESOURCE_FACET_CATALOG_KEYS,
  ResourceFacetDefinition,
  getResourceFacetDefinition,
  isCatalogResourceFacetKey,
} from "../../../../Types/Telemetry/ResourceFacetCatalog";
import HiddenFacetsFooter from "../../TelemetryViewer/components/HiddenFacetsFooter";
import {
  FacetVisibility,
  computeFacetVisibility,
  getSidebarFacetEmptyStateText,
} from "../../TelemetryViewer/FacetVisibility";
import useFacetSearchExemptions, {
  FacetSearchExemptions,
} from "../../TelemetryViewer/useFacetSearchExemptions";

export interface LogsFacetSidebarProps {
  facetData: FacetData;
  isLoading: boolean;
  serviceMap: Dictionary<Service>;
  hostMap?: Dictionary<Host>;
  dockerHostMap?: Dictionary<DockerHost>;
  podmanHostMap?: Dictionary<PodmanHost>;
  kubernetesClusterMap?: Dictionary<KubernetesCluster>;
  /*
   * Generic resolver names for resource facet values the maps above do not
   * hold (e.g. a RUM application id under "Service"). Used only when the
   * server sent no displayName and no preloaded map names the value.
   */
  entityNameMap?: TelemetryEntityNameMap | undefined;
  onIncludeFilter: (facetKey: string, value: string) => void;
  onExcludeFilter: (facetKey: string, value: string) => void;
  activeFilters?: Array<ActiveFilter> | undefined;
  savedViews?: Array<LogsSavedViewOption> | undefined;
  selectedSavedViewId?: string | null | undefined;
  onSavedViewSelect?: ((viewId: string) => void) | undefined;
  // Toggling the applied view off here has to clear it, not re-apply it.
  onClearSavedView?: (() => void) | undefined;
  /*
   * Called (debounced) when typing in a resource facet's search box. Lets
   * the parent re-issue the facets request with the typed text scoped to
   * that facet, so the result includes resources beyond the loaded subset.
   */
  onFacetSearchChange?:
    | ((facetKey: string, searchText: string) => void)
    | undefined;
  // Lets a disclosure toggle point at the panel with aria-controls.
  id?: string | undefined;
  /*
   * Below md the sidebar stacks above the list at full width rather than
   * sitting beside it. When true it is also folded away there, until the
   * caller's toggle opens it. From md up it always shows. The fold is CSS
   * only, so the sidebar stays mounted and keeps its search and expand state.
   */
  isCollapsedOnSmallScreens?: boolean | undefined;
}

/*
 * Facets whose search box also asks the server: the Service facet and every
 * resource type in the catalog, all resolved against Postgres.
 */
function isServerSearchableFacetKey(key: string): boolean {
  return key === "primaryEntityId" || isCatalogResourceFacetKey(key);
}

/*
 * Only resource facets fold away while empty — an empty list there means the
 * project has no resource of that type. Service and severity always show.
 */
function isHideableFacetKey(key: string): boolean {
  return isCatalogResourceFacetKey(key);
}

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

function buildPodmanHostDisplayMap(
  podmanHostMap: Dictionary<PodmanHost> | undefined,
): Record<string, string> {
  const map: Record<string, string> = {};
  if (!podmanHostMap) {
    return map;
  }
  for (const [id, podmanHost] of Object.entries(podmanHostMap)) {
    const label: string | undefined =
      podmanHost?.name || podmanHost?.hostIdentifier;
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
  const resourceDefinition: ResourceFacetDefinition | undefined =
    getResourceFacetDefinition(key);

  if (resourceDefinition) {
    return resourceDefinition.label;
  }

  const titleMap: Record<string, string> = {
    severityText: "Severity",
    primaryEntityId: "Service",
    traceId: "Trace ID",
    spanId: "Span ID",
  };

  return titleMap[key] || key;
}

function getFacetIcon(key: string): IconProp | undefined {
  if (key === "primaryEntityId" || key === "serviceId") {
    return IconProp.SquareStack;
  }

  return getResourceFacetDefinition(key)?.icon;
}

// Severity, then Service, then resources in catalog order.
const PRIORITY_FACET_KEYS: ReadonlyArray<string> = [
  "severityText",
  "primaryEntityId",
  ...RESOURCE_FACET_CATALOG_KEYS,
];

const LogsFacetSidebar: FunctionComponent<LogsFacetSidebarProps> = (
  props: LogsFacetSidebarProps,
): ReactElement => {
  const severityColorMap: Record<string, string> = useMemo(() => {
    return buildSeverityColorMap();
  }, []);

  const serviceDisplayMap: Record<string, string> = useMemo(() => {
    return mergeFacetValueDisplayMap(
      buildServiceDisplayMap(props.serviceMap),
      props.entityNameMap,
    );
  }, [props.serviceMap, props.entityNameMap]);

  const serviceColorMap: Record<string, string> = useMemo(() => {
    return buildServiceColorMap(props.serviceMap);
  }, [props.serviceMap]);

  const hostDisplayMap: Record<string, string> = useMemo(() => {
    return mergeFacetValueDisplayMap(
      buildHostDisplayMap(props.hostMap),
      props.entityNameMap,
    );
  }, [props.hostMap, props.entityNameMap]);

  const dockerHostDisplayMap: Record<string, string> = useMemo(() => {
    return mergeFacetValueDisplayMap(
      buildDockerHostDisplayMap(props.dockerHostMap),
      props.entityNameMap,
    );
  }, [props.dockerHostMap, props.entityNameMap]);

  const podmanHostDisplayMap: Record<string, string> = useMemo(() => {
    return mergeFacetValueDisplayMap(
      buildPodmanHostDisplayMap(props.podmanHostMap),
      props.entityNameMap,
    );
  }, [props.podmanHostMap, props.entityNameMap]);

  const clusterDisplayMap: Record<string, string> = useMemo(() => {
    return mergeFacetValueDisplayMap(
      buildClusterDisplayMap(props.kubernetesClusterMap),
      props.entityNameMap,
    );
  }, [props.kubernetesClusterMap, props.entityNameMap]);

  /*
   * Resource types the viewer preloads no map for (Proxmox, vCenter, Ceph,
   * ...) still get the resolver's names underneath the server displayName.
   */
  const entityNameDisplayMap: Record<string, string> = useMemo(() => {
    return mergeFacetValueDisplayMap({}, props.entityNameMap);
  }, [props.entityNameMap]);

  const facetKeys: Array<string> = useMemo(() => {
    const otherKeys: Array<string> = Object.keys(props.facetData).filter(
      (key: string) => {
        return !PRIORITY_FACET_KEYS.includes(key);
      },
    );
    return [
      ...PRIORITY_FACET_KEYS.filter((key: string) => {
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

  const [showHidden, setShowHidden] = useState<boolean>(false);
  const facetListId: string = useId();

  const facetSearch: FacetSearchExemptions = useFacetSearchExemptions({
    facetData: props.facetData,
    onFacetSearchChange: props.onFacetSearchChange,
  });

  const visibility: FacetVisibility = useMemo(() => {
    return computeFacetVisibility({
      keys: facetKeys,
      facetData: props.facetData,
      isHideable: isHideableFacetKey,
      activeValuesByKey: activeValuesByKey,
      searchExemptKeys: facetSearch.searchExemptKeys,
      showHidden: showHidden,
      getTitle: getFacetTitle,
    });
  }, [
    facetKeys,
    props.facetData,
    activeValuesByKey,
    facetSearch.searchExemptKeys,
    showHidden,
  ]);

  return (
    <div
      id={props.id}
      className={`${
        props.isCollapsedOnSmallScreens ? "hidden md:flex" : "flex"
      } max-h-80 w-full flex-none flex-col overflow-y-auto rounded-lg border border-gray-200 bg-white md:h-full md:max-h-none md:w-56`}
    >
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

      <div id={facetListId} className="flex-1 overflow-y-auto">
        {props.savedViews && props.savedViews.length > 0 && (
          <SavedViewsFacetSection
            savedViews={props.savedViews}
            selectedSavedViewId={props.selectedSavedViewId}
            onSelect={props.onSavedViewSelect}
            onClear={props.onClearSavedView}
          />
        )}

        {visibility.visibleKeys.map((key: string) => {
          const values: Array<FacetValue> = props.facetData[key] || [];

          let valueDisplayMap: Record<string, string> | undefined;
          let valueColorMap: Record<string, string> | undefined;

          if (key === "primaryEntityId" || key === "serviceId") {
            valueDisplayMap = serviceDisplayMap;
            valueColorMap = serviceColorMap;
          } else if (key === "hostId") {
            valueDisplayMap = hostDisplayMap;
          } else if (key === "dockerHostId") {
            valueDisplayMap = dockerHostDisplayMap;
          } else if (key === "podmanHostId") {
            valueDisplayMap = podmanHostDisplayMap;
          } else if (key === "kubernetesClusterId") {
            valueDisplayMap = clusterDisplayMap;
          } else if (key === "severityText") {
            valueColorMap = severityColorMap;
          } else if (isCatalogResourceFacetKey(key)) {
            valueDisplayMap = entityNameDisplayMap;
          }

          const onSearchChange: ((text: string) => void) | undefined =
            isServerSearchableFacetKey(key)
              ? facetSearch.getSearchChangeHandler(key)
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
              icon={getFacetIcon(key)}
              searchText={facetSearch.searchTextByKey[key] ?? ""}
              onSearchTextChange={(text: string) => {
                facetSearch.setSearchText(key, text);
              }}
              emptyStateText={getSidebarFacetEmptyStateText({
                isHideable: isHideableFacetKey(key),
                emptyStateNoun: getResourceFacetDefinition(key)?.pluralLabel,
                searchedAtArrivalText: facetSearch.searchedAtArrivalByKey[key],
              })}
            />
          );
        })}

        <HiddenFacetsFooter
          hiddenCount={visibility.hiddenCount}
          hiddenTitles={visibility.hiddenTitles}
          isShowingHidden={showHidden}
          controlsId={facetListId}
          onToggle={() => {
            setShowHidden(!showHidden);
          }}
        />
      </div>
    </div>
  );
};

export default LogsFacetSidebar;
