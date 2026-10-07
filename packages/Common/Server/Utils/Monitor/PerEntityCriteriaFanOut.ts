import { CheckOn, CriteriaFilter } from "../../../Types/Monitor/CriteriaFilter";
import { JSONObject } from "../../../Types/JSON";
import MonitorCriteriaInstance from "../../../Types/Monitor/MonitorCriteriaInstance";
import ServerMonitorResponse from "../../../Types/Monitor/ServerMonitor/ServerMonitorResponse";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import {
  SnmpTableSnapshot,
  SnmpTableSnapshotRow,
} from "../../../Types/Monitor/SnmpMonitor/SnmpTable";
import SnmpTableListUtil from "../../../Types/Monitor/SnmpMonitor/SnmpTableListUtil";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
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

    const interfaces: Array<SnmpInterface> =
      PerEntityCriteriaFanOut.getSnmpResponse(input.dataToProcess)
        ?.interfaces || [];

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

  /**
   * The walk a Network Device monitor is judged on.
   *
   * The poll pipeline hands the evaluator a ProbeMonitorResponse whose walk
   * sits under `snmpResponse` - interfaces and tables included. Reading the
   * interfaces off the top level of that object (as this file once did)
   * found nothing, so a "*" interface criteria never fanned out on a real
   * poll and quietly fell back to one combined alert. A bare walk is still
   * accepted for callers that pass one directly.
   */
  private static getSnmpResponse(
    dataToProcess: DataToProcess,
  ): SnmpMonitorResponse | undefined {
    const probeResponse: ProbeMonitorResponse =
      dataToProcess as ProbeMonitorResponse;

    if (probeResponse?.snmpResponse) {
      return probeResponse.snmpResponse;
    }

    const bareWalk: SnmpMonitorResponse =
      dataToProcess as unknown as SnmpMonitorResponse;

    if (bareWalk?.interfaces || bareWalk?.tables) {
      return bareWalk;
    }

    return undefined;
  }

  /**
   * The table rows a Network Device monitor's criteria should fan out
   * over: every row of each table a "*" table filter names, so a second
   * tunnel going down raises its own alert instead of being folded into
   * the first one's.
   *
   * Like interfaces, an EMPTY row scope keeps its historical meaning - every
   * row, one combined alert - and only "*" opts into one alert per row.
   */
  public static getSnmpTableRowEntities(input: {
    dataToProcess: DataToProcess;
    criteriaInstance: MonitorCriteriaInstance;
  }): Array<FanOutEntity> {
    const wildcardTableKeys: Array<string> =
      PerEntityCriteriaFanOut.getWildcardTableKeys(input.criteriaInstance);

    if (wildcardTableKeys.length === 0) {
      return [];
    }

    const tables: Array<SnmpTableSnapshot> =
      PerEntityCriteriaFanOut.getSnmpResponse(input.dataToProcess)?.tables ||
      [];

    const entities: Array<FanOutEntity> = [];

    for (const tableKey of wildcardTableKeys) {
      const snapshot: SnmpTableSnapshot | undefined =
        SnmpTableListUtil.findSnapshot(tables, tableKey);

      // A table this walk did not produce has no rows to fan out over.
      if (!snapshot || snapshot.failureCause) {
        continue;
      }

      for (const row of snapshot.rows) {
        const rowScope: string = SnmpTableListUtil.getRowScope(snapshot, row);

        entities.push({
          labels: PerEntityCriteriaFanOut.getTableRowLabels(snapshot, row),
          narrowFilter: (filter: CriteriaFilter): CriteriaFilter => {
            if (
              !PerEntityCriteriaFanOut.isTableScopedCheckOn(filter.checkOn) ||
              !PerEntityCriteriaFanOut.isWildcard(
                filter.snmpMonitorOptions?.tableRow,
              ) ||
              SnmpTableListUtil.normalizeKey(
                filter.snmpMonitorOptions?.tableKey,
              ) !== snapshot.key
            ) {
              return filter;
            }

            return {
              ...filter,
              snmpMonitorOptions: {
                ...filter.snmpMonitorOptions,
                tableRow: rowScope,
              },
            };
          },
        });
      }
    }

    return entities;
  }

  public static isSnmpTableFanOutConfigured(
    criteriaInstance: MonitorCriteriaInstance,
  ): boolean {
    return (
      PerEntityCriteriaFanOut.getWildcardTableKeys(criteriaInstance).length > 0
    );
  }

  /*
   * What identifies one row on the alert it raises: the table and the row's
   * name, plus the index when the name alone is not unique.
   */
  private static getTableRowLabels(
    snapshot: SnmpTableSnapshot,
    row: SnmpTableSnapshotRow,
  ): JSONObject {
    const labels: JSONObject = {
      snmpTable: snapshot.name,
      snmpTableRow: row.label,
    };

    if (row.label !== row.index) {
      labels["snmpTableRowIndex"] = row.index;
    }

    return labels;
  }

  private static getWildcardTableKeys(
    criteriaInstance: MonitorCriteriaInstance,
  ): Array<string> {
    const keys: Array<string> = [];

    for (const filter of criteriaInstance.data?.filters || []) {
      if (
        !PerEntityCriteriaFanOut.isTableScopedCheckOn(filter.checkOn) ||
        !PerEntityCriteriaFanOut.isWildcard(filter.snmpMonitorOptions?.tableRow)
      ) {
        continue;
      }

      const key: string = SnmpTableListUtil.normalizeKey(
        filter.snmpMonitorOptions?.tableKey,
      );

      if (key && !keys.includes(key)) {
        keys.push(key);
      }
    }

    return keys;
  }

  /*
   * Row count is deliberately not here: it is a property of the whole table,
   * and narrowing it to one row would turn "fewer than 4 tunnels" into four
   * separate "1 row" checks.
   */
  private static isTableScopedCheckOn(checkOn: CheckOn | undefined): boolean {
    return checkOn === CheckOn.SnmpTableValue;
  }
}
