import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import {
  DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY,
  NetworkDeviceControllerLink,
  NetworkDeviceControllerLinks,
  NetworkDeviceDiscoveryReader,
  NetworkDeviceDiscoveryReaderType,
  buildControllerLinks,
  readNetworkDeviceDiscoveredDetails,
} from "../../../Types/NetworkDevice/NetworkDeviceDiscoveredDetails";
import ObjectID from "../../../Types/ObjectID";
import {
  MacLearningIpBinding,
  siteKeyOf,
} from "../../../Utils/Monitor/DeviceMacLearningUtil";
import { normalizeMac } from "../../../Utils/Monitor/EndpointAttachmentUtil";
import NetworkDeviceService, {
  DiscoveredDetailsMerge,
} from "../../Services/NetworkDeviceService";
import NetworkEndpointService, {
  EndpointControllerClient,
} from "../../Services/NetworkEndpointService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import NetworkDeviceMacLearningUtil from "../Monitor/NetworkDeviceMacLearningUtil";
import {
  ControllerInventoryCandidate,
  ControllerInventoryConnection,
  ControllerInventoryMatch,
  ControllerMatchRule,
  MergeControllerReadingsFunction,
} from "./NetworkControllerInventory";
import {
  NetworkControllerClient,
  NetworkControllerDevice,
  NetworkControllerLink,
  NetworkControllerLinkEnd,
} from "./NetworkControllerTypes";

/*
 * WHAT A NETWORK CONTROLLER SAYS IS PLUGGED INTO WHAT (OneUptime issue
 * #5379).
 *
 * A store's kitchen displays answer ping and nothing else, so nothing they
 * report can place them, and a Meraki switch's own SNMP agent is not
 * documented to carry a forwarding table. The map drew them floating, under
 * "Not linked to anything", though the dashboard that manages the switch
 * knows exactly which port each is on. It also knows the cable from the
 * switch to the MX, which is the one customers were drawing by hand.
 *
 * A read of a connection already holds both (MerakiClientList,
 * MerakiLinkLayer). This records them in the shapes the map already reads,
 * so nothing downstream learns anything about Meraki:
 *
 *   1. CLIENTS become NetworkEndpoint rows, attached to the device the
 *      switch is (NetworkEndpointService.upsertControllerClients). From
 *      there the topology builder's adoption finds the kitchen display by
 *      its MAC, or by its address within the site, exactly as it would have
 *      from a walked forwarding table, and a client that is no device here
 *      is drawn as an endpoint.
 *
 *      A wired client always gets its row: it is what the switch has on the
 *      port. A Wi-Fi client gets one only when it IS a device here. A store's
 *      guest network is thousands of phones a week, each with a new random
 *      MAC, and none of them belongs on a map or in a table nothing prunes.
 *
 *   2. CLIENT ADDRESSES teach a device its MAC (NetworkDeviceMacLearningUtil,
 *      by the same refusals as a router's ARP table), so a display keeps its
 *      cable overnight: an address match needs a current sighting, because
 *      addresses are re-leased, and a MAC match does not.
 *
 *   3. LINKS become a reading in each device's discovered details, under a
 *      key of their own, replaced whole. The map reads it beside what the
 *      device's walk reported.
 *
 * WHICH DEVICE IS WHICH is NetworkControllerInventory's answer, read once for
 * the read: the same match that gives a device its details gives it its
 * clients and its links. A client on a Meraki device that is no device here
 * has nothing to hang from, so it is counted, and the connection says which
 * devices to add.
 *
 * The planning is pure, so every rule above is tested without a database;
 * `record` does the reads and the writes. A failure is the read runner's to
 * catch: it never costs the read its traffic.
 */

// Addresses and MACs one lookup of the project's devices asks about.
const DEVICE_LOOKUP_CHUNK_SIZE: number = 500;

