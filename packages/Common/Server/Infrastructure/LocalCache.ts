import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Dictionary from "../../Types/Dictionary";
import { JSONValue } from "../../Types/JSON";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export default abstract class LocalCache {
  private static cache: Dictionary<JSONValue | BaseModel> = {};

  @CaptureSpan()
  public static setJSON(
    namespace: string,
    key: string,
    value: JSONValue,
  ): void {
    this.cache[namespace + "." + key] = value;
  }

  @CaptureSpan()
  public static setString(namespace: string, key: string, value: string): void {
    this.cache[namespace + "." + key] = value;
  }

  @CaptureSpan()
  public static setNumber(namespace: string, key: string, value: number): void {
    this.cache[namespace + "." + key] = value;
  }

  @CaptureSpan()
  public static setModel(
    namespace: string,
    key: string,
    value: BaseModel,
  ): void {
    this.cache[namespace + "." + key] = value;
  }

  @CaptureSpan()
  public static getModel<TBaseModel extends BaseModel>(
    namespace: string,
    key: string,
  ): TBaseModel {
    return this.cache[namespace + "." + key] as TBaseModel;
  }

  @CaptureSpan()
  public static getJSON(namespace: string, key: string): JSONValue {
    return this.cache[namespace + "." + key] as JSONValue;
  }

  @CaptureSpan()
  public static getString(namespace: string, key: string): string {
    return this.cache[namespace + "." + key] as string;
  }

  @CaptureSpan()
  public static getNumber(namespace: string, key: string): number {
    return this.cache[namespace + "." + key] as number;
  }

  @CaptureSpan()
  public static async getOrSetString(
    namespace: string,
    key: string,
    getStringFunction: () => Promise<string>,
  ): Promise<string> {
    if (!LocalCache.getString(namespace, key)) {
      LocalCache.setString(namespace, key, await getStringFunction());
    }

    return LocalCache.getString(namespace, key);
  }

  @CaptureSpan()
  public static hasValue(namespace: string, key: string): boolean {
    return Boolean(this.cache[namespace + "." + key]);
  }
}
