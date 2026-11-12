import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";
import { expectCardsFit } from "../SuiteHelpers/CardBodyFit";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A Kubernetes cluster's pages, in a browser, against the offline fixture
 * (KubernetesPages/Fixture).
 *
 * The maintainer: "How can we make the Proxmox product a lot better and
 * world-class? ... Can you please do those things for other resources as
 * well, like Kubernetes ... feature-rich, simple to use, and natural to
 * use."
 *
 * So, read the way someone on call reads a cluster: the Overview says what
 * needs attention first - a node gone, a crash loop, a pod that cannot be
 * scheduled - the most urgent first, each one step from its own page, in
 * its own namespace. A Deployment's, a pod's or a node's page then says
 * what it is and how it is doing in Kubernetes' own words, where it sits
 * (its namespace, its node, its workload, each a step away), what on it
 * and its pods needs a look, what is open on it, and which of the
 * cluster's alerts watch it, with "Turn on N alerts" opening
 * Recommendations with exactly those selected. Two Deployments of the same
 * name in two namespaces are never mixed up. A calm cluster says nothing;
 * a disconnected one does not pass its last snapshot off as the truth; a
 * read that fails says so. At a laptop's and a phone's width, in dark
 * mode, in German and in Persian. The fixture records every read, so the
 * tests check that nothing it does not model was asked for.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`;

const NODE_LOST: string = "ip-10-0-1-13.eu-west-1.compute.internal";
const NODE_DISK: string = "ip-10-0-1-12.eu-west-1.compute.internal";
const NODE_CORDONED: string = "ip-10-0-1-14.eu-west-1.compute.internal";
const NODE_A: string = "ip-10-0-1-11.eu-west-1.compute.internal";
const CRASHING_POD: string = "checkout-7d9f8b6c5-g5h6i";
const LOST_NODE_POD: string = "fluent-bit-q2w8d";
const FAILED_RUN: string = "nightly-report-29013480";

// A part's page, as KubernetesPartRoutes writes it: in its namespace.
function partPath(
  collection: string,
  name: string,
  namespace?: string,
): string {
  return `${CLUSTER_PATH}/${collection}/${encodeURIComponent(name)}${
    namespace ? `?namespace=${encodeURIComponent(namespace)}` : ""
  }`;
}

// The busy cluster's attention list, most urgent first (Fixture/Fixture.js).
const BUSY_ATTENTION: Array<{ key: string; severity: string }> = [
  { key: `Node:${NODE_LOST}`, severity: "critical" },
  { key: "Deployment:shop/checkout", severity: "critical" },
  { key: `Node:${NODE_DISK}`, severity: "warning" },
  { key: "StatefulSet:data/postgres", severity: "warning" },
  { key: "DaemonSet:kube-system/fluent-bit", severity: "warning" },
  { key: "CronJob:shop/nightly-report", severity: "warning" },
  { key: "PersistentVolumeClaim:data/data-postgres-2", severity: "warning" },
];

// The Deployment alerts that are off: CrashLoopBackOff Detection is on.
const DEPLOYMENT_ALERTS_OFF: Array<string> = [
  "Kubernetes:k8s-deployment-replica-mismatch",
  "Kubernetes:k8s-pod-memory-limit-saturation",
  "Kubernetes:k8s-pod-cpu-limit-saturation",
  "Kubernetes:k8s-hpa-at-max-replicas",
];

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/kubernetes-pages-ui",
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

// A sentence of the locale with its values filled in.
function fill(
  words: Record<string, string>,
  key: string,
  values: Record<string, string>,
): string {
  let sentence: string = words[key] as string;
  expect(sentence, `the locale has "${key}"`).toBeTruthy();
  for (const name of Object.keys(values)) {
    sentence = sentence.split(`{{${name}}}`).join(values[name] as string);
  }
  return sentence;
}

interface Recorded {
  listRequests: Array<{ modelName: string }>;
  apiRequests: Array<{ method: string; url: string }>;
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
          window as unknown as { __kubernetesPagesFixture?: Recorded }
        ).__kubernetesPagesFixture;
        return fixture ? fixture.unhandled : [];
      },
    );

    // Every read the page made is one the fixture answers as the server does.
    expect(unhandled).toEqual([]);
  }
});

async function screenshot(page: Page, name: string): Promise<void> {
  await fsPromises.mkdir(SCREENSHOTS, { recursive: true });
  // From the top, so the sticky side menu sits where a reader sees it.
  await page.evaluate((): void => {
    window.scrollTo(0, 0);
  });
  await page.screenshot({
    path: path.join(SCREENSHOTS, `${name}-synthetic.png`),
    fullPage: true,
    animations: "disabled",
  });
}

// The address, with the fixture's scenario added to whatever query it has.
function withQuery(address: string, query: string): string {
  if (!query) {
    return address;
  }
  return `${address}${address.includes("?") ? "&" : "?"}${query}`;
}

async function openOverview(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(CLUSTER_PATH, query));
  await expect(
    page.getByRole("heading", {
      level: 1,
      name: "EKS Production (eu-west-1)",
      exact: true,
    }),
  ).toBeVisible();
}

// A part's page, once its hero has its status from the part's own read.
async function openPart(
  page: Page,
  options: {
    kind: string;
    collection: string;
    name: string;
    namespace?: string;
    query?: string;
    waitForStatus?: boolean;
  },
): Promise<Locator> {
  await page.goto(
    withQuery(
      partPath(options.collection, options.name, options.namespace),
      options.query || "",
    ),
  );
  const hero: Locator = page.getByTestId(
    `kubernetes-${options.kind.toLowerCase()}-hero`,
  );
  await expect(hero.getByTestId(`${heroId(options.kind)}-name`)).toHaveText(
    options.name,
  );
  if (options.waitForStatus !== false) {
    await expect(
      hero.getByTestId(`${heroId(options.kind)}-status`),
    ).toBeVisible();
  }
  return hero;
}

function heroId(kind: string): string {
  return `kubernetes-${kind.toLowerCase()}-hero`;
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

// One row of a Needs attention card, by the object it is about.
function attentionRow(card: Locator, key: string): Locator {
  return card.locator(`[data-testid$="-attention-item"][data-key="${key}"]`);
}

// A tab by its English name, whatever language draws it.
async function openTab(page: Page, name: string): Promise<void> {
  const tab: Locator = page.getByTestId(`tab-${name}`);
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
}

// A table row by the name in one of its cells.
function tableRow(scope: Locator | Page, name: string): Locator {
  const page: Page = "goto" in scope ? scope : scope.page();
  return scope.getByRole("row").filter({
    has: page.getByRole("cell", { name: name, exact: true }),
  });
}

// The status cell of a list's row: its words and its tone.
function statusCell(row: Locator): Locator {
  return row.locator("[data-tone]").first();
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

// A Latin digit, which a Persian sentence should not mix with its own.
const LATIN_DIGIT: RegExp = /[0-9]/;

// The Overview's chip that counts the nodes that are not ready.
function notReadyChip(page: Page): Locator {
  return page.locator(
    '[data-testid="kubernetes-cluster-status-chip"][data-chip="Nodes Not Ready"]',
  );
}

// One fact of a part's Details card, by its row's key.
function detailRow(page: Page, kind: string, key: string): Locator {
  return page.getByTestId(`kubernetes-${kind.toLowerCase()}-details-${key}`);
}

test.describe("the cluster's Overview", () => {
  test("says what needs attention first, the most urgent first, each a step to its page in its namespace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    const health: Locator = page.getByTestId("kubernetes-cluster-health");
    await expect(health).toHaveAttribute("data-health", "Unhealthy");
    await expect(health).toHaveText("Unhealthy");
    // One node is one node: never "1 Nodes Not Ready".
    await expect(notReadyChip(page)).toHaveText("1 Node Not Ready");

    const card: Locator = page.getByTestId("kubernetes-needs-attention");
    await expect(card).toBeVisible();
    await expect(
      page.getByTestId("kubernetes-needs-attention-summary").locator("span"),
    ).toHaveText(["2 critical", "5 to look at"]);

    // Six rows first, the rest one click away.
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION.slice(0, 6));
    const toggle: Locator = page.getByTestId(
      "kubernetes-needs-attention-toggle",
    );
    await expect(toggle).toHaveText("Show 1 more");
    await toggle.click();
    expect(await attentionRows(card)).toEqual(BUSY_ATTENTION);
    await expect(toggle).toHaveText("Show fewer");

    /*
     * Each row says why, in Kubernetes' own words. A pod's problem shows on
     * its workload's row: the Deployment one replica short, crash-looping,
     * its last restart an OOMKill, with the kubelet's own message.
     */
    const checkout: Locator = attentionRow(card, "Deployment:shop/checkout");
    await expect(
      checkout.getByTestId("kubernetes-needs-attention-reason"),
    ).toHaveText([
      "2 of 3 available",
      "CrashLoopBackOff",
      "Last restart: OOMKilled",
    ]);
    await expect(
      checkout.getByTestId("kubernetes-needs-attention-message"),
    ).toContainText("back-off 5m0s restarting failed container=checkout");
    await expect(
      attentionRow(card, `Node:${NODE_LOST}`).getByTestId(
        "kubernetes-needs-attention-reason",
      ),
    ).toHaveText("Unreachable");
    await expect(
      attentionRow(card, `Node:${NODE_LOST}`).getByTestId(
        "kubernetes-needs-attention-message",
      ),
    ).toHaveText("Kubelet stopped posting node status.");
    await expect(
      attentionRow(card, "StatefulSet:data/postgres").getByTestId(
        "kubernetes-needs-attention-reason",
      ),
    ).toHaveText(["2 of 3 ready", "Can't be scheduled"]);
    await expect(
      attentionRow(card, "CronJob:shop/nightly-report").getByTestId(
        "kubernetes-needs-attention-reason",
      ),
    ).toHaveText(["Last run failed", "BackoffLimitExceeded"]);

    // Healthy, cordoned and mid-rollout parts are not on it.
    await expect(card).not.toContainText(NODE_CORDONED);
    await expect(attentionRow(card, "Deployment:shop/web")).toHaveCount(0);
    await expect(
      attentionRow(card, "Deployment:payments/checkout"),
    ).toHaveCount(0);

    await screenshot(page, "overview-attention");

    // Each row is one link, the whole row, to its part's page.
    await expect(checkout.getByRole("link")).toHaveCount(1);
    await expect(checkout.getByRole("link")).toHaveAttribute(
      "href",
      partPath("deployments", "checkout", "shop"),
    );
    await expect(
      attentionRow(card, `Node:${NODE_LOST}`).getByRole("link"),
    ).toHaveAttribute("href", partPath("nodes", NODE_LOST));

    // One step to shop's checkout, never payments' checkout of the same name.
    await checkout
      .getByTestId("kubernetes-needs-attention-reason")
      .getByText("CrashLoopBackOff")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLUSTER_PATH}/deployments/checkout` &&
        url.searchParams.get("namespace") === "shop"
      );
    });
    const hero: Locator = page.getByTestId("kubernetes-deployment-hero");
    expect(
      await statusLabel(hero.getByTestId("kubernetes-deployment-hero-status")),
    ).toBe("2 of 3 available");
  });

  test("a calm cluster has nothing to say: no Needs attention card, and Healthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "estate=calm");

    await expect(page.getByTestId("kubernetes-cluster-health")).toHaveAttribute(
      "data-health",
      "Healthy",
    );
    await expect(
      page.getByTestId("kubernetes-cluster-health-card"),
    ).toContainText("Healthy");
    // Wait for the read, so "no card" is the answer and not a page loading.
    await expect
      .poll(async (): Promise<number> => {
        return await apiCalls(page, "/kubernetes-resource/needs-attention/");
      })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("kubernetes-needs-attention")).toHaveCount(0);
    await expect(
      page.getByTestId("kubernetes-needs-attention-error"),
    ).toHaveCount(0);
  });

  test("while the agent is disconnected its last snapshot is not the truth: Health Unknown, and how to reconnect", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "collector=disconnected");

    const health: Locator = page.getByTestId("kubernetes-cluster-health");
    await expect(health).toHaveAttribute("data-health", "Unknown");
    await expect(health).toHaveText("Health Unknown");
    await expect(
      page.getByRole("region", { name: "This cluster stopped sending data" }),
    ).toBeVisible();
    // A crash loop seen an hour ago may be long gone: no list of it.
    await expect(page.getByTestId("kubernetes-needs-attention")).toHaveCount(0);
    await expect(
      page.getByRole("link", { name: "Open the setup guide" }),
    ).toHaveAttribute("href", `${CLUSTER_PATH}/documentation`);
  });

  test("when what needs attention cannot be read, the Overview says so instead of an all-clear", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "fail=attention");

    const frame: Locator = page.getByTestId("kubernetes-needs-attention-error");
    await expect(frame).toContainText(
      "Something went wrong on the server. Please try again.",
    );
    // In the card it would have been, named, so the reader knows what failed.
    await expect(
      frame.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    await expect(page.getByTestId("kubernetes-needs-attention")).toHaveCount(0);

    // Refresh asks again.
    const reads: number = await apiCalls(
      page,
      "/kubernetes-resource/needs-attention/",
    );
    await frame.getByRole("button", { name: "Refresh?" }).click();
    await expect
      .poll(async (): Promise<number> => {
        return await apiCalls(page, "/kubernetes-resource/needs-attention/");
      })
      .toBe(reads + 1);
    await screenshot(page, "overview-attention-failed");
  });
});

