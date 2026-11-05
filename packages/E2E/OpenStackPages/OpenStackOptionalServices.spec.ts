import { Locator, Page } from "@playwright/test";
import {
  VIEWPORTS,
  expect,
  openCloudPage,
  partPath,
  screenshot,
  test,
} from "./Helpers";
import { expectNoSidewaysScroll } from "../SuiteHelpers/PageFit";

/*
 * A service a cloud may not run, in a real browser through the real router, on what a real
 * stable/2026.1 DevStack recorded (Common/Tests/Fixtures/OpenStack/services-heat-magnum). What these
 * add to the jsdom suites (OpenStackOrchestrationPages.test.tsx) is what only a browser shows: that the
 * menu really has the entries or really doesn't, that each link really lands, and that every page
 * fits a phone.
 */

const WITHOUT_EITHER: string = "recording=gazpacho-ovs/healthy";
const HEAT: string = "recording=services-heat-magnum/heat-baseline";
const HEAT_DOWN: string = "recording=services-heat-magnum/heat-api-down";
const MAGNUM_FAILED: string = "recording=services-heat-magnum/magnum-failed";
const MAGNUM_DOWN: string = "recording=services-heat-magnum/magnum-api-down";
const BOTH_ON_A_WHOLE_CLOUD: string =
  "recording=gazpacho-ovs/healthy&also=services-heat-magnum/access/admin";
const REFUSED: string = "recording=services-heat-magnum/access/monitoring-role";

const FAILED_STACK: string = "8fb1dcc5-0685-434b-8e1a-bf0618776952";
const FAILED_CLUSTER: string = "df9f1548-93b9-444f-9001-605d49feda4e";

function sideMenuLink(page: Page, name: string): Locator {
  return page.getByRole("link", { name, exact: false });
}

function needsAttention(page: Page): Locator {
  return page.getByTestId("openstack-needs-attention");
}

test.describe("a cloud that runs neither", () => {
  test("its menu says nothing of them", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "", WITHOUT_EITHER);
    await expect(sideMenuLink(page, "Hypervisors").first()).toBeVisible();
    await expect(page.getByText("Orchestration", { exact: true })).toHaveCount(
      0,
    );
    await expect(sideMenuLink(page, "Stacks")).toHaveCount(0);
    await expect(sideMenuLink(page, "Kubernetes Clusters")).toHaveCount(0);
  });

  test("nor does its Services page", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "services", WITHOUT_EITHER);
    await expect(page.getByText("Compute (Nova)").first()).toBeVisible();
    await expect(page.getByText("Orchestration (Heat)")).toHaveCount(0);
    await expect(page.getByText("Kubernetes Clusters (Magnum)")).toHaveCount(0);
  });

  test("nor does what it is offered to alert on", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "recommendations", WITHOUT_EITHER);
    await expect(page.getByText("Compute API Down").first()).toBeVisible();
    await expect(page.getByText("Stack Failed")).toHaveCount(0);
    await expect(page.getByText("Kubernetes Cluster Failed")).toHaveCount(0);
    await expect(page.getByText("Orchestration API Down")).toHaveCount(0);
  });

  test("an old link says it doesn't run it, and is no error", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "stacks", WITHOUT_EITHER);
    await expect(
      page.getByText("This cloud doesn't run this service"),
    ).toBeVisible();
  });
});

