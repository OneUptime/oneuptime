import { CookieOptions } from "express";
import { ExpressRequest, ExpressResponse } from "./Express";

export default class CookieUtil { 
    // set cookie with express response

    public static setCookie(res: ExpressResponse, name: string, value: string, options: CookieOptions) {
        res.cookie(name, value, options);
    }

    // get cookie with express request

    public static getCookie(req: ExpressRequest, name: string) {
        return req.cookies[name];
    }

    // delete cookie with express response

    public static removeCookie(res: ExpressResponse, name: string) {
        res.clearCookie(name);
    }

    // get all cookies with express request
    public static getAllCookies(req: ExpressRequest) {
        return req.cookies;
    }

}