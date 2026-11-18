import { ExpressRequest, ExpressResponse } from "Common/Server/Utils/Express";
import Dictionary from "Common/Types/Dictionary";
import { expect } from "@jest/globals";

/*
 * A BROWSER'S COOKIES, FOR ONE HOST, AND THE SET-COOKIE HEADERS THAT CHANGE
 * THEM - AS THE BROWSER READS THEM.
 *
 * Whether a sign-out leaves a browser signed out is not a question of which
 * clearCookie calls the server made, but of what the browser does with the
 * Set-Cookie headers it is sent: a cookie is its name, its domain and its
 * path (RFC 6265, 5.3), so a clear on another path clears nothing, and a
 * clear sent over plain HTTP cannot touch a Secure cookie (RFC 6265bis,
 * "Leave Secure Cookies Alone"). So the server's responses here are written
 * by Express itself - Common's Express 4, which the server runs - into real
 * header strings, and this jar keeps, replaces and removes cookies by the
 * storage model's rules, and sends each request what a browser would: the
 * cookies that have not run out, whose path its path matches, Secure ones
 * only over HTTPS.
 */

export interface SetCookie {
  name: string;
  value: string;
  // Its attributes, as the header says them; names lower case.
  path: string | undefined;
  domain: string | undefined;
  expires: Date | undefined;
  maxAge: number | undefined;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | undefined;
  header: string;
}

export interface StoredCookie {
  name: string;
  value: string;
  path: string;
  // The host it is for: set without Domain, a host-only cookie.
  host: string;
  expiresAtMs: number | null;
  secure: boolean;
  httpOnly: boolean;
  sameSite: string | undefined;
}

// One Set-Cookie header, as a browser parses it (RFC 6265, 5.2).
export function parseSetCookie(header: string): SetCookie {
  const [pair, ...attributes] = header.split(";");
  const separator: number = (pair || "").indexOf("=");

  const parsed: SetCookie = {
    name: (pair || "").slice(0, separator).trim(),
    value: (pair || "").slice(separator + 1).trim(),
    path: undefined,
    domain: undefined,
    expires: undefined,
    maxAge: undefined,
    secure: false,
    httpOnly: false,
    sameSite: undefined,
    header: header,
  };

  for (const attribute of attributes) {
    const equals: number = attribute.indexOf("=");
    const key: string = (equals === -1 ? attribute : attribute.slice(0, equals))
      .trim()
      .toLowerCase();
    const value: string =
      equals === -1 ? "" : attribute.slice(equals + 1).trim();

    if (key === "path") {
      parsed.path = value;
    } else if (key === "domain") {
      parsed.domain = value.replace(/^\./, "").toLowerCase();
    } else if (key === "expires") {
      parsed.expires = new Date(value);
    } else if (key === "max-age") {
      parsed.maxAge = Number(value);
    } else if (key === "secure") {
      parsed.secure = true;
    } else if (key === "httponly") {
      parsed.httpOnly = true;
    } else if (key === "samesite") {
      parsed.sameSite = value.toLowerCase();
    }
  }

  return parsed;
}

// RFC 6265, 5.1.4.
function pathMatches(requestPath: string, cookiePath: string): boolean {
  if (requestPath === cookiePath) {
    return true;
  }

  return (
    requestPath.startsWith(cookiePath) &&
    (cookiePath.endsWith("/") || requestPath[cookiePath.length] === "/")
  );
}

// RFC 6265, 5.1.4: the directory of the request's path.
function defaultPath(requestPath: string): string {
  if (!requestPath.startsWith("/") || requestPath.lastIndexOf("/") === 0) {
    return "/";
  }

  return requestPath.slice(0, requestPath.lastIndexOf("/"));
}

export interface Transport {
  // Whether the browser reached the server over HTTPS.
  isHttps: boolean;
  // The path of the request the answer is to.
  requestPath: string;
}

export default class BrowserCookieJar {
  private readonly host: string;

  private cookies: Array<StoredCookie> = [];

  public constructor(host: string) {
    this.host = host.toLowerCase();
  }

  // What the browser does with an answer's Set-Cookie headers (RFC 6265, 5.3).
  public take(headers: Array<string>, transport: Transport): void {
    for (const header of headers) {
      this.store(parseSetCookie(header), transport);
    }
  }

  // The cookies the browser sends with a request to `requestPath`.
  public cookiesFor(
    requestPath: string,
    transport: { isHttps: boolean },
  ): Dictionary<string> {
    const sent: Dictionary<string> = {};

    // Longer paths first (RFC 6265, 5.4): the first of a name is the one a server keeps.
    const matching: Array<StoredCookie> = this.unexpired()
      .filter((cookie: StoredCookie): boolean => {
        return (
          pathMatches(requestPath, cookie.path) &&
          (transport.isHttps || !cookie.secure)
        );
      })
      .sort((a: StoredCookie, b: StoredCookie): number => {
        return b.path.length - a.path.length;
      });

    for (const cookie of matching) {
      if (sent[cookie.name] === undefined) {
        sent[cookie.name] = cookie.value;
      }
    }

    return sent;
  }

  // Every cookie the browser keeps, on any path.
  public all(): Array<StoredCookie> {
    return this.unexpired();
  }

  public cookie(name: string, path?: string): StoredCookie | undefined {
    return this.unexpired().find((cookie: StoredCookie): boolean => {
      return (
        cookie.name === name && (path === undefined || cookie.path === path)
      );
    });
  }

