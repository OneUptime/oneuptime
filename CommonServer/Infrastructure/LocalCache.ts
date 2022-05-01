import BaseModel from 'Common/Models/BaseModel';
import Dictionary from 'Common/Types/Dictionary';
import { JSONValue } from 'Common/Types/JSON';

export default abstract class LocalCache {
    private static cache: Dictionary<JSONValue | BaseModel> = {};

    public static setJSON(namespace: string, key: string, value: JSONValue): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static setModel(namespace: string, key: string, value: BaseModel): void {
        this.cache[namespace + '.' + key] = value;
    }

    public static getModel<TBaseModel extends BaseModel>(namespace: string, key: string): TBaseModel {
        return this.cache[namespace + '.' + key] as TBaseModel;
    }

    public static getJSON(namespace: string, key: string): JSONValue {
        return this.cache[namespace + '.' + key] as JSONValue;
    }

    public static hasValue(namespace: string, key: string): boolean {
        return Boolean(this.cache[namespace + '.' + key]);
    }
}
