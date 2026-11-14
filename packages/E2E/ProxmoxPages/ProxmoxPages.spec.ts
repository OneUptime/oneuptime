import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";
import { boxesInOneFrame } from "../SuiteHelpers/Frames";

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

// An attribute that holds something.
const NON_EMPTY: RegExp = /\S/;

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

  /*
   * Issue #7439: the agent runs, but cannot read the Proxmox VE API. The
   * cluster used to say Connected for as long as the agent ran; it now says
   * the API cannot be read, and what to check - not that the agent stopped.
   */
  test("an agent that cannot read the API says so: not Connected, not stopped", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "collector=unreadable");

    await expect(page.getByTestId("proxmox-hero-connection")).toHaveText(
      "Can't read API",
    );
    // Its last read is no longer the truth either.
    await expect(page.getByTestId("proxmox-hero-health")).toHaveText(
      "Health Unknown",
    );
    await expect(page.getByTestId("proxmox-needs-attention")).toHaveCount(0);

    const card: Locator = page.getByTestId("resource-connection-guide");
    await expect(card).toHaveAttribute("data-variant", "unreadable");
    await expect(
      card.getByRole("heading", {
        name: "The agent can't read the Proxmox VE API",
      }),
    ).toBeVisible();
    await expect(card).toContainText(
      "it last read the cluster from the Proxmox VE API 25 minutes ago",
    );
    await expect(
      card.getByTestId("resource-connection-guide-step"),
    ).toHaveCount(3);
    await expect(card).toContainText(
      "docker logs oneuptime-pve-api-failover --tail 20",
    );
    await screenshot(page, "overview-cannot-read-api");
  });

  test("before its first read the agent waits for data, with the checks for when it stays", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, CLUSTER_PATH, "collector=waiting");

    await expect(page.getByTestId("proxmox-hero-connection")).toHaveText(
      "Waiting for data",
    );
    const card: Locator = page.getByTestId("resource-connection-guide");
    await expect(card).toHaveAttribute("data-variant", "waiting-for-read");
    await expect(
      card.getByRole("heading", {
        name: "The agent has not read the cluster yet",
      }),
    ).toBeVisible();
    await screenshot(page, "overview-waiting-for-first-read");
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

/*
 * #5307's follow-up: the cluster's Details card said its name, its
 * description, when it was last seen and its labels - all of which the
 * hero and the header say - and "Not reported" for every fact a new
 * cluster had not sent. It says what the cluster reported, in two columns,
 * and the hero says the description, under the name.
 */
interface DetailCell {
  label: string;
  value: string;
  x: number;
  y: number;
}

// The cells of a details card, by its detail's id, read in one frame.
async function detailCells(page: Page, id: string): Promise<Array<DetailCell>> {
  return await page
    .locator(`[id="${id}"]`)
    .evaluate((detail: Element): Array<DetailCell> => {
      return Array.from(
        detail.querySelectorAll('[data-testid="detail-field"]'),
      ).map((cell: Element): DetailCell => {
        const box: DOMRect = cell.getBoundingClientRect();
        return {
          label: (
            cell.querySelector('[data-testid="detail-label"]')?.textContent ||
            ""
          ).trim(),
          value: (
            cell.querySelector('[data-testid="detail-value"]')?.textContent ||
            ""
          ).trim(),
          x: Math.round(box.x),
          y: Math.round(box.y),
        };
      });
    });
}

const CLUSTER_DETAILS: string = "proxmox-cluster-overview";

