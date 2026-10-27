import { describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { JSDOM, VirtualConsole } from "jsdom";
import path from "path";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  ALERT_ICON_PATH,
  CLOUD_ICON_PATH,
  ERROR_SCREEN_CSS,
  OFFLINE_ICON_PATH,
  RELOAD_ICON_PATH,
} from "../../../UI/Components/ErrorScreen/ErrorScreenStyle";
import PageScreenCard, {
  PageScreenTone,
} from "../../../UI/Components/ErrorScreen/PageScreenCard";
import { WINDOW_NAME_PREFIX } from "../../../UI/Utils/NewVersion/TabMemory";
import { getVisitorLanguage } from "../../../UI/Utils/VisitorLanguage";
import { getReadingDirection } from "../../../Types/ReadingDirection";
import { SUPPORTED_DASHBOARD_LANGUAGE_CODES } from "../../../Types/Dashboard/DashboardLanguage";

/*
 * What a page says when its app cannot start
 * (Common/Server/Views/Partials/EntryLoadFailure.ejs).
 *
 * "An entry bundle that fails to load before the app starts still shows the
 * browser's own error page" - the maintainer. A frontend's entry bundle
 * (dist/Index.js, or a file it imports) that does not load left the page
 * blank, and a reload with the server down landed on the browser's own
 * error page. The partial, included by every frontend's index.ejs, draws the
 * card a page of the app draws when its code cannot download, in the
 * reader's language, and loads the page once it can:
 *
 *   - offline: "You're offline", until the browser is back online;
 *   - the server not answering, or answering 5xx, 408 or 429: "Can't reach
 *     the server", asking again every ten seconds while the tab is in view,
 *     and on Try now;
 *   - the server answering: one reload, which loads the app - and a page
 *     that reloaded for this less than half a minute ago says "This page
 *     couldn't be loaded", with Reload page: never a loop.
 *
 * These run the partial as it is, in a page with the entry script after it,
 * and fail the entry the way a browser does: an error event on the script.
 */

const PARTIAL_PATH: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Views",
  "Partials",
  "EntryLoadFailure.ejs",
);

const FEATURE_SETS: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
);

const PARTIAL_SOURCE: string = fs.readFileSync(PARTIAL_PATH, "utf8");

const ENTRY: string = "/dashboard/dist/Index.js";

const RELOAD_KEY: string = "oneuptime-entry-load-reload-at";

// The words the card says, by their English text, in the partial's order.
const KEYS: Array<string> = [
  "You're offline",
  "This page needs an internet connection to load. It will load as soon as you're back online.",
  "Can't reach the server",
  "It may be restarting after an update. This page will load as soon as the server is back.",
  "This page couldn't be loaded",
  "A file it needs couldn't be downloaded from the server. Try reloading in a moment.",
  "Try again",
  "Try now",
  "Reload page",
];

const FRONTENDS_WITH_OWN_WORDS: Array<string> = [
  "Dashboard",
  "AdminDashboard",
  "Accounts",
  "StatusPage",
  "PublicDashboard",
];

const NAVIGATION_NOT_IMPLEMENTED: string = "navigation";

interface Locals {
  languageStorageKey?: unknown;
  languageChoiceKey?: unknown;
  usesPageLanguage?: unknown;
}

interface Visit {
  locals?: Locals;
  // <html lang>, as the server drew it.
  pageLanguage?: string;
  browserLanguages?: Array<string>;
  storage?: Record<string, string>;
  session?: Record<string, string>;
  storageThrows?: boolean;
  isOnline?: boolean;
  // What the server answers for the entry: a status, or null for no answer.
  serverAnswer?: number | null;
  entry?: string;
  hidden?: boolean;
  windowName?: string;
}

interface Timer {
  id: number;
  callback: () => void;
  delay: number;
  isDone: boolean;
}

interface OpenedPage {
  window: any;
  document: Document;
  reloads: () => number;
  requests: Array<{ url: string; init: Record<string, unknown> }>;
  setServer: (answer: number | null) => void;
  setOnline: (isOnline: boolean) => void;
  setHidden: (isHidden: boolean) => void;
  intervals: Array<Timer>;
  timeouts: Array<Timer>;
  failEntry: () => void;
  // Lets promises settle, then runs the timers due within maxDelay.
  settle: (maxDelay?: number) => Promise<void>;
}

const renderPartial: (locals?: Locals) => string = (
  locals?: Locals,
): string => {
  return ejs.render(PARTIAL_SOURCE, locals || {}, { filename: PARTIAL_PATH });
};

