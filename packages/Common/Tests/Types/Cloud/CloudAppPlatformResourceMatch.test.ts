import { describe, expect, test } from "@jest/globals";
import {
  APP_ENGINE_SERVICE_TYPE,
  APP_RUNNER_SERVICE_TYPE,
  APP_SERVICE_SITE_TYPE,
  APP_SERVICE_SLOT_TYPE,
  CLOUD_APP_PLATFORMS_WITH_RESOURCE,
  CLOUD_RUN_SERVICE_TYPE,
  CONTAINER_APP_TYPE,
  CloudAppPlatformEnvironment,
  CloudAppPlatformResourceSource,
  CloudAppServiceIdentity,
  CloudAppSiteMatch,
  CloudAppSiteResolution,
  CloudPlatformResourceCandidate,
  ECS_SERVICE_TYPE,
  getCloudAppPlatformResourceName,
  getCloudAppPlatformResourceType,
  getCloudAppServiceIdentity,
  getCloudAppSiteMatchOf,
  getEcsTaskDefinitionFamily,
  isCloudAppPlatformWithResource,
  matchCloudAppPlatformResource,
  resolveCloudAppPlatformResource,
} from "../../../Types/Cloud/CloudAppPlatformResourceMatch";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
} from "../../../Types/Cloud/CloudResourceCatalog";
import {
  SeededRandom,
  seededRandom,
  shuffled,
} from "../../Helpers/SeededRandom";

/*
 * THE RESOURCE EACH MANAGED PLATFORM'S APP RUNS AS (#6793, #6794).
 *
 * The server keeps it on the app and the page reads it, so the numbers an
 * app shows are its own resource's - never a neighbour's that shares a
 * name, a region, a cluster or a site. Per platform:
 *
 *   - an App Service app of a deployment slot: its own slot
 *     (Microsoft.Web/sites/slots), found from its site's id or by the site's
 *     and the slot's names - never the site, which its cloud.resource_id
 *     names, another slot, or a slot of a site that only starts alike;
 *   - a Container App: its cloud.resource_id's, else the one of its name in
 *     its subscription, its region first - never a similar name;
 *   - Cloud Run and App Engine: the service of its faas.name in its
 *     environment's project (and, for Cloud Run, region) - never another
 *     project's or region's, and none when two regions could be its;
 *   - App Runner: its cloud.resource_id's ARN, else the one of its name in
 *     its environment's account and Region;
 *   - ECS: the service of its cluster that runs its task definition family,
 *     else, for one whose task definition was never listed, the one named
 *     as the family - never another cluster's, never one that runs another
 *     family, and none when two run its family.
 *
 * Every answer is the same whatever order the rows come in.
 */

const SUBSCRIPTION: string = "d6252cc9-f01c-428b-924d-9896199f9a13";
const OTHER_SUBSCRIPTION: string = "3f1c9a52-7d4e-4b8a-9e21-6c5d0b7a2f13";
const PROJECT: string = "shop-prod";
const ACCOUNT: string = "123456789012";

interface Row extends CloudPlatformResourceCandidate {
  label: string;
}

function row(
  label: string,
  providerResourceId: string,
  fields: Partial<Row> = {},
): Row {
  return { label, providerResourceId, ...fields };
}

function labelOf(match: Row | null): string | null {
  return match ? match.label : null;
}

function siteId(
  name: string,
  subscription: string = SUBSCRIPTION,
  group: string = "rg-web",
): string {
  return `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.Web/sites/${name}`;
}

function containerAppId(
  name: string,
  subscription: string = SUBSCRIPTION,
  group: string = "rg-apps",
): string {
  return `/subscriptions/${subscription}/resourceGroups/${group}/providers/Microsoft.App/containerApps/${name}`;
}

function runId(
  service: string,
  project: string = PROJECT,
  region: string = "us-central1",
): string {
  return `//run.googleapis.com/projects/${project}/locations/${region}/services/${service}`;
}