// A device here that a Meraki device is: what a client or a link hangs from.
export interface ControllerPlacedDevice {
  id: string;
  siteId?: string | undefined;
}

// A device of the project that a Wi-Fi client might be.
export interface ControllerClientCandidate {
  macAddress?: string | null | undefined;
  hostname?: string | null | undefined;
  siteId?: string | null | undefined;
}

export interface ControllerClientPlacement {
  client: NetworkControllerClient;
  device: ControllerPlacedDevice;
}

export interface ControllerPlacementPlan {
  placements: Array<ControllerClientPlacement>;
  // Meraki devices with clients on them that are no device here.
  unplacedDeviceCount: number;
}

export interface ControllerLinkPlan {
  patches: Array<DiscoveredDetailsMerge>;
  // Devices that have links in this read.
  linkedDeviceCount: number;
}

// The strongest match first: a serial number outranks a MAC, a MAC a name.
const MATCH_RULE_ORDER: ReadonlyArray<ControllerMatchRule> = [
  ControllerMatchRule.SerialNumber,
  ControllerMatchRule.MacAddress,
  ControllerMatchRule.AddressAndName,
];

/*
 * Which device here each Meraki device is, by serial number. Two devices here
 * can be one Meraki device - a duplicate someone added by hand - and a client
 * can hang from only one: the stronger match, then the lower id, so the
 * answer never depends on the order the rows came back in.
 */
export function getPlacedDevicesBySerial(data: {
  matches: Map<string, ControllerInventoryMatch>;
  candidates: Array<ControllerInventoryCandidate>;
}): Map<string, ControllerPlacedDevice> {
  const siteIdByDeviceId: Map<string, string | undefined> = new Map();

  for (const candidate of data.candidates) {
    siteIdByDeviceId.set(candidate.id, candidate.siteId?.toString());
  }

  const chosen: Map<string, { id: string; match: ControllerInventoryMatch }> =
    new Map();

  for (const [id, match] of data.matches) {
    const held: { id: string; match: ControllerInventoryMatch } | undefined =
      chosen.get(match.device.serial);
    const rank: number = MATCH_RULE_ORDER.indexOf(match.rule);
    const heldRank: number = held
      ? MATCH_RULE_ORDER.indexOf(held.match.rule)
      : Number.POSITIVE_INFINITY;

    if (rank < heldRank || (rank === heldRank && held && id < held.id)) {
      chosen.set(match.device.serial, { id, match });
    }
  }

  const placed: Map<string, ControllerPlacedDevice> = new Map();

  for (const [serial, entry] of chosen) {
    placed.set(serial, {
      id: entry.id,
      siteId: siteIdByDeviceId.get(entry.id),
    });
  }

  return placed;
}

function managedAddressKey(
  address: string,
  siteId: string | null | undefined,
): string {
  return `${siteKeyOf(siteId)}\u0000${address}`;
}

/**
 * Which clients go where, by the rules in the header. Pure. A Meraki device's
 * own MAC is never a client of anything, whatever a list says.
 */
export function planClientPlacements(data: {
  clients: Array<NetworkControllerClient>;
  devices: Array<NetworkControllerDevice>;
  placedDevices: Map<string, ControllerPlacedDevice>;
  managedDevices: Array<ControllerClientCandidate>;
}): ControllerPlacementPlan {
  const ownMacs: Set<string> = new Set<string>();

  for (const device of data.devices) {
    if (device.mac) {
      ownMacs.add(device.mac);
    }
  }

  const managedMacs: Set<string> = new Set<string>();
  const managedAddresses: Set<string> = new Set<string>();

  for (const device of data.managedDevices) {
    const mac: string | undefined = normalizeMac(
      device.macAddress || undefined,
    );

    if (mac) {
      managedMacs.add(mac);
    }

    const hostname: string = (device.hostname || "").trim();

    if (hostname) {
      managedAddresses.add(managedAddressKey(hostname, device.siteId));
    }
  }

  const placements: Array<ControllerClientPlacement> = [];
  const unplacedSerials: Set<string> = new Set<string>();

  for (const client of data.clients) {
    if (ownMacs.has(client.mac)) {
      continue;
    }

    const device: ControllerPlacedDevice | undefined = data.placedDevices.get(
      client.deviceSerial,
    );

    if (!device) {
      // Only a wired client says a switch is missing: Wi-Fi ones come and go.
      if (!client.isWireless) {
        unplacedSerials.add(client.deviceSerial);
      }
      continue;
    }

    if (
      client.isWireless &&
      !managedMacs.has(client.mac) &&
      !(
        client.ip &&
        managedAddresses.has(managedAddressKey(client.ip, device.siteId))
      )
    ) {
      continue;
    }

    placements.push({ client, device });
  }

  return { placements, unplacedDeviceCount: unplacedSerials.size };
}

