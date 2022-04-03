import URL from 'common/types/api/url';
import Email from 'common/types/email';
import { JSONValue } from 'common/types/JSON';

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
