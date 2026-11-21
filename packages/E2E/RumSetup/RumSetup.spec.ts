import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs";
import path from "path";
import {
  listDropdownOptions,
  shownDropdownValue,
} from "../SuiteHelpers/Dropdowns";
import { dashboardWord } from "../SuiteHelpers/LocaleChunks";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A RUM APPLICATION'S SETUP, IN A REAL BROWSER (issues #6379, #6457, #6458).
 *
 * The component suites (jsdom) read each piece's words and states. This
 * drives them on the pages they are drawn on, where layout, reading
 * direction and time are real: an application that sends page loads and
 * nothing else says, on its Overview, that exceptions, logs and Web Vitals
 * aren't set up; Set up logs and Set up exceptions wait for the first one
 * and say when it arrives - or, after three minutes, what to check, and
 * after fifteen they stop - and say so when what was sent is refused; the
 * Setup check says a refusal shared by its rows once, above them, with its
 * fix (Pick another key, or the key's page); the guide's key picker keeps a
 * refused key's "(turned off)" whole at 390px, left to right and right to
 * left; a mobile app is handed a Mobile key pinned to it; and the guide
 * reads in German and in Persian, right to left, with no English sentence
 * left over.
 *
 * Fixture/Fixture.js answers the reads (its comment lists the query
 * string), and a test moves the page's clock past the dialogs' looks. The
 * desktop project runs at 1280 pixels, the phone one at 390 with a touch
 * screen. Screenshots of each surface, in English and Persian, light and
 * dark, are written to output/playwright/rum-setup-ui.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000006379";
const APP_ID: string = "20000000-0000-4000-8000-000000006379";
// The turned-off key every refusal is of (Fixture.js's REFUSED_KEY).
const REFUSED_KEY_ID: string = "30000000-0000-4000-8000-000000000002";
const REFUSED_KEY_NAME: string =
  "Old storefront web key from the spring release";
const REFUSED_MOBILE_KEY_NAME: string =
  "Old storefront app key from the spring release";
const PORT: string = process.env["RUM_SETUP_FIXTURE_PORT"] || "4379";

// RUM_SIGNAL_ARRIVAL_POLL_MS, _HINT_AFTER_MS and _STOP_AFTER_MS.
const LOOK_EVERY_MS: number = 10_000;
const HINT_AFTER_MS: number = 3 * 60_000;
const STOP_AFTER_MS: number = 15 * 60_000;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/rum-setup-ui",
);

// The marks a value set apart in a sentence is wrapped in (LRI ... PDI).
const ISOLATES: RegExp = /[⁦-⁩]/g;

interface FixtureRecord {
  looks: number;
  sessionLists: Array<Record<string, unknown>>;
  createdKeys: Array<Record<string, unknown>>;
  unexpected: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const leftTheFixture: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const aborted: Array<string> = [];
  pageErrors.set(page, errors);
  leftTheFixture.set(page, aborted);
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

  // The dialogs' looks run on a clock the test moves on.
  await page.clock.install();
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || [], "uncaught page errors").toEqual([]);
  expect(
    leftTheFixture.get(page) || [],
    "requests that left the fixture server",
  ).toEqual([]);

  const hasFixture: boolean = await page
    .evaluate((): boolean => {
      return Boolean(
        (window as unknown as { __rumSetupFixture?: unknown })
          .__rumSetupFixture,
      );
    })
    .catch((): boolean => {
      return false;
    });

  if (hasFixture) {
    expect(
      (await fixtureRecord(page)).unexpected,
      "reads the fixture does not model",
    ).toEqual([]);
  }
});

/*
 * ---------------------------------------------------------------------------
 * Helpers
 * ---------------------------------------------------------------------------
 */

type RumPage = "" | "logs" | "documentation";

function address(rumPage: RumPage, query: string = ""): string {
  return `/dashboard/${PROJECT_ID}/rum/${APP_ID}${rumPage ? `/${rumPage}` : ""}${
    query ? `?${query}` : ""
  }`;
}

async function open(
  page: Page,
  rumPage: RumPage,
  query: string = "",
): Promise<void> {
  await page.goto(address(rumPage, query));
  // The first load parses a large bundle; the page draws once its words load.
  await expect(page.locator("#root > *").first()).toBeVisible({
    timeout: 60000,
  });
}

