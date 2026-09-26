import PageComponentProps from "../PageComponentProps";
import ServiceMapGraph from "../../Components/Topology/ServiceMapGraph";
import InfrastructureExplorer from "../../Components/Topology/InfrastructureExplorer";
import useTopologyData, {
  TopologyData,
  TopologyLoadError,
  TopologyTabState,
  TopologyTabStatus,
  TopologyView,
} from "../../Components/Topology/UseTopologyData";
import {
  InfrastructureData,
  ServiceMapData,
  TopologyTruncation,
} from "../../Components/Topology/TopologyData";
import NetworkTopologyExplorer from "../../Components/Topology/NetworkTopologyExplorer";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import CompactLoader from "Common/UI/Components/ComponentLoader/CompactLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import useTranslateValue from "Common/UI/Utils/Translation";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement, useState } from "react";

/*
 * Service Map and Infrastructure each load their own view-shaped payload
 * from the Topology API (see UseTopologyData), computed over the whole
 * inventory, the first time the tab is opened. Both are pinned to the same
 * range start and draw only what reported inside the range (see
 * TopologyActivity) unless "Show inactive" is on — Inventory keeps a silent
 * resource for weeks, a map of what is running should not. Network discovery
 * uses its own live data source.
 */

/*
 * Must match WINDOW_MINUTES in the ComputeServiceDependencies worker cron —
 * the span window its per-edge callCount/errorCount aggregates cover.
 */
const METRICS_WINDOW_SECONDS: number = 15 * 60;

/*
 * The Network tab is a live LLDP view (also surfaced under Network
 * Devices) — the telemetry time range does not apply to it, so the picker
 * hides while it is active.
 */
const TAB_NAMES: Array<TopologyView> = [
  "Service Map",
  "Infrastructure",
  "Network",
];

type TelemetryView = Exclude<TopologyView, "Network">;

const LOADING_LABELS: Record<TelemetryView, string> = {
  "Service Map": "Loading service map…",
  Infrastructure: "Loading infrastructure…",
};

function readInitialTab(): TopologyView {
  const fromUrl: string | null = Navigation.getQueryStringByName("tab");
  return (
    TAB_NAMES.find((name: TopologyView): boolean => {
      return name === fromUrl;
    }) || "Service Map"
  );
}

const TopologyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { translateString } = useTranslateValue();

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_DAY,
  });

  const [includeInactive, setIncludeInactive] = useState<boolean>(
    Navigation.getQueryStringByName("inactive") === "show",
  );
  /*
   * Cross-links between the two telemetry views write the target's focus into
   * the URL and remount the view, so it opens exactly where a shared link
   * would.
   */
  const [viewGeneration, setViewGeneration] = useState<number>(0);

  const [activeTabName, setActiveTabName] =
    useState<TopologyView>(readInitialTab);
  const isNetworkTab: boolean = activeTabName === "Network";

  const topology: TopologyData = useTopologyData(timeRange, activeTabName);
  const activeTab:
    | TopologyTabState<ServiceMapData>
    | TopologyTabState<InfrastructureData>
    | null =
    activeTabName === "Service Map"
      ? topology.serviceMap
      : activeTabName === "Infrastructure"
        ? topology.infrastructure
        : null;
  const isActiveTabLoading: boolean =
    activeTab !== null &&
    (activeTab.status === "idle" || activeTab.status === "loading");
  /*
   * The safety caps the payload on screen hit (never in practice). Either
   * map can hit two at once: its resources and its connections.
   */
  let activeTruncations: Array<TopologyTruncation> = [];
  if (
    activeTabName === "Service Map" &&
    topology.serviceMap.status === "ready"
  ) {
    activeTruncations = topology.serviceMap.data?.truncations || [];
  } else if (
    activeTabName === "Infrastructure" &&
    topology.infrastructure.status === "ready" &&
    topology.infrastructure.data
  ) {
    const infrastructure: InfrastructureData = topology.infrastructure.data;
    for (const truncation of [
      infrastructure.truncation,
      infrastructure.dependencyTruncation,
    ]) {
      if (truncation) {
        activeTruncations.push(truncation);
      }
    }
  }

  /*
   * Loading/error live INSIDE each telemetry tab: the tabs load
   * independently, and the Network tab has its own data source and must
   * stay reachable when a telemetry fetch fails.
   */
  const renderUnreadyTab: (
    view: TelemetryView,
    status: TopologyTabStatus,
    error: TopologyLoadError | null,
  ) => ReactElement = (
    view: TelemetryView,
    status: TopologyTabStatus,
    error: TopologyLoadError | null,
  ): ReactElement => {
    if (status === "error" && error) {
      return (
        <div
          role="alert"
          className="rounded-xl border border-gray-200 bg-white p-6"
        >
          <ErrorMessage message={error.message} />
          {error.isOutdated ? (
            <button
              type="button"
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              onClick={() => {
                Navigation.reload();
              }}
            >
              {translateString("Reload page") || "Reload page"}
            </button>
          ) : (
            <button
              type="button"
              className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
              onClick={() => {
                topology.retry(view);
              }}
            >
              {translateString("Try again") || "Try again"}
            </button>
          )}
        </div>
      );
    }
    return (
      <div
        role="status"
        aria-live="polite"
        className="my-16 flex flex-col items-center"
      >
        <CompactLoader />
        <p className="text-sm text-gray-500">
          {translateString(LOADING_LABELS[view]) || LOADING_LABELS[view]}
        </p>
      </div>
    );
  };

  const openInfrastructure: (resourceKey: string) => void = (
    resourceKey: string,
  ): void => {
    Navigation.setQueryString({
      tab: "Infrastructure",
      infraFocus: resourceKey,
      infraSearch: null,
    });
    setViewGeneration((value: number): number => {
      return value + 1;
    });
    setActiveTabName("Infrastructure");
  };
  const openServiceMap: (serviceKey: string) => void = (
    serviceKey: string,
  ): void => {
    Navigation.setQueryString({
      tab: null,
      focus: serviceKey,
      search: null,
      serviceView: "map",
    });
    setViewGeneration((value: number): number => {
      return value + 1;
    });
    setActiveTabName("Service Map");
  };

  /*
   * Views judge activity against `data.rangeStart` — the range start the
   * server echoed — so a resource counts as active on exactly the same terms
   * in the browser as in the server's own counts.
   */
  const renderPanel: () => ReactElement = (): ReactElement => {
    if (activeTabName === "Network") {
      return <NetworkTopologyExplorer />;
    }
    if (activeTabName === "Service Map") {
      const tab: TopologyTabState<ServiceMapData> = topology.serviceMap;
      if (tab.status !== "ready" || !tab.data) {
        return renderUnreadyTab("Service Map", tab.status, tab.error);
      }
      return (
        <ServiceMapGraph
          key={`service-map-${viewGeneration}`}
          entities={tab.data.entities}
          relationships={tab.data.relationships}
          runsOnCounts={tab.data.runsOnCounts}
          metricsWindowSeconds={METRICS_WINDOW_SECONDS}
          timeRange={timeRange}
          rangeStart={tab.data.rangeStart}
          includeInactive={includeInactive}
          onOpenInfrastructure={openInfrastructure}
        />
      );
    }
    const tab: TopologyTabState<InfrastructureData> = topology.infrastructure;
    if (tab.status !== "ready" || !tab.data) {
      return renderUnreadyTab("Infrastructure", tab.status, tab.error);
    }
    return (
      <InfrastructureExplorer
        key={`infrastructure-${viewGeneration}`}
        entities={tab.data.entities}
        relationships={tab.data.relationships}
        collections={tab.data.collections}
        totals={tab.data.totals}
        truncation={tab.data.truncation}
        metricsWindowSeconds={METRICS_WINDOW_SECONDS}
        timeRange={timeRange}
        rangeStart={tab.data.rangeStart}
        includeInactive={includeInactive}
        onOpenServiceMap={openServiceMap}
      />
    );
  };

  const viewDescriptions: Record<
    TopologyView,
    { icon: IconProp; description: string }
  > = {
    "Service Map": {
      icon: IconProp.FlowDiagram,
      description: "Which services depend on each other?",
    },
    Infrastructure: {
      icon: IconProp.Layers,
      description: "What runs where in your infrastructure?",
    },
    Network: {
      icon: IconProp.ServerStack,
      description: "How are your network devices connected?",
    },
  };
  const selectTab: (name: TopologyView) => void = (
    name: TopologyView,
  ): void => {
    setActiveTabName(name);
    Navigation.setQueryString({ tab: name === "Service Map" ? null : name });
  };
  const handleTabKey: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    index: number,
  ): void => {
    let nextIndex: number = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % TAB_NAMES.length;
    } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index + TAB_NAMES.length - 1) % TAB_NAMES.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = TAB_NAMES.length - 1;
    } else {
      return;
    }
    event.preventDefault();
    selectTab(TAB_NAMES[nextIndex]!);
    document.getElementById(`topology-view-${nextIndex}`)?.focus();
  };

  return (
    <div className="space-y-5">
      <nav
        role="tablist"
        aria-label={translateString("Topology views") || "Topology views"}
        className="grid gap-3 sm:grid-cols-3"
      >
        {TAB_NAMES.map((tabName: TopologyView, index: number): ReactElement => {
          const selected: boolean = activeTabName === tabName;
          const info: { icon: IconProp; description: string } =
            viewDescriptions[tabName];
          return (
            <button
              type="button"
              key={tabName}
              id={`topology-view-${index}`}
              role="tab"
              aria-label={translateString(tabName) || tabName}
              aria-selected={selected}
              aria-controls="topology-view-panel"
              tabIndex={selected ? 0 : -1}
              onClick={() => {
                selectTab(tabName);
              }}
              onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>) => {
                handleTabKey(event, index);
              }}
              className={`flex items-start gap-3 rounded-xl border p-4 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2 ${selected ? "border-indigo-300 bg-indigo-50 shadow-sm" : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"}`}
            >
              <span
                className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg ${selected ? "bg-indigo-600 text-white" : "bg-gray-100 text-gray-500"}`}
              >
                <Icon icon={info.icon} className="h-5 w-5" />
              </span>
              <span className="min-w-0">
                <span
                  className={`block text-sm font-semibold ${selected ? "text-indigo-900" : "text-gray-800"}`}
                >
                  {translateString(tabName)}
                </span>
                <span
                  aria-hidden={true}
                  className={`mt-1 block text-xs leading-5 ${selected ? "text-indigo-600" : "text-gray-500"}`}
                >
                  {translateString(info.description)}
                </span>
              </span>
            </button>
          );
        })}
      </nav>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="text-xs text-gray-500">
          {isNetworkTab ? (
            <span className="inline-flex items-center gap-2">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              {translateString(
                "The network map is live. Device connections refresh automatically.",
              )}
            </span>
          ) : (
            <details className="relative">
              <summary className="cursor-pointer rounded text-gray-500 hover:text-gray-800 focus:ring-2 focus:ring-indigo-500">
                {translateString("What is shown · About this data")}
              </summary>
              <p className="mt-2 max-w-xl leading-5">
                {translateString(
                  "Resources and services that reported in the selected range, and the connections observed in it. Calls between services are discovered from traces and eBPF every 10 minutes; traffic figures show the latest 15-minute window, not totals for the range.",
                )}
              </p>
            </details>
          )}
        </div>
        {!isNetworkTab && (
          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex cursor-pointer items-center gap-2 text-xs text-gray-600">
              <input
                type="checkbox"
                data-testid="topology-show-inactive"
                className="h-4 w-4 rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
                checked={includeInactive}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setIncludeInactive(event.target.checked);
                  Navigation.setQueryString({
                    inactive: event.target.checked ? "show" : null,
                  });
                }}
              />
              {translateString("Show inactive")}
            </label>
            <span className="text-xs text-gray-500">
              {translateString("Active in")}
            </span>
            <TelemetryTimeRangePicker
              value={timeRange}
              onChange={setTimeRange}
            />
            <button
              type="button"
              aria-label={
                translateString("Refresh topology") || "Refresh topology"
              }
              title={
                activeTab?.loadedAt
                  ? `${translateString("Last refreshed")}: ${activeTab.loadedAt.toLocaleTimeString()}`
                  : undefined
              }
              disabled={isActiveTabLoading}
              className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40"
              onClick={topology.reload}
            >
              <Icon icon={IconProp.Refresh} className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
      {activeTruncations.length > 0 && (
        <div
          role="status"
          data-testid="topology-truncation"
          className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
        >
          {activeTruncations.map(
            (truncation: TopologyTruncation): ReactElement => {
              const isConnections: boolean = truncation.kind === "connections";
              return (
                <React.Fragment
                  key={isConnections ? "connections" : "resources"}
                >
                  <span className="font-semibold">
                    {`${truncation.shown.toLocaleString()} ${translateString("of")} ${truncation.total.toLocaleString()} ${
                      isConnections
                        ? translateString("connections shown.")
                        : translateString("resources shown.")
                    }`}
                  </span>{" "}
                </React.Fragment>
              );
            },
          )}
          {/*
           * Infrastructure's summary switches to the server's exact totals
           * when capped; the Service Map's counts come from what was shipped.
           */}
          {activeTabName === "Infrastructure"
            ? translateString(
                "Counts are exact; the map and search cover the resources shown.",
              )
            : translateString(
                "The map, counts and search cover what is shown.",
              )}
        </div>
      )}
      <div
        id="topology-view-panel"
        role="tabpanel"
        aria-labelledby={`topology-view-${TAB_NAMES.indexOf(activeTabName)}`}
      >
        {renderPanel()}
      </div>
    </div>
  );
};

export default TopologyPage;
