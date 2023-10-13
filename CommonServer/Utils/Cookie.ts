import { CookieOptions } from 'express';
import { ExpressRequest, ExpressResponse } from './Express';
import ObjectID from 'Common/Types/ObjectID';
import Dictionary from 'Common/Types/Dictionary';

export default class CookieUtil {
    // set cookie with express response

    public static setCookie(
        res: ExpressResponse,
        name: string,
        value: string,
        options: CookieOptions
    ): void {
        res.cookie(name, value, options);
    }

    // get cookie with express request

    public static getCookie(
        req: ExpressRequest,
        name: string
    ): string | undefined {
        return req.cookies[name];
    }

    // delete cookie with express response

    public static removeCookie(res: ExpressResponse, name: string): void {
        res.clearCookie(name);
    }

    // get all cookies with express request
    public static getAllCookies(req: ExpressRequest): Dictionary<string> {
        return req.cookies || {};
    }

    public static getUserTokenKey(id?: ObjectID): string {
        if (!id) {
            return `user-token`;
        }

        return `user-token-${id.toString()}`;
    }

    public static getUserSSOKey(id: ObjectID): string {
        return `${this.getSSOKey()}${id.toString()}`;
    }

    public static getSSOKey(): string {
        return `sso-`;
    }

    // delete all cookies.
    public static removeAllCookies(
        req: ExpressRequest,
        res: ExpressResponse
    ): void {
        const cookies: Dictionary<string> = this.getAllCookies(req);
        for (const key in cookies) {
            this.removeCookie(res, key);
        }
    }
}
