import { isAwsRegion } from "./AwsRegionCode";
import { CloudProvider, FaasCloudPlatform } from "./CloudPlatform";
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
 * A group no rule reads - one a team named itself, an API Gateway's
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

// The longest identity a rule reads out of a name.
const MAX_IDENTITY_LENGTH: number = 255;

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
  ) => { dimensions: Record<string, string>; region?: string } | null;
  // Resource attributes the logs carry for it, beside cloud.resource_id.
  attributes?:
    | ((dimensions: Record<string, string>) => Record<string, string>)
    | undefined;
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
  },
  {
    // /aws/elasticbeanstalk/<environment>/var/log/...
    prefix: "/aws/elasticbeanstalk/",
    namespace: "AWS/ElasticBeanstalk",
    type: "AWS::ElasticBeanstalk::Environment",
    read: firstPart("EnvironmentName", 2),
  },
  {
    // Container Insights' performance events of a cluster.
    prefix: "/aws/ecs/containerinsights/",
    namespace: "AWS/ECS",
    type: "AWS::ECS::Cluster",
    read: firstPart("ClusterName", 2),
  },
];

// The resource types a stream can deliver logs of.
export const AWS_LOG_GROUP_RESOURCE_TYPES: ReadonlySet<string> =
  new Set<string>(
    AWS_LOG_GROUP_RULES.map((rule: AwsLogGroupRule): string => {
      return rule.type;
    }),
  );

// Whether a resource's page has a Logs tab: its type is one a log group names.
export function canCloudResourceHaveStreamedLogs(data: {
  provider: string | null | undefined;
  type: string | null | undefined;
}): boolean {
  return (
    (data.provider || "").toLowerCase() === CloudProvider.AWS &&
    AWS_LOG_GROUP_RESOURCE_TYPES.has(data.type || "")
  );
}

export interface CloudLogGroupResource {
  resource: CloudMonitoredResource;
  // Resource attributes the group's logs carry, cloud.resource_id among them.
  attributes: Record<string, string>;
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
    } | null = rule.read(parts);

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
        ...(rule.attributes ? rule.attributes(identity.dimensions) : {}),
      },
    };
  }

  return null;
}
