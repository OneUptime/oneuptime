import IconProp from '../../Icon/IconProp';
import Component, { ComponentInputType, ComponentType } from './../Component';

const components: Array<Component> = [
    {
        id: 'if-true',
        title: 'If True',
        category: 'Condition',
        description: 'If the inputs are true then proceed',
        iconProp: IconProp.ArrowCircleLeft,
        type: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.Text,
                name: 'Expression 1',
                description: 'Expression 1',
                required: true,
                id: 'expression-1',
            },
            {
                type: ComponentInputType.Text,
                name: 'Expression 2',
                description: 'Expression 2',
                required: true,
                id: 'expression-2',
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
                title: 'Yes',
                description: 'If, yes then this port will be executed',
                id: 'yes',
            },
        ],
    },
    {
        id: 'if-false',
        title: 'If True',
        category: 'Condition',
        description: 'If the inputs are true then proceed',
        iconProp: IconProp.ArrowCircleLeft,
        type: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.Text,
                name: 'Expression 1',
                description: 'Expression 1',
                required: true,
                id: 'expression-1',
            },
            {
                type: ComponentInputType.Text,
                name: 'Expression 2',
                description: 'Expression 2',
                required: true,
                id: 'expression-2',
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
                title: 'Yes',
                description: 'If, yes then this port will be executed',
                id: 'yes',
            },
        ],
    },
    {
        id: 'if-else',
        title: 'If / Else',
        category: 'Condition',
        description: 'Branch based on Inputs',
        iconProp: IconProp.ArrowCircleLeft,
        type: ComponentType.Component,
        arguments: [
            {
                type: ComponentInputType.Text,
                name: 'Expression 1',
                description: 'Expression 1',
                required: true,
                id: 'expression-1',
            },
            {
                type: ComponentInputType.Text,
                name: 'Expression 2',
                description: 'Expression 2',
                required: true,
                id: 'expression-2',
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
                title: 'Yes',
                description: 'If, yes then this port will be executed',
                id: 'yes',
            },
            {
                title: 'No',
                description: 'If, no then this port will be executed',
                id: 'no',
            },
        ],
    },
];

export default components;
