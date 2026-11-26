import CloudApp from "../../../Models/DatabaseModels/CloudApp";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import { getCloudCostResourceKey } from "../../../Types/Cloud/CloudCost";
import { ManagedCloudPlatform } from "../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_PLATFORM_ALL_BILLED_SERVICES,
  CLOUD_PLATFORM_BILLED_SERVICES,
  getCloudPlatformBilledAppName,
} from "../../../Types/Cloud/CloudPlatformCosts";
import { CloudResourceKind } from "../../../Types/Cloud/CloudResourceKind";
import {
  CloudCostRule,
  CloudCostRuleField,
  getCloudCostRuleFields,
  getCloudCostRuleIds,
  rulesAskAboutOwners,
} from "../../../Types/Cloud/CloudCostRules";
import Includes from "../../../Types/BaseDatabase/Includes";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import ObjectID from "../../../Types/ObjectID";
import CloudAppService from "../../Services/CloudAppService";
import CloudResourceService from "../../Services/CloudResourceService";
import {
  CloudCostAppFact,
  CloudCostEnvironmentFact,
  CloudCostQueryFacts,
  emptyCloudCostQueryFacts,
} from "./CloudCostAllocationQuery";
import { createHash } from "crypto";

/*
 * WHAT A VIEW'S RULES READ THAT THE COSTS DO NOT CARRY, FROM POSTGRES.
 *
 * Loaded once per read, for the one project, and only what the view's
 * rules ask about:
 *
 *   - owner teams: every resource of the project with owner teams, and
 *     all of its teams - a resource owned by two teams is split between
 *     both, whichever of them a rule names;
 *   - labels: the resources and accounts carrying a label a rule names;
 *   - App Platforms: the environments a rule names (or whose apps it
 *     names), and each named app's billed resources.
 *
 * A resource is named to ClickHouse by the hash of the key its costs are
 * billed under (getCloudCostResourceKey), exactly as CloudCostAllocationQuery
 * hashes CloudCost.resourceId: left(hex(MD5(key)), 16).
 */

// How ClickHouse names a resource's key: left(hex(MD5(resourceId)), 16).
export function hashCloudCostResourceKey(resourceKey: string): string {
  return createHash("md5")
    .update(resourceKey, "utf8")
    .digest("hex")
    .slice(0, 16)
    .toUpperCase();
}

interface ResourceFactRow {
  provider: string | null;
  providerResourceId: string | null;
  ids: Array<string> | string | null;
}

// Postgres answers an array as one, or as its text form "{a,b}".
function readIds(value: Array<string> | string | null): Array<string> {
  if (!value) {
    return [];
  }

  if (Array.isArray(value)) {
    return value
      .map((id: string): string => {
        return String(id).toLowerCase();
      })
      .filter((id: string): boolean => {
        return id.length > 0;
      });
  }

  return String(value)
    .replace(/^\{|\}$/g, "")
    .split(",")
    .map((id: string): string => {
      return id.trim().replace(/^"|"$/g, "").toLowerCase();
    })
    .filter((id: string): boolean => {
      return id.length > 0 && id !== "null";
    });
}

/*
 * The resource rows' facts, by the key their costs are billed under. Two
 * resources under one key (one seen twice) keep the facts of both.
 */
function byResourceKey(rows: Array<ResourceFactRow>): Map<string, Set<string>> {
  const facts: Map<string, Set<string>> = new Map();

  for (const row of rows) {
    const key: string = getCloudCostResourceKey(
      row.provider || "",
      row.providerResourceId || "",
    );

    if (!key) {
      continue;
    }

    const ids: Set<string> = facts.get(key) || new Set();

    for (const id of readIds(row.ids)) {
      ids.add(id);
    }

    facts.set(key, ids);
  }

  return facts;
}

export interface CloudCostPlatformResourceRow {
  accountId: string;
  region: string;
  service: string;
  resourceId: string;
}

export default class CloudCostAllocationFacts {
  // Each resource's owner teams, by the key its costs are billed under.
  public static async readOwnerTeams(
    projectId: ObjectID,
  ): Promise<Map<string, Set<string>>> {
    const rows: Array<ResourceFactRow> =
      await CloudResourceService.getRepository().manager.query(
        `SELECT r."cloudProvider" AS "provider", r."providerResourceId" AS "providerResourceId",
                array_agg(DISTINCT o."teamId"::text) AS "ids"
           FROM "CloudResourceOwnerTeam" o
           JOIN "CloudResource" r ON r."_id" = o."cloudResourceId"
          WHERE o."projectId" = $1
            AND r."projectId" = $1
            AND o."deletedAt" IS NULL
            AND r."deletedAt" IS NULL
            AND COALESCE(r."providerResourceId", '') <> ''
          GROUP BY r."_id", r."cloudProvider", r."providerResourceId"`,
        [projectId.toString()],
      );

    return byResourceKey(rows);
  }

