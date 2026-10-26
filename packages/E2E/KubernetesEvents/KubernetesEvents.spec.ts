import { expect, Locator, Page, Route, test } from "@playwright/test";
import fs from "fs";
import fsPromises from "fs/promises";
import path from "path";

/*
 * Where a Kubernetes cluster's warning events show, in a browser, against
 * the offline fixture (KubernetesEvents/Fixture).
 *
 * Issue #5179: a customer saw warning events in the cluster - kernel-monitor's
 * OOMKilling on AKS nodes, the HPA's FailedGetResourceMetric and
 * FailedComputeMetricsReplicas in aks-istio-system and app-routing-system -
 * and not in OneUptime, and asked to see each one's message, type, reason,
 * source, object, namespace and count. So, read the way a person reads them:
 * the cluster's Events page opening on the warnings, every one of the
 * customer's with what it says; repeats counted, not listed again; All and
 * Normal; the namespace, kind and reason pickers, filtered on the server and
 * kept in the address; the object linked to its page; a node's, an HPA's, a
 * Deployment's and a namespace's Events tab, its warnings counted on the tab
 * before it is opened; the Overview's Recent Warnings; a busy cluster whose
 * Normal events outnumber what one read takes; a quiet one, an empty one and
 * a read that fails; Events beside Logs in the side menu; at a laptop's and a
 * phone's width, light and dark, and in German. The fixture records every
 * read, so the tests check what was asked for as well as what was drawn, and
 * that nothing the fixture does not model was asked for at all.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const CLUSTER_IDENTIFIER: string = "aks-prod-westeurope";

const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`;
const EVENTS_PAGE: string = `${CLUSTER_PATH}/events`;

const USER_POOL_NODE: string = "aks-userpool-11935137-vmss00000o";
const AGENT_POOL_NODE: string = "aks-agentpool-19172126-vmss000000";
const CHECKOUT_POD: string = "checkout-7d4f9b6c5-x2x7q";
const NEIGHBOUR_POD: string = "checkout-api-6c5b8d7f9-k2m4p";

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/kubernetes-events-ui",
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

interface LogRequest {
  attributes: Record<string, unknown>;
  operators: Record<string, string>;
  select: Record<string, boolean>;
  limit: number;
  ids: Array<string> | null;
  window: { start: string; end: string } | null;
}

interface Recorded {
  logRequests: Array<LogRequest>;
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
          window as unknown as { __kubernetesEventsFixture?: Recorded }
        ).__kubernetesEventsFixture;
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

async function logRequests(page: Page): Promise<Array<LogRequest>> {
  return await page.evaluate((): Array<LogRequest> => {
    return (window as unknown as { __kubernetesEventsFixture: Recorded })
      .__kubernetesEventsFixture.logRequests;
  });
}

// The newest Events read the page made.
async function lastLogRequest(page: Page): Promise<LogRequest> {
  const requests: Array<LogRequest> = await logRequests(page);
  const last: LogRequest | undefined = requests[requests.length - 1];

  if (!last) {
    throw new Error("The page read no Events.");
  }

  return last;
}

function withQuery(base: string, query: string): string {
  return query ? `${base}?${query}` : base;
}

// The cluster's Events page, once its first reads are in.
async function openEventsPage(page: Page, query: string = ""): Promise<void> {
  await page.goto(withQuery(EVENTS_PAGE, query));
  await expect(page.getByTestId("kubernetes-events-view")).toBeVisible();
  await expect(
    page
      .getByTestId("kubernetes-events-filters")
      .or(page.getByTestId("kubernetes-events-error")),
  ).toBeVisible();
}

// A detail page with its Events tab open.
async function openEventsTab(page: Page, pagePath: string): Promise<Locator> {
  await page.goto(pagePath);
  const tab: Locator = page.getByTestId("tab-Events");
  await expect(tab).toBeVisible();
  await tab.click();
  await expect(tab).toHaveAttribute("aria-selected", "true");
  const panel: Locator = page.getByRole("tabpanel");
  await expect(
    panel
      .getByTestId("kubernetes-events-tab")
      .or(panel.getByTestId("kubernetes-events-tab-empty"))
      .or(panel.getByTestId("kubernetes-events-tab-error")),
  ).toBeVisible();
  return panel;
}

// The All / Warnings / Normal buttons, named "Event type" in English.
function typeButtons(
  scope: Page | Locator,
  groupName: string = "Event type",
): Locator {
  return scope.getByRole("radiogroup", { name: groupName });
}

function typeButton(
  scope: Page | Locator,
  label: string,
  groupName: string = "Event type",
): Locator {
  return typeButtons(scope, groupName).getByRole("radio", {
    name: new RegExp(`^${label}`),
  });
}

async function reasons(scope: Page | Locator): Promise<Array<string>> {
  return await scope.getByTestId("kubernetes-event-reason").allTextContents();
}

/*
 * The rows of one reason about one object: from the Event cell up to the
 * row that also holds its count (a <tr> on a laptop, a card on a phone).
 */
function rowsOf(
  scope: Page | Locator,
  reason: string,
  objectName: string,
): Locator {
  // A filter's `has` is read inside each match, so it starts from the page.
  const page: Page =
    "page" in scope && typeof scope.page === "function"
      ? (scope as Locator).page()
      : (scope as Page);

  return scope
    .getByTestId("kubernetes-event")
    .filter({
      has: page
        .getByTestId("kubernetes-event-reason")
        .getByText(reason, { exact: true }),
    })
    .locator(
      "xpath=ancestor::*[.//*[@data-testid='kubernetes-event-count']][1]",
    )
    .filter({ hasText: objectName });
}

