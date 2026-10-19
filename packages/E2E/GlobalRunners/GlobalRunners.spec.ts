import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * Global Runners - the Runners OneUptime runs for every project - on the
 * pages that show them, in a browser, against the offline fixture
 * (GlobalRunners/Fixture): Runbooks -> Runners with its Global Runners,
 * Custom Runners and Use Global Runners cards; a runbook step's Runner
 * picker, opened and picked by mouse and by keyboard; and whether global
 * Runners may use a runbook secret. Then a phone, dark mode and German.
 *
 * The maintainer's ask: "Please also show global runners here as well, and
 * people can create custom runners if they want more security. Global
 * runners are enabled by default. Just like we do for probes, and in
 * runbooks - do not show 'No runners added' - if there are global runner,
 * pick them by default but you should be able to pick a custom local runner
 * as well. Please make the UI simple and natural to understand as this
 * reduces decision paralysis." The fixture records every save and create
 * the pages make, so the tests check what was sent as well as what was
 * drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID: string = "20000000-0000-4000-8000-0000000000b1";
const PROD_RUNNER_ID: string = "40000000-0000-4000-8000-0000000000d1";

const RUNNERS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/runners`;
const STEPS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`;
const SECRETS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/settings/secrets`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/global-runners-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

const GLOBAL_CHOICE: string = "Global Runner · Connected";
const GLOBAL_CHOICE_DESCRIPTION: string =
  "Run by OneUptime for every project, in a sandbox that reaches the internet only.";
const GLOBAL_HELP: string =
  "Runs on a global Runner, in a sandbox that can reach the internet but not your network, for 5 minutes at most. Pick one of your own Runners for anything on your network.";

interface Recorded {
  updates: Array<{ model: string; id: string; data: Record<string, unknown> }>;
  creates: Array<{ model: string; data: Record<string, unknown> }>;
}

interface SavedStep {
  type: string;
  config: { agentId?: string };
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __fixture: Recorded }).__fixture;
  });
}

function headings(page: Page): Locator {
  return page.getByTestId("card-details-heading");
}

// The card whose heading is this title.
function card(page: Page, title: string): Locator {
  return page.getByTestId("card").filter({
    has: headings(page).getByText(title, { exact: true }),
  });
}

function useGlobalRunnersSwitch(page: Page): Locator {
  return page.getByTestId("use-global-runners-switch");
}

async function openRunners(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${RUNNERS_PAGE}${search ? `?${search}` : ""}`);
  await expect(headings(page).first()).toBeVisible();
}

// The Steps page, with every step opened.
async function openSteps(page: Page, search: string): Promise<void> {
  await page.goto(`${STEPS_PAGE}?page=steps${search ? `&${search}` : ""}`);
  for (const title of ["Look up the status page", "Restart the web service"]) {
    const header: Locator = page
      .getByTestId("runbook-step-header")
      .filter({ hasText: title });
    await expect(header).toBeVisible();
    const toggle: Locator = header.getByRole("button", { expanded: false });
    if ((await toggle.count()) > 0) {
      await toggle.first().click();
    }
  }
}

function picker(page: Page, stepIndex: number): Locator {
  return page.getByTestId(`runbook-step-${stepIndex}-runner`);
}

async function openPicker(page: Page, stepIndex: number): Promise<Locator> {
  await picker(page, stepIndex).getByRole("combobox").click();
  const options: Locator = page.getByRole("option");
  await expect(options.first()).toBeVisible();
  return options;
}

async function saveSteps(page: Page): Promise<Array<SavedStep>> {
  const before: number = (await recorded(page)).updates.length;
  await page.getByRole("button", { name: "Save Steps" }).click();
  await expect
    .poll(async (): Promise<number> => {
      return (await recorded(page)).updates.length;
    })
    .toBe(before + 1);
  // The page says it saved, and the dialog closes on Got it.
  const saved: Locator = page.getByTestId("modal");
  await expect(saved).toContainText("Runbook steps saved successfully.");
  await saved.getByRole("button", { name: "Got it" }).click();
  await expect(saved).toBeHidden();
  const updates: Recorded["updates"] = (await recorded(page)).updates;
  const last: Recorded["updates"][number] = updates[updates.length - 1]!;
  expect({ model: last.model, id: last.id }).toEqual({
    model: "Runbook",
    id: RUNBOOK_ID,
  });
  return last.data["steps"] as Array<SavedStep>;
}

function noHorizontalScroll(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return document.documentElement.scrollWidth - window.innerWidth;
  });
}