// How many times the page called one of the fixture's API routes.
async function apiCalls(page: Page, route: string): Promise<number> {
  return await page.evaluate((route: string): number => {
    const fixture: Recorded | undefined = (
      window as unknown as { __kubernetesPagesFixture?: Recorded }
    ).__kubernetesPagesFixture;
    return fixture
      ? fixture.apiRequests.filter((request: { url: string }): boolean => {
          return request.url.includes(route);
        }).length
      : 0;
  }, route);
}

test.describe("a Deployment's page", () => {
  test("shop's checkout: one replica short, its crash-looping pod first, the alert open on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
    });

    const status: Locator = hero.getByTestId(
      "kubernetes-deployment-hero-status",
    );
    expect(await statusLabel(status)).toBe("2 of 3 available");
    // Amber, as its row in Needs attention: to look at, and urgent there.
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(
      hero.getByTestId("kubernetes-deployment-hero-location"),
    ).toHaveText("In namespace shop of cluster EKS Production (eu-west-1)");
    await expect(
      hero
        .getByTestId("kubernetes-deployment-hero-location")
        .getByRole("link", { name: "shop" }),
    ).toHaveAttribute("href", `${CLUSTER_PATH}/namespaces/shop`);
    await expect(
      hero
        .getByTestId("kubernetes-deployment-hero-chips")
        .locator("[data-key]"),
    ).toHaveText(["3 replicas", "3 pods"]);
    await expect(
      hero.getByTestId("kubernetes-deployment-hero-last-report"),
    ).toHaveText("Last reported 1 minute ago");

    /*
     * What needs a look, the most urgent first: its crash-looping pod, then
     * the Deployment itself, one replica short.
     */
    const card: Locator = page.getByTestId("kubernetes-deployment-attention");
    expect(await attentionRows(card)).toEqual([
      { key: `Pod:shop/${CRASHING_POD}`, severity: "critical" },
      { key: "Deployment:shop/checkout", severity: "warning" },
    ]);
    await expect(
      page
        .getByTestId("kubernetes-deployment-attention-summary")
        .locator("span"),
    ).toHaveText(["1 critical", "1 to look at"]);
    const own: Locator = attentionRow(card, "Deployment:shop/checkout");
    await expect(
      own.getByTestId("kubernetes-deployment-attention-name"),
    ).toHaveText("This Deployment");
    // Its own row needs no link to the page it is on.
    await expect(own.getByRole("link")).toHaveCount(0);
    const crashing: Locator = attentionRow(card, `Pod:shop/${CRASHING_POD}`);
    await expect(
      crashing.getByTestId("kubernetes-deployment-attention-reason"),
    ).toHaveText(["CrashLoopBackOff", "Last restart: OOMKilled"]);
    await expect(crashing.getByRole("link")).toHaveAttribute(
      "href",
      partPath("pods", CRASHING_POD, "shop"),
    );
    // Its pods are in its namespace, which the hero names: no "shop" under each.
    await expect(
      crashing.getByTestId("kubernetes-deployment-attention-detail"),
    ).toHaveCount(0);

    /*
     * What Kubernetes reports about it is one Details card, saying nothing
     * the hero says otherwise: no cluster, and no Rollout Status reading
     * "In Progress" for a finished rollout one replica short.
     */
    const details: Locator = page.getByTestId("kubernetes-deployment-details");
    await expect(details).toBeVisible();
    await expect(detailRow(page, "Deployment", "desired-replicas")).toHaveText(
      /Desired Replicas\s*3/,
    );
    await expect(detailRow(page, "Deployment", "unavailable")).toHaveText(
      /Unavailable\s*1/,
    );
    await expect(details).not.toContainText("Rollout Status");
    await expect(details).not.toContainText("In Progress");
    await expect(detailRow(page, "Deployment", "cluster")).toHaveCount(0);
    await expect(
      detailRow(page, "Deployment", "namespace").getByRole("link", {
        name: "shop",
      }),
    ).toHaveAttribute("href", `${CLUSTER_PATH}/namespaces/shop`);

    // The alert open on its pod is open on it.
    const open: Locator = page.getByTestId("kubernetes-deployment-open-item");
    await expect(open).toHaveCount(1);
    await expect(open).toContainText(
      "[K8s] CrashLoopBackOff Detected - EKS Production (eu-west-1)",
    );
    await expect(open).toContainText("ALT-1207");

    await screenshot(page, "deployment-checkout");

    await crashing.getByRole("link").click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLUSTER_PATH}/pods/${CRASHING_POD}` &&
        url.searchParams.get("namespace") === "shop"
      );
    });
    await expect(page.getByTestId("kubernetes-pod-hero-name")).toHaveText(
      CRASHING_POD,
    );
  });

  test("Turn on 4 alerts opens Recommendations with exactly the Deployment alerts that are off", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
    });

    const items: Locator = page.getByTestId(
      "kubernetes-deployment-alerts-item",
    );
    await expect(items).toHaveCount(5);
    await expect(items).toContainText([
      "Deployment Replica Mismatch",
      "CrashLoopBackOff Detection",
      "Pod Memory Saturating Container Limit",
      "Pod CPU Saturating Container Limit",
      "HPA Saturated at Max Replicas",
    ]);
    // The one already on links to its monitor.
    await expect(
      items
        .filter({ hasText: "CrashLoopBackOff Detection" })
        .getByRole("link", {
          name: "On",
        }),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/58000000-0000-4000-8000-000000000001`,
    );

    const turnOn: Locator = page.getByTestId(
      "kubernetes-deployment-alerts-turn-on",
    );
    await expect(turnOn).toHaveText("Turn on 4 alerts");
    await turnOn.click();

    const selected: Array<string> = await selectedRecommendations(page);
    expect(selected).toEqual([...DEPLOYMENT_ALERTS_OFF].sort());
    for (const id of selected) {
      await expect(
        page.getByTestId(`recommendation-card-select-${id}`),
      ).toHaveAttribute("aria-pressed", "true");
    }
    // Nothing else is picked for it.
    await expect(
      page.getByTestId(
        "recommendation-card-select-Kubernetes:k8s-node-not-ready",
      ),
    ).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByText("4 monitors selected")).toBeVisible();

    await screenshot(page, "deployment-alerts-recommendations");
  });

  test("its Pods tab: the crash-looping pod first, each a step to its page in its namespace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
    });
    await openTab(page, "Pods");

    const tab: Locator = page.getByTestId("kubernetes-deployment-pods");
    const rows: Locator = tab.getByRole("row").filter({
      has: page.getByRole("link"),
    });
    await expect(rows).toHaveCount(3);
    // The one that needs attention first, by the cluster's own rules.
    await expect(rows.first()).toContainText(CRASHING_POD);
    await expect(statusCell(rows.first())).toHaveText("CrashLoopBackOff");
    await expect(statusCell(rows.first())).toHaveAttribute(
      "data-tone",
      "danger",
    );
    await expect(rows.first()).toContainText("0/1");
    await expect(rows.first()).toContainText("14");
    // Only shop's pods: never payments' checkout pods.
    await expect(tab).not.toContainText("checkout-5c8d7f9b4");
    await expect(
      rows.first().getByRole("link", { name: CRASHING_POD }),
    ).toHaveAttribute("href", partPath("pods", CRASHING_POD, "shop"));

    await screenshot(page, "deployment-checkout-pods");
  });

  test("payments' checkout, of the same name in another namespace, is its own", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "payments",
    });

    const status: Locator = hero.getByTestId(
      "kubernetes-deployment-hero-status",
    );
    expect(await statusLabel(status)).toBe("Available");
    await expect(status).toHaveAttribute("data-tone", "positive");
    await expect(
      hero
        .getByTestId("kubernetes-deployment-hero-chips")
        .locator("[data-key]"),
    ).toHaveText(["2 replicas", "2 pods"]);
    // Nothing on it needs a look, and nothing is open on it.
    await expect(
      page.getByTestId("kubernetes-deployment-alerts-turn-on"),
    ).toBeVisible();
    await expect(
      page.getByTestId("kubernetes-deployment-attention"),
    ).toHaveCount(0);
    await expect(page.getByTestId("kubernetes-deployment-open")).toHaveCount(0);

    await openTab(page, "Pods");
    const tab: Locator = page.getByTestId("kubernetes-deployment-pods");
    await expect(
      tab.getByRole("row").filter({ has: page.getByRole("link") }),
    ).toHaveCount(2);
    await expect(tab).toContainText("checkout-5c8d7f9b4-p1q2r");
    await expect(tab).not.toContainText(CRASHING_POD);
  });

  test("when its read fails, it says so and still draws what Kubernetes says about it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
      query: "fail=part",
      waitForStatus: false,
    });

    await expect(
      page.getByTestId("kubernetes-deployment-part-error"),
    ).toContainText("Something went wrong on the server. Please try again.");
    // No guessed status, and no all-clear.
    await expect(
      hero.getByTestId("kubernetes-deployment-hero-status"),
    ).toHaveCount(0);
    await expect(
      page.getByTestId("kubernetes-deployment-attention"),
    ).toHaveCount(0);
    // Said in Needs attention's own frame, and where it sits still known.
    const frame: Locator = page.getByTestId(
      "kubernetes-deployment-attention-error",
    );
    await expect(
      frame.getByRole("heading", { name: "Needs attention" }),
    ).toBeVisible();
    await expect(
      hero.getByTestId("kubernetes-deployment-hero-location"),
    ).toHaveText("In namespace shop of cluster EKS Production (eu-west-1)");
    // Refresh reads it again.
    const reads: number = await apiCalls(page, "/kubernetes-resource/part/");
    await frame.getByRole("button", { name: "Refresh?" }).click();
    await expect
      .poll(async (): Promise<number> => {
        return await apiCalls(page, "/kubernetes-resource/part/");
      })
      .toBe(reads + 1);
    await screenshot(page, "deployment-part-failed");
    // Its alerts and its own details still draw.
    await expect(
      page.getByTestId("kubernetes-deployment-alerts-turn-on"),
    ).toHaveText("Turn on 4 alerts");
    await expect(
      page.getByRole("heading", { name: "Conditions" }),
    ).toBeVisible();
  });
});

