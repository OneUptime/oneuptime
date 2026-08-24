import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Card from "Common/UI/Components/Card/Card";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Dictionary from "Common/Types/Dictionary";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import GroupBy from "Common/Types/BaseDatabase/GroupBy";
import Select from "Common/Types/BaseDatabase/Select";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import ObjectID from "Common/Types/ObjectID";
import Metric from "Common/Models/AnalyticsModels/Metric";
import { TelemetryQuery } from "Common/Types/Telemetry/TelemetryQuery";
import TelemetryType from "Common/Types/Telemetry/TelemetryType";
import RangeStartAndEndDateTime from "Common/Types/Time/RangeStartAndEndDateTime";
import TimeRange from "Common/Types/Time/TimeRange";
import AnalyticsModelAPI, {
  ListResult,
} from "Common/UI/Utils/AnalyticsModelAPI/AnalyticsModelAPI";
import API from "Common/UI/Utils/API/API";
import ProjectUtil from "Common/UI/Utils/Project";
import DashboardLogsViewer from "../Logs/LogsViewer";
import TraceTable from "../Traces/TraceTable";
import ExceptionInstanceTable from "../Exceptions/ExceptionInstanceTable";
import EmbeddedMetricCard from "../Metrics/EmbeddedMetricCard";
import useServiceNames from "./useServiceNames";
import {
  formatDroppedScopeHint,
  resolveServiceIdsByNames,
} from "../../Utils/MetricsCrossSignalPivot";
import {
  CompanionExceptionsSpec,
  CompanionLogsSpec,
  CompanionMetricChartPlan,
  CompanionMetricsSpec,
  CompanionSignalQueries,
  CompanionTracesSpec,
  buildCompanionMetricChartPlan,
  buildCompanionMetricNameQuery,
  deriveCompanionSignalQueries,
  getCompanionMetricScopeServiceNames,
  getTelemetrySnapshotTabOrder,
} from "../../Utils/TelemetryCompanionSignals";

/*
 * The incident / alert "Telemetry snapshot" card: the monitor's own signal
 * renders first, exactly as the page always rendered it (the page hands the
 * finished element over untouched), and the other three pillars ride along
 * as tabs scoped to the same slice — the primary's service / entity /
 * attribute scope pinned to the snapshot window. Tabs mount only their
 * active panel, so the companions cost nothing until they are opened.
 */

export interface ComponentProps {
  telemetryQuery: TelemetryQuery;
  snapshotWindow: InBetween<Date> | null;
  // Shared with the page's own preview cards (may be undefined — no window).
  snapshotWindowAlert?: ReactElement | undefined;
  /*
   * Noun the tab copy hangs on ("Logs in this incident's telemetry
   * scope…"). "view" is what window-scoped hosts (the investigation
   * drawer) pass.
   */
  eventNoun: "incident" | "alert" | "view";
  /*
   * The page's existing single-signal preview block, passed through
   * verbatim so the default tab has zero behavior change.
   */
  primarySignalElement: ReactElement;
}

const TAB_LABELS: Dictionary<string> = {
  [TelemetryType.Log]: "Logs",
  [TelemetryType.Trace]: "Traces",
  [TelemetryType.Metric]: "Metrics",
  [TelemetryType.Exception]: "Exceptions",
};

interface CompanionScopeHintProps {
  notes: Array<string>;
}

/*
 * The "scope partially carried" hint: names what the companion could not
 * translate from the primary's filters, so a wider result set is never
 * mistaken for an equally-narrow one.
 */
const CompanionScopeHint: FunctionComponent<CompanionScopeHintProps> = (
  props: CompanionScopeHintProps,
): ReactElement => {
  const hint: string = formatDroppedScopeHint(props.notes);

  if (!hint) {
    return <></>;
  }

  return <div className="mb-3 text-xs text-gray-500">{hint}</div>;
};

