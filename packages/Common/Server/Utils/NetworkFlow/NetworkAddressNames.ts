import CloudResourceService from "../../Services/CloudResourceService";
import HostService from "../../Services/HostService";
import KubernetesResourceService from "../../Services/KubernetesResourceService";
import NetworkAddressNameService from "../../Services/NetworkAddressNameService";
import NetworkDeviceService from "../../Services/NetworkDeviceService";
import QueryHelper from "../../Types/Database/QueryHelper";
import logger from "../Logger";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import Host from "../../../Models/DatabaseModels/Host";
import KubernetesResource from "../../../Models/DatabaseModels/KubernetesResource";
import NetworkAddressName from "../../../Models/DatabaseModels/NetworkAddressName";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import {
  MAX_NAMED_ADDRESSES_PER_PAGE,
  NetworkAddressNameCandidate,
  NetworkAddressNameSource,
  NetworkAddressNameUtil,
  NetworkTrafficAddressName,
  NetworkTrafficAddressNames,
} from "../../../Types/NetFlow/NetworkAddressName";
import ObjectID from "../../../Types/ObjectID";
import NetworkAddressBlockUtil, {
  NetworkAddressBlock,
} from "../../../Utils/NetworkTraffic/NetworkAddressBlock";
import { readCloudEndpoints } from "../../../Types/Cloud/CloudInventory";

/*
 * WHAT A PAGE'S ADDRESSES ARE CALLED (issue #5340), for one page of
 * results at a time: the few dozen addresses a Traffic page lists, never
 * every address in the window. NetworkAddressName says where names come
 * from and in which order; this reads them, one query per source whatever
 * the number of addresses, all at once:
 *
 *   - Address Names: the exact addresses asked about, and the project's
 *     subnets (few, read whole and matched here);
 *   - network devices whose polled address is one of them, or that list
 *     one among their Other Addresses;
 *   - hosts whose agent reports one of them; cloud resources whose cloud
 *     lists one; Kubernetes nodes and pods that hold one;
 *   - DNS: the names the page's own flows carried (the caller passes them).
 *
 * Every read is the caller's own (`props`): a record the caller may not
 * read names nothing, and the address shows as itself, as it did before.
 * A source that fails is left out - the page still answers, with fewer
 * names - and says so in the log.
 *
 * A record names traffic of a time it was there: a host first seen after
 * the window, or not seen since well before it, and a pod or node likewise,
 * name none of the window's traffic. (A device's addresses are its
 * configuration, and an Address Name is what someone says now: both name
 * any window.)
 */

export interface NetworkAddressNamesRequest {
  projectId: ObjectID;
  // As the page's rows write them.
  addresses: Array<string>;
  // The window the traffic is of.
  startTime: Date;
  endTime: Date;
  // The newest DNS name each address's flows carried in the window.
  dnsNames?: Map<string, string> | undefined;
  props: DatabaseCommonInteractionProps;
}

// How far a record's first and last sighting may sit outside the window.
export const RECORD_SIGHTING_SLACK_MS: number = 15 * 60 * 1000;

// Records each source reads at most for one page.
export const MAX_ADDRESS_HOLDERS_READ: number = 500;

// Subnets a project's Address Names are read for, at most.
export const MAX_NAMED_SUBNETS_READ: number = 1000;

// Records each source reads by name for "find an address", at most.
export const MAX_RECORDS_FOUND_BY_NAME: number = 20;

// Addresses one found record answers with, at most (a host can list dozens).
export const MAX_ADDRESSES_PER_FOUND_RECORD: number = 10;

interface Holder {
  address: string;
  candidate: NetworkAddressNameCandidate;
}

interface Window {
  startTime: Date;
  endTime: Date;
}

