import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import vm from "vm";

/*
 * The Dashboard's index.ejs reloads the page when its service worker
 * changes, so an open tab runs the version a newly deployed worker serves.
 *
 * It reloaded on the FIRST worker too. The page-load registration in
 * index.ejs asks for scope "/", which the browser refuses for a script under
 * /dashboard/, so a browser has no worker until Register Device (Push
 * Notifications) installs one. That worker claims the page, and the reload
 * threw the registration away mid-flight: a customer allowed notifications,
 * watched the page refresh, and found no device in the list.
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
  const marker: number = source.indexOf(
    "<!-- PWA Service Worker Registration -->",
  );

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
  setController: (worker: FakeWorker | null) => void;
  // The browser telling the page its controller changed.
  controllerChanged: () => void;
  // How many times the page asked the browser to reload it.
  reloads: () => number;
  registerCalls: Array<Array<unknown>>;
}

function loadPage(data: {
  controller: FakeWorker | null;
  registration: "refused" | "accepted";
}): Page {
  const listeners: Record<string, Array<Listener>> = {};
  const windowListeners: Record<string, Array<Listener>> = {};
  const registerCalls: Array<Array<unknown>> = [];
  let reloads: number = 0;

  const serviceWorker: Record<string, unknown> = {
    controller: data.controller,
    register: (...args: Array<unknown>): Promise<unknown> => {
      registerCalls.push(args);

      if (data.registration === "refused") {
        // What a browser says to scope "/" for /dashboard/sw.js.
        return Promise.reject(
          new Error(
            "SecurityError: The path of the provided scope ('/') is not under the max scope allowed ('/dashboard/').",
          ),
        );
      }

      return Promise.resolve({
        scope: "https://oneuptime.example/",
        addEventListener: (): void => {},
        update: (): void => {},
      });
    },
    addEventListener: (type: string, listener: Listener): void => {
      (listeners[type] = listeners[type] || []).push(listener);
    },
  };

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

  for (const listener of windowListeners["load"] || []) {
    listener();
  }

  return {
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
    registerCalls: registerCalls,
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

describe.each(["refused", "accepted"] as const)(
  "the page's own service worker registration is %s",
  (registration: "refused" | "accepted") => {
    test("the page asks for the worker when it loads", async () => {
      const page: Page = loadPage({ controller: null, registration });

      await settle();

      expect(page.registerCalls).toHaveLength(1);
      expect(page.registerCalls[0]![0]).toBe("/dashboard/sw.js");
    });

    test("the first worker to take control of a page that loaded without one does not reload it", async () => {
      const page: Page = loadPage({ controller: null, registration });

      await settle();

      // Register Device installs the worker, and it claims the page.
      page.setController(FIRST_WORKER);
      page.controllerChanged();

      expect(page.reloads()).toBe(0);
    });

    test("a newer worker taking over from the one that served the page reloads it, once", async () => {
      const page: Page = loadPage({ controller: FIRST_WORKER, registration });

      await settle();

      page.setController(NEWER_WORKER);
      page.controllerChanged();
      page.controllerChanged();

      expect(page.reloads()).toBe(1);
    });

    test("after the first worker took control, a newer one taking over reloads", async () => {
      const page: Page = loadPage({ controller: null, registration });

      await settle();

      page.setController(FIRST_WORKER);
      page.controllerChanged();

      expect(page.reloads()).toBe(0);

      page.setController(NEWER_WORKER);
      page.controllerChanged();

      expect(page.reloads()).toBe(1);
    });
  },
);

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
