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
  getDockerSwarmServiceRows,
  isDockerSwarmIssueAbout,
  isDockerSwarmJobService,
  toDockerSwarmDate,
  toDockerSwarmNumber,
} from "../../../Pages/DockerSwarm/Utils/DockerSwarmHealth";
import { DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS } from "../../../Pages/DockerSwarm/Utils/DockerSwarmPartFacts";
import { formatReplicas } from "../../../Pages/DockerSwarm/Utils/DockerSwarmResourceUtils";
import { DockerSwarmPartRoutes } from "./DockerSwarmPartRoutes";
import DockerSwarmTasksTable from "./DockerSwarmTasksTable";

/*
 * A Docker Swarm service's Overview: whether it or its tasks need
 * attention (its replicas, its last rolling update, the tasks that keep
 * failing), its tasks, what is open on it, whether anyone hears when it
 * runs short, and what Swarm reports about it.
 */

// How the service's own row reads in its Needs attention card.
const THIS_SERVICE: string = translationKey("This service");

// A rolling update's state, as `docker service inspect` says it.
const UPDATE_STATE_WORDS: Record<string, string> = {
  updating: translationKey("Updating"),
  paused: translationKey("Update paused"),
  completed: translationKey("Completed"),
  rollback_started: translationKey("Rolling back"),
  rollback_paused: translationKey("Rollback paused"),
  rollback_completed: translationKey("Rolled back"),
};

const MODE_WORDS: Record<string, string> = {
  replicated: translationKey("Replicated"),
  global: translationKey("Global"),
  "replicated-job": translationKey("Replicated job"),
  "global-job": translationKey("Global job"),
};

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: DockerSwarmResource | null;
  // The cluster's inventory, for the service's tasks.
  rows: Array<DockerSwarmResource>;
  routes: DockerSwarmPartRoutes;
  now: Date;
  refreshToken?: number | undefined;
}

function formatDate(value: string): string {
  const date: Date | null = toDockerSwarmDate(value);
  return date ? OneUptimeDate.getDateAsLocalFormattedString(date) : value;
}

const DockerSwarmServiceOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="docker-swarm-service-not-reported"
      >
        {tx(
          "Service details not reported yet. Make sure the Docker Swarm agent is sending metrics.",
        )}
      </p>
    );
  }

  const serviceRows: Array<DockerSwarmResource> = getDockerSwarmServiceRows({
    rows: props.rows,
    service: row,
  });

  const attentionItems: Array<ResourceAttentionItem> =
    getDockerSwarmAttentionItems({
      rows: serviceRows,
      routeFor: props.routes.getPartRoute,
      now: props.now,
      scope: "part",
    });

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
  ];

  const mode: string = (row.serviceMode || "").toLowerCase();
  if (mode) {
    detailRows.push({
      key: "mode",
      label: "Mode",
      value: MODE_WORDS[mode] ? tx(MODE_WORDS[mode] as string) : mode,
    });
  }

  if (!isDockerSwarmJobService(row)) {
    detailRows.push({
      key: "replicas",
      label: "Replicas",
      value: formatReplicas(row),
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.replicas,
    });
  } else {
    const completed: number | null = toDockerSwarmNumber(
      getDockerSwarmAttribute(row, "completedTasks"),
    );
    if (completed !== null) {
      detailRows.push({
        key: "completed",
        label: "Completed Tasks",
        value: translator.formatNumber(completed),
      });
    }
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

  if (row.stackName) {
    detailRows.push({
      key: "stack",
      label: "Stack",
      value: row.stackName,
    });
  }

  const ports: string = getDockerSwarmAttribute(row, "ports");
  if (ports) {
    detailRows.push({ key: "ports", label: "Ports", value: ports, mono: true });
  }

  const updateState: string = getDockerSwarmAttribute(
    row,
    "updateState",
  ).toLowerCase();
  if (updateState) {
    const word: string | undefined = UPDATE_STATE_WORDS[updateState];
    detailRows.push({
      key: "update",
      label: "Last Update",
      value: word ? tx(word) : updateState,
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.serviceUpdate,
    });
  }

  const updateMessage: string = getDockerSwarmAttribute(row, "updateMessage");
  if (updateMessage) {
    detailRows.push({
      key: "update-message",
      label: "Update Message",
      value: <bdi>{updateMessage}</bdi>,
    });
  }

  const updateStartedAt: string = getDockerSwarmAttribute(
    row,
    "updateStartedAt",
  );
  if (updateStartedAt) {
    detailRows.push({
      key: "update-started",
      label: "Update Started",
      value: formatDate(updateStartedAt),
    });
  }

  const updateCompletedAt: string = getDockerSwarmAttribute(
    row,
    "updateCompletedAt",
  );
  if (updateCompletedAt) {
    detailRows.push({
      key: "update-completed",
      label: "Update Completed",
      value: formatDate(updateCompletedAt),
    });
  }

  const failedTasks: number | null = toDockerSwarmNumber(
    getDockerSwarmAttribute(row, "recentFailedTasks"),
  );
  if (failedTasks !== null) {
    detailRows.push({
      key: "failed-tasks",
      label: "Failed Tasks (Last Hour)",
      value: translator.formatNumber(failedTasks),
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.recentFailedTasks,
    });
  }

  const lastTaskError: string = getDockerSwarmAttribute(row, "lastTaskError");
  if (lastTaskError) {
    const exitCode: string = getDockerSwarmAttribute(row, "lastTaskExitCode");
    const errorAt: string = getDockerSwarmAttribute(row, "lastTaskErrorAt");
    detailRows.push({
      key: "last-error",
      label: "Last Task Error",
      value: <bdi>{lastTaskError}</bdi>,
      description: DOCKER_SWARM_METRIC_DESCRIPTIONS.lastTaskError,
    });
    if (exitCode) {
      detailRows.push({
        key: "last-exit-code",
        label: "Last Exit Code",
        value: exitCode,
        mono: true,
      });
    }
    if (errorAt) {
      detailRows.push({
        key: "last-error-at",
        label: "Last Task Failed",
        value: formatDate(errorAt),
      });
    }
  }

  const createdAt: string = getDockerSwarmAttribute(row, "createdAt");
  if (createdAt) {
    detailRows.push({
      key: "created",
      label: "Created",
      value: formatDate(createdAt),
    });
  }

  detailRows.push({
    key: "id",
    label: "Service ID",
    value: props.externalId.replace("service/", ""),
    mono: true,
    copyText: props.externalId.replace("service/", ""),
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
    <div data-testid="docker-swarm-service-overview">
      <NeedsAttentionCard
        testId="docker-swarm-service-attention"
        items={attentionItems}
        current={{
          key: getDockerSwarmAttentionKey("Service", props.externalId),
          label: THIS_SERVICE,
        }}
        description="What about this service and its tasks is broken or needs a look."
      />

      <DockerSwarmTasksTable
        title="Tasks"
        description="The tasks Swarm runs for this service, with their state, their node and what each one uses."
        rows={serviceRows}
        groupBy="node"
        getTaskRoute={(externalId: string) => {
          return props.routes.getPartRoute("Task", externalId);
        }}
        now={props.now}
        emptyMessage="This service runs no tasks."
      />

      <ResourcePartOpenEventsCard
        testId="docker-swarm-service-open"
        title="Open on this service"
        description="Unresolved incidents and alerts about this service and its tasks, incidents first."
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
        testId="docker-swarm-service-alerts"
        title="Service alerts"
        description="The swarm's alerts that watch every service and its tasks, this one included: each is one monitor that fires for any service or task that crosses it."
        resourceType={MonitorRecommendationResourceType.DockerSwarm}
        templateIds={DOCKER_SWARM_SERVICE_ALERT_TEMPLATE_IDS}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="docker-swarm-service-details"
        description="What Docker Swarm reports about this service."
        rows={detailRows}
      />
    </div>
  );
};

export default DockerSwarmServiceOverview;