/**
 * The bindings each site's clients offer: which MAC answers at which address,
 * the input the MAC learner takes from a router's ARP table. Grouped by site,
 * because that is where an address means anything.
 */
export function getClientBindingsBySite(
  placements: Array<ControllerClientPlacement>,
): Map<
  string,
  { siteId: string | undefined; bindings: Array<MacLearningIpBinding> }
> {
  const bySite: Map<
    string,
    { siteId: string | undefined; bindings: Array<MacLearningIpBinding> }
  > = new Map();

  for (const placement of placements) {
    if (!placement.client.ip) {
      continue;
    }

    const key: string = siteKeyOf(placement.device.siteId);
    let site:
      | { siteId: string | undefined; bindings: Array<MacLearningIpBinding> }
      | undefined = bySite.get(key);

    if (!site) {
      site = { siteId: placement.device.siteId, bindings: [] };
      bySite.set(key, site);
    }

    site.bindings.push({
      macAddress: placement.client.mac,
      ipAddress: placement.client.ip,
    });
  }

  return bySite;
}

/*
 * One end of a link as its other end stores it: the device here it is, when
 * it is one, and everything that recognises it when it is not. What the
 * device list knows about a Meraki device fills what its link left out.
 */
function toStoredLink(data: {
  own: NetworkControllerLinkEnd;
  peer: NetworkControllerLinkEnd;
  link: NetworkControllerLink;
  placedDevices: Map<string, ControllerPlacedDevice>;
  controllerDevices: Map<string, NetworkControllerDevice>;
}): NetworkDeviceControllerLink {
  const listed: NetworkControllerDevice | undefined = data.peer.serial
    ? data.controllerDevices.get(data.peer.serial)
    : undefined;

  return {
    port: data.own.port || undefined,
    peerDeviceId: data.peer.serial
      ? data.placedDevices.get(data.peer.serial)?.id
      : undefined,
    peerName: data.peer.name || listed?.name || undefined,
    peerPort: data.peer.port || undefined,
    peerMac: data.peer.mac || listed?.mac || undefined,
    peerIp: data.peer.ip || listed?.lanIp || undefined,
    peerPlatform: data.peer.platform || listed?.model || undefined,
    protocols: data.link.protocols,
  };
}

/**
 * What one read's links change. A device in a network whose links were read
 * gets the whole of its links, or loses the ones it had when it has none; a
 * device in any other network is left alone, since nothing was asked about
 * it. After a read of the whole device list, a device this connection no
 * longer describes loses its links too. Pure.
 */
