import { getPageSEO, PageSEOData } from "../Utils/PageSEO";
import ejs from "ejs";
import { DOMWindow, JSDOM, VirtualConsole } from "jsdom";
import path from "path";
import { describe, expect, test } from "@jest/globals";

/*
 * The cookie banner, clicked.
 *
 * "Reject all" used to record an answer and change nothing: the Tag Manager
 * container and PostHog had already loaded and kept going, and every later
 * page loaded them again. AttributionCapture.test.ts covers the consent rule
 * script by script; this renders a real marketing page, runs everything on it
 * in jsdom and presses the buttons a visitor presses.
 *
 * jsdom fetches no external script, so a tag "loading" here means its <script>
 * element was added to the page - which is exactly the moment a browser would
 * start fetching it.
 */

const VIEWS_ROOT: string = path.join(__dirname, "..", "Views");
const PAGE_URL: string = "https://oneuptime.com/enterprise/demo";
const CONTAINER_URL: string =
  "https://www.googletagmanager.com/gtm.js?id=GTM-PKQD5WH";
const POSTHOG_LIBRARY: string = "https://eu.posthog.com/static/array.js";

// Measurement runs until refused here, and waits for consent here.
const NEW_YORK: string = "America/New_York";
const BERLIN: string = "Europe/Berlin";

interface Visit {
  timeZone: string;
  storedConsent?: "true" | "false" | undefined;
  cookies?: Array<string> | undefined;
}

interface OpenedPage {
  window: DOMWindow & Record<string, any>;
  errors: Array<string>;
}

const renderDemo: () => Promise<string> = async (): Promise<string> => {
  const seo: PageSEOData = getPageSEO("/enterprise/demo");

  return (await ejs.renderFile(
    path.join(VIEWS_ROOT, "demo.ejs"),
    {
      support: false,
      enableGoogleTagManager: true,
      footerCards: false,
      cta: false,
      blackLogo: true,
      requestDemoCta: false,
      reviewsList1: [],
      reviewsList2: [],
      reviewsList3: [],
      seo: { ...seo, fullCanonicalUrl: PAGE_URL },
      homeUrl: "https://oneuptime.com",
    },
    { views: [VIEWS_ROOT] },
  )) as string;
};

// PostHog waits for an idle moment; jsdom has none, so a timer stands in.
const settle: () => Promise<void> = (): Promise<void> => {
  return new Promise<void>((resolve: () => void) => {
    setTimeout(resolve, 25);
  });
};

const open: (visit: Visit) => Promise<OpenedPage> = async (
  visit: Visit,
): Promise<OpenedPage> => {
  const errors: Array<string> = [];
  const virtualConsole: VirtualConsole = new VirtualConsole();

  virtualConsole.on("jsdomError", (error: Error) => {
    errors.push(error.message);
  });

  const dom: JSDOM = new JSDOM(await renderDemo(), {
    url: PAGE_URL,
    runScripts: "dangerously",
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse: (pageWindow: DOMWindow): void => {
      (pageWindow as unknown as Record<string, unknown>)["Intl"] = {
        DateTimeFormat: (): unknown => {
          return {
            resolvedOptions: (): { timeZone: string } => {
              return { timeZone: visit.timeZone };
            },
          };
        },
      };

      if (visit.storedConsent) {
        pageWindow.localStorage.setItem("cookiesAccepted", visit.storedConsent);
      }

      for (const cookie of visit.cookies || []) {
        pageWindow.document.cookie = cookie;
      }
    },
  });

  await new Promise<void>((resolve: () => void) => {
    if (dom.window.document.readyState === "complete") {
      resolve();
      return;
    }

    dom.window.addEventListener("load", () => {
      resolve();
    });
  });

  await settle();

  return { window: dom.window as DOMWindow & Record<string, any>, errors };
};

const scriptSources: (page: OpenedPage) => Array<string> = (
  page: OpenedPage,
): Array<string> => {
  return Array.from(page.window.document.querySelectorAll("script[src]")).map(
    (script: Element) => {
      return script.getAttribute("src") || "";
    },
  );
};

const bannerShown: (page: OpenedPage) => boolean = (
  page: OpenedPage,
): boolean => {
  return (
    page.window.document.getElementById("cookie")!.style.display === "block"
  );
};

const press: (page: OpenedPage, label: string) => Promise<void> = async (
  page: OpenedPage,
  label: string,
): Promise<void> => {
  const button: HTMLElement | undefined = Array.from(
    page.window.document.querySelectorAll("#cookie button"),
  ).find((candidate: Element) => {
    return candidate.textContent!.replace(/\s+/g, " ").trim() === label;
  }) as HTMLElement | undefined;

  expect(button).toBeDefined();

  button!.click();

  await settle();
};

const cookieNames: (page: OpenedPage) => Array<string> = (
  page: OpenedPage,
): Array<string> => {
  const raw: string = page.window.document.cookie;

  return raw
    ? raw
        .split(";")
        .map((cookie: string) => {
          return cookie.split("=")[0]!.trim();
        })
        .sort()
    : [];
};