async function fixtureRecord(page: Page): Promise<FixtureRecord> {
  return page.evaluate((): FixtureRecord => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __rumSetupFixture: unknown }).__rumSetupFixture,
      ),
    ) as FixtureRecord;
  });
}

// The first log or exception arrives, as ingest stamps it.
async function arrive(
  page: Page,
  signal: "logs" | "exceptions",
): Promise<void> {
  await page.evaluate((kind: string): void => {
    (
      window as unknown as {
        __rumSetupFixture: { arrive: (value: string) => void };
      }
    ).__rumSetupFixture.arrive(kind);
  }, signal);
}

function isPhone(): boolean {
  return Boolean(test.info().project.use.isMobile);
}

/*
 * A press as the reader makes it: a click at 1280, and on the phone the
 * click a tap ends in, after scrolling the control into view.
 */
async function press(control: Locator): Promise<void> {
  if (!isPhone()) {
    await control.click();
    return;
  }

  await control.scrollIntoViewIfNeeded();
  await expect(control).toBeVisible();
  await expect(control).toBeEnabled();
  await control.dispatchEvent("click");
}

// The Dashboard's words for `english` in `language`, its {{values}} filled in.
function words(
  language: string,
  english: string,
  values: Record<string, string> = {},
): string {
  let text: string = dashboardWord(language, english);

  for (const [name, value] of Object.entries(values)) {
    text = text.split(`{{${name}}}`).join(value);
  }

  return text;
}

// What an element reads, without the marks that set its values apart.
async function readText(locator: Locator): Promise<string> {
  return (await locator.innerText()).replace(ISOLATES, "").trim();
}

/*
 * The page as the reader sees it, written for the pull request's review;
 * `shown`, when given, scrolled into view first (a dialog's last step).
 */
async function screenshot(
  page: Page,
  name: string,
  shown?: Locator,
): Promise<void> {
  if (shown) {
    await shown.scrollIntoViewIfNeeded();
  }

  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-${test.info().project.name}.png`),
    fullPage: true,
  });
}

function dialog(page: Page, title: string): Locator {
  return page.getByRole("dialog", { name: title });
}

async function expectRightToLeft(page: Page, language: string): Promise<void> {
  await expect(page.locator("html")).toHaveAttribute("lang", language);
  await expect(page.locator("html")).toHaveAttribute(
    "dir",
    language === "fa" ? "rtl" : "ltr",
  );
}

/*
 * ---------------------------------------------------------------------------
 * The Overview of an application that sends page loads and nothing else
 * ---------------------------------------------------------------------------
 */

test.describe("the Overview says why each empty chart is empty", () => {
  for (const language of ["en", "fa"]) {
    test(`Exceptions, Logs and Web Vitals aren't set up, each with its way to set it up (${language})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "", language === "en" ? "" : `lang=${language}`);
      await expectRightToLeft(page, language);

      const exceptions: Locator = page.getByTestId("rum-exceptions-empty");
      const logs: Locator = page.getByTestId("rum-logs-empty");
      const vitals: Locator = page.getByTestId("web-vitals-empty-state");

      await expect(
        exceptions.getByTestId("rum-exceptions-empty-title"),
      ).toHaveText(words(language, "Exceptions aren't set up"));
      await expect(logs.getByTestId("rum-logs-empty-title")).toHaveText(
        words(language, "Logs aren't set up"),
      );
      await expect(
        exceptions.getByTestId("rum-exceptions-empty-action"),
      ).toHaveText(words(language, "Set up exceptions"));
      await expect(logs.getByTestId("rum-logs-empty-action")).toHaveText(
        words(language, "Set up logs"),
      );

      // The Web Vitals card says the same, from the same diagnosis (#6379).
      await expect(vitals).toContainText(
        words(language, "Web Vitals aren't set up"),
      );
      await expect(
        vitals.getByRole("link", {
          name: words(language, "Set up Web Vitals"),
        }),
      ).toHaveAttribute("href", "/docs/rum/web-vitals");
      await expect(vitals).not.toContainText("No web vitals reported yet");

      // No evidence line: Session Replay recorded nothing.
      await expect(
        exceptions.getByTestId("rum-exceptions-empty-evidence"),
      ).toHaveCount(0);

      await expectNoSidewaysScroll(page);
      await screenshot(page, `overview-${language}`);
    });
  }

  test("counts every recorded session with an error, through Session Replay's errors filter", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * The newest page of recordings holds no session with an error; three
     * further back do. Counted among the newest page, as it was until
     * #6379, the chart said nothing of them.
     */
    await open(page, "", "sessions=errors");

    const evidence: Locator = page.getByTestId("rum-exceptions-empty-evidence");

    await expect(evidence).toHaveText(
      "Session Replay recorded 3 sessions with errors in this time range, so errors do happen.",
    );

    const lists: Array<Record<string, unknown>> = (await fixtureRecord(page))
      .sessionLists;

    expect(
      lists.some((filters: Record<string, unknown>): boolean => {
        return filters["hasError"] === true;
      }),
      "a list read with the errors filter",
    ).toBe(true);

    // A full page of them, and more: "or more", not a number it did not count.
    await open(page, "", "sessions=many-errors");
    await expect(page.getByTestId("rum-exceptions-empty-evidence")).toHaveText(
      "Session Replay recorded 50 or more sessions with errors in this time range, so errors do happen.",
    );
  });

  test("draws in the dark theme", async ({ page }: { page: Page }) => {
    await open(page, "", "theme=dark");

    await expect(page.getByTestId("rum-logs-empty-title")).toBeVisible();
    await expect(page.getByTestId("web-vitals-empty-state")).toBeVisible();

    // The empty card is the dark theme's, not a white box on a dark page.
    const background: string = await page
      .getByTestId("web-vitals-empty-state")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });

    expect(background, "the empty Web Vitals card's background").not.toBe(
      "rgb(249, 250, 251)",
    );

    await screenshot(page, "overview-dark");

    // The dialog's live step, in the dark theme's own tints.
    await press(page.getByTestId("rum-logs-empty-action"));

    const waiting: Locator = dialog(page, "Set up logs").getByTestId(
      "rum-signal-arrival-waiting",
    );

    await expect(waiting).toBeVisible();
    await screenshot(page, "set-up-logs-dark", waiting);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Set up logs and Set up exceptions: the live last step
 * ---------------------------------------------------------------------------
 */