export function planControllerLinks(data: {
  connection: ControllerInventoryConnection;
  readAt: Date;
  links: Array<NetworkControllerLink>;
  linkNetworkIds: Array<string>;
  devices: Array<NetworkControllerDevice>;
  isDeviceListComplete: boolean;
  matches: Map<string, ControllerInventoryMatch>;
  placedDevices: Map<string, ControllerPlacedDevice>;
  candidates: Array<ControllerInventoryCandidate>;
}): ControllerLinkPlan {
  const controllerDevices: Map<string, NetworkControllerDevice> = new Map();

  for (const device of data.devices) {
    controllerDevices.set(device.serial, device);
  }

  const linksByDeviceId: Map<
    string,
    Array<NetworkDeviceControllerLink>
  > = new Map();

  const addLink: (
    own: NetworkControllerLinkEnd,
    peer: NetworkControllerLinkEnd,
    link: NetworkControllerLink,
  ) => void = (
    own: NetworkControllerLinkEnd,
    peer: NetworkControllerLinkEnd,
    link: NetworkControllerLink,
  ): void => {
    const device: ControllerPlacedDevice | undefined = own.serial
      ? data.placedDevices.get(own.serial)
      : undefined;

    if (!device) {
      return;
    }

    const stored: NetworkDeviceControllerLink = toStoredLink({
      own,
      peer,
      link,
      placedDevices: data.placedDevices,
      controllerDevices,
    });
    const held: Array<NetworkDeviceControllerLink> | undefined =
      linksByDeviceId.get(device.id);

    if (held) {
      held.push(stored);
    } else {
      linksByDeviceId.set(device.id, [stored]);
    }
  };

  for (const link of data.links) {
    addLink(link.ends[0], link.ends[1], link);
    addLink(link.ends[1], link.ends[0], link);
  }

  const readNetworkIds: Set<string> = new Set<string>(data.linkNetworkIds);
  const readBy: NetworkDeviceDiscoveryReader = {
    type: NetworkDeviceDiscoveryReaderType.NetworkController,
    id: data.connection.id,
    name: data.connection.name,
  };
  const patches: Array<DiscoveredDetailsMerge> = [];
  const seen: Set<string> = new Set<string>();
  let linkedDeviceCount: number = 0;

  for (const candidate of data.candidates) {
    const id: string = candidate.id;

    if (seen.has(id) || !ObjectID.isValidUUID(id)) {
      continue;
    }

    seen.add(id);

    const match: ControllerInventoryMatch | undefined = data.matches.get(id);
    const links: Array<NetworkDeviceControllerLink> | undefined =
      linksByDeviceId.get(id);
    const stored: NetworkDeviceControllerLinks | undefined =
      readNetworkDeviceDiscoveredDetails(
        candidate.discoveredDetails,
      ).controllerLinks;

    if (links) {
      const reading: NetworkDeviceControllerLinks | undefined =
        buildControllerLinks({
          provider: data.connection.provider,
          readBy: readBy,
          readAt: data.readAt.toISOString(),
          links: links,
        });

      if (reading) {
        linkedDeviceCount++;
        patches.push({
          deviceId: id,
          set: { [DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY]: reading },
        });
        continue;
      }
    }

    if (!stored || stored.readBy.id !== data.connection.id) {
      continue;
    }

    const isGone: boolean = match
      ? readNetworkIds.has(match.device.controllerNetworkId)
      : data.isDeviceListComplete;

    if (isGone) {
      patches.push({
        deviceId: id,
        unset: [DISCOVERED_DETAILS_CONTROLLER_LINKS_KEY],
      });
    }
  }

  return { patches, linkedDeviceCount };
}

export type FindClientCandidatesFunction = (data: {
  projectId: ObjectID;
  macs: Array<string>;
  addresses: Array<string>;
}) => Promise<Array<ControllerClientCandidate>>;

export type UpsertControllerClientsFunction = (data: {
  projectId: ObjectID;
  source: string;
  clients: Array<EndpointControllerClient>;
  now: Date;
}) => Promise<number>;

export type LearnClientMacsFunction = (data: {
  projectId: ObjectID;
  siteId: string | undefined;
  bindings: Array<MacLearningIpBinding>;
  observingDeviceId: ObjectID;
  reader: NetworkDeviceDiscoveryReader;
}) => Promise<void>;

