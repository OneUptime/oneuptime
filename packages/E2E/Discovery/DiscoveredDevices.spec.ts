import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import path from "path";

/*
 * Network > Topology > Discovered Devices (OneUptime issue #5775): every
 * device the offices' switches, a router's ARP table and a network
 * controller have seen, monitored or not - found by name, IP, MAC or
 * vendor, added to monitoring a selection at a time through the same import
 * as a scan's, and hidden from the topology map (or shown on it again) in
 * bulk, behind a confirmation that deletes nothing.
 *
 * The real page, Table, bulk bar, confirmation, Add to monitoring dialog,
 * Monitoring step and import progress, in a real browser, against the
 * synthetic rows of DiscoveredDevicesFixture.js. The list's API is the one
 * the rendered Dashboard suites use (DiscoveredDevicesFakeServer: search,
 * counts, paging and select-all are the server's), and the import is
 * ImportFixture.js's, which settles a few devices each time the dialog
 * asks. Screenshots for the UI review go to output/playwright/discovery/.
 */

interface ListCall {
  path: string;
  body: Record<string, unknown>;
}

interface DiscoveredImportStart {
  endpointIds: Array<string>;
  settings: Record<string, unknown>;
}

const PROJECT: string = "10000000-0000-4000-8000-000000000001";
const route: string = `/dashboard/${PROJECT}/network-devices/endpoints`;
const screenshots: string = path.resolve(
  __dirname,
  "../../../output/playwright/discovery",
);
const repository: string = path.resolve(__dirname, "../../..");

function deviceId(index: number): string {
  return `51000000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

const CAMERA: string = deviceId(1);
const PRINTER: string = deviceId(2);
const NO_ADDRESS: string = deviceId(3);
const LAPTOP: string = deviceId(4);
const ROUTER: string = deviceId(5);
const PROJECTOR: string = deviceId(6);
const PHONE_101: string = deviceId(10);
const PHONE_102: string = deviceId(11);

const CAMERA_ROLE: string = "70000000-0000-4000-8000-000000000003";
const OFFICE_PROFILE: string = "54000000-0000-4000-8000-000000000001";

function show(page: Page, name: string = "Show"): Locator {
  return page.getByRole("radiogroup", { name: name });
}

function checkedShow(page: Page): Locator {
  return show(page).getByRole("radio", { checked: true });
}

async function openList(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${route}${query}`);
  await expect(page.getByTestId("discovered-devices")).toBeVisible();
  // The first answer is in: each choice carries its count.
  await expect(show(page).getByRole("radio", { name: /^All/ })).toHaveText(
    /\d/,
  );
}

async function pickShow(page: Page, label: RegExp): Promise<void> {
  await show(page).getByRole("radio", { name: label }).click();
  await expect(show(page).getByRole("radio", { name: label })).toHaveAttribute(
    "aria-checked",
    "true",
  );
}

function rowOf(page: Page, name: string): Locator {
  return page
    .locator("tr")
    .filter({ has: page.getByText(name, { exact: true }) });
}

const REGEXP_SPECIAL: RegExp = /[.*+?^$(){}|[\]\\]/g;

function selectBox(page: Page, label: string): Locator {
  return page.getByRole("checkbox", {
    name: new RegExp("^Select " + label.replace(REGEXP_SPECIAL, "\\$&")),
  });
}

async function runBulk(page: Page, action: string): Promise<void> {
  await page.getByText("Bulk Actions", { exact: true }).click();
  await page.getByRole("menuitem", { name: action, exact: true }).click();
}

async function search(page: Page, text: string): Promise<void> {
  const input: Locator = page.getByTestId("discovered-devices-search");

  if (!(await input.isVisible())) {
    await page.getByRole("button", { name: "Open search" }).click();
  }

  await input.fill(text);
}

async function listCalls(page: Page, ending: string): Promise<Array<ListCall>> {
  return page.evaluate((suffix: string): Array<ListCall> => {
    const calls: Array<ListCall> = (
      window as unknown as {
        __discoveryFixture: { discovered: { calls: Array<ListCall> } };
      }
    ).__discoveryFixture.discovered.calls;

    return JSON.parse(
      JSON.stringify(
        calls.filter((call: ListCall): boolean => {
          return call.path.endsWith(suffix);
        }),
      ),
    );
  }, ending);
}