function appEngineId(service: string, project: string = PROJECT): string {
  return `//appengine.googleapis.com/apps/${project}/services/${service}`;
}

function appRunnerArn(
  service: string,
  region: string = "us-east-1",
  account: string = ACCOUNT,
): string {
  return `arn:aws:apprunner:${region}:${account}:service/${service}/8fe1e10304f84fd2b0df550fe98a71fa`;
}

function ecsArn(
  cluster: string,
  service: string,
  region: string = "us-east-1",
  account: string = ACCOUNT,
): string {
  return `arn:aws:ecs:${region}:${account}:service/${cluster}/${service}`;
}

function taskDefinition(family: string, revision: number = 7): unknown {
  return {
    TaskDefinition: `arn:aws:ecs:us-east-1:${ACCOUNT}:task-definition/${family}:${revision}`,
  };
}

function resolve(data: {
  app: CloudAppPlatformResourceSource;
  candidates: Array<Row>;
  environment?: CloudAppPlatformEnvironment;
}): CloudAppSiteResolution<Row> {
  return resolveCloudAppPlatformResource(data);
}

// The label each order of the rows picks: always one.
function pickedInEveryOrder(data: {
  app: CloudAppPlatformResourceSource;
  candidates: Array<Row>;
  environment?: CloudAppPlatformEnvironment;
  seed: number;
}): Array<string | null> {
  const random: SeededRandom = seededRandom(data.seed);
  const picked: Set<string | null> = new Set<string | null>();

  for (let draw: number = 0; draw < 100; draw++) {
    picked.add(
      labelOf(
        matchCloudAppPlatformResource({
          app: data.app,
          candidates: shuffled(data.candidates, random),
          environment: data.environment,
        }),
      ),
    );
  }

  return Array.from(picked);
}

describe("which platforms run an app as a resource a connection reads", () => {
  test("App Service, Container Apps, Cloud Run, App Engine, ECS and App Runner - and each type is the catalog's", () => {
    expect([...CLOUD_APP_PLATFORMS_WITH_RESOURCE].sort()).toEqual(
      [
        ManagedCloudPlatform.AzureAppService,
        ManagedCloudPlatform.AzureContainerApps,
        ManagedCloudPlatform.GcpCloudRun,
        ManagedCloudPlatform.GcpAppEngine,
        ManagedCloudPlatform.AwsEcs,
        ManagedCloudPlatform.AwsAppRunner,
      ].sort(),
    );

    const catalog: Set<string> = new Set<string>(
      CLOUD_RESOURCE_TYPES.map(
        (descriptor: CloudResourceTypeDescriptor): string => {
          return descriptor.type;
        },
      ),
    );

    for (const type of [
      APP_SERVICE_SITE_TYPE,
      APP_SERVICE_SLOT_TYPE,
      CONTAINER_APP_TYPE,
      CLOUD_RUN_SERVICE_TYPE,
      APP_ENGINE_SERVICE_TYPE,
      ECS_SERVICE_TYPE,
      APP_RUNNER_SERVICE_TYPE,
    ]) {
      expect({ type, inCatalog: catalog.has(type) }).toEqual({
        type,
        inCatalog: true,
      });
    }
  });

  test("Elastic Beanstalk and Container Instances do not, nor an unknown platform", () => {
    expect(
      isCloudAppPlatformWithResource(ManagedCloudPlatform.AwsElasticBeanstalk),
    ).toBe(false);
    expect(
      isCloudAppPlatformWithResource(
        ManagedCloudPlatform.AzureContainerInstances,
      ),
    ).toBe(false);
    expect(isCloudAppPlatformWithResource("gcp_compute_engine")).toBe(false);
    expect(isCloudAppPlatformWithResource(null)).toBe(false);
  });

  test("the type each app runs as, an App Service app's by its slot", () => {
    const typeOf: (cloudPlatform: string, groupName?: string) => string | null = (
      cloudPlatform: string,
      groupName?: string,
    ): string | null => {
      return getCloudAppPlatformResourceType({
        name: "checkout",
        cloudPlatform,
        groupName,
      });
    };

    expect(typeOf(ManagedCloudPlatform.AzureAppService)).toBe(
      APP_SERVICE_SITE_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.AzureAppService, "production")).toBe(
      APP_SERVICE_SITE_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.AzureAppService, "staging")).toBe(
      APP_SERVICE_SLOT_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.AzureContainerApps)).toBe(
      CONTAINER_APP_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.GcpCloudRun)).toBe(
      CLOUD_RUN_SERVICE_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.GcpAppEngine)).toBe(
      APP_ENGINE_SERVICE_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.AwsEcs, "prod")).toBe(ECS_SERVICE_TYPE);
    expect(typeOf(ManagedCloudPlatform.AwsAppRunner)).toBe(
      APP_RUNNER_SERVICE_TYPE,
    );
    expect(typeOf(ManagedCloudPlatform.AwsElasticBeanstalk)).toBeNull();
  });

  test("the name it is looked up by: a Container App's from its cloud.resource_id, else the app's", () => {
    expect(
      getCloudAppPlatformResourceName({
        name: "Checkout API",
        cloudPlatform: ManagedCloudPlatform.AzureContainerApps,
        providerResourceId: containerAppId("checkout-prod"),
      }),
    ).toBe("checkout-prod");
    expect(
      getCloudAppPlatformResourceName({
        name: " checkout ",
        cloudPlatform: ManagedCloudPlatform.AzureContainerApps,
        providerResourceId: siteId("checkout"),
      }),
    ).toBe("checkout");
    expect(
      getCloudAppPlatformResourceName({
        name: " checkout ",
        cloudPlatform: ManagedCloudPlatform.GcpCloudRun,
      }),
    ).toBe("checkout");
  });
});