test.describe("Set up logs and Set up exceptions wait for the first data", () => {
  test("Set up logs, from the empty Logs page, waits for the first log and says when it arrived", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "logs");

    await press(page.getByTestId("rum-logs-empty-action"));

    const setUp: Locator = dialog(page, "Set up logs");

    await expect(setUp).toBeVisible();
    await expect(setUp.getByText("Wait for the first log")).toBeVisible();

    const waiting: Locator = setUp.getByTestId("rum-signal-arrival-waiting");

    await expect(waiting).toBeVisible();
    expect(await readText(waiting)).toBe(
      "Waiting for the first log from storefront-web…",
    );
    // The snippet carries the Browser key the dialog's first step picked.
    await expect(
      setUp.locator("pre").filter({ hasText: "x-oneuptime-token" }),
    ).toContainText("8f14e45f-ceea-4e7a-9a1b-6c0d3e2f1a01");

    // Nothing yet: the next look, ten seconds on, still waits.
    await page.clock.runFor(LOOK_EVERY_MS + 1);
    await expect
      .poll(async () => {
        return (await fixtureRecord(page)).looks;
      })
      .toBeGreaterThan(1);
    await expect(waiting).toBeVisible();

    await screenshot(page, "set-up-logs-waiting", waiting);

    // The first log arrives: the next look says so.
    await arrive(page, "logs");
    await page.clock.runFor(LOOK_EVERY_MS + 1);

    const arrived: Locator = setUp.getByTestId("rum-signal-arrival-arrived");

    await expect(arrived).toBeVisible();
    expect(await readText(arrived)).toMatch(
      /^Logs are arriving from storefront-web\. The latest arrived .+\.$/,
    );

    await screenshot(page, "set-up-logs-arrived", arrived);

    // Closed, it looks no more.
    await press(setUp.getByRole("button", { name: "Done" }));
    await expect(setUp).toHaveCount(0);

    const looksWhenClosed: number = (await fixtureRecord(page)).looks;

    await page.clock.runFor(3 * LOOK_EVERY_MS);
    expect((await fixtureRecord(page)).looks).toBe(looksWhenClosed);
  });

  test("Set up exceptions, from the Overview, says what to check after three minutes, stops after fifteen, and Check again starts over", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "");

    await press(page.getByTestId("rum-exceptions-empty-action"));

    const setUp: Locator = dialog(page, "Set up exceptions");

    await expect(setUp.getByTestId("rum-signal-arrival-waiting")).toHaveText(
      /Waiting for the first exception from .*storefront-web.*…/,
    );

    await page.clock.fastForward(HINT_AFTER_MS);

    const nothingYet: Locator = setUp.getByTestId(
      "rum-signal-arrival-nothing-yet",
    );

    await expect(nothingYet).toBeVisible();
    await expect(nothingYet).toContainText(
      "Nothing has arrived yet. Check that the change is deployed and that a page threw an error since",
    );
    await expect(
      nothingYet.getByRole("link", { name: "Why nothing arrives" }),
    ).toHaveAttribute("href", /\/docs\/rum\/troubleshooting/);

    await screenshot(page, "set-up-exceptions-nothing-yet", nothingYet);

    await page.clock.fastForward(STOP_AFTER_MS - HINT_AFTER_MS);

    const stopped: Locator = setUp.getByTestId("rum-signal-arrival-stopped");

    await expect(stopped).toBeVisible();
    await expect(stopped).toContainText(
      "Nothing has arrived, so this step stopped checking.",
    );

    // Stopped means no more looks.
    const looksWhenStopped: number = (await fixtureRecord(page)).looks;

    await page.clock.runFor(3 * LOOK_EVERY_MS);
    expect((await fixtureRecord(page)).looks).toBe(looksWhenStopped);

    // Check again: waiting again, and the exception that came is seen.
    await press(stopped.getByTestId("rum-signal-arrival-check-again"));
    await expect(setUp.getByTestId("rum-signal-arrival-waiting")).toBeVisible();

    await arrive(page, "exceptions");
    await page.clock.runFor(LOOK_EVERY_MS + 1);
    await expect(setUp.getByTestId("rum-signal-arrival-arrived")).toContainText(
      "Exceptions are arriving from",
    );
  });

  test("says what is refused, and where to pick another key, when the app is deployed with a turned-off key", async ({
    page,
  }: {
    page: Page;
  }) => {
    // Opened from the Setup check's Logs row this time.
    await open(page, "documentation");
    await press(page.getByTestId("rum-setup-check-logs-action"));

    const setUp: Locator = dialog(page, "Set up logs");

    await expect(setUp.getByTestId("rum-signal-arrival-waiting")).toBeVisible();

    // Deployed with the turned-off key: what it sends is refused from now on.
    await page.evaluate((): void => {
      (
        window as unknown as {
          __rumSetupFixture: { refuse: (reason: string) => void };
        }
      ).__rumSetupFixture.refuse("off");
    });

    // Refusals are read again every third look.
    for (let look: number = 0; look < 3; look++) {
      await page.clock.runFor(LOOK_EVERY_MS + 1);
    }

    const refusedStep: Locator = setUp.getByTestId(
      "rum-signal-arrival-refused",
    );

    await expect(refusedStep).toBeVisible();
    expect(
      await readText(refusedStep.getByTestId("rum-signal-arrival-refusal")),
    ).toBe(
      `The key "${REFUSED_KEY_NAME}" is turned off, so everything sent with it is refused.`,
    );
    await expect(refusedStep).toContainText(
      "Pick another key in step 1, and deploy with it.",
    );
    // Step 1 of this dialog is where: no link away from it.
    await expect(refusedStep.getByTestId("rum-signal-arrival-fix")).toHaveCount(
      0,
    );

    await screenshot(page, "set-up-logs-refused", refusedStep);
  });

  test("in Persian, the dialog and its last step read right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "logs", "lang=fa");
    await expectRightToLeft(page, "fa");

    await press(page.getByTestId("rum-logs-empty-action"));

    const setUp: Locator = dialog(page, words("fa", "Set up logs"));

    await expect(setUp).toBeVisible();
    await expect(
      setUp.getByText(words("fa", "Wait for the first log")),
    ).toBeVisible();

    const waiting: Locator = setUp.getByTestId("rum-signal-arrival-waiting");

    await expect(waiting).toBeVisible();
    expect(await readText(waiting)).toBe(
      words("fa", "Waiting for the first log from {{application}}…", {
        application: "storefront-web",
      }),
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "set-up-logs-fa", waiting);

    await arrive(page, "logs");
    await page.clock.runFor(LOOK_EVERY_MS + 1);
    const arrived: Locator = setUp.getByTestId("rum-signal-arrival-arrived");

    await expect(arrived).toBeVisible();
    await screenshot(page, "set-up-logs-arrived-fa", arrived);
  });
});

