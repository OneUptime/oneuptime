import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.IfElse,
        title: 'If / Else',
        category: 'Conditions',
        description: 'Branch based on Inputs',
        iconProp: IconProp.Condition,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.Text,
                name: 'Input 1',
                description: 'Input 1',
                placeholder: 'x',
                required: true,
                id: 'input-1',
            },
            {
                type: ComponentInputType.Operator,
                name: 'Operator',
                description: 'Operator',
                placeholder: 'Equal To',
                required: true,
                id: 'operator',
            },
            {
                type: ComponentInputType.Text,
                name: 'Input 2',
                description: 'Input 2',
                placeholder: 'x',
                required: true,
                id: 'input-2',
            },
        ],
        returnValues: [],
        inPorts: [
            {
                title: 'In',
                description:
                    'Please connect components to this port for this component to work.',
                id: 'in',
            },
        ],
        outPorts: [
            {
                title: 'Yes',
                description: 'If, yes then this port will be executed',
                id: 'yes',
            },
            {
                title: 'No',
                description: 'If, no then this port will be executed',
                id: 'no',
            },
        ],
    },
];

export default components;
