import { expect, Locator, Page, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * Every resource's Topology page, in a browser, against the offline fixture
 * (ResourceTopology/Fixture): a vCenter, a Kubernetes cluster, a host, a
 * Docker and a Podman host, a Swarm, Proxmox and Ceph cluster and a storage
 * array, each drawn from its own inventory by the production page, layout
 * and side menu; and the master Topology, which links into each of them and
 * back.
 *
 * The maintainer's ask: "When we click on View Centre, can you create a new
 * page called Topology where you visualise the VMware topology for
 * customers? I believe we also have to do the same thing for Kubernetes,
 * for example, or host, for example, so we can see all the services and all
 * that stuff. [...] The idea is to make it really easy for people to see
 * what the topology is, pinpoint issues, and look into issues. Maybe we can
 * add all of these things into the master topology that we have as well."
 *
 * A customer found the first design hard to read - "it looks like nested
 * boxes, a box inside of a box" - so every map is now a tree of cards: the
 * resource at the top, each part's parts in the column after it, joined by
 * lines that turn red or amber where trouble lies, the way to trouble open
 * from the first view.
 *
 * What jsdom cannot show is checked here: the drawing framed at a readable
 * zoom, no card drawn inside or over another on any product's map, the
 * lines and their colours, a host's callers and calls either side of the
 * tree with every call drawn, a picked pod's line to its node, the keys
 * moving through the tree, a page read from right to left drawn mirrored, a
 * large estate staying quick, the small print going when zoomed far out,
 * the list a phone gets, dark mode, German and Persian - with screenshots of
 * each in output/playwright/resource-topology-ui.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";

const PAGES: Record<string, string> = {
  vmware: `vmware/31000000-0000-4000-8000-000000000001`,
  kubernetes: `kubernetes/32000000-0000-4000-8000-000000000001`,
  host: `host/33000000-0000-4000-8000-000000000001`,
  docker: `docker/34000000-0000-4000-8000-000000000001`,
  podman: `podman/35000000-0000-4000-8000-000000000001`,
  swarm: `docker-swarm/36000000-0000-4000-8000-000000000001`,
  proxmox: `proxmox/37000000-0000-4000-8000-000000000001`,
  ceph: `ceph/38000000-0000-4000-8000-000000000001`,
  storage: `storage-arrays/39000000-0000-4000-8000-000000000001`,
  cloud: `cloud/accounts/3a000000-0000-4000-8000-000000000001`,
};

// The id each product's builder gives the resource itself.
const ROOT_IDS: Record<string, string> = {
  vmware: "vcenter",
  kubernetes: "cluster",
  host: "host",
  docker: "host",
  podman: "host",
  swarm: "cluster",
  proxmox: "cluster",
  ceph: "cluster",
  storage: "array",
  cloud: "account",
};

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/resource-topology-ui",
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

// "translate(12px, 34px) scale(0.8)": the scale React Flow draws at.
const VIEWPORT_SCALE: RegExp = /scale\(([0-9.]+)\)/;

// "See 23 more related parts": what a focus says of the parts not drawn.
const SEE_MORE_RELATED: RegExp = /^See \d+ more related parts$/;

// Runs of white space, read as one space.
const WHITE_SPACE_RUNS: RegExp = /\s+/g;

interface FixtureLog {
  unhandled: Array<unknown>;
  updateRequests: Array<{ modelName: string }>;
  apiRequests: Array<{ method: string; url: string }>;
}

const pageErrors: Map<Page, Array<string>> = new Map();

test.beforeEach(({ page }: { page: Page }) => {
  const errors: Array<string> = [];
  pageErrors.set(page, errors);
  page.on("pageerror", (error: Error) => {
    errors.push(String(error));
  });
});

test.afterEach(async ({ page }: { page: Page }) => {
  // A page that threw while drawing is a bug even when the test passed.
  expect(pageErrors.get(page) || []).toEqual([]);
  // Nothing the pages asked for went unanswered, and nothing was written.
  const log: FixtureLog = await fixtureLog(page);
  expect(log.unhandled).toEqual([]);
});

async function fixtureLog(page: Page): Promise<FixtureLog> {
  return await page.evaluate((): FixtureLog => {
    return (window as unknown as { __resourceTopologyFixture: FixtureLog })
      .__resourceTopologyFixture;
  });
}

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

function topologyUrl(product: string, query: string = ""): string {
  return `/dashboard/${PROJECT_ID}/${PAGES[product]}/topology${query ? `?${query}` : ""}`;
}

function byTestId(page: Page, id: string): Locator {
  return page.locator(`[data-testid="${id}"]`);
}

function startingWith(page: Page, prefix: string): Locator {
  return page.locator(`[data-testid^="${prefix}"]`);
}

// A product's Topology page, with its map or list drawn.
async function openTopology(
  page: Page,
  product: string,
  query: string = "",
): Promise<void> {
  await page.goto(topologyUrl(product, query));
  await expect(byTestId(page, "resource-topology")).toBeVisible();
  await expect(
    page
      .locator(
        '[data-testid="resource-topology-canvas"], [data-testid="resource-topology-outline"]',
      )
      .first(),
  ).toBeVisible();
}

// The zoom the map is drawn at once it settles.
async function mapScale(page: Page): Promise<number> {
  const viewport: Locator = page.locator(".react-flow__viewport");
  await expect(viewport).toHaveAttribute("style", VIEWPORT_SCALE);
  await page.waitForTimeout(400);
  const style: string = (await viewport.getAttribute("style")) || "";

  return Number(style.match(VIEWPORT_SCALE)?.[1] || "0");
}

async function boxOf(locator: Locator): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
}> {
  const box: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  expect(box).not.toBeNull();

  return box!;
}

