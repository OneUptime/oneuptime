import { describe, expect, test } from "@jest/globals";
import { generateKeyPairSync } from "crypto";
import {
  CloudCompleteListing,
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudInventoryItem,
  CloudInventoryResult,
  CloudReadBudget,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import GcpCloudConnector from "../../../../Server/Utils/CloudConnection/Gcp/GcpCloudConnector";
import { DataSourceHttpRequest } from "../../../../Server/Utils/DataSource/HttpFetch";
import {
  CloudRelationshipKind,
  CloudResourceRelationship,
} from "../../../../Types/Cloud/CloudInventory";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { JSONObject } from "../../../../Types/JSON";
import {
  FakeProviderApi,
  FakeResponse,
  createFakeProviderApi,
  json,
} from "../LlmObservability/FakeProviderApi";

/*
 * A Google Cloud connection's inventory read end to end, against a fake
 * Google OAuth, Cloud Asset Inventory and Resource Manager (#9306): every
 * project's assets page by page, the edges only a whole project draws (the
 * firewall rules that guard each instance), a project whose Cloud Asset API
 * is off - a warning that says the command to run, while the other
 * projects are still listed - a project the service account may not list,
 * a burst Cloud Asset answers with 429, and a read that runs out of budget.
 * A project not listed to its last page is never said to be listed in
 * full, so nothing of it is archived.
 */

const PROD: string = "shop-prod";
const STAGING: string = "shop-staging";
const NOW: Date = new Date("2026-10-21T12:07:00Z");
const { privateKey } = generateKeyPairSync("rsa", {
  modulusLength: 2048,
  privateKeyEncoding: { type: "pkcs8", format: "pem" },
  publicKeyEncoding: { type: "spki", format: "pem" },
});
const KEY: string = JSON.stringify({
  type: "service_account",
  project_id: PROD,
  client_email: `oneuptime-read-only@${PROD}.iam.gserviceaccount.com`,
  private_key: privateKey,
  token_uri: "https://oauth2.googleapis.com/token",
});

const connector: GcpCloudConnector = new GcpCloudConnector();

function settings(projects: Array<string>): CloudConnectionSettings {
  return {
    provider: CloudProvider.GCP,
    projectId: "11111111-1111-4111-8111-111111111111",
    config: {
      authMethod: CloudConnectionAuthMethod.GcpServiceAccountKey,
      projectIds: projects.join(","),
    },
    secrets: { serviceAccountJson: KEY },
  };
}

function compute(project: string, path: string): string {
  return `https://www.googleapis.com/compute/v1/projects/${project}/${path}`;
}

function full(project: string, path: string): string {
  return `//compute.googleapis.com/projects/${project}/${path}`;
}

// One Cloud Asset entry, as the assets list returns it.
function entry(
  assetType: string,
  name: string,
  location: string,
  data: JSONObject,
): JSONObject {
  return { name, assetType, resource: { location, data } };
}

// A project's network: two pages of assets, as Cloud Asset pages them.
function prodPages(project: string): Array<JSONObject> {
  return [
    {
      assets: [
        entry(
          "compute.googleapis.com/Network",
          full(project, "global/networks/default"),
          "global",
          { name: "default", autoCreateSubnetworks: true },
        ),
        entry(
          "compute.googleapis.com/Subnetwork",
          full(project, "regions/us-central1/subnetworks/default"),
          "us-central1",
          {
            name: "default",
            network: compute(project, "global/networks/default"),
            region: compute(project, "regions/us-central1"),
            ipCidrRange: "10.128.0.0/20",
          },
        ),
        entry(
          "compute.googleapis.com/Firewall",
          full(project, "global/firewalls/allow-http"),
          "global",
          {
            name: "allow-http",
            network: compute(project, "global/networks/default"),
            direction: "INGRESS",
            targetTags: ["http-server"],
            allowed: [{ IPProtocol: "tcp", ports: ["80"] }],
          },
        ),
      ],
      nextPageToken: "page-2",
    },
    {
      assets: [
        entry(
          "compute.googleapis.com/Instance",
          full(project, "zones/us-central1-a/instances/web-1"),
          "us-central1-a",
          {
            id: "1001",
            name: "web-1",
            zone: compute(project, "zones/us-central1-a"),
            status: "RUNNING",
            labels: { team: "storefront" },
            tags: { items: ["http-server"] },
            networkInterfaces: [
              {
                network: compute(project, "global/networks/default"),
                subnetwork: compute(
                  project,
                  "regions/us-central1/subnetworks/default",
                ),
                networkIP: "10.128.0.2",
              },
            ],
          },
        ),
        entry(
          "storage.googleapis.com/Bucket",
          "//storage.googleapis.com/shop-assets",
          "US",
          { name: "shop-assets", storageClass: "STANDARD" },
        ),
        // A load balancer: its address, the proxy between, its URL map and backend.
        entry(
          "compute.googleapis.com/GlobalForwardingRule",
          full(project, "global/forwardingRules/shop-https"),
          "global",
          {
            name: "shop-https",
            IPAddress: "34.120.1.2",
            target: compute(project, "global/targetHttpsProxies/shop"),
          },
        ),
        entry(
          "compute.googleapis.com/TargetHttpsProxy",
          full(project, "global/targetHttpsProxies/shop"),
          "global",
          { name: "shop", urlMap: compute(project, "global/urlMaps/shop") },
        ),
        entry(
          "compute.googleapis.com/UrlMap",
          full(project, "global/urlMaps/shop"),
          "global",
          {
            name: "shop",
            defaultService: compute(project, "global/backendServices/web"),
          },
        ),
        entry(
          "compute.googleapis.com/BackendService",
          full(project, "global/backendServices/web"),
          "global",
          { name: "web", loadBalancingScheme: "EXTERNAL_MANAGED" },
        ),
      ],
    },
  ];
}

interface FakeGcp extends FakeProviderApi {
  assetCalls: Array<URL>;
}

function createFakeGcp(
  options: {
    // A project's answer instead of its pages, every time it is asked.
    failures?: Record<string, FakeResponse>;
    // A project's first answers, before its pages.
    before?: Record<string, Array<FakeResponse>>;
  } = {},
): FakeGcp {
  const assetCalls: Array<URL> = [];
  const asked: Record<string, number> = {};

  const fake: FakeProviderApi = createFakeProviderApi([
    {
      host: "oauth2.googleapis.com",
      path: "/token",
      method: "POST",
      respond: (): FakeResponse => {
        return json({ access_token: "ya29.token", expires_in: 3599 });
      },
    },
    {
      host: "cloudasset.googleapis.com",
      path: /^\/v1\/projects\/[^/]+\/assets$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        assetCalls.push(url);
        const project: string = url.pathname.split("/")[3]!;
        const failure: FakeResponse | undefined = options.failures?.[project];

        if (failure) {
          return failure;
        }

        const count: number = asked[project] || 0;
        asked[project] = count + 1;
        const before: Array<FakeResponse> = options.before?.[project] || [];

        if (count < before.length) {
          return before[count]!;
        }

        const pageToken: string = url.searchParams.get("pageToken") || "";
        const pages: Array<JSONObject> = prodPages(project);
        return json(pageToken === "page-2" ? pages[1]! : pages[0]!);
      },
    },
    {
      host: "cloudresourcemanager.googleapis.com",
      path: /^\/v3\/projects\/[^/]+$/,
      respond: (_request: DataSourceHttpRequest, url: URL): FakeResponse => {
        const project: string = url.pathname.split("/")[3]!;
        return json({ projectId: project, displayName: `Shop (${project})` });
      },
    },
  ]);

  return { ...fake, assetCalls };
}

