import LocalStorage from "../UI/Utils/LocalStorage";
import { JSONObject } from "../Types/JSON";

export enum UserPreferenceType {
  BaseModelTablePageSize = "BaseModelTablePageSize",
  BaseModelTableColumns = "BaseModelTableColumns",
}

export default class UserPreferences {
  public static getUserPreferenceByTypeAsNumber(data: {
    key: string;
    userPreferenceType: UserPreferenceType;
  }): number | null {
    const { key, userPreferenceType } = data;

    const finalKey: string = `${userPreferenceType}.${key}`;
    const numberValue: number | null = LocalStorage.getItem(finalKey) as
      | number
      | null;

    return numberValue;
  }

  // save user preference
  public static saveUserPreferenceByTypeAsNumber(data: {
    key: string;
    userPreferenceType: UserPreferenceType;
    value: number;
  }): void {
    const { key, userPreferenceType, value } = data;

    const finalKey: string = `${userPreferenceType}.${key}`;
    LocalStorage.setItem(finalKey, value);
  }

  /*
   * Object-shaped preferences (e.g. a table's column layout). LocalStorage
   * already JSON-serializes objects on the way in and parses them on the way
   * out, so this only has to reject anything that came back as something other
   * than a plain object - a half-written or hand-edited entry must degrade to
   * "no preference" rather than reaching the caller as a string or an array.
   */
  public static getUserPreferenceByTypeAsJSON(data: {
    key: string;
    userPreferenceType: UserPreferenceType;
  }): JSONObject | null {
    const { key, userPreferenceType } = data;

    const finalKey: string = `${userPreferenceType}.${key}`;

    let value: unknown = null;

    try {
      value = LocalStorage.getItem(finalKey);
    } catch {
      return null;
    }

    if (!value || typeof value !== "object" || Array.isArray(value)) {
      return null;
    }

    return value as JSONObject;
  }

  public static saveUserPreferenceByTypeAsJSON(data: {
    key: string;
    userPreferenceType: UserPreferenceType;
    value: JSONObject;
  }): void {
    const { key, userPreferenceType, value } = data;

    const finalKey: string = `${userPreferenceType}.${key}`;
    LocalStorage.setItem(finalKey, value);
  }

  public static removeUserPreferenceByType(data: {
    key: string;
    userPreferenceType: UserPreferenceType;
  }): void {
    const { key, userPreferenceType } = data;

    const finalKey: string = `${userPreferenceType}.${key}`;
    LocalStorage.removeItem(finalKey);
  }
}
