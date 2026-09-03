import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";

/*
 * Monitor-backed network devices, end to end.
 *
 * A NetworkDevice whose monitoring method is "Monitor" is never polled:
 * nothing walks it over SNMP, and the only thing that can say whether it is
 * up is the Ping or IP monitor bound to it. Two things about the create form
 * have to hold, and neither is visible from a unit test that mocks the form:
 *
 *   1. a device can be saved with NO monitor bound - the binding is optional
 *      everywhere else (Settings, the topology map's "Add to Monitoring",
 *      discovery import, the server), and the create form was the one place
 *      that blocked it - and the list then says so honestly: the status pill
 *      reads "Pending" and a second pill beside it reads "No monitor", rather
 *      than a bare "Pending" that looks like a poll is on its way;
 *
 *   2. ticking "Create a Ping monitor" on that same form creates a monitor
 *      named "Ping <device name>" and binds it before the modal closes, so
 *      the row no longer reads "No monitor" and the monitor is there under
 *      Monitors for the operator to tune.
 *
 * Nothing here waits for a probe result: a fresh monitor carries the
 * project's operational status from the moment it is created, before any
 * probe has checked the address, so the pill it resolves to is the monitor's
 * STARTING status, not a verdict. The spec asserts on the binding, never on
 * reachability.
 *
 * Skip-gated to match the other Dashboard specs (InventoryProduct.spec.ts,
 * CephProduct.spec.ts) so CI behaviour stays identical. To run locally
 * against a full stack, change `test.describe.skip` to `test.describe` and:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/NetworkDeviceMonitorBacked.spec.ts --project=chromium
 */

/*
 * The flow is a form submit and a list read - running it a second time in
 * firefox would double the wall clock for no extra coverage.
 */
test.skip(({ browserName }: { browserName: string }): boolean => {
  return browserName !== "chromium";
}, "The device create flow is form and API driven; the chromium run covers it.");

/*
 * TEST-NET-1 (RFC 5737): reserved for documentation, guaranteed unroutable,
 * so a Ping monitor created for it can never accidentally reach something
 * real from wherever the probes happen to run. The spec never waits for a
 * result from it.
 */
const UNROUTABLE_HOSTNAME: string = "192.0.2.10";

const CREATE_DEVICE_BUTTON_NAME: string = "Create Network Device";

type DevicesUrlFunction = (projectId: string) => string;

const devicesUrl: DevicesUrlFunction = (projectId: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}/network-devices`)
    .toString();
};

type MonitorsUrlFunction = (projectId: string) => string;

const monitorsUrl: MonitorsUrlFunction = (projectId: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}/monitors`)
    .toString();
};

type OpenDevicesListFunction = (data: {
  page: Page;
  projectId: string;
}) => Promise<void>;

const openDevicesList: OpenDevicesListFunction = async (data: {
  page: Page;
  projectId: string;
}): Promise<void> => {
  await gotoProjectPage({
    page: data.page,
    projectId: data.projectId,
    url: devicesUrl(data.projectId),
    ready: data.page.getByRole("button", { name: CREATE_DEVICE_BUTTON_NAME }),
  });
};

/*
 * The table row for one device, found by its name. Pills are asserted
 * INSIDE the row so a "Pending" or "No monitor" on some other row - the
 * second scenario creates a second device in the same project - cannot
 * satisfy an assertion about this one.
 */
type DeviceRowFunction = (data: { page: Page; name: string }) => Locator;

const deviceRow: DeviceRowFunction = (data: {
  page: Page;
  name: string;
}): Locator => {
  return data.page.getByRole("row").filter({ hasText: data.name });
};

/*
 * Walks the create form for a monitor-backed device.
 *
 * The form is a stepped ModelFormModal: Monitoring -> Device Details ->
 * Probe & Site (-> SNMP Credentials, which is hidden for a monitor-backed
 * device). The footer button keeps the "modal-footer-submit-button" test id
 * on every step; it reads "Next" until the last visible step, where it
 * reads "Save".
 */
type CreateMonitorBackedDeviceFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
  shouldCreatePingMonitor: boolean;
}) => Promise<void>;

