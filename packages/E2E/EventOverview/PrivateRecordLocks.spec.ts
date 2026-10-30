import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * A PRIVATE INCIDENT OWNED BY A VIEW-ONLY TEAM (block 33), on the real
 * incident overview page against the offline fixture (Fixture/Fixture.js).
 *
 * The maintainer, as Test User 2 - a member of Team 1 and Team 2 - could
 * change private incident INC-17, owned by Team 2 alone, whose permissions
 * are Viewer: the page offered Acknowledge, Resolve and every Edit, and the
 * server took them through Team 1's permission. A private incident is
 * changed only with the permissions of the teams that own it and of the
 * people named as its owners. Here Maya Chen is on Incident Response, which
 * may change every incident (Project Member), and on Checkout SRE, which
 * owns incident #1042 and may only view it (?role=view-only-owner); with
 * ?private=1 the incident is private, and its page locks each change of it
 * and its parts, saying why, while reading it as before - at 1280 and 390,
 * light and dark, in German and in Persian. The jsdom suites
 * (PrivateRecordLocks, PermissionGatePrivateRecord) cover the rule's every
 * branch; this one shows it laid out on the page.
 */

// The fixture server's port: EVENT_OVERVIEW_FIXTURE_PORT, as the config and server.js read it.
const PORT: string = process.env["EVENT_OVERVIEW_FIXTURE_PORT"] || "4222";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-14T18:20:00.000Z");

function uuid(prefix: string, suffix: number): string {
  return `${prefix}-0000-4000-8000-${String(suffix).padStart(12, "0")}`;
}

const INCIDENT_ID: string = uuid("20000000", 1042);
const INCIDENT_PATH: string = `/dashboard/${PROJECT_ID}/incidents/${INCIDENT_ID}`;
const INCIDENT_TITLE: string = "Checkout API p95 latency above 2s";

// The maintainer's case, with the incident not acknowledged yet.
const MAINTAINERS_CASE: string = "private=1&role=view-only-owner&state=created";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/event-overview-ui",
);

const LOCALES: string = path.resolve(
  __dirname,
  "../../App/FeatureSet/Dashboard/src/Locales",
);

const INTER_FONT_FILE: string = path.resolve(
  __dirname,
  "../../Common/Server/Static/Vendor/fonts/InterVariable.woff2",
);

const PRODUCTION_FONT_CSS: string =
  '@font-face{font-family:Inter;font-style:normal;font-weight:100 900;font-display:swap;src:url(/dashboard/assets/fonts/InterVariable.woff2) format("woff2")} *{font-family:Inter,ui-sans-serif,system-ui,sans-serif}';

// Why a change is locked on a private incident, as the Dashboard keys it.
const WHY_KEY: string =
  "This incident is private, so it is changed only with the permissions of the teams that own it, and {{team}}, your team that owns it, may not do this.";
const STATE_SENTENCE_KEY: string =
  "You do not have permission to change this incident's state.";
const OWNING_TEAM: string = "Checkout SRE";

// The dark theme's class on the page's root element.
const DARK_THEME_CLASS: RegExp = /(^|\s)dark(\s|$)/;

type Language = "en" | "de" | "fa";

function words(language: Language): Record<string, string> {
  if (language === "en") {
    return {};
  }

  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

// What follows a lock's first sentence on the private incident, in a language.
function why(language: Language): string {
  return (words(language)[WHY_KEY] || WHY_KEY).replace("{{team}}", OWNING_TEAM);
}

// A state button's whole tooltip, in a language.
function stateReason(language: Language): string {
  return `${words(language)[STATE_SENTENCE_KEY] || STATE_SENTENCE_KEY} ${why(language)}`;
}

interface UnhandledRequest {
  kind: string;
  modelName?: string;
}

interface RecordedWrite {
  modelName: string;
}

interface FixtureState {
  unhandled: Array<UnhandledRequest>;
  creates: Array<RecordedWrite>;
  updates: Array<RecordedWrite>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
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
    await route.abort();
  });

  await page.clock.setFixedTime(NOW);
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    (await fixture(page)).unhandled,
    "requests the fixture does not model",
  ).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __eventOverviewFixture: FixtureState })
          .__eventOverviewFixture,
      ),
    ) as FixtureState;
  });
}

function hero(page: Page): Locator {
  return page.getByTestId("event-header");
}

