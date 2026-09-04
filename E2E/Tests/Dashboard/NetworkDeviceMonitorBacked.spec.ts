import { BASE_URL } from "../../Config";
import {
  gotoProjectPage,
  registerAndCreateProject,
} from "./Helpers/ProductOnboarding";
import { APIResponse, Locator, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";

/*
 * Registering a network device, and reaching the monitor-backed override,
 * end to end.
 *
 * Ping-first polling changed what registering a device means, and the create
 * form is where a user meets that change. A device is now registered with a
 * name, an address, a site and a PROBE; the probe pings it on its schedule,
 * so it has a status from its first poll with no monitor and no SNMP
 * credentials. The form no longer asks "how is this device monitored?" at
 * all — the bound-monitor override is a rare answer to "nothing can reach
 * this one", and it lives on the device's Settings page.
 *
 * Three things have to hold, and none of them is visible from a unit test
 * that mocks the form:
 *
 *   1. a device saves with nothing but a name, an address and a probe — no
 *      monitoring-method question, no monitor, no community string — and it
 *      is genuinely probe-polled afterwards (the API says so), so the list
 *      never tags it "No monitor". That qualifier belongs to devices nothing
 *      polls, and a probe-polled device is not one of them;
 *
 *   2. ticking "Also create a Ping monitor for incidents" on that same form
 *      still creates a monitor named "Ping <device name>" and binds it before
 *      the modal closes. The probe already gives the device a status, so this
 *      opt-in buys incidents, not reachability — and it is still off by
 *      default because a monitor is billable and plan-limited;
 *
 *   3. the monitor-backed override is still reachable, now from the device's
 *      Settings page, and a device switched to it with nothing bound reads
 *      "Pending" tagged "No monitor" on the list — the honest copy for a
 *      device that nothing polls and nothing reports on. This is the coverage
 *      the old version of this spec got through the create form, which no
 *      longer offers that choice.
 *
 * Nothing here waits for a probe result. A fresh monitor carries the
 * project's operational status from the moment it is created, and a probe's
 * verdict on an unroutable address is not the point of any of these tests —
 * they assert on what was registered and how it is described, never on
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
 * so neither the probe's ping nor a Ping monitor created for this device can
 * accidentally reach something real from wherever the probes happen to run.
 * The spec never waits for a result from it.
 */
const UNROUTABLE_HOSTNAME: string = "192.0.2.10";

const CREATE_DEVICE_BUTTON_NAME: string = "Create Network Device";

/*
 * The exact string NetworkDevice.monitoringMethod must hold for a device this
 * form created. Spelled out rather than imported from the
 * NetworkDeviceMonitoringMethod enum on purpose: the column is free text (the
 * SnmpVersion precedent), every reader parses it leniently, and what this
 * spec is pinning is the value that actually reaches the wire and the
 * database - which an enum rename would change without this test noticing.
 */
const PROBE_POLLED_METHOD: string = "Probe";

type DevicesUrlFunction = (projectId: string) => string;

const devicesUrl: DevicesUrlFunction = (projectId: string): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(`/dashboard/${projectId}/network-devices`)
    .toString();
};

type DeviceSettingsUrlFunction = (data: {
  projectId: string;
  deviceId: string;
}) => string;

const deviceSettingsUrl: DeviceSettingsUrlFunction = (data: {
  projectId: string;
  deviceId: string;
}): string => {
  return URL.fromString(BASE_URL.toString())
    .addRoute(
      `/dashboard/${data.projectId}/network-devices/${data.deviceId}/settings`,
    )
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
 * INSIDE the row so a "Pending" or "No monitor" on some other row cannot
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
 * What the server actually stored, read back through the CRUD API with the
 * authenticated browser session (page.request shares the login cookies).
 *
 * The list's pills describe a device; this is the device. Test 1 turns on
 * the difference: "no No-monitor pill" is a statement about rendering, and
 * `monitoringMethod = Probe` with a probe attached is the fact underneath it
 * that makes the pill's absence meaningful rather than accidental.
 */
interface StoredDevice {
  id: string;
  monitoringMethod: string;
  probeId: string;
}

type ToIdFunction = (value: unknown) => string;

/** Ids come back as a bare string or { _type: "ObjectID", value }. */
const toId: ToIdFunction = (value: unknown): string => {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  return String((value as Record<string, unknown>)["value"] || "");
};

type FetchDeviceFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
}) => Promise<StoredDevice>;