test.describe("the cluster's Details card says what the hero does not", () => {
  test("what the cluster reported, two columns at a laptop's width, its ID line and Edit in Settings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    const detail: Locator = page.locator(`[id="${CLUSTER_DETAILS}"]`);
    await detail.scrollIntoViewIfNeeded();
    await expect(detail).toBeVisible();

    const cells: Array<DetailCell> = await detailCells(page, CLUSTER_DETAILS);
    expect(
      cells.map((cell: DetailCell): string => {
        return `${cell.label}: ${cell.value}`;
      }),
    ).toEqual(["PVE Version: 9.0.10", "Agent Version: 0.161.2"]);
    // Side by side: one row, two columns.
    expect(cells[0]!.y).toBe(cells[1]!.y);
    expect(cells[1]!.x).toBeGreaterThan(cells[0]!.x);

    // Never what the hero and the header say.
    for (const repeated of [
      "Cluster Name",
      "Description",
      "Last Seen",
      "Labels",
      "Not reported",
    ]) {
      await expect(detail.getByText(repeated, { exact: true })).toHaveCount(0);
    }

    // The record's ID line, at its foot.
    await expect(detail.getByTestId("detail-id-value")).toHaveText(CLUSTER_ID);
    // Its name, description and labels are edited on Settings.
    await expect(page.getByTestId("edit-in-settings")).toHaveCount(1);
    await expect(
      page.getByTestId("edit-in-settings").getByRole("link"),
    ).toHaveAttribute("href", `${CLUSTER_PATH}/settings`);
    await screenshot(page, "cluster-details-laptop");
  });

  /*
   * The UI review of #5553: with no description under it, the card's title
   * hung 7px above the middle of the 38px Edit in Settings beside it - the
   * two were level only at the top. They share one middle now, at a
   * laptop's width and beside a tablet's side menu, and the header is no
   * taller than it was.
   */
  for (const width of [1280, 1024]) {
    test(`at ${width}px its title and Edit in Settings share one middle`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 900 });
      await openOverview(page);
      const card: Locator = page
        .getByTestId("card")
        .filter({ has: page.locator(`[id="${CLUSTER_DETAILS}"]`) })
        .last();
      await card.scrollIntoViewIfNeeded();

      // Read in one frame, once the header has settled.
      await expect
        .poll(async (): Promise<number> => {
          return await card.evaluate((element: Element): number => {
            const title: DOMRect = element
              .querySelector('[data-testid="card-details-heading"]')!
              .getBoundingClientRect();
            const button: DOMRect = element
              .querySelector('[data-testid="edit-in-settings"] a')!
              .getBoundingClientRect();
            return Math.round(
              Math.abs(
                title.top + title.height / 2 - (button.top + button.height / 2),
              ),
            );
          });
        })
        .toBeLessThanOrEqual(1);
    });
  }

  test("the description is the hero's line, under the cluster's name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expect(page.getByTestId("resource-hero-description")).toHaveText(
      "Production cluster in the Amsterdam data centre: web, database and mail.",
    );
    await expect(
      page
        .locator(`[id="${CLUSTER_DETAILS}"]`)
        .getByText(
          "Production cluster in the Amsterdam data centre: web, database and mail.",
        ),
    ).toHaveCount(0);
  });

  test("on a phone, one column, inside the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openOverview(page);
    await page.locator(`[id="${CLUSTER_DETAILS}"]`).scrollIntoViewIfNeeded();

    const cells: Array<DetailCell> = await detailCells(page, CLUSTER_DETAILS);
    expect(cells).toHaveLength(2);
    expect(cells[1]!.y).toBeGreaterThan(cells[0]!.y);
    expect(cells[1]!.x).toBe(cells[0]!.x);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cluster-details-phone");
  });

  test("a cluster on Proxmox VE's own push, which has no agent: its PVE Version alone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=native");

    const cells: Array<DetailCell> = await detailCells(page, CLUSTER_DETAILS);
    expect(
      cells.map((cell: DetailCell): string => {
        return cell.label;
      }),
    ).toEqual(["PVE Version"]);
  });

  test("a cluster that has reported nothing yet says so in one line, over its ID line", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, CLUSTER_PATH, "estate=new");
    const detail: Locator = page.locator(`[id="${CLUSTER_DETAILS}"]`);
    await expect(detail.getByTestId("detail-empty-message")).toHaveText(
      "No details reported yet.",
    );
    await expect(detail.getByTestId("detail-field")).toHaveCount(0);
    await expect(detail.getByTestId("detail-id-value")).toHaveText(CLUSTER_ID);
  });

  test("in German, its title and its labels read in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");

    const cells: Array<DetailCell> = await detailCells(page, CLUSTER_DETAILS);
    expect(
      cells.map((cell: DetailCell): string => {
        return cell.label;
      }),
    ).toEqual([GERMAN["PVE Version"], GERMAN["Agent Version"]]);
    expect(GERMAN["Agent Version"]).not.toBe("Agent Version");
    expect(GERMAN["Cluster Details"]).not.toBe("Cluster Details");
    await expect(
      page
        .getByText(GERMAN["Cluster Details"] as string, { exact: true })
        .first(),
    ).toBeVisible();
  });
});

