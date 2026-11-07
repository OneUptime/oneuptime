import { describe, expect, test } from "@jest/globals";
import { FastestRun, fastestRun } from "../../Helpers/FastestRun";
import {
  CLOUD_PLATFORM_ALL_BILLED_SERVICES,
  CLOUD_PLATFORM_BILLED_SERVICES,
  CloudPlatformCostApp,
  CloudPlatformCostEnvironment,
  CloudPlatformCostRow,
  CloudPlatformCostShares,
  CloudPlatformTaggedCostRow,
  ELASTIC_BEANSTALK_ENVIRONMENT_TAG,
  assignCloudCostsToApps,
  assignCloudCostsToEnvironments,
  getCloudPlatformBilledAppName,
} from "../../../Types/Cloud/CloudPlatformCosts";
import {
  MANAGED_CLOUD_PLATFORMS,
  ManagedCloudPlatform,
  ManagedCloudPlatformDescriptor,
} from "../../../Types/Cloud/CloudPlatform";

/*
 * What each App Platforms environment and app costs: an environment is its
 * platform's services in its account and Region (an Elastic Beanstalk one,
 * the resources tagged with its name), an app what its platform bills one
 * resource of its name for. The shares and what is left over add up to
 * the period's spend, every time.
 */

const WEB_ACCOUNT: string = "123456789012";
const GCP_PROJECT: string = "acme-shop";
const SUBSCRIPTION: string = "5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e";

const ECS_EAST: CloudPlatformCostEnvironment = {
  id: "env-ecs-east",
  platform: ManagedCloudPlatform.AwsEcs,
  accountId: WEB_ACCOUNT,
  region: "us-east-1",
};
const ECS_WEST: CloudPlatformCostEnvironment = {
  id: "env-ecs-west",
  platform: ManagedCloudPlatform.AwsEcs,
  accountId: WEB_ACCOUNT,
  region: "us-west-2",
};
const RUNNER: CloudPlatformCostEnvironment = {
  id: "env-app-runner",
  platform: ManagedCloudPlatform.AwsAppRunner,
  accountId: WEB_ACCOUNT,
  region: "us-east-1",
};
const CLOUD_RUN: CloudPlatformCostEnvironment = {
  id: "env-run",
  platform: ManagedCloudPlatform.GcpCloudRun,
  accountId: GCP_PROJECT,
  region: "europe-west1",
};
const CONTAINER_APPS: CloudPlatformCostEnvironment = {
  id: "env-aca",
  platform: ManagedCloudPlatform.AzureContainerApps,
  // Azure writes its ids in either case: one account all the same.
  accountId: SUBSCRIPTION.toUpperCase(),
  region: "westeurope",
};
const BEANSTALK: CloudPlatformCostEnvironment = {
  id: "env-eb",
  platform: ManagedCloudPlatform.AwsElasticBeanstalk,
  accountId: WEB_ACCOUNT,
  region: "eu-west-1",
};

const ENVIRONMENTS: Array<CloudPlatformCostEnvironment> = [
  ECS_EAST,
  ECS_WEST,
  RUNNER,
  CLOUD_RUN,
  CONTAINER_APPS,
  BEANSTALK,
];

function row(fields: Partial<CloudPlatformCostRow>): CloudPlatformCostRow {
  return {
    accountId: WEB_ACCOUNT,
    region: "us-east-1",
    service: "Amazon Elastic Compute Cloud - Compute",
    resourceId: "",
    amount: 0,
    ...fields,
  };
}

function totalOf(shares: CloudPlatformCostShares): number {
  return (
    shares.shares.reduce((sum: number, share: { amount: number }) => {
      return sum + share.amount;
    }, 0) +
    shares.notOneApp +
    shares.other
  );
}

