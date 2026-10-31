/*
 * The cloud catalog: the CLOSED set of operations OneUptime AI may run on an
 * AWS account, an Azure subscription or a Google Cloud project, the grammar
 * that reads a `cloud` argv into exactly one of them, which kinds of
 * resource each one supports, and how each change is undone.
 *
 * `cloud` is not a real CLI and never runs text the model wrote, the way
 * `db` is not (DatabaseDiagnosticCatalog). A command is
 *
 *   cloud <operation> [resource] [--flag value | --flag=value]...
 *
 * where the resource is the provider's own id of ONE resource the account's
 * inventory lists: an ARN, an Azure resource ID, or a Google Cloud full
 * resource name ("//run.googleapis.com/projects/p/locations/l/services/s").
 * There are no free-form `aws`, `az` or `gcloud` calls.
 *
 * Where each operation runs:
 *   - the changes run only on the Cloud AI agent in the customer's cloud,
 *     which maps each one to ONE API call it owns (the `apiCall` notes),
 *     reads the value it is about to replace first and reports it, so the
 *     plan's rollback is exact;
 *   - the reads (describe, recent-events, target-health, quota-usage,
 *     read-logs) run on the OneUptime server through the account's existing
 *     read-only connection, so they work without the agent;
 *   - `whoami` runs on the agent: the account it acts in and the operations
 *     its role allows, for "Test connection";
 *   - `dry-run <change>` runs on the agent too: it checks one change the way
 *     the agent would make it and reads the value it would replace, then
 *     stops before the call that makes it (see CLOUD_DRY_RUN_OPERATION).
 *
 * The grammar is as strict as the db catalog's, so a flag or value the
 * policy refuses can never hide inside one it allows:
 *   - the operation is argv[1], spelled exactly (lowercase, dashes);
 *   - flags are LONG only (`--count 4` or `--count=4`); every flag takes a
 *     value; `--flag value` never takes a value that starts with "-", and
 *     `--flag=` with nothing after it is refused;
 *   - a flag the operation does not take (or does not take for this kind of
 *     resource), an unknown flag, a flag given twice, a value outside its
 *     type or bounds, a missing or extra argument: all refused;
 *   - "--" ends the flags;
 *   - the resource must be a well-formed id of the account's cloud, and a
 *     change must name a kind of resource the operation supports.
 * The parse yields a canonical argv (operation, resource, flags in catalog
 * order as `--flag value`) that re-parses to itself, so what the agent
 * receives, what a person approves and what the agent runs are one thing.
 *
 * Tiers are set per kind of resource (restarting an ECS service is a
 * rolling replacement, restarting an App Service is not), and three
 * changes always ask a person, in every mode: fail-over-database,
 * stop-instance and redrive-queue. Everything else is in the never tier:
 * deleting or terminating anything, IAM, security groups and firewall
 * rules, secrets and keys, storage and database contents, instance types,
 * snapshots and restores, purging a queue, a group's minimum or maximum,
 * and anything not here.
 *
 * Part of the import-closed resource policy directory the resource AI agent
 * carries a byte-identical copy of (see ResourceCommandPolicyCore): pure,
 * total (nothing here throws), relative imports of that set only.
 */

import AiResourceType from "../../../Types/ResourceAiAgent/AiResourceType";
import { ResourceCommandTier } from "../../../Types/ResourceAiAgent/ResourceAiAccess";

// The program every cloud command starts with.
export const CLOUD_PROGRAM: string = "cloud";

// The clouds, spelled as CloudProvider spells them (Types/Cloud/CloudPlatform).
export type CloudCatalogProvider = "aws" | "azure" | "gcp";

export const ALL_CLOUD_CATALOG_PROVIDERS: ReadonlyArray<CloudCatalogProvider> =
  ["aws", "azure", "gcp"];

export const CLOUD_CATALOG_PROVIDER_NAMES: Readonly<
  Record<CloudCatalogProvider, string>
> = {
  aws: "AWS",
  azure: "Azure",
  gcp: "Google Cloud",
};

// How each cloud names the id a command takes.
export const CLOUD_RESOURCE_ID_NAMES: Readonly<
  Record<CloudCatalogProvider, string>
> = {
  aws: "ARN",
  azure: "Azure resource ID",
  gcp: "Google Cloud full resource name",
};

// The cloud a resource type's agent acts in, or null for any other type.
export function getCloudCatalogProvider(
  resourceType: unknown,
): CloudCatalogProvider | null {
  switch (resourceType) {
    case AiResourceType.AwsAccount:
      return "aws";
    case AiResourceType.AzureSubscription:
      return "azure";
    case AiResourceType.GoogleCloudProject:
      return "gcp";
    default:
      return null;
  }
}

// ---- Kinds of resource --------------------------------------------------------

/*
 * The kinds of resource the catalog's operations know, read from the id
 * itself. Reads take any resource of the cloud; a change takes only the
 * kinds its operation lists.
 */
export interface CloudResourceKindSpec {
  provider: CloudCatalogProvider;
  // Lowercase words joined by dashes: "ecs-service", "virtual-machine".
  kind: string;
  // How sentences name it: "ECS service".
  displayName: string;
}

export const CLOUD_RESOURCE_KINDS: ReadonlyArray<CloudResourceKindSpec> = [
  { provider: "aws", kind: "ecs-service", displayName: "ECS service" },
  { provider: "aws", kind: "ec2-instance", displayName: "EC2 instance" },
  { provider: "aws", kind: "rds-instance", displayName: "RDS instance" },
  { provider: "aws", kind: "rds-cluster", displayName: "Aurora cluster" },
  {
    provider: "aws",
    kind: "autoscaling-group",
    displayName: "Auto Scaling group",
  },
  { provider: "aws", kind: "lambda-function", displayName: "Lambda function" },
  { provider: "aws", kind: "lambda-alias", displayName: "Lambda alias" },
  { provider: "aws", kind: "sqs-queue", displayName: "SQS queue" },
  { provider: "aws", kind: "elb-target-group", displayName: "target group" },
  { provider: "aws", kind: "elb-load-balancer", displayName: "load balancer" },
  {
    provider: "azure",
    kind: "app-service",
    displayName: "App Service or Function App",
  },
  {
    provider: "azure",
    kind: "app-service-plan",
    displayName: "App Service plan",
  },
  { provider: "azure", kind: "container-app", displayName: "Container App" },
  {
    provider: "azure",
    kind: "virtual-machine",
    displayName: "virtual machine",
  },
  { provider: "azure", kind: "vm-scale-set", displayName: "VM scale set" },
  {
    provider: "azure",
    kind: "postgresql-flexible-server",
    displayName: "PostgreSQL flexible server",
  },
  {
    provider: "azure",
    kind: "mysql-flexible-server",
    displayName: "MySQL flexible server",
  },
  {
    provider: "azure",
    kind: "sql-failover-group",
    displayName: "SQL failover group",
  },
  {
    provider: "gcp",
    kind: "compute-instance",
    displayName: "Compute Engine VM",
  },
  {
    provider: "gcp",
    kind: "cloud-run-service",
    displayName: "Cloud Run service",
  },
  {
    provider: "gcp",
    kind: "managed-instance-group",
    displayName: "managed instance group",
  },
  {
    provider: "gcp",
    kind: "cloud-sql-instance",
    displayName: "Cloud SQL instance",
  },
];

export function getCloudResourceKind(
  provider: CloudCatalogProvider,
  kind: string | null,
): CloudResourceKindSpec | null {
  if (!kind) {
    return null;
  }

  for (const spec of CLOUD_RESOURCE_KINDS) {
    if (spec.provider === provider && spec.kind === kind) {
      return spec;
    }
  }

  return null;
}

// ---- Resource ids -------------------------------------------------------------

// One resource id, read.
export interface ParsedCloudResource {
  provider: CloudCatalogProvider;
  // The id in its canonical form (what the command carries).
  id: string;
  /*
   * The account the id names: the AWS account id, the Azure subscription
   * id (lowercase) or the Google Cloud project (an id or a number). Empty
   * for an AWS id without one (an S3 bucket's ARN).
   */
  accountId: string;
  // The AWS Region, the Google Cloud zone's region or location; null otherwise.
  region: string | null;
  // The Google Cloud zone of a zonal resource; null otherwise.
  zone: string | null;
  // A kind the catalog knows, or null (fine for reads).
  kind: string | null;
  /*
   * The parts the agent addresses the resource by: cluster and service,
   * instanceId, name, functionName and alias, queueName, resourceGroup,
   * server, location, ...
   */
  parts: Record<string, string>;
}

export type CloudResourceParse =
  | { ok: true; resource: ParsedCloudResource }
  | { ok: false; errorMessage: string };

// The longest id the catalog reads (an ARN is at most 2048 characters).
export const CLOUD_MAX_RESOURCE_ID_LENGTH: number = 1600;

const AWS_PARTITION_REGEX: RegExp = /^aws(?:-cn|-us-gov|-iso|-iso-b)?$/;
const AWS_SERVICE_REGEX: RegExp = /^[a-z0-9][a-z0-9-]{0,62}$/;
const AWS_REGION_REGEX: RegExp =
  /^[a-z]{2}(?:-gov|-iso|-isob)?-[a-z]{2,12}-[0-9]{1,2}$/;
const AWS_ACCOUNT_REGEX: RegExp = /^[0-9]{12}$/;
// What an ARN's resource part may hold: no space, quote, backslash or control character.
const AWS_RESOURCE_PART_REGEX: RegExp = /^[A-Za-z0-9_.:/@+=,$#-]{1,1500}$/;
const AWS_ECS_NAME_REGEX: RegExp = /^[A-Za-z0-9_-]{1,255}$/;
const AWS_EC2_INSTANCE_REGEX: RegExp = /^i-(?:[0-9a-f]{8}|[0-9a-f]{17})$/;
const AWS_RDS_NAME_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9-]{0,62}$/;
const AWS_UUID_REGEX: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const AWS_ASG_NAME_REGEX: RegExp = /^[A-Za-z0-9._@+=,-]{1,255}$/;
const AWS_LAMBDA_NAME_REGEX: RegExp = /^[A-Za-z0-9_-]{1,64}$/;
const AWS_LAMBDA_QUALIFIER_REGEX: RegExp =
  /^(?:\$LATEST|[A-Za-z0-9_-]{1,128})$/;
const AWS_SQS_NAME_REGEX: RegExp = /^[A-Za-z0-9_-]{1,80}(?:\.fifo)?$/;
const AWS_ELB_NAME_REGEX: RegExp = /^[A-Za-z0-9-]{1,32}$/;
const AWS_ELB_ID_REGEX: RegExp = /^[0-9a-f]{16}$/;
const DIGITS_REGEX: RegExp = /^[0-9]+$/;

function refuseResource(errorMessage: string): CloudResourceParse {
  return { ok: false, errorMessage };
}

// The longest id quoted back in a refusal.
const MAX_QUOTED_WORD_LENGTH: number = 64;

// A word as a refusal quotes it: JSON-escaped, and cut when it is long.
export function quoteCloudWord(word: string): string {
  const shown: string =
    word.length > MAX_QUOTED_WORD_LENGTH
      ? `${word.slice(0, MAX_QUOTED_WORD_LENGTH)}...`
      : word;

  return JSON.stringify(shown);
}

/*
 * arn:partition:service:region:account:resource, with the kinds the
 * catalog's changes take read out of the resource part.
 */
