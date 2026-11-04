import CloudResource from "../../../../Models/DatabaseModels/CloudResource";
import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import InventoryItem from "../../../../Models/DatabaseModels/InventoryItem";
import { JSONObject } from "../../../../Types/JSON";
import EntityType from "../../../../Types/Telemetry/EntityType";
import InventoryItemService from "../../../Services/InventoryItemService";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import OpenStackCloud from "../../../../Models/DatabaseModels/OpenStackCloud";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import ServerlessFunction from "../../../../Models/DatabaseModels/ServerlessFunction";
import SecurityEvent from "../../../../Models/AnalyticsModels/SecurityEvent";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityEntityRisk from "../../../../Models/DatabaseModels/SecurityEntityRisk";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  RESOURCE_SECURITY_MAX_CASES,
  RESOURCE_SECURITY_WINDOW_IN_DAYS,
  ResourceSecurityCaseJson,
  ResourceSecurityJson,
  SecurityConnectionKind,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  SecurityEntityType,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  SecurityAddressScope,
  canonicalAddress,
  getMonitorTargetHosts,
  getObservableSearchValues,
  getRecordSecurityValues,
  getSecurityAddressScope,
  readCloudEndpointHosts,
  readRecordAddresses,
  recordReportsAddress,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import { getEntityRiskKey } from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import CloudResourceService from "../../../Services/CloudResourceService";
import DockerHostService from "../../../Services/DockerHostService";
import HostService from "../../../Services/HostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import OpenStackCloudService from "../../../Services/OpenStackCloudService";
import MonitorService from "../../../Services/MonitorService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import PodmanHostService from "../../../Services/PodmanHostService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import ServerlessFunctionService from "../../../Services/ServerlessFunctionService";
import SecurityEntityRiskService from "../../../Services/SecurityEntityRiskService";
import SecurityEventService, {
  SecurityEventsNamingSummary,
} from "../../../Services/SecurityEventService";
import ServiceService from "../../../Services/ServiceService";
import TeamMemberService from "../../../Services/TeamMemberService";
import UserService from "../../../Services/UserService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import SecurityCaseValues from "../../SecurityCase/SecurityCaseValues";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import TelemetryReadAccess from "../../Telemetry/TelemetryReadAccess";
import {
  MAX_ADDRESS_HOLDERS_READ,
  isRefusedRead,
} from "./SecurityConnectedRecords";

/*
 * THE WAY BACK: what Security Events says about one of the project's own
 * records - a host, a Docker or Podman host, a Kubernetes cluster, a network
 * device, a cloud resource, a serverless function, a service, a monitor, a
 * member - for the Security card on its page.
 *
 * A record is searched for by its exact identities only, the ones that
 * make an exact connection (SecurityConnectionMatch): its names (a host's
 * host.name and display name, a cluster's k8s.cluster.name, a device's
 * name and DNS name, a cloud resource's own ID and the names it answers
 * on, the hosts a monitor checks, a member's email) and its public
 * addresses - for a host or a device the ones no other host or device of
 * the project holds, for a cloud resource the ones no other cloud resource
 * answers on, for a monitor every public address it checks. A service and
 * a serverless function are searched for by their logs: the events "Your
 * logs" read from them; so is a cloud resource with no ID, name or address
 * of its own. Possible connections - a short name, a private or shared
 * address - are left out here: a guess must never put a case on the wrong
 * host's page. A case's Connected Signals still shows them, said to be
 * possible.
 *
 * Over the last RESOURCE_SECURITY_WINDOW_IN_DAYS days (the week an entity's
 * risk is counted over): how many events and findings name it, the open
 * cases whose entities name it, and its highest risk. Every read is inside
 * the project, bounded, with the caller's own permissions - the events
 * counted are those of the sources the caller may read; a project with
 * no security event in the window is told so in one read, and nothing else
 * is read.
 */

// What a case summary selects: what a page lists a case by.
export const SECURITY_CASE_SUMMARY_SELECT: {
  _id: true;
  caseNumberWithPrefix: true;
  title: true;
  lastDetectedAt: true;
  entities: true;
  securityCasePriority: { name: true; color: true };
  securityCaseStatus: { name: true; color: true };
} = {
  _id: true,
  caseNumberWithPrefix: true,
  title: true,
  lastDetectedAt: true,
  entities: true,
  securityCasePriority: { name: true, color: true },
  securityCaseStatus: { name: true, color: true },
};

