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
 * THE EXTERNAL STATUS PAGE MONITOR'S PROVIDERS, IN A REAL BROWSER.
 *
 * Issue #5176: a customer watches another team's OneUptime status page and
 * wants each resource's status, and "under maintenance" while a scheduled
 * maintenance event affects it. The monitor now reads OneUptime status pages
 * as a provider of their own (OneUptime Status Page), and Auto finds them.
 *
 * The production Create page (Pages/Monitor/Create) and its External Status
 * Page step (ExternalStatusPageMonitorStepForm, MonitorCriteria), against the
 * offline fixture (Fixture/Fixture.js). What only a browser shows is checked
 * here: the Provider list a person opens and what fits on a desktop and a
 * phone; and, start to finish, the steps the docs give for showing upstream
 * maintenance on your monitor, down to what Create Monitor sends.
 *
 * The same guards as the other specs here: a network fence, no uncaught
 * page errors, and no request the fixture does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";
// The fixture's first probe, "Frankfurt (eu-central-1)".
const FRANKFURT_PROBE_ID: string = "73000000-0000-4000-8000-000000000001";

/*
 * The Provider dropdown's options, in the order a person reads them: the
 * enum's (ExternalStatusPageProviderType), Auto, the default, last.
 */
const PROVIDERS: Array<string> = [
  "Atlassian Statuspage",
  "incident.io",
  "OneUptime Status Page",
  "RSS",
  "Atom",
  "Auto",
];

const PROVIDER_DESCRIPTION: string =
  "How OneUptime reads this status page. 'Auto' detects the format for you.";
const GROUP_FILTER_DESCRIPTION: string =
  "Only watch one component group, e.g. 'APIs'. RSS and Atom feeds have no groups.";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | null;
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

async function noSidewaysScroll(page: Page): Promise<void> {
  const overflow: number = await page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
  expect(overflow, "the page does not scroll sideways").toBeLessThanOrEqual(0);
}

async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(box, "the element is laid out").not.toBeNull();

  return box!;
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

// Every object in a JSON value that has the key, depth first.
function objectsWithKey(
  value: unknown,
  key: string,
): Array<Record<string, unknown>> {
  if (Array.isArray(value)) {
    return value.flatMap((item: unknown): Array<Record<string, unknown>> => {
      return objectsWithKey(item, key);
    });
  }

  if (!value || typeof value !== "object") {
    return [];
  }

  const record: Record<string, unknown> = value as Record<string, unknown>;
  const nested: Array<Record<string, unknown>> = Object.values(record).flatMap(
    (item: unknown): Array<Record<string, unknown>> => {
      return objectsWithKey(item, key);
    },
  );

  return key in record ? [record, ...nested] : nested;
}

/*
 * Create Monitor on an External Status Page monitor, named, on its second
 * step: the status page's address, its provider and More fields.
 */
