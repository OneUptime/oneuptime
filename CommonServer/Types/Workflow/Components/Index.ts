import ComponentID from 'Common/Types/Workflow/ComponentID';
import WebhookTrigger from './Webhook';
import Log from './Log';
import Schedule from './Schedule';
import Dictionary from 'Common/Types/Dictionary';
import ComponentCode from '../ComponentCode';
import JavaScirptCode from './JavaScript';

const Components: Dictionary<typeof ComponentCode> = {
    [ComponentID.Webhook]: WebhookTrigger,
    [ComponentID.Log]: Log,
    [ComponentID.Schedule]: Schedule,
    [ComponentID.JavaScriptCode]: JavaScirptCode,
};

export default Components;
