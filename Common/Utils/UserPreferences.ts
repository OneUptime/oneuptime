import LocalStorage from "../UI/Utils/LocalStorage";

export enum UserPreferenceType {
  BaseModelTablePageSize = "BaseModelTablePageSize",
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
}