const open: (visit?: Visit) => OpenedPage = (visit?: Visit): OpenedPage => {
  const page: Visit = visit || {};
  let navigations: number = 0;
  let serverAnswer: number | null =
    page.serverAnswer === undefined ? 200 : page.serverAnswer;
  let isOnline: boolean = page.isOnline !== false;
  let isHidden: boolean = Boolean(page.hidden);
  const requests: Array<{ url: string; init: Record<string, unknown> }> = [];
  const intervals: Array<Timer> = [];
  const timeouts: Array<Timer> = [];
  let nextTimer: number = 1;

  const virtualConsole: VirtualConsole = new VirtualConsole();

  virtualConsole.on("jsdomError", (error: Error) => {
    if (String(error.message).includes(NAVIGATION_NOT_IMPLEMENTED)) {
      navigations++;
      return;
    }

    throw error;
  });

  const entry: string = page.entry || ENTRY;

  const dom: JSDOM = new JSDOM(
    `<!DOCTYPE html><html lang="${page.pageLanguage || "en"}"><head></head><body><div id="root"></div>${renderPartial(page.locals)}<script type="module" src="${entry}"></script></body></html>`,
    {
      url: "https://oneuptime.example/dashboard/project/monitors?status=down",
      runScripts: "dangerously",
      virtualConsole: virtualConsole,
      beforeParse: (pageWindow: any): void => {
        Object.defineProperty(pageWindow.navigator, "onLine", {
          configurable: true,
          get: (): boolean => {
            return isOnline;
          },
        });

        const languages: Array<string> = page.browserLanguages || ["en-US"];

        Object.defineProperty(pageWindow.navigator, "languages", {
          configurable: true,
          get: (): Array<string> => {
            return languages;
          },
        });
        Object.defineProperty(pageWindow.navigator, "language", {
          configurable: true,
          get: (): string => {
            return languages[0] || "";
          },
        });

        Object.defineProperty(pageWindow.document, "visibilityState", {
          configurable: true,
          get: (): string => {
            return isHidden ? "hidden" : "visible";
          },
        });

        for (const [key, value] of Object.entries(page.storage || {})) {
          pageWindow.localStorage.setItem(key, value);
        }

        for (const [key, value] of Object.entries(page.session || {})) {
          pageWindow.sessionStorage.setItem(key, value);
        }

        if (page.windowName !== undefined) {
          pageWindow.name = page.windowName;
        }

        if (page.storageThrows) {
          for (const storage of ["localStorage", "sessionStorage"]) {
            Object.defineProperty(pageWindow, storage, {
              configurable: true,
              get: (): never => {
                throw new Error("storage is blocked");
              },
            });
          }
        }

        pageWindow.fetch = (
          url: string,
          init: Record<string, unknown>,
        ): Promise<unknown> => {
          requests.push({ url, init });

          if (serverAnswer === null) {
            return Promise.reject(new TypeError("Failed to fetch"));
          }

          return Promise.resolve({ status: serverAnswer });
        };

        pageWindow.setInterval = (
          callback: () => void,
          delay: number,
        ): number => {
          const timer: Timer = {
            id: nextTimer++,
            callback,
            delay,
            isDone: false,
          };
          intervals.push(timer);
          return timer.id;
        };

        pageWindow.clearInterval = (id: number): void => {
          for (const timer of intervals) {
            if (timer.id === id) {
              timer.isDone = true;
            }
          }
        };

        pageWindow.setTimeout = (
          callback: () => void,
          delay: number,
        ): number => {
          const timer: Timer = {
            id: nextTimer++,
            callback,
            delay: delay || 0,
            isDone: false,
          };
          timeouts.push(timer);
          return timer.id;
        };

        pageWindow.clearTimeout = (id: number): void => {
          for (const timer of timeouts) {
            if (timer.id === id) {
              timer.isDone = true;
            }
          }
        };
      },
    },
  );

  const document: Document = dom.window.document;

  const settle: (maxDelay?: number) => Promise<void> = async (
    maxDelay?: number,
  ): Promise<void> => {
    for (let round: number = 0; round < 6; round++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });

      for (const timer of timeouts) {
        if (!timer.isDone && timer.delay <= (maxDelay ?? 0)) {
          timer.isDone = true;
          timer.callback();
        }
      }
    }
  };

  return {
    window: dom.window,
    document: document,
    reloads: (): number => {
      return navigations;
    },
    requests: requests,
    setServer: (answer: number | null): void => {
      serverAnswer = answer;
    },
    setOnline: (online: boolean): void => {
      isOnline = online;
      dom.window.dispatchEvent(
        new dom.window.Event(online ? "online" : "offline"),
      );
    },
    setHidden: (hidden: boolean): void => {
      isHidden = hidden;
    },
    intervals: intervals,
    timeouts: timeouts,
    failEntry: (): void => {
      document
        .querySelector('script[type="module"]')!
        .dispatchEvent(new dom.window.Event("error"));
    },
    settle: settle,
  };
};

