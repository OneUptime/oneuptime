import {
  Browser,
  BrowserContext,
  expect,
  Locator,
  Page,
  Route,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * THE GUIDED ON-CALL SETUP, LOOKED AT (#7152): "Page the right person when
 * something breaks" in the real Dashboard, over the journeys' fixture
 * (Journeys/Fixture, Journeys/README.md): a project made a minute ago, kept
 * in memory, with nothing leaving the machine.
 *
 * jsdom (Common/Tests/App/Dashboard/OnCallGuidedSetup.test.tsx) holds what
 * each step does; the journey paged-by-phone-guided counts what the job
 * costs. Neither looks at the page. Here each step and the summary are
 * walked and drawn at 1280 and 390 pixels, light and dark, in German and in
 * Persian (right to left): no step reaches past the window, and each is
 * kept as a picture under output/playwright/on-call-guided-setup-ui. On the
 * way, what this branch added to the steps is used as a person uses it:
 * Get the app's codes and Use this browser in a browser that blocks
 * notifications (#7149), Invite by email and the step left open on someone
 * not reachable yet (#7150), and the summary's order a page reaches each
 * person (#7154). And the two people the first step speaks to differently:
 * a member who may not turn SMS and calls on, and a self-hosted server's
 * master admin with no Twilio.
 */

const PORT: string = process.env["ON_CALL_GUIDED_SETUP_FIXTURE_PORT"] || "4852";
const ORIGIN: string = `http://127.0.0.1:${PORT}`;
const PROJECT: string = "10000000-0000-4000-8000-000000006831";
const SETUP: string = `/dashboard/${PROJECT}/on-call-duty/setup`;
const NOW: Date = new Date("2026-11-11T10:00:00.000Z");
// Where the Dashboard keeps the reader's language (DashboardLanguage.ts).
const LANGUAGE_KEY: string = "oneuptimeLang";
// The code the fixture's server takes (Journeys/Fixture/NewProject.js).
const VERIFICATION_CODE: string = "123456";
const INVITED: string = "cara@acme-commerce.example";
const SHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/on-call-guided-setup-ui",
);
const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

type Language = "en" | "de" | "fa";
type Theme = "light" | "dark";

interface Look {
  lang: Language;
  theme: Theme;
  width: number;
}

const tables: Map<Language, Record<string, string>> = new Map();

// The Dashboard's English words as this language draws them.
function words(lang: Language, english: string): string {
  if (lang === "en") {
    return english;
  }

  let table: Record<string, string> | undefined = tables.get(lang);

  if (!table) {
    table = JSON.parse(
      fs.readFileSync(path.join(LOCALES, `${lang}.json`), "utf8"),
    ) as Record<string, string>;
    tables.set(lang, table);
  }

  return table[english] || english;
}

const pageErrors: Array<string> = [];
const leftTheMachine: Array<string> = [];

test.beforeEach(async ({ page }: { page: Page }) => {
  pageErrors.length = 0;
  leftTheMachine.length = 0;
  page.on("pageerror", (error: Error) => {
    pageErrors.push(error.message);
  });
  await page.route(
    (url: URL) => {
      return url.origin !== ORIGIN;
    },
    async (route: Route) => {
      leftTheMachine.push(route.request().url());
      await route.abort();
    },
  );
  await page.clock.setFixedTime(NOW);
});

test.afterEach(() => {
  expect(pageErrors, "the product threw").toEqual([]);
  expect(leftTheMachine, "a request left this machine").toEqual([]);
});

function nameOf(look: Look): string {
  return `${look.lang}-${look.theme}-${look.width}`;
}

// The setup, in this look, for the fixture's query (who, Cloud, seeds).
async function open(page: Page, look: Look, query: string): Promise<void> {
  await page.setViewportSize({ width: look.width, height: 900 });
  await page.addInitScript(
    ({ key, value }: { key: string; value: string }) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        // A page that cannot keep it draws English, and the checks say so.
      }
    },
    { key: LANGUAGE_KEY, value: look.lang },
  );
  await page.goto(`${ORIGIN}${SETUP}${query}&theme=${look.theme}`);
  await expect(page.getByTestId("guided-setup")).toBeVisible();

  // The look asked for, not one the page fell back to.
  const html: Locator = page.locator("html");

  if (look.theme === "dark") {
    await expect(html).toHaveClass(/(^|\s)dark(\s|$)/);
  } else {
    await expect(html).not.toHaveClass(/(^|\s)dark(\s|$)/);
  }

  await expect(html).toHaveAttribute("dir", look.lang === "fa" ? "rtl" : "ltr");
}

function step(page: Page, key: string): Locator {
  return page.getByTestId(`guided-setup-step-${key}`);
}

/*
 * The page as it is now: nothing reaches past the window, and a picture of
 * the whole page, named for the look and the moment.
 */
async function look(page: Page, look: Look, moment: string): Promise<void> {
  await expectNoSidewaysScroll(page, {
    message: `${nameOf(look)}, ${moment}`,
  });
  fs.mkdirSync(SHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SHOTS, `${nameOf(look)}-${moment}.png`),
    fullPage: true,
  });
}

