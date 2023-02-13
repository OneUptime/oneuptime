import IconProp from '../../Icon/IconProp';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: 'send-email',
        title: 'Send Email',
        category: 'Email',
        description: 'Send email from your workflows',
        iconProp: IconProp.Email,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.Text,
                name: 'Email',
                description: 'Email to send to',
                required: true,
                id: 'email',
            },
            {
                type: ComponentInputType.Text,
                name: 'Subject',
                description: 'Email to send to',
                required: false,
                id: 'subject',
            },
            {
                type: ComponentInputType.LongText,
                name: 'Email Body',
                description: 'Email to send to',
                required: false,
                id: 'email-body',
            },
            {
                type: ComponentInputType.Text,
                name: 'SMTP HOST',
                description: 'SMTP Host to send emails from',
                required: true,
                id: 'smtp_host',
            },
            {
                type: ComponentInputType.Text,
                name: 'SMTP Username',
                description: 'SMTP Username to send emails from',
                required: true,
                id: 'smtp_username',
            },
            {
                type: ComponentInputType.Password,
                name: 'SMTP Password',
                description: 'SMTP Password to send emails from',
                required: true,
                id: 'smtp_password',
            },
            {
                type: ComponentInputType.Number,
                name: 'SMTP Port',
                description: 'SMTP Port to send emails from',
                required: true,
                id: 'smtp_port',
            },
            {
                type: ComponentInputType.Boolean,
                name: 'Use TLS/SSL',
                description: 'Check this box if you would like to use TLS/SSL to send emails',
                required: false,
                id: 'secure',
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
                    'Connect to this port if you want other componets to execute after the email is sent.',
                id: 'out',
            },
        ],
    },
];

export default components;