export interface ControllerTopologyOutcome {
  placedClientCount: number;
  unplacedDeviceCount: number;
  linkedDeviceCount: number;
}

export default class NetworkControllerTopology {
  /*
   * The devices of the project a Wi-Fi client might be: those registered at
   * one of the clients' addresses, or that declare one of their MACs. In
   * chunks, as the MAC learner reads them; only a wireless client costs this.
   */
  public static async findClientCandidates(data: {
    projectId: ObjectID;
    macs: Array<string>;
    addresses: Array<string>;
  }): Promise<Array<ControllerClientCandidate>> {
    const candidates: Array<ControllerClientCandidate> = [];

    const collect: (query: Record<string, unknown>) => Promise<void> = async (
      query: Record<string, unknown>,
    ): Promise<void> => {
      const devices: Array<NetworkDevice> = await NetworkDeviceService.findBy({
        query: {
          projectId: data.projectId,
          isArchived: false,
          ...query,
        },
        select: { _id: true, hostname: true, macAddress: true, siteId: true },
        limit: LIMIT_MAX,
        skip: 0,
        props: { isRoot: true },
      });

      for (const device of devices) {
        candidates.push({
          macAddress: device.macAddress,
          hostname: device.hostname,
          siteId: device.siteId?.toString(),
        });
      }
    };

    for (
      let offset: number = 0;
      offset < data.addresses.length;
      offset += DEVICE_LOOKUP_CHUNK_SIZE
    ) {
      await collect({
        hostname: QueryHelper.any(
          data.addresses.slice(offset, offset + DEVICE_LOOKUP_CHUNK_SIZE),
        ),
      });
    }

    for (
      let offset: number = 0;
      offset < data.macs.length;
      offset += DEVICE_LOOKUP_CHUNK_SIZE
    ) {
      await collect({
        macAddress: QueryHelper.any(
          data.macs.slice(offset, offset + DEVICE_LOOKUP_CHUNK_SIZE),
        ),
      });
    }

    return candidates;
  }

