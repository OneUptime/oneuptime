import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame, FrameBox } from "../SuiteHelpers/Frames";
import {
  dashboardWord,
  describePageLanguages,
} from "../SuiteHelpers/LocaleChunks";

/*
 * User Profile > Security in English, German, Arabic and Persian (#8796).
 *
 * The Two-factor authentication page (its status, Security keys,
 * Authenticator apps and Backup codes cards) and the Passkeys page are the
 * Dashboard's own, drawn offline by SecurityPage/Fixture with an account
 * that has set everything up, or nothing. Each page reads in the language it
 * is drawn in - every card title, button, status and empty state the
 * Dashboard's locale words - fits its window, and reads right to left in
 * Arabic and Persian. Screenshots of each land in
 * output/playwright/security-page-ui/.
 */

// The fixture server's port, as the config and server.js read it.
const PORT: string = process.env["SECURITY_PAGE_FIXTURE_PORT"] || "4493";
const TWO_FACTOR: string = "/dashboard/user-profile/two-factor-auth";
const PASSKEYS: string = "/dashboard/user-profile/passkeys";
const LANGUAGES: Array<string> = ["en", "de", "ar", "fa"];
const RIGHT_TO_LEFT: Array<string> = ["ar", "fa"];
const SHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/security-page-ui",
);

interface FixtureRecord {
  lists: Array<string>;
  creates: Array<{ table: string; name?: string }>;
  updates: Array<{ table: string; data: Record<string, unknown> }>;
  api: Array<{ method: string; url: string }>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: WeakMap<Page, Array<string>> = new WeakMap();
const abortedRequests: WeakMap<Page, Array<string>> = new WeakMap();

async function fixture(page: Page): Promise<FixtureRecord> {
  return page.evaluate((): FixtureRecord => {
    return (window as unknown as { __securityPageFixture: FixtureRecord })
      .__securityPageFixture;
  });
}

function address(
  route: string,
  options: { language: string; state?: string; theme?: string },
): string {
  const query: URLSearchParams = new URLSearchParams();

  if (options.language !== "en") {
    query.set("lang", options.language);
  }

  if (options.state) {
    query.set("state", options.state);
  }

  if (options.theme) {
    query.set("theme", options.theme);
  }

  const search: string = query.toString();

  return search ? `${route}?${search}` : route;
}

// A card's title, in the page's language: its heading, matched whole.
function cardTitle(page: Page, language: string, english: string): Locator {
  return page.getByText(dashboardWord(language, english), { exact: true });
}

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  abortedRequests.set(page, aborted);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture server.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());
    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }
    aborted.push(route.request().url());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    abortedRequests.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __securityPageFixture?: unknown })
          .__securityPageFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });

  if (hasFixture) {
    expect(
      (await fixture(page)).unhandled,
      "requests the fixture does not model",
    ).toEqual([]);
  }
});

// What the Two-factor authentication page draws, by the English its locale words.
const TWO_FACTOR_CARDS: Array<string> = [
  "Two-factor authentication",
  "Security keys",
  "Authenticator apps",
  "Backup codes",
];

