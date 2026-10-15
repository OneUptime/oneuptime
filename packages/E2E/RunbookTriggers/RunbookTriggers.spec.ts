import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * A runbook's Triggers page in a browser, against the offline fixture
 * (RunbookTriggers/Fixture): setting up a schedule through its dialog -
 * menus, day buttons and a cron expression, by mouse and by keyboard -
 * pausing it, turning the webhook on, its masked URL, Copy URL, Send Test
 * Request and Reset URL; who may see the URL; a phone, dark mode and
 * German; and how a run started by a schedule or a webhook says so.
 *
 * The maintainer's ask: "Can you build an option that can help me execute
 * Runbook with a webhook or on schedule? ... Make the UI easy to understand
 * and simple to use." The fixture records every save, key read and reset
 * and webhook call the page makes, so the tests check what was sent as well
 * as what was drawn.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-0000000000a1";
const RUNBOOK_ID: string = "20000000-0000-4000-8000-0000000000b1";
const RUNBOOK_PATH: string = `/dashboard/${PROJECT_ID}/runbooks/${RUNBOOK_ID}`;
const TRIGGERS: string = `${RUNBOOK_PATH}/triggers`;
const FIRST_KEY: string = "q8Lz3VwN0rT5yH2kP7mC4xB9sD1fG6jA0eR3uI8oW5n";
const SECOND_KEY: string = "Xc7Vb2Nm5Lk8Jh1Gf4Ds6Aq9Wz3Ex0Rt7Yu2Io5Pp8l";
const TEST_RUN_ID: string = "40000000-0000-4000-8000-0000000000d9";

// The fixture's page names the runbook service as the Dashboard does: HOST + /runbook.
const WEBHOOK_PREFIX: string = `http://localhost/runbook/webhook/${RUNBOOK_ID}/`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/runbook-triggers-ui",
);

interface Recorded {
  updates: Array<Record<string, unknown>>;
  keyReads: number;
  keyResets: number;
  webhookCalls: Array<{
    url: string;
    data: Record<string, unknown>;
    headers: Record<string, string>;
  }>;
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
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function openTriggers(page: Page, search: string = ""): Promise<void> {
  await page.goto(`${TRIGGERS}${search ? `?${search}` : ""}`);
  await expect(page.getByTestId("runbook-webhook-card")).toBeVisible();
  await expect(page.getByTestId("runbook-schedule-card")).toBeVisible();
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __fixture: Recorded }).__fixture;
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog");
}

function preview(page: Page): Locator {
  return page.getByTestId("runbook-schedule-preview");
}

