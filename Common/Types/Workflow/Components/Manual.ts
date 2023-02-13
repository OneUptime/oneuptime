import IconProp from '../../Icon/IconProp';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: 'manual',
        title: 'Manual',
        category: 'Utils',
        description: 'Run this workflow manually',
        iconProp: IconProp.Play,
        componentType: ComponentType.Trigger,
        arguments: [
            {
                type: ComponentInputType.AnyValue,
                name: 'Value',
                description: 'Enter any value that you need to run this workflow',
                required: false,
                id: 'value',
            },
        ],
        returnValues: [],
        inPorts: [],
        outPorts: [
            {
                title: 'Execute',
                description:
                    'Connect other components to this port if you want them to be executed.',
                id: 'execute',
            },
        ],
    },
];

export default components;
