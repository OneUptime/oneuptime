import { expect, Locator, Page, test, TestInfo } from "@playwright/test";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * SIGNING IN TO A DASHBOARD'S PUBLIC LINK (#10250), IN A REAL BROWSER.
 *
 * A dashboard shared with Only people who sign in asks its visitors to sign
 * in on its link before it shows them anything: its private users with an
 * email and a password, or anyone its SAML or OIDC single sign-on lets in.
 * The fixture serves the real public dashboard app, with only its API
 * answered (Fixture/MockApi.js): the dashboards that ask visitors to sign in
 * are Fixture/Scenarios.js's signIn, signInDark and signInSsoOnly, and their
 * one private user is PRIVATE_USER.
 *
 * On a desktop (1280px) and a phone (Pixel 5, 390px):
 *
 *   - the link opens on Sign In, titled with the dashboard's name, with an
 *     email, a password and Forgot password?, and a button per single
 *     sign-on provider - and the page asks the server for nothing of the
 *     dashboard before someone has signed in;
 *   - a wrong password is answered with the server's one sentence, and the
 *     visitor stays on Sign In;
 *   - signing in opens the dashboard, with Sign Out in its toolbar, and
 *     Sign Out takes the visitor back to Sign In, the dashboard closed
 *     again;
 *   - Forgot password answers every address the same;
 *   - with Require SSO to Sign In, only the providers are offered, each
 *     starting its sign-in on OneUptime's own address;
 *   - the pages take the dashboard's theme, and fit a phone's width.
 *
 * Screenshots of each page are written beside the theme suite's.
 */

interface SignInFixtureRecord {
  requests: Array<string>;
  unexpected: Array<string>;
  passwordResets: Array<string>;
}

const dashboardId: (value: number) => string = (value: number): string => {
  return `da000000-0000-4000-8000-${String(value).padStart(12, "0")}`;
};

type SignInDashboardKey = "signIn" | "signInDark" | "signInSsoOnly";

// The fixture's dashboards that ask their visitors to sign in.
const DASHBOARDS: Record<SignInDashboardKey, string> = {
  signIn: dashboardId(41),
  signInDark: dashboardId(42),
  signInSsoOnly: dashboardId(43),
};

const TITLE: string = "Acme Production";

const PRIVATE_USER: { email: string; password: string } = {
  email: "ada@acme.example",
  password: "correct horse battery",
};

const SAML_PROVIDER_ID: string = "5a000000-0000-4000-8000-000000000001";
const OIDC_PROVIDER_ID: string = "0d000000-0000-4000-8000-000000000001";

// The server's one answer to a wrong password and to an unknown address.
const CREDENTIALS_MESSAGE: string =
  "That email and password do not match. Try again, or use Forgot password to choose a new password.";

const FORGOT_PASSWORD_SENT: string =
  "If this address can sign in to this dashboard, a link to choose a new password is on its way. The link works for 24 hours.";

const SCREENSHOTS: string = "../../output/playwright/public-dashboard-theme-ui";

const pathOf: (key: SignInDashboardKey) => string = (
  key: SignInDashboardKey,
): string => {
  return `/public-dashboard/${DASHBOARDS[key]}`;
};

const fixtureRecord: (page: Page) => Promise<SignInFixtureRecord> = async (
  page: Page,
): Promise<SignInFixtureRecord> => {
  return page.evaluate((): SignInFixtureRecord => {
    const record: SignInFixtureRecord | undefined = (
      window as unknown as {
        __publicDashboardThemeFixture?: SignInFixtureRecord;
      }
    ).__publicDashboardThemeFixture;

    return {
      requests: [...(record?.requests || [])],
      unexpected: [...(record?.unexpected || [])],
      passwordResets: [...(record?.passwordResets || [])],
    };
  });
};

const signInPage: (page: Page) => Locator = (page: Page): Locator => {
  return page.getByTestId("dashboard-sign-in");
};

const emailField: (page: Page) => Locator = (page: Page): Locator => {
  return signInPage(page).getByRole("textbox", { name: "Email" });
};

