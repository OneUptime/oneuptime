import NetworkTrafficUsage from "../../../Models/AnalyticsModels/NetworkTrafficUsage";
import NetworkControllerConnection from "../../../Models/DatabaseModels/NetworkControllerConnection";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { MAX_NETWORK_TRAFFIC_RANGE_DAYS } from "../../../Types/NetFlow/NetworkTraffic";
import {
  LINKABLE_APPLIANCE_DAYS,
  MAX_LIKELY_APPLIANCES,
  MAX_LINKABLE_APPLIANCES,
  MAX_LISTED_APPLIANCES,
  NetworkControllerApplianceLinkRequest,
  NetworkControllerApplianceListRequest,
  NetworkControllerApplianceUnlinkRequest,
  NetworkControllerLinkableAppliance,
  NetworkControllerLinkableApplianceList,
} from "../../../Types/NetworkController/NetworkControllerApplianceLink";
import ObjectID from "../../../Types/ObjectID";
import {
  NameLikeness,
  getNameLikeness,
  isLikelyName,
  toSerialKey,
} from "../../../Utils/NetworkDevice/DeviceNameLikeness";
import {
  NetworkDeviceDiscoveredDetails,
  NetworkDeviceDiscoveredField,
  NetworkDeviceControllerField,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import NetworkControllerConnectionService from "../../Services/NetworkControllerConnectionService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import NetworkTrafficUsageAggregationService, {
  NetworkTrafficUsageApplianceRow,
  NetworkTrafficUsageRefile,
} from "../../Services/NetworkTrafficUsageAggregationService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import NetworkTrafficSummaryUtil from "../NetworkFlow/NetworkTrafficSummary";
import TelemetryReadAccess from "../Telemetry/TelemetryReadAccess";
import { TelemetryReadScope } from "../Telemetry/TelemetryReadScope";
import NetworkControllerDeviceMatcher, {
  NetworkControllerDeviceMatches,
} from "./NetworkControllerDeviceMatcher";

/*
 * LINKING A DEVICE TO THE MERAKI APPLIANCE IT IS, ON THE SERVER (issue
 * #5762; Types/NetworkController/NetworkControllerApplianceLink says why).
 *
 * Every step runs as the person, never past what they may do:
 *
 *   - the device must be one they may read (404 otherwise);
 *   - the appliances listed are those whose traffic they may read - the
 *     project's bucket for a project-wide reader, the devices they may read
 *     otherwise - under the same read scope the Traffic pages apply;
 *   - the link is the serial number written on the device by the person's
 *     own update, so whoever may not change a device's serial number may
 *     not link one (ColumnPermission refuses it).
 *
 * Then, as the server: the traffic already stored for the appliance is
 * filed under the device (NetworkTrafficUsageAggregationService.refile), so
 * the device's page, its site's and the network's page narrowed to the
 * appliance add up to the same numbers at once - for the 31 days kept, not
 * only from the next read. A refile that cannot be made now is made by the
 * connection's next read (NetworkControllerReadRunner files whatever was
 * matched since its last read), so the link never fails for it.
 *
 * Reused by whatever else ties a device to a controller's device: the
 * ranking is pure (rankLinkableAppliances), and the names a device is known
 * by are read in one place (getDeviceNames).
 */

// What a link or an unlink answers.
export interface NetworkControllerApplianceLinkOutcome {
  deviceSerial: string;
  // Whether stored traffic was filed under the device (or back) at once.
  isRefiled: boolean;
}

// The names and serial numbers a device is known by, for the likeness.
export interface LinkableDeviceIdentity {
  id: string;
  names: Array<string>;
  serials: Array<string>;
  // The serial number on the device itself: a link's, its walk's, Add devices'.
  serialNumber: string;
}

// How far back stored traffic is filed: all the table keeps.
function getRefileSince(now: Date): Date {
  return OneUptimeDate.addRemoveDays(
    now,
    -(MAX_NETWORK_TRAFFIC_RANGE_DAYS + 1),
  );
}

