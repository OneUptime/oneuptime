import VMUtil from '../../../../Utils/VM/VMAPI';
import ComponentCode, { RunOptions, RunReturnType } from '../../ComponentCode';
import BadDataException from 'Common/Types/Exception/BadDataException';
import ReturnResult from 'Common/Types/IsolatedVM/ReturnResult';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import Components from 'Common/Types/Workflow/Components/Condition';

export default class IfElse extends ComponentCode {
    public constructor() {
        super();

        const Component: ComponentMetadata | undefined = Components.find(
            (i: ComponentMetadata) => {
                return i.id === ComponentID.IfElse;
            }
        );

        if (!Component) {
            throw new BadDataException(
                'Custom JavaScript Component not found.'
            );
        }

        this.setMetadata(Component);
    }

    public override async run(
        args: JSONObject,
        options: RunOptions
    ): Promise<RunReturnType> {
        const yesPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'yes';
            }
        );

        if (!yesPort) {
            throw options.onError(new BadDataException('Yes port not found'));
        }

        const noPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'no';
            }
        );

        if (!noPort) {
            throw options.onError(new BadDataException('No port not found'));
        }

        try {
            // Set timeout
            // Inject args
            // Inject dependencies

            for (const key in args) {
                if (key === 'operator') {
                    continue;
                }

                const value: JSONValue = args[key];

                let shouldHaveQuotes: boolean = false;

                if (
                    typeof value === 'string' &&
                    value !== 'null' &&
                    value !== 'undefined'
                ) {
                    shouldHaveQuotes = true;
                }

                if (typeof value === 'object') {
                    args[key] = JSON.stringify(args[key]);
                }

                args[key] = shouldHaveQuotes ? `"${args[key]}"` : args[key];
            }

            type SerializeFunction = (arg: string) => string;

            const serialize: SerializeFunction = (arg: string): string => {
                if (typeof arg === 'string') {
                    return arg.replace(/\n/g, '--newline--');
                }

                return arg;
            };

            const code: string = `
                    const input1 = ${
                        serialize(args['input-1'] as string) || ''
                    };

                    const input2 = ${
                        serialize(args['input-2'] as string) || ''
                    };
                    
                    return input1 ${
                        (args['operator'] as string) || '=='
                    } input2`;

            const returnResult: ReturnResult = await VMUtil.runCodeInSandbox({
                code,
                options: {
                    args: args as JSONObject,
                },
            });

            const logMessages: string[] = returnResult.logMessages;

            // add to option.log
            logMessages.forEach((msg: string) => {
                options.log(msg);
            });

            if (returnResult.returnValue) {
                return {
                    returnValues: {},
                    executePort: yesPort,
                };
            }

            return {
                returnValues: {},
                executePort: noPort,
            };
        } catch (err: any) {
            options.log('Error running script');
            options.log(
                err.message ? err.message : JSON.stringify(err, null, 2)
            );
            throw options.onError(err);
        }
    }
}