  /**
   * Records what one read says is plugged into what - see the header. Throws
   * only what the database throws, and the read runner keeps that from
   * failing the traffic read; MAC learning has a try of its own, because the
   * endpoints are written by then and one site's failure is not another's.
   */
  public static async record(data: {
    projectId: ObjectID;
    connection: ControllerInventoryConnection;
    readAt: Date;
    clients: Array<NetworkControllerClient>;
    links: Array<NetworkControllerLink>;
    linkNetworkIds: Array<string>;
    devices: Array<NetworkControllerDevice>;
    isDeviceListComplete: boolean;
    matches: Map<string, ControllerInventoryMatch>;
    candidates: Array<ControllerInventoryCandidate>;
    findClientCandidates?: FindClientCandidatesFunction | undefined;
    upsertClients?: UpsertControllerClientsFunction | undefined;
    learnClientMacs?: LearnClientMacsFunction | undefined;
    merge?: MergeControllerReadingsFunction | undefined;
  }): Promise<ControllerTopologyOutcome> {
    const placedDevices: Map<string, ControllerPlacedDevice> =
      getPlacedDevicesBySerial({
        matches: data.matches,
        candidates: data.candidates,
      });

    const linkPlan: ControllerLinkPlan = planControllerLinks({
      connection: data.connection,
      readAt: data.readAt,
      links: data.links,
      linkNetworkIds: data.linkNetworkIds,
      devices: data.devices,
      isDeviceListComplete: data.isDeviceListComplete,
      matches: data.matches,
      placedDevices,
      candidates: data.candidates,
    });

    if (linkPlan.patches.length > 0) {
      await (
        data.merge ||
        ((merge: {
          projectId: ObjectID;
          patches: Array<DiscoveredDetailsMerge>;
        }): Promise<number> => {
          return NetworkDeviceService.mergeDiscoveredDetails(merge);
        })
      )({ projectId: data.projectId, patches: linkPlan.patches });
    }

    // Only a Wi-Fi client on a device here needs asking about.
    const askedClients: Array<NetworkControllerClient> = data.clients.filter(
      (client: NetworkControllerClient): boolean => {
        return client.isWireless && placedDevices.has(client.deviceSerial);
      },
    );

    const managedDevices: Array<ControllerClientCandidate> =
      askedClients.length > 0
        ? await (
            data.findClientCandidates ||
            NetworkControllerTopology.findClientCandidates
          )({
            projectId: data.projectId,
            macs: askedClients.map(
              (client: NetworkControllerClient): string => {
                return client.mac;
              },
            ),
            addresses: askedClients
              .map((client: NetworkControllerClient): string => {
                return client.ip;
              })
              .filter(Boolean),
          })
        : [];

    const placementPlan: ControllerPlacementPlan = planClientPlacements({
      clients: data.clients,
      devices: data.devices,
      placedDevices,
      managedDevices,
    });

    if (placementPlan.placements.length > 0) {
      await (
        data.upsertClients ||
        ((upsert: {
          projectId: ObjectID;
          source: string;
          clients: Array<EndpointControllerClient>;
          now: Date;
        }): Promise<number> => {
          return NetworkEndpointService.upsertControllerClients(upsert);
        })
      )({
        projectId: data.projectId,
        source: data.connection.provider,
        clients: placementPlan.placements.map(
          (placement: ControllerClientPlacement): EndpointControllerClient => {
            const client: NetworkControllerClient = placement.client;

            return {
              macAddress: client.mac,
              ipAddress: client.ip || undefined,
              hostname: client.name || undefined,
              vendor: client.manufacturer || undefined,
              portName: client.port || undefined,
              vlanId: client.vlanId,
              seenAt: client.lastSeenAt,
              deviceId: new ObjectID(placement.device.id),
              deviceSiteId: placement.device.siteId
                ? new ObjectID(placement.device.siteId)
                : undefined,
            };
          },
        ),
        now: data.readAt,
      });

      await NetworkControllerTopology.learnMacs({
        projectId: data.projectId,
        connection: data.connection,
        placements: placementPlan.placements,
        learn: data.learnClientMacs,
      });
    }

    return {
      placedClientCount: placementPlan.placements.length,
      unplacedDeviceCount: placementPlan.unplacedDeviceCount,
      linkedDeviceCount: linkPlan.linkedDeviceCount,
    };
  }

  private static async learnMacs(data: {
    projectId: ObjectID;
    connection: ControllerInventoryConnection;
    placements: Array<ControllerClientPlacement>;
    learn?: LearnClientMacsFunction | undefined;
  }): Promise<void> {
    const learn: LearnClientMacsFunction =
      data.learn ||
      (async (site: {
        projectId: ObjectID;
        siteId: string | undefined;
        bindings: Array<MacLearningIpBinding>;
        observingDeviceId: ObjectID;
        reader: NetworkDeviceDiscoveryReader;
      }): Promise<void> => {
        await NetworkDeviceMacLearningUtil.learnFromArpBindings({
          projectId: site.projectId,
          observingDeviceId: site.observingDeviceId,
          observingSiteId: site.siteId ? new ObjectID(site.siteId) : undefined,
          ipBindings: site.bindings,
          reader: site.reader,
        });
      });

    const reader: NetworkDeviceDiscoveryReader = {
      type: NetworkDeviceDiscoveryReaderType.NetworkController,
      id: data.connection.id,
      name: data.connection.name,
    };

    for (const site of getClientBindingsBySite(data.placements).values()) {
      try {
        await learn({
          projectId: data.projectId,
          siteId: site.siteId,
          bindings: site.bindings,
          observingDeviceId: new ObjectID(data.connection.id),
          reader,
        });
      } catch (error) {
        logger.error(
          `Network controller connection ${data.connection.id}: the MAC addresses of a site's clients could not be learned: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