const createMonitorBackedDevice: CreateMonitorBackedDeviceFunction =
  async (data: {
    page: Page;
    projectId: string;
    name: string;
    shouldCreatePingMonitor: boolean;
  }): Promise<void> => {
    const page: Page = data.page;

    await openDevicesList({ page, projectId: data.projectId });

    await page.getByRole("button", { name: CREATE_DEVICE_BUTTON_NAME }).click();

    const modal: Locator = page.getByTestId("modal");
    await modal.waitFor({ state: "visible", timeout: 30000 });

    const footerButton: Locator = page.getByTestId(
      "modal-footer-submit-button",
    );

    // Step 1 - Monitoring: pick "Monitor" over the default SNMP.
    const methodCombo: Locator = modal.getByRole("combobox", {
      name: /How is this device monitored/,
    });
    await methodCombo.waitFor({ state: "visible", timeout: 30000 });
    await methodCombo.click();
    await page
      .getByRole("option", { name: /^Monitor — / })
      .click({ timeout: 30000 });

    await expect(footerButton).toHaveText("Next", { timeout: 30000 });
    await footerButton.click();

    // Step 2 - Device Details: only the two required fields.
    const nameField: Locator = modal.getByPlaceholder("core-switch-01");
    await nameField.waitFor({ state: "visible", timeout: 30000 });
    await nameField.fill(data.name);
    await modal
      .getByPlaceholder("10.0.0.1 or switch-01.example.com")
      .fill(UNROUTABLE_HOSTNAME);

    await expect(footerButton).toHaveText("Next", { timeout: 30000 });
    await footerButton.click();

    /*
     * Step 3 - Probe & Site. The Monitor dropdown is deliberately left empty
     * in both scenarios: the point of the first is that nothing has to be
     * bound, and the point of the second is that the checkbox does the
     * binding. The checkbox is off by default - a monitor is billable and
     * plan-limited, so creating one is always opted into.
     */
    const createPingMonitorCheckbox: Locator = modal.getByRole("checkbox", {
      name: /Create a Ping monitor/i,
    });
    await createPingMonitorCheckbox.waitFor({
      state: "visible",
      timeout: 30000,
    });
    await expect(createPingMonitorCheckbox).not.toBeChecked();

    if (data.shouldCreatePingMonitor) {
      await createPingMonitorCheckbox.check();
      await expect(createPingMonitorCheckbox).toBeChecked();
    }

    // The SNMP step is hidden for a monitor-backed device, so this is the last.
    await expect(footerButton).toHaveText("Save", { timeout: 30000 });
    await footerButton.click();

    /*
     * With the checkbox ticked the modal stays open while the monitor is
     * created and bound, so the budget is the create form's, not the list's.
     */
    await modal.waitFor({ state: "hidden", timeout: 90000 });

    await expect(page.getByText(data.name).first()).toBeVisible({
      timeout: 30000,
    });
  };

test.describe.skip("Monitor-backed network devices", () => {
  test.beforeEach(() => {
    test.setTimeout(420000);
  });

  test("a device saved with no monitor bound reads Pending, and says No monitor", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Network Device Project",
    });

    const deviceName: string =
      "E2E Unbound AP " + Faker.generateName().toString();

    await createMonitorBackedDevice({
      page,
      projectId,
      name: deviceName,
      shouldCreatePingMonitor: false,
    });

    const row: Locator = deviceRow({ page, name: deviceName });
    await expect(row).toBeVisible({ timeout: 30000 });

    /*
     * The verdict, and the qualifier beside it. "Pending" alone is what an
     * SNMP device queued for its first poll shows too, and that one fixes
     * itself; "No monitor" is what tells the operator this one will not.
     */
    await expect(row.getByText("Pending", { exact: true })).toBeVisible({
      timeout: 30000,
    });
    await expect(row.getByText("No monitor", { exact: true })).toBeVisible({
      timeout: 30000,
    });
  });

  test("ticking Create a Ping monitor creates and binds one on save", async ({
    page,
  }: {
    page: Page;
  }) => {
    const projectId: string = await registerAndCreateProject({
      page,
      projectNamePrefix: "E2E Network Device Project",
    });

    const deviceName: string =
      "E2E Pinged PDU " + Faker.generateName().toString();

    await createMonitorBackedDevice({
      page,
      projectId,
      name: deviceName,
      shouldCreatePingMonitor: true,
    });

    /*
     * The monitor exists under Monitors, named after the DEVICE - that is
     * what an operator scanning the monitor list is looking for, and the
     * name every provisioning surface agrees on (PingMonitorBuilder).
     */
    await gotoProjectPage({
      page,
      projectId,
      url: monitorsUrl(projectId),
      ready: page.getByText(`Ping ${deviceName}`).first(),
    });

    await expect(page.getByText(`Ping ${deviceName}`).first()).toBeVisible({
      timeout: 30000,
    });

    /*
     * And the device is bound to it. The row is not asserted to read "Up":
     * that would be the monitor's starting status, not a verdict, and the
     * address is unroutable by design. What has to be true is that the
     * "No monitor" qualifier is gone.
     */
    await openDevicesList({ page, projectId });

    const row: Locator = deviceRow({ page, name: deviceName });
    await expect(row).toBeVisible({ timeout: 30000 });
    await expect(row.getByText("No monitor", { exact: true })).toHaveCount(0, {
      timeout: 30000,
    });
  });
});
