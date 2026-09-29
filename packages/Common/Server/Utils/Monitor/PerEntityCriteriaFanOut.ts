import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import { BasicDiskMetrics } from "../../../Types/Infrastructure/BasicMetrics";
import MetricSeriesFingerprint from "../../../Utils/Metrics/MetricSeriesFingerprint";
import { PerSeriesCriteriaMatch } from "../../../Types/Probe/ProbeApiIngestResponse";
import DataToProcess from "./DataToProcess";
import logger from "../Logger";

/**
 * The value a user types into "Disk Path" or "Interface Name" to mean
 * "every one of them, and raise a separate alert for each".
 *
 * Metric-backed monitors express the same idea with a Group By
 * attribute. The non-metric monitor types have no group-by concept —
 * their criteria name ONE entity — so this is how they opt in. Leaving
 * the field at its existing value keeps today's behaviour exactly: one
 * alert for the whole monitor, naming whichever entity the criteria was
 * pinned to.
 */
export const AllEntitiesWildcard: string = "*";

/**
 * A hard ceiling on how many entities one criteria may fan out to.
 *
 * Each entity is a full criteria re-evaluation, and an
 * "evaluate over time" filter makes each of those a query. A switch
 * with hundreds of ports would otherwise turn one monitor tick into
 * hundreds of round trips and hundreds of alerts. Truncation is logged
 * rather than silent — a monitor that quietly covers only part of its
 * fleet reads exactly like one that covers all of it.
 */
export const MaxEntitiesPerCriteria: number = 100;

/**
 * One entity a criteria can be narrowed down to — a mountpoint, a
 * network interface — together with the labels that identify it on the
 * alert it raises.
 */
export interface FanOutEntity {
  /**
   * Identity of this entity, stored on the alert/incident as
   * seriesLabels and hashed into its seriesFingerprint. Also reachable
   * from the alert title template.
   */
  labels: JSONObject;
  /**
   * Rewrite one criteria filter so it names this entity and nothing
   * else. Filters that do not address an entity are returned unchanged,
   * so a criteria mixing "CPU > 90%" with "any disk > 90%" still means
   * what it says for each disk.
   */
  narrowFilter: (filter: CriteriaFilter) => CriteriaFilter;
}

export default class PerEntityCriteriaFanOut {
  public static isWildcard(value: string | undefined | null): boolean {
    return (value || "").trim() === AllEntitiesWildcard;
  }

  /**
   * Re-evaluate one criteria once per entity and return a match for
   * every entity that satisfies it on its own.
   *
   * Deliberately reuses the caller's full criteria evaluation rather
   * than reimplementing threshold comparison per entity: filter
   * conditions (All/Any), evaluate-over-time windows, no-data policies
   * and every filter type keep meaning exactly what they mean on the
   * whole-monitor path.
   */
  public static async collectMatches(input: {
    criteriaInstance: MonitorCriteriaInstance;
    entities: Array<FanOutEntity>;
    evaluateNarrowedCriteria: (
      narrowedCriteriaInstance: MonitorCriteriaInstance,
    ) => Promise<string | null>;
    monitorId: string | undefined;
  }): Promise<Array<PerSeriesCriteriaMatch>> {
    const criteriaId: string | undefined = input.criteriaInstance.data?.id;

    if (!criteriaId || input.entities.length === 0) {
      return [];
    }

    let entities: Array<FanOutEntity> = input.entities;

    if (entities.length > MaxEntitiesPerCriteria) {
      logger.warn(
        `${input.monitorId} - Criteria "${input.criteriaInstance.data?.name}" matched ${entities.length} entities, which is above the ${MaxEntitiesPerCriteria} per-criteria cap. Only the first ${MaxEntitiesPerCriteria} are evaluated; narrow the criteria to cover the rest.`,
      );
      entities = entities.slice(0, MaxEntitiesPerCriteria);
    }

    const matches: Array<PerSeriesCriteriaMatch> = [];

    for (const entity of entities) {
      const narrowed: MonitorCriteriaInstance =
        PerEntityCriteriaFanOut.narrowCriteriaInstance({
          criteriaInstance: input.criteriaInstance,
          entity,
        });

      const rootCause: string | null =
        await input.evaluateNarrowedCriteria(narrowed);

      if (!rootCause) {
        continue;
      }

      matches.push({
        criteriaMetId: criteriaId,
        fingerprint: MetricSeriesFingerprint.computeFingerprint(entity.labels),
        labels: entity.labels,
        rootCause: rootCause,
      });
    }

    return matches;
  }

  /**
   * A copy of the criteria whose filters address exactly one entity.
   *
   * The copy is deliberately shallow-per-filter: the evaluator writes
   * transient state onto the filter objects it evaluates (metric
   * context, resolved thresholds), and that must not leak back onto the
   * monitor's stored criteria or bleed between entities.
   */
  private static narrowCriteriaInstance(input: {
    criteriaInstance: MonitorCriteriaInstance;
    entity: FanOutEntity;
  }): MonitorCriteriaInstance {
    const narrowed: MonitorCriteriaInstance = new MonitorCriteriaInstance();

    narrowed.data = {
      ...input.criteriaInstance.data,
      filters: (input.criteriaInstance.data?.filters || []).map(
        (filter: CriteriaFilter) => {
          return input.entity.narrowFilter(filter);
        },
      ),
    } as MonitorCriteriaInstance["data"];

    return narrowed;
  }

