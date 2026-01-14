import FilterCondition from "Common/Types/Filter/FilterCondition";
import {
  CheckOn,
  CriteriaFilter,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import MonitorType from "Common/Types/Monitor/MonitorType";
import BrowserType from "Common/Types/Monitor/SyntheticMonitors/BrowserType";
import ScreenSizeType from "Common/Types/Monitor/SyntheticMonitors/ScreenSizeType";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import DropdownUtil from "Common/UI/Utils/Dropdown";

export default class CriteriaFilterUtil {
  public static getEvaluateOverTimeMinutesOptions(): Array<DropdownOption> {
    const keys: Array<string> = Object.keys(EvaluateOverTimeMinutes);
    return keys.map((key: string) => {
      return {
        label: `${(EvaluateOverTimeMinutes as any)[key].toString()} Minutes`,
        value: (EvaluateOverTimeMinutes as any)[key]!.toString(),
      };
    });
  }

  public static translateFilterToText(
    criteriaFilter: CriteriaFilter,
    filterCondition?: FilterCondition | undefined,
  ): string {
    let text: string = "Check if ";

    // add metic aggregation type to the text
    if (criteriaFilter?.metricMonitorOptions?.metricAggregationType) {
      text += `${criteriaFilter.metricMonitorOptions.metricAggregationType.toString()} of `;
    }

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
        text += `all values of `;
      } else if (
        criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
        EvaluateOverTimeType.AnyValue
      ) {
        text += `any value of `;
      } else if (
        criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
        EvaluateOverTimeType.Average
      ) {
        text += `average ${isPercentage ? "percentage " : ""}value`;
      } else if (
        criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
        EvaluateOverTimeType.MaximumValue
      ) {
        text += `maximum ${isPercentage ? "percentage " : ""}value `;
      } else if (
        criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
        EvaluateOverTimeType.MunimumValue
      ) {
        text += `minimum ${isPercentage ? "percentage " : ""}value `;
      } else if (
        criteriaFilter.evaluateOverTimeOptions?.evaluateOverTimeType ===
        EvaluateOverTimeType.Sum
      ) {
        text += `sum of all ${isPercentage ? "percentage " : ""}values `;
      }
    }

    if (criteriaFilter?.checkOn === CheckOn.JavaScriptExpression) {
      text +=
        "JavaScript expression " +
        criteriaFilter?.value +
        " - evaluates to true.";
    } else {
      text += `"${criteriaFilter?.checkOn.toString()}" `;

      if (criteriaFilter?.serverMonitorOptions?.diskPath) {
        text += "on " + criteriaFilter?.serverMonitorOptions?.diskPath + " ";
      }

      // add minutes if evaluate over time is true
      if (
        criteriaFilter?.eveluateOverTime &&
        criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes
      ) {
        text +=
          "in the past " +
          criteriaFilter.evaluateOverTimeOptions?.timeValueInMinutes +
          " minutes ";
      }

      // ADD FILTER TYPE - like greater than, less than, etc

      if (criteriaFilter?.filterType) {
        if (criteriaFilter?.filterType.toLowerCase().includes("contains")) {
          text += criteriaFilter?.filterType.toString().toLowerCase() + " ";
        } else {
          text +=
            "is " + criteriaFilter?.filterType.toString().toLowerCase() + " ";
        }
      }

      /// FINALLY ADD THE VALUE

      if (criteriaFilter?.value !== undefined) {
        text += `${criteriaFilter?.value.toString()}${
          isPercentage ? "%" : ""
        }${isMilliseconds ? "ms" : ""} `;
      }
    }

    if (filterCondition === FilterCondition.All) {
      text += "and,";
    }

    if (filterCondition === FilterCondition.Any) {
      text += "or,";
    }

    return text;
  }

  public static getCheckOnOptionsByMonitorType(
    monitorType: MonitorType,
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
          i.value === CheckOn.ResponseTime ||
          i.value === CheckOn.IsRequestTimeout
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

    if (monitorType === MonitorType.CustomJavaScriptCode) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.Error ||
          i.value === CheckOn.ResultValue ||
          i.value === CheckOn.ExecutionTime
        );
      });
    }

    if (monitorType === MonitorType.SyntheticMonitor) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.Error ||
          i.value === CheckOn.ResultValue ||
          i.value === CheckOn.ExecutionTime ||
          i.value === CheckOn.BrowserType ||
          i.value === CheckOn.ScreenSizeType
        );
      });
    }

    if (monitorType === MonitorType.SSLCertificate) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsValidCertificate ||
          i.value === CheckOn.IsSelfSignedCertificate ||
          i.value === CheckOn.IsExpiredCertificate ||
          i.value === CheckOn.IsNotAValidCertificate ||
          i.value === CheckOn.ExpiresInDays ||
          i.value === CheckOn.ExpiresInHours
        );
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

    if (monitorType === MonitorType.IncomingEmail) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.EmailReceivedAt ||
          i.value === CheckOn.EmailSubject ||
          i.value === CheckOn.EmailFrom ||
          i.value === CheckOn.EmailBody ||
          i.value === CheckOn.EmailTo ||
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
          i.value === CheckOn.JavaScriptExpression ||
          i.value === CheckOn.IsRequestTimeout
        );
      });
    }

    if (monitorType === MonitorType.Logs) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.LogCount;
      });
    }

    if (monitorType === MonitorType.Traces) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.SpanCount;
      });
    }

    if (monitorType === MonitorType.Metrics) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.MetricValue;
      });
    }

    if (monitorType === MonitorType.Exceptions) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.ExceptionCount;
      });
    }

    return options;
  }

  public static getFilterTypeOptionsByCheckOn(
    checkOn: CheckOn,
  ): Array<DropdownOption> {
    let options: Array<DropdownOption> =
      DropdownUtil.getDropdownOptionsFromEnum(FilterType);

    if (!checkOn) {
      return [];
    }

    if (checkOn === CheckOn.ResponseTime || checkOn === CheckOn.ExecutionTime) {
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
      checkOn === CheckOn.LogCount ||
      checkOn === CheckOn.SpanCount ||
      checkOn === CheckOn.MetricValue
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo
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

    if (checkOn === CheckOn.EmailReceivedAt) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.NotRecievedInMinutes ||
          i.value === FilterType.RecievedInMinutes
        );
      });
    }

    if (
      checkOn === CheckOn.EmailSubject ||
      checkOn === CheckOn.EmailFrom ||
      checkOn === CheckOn.EmailBody ||
      checkOn === CheckOn.EmailTo
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty
        );
      });
    }

    if (checkOn === CheckOn.IsOnline || checkOn === CheckOn.IsRequestTimeout) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
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
          i.value === FilterType.Contains || i.value === FilterType.NotContains
        );
      });
    }

    if (checkOn === CheckOn.ResultValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.BrowserType || checkOn === CheckOn.ScreenSizeType) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo || i.value === FilterType.NotEqualTo
        );
      });
    }

    if (checkOn === CheckOn.Error) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.IsEmpty ||
          i.value === FilterType.IsNotEmpty
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

    if (
      checkOn === CheckOn.IsValidCertificate ||
      checkOn === CheckOn.IsSelfSignedCertificate ||
      checkOn === CheckOn.IsExpiredCertificate ||
      checkOn === CheckOn.IsNotAValidCertificate
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.ExpiresInDays ||
      checkOn === CheckOn.ExpiresInHours
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

    return options;
  }

  public static isDropdownValueField(data: {
    checkOn?: CheckOn | undefined;
  }): boolean {
    const { checkOn } = data;

    if (checkOn === CheckOn.ScreenSizeType || checkOn === CheckOn.BrowserType) {
      return true;
    }

    return false;
  }

  public static getDropdownOptionsByCheckOn(data: {
    checkOn: CheckOn;
  }): Array<DropdownOption> {
    const { checkOn } = data;

    if (checkOn === CheckOn.ScreenSizeType) {
      return DropdownUtil.getDropdownOptionsFromEnum(ScreenSizeType);
    }

    if (checkOn === CheckOn.BrowserType) {
      return DropdownUtil.getDropdownOptionsFromEnum(BrowserType);
    }

    return [];
  }

  public static getFilterTypePlaceholderValueByCheckOn(data: {
    monitorType: MonitorType;
    checkOn: CheckOn;
  }): string {
    const { monitorType, checkOn } = data;

    if (!checkOn) {
      return "";
    }

    if (checkOn === CheckOn.ResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.ServerProcessPID) {
      return "1234";
    }

    if (checkOn === CheckOn.LogCount) {
      return "1";
    }

    if (checkOn === CheckOn.ServerProcessCommand) {
      return "node index.js";
    }

    if (checkOn === CheckOn.ServerProcessName) {
      return "node";
    }

    if (
      checkOn === CheckOn.CPUUsagePercent ||
      checkOn === CheckOn.DiskUsagePercent ||
      checkOn === CheckOn.MemoryUsagePercent
    ) {
      return "65";
    }

    if (checkOn === CheckOn.IncomingRequest) {
      return "5";
    }

    if (checkOn === CheckOn.EmailReceivedAt) {
      return "5";
    }

    if (checkOn === CheckOn.EmailSubject) {
      return "Alert: Server Down";
    }

    if (checkOn === CheckOn.EmailFrom) {
      return "alerts@example.com";
    }

    if (checkOn === CheckOn.EmailBody) {
      return "Error occurred";
    }

    if (checkOn === CheckOn.EmailTo) {
      return "monitor@inbound.oneuptime.com";
    }

    if (
      checkOn === CheckOn.ResponseBody ||
      checkOn === CheckOn.ResponseHeader ||
      checkOn === CheckOn.ResponseHeaderValue ||
      checkOn === CheckOn.RequestBody ||
      checkOn === CheckOn.RequestHeader ||
      checkOn === CheckOn.RequestHeaderValue
    ) {
      return "Some Text";
    }

    if (checkOn === CheckOn.JavaScriptExpression) {
      if (monitorType === MonitorType.IncomingRequest) {
        return "{{requestBody.result}} === true";
      }
      return "{{responseBody.result}} === true";
    }

    if (checkOn === CheckOn.ResponseStatusCode) {
      return "200";
    }

    if (checkOn === CheckOn.ExpiresInDays) {
      return "30";
    }

    if (checkOn === CheckOn.ExpiresInHours) {
      return "24";
    }

    return "";
  }
}