const card: (page: OpenedPage) => HTMLElement | null = (
  page: OpenedPage,
): HTMLElement | null => {
  return page.document.querySelector("[data-testid='entry-load-failure']");
};

const title: (page: OpenedPage) => string = (page: OpenedPage): string => {
  return (
    page.document.querySelector("[data-testid='entry-load-failure-title']")
      ?.textContent || ""
  );
};

const action: (page: OpenedPage) => HTMLButtonElement = (
  page: OpenedPage,
): HTMLButtonElement => {
  return page.document.querySelector(
    "[data-testid='entry-load-failure-action']",
  ) as HTMLButtonElement;
};

const liveIntervals: (page: OpenedPage) => Array<Timer> = (
  page: OpenedPage,
): Array<Timer> => {
  return page.intervals.filter((timer: Timer): boolean => {
    return !timer.isDone;
  });
};

// The partial's words, by language: its WORDS object, read from the file.
const readWords: () => Record<string, Array<string>> = (): Record<
  string,
  Array<string>
> => {
  const start: number = PARTIAL_SOURCE.indexOf("var WORDS = {");
  const end: number = PARTIAL_SOURCE.indexOf("\n  };", start);

  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);

  return JSON.parse(
    PARTIAL_SOURCE.slice(start + "var WORDS = ".length, end + 4),
  ) as Record<string, Array<string>>;
};

