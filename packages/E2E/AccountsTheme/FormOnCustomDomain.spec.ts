import { BrowserContext, expect, Page, test, TestInfo } from "@playwright/test";

/*
 * A form on its owner's own domain, in a real browser, on the real page: the
 * sign-in app's index.ejs as the App renders it at a form domain's root -
 * with the mark that makes the app draw the form alone - and Accounts' own
 * app, with only what the page asks a server answered (Fixture/server.js
 * with formdomain=1, Fixture/MockApi.js). The fixture's own address stands
 * in for report.acme.com.
 *
 *   - The page is the form and nothing else: no OneUptime logo, a footer with
 *     only the language picker, titled with the form's name.
 *   - It reads the form, and sends the answers, at the address it was opened
 *     on (/api/form/custom-domain), never by a key.
 *   - It is light whatever the visitor picked and their device does.
 *   - At a laptop's width and a phone's, in English, German and Persian,
 *     nothing is wider than the screen; Persian reads right to left.
 *   - A form that is not available says so, with no OneUptime logo either.
 *
 * Screenshots are saved for review under output/playwright/accounts-theme-ui.
 */

interface FixtureRecord {
  requests: Array<string>;
  addresses: Array<string>;
  unexpected: Array<string>;
}

declare global {
  interface Window {
    __accountsThemeFixture: FixtureRecord;
  }
}

const THEME_KEY: string = "oneuptime-dashboard-theme";
const LANGUAGE_KEY: string = "oneuptimeLang";
const SCREENSHOTS: string = "../../output/playwright/accounts-theme-ui";

const FORM_NAME: string = "Report a problem";
const FORM_DOMAIN_PAGE: string = "/?formdomain=1";

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

// What the browser kept before the page opened: a theme pick and a language.
const keep: (
  context: BrowserContext,
  data: { theme?: string | undefined; language?: string | undefined },
) => Promise<void> = async (
  context: BrowserContext,
  data: { theme?: string | undefined; language?: string | undefined },
): Promise<void> => {
  await context.addInitScript(
    (kept: {
      themeKey: string;
      languageKey: string;
      theme: string;
      language: string;
    }): void => {
      if (window.sessionStorage.getItem("__form_domain_spec_kept")) {
        return;
      }

      window.sessionStorage.setItem("__form_domain_spec_kept", "1");

      if (kept.theme) {
        window.localStorage.setItem(kept.themeKey, kept.theme);
      }

      window.localStorage.setItem(kept.languageKey, kept.language);
    },
    {
      themeKey: THEME_KEY,
      languageKey: LANGUAGE_KEY,
      theme: data.theme || "",
      language: data.language || "en",
    },
  );
};

const settle: (page: Page) => Promise<void> = async (
  page: Page,
): Promise<void> => {
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await page.waitForFunction((): boolean => {
    return document.getAnimations().every((animation: Animation): boolean => {
      return animation.playState !== "running";
    });
  });
};

