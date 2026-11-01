import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * A Proxmox VE cluster's pages, in a browser, against the offline fixture
 * (ProxmoxPages/Fixture).
 *
 * The maintainer: "How can we make the Proxmox product a lot better and
 * world-class? ... feature-rich, simple and natural to use."
 *
 * So, read the way an administrator reads them: the cluster's Overview says
 * what needs attention first, the most urgent first, with one step to each
 * part's page; then each node's state and load, and how the last backups
 * went. A node's, a guest's and a storage's own page says who it is and
 * where it sits, what on it needs a look, how busy or full it is, what is
 * open on it, and which of the cluster's alerts watch it, with "Turn on N
 * alerts" opening Recommendations with exactly those selected. A cluster
 * that has never sent Proxmox VE's notifications says how to; a calm one
 * says nothing; a read that fails says so. At a laptop's and a phone's
 * width, in dark mode, in German and in Persian. The fixture records every
 * read, so the tests check that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "71000000-0000-4000-8000-000000000001";
const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/proxmox/${CLUSTER_ID}`;

function nodePath(name: string): string {
  return `${CLUSTER_PATH}/nodes/${encodeURIComponent(`node/${name}`)}`;
}

function guestPath(externalId: string): string {
  return `${CLUSTER_PATH}/guests/${encodeURIComponent(externalId)}`;
}

function storagePath(nodeName: string, name: string): string {
  return `${CLUSTER_PATH}/storage/${encodeURIComponent(
    `storage/${nodeName}/${name}`,
  )}`;
}

// The busy cluster's attention list, most urgent first (Fixture/Data.js).
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: "Node:node/pve3", severity: "critical" },
  { key: "Storage:storage/pve3/local", severity: "critical" },
  { key: "Storage:storage/pve1/pbs-offsite", severity: "critical" },
  { key: "Guest:qemu/104", severity: "critical" },
  { key: "Storage:storage/pve2/local-zfs", severity: "warning" },
  { key: "Guest:qemu/102", severity: "warning" },
  { key: "Guest:lxc/110", severity: "warning" },
  { key: "Guest:lxc/109", severity: "warning" },
  { key: "Replication:101-0", severity: "warning" },
];

// The cluster's alerts that watch every node (PROXMOX_NODE_ALERT_TEMPLATE_IDS).
const NODE_ALERT_IDS: Array<string> = [
  "Proxmox:pve-node-offline",
  "Proxmox:pve-node-restarted",
  "Proxmox:pve-node-high-cpu",
  "Proxmox:pve-node-high-memory",
  "Proxmox:pve-node-fenced",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/proxmox-pages-ui",
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

interface ListRequest {
  modelName: string;
  query: Record<string, unknown> | null;
}

interface Recorded {
  listRequests: Array<ListRequest>;
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
          window as unknown as { __proxmoxPagesFixture?: Recorded }
        ).__proxmoxPagesFixture;
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
  await openPage(page, CLUSTER_PATH, query);
  await expect(page.getByTestId("proxmox-hero-health")).toBeVisible();
  await expect(page.getByTestId("proxmox-nodes-card")).toBeVisible();
}

async function openNode(
  page: Page,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, nodePath(name), query);
  await expect(page.getByTestId("proxmox-node-hero-name")).toHaveText(name);
}

async function openGuest(
  page: Page,
  externalId: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, guestPath(externalId), query);
  await expect(page.getByTestId("proxmox-guest-hero-name")).toHaveText(name);
}

async function openStorage(
  page: Page,
  nodeName: string,
  name: string,
  query: string = "",
): Promise<void> {
  await openPage(page, storagePath(nodeName, name), query);
  await expect(page.getByTestId("proxmox-storage-hero-name")).toHaveText(name);
}

/*
 * A hero's status pill, as it reads: its label, without the description it
 * carries for screen readers (which names every state a part can be in).
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

// A tab by its English name, whatever language draws it.
async function openTab(page: Page, name: string): Promise<void> {
  const tab: Locator = page.getByTestId(`tab-${name}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
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

// The colour a pill or a cell is drawn in, as the browser computed it.
async function colourOf(locator: Locator): Promise<string> {
  return await locator.evaluate((element: Element): string => {
    return getComputedStyle(element).color;
  });
}

// Tailwind's gray-600, red-700 and amber-700, as computed colours.
const GREY_600: string = "rgb(75, 85, 99)";
const RED_700: string = "rgb(185, 28, 28)";
const AMBER_700: string = "rgb(180, 83, 9)";