test.describe("Runbooks → Runners on a server that runs global Runners", () => {
  test("the global Runners come first, read-only, then the project's own, then the switch, with no empty 'no Runners' box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page);

    // In the order a person reads them, top to bottom.
    await expect(headings(page)).toHaveText([
      "Global Runners",
      "Custom Runners",
      "Use Global Runners",
    ]);
    const tops: Array<number> = [];
    for (const title of [
      "Global Runners",
      "Custom Runners",
      "Use Global Runners",
    ]) {
      const box: { y: number } | null = await card(page, title).boundingBox();
      expect(box).not.toBeNull();
      tops.push(box!.y);
    }
    expect(
      [...tops].sort((a: number, b: number) => {
        return a - b;
      }),
    ).toEqual(tops);

    // The bundled global Runner, connected; nobody in a project changes it.
    const globalCard: Locator = card(page, "Global Runners");
    const bundled: Locator = globalCard
      .getByRole("row")
      .filter({ hasText: "Runs with this server." });
    await expect(bundled).toContainText("Global Runner");
    await expect(bundled).toContainText("Connected");
    await expect(
      globalCard.getByRole("button", { name: "Create Runner" }),
    ).toHaveCount(0);
    await expect(globalCard.getByTestId("row-actions-more-button")).toHaveCount(
      0,
    );
    await expect(globalCard).toContainText(
      "A JavaScript step that does not pick a Runner of its own runs on one, in a sandbox that can reach the internet but not your network.",
    );

    /*
     * The project's own Runners: none yet, so one plain sentence says why
     * to add one, with the button that does - never "No Runners yet".
     */
    const customCard: Locator = card(page, "Custom Runners");
    await expect(customCard.getByTestId("table-empty-state-title")).toHaveText(
      /^Add a Runner of your own\.?$/,
    );
    await expect(
      customCard.getByRole("button", { name: "Create Runner" }).first(),
    ).toBeVisible();
    await expect(page.getByText(/no runners/i)).toHaveCount(0);

    // Global Runners are on by default.
    await expect(useGlobalRunnersSwitch(page)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(card(page, "Use Global Runners")).toContainText(
      "JavaScript steps that do not pick a Runner of their own run on the global Runners.",
    );
    await screenshot(page, "runners");
  });

  test("turning Use global Runners off asks first; Cancel saves nothing; confirming saves it, and on again saves without asking", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page);
    const modal: Locator = page.getByTestId("modal");

    await useGlobalRunnersSwitch(page).click();
    await expect(modal).toBeVisible();
    await expect(modal).toContainText("Stop using global Runners?");
    await expect(modal).toContainText(
      "JavaScript steps that do not pick a Runner of their own will fail until they pick one of yours, and steps waiting for a global Runner now will not run.",
    );
    await screenshot(page, "stop-using-global-runners");
    await modal.getByRole("button", { name: "Cancel" }).click();
    await expect(modal).toBeHidden();
    await expect(useGlobalRunnersSwitch(page)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((await recorded(page)).updates).toEqual([]);

    await useGlobalRunnersSwitch(page).click();
    await modal
      .getByRole("button", { name: "Stop Using Global Runners" })
      .click();
    await expect(useGlobalRunnersSwitch(page)).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect((await recorded(page)).updates).toEqual([
      {
        model: "Project",
        id: PROJECT_ID,
        data: { useGlobalRunners: false },
      },
    ]);
    // Both cards now say what the project does instead.
    await expect(card(page, "Global Runners")).toContainText(
      "This project does not use them: every step runs on a Runner of your own.",
    );
    await expect(card(page, "Use Global Runners")).toContainText(
      "Every step runs on a Runner of your own. A step that does not pick one fails and says so.",
    );

    // Turning it back on loses nothing, so it does not ask.
    await useGlobalRunnersSwitch(page).click();
    await expect(modal).toBeHidden();
    await expect(useGlobalRunnersSwitch(page)).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect((await recorded(page)).updates[1]).toEqual({
      model: "Project",
      id: PROJECT_ID,
      data: { useGlobalRunners: true },
    });
  });

  test("the switch is reached and flipped from the keyboard", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page);

    await useGlobalRunnersSwitch(page).focus();
    await page.keyboard.press("Space");
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toContainText("Stop using global Runners?");
    await modal
      .getByRole("button", { name: "Stop Using Global Runners" })
      .press("Enter");
    await expect(useGlobalRunnersSwitch(page)).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a global Runner that is not heard from says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page, "gstatus=disconnected&global=2");
    const rows: Locator = card(page, "Global Runners").locator("tbody tr");
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0)).toContainText("Disconnected");
    await expect(rows.nth(1)).toContainText("global-runner-frankfurt");

    await openRunners(page, "gstatus=never");
    await expect(card(page, "Global Runners")).toContainText("Never connected");
  });

  test("someone who may only read sees the switch, locked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page, "role=viewer");

    await expect(useGlobalRunnersSwitch(page)).toBeDisabled();
    await useGlobalRunnersSwitch(page).click({ force: true });
    await expect(page.getByTestId("modal")).toHaveCount(0);
    expect((await recorded(page)).updates).toEqual([]);
  });
});

