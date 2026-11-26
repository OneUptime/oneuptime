import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { describePageLanguages } from "../SuiteHelpers/LocaleChunks";

/*
 * An XCP-ng pool's pages, in a browser, against the offline fixture
 * (XcpNgPages/Fixture).
 *
 * Read the way an administrator reads them: the pool's Overview says what
 * needs attention first, the most urgent first - a halted host, a disabled
 * one, a storage repository nearly full and allocated past its size, a VM
 * that stopped after running - each one step from its own page; then the
 * tiles, the busiest VMs and hosts, every host and repository at a glance.
 * The VMs list leaves the hosts' control domains out until it is asked to
 * show them. A host's, a VM's and a storage repository's own page says who
 * it is, where it sits, what on it needs a look and what is open on it. A
 * calm pool says nothing, a brand-new one how to connect it, a disconnected
 * one does not trust its last inventory. At a laptop's and a phone's width,
 * in dark mode, in German and in Persian. The fixture records every read,
 * so the tests check that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const POOL_ID: string = "71000000-0000-4000-8000-000000000001";
const POOL_PATH: string = `/dashboard/${PROJECT_ID}/xcp-ng/${POOL_ID}`;

// The lab's UUIDs (Fixture/Data.js, from Tests/Ops/Fixtures/XcpNg).
const HOST: Record<string, string> = {
  prod1: "9c6c0b6e-4f2a-4a7e-8b1e-0d1f2a3b4c5d",
  prod2: "4e1d3a2b-7c8d-4e9f-a0b1-c2d3e4f5a6b7",
  prod3: "f0e1d2c3-b4a5-4968-8776-655443322110",
};
const VM: Record<string, string> = {
  web01: "e8a5b2c1-3d4e-4f5a-8b6c-7d8e9f0a1b2c",
  db01: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
};
const SR: Record<string, string> = {
  nfs: "1d2c3b4a-5e6f-4789-9abc-def012345678",
};

function hostPath(uuid: string): string {
  return `${POOL_PATH}/hosts/${uuid}`;
}

function vmPath(uuid: string): string {
  return `${POOL_PATH}/vms/${uuid}`;
}

function storagePath(uuid: string): string {
  return `${POOL_PATH}/storage/${uuid}`;
}

// The busy pool's attention list, most urgent first (Fixture/Data.js).
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: `Host:${HOST["prod3"]}`, severity: "critical" },
  { key: `Host:${HOST["prod2"]}`, severity: "warning" },
  { key: `StorageRepository:${SR["nfs"]}`, severity: "warning" },
  { key: `VM:${VM["web01"]}`, severity: "warning" },
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/xcp-ng-pages-ui",
);

function locale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.resolve(
        __dirname,
        `../../App/FeatureSet/Dashboard/src/Locales/${language}.json`,
      ),
      "utf8",
    ),
  ) as Record<string, string>;
}

// The Dashboard's German and Persian words, as the fixture draws them.
const GERMAN: Record<string, string> = locale("de");
const PERSIAN: Record<string, string> = locale("fa");

// A Latin digit, which a Persian count should not mix with its own.
const LATIN_DIGIT: RegExp = /[0-9]/;

interface Recorded {
  unhandled: Array<Record<string, unknown>>;
  aggregateRequests: Array<{
    name: string;
    attributes: Record<string, unknown> | null;
  }>;
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
          window as unknown as { __xcpNgPagesFixture?: Recorded }
        ).__xcpNgPagesFixture;
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

async function openPage(
  page: Page,
  pathname: string,
  query: string = "",
): Promise<void> {
  await page.goto(`${pathname}${query ? `?${query}` : ""}`);
}

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await openPage(page, POOL_PATH, query);
  await expect(page.getByTestId("xcp-ng-overview")).toBeVisible();
  await expect(page.getByTestId("xcp-ng-hero-last-seen")).toBeVisible();
}

async function openHost(
  page: Page,
  uuid: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, hostPath(uuid), query);
  await expect(page.getByTestId("xcp-ng-host-hero-name")).toHaveText(name);
}

async function openVm(
  page: Page,
  uuid: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, vmPath(uuid), query);
  await expect(page.getByTestId("xcp-ng-vm-hero-name")).toHaveText(name);
}

async function openStorageRepository(
  page: Page,
  uuid: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, storagePath(uuid), query);
  await expect(page.getByTestId("xcp-ng-sr-hero-name")).toHaveText(name);
}

// The rows of a Needs attention card, as key and severity, in order.
async function attentionRows(
  card: Locator,
): Promise<Array<{ key: string; severity: string }>> {
  return await card
    .locator('[data-testid$="-attention-item"]')
    .evaluateAll(
      (elements: Array<Element>): Array<{ key: string; severity: string }> => {
        return elements.map((element: Element) => {
          return {
            key: element.getAttribute("data-key") || "",
            severity: element.getAttribute("data-severity") || "",
          };
        });
      },
    );
}

// The texts of every element with this test id, in order.
async function texts(page: Page, testId: string): Promise<Array<string>> {
  return (await page.getByTestId(testId).allTextContents()).map(
    (text: string): string => {
      return text.trim();
    },
  );
}

// The body rows of the one table on the page, as read.
function tableRows(page: Page): Locator {
  return page.locator("table tbody tr");
}

// A tab by its English name, whatever language draws it.
async function openTab(page: Page, name: string): Promise<void> {
  const tab: Locator = page.getByTestId(`tab-${name}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

test.describe("the pool's Overview", () => {
  test("says what needs attention first, the most urgent first, and opens each part's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(page.getByTestId("xcp-ng-hero-connection")).toHaveText(
      "Connected",
    );
    await expect(page.getByTestId("xcp-ng-hero-health")).toHaveText(
      "Unhealthy",
    );
    await expect(page.getByTestId("xcp-ng-hero-provenance")).toContainText(
      "Read from Xen Orchestra xo-paris by the XCP-ng Agent",
    );

    const card: Locator = page.getByTestId("xcp-ng-needs-attention");
    await expect(card).toBeVisible();
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION);

    // Each row says why.
    await expect(
      card
        .locator(`[data-key="Host:${HOST["prod3"]}"]`)
        .getByTestId("xcp-ng-needs-attention-reason"),
    ).toHaveText("Halted");
    await expect(
      card
        .locator(`[data-key="Host:${HOST["prod2"]}"]`)
        .getByTestId("xcp-ng-needs-attention-reason"),
    ).toHaveText("Disabled");
    const nfs: Locator = card
      .locator(`[data-key="StorageRepository:${SR["nfs"]}"]`)
      .getByTestId("xcp-ng-needs-attention-reason");
    await expect(nfs).toHaveCount(2);
    await expect(nfs.first()).toHaveText("92% full");
    await expect(nfs.last()).toContainText("allocated of");
    await expect(
      card
        .locator(`[data-key="VM:${VM["web01"]}"]`)
        .getByTestId("xcp-ng-needs-attention-reason"),
    ).toHaveText("Halted after running");

    // What is wrong among the counts, each a pill that opens which.
    await expect(page.getByTestId("xcp-ng-hero-hosts")).toHaveText(
      "2/3 hosts running",
    );
    await expect(page.getByTestId("xcp-ng-hero-vms")).toHaveText(
      "2/4 VMs running",
    );
    await expect(page.getByTestId("xcp-ng-hero-hosts-offline")).toContainText(
      "1 offline",
    );
    // A disabled host is someone's choice: grey.
    await expect(
      page.getByTestId("xcp-ng-hero-hosts-disabled"),
    ).toHaveAttribute("data-tone", "neutral");
    await expect(page.getByTestId("xcp-ng-hero-storage-full")).toContainText(
      "1 nearly full",
    );
    await expect(page.getByTestId("xcp-ng-hero-storage-over")).toContainText(
      "1 over-provisioned",
    );

    await screenshot(page, "overview-busy");

    // One step to the part's own page, from its row.
    await card
      .locator(`[data-key="Host:${HOST["prod3"]}"]`)
      .getByRole("link")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === hostPath(HOST["prod3"]!);
    });
    await expect(page.getByTestId("xcp-ng-host-hero-name")).toHaveText(
      "xcp-prod-03",
    );

    await openOverview(page);
    await page
      .getByTestId("xcp-ng-needs-attention")
      .locator(`[data-key="StorageRepository:${SR["nfs"]}"]`)
      .getByRole("link")
      .click();
    await expect(page.getByTestId("xcp-ng-sr-hero-name")).toHaveText(
      "NFS VM store",
    );
  });

  test("a stopped VM's pill opens which VM and why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    await page.getByTestId("xcp-ng-hero-vms-stopped").click();
    const dialog: Locator = page.getByTestId("xcp-ng-hero-vms-stopped-dialog");
    await expect(dialog).toContainText("web-01");
    await expect(dialog).toContainText("Halted after running");
    // A suspended VM was suspended by someone: never in it.
    await expect(dialog).not.toContainText("win-03");
    await screenshot(page, "overview-stopped-vms");
  });

  test("its tiles, the busiest VMs and hosts, and every host and repository at a glance", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    await expect(page.getByTestId("xcp-ng-tiles")).toBeVisible();

    // A control domain is its host's own, never a busy VM; a halted one is not busy.
    expect(await texts(page, "xcp-ng-busiest-vms-cpu-name")).toEqual([
      "db-01",
      "app-02",
    ]);
    // Only a VM whose guest tools report its memory ranks by it.
    expect(await texts(page, "xcp-ng-busiest-vms-memory-name")).toEqual([
      "db-01",
    ]);
    expect(await texts(page, "xcp-ng-busiest-hosts-cpu-name")).toEqual([
      "xcp-prod-02",
      "xcp-prod-01",
    ]);
    // The halted host first, then the disabled one.
    expect(await texts(page, "xcp-ng-hosts-card-name")).toEqual([
      "xcp-prod-03",
      "xcp-prod-02",
      "xcp-prod-01",
    ]);
    expect(await texts(page, "xcp-ng-storage-card-name")).toEqual([
      "NFS VM store",
      "Local storage",
      "XCP-ng Tools",
    ]);
    await expect(
      page.getByTestId("xcp-ng-storage-card-over-provisioned"),
    ).toContainText("130%");

    await page.getByTestId("xcp-ng-busiest-vms-cpu").getByText("db-01").click();
    await expect(page.getByTestId("xcp-ng-vm-hero-name")).toHaveText("db-01");
  });

  test("a calm pool has nothing to say: no Needs attention card, and Healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=calm");
    await expect(page.getByTestId("xcp-ng-hero-health")).toHaveText("Healthy");
    await expect(page.getByTestId("xcp-ng-tiles")).toBeVisible();
    await expect(page.getByTestId("xcp-ng-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("xcp-ng-hero-hosts-offline")).toHaveCount(0);
    await screenshot(page, "overview-calm");
  });

  test("a brand-new pool reads helpful, not broken: how to connect it, and no page of zeros", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=new");
    await expect(page.getByTestId("xcp-ng-hero-last-seen")).toHaveText(
      "Never seen",
    );
    await expect(page.getByTestId("resource-connection-guide")).toBeVisible();
    await expect(page.getByTestId("xcp-ng-hero-health")).toHaveCount(0);
    await expect(page.getByTestId("xcp-ng-tiles")).toHaveCount(0);
    await expect(page.getByTestId("xcp-ng-hosts-card")).toHaveCount(0);
    await screenshot(page, "overview-new");
  });

  test("a pool Xen Orchestra stopped reporting does not trust its last inventory", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "collector=stopped");
    await expect(page.getByTestId("xcp-ng-hero-last-seen")).toContainText(
      "Xen Orchestra stopped reporting this pool",
    );
    await expect(page.getByTestId("xcp-ng-hero-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByTestId("xcp-ng-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("resource-connection-guide")).toBeVisible();
    await screenshot(page, "overview-stopped-reporting");

    await openOverview(page, "collector=disconnected");
    await expect(page.getByTestId("xcp-ng-hero-connection")).not.toHaveText(
      "Connected",
    );
    await expect(page.getByTestId("xcp-ng-needs-attention")).toHaveCount(0);
    await screenshot(page, "overview-disconnected");
  });

  test("an inventory that cannot be read says so, never zeros that read as an empty pool", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=inventory");
    await expect(
      page.getByText("Something went wrong on the server. Please try again."),
    ).toBeVisible();
    await expect(page.getByTestId("xcp-ng-tiles")).toHaveCount(0);
    await expect(page.getByTestId("xcp-ng-waiting-for-inventory")).toHaveCount(
      0,
    );
  });

  test("twenty-four hosts: the first eight at a glance, and a way to all of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=large");
    await expect(page.getByTestId("xcp-ng-hosts-card-item")).toHaveCount(8);
    await expect(page.getByTestId("xcp-ng-hosts-card-all")).toContainText("24");
    await expectNoSidewaysScroll(page);
  });
});

test.describe("the pool's lists", () => {
  test("Hosts: a disabled host keeps its state and says so in grey under it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${POOL_PATH}/hosts`);
    await expect(tableRows(page)).toHaveCount(3);
    await expect(
      tableRows(page).filter({ hasText: "xcp-prod-02" }),
    ).toContainText("Disabled: starts no new VMs");
    await expect(
      tableRows(page).filter({ hasText: "xcp-prod-03" }),
    ).toContainText("Halted");
    await screenshot(page, "hosts");
  });

  test("VMs: the control domains are the hosts' own, left out until the switch shows them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${POOL_PATH}/vms`);
    await expect(page.getByTestId("xcp-ng-vms-page")).toBeVisible();
    await expect(tableRows(page)).toHaveCount(4);
    await expect(page.locator("table")).not.toContainText(
      "Control domain on host",
    );
    await expect(tableRows(page).filter({ hasText: "win-03" })).toContainText(
      "Suspended",
    );
    await screenshot(page, "vms");

    await page.getByTestId("xcp-ng-show-control-domains").click();
    await expect(tableRows(page)).toHaveCount(6);
    await expect(
      tableRows(page).filter({
        hasText: "Control domain on host: xcp-prod-01",
      }),
    ).toContainText("Control domain");
    await screenshot(page, "vms-control-domains");
  });

  test("Storage: shared or a host's, how full, and what is allocated past its size", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${POOL_PATH}/storage`);
    await expect(tableRows(page)).toHaveCount(3);
    const nfs: Locator = tableRows(page).filter({ hasText: "NFS VM store" });
    await expect(nfs).toContainText("Shared");
    await expect(nfs).toContainText("over-provisioned");
    await expect(
      tableRows(page).filter({ hasText: "Local storage" }),
    ).toContainText("xcp-prod-01");
    await screenshot(page, "storage");
  });
});

test.describe("a part's own page", () => {
  test("xcp-prod-01: its pool a step away, its tiles, the VM that stopped on it, its busiest VMs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST["prod1"]!, "xcp-prod-01");
    await expect(page.getByTestId("xcp-ng-host-hero-status")).toHaveAttribute(
      "data-tone",
      "positive",
    );
    await expect(page.getByTestId("xcp-ng-host-hero-location")).toHaveText(
      "Host of pool Production",
    );
    await expect(page.getByTestId("xcp-ng-host-tiles")).toBeVisible();
    expect(
      await attentionRows(page.getByTestId("xcp-ng-host-attention")),
    ).toEqual([{ key: `VM:${VM["web01"]}`, severity: "warning" }]);
    expect(await texts(page, "xcp-ng-host-busiest-vms-cpu-name")).toEqual([
      "app-02",
    ]);
    await screenshot(page, "host");

    await openTab(page, "Metrics");
    // Every chart reads this host of this pool, by the attributes ingest stamps.
    const aggregateReads: () => Promise<
      Recorded["aggregateRequests"]
    > = async (): Promise<Recorded["aggregateRequests"]> => {
      return await page.evaluate((): Recorded["aggregateRequests"] => {
        return (window as unknown as { __xcpNgPagesFixture: Recorded })
          .__xcpNgPagesFixture.aggregateRequests;
      });
    };
    await expect
      .poll(async (): Promise<number> => {
        return (await aggregateReads()).length;
      })
      .toBeGreaterThan(5);
    await page.waitForLoadState("networkidle");
    const reads: Recorded["aggregateRequests"] = await aggregateReads();
    for (const read of reads) {
      const attributes: Record<string, unknown> = read.attributes || {};
      expect(
        attributes["xcp_ng.id"] === HOST["prod1"] ||
          attributes["uuid"] === HOST["prod1"],
      ).toBe(true);
    }
    await screenshot(page, "host-metrics");
  });

  test("xcp-prod-03, which is halted: red, itself first in what needs attention, and its open incident", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, HOST["prod3"]!, "xcp-prod-03");
    await expect(page.getByTestId("xcp-ng-host-hero-status")).toHaveAttribute(
      "data-tone",
      "danger",
    );
    expect(
      await attentionRows(page.getByTestId("xcp-ng-host-attention")),
    ).toEqual([{ key: `Host:${HOST["prod3"]}`, severity: "critical" }]);
    await expect(page.getByTestId("xcp-ng-host-open")).toContainText(
      "Host Offline",
    );
    await screenshot(page, "host-halted");
  });

  test("db-01: on its host of its pool, its open alert and its virtual disk", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVm(page, VM["db01"]!, "db-01");
    await expect(page.getByTestId("xcp-ng-vm-hero-location")).toHaveText(
      "On host xcp-prod-02 of pool Production",
    );
    await expect(page.getByTestId("xcp-ng-vm-open")).toContainText(
      "VM CPU Starved",
    );
    expect(await texts(page, "xcp-ng-vm-disks-name")).toEqual(["db-01 data"]);
    await screenshot(page, "vm");
  });

  test("NFS VM store: nearly full, allocated past its size, and the disks on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStorageRepository(page, SR["nfs"]!, "NFS VM store");
    await expect(page.getByTestId("xcp-ng-sr-hero-status")).toHaveAttribute(
      "data-tone",
      "warning",
    );
    expect(
      await attentionRows(page.getByTestId("xcp-ng-sr-attention")),
    ).toEqual([{ key: `StorageRepository:${SR["nfs"]}`, severity: "warning" }]);
    expect(await texts(page, "xcp-ng-sr-disks-name")).toEqual([
      "db-01 data",
      "old-backup",
      "web-01 system",
    ]);
    await expect(page.getByTestId("xcp-ng-sr-disks")).toContainText(
      "Not attached",
    );
    await screenshot(page, "storage-repository");
  });
});

test.describe("the Topology and the setup guide", () => {
  test("the Topology draws the pool, its hosts, their VMs and the storage they use", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${POOL_PATH}/topology`);
    await expect(page.getByTestId("resource-topology-canvas")).toBeVisible();
    await expect(page.getByTestId("resource-topology-canvas")).toContainText(
      "xcp-prod-01",
    );
    await screenshot(page, "topology");
  });

  test("the setup guide installs the agent beside Xen Orchestra", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${POOL_PATH}/documentation`);
    await expect(page.getByTestId("setup-guide-step-1")).toBeVisible();
    await screenshot(page, "setup-guide");
  });
});

/*
 * Last: the locale files are translated while this suite is written, so
 * the German and Persian screenshots show the most words translated.
 */
