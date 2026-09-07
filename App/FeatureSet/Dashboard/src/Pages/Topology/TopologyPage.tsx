import PageComponentProps from "../PageComponentProps";
import ServiceMapGraph from "../../Components/Topology/ServiceMapGraph";
import InfrastructureExplorer from "../../Components/Topology/InfrastructureExplorer";
import useTopologyData from "../../Components/Topology/UseTopologyData";
import NetworkTopologyExplorer from "../../Components/Topology/NetworkTopologyExplorer";
import Page from "Common/UI/Components/Page/Page";
import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import useTranslateValue from "Common/UI/Utils/Translation";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useMemo,
  useState,
} from "react";

/*
 * Service Map and Infrastructure share the current, non-archived inventory
 * and connections last observed since the selected range's start. Service
 * Map presents service dependencies and traffic; Infrastructure presents
 * resource containment. Network discovery uses its own live data source.
 */

/*
 * Must match WINDOW_MINUTES in the ComputeServiceDependencies worker cron —
 * the span window its per-edge callCount/errorCount aggregates cover.
 */
const METRICS_WINDOW_SECONDS: number = 15 * 60;

const TopologyPage: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { translateString } = useTranslateValue();

  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>({
    range: TimeRange.PAST_ONE_DAY,
  });

  const {
    entities,
    relationships,
    isLoading,
    error,
    isTruncated,
    reload,
    lastUpdatedAt,
  } = useTopologyData(timeRange);

  /*
   * The Network tab is a live LLDP view (also surfaced under Network
   * Devices) — the telemetry time range does not apply to it, so the
   * picker hides while it is active.
   */
  const TAB_NAMES: Array<string> = ["Service Map", "Infrastructure", "Network"];
  const initialTabName: string = (() => {
    const fromUrl: string | null = Navigation.getQueryStringByName("tab");
    return fromUrl && TAB_NAMES.includes(fromUrl) ? fromUrl : "Service Map";
  })();
  const [activeTabName, setActiveTabName] = useState<string>(initialTabName);
  const isNetworkTab: boolean = activeTabName === "Network";

  /*
   * Loading/error live INSIDE the telemetry tabs: the Network tab has an
   * independent data source and must stay reachable when the telemetry
   * entity fetch fails.
   */
  const wrapTelemetryTab: (graph: ReactElement) => ReactElement = (
    graph: ReactElement,
  ): ReactElement => {
    if (isLoading) {
      return <ComponentLoader />;
    }
    if (error) {
      return (
        <div className="rounded-xl border border-gray-200 bg-white p-6">
          <ErrorMessage message={error} />
          <button
            type="button"
            className="mt-4 rounded-lg bg-indigo-600 px-4 py-2 text-sm font-medium text-white hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-500 focus:ring-offset-2"
            onClick={reload}
          >
            {translateString("Try again") || "Try again"}
          </button>
        </div>
      );
    }
    return graph;
  };

  const tabs: Array<Tab> = useMemo(() => {
    return [
      {
        name: "Service Map",
        children: wrapTelemetryTab(
          <ServiceMapGraph
            entities={entities}
            relationships={relationships}
            metricsWindowSeconds={METRICS_WINDOW_SECONDS}
            timeRange={timeRange}
          />,
        ),
      },
      {
        name: "Infrastructure",
        children: wrapTelemetryTab(
          <InfrastructureExplorer
            entities={entities}
            relationships={relationships}
            metricsWindowSeconds={METRICS_WINDOW_SECONDS}
          />,
        ),
      },
      {
        name: "Network",
        children: <NetworkTopologyExplorer />,
      },
    ];
  }, [entities, relationships, timeRange, isLoading, error, reload]);

  const viewDescriptions: Record<
    string,
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
  const selectTab: (name: string) => void = (name: string): void => {
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
    <Page
      title="Topology"
      description="Understand how your services, infrastructure, and network connect."
      breadcrumbLinks={[]}
    >
      <div className="space-y-5">
        <nav
          role="tablist"
          aria-label={translateString("Topology views") || "Topology views"}
          className="grid gap-3 sm:grid-cols-3"
        >
          {tabs.map((tab: Tab, index: number): ReactElement => {
            const selected: boolean = activeTabName === tab.name;
            const info: { icon: IconProp; description: string } =
              viewDescriptions[tab.name]!;
            return (
              <button
                type="button"
                key={tab.name}
                id={`topology-view-${index}`}
                role="tab"
                aria-label={translateString(tab.name) || tab.name}
                aria-selected={selected}
                aria-controls="topology-view-panel"
                tabIndex={selected ? 0 : -1}
                onClick={() => {
                  selectTab(tab.name);
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
                    {translateString(tab.name)}
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
                  {translateString("Current inventory · About this data")}
                </summary>
                <p className="mt-2 max-w-xl leading-5">
                  {translateString(
                    "All current inventory resources are included. Connections are those last observed since the start of the selected range. Traffic metrics show the latest 15-minute sample, not totals for the selected range.",
                  )}
                </p>
              </details>
            )}
          </div>
          {!isNetworkTab && (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-xs text-gray-500">
                {translateString("Connection activity")}
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
                  lastUpdatedAt
                    ? `${translateString("Last refreshed")}: ${lastUpdatedAt.toLocaleTimeString()}`
                    : undefined
                }
                disabled={isLoading}
                className="rounded-lg border border-gray-200 bg-white p-2 text-gray-500 hover:bg-gray-50 focus:outline-none focus:ring-2 focus:ring-indigo-500 disabled:opacity-40"
                onClick={reload}
              >
                <Icon icon={IconProp.Refresh} className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
        {isTruncated && !isNetworkTab && !isLoading && !error && (
          <div
            role="status"
            className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800"
          >
            <span className="font-semibold">
              {translateString("Partial inventory loaded.")}
            </span>{" "}
            {translateString(
              "This project exceeds the map loading limit. Counts, search results, and connections cover the loaded resources only.",
            )}
          </div>
        )}
        <div
          id="topology-view-panel"
          role="tabpanel"
          aria-labelledby={`topology-view-${TAB_NAMES.indexOf(activeTabName)}`}
        >
          {
            tabs.find((tab: Tab): boolean => {
              return tab.name === activeTabName;
            })?.children
          }
        </div>
      </div>
    </Page>
  );
};

export default TopologyPage;
