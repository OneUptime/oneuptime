import Alert from "../../../Models/DatabaseModels/Alert";
import CephCluster from "../../../Models/DatabaseModels/CephCluster";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseServer from "../../../Models/DatabaseModels/DatabaseServer";
import DockerHost from "../../../Models/DatabaseModels/DockerHost";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import Host from "../../../Models/DatabaseModels/Host";
import Incident from "../../../Models/DatabaseModels/Incident";
import IoTFleet from "../../../Models/DatabaseModels/IoTFleet";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import NetworkDevice from "../../../Models/DatabaseModels/NetworkDevice";
import PodmanHost from "../../../Models/DatabaseModels/PodmanHost";
import ProxmoxCluster from "../../../Models/DatabaseModels/ProxmoxCluster";
import OpenStackCloud from "../../../Models/DatabaseModels/OpenStackCloud";
import Service from "../../../Models/DatabaseModels/Service";
import StorageArray from "../../../Models/DatabaseModels/StorageArray";
import VMwareVCenter from "../../../Models/DatabaseModels/VMwareVCenter";
import {
  AI_AFFECTED_RESOURCE_KINDS,
  AiAffectedResourceKind,
  AiAffectedResourceRef,
  AiAffectedResourceRelation,
} from "../../../Types/AI/AiAffectedResources";
import ObjectID from "../../../Types/ObjectID";

/*
 * THE LISTS OF A NEW INCIDENT OR ALERT, FROM WHAT IT IS ABOUT.
 *
 * An incident or alert is linked to what it is about through its lists -
 * hosts, Kubernetes clusters, network devices, cloud resources, services and
 * the rest (Types/AI/AiAffectedResources names them, and the list each kind
 * goes in). Everything after its creation reads them: its investigation
 * reaches the resources through their AI agents, auto-remediation fixes
 * them, their owners and labels pass on to it, and their pages list it.
 *
 * Every server path that opens an incident or an alert about a resource it
 * knows writes them from here, as id stubs: Ask AI's create tools
 * (AffectedResourceLinks), the security detections and Data Security
 * (SecurityEventAlerting), a security case's incident and the alert a
 * playbook pages with (SecurityConnections, OnCallPageService). Only the
 * models are imported - no service - so any of those may import this
 * without reaching back into the services that import them.
 */

// The model of each kind of resource, for its id stub in a list.
export const AFFECTED_RESOURCE_MODELS: Readonly<
  Record<AiAffectedResourceKind, new () => BaseModel>
> = {
  [AiAffectedResourceKind.Host]: Host,
  [AiAffectedResourceKind.NetworkDevice]: NetworkDevice,
  [AiAffectedResourceKind.DockerHost]: DockerHost,
  [AiAffectedResourceKind.PodmanHost]: PodmanHost,
  [AiAffectedResourceKind.KubernetesCluster]: KubernetesCluster,
  [AiAffectedResourceKind.DockerSwarmCluster]: DockerSwarmCluster,
  [AiAffectedResourceKind.ProxmoxCluster]: ProxmoxCluster,
  [AiAffectedResourceKind.OpenStackCloud]: OpenStackCloud,
  [AiAffectedResourceKind.VMwareVCenter]: VMwareVCenter,
  [AiAffectedResourceKind.CephCluster]: CephCluster,
  [AiAffectedResourceKind.StorageArray]: StorageArray,
  [AiAffectedResourceKind.IoTFleet]: IoTFleet,
  [AiAffectedResourceKind.DatabaseServer]: DatabaseServer,
  [AiAffectedResourceKind.CloudResource]: CloudResource,
  [AiAffectedResourceKind.Service]: Service,
};

// One resource as an entry of its list: its model, holding only its id.
export function toAffectedResourceStub(
  kind: AiAffectedResourceKind,
  id: string,
): BaseModel {
  const record: BaseModel = new AFFECTED_RESOURCE_MODELS[kind]();
  record.id = new ObjectID(id);
  return record;
}

/*
 * The resources asked for, each once, in the order asked: an entry with no
 * kind this build knows, or no OneUptime ID, is left out - a list can hold
 * only a real row.
 */
export function getDistinctAffectedResources(
  refs: ReadonlyArray<AiAffectedResourceRef>,
): Array<AiAffectedResourceRef> {
  const distinct: Array<AiAffectedResourceRef> = [];
  const seen: Set<string> = new Set<string>();

  for (const ref of refs) {
    if (
      !ref ||
      !AFFECTED_RESOURCE_MODELS[ref.kind] ||
      typeof ref.id !== "string" ||
      !ObjectID.isValidUUID(ref.id)
    ) {
      continue;
    }

    const id: string = ref.id.toLowerCase();
    const key: string = `${ref.kind}:${id}`;

    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    distinct.push({ kind: ref.kind, id });
  }

  return distinct;
}

/*
 * Each kind's list for these resources, in the order the kinds are listed
 * (AI_AFFECTED_RESOURCE_KINDS): only the kinds named have one.
 */
export function getAffectedResourceLists(
  refs: ReadonlyArray<AiAffectedResourceRef>,
): Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> {
  const distinct: Array<AiAffectedResourceRef> =
    getDistinctAffectedResources(refs);
  const lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> =
    {};

  for (const info of AI_AFFECTED_RESOURCE_KINDS) {
    const ofKind: Array<AiAffectedResourceRef> = distinct.filter(
      (ref: AiAffectedResourceRef): boolean => {
        return ref.kind === info.kind;
      },
    );

    if (ofKind.length === 0) {
      continue;
    }

    lists[info.relation] = ofKind.map((ref: AiAffectedResourceRef) => {
      return toAffectedResourceStub(info.kind, ref.id);
    });
  }

  return lists;
}

/*
 * Writes the lists of a new incident or alert: each kind named gets its
 * list, every other list is left as it was. Returns the resources written,
 * each once. Not for an update: a list written there replaces what the
 * record holds (AffectedResourceLinks.getListsWithAdded adds to it).
 */
export function setAffectedResourcesOnNewRecord(
  record: Incident | Alert,
  refs: ReadonlyArray<AiAffectedResourceRef>,
): Array<AiAffectedResourceRef> {
  const lists: Partial<Record<AiAffectedResourceRelation, Array<BaseModel>>> =
    getAffectedResourceLists(refs);

  for (const relation of Object.keys(
    lists,
  ) as Array<AiAffectedResourceRelation>) {
    (record as unknown as Record<string, unknown>)[relation] = lists[relation];
  }

  return getDistinctAffectedResources(refs);
}
