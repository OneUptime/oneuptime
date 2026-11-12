import { expect, Locator, Page, Route, test } from "@playwright/test";
import fsPromises from "fs/promises";
import path from "path";
import { expectCardsFit } from "../SuiteHelpers/CardBodyFit";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * OpenShift in the Kubernetes product (issue #5477), in a browser, against
 * the offline fixture (OpenShiftPages/Fixture).
 *
 * Read the way a person reads them: the menu growing only on a cluster that
 * has these objects; the Routes list with what each answers on, where it
 * sends traffic and how it terminates TLS; a Route that a router rejected
 * saying why; a canary's traffic split; a Route linked to its Service and
 * that Service back to the Route, staying in its namespace when another
 * namespace holds the same name; the DeploymentConfigs list with its pods'
 * CPU and memory; a DeploymentConfig's page, its Events tab counting its own
 * pods' warnings and no neighbour's, its Metrics tab reading its pods by
 * their label, its YAML; a pod that belongs to one leading back to it; at a
 * laptop's and a phone's width, light and dark. The fixture records every
 * read, so the tests check what was asked for as well as what was drawn, and
 * that nothing the fixture does not model was asked for at all.
 */

const PROJECT_ID: string = "10000000-0000-4000-8000-000000000001";
const CLUSTER_ID: string = "60000000-0000-4000-8000-000000000001";
const CLUSTER_PATH: string = `/dashboard/${PROJECT_ID}/kubernetes/${CLUSTER_ID}`;

const SCREENSHOTS: string = path.resolve(
  __dirname,
  "../../../output/playwright/openshift-pages-ui",
);

interface ListRequest {
  modelName: string;
  query: Record<string, unknown>;
}

interface AggregateRequest {
  name: string;
  attributes: Record<string, unknown>;
}

interface LogRequest {
  attributes: Record<string, unknown>;
}

interface Recorded {
  listRequests: Array<ListRequest>;
  aggregateRequests: Array<AggregateRequest>;
  logRequests: Array<LogRequest>;
  apiRequests: Array<{ url: string }>;
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
    const recorded: Recorded = await recordedBy(page);

    // Every read the page made is one the fixture answers as the server does.
    expect(recorded.unhandled).toEqual([]);
  }
});