async function importStarts(page: Page): Promise<Array<DiscoveredImportStart>> {
  return page.evaluate((): Array<DiscoveredImportStart> => {
    return JSON.parse(
      JSON.stringify(
        (
          window as unknown as {
            __discoveryFixture: {
              discoveredImportStarts: Array<DiscoveredImportStart>;
            };
          }
        ).__discoveryFixture.discoveredImportStarts,
      ),
    );
  });
}

function dialog(page: Page): Locator {
  return page.getByRole("dialog").last();
}

// A react-select of the dialog, once its rows are read: open, then pick.
async function pickOption(
  page: Page,
  field: string,
  dropdownId: string,
  option: string,
): Promise<void> {
  await expect(
    dialog(page).getByRole("combobox", { name: field, exact: true }),
  ).toBeEnabled();
  await page.locator(`#${dropdownId}`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
}

// The bulk action's result, closed: the selection is cleared and read again.
async function closeResult(page: Page): Promise<void> {
  const close: Locator = page.getByTestId("modal-footer-submit-button");
  await expect(close).toHaveText("Close");
  await close.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

// How far the page runs past the window sideways: 0 when nothing does.
async function pageOverflow(page: Page): Promise<number> {
  return page.evaluate((): number => {
    const root: HTMLElement = document.scrollingElement as HTMLElement;
    return root.scrollWidth - root.clientWidth;
  });
}

test("opens on the devices not monitored yet, with what each one is, where it was seen and its state", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);

  // 21 devices: 20 not monitored (one of them hidden), one monitored.
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*20$/);
  await expect(
    show(page).getByRole("radio", { name: /^Monitored/ }),
  ).toHaveText(/^Monitored\s*1$/);
  await expect(
    show(page).getByRole("radio", { name: /^Hidden from map/ }),
  ).toHaveText(/^Hidden from map\s*1$/);
  await expect(show(page).getByRole("radio", { name: /^All/ })).toHaveText(
    /^All\s*21$/,
  );

  // A classified camera: its name, its hostname under it, and every column.
  const camera: Locator = rowOf(page, "Lobby camera");
  await expect(camera).toContainText("cam-lobby.example.internal");
  await expect(camera).toContainText("10.20.0.11");
  await expect(camera).toContainText("00:1a:2b:3c:00:01");
  await expect(camera).toContainText("Axis Communications");
  await expect(
    camera.getByRole("link", { name: "access-sw-02", exact: true }),
  ).toBeVisible();
  await expect(camera).toContainText("Gi1/0/1 · VLAN 30");
  await expect(camera).toContainText("minutes ago");
  await expect(
    page.getByTestId(`discovered-device-state-${CAMERA}`),
  ).toHaveText("Discovered only");
  // The row's own button says "Add": its name is still the whole action.
  const add: Locator = camera.getByRole("button", {
    name: "Add to monitoring",
  });
  await expect(add).toBeEnabled();
  await expect(add).toHaveText("Add");

  // Named by its hostname, it is not said twice.
  await expect(
    rowOf(page, "printer-2f.example.internal").getByText(
      "printer-2f.example.internal",
    ),
  ).toHaveCount(1);

  // Not seen for ten days; hidden from the map; no address yet.
  await expect(rowOf(page, "projector-3f.example.internal")).toContainText(
    "10 days ago",
  );
  await expect(
    page.getByTestId(`discovered-device-state-${PROJECTOR}`),
  ).toHaveText("Not seen recently");
  await expect(
    page.getByTestId(`discovered-device-state-${LAPTOP}`),
  ).toHaveText("Hidden from map");
  await expect(
    page.getByTestId(`discovered-device-state-${NO_ADDRESS}`),
  ).toHaveText("Discovered only");
  await expect(rowOf(page, "00:1a:2b:3c:00:03")).toContainText(
    "Gi1/0/24 · VLAN 99",
  );

  // A network controller placed it: its switch and port, with no VLAN.
  const door: Locator = rowOf(page, "door-controller");
  await expect(door).toContainText("warehouse-sw-01");
  await expect(door).toContainText("Gi1/0/31");
  await expect(door).not.toContainText("VLAN");

  // The monitored router is not in the list it opens on.
  await expect(page.getByText("Branch router", { exact: true })).toHaveCount(0);

  // Asked of the server: the first page of 25, last seen first.
  const reads: Array<ListCall> = await listCalls(page, "/list");
  expect(reads[0]!.body).toEqual({
    search: "",
    show: "notMonitored",
    sort: "lastSeen",
    sortOrder: "desc",
    limit: 25,
    skip: 0,
  });

  // Monitored: the router, with a link to the device that monitors it.
  await pickShow(page, /^Monitored/);
  await expect(
    page.getByTestId(`discovered-device-state-${ROUTER}`),
  ).toHaveText("Monitored");
  await expect(
    page.getByTestId(`discovered-device-monitored-${ROUTER}`),
  ).toHaveText("branch-rtr-01");
  await expect(
    rowOf(page, "Branch router").getByRole("button", {
      name: "Add to monitoring",
    }),
  ).toHaveCount(0);
  expect((await listCalls(page, "/list")).pop()!.body).toMatchObject({
    show: "monitored",
    skip: 0,
  });

  await fs.promises.mkdir(screenshots, { recursive: true });
  await pickShow(page, /^Not monitored/);
  await expect(rowOf(page, "Lobby camera")).toBeVisible();
  await page.screenshot({
    path: path.join(screenshots, "discovered-devices-desktop.png"),
    fullPage: true,
  });
});

