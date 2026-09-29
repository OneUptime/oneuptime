import Route from "../../Types/API/Route";
import URL from "../../Types/API/URL";
import OneUptimeDate from "../../Types/Date";
import Email from "../../Types/Email";
import { JSONObject, JSONValue } from "../../Types/JSON";
import JSONFunctions from "../../Types/JSONFunctions";
import Typeof from "../../Types/Typeof";
import UniversalCookies, { CookieSetOptions } from "universal-cookie";
import CookieName from "../../Types/CookieName";

export default class Cookie {
  public static clearAllCookies(): void {
    const cookies: UniversalCookies = new UniversalCookies();

    // Remove all cookies defined in CookieName enum
    Object.values(CookieName).forEach((cookieName: string) => {
      cookies.remove(cookieName, { path: "/" });
    });
  }

  public static setItem(
    key: CookieName | string,
    value: JSONValue | Email | URL,
    options?:
      | {
          httpOnly?: boolean | undefined;
          path: Route;
          maxAgeInDays?: number | undefined;
        }
      | undefined,
  ): void {
    if (typeof value === Typeof.Object) {
      // if of type jsonobject.
      value = JSON.stringify(
        JSONFunctions.serializeValue(value as JSONValue) as JSONObject,
      );
    }

    const cookies: UniversalCookies = new UniversalCookies();

    const cookieOptions: CookieSetOptions = {
      httpOnly: options?.httpOnly || false,
      path: options?.path ? options.path.toString() : "/",
    };

    if (options?.maxAgeInDays) {
      cookieOptions.maxAge = OneUptimeDate.getMillisecondsInDays(
        options.maxAgeInDays,
      );
    }

    cookies.set(key, value as string, cookieOptions);
  }

  public static getItem(cookieName: CookieName): JSONValue {
    const cookies: UniversalCookies = new UniversalCookies();
    const value: JSONValue = cookies.get(cookieName) as JSONValue;

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

  public static removeItem(key: CookieName): void {
    const cookies: UniversalCookies = new UniversalCookies();
    cookies.remove(key);
  }

  // check if cookie exists
  public static exists(key: CookieName): boolean {
    const cookies: UniversalCookies = new UniversalCookies();
    return Boolean(cookies.get(key));
  }
}
