import { ManagedCloudPlatform } from "./CloudPlatform";

/*
 * WHAT EACH APP PLATFORMS ENVIRONMENT AND APP COSTS.
 *
 * An App Platforms environment is one platform in one account and Region
 * ("AWS ECS · us-east-1 · 123456789012", CloudPlatform): what it costs is
 * what its cloud bills that platform's service there - Amazon ECS, Cloud
 * Run, Azure Container Apps... An Elastic Beanstalk environment is free in
 * itself and bills what it runs (its instances, its load balancer), each
 * tagged with the environment's name by AWS: those, read by their tag.
 *
 * An app is what its platform bills one resource for, named as the app is:
 * a Cloud Run service, a Container App, a container group, an App Service
 * site, an App Runner service; an Elastic Beanstalk app the resources
 * tagged with its environment's name. A platform that bills no resource per
 * app - ECS bills its tasks, an App Service plan its sites together - is the
 * environment's cost, not one app's.
 *
 * React-free: Cloud > Costs breaks the spend down by environment and app
 * with it, from the costs summed by account, Region, service and resource.
 */

// What AWS tags an Elastic Beanstalk environment's resources with: its name.
export const ELASTIC_BEANSTALK_ENVIRONMENT_TAG: string =
  "elasticbeanstalk:environment-name";

/*
 * The services each platform is billed under, as its cloud's billing names
 * them (AWS Cost Explorer, Azure Cost Management, a Google Cloud billing
 * export). Elastic Beanstalk has none of its own.
 */
export const CLOUD_PLATFORM_BILLED_SERVICES: Readonly<
  Record<ManagedCloudPlatform, ReadonlyArray<string>>
> = {
  [ManagedCloudPlatform.AwsEcs]: ["Amazon Elastic Container Service"],
  [ManagedCloudPlatform.AwsElasticBeanstalk]: [],
  [ManagedCloudPlatform.AwsAppRunner]: ["AWS App Runner"],
  [ManagedCloudPlatform.GcpCloudRun]: ["Cloud Run"],
  [ManagedCloudPlatform.GcpAppEngine]: ["App Engine"],
  [ManagedCloudPlatform.AzureContainerApps]: ["Azure Container Apps"],
  [ManagedCloudPlatform.AzureContainerInstances]: ["Container Instances"],
  [ManagedCloudPlatform.AzureAppService]: ["Azure App Service"],
};

// Every service any platform is billed under: what a read by app asks for.
export const CLOUD_PLATFORM_ALL_BILLED_SERVICES: ReadonlyArray<string> =
  Array.from(
    new Set<string>(
      Object.values(CLOUD_PLATFORM_BILLED_SERVICES).flatMap(
        (services: ReadonlyArray<string>): Array<string> => {
          return [...services];
        },
      ),
    ),
  );

/*
 * The part of a billed resource's id that names an app, after its kind:
 * "//run.googleapis.com/projects/p/locations/r/services/checkout" ->
 * "checkout", ".../microsoft.app/containerapps/checkout" -> "checkout",
 * "arn:aws:apprunner:...:service/checkout/0a1b" -> "checkout".
 */
const APP_NAME_SEGMENTS: Readonly<
  Partial<Record<ManagedCloudPlatform, string>>
> = {
  [ManagedCloudPlatform.AwsAppRunner]: "service",
  [ManagedCloudPlatform.GcpCloudRun]: "services",
  [ManagedCloudPlatform.GcpAppEngine]: "services",
  [ManagedCloudPlatform.AzureContainerApps]: "containerapps",
  [ManagedCloudPlatform.AzureContainerInstances]: "containergroups",
  [ManagedCloudPlatform.AzureAppService]: "sites",
};

/*
 * The app a billed resource is of a platform, by its name: the segment
 * after the platform's kind of resource in its id - or null when the
 * platform bills no resource per app, or the id is not one of its kind.
 * A plain split, never a pattern: the id is the cloud's.
 */
export function getCloudPlatformBilledAppName(data: {
  platform: string;
  resourceId: string;
}): string | null {
  const segment: string | undefined =
    APP_NAME_SEGMENTS[data.platform as ManagedCloudPlatform];

  if (!segment || !data.resourceId) {
    return null;
  }

  // An ARN's resource is after its fifth colon: "service/checkout/0a1b".
  const id: string = data.resourceId.trim();
  const path: string = id.startsWith("arn:")
    ? id.split(":").slice(5).join(":")
    : id;
  const parts: Array<string> = path.split("/").filter((part: string) => {
    return part.length > 0;
  });

  for (let index: number = 0; index < parts.length - 1; index++) {
    if (parts[index]!.toLowerCase() === segment) {
      return parts[index + 1]!;
    }
  }

  return null;
}

