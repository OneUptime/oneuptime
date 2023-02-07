import IconProp from '../../Icon/IconProp';
import Component, { ComponentInputType, ComponentType } from './../Component';

const components: Array<Component> = [

    {
        id: 'slack-send-message-to-channel',
        title: "Send Message to Channel",
        category: "Slack",
        description: "Send message to slack channel",
        iconProp: IconProp.SendMessage,
        type: ComponentType.Component,
        arguments: [],
        returnValues: [{
            id: "error",
            name: "Error",
            description: "Error, if there is any.",
            type: ComponentInputType.Text,
            required: false
        }],
        inPorts: [{
            title: 'In',
            description: 'Please connect components to this port for this component to work.',
            id: 'in'
        }],
        outPorts: [{
            title: 'Success',
            description: 'This is executed when the message is successfully posted',
            id: 'success'
        },
        {
            title: 'Error',
            description: 'This is executed when there is an error',
            id: 'error'
        }]
    },
];


export default components;