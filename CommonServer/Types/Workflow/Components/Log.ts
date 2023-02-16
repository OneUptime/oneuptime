import OneUptimeDate from 'Common/Types/Date';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import WebhookComponents from 'Common/Types/Workflow/Components/Webhook';
import ComponentCode, { RunProps, RunReturnType } from '../ComponentCode';

export default class Log extends ComponentCode {
    public constructor() {
        const LogComponent: ComponentMetadata | undefined =
            WebhookComponents.find((i: ComponentMetadata) => {
                return i.id === ComponentID.Log;
            });

        if (!LogComponent) {
            throw new BadDataException('Component not found.');
        }
        super(LogComponent);
    }

    public override run(props: RunProps): Promise<RunReturnType> {
        const outPort: Port | undefined = this.getMetadata().outPorts.find(
            (p) => {
                return p.id === 'out';
            }
        );

        if (!outPort) {
            throw new BadDataException('Out port not found');
        }

        console.log(OneUptimeDate.getCurrentDateAsFormattedString() + ':');
        console.log(props.arguments['value']);

        return Promise.resolve({
            returnValues: {},
            executePort: outPort,
        });
    }
}
