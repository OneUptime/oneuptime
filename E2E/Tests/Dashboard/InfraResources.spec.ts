import { BASE_URL } from "../../Config";
import { Browser, Page, expect, test } from "@playwright/test";
import URL from "Common/Types/API/URL";
import Faker from "Common/Utils/Faker";
import {
  registerAndCreateProject,
  gotoProjectPage,
  describeProductOnboarding,
} from "./Helpers/ProductOnboarding";
import { createTelemetryIngestionKey } from "./Helpers/Telemetry";
import {
  InfraResourceRecipe,
  postInfraMetric,
  seedInfraResourceEntity,
  waitForResourceText,
} from "./Helpers/InfraResources";

/*
 * Infrastructure resource-page e2e coverage.
 *
 * For each infra product we seed a resource via the CRUD API, ingest an OTLP
 * metric stamped with the resource attribute that product's metrics page
 * filters on, then assert (a) the resource shows on its product/list page and
 * (b) the metric shows up on the resource's metrics page.
 *
 * One project + one ingestion key are created up front (serial mode + shared
 * page); each product is its own test so a failure is isolated.
 *
 * To run locally against a full stack:
 *
 *   cd E2E && HOST=localhost npx playwright test \
 *     Tests/Dashboard/InfraResources.spec.ts --project=chromium
 */
test.describe.configure({ mode: "serial" });

/*
 * Products whose metrics page uses MetricsViewer (a metric-name list), so we
 * can assert the ingested metric name shows up directly.
 */
const recipes: Array<InfraResourceRecipe> = [
  {
    label: "Ceph",
    listPath: "ceph",
    apiPath: "/api/ceph-cluster",
    metricResourceAttrKey: "ceph.cluster.name",
  },
  {
    label: "Proxmox",
    listPath: "proxmox",
    apiPath: "/api/proxmox-cluster",
    metricResourceAttrKey: "proxmox.cluster.name",
  },
  {
    label: "Docker Swarm",
    listPath: "docker-swarm",
    apiPath: "/api/docker-swarm-cluster",
    metricResourceAttrKey: "docker.swarm.cluster.name",
  },
  {
    label: "Kubernetes",
    listPath: "kubernetes",
    apiPath: "/api/kubernetes-cluster",
    identifierField: "clusterIdentifier",
    metricResourceAttrKey: "k8s.cluster.name",
  },
  {
    label: "Host",
    listPath: "host",
    apiPath: "/api/host",
    identifierField: "hostIdentifier",
    metricResourceAttrKey: "host.name",
  },
  {
    label: "IoT",
    listPath: "iot",
    apiPath: "/api/iot-fleet",
    metricResourceAttrKey: "iot.fleet.name",
  },
];

/*
 * Container products (Docker / Podman) whose metrics page uses MetricView with
 * fixed per-container charts (filtered by resource.host.name + a docker/podman
 * container.runtime). Their chart cards render for the resolved host, so we
 * ingest a real container.cpu.utilization metric for the host and assert the
 * resource shows on its page and the metrics card renders.
 */
interface ContainerResourceRecipe {
  label: string;
  listPath: string;
  apiPath: string;
  runtime: string;
  cardTitle: string;
}

const containerRecipes: Array<ContainerResourceRecipe> = [
  {
    label: "Docker",
    listPath: "docker",
    apiPath: "/api/docker-host",
    runtime: "docker",
    cardTitle: "Docker Host Metrics",
  },
  {
    label: "Podman",
    listPath: "podman",
    apiPath: "/api/podman-host",
    runtime: "podman",
    cardTitle: "Podman Host Metrics",
  },
];

interface SharedContext {
  page: Page;
  projectId: string;
  ingestionKey: string;
}