const readLocale: (
  frontend: string,
  language: string,
) => Record<string, string> = (
  frontend: string,
  language: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(
      path.join(FEATURE_SETS, frontend, "src", "Locales", `${language}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
};

describe("EntryLoadFailure: an app that starts", () => {
  test("draws nothing, and asks nothing", async () => {
    const page: OpenedPage = open();

    await page.settle(1000);

    expect(card(page)).toBeNull();
    expect(page.document.getElementById("root")!.childNodes.length).toBe(0);
    expect(page.requests).toEqual([]);
    expect(page.reloads()).toBe(0);
  });

  test.each<[string, string]>([
    [
      "a script that is not the entry",
      "/dashboard/assets/js/tailwind-3.4.5.js",
    ],
    ["another module", "/dashboard/dist/Worker.js"],
    ["an entry of another name", "/dashboard/dist/Index.js.map"],
  ])(
    "%s failing is not the app failing",
    async (_label: string, src: string) => {
      const page: OpenedPage = open({ entry: src });

      page.failEntry();
      await page.settle(1000);

      expect(card(page)).toBeNull();
      expect(page.requests).toEqual([]);
    },
  );

  test("an image that fails is not the app failing either", async () => {
    const page: OpenedPage = open();
    const image: HTMLImageElement = page.document.createElement("img");

    page.document.body.appendChild(image);
    image.dispatchEvent(new page.window.Event("error"));
    await page.settle(1000);

    expect(page.requests).toEqual([]);
    expect(card(page)).toBeNull();
  });
});

describe("EntryLoadFailure: the entry does not load", () => {
  test("the server answers: one reload, remembered for the tab", async () => {
    const page: OpenedPage = open();

    page.failEntry();
    await page.settle();

    expect(page.requests.length).toBe(1);
    expect(new URL(page.requests[0]!.url).pathname).toBe(ENTRY);
    expect(page.requests[0]!.init["cache"]).toBe("no-store");
    expect(page.requests[0]!.init["credentials"]).toBe("same-origin");
    expect(page.reloads()).toBe(1);

    const reloadedAt: number = Number(
      page.window.sessionStorage.getItem(RELOAD_KEY),
    );

    expect(Date.now() - reloadedAt).toBeLessThan(60 * 1000);
    expect(card(page)).toBeNull();
  });

  test("a query or a hash on the entry's address is still the entry", async () => {
    const page: OpenedPage = open({ entry: `${ENTRY}?v=2#start` });

    page.failEntry();
    await page.settle();

    expect(page.reloads()).toBe(1);
  });

  test("it reloaded for this a moment ago: it says the page couldn't be loaded, and never loops", async () => {
    const page: OpenedPage = open({
      session: { [RELOAD_KEY]: String(Date.now() - 5000) },
    });

    page.failEntry();
    await page.settle();

    expect(page.reloads()).toBe(0);
    expect(card(page)!.getAttribute("data-step")).toBe("failed");
    expect(title(page)).toBe("This page couldn't be loaded");
    expect(card(page)!.querySelector("[role='alert']")).not.toBeNull();
    expect(action(page).textContent).toBe("Reload page");
    expect(liveIntervals(page)).toEqual([]);

    action(page).click();

    expect(page.reloads()).toBe(1);
  });

  test("a reload longer than half a minute ago is not this one: it reloads again", async () => {
    const page: OpenedPage = open({
      session: { [RELOAD_KEY]: String(Date.now() - 31 * 1000) },
    });

    page.failEntry();
    await page.settle();

    expect(page.reloads()).toBe(1);
    expect(card(page)).toBeNull();
  });

  test("a second failure on the same page is heard once", async () => {
    const page: OpenedPage = open();

    page.failEntry();
    page.failEntry();
    await page.settle();

    expect(page.requests.length).toBe(1);
    expect(page.reloads()).toBe(1);
  });

  test("offline: it says so, asks nothing, and loads the page when the browser is back", async () => {
    const page: OpenedPage = open({ isOnline: false });

    page.failEntry();
    await page.settle();

    expect(page.requests).toEqual([]);
    expect(card(page)!.getAttribute("data-step")).toBe("offline");
    expect(title(page)).toBe("You're offline");
    expect(action(page).textContent).toBe("Try again");
    expect(card(page)!.querySelector(".oueb-badge-neutral")).not.toBeNull();
    expect(card(page)!.querySelector("[role='status']")).not.toBeNull();
    expect(page.reloads()).toBe(0);

    page.setOnline(true);
    await page.settle();

    expect(page.requests.length).toBe(1);
    expect(page.reloads()).toBe(1);
  });

  test.each<[string, number | null]>([
    ["no answer at all", null],
    ["503, starting again", 503],
    ["502 from the proxy", 502],
    ["408", 408],
    ["429", 429],
  ])(
    "the server not answering (%s): it says so, and asks again every ten seconds while the tab is in view",
    async (_label: string, answer: number | null) => {
      const page: OpenedPage = open({ serverAnswer: answer });

      page.failEntry();
      await page.settle();

      expect(card(page)!.getAttribute("data-step")).toBe("unreachable");
      expect(title(page)).toBe("Can't reach the server");
      expect(action(page).textContent).toBe("Try now");
      expect(page.reloads()).toBe(0);

      expect(liveIntervals(page).length).toBe(1);
      expect(liveIntervals(page)[0]!.delay).toBe(10 * 1000);

      // Out of view: it waits.
      page.setHidden(true);
      liveIntervals(page)[0]!.callback();
      await page.settle();
      expect(page.requests.length).toBe(1);

      // In view, still down: it says so again, with one timer still.
      page.setHidden(false);
      liveIntervals(page)[0]!.callback();
      await page.settle();
      expect(page.requests.length).toBe(2);
      expect(liveIntervals(page).length).toBe(1);

      // Back: the page loads, and the timer stops.
      page.setServer(200);
      liveIntervals(page)[0]!.callback();
      await page.settle();

      expect(page.reloads()).toBe(1);
      expect(liveIntervals(page)).toEqual([]);
    },
  );

  test("a server answering 404 for the entry answers: the reload decides, then the page says it couldn't be loaded", async () => {
    const page: OpenedPage = open({ serverAnswer: 404 });

    page.failEntry();
    await page.settle();

    expect(page.reloads()).toBe(1);
  });

  test("a request that never ends is no answer after eight seconds", async () => {
    const page: OpenedPage = open();

    page.window.fetch = (url: string): Promise<unknown> => {
      page.requests.push({ url, init: {} });
      return new Promise<unknown>(() => {
        // Never answers.
      });
    };

    page.failEntry();
    await page.settle();

    expect(card(page)).toBeNull();

    await page.settle(8000);

    expect(card(page)!.getAttribute("data-step")).toBe("unreachable");
  });

  test("Try now spins while it asks, and shows the spinner for at least 600 ms", async () => {
    const page: OpenedPage = open({ serverAnswer: null });

    page.failEntry();
    await page.settle();

    const timersBefore: number = page.timeouts.length;

    action(page).click();

    expect(action(page).getAttribute("aria-busy")).toBe("true");
    expect(action(page).querySelector(".oueb-spinner")).not.toBeNull();

    // The answer is in, and the card waits out the rest of 600 ms.
    await page.settle();
    expect(page.requests.length).toBe(2);
    expect(action(page).getAttribute("aria-busy")).toBe("true");

    const waits: Array<number> = page.timeouts
      .slice(timersBefore)
      .filter((timer: Timer): boolean => {
        return !timer.isDone;
      })
      .map((timer: Timer): number => {
        return timer.delay;
      });

    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(500);
    expect(waits[0]).toBeLessThanOrEqual(600);

    await page.settle(600);
    expect(action(page).getAttribute("aria-busy")).toBeNull();
    expect(title(page)).toBe("Can't reach the server");
  });

  test("a second press while one asks is not a second request", async () => {
    const page: OpenedPage = open({ serverAnswer: null });

    page.failEntry();
    await page.settle();

    action(page).click();
    action(page).click();
    await page.settle(600);

    expect(page.requests.length).toBe(2);
  });

  test("the browser going back online while it says the server is unreachable asks at once", async () => {
    const page: OpenedPage = open({ serverAnswer: null });

    page.failEntry();
    await page.settle();
    page.setServer(200);
    page.setOnline(true);
    await page.settle();

    expect(page.reloads()).toBe(1);
  });

  test("with storage blocked it remembers the reload in window.name, and keeps a name another script gave the window", async () => {
    const page: OpenedPage = open({ storageThrows: true });

    page.failEntry();
    await page.settle();

    expect(page.reloads()).toBe(1);
    expect(String(page.window.name).startsWith(WINDOW_NAME_PREFIX)).toBe(true);
    expect(
      JSON.parse(String(page.window.name).slice(WINDOW_NAME_PREFIX.length))[
        RELOAD_KEY
      ],
    ).toMatch(/^\d+$/);

    const named: OpenedPage = open({
      storageThrows: true,
      windowName: "someone-elses-window",
    });

    named.failEntry();
    await named.settle();

    expect(named.window.name).toBe("someone-elses-window");
  });

  test("with storage blocked, a reload remembered in window.name a moment ago stops the loop", async () => {
    const page: OpenedPage = open({
      storageThrows: true,
      windowName: `${WINDOW_NAME_PREFIX}${JSON.stringify({
        [RELOAD_KEY]: String(Date.now() - 1000),
      })}`,
    });

    page.failEntry();
    await page.settle();

    expect(page.reloads()).toBe(0);
    expect(card(page)!.getAttribute("data-step")).toBe("failed");
  });
});

