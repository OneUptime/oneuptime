import {
  expect,
  Locator,
  Page,
  Route as PlaywrightRoute,
  test,
} from "@playwright/test";
import fs from "fs/promises";
import path from "path";

/*
 * A LOGS, TRACES, EXCEPTIONS OR METRICS MONITOR, SET UP AS ONE RULE.
 *
 * The maintainer: "Setting up monitors like log traces, metrics, exceptions,
 * etc., is stupidly difficult and very complicated to understand and use.
 * Can you please make sure the monitor creation is simple to understand and
 * use? Simplify the UI."
 *
 * The criteria step of such a monitor now asks what it should tell you
 * about (a recipe such as Too many errors or Logs stop), what to watch, When
 * to alert - a condition, a number and a window, said back in one sentence
 * over a chart of what the rule would have caught - and What happens. The
 * production Create page, Tailwind build and Theme.css, against the offline
 * fixture (Fixture/Fixture.js), which answers the rule's preview: what only
 * a browser shows is checked here - what sits where, what fits a phone, dark
 * mode, German and Persian - and what Create Monitor sends.
 *
 * The same guards as every spec of this fixture: a network fence, no
 * uncaught page errors, and no request the fixture does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

const WHITE_RGB: string = "rgb(255, 255, 255)";

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const abortedRequests: Map<Page, Array<string>> = new Map();

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

  const unhandled: Array<unknown> = await page
    .evaluate((): Array<unknown> => {
      const state: { unhandled?: Array<unknown> } | undefined = (
        window as unknown as {
          __monitorOverviewFixture?: { unhandled?: Array<unknown> };
        }
      ).__monitorOverviewFixture;
      return JSON.parse(
        JSON.stringify(state?.unhandled || []),
      ) as Array<unknown>;
    })
    .catch((): Array<unknown> => {
      return [];
    });
  expect(unhandled, "requests the fixture does not model").toEqual([]);
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fs.mkdir(SCREENSHOTS, { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function createsRecorded(page: Page): Promise<Array<RecordedCreate>> {
  return page.evaluate((): Array<RecordedCreate> => {
    const state: { creates?: Array<RecordedCreate> } | undefined = (
      window as unknown as {
        __monitorOverviewFixture?: { creates?: Array<RecordedCreate> };
      }
    ).__monitorOverviewFixture;
    return JSON.parse(
      JSON.stringify(state?.creates || []),
    ) as Array<RecordedCreate>;
  });
}

/*
 * Create Monitor on this type (the link names it), named, on its criteria
 * step: the rule editor drawn and its preview read.
 */
async function openCriteria(
  page: Page,
  data: {
    type: string;
    name: string;
    query?: string;
    // The name field's placeholder, in the page's language.
    namePlaceholder?: string;
  },
): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(
    `${CREATE_PATH}?monitorType=${data.type}${data.query ? `&${data.query}` : ""}`,
  );
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("card-select-summary")).toBeVisible({
    timeout: 30000,
  });

  await form
    .locator(`input[placeholder='${data.namePlaceholder || "Monitor Name"}']`)
    .fill(data.name);
  await form.getByTestId("form-next-button").click();

  await expect(page.getByTestId("telemetry-rule-editor")).toBeVisible({
    timeout: 60000,
  });

  return form;
}

async function previewSettled(page: Page): Promise<void> {
  await expect(page.getByTestId("telemetry-rule-preview")).toBeVisible({
    timeout: 30000,
  });
}

function recipe(page: Page, key: string): Locator {
  return page.getByTestId(`card-select-option-${key}`);
}

function sentence(page: Page): Locator {
  return page.getByTestId("telemetry-rule-sentence");
}

// The stored step of what Create Monitor sent.
function firstStepOf(create: RecordedCreate): Record<string, unknown> {
  const steps: Record<string, unknown> = create.data["monitorSteps"] as Record<
    string,
    unknown
  >;
  const value: Record<string, unknown> =
    (steps["value"] as Record<string, unknown>) || steps;
  const step: Record<string, unknown> = (
    value["monitorStepsInstanceArray"] as Array<Record<string, unknown>>
  )[0]!;

  return (step["value"] as Record<string, unknown>) || step;
}

