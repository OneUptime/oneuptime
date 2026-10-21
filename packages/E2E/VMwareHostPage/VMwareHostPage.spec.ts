import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * An ESXi host's page inside its vCenter, in a browser, against the offline
 * fixture (VMwareHostPage/Fixture).
 *
 * The maintainer: "Currently, when we monitor VMware, we also monitor a
 * list of hosts, but when I click on 'View Host,' I do not see a lot of
 * data on the host. We do see data on the host page if monitored manually
 * via Open Telemetry. Can you please build the host page inside of VMware
 * and add more depth to it, just like the host page we have outside of
 * VMware? Please also make it easy for customers to observe those hosts."
 *
 * So, read the way a person reads it: who the host is and whether vCenter
 * still reports it; its resource tiles and charts over the picked range;
 * what is open on it; the VMs keeping it busy; its network adapters and
 * storage devices; which host alerts are on, and "Turn on N alerts" opening
 * the vCenter's Recommendations with exactly those selected; its details;
 * its Virtual Machines, Metrics and Logs tabs (how to ship its syslog, or
 * why a probe cannot); the states a host can be in; at a laptop's and a
 * phone's width, in dark mode and in German. The fixture records every
 * read, so the tests check what was asked for as well as what was drawn,
 * and that nothing the fixture does not model was asked for at all.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const VCENTER_ID: string = "31000000-0000-4000-8000-000000000001";
const HOST_NAME: string = "esx01.acme.example";
const DATACENTER: string = "dc-east";
const CLUSTER: string = "prod-cluster";

const VCENTER_PATH: string = `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`;
const HOST_PAGE: string = `${VCENTER_PATH}/hosts/${encodeURIComponent(
  `host/${DATACENTER}/${HOST_NAME}`,
)}`;
const CLUSTER_PAGE: string = `${VCENTER_PATH}/clusters/${encodeURIComponent(
  `cluster/${DATACENTER}/${CLUSTER}`,
)}`;

// The VMs on the host, the busiest first, and the one on another host.
const RUNNING_BY_CPU: Array<string> = [
  "db-primary",
  "ci-runner-01",
  "web-01",
  "web-02",
  "cache-01",
];
const ALL_ON_HOST: Array<string> = [
  ...RUNNING_BY_CPU,
  "analytics-worker-with-a-rather-long-name-01",
  "legacy-app",
  "ubuntu-24-template",
];
const OTHER_HOST_VM: string = "other-host-vm";

const HOST_ALERTS: Array<string> = [
  "Host CPU Saturation",
  "Host Memory Saturation",
  "Host Disk Latency High",
  "Host Network Packet Errors",
  "Host Network Packet Drops",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/vmware-host-page-ui",
);

// The Dashboard's German words, as the fixture draws them with ?lang=de.
const GERMAN: Record<string, string> = JSON.parse(
  fs.readFileSync(
    path.resolve(
      __dirname,
      "../../App/FeatureSet/Dashboard/src/Locales/de.json",
    ),
    "utf8",
  ),
) as Record<string, string>;

interface AggregateRequest {
  modelName: string;
  name: string;
  attributes: Record<string, string> | null;
}

interface ListRequest {
  modelName: string;
  query: Record<string, unknown> | null;
}

interface Recorded {
  listRequests: Array<ListRequest>;
  aggregateRequests: Array<AggregateRequest>;
  unhandled: Array<Record<string, unknown>>;
}

const pageErrors: Map<Page, Array<string>> = new Map();
const outsideRequests: Map<Page, Array<string>> = new Map();

test.beforeEach(async ({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  const outside: Array<string> = [];
  pageErrors.set(page, errors);
  outsideRequests.set(page, outside);

  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });

  // Nothing may leave the fixture: no CDN, no telemetry, no real API.
  await page.route("**/*", async (route: Route) => {
    const url: URL = new URL(route.request().url());

    if (url.hostname === "127.0.0.1") {
      await route.continue();
      return;
    }

    outside.push(url.toString());
    await route.abort();
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  expect(outsideRequests.get(page) || []).toEqual([]);

  if (!page.isClosed()) {
    const unhandled: Array<Record<string, unknown>> = await page.evaluate(
      (): Array<Record<string, unknown>> => {
        const fixture: Recorded | undefined = (
          window as unknown as { __vmwareHostPageFixture?: Recorded }
        ).__vmwareHostPageFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled).toEqual([]);
  }
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

async function recorded(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __vmwareHostPageFixture: Recorded })
      .__vmwareHostPageFixture;
  });
}

