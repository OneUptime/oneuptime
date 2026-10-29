import { BASE_URL } from "../../Config";
import { Browser, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  JSONish,
  getItem,
  listItems,
  pollUntil,
} from "./Helpers/MonitorAlerting";
import {
  clickCreateUntilMonitorView,
  clickNext,
  createMonitor,
  waitForCriteriaStepReady,
} from "./Helpers/Monitors";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import {
  createTelemetryIngestionKey,
  postOtlpLogs,
  postOtlpMetrics,
  postOtlpTraces,
} from "./Helpers/Telemetry";

/*
 * Logs, Traces, Exceptions and Metrics monitors, set up the way a person
 * sets them up in Create Monitor - from what they want to know ("A message
 * appears", "Too many failed requests", a metric above a line) - then
 * stored, then fed real OTLP telemetry, and alerting.
 *
 * Each test: the form (the recipe, When to alert, What happens), what the
 * API stores for it (one rule: one criteria, its filter, the alert it
 * opens, the window on the step), then telemetry that matches, sent to the
 * /otlp endpoints with a real ingestion key, and the alert the monitor
 * opens for it, within a few of its one-minute evaluations.
 *
 * To run locally against a full stack:
 *
 *   cd packages/E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/TelemetryMonitorRules.spec.ts --project=chromium
 */

test.describe.configure({ mode: "serial" });

// The monitor's page, where Create Monitor lands, with the monitor's id.
const MONITOR_ID_IN_URL: RegExp = /\/monitors\/([0-9a-f-]{36})/i;

// How long a monitor's one-minute evaluations get to see the telemetry.
const ALERT_TIMEOUT_MS: number = 6 * 60 * 1000;

interface Context {
  page: Page;
  projectId: string;
  ingestionKey: string;
  // One run's names, so nothing here matches another run's telemetry.
  runId: string;
}

let ctx: Context;

test.beforeAll(async ({ browser }: { browser: Browser }) => {
  test.setTimeout(600000);

  const page: Page = await browser.newPage();
  const projectId: string = await registerAndCreateProject({
    page,
    projectNamePrefix: "E2E Telemetry Rules",
  });
  const ingestionKey: string = await createTelemetryIngestionKey({
    page,
    projectId,
    keyName: "E2E telemetry rules",
  });

  ctx = {
    page,
    projectId,
    ingestionKey,
    runId: Faker.generateRandomString(8).toLowerCase(),
  };
});

test.afterAll(async () => {
  await ctx?.page.close();
});

function monitorIdFrom(page: Page): string {
  const match: RegExpMatchArray | null = page.url().match(MONITOR_ID_IN_URL);
  expect(match, "landed on the new monitor's page").not.toBeNull();
  return match![1]!;
}

async function readMonitor(monitorId: string): Promise<JSONish> {
  return getItem({
    page: ctx.page,
    projectId: ctx.projectId,
    path: "/api/monitor",
    id: monitorId,
    select: { _id: true, name: true, monitorType: true, monitorSteps: true },
  });
}

/*
 * The first step of a monitor as the API returns it: the steps are a
 * MonitorSteps JSON value, { _type, value: { monitorStepsInstanceArray } }.
 */
function firstStep(monitor: JSONish): JSONish {
  const steps: JSONish = monitor["monitorSteps"] as JSONish;
  const value: JSONish = (steps["value"] as JSONish) || steps;
  const step: JSONish = (
    value["monitorStepsInstanceArray"] as Array<JSONish>
  )[0]!;
  return (step["value"] as JSONish) || step;
}

function criteriaOf(step: JSONish): Array<JSONish> {
  const criteria: JSONish = step["monitorCriteria"] as JSONish;
  const value: JSONish = (criteria["value"] as JSONish) || criteria;
  return (value["monitorCriteriaInstanceArray"] as Array<JSONish>).map(
    (instance: JSONish) => {
      return (instance["value"] as JSONish) || instance;
    },
  );
}

/*
 * The one rule the form stored: one criteria, one filter, opening one
 * alert that resolves itself.
 */
function expectOneAlertRule(data: {
  monitor: JSONish;
  checkOn: string;
  filterType: string;
  value: number;
}): JSONish {
  const criteria: Array<JSONish> = criteriaOf(firstStep(data.monitor));

  expect(criteria).toHaveLength(1);

  const rule: JSONish = criteria[0]!;
  const filters: Array<JSONish> = rule["filters"] as Array<JSONish>;

  expect(filters).toHaveLength(1);
  expect(filters[0]).toMatchObject({
    checkOn: data.checkOn,
    filterType: data.filterType,
  });
  expect(Number(filters[0]!["value"])).toBe(data.value);
  expect(rule["createAlerts"]).toBe(true);
  expect(rule["createIncidents"]).toBe(false);

  const alerts: Array<JSONish> = rule["alerts"] as Array<JSONish>;
  expect(alerts.length).toBeGreaterThan(0);
  expect(alerts[0]!["autoResolveAlert"]).toBe(true);

  return rule;
}

