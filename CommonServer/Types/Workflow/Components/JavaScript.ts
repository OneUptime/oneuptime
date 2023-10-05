import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import JavaScriptComponents from 'Common/Types/Workflow/Components/JavaScript';
import ComponentCode, { RunOptions, RunReturnType } from '../ComponentCode';
import VMUtil from '../../../Utils/VM';

export default class JavaScriptCode extends ComponentCode {
    public constructor() {
        super();

        const JavaScriptComponent: ComponentMetadata | undefined =
            JavaScriptComponents.find((i: ComponentMetadata) => {
                return i.id === ComponentID.JavaScriptCode;
            });

        if (!JavaScriptComponent) {
            throw new BadDataException(
                'Custom JavaScript Component not found.'
            );
        }

        this.setMetadata(JavaScriptComponent);
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

        try {
            // Set timeout
            // Inject args
            // Inject dependencies

            let scriptArgs: JSONObject | string =
                (args['arguments'] as JSONObject | string) || {};

            if (typeof scriptArgs === 'string') {
                scriptArgs = JSON.parse(scriptArgs);
            }

            const returnVal: any = VMUtil.runCodeInSandbox(
                args['code'] as string,
                {
                    timeout: 5000,
                    allowAsync: true,
                    includeHttpPackage: true,
                    consoleLog: (logValue: JSONValue) => {
                        options.log(logValue);
                    },
                    args: scriptArgs as JSONObject,
                }
            );

            return {
                returnValues: {
                    returnValue: returnVal,
                },
                executePort: successPort,
            };
        } catch (err: any) {
            options.log('Error running script');
            options.log(
                err.message ? err.message : JSON.stringify(err, null, 2)
            );
            return {
                returnValues: {},
                executePort: errorPort,
            };
        }
    }
}