async function openStatusPageStep(page: Page): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${CREATE_PATH}?monitorType=External%20Status%20Page`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("card-select-summary")).toContainText(
    "External Status Page",
    { timeout: 30000 },
  );

  await form
    .locator("input[placeholder='Monitor Name']")
    .fill("Platform team status");
  await form.getByRole("button", { name: "Next", exact: true }).click();

  await expect(
    form.getByText(PROVIDER_DESCRIPTION, { exact: true }),
  ).toBeVisible({ timeout: 60000 });

  return form;
}

// The Provider field: its label, its one line, and its dropdown.
function providerField(form: Locator): Locator {
  return form
    .getByText(PROVIDER_DESCRIPTION, { exact: true })
    .locator("xpath=ancestor::div[.//*[@role='combobox']][1]");
}

async function openProviders(page: Page, form: Locator): Promise<Locator> {
  await providerField(form).getByRole("combobox").click();
  const list: Locator = page.getByRole("listbox");
  await expect(list).toBeVisible();
  return list;
}

async function optionTexts(list: Locator): Promise<Array<string>> {
  return (await list.getByRole("option").allInnerTexts()).map(
    (text: string): string => {
      return text.trim();
    },
  );
}

test.describe("Create Monitor: an External Status Page monitor's provider", () => {
  test("offers OneUptime Status Page between incident.io and the feeds, and says what Auto does", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const form: Locator = await openStatusPageStep(page);

    // Auto until a person picks another.
    await expect(
      providerField(form).locator(".ou-select__single-value"),
    ).toHaveText("Auto");

    const list: Locator = await openProviders(page, form);
    expect(await optionTexts(list)).toEqual(PROVIDERS);

    const oneUptime: Locator = list.getByRole("option", {
      name: "OneUptime Status Page",
      exact: true,
    });
    await expect(oneUptime).toBeInViewport();
    await screenshot(page, "external-status-page-providers-1280");

    await oneUptime.click();
    await expect(page.getByRole("listbox")).toHaveCount(0);
    await expect(
      providerField(form).locator(".ou-select__single-value"),
    ).toHaveText("OneUptime Status Page");

    // The group filter waits under More fields, and says which providers have groups.
    const moreFields: Locator = page.getByTestId(
      "external-status-page-monitor-more-fields",
    );
    await expect(
      form.getByText(GROUP_FILTER_DESCRIPTION, { exact: true }),
    ).toBeHidden();
    await moreFields.getByTestId("folded-section-header").click();
    await expect(
      form.getByText(GROUP_FILTER_DESCRIPTION, { exact: true }),
    ).toBeVisible();

    // The filters' titles say "(Optional)" once, not "(Optional) (Optional)".
    for (const title of [
      "Component Group Filter (Optional)",
      "Component Name Filter (Optional)",
    ]) {
      await expect(moreFields.locator("label", { hasText: title })).toHaveText(
        title,
      );
    }

    await screenshot(page, "external-status-page-oneuptime-1280");
  });

  test("fits a phone: the provider list and More fields stay inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const form: Locator = await openStatusPageStep(page);
    await noSidewaysScroll(page);

    const description: { x: number; width: number } = await boxOf(
      form.getByText(PROVIDER_DESCRIPTION, { exact: true }),
    );
    expect(description.x).toBeGreaterThanOrEqual(0);
    expect(description.x + description.width).toBeLessThanOrEqual(390);

    const list: Locator = await openProviders(page, form);
    expect(await optionTexts(list)).toEqual(PROVIDERS);

    for (const name of PROVIDERS) {
      const option: { x: number; width: number } = await boxOf(
        list.getByRole("option", { name: name, exact: true }),
      );
      expect({ name: name, left: option.x >= 0 }).toEqual({
        name: name,
        left: true,
      });
      expect({ name: name, right: option.x + option.width <= 390 }).toEqual({
        name: name,
        right: true,
      });
    }

    await expect(
      list.getByRole("option", { name: "OneUptime Status Page", exact: true }),
    ).toBeInViewport();
    await screenshot(page, "external-status-page-providers-390");

    await list
      .getByRole("option", { name: "OneUptime Status Page", exact: true })
      .click();

    await page
      .getByTestId("external-status-page-monitor-more-fields")
      .getByTestId("folded-section-header")
      .click();
    const groupFilter: { x: number; width: number } = await boxOf(
      form.getByText(GROUP_FILTER_DESCRIPTION, { exact: true }),
    );
    expect(groupFilter.x).toBeGreaterThanOrEqual(0);
    expect(groupFilter.x + groupFilter.width).toBeLessThanOrEqual(390);
    await noSidewaysScroll(page);

    await screenshot(page, "external-status-page-oneuptime-390");
  });

  /*
   * The docs' "Show upstream maintenance on your monitor": Add Criteria,
   * External Status Page Component Status, Equal To, Under Maintenance -
   * and the criteria the monitor is created with compares the component
   * status the probe reports, under_maintenance.
   */
  test("start to finish: a OneUptime status page, its group, and a criteria for its maintenance", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const form: Locator = await openStatusPageStep(page);

    await form
      .getByPlaceholder("https://status.example.com", { exact: true })
      .fill("https://status.platform.acme-commerce.example");

    await (await openProviders(page, form))
      .getByRole("option", { name: "OneUptime Status Page", exact: true })
      .click();

    await page
      .getByTestId("external-status-page-monitor-more-fields")
      .getByTestId("folded-section-header")
      .click();
    await form.getByPlaceholder("e.g. APIs", { exact: true }).fill("Core");

    // Add Criteria opens the new criteria, to be filled in.
    await form
      .getByRole("button", { name: "Add Criteria", exact: true })
      .click();

    const filterType: Locator = page
      .getByRole("combobox", { name: "Filter Type", exact: true })
      .last();
    await expect(filterType).toBeVisible();
    await filterType.click();
    await page
      .getByRole("option", {
        name: "External Status Page Component Status",
        exact: true,
      })
      .click();

    const condition: Locator = page
      .getByRole("combobox", { name: "Filter Condition", exact: true })
      .last();
    await condition.click();
    await page.getByRole("option", { name: "Equal To", exact: true }).click();

    const value: Locator = page
      .getByRole("combobox", { name: "Value", exact: true })
      .last();
    await value.click();
    // The component statuses a status page reports, Under Maintenance among them.
    const statuses: Array<string> = await optionTexts(
      page.getByRole("listbox"),
    );
    expect(statuses).toContain("Under Maintenance");
    await page
      .getByRole("option", { name: "Under Maintenance", exact: true })
      .click();

    await screenshot(page, "external-status-page-maintenance-criteria-1280");

    await form.getByRole("button", { name: "Next", exact: true }).click();

    const probes: Locator = page.getByRole("combobox", { name: /^Probes/ });
    await expect(probes).toBeVisible({ timeout: 30000 });
    await probes.click();
    await page
      .getByRole("option", { name: "Frankfurt (eu-central-1)", exact: true })
      .click();
    await page.keyboard.press("Escape");

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.data["monitorType"]).toBe("External Status Page");
    expect(creates[0]!.data["name"]).toBe("Platform team status");
    expect(creates[0]!.miscDataProps?.["probes"]).toEqual([FRANKFURT_PROBE_ID]);

    const steps: unknown = creates[0]!.data["monitorSteps"];
    const statusPages: Array<Record<string, unknown>> = objectsWithKey(
      steps,
      "statusPageUrl",
    );
    expect(statusPages).toHaveLength(1);
    expect(statusPages[0]).toMatchObject({
      statusPageUrl: "https://status.platform.acme-commerce.example",
      provider: "OneUptime Status Page",
      componentGroupName: "Core",
    });

    const filters: Array<Record<string, unknown>> = objectsWithKey(
      steps,
      "checkOn",
    );
    expect(
      filters.filter((filter: Record<string, unknown>): boolean => {
        return (
          filter["checkOn"] === "External Status Page Component Status" &&
          filter["filterType"] === "Equal To" &&
          filter["value"] === "under_maintenance"
        );
      }),
    ).toHaveLength(1);
  });
});