test.describe("a pod's page", () => {
  test("the crash-looping pod: CrashLoopBackOff, its workload, namespace and node a step away, and why it restarted", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Pod",
      collection: "pods",
      name: CRASHING_POD,
      namespace: "shop",
    });

    const status: Locator = hero.getByTestId("kubernetes-pod-hero-status");
    expect(await statusLabel(status)).toBe("CrashLoopBackOff");
    await expect(status).toHaveAttribute("data-tone", "danger");
    const location: Locator = hero.getByTestId("kubernetes-pod-hero-location");
    await expect(location).toHaveText(
      `Pod of Deployment checkout in namespace shop, on node ${NODE_A}`,
    );
    await expect(
      location.getByRole("link", { name: "Deployment checkout" }),
    ).toHaveAttribute("href", partPath("deployments", "checkout", "shop"));
    await expect(location.getByRole("link", { name: NODE_A })).toHaveAttribute(
      "href",
      partPath("nodes", NODE_A),
    );
    await expect(
      hero.getByTestId("kubernetes-pod-hero-chips").locator("[data-key]"),
    ).toHaveText(["0/1 container ready", "14 restarts", "QoS Burstable"]);

    const card: Locator = page.getByTestId("kubernetes-pod-attention");
    expect(await attentionRows(card)).toEqual([
      { key: `Pod:shop/${CRASHING_POD}`, severity: "critical" },
    ]);
    await expect(card.getByTestId("kubernetes-pod-attention-name")).toHaveText(
      "This pod",
    );
    await expect(
      card.getByTestId("kubernetes-pod-attention-reason"),
    ).toHaveText(["CrashLoopBackOff", "Last restart: OOMKilled"]);
    await expect(page.getByTestId("kubernetes-pod-open-item")).toContainText(
      "ALT-1207",
    );
    await expect(page.getByTestId("kubernetes-pod-alerts-turn-on")).toHaveText(
      "Turn on 3 alerts",
    );

    await screenshot(page, "pod-crash-looping");

    /*
     * Its phase is a plain fact: a green Running under the hero's red
     * CrashLoopBackOff read as two answers.
     */
    const phase: Locator = detailRow(page, "Pod", "phase");
    await expect(phase).toHaveText(/Phase\s*Running/);
    await expect(phase.locator("[class*='bg-green']")).toHaveCount(0);
    await expect(detailRow(page, "Pod", "status")).toHaveCount(0);
    // What owns it is a real link, to the Deployment its ReplicaSet belongs to.
    await expect(
      detailRow(page, "Pod", "owner-references").getByRole("link", {
        name: "checkout-7d9f8b6c5",
      }),
    ).toHaveAttribute("href", partPath("deployments", "checkout", "shop"));

    // Why it restarted, on its container: red, as its state is.
    await openTab(page, "Containers");
    await expect(
      page.getByTestId("kubernetes-container-last-restart").first(),
    ).toContainText("OOMKilled");
    await expect(
      page.getByTestId("kubernetes-container-diagnosis").first(),
    ).toHaveAttribute("data-tone", "danger");

    // Its workload, one step away.
    await openTab(page, "Overview");
    await page
      .getByTestId("kubernetes-pod-hero-location")
      .getByRole("link", { name: "Deployment checkout" })
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLUSTER_PATH}/deployments/checkout` &&
        url.searchParams.get("namespace") === "shop"
      );
    });
  });
});

test.describe("a node on OpenStack", () => {
  const CLOUD: string = "71000000-0000-4000-8000-000000000009";
  const HYPERVISOR: string = "RegionOne/compute-01.acme.example";

  test("says which instance it is, from its provider ID, and which hypervisor and zone that is on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, {
      kind: "Node",
      collection: "nodes",
      name: NODE_A,
      query: "openstack=instance",
    });

    const card: Locator = page.getByTestId(
      "kubernetes-node-openstack-placement",
    );
    await expect(card).toContainText("from its spec.providerID");
    await expect(
      card.getByTestId("openstack-placement-instance"),
    ).toContainText("web-1");
    await expect(card.getByTestId("openstack-placement-zone")).toContainText(
      "az-1",
    );
    const hypervisor: Locator = card.getByTestId(
      "openstack-placement-hypervisor",
    );
    await expect(hypervisor).toContainText("compute-01.acme.example");
    await expect(hypervisor.getByRole("link")).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/openstack/${CLOUD}/hypervisors/${encodeURIComponent(HYPERVISOR)}`,
    );
    await screenshot(page, "kubernetes-node-on-openstack");
  });

  test("a node on no OpenStack says nothing of it at all", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, { kind: "Node", collection: "nodes", name: NODE_A });

    await expect
      .poll(async (): Promise<boolean> => {
        const requests: Array<{ url: string }> = await page.evaluate(
          (): Array<{ url: string }> => {
            return (
              window as unknown as {
                __kubernetesPagesFixture: {
                  apiRequests: Array<{ url: string }>;
                };
              }
            ).__kubernetesPagesFixture.apiRequests;
          },
        );
        return requests.some((request: { url: string }): boolean => {
          return request.url.includes("/placement-of-kubernetes-node/");
        });
      })
      .toBe(true);
    await expect(
      page.getByTestId("kubernetes-node-openstack-placement"),
    ).toHaveCount(0);
  });
});

