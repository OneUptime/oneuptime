import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../../Types/ObjectID";
import {
  EXACT_SECURITY_CONNECTION_REASONS,
  POSSIBLE_SECURITY_CONNECTION_REASONS,
  SecurityConnectionCertainty,
  SecurityConnectionKind,
  SecurityConnectionMatch,
  SecurityConnectionReason,
  SecurityConnectionStatusJson,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import ServiceType from "../../../../Types/Telemetry/ServiceType";
import {
  SecurityConnectionLookups,
  SecurityConnectionVerdict,
  SecurityLogResource,
  canonicalAddress,
  compareConnectedResources,
  foldConnectionValue,
  getBestCertainty,
  getMonitorMentionTexts,
  getMonitorTargetHosts,
  getSecurityConnectionLookups,
  matchAddress,
  matchEmail,
  matchHostName,
  matchMonitorTarget,
  matchResourceId,
  readCloudEndpointHosts,
  recordReportsAddress,
  wasLookedUpEverywhere,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import CloudResourceService from "../../../Services/CloudResourceService";
import DockerHostService from "../../../Services/DockerHostService";
import HostService from "../../../Services/HostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import OpenStackCloudService from "../../../Services/OpenStackCloudService";
import MonitorService from "../../../Services/MonitorService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import PodmanHostService from "../../../Services/PodmanHostService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import ServiceService from "../../../Services/ServiceService";
import TeamMemberService from "../../../Services/TeamMemberService";
import UserService from "../../../Services/UserService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import CaptureSpan from "../../Telemetry/CaptureSpan";

/*
 * WHICH OF THE PROJECT'S OWN RECORDS A SECURITY CASE, EVENT OR ENTITY NAMES.
 *
 * The rules are in Common/Utils/SecurityCase/SecurityConnectionMatch; this
 * reads the records they are applied to:
 *
 *   names      hosts, Docker and Podman hosts (their host.name and their
 *              display name), Kubernetes clusters (k8s.cluster.name),
 *              network devices (name, hostname, DNS name) and the names
 *              cloud resources answer on: a full name, the short form of a
 *              full name, and the full names a bare one starts;
 *   addresses  the hosts and network devices holding each one, counted
 *              among ALL of the project's records - how many hold it is
 *              what makes it exact or only possible, whoever is asking -
 *              and listed only when the caller may read them; the cloud
 *              resources answering on it, counted among the cloud
 *              resources alone (an instance and the host it runs are one
 *              machine seen twice, and neither makes the other less sure);
 *   monitors   the monitors checking a name, an address or a URL's host;
 *   IDs        the cloud resource of an ARN, an Azure resource ID or a
 *              Google Cloud resource name;
 *   emails     the project's members;
 *   logs       the record an event's log line was sent under ("Your logs"
 *              events carry it), exactly: a service, a host, a cluster, a
 *              device, a cloud resource or a serverless function.
 *
 * Every read is inside the project, bounded, and made with the caller's own
 * permissions: a kind of record the caller's role cannot read is reported
 * as such and none of it is shown; a read that fails is reported too, and
 * the rest still answer. Nothing here writes.
 */

// The most rows one read returns.
export const MAX_ROWS_PER_READ: number = 50;

// The most rows read to count how many records hold one address.
export const MAX_ADDRESS_HOLDERS_READ: number = 25;

/*
 * The most monitors read whose steps mention a value: each is then held to
 * the hosts it checks, so a mention that is not a target (a header, a
 * criterion) is read and dropped.
 */
export const MAX_MONITORS_READ: number = 200;

// One OneUptime record a security value names, with every way it does.
export interface SecurityConnectedRecord {
  kind: SecurityConnectionKind;
  id: string;
  name: string;
  /*
   * What OneUptime keys it by, where that is not its name: a host's
   * host.name, a cluster's k8s.cluster.name, a service's name - what its
   * inventory record and its telemetry are found by.
   */
  identity?: string | undefined;
  // A monitor's current status, read with it.
  status?: SecurityConnectionStatusJson | undefined;
  certainty: SecurityConnectionCertainty;
  matches: Array<SecurityConnectionMatch>;
}

export interface SecurityConnectedRecordsResult {
  // Exact connections first, then by kind and name.
  records: Array<SecurityConnectedRecord>;
  // The users, hosts and addresses looked up that matched no record.
  unmatched: Array<SecurityEntity>;
  unreadableKinds: Array<SecurityConnectionKind>;
  failedKinds: Array<SecurityConnectionKind>;
}

// The kind of record a log row's resource type names, for "Your logs" events.
export const LOG_RESOURCE_KINDS: ReadonlyArray<{
  serviceType: ServiceType;
  kind: SecurityConnectionKind;
}> = [
  {
    serviceType: ServiceType.OpenTelemetry,
    kind: SecurityConnectionKind.Service,
  },
  { serviceType: ServiceType.Host, kind: SecurityConnectionKind.Host },
  {
    serviceType: ServiceType.DockerHost,
    kind: SecurityConnectionKind.DockerHost,
  },
  {
    serviceType: ServiceType.PodmanHost,
    kind: SecurityConnectionKind.PodmanHost,
  },
  {
    serviceType: ServiceType.KubernetesCluster,
    kind: SecurityConnectionKind.KubernetesCluster,
  },
  {
    serviceType: ServiceType.OpenStackCloud,
    kind: SecurityConnectionKind.OpenStackCloud,
  },
  {
    serviceType: ServiceType.NetworkDevice,
    kind: SecurityConnectionKind.NetworkDevice,
  },
  {
    serviceType: ServiceType.CloudResource,
    kind: SecurityConnectionKind.CloudResource,
  },
  {
    serviceType: ServiceType.ServerlessFunction,
    kind: SecurityConnectionKind.ServerlessFunction,
  },
];

export function getLogResourceKind(
  serviceType: string,
): SecurityConnectionKind | null {
  return (
    LOG_RESOURCE_KINDS.find(
      (entry: { serviceType: ServiceType; kind: SecurityConnectionKind }) => {
        return entry.serviceType === serviceType;
      },
    )?.kind || null
  );
}

// Whether a read was refused for who is asking (a role, a plan), not failed.
export function isRefusedRead(error: unknown): boolean {
  return (
    error instanceof NotAuthorizedException ||
    error instanceof PaymentRequiredException
  );
}

// The order a record's matches are listed in, within one certainty.
const REASON_ORDER: ReadonlyArray<SecurityConnectionReason> = [
  ...EXACT_SECURITY_CONNECTION_REASONS,
  ...POSSIBLE_SECURITY_CONNECTION_REASONS,
];

interface NamedRow {
  id: string;
  name: string;
  identity?: string | undefined;
  // Every name the record reports, each tried against the event's names.
  names: Array<string | undefined | null>;
}

class Collector {
  private readonly records: Map<string, SecurityConnectedRecord> = new Map();
  public readonly unreadable: Set<SecurityConnectionKind> = new Set();
  public readonly failed: Set<SecurityConnectionKind> = new Set();

  public add(data: {
    kind: SecurityConnectionKind;
    id: string;
    name: string;
    identity?: string | undefined;
    status?: SecurityConnectionStatusJson | undefined;
    match: SecurityConnectionMatch;
  }): void {
    const key: string = `${data.kind}:${data.id}`;
    let record: SecurityConnectedRecord | undefined = this.records.get(key);

    if (!record) {
      record = {
        kind: data.kind,
        id: data.id,
        name: data.name,
        ...(data.identity ? { identity: data.identity } : {}),
        ...(data.status ? { status: data.status } : {}),
        certainty: data.match.certainty,
        matches: [],
      };
      this.records.set(key, record);
    }

    const matchKey: string = `${foldConnectionValue(data.match.entity.value)}|${data.match.reason}`;
    const isKnown: boolean = record.matches.some(
      (match: SecurityConnectionMatch): boolean => {
        return (
          `${foldConnectionValue(match.entity.value)}|${match.reason}` ===
          matchKey
        );
      },
    );

    if (!isKnown) {
      record.matches.push(data.match);
      /*
       * The exact matches first: they are what a person reads first. Then
       * by reason, in the order the reasons are listed, so the sentence a
       * record leads with never depends on which read answered first.
       */
      record.matches.sort(
        (a: SecurityConnectionMatch, b: SecurityConnectionMatch): number => {
          if (a.certainty !== b.certainty) {
            return a.certainty === SecurityConnectionCertainty.Exact ? -1 : 1;
          }

          return (
            REASON_ORDER.indexOf(a.reason) - REASON_ORDER.indexOf(b.reason)
          );
        },
      );
    }

    record.certainty = getBestCertainty(
      record.matches.map(
        (match: SecurityConnectionMatch): SecurityConnectionCertainty => {
          return match.certainty;
        },
      ),
    );
  }

  public getRecords(): Array<SecurityConnectedRecord> {
    return Array.from(this.records.values()).sort(compareConnectedResources);
  }

  public async read<T>(
    kind: SecurityConnectionKind,
    read: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await read();
    } catch (error) {
      if (isRefusedRead(error)) {
        this.unreadable.add(kind);
      } else {
        this.failed.add(kind);
        logger.error(
          `Security connections: the ${kind} records could not be read: ${error}`,
        );
      }

      return null;
    }
  }
}

export default class SecurityConnectedRecords {
  @CaptureSpan()
  public static async resolve(data: {
    projectId: ObjectID;
    entities: ReadonlyArray<SecurityEntity>;
    // The records the events' log lines were sent under, when known.
    logResources?: ReadonlyArray<SecurityLogResource> | undefined;
    props: DatabaseCommonInteractionProps;
  }): Promise<SecurityConnectedRecordsResult> {
    const lookups: SecurityConnectionLookups = getSecurityConnectionLookups(
      data.entities,
    );
    const collector: Collector = new Collector();

    await Promise.all([
      this.matchNames({ ...data, lookups, collector }),
      this.matchAddresses({ ...data, lookups, collector }),
      this.matchCloudResources({ ...data, lookups, collector }),
      this.matchMonitors({ ...data, lookups, collector }),
      this.matchMembers({ ...data, lookups, collector }),
      this.matchLogResources({
        projectId: data.projectId,
        logResources: data.logResources || [],
        props: data.props,
        collector,
      }),
    ]);

    const records: Array<SecurityConnectedRecord> = collector.getRecords();
    const matchedValues: Set<string> = new Set();

    for (const record of records) {
      for (const match of record.matches) {
        matchedValues.add(foldConnectionValue(match.entity.value));
      }
    }

    const unsureKinds: Set<SecurityConnectionKind> = new Set([
      ...Array.from(collector.unreadable),
      ...Array.from(collector.failed),
    ]);

    return {
      records,
      unmatched: lookups.lookedUp.filter((entity: SecurityEntity): boolean => {
        return (
          !matchedValues.has(foldConnectionValue(entity.value)) &&
          wasLookedUpEverywhere(entity, unsureKinds)
        );
      }),
      unreadableKinds: Array.from(collector.unreadable),
      failedKinds: Array.from(collector.failed),
    };
  }

  /*
   * A row matched by name: each of the event's names tried against each
   * name the row reports, the surest verdict kept.
   */
  private static addNameMatches(data: {
    kind: SecurityConnectionKind;
    rows: Array<NamedRow>;
    lookups: SecurityConnectionLookups;
    collector: Collector;
    exactReason: SecurityConnectionReason;
    allowShortName: boolean;
  }): void {
    for (const row of data.rows) {
      for (const hostName of data.lookups.hostNames) {
        const entity: SecurityEntity = data.lookups.hostNameEntities.get(
          hostName,
        ) || { type: SecurityEntityType.Host, value: hostName };
        let best: { verdict: SecurityConnectionVerdict; name: string } | null =
          null;

        for (const name of row.names) {
          const verdict: SecurityConnectionVerdict | null = matchHostName({
            entityValue: hostName,
            entityType: entity.type,
            resourceName: name,
            exactReason: data.exactReason,
          });

          if (
            !verdict ||
            (!data.allowShortName &&
              verdict.reason === SecurityConnectionReason.ShortHostName)
          ) {
            continue;
          }

          if (
            !best ||
            (verdict.certainty === SecurityConnectionCertainty.Exact &&
              best.verdict.certainty !== SecurityConnectionCertainty.Exact)
          ) {
            best = { verdict, name: (name || "").trim() };
          }
        }

        if (best) {
          data.collector.add({
            kind: data.kind,
            id: row.id,
            name: row.name,
            identity: row.identity,
            match: {
              entity,
              certainty: best.verdict.certainty,
              reason: best.verdict.reason,
              matchedValue: best.name,
            },
          });
        }
      }
    }
  }

  private static async matchNames(data: {
    projectId: ObjectID;
    lookups: SecurityConnectionLookups;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
  }): Promise<void> {
    const { lookups, collector, projectId, props } = data;

    if (lookups.hostNames.length === 0) {
      return;
    }

    const values: Array<string> = lookups.hostNameQueryValues;
    const prefixes: Array<string> = lookups.hostNamePrefixes.map(
      (prefix: string): string => {
        return `${prefix}.`;
      },
    );

    /*
     * Each column read for every name and short form, then for the full
     * names the bare ones may start.
     */
    const readByColumns: <T>(
      columns: Array<string>,
      read: (query: Record<string, unknown>) => Promise<Array<T>>,
    ) => Promise<Array<T>> = async <T>(
      columns: Array<string>,
      read: (query: Record<string, unknown>) => Promise<Array<T>>,
    ): Promise<Array<T>> => {
      const rows: Array<T> = [];

      for (const column of columns) {
        rows.push(
          ...(await read({
            projectId,
            [column]: QueryHelper.findWithSameTextAnyOf(values),
          })),
        );

        if (prefixes.length > 0) {
          rows.push(
            ...(await read({
              projectId,
              [column]: QueryHelper.startsWithAnyOf(prefixes),
            })),
          );
        }
      }

      return rows;
    };

    await Promise.all([
      collector
        .read(SecurityConnectionKind.Host, async () => {
          return await readByColumns<Host>(
            ["hostIdentifier", "name"],
            async (query: Record<string, unknown>): Promise<Array<Host>> => {
              return await HostService.findBy({
                query: query as never,
                select: { _id: true, name: true, hostIdentifier: true },
                limit: MAX_ROWS_PER_READ,
                skip: 0,
                props,
              });
            },
          );
        })
        .then((hosts: Array<Host> | null) => {
          this.addNameMatches({
            kind: SecurityConnectionKind.Host,
            rows: (hosts || []).map((host: Host): NamedRow => {
              return {
                id: host.id!.toString(),
                name: host.name || host.hostIdentifier || "",
                identity: host.hostIdentifier || undefined,
                names: [host.hostIdentifier, host.name],
              };
            }),
            lookups,
            collector,
            exactReason: SecurityConnectionReason.HostName,
            allowShortName: true,
          });
        }),
      collector
        .read(SecurityConnectionKind.DockerHost, async () => {
          return await readByColumns<DockerHost>(
            ["hostIdentifier", "name"],
            async (
              query: Record<string, unknown>,
            ): Promise<Array<DockerHost>> => {
              return await DockerHostService.findBy({
                query: query as never,
                select: { _id: true, name: true, hostIdentifier: true },
                limit: MAX_ROWS_PER_READ,
                skip: 0,
                props,
              });
            },
          );
        })
        .then((hosts: Array<DockerHost> | null) => {
          this.addNameMatches({
            kind: SecurityConnectionKind.DockerHost,
            rows: (hosts || []).map((host: DockerHost): NamedRow => {
              return {
                id: host.id!.toString(),
                name: host.name || host.hostIdentifier || "",
                identity: host.hostIdentifier || undefined,
                names: [host.hostIdentifier, host.name],
              };
            }),
            lookups,
            collector,
            exactReason: SecurityConnectionReason.HostName,
            allowShortName: true,
          });
        }),
      collector
        .read(SecurityConnectionKind.PodmanHost, async () => {
          return await readByColumns<PodmanHost>(
            ["hostIdentifier", "name"],
            async (
              query: Record<string, unknown>,
            ): Promise<Array<PodmanHost>> => {
              return await PodmanHostService.findBy({
                query: query as never,
                select: { _id: true, name: true, hostIdentifier: true },
                limit: MAX_ROWS_PER_READ,
                skip: 0,
                props,
              });
            },
          );
        })
        .then((hosts: Array<PodmanHost> | null) => {
          this.addNameMatches({
            kind: SecurityConnectionKind.PodmanHost,
            rows: (hosts || []).map((host: PodmanHost): NamedRow => {
              return {
                id: host.id!.toString(),
                name: host.name || host.hostIdentifier || "",
                identity: host.hostIdentifier || undefined,
                names: [host.hostIdentifier, host.name],
              };
            }),
            lookups,
            collector,
            exactReason: SecurityConnectionReason.HostName,
            allowShortName: true,
          });
        }),
      /*
       * A cluster by its k8s.cluster.name only, and only whole: a Kubernetes
       * audit event names the cluster it was written in exactly that way.
       */
      collector
        .read(SecurityConnectionKind.KubernetesCluster, async () => {
          return await KubernetesClusterService.findBy({
            query: {
              projectId,
              clusterIdentifier: QueryHelper.findWithSameTextAnyOf(
                lookups.hostNames,
              ),
            } as never,
            select: { _id: true, name: true, clusterIdentifier: true },
            limit: MAX_ROWS_PER_READ,
            skip: 0,
            props,
          });
        })
        .then((clusters: Array<KubernetesCluster> | null) => {
          this.addNameMatches({
            kind: SecurityConnectionKind.KubernetesCluster,
            rows: (clusters || []).map(
              (cluster: KubernetesCluster): NamedRow => {
                return {
                  id: cluster.id!.toString(),
                  name: cluster.name || cluster.clusterIdentifier || "",
                  identity: cluster.clusterIdentifier || undefined,
                  names: [cluster.clusterIdentifier],
                };
              },
            ),
            lookups,
            collector,
            exactReason: SecurityConnectionReason.ClusterName,
            allowShortName: false,
          });
        }),
      // A cloud by its openstack.cloud.name, which an audit event names it by, whole.
      collector
        .read(SecurityConnectionKind.OpenStackCloud, async () => {
          return await OpenStackCloudService.findBy({
            query: {
              projectId,
              name: QueryHelper.findWithSameTextAnyOf(lookups.hostNames),
            } as never,
            select: { _id: true, name: true },
            limit: MAX_ROWS_PER_READ,
            skip: 0,
            props,
          });
        })
        .then((clouds: Array<OpenStackCloud> | null) => {
          this.addNameMatches({
            kind: SecurityConnectionKind.OpenStackCloud,
            rows: (clouds || []).map((cloud: OpenStackCloud): NamedRow => {
              return {
                id: cloud.id!.toString(),
                name: cloud.name || "",
                identity: cloud.name || undefined,
                names: [cloud.name],
              };
            }),
            lookups,
            collector,
            exactReason: SecurityConnectionReason.CloudName,
            allowShortName: false,
          });
        }),
      collector
        .read(SecurityConnectionKind.NetworkDevice, async () => {
          return await readByColumns<NetworkDevice>(
            ["name", "hostname", "dnsName"],
            async (
              query: Record<string, unknown>,
            ): Promise<Array<NetworkDevice>> => {
              return await NetworkDeviceService.findBy({
                query: query as never,
                select: {
                  _id: true,
                  name: true,
                  hostname: true,
                  dnsName: true,
                },
                limit: MAX_ROWS_PER_READ,
                skip: 0,
                props,
              });
            },
          );
        })
        .then((devices: Array<NetworkDevice> | null) => {
          this.addNameMatches({
            kind: SecurityConnectionKind.NetworkDevice,
            rows: (devices || []).map((device: NetworkDevice): NamedRow => {
              return {
                id: device.id!.toString(),
                name: device.name || device.hostname || "",
                names: [device.name, device.hostname, device.dnsName],
              };
            }),
            lookups,
            collector,
            exactReason: SecurityConnectionReason.DeviceName,
            allowShortName: true,
          });
        }),
    ]);
  }

  /*
   * The hosts and network devices holding each address. How many hold it is
   * counted among all of the project's records (as OneUptime, never shown),
   * then the ones the caller may read are listed.
   */
  private static async matchAddresses(data: {
    projectId: ObjectID;
    lookups: SecurityConnectionLookups;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
  }): Promise<void> {
    const { lookups, collector, projectId } = data;

    if (lookups.addresses.length === 0) {
      return;
    }

    const entityByAddress: Map<string, SecurityEntity> = new Map();

    for (const entity of lookups.lookedUp) {
      const address: string | null = canonicalAddress(entity.value);

      if (address && !entityByAddress.has(address)) {
        entityByAddress.set(address, entity);
      }
    }

    const holders: Map<
      string,
      Array<{
        kind: SecurityConnectionKind;
        id: string;
        name: string;
        identity?: string;
      }>
    > = new Map();

    const hostsHolding: (
      address: string,
    ) => Promise<
      Array<{ id: string; name: string; identity?: string }>
    > = async (
      address: string,
    ): Promise<Array<{ id: string; name: string; identity?: string }>> => {
      const hosts: Array<Host> = await HostService.findBy({
        query: {
          projectId,
          hostIpAddresses: QueryHelper.search(address),
        },
        select: {
          _id: true,
          name: true,
          hostIdentifier: true,
          hostIpAddresses: true,
        },
        limit: MAX_ADDRESS_HOLDERS_READ,
        skip: 0,
        props: { isRoot: true },
      });

      // A search is a substring - 10.0.0.1 is in 10.0.0.10 - so each is held to the address.
      return hosts
        .filter((host: Host): boolean => {
          return recordReportsAddress(host.hostIpAddresses, address);
        })
        .map((host: Host): { id: string; name: string; identity?: string } => {
          return {
            id: host.id!.toString(),
            name: host.name || host.hostIdentifier || "",
            ...(host.hostIdentifier ? { identity: host.hostIdentifier } : {}),
          };
        });
    };

    const devicesHolding: (
      address: string,
    ) => Promise<Array<{ id: string; name: string }>> = async (
      address: string,
    ): Promise<Array<{ id: string; name: string }>> => {
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
              projectId,
              hostname: QueryHelper.findWithSameTextAnyOf([address]),
            } as never,
            select,
            limit: MAX_ADDRESS_HOLDERS_READ,
            skip: 0,
            props: { isRoot: true },
          }),
          NetworkDeviceService.findBy({
            query: {
              projectId,
              otherAddresses: QueryHelper.search(address),
            } as never,
            select,
            limit: MAX_ADDRESS_HOLDERS_READ,
            skip: 0,
            props: { isRoot: true },
          }),
        ]);
      const seen: Set<string> = new Set();

      return [...polled, ...other]
        .filter((device: NetworkDevice): boolean => {
          const id: string = device.id?.toString() || "";

          if (!id || seen.has(id)) {
            return false;
          }

          seen.add(id);

          return (
            canonicalAddress(device.hostname) === address ||
            recordReportsAddress(device.otherAddresses, address)
          );
        })
        .map((device: NetworkDevice): { id: string; name: string } => {
          return {
            id: device.id!.toString(),
            name: device.name || device.hostname || "",
          };
        });
    };

    /*
     * The cloud resources answering on an address, as a cloud connection's
     * inventory lists them: searched for as written and in its one
     * spelling (an endpoint is kept as the provider wrote it), then held to
     * the address itself.
     */
    const cloudResourcesHolding: (
      address: string,
    ) => Promise<Array<{ id: string; name: string }>> = async (
      address: string,
    ): Promise<Array<{ id: string; name: string }>> => {
      const resources: Array<CloudResource> = await CloudResourceService.findBy(
        {
          query: {
            projectId,
            cloudEndpoints: QueryHelper.textContainsAnyOf([
              address,
              entityByAddress.get(address)?.value || address,
            ]),
          } as never,
          select: { _id: true, name: true, cloudEndpoints: true },
          limit: MAX_ADDRESS_HOLDERS_READ,
          skip: 0,
          props: { isRoot: true },
        },
      );

      return resources
        .filter((resource: CloudResource): boolean => {
          return readCloudEndpointHosts(
            resource.cloudEndpoints,
          ).addresses.includes(address);
        })
        .map((resource: CloudResource): { id: string; name: string } => {
          return { id: resource.id!.toString(), name: resource.name || "" };
        });
    };

    const cloudHolders: Map<
      string,
      Array<{ id: string; name: string }>
    > = new Map();

    await Promise.all(
      lookups.addresses.map(async (address: string): Promise<void> => {
        const found: Array<{
          kind: SecurityConnectionKind;
          id: string;
          name: string;
          identity?: string;
        }> = [];

        const hosts: Array<{
          id: string;
          name: string;
          identity?: string;
        }> | null = await collector.read(
          SecurityConnectionKind.Host,
          async () => {
            return await hostsHolding(address);
          },
        );

        for (const host of hosts || []) {
          found.push({ kind: SecurityConnectionKind.Host, ...host });
        }

        const devices: Array<{ id: string; name: string }> | null =
          await collector.read(
            SecurityConnectionKind.NetworkDevice,
            async () => {
              return await devicesHolding(address);
            },
          );

        for (const device of devices || []) {
          found.push({ kind: SecurityConnectionKind.NetworkDevice, ...device });
        }

        holders.set(address, found);

        const resources: Array<{ id: string; name: string }> | null =
          await collector.read(
            SecurityConnectionKind.CloudResource,
            async () => {
              return await cloudResourcesHolding(address);
            },
          );

        cloudHolders.set(address, resources || []);
      }),
    );

    // Only the records the caller may read are listed.
    const visible: Set<string> = await this.readVisibleIds({
      projectId,
      props: data.props,
      collector,
      ids: [
        ...Array.from(holders.values()).flat(),
        ...Array.from(cloudHolders.values())
          .flat()
          .map((resource: { id: string; name: string }) => {
            return { kind: SecurityConnectionKind.CloudResource, ...resource };
          }),
      ],
    });

    const addHolders: (
      address: string,
      found: Array<{
        kind: SecurityConnectionKind;
        id: string;
        name: string;
        identity?: string;
      }>,
    ) => void = (
      address: string,
      found: Array<{
        kind: SecurityConnectionKind;
        id: string;
        name: string;
        identity?: string;
      }>,
    ): void => {
      const verdict: SecurityConnectionVerdict | null = matchAddress({
        address,
        holderCount: found.length,
      });

      if (!verdict) {
        return;
      }

      const entity: SecurityEntity = entityByAddress.get(address) || {
        type: SecurityEntityType.IpAddress,
        value: address,
      };

      for (const holder of found) {
        if (!visible.has(`${holder.kind}:${holder.id}`)) {
          continue;
        }

        collector.add({
          kind: holder.kind,
          id: holder.id,
          name: holder.name,
          identity: holder.identity,
          match: {
            entity,
            certainty: verdict.certainty,
            reason: verdict.reason,
            matchedValue: address,
          },
        });
      }
    };

    for (const [address, found] of Array.from(holders.entries())) {
      addHolders(address, found);
    }

    for (const [address, resources] of Array.from(cloudHolders.entries())) {
      addHolders(
        address,
        resources.map((resource: { id: string; name: string }) => {
          return { kind: SecurityConnectionKind.CloudResource, ...resource };
        }),
      );
    }
  }

  // Of these records, the ones the caller may read, as "kind:id".
  private static async readVisibleIds(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
    ids: Array<{ kind: SecurityConnectionKind; id: string }>;
  }): Promise<Set<string>> {
    const visible: Set<string> = new Set();

    if (data.props.isRoot) {
      for (const entry of data.ids) {
        visible.add(`${entry.kind}:${entry.id}`);
      }

      return visible;
    }

    const idsOf: (kind: SecurityConnectionKind) => Array<ObjectID> = (
      kind: SecurityConnectionKind,
    ): Array<ObjectID> => {
      return Array.from(
        new Set(
          data.ids
            .filter((entry: { kind: SecurityConnectionKind }): boolean => {
              return entry.kind === kind;
            })
            .map((entry: { id: string }): string => {
              return entry.id;
            }),
        ),
      ).map((id: string): ObjectID => {
        return new ObjectID(id);
      });
    };

    const hostIds: Array<ObjectID> = idsOf(SecurityConnectionKind.Host);
    const deviceIds: Array<ObjectID> = idsOf(
      SecurityConnectionKind.NetworkDevice,
    );
    const cloudResourceIds: Array<ObjectID> = idsOf(
      SecurityConnectionKind.CloudResource,
    );

    if (cloudResourceIds.length > 0) {
      const resources: Array<CloudResource> | null = await data.collector.read(
        SecurityConnectionKind.CloudResource,
        async () => {
          return await CloudResourceService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(cloudResourceIds),
            },
            select: { _id: true },
            limit: cloudResourceIds.length,
            skip: 0,
            props: data.props,
          });
        },
      );

      for (const resource of resources || []) {
        visible.add(
          `${SecurityConnectionKind.CloudResource}:${resource.id!.toString()}`,
        );
      }
    }

    if (hostIds.length > 0) {
      const hosts: Array<Host> | null = await data.collector.read(
        SecurityConnectionKind.Host,
        async () => {
          return await HostService.findBy({
            query: { projectId: data.projectId, _id: QueryHelper.any(hostIds) },
            select: { _id: true },
            limit: hostIds.length,
            skip: 0,
            props: data.props,
          });
        },
      );

      for (const host of hosts || []) {
        visible.add(`${SecurityConnectionKind.Host}:${host.id!.toString()}`);
      }
    }

    if (deviceIds.length > 0) {
      const devices: Array<NetworkDevice> | null = await data.collector.read(
        SecurityConnectionKind.NetworkDevice,
        async () => {
          return await NetworkDeviceService.findBy({
            query: {
              projectId: data.projectId,
              _id: QueryHelper.any(deviceIds),
            },
            select: { _id: true },
            limit: deviceIds.length,
            skip: 0,
            props: data.props,
          });
        },
      );

      for (const device of devices || []) {
        visible.add(
          `${SecurityConnectionKind.NetworkDevice}:${device.id!.toString()}`,
        );
      }
    }

    return visible;
  }

  /*
   * The cloud resources a case names: by their own IDs (an ARN, an Azure
   * resource ID, a Google Cloud resource name - exact, however typed), and
   * by the host names they answer on (a load balancer's DNS name - exact
   * when the event says the value is a host or a domain). Never by a short
   * form: an endpoint's first label names nothing on its own. Their
   * addresses are matched with the other records' (matchAddresses), and
   * the ones whose logs an event was read from by their ids.
   */
  private static async matchCloudResources(data: {
    projectId: ObjectID;
    lookups: SecurityConnectionLookups;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
  }): Promise<void> {
    const { lookups, collector, projectId, props } = data;
    const reads: Array<Promise<void>> = [];

    if (lookups.resourceIds.length > 0) {
      const entityById: Map<string, SecurityEntity> = new Map();

      for (const entity of lookups.lookedUp) {
        entityById.set(foldConnectionValue(entity.value), entity);
      }

      reads.push(
        collector
          .read(SecurityConnectionKind.CloudResource, async () => {
            return await CloudResourceService.findBy({
              query: {
                projectId,
                providerResourceId: QueryHelper.findWithSameTextAnyOf(
                  lookups.resourceIds,
                ),
              } as never,
              select: { _id: true, name: true, providerResourceId: true },
              limit: MAX_ROWS_PER_READ,
              skip: 0,
              props,
            });
          })
          .then((resources: Array<CloudResource> | null) => {
            for (const resource of resources || []) {
              for (const resourceId of lookups.resourceIds) {
                const entity: SecurityEntity = entityById.get(resourceId) || {
                  type: SecurityEntityType.Other,
                  value: resourceId,
                };
                const verdict: SecurityConnectionVerdict | null =
                  matchResourceId({
                    entityValue: entity.value,
                    providerResourceId: resource.providerResourceId,
                  });

                if (verdict) {
                  collector.add({
                    kind: SecurityConnectionKind.CloudResource,
                    id: resource.id!.toString(),
                    name: resource.name || resource.providerResourceId || "",
                    match: {
                      entity,
                      certainty: verdict.certainty,
                      reason: verdict.reason,
                      matchedValue: (resource.providerResourceId || "").trim(),
                    },
                  });
                }
              }
            }
          }),
      );
    }

    if (lookups.hostNames.length > 0) {
      reads.push(
        collector
          .read(SecurityConnectionKind.CloudResource, async () => {
            return await CloudResourceService.findBy({
              query: {
                projectId,
                cloudEndpoints: QueryHelper.textContainsAnyOf(
                  lookups.hostNames,
                ),
              } as never,
              select: { _id: true, name: true, cloudEndpoints: true },
              limit: MAX_ROWS_PER_READ,
              skip: 0,
              props,
            });
          })
          .then((resources: Array<CloudResource> | null) => {
            this.addNameMatches({
              kind: SecurityConnectionKind.CloudResource,
              rows: (resources || []).map(
                (resource: CloudResource): NamedRow => {
                  return {
                    id: resource.id!.toString(),
                    name: resource.name || "",
                    names: readCloudEndpointHosts(resource.cloudEndpoints)
                      .names,
                  };
                },
              ),
              lookups,
              collector,
              exactReason: SecurityConnectionReason.CloudEndpoint,
              allowShortName: false,
            });
          }),
      );
    }

    await Promise.all(reads);
  }

  /*
   * The monitors that check what a case names - a host or a domain, an
   * address, the host of a URL - read with the caller's own permissions.
   * The project's monitors are narrowed in the database to those whose
   * steps hold one of the values where a step holds a host it checks
   * (getMonitorMentionTexts), then each is held to the hosts it really
   * checks (getMonitorTargetHosts): a mention in a header or a criterion
   * is no target. An archived monitor
   * checks nothing and is left out. Each carries its current status.
   */
  private static async matchMonitors(data: {
    projectId: ObjectID;
    lookups: SecurityConnectionLookups;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
  }): Promise<void> {
    const { lookups, collector, projectId, props } = data;
    const mentions: Array<string> = getMonitorMentionTexts(lookups);

    if (mentions.length === 0) {
      return;
    }

    const monitors: Array<Monitor> | null = await collector.read(
      SecurityConnectionKind.Monitor,
      async () => {
        return await MonitorService.findBy({
          query: {
            projectId,
            isArchived: false,
            monitorSteps: QueryHelper.textContainsAnyOf(mentions),
          } as never,
          select: {
            _id: true,
            name: true,
            monitorSteps: true,
            currentMonitorStatus: { name: true, color: true },
          },
          sort: { name: SortOrder.Ascending },
          limit: MAX_MONITORS_READ,
          skip: 0,
          props,
        });
      },
    );

    // The values a monitor's targets are held to, each with the entity it came from.
    const values: Array<SecurityEntity> = [
      ...lookups.hostNames.map((hostName: string): SecurityEntity => {
        return (
          lookups.hostNameEntities.get(hostName) || {
            type: SecurityEntityType.Host,
            value: hostName,
          }
        );
      }),
      ...lookups.urlHosts.map((host: string): SecurityEntity => {
        return (
          lookups.urlHostEntities.get(host) || {
            type: SecurityEntityType.Url,
            value: host,
          }
        );
      }),
      ...lookups.addresses.map((address: string): SecurityEntity => {
        return (
          lookups.lookedUp.find((entity: SecurityEntity): boolean => {
            return canonicalAddress(entity.value) === address;
          }) || { type: SecurityEntityType.IpAddress, value: address }
        );
      }),
    ];

    for (const monitor of monitors || []) {
      const targets: Array<string> = getMonitorTargetHosts(
        monitor.monitorSteps,
      );
      const status: SecurityConnectionStatusJson | undefined = monitor
        .currentMonitorStatus?.name
        ? {
            name: monitor.currentMonitorStatus.name,
            ...(monitor.currentMonitorStatus.color
              ? { color: monitor.currentMonitorStatus.color.toString() }
              : {}),
          }
        : undefined;

      for (const entity of values) {
        let best: {
          verdict: SecurityConnectionVerdict;
          target: string;
        } | null = null;

        for (const target of targets) {
          const verdict: SecurityConnectionVerdict | null = matchMonitorTarget({
            entityValue: entity.value,
            entityType: entity.type,
            target,
          });

          if (
            verdict &&
            (!best ||
              (verdict.certainty === SecurityConnectionCertainty.Exact &&
                best.verdict.certainty !== SecurityConnectionCertainty.Exact))
          ) {
            best = { verdict, target };
          }
        }

        if (best) {
          collector.add({
            kind: SecurityConnectionKind.Monitor,
            id: monitor.id!.toString(),
            name: monitor.name || best.target,
            status,
            match: {
              entity,
              certainty: best.verdict.certainty,
              reason: best.verdict.reason,
              matchedValue: best.target,
            },
          });
        }
      }
    }
  }

  /*
   * The project's members an email names. Users are found by email as
   * OneUptime (an email is never readable across projects otherwise), with
   * their names, then kept only when the caller's own read of the project's
   * members finds them - a read of the memberships alone, since a member's
   * user is a column fewer of a membership's readers may read (Current
   * User reads its own membership, not who it is).
   */
  private static async matchMembers(data: {
    projectId: ObjectID;
    lookups: SecurityConnectionLookups;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
  }): Promise<void> {
    const { lookups, collector } = data;

    if (lookups.emails.length === 0) {
      return;
    }

    const users: Array<User> | null = await collector.read(
      SecurityConnectionKind.User,
      async () => {
        return await UserService.findBy({
          query: {
            email: QueryHelper.findWithSameTextAnyOf(lookups.emails),
          } as never,
          select: { _id: true, name: true, email: true },
          limit: MAX_ROWS_PER_READ,
          skip: 0,
          props: { isRoot: true },
        });
      },
    );

    const usersById: Map<string, User> = new Map();

    for (const user of users || []) {
      if (user.id) {
        usersById.set(user.id.toString(), user);
      }
    }

    if (usersById.size === 0) {
      return;
    }

    const members: Array<TeamMember> | null = await collector.read(
      SecurityConnectionKind.User,
      async () => {
        return await TeamMemberService.findBy({
          query: {
            projectId: data.projectId,
            userId: QueryHelper.any(
              Array.from(usersById.keys()).map((id: string): ObjectID => {
                return new ObjectID(id);
              }),
            ),
          },
          select: { userId: true },
          limit: MAX_ROWS_PER_READ,
          skip: 0,
          props: data.props,
        });
      },
    );

    const entityByEmail: Map<string, SecurityEntity> = new Map();

    for (const entity of lookups.lookedUp) {
      entityByEmail.set(foldConnectionValue(entity.value), entity);
    }

    for (const member of members || []) {
      const id: string = member.userId?.toString() || "";
      const user: User | undefined = usersById.get(id);
      const email: string = user?.email?.toString() || "";
      const entity: SecurityEntity | undefined = entityByEmail.get(
        foldConnectionValue(email),
      );

      if (!id || !entity) {
        continue;
      }

      const verdict: SecurityConnectionVerdict | null = matchEmail({
        entityValue: entity.value,
        email,
      });

      if (verdict) {
        collector.add({
          kind: SecurityConnectionKind.User,
          id,
          name: user?.name?.toString() || email,
          match: {
            entity,
            certainty: verdict.certainty,
            reason: verdict.reason,
            matchedValue: email,
          },
        });
      }
    }
  }

  // The records the events' log lines were sent under: exactly, by id.
  private static async matchLogResources(data: {
    projectId: ObjectID;
    logResources: ReadonlyArray<SecurityLogResource>;
    props: DatabaseCommonInteractionProps;
    collector: Collector;
  }): Promise<void> {
    const idsByKind: Map<SecurityConnectionKind, Set<string>> = new Map();

    for (const resource of data.logResources) {
      const kind: SecurityConnectionKind | null = getLogResourceKind(
        resource.type,
      );

      if (!kind || !ObjectID.isValidUUID(resource.id)) {
        continue;
      }

      const ids: Set<string> = idsByKind.get(kind) || new Set();
      ids.add(resource.id);
      idsByKind.set(kind, ids);
    }

    await Promise.all(
      Array.from(idsByKind.entries()).map(
        async ([kind, idSet]: [
          SecurityConnectionKind,
          Set<string>,
        ]): Promise<void> => {
          const ids: Array<ObjectID> = Array.from(idSet)
            .slice(0, MAX_ROWS_PER_READ)
            .map((id: string): ObjectID => {
              return new ObjectID(id);
            });

          const rows: Array<{
            id: string;
            name: string;
            identity?: string;
          }> | null = await data.collector.read(kind, async () => {
            return await this.readNamesById({
              kind,
              ids,
              projectId: data.projectId,
              props: data.props,
            });
          });

          for (const row of rows || []) {
            data.collector.add({
              kind,
              id: row.id,
              name: row.name,
              identity: row.identity,
              match: {
                entity: { type: SecurityEntityType.Other, value: row.name },
                certainty: SecurityConnectionCertainty.Exact,
                reason: SecurityConnectionReason.LogSource,
                matchedValue: row.name,
              },
            });
          }
        },
      ),
    );
  }

  /*
   * The names of the records log lines and spans were sent under, by
   * "kind:id" - the records whose logs and traces named a value a case
   * names (SecurityTelemetryMentions) - read with the caller's own
   * permissions, at most MAX_ROWS_PER_READ of each kind. A record of a
   * kind the caller's role cannot read, or whose read failed, is not named:
   * it is left out of what is listed, never shown by its id alone.
   */
  @CaptureSpan()
  public static async readNamesOfLogResources(data: {
    projectId: ObjectID;
    resources: ReadonlyArray<SecurityLogResource>;
    props: DatabaseCommonInteractionProps;
  }): Promise<Map<string, { kind: SecurityConnectionKind; name: string }>> {
    const idsByKind: Map<SecurityConnectionKind, Set<string>> = new Map();

    for (const resource of data.resources) {
      const kind: SecurityConnectionKind | null = getLogResourceKind(
        resource.type,
      );

      if (!kind || !ObjectID.isValidUUID(resource.id)) {
        continue;
      }

      const ids: Set<string> = idsByKind.get(kind) || new Set();

      if (ids.size < MAX_ROWS_PER_READ) {
        ids.add(resource.id.toLowerCase());
      }

      idsByKind.set(kind, ids);
    }

    const names: Map<string, { kind: SecurityConnectionKind; name: string }> =
      new Map();

    await Promise.all(
      Array.from(idsByKind.entries()).map(
        async ([kind, ids]: [
          SecurityConnectionKind,
          Set<string>,
        ]): Promise<void> => {
          try {
            const rows: Array<{ id: string; name: string }> =
              await this.readNamesById({
                kind,
                ids: Array.from(ids).map((id: string): ObjectID => {
                  return new ObjectID(id);
                }),
                projectId: data.projectId,
                props: data.props,
              });

            for (const row of rows) {
              if (row.name) {
                names.set(`${kind}:${row.id.toLowerCase()}`, {
                  kind,
                  name: row.name,
                });
              }
            }
          } catch (error) {
            if (!isRefusedRead(error)) {
              logger.error(
                `Security connections: the names of the ${kind} records could not be read: ${error}`,
              );
            }
          }
        },
      ),
    );

    return names;
  }

  private static async readNamesById(data: {
    kind: SecurityConnectionKind;
    ids: Array<ObjectID>;
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<Array<{ id: string; name: string; identity?: string }>> {
    const query: { projectId: ObjectID; _id: unknown } = {
      projectId: data.projectId,
      _id: QueryHelper.any(data.ids),
    };
    const common: {
      limit: number;
      skip: number;
      props: DatabaseCommonInteractionProps;
    } = { limit: data.ids.length, skip: 0, props: data.props };

    switch (data.kind) {
      case SecurityConnectionKind.Service:
        return (
          await ServiceService.findBy({
            query: query as never,
            select: { _id: true, name: true },
            ...common,
          })
        ).map(
          (
            row: ServiceModel,
          ): { id: string; name: string; identity?: string } => {
            return {
              id: row.id!.toString(),
              name: row.name || "",
              ...(row.name ? { identity: row.name } : {}),
            };
          },
        );
      case SecurityConnectionKind.Host:
        return (
          await HostService.findBy({
            query: query as never,
            select: { _id: true, name: true, hostIdentifier: true },
            ...common,
          })
        ).map((row: Host): { id: string; name: string; identity?: string } => {
          return {
            id: row.id!.toString(),
            name: row.name || row.hostIdentifier || "",
            ...(row.hostIdentifier ? { identity: row.hostIdentifier } : {}),
          };
        });
      case SecurityConnectionKind.DockerHost:
        return (
          await DockerHostService.findBy({
            query: query as never,
            select: { _id: true, name: true, hostIdentifier: true },
            ...common,
          })
        ).map((row: DockerHost): { id: string; name: string } => {
          return {
            id: row.id!.toString(),
            name: row.name || row.hostIdentifier || "",
          };
        });
      case SecurityConnectionKind.PodmanHost:
        return (
          await PodmanHostService.findBy({
            query: query as never,
            select: { _id: true, name: true, hostIdentifier: true },
            ...common,
          })
        ).map((row: PodmanHost): { id: string; name: string } => {
          return {
            id: row.id!.toString(),
            name: row.name || row.hostIdentifier || "",
          };
        });
      case SecurityConnectionKind.KubernetesCluster:
        return (
          await KubernetesClusterService.findBy({
            query: query as never,
            select: { _id: true, name: true, clusterIdentifier: true },
            ...common,
          })
        ).map(
          (
            row: KubernetesCluster,
          ): { id: string; name: string; identity?: string } => {
            return {
              id: row.id!.toString(),
              name: row.name || row.clusterIdentifier || "",
              ...(row.clusterIdentifier
                ? { identity: row.clusterIdentifier }
                : {}),
            };
          },
        );
      case SecurityConnectionKind.OpenStackCloud:
        return (
          await OpenStackCloudService.findBy({
            query: query as never,
            select: { _id: true, name: true },
            ...common,
          })
        ).map(
          (
            row: OpenStackCloud,
          ): { id: string; name: string; identity?: string } => {
            return {
              id: row.id!.toString(),
              name: row.name || "",
              ...(row.name ? { identity: row.name } : {}),
            };
          },
        );
      case SecurityConnectionKind.NetworkDevice:
        return (
          await NetworkDeviceService.findBy({
            query: query as never,
            select: { _id: true, name: true, hostname: true },
            ...common,
          })
        ).map((row: NetworkDevice): { id: string; name: string } => {
          return {
            id: row.id!.toString(),
            name: row.name || row.hostname || "",
          };
        });
      case SecurityConnectionKind.CloudResource:
        return (
          await CloudResourceService.findBy({
            query: query as never,
            select: { _id: true, name: true, providerResourceId: true },
            ...common,
          })
        ).map((row: CloudResource): { id: string; name: string } => {
          return {
            id: row.id!.toString(),
            name: row.name || row.providerResourceId || "",
          };
        });
      case SecurityConnectionKind.ServerlessFunction:
        return (
          await ServerlessFunctionService.findBy({
            query: query as never,
            select: { _id: true, name: true, functionIdentifier: true },
            ...common,
          })
        ).map(
          (
            row: ServerlessFunction,
          ): { id: string; name: string; identity?: string } => {
            return {
              id: row.id!.toString(),
              name: row.name || row.functionIdentifier || "",
              ...(row.functionIdentifier
                ? { identity: row.functionIdentifier }
                : {}),
            };
          },
        );
      default:
        return [];
    }
  }
}
