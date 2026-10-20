import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * Global Runners - the Runners OneUptime runs for every project - on the
 * pages that show them, in a browser, against the offline fixture
 * (GlobalRunners/Fixture): Runbooks -> Runners with its Global Runners,
 * Custom Runners and Global Runners in This Project cards; a runbook step's
 * Runner picker, opened and picked by mouse and by keyboard, and the line
 * under each folded step that says where it runs; whether global Runners
 * may use a secret runbook variable; and a Runner's own page, which lists
 * the code repositories that pick it - a Runner has no AI code fix switch,
 * in the Create Runner dialog or on its page. Then a phone, dark mode and
 * German.
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
const RUNNER_PAGE: string = `${RUNNERS_PAGE}/${PROD_RUNNER_ID}`;
const CHECKOUT_REPOSITORY_ID: string = "90000000-0000-4000-8000-000000000c01";
const STEPS_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}/steps`;
const VARIABLES_PAGE: string = `/dashboard/${PROJECT_ID}/runbooks/settings/variables`;

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
  "Runs in a sandbox that reaches the internet only, for up to 5 minutes. To reach your network, pick one of your Runners.";

// The card of the project's one switch.
const SWITCH_CARD: string = "Global Runners in This Project";

// A step's Execution timeout field, by its label ("Execution timeout seconds").
const EXECUTION_TIMEOUT_LABEL: RegExp = /^Execution timeout/;

// The old line under a folded step, which named no Runner.
const OLD_FOLDED_LINE: RegExp = /on a Runner$/;

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
      SWITCH_CARD,
    ]);
    const tops: Array<number> = [];
    for (const title of ["Global Runners", "Custom Runners", SWITCH_CARD]) {
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
      "JavaScript steps run on them by default, in a sandbox that reaches the internet only.",
    );
    // One line across the card, as Global Probes' is.
    const descriptionLines: number = await globalCard
      .getByTestId("card-description")
      .evaluate((element: Element): number => {
        const style: CSSStyleDeclaration = getComputedStyle(element);
        const lineHeight: number =
          parseFloat(style.lineHeight) || parseFloat(style.fontSize) * 1.2;
        return Math.round(element.getBoundingClientRect().height / lineHeight);
      });
    expect(descriptionLines).toBe(1);

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
    const switchCard: Locator = card(page, SWITCH_CARD);
    await expect(switchCard).toContainText(
      "Steps and code repositories that pick one of your Runners always run on it.",
    );
    await expect(switchCard).toContainText(
      "JavaScript steps and code repositories that pick no Runner run on a global Runner.",
    );
    // Said once: the card's title is not the switch's name.
    await expect(switchCard.getByText("Use global Runners")).toHaveCount(1);
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
      "JavaScript steps and code repositories that pick no Runner stop running until they pick one of yours. Work queued for a global Runner will not run.",
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
      "This project does not use them, so steps and code repositories run on yours.",
    );
    await expect(card(page, SWITCH_CARD)).toContainText(
      "Every step and code repository runs on one of your Runners. One that picks none does not run.",
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
      "Add global Runners in Admin Dashboard → Global Runners.",
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

  test("a JavaScript step on Global Runner offers the 5 minutes it gets, and says a longer timeout is cut short", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "custom=2");

    const step: Locator = page
      .locator("[data-rbd-draggable-id]")
      .filter({ has: picker(page, 0) });
    await expect(step).toContainText("Allowed range: 1–300 seconds.");

    // The timeouts are folded under the step's More fields.
    await step
      .getByTestId("runbook-step-0-more-fields")
      .getByRole("button", { expanded: false })
      .first()
      .click();

    const timeout: Locator = step.getByLabel(EXECUTION_TIMEOUT_LABEL);
    await timeout.fill("600");
    await expect(step).toContainText("Maximum is 300 seconds (5 minutes).");
    await expect(step).toContainText(
      "Values outside the range are clamped when the step runs.",
    );

    // On one of the project's own Runners, the step may run for an hour.
    await (await openPicker(page, 0))
      .filter({ hasText: "prod-eu-west-1" })
      .click();
    await expect(step).toContainText("Allowed range: 1–3600 seconds.");
    await expect(step).not.toContainText("Maximum is 300 seconds");
  });

  test("a step with nothing to pick links to Runbooks › Runners in a new tab, and a Runner added there is offered on coming back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "custom=0");

    const box: Locator = page.getByTestId(
      "runbook-step-1-runner-nothing-to-pick",
    );
    const link: Locator = box.getByRole("link", { name: "Runbooks › Runners" });
    await expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/runbooks/runners`,
    );
    await expect(link).toHaveAttribute("target", "_blank");

    // A Runner is added in the other tab; the person comes back to this one.
    await page.evaluate((): void => {
      (
        window as unknown as { __fixture: { addCustomRunner: () => void } }
      ).__fixture.addCustomRunner();
      window.dispatchEvent(new Event("focus"));
    });

    await expect(box).toHaveCount(0);
    await expect(await openPicker(page, 1)).toHaveText([
      "new-runner · Connected",
    ]);
    // Nothing was saved behind the person's back.
    expect((await recorded(page)).updates).toEqual([]);
  });

  test("while no global Runner is connected, a step on Global Runner says it fails if none picks it up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "gstatus=disconnected");

    await expect(picker(page, 0)).toContainText("Global Runner · Disconnected");
    await expect(
      page.getByTestId("runbook-step-0-runner-global-waiting"),
    ).toHaveText(
      "No global Runner is connected right now. The step fails if none picks it up within its claim timeout.",
    );

    // Connected: no warning.
    await openSteps(page, "");
    await expect(picker(page, 0)).toContainText(GLOBAL_CHOICE);
    await expect(
      page.getByTestId("runbook-step-0-runner-global-waiting"),
    ).toHaveCount(0);
  });
});