const shoot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-form-domain-${name}.png`,
    fullPage: true,
  });
};

const fixture: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return JSON.parse(JSON.stringify(window.__accountsThemeFixture));
  });
};

// How much wider than the window the page is drawn: nothing, on every page.
const overflow: (page: Page) => Promise<number> = async (
  page: Page,
): Promise<number> => {
  return page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
};

const openFormOnItsDomain: (
  page: Page,
  query?: string | undefined,
) => Promise<void> = async (
  page: Page,
  query?: string | undefined,
): Promise<void> => {
  await page.goto(`${FORM_DOMAIN_PAGE}${query ? `&${query}` : ""}`);
};

test.describe("a form on its own domain", () => {
  test("is the form alone: titled with its name, no OneUptime logo, a footer with only the language picker", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.setViewportSize(LAPTOP);
    await openFormOnItsDomain(page);

    await expect(
      page.getByRole("heading", { level: 1, name: FORM_NAME }),
    ).toBeVisible();
    await settle(page);

    await expect(page).toHaveTitle(FORM_NAME);
    await expect(page.getByTestId("form-logo")).toHaveCount(0);

    const footer: ReturnType<Page["locator"]> = page.locator("footer");

    await expect(footer).toBeVisible();
    await expect(footer.locator("a")).toHaveCount(0);
    await expect(footer).not.toContainText("©");

    // The page says it is the form's, as the server wrote it.
    await expect(
      page.locator('meta[name="oneuptime-form-domain"][content="true"]'),
    ).toHaveCount(1);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, testInfo, "laptop");
  });

  test("reads the form and sends the answers at the address it was opened on, naming no key", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.setViewportSize(LAPTOP);
    await openFormOnItsDomain(page);
    await expect(
      page.getByRole("heading", { level: 1, name: FORM_NAME }),
    ).toBeVisible();

    await page.getByTestId("form-field-summary").fill("Checkout is down");
    await page.getByRole("button", { name: "Submit", exact: true }).click();

    await expect(page.getByTestId("form-success")).toBeVisible();
    await expect(page.getByTestId("form-reference")).toContainText("INC-7");
    await settle(page);

    const record: FixtureRecord = await fixture(page);
    const origin: string = new URL(page.url()).origin;

    expect(record.requests).toEqual([
      "GET /api/form/custom-domain",
      "POST /api/form/custom-domain/submit",
    ]);
    expect(
      record.addresses.map((address: string): string => {
        return new URL(address).origin;
      }),
    ).toEqual([origin, origin]);
    expect(record.unexpected).toEqual([]);

    await shoot(page, testInfo, "submitted");
  });

  test("is light after Dark was picked, on a dark device", async ({
    page,
    context,
  }: {
    page: Page;
    context: BrowserContext;
  }, testInfo: TestInfo) => {
    await keep(context, { theme: "dark" });
    await page.emulateMedia({ colorScheme: "dark" });
    await page.setViewportSize(LAPTOP);
    await openFormOnItsDomain(page);

    await expect(
      page.getByRole("heading", { level: 1, name: FORM_NAME }),
    ).toBeVisible();
    await settle(page);

    await expect
      .poll(async (): Promise<boolean> => {
        return page.evaluate((): boolean => {
          return document.documentElement.classList.contains("dark");
        });
      })
      .toBe(false);
    expect(
      await page.evaluate((): string => {
        return getComputedStyle(document.body).backgroundColor;
      }),
    ).toBe("rgb(249, 250, 251)");

    await shoot(page, testInfo, "picked-dark");
  });

  test("on a phone, nothing is wider than the screen", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.setViewportSize(PHONE);
    await openFormOnItsDomain(page);

    await expect(
      page.getByRole("heading", { level: 1, name: FORM_NAME }),
    ).toBeVisible();
    await settle(page);

    expect(await overflow(page)).toBeLessThanOrEqual(0);
    await shoot(page, testInfo, "phone");
  });

  for (const language of [
    { code: "de", submit: "Senden", direction: "ltr" },
    { code: "fa", submit: null, direction: "rtl" },
  ]) {
    test(`in ${language.code}, at a laptop's width and a phone's`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }, testInfo: TestInfo) => {
      await keep(context, { language: language.code });

      for (const size of [
        { name: "laptop", viewport: LAPTOP },
        { name: "phone", viewport: PHONE },
      ]) {
        await page.setViewportSize(size.viewport);
        await openFormOnItsDomain(page);

        await expect(
          page.getByRole("heading", { level: 1, name: FORM_NAME }),
        ).toBeVisible();
        await settle(page);

        await expect(page.locator("html")).toHaveAttribute(
          "dir",
          language.direction,
        );

        if (language.submit) {
          await expect(
            page.getByRole("button", { name: language.submit, exact: true }),
          ).toBeVisible();
        }

        expect(await overflow(page)).toBeLessThanOrEqual(0);
        await shoot(page, testInfo, `${language.code}-${size.name}`);
      }
    });
  }

  test("a form that is not available says so, with no OneUptime logo either", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.setViewportSize(LAPTOP);
    await openFormOnItsDomain(page, "form=missing");

    await expect(page.getByTestId("form-load-failure")).toContainText(
      "This form is not available.",
    );
    await settle(page);
    await expect(page.getByTestId("form-logo")).toHaveCount(0);

    await shoot(page, testInfo, "not-available");
  });
});