for (const language of LANGUAGES) {
  test.describe(`in ${language}`, () => {
    test("the Two-factor authentication page reads in the language, its four cards and their rows", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(address(TWO_FACTOR, { language }));
      await expect(
        cardTitle(page, language, "Authenticator apps"),
      ).toBeVisible();

      await expect(page.locator("html")).toHaveAttribute("lang", language);
      await expect(page.locator("html")).toHaveAttribute(
        "dir",
        RIGHT_TO_LEFT.includes(language) ? "rtl" : "ltr",
      );

      for (const english of TWO_FACTOR_CARDS) {
        await expect(cardTitle(page, language, english).first()).toBeVisible();
      }

      // The rows: a security key and an app ready, an app whose setup is incomplete.
      for (const name of ["YubiKey 5C", "1Password", "Work phone"]) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }
      await expect(
        page.getByText(dashboardWord(language, "Ready"), { exact: true }),
      ).toHaveCount(2);
      await expect(
        page.getByText(dashboardWord(language, "Setup incomplete"), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: dashboardWord(language, "Finish setup"),
        }),
      ).toBeVisible();

      // The status, and the backup codes: seven of ten left, ready to use.
      await expect(
        page.getByText(dashboardWord(language, "Enabled"), { exact: true }),
      ).toBeVisible();
      await expect(
        page.getByText(dashboardWord(language, "Ready to use"), {
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", {
          name: dashboardWord(language, "Regenerate codes"),
        }),
      ).toBeVisible();

      if (language !== "en") {
        // No card says its English title.
        for (const english of TWO_FACTOR_CARDS) {
          await expect(page.getByText(english, { exact: true })).toHaveCount(0);
        }
      }

      // The side menu sits on the side the language starts from.
      const [menu, card]: Array<FrameBox> = await boxesInOneFrame([
        page
          .getByRole("link", {
            name: dashboardWord(language, "Password Management"),
          })
          .first(),
        cardTitle(page, language, "Authenticator apps"),
      ]);
      if (RIGHT_TO_LEFT.includes(language)) {
        expect(menu!.x).toBeGreaterThan(card!.x);
      } else {
        expect(menu!.x).toBeLessThan(card!.x);
      }

      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: path.join(SHOTS, `two-factor-${language}.png`),
        fullPage: true,
      });
    });

    test("the Passkeys page reads in the language", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(address(PASSKEYS, { language }));
      await expect(
        page.getByRole("button", {
          name: dashboardWord(language, "Add Passkey"),
        }),
      ).toBeVisible();

      await expect(cardTitle(page, language, "Passkeys").first()).toBeVisible();
      for (const name of ["MacBook Pro", "Pixel 9"]) {
        await expect(page.getByText(name, { exact: true })).toBeVisible();
      }
      await expect(
        page.getByText(
          dashboardWord(
            language,
            "Sign in without a password using your fingerprint, face, screen lock, or a compatible security key.",
          ),
          { exact: true },
        ),
      ).toBeVisible();

      expect((await fixture(page)).lists).toContain("UserWebAuthn");
      await expectNoSidewaysScroll(page);
      await page.screenshot({
        path: path.join(SHOTS, `passkeys-${language}.png`),
        fullPage: true,
      });
    });
  });
}

test("a new account's page says what to set up first, in Persian and dark", async ({
  page,
}: {
  page: Page;
}) => {
  const language: string = "fa";

  await page.goto(
    address(TWO_FACTOR, { language, state: "new", theme: "dark" }),
  );

  for (const english of [
    "Not enabled",
    "No security keys added yet.",
    "No authenticator apps added yet.",
    "Set up your recovery option",
  ]) {
    await expect(
      page.getByText(dashboardWord(language, english), { exact: true }),
    ).toBeVisible();
  }
  await expect(
    page.getByRole("button", {
      name: dashboardWord(language, "Generate backup codes"),
    }),
  ).toBeVisible();

  await expectNoSidewaysScroll(page);
  await page.screenshot({
    path: path.join(SHOTS, "two-factor-new-fa-dark.png"),
    fullPage: true,
  });
});

/*
 * #9666: Enable on an account with nothing set up walks through setting up a
 * second step first, and turns two-factor authentication on only once that
 * step's code was entered - never before.
 */