const lastConsentCommand: (page: OpenedPage) => Array<unknown> | undefined = (
  page: OpenedPage,
): Array<unknown> | undefined => {
  return (page.window["dataLayer"] as Array<unknown>)
    .map((entry: unknown) => {
      return Array.from((entry || []) as ArrayLike<unknown>);
    })
    .filter((command: Array<unknown>) => {
      return command[0] === "consent";
    })
    .pop();
};

describe("where the law asks for consent first", () => {
  test("the banner asks, and nothing measuring loads until it is answered", async () => {
    const page: OpenedPage = await open({ timeZone: BERLIN });

    expect(bannerShown(page)).toBe(true);
    expect(scriptSources(page)).not.toContain(CONTAINER_URL);
    expect(scriptSources(page)).not.toContain(POSTHOG_LIBRARY);
    expect(page.errors).toEqual([]);
    page.window.close();
  });

  test('"Accept all" loads what it was holding back, and closes the banner', async () => {
    const page: OpenedPage = await open({ timeZone: BERLIN });

    await press(page, "Accept all");

    expect(bannerShown(page)).toBe(false);
    expect(scriptSources(page)).toContain(CONTAINER_URL);
    expect(scriptSources(page)).toContain(POSTHOG_LIBRARY);
    expect(page.window.localStorage.getItem("cookiesAccepted")).toBe("true");
    expect(page.errors).toEqual([]);
    page.window.close();
  });

  test('"Reject all" closes the banner and loads nothing', async () => {
    const page: OpenedPage = await open({ timeZone: BERLIN });

    await press(page, "Reject all");

    expect(bannerShown(page)).toBe(false);
    expect(scriptSources(page)).not.toContain(CONTAINER_URL);
    expect(scriptSources(page)).not.toContain(POSTHOG_LIBRARY);
    expect(page.window.localStorage.getItem("cookiesAccepted")).toBe("false");
    page.window.close();
  });
});

describe("where measurement runs until it is refused", () => {
  const visit: Visit = {
    timeZone: NEW_YORK,
    cookies: [
      "_ga=GA1.1.1; path=/",
      "_gcl_au=1.1.1; path=/",
      "session=1; path=/",
    ],
  };

  test("the banner asks while measurement runs", async () => {
    const page: OpenedPage = await open(visit);

    expect(bannerShown(page)).toBe(true);
    expect(scriptSources(page)).toContain(CONTAINER_URL);
    expect(scriptSources(page)).toContain(POSTHOG_LIBRARY);
    expect(page.errors).toEqual([]);
    page.window.close();
  });

  /*
   * The defect this suite exists for: pressing it used to leave everything
   * running.
   */
  describe('"Reject all"', () => {
    test("closes the banner and is remembered", async () => {
      const page: OpenedPage = await open(visit);

      await press(page, "Reject all");

      expect(bannerShown(page)).toBe(false);
      expect(page.window.localStorage.getItem("cookiesAccepted")).toBe("false");
      page.window.close();
    });

    test("tells the Google tags on the page", async () => {
      const page: OpenedPage = await open(visit);

      await press(page, "Reject all");

      expect(lastConsentCommand(page)).toEqual([
        "consent",
        "update",
        expect.objectContaining({
          ad_storage: "denied",
          ad_user_data: "denied",
          ad_personalization: "denied",
          analytics_storage: "denied",
        }),
      ]);
      page.window.close();
    });

    test("stops PostHog", async () => {
      const page: OpenedPage = await open(visit);

      await press(page, "Reject all");

      expect(
        Array.from(page.window["posthog"] as ArrayLike<unknown>).map(
          (entry: unknown) => {
            return Array.from((entry || []) as ArrayLike<unknown>);
          },
        ),
      ).toContainEqual(["opt_out_capturing"]);
      page.window.close();
    });

    test("removes the measurement cookies and keeps the rest", async () => {
      const page: OpenedPage = await open(visit);

      expect(cookieNames(page)).toEqual(["_ga", "_gcl_au", "session"]);

      await press(page, "Reject all");

      expect(cookieNames(page)).toEqual(["session"]);
      page.window.close();
    });
  });
});

describe("a visitor who refused on an earlier visit", () => {
  const visit: Visit = { timeZone: NEW_YORK, storedConsent: "false" };

  test("is not asked again, and nothing measuring loads", async () => {
    const page: OpenedPage = await open(visit);

    expect(bannerShown(page)).toBe(false);
    expect(scriptSources(page)).not.toContain(CONTAINER_URL);
    expect(scriptSources(page)).not.toContain(POSTHOG_LIBRARY);
    page.window.close();
  });

  test('can change their mind from "Cookie settings" in the footer', async () => {
    const page: OpenedPage = await open(visit);
    const settings: HTMLElement | undefined = Array.from(
      page.window.document.querySelectorAll("a"),
    ).find((link: Element) => {
      return link.textContent!.trim() === "Cookie settings";
    }) as HTMLElement | undefined;

    expect(settings).toBeDefined();

    settings!.click();

    expect(bannerShown(page)).toBe(true);

    await press(page, "Accept all");

    expect(bannerShown(page)).toBe(false);
    expect(scriptSources(page)).toContain(CONTAINER_URL);
    expect(scriptSources(page)).toContain(POSTHOG_LIBRARY);
    page.window.close();
  });
});