describe("an App Service app of a deployment slot: its own slot (#6793)", () => {
  const SITE: Row = row("site", siteId("checkout-api"));
  const STAGING: Row = row("staging", `${siteId("checkout-api")}/slots/staging`);
  const QA: Row = row("qa", `${siteId("checkout-api")}/slots/qa`);
  const OTHER_GROUP: Row = row(
    "staging, other group",
    `${siteId("checkout-api", SUBSCRIPTION, "rg-other")}/slots/staging`,
  );
  const OTHER_SUBSCRIPTION_SLOT: Row = row(
    "staging, other subscription",
    `${siteId("checkout-api", OTHER_SUBSCRIPTION)}/slots/staging`,
  );
  const LOOKALIKE: Row = row(
    "v2 staging",
    `${siteId("checkout-api-v2")}/slots/staging`,
  );

  function slotApp(
    fields: Partial<CloudAppPlatformResourceSource> = {},
  ): CloudAppPlatformResourceSource {
    return {
      name: "checkout-api",
      cloudPlatform: ManagedCloudPlatform.AzureAppService,
      groupName: "staging",
      ...fields,
    };
  }

  test("by the slot of the site its cloud.resource_id names, without regard to case", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: slotApp({
        providerResourceId: siteId(
          "checkout-api",
          SUBSCRIPTION,
          "rg-other",
        ).toUpperCase(),
      }),
      candidates: [SITE, STAGING, OTHER_GROUP],
    });

    expect(labelOf(resolution.site)).toBe("staging, other group");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
  });

  test("never the site its cloud.resource_id names: with no slot read, none", () => {
    expect(
      resolve({
        app: slotApp({ providerResourceId: siteId("checkout-api") }),
        candidates: [SITE],
      }).site,
    ).toBeNull();
  });

  test("by the site's and the slot's names in its subscription - never another slot, a lookalike site's, or another subscription's", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: slotApp(),
      candidates: [SITE, QA, LOOKALIKE, OTHER_SUBSCRIPTION_SLOT, STAGING],
      environment: { cloudAccountId: SUBSCRIPTION },
    });

    expect(labelOf(resolution.site)).toBe("staging");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.Name);

    const elsewhere: CloudAppSiteResolution<Row> = resolve({
      app: slotApp(),
      candidates: [SITE, QA, OTHER_SUBSCRIPTION_SLOT],
      environment: { cloudAccountId: SUBSCRIPTION },
    });

    expect(elsewhere.site).toBeNull();
    expect(elsewhere.elsewhere.map(labelOf)).toEqual([
      "staging, other subscription",
    ]);
  });

  test("a slot id set by hand names the slot itself", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: slotApp({
            providerResourceId: `${siteId("checkout-api")}/slots/staging`,
          }),
          candidates: [SITE, QA, STAGING],
        }),
      ),
    ).toBe("staging");
  });

  test("how a kept slot was found, said again from the ids", () => {
    expect(
      getCloudAppSiteMatchOf({
        app: slotApp({ providerResourceId: siteId("checkout-api") }),
        site: STAGING,
      }),
    ).toBe(CloudAppSiteMatch.ResourceId);
    expect(getCloudAppSiteMatchOf({ app: slotApp(), site: STAGING })).toBe(
      CloudAppSiteMatch.Name,
    );
  });

  test("the same slot whatever order the rows come in", () => {
    expect(
      pickedInEveryOrder({
        app: slotApp(),
        candidates: [
          SITE,
          QA,
          LOOKALIKE,
          OTHER_SUBSCRIPTION_SLOT,
          row("staging, older", `${siteId("checkout-api")}/slots/staging`, {
            lastSeenAt: "2026-11-10T00:00:00.000Z",
          }),
          row("staging, latest", `${siteId("checkout-api")}/slots/Staging`, {
            lastSeenAt: "2026-11-11T00:00:00.000Z",
          }),
        ],
        environment: { cloudAccountId: SUBSCRIPTION },
        seed: 6793,
      }),
    ).toEqual(["staging, latest"]);
  });
});