function parseAwsArn(id: string): CloudResourceParse {
  const notArn: string = `an AWS resource is named by its ARN, such as arn:aws:ecs:us-east-1:123456789012:service/prod/web (got ${quoteCloudWord(id)})`;

  if (!id.startsWith("arn:")) {
    return refuseResource(notArn);
  }

  const fields: Array<string> = [];
  let start: number = 0;

  // The first five fields end at a colon; the resource part may hold more.
  for (let field: number = 0; field < 5; field++) {
    const colon: number = id.indexOf(":", start);

    if (colon < 0) {
      return refuseResource(notArn);
    }

    fields.push(id.slice(start, colon));
    start = colon + 1;
  }

  const partition: string = fields[1] || "";
  const service: string = fields[2] || "";
  const region: string = fields[3] || "";
  const account: string = fields[4] || "";
  const resourcePart: string = id.slice(start);

  if (
    !AWS_PARTITION_REGEX.test(partition) ||
    !AWS_SERVICE_REGEX.test(service) ||
    (region !== "" && !AWS_REGION_REGEX.test(region)) ||
    (account !== "" && !AWS_ACCOUNT_REGEX.test(account)) ||
    !AWS_RESOURCE_PART_REGEX.test(resourcePart)
  ) {
    return refuseResource(notArn);
  }

  const resource: ParsedCloudResource = {
    provider: "aws",
    id,
    accountId: account,
    region: region || null,
    zone: null,
    kind: null,
    parts: { service, partition },
  };

  const slash: Array<string> = resourcePart.split("/");
  const colon: Array<string> = resourcePart.split(":");

  if (
    service === "ecs" &&
    slash.length === 3 &&
    slash[0] === "service" &&
    AWS_ECS_NAME_REGEX.test(slash[1] || "") &&
    AWS_ECS_NAME_REGEX.test(slash[2] || "")
  ) {
    resource.kind = "ecs-service";
    resource.parts["cluster"] = slash[1] || "";
    resource.parts["name"] = slash[2] || "";
  } else if (
    service === "ec2" &&
    slash.length === 2 &&
    slash[0] === "instance" &&
    AWS_EC2_INSTANCE_REGEX.test(slash[1] || "")
  ) {
    resource.kind = "ec2-instance";
    resource.parts["instanceId"] = slash[1] || "";
  } else if (
    service === "rds" &&
    colon.length === 2 &&
    (colon[0] === "db" || colon[0] === "cluster") &&
    AWS_RDS_NAME_REGEX.test(colon[1] || "")
  ) {
    resource.kind = colon[0] === "db" ? "rds-instance" : "rds-cluster";
    resource.parts["name"] = colon[1] || "";
  } else if (
    service === "autoscaling" &&
    colon.length === 3 &&
    colon[0] === "autoScalingGroup" &&
    AWS_UUID_REGEX.test(colon[1] || "") &&
    (colon[2] || "").startsWith("autoScalingGroupName/") &&
    AWS_ASG_NAME_REGEX.test(
      (colon[2] || "").slice("autoScalingGroupName/".length),
    )
  ) {
    resource.kind = "autoscaling-group";
    resource.parts["name"] = (colon[2] || "").slice(
      "autoScalingGroupName/".length,
    );
  } else if (
    service === "lambda" &&
    colon[0] === "function" &&
    (colon.length === 2 || colon.length === 3) &&
    AWS_LAMBDA_NAME_REGEX.test(colon[1] || "")
  ) {
    resource.parts["functionName"] = colon[1] || "";

    if (colon.length === 2) {
      resource.kind = "lambda-function";
    } else {
      const qualifier: string = colon[2] || "";

      if (!AWS_LAMBDA_QUALIFIER_REGEX.test(qualifier)) {
        return refuseResource(notArn);
      }

      // A version (digits or $LATEST) is not an alias: it never moves.
      if (qualifier !== "$LATEST" && !DIGITS_REGEX.test(qualifier)) {
        resource.kind = "lambda-alias";
        resource.parts["alias"] = qualifier;
      }
    }
  } else if (
    service === "sqs" &&
    colon.length === 1 &&
    AWS_SQS_NAME_REGEX.test(resourcePart)
  ) {
    resource.kind = "sqs-queue";
    resource.parts["queueName"] = resourcePart;
  } else if (service === "elasticloadbalancing") {
    if (
      slash.length === 3 &&
      slash[0] === "targetgroup" &&
      AWS_ELB_NAME_REGEX.test(slash[1] || "") &&
      AWS_ELB_ID_REGEX.test(slash[2] || "")
    ) {
      resource.kind = "elb-target-group";
      resource.parts["name"] = slash[1] || "";
    } else if (
      slash.length === 4 &&
      slash[0] === "loadbalancer" &&
      (slash[1] === "app" || slash[1] === "net") &&
      AWS_ELB_NAME_REGEX.test(slash[2] || "") &&
      AWS_ELB_ID_REGEX.test(slash[3] || "")
    ) {
      resource.kind = "elb-load-balancer";
      resource.parts["name"] = slash[2] || "";
    }
  }

  return { ok: true, resource };
}

const AZURE_GUID_REGEX: RegExp =
  /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
const AZURE_RESOURCE_GROUP_REGEX: RegExp = /^[A-Za-z0-9._()-]{1,90}$/;
const AZURE_NAMESPACE_REGEX: RegExp =
  /^[A-Za-z][A-Za-z0-9]{0,63}(?:\.[A-Za-z][A-Za-z0-9]{0,63}){1,3}$/;
const AZURE_TYPE_REGEX: RegExp = /^[A-Za-z][A-Za-z0-9]{0,63}$/;
const AZURE_NAME_REGEX: RegExp = /^[A-Za-z0-9._()-]{1,260}$/;

// The Azure kinds, by provider namespace and type path (compared lowercased).
const AZURE_KINDS_BY_TYPE: ReadonlyArray<{ typePath: string; kind: string }> = [
  { typePath: "microsoft.web/sites", kind: "app-service" },
  { typePath: "microsoft.web/serverfarms", kind: "app-service-plan" },
  { typePath: "microsoft.app/containerapps", kind: "container-app" },
  { typePath: "microsoft.compute/virtualmachines", kind: "virtual-machine" },
  {
    typePath: "microsoft.compute/virtualmachinescalesets",
    kind: "vm-scale-set",
  },
  {
    typePath: "microsoft.dbforpostgresql/flexibleservers",
    kind: "postgresql-flexible-server",
  },
  {
    typePath: "microsoft.dbformysql/flexibleservers",
    kind: "mysql-flexible-server",
  },
  {
    typePath: "microsoft.sql/servers/failovergroups",
    kind: "sql-failover-group",
  },
];

/*
 * /subscriptions/<id>/resourceGroups/<group>/providers/<Namespace>/<type>/
 * <name>[/<type>/<name>]..., compared case-insensitively as Azure does.
 */
function parseAzureResourceId(id: string): CloudResourceParse {
  const notId: string = `an Azure resource is named by its resource ID, such as /subscriptions/00000000-0000-0000-0000-000000000000/resourceGroups/prod/providers/Microsoft.Web/sites/web (got ${quoteCloudWord(id)})`;
  const segments: Array<string> = id.split("/");

  // "", subscriptions, id, resourceGroups, group, providers, namespace, then type/name pairs.
  if (
    segments.length < 9 ||
    segments.length > 13 ||
    segments.length % 2 === 0 ||
    segments[0] !== "" ||
    (segments[1] || "").toLowerCase() !== "subscriptions" ||
    !AZURE_GUID_REGEX.test(segments[2] || "") ||
    (segments[3] || "").toLowerCase() !== "resourcegroups" ||
    !AZURE_RESOURCE_GROUP_REGEX.test(segments[4] || "") ||
    (segments[4] || "").endsWith(".") ||
    (segments[5] || "").toLowerCase() !== "providers" ||
    !AZURE_NAMESPACE_REGEX.test(segments[6] || "")
  ) {
    return refuseResource(notId);
  }

  const types: Array<string> = [];
  const names: Array<string> = [];

  for (let index: number = 7; index < segments.length; index += 2) {
    const type: string = segments[index] || "";
    const name: string = segments[index + 1] || "";

    if (!AZURE_TYPE_REGEX.test(type) || !AZURE_NAME_REGEX.test(name)) {
      return refuseResource(notId);
    }

    types.push(type);
    names.push(name);
  }

  const typePath: string = [segments[6] || "", ...types]
    .join("/")
    .toLowerCase();
  const match: { typePath: string; kind: string } | undefined =
    AZURE_KINDS_BY_TYPE.find(
      (candidate: { typePath: string; kind: string }): boolean => {
        return candidate.typePath === typePath;
      },
    );

  const parts: Record<string, string> = {
    resourceGroup: segments[4] || "",
    namespace: segments[6] || "",
    name: names[names.length - 1] || "",
  };

  if (match && match.kind === "sql-failover-group") {
    parts["server"] = names[0] || "";
  }

  return {
    ok: true,
    resource: {
      provider: "azure",
      id,
      accountId: (segments[2] || "").toLowerCase(),
      region: null,
      zone: null,
      kind: match ? match.kind : null,
      parts,
    },
  };
}

const GCP_PROJECT_REGEX: RegExp =
  /^(?:[a-z][a-z0-9-]{4,28}[a-z0-9]|[0-9]{1,20})$/;
const GCP_SERVICE_HOST_REGEX: RegExp =
  /^[a-z][a-z0-9-]{0,62}\.googleapis\.com$/;
const GCP_PATH_SEGMENT_REGEX: RegExp = /^[A-Za-z0-9._~@-]{1,255}$/;
const GCP_ZONE_REGEX: RegExp = /^[a-z]+-[a-z]+[0-9]{1,2}-[a-z]$/;
const GCP_REGION_REGEX: RegExp = /^[a-z]+-[a-z]+[0-9]{1,2}$/;
const GCP_COMPUTE_NAME_REGEX: RegExp = /^[a-z](?:[-a-z0-9]{0,61}[a-z0-9])?$/;
const GCP_RUN_NAME_REGEX: RegExp = /^[a-z](?:[-a-z0-9]{0,47}[a-z0-9])?$/;
const GCP_SQL_NAME_REGEX: RegExp = /^[a-z][a-z0-9-]{0,97}$/;

/*
 * //<service>.googleapis.com/projects/<project>/..., the form Cloud Asset
 * Inventory names resources by. Cloud SQL is named by cloudsql (sqladmin is
 * read as the same).
 */
function parseGcpResourceName(id: string): CloudResourceParse {
  const notName: string = `a Google Cloud resource is named by its full resource name, such as //run.googleapis.com/projects/my-project/locations/us-central1/services/web (got ${quoteCloudWord(id)})`;

  if (!id.startsWith("//")) {
    return refuseResource(notName);
  }

  const segments: Array<string> = id.slice(2).split("/");
  const host: string = segments[0] || "";

  if (
    !GCP_SERVICE_HOST_REGEX.test(host) ||
    segments.length < 3 ||
    segments.length > 12 ||
    segments[1] !== "projects" ||
    !GCP_PROJECT_REGEX.test(segments[2] || "")
  ) {
    return refuseResource(notName);
  }

  for (const segment of segments.slice(1)) {
    if (!GCP_PATH_SEGMENT_REGEX.test(segment)) {
      return refuseResource(notName);
    }
  }

  const service: string =
    host === "sqladmin.googleapis.com" ? "cloudsql.googleapis.com" : host;
  const canonical: string = `//${[service, ...segments.slice(1)].join("/")}`;
  const rest: Array<string> = segments.slice(3);
  const resource: ParsedCloudResource = {
    provider: "gcp",
    id: canonical,
    accountId: segments[2] || "",
    region: null,
    zone: null,
    kind: null,
    parts: { project: segments[2] || "", service },
  };

  if (service === "compute.googleapis.com" && rest.length === 4) {
    const scope: string = rest[0] || "";
    const where: string = rest[1] || "";
    const collection: string = rest[2] || "";
    const name: string = rest[3] || "";

    if (
      scope === "zones" &&
      GCP_ZONE_REGEX.test(where) &&
      GCP_COMPUTE_NAME_REGEX.test(name) &&
      (collection === "instances" || collection === "instanceGroupManagers")
    ) {
      resource.kind =
        collection === "instances"
          ? "compute-instance"
          : "managed-instance-group";
      resource.zone = where;
      resource.region = where.slice(0, where.lastIndexOf("-"));
      resource.parts["zone"] = where;
      resource.parts["name"] = name;
    } else if (
      scope === "regions" &&
      GCP_REGION_REGEX.test(where) &&
      collection === "instanceGroupManagers" &&
      GCP_COMPUTE_NAME_REGEX.test(name)
    ) {
      resource.kind = "managed-instance-group";
      resource.region = where;
      resource.parts["region"] = where;
      resource.parts["name"] = name;
    }
  } else if (
    service === "run.googleapis.com" &&
    rest.length === 4 &&
    rest[0] === "locations" &&
    GCP_REGION_REGEX.test(rest[1] || "") &&
    rest[2] === "services" &&
    GCP_RUN_NAME_REGEX.test(rest[3] || "")
  ) {
    resource.kind = "cloud-run-service";
    resource.region = rest[1] || null;
    resource.parts["location"] = rest[1] || "";
    resource.parts["name"] = rest[3] || "";
  } else if (
    service === "cloudsql.googleapis.com" &&
    rest.length === 2 &&
    rest[0] === "instances" &&
    GCP_SQL_NAME_REGEX.test(rest[1] || "")
  ) {
    resource.kind = "cloud-sql-instance";
    resource.parts["name"] = rest[1] || "";
  }

  return { ok: true, resource };
}

