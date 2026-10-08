import { expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import vm from "vm";

/*
 * The Dashboard's index.ejs reloads the page when its service worker
 * changes, so an open tab runs the version a newly deployed worker serves.
 *
 * It reloaded on the FIRST worker too. A browser has no worker until
 * Register Device (Push Notifications) installs one. That worker claims the
 * page, and the reload threw the registration away mid-flight: a customer
 * allowed notifications, watched the page refresh, and found no device in
 * the list.
 *
 * Register Device is also the only thing that installs the worker. index.ejs
 * used to register it on every page load with scope "/", which a browser
 * refuses for a script under /dashboard/ - so that registration, its
 * once-a-minute update check and the "new version" banner never ran - and
 * the page no longer asks for the worker at all.
 *
 * This runs the script exactly as index.ejs ships it, against a stand-in
 * navigator.serviceWorker.
 */

const INDEX_EJS: string = path.resolve(
  __dirname,
  "..",
  "..",
  "FeatureSet",
  "Dashboard",
  "views",
  "index.ejs",
);

function readServiceWorkerScript(): string {
  const source: string = fs.readFileSync(INDEX_EJS, "utf8");
  const marker: number = source.indexOf("<!-- PWA Service Worker -->");

  expect(marker).toBeGreaterThan(-1);

  const start: number = source.indexOf("<script>", marker) + "<script>".length;
  const end: number = source.indexOf("</script>", start);

  return source.slice(start, end);
}

type Listener = (event?: unknown) => void;

interface FakeWorker {
  scriptURL: string;
}

interface Page {
  // The browser firing the page's load event.
  finishLoading: () => void;
  setController: (worker: FakeWorker | null) => void;
  // The browser telling the page its controller changed.
  controllerChanged: () => void;
  // How many times the page asked the browser to reload it.
  reloads: () => number;
  // What the page asked navigator.serviceWorker for, besides listening to it.
  serviceWorkerCalls: Array<string>;
}

function loadPage(data: { controller: FakeWorker | null }): Page {
  const listeners: Record<string, Array<Listener>> = {};
  const windowListeners: Record<string, Array<Listener>> = {};
  const serviceWorkerCalls: Array<string> = [];
  let reloads: number = 0;

  const never: () => Promise<never> = (): Promise<never> => {
    return new Promise<never>(() => {});
  };

  const serviceWorker: Record<string, unknown> = {
    controller: data.controller,
    register: (...args: Array<unknown>): Promise<never> => {
      serviceWorkerCalls.push(`register(${JSON.stringify(args)})`);
      return never();
    },
    getRegistration: (): Promise<never> => {
      serviceWorkerCalls.push("getRegistration()");
      return never();
    },
    getRegistrations: (): Promise<never> => {
      serviceWorkerCalls.push("getRegistrations()");
      return never();
    },
    addEventListener: (type: string, listener: Listener): void => {
      (listeners[type] = listeners[type] || []).push(listener);
    },
  };

  Object.defineProperty(serviceWorker, "ready", {
    get: (): Promise<never> => {
      serviceWorkerCalls.push("ready");
      return never();
    },
  });

  const sandbox: Record<string, unknown> = {
    navigator: { serviceWorker: serviceWorker },
    location: {
      reload: (): void => {
        reloads++;
      },
    },
    console: { log: (): void => {}, error: (): void => {} },
    setInterval: (): number => {
      return 0;
    },
    setTimeout: (): number => {
      return 0;
    },
    document: {
      createElement: (): Record<string, unknown> => {
        return { style: {} };
      },
      body: { appendChild: (): void => {} },
    },
    addEventListener: (type: string, listener: Listener): void => {
      (windowListeners[type] = windowListeners[type] || []).push(listener);
    },
  };

  sandbox["window"] = sandbox;

  vm.runInNewContext(readServiceWorkerScript(), sandbox);

  return {
    finishLoading: (): void => {
      for (const listener of windowListeners["load"] || []) {
        listener();
      }
    },
    setController: (worker: FakeWorker | null): void => {
      serviceWorker["controller"] = worker;
    },
    controllerChanged: (): void => {
      for (const listener of listeners["controllerchange"] || []) {
        listener();
      }
    },
    reloads: (): number => {
      return reloads;
    },
    serviceWorkerCalls: serviceWorkerCalls,
  };
}

const FIRST_WORKER: FakeWorker = {
  scriptURL: "https://oneuptime.example/dashboard/sw.js",
};

const NEWER_WORKER: FakeWorker = {
  scriptURL: "https://oneuptime.example/dashboard/sw.js?deployed-later",
};

async function settle(): Promise<void> {
  await new Promise<void>((resolve: () => void) => {
    setImmediate(resolve);
  });
}

test.each([
  ["a page that loaded without a worker", null],
  ["a page a worker served", FIRST_WORKER],
] as Array<[string, FakeWorker | null]>)(
  "%s does not register the service worker, or look for a new version of it",
  async (_page: string, controller: FakeWorker | null) => {
    const page: Page = loadPage({ controller });

    page.finishLoading();
    await settle();

    expect(page.serviceWorkerCalls).toEqual([]);
  },
);

test("the first worker to take control of a page that loaded without one does not reload it", async () => {
  const page: Page = loadPage({ controller: null });

  page.finishLoading();
  await settle();

  // Register Device installs the worker, and it claims the page.
  page.setController(FIRST_WORKER);
  page.controllerChanged();

  expect(page.reloads()).toBe(0);
});

test("a newer worker taking over from the one that served the page reloads it, once", async () => {
  const page: Page = loadPage({ controller: FIRST_WORKER });

  page.finishLoading();
  await settle();

  page.setController(NEWER_WORKER);
  page.controllerChanged();
  page.controllerChanged();

  expect(page.reloads()).toBe(1);
});

test("after the first worker took control, a newer one taking over reloads", async () => {
  const page: Page = loadPage({ controller: null });

  page.finishLoading();
  await settle();

  page.setController(FIRST_WORKER);
  page.controllerChanged();

  expect(page.reloads()).toBe(0);

  page.setController(NEWER_WORKER);
  page.controllerChanged();

  expect(page.reloads()).toBe(1);
});

test("a newer worker that takes over before the page has finished loading reloads it", () => {
  /*
   * The browser looks for a newer worker as soon as the page is navigated
   * to, so one can take over while the page is still loading.
   */
  const page: Page = loadPage({ controller: FIRST_WORKER });

  page.setController(NEWER_WORKER);
  page.controllerChanged();

  expect(page.reloads()).toBe(1);

  page.finishLoading();

  expect(page.reloads()).toBe(1);
});

test("a browser without service workers loads the page and nothing else happens", () => {
  const windowListeners: Array<string> = [];

  const sandbox: Record<string, unknown> = {
    navigator: {},
    location: { reload: (): void => {} },
    console: { log: (): void => {} },
    addEventListener: (type: string): void => {
      windowListeners.push(type);
    },
  };

  sandbox["window"] = sandbox;

  expect(() => {
    vm.runInNewContext(readServiceWorkerScript(), sandbox);
  }).not.toThrow();
  expect(windowListeners).not.toContain("load");
});
