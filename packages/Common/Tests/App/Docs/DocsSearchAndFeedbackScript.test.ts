import { afterEach, describe, expect, test } from "@jest/globals";
import ejs from "ejs";
import fs from "fs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";

/*
 * THE DOCS PAGE'S SEARCH BOX AND "WAS THIS PAGE HELPFUL?" (issue #6822),
 * run in jsdom from the real page script (Views/Partials/Scripts.ejs) with
 * the real search dialog and feedback partials.
 *
 * Search: the page titles answer at once; the docs server, which reads
 * every page in full and forgives typos, answers a moment later
 * (/docs/search/<lang>.json); only the answer to what the box says now is
 * shown; its words are marked; and with no server, the titles keep
 * answering.
 *
 * Feedback: on a self-hosted server nothing is ever posted, and a no offers
 * the GitHub issue. Where analytics is set up, an answer is posted once,
 * only with the reader's consent: not after "Reject all", not under Global
 * Privacy Control unless they accepted. A no waits for its reason, and
 * goes without one when the page is left. Where the server's admins keep
 * the answers (#7209), the page says so before anyone answers, and posts
 * the answer for them: it goes nowhere else.
 *
 * A search that found nothing (#7207): reported only where analytics is
 * set up and with the reader's consent, once it settled - 2 characters or
 * more, the server's empty answer a second old, or the box closed on it -
 * once per search, and never for a search the server could not answer.
 */

const VIEWS: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Docs",
  "Views",
  "Partials",
);

const ORIGIN: string = "http://docs.example.lan";

const t: (key: string) => string = (key: string): string => {
  return key;
};

interface FetchCall {
  url: string;
  init?: { method?: string; body?: string } | undefined;
}

interface PageOptions {
  mode?: "send" | "keep" | "local" | undefined;
  // The search box reports a search that found nothing (data-search-report).
  isSearchReported?: boolean | undefined;
  consent?: "granted" | "denied" | "unset" | undefined;
  globalPrivacyControl?: boolean | undefined;
  // What /docs/search answers, by the query; "offline" rejects.
  search?: ((query: string) => unknown) | "offline" | undefined;
  // How long the search answer takes, in milliseconds.
  searchDelay?: ((query: string) => number) | undefined;
}

interface OpenedPage {
  window: DOMWindow;
  document: Document;
  fetches: Array<FetchCall>;
  beacons: Array<{ url: string; body: string }>;
  errors: Array<string>;
}

let opened: OpenedPage | null = null;

afterEach(() => {
  opened?.window.close();
  opened = null;
});

const wait: (window: DOMWindow, ms: number) => Promise<void> = (
  window: DOMWindow,
  ms: number,
): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    window.setTimeout(resolve, ms);
  });
};

/*
 * Until the search box has asked the server and shown what it got: a slow
 * machine takes longer than the box's own delay, so the tests wait for the
 * answer rather than for a fixed time.
 */
const searchSettled: (page: OpenedPage) => Promise<void> = async (
  page: OpenedPage,
): Promise<void> => {
  const started: number = Date.now();

  while (Date.now() - started < 5000) {
    const asked: boolean = page.fetches.some((call: FetchCall): boolean => {
      return call.url.startsWith("/docs/search/");
    });
    const pending: boolean = Boolean(
      page.document.querySelector("[data-search-pending]"),
    );

    if (asked && !pending) {
      // One more turn, for an answer that is drawn as it lands.
      await wait(page.window, 30);
      return;
    }

    await wait(page.window, 20);
  }
};

const render: (file: string, locals: Record<string, unknown>) => string = (
  file: string,
  locals: Record<string, unknown>,
): string => {
  const filename: string = path.join(VIEWS, file);
  return ejs.render(fs.readFileSync(filename, "utf8"), locals, { filename });
};

