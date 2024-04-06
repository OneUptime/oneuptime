import { JSONObject, JSONValue } from "Common/Types/JSON";
import http from "http";
import https from "https";
import axios from "axios";
import vm, { Context } from "node:vm";

export default class VMUtil {
    public static async runCodeInSandbox(
        code: string,
        options: {
            timeout?: number;
            args?: JSONObject | undefined;
        }
    ): Promise<{
        returnValue: any;
        logMessages: string[];
    }> {

        let logMessages: string[] = [];

        let sandbox: Context = {
            console: {
                log: (...args: JSONValue[]) => {
                    logMessages.push(args.join(' '));
                },
            },
            http: http,
            https: https,
            axios: axios,
        };

        if (options.args) {
            sandbox = {
                ...sandbox,
                args: options.args,
            };
        }

        vm.createContext(sandbox); // Contextify the object.

        const script: string = `module.exports = async function(args) { ${(code as string) || ''} }`;

        const returnVal: any = vm.runInContext(script, sandbox, {
            timeout: options.timeout || 5000,
        }); // run the script 

        return {
            returnValue: returnVal,
            logMessages,
        };
    }
}