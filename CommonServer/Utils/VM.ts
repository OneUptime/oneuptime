import { JSONObject, JSONValue } from 'Common/Types/JSON';
import VM, { VMScript } from 'vm2';
import axios from 'axios';
import http from 'http';
import https from 'https';
import JSONFunctions from 'Common/Types/JSONFunctions';

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

        const vm: VM.NodeVM = new VM.NodeVM({
            timeout: options.timeout || 5000,
            allowAsync: options.allowAsync || false,
            sandbox: sandbox,
        });

        const script: VMScript = new VMScript(
            `module.exports = async function(args) { ${
                (code as string) || ''
            } }`
        ).compile();

        const functionToRun: any = vm.run(script);

        const returnVal: any = await functionToRun(
            JSONFunctions.parse(
                (JSON.stringify(options.args) as string) || '{}'
            )
        );

        return returnVal;
    }

    public static replaceValueInPlace(
        storageMap: JSONObject,
        valueToReplaceInPlace: string,
        isJSON: boolean | undefined
    ): string {
        if (
            typeof valueToReplaceInPlace === 'string' &&
            valueToReplaceInPlace.toString().includes('{{') &&
            valueToReplaceInPlace.toString().includes('}}')
        ) {
            let valueToReplaceInPlaceCopy: string =
                valueToReplaceInPlace.toString();
            const variablesInArgument: Array<string> = [];

            const regex: RegExp = /{{(.*?)}}/g; // Find all matches of the regular expression and capture the word between the braces {{x}} => x

            let match: RegExpExecArray | null = null;

            while ((match = regex.exec(valueToReplaceInPlaceCopy)) !== null) {
                if (match[1]) {
                    variablesInArgument.push(match[1]);
                }
            }

            for (const variable of variablesInArgument) {
                const valueToReplaceInPlace: string = VMUtil.deepFind(
                    storageMap as any,
                    variable as any
                ) as string;

                if (
                    valueToReplaceInPlaceCopy.trim() ===
                    '{{' + variable + '}}'
                ) {
                    valueToReplaceInPlaceCopy = valueToReplaceInPlace;
                } else {
                    valueToReplaceInPlaceCopy =
                        valueToReplaceInPlaceCopy.replace(
                            '{{' + variable + '}}',
                            isJSON
                                ? VMUtil.serializeValueForJSON(
                                      valueToReplaceInPlace
                                  )
                                : `${valueToReplaceInPlace}`
                        );
                }
            }

            valueToReplaceInPlace = valueToReplaceInPlaceCopy;
        }

        return valueToReplaceInPlace;
    }

    public static serializeValueForJSON(value: string): string {
        if (!value) {
            return value;
        }

        if (typeof value !== 'string') {
            value = JSON.stringify(value);
        } else {
            value = value
                .split('\t')
                .join('\\t')
                .split('\n')
                .join('\\n')
                .split('\r')
                .join('\\r')
                .split('\b')
                .join('\\b')
                .split('\f')
                .join('\\f')
                .split('"')
                .join('\\"');
        }

        return value;
    }

    public static deepFind(obj: JSONObject, path: string): JSONValue {
        const paths: Array<string> = path.split('.');
        let current: any = JSON.parse(JSON.stringify(obj));

        for (let i: number = 0; i < paths.length; ++i) {
            const key: string | undefined = paths[i];

            if (!key) {
                return undefined;
            }
            const openBracketIndex: number = key.indexOf('[');
            const closeBracketIndex: number = key.indexOf(']');

            if (openBracketIndex !== -1 && closeBracketIndex !== -1) {
                const arrayKey: string = key.slice(0, openBracketIndex);
                const indexString: string = key.slice(
                    openBracketIndex + 1,
                    closeBracketIndex
                );
                let index: number = 0;

                if (indexString !== 'last') {
                    index = parseInt(indexString);
                } else {
                    index = current[arrayKey].length - 1;
                }

                if (
                    Array.isArray(current[arrayKey]) &&
                    current[arrayKey][index]
                ) {
                    current = current[arrayKey][index];
                } else {
                    return undefined;
                }
            } else if (current && current[key] !== undefined) {
                current = current[key];
            } else {
                return undefined;
            }
        }

        return current;
    }
}
