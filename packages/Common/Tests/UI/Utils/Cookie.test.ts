import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import Cookie from "../../../UI/Utils/Cookie";
import CookieName from "../../../Types/CookieName";
import Route from "../../../Types/API/Route";
import Email from "../../../Types/Email";
import URL from "../../../Types/API/URL";
import { JSONObject, JSONValue } from "../../../Types/JSON";

/*
 * Cookie is a thin wrapper around universal-cookie, which in jsdom writes
 * straight through to `document.cookie`. Rather than mocking the library, these
 * tests observe the real cookie jar and, where the exact attributes matter
 * (Path, Max-Age, HttpOnly), record every raw string assigned to
 * `document.cookie` so the serialized header can be asserted.
 */

const cookieDescriptor: PropertyDescriptor = Object.getOwnPropertyDescriptor(
  Document.prototype,
  "cookie",
) as PropertyDescriptor;

let cookieWrites: Array<string> = [];

const installCookieWriteRecorder: () => void = (): void => {
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
};

const uninstallCookieWriteRecorder: () => void = (): void => {
  // Remove the own-property override so the prototype accessor is used again.
  delete (document as unknown as { cookie?: string }).cookie;
};

const readRawJar: () => { [key: string]: string } = (): {
  [key: string]: string;
} => {
  const jar: { [key: string]: string } = {};
  const raw: string = document.cookie;

  if (!raw) {
    return jar;
  }

  for (const part of raw.split(";")) {
    const index: number = part.indexOf("=");
    const name: string = part.slice(0, index).trim();
    const value: string = part.slice(index + 1).trim();
    jar[name] = decodeURIComponent(value);
  }

  return jar;
};

const expireEverything: () => void = (): void => {
  const paths: Array<string> = ["/", "/dashboard", "/dashboard/project"];

  for (const name of Object.keys(readRawJar())) {
    for (const path of paths) {
      document.cookie = `${name}=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=${path}`;
    }
  }
};

const lastWriteFor: (name: string) => string = (name: string): string => {
  const writes: Array<string> = cookieWrites.filter((write: string) => {
    return write.startsWith(`${name}=`);
  });

  expect(writes.length).toBeGreaterThan(0);
  return writes[writes.length - 1] as string;
};