/*
 * Read one resource id of this cloud, or say why it is not one. Total:
 * anything that is not a string id of the cloud is refused, never thrown on.
 */
export function parseCloudResourceId(
  provider: CloudCatalogProvider,
  value: unknown,
): CloudResourceParse {
  if (typeof value !== "string" || value === "") {
    return refuseResource(
      `name the resource by its ${CLOUD_RESOURCE_ID_NAMES[provider]}`,
    );
  }

  if (value.length > CLOUD_MAX_RESOURCE_ID_LENGTH) {
    return refuseResource(
      `the ${CLOUD_RESOURCE_ID_NAMES[provider]} is ${value.length} characters long; the most cloud reads is ${CLOUD_MAX_RESOURCE_ID_LENGTH}`,
    );
  }

  switch (provider) {
    case "aws":
      return parseAwsArn(value);
    case "azure":
      return parseAzureResourceId(value);
    case "gcp":
      return parseGcpResourceName(value);
    default:
      return refuseResource("this cloud has no catalog");
  }
}

/*
 * The target a change names, as write-scope globs and protected targets see
 * it: the id itself, lowercased for Azure, whose ids are case-insensitive.
 */
export function getCloudWriteTarget(resource: ParsedCloudResource): string {
  return resource.provider === "azure"
    ? resource.id.toLowerCase()
    : resource.id;
}

/*
 * Whether two ids name the same resource the way each cloud compares them:
 * Azure ids case-insensitively, the others exactly.
 */
export function isSameCloudResourceId(
  provider: CloudCatalogProvider,
  left: string,
  right: string,
): boolean {
  if (typeof left !== "string" || typeof right !== "string") {
    return false;
  }

  return provider === "azure"
    ? left.toLowerCase() === right.toLowerCase()
    : left === right;
}

// ---- Parameters ---------------------------------------------------------------

// How a flag's value is read.
export enum CloudParamKind {
  // A whole number within [minimum, maximum], written without leading zeros.
  Integer = "Integer",
  /*
   * A version or revision to move to: an ECS task definition
   * (family:revision), a Lambda version, a Container App or Cloud Run
   * revision. [A-Za-z0-9._:$-], not starting with "-".
   */
  Version = "Version",
  // An App Service deployment slot's name.
  SlotName = "SlotName",
  // A concurrency limit: a whole number, or "none" for no explicit limit.
  Limit = "Limit",
  /*
   * Words to search log lines for: letters, digits, spaces and . _ : / @ = , + # ( ) -
   * — never quotes, backslashes or anything a query language would read.
   */
  SearchText = "SearchText",
}

export interface CloudParamSpec {
  // The flag's name without dashes.
  name: string;
  kind: CloudParamKind;
  // How the guide writes the value ("N", "VERSION", "TEXT").
  valueLabel: string;
  description: string;
  // Integer and Limit only.
  minimum?: number | undefined;
  maximum?: number | undefined;
  // What the runner uses when the flag is not given (Integer only).
  defaultValue?: number | undefined;
  // Must be given (for the kinds it applies to).
  required: boolean;
  // The kinds it applies to; absent means every kind the operation supports.
  kinds?: ReadonlyArray<string> | undefined;
}

export const CLOUD_MAX_COUNT: number = 1000;
export const CLOUD_MAX_LIMIT_VALUE: number = 10000;
export const CLOUD_MAX_EVENT_HOURS: number = 72;
export const CLOUD_DEFAULT_EVENT_HOURS: number = 6;
export const CLOUD_MAX_LOG_MINUTES: number = 1440;
export const CLOUD_DEFAULT_LOG_MINUTES: number = 60;
export const CLOUD_MAX_ROW_LIMIT: number = 200;
export const CLOUD_DEFAULT_ROW_LIMIT: number = 50;
export const CLOUD_MAX_SEARCH_TEXT_LENGTH: number = 128;
export const CLOUD_MAX_VERSION_LENGTH: number = 255;

function limitFlag(): CloudParamSpec {
  return {
    name: "limit",
    kind: CloudParamKind.Integer,
    valueLabel: "N",
    description: `at most N rows (1-${CLOUD_MAX_ROW_LIMIT}, default ${CLOUD_DEFAULT_ROW_LIMIT})`,
    minimum: 1,
    maximum: CLOUD_MAX_ROW_LIMIT,
    defaultValue: CLOUD_DEFAULT_ROW_LIMIT,
    required: false,
  };
}

function countFlag(direction: "out" | "in"): CloudParamSpec {
  return {
    name: "count",
    kind: CloudParamKind.Integer,
    valueLabel: "N",
    description:
      direction === "out"
        ? `the new desired count, above the current one and within the group's maximum (at most double the current count where the platform sets no maximum; 1-${CLOUD_MAX_COUNT})`
        : `the new desired count, below the current one and not below the group's minimum (1-${CLOUD_MAX_COUNT}; never 0)`,
    minimum: 1,
    maximum: CLOUD_MAX_COUNT,
    required: true,
  };
}

// ---- Operations ---------------------------------------------------------------

/*
 * How one operation applies to one kind of resource: its tier, whether a
 * person must always approve it, the ONE API call that makes it and the
 * permissions the agent's role needs for it (the read of the value it
 * replaces included). A read on the server lists the read-only permissions
 * the connection needs for it instead.
 */
export interface CloudOperationKindSpec {
  provider: CloudCatalogProvider;
  // A kind of CLOUD_RESOURCE_KINDS, or "*": any resource of the cloud (reads).
  kind: string;
  tier: ResourceCommandTier;
  requiresHuman: boolean;
  // The call, as the plan names it: "ecs:UpdateService with forceNewDeployment".
  apiCall: string;
  // AWS IAM actions, Azure RBAC actions or Google Cloud IAM permissions.
  permissions: ReadonlyArray<string>;
}

// Where an operation runs.
export type CloudOperationRunsOn = "server" | "agent";

/*
 * How a change is undone: the operation that puts the resource back, and
 * the flag that takes the value the change replaced (its key in the value
 * the agent reports). Null: nothing to undo.
 */
export interface CloudUndoSpec {
  operation: string;
  // The flag the replaced value goes in, e.g. "count"; null: the inverse takes none.
  valueFlag: string | null;
  // The key of the reported replaced value it reads.
  valueKey: string | null;
  // Flags of the change carried over as they are (the slot of a swap).
  keepFlags: ReadonlyArray<string>;
}

export interface CloudOperationSpec {
  // Canonical name: lowercase words joined by dashes.
  name: string;
  aliases: ReadonlyArray<string>;
  runsOn: CloudOperationRunsOn;
  // One line: what it shows or does (for the guides and the policy's reason).
  summary: string;
  // Whether it names a resource (every operation but whoami).
  takesResource: boolean;
  kinds: ReadonlyArray<CloudOperationKindSpec>;
  // The flags it takes, in canonical order.
  flags: ReadonlyArray<CloudParamSpec>;
  // How the change is undone; null for reads and for changes with nothing to undo.
  undo: CloudUndoSpec | null;
  // For a change with nothing to undo: why, in a few words.
  undoNote: string;
}

const READ: ResourceCommandTier = ResourceCommandTier.Read;
const SAFE: ResourceCommandTier = ResourceCommandTier.SafeWrite;
const RISKY: ResourceCommandTier = ResourceCommandTier.RiskyWrite;

function kindSpec(
  provider: CloudCatalogProvider,
  kind: string,
  tier: ResourceCommandTier,
  apiCall: string,
  permissions: ReadonlyArray<string>,
  requiresHuman: boolean = false,
): CloudOperationKindSpec {
  return { provider, kind, tier, requiresHuman, apiCall, permissions };
}

/*
 * The whole catalog. Order is the guides' order: the reads first, then the
 * changes from the safest up, the three a person always approves last.
 */
