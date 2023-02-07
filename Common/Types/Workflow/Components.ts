import Dictionary from '../Dictionary';
import IconProp from '../Icon/IconProp';
import ComponentMetadata, { ComponentInputType, ComponentType } from './ComponentMetadata';

const components: Dictionary<ComponentMetadata> = {
    'slack-send-message-to-channel': {
        id: 'slack-send-message-to-channel',
        name: "Send Message to Channel",
        category: "Slack",
        description: "Send message to slack channel",
        iconProp: IconProp.SendMessage,
        type: ComponentType.Component,
        arguments: {

        },
        returnValues: {

        },
    },
    'if-true': {
        id: 'if-true',
        name: "If True",
        category: "Condition",
        description: "If the inputs are true then proceed",
        iconProp: IconProp.ArrowCircleLeft,
        type: ComponentType.Component,
        arguments: {
            expression1: {
                type: ComponentInputType.Text,
                name: "Expression 1",
                description: "Expression 1",
                required: true
            },
            expression2: {
                type: ComponentInputType.Text,
                name: "Expression 2",
                description: "Expression 2",
                required: true
            },
        },
        returnValues: {

        },
    },
    'if-else': {
        id: 'if-else',
        name: "If / Else",
        category: "Condition",
        description: "Branch based on Inputs",
        iconProp: IconProp.ArrowCircleLeft,
        type: ComponentType.Component,
        arguments: {
            expression1: {
                type: ComponentInputType.Text,
                name: "Expression 1",
                description: "Expression 1",
                required: true
            },
            expression2: {
                type: ComponentInputType.Text,
                name: "Expression 2",
                description: "Expression 2",
                required: true
            },
        },
        returnValues: {

        },
    }
};


export default components;