describe("what each platform is billed under", () => {
  test("every platform has its entry, and Elastic Beanstalk none of its own", () => {
    expect(Object.keys(CLOUD_PLATFORM_BILLED_SERVICES).sort()).toEqual(
      MANAGED_CLOUD_PLATFORMS.map(
        (descriptor: ManagedCloudPlatformDescriptor): string => {
          return descriptor.platform;
        },
      ).sort(),
    );
    expect(
      CLOUD_PLATFORM_BILLED_SERVICES[ManagedCloudPlatform.AwsElasticBeanstalk],
    ).toEqual([]);
    expect(ELASTIC_BEANSTALK_ENVIRONMENT_TAG).toBe(
      "elasticbeanstalk:environment-name",
    );
  });

  test("the services as each cloud's billing names them", () => {
    expect(CLOUD_PLATFORM_BILLED_SERVICES).toEqual({
      [ManagedCloudPlatform.AwsEcs]: ["Amazon Elastic Container Service"],
      [ManagedCloudPlatform.AwsElasticBeanstalk]: [],
      [ManagedCloudPlatform.AwsAppRunner]: ["AWS App Runner"],
      [ManagedCloudPlatform.GcpCloudRun]: ["Cloud Run"],
      [ManagedCloudPlatform.GcpAppEngine]: ["App Engine"],
      [ManagedCloudPlatform.AzureContainerApps]: ["Azure Container Apps"],
      [ManagedCloudPlatform.AzureContainerInstances]: ["Container Instances"],
      [ManagedCloudPlatform.AzureAppService]: ["Azure App Service"],
    });
    // Asked for once each, when a read is by app.
    expect([...CLOUD_PLATFORM_ALL_BILLED_SERVICES].sort()).toEqual(
      [
        "Amazon Elastic Container Service",
        "AWS App Runner",
        "Cloud Run",
        "App Engine",
        "Azure Container Apps",
        "Container Instances",
        "Azure App Service",
      ].sort(),
    );
  });
});

describe("the app a billed resource is", () => {
  test.each([
    [
      ManagedCloudPlatform.GcpCloudRun,
      "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/checkout",
      "checkout",
    ],
    [
      ManagedCloudPlatform.GcpAppEngine,
      "//appengine.googleapis.com/apps/acme-shop/services/default/versions/20261101",
      "default",
    ],
    [
      ManagedCloudPlatform.AzureContainerApps,
      "/subscriptions/5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e/resourcegroups/shop/providers/microsoft.app/containerapps/checkout",
      "checkout",
    ],
    [
      ManagedCloudPlatform.AzureContainerApps,
      // Resource Graph's casing: the kind is matched whatever its case.
      "/subscriptions/x/resourceGroups/shop/providers/Microsoft.App/containerApps/Checkout",
      "Checkout",
    ],
    [
      ManagedCloudPlatform.AzureContainerInstances,
      "/subscriptions/x/resourcegroups/jobs/providers/microsoft.containerinstance/containergroups/nightly-report",
      "nightly-report",
    ],
    [
      ManagedCloudPlatform.AzureAppService,
      "/subscriptions/x/resourcegroups/web/providers/microsoft.web/sites/storefront",
      "storefront",
    ],
    [
      ManagedCloudPlatform.AwsAppRunner,
      "arn:aws:apprunner:us-east-1:123456789012:service/checkout/0a1b2c3d4e5f",
      "checkout",
    ],
  ])("%s: %s is %s", (platform: string, resourceId: string, name: string) => {
    expect(getCloudPlatformBilledAppName({ platform, resourceId })).toBe(name);
  });

  test("a platform that bills no resource per app names none; nor does an id of another kind", () => {
    expect(
      getCloudPlatformBilledAppName({
        platform: ManagedCloudPlatform.AwsEcs,
        resourceId:
          "arn:aws:ecs:us-east-1:123456789012:task/checkout-cluster/0a1b2c",
      }),
    ).toBeNull();
    expect(
      getCloudPlatformBilledAppName({
        platform: ManagedCloudPlatform.AzureAppService,
        // The plan the sites share: not one app.
        resourceId:
          "/subscriptions/x/resourcegroups/web/providers/microsoft.web/serverfarms/plan-p1v3",
      }),
    ).toBeNull();
    expect(
      getCloudPlatformBilledAppName({
        platform: ManagedCloudPlatform.GcpCloudRun,
        resourceId: "",
      }),
    ).toBeNull();
    // The kind is the last segment: nothing after it to name.
    expect(
      getCloudPlatformBilledAppName({
        platform: ManagedCloudPlatform.GcpCloudRun,
        resourceId: "//run.googleapis.com/projects/p/locations/r/services/",
      }),
    ).toBeNull();
    expect(
      getCloudPlatformBilledAppName({
        platform: "kubernetes",
        resourceId: "/services/x",
      }),
    ).toBeNull();
  });

  test("a long id of slashes is read in one pass", () => {
    const id: string = `${"/".repeat(400000)}services/checkout`;
    const read: FastestRun<string | null> = fastestRun({
      run: (): string | null => {
        return getCloudPlatformBilledAppName({
          platform: ManagedCloudPlatform.GcpCloudRun,
          resourceId: id,
        });
      },
      limitInMs: 2000,
    });

    expect(read.result).toBe("checkout");
    expect(read.inMs).toBeLessThan(2000);
  });
});

