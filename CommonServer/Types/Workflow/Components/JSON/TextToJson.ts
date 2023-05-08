import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import JSONComponents from 'Common/Types/Workflow/Components/JSON';
import ComponentCode, { RunOptions, RunReturnType } from '../../ComponentCode';
import JSONFunctions from 'Common/Types/JSONFunctions';

export default class TextToJSON extends ComponentCode {
    public constructor() {
        super();

        const Component: ComponentMetadata | undefined = JSONComponents.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.TextToJson;
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

        if (!args['text']) {
            throw options.onError(new BadDataException('text is undefined.'));
        }

        if (typeof args['text'] !== 'string') {
            throw options.onError(
                new BadDataException('text is should be of type string.')
            );
        }

        try {
            const returnValue: JSONObject = JSONFunctions.parse(
                args['text'] as string
            );
            return Promise.resolve({
                returnValues: {
                    json: returnValue,
                },
                executePort: successPort,
            });
        } catch (err) {
            options.log('text is not in the correct format.');
            return Promise.resolve({
                returnValues: {},
                executePort: errorPort,
            });
        }
    }
}
