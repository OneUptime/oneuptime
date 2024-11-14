import DashboardBaseComponent from "./DashboardBaseComponent";

export enum ComponentInputType {
    Text = "Text",
    Date = "Date",
    DateTime = "Date Time",
    Boolean = "True or False",
    Number = "Number",
    Decimal = "Decimal",
    MetricsEditor = "MetricsEditor",
    LongText = "Long Text",
}


export interface ComponentArgument<T extends DashboardBaseComponent> {
    name: string;
    description: string;
    required: boolean;
    type: ComponentInputType;
    id: keyof T["arguments"];
    isAdvanced?: boolean | undefined;
    placeholder?: string | undefined;
}
