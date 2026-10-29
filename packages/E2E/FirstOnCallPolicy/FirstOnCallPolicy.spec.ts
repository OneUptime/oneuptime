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
 * A new project's first on-call policy, in a browser, against the offline
 * fixture (FirstOnCallPolicy/Fixture): On-Call Duty > Policies and its
 * Create On-Call Policy dialog.
 *
 * A policy pages nobody until an on-call rule or a monitor triggers it, and
 * a new project has neither: the newcomer who did what Home's checklist asked
 * - "Set up an on-call policy" - was paged by nothing. So a project's first
 * policy is asked one more thing, "Page this policy for every new incident
 * and alert", on to start with (Common/Types/OnCallDutyPolicy/
 * EveryNewEventRules), and Create sends the answer the server turns into an
 * incident and an alert on-call rule.
 *
 * Pinned here, in Chromium: the switch's row in the dialog - named for the
 * policy, said what it does, on - and what Create sends; that it is asked
 * only of a project's first policy, of someone who may add on-call rules,
 * and never when the project's counts fail; that it fits a 390px phone,
 * reads in German and, in Persian, sits at the start of the row on the right
 * with the dialog laid out right to left, in dark mode. The fixture records
 * every create and every count, so the tests check what the page asked and
 * sent as well as what it drew.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000f1";
const NEW_POLICY_ID: string = "20000000-0000-4000-8000-0000000000f9";
const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/on-call-duty/policies`;
const PORT: string = process.env["FIRST_ON_CALL_POLICY_FIXTURE_PORT"] || "4729";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/first-on-call-policy-ui",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

const SWITCH: string = "Page this policy for every new incident and alert";
const SWITCH_DESCRIPTION: string =
  "Adds an on-call rule for incidents and one for alerts. A policy pages nobody until a rule or a monitor triggers it.";
const SWITCH_KEY: string = "pageForEveryNewIncidentAndAlert";

// What decides the offer: the whole project's policies and both kinds of rules.
const OFFER_COUNTS: Array<string> = [
  "AlertOnCallRule",
  "IncidentOnCallRule",
  "OnCallDutyPolicy",
];

interface RecordedCreate {
  model: string;
  data: Record<string, unknown>;
  misc: Record<string, unknown>;
}

interface FixtureState {
  creates: Array<RecordedCreate>;
  counts: Array<string>;
  unmodelled: Array<string>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(error.message);
  });

  // Nothing may leave the fixture: a request to a real host is a test bug.
  await page.route("**/*", async (route: PlaywrightRoute) => {
    const target: URL = new URL(route.request().url());

    if (target.hostname === "127.0.0.1" && target.port === PORT) {
      await route.continue();
      return;
    }

    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  expect(pageErrors.get(page) || []).toEqual([]);
  // Every table the page read is one the fixture models.
  expect((await fixture(page)).unmodelled).toEqual([]);
});

async function fixture(page: Page): Promise<FixtureState> {
  return page.evaluate((): FixtureState => {
    return JSON.parse(
      JSON.stringify(
        (window as unknown as { __fixture: FixtureState }).__fixture,
      ),
    ) as FixtureState;
  });
}

/*
 * The screen, with the dialog open: its backdrop covers the screen only, so
 * a whole-page shot would show half the page dimmed.
 */
async function screenshot(page: Page, name: string): Promise<void> {
  fs.mkdirSync(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: (await dialog(page).count()) === 0,
    animations: "disabled",
  });
}

async function openPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${PAGE_PATH}${query}`);
  await page.evaluate(async (): Promise<void> => {
    await document.fonts.ready;
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

function everyNewEventSwitch(page: Page, name: string = SWITCH): Locator {
  return dialog(page).getByRole("switch", { name: name });
}

/*
 * Create On-Call Policy: the empty list's own button in a new project, the
 * card's header button otherwise. The dialog is at rest once its Name box
 * is there and it has grown in.
 */
async function openCreate(page: Page): Promise<void> {
  const emptyListButton: Locator = page.getByTestId(
    "empty-table-create-button",
  );
  const headerButton: Locator = page
    .getByTestId("card-button")
    .filter({ hasText: /Create|Erstellen|ساخت/ })
    .first();

  await expect(emptyListButton.or(headerButton).first()).toBeVisible();

  if ((await emptyListButton.count()) > 0) {
    await emptyListButton.click();
  } else {
    await headerButton.click();
  }

  await expect(dialog(page)).toBeVisible();
  await expect(dialog(page).getByRole("textbox").first()).toBeVisible();
  await page.waitForTimeout(300);
}

async function createNamed(page: Page, name: string): Promise<RecordedCreate> {
  // The policy's Name: the dialog's first box, in every language.
  await dialog(page).getByRole("textbox").first().fill(name);
  await page.getByTestId("modal-footer-submit-button").click();

  await expect
    .poll(async (): Promise<number> => {
      return (await fixture(page)).creates.length;
    })
    .toBe(1);

  return (await fixture(page)).creates[0]!;
}

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const bounds: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(bounds).not.toBeNull();

  return bounds!;
}

// The words beside the switch: the label the switch is named by.
function switchLabel(page: Page, words: string): Locator {
  return dialog(page).locator("label").filter({ hasText: words });
}

test.describe("a new project's first on-call policy", () => {
  test("is asked to page this policy for every new incident and alert, with the switch on and what it does said under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await expect(page.getByTestId("empty-table-create-button")).toBeVisible();
    await openCreate(page);

    const toggle: Locator = everyNewEventSwitch(page);

    await expect(toggle).toBeVisible();
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(dialog(page)).toContainText(SWITCH_DESCRIPTION);

    // The description is read with the switch, not only seen beside it.
    await expect(toggle).toHaveAccessibleDescription(SWITCH_DESCRIPTION);

    // Who first, then when: under "Who gets paged first?", before More fields.
    const order: Array<string> = await dialog(page).evaluate(
      (element: Element, words: Array<string>): Array<string> => {
        const text: string = element.textContent || "";
        return words
          .map((word: string): [string, number] => {
            return [word, text.indexOf(word)];
          })
          .sort((a: [string, number], b: [string, number]): number => {
            return a[1] - b[1];
          })
          .map((entry: [string, number]): string => {
            return entry[0];
          });
      },
      ["Who gets paged first?", SWITCH, "More fields"],
    );
    expect(order).toEqual(["Who gets paged first?", SWITCH, "More fields"]);

    // Still one page: a step for one switch would be the longer way.
    await expect(
      dialog(page).getByRole("button", { name: "Next", exact: true }),
    ).toHaveCount(0);

    // The project is counted once its empty list is back: once each.
    expect((await fixture(page)).counts.sort()).toEqual(OFFER_COUNTS);

    await screenshot(page, "first-policy-dialog-1280");
  });

  test("Create sends the ask for the two rules beside the policy, and the policy opens on its Escalation Rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await openCreate(page);
    await expect(everyNewEventSwitch(page)).toHaveAttribute(
      "aria-checked",
      "true",
    );

    const created: RecordedCreate = await createNamed(page, "Platform on-call");

    expect(created.model).toBe("OnCallDutyPolicy");
    expect(created.data["name"]).toBe("Platform on-call");
    expect(created.misc[SWITCH_KEY]).toBe(true);
    // Not a column of the policy: it travels as misc data the server reads.
    expect(created.data[SWITCH_KEY]).toBeUndefined();

    await expect(page.getByTestId("new-policy-escalation-rules")).toHaveText(
      NEW_POLICY_ID,
    );
  });

  test("switched off, Create asks for no rules", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page);
    await openCreate(page);

    // The words beside the switch flip it too: they are its label.
    await switchLabel(page, SWITCH).click();
    await expect(everyNewEventSwitch(page)).toHaveAttribute(
      "aria-checked",
      "false",
    );

    const created: RecordedCreate = await createNamed(page, "Platform on-call");

    expect(created.misc[SWITCH_KEY]).not.toBe(true);
  });
});