// A Latin digit, which a Persian count chip should not mix with its own.
const LATIN_DIGIT: RegExp = /[0-9]/;

// A golden tile on the Overview, found by its title in the reader's language.
function goldenTile(page: Page, title: string): Locator {
  return page
    .locator("span.uppercase", { hasText: title })
    .first()
    .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
}

async function selectedRecommendations(page: Page): Promise<Array<string>> {
  await expect(page).toHaveURL((url: URL): boolean => {
    return url.pathname === `${CLUSTER_PATH}/recommendations`;
  });
  return (new URL(page.url()).searchParams.get("select") || "")
    .split(",")
    .filter((id: string): boolean => {
      return id.length > 0;
    })
    .sort();
}

test.describe("the cluster's Overview", () => {
  test("says what needs attention first, the most urgent first, and opens each part's page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const card: Locator = page.getByTestId("proxmox-needs-attention");
    await expect(card).toBeVisible();
    await expect(page.getByTestId("proxmox-hero-health")).toHaveText(
      "Unhealthy",
    );
    await expect(
      page.getByTestId("proxmox-needs-attention-summary").locator("span"),
    ).toHaveText(["4 critical", "5 to look at"]);

    // Six rows first, the rest one click away.
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION.slice(0, 6));
    await expect(page.getByTestId("proxmox-needs-attention-toggle")).toHaveText(
      "Show 3 more",
    );
    await page.getByTestId("proxmox-needs-attention-toggle").click();
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION);

    // Each row says why.
    const mail: Locator = card.locator('[data-key="Guest:qemu/104"]');
    await expect(mail.getByTestId("proxmox-needs-attention-reason")).toHaveText(
      ["HA state: error", "Stopped, but starts on boot"],
    );
    await expect(
      card
        .locator('[data-key="Guest:qemu/102"]')
        .getByTestId("proxmox-needs-attention-reason"),
    ).toHaveText("Last backup failed");

    await screenshot(page, "overview-attention");

    /*
     * Each row is one link, the whole row, as on Home's Needs attention
     * card: its reasons are inside it, and a node's row has no id line that
     * would only repeat its name.
     */
    const pve3: Locator = card.locator('[data-key="Node:node/pve3"]');
    await expect(pve3.getByRole("link")).toHaveCount(1);
    await expect(pve3.getByRole("link")).toContainText("Offline");
    await expect(pve3).not.toContainText("node/pve3");
    await expect(
      card.locator('[data-key="Guest:qemu/104"]').getByRole("link"),
    ).toContainText("qemu/104");

    // One step to the part's own page, from anywhere on its row.
    await pve3
      .getByTestId("proxmox-needs-attention-reason")
      .getByText("Offline")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === nodePath("pve3");
    });
    await expect(page.getByTestId("proxmox-node-hero-name")).toHaveText("pve3");
  });

  test("draws each node's state and load, the down one first, and how the last backups went", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const nodes: Locator = page.getByTestId("proxmox-nodes-card-item");
    await expect(nodes).toHaveCount(3);
    await expect(page.getByTestId("proxmox-nodes-card-status")).toHaveText([
      "Offline",
      "Online",
      "Online",
    ]);
    await expect(nodes.first()).toContainText("pve3");
    await expect(
      nodes.nth(2).getByTestId("proxmox-nodes-card-cpu"),
    ).toContainText("78%");

    const stat: (key: string) => Locator = (key: string): Locator => {
      return page.locator(
        `[data-testid="proxmox-backups-card-stat"][data-key="${key}"]`,
      );
    };
    await expect(stat("ok")).toContainText("9");
    await expect(stat("failed")).toContainText("1");
    await expect(stat("not-in-job")).toContainText("1");
    await expect(stat("newest")).toContainText("7 hours ago");
    // The cluster sends its notifications: nothing to set up.
    await expect(page.getByTestId("proxmox-backups-card-setup")).toHaveCount(0);

    await page.getByTestId("proxmox-backups-card-guests").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${CLUSTER_PATH}/guests`;
    });

    // A node's whole row is the step to its page, its bars included.
    await openOverview(page);
    await page
      .getByTestId("proxmox-nodes-card-item")
      .nth(2)
      .getByTestId("proxmox-nodes-card-cpu")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === nodePath("pve2");
    });
  });

  test("a cluster that has never sent Proxmox VE's notifications says how to, and the guide ends on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "notifications=off");

    // Coverage still comes from the exporter; results need the notifications.
    await expect(
      page.locator(
        '[data-testid="proxmox-backups-card-stat"][data-key="not-in-job"]',
      ),
    ).toContainText("1");
    await expect(
      page.locator('[data-testid="proxmox-backups-card-stat"][data-key="ok"]'),
    ).toHaveCount(0);
    await expect(page.getByTestId("proxmox-backups-card-setup")).toContainText(
      "send Proxmox VE's notifications to OneUptime with two commands on any node",
    );

    await page.getByTestId("proxmox-backups-card-setup-link").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLUSTER_PATH}/documentation` &&
        url.hash === "#send-notifications"
      );
    });
    // The guide opens on its last step, not on step 1 of an install done.
    await expect(
      page.getByRole("heading", {
        name: "Step 5: Send Proxmox VE's notifications",
      }),
    ).toBeVisible();
    await expect(page.getByTestId("setup-guide-step-5")).toBeInViewport();
    await expect(page.getByTestId("setup-guide-step-1")).not.toBeInViewport();
    await expect(
      page.getByText(/Needs Proxmox VE 8\.3 or later\./),
    ).toBeVisible();
    // With a key picked in step 1, the two commands are there to copy.
    await expect(
      page.getByText("pvesh create /cluster/notifications/matchers", {
        exact: false,
      }),
    ).toBeVisible();
  });

  test("a calm cluster has nothing to say: no Needs attention card, and Healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=calm");

    await expect(page.getByTestId("proxmox-hero-health")).toHaveText("Healthy");
    await expect(page.getByTestId("proxmox-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("proxmox-nodes-card-status")).toHaveText([
      "Online",
      "Online",
      "Online",
    ]);
  });

  test("a disconnected cluster's last snapshot is not the truth: no Needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "collector=disconnected");

    await expect(page.getByTestId("proxmox-needs-attention")).toHaveCount(0);
  });

  test("twenty-four nodes: the first eight, and a way to all of them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=large");

    await expect(page.getByTestId("proxmox-nodes-card-item")).toHaveCount(8);
    // The node that is down comes first.
    await expect(
      page.getByTestId("proxmox-nodes-card-item").first(),
    ).toContainText("pve-17");
    await expect(page.getByTestId("proxmox-nodes-card-all")).toHaveText(
      "View all 24 nodes",
    );
    await expectNoSidewaysScroll(page);
  });

  test("when the inventory cannot be read, the Overview says so instead of drawing an empty cluster", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, CLUSTER_PATH, "fail=inventory");

    await expect(
      page
        .getByText("Something went wrong on the server. Please try again.", {
          exact: false,
        })
        .first(),
    ).toBeVisible();
    await expect(page.getByTestId("proxmox-needs-attention")).toHaveCount(0);
    await expect(page.getByTestId("proxmox-nodes-card")).toHaveCount(0);
    // The guests are unknown, not "0/13 running" with a red bar.
    const guests: Locator = goldenTile(page, "Guests");
    await expect(guests).toContainText("—");
    await expect(guests).not.toContainText("0/13");
  });

  test("a cluster that has reported no part yet has no health to tell", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, CLUSTER_PATH, "estate=new");

    await expect(page.getByTestId("proxmox-hero-connection")).toHaveText(
      "Connected",
    );
    await expect(goldenTile(page, "Guests")).toContainText("—");
    // "Healthy" with nothing reported would be a guess.
    await expect(page.getByTestId("proxmox-hero-health")).toHaveCount(0);
    await expect(page.getByTestId("proxmox-needs-attention")).toHaveCount(0);
  });
});

