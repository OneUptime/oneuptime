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
 * Issue #5156: a page's components, picked in the Components field from the
 * page's own list (read in the browser, modelled here for a vendor's
 * Atlassian Statuspage), sent with the monitor, and a page that could not be
 * read, read again with Try again.
 *
 * Then what a check found (SummaryView/ExternalStatusPageMonitorView): the
 * Summary card of the fixture's External Status Page monitor, which watches
 * the Core group of another team's OneUptime status page while one of its
 * resources is under maintenance, and the same view in Monitoring Logs'
 * View Summary dialog - two widths of container at one screen width. With
 * ?components=chosen it watches two chosen components of the group.
 *
 * The same guards as the other specs here: a network fence, no uncaught
 * page errors, and no request the fixture does not model; and here, no
 * React markup warning (validateDOMNesting) either.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";
// The fixture's first probe, "Frankfurt (eu-central-1)".
const FRANKFURT_PROBE_ID: string = "73000000-0000-4000-8000-000000000001";
// The fixture's External Status Page monitor, "Platform team status".
const STATUS_PAGE_MONITOR_PATH: string = `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-000000000011`;

/*
 * The Provider dropdown's options, in the order a person reads them: Auto,
 * the default most monitors keep, first; then the enum's
 * (ExternalStatusPageProviderType).
 */
const PROVIDERS: Array<string> = [
  "Auto",
  "Atlassian Statuspage",
  "incident.io",
  "OneUptime Status Page",
  "RSS",
  "Atom",
];

const PROVIDER_DESCRIPTION: string =
  "How OneUptime reads this status page. 'Auto' detects the format for you.";
const GROUP_FILTER_DESCRIPTION: string =
  "Only watch one component group, e.g. 'APIs'. RSS and Atom feeds have no groups.";

/*
 * The Components field (ExternalStatusPageComponentsField, issue #5156): the
 * components of the page the monitor watches, picked from the page's own
 * list, which the browser reads when the field is opened.
 */
const COMPONENTS_FIELD_TEST_ID: string =
  "external-status-page-components-field";
const COMPONENTS_STATUS_TEST_ID: string =
  "external-status-page-components-status";
const COMPONENTS_UNMATCHED_TEST_ID: string =
  "external-status-page-components-unmatched";
const COMPONENTS_RETRY_TEST_ID: string =
  "external-status-page-components-retry";

/*
 * A vendor's Atlassian Statuspage, modelled in the browser: GitHub's shape
 * (issue #5156) - Git Operations and Pull Requests, a Copilot that is not
 * Copilot AI Model Providers, and an Automation group.
 */
const VENDOR_PAGE_URL: string = "https://status.vendor.example";
const VENDOR_HOST: string = "status.vendor.example";
const VENDOR_COMPONENTS: Record<string, unknown> = {
  page: { id: "vendor", name: "Vendor", url: VENDOR_PAGE_URL },
  components: [
    { id: "git", name: "Git Operations", status: "operational", group: false },
    { id: "prs", name: "Pull Requests", status: "operational", group: false },
    {
      id: "copilot",
      name: "Copilot",
      status: "degraded_performance",
      group: false,
    },
    {
      id: "models",
      name: "Copilot AI Model Providers",
      status: "operational",
      group: false,
    },
    {
      id: "automation",
      name: "Automation",
      status: "operational",
      group: true,
      components: ["actions", "webhooks"],
    },
    {
      id: "actions",
      name: "Actions",
      status: "operational",
      group: false,
      group_id: "automation",
    },
    {
      id: "webhooks",
      name: "Webhooks",
      status: "major_outage",
      group: false,
      group_id: "automation",
    },
  ],
};

// The criteria the docs' steps make, named after its filter's words.
const MAINTENANCE_CRITERIA_NAME: string =
  'External Status Page Component Status is "Under Maintenance"';

// What the probe says of a private OneUptime status page.
const PRIVATE_PAGE_MESSAGE: string =
  "This status page is private: only people who sign in to it, or who know its password, can read it. Only a public status page can be watched.";