// Picks a value in one of the Events page's pickers (react-select).
async function pick(page: Page, label: string, value: string): Promise<void> {
  await page.getByRole("combobox", { name: label }).click();
  await page
    .locator(".ou-select__menu")
    .getByText(value, { exact: true })
    .click();
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

/*
 * How light a colour is as it is seen, 0 (black) to 1 (white): an element's
 * text colour or background, laid over the backgrounds behind it up to the
 * first opaque one (a dark theme's tints are translucent).
 */
async function lightness(
  locator: Locator,
  property: "color" | "background-color",
): Promise<number> {
  return await locator.evaluate((element: Element, name: string): number => {
    type Rgba = [number, number, number, number];

    const parse: (value: string) => Rgba = (value: string): Rgba => {
      const parts: Array<number> = value
        .replace("rgba(", "")
        .replace("rgb(", "")
        .replace(")", "")
        .split(",")
        .map((part: string) => {
          return Number(part.trim());
        });
      return [
        parts[0] || 0,
        parts[1] || 0,
        parts[2] || 0,
        parts.length > 3 ? parts[3]! : 1,
      ];
    };

    // The layers from this element down to the first opaque background.
    const layers: Array<Rgba> = [
      parse(getComputedStyle(element).getPropertyValue(name)),
    ];
    let current: Element | null =
      name === "color" ? element : element.parentElement;

    while (current && layers[layers.length - 1]![3] < 1) {
      const background: Rgba = parse(
        getComputedStyle(current).getPropertyValue("background-color"),
      );
      if (background[3] > 0) {
        layers.push(background);
      }
      current = current.parentElement;
    }

    // Composite from the back: white if nothing behind was opaque.
    let seen: [number, number, number] = [255, 255, 255];
    for (const [red, green, blue, alpha] of layers.reverse()) {
      seen = [
        red * alpha + seen[0] * (1 - alpha),
        green * alpha + seen[1] * (1 - alpha),
        blue * alpha + seen[2] * (1 - alpha),
      ];
    }

    return (0.2126 * seen[0] + 0.7152 * seen[1] + 0.0722 * seen[2]) / 255;
  }, property);
}

test.describe("the cluster's Events page", () => {
  test("opens on the warnings: every one of the issue's, with what it says, who reported it, its object, namespace and count", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    await expect(typeButton(page, "Warnings")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(typeButton(page, "Warnings")).toHaveText(/11/);
    await expect(typeButton(page, "All")).toHaveText(/22/);
    await expect(typeButton(page, "Normal")).toHaveText(/11/);

    // Only warnings, and no other cluster's: 11 Events, newest first.
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
    await expect(page.getByTestId("kubernetes-event-type")).toHaveText(
      Array(11).fill("Warning"),
    );
    expect(await reasons(page)).toEqual([
      "BackOff",
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
      "Unhealthy",
      "BackOff",
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
      "OOMKilling",
      "OOMKilling",
      "OOMKilling",
      "FailedMount",
    ]);
    await expect(
      page.getByText("aks-stagingpool-23810077-vmss000001"),
    ).toHaveCount(0);

    // kernel-monitor's OOM kill on a node, in "default", as kubectl lists it.
    const oom: Locator = rowsOf(page, "OOMKilling", USER_POOL_NODE);
    await expect(oom).toHaveCount(1);
    await expect(oom.getByTestId("kubernetes-event-message")).toHaveText(
      /^Memory cgroup out of memory: Killed process 318623 \(MainThread\)/,
    );
    await expect(oom.getByTestId("kubernetes-event-source")).toHaveText(
      `Reported by kernel-monitor · ${USER_POOL_NODE}`,
    );
    await expect(oom.getByTestId("kubernetes-event-object")).toContainText(
      "Node",
    );
    await expect(
      oom.getByTestId("kubernetes-event-object").getByRole("link"),
    ).toHaveAttribute("href", `${CLUSTER_PATH}/nodes/${USER_POOL_NODE}`);
    await expect(oom.getByTestId("kubernetes-event-namespace")).toHaveText(
      "default",
    );
    await expect(oom.getByTestId("kubernetes-event-count")).toHaveText("2");
    await expect(oom.getByTestId("kubernetes-event-last-seen")).toHaveAttribute(
      "datetime",
      /^\d{4}-\d{2}-\d{2}T/,
    );

    // The HPA's two warnings, in each of the two system namespaces.
    for (const [hpa, namespace, count] of [
      ["istiod", "aks-istio-system", "3"],
      ["nginx", "app-routing-system", "1"],
    ] as Array<[string, string, string]>) {
      for (const reason of [
        "FailedGetResourceMetric",
        "FailedComputeMetricsReplicas",
      ]) {
        const row: Locator = rowsOf(page, reason, hpa).filter({
          hasText: namespace,
        });
        await expect(row).toHaveCount(1);
        await expect(row.getByTestId("kubernetes-event-source")).toHaveText(
          "Reported by horizontal-pod-autoscaler",
        );
        await expect(row.getByTestId("kubernetes-event-object")).toContainText(
          "HorizontalPodAutoscaler",
        );
        await expect(
          row.getByTestId("kubernetes-event-object").getByRole("link"),
        ).toHaveAttribute("href", `${CLUSTER_PATH}/hpas/${hpa}`);
        await expect(row.getByTestId("kubernetes-event-namespace")).toHaveText(
          namespace,
        );
        await expect(row.getByTestId("kubernetes-event-count")).toHaveText(
          count,
        );
      }
    }

    await expect(
      rowsOf(page, "FailedGetResourceMetric", "istiod").getByTestId(
        "kubernetes-event-message",
      ),
    ).toHaveText(
      "failed to get cpu utilization: unable to get metrics for resource cpu: no metrics returned from resource metrics API",
    );

    // Which part of a pod an Event is about, under the pod.
    await expect(
      rowsOf(page, "BackOff", CHECKOUT_POD).getByTestId(
        "kubernetes-event-object",
      ),
    ).toContainText("spec.containers{checkout}");

    await screenshot(page, "events-warnings-1280");
  });

  test("a repeated event is one row with its newest count, not a row per repeat", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    // Each was stored once when it happened and again as it repeated.
    await expect(rowsOf(page, "BackOff", CHECKOUT_POD)).toHaveCount(1);
    await expect(
      rowsOf(page, "BackOff", CHECKOUT_POD).getByTestId(
        "kubernetes-event-count",
      ),
    ).toHaveText("14");
    await expect(
      rowsOf(page, "Unhealthy", CHECKOUT_POD).getByTestId(
        "kubernetes-event-count",
      ),
    ).toHaveText("6");

    // Two OOM kills on one node are two Events: two rows, 2 and 1.
    await expect(rowsOf(page, "OOMKilling", AGENT_POOL_NODE)).toHaveCount(2);
    await expect(
      rowsOf(page, "OOMKilling", AGENT_POOL_NODE).getByTestId(
        "kubernetes-event-count",
      ),
    ).toHaveText(["2", "1"]);
  });

  test("asks the server for this cluster's Events alone, the warnings in a read of their own, without their bodies", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    const requests: Array<LogRequest> = await logRequests(page);
    const lists: Array<LogRequest> = requests.filter((request: LogRequest) => {
      return !request.ids;
    });

    expect(lists).toHaveLength(2);

    for (const request of requests) {
      expect(request.attributes).toMatchObject({
        "event.domain": "k8s",
        "k8s.resource.name": "events",
        "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
      });
      // The past day by default.
      expect(
        new Date(request.window!.end).getTime() -
          new Date(request.window!.start).getTime(),
      ).toBe(24 * 60 * 60 * 1000);
    }

    // The warnings on their own: a busy cluster's Normal events never crowd them out.
    const warningsRead: LogRequest | undefined = lists.find(
      (request: LogRequest) => {
        return request.attributes["k8s.event.type"] === "Warning";
      },
    );
    expect(warningsRead).toBeTruthy();
    expect(warningsRead!.select["body"]).toBeFalsy();
    expect(warningsRead!.limit).toBe(1000);

    const allRead: LogRequest | undefined = lists.find(
      (request: LogRequest) => {
        return request.attributes["k8s.event.type"] === undefined;
      },
    );
    expect(allRead).toBeTruthy();
    expect(allRead!.select["body"]).toBeFalsy();

    /*
     * Only the warning stored before ingest stamped it is read by its body:
     * its two records (when it happened, and when it repeated), by id.
     */
    const bodyReads: Array<LogRequest> = requests.filter(
      (request: LogRequest) => {
        return Boolean(request.ids);
      },
    );
    expect(bodyReads).toHaveLength(1);
    expect(bodyReads[0]!.select["body"]).toBe(true);
    expect(bodyReads[0]!.ids).toHaveLength(2);
    expect(bodyReads[0]!.limit).toBe(2);
  });

  test("a warning stored before ingest stamped what it says is still listed, read from its body", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    const mount: Locator = rowsOf(
      page,
      "FailedMount",
      "reports-28791440-t9x3q",
    );
    await expect(mount).toHaveCount(1);
    await expect(mount.getByTestId("kubernetes-event-type")).toHaveText(
      "Warning",
    );
    await expect(mount.getByTestId("kubernetes-event-message")).toHaveText(
      'MountVolume.SetUp failed for volume "report-secrets" : secret "report-secrets" not found',
    );
    await expect(mount.getByTestId("kubernetes-event-namespace")).toHaveText(
      "batch",
    );
    await expect(mount.getByTestId("kubernetes-event-count")).toHaveText("4");
  });

  test("All lists every event and Normal the rest, each kept in the address", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    await typeButton(page, "All").click();
    await expect(typeButton(page, "All")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page).toHaveURL(/[?&]type=all(&|$)/);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(22);
    await expect(rowsOf(page, "RegisteredNode", USER_POOL_NODE)).toHaveCount(1);
    await expect(
      rowsOf(page, "RegisteredNode", USER_POOL_NODE).getByTestId(
        "kubernetes-event-type",
      ),
    ).toHaveText("Normal");

    await typeButton(page, "Normal").click();
    await expect(page).toHaveURL(/[?&]type=normal(&|$)/);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
    await expect(page.getByTestId("kubernetes-event-type")).toHaveText(
      Array(11).fill("Normal"),
    );

    // The address opens the same view again.
    await page.reload();
    await expect(typeButton(page, "Normal")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
  });

  test("the namespace picker narrows the list on the server: a system namespace's warnings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);
    const before: number = (await logRequests(page)).length;

    await pick(page, "Namespace", "aks-istio-system");

    await expect(page).toHaveURL(/[?&]namespace=aks-istio-system(&|$)/);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(2);
    expect(await reasons(page)).toEqual([
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
    ]);
    await expect(page.getByTestId("kubernetes-event-namespace")).toHaveText([
      "aks-istio-system",
      "aks-istio-system",
    ]);
    // Two warnings and two Normal events in it.
    await expect(typeButton(page, "All")).toHaveText(/4/);

    const after: Array<LogRequest> = (await logRequests(page)).slice(before);
    expect(after.length).toBeGreaterThanOrEqual(2);
    for (const request of after) {
      expect(request.attributes["k8s.namespace.name"]).toBe("aks-istio-system");
    }

    await screenshot(page, "events-namespace-1280");
  });

  test("the kind and reason pickers narrow it to the autoscalers and one reason", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    await pick(page, "Kind", "HorizontalPodAutoscaler");
    await expect(page).toHaveURL(/[?&]kind=HorizontalPodAutoscaler(&|$)/);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(4);
    for (const object of await page
      .getByTestId("kubernetes-event-object")
      .allTextContents()) {
      expect(object).toContain("HorizontalPodAutoscaler");
    }

    await pick(page, "Reason", "FailedComputeMetricsReplicas");
    await expect(page).toHaveURL(
      /[?&]reason=FailedComputeMetricsReplicas(&|$)/,
    );
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(2);
    await expect(page.getByTestId("kubernetes-event-namespace")).toHaveText([
      "aks-istio-system",
      "app-routing-system",
    ]);

    const last: LogRequest = await lastLogRequest(page);
    expect(last.attributes).toMatchObject({
      "k8s.object.kind": "HorizontalPodAutoscaler",
      "k8s.event.reason": "FailedComputeMetricsReplicas",
    });
  });

  test("a link names the view it opens: a namespace's warnings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "type=warning&namespace=app-routing-system");

    await expect(typeButton(page, "Warnings")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(2);
    await expect(page.getByTestId("kubernetes-event-object")).toHaveText([
      /nginx/,
      /nginx/,
    ]);
  });

  test("filters that match nothing say so, and Clear Filters brings every warning back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "namespace=no-such-namespace");

    await expect(
      page.getByTestId("kubernetes-events-empty-filtered"),
    ).toBeVisible();
    await page.getByTestId("empty-table-clear-filters-button").click();

    await expect(page).not.toHaveURL(/namespace=/);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
  });

  test("an object's link opens its page, whose Events tab shows its warnings", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    await rowsOf(page, "FailedGetResourceMetric", "nginx")
      .getByTestId("kubernetes-event-object")
      .getByRole("link", { name: "nginx" })
      .click();

    await expect(page).toHaveURL(`${CLUSTER_PATH}/hpas/nginx`);
    const tab: Locator = page.getByTestId("tab-Events");
    await expect(tab.locator("span")).toHaveText("2");
  });

  test("a busy cluster: every warning still shows, and the full list says it holds the newest", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "busy=1");

    // 1,500 Normal events in the last minutes, more than a read takes.
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(10);
    for (const [reason, object] of [
      ["OOMKilling", USER_POOL_NODE],
      ["OOMKilling", AGENT_POOL_NODE],
      ["FailedGetResourceMetric", "istiod"],
      ["FailedComputeMetricsReplicas", "istiod"],
      ["FailedGetResourceMetric", "nginx"],
      ["FailedComputeMetricsReplicas", "nginx"],
    ]) {
      await expect(rowsOf(page, reason!, object!).first()).toBeVisible();
    }
    await expect(typeButton(page, "Warnings")).toHaveText(/10/);
    await expect(page.getByTestId("kubernetes-events-more-note")).toHaveCount(
      0,
    );

    // The full list is the newest records of the range, and says so.
    await typeButton(page, "All").click();
    await expect(page.getByTestId("kubernetes-events-more-note")).toBeVisible();
    await expect(typeButton(page, "All")).toHaveText(/^All$/);
  });

  test("a cluster with no warnings opens on every event, and its Warnings view says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "events=normal-only");

    await expect(typeButton(page, "All")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);

    await typeButton(page, "Warnings").click();
    await expect(
      page.getByTestId("kubernetes-events-empty-warnings"),
    ).toBeVisible();
    await expect(
      page.getByText("No warnings in this time range"),
    ).toBeVisible();

    await page.getByTestId("kubernetes-events-show-all").click();
    await expect(typeButton(page, "All")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
  });

  test("a cluster that sent no events yet says where they come from", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "events=none");

    await expect(page.getByTestId("kubernetes-events-empty")).toBeVisible();
    await expect(page.getByText("No events in this time range")).toBeVisible();
  });

  test("a read that fails says so, and Try again reads again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "fail=events");

    await expect(page.getByTestId("kubernetes-events-error")).toBeVisible();
    await page.getByTestId("refresh-button").click();

    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
  });
});