describe("a Container App (#6794)", () => {
  const CHECKOUT: Row = row("checkout", containerAppId("checkout"), {
    cloudRegion: "eastus",
  });
  const CHECKOUT_WEST: Row = row(
    "checkout, west",
    containerAppId("checkout", SUBSCRIPTION, "rg-west"),
    { cloudRegion: "westeurope" },
  );
  const CHECKOUT_V2: Row = row("checkout-v2", containerAppId("checkout-v2"));
  const OTHER_SUBSCRIPTION_APP: Row = row(
    "checkout, other subscription",
    containerAppId("checkout", OTHER_SUBSCRIPTION),
  );
  // A site of the same name is no Container App.
  const SITE: Row = row("site", siteId("checkout"));

  function containerApp(
    fields: Partial<CloudAppPlatformResourceSource> = {},
  ): CloudAppPlatformResourceSource {
    return {
      name: "checkout",
      cloudPlatform: ManagedCloudPlatform.AzureContainerApps,
      ...fields,
    };
  }

  test("by its cloud.resource_id first", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: containerApp({ providerResourceId: CHECKOUT_WEST.providerResourceId! }),
      candidates: [CHECKOUT, CHECKOUT_WEST],
      environment: { cloudAccountId: SUBSCRIPTION, cloudRegion: "East US" },
    });

    expect(labelOf(resolution.site)).toBe("checkout, west");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
  });

  test("else by its name in its subscription, its region first", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: containerApp(),
          candidates: [SITE, CHECKOUT_V2, OTHER_SUBSCRIPTION_APP, CHECKOUT_WEST, CHECKOUT],
          environment: { cloudAccountId: SUBSCRIPTION, cloudRegion: "East US" },
        }),
      ),
    ).toBe("checkout");
  });

  test("never a site, a similar name, or another subscription's", () => {
    expect(
      matchCloudAppPlatformResource({
        app: containerApp(),
        candidates: [SITE, CHECKOUT_V2, OTHER_SUBSCRIPTION_APP],
        environment: { cloudAccountId: SUBSCRIPTION },
      }),
    ).toBeNull();
  });

  test("the same one whatever order the rows come in", () => {
    expect(
      pickedInEveryOrder({
        app: containerApp(),
        candidates: [SITE, CHECKOUT_V2, OTHER_SUBSCRIPTION_APP, CHECKOUT_WEST, CHECKOUT],
        environment: { cloudAccountId: SUBSCRIPTION, cloudRegion: "eastus" },
        seed: 67941,
      }),
    ).toEqual(["checkout"]);
  });
});

