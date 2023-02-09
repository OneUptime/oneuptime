import IconProp from '../../Icon/IconProp';
import Component, { ComponentInputType, ComponentType } from './../Component';

const components: Array<Component> = [
    {
        id: 'webhook',
        title: 'Webhook',
        category: 'Webhook',
        description: 'Hook any of your external apps and services with this workflow.',
        iconProp: IconProp.AltGlobe,
        componentType: ComponentType.Trigger,
        arguments: [

        ],
        returnValues: [{
            id: 'response-headers',
            name: 'Response Headers',
            description: 'Response Headers for this request',
            type: ComponentInputType.StringDictionary,
            required: false,
        },
        {
            id: 'request-params',
            name: 'Request Query Params',
            description: 'Request Query Params for this request',
            type: ComponentInputType.StringDictionary,
            required: false,
        },
        {
            id: 'request-body',
            name: 'Request Body',
            description: 'Request Body',
            type: ComponentInputType.JSON,
            required: false,
        },],
        inPorts: [

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
