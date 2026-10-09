import { expect, Locator, Page, test } from "@playwright/test";
import path from "path";

/*
 * After discovery: the devices a scan brought in are filed into a site,
 * given a role and their vendor's health template - many at once, from the
 * Devices list's Bulk Actions - and an import from Review Results applies
 * each SNMP host's vendor template by itself unless switched off.
 *
 * The real Devices page, table, bulk bar, dialogs and progress modal, and
 * the real Discovery review dialog, against the synthetic devices and scans
 * in Fixture.js. The fixture records every device write and every device an
 * import creates, so each test can say what was sent, in what order.
 */

interface DeviceWrite {
  id: string;
  data: Record<string, unknown>;
  startedAt: number;
  endedAt: number;
}

interface CreatedDevice {
  hostname: string;
  name: string;
  autoApplyVendorHealthTemplate: boolean;
}

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const devicesRoute: string = `/dashboard/${PROJECT}/network-devices`;
const discoveryRoute: string = `/dashboard/${PROJECT}/network-devices/discovery`;
const screenshots: string = path.resolve(
  __dirname,
  "../../../output/playwright/discovery",
);

function deviceId(index: number): string {
  return `40000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const BUILDING_A: string = "50000000-0000-4000-8000-000000000001";

async function openDevices(page: Page): Promise<void> {
  await page.goto(devicesRoute);
  await expect(
    page.getByRole("link", { name: "cnmatrix-sw-01", exact: true }),
  ).toBeVisible();
}

async function selectAllOnPage(page: Page): Promise<void> {
  await page.locator("thead input[type=checkbox]").first().check();
  await expect(page.getByText("6 Devices Selected")).toBeVisible();
}

async function pickBulkAction(page: Page, name: string): Promise<void> {
  await page.getByText("Bulk Actions", { exact: true }).click();
  await page.getByRole("menuitem", { name: name, exact: true }).click();
}

async function writes(page: Page): Promise<Array<DeviceWrite>> {
  return page.evaluate((): Array<DeviceWrite> => {
    return (
      window as unknown as { __discoveryFixture: { updates: Array<DeviceWrite> } }
    ).__discoveryFixture.updates;
  });
}

async function created(page: Page): Promise<Array<CreatedDevice>> {
  return page.evaluate((): Array<CreatedDevice> => {
    return (
      window as unknown as {
        __discoveryFixture: { creates: Array<CreatedDevice> };
      }
    ).__discoveryFixture.creates;
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog").last();
}

async function waitForResult(page: Page): Promise<Locator> {
  await expect(page.getByText("Completed", { exact: true })).toBeVisible({
    timeout: 30000,
  });
  return dialog(page);
}

// Open the dialog's dropdown, then pick the option by its name.
async function pickOption(page: Page, label: string): Promise<void> {
  await dialog(page).getByRole("combobox").click();
  await page.getByRole("option", { name: label, exact: true }).click();
}

/*
 * On a phone the table is a list of cards with no header checkbox: every
 * row's own checkbox is ticked instead.
 */
async function selectEveryRow(page: Page): Promise<void> {
  const boxes: Locator = page.getByRole("checkbox", {
    name: /^Select Device:/,
  });
  const count: number = await boxes.count();

  for (let index: number = 0; index < count; index++) {
    await boxes.nth(index).check();
  }

  await expect(page.getByText("6 Devices Selected")).toBeVisible();
}

test("the bulk menu offers site, role and vendor template, and Clear Site only where there is a site to clear", async ({
  page,
}: {
  page: Page;
}) => {
  await openDevices(page);
  await selectAllOnPage(page);

  await page.getByText("Bulk Actions", { exact: true }).click();

  for (const name of [
    "Set Site",
    "Clear Site",
    "Set Device Role",
    "Apply Vendor Template",
  ]) {
    await expect(
      page.getByRole("menuitem", { name: name, exact: true }),
    ).toBeVisible();
  }

  // No selected device has a role, so there is none to clear.
  await expect(
    page.getByRole("menuitem", { name: "Clear Device Role", exact: true }),
  ).toHaveCount(0);

  await page.screenshot({
    path: path.join(screenshots, "devices-bulk-menu.png"),
    fullPage: true,
  });

  await page.keyboard.press("Escape");
  await page.getByText("Clear Selection", { exact: true }).click();

  // One device, in no site: Clear Site has nothing to do and is not offered.
  await page
    .getByRole("row")
    .filter({ hasText: "cnmatrix-sw-01" })
    .locator("input[type=checkbox]")
    .check();
  await page.getByText("Bulk Actions", { exact: true }).click();
  await expect(
    page.getByRole("menuitem", { name: "Set Site", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("menuitem", { name: "Clear Site", exact: true }),
  ).toHaveCount(0);
});

test("Apply Vendor Template says what it will do, does it, and lists what it left alone", async ({
  page,
}: {
  page: Page;
}) => {
  await openDevices(page);
  await selectAllOnPage(page);
  await pickBulkAction(page, "Apply Vendor Template");

  const plan: Locator = page.getByTestId("vendor-template-plan");
  await expect(plan).toBeVisible();
  await expect(plan.getByRole("listitem")).toHaveText([
    "3 devices get Cambium Networks cnMatrix.",
    "1 device is not identified yet and is left as it is.",
    "1 device is linked to an OID Collection Template and is left as it is.",
    "1 device is monitor-backed and is left as it is.",
  ]);
  await expect(
    dialog(page).getByText("Match each device's vendor", { exact: true }),
  ).toBeVisible();
  expect(await writes(page)).toEqual([]);

  await dialog(page).screenshot({
    path: path.join(screenshots, "devices-apply-vendor-template.png"),
  });

  await page.getByRole("button", { name: "Apply Template" }).click();

  const result: Locator = await waitForResult(page);
  await expect(result.getByText("3 Devices succeeded")).toBeVisible();
  await expect(result.getByTestId("bulk-action-unchanged-count")).toHaveText(
    "3 Devices not changed",
  );

  const unchanged: Locator = result.getByTestId("bulk-action-unchanged-items");
  await expect(unchanged).toContainText("lab-sw-04");
  await expect(unchanged).toContainText("Not identified yet");
  await expect(unchanged).toContainText(
    'Linked to the OID Collection Template "Cisco Catalyst 9300"',
  );
  await expect(unchanged).toContainText("Nothing polls this device");

  await result.screenshot({
    path: path.join(screenshots, "devices-apply-vendor-template-result.png"),
  });

  const sent: Array<DeviceWrite> = await writes(page);
  expect(
    sent
      .map((write: DeviceWrite): string => {
        return write.id;
      })
      .sort(),
  ).toEqual([deviceId(1), deviceId(2), deviceId(3)]);

  for (const write of sent) {
    const oids: Array<{ oid: string }> = write.data["snmpOids"] as Array<{
      oid: string;
    }>;
    const tables: Array<{ key: string }> = write.data["snmpTables"] as Array<{
      key: string;
    }>;

    expect(oids.length).toBeGreaterThan(0);
    expect(oids[0]!.oid).toBe("1.3.6.1.4.1.2076.81.1.68.0");
    expect(
      tables.map((table: { key: string }): string => {
        return table.key;
      }),
    ).toEqual(["fans", "poe_ports", "redundant_power"]);
  }
});

test("Set Site files the selection one device at a time, and leaves the device already there", async ({
  page,
}: {
  page: Page;
}) => {
  await openDevices(page);
  await selectAllOnPage(page);
  await pickBulkAction(page, "Set Site");

  await expect(dialog(page).getByText("Set Site").first()).toBeVisible();

  const hint: Locator = page.getByTestId("set-site-assignment-rules-hint");
  await expect(hint).toContainText(
    "Devices that discovery finds later can be placed in a site automatically",
  );
  await expect(
    hint.getByRole("link", { name: "site assignment rule" }),
  ).toHaveAttribute("href", /\/network-sites\/assignment-rules$/);

  await pickOption(page, "Contoso - Building A");
  await dialog(page).screenshot({
    path: path.join(screenshots, "devices-set-site.png"),
  });
  await page.getByTestId("modal-footer-submit-button").click();

  const result: Locator = await waitForResult(page);
  await expect(result.getByText("5 Devices succeeded")).toBeVisible();
  await expect(result.getByTestId("bulk-action-unchanged-items")).toContainText(
    "Already in this site.",
  );

  const sent: Array<DeviceWrite> = await writes(page);
  expect(
    sent.map((write: DeviceWrite): string => {
      return write.id;
    }),
  ).toEqual([1, 2, 4, 5, 6].map(deviceId));

  for (const write of sent) {
    expect(Object.keys(write.data)).toEqual(["siteId"]);
    expect(JSON.stringify(write.data["siteId"])).toContain(BUILDING_A);
  }

  // One at a time: each write starts after the one before it ended.
  for (let index: number = 1; index < sent.length; index++) {
    expect(sent[index]!.startedAt).toBeGreaterThanOrEqual(
      sent[index - 1]!.endedAt,
    );
  }
});

test("a write the server refuses is listed against its device, in the server's words", async ({
  page,
}: {
  page: Page;
}) => {
  await openDevices(page);
  await page.evaluate((id: string): void => {
    (
      window as unknown as { __discoveryFixture: { refuseUpdateOf: string } }
    ).__discoveryFixture.refuseUpdateOf = id;
  }, deviceId(2));

  await selectAllOnPage(page);
  await pickBulkAction(page, "Set Device Role");
  await pickOption(page, "Access Switch");
  await page.getByTestId("modal-footer-submit-button").click();

  const result: Locator = await waitForResult(page);
  await expect(result.getByText("5 Devices succeeded")).toBeVisible();
  await expect(result.getByText("1 Device failed")).toBeVisible();

  const failed: Locator = result.getByTestId("bulk-action-failed-items");
  await expect(failed).toContainText("cnmatrix-sw-02");
  await expect(failed).toContainText(
    "You do not have permission to edit this Network Device.",
  );
});

test("Clear Site asks about, and changes, only the devices in a site", async ({
  page,
}: {
  page: Page;
}) => {
  await openDevices(page);
  await selectAllOnPage(page);
  await pickBulkAction(page, "Clear Site");

  await expect(page.getByText("Remove 1 device from its site?")).toBeVisible();
  await page.getByRole("button", { name: "Clear Site" }).last().click();

  const result: Locator = await waitForResult(page);
  await expect(result.getByText("1 Device succeeded")).toBeVisible();
  await expect(result.getByTestId("bulk-action-unchanged-count")).toHaveText(
    "5 Devices not changed",
  );

  const sent: Array<DeviceWrite> = await writes(page);
  expect(sent).toHaveLength(1);
  expect(sent[0]!.id).toBe(deviceId(3));
  expect(sent[0]!.data).toEqual({ siteId: null });
});

test("the vendor template dialog and its result fit a narrow screen", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openDevices(page);
  await selectEveryRow(page);
  await pickBulkAction(page, "Apply Vendor Template");

  await expect(page.getByTestId("vendor-template-plan")).toBeVisible();

  const box: Awaited<ReturnType<Locator["boundingBox"]>> = await dialog(
    page,
  ).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);

  const overflows: boolean = await dialog(page).evaluate(
    (element: Element): boolean => {
      return element.scrollWidth > element.clientWidth + 1;
    },
  );
  expect(overflows).toBe(false);

  await page.screenshot({
    path: path.join(screenshots, "devices-apply-vendor-template-mobile.png"),
  });

  await page.getByRole("button", { name: "Apply Template" }).click();
  const result: Locator = await waitForResult(page);
  const resultBox: Awaited<ReturnType<Locator["boundingBox"]>> =
    await result.boundingBox();
  expect(resultBox!.x + resultBox!.width).toBeLessThanOrEqual(390);
});

test("an import from Review Results applies each SNMP host's vendor template, and the switch turns it off", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(discoveryRoute);
  const scanRow: Locator = page
    .getByRole("row")
    .filter({ hasText: "Datacenter routers" });
  await scanRow.getByRole("button", { name: /Review/ }).click();

  const vendorSwitch: Locator = page.getByTestId(
    "discovered-device-apply-vendor-templates",
  );
  await expect(vendorSwitch).toHaveAccessibleName(
    "Apply each SNMP host's vendor template on its first poll (recommended) — 2 hosts",
  );
  await expect(vendorSwitch).toHaveAttribute("aria-checked", "true");

  await page.screenshot({
    path: path.join(screenshots, "discovery-review-vendor-templates.png"),
  });

  await page.getByRole("button", { name: /Import Selected/ }).click();
  await expect.poll(async () => (await created(page)).length).toBe(3);

  const byHost: Map<string, boolean> = new Map(
    (await created(page)).map((device: CreatedDevice) => {
      return [device.hostname, device.autoApplyVendorHealthTemplate];
    }),
  );
  expect(byHost.get("10.240.0.220")).toBe(true);
  expect(byHost.get("10.240.0.221")).toBe(true);
  // Ping-only: nothing to match a template by.
  expect(byHost.get("10.240.0.222")).toBe(false);

  // Switched off, a fresh review imports without it.
  await page.goto(discoveryRoute);
  await page
    .getByRole("row")
    .filter({ hasText: "Datacenter routers" })
    .getByRole("button", { name: /Review/ })
    .click();
  const switchAgain: Locator = page.getByTestId(
    "discovered-device-apply-vendor-templates",
  );
  await expect(switchAgain).toHaveAttribute("aria-checked", "true");
  await switchAgain.click();
  await expect(switchAgain).toHaveAttribute("aria-checked", "false");
  await page.getByRole("button", { name: /Import Selected/ }).click();
  await expect.poll(async () => (await created(page)).length).toBe(3);

  for (const device of await created(page)) {
    expect(device.autoApplyVendorHealthTemplate).toBe(false);
  }
});
