import URL from "../../Types/API/URL";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Typeof from "../../Types/Typeof";

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
    } catch {
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