  // The labels a rule names, by the key each resource's costs are billed under.
  public static async readResourceLabels(data: {
    projectId: ObjectID;
    labelIds: Array<string>;
  }): Promise<Map<string, Set<string>>> {
    if (data.labelIds.length === 0) {
      return new Map();
    }

    const rows: Array<ResourceFactRow> =
      await CloudResourceService.getRepository().manager.query(
        `SELECT r."cloudProvider" AS "provider", r."providerResourceId" AS "providerResourceId",
                array_agg(DISTINCT l."labelId"::text) AS "ids"
           FROM "CloudResourceLabel" l
           JOIN "CloudResource" r ON r."_id" = l."cloudResourceId"
          WHERE r."projectId" = $1
            AND r."deletedAt" IS NULL
            AND COALESCE(r."providerResourceId", '') <> ''
            AND l."labelId"::text = ANY($2::text[])
          GROUP BY r."_id", r."cloudProvider", r."providerResourceId"`,
        [data.projectId.toString(), data.labelIds],
      );

    return byResourceKey(rows);
  }

  // The labels a rule names, by the CloudAccount carrying them.
  public static async readAccountLabels(data: {
    projectId: ObjectID;
    labelIds: Array<string>;
  }): Promise<Map<string, Array<string>>> {
    if (data.labelIds.length === 0) {
      return new Map();
    }

    const rows: Array<{ accountId: string; ids: Array<string> | string }> =
      await CloudResourceService.getRepository().manager.query(
        `SELECT a."_id"::text AS "accountId", array_agg(DISTINCT l."labelId"::text) AS "ids"
           FROM "CloudAccountLabel" l
           JOIN "CloudAccount" a ON a."_id" = l."cloudAccountId"
          WHERE a."projectId" = $1
            AND a."deletedAt" IS NULL
            AND l."labelId"::text = ANY($2::text[])
          GROUP BY a."_id"`,
        [data.projectId.toString(), data.labelIds],
      );

    const accounts: Map<string, Array<string>> = new Map();

    for (const row of rows) {
      accounts.set(String(row.accountId).toLowerCase(), readIds(row.ids));
    }

    return accounts;
  }

  // The project's App Platforms environments, as a rule reads them.
  public static async readEnvironments(
    projectId: ObjectID,
  ): Promise<Array<CloudCostEnvironmentFact>> {
    const environments: Array<CloudResource> =
      await CloudResourceService.findBy({
        query: {
          projectId,
          cloudResourceKind: CloudResourceKind.Environment,
        },
        select: {
          _id: true,
          cloudPlatform: true,
          cloudAccountId: true,
          cloudRegion: true,
        },
        props: { isRoot: true },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
      });

    return CloudCostAllocationFacts.toEnvironmentFacts(
      environments.map((environment: CloudResource) => {
        return {
          id: environment.id?.toString() || "",
          platform: environment.cloudPlatform || "",
          accountId: environment.cloudAccountId || "",
          region: environment.cloudRegion || "",
        };
      }),
    );
  }

  /*
   * Environments as a rule reads them: its account and Region in lower
   * case, its platform's services, and whether it is its account's only
   * one of its platform - which takes the account's costs with no Region.
   */
  public static toEnvironmentFacts(
    environments: Array<{
      id: string;
      platform: string;
      accountId: string;
      region: string;
    }>,
  ): Array<CloudCostEnvironmentFact> {
    const known: Array<{
      id: string;
      platform: string;
      accountId: string;
      region: string;
    }> = environments.filter(
      (environment: { id: string; platform: string }): boolean => {
        return Boolean(environment.id && environment.platform);
      },
    );

    return known.map(
      (environment: {
        id: string;
        platform: string;
        accountId: string;
        region: string;
      }): CloudCostEnvironmentFact => {
        const accountId: string = environment.accountId.trim().toLowerCase();
        const sameKind: number = known.filter(
          (other: { platform: string; accountId: string }): boolean => {
            return (
              other.platform === environment.platform &&
              other.accountId.trim().toLowerCase() === accountId
            );
          },
        ).length;

        return {
          id: environment.id.toLowerCase(),
          platform: environment.platform,
          accountId,
          region: environment.region.trim().toLowerCase(),
          services: (
            CLOUD_PLATFORM_BILLED_SERVICES[
              environment.platform as ManagedCloudPlatform
            ] || []
          ).map((service: string): string => {
            return service.toLowerCase();
          }),
          isElasticBeanstalk:
            environment.platform === ManagedCloudPlatform.AwsElasticBeanstalk,
          isOnlyOfPlatformInAccount: sameKind === 1,
        };
      },
    );
  }