export const CLOUD_OPERATIONS: ReadonlyArray<CloudOperationSpec> = [
  {
    name: "describe",
    aliases: [],
    runsOn: "server",
    summary: "shows the resource's live settings and status",
    takesResource: true,
    kinds: [
      kindSpec("aws", "ecs-service", READ, "ECS DescribeServices", [
        "ecs:DescribeServices",
      ]),
      kindSpec(
        "aws",
        "ec2-instance",
        READ,
        "EC2 DescribeInstances and DescribeInstanceStatus",
        ["ec2:DescribeInstances", "ec2:DescribeInstanceStatus"],
      ),
      kindSpec("aws", "rds-instance", READ, "RDS DescribeDBInstances", [
        "rds:DescribeDBInstances",
      ]),
      kindSpec("aws", "rds-cluster", READ, "RDS DescribeDBClusters", [
        "rds:DescribeDBClusters",
      ]),
      kindSpec(
        "aws",
        "autoscaling-group",
        READ,
        "Auto Scaling DescribeAutoScalingGroups",
        ["autoscaling:DescribeAutoScalingGroups"],
      ),
      kindSpec(
        "aws",
        "lambda-function",
        READ,
        "Lambda GetFunctionConfiguration and GetFunctionConcurrency",
        ["lambda:GetFunctionConfiguration", "lambda:GetFunctionConcurrency"],
      ),
      kindSpec(
        "aws",
        "lambda-alias",
        READ,
        "Lambda GetAlias, and its function's GetFunctionConfiguration and GetFunctionConcurrency",
        [
          "lambda:GetAlias",
          "lambda:GetFunctionConfiguration",
          "lambda:GetFunctionConcurrency",
        ],
      ),
      kindSpec("aws", "sqs-queue", READ, "SQS GetQueueAttributes", [
        "sqs:GetQueueAttributes",
      ]),
      kindSpec(
        "aws",
        "elb-target-group",
        READ,
        "Elastic Load Balancing DescribeTargetGroups",
        ["elasticloadbalancing:DescribeTargetGroups"],
      ),
      kindSpec(
        "aws",
        "elb-load-balancer",
        READ,
        "Elastic Load Balancing DescribeLoadBalancers",
        ["elasticloadbalancing:DescribeLoadBalancers"],
      ),
      kindSpec(
        "aws",
        "*",
        READ,
        "OneUptime's stored copy from the account's last read, marked NOT LIVE: AWS has no one call for every kind",
        [],
      ),
      kindSpec(
        "azure",
        "*",
        READ,
        "Azure Resource Manager GET of the resource (with its instance view for a VM), or Resource Graph for a kind without one",
        ["*/read"],
      ),
      kindSpec(
        "gcp",
        "*",
        READ,
        "Cloud Asset Inventory's current record of the resource",
        ["cloudasset.assets.searchAllResources"],
      ),
    ],
    flags: [],
    undo: null,
    undoNote: "",
  },
  {
    name: "recent-events",
    aliases: ["events"],
    runsOn: "server",
    summary:
      "lists what the platform did to the resource lately: deployments and service events, RDS events, scaling activities, resource health and activity log entries",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "*",
        READ,
        "ECS DescribeServices events, RDS DescribeEvents, Auto Scaling DescribeScalingActivities, or CloudTrail LookupEvents for anything else",
        [
          "ecs:DescribeServices",
          "rds:DescribeEvents",
          "autoscaling:DescribeScalingActivities",
          "cloudtrail:LookupEvents",
        ],
      ),
      kindSpec(
        "azure",
        "*",
        READ,
        "Azure Resource Health availability and the Activity Log of the resource",
        [
          "Microsoft.ResourceHealth/availabilityStatuses/read",
          "Microsoft.Insights/eventtypes/values/read",
        ],
      ),
      kindSpec(
        "gcp",
        "*",
        READ,
        "the resource's Admin Activity audit log entries",
        ["logging.logEntries.list"],
      ),
    ],
    flags: [
      {
        name: "hours",
        kind: CloudParamKind.Integer,
        valueLabel: "N",
        description: `the last N hours (1-${CLOUD_MAX_EVENT_HOURS}, default ${CLOUD_DEFAULT_EVENT_HOURS})`,
        minimum: 1,
        maximum: CLOUD_MAX_EVENT_HOURS,
        defaultValue: CLOUD_DEFAULT_EVENT_HOURS,
        required: false,
      },
      limitFlag(),
    ],
    undo: null,
    undoNote: "",
  },
  {
    name: "target-health",
    aliases: [],
    runsOn: "server",
    summary:
      "shows which backends a load balancer counts as healthy, and why the others are not",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "elb-target-group",
        READ,
        "Elastic Load Balancing DescribeTargetHealth of the target group",
        ["elasticloadbalancing:DescribeTargetHealth"],
      ),
      kindSpec(
        "aws",
        "elb-load-balancer",
        READ,
        "Elastic Load Balancing DescribeTargetGroups and DescribeTargetHealth of each of its target groups",
        [
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:DescribeTargetHealth",
        ],
      ),
    ],
    flags: [],
    undo: null,
    undoNote: "",
  },
  {
    name: "quota-usage",
    aliases: ["quotas"],
    runsOn: "server",
    summary:
      "shows the account's usage against its limits for the resource's service, in the resource's Region",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "*",
        READ,
        "Service Quotas ListServiceQuotas for the resource's service, with each quota's usage metric from CloudWatch",
        ["servicequotas:ListServiceQuotas", "cloudwatch:GetMetricData"],
      ),
      kindSpec(
        "azure",
        "*",
        READ,
        "the Compute usages of the resource's location",
        ["Microsoft.Compute/locations/usages/read"],
      ),
      kindSpec(
        "gcp",
        "*",
        READ,
        "Cloud Monitoring's quota usage and limit series for the resource's region",
        ["monitoring.timeSeries.list"],
      ),
    ],
    flags: [limitFlag()],
    undo: null,
    undoNote: "",
  },
  {
    name: "read-logs",
    aliases: ["logs"],
    runsOn: "server",
    summary:
      "shows the resource's recent log lines, newest first, optionally only those containing --filter; off until someone lets AI read the account's logs",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "lambda-function",
        READ,
        "CloudWatch Logs FilterLogEvents on the function's log group",
        ["lambda:GetFunctionConfiguration", "logs:FilterLogEvents"],
      ),
      kindSpec(
        "aws",
        "lambda-alias",
        READ,
        "CloudWatch Logs FilterLogEvents on its function's log group",
        ["lambda:GetFunctionConfiguration", "logs:FilterLogEvents"],
      ),
      kindSpec(
        "aws",
        "ecs-service",
        READ,
        "CloudWatch Logs FilterLogEvents on the log groups its task definition names",
        [
          "ecs:DescribeServices",
          "ecs:DescribeTaskDefinition",
          "logs:FilterLogEvents",
        ],
      ),
      kindSpec(
        "aws",
        "rds-instance",
        READ,
        "CloudWatch Logs FilterLogEvents on the instance's exported log groups",
        ["logs:DescribeLogGroups", "logs:FilterLogEvents"],
      ),
      kindSpec(
        "aws",
        "rds-cluster",
        READ,
        "CloudWatch Logs FilterLogEvents on the cluster's exported log groups",
        ["logs:DescribeLogGroups", "logs:FilterLogEvents"],
      ),
      kindSpec(
        "aws",
        "*",
        READ,
        "CloudWatch Logs FilterLogEvents on a log group named by its ARN",
        ["logs:FilterLogEvents"],
      ),
      kindSpec(
        "azure",
        "*",
        READ,
        "a resource-centric Log Analytics query of the resource's logs",
        ["Microsoft.Insights/logs/*/read"],
      ),
      kindSpec(
        "gcp",
        "*",
        READ,
        "Cloud Logging entries.list for the resource",
        ["logging.logEntries.list"],
      ),
    ],
    flags: [
      {
        name: "filter",
        kind: CloudParamKind.SearchText,
        valueLabel: "TEXT",
        description: `only lines containing TEXT (1-${CLOUD_MAX_SEARCH_TEXT_LENGTH} letters, digits, spaces and . _ : / @ = , + # ( ) -)`,
        required: false,
      },
      {
        name: "minutes",
        kind: CloudParamKind.Integer,
        valueLabel: "N",
        description: `the last N minutes (1-${CLOUD_MAX_LOG_MINUTES}, default ${CLOUD_DEFAULT_LOG_MINUTES})`,
        minimum: 1,
        maximum: CLOUD_MAX_LOG_MINUTES,
        defaultValue: CLOUD_DEFAULT_LOG_MINUTES,
        required: false,
      },
      limitFlag(),
    ],
    undo: null,
    undoNote: "",
  },
  {
    name: "whoami",
    aliases: [],
    runsOn: "agent",
    summary:
      "shows the account the Cloud AI agent acts in, the operations its role allows and whether it may change anything",
    takesResource: false,
    kinds: [
      kindSpec("aws", "*", READ, "STS GetCallerIdentity", []),
      kindSpec(
        "azure",
        "*",
        READ,
        "Azure Resource Manager GET of the subscription",
        ["Microsoft.Resources/subscriptions/read"],
      ),
      kindSpec(
        "gcp",
        "*",
        READ,
        "the metadata server's project and service account",
        [],
      ),
    ],
    flags: [],
    undo: null,
    undoNote: "",
  },
  {
    name: "restart-service",
    aliases: [],
    runsOn: "agent",
    summary:
      "restarts the service on the version it runs now: a new ECS deployment (a rolling replacement), or an App Service, Function App or Container App revision restart",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "ecs-service",
        SAFE,
        "ecs:UpdateService with forceNewDeployment",
        ["ecs:UpdateService", "ecs:DescribeServices"],
      ),
      kindSpec("azure", "app-service", RISKY, "Microsoft.Web/sites restart", [
        "Microsoft.Web/sites/restart/action",
        "Microsoft.Web/sites/read",
      ]),
      kindSpec(
        "azure",
        "container-app",
        RISKY,
        "Microsoft.App/containerApps revision restart of its latest ready revision",
        [
          "Microsoft.App/containerApps/revisions/restart/action",
          "Microsoft.App/containerApps/read",
        ],
      ),
    ],
    flags: [],
    undo: null,
    undoNote: "nothing to undo: the same version runs again",
  },
  {
    name: "start-instance",
    aliases: [],
    runsOn: "agent",
    summary: "starts a stopped instance or virtual machine",
    takesResource: true,
    kinds: [
      kindSpec("aws", "ec2-instance", SAFE, "ec2:StartInstances", [
        "ec2:StartInstances",
        "ec2:DescribeInstances",
      ]),
      kindSpec("aws", "rds-instance", SAFE, "rds:StartDBInstance", [
        "rds:StartDBInstance",
        "rds:DescribeDBInstances",
      ]),
      kindSpec(
        "azure",
        "virtual-machine",
        SAFE,
        "Microsoft.Compute/virtualMachines start",
        [
          "Microsoft.Compute/virtualMachines/start/action",
          "Microsoft.Compute/virtualMachines/read",
        ],
      ),
      kindSpec("gcp", "compute-instance", SAFE, "compute.instances.start", [
        "compute.instances.start",
        "compute.instances.get",
      ]),
    ],
    flags: [],
    undo: {
      operation: "stop-instance",
      valueFlag: null,
      valueKey: null,
      keepFlags: [],
    },
    undoNote: "",
  },
  {
    name: "scale-out",
    aliases: [],
    runsOn: "agent",
    summary:
      "raises a service's or group's desired count, within its limits: an ECS service's desired count, an Auto Scaling group's desired capacity, an App Service plan's or VM scale set's instance count, a Cloud Run service's minimum instances or a managed instance group's size",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "ecs-service",
        SAFE,
        "ecs:UpdateService with desiredCount",
        [
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "application-autoscaling:DescribeScalableTargets",
        ],
      ),
      kindSpec(
        "aws",
        "autoscaling-group",
        SAFE,
        "autoscaling:SetDesiredCapacity",
        [
          "autoscaling:SetDesiredCapacity",
          "autoscaling:DescribeAutoScalingGroups",
        ],
      ),
      kindSpec(
        "azure",
        "app-service-plan",
        SAFE,
        "Microsoft.Web/serverfarms update of sku.capacity",
        ["Microsoft.Web/serverfarms/write", "Microsoft.Web/serverfarms/read"],
      ),
      kindSpec(
        "azure",
        "vm-scale-set",
        SAFE,
        "Microsoft.Compute/virtualMachineScaleSets update of sku.capacity",
        [
          "Microsoft.Compute/virtualMachineScaleSets/write",
          "Microsoft.Compute/virtualMachineScaleSets/read",
        ],
      ),
      kindSpec(
        "gcp",
        "cloud-run-service",
        SAFE,
        "run.services.patch of scaling.minInstanceCount",
        ["run.services.update", "run.services.get"],
      ),
      kindSpec(
        "gcp",
        "managed-instance-group",
        SAFE,
        "compute.instanceGroupManagers.resize",
        [
          "compute.instanceGroupManagers.update",
          "compute.instanceGroupManagers.get",
        ],
      ),
    ],
    flags: [countFlag("out")],
    undo: {
      operation: "scale-in",
      valueFlag: "count",
      valueKey: "count",
      keepFlags: [],
    },
    undoNote: "",
  },
  {
    name: "scale-in",
    aliases: [],
    runsOn: "agent",
    summary:
      "lowers a service's or group's desired count, never below its minimum or to zero",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "ecs-service",
        RISKY,
        "ecs:UpdateService with desiredCount",
        [
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "application-autoscaling:DescribeScalableTargets",
        ],
      ),
      kindSpec(
        "aws",
        "autoscaling-group",
        RISKY,
        "autoscaling:SetDesiredCapacity",
        [
          "autoscaling:SetDesiredCapacity",
          "autoscaling:DescribeAutoScalingGroups",
        ],
      ),
      kindSpec(
        "azure",
        "app-service-plan",
        RISKY,
        "Microsoft.Web/serverfarms update of sku.capacity",
        ["Microsoft.Web/serverfarms/write", "Microsoft.Web/serverfarms/read"],
      ),
      kindSpec(
        "azure",
        "vm-scale-set",
        RISKY,
        "Microsoft.Compute/virtualMachineScaleSets update of sku.capacity",
        [
          "Microsoft.Compute/virtualMachineScaleSets/write",
          "Microsoft.Compute/virtualMachineScaleSets/read",
        ],
      ),
      kindSpec(
        "gcp",
        "cloud-run-service",
        RISKY,
        "run.services.patch of scaling.minInstanceCount",
        ["run.services.update", "run.services.get"],
      ),
      kindSpec(
        "gcp",
        "managed-instance-group",
        RISKY,
        "compute.instanceGroupManagers.resize",
        [
          "compute.instanceGroupManagers.update",
          "compute.instanceGroupManagers.get",
        ],
      ),
    ],
    flags: [countFlag("in")],
    undo: {
      operation: "scale-out",
      valueFlag: "count",
      valueKey: "count",
      keepFlags: [],
    },
    undoNote: "",
  },
  {
    name: "reboot-instance",
    aliases: [],
    runsOn: "agent",
    summary:
      "reboots an instance, a virtual machine or a database server in place (an RDS instance without failover)",
    takesResource: true,
    kinds: [
      kindSpec("aws", "ec2-instance", RISKY, "ec2:RebootInstances", [
        "ec2:RebootInstances",
        "ec2:DescribeInstances",
      ]),
      kindSpec(
        "aws",
        "rds-instance",
        RISKY,
        "rds:RebootDBInstance without ForceFailover",
        ["rds:RebootDBInstance", "rds:DescribeDBInstances"],
      ),
      kindSpec(
        "azure",
        "virtual-machine",
        RISKY,
        "Microsoft.Compute/virtualMachines restart",
        [
          "Microsoft.Compute/virtualMachines/restart/action",
          "Microsoft.Compute/virtualMachines/read",
        ],
      ),
      kindSpec(
        "azure",
        "postgresql-flexible-server",
        RISKY,
        "Microsoft.DBforPostgreSQL/flexibleServers restart",
        [
          "Microsoft.DBforPostgreSQL/flexibleServers/restart/action",
          "Microsoft.DBforPostgreSQL/flexibleServers/read",
        ],
      ),
      kindSpec(
        "azure",
        "mysql-flexible-server",
        RISKY,
        "Microsoft.DBforMySQL/flexibleServers restart",
        [
          "Microsoft.DBforMySQL/flexibleServers/restart/action",
          "Microsoft.DBforMySQL/flexibleServers/read",
        ],
      ),
      kindSpec("gcp", "compute-instance", RISKY, "compute.instances.reset", [
        "compute.instances.reset",
        "compute.instances.get",
      ]),
      kindSpec(
        "gcp",
        "cloud-sql-instance",
        RISKY,
        "Cloud SQL instances.restart",
        ["cloudsql.instances.restart", "cloudsql.instances.get"],
      ),
    ],
    flags: [],
    undo: null,
    undoNote: "nothing to undo",
  },
  {
    name: "roll-back-service",
    aliases: ["rollback-service"],
    runsOn: "agent",
    summary:
      "moves a service back to the version it ran before (or to --to): an ECS service's previous task definition, a Lambda alias's previous version, an App Service slot swap back, a Container App's or Cloud Run service's traffic to its previous revision",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "ecs-service",
        RISKY,
        "ecs:UpdateService with taskDefinition (a revision of the service's own family)",
        [
          "ecs:UpdateService",
          "ecs:DescribeServices",
          "ecs:ListTaskDefinitions",
        ],
      ),
      kindSpec(
        "aws",
        "lambda-alias",
        RISKY,
        "lambda:UpdateAlias with FunctionVersion (a version of the same function)",
        [
          "lambda:UpdateAlias",
          "lambda:GetAlias",
          "lambda:ListVersionsByFunction",
        ],
      ),
      kindSpec(
        "azure",
        "app-service",
        RISKY,
        "Microsoft.Web/sites slotsswap between --slot and production",
        [
          "Microsoft.Web/sites/slotsswap/action",
          "Microsoft.Web/sites/slots/read",
        ],
      ),
      kindSpec(
        "azure",
        "container-app",
        RISKY,
        "Microsoft.App/containerApps update of its traffic weights (a revision of the same app)",
        [
          "Microsoft.App/containerApps/write",
          "Microsoft.App/containerApps/read",
          "Microsoft.App/containerApps/revisions/read",
        ],
      ),
      kindSpec(
        "gcp",
        "cloud-run-service",
        RISKY,
        "run.services.patch of its traffic (a revision of the same service)",
        ["run.services.update", "run.services.get", "run.revisions.list"],
      ),
    ],
    flags: [
      {
        name: "to",
        kind: CloudParamKind.Version,
        valueLabel: "VERSION",
        description:
          "the version to move to (a task definition family:revision, a Lambda version, a revision name); without it, the one before the current one",
        required: false,
        kinds: [
          "ecs-service",
          "lambda-alias",
          "container-app",
          "cloud-run-service",
        ],
      },
      {
        name: "slot",
        kind: CloudParamKind.SlotName,
        valueLabel: "SLOT",
        description:
          "the deployment slot to swap with production (swapping the same pair again puts each version back)",
        required: true,
        kinds: ["app-service"],
      },
    ],
    undo: {
      operation: "roll-back-service",
      valueFlag: "to",
      valueKey: "version",
      keepFlags: ["slot"],
    },
    undoNote: "",
  },
  {
    name: "set-concurrency",
    aliases: [],
    runsOn: "agent",
    summary:
      "sets how many copies may run at once: a Lambda function's reserved concurrency or a Cloud Run service's maximum instances",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "lambda-function",
        RISKY,
        "lambda:PutFunctionConcurrency (DeleteFunctionConcurrency for none)",
        [
          "lambda:PutFunctionConcurrency",
          "lambda:DeleteFunctionConcurrency",
          "lambda:GetFunctionConcurrency",
        ],
      ),
      kindSpec(
        "gcp",
        "cloud-run-service",
        RISKY,
        "run.services.patch of the template's scaling.maxInstanceCount",
        ["run.services.update", "run.services.get"],
      ),
    ],
    flags: [
      {
        name: "value",
        kind: CloudParamKind.Limit,
        valueLabel: "N|none",
        description: `the new limit (1-${CLOUD_MAX_LIMIT_VALUE}; never 0, which would stop it), or none for no explicit limit`,
        minimum: 1,
        maximum: CLOUD_MAX_LIMIT_VALUE,
        required: true,
      },
    ],
    undo: {
      operation: "set-concurrency",
      valueFlag: "value",
      valueKey: "value",
      keepFlags: [],
    },
    undoNote: "",
  },
  {
    name: "fail-over-database",
    aliases: ["failover-database"],
    runsOn: "agent",
    summary:
      "fails a database over to its standby: an Aurora cluster failover, an RDS Multi-AZ reboot with failover, a SQL failover group failover or a Cloud SQL failover",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "rds-cluster",
        RISKY,
        "rds:FailoverDBCluster",
        ["rds:FailoverDBCluster", "rds:DescribeDBClusters"],
        true,
      ),
      kindSpec(
        "aws",
        "rds-instance",
        RISKY,
        "rds:RebootDBInstance with ForceFailover (Multi-AZ only)",
        ["rds:RebootDBInstance", "rds:DescribeDBInstances"],
        true,
      ),
      kindSpec(
        "azure",
        "sql-failover-group",
        RISKY,
        "Microsoft.Sql/servers/failoverGroups failover (planned)",
        [
          "Microsoft.Sql/servers/failoverGroups/failover/action",
          "Microsoft.Sql/servers/failoverGroups/read",
        ],
        true,
      ),
      kindSpec(
        "gcp",
        "cloud-sql-instance",
        RISKY,
        "Cloud SQL instances.failover (high availability only)",
        ["cloudsql.instances.failover", "cloudsql.instances.get"],
        true,
      ),
    ],
    flags: [],
    undo: {
      operation: "fail-over-database",
      valueFlag: null,
      valueKey: null,
      keepFlags: [],
    },
    undoNote: "",
  },
  {
    name: "stop-instance",
    aliases: [],
    runsOn: "agent",
    summary:
      "stops an instance or virtual machine (an Azure VM is deallocated)",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "ec2-instance",
        RISKY,
        "ec2:StopInstances",
        ["ec2:StopInstances", "ec2:DescribeInstances"],
        true,
      ),
      kindSpec(
        "azure",
        "virtual-machine",
        RISKY,
        "Microsoft.Compute/virtualMachines deallocate",
        [
          "Microsoft.Compute/virtualMachines/deallocate/action",
          "Microsoft.Compute/virtualMachines/read",
        ],
        true,
      ),
      kindSpec(
        "gcp",
        "compute-instance",
        RISKY,
        "compute.instances.stop",
        ["compute.instances.stop", "compute.instances.get"],
        true,
      ),
    ],
    flags: [],
    undo: {
      operation: "start-instance",
      valueFlag: null,
      valueKey: null,
      keepFlags: [],
    },
    undoNote: "",
  },
  {
    name: "redrive-queue",
    aliases: [],
    runsOn: "agent",
    summary:
      "moves the messages of an SQS dead-letter queue back to the queue they came from",
    takesResource: true,
    kinds: [
      kindSpec(
        "aws",
        "sqs-queue",
        RISKY,
        "sqs:StartMessageMoveTask from the dead-letter queue to its source queue",
        [
          "sqs:StartMessageMoveTask",
          "sqs:GetQueueAttributes",
          "sqs:ListDeadLetterSourceQueues",
          "sqs:ReceiveMessage",
          "sqs:DeleteMessage",
          "sqs:SendMessage",
        ],
        true,
      ),
    ],
    flags: [],
    undo: null,
    undoNote: "nothing to undo",
  },
];

