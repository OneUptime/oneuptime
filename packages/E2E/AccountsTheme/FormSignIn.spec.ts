import { BrowserContext, expect, Page, test, TestInfo } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A form that asks its visitors to sign in (#10249), in a real browser, on
 * the real page: Accounts' own app with only what the page asks a server
 * answered (Fixture/MockApi.js with form=signin), on the form's link and on
 * its own domain (the fixture's / with formdomain=1).
 *
 *   - A visitor meets the sign-in first, titled with the form's name, with
 *     an email, a password, Forgot password? and a button for the form's
 *     single sign-on - and nothing of the form is read.
 *   - The right password opens the form, saying who is signed in, with Sign
 *     Out; a wrong one gets the server's one answer.
 *   - On the form's own domain, every request goes to the address the page
 *     was opened on.
 *   - At a laptop's width and a phone's, in English and in Persian, nothing
 *     is wider than the screen; Persian reads right to left.
 *
 * Screenshots are saved for review under output/playwright/accounts-theme-ui.
 */

interface FixtureRecord {
  requests: Array<string>;
  addresses: Array<string>;
  unexpected: Array<string>;
}

const LANGUAGE_KEY: string = "oneuptimeLang";
const SCREENSHOTS: string = "../../output/playwright/accounts-theme-ui";

const FORM_NAME: string = "Report a problem";
const SHARE_KEY: string = "8a4f2c1e-3b5d-4c6e-9f70-1a2b3c4d5e6f";
const FORM_LINK: string = `/accounts/form/${SHARE_KEY}?form=signin`;
const FORM_DOMAIN_PAGE: string = "/?formdomain=1&form=signin";
const PASSWORD: string = "correct horse battery staple 9";
const EMAIL: string = "reader@acme.com";

const LAPTOP: { width: number; height: number } = { width: 1280, height: 900 };
const PHONE: { width: number; height: number } = { width: 390, height: 844 };

// The language the browser kept before the page opened.
const keepLanguage: (
  context: BrowserContext,
  language: string,
) => Promise<void> = async (
  context: BrowserContext,
  language: string,
): Promise<void> => {
  await context.addInitScript(
    (kept: { key: string; language: string }): void => {
      if (window.sessionStorage.getItem("__form_sign_in_spec_kept")) {
        return;
      }

      window.sessionStorage.setItem("__form_sign_in_spec_kept", "1");
      window.localStorage.setItem(kept.key, kept.language);
    },
    { key: LANGUAGE_KEY, language: language },
  );
};

const fixture: (page: Page) => Promise<FixtureRecord> = async (
  page: Page,
): Promise<FixtureRecord> => {
  return page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __accountsThemeFixture: FixtureRecord })
          .__accountsThemeFixture,
      ),
    );
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
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
  await page.screenshot({
    path: `${SCREENSHOTS}/${testInfo.project.name}-form-sign-in-${name}.png`,
    fullPage: true,
  });
};

const signIn: (page: Page, password: string) => Promise<void> = async (
  page: Page,
  password: string,
): Promise<void> => {
  await page.getByLabel(/^Email/).fill(EMAIL);
  await page.getByLabel(/^Password/).fill(password);
  await page.getByRole("button", { name: "Sign In", exact: true }).click();
};

test.describe("a form that asks its visitors to sign in", () => {
  test("meets a visitor with its sign-in, titled with its name, and reads nothing of the form", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(FORM_LINK);

    const signInView: ReturnType<Page["getByTestId"]> =
      page.getByTestId("form-sign-in");

    await expect(signInView).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 1, name: FORM_NAME }),
    ).toBeVisible();
    await expect(signInView).toContainText("Sign in to open this form.");
    await expect(page.getByLabel(/^Email/)).toBeVisible();
    await expect(page.getByLabel(/^Password/)).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Forgot password?" }),
    ).toBeVisible();
    await expect(page.getByTestId("form-sign-in-providers")).toContainText(
      "Sign in with Okta",
    );
    await expect(page.getByTestId("form-field-summary")).toHaveCount(0);

    const record: FixtureRecord = await fixture(page);

    expect(
      record.requests.filter((request: string): boolean => {
        return request === `GET /api/form/public/${SHARE_KEY}`;
      }),
    ).toEqual([]);
    expect(record.unexpected).toEqual([]);

    await expectNoSidewaysScroll(page);
    await shoot(page, testInfo, "laptop");
  });

  test("opens the form with the right password, saying who is signed in, with Sign Out", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(FORM_LINK);
    await expect(page.getByTestId("form-sign-in")).toBeVisible();

    await signIn(page, PASSWORD);

    await expect(page.getByTestId("form-field-summary")).toBeVisible();
    await expect(page.getByTestId("form-signed-in-as")).toContainText(
      `Signed in as ${EMAIL}`,
    );
    await expect(page.getByTestId("form-sign-out")).toBeVisible();
    expect((await fixture(page)).unexpected).toEqual([]);

    await expectNoSidewaysScroll(page);
    await shoot(page, testInfo, "signed-in");

    await page.getByTestId("form-sign-out").click();
    await expect(page.getByTestId("form-sign-in")).toBeVisible();
  });

  test("answers a wrong password with the server's one answer, and stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(FORM_LINK);
    await expect(page.getByTestId("form-sign-in")).toBeVisible();

    await signIn(page, "not it");

    await expect(page.getByTestId("form-sign-in")).toContainText(
      "That email and password do not match.",
    );
    await expect(page.getByTestId("form-field-summary")).toHaveCount(0);
  });

  test("on its own domain, signs in at the address the page was opened on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize(LAPTOP);
    await page.goto(FORM_DOMAIN_PAGE);
    await expect(page.getByTestId("form-sign-in")).toBeVisible();

    await signIn(page, PASSWORD);
    await expect(page.getByTestId("form-field-summary")).toBeVisible();

    const record: FixtureRecord = await fixture(page);
    const origin: string = new URL(page.url()).origin;

    expect(
      record.addresses.map((address: string): string => {
        return new URL(address).origin;
      }),
    ).toEqual(
      record.addresses.map((): string => {
        return origin;
      }),
    );
    expect(record.requests).toContain(
      "POST /api/form/private-user/login/0f000000-0000-4000-8000-000000000001",
    );
    expect(record.unexpected).toEqual([]);
  });

  for (const language of ["en", "fa"]) {
    test(`fits a phone's screen in ${language}`, async ({
      page,
      context,
    }: {
      page: Page;
      context: BrowserContext;
    }, testInfo: TestInfo) => {
      await keepLanguage(context, language);
      await page.setViewportSize(PHONE);
      await page.goto(FORM_LINK);
      await expect(page.getByTestId("form-sign-in")).toBeVisible();

      if (language === "fa") {
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      }

      await expectNoSidewaysScroll(page);
      await shoot(page, testInfo, `phone-${language}`);
    });
  }
});