// Waits for the monitor's first alert, sending the telemetry until it opens.
async function waitForAlert(data: {
  monitorId: string;
  send: () => Promise<void>;
}): Promise<JSONish> {
  let lastSentAt: number = 0;

  return pollUntil<JSONish>({
    page: ctx.page,
    description: `an alert on monitor ${data.monitorId}`,
    timeoutMs: ALERT_TIMEOUT_MS,
    intervalMs: 5000,
    check: async (): Promise<JSONish | null> => {
      // Keep the telemetry inside the rule's window until it alerts.
      if (Date.now() - lastSentAt > 30000) {
        lastSentAt = Date.now();
        await data.send();
      }

      const alerts: Array<JSONish> = await listItems({
        page: ctx.page,
        projectId: ctx.projectId,
        path: "/api/alert",
        query: { monitorId: data.monitorId },
        select: { _id: true, title: true },
        limit: 5,
      });

      return alerts.length > 0 ? alerts[0]! : null;
    },
  });
}

test("a Logs monitor made from 'A message appears' alerts when that message is logged", async () => {
  test.setTimeout(ALERT_TIMEOUT_MS + 240000);

  const page: Page = ctx.page;
  const message: string = `payment declined ${ctx.runId}`;
  const monitorName: string = `E2E logs rule ${ctx.runId}`;

  const monitorId: string = await createMonitor({
    page,
    projectId: ctx.projectId,
    monitorName,
    recipe: {
      label: "Logs",
      cardValue: "Logs",
      hasInterval: false,
      fillCriteria: async ({ page: formPage }: { page: Page }) => {
        // What should this monitor tell you about? A message appears.
        await formPage.getByTestId("card-select-option-log-message").click();
        await expect(
          formPage.getByTestId("card-select-option-log-message"),
        ).toHaveAttribute("aria-checked", "true");

        await formPage.getByPlaceholder("payment declined").fill(message);

        // The rule a message needs: more than none, in 5 minutes.
        await expect(
          formPage.getByTestId("telemetry-rule-sentence"),
        ).toHaveText("Alerts when any matching log arrives in 5 minutes.");
        await expect(
          formPage.getByRole("radio", { name: /Create an alert/ }),
        ).toBeChecked();
      },
    },
  });

  expect(monitorId).not.toBe("");

  const monitor: JSONish = await readMonitor(monitorId);
  expect(monitor["monitorType"]).toBe("Logs");

  const step: JSONish = firstStep(monitor);
  expect(step["logMonitor"]).toMatchObject({
    body: message,
    lastXSecondsOfLogs: 300,
    severityTexts: [],
  });

  const rule: JSONish = expectOneAlertRule({
    monitor,
    checkOn: "Log Count",
    filterType: "Greater Than",
    value: 0,
  });
  expect((rule["alerts"] as Array<JSONish>)[0]!["title"]).toBe(
    `${monitorName}: a matching log arrived`,
  );

  const alert: JSONish = await waitForAlert({
    monitorId,
    send: async () => {
      await postOtlpLogs({
        page,
        ingestionKey: ctx.ingestionKey,
        serviceName: `e2e-rules-${ctx.runId}`,
        body: `Order 1042: ${message} by the bank`,
      });
    },
  });

  expect(alert["title"]).toBe(`${monitorName}: a matching log arrived`);
});

test("a Traces monitor made from 'Too many failed requests' alerts on failed spans", async () => {
  test.setTimeout(ALERT_TIMEOUT_MS + 240000);

  const page: Page = ctx.page;
  const spanName: string = `POST /api/checkout-${ctx.runId}`;
  const monitorName: string = `E2E traces rule ${ctx.runId}`;

  const monitorId: string = await createMonitor({
    page,
    projectId: ctx.projectId,
    monitorName,
    recipe: {
      label: "Traces",
      cardValue: "Traces",
      hasInterval: false,
      fillCriteria: async ({ page: formPage }: { page: Page }) => {
        // The first recipe is already picked: failed requests.
        await expect(
          formPage.getByTestId("card-select-option-failed-spans"),
        ).toHaveAttribute("aria-checked", "true");

        await formPage.getByPlaceholder("POST /api/checkout").fill(spanName);

        // Any failed request at all, for this run.
        const value: Locator = formPage.getByTestId("telemetry-rule-threshold");
        await value.fill("0");
        await expect(
          formPage.getByTestId("telemetry-rule-sentence"),
        ).toHaveText("Alerts when any matching span arrives in 5 minutes.");
      },
    },
  });

  const monitor: JSONish = await readMonitor(monitorId);
  expect(firstStep(monitor)["traceMonitor"]).toMatchObject({
    spanName,
    lastXSecondsOfSpans: 300,
    spanStatuses: [2],
  });
  expectOneAlertRule({
    monitor,
    checkOn: "Span Count",
    filterType: "Greater Than",
    value: 0,
  });

  // A successful span is not counted...
  await postOtlpTraces({
    page,
    ingestionKey: ctx.ingestionKey,
    serviceName: `e2e-rules-${ctx.runId}`,
    spanName,
    statusCode: 1,
  });

  // ...a failed one is.
  const alert: JSONish = await waitForAlert({
    monitorId,
    send: async () => {
      await postOtlpTraces({
        page,
        ingestionKey: ctx.ingestionKey,
        serviceName: `e2e-rules-${ctx.runId}`,
        spanName,
        statusCode: 2,
      });
    },
  });

  expect(alert["title"]).toBe(`${monitorName}: too many failed requests`);
});

