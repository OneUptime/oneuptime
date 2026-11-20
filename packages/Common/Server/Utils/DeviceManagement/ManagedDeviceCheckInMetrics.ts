import { MetricPointType } from "../../../Models/AnalyticsModels/Metric";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import Host from "../../../Models/DatabaseModels/Host";
import ManagedDevice from "../../../Models/DatabaseModels/ManagedDevice";
import MetricType from "../../../Models/DatabaseModels/MetricType";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../Types/Date";
import Dictionary from "../../../Types/Dictionary";
import {
  MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION,
  MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
  MANAGED_DEVICE_CHECK_IN_AGE_UNIT,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
  MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT,
  ManagedDeviceCheckInReading,
  getManagedDeviceCheckInAttributes,
  getManagedDeviceCheckInReadings,
  getManagedDeviceSecurityPatchAttributes,
} from "../../../Types/DeviceManagement/ManagedDeviceCheckIn";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  canonicalizeEntityValue,
  keyForHost,
} from "../../../Utils/Telemetry/EntityKey";
import GlobalConfigService from "../../Services/GlobalConfigService";
import HostService from "../../Services/HostService";
import ManagedDeviceService from "../../Services/ManagedDeviceService";
import MetricService from "../../Services/MetricService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import TelemetryUtil from "../Telemetry/Telemetry";

/*
 * WRITES HOW LONG SINCE EACH DEVICE OF A CONNECTION CHECKED IN (#9835).
 *
 * After a read of a device management connection that read every check-in
 * up to its end (DeviceManagementReadRunner), one reading per device in
 * service: the minutes since its last check-in, at that end
 * (ManagedDeviceCheckIn says which devices, and why). A Metrics monitor
 * grouped by the device's name reads them (ManagedDeviceAlertTemplates).
 *
 * Each reading is one metric row, keyed to the connection (primaryEntityId
 * = its id, type DeviceManagementConnection, never billed as ingested
 * telemetry) and to the device's host, as telemetry keys a host (its
 * host.name, trimmed and lowercased), so the host's Inventory page charts it
 * beside what the device sends. A device the Android agent reports - a host
 * in Hosts, not archived - is marked so, and the recommended monitor leaves
 * it to Host Stopped Reporting.
 *
 * Beside each Android device's check-in age, the same read writes how old
 * its security patch level is, in whole UTC days (#10098), under a metric
 * of its own with the level on its attributes: what a device manager's
 * Security Patch Out of Date template reads, for the devices the Android
 * agent does not report (ManagedDeviceCheckIn says why).
 */

// Devices read from the database per page, as the read runner reads them.
const DEVICE_PAGE_SIZE: number = 1000;

// Hosts asked about per query.
const HOST_LOOKUP_PAGE_SIZE: number = 500;

// Rows per insert, as the other metric writers insert them.
const INSERT_BATCH_SIZE: number = 5000;

/*
 * The same knob and default as monitor and SLO metrics
 * (GlobalConfig.monitorMetricRetentionInDays).
 */
const DEFAULT_RETENTION_DAYS: number = 30;

export interface ManagedDeviceCheckInOutcome {
  // Readings written.
  readingCount: number;
  // Of them, devices the Android agent reports (hosts in Hosts).
  hostCount: number;
  // Security patch readings written beside them: Android devices with a level.
  securityPatchReadingCount: number;
}

export interface ManagedDeviceCheckInRecordInput {
  projectId: ObjectID;
  connectionId: ObjectID;
  provider: string;
  // The end of the read's check-in window: when the readings are taken.
  asOf: Date;
}

/*
 * A reading's metric row, of either metric. Its shape stays in lockstep
 * with the other writers' (SessionReplayBudgetMetrics.buildMetricRow), with
 * the device's host's entity key, as ingest stamps a host's telemetry. Pure.
 */
function buildManagedDeviceReadingRow(data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  hostName: string;
  name: string;
  value: number;
  attributes: Dictionary<string>;
  asOf: Date;
  retentionDate: Date;
}): JSONObject {
  const time: string = OneUptimeDate.toClickhouseDateTime(data.asOf);
  const hostEntityKey: string = keyForHost(
    data.projectId.toString(),
    canonicalizeEntityValue(data.hostName),
  );

  return {
    _id: ObjectID.generateTimeOrdered().toString(),
    createdAt: time,
    projectId: data.projectId.toString(),
    primaryEntityId: data.connectionId.toString(),
    primaryEntityType: ServiceType.DeviceManagementConnection,
    name: data.name,
    aggregationTemporality: null,
    // A reading of how long at one moment, i.e. a Gauge.
    metricPointType: MetricPointType.Gauge,
    time: time,
    startTime: null,
    timeUnixNano: OneUptimeDate.toUnixNano(data.asOf).toString(),
    startTimeUnixNano: null,
    attributes: data.attributes as JSONObject,
    attributeKeys: TelemetryUtil.getAttributeKeys(
      data.attributes as JSONObject,
    ),
    entityKeys: [hostEntityKey],
    hostEntityKey: hostEntityKey,
    isMonotonic: null,
    count: null,
    sum: null,
    min: null,
    max: null,
    bucketCounts: [],
    explicitBounds: [],
    value: data.value,
    retentionDate: OneUptimeDate.toClickhouseDateTime(data.retentionDate),
  } as JSONObject;
}

