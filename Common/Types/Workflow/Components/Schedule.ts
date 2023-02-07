import IconProp from '../../Icon/IconProp';
import Component, { ComponentInputType, ComponentType } from './../Component';

const components: Array<Component> = [


    {
        id: 'schedule',
        title: "Schedule",
        category: "Triggers",
        description: "Run this workflow on particular schedule",
        iconProp: IconProp.Clock,
        type: ComponentType.Trigger,
        arguments: [
            {
                type: ComponentInputType.CronTab,
                name: "Schedule at",
                description: "Trigger this workflow at",
                required: true,
                id: 'schedule'
            },
        ],
        returnValues: [],
        inPorts: [],
        outPorts: [{
            title: 'Execute',
            description: 'Connect other components to this port if you want them to be executed.',
            id: 'execute'
        }]
    },
];


export default components;