test.describe("a project that is not new is not asked", () => {
  test("with a policy in the list: nothing is counted, nothing asked, nothing sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?policies=one");
    await expect(page.getByText("Platform on-call").first()).toBeVisible();
    await openCreate(page);

    await expect(dialog(page).getByRole("switch")).toHaveCount(0);
    await expect(dialog(page)).not.toContainText(SWITCH);
    expect((await fixture(page)).counts).toEqual([]);

    const created: RecordedCreate = await createNamed(page, "Database on-call");

    expect(created.misc[SWITCH_KEY]).toBeUndefined();
  });

  test("with an incident on-call rule and no policy: the counts say so, and nothing is asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?rules=incident");
    await expect(page.getByTestId("empty-table-create-button")).toBeVisible();
    await openCreate(page);

    await expect
      .poll(async (): Promise<Array<string>> => {
        return (await fixture(page)).counts.sort();
      })
      .toEqual(OFFER_COUNTS);
    await expect(dialog(page).getByRole("switch")).toHaveCount(0);

    const created: RecordedCreate = await createNamed(page, "Platform on-call");

    expect(created.misc[SWITCH_KEY]).toBeUndefined();
  });

  test("when the project's counts fail, nothing is asked and the dialog is what it always was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?counts=fail");
    await openCreate(page);

    await expect(dialog(page).getByRole("switch")).toHaveCount(0);
    // Name, who gets paged first and More fields, as before the switch.
    await expect(
      dialog(page).getByRole("group", {
        name: "Who gets paged first? (Optional)",
      }),
    ).toBeVisible();
    await expect(dialog(page)).toContainText("More fields");

    const created: RecordedCreate = await createNamed(page, "Platform on-call");

    expect(created.misc[SWITCH_KEY]).toBeUndefined();
  });

  test("someone who may not add on-call rules is not asked: a Project Member", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?role=member");
    await openCreate(page);

    await expect(dialog(page).getByRole("switch")).toHaveCount(0);

    const created: RecordedCreate = await createNamed(page, "Platform on-call");

    expect(created.misc[SWITCH_KEY]).toBeUndefined();
  });

  test("counts that answer late add the switch to the dialog already open, on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?counts=hold");
    await openCreate(page);

    await expect(dialog(page).getByRole("switch")).toHaveCount(0);

    await page.evaluate((): void => {
      (
        window as unknown as { __fixture: { releaseCounts: () => void } }
      ).__fixture.releaseCounts();
    });

    await expect(everyNewEventSwitch(page)).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });
});