test.describe("the line under each folded step says where it runs", () => {
  async function foldedSteps(page: Page, search: string): Promise<Locator> {
    await page.goto(`${STEPS_PAGE}?page=steps${search ? `&${search}` : ""}`);
    const headers: Locator = page.getByTestId("runbook-step-header");
    await expect(headers).toHaveCount(2);
    return headers;
  }

  test("a JavaScript step on Global Runner, and a Bash step that still needs a Runner", async ({
    page,
  }: {
    page: Page;
  }) => {
    const headers: Locator = await foldedSteps(page, "custom=2");

    await expect(headers.nth(0)).toContainText("JavaScript on Global Runner");
    await expect(headers.nth(1)).toContainText("Bash script, needs a Runner");
    await expect(page.getByText(OLD_FOLDED_LINE)).toHaveCount(0);
    await screenshot(page, "steps-folded");
  });

  test("picking one of the project's own names it when the step is folded again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openSteps(page, "custom=2");

    await (await openPicker(page, 0))
      .filter({ hasText: "prod-eu-west-1" })
      .click();
    await page
      .getByTestId("runbook-step-header")
      .filter({ hasText: "Look up the status page" })
      .getByRole("button", { expanded: true })
      .click();

    await expect(
      page
        .getByTestId("runbook-step-header")
        .filter({ hasText: "Look up the status page" }),
    ).toContainText("JavaScript on prod-eu-west-1");
  });

  test("a project that turned global Runners off: the JavaScript step needs a Runner too", async ({
    page,
  }: {
    page: Page;
  }) => {
    const headers: Locator = await foldedSteps(page, "uses=0&custom=1");

    await expect(headers.nth(0)).toContainText("JavaScript, needs a Runner");
  });

  test("in German, the line is said in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    const headers: Locator = await foldedSteps(page, "lang=de&custom=1");

    await expect(headers.nth(0)).toContainText(
      GERMAN["JavaScript on {{runner}}"]!.replace(
        "{{runner}}",
        GERMAN["Global Runner"]!,
      ),
    );
    await expect(headers.nth(1)).toContainText(
      GERMAN["Bash script, needs a Runner"]!,
    );
  });
});

test.describe("which secret variables global Runners may use", () => {
  async function createSecret(page: Page, search: string): Promise<Locator> {
    await page.goto(`${VARIABLES_PAGE}?page=variables&${search}`);
    await page.getByRole("button", { name: "Create Variable" }).first().click();
    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    await modal.getByPlaceholder("PROD_DB_SSH_KEY").fill("WEBHOOK_TOKEN");
    await modal
      .getByPlaceholder("A password, a token, a private key or a kubeconfig")
      .fill("a-token-for-the-webhook");
    await modal.getByTestId("modal-footer-next-button").click();
    return modal;
  }

  test("the list says which secrets global Runners may use, and a new one starts usable by them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${VARIABLES_PAGE}?page=variables&custom=1`);
    const table: Locator = page.getByTestId("card");
    await expect(
      table.getByRole("row").filter({ hasText: "STATUSPAGE_TOKEN" }),
    ).toContainText("Global Runners");
    await expect(
      table.getByRole("row").filter({ hasText: "DB_PASSWORD" }),
    ).not.toContainText("Global Runners");

    const modal: Locator = await createSecret(page, "custom=1");
    const globalSwitch: Locator = modal.getByRole("switch", {
      name: /Global Runners can use it/,
    });
    await expect(globalSwitch).toHaveAttribute("aria-checked", "true");
    await expect(modal).toContainText(
      "Steps of this project that run on a global Runner get this secret. Steps of other projects never do.",
    );
    await expect(modal).toContainText("Your Runners that can use it");
    await screenshot(page, "secret-access-step");

    await modal.getByTestId("modal-footer-submit-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).creates.length;
      })
      .toBe(1);
    const created: Recorded["creates"][number] = (await recorded(page))
      .creates[0]!;
    expect(created.model).toBe("RunbookVariable");
    expect(created.data["isSecret"]).toBe(true);
    expect(created.data["isAvailableToGlobalRunners"]).toBe(true);
  });

  test("in a project that turned global Runners off, a new secret starts closed to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    const modal: Locator = await createSecret(page, "uses=0&custom=1");

    await expect(
      modal.getByRole("switch", { name: /Global Runners can use it/ }),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("on a server with no global Runner, nobody is asked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${VARIABLES_PAGE}?page=variables&global=0&custom=1`);
    await expect(
      page.getByRole("columnheader", { name: "Runners" }),
    ).toBeVisible();

    const modal: Locator = await createSecret(page, "global=0&custom=1");
    await expect(modal).toContainText("Your Runners that can use it");
    await expect(
      modal.getByRole("switch", { name: /Global Runners can use it/ }),
    ).toHaveCount(0);
  });
});

