import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import PageMap from "../../../Utils/PageMap";
import {
  ResourceTopologyFact,
  ResourceTopologyGraph,
  ResourceTopologyHealth,
  ResourceTopologyIssue,
  ResourceTopologyNodeInput,
  ResourceTopologyRelation,
  ResourceTopologyText,
  ResourceTopologyTruncation,
  buildResourceTopologyGraph,
} from "../ResourceTopologyModel";
import {
  OpenIssueRecord,
  attachOpenIssues,
  readSeriesLabel,
  sameName,
} from "../ResourceTopologyIssues";
import { isRecent, toFiniteNumber } from "../ResourceTopologyFormat";
import { ResourceAttentionText } from "../../ResourcePart/ResourceAttention";
import {
  DockerSwarmAssessment,
  assessDockerSwarmNode,
  assessDockerSwarmService,
  assessDockerSwarmTask,
  getDockerSwarmTopologyHealth,
  isCurrentDockerSwarmTask,
  isDockerSwarmLeader,
  isDockerSwarmManager,
  keepLatestDockerSwarmSnapshot,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";

/*
 * A Docker Swarm cluster's topology, two ways, like a Kubernetes cluster's:
 *
 *   - Services: stack > service > its current tasks, with each stack's
 *     networks and the cluster's nodes beside them. "What runs, and has
 *     every service its replicas?"
 *   - Nodes: node > the tasks it runs, and the tasks not on any node.
 *     "Where does it run, and is every machine up?"
 *
 * Only a service's current tasks are drawn (the ones Swarm wants running):
 * `docker service ps` also lists the ones each slot replaced, and those are
 * history, not topology. A task is linked to its node and its service, and
 * the one it sits inside needs no line: by service, a picked task draws a
 * line to the node it runs on.
 */

export const SWARM_ROOT_ID: string = "cluster";
export const SWARM_UNSCHEDULED_ID: string = "section:unscheduled";
export const SWARM_SERVICES_ARRANGEMENT: string = "services";
export const SWARM_NODES_ARRANGEMENT: string = "nodes";
export const SWARM_STALE_MS: number = 15 * 60 * 1000;

export interface DockerSwarmTopologyInput {
  cluster: { id: string; name: string; lastSeenAt?: Date | null | undefined };
  rows: Array<DockerSwarmResource>;
  issues?: Array<OpenIssueRecord> | undefined;
  now: Date;
  truncations?: Array<ResourceTopologyTruncation> | undefined;
}

export interface DockerSwarmTopology {
  services: ResourceTopologyGraph;
  nodes: ResourceTopologyGraph;
}

function text(
  value: string,
  values?: Record<string, string> | undefined,
): ResourceTopologyText {
  return values ? { text: value, values: values } : { text: value };
}

function routeParam(externalId: string): string {
  return encodeURIComponent(externalId);
}

/*
 * A task Swarm wants running now, rather than one a slot replaced: the
 * rules' own test (DockerSwarmHealth), kept under this name for the
 * builder's callers.
 */
export function isCurrentSwarmTask(row: DockerSwarmResource): boolean {
  return isCurrentDockerSwarmTask(row);
}

interface Assessment {
  health: ResourceTopologyHealth;
  status?: ResourceTopologyText | undefined;
  reasons: Array<ResourceTopologyText>;
  facts: Array<ResourceTopologyFact>;
}

/*
 * A part's health, status and reasons by the swarm's rules
 * (DockerSwarmHealth), the same the Overview's Needs attention, the lists
 * and the part's own page read; Docker's own message (a task's error) last
 * among the reasons, as written. A count-dependent reason reads its general
 * form, with its count.
 */
function fromRules(
  assessment: DockerSwarmAssessment,
  facts: Array<ResourceTopologyFact>,
): Assessment {
  const reasons: Array<ResourceTopologyText> = assessment.reasons.map(
    (reason: ResourceAttentionText): ResourceTopologyText => {
      if (reason.plural) {
        return text(reason.text, {
          ...(reason.values || {}),
          count: String(reason.plural.count),
        });
      }
      return reason.values
        ? text(reason.text, reason.values)
        : text(reason.text);
    },
  );
  if (assessment.message) {
    reasons.push({ text: assessment.message });
  }
  return {
    health: getDockerSwarmTopologyHealth(assessment),
    status: assessment.status.values
      ? text(assessment.status.label, assessment.status.values)
      : text(assessment.status.label),
    reasons: reasons,
    facts: facts,
  };
}

function assessNode(row: DockerSwarmResource): Assessment {
  return fromRules(assessDockerSwarmNode(row), [
    {
      label: translationKey("Role"),
      value: isDockerSwarmLeader(row)
        ? "leader"
        : isDockerSwarmManager(row)
          ? "manager"
          : "worker",
    },
  ]);
}

function assessService(row: DockerSwarmResource, now: Date): Assessment {
  const running: number | null = toFiniteNumber(row.runningReplicas);
  const desired: number | null = toFiniteNumber(row.desiredReplicas);
  const assessment: DockerSwarmAssessment = assessDockerSwarmService(row, now);
  const facts: Array<ResourceTopologyFact> = [];

  if (desired !== null && desired > 0) {
    const have: number = running ?? 0;
    facts.push({
      label: translationKey("Replicas"),
      value: `${have}/${desired}`,
      tone: have === 0 ? "critical" : have < desired ? "warning" : undefined,
    });
  }

  return fromRules(assessment, facts);
}

function assessTask(row: DockerSwarmResource, now: Date): Assessment {
  return fromRules(assessDockerSwarmTask(row, now), []);
}

export function buildDockerSwarmTopology(
  input: DockerSwarmTopologyInput,
): DockerSwarmTopology {
  const clusterId: string = input.cluster.id;
  // The newest snapshot's rows: a replaced task is not drawn beside its replacement.
  const rows: Array<DockerSwarmResource> = keepLatestDockerSwarmSnapshot(
    input.rows,
  );
  const reporting: boolean =
    isRecent(input.cluster.lastSeenAt, input.now, SWARM_STALE_MS) ||
    rows.some((row: DockerSwarmResource): boolean => {
      return isRecent(row.lastSeenAt, input.now, SWARM_STALE_MS);
    });

  const root: ResourceTopologyNodeInput = {
    id: SWARM_ROOT_ID,
    parentId: null,
    kind: "swarm.cluster",
    name: input.cluster.name || "Docker Swarm",
    health: reporting
      ? "healthy"
      : input.cluster.lastSeenAt
        ? "warning"
        : "unknown",
    status: reporting
      ? text(translationKey("Reporting"))
      : input.cluster.lastSeenAt
        ? text(translationKey("Not reporting"))
        : text(translationKey("No data yet")),
    link: { page: PageMap.DOCKER_SWARM_CLUSTER_VIEW, modelId: clusterId },
  };

  const parts: Map<string, ResourceTopologyNodeInput> = new Map<
    string,
    ResourceTopologyNodeInput
  >();
  const nodeByHostname: Map<string, string> = new Map<string, string>();
  const serviceByName: Map<string, string> = new Map<string, string>();
  const stackIds: Map<string, string> = new Map<string, string>();

  const link: (
    page: PageMap,
    row: DockerSwarmResource,
  ) => ResourceTopologyNodeInput["link"] = (
    page: PageMap,
    row: DockerSwarmResource,
  ): ResourceTopologyNodeInput["link"] => {
    return row.externalId
      ? {
          page: page,
          modelId: clusterId,
          subModelId: routeParam(row.externalId),
        }
      : null;
  };

  for (const row of rows) {
    if (!row.kind || !row.externalId) {
      continue;
    }

    const id: string = `${row.kind.toLowerCase()}:${row.externalId}`;
    const name: string = row.name || row.externalId;

    if (row.kind === "Node") {
      const assessment: Assessment = assessNode(row);
      nodeByHostname.set(name.toLowerCase(), id);
      parts.set(id, {
        id: id,
        parentId: SWARM_ROOT_ID,
        kind: "swarm.node",
        name: name,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        link: link(PageMap.DOCKER_SWARM_CLUSTER_VIEW_NODE_DETAIL, row),
      });
    } else if (row.kind === "Service") {
      const assessment: Assessment = assessService(row, input.now);
      serviceByName.set(name, id);
      parts.set(id, {
        id: id,
        parentId: SWARM_ROOT_ID,
        kind: "swarm.service",
        name: name,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        facts: assessment.facts,
        context: row.stackName || undefined,
        keywords: [row.image || ""],
        link: link(PageMap.DOCKER_SWARM_CLUSTER_VIEW_SERVICE_DETAIL, row),
      });
    } else if (row.kind === "Task") {
      if (!isCurrentSwarmTask(row)) {
        continue;
      }

      const assessment: Assessment = assessTask(row, input.now);
      parts.set(id, {
        id: id,
        parentId: SWARM_ROOT_ID,
        kind: "swarm.task",
        name: name,
        health: assessment.health,
        status: assessment.status,
        reasons: assessment.reasons,
        context: row.nodeHostname || undefined,
        keywords: [row.serviceName || "", row.nodeHostname || ""],
        link: link(PageMap.DOCKER_SWARM_CLUSTER_VIEW_TASK_DETAIL, row),
      });
    } else if (row.kind === "Stack") {
      stackIds.set(name, id);
      parts.set(id, {
        id: id,
        parentId: SWARM_ROOT_ID,
        kind: "swarm.stack",
        name: name,
        health: "healthy",
      });
    } else if (row.kind === "Network") {
      parts.set(id, {
        id: id,
        parentId: SWARM_ROOT_ID,
        kind: "swarm.network",
        name: name,
        health: "healthy",
        status: row.driver ? { text: row.driver } : undefined,
      });
    } else {
      continue;
    }
  }

  const stackOf: (stack: string | undefined) => string = (
    stack: string | undefined,
  ): string => {
    if (!stack) {
      return SWARM_ROOT_ID;
    }

    if (!stackIds.has(stack)) {
      const id: string = `stack:stack/${stack}`;
      stackIds.set(stack, id);
      parts.set(id, {
        id: id,
        parentId: SWARM_ROOT_ID,
        kind: "swarm.stack",
        name: stack,
        health: "healthy",
      });
    }

    return stackIds.get(stack)!;
  };

  // Services: stacks, their services, their tasks.
  const servicesParent: Map<string, string> = new Map<string, string>();
  const relations: Array<ResourceTopologyRelation> = [];
  const taskNode: Map<string, string | null> = new Map<string, string | null>();

  for (const row of rows) {
    if (!row.externalId) {
      continue;
    }

    const id: string = `${(row.kind || "").toLowerCase()}:${row.externalId}`;

    if (!parts.has(id)) {
      continue;
    }

    if (row.kind === "Service") {
      servicesParent.set(id, stackOf(row.stackName || undefined));
    } else if (row.kind === "Network") {
      const name: string = row.name || "";
      const stack: string | undefined = Array.from(stackIds.keys()).find(
        (candidate: string): boolean => {
          return name.startsWith(`${candidate}_`);
        },
      );
      servicesParent.set(id, stack ? stackIds.get(stack)! : SWARM_ROOT_ID);
    } else if (row.kind === "Task") {
      const service: string | undefined = row.serviceName
        ? serviceByName.get(row.serviceName)
        : undefined;
      servicesParent.set(id, service || SWARM_ROOT_ID);

      if (service) {
        relations.push({
          from: id,
          to: service,
          label: translationKey("Part of"),
          inverseLabel: translationKey("Includes"),
        });
      }

      const node: string | undefined = row.nodeHostname
        ? nodeByHostname.get(row.nodeHostname.toLowerCase())
        : undefined;
      taskNode.set(id, node || null);

      if (node) {
        relations.push({
          from: id,
          to: node,
          label: translationKey("Runs on"),
          inverseLabel: translationKey("Runs here"),
        });
      }
    }
  }

  const locate: (record: OpenIssueRecord) => string | null = (
    record: OpenIssueRecord,
  ): string | null => {
    const service: string | null =
      readSeriesLabel(record.seriesLabels, "docker.swarm.service.name") ||
      readSeriesLabel(record.seriesLabels, "service.name");

    if (service) {
      for (const [name, id] of serviceByName) {
        if (sameName(name, service)) {
          return id;
        }
      }
    }

    const node: string | null = readSeriesLabel(
      record.seriesLabels,
      "docker.swarm.node.name",
    );

    if (node && nodeByHostname.has(node.toLowerCase())) {
      return nodeByHostname.get(node.toLowerCase())!;
    }

    return null;
  };

  const issues: Map<string, Array<ResourceTopologyIssue>> = attachOpenIssues({
    records: input.issues || [],
    rootId: SWARM_ROOT_ID,
    locate: locate,
  });

  const servicesNodes: Array<ResourceTopologyNodeInput> = [root];
  const nodesNodes: Array<ResourceTopologyNodeInput> = [root];
  let unscheduled: number = 0;

  for (const part of parts.values()) {
    servicesNodes.push({
      ...part,
      parentId: servicesParent.get(part.id) || SWARM_ROOT_ID,
    });

    if (part.kind === "swarm.node") {
      nodesNodes.push({ ...part, parentId: SWARM_ROOT_ID });
    } else if (part.kind === "swarm.task") {
      const node: string | null = taskNode.get(part.id) || null;

      if (!node) {
        unscheduled++;
      }

      nodesNodes.push({ ...part, parentId: node || SWARM_UNSCHEDULED_ID });
    }
  }

  if (unscheduled > 0) {
    nodesNodes.push({
      id: SWARM_UNSCHEDULED_ID,
      parentId: SWARM_ROOT_ID,
      kind: "section",
      isSection: true,
      name: translationKey("Not on a node"),
      health: "healthy",
    });
  }

  const issuesWithin: (
    nodes: Array<ResourceTopologyNodeInput>,
  ) => Map<string, Array<ResourceTopologyIssue>> = (
    nodes: Array<ResourceTopologyNodeInput>,
  ): Map<string, Array<ResourceTopologyIssue>> => {
    const drawn: Set<string> = new Set<string>(
      nodes.map((node: ResourceTopologyNodeInput): string => {
        return node.id;
      }),
    );
    const result: Map<string, Array<ResourceTopologyIssue>> = new Map<
      string,
      Array<ResourceTopologyIssue>
    >();

    for (const [nodeId, list] of issues) {
      const target: string = drawn.has(nodeId) ? nodeId : SWARM_ROOT_ID;
      result.set(target, [...(result.get(target) || []), ...list]);
    }

    return result;
  };

  return {
    services: buildResourceTopologyGraph({
      rootId: SWARM_ROOT_ID,
      nodes: servicesNodes,
      relations: relations,
      issues: issuesWithin(servicesNodes),
      truncations: input.truncations,
    }),
    nodes: buildResourceTopologyGraph({
      rootId: SWARM_ROOT_ID,
      nodes: nodesNodes,
      relations: relations,
      issues: issuesWithin(nodesNodes),
      truncations: input.truncations,
    }),
  };
}
