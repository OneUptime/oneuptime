import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.JavaScriptCode,
        title: 'Run Custom JavaScript',
        category: 'Custom Code',
        description: 'Run custom JavaScript in your workflow',
        iconProp: IconProp.Code,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.JavaScript,
                name: 'JavaScript Code',
                description: 'JavaScript Code',
                required: true,
                id: 'code',
            },
            {
                type: ComponentInputType.JSON,
                name: 'Arguments',
                description: 'Pass in arguments to your JavaScript Code from this workflow',
                required: false,
                id: 'arguments',
            },
        ],
        returnValues: [
            {
                type: ComponentInputType.AnyValue,
                name: 'Value',
                description: 'Value as Output',
                required: false,
                id: 'returnValue',
            },
        ],
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
                title: 'Success',
                description: 'This is executed when the code runs successfully',
                id: 'success',
            },
            {
                title: 'Error',
                description: 'This is executed when code fails to run',
                id: 'error',
            },
        ],
    },
];

export default components;