describe("a Cloud Run service (#6794)", () => {
  const CHECKOUT: Row = row("checkout", runId("checkout"));
  const CHECKOUT_EUROPE: Row = row(
    "checkout, europe",
    runId("checkout", PROJECT, "europe-west1"),
  );
  const CHECKOUT_STAGING_PROJECT: Row = row(
    "checkout, staging project",
    runId("checkout", "shop-staging"),
  );
  const CHECKOUT_V2: Row = row("checkout-v2", runId("checkout-v2"));
  // A job of the same name is no service.
  const JOB: Row = row(
    "checkout job",
    `//run.googleapis.com/projects/${PROJECT}/locations/us-central1/jobs/checkout`,
  );
  const EVERY: Array<Row> = [
    JOB,
    CHECKOUT_V2,
    CHECKOUT_STAGING_PROJECT,
    CHECKOUT_EUROPE,
    CHECKOUT,
  ];

  function runApp(
    fields: Partial<CloudAppPlatformResourceSource> = {},
  ): CloudAppPlatformResourceSource {
    return {
      name: "checkout",
      cloudPlatform: ManagedCloudPlatform.GcpCloudRun,
      ...fields,
    };
  }

  test("the service of its name in its environment's project and region", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: runApp(),
      candidates: EVERY,
      environment: { cloudAccountId: PROJECT, cloudRegion: "us-central1" },
    });

    expect(labelOf(resolution.site)).toBe("checkout");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.Name);
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: runApp(),
          candidates: EVERY,
          environment: { cloudAccountId: PROJECT, cloudRegion: "europe-west1" },
        }),
      ),
    ).toBe("checkout, europe");
  });

  test("never another region's, another project's, a similar name or a job", () => {
    expect(
      matchCloudAppPlatformResource({
        app: runApp(),
        candidates: [JOB, CHECKOUT_V2, CHECKOUT_STAGING_PROJECT, CHECKOUT_EUROPE],
        environment: { cloudAccountId: PROJECT, cloudRegion: "us-central1" },
      }),
    ).toBeNull();
  });

  test("none when its environment names no region and two regions hold one", () => {
    expect(
      matchCloudAppPlatformResource({
        app: runApp(),
        candidates: EVERY,
        environment: { cloudAccountId: PROJECT },
      }),
    ).toBeNull();
    // One region: it is the one.
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: runApp(),
          candidates: [CHECKOUT, CHECKOUT_V2],
          environment: { cloudAccountId: PROJECT },
        }),
      ),
    ).toBe("checkout");
  });

  test("by a cloud.resource_id set to the service's full name", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: runApp({ name: "checkout-api", providerResourceId: runId("checkout", PROJECT, "europe-west1") }),
      candidates: EVERY,
      environment: { cloudAccountId: PROJECT, cloudRegion: "us-central1" },
    });

    expect(labelOf(resolution.site)).toBe("checkout, europe");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
  });

  test("the same one whatever order the rows come in", () => {
    expect(
      pickedInEveryOrder({
        app: runApp(),
        candidates: [
          ...EVERY,
          row("checkout, seen later", runId("checkout"), {
            lastSeenAt: "2026-11-20T00:00:00.000Z",
          }),
        ],
        environment: { cloudAccountId: PROJECT, cloudRegion: "us-central1" },
        seed: 67942,
      }),
    ).toEqual(["checkout, seen later"]);
  });
});

