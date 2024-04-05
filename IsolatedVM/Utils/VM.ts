import { JSONObject, JSONValue } from "Common/Types/JSON";
import http from "http";
import https from "https";
import axios from "axios";
import vm from "node:vm";

export default class VMUtil {
    public static async runCodeInSandbox(
        code: string,
        options: {
            timeout?: number;
            allowAsync?: boolean;
            includeHttpPackage: boolean;
            consoleLog?: (logValue: JSONValue) => void | undefined;
            args?: JSONObject | undefined;
        }
    ): Promise<any> {
        let sandbox: any = {};

        if (options.includeHttpPackage) {
            sandbox = {
                ...sandbox,
                http: http,
                https: https,
                axios: axios,
            };
        }

        if (options.args) {
            sandbox = {
                ...sandbox,
                args: options.args,
            };
        }

        if (options.consoleLog) {
            sandbox = {
                ...sandbox,
                console: {
                    log: options.consoleLog,
                },
            };
        }

        vm.createContext(sandbox); // Contextify the object.

        const script: string = `module.exports = async function(args) { ${(code as string) || ''} }`;

        const returnVal: any = vm.runInContext(script, sandbox); // run the script 

        return returnVal;
    }
}