import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A vCenter's pages, in a browser, against the offline fixture
 * (VMwarePages/Fixture).
 *
 * The maintainer: "How can we make the Proxmox product a lot better and
 * world-class? Can you please do those things for other resources as well,
 * like Kubernetes, Host, and VMware ... feature-rich, simple to use, and
 * natural to use."
 *
 * So, read the way a vSphere administrator reads them: the vCenter's
 * Overview says what needs attention first, the most urgent first - an ESXi
 * host vCenter has lost, a datastore nearly full, a VM the host swaps, what
 * a datacenter's own alarms count - with one step to each part's page or
 * list; how many clustered hosts DRS and HA can use, and why the others are
 * not; each host's state and load. The lists say each part's state in
 * vCenter's words with why it needs a look under it, and fit a laptop beside
 * the side menu. A host's, a VM's, a datastore's and a cluster's own page
 * says who it is and where it sits, what on it needs a look, how busy or
 * full it is, what is open on it, and which of the vCenter's alerts watch
 * it, with "Turn on N alerts" opening Recommendations with exactly those
 * selected. A host vCenter cannot reach reads Not responding, its VMs
 * Disconnected, and neither shows a 0% that would read as idle; a host off
 * or in standby is no problem. At a laptop's and a phone's width, in dark
 * mode, in German and in Persian. The fixture records every read, so the
 * tests check that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const VCENTER_ID: string = "31000000-0000-4000-8000-000000000001";
const VCENTER_PATH: string = `/dashboard/${PROJECT_ID}/vmware/${VCENTER_ID}`;

function vmId(number: number): string {
  return `vm/4210aaaa-bbbb-cccc-dddd-${String(number).padStart(12, "0")}`;
}

function hostPath(datacenter: string, name: string): string {
  return `${VCENTER_PATH}/hosts/${encodeURIComponent(`host/${datacenter}/${name}`)}`;
}

function vmPath(number: number): string {
  return `${VCENTER_PATH}/virtual-machines/${encodeURIComponent(vmId(number))}`;
}

function datastorePath(datacenter: string, name: string): string {
  return `${VCENTER_PATH}/datastores/${encodeURIComponent(
    `datastore/${datacenter}/${name}`,
  )}`;
}

function clusterPath(datacenter: string, name: string): string {
  return `${VCENTER_PATH}/clusters/${encodeURIComponent(
    `cluster/${datacenter}/${name}`,
  )}`;
}

// The busy vCenter's attention list, most urgent first (Fixture/Data.js).
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: "Datacenter:datacenter/dc-east:hosts", severity: "critical" },
  { key: "Host:host/dc-east/esx03.acme.example", severity: "critical" },
  { key: "Datastore:datastore/dc-east/ds-prod-01", severity: "critical" },
  { key: `VirtualMachine:${vmId(1)}`, severity: "critical" },
  {
    key: "Datacenter:datacenter/dc-east:virtual-machines",
    severity: "warning",
  },
  { key: "Cluster:cluster/dc-east/dev-cluster", severity: "warning" },
  { key: "Cluster:cluster/dc-west/west-cluster", severity: "warning" },
  { key: "Host:host/dc-east/esx02.acme.example", severity: "warning" },
  { key: "Datastore:datastore/dc-east/ds-prod-02", severity: "warning" },
  { key: `VirtualMachine:${vmId(3)}`, severity: "warning" },
  { key: `VirtualMachine:${vmId(2)}`, severity: "warning" },
  {
    key: "ResourcePool:resourcepool//dc-east/host/prod-cluster/Resources/batch",
    severity: "warning",
  },
];

// The vCenter's alerts that watch every ESXi host (VMWARE_HOST_ALERT_TEMPLATE_IDS).
const HOST_ALERT_IDS: Array<string> = [
  "VMware:vmware-host-not-responding",
  "VMware:vmware-host-cpu-saturation",
  "VMware:vmware-host-memory-saturation",
  "VMware:vmware-host-disk-latency-high",
  "VMware:vmware-host-network-packet-errors",
  "VMware:vmware-host-network-packet-drops",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/vmware-pages-ui",
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

interface Recorded {
  listRequests: Array<{
    modelName: string;
    query: Record<string, unknown> | null;
  }>;
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
          window as unknown as { __vmwarePagesFixture?: Recorded }
        ).__vmwarePagesFixture;
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
  await openPage(page, VCENTER_PATH, query);
  await expect(page.getByTestId("vmware-hero-health")).toBeVisible();
  await expect(page.getByTestId("vmware-hosts-card")).toBeVisible();
}

async function openHost(
  page: Page,
  datacenter: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, hostPath(datacenter, name), query);
  await expect(page.getByTestId("vmware-host-hero-name")).toHaveText(name);
}

async function openVm(
  page: Page,
  number: number,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, vmPath(number), query);
  await expect(page.getByTestId("vmware-vm-hero-name")).toHaveText(name);
}

async function openDatastore(
  page: Page,
  datacenter: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, datastorePath(datacenter, name), query);
  await expect(page.getByTestId("vmware-datastore-hero-name")).toHaveText(name);
}

async function openCluster(
  page: Page,
  datacenter: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, clusterPath(datacenter, name), query);
  await expect(page.getByTestId("vmware-cluster-hero-name")).toHaveText(name);
}

/*
 * A hero's status pill, as it reads: its label, without the description it
 * carries for screen readers.
 */
async function statusLabel(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    const copy: Element = element.cloneNode(true) as Element;
    for (const hidden of Array.from(copy.querySelectorAll(".sr-only"))) {
      hidden.remove();
    }
    return (copy.textContent || "").trim();
  });
}

