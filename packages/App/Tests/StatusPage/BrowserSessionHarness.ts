import Dictionary from "Common/Types/Dictionary";

/*
 * Just enough browser for the status page and public dashboard API clients.
 *
 * App's tests run in Jest's node environment, and these clients are browser
 * code: their Config reads window.location when it is first imported, and
 * their session state lives in localStorage. Rather than pull a DOM into App's
 * test setup, importing this module installs a window, a location and two
 * in-memory storages (see the bottom of the file), so it must be the FIRST
 * import of a test that uses it. setPageUrl then moves between pages.
 */

export class MemoryStorage {
  private items: Map<string, string> = new Map();

  public get length(): number {
    return this.items.size;
  }

  public key(index: number): string | null {
    return Array.from(this.items.keys())[index] ?? null;
  }

  public getItem(key: string): string | null {
    return this.items.has(key) ? (this.items.get(key) as string) : null;
  }

  public setItem(key: string, value: string): void {
    this.items.set(key, String(value));
  }

  public removeItem(key: string): void {
    this.items.delete(key);
  }

  public clear(): void {
    this.items.clear();
  }
}

export interface PageLocation {
  protocol: string;
  host: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
  href: string;
  origin: string;
}

const pageLocation: PageLocation = {
  protocol: "https:",
  host: "",
  hostname: "",
  port: "",
  pathname: "/",
  search: "",
  hash: "",
  href: "",
  origin: "",
};

// Point window.location at a new page, in place, the way a navigation would.
export const setPageUrl: (pageUrl: string) => void = (
  pageUrl: string,
): void => {
  const parsed: globalThis.URL = new globalThis.URL(pageUrl);

  pageLocation.protocol = parsed.protocol;
  pageLocation.host = parsed.host;
  pageLocation.hostname = parsed.hostname;
  pageLocation.port = parsed.port;
  pageLocation.pathname = parsed.pathname;
  pageLocation.search = parsed.search;
  pageLocation.hash = parsed.hash;
  pageLocation.href = parsed.href;
  pageLocation.origin = parsed.origin;
};

export const installBrowserGlobals: (pageUrl: string) => void = (
  pageUrl: string,
): void => {
  setPageUrl(pageUrl);

  const globals: Dictionary<unknown> =
    globalThis as unknown as Dictionary<unknown>;

  globals["window"] = globalThis;
  globals["location"] = pageLocation;
  globals["localStorage"] = new MemoryStorage();
  globals["sessionStorage"] = new MemoryStorage();
};

export const clearBrowserStorage: () => void = (): void => {
  (
    globalThis as unknown as { localStorage: MemoryStorage }
  ).localStorage.clear();
  (
    globalThis as unknown as { sessionStorage: MemoryStorage }
  ).sessionStorage.clear();
};

/*
 * Web Locks, when a test wants them. Node has no navigator.locks, which is
 * the "no lock manager" path; defining one here exercises the other.
 */
const originalNavigator: PropertyDescriptor | undefined =
  Object.getOwnPropertyDescriptor(globalThis, "navigator");

export const setNavigatorLocks: (locks: unknown) => void = (
  locks: unknown,
): void => {
  if (locks === undefined) {
    if (originalNavigator) {
      Object.defineProperty(globalThis, "navigator", originalNavigator);
    } else {
      delete (globalThis as unknown as Dictionary<unknown>)["navigator"];
    }

    return;
  }

  Object.defineProperty(globalThis, "navigator", {
    configurable: true,
    writable: true,
    value: { locks: locks },
  });
};

/*
 * Installed on import, so a test that imports this module FIRST can import the
 * clients normally: CommonJS evaluates imports in order, and by the time the
 * status page's Config is evaluated there is a page for it to read. The page is
 * a status page on its own custom domain - the case the page-origin refresh
 * exists for - while OneUptime itself (HOST, which IDENTITY_URL is built from)
 * runs on another host. Jest gives each test file its own process.env.
 */
export const DEFAULT_PAGE_URL: string = "https://status.example.com/";

export const ONEUPTIME_ORIGIN: string = "https://oneuptime.example.com";

process.env["HOST"] = "oneuptime.example.com";
process.env["HTTP_PROTOCOL"] = "https";

installBrowserGlobals(DEFAULT_PAGE_URL);
