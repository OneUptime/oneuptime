import IconProp from '../../Icon/IconProp';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';
import ComponentID from '../ComponentID';
import Route from '../../API/Route';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.Webhook,
        title: 'Webhook',
        category: 'Webhook',
        description:
            'Hook any of your external apps and services with this workflow.',
        iconProp: IconProp.AltGlobe,
        componentType: ComponentType.Trigger,
        documentationLink: Route.fromString('/workflow/docs/Webhook.md'),
        arguments: [],
        returnValues: [
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request Headers for this request',
                type: ComponentInputType.StringDictionary,
                required: false,
                placeholder: '{"header1": "value1", "header2": "value2", ....}',
            },
            {
                id: 'request-params',
                name: 'Request Query Params',
                description: 'Request Query Params for this request',
                type: ComponentInputType.StringDictionary,
                required: false,
                placeholder: '{"query1": "value1", "query2": "value2", ....}',
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Request Body',
                type: ComponentInputType.JSON,
                required: false,
                placeholder: '{"key1": "value1", "key2": "value2", ....}',
            },
        ],
        inPorts: [],
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