function compareNames(a: string, b: string): number {
  return a.localeCompare(b, undefined, {
    numeric: true,
    sensitivity: "base",
  });
}

/*
 * The appliances to offer, as "Link to a Meraki appliance" lists them
 * (pure): every one reported, each saying whether a device here is it
 * already; the likely ones first - names like the device's, at most
 * MAX_LIKELY_APPLIANCES, none another device is already - then the rest by
 * name, numbers in their order ("Store 2" before "Store 10"); narrowed to the
 * search when there is one (a part of its name, serial number, network or
 * connection, case aside), at most MAX_LISTED_APPLIANCES of them.
 */
export function rankLinkableAppliances(data: {
  device: LinkableDeviceIdentity;
  projectId: string;
  rows: Array<NetworkTrafficUsageApplianceRow>;
  connectionNames: Map<string, string>;
  linkedDeviceNames: Map<string, string>;
  search: string;
}): NetworkControllerLinkableApplianceList {
  const projectId: string = data.projectId.toLowerCase();
  const search: string = data.search.trim().toLowerCase();

  const scored: Array<{
    appliance: NetworkControllerLinkableAppliance;
    likeness: NameLikeness;
  }> = data.rows.map(
    (
      row: NetworkTrafficUsageApplianceRow,
    ): {
      appliance: NetworkControllerLinkableAppliance;
      likeness: NameLikeness;
    } => {
      const deviceKey: string = row.networkDeviceId.toLowerCase();
      const isLinked: boolean = Boolean(deviceKey) && deviceKey !== projectId;
      const likeness: NameLikeness = getNameLikeness({
        names: data.device.names,
        serials: data.device.serials,
        otherNames: [row.name, row.controllerNetworkName],
        otherSerial: row.serial,
      });

      return {
        likeness,
        appliance: {
          serial: row.serial,
          name: row.name,
          controllerNetworkId: row.controllerNetworkId,
          controllerNetworkName: row.controllerNetworkName,
          connectionName: data.connectionNames.get(row.connectionId) || "",
          lastSeenAt: row.lastWindowEndAt,
          octets: row.octets,
          ...(isLinked
            ? {
                linkedDeviceId: deviceKey,
                ...(data.linkedDeviceNames.get(deviceKey)
                  ? { linkedDeviceName: data.linkedDeviceNames.get(deviceKey) }
                  : {}),
              }
            : {}),
          isLikely: false,
        },
      };
    },
  );

  // The likely ones: alike enough, and not another device's already.
  const likely: Array<{
    appliance: NetworkControllerLinkableAppliance;
    likeness: NameLikeness;
  }> = scored
    .filter(
      (entry: {
        appliance: NetworkControllerLinkableAppliance;
        likeness: NameLikeness;
      }): boolean => {
        return (
          isLikelyName(entry.likeness) &&
          (!entry.appliance.linkedDeviceId ||
            entry.appliance.linkedDeviceId === data.device.id.toLowerCase())
        );
      },
    )
    .sort(
      (
        a: {
          appliance: NetworkControllerLinkableAppliance;
          likeness: NameLikeness;
        },
        b: {
          appliance: NetworkControllerLinkableAppliance;
          likeness: NameLikeness;
        },
      ): number => {
        return (
          b.likeness.score - a.likeness.score ||
          b.appliance.octets - a.appliance.octets ||
          compareNames(a.appliance.name, b.appliance.name)
        );
      },
    )
    .slice(0, MAX_LIKELY_APPLIANCES);

  for (const entry of likely) {
    entry.appliance.isLikely = true;

    if (entry.likeness.reason) {
      entry.appliance.likenessReason = entry.likeness.reason;
    }

    if (entry.likeness.shared) {
      entry.appliance.likenessShared = entry.likeness.shared;
    }
  }

  const rest: Array<NetworkControllerLinkableAppliance> = scored
    .filter(
      (entry: {
        appliance: NetworkControllerLinkableAppliance;
        likeness: NameLikeness;
      }): boolean => {
        return !entry.appliance.isLikely;
      },
    )
    .map(
      (entry: {
        appliance: NetworkControllerLinkableAppliance;
        likeness: NameLikeness;
      }): NetworkControllerLinkableAppliance => {
        return entry.appliance;
      },
    )
    .sort(
      (
        a: NetworkControllerLinkableAppliance,
        b: NetworkControllerLinkableAppliance,
      ): number => {
        return (
          compareNames(a.name || a.serial, b.name || b.serial) ||
          compareNames(a.serial, b.serial)
        );
      },
    );

  const ordered: Array<NetworkControllerLinkableAppliance> = [
    ...likely.map(
      (entry: {
        appliance: NetworkControllerLinkableAppliance;
        likeness: NameLikeness;
      }): NetworkControllerLinkableAppliance => {
        return entry.appliance;
      },
    ),
    ...rest,
  ];

  const matching: Array<NetworkControllerLinkableAppliance> = search
    ? ordered.filter(
        (appliance: NetworkControllerLinkableAppliance): boolean => {
          return [
            appliance.name,
            appliance.serial,
            appliance.controllerNetworkName,
            appliance.connectionName,
          ].some((text: string): boolean => {
            return text.toLowerCase().includes(search);
          });
        },
      )
    : ordered;

  return {
    appliances: matching.slice(0, MAX_LISTED_APPLIANCES),
    total: ordered.length,
    matching: matching.length,
  };
}