/*
 * #5524's follow-up: a node's, a guest's and a storage's page swallowed a
 * failed read of the inventory and said the part had "not reported yet",
 * which sent an administrator to an agent that was working.
 */
test.describe("a part whose inventory cannot be read says so", () => {
  const SERVER_ERROR: string =
    "Something went wrong on the server. Please try again.";

  test("a node's page: the Overview and its lists say the read failed, with a way to read again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, nodePath("pve2"), "fail=inventory");

    const error: Locator = page.getByTestId("proxmox-part-read-error");
    await expect(error).toContainText("Couldn't load this node");
    await expect(error).toContainText(SERVER_ERROR);
    await expect(error.getByTestId("refresh-button")).toBeVisible();
    await expect(page.getByTestId("proxmox-node-not-reported")).toHaveCount(0);
    await expect(
      page.getByText("not reported yet", { exact: false }),
    ).toHaveCount(0);
    await screenshot(page, "node-inventory-failed-overview");

    await openTab(page, "Guests");
    await expect(
      page.getByTestId("proxmox-node-guests-guests-table-load-error"),
    ).toContainText(SERVER_ERROR);
    await expect(page.getByText("No guests on this node.")).toHaveCount(0);
    await screenshot(page, "node-inventory-failed-guests");
  });

  test("a guest's and a storage's page say so too", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [pathname, title] of [
      [guestPath("qemu/102"), "Couldn't load this guest"],
      [storagePath("pve2", "local-zfs"), "Couldn't load this storage"],
    ] as Array<[string, string]>) {
      await openPage(page, pathname, "fail=inventory");

      const error: Locator = page.getByTestId("proxmox-part-read-error");
      await expect(error).toContainText(title);
      await expect(error).toContainText(SERVER_ERROR);
      await expect(
        page.getByText("not reported yet", { exact: false }),
      ).toHaveCount(0);
    }
  });

  /*
   * The UI review of #5553: the empty state has no gutter of its own on a
   * phone, where Try again takes the line's whole width, and the button ran
   * into the card's borders. The card keeps a card's own 20px there.
   */
  test("on a phone, Try again sits inside its card, a card's gutter on each side", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openPage(page, nodePath("pve2"), "fail=inventory");

    const error: Locator = page.getByTestId("proxmox-part-read-error");
    await expect(error.getByTestId("refresh-button")).toBeVisible();

    // The card's and the button's boxes, read in one frame once settled.
    await expect
      .poll(async (): Promise<{ start: number; end: number }> => {
        return await error.evaluate(
          (card: Element): { start: number; end: number } => {
            const box: DOMRect = card.getBoundingClientRect();
            const button: DOMRect = card
              .querySelector('[data-testid="refresh-button"]')!
              .getBoundingClientRect();
            return {
              start: Math.round(button.left - box.left),
              end: Math.round(box.right - button.right),
            };
          },
        );
      })
      // 20px of padding inside the card's 1px border, on both sides.
      .toEqual({ start: 21, end: 21 });
    await expectNoSidewaysScroll(page);
    await screenshot(page, "node-inventory-failed-phone");
  });

  /*
   * The server's answer is in English. On a Persian page, laid out right to
   * left, it put its full stop first (".Something went wrong on the
   * server. Please try again") - on the Overview and in the node's lists
   * alike, since both say it with the table's empty state.
   */
  test("in Persian, the server's answer reads as written, its full stop at its end", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, nodePath("pve2"), "fail=inventory&lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");

    const overview: Locator = page.getByTestId("proxmox-part-read-error");
    await expect(overview).toBeVisible();
    await expectAnswerReadsAsWritten(overview.locator('bdi[dir="ltr"]'));

    await openTab(page, "Guests");
    await expectAnswerReadsAsWritten(
      page
        .getByTestId("proxmox-node-guests-guests-table-load-error")
        .locator('bdi[dir="ltr"]'),
    );
    await screenshot(page, "node-inventory-failed-guests-persian");
  });
});