describe("UI Cookie util", () => {
  beforeEach(() => {
    window.history.replaceState({}, "", "/");
    expireEverything();
    cookieWrites = [];
    installCookieWriteRecorder();
  });

  afterEach(() => {
    uninstallCookieWriteRecorder();
    window.history.replaceState({}, "", "/");
    expireEverything();
  });

  describe("setItem", () => {
    it("stores a plain string value unchanged at the root path by default", () => {
      Cookie.setItem(CookieName.UserID, "user-123");

      expect(readRawJar()[CookieName.UserID]).toBe("user-123");

      const write: string = lastWriteFor(CookieName.UserID);
      expect(write).toContain("Path=/");
      expect(write).not.toContain("HttpOnly");
      expect(write).not.toContain("Max-Age");
    });

    it("URL-encodes characters that are not legal in a cookie value", () => {
      const value: string = "Jane Doe; admin=true, héllo";

      Cookie.setItem(CookieName.Name, value);

      const write: string = lastWriteFor(CookieName.Name);
      /*
       * The raw header must not contain the separator characters verbatim,
       * otherwise "; admin=true" would be read as a cookie attribute.
       */
      expect(write.split(";")[0]).not.toContain(" ");
      expect(write.split(";")[0]).not.toContain(",");
      expect(write).not.toContain("admin=true");

      expect(readRawJar()[CookieName.Name]).toBe(value);
      expect(Cookie.getItem(CookieName.Name)).toBe(value);
    });

    it("uses the supplied Route as the cookie path", () => {
      Cookie.setItem(CookieName.Timezone, "UTC", {
        path: new Route("/dashboard"),
      });

      expect(lastWriteFor(CookieName.Timezone)).toContain("Path=/dashboard");

      // A cookie scoped to /dashboard is not visible from the root.
      expect(readRawJar()[CookieName.Timezone]).toBeUndefined();

      window.history.replaceState({}, "", "/dashboard/home");
      expect(readRawJar()[CookieName.Timezone]).toBe("UTC");
    });

    it("does not set Max-Age when maxAgeInDays is omitted or zero", () => {
      Cookie.setItem(CookieName.UserID, "a", {
        path: new Route("/"),
      });
      expect(lastWriteFor(CookieName.UserID)).not.toContain("Max-Age");

      Cookie.setItem(CookieName.UserID, "b", {
        path: new Route("/"),
        maxAgeInDays: 0,
      });
      expect(lastWriteFor(CookieName.UserID)).not.toContain("Max-Age");
      expect(readRawJar()[CookieName.UserID]).toBe("b");
    });

    it("sets a Max-Age attribute when maxAgeInDays is provided", () => {
      Cookie.setItem(CookieName.UserID, "persistent", {
        path: new Route("/"),
        maxAgeInDays: 30,
      });

      const write: string = lastWriteFor(CookieName.UserID);
      const match: RegExpMatchArray | null = write.match(/Max-Age=(\d+)/);

      expect(match).not.toBeNull();
      // At minimum the cookie must live for the requested 30 days.
      expect(Number(match![1])).toBeGreaterThanOrEqual(30 * 24 * 60 * 60);
      expect(readRawJar()[CookieName.UserID]).toBe("persistent");
    });

    /*
     * universal-cookie (and the Set-Cookie spec) interpret maxAge in SECONDS,
     * but Cookie.setItem passes OneUptimeDate.getMillisecondsInDays(), so a
     * 1-day cookie is written with Max-Age=86400000 (~1000 days). This test
     * documents the expected behaviour and is marked `failing` until the
     * source is fixed; when it starts passing, drop the `.failing`.
     */
    it.failing(
      "writes Max-Age in seconds (1 day => 86400) [known bug: uses milliseconds]",
      () => {
        Cookie.setItem(CookieName.UserID, "one-day", {
          path: new Route("/"),
          maxAgeInDays: 1,
        });

        expect(lastWriteFor(CookieName.UserID)).toContain("Max-Age=86400;");
      },
    );

    it("currently writes Max-Age in milliseconds (1 day => 86400000)", () => {
      Cookie.setItem(CookieName.UserID, "one-day", {
        path: new Route("/"),
        maxAgeInDays: 1,
      });

      expect(lastWriteFor(CookieName.UserID)).toContain("Max-Age=86400000");
    });

    it("adds the HttpOnly attribute when requested, which browsers then refuse to store from script", () => {
      Cookie.setItem(CookieName.Token, "secret", {
        path: new Route("/"),
        httpOnly: true,
      });

      expect(lastWriteFor(CookieName.Token)).toContain("HttpOnly");
      // document.cookie cannot create HttpOnly cookies, so nothing is stored.
      expect(readRawJar()[CookieName.Token]).toBeUndefined();
      expect(Cookie.exists(CookieName.Token)).toBe(false);
    });

    it("JSON-serializes plain objects and getItem returns an equal object", () => {
      const value: JSONObject = { a: 1, nested: { b: "two" }, list: [1, 2] };

      Cookie.setItem(CookieName.UserID, value);

      expect(JSON.parse(readRawJar()[CookieName.UserID] as string)).toEqual(
        value,
      );
      expect(Cookie.getItem(CookieName.UserID)).toEqual(value);
    });

    it("serializes an Email value object into its typed JSON form", () => {
      Cookie.setItem(CookieName.Email, new Email("jane@example.com"));

      const stored: JSONObject = JSON.parse(
        readRawJar()[CookieName.Email] as string,
      ) as JSONObject;

      expect(stored["_type"]).toBe("Email");
      expect(stored["value"]).toBe("jane@example.com");
    });

    it("serializes a URL value object into its typed JSON form", () => {
      Cookie.setItem(
        CookieName.UserID,
        URL.fromString("https://oneuptime.com/dashboard"),
      );

      const stored: JSONObject = JSON.parse(
        readRawJar()[CookieName.UserID] as string,
      ) as JSONObject;

      expect(stored["_type"]).toBe("URL");
      expect(stored["value"]).toBe("https://oneuptime.com/dashboard");
    });

    it("accepts arbitrary string keys as well as CookieName members", () => {
      Cookie.setItem("custom-cookie", "custom-value");

      expect(readRawJar()["custom-cookie"]).toBe("custom-value");
    });

    it("overwrites a previous value for the same key and path", () => {
      Cookie.setItem(CookieName.UserID, "first");
      Cookie.setItem(CookieName.UserID, "second");

      expect(readRawJar()[CookieName.UserID]).toBe("second");
      expect(Cookie.getItem(CookieName.UserID)).toBe("second");
    });
  });

  describe("getItem", () => {
    it("returns undefined for a cookie that does not exist", () => {
      expect(Cookie.getItem(CookieName.UserID)).toBeUndefined();
    });

    it("returns non-JSON strings as-is", () => {
      document.cookie = `${CookieName.UserID}=plain-text; path=/`;

      expect(Cookie.getItem(CookieName.UserID)).toBe("plain-text");
    });

    it("parses JSON primitives stored in the cookie", () => {
      document.cookie = `${CookieName.IsMasterAdmin}=true; path=/`;
      document.cookie = `${CookieName.ProfilePicID}=42; path=/`;

      expect(Cookie.getItem(CookieName.IsMasterAdmin)).toBe(true);
      expect(Cookie.getItem(CookieName.ProfilePicID)).toBe(42);
    });

    it("returns falsy parsed values without attempting to deserialize them", () => {
      document.cookie = `${CookieName.IsMasterAdmin}=false; path=/`;
      document.cookie = `${CookieName.ProfilePicID}=0; path=/`;

      expect(Cookie.getItem(CookieName.IsMasterAdmin)).toBe(false);
      expect(Cookie.getItem(CookieName.ProfilePicID)).toBe(0);
    });

    it("decodes percent-encoded cookie values written by the server", () => {
      document.cookie = `${CookieName.Email}=${encodeURIComponent(
        "jane+test@example.com",
      )}; path=/`;

      expect(Cookie.getItem(CookieName.Email)).toBe("jane+test@example.com");
    });

    it("strips the express 'j:' prefix from JSON cookies", () => {
      document.cookie = `${CookieName.UserID}=${encodeURIComponent(
        'j:{"id":"abc"}',
      )}; path=/`;

      expect(Cookie.getItem(CookieName.UserID)).toEqual({ id: "abc" });
    });

    it("returns the typed JSON (not a rehydrated instance) for a stored Email", () => {
      Cookie.setItem(CookieName.Email, new Email("jane@example.com"));

      const value: JSONValue = Cookie.getItem(CookieName.Email);

      /*
       * universal-cookie already JSON.parses the value, so getItem's own
       * JSON5 parse of `value.toString()` ("[object Object]") throws and the
       * raw object is returned without deserializeValue being applied.
       */
      expect(value).toEqual({ _type: "Email", value: "jane@example.com" });
      expect(value).not.toBeInstanceOf(Email);
    });
  });

  describe("exists", () => {
    it("is false for a missing cookie and true once set", () => {
      expect(Cookie.exists(CookieName.UserID)).toBe(false);

      Cookie.setItem(CookieName.UserID, "abc");

      expect(Cookie.exists(CookieName.UserID)).toBe(true);
    });

    it("treats a cookie whose parsed value is falsy as not existing", () => {
      document.cookie = `${CookieName.IsMasterAdmin}=false; path=/`;
      document.cookie = `${CookieName.ProfilePicID}=0; path=/`;
      document.cookie = `${CookieName.Name}=; path=/`;

      expect(readRawJar()[CookieName.IsMasterAdmin]).toBe("false");
      expect(Cookie.exists(CookieName.IsMasterAdmin)).toBe(false);
      expect(Cookie.exists(CookieName.ProfilePicID)).toBe(false);
      expect(Cookie.exists(CookieName.Name)).toBe(false);
    });
  });

  describe("removeItem", () => {
    it("removes a root-path cookie when called from the root", () => {
      Cookie.setItem(CookieName.UserID, "abc");
      expect(Cookie.exists(CookieName.UserID)).toBe(true);

      Cookie.removeItem(CookieName.UserID);

      expect(Cookie.exists(CookieName.UserID)).toBe(false);
      expect(readRawJar()[CookieName.UserID]).toBeUndefined();

      const write: string = lastWriteFor(CookieName.UserID);
      expect(write).toContain("Max-Age=0");
      expect(write).toContain("Expires=");
    });

    it("is a no-op for a cookie that does not exist", () => {
      expect(() => {
        Cookie.removeItem(CookieName.UserID);
      }).not.toThrow();
      expect(Cookie.exists(CookieName.UserID)).toBe(false);
    });

    it("does not send a Path attribute, so it misses root cookies when the page is on a nested route", () => {
      Cookie.setItem(CookieName.UserID, "abc", { path: new Route("/") });

      window.history.replaceState({}, "", "/dashboard/project/overview");
      Cookie.removeItem(CookieName.UserID);

      expect(lastWriteFor(CookieName.UserID)).not.toContain("Path=");
      /*
       * Without a Path the browser defaults to the current directory
       * (/dashboard/project), which does not match the "/" cookie, so it
       * survives. Documented here as current behaviour.
       */
      expect(readRawJar()[CookieName.UserID]).toBe("abc");
    });

    it("leaves other cookies intact", () => {
      Cookie.setItem(CookieName.UserID, "abc");
      Cookie.setItem(CookieName.Name, "Jane");

      Cookie.removeItem(CookieName.UserID);

      expect(Cookie.exists(CookieName.UserID)).toBe(false);
      expect(Cookie.getItem(CookieName.Name)).toBe("Jane");
    });
  });

  describe("clearAllCookies", () => {
    it("removes every cookie named in the CookieName enum", () => {
      for (const name of Object.values(CookieName)) {
        Cookie.setItem(name, `value-${name}`);
      }

      for (const name of Object.values(CookieName)) {
        expect(Cookie.exists(name)).toBe(true);
      }

      Cookie.clearAllCookies();

      for (const name of Object.values(CookieName)) {
        expect(Cookie.exists(name)).toBe(false);
      }
      expect(readRawJar()).toEqual({});
    });

    it("clears root-path cookies even when invoked from a nested route", () => {
      Cookie.setItem(CookieName.Token, "t");
      Cookie.setItem(CookieName.RefreshToken, "r");

      window.history.replaceState({}, "", "/dashboard/project/overview");
      Cookie.clearAllCookies();

      expect(readRawJar()[CookieName.Token]).toBeUndefined();
      expect(readRawJar()[CookieName.RefreshToken]).toBeUndefined();

      for (const name of Object.values(CookieName)) {
        expect(lastWriteFor(name)).toContain("Path=/");
      }
    });

    it("does not remove cookies outside the CookieName enum", () => {
      Cookie.setItem("third-party-cookie", "keep-me");
      Cookie.setItem(CookieName.UserID, "abc");

      Cookie.clearAllCookies();

      expect(readRawJar()["third-party-cookie"]).toBe("keep-me");
      expect(Cookie.exists(CookieName.UserID)).toBe(false);
    });

    it("does not remove enum cookies scoped to a non-root path", () => {
      Cookie.setItem(CookieName.Timezone, "UTC", {
        path: new Route("/dashboard"),
      });

      Cookie.clearAllCookies();

      window.history.replaceState({}, "", "/dashboard/home");
      expect(readRawJar()[CookieName.Timezone]).toBe("UTC");
    });
  });
});