export default class NetworkControllerApplianceLink {
  /*
   * The names a device is known by, for the likeness: its name, its system
   * name (its own, or the one a scan read), the name Meraki's record of it
   * gives, and its host name - which the likeness leaves out when it is an
   * address. And its serial numbers: its own and Meraki's record's.
   */
  public static getDeviceIdentity(
    device: NetworkDevice,
  ): LinkableDeviceIdentity {
    const details: NetworkDeviceDiscoveredDetails =
      readNetworkDeviceDiscoveredDetails(device.discoveredDetails);
    const controllerValues: Partial<
      Record<NetworkDeviceControllerField, string>
    > = details.controller?.values || {};
    const serialNumber: string = toSerialKey(device.serialNumber);

    return {
      id: device.id?.toString() || "",
      names: [
        device.name || "",
        device.sysName || "",
        details.values[NetworkDeviceDiscoveredField.SystemName]?.value || "",
        controllerValues[NetworkDeviceControllerField.Name] || "",
        device.hostname || "",
      ].filter(Boolean),
      serials: [
        serialNumber,
        toSerialKey(
          controllerValues[NetworkDeviceControllerField.SerialNumber],
        ),
      ].filter(Boolean),
      serialNumber,
    };
  }

  // The device, if the caller may read it - and its identity, read as the server.
  private static async findDevice(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    deviceId: ObjectID;
  }): Promise<NetworkDevice> {
    const readable: NetworkDevice | null = await NetworkDeviceService.findOneBy(
      {
        query: { _id: data.deviceId, projectId: data.projectId },
        select: { _id: true },
        props: data.props,
      },
    );

    if (!readable || !readable.id) {
      throw new NotFoundException("Network device not found");
    }

    const device: NetworkDevice | null = await NetworkDeviceService.findOneBy({
      query: { _id: data.deviceId, projectId: data.projectId },
      select: {
        _id: true,
        name: true,
        hostname: true,
        sysName: true,
        serialNumber: true,
        discoveredDetails: true,
      },
      props: { isRoot: true },
    });

    if (!device || !device.id) {
      throw new NotFoundException("Network device not found");
    }

    return device;
  }

  private static getProjectId(props: DatabaseCommonInteractionProps): ObjectID {
    if (!props.tenantId) {
      throw new BadDataException("Project not found in request");
    }

    return props.tenantId;
  }

  // The connections the caller may read: none, nothing to link to.
  private static async findConnections(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
  }): Promise<Array<NetworkControllerConnection>> {
    try {
      return await NetworkControllerConnectionService.findBy({
        query: { projectId: data.projectId },
        select: { _id: true, name: true, config: true },
        skip: 0,
        limit: 100,
        props: data.props,
      });
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        return [];
      }

      throw error;
    }
  }

  // The appliances reported lately whose traffic the caller may read.
  private static async findAppliances(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    now: Date;
    serials?: Array<string> | undefined;
  }): Promise<Array<NetworkTrafficUsageApplianceRow>> {
    const readScope: TelemetryReadScope = await TelemetryReadAccess.getScope(
      NetworkTrafficUsage,
      data.props,
    );

    return await NetworkTrafficUsageAggregationService.getAppliances({
      projectId: data.projectId,
      devices: NetworkTrafficSummaryUtil.getDeviceFilter(readScope, null),
      since: OneUptimeDate.addRemoveDays(data.now, -LINKABLE_APPLIANCE_DAYS),
      serials: data.serials,
      limit: data.serials
        ? Math.max(1, data.serials.length)
        : MAX_LINKABLE_APPLIANCES,
    });
  }

  // The names of these devices the caller may read, by lower-case ID.
  private static async findDeviceNames(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    deviceIds: Array<string>;
  }): Promise<Map<string, string>> {
    const ids: Array<string> = Array.from(
      new Set(
        data.deviceIds
          .map((id: string): string => {
            return id.toLowerCase();
          })
          .filter((id: string): boolean => {
            return (
              ObjectID.isValidUUID(id) &&
              id !== data.projectId.toString().toLowerCase()
            );
          }),
      ),
    );

    const names: Map<string, string> = new Map();

    if (ids.length === 0) {
      return names;
    }

    try {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: { projectId: data.projectId, _id: QueryHelper.any(ids) },
        select: { _id: true, name: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: data.props,
      });

      for (const device of devices) {
        if (device.id && device.name) {
          names.set(device.id.toString().toLowerCase(), device.name);
        }
      }
    } catch (error) {
      // A name the caller may not read is left out, never a failed list.
      if (!(error instanceof NotAuthorizedException)) {
        throw error;
      }
    }

    return names;
  }

  public static async listAppliances(data: {
    props: DatabaseCommonInteractionProps;
    request: NetworkControllerApplianceListRequest;
    now: Date;
  }): Promise<NetworkControllerLinkableApplianceList> {
    const projectId: ObjectID = NetworkControllerApplianceLink.getProjectId(
      data.props,
    );
    const device: NetworkDevice =
      await NetworkControllerApplianceLink.findDevice({
        props: data.props,
        projectId,
        deviceId: data.request.networkDeviceId,
      });

    const connections: Array<NetworkControllerConnection> =
      await NetworkControllerApplianceLink.findConnections({
        props: data.props,
        projectId,
      });

    if (connections.length === 0) {
      return { appliances: [], total: 0, matching: 0 };
    }

    const rows: Array<NetworkTrafficUsageApplianceRow> =
      await NetworkControllerApplianceLink.findAppliances({
        props: data.props,
        projectId,
        now: data.now,
      });

    const connectionNames: Map<string, string> = new Map(
      connections.map(
        (connection: NetworkControllerConnection): [string, string] => {
          return [connection.id?.toString() || "", connection.name || ""];
        },
      ),
    );

    const linkedDeviceNames: Map<string, string> =
      await NetworkControllerApplianceLink.findDeviceNames({
        props: data.props,
        projectId,
        deviceIds: rows.map((row: NetworkTrafficUsageApplianceRow): string => {
          return row.networkDeviceId;
        }),
      });

    return rankLinkableAppliances({
      device: NetworkControllerApplianceLink.getDeviceIdentity(device),
      projectId: projectId.toString(),
      rows,
      connectionNames,
      linkedDeviceNames,
      search: data.request.search,
    });
  }

  public static async link(data: {
    props: DatabaseCommonInteractionProps;
    request: NetworkControllerApplianceLinkRequest;
    now: Date;
  }): Promise<NetworkControllerApplianceLinkOutcome> {
    const projectId: ObjectID = NetworkControllerApplianceLink.getProjectId(
      data.props,
    );
    const serial: string = data.request.deviceSerial;
    const device: NetworkDevice =
      await NetworkControllerApplianceLink.findDevice({
        props: data.props,
        projectId,
        deviceId: data.request.networkDeviceId,
      });
    const deviceId: ObjectID = device.id!;
    const deviceKey: string = deviceId.toString().toLowerCase();

    const [appliance]: Array<NetworkTrafficUsageApplianceRow> =
      await NetworkControllerApplianceLink.findAppliances({
        props: data.props,
        projectId,
        now: data.now,
        serials: [serial],
      });

    if (!appliance) {
      throw new BadDataException(
        `No Meraki connection of this project reported an appliance with serial number ${serial} in the last ${LINKABLE_APPLIANCE_DAYS} days.`,
      );
    }

    // One appliance is one device: another device that is it already says so.
    const ownerKey: string = appliance.networkDeviceId.toLowerCase();

    if (
      ownerKey &&
      ownerKey !== projectId.toString().toLowerCase() &&
      ownerKey !== deviceKey
    ) {
      throw new BadDataException(
        await NetworkControllerApplianceLink.getTakenMessage({
          props: data.props,
          projectId,
          ownerId: ownerKey,
        }),
      );
    }

    const holders: Array<NetworkDevice> = await NetworkDeviceService.findBy({
      query: {
        projectId,
        serialNumber: QueryHelper.any([serial, serial.toLowerCase()]),
      },
      select: { _id: true },
      skip: 0,
      limit: 10,
      props: { isRoot: true },
    });
    const otherHolder: NetworkDevice | undefined = holders.find(
      (holder: NetworkDevice): boolean => {
        return holder.id?.toString().toLowerCase() !== deviceKey;
      },
    );

    if (otherHolder?.id) {
      throw new BadDataException(
        await NetworkControllerApplianceLink.getTakenMessage({
          props: data.props,
          projectId,
          ownerId: otherHolder.id.toString(),
        }),
      );
    }

    const currentSerial: string = toSerialKey(device.serialNumber);

    if (currentSerial && currentSerial !== serial) {
      throw new BadDataException(
        `This device has the serial number ${currentSerial} already. A device is one appliance: unlink it first.`,
      );
    }

    if (currentSerial !== serial) {
      // As the person: whoever may not change a device's serial number may not link it.
      await NetworkDeviceService.updateOneById({
        id: deviceId,
        data: { serialNumber: serial },
        props: data.props,
      });
    }

    const isRefiled: boolean = await NetworkControllerApplianceLink.fileUnder({
      projectId,
      deviceId,
      appliance,
      now: data.now,
    });

    return { deviceSerial: serial, isRefiled };
  }

  public static async unlink(data: {
    props: DatabaseCommonInteractionProps;
    request: NetworkControllerApplianceUnlinkRequest;
    now: Date;
  }): Promise<NetworkControllerApplianceLinkOutcome> {
    const projectId: ObjectID = NetworkControllerApplianceLink.getProjectId(
      data.props,
    );
    const device: NetworkDevice =
      await NetworkControllerApplianceLink.findDevice({
        props: data.props,
        projectId,
        deviceId: data.request.networkDeviceId,
      });
    const deviceId: ObjectID = device.id!;
    const serial: string = toSerialKey(device.serialNumber);

    if (!serial) {
      throw new BadDataException(
        "This device is not linked to a Meraki appliance by its serial number.",
      );
    }

    // As the person, as the link was made.
    await NetworkDeviceService.updateOneById({
      id: deviceId,
      data: { serialNumber: null },
      props: data.props,
    });

    let isRefiled: boolean = false;

    try {
      // Its traffic back where an appliance no device is keeps it: the network's page.
      const networks: Array<string> = (
        await NetworkTrafficUsageAggregationService.getAppliances({
          projectId,
          devices: {},
          since: OneUptimeDate.addRemoveDays(
            data.now,
            -LINKABLE_APPLIANCE_DAYS,
          ),
          serials: [serial],
          limit: 1,
        })
      )
        .map((row: NetworkTrafficUsageApplianceRow): string => {
          return row.controllerNetworkId;
        })
        .filter(Boolean);

      isRefiled = await NetworkTrafficUsageAggregationService.refile(
        {
          projectId,
          fromDeviceId: deviceId,
          appliances: [{ serial, deviceId: projectId }],
          networks: networks.map(
            (
              controllerNetworkId: string,
            ): { controllerNetworkId: string; deviceId: ObjectID } => {
              return { controllerNetworkId, deviceId: projectId };
            },
          ),
          since: getRefileSince(data.now),
        },
        NetworkTrafficUsageAggregationService.getStorageTable(),
      );
    } catch (error) {
      logger.error(
        `Network device ${deviceId.toString()}: the traffic of appliance ${serial} could not be returned to the network's page: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }

    return { deviceSerial: serial, isRefiled };
  }

  /*
   * The traffic already stored for an appliance a device was just linked
   * to, filed under the device: its uplinks, and its network's
   * applications and clients when the device is the network's appliance
   * they go to (the matcher's own rule: its first matched appliance, by
   * serial). Never fails the link: the next read files what this could not.
   */
  public static async fileUnder(data: {
    projectId: ObjectID;
    deviceId: ObjectID;
    appliance: NetworkTrafficUsageApplianceRow;
    now: Date;
  }): Promise<boolean> {
    try {
      const networkAppliances: Array<NetworkTrafficUsageApplianceRow> = data
        .appliance.controllerNetworkId
        ? await NetworkTrafficUsageAggregationService.getAppliances({
            projectId: data.projectId,
            devices: {},
            since: OneUptimeDate.addRemoveDays(
              data.now,
              -LINKABLE_APPLIANCE_DAYS,
            ),
            controllerNetworkIds: [data.appliance.controllerNetworkId],
            limit: MAX_LINKABLE_APPLIANCES,
          })
        : [data.appliance];

      const matches: NetworkControllerDeviceMatches =
        await NetworkControllerDeviceMatcher.match({
          projectId: data.projectId,
          appliances: networkAppliances.map(
            (row: NetworkTrafficUsageApplianceRow) => {
              return {
                serial: row.serial,
                name: row.name,
                model: "",
                mac: "",
                controllerNetworkId: row.controllerNetworkId,
              };
            },
          ),
        });

      const ownsNetwork: boolean =
        matches.byNetwork
          .get(data.appliance.controllerNetworkId)
          ?.toString() === data.deviceId.toString();

      const refile: NetworkTrafficUsageRefile = {
        projectId: data.projectId,
        fromDeviceId: data.projectId,
        appliances: [
          { serial: data.appliance.serial, deviceId: data.deviceId },
        ],
        networks:
          ownsNetwork && data.appliance.controllerNetworkId
            ? [
                {
                  controllerNetworkId: data.appliance.controllerNetworkId,
                  deviceId: data.deviceId,
                },
              ]
            : [],
        since: getRefileSince(data.now),
      };

      return await NetworkTrafficUsageAggregationService.refile(
        refile,
        NetworkTrafficUsageAggregationService.getStorageTable(),
      );
    } catch (error) {
      logger.error(
        `Network device ${data.deviceId.toString()}: the stored traffic of appliance ${data.appliance.serial} could not be filed under it now; the connection's next read files it: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );

      return false;
    }
  }

  // Why an appliance another device is already cannot be linked: that device, when it may be named.
  private static async getTakenMessage(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    ownerId: string;
  }): Promise<string> {
    const names: Map<string, string> =
      await NetworkControllerApplianceLink.findDeviceNames({
        props: data.props,
        projectId: data.projectId,
        deviceIds: [data.ownerId],
      });
    const name: string | undefined = names.get(data.ownerId.toLowerCase());

    return name
      ? `This appliance is linked to ${name} already. Unlink it there first.`
      : "This appliance is linked to another device already. Unlink it there first.";
  }
}
