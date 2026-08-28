import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkEndpointService from "../../Services/NetworkEndpointService";
import NetworkInterfaceService, {
  InterfaceWalkUpsertResult,
} from "../../Services/NetworkInterfaceService";
import SnmpInterface from "../../../Types/Monitor/SnmpMonitor/SnmpInterface";
import SnmpMonitorResponse from "../../../Types/Monitor/SnmpMonitor/SnmpMonitorResponse";
import LldpNeighbor from "../../../Types/Monitor/SnmpMonitor/LldpNeighbor";
import CdpNeighbor from "../../../Types/Monitor/SnmpMonitor/CdpNeighbor";
import ArpEntry from "../../../Types/Monitor/SnmpMonitor/ArpEntry";
import FdbEntry from "../../../Types/Monitor/SnmpMonitor/FdbEntry";
import EndpointAttachmentUtil, {
  EndpointAttachmentResult,
} from "../../../Utils/Monitor/EndpointAttachmentUtil";
import SnmpSystemInfo from "../../../Types/Monitor/SnmpMonitor/SnmpSystemInfo";
import SnmpEntityInfo from "../../../Types/Monitor/SnmpMonitor/SnmpEntityInfo";
import SnmpVendorTemplateUtil, {
  SnmpVendorTemplate,
} from "../../../Types/Monitor/SnmpMonitor/SnmpVendorTemplate";
import ObjectID from "../../../Types/ObjectID";
import OneUptimeDate from "../../../Types/Date";
import logger from "../Logger";

/*
 * Keeps the NetworkDevice / NetworkInterface inventory in sync with each
 * device walk, then prunes the in-flight response down to MONITORED
 * interfaces so criteria and metrics only consider ports the user cares
 * about. Inventory rows always reflect every walked interface; the
 * isMonitored flag is user-owned and never overwritten here.
 *
 * Called from the device polling pipeline (NetworkDeviceWalkUtil): the
 * device's assigned probe walks it on the device's own schedule, so this
 * runs for every registered device — no Monitor required.
 */