  /**
   * The disks a Server monitor's criteria should fan out over: every
   * disk the agent reported, but only when the criteria actually asks
   * for all of them.
   *
   * Returns an empty array — meaning "not a per-disk criteria, take the
   * whole-monitor path" — when no filter uses the wildcard.
   */
  public static getServerDiskEntities(input: {
    dataToProcess: DataToProcess;
    criteriaInstance: MonitorCriteriaInstance;
  }): Array<FanOutEntity> {
    if (
      !PerEntityCriteriaFanOut.isServerDiskFanOutConfigured(
        input.criteriaInstance,
      )
    ) {
      return [];
    }

    const serverResponse: ServerMonitorResponse =
      input.dataToProcess as ServerMonitorResponse;

    const diskMetrics: Array<BasicDiskMetrics> =
      serverResponse.basicInfrastructureMetrics?.diskMetrics || [];

    const seenDiskPaths: Set<string> = new Set<string>();
    const entities: Array<FanOutEntity> = [];

    for (const diskMetric of diskMetrics) {
      const diskPath: string = (diskMetric.diskPath || "").trim();

      if (!diskPath || seenDiskPaths.has(diskPath)) {
        continue;
      }

      seenDiskPaths.add(diskPath);

      entities.push({
        labels: { diskPath: diskPath },
        narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
          if (
            filter.checkOn !== CheckOn.DiskUsagePercent ||
            !PerEntityCriteriaFanOut.isWildcard(
              filter.serverMonitorOptions?.diskPath,
            )
          ) {
            return filter;
          }

          return {
            ...filter,
            serverMonitorOptions: {
              ...filter.serverMonitorOptions,
              diskPath: diskPath,
            },
          };
        },
      });
    }

    return entities;
  }

  public static isServerDiskFanOutConfigured(
    criteriaInstance: MonitorCriteriaInstance,
  ): boolean {
    return (criteriaInstance.data?.filters || []).some(
      (filter: CriteriaFilter) => {
        return (
          filter.checkOn === CheckOn.DiskUsagePercent &&
          PerEntityCriteriaFanOut.isWildcard(
            filter.serverMonitorOptions?.diskPath,
          )
        );
      },
    );
  }

  /**
   * The interfaces an SNMP monitor's criteria should fan out over.
   *
   * Note the asymmetry with the disk case: an EMPTY interface name
   * already means "all interfaces" to the existing scoping code, and
   * has done since before per-entity alerting existed. Treating empty
   * as opt-in would turn one "3 interfaces down" alert into three
   * alerts on every existing SNMP monitor at upgrade time, so the
   * wildcard has to be explicit here too.
   */
  public static getSnmpInterfaceEntities(input: {
    dataToProcess: DataToProcess;
    criteriaInstance: MonitorCriteriaInstance;
  }): Array<FanOutEntity> {
    if (
      !PerEntityCriteriaFanOut.isSnmpInterfaceFanOutConfigured(
        input.criteriaInstance,
      )
    ) {
      return [];
    }

    const snmpResponse: SnmpMonitorResponse =
      input.dataToProcess as unknown as SnmpMonitorResponse;

    const interfaces: Array<SnmpInterface> = snmpResponse?.interfaces || [];

    const seenInterfaceNames: Set<string> = new Set<string>();
    const entities: Array<FanOutEntity> = [];

    for (const snmpInterface of interfaces) {
      /*
       * Scoping matches on name OR alias, so the name is what a
       * narrowed filter has to carry. An interface with neither cannot
       * be addressed individually and stays on the whole-monitor path.
       */
      const interfaceName: string = (snmpInterface.name || "").trim();

      if (!interfaceName || seenInterfaceNames.has(interfaceName)) {
        continue;
      }

      seenInterfaceNames.add(interfaceName);

      const labels: JSONObject = { interfaceName: interfaceName };

      if (snmpInterface.alias) {
        labels["interfaceAlias"] = snmpInterface.alias;
      }

      entities.push({
        labels,
        narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
          if (
            !PerEntityCriteriaFanOut.isInterfaceScopedCheckOn(filter.checkOn) ||
            !PerEntityCriteriaFanOut.isWildcard(
              filter.snmpMonitorOptions?.interfaceName,
            )
          ) {
            return filter;
          }

          return {
            ...filter,
            snmpMonitorOptions: {
              ...filter.snmpMonitorOptions,
              interfaceName: interfaceName,
            },
          };
        },
      });
    }

    return entities;
  }

  public static isSnmpInterfaceFanOutConfigured(
    criteriaInstance: MonitorCriteriaInstance,
  ): boolean {
    return (criteriaInstance.data?.filters || []).some(
      (filter: CriteriaFilter) => {
        return (
          PerEntityCriteriaFanOut.isInterfaceScopedCheckOn(filter.checkOn) &&
          PerEntityCriteriaFanOut.isWildcard(
            filter.snmpMonitorOptions?.interfaceName,
          )
        );
      },
    );
  }

  private static isInterfaceScopedCheckOn(
    checkOn: CheckOn | undefined,
  ): boolean {
    return (
      checkOn === CheckOn.SnmpInterfaceIsDown ||
      checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      checkOn === CheckOn.SnmpInterfaceErrorsPerSecond
    );
  }
}
