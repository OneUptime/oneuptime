import DataToProcess from '../../Types/DataToProcess';
import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import { BasicDiskMetrics } from 'Common/Types/Infrastructure/BasicMetrics';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import OneUptimeDate from 'Common/Types/Date';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import EvaluateOverTime from './EvaluateOverTime';
import { JSONObject } from 'Common/Types/JSON';
import CompareCriteria from './CompareCriteria';

export default class ServerMonitorCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: DataToProcess;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let threshold: number | string | undefined | null =
            input.criteriaFilter.value;
        let overTimeValue: Array<number> | number | undefined = undefined;

        if (
            input.criteriaFilter.eveluateOverTime &&
            input.criteriaFilter.evaluateOverTimeOptions
        ) {
            overTimeValue = await EvaluateOverTime.getValueOverTime({
                monitorId: input.dataToProcess.monitorId!,
                evaluateOverTimeOptions:
                    input.criteriaFilter.evaluateOverTimeOptions,
                metricType: input.criteriaFilter.checkOn,
                miscData: input.criteriaFilter
                    .serverMonitorOptions as JSONObject,
            });

            if (Array.isArray(overTimeValue) && overTimeValue.length === 0) {
                return null;
            }

            if (overTimeValue === undefined) {
                return null;
            }
        }

        if (
            (input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            const lastCheckTime: Date = (
                input.dataToProcess as ServerMonitorResponse
            ).requestReceivedAt;

            const differenceInMinutes: number =
                OneUptimeDate.getDifferenceInMinutes(
                    lastCheckTime,
                    OneUptimeDate.getCurrentDate()
                );

            const offlineIfNotCheckedInMinutes: number = 2;

            if (
                input.criteriaFilter.checkOn === CheckOn.IsOnline &&
                input.criteriaFilter.filterType === FilterType.True &&
                differenceInMinutes <= offlineIfNotCheckedInMinutes
            ) {
                if ((input.dataToProcess as ProbeMonitorResponse).isOnline) {
                    return 'Monitor is online.';
                }

                return null;
            }

            if (
                input.criteriaFilter.checkOn === CheckOn.IsOnline &&
                input.criteriaFilter.filterType === FilterType.False &&
                differenceInMinutes > offlineIfNotCheckedInMinutes
            ) {
                if (!(input.dataToProcess as ProbeMonitorResponse).isOnline) {
                    return 'Monitor is offline.';
                }
                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.CPUUsagePercent &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            const currentCpuPercent: number | Array<number> =
                overTimeValue ||
                (input.dataToProcess as ServerMonitorResponse)
                    .basicInfrastructureMetrics?.cpuMetrics.percentUsed ||
                0;

            return CompareCriteria.compareCriteriaNumbers({
                value: currentCpuPercent,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.MemoryUsagePercent &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            const memoryPercent: number | Array<number> =
                overTimeValue ||
                (input.dataToProcess as ServerMonitorResponse)
                    .basicInfrastructureMetrics?.memoryMetrics.percentUsed ||
                0;

            return CompareCriteria.compareCriteriaNumbers({
                value: memoryPercent,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.DiskUsagePercent &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            threshold = CompareCriteria.convertThresholdToNumber(threshold);

            const diskPath: string =
                input.criteriaFilter.serverMonitorOptions?.diskPath || '/';

            const diskPercent: number =
                (
                    input.dataToProcess as ServerMonitorResponse
                ).basicInfrastructureMetrics?.diskMetrics.filter(
                    (item: BasicDiskMetrics) => {
                        return (
                            item.diskPath.trim().toLowerCase() ===
                            diskPath.trim().toLowerCase()
                        );
                    }
                )[0]?.percentFree || 0;

            return CompareCriteria.compareCriteriaNumbers({
                value: diskPercent,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        return null;
    }
}
