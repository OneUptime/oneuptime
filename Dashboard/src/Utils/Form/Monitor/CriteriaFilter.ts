import DropdownUtil from 'CommonUI/src/Utils/Dropdown';
import MonitorType from 'Common/Types/Monitor/MonitorType';
import { DropdownOption } from 'CommonUI/src/Components/Dropdown/Dropdown';
import {
    CheckOn,
    CriteriaFilter,
    EvaluateOverTimeMinutes,
    EvaluateOverTimeType,
    FilterCondition,
    FilterType,
} from 'Common/Types/Monitor/CriteriaFilter';

export default class CriteriaFilterUtil {
    public static getEvaluateOverTimeMinutesOptions(): Array<DropdownOption> {
        const keys: Array<string> = Object.keys(EvaluateOverTimeMinutes);
        return keys.map((key: string) => {
            return {
                label: `${(EvaluateOverTimeMinutes as any)[
                    key
                ].toString()} Minutes`,
                value: (EvaluateOverTimeMinutes as any)[key]!.toString(),
            };
        });
    }

    public static translateFilterToText(
        criteriaFilter: CriteriaFilter,
        filterCondition?: FilterCondition | undefined
    ): string {
        let text: string = 'Check if ';

        // template: the maximum percentage of disk usage on /dev/sda in the past three minutes exceeds 21%.

        const isPercentage: boolean =
            criteriaFilter?.checkOn === CheckOn.CPUUsagePercent ||
            criteriaFilter?.checkOn === CheckOn.DiskUsagePercent ||
            criteriaFilter?.checkOn === CheckOn.MemoryUsagePercent;

        const isMilliseconds: boolean =
            criteriaFilter?.checkOn === CheckOn.ResponseTime;

        // check evaluation over time values.
        if (
            criteriaFilter?.eveluateOverTime &&
            criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType
        ) {
            if (
                criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
                EvaluateOverTimeType.AllValues
            ) {
                text += `all `;
            } else if (
                criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
                EvaluateOverTimeType.AnyValue
            ) {
                text += `any `;
            } else if (
                criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
                EvaluateOverTimeType.Average
            ) {
                text += `average ${isPercentage ? 'percentage ' : ''}value`;
            } else if (
                criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
                EvaluateOverTimeType.MaximumValue
            ) {
                text += `maximum ${isPercentage ? 'percentage ' : ''}value `;
            } else if (
                criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
                EvaluateOverTimeType.MunimumValue
            ) {
                text += `minimum ${isPercentage ? 'percentage ' : ''}value `;
            } else if (
                criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
                EvaluateOverTimeType.Sum
            ) {
                text += `sum of all ${
                    isPercentage ? 'percentage ' : ''
                }values `;
            }
        }

        if (criteriaFilter?.checkOn === CheckOn.JavaScriptExpression) {
            text +=
                'JavaScript expression ' +
                criteriaFilter?.value +
                ' - evaluates to true.';
        } else if (criteriaFilter?.checkOn === CheckOn.IsOnline) {
            if (criteriaFilter?.filterType === FilterType.True) {
                text += 'the resource is online ';
            } else {
                text += 'the resource is offline ';
            }
        } else {
            text += criteriaFilter?.checkOn.toString().toLowerCase() + ' ';

            if (criteriaFilter?.serverMonitorOptions?.diskPath) {
                text +=
                    'on ' +
                    criteriaFilter?.serverMonitorOptions?.diskPath +
                    ' ';
            }

            // add minutes if evaluate over time is true
            if (
                criteriaFilter?.eveluateOverTime &&
                criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
            ) {
                text +=
                    'in the past ' +
                    criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes +
                    ' minutes ';
            }

            // ADD FILTER TYPE - like greater than, less than, etc

            if (criteriaFilter?.filterType) {
                if (
                    criteriaFilter?.filterType
                        .toLowerCase()
                        .includes('contains')
                ) {
                    text +=
                        criteriaFilter?.filterType.toString().toLowerCase() +
                        ' ';
                } else {
                    text +=
                        'is ' +
                        criteriaFilter?.filterType.toString().toLowerCase() +
                        ' ';
                }
            }

            /// FINALLY ADD THE VALUE

            if (criteriaFilter?.value !== undefined) {
                text += `${criteriaFilter?.value.toString()}${
                    isPercentage ? '%' : ''
                }${isMilliseconds ? 'ms' : ''} `;
            }
        }

        if (filterCondition === FilterCondition.All) {
            text += 'and,';
        }

        if (filterCondition === FilterCondition.Any) {
            text += 'or,';
        }

        return text;
    }

