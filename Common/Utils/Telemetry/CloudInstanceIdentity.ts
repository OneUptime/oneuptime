/*
 * Which resource attribute names one running task / instance / replica of a
 * managed cloud compute environment.
 *
 * The chain is ordered platform identity first, then OpenTelemetry's own
 * `service.instance.id`, then the generic fallbacks:
 *
 *   - The platform's task / instance id (ECS task, Cloud Run instance,
 *     Container Apps replica) is what the platform's resource detector
 *     stamps on BOTH the application's telemetry and a sidecar collector's
 *     container metrics, and it survives process restarts. Keying on it
 *     puts the app's spans and the sidecar's CPU / memory points on one
 *     row.
 *   - `service.instance.id` is usually minted by the SDK as a random id per
 *     process (the Node SDK's default `serviceinstance` detector does
 *     exactly that). If it came first, an ECS task would split into two
 *     rows — one under the SDK's uuid, one under the task id the
 *     awsecscontainermetrics receiver reports — and the live-instance count
 *     would double. It is used when the platform sets no identity of its
 *     own, which is the case on App Runner, App Service, Beanstalk and
 *     Container Instances.
 *   - `container.id`, `host.id` and `host.name` catch everything else; on a
 *     managed platform the container hostname is normally the instance name
 *     (Container Apps sets it to the replica name).
 *
 * Before this chain existed only `service.instance.id` was read, so the
 * Instances tab of every ECS environment stayed empty and the CPU / memory
 * tiles never filled in: the ECS detector never sets it.
 *
 * Both ingest paths use it — the resource-attribute walk in
 * OtelIngestBaseService (keys as sent) and the metric snapshot fold in
 * OtelMetricsIngestService (keys prefixed with `resource.`) — via the
 * caller-supplied getter, so the two can never disagree about what an
 * instance is. The dashboard's Instances tab reads the same constant for
 * its copy, and the docs hub is tested against it.
 */

export const CLOUD_INSTANCE_IDENTITY_ATTRIBUTES: ReadonlyArray<string> = [
  "aws.ecs.task.id",
  "aws.ecs.task.arn",
  "faas.instance",
  "azure.container_app.instance.id",
  "service.instance.id",
  "container.id",
  "host.id",
  "host.name",
];

/*
 * `arn:aws:ecs:us-east-1:123456789012:task/my-cluster/1a2b3c4d5e6f` → the
 * task id, which is what the ECS console shows and what fits in a table
 * column. Anything that is not an ARN is returned untouched.
 */
export function shortenEcsTaskArn(value: string): string {
  const trimmed: string = value.trim();
  if (!trimmed.startsWith("arn:")) {
    return trimmed;
  }
  const slash: number = trimmed.lastIndexOf("/");
  if (slash < 0 || slash === trimmed.length - 1) {
    return trimmed;
  }
  return trimmed.slice(slash + 1);
}

export type CloudInstanceAttributeGetter = (key: string) => string | null;

/*
 * Resolve the instance name for a cloud environment from whichever identity
 * attribute the resource carries first. `getAttribute` receives the bare
 * semconv key; callers that store attributes under a prefix add it
 * themselves. Returns null when none of the attributes is present, in which
 * case no instance row is written — an environment with no instance identity
 * is still a valid environment.
 */
export function resolveCloudInstanceName(
  getAttribute: CloudInstanceAttributeGetter,
): string | null {
  for (const key of CLOUD_INSTANCE_IDENTITY_ATTRIBUTES) {
    const raw: string | null = getAttribute(key);
    if (!raw) {
      continue;
    }
    const value: string = raw.trim();
    if (!value) {
      continue;
    }
    if (key === "aws.ecs.task.arn") {
      return shortenEcsTaskArn(value);
    }
    return value;
  }
  return null;
}
