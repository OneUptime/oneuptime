import PageComponentProps from "../PageComponentProps";
import ServiceMapGraph from "../../Components/Topology/ServiceMapGraph";
import InfrastructureGraph from "../../Components/Topology/InfrastructureGraph";
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
import TelemetryEntity from "Common/Models/DatabaseModels/TelemetryEntity";
import TelemetryEntityRelationship from "Common/Models/DatabaseModels/TelemetryEntityRelationship";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import API from "Common/UI/Utils/API/API";
import useTranslateValue from "Common/UI/Utils/Translation";
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
 * and relationships load once here for the selected time range and both
 * tabs share them.
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

  const [entities, setEntities] = useState<Array<TelemetryEntity>>([]);
  const [relationships, setRelationships] = useState<
    Array<TelemetryEntityRelationship>
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
          ListResult<TelemetryEntity>,
          ListResult<TelemetryEntityRelationship>,
        ] = await Promise.all([
          ModelAPI.getList<TelemetryEntity>({
            modelType: TelemetryEntity,
            query: {
              projectId: ProjectUtil.getCurrentProjectId()!,
              lastSeenAt: new GreaterThanOrEqual<Date>(window.startValue),
            },
            select: {
              _id: true,
              entityKey: true,
              displayName: true,
              entityType: true,
              firstSeenAt: true,
              lastSeenAt: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          }),
          ModelAPI.getList<TelemetryEntityRelationship>({
            modelType: TelemetryEntityRelationship,
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

  const tabs: Array<Tab> = useMemo(() => {
    return [
      {
        name: "Service Map",
        children: (
          <ServiceMapGraph
            entities={entities}
            relationships={relationships}
            metricsWindowSeconds={METRICS_WINDOW_SECONDS}
          />
        ),
      },
      {
        name: "Infrastructure",
        children: (
          <InfrastructureGraph
            entities={entities}
            relationships={relationships}
            metricsWindowSeconds={METRICS_WINDOW_SECONDS}
          />
        ),
      },
    ];
  }, [entities, relationships]);

  return (
    <Page title="Topology" breadcrumbLinks={[]}>
      <div className="mb-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <p className="text-sm text-gray-500">
          {translateString(
            "Maps are discovered automatically from your OpenTelemetry data for the selected time range.",
          ) || ""}
        </p>
        <TelemetryTimeRangePicker value={timeRange} onChange={setTimeRange} />
      </div>

      {isTruncated ? (
        <div className="mb-3 rounded-md bg-amber-50 border border-amber-200 px-4 py-2 text-sm text-amber-800">
          {translateString(
            "This map is very large, so only part of it is shown. Use search, filters or the focus mode to narrow it down.",
          ) || ""}
        </div>
      ) : (
        <></>
      )}

      {isLoading ? (
        <ComponentLoader />
      ) : error ? (
        <ErrorMessage message={error} />
      ) : (
        <Tabs
          tabs={tabs}
          onTabChange={() => {
            // Selection is managed by the Tabs component.
          }}
        />
      )}
    </Page>
  );
};

export default TopologyPage;