// Whether a part is drawn wholly inside the map's canvas.
async function isInsideCanvas(page: Page, locator: Locator): Promise<boolean> {
  const canvas: { x: number; y: number; width: number; height: number } =
    await boxOf(byTestId(page, "resource-topology-canvas"));
  const part: { x: number; y: number; width: number; height: number } | null =
    await locator.boundingBox();

  return Boolean(
    part &&
      part.x >= canvas.x - 1 &&
      part.y >= canvas.y - 1 &&
      part.x + part.width <= canvas.x + canvas.width + 1 &&
      part.y + part.height <= canvas.y + canvas.height + 1,
  );
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Every part on the map, card or chip, where the browser drew it.
async function drawnParts(page: Page): Promise<Array<Box>> {
  return await page.evaluate((): Array<Box> => {
    return Array.from(
      document.querySelectorAll(
        '[data-testid^="resource-topology-card-"], [data-testid^="resource-topology-chip-"]',
      ),
    ).map((element: Element): Box => {
      const box: DOMRect = element.getBoundingClientRect();

      return {
        id: element.getAttribute("data-testid") || "",
        x: box.x,
        y: box.y,
        width: box.width,
        height: box.height,
      };
    });
  });
}

// Pairs of parts drawn inside, or over, one another.
function stacked(boxes: Array<Box>): Array<string> {
  const found: Array<string> = [];

  boxes.forEach((a: Box, index: number) => {
    for (const b of boxes.slice(index + 1)) {
      // A pixel of give: borders and shadows meet, they do not overlap.
      const overlap: boolean =
        a.x + 1 < b.x + b.width &&
        b.x + 1 < a.x + a.width &&
        a.y + 1 < b.y + b.height &&
        b.y + 1 < a.y + a.height;

      if (overlap) {
        found.push(`${a.id} / ${b.id}`);
      }
    }
  });

  return found;
}

// The tone of the line into a group's heading (or a section's card).
async function lineTone(page: Page, target: string): Promise<string | null> {
  return await byTestId(
    page,
    `resource-topology-branch-${target}`,
  ).getAttribute("data-tone");
}

// The id of the part the keyboard is on, as the map names it.
async function focusedPart(page: Page): Promise<string | null> {
  return await page.evaluate((): string | null => {
    return document.activeElement?.getAttribute("data-topology-item") || null;
  });
}

// A part drawn as a card or as a chip, by its name.
function partNamed(page: Page, name: string): Locator {
  return page
    .locator(
      '[data-testid^="resource-topology-card-"], [data-testid^="resource-topology-chip-"]',
    )
    .filter({ hasText: name });
}

// The panel of the part someone picked, its name in its title.
function panel(page: Page): Locator {
  return byTestId(page, "side-over");
}

test.describe("a vCenter's Topology page", () => {
  test("draws the vCenter, its datacenters and what needs attention, at a readable zoom", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");

    await expect(
      page.getByText("Topology", { exact: true }).first(),
    ).toBeVisible();
    await expect(
      byTestId(page, "resource-topology-count-vmware.datacenter"),
    ).toContainText("2");
    await expect(
      byTestId(page, "resource-topology-card-vcenter"),
    ).toBeVisible();
    // Amsterdam has trouble inside: it opens by itself; Frankfurt does not.
    await expect(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/Amsterdam",
      ),
    ).toHaveAttribute("data-open", "true");
    await expect(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/Frankfurt",
      ),
    ).toHaveAttribute("data-open", "false");
    // The resource at the top; its datacenters under it, a little in.
    const root: { x: number; y: number; height: number } = await boxOf(
      byTestId(page, "resource-topology-card-vcenter"),
    );
    const amsterdam: { x: number; y: number } = await boxOf(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/Amsterdam",
      ),
    );

    expect(amsterdam.y).toBeGreaterThan(root.y + root.height);
    expect(amsterdam.x).toBeGreaterThan(root.x);
    // The open incidents and alerts of the whole vCenter, counted at the top.
    await expect(
      byTestId(page, "resource-topology-issue-summary"),
    ).toContainText("open incident");
    // The first view is framed so a person can read it without zooming in.
    expect(await mapScale(page)).toBeGreaterThanOrEqual(0.6);
    // A closed card says, in the legend's colours, what needs attention inside.
    await expect(
      byTestId(
        page,
        "resource-topology-card-vmware.cluster:cluster/Amsterdam/ams-prod",
      ).getByTestId("resource-topology-attention-counts"),
    ).toBeVisible();
    // The side menu's Topology item is the page shown.
    await expect(
      page.getByRole("link", { name: "Topology" }).first(),
    ).toBeVisible();

    await screenshot(page, "vmware-1280-light");
  });

  test("Needs attention narrows the map to the troubled parts and the path to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    await byTestId(page, "resource-topology-filter-attention").click();

    await expect(page).toHaveURL(/filter=attention/);
    // The swapping VM, deep inside, is drawn; a quiet datastore is not.
    await expect(partNamed(page, "db-primary-01")).toBeVisible();
    await expect(
      startingWith(page, "resource-topology-chip-vmware.datastore:").filter({
        hasText: "fra-ssd",
      }),
    ).toHaveCount(0);

    await screenshot(page, "vmware-needs-attention");
  });

  test("search finds a part anywhere; its panel says what it is and focuses on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    await byTestId(page, "resource-topology-search").fill("api-gateway-07");

    await expect(
      byTestId(page, "resource-topology-search-result"),
    ).toContainText("1 part matches your search.");
    await expect(page).toHaveURL(/search=api-gateway-07/);

    await partNamed(page, "api-gateway-07").click({
      position: { x: 40, y: 20 },
    });
    const picked: Locator = panel(page);
    await expect(byTestId(page, "resource-topology-panel")).toBeVisible();
    await expect(picked).toContainText("api-gateway-07");
    await expect(picked).toContainText("CPU ready");
    // One click further: the virtual machine's own page in the vCenter.
    await expect(
      picked.getByRole("link", { name: "Open Virtual Machine" }),
    ).toHaveAttribute(
      "href",
      /\/vmware\/31000000-0000-4000-8000-000000000001\/virtual-machines\//,
    );

    // A virtual machine holds nothing and calls nothing: nothing to focus on.
    await expect(byTestId(page, "resource-topology-panel-focus")).toHaveCount(
      0,
    );
  });

  test("focusing on a host draws its lineage and what is inside it, nothing else", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    await byTestId(page, "resource-topology-search").fill("esx101.ams");
    /*
     * The host is the one match: its virtual machines, whose lines name it,
     * are drawn inside it but not counted or marked one by one.
     */
    await expect(
      byTestId(page, "resource-topology-search-result"),
    ).toContainText("1 part matches your search.");
    // A matched host is opened, so what is inside it shows: its heading picks it.
    await byTestId(
      page,
      "resource-topology-select-vmware.host:host/Amsterdam/esx101.ams.acme.example",
    ).click();
    await expect(byTestId(page, "resource-topology-panel")).toBeVisible();

    // The panel's buttons keep their distance from its header.
    const header: { y: number; height: number } = await boxOf(
      byTestId(page, "side-over-description"),
    );
    const firstAction: { y: number } = await boxOf(
      byTestId(page, "resource-topology-panel-open"),
    );
    expect(firstAction.y - (header.y + header.height)).toBeGreaterThanOrEqual(
      40,
    );
    // What is inside the host, counted under its kind.
    await expect(
      byTestId(page, "resource-topology-panel-inside").getByRole("term"),
    ).toHaveText(["Virtual Machines"]);

    await byTestId(page, "resource-topology-panel-focus").click();
    await expect(byTestId(page, "resource-topology-focus")).toContainText(
      "Showing esx101.ams.acme.example",
    );
    await expect(page).toHaveURL(/focus=/);
    // Its swapping virtual machine is drawn; Frankfurt is not.
    await expect(partNamed(page, "db-primary-01")).toBeVisible();
    await expect(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/Frankfurt",
      ),
    ).toHaveCount(0);
    await screenshot(page, "vmware-focus-host");

    // The panel's own button turns the focus off again.
    await expect(byTestId(page, "resource-topology-panel-focus")).toHaveText(
      "Show everything",
    );
    await byTestId(page, "resource-topology-panel-focus").click();
    await expect(byTestId(page, "resource-topology-focus")).toHaveCount(0);
  });

  test("opening a cluster draws its hosts after it, joined by a line; closing it folds them away", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    const cluster: string = "vmware.cluster:cluster/Amsterdam/ams-prod";
    const card: Locator = byTestId(page, `resource-topology-card-${cluster}`);

    await expect(card).toHaveAttribute("data-open", "false");
    await expect(
      byTestId(page, `resource-topology-open-${cluster}`),
    ).toHaveAttribute("aria-expanded", "false");
    await byTestId(page, `resource-topology-open-${cluster}`).click();
    await expect(card).toHaveAttribute("data-open", "true");
    await expect(
      byTestId(page, `resource-topology-close-${cluster}`),
    ).toHaveAttribute("aria-expanded", "true");

    const host: Locator = startingWith(
      page,
      "resource-topology-card-vmware.host:host/Amsterdam/",
    ).first();
    await expect(host).toBeVisible();
    // A line runs from the cluster to its hosts' heading.
    await expect(
      byTestId(page, `resource-topology-branch-group:${cluster}|vmware.host`),
    ).toBeAttached();
    /*
     * The hosts stand after the cluster, never inside it, and the map frames
     * the cluster with them. Read in one frame: the map is still moving.
     */
    await expect
      .poll(async (): Promise<boolean> => {
        return await host.evaluate(
          (element: Element, outerId: string): boolean => {
            const outer: Element | null = document.querySelector(
              `[data-testid="${outerId}"]`,
            );
            const canvas: Element | null = document.querySelector(
              '[data-testid="resource-topology-canvas"]',
            );

            if (!outer || !canvas) {
              return false;
            }

            const inner: DOMRect = element.getBoundingClientRect();
            const around: DOMRect = outer.getBoundingClientRect();
            const frame: DOMRect = canvas.getBoundingClientRect();

            return (
              inner.left > around.right &&
              inner.top > around.top + around.height / 2 &&
              around.left >= frame.left - 1 &&
              inner.right <= frame.right + 1 &&
              inner.bottom <= frame.bottom + 1
            );
          },
          `resource-topology-card-${cluster}`,
        );
      })
      .toBe(true);
    expect(stacked(await drawnParts(page))).toEqual([]);
    await screenshot(page, "vmware-cluster-opened");

    await byTestId(page, `resource-topology-close-${cluster}`).click();
    await expect(card).toHaveAttribute("data-open", "false");
    await expect(
      startingWith(page, "resource-topology-card-vmware.host:host/Amsterdam/"),
    ).toHaveCount(0);
  });

  test("a large vCenter folds each kind into '+ N more' and says how much is drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware", "estate=large");
    /*
     * Three datacenters of hundreds of virtual machines: Amsterdam, where
     * the trouble is, opens by itself; the healthy two stay closed cards
     * that say what they hold.
     */
    await expect(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/Amsterdam",
      ),
    ).toHaveAttribute("data-open", "true");
    await expect(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/London",
      ),
    ).toHaveAttribute("data-open", "false");

    // 24 datastores: a dozen drawn, the rest one "+ 12 more".
    const key: string =
      "vmware.datacenter:datacenter/Amsterdam|vmware.datastore";
    const more: Locator = byTestId(page, `resource-topology-more-${key}`);
    await expect(more).toBeVisible();
    await expect(more).toContainText("+ 12 more");
    /*
     * The first view is framed whole: a drawing with a folded group was once
     * never framed, the view running off the canvas.
     */
    await expect
      .poll(async (): Promise<boolean> => {
        return await isInsideCanvas(page, more);
      })
      .toBe(true);
    await screenshot(page, "vmware-large");

    await more.click();
    await expect(more).toHaveCount(0);
    await expect(
      byTestId(page, `resource-topology-group-toggle-${key}`),
    ).toHaveText("Show fewer");
  });
});