async function openHost(page: Page, query: string = ""): Promise<void> {
  await page.goto(`${HOST_PAGE}${query ? `?${query}` : ""}`);
  await expect(page.getByTestId("vmware-host-page")).toBeVisible();
  await expect(page.getByTestId("vmware-host-name")).toHaveText(HOST_NAME);
}

// The Overview once its metrics are in: every tile has its reading.
async function waitForOverview(page: Page): Promise<void> {
  await expect(page.getByTestId("vmware-host-tiles")).toBeVisible();
  await expect(page.getByTestId("vmware-host-charts")).toBeVisible();
  await expect(
    page.getByTestId("vmware-host-tiles").locator(".animate-pulse"),
  ).toHaveCount(0);
}

// A tab by its English name, whatever language draws it.
async function openTab(page: Page, name: string): Promise<Locator> {
  const tab: Locator = page.getByTestId(`tab-${name}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  return page.getByRole("tabpanel");
}

// No part of the page is wider than the window.
async function expectNoSidewaysScroll(page: Page): Promise<void> {
  const widths: { page: number; window: number } = await page.evaluate(
    (): { page: number; window: number } => {
      return {
        page: document.documentElement.scrollWidth,
        window: window.innerWidth,
      };
    },
  );

  expect(widths.page).toBeLessThanOrEqual(widths.window);
}

function tile(page: Page, title: string): Locator {
  return page
    .getByTestId("vmware-host-tiles")
    .locator(":scope > *")
    .filter({ hasText: title })
    .first();
}

// A tile's reading: the large figure under its title.
function tileValue(page: Page, title: string): Locator {
  return tile(page, title).locator("div.text-2xl");
}

function detailRow(page: Page, key: string): Locator {
  return page.getByTestId(`vmware-host-detail-${key}`);
}

/*
 * The hero's status: its word, then the sentence a screen reader hears
 * after it and a pointer sees as its title.
 */
async function expectStatus(
  page: Page,
  label: string,
  description: string,
): Promise<void> {
  const status: Locator = page.getByTestId("vmware-host-status");
  await expect(status).toHaveText(`${label} ${description}`);
  await expect(status).toHaveAttribute("title", description);
}

test.describe("a reporting host at a laptop's width", () => {
  test("says which host it is and how vCenter sees it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "open=1&alerts=some");

    await expectStatus(
      page,
      "Reporting",
      "vCenter reported this host's metrics in the last 15 minutes.",
    );
    await expect(page.getByTestId("vmware-host-location")).toHaveText(
      `ESXi host in cluster ${CLUSTER}, datacenter ${DATACENTER}`,
    );
    await expect(
      page.getByTestId("vmware-host-location").getByRole("link", {
        name: CLUSTER,
      }),
    ).toHaveAttribute("href", CLUSTER_PAGE);
    await expect(page.getByTestId("vmware-host-last-seen")).toHaveText(
      "Last seen 2 minutes ago",
    );

    const chips: Locator = page.getByTestId("vmware-host-chips");
    await expect(chips).toContainText("76.80 GHz CPU");
    await expect(chips).toContainText("512 GiB memory");
    await expect(chips).toContainText("7 VMs, 6 running");

    // vCenter reports this host: no notice between the hero and the tabs.
    await expect(page.getByTestId("vmware-host-report-notice")).toHaveCount(0);

    // The side menu keeps Hosts marked on one of its hosts' pages.
    const marked: Locator = page.locator("a.bg-indigo-50");
    await expect(marked).toHaveCount(1);
    await expect(marked).toHaveAttribute("href", `${VCENTER_PATH}/hosts`);
    await expect(marked).toContainText("Hosts");

    // The tabs a host page outside VMware has, with the host's VM count.
    await expect(page.getByRole("tab")).toHaveText([
      /^Overview$/,
      /^Virtual Machines\s*8$/,
      /^Metrics$/,
      /^Logs$/,
    ]);
    await expect(page.getByRole("tab", { name: /^Overview/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });

  test("reads its resources over the range: four tiles and four charts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page);
    await waitForOverview(page);

    await expect(tileValue(page, "CPU")).toHaveText(/^\d+(\.\d+)?%$/);
    await expect(tile(page, "CPU")).toContainText("of 76.80 GHz");
    await expect(tileValue(page, "Memory")).toHaveText(/^\d+(\.\d+)?%$/);
    await expect(tile(page, "Memory")).toContainText("of 512 GiB");
    await expect(tileValue(page, "Disk latency")).toHaveText(
      /^\d+(\.\d+)? ms$/,
    );
    await expect(tile(page, "Disk latency")).toContainText("slowest disk");
    await expect(tileValue(page, "Network")).toHaveText(
      /^\d+(\.\d+)? [KMG]?B\/s$/,
    );

    const charts: Locator = page.getByTestId("vmware-host-charts");
    await expect(charts.getByText("No data in this time range")).toHaveCount(0);
    await expect(charts.locator("svg.recharts-surface")).toHaveCount(4);

    // Every series read is this host's: its vCenter, datacenter and name.
    const reads: Array<AggregateRequest> = (await recorded(page))
      .aggregateRequests;
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) {
      expect(read.attributes).toMatchObject({
        "resource.vmware.vcenter.name": "vcenter-prod",
        "resource.vcenter.datacenter.name": DATACENTER,
        "resource.vcenter.host.name": HOST_NAME,
      });
    }
  });

  test("shows what is open on it, and nothing of another host", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "open=1");

    const events: Locator = page.getByTestId("vmware-host-open-event");
    await expect(events).toHaveCount(3);
    await expect(events.nth(0)).toContainText(
      "[VMware] Host Network Packet Errors - vcenter-prod",
    );
    // The host's name as vCenter capitalised it on the alert.
    await expect(events.nth(1)).toContainText(
      "[VMware] Host Disk Latency High (>50 ms) - vcenter-prod",
    );
    await expect(events.nth(2)).toContainText(
      "[VMware] Host CPU Saturation (>90%) - vcenter-prod",
    );
    await expect(
      page.getByText("[VMware] Host Memory Saturation (>90%) - vcenter-prod"),
    ).toHaveCount(0);

    await expect(
      events.nth(2).getByRole("link", {
        name: "[VMware] Host CPU Saturation (>90%) - vcenter-prod",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/incidents/60000000-0000-4000-8000-000000000001`,
    );
    await expect(
      events.nth(0).getByRole("link", {
        name: "[VMware] Host Network Packet Errors - vcenter-prod",
      }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/alerts/61000000-0000-4000-8000-000000000001`,
    );
    await expect(page.getByTestId("vmware-host-open-events-more")).toHaveCount(
      0,
    );
  });

  test("lists five open items, and how many more there are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "open=many");

    await expect(page.getByTestId("vmware-host-open-event")).toHaveCount(5);

    const more: Locator = page.getByTestId("vmware-host-open-events-more");
    await expect(more).toHaveText("2 more incidents");
    await expect(
      more.getByRole("link", { name: "2 more incidents" }),
    ).toHaveAttribute("href", `${VCENTER_PATH}/incidents`);
  });

  test("ranks the VMs keeping it busy, and marks the ones waiting for a CPU", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page);

    const busiest: Locator = page.getByTestId("vmware-host-busiest-vms");
    const rows: Locator = busiest.getByTestId("vmware-host-busy-vm");
    await expect(rows).toHaveCount(5);

    for (let index: number = 0; index < RUNNING_BY_CPU.length; index++) {
      await expect(
        rows.nth(index).getByRole("link", { name: RUNNING_BY_CPU[index]! }),
      ).toBeVisible();
    }

    // CPU Ready from 5%: db-primary (6.2%) and ci-runner-01 (12.4%) only.
    const ready: Locator = busiest.getByTestId("vmware-host-busy-vm-cpu-ready");
    await expect(ready).toHaveText(["CPU Ready 6.2%", "CPU Ready 12.4%"]);
    await expect(rows.nth(0)).toContainText("58.0 GiB of 64.0 GiB memory");
    await expect(rows.nth(0)).toContainText("78.4%");

    // Off, a template, another host's: none of them is busy here.
    for (const name of ["legacy-app", "ubuntu-24-template", OTHER_HOST_VM]) {
      await expect(busiest.getByText(name)).toHaveCount(0);
    }

    // A VM opens its own page.
    await rows.nth(0).getByRole("link", { name: "db-primary" }).click();
    await expect(page.getByTestId("stub-page")).toHaveText(
      `${VCENTER_PATH}/virtual-machines/${encodeURIComponent(
        "vm/4210aaaa-bbbb-cccc-dddd-000000000001",
      )}`,
    );
  });

  test("tells its network adapters and storage devices apart, trouble marked", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page);
    await waitForOverview(page);

    const adapters: Locator = page
      .getByTestId("vmware-host-network-adapters")
      .getByTestId("vmware-host-network-adapter");
    await expect(adapters).toHaveCount(2);
    await expect(adapters.nth(0)).toContainText("vmnic0");
    await expect(adapters.nth(1)).toContainText("vmnic1");
    // vmnic1 receives packets with errors; vmnic0 is clean.
    await expect(
      adapters.nth(0).getByTestId("vmware-host-trouble-rate"),
    ).toHaveCount(0);
    await expect(
      adapters.nth(1).getByTestId("vmware-host-trouble-rate"),
    ).toHaveText("0.4/s");

    const devices: Locator = page
      .getByTestId("vmware-host-storage-devices")
      .getByTestId("vmware-host-storage-device");
    await expect(devices).toHaveCount(2);
    await expect(devices.nth(0)).toContainText(
      "naa.600508b1001c4d41ad6b8b6d9c2a0f17",
    );
    // Reads take over 20 ms (amber) and writes over 50 ms (red) on the LUN.
    await expect(
      devices.nth(0).getByTestId("vmware-host-latency-warn"),
    ).toHaveCount(1);
    await expect(
      devices.nth(0).getByTestId("vmware-host-latency-danger"),
    ).toHaveCount(1);
    // The NVMe disk answers in under a millisecond.
    await expect(devices.nth(1)).toContainText("0.4 ms");
    await expect(
      devices.nth(1).getByTestId("vmware-host-latency-warn"),
    ).toHaveCount(0);
    await expect(
      devices.nth(1).getByTestId("vmware-host-latency-danger"),
    ).toHaveCount(0);
  });

  test("shows which host alerts are on and its details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "alerts=some");

    const alerts: Locator = page.getByTestId("vmware-host-alert");
    await expect(alerts).toHaveCount(5);

    for (let index: number = 0; index < HOST_ALERTS.length; index++) {
      await expect(alerts.nth(index)).toContainText(HOST_ALERTS[index]!);
      await expect(alerts.nth(index)).toContainText(
        index < 2 ? "On" : "Not set up",
      );
    }

    // An alert that is on opens its monitor.
    await expect(
      alerts.nth(0).getByRole("link", { name: "On" }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/70000000-0000-4000-8000-000000000001`,
    );
    await expect(page.getByTestId("vmware-host-alerts-turn-on")).toHaveText(
      "Turn on 3 alerts",
    );

    await expect(detailRow(page, "host")).toContainText(HOST_NAME);
    await expect(detailRow(page, "vcenter")).toContainText("vcenter-prod");
    await expect(detailRow(page, "datacenter")).toContainText(DATACENTER);
    await expect(
      detailRow(page, "cluster").getByRole("link", { name: CLUSTER }),
    ).toHaveAttribute("href", CLUSTER_PAGE);
    await expect(detailRow(page, "cpu")).toContainText("76.80 GHz");
    await expect(detailRow(page, "memory")).toContainText("512 GiB");
    await expect(detailRow(page, "vms")).toContainText("7 (6 running, 1 off)");
    await expect(detailRow(page, "templates")).toContainText("1");
    await expect(detailRow(page, "metrics-updated")).toContainText(
      "2 minutes ago",
    );
    await expect(detailRow(page, "inventory-id")).toContainText(
      `host/${DATACENTER}/${HOST_NAME}`,
    );

    await expectNoSidewaysScroll(page);
    await screenshot(page, "overview-1280");
  });

  test("with every host alert on, offers none to turn on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "alerts=all");

    const alerts: Locator = page.getByTestId("vmware-host-alert");
    await expect(alerts).toHaveCount(5);
    await expect(alerts.filter({ hasText: "Not set up" })).toHaveCount(0);
    await expect(page.getByTestId("vmware-host-alerts-turn-on")).toHaveCount(0);
  });

  test("a role that may not read monitors still sees the rest of the page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "alerts=denied");
    await waitForOverview(page);

    await expect(page.getByTestId("vmware-host-busiest-vms")).toBeVisible();
    await expect(page.getByTestId("vmware-host-details")).toBeVisible();
    await expect(page.getByTestId("vmware-host-alerts")).toHaveCount(0);
  });
});