test.describe("Runbooks → Runners on a server with no global Runner", () => {
  test("lists the project's own Runners only, as it always did", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page, "global=0");

    await expect(headings(page)).toHaveText(["Runners"]);
    await expect(useGlobalRunnersSwitch(page)).toHaveCount(0);
    await expect(page.getByTestId("add-global-runners-hint")).toHaveCount(0);
    await expect(page.getByText(/no runners/i)).toHaveCount(0);
  });

  test("tells a master admin where global Runners are added", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page, "global=0&admin=1");

    const hint: Locator = page.getByTestId("add-global-runners-hint");
    await expect(hint).toContainText(
      "This server has no global Runners. Add one so every project can run JavaScript steps without installing a Runner:",
    );
    const link: Locator = hint.getByRole("link", {
      name: "Admin Dashboard → Global Runners",
    });
    await expect(link).toHaveAttribute(
      "href",
      /\/admin\/settings\/global-runners$/,
    );
    await expect(link).toHaveAttribute("target", "_blank");
  });
});

test.describe("a step's Runner picker", () => {
  test("a JavaScript step starts on Global Runner, offered first; one of yours is picked by keyboard, and Global Runner again by mouse", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "custom=2");

    await expect(picker(page, 0)).toContainText(GLOBAL_CHOICE);
    await expect(
      picker(page, 0).getByTestId("runbook-step-0-runner-help"),
    ).toHaveText(GLOBAL_HELP);

    const options: Locator = await openPicker(page, 0);
    await expect(options).toHaveCount(3);
    await expect(options.nth(0)).toContainText(GLOBAL_CHOICE);
    await expect(options.nth(0)).toContainText(GLOBAL_CHOICE_DESCRIPTION);
    await expect(options.nth(1)).toHaveText("prod-eu-west-1 · Connected");
    await expect(options.nth(2)).toHaveText("office-runner · Disconnected");
    await screenshot(page, "picker-open");

    // The keyboard moves past Global Runner to the first of the project's own.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(picker(page, 0)).toContainText("prod-eu-west-1 · Connected");
    await expect(
      picker(page, 0).getByTestId("runbook-step-0-runner-help"),
    ).not.toContainText("global Runner");

    let saved: Array<SavedStep> = await saveSteps(page);
    expect(
      saved.map((step: SavedStep) => {
        return [step.type, step.config.agentId];
      }),
    ).toEqual([
      ["JavaScript", PROD_RUNNER_ID],
      ["Bash", ""],
    ]);

    // Back to Global Runner by mouse: the step names no Runner again.
    await (await openPicker(page, 0))
      .filter({ hasText: GLOBAL_CHOICE })
      .click();
    await expect(picker(page, 0)).toContainText(GLOBAL_CHOICE);
    saved = await saveSteps(page);
    expect(saved[0]!.config.agentId).toBe("");
  });

  test("a Bash step offers only the project's own Runners", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "custom=2");

    const options: Locator = await openPicker(page, 1);
    await expect(options).toHaveText([
      "prod-eu-west-1 · Connected",
      "office-runner · Disconnected",
    ]);
  });

  test("with no Runner of its own, a Bash step says what to do instead of an empty box", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "custom=0");

    await expect(
      page.getByTestId("runbook-step-1-runner-nothing-to-pick"),
    ).toHaveText(
      "Bash steps run on a Runner of your own, inside your network. Add one under Runbooks › Runners, then pick it here.",
    );
    // The JavaScript step still runs: on Global Runner, the one choice.
    await expect(picker(page, 0)).toContainText(GLOBAL_CHOICE);
    await expect(await openPicker(page, 0)).toHaveCount(1);
    await screenshot(page, "steps-no-runner-of-its-own");
  });

  test("a project that turned global Runners off picks one of its own, and is told why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "uses=0&custom=1");

    await expect(
      picker(page, 0).getByTestId("runbook-step-0-runner-help"),
    ).toHaveText(
      "This project does not use global Runners: pick one of your Runners for this step.",
    );
    await expect(await openPicker(page, 0)).toHaveText([
      "prod-eu-west-1 · Connected",
    ]);

    await openSteps(page, "uses=0&custom=0");
    await expect(
      page.getByTestId("runbook-step-0-runner-nothing-to-pick"),
    ).toHaveText(
      "This project does not use global Runners. Add a Runner of your own under Runbooks › Runners, or turn global Runners on there.",
    );
  });

  test("on a server with no global Runner, a JavaScript step picks one of the project's own", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "global=0&custom=1");

    await expect(picker(page, 0)).not.toContainText("Global Runner");
    await expect(await openPicker(page, 0)).toHaveText([
      "prod-eu-west-1 · Connected",
    ]);
  });
});