  // The environment a platform's cost row is of, as CloudPlatformCosts finds it.
  public static findEnvironment(data: {
    row: { accountId: string; region: string; service: string };
    environments: Array<CloudCostEnvironmentFact>;
  }): CloudCostEnvironmentFact | null {
    const accountId: string = data.row.accountId.trim().toLowerCase();
    const service: string = data.row.service.trim().toLowerCase();
    const region: string = data.row.region.trim().toLowerCase();
    const ofService: Array<CloudCostEnvironmentFact> = data.environments.filter(
      (environment: CloudCostEnvironmentFact): boolean => {
        return (
          !environment.isElasticBeanstalk &&
          environment.accountId === accountId &&
          environment.services.includes(service)
        );
      },
    );
    const inRegion: CloudCostEnvironmentFact | undefined = ofService.find(
      (environment: CloudCostEnvironmentFact): boolean => {
        return environment.region === region;
      },
    );

    if (inRegion) {
      return inRegion;
    }

    return !region && ofService.length === 1 ? ofService[0]! : null;
  }

  /*
   * The apps a rule names, each with the resources its platform bills it
   * under - found by its name in their ids, in its own environment
   * (getCloudPlatformBilledAppName) - or, on Elastic Beanstalk, its
   * environment's name.
   */
  public static async readApps(data: {
    projectId: ObjectID;
    appIds: Array<string>;
    environments: Array<CloudCostEnvironmentFact>;
    platformRows: () => Promise<Array<CloudCostPlatformResourceRow>>;
  }): Promise<Array<CloudCostAppFact>> {
    if (data.appIds.length === 0) {
      return [];
    }

    const apps: Array<CloudApp> = await CloudAppService.findBy({
      query: {
        projectId: data.projectId,
        _id: new Includes(data.appIds),
      },
      select: {
        _id: true,
        name: true,
        groupName: true,
        cloudResourceId: true,
      },
      props: { isRoot: true },
      skip: 0,
      limit: LIMIT_PER_PROJECT,
    });

    const needsRows: boolean = apps.some((app: CloudApp): boolean => {
      const environment: CloudCostEnvironmentFact | undefined =
        data.environments.find((candidate: CloudCostEnvironmentFact) => {
          return candidate.id === app.cloudResourceId?.toString().toLowerCase();
        });
      return Boolean(environment && !environment.isElasticBeanstalk);
    });
    const rows: Array<CloudCostPlatformResourceRow> = needsRows
      ? await data.platformRows()
      : [];

    return CloudCostAllocationFacts.toAppFacts({
      apps: apps.map((app: CloudApp) => {
        return {
          id: app.id?.toString() || "",
          environmentId: app.cloudResourceId?.toString() || "",
          name: app.name || "",
          groupName: app.groupName || undefined,
        };
      }),
      environments: data.environments,
      rows,
    });
  }

  public static toAppFacts(data: {
    apps: Array<{
      id: string;
      environmentId: string;
      name: string;
      groupName?: string | undefined;
    }>;
    environments: Array<CloudCostEnvironmentFact>;
    rows: Array<CloudCostPlatformResourceRow>;
  }): Array<CloudCostAppFact> {
    return data.apps.map(
      (app: {
        id: string;
        environmentId: string;
        name: string;
        groupName?: string | undefined;
      }): CloudCostAppFact => {
        const environmentId: string = app.environmentId.toLowerCase();
        const environment: CloudCostEnvironmentFact | undefined =
          data.environments.find((candidate: CloudCostEnvironmentFact) => {
            return candidate.id === environmentId;
          });

        if (!environment) {
          return { id: app.id.toLowerCase(), environmentId, resourceIds: [] };
        }

        if (environment.isElasticBeanstalk) {
          return {
            id: app.id.toLowerCase(),
            environmentId,
            resourceIds: [],
            elasticBeanstalkName: (app.groupName || "").trim().toLowerCase(),
          };
        }

        const platform: string = environment.platform;
        const resourceIds: Set<string> = new Set();

        for (const row of data.rows) {
          const of: CloudCostEnvironmentFact | null =
            CloudCostAllocationFacts.findEnvironment({
              row,
              environments: data.environments,
            });

          if (!of || of.id !== environmentId) {
            continue;
          }

          const name: string | null = getCloudPlatformBilledAppName({
            platform,
            resourceId: row.resourceId,
          });

          if (
            name &&
            name.trim().toLowerCase() === app.name.trim().toLowerCase()
          ) {
            resourceIds.add(row.resourceId.toLowerCase());
          }
        }

        return {
          id: app.id.toLowerCase(),
          environmentId,
          resourceIds: Array.from(resourceIds),
        };
      },
    );
  }

