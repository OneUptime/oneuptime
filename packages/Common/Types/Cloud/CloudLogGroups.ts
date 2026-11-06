import { isAwsRegion } from "./AwsRegionCode";
import {
  CloudProvider,
  FaasCloudPlatform,
  ManagedCloudPlatform,
} from "./CloudPlatform";
import {
  AZURE_RESOURCE_TYPES,
  CloudResourceTypeDescriptor,
  getAwsPartitionForRegion,
  getGcpMonitoredResourceRule,
} from "./CloudResourceCatalog";
import {
  AWS_CLOUDWATCH_DIMENSION_PREFIX,
  AWS_CLOUDWATCH_METRIC_NAME_PREFIX,
  AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE,
  CLOUD_ACCOUNT_ID_ATTRIBUTE,
  CLOUD_REGION_ATTRIBUTE,
  CloudMonitoredResource,
  resolveCloudMonitoredResource,
} from "./CloudMonitoredResource";

/*
 * WHICH CLOUD RESOURCE A CLOUDWATCH LOGS GROUP IS THE LOG OF.
 *
 * Logs a stream delivers (CloudStream) are filed under the resource they
 * are about when their log group's name says which: AWS names the groups
 * its services write to after the resource - /aws/lambda/<function>,
 * /aws/rds/instance/<database>/error - so a group's name is turned into the
 * namespace and identity dimensions the resource's CloudWatch metrics carry
 * and run through the ingest's own resolver (CloudMonitoredResource). The
 * logs, its metrics and the row the inventory lists are then one resource,
 * whichever came first.
 *
 * The logs carry the resource's id (its ARN, providerResourceId) as the
 * resource attribute cloud.resource_id, which a resource's Logs page
 * filters on. A function's logs also carry cloud.platform and faas.name,
 * so they are the function's in Serverless too.
 *
 * The logs of an App Platforms platform's resource - an App Runner
 * service, an Elastic Beanstalk environment, an ECS cluster - carry its
 * cloud.platform too, and so do an ECS task's, from the group the ECS
 * console names /ecs/<task definition family>, which names no resource of
 * the catalog but the family (AWS_LOG_GROUP_ENVIRONMENT_RULES). With the
 * account and Region every streamed log carries, that is the platform's
 * environment in App Platforms (CloudPlatform: buildCloudEnvironmentKey),
 * whose Logs tab filters on exactly those three. They name no app there:
 * an app is named by its own telemetry (CloudAppIdentity says why).
 *
 * A group no rule reads - one a team named itself, or an API Gateway's
 * execution log, which names its API by an id no metric carries - is
 * streamed all the same, under its account and Region, unfiled.
 *
 * Every rule reads the name part by part: no regular expression ever reads
 * a name from outside.
 */

// The attribute that names a log's resource, and how it is stored on a row.
export const CLOUD_RESOURCE_ID_ATTRIBUTE: string = "cloud.resource_id";
export const STORED_CLOUD_RESOURCE_ID_ATTRIBUTE: string = `resource.${CLOUD_RESOURCE_ID_ATTRIBUTE}`;

// A log group's name: 1 to 512 characters (CloudWatch Logs' own limit).
export const AWS_LOG_GROUP_NAME_MAX_LENGTH: number = 512;

/*
 * The resource attributes, as the OpenTelemetry semantic conventions spell
 * them, that put a log on an App Platforms environment and name its part
 * of it: the platform, an ECS task definition's family, an ECS cluster.
 */
export const CLOUD_PLATFORM_ATTRIBUTE: string = "cloud.platform";
export const ECS_TASK_FAMILY_ATTRIBUTE: string = "aws.ecs.task.family";
export const ECS_CLUSTER_ARN_ATTRIBUTE: string = "aws.ecs.cluster.arn";

// The longest identity a rule reads out of a name.
const MAX_IDENTITY_LENGTH: number = 255;

// The account and Region a log group is in, for a rule whose identity needs them.
interface AwsLogGroupPlace {
  accountId: string;
  region: string;
}

interface AwsLogGroupRule {
  // The start of the group's name, as AWS writes it.
  prefix: string;
  namespace: string;
  // The resource type the rule's resources are, as CloudResourceCatalog spells it.
  type: string;
  /*
   * The identity dimensions, from the name's parts after the prefix - or
   * null when the parts are not that resource's. May name the Region the
   * resource lives in when it is not the group's (a Lambda@Edge replica).
   */
  read: (
    parts: Array<string>,
    place: AwsLogGroupPlace,
  ) => { dimensions: Record<string, string>; region?: string } | null;
  // Resource attributes the logs carry for it, beside cloud.resource_id.
  attributes?:
    | ((
        dimensions: Record<string, string>,
        resource: CloudMonitoredResource,
      ) => Record<string, string>)
    | undefined;
  /*
   * The App Platforms platform the resource runs apps on, when it is one:
   * its logs then carry cloud.platform, so they are on the platform's
   * environment of the group's account and Region too.
   */
  platform?: ManagedCloudPlatform | undefined;
}