describe("an App Engine service (#6794)", () => {
  const DEFAULT: Row = row("default", appEngineId("default"));
  const API: Row = row("api", appEngineId("api"));
  const API_STAGING_PROJECT: Row = row(
    "api, staging project",
    appEngineId("api", "shop-staging"),
  );
  const API_V2: Row = row("api-v2", appEngineId("api-v2"));

  function gaeApp(name: string): CloudAppPlatformResourceSource {
    return { name, cloudPlatform: ManagedCloudPlatform.GcpAppEngine };
  }

  test("the service of its name in its environment's project, whatever its region says", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: gaeApp("api"),
          candidates: [DEFAULT, API_V2, API_STAGING_PROJECT, API],
          environment: { cloudAccountId: PROJECT, cloudRegion: "us-central1" },
        }),
      ),
    ).toBe("api");
  });

  test("never another project's, the default service, or a similar name", () => {
    expect(
      matchCloudAppPlatformResource({
        app: gaeApp("api"),
        candidates: [DEFAULT, API_V2, API_STAGING_PROJECT],
        environment: { cloudAccountId: PROJECT },
      }),
    ).toBeNull();
  });

  test("the same one whatever order the rows come in", () => {
    expect(
      pickedInEveryOrder({
        app: gaeApp("api"),
        candidates: [DEFAULT, API_V2, API_STAGING_PROJECT, API],
        environment: { cloudAccountId: PROJECT },
        seed: 67943,
      }),
    ).toEqual(["api"]);
  });
});

describe("an App Runner service (#6794)", () => {
  const CHECKOUT: Row = row("checkout", appRunnerArn("checkout"));
  const CHECKOUT_WEST: Row = row(
    "checkout, west",
    appRunnerArn("checkout", "us-west-2"),
  );
  const CHECKOUT_OTHER_ACCOUNT: Row = row(
    "checkout, other account",
    appRunnerArn("checkout", "us-east-1", "999999999999"),
  );
  const CHECKOUT_API: Row = row("checkout-api", appRunnerArn("checkout-api"));
  // Named by its metrics alone: its account and Region are its row's.
  const COMPOSITE: Row = row(
    "checkout, by its metrics",
    "AWS/AppRunner ServiceName=checkout",
    { cloudAccountId: ACCOUNT, cloudRegion: "us-east-1" },
  );

  function appRunnerApp(
    fields: Partial<CloudAppPlatformResourceSource> = {},
  ): CloudAppPlatformResourceSource {
    return {
      name: "checkout",
      cloudPlatform: ManagedCloudPlatform.AwsAppRunner,
      ...fields,
    };
  }

  const ENVIRONMENT: CloudAppPlatformEnvironment = {
    cloudAccountId: ACCOUNT,
    cloudRegion: "us-east-1",
  };

  test("by the ARN its cloud.resource_id names", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: appRunnerApp({ providerResourceId: CHECKOUT_WEST.providerResourceId! }),
      candidates: [CHECKOUT, CHECKOUT_WEST],
      environment: ENVIRONMENT,
    });

    expect(labelOf(resolution.site)).toBe("checkout, west");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.ResourceId);
  });

  test("else the service of its name in its environment's account and Region", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appRunnerApp(),
          candidates: [CHECKOUT_API, CHECKOUT_OTHER_ACCOUNT, CHECKOUT_WEST, CHECKOUT],
          environment: ENVIRONMENT,
        }),
      ),
    ).toBe("checkout");
  });

  test("a row named by its metrics alone, by its account and Region", () => {
    expect(
      labelOf(
        matchCloudAppPlatformResource({
          app: appRunnerApp(),
          candidates: [CHECKOUT_WEST, COMPOSITE],
          environment: ENVIRONMENT,
        }),
      ),
    ).toBe("checkout, by its metrics");
  });

  test("never another account's, another Region's, or a similar name", () => {
    expect(
      matchCloudAppPlatformResource({
        app: appRunnerApp(),
        candidates: [CHECKOUT_API, CHECKOUT_OTHER_ACCOUNT, CHECKOUT_WEST],
        environment: ENVIRONMENT,
      }),
    ).toBeNull();
  });

  test("the same one whatever order the rows come in", () => {
    expect(
      pickedInEveryOrder({
        app: appRunnerApp(),
        candidates: [CHECKOUT_API, CHECKOUT_OTHER_ACCOUNT, CHECKOUT_WEST, CHECKOUT],
        environment: ENVIRONMENT,
        seed: 67944,
      }),
    ).toEqual(["checkout"]);
  });
});