// The canonical operation names, in catalog order.
export const CLOUD_OPERATION_NAMES: ReadonlyArray<string> =
  CLOUD_OPERATIONS.map((operation: CloudOperationSpec): string => {
    return operation.name;
  });

// The changes (every operation the agent runs but whoami), in catalog order.
export const CLOUD_CHANGE_OPERATION_NAMES: ReadonlyArray<string> =
  CLOUD_OPERATIONS.filter((operation: CloudOperationSpec): boolean => {
    return isCloudChangeOperation(operation);
  }).map((operation: CloudOperationSpec): string => {
    return operation.name;
  });

/*
 * A DRY RUN of one change: `cloud dry-run <change> RESOURCE [--flag value]`,
 * the change written exactly as it would run.
 *
 * The Cloud AI agent checks the change the way it would before making it -
 * the changes it may make (ONEUPTIME_AI_CLOUD_OPERATIONS), its write scope
 * (ONEUPTIME_AI_ALLOW_WRITES, the write and protected targets), the account
 * and the required tag, the resource's state and the bounds of a scale -
 * reads the value the change would replace, and stops before the ONE call
 * that makes it. Its output starts with the dry run's verdict
 * (formatCloudDryRunVerdict) and, when the change would run, the value it
 * would replace (formatCloudReplacedValue), then says what would change and
 * how it would be undone. On AWS the dry run reads with a session of the
 * write role whose session policy holds the change's reads only, so it
 * cannot write even by mistake.
 *
 * It is a Read - it changes nothing - so an investigation may run it, and
 * OneUptime runs it for a person about to approve a fix. It runs on the
 * agent, never on the server: only the agent knows its settings and holds
 * the role. An agent older than dry runs refuses the command, as its
 * catalog knows no dry-run operation, so a dry run is never mistaken for
 * the change it checks.
 *
 * Not in CLOUD_OPERATIONS: it is no operation of its own on any kind of
 * resource, and every list of the catalog's operations (the guides, the
 * setup command's permissions, the docs) stays the list of what the agent
 * can do.
 */
export const CLOUD_DRY_RUN_OPERATION_NAME: string = "dry-run";

export const CLOUD_DRY_RUN_OPERATION: CloudOperationSpec = {
  name: CLOUD_DRY_RUN_OPERATION_NAME,
  aliases: [],
  runsOn: "agent",
  summary:
    "checks one change the way the agent would make it and reads the value it would replace, without making it",
  takesResource: true,
  kinds: [],
  flags: [],
  undo: null,
  undoNote: "a dry run changes nothing",
};

// Whether a parsed command is a dry run (of the change it carries).
export function isCloudDryRun(command: ParsedCloudCommand): boolean {
  return (
    command.operation.name === CLOUD_DRY_RUN_OPERATION_NAME &&
    Boolean(command.dryRunOf)
  );
}

// A change: something the agent runs that is not a read.
export function isCloudChangeOperation(operation: CloudOperationSpec): boolean {
  return operation.kinds.some((kind: CloudOperationKindSpec): boolean => {
    return kind.tier !== ResourceCommandTier.Read;
  });
}

