import DashboardBaseComponent from "./DashboardBaseComponent";

export enum ComponentInputType {
    Text = "Text",
    Password = "Password",
    Date = "Date",
    DateTime = "Date Time",
    Boolean = "True or False",
    Number = "Number",
    Decimal = "Decimal",
    JavaScript = "JavaScript",
    AnyValue = "Any Type",
    JSON = "JSON",
    StringDictionary = "Dictionary of String",
    URL = "URL",
    Email = "Email",
    CronTab = "CronTab",
    Query = "Database Query",
    Select = "Database Select",
    BaseModel = "Database Record",
    BaseModelArray = "Database Records",
    JSONArray = "List of JSON",
    LongText = "Long Text",
    HTML = "HTML",
    Operator = "Operator",
    Markdown = "Markdown",
    MetricsEditor = "MetricsEditor",
}


export interface ComponentArgument<T extends DashboardBaseComponent> {
    name: string;
    description: string;
    required: boolean;
    type: ComponentInputType;
    key: keyof T;
    isAdvanced?: boolean | undefined;
    placeholder?: string | undefined;
}
