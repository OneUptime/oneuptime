import IconProp from '../../Icon/IconProp';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: 'workflow-run',
        title: 'Execute Workflow',
        category: 'Utils',
        description: 'Execute another workflow',
        iconProp: IconProp.Workflow,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.AnyValue,
                name: 'Value',
                description: 'Value to pass to another workflow',
                required: false,
                id: 'value',
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
                title: 'Out',
                description:
                    'Connect to this port if you want other components to execute after the workflow is triggered',
                id: 'out',
            },
        ],
    },
];

export default components;
