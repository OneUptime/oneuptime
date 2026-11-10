import {
  APIRequestContext,
  expect,
  Page,
  Response,
  test,
  TestInfo,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A status page whose default language is Arabic (issue #6408), in a real
 * browser, on the real status page - its own index.ejs and its own app,
 * with only its API answered from fixture data (StatusPageTheme/Fixture,
 * `lang=ar`). See README.md.
 *
 *   - Its HTML is sent in Arabic, right to left, before anything but the
 *     template has run, and the app keeps it so.
 *   - Tailwind's reading-direction config is served where index.ejs asks
 *     for it, so a left or right utility means the start or the end of the
 *     line, and a laptop's tabs run from the right.
 *   - Its words are the status page's Arabic, its Arabic letters drawn in
 *     Vazirmatn, its dates in Arabic with Latin digits.
 *   - Nothing scrolls sideways, light or dark, on a laptop or a phone.
 */

const PAGE: string = "/status-page/00000000-0000-4000-8000-000000000001";
const SCREENSHOTS: string = "../../output/playwright/status-page-theme-ui";

type LocaleTree = { [key: string]: string | LocaleTree };

const ARABIC: LocaleTree = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/StatusPage/src/Locales/ar.json",
    ),
    "utf8",
  ),
) as LocaleTree;

// The status page's Arabic for a key such as nav.subscribe.
const arabic: (key: string) => string = (key: string): string => {
  let node: string | LocaleTree | undefined = ARABIC;

  for (const part of key.split(".")) {
    node = typeof node === "object" ? node[part] : undefined;
  }

  if (typeof node !== "string") {
    throw new Error(`${key} is not a text of the status page's ar.json`);
  }

  return node;
};

/*
 * The overall status banner's words before the status: "حالة بعض الموارد:".
 * Both a laptop's and a phone's page draw the banner.
 */
const bannerWords: () => string = (): string => {
  return arabic("overview.someResourcesAre").replace("{{status}}", "").trim();
};

// A phone's page folds its tabs into a menu, its current tab beside it.
const isPhone: (page: Page) => boolean = (page: Page): boolean => {
  return (page.viewportSize()?.width || 0) < 640;
};

// ٠-٩ and the Persian ۰-۹: Arabic in OneUptime writes Latin digits.
const ARABIC_INDIC_DIGITS: RegExp = /[٠-٩۰-۹]/g;
const LATIN_DIGIT: RegExp = /[0-9]/;
// A date as the page writes it in Arabic: "09 نوفمبر 2026".
const ARABIC_DATE: RegExp =
  /\d{2} (يناير|فبراير|مارس|أبريل|مايو|يونيو|يوليو|أغسطس|سبتمبر|أكتوبر|نوفمبر|ديسمبر) \d{4}/;

interface PageLanguage {
  lang: string;
  dir: string;
  // The direction the page is laid out in.
  direction: string;
}

const pageLanguage: (page: Page) => Promise<PageLanguage> = async (
  page: Page,
): Promise<PageLanguage> => {
  return page.evaluate((): PageLanguage => {
    return {
      lang: document.documentElement.getAttribute("lang") || "",
      dir: document.documentElement.getAttribute("dir") || "",
      direction: window.getComputedStyle(document.documentElement).direction,
    };
  });
};

