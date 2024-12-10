import React, { FunctionComponent, ReactElement } from "react";
import MonitorStepMetricMonitor from "Common/Types/Monitor/MonitorStepMetricMonitor";
import MetricView from "../../Metrics/MetricView";
import InBetween from "Common/Types/BaseDatabase/InBetween";
import RollingTimeUtil from "Common/Types/RollingTime/RollingTimeUtil";

export interface ComponentProps {
    monitorStepMetricMonitor: MonitorStepMetricMonitor | undefined;
}

const MetricMonitorPreview: FunctionComponent<ComponentProps> = (
    props: ComponentProps,
): ReactElement => {

    const startAndEndDate: InBetween<Date> = RollingTimeUtil.convertToStartAndEndDate(
        props.monitorStepMetricMonitor?.rollingTime || RollingTimeUtil.getDefault(),
    )

    return <MetricView
        data={{
            startAndEndDate: startAndEndDate,
            queryConfigs: props.monitorStepMetricMonitor?.metricViewConfig.queryConfigs || [],
            formulaConfigs: props.monitorStepMetricMonitor?.metricViewConfig.formulaConfigs || [],
        }}
    />
};

export default MetricMonitorPreview;
