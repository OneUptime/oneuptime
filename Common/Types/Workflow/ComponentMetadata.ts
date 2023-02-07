import IconProp from '../Icon/IconProp';

export enum ComponentInputType {
    Text = 'Text',
    Date = 'Date',
    DateTime = 'Date Time',
    Boolean = 'Boolean',
    Number = 'Number',
    Decimal = 'Decimal'
}

export enum ComponentType {
    Trigger = 'Trigger',
    Component = 'Component'
}

export default interface ComponentMetadata {
    id: string;
    name: string;
    category: string;
    description: string;
    iconProp: IconProp;
    type: ComponentType;
    arguments: {
        [x: string]: {
            name: string;
            description: string;
            required: boolean;
            type: ComponentInputType
        };
    };
    returnValues: {
        [x: string]: {
            name: string;
            description: string;
            type: ComponentInputType;
        };
    };
}