test.describe("where else a cluster's warnings show", () => {
  test("the side menu lists Events beside Logs, open without unfolding anything", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    const telemetry: Locator = page.getByRole("button", {
      name: "Telemetry",
      exact: true,
    });
    await expect(telemetry).toHaveAttribute("aria-expanded", "true");
    // React's ids hold colons: matched by attribute, not as a #selector.
    const body: Locator = page.locator(
      `[id="${await telemetry.getAttribute("aria-controls")}"]`,
    );
    const links: Array<string> = (
      await body.getByRole("link").allInnerTexts()
    ).map((text: string) => {
      return text.trim();
    });

    expect(links).toContain("Logs");
    expect(links.indexOf("Events")).toBe(links.indexOf("Logs") + 1);

    const events: Locator = body.getByRole("link", { name: "Events" });
    await expect(events).toBeVisible();
    await expect(events).toHaveAttribute("href", EVENTS_PAGE);
  });

  test("a node's Events tab counts its warnings before it is opened, and opens on them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}`);

    const tab: Locator = page.getByTestId("tab-Events");
    const badge: Locator = tab.locator("span");
    await expect(badge).toHaveText("2");
    // In the warning colour.
    await expect(badge).toHaveClass(/bg-yellow-500/);

    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}`,
    );
    await expect(typeButton(panel, "Warnings")).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(2);
    expect(await reasons(panel)).toEqual(["OOMKilling", "OOMKilling"]);
    await expect(panel.getByTestId("kubernetes-event-count")).toHaveText([
      "2",
      "1",
    ]);
    await expect(
      panel.getByTestId("kubernetes-event-source").first(),
    ).toHaveText(`Reported by kernel-monitor · ${AGENT_POOL_NODE}`);
    // About this node only: no Object column to repeat it.
    await expect(panel.getByTestId("kubernetes-event-object")).toHaveCount(0);

    // Asked for this node's Events, by kind and name.
    const read: LogRequest = await lastLogRequest(page);
    expect(read.attributes).toMatchObject({
      "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
      "k8s.object.kind": "Node",
      "k8s.object.name": AGENT_POOL_NODE,
    });

    await screenshot(page, "node-events-1280");
  });

  test("a node with a warning and a Normal event: All shows both", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/nodes/${USER_POOL_NODE}`,
    );

    await expect(page.getByTestId("tab-Events").locator("span")).toHaveText(
      "1",
    );
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(1);

    await typeButton(panel, "All").click();
    expect(await reasons(panel)).toEqual(["OOMKilling", "RegisteredNode"]);
  });

  test("an HPA's Events tab: its two warnings in aks-istio-system, three times each", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/hpas/istiod`,
    );

    await expect(page.getByTestId("tab-Events").locator("span")).toHaveText(
      "2",
    );
    expect(await reasons(panel)).toEqual([
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
    ]);
    await expect(panel.getByTestId("kubernetes-event-count")).toHaveText([
      "3",
      "3",
    ]);
    await expect(
      panel.getByTestId("kubernetes-event-source").first(),
    ).toHaveText("Reported by horizontal-pod-autoscaler");

    // Its rescale, a Normal event, is one click away.
    await typeButton(panel, "All").click();
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(3);
    expect(await reasons(panel)).toContain("SuccessfulRescale");

    const read: LogRequest = await lastLogRequest(page);
    expect(read.attributes).toMatchObject({
      "k8s.object.kind": "HorizontalPodAutoscaler",
      "k8s.object.name": "istiod",
      "k8s.namespace.name": "aks-istio-system",
    });

    await screenshot(page, "hpa-events-1280");
  });

  test("a Deployment's Events tab includes its pods' crash loop, never a neighbour whose name starts the same", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/deployments/checkout`,
    );

    await expect(page.getByTestId("tab-Events").locator("span")).toHaveText(
      "2",
    );
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(2);
    await expect(rowsOf(panel, "BackOff", CHECKOUT_POD)).toHaveCount(1);
    await expect(
      rowsOf(panel, "BackOff", CHECKOUT_POD).getByTestId(
        "kubernetes-event-count",
      ),
    ).toHaveText("14");
    await expect(rowsOf(panel, "Unhealthy", CHECKOUT_POD)).toHaveCount(1);
    await expect(panel.getByText(NEIGHBOUR_POD)).toHaveCount(0);

    // Its own, its ReplicaSet's and its pods' Normal events.
    await typeButton(panel, "All").click();
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(7);
    const objects: Array<string> = await panel
      .getByTestId("kubernetes-event-object")
      .allTextContents();
    expect(
      objects.some((text: string) => {
        return text.startsWith("Deployment");
      }),
    ).toBe(true);
    expect(
      objects.some((text: string) => {
        return text.startsWith("ReplicaSet");
      }),
    ).toBe(true);
    expect(
      objects.filter((text: string) => {
        return text.startsWith("Pod");
      }).length,
    ).toBeGreaterThan(0);

    const read: LogRequest = await lastLogRequest(page);
    expect(read.operators).toMatchObject({
      "k8s.object.kind": "Includes",
      "k8s.object.name": "StartsWith",
    });
    expect(read.attributes["k8s.namespace.name"]).toBe("shop");
  });

  test("a namespace's Events tab: every event in it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/namespaces/aks-istio-system`,
    );

    await expect(page.getByTestId("tab-Events").locator("span")).toHaveText(
      "2",
    );
    await typeButton(panel, "All").click();
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(4);

    const read: LogRequest = await lastLogRequest(page);
    expect(read.attributes["k8s.namespace.name"]).toBe("aks-istio-system");
    expect(read.attributes["k8s.object.kind"]).toBeUndefined();
  });

  test("an Events tab whose read fails says so, and Try again reads again", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}?fail=events`,
    );

    await expect(
      panel.getByTestId("kubernetes-events-tab-error"),
    ).toBeVisible();
    await panel.getByTestId("refresh-button").click();
    await expect(panel.getByTestId("kubernetes-event")).toHaveCount(2);
  });

  test("an object Kubernetes said nothing about: its tab says so, with no count on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    const panel: Locator = await openEventsTab(
      page,
      `${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}?events=none`,
    );

    await expect(
      panel.getByTestId("kubernetes-events-tab-empty"),
    ).toBeVisible();
    await expect(page.getByTestId("tab-Events").locator("span")).toHaveCount(0);
  });

  test("the Overview lists the newest warnings near the top, and View all warnings opens them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);

    const card: Locator = page.getByTestId("kubernetes-recent-warnings");
    await expect(card).toBeVisible();
    const lines: Locator = card.getByTestId("kubernetes-recent-warning");
    await expect(lines).toHaveCount(5);
    await expect(
      card.getByTestId("kubernetes-recent-warning-reason"),
    ).toHaveText([
      "BackOff",
      "FailedComputeMetricsReplicas",
      "FailedGetResourceMetric",
      "Unhealthy",
      "BackOff",
    ]);
    await expect(
      lines.first().getByTestId("kubernetes-recent-warning-count"),
    ).toHaveText("14 times");
    await expect(
      lines.nth(1).getByTestId("kubernetes-recent-warning-namespace"),
    ).toHaveText("aks-istio-system");
    await expect(
      lines.nth(1).getByTestId("kubernetes-recent-warning-source"),
    ).toHaveText("Reported by horizontal-pod-autoscaler");

    // Right after what is open on the cluster, above the Workloads card.
    const warningsTop: number = (await card.boundingBox())!.y;
    const workloadsTop: number = (await page
      .getByText("Explore workload resources in this cluster.")
      .boundingBox())!.y;
    expect(warningsTop).toBeLessThan(workloadsTop);

    // Read from the cluster's warnings alone.
    const read: LogRequest = await lastLogRequest(page);
    expect(read.attributes).toMatchObject({
      "resource.k8s.cluster.name": CLUSTER_IDENTIFIER,
      "k8s.event.type": "Warning",
    });

    await page.getByTestId("kubernetes-recent-warnings-view-all").click();
    await expect(page).toHaveURL(EVENTS_PAGE);
    await expect(typeButton(page, "Warnings")).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  test("a cluster with no warnings: no Recent Warnings on its Overview", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(withQuery(CLUSTER_PATH, "events=normal-only"));
    await expect(page.getByText("Cluster Details").first()).toBeVisible();
    // The warnings read has answered: there is nothing to say.
    await expect
      .poll(async () => {
        return (await logRequests(page)).length;
      })
      .toBeGreaterThan(0);
    await expect(page.getByTestId("kubernetes-recent-warnings")).toHaveCount(0);
    await expect(page.getByText("Recent Warnings")).toHaveCount(0);
  });
});

test.describe("at a laptop's and a phone's width, light and dark", () => {
  for (const width of [1280, 390]) {
    for (const theme of ["light", "dark"]) {
      test(`the Events page, a node's tab and the Overview's warnings at ${width}px, ${theme}`, async ({
        page,
      }: {
        page: Page;
      }) => {
        await page.setViewportSize({ width: width, height: 900 });
        const themeQuery: string = theme === "dark" ? "theme=dark" : "";

        await openEventsPage(page, themeQuery);
        await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
        await expect(typeButtons(page)).toBeVisible();
        await expect(
          page.getByRole("combobox", { name: "Namespace" }),
        ).toBeVisible();
        await expectNoSidewaysScroll(page);

        const message: Locator = page
          .getByTestId("kubernetes-event-message")
          .first();
        // The card's frame, which carries its surface colour.
        const card: Locator = page
          .getByTestId("kubernetes-events-view")
          .getByTestId("card")
          .first()
          .locator(":scope > div")
          .first();

        if (theme === "dark") {
          await expect(page.locator("html")).toHaveClass(/dark/);
          // A slate card and light words on it.
          expect(await lightness(card, "background-color")).toBeLessThan(0.25);
          expect(await lightness(message, "color")).toBeGreaterThan(0.6);
        } else {
          expect(await lightness(card, "background-color")).toBeGreaterThan(
            0.95,
          );
          expect(await lightness(message, "color")).toBeLessThan(0.5);
        }

        await screenshot(page, `events-${width}-${theme}`);

        // The Warning pill, drawn where All mixes the two types.
        await typeButton(page, "All").click();
        await expect(page.getByTestId("kubernetes-event")).toHaveCount(22);
        const pill: Locator = page.getByTestId("kubernetes-event-type").first();
        await expect(pill).toHaveText("Warning");
        await expect(pill).not.toHaveClass(/sr-only/);

        if (theme === "dark") {
          // An amber pill that is not a pale one.
          expect(await lightness(pill, "background-color")).toBeLessThan(0.45);
        } else {
          expect(await lightness(pill, "background-color")).toBeGreaterThan(
            0.85,
          );
        }
        await expectNoSidewaysScroll(page);

        await openEventsTab(
          page,
          withQuery(`${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}`, themeQuery),
        );
        await expect(
          page.getByRole("tabpanel").getByTestId("kubernetes-event"),
        ).toHaveCount(2);
        await expectNoSidewaysScroll(page);
        await screenshot(page, `node-events-${width}-${theme}`);

        await page.goto(withQuery(CLUSTER_PATH, themeQuery));
        const warnings: Locator = page.getByTestId(
          "kubernetes-recent-warnings",
        );
        await expect(warnings).toBeVisible();
        await expect(
          warnings.getByTestId("kubernetes-recent-warning"),
        ).toHaveCount(5);
        await warnings.scrollIntoViewIfNeeded();
        await expectNoSidewaysScroll(page);
        await screenshot(page, `overview-warnings-${width}-${theme}`);
      });
    }
  }
});

/*
 * The table itself, measured (the UI review): the message is what a reader
 * came for, so the Event column takes the room - the namespace sits beside
 * the object's name rather than in a column of its own, which left the
 * message a narrow strip at 1280px and pushed the table past its card at
 * 1024px - and a view of one type does not say it on every row. On a phone
 * each event is one card that reads like the Overview's Recent Warnings.
 */
test.describe("the Events table at every width", () => {
  /*
   * How many lines each element's words take: the text's own boxes, by
   * their distinct tops. A block (a picker's placeholder) has one box
   * however many lines it wraps to, so its text is measured, not it.
   */
  async function lineCounts(locator: Locator): Promise<Array<number>> {
    return await locator.evaluateAll((elements: Array<Element>) => {
      return elements.map((element: Element): number => {
        const range: Range = document.createRange();
        range.selectNodeContents(element);
        const tops: Array<number> = Array.from(range.getClientRects())
          .filter((rect: DOMRect): boolean => {
            return rect.width > 0;
          })
          .map((rect: DOMRect): number => {
            return rect.top;
          })
          .sort((a: number, b: number): number => {
            return a - b;
          });
        // Two boxes of one line can sit a pixel or two apart; lines, a line's height.
        let lines: number = tops.length > 0 ? 1 : 0;
        for (let index: number = 1; index < tops.length; index++) {
          if (tops[index]! - tops[index - 1]! > 6) {
            lines++;
          }
        }
        return lines;
      });
    });
  }

  async function headerWidths(page: Page): Promise<Record<string, number>> {
    return await page
      .locator("#kubernetes-events-table-header th")
      .evaluateAll((cells: Array<Element>) => {
        const widths: Record<string, number> = {};
        for (const cell of cells) {
          widths[(cell.textContent || "").trim()] =
            cell.getBoundingClientRect().width;
        }
        return widths;
      });
  }

  for (const width of [1280, 1024]) {
    test(`at ${width}px the four columns fit the card, the Event column the widest, every reason on one line`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 900 });
      await openEventsPage(page);
      await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);

      // Event, Object, Count, Last seen: no Namespace column.
      const widths: Record<string, number> = await headerWidths(page);
      expect(Object.keys(widths)).toEqual([
        "Event",
        "Object",
        "Count",
        "Last seen",
      ]);
      expect(widths["Event"]!).toBeGreaterThan(widths["Object"]!);
      if (width === 1280) {
        // A message reads in lines of 400px and more beside the side menu.
        expect(widths["Event"]!).toBeGreaterThan(400);
      }

      // Nothing scrolls sideways inside the card.
      await expect(page.getByTestId("table-scroll")).toHaveAttribute(
        "data-overflowing",
        "false",
      );
      await expectNoSidewaysScroll(page);

      // FailedComputeMetricsReplicas is never broken mid-word.
      expect(
        await lineCounts(page.getByTestId("kubernetes-event-reason")),
      ).toEqual(Array(11).fill(1));

      await screenshot(page, `events-table-${width}`);
    });
  }

  /*
   * Beside the cluster's side menu at 768px the card is 478px wide, and the
   * four columns needed 680px: the rows scrolled under the sticky last
   * column. Below lg, how many times and when go in the Event's own lines,
   * as on a phone's card, and Event and Object fit the card.
   */
  for (const width of [768, 900]) {
    test(`at ${width}px Count and Last seen go in the Event's lines, and Event and Object fit the card`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({ width: width, height: 900 });
      await openEventsPage(page);
      await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);

      const widths: Record<string, number> = await headerWidths(page);
      expect(Object.keys(widths)).toEqual(["Event", "Object"]);
      expect(widths["Event"]!).toBeGreaterThan(widths["Object"]!);

      await expect(page.getByTestId("table-scroll")).toHaveAttribute(
        "data-overflowing",
        "false",
      );
      await expectNoSidewaysScroll(page);

      // Still a table's rows, not a phone's cards.
      await expect(
        page.locator("#kubernetes-events-table-header"),
      ).toBeVisible();

      const backOff: Locator = page
        .getByTestId("kubernetes-event")
        .filter({
          has: page
            .getByTestId("kubernetes-event-reason")
            .getByText("BackOff", { exact: true }),
        })
        .filter({ hasText: CHECKOUT_POD });
      await expect(backOff).toHaveCount(1);

      // How many times, and when - each once in the row, in the Event.
      await expect(backOff.getByTestId("kubernetes-event-count")).toHaveText(
        "14 times",
      );
      await expect(
        backOff.getByTestId("kubernetes-event-last-seen"),
      ).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
      const row: Locator = page.locator("tr").filter({ has: backOff });
      await expect(row.getByTestId("kubernetes-event-count")).toHaveCount(1);
      await expect(row.getByTestId("kubernetes-event-last-seen")).toHaveCount(
        1,
      );

      // When, at the end of the reason's line.
      const reason: { x: number; y: number; height: number } = (await backOff
        .getByTestId("kubernetes-event-reason")
        .boundingBox())!;
      const when: { x: number; y: number; height: number } = (await backOff
        .getByTestId("kubernetes-event-last-seen")
        .boundingBox())!;
      expect(when.x).toBeGreaterThan(reason.x + 60);
      expect(
        Math.abs(when.y + when.height / 2 - (reason.y + reason.height / 2)),
      ).toBeLessThan(6);

      // The object keeps its column: not drawn again in the Event.
      await expect(backOff.getByTestId("kubernetes-event-object")).toHaveCount(
        0,
      );
      await expect(row.getByTestId("kubernetes-event-object")).toHaveCount(1);

      // FailedComputeMetricsReplicas is never broken mid-word.
      expect(
        await lineCounts(page.getByTestId("kubernetes-event-reason")),
      ).toEqual(Array(11).fill(1));

      await screenshot(page, `events-table-${width}`);
    });
  }

  test("a window made wider than lg and narrower again moves Count and Last seen between their columns and the Event", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 900, height: 900 });
    await openEventsPage(page);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
    expect(Object.keys(await headerWidths(page))).toEqual(["Event", "Object"]);

    await page.setViewportSize({ width: 1280, height: 900 });
    await expect
      .poll(async (): Promise<Array<string>> => {
        return Object.keys(await headerWidths(page));
      })
      .toEqual(["Event", "Object", "Count", "Last seen"]);
    // In their columns now, not in the Event's lines as well.
    await expect(
      page
        .getByTestId("kubernetes-event")
        .getByTestId("kubernetes-event-last-seen"),
    ).toHaveCount(0);
    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );

    await page.setViewportSize({ width: 768, height: 900 });
    await expect
      .poll(async (): Promise<Array<string>> => {
        return Object.keys(await headerWidths(page));
      })
      .toEqual(["Event", "Object"]);
    await expect(page.getByTestId("table-scroll")).toHaveAttribute(
      "data-overflowing",
      "false",
    );
  });

  test("the namespace sits beside the object's name, in the Object column", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    const istiod: Locator = rowsOf(page, "FailedGetResourceMetric", "istiod");
    const object: Locator = istiod.getByTestId("kubernetes-event-object");
    await expect(object.getByTestId("kubernetes-event-namespace")).toHaveText(
      "aks-istio-system",
    );
    // On the name's line: the chip's middle is within the link's line.
    const link: { y: number; height: number } = (await object
      .getByRole("link", { name: "istiod" })
      .boundingBox())!;
    const chip: { y: number; height: number } = (await object
      .getByTestId("kubernetes-event-namespace")
      .boundingBox())!;
    const chipMiddle: number = chip.y + chip.height / 2;
    expect(chipMiddle).toBeGreaterThan(link.y);
    expect(chipMiddle).toBeLessThan(link.y + link.height);
  });

  test("the Warnings do not say Warning on every row; All says Warning or Normal on each", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    // Kept for screen readers, drawn for no one.
    const types: Locator = page.getByTestId("kubernetes-event-type");
    await expect(types).toHaveCount(11);
    for (const type of await types.all()) {
      await expect(type).toHaveClass(/sr-only/);
    }

    await typeButton(page, "All").click();
    await expect(types).toHaveCount(22);
    for (const type of await types.all()) {
      await expect(type).not.toHaveClass(/sr-only/);
    }
    await expect(
      rowsOf(page, "RegisteredNode", USER_POOL_NODE).getByTestId(
        "kubernetes-event-type",
      ),
    ).toHaveText("Normal");
  });

  test("at 768px, beside the side menu, the pickers wrap rather than squeeze their words onto two lines", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 768, height: 900 });
    await openEventsPage(page);

    const placeholders: Locator = page
      .getByTestId("kubernetes-events-filters")
      .locator(".ou-select__placeholder");
    await expect(placeholders).toHaveCount(3);
    expect(await lineCounts(placeholders)).toEqual([1, 1, 1]);
    await expectNoSidewaysScroll(page);
  });

  test("on a phone each event is one card: the reason and when, the message, the object, its namespace, how many times, who reported it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openEventsPage(page);
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);

    const backOff: Locator = page
      .getByTestId("kubernetes-event")
      .filter({
        has: page
          .getByTestId("kubernetes-event-reason")
          .getByText("BackOff", { exact: true }),
      })
      .filter({ hasText: CHECKOUT_POD });
    await expect(backOff).toHaveCount(1);

    await expect(
      backOff.getByTestId("kubernetes-event-last-seen"),
    ).toHaveAttribute("datetime", /^\d{4}-\d{2}-\d{2}T/);
    await expect(backOff.getByTestId("kubernetes-event-message")).toContainText(
      "Back-off restarting failed container checkout",
    );
    await expect(
      backOff.getByTestId("kubernetes-event-object").getByRole("link", {
        name: CHECKOUT_POD,
      }),
    ).toHaveAttribute("href", `${CLUSTER_PATH}/pods/${CHECKOUT_POD}`);
    await expect(backOff.getByTestId("kubernetes-event-namespace")).toHaveText(
      "shop",
    );
    await expect(backOff.getByTestId("kubernetes-event-count")).toHaveText(
      "14 times",
    );
    await expect(backOff.getByTestId("kubernetes-event-source")).toContainText(
      "Reported by kubelet",
    );

    // The reason and when on one line, at the card's two ends.
    const reason: { x: number; y: number; height: number } = (await backOff
      .getByTestId("kubernetes-event-reason")
      .boundingBox())!;
    const when: { x: number; y: number; height: number } = (await backOff
      .getByTestId("kubernetes-event-last-seen")
      .boundingBox())!;
    expect(when.x).toBeGreaterThan(reason.x + 100);
    expect(
      Math.abs(when.y + when.height / 2 - (reason.y + reason.height / 2)),
    ).toBeLessThan(6);

    // No "Event" over every card: its name is for screen readers alone.
    const cards: Locator = page.getByTestId("table-content");
    const terms: Locator = cards.getByRole("term");
    await expect(terms).toHaveCount(11);
    for (const term of await terms.all()) {
      await expect(term).toHaveClass(/sr-only/);
    }
    await expect(terms.filter({ hasText: "Object" })).toHaveCount(0);
    await expect(terms.filter({ hasText: "Count" })).toHaveCount(0);
    await expectNoSidewaysScroll(page);

    await screenshot(page, "events-cards-390");
  });
});

