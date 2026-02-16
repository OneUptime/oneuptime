import Zod, { ZodSchema } from "../../Utils/Schema/Zod";

export enum CheckOn {
  ResponseTime = "Response Time (in ms)",
  ResponseStatusCode = "Response Status Code",
  ResponseHeader = "Response Header",
  ResponseHeaderValue = "Response Header Value",
  ResponseBody = "Response Body",
  IsOnline = "Is Online",
  IncomingRequest = "Incoming Request",
  ServerProcessName = "Server Process Name",
  ServerProcessCommand = "Server Process Command",
  ServerProcessPID = "Server Process PID",
  RequestBody = "Request Body",
  RequestHeader = "Request Header",
  RequestHeaderValue = "Request Header Value",
  JavaScriptExpression = "JavaScript Expression",
  DiskUsagePercent = "Disk Usage (in %)",
  CPUUsagePercent = "CPU Usage (in %)",
  MemoryUsagePercent = "Memory Usage (in %)",
  ExpiresInHours = "Expires In Hours",
  ExpiresInDays = "Expires In Days",
  IsSelfSignedCertificate = "Is Self Signed Certificate",
  IsExpiredCertificate = "Is Expired Certificate",
  IsValidCertificate = "Is Valid Certificate",
  IsNotAValidCertificate = "Is Not A Valid Certificate",
  IsRequestTimeout = "Is Request Timeout",

  // Custom code or synthetic monitor.
  ResultValue = "Result Value",
  Error = "Error",
  ExecutionTime = "Execution Time (in ms)",

  // synthetic monitors

  ScreenSizeType = "Screen Size",
  BrowserType = "Browser Type",

  // Log monitors.
  LogCount = "Log Count",

  // Trace monitors.
  SpanCount = "Span Count",

  // Exception monitors.
  ExceptionCount = "Exception Count",

  // Metric Monitors.
  MetricValue = "Metric Value",

  // Incoming Email monitors.
  EmailSubject = "Email Subject",
  EmailFrom = "Email From Address",
  EmailBody = "Email Body",
  EmailTo = "Email To Address",
  EmailReceivedAt = "Email Received",

  // SNMP monitors.
  SnmpOidValue = "SNMP OID Value",
  SnmpOidExists = "SNMP OID Exists",
  SnmpResponseTime = "SNMP Response Time (in ms)",
  SnmpIsOnline = "SNMP Device Is Online",

  // DNS monitors.
  DnsResponseTime = "DNS Response Time (in ms)",
  DnsIsOnline = "DNS Is Online",
  DnsRecordValue = "DNS Record Value",
  DnssecIsValid = "DNSSEC Is Valid",
  DnsRecordExists = "DNS Record Exists",

  // Domain monitors.
  DomainExpiresDaysIn = "Domain Expires In Days",
  DomainRegistrar = "Domain Registrar",
  DomainNameServer = "Domain Name Server",
  DomainStatusCode = "Domain Status Code",
  DomainIsExpired = "Domain Is Expired",
}

export interface ServerMonitorOptions {
  diskPath?: string | undefined;
}

export interface SnmpMonitorOptions {
  oid?: string | undefined;
}

export enum EvaluateOverTimeType {
  Average = "Average",
  Sum = "Sum",
  MaximumValue = "Maximum Value",
  MunimumValue = "Minimum Value",
  AllValues = "All Values",
  AnyValue = "Any Value",
}

export interface MetricMonitorOptions {
  metricAlias?: string | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
}

export enum EvaluateOverTimeMinutes {
  TwoMinutes = "2",
  ThreeMinutes = "3",
  FiveMinutes = "5",
  TenMinutes = "10",
  FifteenMinutes = "15",
  TwentyMinutes = "20",
  ThirtyMinutes = "30",
  FortyFiveMinutes = "45",
  SixtyMinutes = "60",
}

export interface EvaluateOverTimeOptions {
  timeValueInMinutes: number | undefined;
  evaluateOverTimeType: EvaluateOverTimeType | undefined;
}

export interface CriteriaFilter {
  checkOn: CheckOn;
  serverMonitorOptions?: ServerMonitorOptions | undefined;
  metricMonitorOptions?: MetricMonitorOptions | undefined;
  snmpMonitorOptions?: SnmpMonitorOptions | undefined;
  filterType: FilterType | undefined;
  value: string | number | undefined;
  evaluateOverTime?: boolean | undefined;
  evaluateOverTimeOptions?: EvaluateOverTimeOptions | undefined;
}

