import IconProp from '../../Icon/IconProp';
import ComponentID from '../ComponentID';
import ComponentMetadata, {
    ComponentInputType,
    ComponentType,
} from './../Component';

const components: Array<ComponentMetadata> = [
    {
        id: ComponentID.SendEmail,
        title: 'Send Email',
        category: 'Email',
        description: 'Send email from your workflows',
        iconProp: IconProp.Email,
        componentType: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.Text,
                name: 'From Email',
                description: 'Email to send from',
                placeholder: "Name <email@company.com>",
                required: true,
                id: 'from',
            },
            {
                type: ComponentInputType.Text,
                name: 'To Email',
                description: 'Email to send to',
                placeholder: "email@company.com; email2@company.com; ...",
                required: true,
                id: 'to',
            },
            {
                type: ComponentInputType.Text,
                name: 'Subject',
                description: 'Email to send to',
                required: false,
                id: 'subject',
            },
            {
                type: ComponentInputType.HTML,
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
                id: 'smtp-host',
            },
            {
                type: ComponentInputType.Text,
                name: 'SMTP Username',
                description: 'SMTP Username to send emails from',
                required: true,
                id: 'smtp-username',
            },
            {
                type: ComponentInputType.Password,
                name: 'SMTP Password',
                description: 'SMTP Password to send emails from',
                required: true,
                id: 'smtp-password',
            },
            {
                type: ComponentInputType.Number,
                name: 'SMTP Port',
                description: 'SMTP Port to send emails from',
                required: true,
                id: 'smtp-port',
            },
            {
                type: ComponentInputType.Boolean,
                name: 'Use TLS/SSL',
                description:
                    'Check this box if you would like to use TLS/SSL to send emails',
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
