import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import LogComponents from 'Common/Types/Workflow/Components/Log';
import ComponentCode, { RunReturnType } from '../ComponentCode';

export default class Log extends ComponentCode {
    public constructor() {
        super();

        const LogComponent: ComponentMetadata | undefined = LogComponents.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.Log;
            }
        );

        if (!LogComponent) {
            throw new BadDataException('Component not found.');
        }

        this.setMetadata(LogComponent);
    }

    public override async run(args: JSONObject): Promise<RunReturnType> {
        const outPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'out';
            }
        );

        if (!outPort) {
            throw new BadDataException('Out port not found');
        }

        this.log('Value: ');
        this.log(args['value']);

        return Promise.resolve({
            returnValues: {},
            executePort: outPort,
            logs: this.logs,
        });
    }
}