test.describe("in German", () => {
  test("the Events page and a node's tab read in German, nothing cut off on a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 900 });
    await openEventsPage(page, "lang=de");

    await expect(
      typeButton(page, GERMAN["Warnings"]!, GERMAN["Event type"]!),
    ).toHaveAttribute("aria-checked", "true");
    await expect(
      page.getByRole("combobox", { name: GERMAN["Namespace"] || "Namespace" }),
    ).toBeVisible();
    await expect(page.getByText(GERMAN["All namespaces"]!)).toBeVisible();
    await expect(page.getByTestId("kubernetes-event")).toHaveCount(11);
    await expectNoSidewaysScroll(page);
    await screenshot(page, "events-390-de");

    await page.goto(
      withQuery(`${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}`, "lang=de"),
    );
    await page.getByTestId("tab-Events").click();
    await expect(
      page.getByRole("tabpanel").getByTestId("kubernetes-event"),
    ).toHaveCount(2);
    await expectNoSidewaysScroll(page);
  });
});

/*
 * Follow-up of #5201: being told when Kubernetes warns. The Events page
 * ends with whether the cluster's warnings raise alerts: the monitor that
 * alerts on them, or - with none - a link that opens the cluster's
 * Recommendations with the Warning Events alert (a Logs monitor over the
 * cluster's warning events) selected, so one Create turns it on.
 */
