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
import { NetworkDeviceMonitoringMethodUtil } from "../../../Types/NetworkDevice/NetworkDeviceMonitoringMethod";
import { NetworkDevicePollMode } from "./NetworkDeviceHydrationUtil";
import logger from "../Logger";

/*
 * Keeps the NetworkDevice / NetworkInterface inventory in sync with each
 * device poll, then prunes the in-flight response down to MONITORED
 * interfaces so criteria and metrics only consider ports the user cares
 * about. Inventory rows always reflect every walked interface; the
 * isMonitored flag is user-owned and never overwritten here.
 *
 * Called from the device polling pipeline (NetworkDeviceWalkUtil): the
 * device's assigned probe pings it on the device's own schedule - and walks
 * it over SNMP as well when it has credentials - so this runs for every
 * registered device, credentials or not, and no Monitor is required.
 */
export default class NetworkInventoryUtil {
  public static async updateFromWalk(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    /*
     * The SNMP walk, when one ran (success or failure). Undefined on a
     * ping-only poll - never a synthesized failure.
     */
    snmpResponse: SnmpMonitorResponse | undefined;
    // Device reachability: answered ping OR the walk succeeded.
    isOnline: boolean | undefined;
    /*
     * How the probe polled. Absent from callers that predate ping-first
     * polling (the ingest processor stamps "snmp" for an old probe's walk),
     * and read as "snmp" when absent.
     */
    pollMode?: NetworkDevicePollMode | undefined;
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
          oidTemplateId: true,
          // For the monitor-backed guard on the poll columns below.
          monitoringMethod: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!ownedDevice) {
      return;
    }

    /*
     * A monitor-backed device (monitoringMethod "Monitor") is never meant to
     * be walked: nothing polls it and its bound Monitor's status owns
     * isReachable. But claimDevicesForPolling only excludes such rows at
     * CLAIM time, so a device claimed as SNMP and switched to Monitor before
     * its walk result arrived still lands here. Writing the poll verdict
     * then would overwrite the monitor's reachability with the last thing a
     * probe found before it stopped asking, and the two would fight on the
     * device list until the next status change. The poll and interface-count
     * columns are therefore withheld for such a row; everything else the
     * walk learned (system group, vendor, neighbors, interfaces, endpoints)
     * is still recorded, because it is inventory rather than health.
     */
    const isMonitorBacked: boolean =
      NetworkDeviceMonitoringMethodUtil.isMonitorBacked(
        ownedDevice.monitoringMethod,
      );

    if (isMonitorBacked) {
      logger.warn(
        `Network device ${deviceId.toString()} is monitor-backed (monitoringMethod "Monitor") but a poll result arrived for it - most likely it was switched off probe polling while a poll was in flight. Its bound monitor owns reachability, so lastPolledAt, isReachable, lastSeenAt, isSnmpReachable, lastSnmpSeenAt and the interface counts from this poll are not written.`,
      );
    }

    const pollMode: NetworkDevicePollMode = data.pollMode ?? "snmp";

    /*
     * Did a walk run, and did it succeed? Two separate questions, because a
     * ping-only poll runs no walk at all and must not read as a failed one:
     * the walk columns below go NULL for it, not false.
     *
     * A walk where the probe could not open the SNMP session reports
     * isOnline === false; treat anything else (success, or a walk that
     * reports no verdict at all) as succeeded - the same convention
     * isDeviceReachable uses further down.
     */
    const walkRan: boolean = data.snmpResponse !== undefined;
    const walkSucceeded: boolean =
      data.snmpResponse !== undefined && data.snmpResponse.isOnline !== false;

    /*
     * Inventory comes ONLY from a successful walk. A failed walk carries no
     * system group, no neighbours and no interfaces, and reading whatever a
     * malformed failure did carry would let it clear the LLDP snapshot or
     * rewrite sysName off a session that never really opened.
     */
    const walk: SnmpMonitorResponse | undefined = walkSucceeded
      ? data.snmpResponse
      : undefined;