describe("EntryLoadFailure: in the reader's language", () => {
  const offlineTitle: (visit: Visit) => Promise<OpenedPage> = async (
    visit: Visit,
  ): Promise<OpenedPage> => {
    const page: OpenedPage = open({ ...visit, isOnline: false });

    page.failEntry();
    await page.settle();

    return page;
  };

  test("the language the reader picked in the app (the Dashboard's oneuptimeLang)", async () => {
    const page: OpenedPage = await offlineTitle({
      locals: { languageStorageKey: "oneuptimeLang" },
      storage: { oneuptimeLang: "de" },
      browserLanguages: ["fr-FR"],
    });

    expect(title(page)).toBe("Sie sind offline");
    expect(action(page).textContent).toBe("Erneut versuchen");
    expect(card(page)!.getAttribute("lang")).toBe("de");
    expect(card(page)!.getAttribute("dir")).toBe("ltr");
  });

  test("Persian reads right to left", async () => {
    const page: OpenedPage = await offlineTitle({
      locals: { languageStorageKey: "oneuptimeLang" },
      storage: { oneuptimeLang: "fa" },
    });

    expect(card(page)!.getAttribute("lang")).toBe("fa");
    expect(card(page)!.getAttribute("dir")).toBe("rtl");
    expect(title(page)).toBe(readWords()["fa"]![0]);
  });

  test("nothing picked: the browser's first language the product speaks", async () => {
    const page: OpenedPage = await offlineTitle({
      locals: { languageStorageKey: "oneuptimeLang" },
      browserLanguages: ["xx-YY", "fr-CA", "de"],
    });

    expect(card(page)!.getAttribute("lang")).toBe("fr");
  });

  test("storage blocked: the browser's languages decide", async () => {
    const page: OpenedPage = await offlineTitle({
      locals: { languageStorageKey: "oneuptimeLang" },
      storageThrows: true,
      browserLanguages: ["ja-JP"],
    });

    expect(card(page)!.getAttribute("lang")).toBe("ja");
  });

  test("a page that keeps no language (a public dashboard) follows the browser, whatever storage holds", async () => {
    const page: OpenedPage = await offlineTitle({
      storage: { oneuptimeLang: "de" },
      browserLanguages: ["ko-KR"],
    });

    expect(card(page)!.getAttribute("lang")).toBe("ko");
  });

  test("a status page follows its own language until the visitor picks one", async () => {
    const statusPage: Locals = {
      languageStorageKey: "statusPageLang",
      languageChoiceKey: "statusPageLangUserChoice",
      usesPageLanguage: true,
    };

    // Detected once, never picked: the page's own language.
    const detected: OpenedPage = await offlineTitle({
      locals: statusPage,
      pageLanguage: "fa",
      storage: { statusPageLang: "de" },
      browserLanguages: ["de-DE"],
    });

    expect(detected.document.querySelector("[lang='fa']")).not.toBeNull();
    expect(card(detected)!.getAttribute("lang")).toBe("fa");

    // Picked: the visitor's.
    const picked: OpenedPage = await offlineTitle({
      locals: statusPage,
      pageLanguage: "fa",
      storage: { statusPageLang: "de", statusPageLangUserChoice: "true" },
    });

    expect(card(picked)!.getAttribute("lang")).toBe("de");
  });

  test("nothing the product speaks: English", async () => {
    const page: OpenedPage = await offlineTitle({
      browserLanguages: ["xx-YY"],
    });

    expect(card(page)!.getAttribute("lang")).toBe("en");
    expect(title(page)).toBe("You're offline");
  });

  test.each<[string]>([
    ["zh"],
    ["zh-CN"],
    ["zh-SG"],
    ["zh-Hans-CN"],
    ["zh-TW"],
    ["zh-HK"],
    ["zh-MO"],
    ["zh-Hant"],
    ["zh-Hant-HK"],
    ["pt-BR"],
    ["en-GB"],
    ["nb-NO"],
    ["no"],
    ["fa-IR"],
    ["de-AT"],
  ])(
    "%s maps to the language the frontends' own apps would show",
    async (browserLanguage: string) => {
      const page: OpenedPage = await offlineTitle({
        browserLanguages: [browserLanguage],
      });

      expect(card(page)!.getAttribute("lang")).toBe(
        getVisitorLanguage(
          [browserLanguage],
          SUPPORTED_DASHBOARD_LANGUAGE_CODES,
        ),
      );
    },
  );
});