test.describe("a cloud that runs Heat", () => {
  test("gets its stacks in the menu, and not a word of Magnum", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", HEAT);
    await expect(
      page.getByText("Orchestration", { exact: true }),
    ).toBeVisible();
    await expect(sideMenuLink(page, "Stacks").first()).toBeVisible();
    await expect(sideMenuLink(page, "Kubernetes Clusters")).toHaveCount(0);
  });

  test("a failed stack reaches Needs attention by name, and lands on its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", HEAT);
    const card: Locator = needsAttention(page);
    await expect(
      card.getByText("ou-stack-failed", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("ou-stack-admin-failed")).toBeVisible();
    await expect(card.getByText("ou-stack-ok")).toHaveCount(0);
    // The server Nova couldn't place for it reads on its own.
    await expect(
      card.getByText("ou-stack-failed-server-b2chjl4j7q3r"),
    ).toBeVisible();

    await card
      .getByRole("link", { name: /ou-stack-failed(?!-server)/ })
      .click();
    await expect(page.getByTestId("openstack-stack-overview")).toBeVisible();
    await expect(page).toHaveURL(new RegExp(`/stacks/${FAILED_STACK}`));
    await expect(page.getByTestId("openstack-stack-explanation")).toContainText(
      "until someone updates or deletes it",
    );
    await screenshot(page, "stack-failed");
  });

  test("the list holds every project's, each in Heat's word", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "stacks", HEAT);
    const row: Locator = page
      .locator("tr", { hasText: "ou-stack-failed" })
      .first();
    await expect(row).toContainText("CREATE_FAILED");
    await screenshot(page, "stacks");
  });

  test("a stack's page says what the agent can't see", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${partPath("stacks", FAILED_STACK)}?${HEAT}`);
    await expect(
      page.getByTestId("openstack-stack-why-not-known"),
    ).toContainText("openstack stack failures list");
    await expect(
      page.getByTestId("openstack-stack-owns-not-known"),
    ).toContainText("openstack stack resource list");
  });

  test("its API stopped is what needs someone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", HEAT_DOWN);
    await expect(
      needsAttention(page).getByText("Orchestration (Heat)"),
    ).toBeVisible();
    await openCloudPage(page, "stacks", HEAT_DOWN);
    await expect(
      page.getByText("This service's API isn't answering"),
    ).toBeVisible();
  });

  test("a credential Heat refuses says so, rather than reading as none", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "stacks", REFUSED);
    await expect(page.getByText("No stacks reported yet")).toBeVisible();
    await expect(
      page.getByText(/Only the Full view credential sees every project/),
    ).toBeVisible();
  });

  test("the Services page has its card, and says what the exporter doesn't read", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "services", HEAT);
    await expect(page.getByText("Orchestration (Heat)").first()).toBeVisible();
    await expect(
      page.getByTestId("openstack-service-group-workers-not-listed"),
    ).toContainText("doesn't read Heat's engines");
  });

  test("it is offered Heat's alerts, and none only a probe could fire", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "recommendations", HEAT);
    await expect(page.getByText("Stack Failed").first()).toBeVisible();
    await expect(
      page.getByText("Stack Stuck In Progress").first(),
    ).toBeVisible();
    await expect(page.getByText("Heat Engine Down")).toHaveCount(0);
    await expect(page.getByText("Kubernetes Cluster Failed")).toHaveCount(0);
  });
});

test.describe("a cloud that runs Magnum", () => {
  test("gets its clusters in the menu, and not a word of Heat's stacks", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", MAGNUM_FAILED);
    await expect(
      sideMenuLink(page, "Kubernetes Clusters").first(),
    ).toBeVisible();
    await expect(sideMenuLink(page, "Stacks")).toHaveCount(0);
  });

  test("a failed cluster reaches Needs attention by name, and lands on its page", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", MAGNUM_FAILED);
    const card: Locator = needsAttention(page);
    await expect(card.getByText("ou-cluster-times-out")).toBeVisible();
    await expect(card.getByText("ou-cluster-long")).toHaveCount(0);

    await card.getByRole("link", { name: /ou-cluster-times-out/ }).click();
    await expect(
      page.getByTestId("openstack-container-cluster-overview"),
    ).toBeVisible();
    await expect(page).toHaveURL(
      new RegExp(`/kubernetes-clusters/${FAILED_CLUSTER}`),
    );
    await screenshot(page, "cluster-failed");
  });

  test("the list says what each was asked for", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "kubernetes-clusters", MAGNUM_FAILED);
    const row: Locator = page
      .locator("tr", { hasText: "ou-cluster-times-out" })
      .first();
    await expect(row).toContainText("CREATE_FAILED");
    await expect(row).toContainText("1 control plane, 1 worker");
    await screenshot(page, "clusters");
  });

  test("a cluster's page says it can't tell whose it is, without Heat to ask", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("kubernetes-clusters", FAILED_CLUSTER)}?${MAGNUM_FAILED}`,
    );
    await expect(
      page.getByTestId("openstack-container-cluster-details-project"),
    ).toContainText("—");
    await expect(
      page.getByTestId("openstack-container-cluster-why-not-known"),
    ).toContainText("openstack coe cluster show");
  });

  test("its API stopped is what needs someone", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", MAGNUM_DOWN);
    await expect(
      needsAttention(page).getByText("Kubernetes Clusters (Magnum)"),
    ).toBeVisible();
  });

  test("the Services page says a stopped conductor shows nowhere here", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "services", MAGNUM_FAILED);
    await expect(
      page.getByTestId("openstack-service-group-workers-not-listed"),
    ).toContainText("a stopped one isn't shown anywhere here");
  });
});