test.describe("which secrets global Runners may use", () => {
  async function createSecret(page: Page, search: string): Promise<Locator> {
    await page.goto(`${SECRETS_PAGE}?page=secrets&${search}`);
    await page
      .getByRole("button", { name: "Create Runbook Secret" })
      .first()
      .click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    await modal.getByRole("textbox").first().fill("WEBHOOK_TOKEN");
    await modal.locator("textarea").last().fill("a-token-for-the-webhook");
    await modal.getByTestId("modal-footer-next-button").click();
    return modal;
  }

  test("the list says which secrets global Runners may use, and a new one starts usable by them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SECRETS_PAGE}?page=secrets&custom=1`);
    const table: Locator = page.getByTestId("card");
    await expect(
      table.getByRole("columnheader", { name: "Global Runners" }),
    ).toBeVisible();
    await expect(
      table.getByRole("row").filter({ hasText: "STATUSPAGE_TOKEN" }),
    ).toContainText("Yes");
    await expect(
      table.getByRole("row").filter({ hasText: "DB_PASSWORD" }),
    ).toContainText("No");

    const modal: Locator = await createSecret(page, "custom=1");
    const globalSwitch: Locator = modal.getByRole("switch", {
      name: /Global Runners can use this secret/,
    });
    await expect(globalSwitch).toHaveAttribute("aria-checked", "true");
    await expect(modal).toContainText(
      "Steps of this project that run on a global Runner get this secret. Steps of other projects never do.",
    );
    await expect(modal).toContainText("Your Runners that can use this secret");
    await screenshot(page, "secret-access-step");

    await modal.getByTestId("modal-footer-submit-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).creates.length;
      })
      .toBe(1);
    const created: Recorded["creates"][number] = (await recorded(page))
      .creates[0]!;
    expect(created.model).toBe("RunbookSecret");
    expect(created.data["isAvailableToGlobalRunners"]).toBe(true);
  });

  test("in a project that turned global Runners off, a new secret starts closed to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const modal: Locator = await createSecret(page, "uses=0&custom=1");

    await expect(
      modal.getByRole("switch", { name: /Global Runners can use this secret/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("on a server with no global Runner, nobody is asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${SECRETS_PAGE}?page=secrets&global=0&custom=1`);
    await expect(
      page.getByRole("columnheader", { name: "Your Runners" }),
    ).toBeVisible();
    await expect(
      page.getByRole("columnheader", { name: "Global Runners" }),
    ).toHaveCount(0);

    const modal: Locator = await createSecret(page, "global=0&custom=1");
    await expect(modal).toContainText("Your Runners that can use this secret");
    await expect(
      modal.getByRole("switch", { name: /Global Runners can use this secret/ }),
    ).toHaveCount(0);
  });
});

test.describe("on every screen", () => {
  test("a phone: nothing runs off the screen, on Runners or in the picker", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openRunners(page);

    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    await expect(useGlobalRunnersSwitch(page)).toBeVisible();
    await screenshot(page, "phone-runners");

    await openSteps(page, "custom=2");
    expect(await noHorizontalScroll(page)).toBeLessThanOrEqual(0);
    const options: Locator = await openPicker(page, 0);
    const box: { x: number; width: number } | null = await options
      .first()
      .boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    await screenshot(page, "phone-picker");
  });

  test("dark mode draws the cards dark", async ({ page }: { page: Page }) => {
    await openRunners(page, "theme=dark");

    const background: string = await card(page, "Global Runners").evaluate(
      (element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      },
    );
    expect(background).not.toBe("rgb(255, 255, 255)");
    await screenshot(page, "dark-runners");
  });

  test("in German, the cards, the switch and the picker are said in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page, "lang=de");

    await expect(headings(page)).toHaveText([
      GERMAN["Global Runners"]!,
      GERMAN["Custom Runners"]!,
      GERMAN["Use Global Runners"]!,
    ]);
    await expect(useGlobalRunnersSwitch(page)).toHaveAccessibleName(
      GERMAN["Use global Runners"]!,
    );
    await screenshot(page, "german-runners");

    await openSteps(page, "lang=de&custom=1");
    await expect(picker(page, 0)).toContainText(
      `${GERMAN["Global Runner"]} · ${GERMAN["Connected"]}`,
    );
  });
});