// The password's label carries Forgot password? beside the word.
const passwordField: (page: Page) => Locator = (page: Page): Locator => {
  return signInPage(page).locator('input[type="password"]');
};

const openSignIn: (
  page: Page,
  key: SignInDashboardKey,
) => Promise<void> = async (
  page: Page,
  key: SignInDashboardKey,
): Promise<void> => {
  await page.goto(pathOf(key));
  await expect(signInPage(page)).toBeVisible();
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
};

const screenshot: (
  page: Page,
  testInfo: TestInfo,
  name: string,
) => Promise<void> = async (
  page: Page,
  testInfo: TestInfo,
  name: string,
): Promise<void> => {
  await page.screenshot({
    path: `${SCREENSHOTS}/sign-in-${name}-${testInfo.project.name}.png`,
    fullPage: true,
  });
};

const signInWith: (
  page: Page,
  email: string,
  password: string,
) => Promise<void> = async (
  page: Page,
  email: string,
  password: string,
): Promise<void> => {
  await emailField(page).fill(email);
  await passwordField(page).fill(password);
  await signInPage(page)
    .getByRole("button", { name: "Sign In", exact: true })
    .click();
};

// A request for the metadata or a sign-in route, as the fixture records it.
const SIGN_IN_PAGE_REQUEST: RegExp = / \/(metadata|private-user)\//;

// Every request but the metadata and the sign-in routes: the dashboard's own.
const dashboardReads: (requests: Array<string>) => Array<string> = (
  requests: Array<string>,
): Array<string> => {
  return requests.filter((request: string): boolean => {
    return !SIGN_IN_PAGE_REQUEST.test(request);
  });
};