// The operation a word names exactly (canonical name or alias), or null.
export function getCloudOperation(word: unknown): CloudOperationSpec | null {
  if (typeof word !== "string" || !word) {
    return null;
  }

  for (const operation of CLOUD_OPERATIONS) {
    if (operation.name === word || operation.aliases.includes(word)) {
      return operation;
    }
  }

  return null;
}

/*
 * How an operation applies to this cloud and kind: the kind's own entry,
 * else the cloud's "*" entry (reads), else null (not supported).
 */
export function getCloudOperationKind(
  operation: CloudOperationSpec,
  provider: CloudCatalogProvider,
  kind: string | null,
): CloudOperationKindSpec | null {
  let any: CloudOperationKindSpec | null = null;

  for (const spec of operation.kinds) {
    if (spec.provider !== provider) {
      continue;
    }

    if (kind !== null && spec.kind === kind) {
      return spec;
    }

    if (spec.kind === "*") {
      any = spec;
    }
  }

  return any;
}

// The kinds of this cloud an operation supports, by name ("ECS service").
export function describeCloudOperationKinds(
  operation: CloudOperationSpec,
  provider: CloudCatalogProvider,
): Array<string> {
  return operation.kinds
    .filter((spec: CloudOperationKindSpec): boolean => {
      return spec.provider === provider && spec.kind !== "*";
    })
    .map((spec: CloudOperationKindSpec): string => {
      const known: CloudResourceKindSpec | null = getCloudResourceKind(
        provider,
        spec.kind,
      );

      return known ? known.displayName : spec.kind;
    });
}

// Whether an operation exists on this cloud at all.
export function isCloudOperationAvailable(
  operation: CloudOperationSpec,
  provider: CloudCatalogProvider,
): boolean {
  return operation.kinds.some((spec: CloudOperationKindSpec): boolean => {
    return spec.provider === provider;
  });
}

// ---- The grammar --------------------------------------------------------------

// A flag's value, as the runner receives it ("none" stays a word).
export type CloudParamValue = string | number;

// One `cloud` command, read.
export interface ParsedCloudCommand {
  operation: CloudOperationSpec;
  provider: CloudCatalogProvider;
  // The resource it names; null for whoami.
  resource: ParsedCloudResource | null;
  // How the operation applies to that resource.
  kindSpec: CloudOperationKindSpec;
  // Each given flag's value by flag name (numbers for Integer flags).
  flags: Record<string, CloudParamValue>;
  // The canonical argv WITHOUT the program: operation, resource, flags in catalog order.
  canonicalArgs: Array<string>;
  /*
   * A dry run only: the change it checks, read by the same grammar. The dry
   * run itself is CLOUD_DRY_RUN_OPERATION, a Read: nothing that does not
   * know dry runs can take it for the change.
   */
  dryRunOf?: ParsedCloudCommand | undefined;
}

export type CloudCommandParse =
  | { ok: true; command: ParsedCloudCommand }
  | { ok: false; errorMessage: string };