describe("EntryLoadFailure: its words", () => {
  const words: Record<string, Array<string>> = readWords();

  test("are in every language the frontends speak, nine each", () => {
    expect(Object.keys(words).sort()).toEqual(
      [...SUPPORTED_DASHBOARD_LANGUAGE_CODES].sort(),
    );

    for (const language of Object.keys(words)) {
      expect([language, words[language]!.length]).toEqual([language, 9]);
    }

    expect(words["en"]).toEqual(KEYS);
  });

  test.each(FRONTENDS_WITH_OWN_WORDS)(
    "are the %s's own translations, word for word, in every language",
    (frontend: string) => {
      for (const language of Object.keys(words)) {
        if (language === "en") {
          continue;
        }

        const locale: Record<string, string> = readLocale(frontend, language);

        expect([language, words[language]]).toEqual([
          language,
          KEYS.map((key: string): string => {
            return locale[key]!;
          }),
        ]);
      }
    },
  );

  test("are translated, never the English left in place", () => {
    for (const language of Object.keys(words)) {
      if (language === "en") {
        continue;
      }

      for (let index: number = 0; index < KEYS.length; index++) {
        expect([
          language,
          index,
          words[language]![index] !== KEYS[index],
        ]).toEqual([language, index, true]);
      }
    }
  });

  test("read right to left exactly where the language does", () => {
    const start: number = PARTIAL_SOURCE.indexOf("var RIGHT_TO_LEFT = ");
    const rightToLeft: Record<string, boolean> = JSON.parse(
      PARTIAL_SOURCE.slice(
        start + "var RIGHT_TO_LEFT = ".length,
        PARTIAL_SOURCE.indexOf(";", start),
      ).replace("fa:", '"fa":'),
    ) as Record<string, boolean>;

    for (const language of Object.keys(words)) {
      expect([language, Boolean(rightToLeft[language])]).toEqual([
        language,
        getReadingDirection(language) === "rtl",
      ]);
    }
  });
});

describe("EntryLoadFailure: the card", () => {
  const skeleton: (element: Element) => string = (element: Element): string => {
    const children: Array<string> = Array.from(element.children)
      .filter((child: Element): boolean => {
        return child.tagName.toLowerCase() !== "style";
      })
      .map(skeleton);
    const role: string | null = element.getAttribute("role");

    return `${element.tagName.toLowerCase()}${element.getAttribute("class") ? "." + element.getAttribute("class")!.split(" ").sort().join(".") : ""}${role ? `[${role}]` : ""}(${children.join(",")})`;
  };

  test("is the card a page of the app draws (PageScreenCard), part for part", async () => {
    const page: OpenedPage = open({ isOnline: false });

    page.failEntry();
    await page.settle();

    const appCard: JSDOM = new JSDOM(
      renderToStaticMarkup(
        React.createElement(PageScreenCard, {
          dataTestId: "app",
          titleTestId: "app-title",
          tone: PageScreenTone.Neutral,
          iconPath: OFFLINE_ICON_PATH,
          title: "You're offline",
          message: "Message",
          actions: [
            {
              title: "Try again",
              dataTestId: "app-try-again",
              onClick: (): void => {},
            },
          ],
        }),
      ),
    );

    expect(skeleton(card(page)!)).toBe(
      skeleton(appCard.window.document.querySelector("[data-testid='app']")!),
    );
  });

  test.each<[string, Visit, string]>([
    ["offline", { isOnline: false }, OFFLINE_ICON_PATH],
    ["unreachable", { serverAnswer: null }, CLOUD_ICON_PATH],
    [
      "failed",
      { session: { [RELOAD_KEY]: String(Date.now()) } },
      ALERT_ICON_PATH,
    ],
  ])(
    "draws the app's own icons (%s)",
    async (step: string, visit: Visit, iconPath: string) => {
      const page: OpenedPage = open(visit);

      page.failEntry();
      await page.settle();

      expect(card(page)!.getAttribute("data-step")).toBe(step);
      expect(
        card(page)!.querySelector(".oueb-badge path")!.getAttribute("d"),
      ).toBe(iconPath);
      expect(action(page).querySelector("path")!.getAttribute("d")).toBe(
        RELOAD_ICON_PATH,
      );
    },
  );
});

