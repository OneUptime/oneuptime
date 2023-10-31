import { JSONObject } from 'Common/Types/JSON';
import CookieUtil from '../../Utils/Cookie';
import { ExpressRequest, ExpressResponse } from '../../Utils/Express';
import ObjectID from 'Common/Types/ObjectID';
import Dictionary from 'Common/Types/Dictionary';

describe('CookieUtils', () => {
    let mockRequest: ExpressRequest;
    let mockResponse: ExpressResponse;

    beforeEach(() => {
        mockRequest = {
            cookies: {},
        } as ExpressRequest;

        mockResponse = {} as ExpressResponse;
    });

    afterEach(() => {
        jest.clearAllMocks();
    });

    test('Should set a cookie', () => {
        const cookie: JSONObject = {
            name: 'testName',
            value: 'testValue',
            options: {},
        };

        mockResponse.cookie = jest.fn();
        CookieUtil.setCookie(
            mockResponse,
            cookie['name'] as string,
            cookie['value'] as string,
            cookie['options'] as JSONObject
        );

        expect(mockResponse.cookie).toHaveBeenCalledWith(
            cookie['name'] as string,
            cookie['value'] as string,
            cookie['options'] as JSONObject
        );
    });

    test('Should return a cookie', () => {
        const cookieName: string = 'testName';
        const cookieValue: string = 'testValue';

        mockRequest.cookies[cookieName] = cookieValue;
        const value: string | undefined = CookieUtil.getCookie(
            mockRequest,
            cookieName
        );

        expect(value).toBe(value);
    });

    test('Should remove a cookie', () => {
        const cookieName: string = 'testName';

        mockResponse.clearCookie = jest.fn();
        CookieUtil.removeCookie(mockResponse, cookieName);

        expect(mockResponse.clearCookie).toHaveBeenCalledWith(cookieName);
    });

    test('Should return all cookies', () => {
        const value: string = 'testValue';
        mockRequest.cookies = { testName: value };
        const cookies: Dictionary<string> =
            CookieUtil.getAllCookies(mockRequest);

        expect(cookies).toEqual({ testName: value });
    });

    test('Should return empty object if there are no cookies', () => {
        mockRequest.cookies = undefined;
        const cookies: Dictionary<string> =
            CookieUtil.getAllCookies(mockRequest);

        expect(cookies).toEqual({});
    });

    test('Should return user token key', () => {
        const id: string = '123456789';
        const keyWithId: string = CookieUtil.getUserTokenKey(new ObjectID(id));
        const keyWithoutId: string = CookieUtil.getUserTokenKey();

        expect(keyWithId).toBe(`user-token-${id}`);
        expect(keyWithoutId).toBe('user-token');
    });

    test('Should return SSO key', () => {
        const ssoKey: string = CookieUtil.getSSOKey();

        expect(ssoKey).toBe('sso-');
    });

    test('Should return user SSO key', () => {
        const id: string = '123456789';
        const userSsoKey: string = CookieUtil.getUserSSOKey(new ObjectID(id));

        expect(userSsoKey).toBe(`sso-${id}`);
    });

    test('Should remove all cookies', () => {
        const cookies: Dictionary<string> = {
            testName1: 'testValue1',
            testName2: 'testValue2',
        };

        mockRequest.cookies = cookies;
        mockResponse.clearCookie = jest.fn();
        CookieUtil.removeAllCookies(mockRequest, mockResponse);

        expect(mockResponse.clearCookie).toHaveBeenCalledWith(
            Object.keys(cookies)[0]
        );
        expect(mockResponse.clearCookie).toHaveBeenCalledWith(
            Object.keys(cookies)[1]
        );
    });
});
