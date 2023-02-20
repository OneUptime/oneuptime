import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.Log,
        title: 'Log',
        category: 'Utils',
        description: 'Log to console what ever is passed to this component',
        iconProp: IconProp.Logs,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.AnyValue,
                name: 'Value',
                description: 'Value to log',
                required: true,
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
                    'Connect to this port if you want other componets to execute after tha value has been logged.',
                id: 'out',
            },
        ],
    },
];

export default components;