async function pick(page: Page, menu: string, option: string): Promise<void> {
  await dialog(page).getByRole("combobox", { name: menu }).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

test.describe("setting up a schedule", () => {
  test("every 2 hours at :30, saved as its cron with the browser's zone, and turned on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page);

    const empty: Locator = page.getByTestId("runbook-schedule-empty");
    await expect(empty).toContainText("No schedule yet");
    await expect(
      empty.getByRole("link", { name: "How schedules work" }),
    ).toHaveAttribute("href", "/docs/runbooks/triggers#run-on-a-schedule");

    await empty.getByRole("button", { name: "Set Up Schedule" }).click();
    await expect(dialog(page)).toBeVisible();
    // It starts on something that works: every weekday at 09:00, here.
    await expect(preview(page)).toContainText("Runs every weekday at 09:00");
    await expect(preview(page)).toContainText("Times are in Europe/London.");

    await pick(page, "Repeat", "Every few hours");
    await pick(page, "Every", "2 hours");
    await pick(page, "Minutes past the hour", ":30");
    await expect(preview(page)).toContainText("Runs every 2 hours at :30");
    await expect(
      preview(page).getByTestId("runbook-schedule-next-runs").locator("li"),
    ).toHaveCount(3);
    await screenshot(page, "schedule-dialog-hours");

    await dialog(page).getByRole("button", { name: "Save Schedule" }).click();
    await expect(dialog(page)).toBeHidden();

    expect((await recorded(page)).updates).toEqual([
      {
        scheduleCron: "30 */2 * * *",
        scheduleTimezone: "Europe/London",
        scheduleOverlapPolicy: "Skip",
        scheduleMissedRunPolicy: "RunOnce",
        isScheduleEnabled: true,
      },
    ]);

    const card: Locator = page.getByTestId("runbook-schedule-card");
    await expect(page.getByTestId("runbook-schedule-switch")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(card).toContainText(
      "Runs every 2 hours at :30 · Europe/London",
    );
    await expect(
      card.getByTestId("runbook-schedule-next-runs").locator("li"),
    ).toHaveCount(3);
    await screenshot(page, "schedule-card");
  });

  test("days are pressed by mouse or keyboard, and the sentence follows", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page);
    await page.getByRole("button", { name: "Set Up Schedule" }).click();

    const monday: Locator = page.getByTestId("runbook-schedule-field-day-1");
    await expect(monday).toHaveAttribute("aria-pressed", "true");

    await monday.focus();
    await page.keyboard.press("Space");
    await expect(monday).toHaveAttribute("aria-pressed", "false");
    await expect(preview(page)).toContainText(
      "Runs every Tuesday, Wednesday, Thursday and Friday at 09:00",
    );

    await page.getByTestId("runbook-schedule-field-day-6").click();
    await expect(preview(page)).toContainText(
      "Runs every Tuesday, Wednesday, Thursday, Friday and Saturday at 09:00",
    );

    await page.getByTestId("runbook-schedule-field-every-day").click();
    await expect(preview(page)).toContainText("Runs every day at 09:00");

    await page.getByTestId("runbook-schedule-field-time").fill("17:45");
    await expect(preview(page)).toContainText("Runs every day at 17:45");

    await dialog(page).getByRole("button", { name: "Save Schedule" }).click();
    await expect(dialog(page)).toBeHidden();
    expect((await recorded(page)).updates[0]!["scheduleCron"]).toBe(
      "45 17 * * 0,1,2,3,4,5,6",
    );
  });

  test("a cron expression that cannot run is explained, and not saved", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page);
    await page.getByRole("button", { name: "Set Up Schedule" }).click();
    await pick(page, "Repeat", "Custom (cron expression)");

    const cron: Locator = page.getByTestId("runbook-schedule-field-cron");
    // It starts from the schedule picked so far.
    await expect(cron).toHaveValue("0 9 * * 1,2,3,4,5");

    await cron.fill("0 9 * *");
    await expect(preview(page).getByRole("alert")).toContainText(
      "A runbook schedule has five fields - minute, hour, day of month, month and day of week - and this one has 4.",
    );
    await screenshot(page, "schedule-dialog-cron-error");

    await dialog(page).getByRole("button", { name: "Save Schedule" }).click();
    await expect(dialog(page)).toBeVisible();
    expect((await recorded(page)).updates).toEqual([]);

    await cron.fill("0 3 1 * *");
    await expect(preview(page)).toContainText(
      "Runs on the cron schedule 0 3 1 * *",
    );
    await dialog(page).getByRole("button", { name: "Save Schedule" }).click();
    await expect(dialog(page)).toBeHidden();
    expect((await recorded(page)).updates[0]!["scheduleCron"]).toBe(
      "0 3 1 * *",
    );
  });

  test("a schedule is paused and turned back on with its switch alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "schedule=weekdays");

    const theSwitch: Locator = page.getByTestId("runbook-schedule-switch");
    await theSwitch.click();
    await expect(page.getByTestId("runbook-schedule-card")).toContainText(
      "Paused. Nothing runs on this schedule until you turn it on.",
    );
    await expect(page.getByTestId("runbook-schedule-next-runs")).toHaveCount(0);

    await theSwitch.click();
    await expect(page.getByTestId("runbook-schedule-card")).toContainText(
      "Runs every weekday at 09:00 · Europe/London",
    );

    expect((await recorded(page)).updates).toEqual([
      { isScheduleEnabled: false },
      { isScheduleEnabled: true },
    ]);
  });
});

