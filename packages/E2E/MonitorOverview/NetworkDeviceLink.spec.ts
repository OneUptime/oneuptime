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
 * CREATE MONITOR FROM A NETWORK DEVICE'S LINK, IN A REAL BROWSER (#5281).
 *
 * "Monitor web UI" on a device's Monitors card opens Create Monitor on the
 * device's link with &check=web-ui: a Website monitor of the device's
 * management page - https on the address its probe polls, self-signed
 * certificates allowed (a switch's web UI is self-signed), checked from the
 * device's own probe, named after the device - for the person to read and
 * Create. Nothing binds it to the device.
 *
 * The same link without the check opens the device's Network Device monitor
 * and its alert pack, whose criteria a phone draws three cards deep: there
 * every filter's list showed "SNMP Walk..." beside a × that took a sixth of
 * it. Each list shows its pick whole now, and Filter Type and Filter
 * Condition never offer to clear.
 *
 * The production Create Monitor page against the offline fixture's switch,
 * sw-core-01 at 10.20.0.1, polled by Frankfurt (Fixture/Fixture.js), with
 * its network fence and its record of requests it does not model.
 */

const PORT: string = process.env["MONITOR_OVERVIEW_FIXTURE_PORT"] || "4223";
const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const NOW: Date = new Date("2026-09-21T12:00:00.000Z");
const CREATE_PATH: string = `/dashboard/${PROJECT_ID}/monitors/create`;
const DEVICE_ID: string = "85000000-0000-4000-8000-000000000001";
const DEVICE_LINK: string = `?networkDeviceId=${DEVICE_ID}`;
const WEB_UI_LINK: string = `${DEVICE_LINK}&check=web-ui`;
// What the API answers a create with (Fixture.js).
const CREATED_MONITOR_ID: string = "70000000-0000-4000-8000-000000000100";
// The probe that polls the device.
const FRANKFURT_PROBE_ID: string = "73000000-0000-4000-8000-000000000001";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/monitor-overview-ui",
);

interface RecordedCreate {
  modelName: string;
  data: Record<string, unknown>;
  miscDataProps: Record<string, unknown> | null;
}

interface ListOnScreen {
  text: string;
  clipped: boolean;
  clears: boolean;
  insideTheScreen: boolean;
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

// Create Monitor on a link, once the form shows the type the link chose.
async function openCreate(page: Page, query: string): Promise<Locator> {
  await page.clock.setFixedTime(NOW);
  await page.goto(`${CREATE_PATH}${query}`);
  // The first load parses a large bundle.
  await expect(page.getByTestId("synthetic-banner")).toBeVisible({
    timeout: 60000,
  });

  const form: Locator = page.locator("#create-monitor-form");
  await expect(form).toBeVisible({ timeout: 60000 });
  await expect(page.getByTestId("card-select-summary")).toBeVisible({
    timeout: 30000,
  });

  return form;
}

// The monitor's name, by its label: its placeholder is in the page's language.
function nameInput(form: Locator): Locator {
  return form.getByRole("textbox", { name: "Name", exact: true });
}

function next(form: Locator): Locator {
  return form.getByRole("button", { name: "Next", exact: true });
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

async function sidewaysOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    return (
      document.documentElement.scrollWidth -
      document.documentElement.clientWidth
    );
  });
}

test.describe("Monitor web UI, from a network device", () => {
  test("opens a Website monitor of the device's web UI, checked from its probe, and creates it", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);

    const form: Locator = await openCreate(page, WEB_UI_LINK);

    // A Website monitor, named after the device.
    await expect(page.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Website",
    );
    await expect(nameInput(form)).toHaveValue("sw-core-01 web UI");

    await screenshot(page, "device-web-ui-first-step");

    await next(form).click();

    // https on the address the probe polls, self-signed certificates allowed.
    const url: Locator = form.getByPlaceholder("https://example.com", {
      exact: true,
    });
    await expect(url).toHaveValue("https://10.20.0.1/", { timeout: 60000 });

    const moreFields: Locator = page.getByTestId("monitor-step-more-fields");
    await expect(
      moreFields.locator(
        "[data-testid='folded-section-item'][data-item-key='allowSelfSignedCertificates']",
      ),
    ).toHaveAttribute("data-item-set", "true");
    await moreFields.getByTestId("folded-section-header").click();
    await expect(
      moreFields.getByRole("checkbox", {
        name: /Allow self-signed certificates/,
      }),
    ).toBeChecked();

    // The Website monitor's usual criteria.
    await expect(page.getByTestId("monitor-criteria-header")).toHaveCount(2, {
      timeout: 30000,
    });

    await screenshot(page, "device-web-ui-criteria");

    await next(form).click();

    // Checked from the probe that polls the device.
    const probes: Locator = page.getByRole("combobox", { name: /^Probes/ });
    await expect(probes).toBeVisible({ timeout: 30000 });
    const probesField: Locator = form
      .locator(".ou-select__control")
      .filter({ has: probes });
    await expect(probesField).toContainText("Frankfurt (eu-central-1)");
    await expect(probesField).not.toContainText("N. Virginia (us-east-1)");
    await expect(probesField).not.toContainText("Singapore (ap-southeast-1)");

    await page.getByTestId("Create Monitor").click();

    await expect(page).toHaveURL(
      `/dashboard/${PROJECT_ID}/monitors/${CREATED_MONITOR_ID}`,
      { timeout: 30000 },
    );

    // One create - the monitor - and nothing bound to the device.
    const creates: Array<RecordedCreate> = await createsRecorded(page);
    expect(creates).toHaveLength(1);
    expect(creates[0]!.modelName).toBe("Monitor");
    expect(creates[0]!.data["monitorType"]).toBe("Website");
    expect(creates[0]!.data["name"]).toBe("sw-core-01 web UI");
    expect(creates[0]!.data["description"]).toBe(
      "Checks that the web UI of the sw-core-01 network device answers.",
    );

    const steps: string = JSON.stringify(creates[0]!.data["monitorSteps"]);
    expect(steps).toContain("https://10.20.0.1/");
    expect(steps).toContain('"allowSelfSignedCertificates":true');
    expect(steps).not.toContain("networkDeviceMonitor");
    expect(creates[0]!.miscDataProps?.["probes"]).toEqual([FRANKFURT_PROBE_ID]);
  });

  test("in German, the monitor is named in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    const form: Locator = await openCreate(page, `${WEB_UI_LINK}&lang=de`);

    await expect(nameInput(form)).toHaveValue("Weboberfläche von sw-core-01");
  });

  test("on a phone, the form opens the same, nothing wider than the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const form: Locator = await openCreate(page, WEB_UI_LINK);

    await expect(nameInput(form)).toHaveValue("sw-core-01 web UI");
    await next(form).click();
    await expect(
      form.getByPlaceholder("https://example.com", { exact: true }),
    ).toHaveValue("https://10.20.0.1/", { timeout: 60000 });

    await expect
      .poll(() => {
        return sidewaysOverflow(page);
      })
      .toBeLessThanOrEqual(0);

    await screenshot(page, "device-web-ui-criteria-phone");
  });
});