test.describe("at a phone's width, in dark mode, in German and in Persian", () => {
  test("at 390px the Overview and each part's page fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await openOverview(page);
    await expect(page.getByTestId("xcp-ng-needs-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-overview");

    await openHost(page, HOST["prod1"]!, "xcp-prod-01");
    await expect(page.getByTestId("xcp-ng-host-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-host");

    await openVm(page, VM["db01"]!, "db-01");
    await expect(page.getByTestId("xcp-ng-vm-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-vm");

    await openStorageRepository(page, SR["nfs"]!, "NFS VM store");
    await expect(page.getByTestId("xcp-ng-sr-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-storage-repository");

    // A phone draws the list as cards, still without the control domains.
    await openPage(page, `${POOL_PATH}/vms`);
    await expect(page.getByTestId("xcp-ng-vms-page")).toContainText("db-01");
    await expect(page.getByTestId("xcp-ng-vms-page")).not.toContainText(
      "Control domain on host",
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-vms");
  });

  test("in dark mode the pages draw on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("xcp-ng-needs-attention")).toBeVisible();
    await screenshot(page, "dark-overview");

    await openHost(page, HOST["prod3"]!, "xcp-prod-03", "theme=dark");
    await expect(page.getByTestId("xcp-ng-host-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "dark-host");
  });

  test("in German, the Overview speaks German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");
    await expect(page.locator("html")).toHaveAttribute("lang", "de");
    expect(GERMAN["Needs attention"]).not.toBe("Needs attention");
    await expect(
      page
        .getByTestId("xcp-ng-needs-attention")
        .getByText(GERMAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "german-overview");

    await openHost(page, HOST["prod1"]!, "xcp-prod-01", "lang=de");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "german-host");
  });

  test("in Persian, the pages read right to left and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    await expect(
      page
        .getByTestId("xcp-ng-needs-attention")
        .getByText(PERSIAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    // "2/3" in one kind of digit: the reader's.
    const hostsChip: string =
      (await page.getByTestId("xcp-ng-hero-hosts").textContent()) || "";
    expect(hostsChip).toContain("۲/۳");
    expect(hostsChip).not.toMatch(LATIN_DIGIT);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-overview");

    await page.setViewportSize({ width: 390, height: 844 });
    await openVm(page, VM["db01"]!, "db-01", "lang=fa");
    await expect(page.getByTestId("xcp-ng-vm-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-phone-vm");
  });
});

describePageLanguages({
  languages: ["de", "fa"],
  address: (language: string): string => {
    return language === "en" ? POOL_PATH : `${POOL_PATH}?lang=${language}`;
  },
});