async function openPage(options: PageOptions): Promise<OpenedPage> {
  const fetches: Array<FetchCall> = [];
  const beacons: Array<{ url: string; body: string }> = [];
  const errors: Array<string> = [];

  const nav: Array<unknown> = [
    {
      title: "On Call",
      links: [
        { title: "Escalation Rules", url: "/docs/en/on-call/escalation-rules" },
        { title: "On-Call Schedules", url: "/docs/en/on-call/schedules" },
      ],
    },
  ];

  const html: string = `<!doctype html><html lang="en"><head></head><body>
    <button type="button" data-search-open>Search</button>
    <article class="docs-article"><div class="docs-content" id="docs-content"><p>Page.</p></div></article>
    ${render("PageFeedback.ejs", {
      t,
      lang: "en",
      feedback: {
        page: "on-call/escalation-rules",
        mode: options.mode || "local",
        githubIssueUrl:
          "https://github.com/OneUptime/oneuptime/issues/new?title=Docs%3A%20Escalation%20Rules",
      },
    })}
    ${render("SearchModal.ejs", {
      t,
      searchReport: options.isSearchReported === true,
    })}
    ${render("Scripts.ejs", { t, nav, lang: "en" })}
  </body></html>`;

  const virtualConsole: VirtualConsole = new VirtualConsole();
  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(error.message);
  });

  const dom: JSDOM = new JSDOM(html, {
    url: `${ORIGIN}/docs/en/on-call/escalation-rules`,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (window: DOMWindow): void => {
      if (options.consent && options.consent !== "unset") {
        const consent: string = options.consent;
        (window as unknown as { oneUptimeConsent: unknown }).oneUptimeConsent =
          {
            state: (): string => {
              return consent;
            },
          };
      }

      Object.defineProperty(window.navigator, "globalPrivacyControl", {
        configurable: true,
        value: options.globalPrivacyControl === true,
      });

      // A Blob that remembers its text, so a beacon's body can be read at once.
      const PageBlob: typeof Blob = window.Blob;
      Object.defineProperty(window, "Blob", {
        configurable: true,
        writable: true,
        value: function (
          parts: Array<string>,
          blobOptions?: BlobPropertyBag,
        ): Blob {
          const blob: Blob = new PageBlob(parts, blobOptions);
          (blob as unknown as { text: string }).text = parts.join("");
          return blob;
        },
      });

      Object.defineProperty(window.navigator, "sendBeacon", {
        configurable: true,
        value: (url: string, blob: Blob): boolean => {
          beacons.push({
            url,
            body: (blob as unknown as { text: string }).text,
          });
          return true;
        },
      });

      Object.defineProperty(window, "fetch", {
        configurable: true,
        value: (
          url: string,
          init?: { method?: string; body?: string },
        ): Promise<unknown> => {
          fetches.push({ url, init });

          if (url.startsWith("/docs/search/")) {
            if (options.search === "offline" || !options.search) {
              return Promise.reject(new Error("offline"));
            }
            const query: string =
              new URL(url, ORIGIN).searchParams.get("q") || "";
            const answer: unknown = options.search(query);
            const delay: number = options.searchDelay
              ? options.searchDelay(query)
              : 0;
            return new Promise((resolve: (value: unknown) => void) => {
              window.setTimeout(() => {
                resolve({
                  ok: true,
                  json: (): Promise<unknown> => {
                    return Promise.resolve(answer);
                  },
                });
              }, delay);
            });
          }

          return Promise.resolve({ ok: true, status: 204 });
        },
      });
    },
  });

  await wait(dom.window, 0);

  opened = {
    window: dom.window,
    document: dom.window.document,
    fetches,
    beacons,
    errors,
  };

  return opened;
}

const type: (page: OpenedPage, text: string) => void = (
  page: OpenedPage,
  text: string,
): void => {
  const input: HTMLInputElement = page.document.getElementById(
    "search-input",
  ) as HTMLInputElement;
  input.value = text;
  input.dispatchEvent(new page.window.Event("input", { bubbles: true }));
};

const openSearch: (page: OpenedPage) => void = (page: OpenedPage): void => {
  (
    page.document.querySelector("[data-search-open]") as HTMLButtonElement
  ).click();
};

