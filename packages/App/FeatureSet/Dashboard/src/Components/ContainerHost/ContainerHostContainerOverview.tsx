import React, { FunctionComponent, ReactElement } from "react";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../Infrastructure/GoldenMetricTile";
import { CONTAINER_HOST_METRIC_DESCRIPTIONS } from "../MetricDescriptions/ContainerHostMetricDescriptions";
import NeedsAttentionCard from "../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../ResourcePart/ResourcePartOpenEventsCard";
import { ResourceAttentionItem } from "../ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../ResourceTopology/ResourceTopologyIssues";
import { formatRelativeTime } from "../Home/HomeRelativeTime";
import ObjectID from "Common/Types/ObjectID";
import {
  ContainerHostAssessment,
  ContainerHostContainer,
  THIS_CONTAINER_LABEL,
  assessContainer,
  getContainerAttentionKey,
  getContainerComposeProject,
  getContainerComposeService,
  getContainerHostAttentionItems,
  isContainerIssueAbout,
} from "./ContainerHostHealth";
import {
  getContainerCpuTone,
  getContainerMemoryTone,
} from "./ContainerHostRows";
import {
  ContainerHostRoutes,
  ContainerHostRuntime,
} from "./ContainerHostRuntime";

/*
 * A Docker or Podman container's Overview: whether it needs attention and
 * why (ContainerHostHealth, as the host's Needs attention says it), what it
 * uses now against its alerts' lines, how often it restarted, what is open
 * on it, whether the host's container alerts watch it, and what the agent
 * reports about it. Shared by both runtimes: the two pages differ only in
 * the runtime they hand in.
 */

export const CONTAINER_HOST_CONTAINER_OVERVIEW_TEST_ID: string =
  "container-host-container-overview";

const LINK_CLASS_NAME: string =
  "text-indigo-600 hover:text-indigo-700 hover:underline";

export interface ComponentProps {
  runtime: ContainerHostRuntime;
  hostId: ObjectID;
  hostName: string;
  // The host's host.name: what its alerts are set up for.
  hostIdentifier: string;
  container: ContainerHostContainer | null;
  hostLatestReadingAt: Date | null;
  // Whether the agent sends restart counts (an older agent does not).
  hasRestartCounts: boolean;
  routes: ContainerHostRoutes;
  readAt: Date;
  refreshToken?: number | undefined;
}

function formatPercent(value: number | null): string {
  return value === null || !Number.isFinite(value)
    ? "—"
    : `${value.toFixed(1)}%`;
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units: Array<string> = ["B", "KB", "MB", "GB", "TB"];
  let value: number = bytes;
  let index: number = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index++;
  }
  return `${value.toFixed(value >= 100 || index === 0 ? 0 : 1)} ${units[index]}`;
}

const ContainerHostContainerOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const container: ContainerHostContainer | null = props.container;

  if (!container) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid="container-host-container-not-reported"
      >
        {tx(
          "No reading of this container has arrived in the last 15 minutes. It may have stopped, been removed or renamed; the Containers list has every container the agent reports.",
        )}
      </p>
    );
  }

  const assessment: ContainerHostAssessment = assessContainer(
    container,
    props.hostLatestReadingAt,
  );
  const isRunning: boolean =
    assessment.state === "running" || assessment.state === "restart-loop";

  const attentionItems: Array<ResourceAttentionItem> =
    getContainerHostAttentionItems({
      containers: [container],
      hostLatestReadingAt: props.hostLatestReadingAt,
    });

  const restarts: number | null = props.hasRestartCounts
    ? Math.max(0, Math.round(container.restarts || 0))
    : null;
  const cpuPercent: number | null = isRunning ? container.cpuPercent : null;
  const memoryPercent: number | null = isRunning
    ? container.memoryPercent
    : null;

  const composeProject: string = getContainerComposeProject(container);
  const composeService: string = getContainerComposeService(container);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: container.name,
      copyText: container.name,
    },
    {
      key: "host",
      label: "Host",
      value: (
        <Link to={props.routes.hostRoute} className={LINK_CLASS_NAME}>
          <bdi>{props.hostName}</bdi>
        </Link>
      ),
    },
  ];

  if (container.image) {
    detailRows.push({
      key: "image",
      label: "Image",
      value: container.image,
      mono: true,
      copyText: container.image,
    });
  }

  if (container.containerId) {
    detailRows.push({
      key: "container-id",
      label: "Container ID",
      value: container.containerId,
      mono: true,
      copyText: container.containerId,
    });
  }

  if (composeProject) {
    detailRows.push({
      key: "compose-project",
      label: "Compose Project",
      value: composeProject,
      description: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerComposeProject,
    });
  }

  if (composeService) {
    detailRows.push({
      key: "compose-service",
      label: "Compose Service",
      value: composeService,
    });
  }

  // Running totals since it started: the network columns of `docker stats`.
  if (isRunning && container.networkRxBytes !== null) {
    detailRows.push({
      key: "network-rx",
      label: "Network RX (total)",
      value: formatBytes(container.networkRxBytes),
      description: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerNetworkRx,
    });
  }

  if (isRunning && container.networkTxBytes !== null) {
    detailRows.push({
      key: "network-tx",
      label: "Network TX (total)",
      value: formatBytes(container.networkTxBytes),
      description: CONTAINER_HOST_METRIC_DESCRIPTIONS.containerNetworkTx,
    });
  }

  if (isRunning && container.startedAt) {
    detailRows.push({
      key: "started",
      label: "Last Started",
      value: OneUptimeDate.getDateAsLocalFormattedString(container.startedAt),
    });
  }

  if (container.lastReadingAt) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(
        container.lastReadingAt,
      ),
    });
  }

  return (
    <div data-testid={CONTAINER_HOST_CONTAINER_OVERVIEW_TEST_ID}>
      <NeedsAttentionCard
        testId="container-host-container-attention"
        items={attentionItems}
        current={{
          key: getContainerAttentionKey(container.name),
          label: THIS_CONTAINER_LABEL,
        }}
        description="What about this container is broken or needs a look."
      />

      {/*
       * What it uses now: a container that stopped reporting has no reading
       * that says so - its last ones are minutes old.
       */}
      {isRunning ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
          data-testid="container-host-container-tiles"
        >
          <GoldenMetricTile
            title={tx("CPU")}
            icon={IconProp.CPUChip}
            iconColor="sky"
            value={formatPercent(cpuPercent)}
            sublabel={tx("of one CPU core")}
            percent={cpuPercent === null ? null : Math.min(100, cpuPercent)}
            tone={
              cpuPercent === null
                ? undefined
                : getContainerCpuTone(cpuPercent) || "positive"
            }
            description={CONTAINER_HOST_METRIC_DESCRIPTIONS.containerCpuTile}
          />
          <GoldenMetricTile
            title={tx("Memory")}
            icon={IconProp.SquareStack}
            iconColor="violet"
            value={formatPercent(memoryPercent)}
            sublabel={
              container.memoryBytes !== null
                ? translator.translateTemplate(
                    "{{used}} in use",
                    { used: formatBytes(container.memoryBytes) },
                    // "96.0 MB" reads as written in a Persian sentence.
                    { setsValuesApart: true },
                  )
                : undefined
            }
            percent={memoryPercent}
            tone={
              memoryPercent === null
                ? undefined
                : getContainerMemoryTone(memoryPercent) || "positive"
            }
            description={CONTAINER_HOST_METRIC_DESCRIPTIONS.containerMemoryTile}
          />
          <GoldenMetricTile
            title={tx("Restarts")}
            icon={IconProp.Refresh}
            iconColor="amber"
            value={restarts === null ? "—" : translator.formatNumber(restarts)}
            /*
             * The window the count is of, whatever the count: the hero and
             * Needs attention already say when it is a restart loop.
             */
            sublabel={
              restarts === null ? undefined : tx("in the last 15 minutes")
            }
            description={
              CONTAINER_HOST_METRIC_DESCRIPTIONS.containerRestartsTile
            }
          />
          <GoldenMetricTile
            title={tx("Last Started")}
            icon={IconProp.Clock}
            iconColor="emerald"
            value={
              container.startedAt
                ? formatRelativeTime({
                    date: container.startedAt,
                    now: props.readAt,
                    language: translator.language,
                  })
                : "—"
            }
            sublabel={
              container.startedAt
                ? OneUptimeDate.getDateAsLocalFormattedString(
                    container.startedAt,
                  )
                : undefined
            }
            description={CONTAINER_HOST_METRIC_DESCRIPTIONS.containerUptimeTile}
          />
        </div>
      ) : (
        <></>
      )}

      <ResourcePartOpenEventsCard
        testId="container-host-container-open"
        title="Open on this container"
        description="Unresolved incidents and alerts about this container, incidents first."
        resourceRelation={props.runtime.resourceRelation}
        resourceId={props.hostId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isContainerIssueAbout(record, container.name);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartAlertsCard
        testId="container-host-container-alerts"
        title="Container alerts"
        description="The host's alerts that watch every container, this one included: each is one monitor that fires for any container that crosses it."
        resourceType={props.runtime.recommendationResourceType}
        templateIds={props.runtime.containerAlertTemplateIds}
        resourceId={props.hostId}
        resourceIdentifier={props.hostIdentifier}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="container-host-container-details"
        description="What the agent reports about this container."
        rows={detailRows}
      />
    </div>
  );
};

export default ContainerHostContainerOverview;
