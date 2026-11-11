import { BrowserContext, expect, Page, test, TestInfo } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE SIGN-IN PAGES ON A SERVER THAT CANNOT SEND EMAIL (#6825), in a real
 * browser: Forgot password and "Sign in with a link" say so in place of
 * their form, before anyone types, and who can let the reader in - with
 * email=none, the fixture's server answers canSendEmail false
 * (Fixture/MockApi.js). Where it can send, the form is there as before.
 *
 * At a laptop's width and a phone's, light and dark, in English, German
 * and Persian, nothing is wider than the screen. Screenshots are saved for
 * review under output/playwright/accounts-theme-ui.
 */

const THEME_KEY: string = "oneuptime-dashboard-theme";
const LANGUAGE_KEY: string = "oneuptimeLang";
const SCREENSHOTS: string = "../../output/playwright/accounts-theme-ui";

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

const PAGES: Array<{
  name: string;
  address: string;
  notice: string;
  form: string;
}> = [
  {
    name: "forgot-password",
    address: "/accounts/forgot-password",
    notice: "forgot-password-cannot-email",
    form: "forgot-password-card",
  },
  {
    name: "magic-link",
    address: "/accounts/magic-link",
    notice: "magic-link-cannot-email",
    form: "magic-link-form",
  },
];

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
      if (window.sessionStorage.getItem("__no_email_spec_kept")) {
        return;
      }

      window.sessionStorage.setItem("__no_email_spec_kept", "1");

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
    path: `${SCREENSHOTS}/${testInfo.project.name}-no-email-${name}.png`,
    fullPage: true,
  });
};

test.describe("the sign-in pages on a server that cannot send email", () => {
  for (const signInPage of PAGES) {
    test(`${signInPage.name}: says so in place of its form, at a laptop's width and a phone's, light and dark`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }, testInfo: TestInfo) => {
      for (const theme of ["light", "dark"]) {
        await keep(context, { theme: theme });
        await page.emulateMedia({
          colorScheme: theme === "dark" ? "dark" : "light",
        });

        for (const [size, viewport] of [
          ["laptop", LAPTOP],
          ["phone", PHONE],
        ] as Array<[string, { width: number; height: number }]>) {
          await page.setViewportSize(viewport);
          await page.goto(`${signInPage.address}?email=none`);

          const notice: ReturnType<Page["getByTestId"]> = page.getByTestId(
            signInPage.notice,
          );

          await expect(notice).toBeVisible();
          await expect(notice).toContainText("This server cannot send email yet");
          await expect(notice).toContainText("server's admin");
          await expect(page.getByTestId(signInPage.form)).toHaveCount(0);
          await expect(page.getByRole("textbox")).toHaveCount(0);
          await settle(page);

          await expectNoSidewaysScroll(page);
          await shoot(page, testInfo, `${signInPage.name}-${theme}-${size}`);
        }

        await page.evaluate((): void => {
          window.sessionStorage.removeItem("__no_email_spec_kept");
        });
      }
    });

    test(`${signInPage.name}: a server that can send email shows the form, as before`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize(LAPTOP);
      await page.goto(signInPage.address);

      await expect(page.getByTestId(signInPage.form)).toBeVisible();
      await expect(page.getByTestId(signInPage.notice)).toHaveCount(0);
    });

    for (const language of [
      { code: "de", direction: "ltr" },
      { code: "fa", direction: "rtl" },
    ]) {
      test(`${signInPage.name}: in ${language.code}, at a laptop's width and a phone's`, async ({
        page,
        context,
      }: {
        page: Page;
        context: BrowserContext;
      }, testInfo: TestInfo) => {
        await keep(context, { language: language.code });

        for (const [size, viewport] of [
          ["laptop", LAPTOP],
          ["phone", PHONE],
        ] as Array<[string, { width: number; height: number }]>) {
          await page.setViewportSize(viewport);
          await page.goto(`${signInPage.address}?email=none`);

          const notice: ReturnType<Page["getByTestId"]> = page.getByTestId(
            signInPage.notice,
          );

          await expect(notice).toBeVisible();
          // Said in the reader's language, not in English.
          await expect(notice).not.toContainText("This server cannot send");
          await expect(page.locator("html")).toHaveAttribute(
            "dir",
            language.direction,
          );
          await settle(page);

          await expectNoSidewaysScroll(page);
          await shoot(
            page,
            testInfo,
            `${signInPage.name}-${language.code}-${size}`,
          );
        }
      });
    }
  }
});