function isIdentity(value: string | undefined): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    value.length <= MAX_IDENTITY_LENGTH
  );
}

// The first part as the identity, with at least `minimum` parts in all.
function firstPart(
  dimension: string,
  minimum: number,
): (parts: Array<string>) => { dimensions: Record<string, string> } | null {
  return (
    parts: Array<string>,
  ): { dimensions: Record<string, string> } | null => {
    if (parts.length < minimum || !isIdentity(parts[0])) {
      return null;
    }

    return { dimensions: { [dimension]: parts[0] } };
  };
}

/*
 * The function a Lambda log group is of. A Lambda@Edge function writes in
 * every Region it ran in, to /aws/lambda/us-east-1.<function>: the
 * function itself lives in us-east-1.
 */
function readLambdaFunction(
  parts: Array<string>,
): { dimensions: Record<string, string>; region?: string } | null {
  if (parts.length !== 1 || !isIdentity(parts[0])) {
    return null;
  }

  const name: string = parts[0];
  const dot: number = name.indexOf(".");

  if (dot > 0 && isAwsRegion(name.slice(0, dot))) {
    const functionName: string = name.slice(dot + 1);

    return isIdentity(functionName)
      ? {
          dimensions: { FunctionName: functionName },
          region: name.slice(0, dot).toLowerCase(),
        }
      : null;
  }

  return { dimensions: { FunctionName: name } };
}

// What the Step Functions console ends a state machine's log group with.
export const STATE_MACHINE_LOG_GROUP_SUFFIX: string = "-Logs";

// The longest name AWS gives a state machine, and a task definition family.
export const STATE_MACHINE_NAME_MAX_LENGTH: number = 80;
export const TASK_DEFINITION_FAMILY_MAX_LENGTH: number = 255;

// A state machine's name: 1 to 80 of letters, digits, "-" and "_".
function isStateMachineName(value: string): boolean {
  return isNameOfLettersDigitsDashes(value, STATE_MACHINE_NAME_MAX_LENGTH);
}

// A task definition's family: 1 to 255 of letters, digits, "-" and "_".
function isTaskDefinitionFamily(value: string): boolean {
  return isNameOfLettersDigitsDashes(value, TASK_DEFINITION_FAMILY_MAX_LENGTH);
}

function isNameOfLettersDigitsDashes(
  value: string,
  maxLength: number,
): boolean {
  if (value.length === 0 || value.length > maxLength) {
    return false;
  }

  for (const character of value) {
    const isAllowed: boolean =
      (character >= "a" && character <= "z") ||
      (character >= "A" && character <= "Z") ||
      (character >= "0" && character <= "9") ||
      character === "-" ||
      character === "_";

    if (!isAllowed) {
      return false;
    }
  }

  return true;
}

/*
 * The state machine a Step Functions log group is of: the console names it
 * /aws/vendedlogs/states/<state machine>-Logs. The state machine's metrics
 * name it by its ARN, which the group's account and Region complete.
 */
function readStateMachine(
  parts: Array<string>,
  place: AwsLogGroupPlace,
): { dimensions: Record<string, string> } | null {
  const part: string | undefined = parts[0];

  if (
    parts.length !== 1 ||
    !part ||
    !part.endsWith(STATE_MACHINE_LOG_GROUP_SUFFIX) ||
    !place.accountId ||
    !isAwsRegion(place.region)
  ) {
    return null;
  }

  const name: string = part.slice(0, -STATE_MACHINE_LOG_GROUP_SUFFIX.length);

  if (!isStateMachineName(name)) {
    return null;
  }

  const region: string = place.region.toLowerCase();

  return {
    dimensions: {
      StateMachineArn: `arn:${getAwsPartitionForRegion(region)}:states:${region}:${place.accountId}:stateMachine:${name}`,
    },
  };
}