interface CompanionLogsTabProps {
  spec: CompanionLogsSpec;
  snapshotWindowAlert?: ReactElement | undefined;
  eventNoun: string;
}

const CompanionLogsTab: FunctionComponent<CompanionLogsTabProps> = (
  props: CompanionLogsTabProps,
): ReactElement => {
  const serviceIds: Array<ObjectID> = useMemo(() => {
    return props.spec.serviceIds.map((serviceId: string): ObjectID => {
      return new ObjectID(serviceId);
    });
  }, [props.spec.serviceIds]);

  return (
    <div>
      <CompanionScopeHint notes={props.spec.notCarried} />
      <Card
        title={"Logs"}
        description={`Logs in this ${props.eventNoun}'s telemetry scope during the snapshot window.`}
        rightElement={props.snapshotWindowAlert}
      >
        <DashboardLogsViewer
          id="companion-logs"
          serviceIds={serviceIds.length > 0 ? serviceIds : undefined}
          logQuery={props.spec.logQuery}
          limit={10}
          noLogsMessage="No logs found in the snapshot window."
        />
      </Card>
    </div>
  );
};

interface CompanionTracesTabProps {
  spec: CompanionTracesSpec;
  snapshotWindowAlert?: ReactElement | undefined;
}

const CompanionTracesTab: FunctionComponent<CompanionTracesTabProps> = (
  props: CompanionTracesTabProps,
): ReactElement => {
  return (
    <div>
      <CompanionScopeHint notes={props.spec.notCarried} />
      <TraceTable
        spanQuery={props.spec.spanQuery}
        rightElement={props.snapshotWindowAlert}
        // Pinned to the snapshot; a URL-restored filter must not replace it.
        disableUrlState={true}
        noItemsMessage="No spans found in the snapshot window."
      />
    </div>
  );
};

interface CompanionExceptionsTabProps {
  spec: CompanionExceptionsSpec;
  snapshotWindowAlert?: ReactElement | undefined;
  eventNoun: string;
}

const CompanionExceptionsTab: FunctionComponent<CompanionExceptionsTabProps> = (
  props: CompanionExceptionsTabProps,
): ReactElement => {
  return (
    <div>
      <CompanionScopeHint notes={props.spec.notCarried} />
      <ExceptionInstanceTable
        title="Exceptions"
        description={`Exceptions in this ${props.eventNoun}'s telemetry scope during the snapshot window.`}
        query={props.spec.exceptionQuery}
        rightElement={props.snapshotWindowAlert}
        // Pinned to the snapshot; a URL-restored filter must not replace it.
        disableUrlState={true}
      />
    </div>
  );
};

interface CompanionMetricsTabProps {
  spec: CompanionMetricsSpec;
  snapshotWindowAlert?: ReactElement | undefined;
  eventNoun: string;
}

/*
 * The metrics companion: EmbeddedMetricCard pinned to the snapshot window
 * (controlled timeRange — MetricsViewer was rejected because it cannot pin
 * a window and mirrors its state onto the host page's URL). The card needs
 * concrete metric names, so the tab first discovers which names exist in
 * the primary's scope during the window — the same GROUP-BY-name lookup
 * MetricsViewer's entity-scoped name match runs — and charts the first few.
 */