describe("the spend by environment", () => {
  test("each environment's platform services in its account and Region; the rest is other", () => {
    const rows: Array<CloudPlatformCostRow> = [
      row({ service: "Amazon Elastic Container Service", amount: 120 }),
      row({
        service: "Amazon Elastic Container Service",
        region: "us-west-2",
        amount: 30,
      }),
      row({ service: "AWS App Runner", amount: 12.5 }),
      // EC2 the ECS tasks may run on is EC2's: not the environment's.
      row({ amount: 400 }),
      row({
        accountId: GCP_PROJECT,
        region: "europe-west1",
        service: "Cloud Run",
        amount: 44,
      }),
      row({
        accountId: SUBSCRIPTION,
        region: "westeurope",
        service: "Azure Container Apps",
        amount: 21,
      }),
      // ECS in a Region with no environment of it: other.
      row({
        service: "Amazon Elastic Container Service",
        region: "ap-south-1",
        amount: 9,
      }),
    ];

    const assigned: CloudPlatformCostShares = assignCloudCostsToEnvironments({
      rows,
      environments: ENVIRONMENTS,
    });

    expect(assigned.shares).toEqual([
      { id: "env-ecs-east", amount: 120 },
      { id: "env-run", amount: 44 },
      { id: "env-ecs-west", amount: 30 },
      { id: "env-aca", amount: 21 },
      { id: "env-app-runner", amount: 12.5 },
    ]);
    expect(assigned.other).toBeCloseTo(409, 6);
    expect(assigned.notOneApp).toBe(0);
    expect(assigned.total).toBeCloseTo(636.5, 6);
    expect(totalOf(assigned)).toBeCloseTo(assigned.total, 6);
  });

  test("a cost no Region is given for goes to the account's only environment of its platform, never to one of two", () => {
    // An organization's AWS costs are by account and service alone.
    const one: CloudPlatformCostShares = assignCloudCostsToEnvironments({
      rows: [
        row({ service: "AWS App Runner", region: "", amount: 15 }),
        row({
          service: "Amazon Elastic Container Service",
          region: "",
          amount: 70,
        }),
      ],
      environments: ENVIRONMENTS,
    });

    expect(one.shares).toEqual([{ id: "env-app-runner", amount: 15 }]);
    // Two ECS environments in the account: whose it is cannot be told.
    expect(one.other).toBe(70);
  });

  test("Elastic Beanstalk's resources, by the tag AWS gives them, in its account and Region", () => {
    const tagged: Array<CloudPlatformTaggedCostRow> = [
      {
        accountId: WEB_ACCOUNT,
        region: "eu-west-1",
        value: "storefront-prod",
        amount: 55,
      },
      {
        accountId: WEB_ACCOUNT,
        region: "eu-west-1",
        value: "storefront-staging",
        amount: 11,
      },
      // Without the tag: not Elastic Beanstalk's.
      { accountId: WEB_ACCOUNT, region: "eu-west-1", value: "", amount: 300 },
      // Another Region with no Elastic Beanstalk environment.
      {
        accountId: WEB_ACCOUNT,
        region: "us-east-1",
        value: "batch",
        amount: 6,
      },
    ];
    const assigned: CloudPlatformCostShares = assignCloudCostsToEnvironments({
      rows: [
        row({ region: "eu-west-1", amount: 366 }),
        row({ region: "us-east-1", amount: 6 }),
      ],
      taggedRows: tagged,
      environments: ENVIRONMENTS,
    });

    expect(assigned.shares).toEqual([{ id: "env-eb", amount: 66 }]);
    expect(assigned.total).toBe(372);
    expect(assigned.other).toBe(306);
    expect(totalOf(assigned)).toBe(372);
  });

  test("no environment: everything is other", () => {
    const assigned: CloudPlatformCostShares = assignCloudCostsToEnvironments({
      rows: [row({ amount: 10 }), row({ service: "Cloud Run", amount: 2 })],
      environments: [],
    });

    expect(assigned.shares).toEqual([]);
    expect(assigned.other).toBe(12);
    expect(assigned.total).toBe(12);
  });
});