/*
 * Its stylesheet is ErrorScreenStyle's, for the parts it draws: every rule it
 * writes says what ERROR_SCREEN_CSS says for that selector (it cannot load
 * that file - it is shown when the app's files did not arrive).
 */
describe("EntryLoadFailure: its stylesheet", () => {
  interface Declaration {
    key: string;
    value: string;
  }

  const COMMENT_REGEX: RegExp = /\/\*[\s\S]*?\*\//g;
  const SPACE_REGEX: RegExp = /\s+/g;

  const normalize: (text: string) => string = (text: string): string => {
    return text.replace(SPACE_REGEX, " ").trim();
  };

  // "context|selector|property" -> value, in cascade order (later wins).
  const declarationsOf: (css: string) => Array<Declaration> = (
    css: string,
  ): Array<Declaration> => {
    const declarations: Array<Declaration> = [];

    const walk: (text: string, context: string) => void = (
      text: string,
      context: string,
    ): void => {
      let position: number = 0;

      while (position < text.length) {
        const open: number = text.indexOf("{", position);

        if (open === -1) {
          return;
        }

        const prelude: string = normalize(text.slice(position, open));
        let depth: number = 1;
        let close: number = open + 1;

        while (depth > 0 && close < text.length) {
          if (text[close] === "{") {
            depth++;
          } else if (text[close] === "}") {
            depth--;
          }
          close++;
        }

        const body: string = text.slice(open + 1, close - 1);

        if (prelude.startsWith("@")) {
          walk(body, prelude);
        } else {
          for (const statement of body.split(";")) {
            const colon: number = statement.indexOf(":");

            if (colon === -1) {
              continue;
            }

            const property: string = normalize(statement.slice(0, colon));
            const value: string = normalize(statement.slice(colon + 1));

            for (const selector of prelude.split(",")) {
              declarations.push({
                key: `${context}|${normalize(selector)}|${property}`,
                value: value,
              });
            }
          }
        }

        position = close;
      }
    };

    walk(css.replace(COMMENT_REGEX, ""), "");

    return declarations;
  };

  const partialCss: () => string = (): string => {
    const rendered: string = renderPartial();
    const start: number = rendered.indexOf("<style");
    const end: number = rendered.indexOf("</style>");

    expect(start).toBeGreaterThan(-1);

    return rendered.slice(rendered.indexOf(">", start) + 1, end);
  };

  /*
   * The app draws its own error screens with ErrorScreenStyle, and this
   * copy comes later in the page: switched on while the app runs, its
   * rules won over the ones it leaves out - an updating page's accent
   * badge drew in the alarm's red, a widget's small buttons and the error
   * screen's secondary button lost their padding and border. It is off
   * until its own card is drawn.
   */
  const style: (page: OpenedPage) => HTMLStyleElement = (
    page: OpenedPage,
  ): HTMLStyleElement => {
    return page.document.getElementById(
      "oneuptime-entry-load-failure-style",
    ) as HTMLStyleElement;
  };

  test("is off while the app runs: a page whose entry loads never switches it on", async () => {
    const page: OpenedPage = open();

    expect(style(page)).not.toBeNull();
    expect(style(page).media).toBe("not all");

    await page.settle(60000);

    expect(card(page)).toBeNull();
    expect(style(page).media).toBe("not all");
  });

  test.each<[string, Visit]>([
    ["offline", { isOnline: false }],
    ["unreachable", { serverAnswer: null }],
    ["failed", { session: { [RELOAD_KEY]: String(Date.now()) } }],
  ])(
    "is switched on with its card (%s)",
    async (step: string, visit: Visit) => {
      const page: OpenedPage = open(visit);

      expect(style(page).media).toBe("not all");

      page.failEntry();
      await page.settle();

      expect(card(page)!.getAttribute("data-step")).toBe(step);
      expect(style(page).media).toBe("all");
    },
  );

  test("leaves out of the page's cascade what ErrorScreenStyle says after it: the rules it does not copy", () => {
    const own: Set<string> = new Set<string>(
      declarationsOf(partialCss()).map((declaration: Declaration): string => {
        return declaration.key.split("|")[1] as string;
      }),
    );

    // The badge and the buttons it does not draw, which its copies would beat.
    for (const selector of [
      ".oueb-badge-info",
      ".oueb-button-small",
      ".oueb-button-secondary",
      ".oueb-button-ghost",
    ]) {
      expect([selector, own.has(selector)]).toEqual([selector, false]);
    }

    // Which is why it must stay off while the app draws them.
    expect(PARTIAL_SOURCE).toContain(
      '<style id="oneuptime-entry-load-failure-style" media="not all">',
    );
  });

  test("says what ErrorScreenStyle says, rule for rule", () => {
    const appValues: Map<string, string> = new Map<string, string>();

    for (const declaration of declarationsOf(ERROR_SCREEN_CSS)) {
      appValues.set(declaration.key, declaration.value);
    }

    const ownDeclarations: Array<Declaration> = declarationsOf(partialCss());

    expect(ownDeclarations.length).toBeGreaterThan(60);

    const different: Array<string> = ownDeclarations
      .filter((declaration: Declaration): boolean => {
        return appValues.get(declaration.key) !== declaration.value;
      })
      .map((declaration: Declaration): string => {
        return `${declaration.key}: "${declaration.value}" where ErrorScreenStyle says "${appValues.get(declaration.key)}"`;
      });

    expect(different).toEqual([]);
  });

  test("styles every class its card is drawn with", async () => {
    const css: string = partialCss();
    const pages: Array<OpenedPage> = [
      open({ isOnline: false }),
      open({ session: { [RELOAD_KEY]: String(Date.now()) } }),
    ];

    for (const page of pages) {
      page.failEntry();
      await page.settle();
      action(page).click();
    }

    const classes: Set<string> = new Set<string>();

    for (const page of pages) {
      for (const element of Array.from(
        page.document.querySelectorAll("#root [class]"),
      )) {
        for (const className of element.getAttribute("class")!.split(" ")) {
          classes.add(className);
        }
      }
    }

    expect(classes.size).toBeGreaterThan(8);

    for (const className of Array.from(classes)) {
      expect([className, css.includes(`.${className}`)]).toEqual([
        className,
        true,
      ]);
    }
  });
});