async function recordedBy(page: Page): Promise<Recorded> {
  return await page.evaluate((): Recorded => {
    return (window as unknown as { __openShiftPagesFixture: Recorded })
      .__openShiftPagesFixture;
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

async function openPage(page: Page, relative: string): Promise<void> {
  await page.goto(`${CLUSTER_PATH}/${relative}`);
}

function tableRow(page: Page, text: string | RegExp): Locator {
  return page.locator("tbody tr").filter({ hasText: text }).first();
}

// A summary field's card: its title and its value.
function field(page: Page, title: string): Locator {
  return page
    .getByText(title, { exact: true })
    .locator("xpath=ancestor::div[contains(@class, 'rounded')][1]");
}

// A link to an object, as KubernetesResourceLink draws one.
function objectLink(scope: Locator | Page, name: string): Locator {
  return scope.locator(".cursor-pointer.font-medium").getByText(name, {
    exact: true,
  });
}

test.describe("the cluster's menu", () => {
  test("an OpenShift cluster shows DeploymentConfigs and Networking, with their counts", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);

    const menu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });

    await expect(
      menu.getByRole("link", { name: /DeploymentConfigs/ }),
    ).toContainText("3");
    await expect(menu.getByRole("link", { name: /Routes/ })).toContainText("5");
    await expect(menu.getByRole("link", { name: /Services/ })).toContainText(
      "5",
    );
    await expect(menu.getByText("Networking", { exact: true })).toBeVisible();
  });

  test("the Overview's quick links lead to them", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);

    await page
      .getByText("OpenShift's older way to roll out pods", { exact: true })
      .click();

    await expect(page).toHaveURL(
      new RegExp(`${CLUSTER_ID}/deploymentconfigs$`),
    );
  });

  test("any other cluster's menu is as it always was", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?cluster=plain`);

    const menu: Locator = page.getByRole("navigation", {
      name: "Main navigation",
    });

    await expect(menu.getByRole("link", { name: /Pods/ })).toBeVisible();
    await expect(
      menu.getByRole("link", { name: /DeploymentConfigs/ }),
    ).toHaveCount(0);
    await expect(menu.getByRole("link", { name: /Routes/ })).toHaveCount(0);
    await expect(menu.getByText("Networking", { exact: true })).toHaveCount(0);
  });

  test("a Route's own page keeps Routes lit and Networking open", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "routes/console?namespace=openshift-console");

    await expect(
      page
        .getByRole("navigation", { name: "Main navigation" })
        .getByRole("link", { name: /Routes/ }),
    ).toHaveAttribute("aria-current", "true");
  });
});

test.describe("Routes", () => {
  test.beforeEach(async ({ page }: { page: Page }) => {
    await openPage(page, "routes");
    await expect(
      tableRow(page, "console-openshift-console.apps.ocp.example.com"),
    ).toBeVisible();
  });

  test("lists what each answers on, where it goes, how it terminates TLS and its state", async ({
    page,
  }: {
    page: Page;
  }) => {
    const canary: Locator = tableRow(
      page,
      "frontend-shop.apps.ocp.example.com",
    );

    await expect(canary).toContainText("frontend, frontend-canary");
    await expect(canary).toContainText("Edge");
    await expect(canary).toContainText("Admitted");

    await expect(tableRow(page, "legacy-api")).toContainText("Rejected");
    await expect(tableRow(page, "legacy-api")).toContainText("None");
    await expect(tableRow(page, "new-launch")).toContainText("Pending");
    await expect(tableRow(page, "console")).toContainText("Re-encrypt");

    await screenshot(page, "routes");
  });

  test("shows no CPU or memory, which a Route does not have", async ({
    page,
  }: {
    page: Page;
  }) => {
    await expect(page.getByRole("columnheader", { name: /CPU/ })).toHaveCount(
      0,
    );
    await expect(
      page.getByRole("columnheader", { name: /Memory/ }),
    ).toHaveCount(0);
  });

  test("a rejected Route is red and an admitted one green", async ({
    page,
  }: {
    page: Page;
  }) => {
    await expect(
      tableRow(page, "legacy-api").getByText("Rejected", { exact: true }),
    ).toHaveClass(/text-red-700/);
    await expect(
      tableRow(page, "console").getByText("Admitted", { exact: true }),
    ).toHaveClass(/text-green-700/);
  });

  test("opens the Route of the row's own namespace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await tableRow(page, "frontend-payments.apps.ocp.example.com")
      .getByRole("link", { name: "frontend", exact: true })
      .click();

    await expect(page).toHaveURL(/\/routes\/frontend\?namespace=payments$/);
    await expect(
      page.getByRole("link", {
        name: "https://frontend-payments.apps.ocp.example.com/pay",
      }),
    ).toBeVisible();

    const recorded: Recorded = await recordedBy(page);
    const read: ListRequest | undefined = recorded.listRequests.find(
      (request: ListRequest): boolean => {
        return request.query["name"] === "frontend";
      },
    );

    expect(read?.query).toMatchObject({
      kind: "Route",
      name: "frontend",
      namespaceKey: "payments",
    });
  });
});

test.describe("a Route's page", () => {
  test("says where it answers and where it sends traffic, by weight", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "routes/frontend?namespace=shop");

    await expect(
      page.getByRole("link", {
        name: "https://frontend-shop.apps.ocp.example.com",
      }),
    ).toHaveAttribute("href", "https://frontend-shop.apps.ocp.example.com/");
    await expect(page.getByText("90%", { exact: true })).toBeVisible();
    await expect(page.getByText("10%", { exact: true })).toBeVisible();
    await expect(page.getByText("Redirect", { exact: true })).toBeVisible();
    await expect(
      page.getByText("Admitted (default)", { exact: true }),
    ).toBeVisible();

    await screenshot(page, "route-detail");
  });

  test("a plain HTTP Route's link says http, and rejected says why", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "routes/legacy-api?namespace=shop");

    await expect(
      page.getByRole("link", {
        name: "http://frontend-shop.apps.ocp.example.com",
      }),
    ).toBeVisible();
    await expect(page.getByText("Rejected", { exact: true })).toBeVisible();
    await expect(page.getByText("HostAlreadyClaimed").first()).toBeVisible();
    await expect(
      page.getByText(/route frontend already exposes/).first(),
    ).toBeVisible();
  });

  test("a Route no router has answered is pending, with nothing to say yet", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "routes/new-launch?namespace=shop");

    await expect(page.getByText("Pending", { exact: true })).toBeVisible();
  });

  test("links to its Service, in its own namespace, and the Service links back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "routes/frontend?namespace=payments");

    await objectLink(field(page, "Service"), "frontend").click();

    await expect(page).toHaveURL(/\/services\/frontend\?namespace=payments$/);
    await expect(page.getByText("172.30.90.7", { exact: true })).toBeVisible();
    await expect(page.getByText("172.30.14.2", { exact: true })).toHaveCount(0);

    await objectLink(field(page, "Routes"), "frontend").click();

    await expect(page).toHaveURL(/\/routes\/frontend\?namespace=payments$/);
  });

  test("its Events tab asks for this Route's Events, in its namespace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "routes/frontend?namespace=payments");
    await expect(page.getByRole("tab", { name: /Events/ })).toBeVisible();

    await expect
      .poll(async (): Promise<Array<LogRequest>> => {
        return (await recordedBy(page)).logRequests;
      })
      .not.toEqual([]);

    const recorded: Recorded = await recordedBy(page);

    expect(recorded.logRequests[0]?.attributes).toMatchObject({
      "k8s.object.kind": "Route",
      "k8s.object.name": "frontend",
      "k8s.namespace.name": "payments",
    });
  });

  test("its YAML tab reads the Route", async ({ page }: { page: Page }) => {
    await openPage(page, "routes/frontend?namespace=shop");
    await page.getByRole("tab", { name: "YAML" }).click();

    await expect(page.getByText("frontend-canary").first()).toBeVisible();
  });
});

test.describe("Services", () => {
  test("lists each with its type, address and ports", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "services");

    await expect(tableRow(page, "router-default")).toContainText(
      "LoadBalancer",
    );
    await expect(tableRow(page, "router-default")).toContainText(
      "80:31080→http/TCP",
    );
    await expect(tableRow(page, "console")).toContainText("443→8443/TCP");

    await screenshot(page, "services");
  });

  test("a Service's page names the Routes that send it traffic", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "services/frontend?namespace=shop");

    await expect(page.getByText("172.30.14.2", { exact: true })).toBeVisible();
    await expect(
      page.getByText("deploymentconfig=legacy-web", { exact: true }),
    ).toBeVisible();

    const routes: Locator = field(page, "Routes");

    await expect(routes.getByText("frontend", { exact: true })).toBeVisible();
    await expect(routes.getByText("legacy-api", { exact: true })).toBeVisible();
    // payments' `frontend` Route points at payments' Service, not this one.
    await expect(routes.getByText("frontend", { exact: true })).toHaveCount(1);

    await screenshot(page, "service-detail");
  });

  test("a load balancer's address shows", async ({ page }: { page: Page }) => {
    await openPage(page, "services/router-default?namespace=openshift-ingress");

    await expect(
      page.getByText("a1b2c3.eu-central-1.elb.amazonaws.com", { exact: true }),
    ).toBeVisible();
  });

  test("a Service no Route points at has no Routes field", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "services/router-default?namespace=openshift-ingress");

    await expect(page.getByText("172.30.200.9", { exact: true })).toBeVisible();
    await expect(page.getByText("Routes", { exact: true })).toHaveCount(1);
  });
});

test.describe("DeploymentConfigs", () => {
  test("lists each with its pods, its rollout and its state", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "deploymentconfigs");

    const available: Locator = tableRow(page, "3/3");

    await expect(tableRow(page, "reports")).toContainText("Scaled to zero");
    await expect(tableRow(page, "legacy-web-api")).toContainText("1/2");
    await expect(tableRow(page, "legacy-web-api")).toContainText("Recreate");
    // The cluster's own word for it, as the Deployments list says it.
    await expect(tableRow(page, "legacy-web-api")).toContainText("Rolling out");
    await expect(available).toContainText("3/3");
    await expect(available).toContainText("Available");

    await screenshot(page, "deploymentconfigs");
  });

  test("adds up each one's pods through the API's own owner kind", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "deploymentconfigs");
    await expect(tableRow(page, "reports")).toBeVisible();

    const recorded: Recorded = await recordedBy(page);

    expect(
      recorded.apiRequests.some((request: { url: string }): boolean => {
        return request.url.endsWith(
          `/latest-pod-metrics-by-owner/${CLUSTER_ID}/DeploymentConfig`,
        );
      }),
    ).toBe(true);
    await expect(tableRow(page, "3/3")).toContainText("12.5%");
  });
});

test.describe("a DeploymentConfig's page", () => {
  const LEGACY_WEB: string = "deploymentconfigs/legacy-web?namespace=shop";

  test("reads like a Deployment's", async ({ page }: { page: Page }) => {
    await openPage(page, LEGACY_WEB);

    await expect(page.getByText("3/3 ready", { exact: true })).toBeVisible();
    await expect(page.getByText("ConfigChange, ImageChange")).toBeVisible();
    await expect(page.getByText("Rolling", { exact: true })).toBeVisible();
    await expect(page.getByText("7", { exact: true }).first()).toBeVisible();
    await expect(
      page.getByText("deploymentconfig=legacy-web", { exact: true }),
    ).toBeVisible();

    await screenshot(page, "deploymentconfig-detail");
  });

  test("its Events tab counts its own pods' warnings and no neighbour's", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, LEGACY_WEB);

    const tab: Locator = page.getByRole("tab", { name: /Events/ });

    await expect(tab).toContainText("1");
    await tab.click();

    // Its own warning, its rollout's three Normal events, and nothing else.
    await expect(page.getByRole("radio", { name: /^All/ })).toContainText("4");
    await expect(page.getByRole("radio", { name: /^Warnings/ })).toContainText(
      "1",
    );
    await expect(page.getByRole("radio", { name: /^Normal/ })).toContainText(
      "3",
    );
    await expect(
      page.getByText("Back-off restarting failed container web"),
    ).toBeVisible();
    await expect(page.getByText("Readiness probe failed")).toHaveCount(0);

    await page.getByRole("radio", { name: /^All/ }).click();

    // The rollout's own: its controller, its pod and its deployer pod.
    await expect(
      page.getByText("Created new replication controller legacy-web-7"),
    ).toBeVisible();
    await expect(
      page.getByText("Created pod: legacy-web-7-x2x7q"),
    ).toBeVisible();
    await expect(
      page.getByText("Successfully assigned shop/legacy-web-7-deploy"),
    ).toBeVisible();
    await expect(page.getByText("Readiness probe failed")).toHaveCount(0);
  });

  test("a rollout's ReplicationController in the Events leads to the DeploymentConfig", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, LEGACY_WEB);
    await page.getByRole("tab", { name: /Events/ }).click();
    await page.getByRole("radio", { name: /^All/ }).click();

    await page.getByRole("link", { name: "legacy-web-7", exact: true }).click();

    await expect(page).toHaveURL(
      /\/deploymentconfigs\/legacy-web\?namespace=shop$/,
    );
  });

  test("its Metrics tab reads its pods by their label, in its namespace", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, LEGACY_WEB);
    await page.getByRole("tab", { name: "Metrics" }).click();

    await expect(page.getByText("Pod CPU Utilization").first()).toBeVisible();

    await expect
      .poll(async (): Promise<number> => {
        return (await recordedBy(page)).aggregateRequests.filter(
          (request: AggregateRequest): boolean => {
            return request.name === "k8s.pod.memory.usage";
          },
        ).length;
      })
      .toBeGreaterThan(0);

    const recorded: Recorded = await recordedBy(page);
    const read: AggregateRequest | undefined = recorded.aggregateRequests.find(
      (request: AggregateRequest): boolean => {
        return request.name === "k8s.pod.memory.usage";
      },
    );

    expect(read?.attributes).toMatchObject({
      "resource.k8s.cluster.name": "ocp-prod-eu",
      "resource.k8s.pod.label.deploymentconfig": "legacy-web",
      "resource.k8s.namespace.name": "shop",
    });
    expect(read?.attributes).not.toHaveProperty("resource.k8s.deployment.name");
  });

  test("a DeploymentConfig scaled to zero says so", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "deploymentconfigs/reports?namespace=payments");

    await expect(
      page.getByText("Scaled to zero", { exact: true }),
    ).toBeVisible();
  });
});

/*
 * What a card holds lines up with its title (#6956): the OpenShift card's
 * row of facts and the Overview's quick links and Pod Health bar sat in a
 * second padding. A healthy cluster's card ends at the card's padding, and
 * a failing update's card with its reason and its operators as well.
 */
test.describe("the Overview's cards line up with their titles", () => {
  test("healthy, and with a failing update to read, on a laptop and a phone", async ({
    page,
  }: {
    page: Page;
  }) => {
    for (const health of ["healthy", "failing"]) {
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.goto(`${CLUSTER_PATH}?health=${health}`);

      await expectCardsFit(page, [
        page.getByTestId("openshift-health-card"),
        page
          .getByTestId("card")
          .filter({ hasText: "Explore workload resources" }),
      ]);
    }
  });
});

test.describe("the Overview's OpenShift card", () => {
  function card(page: Page): Locator {
    return page.getByTestId("openshift-health-card");
  }

  function operators(page: Page): Locator {
    return card(page).getByTestId("openshift-operator");
  }

  // The hero's health pill: the first thing the page says about the cluster.
  function heroHealth(page: Page, words: string): Locator {
    return page.locator("span.rounded-full").filter({ hasText: words }).first();
  }

  test("a healthy cluster's card is one row, with nothing to review", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);

    await expect(card(page).getByTestId("openshift-version")).toContainText(
      "4.16.12",
    );
    await expect(card(page).getByTestId("openshift-version")).toContainText(
      "stable-4.16",
    );
    await expect(card(page).getByTestId("openshift-update")).toContainText(
      "Available",
    );
    await expect(card(page).getByTestId("openshift-update")).toContainText(
      "2 updates available",
    );
    await expect(card(page).getByTestId("openshift-operators")).toContainText(
      "12 of 12 healthy",
    );
    await expect(operators(page)).toHaveCount(0);
    await expect(heroHealth(page, "Healthy")).toBeVisible();

    await screenshot(page, "overview-healthy");
  });

  test("every operator is one press away, with its three conditions and version", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);

    await card(page)
      .getByRole("button", { name: "Show all 12 operators" })
      .click();

    await expect(operators(page)).toHaveCount(12);

    const first: Locator = operators(page).first();

    await expect(first).toContainText("authentication");
    await expect(first).toContainText("Available True");
    await expect(first).toContainText("Progressing False");
    await expect(first).toContainText("Degraded False");
    await expect(first).toContainText("4.16.12");

    await card(page)
      .getByRole("button", { name: "Show only those to review" })
      .click();

    await expect(operators(page)).toHaveCount(0);
  });

  test("a degraded operator comes first, says why, and turns the cluster Degraded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?health=degraded`);

    await expect(card(page).getByTestId("openshift-operators")).toContainText(
      "11 of 12 healthy",
    );
    await expect(operators(page)).toHaveCount(2);

    const first: Locator = operators(page).first();

    await expect(first).toContainText("authentication");
    await expect(first).toContainText("Degraded True");
    await expect(first).toContainText(
      "OAuthServerRouteEndpointAccessibleController_SyncError",
    );
    await expect(first).toContainText("the OAuth server's route answers 503");
    await expect(operators(page).nth(1)).toContainText("monitoring");
    await expect(operators(page).nth(1)).toContainText("Progressing True");

    await expect(heroHealth(page, "Degraded")).toBeVisible();

    await screenshot(page, "overview-degraded");
  });

  test("an unavailable operator turns the cluster Unhealthy", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?health=down`);

    await expect(operators(page).first()).toContainText("ingress");
    await expect(operators(page).first()).toContainText("Unavailable");
    await expect(operators(page).first()).toContainText("Available False");
    await expect(heroHealth(page, "Unhealthy")).toBeVisible();
  });

  test("an update under way says where to and since when, and is no failure", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?health=updating`);

    const update: Locator = card(page).getByTestId("openshift-update");

    await expect(update).toContainText("Updating");
    await expect(update).toContainText("Moving to 4.16.14");
    await expect(update).toContainText("Started");
    await expect(card(page).getByTestId("openshift-version")).toContainText(
      "4.16.12",
    );
    await expect(
      card(page).getByTestId("openshift-update-message"),
    ).toContainText("642 of 829 done");
    await expect(operators(page).first()).toContainText("machine-config");
    await expect(heroHealth(page, "Healthy")).toBeVisible();

    await screenshot(page, "overview-updating");
  });

  test("a failing update says why, and turns the cluster Degraded", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?health=failing`);

    await expect(card(page).getByTestId("openshift-update")).toContainText(
      "Failing",
    );
    await expect(
      card(page).getByTestId("openshift-update-message"),
    ).toContainText("ClusterOperatorDegraded");
    await expect(
      card(page).getByTestId("openshift-update-message"),
    ).toContainText("Cluster operator authentication is degraded");
    await expect(heroHealth(page, "Degraded")).toBeVisible();
  });

  test("the card reads this cluster's operators and version", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);
    await expect(card(page)).toBeVisible();

    const kinds: Array<unknown> = (await recordedBy(page)).listRequests
      .filter((request: ListRequest): boolean => {
        return request.modelName === "KubernetesResource";
      })
      .map((request: ListRequest): unknown => {
        return request.query["kind"];
      });

    expect(kinds).toContain("ClusterOperator");
    expect(kinds).toContain("ClusterVersion");
  });

  test("the words on the Overview stay inside their cards", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?health=degraded`);

    // One line: the longest word the tile says, at a laptop's width.
    const health: Locator = page.getByText("Degraded", { exact: true }).filter({
      has: page.locator("xpath=self::*[contains(@class, 'text-xl')]"),
    });

    await expect(health).toBeVisible();

    const lineHeight: number = await health.evaluate(
      (element: Element): number => {
        return parseFloat(getComputedStyle(element).lineHeight);
      },
    );

    expect((await health.boundingBox())!.height).toBeLessThanOrEqual(
      lineHeight + 1,
    );

    // The longest title of the quick links, and its count beside it.
    const link: Locator = page
      .getByText("OpenShift's older way to roll out pods", { exact: true })
      .locator("xpath=ancestor::div[contains(@class, 'rounded-xl')][1]");
    const count: Locator = link.locator("span.rounded-full");

    const linkBox: { x: number; width: number } = (await link.boundingBox())!;
    const countBox: { x: number; width: number } = (await count.boundingBox())!;

    expect(countBox.x + countBox.width).toBeLessThanOrEqual(
      linkBox.x + linkBox.width,
    );
  });

  test("the cluster's Platform reads OpenShift", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);

    await expect(
      page.getByText("OpenShift", { exact: true }).last(),
    ).toBeVisible();
  });

  test("any other cluster has no card, and pays for no read of one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${CLUSTER_PATH}?cluster=plain`);

    await expect(heroHealth(page, "Healthy")).toBeVisible();
    await expect(card(page)).toHaveCount(0);

    const kinds: Array<unknown> = (await recordedBy(page)).listRequests.map(
      (request: ListRequest): unknown => {
        return request.query["kind"];
      },
    );

    expect(kinds).not.toContain("ClusterOperator");
    expect(kinds).not.toContain("ClusterVersion");
  });

  test.describe("on a phone", () => {
    test.use({ viewport: { width: 390, height: 844 } });

    test("nothing scrolls sideways, however long the operator's message", async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.goto(`${CLUSTER_PATH}?health=degraded`);
      await expect(operators(page)).toHaveCount(2);

      await expectNoSidewaysScroll(page);
      await card(page).scrollIntoViewIfNeeded();
      await card(page).screenshot({
        path: path.join(SCREENSHOTS, "overview-card-phone-synthetic.png"),
      });
    });
  });

  test("dark mode", async ({ page }: { page: Page }) => {
    await page.goto(`${CLUSTER_PATH}?health=degraded&theme=dark`);
    await expect(operators(page)).toHaveCount(2);

    await card(page).screenshot({
      path: path.join(SCREENSHOTS, "overview-card-dark-synthetic.png"),
    });
  });
});