test("an Exceptions monitor made from 'Any exception' alerts when that exception is thrown", async () => {
  test.setTimeout(ALERT_TIMEOUT_MS + 240000);

  const page: Page = ctx.page;
  const exceptionType: string = `CheckoutTimeoutError${ctx.runId}`;
  const monitorName: string = `E2E exceptions rule ${ctx.runId}`;

  const monitorId: string = await createMonitor({
    page,
    projectId: ctx.projectId,
    monitorName,
    recipe: {
      label: "Exceptions",
      cardValue: "Exceptions",
      hasInterval: false,
      fillCriteria: async ({ page: formPage }: { page: Page }) => {
        await expect(
          formPage.getByTestId("card-select-option-any-exception"),
        ).toHaveAttribute("aria-checked", "true");

        await formPage
          .getByPlaceholder("TypeError, NullReferenceException")
          .fill(exceptionType);
        await expect(
          formPage.getByTestId("telemetry-rule-sentence"),
        ).toHaveText(
          "Alerts when any matching exception happens in 5 minutes.",
        );
      },
    },
  });

  const monitor: JSONish = await readMonitor(monitorId);
  expect(firstStep(monitor)["exceptionMonitor"]).toMatchObject({
    exceptionTypes: [exceptionType],
    lastXSecondsOfExceptions: 300,
  });
  expectOneAlertRule({
    monitor,
    checkOn: "Exception Count",
    filterType: "Greater Than",
    value: 0,
  });

  const alert: JSONish = await waitForAlert({
    monitorId,
    send: async () => {
      await postOtlpTraces({
        page,
        ingestionKey: ctx.ingestionKey,
        serviceName: `e2e-rules-${ctx.runId}`,
        spanName: `GET /cart-${ctx.runId}`,
        statusCode: 2,
        exception: {
          type: exceptionType,
          message: "The payment provider did not answer in time",
        },
      });
    },
  });

  expect(alert["title"]).toBe(`${monitorName}: an exception happened`);
});

test("a Metrics monitor made from a metric chart's Create monitor alerts above its value", async () => {
  test.setTimeout(ALERT_TIMEOUT_MS + 240000);

  const page: Page = ctx.page;
  const metricName: string = `e2e.queue.depth.${ctx.runId}`;

  // The metric arrives first, as it would before anyone charts it.
  await postOtlpMetrics({
    page,
    ingestionKey: ctx.ingestionKey,
    serviceName: `e2e-rules-${ctx.runId}`,
    metricName,
  });

  // The chart's Create monitor: its query rides in the link.
  const createUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${ctx.projectId}/monitors/create`)
    .toString();
  const query: string = encodeURIComponent(
    JSON.stringify([{ metricName, variable: "a", aggregationType: "Avg" }]),
  );

  await gotoProjectPage({
    page,
    projectId: ctx.projectId,
    url: `${createUrl}?metricQueries=${query}`,
    ready: page.locator("#create-monitor-form"),
  });

  const nameInput: Locator = page.locator(
    "#create-monitor-form input[placeholder='Monitor Name']",
  );
  await expect(nameInput).toHaveValue(`${metricName} Monitor`, {
    timeout: 60000,
  });

  await clickNext({ page });
  await waitForCriteriaStepReady({ page });

  // A chart's Create monitor starts on the average above a value to enter.
  await expect(page.getByTestId("telemetry-rule-sentence")).toContainText(
    "over the last 5 minutes is above the value you enter",
    { timeout: 30000 },
  );
  await page.getByTestId("telemetry-rule-threshold").fill("10");
  await expect(page.getByTestId("telemetry-rule-sentence")).toContainText(
    "is above 10",
  );

  await clickCreateUntilMonitorView({ page, projectId: ctx.projectId });
  const monitorId: string = monitorIdFrom(page);

  const monitor: JSONish = await readMonitor(monitorId);
  expect(monitor["monitorType"]).toBe("Metrics");

  const rule: JSONish = expectOneAlertRule({
    monitor,
    checkOn: "Metric Value",
    filterType: "Greater Than",
    value: 10,
  });
  expect(rule["filters"] as Array<JSONish>).toEqual([
    expect.objectContaining({
      metricMonitorOptions: expect.objectContaining({
        metricAggregationType: "Average",
      }),
    }),
  ]);

  // The fixture's gauge reads 42: above 10.
  const alert: JSONish = await waitForAlert({
    monitorId,
    send: async () => {
      await postOtlpMetrics({
        page,
        ingestionKey: ctx.ingestionKey,
        serviceName: `e2e-rules-${ctx.runId}`,
        metricName,
      });
    },
  });

  expect(alert["title"]).toBe(`${metricName} Monitor: metric above the limit`);
});
