import {
    CheckOn,
    CriteriaFilter,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import ServerMonitorResponse, {
    ServerProcess,
} from 'Common/Types/Monitor/ServerMonitor/ServerMonitorResponse';
import CompareCriteria from './CompareCriteria';
import SyntheticMonitorResponse from 'Common/Types/Monitor/SyntheticMonitors/SyntheticMonitorResponse';

export default class CustomCodeMonitoringCriteria {
    public static async isMonitorInstanceCriteriaFilterMet(input: {
        syntheticMonitorResponse: SyntheticMonitorResponse;
        criteriaFilter: CriteriaFilter;
    }): Promise<string | null> {
        // Server Monitoring Checks

        let threshold: number | string | undefined | null =
            input.criteriaFilter.value;

        const syntheticMonitorResponse: SyntheticMonitorResponse = input.syntheticMonitorResponse;


        if (
            input.criteriaFilter.checkOn === CheckOn.ExecutionTime
        ) {
            threshold = CompareCriteria.convertToNumber(threshold);

            const currentExecutionTime: number = syntheticMonitorResponse.executionTimeInMS.toNumber() || 0;

            return CompareCriteria.compareCriteriaNumbers({
                value: currentExecutionTime,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.ExecutionTime
        ) {
            threshold = CompareCriteria.convertToNumber(threshold);

            const currentExecutionTime: number = syntheticMonitorResponse.executionTimeInMS.toNumber() || 0;

            return CompareCriteria.comp({
                value: currentExecutionTime,
                threshold: threshold as number,
                criteriaFilter: input.criteriaFilter,
            });
        }



        if (
            input.criteriaFilter.checkOn === CheckOn.ResultValue
        ) {

            let thresholdAsNumber: number | null = null;

            try {
                if (threshold) {
                    thresholdAsNumber = parseFloat(threshold.toString());
                }

            } catch (err) {
                thresholdAsNumber = null;
            }

            if(thresholdAsNumber !== null && typeof syntheticMonitorResponse.result === 'number') {
                const result: string | null =  CompareCriteria.compareCriteriaNumbers({
                    value: syntheticMonitorResponse.result,
                    threshold: thresholdAsNumber as number,
                    criteriaFilter: input.criteriaFilter,
                });
                
                if(result) {
                    return result;
                }
            }
            
            if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
                const processNames: Array<string> =
                    (
                        input.dataToProcess as ServerMonitorResponse
                    )?.processes?.map((item: ServerProcess) => {
                        return item.name.trim().toLowerCase();
                    }) || [];

                if (processNames.includes(thresholdProcessName)) {
                    return `Process ${threshold} is executing.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
                const processNames: Array<string> =
                    (
                        input.dataToProcess as ServerMonitorResponse
                    )?.processes?.map((item: ServerProcess) => {
                        return item.name.trim().toLowerCase();
                    }) || [];

                if (!processNames.includes(thresholdProcessName)) {
                    return `Process ${threshold} is not executing.`;
                }

                return null;
            }
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.ServerProcessPID &&
            threshold &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            const thresholdProcessPID: string = threshold
                .toString()
                .trim()
                .toLowerCase();

            if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
                const processPIDs: Array<string> =
                    (
                        input.dataToProcess as ServerMonitorResponse
                    )?.processes?.map((item: ServerProcess) => {
                        return item.pid.toString().trim().toLowerCase();
                    }) || [];

                if (processPIDs.includes(thresholdProcessPID)) {
                    return `Process with PID ${threshold} is executing.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
                const processPIDs: Array<string> =
                    (
                        input.dataToProcess as ServerMonitorResponse
                    )?.processes?.map((item: ServerProcess) => {
                        return item.pid.toString().trim().toLowerCase();
                    }) || [];

                if (!processPIDs.includes(thresholdProcessPID)) {
                    return `Process with PID ${threshold} is not executing.`;
                }

                return null;
            }

            return null;
        }

        if (
            input.criteriaFilter.checkOn === CheckOn.ServerProcessCommand &&
            threshold &&
            !(input.dataToProcess as ServerMonitorResponse)
                .onlyCheckRequestReceivedAt
        ) {
            const thresholdProcessCommand: string = threshold
                .toString()
                .trim()
                .toLowerCase();

            if (input.criteriaFilter.filterType === FilterType.IsExecuting) {
                const processCommands: Array<string> =
                    (
                        input.dataToProcess as ServerMonitorResponse
                    )?.processes?.map((item: ServerProcess) => {
                        return item.command.trim().toLowerCase();
                    }) || [];

                if (processCommands.includes(thresholdProcessCommand)) {
                    return `Process with command ${threshold} is executing.`;
                }

                return null;
            }

            if (input.criteriaFilter.filterType === FilterType.IsNotExecuting) {
                const processCommands: Array<string> =
                    (
                        input.dataToProcess as ServerMonitorResponse
                    )?.processes?.map((item: ServerProcess) => {
                        return item.command.trim().toLowerCase();
                    }) || [];

                if (!processCommands.includes(thresholdProcessCommand)) {
                    return `Process with command ${threshold} is not executing.`;
                }

                return null;
            }

            return null;
        }

        return null;
    }
}