test.describe("a Kubernetes cluster's Topology page", () => {
  test("reads by workload or by node, and keeps the choice in the address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "kubernetes");
    await expect(
      byTestId(page, "resource-topology-card-k8s.namespace:payments"),
    ).toBeVisible();
    /*
     * Search, Needs attention, Group by and Map | List share one line at
     * 1280: Map | List no longer drops alone under the others.
     */
    const filter: { y: number; height: number } = await boxOf(
      byTestId(page, "resource-topology-filter"),
    );
    const display: { y: number; height: number } = await boxOf(
      byTestId(page, "resource-topology-display-map"),
    );
    const search: { y: number; height: number } = await boxOf(
      byTestId(page, "resource-topology-search"),
    );

    expect(Math.abs(display.y - filter.y)).toBeLessThan(filter.height);
    expect(
      Math.abs(search.y + search.height / 2 - (filter.y + filter.height / 2)),
    ).toBeLessThan(filter.height);
    // The nodes sit beside the namespaces, small: here they hold nothing.
    await expect(
      startingWith(page, "resource-topology-chip-k8s.node:").first(),
    ).toBeVisible();
    await screenshot(page, "kubernetes-1280-light");

    await byTestId(page, "resource-topology-arrangement-nodes").click();
    await expect(page).toHaveURL(/by=nodes/);
    await expect(
      byTestId(page, "resource-topology-card-k8s.namespace:payments"),
    ).toHaveCount(0);
    // By node, each node holds the pods it runs.
    await expect(
      startingWith(page, "resource-topology-card-k8s.node:").first(),
    ).toBeVisible();
    await screenshot(page, "kubernetes-by-node");
  });

  test("a picked pod draws a line to the node it runs on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "kubernetes");
    await byTestId(
      page,
      "resource-topology-open-k8s.namespace:payments",
    ).click();
    await expect(
      byTestId(page, "resource-topology-card-k8s.namespace:payments"),
    ).toHaveAttribute("data-open", "true");
    // A healthy workload is one closed card: open it for its pods.
    await startingWith(
      page,
      "resource-topology-open-k8s.deployment:payments/payments-api",
    )
      .first()
      .click();

    const pod: Locator = startingWith(
      page,
      "resource-topology-chip-k8s.pod:payments/",
    ).first();
    await expect(pod).toBeVisible();
    /*
     * The pods of one workload share their start: their names are cut in
     * the middle, so each still reads differently on its chip.
     */
    const shownNames: Array<string> = await startingWith(
      page,
      "resource-topology-chip-k8s.pod:payments/payments-api",
    ).evaluateAll((chips: Array<Element>): Array<string> => {
      return chips.map((chip: Element): string => {
        return chip.querySelector("span[title]")?.textContent || "";
      });
    });

    expect(shownNames.length).toBeGreaterThanOrEqual(2);
    expect(new Set<string>(shownNames).size).toBe(shownNames.length);
    await pod.click();
    await expect(byTestId(page, "resource-topology-panel")).toBeVisible();
    await expect(
      startingWith(page, "rf__edge-relation:k8s.pod:payments/").first(),
    ).toBeAttached();
  });
});

