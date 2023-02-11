import IconProp from '../Icon/IconProp';

export enum ComponentInputType {
    Text = 'Text',
    Date = 'Date',
    DateTime = 'Date Time',
    Boolean = 'Boolean',
    Number = 'Number',
    Decimal = 'Decimal',
    JavaScript = 'JavaScript',
    AnyValue = 'AnyValue',
    JSON = 'JSON',
    StringDictionary = 'StringDictionary',
    URL = 'URL',
    Email = 'Email',
    CronTab = 'CronTab',
    Query = 'Query',
    BaseModel = 'BaseModel',
    BaseModelArray = 'BaseModelArray',
    JSONArray = 'JSONArray',
}

export enum ComponentType {
    Trigger = 'Trigger',
    Component = 'Component',
}

export interface Port {
    title: string;
    description: string;
    id: string;
}

export interface Argument {
    name: string;
    description: string;
    required: boolean;
    type: ComponentInputType;
    id: string;
    isAdvanced?: boolean | undefined;
}

export interface ReturnValue {
    id: string;
    name: string;
    description: string;
    type: ComponentInputType;
    required: boolean;
}

export default interface ComponentMetadata {
    id: string;
    title: string;
    category: string;
    description: string;
    iconProp: IconProp;
    componentType: ComponentType;
    arguments: Array<Argument>;
    returnValues: Array<ReturnValue>;
    inPorts: Array<Port>;
    outPorts: Array<Port>;
    tableName?: string | undefined;
}

export interface ComponentCategory {
    name: string;
    description: string;
    icon: IconProp;
}
