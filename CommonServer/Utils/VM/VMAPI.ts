import { JSONObject, JSONValue } from 'Common/Types/JSON';
import API from 'Common/Utils/API';
import ReturnResult from 'Common/Types/IsolatedVM/ReturnResult';
import Protocol from 'Common/Types/API/Protocol';
import URL from 'Common/Types/API/URL';
import { IsolatedVMHostname } from '../../EnvironmentConfig';
import Route from 'Common/Types/API/Route';
import ClusterKeyAuthorization from '../../Middleware/ClusterKeyAuthorization';
import HTTPErrorResponse from 'Common/Types/API/HTTPErrorResponse';
import HTTPResponse from 'Common/Types/API/HTTPResponse';

export default class VMUtil {
    public static async runCodeInSandbox(data: {
        code: string;
        options: {
            args?: JSONObject | undefined;
        };
    }): Promise<ReturnResult> {
        const returnResultHttpResponse:
            | HTTPErrorResponse
            | HTTPResponse<JSONObject> = await API.post<JSONObject>(
            new URL(
                Protocol.HTTP,
                IsolatedVMHostname,
                new Route('/isolated-vm/run-code')
            ),
            {
                ...data,
            },
            {
                ...ClusterKeyAuthorization.getClusterKeyHeaders(),
            }
        );

        if (returnResultHttpResponse instanceof HTTPErrorResponse) {
            throw returnResultHttpResponse;
        }

        const returnResult: ReturnResult = returnResultHttpResponse.data as any;

        return returnResult;
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