/*
 * ---------------------------------------------------------------------------
 * The Setup check's refusal notice, and Pick another key
 * ---------------------------------------------------------------------------
 */

test.describe("the Setup check says a shared refusal once", () => {
  for (const language of ["en", "fa"]) {
    test(`rows refused the same way share one notice, and Pick another key offers a key that sends (${language})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(
        page,
        "documentation",
        `refused=off${language === "en" ? "" : `&lang=${language}`}`,
      );
      await expectRightToLeft(page, language);

      const check: Locator = page.getByTestId("rum-setup-check");
      const notice: Locator = check.getByTestId("rum-setup-check-refusal");

      // One notice, above the rows, for every kind the key carried.
      await expect(notice).toHaveCount(1);
      await expect(notice).toHaveAttribute(
        "data-signals",
        "traces exceptions logs webVitals",
      );
      expect(
        await readText(notice.getByTestId("rum-setup-check-refusal-text")),
      ).toBe(
        words(
          language,
          'The key "{{key}}" is turned off, so everything sent with it is refused.',
          { key: REFUSED_KEY_NAME },
        ),
      );

      // Each row says only that it is refused, and when.
      for (const signal of ["traces", "exceptions", "logs", "webVitals"]) {
        const row: Locator = check.getByTestId(`rum-setup-check-${signal}`);

        await expect(row).toHaveAttribute("data-tone", "error");
        await expect(
          row.getByTestId(`rum-setup-check-${signal}-detail`),
        ).toHaveCount(0);
        await expect(
          row.getByTestId(`rum-setup-check-${signal}-action`),
        ).toHaveCount(0);
      }

      await expectNoSidewaysScroll(page);
      await screenshot(page, `setup-check-refused-${language}`);

      await press(notice.getByTestId("rum-setup-check-refusal-action"));

      const pickKey: Locator = dialog(
        page,
        words(language, "Pick another key"),
      );

      await expect(pickKey).toBeVisible();
      await expect(pickKey.getByTestId("rum-pick-key-setup")).toHaveAttribute(
        "data-client",
        "browser",
      );

      // The key that sends is offered first, not the refused one.
      await expect(shownDropdownValue(pickKey)).toHaveText(
        "Storefront web key",
      );
      await expect(
        pickKey.getByText(
          words(language, "Put it in place of the refused key"),
        ),
      ).toBeVisible();
      await expect(
        pickKey.getByText(words(language, "Deploy and check")),
      ).toBeVisible();

      // The line the refused key is on, with the picked key in its place.
      await expect(pickKey.locator("pre").first()).toContainText(
        'headers: { "x-oneuptime-token": "8f14e45f-ceea-4e7a-9a1b-6c0d3e2f1a01" },',
      );

      await expectNoSidewaysScroll(page);
      await screenshot(page, `pick-another-key-${language}`);
    });
  }

  test("an origin refusal's notice opens the key's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "documentation", "refused=origin");

    const notice: Locator = page.getByTestId("rum-setup-check-refusal");

    await expect(notice).toHaveCount(1);

    const action: Locator = notice.getByTestId(
      "rum-setup-check-refusal-action",
    );

    await expect(action).toHaveText("Open the key");
    await press(action);

    await expect(page.getByTestId("fixture-elsewhere")).toHaveText(
      `/dashboard/${PROJECT_ID}/settings/telemetry-ingestion-keys/${REFUSED_KEY_ID}`,
    );
  });

  test("the empty Logs page offers Pick another key too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "logs", "refused=off");

    await expect(page.getByTestId("rum-logs-empty-title")).toHaveText(
      "Logs are being refused",
    );

    const action: Locator = page.getByTestId("rum-logs-empty-action");

    await expect(action).toHaveText("Pick another key");
    await press(action);
    await expect(dialog(page, "Pick another key")).toBeVisible();
  });

  test("draws in the dark theme", async ({ page }: { page: Page }) => {
    await open(page, "documentation", "refused=off&theme=dark");

    await expect(page.getByTestId("rum-setup-check-refusal")).toBeVisible();
    await screenshot(page, "setup-check-refused-dark");

    await press(
      page
        .getByTestId("rum-setup-check-refusal")
        .getByTestId("rum-setup-check-refusal-action"),
    );
    await expect(dialog(page, "Pick another key")).toBeVisible();
    await screenshot(page, "pick-another-key-dark");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The setup guide's key picker
 * ---------------------------------------------------------------------------
 */

interface PickedValueFit {
  scrollWidth: number;
  clientWidth: number;
  left: number;
  right: number;
  controlLeft: number;
  controlRight: number;
}

test.describe("the setup guide's key picker", () => {
  for (const language of ["en", "fa"]) {
    test(`keeps a turned-off key's label whole on the screen (${language})`, async ({
      page,
    }: {
      page: Page;
    }) => {
      // The only Browser key is the turned-off one, so it is the one picked.
      await open(
        page,
        "documentation",
        `keys=off${language === "en" ? "" : `&lang=${language}`}`,
      );

      const picker: Locator = page
        .getByTestId("setup-guide")
        .getByTestId("ingestion-key-picker-row");
      const shown: Locator = shownDropdownValue(picker);

      await expect(shown).toBeVisible();
      expect(await readText(shown)).toBe(
        words(language, "{{name}} (turned off)", {
          name: REFUSED_KEY_NAME,
        }),
      );

      /*
       * Whole: wrapped inside its box, not cut off with an ellipsis (#6458).
       * The label is the words inside the picked value.
       */
      const fit: PickedValueFit = await shown
        .getByTestId("dropdown-value-label")
        .evaluate((element: Element): PickedValueFit => {
          const box: DOMRect = element.getBoundingClientRect();
          const control: DOMRect = (
            element.closest(".ou-select__control") || element
          ).getBoundingClientRect();

          return {
            scrollWidth: element.scrollWidth,
            clientWidth: element.clientWidth,
            left: box.left,
            right: box.right,
            controlLeft: control.left,
            controlRight: control.right,
          };
        });

      expect(
        fit.scrollWidth,
        "how wide the label is beside its box",
      ).toBeLessThanOrEqual(fit.clientWidth + 1);
      expect(fit.left).toBeGreaterThanOrEqual(fit.controlLeft - 1);
      expect(fit.right).toBeLessThanOrEqual(fit.controlRight + 1);

      // And under the token, why it is refused.
      expect(await readText(page.getByTestId("ingestion-key-unusable"))).toBe(
        words(
          language,
          "This key is turned off, so everything sent with it is refused. Pick another key, or turn it back on in Project Settings > Telemetry & APM > Ingestion Keys.",
        ),
      );

      await expectNoSidewaysScroll(page);
      await screenshot(page, `key-picker-turned-off-${language}`, picker);
    });
  }

  test("says in plain words what a Browser key may send, and from where", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "documentation");

    const caution: Locator = page
      .getByTestId("setup-guide")
      .getByTestId("ingestion-key-caution");

    expect(await readText(caution)).toBe(
      "Browser key: safe to put in a web page. It can send traces, logs, metrics, session replays and Sentry events, and only from: https://shop.example.com. An app:// entry lets a React Native app send session replays only, and anyone who has the app can send as it.",
    );
    // The words #6458 found hard to read are gone.
    await expect(caution).not.toContainText("intended for client distribution");
    await expect(caution).not.toContainText("Accepted identities");
  });

  test("its endpoint line is in the reader's language", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "documentation", "lang=de");

    const guide: Locator = page.getByTestId("setup-guide");

    await expect(guide).toContainText(
      words(
        "de",
        "The browser exporter takes the full URL of each signal: this address plus /v1/traces.",
      ),
    );
    await expect(guide).not.toContainText(
      "The browser exporter takes the full URL of each signal",
    );
  });
});

