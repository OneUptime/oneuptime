import PageComponentProps from "../PageComponentProps";
import ServiceMapGraph from "../../Components/Topology/ServiceMapGraph";
import InfrastructureGraph from "../../Components/Topology/InfrastructureGraph";
import { buildTopologyInventoryItemQuery } from "../../Components/Topology/TopologyInventoryData";
import NetworkTopologyExplorer from "../../Components/Topology/NetworkTopologyExplorer";
import Page from "Common/UI/Components/Page/Page";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import TelemetryTimeRangePicker from "Common/UI/Components/TelemetryViewer/components/TelemetryTimeRangePicker";
import RangeStartAndEndDateTime, {
  RangeStartAndEndDateTimeUtil,
} from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import GreaterThanOrEqual from "Common/Types/BaseDatabase/GreaterThanOrEqual";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import InventoryItem from "Common/Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "Common/Models/DatabaseModels/InventoryItemRelationship";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

/*
 * Topology hub: two purpose-built maps over the entity registry instead of
 * one mixed graph. "Service Map" is the layer-7 call graph (services +
 * depends-on edges with traffic metrics); "Infrastructure" is the
 * containment graph (pods on nodes, containers on hosts, ...). Entities
 * Inventory items load from the complete, non-archived catalog. Relationships
 * load for the selected time range and both tabs share the results.
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

  const [entities, setEntities] = useState<Array<InventoryItem>>([]);
  const [relationships, setRelationships] = useState<
    Array<InventoryItemRelationship>
  >([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [isTruncated, setIsTruncated] = useState<boolean>(false);

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      setIsLoading(true);
      setError("");
      try {
        const window: InBetween<Date> =
          RangeStartAndEndDateTimeUtil.getStartAndEndDate(timeRange);

        const [entityResult, relationshipResult]: [
          ListResult<InventoryItem>,
          ListResult<InventoryItemRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<InventoryItem>({
            modelType: InventoryItem,
            query: buildTopologyInventoryItemQuery(
              ProjectUtil.getCurrentProjectId()!,
            ),
            select: {
              _id: true,
              entityKey: true,
              displayName: true,
              entityType: true,
              resourceType: true,
              resourceId: true,
              firstSeenAt: true,
              lastSeenAt: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
          ModelAPI.getList<InventoryItemRelationship>({
            modelType: InventoryItemRelationship,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              lastSeenAt: new GreaterThanOrEqual<Date>(window.startValue),
            },
            select: {
              fromEntityKey: true,
              toEntityKey: true,
              relationshipType: true,
              callCount: true,
              errorCount: true,
              avgDurationMs: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
        ]);

        setEntities(entityResult.data);
        setRelationships(relationshipResult.data);
        setIsTruncated(
          entityResult.count > entityResult.data.length ||
            relationshipResult.count > relationshipResult.data.length,
        );
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setIsLoading(false);
      }
    };
    void load();
  }, [timeRange]);

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
      return <ErrorMessage message={error} />;
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
          <InfrastructureGraph
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
  }, [entities, relationships, timeRange, isLoading, error]);

  return (
    <Page title="Topology" breadcrumbLinks={[]}>
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <p className="text-sm text-gray-500">
          {isNetworkTab
            ? translateString(
                "The network map is live. Start at the sites you model your network in and drill down — the last level opens the devices as they report themselves right now.",
              ) || ""
            : translateString(
                "The map includes every current inventory item. Connections reflect OpenTelemetry data from the selected time range.",
              ) || ""}
        </p>
        {isNetworkTab ? (
          <></>
        ) : (
          <TelemetryTimeRangePicker value={timeRange} onChange={setTimeRange} />
        )}
      </div>

      {isTruncated && !isNetworkTab && !isLoading && !error ? (
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          {translateString(
            "This map is very large, so only part of it is shown. Use search, filters or the focus mode to narrow it down.",
          ) || ""}
        </div>
      ) : (
        <></>
      )}

      <Tabs
        tabs={tabs}
        initialTabName={initialTabName}
        onTabChange={(tab: Tab) => {
          setActiveTabName(tab.name);
          // Keep the view shareable; default tab keeps the URL clean.
          Navigation.setQueryString({
            tab: tab.name === "Service Map" ? null : tab.name,
          });
        }}
      />
    </Page>
  );
};

export default TopologyPage;
