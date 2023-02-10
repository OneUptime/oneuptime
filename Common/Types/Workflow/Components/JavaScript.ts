import IconProp from '../../Icon/IconProp';
import ComponentMetadata, { ComponentInputType, ComponentType } from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: 'javascript',
        title: 'Run Custom JavaScript',
        category: 'Custom Code',
        description: 'Run custom JavaScript in your workflow',
        iconProp: IconProp.Code,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.AnyValue,
                name: 'Value',
                description: 'Value as Input',
                required: true,
                id: 'input',
            },
        ],
        returnValues: [
            {
                type: ComponentInputType.AnyValue,
                name: 'Value',
                description: 'Value as Output',
                required: false,
                id: 'output',
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