test.describe("the cluster's Recommendations", () => {
  const OPENSHIFT_ALERTS: Array<string> = [
    "Cluster Operator Unavailable",
    "Cluster Operator Degraded",
    "Cluster Update Failing",
  ];

  // What the menu's Recommendations entry says is left to do.
  async function menuCount(page: Page): Promise<number> {
    const entry: Locator = page
      .getByRole("navigation", { name: "Main navigation" })
      .getByRole("link", { name: /Recommendations/ });

    await expect(entry).toContainText(/[0-9]+/);

    return Number(((await entry.textContent()) || "").replace(/[^0-9]/g, ""));
  }

  test("an OpenShift cluster is offered OpenShift's alerts, under their own heading", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openPage(page, "recommendations");

    for (const alert of OPENSHIFT_ALERTS) {
      await expect(page.getByText(alert, { exact: true })).toBeVisible();
    }

    await expect(
      page.getByText("OpenShift", { exact: true }).first(),
    ).toBeVisible();

    await screenshot(page, "recommendations");
  });

  test("any other cluster is not", async ({ page }: { page: Page }) => {
    await page.goto(`${CLUSTER_PATH}/recommendations?cluster=plain`);

    await expect(
      page.getByText("Warning Events", { exact: true }),
    ).toBeVisible();

    for (const alert of OPENSHIFT_ALERTS) {
      await expect(page.getByText(alert, { exact: true })).toHaveCount(0);
    }
  });

  test("the menu's count agrees with what each cluster is offered", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(CLUSTER_PATH);
    const onOpenShift: number = await menuCount(page);

    await page.goto(`${CLUSTER_PATH}?cluster=plain`);
    const elsewhere: number = await menuCount(page);

    expect(onOpenShift - elsewhere).toBe(OPENSHIFT_ALERTS.length);
  });
});