const resultTitles: (page: OpenedPage) => Array<string> = (
  page: OpenedPage,
): Array<string> => {
  return Array.from(
    page.document.querySelectorAll(".docs-search__item-title"),
  ).map((element: Element): string => {
    return element.textContent || "";
  });
};

const searchFetches: (page: OpenedPage) => Array<string> = (
  page: OpenedPage,
): Array<string> => {
  return page.fetches
    .map((call: FetchCall): string => {
      return call.url;
    })
    .filter((url: string): boolean => {
      return url.startsWith("/docs/search/");
    });
};

const feedbackPosts: (page: OpenedPage) => Array<Record<string, unknown>> = (
  page: OpenedPage,
): Array<Record<string, unknown>> => {
  return page.fetches
    .filter((call: FetchCall): boolean => {
      return call.url === "/docs/feedback";
    })
    .map((call: FetchCall): Record<string, unknown> => {
      expect(call.init?.method).toBe("POST");
      return JSON.parse(call.init?.body || "{}") as Record<string, unknown>;
    });
};

const foundNothingPosts: (
  page: OpenedPage,
) => Array<Record<string, unknown>> = (
  page: OpenedPage,
): Array<Record<string, unknown>> => {
  return page.fetches
    .filter((call: FetchCall): boolean => {
      return call.url === "/docs/search/found-nothing";
    })
    .map((call: FetchCall): Record<string, unknown> => {
      expect(call.init?.method).toBe("POST");
      return JSON.parse(call.init?.body || "{}") as Record<string, unknown>;
    });
};

// What the docs server answers for a search that finds nothing.
const FOUND_NOTHING: (query: string) => unknown = (query: string): unknown => {
  return { query, words: [], results: [] };
};

const closeSearch: (page: OpenedPage) => void = (page: OpenedPage): void => {
  page.document.dispatchEvent(
    new page.window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
  );
};

const ESCALATION_ANSWER: unknown = {
  query: "escalaton",
  words: ["escalation"],
  results: [
    {
      title: "Adding an escalation rule",
      where: "On Call › Escalation Rules",
      url: "/docs/en/on-call/escalation-rules#adding-an-escalation-rule",
      snippet: "Each escalation rule is one level.",
      isSection: true,
      isGuide: false,
    },
  ],
};

