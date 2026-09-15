import CookieUtil from "../../../Server/Utils/Cookie";
import Protocol from "../../../Types/API/Protocol";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Dictionary from "../../../Types/Dictionary";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import express, { Express } from "express";
import {
  ClientRequest,
  IncomingMessage,
  request as httpRequest,
  Server,
} from "http";
import { AddressInfo } from "net";

describe("CookieUtils", () => {
  let mockRequest: ExpressRequest;
  let mockResponse: ExpressResponse;

  beforeEach(() => {
    mockRequest = {
      cookies: {},
      secure: true,
    } as ExpressRequest;

    mockResponse = { req: mockRequest } as unknown as ExpressResponse;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  test("Should set a cookie", () => {
    const cookie: JSONObject = {
      name: "testName",
      value: "testValue",
      options: {},
    };

    mockResponse.cookie = jest.fn();
    CookieUtil.setCookie(
      mockResponse,
      cookie["name"] as string,
      cookie["value"] as string,
      cookie["options"] as JSONObject,
    );

    expect(mockResponse.cookie).toHaveBeenCalledWith(
      cookie["name"] as string,
      cookie["value"] as string,
      { path: "/", sameSite: "lax", secure: true },
    );
  });

  describe("secure cookie defaults", () => {
    test("marks cookies Secure when the public protocol is HTTPS", () => {
      expect(
        CookieUtil.getCookieOptions(
          {},
          {
            protocol: Protocol.HTTPS,
            provisionSsl: false,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    });

    test("marks cookies Secure when this deployment provisions TLS", () => {
      expect(
        CookieUtil.getCookieOptions(
          {},
          {
            protocol: Protocol.HTTP,
            provisionSsl: true,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    });

    test("marks cookies Secure when Express observes direct TLS", () => {
      expect(
        CookieUtil.getCookieOptions(
          {},
          {
            protocol: Protocol.HTTP,
            provisionSsl: false,
            requestIsSecure: true,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    });

    test("keeps an explicitly configured HTTP deployment usable", () => {
      expect(
        CookieUtil.getCookieOptions(
          {},
          {
            protocol: Protocol.HTTP,
            provisionSsl: false,
            requestIsSecure: false,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "lax",
      });
    });

    test("does not let a call site downgrade an HTTPS cookie", () => {
      expect(
        CookieUtil.getCookieOptions(
          { secure: false },
          {
            protocol: Protocol.HTTPS,
            provisionSsl: false,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    });

    test("preserves an explicit Secure opt-in on an HTTP deployment", () => {
      expect(
        CookieUtil.getCookieOptions(
          { secure: true },
          {
            protocol: Protocol.HTTP,
            provisionSsl: false,
            requestIsSecure: false,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "lax",
        secure: true,
      });
    });

    test("preserves cookie-specific restrictions and lifetime", () => {
      expect(
        CookieUtil.getCookieOptions(
          {
            httpOnly: true,
            maxAge: 60_000,
            sameSite: "strict",
          },
          {
            protocol: Protocol.HTTPS,
            provisionSsl: false,
          },
        ),
      ).toEqual({
        path: "/",
        sameSite: "strict",
        httpOnly: true,
        maxAge: 60_000,
        secure: true,
      });
    });

    test("preserves a narrower caller-supplied cookie path", () => {
      expect(
        CookieUtil.getCookieOptions(
          { path: "/identity" },
          {
            protocol: Protocol.HTTPS,
            provisionSsl: false,
          },
        ),
      ).toEqual({
        path: "/identity",
        sameSite: "lax",
        secure: true,
      });
    });

    test("serializes matching Secure attributes when TLS terminates upstream", async () => {
      const app: Express = express();
      app.set("trust proxy", true);
      app.get("/", (_req: ExpressRequest, res: ExpressResponse): void => {
        CookieUtil.setCookie(res, "session", "value", { httpOnly: true });
        CookieUtil.removeCookie(res, "expired", { httpOnly: true });
        res.status(204).end();
      });

      const server: Server = app.listen(0);
      await new Promise<void>((resolve: () => void) => {
        server.once("listening", resolve);
      });

      try {
        const address: AddressInfo = server.address() as AddressInfo;
        const setCookieHeaders: Array<string> = await new Promise<
          Array<string>
        >(
          (
            resolve: (headers: Array<string>) => void,
            reject: (error: Error) => void,
          ): void => {
            const request: ClientRequest = httpRequest(
              {
                host: "127.0.0.1",
                port: address.port,
                path: "/",
                headers: { "X-Forwarded-Proto": "https" },
              },
              (response: IncomingMessage): void => {
                response.resume();
                response.on("end", () => {
                  resolve(response.headers["set-cookie"] || []);
                });
              },
            );
            request.on("error", reject);
            request.end();
          },
        );

        expect(setCookieHeaders).toContain(
          "session=value; Path=/; HttpOnly; Secure; SameSite=Lax",
        );
        expect(setCookieHeaders).toContain(
          "expired=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; HttpOnly; Secure; SameSite=Lax",
        );
      } finally {
        await new Promise<void>(
          (resolve: () => void, reject: (error: Error) => void): void => {
            server.close((error?: Error): void => {
              if (error) {
                reject(error);
                return;
              }
              resolve();
            });
          },
        );
      }
    });
  });

  test("Should return a cookie", () => {
    const cookieName: string = "testName";
    const cookieValue: string = "testValue";

    mockRequest.cookies[cookieName] = cookieValue;
    const value: string | undefined = CookieUtil.getCookieFromExpressRequest(
      mockRequest,
      cookieName,
    );

    expect(value).toBe(value);
  });

  test("Should remove a cookie", () => {
    const cookieName: string = "testName";

    mockResponse.clearCookie = jest.fn();
    CookieUtil.removeCookie(mockResponse, cookieName);

    expect(mockResponse.clearCookie).toHaveBeenCalledWith(cookieName, {
      path: "/",
      sameSite: "lax",
      secure: true,
    });
  });

  test("Should return all cookies", () => {
    const value: string = "testValue";
    mockRequest.cookies = { testName: value };
    const cookies: Dictionary<string> = CookieUtil.getAllCookies(mockRequest);

    expect(cookies).toEqual({ testName: value });
  });

  test("Should return empty object if there are no cookies", () => {
    mockRequest.cookies = {};
    const cookies: Dictionary<string> = CookieUtil.getAllCookies(mockRequest);

    expect(cookies).toEqual({});
  });

  test("Should return user token key", () => {
    const id: string = "123456789";
    const keyWithId: string = CookieUtil.getUserTokenKey(new ObjectID(id));
    const keyWithoutId: string = CookieUtil.getUserTokenKey();

    expect(keyWithId).toBe(`user-token-${id}`);
    expect(keyWithoutId).toBe("user-token");
  });

  test("Should return SSO key", () => {
    const ssoKey: string = CookieUtil.getSSOKey();

    expect(ssoKey).toBe("sso-");
  });

  test("Should return user SSO key", () => {
    const id: string = "123456789";
    const userSsoKey: string = CookieUtil.getUserSSOKey(new ObjectID(id));

    expect(userSsoKey).toBe(`sso-${id}`);
  });

  test("Should remove all cookies", () => {
    const cookies: Dictionary<string> = {
      testName1: "testValue1",
      testName2: "testValue2",
    };

    mockRequest.cookies = cookies;
    mockResponse.clearCookie = jest.fn();
    CookieUtil.removeAllCookies(mockRequest, mockResponse);

    expect(mockResponse.clearCookie).toHaveBeenCalledWith(
      Object.keys(cookies)[0],
      { path: "/", sameSite: "lax", secure: true },
    );
    expect(mockResponse.clearCookie).toHaveBeenCalledWith(
      Object.keys(cookies)[1],
      { path: "/", sameSite: "lax", secure: true },
    );
  });
});
