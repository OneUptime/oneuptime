import DockerHost from "../../../../Models/DatabaseModels/DockerHost";
import Host from "../../../../Models/DatabaseModels/Host";
import Incident from "../../../../Models/DatabaseModels/Incident";
import KubernetesCluster from "../../../../Models/DatabaseModels/KubernetesCluster";
import PodmanHost from "../../../../Models/DatabaseModels/PodmanHost";
import SecurityCase from "../../../../Models/DatabaseModels/SecurityCase";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import PositiveNumber from "../../../../Types/PositiveNumber";
import {
  IncidentSecurityJson,
  RESOURCE_SECURITY_MAX_CASES,
  ResourceSecurityCaseJson,
  SecurityConnectionKind,
} from "../../../../Types/SecurityCase/SecurityConnection";
import {
  SecurityEntity,
  readSecurityEntities,
} from "../../../../Types/SecurityCase/SecurityEntity";
import {
  foldConnectionValue,
  getRecordSecurityValues,
} from "../../../../Utils/SecurityCase/SecurityConnectionMatch";
import IncidentService from "../../../Services/IncidentService";
import SecurityCaseService from "../../../Services/SecurityCaseService";
import QueryHelper from "../../../Types/Database/QueryHelper";
import SecurityCaseValues from "../../SecurityCase/SecurityCaseValues";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import {
  SECURITY_CASE_SUMMARY_SELECT,
  toResourceSecurityCaseJson,
} from "./ResourceSecurity";

/*
 * WHAT SECURITY EVENTS SAYS ABOUT AN INCIDENT, for the Security card on the
 * incident's page:
 *
 *   - the case that declared it (Declare Incident on a case, or a playbook's
 *     step), whatever its status: the attack the outage may be the impact
 *     of, with its priority and where it stands now;
 *   - the open cases naming a host, a Docker or Podman host or a Kubernetes
 *     cluster the incident affects (its Affected Resources), by those
 *     records' exact names: an outage on web-1 while a case about web-1 is
 *     open is worth knowing about, whichever came first.
 *
 * Read with the caller's own permissions, inside the project, bounded.
 */

// The most of an incident's linked records whose names are looked for.
export const MAX_INCIDENT_RESOURCES: number = 10;

interface LinkedRecord {
  kind: SecurityConnectionKind;
  id: string;
  name: string;
  values: Array<string>;
}

export default class IncidentSecurity {
  @CaptureSpan()
  public static async read(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<IncidentSecurityJson | null> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: { _id: data.incidentId.toString(), projectId: data.projectId },
      select: {
        _id: true,
        hosts: { _id: true, name: true, hostIdentifier: true },
        dockerHosts: { _id: true, name: true, hostIdentifier: true },
        podmanHosts: { _id: true, name: true, hostIdentifier: true },
        kubernetesClusters: { _id: true, name: true, clusterIdentifier: true },
      },
      props: data.props,
    });

    if (!incident) {
      return null;
    }

    const declaredBy: Array<SecurityCase> = await SecurityCaseService.findBy({
      query: { projectId: data.projectId, incidentId: data.incidentId },
      select: SECURITY_CASE_SUMMARY_SELECT,
      sort: { createdAt: SortOrder.Descending },
      limit: RESOURCE_SECURITY_MAX_CASES,
      skip: 0,
      props: data.props,
    });

    const linked: Array<LinkedRecord> = getIncidentLinkedRecords(incident);
    const values: Array<string> = Array.from(
      new Set(
        linked.flatMap((record: LinkedRecord): Array<string> => {
          return record.values;
        }),
      ),
    );

    const result: IncidentSecurityJson = {
      declaredBy: declaredBy.map(toResourceSecurityCaseJson),
      namingItsResources: [],
      namingItsResourcesCount: 0,
    };

    if (values.length === 0) {
      return result;
    }

    const openStatusIds: Array<ObjectID> =
      await SecurityCaseValues.getOpenStatusIds(data.projectId);

    if (openStatusIds.length === 0) {
      return result;
    }

    const declaredIds: Array<ObjectID> = declaredBy
      .map((securityCase: SecurityCase): ObjectID | undefined => {
        return securityCase.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    const query: Record<string, unknown> = {
      projectId: data.projectId,
      securityCaseStatusId: QueryHelper.any(openStatusIds),
      entities: QueryHelper.jsonArrayObjectsHaveTextAnyOf({
        key: "value",
        texts: values,
      }),
      ...(declaredIds.length > 0
        ? { _id: QueryHelper.notIn(declaredIds) }
        : {}),
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

    result.namingItsResourcesCount = count.toNumber();
    result.namingItsResources = cases.map(
      (
        securityCase: SecurityCase,
      ): ResourceSecurityCaseJson & {
        resources: Array<{
          kind: SecurityConnectionKind;
          id: string;
          name: string;
        }>;
      } => {
        const named: Set<string> = new Set(
          readSecurityEntities(securityCase.entities).map(
            (entity: SecurityEntity): string => {
              return foldConnectionValue(entity.value);
            },
          ),
        );

        return {
          ...toResourceSecurityCaseJson(securityCase),
          resources: linked
            .filter((record: LinkedRecord): boolean => {
              return record.values.some((value: string): boolean => {
                return named.has(foldConnectionValue(value));
              });
            })
            .map((record: LinkedRecord) => {
              return { kind: record.kind, id: record.id, name: record.name };
            }),
        };
      },
    );

    return result;
  }
}

/*
 * The hosts, container hosts and clusters an incident affects, each with
 * the exact names a security event would give it.
 */
export function getIncidentLinkedRecords(
  incident: Incident,
): Array<LinkedRecord> {
  const records: Array<LinkedRecord> = [];

  const add: (
    kind: SecurityConnectionKind,
    id: ObjectID | undefined | null,
    name: string,
    names: Array<string | undefined | null>,
  ) => void = (
    kind: SecurityConnectionKind,
    id: ObjectID | undefined | null,
    name: string,
    names: Array<string | undefined | null>,
  ): void => {
    if (!id || records.length >= MAX_INCIDENT_RESOURCES) {
      return;
    }

    const values: Array<string> = getRecordSecurityValues({ names });

    if (values.length > 0) {
      records.push({ kind, id: id.toString(), name, values });
    }
  };

  for (const host of (incident.hosts || []) as Array<Host>) {
    add(
      SecurityConnectionKind.Host,
      host.id,
      host.name || host.hostIdentifier || "",
      [host.hostIdentifier, host.name],
    );
  }

  for (const host of (incident.dockerHosts || []) as Array<DockerHost>) {
    add(
      SecurityConnectionKind.DockerHost,
      host.id,
      host.name || host.hostIdentifier || "",
      [host.hostIdentifier, host.name],
    );
  }

  for (const host of (incident.podmanHosts || []) as Array<PodmanHost>) {
    add(
      SecurityConnectionKind.PodmanHost,
      host.id,
      host.name || host.hostIdentifier || "",
      [host.hostIdentifier, host.name],
    );
  }

  for (const cluster of (incident.kubernetesClusters ||
    []) as Array<KubernetesCluster>) {
    add(
      SecurityConnectionKind.KubernetesCluster,
      cluster.id,
      cluster.name || cluster.clusterIdentifier || "",
      [cluster.clusterIdentifier],
    );
  }

  return records;
}