test.describe("a node that runs many pods", () => {
  test("focused, its pods are listed beside it at a readable zoom, and the rest are one click away", async ({
    page,
  }: {
    page: Page;
  }) => {
    // A large cluster: some thirty pods run on each node.
    await openTopology(
      page,
      "kubernetes",
      `estate=large&focus=${encodeURIComponent(
        "k8s.node:ip-10-0-1-21.eu-west-1.compute.internal",
      )}`,
    );

    // One heading says how they are related, over a dozen small cards.
    await expect(
      byTestId(page, "resource-topology-related-caption-Runs here"),
    ).toContainText("12");
    await expect(
      page.locator('[data-testid^="resource-topology-related-k8s.pod:"]'),
    ).toHaveCount(12);
    expect(await mapScale(page)).toBeGreaterThanOrEqual(0.6);
    // The heading says what the lines are: they carry no words of their own.
    await expect(
      page.locator('[data-testid^="rf__edge-relation:"]'),
    ).toHaveCount(12);
    await expect(page.locator(".react-flow__edge-text")).toHaveCount(0);
    await screenshot(page, "kubernetes-node-focus");

    // The pods not drawn are counted, and listed in the node's panel.
    const more: Locator = byTestId(page, "resource-topology-related-hidden");

    await expect(more).toHaveText(SEE_MORE_RELATED);
    await more.click();
    await expect(panel(page)).toContainText(
      "ip-10-0-1-21.eu-west-1.compute.internal",
    );
    expect(
      await byTestId(page, "resource-topology-panel-related")
        .getByRole("button")
        .count(),
    ).toBeGreaterThan(12);
  });
});

