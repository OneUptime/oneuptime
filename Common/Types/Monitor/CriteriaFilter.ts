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
}

export interface CriteriaFilter {
    checkOn: CheckOn;
    filterType: FilterType | undefined;
    value: string | number | undefined;
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
}

export enum FilterCondition {
    All = 'All',
    Any = 'Any',
}