test.describe("a node's page", () => {
  test("pve2: who it is, what on it needs a look, how busy it is, the guests keeping it busy, and its details", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openNode(page, "pve2");

    expect(
      await statusLabel(page.getByTestId("proxmox-node-hero-status")),
    ).toBe("Online");
    await expect(page.getByTestId("proxmox-node-hero-location")).toHaveText(
      "Node of cluster pve-prod",
    );
    await expect(page.getByTestId("proxmox-node-hero-chips")).toContainText(
      "64 cores",
    );
    await expect(page.getByTestId("proxmox-node-hero-chips")).toContainText(
      "Community subscription",
    );

    // What on the node needs a look: its storage and its guests.
    expect(
      await attentionRows(page.getByTestId("proxmox-node-attention")),
    ).toEqual([
      { key: "Storage:storage/pve2/local-zfs", severity: "warning" },
      { key: "Guest:qemu/102", severity: "warning" },
      { key: "Guest:lxc/109", severity: "warning" },
    ]);

    await expect(page.getByTestId("proxmox-node-tiles")).toContainText("78.4%");
    await expect(page.getByTestId("proxmox-node-tiles")).toContainText("5/5");

    // The busiest running guests, by CPU.
    const busy: Locator = page.getByTestId("proxmox-busy-guest");
    await expect(busy).toHaveCount(5);
    await expect(busy).toContainText([
      "db-01",
      "analytics",
      "web-02",
      "monitoring",
      "vpn",
    ]);
    await expect(busy.first()).toContainText("91.6%");
    await expect(
      busy.first().getByTestId("proxmox-busy-guest-cpu"),
    ).toContainText("CPU");
    await expect(busy.first().getByRole("link")).toHaveAttribute(
      "href",
      guestPath("qemu/102"),
    );

    await expect(page.getByTestId("proxmox-node-details-id")).toContainText(
      "node/pve2",
    );
    await expect(page.getByTestId("proxmox-node-details-ha")).toContainText(
      "online",
    );

    await screenshot(page, "node-pve2");

    // "View all 6 guests" opens the node's Guests tab.
    await page
      .getByTestId("proxmox-busiest-guests-all")
      .getByRole("button", { name: "View all 6 guests" })
      .click();
    await expect(page.getByTestId("tab-Guests")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(
      page.getByText("db-01", { exact: true }).first(),
    ).toBeVisible();

    // Its Storage tab lists what the node reports, each a step from its page.
    await openTab(page, "Storage");
    await expect(page.getByTestId("tab-Storage")).toContainText("2");
    const zfsRow: Locator = page
      .getByRole("row")
      .filter({ hasText: "local-zfs" });
    await expect(zfsRow).toHaveCount(1);
    await expect(zfsRow).toContainText("ZFS");
  });

  test("pve3, which is down: Offline, its open incident, and itself first in what needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openNode(page, "pve3");

    expect(
      await statusLabel(page.getByTestId("proxmox-node-hero-status")),
    ).toBe("Offline");
    await expect(page.getByTestId("proxmox-node-open-item")).toHaveCount(1);
    await expect(page.getByTestId("proxmox-node-open-item")).toContainText(
      "[Proxmox] Node Offline - pve-prod",
    );

    const card: Locator = page.getByTestId("proxmox-node-attention");
    const rows: Array<{ key: string; severity: string }> =
      await attentionRows(card);
    expect(rows[0]).toEqual({ key: "Node:node/pve3", severity: "critical" });
    // The node's own row says so, and needs no link to the page it is on.
    const own: Locator = card.locator('[data-key="Node:node/pve3"]');
    await expect(own.getByTestId("proxmox-node-attention-name")).toHaveText(
      "This node",
    );
    await expect(own.getByRole("link")).toHaveCount(0);
    // Nothing runs on it: no busiest guests to rank.
    await expect(page.getByTestId("proxmox-busiest-guests")).toHaveCount(0);
    // Its guest, one step away.
    await card
      .locator('[data-key="Guest:qemu/104"]')
      .getByRole("link", { name: "mail" })
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === guestPath("qemu/104");
    });
  });

  test("Turn on 5 alerts opens Recommendations with exactly the node alerts selected", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openNode(page, "pve2");

    await expect(page.getByTestId("proxmox-node-alerts-item")).toHaveCount(5);
    await expect(page.getByTestId("proxmox-node-alerts-turn-on")).toHaveText(
      "Turn on 5 alerts",
    );
    // Not set up reads grey, never five amber warnings.
    expect(
      await colourOf(
        page
          .getByTestId("proxmox-node-alerts-item")
          .first()
          .getByText("Not set up"),
      ),
    ).toBe(GREY_600);
    await page.getByTestId("proxmox-node-alerts-turn-on").click();

    const selected: Array<string> = await selectedRecommendations(page);
    expect(selected).toEqual([...NODE_ALERT_IDS].sort());

    for (const id of selected) {
      await expect(
        page.getByTestId(`recommendation-card-select-${id}`),
      ).toHaveAttribute("aria-pressed", "true");
    }
    // Nothing else is picked for them.
    await expect(
      page.getByTestId("recommendation-card-select-Proxmox:pve-guest-down"),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("5 monitors selected")).toBeVisible();

    await screenshot(page, "node-alerts-recommendations");
  });

  test("with two node alerts on, it offers the other three", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openNode(page, "pve2", "alerts=some");

    await expect(page.getByTestId("proxmox-node-alerts-turn-on")).toHaveText(
      "Turn on 3 alerts",
    );
    await page.getByTestId("proxmox-node-alerts-turn-on").click();
    expect(await selectedRecommendations(page)).toEqual(
      [
        "Proxmox:pve-node-restarted",
        "Proxmox:pve-node-high-memory",
        "Proxmox:pve-node-fenced",
      ].sort(),
    );
  });
});