    const walkedInterfaces: Array<SnmpInterface> = walk?.interfaces || [];
    const systemInfo: SnmpSystemInfo | undefined = walk?.systemInfo;
    const entityInfo: SnmpEntityInfo | undefined = walk?.entityInfo;
    const lldpNeighbors: Array<LldpNeighbor> | undefined = walk?.lldpNeighbors;
    const cdpNeighbors: Array<CdpNeighbor> | undefined = walk?.cdpNeighbors;
    const arpEntries: Array<ArpEntry> | undefined = walk?.arpEntries;
    const fdbEntries: Array<FdbEntry> | undefined = walk?.fdbEntries;

    const now: Date = OneUptimeDate.getCurrentDate();

    /*
     * A poll where the probe could not reach the device (no ping answer AND
     * no walk) reports isOnline === false; treat anything else (reachable,
     * or a poll that reports no reachability at all) as answered.
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
       *
       * Under ping-first polling the three answer for the DEVICE - "did it
       * answer ping or SNMP" - which is what the status pill shows. The
       * walk gets its own pair:
       *
       *   isSnmpReachable - the verdict of the last WALK: true/false when
       *                     one ran, NULL when none did (a ping-only poll)
       *                     or the device was never polled. NULL is the
       *                     whole point: a credential-less device is not
       *                     "SNMP down", it is "not walked".
       *   lastSnmpSeenAt  - when the walk last SUCCEEDED. Only moves on a
       *                     good walk, like lastSeenAt for the device.
       *
       * An old probe (no pollMode) only ever walked, and the processor
       * stamps its walk verdict as the device verdict, so both columns
       * carry the same value for it - never NULL for a credentialed device.
       *
       * None of the five is written for a monitor-backed device - see the
       * guard above the try.
       */
      if (!isMonitorBacked) {
        deviceUpdate["lastPolledAt"] = now;
        deviceUpdate["isReachable"] = isDeviceReachable;

        if (isDeviceReachable) {
          deviceUpdate["lastSeenAt"] = now;
        }

        deviceUpdate["isSnmpReachable"] = walkRan ? walkSucceeded : null;

        if (walkSucceeded) {
          deviceUpdate["lastSnmpSeenAt"] = now;
        }
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
       *
       * A device linked to an OID Collection Template is exempt outright.
       * Its effective list already comes from the template, and its own
       * snmpOids column is by design the small set of device-specific
       * ADDITIONS — usually empty, which is exactly the condition below.
       * Without this guard the first poll would write a vendor copy on top
       * of the template and the device would silently collect the union of
       * two sources, only one of which the operator can see or edit.
       */
      if (
        ownedDevice.autoApplyVendorHealthTemplate &&
        !ownedDevice.oidTemplateId &&
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

      /*
       * The cached interface counts are health columns too (the device list
       * and the site overview read interfacesDown), so a monitor-backed
       * device keeps them out for the same reason as the poll columns.
       *
       * On a ping-only poll they go NULL rather than staying put: a device
       * whose credentials were removed would otherwise keep showing the
       * interface counts of its last walk indefinitely, and the list would
       * read "3 interfaces down" on a device nothing is walking any more.
       * A failed walk in snmp mode, by contrast, leaves them alone - the
       * last good counts are the best estimate until the next good walk,
       * exactly as the lastWalkLog baseline is kept across failed polls.
       */
      if (!isMonitorBacked) {
        if (pollMode === "ping") {
          deviceUpdate["interfacesTotal"] = null;
          deviceUpdate["interfacesUp"] = null;
          deviceUpdate["interfacesDown"] = null;
        } else if (walkedInterfaces.length > 0) {
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
      }

      /*
       * Always non-empty for a probe-polled device: even a poll that
       * reached nothing has to record that we tried, or the staleness
       * backstop cannot tell a failing device from an unpolled one. Only
       * the monitor-backed case above can leave it empty, and then there
       * is genuinely nothing to write.
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
