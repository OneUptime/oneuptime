import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Typeof from "../../Types/Typeof";

export default class LocalStorage {
  public static setItem(key: string, value: JSONValue | Email | URL): void {
    if (typeof value === Typeof.Object) {
      // if of type jsonobject.
      value = JSON.stringify(
        JSONFunctions.serializeValue(value as JSONValue) as JSONObject,
      );
    }
    localStorage.setItem(key, value as string);
  }

  public static getItem(key: string): JSONValue {
    const value: JSONValue = localStorage.getItem(key) as JSONValue;

    try {
      if (value) {
        return JSONFunctions.deserializeValue(
          JSONFunctions.parse(value?.toString()),
        );
      }
      return value;
    } catch {
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
