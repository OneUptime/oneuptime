import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ObjectID from "Common/Types/ObjectID";
import Incident from "Common/Models/DatabaseModels/Incident";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import MonitorType from "Common/Types/Monitor/MonitorType";
import MonitorSteps from "Common/Types/Monitor/MonitorSteps";
import MonitorStep from "Common/Types/Monitor/MonitorStep";
import MetricQueryConfigData from "Common/Types/Metrics/MetricQueryConfigData";
import MetricFormulaConfigData from "Common/Types/Metrics/MetricFormulaConfigData";
import MetricViewData from "Common/Types/Metrics/MetricViewData";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import OneUptimeDate from "Common/Types/Date";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import ComponentLoader from "Common/UI/Components/ComponentLoader/ComponentLoader";
import MetricView from "../Metrics/MetricView";

export interface ComponentProps {
  incidentId: ObjectID;
}

/*
 * Renders the metric that triggered an incident inline with the root
 * cause. The chart is scoped to a window centered on the incident's
 * declared-at time so on-call can see exactly what the evaluator saw
 * without leaving the page.
 */
const IncidentRootCauseMetricChart: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [metricViewData, setMetricViewData] = useState<MetricViewData | null>(
    null,
  );

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        setLoading(true);
        setError("");

        const incident: Incident | null = await ModelAPI.getItem({
          modelType: Incident,
          id: props.incidentId,
          select: {
            createdAt: true,
            createdCriteriaId: true,
            monitors: {
              _id: true,
              monitorType: true,
              monitorSteps: true,
            } as never,
          },
        });

        if (!incident) {
          setMetricViewData(null);
          setLoading(false);
          return;
        }

        const monitors: Array<Monitor> = incident.monitors || [];
        const metricMonitor: Monitor | undefined = monitors.find(
          (m: Monitor) => {
            return m.monitorType === MonitorType.Metrics;
          },
        );

        if (!metricMonitor) {
          // Not a metric monitor incident — render nothing.
          setMetricViewData(null);
          setLoading(false);
          return;
        }

        const steps: MonitorSteps | undefined = metricMonitor.monitorSteps;
        const stepsInstanceArray: Array<MonitorStep> =
          steps?.data?.monitorStepsInstanceArray || [];

        // Pick the first step that has a metric monitor configuration.
        let queryConfigs: Array<MetricQueryConfigData> = [];
        let formulaConfigs: Array<MetricFormulaConfigData> = [];
        for (const step of stepsInstanceArray) {
          const config: MetricQueryConfigData[] | undefined =
            step.data?.metricMonitor?.metricViewConfig?.queryConfigs;
          if (config && config.length > 0) {
            queryConfigs = config;
            formulaConfigs =
              step.data?.metricMonitor?.metricViewConfig?.formulaConfigs || [];
            break;
          }
        }

        if (queryConfigs.length === 0) {
          setMetricViewData(null);
          setLoading(false);
          return;
        }

        /*
         * Center the chart on the incident's creation time: 30 minutes
         * before to 15 minutes after. Fall back to last hour if createdAt
         * is missing.
         */
        const anchor: Date = incident.createdAt
          ? new Date(incident.createdAt as unknown as string | Date)
          : OneUptimeDate.getCurrentDate();

        const startAndEndDate: InBetween<Date> = new InBetween(
          OneUptimeDate.addRemoveMinutes(anchor, -30),
          OneUptimeDate.addRemoveMinutes(anchor, 15),
        );

        setMetricViewData({
          startAndEndDate,
          queryConfigs,
          formulaConfigs,
        });
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      } finally {
        setLoading(false);
      }
    };

    load().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, [props.incidentId.toString()]);

  if (loading) {
    return (
      <Card
        title="Metric at Incident Time"
        description="Metric data from around when this incident was declared."
      >
        <ComponentLoader />
      </Card>
    );
  }

  if (error) {
    return (
      <Card
        title="Metric at Incident Time"
        description="Metric data from around when this incident was declared."
      >
        <ErrorMessage message={error} />
      </Card>
    );
  }

  if (!metricViewData) {
    // Not a metric incident or no config — do not render anything.
    return null;
  }

  return (
    <Card
      title="Metric at Incident Time"
      description="Metric data from around when this incident was declared."
    >
      <MetricView
        data={metricViewData}
        hideQueryElements={true}
        hideStartAndEndDate={true}
        hideCardInCharts={true}
        chartCssClass="rounded-md border border-gray-200 mt-2 shadow-none"
        onChange={(data: MetricViewData) => {
          setMetricViewData(data);
        }}
      />
    </Card>
  );
};

export default IncidentRootCauseMetricChart;
