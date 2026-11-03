import React, { FunctionComponent, ReactElement } from "react";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { DOCKER_SWARM_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/DockerSwarmMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import {
  getDockerSwarmAttentionItems,
  getDockerSwarmAttentionKey,
  getDockerSwarmAttribute,
  getDockerSwarmNodeRows,
  isDockerSwarmIssueAbout,
  isDockerSwarmManager,
  toDockerSwarmDate,
  toDockerSwarmNumber,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import {
  DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS,
  formatDockerSwarmCpus,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmPartFacts";
import { formatBytes } from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import { DockerSwarmPartRoutes } from "./DockerSwarmPartRoutes";
import DockerSwarmTasksTable from "./DockerSwarmTasksTable";

/*
 * A Docker Swarm node's Overview: whether it or the tasks Swarm placed on it
 * need attention, those tasks, what is open on it, whether anyone hears when
 * it goes down, and what Swarm reports about it.
 */

// How the node's own row reads in its Needs attention card.
const THIS_NODE: string = translationKey("This node");

// A manager's standing and a node's availability, as `docker node ls` says them.
const MANAGER_STATUS_WORDS: Record<string, string> = {
  leader: translationKey("Leader"),
  reachable: translationKey("Reachable"),
  unreachable: translationKey("Unreachable"),
  unknown: translationKey("Unknown"),
};

const AVAILABILITY_WORDS: Record<string, string> = {
  active: translationKey("Active"),
  drain: translationKey("Drained"),
  pause: translationKey("Paused"),
};

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: DockerSwarmResource | null;
  // The cluster's inventory, for the node's tasks.
  rows: Array<DockerSwarmResource>;
  routes: DockerSwarmPartRoutes;
  now: Date;
  refreshToken?: number | undefined;
}

const DockerSwarmNodeOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: DockerSwarmResource | null = props.row;

  if (!row) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid="docker-swarm-node-not-reported"
      >
        {tx(
          "Node details not reported yet. Make sure the Docker Swarm agent is sending metrics.",
        )}
      </p>
    );
  }

  const nodeRows: Array<DockerSwarmResource> = getDockerSwarmNodeRows({
    rows: props.rows,
    node: row,
  });

  const attentionItems: Array<ResourceAttentionItem> =
    getDockerSwarmAttentionItems({
      rows: nodeRows,
      routeFor: props.routes.getPartRoute,
      now: props.now,
      scope: "part",
    });

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "hostname",
      label: "Hostname",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
    {
      key: "role",
      label: "Role",
      value: isDockerSwarmManager(row) ? tx("Manager node") : tx("Worker node"),
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.managers,
    },
  ];

  const managerStatus: string = getDockerSwarmAttribute(row, "managerStatus");
  if (managerStatus) {
    const word: string | undefined =
      MANAGER_STATUS_WORDS[managerStatus.toLowerCase()];
    detailRows.push({
      key: "manager-status",
      label: "Manager Status",
      value: word ? tx(word) : managerStatus,
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.managerStatus,
    });
  }

  const availability: string = getDockerSwarmAttribute(row, "availability");
  if (availability) {
    const word: string | undefined =
      AVAILABILITY_WORDS[availability.toLowerCase()];
    detailRows.push({
      key: "availability",
      label: "Availability",
      value: word ? tx(word) : availability,
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.availability,
    });
  }

  const message: string = getDockerSwarmAttribute(row, "message");
  if (message) {
    detailRows.push({
      key: "message",
      label: "Swarm's message",
      value: <bdi>{message}</bdi>,
    });
  }

  const addr: string = getDockerSwarmAttribute(row, "addr");
  if (addr) {
    detailRows.push({
      key: "address",
      label: "Address",
      value: addr,
      mono: true,
      copyText: addr,
    });
  }

  const cpus: number | null = toDockerSwarmNumber(
    getDockerSwarmAttribute(row, "cpus"),
  );
  if (cpus !== null && cpus > 0) {
    detailRows.push({
      key: "cpus",
      label: "CPUs",
      value: formatDockerSwarmCpus(cpus),
    });
  }

  const memory: number | null = toDockerSwarmNumber(
    getDockerSwarmAttribute(row, "memoryBytes"),
  );
  if (memory !== null && memory > 0) {
    detailRows.push({
      key: "memory",
      label: "Memory",
      value: formatBytes(memory),
    });
  }

  const engineVersion: string = getDockerSwarmAttribute(row, "engineVersion");
  if (engineVersion) {
    detailRows.push({
      key: "engine",
      label: "Engine Version",
      value: engineVersion,
    });
  }

  detailRows.push({
    key: "id",
    label: "Node ID",
    value: props.externalId.replace("node/", ""),
    mono: true,
    copyText: props.externalId.replace("node/", ""),
  });

  const lastReport: Date | null = toDockerSwarmDate(row.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  return (
    <div data-testid="docker-swarm-node-overview">
      <NeedsAttentionCard
        testId="docker-swarm-node-attention"
        items={attentionItems}
        current={{
          key: getDockerSwarmAttentionKey("Node", props.externalId),
          label: THIS_NODE,
        }}
        description="What about this node and the tasks it runs is broken or needs a look."
      />

      <DockerSwarmTasksTable
        title="Tasks on this node"
        description="The tasks Swarm placed on this node, with their state and what each one uses."
        rows={nodeRows}
        groupBy="service"
        getTaskRoute={(externalId: string) => {
          return props.routes.getPartRoute("Task", externalId);
        }}
        now={props.now}
        emptyMessage="Swarm runs no tasks on this node."
      />

      <ResourcePartOpenEventsCard
        testId="docker-swarm-node-open"
        title="Open on this node"
        description="Unresolved incidents and alerts about this node, incidents first."
        resourceRelation="dockerSwarmClusters"
        resourceId={props.clusterId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isDockerSwarmIssueAbout(record, row);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartAlertsCard
        testId="docker-swarm-node-alerts"
        title="Node alerts"
        description="The swarm's alerts that watch every node, this one included: each is one monitor that fires for any node that crosses it."
        resourceType={MonitorRecommendationResourceType.DockerSwarm}
        templateIds={DOCKER_SWARM_NODE_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="docker-swarm-node-details"
        description="What Docker Swarm reports about this node."
        rows={detailRows}
      />
    </div>
  );
};

export default DockerSwarmNodeOverview;