test("the search runs on the server: a MAC typed without separators, a vendor or an address finds its devices", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);

  await search(page, "001a2b3c0001");
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*1$/);
  await expect(rowOf(page, "Lobby camera")).toBeVisible();
  await expect(
    page.getByText("printer-2f.example.internal", { exact: true }),
  ).toHaveCount(0);

  await search(page, "zebra");
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*4$/);
  await expect(rowOf(page, "Label printer")).toBeVisible();
  await expect(
    page.getByRole("checkbox", { name: /^Select scanner-0/ }),
  ).toHaveCount(3);
  await expect(page.getByText("Lobby camera", { exact: true })).toHaveCount(0);

  // The last request is the whole word, from the first page.
  const reads: Array<ListCall> = await listCalls(page, "/list");
  expect(reads[reads.length - 1]!.body).toMatchObject({
    search: "zebra",
    skip: 0,
  });

  // By address: the head office's 10.20.1.x desk phones.
  await search(page, "10.20.1.");
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*10$/);

  // Nothing matches: the list says so, and Clear search brings them back.
  await search(page, "no-such-device");
  const empty: Locator = page.getByTestId("discovered-devices-empty");
  await expect(
    empty.getByRole("heading", {
      name: "No discovered device matches this search",
    }),
  ).toBeVisible();
  await expect(empty).toContainText(
    "Search by a name, an IP address, a MAC address with or without separators, or a vendor.",
  );
  await page.getByTestId("discovered-devices-search-clear").click();
  await expect(rowOf(page, "Lobby camera")).toBeVisible();
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*20$/);
});

