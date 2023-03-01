import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.ApiGet,
        title: 'API Get (JSON)',
        category: 'API',
        description: 'Send Get API Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to.',
                type: ComponentInputType.URL,
                required: true,
                placeholder: 'https://api.yourcompany.com',
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Request Body in JSON',
                type: ComponentInputType.JSON,
                required: false,
                placeholder:
                    'Example: {"key1": "value1", "key2": "value2", ....}',
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"query1": "value1", "query2": "value2", ....}',
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"header1": "value1", "header2": "value2", ....}',
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
                id: 'response-status',
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
        id: ComponentID.ApiPost,
        title: 'API Post (JSON)',
        category: 'API',
        description: 'Send a POST Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to.',
                type: ComponentInputType.URL,
                required: true,
                placeholder: 'https://api.yourcompany.com',
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Request Body in JSON',
                type: ComponentInputType.JSON,
                required: false,
                placeholder:
                    'Example: {"key1": "value1", "key2": "value2", ....}',
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"query1": "value1", "query2": "value2", ....}',
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"header1": "value1", "header2": "value2", ....}',
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
                id: 'response-status',
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
        id: ComponentID.ApiPut,
        title: 'API Put (JSON)',
        category: 'API',
        description: 'Send a PATCH Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to.',
                type: ComponentInputType.URL,
                required: true,
                placeholder: 'https://api.yourcompany.com',
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Request Body in JSON',
                type: ComponentInputType.JSON,
                required: false,
                placeholder:
                    'Example: {"key1": "value1", "key2": "value2", ....}',
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"query1": "value1", "query2": "value2", ....}',
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"header1": "value1", "header2": "value2", ....}',
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
                id: 'response-status',
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
        id: ComponentID.ApiDelete,
        title: 'API Delete (JSON)',
        category: 'API',
        description: 'Send a PATCH Request and get JSON Response',
        iconProp: IconProp.Globe,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'url',
                name: 'URL',
                description: 'URL to send request to.',
                type: ComponentInputType.URL,
                required: true,
                placeholder: 'https://api.yourcompany.com',
            },
            {
                id: 'request-body',
                name: 'Request Body',
                description: 'Request Body in JSON',
                type: ComponentInputType.JSON,
                required: false,
                placeholder:
                    'Example: {"key1": "value1", "key2": "value2", ....}',
            },
            {
                id: 'query-string',
                name: 'Query String',
                description: 'Send query string params.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"query1": "value1", "query2": "value2", ....}',
            },
            {
                id: 'request-headers',
                name: 'Request Headers',
                description: 'Request headers to send.',
                type: ComponentInputType.StringDictionary,
                required: false,
                isAdvanced: true,
                placeholder:
                    'Example: {"header1": "value1", "header2": "value2", ....}',
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
                id: 'response-status',
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