const INTEGER_REGEX: RegExp = /^(?:0|[1-9][0-9]{0,8})$/;
const VERSION_REGEX: RegExp = /^[A-Za-z0-9._:$][A-Za-z0-9._:$-]{0,254}$/;
const SLOT_NAME_REGEX: RegExp = /^[A-Za-z0-9][A-Za-z0-9-]{0,58}$/;
const SEARCH_TEXT_REGEX: RegExp = /^[A-Za-z0-9 _.:/@=,+#()-]{1,128}$/;
const FLAG_NAME_REGEX: RegExp = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;

function joinWords(words: ReadonlyArray<string>, conjunction: string): string {
  if (words.length <= 1) {
    return words.join("");
  }

  return `${words.slice(0, -1).join(", ")} ${conjunction} ${
    words[words.length - 1]
  }`;
}

function appliesToKind(param: CloudParamSpec, kind: string | null): boolean {
  return !param.kinds || (kind !== null && param.kinds.includes(kind));
}

// "cloud scale-out RESOURCE --count N" for one operation (and kind, when known).
export function describeCloudOperationUsage(
  operation: CloudOperationSpec,
  kind: string | null = null,
): string {
  const words: Array<string> = [CLOUD_PROGRAM, operation.name];

  if (operation.takesResource) {
    words.push("RESOURCE");
  }

  for (const flag of operation.flags) {
    if (kind !== null && !appliesToKind(flag, kind)) {
      continue;
    }

    const written: string = `--${flag.name} ${flag.valueLabel}`;
    words.push(
      flag.required && (kind !== null || !flag.kinds)
        ? written
        : `[${written}]`,
    );
  }

  return words.join(" ");
}

function describeFlags(operation: CloudOperationSpec): string {
  if (operation.flags.length === 0) {
    return `cloud ${operation.name} takes no flags`;
  }

  return `cloud ${operation.name} takes ${joinWords(
    operation.flags.map((flag: CloudParamSpec): string => {
      return `--${flag.name}`;
    }),
    "and",
  )}`;
}

function operationList(provider: CloudCatalogProvider): string {
  return `the operations on ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} are ${CLOUD_OPERATIONS.filter(
    (operation: CloudOperationSpec): boolean => {
      return isCloudOperationAvailable(operation, provider);
    },
  )
    .map((operation: CloudOperationSpec): string => {
      return operation.name;
    })
    .join(", ")}`;
}

/*
 * What a model may write out of CLI habit, and what to write instead: the
 * catalog's word for the same change, or why there is none.
 */
const NEVER_OPERATIONS: ReadonlyArray<{
  words: ReadonlyArray<string>;
  reason: string;
}> = [
  {
    words: [
      "delete",
      "terminate",
      "remove",
      "destroy",
      "rm",
      "purge",
      "purge-queue",
      "delete-service",
      "terminate-instance",
      "delete-instance",
    ],
    reason: "deleting, terminating or purging anything is never available",
  },
  {
    words: [
      "iam",
      "attach-role-policy",
      "put-role-policy",
      "create-access-key",
      "create-role",
      "role-assignment",
      "add-iam-policy-binding",
      "set-iam-policy",
    ],
    reason: "IAM roles, policies, users and keys are never changed",
  },
  {
    words: [
      "authorize-security-group-ingress",
      "security-group",
      "firewall",
      "nsg",
      "route-table",
      "open-port",
    ],
    reason:
      "security groups, network security groups, firewall rules and route tables are never changed",
  },
  {
    words: [
      "get-secret-value",
      "secret",
      "secrets",
      "kms",
      "decrypt",
      "get-parameter",
    ],
    reason: "secrets and keys are never read or changed",
  },
  {
    words: [
      "s3",
      "get-object",
      "put-object",
      "query",
      "scan",
      "sql",
      "exec",
      "run-command",
      "ssm",
      "ssh",
    ],
    reason:
      "storage and database contents are never read or written, and nothing runs inside a resource",
  },
  {
    words: [
      "resize-instance",
      "modify-instance",
      "change-instance-type",
      "snapshot",
      "create-snapshot",
      "restore",
      "restore-db-instance",
      "set-min",
      "set-max",
      "update-auto-scaling-group",
    ],
    reason:
      "instance types, snapshots and restores, and a group's minimum or maximum are never changed",
  },
];

const ALIASES_OF_CHANGES: Readonly<Record<string, string>> = {
  restart: "restart-service",
  "force-new-deployment": "restart-service",
  redeploy: "restart-service",
  start: "start-instance",
  "start-instances": "start-instance",
  "start-vm": "start-instance",
  stop: "stop-instance",
  "stop-instances": "stop-instance",
  deallocate: "stop-instance",
  reboot: "reboot-instance",
  "reboot-instances": "reboot-instance",
  reset: "reboot-instance",
  scale: "scale-out or scale-in",
  "set-desired-capacity": "scale-out or scale-in",
  "update-service": "restart-service, scale-out, scale-in or roll-back-service",
  rollback: "roll-back-service",
  "roll-back": "roll-back-service",
  failover: "fail-over-database",
  "put-function-concurrency": "set-concurrency",
  redrive: "redrive-queue",
  "start-message-move-task": "redrive-queue",
  get: "describe",
  show: "describe",
  status: "describe",
  health: "target-health",
  "describe-target-health": "target-health",
  quota: "quota-usage",
  log: "read-logs",
  tail: "read-logs",
  "who-am-i": "whoami",
  "get-caller-identity": "whoami",
};

function describeUnknownOperation(
  word: string,
  provider: CloudCatalogProvider,
): string {
  const folded: string = word.toLowerCase();

  if (getCloudOperation(folded)) {
    return `operations are lowercase: write ${quoteCloudWord(folded)}, not ${quoteCloudWord(word)}`;
  }

  if (word === "aws" || word === "az" || word === "gcloud") {
    return `cloud is not the ${word} CLI and never runs one: it runs one operation from a fixed catalog; ${operationList(provider)}`;
  }

  for (const never of NEVER_OPERATIONS) {
    if (never.words.includes(folded)) {
      return `${quoteCloudWord(word)} is not available: ${never.reason}; ${operationList(provider)}`;
    }
  }

  if (Object.prototype.hasOwnProperty.call(ALIASES_OF_CHANGES, folded)) {
    return `${quoteCloudWord(word)} is not a cloud operation; write ${
      ALIASES_OF_CHANGES[folded] || "one of the catalog's operations"
    } instead`;
  }

  return `${quoteCloudWord(word)} is not a cloud operation; ${operationList(provider)}`;
}

// Why a value is not what the parameter takes; null when it is.
function describeValueProblem(
  param: CloudParamSpec,
  value: string,
  shownName: string,
): string | null {
  switch (param.kind) {
    case CloudParamKind.Integer:
    case CloudParamKind.Limit: {
      if (param.kind === CloudParamKind.Limit && value === "none") {
        return null;
      }

      const minimum: number = param.minimum === undefined ? 0 : param.minimum;
      const maximum: number =
        param.maximum === undefined ? CLOUD_MAX_COUNT : param.maximum;

      if (INTEGER_REGEX.test(value)) {
        const parsed: number = Number(value);

        if (parsed >= minimum && parsed <= maximum) {
          return null;
        }
      }

      return `${shownName} must be a whole number from ${minimum} to ${maximum}${
        param.kind === CloudParamKind.Limit ? ' or the word "none"' : ""
      }, written without leading zeros (got ${quoteCloudWord(value)})`;
    }

    case CloudParamKind.Version:
      return VERSION_REGEX.test(value)
        ? null
        : `${shownName} must be one version or revision name of 1-${CLOUD_MAX_VERSION_LENGTH} letters, digits and . _ : $ - that does not start with "-" (got ${quoteCloudWord(value)})`;

    case CloudParamKind.SlotName:
      return SLOT_NAME_REGEX.test(value)
        ? null
        : `${shownName} must be a deployment slot's name: letters, digits and - (got ${quoteCloudWord(value)})`;

    case CloudParamKind.SearchText:
      return SEARCH_TEXT_REGEX.test(value) && value.trim() !== ""
        ? null
        : `${shownName} must be 1-${CLOUD_MAX_SEARCH_TEXT_LENGTH} letters, digits, spaces and . _ : / @ = , + # ( ) - — no quotes, backslashes or query syntax (got ${quoteCloudWord(value)})`;

    default:
      return `${shownName} has a type cloud does not know`;
  }
}

function toParamValue(param: CloudParamSpec, value: string): CloudParamValue {
  if (param.kind === CloudParamKind.Integer) {
    return Number(value);
  }

  if (param.kind === CloudParamKind.Limit) {
    return value === "none" ? value : Number(value);
  }

  return value;
}

function refuse(errorMessage: string): CloudCommandParse {
  return { ok: false, errorMessage };
}

/*
 * Read one `cloud` argv (argv[0] is the program) for this cloud into one
 * catalog operation on one resource, or say why it is not one. Total:
 * anything that is not an array of strings, however malformed, is refused,
 * never thrown on.
 */
export function parseCloudCommand(
  provider: CloudCatalogProvider,
  argv: unknown,
): CloudCommandParse {
  if (!ALL_CLOUD_CATALOG_PROVIDERS.includes(provider)) {
    return refuse("this resource is not in a cloud the catalog knows");
  }

  if (!Array.isArray(argv) || argv.length === 0) {
    return refuse("empty command");
  }

  if (
    argv.some((word: unknown): boolean => {
      return typeof word !== "string";
    })
  ) {
    return refuse("every word of the command must be a string");
  }

  const words: Array<string> = argv as Array<string>;

  if (words[0] !== CLOUD_PROGRAM) {
    return refuse(
      `a cloud command starts with "${CLOUD_PROGRAM}" (got ${quoteCloudWord(words[0] || "")})`,
    );
  }

  const operationWord: string | undefined = words[1];

  if (operationWord === undefined || operationWord === "") {
    return refuse(
      `name an operation: "cloud <operation> RESOURCE [--flag value]"; ${operationList(provider)}`,
    );
  }

  if (operationWord.startsWith("-")) {
    return refuse(
      `the operation comes right after "cloud", before any flag (got ${quoteCloudWord(operationWord)}); ${operationList(provider)}`,
    );
  }

  if (operationWord === CLOUD_DRY_RUN_OPERATION_NAME) {
    return parseCloudDryRun(provider, words);
  }

  const operation: CloudOperationSpec | null = getCloudOperation(operationWord);

  if (!operation) {
    return refuse(describeUnknownOperation(operationWord, provider));
  }

  if (!isCloudOperationAvailable(operation, provider)) {
    return refuse(
      `cloud ${operation.name} is not available on ${CLOUD_CATALOG_PROVIDER_NAMES[provider]}; ${operationList(provider)}`,
    );
  }

  const usage: string = `usage: ${describeCloudOperationUsage(operation)}`;
  const rawFlags: Array<{ flag: CloudParamSpec; value: string }> = [];
  let resourceWord: string | null = null;
  let afterDoubleDash: boolean = false;

  for (let i: number = 2; i < words.length; i++) {
    const word: string = words[i] || "";

    if (!afterDoubleDash && word === "--") {
      afterDoubleDash = true;
      continue;
    }

    if (!afterDoubleDash && word.startsWith("-") && word !== "-") {
      if (!word.startsWith("--")) {
        return refuse(
          `cloud takes long flags only, written like "--count 4" or "--count=4"; ${quoteCloudWord(word)} is not one (${describeFlags(operation)}; ${usage})`,
        );
      }

      const equals: number = word.indexOf("=");
      const rawName: string =
        equals >= 0 ? word.slice(2, equals) : word.slice(2);

      if (!FLAG_NAME_REGEX.test(rawName)) {
        const lower: string = rawName.toLowerCase().replace(/_/g, "-");
        const known: CloudParamSpec | undefined = operation.flags.find(
          (flag: CloudParamSpec): boolean => {
            return flag.name === lower;
          },
        );

        return refuse(
          known
            ? `flags are lowercase words joined by dashes: write --${known.name}, not ${quoteCloudWord(`--${rawName}`)}`
            : `${quoteCloudWord(word)} is not a flag cloud knows (${describeFlags(operation)}; ${usage})`,
        );
      }

      const flag: CloudParamSpec | undefined = operation.flags.find(
        (candidate: CloudParamSpec): boolean => {
          return candidate.name === rawName;
        },
      );

      if (!flag) {
        if (rawName === CLOUD_DRY_RUN_OPERATION_NAME) {
          return refuse(
            isCloudChangeOperation(operation)
              ? `a dry run is a command of its own: write "cloud ${CLOUD_DRY_RUN_OPERATION_NAME} ${operation.name} RESOURCE ...", the change exactly as it would run, without --${CLOUD_DRY_RUN_OPERATION_NAME}`
              : `cloud ${operation.name} changes nothing, so it has nothing to dry-run: run it without --${CLOUD_DRY_RUN_OPERATION_NAME}`,
          );
        }

        if (
          [
            "region",
            "profile",
            "role-arn",
            "subscription",
            "project",
            "account",
            "credentials",
            "endpoint-url",
          ].includes(rawName)
        ) {
          return refuse(
            `--${rawName} is not available: the Cloud AI agent acts in its own account with its own role, and the resource's id already says where it is (${describeFlags(operation)})`,
          );
        }

        return refuse(
          `${describeFlags(operation)}, not --${rawName} (${usage})`,
        );
      }

      if (
        rawFlags.some((given: { flag: CloudParamSpec }): boolean => {
          return given.flag.name === flag.name;
        })
      ) {
        return refuse(
          `--${flag.name} is given more than once; give each flag once (${usage})`,
        );
      }

      let value: string;

      if (equals >= 0) {
        value = word.slice(equals + 1);
      } else {
        const next: string | undefined = words[i + 1];

        // Never take a flag-looking word as a value: it would skip that flag's check.
        if (next === undefined || next.startsWith("-")) {
          return refuse(
            `--${flag.name} needs a value${
              next === undefined
                ? ""
                : `, but the next word is ${quoteCloudWord(next)}`
            } (${usage})`,
          );
        }

        value = next;
        i++;
      }

      if (value === "") {
        return refuse(`--${flag.name} needs a value (${usage})`);
      }

      const problem: string | null = describeValueProblem(
        flag,
        value,
        `--${flag.name}`,
      );

      if (problem) {
        return refuse(problem);
      }

      rawFlags.push({ flag, value });
      continue;
    }

    // A positional word: the operation's one resource.
    if (!operation.takesResource) {
      return refuse(
        `cloud ${operation.name} takes no resource (got ${quoteCloudWord(word)}; ${usage})`,
      );
    }

    if (resourceWord !== null) {
      return refuse(
        `each cloud command names exactly one resource, but got ${quoteCloudWord(resourceWord)} and ${quoteCloudWord(word)} (${usage})`,
      );
    }

    resourceWord = word;
  }

  let resource: ParsedCloudResource | null = null;

  if (operation.takesResource) {
    if (resourceWord === null) {
      return refuse(
        `cloud ${operation.name} needs the resource's ${CLOUD_RESOURCE_ID_NAMES[provider]}, as the account's inventory lists it (${usage})`,
      );
    }

    const parsed: CloudResourceParse = parseCloudResourceId(
      provider,
      resourceWord,
    );

    if (!parsed.ok) {
      return refuse(`${parsed.errorMessage} (${usage})`);
    }

    resource = parsed.resource;
  }

  const kindSpec: CloudOperationKindSpec | null = getCloudOperationKind(
    operation,
    provider,
    resource ? resource.kind : null,
  );

  if (!kindSpec) {
    const known: CloudResourceKindSpec | null = resource
      ? getCloudResourceKind(provider, resource.kind)
      : null;

    return refuse(
      `cloud ${operation.name} is not available for ${
        known ? `a ${known.displayName}` : "this resource"
      }: on ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} it works on ${joinWords(
        describeCloudOperationKinds(operation, provider),
        "and",
      )}`,
    );
  }

  const kind: string | null = resource ? resource.kind : null;
  const flags: Record<string, CloudParamValue> = {};

  for (const given of rawFlags) {
    if (!appliesToKind(given.flag, kind)) {
      const known: CloudResourceKindSpec | null = getCloudResourceKind(
        provider,
        kind,
      );

      return refuse(
        `--${given.flag.name} does not apply to ${
          known ? `a ${known.displayName}` : "this resource"
        } (${usage})`,
      );
    }

    flags[given.flag.name] = toParamValue(given.flag, given.value);
  }

  for (const flag of operation.flags) {
    if (
      flag.required &&
      appliesToKind(flag, kind) &&
      !Object.prototype.hasOwnProperty.call(flags, flag.name)
    ) {
      return refuse(
        `cloud ${operation.name} needs --${flag.name} ${flag.valueLabel}: ${flag.description} (usage: ${describeCloudOperationUsage(operation, kind)})`,
      );
    }
  }

  const canonicalArgs: Array<string> = [operation.name];

  if (resource) {
    canonicalArgs.push(resource.id);
  }

  for (const flag of operation.flags) {
    if (Object.prototype.hasOwnProperty.call(flags, flag.name)) {
      canonicalArgs.push(`--${flag.name}`, String(flags[flag.name]));
    }
  }

  return {
    ok: true,
    command: {
      operation,
      provider,
      resource,
      kindSpec,
      flags,
      canonicalArgs,
    },
  };
}

/*
 * `cloud dry-run <change> RESOURCE [--flag value]...`: the change after
 * "dry-run" read by the same grammar (so it is refused for every reason
 * the change would be), then wrapped as CLOUD_DRY_RUN_OPERATION, a Read
 * whose canonical argv is "dry-run" and the change's own.
 */
function parseCloudDryRun(
  provider: CloudCatalogProvider,
  words: Array<string>,
): CloudCommandParse {
  const changeWord: string | undefined = words[2];
  const usage: string = `"${CLOUD_PROGRAM} ${CLOUD_DRY_RUN_OPERATION_NAME} <change> RESOURCE [--flag value]", the change exactly as it would run`;

  if (changeWord === undefined || changeWord === "") {
    return refuse(
      `name the change to check: ${usage}; the changes on ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} are ${CLOUD_OPERATIONS.filter(
        (operation: CloudOperationSpec): boolean => {
          return (
            isCloudChangeOperation(operation) &&
            isCloudOperationAvailable(operation, provider)
          );
        },
      )
        .map((operation: CloudOperationSpec): string => {
          return operation.name;
        })
        .join(", ")}`,
    );
  }

  if (changeWord === CLOUD_DRY_RUN_OPERATION_NAME) {
    return refuse(
      `a dry run checks one change, never another dry run: ${usage}`,
    );
  }

  if (changeWord.startsWith("-")) {
    return refuse(
      `the change comes right after "${CLOUD_DRY_RUN_OPERATION_NAME}", before any flag (got ${quoteCloudWord(changeWord)}): ${usage}`,
    );
  }

  const change: CloudCommandParse = parseCloudCommand(provider, [
    CLOUD_PROGRAM,
    ...words.slice(2),
  ]);

  if (!change.ok) {
    return refuse(`the dry run's change is refused: ${change.errorMessage}`);
  }

  const changed: ParsedCloudCommand = change.command;

  if (!isCloudChangeOperation(changed.operation) || !changed.resource) {
    return refuse(
      `cloud ${changed.operation.name} changes nothing, so it has nothing to dry-run: run it as it is`,
    );
  }

  return {
    ok: true,
    command: {
      operation: CLOUD_DRY_RUN_OPERATION,
      provider,
      resource: changed.resource,
      kindSpec: {
        provider,
        kind: changed.kindSpec.kind,
        tier: ResourceCommandTier.Read,
        requiresHuman: false,
        apiCall: `no call that changes anything: the agent stops before ${changed.kindSpec.apiCall}`,
        permissions: changed.kindSpec.permissions,
      },
      flags: { ...changed.flags },
      canonicalArgs: [CLOUD_DRY_RUN_OPERATION_NAME, ...changed.canonicalArgs],
      dryRunOf: changed,
    },
  };
}

// An Integer flag's value, or its default when it was not given.
export function getCloudIntegerFlag(
  command: ParsedCloudCommand,
  name: string,
): number | null {
  const value: CloudParamValue | undefined = command.flags[name];

  if (typeof value === "number") {
    return value;
  }

  const spec: CloudParamSpec | undefined = command.operation.flags.find(
    (flag: CloudParamSpec): boolean => {
      return flag.name === name;
    },
  );

  return spec && spec.defaultValue !== undefined ? spec.defaultValue : null;
}

// ---- What a change replaced, and how it is undone -----------------------------

/*
 * The line the agent starts a change's output with: the value the change
 * replaced, as a JSON object of strings ({"count":"2"}, {"version":
 * "web:41"}). The server reads it back to build the change's undo with the
 * catalog's inverse. Only the FIRST line is read: the stored output keeps
 * its head, and no later line (which may quote what the cloud answered)
 * can stand in for it.
 */
export const CLOUD_REPLACED_VALUE_PREFIX: string = "oneuptime-replaced-value: ";

// The keys a replaced value may carry, and how each one's value is checked.
const REPLACED_VALUE_PATTERNS: Readonly<Record<string, RegExp>> = {
  count: /^(?:0|[1-9][0-9]{0,8})$/,
  version: VERSION_REGEX,
  value: /^(?:none|[1-9][0-9]{0,8})$/,
  state: /^[a-z][a-z-]{0,31}$/,
  primary: /^[A-Za-z0-9._:/-]{1,255}$/,
};

// The replaced-value line for these values (the agent writes it).
export function formatCloudReplacedValue(
  values: Record<string, string>,
): string {
  const clean: Record<string, string> = {};

  for (const key of Object.keys(values).sort()) {
    const pattern: RegExp | undefined = REPLACED_VALUE_PATTERNS[key];
    const value: string | undefined = values[key];

    if (pattern && typeof value === "string" && pattern.test(value)) {
      clean[key] = value;
    }
  }

  return `${CLOUD_REPLACED_VALUE_PREFIX}${JSON.stringify(clean)}`;
}

// The longest output line read as a replaced value.
const MAX_REPLACED_VALUE_LINE_LENGTH: number = 2048;

/*
 * The replaced value a change's output reports: its first line, when that
 * is a replaced-value line, keeping only known keys whose values have their
 * pattern. {} when there is none or it cannot be read. Scans with indexOf,
 * never a regex over the whole output (outputs can be a megabyte).
 */
export function readCloudReplacedValue(
  output: unknown,
): Record<string, string> {
  if (
    typeof output !== "string" ||
    !output.startsWith(CLOUD_REPLACED_VALUE_PREFIX)
  ) {
    return {};
  }

  const end: number = output.indexOf("\n");
  const line: string = output
    .slice(CLOUD_REPLACED_VALUE_PREFIX.length, end < 0 ? output.length : end)
    .trimEnd();

  if (line.length > MAX_REPLACED_VALUE_LINE_LENGTH) {
    return {};
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return {};
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }

  const values: Record<string, string> = {};

  for (const key of Object.keys(parsed as Record<string, unknown>)) {
    const pattern: RegExp | undefined = REPLACED_VALUE_PATTERNS[key];
    const value: unknown = (parsed as Record<string, unknown>)[key];

    if (pattern && typeof value === "string" && pattern.test(value)) {
      values[key] = value;
    }
  }

  return values;
}

/*
 * The line a dry run's output starts with: its verdict. would-run when the
 * agent found nothing that would stop the change (the replaced-value line
 * follows it), would-be-refused when something would (the reason follows).
 * Only the FIRST line is read, as for the replaced value.
 */
export const CLOUD_DRY_RUN_PREFIX: string = "oneuptime-dry-run: ";

export type CloudDryRunVerdict = "would-run" | "would-be-refused";

const CLOUD_DRY_RUN_VERDICTS: ReadonlyArray<CloudDryRunVerdict> = [
  "would-run",
  "would-be-refused",
];

// The verdict line (the agent writes it).
export function formatCloudDryRunVerdict(verdict: CloudDryRunVerdict): string {
  return `${CLOUD_DRY_RUN_PREFIX}${JSON.stringify({ verdict })}`;
}

/*
 * A dry run's verdict, from its output's first line; null when the output
 * is not a dry run's or cannot be read. Reads with indexOf, never a regex
 * over the output.
 */
export function readCloudDryRunVerdict(
  output: unknown,
): CloudDryRunVerdict | null {
  if (typeof output !== "string" || !output.startsWith(CLOUD_DRY_RUN_PREFIX)) {
    return null;
  }

  const end: number = output.indexOf("\n");
  const line: string = output
    .slice(CLOUD_DRY_RUN_PREFIX.length, end < 0 ? output.length : end)
    .trimEnd();

  if (line.length > MAX_REPLACED_VALUE_LINE_LENGTH) {
    return null;
  }

  let parsed: unknown;

  try {
    parsed = JSON.parse(line);
  } catch {
    return null;
  }

  const verdict: unknown =
    parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)["verdict"]
      : undefined;

  return CLOUD_DRY_RUN_VERDICTS.includes(verdict as CloudDryRunVerdict)
    ? (verdict as CloudDryRunVerdict)
    : null;
}

