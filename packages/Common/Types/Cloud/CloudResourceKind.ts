/*
 * The two kinds of row the CloudResource table holds - the Cloud product's
 * two lists.
 *
 *   - An ENVIRONMENT is where managed containers run: one per
 *     cloud.platform + cloud.account.id + cloud.region, created by ingest
 *     from the resource attributes an OpenTelemetry resource detector
 *     stamps on a workload's own telemetry (ECS, Cloud Run, Container Apps,
 *     ...). See CloudPlatform.
 *   - A RESOURCE is one IaaS or PaaS resource a cloud provider runs for
 *     you - a virtual machine, a load balancer, a bucket, a database, a
 *     queue - created by ingest from the metrics the provider's monitoring
 *     API publishes about it (Azure Monitor, CloudWatch, Cloud Monitoring),
 *     read by an OpenTelemetry Collector. See CloudMonitoredResource.
 *
 * Both share the product's owners, labels, label and owner rules, archive
 * and permissions. They differ in identity (an environment key, a provider
 * resource id), in what their telemetry is (every signal a workload sends,
 * the provider's metrics about one resource) and so in their pages.
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
