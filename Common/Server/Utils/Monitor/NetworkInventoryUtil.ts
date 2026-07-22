import Monitor from "../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkInterface from "../../../Models/DatabaseModels/NetworkInterface";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import NetworkInterfaceService from "../../Services/NetworkInterfaceService";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import MonitorStep from "../../../Types/Monitor/MonitorStep";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import LldpNeighbor from "../../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "../../../Types/Monitor/SnmpMonitor/CdpNeighbor";
import ArpEntry from "../../../Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "../../../Types/Monitor/SnmpMonitor/FdbEntry";
import EndpointAttachmentUtil, {
  EndpointAttachmentResult,
} from "../../../Utils/Monitor/EndpointAttachmentUtil";
import SnmpSystemInfo from "../../../Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpEntityInfo from "../../../Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpVendorTemplateUtil from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
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

    /*
     * The device id is read from the monitor's step JSON, which a user can
     * set to any UUID through the Monitor API (the dashboard dropdown is
     * scoped, but the API is not). Confirm the device actually belongs to
     * this monitor's project before writing anything with isRoot — without
     * this guard a crafted step could point at another project's device and
     * overwrite its inventory (or spawn interfaces under it).
     */
    const ownedDevice: NetworkDevice | null =
      await NetworkDeviceService.findOneBy({
        query: {
          _id: deviceId,
          projectId: data.monitor.projectId,
        },
        select: {
          _id: true,
          siteId: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!ownedDevice) {
      return;
    }

    const walkedInterfaces: Array<SnmpInterface> =
      data.dataToProcess.snmpResponse?.interfaces || [];
    const systemInfo: SnmpSystemInfo | undefined =
      data.dataToProcess.snmpResponse?.systemInfo;
    const entityInfo: SnmpEntityInfo | undefined =
      data.dataToProcess.snmpResponse?.entityInfo;
    const lldpNeighbors: Array<LldpNeighbor> | undefined =
      data.dataToProcess.snmpResponse?.lldpNeighbors;
    const cdpNeighbors: Array<CdpNeighbor> | undefined =
      data.dataToProcess.snmpResponse?.cdpNeighbors;
    const arpEntries: Array<ArpEntry> | undefined =
      data.dataToProcess.snmpResponse?.arpEntries;
    const fdbEntries: Array<FdbEntry> | undefined =
      data.dataToProcess.snmpResponse?.fdbEntries;

    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * lastSeenAt is "last time the device actually answered", not "last time
     * we tried": the device list's status pill and the topology map both
     * derive up/down from its freshness, so bumping it on a failed poll
     * would paint an unreachable device green. A poll where the probe could
     * not reach the device reports isOnline === false; treat anything else
     * (reachable, or a monitor type that reports no reachability) as seen.
     */
    const isDeviceReachable: boolean = data.dataToProcess.isOnline !== false;

    try {
      // --- Device enrichment + cached counts ---
      const deviceUpdate: Record<string, unknown> = {};

      if (isDeviceReachable) {
        deviceUpdate["lastSeenAt"] = now;
      }

      if (systemInfo?.sysDescr) {
        deviceUpdate["sysDescr"] = systemInfo.sysDescr.substring(0, 500);
      }
      if (systemInfo?.sysName) {
        deviceUpdate["sysName"] = systemInfo.sysName.substring(0, 100);
      }
      if (systemInfo?.sysObjectId) {
        deviceUpdate["sysObjectId"] = systemInfo.sysObjectId.substring(0, 100);
      }
      if (systemInfo?.sysLocation) {
        deviceUpdate["sysLocation"] = systemInfo.sysLocation.substring(0, 100);
      }
      if (systemInfo?.sysContact) {
        deviceUpdate["sysContact"] = systemInfo.sysContact.substring(0, 100);
      }
      if (systemInfo?.sysUpTimeSeconds !== undefined) {
        deviceUpdate["lastRebootedAt"] = new Date(
          now.getTime() - systemInfo.sysUpTimeSeconds * 1000,
        );
      }

      /*
       * Vendor: ENTITY-MIB manufacturer when the device implements it,
       * otherwise fingerprinted from the sysObjectID enterprise arc.
       */
      const vendor: string | undefined =
        entityInfo?.manufacturer ||
        SnmpVendorTemplateUtil.getVendorNameBySysObjectId(
          systemInfo?.sysObjectId,
        );
      if (vendor) {
        deviceUpdate["vendor"] = vendor.substring(0, 100);
      }
      if (entityInfo?.model) {
        deviceUpdate["deviceModel"] = entityInfo.model.substring(0, 100);
      }
      if (entityInfo?.serialNumber) {
        deviceUpdate["serialNumber"] = entityInfo.serialNumber.substring(
          0,
          100,
        );
      }
      if (entityInfo?.firmwareVersion) {
        deviceUpdate["firmwareVersion"] = entityInfo.firmwareVersion.substring(
          0,
          100,
        );
      }
      if (entityInfo?.softwareVersion) {
        deviceUpdate["softwareVersion"] = entityInfo.softwareVersion.substring(
          0,
          100,
        );
      }

      /*
       * Store the LLDP snapshot (capped) whenever the walk ran, even if it
       * found nothing — clearing stale neighbors is as important as adding
       * new ones for keeping the topology accurate. Same for CDP.
       */
      if (lldpNeighbors !== undefined) {
        deviceUpdate["lldpNeighbors"] = lldpNeighbors.slice(0, 256);
      }
      if (cdpNeighbors !== undefined) {
        deviceUpdate["cdpNeighbors"] = cdpNeighbors.slice(0, 256);
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

      // An unreachable poll with no walk data leaves nothing worth writing.
      if (Object.keys(deviceUpdate).length > 0) {
        await NetworkDeviceService.updateOneById({
          id: deviceId,
          data: deviceUpdate as any,
          props: {
            isRoot: true,
          },
        });
      }

      if (walkedInterfaces.length > 0) {
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
            macAddress: walked.macAddress
              ? walked.macAddress.substring(0, 100)
              : null,
            interfaceType: walked.interfaceType ?? null,
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
            if (walked.macAddress) {
              newInterface.macAddress = walked.macAddress.substring(0, 100);
            }
            if (walked.interfaceType !== undefined) {
              newInterface.interfaceType = walked.interfaceType;
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
      }

      /*
       * --- Endpoint discovery (ARP/FDB) ---
       * Only when the walk carries the endpoint arrays — older probes omit
       * them and must flow through this function exactly as before. The
       * pure attachment logic strips uplink/self/transit MACs; the service
       * applies the FDB-over-ARP precedence rules per (project, MAC).
       */
      if (fdbEntries !== undefined || arpEntries !== undefined) {
        const endpointResult: EndpointAttachmentResult =
          EndpointAttachmentUtil.computeEndpointAttachments({
            deviceId: deviceId.toString(),
            fdbEntries: fdbEntries,
            arpEntries: arpEntries,
            lldpNeighbors: lldpNeighbors,
            cdpNeighbors: cdpNeighbors,
            interfaces: walkedInterfaces.map((walked: SnmpInterface) => {
              return {
                interfaceIndex: walked.interfaceIndex,
                name: walked.name,
                macAddress: walked.macAddress,
              };
            }),
          });

        if (
          endpointResult.attachments.length > 0 ||
          endpointResult.ipBindings.length > 0
        ) {
          await NetworkEndpointService.upsertDiscoveredEndpoints({
            projectId: data.monitor.projectId,
            deviceId: deviceId,
            deviceSiteId: ownedDevice.siteId,
            attachments: endpointResult.attachments,
            ipBindings: endpointResult.ipBindings,
            now: now,
          });
        }
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
