/**
 * @jest-environment-options {"url": "https://oneuptime.example.com/dashboard"}
 */
import Cookie from "../../../UI/Utils/Cookie";
import CookieName from "../../../Types/CookieName";
import Route from "../../../Types/API/Route";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";

/*
 * The HTTPS half of Cookie.test.ts.
 *
 * What a page on HTTPS writes into a cookie stays on HTTPS: Cookie.setItem
 * marks it Secure, so the browser never sends it with a plain-HTTP request
 * to the same host - a typed http:// address, an old link, or a navigation
 * someone on the network slips into another page. The server does the same
 * for every cookie it sets (CookieUtil.setCookie).
 *
 * jsdom fixes a document's origin for the life of a test file, so this file
 * is given an https page by the pragma above.
 */

const SECURE_ATTRIBUTE: RegExp = /;\s*Secure(;|$)/i;

const cookieDescriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "cookie",
) as PropertyDescriptor;

let cookieWrites: Array<string> = [];

beforeEach((): void => {
  cookieWrites = [];

  Object.defineProperty(document, "cookie", {
    configurable: true,
    get: (): string => {
      return cookieDescriptor.get!.call(document) as string;
    },
    set: (value: string): void => {
      cookieWrites.push(value);
      cookieDescriptor.set!.call(document, value);
    },
  });
});

afterEach((): void => {
  delete (document as unknown as { cookie?: string }).cookie;

  for (const name of [CookieName.UserID, CookieName.Timezone]) {
    for (const path of ["/", "/dashboard"]) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
    }
  }
});

function lastWriteFor(name: string): string {
  const writes: Array<string> = cookieWrites.filter((write: string) => {
    return write.startsWith(`${name}=`);
  });

  expect(writes.length).toBeGreaterThan(0);
  return writes[writes.length - 1] as string;
}

describe("Cookie on an https page", () => {
  test("the test page really is https (the pragma took effect)", () => {
    expect(window.location.protocol).toBe("https:");
    expect(Cookie.isPageOnHttps()).toBe(true);
  });

  test("setItem writes the cookie Secure", () => {
    Cookie.setItem(CookieName.UserID, "user-123");

    expect(lastWriteFor(CookieName.UserID)).toMatch(SECURE_ATTRIBUTE);
    expect(Cookie.getItem(CookieName.UserID)).toBe("user-123");
  });

  test("on its own path and with its own lifetime too", () => {
    Cookie.setItem(CookieName.Timezone, "UTC", {
      path: new Route("/dashboard"),
      maxAgeInDays: 30,
    });

    const write: string = lastWriteFor(CookieName.Timezone);

    expect(write).toMatch(SECURE_ATTRIBUTE);
    expect(write).toContain("Path=/dashboard");
    expect(write).toContain("Max-Age=");
  });
});
