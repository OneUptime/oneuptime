import URL from 'Common/Types/API/URL';
import Email from 'Common/Types/Email';
import { JSONValue } from 'Common/Types/JSON';

export default class LocalStorage {
    public static setItem(key: string, value: JSONValue | Email | URL): void {
        if (typeof value === 'object') {
            // if of type jsonobject.
            value = JSON.stringify(value);
        }
        localStorage.setItem(key, value as string);
    }

    public static getItem(key: string): JSONValue {
        const value: JSONValue = localStorage.getItem(key) as JSONValue;

        try {
            if (value) {
                return JSON.parse(value?.toString());
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
}