test.describe("a guest's page", () => {
  test("db-01: its node and tags, a failed last backup, its open alert and its alerts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuest(page, "qemu/102", "db-01");

    expect(
      await statusLabel(page.getByTestId("proxmox-guest-hero-status")),
    ).toBe("Running");
    await expect(page.getByTestId("proxmox-guest-hero-location")).toHaveText(
      "On node pve2 of cluster pve-prod",
    );
    await expect(page.getByTestId("proxmox-guest-hero-tag")).toHaveText([
      "prod",
      "db",
    ]);
    await expect(page.getByTestId("proxmox-guest-hero-chips")).toContainText(
      "VMID 102",
    );

    expect(
      await attentionRows(page.getByTestId("proxmox-guest-attention")),
    ).toEqual([{ key: "Guest:qemu/102", severity: "warning" }]);
    await expect(page.getByTestId("proxmox-guest-attention-name")).toHaveText(
      "This guest",
    );
    await expect(page.getByTestId("proxmox-guest-tiles")).toContainText(
      "Failed",
    );

    await expect(page.getByTestId("proxmox-guest-open-item")).toHaveCount(1);
    await expect(page.getByTestId("proxmox-guest-open-item")).toContainText(
      "[Proxmox] High Guest CPU Usage - pve-prod",
    );

    await expect(page.getByTestId("proxmox-guest-alerts-turn-on")).toHaveText(
      "Turn on 7 alerts",
    );
    await expect(page.getByTestId("proxmox-guest-alerts-item")).toContainText([
      "Guest Down",
      "High Guest CPU Usage",
      "HA Resource in Error State",
      "Guest Not Backed Up",
      "Backup Job Failed",
      "Backup Running Too Long",
      "Replication Failing",
    ]);
    await expect(page.getByTestId("proxmox-guest-details-node")).toContainText(
      "pve2",
    );

    await screenshot(page, "guest-db-01");

    // Its node, one step away.
    await page
      .getByTestId("proxmox-guest-hero-location")
      .getByRole("link", { name: "pve2" })
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === nodePath("pve2");
    });
  });

  test("a guest locked by a backup says so, and a template is a template", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openGuest(page, "lxc/105", "ci-runner");
    await expect(
      page.locator('[data-testid="proxmox-guest-hero-badge"][data-key="lock"]'),
    ).toHaveText("Backup running");

    await openGuest(page, "qemu/9000", "debian-12-template");
    expect(
      await statusLabel(page.getByTestId("proxmox-guest-hero-status")),
    ).toBe("Template");
    // A template is never down: nothing about it needs attention.
    await expect(page.getByTestId("proxmox-guest-attention")).toHaveCount(0);
    await expect(page.getByTestId("proxmox-guest-tiles")).toContainText(
      "in a backup job, no result yet",
    );
    // It never runs: no CPU, memory or disk tile, and no guest agent hint.
    await expect(
      page.getByTestId("proxmox-guest-tiles").locator(":scope > div"),
    ).toHaveCount(1);
    await expect(page.getByTestId("proxmox-guest-tiles")).not.toContainText(
      "QEMU guest agent",
    );
  });
});