function criteriaOf(
  step: Record<string, unknown>,
): Array<Record<string, unknown>> {
  const criteria: Record<string, unknown> = step["monitorCriteria"] as Record<
    string,
    unknown
  >;
  const value: Record<string, unknown> =
    (criteria["value"] as Record<string, unknown>) || criteria;

  return (
    value["monitorCriteriaInstanceArray"] as Array<Record<string, unknown>>
  ).map((instance: Record<string, unknown>) => {
    return (instance["value"] as Record<string, unknown>) || instance;
  });
}

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow, "the page scrolls sideways").toBeLessThanOrEqual(0);
}

test.describe("A Logs monitor's criteria step", () => {
  test("asks what it should tell you about, Too many errors picked, its rule said back over what it would have caught", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    await openCriteria(page, { type: "Logs", name: "Checkout logs" });

    await expect(
      page.getByText("What should this monitor tell you about?", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(recipe(page, "error-logs")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    for (const key of ["log-message", "logs-stop", "custom"]) {
      await expect(recipe(page, key)).toHaveAttribute("aria-checked", "false");
    }

    // What to watch: the severities the recipe picked, the text left empty.
    await expect(
      page.getByText("Logs to watch", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("Error", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      page.getByText("Fatal", { exact: true }).first(),
    ).toBeVisible();

    // When to alert: one sentence, over the counts of the last hours.
    await expect(sentence(page)).toHaveText(
      "Alerts when the number of matching logs in 5 minutes is more than 10.",
    );
    await previewSettled(page);
    await expect(page.getByTestId("telemetry-rule-preview-verdict")).toHaveText(
      "This rule would have alerted 1 time, for 5 minutes.",
    );
    await expect(page.getByTestId("telemetry-rule-preview")).toContainText(
      "Matching logs in each 5 minutes, over the last 12 hours.",
    );

    // What happens: an alert, titled for the monitor and the recipe.
    await expect(
      page.getByRole("radio", { name: /Create an alert/ }),
    ).toBeChecked();
    await expect(
      page.getByTestId("telemetry-rule-alert").locator("input").first(),
    ).toHaveValue("Checkout logs: too many errors");

    // The old criteria editor is not on the page.
    await expect(
      page.getByText("Monitor Criteria", { exact: true }),
    ).toHaveCount(0);

    await screenshot(page, "telemetry-rule-logs");
  });

  test("the preview's suggestion becomes the rule's number", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    await openCriteria(page, { type: "Logs", name: "Checkout logs" });
    await previewSettled(page);

    const suggestion: Locator = page.getByTestId(
      "telemetry-rule-preview-use-suggestion",
    );
    const label: string = (await suggestion.textContent()) || "";
    const suggested: string = label.replace("Use", "").trim();

    expect(Number(suggested)).toBeGreaterThan(40);

    await suggestion.click();

    await expect(page.getByTestId("telemetry-rule-threshold")).toHaveValue(
      suggested,
    );
    await expect(page.getByTestId("telemetry-rule-preview-verdict")).toHaveText(
      "This rule would not have alerted in this time.",
    );
  });

  test("Logs stop: silence over 10 minutes declares an incident, and Create Monitor sends that rule", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCriteria(page, {
      type: "Logs",
      name: "Checkout logs",
    });

    await recipe(page, "logs-stop").click();

    await expect(recipe(page, "logs-stop")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(sentence(page)).toHaveText(
      "Alerts when no matching logs arrive in 10 minutes.",
    );
    await expect(
      page.getByRole("radio", { name: /Declare an incident/ }),
    ).toBeChecked();
    await expect(
      page.getByTestId("telemetry-rule-incident").locator("input").first(),
    ).toHaveValue("Checkout logs: logs stopped");

    await form.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("Logs");

    const step: Record<string, unknown> = firstStepOf(creates[0]!);
    expect(step["logMonitor"]).toMatchObject({
      lastXSecondsOfLogs: 600,
      severityTexts: [],
    });

    const criteria: Array<Record<string, unknown>> = criteriaOf(step);
    expect(criteria).toHaveLength(1);
    expect(criteria[0]).toMatchObject({
      createIncidents: true,
      createAlerts: false,
      changeMonitorStatus: true,
      filters: [{ checkOn: "Log Count", filterType: "Equal To", value: 0 }],
    });
  });

  test("after a walk back to Monitor Info and another type, Traces starts on its own recipe", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCriteria(page, {
      type: "Logs",
      name: "Checkout",
    });

    await expect(recipe(page, "error-logs")).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Back to Monitor Info, another type, and forward again.
    await form.getByText("Monitor Info", { exact: true }).first().click();
    await page.getByTestId("card-select-change").click();
    await page.getByTestId("card-select-search").fill("Traces");
    await page.getByTestId("card-select-option-Traces").click();
    await form.getByTestId("form-next-button").click();

    await expect(page.getByTestId("telemetry-rule-editor")).toBeVisible({
      timeout: 60000,
    });
    await expect(recipe(page, "failed-spans")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(sentence(page)).toHaveText(
      "Alerts when the number of matching spans in 5 minutes is more than 10.",
    );
    await expect(
      page.getByText("Spans to watch", { exact: true }),
    ).toBeVisible();
    await expect(
      page.getByTestId("telemetry-rule-alert").locator("input").first(),
    ).toHaveValue("Checkout: too many failed requests");
  });
});

test.describe("A Metrics monitor's criteria step", () => {
  test("asks for the value to compare with before the monitor is created", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCriteria(page, {
      type: "Metrics",
      name: "Queue depth",
    });

    await expect(
      page.getByText("Metric to watch", { exact: true }),
    ).toBeVisible();
    await expect(sentence(page)).toHaveText(
      "Alerts when the average of the metric over the last 5 minutes is above the value you enter.",
    );
    // No counts to preview for a metric: its own chart is above.
    await expect(page.getByTestId("telemetry-rule-preview")).toHaveCount(0);

    await form.getByTestId("Create Monitor").click();

    await expect(
      form.getByText("Enter the value to compare with."),
    ).toBeVisible();
    expect(await createsRecorded(page)).toEqual([]);

    await page.getByTestId("telemetry-rule-threshold").fill("80");
    await expect(sentence(page)).toHaveText(
      "Alerts when the average of the metric over the last 5 minutes is above 80.",
    );
  });
});

test.describe("The rule on a phone, in dark mode, in German and in Persian", () => {
  test("fits a phone: the fields one above the other, nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    await page.setViewportSize({ width: 390, height: 844 });
    await openCriteria(page, { type: "Logs", name: "Checkout logs" });
    await previewSettled(page);

    const condition: { y: number; x: number } | null = await page
      .getByTestId("telemetry-rule-comparison")
      .boundingBox();
    const value: { y: number; x: number } | null = await page
      .getByTestId("telemetry-rule-value")
      .boundingBox();

    expect(condition).not.toBeNull();
    expect(value).not.toBeNull();
    expect(value!.y).toBeGreaterThan(condition!.y);
    expect(Math.abs(value!.x - condition!.x)).toBeLessThan(2);

    await noSidewaysScroll(page);
    await screenshot(page, "telemetry-rule-logs-390");
  });

  test("dark mode: the sentence and the cards sit on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    await openCriteria(page, {
      type: "Logs",
      name: "Checkout logs",
      query: "theme=dark",
    });
    await previewSettled(page);

    for (const testId of [
      "telemetry-rule-sentence",
      "telemetry-rule-editor",
      "telemetry-rule-recipes",
    ]) {
      const background: string = await page
        .getByTestId(testId)
        .evaluate((element: Element): string => {
          let node: Element | null = element;
          while (node) {
            const color: string = getComputedStyle(node).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
              return color;
            }
            node = node.parentElement;
          }
          return "";
        });
      expect(background, testId).not.toBe(WHITE_RGB);
    }

    await screenshot(page, "telemetry-rule-logs-dark");
  });

  test("German: the questions and the sentence in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    await openCriteria(page, {
      type: "Logs",
      name: "Checkout logs",
      query: "lang=de",
      namePlaceholder: "Überwachungsname",
    });

    await expect(
      page.getByText("Worüber soll dieser Monitor Sie informieren?", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText("Wann alarmieren", { exact: true }),
    ).toBeVisible();
    await expect(sentence(page)).toHaveText(
      "Alarmiert, wenn die Zahl passender Logs in 5 Minuten mehr als 10 ist.",
    );
    await previewSettled(page);
    await noSidewaysScroll(page);

    await screenshot(page, "telemetry-rule-logs-de");
  });

  test("Persian: right to left, in Persian, on a phone too", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    await openCriteria(page, {
      type: "Logs",
      name: "Checkout logs",
      query: "lang=fa",
      namePlaceholder: "نام مانیتور",
    });

    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page.getByText("این مانیتور دربارهٔ چه چیزی به شما خبر بدهد؟", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(sentence(page)).not.toContainText("Alerts when");
    await previewSettled(page);

    await screenshot(page, "telemetry-rule-logs-fa");

    await page.setViewportSize({ width: 390, height: 844 });
    await noSidewaysScroll(page);
    await screenshot(page, "telemetry-rule-logs-fa-390");
  });
});