describe("the spend by app", () => {
  const APPS: Array<CloudPlatformCostApp> = [
    { id: "app-checkout-run", environmentId: "env-run", name: "checkout" },
    { id: "app-search-run", environmentId: "env-run", name: "search" },
    { id: "app-checkout-aca", environmentId: "env-aca", name: "Checkout" },
    { id: "app-orders-ecs", environmentId: "env-ecs-east", name: "orders" },
    { id: "app-api-runner", environmentId: "env-app-runner", name: "api" },
    {
      id: "app-storefront-eb",
      environmentId: "env-eb",
      name: "storefront",
      groupName: "storefront-prod",
    },
  ];

  test("each app's billed resources by its name, in its own environment; what no one app is billed is the environment's", () => {
    const rows: Array<CloudPlatformCostRow> = [
      row({ service: "Amazon Elastic Container Service", amount: 120 }),
      row({ service: "AWS App Runner", amount: 12 }),
      row({ amount: 400 }),
      row({
        accountId: GCP_PROJECT,
        region: "europe-west1",
        service: "Cloud Run",
        amount: 44,
      }),
      row({
        accountId: SUBSCRIPTION,
        region: "westeurope",
        service: "Azure Container Apps",
        amount: 21,
      }),
    ];
    const resourceRows: Array<CloudPlatformCostRow> = [
      // ECS bills its tasks: no app by name.
      row({
        service: "Amazon Elastic Container Service",
        resourceId: "arn:aws:ecs:us-east-1:123456789012:task/main/0a1b2c3d4e5f",
        amount: 120,
      }),
      row({
        service: "AWS App Runner",
        resourceId:
          "arn:aws:apprunner:us-east-1:123456789012:service/api/7a8b9c",
        amount: 12,
      }),
      row({
        accountId: GCP_PROJECT,
        region: "europe-west1",
        service: "Cloud Run",
        resourceId:
          "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/checkout",
        amount: 30,
      }),
      row({
        accountId: GCP_PROJECT,
        region: "europe-west1",
        service: "Cloud Run",
        resourceId:
          "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/search",
        amount: 10,
      }),
      // A Cloud Run service no app here is: the environment's.
      row({
        accountId: GCP_PROJECT,
        region: "europe-west1",
        service: "Cloud Run",
        resourceId:
          "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/old-job",
        amount: 4,
      }),
      row({
        accountId: SUBSCRIPTION,
        region: "westeurope",
        service: "Azure Container Apps",
        resourceId:
          "/subscriptions/5f0c2d7e-9a41-4f3b-8c6e-1d2a3b4c5d6e/resourcegroups/shop/providers/microsoft.app/containerapps/checkout",
        amount: 21,
      }),
    ];

    const assigned: CloudPlatformCostShares = assignCloudCostsToApps({
      rows,
      resourceRows,
      environments: ENVIRONMENTS,
      apps: APPS,
    });

    // Two apps called checkout, each its own environment's.
    expect(assigned.shares).toEqual([
      { id: "app-checkout-run", amount: 30 },
      { id: "app-checkout-aca", amount: 21 },
      { id: "app-api-runner", amount: 12 },
      { id: "app-search-run", amount: 10 },
    ]);
    expect(assigned.notOneApp).toBe(124);
    expect(assigned.other).toBe(400);
    expect(assigned.total).toBe(597);
    expect(totalOf(assigned)).toBe(597);
  });

  test("an Elastic Beanstalk app is its environment's tagged resources, by the environment's name", () => {
    const assigned: CloudPlatformCostShares = assignCloudCostsToApps({
      rows: [row({ region: "eu-west-1", amount: 100 })],
      resourceRows: [],
      taggedRows: [
        {
          accountId: WEB_ACCOUNT,
          region: "eu-west-1",
          value: "storefront-prod",
          amount: 55,
        },
        {
          accountId: WEB_ACCOUNT,
          region: "eu-west-1",
          value: "storefront-staging",
          amount: 11,
        },
      ],
      environments: ENVIRONMENTS,
      apps: APPS,
    });

    expect(assigned.shares).toEqual([{ id: "app-storefront-eb", amount: 55 }]);
    expect(assigned.notOneApp).toBe(11);
    expect(assigned.other).toBe(34);
    expect(totalOf(assigned)).toBe(100);
  });

  test("a share that rounds to nothing is left out; ties are by id", () => {
    const assigned: CloudPlatformCostShares = assignCloudCostsToApps({
      rows: [row({ service: "Cloud Run", amount: 20.004 })],
      resourceRows: [
        row({
          accountId: GCP_PROJECT,
          region: "europe-west1",
          service: "Cloud Run",
          resourceId:
            "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/search",
          amount: 10,
        }),
        row({
          accountId: GCP_PROJECT,
          region: "europe-west1",
          service: "Cloud Run",
          resourceId:
            "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/checkout",
          amount: 10,
        }),
        row({
          accountId: GCP_PROJECT,
          region: "europe-west1",
          service: "Cloud Run",
          resourceId:
            "//run.googleapis.com/projects/acme-shop/locations/europe-west1/services/api",
          amount: 0.004,
        }),
      ],
      environments: ENVIRONMENTS,
      apps: [
        ...APPS,
        { id: "app-api-run", environmentId: "env-run", name: "api" },
      ],
    });

    expect(assigned.shares).toEqual([
      { id: "app-checkout-run", amount: 10 },
      { id: "app-search-run", amount: 10 },
    ]);
  });
});
