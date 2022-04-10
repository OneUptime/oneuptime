import URL from 'Common/Types/api/url';
import Email from 'Common/Types/email';
import { JSONValue } from 'Common/Types/JSON';

export default class LocalStorage {
    public static setItem(key: string, value: JSONValue | Email | URL) {
        localStorage.setItem(key, value.toString());
    }

    public static getItem(key: string): JSONValue {
        return localStorage.getItem(key) as JSONValue;
    }

    public static removeItem(key: string): void {
        return localStorage.removeItem(key);
    }

    public static clear() {
        localStorage.clear();
    }
}
