import BadDataException from 'Common/Types/Exception/BadDataException';
import { JSONObject } from 'Common/Types/JSON';
import ComponentMetadata, { Port } from 'Common/Types/Workflow/Component';
import ComponentID from 'Common/Types/Workflow/ComponentID';
import LogComponents from 'Common/Types/Workflow/Components/Log';
import ComponentCode, { RunReturnType } from '../ComponentCode';
import VM, { VMScript } from 'vm2';
import axios from 'axios';
import http from 'http';
import https from 'https';

export default class JavaScirptCode extends ComponentCode {
    public constructor() {
        super();

        const JavaScirptComponent: ComponentMetadata | undefined =
            LogComponents.find((i: ComponentMetadata) => {
                return i.id === ComponentID.Log;
            });

        if (!JavaScirptComponent) {
            throw new BadDataException('Custom JavaScirpt Component not found.');
        }

        this.setMetadata(JavaScirptComponent);
    }

    public override async run(args: JSONObject): Promise<RunReturnType> {

        const successPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'success';
            }
        );

        if (!successPort) {
            throw new BadDataException('Success port not found');
        }


        const errorPort: Port | undefined = this.getMetadata().outPorts.find(
            (p: Port) => {
                return p.id === 'error';
            }
        );

        if (!errorPort) {
            throw new BadDataException('Error port not found');
        }

        try {

            // Set timeout
            // Inject args
            // Inject dependencies

            const vm = new VM.NodeVM({
                timeout: 5000,
                sandbox: {
                    args: args['arguments'],
                    axios: axios,
                    http: http,
                    https: https,
                }
            })
            
            const script = new VMScript(args['code'] as string || '').compile();
            
            const returnVal = await vm.run(script);

            return {
                returnValues: {
                    returnValue: returnVal
                },
                executePort: successPort,
                logs: this.logs,
            }
            
        } catch (err) {
            this.log("Error running script");
            this.log(JSON.stringify(err, null, 2));
            return {
                returnValues: {

                },
                executePort: errorPort,
                logs: this.logs,
            }
        }

        
    }
}