test("Enable on a new account sets up an authenticator app first, and turns on only after its code, in German", async ({
  page,
}: {
  page: Page;
}) => {
  const language: string = "de";

  await page.goto(address(TWO_FACTOR, { language, state: "new" }));
  await expect(
    page.getByText(dashboardWord(language, "Not enabled"), { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", {
      name: dashboardWord(language, "Enable two-factor authentication"),
    })
    .click();

  // Choose the second step: an authenticator app, or a security key.
  const chooser: Locator = page.getByRole("dialog");
  await expect(
    chooser.getByText(
      dashboardWord(language, "Set up two-factor authentication"),
      { exact: true },
    ),
  ).toBeVisible();
  for (const english of ["Authenticator app", "Security key"]) {
    await expect(
      chooser.getByText(dashboardWord(language, english), { exact: true }),
    ).toBeVisible();
  }
  await expectNoSidewaysScroll(page);
  await page.screenshot({ path: path.join(SHOTS, "enable-choose-de.png") });

  await chooser
    .getByRole("button", { name: dashboardWord(language, "Continue") })
    .click();

  // Set it up: its QR code, and its code to finish.
  const setup: Locator = page.getByRole("dialog");
  const verify: Locator = setup.getByRole("button", {
    name: dashboardWord(language, "Verify and finish"),
  });
  await expect(verify).toBeVisible();
  await expect(
    page.getByTestId("authenticator-setup-key-toggle"),
  ).toBeVisible();
  await page.screenshot({ path: path.join(SHOTS, "enable-set-up-de.png") });

  // Nothing is on yet: the app is saved unfinished, and the account untouched.
  let record: FixtureRecord = await fixture(page);
  expect(record.creates).toEqual([
    {
      table: "UserTotpAuth",
      name: dashboardWord(language, "Authenticator app"),
    },
  ]);
  expect(record.updates).toEqual([]);

  await page.locator("#authenticator-verification-code").fill("123456");
  await verify.click();

  // Its first second step comes with the backup codes; then it is on.
  await expect(page.getByTestId("backup-code")).toHaveCount(10);
  record = await fixture(page);
  expect(record.updates).toEqual([
    { table: "User", data: { enableTwoFactorAuth: true } },
  ]);
  await page.getByTestId("backup-codes-saved-checkbox").check();
  await page
    .getByRole("button", { name: dashboardWord(language, "Done") })
    .click();
  await expect(
    page
      .getByTestId("two-factor-status")
      .getByText(dashboardWord(language, "Enabled"), { exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(SHOTS, "enable-done-de.png"),
    fullPage: true,
  });
});

/*
 * #9666: on with nothing set up - as an administrator's requirement leaves
 * an account - is Setup needed, never Enabled, and Finish setup starts the
 * same setup without turning anything on again.
 */
test("an account required to use two-factor authentication with nothing set up says Setup needed, and Finish setup starts the setup", async ({
  page,
}: {
  page: Page;
}) => {
  const language: string = "en";

  await page.goto(address(TWO_FACTOR, { language, state: "pending" }));
  const status: Locator = page.getByTestId("two-factor-status");
  await expect(status.getByText("Setup needed", { exact: true })).toBeVisible();
  await expect(status.getByText("Enabled", { exact: true })).toHaveCount(0);
  await expect(
    page.getByText(
      "Two-factor authentication is on, but no second step is set up yet, so it does not protect your account. Set one up now, or you will be asked to at your next sign-in.",
      { exact: true },
    ),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Turn off two-factor authentication",
      exact: true,
    }),
  ).toBeVisible();
  await page.screenshot({
    path: path.join(SHOTS, "two-factor-pending-en.png"),
    fullPage: true,
  });

  await page
    .getByTestId("card")
    .filter({ has: status })
    .getByRole("button", { name: "Finish setup", exact: true })
    .click();
  await expect(
    page
      .getByRole("dialog")
      .getByText("Set up two-factor authentication", { exact: true }),
  ).toBeVisible();
  expect((await fixture(page)).updates).toEqual([]);
});

/*
 * #9688: on a server that requires SSO, somebody other than a master admin
 * sets no password, passkey or two-factor authentication in OneUptime. The
 * profile has no Security section, and a Security page says who manages
 * their sign-in instead of offering settings the server would refuse.
 */