const CompanionMetricsTab: FunctionComponent<CompanionMetricsTabProps> = (
  props: CompanionMetricsTabProps,
): ReactElement => {
  const spec: CompanionMetricsSpec = props.spec;

  const serviceObjectIds: Array<ObjectID> = useMemo(() => {
    return spec.serviceIds.map((serviceId: string): ObjectID => {
      return new ObjectID(serviceId);
    });
  }, [spec.serviceIds]);

  /*
   * Chart values are scoped through the `resource.service.name` attribute
   * (MetricView's filterData has no service-id dimension), so the scope's
   * ids are resolved to names. An id that does not resolve is reported by
   * the chart plan as a scope note instead of silently widening.
   */
  const serviceNameMap: Record<string, string> =
    useServiceNames(serviceObjectIds);

  const serviceNames: Array<string> = useMemo(() => {
    return spec.serviceIds
      .map((serviceId: string): string => {
        return serviceNameMap[serviceId] || "";
      })
      .filter((serviceName: string): boolean => {
        return serviceName.length > 0;
      });
  }, [spec.serviceIds, serviceNameMap]);

  const [metricNames, setMetricNames] = useState<Array<string> | null>(null);
  const [error, setError] = useState<string>("");

  useEffect(() => {
    let isCancelled: boolean = false;

    const loadMetricNames: () => Promise<void> = async (): Promise<void> => {
      try {
        setError("");
        // Back to the loader while a re-derived scope refetches.
        setMetricNames(null);

        const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();

        if (!projectId) {
          setMetricNames([]);
          return;
        }

        const result: ListResult<Metric> =
          await AnalyticsModelAPI.getList<Metric>({
            modelType: Metric,
            query: buildCompanionMetricNameQuery({
              spec: spec,
              projectId: projectId,
            }),
            groupBy: { name: true } as GroupBy<Metric>,
            limit: LIMIT_PER_PROJECT,
            skip: 0,
            select: {
              name: true,
            } as Select<Metric>,
            sort: { name: SortOrder.Ascending } as Record<string, SortOrder>,
            requestOptions: {},
          });

        if (isCancelled) {
          return;
        }

        const uniqueNames: Array<string> = [];

        for (const metric of result.data || []) {
          const name: string = (metric.name as unknown as string) || "";

          if (name && !uniqueNames.includes(name)) {
            uniqueNames.push(name);
          }
        }

        setMetricNames(uniqueNames);
      } catch (err) {
        if (!isCancelled) {
          setError(API.getFriendlyMessage(err));
        }
      }
    };

    void loadMetricNames();

    return () => {
      isCancelled = true;
    };
  }, [spec]);

  const chartPlan: CompanionMetricChartPlan = useMemo(() => {
    return buildCompanionMetricChartPlan({
      metricNames: metricNames || [],
      serviceNames: serviceNames,
      spec: spec,
    });
  }, [metricNames, serviceNames, spec]);

  /*
   * Seeded to the exact snapshot window as a pinned Custom range. The
   * picker stays usable, so the user can consciously widen — nothing
   * re-anchors to "now" on its own.
   */
  const [timeRange, setTimeRange] = useState<RangeStartAndEndDateTime>(() => {
    return {
      range: TimeRange.CUSTOM,
      startAndEndDate: new InBetween<Date>(
        spec.window.startValue,
        spec.window.endValue,
      ),
    };
  });

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (metricNames === null) {
    return <ComponentLoader />;
  }

  if (metricNames.length === 0) {
    return (
      <div>
        <CompanionScopeHint notes={spec.notCarried} />
        <Card
          title={"Metrics"}
          description={`Metrics in this ${props.eventNoun}'s telemetry scope during the snapshot window.`}
          rightElement={props.snapshotWindowAlert}
        >
          <p className="text-sm text-gray-500">
            No metrics were found in this scope during the snapshot window.
          </p>
        </Card>
      </div>
    );
  }

  const description: string =
    chartPlan.omittedMetricCount > 0
      ? `Metrics in this ${props.eventNoun}'s telemetry scope during the snapshot window. Showing ${chartPlan.queryConfigs.length} of ${metricNames.length} metrics.`
      : `Metrics in this ${props.eventNoun}'s telemetry scope during the snapshot window.`;

  return (
    <div>
      <CompanionScopeHint
        notes={[...spec.notCarried, ...chartPlan.chartScopeNotes]}
      />
      <EmbeddedMetricCard
        title={"Metrics"}
        description={description}
        queryConfigs={chartPlan.queryConfigs}
        timeRange={timeRange}
        onTimeRangeChange={setTimeRange}
        rightElement={props.snapshotWindowAlert}
      />
    </div>
  );
};