test.describe("a host's Topology page", () => {
  test("reads left to right: what calls it, the host, what it calls - every call drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "host");
    // The lanes are always open: their headings, and the parts under them.
    const callers: Locator = byTestId(
      page,
      "resource-topology-lane-section:callers",
    );
    const host: Locator = byTestId(page, "resource-topology-card-host");
    const calls: Locator = byTestId(
      page,
      "resource-topology-lane-section:calls",
    );

    await expect(callers).toBeVisible();
    await expect(calls).toBeVisible();
    const left: { x: number; width: number } = await boxOf(callers);
    const middle: { x: number; width: number } = await boxOf(host);
    const right: { x: number; width: number } = await boxOf(calls);

    expect(left.x + left.width).toBeLessThan(middle.x);
    expect(middle.x + middle.width).toBeLessThan(right.x);
    // Every call, without picking anything, with its rate on it.
    expect(
      await page.locator('[data-testid^="rf__edge-relation:"]').count(),
    ).toBeGreaterThanOrEqual(3);
    await expect(page.locator(".react-flow__edge-text").first()).toContainText(
      "/min",
    );
    await expect(byTestId(page, "resource-topology-legend")).toContainText(
      "Calls per minute",
    );

    await screenshot(page, "host-1280-light");
  });
});