describe("the docs search box", () => {
  test("asks the docs server what was typed, and shows its answer with the words it found marked", async () => {
    const page: OpenedPage = await openPage({
      search: (): unknown => {
        return ESCALATION_ANSWER;
      },
    });

    openSearch(page);
    type(page, "escalaton");
    await searchSettled(page);

    expect(searchFetches(page)).toEqual(["/docs/search/en.json?q=escalaton"]);
    expect(resultTitles(page)).toEqual(["Adding an escalation rule"]);

    const item: HTMLAnchorElement = page.document.querySelector(
      ".docs-search__item",
    ) as HTMLAnchorElement;
    expect(item.getAttribute("href")).toBe(
      "/docs/en/on-call/escalation-rules#adding-an-escalation-rule",
    );
    expect(
      Array.from(item.querySelectorAll("mark")).map((mark: Element) => {
        return mark.textContent;
      }),
    ).toEqual(["escalation", "escalation"]);
    expect(item.querySelector(".docs-search__item-meta")?.textContent).toBe(
      "On Call › Escalation Rules",
    );
    expect(page.errors).toEqual([]);
  });

  test("answers from the page titles at once, before the server does", async () => {
    const page: OpenedPage = await openPage({
      search: (): unknown => {
        return ESCALATION_ANSWER;
      },
      searchDelay: (): number => {
        return 400;
      },
    });

    openSearch(page);
    type(page, "escalation");
    expect(resultTitles(page)).toEqual(["Escalation Rules"]);

    await searchSettled(page);
    for (let round: number = 0; round < 100; round++) {
      if (resultTitles(page)[0] === "Adding an escalation rule") {
        break;
      }
      await wait(page.window, 50);
    }
    expect(resultTitles(page)).toEqual(["Adding an escalation rule"]);
  });

  test("waits a moment while typing, and asks once for what the box says", async () => {
    const page: OpenedPage = await openPage({
      search: (): unknown => {
        return ESCALATION_ANSWER;
      },
    });

    openSearch(page);
    type(page, "e");
    type(page, "es");
    type(page, "esc");
    await searchSettled(page);

    expect(searchFetches(page)).toEqual(["/docs/search/en.json?q=esc"]);
  });

  test("shows only the answer to what the box says now, never a slower, older one", async () => {
    const page: OpenedPage = await openPage({
      search: (query: string): unknown => {
        return {
          query,
          words: [],
          results: [
            {
              title: `Answer to ${query}`,
              where: "On Call",
              url: `/docs/en/on-call/${query}`,
              snippet: "",
              isSection: false,
              isGuide: false,
            },
          ],
        };
      },
      searchDelay: (query: string): number => {
        return query === "sched" ? 600 : 10;
      },
    });

    openSearch(page);
    type(page, "sched");
    await wait(page.window, 200);
    type(page, "schedules");
    await wait(page.window, 1000);

    expect(resultTitles(page)).toEqual(["Answer to schedules"]);

    // And the late answer to "sched" was not kept: the box draws the answer to what it says at once.
    type(page, "schedules");
    expect(resultTitles(page)).toEqual(["Answer to schedules"]);
  });

  test("keeps answering from the page titles when the server cannot be reached", async () => {
    const page: OpenedPage = await openPage({ search: "offline" });

    openSearch(page);
    type(page, "schedules");
    await searchSettled(page);

    expect(resultTitles(page)).toEqual(["On-Call Schedules"]);
    expect(page.errors).toEqual([]);
  });

  test("says nothing was found only once the server has said so", async () => {
    const page: OpenedPage = await openPage({
      search: (query: string): unknown => {
        return { query, words: [], results: [] };
      },
      searchDelay: (): number => {
        return 300;
      },
    });

    openSearch(page);
    type(page, "zzqxv");
    // Meanwhile it says the search is on, not that nothing was found.
    expect(page.document.getElementById("search-results")?.textContent).toBe(
      "ui.searchSearching",
    );

    await searchSettled(page);
    expect(
      page.document.getElementById("search-results")?.textContent,
    ).toContain("ui.searchNoResults");
  });

  test("says nothing was found, not that it is still searching, when the server cannot be reached and no title matches", async () => {
    const page: OpenedPage = await openPage({ search: "offline" });

    openSearch(page);
    type(page, "zzqxv");
    await searchSettled(page);

    expect(
      page.document.getElementById("search-results")?.textContent,
    ).toContain("ui.searchNoResults");
  });

  test("marks words as text: a result's markup is never read as HTML", async () => {
    const page: OpenedPage = await openPage({
      search: (): unknown => {
        return {
          query: "x",
          words: ["<b>"],
          results: [
            {
              title: "<img src=x onerror=alert(1)> <b>",
              where: "<script>",
              url: "/docs/en/x/y",
              snippet: "<b>bold</b>",
              isSection: false,
              isGuide: false,
            },
          ],
        };
      },
    });

    openSearch(page);
    type(page, "x");
    await searchSettled(page);

    const results: HTMLElement = page.document.getElementById(
      "search-results",
    ) as HTMLElement;
    expect(results.querySelector("img")).toBeNull();
    expect(results.querySelector("b")).toBeNull();
    expect(results.querySelector("script")).toBeNull();
    expect(resultTitles(page)).toEqual(["<img src=x onerror=alert(1)> <b>"]);
  });
});