test.describe("the webhook", () => {
  test("turned on: the URL is masked until shown, and Copy URL copies all of it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page
      .context()
      .grantPermissions(["clipboard-read", "clipboard-write"]);
    await openTriggers(page);

    await expect(page.getByTestId("runbook-webhook-card")).toContainText(
      "Turn it on to get a URL that starts this runbook.",
    );
    await page.getByTestId("runbook-webhook-switch").click();

    const url: Locator = page.getByTestId("runbook-webhook-url");
    await expect(url).toBeVisible();
    expect((await recorded(page)).updates).toEqual([
      { isWebhookEnabled: true },
    ]);
    await expect(url).toHaveAttribute("data-url-shown", "false");
    await expect(url).not.toContainText(FIRST_KEY);
    await expect(page.getByTestId("runbook-webhook-curl")).not.toContainText(
      FIRST_KEY,
    );
    await screenshot(page, "webhook-on");

    await page.getByRole("button", { name: "Copy the webhook URL" }).click();
    expect(
      await page.evaluate(async (): Promise<string> => {
        return await navigator.clipboard.readText();
      }),
    ).toBe(`${WEBHOOK_PREFIX}${FIRST_KEY}`);

    await page.getByTestId("runbook-webhook-url-visibility").click();
    await expect(url).toHaveText(`${WEBHOOK_PREFIX}${FIRST_KEY}`);
    await expect(page.getByTestId("runbook-webhook-curl")).toContainText(
      `curl -X POST "${WEBHOOK_PREFIX}${FIRST_KEY}"`,
    );
    await expect(
      page.getByRole("link", { name: "How to call it" }),
    ).toHaveAttribute("href", "/docs/runbooks/triggers#call-the-webhook");
  });

  test("Send Test Request posts the body as another tool would, and its run says what it was sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "webhook=on");

    await page.getByTestId("runbook-webhook-test").click();
    const body: Locator = dialog(page).getByRole("textbox", {
      name: /Request body/,
    });
    await expect(body).toBeVisible();
    await body.fill('{"host": "web-2", "reason": "Load test"}');
    await screenshot(page, "webhook-test-dialog");
    await dialog(page).getByRole("button", { name: "Send Request" }).click();
    await expect(dialog(page)).toBeHidden();

    const calls: Recorded["webhookCalls"] = (await recorded(page)).webhookCalls;
    expect(calls).toEqual([
      {
        url: `${WEBHOOK_PREFIX}${FIRST_KEY}`,
        data: { host: "web-2", reason: "Load test" },
        // No session, no project: the URL alone starts the run.
        headers: {},
      },
    ]);

    const result: Locator = page.getByTestId("runbook-webhook-test-result");
    await expect(result).toContainText("The webhook started a run.");
    await result.getByRole("link", { name: "View the run" }).click();

    await expect(page).toHaveURL(
      new RegExp(`${RUNBOOK_PATH}/executions/${TEST_RUN_ID}`),
    );
    await expect(page.getByTestId("runbook-run-trigger")).toContainText(
      "Webhook",
    );
    await expect(page.getByTestId("runbook-run-trigger")).toContainText(
      "From 127.0.0.1",
    );
    const inputs: Locator = page.getByTestId("runbook-run-inputs");
    await expect(inputs).toContainText('"host": "web-2"');
    await expect(inputs).toContainText('"reason": "Load test"');
    await screenshot(page, "webhook-run-page");
  });

  test("a refused test request is said in the dialog, which stays open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "webhook=on&test=refused");

    await page.getByTestId("runbook-webhook-test").click();
    await dialog(page).getByRole("button", { name: "Send Request" }).click();

    await expect(dialog(page)).toContainText(
      "This runbook is turned off, so it was not started.",
    );
    await expect(page).toHaveURL(new RegExp(`${TRIGGERS}`));
    await expect(page.getByTestId("runbook-webhook-test-result")).toHaveCount(
      0,
    );
  });

  test("Reset URL asks first; then the old URL is gone and the new one is shown", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "webhook=on");
    await expect(page.getByTestId("runbook-webhook-url")).toBeVisible();

    await page.getByTestId("runbook-webhook-reset-url").click();
    await expect(dialog(page)).toContainText("Reset the webhook URL?");
    await dialog(page).getByRole("button", { name: "Cancel" }).click();
    expect((await recorded(page)).keyResets).toBe(0);

    await page.getByTestId("runbook-webhook-reset-url").click();
    await dialog(page).getByRole("button", { name: "Reset URL" }).click();
    await expect(dialog(page)).toBeHidden();

    expect((await recorded(page)).keyResets).toBe(1);
    await expect(
      page.getByTestId("runbook-webhook-url-reset-done"),
    ).toBeVisible();
    await page.getByTestId("runbook-webhook-url-visibility").click();
    await expect(page.getByTestId("runbook-webhook-url")).toHaveText(
      `${WEBHOOK_PREFIX}${SECOND_KEY}`,
    );
  });

  test("a turned-off runbook says calls are refused, and so does its schedule", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "webhook=on&schedule=weekdays&runbook=off");

    await expect(page.getByTestId("runbook-webhook-card")).toContainText(
      "This runbook is turned off, so calls to this URL are refused. Turn it on under Settings.",
    );
    await expect(page.getByTestId("runbook-schedule-card")).toContainText(
      "This runbook is turned off, so its schedule starts nothing. Turn it on under Settings.",
    );
  });
});