// The rows of a Needs attention card, as key and severity, in order.
async function attentionRows(
  card: Locator,
): Promise<Array<{ key: string; severity: string }>> {
  return await card
    .locator(
      '[data-testid$="-attention-item"], [data-testid$="-needs-attention-item"]',
    )
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

// A tab by its English name, whatever language draws it.
async function openTab(page: Page, name: string): Promise<void> {
  const tab: Locator = page.getByTestId(`tab-${name}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

/*
 * Every table on the page fits its card: no row runs under the sticky View
 * column, nothing to scroll sideways to.
 */
async function expectTablesFitTheirCards(page: Page): Promise<void> {
  await expect(page.locator("table").first()).toBeVisible();
  const overflows: Array<number> = await page
    .locator("table")
    .evaluateAll((tables: Array<Element>): Array<number> => {
      return tables.map((table: Element): number => {
        const box: Element = table.parentElement as Element;
        return Math.round(box.scrollWidth - box.clientWidth);
      });
    });
  for (const overflow of overflows) {
    expect(overflow).toBeLessThanOrEqual(0);
  }
}

// The colour a pill or a cell is drawn in, as the browser computed it.
async function colourOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    return getComputedStyle(element).color;
  });
}

// A bar's fill colour, as the browser computed it.
async function backgroundOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    return getComputedStyle(element).backgroundColor;
  });
}

// Tailwind's gray-600, red-700 and amber-700, as computed colours.
const GREY_600: string = "rgb(75, 85, 99)";
const RED_700: string = "rgb(185, 28, 28)";
const AMBER_700: string = "rgb(180, 83, 9)";
// Tailwind's red-500, amber-500 and emerald-500: a tile's bar.
const RED_500: string = "rgb(239, 68, 68)";
const AMBER_500: string = "rgb(245, 158, 11)";
const EMERALD_500: string = "rgb(16, 185, 129)";

// A Latin digit, which a Persian count chip should not mix with its own.
const LATIN_DIGIT: RegExp = /[0-9]/;

// A golden tile, found by its title in the reader's language.
function goldenTile(scope: Page | Locator, title: string): Locator {
  return scope
    .locator("span.uppercase", { hasText: title })
    .first()
    .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
}

// The tile's bar: the coloured fill inside its track.
function tileBar(tile: Locator): Locator {
  return tile.locator("div.rounded-full > div.rounded-full").first();
}

async function selectedRecommendations(page: Page): Promise<Array<string>> {
  await expect(page).toHaveURL((url: URL): boolean => {
    return url.pathname === `${VCENTER_PATH}/recommendations`;
  });
  return (new URL(page.url()).searchParams.get("select") || "")
    .split(",")
    .filter((id: string): boolean => {
      return id.length > 0;
    })
    .sort();
}

// A list's row by a name in it.
function listRow(page: Page, name: string): Locator {
  return page.getByRole("row").filter({ hasText: name });
}

/*
 * The character each line but the last of these elements ends with, as the
 * browser laid them out: "." for "esx02.acme." / "example", "l" for
 * "esx02.acme.exampl" / "e".
 */
async function lineEndsOf(
  locator: Locator,
): Promise<Array<{ text: string; ends: Array<string> }>> {
  return await locator.evaluateAll(
    (
      elements: Array<Element>,
    ): Array<{ text: string; ends: Array<string> }> => {
      return elements.map((element: Element) => {
        const ends: Array<string> = [];
        const walker: TreeWalker = document.createTreeWalker(
          element,
          NodeFilter.SHOW_TEXT,
        );
        let lineTop: number | null = null;
        let previous: string = "";

        for (
          let node: Node | null = walker.nextNode();
          node;
          node = walker.nextNode()
        ) {
          const value: string = node.textContent || "";

          for (let index: number = 0; index < value.length; index++) {
            const range: Range = document.createRange();
            range.setStart(node, index);
            range.setEnd(node, index + 1);
            const top: number = range.getBoundingClientRect().top;

            if (lineTop !== null && top > lineTop + 4) {
              ends.push(previous);
            }
            lineTop = top;
            previous = value.charAt(index);
          }
        }

        return { text: element.textContent || "", ends: ends };
      });
    },
  );
}

test.describe("the vCenter's Overview", () => {
  test("says what needs attention first, the most urgent first, and opens each part's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const card: Locator = page.getByTestId("vmware-needs-attention");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("vmware-hero-health")).toHaveText(
      "Unhealthy",
    );
    await expect(
      page.getByTestId("vmware-needs-attention-summary").locator("span"),
    ).toHaveText(["4 critical", "8 to look at"]);

    // Six rows first, the rest one click away.
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION.slice(0, 6));
    await expect(page.getByTestId("vmware-needs-attention-toggle")).toHaveText(
      "Show 6 more",
    );
    await page.getByTestId("vmware-needs-attention-toggle").click();
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION);

    // Each row says why, in vCenter's words.
    const reasonsOf: (key: string) => Locator = (key: string): Locator => {
      return card
        .locator(`[data-key="${key}"]`)
        .getByTestId("vmware-needs-attention-reason");
    };
    await expect(reasonsOf("Datacenter:datacenter/dc-east:hosts")).toHaveText([
      "1 host with a critical alarm",
      "1 host with a warning alarm",
    ]);
    await expect(reasonsOf("Host:host/dc-east/esx03.acme.example")).toHaveText(
      "Not responding",
    );
    await expect(
      reasonsOf("Datastore:datastore/dc-east/ds-prod-01"),
    ).toHaveText("93% full");
    await expect(reasonsOf(`VirtualMachine:${vmId(1)}`)).toHaveText(
      "1.5 GiB of memory swapped by the host",
    );
    await expect(reasonsOf("Cluster:cluster/dc-west/west-cluster")).toHaveText(
      "Not enough memory to lose a host",
    );
    await expect(reasonsOf("Cluster:cluster/dc-east/dev-cluster")).toHaveText(
      "1 host not effective",
    );
    await expect(reasonsOf(`VirtualMachine:${vmId(2)}`)).toHaveText(
      "CPU ready 14%",
    );

    await screenshot(page, "overview-attention");

    // One step to the part's own page, from anywhere on its row.
    const esx03: Locator = card.locator(
      '[data-key="Host:host/dc-east/esx03.acme.example"]',
    );
    await expect(esx03.getByRole("link")).toHaveCount(1);
    await esx03.getByTestId("vmware-needs-attention-reason").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === hostPath("dc-east", "esx03.acme.example");
    });
    expect(await statusLabel(page.getByTestId("vmware-host-hero-status"))).toBe(
      "Not responding",
    );
  });

  test("a datacenter's own counts lead to the list where the parts they count are", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    const card: Locator = page.getByTestId("vmware-needs-attention");
    await page.getByTestId("vmware-needs-attention-toggle").click();

    await card
      .locator('[data-key="Datacenter:datacenter/dc-east:hosts"]')
      .getByRole("link")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${VCENTER_PATH}/hosts`;
    });

    await openOverview(page);
    await page.getByTestId("vmware-needs-attention-toggle").click();
    await page
      .getByTestId("vmware-needs-attention")
      .locator('[data-key="Datacenter:datacenter/dc-east:virtual-machines"]')
      .getByRole("link")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${VCENTER_PATH}/virtual-machines`;
    });

    // A resource pool has no page of its own: its row opens the pools.
    await openOverview(page);
    await page.getByTestId("vmware-needs-attention-toggle").click();
    await page
      .getByTestId("vmware-needs-attention")
      .locator(
        '[data-key="ResourcePool:resourcepool//dc-east/host/prod-cluster/Resources/batch"]',
      )
      .getByRole("link")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${VCENTER_PATH}/resource-pools`;
    });
  });

  test("the hero counts what the vCenter has, each count one step from its list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(page.getByTestId("vmware-hero-connection")).toHaveText(
      "Connected",
    );
    await expect(page.getByTestId("vmware-hero-datacenters")).toHaveText(
      "2 datacenters",
    );
    await expect(page.getByTestId("vmware-hero-clusters")).toHaveText(
      "3 clusters",
    );
    // How many vCenter can reach: the first number a vSphere admin looks for.
    await expect(page.getByTestId("vmware-hero-hosts")).toHaveText(
      "7/8 ESXi hosts connected",
    );
    await expect(page.getByTestId("vmware-hero-vms")).toHaveText(
      "15/17 VMs powered on",
    );
    await expect(page.getByTestId("vmware-hero-templates")).toHaveText(
      "1 template",
    );
    await expect(page.getByTestId("vmware-hero-datastores")).toHaveText(
      "5 datastores",
    );

    await page.getByTestId("vmware-hero-hosts").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${VCENTER_PATH}/hosts`;
    });
  });

  test("Effective hosts says why the others are not, red while vCenter cannot reach one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const tile: Locator = goldenTile(page, "Effective hosts");
    await expect(tile).toContainText("6/8");
    await expect(tile.getByTestId("golden-metric-tile-sublabel")).toHaveText(
      "1 not responding · 1 in maintenance mode",
    );
    expect(await backgroundOf(tileBar(tile))).toBe(RED_500);

    /*
     * esx03, which vCenter lost, reports 0 MiB of its 512 GiB: left out of
     * the vCenter's memory, not counted as 512 GiB nobody uses (3.5 TiB).
     */
    await expect(
      goldenTile(page, "Host Memory").getByTestId(
        "golden-metric-tile-sublabel",
      ),
    ).toHaveText("1.4 TiB of 3.0 TiB");

    // Five tiles, none with a title broken inside a word at a laptop's width.
    await expect(goldenTile(page, "Host CPU")).toBeVisible();
    await expect(goldenTile(page, "VM CPU Ready")).toBeVisible();
    await expect(
      page.locator("span.uppercase", { hasText: "Virtual Machines" }),
    ).toHaveCount(0);
  });

  test("each ESXi host's state and load, the one vCenter lost first, with no 0% for it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const hosts: Locator = page.getByTestId("vmware-hosts-card-item");
    await expect(hosts).toHaveCount(8);
    await expect(page.getByTestId("vmware-hosts-card-status")).toHaveText([
      "Not responding",
      "Connected",
      "Connected",
      "Connected",
      "Connected",
      "Connected",
      "Connected",
      "Connected",
    ]);
    await expect(hosts.first()).toContainText("esx03.acme.example");
    // vCenter reports no use for a host it lost: no reading, never idle.
    await expect(
      hosts.first().getByTestId("vmware-hosts-card-cpu"),
    ).toContainText("—");
    await expect(hosts.first()).not.toContainText("0%");
    // The busy one next, amber.
    await expect(hosts.nth(1)).toContainText("esx02.acme.example");
    await expect(
      hosts.nth(1).getByTestId("vmware-hosts-card-cpu"),
    ).toContainText("94%");

    /*
     * The top consumers, coloured by the lines their alerts fire at: esx02's
     * 94% CPU amber, never red; ds-prod-01 93% full red, ds-prod-02 84%
     * amber, ds-west 62% green (they were red, red and amber); ci-runner-01
     * waits 14% of the time for a CPU, amber.
     */
    const topBar: (section: string, name: string) => Locator = (
      section: string,
      name: string,
    ): Locator => {
      return page
        .getByTestId(section)
        .getByTestId("vmware-top-consumer")
        .filter({ hasText: name })
        .first()
        .getByTestId("vmware-top-consumer-bar");
    };
    expect(
      await backgroundOf(topBar("vmware-top-host-cpu", "esx02.acme.example")),
    ).toBe(AMBER_500);
    expect(
      await backgroundOf(topBar("vmware-top-host-cpu", "esx01.acme.example")),
    ).toBe(EMERALD_500);
    expect(
      await backgroundOf(topBar("vmware-top-datastores", "ds-prod-01")),
    ).toBe(RED_500);
    expect(
      await backgroundOf(topBar("vmware-top-datastores", "ds-prod-02")),
    ).toBe(AMBER_500);
    expect(await backgroundOf(topBar("vmware-top-datastores", "ds-west"))).toBe(
      EMERALD_500,
    );
    expect(
      await backgroundOf(topBar("vmware-top-vm-cpu-ready", "ci-runner-01")),
    ).toBe(AMBER_500);

    // A host's whole row is the step to its page.
    await hosts.nth(1).getByTestId("vmware-hosts-card-cpu").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === hostPath("dc-east", "esx02.acme.example");
    });
  });

  test("a calm vCenter has nothing to say: Healthy, no Needs attention, every host effective", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=calm");

    await expect(page.getByTestId("vmware-hero-health")).toHaveText("Healthy");
    await expect(page.getByTestId("vmware-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("vmware-hero-hosts")).toHaveText(
      "8/8 ESXi hosts connected",
    );
    const tile: Locator = goldenTile(page, "Effective hosts");
    await expect(tile).toContainText("8/8");
    expect(await backgroundOf(tileBar(tile))).toBe(EMERALD_500);
  });

  test("hosts that are off or in standby are no problem: Healthy, and a calm tile", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=standby");

    await expect(page.getByTestId("vmware-hero-health")).toHaveText("Healthy");
    await expect(page.getByTestId("vmware-needs-attention")).toHaveCount(0);
    // Its datacenter has hosts both off and in standby: which is which, it cannot say.
    await expect(page.getByTestId("vmware-hosts-card-status")).toHaveText([
      "Connected",
      "Powered off or in standby",
      "Powered off or in standby",
    ]);
    const tile: Locator = goldenTile(page, "Effective hosts");
    await expect(tile).toContainText("1/3");
    await expect(tile.getByTestId("golden-metric-tile-sublabel")).toHaveText(
      "2 off or in standby",
    );
    expect(await backgroundOf(tileBar(tile))).toBe(EMERALD_500);
  });

  test("a disconnected vCenter's last snapshot is not the truth: no Needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, VCENTER_PATH, "collector=disconnected");

    await expect(page.getByTestId("vmware-hero-connection")).toHaveText(
      "Disconnected",
    );
    await expect(page.getByTestId("vmware-hero-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByTestId("vmware-needs-attention")).toHaveCount(0);
    /*
     * Its clusters' counts are three days old: Effective hosts says nothing
     * rather than "2 in maintenance mode" for a host it had lost.
     */
    const effective: Locator = goldenTile(page, "Effective hosts");
    await expect(effective).toContainText("—");
    await expect(effective).not.toContainText("maintenance mode");
  });

  test("forty hosts: the first eight, the one vCenter lost first, and a way to all of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=large");

    await expect(page.getByTestId("vmware-hosts-card-item")).toHaveCount(8);
    await expect(
      page.getByTestId("vmware-hosts-card-item").first(),
    ).toContainText("esx-fra-27.acme.example");
    await expect(page.getByTestId("vmware-hosts-card-all")).toHaveText(
      "View all 40 hosts",
    );
    // Four hundred VMs, read only where they may need a look.
    const vmReads: Array<Record<string, unknown> | null> = await page.evaluate(
      (): Array<Record<string, unknown> | null> => {
        const fixture: Recorded = (
          window as unknown as { __vmwarePagesFixture: Recorded }
        ).__vmwarePagesFixture;
        return fixture.listRequests
          .filter((request: Recorded["listRequests"][number]): boolean => {
            return (
              request.modelName === "VMwareResource" &&
              JSON.stringify(request.query).includes("VirtualMachine")
            );
          })
          .map((request: Recorded["listRequests"][number]) => {
            return request.query;
          });
      },
    );
    expect(vmReads.length).toBeGreaterThan(0);
    for (const query of vmReads) {
      // Never every VM at once: each read asks for powered-on VMs in trouble.
      expect(query).toHaveProperty("isPoweredOn", true);
    }
    await expectNoSidewaysScroll(page);
  });

  test("when the inventory cannot be read, the Overview says so instead of drawing an empty vCenter", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, VCENTER_PATH, "fail=inventory");

    // Said in Needs attention's own frame, with a way to read it again.
    const error: Locator = page.getByTestId("vmware-needs-attention-error");
    await expect(error).toBeVisible();
    await expect(error).toContainText(
      "Something went wrong on the server. Please try again.",
    );
    await expect(error.getByRole("button")).toBeVisible();
    await expect(page.getByTestId("vmware-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("vmware-hosts-card")).toHaveCount(0);
    // "Healthy" over a vCenter it could not read would be a guess.
    await expect(page.getByTestId("vmware-hero-health")).toHaveCount(0);
    // Nor four "No ... data available." boxes, as an empty vCenter draws.
    await expect(page.getByTestId("vmware-top-consumers")).toHaveCount(0);

    /*
     * A host whose row cannot be read says so with Try again - and not
     * that it left the vCenter's inventory, which nobody could tell.
     */
    await openPage(
      page,
      hostPath("dc-east", "esx02.acme.example"),
      "fail=inventory",
    );
    await expect(page.getByTestId("vmware-part-read-error")).toBeVisible();
    await expect(page.getByTestId("vmware-host-report-notice")).toHaveCount(0);
  });

  test("a vCenter that has reported nothing yet has no health to tell", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, VCENTER_PATH, "estate=new");

    await expect(page.getByTestId("vmware-hero-connection")).toHaveText(
      "Connected",
    );
    await expect(goldenTile(page, "Effective hosts")).toContainText("—");
    await expect(page.getByTestId("vmware-hero-health")).toHaveCount(0);
    await expect(page.getByTestId("vmware-needs-attention")).toHaveCount(0);
  });
});

test.describe("the lists", () => {
  test("Hosts: each host's state in vCenter's words, why under it, and every column in sight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${VCENTER_PATH}/hosts`);

    const esx03: Locator = listRow(page, "esx03.acme.example");
    await expect(esx03).toContainText("Not responding");
    // The status says it; no reason under it to say it again.
    await expect(esx03.getByTestId("resource-status-reason")).toHaveCount(0);
    await expect(esx03.getByTestId("resource-cpu-bar")).toHaveCount(0);

    const esx02: Locator = listRow(page, "esx02.acme.example");
    await expect(esx02.getByTestId("resource-status-reason")).toHaveText(
      "CPU at 94%",
    );
    // Where it sits, under its name, as the table keeps to its card.
    await expect(esx02).toContainText("dc-east");
    await expect(esx02).toContainText("prod-cluster");
    await expect(esx02).toContainText("76.80 GHz");
    await expect(esx02).toContainText("342 GiB / 512 GiB");
    await expectTablesFitTheirCards(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "list-hosts");
  });

  test("Virtual Machines: swapped, waiting for a CPU, and Disconnected on a host vCenter lost", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${VCENTER_PATH}/virtual-machines`);

    const dbPrimary: Locator = listRow(page, "db-primary");
    await expect(dbPrimary).toContainText("Running");
    await expect(dbPrimary.getByTestId("resource-status-reason")).toHaveText(
      "1.5 GiB of memory swapped by the host",
    );

    const ciRunner: Locator = listRow(page, "ci-runner-01");
    expect(await colourOf(ciRunner.getByText("14.2%"))).toBe(AMBER_700);

    // On esx03, which vCenter cannot reach: what it does is not known.
    const cache: Locator = listRow(page, "cache-01");
    await expect(cache).toContainText("Disconnected");
    await expect(cache.getByTestId("resource-cpu-bar")).toHaveCount(0);

    // A pool someone made is named; the root pool vSphere never shows is not.
    await expect(listRow(page, "batch-worker-01")).toContainText("batch");
    await expect(listRow(page, "web-01")).not.toContainText("Resources");
    await expectTablesFitTheirCards(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "list-virtual-machines");
  });

  test("Clusters: each one's state with why, and how much of it its hosts use", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${VCENTER_PATH}/clusters`);

    const prod: Locator = listRow(page, "prod-cluster");
    await expect(prod).toContainText("Unhealthy");
    await expect(prod.getByTestId("resource-status-reason")).toHaveText(
      "1 host not responding",
    );
    await expect(prod).toContainText("3 / 4");
    await expect(prod.getByTestId("resource-cpu-bar")).toHaveCount(1);

    await expect(
      listRow(page, "dev-cluster").getByTestId("resource-status-reason"),
    ).toHaveText("1 host not effective");
    await expect(
      listRow(page, "west-cluster").getByTestId("resource-status-reason"),
    ).toHaveText("Not enough memory to lose a host");
    await expectTablesFitTheirCards(page);
    await screenshot(page, "list-clusters");
  });

  test("Datastores and Resource Pools: what is full or swapped stands out, in words and colour", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${VCENTER_PATH}/datastores`);
    expect(
      await colourOf(
        listRow(page, "ds-prod-01").getByText("93.0%", { exact: false }),
      ),
    ).toBe(RED_700);
    expect(
      await colourOf(
        listRow(page, "ds-prod-02").getByText("84.0%", { exact: false }),
      ),
    ).toBe(AMBER_700);
    await expectTablesFitTheirCards(page);

    await openPage(page, `${VCENTER_PATH}/resource-pools`);
    expect(
      await colourOf(
        listRow(page, "batch").getByText("3.0 GiB", { exact: false }),
      ),
    ).toBe(AMBER_700);
    await expectTablesFitTheirCards(page);
  });
});

test.describe("an ESXi host's page", () => {
  test("esx03, which vCenter cannot reach: Not responding, no idle 0%, its open incident and its VM Disconnected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "dc-east", "esx03.acme.example");

    expect(await statusLabel(page.getByTestId("vmware-host-hero-status"))).toBe(
      "Not responding",
    );
    await expect(page.getByTestId("vmware-host-hero-location")).toHaveText(
      "ESXi host in cluster prod-cluster, datacenter dc-east",
    );

    const card: Locator = page.getByTestId("vmware-host-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "Host:host/dc-east/esx03.acme.example", severity: "critical" },
    ]);
    await expect(page.getByTestId("vmware-host-attention-name")).toHaveText(
      "This host",
    );

    // vCenter reports 0 MHz and 0 MiB for it: no reading, never idle.
    const tiles: Locator = page.getByTestId("vmware-host-tiles");
    await expect(goldenTile(tiles, "CPU")).toContainText("—");
    await expect(goldenTile(tiles, "Memory")).toContainText("—");
    await expect(tiles).not.toContainText("0.0%");
    // Its VMs' 0% ranks nothing.
    await expect(page.getByTestId("vmware-host-busiest-vms")).toHaveCount(0);
    // How many VMs it has, not how many run: vCenter does not know.
    await expect(page.getByTestId("vmware-host-hero-chips")).toContainText(
      "1 VM",
    );
    await expect(page.getByTestId("vmware-host-hero-chips")).not.toContainText(
      "powered on",
    );

    await expect(page.getByTestId("vmware-host-open-item")).toHaveCount(1);
    await expect(page.getByTestId("vmware-host-open-item")).toContainText(
      "[VMware] Host Not Responding - vcenter-prod",
    );
    await screenshot(page, "host-not-responding");

    await openTab(page, "Virtual Machines");
    await expect(listRow(page, "cache-01")).toContainText("Disconnected");
  });

  test("esx02, busy: Connected in amber, CPU at 94%, and what is open on it and its VMs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "dc-east", "esx02.acme.example", "open=many");

    expect(await statusLabel(page.getByTestId("vmware-host-hero-status"))).toBe(
      "Connected",
    );
    expect(
      await attentionRows(page.getByTestId("vmware-host-attention")),
    ).toEqual([
      { key: "Host:host/dc-east/esx02.acme.example", severity: "warning" },
      { key: `VirtualMachine:${vmId(3)}`, severity: "warning" },
      { key: `VirtualMachine:${vmId(2)}`, severity: "warning" },
    ]);
    await expect(
      page
        .locator(
          '[data-testid="vmware-host-attention-item"][data-key="Host:host/dc-east/esx02.acme.example"]',
        )
        .getByTestId("vmware-host-attention-reason"),
    ).toHaveText("CPU at 94%");

    /*
     * Open on the host and on the VMs it runs (a VM alert names only its
     * VM), newest first.
     */
    await expect(page.getByTestId("vmware-host-open-item")).toContainText([
      "[VMware] VM Memory Ballooning - vcenter-prod",
      "[VMware] VM CPU Ready Contention (>10%) - vcenter-prod",
      "[VMware] Host CPU Saturation (>90%) - vcenter-prod",
    ]);
    await expect(page.getByTestId("vmware-host-busiest-vms")).toBeVisible();
    /*
     * ci-runner-01 waits 14.2% of the time for a CPU: amber, as Needs
     * attention's "CPU ready 14%" just above it (the badge was red); its
     * 64.1% CPU green, as the Virtual Machines tab draws it.
     */
    const runner: Locator = page
      .getByTestId("vmware-host-busy-vm")
      .filter({ hasText: "ci-runner-01" });
    expect(
      await colourOf(runner.getByTestId("vmware-host-busy-vm-cpu-ready")),
    ).toBe(AMBER_700);
    expect(
      await backgroundOf(runner.getByTestId("vmware-host-busy-vm-cpu-bar")),
    ).toBe("rgb(34, 197, 94)");
  });

  test("Turn on 6 alerts opens Recommendations with exactly the host alerts selected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "dc-east", "esx01.acme.example");

    await expect(page.getByTestId("vmware-host-alerts-item")).toHaveCount(6);
    await expect(
      page.getByTestId("vmware-host-alerts-item").first(),
    ).toContainText("Host Not Responding");
    await expect(page.getByTestId("vmware-host-alerts-turn-on")).toHaveText(
      "Turn on 6 alerts",
    );
    // Not set up reads grey, never six amber warnings.
    expect(
      await colourOf(
        page
          .getByTestId("vmware-host-alerts-item")
          .first()
          .getByText("Not set up"),
      ),
    ).toBe(GREY_600);
    await page.getByTestId("vmware-host-alerts-turn-on").click();

    const selected: Array<string> = await selectedRecommendations(page);
    expect(selected).toEqual([...HOST_ALERT_IDS].sort());
    for (const id of selected) {
      await expect(
        page.getByTestId(`recommendation-card-select-${id}`),
      ).toHaveAttribute("aria-pressed", "true");
    }
    await expect(page.getByText("6 monitors selected")).toBeVisible();
    await screenshot(page, "host-alerts-recommendations");
  });

  test("with two host alerts on, it offers the other four", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openHost(page, "dc-east", "esx01.acme.example", "alerts=some");

    await expect(page.getByTestId("vmware-host-alerts-turn-on")).toHaveText(
      "Turn on 4 alerts",
    );
    await page.getByTestId("vmware-host-alerts-turn-on").click();
    expect(await selectedRecommendations(page)).toEqual(
      [
        "VMware:vmware-host-memory-saturation",
        "VMware:vmware-host-disk-latency-high",
        "VMware:vmware-host-network-packet-errors",
        "VMware:vmware-host-network-packet-drops",
      ].sort(),
    );
  });
});

test.describe("a virtual machine's page", () => {
  test("db-primary: where it runs, swapped by its host, its open alert and the VM alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVm(page, 1, "db-primary");

    expect(await statusLabel(page.getByTestId("vmware-vm-hero-status"))).toBe(
      "Running",
    );
    await expect(page.getByTestId("vmware-vm-hero-location")).toHaveText(
      "On host esx01.acme.example in cluster prod-cluster, datacenter dc-east",
    );
    await expect(page.getByTestId("vmware-vm-hero-chips")).toContainText(
      "64.0 GiB memory",
    );
    // In its cluster's root pool, which vSphere never shows: no pool chip.
    await expect(page.getByTestId("vmware-vm-hero-chips")).not.toContainText(
      "Pool",
    );

    expect(
      await attentionRows(page.getByTestId("vmware-vm-attention")),
    ).toEqual([{ key: `VirtualMachine:${vmId(1)}`, severity: "critical" }]);
    await expect(page.getByTestId("vmware-vm-attention-name")).toHaveText(
      "This VM",
    );
    await expect(page.getByTestId("vmware-vm-attention-reason")).toHaveText(
      "1.5 GiB of memory swapped by the host",
    );
    await expect(page.getByTestId("vmware-vm-tiles")).toContainText("78.4%");

    await expect(page.getByTestId("vmware-vm-open-item")).toHaveCount(1);
    await expect(page.getByTestId("vmware-vm-open-item")).toContainText(
      "[VMware] VM Memory Swapping - vcenter-prod",
    );
    await expect(page.getByTestId("vmware-vm-alerts-turn-on")).toHaveText(
      "Turn on 7 alerts",
    );
    await screenshot(page, "vm-db-primary");

    // Its host, one step away.
    await page
      .getByTestId("vmware-vm-hero-location")
      .getByRole("link", { name: "esx01.acme.example" })
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === hostPath("dc-east", "esx01.acme.example");
    });
  });

  test("cache-01, on a host vCenter lost: Disconnected, no numbers, and the host in Needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVm(page, 6, "cache-01");

    expect(await statusLabel(page.getByTestId("vmware-vm-hero-status"))).toBe(
      "Disconnected",
    );
    await expect(
      goldenTile(page.getByTestId("vmware-vm-tiles"), "CPU"),
    ).toContainText("—");
    const card: Locator = page.getByTestId("vmware-vm-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "Host:host/dc-east/esx03.acme.example", severity: "critical" },
    ]);
    await card.getByRole("link").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === hostPath("dc-east", "esx03.acme.example");
    });
  });

  test("batch-worker-01 names the pool it runs in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openVm(page, 9, "batch-worker-01");
    await expect(page.getByTestId("vmware-vm-hero-chips")).toContainText(
      "Pool batch",
    );
  });
});

test.describe("a datastore's page", () => {
  test("ds-prod-01: how full, how long until full, and the alerts that watch it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openDatastore(page, "dc-east", "ds-prod-01", "open=many");

    expect(
      await statusLabel(page.getByTestId("vmware-datastore-hero-status")),
    ).toBe("93% used");
    await expect(page.getByTestId("vmware-datastore-hero-location")).toHaveText(
      "Datastore in datacenter dc-east",
    );
    expect(
      await attentionRows(page.getByTestId("vmware-datastore-attention")),
    ).toEqual([
      { key: "Datastore:datastore/dc-east/ds-prod-01", severity: "critical" },
    ]);
    await expect(page.getByTestId("vmware-datastore-tiles")).toContainText(
      "93.0%",
    );
    await expect(page.getByTestId("vmware-datastore-tiles")).toContainText(
      "until full",
    );
    await expect(page.getByTestId("vmware-datastore-open-item")).toContainText(
      "[VMware] Datastore Capacity Critical (>90%) - vcenter-prod",
    );
    await expect(
      page.getByTestId("vmware-datastore-alerts-item"),
    ).toContainText([
      "Datastore Capacity Critical",
      "Datastore Capacity Warning",
    ]);
    await expect(
      page.getByTestId("vmware-datastore-alerts-turn-on"),
    ).toHaveText("Turn on 2 alerts");
    await screenshot(page, "datastore-ds-prod-01");
  });
});

test.describe("a cluster's page", () => {
  test("prod-cluster: Unhealthy for its lost host, what in it needs a look, and what is open on its hosts and VMs", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCluster(page, "dc-east", "prod-cluster");

    expect(
      await statusLabel(page.getByTestId("vmware-cluster-hero-status")),
    ).toBe("Unhealthy");
    expect(
      await attentionRows(page.getByTestId("vmware-cluster-attention")),
    ).toEqual([
      { key: "Host:host/dc-east/esx03.acme.example", severity: "critical" },
      { key: `VirtualMachine:${vmId(1)}`, severity: "critical" },
      { key: "Host:host/dc-east/esx02.acme.example", severity: "warning" },
      { key: `VirtualMachine:${vmId(3)}`, severity: "warning" },
      { key: `VirtualMachine:${vmId(2)}`, severity: "warning" },
    ]);

    const tiles: Locator = page.getByTestId("vmware-cluster-tiles");
    const effective: Locator = goldenTile(tiles, "Effective hosts");
    await expect(effective).toContainText("3/4");
    await expect(
      effective.getByTestId("golden-metric-tile-sublabel"),
    ).toHaveText("1 not responding");
    expect(await backgroundOf(tileBar(effective))).toBe(RED_500);

    // An incident on its host and an alert on its VM: both in this cluster.
    await expect(page.getByTestId("vmware-cluster-open-item")).toContainText([
      "[VMware] Host Not Responding - vcenter-prod",
      "[VMware] VM Memory Swapping - vcenter-prod",
    ]);
    await expect(
      page.getByTestId("vmware-cluster-hosts-card-item"),
    ).toHaveCount(4);
    await expect(page.getByTestId("vmware-cluster-alerts-turn-on")).toHaveText(
      "Turn on 3 alerts",
    );
    await screenshot(page, "cluster-prod");

    await openTab(page, "Virtual Machines");
    await expect(listRow(page, "cache-01")).toContainText("Disconnected");
  });

  test("west-cluster could not take the VMs of its largest host; dev-cluster has a host in maintenance mode", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCluster(page, "dc-west", "west-cluster");
    expect(
      await statusLabel(page.getByTestId("vmware-cluster-hero-status")),
    ).toBe("Degraded");
    const failure: Locator = goldenTile(
      page.getByTestId("vmware-cluster-tiles"),
      "Host failure",
    );
    await expect(failure).toContainText("Not covered");
    await expect(failure).toContainText(
      "of memory short without the largest host",
    );
    expect(await backgroundOf(tileBar(failure))).toBe(AMBER_500);

    await openCluster(page, "dc-east", "dev-cluster");
    const effective: Locator = goldenTile(
      page.getByTestId("vmware-cluster-tiles"),
      "Effective hosts",
    );
    await expect(
      effective.getByTestId("golden-metric-tile-sublabel"),
    ).toHaveText("1 in maintenance mode");
    expect(await backgroundOf(tileBar(effective))).toBe(AMBER_500);
    // Host failure cannot be told while a host is not effective, and says so.
    await expect(
      goldenTile(
        page.getByTestId("vmware-cluster-tiles"),
        "Host failure",
      ).getByTestId("golden-metric-tile-sublabel"),
    ).toHaveText("Not known while a host is not effective");
  });
});

test.describe("at a phone's width, in dark mode, in German and in Persian", () => {
  test("at 1024px and 768px beside the side menu, and at 390px, the Overview, the lists and each part's page fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    /*
     * At 1024px beside the side menu the top consumers sit two to a row: a
     * host's name breaks after its dots, never at the letter that filled
     * the line ("esx02.acme.exampl" / "e").
     */
    await page.setViewportSize({ width: 1024, height: 768 });
    await openOverview(page);
    await expect(page.getByTestId("vmware-top-consumers")).toBeVisible();
    const wrapped: Array<{ text: string; ends: Array<string> }> = (
      await lineEndsOf(page.getByTestId("vmware-top-consumer-name"))
    ).filter((name: { text: string; ends: Array<string> }): boolean => {
      return name.ends.length > 0;
    });
    expect(wrapped.length).toBeGreaterThan(0);
    expect(
      wrapped.filter((name: { text: string; ends: Array<string> }): boolean => {
        return name.ends.some((end: string): boolean => {
          return end !== "." && end !== "-";
        });
      }),
    ).toEqual([]);
    await screenshot(page, "tablet-overview");

    // At 768px the ESXi Hosts card's names, the same ("esx03.acme.exa" / "mple").
    await page.setViewportSize({ width: 768, height: 1024 });
    const cardNames: Array<{ text: string; ends: Array<string> }> =
      await lineEndsOf(page.getByTestId("vmware-hosts-card-name"));
    expect(
      cardNames.filter(
        (name: { text: string; ends: Array<string> }): boolean => {
          return name.ends.length > 0;
        },
      ).length,
    ).toBeGreaterThan(0);
    expect(
      cardNames.filter(
        (name: { text: string; ends: Array<string> }): boolean => {
          return name.ends.some((end: string): boolean => {
            return end !== "." && end !== "-";
          });
        },
      ),
    ).toEqual([]);
    await page.setViewportSize({ width: 1024, height: 768 });

    /*
     * The Hosts list beside the side menu: Status keeps its own 7rem floor,
     * not a column of prose's 10rem (with its padding the 184px that left
     * a host's name 56px), and a capacity stays with its unit.
     */
    await openPage(page, `${VCENTER_PATH}/hosts`);
    await expect(listRow(page, "esx02.acme.example")).toBeVisible();
    const statusWidth: number = await page
      .locator("thead th", { hasText: "Status" })
      .first()
      .evaluate((element: Element): number => {
        return element.getBoundingClientRect().width;
      });
    expect(statusWidth).toBeLessThan(184);
    expect(await listRow(page, "esx02.acme.example").textContent()).toContain(
      "76.80\u00a0GHz",
    );
    await expectTablesFitTheirCards(page);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "tablet-hosts");

    await page.setViewportSize({ width: 390, height: 844 });

    await openOverview(page);
    await expect(page.getByTestId("vmware-needs-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    /*
     * The top consumers' names whole: "esx-wes..." and "esx-we..." were two
     * hosts nobody could tell apart.
     */
    const names: Array<{ text: string; cut: boolean }> = await page
      .getByTestId("vmware-top-consumer-name")
      .evaluateAll(
        (elements: Array<Element>): Array<{ text: string; cut: boolean }> => {
          return elements.map((element: Element) => {
            return {
              text: element.textContent || "",
              cut: element.scrollWidth > element.clientWidth + 1,
            };
          });
        },
      );
    expect(names.length).toBeGreaterThan(0);
    expect(
      names.filter((name: { text: string; cut: boolean }): boolean => {
        return name.cut;
      }),
    ).toEqual([]);
    // A host's facts never break "512 GiB" from "memory".
    const facts: Locator = page.getByTestId("vmware-hosts-card-facts").first();
    const memoryFact: Locator = facts.locator("span", {
      hasText: "GiB memory",
    });
    expect(
      await memoryFact.evaluate((element: Element): number => {
        return element.getClientRects().length;
      }),
    ).toBe(1);
    await screenshot(page, "phone-overview");

    await openPage(page, `${VCENTER_PATH}/hosts`);
    await expect(page.getByText("esx02.acme.example").first()).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-hosts");

    await openHost(page, "dc-east", "esx02.acme.example");
    await expect(page.getByTestId("vmware-host-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-host");

    await openVm(page, 1, "db-primary");
    await expect(page.getByTestId("vmware-vm-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-vm");

    await openDatastore(page, "dc-east", "ds-prod-01");
    await expect(page.getByTestId("vmware-datastore-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);

    await openCluster(page, "dc-east", "prod-cluster");
    await expect(page.getByTestId("vmware-cluster-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-cluster");
  });

  test("in dark mode the pages draw on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("vmware-needs-attention")).toBeVisible();
    await screenshot(page, "dark-overview");

    await openCluster(page, "dc-east", "prod-cluster", "theme=dark");
    await expect(page.getByTestId("vmware-cluster-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "dark-cluster");
  });

  test("in German, the Overview and a host's page speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");
    expect(GERMAN["Needs attention"]).not.toBe("Needs attention");
    await expect(
      page
        .getByTestId("vmware-needs-attention")
        .getByText(GERMAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    // A reason in German, its number in it.
    expect(GERMAN["Not responding"]).not.toBe("Not responding");
    await expect(
      page
        .getByTestId("vmware-needs-attention")
        .locator('[data-key="Host:host/dc-east/esx03.acme.example"]')
        .getByTestId("vmware-needs-attention-reason"),
    ).toHaveText(GERMAN["Not responding"] as string);
    // The count chips speak German too.
    await expect(page.getByTestId("vmware-hero-datacenters")).toHaveText(
      (GERMAN["{{count}} datacenters"] as string).replace("{{count}}", "2"),
    );
    // And the tiles, the charts and the top consumers: they were English.
    expect(GERMAN["Effective hosts"]).not.toBe("Effective hosts");
    await expect(
      goldenTile(page, GERMAN["Effective hosts"] as string),
    ).toContainText("6/8");
    await expect(
      page
        .getByTestId("vmware-top-datastores")
        .getByText(GERMAN["Datastore Utilization"] as string, { exact: true }),
    ).toBeVisible();
    await screenshot(page, "german-overview");

    await openHost(page, "dc-east", "esx03.acme.example", "lang=de");
    expect(await statusLabel(page.getByTestId("vmware-host-hero-status"))).toBe(
      GERMAN["Not responding"],
    );
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
    // "7/۸" read as two kinds of digit: the chip writes both its own way.
    const hostsChip: string =
      (await page.getByTestId("vmware-hero-hosts").textContent()) || "";
    expect(hostsChip).toContain("۷/۸");
    expect(hostsChip).not.toMatch(LATIN_DIGIT);
    await expect(
      page
        .getByTestId("vmware-needs-attention")
        .getByText(PERSIAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-overview");

    await page.setViewportSize({ width: 390, height: 844 });
    await openCluster(page, "dc-east", "prod-cluster", "lang=fa");
    await expect(page.getByTestId("vmware-cluster-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-phone-cluster");
  });
});

/*
 * The vCenter's side menu beside a part's own page: the list it is one row
 * of is lit, holding the page (Common's SideMenuRowPage).
 */
const PART_PAGES: Array<{
  part: string;
  list: string;
  listPath: string;
  open: (page: Page) => Promise<void>;
}> = [
  {
    part: "an ESXi host",
    list: "Hosts",
    listPath: `${VCENTER_PATH}/hosts`,
    open: async (page: Page): Promise<void> => {
      await openHost(page, "dc-east", "esx02.acme.example");
    },
  },
  {
    part: "a virtual machine",
    list: "Virtual Machines",
    listPath: `${VCENTER_PATH}/virtual-machines`,
    open: async (page: Page): Promise<void> => {
      await openVm(page, 1, "db-primary");
    },
  },
  {
    part: "a datastore",
    list: "Datastores",
    listPath: `${VCENTER_PATH}/datastores`,
    open: async (page: Page): Promise<void> => {
      await openDatastore(page, "dc-east", "ds-prod-01");
    },
  },
  {
    part: "a cluster",
    list: "Clusters",
    listPath: `${VCENTER_PATH}/clusters`,
    open: async (page: Page): Promise<void> => {
      await openCluster(page, "dc-east", "prod-cluster");
    },
  },
];

test.describe("the vCenter's side menu", () => {
  for (const { part, list, listPath, open } of PART_PAGES) {
    test(`on ${part}'s page, ${list} is lit: the one current entry, leading to the list`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page);

      const current: Locator = page
        .locator("aside[role='navigation']")
        .locator("a[aria-current]");
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("aria-current", "true");
      await expect(current.getByTestId("side-menu-item-title")).toHaveText(
        list,
      );
      await expect(current).toHaveAttribute("href", listPath);
    });
  }
});
