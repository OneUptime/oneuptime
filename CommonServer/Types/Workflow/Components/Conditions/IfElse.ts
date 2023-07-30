import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import Components from 'Common/Types/Workflow/Components/Condition';
import ComponentCode, { RunOptions, RunReturnType } from '../../ComponentCode';
import VM, { VMScript } from 'vm2';

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

            const vm: VM.NodeVM = new VM.NodeVM({
                timeout: 5000,
                allowAsync: true,
                sandbox: {
                    args: args,
                    console: {
                        log: (logValue: JSONValue) => {
                            options.log(logValue);
                        },
                    },
                },
            });

            const serialize: Function = (arg: any): any => {
                if (typeof arg === 'string') {
                    return arg.replace(/\n/g, '--newline--');
                }

                return arg;
            };

            const script: VMScript = new VMScript(
                `module.exports = function() {  
                    
                    const input1 = ${
                        serialize(args['input-1'] as string) || ''
                    };

                    const input2 = ${
                        serialize(args['input-2'] as string) || ''
                    };
                    
                    return input1 ${
                        (args['operator'] as string) || '=='
                    } input2 }`
            ).compile();

            const functionToRun: any = vm.run(script);

            const returnVal: any = await functionToRun();

            if (returnVal) {
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