test.describe("who may set triggers up", () => {
  test("someone who may edit the runbook but not run it sees neither the URL nor a way to set one up", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "role=editor&webhook=on&schedule=weekdays");

    await expect(page.getByTestId("runbook-webhook-url-hidden")).toContainText(
      "only people who may edit and run this runbook can see it",
    );
    await expect(page.getByTestId("runbook-webhook-url")).toHaveCount(0);
    expect((await recorded(page)).keyReads).toBe(0);

    const edit: Locator = page.getByRole("button", { name: "Edit Schedule" });
    await expect(edit).toBeDisabled();
    await edit.hover({ force: true });
    await expect(page.getByRole("tooltip")).toContainText(
      "Setting up a schedule takes permission to edit this runbook and to run it.",
    );

    // Turning a trigger off starts nothing, so it stays open to them.
    await page.getByTestId("runbook-schedule-switch").click();
    expect((await recorded(page)).updates).toEqual([
      { isScheduleEnabled: false },
    ]);
    await screenshot(page, "editor");
  });

  test("someone who may only read runbooks cannot touch either trigger", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "role=viewer&webhook=on&schedule=weekdays");

    await expect(page.getByTestId("runbook-schedule-switch")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(page.getByTestId("runbook-webhook-switch")).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await page.getByTestId("runbook-webhook-switch").click({ force: true });
    expect((await recorded(page)).updates).toEqual([]);
  });
});

test.describe("on every screen", () => {
  test("a phone: nothing runs off the screen, and the dialog fits it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTriggers(page, "webhook=on&schedule=weekdays");

    const overflow: number = await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);
    await screenshot(page, "phone");

    await page.getByRole("button", { name: "Edit Schedule" }).click();
    const box: { x: number; width: number } | null =
      await dialog(page).boundingBox();
    expect(box).not.toBeNull();
    expect(box!.x).toBeGreaterThanOrEqual(0);
    expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  });

  test("dark mode draws the cards dark", async ({ page }: { page: Page }) => {
    await openTriggers(page, "webhook=on&schedule=weekdays&theme=dark");

    const background: string = await page
      .getByTestId("runbook-webhook-url")
      .evaluate((element: Element): string => {
        return getComputedStyle(element).backgroundColor;
      });
    expect(background).not.toBe("rgb(255, 255, 255)");
    await screenshot(page, "dark");
  });

  test("in German, the schedule is said in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTriggers(page, "lang=de");

    await page.getByRole("button", { name: "Zeitplan einrichten" }).click();
    await expect(preview(page)).toContainText(
      "Läuft an jedem Wochentag um 09:00",
    );
    await expect(preview(page)).toContainText("Alle Zeiten in Europe/London.");
    await screenshot(page, "german-dialog");
  });
});

test.describe("what started a run", () => {
  test("the Executions list says Webhook and Schedule, with who called and when it was due", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${RUNBOOK_PATH}/executions?page=executions`);

    const rows: Locator = page.locator("tbody tr");
    await expect(rows).toHaveCount(4);
    await expect(rows.nth(0)).toContainText("Webhook");
    await expect(rows.nth(0)).toContainText("From 203.0.113.24");
    await expect(rows.nth(1)).toContainText("Schedule");
    await expect(rows.nth(1)).toContainText("Due at");
    await expect(rows.nth(2)).toContainText(
      "Run once to make up for times OneUptime missed",
    );
    await expect(rows.nth(3)).toContainText("Manual run by");
    await screenshot(page, "executions");
  });

  test("a webhook run's page shows what it was sent, as text", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${RUNBOOK_PATH}/executions?page=execution`);

    await expect(page.getByTestId("runbook-run-trigger")).toContainText(
      "From 203.0.113.24",
    );
    const inputs: Locator = page.getByTestId("runbook-run-inputs");
    await expect(inputs).toContainText('"severity": "critical"');
    await expect(inputs.locator("pre code")).toHaveCount(1);
  });
});
