import URL from "Common/Types/API/URL";
import Dictionary from "Common/Types/Dictionary";
import Email from "Common/Types/Email";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import JSONFunctions from "Common/Types/JSONFunctions";
import Typeof from "Common/Types/Typeof";

export default class SessionStorage {
    public static setItem(key: string, value: JSONValue | Email | URL): void {
        if (typeof value === Typeof.Object) {
            // if of type jsonobject.
            value = JSON.stringify(
                JSONFunctions.serializeValue(value as JSONValue) as JSONObject,
            );
        }
        sessionStorage.setItem(key, value as string);
    }

    public static getItem(key: string): JSONValue {
        const value: JSONValue = sessionStorage.getItem(key) as JSONValue;

        try {
            if (value) {
                return JSONFunctions.deserializeValue(
                    JSONFunctions.parse(value?.toString()),
                );
            }
            return value;
        } catch (err) {
            return value;
        }
    }

    public static removeItem(key: string): void {
        return sessionStorage.removeItem(key);
    }

    public static clear(): void {
        sessionStorage.clear();
    }

    public static getAllItems(): Dictionary<string> {
        return { ...sessionStorage };
    }
}
