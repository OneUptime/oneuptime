import BadDataException from "../Exception/BadDataException";

/*
 * The two kinds of row the CloudResource table holds - and since Cloud and
 * App Platforms became two products, which product each kind is in.
 *
 *   - An ENVIRONMENT is where managed containers and apps run: one per
 *     cloud.platform + cloud.account.id + cloud.region, created by ingest
 *     from the resource attributes an OpenTelemetry resource detector
 *     stamps on a workload's own telemetry (ECS, Cloud Run, Container Apps,
 *     ...). See CloudPlatform. Environments are App Platforms'.
 *   - A RESOURCE is one IaaS or PaaS resource a cloud provider runs for
 *     you - a virtual machine, a load balancer, a bucket, a database, a
 *     queue - created by ingest from the metrics the provider's monitoring
 *     API publishes about it (Azure Monitor, CloudWatch, Cloud Monitoring),
 *     read by an OpenTelemetry Collector or by a cloud connection. See
 *     CloudMonitoredResource. Resources are Cloud's.
 *
 * Both share the table's owners, labels, feed, archive and permissions.
 * They differ in identity (an environment key, a provider resource id), in
 * what their telemetry is (every signal a workload sends, the provider's
 * metrics about one resource) and so in their pages, each in its own
 * product (Dashboard Utils/CloudResourceViewPages). Owner and label rules
 * name the kind they are for (doesCloudRuleApplyToKind).
 *
 * Rows written before resources existed are environments: the column
 * defaults to it, and a person can only ever create an environment.
 */
export enum CloudResourceKind {
  Environment = "environment",
  Resource = "resource",
}

export const CLOUD_RESOURCE_KIND_LABELS: Readonly<
  Record<CloudResourceKind, string>
> = {
  [CloudResourceKind.Environment]: "Environment",
  [CloudResourceKind.Resource]: "Resource",
};

/*
 * Whether a row is a cloud resource discovered from cloud monitoring. Read
 * strictly: a row without the column (selected without it, or written
 * before it existed) is an environment.
 */
export function isCloudResourceKindResource(
  kind: string | null | undefined,
): boolean {
  return kind === CloudResourceKind.Resource;
}

// Whether a value is one of the two kinds, spelled exactly as stored.
export function isCloudResourceKind(
  value: unknown,
): value is CloudResourceKind {
  return (
    value === CloudResourceKind.Environment ||
    value === CloudResourceKind.Resource
  );
}

/*
 * Whether a cloud owner or label rule is for a row. A rule names the kind
 * it is for - the product it was written in: App Platforms' rules are for
 * environments, Cloud's for resources. A rule written before the two
 * products split names neither, and keeps matching every row, as it always
 * did. A row is read as isCloudResourceKindResource reads it.
 */
export function doesCloudRuleApplyToKind(data: {
  ruleKind: string | null | undefined;
  rowKind: string | null | undefined;
}): boolean {
  if (!data.ruleKind) {
    return true;
  }

  const rowKind: CloudResourceKind = isCloudResourceKindResource(data.rowKind)
    ? CloudResourceKind.Resource
    : CloudResourceKind.Environment;

  return data.ruleKind === rowKind;
}

/*
 * Where a row's page is in the Dashboard, after its project id: an
 * environment's in App Platforms (app-platforms/:id), a resource's in Cloud
 * (cloud/:id). A link whose writer cannot tell - a notification that names
 * the rows an incident is linked to, without reading their kind - goes to
 * Cloud's page, which forwards an environment to App Platforms, as it does
 * every link written before the two products split.
 */
export function getCloudResourceDashboardPath(data: {
  cloudResourceId: string;
  cloudResourceKind?: string | null | undefined;
}): string {
  if (
    data.cloudResourceKind !== undefined &&
    !isCloudResourceKindResource(data.cloudResourceKind)
  ) {
    return `app-platforms/${data.cloudResourceId}`;
  }

  return `cloud/${data.cloudResourceId}`;
}

// What a feed entry calls a row: "Cloud Environment" or "Cloud Resource".
export function getCloudResourceKindNoun(
  kind: string | null | undefined,
): string {
  return isCloudResourceKindResource(kind)
    ? "Cloud Resource"
    : "Cloud Environment";
}

/*
 * The kind an owner or label rule may be written for: one of the two, or
 * none (a rule for both). Anything else would be a rule that matches no
 * row and that neither product's rules page lists, so the rule services
 * refuse it (CloudResourceOwnerRuleService, CloudResourceLabelRuleService),
 * whoever writes it: the Dashboard, the API, Terraform or a workflow.
 */
export function assertCloudRuleKind(value: unknown): void {
  if (value === undefined || value === null || value === "") {
    return;
  }

  if (!isCloudResourceKind(value)) {
    throw new BadDataException(
      `A cloud rule applies to "${CloudResourceKind.Environment}" (App Platforms' environments), "${CloudResourceKind.Resource}" (Cloud's resources) or, left empty, both.`,
    );
  }
}