// A case as another product's page lists it: its number, title, priority and status.
export function toResourceSecurityCaseJson(
  securityCase: SecurityCase,
): ResourceSecurityCaseJson {
  return {
    id: securityCase.id?.toString() || "",
    number: securityCase.caseNumberWithPrefix || "",
    title: securityCase.title || "",
    ...(securityCase.securityCasePriority?.name
      ? { priorityName: securityCase.securityCasePriority.name }
      : {}),
    ...(securityCase.securityCasePriority?.color
      ? {
          priorityColor: securityCase.securityCasePriority.color.toString(),
        }
      : {}),
    ...(securityCase.securityCaseStatus?.name
      ? { statusName: securityCase.securityCaseStatus.name }
      : {}),
    ...(securityCase.securityCaseStatus?.color
      ? { statusColor: securityCase.securityCaseStatus.color.toString() }
      : {}),
    ...(securityCase.lastDetectedAt
      ? {
          lastDetectedAt: new Date(securityCase.lastDetectedAt).toISOString(),
        }
      : {}),
  };
}

/*
 * The inventory items that are machines, named the way security tools name
 * machines: a host, a node, a container host, a device, a VM, an appliance.
 */
export const INVENTORY_MACHINE_TYPES: ReadonlyArray<EntityType> = [
  EntityType.Host,
  EntityType.KubernetesNode,
  EntityType.KubernetesCluster,
  EntityType.DockerHost,
  EntityType.PodmanHost,
  EntityType.NetworkDevice,
  EntityType.VMwareHost,
  EntityType.VMwareVirtualMachine,
  EntityType.ProxmoxNode,
  EntityType.ProxmoxGuest,
  EntityType.Appliance,
];

// The identifying attributes a machine's item is named by.
export const INVENTORY_NAME_ATTRIBUTES: ReadonlyArray<string> = [
  "host.name",
  "k8s.node.name",
  "k8s.cluster.name",
];

