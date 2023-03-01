import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import JSONComponents from 'Common/Types/Workflow/Components/JSON';
import ComponentCode, { RunOptions, RunReturnType } from '../../ComponentCode';

export default class MergeJSON extends ComponentCode {
    public constructor() {
        super();

        const Component: ComponentMetadata | undefined = JSONComponents.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.MergeJson;
            }
        );

        if (!Component) {
            throw new BadDataException('Component not found.');
        }

        this.setMetadata(Component);
    }

    public override async run(
        args: JSONObject,
        options: RunOptions
    ): Promise<RunReturnType> {
        const successPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'success';
            }
        );

        if (!successPort) {
            throw options.onError(
                new BadDataException('Success port not found')
            );
        }

        const errorPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'error';
            }
        );

        if (!errorPort) {
            throw options.onError(new BadDataException('Error port not found'));
        }

        if (!args['json1']) {
            throw options.onError(new BadDataException('JSON1 is undefined.'));
        }

        if (typeof args['json1'] === 'string') {
            args['json1'] = JSON.parse(args['json1'] as string);
        }

        if (typeof args['json2'] !== 'object') {
            throw options.onError(
                new BadDataException('JSON2 is should be of type object.')
            );
        }

        if (!args['json2']) {
            throw options.onError(new BadDataException('JSON2 is undefined.'));
        }

        if (typeof args['json2'] === 'string') {
            args['json2'] = JSON.parse(args['json2'] as string);
        }

        if (typeof args['json2'] !== 'object') {
            throw options.onError(
                new BadDataException('JSON2 is should be of type object.')
            );
        }

        return Promise.resolve({
            returnValues: {
                json: {
                    ...(args['json1'] as JSONObject),
                    ...(args['json2'] as JSONObject),
                },
            },
            executePort: successPort,
        });
    }
}