test.describe("a whole cloud that runs both", () => {
  test("a failed cluster and its failed stack are one line, by the cluster's name", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", BOTH_ON_A_WHOLE_CLOUD);
    const card: Locator = needsAttention(page);
    await expect(
      card.getByText("ou-cluster-real", { exact: true }),
    ).toBeVisible();
    await expect(card.getByText("ou-cluster-real-b4a265chwfks")).toHaveCount(0);
    await expect(
      card.getByText("ou-stack-failed", { exact: true }),
    ).toBeVisible();
  });

  test("each is one step from the other", async ({ page }: { page: Page }) => {
    await openCloudPage(page, "kubernetes-clusters", BOTH_ON_A_WHOLE_CLOUD);
    await page
      .locator("tr", { hasText: "ou-cluster-real" })
      .first()
      .getByRole("button", { name: /view/i })
      .first()
      .click();
    const toStack: Locator = page
      .getByTestId("openstack-container-cluster-details-stack")
      .getByRole("link");
    await expect(toStack).toHaveText("ou-cluster-real-b4a265chwfks");
    await toStack.click();
    await expect(page.getByTestId("openstack-stack-overview")).toBeVisible();
    await expect(
      page.locator('[data-testid^="openstack-stack-details-belongs-to-"]'),
    ).toContainText("ou-cluster-real");
  });

  test("the Overview counts them, and each count is a way in", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "", BOTH_ON_A_WHOLE_CLOUD);
    await expect(page.getByText("8 stacks")).toBeVisible();
    await expect(page.getByText("1 Kubernetes cluster")).toBeVisible();
  });
});

/*
 * What no runner has reached: a cluster Magnum finished, with OneUptime's Kubernetes agent on it. Made
 * up (estate=magnum), and the links are the real rule: OpenStackLinks and its Postgres tests hold it.
 */
