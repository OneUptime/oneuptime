import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.Manual,
        title: 'Manual',
        category: 'Utils',
        description: 'Run this workflow manually',
        iconProp: IconProp.Play,
        componentType: ComponentType.Trigger,
        arguments: [],
        returnValues: [
            {
                type: ComponentInputType.JSON,
                name: 'JSON',
                description:
                    'Enter JSON value that you need to run this workflow',
                required: false,
                id: 'value',
                placeholder: '{"key1": "value1", "key2": "value2", ....}',
            },
        ],
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