function inventoryOptions(
  fake: FakeGcp,
  state: CloudConnectionPullState = {},
  maxRequests: number = 100,
): Parameters<GcpCloudConnector["readInventory"]>[1] {
  return {
    transport: fake.transport,
    now: () => {
      return NOW;
    },
    sleep: async () => {},
    state,
    connectionId: "33333333-3333-4333-8333-333333333333",
    budget: new CloudReadBudget({ maxRequests, maxDurationMs: 60000 }),
  };
}

function itemOf(
  result: CloudInventoryResult,
  type: string,
  account: string = PROD,
): CloudInventoryItem {
  const found: CloudInventoryItem | undefined = result.items.find(
    (item: CloudInventoryItem): boolean => {
      return (
        item.resource.resourceType === type &&
        item.resource.accountId === account
      );
    },
  );

  if (!found) {
    throw new Error(`No ${type} in ${account}`);
  }

  return found;
}

function listedTypes(
  result: CloudInventoryResult,
  account: string,
): Array<string> | undefined {
  return result.completelyListed.find((listing: CloudCompleteListing) => {
    return listing.accountId === account;
  })?.resourceTypes;
}

describe("a Google Cloud connection's inventory", () => {
  test("lists a project's network, compute and storage page by page, with the edges between them", async () => {
    const fake: FakeGcp = createFakeGcp();

    const result: CloudInventoryResult = await connector.readInventory(
      settings([PROD]),
      inventoryOptions(fake),
    );

    expect(result.complete).toBe(true);
    expect(result.warnings).toEqual([]);
    expect(fake.assetCalls).toHaveLength(2);
    expect(fake.assetCalls[1]!.searchParams.get("pageToken")).toBe("page-2");

    for (const type of [
      "compute.googleapis.com/Instance",
      "compute.googleapis.com/Network",
      "compute.googleapis.com/Subnetwork",
      "compute.googleapis.com/Firewall",
      "storage.googleapis.com/Bucket",
    ]) {
      expect(fake.assetCalls[0]!.searchParams.getAll("assetTypes")).toContain(
        type,
      );
    }

    expect(
      result.items
        .map((item: CloudInventoryItem): string => {
          return `${item.resource.resourceType} ${item.resource.region} ${item.resource.name}`;
        })
        .sort(),
    ).toEqual(
      [
        "compute.googleapis.com/Firewall global allow-http",
        "compute.googleapis.com/Network global default",
        "compute.googleapis.com/Subnetwork us-central1 default",
        "gce_instance us-central1 web-1",
        "gcs_bucket us shop-assets",
        "compute.googleapis.com/ForwardingRule global shop-https",
        // As its metrics file it: a global load balancer is in no region.
        "https_lb_rule  shop",
        "compute.googleapis.com/BackendService global web",
      ].sort(),
    );

    const instance: CloudInventoryItem = itemOf(result, "gce_instance");

    expect(instance.tags).toEqual({ team: "storefront" });
    expect(
      instance.relationships.map(
        (relationship: CloudResourceRelationship): string => {
          return `${relationship.kind} ${relationship.target}`;
        },
      ),
    ).toEqual([
      `${CloudRelationshipKind.RunsIn} ${full(PROD, "regions/us-central1/subnetworks/default")}`,
      `${CloudRelationshipKind.RunsIn} ${full(PROD, "global/networks/default")}`,
      `${CloudRelationshipKind.ProtectedBy} ${full(PROD, "global/firewalls/allow-http")}`,
    ]);
    expect(
      itemOf(result, "compute.googleapis.com/Firewall").properties,
    ).toEqual(
      expect.objectContaining({
        direction: "INGRESS",
        allowed: ["tcp:80"],
        targetTags: ["http-server"],
      }),
    );
    // The rule sends to its URL map through the proxy, which is never kept.
    expect(
      itemOf(result, "compute.googleapis.com/ForwardingRule").relationships,
    ).toEqual([
      {
        kind: CloudRelationshipKind.RoutesTo,
        target: full(PROD, "global/urlMaps/shop"),
        targetType: "https_lb_rule",
      },
    ]);
    expect(itemOf(result, "https_lb_rule").endpoints).toEqual(["34.120.1.2"]);
    expect(result.accounts).toEqual([
      { accountId: PROD, name: `Shop (${PROD})` },
    ]);
  });

  test("a project listed to its last page is listed in full for every type the inventory reads, so what it no longer has is archived", async () => {
    const fake: FakeGcp = createFakeGcp();

    const result: CloudInventoryResult = await connector.readInventory(
      settings([PROD]),
      inventoryOptions(fake),
    );

    expect(listedTypes(result, PROD)).toEqual(
      expect.arrayContaining([
        "gce_instance",
        "gcs_bucket",
        "compute.googleapis.com/Network",
        "compute.googleapis.com/Subnetwork",
        "compute.googleapis.com/Firewall",
      ]),
    );
  });

  test("a project whose Cloud Asset API is off is a warning with the command to run, and the other projects are still listed", async () => {
    const fake: FakeGcp = createFakeGcp({
      failures: {
        [STAGING]: {
          status: 403,
          body: '{"error":{"code":403,"message":"Cloud Asset API has not been used in project 222 before or it is disabled.","status":"PERMISSION_DENIED"}}',
        },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      settings([STAGING, PROD]),
      inventoryOptions(fake),
    );

    expect(result.warnings).toHaveLength(1);
    expect(result.warnings[0]).toContain(STAGING);
    expect(result.warnings[0]).toContain(
      "gcloud services enable cloudasset.googleapis.com",
    );
    // The project that answered is listed whole.
    expect(itemOf(result, "gce_instance", PROD).resource.name).toBe("web-1");
    expect(listedTypes(result, PROD)).toBeDefined();
    // The one that did not is never said to be listed: nothing of it is archived.
    expect(listedTypes(result, STAGING)).toBeUndefined();
    expect(
      result.accounts.map((account: { accountId: string }): string => {
        return account.accountId;
      }),
    ).toEqual([STAGING, PROD]);
  });

  test("a project the service account may not list says which role to give it", async () => {
    const fake: FakeGcp = createFakeGcp({
      failures: {
        [STAGING]: {
          status: 403,
          body: '{"error":{"code":403,"message":"The caller does not have permission","status":"PERMISSION_DENIED"}}',
        },
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      settings([STAGING, PROD]),
      inventoryOptions(fake),
    );

    expect(result.warnings).toEqual([
      `The service account may not list the resources of ${STAGING}. Run the setup command again: it gives it the Cloud Asset Viewer role.`,
    ]);
    expect(listedTypes(result, STAGING)).toBeUndefined();
    expect(listedTypes(result, PROD)).toBeDefined();
  });

  test("a burst Cloud Asset answers with 429 is asked again, and the listing completes", async () => {
    const fake: FakeGcp = createFakeGcp({
      before: {
        [PROD]: [
          {
            status: 429,
            body: '{"error":{"code":429,"message":"Quota exceeded","status":"RESOURCE_EXHAUSTED"}}',
          },
        ],
      },
    });

    const result: CloudInventoryResult = await connector.readInventory(
      settings([PROD]),
      inventoryOptions(fake),
    );

    expect(result.warnings).toEqual([]);
    expect(result.complete).toBe(true);
    expect(fake.assetCalls).toHaveLength(3);
    expect(result.items).toHaveLength(8);
  });

  test("a read that runs out of budget part way is not complete, and the project is not listed in full", async () => {
    const fake: FakeGcp = createFakeGcp();

    // One request, the first page: the second is past the budget.
    const result: CloudInventoryResult = await connector.readInventory(
      settings([PROD]),
      inventoryOptions(fake, {}, 1),
    );

    expect(result.complete).toBe(false);
    expect(listedTypes(result, PROD)).toBeUndefined();
  });
});