test.describe("a Magnum cluster with OneUptime's Kubernetes agent on it", () => {
  const MAGNUM: string = "estate=magnum";
  const CLUSTER: string = "a574ec05-efe3-45ca-a348-6b00a967b446";
  const WITHOUT_AGENT: string = "df9f1548-93b9-444f-9001-605d49feda4e";
  const KUBERNETES_CLUSTER: string = "76000000-0000-4000-8000-000000000002";

  test("links to its Kubernetes cluster, and that page links back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(`${partPath("kubernetes-clusters", CLUSTER)}?${MAGNUM}`);
    const links: Locator = page.getByTestId(
      "openstack-container-cluster-links",
    );
    await expect(links).toContainText("from-magnum");
    await expect(links).toContainText("2 nodes");
    await screenshot(page, "magnum-cluster-with-agent");

    await links.getByRole("link", { name: "from-magnum" }).click();
    await expect(page).toHaveURL(
      new RegExp(`/kubernetes/${KUBERNETES_CLUSTER}$`),
    );

    const back: Locator = page.getByTestId(
      "kubernetes-cluster-openstack-placement",
    );
    await expect(back).toContainText("spec.providerID");
    await expect(
      back.getByTestId("openstack-placement-magnum-status"),
    ).toContainText("CREATE_COMPLETE");
    await screenshot(page, "kubernetes-cluster-from-magnum");

    await back
      .getByTestId("openstack-placement-magnum-cluster")
      .getByRole("link")
      .click();
    await expect(page).toHaveURL(new RegExp(`/kubernetes-clusters/${CLUSTER}`));
    await expect(
      page.getByTestId("openstack-container-cluster-overview"),
    ).toBeVisible();
  });

  test("a cluster no agent reports from says nothing of one", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("kubernetes-clusters", WITHOUT_AGENT)}?${MAGNUM}`,
    );
    await expect(
      page.getByTestId("openstack-container-cluster-overview"),
    ).toBeVisible();
    await expect(
      page.getByTestId("openstack-container-cluster-links"),
    ).toHaveCount(0);
  });

  test("one of its servers names it, and a hypervisor names who has a server on it", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", MAGNUM);
    await page
      .locator("tr", { hasText: "ou-cluster-real-b4a265chwfks-node-0" })
      .first()
      .getByRole("button", { name: /view/i })
      .first()
      .click();
    await expect(
      page
        .locator('[data-testid^="openstack-instance-details-owner-"]')
        .first(),
    ).toContainText("ou-cluster-real");

    await openCloudPage(page, "hypervisors", MAGNUM);
    await page
      .locator("tr", { hasText: "compute-01" })
      .first()
      .getByRole("button", { name: /view/i })
      .first()
      .click();
    await expect(
      page.locator('[data-testid$="-magnum-clusters"]'),
    ).toContainText("ou-cluster-real");
  });

  test("an instance of any other name names no cluster", async ({
    page,
  }: {
    page: Page;
  }) => {
    await openCloudPage(page, "instances", MAGNUM);
    await page
      .locator("tr", { hasText: "web-1" })
      .first()
      .getByRole("button", { name: /view/i })
      .first()
      .click();
    await expect(page.getByTestId("openstack-instance-overview")).toBeVisible();
    await expect(
      page.locator('[data-testid^="openstack-instance-details-owner-"]'),
    ).toHaveCount(0);
  });

  test("a stack a probe read lists what it owns, and each names it back", async ({
    page,
  }: {
    page: Page;
  }) => {
    await page.goto(
      `${partPath("stacks", "733396c7-a790-4b41-9bfe-59a3342a517d")}?${MAGNUM}`,
    );
    const owns: Locator = page.getByTestId("openstack-stack-owns");
    await expect(owns).toContainText("ou-cluster-real-b4a265chwfks-master-0");
    await screenshot(page, "stack-owns");

    await owns
      .getByRole("link", { name: "ou-cluster-real-b4a265chwfks-master-0" })
      .click();
    await expect(page.getByTestId("openstack-instance-overview")).toBeVisible();
    await expect(
      page.locator('[data-testid^="openstack-instance-details-owner-"]'),
    ).toHaveCount(2);
  });
});

test.describe("at every width", () => {
  for (const viewport of VIEWPORTS) {
    test(`every page fits at ${viewport.width}`, async ({
      page,
    }: {
      page: Page;
    }) => {
      await page.setViewportSize({
        width: viewport.width,
        height: viewport.height,
      });
      for (const [address, ready] of [
        [`stacks`, "ou-stack-failed"],
        [`kubernetes-clusters`, "ou-cluster-real"],
      ] as Array<[string, string]>) {
        await openCloudPage(page, address, BOTH_ON_A_WHOLE_CLOUD);
        await expect(page.getByText(ready).first()).toBeVisible();
        await expectNoSidewaysScroll(page, { tolerance: 1 });
      }
      await page.goto(
        `${partPath("stacks", FAILED_STACK)}?${BOTH_ON_A_WHOLE_CLOUD}`,
      );
      await expect(page.getByTestId("openstack-stack-overview")).toBeVisible();
      await expectNoSidewaysScroll(page, { tolerance: 1 });
    });
  }
});