/*
 * The maintainer's ask: "Remove Runs AI Code Fixes from here, and in the
 * Code Repo section, we should be able to select a runner to run from (if
 * not selected, it will run on global runner)." A Runner says no more
 * than what it may run; the repositories that pick it are listed on its
 * page, each linked to the repository's settings in Code, where the pick
 * is made.
 */
test.describe("a Runner and AI code fixes", () => {
  test("Create Runner asks what the Runner may run, and AI code fixes are not one of its switches", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page);
    await card(page, "Custom Runners")
      .getByRole("button", { name: "Create Runner" })
      .first()
      .click();

    const modal: Locator = page.getByTestId("modal");
    await expect(modal).toBeVisible();
    await modal
      .getByRole("textbox", { name: /Name/ })
      .first()
      .fill("db-runner");
    await modal.getByRole("button", { name: "Next", exact: true }).click();

    // The Capabilities step: what the Runner may run, and nothing about code.
    await expect(modal).toContainText("Runs Runbooks");
    await expect(modal).toContainText("Runs AI Remediation Commands");
    await expect(modal).not.toContainText("Runs AI Code Fixes");
    await expect(modal).not.toContainText("pull requests");
    await screenshot(page, "create-runner-capabilities");

    await modal.getByTestId("modal-footer-submit-button").click();
    await expect
      .poll(async (): Promise<number> => {
        return (await recorded(page)).creates.length;
      })
      .toBe(1);

    const created: Recorded["creates"][number] = (await recorded(page))
      .creates[0]!;
    expect(created.model).toBe("Runner");
    expect(created.data["name"]).toBe("db-runner");
    expect(created.data["canRunRunbooks"]).toBe(true);
    expect(Object.keys(created.data)).not.toContain("canRunCodeFixTasks");
  });

  test("the Runners list shows no AI code fix capability", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openRunners(page, "custom=2");

    const customCard: Locator = card(page, "Custom Runners");
    await expect(customCard.locator("tbody tr")).toHaveCount(2);
    await expect(customCard).toContainText("Runbooks");
    await expect(customCard).not.toContainText("AI code fixes");
  });

  test("a Runner's page lists the code repositories that pick it, each linked to its settings in Code", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${RUNNER_PAGE}?page=runner&custom=1`);

    const repositories: Locator = card(page, "Code Repositories");
    await expect(repositories).toBeVisible();
    await expect(repositories).toContainText(
      "AI works in these repositories on this Runner.",
    );
    const link: Locator = repositories.getByRole("link", {
      name: "checkout-service",
    });
    await expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories/${CHECKOUT_REPOSITORY_ID}/settings`,
    );
    // A repository that picks no Runner works on a global Runner: not listed.
    await expect(repositories).not.toContainText("web-app");

    // The Runner's details say what it may run, and nothing about code fixes.
    const details: Locator = card(page, "Runner Details");
    await expect(details).toContainText("Runs Runbooks");
    await expect(details).not.toContainText("Runs AI Code Fixes");
    await screenshot(page, "runner-code-repositories");
  });

  test("no repository picks it: the card says so, and where a repository picks it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${RUNNER_PAGE}?page=runner&custom=1&picks=0`);

    await expect(page.getByTestId("runner-code-repositories-empty")).toHaveText(
      "No code repository picks this Runner. To have AI work in a repository on it, pick it in the repository's settings in Code.",
    );
    await expect(card(page, "Code Repositories").getByRole("link")).toHaveCount(
      0,
    );
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
      GERMAN[SWITCH_CARD]!,
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