export enum FilterType {
  EqualTo = "Equal To",
  NotEqualTo = "Not Equal To",
  GreaterThan = "Greater Than",
  LessThan = "Less Than",
  GreaterThanOrEqualTo = "Greater Than Or Equal To",
  LessThanOrEqualTo = "Less Than Or Equal To",
  Contains = "Contains",
  NotContains = "Not Contains",
  StartsWith = "Starts With",
  EndsWith = "Ends With",
  IsEmpty = "Is Empty",
  IsNotEmpty = "Is Not Empty",
  True = "True",
  False = "False",
  NotRecievedInMinutes = "Not Recieved In Minutes",
  RecievedInMinutes = "Recieved In Minutes",
  EvaluatesToTrue = "Evaluates To True",
  IsExecuting = "Is Executing",
  IsNotExecuting = "Is Not Executing",
}

export class CriteriaFilterUtil {
  public static hasValueField(data: {
    checkOn: CheckOn;
    filterType: FilterType | undefined;
  }): boolean {
    const { checkOn } = data;

    if (
      checkOn === CheckOn.IsOnline ||
      checkOn === CheckOn.SnmpIsOnline ||
      checkOn === CheckOn.DnsIsOnline ||
      checkOn === CheckOn.DomainIsExpired
    ) {
      return false;
    }

    if (checkOn === CheckOn.IsRequestTimeout) {
      return false;
    }

    if (
      checkOn === CheckOn.SnmpOidExists ||
      checkOn === CheckOn.DnssecIsValid ||
      checkOn === CheckOn.DnsRecordExists
    ) {
      return false;
    }

    if (
      checkOn === CheckOn.IsValidCertificate ||
      checkOn === CheckOn.IsSelfSignedCertificate ||
      checkOn === CheckOn.IsExpiredCertificate ||
      checkOn === CheckOn.IsNotAValidCertificate
    ) {
      return false;
    }

    if (
      FilterType.IsEmpty === data.filterType ||
      FilterType.IsNotEmpty === data.filterType ||
      FilterType.True === data.filterType ||
      FilterType.False === data.filterType
    ) {
      return false;
    }

    return true;
  }

  public static getEvaluateOverTimeTypeByCriteriaFilter(
    criteriaFilter: CriteriaFilter | undefined,
  ): Array<EvaluateOverTimeType> {
    if (!criteriaFilter) {
      return [];
    }

    if (criteriaFilter.checkOn === CheckOn.IsOnline) {
      return [EvaluateOverTimeType.AllValues, EvaluateOverTimeType.AnyValue];
    }

    return [
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
      EvaluateOverTimeType.AllValues,
      EvaluateOverTimeType.AnyValue,
    ];
  }

  public static isEvaluateOverTimeFilter(checkOn: CheckOn): boolean {
    return (
      checkOn === CheckOn.ResponseStatusCode ||
      checkOn === CheckOn.ResponseTime ||
      checkOn === CheckOn.DiskUsagePercent ||
      checkOn === CheckOn.CPUUsagePercent ||
      checkOn === CheckOn.MemoryUsagePercent ||
      checkOn === CheckOn.IsOnline ||
      checkOn === CheckOn.SnmpResponseTime ||
      checkOn === CheckOn.SnmpIsOnline ||
      checkOn === CheckOn.DnsResponseTime ||
      checkOn === CheckOn.DnsIsOnline
    );
  }
}

export const CriteriaFilterSchema: ZodSchema = Zod.object({
  checkOn: Zod.string(),
  serverMonitorOptions: Zod.object({
    diskPath: Zod.string().optional(),
  }).optional(),
  metricMonitorOptions: Zod.object({
    metricAlias: Zod.string().optional(),
    metricAggregationType: Zod.string().optional(),
  }).optional(),
  snmpMonitorOptions: Zod.object({
    oid: Zod.string().optional(),
  }).optional(),
  filterType: Zod.string().optional(),
  value: Zod.union([Zod.string(), Zod.number()]).optional(),
  evaluateOverTime: Zod.boolean().optional(),
  evaluateOverTimeOptions: Zod.object({
    timeValueInMinutes: Zod.number().optional(),
    evaluateOverTimeType: Zod.string().optional(),
  }).optional(),
});