// The server's English answer, drawn left to right: its stop after its first letter.
async function expectAnswerReadsAsWritten(answer: Locator): Promise<void> {
  await expect(answer).toHaveText(
    "Something went wrong on the server. Please try again.",
  );

  const ends: { first: number; last: number } = await answer.evaluate(
    (element: Element): { first: number; last: number } => {
      const text: Text = element.firstChild as Text;
      const range: Range = document.createRange();
      range.setStart(text, 0);
      range.setEnd(text, 1);
      const first: number = range.getBoundingClientRect().left;
      range.setStart(text, text.length - 1);
      range.setEnd(text, text.length);
      return { first: first, last: range.getBoundingClientRect().left };
    },
  );
  expect(ends.last).toBeGreaterThan(ends.first);
}

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
    const [titleBox, iconBox] = await boxesInOneFrame([title, icon]);
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

  /*
   * The menu works out which list a page is a row of each time it is drawn,
   * so the light follows the reader around the app, not only on a fresh
   * load: a node opened from the Overview's attention list lights Nodes,
   * Nodes leads on to the list (the page itself then), and Back takes the
   * light back the way it came. None of it reloads the page.
   */
  test("the light follows the reader without a reload: the Overview, a node from its attention list, the Nodes list, and Back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);
    const current: Locator = desktopMenu(page).locator("a[aria-current]");

    const expectCurrent: (data: {
      title: string;
      ariaCurrent: string;
    }) => Promise<void> = async (data: {
      title: string;
      ariaCurrent: string;
    }): Promise<void> => {
      await expect(current).toHaveCount(1);
      await expect(current.getByTestId("side-menu-item-title")).toHaveText(
        data.title,
      );
      await expect(current).toHaveAttribute("aria-current", data.ariaCurrent);
    };

    await expectCurrent({ title: "Overview", ariaCurrent: "page" });

    // A reload would clear this: every step below must change the page in place.
    await page.evaluate((): void => {
      (window as unknown as { __samePage?: boolean }).__samePage = true;
    });

    await page
      .locator(
        '[data-testid="proxmox-needs-attention-item"][data-key="Node:node/pve3"] a',
      )
      .click();
    await expect(page.getByTestId("proxmox-node-hero-name")).toHaveText("pve3");
    await expectCurrent({ title: "Nodes", ariaCurrent: "true" });

    await current.click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return url.pathname === `${CLUSTER_PATH}/nodes`;
    });
    await expectCurrent({ title: "Nodes", ariaCurrent: "page" });

    await page.goBack();
    await expect(page.getByTestId("proxmox-node-hero-name")).toHaveText("pve3");
    await expectCurrent({ title: "Nodes", ariaCurrent: "true" });

    await page.goBack();
    await expect(page.getByTestId("proxmox-hero-health")).toBeVisible();
    await expectCurrent({ title: "Overview", ariaCurrent: "page" });

    expect(
      await page.evaluate((): boolean => {
        return Boolean(
          (window as unknown as { __samePage?: boolean }).__samePage,
        );
      }),
    ).toBe(true);
  });

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
    /*
     * The menu the button opens, by the id it names - once the menu it
     * opens is drawn: read at once after the click, it was sometimes still
     * empty on a busy machine.
     */
    await expect(toggle).toHaveAttribute("aria-controls", NON_EMPTY);
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