test("Add to monitoring adds a selection through the import, with the role and SNMP credentials picked, and they come back monitored", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);

  await selectBox(page, "Lobby camera").check();
  await selectBox(page, "printer-2f.example.internal").check();
  await selectBox(page, "00:1a:2b:3c:00:03").check();
  await runBulk(page, "Add to monitoring");

  const window: Locator = dialog(page);
  await expect(window).toContainText(
    "3 devices from the Discovered Devices list",
  );
  await expect(window.getByTestId("discovered-device-import-names")).toHaveText(
    "Lobby camera (10.20.0.11), printer-2f.example.internal (10.20.0.12)",
  );
  await expect(
    window.getByTestId("discovered-device-import-no-address"),
  ).toContainText("1 selected device has no IP address yet, so it is left out");

  /*
   * The scan import's Monitoring step, in the list's words: pinged until
   * credentials are picked, then walked with them.
   */
  await expect(
    window.getByTestId("discovery-import-monitoring-step"),
  ).toBeVisible();
  await expect(
    window.getByTestId("discovery-import-outcome-ping"),
  ).toContainText("2 devices are pinged every 5 min.");

  await pickOption(
    page,
    "Device Role",
    "discovered-device-import-role",
    "Camera",
  );
  await pickOption(
    page,
    "SNMP Credential Profile",
    "discovered-device-import-snmp",
    "Office SNMP v3",
  );
  await expect(
    window.getByTestId("discovery-import-outcome-snmp"),
  ).toContainText(
    "2 devices are walked every 5 min for interfaces, inventory and health, with the SNMP credentials you picked.",
  );
  await expect(window.getByTestId("discovery-import-outcome-ping")).toHaveCount(
    0,
  );

  await fs.promises.mkdir(screenshots, { recursive: true });
  await window.screenshot({
    path: path.join(screenshots, "discovered-devices-add-dialog.png"),
  });

  const submit: Locator = page.getByTestId("modal-footer-submit-button");
  await expect(submit).toHaveText("Add 2 devices");
  await expect(submit).toBeEnabled();
  await submit.click();

  await expect(page.getByTestId("discovery-import-progress-title")).toHaveText(
    "Import finished",
    { timeout: 60000 },
  );

  // Only the devices it can add, by the list's ids, with what was picked.
  const starts: Array<DiscoveredImportStart> = await importStarts(page);
  expect(starts).toHaveLength(1);
  expect(starts[0]!.endpointIds).toEqual([CAMERA, PRINTER]);
  expect(starts[0]!.settings).toEqual({
    pollingIntervalInMinutes: 5,
    applyVendorTemplates: true,
    alerting: "None",
    networkDeviceRoleId: CAMERA_ROLE,
    snmpCredentialProfileId: OFFICE_PROFILE,
  });

  await window.screenshot({
    path: path.join(screenshots, "discovered-devices-add-finished.png"),
  });
  await page.getByRole("button", { name: "Done", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Read again: the two are monitored now, and left the list they were in.
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*18$/);
  await expect(page.getByText("Lobby camera", { exact: true })).toHaveCount(0);
  await expect(
    page.getByTestId(`discovered-device-state-${NO_ADDRESS}`),
  ).toHaveText("Discovered only");

  await pickShow(page, /^Monitored/);
  await expect(checkedShow(page)).toHaveText(/^Monitored\s*3$/);
  await expect(
    page.getByTestId(`discovered-device-state-${CAMERA}`),
  ).toHaveText("Monitored");
  await expect(
    page.getByTestId(`discovered-device-monitored-${CAMERA}`),
  ).toHaveText("Lobby camera");
  await expect(
    page.getByTestId(`discovered-device-state-${PRINTER}`),
  ).toHaveText("Monitored");
});

test("Hide from map asks first, says nothing is deleted, hides the selection in one request, and Show on map brings it back", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);

  await selectBox(page, "desk-phone-101").check();
  await selectBox(page, "desk-phone-102").check();
  await runBulk(page, "Hide from map");

  const confirmation: Locator = dialog(page);
  await expect(confirmation).toContainText("Hide 2 devices from the map?");
  await expect(confirmation).toContainText("Nothing is deleted");
  await expect(confirmation).toContainText(
    "monitored devices and their monitoring are never changed",
  );
  expect(await listCalls(page, "/hide-from-map")).toHaveLength(0);
  await fs.promises.mkdir(screenshots, { recursive: true });
  await confirmation.screenshot({
    path: path.join(screenshots, "discovered-devices-hide-confirmation.png"),
  });

  const confirm: Locator = page.getByTestId("modal-footer-submit-button");
  await expect(confirm).toHaveText("Hide from map");
  await confirm.click();

  await expect(page.getByText("2 devices hidden from the map")).toBeVisible();
  const hides: Array<ListCall> = await listCalls(page, "/hide-from-map");
  expect(hides).toHaveLength(1);
  expect([...(hides[0]!.body["endpointIds"] as Array<string>)].sort()).toEqual(
    [PHONE_101, PHONE_102].sort(),
  );
  await closeResult(page);

  // Still in the list, which says they are hidden.
  await expect(
    page.getByTestId(`discovered-device-state-${PHONE_101}`),
  ).toHaveText("Hidden from map");
  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*20$/);

  await pickShow(page, /^Hidden from map/);
  await expect(checkedShow(page)).toHaveText(/^Hidden from map\s*3$/);
  await expect(rowOf(page, "desk-phone-101")).toBeVisible();
  await expect(rowOf(page, "desk-phone-102")).toBeVisible();
  await expect(rowOf(page, "Spare laptop")).toBeVisible();

  // Hiding one already hidden leaves it as it was, and says so.
  await selectBox(page, "desk-phone-101").check();
  await runBulk(page, "Hide from map");
  await expect(dialog(page)).toContainText("Hide 1 device from the map?");
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByText("1 device left as it was")).toBeVisible();
  await closeResult(page);

  // A row's own ⋯ puts one back on the map.
  await rowOf(page, "desk-phone-101")
    .getByTestId("row-actions-more-button")
    .click();
  await page
    .getByRole("menuitem", { name: "Show on map", exact: true })
    .click();
  await expect(page.getByText("desk-phone-101", { exact: true })).toHaveCount(
    0,
  );
  const shows: Array<ListCall> = await listCalls(page, "/show-on-map");
  expect(shows[shows.length - 1]!.body).toEqual({ endpointIds: [PHONE_101] });

  // And the bulk menu the rest.
  await selectBox(page, "desk-phone-102").check();
  await selectBox(page, "Spare laptop").check();
  await runBulk(page, "Show on map");
  await expect(page.getByText("2 devices back on the map")).toBeVisible();
  await closeResult(page);
  await expect(
    page.getByTestId("discovered-devices-empty").getByRole("heading"),
  ).toHaveText("No discovered device is hidden from the map");
});