test.describe("every resource that holds parts", () => {
  for (const product of [
    "docker",
    "podman",
    "swarm",
    "proxmox",
    "ceph",
    "storage",
    "cloud",
  ]) {
    test(`${product}: the Topology page draws the resource from its own inventory`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openTopology(page, product);
      await expect(
        byTestId(page, `resource-topology-card-${ROOT_IDS[product]}`),
      ).toBeVisible();
      expect(await mapScale(page)).toBeGreaterThanOrEqual(0.6);
      // A tree of cards: no part inside or over another.
      expect(stacked(await drawnParts(page))).toEqual([]);

      await screenshot(page, `${product}-1280-light`);
    });
  }
});

test.describe("a tree of cards, never a box inside a box", () => {
  for (const product of ["vmware", "kubernetes", "host"]) {
    test(`${product}: no part is drawn inside or over another`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openTopology(page, product);
      await mapScale(page);
      const parts: Array<Box> = await drawnParts(page);

      expect(parts.length).toBeGreaterThan(3);
      expect(stacked(parts)).toEqual([]);
      // No frame around parts is drawn at all.
      await expect(startingWith(page, "resource-topology-box-")).toHaveCount(0);
    });
  }

  test("a calm vCenter with room to spare shows its shape: healthy parts open too", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware", "estate=quiet");

    for (const datacenter of ["Amsterdam", "Frankfurt"]) {
      await expect(
        byTestId(
          page,
          `resource-topology-card-vmware.datacenter:datacenter/${datacenter}`,
        ),
      ).toHaveAttribute("data-open", "true");
    }

    // Every line is calm: nothing needs attention.
    expect(await lineTone(page, "group:vcenter|vmware.datacenter")).toBe(
      "calm",
    );
    expect(await mapScale(page)).toBeGreaterThanOrEqual(0.6);
    expect(stacked(await drawnParts(page))).toEqual([]);
    await screenshot(page, "vmware-quiet");
  });

  test("the line to a group is red where the trouble is, grey where all is well", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "kubernetes");
    // A node is not ready: the line to the nodes is red.
    expect(await lineTone(page, "group:cluster|k8s.node")).toBe("critical");
    // The volume is bound and well: its line is calm.
    expect(await lineTone(page, "group:cluster|k8s.pv")).toBe("calm");
    await expect(byTestId(page, "resource-topology-legend")).toContainText(
      "What is inside",
    );
  });

  test("picking a part lights the way from the resource to it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    await startingWith(
      page,
      "resource-topology-chip-vmware.datastore:datastore/Amsterdam/ams-ssd-03",
    )
      .first()
      .click();

    expect(await lineTone(page, "group:vcenter|vmware.datacenter")).toBe(
      "path",
    );
    expect(
      await lineTone(
        page,
        "group:vmware.datacenter:datacenter/Amsterdam|vmware.datastore",
      ),
    ).toBe("path");
    // The other line out of Amsterdam keeps its own colour.
    expect(
      await lineTone(
        page,
        "group:vmware.datacenter:datacenter/Amsterdam|vmware.cluster",
      ),
    ).toBe("critical");
  });

  test("the arrow keys move through the tree, open a part and close it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    await byTestId(page, "resource-topology-select-vcenter").focus();

    await page.keyboard.press("ArrowRight");
    expect(await focusedPart(page)).toBe(
      "vmware.datacenter:datacenter/Amsterdam",
    );
    await page.keyboard.press("ArrowDown");
    expect(await focusedPart(page)).toBe(
      "vmware.datacenter:datacenter/Frankfurt",
    );
    // Right on a closed part opens it, and the keyboard stays on it.
    await page.keyboard.press("ArrowRight");
    const frankfurt: Locator = byTestId(
      page,
      "resource-topology-card-vmware.datacenter:datacenter/Frankfurt",
    );
    await expect(frankfurt).toHaveAttribute("data-open", "true");
    await page.keyboard.press("ArrowRight");
    expect(await focusedPart(page)).toBe(
      "vmware.cluster:cluster/Frankfurt/fra-prod",
    );
    // The part the keyboard is on is on screen.
    expect(await isInsideCanvas(page, page.locator(":focus").first())).toBe(
      true,
    );
    // Left goes back out; left again closes.
    await page.keyboard.press("ArrowLeft");
    expect(await focusedPart(page)).toBe(
      "vmware.datacenter:datacenter/Frankfurt",
    );
    await page.keyboard.press("ArrowLeft");
    await expect(frankfurt).toHaveAttribute("data-open", "false");
    // The map tells a screen reader how its keys work.
    await expect(byTestId(page, "resource-topology-canvas")).toHaveAttribute(
      "aria-label",
      "Topology map",
    );
  });

  test("zoomed far out, cards keep their name and colour and drop the small print", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    const canvas: Locator = byTestId(page, "resource-topology-canvas");
    await expect(canvas).toHaveAttribute("data-detail", "near");

    for (let step: number = 0; step < 5; step++) {
      await page.getByRole("button", { name: "zoom out" }).click();
    }

    await expect(canvas).toHaveAttribute("data-detail", "far");
    const card: Locator = byTestId(page, "resource-topology-card-vcenter");
    await expect(card.locator(".rt-detail").first()).toBeHidden();
    await expect(card).toContainText("vcenter-prod");
    expect(await mapScale(page)).toBeLessThan(0.5);
  });

  test("a large cluster stays quick: forty nodes shown in full, at once", async ({
    page,
  }: {
    page: Page;
  }) => {
    const started: number = Date.now();
    await openTopology(page, "kubernetes", "estate=large");
    await expect(
      startingWith(page, "resource-topology-chip-k8s.node:").first(),
    ).toBeVisible();
    // 1,642 parts read and drawn: the page is up within seconds.
    expect(Date.now() - started).toBeLessThan(15000);

    const key: string = "cluster|k8s.node";
    const shownAt: number = Date.now();
    await byTestId(page, `resource-topology-group-toggle-${key}`).click();
    await expect(
      startingWith(page, "resource-topology-chip-k8s.node:"),
    ).toHaveCount(40);
    expect(Date.now() - shownAt).toBeLessThan(3000);
    // React Flow holds what is drawn, not the estate.
    expect(await page.locator(".react-flow__node").count()).toBeLessThan(200);
    expect(stacked(await drawnParts(page))).toEqual([]);
    await screenshot(page, "kubernetes-large-nodes");
  });
});