export const AWS_LOG_GROUP_RULES: ReadonlyArray<AwsLogGroupRule> = [
  {
    prefix: "/aws/lambda/",
    namespace: "AWS/Lambda",
    type: "AWS::Lambda::Function",
    read: readLambdaFunction,
    attributes: (
      dimensions: Record<string, string>,
    ): Record<string, string> => {
      return {
        "cloud.platform": FaasCloudPlatform.AwsLambda,
        "faas.name": dimensions["FunctionName"]!,
      };
    },
  },
  {
    // /aws/rds/instance/<database>/<log>: error, slowquery, postgresql...
    prefix: "/aws/rds/instance/",
    namespace: "AWS/RDS",
    type: "AWS::RDS::DBInstance",
    read: firstPart("DBInstanceIdentifier", 2),
  },
  {
    prefix: "/aws/rds/cluster/",
    namespace: "AWS/RDS",
    type: "AWS::RDS::DBCluster",
    read: firstPart("DBClusterIdentifier", 2),
  },
  {
    prefix: "/aws/docdb/",
    namespace: "AWS/DocDB",
    type: "AWS::DocDB::DBCluster",
    read: firstPart("DBClusterIdentifier", 2),
  },
  {
    prefix: "/aws/neptune/",
    namespace: "AWS/Neptune",
    type: "AWS::Neptune::DBCluster",
    read: firstPart("DBClusterIdentifier", 2),
  },
  {
    prefix: "/aws/redshift/cluster/",
    namespace: "AWS/Redshift",
    type: "AWS::Redshift::Cluster",
    read: firstPart("ClusterIdentifier", 2),
  },
  {
    // The name the console suggests for a domain's logs.
    prefix: "/aws/OpenSearchService/domains/",
    namespace: "AWS/ES",
    type: "AWS::OpenSearchService::Domain",
    read: firstPart("DomainName", 1),
  },
  {
    // The name it suggested before OpenSearch was renamed.
    prefix: "/aws/aes/domains/",
    namespace: "AWS/ES",
    type: "AWS::OpenSearchService::Domain",
    read: firstPart("DomainName", 1),
  },
  {
    // /aws/apprunner/<service>/<service id>/application (or service)
    prefix: "/aws/apprunner/",
    namespace: "AWS/AppRunner",
    type: "AWS::AppRunner::Service",
    read: (
      parts: Array<string>,
    ): { dimensions: Record<string, string> } | null => {
      if (parts.length < 3 || !isIdentity(parts[0]) || !isIdentity(parts[1])) {
        return null;
      }

      return { dimensions: { ServiceName: parts[0], ServiceID: parts[1] } };
    },
    platform: ManagedCloudPlatform.AwsAppRunner,
  },
  {
    // /aws/elasticbeanstalk/<environment>/var/log/...
    prefix: "/aws/elasticbeanstalk/",
    namespace: "AWS/ElasticBeanstalk",
    type: "AWS::ElasticBeanstalk::Environment",
    read: firstPart("EnvironmentName", 2),
    platform: ManagedCloudPlatform.AwsElasticBeanstalk,
  },
  {
    /*
     * Container Insights' performance events of a cluster: they carry the
     * cluster's ARN as the ECS resource detector writes it, which is what
     * an ECS environment's telemetry is narrowed to a cluster by.
     */
    prefix: "/aws/ecs/containerinsights/",
    namespace: "AWS/ECS",
    type: "AWS::ECS::Cluster",
    read: firstPart("ClusterName", 2),
    attributes: (
      _dimensions: Record<string, string>,
      resource: CloudMonitoredResource,
    ): Record<string, string> => {
      return { [ECS_CLUSTER_ARN_ATTRIBUTE]: resource.providerResourceId };
    },
    platform: ManagedCloudPlatform.AwsEcs,
  },
  {
    // The log group the Step Functions console makes for a state machine.
    prefix: "/aws/vendedlogs/states/",
    namespace: "AWS/States",
    type: "AWS::StepFunctions::StateMachine",
    read: readStateMachine,
  },
];

/*
 * A log group that names no resource of the catalog, but the part of an
 * App Platforms environment its logs are of.
 */
interface AwsLogGroupEnvironmentRule {
  // The start of the group's name, as AWS writes it.
  prefix: string;
  // The platform whose environment of the group's account and Region it is.
  platform: ManagedCloudPlatform;
  /*
   * The attributes, beside cloud.platform, the logs carry for it, from the
   * name's parts after the prefix - or null when they name nothing.
   */
  read: (parts: Array<string>) => Record<string, string> | null;
}

export const AWS_LOG_GROUP_ENVIRONMENT_RULES: ReadonlyArray<AwsLogGroupEnvironmentRule> =
  [
    {
      /*
       * /ecs/<task definition family>: the group the ECS console makes for
       * a task definition's containers. The family is the attribute an ECS
       * app is named by (CloudPlatform), so the environment's Logs tab can
       * be narrowed to it; the cluster that keeps two apps of one family
       * apart is not in the name.
       */
      prefix: "/ecs/",
      platform: ManagedCloudPlatform.AwsEcs,
      read: (parts: Array<string>): Record<string, string> | null => {
        const family: string | undefined = parts[0];

        return parts.length === 1 && family && isTaskDefinitionFamily(family)
          ? { [ECS_TASK_FAMILY_ATTRIBUTE]: family }
          : null;
      },
    },
  ];

