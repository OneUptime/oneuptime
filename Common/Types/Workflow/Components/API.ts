import IconProp from '../../Icon/IconProp';
import ComponentMetadata, { ComponentInputType, ComponentType } from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: 'api-get',
        title: 'API Get (JSON)',
        category: 'API',
        description: 'Send Get API Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to',
                type: ComponentInputType.URL,
                required: true,
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: true,
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
        ],
        returnValues: [
            {
                id: 'error',
                name: 'Error',
                description: 'Error, if there is any.',
                type: ComponentInputType.Text,
                required: false,
            },
            {
                id: 'status',
                name: 'Response Status',
                description: 'Response Status (200, for example)',
                type: ComponentInputType.Number,
                required: false,
            },
            {
                id: 'response-headers',
                name: 'Response Headers',
                description: 'Response Headers for this request',
                type: ComponentInputType.StringDictionary,
                required: false,
            },
            {
                id: 'response-body',
                name: 'Response Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
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
                description:
                    'This is executed when the message is successfully posted',
                id: 'success',
            },
            {
                title: 'Error',
                description: 'This is executed when there is an error',
                id: 'error',
            },
        ],
    },
    {
        id: 'api-post',
        title: 'API Post (JSON)',
        category: 'API',
        description: 'Send a POST Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to',
                type: ComponentInputType.URL,
                required: true,
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
        ],
        returnValues: [
            {
                id: 'error',
                name: 'Error',
                description: 'Error, if there is any.',
                type: ComponentInputType.Text,
                required: false,
            },
            {
                id: 'status',
                name: 'Response Status',
                description: 'Response Status (200, for example)',
                type: ComponentInputType.Number,
                required: false,
            },
            {
                id: 'response-headers',
                name: 'Response Headers',
                description: 'Response Headers for this request',
                type: ComponentInputType.StringDictionary,
                required: false,
            },
            {
                id: 'response-body',
                name: 'Response Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
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
                description:
                    'This is executed when the message is successfully posted',
                id: 'success',
            },
            {
                title: 'Error',
                description: 'This is executed when there is an error',
                id: 'error',
            },
        ],
    },
    {
        id: 'api-patch',
        title: 'API Patch (JSON)',
        category: 'API',
        description: 'Send a PATCH Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to',
                type: ComponentInputType.URL,
                required: true,
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
        ],
        returnValues: [
            {
                id: 'error',
                name: 'Error',
                description: 'Error, if there is any.',
                type: ComponentInputType.Text,
                required: false,
            },
            {
                id: 'status',
                name: 'Response Status',
                description: 'Response Status (200, for example)',
                type: ComponentInputType.Number,
                required: false,
            },
            {
                id: 'response-headers',
                name: 'Response Headers',
                description: 'Response Headers for this request',
                type: ComponentInputType.StringDictionary,
                required: false,
            },
            {
                id: 'response-body',
                name: 'Response Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
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
                description:
                    'This is executed when the message is successfully posted',
                id: 'success',
            },
            {
                title: 'Error',
                description: 'This is executed when there is an error',
                id: 'error',
            },
        ],
    },
    {
        id: 'api-delete',
        title: 'API Delete (JSON)',
        category: 'API',
        description: 'Send a PATCH Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to',
                type: ComponentInputType.URL,
                required: true,
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
            },
        ],
        returnValues: [
            {
                id: 'error',
                name: 'Error',
                description: 'Error, if there is any.',
                type: ComponentInputType.Text,
                required: false,
            },
            {
                id: 'status',
                name: 'Response Status',
                description: 'Response Status (200, for example)',
                type: ComponentInputType.Number,
                required: false,
            },
            {
                id: 'response-headers',
                name: 'Response Headers',
                description: 'Response Headers for this request',
                type: ComponentInputType.StringDictionary,
                required: false,
            },
            {
                id: 'response-body',
                name: 'Response Body',
                description: 'Response Body',
                type: ComponentInputType.JSON,
                required: false,
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
                description:
                    'This is executed when the message is successfully posted',
                id: 'success',
            },
            {
                title: 'Error',
                description: 'This is executed when there is an error',
                id: 'error',
            },
        ],
    },
];

export default components;