test.describe("a storage's page", () => {
  test("local-zfs: how full, how long until full, and the alerts that watch it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStorage(page, "pve2", "local-zfs");

    expect(
      await statusLabel(page.getByTestId("proxmox-storage-hero-status")),
    ).toBe("Available");
    await expect(page.getByTestId("proxmox-storage-hero-location")).toHaveText(
      "Storage on node pve2 of cluster pve-prod",
    );
    await expect(
      page.locator(
        '[data-testid="proxmox-storage-hero-badge"][data-key="shared"]',
      ),
    ).toHaveText("Local");
    await expect(page.getByTestId("proxmox-storage-hero-chips")).toContainText(
      "ZFS",
    );

    expect(
      await attentionRows(page.getByTestId("proxmox-storage-attention")),
    ).toEqual([{ key: "Storage:storage/pve2/local-zfs", severity: "warning" }]);
    await expect(page.getByTestId("proxmox-storage-tiles")).toContainText(
      "95.0%",
    );
    await expect(page.getByTestId("proxmox-storage-tiles")).toContainText(
      "until full",
    );

    await expect(page.getByTestId("proxmox-storage-alerts-item")).toContainText(
      ["Storage Unavailable", "Storage Near Full"],
    );
    await expect(page.getByTestId("proxmox-storage-alerts-turn-on")).toHaveText(
      "Turn on 2 alerts",
    );
    await expect(
      page.getByTestId("proxmox-storage-details-type"),
    ).toContainText("ZFS");

    await screenshot(page, "storage-local-zfs");
  });

  test("pbs-offsite, which Proxmox VE cannot reach: Unavailable, critical, and shared", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openStorage(page, "pve1", "pbs-offsite");

    expect(
      await statusLabel(page.getByTestId("proxmox-storage-hero-status")),
    ).toBe("Unavailable");
    await expect(
      page.locator(
        '[data-testid="proxmox-storage-hero-badge"][data-key="shared"]',
      ),
    ).toHaveText("Shared");
    expect(
      await attentionRows(page.getByTestId("proxmox-storage-attention")),
    ).toEqual([
      { key: "Storage:storage/pve1/pbs-offsite", severity: "critical" },
    ]);
    await expect(
      page.getByTestId("proxmox-storage-attention-reason"),
    ).toHaveText("Unavailable");
  });
});

