import Host from "Common/Models/DatabaseModels/Host";
import Service from "Common/Models/DatabaseModels/Service";
import Includes from "Common/Types/BaseDatabase/Includes";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import EntityType from "Common/Types/Telemetry/EntityType";
import { keyForHost } from "Common/Utils/Telemetry/EntityKey";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  ServiceOperationalStatus,
  ServiceStatusItem,
  fetchServiceOperationalStatuses,
} from "../../Topology/OperationalOverlay";
import {
  fetchInfrastructureData,
  fetchServiceMapData,
} from "../../Topology/TopologyApi";
import {
  InfrastructureData,
  ServiceMapData,
} from "../../Topology/TopologyData";
import {
  HOST_CALLERS_SECTION_ID,
  HOST_CALLS_SECTION_ID,
  HostTopologyInput,
  buildHostTopology,
} from "../Builders/HostTopology";
import { entityKind } from "../ResourceTopologyKinds";
import {
  ResourceTopologyGraph,
  ResourceTopologyIssue,
  ResourceTopologyNode,
} from "../ResourceTopologyModel";
import {
  OpenIssuesResult,
  areOpenIssuesUnreadable,
  loadOpenIssues,
} from "../ResourceTopologyIssuesLoader";
import { masterTopologyRouteFor } from "../ResourceTopologyLinks";
import { ResourceTopologyData } from "../ResourceTopologyPage";

/*
 * A host's topology, from the master Topology's own data over the past day
 * (the infrastructure map for what runs on it, the service map for what that
 * calls), the host's open incidents and alerts, and — for every service on
 * the map — its open incidents and alerts and its page.
 */

export const HOST_TOPOLOGY_RANGE_MS: number = 24 * 60 * 60 * 1000;

function toIssues(
  items: Array<ServiceStatusItem>,
  type: "incident" | "alert",
): Array<ResourceTopologyIssue> {
  return items.map((item: ServiceStatusItem): ResourceTopologyIssue => {
    return {
      type: type,
      id: item.id,
      title: item.title,
      number: "",
      severityName: item.severityName || "",
      severityColor: item.severityColor,
      stateName: "",
      createdAt: null,
    };
  });
}

export async function loadHostTopology(
  hostId: ObjectID,
): Promise<ResourceTopologyData> {
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const rangeStart: Date = new Date(Date.now() - HOST_TOPOLOGY_RANGE_MS);

  const [host, infrastructure, serviceMap, issues]: [
    Host | null,
    InfrastructureData | null,
    ServiceMapData | null,
    OpenIssuesResult | null,
  ] = await Promise.all([
    ModelAPI.getItem<Host>({
      modelType: Host,
      id: hostId,
      select: { name: true, hostIdentifier: true, lastSeenAt: true },
    }),
    fetchInfrastructureData(rangeStart).catch(() => {
      return null;
    }),
    fetchServiceMapData(rangeStart).catch(() => {
      return null;
    }),
    projectId
      ? loadOpenIssues({
          projectId: projectId,
          resourceRelation: "hosts",
          resourceId: hostId,
        })
      : Promise.resolve(null),
  ]);

  if (!infrastructure && !serviceMap && !host) {
    throw new Error("The host's topology could not be read.");
  }

  const hostEntityKey: string =
    projectId && host?.hostIdentifier
      ? keyForHost(projectId.toString(), host.hostIdentifier)
      : "";

  const input: HostTopologyInput = {
    host: {
      id: hostId.toString(),
      name: host?.name || host?.hostIdentifier || "",
      lastSeenAt: host?.lastSeenAt || null,
    },
    hostEntityKey: hostEntityKey,
    infrastructure: infrastructure,
    serviceMap: serviceMap,
    issues: issues?.records || [],
    now: new Date(),
  };

  // The services on the map, for their pages and their open issues.
  const draft: ResourceTopologyGraph = buildHostTopology(input);
  const serviceKeyByName: Map<string, string> = new Map<string, string>();

  for (const node of draft.nodes.values()) {
    if (node.kind !== entityKind(EntityType.Service)) {
      continue;
    }

    const key: string = node.id.substring(node.id.indexOf(":") + 1);
    serviceKeyByName.set(node.name.toLowerCase(), key);
  }

  const names: Array<string> = Array.from(
    new Set<string>(
      Array.from(draft.nodes.values())
        .filter((node: ResourceTopologyNode): boolean => {
          return node.kind === entityKind(EntityType.Service);
        })
        .map((node: ResourceTopologyNode): string => {
          return node.name;
        }),
    ),
  );

  if (names.length > 0 && projectId) {
    const [rows, statuses]: [
      ListResult<Service> | null,
      Map<string, ServiceOperationalStatus> | null,
    ] = await Promise.all([
      ModelAPI.getList<Service>({
        modelType: Service,
        query: { projectId: projectId, name: new Includes(names) },
        select: { _id: true, name: true },
        sort: {},
        skip: 0,
        limit: names.length,
      }).catch(() => {
        return null;
      }),
      fetchServiceOperationalStatuses(names).catch(() => {
        return null;
      }),
    ]);

    const serviceIds: Map<string, string> = new Map<string, string>();

    for (const row of rows?.data || []) {
      const key: string | undefined = serviceKeyByName.get(
        (row.name || "").toLowerCase(),
      );

      if (key && row._id) {
        serviceIds.set(key, row._id.toString());
      }
    }

    const serviceIssues: Map<string, Array<ResourceTopologyIssue>> = new Map<
      string,
      Array<ResourceTopologyIssue>
    >();

    for (const [name, status] of statuses || new Map()) {
      const key: string | undefined = serviceKeyByName.get(name);

      if (key) {
        serviceIssues.set(key, [
          ...toIssues(status.incidents, "incident"),
          ...toIssues(status.alerts, "alert"),
        ]);
      }
    }

    input.serviceIds = serviceIds;
    input.serviceIssues = serviceIssues;
  }

  return {
    arrangements: [
      {
        id: "host",
        label: "Host",
        graph: buildHostTopology(input),
        alwaysShowRelations: true,
        relationLegend: translationKey(
          "Calls per minute, red or amber when they fail",
        ),
        lanes: {
          left: [HOST_CALLERS_SECTION_ID],
          right: [HOST_CALLS_SECTION_ID],
        },
      },
    ],
    issuesArePartial: Boolean(issues?.isPartial),
    issuesAreUnreadable: areOpenIssuesUnreadable(issues),
    masterTopologyRoute: hostEntityKey
      ? masterTopologyRouteFor(hostEntityKey)
      : null,
  };
}
