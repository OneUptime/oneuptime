import ComponentID from 'Common/Types/Workflow/ComponentID';
import WebhookTrigger from './Webhook';
import Log from './Log';
import Schedule from './Schedule';
import Dictionary from 'Common/Types/Dictionary';
import ComponentCode from '../ComponentCode';
import JavaScirptCode from './JavaScript';

const Components: Dictionary<ComponentCode> = {
    [ComponentID.Webhook]: new WebhookTrigger(),
    [ComponentID.Log]: new Log(),
    [ComponentID.Schedule]: new Schedule(),
    [ComponentID.JavaScriptCode]: new JavaScirptCode(),
};

export default Components;