// A button by its words in this language, inside `within`.
function button(
  within: Page | Locator,
  lang: Language,
  english: string,
): Locator {
  return within.getByRole("button", { name: words(lang, english) });
}

/*
 * THE PANEL OF WHAT THE SETUP MAKES (#10276): each record's status, by its
 * key, as the panel beside the steps draws it - in any language.
 */
async function expectRecords(
  page: Page,
  statuses: Record<string, string>,
): Promise<void> {
  for (const [key, status] of Object.entries(statuses)) {
    await expect(
      page.getByTestId(`guided-setup-resource-${key}`),
      `the panel's ${key}`,
    ).toHaveAttribute("data-status", status);
  }
}

const LOOKS: Array<Look> = [];

for (const lang of ["de", "fa"] as Array<Language>) {
  for (const theme of ["light", "dark"] as Array<Theme>) {
    for (const width of [1280, 390]) {
      LOOKS.push({ lang, theme, width });
    }
  }
}

for (const each of LOOKS) {
  test(`${nameOf(each)}: every step and the summary fit the window`, async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);
    // OneUptime Cloud, SMS and calls on with money in the balance.
    await open(page, each, "?billing=on&seed=phones");

    // 1. How should we reach you?
    await expect(step(page, "reach_you")).toHaveAttribute("data-state", "open");
    await look(page, each, "1-reach");

    // Get the app: a code for each store, inside the step on a phone too.
    await page.getByTestId("on-call-setup-get-the-app").click();
    await expect(page.getByTestId("on-call-setup-app-codes")).toBeVisible();
    await look(page, each, "1-reach-get-the-app");

    /*
     * Use this browser, in a browser that blocks notifications (the
     * test's, which never grants them): asked from the click, and the step
     * says so in its words, not the browser's.
     */
    await page.getByTestId("on-call-setup-use-this-browser").click();
    await expect(
      page.getByTestId("on-call-setup-browser-push-error"),
    ).toBeVisible();
    await look(page, each, "1-reach-browser-blocked");

    // One number, one code.
    await page.getByTestId("on-call-setup-phone").fill("+15550100123");
    await page.getByTestId("on-call-setup-send-code").click();

    const verify: Locator = page.getByRole("dialog");

    await verify.locator("input").first().fill(VERIFICATION_CODE);
    await button(verify, each.lang, "Verify").click();
    await expect(
      page.getByTestId("on-call-setup-reach-phone-value"),
    ).toBeVisible();
    // The number added here, made; the person's methods, in use (#10276).
    await expectRecords(page, {
      notification_methods: "existing",
      phone_number: "created",
      on_call_policy: "waiting",
    });
    await look(page, each, "1-reach-done");
    await page.getByTestId("on-call-setup-reach-continue").click();

    /*
     * Done, step 1 lists how a page reaches you, joined with the reader's
     * comma: Persian's, not a Latin one between Persian words.
     */
    await expect(step(page, "reach_you")).toHaveAttribute("data-state", "done");
    if (each.lang === "fa") {
      await expect(step(page, "reach_you")).toContainText("، ");
      await expect(step(page, "reach_you")).not.toContainText(", ");
    }

    // 2. Who is paged first? (#7372)
    await expect(step(page, "who_else")).toHaveAttribute("data-state", "open");
    await expect(step(page, "who_else")).toContainText(
      words(each.lang, "Who is paged first?"),
    );
    await look(page, each, "2-who");

    // Someone not in the project yet, invited from the step (#7150).
    await page.getByTestId("on-call-setup-invite-open").click();
    await page.getByTestId("on-call-setup-invite-email").fill(INVITED);
    await look(page, each, "2-who-invite");
    await page.getByTestId("on-call-setup-invite-send").click();
    await expect(page.getByTestId("on-call-setup-invited")).toContainText(
      INVITED,
    );
    await page.getByTestId("on-call-setup-who-save").click();

    // Not reachable until they accept: the step stays open, with a reminder.
    const reminders: Locator = page.locator(
      '[data-testid^="on-call-setup-send-reminder-"]',
    );

    await expect(reminders).toHaveCount(1);
    // The policy, its first escalation rule and its rules: made together.
    await expectRecords(page, {
      on_call_policy: "created",
      escalation_rule: "created",
      on_call_rules: "created",
    });
    await look(page, each, "2-who-not-reachable-yet");
    await page.getByTestId("on-call-setup-who-continue").click();

    // 3. What if nobody answers? Grace, after the wait.
    await expect(step(page, "no_answer")).toHaveAttribute("data-state", "open");
    await button(
      page.getByTestId("on-call-setup-next-people"),
      each.lang,
      "Add teammates",
    ).click();
    await page.getByRole("option", { name: /Grace Hopper/ }).click();
    await page.keyboard.press("Escape");
    await look(page, each, "3-no-answer");
    await page
      .getByTestId("on-call-setup-no-answer-save")
      .filter({ visible: true })
      .first()
      .click();

    // 4. Send a test page: acknowledged from the email at once.
    await expect(step(page, "test")).toHaveAttribute("data-state", "open");
    // Grace, after the wait: the second escalation rule, made.
    await expectRecords(page, { no_answer: "created", test_page: "waiting" });
    await look(page, each, "4-test");
    await button(step(page, "test"), each.lang, "Test this policy").click();
    await button(page.getByRole("dialog"), each.lang, "Send test page").click();
    await expect(page.getByTestId("on-call-setup-test-continue")).toBeVisible();
    await expectRecords(page, { test_page: "created" });
    await look(page, each, "4-test-acknowledged");
    await page.getByTestId("on-call-setup-test-continue").click();

    // The summary, with the order a page reaches each person (#7154).
    const summary: Locator = page.getByTestId("guided-setup-summary");

    await expect(summary).toBeVisible();
    await expect(summary).toContainText(
      words(each.lang, "{{methods}} at once").replace("{{methods}}", "").trim(),
    );
    await look(page, each, "5-summary");
  });
}

