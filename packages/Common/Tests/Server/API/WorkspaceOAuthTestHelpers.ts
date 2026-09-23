import http from "http";
import { AddressInfo } from "net";
import crypto from "crypto";
import express from "express";
import cookieParser from "cookie-parser";
import {
  ExpressRequest,
  ExpressResponse,
  ExpressRouter,
  NextFunction,
} from "../../../Server/Utils/Express";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { JSONObject } from "../../../Types/JSON";

/*
 * Shared scaffolding for the Slack and Microsoft Teams OAuth state tests.
 *
 * Those tests run the real routers on a real express app and talk to it over
 * HTTP, so cookies, redirects and query strings behave the way a browser sees
 * them. Two pieces are faked: the session middleware (so a test can say who is
 * signed in without minting JWTs) and Redis (an in-memory map with TTLs).
 */

// Headers the fake session middleware reads.
export const TEST_USER_HEADER: string = "x-test-user-id";
export const TEST_PERMISSIONS_HEADER: string = "x-test-permissions";
export const TEST_MEMBER_OF_HEADER: string = "x-test-member-of";

/*
 * Stands in for UserMiddleware.getUserMiddleware. Like the real one it lets
 * anonymous requests through and takes the project from the `tenantid`
 * header; a test grants membership (and the permissions it carries) in
 * whichever project it names.
 */
export function fakeGetUserMiddleware(
  req: ExpressRequest,
  _res: ExpressResponse,
  next: NextFunction,
): void {
  const request: any = req as any;
  const userId: string | undefined = req.headers[TEST_USER_HEADER] as
    | string
    | undefined;
  const tenantId: string | undefined = req.headers["tenantid"] as
    | string
    | undefined;
  const memberOf: string | undefined =
    (req.headers[TEST_MEMBER_OF_HEADER] as string | undefined) || tenantId;
  const permissions: Array<string> = (
    (req.headers[TEST_PERMISSIONS_HEADER] as string | undefined) || ""
  )
    .split(",")
    .filter(Boolean);

  if (userId) {
    request.userAuthorization = { userId: new ObjectID(userId) };
    request.userType = UserType.User;
  }

  if (tenantId) {
    request.tenantId = new ObjectID(tenantId);
  }

  if (userId && memberOf && permissions.length > 0) {
    request.userTenantAccessPermission = {
      [memberOf]: {
        _type: "UserTenantAccessPermission",
        projectId: new ObjectID(memberOf),
        permissions: permissions.map((permission: string) => {
          return {
            _type: "UserPermission",
            permission: permission,
            labelIds: [],
            isBlockPermission: false,
          };
        }),
      },
    };
  }

  next();
}

export type CacheEntry = { value: string; expiresAt: number };

/*
 * An in-memory GlobalCache that honours TTLs against Date.now(). The backing
 * map is exposed as `store` so a test can see what was recorded.
 */
export function createInMemoryGlobalCache(): {
  store: Map<string, CacheEntry>;
  setString: jest.Mock;
  getAndDeleteString: jest.Mock;
} {
  const store: Map<string, CacheEntry> = new Map();

  return {
    store,
    setString: jest.fn(
      async (
        namespace: string,
        key: string,
        value: string,
        options?: { expiresInSeconds: number },
      ): Promise<void> => {
        store.set(`${namespace}-${key}`, {
          value,
          expiresAt: Date.now() + (options?.expiresInSeconds ?? 2592000) * 1000,
        });
      },
    ),
    getAndDeleteString: jest.fn(
      async (namespace: string, key: string): Promise<string | null> => {
        const cacheKey: string = `${namespace}-${key}`;
        const entry: CacheEntry | undefined = store.get(cacheKey);
        store.delete(cacheKey);

        if (!entry || entry.expiresAt <= Date.now()) {
          return null;
        }

        return entry.value;
      },
    ),
  };
}

export interface ProbeResponse {
  status: number;
  body: unknown;
  location: string | undefined;
  setCookies: Record<string, string>;
}