test("a device with no address yet cannot be added, and its row says why", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page);

  const add: Locator = rowOf(page, "00:1a:2b:3c:00:03").getByRole("button", {
    name: "Add to monitoring",
  });
  await expect(add).toBeDisabled();
  await add.locator("xpath=..").hover();
  await expect(page.getByRole("tooltip").last()).toHaveText(
    "No IP address yet: a device gets one once a router's ARP table or a network controller reports it.",
  );
  await page.mouse.move(0, 0);

  // A device with an address opens the import for itself alone.
  await rowOf(page, "Lobby camera")
    .getByRole("button", { name: "Add to monitoring" })
    .click();
  await expect(dialog(page).getByTestId("modal-description")).toHaveText(
    "Lobby camera",
  );
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
    "Add 1 device",
  );

  // Selected alone, it leaves nothing to add, and the window says why.
  await page.getByTestId("modal-footer-close-button").click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await selectBox(page, "00:1a:2b:3c:00:03").check();
  await runBulk(page, "Add to monitoring");
  await expect(
    dialog(page).getByTestId("discovered-device-import-nothing"),
  ).toContainText(
    "None of the selected devices can be added: each one is monitored already or has no IP address yet.",
  );
  await expect(page.getByTestId("modal-footer-submit-button")).toBeDisabled();
  expect(await importStarts(page)).toEqual([]);
});

test("selecting every device that matches reaches past the page, and Hide from map sends them in one request", async ({
  page,
}: {
  page: Page;
}) => {
  await openList(page, "?devices=many");

  await expect(checkedShow(page)).toHaveText(/^Not monitored\s*320$/);
  await expect(
    page.getByRole("checkbox", { name: /^Select pos-/ }),
  ).toHaveCount(25);

  await selectBox(page, "pos-").first().check();
  await page.getByTestId("bulk-update-select-all").click();
  await expect(page.getByTestId("bulk-update-card-count")).toHaveText(
    "320 Devices Selected",
  );
  expect((await listCalls(page, "/ids"))[0]!.body).toEqual({
    search: "",
    show: "notMonitored",
    sort: "lastSeen",
    sortOrder: "desc",
  });

  await runBulk(page, "Hide from map");
  await expect(dialog(page)).toContainText("Hide 320 devices from the map?");
  await page.getByTestId("modal-footer-submit-button").click();
  await expect(page.getByText("320 devices hidden from the map")).toBeVisible();

  const hides: Array<ListCall> = await listCalls(page, "/hide-from-map");
  expect(hides).toHaveLength(1);
  expect(hides[0]!.body["endpointIds"] as Array<string>).toHaveLength(320);
  await closeResult(page);

  await expect(
    show(page).getByRole("radio", { name: /^Hidden from map/ }),
  ).toHaveText(/^Hidden from map\s*320$/);
});