/*
 * A member may not turn SMS and calls on: the step says who can, and has
 * no button for it.
 */
for (const width of [1280, 390]) {
  test(`a member who may not turn SMS and calls on, ${width}px: told who can, in German`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const each: Look = { lang: "de", theme: "light", width };

    await open(page, each, "?billing=on&as=member");
    await expect(step(page, "reach_you")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("on-call-setup-turn-on-phone")).toHaveCount(
      0,
    );
    await expect(
      page.locator('[data-testid^="on-call-setup-break-ChannelOff-"]').first(),
    ).toBeVisible();
    await look(page, each, "member-reach");
  });
}

/*
 * A self-hosted server with no Twilio: its master admin is told so, with
 * the way to the Admin Dashboard's setup.
 */
for (const width of [1280, 390]) {
  test(`a self-hosted master admin without Twilio, ${width}px: Set up SMS and calls, in Persian`, async ({
    page,
  }: {
    page: Page;
  }) => {
    const each: Look = { lang: "fa", theme: "dark", width };

    await open(page, each, "?as=admin");
    await expect(step(page, "reach_you")).toHaveAttribute("data-state", "open");
    await expect(page.getByTestId("on-call-setup-no-twilio")).toBeVisible();
    await expect(page.getByTestId("on-call-setup-set-up-twilio")).toHaveText(
      words("fa", "Set up SMS and calls"),
    );
    await look(page, each, "admin-without-twilio-reach");
  });
}

/*
 * ANOTHER DEVICE PICKS THE RUN UP (#7253): a laptop adds a number and makes
 * the policy; a phone - a browser of its own, nothing kept in it - opens the
 * setup at the step the laptop left, with the same panel of what it made.
 * The two share one world of the fixture's server (?world=).
 */
for (const [laptop, phone] of [
  [
    { lang: "de", theme: "light", width: 1280 },
    { lang: "de", theme: "dark", width: 390 },
  ],
  [
    { lang: "fa", theme: "dark", width: 1280 },
    { lang: "fa", theme: "light", width: 390 },
  ],
] as Array<[Look, Look]>) {
  test(`another device picks the run up: ${nameOf(laptop)} then ${nameOf(phone)}`, async ({
    page,
    browser,
  }: {
    page: Page;
    browser: Browser;
  }) => {
    test.setTimeout(240000);
    const world: string = `oc-${laptop.lang}-${Date.now()}`;

    await open(page, laptop, `?billing=on&seed=phones&world=${world}`);
    await page.getByTestId("on-call-setup-reach-continue").click();
    await expect(step(page, "who_else")).toHaveAttribute("data-state", "open");
    await page.getByTestId("on-call-setup-who-save").click();
    await expectRecords(page, { on_call_policy: "created" });
    await expect(page.getByTestId("guided-setup-sync")).toHaveAttribute(
      "data-sync",
      "saved",
    );

    const context: BrowserContext = await browser.newContext();
    const second: Page = await context.newPage();

    second.on("pageerror", (error: Error) => {
      pageErrors.push(error.message);
    });
    await second.route(
      (url: URL) => {
        return url.origin !== ORIGIN;
      },
      async (route: Route) => {
        leftTheMachine.push(route.request().url());
        await route.abort();
      },
    );
    await second.clock.setFixedTime(NOW);

    try {
      await open(second, phone, `?billing=on&seed=phones&world=${world}`);

      await expect(step(second, "reach_you")).toHaveAttribute(
        "data-state",
        "done",
      );
      await expect(step(second, "who_else")).not.toHaveAttribute(
        "data-state",
        "upcoming",
      );
      await expectRecords(second, {
        on_call_policy: "created",
        escalation_rule: "created",
        on_call_rules: "created",
      });
      await look(second, phone, "another-device-picks-it-up");

      // One policy in the world: nothing made twice.
      const writes: Array<{ kind: string; table: string }> =
        await second.evaluate(() => {
          return (
            window as unknown as {
              __journeyFixture: {
                writes: Array<{ kind: string; table: string }>;
              };
            }
          ).__journeyFixture.writes;
        });

      expect(
        writes.filter((write: { kind: string; table: string }) => {
          return write.table === "OnCallDutyPolicy" && write.kind === "create";
        }),
      ).toHaveLength(1);
    } finally {
      await context.close();
    }
  });
}
