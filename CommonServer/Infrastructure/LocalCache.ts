import Dictionary from 'Common/Types/Dictionary';
import { JSONValue } from 'Common/Types/JSON';

export default abstract class LocalCache {
    private static cache: Dictionary<JSONValue> = {};

    public static set(namespace: string, key: string, value: JSONValue): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static get(namespace: string, key: string): JSONValue {
        return this.cache[namespace + '.' + key] as JSONValue;
    }

    public static hasValue(namespace: string, key: string): boolean {
        return Boolean(this.cache[namespace + '.' + key]);
    }
}
