import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.MicrosoftTeamsSendMessageToChannel,
        title: 'Send Message to Channel',
        category: 'Microsoft Teams',
        description: 'Send message to teams channel',
        iconProp: IconProp.SendMessage,
        componentType: ComponentType.Component,
        arguments: [
            {
                id: 'webhook-url',
                name: 'Teams Incoming Webhook URL',
                description:
                    'Need help creating a webhook? Check docs here: https://api.teams.com/messaging/webhooks',
                type: ComponentInputType.URL,
                required: true,
                placeholder:
                    'https://hooks.teams.com/services/T00000000/B00000000/XXXXXXXXXXXXXXXXXXXXXXXX',
            },
            {
                id: 'text',
                name: 'Message Text',
                description: 'Message to send to Teams.',
                type: ComponentInputType.LongText,
                required: true,
                placeholder: 'Test teams message from OneUptime',
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