// One reading's check-in row: the minutes since the device checked in. Pure.
export function buildManagedDeviceCheckInRow(data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  provider: string;
  reading: ManagedDeviceCheckInReading;
  asOf: Date;
  retentionDate: Date;
}): JSONObject {
  return buildManagedDeviceReadingRow({
    projectId: data.projectId,
    connectionId: data.connectionId,
    hostName: data.reading.hostName,
    name: MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME,
    value: data.reading.ageInMinutes,
    attributes: getManagedDeviceCheckInAttributes({
      reading: data.reading,
      connectionId: data.connectionId.toString(),
      provider: data.provider,
    }),
    asOf: data.asOf,
    retentionDate: data.retentionDate,
  });
}

/*
 * One reading's security patch row (#10098): the days since the device's
 * patch level, with the level on it. Undefined for a reading with no patch:
 * a device that is not Android, or whose level is no date. Pure.
 */
export function buildManagedDeviceSecurityPatchRow(data: {
  projectId: ObjectID;
  connectionId: ObjectID;
  provider: string;
  reading: ManagedDeviceCheckInReading;
  asOf: Date;
  retentionDate: Date;
}): JSONObject | undefined {
  const attributes: Dictionary<string> | undefined =
    getManagedDeviceSecurityPatchAttributes({
      reading: data.reading,
      connectionId: data.connectionId.toString(),
      provider: data.provider,
    });

  if (!data.reading.securityPatch || !attributes) {
    return undefined;
  }

  return buildManagedDeviceReadingRow({
    projectId: data.projectId,
    connectionId: data.connectionId,
    hostName: data.reading.hostName,
    name: MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME,
    value: data.reading.securityPatch.ageInDays,
    attributes,
    asOf: data.asOf,
    retentionDate: data.retentionDate,
  });
}

export default class ManagedDeviceCheckInMetrics {
  /*
   * Writes the readings of one connection's devices. Throws on a failed
   * read or write: the read runner keeps it a warning on the read.
   */
  public static async record(
    data: ManagedDeviceCheckInRecordInput,
  ): Promise<ManagedDeviceCheckInOutcome> {
    const devices: Array<ManagedDevice> =
      await ManagedDeviceCheckInMetrics.loadDevices(data);

    const unmarked: Array<ManagedDeviceCheckInReading> =
      getManagedDeviceCheckInReadings({
        devices: devices,
        hostNames: new Set<string>(),
        asOf: data.asOf,
        provider: data.provider,
      });

    if (unmarked.length === 0) {
      return { readingCount: 0, hostCount: 0, securityPatchReadingCount: 0 };
    }

    // Which devices the Android agent reports, asked about once per read.
    const hostNames: Set<string> =
      await ManagedDeviceCheckInMetrics.loadHostNames({
        projectId: data.projectId,
        hostNames: unmarked.map(
          (reading: ManagedDeviceCheckInReading): string => {
            return reading.hostName;
          },
        ),
      });

    const readings: Array<ManagedDeviceCheckInReading> = unmarked.map(
      (reading: ManagedDeviceCheckInReading): ManagedDeviceCheckInReading => {
        return { ...reading, isHost: hostNames.has(reading.hostName) };
      },
    );

    const retentionDate: Date = OneUptimeDate.addRemoveDurationInDays(
      data.asOf,
      await ManagedDeviceCheckInMetrics.getRetentionDays(),
    );

    const rows: Array<JSONObject> = [];
    let securityPatchReadingCount: number = 0;

    for (const reading of readings) {
      const row: {
        projectId: ObjectID;
        connectionId: ObjectID;
        provider: string;
        reading: ManagedDeviceCheckInReading;
        asOf: Date;
        retentionDate: Date;
      } = {
        projectId: data.projectId,
        connectionId: data.connectionId,
        provider: data.provider,
        reading: reading,
        asOf: data.asOf,
        retentionDate: retentionDate,
      };

      rows.push(buildManagedDeviceCheckInRow(row));

      // An Android device's patch age, beside its check-in (#10098).
      const securityPatchRow: JSONObject | undefined =
        buildManagedDeviceSecurityPatchRow(row);

      if (securityPatchRow) {
        rows.push(securityPatchRow);
        securityPatchReadingCount++;
      }
    }

    for (
      let start: number = 0;
      start < rows.length;
      start += INSERT_BATCH_SIZE
    ) {
      await MetricService.insertJsonRows(
        rows.slice(start, start + INSERT_BATCH_SIZE),
      );
    }

    await ManagedDeviceCheckInMetrics.registerMetricName({
      projectId: data.projectId,
      hasSecurityPatchReadings: securityPatchReadingCount > 0,
    });

    return {
      readingCount: readings.length,
      hostCount: readings.filter(
        (reading: ManagedDeviceCheckInReading): boolean => {
          return reading.isHost;
        },
      ).length,
      securityPatchReadingCount,
    };
  }