/*
 * The App Platforms platforms a stream's logs reach an environment of, in
 * the order the rules name them.
 */
export const AWS_LOG_GROUP_PLATFORMS: ReadonlyArray<ManagedCloudPlatform> =
  Array.from(
    new Set<ManagedCloudPlatform>([
      ...AWS_LOG_GROUP_RULES.map(
        (rule: AwsLogGroupRule): ManagedCloudPlatform | undefined => {
          return rule.platform;
        },
      ).filter(
        (
          platform: ManagedCloudPlatform | undefined,
        ): platform is ManagedCloudPlatform => {
          return Boolean(platform);
        },
      ),
      ...AWS_LOG_GROUP_ENVIRONMENT_RULES.map(
        (rule: AwsLogGroupEnvironmentRule): ManagedCloudPlatform => {
          return rule.platform;
        },
      ),
    ]),
  );

// The resource types a stream can deliver logs of.
export const AWS_LOG_GROUP_RESOURCE_TYPES: ReadonlySet<string> =
  new Set<string>(
    AWS_LOG_GROUP_RULES.map((rule: AwsLogGroupRule): string => {
      return rule.type;
    }),
  );

/*
 * Azure: the types of the catalog with no resource logs of their own, so
 * their pages have no Logs tab. A virtual machine's logs need an agent in
 * it; disks, network interfaces, private endpoints, NAT gateways, DNS zones
 * and App Service plans send metrics only; a storage account's logs are its
 * blob, queue, table and file services', a container app's its
 * environment's. Every other type of the catalog the stream's diagnostic
 * settings send the logs of, filed under its ARM id.
 */
export const AZURE_TYPES_WITHOUT_RESOURCE_LOGS: ReadonlySet<string> =
  new Set<string>([
    "microsoft.compute/virtualmachines",
    "microsoft.compute/virtualmachinescalesets",
    "microsoft.compute/disks",
    "microsoft.network/networkinterfaces",
    "microsoft.network/virtualnetworks",
    "microsoft.network/privateendpoints",
    "microsoft.network/natgateways",
    "microsoft.network/dnszones",
    "microsoft.web/serverfarms",
    "microsoft.storage/storageaccounts",
    "microsoft.app/containerapps",
  ]);

const AZURE_TYPES: ReadonlySet<string> = new Set<string>(
  AZURE_RESOURCE_TYPES.map(
    (descriptor: CloudResourceTypeDescriptor): string => {
      return descriptor.type.toLowerCase();
    },
  ),
);

/*
 * Google Cloud: the monitored resource types of the catalog Cloud Logging
 * files no log under - an instance group's are its VMs' and its manager's.
 * An external load balancer's are filed as http_load_balancer's, of the
 * same URL map, which the stream files under its https_lb_rule
 * (CloudLoggingEntries' aliases).
 */
export const GCP_TYPES_WITHOUT_LOGS: ReadonlySet<string> = new Set<string>([
  "instance_group",
]);

/*
 * Whether a resource's page has a Logs tab: an AWS type a log group names
 * (CloudLogGroups' rules), an Azure type that writes resource logs, or a
 * Google Cloud type whose logs Cloud Logging files under it.
 */
export function canCloudResourceHaveStreamedLogs(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
}): boolean {
  const provider: string = (data.provider || "").toLowerCase();
  const type: string = data.type || "";

  if (provider === CloudProvider.AWS) {
    return AWS_LOG_GROUP_RESOURCE_TYPES.has(type);
  }

  if (provider === CloudProvider.Azure) {
    const lower: string = type.toLowerCase();

    return (
      AZURE_TYPES.has(lower) && !AZURE_TYPES_WITHOUT_RESOURCE_LOGS.has(lower)
    );
  }

  if (provider === CloudProvider.GCP) {
    return (
      Boolean(getGcpMonitoredResourceRule(type)) &&
      !GCP_TYPES_WITHOUT_LOGS.has(type)
    );
  }

  return false;
}

export interface CloudLogGroupResource {
  resource: CloudMonitoredResource;
  // Resource attributes the group's logs carry, cloud.resource_id among them.
  attributes: Record<string, string>;
}