const fetchDevice: FetchDeviceFunction = async (data: {
  page: Page;
  projectId: string;
  name: string;
}): Promise<StoredDevice> => {
  const response: APIResponse = await data.page.request.post(
    URL.fromString(BASE_URL.toString())
      .addRoute("/api/network-device/get-list")
      .toString(),
    {
      headers: {
        "content-type": "application/json",
        tenantid: data.projectId,
      },
      data: {
        query: { projectId: data.projectId, name: data.name },
        select: { _id: true, monitoringMethod: true, probeId: true },
        limit: 5,
        skip: 0,
        sort: {},
      },
    },
  );

  expect(
    response.ok(),
    `List network devices failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const body: any = await response.json();
  const rows: Array<any> = (body?.data || []) as Array<any>;

  expect(rows.length, `No device named "${data.name}" came back`).toEqual(1);

  return {
    id: toId(rows[0]?._id),
    monitoringMethod: String(rows[0]?.monitoringMethod || ""),
    probeId: toId(rows[0]?.probeId),
  };
};

/*
 * Picks the first option of a dropdown and returns the label it chose.
 *
 * Used for the Probe field, whose options are environment-dependent: a fresh
 * project has whatever global probes the deployment seeded ("Probe-1" and
 * friends, config-driven names), and custom probes are plan-gated, so there
 * is no name this spec could hard-code. What matters is that SOME probe is
 * picked - the field is required now, because a probe-polled device with no
 * probe is a device nothing pings.
 */
type SelectFirstOptionFunction = (data: {
  page: Page;
  combobox: Locator;
}) => Promise<string>;

const selectFirstOption: SelectFirstOptionFunction = async (data: {
  page: Page;
  combobox: Locator;
}): Promise<string> => {
  await data.combobox.waitFor({ state: "visible", timeout: 30000 });
  await data.combobox.click();

  const firstOption: Locator = data.page.getByRole("option").first();
  await firstOption.waitFor({ state: "visible", timeout: 30000 });

  const label: string = ((await firstOption.textContent()) || "").trim();

  await firstOption.click();

  return label;
};

/*
 * Walks the create form for an ordinary device.
 *
 * The form is a stepped ModelFormModal with THREE steps and no monitoring
 * question among them: Device Details -> Probe & Site -> SNMP (Optional).
 * The SNMP step is shown for every device and required by none, so the
 * footer button - which keeps the "modal-footer-submit-button" test id on
 * every step - reads "Next" twice and then "Save".
 */
type CreateDeviceFunction = (data: {
  page: Page;
  projectId: string;
  name: string;
  shouldCreatePingMonitor: boolean;
}) => Promise<void>;

const createDevice: CreateDeviceFunction = async (data: {
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

  const footerButton: Locator = page.getByTestId("modal-footer-submit-button");

  // Step 1 - Device Details: the two required fields, and nothing else.
  const nameField: Locator = modal.getByPlaceholder("core-switch-01");
  await nameField.waitFor({ state: "visible", timeout: 30000 });

  /*
   * The question that is gone. It used to be step 1 of this form and it
   * decided everything downstream; asserting its absence here is what stops
   * it growing back, because every other assertion in this file would still
   * pass if the form asked it again and defaulted to Probe.
   */
  await expect(
    modal.getByRole("combobox", { name: /How is this device monitored/ }),
  ).toHaveCount(0);

  await nameField.fill(data.name);
  await modal
    .getByPlaceholder("10.0.0.1 or switch-01.example.com")
    .fill(UNROUTABLE_HOSTNAME);

  await expect(footerButton).toHaveText("Next", { timeout: 30000 });
  await footerButton.click();

  /*
   * Step 2 - Probe & Site. The probe is REQUIRED here now: it is the thing
   * that will ping the device. The site is left empty - a device does not
   * need one - and so the site's default probe never fills this in for us.
   */
  const probeCombo: Locator = modal.getByRole("combobox", {
    name: /^Probe\b/,
  });
  const probeName: string = await selectFirstOption({
    page,
    combobox: probeCombo,
  });

  /*
   * An empty label means the dropdown opened with nothing in it. Said here
   * rather than left to the required-field error on the next click, because
   * "this deployment seeded no probe" and "the form stopped asking for one"
   * are very different failures and only this one names the cause.
   */
  expect(
    probeName,
    "The Probe dropdown offered no probe to poll the device with",
  ).not.toEqual("");

  /*
   * The Ping monitor opt-in. Off by default on purpose: the probe above
   * already gives the device a status, so this creates a billable,
   * plan-limited monitor for INCIDENTS and nothing else - which is a thing
   * to choose, never a thing to inherit. Matched loosely on "Ping monitor"
   * so a reworded label does not silently stop the box being ticked (a
   * checkbox locator that matches nothing would make test 2 pass while
   * creating no monitor at all - hence the explicit visibility wait).
   */
  const createPingMonitorCheckbox: Locator = modal.getByRole("checkbox", {
    name: /Ping monitor/i,
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

  await expect(footerButton).toHaveText("Next", { timeout: 30000 });
  await footerButton.click();

  /*
   * Step 3 - SNMP (Optional), left entirely empty. That is the whole point
   * of ping-first polling: no community string, no v3 user, and the device
   * is still polled. It is the last step, so the button reads "Save".
   */
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

test.describe.skip(
  "Network device registration and the monitor-backed override",
  () => {
    test.beforeEach(() => {
      test.setTimeout(420000);
    });

    test("a device saves with a name, an address and a probe, and is probe-polled", async ({
      page,
    }: {
      page: Page;
    }) => {
      const projectId: string = await registerAndCreateProject({
        page,
        projectNamePrefix: "E2E Network Device Project",
      });

      const deviceName: string =
        "E2E Pinged AP " + Faker.generateName().toString();

      await createDevice({
        page,
        projectId,
        name: deviceName,
        shouldCreatePingMonitor: false,
      });

      /*
       * The fact under the pill. "Probe" is the only method this form
       * produces, and a probe is attached, so something really is going to
       * ping this device - which is what makes the missing "No monitor"
       * qualifier below correct rather than merely absent.
       */
      const stored: StoredDevice = await fetchDevice({
        page,
        projectId,
        name: deviceName,
      });
      expect(stored.monitoringMethod).toEqual(PROBE_POLLED_METHOD);
      expect(stored.probeId).not.toEqual("");

      const row: Locator = deviceRow({ page, name: deviceName });
      await expect(row).toBeVisible({ timeout: 30000 });

      /*
       * "No monitor" says nothing reports this device's health, and that is
       * false here: its probe does. The qualifier is reserved for the
       * monitor-backed override with nothing bound (test 3), and a device
       * registered through this form is never one of those.
       */
      await expect(row.getByText("No monitor", { exact: true })).toHaveCount(
        0,
        {
          timeout: 30000,
        },
      );
    });

    test("ticking the Ping monitor opt-in creates and binds one on save", async ({
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

      await createDevice({
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
       * And the device is still probe-polled. Binding a Ping monitor does not
       * turn a device into a monitor-backed one: the probe goes on polling it
       * and the monitor is there for incidents. If this ever flipped to
       * Monitor, the device would silently stop being walked and polled.
       */
      const stored: StoredDevice = await fetchDevice({
        page,
        projectId,
        name: deviceName,
      });
      expect(stored.monitoringMethod).toEqual(PROBE_POLLED_METHOD);
    });

    test("switching a device to the bound-monitor override leaves it Pending, tagged No monitor", async ({
      page,
    }: {
      page: Page;
    }) => {
      const projectId: string = await registerAndCreateProject({
        page,
        projectNamePrefix: "E2E Network Device Project",
      });

      const deviceName: string =
        "E2E Overridden Switch " + Faker.generateName().toString();

      await createDevice({
        page,
        projectId,
        name: deviceName,
        shouldCreatePingMonitor: false,
      });

      const stored: StoredDevice = await fetchDevice({
        page,
        projectId,
        name: deviceName,
      });

      await gotoProjectPage({
        page,
        projectId,
        url: deviceSettingsUrl({ projectId, deviceId: stored.id }),
        ready: page.getByRole("button", { name: "Edit Settings" }),
      });

      await page.getByRole("button", { name: "Edit Settings" }).click();

      const modal: Locator = page.getByTestId("modal");
      await modal.waitFor({ state: "visible", timeout: 30000 });

      /*
       * The choice the create form no longer offers, in the one place that
       * does. Both options are matched on their leading words rather than the
       * whole sentence: the labels are long on purpose (they have to say that
       * Probe pings and walks, and that Bound monitor stops polling), and a
       * copy edit to the tail of either is not a regression.
       */
      const methodCombo: Locator = modal.getByRole("combobox", {
        name: /^Monitoring Method\b/,
      });
      await methodCombo.waitFor({ state: "visible", timeout: 30000 });
      await methodCombo.click();
      await page
        .getByRole("option", { name: /^Bound monitor/ })
        .click({ timeout: 30000 });

      /*
       * The Monitor dropdown is deliberately left empty. The binding is
       * optional everywhere - the point of this test is the honest copy for a
       * device that has the override and nothing bound.
       *
       * Switching to the override also hides the SNMP step (nothing polls the
       * device, so a community string has nothing to be used for), which is
       * why "Device Details" is now the last step and the footer says Save.
       */
      const footerButton: Locator = page.getByTestId(
        "modal-footer-submit-button",
      );
      await expect(footerButton).toHaveText("Save", { timeout: 30000 });
      await footerButton.click();

      await modal.waitFor({ state: "hidden", timeout: 60000 });

      await openDevicesList({ page, projectId });

      const row: Locator = deviceRow({ page, name: deviceName });
      await expect(row).toBeVisible({ timeout: 30000 });

      /*
       * The verdict, and the qualifier beside it. "Pending" alone is also what
       * a device waiting for its first poll shows, and that one fixes itself;
       * "No monitor" is what tells the operator this one will not - the switch
       * to the override stopped its polling and cleared the results it had.
       */
      await expect(row.getByText("Pending", { exact: true })).toBeVisible({
        timeout: 30000,
      });
      await expect(row.getByText("No monitor", { exact: true })).toBeVisible({
        timeout: 30000,
      });
    });
  },
);