// The digits of an "rgb(r, g, b)" colour.
const RGB_CHANNEL: RegExp = /\d+(\.\d+)?/g;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | null;
}

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
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
  /*
   * React's markup warnings arrive as console errors: a div inside a
   * paragraph (Icon draws a div) is markup a browser may not keep.
   */
  page.on("console", (message: { type: () => string; text: () => string }) => {
    if (
      message.type() === "error" &&
      message.text().includes("validateDOMNesting")
    ) {
      errors.push(message.text());
    }
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

async function boxOf(locator: Locator): Promise<Box> {
  const box: Box | null = await locator.boundingBox();

  expect(box, "the element is laid out").not.toBeNull();

  return box!;
}

// Relative luminance of an "rgb(r, g, b)" colour, 0 (black) to 1 (white).
function luminance(rgb: string): number {
  const channels: Array<number> = (rgb.match(RGB_CHANNEL) || [])
    .slice(0, 3)
    .map((value: string): number => {
      const channel: number = Number(value) / 255;
      return channel <= 0.03928
        ? channel / 12.92
        : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
  return (
    0.2126 * (channels[0] || 0) +
    0.7152 * (channels[1] || 0) +
    0.0722 * (channels[2] || 0)
  );
}

async function backgroundColor(locator: Locator): Promise<string> {
  return locator.evaluate((element: Element): string => {
    return getComputedStyle(element).backgroundColor;
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

// The Provider dropdown, by the name its label gives it.
function providerBox(form: Locator): Locator {
  return form.getByRole("combobox", { name: "Provider", exact: true });
}

// The react-select control around the Provider dropdown.
function providerControl(form: Locator): Locator {
  return providerBox(form).locator(
    "xpath=ancestor::div[contains(@class, 'ou-select__control')][1]",
  );
}

async function openProviders(page: Page, form: Locator): Promise<Locator> {
  await providerBox(form).click();
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

// The Components field's box, named by its label ("Components (Optional)").
function componentsBox(form: Locator): Locator {
  return form.getByRole("combobox", { name: /^Components/ });
}

interface VendorPage {
  // Off: every request to the page fails, as when the browser cannot reach it.
  reachable: boolean;
  // Each request the browser made of the page: its path and its headers.
  requests: Array<{ path: string; headers: Record<string, string> }>;
}

/*
 * The vendor's status page, as the browser reaches it: Atlassian's
 * components.json, and nothing else (the incident.io proxy and a OneUptime
 * page's summary are not found). Every answer lets any page read it, as
 * Statuspage's API does (Access-Control-Allow-Origin: *).
 */
async function serveVendorPage(page: Page): Promise<VendorPage> {
  const vendor: VendorPage = { reachable: true, requests: [] };

  await page.route(`${VENDOR_PAGE_URL}/**`, async (route: PlaywrightRoute) => {
    const url: URL = new URL(route.request().url());

    vendor.requests.push({
      path: url.pathname,
      headers: await route.request().allHeaders(),
    });

    if (!vendor.reachable) {
      await route.abort("failed");
      return;
    }

    const headers: Record<string, string> = {
      "access-control-allow-origin": "*",
      "content-type": "application/json",
    };

    if (url.pathname === "/api/v2/components.json") {
      await route.fulfill({
        status: 200,
        headers: headers,
        body: JSON.stringify(VENDOR_COMPONENTS),
      });
      return;
    }

    await route.fulfill({ status: 404, headers: headers, body: "{}" });
  });

  return vendor;
}

// An option's name: its first line, without the status under it.
async function optionNames(list: Locator): Promise<Array<string>> {
  return (await optionTexts(list)).map((text: string): string => {
    return (text.split("\n")[0] || "").trim();
  });
}

test.describe("Create Monitor: an External Status Page monitor's provider", () => {
  test("offers Auto first, then OneUptime Status Page between incident.io and the feeds, and says what Auto does", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const form: Locator = await openStatusPageStep(page);

    // Auto until a person picks another, and never empty: no clear button.
    await expect(
      providerControl(form).locator(".ou-select__single-value"),
    ).toHaveText("Auto");
    await expect(
      providerControl(form).locator(".ou-select__clear-indicator"),
    ).toHaveCount(0);

    // Always set, so its label says nothing of being optional.
    await expect(
      form.locator("label", { hasText: "Provider" }).first(),
    ).toHaveText("Provider");

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
      providerControl(form).locator(".ou-select__single-value"),
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

    /*
     * The components it watches are out in the form, not under More fields
     * (issue #5156): optional like the rest, and named by its label.
     */
    const componentsField: Locator = form.getByTestId(COMPONENTS_FIELD_TEST_ID);
    await expect(componentsField).toBeVisible();
    await expect(moreFields.getByTestId(COMPONENTS_FIELD_TEST_ID)).toHaveCount(
      0,
    );
    await expect(componentsField.locator("label").first()).toContainText(
      "Components (Optional)",
    );
    await expect(componentsBox(form)).toBeVisible();
    // The one name filter it replaced is gone.
    await expect(
      form.locator("label", { hasText: "Component Name Filter" }),
    ).toHaveCount(0);

    /*
     * Each optional field says "(Optional)" once, small and grey after its
     * title, the way Timeout and Retries do - not in the title's own words
     * - and its box is named by its label.
     */
    for (const title of ["Component Group Filter", "Timeout (ms)", "Retries"]) {
      const label: Locator = moreFields.locator("label", { hasText: title });
      await expect(label).toHaveText(`${title} (Optional)`);
      await expect(label.locator("span.text-gray-400")).toHaveText(
        "(Optional)",
      );
      await expect(
        moreFields.getByRole(
          title === "Retries" || title.startsWith("Timeout")
            ? "spinbutton"
            : "textbox",
          {
            name: `${title} (Optional)`,
            exact: true,
          },
        ),
      ).toBeVisible();
    }
    await expect(
      form.getByRole("textbox", { name: "Status Page URL", exact: true }),
    ).toBeVisible();

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

    const description: Box = await boxOf(
      form.getByText(PROVIDER_DESCRIPTION, { exact: true }),
    );
    expect(description.x).toBeGreaterThanOrEqual(0);
    expect(description.x + description.width).toBeLessThanOrEqual(390);

    const list: Locator = await openProviders(page, form);
    expect(await optionTexts(list)).toEqual(PROVIDERS);

    for (const name of PROVIDERS) {
      const option: Box = await boxOf(
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
    const groupFilter: Box = await boxOf(
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
   * status the probe reports, under_maintenance, under a name in the
   * dropdown's words.
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
      .getByRole("textbox", { name: "Status Page URL", exact: true })
      .fill("https://status.platform.acme-commerce.example");

    await (await openProviders(page, form))
      .getByRole("option", { name: "OneUptime Status Page", exact: true })
      .click();

    await page
      .getByTestId("external-status-page-monitor-more-fields")
      .getByTestId("folded-section-header")
      .click();
    await form
      .getByRole("textbox", {
        name: "Component Group Filter (Optional)",
        exact: true,
      })
      .fill("Core");

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

    // Named after its filter in the dropdown's words, not "under_maintenance".
    await expect(
      page.getByTestId("monitor-criteria-name-input").last(),
    ).toHaveValue(MAINTENANCE_CRITERIA_NAME);

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

    const criteriaNames: Array<unknown> = objectsWithKey(steps, "filters").map(
      (criteria: Record<string, unknown>): unknown => {
        return criteria["name"];
      },
    );
    expect(criteriaNames).toContain(MAINTENANCE_CRITERIA_NAME);
  });
});

/*
 * Issue #5156: a person depends on a few of a page's components (GitHub's
 * Git Operations and Pull Requests, not Copilot). Opened, the Components
 * field reads the page's own list - in this browser, carrying nothing of
 * OneUptime's - and offers it in the page's groups; the monitor is created
 * with the names picked.
 */
test.describe("Create Monitor: the components an External Status Page monitor watches", () => {
  /*
   * The fixture server's Content-Security-Policy (connect-src 'self') is a
   * second fence that would stop this browser's read of the vendor's page,
   * which the Dashboard makes in production (it sends no connect-src). The
   * network fence still holds: every request is either the fixture's or
   * the vendor page this test models.
   */
  test.use({ bypassCSP: true });

  test("picks from the page's own list, in its groups, and sends the chosen names", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(240000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const vendor: VendorPage = await serveVendorPage(page);
    const form: Locator = await openStatusPageStep(page);

    await form
      .getByRole("textbox", { name: "Status Page URL", exact: true })
      .fill(VENDOR_PAGE_URL);

    // Nothing is asked of the page until the list is opened.
    expect(vendor.requests).toEqual([]);

    await componentsBox(form).click();
    const list: Locator = page.getByRole("listbox");
    await expect(list).toBeVisible();

    const status: Locator = form.getByTestId(COMPONENTS_STATUS_TEST_ID);
    await expect(status).toHaveText(`6 components on ${VENDOR_HOST}.`);
    // Under the open list, out of sight rather than peeking above it.
    await expect(status).toBeHidden();

    // The page's order: its own components first, then each group's.
    expect(await optionNames(list)).toEqual([
      "Git Operations",
      "Pull Requests",
      "Copilot",
      "Copilot AI Model Providers",
      "Actions",
      "Webhooks",
    ]);
    await expect(list.locator(".ou-select__group-heading")).toHaveText([
      "Automation",
    ]);

    // A component that is not operational says how it is.
    await expect(
      list.getByRole("option").filter({ hasText: "Webhooks" }),
    ).toContainText("Major Outage");
    await expect(
      list.getByRole("option").filter({ hasText: "Git Operations" }),
    ).toHaveText("Git Operations");

    // Several are picked in a row: the list stays open for the next.
    await list
      .getByRole("option", { name: "Git Operations", exact: true })
      .click();
    await expect(list).toBeVisible();
    await list
      .getByRole("option", { name: "Pull Requests", exact: true })
      .click();

    await screenshot(page, "external-status-page-components-picked-1280");

    // A name the page does not list can be typed, and is said to watch nothing.
    await componentsBox(form).fill("Payments");
    await expect(
      list.getByRole("option", { name: "Add “Payments”", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Enter");
    await expect(form.getByTestId(COMPONENTS_UNMATCHED_TEST_ID)).toHaveText(
      "Not on this page, so not watched: Payments",
    );

    // A * stands for any text, and its row says what it watches.
    await componentsBox(form).fill("*Model*");
    await expect(
      list.getByRole("option", {
        name: "Watch every component that matches “*Model*”",
        exact: true,
      }),
    ).toBeVisible();
    await componentsBox(form).fill("");

    await page.keyboard.press("Escape");
    await expect(status).toBeVisible();
    const unmatched: Locator = form.getByTestId(COMPONENTS_UNMATCHED_TEST_ID);
    await expect(unmatched).toBeVisible();

    /*
     * The line to act on comes first, right under the box, then what was
     * read; and the box is described by it, so a screen reader hears it.
     */
    expect((await boxOf(unmatched)).y).toBeLessThan((await boxOf(status)).y);
    const unmatchedSentenceId: string | null = await unmatched
      .locator("span[id]")
      .getAttribute("id");
    expect(unmatchedSentenceId).toBeTruthy();
    expect(
      (
        (await componentsBox(form).getAttribute("aria-describedby")) || ""
      ).split(" "),
    ).toContain(unmatchedSentenceId);

    await form.getByRole("button", { name: "Remove Payments" }).click();
    await expect(form.getByTestId(COMPONENTS_UNMATCHED_TEST_ID)).toHaveCount(0);
    await expect(
      form
        .getByTestId(COMPONENTS_FIELD_TEST_ID)
        .getByTestId("dropdown-value-label"),
    ).toHaveText(["Git Operations", "Pull Requests"]);

    /*
     * Read once, in the probe's order - incident.io's proxy, then
     * Statuspage's components - and with nothing of OneUptime's: no
     * cookie, no referrer.
     */
    expect(
      vendor.requests.map((request: { path: string }): string => {
        return request.path;
      }),
    ).toEqual([`/proxy/${VENDOR_HOST}`, "/api/v2/components.json"]);
    for (const request of vendor.requests) {
      expect(request.headers["cookie"]).toBeUndefined();
      expect(request.headers["referer"]).toBeUndefined();
    }

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

    const statusPages: Array<Record<string, unknown>> = objectsWithKey(
      creates[0]!.data["monitorSteps"],
      "statusPageUrl",
    );
    expect(statusPages).toHaveLength(1);
    expect(statusPages[0]).toMatchObject({
      statusPageUrl: VENDOR_PAGE_URL,
      componentNames: ["Git Operations", "Pull Requests"],
    });
    // Two names: a probe that has not been upgraded watches the whole page.
    expect(statusPages[0]!["componentName"]).toBeUndefined();
  });

  test("says why a page could not be read, and reads it again with Try again", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const vendor: VendorPage = await serveVendorPage(page);
    vendor.reachable = false;

    const form: Locator = await openStatusPageStep(page);
    await form
      .getByRole("textbox", { name: "Status Page URL", exact: true })
      .fill(VENDOR_PAGE_URL);
    await componentsBox(form).click();

    const status: Locator = form.getByTestId(COMPONENTS_STATUS_TEST_ID);
    const why: string = `Could not load the components of ${VENDOR_HOST}. Type a component's name as the page shows it, then press Enter.`;
    await expect(status).toContainText(why);
    await expect(status).toHaveAttribute("data-problem", "NotRead");

    /*
     * The open menu says the same, as a paragraph that starts where the
     * options start: centred line by line, a phone's narrow menu set it as
     * a ragged column.
     */
    const notice: Locator = page.locator(".ou-select__menu-notice--no-options");
    await expect(notice).toHaveText(why);
    expect(
      await notice.evaluate((element: Element): string => {
        return getComputedStyle(element).textAlign;
      }),
    ).toBe("start");
    await page.keyboard.press("Escape");

    // On a phone, the sentence and Try again stay inside the screen.
    await noSidewaysScroll(page);
    const retry: Locator = form.getByTestId(COMPONENTS_RETRY_TEST_ID);
    const retryBox: Box = await boxOf(retry);
    expect(retryBox.x).toBeGreaterThanOrEqual(0);
    expect(retryBox.x + retryBox.width).toBeLessThanOrEqual(390);
    await screenshot(page, "external-status-page-components-failed-390");

    vendor.reachable = true;
    await retry.click();
    await expect(status).toHaveText(`6 components on ${VENDOR_HOST}.`);
    await expect(retry).toHaveCount(0);
  });
});

/*
 * ---------------------------------------------------------------------------
 * What a check of the status page found
 * ---------------------------------------------------------------------------
 */

async function openStatusPageMonitor(
  page: Page,
  query: string = "",
): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(
    `${STATUS_PAGE_MONITOR_PATH}?type=external-status-page${query ? `&${query}` : ""}`,
  );
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const summary: Locator = page.getByTestId("external-status-page-summary");
  await expect(summary).toBeVisible({ timeout: 60000 });
  return summary;
}

function components(summary: Locator): Locator {
  return summary.getByTestId("external-status-page-component");
}

/*
 * The facts of a grid that share its first row: two to a row in a narrow
 * container, four in a wide one.
 */
async function factsInFirstRow(grid: Locator): Promise<number> {
  const cards: Array<Box> = await grid
    .locator(":scope > *")
    .evaluateAll((elements: Array<Element>): Array<Box> => {
      return elements.map((element: Element): Box => {
        const rect: DOMRect = element.getBoundingClientRect();
        return {
          x: rect.x,
          y: rect.y,
          width: rect.width,
          height: rect.height,
        };
      });
    });

  return cards.filter((card: Box): boolean => {
    return Math.abs(card.y - cards[0]!.y) < 1;
  }).length;
}

// No fact's value runs past its card.
async function expectFactsFit(summary: Locator): Promise<void> {
  const overflowing: Array<string> = await summary
    .locator(
      "[data-testid='external-status-page-check-facts'] > *, [data-testid='external-status-page-page-facts'] > *",
    )
    .evaluateAll((cards: Array<Element>): Array<string> => {
      return cards
        .filter((card: Element): boolean => {
          return card.scrollWidth > card.clientWidth + 1;
        })
        .map((card: Element): string => {
          return (card.textContent || "").trim();
        });
    });

  expect(overflowing, "facts whose value runs past the card").toEqual([]);
}

test.describe("an External Status Page monitor's Summary", () => {
  /*
   * The overview's Summary card is two thirds of the page wide: the facts
   * go two to a row there, so overall status reads in one piece; each
   * component in scope is a row, its status at the row's end in the words
   * and colour of the Component Status criteria.
   */
  test("names each component's status in the criteria's words, the maintenance in progress among them", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const summary: Locator = await openStatusPageMonitor(page);

    const checkFacts: Locator = summary.getByTestId(
      "external-status-page-check-facts",
    );
    const pageFacts: Locator = summary.getByTestId(
      "external-status-page-page-facts",
    );
    await expect(checkFacts).toContainText("Frankfurt (eu-central-1)");
    await expect(checkFacts).toContainText("Online");
    await expect(pageFacts).toContainText("OneUptime Status Page");
    /*
     * The page's overall status in the same words and colour as its
     * components' (#5281), not the provider's raw "under_maintenance";
     * the raw value stays on the element, which the criteria compare.
     */
    const overall: Locator = pageFacts.getByTestId(
      "external-status-page-overall-status",
    );
    await expect(overall).toHaveText("Under Maintenance");
    await expect(overall).toHaveAttribute("data-status", "under_maintenance");
    await expect(pageFacts).not.toContainText("under_maintenance");
    await expect(pageFacts).toContainText("Group: Core");
    expect(await factsInFirstRow(checkFacts)).toBe(2);
    expect(await factsInFirstRow(pageFacts)).toBe(2);
    await expectFactsFit(summary);

    await expect(components(summary)).toHaveCount(2);
    await expect(
      summary.getByTestId("external-status-page-component-name"),
    ).toHaveText(["Checkout API", "Orders database"]);
    await expect(
      summary.getByTestId("external-status-page-component-status"),
    ).toHaveText(["Operational", "Under Maintenance"]);
    await expect(
      summary.getByTestId("external-status-page-component-status").nth(1),
    ).toHaveAttribute("data-status", "under_maintenance");

    /*
     * The group, then what the page says - unless it only repeats the
     * status: the Checkout API's "Operational" is said once.
     */
    await expect(
      summary.getByTestId("external-status-page-component-detail"),
    ).toHaveText([
      "Core / APIs",
      "Core / Databases · Under maintenance: Orders database upgrade",
    ]);

    // The status at the end of its row, on the name's line.
    for (let index: number = 0; index < 2; index++) {
      const row: Box = await boxOf(components(summary).nth(index));
      const status: Box = await boxOf(
        summary.getByTestId("external-status-page-component-status").nth(index),
      );
      const name: Box = await boxOf(
        summary.getByTestId("external-status-page-component-name").nth(index),
      );

      expect(row.x + row.width - (status.x + status.width)).toBeLessThan(24);
      expect(status.x).toBeGreaterThan(name.x + name.width);
    }

    await screenshot(page, "external-status-page-summary-1280");
  });

  test("on a phone, each status sits under its component's name, and nothing leaves the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const summary: Locator = await openStatusPageMonitor(page);
    await noSidewaysScroll(page);
    await expectFactsFit(summary);

    // One fact a row on a phone, every value whole (SummaryFacts).
    expect(
      await factsInFirstRow(
        summary.getByTestId("external-status-page-page-facts"),
      ),
    ).toBe(1);

    for (let index: number = 0; index < 2; index++) {
      const row: Box = await boxOf(components(summary).nth(index));
      const name: Box = await boxOf(
        summary.getByTestId("external-status-page-component-name").nth(index),
      );
      const status: Box = await boxOf(
        summary.getByTestId("external-status-page-component-status").nth(index),
      );

      expect(status.y).toBeGreaterThanOrEqual(name.y + name.height);
      expect(row.x).toBeGreaterThanOrEqual(0);
      expect(row.x + row.width).toBeLessThanOrEqual(390);
    }

    await screenshot(page, "external-status-page-summary-390");
  });

  /*
   * A page that went private: why comes right after the check's facts,
   * before what the page said (nothing), and no component list is drawn.
   */
  test("a private page says why, between the check and what the page said", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const summary: Locator = await openStatusPageMonitor(page, "state=offline");

    const error: Locator = summary.getByText(PRIVATE_PAGE_MESSAGE, {
      exact: true,
    });
    await expect(error).toBeVisible();
    await expect(
      summary.getByTestId("external-status-page-check-facts"),
    ).toContainText("Offline");
    await expect(components(summary)).toHaveCount(0);

    const checkFacts: Box = await boxOf(
      summary.getByTestId("external-status-page-check-facts"),
    );
    const errorBox: Box = await boxOf(error);
    const pageFacts: Box = await boxOf(
      summary.getByTestId("external-status-page-page-facts"),
    );

    expect(errorBox.y).toBeGreaterThan(checkFacts.y + checkFacts.height);
    expect(pageFacts.y).toBeGreaterThan(errorBox.y + errorBox.height);

    await screenshot(page, "external-status-page-summary-private-1280");
  });

  /*
   * The same view in a wide dialog: Monitoring Logs' View Summary. Its own
   * width, not the screen's, puts four facts to a row there - at the same
   * 1280px screen that gives the Summary card two.
   */
  test("View Summary in Monitoring Logs puts four facts to a row in its wide dialog", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.clock.setFixedTime(NOW);
    await page.goto(
      `${STATUS_PAGE_MONITOR_PATH}/logs?type=external-status-page`,
    );
    await expect(page.getByTestId("synthetic-banner")).toBeVisible({
      timeout: 60000,
    });

    await page
      .getByRole("button", { name: "View Summary" })
      .first()
      .click({ timeout: 60000 });
    const dialog: Locator = page.getByRole("dialog");
    const summary: Locator = dialog.getByTestId("external-status-page-summary");
    await expect(summary).toBeVisible();

    expect(
      await factsInFirstRow(
        summary.getByTestId("external-status-page-check-facts"),
      ),
    ).toBe(4);
    expect(
      await factsInFirstRow(
        summary.getByTestId("external-status-page-page-facts"),
      ),
    ).toBe(4);
    await expectFactsFit(summary);
    await expect(
      summary.getByTestId("external-status-page-component-status"),
    ).toHaveText(["Operational", "Under Maintenance"]);

    await screenshot(page, "external-status-page-view-summary-1280");
  });

  /*
   * Issue #5156: a monitor that watches two chosen components of the Core
   * group. Its Scope names them by count, Active Incidents says the
   * incident elsewhere on the page was not counted, and the chosen name
   * the page does not list is said to watch nothing - on a laptop, on a
   * phone and in the dark.
   */
  test("a monitor of chosen components says what it watches, what it left out, and the names the page does not list", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const summary: Locator = await openStatusPageMonitor(
      page,
      "components=chosen",
    );
    const pageFacts: Locator = summary.getByTestId(
      "external-status-page-page-facts",
    );

    await expect(pageFacts).toContainText("Core › 2 chosen components");
    await expect(
      summary.getByTestId("external-status-page-incidents-outside-scope"),
    ).toHaveText("1 more on the page, not counted");

    const unmatched: Locator = summary.getByTestId(
      "external-status-page-unmatched-components",
    );
    // The monitor watches the Core group: the name is missing from it.
    await expect(unmatched).toHaveText(
      "Not in Core, so not watched: Payments API",
    );
    await expect(
      summary.getByTestId("external-status-page-component-name"),
    ).toHaveText(["Checkout API"]);
    await expectFactsFit(summary);
    await screenshot(page, "external-status-page-summary-chosen-1280");

    await page.setViewportSize({ width: 390, height: 844 });
    await noSidewaysScroll(page);
    const note: Box = await boxOf(unmatched);
    expect(note.x).toBeGreaterThanOrEqual(0);
    expect(note.x + note.width).toBeLessThanOrEqual(390);
    await expectFactsFit(summary);
    await screenshot(page, "external-status-page-summary-chosen-390");

    const dark: Locator = await openStatusPageMonitor(
      page,
      "components=chosen&theme=dark",
    );
    const darkNote: Locator = dark.getByTestId(
      "external-status-page-unmatched-components",
    );
    expect(luminance(await backgroundColor(darkNote))).toBeLessThan(0.2);
    const noteColor: string = await darkNote.evaluate(
      (element: Element): string => {
        return getComputedStyle(element).color;
      },
    );
    expect(luminance(noteColor)).toBeGreaterThan(0.5);
    await screenshot(page, "external-status-page-summary-chosen-dark-390");
  });

  test("dark mode keeps the facts and the components on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 1280, height: 900 });

    const summary: Locator = await openStatusPageMonitor(page, "theme=dark");

    const fact: Locator = summary
      .getByTestId("external-status-page-page-facts")
      .locator(":scope > *")
      .first();
    expect(luminance(await backgroundColor(fact))).toBeLessThan(0.1);

    const list: Locator = summary.getByTestId(
      "external-status-page-components",
    );
    const listBackground: string = await backgroundColor(list);
    // A transparent list shows the dark card under it.
    expect(
      listBackground === "rgba(0, 0, 0, 0)" || luminance(listBackground) < 0.1,
    ).toBe(true);
    const nameColor: string = await summary
      .getByTestId("external-status-page-component-name")
      .first()
      .evaluate((element: Element): string => {
        return getComputedStyle(element).color;
      });
    expect(luminance(nameColor)).toBeGreaterThan(0.5);

    await screenshot(page, "external-status-page-summary-dark-1280");
  });
});