const TelemetryCompanionSignalTabs: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * Metric primaries name their services through the
   * `resource.service.name` attribute; resolve those names to Service ids
   * once so the log / trace / exception companions can scope by
   * primaryEntityId. Until (or unless) resolution lands, the derivation
   * degrades to a verbatim attribute filter — correct, just via the
   * attribute column.
   */
  const [serviceIdsByName, setServiceIdsByName] = useState<Dictionary<string>>(
    {},
  );

  useEffect(() => {
    const serviceNames: Array<string> = getCompanionMetricScopeServiceNames(
      props.telemetryQuery,
    );

    if (serviceNames.length === 0) {
      return undefined;
    }

    let isCancelled: boolean = false;

    resolveServiceIdsByNames(serviceNames)
      .then((mapping: Dictionary<string>) => {
        if (!isCancelled && Object.keys(mapping).length > 0) {
          setServiceIdsByName(mapping);
        }
      })
      .catch(() => {
        // Best-effort: the attribute-passthrough degradation stands.
      });

    return () => {
      isCancelled = true;
    };
  }, [props.telemetryQuery]);

  const companions: CompanionSignalQueries = useMemo(() => {
    return deriveCompanionSignalQueries({
      telemetryQuery: props.telemetryQuery,
      snapshotWindow: props.snapshotWindow,
      serviceIdsByName: serviceIdsByName,
    });
  }, [props.telemetryQuery, props.snapshotWindow, serviceIdsByName]);

  const handleTabChange: (tab: Tab) => void = useCallback((_tab: Tab): void => {
    // Selection is transient; Tabs owns which panel is mounted.
  }, []);

  const tabs: Array<Tab> = useMemo(() => {
    if (!companions.primaryType) {
      return [];
    }

    const items: Array<Tab> = [];

    for (const telemetryType of getTelemetrySnapshotTabOrder(
      companions.primaryType,
    )) {
      const label: string = TAB_LABELS[telemetryType] || telemetryType;

      if (telemetryType === companions.primaryType) {
        items.push({
          name: label,
          children: props.primarySignalElement,
        });
        continue;
      }

      if (telemetryType === TelemetryType.Log && companions.logs) {
        items.push({
          name: label,
          children: (
            <CompanionLogsTab
              spec={companions.logs}
              snapshotWindowAlert={props.snapshotWindowAlert}
              eventNoun={props.eventNoun}
            />
          ),
        });
        continue;
      }

      if (telemetryType === TelemetryType.Trace && companions.traces) {
        items.push({
          name: label,
          children: (
            <CompanionTracesTab
              spec={companions.traces}
              snapshotWindowAlert={props.snapshotWindowAlert}
            />
          ),
        });
        continue;
      }

      if (telemetryType === TelemetryType.Metric && companions.metrics) {
        items.push({
          name: label,
          children: (
            <CompanionMetricsTab
              spec={companions.metrics}
              snapshotWindowAlert={props.snapshotWindowAlert}
              eventNoun={props.eventNoun}
            />
          ),
        });
        continue;
      }

      if (telemetryType === TelemetryType.Exception && companions.exceptions) {
        items.push({
          name: label,
          children: (
            <CompanionExceptionsTab
              spec={companions.exceptions}
              snapshotWindowAlert={props.snapshotWindowAlert}
              eventNoun={props.eventNoun}
            />
          ),
        });
      }
    }

    return items;
  }, [
    companions,
    props.primarySignalElement,
    props.snapshotWindowAlert,
    props.eventNoun,
  ]);

  /*
   * No derivable companions (no stored window, malformed query, profile
   * monitor): the page renders exactly what it always rendered.
   */
  if (tabs.length <= 1) {
    return props.primarySignalElement;
  }

  return (
    <div className="mb-5">
      <Tabs tabs={tabs} onTabChange={handleTabChange} />
    </div>
  );
};

export default TelemetryCompanionSignalTabs;
