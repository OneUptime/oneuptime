/*
 * Container stats receivers that send a PERCENT under the unit "1".
 *
 * UCUM's "1" is a dimensionless number, and OpenTelemetry uses it for a 0-1
 * fraction: OneUptime reads it that way wherever a unit decides how a number
 * is drawn or compared - a chart or the metrics explorer shows 0.25 as
 * "25.00%" (ValueFormatter.isFractionMetric), a chart in "%" or a "%"
 * threshold multiplies it by 100 (MetricResultUnitConverter, MetricUnitUtil).
 *
 * The OpenTelemetry collector's docker_stats receiver (which the Docker,
 * Podman and Docker Swarm agents run) and its podman_stats receiver send
 * these metrics as a percent - 0 to 100, CPU over 100 on several cores - but
 * declare "1". Read as fractions, every one of them showed 100 times too
 * much: a container using 4.36% of its memory limit read 436.64%. The values
 * are right, the unit is not, so ingest records the unit their numbers are
 * in: "%". The agents now send "%" themselves (agents/DockerAgent/
 * otel-collector-config.yaml, transform/percent-units); this is for every
 * agent still in the field, and for anyone running these receivers in their
 * own collector.
 *
 * Only these receivers, told apart by their instrumentation scope - the
 * receiver's Go module path, which every collector release since 2024 sends
 * ("otelcol/<receiver>" before). The same metric name can mean something else
 * from another producer: OneUptime's Kubernetes agent sends
 * container.cpu.utilization as CPU cores, unit "1" (kubeletstats), and that
 * one is left alone.
 */

export const DOCKER_STATS_RECEIVER_SCOPE_NAME: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/dockerstatsreceiver";

export const PODMAN_STATS_RECEIVER_SCOPE_NAME: string =
  "github.com/open-telemetry/opentelemetry-collector-contrib/receiver/podmanreceiver";

// What older collectors called the same two receivers.
const LEGACY_DOCKER_STATS_RECEIVER_SCOPE_NAME: string =
  "otelcol/dockerstatsreceiver";
const LEGACY_PODMAN_STATS_RECEIVER_SCOPE_NAME: string =
  "otelcol/podmanreceiver";

export const CONTAINER_CPU_UTILIZATION_METRIC: string =
  "container.cpu.utilization";
export const CONTAINER_MEMORY_PERCENT_METRIC: string =
  "container.memory.percent";
// podman_stats' name for its CPU percent.
export const CONTAINER_CPU_PERCENT_METRIC: string = "container.cpu.percent";

const DOCKER_STATS_PERCENT_METRICS: ReadonlySet<string> = new Set<string>([
  CONTAINER_CPU_UTILIZATION_METRIC,
  CONTAINER_MEMORY_PERCENT_METRIC,
]);

const PODMAN_STATS_PERCENT_METRICS: ReadonlySet<string> = new Set<string>([
  CONTAINER_CPU_PERCENT_METRIC,
  CONTAINER_MEMORY_PERCENT_METRIC,
]);

const PERCENT_METRICS_BY_SCOPE_NAME: ReadonlyMap<
  string,
  ReadonlySet<string>
> = new Map<string, ReadonlySet<string>>([
  [DOCKER_STATS_RECEIVER_SCOPE_NAME, DOCKER_STATS_PERCENT_METRICS],
  [LEGACY_DOCKER_STATS_RECEIVER_SCOPE_NAME, DOCKER_STATS_PERCENT_METRICS],
  [PODMAN_STATS_RECEIVER_SCOPE_NAME, PODMAN_STATS_PERCENT_METRICS],
  [LEGACY_PODMAN_STATS_RECEIVER_SCOPE_NAME, PODMAN_STATS_PERCENT_METRICS],
]);

/*
 * Every metric name above: whatever producer sends one of them, a stored
 * "%" for it was set by a container stats receiver (see
 * keepsStoredPercentUnit).
 */
export const CONTAINER_STATS_PERCENT_METRIC_NAMES: ReadonlySet<string> =
  new Set<string>([
    ...DOCKER_STATS_PERCENT_METRICS,
    ...PODMAN_STATS_PERCENT_METRICS,
  ]);

const PERCENT_UNIT: string = "%";
const FRACTION_UNIT: string = "1";

export default class ContainerStatsPercentUnit {
  /**
   * The unit a metric's values are in, given the unit its producer declared:
   * "%" for a container stats receiver's percent declared "1", the declared
   * unit (as declared) for everything else.
   *
   * `metricName` is matched as OneUptime stores it, lowercased.
   */
  public static getStoredUnit(input: {
    scopeName: string | undefined;
    metricName: string;
    declaredUnit: string | undefined;
  }): string | undefined {
    if (!ContainerStatsPercentUnit.isPercentDeclaredAsFraction(input)) {
      return input.declaredUnit;
    }
    return PERCENT_UNIT;
  }

  /**
   * Whether this metric is one of a container stats receiver's percents,
   * sent with the fraction unit "1".
   */
  public static isPercentDeclaredAsFraction(input: {
    scopeName: string | undefined;
    metricName: string;
    declaredUnit: string | undefined;
  }): boolean {
    if ((input.declaredUnit || "").trim() !== FRACTION_UNIT) {
      return false;
    }

    const percentMetrics: ReadonlySet<string> | undefined =
      PERCENT_METRICS_BY_SCOPE_NAME.get((input.scopeName || "").trim());

    return Boolean(percentMetrics?.has(input.metricName.trim().toLowerCase()));
  }

  /**
   * Whether the metric catalog keeps a stored "%" when a batch declares "1"
   * for the same metric name.
   *
   * OneUptime keeps one unit per metric name and project. A project running
   * OneUptime's Kubernetes agent AND a Docker or Podman agent gets
   * container.cpu.utilization from both: CPU cores declared "1" from
   * Kubernetes, a percent of one core declared "%" from Docker. Taking each
   * batch's unit would flip the stored unit, and every chart of the metric,
   * between the two every few seconds - with a database write each time. So a
   * "%" a container stats receiver set stays: the Docker and Podman
   * containers read right, and the Kubernetes pages, which compute their own
   * CPU percent from the cores, are not affected (in the metrics explorer a
   * Kubernetes series of that name then reads in cores, unscaled - one name
   * cannot carry both units). Any other unit change goes through as before.
   */
  public static keepsStoredPercentUnit(input: {
    metricName: string;
    storedUnit: string | undefined;
    incomingUnit: string | undefined;
  }): boolean {
    return (
      CONTAINER_STATS_PERCENT_METRIC_NAMES.has(
        input.metricName.trim().toLowerCase(),
      ) &&
      (input.storedUnit || "").trim() === PERCENT_UNIT &&
      (input.incomingUnit || "").trim() === FRACTION_UNIT
    );
  }
}