// What a breakdown by environment or app is read from: the costs summed by these.
export interface CloudPlatformCostRow {
  // The account's id in its cloud.
  accountId: string;
  region: string;
  service: string;
  // "" for a read by service, or a cost no resource is billed for.
  resourceId?: string | undefined;
  amount: number;
}

// The costs carrying a tag, summed by account, Region and the tag's value.
export interface CloudPlatformTaggedCostRow {
  accountId: string;
  region: string;
  // "" for the costs without the tag.
  value: string;
  amount: number;
}

export interface CloudPlatformCostEnvironment {
  id: string;
  platform: string;
  // The account's id in its cloud, and its Region.
  accountId: string;
  region: string;
}

export interface CloudPlatformCostApp {
  id: string;
  environmentId: string;
  name: string;
  // What keeps two apps of one name apart: an Elastic Beanstalk environment's name.
  groupName?: string | undefined;
}

function same(a: string, b: string): boolean {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

/*
 * The environment a cost is of: one of its account and Region whose
 * platform its service is billed under - or, for a cost no Region is given
 * for (an organization's AWS costs, an Azure cost of a resource OneUptime
 * does not hold), the account's only environment of that platform.
 */
function findEnvironment(data: {
  row: { accountId: string; region: string; service: string };
  environments: Array<CloudPlatformCostEnvironment>;
}): CloudPlatformCostEnvironment | null {
  const ofService: Array<CloudPlatformCostEnvironment> =
    data.environments.filter((environment: CloudPlatformCostEnvironment) => {
      const services: ReadonlyArray<string> =
        CLOUD_PLATFORM_BILLED_SERVICES[
          environment.platform as ManagedCloudPlatform
        ] || [];

      return (
        same(environment.accountId, data.row.accountId) &&
        services.some((service: string): boolean => {
          return same(service, data.row.service);
        })
      );
    });

  const inRegion: Array<CloudPlatformCostEnvironment> = ofService.filter(
    (environment: CloudPlatformCostEnvironment): boolean => {
      return same(environment.region, data.row.region);
    },
  );

  if (inRegion.length > 0) {
    return inRegion[0]!;
  }

  return !data.row.region && ofService.length === 1 ? ofService[0]! : null;
}

// The Elastic Beanstalk environment a tagged cost is of, by account and Region.
function findElasticBeanstalkEnvironment(data: {
  row: CloudPlatformTaggedCostRow;
  environments: Array<CloudPlatformCostEnvironment>;
}): CloudPlatformCostEnvironment | null {
  const ofAccount: Array<CloudPlatformCostEnvironment> =
    data.environments.filter((environment: CloudPlatformCostEnvironment) => {
      return (
        environment.platform === ManagedCloudPlatform.AwsElasticBeanstalk &&
        same(environment.accountId, data.row.accountId)
      );
    });
  const inRegion: CloudPlatformCostEnvironment | undefined = ofAccount.find(
    (environment: CloudPlatformCostEnvironment): boolean => {
      return same(environment.region, data.row.region);
    },
  );

  if (inRegion) {
    return inRegion;
  }

  return !data.row.region && ofAccount.length === 1 ? ofAccount[0]! : null;
}

export interface CloudPlatformCostShares {
  // Each environment's or app's cost, by its id, the costliest first.
  shares: Array<{ id: string; amount: number }>;
  /*
   * Apps only: what an environment is billed that no one app is (ECS's
   * tasks, an App Service plan) - its environment's, not an app's.
   */
  notOneApp: number;
  // What is not an environment's at all.
  other: number;
  // Everything the rows add up to: the shares, notOneApp and other.
  total: number;
}

function sortShares(
  amounts: Map<string, number>,
): Array<{ id: string; amount: number }> {
  return Array.from(amounts.entries())
    .map(([id, amount]: [string, number]) => {
      return { id, amount };
    })
    .filter((share: { amount: number }): boolean => {
      return Math.abs(share.amount) >= 0.005;
    })
    .sort(
      (
        a: { id: string; amount: number },
        b: { id: string; amount: number },
      ): number => {
        return b.amount - a.amount || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
      },
    );
}

function sumOf(rows: Array<{ amount: number }>): number {
  return rows.reduce((sum: number, row: { amount: number }): number => {
    return sum + (Number(row.amount) || 0);
  }, 0);
}

/*
 * The spend by environment: each environment's platform services in its
 * account and Region, and its Elastic Beanstalk resources by their tag -
 * the rest of the spend left as other.
 */
export function assignCloudCostsToEnvironments(data: {
  // Every cost of the period, by account, Region and service.
  rows: Array<CloudPlatformCostRow>;
  // The Elastic Beanstalk tag's costs, by account and Region.
  taggedRows?: Array<CloudPlatformTaggedCostRow> | undefined;
  environments: Array<CloudPlatformCostEnvironment>;
}): CloudPlatformCostShares {
  const amounts: Map<string, number> = new Map();
  let assigned: number = 0;

  for (const row of data.rows) {
    const environment: CloudPlatformCostEnvironment | null = findEnvironment({
      row,
      environments: data.environments,
    });

    if (environment) {
      amounts.set(
        environment.id,
        (amounts.get(environment.id) || 0) + row.amount,
      );
      assigned += row.amount;
    }
  }

  for (const row of data.taggedRows || []) {
    if (!row.value) {
      continue;
    }

    const environment: CloudPlatformCostEnvironment | null =
      findElasticBeanstalkEnvironment({
        row,
        environments: data.environments,
      });

    if (environment) {
      amounts.set(
        environment.id,
        (amounts.get(environment.id) || 0) + row.amount,
      );
      assigned += row.amount;
    }
  }

  const total: number = sumOf(data.rows);

  return {
    shares: sortShares(amounts),
    notOneApp: 0,
    other: total - assigned,
    total,
  };
}

/*
 * The spend by app: each app's billed resources - found by its name in
 * their ids, in its own environment - and each Elastic Beanstalk app's
 * resources by its environment's tag. What an environment is billed that
 * is no one app's is notOneApp; the rest of the spend, other.
 */
export function assignCloudCostsToApps(data: {
  // Every cost of the period, by account, Region and service: the total.
  rows: Array<CloudPlatformCostRow>;
  // The platforms' costs, by account, Region, service and resource.
  resourceRows: Array<CloudPlatformCostRow>;
  taggedRows?: Array<CloudPlatformTaggedCostRow> | undefined;
  environments: Array<CloudPlatformCostEnvironment>;
  apps: Array<CloudPlatformCostApp>;
}): CloudPlatformCostShares {
  const amounts: Map<string, number> = new Map();
  let toApps: number = 0;
  let toEnvironments: number = 0;

  const appsOf: (environmentId: string) => Array<CloudPlatformCostApp> = (
    environmentId: string,
  ): Array<CloudPlatformCostApp> => {
    return data.apps.filter((app: CloudPlatformCostApp): boolean => {
      return app.environmentId === environmentId;
    });
  };

  for (const row of data.resourceRows) {
    const environment: CloudPlatformCostEnvironment | null = findEnvironment({
      row,
      environments: data.environments,
    });

    if (!environment) {
      continue;
    }

    toEnvironments += row.amount;

    const name: string | null = getCloudPlatformBilledAppName({
      platform: environment.platform,
      resourceId: row.resourceId || "",
    });
    const app: CloudPlatformCostApp | undefined = name
      ? appsOf(environment.id).find((candidate: CloudPlatformCostApp) => {
          return same(candidate.name, name);
        })
      : undefined;

    if (app) {
      amounts.set(app.id, (amounts.get(app.id) || 0) + row.amount);
      toApps += row.amount;
    }
  }

  for (const row of data.taggedRows || []) {
    if (!row.value) {
      continue;
    }

    const environment: CloudPlatformCostEnvironment | null =
      findElasticBeanstalkEnvironment({
        row,
        environments: data.environments,
      });

    if (!environment) {
      continue;
    }

    toEnvironments += row.amount;

    const app: CloudPlatformCostApp | undefined = appsOf(environment.id).find(
      (candidate: CloudPlatformCostApp): boolean => {
        return same(candidate.groupName || "", row.value);
      },
    );

    if (app) {
      amounts.set(app.id, (amounts.get(app.id) || 0) + row.amount);
      toApps += row.amount;
    }
  }

  const total: number = sumOf(data.rows);

  return {
    shares: sortShares(amounts),
    notOneApp: toEnvironments - toApps,
    other: total - toEnvironments,
    total,
  };
}