test.describe("a page read from right to left", () => {
  test("Persian draws the tree mirrored: the resource at the top right, the left arrow goes in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware", "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const canvas: Locator = byTestId(page, "resource-topology-canvas");
    await expect(canvas).toHaveAttribute("data-direction", "rtl");
    await mapScale(page);

    const root: { x: number; width: number } = await boxOf(
      byTestId(page, "resource-topology-card-vcenter"),
    );
    const amsterdam: { x: number; width: number } = await boxOf(
      byTestId(
        page,
        "resource-topology-card-vmware.datacenter:datacenter/Amsterdam",
      ),
    );
    const cluster: { x: number; width: number } = await boxOf(
      byTestId(
        page,
        "resource-topology-card-vmware.cluster:cluster/Amsterdam/ams-prod",
      ),
    );

    // Each level stands to the left of the one that holds it.
    expect(amsterdam.x + amsterdam.width).toBeLessThan(root.x + root.width);
    expect(cluster.x + cluster.width).toBeLessThan(amsterdam.x);
    expect(stacked(await drawnParts(page))).toEqual([]);

    await byTestId(page, "resource-topology-select-vcenter").focus();
    await page.keyboard.press("ArrowLeft");
    expect(await focusedPart(page)).toBe(
      "vmware.datacenter:datacenter/Amsterdam",
    );
    await screenshot(page, "vmware-1280-fa");
  });

  test("a host's lanes swap sides: what calls it on the right, what it calls on the left", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "host", "lang=fa");
    await mapScale(page);
    const callers: { x: number } = await boxOf(
      byTestId(page, "resource-topology-lane-section:callers"),
    );
    const host: { x: number; width: number } = await boxOf(
      byTestId(page, "resource-topology-card-host"),
    );
    const calls: { x: number; width: number } = await boxOf(
      byTestId(page, "resource-topology-lane-section:calls"),
    );

    expect(callers.x).toBeGreaterThan(host.x + host.width);
    expect(calls.x + calls.width).toBeLessThan(host.x);
    await screenshot(page, "host-1280-fa");
  });
});

