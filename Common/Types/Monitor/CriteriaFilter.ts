export enum CheckOn {
    ResponseTime = 'Response Time',
    ResponseCode = 'Response Code',
    ResponseHeader = 'Response Header',
    ResponseBody = 'Response Body',
    IsOnline = 'Is Online',
}

export interface CriteriaFilter {
    checkOn: CheckOn;
    filterType: FilterType;
    value: string | number;
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
}

export enum FilterCondition {
    All = 'All',
    Any = 'Any',
}