/*
 * The output of a dry run without its verdict line: what is left starts
 * with the replaced-value line when the change would run.
 */
export function withoutCloudDryRunVerdict(output: string): string {
  if (!output.startsWith(CLOUD_DRY_RUN_PREFIX)) {
    return output;
  }

  const end: number = output.indexOf("\n");

  return end < 0 ? "" : output.slice(end + 1);
}

export type CloudUndoResult =
  // The argv (program included) that puts the resource back.
  | { kind: "command"; argv: Array<string> }
  // The change has nothing to undo (a restart, a reboot).
  | { kind: "nothing"; reason: string }
  // It could be undone, but the output did not report what it replaced.
  | { kind: "unknown"; reason: string };

/*
 * The command that undoes a change, from the catalog's inverse and the
 * value the change's output reported it replaced. The result is a cloud
 * argv the policy reads like any other (it re-checks tier and bounds); a
 * change whose replaced value is missing cannot be undone exactly, which is
 * said rather than guessed.
 */
export function getCloudUndoCommand(data: {
  command: ParsedCloudCommand;
  replaced: Record<string, string>;
}): CloudUndoResult {
  const operation: CloudOperationSpec = data.command.operation;

  if (!isCloudChangeOperation(operation)) {
    return {
      kind: "nothing",
      reason: `cloud ${operation.name} changes nothing`,
    };
  }

  const undo: CloudUndoSpec | null = operation.undo;

  if (!undo || !data.command.resource) {
    return {
      kind: "nothing",
      reason: `cloud ${operation.name}: ${operation.undoNote || "nothing to undo"}`,
    };
  }

  // An inverse that does not work on this kind (an RDS instance is started here, never stopped).
  const inverse: CloudOperationSpec | null = getCloudOperation(undo.operation);

  if (
    !inverse ||
    !getCloudOperationKind(
      inverse,
      data.command.provider,
      data.command.resource.kind,
    )
  ) {
    const known: CloudResourceKindSpec | null = getCloudResourceKind(
      data.command.provider,
      data.command.resource.kind,
    );

    return {
      kind: "nothing",
      reason: `cloud ${undo.operation} does not work on ${
        known ? `a ${known.displayName}` : "this resource"
      }, so cloud ${operation.name} has nothing to undo here: a person puts it back`,
    };
  }

  const argv: Array<string> = [
    CLOUD_PROGRAM,
    undo.operation,
    data.command.resource.id,
  ];

  if (undo.valueFlag && undo.valueKey) {
    const value: string | undefined = data.replaced[undo.valueKey];

    if (value === undefined) {
      // roll-back-service on a slot swap needs no version: the same swap undoes it.
      if (
        !(
          operation.name === "roll-back-service" &&
          data.command.resource.kind === "app-service"
        )
      ) {
        return {
          kind: "unknown",
          reason: `cloud ${operation.name} did not report the ${undo.valueKey} it replaced, so it cannot be undone exactly`,
        };
      }
    } else {
      argv.push(`--${undo.valueFlag}`, value);
    }
  }

  for (const name of undo.keepFlags) {
    const value: CloudParamValue | undefined = data.command.flags[name];

    if (value !== undefined) {
      argv.push(`--${name}`, String(value));
    }
  }

  // The policy's canonical order, so the undo reads like any other command.
  const reparsed: CloudCommandParse = parseCloudCommand(
    data.command.provider,
    argv,
  );

  if (!reparsed.ok) {
    return {
      kind: "unknown",
      reason: `the undo of cloud ${operation.name} could not be written: ${reparsed.errorMessage}`,
    };
  }

  return {
    kind: "command",
    argv: [CLOUD_PROGRAM, ...reparsed.command.canonicalArgs],
  };
}

// ---- Guides -------------------------------------------------------------------

function operationBullet(
  operation: CloudOperationSpec,
  provider: CloudCatalogProvider,
): string {
  const kinds: Array<string> = describeCloudOperationKinds(operation, provider);

  return `- \`${describeCloudOperationUsage(operation)}\`: ${operation.summary}${
    kinds.length > 0 ? ` (${joinWords(kinds, "and")})` : ""
  }.`;
}

/*
 * The read cheat-sheet for the investigation tool, for one cloud: compact
 * markdown bullets.
 */
export function getCloudReadCommandGuide(
  provider: CloudCatalogProvider,
): string {
  return [
    `- \`cloud\` runs one operation from a fixed catalog on this ${CLOUD_CATALOG_PROVIDER_NAMES[provider]} account — never an aws, az or gcloud command: \`cloud <operation> RESOURCE [--flag value]\`, long flags only, each flag once. RESOURCE is one resource's ${CLOUD_RESOURCE_ID_NAMES[provider]}, exactly as the account's inventory lists it (query_cloud_resource finds it).`,
    ...CLOUD_OPERATIONS.filter((operation: CloudOperationSpec): boolean => {
      return (
        !isCloudChangeOperation(operation) &&
        isCloudOperationAvailable(operation, provider)
      );
    }).map((operation: CloudOperationSpec): string => {
      return operationBullet(operation, provider);
    }),
    "- The reads run on OneUptime through the account's read-only connection and are live; whoami asks the Cloud AI agent.",
    `- \`cloud ${CLOUD_DRY_RUN_OPERATION_NAME} <change> RESOURCE [--flag value]\`: ${CLOUD_DRY_RUN_OPERATION.summary}. It asks the Cloud AI agent and changes nothing: it says whether the change would run, the value it would replace and how it would be undone.`,
  ].join("\n");
}

/*
 * The write cheat-sheet for the remediation tools, for one cloud: every
 * change, the kinds it works on with their tiers, how it is undone, and
 * what never changes.
 */
export function getCloudWriteCommandGuide(
  provider: CloudCatalogProvider,
): string {
  const lines: Array<string> = [];

  for (const operation of CLOUD_OPERATIONS) {
    if (!isCloudChangeOperation(operation)) {
      continue;
    }

    const kinds: Array<string> = [];

    for (const spec of operation.kinds) {
      if (spec.provider !== provider) {
        continue;
      }

      const known: CloudResourceKindSpec | null = getCloudResourceKind(
        provider,
        spec.kind,
      );
      const tier: string = spec.requiresHuman
        ? "always needs a person"
        : spec.tier === ResourceCommandTier.SafeWrite
          ? "safe"
          : "riskier";

      kinds.push(`${known ? known.displayName : spec.kind}: ${tier}`);
    }

    if (kinds.length === 0) {
      continue;
    }

    const undo: string = operation.undo
      ? `undone with cloud ${operation.undo.operation}${
          operation.undo.valueFlag
            ? ` --${operation.undo.valueFlag} <the replaced value>`
            : ""
        }`
      : operation.undoNote;

    lines.push(
      `- \`${describeCloudOperationUsage(operation)}\`: ${operation.summary} (${kinds.join("; ")}; ${undo}).`,
    );
  }

  lines.push(
    "- Each change names exactly one resource the account's inventory lists. The agent reads the value it replaces first and reports it, so a failed fix rolls back exactly.",
    `- Before you propose or make a change, check it with \`cloud ${CLOUD_DRY_RUN_OPERATION_NAME} <change> RESOURCE [--flag value]\`, a read that changes nothing: the agent says whether it would run, the value it would replace and how it would be undone.`,
    "- Never, even with approval: deleting or terminating anything, IAM, security groups and firewall rules, secrets and keys, storage and database contents, instance types, snapshots and restores, purging a queue, a group's minimum or maximum, and anything not listed here.",
  );

  return lines.join("\n");
}