for (const route of [TWO_FACTOR, PASSKEYS]) {
  test(`${route} says the organization's SSO manages the sign-in, in Persian, with no Security section`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const language: string = "fa";

    await page.goto(address(route, { language, state: "sso" }));
    const notice: Locator = page.getByTestId("sso-managed-sign-in");
    await expect(notice).toBeVisible();
    await expect(notice).toContainText("Okta");
    await expect(
      cardTitle(page, language, "Single Sign-On").first(),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    // No Security section in the side menu, and none of its settings.
    const sideMenu: Locator = page
      .getByRole("navigation")
      .filter({
        has: page.getByRole("link", {
          name: dashboardWord(language, "Profile Picture"),
        }),
      })
      .first();
    await expect(sideMenu).toBeVisible();
    await expect(
      sideMenu.getByText(dashboardWord(language, "Security"), { exact: true }),
    ).toHaveCount(0);
    for (const english of [
      "Password Management",
      "Passkeys",
      "Two-factor authentication",
    ]) {
      await expect(
        sideMenu.getByRole("link", { name: dashboardWord(language, english) }),
      ).toHaveCount(0);
    }
    for (const english of [
      "Authenticator apps",
      "Security keys",
      "Backup codes",
      "Add Passkey",
    ]) {
      await expect(
        page.getByText(dashboardWord(language, english), { exact: true }),
      ).toHaveCount(0);
    }

    // Nothing of the settings is read: no credentials, no status.
    const record: FixtureRecord = await fixture(page);
    expect(record.lists).not.toContain("UserTotpAuth");
    expect(record.lists).not.toContain("UserWebAuthn");
    expect(
      record.api.filter((request: { url: string }) => {
        return request.url.endsWith("/user/two-factor-auth-status");
      }),
    ).toEqual([]);

    await expectNoSidewaysScroll(page);
    await page.screenshot({
      path: path.join(
        SHOTS,
        `sso-managed-${route === TWO_FACTOR ? "two-factor" : "passkeys"}-fa.png`,
      ),
      fullPage: true,
    });
  });
}

test("regenerating backup codes asks first, in German", async ({
  page,
}: {
  page: Page;
}) => {
  const language: string = "de";

  await page.goto(address(TWO_FACTOR, { language, state: "low" }));
  await expect(
    page.getByText(dashboardWord(language, "Running low"), { exact: true }),
  ).toBeVisible();

  await page
    .getByRole("button", { name: dashboardWord(language, "Regenerate codes") })
    .click();

  const dialog: Locator = page.getByRole("dialog");
  await expect(
    dialog.getByText(dashboardWord(language, "Regenerate backup codes?"), {
      exact: true,
    }),
  ).toBeVisible();
  await expect(
    dialog.getByRole("button", {
      name: dashboardWord(language, "Regenerate"),
    }),
  ).toBeVisible();

  // Nothing is generated before the reader confirms.
  expect(
    (await fixture(page)).api.filter((request: { url: string }) => {
      return request.url.endsWith("/generate");
    }),
  ).toEqual([]);

  await page.screenshot({
    path: path.join(SHOTS, "regenerate-de.png"),
  });
});

test("on a phone, the Arabic page fits its window", async ({
  page,
}: {
  page: Page;
}) => {
  const language: string = "ar";

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(address(TWO_FACTOR, { language }));
  await expect(cardTitle(page, language, "Backup codes")).toBeVisible();

  await expectNoSidewaysScroll(page);
  await page.screenshot({
    path: path.join(SHOTS, "two-factor-ar-phone.png"),
    fullPage: true,
  });
});

/*
 * The fixture loads its locales as the Dashboard does: English in the
 * bundle, and each other language a chunk of its own, loaded only by a page
 * drawn in it (SuiteHelpers/FixtureLocales.js).
 */
describePageLanguages({
  languages: ["de", "ar", "fa"],
  address: (language: string): string => {
    return address(TWO_FACTOR, { language });
  },
});