/*
 * cloud.platform for a log group of an App Platforms platform - only in an
 * AWS Region: an environment is the platform in one account and Region, and
 * a log of no Region would make one with a part of its key missing, beside
 * the one its apps report to.
 */
function getEnvironmentPlatformAttribute(data: {
  platform: ManagedCloudPlatform | undefined;
  region: string;
}): Record<string, string> {
  return data.platform && isAwsRegion(data.region)
    ? { [CLOUD_PLATFORM_ATTRIBUTE]: data.platform }
    : {};
}

/*
 * The resource a log group of one account and Region is the log of, or
 * null when its name says no resource OneUptime knows. Never throws.
 */
export function getAwsLogGroupResource(data: {
  logGroup: string;
  accountId: string;
  region: string;
}): CloudLogGroupResource | null {
  const logGroup: string =
    typeof data.logGroup === "string" ? data.logGroup : "";

  if (
    logGroup.length === 0 ||
    logGroup.length > AWS_LOG_GROUP_NAME_MAX_LENGTH ||
    !data.accountId
  ) {
    return null;
  }

  for (const rule of AWS_LOG_GROUP_RULES) {
    if (!logGroup.startsWith(rule.prefix)) {
      continue;
    }

    const parts: Array<string> = logGroup.slice(rule.prefix.length).split("/");
    const identity: {
      dimensions: Record<string, string>;
      region?: string;
    } | null = rule.read(parts, {
      accountId: data.accountId,
      region: data.region,
    });

    if (!identity) {
      return null;
    }

    const attributes: Record<string, unknown> = {
      [AWS_CLOUDWATCH_NAMESPACE_ATTRIBUTE]: rule.namespace,
      [CLOUD_ACCOUNT_ID_ATTRIBUTE]: data.accountId,
      [CLOUD_REGION_ATTRIBUTE]: identity.region || data.region,
    };

    for (const name of Object.keys(identity.dimensions)) {
      attributes[`${AWS_CLOUDWATCH_DIMENSION_PREFIX}${name}`] =
        identity.dimensions[name];
    }

    const resource: CloudMonitoredResource | null =
      resolveCloudMonitoredResource({
        metricName: `${AWS_CLOUDWATCH_METRIC_NAME_PREFIX}${rule.namespace}/Logs`,
        attributes,
      });

    if (!resource || resource.resourceType !== rule.type) {
      return null;
    }

    return {
      resource,
      attributes: {
        [CLOUD_RESOURCE_ID_ATTRIBUTE]: resource.providerResourceId,
        ...(rule.attributes
          ? rule.attributes(identity.dimensions, resource)
          : {}),
        ...getEnvironmentPlatformAttribute({
          platform: rule.platform,
          region: data.region,
        }),
      },
    };
  }

  return null;
}

/*
 * What a log group that names no resource of the catalog says of the App
 * Platforms environment its logs are of (AWS_LOG_GROUP_ENVIRONMENT_RULES):
 * cloud.platform and the attributes that name its part of it - or null.
 * Like a resource's, only for a group of an account, and only in an AWS
 * Region. Never throws.
 */
export function getAwsLogGroupEnvironmentAttributes(data: {
  logGroup: string;
  accountId: string;
  region: string;
}): Record<string, string> | null {
  const logGroup: string =
    typeof data.logGroup === "string" ? data.logGroup : "";

  if (
    logGroup.length === 0 ||
    logGroup.length > AWS_LOG_GROUP_NAME_MAX_LENGTH ||
    !data.accountId ||
    !isAwsRegion(data.region)
  ) {
    return null;
  }

  for (const rule of AWS_LOG_GROUP_ENVIRONMENT_RULES) {
    if (!logGroup.startsWith(rule.prefix)) {
      continue;
    }

    const named: Record<string, string> | null = rule.read(
      logGroup.slice(rule.prefix.length).split("/"),
    );

    return named
      ? {
          ...named,
          ...getEnvironmentPlatformAttribute({
            platform: rule.platform,
            region: data.region,
          }),
        }
      : null;
  }

  return null;
}

/*
 * Every resource attribute a log group's logs carry beside the
 * connection's own (service.name, its id, the account and the Region): the
 * resource's, when the group's name says one (getAwsLogGroupResource), or
 * else the environment's part it names (getAwsLogGroupEnvironmentAttributes).
 * Empty for a group no rule reads. Never throws.
 */
export function getAwsLogGroupAttributes(data: {
  logGroup: string;
  accountId: string;
  region: string;
}): Record<string, string> {
  const filed: CloudLogGroupResource | null = getAwsLogGroupResource(data);

  if (filed) {
    return filed.attributes;
  }

  return getAwsLogGroupEnvironmentAttributes(data) || {};
}