function heroActions(page: Page): Locator {
  return page.getByRole("group", { name: "Event actions" });
}

function card(page: Page, heading: string): Locator {
  return page.getByTestId("card").filter({
    has: page.getByRole("heading", { level: 2, name: heading, exact: true }),
  });
}

function whatHappenedEdit(page: Page): Locator {
  return card(page, "What happened")
    .getByTestId("card-header-actions")
    .getByRole("button", { name: "Edit" });
}

// Opens the incident and waits for its header, What happened and its owners.
async function openIncident(page: Page, query: string): Promise<void> {
  await page.goto(`${INCIDENT_PATH}?${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });
  await expect(hero(page).getByTestId("event-owners")).toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByTestId("what-happened")).toBeVisible({
    timeout: 30000,
  });
  await expect(
    page.getByTestId("what-happened").getByRole("status"),
  ).toHaveCount(0, { timeout: 30000 });
}

async function loadProductionFont(page: Page): Promise<void> {
  await page.route(
    "**/dashboard/assets/fonts/InterVariable.woff2",
    async (route: PlaywrightRoute) => {
      await route.fulfill({ path: INTER_FONT_FILE });
    },
  );
  await page.addStyleTag({ content: PRODUCTION_FONT_CSS });
  expect(
    await page.evaluate(async (): Promise<number> => {
      return (await document.fonts.load("600 14px Inter")).length;
    }),
    "Inter loaded",
  ).toBeGreaterThan(0);
}

// The tooltip a hover of `target` opens, and then closes again.
async function tooltipOf(page: Page, target: Locator): Promise<string> {
  await target.hover();
  const tooltip: Locator = page.getByRole("tooltip").last();
  await expect(tooltip).toBeVisible();
  const text: string = ((await tooltip.textContent()) || "").trim();
  await page.mouse.move(0, 0);
  await expect(page.getByRole("tooltip")).toHaveCount(0);
  return text;
}

async function expectNoHorizontalOverflow(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
  expect(overflow, "page scrolls sideways").toBeLessThanOrEqual(1);
}

async function screenshot(locator: Locator, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await locator.scrollIntoViewIfNeeded();
  await locator.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    animations: "disabled",
  });
}

// The viewport with Acknowledge's tooltip open: the lock and why, as read.
async function screenshotWithTooltip(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await hero(page).scrollIntoViewIfNeeded();
  await hero(page)
    .getByTestId("incident-acknowledge-btn-disabled-wrapper")
    .hover();
  await expect(page.getByRole("tooltip").last()).toBeVisible();
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-tooltip-synthetic.png`),
    animations: "disabled",
  });
  await page.mouse.move(0, 0);
}

// Every state button is locked with `reason`, and pressing it opens nothing.
async function expectStateButtonsLocked(
  page: Page,
  reason: string,
): Promise<void> {
  await expect(
    hero(page).locator("#incident-acknowledge-btn, #incident-resolve-btn"),
  ).toHaveCount(2);

  for (const id of ["incident-acknowledge-btn", "incident-resolve-btn"]) {
    const button: Locator = hero(page).locator(`#${id}`);
    const wrapper: Locator = hero(page).getByTestId(`${id}-disabled-wrapper`);

    await expect(button).toBeDisabled();
    await expect(wrapper).toHaveAttribute("tabindex", "0");
    expect(await tooltipOf(page, wrapper)).toBe(reason);
    await wrapper.click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    // Clicked, the wrapper keeps the focus, and its tooltip with it.
    await page.evaluate((): void => {
      (document.activeElement as HTMLElement | null)?.blur();
    });
    await page.mouse.move(0, 0);
    await expect(page.getByRole("tooltip")).toHaveCount(0);
  }

  // No menu of other states to move it to either.
  await expect(hero(page).getByTestId("event-header-more-place")).toHaveCount(
    0,
  );
}

