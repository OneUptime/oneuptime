import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import SecurityEntityRisk from "../../../../Models/DatabaseModels/SecurityEntityRisk";
import ServiceModel from "../../../../Models/DatabaseModels/Service";
import TeamMember from "../../../../Models/DatabaseModels/TeamMember";
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
  getObservableSearchValues,
  getRecordSecurityValues,
  getSecurityAddressScope,
  readRecordAddresses,
  recordReportsAddress,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import { getEntityRiskKey } from "../../../../Utils/SecurityCase/SecurityEntityRiskScore";
import DockerHostService from "../../../Services/DockerHostService";
import HostService from "../../../Services/HostService";
import KubernetesClusterService from "../../../Services/KubernetesClusterService";
import NetworkDeviceService from "../../../Services/NetworkDeviceService";
import PodmanHostService from "../../../Services/PodmanHostService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import SecurityEntityRiskService from "../../../Services/SecurityEntityRiskService";
import SecurityEventService, {
  SecurityEventsNamingSummary,
} from "../../../Services/SecurityEventService";
import ServiceService from "../../../Services/ServiceService";
import TeamMemberService from "../../../Services/TeamMemberService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import logger from "../../Logger";
import SecurityCaseValues from "../../SecurityCase/SecurityCaseValues";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import { MAX_ADDRESS_HOLDERS_READ, isRefusedRead } from "./SecurityConnectedRecords";

/*
 * THE WAY BACK: what Security Events says about one of the project's own
 * records - a host, a Docker or Podman host, a Kubernetes cluster, a network
 * device, a service, a member - for the Security card on its page.
 *
 * A record is searched for by its exact identities only, the ones that
 * make an exact connection (SecurityConnectionMatch): its names (a host's
 * host.name and display name, a cluster's k8s.cluster.name, a device's
 * name and DNS name, a member's email) and the public addresses no other
 * record of the project holds. A service is searched for by its logs:
 * the events "Your logs" read from them. Possible connections - a short
 * name, a private or shared address - are left out here: a guess must never
 * put a case on the wrong host's page. A case's Connected Signals still
 * shows them, said to be possible.
 *
 * Over the last RESOURCE_SECURITY_WINDOW_IN_DAYS days (the week an entity's
 * risk is counted over): how many events and findings name it, the open
 * cases whose entities name it, and its highest risk. Every read is inside
 * the project, bounded, with the caller's own permissions; a project with
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

export interface ResourceSecurityIdentity {
  name: string;
  // Names and addresses, before the public addresses are held to being nobody else's.
  names: Array<string | undefined | null>;
  addresses?: string | Array<string> | undefined | null;
  // The entity its Security Events page opens on.
  entity: SecurityEntity | null;
  // Searched for by the events read from its logs instead of by name.
  isSearchedByLogs: boolean;
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
      entity: identity.entity,
      eventCount: 0,
      findingCount: 0,
      maxSeverityId: 0,
      lastSeen: null,
      openCases: null,
      risk: null,
    };

    result.isInUse = await SecurityEventService.hasEventsSince({
      projectId: data.projectId,
      startTime,
    });

    if (!result.isInUse) {
      return result;
    }

    const values: Array<string> = identity.isSearchedByLogs
      ? []
      : await this.keepOwnAddresses({
          projectId: data.projectId,
          id: data.id,
          values: getRecordSecurityValues({
            names: identity.names,
            addresses: identity.addresses,
          }),
        });

    result.values = values;

    const summary: SecurityEventsNamingSummary =
      await SecurityEventService.countEventsNaming({
        projectId: data.projectId,
        values: getObservableSearchValues(values),
        ...(identity.isSearchedByLogs ? { logResourceId: data.id } : {}),
        startTime,
        endTime: now,
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
      case SecurityConnectionKind.User: {
        const member: TeamMember | null = await TeamMemberService.findOneBy({
          query: { projectId: data.projectId, userId: data.id },
          select: { userId: true, user: { name: true, email: true } },
          props: data.props,
        });
        const email: string = member?.user?.email?.toString() || "";

        if (!member || !email) {
          return null;
        }

        return {
          name: member.user?.name?.toString() || email,
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
   * The values, with each public address kept only when no other host or
   * network device of the project holds it - counted as OneUptime, since
   * how many hold it decides whether it names this record at all.
   */
  private static async keepOwnAddresses(data: {
    projectId: ObjectID;
    id: ObjectID;
    values: Array<string>;
  }): Promise<Array<string>> {
    const kept: Array<string> = [];

    for (const value of data.values) {
      if (getSecurityAddressScope(value) !== SecurityAddressScope.Public) {
        kept.push(value);
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