describe("EntryLoadFailure: what the page carries", () => {
  const rendered: string = renderPartial({
    languageStorageKey: "oneuptimeLang",
  });

  test("none of the file's comments, and no inline event handlers (a status page's policy refuses them)", () => {
    expect(rendered).not.toContain("<%");
    expect(rendered).not.toContain(
      "What a page says when its app cannot start",
    );
    expect(rendered).not.toMatch(/\son[a-z]+\s*=/i);
  });

  test("nothing from anywhere else: no source, no link, no eval", () => {
    expect(rendered).not.toMatch(/\b(src|href)\s*=/i);
    expect(rendered).not.toContain("eval(");
    expect(rendered).not.toContain("new Function");
    expect(rendered).not.toContain("innerHTML");
  });

  test("takes only safe keys from its locals into the script", () => {
    const hostile: string = renderPartial({
      languageStorageKey: '"});alert(1);</script><script>({"',
      languageChoiceKey: "a".repeat(65),
      usesPageLanguage: "true",
    });

    expect(hostile).toContain(
      '(window, {"storageKey":"","choiceKey":"","usesPageLanguage":false});',
    );
    expect(hostile.split("<script>").length).toBe(2);
  });

  test.each<[Locals, string]>([
    [
      { languageStorageKey: "oneuptimeLang" },
      '{"storageKey":"oneuptimeLang","choiceKey":"","usesPageLanguage":false}',
    ],
    [
      {
        languageStorageKey: "statusPageLang",
        languageChoiceKey: "statusPageLangUserChoice",
        usesPageLanguage: true,
      },
      '{"storageKey":"statusPageLang","choiceKey":"statusPageLangUserChoice","usesPageLanguage":true}',
    ],
    [{}, '{"storageKey":"","choiceKey":"","usesPageLanguage":false}'],
  ])("hands its locals to the script", (locals: Locals, options: string) => {
    expect(renderPartial(locals)).toContain(`(window, ${options});`);
  });

  test("remembers its reload where TabMemory keeps what a tab remembers", () => {
    expect(PARTIAL_SOURCE).toContain(
      `var TAB_MEMORY_PREFIX = "${WINDOW_NAME_PREFIX}";`,
    );
  });
});