test("an Event about a Service opens that Service, not a namesake in another namespace", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "events");

  await page
    .getByRole("link", { name: "frontend", exact: true })
    .first()
    .click();

  await expect(page).toHaveURL(/\/services\/frontend\?namespace=payments$/);
  await expect(page.getByText("172.30.90.7", { exact: true })).toBeVisible();
});

test("a pod of a DeploymentConfig is owned by it, not by a rollout's controller", async ({
  page,
}: {
  page: Page;
}) => {
  await openPage(page, "pods/legacy-web-7-x2x7q");

  await objectLink(page, "legacy-web").click();

  await expect(page).toHaveURL(
    /\/deploymentconfigs\/legacy-web\?namespace=shop$/,
  );
  await expect(page.getByText("3/3 ready", { exact: true })).toBeVisible();
});

test.describe("a phone", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  for (const [name, relative] of [
    ["routes", "routes"],
    ["route", "routes/frontend?namespace=shop"],
    ["services", "services"],
    ["service", "services/frontend?namespace=shop"],
    ["deploymentconfigs", "deploymentconfigs"],
    ["deploymentconfig", "deploymentconfigs/legacy-web?namespace=shop"],
  ] as Array<[string, string]>) {
    test(`the ${name} page never scrolls sideways`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await openPage(page, relative);
      await expect(page.getByText("Synthetic data")).toBeVisible();
      await page.waitForLoadState("networkidle");

      await expectNoSidewaysScroll(page);
      await screenshot(page, `${name}-phone`);
    });
  }
});

test("the pages read in German", async ({ page }: { page: Page }) => {
  await page.goto(`${CLUSTER_PATH}?health=degraded&lang=de`);

  const card: Locator = page.getByTestId("openshift-health-card");

  await expect(card.getByTestId("openshift-update")).toContainText(
    "Cluster-Update",
  );
  await expect(card.getByTestId("openshift-operators")).toContainText(
    "11 von 12 fehlerfrei",
  );
  await expect(
    card.getByRole("button", { name: "Alle 12 Operatoren anzeigen" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Netzwerk", level: 6 }),
  ).toBeVisible();

  await screenshot(page, "overview-german");
});

test("dark mode draws the pages on the dark surface", async ({
  page,
}: {
  page: Page;
}) => {
  await page.goto(`${CLUSTER_PATH}/routes/frontend?namespace=shop&theme=dark`);

  await expect(
    page.getByText("Admitted (default)", { exact: true }),
  ).toBeVisible();

  await screenshot(page, "route-detail-dark");
});