const openArabicPage: (page: Page, theme?: string) => Promise<void> = async (
  page: Page,
  theme: string = "Light",
): Promise<void> => {
  await page.goto(`${PAGE}?theme=${theme}&lang=ar`);
  await expect(page.getByTestId("status-page-overview")).toBeVisible();
  // The Arabic words are fetched once the page reads its default language.
  await expect(page.locator("#overview-alert")).toContainText(bannerWords());
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

test.afterEach(async ({ page }: { page: Page }) => {
  const unexpected: Array<string> = await page
    .evaluate((): Array<string> => {
      return (
        (
          window as unknown as {
            __statusPageThemeFixture?: { unexpected: Array<string> };
          }
        ).__statusPageThemeFixture?.unexpected || []
      );
    })
    .catch((): Array<string> => {
      return [];
    });

  expect(unexpected).toEqual([]);
});

test.describe("a status page in Arabic", () => {
  test("its HTML is sent in Arabic, right to left, before anything but the template has run", async ({
    page,
    request,
  }: {
    page: Page;
    request: APIRequestContext;
  }) => {
    // Tailwind, its reading-direction config and the app are held back.
    await request.get("/hold");

    try {
      await page.goto(`${PAGE}?theme=Light&lang=ar`, { waitUntil: "commit" });
      // The template's head has run as far as its theme.
      await page.waitForFunction((): boolean => {
        return Boolean(document.documentElement.getAttribute("data-theme"));
      });

      // Tailwind has not run, and the app has not started.
      expect(
        await page.evaluate((): boolean => {
          return "tailwind" in window;
        }),
      ).toBe(false);
      expect(await pageLanguage(page)).toEqual({
        lang: "ar",
        dir: "rtl",
        direction: "rtl",
      });
      expect(await page.getByTestId("status-page-overview").count()).toBe(0);
    } finally {
      await request.get("/release");
    }

    // The app, once it runs, keeps the page's language and its direction.
    await expect(page.getByTestId("status-page-overview")).toBeVisible();
    await expect(page.locator("#overview-alert")).toContainText(bannerWords());
    expect(await pageLanguage(page)).toEqual({
      lang: "ar",
      dir: "rtl",
      direction: "rtl",
    });
  });

  test("the reading-direction config is served, so a left margin is the start of the line", async ({
    page,
  }: {
    page: Page;
  }) => {
    const config: Promise<Response> = page.waitForResponse(
      (response: Response): boolean => {
        return response
          .url()
          .endsWith("/status-page/assets/js/tailwind-reading-direction.js");
      },
    );

    await openArabicPage(page);

    expect((await config).status()).toBe(200);

    // A margin on the left means the start of the line: the right, here.
    const sides: { left: string; right: string } = await page.evaluate(
      async (): Promise<{ left: string; right: string }> => {
        const box: HTMLDivElement = document.createElement("div");
        box.className = "ml-6";
        document.body.appendChild(box);

        // Tailwind's runtime writes the class's rule on its next frame.
        for (let frame: number = 0; frame < 20; frame++) {
          await new Promise<void>((resolve: () => void): void => {
            requestAnimationFrame((): void => {
              resolve();
            });
          });

          if (window.getComputedStyle(box).marginRight !== "0px") {
            break;
          }
        }

        const style: CSSStyleDeclaration = window.getComputedStyle(box);
        const found: { left: string; right: string } = {
          left: style.marginLeft,
          right: style.marginRight,
        };
        box.remove();

        return found;
      },
    );

    expect(sides).toEqual({ left: "0px", right: "24px" });
  });

  test("a laptop's tabs run from the right: Overview first, Subscribe last", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.skip(isPhone(page), "A phone folds its tabs into a menu.");

    await openArabicPage(page);

    const overview: { x: number; width: number } | null = await page
      .getByRole("link", { name: arabic("nav.overview") })
      .first()
      .boundingBox();
    const subscribe: { x: number; width: number } | null = await page
      .getByRole("link", { name: arabic("nav.subscribe") })
      .first()
      .boundingBox();

    expect(overview).not.toBeNull();
    expect(subscribe).not.toBeNull();
    expect(overview!.x).toBeGreaterThan(subscribe!.x + subscribe!.width);
  });

  test("its words are the status page's Arabic, and its letters are drawn in Vazirmatn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openArabicPage(page);

    // A laptop's tabs; a phone's current tab, beside the menu of the rest.
    const tabs: Array<string> = isPhone(page)
      ? ["nav.overview"]
      : [
          "nav.overview",
          "nav.incidents",
          "nav.announcements",
          "nav.scheduledEvents",
          "nav.subscribe",
        ];

    for (const key of tabs) {
      await expect(
        page.getByText(arabic(key)).filter({ visible: true }).first(),
      ).toBeVisible();
    }

    await expect(page.locator("#overview-alert")).toContainText(bannerWords());

    const faces: Array<{ family: string; unicodeRange: string }> =
      await page.evaluate(
        (): Array<{ family: string; unicodeRange: string }> => {
          return Array.from(document.fonts)
            .filter((face: FontFace): boolean => {
              return face.status === "loaded";
            })
            .map((face: FontFace): { family: string; unicodeRange: string } => {
              return {
                family: face.family.replace(/["']/g, ""),
                unicodeRange: face.unicodeRange,
              };
            });
        },
      );

    expect(faces).toContainEqual({
      family: "Inter",
      unicodeRange: expect.stringContaining("U+600-6FF"),
    });
  });

  test("its dates are written in Arabic with Latin digits", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openArabicPage(page);

    const text: string = await page
      .getByTestId("status-page-overview")
      .innerText();

    expect(text).toMatch(ARABIC_DATE);
    expect(text).toMatch(LATIN_DIGIT);
    expect(text.match(ARABIC_INDIC_DIGITS) || []).toEqual([]);
  });

  for (const theme of ["Light", "Dark"]) {
    test(`nothing scrolls sideways on a ${theme} page`, async ({
      page,
    }: { page: Page }, testInfo: TestInfo) => {
      await openArabicPage(page, theme);

      await expectNoSidewaysScroll(page);

      await page.screenshot({
        path: `${SCREENSHOTS}/${testInfo.project.name}-arabic-${theme.toLowerCase()}.png`,
        fullPage: true,
      });
    });
  }
});
