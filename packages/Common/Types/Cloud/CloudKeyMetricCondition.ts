import { translationKey } from "../Translator";

/*
 * WHEN A RESOURCE REPORTS ONE OF ITS TYPE'S KEY METRICS.
 *
 * Most key metrics come from every resource of their type. Some only from
 * the resources a condition holds for, and a resource's Metrics card lists
 * the key metrics it did not report under their sections
 * (CloudUnreportedKeyMetrics), with the condition as the likely reason:
 * so a person can tell a metric that does not apply ("Only a replica
 * reports it") from one OneUptime is not reading.
 *
 * A condition is filed on the key metric (AwsKeyMetric.onlyWhen,
 * AzureKeyMetric.onlyWhen, GcpKeyMetric.onlyWhen), from what its
 * provider's reference says of it.
 */
export enum CloudKeyMetricCondition {
  // CPU credits: a T instance, a B-series VM, a burstable database server.
  Burstable = "burstable",
  // How far behind a replica is.
  Replica = "replica",
  /*
   * CloudWatch publishes it for a period only when it is not zero: a load
   * balancer's 5xx count, a reset or a rejected connection. No data is
   * none happening, not a gap.
   */
  NonZero = "non-zero",
  /*
   * Only some kinds of the resource publish it: a RabbitMQ or an ActiveMQ
   * broker's own, an HTTP API's or a REST API's errors, a function app's
   * executions, a cluster's own and not its services'.
   */
  Kind = "kind",
  /*
   * Only some tiers, SKUs or storage types publish it: a DTU database's
   * DTUs, a gp2 volume's burst balance, a provisioned table's capacity.
   */
  Tier = "tier",
  /*
   * Published once what it measures is set up: an App Service app's
   * health check, a dead-letter queue, a stream as a function's source,
   * an Auto Scaling group's metrics collection.
   */
  Setup = "setup",
}

/*
 * Each condition as the likely reason a resource did not report the
 * metric, in English: keys of the Dashboard's locale files.
 */
export const CLOUD_KEY_METRIC_CONDITION_REASONS: Readonly<
  Record<CloudKeyMetricCondition, string>
> = {
  [CloudKeyMetricCondition.Burstable]: translationKey(
    "Only a burstable instance or VM reports it.",
  ),
  [CloudKeyMetricCondition.Replica]: translationKey(
    "Only a replica reports it.",
  ),
  [CloudKeyMetricCondition.NonZero]: translationKey(
    "Its cloud reports it only when it is not zero, so no data means none happened.",
  ),
  [CloudKeyMetricCondition.Kind]: translationKey(
    "Only some kinds of this resource report it.",
  ),
  [CloudKeyMetricCondition.Tier]: translationKey(
    "Only some tiers, SKUs or storage types report it.",
  ),
  [CloudKeyMetricCondition.Setup]: translationKey(
    "It is reported once what it measures is set up.",
  ),
};

export function isCloudKeyMetricCondition(
  value: unknown,
): value is CloudKeyMetricCondition {
  return (
    typeof value === "string" &&
    (Object.values(CloudKeyMetricCondition) as Array<string>).includes(value)
  );
}
