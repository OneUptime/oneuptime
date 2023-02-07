import Component from './Component';
import LogComponents from './Components/Log';
import APIComponents from './Components/API';
import ScheduleComponents from './Components/Schedule';
import SlackComponents from './Components/Slack';
import ConditionComponents from './Components/Condition';
import JsonComponents from './Components/JSON';
import JavaScriptComponents from './Components/JavaScript';

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