describe("Was this page helpful?, on a self-hosted server", () => {
  test("is shown once the page's script runs, and posts nothing for a yes", async () => {
    const page: OpenedPage = await openPage({
      mode: "local",
      consent: "granted",
    });
    const box: HTMLElement = page.document.querySelector(
      "[data-docs-feedback]",
    ) as HTMLElement;

    expect(box.hidden).toBe(false);
    (box.querySelector('[data-feedback-answer="yes"]') as HTMLElement).click();
    await wait(page.window, 50);

    expect(
      (box.querySelector('[data-feedback-step="thanks"]') as HTMLElement)
        .hidden,
    ).toBe(false);
    expect(
      (box.querySelector('[data-feedback-step="ask"]') as HTMLElement).hidden,
    ).toBe(true);
    expect(feedbackPosts(page)).toEqual([]);
  });

  test("answers a no with the GitHub issue, and posts nothing, not even when the page is left", async () => {
    const page: OpenedPage = await openPage({
      mode: "local",
      consent: "granted",
    });
    const box: HTMLElement = page.document.querySelector(
      "[data-docs-feedback]",
    ) as HTMLElement;

    (box.querySelector('[data-feedback-answer="no"]') as HTMLElement).click();
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await wait(page.window, 50);

    const no: HTMLElement = box.querySelector(
      '[data-feedback-step="no"]',
    ) as HTMLElement;
    expect(no.hidden).toBe(false);
    expect(no.querySelector("[data-feedback-reason]")).toBeNull();
    expect(
      (no.querySelector("[data-feedback-github]") as HTMLAnchorElement).href,
    ).toContain("title=Docs%3A%20Escalation%20Rules");
    expect(feedbackPosts(page)).toEqual([]);
    expect(page.beacons).toEqual([]);
  });
});

describe("Was this page helpful?, where analytics is set up", () => {
  test("posts a yes once, with the page and its language", async () => {
    const page: OpenedPage = await openPage({
      mode: "send",
      consent: "granted",
    });
    const yes: HTMLElement = page.document.querySelector(
      '[data-feedback-answer="yes"]',
    ) as HTMLElement;

    yes.click();
    yes.click();
    await wait(page.window, 50);

    expect(feedbackPosts(page)).toEqual([
      { page: "on-call/escalation-rules", language: "en", isHelpful: true },
    ]);
  });

  test("posts a no with the reason picked, once", async () => {
    const page: OpenedPage = await openPage({
      mode: "send",
      consent: "granted",
    });

    (
      page.document.querySelector('[data-feedback-answer="no"]') as HTMLElement
    ).click();
    expect(feedbackPosts(page)).toEqual([]);

    (
      page.document.querySelector(
        '[data-feedback-reason="not_found"]',
      ) as HTMLElement
    ).click();
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await wait(page.window, 50);

    expect(feedbackPosts(page)).toEqual([
      {
        page: "on-call/escalation-rules",
        language: "en",
        isHelpful: false,
        reason: "not_found",
      },
    ]);
    expect(page.beacons).toEqual([]);
    expect(
      (
        page.document.querySelector(
          '[data-feedback-step="thanks"]',
        ) as HTMLElement
      ).hidden,
    ).toBe(false);
  });

  test("sends a no without a reason when the page is left before one is picked", async () => {
    const page: OpenedPage = await openPage({ mode: "send", consent: "unset" });

    (
      page.document.querySelector('[data-feedback-answer="no"]') as HTMLElement
    ).click();
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await wait(page.window, 50);

    expect(page.beacons).toEqual([
      {
        url: "/docs/feedback",
        body: JSON.stringify({
          page: "on-call/escalation-rules",
          language: "en",
          isHelpful: false,
        }),
      },
    ]);
    expect(feedbackPosts(page)).toEqual([]);
  });

  test("posts nothing after Reject all", async () => {
    const page: OpenedPage = await openPage({
      mode: "send",
      consent: "denied",
    });

    (
      page.document.querySelector('[data-feedback-answer="yes"]') as HTMLElement
    ).click();
    await wait(page.window, 50);

    expect(feedbackPosts(page)).toEqual([]);
    // The reader is still thanked: they answered.
    expect(
      (
        page.document.querySelector(
          '[data-feedback-step="thanks"]',
        ) as HTMLElement
      ).hidden,
    ).toBe(false);
  });

  test("posts nothing under Global Privacy Control, unless the reader accepted", async () => {
    const refused: OpenedPage = await openPage({
      mode: "send",
      consent: "unset",
      globalPrivacyControl: true,
    });

    (
      refused.document.querySelector(
        '[data-feedback-answer="yes"]',
      ) as HTMLElement
    ).click();
    await wait(refused.window, 50);
    expect(feedbackPosts(refused)).toEqual([]);
    refused.window.close();

    const accepted: OpenedPage = await openPage({
      mode: "send",
      consent: "granted",
      globalPrivacyControl: true,
    });

    (
      accepted.document.querySelector(
        '[data-feedback-answer="yes"]',
      ) as HTMLElement
    ).click();
    await wait(accepted.window, 50);
    expect(feedbackPosts(accepted)).toHaveLength(1);
  });

  test("posts with no answer given anywhere, when the browser sends no refusal", async () => {
    const page: OpenedPage = await openPage({ mode: "send", consent: "unset" });

    (
      page.document.querySelector('[data-feedback-answer="yes"]') as HTMLElement
    ).click();
    await wait(page.window, 50);

    expect(feedbackPosts(page)).toHaveLength(1);
  });
});

