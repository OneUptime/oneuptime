import React, { FunctionComponent, ReactElement } from "react";
import DockerSwarmResource from "Common/Models/DatabaseModels/DockerSwarmResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
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
  DOCKER_SWARM_TASK_CPU_WARNING_PERCENT,
  DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT,
  getDockerSwarmAttentionItems,
  getDockerSwarmAttentionKey,
  getDockerSwarmAttribute,
  getDockerSwarmTaskId,
  getDockerSwarmTaskReadings,
  isDockerSwarmIssueAbout,
  toDockerSwarmDate,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import { DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS } from "../../../Pages/DockerSwarm/Utils/DockerSwarmPartFacts";
import {
  formatBytes,
  formatPercent,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import { DockerSwarmPartRoutes } from "./DockerSwarmPartRoutes";

/*
 * A Docker Swarm task's Overview: whether it needs attention (failed,
 * rejected, waiting for a node, close to its memory limit) and Docker's own
 * error, what it uses now against its alerts' lines, what is open on it,
 * whether anyone hears when it restarts or runs hot, and what Swarm reports
 * about it.
 */

// How the task's own row reads in its Needs attention card.
const THIS_TASK: string = translationKey("This task");

const LINK_CLASS_NAME: string =
  "text-indigo-600 hover:text-indigo-700 hover:underline";

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: DockerSwarmResource | null;
  routes: DockerSwarmPartRoutes;
  // The task's service's and node's own pages, when the inventory has them.
  serviceExternalId?: string | undefined;
  nodeExternalId?: string | undefined;
  now: Date;
  refreshToken?: number | undefined;
}

function formatDate(value: string): string {
  const date: Date | null = toDockerSwarmDate(value);
  return date ? OneUptimeDate.getDateAsLocalFormattedString(date) : value;
}

const DockerSwarmTaskOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="docker-swarm-task-not-reported"
      >
        {tx(
          "Task details not reported yet. Make sure the Docker Swarm agent is sending metrics.",
        )}
      </p>
    );
  }

  const attentionItems: Array<ResourceAttentionItem> =
    getDockerSwarmAttentionItems({
      rows: [row],
      routeFor: props.routes.getPartRoute,
      now: props.now,
      scope: "part",
    });

  const readings: {
    cpuPercent: number | null;
    memoryBytes: number | null;
    memoryPercent: number | null;
  } = getDockerSwarmTaskReadings(row, props.now);
  const isRunning: boolean = (row.state || "").toLowerCase() === "running";

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
  ];

  if (row.serviceName) {
    detailRows.push({
      key: "service",
      label: "Service",
      value: props.serviceExternalId ? (
        <Link
          to={props.routes.getPartRoute("Service", props.serviceExternalId)}
          className={LINK_CLASS_NAME}
        >
          <bdi>{row.serviceName}</bdi>
        </Link>
      ) : (
        row.serviceName
      ),
    });
  }

  if (row.nodeHostname) {
    detailRows.push({
      key: "node",
      label: "Node",
      value: props.nodeExternalId ? (
        <Link
          to={props.routes.getPartRoute("Node", props.nodeExternalId)}
          className={LINK_CLASS_NAME}
        >
          <bdi>{row.nodeHostname}</bdi>
        </Link>
      ) : (
        row.nodeHostname
      ),
    });
  }

  const desiredState: string = getDockerSwarmAttribute(row, "desiredState");
  if (desiredState) {
    detailRows.push({
      key: "desired-state",
      label: "Desired State",
      value: desiredState,
      mono: true,
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.taskDesiredState,
    });
  }

  const since: string = getDockerSwarmAttribute(row, "since");
  if (since) {
    detailRows.push({
      key: "since",
      label: "State Since",
      value: formatDate(since),
    });
  }

  const error: string = getDockerSwarmAttribute(row, "error");
  if (error) {
    detailRows.push({
      key: "error",
      label: "Error",
      value: <bdi>{error}</bdi>,
    });
  }

  const exitCode: string = getDockerSwarmAttribute(row, "exitCode");
  if (exitCode && !isRunning) {
    detailRows.push({
      key: "exit-code",
      label: "Exit Code",
      value: exitCode,
      mono: true,
    });
  }

  if (row.image) {
    detailRows.push({
      key: "image",
      label: "Image",
      value: row.image,
      mono: true,
      copyText: row.image,
    });
  }

  const containerId: string = getDockerSwarmAttribute(row, "containerId");
  if (containerId) {
    detailRows.push({
      key: "container-id",
      label: "Container ID",
      value: containerId,
      mono: true,
      copyText: containerId,
    });
  }

  detailRows.push({
    key: "id",
    label: "Task ID",
    value: getDockerSwarmTaskId(row),
    mono: true,
    copyText: getDockerSwarmTaskId(row),
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
    <div data-testid="docker-swarm-task-overview">
      <NeedsAttentionCard
        testId="docker-swarm-task-attention"
        items={attentionItems}
        current={{
          key: getDockerSwarmAttentionKey("Task", props.externalId),
          label: THIS_TASK,
        }}
        description="What about this task is broken or needs a look."
      />

      {/*
       * What it uses now: only a running task's container has readings, and
       * a reading older than the inventory keeps a row is no reading.
       */}
      {isRunning ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          data-testid="docker-swarm-task-tiles"
        >
          <GoldenMetricTile
            title={tx("CPU")}
            icon={IconProp.CPUChip}
            iconColor="sky"
            value={formatPercent(readings.cpuPercent)}
            sublabel={tx("of one CPU core")}
            percent={
              readings.cpuPercent === null
                ? null
                : Math.min(100, readings.cpuPercent)
            }
            tone={
              readings.cpuPercent === null
                ? undefined
                : readings.cpuPercent > DOCKER_SWARM_TASK_CPU_WARNING_PERCENT
                  ? "warning"
                  : "positive"
            }
            description={DOCKER_SWARM_METRIC_DESCRIPTIONS.taskCpu}
          />
          <GoldenMetricTile
            title={tx("Memory")}
            icon={IconProp.SquareStack}
            iconColor="violet"
            value={formatPercent(readings.memoryPercent)}
            sublabel={
              readings.memoryBytes !== null
                ? translator.translateTemplate("{{used}} in use", {
                    used: formatBytes(readings.memoryBytes),
                  })
                : undefined
            }
            percent={readings.memoryPercent}
            tone={
              readings.memoryPercent === null
                ? undefined
                : readings.memoryPercent >
                    DOCKER_SWARM_TASK_MEMORY_WARNING_PERCENT
                  ? "warning"
                  : "positive"
            }
            description={DOCKER_SWARM_METRIC_DESCRIPTIONS.taskMemory}
          />
        </div>
      ) : (
        <></>
      )}

      <ResourcePartOpenEventsCard
        testId="docker-swarm-task-open"
        title="Open on this task"
        description="Unresolved incidents and alerts about this task, incidents first."
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
        testId="docker-swarm-task-alerts"
        title="Task alerts"
        description="The swarm's alerts that watch every task, this one included: each is one monitor that fires for any task that crosses it."
        resourceType={MonitorRecommendationResourceType.DockerSwarm}
        templateIds={DOCKER_SWARM_TASK_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="docker-swarm-task-details"
        description="What Docker Swarm reports about this task."
        rows={detailRows}
      />
    </div>
  );
};

export default DockerSwarmTaskOverview;
