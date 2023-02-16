import ComponentID from "Common/Types/Workflow/ComponentID";
import WebhookTrigger from "./Webhook";
import Log from "./Log";
import Schedule from "./Schedule";

export default {
    [ComponentID.Webhook]: WebhookTrigger,
    [ComponentID.Log]: Log,
    [ComponentID.Schedule]: Schedule
}