function readAttributeText(
  attributes: JSONObject | undefined | null,
  key: string,
): string | undefined {
  const value: unknown = attributes ? attributes[key] : undefined;

  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

/*
 * Among whose addresses a record's public address has to be its own to be
 * searched for: a host's or a device's among the hosts and devices, a
 * cloud resource's among the cloud resources (an instance and the host it
 * runs are one machine seen twice). A monitor checks an address whoever
 * else holds it, so every public address it checks is searched for.
 */
export enum ResourceAddressOwnership {
  HostsAndDevices = "HostsAndDevices",
  CloudResources = "CloudResources",
  Checked = "Checked",
}

export interface ResourceSecurityIdentity {
  name: string;
  // Names and addresses, before the public addresses are held to being nobody else's.
  names: Array<string | undefined | null>;
  addresses?: string | Array<string> | undefined | null;
  // Whose addresses its own are counted among; hosts and devices when not said.
  addressOwnership?: ResourceAddressOwnership | undefined;
  // The entity its Security Events page opens on.
  entity: SecurityEntity | null;
  // Searched for by the events read from its logs instead of by name.
  isSearchedByLogs: boolean;
  // Searched for by its logs when it has no name or address of its own to search for.
  isSearchedByLogsWithoutValues?: boolean | undefined;
}

export default class ResourceSecurity {
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    kind: SecurityConnectionKind;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
    now?: Date | undefined;
  }): Promise<ResourceSecurityJson | null> {
    const identity: ResourceSecurityIdentity | null =
      await this.readIdentity(data);

    if (!identity) {
      return null;
    }

    const now: Date = data.now || OneUptimeDate.getCurrentDate();
    const startTime: Date = OneUptimeDate.addRemoveDays(
      now,
      -RESOURCE_SECURITY_WINDOW_IN_DAYS,
    );

    const result: ResourceSecurityJson = {
      kind: data.kind,
      id: data.id.toString(),
      name: identity.name,
      isInUse: false,
      windowDays: RESOURCE_SECURITY_WINDOW_IN_DAYS,
      values: [],
      isSearchedByLogs: identity.isSearchedByLogs,
      entity: identity.entity,
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
      openCases: null,
      risk: null,
    };

    /*
     * Whether the project uses Security Events at all, from any source: not
     * a count of anyone's events, so a reader whose own sources were quiet
     * this week is still shown the record's open cases and risk.
     */
    result.isInUse = await SecurityEventService.hasEventsSince({
      projectId: data.projectId,
      startTime,
    });

    if (!result.isInUse) {
      return result;
    }

    const ownValues: Array<string> = identity.isSearchedByLogs
      ? []
      : await this.keepOwnAddresses({
          projectId: data.projectId,
          id: data.id,
          values: getRecordSecurityValues({
            names: identity.names,
            addresses: identity.addresses,
          }),
          ownership:
            identity.addressOwnership ||
            ResourceAddressOwnership.HostsAndDevices,
        });
    const isSearchedByLogs: boolean =
      identity.isSearchedByLogs ||
      (Boolean(identity.isSearchedByLogsWithoutValues) &&
        ownValues.length === 0);
    const values: Array<string> = isSearchedByLogs ? [] : ownValues;

    result.values = values;
    result.isSearchedByLogs = isSearchedByLogs;

    const summary: SecurityEventsNamingSummary =
      await SecurityEventService.countEventsNaming({
        projectId: data.projectId,
        values: getObservableSearchValues(values),
        ...(isSearchedByLogs ? { logResourceId: data.id } : {}),
        startTime,
        endTime: now,
        // Only the events of the sources the caller may read.
        serviceFilter: await TelemetryReadAccess.getServiceFilter({
          modelType: SecurityEvent,
          props: data.props,
        }),
      });

    result.eventCount = summary.eventCount;
    result.findingCount = summary.findingCount;
    result.maxSeverityId = summary.maxSeverityId;
    result.lastSeen = summary.lastSeen ? summary.lastSeen.toISOString() : null;

    if (values.length > 0) {
      const [openCases, risk]: [
        ResourceSecurityJson["openCases"],
        ResourceSecurityJson["risk"],
      ] = await Promise.all([
        this.readOpenCases({ ...data, values }),
        this.readRisk({ ...data, values }),
      ]);

      result.openCases = openCases;
      result.risk = risk;
    }

    return result;
  }

  /*
   * The record as the caller may read it, and what it is known by. Null
   * when it is not this project's, or the caller may not read it.
   */
  public static async readIdentity(data: {
    projectId: ObjectID;
    kind: SecurityConnectionKind;
    id: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<ResourceSecurityIdentity | null> {
    const query: { projectId: ObjectID; _id: string } = {
      projectId: data.projectId,
      _id: data.id.toString(),
    };

    switch (data.kind) {
      case SecurityConnectionKind.Host: {
        const host: Host | null = await HostService.findOneBy({
          query,
          select: {
            _id: true,
            name: true,
            hostIdentifier: true,
            hostIpAddresses: true,
          },
          props: data.props,
        });

        if (!host) {
          return null;
        }

        const main: string = host.hostIdentifier || host.name || "";

        return {
          name: host.name || host.hostIdentifier || "",
          names: [host.hostIdentifier, host.name],
          addresses: host.hostIpAddresses,
          entity: main ? { type: SecurityEntityType.Host, value: main } : null,
          isSearchedByLogs: false,
        };
      }
      case SecurityConnectionKind.DockerHost:
      case SecurityConnectionKind.PodmanHost: {
        const host: DockerHost | PodmanHost | null =
          data.kind === SecurityConnectionKind.DockerHost
            ? await DockerHostService.findOneBy({
                query,
                select: { _id: true, name: true, hostIdentifier: true },
                props: data.props,
              })
            : await PodmanHostService.findOneBy({
                query,
                select: { _id: true, name: true, hostIdentifier: true },
                props: data.props,
              });

        if (!host) {
          return null;
        }

        const main: string = host.hostIdentifier || host.name || "";

        return {
          name: host.name || host.hostIdentifier || "",
          names: [host.hostIdentifier, host.name],
          entity: main ? { type: SecurityEntityType.Host, value: main } : null,
          isSearchedByLogs: false,
        };
      }
      case SecurityConnectionKind.KubernetesCluster: {
        const cluster: KubernetesCluster | null =
          await KubernetesClusterService.findOneBy({
            query,
            select: { _id: true, name: true, clusterIdentifier: true },
            props: data.props,
          });

        if (!cluster) {
          return null;
        }

        return {
          name: cluster.name || cluster.clusterIdentifier || "",
          // A Kubernetes audit event names its cluster by k8s.cluster.name.
          names: [cluster.clusterIdentifier],
          entity: cluster.clusterIdentifier
            ? {
                type: SecurityEntityType.Host,
                value: cluster.clusterIdentifier,
              }
            : null,
          isSearchedByLogs: false,
        };
      }
      case SecurityConnectionKind.OpenStackCloud: {
        const cloud: OpenStackCloud | null =
          await OpenStackCloudService.findOneBy({
            query,
            select: { _id: true, name: true },
            props: data.props,
          });

        if (!cloud) {
          return null;
        }

        return {
          name: cloud.name || "",
          /*
           * An audit event names its cloud by openstack.cloud.name, and what the events
           * read from its logs name is why they were read: its users, its projects.
           */
          names: [cloud.name],
          entity: cloud.name
            ? { type: SecurityEntityType.Host, value: cloud.name }
            : null,
          isSearchedByLogs: false,
          isSearchedByLogsWithoutValues: true,
        };
      }
      case SecurityConnectionKind.NetworkDevice: {
        const device: NetworkDevice | null =
          await NetworkDeviceService.findOneBy({
            query,
            select: {
              _id: true,
              name: true,
              hostname: true,
              dnsName: true,
              otherAddresses: true,
            },
            props: data.props,
          });

        if (!device) {
          return null;
        }

        // Its hostname may be an address: an address counts as one, never as a name.
        const hostnameIsAddress: boolean =
          readRecordAddresses(device.hostname).length > 0;

        return {
          name: device.name || device.hostname || "",
          names: [
            device.name,
            device.dnsName,
            hostnameIsAddress ? undefined : device.hostname,
          ],
          addresses: [
            ...(hostnameIsAddress && device.hostname ? [device.hostname] : []),
            ...readRecordAddresses(device.otherAddresses),
          ],
          entity: device.name
            ? { type: SecurityEntityType.Host, value: device.name }
            : null,
          isSearchedByLogs: false,
        };
      }
      case SecurityConnectionKind.CloudResource: {
        const resource: CloudResource | null =
          await CloudResourceService.findOneBy({
            query,
            select: {
              _id: true,
              name: true,
              providerResourceId: true,
              cloudEndpoints: true,
            },
            props: data.props,
          });

        if (!resource) {
          return null;
        }

        const endpoints: { names: Array<string>; addresses: Array<string> } =
          readCloudEndpointHosts(resource.cloudEndpoints);
        const providerResourceId: string = (
          resource.providerResourceId || ""
        ).trim();
        const publicAddress: string | undefined = endpoints.addresses.find(
          (address: string): boolean => {
            return (
              getSecurityAddressScope(address) === SecurityAddressScope.Public
            );
          },
        );
        /*
         * Its Security Events page opens on the name it answers on, else
         * its public address, else its ID: what an event names it by most.
         */
        const entity: SecurityEntity | null = endpoints.names[0]
          ? { type: SecurityEntityType.Host, value: endpoints.names[0] }
          : publicAddress
            ? { type: SecurityEntityType.IpAddress, value: publicAddress }
            : providerResourceId
              ? { type: SecurityEntityType.Other, value: providerResourceId }
              : null;

        return {
          name: resource.name || providerResourceId,
          names: [providerResourceId, ...endpoints.names],
          addresses: endpoints.addresses,
          addressOwnership: ResourceAddressOwnership.CloudResources,
          entity,
          isSearchedByLogs: false,
          isSearchedByLogsWithoutValues: true,
        };
      }
      case SecurityConnectionKind.ServerlessFunction: {
        const serverlessFunction: ServerlessFunction | null =
          await ServerlessFunctionService.findOneBy({
            query,
            select: { _id: true, name: true, functionIdentifier: true },
            props: data.props,
          });

        if (!serverlessFunction) {
          return null;
        }

        return {
          name:
            serverlessFunction.name ||
            serverlessFunction.functionIdentifier ||
            "",
          names: [],
          entity: null,
          isSearchedByLogs: true,
        };
      }
      case SecurityConnectionKind.Monitor: {
        const monitor: Monitor | null = await MonitorService.findOneBy({
          query,
          select: { _id: true, name: true, monitorSteps: true },
          props: data.props,
        });

        if (!monitor) {
          return null;
        }

        const targets: Array<string> = getMonitorTargetHosts(
          monitor.monitorSteps,
        );
        const addresses: Array<string> = targets.filter(
          (target: string): boolean => {
            return Boolean(canonicalAddress(target));
          },
        );
        const names: Array<string> = targets.filter(
          (target: string): boolean => {
            return !canonicalAddress(target);
          },
        );
        // A private address is never searched for, so it is no page to open either.
        const publicAddress: string | undefined = addresses.find(
          (address: string): boolean => {
            return (
              getSecurityAddressScope(address) === SecurityAddressScope.Public
            );
          },
        );

        return {
          name: monitor.name || targets[0] || "",
          names,
          addresses,
          addressOwnership: ResourceAddressOwnership.Checked,
          entity: names[0]
            ? { type: SecurityEntityType.Host, value: names[0] }
            : publicAddress
              ? { type: SecurityEntityType.IpAddress, value: publicAddress }
              : null,
          isSearchedByLogs: false,
        };
      }
      case SecurityConnectionKind.Service: {
        const service: ServiceModel | null = await ServiceService.findOneBy({
          query,
          select: { _id: true, name: true },
          props: data.props,
        });

        if (!service) {
          return null;
        }

        return {
          name: service.name || "",
          names: [],
          entity: null,
          isSearchedByLogs: true,
        };
      }
      case SecurityConnectionKind.InventoryItem: {
        const item: InventoryItem | null = await InventoryItemService.findOneBy(
          {
            query,
            select: {
              _id: true,
              entityType: true,
              displayName: true,
              identifyingAttributes: true,
              descriptiveAttributes: true,
            },
            props: data.props,
          },
        );

        // A machine's item only: a service, a pod or a process is named otherwise.
        if (
          !item ||
          !item.entityType ||
          !INVENTORY_MACHINE_TYPES.includes(item.entityType)
        ) {
          return null;
        }

        const names: Array<string | undefined> = [
          item.displayName,
          ...INVENTORY_NAME_ATTRIBUTES.map(
            (key: string): string | undefined => {
              return readAttributeText(item.identifyingAttributes, key);
            },
          ),
          readAttributeText(item.descriptiveAttributes, "host.name"),
        ];
        const main: string =
          names.find((name: string | undefined): boolean => {
            return Boolean(name && name.trim());
          }) || "";

        return {
          name: item.displayName || main,
          names,
          addresses: readAttributeText(item.descriptiveAttributes, "host.ip"),
          entity: main ? { type: SecurityEntityType.Host, value: main } : null,
          isSearchedByLogs: false,
        };
      }
      case SecurityConnectionKind.User: {
        /*
         * Whether the reader may see this member of the project, with their
         * own props, and only then who the member is, as OneUptime: a
         * member's user is a column fewer of a membership's readers may
         * read (Current User reads its own membership, not who it is).
         */
        const member: TeamMember | null = await TeamMemberService.findOneBy({
          query: { projectId: data.projectId, userId: data.id },
          select: { userId: true },
          props: data.props,
        });

        if (!member) {
          return null;
        }

        const user: User | null = await UserService.findOneById({
          id: data.id,
          select: { name: true, email: true },
          props: { isRoot: true },
        });
        const email: string = user?.email?.toString() || "";

        if (!email) {
          return null;
        }

        return {
          name: user?.name?.toString() || email,
          names: [email],
          entity: { type: SecurityEntityType.User, value: email },
          isSearchedByLogs: false,
        };
      }
      default:
        return null;
    }
  }

  /*
   * The values, with each public address kept only when no other record
   * holds it - a host's or a device's among the hosts and devices, a cloud
   * resource's among the cloud resources - counted as OneUptime, since how
   * many hold it decides whether it names this record at all. A monitor
   * keeps every address it checks.
   */
  private static async keepOwnAddresses(data: {
    projectId: ObjectID;
    id: ObjectID;
    values: Array<string>;
    ownership: ResourceAddressOwnership;
  }): Promise<Array<string>> {
    const kept: Array<string> = [];

    for (const value of data.values) {
      if (
        getSecurityAddressScope(value) !== SecurityAddressScope.Public ||
        data.ownership === ResourceAddressOwnership.Checked
      ) {
        kept.push(value);
        continue;
      }

      if (data.ownership === ResourceAddressOwnership.CloudResources) {
        try {
          const resources: Array<CloudResource> =
            await CloudResourceService.findBy({
              query: {
                projectId: data.projectId,
                cloudEndpoints: QueryHelper.textContainsAnyOf([value]),
              } as never,
              select: { _id: true, cloudEndpoints: true },
              limit: MAX_ADDRESS_HOLDERS_READ,
              skip: 0,
              props: { isRoot: true },
            });
          const others: Array<CloudResource> = resources.filter(
            (resource: CloudResource): boolean => {
              return (
                resource.id?.toString() !== data.id.toString() &&
                readCloudEndpointHosts(
                  resource.cloudEndpoints,
                ).addresses.includes(value)
              );
            },
          );

          if (others.length === 0) {
            kept.push(value);
          }
        } catch (error) {
          // Not known to be its own: left out, as a shared one would be.
          logger.error(
            `Security connections: which cloud resources answer on an address could not be read: ${error}`,
          );
        }

        continue;
      }

      try {
        const [hosts, devices]: [Array<Host>, Array<NetworkDevice>] =
          await Promise.all([
            HostService.findBy({
              query: {
                projectId: data.projectId,
                hostIpAddresses: QueryHelper.search(value),
              },
              select: { _id: true, hostIpAddresses: true },
              limit: MAX_ADDRESS_HOLDERS_READ,
              skip: 0,
              props: { isRoot: true },
            }),
            NetworkDeviceService.findBy({
              query: {
                projectId: data.projectId,
                hostname: QueryHelper.findWithSameTextAnyOf([value]),
              } as never,
              select: { _id: true },
              limit: MAX_ADDRESS_HOLDERS_READ,
              skip: 0,
              props: { isRoot: true },
            }),
          ]);

        const holders: Set<string> = new Set();

        for (const host of hosts) {
          if (recordReportsAddress(host.hostIpAddresses, value) && host.id) {
            holders.add(host.id.toString());
          }
        }

        for (const device of devices) {
          if (device.id) {
            holders.add(device.id.toString());
          }
        }

        holders.delete(data.id.toString());

        if (holders.size === 0) {
          kept.push(value);
        }
      } catch (error) {
        // Not known to be its own: left out, as a shared one would be.
        logger.error(
          `Security connections: who holds an address could not be read: ${error}`,
        );
      }
    }

    return kept;
  }

  /*
   * The open cases whose entities name any of the values, however an event
   * spelled them, the latest detected first. Null when the caller's role
   * cannot read cases, or the read failed.
   */
  private static async readOpenCases(data: {
    projectId: ObjectID;
    values: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<ResourceSecurityJson["openCases"]> {
    try {
      const openStatusIds: Array<ObjectID> =
        await SecurityCaseValues.getOpenStatusIds(data.projectId);

      if (openStatusIds.length === 0) {
        return { count: 0, items: [] };
      }

      const query: Record<string, unknown> = {
        projectId: data.projectId,
        securityCaseStatusId: QueryHelper.any(openStatusIds),
        entities: QueryHelper.jsonArrayObjectsHaveTextAnyOf({
          key: "value",
          texts: data.values,
        }),
      };

      const [cases, count]: [Array<SecurityCase>, PositiveNumber] =
        await Promise.all([
          SecurityCaseService.findBy({
            query: query as never,
            select: SECURITY_CASE_SUMMARY_SELECT,
            sort: { lastDetectedAt: SortOrder.Descending },
            limit: RESOURCE_SECURITY_MAX_CASES,
            skip: 0,
            props: data.props,
          }),
          SecurityCaseService.countBy({
            query: query as never,
            props: data.props,
          }),
        ]);

      return {
        count: count.toNumber(),
        items: cases.map(toResourceSecurityCaseJson),
      };
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the open cases naming a record could not be read: ${error}`,
        );
      }

      return null;
    }
  }

  // The highest risk among its identities (Security Events > Entity Risk).
  private static async readRisk(data: {
    projectId: ObjectID;
    values: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): Promise<ResourceSecurityJson["risk"]> {
    try {
      const rows: Array<SecurityEntityRisk> =
        await SecurityEntityRiskService.findBy({
          query: {
            projectId: data.projectId,
            entityKey: QueryHelper.any(
              Array.from(
                new Set(
                  data.values.map((value: string): string => {
                    return getEntityRiskKey(value);
                  }),
                ),
              ),
            ),
          },
          select: { entityValue: true, entityType: true, riskScore: true },
          sort: { riskScore: SortOrder.Descending },
          limit: 1,
          skip: 0,
          props: data.props,
        });
      const row: SecurityEntityRisk | undefined = rows[0];

      if (!row || !row.riskScore || row.riskScore <= 0) {
        return null;
      }

      return {
        score: row.riskScore,
        entityValue: row.entityValue || "",
        entityType: row.entityType || SecurityEntityType.Other,
      };
    } catch (error) {
      if (!isRefusedRead(error)) {
        logger.error(
          `Security connections: the risk of a record could not be read: ${error}`,
        );
      }

      return null;
    }
  }
}