    public static getCheckOnOptionsByMonitorType(
        monitorType: MonitorType
    ): Array<DropdownOption> {
        let options: Array<DropdownOption> =
            DropdownUtil.getDropdownOptionsFromEnum(CheckOn);

        if (
            monitorType === MonitorType.Ping ||
            monitorType === MonitorType.IP ||
            monitorType === MonitorType.Port
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IsOnline ||
                    i.value === CheckOn.ResponseTime
                );
            });
        }

        if (monitorType === MonitorType.Server) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IsOnline ||
                    i.value === CheckOn.DiskUsagePercent ||
                    i.value === CheckOn.CPUUsagePercent ||
                    i.value === CheckOn.MemoryUsagePercent ||
                    i.value === CheckOn.ServerProcessCommand ||
                    i.value === CheckOn.ServerProcessName ||
                    i.value === CheckOn.ServerProcessPID
                );
            });
        }

        if (monitorType === MonitorType.SSL) {
            options = options.filter((i: DropdownOption) => {
                return i.value === CheckOn.SSLCertificate;
            });
        }

        if (monitorType === MonitorType.IncomingRequest) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IncomingRequest ||
                    i.value === CheckOn.RequestBody ||
                    i.value === CheckOn.RequestHeader ||
                    i.value === CheckOn.RequestHeaderValue ||
                    i.value === CheckOn.JavaScriptExpression
                );
            });
        }

        if (
            monitorType === MonitorType.Website ||
            monitorType === MonitorType.API
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === CheckOn.IsOnline ||
                    i.value === CheckOn.ResponseTime ||
                    i.value === CheckOn.ResponseBody ||
                    i.value === CheckOn.ResponseHeader ||
                    i.value === CheckOn.ResponseHeaderValue ||
                    i.value === CheckOn.ResponseStatusCode ||
                    i.value === CheckOn.JavaScriptExpression
                );
            });
        }

        return options;
    }

    public static getFilterTypeOptionsByCheckOn(
        checkOn: CheckOn
    ): Array<DropdownOption> {
        let options: Array<DropdownOption> =
            DropdownUtil.getDropdownOptionsFromEnum(FilterType);

        if (!checkOn) {
            return [];
        }

        if (checkOn === CheckOn.ResponseTime) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.GreaterThan ||
                    i.value === FilterType.LessThan ||
                    i.value === FilterType.LessThanOrEqualTo ||
                    i.value === FilterType.GreaterThanOrEqualTo
                );
            });
        }

        if (
            checkOn === CheckOn.CPUUsagePercent ||
            checkOn === CheckOn.DiskUsagePercent ||
            checkOn === CheckOn.MemoryUsagePercent
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.GreaterThan ||
                    i.value === FilterType.LessThan ||
                    i.value === FilterType.LessThanOrEqualTo ||
                    i.value === FilterType.GreaterThanOrEqualTo
                );
            });
        }

        if (
            checkOn === CheckOn.ServerProcessPID ||
            checkOn === CheckOn.ServerProcessCommand ||
            checkOn === CheckOn.ServerProcessName
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.IsExecuting ||
                    i.value === FilterType.IsNotExecuting
                );
            });
        }

        if (checkOn === CheckOn.IncomingRequest) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.NotRecievedInMinutes ||
                    i.value === FilterType.RecievedInMinutes
                );
            });
        }

        if (checkOn === CheckOn.IsOnline) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.True || i.value === FilterType.False
                );
            });
        }

        if (
            checkOn === CheckOn.ResponseBody ||
            checkOn === CheckOn.ResponseHeader ||
            checkOn === CheckOn.ResponseHeaderValue ||
            checkOn === CheckOn.RequestBody ||
            checkOn === CheckOn.RequestHeader ||
            checkOn === CheckOn.RequestHeaderValue
        ) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.Contains ||
                    i.value === FilterType.NotContains
                );
            });
        }

        if (checkOn === CheckOn.JavaScriptExpression) {
            options = options.filter((i: DropdownOption) => {
                return i.value === FilterType.EvaluatesToTrue;
            });
        }

        if (checkOn === CheckOn.ResponseStatusCode) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.GreaterThan ||
                    i.value === FilterType.LessThan ||
                    i.value === FilterType.LessThanOrEqualTo ||
                    i.value === FilterType.GreaterThanOrEqualTo ||
                    i.value === FilterType.EqualTo ||
                    i.value === FilterType.NotEqualTo
                );
            });
        }

        if (checkOn === CheckOn.SSLCertificate) {
            options = options.filter((i: DropdownOption) => {
                return (
                    i.value === FilterType.IsValidCertificate ||
                    i.value === FilterType.IsSelfSignedCertificate ||
                    i.value === FilterType.ExpiresInDays ||
                    i.value === FilterType.ExpiresInHours ||
                    i.value === FilterType.IsExpiredCertificate || 
                    i.value === FilterType.IsNotAValidCertificate
                );
            });
        }

        return options;
    }

    public static hasValueField(data: {
        checkOn: CheckOn;
        filterType?: FilterType | undefined;
    }): boolean {
        const { checkOn, filterType } = data;

        if (checkOn === CheckOn.IsOnline) {
            return false;
        }

        if (checkOn === CheckOn.SSLCertificate) {
            if (
                filterType === FilterType.IsValidCertificate ||
                filterType === FilterType.IsSelfSignedCertificate ||
                filterType === FilterType.IsExpiredCertificate || 
                filterType === FilterType.IsNotAValidCertificate
            ) {
                return false;
            }
        }

        return true;
    }

    public static getFilterTypePlaceholderValueByCheckOn(data: {
        monitorType: MonitorType;
        checkOn: CheckOn;
        filterType?: FilterType | undefined;
    }): string {
        const { monitorType, checkOn, filterType } = data;

        if (!checkOn) {
            return '';
        }

        if (checkOn === CheckOn.ResponseTime) {
            return '5000';
        }

        if (checkOn === CheckOn.ServerProcessPID) {
            return '1234';
        }

        if (checkOn === CheckOn.ServerProcessCommand) {
            return 'node index.js';
        }

        if (checkOn === CheckOn.ServerProcessName) {
            return 'node';
        }

        if (
            checkOn === CheckOn.CPUUsagePercent ||
            checkOn === CheckOn.DiskUsagePercent ||
            checkOn === CheckOn.MemoryUsagePercent
        ) {
            return '65';
        }

        if (checkOn === CheckOn.IncomingRequest) {
            return '5';
        }

        if (
            checkOn === CheckOn.ResponseBody ||
            checkOn === CheckOn.ResponseHeader ||
            checkOn === CheckOn.ResponseHeaderValue ||
            checkOn === CheckOn.RequestBody ||
            checkOn === CheckOn.RequestHeader ||
            checkOn === CheckOn.RequestHeaderValue
        ) {
            return 'Some Text';
        }

        if (checkOn === CheckOn.JavaScriptExpression) {
            if (monitorType === MonitorType.IncomingRequest) {
                return '{{requestBody.result}} === true';
            }
            return '{{responseBody.result}} === true';
        }

        if (checkOn === CheckOn.ResponseStatusCode) {
            return '200';
        }

        if (checkOn === CheckOn.SSLCertificate) {
            if (filterType === FilterType.ExpiresInDays) {
                return '30';
            }
            if (filterType === FilterType.ExpiresInHours) {
                return '24';
            }
        }

        return '';
    }
}