test.describe("a private incident a view-only team of the reader's owns (?private=1&role=view-only-owner)", () => {
  test.use({ viewport: { width: 1280, height: 900 } });

  test("Acknowledge and Resolve are locked, each saying why, and nothing is written", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, MAINTAINERS_CASE);
    await loadProductionFont(page);

    await expect(heroActions(page).getByRole("button")).toHaveText([
      "Acknowledge",
      "Resolve",
    ]);
    await expectStateButtonsLocked(page, stateReason("en"));

    const state: FixtureState = await fixture(page);
    expect(state.creates).toEqual([]);
    expect(state.updates).toEqual([]);

    await screenshot(hero(page), "private-incident-locked-header-1280");
    await screenshotWithTooltip(page, "private-incident-locked-header-1280");
  });

  test("What happened is read as before, and its Edit is locked, saying why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, MAINTAINERS_CASE);

    // Read: Checkout SRE owns it, and may view it.
    await expect(page.getByRole("heading", { level: 1 })).toContainText(
      INCIDENT_TITLE,
    );
    await expect(
      page
        .getByTestId("what-happened")
        .getByTestId("what-happened-description"),
    ).toBeVisible();

    const edit: Locator = whatHappenedEdit(page);
    await expect(edit).toBeDisabled();
    expect(await tooltipOf(page, edit.locator(".."))).toContain(why("en"));

    await screenshot(
      card(page, "What happened"),
      "private-incident-locked-what-happened-1280",
    );
  });

  test("no note goes on it: a private note takes a team that owns it, a public note no private incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, MAINTAINERS_CASE);

    await card(page, "Incident Feed")
      .getByTestId("feed-actions-button")
      .click();
    for (const action of ["Add Public Note", "Add Private Note"]) {
      await expect(
        page.getByRole("menuitem", { name: action, exact: true }),
      ).toHaveAttribute("aria-disabled", "true");
    }
  });

  test("its owners are read, and nobody is offered as one to add", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, MAINTAINERS_CASE);

    const owners: Locator = hero(page).getByTestId("event-owners");
    await expect(owners.getByTestId("event-person-name")).toHaveText([
      OWNING_TEAM,
      "Sam Rivera",
    ]);
    await expect(owners.getByRole("button")).toHaveCount(0);
  });

  test("once Checkout SRE may change incidents, everything is offered again (?role=editor-owner)", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, "private=1&role=editor-owner&state=created");

    for (const id of ["incident-acknowledge-btn", "incident-resolve-btn"]) {
      await expect(hero(page).locator(`#${id}`)).toBeEnabled();
      await expect(
        hero(page).getByTestId(`${id}-disabled-wrapper`),
      ).toHaveCount(0);
    }
    await expect(whatHappenedEdit(page)).toBeEnabled();
  });

  test("a public incident Checkout SRE owns is changed through Incident Response, as before", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openIncident(page, "role=view-only-owner&state=created");

    for (const id of ["incident-acknowledge-btn", "incident-resolve-btn"]) {
      await expect(hero(page).locator(`#${id}`)).toBeEnabled();
    }
    await expect(whatHappenedEdit(page)).toBeEnabled();
  });
});

/*
 * The lock says why in the reader's language and fits a phone, in either
 * theme and either reading direction.
 */
const LOOKS: ReadonlyArray<{
  language: Language;
  width: number;
  theme: "light" | "dark";
}> = [
  { language: "de", width: 1280, theme: "light" },
  { language: "fa", width: 1280, theme: "dark" },
  { language: "en", width: 390, theme: "dark" },
  { language: "de", width: 390, theme: "light" },
  { language: "fa", width: 390, theme: "light" },
];

for (const look of LOOKS) {
  test.describe(`at ${look.width}px, ${look.theme}, in ${look.language}`, () => {
    test.use({ viewport: { width: look.width, height: 900 } });

    test("the state buttons are locked, saying why in the reader's words", async ({
      page,
    }: {
      page: Page;
    }) => {
      await openIncident(
        page,
        // dir=auto: <html lang> and its reading direction, as the Dashboard writes them.
        `${MAINTAINERS_CASE}${look.language === "en" ? "" : `&lang=${look.language}&dir=auto`}${look.theme === "dark" ? "&theme=dark" : ""}`,
      );
      await loadProductionFont(page);

      if (look.language === "fa") {
        await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
      }
      if (look.theme === "dark") {
        await expect(page.locator("html")).toHaveClass(DARK_THEME_CLASS);
      }

      // Persian's reason is Persian, not the English key read back.
      expect(why(look.language)).not.toBe(
        look.language === "en" ? "" : why("en"),
      );
      await expectStateButtonsLocked(page, stateReason(look.language));
      await expectNoHorizontalOverflow(page);

      const name: string = `private-incident-locked-header-${look.width}-${look.theme}-${look.language}`;
      await screenshot(hero(page), name);
      await screenshotWithTooltip(page, name);
    });
  });
}
