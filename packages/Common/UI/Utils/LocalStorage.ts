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

  /*
   * Removes everything the browser keeps for this address but the keys named,
   * a key nobody here has heard of included.
   *
   * One key at a time, not a clear and a write back. A clear tells every other
   * open tab that everything is gone (a storage event with no key), and a tab
   * following one of these keys would redraw without it, however soon it came
   * back. A key left alone tells nobody anything.
   */
  public static clearExcept(keysToKeep: ReadonlyArray<string>): void {
    const keys: Array<string> = [];

    // Read first: removing a key renumbers the ones after it.
    for (let index: number = 0; index < localStorage.length; index++) {
      const key: string | null = localStorage.key(index);

      if (key !== null) {
        keys.push(key);
      }
    }

    for (const key of keys) {
      if (!keysToKeep.includes(key)) {
        localStorage.removeItem(key);
      }
    }
  }

  public static getAllItems(): Dictionary<string> {
    return { ...localStorage };
  }
}