test.describe("from the host to what it needs", () => {
  test("Turn on 3 alerts opens Recommendations with exactly those selected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "alerts=some");

    await page.getByTestId("vmware-host-alerts-turn-on").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${VCENTER_PATH}/recommendations`;
    });

    const selected: Array<string> = (
      new URL(page.url()).searchParams.get("select") || ""
    )
      .split(",")
      .sort();
    expect(selected).toEqual([
      "VMware:vmware-host-disk-latency-high",
      "VMware:vmware-host-network-packet-drops",
      "VMware:vmware-host-network-packet-errors",
    ]);

    for (const id of selected) {
      await expect(
        page.getByTestId(`recommendation-card-select-${id}`),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByText("3 monitors selected")).toBeVisible();
    // Nothing else is picked for them.
    await expect(
      page.getByTestId(
        "recommendation-card-select-VMware:vmware-vm-cpu-saturation",
      ),
    ).toHaveAttribute("aria-pressed", "false");

    await screenshot(page, "turn-on-alerts-recommendations");
  });

  test("View all 7 virtual machines opens the host's own list of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page);

    await page
      .getByRole("button", { name: "View all 7 virtual machines" })
      .click();
    await expect(
      page.getByRole("tab", { name: /^Virtual Machines/ }),
    ).toHaveAttribute("aria-selected", "true");

    const panel: Locator = page.getByRole("tabpanel");
    for (const name of ALL_ON_HOST) {
      await expect(
        panel.getByRole("link", { name, exact: true }),
      ).toBeVisible();
    }
    await expect(panel.getByText(OTHER_HOST_VM)).toHaveCount(0);

    // The VMs were read by this host's name and datacenter.
    const vmReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return (
        request.modelName === "VMwareResource" &&
        (request.query || {})["kind"] === "VirtualMachine"
      );
    });
    expect(vmReads.length).toBeGreaterThan(0);
    for (const read of vmReads) {
      expect(read.query).toMatchObject({
        hostName: HOST_NAME,
        datacenterName: DATACENTER,
      });
    }

    await expectNoSidewaysScroll(page);
    await screenshot(page, "virtual-machines-tab");

    await panel.getByRole("link", { name: "legacy-app", exact: true }).click();
    await expect(page.getByTestId("stub-page")).toHaveText(
      `${VCENTER_PATH}/virtual-machines/${encodeURIComponent(
        "vm/4210aaaa-bbbb-cccc-dddd-000000000007",
      )}`,
    );
  });

  test("the Metrics tab charts the host's CPU, memory, network and disk series", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page);

    const panel: Locator = await openTab(page, "Metrics");
    await expect(panel.getByText(`Host Metrics: ${HOST_NAME}`)).toBeVisible();

    for (const title of [
      "CPU Utilization",
      "Memory Usage",
      "Network Throughput",
      "Disk Throughput",
      "Disk Latency (max)",
      "Network Packet Errors",
      "Network Packet Drops",
    ]) {
      await expect(
        panel.getByText(title, { exact: true }).first(),
      ).toBeVisible();
    }

    await screenshot(page, "metrics-tab");
  });

  test("the Logs tab shows how to ship this host's syslog to the agent", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page);

    const panel: Locator = await openTab(page, "Logs");
    const setup: Locator = panel.getByTestId("vmware-host-logs-setup");
    await expect(setup).toBeVisible();
    await expect(setup).toContainText("No logs from this host yet");
    await expect(setup).toContainText(
      "Turn on the VMware agent's syslog listener",
    );
    await expect(
      setup.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", `${VCENTER_PATH}/documentation`);

    await expect(setup.getByTestId("vmware-host-logs-esxcli")).toContainText(
      "esxcli system syslog config set --loghost='udp://<agent-host>:5514'",
    );
    await expect(setup.getByTestId("vmware-host-logs-powercli")).toContainText(
      `Get-VMHost -Name '${HOST_NAME}'`,
    );
    await expect(
      setup.getByTestId("vmware-host-logs-powercli-cluster"),
    ).toContainText(`Get-Cluster -Name '${CLUSTER}'`);
    await expect(setup.getByTestId("vmware-host-logs-name-hint")).toContainText(
      `Lines show here when the host names itself ${HOST_NAME} in them.`,
    );
    await expect(
      setup.getByRole("link", { name: "Shipping ESXi syslog" }),
    ).toHaveAttribute(
      "href",
      "/docs/telemetry/vmware#optional-ship-esxi-syslog",
    );

    // The logs read are this vCenter's, sent by this host.
    const logReads: Array<ListRequest> = (
      await recorded(page)
    ).listRequests.filter((request: ListRequest): boolean => {
      return request.modelName.startsWith("LogItem");
    });
    expect(logReads.length).toBeGreaterThan(0);
    for (const read of logReads) {
      expect((read.query || {})["attributes"]).toMatchObject({
        hostname: HOST_NAME,
      });
    }

    await screenshot(page, "logs-tab-agent");
  });

  test("a probe-collected vCenter's Logs tab says why it has no syslog", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "collection=probe");

    const panel: Locator = await openTab(page, "Logs");
    const probe: Locator = panel.getByTestId("vmware-host-logs-probe");
    await expect(probe).toContainText("No logs from this host");
    await expect(probe).toContainText(
      "a probe reads the vSphere API only: it does not receive the syslog ESXi sends.",
    );
    const link: Locator = probe.getByRole("link", { name: "Probe or agent?" });
    await expect(link).toHaveAttribute(
      "href",
      "/docs/telemetry/vmware-agentless#probe-or-agent",
    );
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(panel.getByTestId("vmware-host-logs-setup")).toHaveCount(0);
  });
});

test.describe("the states a host can be in", () => {
  test("vCenter stopped reporting it: when, and where to look", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "state=not-reporting");

    await expectStatus(
      page,
      "Not reporting",
      "vCenter has sent no metrics for this host for more than 15 minutes.",
    );
    const notice: Locator = page.getByTestId("vmware-host-report-notice");
    await expect(notice).toContainText(
      "vCenter last reported this host 2 hours ago",
    );
    await expect(
      notice.getByRole("link", { name: "Check the vCenter" }),
    ).toHaveAttribute("href", VCENTER_PATH);
    await screenshot(page, "state-not-reporting");
  });

  test("listed, but no metrics yet: the tiles wait, the rest is there", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "state=no-data");

    await expectStatus(
      page,
      "No data yet",
      "vCenter lists this host, but has sent no metrics for it yet.",
    );
    await expect(page.getByTestId("vmware-host-report-notice")).toContainText(
      "Waiting for this host's first metrics",
    );
    await waitForOverview(page);
    for (const title of ["CPU", "Memory", "Disk latency", "Network"]) {
      await expect(tile(page, title)).toContainText("—");
    }
    await expect(
      page
        .getByTestId("vmware-host-charts")
        .getByText("No data in this time range"),
    ).toHaveCount(4);
    await expect(page.getByTestId("vmware-host-details")).toBeVisible();
    await screenshot(page, "state-no-data");
  });

  test("gone from the inventory: what happened, its old data, and the way back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "state=gone");

    await expectStatus(
      page,
      "Not in inventory",
      "This host is not in the vCenter's inventory any more.",
    );
    const notice: Locator = page.getByTestId("vmware-host-report-notice");
    await expect(notice).toContainText(
      "This host is not in the vCenter's inventory",
    );
    await expect(
      notice.getByRole("link", { name: "See all hosts" }),
    ).toHaveAttribute("href", `${VCENTER_PATH}/hosts`);

    // Nothing is known about it now: no last seen, no cluster row, no VMs.
    await expect(page.getByTestId("vmware-host-last-seen")).toHaveCount(0);
    await expect(detailRow(page, "cluster")).toHaveCount(0);
    await expect(page.getByTestId("vmware-host-busiest-vms")).toHaveCount(0);
    await expect(detailRow(page, "inventory-id")).toContainText(
      `host/${DATACENTER}/${HOST_NAME}`,
    );
    await screenshot(page, "state-gone");
  });

  test("a standalone host whose vCenter reports no per-device counters", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "standalone=1&devices=0");

    await expect(page.getByTestId("vmware-host-location")).toHaveText(
      `Standalone ESXi host in datacenter ${DATACENTER}`,
    );
    await expect(detailRow(page, "cluster")).toContainText(
      "None - a standalone host",
    );
    await waitForOverview(page);
    await expect(page.getByTestId("vmware-host-network-adapters")).toHaveCount(
      0,
    );
    await expect(page.getByTestId("vmware-host-storage-devices")).toHaveCount(
      0,
    );

    const panel: Locator = await openTab(page, "Logs");
    await expect(panel.getByTestId("vmware-host-logs-powercli")).toBeVisible();
    await expect(
      panel.getByTestId("vmware-host-logs-powercli-cluster"),
    ).toHaveCount(0);
  });

  test("a host that runs no VMs says so", async ({ page }: { page: Page }) => {
    await openHost(page, "vms=none");

    await expect(page.getByTestId("vmware-host-busiest-vms")).toHaveCount(0);
    await expect(detailRow(page, "vms")).toContainText("None");

    const panel: Locator = await openTab(page, "Virtual Machines");
    // The table's empty state draws the sentence without its full stop.
    await expect(panel).toContainText("This host runs no virtual machines");
  });
});

test.describe("on a phone, in dark mode and in German", () => {
  test("a phone reads every part without scrolling sideways", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openHost(page, "open=1&alerts=some");
    await waitForOverview(page);

    // Each device is a short list of its own, not a table to scroll.
    const adapters: Locator = page.getByTestId("vmware-host-network-adapters");
    await expect(adapters.locator("table")).toBeHidden();
    await expect(
      adapters.getByTestId("vmware-host-network-adapter-list"),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "overview-390");

    await openTab(page, "Virtual Machines");
    await expectNoSidewaysScroll(page);

    await openTab(page, "Logs");
    await expect(page.getByTestId("vmware-host-logs-setup")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "logs-tab-390");
  });

  test("dark mode draws the page on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "theme=dark&open=1&alerts=some");
    await waitForOverview(page);

    await expect(page.locator("html")).toHaveClass(/dark/);
    for (const testId of [
      "vmware-host-hero",
      "vmware-host-busiest-vms",
      "vmware-host-details",
    ]) {
      const background: string = await page
        .getByTestId(testId)
        .evaluate((element: Element): string => {
          // The first painted background, down from the part to its card.
          let node: Element | null = element;
          while (node) {
            const color: string = getComputedStyle(node).backgroundColor;
            if (color !== "rgba(0, 0, 0, 0)" && color !== "transparent") {
              return color;
            }
            node = node.firstElementChild;
          }
          return "";
        });
      expect(background).not.toBe("rgb(255, 255, 255)");
    }
    await screenshot(page, "overview-dark");
  });

  test("German reads the page in German, a phone's width included", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "lang=de&alerts=some");
    await waitForOverview(page);

    const tabs: Locator = page.getByRole("tab");
    await expect(tabs).toHaveCount(4);
    await expect(tabs.nth(0)).toHaveText(GERMAN["Overview"]!);
    await expect(tabs.nth(1)).toContainText(GERMAN["Virtual Machines"]!);
    await expect(tabs.nth(2)).toHaveText(GERMAN["Metrics"]!);
    await expect(tabs.nth(3)).toHaveText(GERMAN["Logs"]!);
    await expect(page.getByTestId("vmware-host-location")).toHaveText(
      `ESXi-Host im Cluster ${CLUSTER}, Rechenzentrum ${DATACENTER}`,
    );
    await expect(page.getByTestId("vmware-host-alerts-turn-on")).toHaveText(
      "3 Warnungen einschalten",
    );
    for (const title of [
      "Busiest virtual machines",
      "Network adapters",
      "Storage devices",
      "Host alerts",
    ]) {
      await expect(
        page.getByText(GERMAN[title]!, { exact: true }),
      ).toBeVisible();
    }

    await page.setViewportSize({ width: 390, height: 844 });
    await expectNoSidewaysScroll(page);
    await screenshot(page, "overview-german-390");

    // A host vCenter stopped reporting: when, in German, time and all.
    await openHost(page, "lang=de&state=not-reporting");
    await expect(page.getByTestId("vmware-host-report-notice")).toContainText(
      "vCenter hat diesen Host zuletzt vor 2 Stunden gemeldet",
    );
    await expectNoSidewaysScroll(page);
  });
});