export default class NetworkAddressNamesUtil {
  public static async resolve(
    request: NetworkAddressNamesRequest,
  ): Promise<NetworkTrafficAddressNames> {
    // Each address once, written one way, with the spellings the page used.
    const spellings: Map<string, Array<string>> = new Map();

    for (const raw of request.addresses) {
      if (spellings.size >= MAX_NAMED_ADDRESSES_PER_PAGE) {
        break;
      }

      const canonical: string | null =
        NetworkAddressBlockUtil.canonicalAddress(raw);

      if (!canonical) {
        continue;
      }

      const known: Array<string> = spellings.get(canonical) || [];

      if (!known.includes(raw)) {
        known.push(raw);
      }

      spellings.set(canonical, known);
    }

    const result: NetworkTrafficAddressNames = {};

    if (spellings.size === 0) {
      return result;
    }

    const addresses: Array<string> = Array.from(spellings.keys());
    const window: Window = {
      startTime: request.startTime,
      endTime: request.endTime,
    };

    const [addressNames, devices, hosts, cloudResources, kubernetes]: [
      Array<NetworkAddressName>,
      Array<Holder>,
      Array<Holder>,
      Array<Holder>,
      Array<Holder>,
    ] = await Promise.all([
      NetworkAddressNamesUtil.safely("address names", () => {
        return NetworkAddressNamesUtil.readAddressNames(
          request.projectId,
          addresses,
          request.props,
        );
      }),
      NetworkAddressNamesUtil.safely("network devices", () => {
        return NetworkAddressNamesUtil.readNetworkDevices(
          request.projectId,
          addresses,
          request.props,
        );
      }),
      NetworkAddressNamesUtil.safely("hosts", () => {
        return NetworkAddressNamesUtil.readHosts(
          request.projectId,
          addresses,
          window,
          request.props,
        );
      }),
      NetworkAddressNamesUtil.safely("cloud resources", () => {
        return NetworkAddressNamesUtil.readCloudResources(
          request.projectId,
          addresses,
          window,
          request.props,
        );
      }),
      NetworkAddressNamesUtil.safely("Kubernetes nodes and pods", () => {
        return NetworkAddressNamesUtil.readKubernetes(
          request.projectId,
          addresses,
          window,
          request.props,
        );
      }),
    ]);

    const candidates: Map<string, Array<NetworkAddressNameCandidate>> =
      new Map();

    const add: (address: string, candidate: NetworkAddressNameCandidate) => void =
      (address: string, candidate: NetworkAddressNameCandidate): void => {
        const list: Array<NetworkAddressNameCandidate> =
          candidates.get(address) || [];
        list.push(candidate);
        candidates.set(address, list);
      };

    const subnets: Array<{ block: NetworkAddressBlock; name: string }> = [];

    for (const row of addressNames) {
      const block: NetworkAddressBlock | null = NetworkAddressBlockUtil.parse(
        row.address,
      );
      const name: string | null = NetworkAddressNameUtil.cleanName(row.name);

      if (!block || !name) {
        continue;
      }

      if (NetworkAddressBlockUtil.isSingleAddress(block)) {
        add(block.text, {
          source: NetworkAddressNameSource.AddressName,
          name: name,
        });
      } else {
        subnets.push({ block: block, name: name });
      }
    }

    for (const holder of [...devices, ...hosts, ...cloudResources, ...kubernetes]) {
      add(holder.address, holder.candidate);
    }

    for (const [raw, name] of Array.from(
      (request.dnsNames || new Map<string, string>()).entries(),
    )) {
      const canonical: string | null =
        NetworkAddressBlockUtil.canonicalAddress(raw);
      const cleaned: string | null = NetworkAddressNameUtil.cleanName(name);

      if (canonical && cleaned && spellings.has(canonical)) {
        add(canonical, {
          source: NetworkAddressNameSource.Dns,
          name: cleaned,
        });
      }
    }

    for (const [canonical, written] of Array.from(spellings.entries())) {
      const picked: NetworkAddressNameCandidate | null =
        NetworkAddressNameUtil.pick(candidates.get(canonical) || []);
      const subnet: { block: NetworkAddressBlock; name: string } | null =
        NetworkAddressBlockUtil.mostSpecific(
          canonical,
          subnets,
          (item: { block: NetworkAddressBlock; name: string }) => {
            return item.block;
          },
        );

      if (!picked && !subnet) {
        continue;
      }

      const named: NetworkTrafficAddressName = {};

      if (picked) {
        named.name = picked.name;
        named.source = picked.source;

        if (picked.resourceId) {
          named.resourceId = picked.resourceId;
        }
      }

      if (subnet) {
        named.subnetName = subnet.name;
        named.subnet = subnet.block.text;
      }

      for (const spelling of written) {
        result[spelling] = { ...named };
      }
    }

    return result;
  }

