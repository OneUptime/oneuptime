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