describe("an ECS service (#6794)", () => {
  const ENVIRONMENT: CloudAppPlatformEnvironment = {
    cloudAccountId: ACCOUNT,
    cloudRegion: "us-east-1",
  };

  function ecsApp(
    fields: Partial<CloudAppPlatformResourceSource> = {},
  ): CloudAppPlatformResourceSource {
    return {
      name: "checkout",
      groupName: "prod",
      cloudPlatform: ManagedCloudPlatform.AwsEcs,
      ...fields,
    };
  }

  // The service runs the family under a name of its own.
  const WEB: Row = row("web", ecsArn("prod", "web"), {
    cloudProperties: taskDefinition("checkout"),
  });
  const STAGING_WEB: Row = row("staging web", ecsArn("staging", "web"), {
    cloudProperties: taskDefinition("checkout"),
  });
  const NAMED_CHECKOUT_OTHER_FAMILY: Row = row(
    "checkout, runs another family",
    ecsArn("prod", "checkout"),
    { cloudProperties: taskDefinition("checkout-v2") },
  );
  const UNLISTED_CHECKOUT: Row = row(
    "checkout, task definition never listed",
    ecsArn("prod", "checkout"),
  );

  test("the service of its cluster that runs its task definition family, whatever the service is called", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: ecsApp(),
      candidates: [STAGING_WEB, NAMED_CHECKOUT_OTHER_FAMILY, WEB],
      environment: ENVIRONMENT,
    });

    expect(labelOf(resolution.site)).toBe("web");
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.TaskDefinition);
  });

  test("never another cluster's, and never one named as the family that runs another", () => {
    expect(
      matchCloudAppPlatformResource({
        app: ecsApp(),
        candidates: [STAGING_WEB, NAMED_CHECKOUT_OTHER_FAMILY],
        environment: ENVIRONMENT,
      }),
    ).toBeNull();
  });

  test("a service whose task definition was never listed, by the family's name", () => {
    const resolution: CloudAppSiteResolution<Row> = resolve({
      app: ecsApp(),
      candidates: [STAGING_WEB, UNLISTED_CHECKOUT],
      environment: ENVIRONMENT,
    });

    expect(labelOf(resolution.site)).toBe(
      "checkout, task definition never listed",
    );
    expect(resolution.matchedBy).toBe(CloudAppSiteMatch.Name);
  });

  test("none when two services of its cluster run its family: either's numbers would be half its own", () => {
    expect(
      matchCloudAppPlatformResource({
        app: ecsApp(),
        candidates: [
          WEB,
          row("web canary", ecsArn("prod", "web-canary"), {
            cloudProperties: taskDefinition("checkout", 8),
          }),
        ],
        environment: ENVIRONMENT,
      }),
    ).toBeNull();
  });

  test("none with no cluster, or of another account or Region", () => {
    expect(
      matchCloudAppPlatformResource({
        app: ecsApp({ groupName: "" }),
        candidates: [WEB],
        environment: ENVIRONMENT,
      }),
    ).toBeNull();
    expect(
      matchCloudAppPlatformResource({
        app: ecsApp(),
        candidates: [
          row("web, west", ecsArn("prod", "web", "us-west-2"), {
            cloudProperties: taskDefinition("checkout"),
          }),
          row("web, other account", ecsArn("prod", "web", "us-east-1", "999999999999"), {
            cloudProperties: taskDefinition("checkout"),
          }),
        ],
        environment: ENVIRONMENT,
      }),
    ).toBeNull();
  });

  test("the same one whatever order the rows come in", () => {
    expect(
      pickedInEveryOrder({
        app: ecsApp(),
        candidates: [STAGING_WEB, NAMED_CHECKOUT_OTHER_FAMILY, WEB],
        environment: ENVIRONMENT,
        seed: 67945,
      }),
    ).toEqual(["web"]);
  });
});