test.describe("a node's page", () => {
  test("the node that stopped talking to the API server: Unreachable, its incident, the pod on it not ready", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Node",
      collection: "nodes",
      name: NODE_LOST,
    });

    const status: Locator = hero.getByTestId("kubernetes-node-hero-status");
    /*
     * Kubernetes' own word (its unreachable taint), not "stopped reporting"
     * beside "Last reported 1 minute ago": the agent still reports it.
     */
    expect(await statusLabel(status)).toBe("Unreachable");
    await expect(status).toHaveAttribute("data-tone", "danger");
    await expect(hero.getByTestId("kubernetes-node-hero-location")).toHaveText(
      "Node of cluster EKS Production (eu-west-1)",
    );
    await expect(
      hero.getByTestId("kubernetes-node-hero-chips").locator("[data-key]"),
    ).toHaveText([
      "1 pod",
      "4 cores",
      "15.33 GB memory",
      "Kubelet v1.30.2-eks-1552ad0",
    ]);

    const card: Locator = page.getByTestId("kubernetes-node-attention");
    expect(await attentionRows(card)).toEqual([
      { key: `Node:${NODE_LOST}`, severity: "critical" },
      { key: `Pod:kube-system/${LOST_NODE_POD}`, severity: "warning" },
    ]);
    await expect(
      attentionRow(card, `Node:${NODE_LOST}`).getByTestId(
        "kubernetes-node-attention-name",
      ),
    ).toHaveText("This node");
    // A node's pods come from every namespace: each says its own.
    await expect(
      attentionRow(card, `Pod:kube-system/${LOST_NODE_POD}`).getByTestId(
        "kubernetes-node-attention-detail",
      ),
    ).toHaveText("kube-system");
    // No NotReady in its details beside the hero's Unreachable.
    await expect(page.getByTestId("kubernetes-node-details")).toBeVisible();
    await expect(detailRow(page, "Node", "status")).toHaveCount(0);
    await expect(page.getByTestId("kubernetes-node-details")).not.toContainText(
      "NotReady",
    );

    const open: Locator = page.getByTestId("kubernetes-node-open-item");
    await expect(open).toHaveCount(1);
    await expect(open).toContainText(
      "[K8s] Node Not Ready - EKS Production (eu-west-1)",
    );
    await expect(open).toContainText("INC-312");
    await expect(page.getByTestId("kubernetes-node-alerts-turn-on")).toHaveText(
      "Turn on 7 alerts",
    );

    await screenshot(page, "node-unreachable");

    // The pod on it, a step away in its namespace.
    await attentionRow(card, `Pod:kube-system/${LOST_NODE_POD}`)
      .getByRole("link")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLUSTER_PATH}/pods/${LOST_NODE_POD}` &&
        url.searchParams.get("namespace") === "kube-system"
      );
    });
  });

  test("its Pods tab names each pod's workload and namespace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPart(page, { kind: "Node", collection: "nodes", name: NODE_A });
    await openTab(page, "Pods");

    const tab: Locator = page.getByTestId("kubernetes-node-pods");
    await expect(
      tab.getByRole("columnheader", { name: "Workload" }).first(),
    ).toBeVisible();
    await expect(
      tab.getByRole("columnheader", { name: "Namespace" }).first(),
    ).toBeVisible();
    const rows: Locator = tab.getByRole("row").filter({
      has: page.getByRole("link"),
    });
    // The crash-looping pod first.
    await expect(rows.first()).toContainText(CRASHING_POD);
    await expect(rows.first()).toContainText("checkout");
    await expect(tableRow(tab, "postgres-0")).toContainText("postgres");
    await expect(tableRow(tab, "postgres-0")).toContainText("data");
  });

  test("a cordoned node: Scheduling disabled, and nothing on it needs attention", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Node",
      collection: "nodes",
      name: NODE_CORDONED,
    });

    const status: Locator = hero.getByTestId("kubernetes-node-hero-status");
    expect(await statusLabel(status)).toBe("Scheduling disabled");
    await expect(status).toHaveAttribute("data-tone", "neutral");
    await expect(
      page.getByTestId("kubernetes-node-alerts-turn-on"),
    ).toBeVisible();
    await expect(page.getByTestId("kubernetes-node-attention")).toHaveCount(0);
  });
});

test.describe("a StatefulSet's, a DaemonSet's, a CronJob's and a Job's page", () => {
  test("postgres: 2 of 3 ready, and the scheduler's words for the pod it cannot place", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "StatefulSet",
      collection: "statefulsets",
      name: "postgres",
      namespace: "data",
    });

    expect(
      await statusLabel(hero.getByTestId("kubernetes-statefulset-hero-status")),
    ).toBe("2 of 3 ready");
    const card: Locator = page.getByTestId("kubernetes-statefulset-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "StatefulSet:data/postgres", severity: "warning" },
      { key: "Pod:data/postgres-2", severity: "warning" },
    ]);
    const pending: Locator = attentionRow(card, "Pod:data/postgres-2");
    await expect(
      pending.getByTestId("kubernetes-statefulset-attention-reason"),
    ).toHaveText("Can't be scheduled");
    await expect(
      pending.getByTestId("kubernetes-statefulset-attention-message"),
    ).toContainText("0/4 nodes are available");
    await expect(
      page.getByTestId("kubernetes-statefulset-alerts-turn-on"),
    ).toHaveText("Turn on 3 alerts");
    // When it was created reads as an age, as kubectl says it.
    await expect(
      page.getByRole("tabpanel", { name: "Overview" }),
    ).not.toContainText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    await screenshot(page, "statefulset-postgres");
  });

  test("fluent-bit: ready on 3 of 4 nodes, the pod on the lost node a step away", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "DaemonSet",
      collection: "daemonsets",
      name: "fluent-bit",
      namespace: "kube-system",
    });

    expect(
      await statusLabel(hero.getByTestId("kubernetes-daemonset-hero-status")),
    ).toBe("Ready on 3 of 4 nodes");
    await expect(
      hero.getByTestId("kubernetes-daemonset-hero-chips").locator("[data-key]"),
    ).toHaveText(["Runs on 4 nodes", "4 pods"]);
    const card: Locator = page.getByTestId("kubernetes-daemonset-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "DaemonSet:kube-system/fluent-bit", severity: "warning" },
      { key: `Pod:kube-system/${LOST_NODE_POD}`, severity: "warning" },
    ]);
    await expect(
      attentionRow(card, `Pod:kube-system/${LOST_NODE_POD}`).getByRole("link"),
    ).toHaveAttribute("href", partPath("pods", LOST_NODE_POD, "kube-system"));
    await expect(
      page.getByTestId("kubernetes-daemonset-alerts-turn-on"),
    ).toHaveText("Turn on 2 alerts");
  });

  test("nightly-report: its last run failed, that run a step away, and when it last ran in words", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "CronJob",
      collection: "cronjobs",
      name: "nightly-report",
      namespace: "shop",
    });

    const status: Locator = hero.getByTestId("kubernetes-cronjob-hero-status");
    expect(await statusLabel(status)).toBe("Last run failed");
    // Amber, as its row in Needs attention: a warning, not an outage.
    await expect(status).toHaveAttribute("data-tone", "warning");
    await expect(
      hero.getByTestId("kubernetes-cronjob-hero-chips").locator("[data-key]"),
    ).toHaveText(["Schedule 0 2 * * *", "2 runs kept"]);

    const card: Locator = page.getByTestId("kubernetes-cronjob-attention");
    expect(await attentionRows(card)).toEqual([
      { key: "CronJob:shop/nightly-report", severity: "warning" },
      { key: `Job:shop/${FAILED_RUN}`, severity: "warning" },
    ]);
    await expect(
      attentionRow(card, `Job:shop/${FAILED_RUN}`).getByTestId(
        "kubernetes-cronjob-attention-reason",
      ),
    ).toHaveText(["Failed", "BackoffLimitExceeded"]);
    await expect(
      page.getByTestId("kubernetes-cronjob-alerts-turn-on"),
    ).toHaveText("Turn on 1 alert");
    // When it last ran, in words; never an ISO string.
    const overview: Locator = page.getByRole("tabpanel", { name: "Overview" });
    await expect(overview).toContainText("an hour ago");
    await expect(overview).not.toContainText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);

    await screenshot(page, "cronjob-nightly-report");

    // Its runs' pods, the failed run's first.
    await openTab(page, "Pods");
    const rows: Locator = page
      .getByTestId("kubernetes-cronjob-pods")
      .getByRole("row")
      .filter({ has: page.getByRole("link") });
    await expect(rows.first()).toContainText(`${FAILED_RUN}-k2j4h`);
    await expect(rows.first()).toContainText(FAILED_RUN);

    await openTab(page, "Overview");
    await attentionRow(card, `Job:shop/${FAILED_RUN}`)
      .getByRole("link")
      .click();
    await expect(page).toHaveURL((url: URL): boolean => {
      return (
        url.pathname === `${CLUSTER_PATH}/jobs/${FAILED_RUN}` &&
        url.searchParams.get("namespace") === "shop"
      );
    });
  });

  test("the failed run: Failed, BackoffLimitExceeded, and when it started as a time", async ({
    page,
  }: {
    page: Page;
  }) => {
    const hero: Locator = await openPart(page, {
      kind: "Job",
      collection: "jobs",
      name: FAILED_RUN,
      namespace: "shop",
    });

    const status: Locator = hero.getByTestId("kubernetes-job-hero-status");
    expect(await statusLabel(status)).toBe("Failed");
    await expect(status).toHaveAttribute("data-tone", "warning");
    // Whose run it is, one step from that CronJob's page in its namespace.
    const location: Locator = hero.getByTestId("kubernetes-job-hero-location");
    await expect(location).toHaveText(
      "Run of CronJob nightly-report in namespace shop",
    );
    await expect(
      location.getByRole("link", { name: "CronJob nightly-report" }),
    ).toHaveAttribute("href", partPath("cronjobs", "nightly-report", "shop"));
    await expect(
      hero.getByTestId("kubernetes-job-hero-chips").locator("[data-key]"),
    ).toHaveText(["3 pods failed"]);
    await expect(
      page.getByTestId("kubernetes-job-attention-reason"),
    ).toHaveText(["Failed", "BackoffLimitExceeded"]);
    const overview: Locator = page.getByRole("tabpanel", { name: "Overview" });
    await expect(overview).not.toContainText(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/);
    await expect(overview).toContainText(
      /Start Time\s*[A-Z][a-z]{2} \d{2} \d{4}, \d{2}:\d{2}/,
    );
  });
});

test.describe("the lists", () => {
  test("Deployments: each one's status in Kubernetes' words, and its own namespace's CPU", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}/deployments`);

    const shop: Locator = page.getByRole("row").filter({
      has: page.getByRole("link", { name: "checkout" }),
      hasText: "shop",
    });
    const payments: Locator = page.getByRole("row").filter({
      has: page.getByRole("link", { name: "checkout" }),
      hasText: "payments",
    });
    await expect(shop).toHaveCount(1);
    await expect(payments).toHaveCount(1);

    await expect(statusCell(shop)).toHaveText("2 of 3 available");
    await expect(statusCell(shop)).toHaveAttribute("data-tone", "warning");
    await expect(statusCell(payments)).toHaveText("Available");
    await expect(statusCell(payments)).toHaveAttribute("data-tone", "positive");
    const web: Locator = tableRow(page, "web");
    await expect(statusCell(web)).toHaveText("Rolling out");

    // Each counts its own pods: shop's 22% + 19%, payments' 14% + 12%.
    await expect(shop).toContainText("41.0%");
    await expect(payments).toContainText("26.0%");
    // Each opens its own page.
    await expect(shop.getByRole("link", { name: "checkout" })).toHaveAttribute(
      "href",
      partPath("deployments", "checkout", "shop"),
    );
    await expect(
      payments.getByRole("link", { name: "checkout" }),
    ).toHaveAttribute("href", partPath("deployments", "checkout", "payments"));
    await expectNoSidewaysScroll(page);
    await screenshot(page, "deployments-list");
  });

  test("StatefulSets, DaemonSets, Jobs and CronJobs: each one's status in the rules' words and tone, a step from its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}/statefulsets`);
    const postgres: Locator = tableRow(page, "postgres");
    await expect(statusCell(postgres)).toHaveText("2 of 3 ready");
    await expect(statusCell(postgres)).toHaveAttribute("data-tone", "warning");
    await expect(
      postgres.getByRole("link", { name: "postgres" }),
    ).toHaveAttribute("href", partPath("statefulsets", "postgres", "data"));

    await page.goto(`${CLUSTER_PATH}/daemonsets`);
    const fluentBit: Locator = tableRow(page, "fluent-bit");
    await expect(statusCell(fluentBit)).toHaveText("Ready on 3 of 4 nodes");
    await expect(statusCell(fluentBit)).toHaveAttribute("data-tone", "warning");

    // A failed run says so; one that finished is done, not a warning.
    await page.goto(`${CLUSTER_PATH}/jobs`);
    const failed: Locator = tableRow(page, FAILED_RUN);
    await expect(statusCell(failed)).toHaveText("Failed");
    await expect(statusCell(failed)).toHaveAttribute("data-tone", "warning");
    await expect(statusCell(tableRow(page, "db-migrate-41"))).toHaveText(
      "Completed",
    );
    await expect(
      failed.getByRole("link", { name: FAILED_RUN }),
    ).toHaveAttribute("href", partPath("jobs", FAILED_RUN, "shop"));

    // A CronJob whose newest run failed says so, as its page does.
    await page.goto(`${CLUSTER_PATH}/cronjobs`);
    const nightly: Locator = tableRow(page, "nightly-report");
    await expect(statusCell(nightly)).toHaveText("Last run failed");
    await expect(statusCell(nightly)).toHaveAttribute("data-tone", "warning");
    await expect(nightly).toContainText("0 2 * * *");
    await expectNoSidewaysScroll(page);
    await screenshot(page, "cronjobs-list");
  });

  test("Pods: the crash loop red, the pod that cannot be scheduled amber, restarts counted", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}/pods`);

    const crashing: Locator = tableRow(page, CRASHING_POD);
    await expect(statusCell(crashing)).toHaveText("CrashLoopBackOff");
    await expect(statusCell(crashing)).toHaveAttribute("data-tone", "danger");
    await expect(crashing).toContainText("14");
    const pending: Locator = tableRow(page, "postgres-2");
    await expect(statusCell(pending)).toHaveText("Pending");
    await expect(statusCell(pending)).toHaveAttribute("data-tone", "warning");
    await expect(statusCell(tableRow(page, "postgres-0"))).toHaveText(
      "Running",
    );
    await expectNoSidewaysScroll(page);
  });
});

/*
 * What a card holds lines up with its title (#6956): the Overview's
 * Workloads and Infrastructure links and its Pod Health bar sat in a second
 * padding (py-4 pr-4 pl-1, p-4), 4 to 16px in from the title.
 */
test.describe("the Overview's cards line up with their titles", () => {
  test("Workloads, Infrastructure and Pod Health start under their titles, on a laptop and a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page);

    await expectCardsFit(page, [
      page
        .getByTestId("card")
        .filter({ hasText: "Explore workload resources" }),
      page
        .getByTestId("card")
        .filter({ hasText: "Explore infrastructure resources" }),
      page
        .getByTestId("card")
        .filter({ hasText: "Distribution of pod statuses" }),
    ]);
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
    await expect(page.getByTestId("kubernetes-needs-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-overview");

    await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
    });
    await expect(
      page.getByTestId("kubernetes-deployment-attention"),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-deployment");

    await openPart(page, {
      kind: "Pod",
      collection: "pods",
      name: CRASHING_POD,
      namespace: "shop",
    });
    await expect(page.getByTestId("kubernetes-pod-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-pod");

    await openPart(page, {
      kind: "Node",
      collection: "nodes",
      name: NODE_LOST,
    });
    await expect(page.getByTestId("kubernetes-node-attention")).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "phone-node");

    await openPart(page, {
      kind: "StatefulSet",
      collection: "statefulsets",
      name: "postgres",
      namespace: "data",
    });
    await expect(
      page.getByTestId("kubernetes-statefulset-attention"),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
  });

  test("in dark mode the pages draw on the dark theme", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "theme=dark");
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(page.getByTestId("kubernetes-needs-attention")).toBeVisible();
    await screenshot(page, "dark-overview");

    await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
      query: "theme=dark",
    });
    await expect(page.locator("html")).toHaveClass(/dark/);
    await expect(
      page.getByTestId("kubernetes-deployment-attention"),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "dark-deployment");
  });

  test("in German the Overview and a Deployment's page speak German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=de");
    const card: Locator = page.getByTestId("kubernetes-needs-attention");
    await expect(
      card.getByText(GERMAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    expect(GERMAN["Needs attention"]).not.toBe("Needs attention");
    await expect(
      page.getByTestId("kubernetes-needs-attention-summary").locator("span"),
    ).toHaveText([
      fill(GERMAN, "{{count}} critical", { count: "2" }),
      fill(GERMAN, "{{count}} to look at", { count: "5" }),
    ]);
    await expect(
      attentionRow(card, "Deployment:shop/checkout")
        .getByTestId("kubernetes-needs-attention-reason")
        .first(),
    ).toHaveText(
      fill(GERMAN, "{{available}} of {{desired}} available", {
        available: "2",
        desired: "3",
      }),
    );
    await expect(
      attentionRow(card, `Node:${NODE_LOST}`).getByTestId(
        "kubernetes-needs-attention-reason",
      ),
    ).toHaveText(GERMAN["Unreachable"] as string);
    // The hero's counts are German too: "18 Pods", "1 Knoten nicht bereit".
    expect(GERMAN["{{count}} pods"]).not.toBe("{{count}} pods");
    await expect(
      page.getByText(fill(GERMAN, "{{count}} pods", { count: "18" }), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByText(fill(GERMAN, "{{count}} nodes", { count: "4" }), {
        exact: true,
      }),
    ).toBeVisible();
    await expect(notReadyChip(page)).toHaveText(
      fill(GERMAN, "{{count}} Nodes Not Ready_one", { count: "1" }),
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "german-overview");

    const hero: Locator = await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
      query: "lang=de",
    });
    expect(
      await statusLabel(hero.getByTestId("kubernetes-deployment-hero-status")),
    ).toBe(
      fill(GERMAN, "{{available}} of {{desired}} available", {
        available: "2",
        desired: "3",
      }),
    );
    await expect(
      hero.getByTestId("kubernetes-deployment-hero-location"),
    ).toHaveText(
      fill(GERMAN, "In namespace {{namespace}} of cluster {{cluster}}", {
        namespace: "shop",
        cluster: "EKS Production (eu-west-1)",
      }),
    );
    await expect(
      attentionRow(
        page.getByTestId("kubernetes-deployment-attention"),
        "Deployment:shop/checkout",
      ).getByTestId("kubernetes-deployment-attention-name"),
    ).toHaveText(GERMAN["This Deployment"] as string);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "german-deployment");
  });

  test("in Persian the pages read right to left, in Persian digits, and nothing runs off the screen", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openOverview(page, "lang=fa");
    await expect(page.locator("html")).toHaveAttribute("dir", "rtl");
    const card: Locator = page.getByTestId("kubernetes-needs-attention");
    await expect(
      card.getByText(PERSIAN["Needs attention"] as string, { exact: true }),
    ).toBeVisible();
    // "2 از ۳" would read as two kinds of digit: every number is Persian.
    const summary: string =
      (await page
        .getByTestId("kubernetes-needs-attention-summary")
        .textContent()) || "";
    expect(summary).toContain("۲");
    expect(summary).not.toMatch(LATIN_DIGIT);
    const reason: string =
      (await attentionRow(card, "Deployment:shop/checkout")
        .getByTestId("kubernetes-needs-attention-reason")
        .first()
        .textContent()) || "";
    /*
     * Each number set apart from the Persian words around it (FSI ... PDI),
     * as the shared Needs attention card sets every value of a reason apart
     * since a host's mount kept its slash at the wrong end there.
     */
    expect(reason).toBe(
      fill(PERSIAN, "{{available}} of {{desired}} available", {
        available: "⁨۲⁩",
        desired: "⁨۳⁩",
      }),
    );
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-overview");

    await page.setViewportSize({ width: 390, height: 844 });
    const hero: Locator = await openPart(page, {
      kind: "Deployment",
      collection: "deployments",
      name: "checkout",
      namespace: "shop",
      query: "lang=fa",
    });
    const status: string = await statusLabel(
      hero.getByTestId("kubernetes-deployment-hero-status"),
    );
    expect(status).toContain("۳");
    expect(status).not.toMatch(LATIN_DIGIT);
    await expect(
      page.getByTestId("kubernetes-deployment-attention"),
    ).toBeVisible();
    await expectNoSidewaysScroll(page);
    await screenshot(page, "persian-phone-deployment");
  });
});