describe("Was this page helpful?, where the server's admins keep the answers (#7209)", () => {
  test("says before anyone answers that the answer goes to this server's admins, and not after", async () => {
    const page: OpenedPage = await openPage({ mode: "keep" });
    const where: HTMLElement = page.document.querySelector(
      "[data-feedback-where]",
    ) as HTMLElement;

    expect(where.textContent).toBe("ui.feedbackKeptForAdmins");
    expect(where.hidden).toBe(false);

    (
      page.document.querySelector('[data-feedback-answer="no"]') as HTMLElement
    ).click();

    // Gone with the question: never read under the GitHub link a no offers.
    expect(where.hidden).toBe(true);
    expect(
      (
        page.document.querySelector("[data-feedback-github]") as HTMLElement
      ).closest("[hidden]"),
    ).toBeNull();
  });

  test("posts a yes for the admins, even after Reject all: it is no measurement, and names nobody", async () => {
    const page: OpenedPage = await openPage({
      mode: "keep",
      consent: "denied",
      globalPrivacyControl: true,
    });

    (
      page.document.querySelector('[data-feedback-answer="yes"]') as HTMLElement
    ).click();
    await wait(page.window, 50);

    expect(feedbackPosts(page)).toEqual([
      { page: "on-call/escalation-rules", language: "en", isHelpful: true },
    ]);
  });

  test("offers the four reasons after a no, and posts the one picked, once", async () => {
    const page: OpenedPage = await openPage({ mode: "keep" });

    (
      page.document.querySelector('[data-feedback-answer="no"]') as HTMLElement
    ).click();
    expect(
      page.document.querySelectorAll("[data-feedback-reason]"),
    ).toHaveLength(4);

    (
      page.document.querySelector(
        '[data-feedback-reason="missing"]',
      ) as HTMLElement
    ).click();
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await wait(page.window, 50);

    expect(feedbackPosts(page)).toEqual([
      {
        page: "on-call/escalation-rules",
        language: "en",
        isHelpful: false,
        reason: "missing",
      },
    ]);
    expect(page.beacons).toEqual([]);
  });

  test("on a self-hosted server that keeps nothing, says nothing of the admins", async () => {
    const page: OpenedPage = await openPage({ mode: "local" });

    expect(page.document.querySelector("[data-feedback-where]")).toBeNull();
  });
});