/*
 * ---------------------------------------------------------------------------
 * A mobile app is handed a Mobile key (#6457)
 * ---------------------------------------------------------------------------
 */

test.describe("a mobile app", () => {
  test("its guide asks for a Mobile key, and New Key makes one pinned to the app", async ({
    page,
  }: {
    page: Page;
  }) => {
    // The project has no Mobile key yet.
    await open(page, "documentation", "client=mobile&keys=none");

    const guide: Locator = page.getByTestId("setup-guide");

    await expect(
      guide.getByRole("radio", { name: /Mobile \(iOS \/ Android\)/ }),
    ).toBeChecked();
    await expect(guide).toContainText("Mobile key");
    await expect(guide).not.toContainText("Backend services");

    await press(guide.getByRole("button", { name: "Create Ingestion Key" }));

    const create: Locator = dialog(page, "Create Mobile Ingestion Key");

    await expect(create).toBeVisible();
    // Pinned to the app's service.name, as the guide made it.
    await expect(
      create.getByRole("textbox", { name: /Pinned Service Name/ }),
    ).toHaveValue("storefront-mobile");

    await screenshot(page, "mobile-create-key");

    await press(create.getByRole("button", { name: "Create Ingestion Key" }));
    await expect(create).toHaveCount(0);

    const created: Array<Record<string, unknown>> = (await fixtureRecord(page))
      .createdKeys;

    expect(created).toHaveLength(1);
    expect(created[0]).toMatchObject({
      keyType: "Mobile",
      pinnedServiceName: "storefront-mobile",
    });

    // Picked at once, and its caution names the app it files under.
    await expect(
      shownDropdownValue(guide.getByTestId("ingestion-key-picker-row")),
    ).toHaveText(created[0]!["name"] as string);
    expect(await readText(guide.getByTestId("ingestion-key-caution"))).toBe(
      "Mobile key: safe to ship in your app. It can send only traces, logs, metrics and session replays, all filed under storefront-mobile, and never from a web page. Anyone who has the app can copy it, so it is rate limited, and you can turn it off at any time.",
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "mobile-guide-key");
  });

  test("Pick another key offers its Mobile keys, never a Server key", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "documentation", "client=mobile&refused=off");

    await press(
      page
        .getByTestId("rum-setup-check-refusal")
        .getByTestId("rum-setup-check-refusal-action"),
    );

    const pickKey: Locator = dialog(page, "Pick another key");

    await expect(pickKey.getByTestId("rum-pick-key-setup")).toHaveAttribute(
      "data-client",
      "mobile",
    );
    await expect(pickKey).toContainText(
      "Pick a Mobile key that is turned on and pinned to this app, or create one.",
    );
    await expect(shownDropdownValue(pickKey)).toHaveText("Storefront app key");
    await expect(pickKey.locator("pre").first()).toContainText(
      'OTEL_EXPORTER_OTLP_HEADERS="x-oneuptime-token=8f14e45f-ceea-4e7a-9a1b-6c0d3e2f1a01"',
    );

    // Its picker lists the Mobile keys alone.
    const options: Array<string> = (
      await listDropdownOptions(page, pickKey.getByRole("combobox"))
    ).map((option: string): string => {
      return option.replace(ISOLATES, "").trim();
    });

    expect(options).toEqual([
      "Storefront app key",
      `${REFUSED_MOBILE_KEY_NAME} (turned off)`,
    ]);

    await screenshot(page, "mobile-pick-another-key");
  });
});