  // The connection's devices the service still lists, in pages.
  private static async loadDevices(
    data: ManagedDeviceCheckInRecordInput,
  ): Promise<Array<ManagedDevice>> {
    const devices: Array<ManagedDevice> = [];
    let skip: number = 0;

    for (;;) {
      const page: Array<ManagedDevice> = await ManagedDeviceService.findBy({
        query: {
          projectId: data.projectId,
          connectionId: data.connectionId,
          removedAt: QueryHelper.isNull(),
        },
        select: {
          _id: true,
          providerDeviceId: true,
          platform: true,
          deviceName: true,
          alias: true,
          serialNumber: true,
          groupName: true,
          groupPath: true,
          providerState: true,
          lastCheckInAt: true,
          removedAt: true,
          securityPatchLevel: true,
        },
        sort: { _id: SortOrder.Ascending },
        skip: skip,
        limit: DEVICE_PAGE_SIZE,
        props: { isRoot: true },
      });

      devices.push(...page);

      if (page.length < DEVICE_PAGE_SIZE) {
        break;
      }

      skip += DEVICE_PAGE_SIZE;
    }

    return devices;
  }

  /*
   * Which of these hosts are hosts in Hosts: the ones the Android agent
   * registered, by their identifier (host.name, trimmed and lowercased), and
   * not archived.
   */
  private static async loadHostNames(data: {
    projectId: ObjectID;
    hostNames: Array<string>;
  }): Promise<Set<string>> {
    const found: Set<string> = new Set<string>();
    const wanted: Array<string> = Array.from(new Set<string>(data.hostNames));

    for (
      let start: number = 0;
      start < wanted.length;
      start += HOST_LOOKUP_PAGE_SIZE
    ) {
      const page: Array<string> = wanted.slice(
        start,
        start + HOST_LOOKUP_PAGE_SIZE,
      );

      const hosts: Array<Host> = await HostService.findBy({
        query: {
          projectId: data.projectId,
          hostIdentifier: QueryHelper.any(page),
        },
        select: { hostIdentifier: true, isArchived: true },
        skip: 0,
        limit: page.length * 2,
        props: { isRoot: true },
      });

      for (const host of hosts) {
        // isArchived is nullable: null or undefined is a host in use.
        if (host.isArchived || !host.hostIdentifier) {
          continue;
        }

        found.add(canonicalizeEntityValue(host.hostIdentifier));
      }
    }

    return found;
  }

  /*
   * Puts the metrics in the project's catalog, so the metric picker and a
   * Metrics monitor's builder offer them with their units: the check-ins,
   * and the security patch ages once a read wrote one. A failure only
   * delays that until a later read: the rows are written.
   */
  private static async registerMetricName(data: {
    projectId: ObjectID;
    hasSecurityPatchReadings: boolean;
  }): Promise<void> {
    const checkIns: MetricType = new MetricType();
    checkIns.name = MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME;
    checkIns.description = MANAGED_DEVICE_CHECK_IN_AGE_DESCRIPTION;
    checkIns.unit = MANAGED_DEVICE_CHECK_IN_AGE_UNIT;

    const metricNameServiceNameMap: Dictionary<MetricType> = {
      [MANAGED_DEVICE_CHECK_IN_AGE_METRIC_NAME]: checkIns,
    };

    if (data.hasSecurityPatchReadings) {
      const securityPatches: MetricType = new MetricType();
      securityPatches.name = MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME;
      securityPatches.description =
        MANAGED_DEVICE_SECURITY_PATCH_AGE_DESCRIPTION;
      securityPatches.unit = MANAGED_DEVICE_SECURITY_PATCH_AGE_UNIT;
      metricNameServiceNameMap[MANAGED_DEVICE_SECURITY_PATCH_AGE_METRIC_NAME] =
        securityPatches;
    }

    try {
      await TelemetryUtil.indexMetricNameServiceNameMap({
        projectId: data.projectId,
        metricNameServiceNameMap,
      });
    } catch (error) {
      logger.error(
        `Managed device check-ins of project ${data.projectId.toString()}: the metrics could not be put in the catalog; a later read tries again: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private static async getRetentionDays(): Promise<number> {
    try {
      const globalConfig: GlobalConfig | null =
        await GlobalConfigService.findOneBy({
          query: { _id: ObjectID.getZeroObjectID().toString() },
          select: { monitorMetricRetentionInDays: true },
          props: { isRoot: true },
        });

      const days: unknown = globalConfig?.monitorMetricRetentionInDays;

      return typeof days === "number" && days > 0
        ? days
        : DEFAULT_RETENTION_DAYS;
    } catch (error) {
      logger.error(error);
      return DEFAULT_RETENTION_DAYS;
    }
  }
}
