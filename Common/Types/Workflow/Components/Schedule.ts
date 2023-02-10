import IconProp from '../../Icon/IconProp';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: 'schedule',
        title: 'Schedule',
        category: 'Schedule',
        description: 'Run this workflow on particular schedule',
        iconProp: IconProp.Clock,
        componentType: ComponentType.Trigger,
        arguments: [
            {
                type: ComponentInputType.CronTab,
                name: 'Schedule at',
                description: 'Trigger this workflow at',
                required: true,
                id: 'schedule',
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