test.describe("the lists", () => {
  test("Guests: a Backup column that says how each guest's last backup went", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${CLUSTER_PATH}/guests`);

    await expect(
      page.getByRole("columnheader", { name: "Backup" }).first(),
    ).toBeVisible();
    const dbRow: Locator = page.getByRole("row").filter({ hasText: "db-01" });
    await expect(dbRow).toHaveCount(1);
    await expect(dbRow).toContainText("Failed");
    const vpnRow: Locator = page.getByRole("row").filter({ hasText: "vpn" });
    await expect(vpnRow).toContainText("In no backup job");
    // The cells that need a look stand out, in words and in colour.
    expect(await colourOf(dbRow.getByText("Failed", { exact: false }))).toBe(
      RED_700,
    );
    expect(await colourOf(vpnRow.getByText("In no backup job"))).toBe(
      AMBER_700,
    );
    await expectNoSidewaysScroll(page);
  });

  test("Storage: its type and sharing, and no Age column of dashes", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, `${CLUSTER_PATH}/storage`);

    await expect(
      page.getByRole("columnheader", { name: "Shared" }).first(),
    ).toBeVisible();
    // Proxmox reports no uptime for a storage.
    await expect(
      page.getByRole("columnheader", { name: "Age", exact: true }),
    ).toHaveCount(0);
    const pbsRow: Locator = page
      .getByRole("row")
      .filter({ hasText: "pbs-offsite" });
    await expect(pbsRow).toContainText("Proxmox Backup Server");
    await expectNoSidewaysScroll(page);
  });
});

test.describe("at a phone's width, in dark mode, in German and in Persian", () => {
  test("at 390px the Overview and each part's page fit the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });

    await openOverview(page);
    await expect(page.getByTestId("proxmox-needs-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-overview");

    await openNode(page, "pve2");
    await expect(page.getByTestId("proxmox-node-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-node");

    await openGuest(page, "qemu/102", "db-01");
    await expect(page.getByTestId("proxmox-guest-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-guest");

    await openStorage(page, "pve2", "local-zfs");
    await expect(page.getByTestId("proxmox-storage-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-storage");
  });

  test("in dark mode the pages draw on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("proxmox-needs-attention")).toBeVisible();
    await screenshot(page, "dark-overview");

    await openNode(page, "pve3", "theme=dark");
    await expect(page.getByTestId("proxmox-node-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "dark-node");
  });

  test("in German, the Overview and a node's page speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");
    await expect(
      page
        .getByTestId("proxmox-needs-attention")
        .getByText(GERMAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    expect(GERMAN["Needs attention"]).not.toBe("Needs attention");
    // The count chips speak German too.
    await expect(page.getByTestId("proxmox-hero-nodes")).toHaveText(
      (GERMAN["{{online}}/{{count}} nodes online"] as string)
        .replace("{{online}}", "2")
        .replace("{{count}}", "3"),
    );
    // A tile's one long German word breaks inside its box, not under its icon.
    const availability: Locator = goldenTile(
      page,
      GERMAN["Node Availability"] as string,
    );
    const title: Locator = availability.locator("span.uppercase").first();
    const icon: Locator = availability
      .locator(":scope > div")
      .first()
      .locator(":scope > div")
      .last();
    const titleBox: { x: number; width: number } | null =
      await title.boundingBox();
    const iconBox: { x: number } | null = await icon.boundingBox();
    expect(titleBox && iconBox).toBeTruthy();
    expect(titleBox!.x + titleBox!.width).toBeLessThanOrEqual(iconBox!.x);

    await openNode(page, "pve2", "lang=de");
    await expect(page.getByTestId("proxmox-node-hero-location")).toHaveText(
      (GERMAN["Node of cluster {{cluster}}"] as string).replace(
        "{{cluster}}",
        "pve-prod",
      ),
    );
    await expect(page.getByTestId("tab-Guests")).toContainText(
      GERMAN["Guests"] as string,
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "german-node");
  });

  test("in Persian, the pages read right to left and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    // "2/۳" read as two kinds of digit: the chip writes both its own way.
    const nodesChip: string =
      (await page.getByTestId("proxmox-hero-nodes").textContent()) || "";
    expect(nodesChip).toContain("۲/۳");
    expect(nodesChip).not.toMatch(LATIN_DIGIT);
    await expect(
      page
        .getByTestId("proxmox-needs-attention")
        .getByText(PERSIAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-overview");

    await page.setViewportSize({ width: 390, height: 844 });
    await openGuest(page, "qemu/102", "db-01", "lang=fa");
    await expect(page.getByTestId("proxmox-guest-tiles")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-phone-guest");
  });
});

/*
 * The cluster's side menu beside a part's own page, and beside a tablet's
 * narrow menu.
 *
 * A node's, a guest's and a storage's page is one of the rows its list
 * shows, but the menu has an entry for the list only: nothing in it was lit
 * there, and a phone's menu button read the trail's last crumb. The shared
 * menu now lights the list a page is one row of (Common's SideMenuRowPage),
 * telling a screen reader it holds the page (aria-current="true").
 *
 * Beside the 224 pixel menu of a 768 to 1023 pixel window, a count leaves a
 * title some 120 pixels, and "Recommendations" (131) broke there as
 * "Recommendatio / ns", with no hyphen. Its count now moves under it, to the
 * row's end, and the word stays whole; from 1024 it shares the line again.
 */

const PART_PAGES: Array<{
  part: string;
  list: string;
  listPath: string;
  open: (page: Page) => Promise<void>;
}> = [
  {
    part: "a node",
    list: "Nodes",
    listPath: `${CLUSTER_PATH}/nodes`,
    open: async (page: Page): Promise<void> => {
      await openNode(page, "pve2");
    },
  },
  {
    part: "a guest",
    list: "Guests",
    listPath: `${CLUSTER_PATH}/guests`,
    open: async (page: Page): Promise<void> => {
      await openGuest(page, "qemu/102", "db-01");
    },
  },
  {
    part: "a storage",
    list: "Storage",
    listPath: `${CLUSTER_PATH}/storage`,
    open: async (page: Page): Promise<void> => {
      await openStorage(page, "pve2", "local-zfs");
    },
  },
];

function desktopMenu(page: Page): Locator {
  return page.locator("aside[role='navigation']");
}

// A menu row by its title, as the menu draws it.
function menuRow(menu: Locator, title: string): Locator {
  return menu.locator("a").filter({
    has: menu.page().getByTestId("side-menu-item-title").getByText(title, {
      exact: true,
    }),
  });
}

interface RowLayout {
  // The lines the title's words take, and whether a word broke across two.
  titleLines: number;
  brokenWord: boolean;
  // Where the count sits: on the title's line, or on the line below.
  badgeBelowTitle: boolean;
  // The gap between the count's end and the row's end, in pixels.
  badgeEndGap: number;
}

async function rowLayout(row: Locator): Promise<RowLayout> {
  return await row.evaluate((anchor: Element): RowLayout => {
    const title: Element = anchor.querySelector(
      '[data-testid="side-menu-item-title"]',
    )!;
    const badges: Element = anchor.querySelector(
      '[data-testid="side-menu-item-badges"]',
    )!;
    const text: Node = title.firstChild!;
    const words: Array<string> = (text.textContent || "").split(" ");
    let start: number = 0;
    let brokenWord: boolean = false;
    const lineTops: Set<number> = new Set<number>();

    for (const word of words) {
      const range: Range = document.createRange();
      range.setStart(text, start);
      range.setEnd(text, start + word.length);
      const tops: Set<number> = new Set<number>(
        Array.from(range.getClientRects())
          .filter((rect: DOMRect): boolean => {
            return rect.width > 0;
          })
          .map((rect: DOMRect): number => {
            return Math.round(rect.top);
          }),
      );
      brokenWord = brokenWord || tops.size > 1;
      tops.forEach((top: number) => {
        lineTops.add(top);
      });
      start += word.length + 1;
    }

    const titleBox: DOMRect = title.getBoundingClientRect();
    const badgeBox: DOMRect = badges.getBoundingClientRect();
    const rowBox: DOMRect = anchor.getBoundingClientRect();
    const rowEnd: number =
      rowBox.right - parseFloat(getComputedStyle(anchor).paddingRight);

    return {
      titleLines: lineTops.size,
      brokenWord,
      badgeBelowTitle: badgeBox.top >= titleBox.bottom - 1,
      badgeEndGap: Math.round(rowEnd - badgeBox.right),
    };
  });
}

test.describe("the cluster's side menu", () => {
  for (const { part, list, listPath, open } of PART_PAGES) {
    test(`on ${part}'s page, ${list} is lit: the one current entry, holding the page and leading to the list`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await open(page);

      const current: Locator = desktopMenu(page).locator("a[aria-current]");
      await expect(current).toHaveCount(1);
      await expect(current).toHaveAttribute("aria-current", "true");
      await expect(current.getByTestId("side-menu-item-title")).toHaveText(
        list,
      );
      await expect(current).toHaveAttribute("href", listPath);
    });
  }

  test("on a phone, a guest's page names Resources / Guests on the menu's button, and the opened menu lights Guests", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openGuest(page, "qemu/102", "db-01");

    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");
    await expect(toggle).toContainText("Resources / Guests");
    await expect(toggle).not.toContainText("Navigation");

    await toggle.click();
    // The menu the button opens, by the id it names.
    const opened: string = (await toggle.getAttribute("aria-controls")) || "";
    expect(opened).not.toBe("");
    const current: Locator = page
      .locator(`[id="${opened}"]`)
      .locator("a[aria-current]");
    await expect(current).toHaveCount(1);
    await expect(current).toHaveAttribute("aria-current", "true");
    await expect(current.getByTestId("side-menu-item-title")).toHaveText(
      "Guests",
    );
  });

  test("Recommendations keeps its whole word beside a tablet's menu: its count moves under it, to the row's end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    const menu: Locator = desktopMenu(page);
    const row: Locator = menuRow(menu, "Recommendations");
    // The count of what still needs doing, once it is read.
    await expect(row.getByTestId("side-menu-item-badges")).toHaveText(/\d+/);

    for (const width of [768, 900, 1023]) {
      await page.setViewportSize({ width, height: 900 });
      await expect
        .poll(async (): Promise<RowLayout> => {
          return await rowLayout(row);
        })
        .toEqual({
          titleLines: 1,
          brokenWord: false,
          badgeBelowTitle: true,
          badgeEndGap: 0,
        });
    }

    // Beside the 256 pixel menu the count shares the title's line again.
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect
      .poll(async (): Promise<RowLayout> => {
        return await rowLayout(row);
      })
      .toEqual({
        titleLines: 1,
        brokenWord: false,
        badgeBelowTitle: false,
        badgeEndGap: 0,
      });

    // Every other row with a count keeps it beside its title, at the end.
    await page.setViewportSize({ width: 768, height: 900 });
    for (const title of ["Nodes", "Guests", "Storage"]) {
      await expect
        .poll(async (): Promise<RowLayout> => {
          return await rowLayout(menuRow(menu, title));
        })
        .toEqual({
          titleLines: 1,
          brokenWord: false,
          badgeBelowTitle: false,
          badgeEndGap: 0,
        });
    }
    await screenshot(page, "menu-recommendations-768");
  });
});