describeProductOnboarding("Infra Resource Pages - Metrics", () => {
  const ctx: SharedContext = {
    page: undefined as unknown as Page,
    projectId: "",
    ingestionKey: "",
  };

  test.beforeAll(async ({ browser }: { browser: Browser }) => {
    test.setTimeout(300000);
    ctx.page = await browser.newPage();
    ctx.projectId = await registerAndCreateProject({
      page: ctx.page,
      projectNamePrefix: "E2E Infra Resources Project",
    });
    ctx.ingestionKey = await createTelemetryIngestionKey({
      page: ctx.page,
      projectId: ctx.projectId,
      keyName: "E2E Infra Key " + Faker.generateName().toString(),
    });
  });

  test.afterAll(async () => {
    await ctx.page.close();
  });

  for (const recipe of recipes) {
    test(`${recipe.label} resource page shows the resource and its metrics`, async () => {
      test.setTimeout(300000);
      const page: Page = ctx.page;

      const { modelId, name } = await seedInfraResourceEntity({
        page,
        projectId: ctx.projectId,
        recipe,
      });

      const metricName: string =
        `e2e_${recipe.listPath.replace(/-/g, "_")}_metric_` +
        Faker.generateName().toString().toLowerCase();

      await postInfraMetric({
        page,
        ingestionKey: ctx.ingestionKey,
        resourceAttrKey: recipe.metricResourceAttrKey,
        resourceAttrValue: name,
        metricName,
      });

      // (a) The resource shows up on the product/list page.
      const listUrl: string = URL.fromString(BASE_URL.toString())
        .addRoute(`/dashboard/${ctx.projectId}/${recipe.listPath}`)
        .toString();
      await gotoProjectPage({
        page,
        projectId: ctx.projectId,
        url: listUrl,
        ready: page.getByText(name).first(),
      });
      await expect(page.getByText(name).first()).toBeVisible({
        timeout: 30000,
      });

      // (b) The ingested metric shows up on the resource's metrics page.
      const metricsUrl: string = URL.fromString(BASE_URL.toString())
        .addRoute(
          `/dashboard/${ctx.projectId}/${recipe.listPath}/${modelId}/metrics`,
        )
        .toString();
      await waitForResourceText({
        page,
        projectId: ctx.projectId,
        url: metricsUrl,
        ready: page.getByPlaceholder(/Search metrics/i),
        text: metricName,
      });
    });
  }

  for (const recipe of containerRecipes) {
    test(`${recipe.label} resource page shows the resource and its metrics`, async () => {
      test.setTimeout(300000);
      const page: Page = ctx.page;

      const { modelId, name } = await seedInfraResourceEntity({
        page,
        projectId: ctx.projectId,
        recipe: {
          label: recipe.label,
          listPath: recipe.listPath,
          apiPath: recipe.apiPath,
          identifierField: "hostIdentifier",
          metricResourceAttrKey: "host.name",
        },
      });

      // container.cpu.utilization is what the Docker/Podman metrics charts read.
      await postInfraMetric({
        page,
        ingestionKey: ctx.ingestionKey,
        resourceAttrKey: "host.name",
        resourceAttrValue: name,
        metricName: "container.cpu.utilization",
        extraResourceAttrs: [
          { key: "container.runtime", value: recipe.runtime },
          { key: "container.name", value: `e2e-${recipe.runtime}-container` },
        ],
      });

      // (a) The resource shows up on the product/list page.
      const listUrl: string = URL.fromString(BASE_URL.toString())
        .addRoute(`/dashboard/${ctx.projectId}/${recipe.listPath}`)
        .toString();
      await gotoProjectPage({
        page,
        projectId: ctx.projectId,
        url: listUrl,
        ready: page.getByText(name).first(),
      });
      await expect(page.getByText(name).first()).toBeVisible({
        timeout: 30000,
      });

      // (b) The resource's metrics page renders its metrics card.
      const metricsUrl: string = URL.fromString(BASE_URL.toString())
        .addRoute(
          `/dashboard/${ctx.projectId}/${recipe.listPath}/${modelId}/metrics`,
        )
        .toString();
      await gotoProjectPage({
        page,
        projectId: ctx.projectId,
        url: metricsUrl,
        ready: page.getByText(recipe.cardTitle).first(),
      });
      await expect(page.getByText(recipe.cardTitle).first()).toBeVisible({
        timeout: 30000,
      });
    });
  }
});