  /*
   * Everything a view's rules read, for one project: owner teams, labels,
   * environments and apps, as CloudCostAllocationQuery hands them to
   * ClickHouse. `platformRows` reads the App Platforms services' costs
   * when a rule names an app.
   */
  public static async load(data: {
    projectId: ObjectID;
    groups: Array<{ rules: Array<CloudCostRule> }>;
    platformRows: () => Promise<Array<CloudCostPlatformResourceRow>>;
  }): Promise<CloudCostQueryFacts> {
    const facts: CloudCostQueryFacts = emptyCloudCostQueryFacts();
    const fields: Set<CloudCostRuleField> = getCloudCostRuleFields(data.groups);
    const asksOwners: boolean = rulesAskAboutOwners(data.groups);
    const labelIds: Array<string> = fields.has(CloudCostRuleField.Label)
      ? getCloudCostRuleIds(data.groups, CloudCostRuleField.Label)
      : [];

    const [owners, resourceLabels, accountLabels]: [
      Map<string, Set<string>>,
      Map<string, Set<string>>,
      Map<string, Array<string>>,
    ] = await Promise.all([
      asksOwners
        ? CloudCostAllocationFacts.readOwnerTeams(data.projectId)
        : Promise.resolve(new Map()),
      CloudCostAllocationFacts.readResourceLabels({
        projectId: data.projectId,
        labelIds,
      }),
      CloudCostAllocationFacts.readAccountLabels({
        projectId: data.projectId,
        labelIds,
      }),
    ]);

    Object.assign(
      facts,
      CloudCostAllocationFacts.toResourceClasses({ owners, resourceLabels }),
    );
    facts.accountLabels = accountLabels;
    facts.splitsByOwner = asksOwners;

    if (
      fields.has(CloudCostRuleField.Environment) ||
      fields.has(CloudCostRuleField.App)
    ) {
      facts.environments = await CloudCostAllocationFacts.readEnvironments(
        data.projectId,
      );
    }

    if (fields.has(CloudCostRuleField.App)) {
      facts.apps = await CloudCostAllocationFacts.readApps({
        projectId: data.projectId,
        appIds: getCloudCostRuleIds(data.groups, CloudCostRuleField.App),
        environments: facts.environments,
        platformRows: data.platformRows,
      });
    }

    return facts;
  }

  /*
   * Each resource's fact class: one per set of owner teams and labels, so
   * a read carries one small number per resource. Class 0 is no facts.
   */
  public static toResourceClasses(data: {
    owners: Map<string, Set<string>>;
    resourceLabels: Map<string, Set<string>>;
  }): Pick<
    CloudCostQueryFacts,
    "resourceHashes" | "resourceClasses" | "classOwners" | "classLabels"
  > {
    const keys: Set<string> = new Set([
      ...data.owners.keys(),
      ...data.resourceLabels.keys(),
    ]);
    const classByShape: Map<string, number> = new Map();
    const classOwners: Array<string> = [];
    const classLabels: Array<Array<string>> = [];
    const resourceHashes: Array<string> = [];
    const resourceClasses: Array<number> = [];

    for (const key of Array.from(keys).sort()) {
      const owners: Array<string> = Array.from(
        data.owners.get(key) || [],
      ).sort();
      const labels: Array<string> = Array.from(
        data.resourceLabels.get(key) || [],
      ).sort();

      if (owners.length === 0 && labels.length === 0) {
        continue;
      }

      const shape: string = `${owners.join(",")}|${labels.join(",")}`;
      let index: number | undefined = classByShape.get(shape);

      if (index === undefined) {
        classOwners.push(owners.join(","));
        classLabels.push(labels);
        index = classOwners.length;
        classByShape.set(shape, index);
      }

      resourceHashes.push(hashCloudCostResourceKey(key));
      resourceClasses.push(index);
    }

    return { resourceHashes, resourceClasses, classOwners, classLabels };
  }

  // The App Platforms services: what a read of an app's resources reads.
  public static getPlatformServices(): Array<string> {
    return [...CLOUD_PLATFORM_ALL_BILLED_SERVICES];
  }
}