export default class NetworkInventoryUtil {
  public static async updateFromWalk(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    snmpResponse: SnmpMonitorResponse | undefined;
    isOnline: boolean | undefined;
  }): Promise<void> {
    const deviceId: ObjectID = data.deviceId;

    /*
     * Confirm the device belongs to the given project before writing
     * anything with isRoot — the walk pipeline resolves projectId from the
     * device row itself, but keep the guard so no future caller can cross
     * project boundaries.
     */
    const ownedDevice: NetworkDevice | null =
      await NetworkDeviceService.findOneBy({
        query: {
          _id: deviceId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          siteId: true,
          // For the vendor-template auto-apply below.
          autoApplyVendorHealthTemplate: true,
          snmpOids: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!ownedDevice) {
      return;
    }

    const walkedInterfaces: Array<SnmpInterface> =
      data.snmpResponse?.interfaces || [];
    const systemInfo: SnmpSystemInfo | undefined =
      data.snmpResponse?.systemInfo;
    const entityInfo: SnmpEntityInfo | undefined =
      data.snmpResponse?.entityInfo;
    const lldpNeighbors: Array<LldpNeighbor> | undefined =
      data.snmpResponse?.lldpNeighbors;
    const cdpNeighbors: Array<CdpNeighbor> | undefined =
      data.snmpResponse?.cdpNeighbors;
    const arpEntries: Array<ArpEntry> | undefined =
      data.snmpResponse?.arpEntries;
    const fdbEntries: Array<FdbEntry> | undefined =
      data.snmpResponse?.fdbEntries;

    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * A poll where the probe could not reach the device reports
     * isOnline === false; treat anything else (reachable, or a walk that
     * reports no reachability at all) as answered.
     */
    const isDeviceReachable: boolean = data.isOnline !== false;

    try {
      // --- Device enrichment + cached counts ---
      const deviceUpdate: Record<string, unknown> = {};

      /*
       * Three columns, three different questions, and the difference
       * between them is the whole reason a reachable device used to show as
       * down:
       *
       *   lastPolledAt - when we last ASKED. Always stamped, success or
       *                  failure. Without it there is no way to tell a
       *                  device that did not answer from one nothing got
       *                  round to polling, which is what made a fleet
       *                  bigger than one probe's claim rate read as a
       *                  fleet-wide outage.
       *   isReachable  - what the answer WAS. This is what the device list,
       *                  the topology graph and the site rollup read.
       *   lastSeenAt   - when the device last ANSWERED. Only moves on a
       *                  successful walk, so it stays honest as "last
       *                  contact" and never paints a dead device green.
       */
      deviceUpdate["lastPolledAt"] = now;
      deviceUpdate["isReachable"] = isDeviceReachable;

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

      /*
       * Vendor health template auto-apply — the automatic counterpart of the
       * dashboard's vendor-template banner, for devices that opted in
       * (auto-imported devices do; hand-made ones keep the manual flow).
       *
       * Deliberately narrow: only when the device has NO health OIDs at all.
       * An existing list — template-seeded and pruned, or hand-built — is
       * the operator's, and a poll must never edit it. That also makes this
       * one-shot in practice: the first poll that fingerprints the vendor
       * seeds the list, and every later poll sees a non-empty list and
       * leaves it alone (including after the operator empties it on purpose
       * AND turns the toggle off; with the toggle still on, an emptied list
       * re-seeds next poll, which is what "auto-apply" says on the tin).
       */
      if (
        ownedDevice.autoApplyVendorHealthTemplate &&
        (ownedDevice.snmpOids || []).length === 0 &&
        systemInfo?.sysObjectId
      ) {
        const vendorTemplate: SnmpVendorTemplate | undefined =
          SnmpVendorTemplateUtil.matchBySysObjectId(systemInfo.sysObjectId);

        if (vendorTemplate) {
          deviceUpdate["snmpOids"] = SnmpVendorTemplateUtil.mergeOids(
            [],
            vendorTemplate.id,
          );
          logger.debug(
            `Auto-applied the "${vendorTemplate.label}" vendor health template to network device ${deviceId.toString()} (sysObjectID ${systemInfo.sysObjectId}).`,
          );
        }
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

      /*
       * Always non-empty now: even a walk that reached nothing has to
       * record that we tried, or the staleness backstop cannot tell a
       * failing device from an unpolled one.
       */
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
        /*
         * --- Interface upsert ---
         * One SELECT plus one batched INSERT/UPDATE per 500 rows, inside the
         * service. This was a per-interface create()/updateOneById() loop —
         * 101 statements for a 50-port switch, because _updateBy SELECTs
         * before every UPDATE — which is a hard wall once an operator raises
         * DEVICE_POLL_FETCH_LIMIT and the fleet actually polls on its
         * configured interval. Interfaces that exist in inventory but were
         * NOT in this walk are still left exactly as they were: nothing here
         * deletes or ages them out.
         */
        const upsertResult: InterfaceWalkUpsertResult =
          await NetworkInterfaceService.upsertWalkedInterfaces({
            projectId: data.projectId,
            deviceId: deviceId,
            walkedInterfaces: walkedInterfaces,
            now: now,
          });

        const unmonitoredIndexes: Set<number> = new Set(
          upsertResult.unmonitoredInterfaceIndexes,
        );

        /*
         * Prune the in-flight response to monitored interfaces only, so
         * criteria (interface down / utilization / errors) and per-interface
         * metrics ignore ports the user muted. The inventory above keeps the
         * full picture.
         */
        if (unmonitoredIndexes.size > 0 && data.snmpResponse) {
          data.snmpResponse.interfaces = walkedInterfaces.filter(
            (walked: SnmpInterface) => {
              return !unmonitoredIndexes.has(walked.interfaceIndex);
            },
          );
        }
      }

      /*
       * --- Endpoint discovery (ARP/FDB) ---
       * Only when the walk carries the endpoint arrays — walks with endpoint
       * collection off omit them and must flow through this function exactly
       * as before. The pure attachment logic strips uplink/self/transit
       * MACs; the service applies the FDB-over-ARP precedence rules per
       * (project, MAC).
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
            projectId: data.projectId,
            deviceId: deviceId,
            deviceSiteId: ownedDevice.siteId,
            attachments: endpointResult.attachments,
            ipBindings: endpointResult.ipBindings,
            now: now,
          });
        }
      }
    } catch (err) {
      // Inventory bookkeeping must never fail the walk pipeline.
      logger.error(
        `Failed to update network inventory for device ${deviceId.toString()}:`,
      );
      logger.error(err);
    }
  }
}
