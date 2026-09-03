import FilterCondition from "Common/Types/Filter/FilterCondition";
import {
  AnomalyDetectionSensitivity,
  CheckOn,
  CriteriaFilter,
  CriteriaFilterUtil as CommonCriteriaFilterUtil,
  EvaluateOverTimeMinutes,
  EvaluateOverTimeType,
  FilterType,
} from "Common/Types/Monitor/CriteriaFilter";
import {
  DatabaseMetricDefinition,
  getDatabaseMetricByMetricType,
} from "Common/Types/Monitor/DatabaseMetricCatalog";
import MonitorType, {
  MonitorTypeHelper,
} from "Common/Types/Monitor/MonitorType";
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
      criteriaFilter?.checkOn === CheckOn.MemoryUsagePercent ||
      criteriaFilter?.checkOn === CheckOn.SwapUsagePercent ||
      criteriaFilter?.checkOn === CheckOn.CPUIoWaitPercent ||
      criteriaFilter?.checkOn === CheckOn.PacketLossPercent ||
      criteriaFilter?.checkOn === CheckOn.SnmpInterfaceUtilizationPercent;

    const isMilliseconds: boolean =
      criteriaFilter?.checkOn === CheckOn.ResponseTime ||
      criteriaFilter?.checkOn === CheckOn.Jitter ||
      criteriaFilter?.checkOn === CheckOn.PortDnsLookupTime ||
      criteriaFilter?.checkOn === CheckOn.PortTcpConnectTime;

    /*
     * A Database Health filter names its series in databaseMonitorOptions,
     * not in the check, so its unit is per-metric - the same check reads a
     * percentage, a byte count or a number of seconds depending on which
     * metric was picked. The catalog is the only place that knows which,
     * which is also why "Database Metric" is deliberately absent from the
     * two flat lists above: they would label a byte count a percentage.
     */
    const databaseMetric: DatabaseMetricDefinition | null =
      criteriaFilter?.checkOn === CheckOn.DatabaseMetric &&
      criteriaFilter?.databaseMonitorOptions?.metricType
        ? getDatabaseMetricByMetricType(
            criteriaFilter.databaseMonitorOptions.metricType,
          )
        : null;

    // check evaluation over time values.
    if (
      criteriaFilter?.evaluateOverTime &&
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

    /*
     * Anomaly criteria don't use the static threshold value field.
     * Render them as plain English so the rule list reads cleanly.
     */
    if (
      CommonCriteriaFilterUtil.isAnomalyFilterType(criteriaFilter?.filterType)
    ) {
      const sensitivity: AnomalyDetectionSensitivity =
        (criteriaFilter?.metricMonitorOptions?.anomalyDetection?.sensitivity as
          | AnomalyDetectionSensitivity
          | undefined) || AnomalyDetectionSensitivity.Medium;
      const windowDays: number =
        criteriaFilter?.metricMonitorOptions?.anomalyDetection?.windowDays ||
        14;
      const direction: string =
        criteriaFilter?.filterType === FilterType.AnomalouslyHigh
          ? "anomalously high"
          : criteriaFilter?.filterType === FilterType.AnomalouslyLow
            ? "anomalously low"
            : "anomalous (either direction)";
      text += `"${criteriaFilter?.checkOn.toString()}" is ${direction} (sensitivity: ${sensitivity}, baseline window: ${windowDays} days)`;
      if (filterCondition === FilterCondition.All) {
        text += " and,";
      }
      if (filterCondition === FilterCondition.Any) {
        text += " or,";
      }
      return text;
    }

    if (criteriaFilter?.checkOn === CheckOn.JavaScriptExpression) {
      text +=
        "JavaScript expression " +
        criteriaFilter?.value +
        " - evaluates to true.";
    } else {
      /*
       * Name the metric rather than the check: "Database Metric is greater
       * than 90" says nothing about what is being measured, and every
       * database filter would read identically in the criteria list.
       */
      const checkOnLabel: string =
        databaseMetric?.friendlyName || criteriaFilter?.checkOn.toString();

      text += `"${checkOnLabel}" `;

      if (criteriaFilter?.serverMonitorOptions?.diskPath) {
        text += "on " + criteriaFilter?.serverMonitorOptions?.diskPath + " ";
      }

      if (criteriaFilter?.snmpMonitorOptions?.interfaceName) {
        text +=
          "on interface " +
          criteriaFilter?.snmpMonitorOptions?.interfaceName +
          " ";
      }

      // add minutes if evaluate over time is true
      if (
        criteriaFilter?.evaluateOverTime &&
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
        const thresholdUnitSuffix: string =
          criteriaFilter?.checkOn === CheckOn.MetricValue &&
          criteriaFilter?.metricMonitorOptions?.thresholdUnit
            ? ` ${criteriaFilter.metricMonitorOptions.thresholdUnit}`
            : "";

        const databaseUnitSuffix: string = databaseMetric?.unit
          ? ` ${databaseMetric.unit}`
          : "";

        text += `${criteriaFilter?.value.toString()}${
          isPercentage ? "%" : ""
        }${isMilliseconds ? "ms" : ""}${thresholdUnitSuffix}${databaseUnitSuffix} `;
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

    /*
     * Manual monitors have no criteria at all. Nothing polls them - their
     * status is set by hand - and MonitorCriteriaEvaluator has no branch
     * for the type, so no check would ever be evaluated. That is what
     * MonitorTypeHelper.doesMonitorTypeHaveCriteria records, and it is why
     * the Criteria page renders an empty state in place of this form.
     * Offering the whole CheckOn enum here would be offering rules that
     * can never fire.
     */
    if (!MonitorTypeHelper.doesMonitorTypeHaveCriteria(monitorType)) {
      return [];
    }

    if (monitorType === MonitorType.Ping || monitorType === MonitorType.IP) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.ResponseTime ||
          i.value === CheckOn.PacketLossPercent ||
          i.value === CheckOn.Jitter ||
          i.value === CheckOn.IsRequestTimeout
        );
      });
    }

    if (monitorType === MonitorType.Port) {
      options = options
        .filter((i: DropdownOption) => {
          return (
            i.value === CheckOn.IsOnline ||
            i.value === CheckOn.ResponseTime ||
            i.value === CheckOn.PortDnsLookupTime ||
            i.value === CheckOn.PortTcpConnectTime ||
            i.value === CheckOn.IsRequestTimeout
          );
        })
        .map((i: DropdownOption) => {
          if (i.value === CheckOn.ResponseTime) {
            return {
              ...i,
              label: "Total Connection Time (DNS + TCP) (in ms)",
            };
          }

          return i;
        });
    }

    if (monitorType === MonitorType.Server) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.DiskUsagePercent ||
          i.value === CheckOn.CPUUsagePercent ||
          i.value === CheckOn.MemoryUsagePercent ||
          i.value === CheckOn.LoadAverage1Min ||
          i.value === CheckOn.LoadAverage5Min ||
          i.value === CheckOn.LoadAverage15Min ||
          i.value === CheckOn.SwapUsagePercent ||
          i.value === CheckOn.CPUIoWaitPercent ||
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

    if (monitorType === MonitorType.SecurityEvents) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.SecurityEventCount;
      });
    }

    if (monitorType === MonitorType.Traces) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.SpanCount;
      });
    }

    /*
     * Every monitor type whose criteria the server hands to
     * MetricMonitorCriteria: the metric-only types this form already pins
     * to CheckOn.MetricValue (Metrics, Kubernetes, and the infrastructure
     * types Docker / Host / Podman / Docker Swarm / Proxmox / Ceph), plus
     * IoT Device, which MonitorCriteriaEvaluator routes down the same path
     * but which is not metric-only here, so it still draws the full
     * criteria UI. All of them alert on one thing - an ingested metric.
     */
    if (
      CriteriaFilterUtil.isMetricOnlyMonitorType(monitorType) ||
      monitorType === MonitorType.IoTDevice
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.MetricValue;
      });
    }

    if (monitorType === MonitorType.Exceptions) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.ExceptionCount;
      });
    }

    if (monitorType === MonitorType.Profiles) {
      options = options.filter((i: DropdownOption) => {
        return i.value === CheckOn.ProfileCount;
      });
    }

    if (monitorType === MonitorType.NetworkDevice) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.SnmpIsOnline ||
          i.value === CheckOn.SnmpResponseTime ||
          i.value === CheckOn.SnmpOidValue ||
          i.value === CheckOn.SnmpOidExists ||
          i.value === CheckOn.SnmpInterfaceIsDown ||
          i.value === CheckOn.SnmpInterfaceUtilizationPercent ||
          i.value === CheckOn.SnmpInterfaceErrorsPerSecond ||
          i.value === CheckOn.SnmpTrapReceived
        );
      });
    }

    if (monitorType === MonitorType.DNS) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.DnsIsOnline ||
          i.value === CheckOn.DnsResponseTime ||
          i.value === CheckOn.DnsRecordValue ||
          i.value === CheckOn.DnssecIsValid ||
          i.value === CheckOn.DnsRecordExists
        );
      });
    }

    if (monitorType === MonitorType.Domain) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.IsOnline ||
          i.value === CheckOn.IsRequestTimeout ||
          i.value === CheckOn.DomainExpiresDaysIn ||
          i.value === CheckOn.DomainRegistrar ||
          i.value === CheckOn.DomainNameServer ||
          i.value === CheckOn.DomainStatusCode ||
          i.value === CheckOn.DomainIsExpired
        );
      });
    }

    if (monitorType === MonitorType.DNSSEC) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.DnssecChainValid ||
          i.value === CheckOn.DnssecDnskeyExists ||
          i.value === CheckOn.DnssecDsExists ||
          i.value === CheckOn.DnssecResolverConsensus ||
          i.value === CheckOn.DnssecNameserverConsistent ||
          i.value === CheckOn.DnssecSignatureExpiresInDays
        );
      });
    }

    if (monitorType === MonitorType.SQLQuery) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.SqlIsOnline ||
          i.value === CheckOn.SqlQueryRowCount ||
          i.value === CheckOn.SqlQueryScalarValue ||
          i.value === CheckOn.SqlQueryExecutionTime ||
          i.value === CheckOn.SqlQueryError ||
          i.value === CheckOn.JavaScriptExpression
        );
      });
    }

    /*
     * Every collected series is reachable through the one DatabaseMetric
     * check, which names it in databaseMonitorOptions.metricType - the same
     * shape as SnmpOidValue and its OID. A check per metric would put forty
     * entries in this dropdown and forty branches in the evaluator.
     */
    if (monitorType === MonitorType.Database) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.DatabaseIsOnline ||
          i.value === CheckOn.DatabaseMetric ||
          i.value === CheckOn.DatabaseCollectionError ||
          i.value === CheckOn.JavaScriptExpression
        );
      });
    }

    if (monitorType === MonitorType.ExternalStatusPage) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === CheckOn.ExternalStatusPageIsOnline ||
          i.value === CheckOn.ExternalStatusPageOverallStatus ||
          i.value === CheckOn.ExternalStatusPageComponentStatus ||
          i.value === CheckOn.ExternalStatusPageActiveIncidents ||
          i.value === CheckOn.ExternalStatusPageResponseTime
        );
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

    if (
      checkOn === CheckOn.ResponseTime ||
      checkOn === CheckOn.ExecutionTime ||
      checkOn === CheckOn.PacketLossPercent ||
      checkOn === CheckOn.Jitter ||
      checkOn === CheckOn.PortDnsLookupTime ||
      checkOn === CheckOn.PortTcpConnectTime
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
      checkOn === CheckOn.LogCount ||
      checkOn === CheckOn.SpanCount ||
      checkOn === CheckOn.SecurityEventCount ||
      checkOn === CheckOn.MetricValue
    ) {
      /*
       * Span/log counts also support the baseline anomaly filters — the
       * server evaluators (TraceMonitorCriteria / LogMonitorCriteria)
       * compare the observed per-minute rate to the monitor's scope in
       * the same-hour-of-week SpanCountBaseline / LogCountBaseline,
       * mirroring the Metric monitor path. Security events have no
       * volume baseline yet, so they keep the static comparators only.
       */
      const allowAnomaly: boolean =
        checkOn === CheckOn.MetricValue ||
        checkOn === CheckOn.LogCount ||
        checkOn === CheckOn.SpanCount;
      options = options.filter((i: DropdownOption) => {
        const baseStatic: boolean =
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo;
        const baseAnomaly: boolean =
          allowAnomaly &&
          (i.value === FilterType.AnomalouslyHigh ||
            i.value === FilterType.AnomalouslyLow ||
            i.value === FilterType.Anomalous);
        return baseStatic || baseAnomaly;
      });
    }

    if (
      checkOn === CheckOn.ExceptionCount ||
      checkOn === CheckOn.ProfileCount
    ) {
      /*
       * Exception and profile counts are whole numbers the server decides
       * on with CompareCriteria.compareCriteriaNumbers
       * (ExceptionMonitorCriteria / ProfileMonitorCriteria). That
       * comparator recognises exactly these six conditions and returns
       * "no match" for every other filter type, so anything else offered
       * here would let the user save a rule that silently never fires.
       *
       * Unlike log and span counts, neither of these has a volume
       * baseline behind it - there is no ExceptionCountBaseline or
       * ProfileCountBaseline and no anomaly branch in either evaluator -
       * so the anomaly conditions stay off this list too.
       */
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
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
      checkOn === CheckOn.MemoryUsagePercent ||
      checkOn === CheckOn.SwapUsagePercent ||
      checkOn === CheckOn.CPUIoWaitPercent ||
      checkOn === CheckOn.LoadAverage1Min ||
      checkOn === CheckOn.LoadAverage5Min ||
      checkOn === CheckOn.LoadAverage15Min
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

    if (
      checkOn === CheckOn.SnmpIsOnline ||
      checkOn === CheckOn.SnmpOidExists ||
      checkOn === CheckOn.SnmpInterfaceIsDown
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      checkOn === CheckOn.SnmpInterfaceErrorsPerSecond
    ) {
      /*
       * Utilization also supports the baseline anomaly filters — the
       * server evaluator (SnmpMonitorCriteria) compares the busiest
       * in-scope interface to this monitor's same-hour-of-week baseline
       * via MetricBaselineService, mirroring the Metric monitor path.
       * Errors/sec has no baselined metric evaluation yet, so it keeps
       * the static comparators only.
       */
      const allowAnomaly: boolean =
        checkOn === CheckOn.SnmpInterfaceUtilizationPercent;
      options = options.filter((i: DropdownOption) => {
        const baseStatic: boolean =
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo;
        const baseAnomaly: boolean =
          allowAnomaly &&
          (i.value === FilterType.AnomalouslyHigh ||
            i.value === FilterType.AnomalouslyLow ||
            i.value === FilterType.Anomalous);
        return baseStatic || baseAnomaly;
      });
    }

    if (checkOn === CheckOn.SnmpTrapReceived) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (
      checkOn === CheckOn.DnsIsOnline ||
      checkOn === CheckOn.DnssecIsValid ||
      checkOn === CheckOn.DnsRecordExists
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.DnsResponseTime) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.DnsRecordValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (checkOn === CheckOn.SnmpResponseTime) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.SnmpOidValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.LessThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.DomainExpiresDaysIn) {
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
      checkOn === CheckOn.DomainRegistrar ||
      checkOn === CheckOn.DomainNameServer ||
      checkOn === CheckOn.DomainStatusCode
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (checkOn === CheckOn.DomainIsExpired) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.DnssecChainValid ||
      checkOn === CheckOn.DnssecDnskeyExists ||
      checkOn === CheckOn.DnssecDsExists ||
      checkOn === CheckOn.DnssecResolverConsensus ||
      checkOn === CheckOn.DnssecNameserverConsistent
    ) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.DnssecSignatureExpiresInDays) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.SqlIsOnline) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (
      checkOn === CheckOn.SqlQueryRowCount ||
      checkOn === CheckOn.SqlQueryExecutionTime
    ) {
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

    if (checkOn === CheckOn.SqlQueryScalarValue) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    if (checkOn === CheckOn.SqlQueryError) {
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

    if (checkOn === CheckOn.DatabaseIsOnline) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.DatabaseMetric) {
      /*
       * Listed in reading order instead of being filtered out of the enum,
       * because the default a new filter opens on is options[0] and a
       * database metric is a measurement: "connections used equal to 90" is
       * almost never the rule anyone means. Equality still has to be
       * offered - "replicas connected equal to 0" is a real alert.
       */
      options = [
        FilterType.GreaterThan,
        FilterType.LessThan,
        FilterType.GreaterThanOrEqualTo,
        FilterType.LessThanOrEqualTo,
        FilterType.EqualTo,
        FilterType.NotEqualTo,
      ].map((filterType: FilterType): DropdownOption => {
        return {
          label: filterType.toString(),
          value: filterType,
        };
      });
    }

    if (checkOn === CheckOn.DatabaseCollectionError) {
      /*
       * Ordered for the same reason: the rule worth writing about a
       * collection error is "there is one at all", so Is Not Empty leads
       * even though FilterType declares Is Empty first.
       */
      options = [
        FilterType.IsNotEmpty,
        FilterType.IsEmpty,
        FilterType.Contains,
        FilterType.NotContains,
      ].map((filterType: FilterType): DropdownOption => {
        return {
          label: filterType.toString(),
          value: filterType,
        };
      });
    }

    if (checkOn === CheckOn.ExternalStatusPageIsOnline) {
      options = options.filter((i: DropdownOption) => {
        return i.value === FilterType.True || i.value === FilterType.False;
      });
    }

    if (checkOn === CheckOn.ExternalStatusPageResponseTime) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (checkOn === CheckOn.ExternalStatusPageActiveIncidents) {
      /*
       * Active incidents is a whole-number count, not a measurement, so
       * "is exactly N" reads naturally - "no active incidents" is the
       * out-of-the-box online criteria and it is written as Equal To 0.
       * Leaving Equal To / Not Equal To off this list is what left that
       * seeded criteria showing an empty Filter Condition dropdown: the
       * stored filter type was not among the options the dropdown could
       * render. The server evaluates this check with
       * CompareCriteria.compareCriteriaNumbers, which handles both.
       */
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.GreaterThan ||
          i.value === FilterType.LessThan ||
          i.value === FilterType.LessThanOrEqualTo ||
          i.value === FilterType.GreaterThanOrEqualTo
        );
      });
    }

    if (
      checkOn === CheckOn.ExternalStatusPageOverallStatus ||
      checkOn === CheckOn.ExternalStatusPageComponentStatus
    ) {
      options = options.filter((i: DropdownOption) => {
        return (
          i.value === FilterType.Contains ||
          i.value === FilterType.NotContains ||
          i.value === FilterType.EqualTo ||
          i.value === FilterType.NotEqualTo ||
          i.value === FilterType.StartsWith ||
          i.value === FilterType.EndsWith
        );
      });
    }

    return options;
  }

  /*
   * The filter condition a brand new filter should start on for a given
   * "check on".
   *
   * Every filter the form hands the user has to arrive with a condition
   * already chosen. A filter with no condition is not just untidy - the
   * server's comparators switch on the filter type and return "no match"
   * for anything they do not recognise, so a criteria carrying a blank
   * condition silently never fires, and the empty dropdown is easy to
   * miss when every field around it is filled in.
   *
   * The first option offered for the check is that default. The option
   * lists above are written in FilterType declaration order, and each is
   * already led by the condition that reads as the natural starting
   * point for its kind of check - True for booleans, Greater Than for
   * measurements, Contains for free text, Equal To for counts and
   * enumerated values, Evaluates To True for JavaScript expressions.
   * Deriving it keeps the default correct by construction: reorder or
   * extend a list and the default follows it.
   */
  public static getDefaultFilterTypeByCheckOn(
    checkOn: CheckOn,
  ): FilterType | undefined {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(checkOn);

    return options[0]?.value as FilterType | undefined;
  }

  /*
   * Keep the filter type the user already chose when it still applies to
   * the check being switched to, otherwise fall back to that check's
   * default. Used wherever `checkOn` changes underneath an existing
   * filter so the condition dropdown is never left showing nothing.
   */
  public static getFilterTypeOrDefault(data: {
    checkOn: CheckOn;
    filterType?: FilterType | undefined;
  }): FilterType | undefined {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getFilterTypeOptionsByCheckOn(data.checkOn);

    const isStillValid: boolean = options.some((option: DropdownOption) => {
      return option.value === data.filterType;
    });

    if (isStillValid) {
      return data.filterType;
    }

    return options[0]?.value as FilterType | undefined;
  }

  /*
   * The "check on" a brand new filter should start on for a monitor type.
   *
   * Prefer the up/down check (or the metric value, on monitor types that
   * only alert on metrics) because that is the check most people reach
   * for first, but only when the monitor type actually offers it - most
   * of the protocol-specific types (DNS, SNMP, SQL, External Status Page,
   * telemetry...) do not, and seeding a check they never offer leaves the
   * Filter Type dropdown blank too. Fall back to the first check the type
   * does offer.
   */
  public static getDefaultCheckOnByMonitorType(
    monitorType: MonitorType,
  ): CheckOn | undefined {
    const options: Array<DropdownOption> =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType);

    const preferredCheckOn: CheckOn =
      CriteriaFilterUtil.isMetricOnlyMonitorType(monitorType)
        ? CheckOn.MetricValue
        : CheckOn.IsOnline;

    const isPreferredOffered: boolean = options.some(
      (option: DropdownOption) => {
        return option.value === preferredCheckOn;
      },
    );

    if (isPreferredOffered) {
      return preferredCheckOn;
    }

    return options[0]?.value as CheckOn | undefined;
  }

  /*
   * Monitor types whose criteria are expressed purely as metric
   * thresholds. Their criteria form hides the "Filter Type" dropdown
   * entirely and pins every filter to CheckOn.MetricValue.
   */
  public static isMetricOnlyMonitorType(monitorType: MonitorType): boolean {
    return (
      monitorType === MonitorType.Kubernetes ||
      monitorType === MonitorType.Docker ||
      monitorType === MonitorType.Host ||
      monitorType === MonitorType.Podman ||
      monitorType === MonitorType.DockerSwarm ||
      monitorType === MonitorType.Proxmox ||
      monitorType === MonitorType.Ceph ||
      monitorType === MonitorType.Metrics
    );
  }

  /*
   * A complete, immediately usable filter for a monitor type - both
   * dropdowns pre-selected. This is what "Add Filter" and "Add Criteria"
   * seed, so a newly added rule is valid the moment it appears instead of
   * waiting on the user to notice an empty dropdown.
   */
  public static getDefaultCriteriaFilter(
    monitorType: MonitorType,
  ): CriteriaFilter {
    const checkOn: CheckOn =
      CriteriaFilterUtil.getDefaultCheckOnByMonitorType(monitorType) ||
      CheckOn.IsOnline;

    const criteriaFilter: CriteriaFilter = {
      checkOn: checkOn,
      filterType: CriteriaFilterUtil.getDefaultFilterTypeByCheckOn(checkOn),
      value: "",
    };

    if (checkOn === CheckOn.MetricValue) {
      criteriaFilter.metricMonitorOptions = {
        metricAggregationType: EvaluateOverTimeType.AnyValue,
      };
    }

    return criteriaFilter;
  }

  /*
   * Bring a filter that was written against one monitor type back to
   * something the criteria form for `monitorType` can actually draw, or
   * report that it cannot be brought back at all.
   *
   * Monitor type and criteria live on different steps of the create form,
   * so a user can seed criteria for a Website, walk back a step, and pick
   * External Status Page instead. The filters they already have then name
   * checks the new type never offers, and both dropdowns render react-
   * select's empty "Select..." placeholder over a rule the server would
   * never match.
   *
   * Repair the smallest thing that is broken:
   *
   *   - check still offered, condition still offered: leave the filter
   *     alone entirely, down to object identity, so callers can tell
   *     "nothing to do" from "repaired" without a deep compare.
   *   - check still offered, condition no longer is: keep the check and
   *     the value the user typed and move the condition to that check's
   *     default. Only reachable for filters stored before a check's
   *     condition list was corrected, and the check still pins what the
   *     rule means, so the meaning survives.
   *   - check no longer offered: return null. The rule cannot be
   *     expressed for this monitor type at all, and the caller has to
   *     decide what to put in its place.
   *
   * Returning null rather than this monitor type's default filter is the
   * whole point. That default is a positive, immediately-firing rule
   * ("is online / True"), so substituting it in place of, say, "is online
   * is False" INVERTS the rule while leaving the criteria's name, its
   * "create incident" flag and its offline monitor status untouched - a
   * criteria that used to fire when the target was down would fire while
   * it was healthy, and open an incident saying it was offline. A stale
   * filter at least failed safe by never matching; a fabricated one does
   * not. Deciding a replacement needs the whole criteria for context, so
   * that decision belongs to the caller, not here.
   */
  public static repairCriteriaFilterForMonitorType(data: {
    criteriaFilter: CriteriaFilter;
    monitorType: MonitorType;
  }): CriteriaFilter | null {
    const { criteriaFilter, monitorType } = data;

    const isCheckOnOffered: boolean =
      CriteriaFilterUtil.getCheckOnOptionsByMonitorType(monitorType).some(
        (option: DropdownOption) => {
          return option.value === criteriaFilter.checkOn;
        },
      );

    if (!isCheckOnOffered) {
      return null;
    }

    const filterType: FilterType | undefined =
      CriteriaFilterUtil.getFilterTypeOrDefault({
        checkOn: criteriaFilter.checkOn,
        filterType: criteriaFilter.filterType,
      });

    if (filterType === criteriaFilter.filterType) {
      return criteriaFilter;
    }

    return {
      ...criteriaFilter,
      filterType: filterType,
    };
  }

  public static isDropdownValueField(data: {
    checkOn?: CheckOn | undefined;
  }): boolean {
    const { checkOn } = data;

    if (
      checkOn === CheckOn.ScreenSizeType ||
      checkOn === CheckOn.BrowserType ||
      checkOn === CheckOn.ExternalStatusPageComponentStatus
    ) {
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

    if (checkOn === CheckOn.ExternalStatusPageComponentStatus) {
      /*
       * Canonical component status values reported by external status page
       * providers (Atlassian Statuspage, incident.io, etc.). The stored value
       * remains the provider's snake_case string so criteria evaluation is
       * unaffected; only the user-facing label is friendly.
       */
      return [
        { label: "Operational", value: "operational" },
        { label: "Under Maintenance", value: "under_maintenance" },
        { label: "Degraded Performance", value: "degraded_performance" },
        { label: "Partial Outage", value: "partial_outage" },
        { label: "Major Outage", value: "major_outage" },
        { label: "Full Outage", value: "full_outage" },
      ];
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

    if (
      checkOn === CheckOn.PortDnsLookupTime ||
      checkOn === CheckOn.PortTcpConnectTime
    ) {
      return "1000";
    }

    if (checkOn === CheckOn.PacketLossPercent) {
      return "2";
    }

    if (checkOn === CheckOn.Jitter) {
      return "30";
    }

    if (checkOn === CheckOn.ServerProcessPID) {
      return "1234";
    }

    if (checkOn === CheckOn.LogCount) {
      return "1";
    }

    if (checkOn === CheckOn.SecurityEventCount) {
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

    if (checkOn === CheckOn.SwapUsagePercent) {
      return "10";
    }

    if (checkOn === CheckOn.CPUIoWaitPercent) {
      return "20";
    }

    if (
      checkOn === CheckOn.LoadAverage1Min ||
      checkOn === CheckOn.LoadAverage5Min ||
      checkOn === CheckOn.LoadAverage15Min
    ) {
      return "2";
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
      if (monitorType === MonitorType.SQLQuery) {
        return "{{scalarValue}} > 50";
      }
      if (monitorType === MonitorType.Database) {
        return "{{metrics['oneuptime.monitor.database.connections.used.percent']}} > 90";
      }
      return "{{responseBody.result}} === true";
    }

    if (checkOn === CheckOn.SqlQueryRowCount) {
      return "0";
    }

    if (checkOn === CheckOn.SqlQueryScalarValue) {
      return "50";
    }

    if (checkOn === CheckOn.SqlQueryExecutionTime) {
      return "5000";
    }

    if (checkOn === CheckOn.SqlQueryError) {
      return "connection refused";
    }

    if (checkOn === CheckOn.DatabaseMetric) {
      return "90";
    }

    if (checkOn === CheckOn.DatabaseCollectionError) {
      // The group name or the grant named in the collection issue.
      return "pg_monitor";
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

    if (checkOn === CheckOn.SnmpResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.SnmpOidValue) {
      return "1";
    }

    if (checkOn === CheckOn.SnmpInterfaceUtilizationPercent) {
      return "80";
    }

    if (checkOn === CheckOn.SnmpInterfaceErrorsPerSecond) {
      return "1";
    }

    if (checkOn === CheckOn.SnmpTrapReceived) {
      // linkDown
      return "1.3.6.1.6.3.1.1.5.3";
    }

    if (checkOn === CheckOn.DnsResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.DnsRecordValue) {
      return "192.168.1.1";
    }

    if (checkOn === CheckOn.DomainExpiresDaysIn) {
      return "30";
    }

    if (checkOn === CheckOn.DomainRegistrar) {
      return "GoDaddy";
    }

    if (checkOn === CheckOn.DomainNameServer) {
      return "ns1.example.com";
    }

    if (checkOn === CheckOn.DomainStatusCode) {
      return "clientTransferProhibited";
    }

    if (checkOn === CheckOn.DnssecSignatureExpiresInDays) {
      return "7";
    }

    if (checkOn === CheckOn.ExternalStatusPageResponseTime) {
      return "5000";
    }

    if (checkOn === CheckOn.ExternalStatusPageOverallStatus) {
      return "operational";
    }

    if (checkOn === CheckOn.ExternalStatusPageComponentStatus) {
      return "operational";
    }

    if (checkOn === CheckOn.ExternalStatusPageActiveIncidents) {
      return "0";
    }

    return "";
  }
}