test.describe("the master Topology", () => {
  test("a vCenter's map opens the master Topology on it, which links back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    await byTestId(page, "resource-topology-master-link").click();

    await expect(page).toHaveURL(/\/topology\/overview\?.*infraFocus=/);
    const back: Locator = byTestId(
      page,
      "infrastructure-resource-topology-link",
    );
    await expect(back).toHaveText("Open vCenter topology");
    await screenshot(page, "master-topology-vcenter");

    await back.click();
    await expect(page).toHaveURL(new RegExp(`${PAGES["vmware"]}/topology`));
    await expect(
      byTestId(page, "resource-topology-card-vcenter"),
    ).toBeVisible();
  });

  test("a Kubernetes cluster and a host link back from the master map too", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const [product, text] of [
      ["kubernetes", "Open cluster topology"],
      ["host", "Open host topology"],
    ] as Array<[string, string]>) {
      await openTopology(page, product);
      await byTestId(page, "resource-topology-master-link").click();
      await expect(
        byTestId(page, "infrastructure-resource-topology-link"),
      ).toHaveText(text);
    }
  });
});

test.describe("on a phone, in dark mode and in German", () => {
  test("a phone gets the list, and it reads the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await openTopology(page, "vmware");
    await expect(byTestId(page, "resource-topology-outline")).toBeVisible();
    await expect(byTestId(page, "resource-topology-row-vcenter")).toBeVisible();
    // No sideways scrolling.
    const overflow: number = await page.evaluate((): number => {
      return document.documentElement.scrollWidth - window.innerWidth;
    });
    expect(overflow).toBeLessThanOrEqual(0);

    await screenshot(page, "vmware-390-light");
    await openTopology(page, "vmware", "theme=dark");
    await screenshot(page, "vmware-390-dark");
    await openTopology(page, "host", "theme=dark");
    await screenshot(page, "host-390-dark");
  });

  test("dark mode draws every map on dark surfaces", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const product of ["vmware", "kubernetes", "host"]) {
      await openTopology(page, product, "theme=dark");
      const background: string = await page.evaluate((): string => {
        return getComputedStyle(document.body).backgroundColor;
      });
      expect(background).not.toBe("rgb(255, 255, 255)");
      await screenshot(page, `${product}-1280-dark`);
    }
  });

  test("German reads the page in German", async ({ page }: { page: Page }) => {
    await openTopology(page, "vmware", "lang=de");
    await expect(byTestId(page, "resource-topology-search")).toHaveAttribute(
      "placeholder",
      GERMAN["Find a host, virtual machine or datastore…"] as string,
    );
    await expect(
      byTestId(page, "resource-topology-filter-attention"),
    ).toContainText(GERMAN["Needs attention"] as string);
    const legend: string = (
      (await byTestId(page, "resource-topology-legend").textContent()) || ""
    ).replace(WHITE_SPACE_RUNS, " ");
    expect(legend).toContain(
      GERMAN["Related, for the part you pick"] as string,
    );

    await screenshot(page, "vmware-1280-de");
  });
});

test.describe("when there is nothing, or the read fails", () => {
  test("an empty inventory says what to do", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(topologyUrl("vmware", "estate=empty"));
    await expect(page.getByText("Nothing to draw yet")).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open the Overview" }),
    ).toBeVisible();
  });

  test("a failed read can be tried again", async ({ page }: { page: Page }) => {
    await page.goto(topologyUrl("kubernetes", "fail=topology"));
    await expect(page.getByRole("alert")).toContainText(
      "The inventory could not be read",
    );
    // The way forward sits centred under the message, as on every list.
    const alert: { x: number; width: number } = await boxOf(
      byTestId(page, "resource-topology-error"),
    );
    const retry: { x: number; width: number } = await boxOf(
      byTestId(page, "resource-topology-retry"),
    );

    expect(
      Math.abs(retry.x + retry.width / 2 - (alert.x + alert.width / 2)),
    ).toBeLessThan(2);
    await page.getByRole("button", { name: "Try again" }).click();
    await expect(byTestId(page, "resource-topology")).toBeVisible();
  });

  test("open incidents and alerts it may not read leave the map drawn", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware", "issues=denied");
    await expect(
      byTestId(page, "resource-topology-card-vcenter"),
    ).toBeVisible();
    await expect(byTestId(page, "resource-topology-issue-summary")).toHaveCount(
      0,
    );
    // The map says so, instead of looking as if nothing were open.
    await expect(
      byTestId(page, "resource-topology-issues-unreadable"),
    ).toContainText(
      "Some open incidents or alerts could not be read, so the map may not show them all.",
    );
    // A reader who may read them gets no such notice.
    await openTopology(page, "vmware");
    await expect(
      byTestId(page, "resource-topology-issues-unreadable"),
    ).toHaveCount(0);
  });

  test("the keyboard reaches a part and opens its panel", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openTopology(page, "vmware");
    const select: Locator = byTestId(
      page,
      "resource-topology-select-vmware.datacenter:datacenter/Frankfurt",
    );
    await select.focus();
    await page.keyboard.press("Enter");
    await expect(panel(page)).toContainText("Frankfurt");
  });
});