test.describe("the device's alert pack on a phone", () => {
  test("every filter's Filter Type and Filter Condition show their picks whole, inside the screen, and never clear", async ({
    page,
  }: {
    page: Page;
  }) => {
    test.setTimeout(180000);
    await page.setViewportSize({ width: 390, height: 844 });

    const form: Locator = await openCreate(page, DEVICE_LINK);

    await expect(page.getByTestId("card-select-summary")).toHaveAttribute(
      "data-card-select-value",
      "Network Device",
    );
    await next(form).click();

    const headers: Locator = page.getByTestId("monitor-criteria-header");
    await expect(headers.first()).toBeVisible({ timeout: 60000 });
    expect(await headers.count()).toBeGreaterThan(3);

    /*
     * Every criteria open, so every filter is drawn: one at a time, the
     * first still closed, as each one opened leaves the list.
     */
    const closed: Locator = headers.locator("button[aria-expanded='false']");
    for (let opened: number = 0; opened < 20; opened++) {
      if ((await closed.count()) === 0) {
        break;
      }
      await closed.first().click();
    }
    await expect(closed).toHaveCount(0);

    const filterTypes: Locator = page.getByRole("combobox", {
      name: "Filter Type",
      exact: true,
    });
    await expect(filterTypes.first()).toBeVisible();
    expect(await filterTypes.count()).toBeGreaterThan(3);

    const lists: Array<ListOnScreen> = await page.evaluate(
      (): Array<ListOnScreen> => {
        const shown: Array<ListOnScreen> = [];
        const bodies: Array<Element> = Array.from(
          document.querySelectorAll("[data-testid='monitor-criteria-body']"),
        );

        for (const body of bodies) {
          for (const input of Array.from(
            body.querySelectorAll("input[role='combobox']"),
          )) {
            // The filter's lists are named by aria-label (CriteriaFilter).
            const label: string = input.getAttribute("aria-label") || "";

            if (label !== "Filter Type" && label !== "Filter Condition") {
              continue;
            }

            const control: Element | null = input.closest(
              ".ou-select__control",
            );
            const value: HTMLElement | null = (control?.querySelector(
              "[data-testid='dropdown-value-label']",
            ) || null) as HTMLElement | null;
            const box: DOMRect | undefined = control?.getBoundingClientRect();

            shown.push({
              text: `${label}: ${value?.textContent || ""}`,
              clipped: value
                ? value.scrollWidth > value.clientWidth + 1
                : false,
              clears: Boolean(
                control?.querySelector(".ou-select__clear-indicator"),
              ),
              insideTheScreen: box
                ? box.x >= 0 && box.x + box.width <= window.innerWidth + 1
                : false,
            });
          }
        }

        return shown;
      },
    );

    expect(lists.length).toBeGreaterThan(6);
    for (const list of lists) {
      expect(list, "a filter's list on a phone").toEqual({
        text: list.text,
        clipped: false,
        clears: false,
        insideTheScreen: true,
      });
    }

    // The long check the pack opens with reads whole.
    expect(
      lists.some((list: ListOnScreen): boolean => {
        return list.text.includes("SNMP Walk Is Succeeding");
      }),
    ).toBe(true);

    expect(await sidewaysOverflow(page)).toBeLessThanOrEqual(0);

    await screenshot(page, "device-alert-pack-filters-phone");
  });
});
