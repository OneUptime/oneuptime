import Component, { ComponentCategory } from './Component';
import LogComponents from './Components/Log';
import APIComponents from './Components/API';
import ScheduleComponents from './Components/Schedule';
import SlackComponents from './Components/Slack';
import ConditionComponents from './Components/Condition';
import JsonComponents from './Components/JSON';
import JavaScriptComponents from './Components/JavaScript';
import IconProp from '../Icon/IconProp';

const components: Array<Component> = [
    ...LogComponents,
    ...APIComponents,
    ...ScheduleComponents,
    ...SlackComponents,
    ...ConditionComponents,
    ...JsonComponents,
    ...JavaScriptComponents,
];

export default components;



export const Categories: Array<ComponentCategory> = [
    {
        name: 'API',
        description: 'Integrate with any API out on the web.',
        icon: IconProp.Globe,
    },
    {
        name: 'Slack',
        description: 'Integrate OneUptime with your Slack team.',
        icon: IconProp.SendMessage,
    },
    {
        name: 'Conditions',
        description: 'Add logic to your workflows.',
        icon: IconProp.Condition,
    },
    {
        name: 'Custom Code',
        description: 'Add JaavScript to your workflows.',
        icon: IconProp.Code
    },
    {
        name: 'JSON',
        description: 'Work with JSON Object in your workflows.',
        icon: IconProp.JSON
    },
    {
        name: 'Schedule',
        description: 'Make your workflows run at regular intervals.',
        icon: IconProp.Clock
    },
    {
        name: 'Utils',
        description: 'Utils that make workflow design simpler.',
        icon: IconProp.Window
    },

]

