import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.SlackSendMessageToChannel,
        title: 'Send Message to Channel',
        category: 'Slack',
        description: 'Send message to slack channel',
        iconProp: IconProp.SendMessage,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'webhook-url',
                name: 'Slack Incoming Webhook URL',
                description:
                    'Need help creating a webhook? Check docs here: https://api.slack.com/messaging/webhooks',
                type: ComponentInputType.URL,
                required: true,
                placeholder:
                    'https://hooks.slack.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
            },
            {
                id: 'text',
                name: 'Message Text',
                description: 'Message to send to Slack.',
                type: ComponentInputType.LongText,
                required: true,
                placeholder: 'Test slack message from OneUptime',
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