test.describe("the switch's row, wherever it is drawn", () => {
  test("at 390px: the row fits the phone - the switch first, its words wrapping beside it, nothing to scroll sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page);
    await openCreate(page);

    const toggle: Locator = everyNewEventSwitch(page);
    await expect(toggle).toBeVisible();

    const dialogBox: { x: number; width: number } = await box(dialog(page));
    const toggleBox: { x: number; y: number; width: number; height: number } =
      await box(toggle);
    const labelBox: { x: number; y: number; width: number; height: number } =
      await box(switchLabel(page, SWITCH));

    // The switch at the start of the row, its label after it, both inside.
    expect(toggleBox.x).toBeGreaterThanOrEqual(dialogBox.x);
    expect(labelBox.x).toBeGreaterThanOrEqual(toggleBox.x + toggleBox.width);
    expect(labelBox.x + labelBox.width).toBeLessThanOrEqual(
      dialogBox.x + dialogBox.width + 0.5,
    );
    // The label wraps to a second line beside the switch, never under it.
    expect(labelBox.height).toBeGreaterThan(toggleBox.height);
    // The switch keeps its size beside two lines of words.
    expect(Math.round(toggleBox.width)).toBe(44);

    const overflow: number = await page.evaluate((): number => {
      return (
        document.documentElement.scrollWidth -
        document.documentElement.clientWidth
      );
    });
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshot(page, "first-policy-dialog-390");
  });

  test("German: the switch and what it does in German, as the Dashboard draws them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, "?lang=de");
    await openCreate(page);

    const german: string = GERMAN[SWITCH]!;
    const toggle: Locator = everyNewEventSwitch(page, german);

    expect(german).not.toBe(SWITCH);
    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(dialog(page)).toContainText(GERMAN[SWITCH_DESCRIPTION]!);
    await expect(dialog(page)).not.toContainText(SWITCH);

    const created: RecordedCreate = await createNamed(
      page,
      "Plattform-Bereitschaft",
    );
    expect(created.misc[SWITCH_KEY]).toBe(true);
  });

  test("Persian, dark: the dialog reads right to left, the switch at the start of the row on the right, on, its words readable", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "?lang=fa&theme=dark");
    await openCreate(page);

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const persian: string = PERSIAN[SWITCH]!;
    const toggle: Locator = everyNewEventSwitch(page, persian);

    await expect(toggle).toHaveAttribute("aria-checked", "true");
    await expect(dialog(page)).toContainText(PERSIAN[SWITCH_DESCRIPTION]!);

    const toggleBox: { x: number; width: number } = await box(toggle);
    const labelBox: { x: number; width: number } = await box(
      switchLabel(page, persian),
    );

    // Right to left: the switch on the right, its words to its left.
    expect(toggleBox.x).toBeGreaterThanOrEqual(labelBox.x + labelBox.width);

    // On, the knob sits at the end of the track - on the left.
    const knob: { x: number; width: number } = await box(
      toggle.locator("[data-ou-toggle-knob]"),
    );
    expect(knob.x + knob.width / 2).toBeLessThan(
      toggleBox.x + toggleBox.width / 2,
    );

    /*
     * Light words on the dark dialog, never the light theme's grey on white:
     * the label's colour against the first painted surface behind it.
     */
    const colors: { text: string; surface: string } = await switchLabel(
      page,
      persian,
    ).evaluate((label: Element): { text: string; surface: string } => {
      let surface: string = "";
      let element: Element | null = label;

      while (element && !surface) {
        const background: string = getComputedStyle(element).backgroundColor;

        if (background && background !== "rgba(0, 0, 0, 0)") {
          surface = background;
        }

        element = element.parentElement;
      }

      return { text: getComputedStyle(label).color, surface: surface };
    });
    expect(colors.surface).not.toBe("");
    expect(colors.surface).not.toBe("rgb(255, 255, 255)");
    expect(colors.text).not.toBe(colors.surface);
    // Not the light theme's gray-900 either.
    expect(colors.text).not.toBe("rgb(17, 24, 39)");

    await screenshot(page, "first-policy-dialog-fa-dark");
  });
});
