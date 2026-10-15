import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * THE DISCOVERED-DEVICES IMPORT, IN A BROWSER (OneUptime issues #4811,
 * #4812, #4813, #4815).
 *
 * The real Discovery page and its import dialog against the offline fixture,
 * at the size the reports describe: one enterprise's 514 point-of-sale
 * registers that answer ping only (#4811's screenshot), and a campus of 300
 * mixed hosts across four vendors. The import API is answered in memory the
 * way the server's import job answers it (ImportFixture.js): an import is
 * recorded, a few dozen hosts are settled each time the dialog asks, devices
 * are built with the server's own builder, and the failures a test asks for
 * come back with their reasons.
 *
 * What a person sees is what is pinned: choosing hundreds of hosts by name,
 * address range and what they answered; how the devices will be monitored,
 * said before anything is created; progress that counts devices and monitors
 * apart; failures with reasons and a retry of only what failed; stopping;
 * closing the dialog with the import still running and finding it on the
 * scans table; and all of it on a 390-pixel phone with nothing scrolling
 * sideways. Screenshots of each step go to output/playwright/discovery/.
 */

interface CreatedDevice {
  hostname: string;
  name: string;
  pollingIntervalInMinutes: number | null;
  autoApplyVendorHealthTemplate: boolean;
}

interface ImportStart {
  scanId: string;
  ipAddresses: Array<string>;
  settings: {
    pollingIntervalInMinutes: number;
    applyVendorTemplates: boolean;
    alerting: string;
    monitorTemplateId?: string;
  };
}

interface FixtureControl {
  importBatch: number;
  holdImports: boolean;
  failDevices: Record<string, string>;
  failMonitors: Record<string, string>;
  importStarts: Array<ImportStart>;
  importRetries: Array<Array<string>>;
  creates: Array<CreatedDevice>;
}

const route: string =
  "/dashboard/10000000-0000-4000-8000-000000000001/network-devices/discovery";
const screenshots: string = path.resolve(
  __dirname,
  "../../../output/playwright/discovery",
);

const POS_SCAN: string = "WB Unit Franchise POS REG01-02 Discovery";
const CAMPUS_SCAN: string = "Campus core and access";
const POS_TEMPLATE_ID: string = "60000000-0000-4000-8000-000000000002";

async function control(
  page: Page,
  change: Partial<FixtureControl>,
): Promise<void> {
  await page.evaluate((values: Partial<FixtureControl>): void => {
    Object.assign(
      (window as unknown as { __discoveryFixture: FixtureControl })
        .__discoveryFixture,
      values,
    );
  }, change);
}

// What the dialog asked the import API for, and what the import created.
async function fixture(page: Page): Promise<{
  importStarts: Array<ImportStart>;
  importRetries: Array<Array<string>>;
  creates: Array<CreatedDevice>;
}> {
  return page.evaluate(() => {
    const current: FixtureControl = (
      window as unknown as { __discoveryFixture: FixtureControl }
    ).__discoveryFixture;

    return {
      importStarts: current.importStarts,
      importRetries: current.importRetries,
      creates: current.creates,
    };
  });
}

/*
 * The scan's own container, whichever way the table draws it: a row on a
 * wide screen, a card on a phone - the innermost element holding both the
 * scan's name and a Review Results button.
 */
function scanContainer(page: Page, name: string): Locator {
  return page
    .locator("tr, div")
    .filter({ has: page.getByText(name, { exact: true }) })
    .filter({ has: page.getByRole("button", { name: "Review Results" }) })
    .last();
}

function dialog(page: Page): Locator {
  return page.getByTestId("discovery-import-dialog");
}

async function openImport(page: Page, scanName: string): Promise<void> {
  await page.goto(route);
  await scanContainer(page, scanName)
    .getByRole("button", { name: "Review Results" })
    .click();
  await expect(page.getByTestId("discovered-host-table")).toBeVisible();
}

function summary(page: Page): Locator {
  return page.getByTestId("discovery-import-choose-summary");
}

async function search(page: Page, text: string): Promise<void> {
  await page.getByTestId("discovered-host-search").fill(text);
}

async function toMonitoring(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Next", exact: true }).click();
  await expect(
    page.getByTestId("discovery-import-monitoring-step"),
  ).toBeVisible();
}

async function pickOption(
  page: Page,
  dropdownId: string,
  option: string,
): Promise<void> {
  await page.locator(`#${dropdownId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

async function submitImport(page: Page): Promise<void> {
  const submit: Locator = page.getByRole("button", {
    name: /^Import [\d,]+ devices?$/,
  });
  await expect(submit).toBeEnabled();
  await submit.click();
  await expect(page.getByTestId("discovery-import-progress")).toBeVisible();
}

function title(page: Page): Locator {
  return page.getByTestId("discovery-import-progress-title");
}

async function expectNoSidewaysScroll(
  page: Page,
  width: number,
): Promise<void> {
  const scrollWidth: number = await page.evaluate((): number => {
    return document.documentElement.scrollWidth;
  });
  expect(scrollWidth).toBeLessThanOrEqual(width);

  const dialogBox: Awaited<ReturnType<Locator["boundingBox"]>> = await page
    .getByTestId("modal")
    .boundingBox();
  expect(dialogBox).not.toBeNull();
  expect(dialogBox!.x).toBeGreaterThanOrEqual(0);
  expect(dialogBox!.x + dialogBox!.width).toBeLessThanOrEqual(width);
}

test.describe("choosing the hosts", () => {
  test("514 registers: every importable one ticked, the three already added held back, fifty rows a page", async ({
    page,
  }: {
    page: Page;
  }) => {
    const errors: Array<string> = [];
    page.on("pageerror", (error: Error): void => {
      errors.push(error.message);
    });

    await openImport(page, POS_SCAN);

    await expect(summary(page)).toHaveText("511 hosts will be imported");
    await expect(
      page.getByTestId("discovered-host-selection-count"),
    ).toHaveText("511 hosts selected");
    await expect(
      page.locator('[data-testid^="discovered-host-row-"]'),
    ).toHaveCount(50);
    await expect(page.getByTestId("discovered-host-pagination")).toBeVisible();

    // An ICMP-only scan offers no SNMP facet; the name facet counts both sides.
    await expect(
      page.getByTestId("discovered-host-answered-facet"),
    ).toHaveCount(0);
    const names: Locator = page.getByTestId("discovered-host-name-facet");
    await expect(names).toContainText("Named (498)");
    await expect(names).toContainText("Address only (16)");

    // The three registers already in the inventory say so, and are not ticked.
    const added: Locator = page.getByTestId("discovered-host-row-10.48.11.31");
    await expect(added).toContainText("Already added");
    await expect(
      page.getByTestId("discovered-device-checkbox-10.48.11.31"),
    ).toBeDisabled();

    // The dialog is wide: the table has room for the names.
    const modalBox: Awaited<ReturnType<Locator["boundingBox"]>> = await page
      .getByTestId("modal")
      .boundingBox();
    expect(modalBox!.width).toBeGreaterThan(1000);

    // One line under the title: the scan it imports from.
    await expect(page.getByTestId("modal-description")).toHaveText(
      `${POS_SCAN} (10.48-79.0-255.31-32)`,
    );
    // The name facet is a radio group a screen reader can tell apart.
    await expect(page.getByRole("radiogroup", { name: "Name" })).toBeVisible();

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-choose-desktop.png"),
    });
    expect(errors).toEqual([]);
  });

  test("a search by name, a subnet, and the name facet narrow what is imported, and the hidden ticks are named", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);

    await search(page, "wb1105reg");
    await expect(summary(page)).toHaveText("2 hosts will be imported");
    await expect(
      page.getByTestId("discovered-host-hidden-selection"),
    ).toHaveText(
      "509 selected hosts are hidden by the filters and will not be imported.",
    );

    await search(page, "10.48.12.0/24");
    await expect(summary(page)).toHaveText("8 hosts will be imported");

    // Sixteen registers nothing named; the first store's is a device already.
    await search(page, "");
    await page
      .getByTestId("discovered-host-name-facet")
      .getByRole("radio", { name: /^Address only/ })
      .click();
    await expect(summary(page)).toHaveText("15 hosts will be imported");

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-address-only.png"),
    });

    await toMonitoring(page);
    await submitImport(page);

    const start: ImportStart = (await fixture(page)).importStarts[0]!;
    expect(start.ipAddresses).toHaveLength(15);
    expect(start.ipAddresses).toContain("10.48.15.36");
    expect(start.ipAddresses).not.toContain("10.48.11.32");
  });

  test("select all and clear act on the hosts shown; already-added can be hidden", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);

    await page.getByTestId("discovered-host-clear-selection").click();
    await expect(summary(page)).toHaveText("0 hosts will be imported");
    const nextButton: Locator = page.getByRole("button", {
      name: "Next",
      exact: true,
    });
    await expect(nextButton).toBeDisabled();
    // Dimmed, not a Next that looks like any other.
    await expect(nextButton).toHaveCSS("opacity", "0.5");

    await search(page, "10.48.11.0/24");
    await page.getByTestId("discovered-host-select-shown").click();
    await expect(summary(page)).toHaveText("5 hosts will be imported");

    await search(page, "");
    await page.getByTestId("discovered-host-hide-already-added").click();
    await expect(
      page.getByTestId("discovered-host-row-10.48.11.31"),
    ).toHaveCount(0);
    await expect(summary(page)).toHaveText("5 hosts will be imported");
  });

  test("a campus: what answered SNMP, and who made it, side by side", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, CAMPUS_SCAN);

    const answered: Locator = page.getByTestId(
      "discovered-host-answered-facet",
    );
    await expect(answered).toContainText("SNMP (180)");
    await expect(answered).toContainText("No SNMP (120)");
    await expect(
      page.getByTestId("discovered-host-vendor-10.60.0.10"),
    ).toHaveText("Cisco");
    await expect(
      page.getByTestId("discovered-host-vendor-10.60.0.11"),
    ).toHaveText("Juniper");

    await search(page, "juniper");
    await expect(summary(page)).toHaveText("45 hosts will be imported");

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-campus-search.png"),
    });
  });
});

test.describe("how the devices are monitored", () => {
  test("the registers every minute, each with the POS template: previewed, summed up and sent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);
    await toMonitoring(page);

    await expect(page.getByTestId("discovery-import-steps")).toContainText(
      "Monitoring",
    );
    await expect(
      page.getByTestId("discovery-import-outcome-ping"),
    ).toContainText(
      "511 devices answered ping only: they are pinged every 5 min.",
    );
    await expect(
      page.getByTestId("discovery-import-outcome-nobody"),
    ).toBeVisible();

    await pickOption(page, "discovery-import-interval", "Every minute");
    await page.getByTestId("discovery-import-alerting-template").check();
    await pickOption(
      page,
      "discovery-import-template",
      "POS ping availability",
    );

    const preview: Locator = page.getByTestId(
      "discovery-import-template-preview",
    );
    await expect(preview).toContainText("Register stops answering");
    await expect(preview).toContainText("Opens an incident (Critical)");
    await expect(preview).toContainText(
      "Checked each time a device is polled: every 1 min.",
    );
    await expect(
      page.getByTestId("discovery-import-outcome-monitors"),
    ).toContainText(
      "511 monitors, one per device, from “POS ping availability”, which opens incidents",
    );
    await expect(
      page.getByTestId("discovery-import-outcome-ping"),
    ).toContainText("pinged every 1 min.");

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-monitoring-desktop.png"),
    });

    await submitImport(page);

    const start: ImportStart = (await fixture(page)).importStarts[0]!;
    expect(start.settings).toEqual({
      pollingIntervalInMinutes: 1,
      applyVendorTemplates: true,
      alerting: "MonitorTemplate",
      monitorTemplateId: POS_TEMPLATE_ID,
    });
    expect(start.ipAddresses).toHaveLength(511);
  });

  test("a campus with the recommended pack: the walk-only checks are marked for the hosts that answer ping only", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, CAMPUS_SCAN);
    await toMonitoring(page);

    await expect(
      page.getByTestId("discovery-import-outcome-snmp"),
    ).toContainText("180 devices answered SNMP");
    await expect(
      page.getByTestId("discovered-device-apply-vendor-templates"),
    ).toHaveAttribute("aria-checked", "true");

    await page.getByTestId("discovery-import-alerting-template").check();
    const preview: Locator = page.getByTestId(
      "discovery-import-template-preview",
    );
    await expect(preview).toContainText("Device unreachable");
    await expect(preview.getByText("SNMP devices only").first()).toBeVisible();

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-campus-monitoring.png"),
    });
  });
});

test.describe("the import as it runs", () => {
  test("progress counts devices and monitors apart, and the finish says where everything is", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);
    await control(page, { importBatch: 120 });
    await toMonitoring(page);
    await page.getByTestId("discovery-import-alerting-template").check();
    await pickOption(
      page,
      "discovery-import-template",
      "POS ping availability",
    );
    await submitImport(page);

    await expect(title(page)).toHaveText(
      /Importing 511 devices…|Starting the import…/,
    );
    await expect(
      page.getByTestId("discovery-import-devices-progress"),
    ).toBeVisible();
    await expect(
      page.getByTestId("discovery-import-monitors-progress"),
    ).toBeVisible();
    await expect(
      page.getByTestId("discovery-import-devices-counts"),
    ).not.toHaveText("0 imported");

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-progress-desktop.png"),
    });

    await expect(title(page)).toHaveText("Import finished", { timeout: 60000 });
    await expect(
      page.getByTestId("discovery-import-devices-counts"),
    ).toHaveText("511 imported");
    await expect(
      page.getByTestId("discovery-import-monitors-counts"),
    ).toHaveText("511 created");
    await expect(
      page.getByText(
        "Every host is in the inventory, monitored from “POS ping availability”.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View devices" }),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "View monitors" }),
    ).toBeVisible();

    // Each device as the server builds it: the row's name, every minute here.
    const creates: Array<CreatedDevice> = (await fixture(page)).creates;
    expect(creates).toHaveLength(511);
    expect(
      creates.find((device: CreatedDevice) => {
        return device.hostname === "10.48.11.36";
      })?.name,
    ).toBe("WB1101REG02");

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-finished-desktop.png"),
    });
  });

  test("failures are grouped by their reason, and Retry tries only those hosts again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, CAMPUS_SCAN);
    await control(page, {
      importBatch: 400,
      // One reason for two hosts: one line, with both names under it.
      failDevices: {
        "10.60.0.10":
          "This project has reached its plan's limit of network devices.",
        "10.60.0.14":
          "This project has reached its plan's limit of network devices.",
      },
      failMonitors: {
        "10.60.0.11":
          "Your plan includes 100 active monitors, and this project has 100. All of its monitors keep running.",
      },
    });
    await search(page, "10.60.0.0/24");
    await toMonitoring(page);
    await page.getByTestId("discovery-import-alerting-template").check();
    await submitImport(page);

    await expect(title(page)).toHaveText("Import finished", { timeout: 60000 });

    const devices: Locator = page.getByTestId(
      "discovery-import-issue-DeviceFailed",
    );
    await expect(devices).toContainText("2 hosts were not imported");
    await expect(devices).toContainText(
      "This project has reached its plan's limit of network devices.",
    );
    await expect(devices).toContainText(
      "core-sw-001.corp.example.com (10.60.0.10)",
    );
    await expect(
      page.getByTestId("discovery-import-issue-MonitorFailed"),
    ).toContainText("1 device was imported without its monitor");
    await expect(
      page.getByText(
        "Fix what is listed below, then retry: only those hosts are tried again, and nothing is created twice.",
      ),
    ).toBeVisible();

    await page.screenshot({
      path: path.join(screenshots, "discovery-import-failures-desktop.png"),
    });

    await page.getByRole("button", { name: "Retry 3 hosts" }).click();
    await expect(title(page)).toHaveText("Import finished", { timeout: 60000 });
    await expect(page.getByRole("button", { name: "Done" })).toBeVisible();

    const retries: Array<Array<string>> = (await fixture(page)).importRetries;
    expect(retries).toEqual([["10.60.0.10", "10.60.0.11", "10.60.0.14"]]);
  });

  test("Stop stops before the next host, keeps what was created, and lists the rest to retry", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);
    await control(page, { importBatch: 20 });
    await toMonitoring(page);
    await submitImport(page);

    // Running, with some devices in.
    await expect(
      page.getByTestId("discovery-import-devices-counts"),
    ).not.toHaveText("0 imported");
    await control(page, { holdImports: true });
    await page.getByTestId("discovery-import-stop").click();
    await expect(title(page)).toHaveText(
      "Stopping after the host being imported now…",
    );
    await control(page, { holdImports: false });

    await expect(title(page)).toHaveText("Import stopped", { timeout: 30000 });
    await expect(
      page.getByTestId("discovery-import-issue-NotReached"),
    ).toContainText("were not reached");
    await expect(
      page.getByTestId("discovery-import-issue-NotReached"),
    ).toContainText("The import was stopped.");
    // The bar says how far it got, not a full bar over the hosts not reached.
    const reached: string =
      (await page
        .getByTestId("discovery-import-devices-progress")
        .getByTestId("progress-bar-count")
        .textContent()) || "";
    expect(reached).toMatch(/^\d+ of 511 Devices$/);
    expect(reached).not.toBe("511 of 511 Devices");
    await expect(
      page.getByText(
        "What it imported before it stopped stays. Retry tries the rest again, and nothing is created twice.",
      ),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: /^Retry \d+ hosts$/ }),
    ).toBeVisible();
  });

  test("closed while it runs, the import shows on its scan's row, and View progress opens it where it stands", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);
    await control(page, { importBatch: 30 });
    await toMonitoring(page);
    await submitImport(page);
    await expect(
      page.getByTestId("discovery-import-devices-counts"),
    ).not.toHaveText("0 imported");

    await control(page, { holdImports: true });
    await page.getByTestId("modal-footer-close-button").click();
    await expect(dialog(page)).toHaveCount(0);

    const row: Locator = page.getByTestId(
      "discovery-import-row-20000000-0000-4000-8000-000000000009",
    );
    await expect(row).toContainText(/Importing devices: \d+ of 511/);
    await page.screenshot({
      path: path.join(screenshots, "discovery-import-row-status.png"),
    });

    await page
      .getByTestId(
        "discovery-import-row-view-20000000-0000-4000-8000-000000000009",
      )
      .click();
    await expect(title(page)).toHaveText("Importing 511 devices…");

    // Opening Review Results again shows the same import, not a new choice.
    await control(page, { holdImports: false });
    await expect(title(page)).toHaveText("Import finished", { timeout: 60000 });
  });
});

test.describe("on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("every step fits 390 pixels, with nothing scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openImport(page, POS_SCAN);

    await expect(page.getByTestId("discovery-import-steps")).toContainText(
      "Choose devices · Step 1 of 3",
    );
    await expectNoSidewaysScroll(page, 390);
    await page.screenshot({
      path: path.join(screenshots, "discovery-import-choose-phone.png"),
    });

    // Down the host list, then on: the next step opens at its top.
    await page.evaluate((): void => {
      const modal: Element | null = document.querySelector(
        '[data-testid="modal"]',
      );
      for (const element of Array.from(modal?.querySelectorAll("*") || [])) {
        const style: CSSStyleDeclaration = window.getComputedStyle(element);
        if (
          (style.overflowY === "auto" || style.overflowY === "scroll") &&
          element.scrollHeight > element.clientHeight
        ) {
          element.scrollTop = element.scrollHeight;
        }
      }
    });
    await toMonitoring(page);
    await expect(page.getByTestId("discovery-import-steps")).toContainText(
      "Monitoring · Step 2 of 3",
    );
    await expect(
      page.getByTestId("discovery-import-step-phone"),
    ).toBeInViewport();
    await page.getByTestId("discovery-import-alerting-template").check();
    await expectNoSidewaysScroll(page, 390);
    await page.screenshot({
      path: path.join(screenshots, "discovery-import-monitoring-phone.png"),
    });

    await control(page, { importBatch: 600 });
    await submitImport(page);
    await expect(title(page)).toHaveText("Import finished", { timeout: 60000 });
    await expectNoSidewaysScroll(page, 390);
    await page.screenshot({
      path: path.join(screenshots, "discovery-import-finished-phone.png"),
    });
  });
});