/*
 * The jest environment is jsdom, which has no global fetch, so requests go
 * through Node's http client.
 */
export function httpGet(data: {
  port: number;
  path: string;
  headers?: http.OutgoingHttpHeaders | undefined;
}): Promise<ProbeResponse> {
  return httpRequest({ ...data, method: "GET" });
}

// Like httpGet, for any method; a `body` is sent as JSON.
export function httpRequest(data: {
  port: number;
  method: string;
  path: string;
  headers?: http.OutgoingHttpHeaders | undefined;
  body?: unknown;
}): Promise<ProbeResponse> {
  const payload: string | undefined =
    data.body === undefined ? undefined : JSON.stringify(data.body);

  const headers: http.OutgoingHttpHeaders = { ...(data.headers || {}) };

  if (payload !== undefined) {
    headers["content-type"] = "application/json";
    headers["content-length"] = Buffer.byteLength(payload);
  }

  return new Promise<ProbeResponse>(
    (
      resolve: (result: ProbeResponse) => void,
      reject: (error: Error) => void,
    ) => {
      const request: http.ClientRequest = http.request(
        {
          host: "127.0.0.1",
          port: data.port,
          path: data.path,
          method: data.method,
          headers: headers,
        },
        (response: http.IncomingMessage) => {
          const chunks: Array<Buffer> = [];

          response.on("data", (chunk: Buffer) => {
            chunks.push(chunk);
          });

          response.on("end", () => {
            const raw: string = Buffer.concat(chunks).toString("utf8");

            let parsed: unknown = null;
            try {
              parsed = raw ? JSON.parse(raw) : null;
            } catch {
              parsed = raw;
            }

            const setCookies: Record<string, string> = {};

            for (const cookie of response.headers["set-cookie"] || []) {
              const [pair] = cookie.split(";");
              const separator: number = (pair || "").indexOf("=");
              if (separator > 0) {
                setCookies[pair!.substring(0, separator)] = decodeURIComponent(
                  pair!.substring(separator + 1),
                );
              }
            }

            resolve({
              status: response.statusCode || 0,
              body: parsed,
              location: response.headers["location"],
              setCookies,
            });
          });
        },
      );

      request.on("error", (error: Error) => {
        return reject(error);
      });

      if (payload !== undefined) {
        request.write(payload);
      }

      request.end();
    },
  );
}

// Serialises a cookie jar into a Cookie request header.
export function cookieHeader(cookies: Record<string, string>): string {
  return Object.keys(cookies)
    .map((name: string) => {
      return `${name}=${encodeURIComponent(cookies[name]!)}`;
    })
    .join("; ");
}

export interface RunningApp {
  port: number;
  close: () => Promise<void>;
}

// Mounts routers under /api on a real express app with cookie and JSON parsing.
export async function startApp(
  routers: Array<ExpressRouter>,
): Promise<RunningApp> {
  const app: express.Express = express();
  app.use(cookieParser());
  app.use(express.json());

  for (const router of routers) {
    app.use("/api", router as any);
  }

  const server: http.Server = http.createServer(app);

  await new Promise<void>((resolve: () => void) => {
    server.listen(0, "127.0.0.1", resolve);
  });

  return {
    port: (server.address() as AddressInfo).port,
    close: () => {
      return new Promise<void>((resolve: () => void) => {
        server.close(() => {
          return resolve();
        });
      });
    },
  };
}

// Query parameters of an absolute URL, decoded.
export function queryOf(url: string): URLSearchParams {
  return new globalThis.URL(url).searchParams;
}

// An unsigned JWT with the given claims (the callers never verify signatures).
export function makeUnsignedJwt(claims: JSONObject): string {
  const encode: (value: JSONObject) => string = (value: JSONObject): string => {
    return Buffer.from(JSON.stringify(value)).toString("base64url");
  };

  return `${encode({ alg: "RS256", typ: "JWT" })}.${encode(claims)}.${crypto
    .randomBytes(16)
    .toString("base64url")}`;
}
