import { BASE_URL } from "../../../Config";
import { APIResponse, Locator, Page, expect } from "@playwright/test";
import URL from "Common/Types/API/URL";
import { gotoProjectPage } from "./ProductOnboarding";

/*
 * Helpers for the infrastructure resource-page e2e specs
 * (InfraResources.spec.ts).
 *
 * Each infra product (Kubernetes / Docker / Podman / Docker Swarm / Proxmox /
 * Ceph / Host / IoT) has:
 *   - a list page  /dashboard/:projectId/<product>            (shows resources)
 *   - a metrics page /dashboard/:projectId/<product>/:id/metrics (shows metrics)
 *
 * The resource entities are normal CRUD models, so we seed one via the API
 * (reliable + synchronous), then POST an OTLP metric stamped with the resource
 * attribute the product's metrics page filters on, and assert the metric shows
 * up on that resource's metrics page.
 */

export interface InfraResourceRecipe {
  // Human label used in the test title.
  label: string;
  // URL segment for the product, e.g. "kubernetes", "ceph", "docker-swarm".
  listPath: string;
  // CRUD API path to seed the entity, e.g. "/api/ceph-cluster".
  apiPath: string;
  /*
   * Extra identifier column the model needs besides name (clusterIdentifier /
   * hostIdentifier). Omitted for the name-keyed products.
   */
  identifierField?: string;
  /*
   * Resource attribute key the ingested metric must carry so the product's
   * metrics page (which filters on it) shows the metric.
   */
  metricResourceAttrKey: string;
}

/*
 * Seeds one infra entity via the CRUD API and returns its id + name (the name
 * is also the value the metrics page filters the resource attribute on, since
 * we set name === identifier).
 */
type SeedEntityFunction = (data: {
  page: Page;
  projectId: string;
  recipe: InfraResourceRecipe;
}) => Promise<{ modelId: string; name: string }>;

export const seedInfraResourceEntity: SeedEntityFunction = async (data: {
  page: Page;
  projectId: string;
  recipe: InfraResourceRecipe;
}): Promise<{ modelId: string; name: string }> => {
  const name: string = `e2e-${data.recipe.listPath}-${Math.floor(
    Math.random() * 1e9,
  ).toString(36)}`;

  const apiUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute(data.recipe.apiPath)
    .toString();

  const entityData: { [key: string]: string } = {
    name: name,
    projectId: data.projectId,
  };
  if (data.recipe.identifierField) {
    entityData[data.recipe.identifierField] = name;
  }

  const response: APIResponse = await data.page.request.post(apiUrl, {
    headers: { "content-type": "application/json", tenantid: data.projectId },
    data: { data: entityData },
  });
  expect(
    response.ok(),
    `Seed ${data.recipe.label} entity failed: ${response.status()} ${await response.text()}`,
  ).toBe(true);

  const body: { _id?: string } = (await response.json()) as { _id?: string };
  expect(body._id, "seed response missing _id").toBeTruthy();

  return { modelId: body._id!, name };
};

const nowUnixNano: () => string = (): string => {
  return `${Date.now()}000000`;
};

/*
 * POSTs a single-gauge OTLP metric stamped with one resource attribute. Used
 * to make a metric show up under a specific infra resource.
 */
type PostInfraMetricFunction = (data: {
  page: Page;
  ingestionKey: string;
  resourceAttrKey: string;
  resourceAttrValue: string;
  metricName: string;
  // Extra resource attributes (e.g. container.runtime for Docker/Podman).
  extraResourceAttrs?: Array<{ key: string; value: string }>;
}) => Promise<void>;

export const postInfraMetric: PostInfraMetricFunction = async (data: {
  page: Page;
  ingestionKey: string;
  resourceAttrKey: string;
  resourceAttrValue: string;
  metricName: string;
  extraResourceAttrs?: Array<{ key: string; value: string }>;
}): Promise<void> => {
  const otlpMetricsUrl: string = URL.fromString(BASE_URL.toString())
    .addRoute("/otlp/v1/metrics")
    .toString();

  const resourceAttributes: Array<{
    key: string;
    value: { stringValue: string };
  }> = [
    {
      key: data.resourceAttrKey,
      value: { stringValue: data.resourceAttrValue },
    },
    {
      key: "service.name",
      value: { stringValue: data.resourceAttrValue },
    },
  ];
  for (const extra of data.extraResourceAttrs ?? []) {
    resourceAttributes.push({
      key: extra.key,
      value: { stringValue: extra.value },
    });
  }

  const response: APIResponse = await data.page.request.post(otlpMetricsUrl, {
    headers: {
      "content-type": "application/json",
      "x-oneuptime-token": data.ingestionKey,
    },
    data: {
      resourceMetrics: [
        {
          resource: {
            attributes: resourceAttributes,
          },
          scopeMetrics: [
            {
              scope: { name: "e2e-infra-fixture" },
              metrics: [
                {
                  name: data.metricName,
                  gauge: {
                    dataPoints: [
                      {
                        asDouble: 1,
                        timeUnixNano: nowUnixNano(),
                        attributes: [],
                      },
                    ],
                  },
                },
              ],
            },
          ],
        },
      ],
    },
  });

  expect(response.ok()).toBe(true);
};

/*
 * Re-navigates to a page until the expected text shows up (ingestion is
 * queued, and metrics pages do not always live-refresh). Generous timeout
 * because CI runs the whole stack on one box.
 */
type WaitForTextFunction = (data: {
  page: Page;
  projectId: string;
  url: string;
  ready: Locator;
  text: string;
  timeoutMs?: number;
}) => Promise<void>;

export const waitForResourceText: WaitForTextFunction = async (data: {
  page: Page;
  projectId: string;
  url: string;
  ready: Locator;
  text: string;
  timeoutMs?: number;
}): Promise<void> => {
  const timeoutMs: number = data.timeoutMs ?? 180000;
  const deadline: number = Date.now() + timeoutMs;
  const target: Locator = data.page.getByText(data.text).first();
  let attempt: number = 0;

  while (Date.now() < deadline) {
    attempt++;
    try {
      await gotoProjectPage({
        page: data.page,
        projectId: data.projectId,
        url: data.url,
        ready: data.ready,
      });
      await data.page.waitForTimeout(4000);
      const found: boolean = await target.isVisible();
      // eslint-disable-next-line no-console
      console.log(
        `[waitForResourceText] attempt=${attempt} url=${data.page.url()} found=${found} text="${data.text}"`,
      );
      if (found) {
        return;
      }
    } catch (error) {
      // eslint-disable-next-line no-console
      console.log(
        `[waitForResourceText] attempt=${attempt} error=${(error as Error).message}`,
      );
    }
    await data.page.waitForTimeout(3000);
  }

  await expect(target).toBeVisible({ timeout: 30000 });
};
