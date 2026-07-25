import DataMigrationBase from "./DataMigrationBase";
import LIMIT_MAX from "Common/Types/Database/LimitMax";
import Monitor from "Common/Models/DatabaseModels/Monitor";
import NetworkDevice from "Common/Models/DatabaseModels/NetworkDevice";
import MonitorService from "Common/Server/Services/MonitorService";
import MonitorProbeService from "Common/Server/Services/MonitorProbeService";
import NetworkDeviceService from "Common/Server/Services/NetworkDeviceService";
import MonitorType from "Common/Types/Monitor/MonitorType";
import SnmpOid from "Common/Types/Monitor/SnmpMonitor/SnmpOid";
import ObjectID from "Common/Types/ObjectID";
import logger from "Common/Server/Utils/Logger";

/*
 * Device-owned polling migration.
 *
 * Network Device monitors used to carry the collection options (interface
 * walking, endpoint collection, health OIDs) and were executed by probes
 * via MonitorProbe rows. Collection now lives on the NetworkDevice itself
 * — the device's assigned probe polls it on the device's own schedule and
 * monitors are evaluated server-side against each walk.
 *
 * This migration:
 *  1. copies each Network Device monitor's step collection options onto
 *     the devices its steps reference (union semantics: if any step walked
 *     interfaces / collected endpoints, the device keeps doing so; step
 *     OIDs are merged into the device's health OIDs), and
 *  2. deletes the MonitorProbe rows of Network Device monitors so probes
 *     stop double-polling them through the monitor pipeline.
 *
 * Devices that never had a monitor need nothing here: the new columns
 * default to polling-enabled with interface walking on, so they start
 * getting inventoried on upgrade.
 */
export default class MoveNetworkDeviceMonitorCollectionToDevices extends DataMigrationBase {
  public constructor() {
    super("MoveNetworkDeviceMonitorCollectionToDevices");
  }

  public override async migrate(): Promise<void> {
    const monitors: Array<Monitor> = await MonitorService.findBy({
      query: {
        monitorType: MonitorType.NetworkDevice,
      },
      select: {
        _id: true,
        projectId: true,
        monitorSteps: true,
      },
      skip: 0,
      limit: LIMIT_MAX,
      props: {
        isRoot: true,
      },
    });

    interface DeviceCollectionAccumulator {
      projectIds: Set<string>;
      walkInterfaces: boolean;
      collectEndpoints: boolean;
      oids: Array<SnmpOid>;
    }

    const perDevice: Map<string, DeviceCollectionAccumulator> = new Map();

    for (const monitor of monitors) {
      if (!monitor.projectId) {
        continue;
      }

      for (const step of monitor.monitorSteps?.data
        ?.monitorStepsInstanceArray || []) {
        const deviceId: string | undefined =
          step.data?.networkDeviceMonitor?.networkDeviceId;

        if (!deviceId) {
          continue;
        }

        const accumulator: DeviceCollectionAccumulator = perDevice.get(
          deviceId,
        ) || {
          projectIds: new Set<string>(),
          walkInterfaces: false,
          collectEndpoints: false,
          oids: [],
        };

        accumulator.projectIds.add(monitor.projectId.toString());
        accumulator.walkInterfaces =
          accumulator.walkInterfaces ||
          step.data?.networkDeviceMonitor?.monitorInterfaces !== false;
        accumulator.collectEndpoints =
          accumulator.collectEndpoints ||
          step.data?.networkDeviceMonitor?.collectEndpoints === true;

        for (const oid of step.data?.networkDeviceMonitor?.oids || []) {
          if (oid?.oid) {
            accumulator.oids.push(oid);
          }
        }

        perDevice.set(deviceId, accumulator);
      }
    }

    for (const [deviceIdAsString, accumulator] of perDevice.entries()) {
      try {
        const device: NetworkDevice | null =
          await NetworkDeviceService.findOneBy({
            query: {
              _id: new ObjectID(deviceIdAsString),
            },
            select: {
              _id: true,
              projectId: true,
              snmpOids: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (!device || !device.id || !device.projectId) {
          continue;
        }

        /*
         * A step's device reference is user-writable JSON — only copy
         * settings from monitors in the device's own project.
         */
        if (!accumulator.projectIds.has(device.projectId.toString())) {
          continue;
        }

        const mergedOids: Array<SnmpOid> = [];
        const seenOids: Set<string> = new Set();

        for (const oid of [...(device.snmpOids || []), ...accumulator.oids]) {
          if (!oid?.oid || seenOids.has(oid.oid)) {
            continue;
          }
          seenOids.add(oid.oid);
          mergedOids.push({
            oid: oid.oid,
            name: oid.name || undefined,
            description: oid.description || undefined,
          });
        }

        await NetworkDeviceService.updateOneById({
          id: device.id,
          data: {
            walkInterfaces: accumulator.walkInterfaces,
            collectEndpoints: accumulator.collectEndpoints,
            snmpOids: mergedOids,
          } as any,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `Failed to move collection settings onto device ${deviceIdAsString}:`,
        );
        logger.error(err);
      }
    }

    /*
     * Stop probes from executing Network Device monitors: without
     * MonitorProbe rows they are never claimed. Monitor evaluation now
     * happens on walk ingest.
     */
    for (const monitor of monitors) {
      if (!monitor.id) {
        continue;
      }

      try {
        await MonitorProbeService.deleteBy({
          query: {
            monitorId: monitor.id,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      } catch (err) {
        logger.error(
          `Failed to delete MonitorProbe rows for monitor ${monitor.id.toString()}:`,
        );
        logger.error(err);
      }
    }
  }

  public override async rollback(): Promise<void> {
    return;
  }
}
