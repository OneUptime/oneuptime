import MonitorType from './MonitorType';

export enum CheckOn {
    ResponseTime = 'Response Time (in ms)',
    ResponseStatusCode = 'Response Status Code',
    ResponseHeader = 'Response Header',
    ResponseHeaderValue = 'Response Header Value',
    ResponseBody = 'Response Body',
    IsOnline = 'Is Online',
    IncomingRequest = 'Incoming Request',
    RequestBody = 'Request Body',
    RequestHeader = 'Request Header',
    RequestHeaderValue = 'Request Header Value',
    JavaScriptExpression = 'JavaScript Expression',
    DiskUsagePercent = 'Disk Usage (in %)',
    CPUUsagePercent = 'CPU Usage (in %)',
    MemoryUsagePercent = 'Memory Usage (in %)',
}

export interface ServerMonitorOptions {
    diskPath?: string | undefined;
}

export enum EvaluateOverTimeType {
    Average = 'Average',
    Sum = 'Sum',
    MaximumValue = 'Maximum Value',
    MunimumValue = 'Minimum Value',
    AllValues = 'All Values',
    AnyValue = 'Any Value',
}

export enum EvaluateOverTimeMinutes {
    TwoMinutes = '2',
    ThreeMinutes = '3',
    FiveMinutes = '5',
    TenMinutes = '10',
    FifteenMinutes = '15',
    TwentyMinutes = '20',
    ThirtyMinutes = '30',
    FortyFiveMinutes = '45',
    SixtyMinutes = '60',
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
    EqualTo = 'Equal To',
    NotEqualTo = 'Not Equal To',
    GreaterThan = 'Greater Than',
    LessThan = 'Less Than',
    GreaterThanOrEqualTo = 'Greater Than Or Equal To',
    LessThanOrEqualTo = 'Less Than Or Equal To',
    Contains = 'Contains',
    NotContains = 'Not Contains',
    StartsWith = 'Starts With',
    EndsWith = 'Ends With',
    IsEmpty = 'Is Empty',
    IsNotEmpty = 'Is Not Empty',
    True = 'True',
    False = 'False',
    NotRecievedInMinutes = 'Not Recieved In Minutes',
    RecievedInMinutes = 'Recieved In Minutes',
    EvaluatesToTrue = 'Evaluates To True',
}

export enum FilterCondition {
    All = 'All',
    Any = 'Any',
}

export class CriteriaFilterUtil {
    public static isEvaluateOverTimeFilter(checkOn: CheckOn): boolean {
        return (
            checkOn === CheckOn.ResponseStatusCode ||
            checkOn === CheckOn.ResponseTime ||
            checkOn === CheckOn.DiskUsagePercent ||
            checkOn === CheckOn.CPUUsagePercent ||
            checkOn === CheckOn.MemoryUsagePercent
        );
    }

    public static getTimeFiltersByMonitorType(
        monitorType: MonitorType
    ): Array<CheckOn> {
        switch (monitorType) {
            case MonitorType.API || MonitorType.Website:
                return [CheckOn.ResponseStatusCode, CheckOn.ResponseTime];
            case MonitorType.Ping || MonitorType.IP || MonitorType.Port:
                return [CheckOn.ResponseTime];
            case MonitorType.Server:
                return [
                    CheckOn.DiskUsagePercent,
                    CheckOn.CPUUsagePercent,
                    CheckOn.MemoryUsagePercent,
                ];
            default:
                return [];
        }
    }
}