  /*
   * "Find an address" by a name (issue #5340): the addresses whose name in
   * the project holds every word typed - a name someone gave the address,
   * a device's, a host's, a cloud resource's, a Kubernetes node's or pod's
   * - at most MAX_RECORDS_FOUND_BY_NAME records from each source and
   * MAX_ADDRESSES_PER_FOUND_RECORD addresses from each record. The words
   * are matched literally (a "%" typed is a "%"). DNS names are the flows'
   * own, and found there (NetworkTrafficAggregationService). The caller
   * keeps those the page's window has traffic of.
   */
  public static async findAddressesByName(data: {
    projectId: ObjectID;
    text: string;
    startTime: Date;
    endTime: Date;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<string>> {
    const words: Array<string> = data.text
      .split(" ")
      .map((word: string): string => {
        return word.trim();
      })
      .filter(Boolean);

    if (words.length === 0) {
      return [];
    }

    const window: Window = { startTime: data.startTime, endTime: data.endTime };
    const props: DatabaseCommonInteractionProps = data.props;
    const projectId: ObjectID = data.projectId;

    const lists: Array<Array<string>> = await Promise.all([
      NetworkAddressNamesUtil.safely("address names", async () => {
        const rows: Array<NetworkAddressName> =
          await NetworkAddressNameService.findBy({
            query: {
              projectId: projectId,
              name: QueryHelper.searchAllWords(words),
            },
            select: { _id: true, address: true },
            limit: MAX_RECORDS_FOUND_BY_NAME,
            skip: 0,
            props: props,
          });

        return rows
          .map((row: NetworkAddressName): NetworkAddressBlock | null => {
            return NetworkAddressBlockUtil.parse(row.address);
          })
          .filter((block: NetworkAddressBlock | null): boolean => {
            return Boolean(block && NetworkAddressBlockUtil.isSingleAddress(block));
          })
          .map((block: NetworkAddressBlock | null): string => {
            return block!.text;
          });
      }),
      NetworkAddressNamesUtil.safely("network devices", async () => {
        const rows: Array<NetworkDevice> = await NetworkDeviceService.findBy({
          query: {
            projectId: projectId,
            isArchived: false,
            name: QueryHelper.searchAllWords(words),
          },
          select: { _id: true, hostname: true, otherAddresses: true },
          limit: MAX_RECORDS_FOUND_BY_NAME,
          skip: 0,
          props: props,
        });

        return rows.flatMap((device: NetworkDevice): Array<string> => {
          return NetworkAddressNamesUtil.addressesOf([
            device.hostname || "",
            ...NetworkAddressNamesUtil.entries(device.otherAddresses),
          ]);
        });
      }),
      NetworkAddressNamesUtil.safely("hosts", async () => {
        const rows: Array<Host> = await HostService.findBy({
          query: {
            projectId: projectId,
            isArchived: false,
            name: QueryHelper.searchAllWords(words),
          },
          select: {
            _id: true,
            hostIpAddresses: true,
            createdAt: true,
            lastSeenAt: true,
          },
          limit: MAX_RECORDS_FOUND_BY_NAME,
          skip: 0,
          props: props,
        });

        return rows
          .filter((host: Host): boolean => {
            return NetworkAddressNamesUtil.wasThereDuring(
              { firstSeenAt: host.createdAt, lastSeenAt: host.lastSeenAt },
              window,
            );
          })
          .flatMap((host: Host): Array<string> => {
            return NetworkAddressNamesUtil.addressesOf(
              NetworkAddressNamesUtil.entries(host.hostIpAddresses),
            );
          });
      }),
      NetworkAddressNamesUtil.safely("cloud resources", async () => {
        const rows: Array<CloudResource> = await CloudResourceService.findBy({
          query: {
            projectId: projectId,
            isArchived: false,
            name: QueryHelper.searchAllWords(words),
          },
          select: { _id: true, cloudEndpoints: true },
          limit: MAX_RECORDS_FOUND_BY_NAME,
          skip: 0,
          props: props,
        });

        return rows.flatMap((resource: CloudResource): Array<string> => {
          return NetworkAddressNamesUtil.addressesOf(
            readCloudEndpoints(resource.cloudEndpoints),
          );
        });
      }),
      NetworkAddressNamesUtil.safely("Kubernetes nodes and pods", async () => {
        const rows: Array<KubernetesResource> =
          await KubernetesResourceService.findBy({
            query: {
              projectId: projectId,
              kind: QueryHelper.any(["Pod", "Node"]),
              name: QueryHelper.searchAllWords(words),
            },
            select: {
              _id: true,
              kind: true,
              status: true,
              lastSeenAt: true,
              resourceCreationTimestamp: true,
            },
            limit: MAX_RECORDS_FOUND_BY_NAME,
            skip: 0,
            props: props,
          });

        return rows
          .filter((resource: KubernetesResource): boolean => {
            return NetworkAddressNamesUtil.wasThereDuring(
              {
                firstSeenAt: resource.resourceCreationTimestamp,
                lastSeenAt: resource.lastSeenAt,
              },
              window,
            );
          })
          .flatMap((resource: KubernetesResource): Array<string> => {
            return NetworkAddressNamesUtil.addressesOf(
              NetworkAddressNamesUtil.kubernetesAddresses(resource),
            );
          });
      }),
    ]);

    const found: Array<string> = [];

    for (const list of lists) {
      for (const address of list) {
        if (!found.includes(address)) {
          found.push(address);
        }
      }
    }

    return found;
  }

  // A record's listed values that are addresses, written one way, the first few.
  private static addressesOf(values: Array<string>): Array<string> {
    const found: Array<string> = [];

    for (const value of values) {
      const canonical: string | null =
        NetworkAddressBlockUtil.canonicalAddress(value);

      if (canonical && !found.includes(canonical)) {
        found.push(canonical);
      }

      if (found.length >= MAX_ADDRESSES_PER_FOUND_RECORD) {
        break;
      }
    }

    return found;
  }

  /*
   * The addresses a node or pod holds: a node its InternalIP and
   * ExternalIP addresses, a pod its podIP unless it is on its node's own
   * network (podIP is hostIP).
   */
  public static kubernetesAddresses(resource: KubernetesResource): Array<string> {
    const status: JSONObject =
      resource.status &&
      typeof resource.status === "object" &&
      !Array.isArray(resource.status)
        ? resource.status
        : {};

    if (resource.kind === "Pod") {
      const podIp: string =
        typeof status["podIP"] === "string" ? status["podIP"] : "";
      const hostIp: string =
        typeof status["hostIP"] === "string" ? status["hostIP"] : "";

      return podIp && podIp !== hostIp ? [podIp] : [];
    }

    if (resource.kind === "Node") {
      return (Array.isArray(status["addresses"]) ? status["addresses"] : [])
        .filter((entry: unknown): boolean => {
          const type: unknown =
            entry && typeof entry === "object"
              ? (entry as JSONObject)["type"]
              : undefined;
          return type === "InternalIP" || type === "ExternalIP";
        })
        .map((entry: unknown): string => {
          const value: unknown = (entry as JSONObject)["address"];
          return typeof value === "string" ? value : "";
        })
        .filter(Boolean);
    }

    return [];
  }

  // A source's answer, or none (and a log line) when it fails.
  private static async safely<T>(
    source: string,
    read: () => Promise<Array<T>>,
  ): Promise<Array<T>> {
    try {
      return await read();
    } catch (error) {
      logger.warn(
        `Traffic page names: could not read ${source}; their addresses are shown without their names. ${String(error)}`,
      );
      return [];
    }
  }

  /*
   * Whether a record seen first at `firstSeenAt` and last at `lastSeenAt`
   * was there during the window (either missing: it says nothing against).
   */
  public static wasThereDuring(
    sightings: {
      firstSeenAt?: Date | undefined | null;
      lastSeenAt?: Date | undefined | null;
    },
    window: Window,
  ): boolean {
    const first: number | null = NetworkAddressNamesUtil.toTime(
      sightings.firstSeenAt,
    );
    const last: number | null = NetworkAddressNamesUtil.toTime(
      sightings.lastSeenAt,
    );

    if (
      first !== null &&
      first > window.endTime.getTime() + RECORD_SIGHTING_SLACK_MS
    ) {
      return false;
    }

    if (
      last !== null &&
      last < window.startTime.getTime() - RECORD_SIGHTING_SLACK_MS
    ) {
      return false;
    }

    return true;
  }

  private static toTime(value: Date | string | undefined | null): number | null {
    if (!value) {
      return null;
    }

    const time: number = new Date(value).getTime();

    return Number.isFinite(time) ? time : null;
  }

  // The addresses of a record's list that are among the page's.
  private static held(
    listed: Array<string>,
    addresses: Set<string>,
  ): Array<string> {
    const found: Array<string> = [];

    for (const value of listed) {
      const canonical: string | null =
        NetworkAddressBlockUtil.canonicalAddress(value);

      if (canonical && addresses.has(canonical) && !found.includes(canonical)) {
        found.push(canonical);
      }
    }

    return found;
  }

  // Comma- (or space-) separated text as its entries.
  private static entries(text: string | undefined | null): Array<string> {
    return (text || "")
      .split(",")
      .flatMap((part: string): Array<string> => {
        return part.split(" ");
      })
      .map((part: string): string => {
        return part.trim();
      })
      .filter(Boolean);
  }

  /*
   * The project's Address Names for these addresses, and all of its subnet
   * names (a subnet is matched here, by NetworkAddressBlockUtil).
   */
  public static async readAddressNames(
    projectId: ObjectID,
    addresses: Array<string>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<NetworkAddressName>> {
    const [exact, subnets]: [
      Array<NetworkAddressName>,
      Array<NetworkAddressName>,
    ] = await Promise.all([
      NetworkAddressNameService.findBy({
        query: {
          projectId: projectId,
          address: QueryHelper.any(addresses),
        },
        select: {
          _id: true,
          name: true,
          address: true,
        },
        limit: addresses.length,
        skip: 0,
        props: props,
      }),
      NetworkAddressNameService.findBy({
        query: {
          projectId: projectId,
          address: QueryHelper.search("/"),
        },
        select: {
          _id: true,
          name: true,
          address: true,
        },
        limit: MAX_NAMED_SUBNETS_READ,
        skip: 0,
        props: props,
      }),
    ]);

    return [...exact, ...subnets];
  }

  /*
   * Devices polled at one of the addresses, or listing one among their
   * Other Addresses. Archived devices name nothing.
   */
  public static async readNetworkDevices(
    projectId: ObjectID,
    addresses: Array<string>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Holder>> {
    const select: {
      _id: true;
      name: true;
      hostname: true;
      otherAddresses: true;
    } = { _id: true, name: true, hostname: true, otherAddresses: true };

    const [polled, other]: [Array<NetworkDevice>, Array<NetworkDevice>] =
      await Promise.all([
        NetworkDeviceService.findBy({
          query: {
            projectId: projectId,
            isArchived: false,
            hostname: QueryHelper.findWithSameTextAnyOf(addresses),
          },
          select: select,
          limit: MAX_ADDRESS_HOLDERS_READ,
          skip: 0,
          props: props,
        }),
        NetworkDeviceService.findBy({
          query: {
            projectId: projectId,
            isArchived: false,
            otherAddresses: QueryHelper.listsAnyOf(addresses),
          },
          select: select,
          limit: MAX_ADDRESS_HOLDERS_READ,
          skip: 0,
          props: props,
        }),
      ]);

    const wanted: Set<string> = new Set(addresses);
    const holders: Array<Holder> = [];
    const seen: Set<string> = new Set();

    for (const device of [...polled, ...other]) {
      const id: string = device.id?.toString() || "";
      const name: string | null = NetworkAddressNameUtil.cleanName(
        device.name,
      );

      if (!id || !name || seen.has(id)) {
        continue;
      }

      seen.add(id);

      for (const address of NetworkAddressNamesUtil.held(
        [
          device.hostname || "",
          ...NetworkAddressNamesUtil.entries(device.otherAddresses),
        ],
        wanted,
      )) {
        holders.push({
          address: address,
          candidate: {
            source: NetworkAddressNameSource.NetworkDevice,
            name: name,
            resourceId: id,
          },
        });
      }
    }

    return holders;
  }

  // Hosts whose agent reports one of the addresses (Host.hostIpAddresses).
  public static async readHosts(
    projectId: ObjectID,
    addresses: Array<string>,
    window: Window,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Holder>> {
    const hosts: Array<Host> = await HostService.findBy({
      query: {
        projectId: projectId,
        isArchived: false,
        hostIpAddresses: QueryHelper.listsAnyOf(addresses),
      },
      select: {
        _id: true,
        name: true,
        hostIdentifier: true,
        hostIpAddresses: true,
        createdAt: true,
        lastSeenAt: true,
      },
      limit: MAX_ADDRESS_HOLDERS_READ,
      skip: 0,
      props: props,
    });

    const wanted: Set<string> = new Set(addresses);
    const holders: Array<Holder> = [];

    for (const host of hosts) {
      const id: string = host.id?.toString() || "";
      const name: string | null = NetworkAddressNameUtil.cleanName(
        host.name || host.hostIdentifier,
      );

      if (
        !id ||
        !name ||
        !NetworkAddressNamesUtil.wasThereDuring(
          { firstSeenAt: host.createdAt, lastSeenAt: host.lastSeenAt },
          window,
        )
      ) {
        continue;
      }

      for (const address of NetworkAddressNamesUtil.held(
        NetworkAddressNamesUtil.entries(host.hostIpAddresses),
        wanted,
      )) {
        holders.push({
          address: address,
          candidate: {
            source: NetworkAddressNameSource.Host,
            name: name,
            resourceId: id,
          },
        });
      }
    }

    return holders;
  }

  // Cloud resources whose cloud lists one of the addresses (cloudEndpoints).
  public static async readCloudResources(
    projectId: ObjectID,
    addresses: Array<string>,
    window: Window,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Holder>> {
    const ids: Array<ObjectID> = await CloudResourceService.findIdsByEndpoints(
      {
        projectId: projectId,
        endpoints: addresses,
        limit: MAX_ADDRESS_HOLDERS_READ,
      },
    );

    if (ids.length === 0) {
      return [];
    }

    const resources: Array<CloudResource> = await CloudResourceService.findBy({
      query: {
        projectId: projectId,
        _id: QueryHelper.any(ids),
      },
      select: {
        _id: true,
        name: true,
        cloudEndpoints: true,
        createdAt: true,
        lastSeenAt: true,
        inventoriedAt: true,
      },
      limit: ids.length,
      skip: 0,
      props: props,
    });

    const wanted: Set<string> = new Set(addresses);
    const holders: Array<Holder> = [];

    for (const resource of resources) {
      const id: string = resource.id?.toString() || "";
      const name: string | null = NetworkAddressNameUtil.cleanName(
        resource.name,
      );
      const lastSeen: Date | undefined =
        [resource.lastSeenAt, resource.inventoriedAt]
          .filter((value: Date | undefined): value is Date => {
            return Boolean(value);
          })
          .sort((a: Date, b: Date): number => {
            return new Date(b).getTime() - new Date(a).getTime();
          })[0] || undefined;

      if (
        !id ||
        !name ||
        !NetworkAddressNamesUtil.wasThereDuring(
          { firstSeenAt: resource.createdAt, lastSeenAt: lastSeen },
          window,
        )
      ) {
        continue;
      }

      for (const address of NetworkAddressNamesUtil.held(
        readCloudEndpoints(resource.cloudEndpoints),
        wanted,
      )) {
        holders.push({
          address: address,
          candidate: {
            source: NetworkAddressNameSource.CloudResource,
            name: name,
            resourceId: id,
          },
        });
      }
    }

    return holders;
  }

  // Kubernetes nodes and pods holding one of the addresses.
  public static async readKubernetes(
    projectId: ObjectID,
    addresses: Array<string>,
    window: Window,
    props: DatabaseCommonInteractionProps,
  ): Promise<Array<Holder>> {
    const ids: Array<ObjectID> =
      await KubernetesResourceService.findIdsHoldingAddresses({
        projectId: projectId,
        addresses: addresses,
        limit: MAX_ADDRESS_HOLDERS_READ,
      });

    if (ids.length === 0) {
      return [];
    }

    const resources: Array<KubernetesResource> =
      await KubernetesResourceService.findBy({
        query: {
          projectId: projectId,
          _id: QueryHelper.any(ids),
        },
        select: {
          _id: true,
          kind: true,
          name: true,
          status: true,
          lastSeenAt: true,
          resourceCreationTimestamp: true,
        },
        limit: ids.length,
        skip: 0,
        props: props,
      });

    const wanted: Set<string> = new Set(addresses);
    const holders: Array<Holder> = [];

    for (const resource of resources) {
      const name: string | null = NetworkAddressNameUtil.cleanName(
        resource.name,
      );

      if (
        !name ||
        !NetworkAddressNamesUtil.wasThereDuring(
          {
            firstSeenAt: resource.resourceCreationTimestamp,
            lastSeenAt: resource.lastSeenAt,
          },
          window,
        )
      ) {
        continue;
      }

      const source: NetworkAddressNameSource | null =
        resource.kind === "Pod"
          ? NetworkAddressNameSource.KubernetesPod
          : resource.kind === "Node"
            ? NetworkAddressNameSource.KubernetesNode
            : null;

      if (!source) {
        continue;
      }

      // A pod on its node's own network holds the node's address, not its own.
      for (const address of NetworkAddressNamesUtil.held(
        NetworkAddressNamesUtil.kubernetesAddresses(resource),
        wanted,
      )) {
        holders.push({
          address: address,
          candidate: {
            source: source,
            name: name,
          },
        });
      }
    }

    return holders;
  }
}
