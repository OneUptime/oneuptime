import BaseModel from 'Common/Models/BaseModel';
import Dictionary from 'Common/Types/Dictionary';
import { JSONValue } from 'Common/Types/JSON';

export default abstract class LocalCache {
    private static cache: Dictionary<JSONValue | BaseModel> = {};

    public static setJSON(
        namespace: string,
        key: string,
        value: JSONValue
    ): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static setString(
        namespace: string,
        key: string,
        value: string
    ): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static setNumber(
        namespace: string,
        key: string,
        value: number
    ): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static setModel(
        namespace: string,
        key: string,
        value: BaseModel
    ): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static getModel<TBaseModel extends BaseModel>(
        namespace: string,
        key: string
    ): TBaseModel {
        return this.cache[namespace + '.' + key] as TBaseModel;
    }

    public static getJSON(namespace: string, key: string): JSONValue {
        return this.cache[namespace + '.' + key] as JSONValue;
    }

    public static getString(namespace: string, key: string): string {
        return this.cache[namespace + '.' + key] as string;
    }

    public static getNumber(namespace: string, key: string): number {
        return this.cache[namespace + '.' + key] as number;
    }

    public static async getOrSetString(
        namespace: string,
        key: string,
        getStringFunction: () => Promise<string>
    ): Promise<string> {
        if (!LocalCache.getString(namespace, key)) {
            LocalCache.setString(namespace, key, await getStringFunction());
        }

        return LocalCache.getString(namespace, key);
    }

    public static hasValue(namespace: string, key: string): boolean {
        return Boolean(this.cache[namespace + '.' + key]);
    }
}
