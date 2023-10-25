import URL from 'Common/Types/API/URL';
import Email from 'Common/Types/Email';
import { JSONObject, JSONValue } from 'Common/Types/JSON';
import Typeof from 'Common/Types/Typeof';
import JSONFunctions from 'Common/Types/JSONFunctions';
import UniversalCookies, { CookieSetOptions } from 'universal-cookie';
import Route from 'Common/Types/API/Route';
import OneUptimeDate from 'Common/Types/Date';

export default class Cookie {
    public static setItem(
        key: string,
        value: JSONValue | Email | URL,
        options?:
            | {
                  httpOnly?: boolean | undefined;
                  path: Route;
                  maxAgeInDays?: number | undefined;
              }
            | undefined
    ): void {
        if (typeof value === Typeof.Object) {
            // if of type jsonobject.
            value = JSON.stringify(
                JSONFunctions.serializeValue(value as JSONValue) as JSONObject
            );
        }

        const cookies: UniversalCookies = new UniversalCookies();

        const cookieOptions: CookieSetOptions = {
            httpOnly: options?.httpOnly || false,
            path: options?.path ? options.path.toString() : '/',
        };

        if (options?.maxAgeInDays) {
            cookieOptions.maxAge = OneUptimeDate.getMillisecondsInDays(
                options.maxAgeInDays
            );
        }

        cookies.set(key, value as string, cookieOptions);
    }

    public static getItem(key: string): JSONValue {
        const cookies: UniversalCookies = new UniversalCookies();
        const value: JSONValue = cookies.get(key) as JSONValue;

        try {
            if (value) {
                return JSONFunctions.deserializeValue(
                    JSONFunctions.parse(value?.toString())
                );
            }
            return value;
        } catch (err) {
            return value;
        }
    }

    public static removeItem(key: string): void {
        const cookies: UniversalCookies = new UniversalCookies();
        cookies.remove(key);
    }

    // check if cookie exists
    public static exists(key: string): boolean {
        const cookies: UniversalCookies = new UniversalCookies();
        return Boolean(cookies.get(key));
    }
}
