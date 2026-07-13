import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkInterfaceService from "../../Services/NetworkInterfaceService";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import LldpNeighbor from "../../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import ProbeMonitorResponse from "../../../Types/Probe/ProbeMonitorResponse";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * Keeps the NetworkDevice / NetworkInterface inventory in sync with each
 * interface walk, then prunes the in-flight response down to MONITORED
 * interfaces so criteria and metrics only consider ports the user cares
 * about. Inventory rows always reflect every walked interface; the
 * isMonitored flag is user-owned and never overwritten here.
 */
export default class NetworkInventoryUtil {
  public static async updateFromWalk(data: {
    monitor: Monitor;
    dataToProcess: ProbeMonitorResponse;
  }): Promise<void> {
    const step: MonitorStep | undefined =
      data.monitor.monitorSteps?.data?.monitorStepsInstanceArray?.find(
        (monitorStep: MonitorStep) => {
          return (
            monitorStep.id.toString() ===
            data.dataToProcess.monitorStepId.toString()
          );
        },
      );

    const deviceIdAsString: string | undefined =
      step?.data?.networkDeviceMonitor?.networkDeviceId;

    if (!deviceIdAsString || !data.monitor.projectId) {
      return;
    }

    const deviceId: ObjectID = new ObjectID(deviceIdAsString);
    const walkedInterfaces: Array<SnmpInterface> =
      data.dataToProcess.snmpResponse?.interfaces || [];
    const systemInfo:
      | { sysDescr?: string | undefined; sysName?: string | undefined }
      | undefined = data.dataToProcess.snmpResponse?.systemInfo;
    const lldpNeighbors: Array<LldpNeighbor> | undefined =
      data.dataToProcess.snmpResponse?.lldpNeighbors;

    const now: Date = OneUptimeDate.getCurrentDate();

    try {
      // --- Device enrichment + cached counts ---
      const deviceUpdate: Record<string, unknown> = {
        lastSeenAt: now,
      };

      if (systemInfo?.sysDescr) {
        deviceUpdate["sysDescr"] = systemInfo.sysDescr.substring(0, 500);
      }
      if (systemInfo?.sysName) {
        deviceUpdate["sysName"] = systemInfo.sysName.substring(0, 100);
      }

      /*
       * Store the LLDP snapshot (capped) whenever the walk ran, even if it
       * found nothing — clearing stale neighbors is as important as adding
       * new ones for keeping the topology accurate.
       */
      if (lldpNeighbors !== undefined) {
        deviceUpdate["lldpNeighbors"] = lldpNeighbors.slice(0, 256);
      }

      if (walkedInterfaces.length > 0) {
        deviceUpdate["interfacesTotal"] = walkedInterfaces.length;
        deviceUpdate["interfacesUp"] = walkedInterfaces.filter(
          (walked: SnmpInterface) => {
            return walked.isAdministrativelyUp && walked.isOperationallyUp;
          },
        ).length;
        deviceUpdate["interfacesDown"] = walkedInterfaces.filter(
          (walked: SnmpInterface) => {
            return walked.isAdministrativelyUp && !walked.isOperationallyUp;
          },
        ).length;
      }

      await NetworkDeviceService.updateOneById({
        id: deviceId,
        data: deviceUpdate as any,
        props: {
          isRoot: true,
        },
      });

      if (walkedInterfaces.length === 0) {
        return;
      }

      // --- Interface upsert ---
      const existingInterfaces: Array<NetworkInterface> =
        await NetworkInterfaceService.findBy({
          query: {
            networkDeviceId: deviceId,
          },
          select: {
            _id: true,
            interfaceIndex: true,
            isMonitored: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: {
            isRoot: true,
          },
        });

      const existingByIndex: Map<number, NetworkInterface> = new Map();
      for (const existing of existingInterfaces) {
        if (existing.interfaceIndex !== undefined) {
          existingByIndex.set(existing.interfaceIndex, existing);
        }
      }

      const unmonitoredIndexes: Set<number> = new Set();

      for (const walked of walkedInterfaces) {
        const existing: NetworkInterface | undefined = existingByIndex.get(
          walked.interfaceIndex,
        );

        if (existing && existing.isMonitored === false) {
          unmonitoredIndexes.add(walked.interfaceIndex);
        }

        const interfaceData: Record<string, unknown> = {
          name: (walked.name || "").substring(0, 100),
          alias: walked.alias ? walked.alias.substring(0, 100) : null,
          isOperationallyUp: walked.isOperationallyUp,
          isAdministrativelyUp: walked.isAdministrativelyUp,
          speedInMbps:
            walked.speedInBitsPerSecond !== undefined
              ? walked.speedInBitsPerSecond / 1000000
              : null,
          inRateMbps:
            walked.inBitsPerSecond !== undefined
              ? Math.round((walked.inBitsPerSecond / 1000000) * 1000) / 1000
              : null,
          outRateMbps:
            walked.outBitsPerSecond !== undefined
              ? Math.round((walked.outBitsPerSecond / 1000000) * 1000) / 1000
              : null,
          utilizationPercent: walked.utilizationPercent ?? null,
          errorsPerSecond: walked.errorsPerSecond ?? null,
          lastSeenAt: now,
        };

        if (existing && existing.id) {
          await NetworkInterfaceService.updateOneById({
            id: existing.id,
            data: interfaceData as any,
            props: {
              isRoot: true,
            },
          });
        } else {
          const newInterface: NetworkInterface = new NetworkInterface();
          newInterface.projectId = data.monitor.projectId;
          newInterface.networkDeviceId = deviceId;
          newInterface.interfaceIndex = walked.interfaceIndex;
          newInterface.name = (walked.name || "").substring(0, 100);
          if (walked.alias) {
            newInterface.alias = walked.alias.substring(0, 100);
          }
          newInterface.isMonitored = true;
          newInterface.isOperationallyUp = walked.isOperationallyUp;
          newInterface.isAdministrativelyUp = walked.isAdministrativelyUp;
          if (walked.speedInBitsPerSecond !== undefined) {
            newInterface.speedInMbps = walked.speedInBitsPerSecond / 1000000;
          }
          newInterface.lastSeenAt = now;

          await NetworkInterfaceService.create({
            data: newInterface,
            props: {
              isRoot: true,
            },
          });
        }
      }

      /*
       * Prune the in-flight response to monitored interfaces only, so
       * criteria (interface down / utilization / errors) and per-interface
       * metrics ignore ports the user muted. The inventory above keeps the
       * full picture.
       */
      if (unmonitoredIndexes.size > 0 && data.dataToProcess.snmpResponse) {
        data.dataToProcess.snmpResponse.interfaces = walkedInterfaces.filter(
          (walked: SnmpInterface) => {
            return !unmonitoredIndexes.has(walked.interfaceIndex);
          },
        );
      }
    } catch (err) {
      // Inventory bookkeeping must never fail the check pipeline.
      logger.error(
        `Failed to update network inventory for device ${deviceIdAsString}:`,
      );
      logger.error(err);
    }
  }
}