test("on a phone the list is cards, nothing runs off the screen, and a selection can still be added", async ({
  page,
}: {
  page: Page;
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await openList(page);

  await expect(page.getByTestId("table-cards-header")).toBeVisible();
  expect(await pageOverflow(page)).toBe(0);

  await selectBox(page, "Lobby camera").check();
  await runBulk(page, "Add to monitoring");
  await expect(page.getByTestId("modal-footer-submit-button")).toHaveText(
    "Add 1 device",
  );
  await expect(
    dialog(page).getByTestId("discovery-import-monitoring-step"),
  ).toBeVisible();

  const box: Awaited<ReturnType<Locator["boundingBox"]>> =
    await dialog(page).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(390);
  expect(await pageOverflow(page)).toBe(0);

  await fs.promises.mkdir(screenshots, { recursive: true });
  await page.screenshot({
    path: path.join(screenshots, "discovered-devices-add-dialog-mobile.png"),
  });
});

/*
 * For the UI review: the list at every width the Dashboard is used at, in
 * both themes, in German and in Persian (right to left), with Inter as
 * production serves it. Each shot is checked for a page that runs sideways.
 */
const SHOTS: Array<{
  name: string;
  width: number;
  query: string;
  dark?: boolean;
}> = [
  { name: "1280", width: 1280, query: "" },
  { name: "1024", width: 1024, query: "" },
  { name: "768", width: 768, query: "" },
  { name: "390", width: 390, query: "" },
  { name: "1280-dark", width: 1280, query: "", dark: true },
  { name: "390-dark", width: 390, query: "", dark: true },
  { name: "1280-de", width: 1280, query: "?lang=de" },
  { name: "768-de", width: 768, query: "?lang=de" },
  { name: "390-de", width: 390, query: "?lang=de" },
  { name: "1280-fa", width: 1280, query: "?lang=fa" },
  { name: "768-fa", width: 768, query: "?lang=fa" },
  { name: "390-fa", width: 390, query: "?lang=fa" },
];

// The words the Show choices are named by, in each language shot.
const SHOW_NAMES: Record<string, string> = {
  "": "Show",
  "?lang=de": "Anzeigen",
  "?lang=fa": "نمایش",
};

// Production's universal font rule, from the Dashboard's own index.ejs.
function interRules(): string {
  const index: string = fs.readFileSync(
    path.join(repository, "packages/App/FeatureSet/Dashboard/views/index.ejs"),
    "utf8",
  );
  const universal: RegExpMatchArray | null = index.match(/^\s*\*\s*\{[^}]*\}/m);

  if (!universal) {
    throw new Error("Dashboard index.ejs no longer has its `*` font rule");
  }

  return `@font-face{font-family:"Inter";font-style:normal;font-weight:100 900;font-display:swap;src:url("/fonts/InterVariable.woff2") format("woff2");}${universal[0]}`;
}

test("the list at 1280, 1024, 768 and 390 pixels, dark, German and Persian, never runs sideways", async ({
  page,
}: {
  page: Page;
}) => {
  test.setTimeout(300000);
  await page.route("**/fonts/InterVariable.woff2", (fontRoute: Route) => {
    return fontRoute.fulfill({
      path: path.join(
        repository,
        "packages/Common/Server/Static/Vendor/fonts/InterVariable.woff2",
      ),
      contentType: "font/woff2",
    });
  });
  const fontRules: string = interRules();
  await fs.promises.mkdir(screenshots, { recursive: true });

  for (const shot of SHOTS) {
    await page.setViewportSize({ width: shot.width, height: 1000 });
    await page.goto(`${route}${shot.query}`);
    await page.addStyleTag({ content: fontRules });

    if (shot.dark) {
      await page.evaluate((): void => {
        document.documentElement.classList.add("dark");
      });
    }

    // Drawn in the shot's own language, with its counts read.
    const choices: Locator = show(page, SHOW_NAMES[shot.query]!);
    await expect(choices.getByRole("radio", { checked: true })).toHaveText(
      /20$/,
    );
    await expect(
      page.getByTestId(`discovered-device-state-${CAMERA}`),
    ).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute(
      "dir",
      shot.query === "?lang=fa" ? "rtl" : "ltr",
    );
    await page.evaluate(async (): Promise<void> => {
      await document.fonts.load('600 14px "Inter"');
      await document.fonts.ready;
    });

    expect({ shot: shot.name, overflow: await pageOverflow(page) }).toEqual({
      shot: shot.name,
      overflow: 0,
    });
    await page.screenshot({
      path: path.join(screenshots, `discovered-devices-${shot.name}.png`),
      fullPage: true,
    });
    // The first screenful, at its own size, for reading the words.
    await page.screenshot({
      path: path.join(screenshots, `discovered-devices-${shot.name}-top.png`),
    });
  }
});