/*
 * ---------------------------------------------------------------------------
 * The guide in German and in Persian (#6434)
 * ---------------------------------------------------------------------------
 */

// Sentences of the English guide that no translated page may show.
const ENGLISH_SENTENCES: Array<string> = [
  "Before you start",
  "What are you instrumenting?",
  "A web app whose code you can change and redeploy",
  "Choose an ingestion key",
  "Install the OpenTelemetry packages",
  "Create telemetry.ts and import it first",
  "Load a page and verify",
  "Everything in the snippet ships to your users' browsers",
];

test.describe("the setup guide reads in the reader's language", () => {
  for (const language of ["de", "fa"]) {
    test(`in ${language === "de" ? "German" : "Persian"}, with no English sentence left`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page, "documentation", `lang=${language}`);
      await expectRightToLeft(page, language);

      const guide: Locator = page.getByTestId("setup-guide");

      await expect(guide).toContainText(words(language, "Before you start"));
      await expect(guide).toContainText(
        words(language, "What are you instrumenting?"),
      );

      const text: string = await readText(guide);

      for (const sentence of ENGLISH_SENTENCES) {
        expect(text, `the ${language} guide shows "${sentence}"`).not.toContain(
          sentence,
        );
      }

      await expectNoSidewaysScroll(page);
      await screenshot(page, `guide-${language}`);
    });
  }

  test("a mobile app's guide, in Persian, reads right to left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await open(page, "documentation", "lang=fa&client=mobile");
    await expectRightToLeft(page, "fa");

    const text: string = await readText(page.getByTestId("setup-guide"));

    expect(text).not.toContain("Choose an ingestion key");
    expect(text).not.toContain("Before you start");

    await expectNoSidewaysScroll(page);
    await screenshot(page, "guide-mobile-fa");
  });
});