describe("a docs search that found nothing (#7207)", () => {
  test("is reported once it settles: a second after the server answered with nothing, with what was typed and the language", async () => {
    const page: OpenedPage = await openPage({
      search: FOUND_NOTHING,
      isSearchReported: true,
      consent: "granted",
    });

    openSearch(page);
    type(page, "sentinelone");
    await searchSettled(page);

    // Not yet: the reader may still be typing.
    expect(foundNothingPosts(page)).toEqual([]);

    await wait(page.window, 1100);
    expect(foundNothingPosts(page)).toEqual([
      { query: "sentinelone", language: "en" },
    ]);

    // Drawn again for the same words, it is not reported twice.
    type(page, "sentinelone ");
    await searchSettled(page);
    await wait(page.window, 1100);
    expect(foundNothingPosts(page)).toHaveLength(1);
  });

  test("is reported at once when the box closes on it", async () => {
    const page: OpenedPage = await openPage({
      search: FOUND_NOTHING,
      isSearchReported: true,
      consent: "granted",
    });

    openSearch(page);
    type(page, "wazuh");
    await searchSettled(page);
    closeSearch(page);
    await wait(page.window, 20);

    expect(foundNothingPosts(page)).toEqual([
      { query: "wazuh", language: "en" },
    ]);
  });

  test("never for a search that found something, one shorter than 2 characters, or one the server could not answer", async () => {
    const found: OpenedPage = await openPage({
      search: (): unknown => {
        return ESCALATION_ANSWER;
      },
      isSearchReported: true,
      consent: "granted",
    });

    openSearch(found);
    type(found, "escalaton");
    await searchSettled(found);
    await wait(found.window, 1100);
    type(found, "z");
    await wait(found.window, 1100);
    closeSearch(found);
    expect(foundNothingPosts(found)).toEqual([]);
    found.window.close();

    const offline: OpenedPage = await openPage({
      search: "offline",
      isSearchReported: true,
      consent: "granted",
    });

    openSearch(offline);
    type(offline, "zzqxv");
    await searchSettled(offline);
    await wait(offline.window, 1100);
    closeSearch(offline);
    expect(foundNothingPosts(offline)).toEqual([]);
  });

  test("never where the server sends no analytics: every self-hosted server", async () => {
    const page: OpenedPage = await openPage({
      search: FOUND_NOTHING,
      isSearchReported: false,
      consent: "granted",
    });

    openSearch(page);
    type(page, "sentinelone");
    await searchSettled(page);
    await wait(page.window, 1100);
    closeSearch(page);
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await wait(page.window, 20);

    expect(foundNothingPosts(page)).toEqual([]);
    expect(page.beacons).toEqual([]);
  });

  test("never after Reject all, nor under Global Privacy Control unless the reader accepted", async () => {
    const refused: OpenedPage = await openPage({
      search: FOUND_NOTHING,
      isSearchReported: true,
      consent: "denied",
    });

    openSearch(refused);
    type(refused, "sentinelone");
    await searchSettled(refused);
    await wait(refused.window, 1100);
    closeSearch(refused);
    expect(foundNothingPosts(refused)).toEqual([]);
    refused.window.close();

    const privacy: OpenedPage = await openPage({
      search: FOUND_NOTHING,
      isSearchReported: true,
      consent: "unset",
      globalPrivacyControl: true,
    });

    openSearch(privacy);
    type(privacy, "sentinelone");
    await searchSettled(privacy);
    await wait(privacy.window, 1100);
    expect(foundNothingPosts(privacy)).toEqual([]);
  });

  test("goes as a beacon when the page is left on it", async () => {
    const page: OpenedPage = await openPage({
      search: FOUND_NOTHING,
      isSearchReported: true,
      consent: "granted",
    });

    openSearch(page);
    type(page, "nagios import");
    await searchSettled(page);
    page.window.dispatchEvent(new page.window.Event("pagehide"));
    await wait(page.window, 20);

    expect(page.beacons).toEqual([
      {
        url: "/docs/search/found-nothing",
        body: JSON.stringify({ query: "nagios import", language: "en" }),
      },
    ]);
    expect(foundNothingPosts(page)).toEqual([]);
  });
});