test.describe("being told when Kubernetes warns", () => {
  const WARNING_EVENTS: string = "Kubernetes:k8s-warning-events";
  const RECOMMENDATIONS_PAGE: string = `${CLUSTER_PATH}/recommendations`;

  test("nothing alerts on the warnings yet: the Events page ends by offering it, under the list", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);

    const line: Locator = page.getByTestId("kubernetes-warning-alerts");
    await expect(line).toHaveText(
      "Get an alert when Kubernetes reports a warning. Turn on warning alerts",
    );

    // Inside the Events card, after the list of events.
    const card: Locator = page.getByTestId("kubernetes-events-view");
    await expect(card.getByTestId("kubernetes-warning-alerts")).toHaveCount(1);
    const lineBox: { y: number } | null = await line.boundingBox();
    const filtersBox: { y: number; height: number } | null = await page
      .getByTestId("kubernetes-events-filters")
      .boundingBox();
    expect(lineBox!.y).toBeGreaterThan(filtersBox!.y + filtersBox!.height);

    await expect(
      line.getByTestId("kubernetes-warning-alerts-turn-on"),
    ).toHaveAttribute(
      "href",
      `${RECOMMENDATIONS_PAGE}?select=Kubernetes%3Ak8s-warning-events`,
    );
  });

  test("Turn on warning alerts opens the cluster's Recommendations with Warning Events selected, last, under Events", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);
    await page.getByTestId("kubernetes-warning-alerts-turn-on").click();

    await expect(page).toHaveURL(
      `${RECOMMENDATIONS_PAGE}?select=Kubernetes%3Ak8s-warning-events`,
    );

    const card: Locator = page.getByTestId(
      `recommendation-card-${WARNING_EVENTS}`,
    );
    await expect(card).toBeVisible();
    await expect(card).toContainText("Warning Events");
    await expect(card).toContainText(
      "Kubernetes reports a warning event: one alert per object and reason.",
    );
    await expect(
      page.getByTestId(`recommendation-card-select-${WARNING_EVENTS}`),
    ).toHaveAttribute("aria-pressed", "true");

    // Its own heading, Events, after every metric template's.
    const headings: Array<string> = await page.locator("h4").allTextContents();
    expect(headings[headings.length - 1]).toBe("Events");
    expect(headings).toEqual(
      expect.arrayContaining([
        "Workload",
        "Node",
        "Control Plane",
        "Storage",
        "Scheduling",
      ]),
    );

    await expect(card).toBeInViewport();
    await screenshot(page, "kubernetes-warning-events-recommendation");
  });

  test("the Events page reads the project's Logs monitors once, and nothing it does not model", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page);
    await expect(page.getByTestId("kubernetes-warning-alerts")).toBeVisible();

    const monitorReads: Array<{ query: Record<string, unknown> }> =
      await page.evaluate((): Array<{ query: Record<string, unknown> }> => {
        return (
          window as unknown as {
            __kubernetesEventsFixture: {
              listRequests: Array<{
                modelName: string;
                query: Record<string, unknown>;
              }>;
            };
          }
        ).__kubernetesEventsFixture.listRequests.filter(
          (request: { modelName: string }): boolean => {
            return request.modelName === "Monitor";
          },
        );
      });

    // The side menu's Recommendations count reads both kinds; the line, Logs.
    expect(
      monitorReads.filter((request: { query: Record<string, unknown> }) => {
        return request.query["monitorType"] === "Logs";
      }).length,
    ).toBeGreaterThanOrEqual(1);
  });

  test("a monitor alerts on the warnings: the line names it, and its Recommendation reads Created", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "alerting=on");

    const line: Locator = page.getByTestId("kubernetes-warning-alerts");
    await expect(line).toHaveText(
      "Warnings raise alerts through AKS Production (West Europe) - Warning Events.",
    );
    await expect(
      line.getByTestId("kubernetes-warning-alerts-monitor"),
    ).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/monitors/58000000-0000-4000-8000-000000000001`,
    );
    await expect(
      line.getByTestId("kubernetes-warning-alerts-turn-on"),
    ).toHaveCount(0);

    // The Recommendations count it as created: 1 of 18, under Already created.
    await page.goto(`${RECOMMENDATIONS_PAGE}?alerting=on`);
    await expect(
      page.getByText("1 of 18 recommended monitors created"),
    ).toBeVisible();
    await page
      .getByRole("button", {
        name: "Show the 1 recommendation that is already created",
      })
      .click();
    await expect(
      page.getByTestId(`recommendation-card-${WARNING_EVENTS}`),
    ).toContainText("Created");
  });

  test("that monitor turned off: the line offers the alerts again", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "alerting=disabled");

    await expect(page.getByTestId("kubernetes-warning-alerts")).toHaveText(
      "Get an alert when Kubernetes reports a warning. Turn on warning alerts",
    );
  });

  test("on a phone, light and dark, the line wraps inside the card", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const theme of ["", "theme=dark"]) {
      await page.setViewportSize({ width: 390, height: 844 });
      await openEventsPage(page, theme);

      const line: Locator = page.getByTestId("kubernetes-warning-alerts");
      await expect(line).toBeVisible();
      await expectNoSidewaysScroll(page);

      const lineBox: { x: number; width: number } | null =
        await line.boundingBox();
      expect(lineBox!.x).toBeGreaterThanOrEqual(0);
      expect(lineBox!.x + lineBox!.width).toBeLessThanOrEqual(390);

      // The link reads as a link in both themes: darker than its page in light, lighter in dark.
      const link: Locator = line.getByTestId(
        "kubernetes-warning-alerts-turn-on",
      );
      const linkLightness: number = await lightness(link, "color");
      if (theme) {
        expect(linkLightness).toBeGreaterThan(0.45);
      } else {
        expect(linkLightness).toBeLessThan(0.55);
      }
    }

    await screenshot(page, "kubernetes-warning-alerts-line-phone-dark");
  });

  test("in German, the line and its link read in German", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openEventsPage(page, "lang=de");

    await expect(page.getByTestId("kubernetes-warning-alerts")).toHaveText(
      `${GERMAN["Get an alert when Kubernetes reports a warning."]} ${GERMAN["Turn on warning alerts"]}`,
    );
  });
});

/*
 * Follow-up of #5201: a cluster's own pages - a node's, an HPA's - had no
 * entry in the cluster's side menu, so nothing in it was lit there, and on
 * a phone the menu's button said "Navigate to / Navigation". Such a page is
 * one of the rows its list shows: the list's entry stays lit there, says so
 * to a screen reader (aria-current="true": it holds the page), opens its
 * section if it is folded, and names the phone's button. The trail's last
 * crumb reads in the reader's language ("Knotendetails").
 */
test.describe("a cluster's own pages in its side menu", () => {
  function clusterMenu(page: Page): Locator {
    return page.locator("aside[role='navigation']");
  }

  test("on a node's page, Nodes is lit and holds the page; the trail ends on the node", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}`);
    const menu: Locator = clusterMenu(page);
    const nodes: Locator = menu.locator(`a[href='${CLUSTER_PATH}/nodes']`);

    await expect(nodes).toHaveAttribute("aria-current", "true", {
      timeout: 30000,
    });
    await expect(menu.locator("[aria-current]")).toHaveCount(1);
    await expect(nodes).toHaveClass(/bg-indigo-50/);
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .locator("[aria-current='page']"),
    ).toHaveText("Node Detail");
  });

  test("on an HPA's page in a short window, the folded Scaling opens and HPAs is lit, in sight inside the long menu", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto(`${CLUSTER_PATH}/hpas/istiod`);
    const menu: Locator = clusterMenu(page);
    const hpas: Locator = menu.locator(`a[href='${CLUSTER_PATH}/hpas']`);

    await expect(hpas).toHaveAttribute("aria-current", "true", {
      timeout: 30000,
    });
    await expect(
      menu.locator(
        "xpath=.//h6[normalize-space(.)='Scaling']/ancestor::button[1]",
      ),
    ).toHaveAttribute("aria-expanded", "true");

    const list: Locator = menu.locator("nav");
    await expect
      .poll(async (): Promise<boolean> => {
        return await list.evaluate((element: Element): boolean => {
          const lit: Element | null = element.querySelector("[aria-current]");
          if (!lit) {
            return false;
          }
          const listBox: DOMRect = element.getBoundingClientRect();
          const litBox: DOMRect = lit.getBoundingClientRect();
          return (
            litBox.top >= Math.max(listBox.top, 0) &&
            litBox.bottom <= Math.min(listBox.bottom, window.innerHeight)
          );
        });
      })
      .toBe(true);
    expect(
      await page.evaluate((): number => {
        return window.scrollY;
      }),
    ).toBe(0);
    await screenshot(page, "hpa-page-short-window-menu");
  });

  test("on a phone, in German, the button names Infrastruktur / Knoten and the trail Knotendetails", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(
      withQuery(`${CLUSTER_PATH}/nodes/${AGENT_POOL_NODE}`, "lang=de"),
    );
    const toggle: Locator = page.getByTestId("mobile-sidemenu-toggle");

    await expect(toggle.locator("h3")).toHaveText(
      `${GERMAN["Infrastructure"]} / ${GERMAN["Nodes"]}`,
      { timeout: 30000 },
    );
    await expect(toggle).not.toContainText("Navigation");
    expect(GERMAN["Node Detail"]).toBeTruthy();
    expect(GERMAN["Node Detail"]).not.toBe("Node Detail");
    await expect(
      page.locator("nav[aria-label] [aria-current='page']"),
    ).toHaveText(GERMAN["Node Detail"]!);
    await screenshot(page, "node-page-phone-de");
  });
});
