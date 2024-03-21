import DataToProcess from '../../Types/DataToProcess';
import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import { BasicDiskMetrics } from 'Common/Types/Infrastructure/BasicMetrics';
import ServerMonitorResponse from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import logger from 'CommonServer/Utils/Logger';
import Typeof from 'Common/Types/Typeof';
import OneUptimeDate from 'Common/Types/Date';
import ProbeMonitorResponse from 'Common/Types/Probe/ProbeMonitorResponse';
import EvaluateOverTime from './EvaluateOverTime';
import { JSONObject } from 'Common/Types/JSON';

export default class ServerMonitorCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        dataToProcess: DataToProcess;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let value: number | string | undefined = input.criteriaFilter.value;


        if(input.criteriaFilter.eveluateOverTime && input.criteriaFilter.evaluateOverTimeOptions) {
            const overTimeValue: Array<number> | number = await EvaluateOverTime.getValueOverTime({
                monitorId: input.dataToProcess.monitorId!,
                evaluateOverTimeOptions: input.criteriaFilter.evaluateOverTimeOptions,
                metricType: input.criteriaFilter.checkOn,
                miscData: input.criteriaFilter.serverMonitorOptions as JSONObject
            });

            // TODO: Check Any / All values
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
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            const currentCpuPercent: number =
                (input.dataToProcess as ServerMonitorResponse)
                    .basicInfrastructureMetrics?.cpuMetrics.percentUsed || 0;

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (currentCpuPercent > (value as number)) {
                    return `CPU Percent is ${currentCpuPercent}% which is greater than the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (currentCpuPercent < (value as number)) {
                    return `CPU Percent is ${currentCpuPercent}% which is less than than the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (currentCpuPercent === (value as number)) {
                    return `CPU Percent is ${currentCpuPercent}% which is equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (currentCpuPercent !== (value as number)) {
                    return `CPU Percent is ${currentCpuPercent}% which is not equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (currentCpuPercent >= (value as number)) {
                    return `CPU Percent is ${currentCpuPercent}% which is greater than or equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (currentCpuPercent <= (value as number)) {
                    return `CPU Percent is ${currentCpuPercent}% which is less than or equal to the criteria value of ${value}%.`;
                }

                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.MemoryUsagePercent &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

            const memoryPercent: number =
                (input.dataToProcess as ServerMonitorResponse)
                    .basicInfrastructureMetrics?.memoryMetrics.percentFree || 0;

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (memoryPercent > (value as number)) {
                    return `Memory Percent is ${memoryPercent}% which is greater than the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (memoryPercent < (value as number)) {
                    return `Memory Percent is ${memoryPercent}% which is less than than the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (memoryPercent === (value as number)) {
                    return `Memory Percent is ${memoryPercent}% which is equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (memoryPercent !== (value as number)) {
                    return `Memory Percent is ${memoryPercent}% which is not equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (memoryPercent >= (value as number)) {
                    return `Memory Percent is ${memoryPercent}% which is greater than or equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (memoryPercent <= (value as number)) {
                    return `Memory Percent is ${memoryPercent}% which is less than or equal to the criteria value of ${value}%.`;
                }

                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.DiskUsagePercent &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            if (!value) {
                return null;
            }

            if (typeof value === Typeof.String) {
                try {
                    value = parseInt(value as string);
                } catch (err) {
                    logger.error(err);
                    return null;
                }
            }

            if (typeof value !== Typeof.Number) {
                return null;
            }

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

            if (input.criteriaFilter.filterType === FilterType.GreaterThan) {
                if (diskPercent > (value as number)) {
                    return `Disk Percent for ${diskPath} is ${diskPercent}% which is greater than the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.LessThan) {
                if (diskPercent < (value as number)) {
                    return `Disk Percent for ${diskPath} is ${diskPercent}% which is less than than the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.EqualTo) {
                if (diskPercent === (value as number)) {
                    return `Disk Percent for ${diskPath} is ${diskPercent}% which is equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.NotEqualTo) {
                if (diskPercent !== (value as number)) {
                    return `Disk Percent for ${diskPath} is ${diskPercent}% which is not equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (
                input.criteriaFilter.filterType ===
                FilterType.GreaterThanOrEqualTo
            ) {
                if (diskPercent >= (value as number)) {
                    return `Disk Percent for ${diskPath} is ${diskPercent}% which is greater than or equal to the criteria value of ${value}%.`;
                }

                return null;
            }

            if (
                input.criteriaFilter.filterType === FilterType.LessThanOrEqualTo
            ) {
                if (diskPercent <= (value as number)) {
                    return `Disk Percent for ${diskPath} is ${diskPercent}% which is less than or equal to the criteria value of ${value}%.`;
                }

                return null;
            }
        }

        return null;
    }
}
