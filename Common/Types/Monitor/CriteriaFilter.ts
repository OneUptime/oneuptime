import MonitorType from "./MonitorType";

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

  // Custom code or synthetic monitor.
  ResultValue = "Result Value",
  Error = "Error",
  ExecutionTime = "Execution Time (in ms)",

  // synthetic monitors

  ScreenSizeType = "Screen Size",
  BrowserType = "Browser Type",
}

export interface ServerMonitorOptions {
  diskPath?: string | undefined;
}

export enum EvaluateOverTimeType {
  Average = "Average",
  Sum = "Sum",
  MaximumValue = "Maximum Value",
  MunimumValue = "Minimum Value",
  AllValues = "All Values",
  AnyValue = "Any Value",
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
  filterType: FilterType | undefined;
  value: string | number | undefined;
  eveluateOverTime?: boolean | undefined;
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

export enum FilterCondition {
  All = "All",
  Any = "Any",
}

export class CriteriaFilterUtil {
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
      checkOn === CheckOn.IsOnline
    );
  }

  public static getTimeFiltersByMonitorType(
    monitorType: MonitorType,
  ): Array<CheckOn> {
    if (
      monitorType === MonitorType.API ||
      monitorType === MonitorType.Website
    ) {
      return [CheckOn.ResponseStatusCode, CheckOn.ResponseTime];
    } else if (
      monitorType === MonitorType.Ping ||
      monitorType === MonitorType.IP ||
      monitorType === MonitorType.Port
    ) {
      return [CheckOn.ResponseTime];
    } else if (monitorType === MonitorType.Server) {
      return [
        CheckOn.DiskUsagePercent,
        CheckOn.CPUUsagePercent,
        CheckOn.MemoryUsagePercent,
      ];
    }
    return [];
  }
}