  private unexpired(): Array<StoredCookie> {
    const now: number = Date.now();

    this.cookies = this.cookies.filter((cookie: StoredCookie): boolean => {
      return cookie.expiresAtMs === null || cookie.expiresAtMs > now;
    });

    return this.cookies;
  }

  private store(setCookie: SetCookie, transport: Transport): void {
    // A Domain this host is not in is refused; none is a host-only cookie.
    if (
      setCookie.domain !== undefined &&
      setCookie.domain !== this.host &&
      !this.host.endsWith(`.${setCookie.domain}`)
    ) {
      return;
    }

    // A Secure cookie sent over plain HTTP is refused (RFC 6265bis, 5.6).
    if (setCookie.secure && !transport.isHttps) {
      return;
    }

    const path: string =
      setCookie.path && setCookie.path.startsWith("/")
        ? setCookie.path
        : defaultPath(transport.requestPath);

    /*
     * Leave Secure Cookies Alone: over plain HTTP, nothing replaces - or
     * removes - a Secure cookie of the name on a path this one matches.
     */
    if (
      !transport.isHttps &&
      this.cookies.some((existing: StoredCookie): boolean => {
        return (
          existing.secure &&
          existing.name === setCookie.name &&
          pathMatches(path, existing.path)
        );
      })
    ) {
      return;
    }

    // Max-Age wins over Expires; either in the past removes the cookie.
    const expiresAtMs: number | null =
      setCookie.maxAge !== undefined && !Number.isNaN(setCookie.maxAge)
        ? Date.now() + setCookie.maxAge * 1000
        : setCookie.expires !== undefined
          ? setCookie.expires.getTime()
          : null;

    // A cookie is its name, its domain and its path: the one it replaces.
    this.cookies = this.cookies.filter((existing: StoredCookie): boolean => {
      return !(existing.name === setCookie.name && existing.path === path);
    });

    if (expiresAtMs !== null && expiresAtMs <= Date.now()) {
      return;
    }

    this.cookies.push({
      name: setCookie.name,
      value: setCookie.value,
      path: path,
      host: this.host,
      expiresAtMs: expiresAtMs,
      secure: setCookie.secure,
      httpOnly: setCookie.httpOnly,
      sameSite: setCookie.sameSite,
    });
  }
}

/*
 * A response as Express writes it: res.cookie and res.clearCookie are
 * Express 4's own - Common's copy, which the server runs - and write the
 * Set-Cookie headers a browser receives. Everything else a handler calls
 * is the test's (Response is stood in for).
 */
export interface WrittenResponse {
  res: ExpressResponse;
  setCookies: () => Array<string>;
}

export function writtenResponse(req: ExpressRequest): WrittenResponse {
  const express: { response: Record<string, unknown> } = jest.requireActual(
    "Common/node_modules/express",
  );

  const headers: Map<string, unknown> = new Map<string, unknown>();

  const res: Record<string, unknown> = Object.create(express.response);

  res["req"] = req;
  res["locals"] = {};
  res["setHeader"] = (name: string, value: unknown): unknown => {
    headers.set(name.toLowerCase(), value);
    return res;
  };
  res["getHeader"] = (name: string): unknown => {
    return headers.get(name.toLowerCase());
  };
  res["removeHeader"] = (name: string): void => {
    headers.delete(name.toLowerCase());
  };

  return {
    res: res as unknown as ExpressResponse,
    setCookies: (): Array<string> => {
      const value: unknown = headers.get("set-cookie");

      if (value === undefined) {
        return [];
      }

      return Array.isArray(value) ? value.map(String) : [String(value)];
    },
  };
}

/*
 * Each cookie a sign-out cleared was cleared as it was set: the same path,
 * the same Domain (none), Secure as it was, and the same SameSite - the
 * attributes that decide whether the browser applies the clear.
 */
export function expectClearedAsSet(data: {
  set: Array<string>;
  cleared: Array<string>;
}): void {
  const setByName: Map<string, SetCookie> = new Map<string, SetCookie>();

  for (const header of data.set) {
    const setCookie: SetCookie = parseSetCookie(header);

    // A clear the sign-in itself wrote (a flag taken away) set nothing.
    if (setCookie.value !== "") {
      setByName.set(`${setCookie.name} ${setCookie.path}`, setCookie);
    }
  }

  const clearedByName: Map<string, SetCookie> = new Map<string, SetCookie>();

  for (const header of data.cleared) {
    const setCookie: SetCookie = parseSetCookie(header);
    clearedByName.set(`${setCookie.name} ${setCookie.path}`, setCookie);
  }

  for (const [key, set] of setByName) {
    const cleared: SetCookie | undefined = clearedByName.get(key);

    expect({ cookie: key, cleared: cleared !== undefined }).toEqual({
      cookie: key,
      cleared: true,
    });

    expect({
      cookie: key,
      value: cleared!.value,
      path: cleared!.path,
      domain: cleared!.domain,
      secure: cleared!.secure,
      sameSite: cleared!.sameSite,
      expired:
        (cleared!.expires?.getTime() ?? Infinity) <= Date.now() ||
        (cleared!.maxAge !== undefined && cleared!.maxAge <= 0),
    }).toEqual({
      cookie: key,
      value: "",
      path: set.path,
      domain: set.domain,
      secure: set.secure,
      sameSite: set.sameSite,
      expired: true,
    });
  }
}