// Each test is a fresh tab: nobody is signed in to any dashboard.
test.describe("a dashboard that asks its visitors to sign in", () => {
  test("opens on Sign In, and asks the server for nothing of the dashboard", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openSignIn(page, "signIn");

    await expect(page).toHaveURL(new RegExp(`${pathOf("signIn")}/sign-in`));
    await expect(signInPage(page)).toContainText(TITLE);
    await expect(signInPage(page)).toContainText(
      "Sign in to view this dashboard.",
    );
    await expect(emailField(page)).toBeVisible();
    await expect(passwordField(page)).toBeVisible();
    await expect(passwordField(page)).toHaveAttribute(
      "autocomplete",
      "current-password",
    );
    await expect(
      signInPage(page).getByRole("link", { name: "Forgot password?" }),
    ).toBeVisible();
    await expect(
      page.getByTestId(`dashboard-sign-in-provider-${SAML_PROVIDER_ID}`),
    ).toContainText("Sign in with Okta");
    await expect(
      page.getByTestId(`dashboard-sign-in-provider-${OIDC_PROVIDER_ID}`),
    ).toContainText("Sign in with Google Workspace");

    const record: SignInFixtureRecord = await fixtureRecord(page);

    expect(dashboardReads(record.requests)).toEqual([]);
    expect(record.unexpected).toEqual([]);

    await expectNoSidewaysScroll(page, { message: "Sign In" });
    await screenshot(page, testInfo, "light");
  });

  test("answers a wrong password with the server's one sentence, and stays on Sign In", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSignIn(page, "signIn");
    await signInWith(page, PRIVATE_USER.email, "not the password");

    await expect(signInPage(page)).toContainText(CREDENTIALS_MESSAGE);
    await expect(page).toHaveURL(/\/sign-in/);

    // An address that is no private user's is answered the same.
    await signInWith(page, "nobody@acme.example", PRIVATE_USER.password);

    await expect(signInPage(page)).toContainText(CREDENTIALS_MESSAGE);
    expect(dashboardReads((await fixtureRecord(page)).requests)).toEqual([]);
  });

  test("opens the dashboard once its private user signs in, and Sign Out closes it again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSignIn(page, "signIn");
    await signInWith(page, PRIVATE_USER.email, PRIVATE_USER.password);

    await expect(page.getByTestId("public-dashboard-powered-by")).toBeVisible();
    await expect(page).not.toHaveURL(/\/sign-in/);

    const signOut: Locator = page.getByTestId("dashboard-sign-out");

    await expect(signOut).toBeVisible();
    // The dashboard's own reads, now that someone has signed in.
    expect(
      dashboardReads((await fixtureRecord(page)).requests).length,
    ).toBeGreaterThan(0);
    await expectNoSidewaysScroll(page, { message: "the signed-in dashboard" });

    await signOut.click();

    await expect(signInPage(page)).toBeVisible();
    await expect(page).toHaveURL(/\/sign-in/);

    // The dashboard's link asks again.
    await page.goto(pathOf("signIn"));
    await expect(signInPage(page)).toBeVisible();
    expect(dashboardReads((await fixtureRecord(page)).requests)).toEqual([]);
  });

  test("Forgot password answers every address the same", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openSignIn(page, "signIn");
    await signInPage(page)
      .getByRole("link", { name: "Forgot password?" })
      .click();

    await expect(page).toHaveURL(/\/forgot-password/);
    await expect(page.getByText("Forgot your password?")).toBeVisible();
    await expectNoSidewaysScroll(page, { message: "Forgot password" });

    await page
      .getByRole("textbox", { name: "Email" })
      .fill("nobody@acme.example");
    await page.getByRole("button", { name: "Send Link" }).click();

    await expect(page.getByTestId("dashboard-forgot-password-sent")).toHaveText(
      FORGOT_PASSWORD_SENT,
    );
    expect((await fixtureRecord(page)).passwordResets).toEqual([
      "nobody@acme.example",
    ]);
    await screenshot(page, testInfo, "forgot-password-sent");

    await page.getByRole("link", { name: "Back to sign in" }).click();
    await expect(signInPage(page)).toBeVisible();
  });

  test("with Require SSO to Sign In, offers only its single sign-on, each on OneUptime's own address", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openSignIn(page, "signInSsoOnly");

    await expect(signInPage(page)).toContainText(
      "Sign in with your organization's single sign-on to view this dashboard.",
    );
    await expect(passwordField(page)).toHaveCount(0);
    await expect(page.getByTestId("dashboard-sign-in-form")).toHaveCount(0);

    const saml: Locator = page.getByTestId(
      `dashboard-sign-in-provider-${SAML_PROVIDER_ID}`,
    );
    const oidc: Locator = page.getByTestId(
      `dashboard-sign-in-provider-${OIDC_PROVIDER_ID}`,
    );

    await expect(saml).toBeVisible();
    await expect(oidc).toBeVisible();

    const hrefOf: (provider: Locator) => Promise<string> = async (
      provider: Locator,
    ): Promise<string> => {
      const link: Locator = provider.locator("xpath=ancestor-or-self::a[1]");

      return (await link.getAttribute("href")) || "";
    };

    expect(await hrefOf(saml)).toMatch(
      new RegExp(
        `/identity/dashboard-sso/${DASHBOARDS.signInSsoOnly}/${SAML_PROVIDER_ID}$`,
      ),
    );
    expect(await hrefOf(oidc)).toMatch(
      new RegExp(
        `/identity/dashboard-oidc/${DASHBOARDS.signInSsoOnly}/${OIDC_PROVIDER_ID}$`,
      ),
    );

    await expectNoSidewaysScroll(page, { message: "single sign-on only" });
    await screenshot(page, testInfo, "sso-only");
  });

  test("takes the dashboard's dark theme", async ({
    page,
  }: {
    page: Page;
  }, testInfo: TestInfo) => {
    await openSignIn(page, "signInDark");

    await expect
      .poll(async (): Promise<string | null> => {
        return page.evaluate((): string | null => {
          return document.documentElement.getAttribute("data-theme");
        });
      })
      .toBe("dark");
    expect(
      await page.evaluate((): boolean => {
        return document.documentElement.classList.contains("dark");
      }),
    ).toBe(true);

    await screenshot(page, testInfo, "dark");
  });
});
