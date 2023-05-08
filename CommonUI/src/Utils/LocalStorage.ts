import URL from 'Common/Types/API/URL';
import Email from 'Common/Types/Email';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import Typeof from 'Common/Types/Typeof';
import JSONFunctions from 'Common/Types/JSONFunctions';
import { Dictionary } from 'lodash';

export default class LocalStorage {
    public static setItem(key: string, value: JSONValue | Email | URL): void {
        if (typeof value === Typeof.Object) {
            // if of type jsonobject.
            value = JSON.stringify(
                JSONFunctions.serializeValue(value as JSONValue) as JSONObject
            );
        }
        localStorage.setItem(key, value as string);
    }

    public static getItem(key: string): JSONValue {
        const value: JSONValue = localStorage.getItem(key) as JSONValue;

        try {
            if (value) {
                return JSONFunctions.deserializeValue(
                    JSONFunctions.parse(value?.toString())
                );
            }
            return value;
        } catch (err) {
            return value;
        }
    }

    public static removeItem(key: string): void {
        return localStorage.removeItem(key);
    }

    public static clear(): void {
        localStorage.clear();
    }

    public static getAllItems(): Dictionary<string> {
        return { ...localStorage };
    }
}