describe("a service's identity, read from its id", () => {
  test("each platform's id, and the account and Region a row says where its id does not", () => {
    const identityOf: (
      platform: string,
      candidate: CloudPlatformResourceCandidate,
    ) => CloudAppServiceIdentity | null = getCloudAppServiceIdentity;

    expect(
      identityOf(ManagedCloudPlatform.GcpCloudRun, {
        providerResourceId: runId("Checkout"),
      }),
    ).toEqual({
      name: "checkout",
      account: PROJECT,
      region: "us-central1",
      cluster: "",
      taskFamily: "",
    });
    expect(
      identityOf(ManagedCloudPlatform.GcpAppEngine, {
        providerResourceId: appEngineId("default"),
      }),
    ).toEqual({
      name: "default",
      account: PROJECT,
      region: "",
      cluster: "",
      taskFamily: "",
    });
    expect(
      identityOf(ManagedCloudPlatform.AwsAppRunner, {
        providerResourceId: appRunnerArn("checkout"),
      }),
    ).toEqual({
      name: "checkout",
      account: ACCOUNT,
      region: "us-east-1",
      cluster: "",
      taskFamily: "",
    });
    expect(
      identityOf(ManagedCloudPlatform.AwsEcs, {
        providerResourceId: "AWS/ECS ClusterName=prod ServiceName=web",
        cloudAccountId: ACCOUNT,
        cloudRegion: "us-east-1",
        cloudProperties: taskDefinition("Checkout"),
      }),
    ).toEqual({
      name: "web",
      account: ACCOUNT,
      region: "us-east-1",
      cluster: "prod",
      taskFamily: "checkout",
    });
  });

  test("none for another type's id, or no id", () => {
    expect(
      getCloudAppServiceIdentity(ManagedCloudPlatform.GcpCloudRun, {
        providerResourceId: appEngineId("default"),
      }),
    ).toBeNull();
    expect(
      getCloudAppServiceIdentity(ManagedCloudPlatform.AwsEcs, {
        providerResourceId: appRunnerArn("checkout"),
      }),
    ).toBeNull();
    expect(
      getCloudAppServiceIdentity(ManagedCloudPlatform.AwsAppRunner, {}),
    ).toBeNull();
    expect(
      getCloudAppServiceIdentity(ManagedCloudPlatform.AzureAppService, {
        providerResourceId: siteId("checkout"),
      }),
    ).toBeNull();
  });

  test("a task definition's family, from its ARN or its family and revision", () => {
    expect(
      getEcsTaskDefinitionFamily(
        `arn:aws:ecs:us-east-1:${ACCOUNT}:task-definition/checkout:42`,
      ),
    ).toBe("checkout");
    expect(getEcsTaskDefinitionFamily("checkout:42")).toBe("checkout");
    expect(getEcsTaskDefinitionFamily("checkout")).toBe("checkout");
    expect(getEcsTaskDefinitionFamily("arn:aws:ecs:us-east-1:1:cluster")).toBe(
      "",
    );
    expect(getEcsTaskDefinitionFamily(42)).toBe("");
    expect(getEcsTaskDefinitionFamily(undefined)).toBe("");
  });
});
