import logger from '../../../Utils/Logger';
import {
    CheckOn,
    CriteriaFilter,
    EvaluateOverTimeType,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';
import Typeof from 'Common/Types/Typeof';

export default class CompareCriteria {
    public static greaterThan(data: {
        value: number | Array<number>;
        evaluationType?: EvaluateOverTimeType | undefined;
        threshold: number;
    }): boolean {
        if (Array.isArray(data.value)) {
            if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
                return data.value.some((value: number) => {
                    return value > data.threshold;
                });
            }
            return data.value.every((value: number) => {
                return value > data.threshold;
            });
        }

        return data.value > data.threshold;
    }

    public static lessThan(data: {
        value: number | Array<number>;
        evaluationType?: EvaluateOverTimeType | undefined;
        threshold: number;
    }): boolean {
        if (Array.isArray(data.value)) {
            if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
                return data.value.some((value: number) => {
                    return value < data.threshold;
                });
            }
            return data.value.every((value: number) => {
                return value < data.threshold;
            });
        }

        return data.value < data.threshold;
    }

    public static greaterThanOrEqual(data: {
        value: number | Array<number>;
        evaluationType?: EvaluateOverTimeType | undefined;
        threshold: number;
    }): boolean {
        if (Array.isArray(data.value)) {
            if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
                return data.value.some((value: number) => {
                    return value >= data.threshold;
                });
            }
            return data.value.every((value: number) => {
                return value >= data.threshold;
            });
        }

        return data.value >= data.threshold;
    }

    public static lessThanOrEqual(data: {
        value: number | Array<number>;
        evaluationType?: EvaluateOverTimeType | undefined;
        threshold: number;
    }): boolean {
        if (Array.isArray(data.value)) {
            if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
                return data.value.some((value: number) => {
                    return value <= data.threshold;
                });
            }
            return data.value.every((value: number) => {
                return value <= data.threshold;
            });
        }

        return data.value <= data.threshold;
    }

    public static equalTo(data: {
        value: number | Array<number>;
        evaluationType?: EvaluateOverTimeType | undefined;
        threshold: number;
    }): boolean {
        if (Array.isArray(data.value)) {
            if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
                return data.value.some((value: number) => {
                    return value === data.threshold;
                });
            }
            return data.value.every((value: number) => {
                return value === data.threshold;
            });
        }

        return data.value === data.threshold;
    }

    public static notEqualTo(data: {
        value: number | Array<number>;
        evaluationType?: EvaluateOverTimeType | undefined;
        threshold: number;
    }): boolean {
        if (Array.isArray(data.value)) {
            if (data.evaluationType === EvaluateOverTimeType.AnyValue) {
                return data.value.some((value: number) => {
                    return value !== data.threshold;
                });
            }
            return data.value.every((value: number) => {
                return value !== data.threshold;
            });
        }

        return data.value !== data.threshold;
    }

    public static convertToNumber(
        threshold: string | number | undefined
    ): number | null {
        if (!threshold) {
            return null;
        }

        if (typeof threshold === Typeof.String) {
            try {
                threshold = parseInt(threshold as string);
            } catch (err) {
                logger.error(err);
                return null;
            }
        }

        if (typeof threshold !== Typeof.Number) {
            return null;
        }

        return threshold as number;
    }

    public static checkEqualToOrNotEqualTo(data: {
        value: string | number;
        threshold: string | number;
        criteriaFilter: CriteriaFilter;
    }): string | null {
        if (data.criteriaFilter.filterType === FilterType.EqualTo) {
            if (data.value === data.threshold) {
                return `${data.criteriaFilter.checkOn} is equal to ${data.threshold}.`;
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.NotEqualTo) {
            if (data.value !== data.threshold) {
                return `${data.criteriaFilter.checkOn} is not equal to ${data.threshold}.`;
            }

            return null;
        }

        return null;
    }

    public static compareEmptyAndNotEmpty(data: {
        value: any;
        criteriaFilter: CriteriaFilter;
    }): string | null {
        if (data.criteriaFilter.filterType === FilterType.IsEmpty) {
            if (data.value === null || data.value === undefined) {
                return `${data.criteriaFilter.checkOn} is empty.`;
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.IsNotEmpty) {
            if (data.value !== null && data.value !== undefined) {
                return `${data.criteriaFilter.checkOn} is not empty.`;
            }

            return null;
        }

        return null;
    }

    public static compareCriteriaStrings(data: {
        value: string;
        threshold: string;
        criteriaFilter: CriteriaFilter;
    }): string | null {
        if (data.value === null || data.value === undefined) {
            return null;
        }

        if (data.threshold === null || data.threshold === undefined) {
            return null;
        }

        if (typeof data.value !== Typeof.String) {
            data.value = data.value.toString();
        }

        if (typeof data.threshold !== Typeof.String) {
            data.threshold = data.threshold.toString();
        }

        if (data.criteriaFilter.filterType === FilterType.Contains) {
            if (data.value.includes(data.threshold)) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.NotContains) {
            if (!data.value.includes(data.threshold)) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.StartsWith) {
            if (data.value.startsWith(data.threshold)) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.EndsWith) {
            if (data.value.endsWith(data.threshold)) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        return null;
    }

    public static compareCriteriaNumbers(data: {
        value: Array<number> | number;
        threshold: number;
        criteriaFilter: CriteriaFilter;
    }): string | null {
        if (data.value === null || data.value === undefined) {
            return null;
        }

        if (data.threshold === null || data.threshold === undefined) {
            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.GreaterThan) {
            if (
                CompareCriteria.greaterThan({
                    threshold: data.threshold as number,
                    value: data.value,
                    evaluationType:
                        data.criteriaFilter.evaluateOverTimeOptions
                            ?.evaluateOverTimeType,
                })
            ) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold as number,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.LessThan) {
            if (
                CompareCriteria.lessThan({
                    threshold: data.threshold as number,
                    value: data.value,
                    evaluationType:
                        data.criteriaFilter.evaluateOverTimeOptions
                            ?.evaluateOverTimeType,
                })
            ) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold as number,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.EqualTo) {
            if (
                CompareCriteria.equalTo({
                    threshold: data.threshold as number,
                    value: data.value,
                    evaluationType:
                        data.criteriaFilter.evaluateOverTimeOptions
                            ?.evaluateOverTimeType,
                })
            ) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold as number,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.NotEqualTo) {
            if (
                CompareCriteria.notEqualTo({
                    threshold: data.threshold as number,
                    value: data.value,
                    evaluationType:
                        data.criteriaFilter.evaluateOverTimeOptions
                            ?.evaluateOverTimeType,
                })
            ) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold as number,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (
            data.criteriaFilter.filterType === FilterType.GreaterThanOrEqualTo
        ) {
            if (
                CompareCriteria.greaterThanOrEqual({
                    threshold: data.threshold as number,
                    value: data.value,
                    evaluationType:
                        data.criteriaFilter.evaluateOverTimeOptions
                            ?.evaluateOverTimeType,
                })
            ) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold as number,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        if (data.criteriaFilter.filterType === FilterType.LessThanOrEqualTo) {
            if (
                CompareCriteria.lessThanOrEqual({
                    threshold: data.threshold as number,
                    value: data.value,
                    evaluationType:
                        data.criteriaFilter.evaluateOverTimeOptions
                            ?.evaluateOverTimeType,
                })
            ) {
                return CompareCriteria.getCompareMessage({
                    values: data.value,
                    threshold: data.threshold as number,
                    criteriaFilter: data.criteriaFilter,
                });
            }

            return null;
        }

        return null;
    }

    public static getCompareMessage(data: {
        values: Array<number> | number | string;
        threshold: number | string;
        criteriaFilter: CriteriaFilter;
    }): string {
        // CPU Percent over the last 5 minutes is 10 which is less than the threshold of 20
        let message: string = '';

        if (
            data.criteriaFilter.evaluateOverTimeOptions
                ?.evaluateOverTimeType === EvaluateOverTimeType.AnyValue
        ) {
            message += 'Any value of';
        }

        if (
            data.criteriaFilter.evaluateOverTimeOptions
                ?.evaluateOverTimeType === EvaluateOverTimeType.AllValues
        ) {
            message += 'All values of';
        }

        message += ` ${data.criteriaFilter.checkOn}`;

        if (data.criteriaFilter.checkOn === CheckOn.DiskUsagePercent) {
            const diskPath: string =
                data.criteriaFilter.serverMonitorOptions?.diskPath || '/';

            message += ` on disk ${diskPath}`;
        }

        if (
            data.criteriaFilter.eveluateOverTime &&
            data.criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
        ) {
            message += ` over the last ${data.criteriaFilter.evaluateOverTimeOptions.timeValueInMinutes} minutes`;
        }

        if (Array.isArray(data.values)) {
            message += ` is ${data.values.join(', ')}`;
        } else {
            message += ` is ${data.values}`;
        }

        message += ' which is';

        switch (data.criteriaFilter.filterType) {
            case FilterType.EqualTo:
                message += ` equal to threshold ${data.threshold}`;
                break;
            case FilterType.GreaterThan:
                message += ` greater than threshold ${data.threshold}`;
                break;
            case FilterType.GreaterThanOrEqualTo:
                message += ` greater than or equal to threshold ${data.threshold}`;
                break;
            case FilterType.LessThan:
                message += ` less than threshold ${data.threshold}`;
                break;
            case FilterType.LessThanOrEqualTo:
                message += ` less than or equal to threshold ${data.threshold}`;
                break;
            case FilterType.NotEqualTo:
                message += ` not equal to threshold ${data.threshold}`;
                break;
            case FilterType.Contains:
                message += ` contains ${data.threshold}`;
                break;
            case FilterType.NotContains:
                message += ` does not contain ${data.threshold}`;
                break;
            case FilterType.StartsWith:
                message += ` starts with ${data.threshold}`;
                break;
            case FilterType.EndsWith:
                message += ` ends with ${data.threshold}`;
                break;
        }

        return message.trim();
    }
}
