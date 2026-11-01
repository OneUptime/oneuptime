import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import ProxmoxResource from "Common/Models/DatabaseModels/ProxmoxResource";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  composedValue,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { formatRelativeTime } from "../../Home/HomeRelativeTime";
import { PROXMOX_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/ProxmoxMetricDescriptions";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import { ResourceAttentionItem } from "../../ResourcePart/ResourceAttention";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import {
  getProxmoxAttentionItems,
  isProxmoxIssueAbout,
} from "../../../Pages/Proxmox/Utils/ProxmoxHealth";
import {
  ProxmoxGuestBackup,
  formatProxmoxDuration,
  getProxmoxDiskPercent,
  getProxmoxGuestAlertTemplateIds,
  getProxmoxGuestBackup,
  getProxmoxGuestKind,
  getProxmoxMemoryPercent,
  parseProxmoxTags,
  toProxmoxDate,
  toProxmoxNumber,
} from "../../../Pages/Proxmox/Utils/ProxmoxPartFacts";
import {
  formatBytes,
  formatPercent,
  formatUptime,
} from "../../../Pages/Proxmox/Utils/ProxmoxResourceUtils";
import { ProxmoxPartRoutes } from "./ProxmoxPartRoutes";

/*
 * A Proxmox guest's Overview: what about it needs attention, how busy it
 * is, how its last backup went, what is open on it, whether anyone will
 * hear when it is in trouble, and its details - from what Proxmox VE
 * reports about a VM or a container, and, for its backups, from Proxmox
 * VE's own notifications.
 *
 * The tiles are the guest's latest report, as a detail page always shows
 * it: the last value the agent sent, however old. A template never runs, so
 * it has no CPU, memory or disk tile - three dashes and a hint to install
 * the QEMU guest agent in a guest that never starts - only its last backup.
 */

// How the guest's own row reads in its Needs attention card.
const THIS_GUEST: string = translationKey("This guest");

export interface ComponentProps {
  clusterId: ObjectID;
  clusterName: string;
  externalId: string;
  row: ProxmoxResource | null;
  routes: ProxmoxPartRoutes;
  refreshToken?: number | undefined;
  // Drawn last: the linked host, or how to see inside the guest.
  footer?: ReactNode | undefined;
}

const ProxmoxGuestOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: ProxmoxResource | null = props.row;

  if (!row) {
    return (
      <div className="space-y-6">
        <p
          className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
          data-testid="proxmox-guest-not-reported"
        >
          {tx(
            "Guest details not reported yet. Make sure the Proxmox agent is sending metrics.",
          )}
        </p>
        {props.footer}
      </div>
    );
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const when: (date: Date) => ReturnType<typeof composedValue> = (
    date: Date,
  ): ReturnType<typeof composedValue> => {
    return composedValue((sentence: Translator): string => {
      return formatRelativeTime({
        date: date,
        now: now,
        language: sentence.language,
      });
    });
  };

  const attentionItems: Array<ResourceAttentionItem> = getProxmoxAttentionItems(
    {
      rows: [row],
      routeFor: props.routes.getPartRoute,
    },
  );

  const isQemu: boolean =
    row.guestType === "qemu" || props.externalId.startsWith("qemu/");
  const cpu: number | null = toProxmoxNumber(row.latestCpuPercent);
  const cores: number | null = toProxmoxNumber(row.cpuCount);
  const memoryPercent: number | null = getProxmoxMemoryPercent(row);
  const memoryUsed: number | null = toProxmoxNumber(row.latestMemoryBytes);
  const memoryTotal: number | null = toProxmoxNumber(row.maxMemoryBytes);
  const diskPercent: number | null = getProxmoxDiskPercent(row);
  const diskUsed: number | null = toProxmoxNumber(row.latestDiskBytes);
  const diskTotal: number | null = toProxmoxNumber(row.maxDiskBytes);
  const backup: ProxmoxGuestBackup = getProxmoxGuestBackup(row);

  // The Last Backup tile: how it went, then when, its size and its time.
  const backupDetails: Array<string> = [];
  if (backup.lastBackupAt) {
    backupDetails.push(
      translator.translateTemplate("finished {{time}}", {
        time: when(backup.lastBackupAt),
      }),
    );
  }
  if (backup.state === "ok" && backup.bytes !== null) {
    const duration: string = formatProxmoxDuration(backup.durationSeconds);
    backupDetails.push(
      duration
        ? translator.translateTemplate("{{size}} in {{duration}}", {
            size: formatBytes(backup.bytes),
            duration: duration,
          })
        : formatBytes(backup.bytes),
    );
  }
  if (backup.state === "failed") {
    backupDetails.push(
      backup.lastSuccessfulBackupAt
        ? translator.translateTemplate("last good {{time}}", {
            time: when(backup.lastSuccessfulBackupAt),
          })
        : tx("no good backup yet"),
    );
  }

  const backupValue: string =
    backup.state === "ok"
      ? tx("OK")
      : backup.state === "failed"
        ? tx("Failed")
        : backup.state === "not-in-job"
          ? tx("None")
          : "—";
  const backupSublabel: string =
    backupDetails.length > 0
      ? backupDetails.join(" · ")
      : backup.state === "no-result"
        ? tx("in a backup job, no result yet")
        : backup.state === "not-in-job"
          ? tx("in no backup job")
          : tx("not reported yet");

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: row.name || props.externalId,
      copyText: row.name || undefined,
    },
  ];
  const vmid: number | null = toProxmoxNumber(row.vmid);
  if (vmid !== null) {
    detailRows.push({
      key: "vmid",
      label: "VMID",
      value: String(vmid),
      mono: true,
      copyText: String(vmid),
    });
  }
  const kind: string = getProxmoxGuestKind(row);
  if (kind) {
    detailRows.push({
      key: "type",
      label: "Type",
      value: row.isTemplate
        ? kind === "VM"
          ? tx("VM template")
          : tx("Container template")
        : tx(kind),
    });
  }
  if (row.parentNodeName) {
    detailRows.push({
      key: "node",
      label: "Node",
      value: (
        <Link
          to={props.routes.getPartRoute("Node", `node/${row.parentNodeName}`)}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {row.parentNodeName}
        </Link>
      ),
    });
  }
  if (row.onboot !== null && row.onboot !== undefined) {
    detailRows.push({
      key: "onboot",
      label: "Start on boot",
      value: row.onboot ? tx("Yes") : tx("No"),
      description: PROXMOX_METRIC_DESCRIPTIONS.guestStartOnBoot,
    });
  }
  if (row.haState) {
    detailRows.push({
      key: "ha",
      label: "HA state",
      value: row.haState,
      description: PROXMOX_METRIC_DESCRIPTIONS.guestHaState,
    });
  }
  if (backup.isInJob !== null) {
    detailRows.push({
      key: "backup-job",
      label: "Backup job",
      value: backup.isInJob ? tx("In a backup job") : tx("In no backup job"),
      description: PROXMOX_METRIC_DESCRIPTIONS.guestBackupCoverage,
    });
  }
  if (backup.lastSuccessfulBackupAt) {
    detailRows.push({
      key: "last-good-backup",
      label: "Last good backup",
      value: OneUptimeDate.getDateAsLocalFormattedString(
        backup.lastSuccessfulBackupAt,
      ),
    });
  }
  const tags: Array<string> = parseProxmoxTags(row.tags);
  if (tags.length > 0) {
    detailRows.push({
      key: "tags",
      label: "Tags",
      value: tags.join(", "),
    });
  }
  if (cores !== null && cores > 0) {
    detailRows.push({
      key: "cores",
      label: "CPU cores",
      value: translator.formatNumber(cores),
    });
  }
  if (memoryTotal !== null && memoryTotal > 0) {
    detailRows.push({
      key: "memory",
      label: "Memory",
      value: formatBytes(memoryTotal),
    });
  }
  if (diskTotal !== null && diskTotal > 0) {
    detailRows.push({
      key: "disk",
      label: "Disk size",
      value: formatBytes(diskTotal),
    });
  }
  const uptime: string =
    row.isUp !== false ? formatUptime(row.uptimeSeconds) : "";
  if (uptime) {
    detailRows.push({
      key: "uptime",
      label: "Uptime",
      value: uptime,
      description: PROXMOX_METRIC_DESCRIPTIONS.guestUptime,
    });
  }
  detailRows.push({
    key: "id",
    label: "Proxmox ID",
    value: props.externalId,
    mono: true,
    copyText: props.externalId,
  });
  const lastReport: Date | null = toProxmoxDate(row.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  return (
    <div data-testid="proxmox-guest-overview">
      <NeedsAttentionCard
        testId="proxmox-guest-attention"
        items={attentionItems}
        current={{ key: `Guest:${props.externalId}`, label: THIS_GUEST }}
        description="What about this guest is broken or needs a look, the most urgent first."
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="proxmox-guest-tiles"
      >
        {row.isTemplate ? (
          <></>
        ) : (
          <>
            <GoldenMetricTile
              title={tx("CPU")}
              icon={IconProp.CPUChip}
              iconColor="blue"
              value={formatPercent(cpu)}
              sublabel={
                cpu !== null && cores !== null && cores > 0
                  ? translator.translatePlural(
                      { one: "of {{count}} core", other: "of {{count}} cores" },
                      cores,
                    )
                  : undefined
              }
              percent={cpu}
              thresholds={{ warn: 80, danger: 90 }}
              description={PROXMOX_METRIC_DESCRIPTIONS.guestCpu}
            />
            <GoldenMetricTile
              title={tx("Memory")}
              icon={IconProp.SquareStack}
              iconColor="violet"
              value={formatPercent(memoryPercent)}
              sublabel={
                memoryUsed !== null && memoryTotal !== null
                  ? translator.translateTemplate("{{used}} of {{total}}", {
                      used: formatBytes(memoryUsed),
                      total: formatBytes(memoryTotal),
                    })
                  : undefined
              }
              percent={memoryPercent}
              thresholds={{ warn: 80, danger: 95 }}
              description={PROXMOX_METRIC_DESCRIPTIONS.guestMemory}
            />
            <GoldenMetricTile
              title={tx("Disk")}
              icon={IconProp.Database}
              iconColor="amber"
              value={
                diskUsed === null && isQemu
                  ? tx("N/A")
                  : formatPercent(diskPercent)
              }
              sublabel={
                diskUsed === null && isQemu
                  ? tx("install the QEMU guest agent for disk usage")
                  : diskUsed !== null && diskTotal !== null
                    ? translator.translateTemplate("{{used}} of {{total}}", {
                        used: formatBytes(diskUsed),
                        total: formatBytes(diskTotal),
                      })
                    : undefined
              }
              percent={diskPercent}
              thresholds={{ warn: 80, danger: 90 }}
              description={PROXMOX_METRIC_DESCRIPTIONS.guestDisk}
            />
          </>
        )}
        <GoldenMetricTile
          title={tx("Last Backup")}
          icon={IconProp.Archive}
          iconColor="emerald"
          value={backupValue}
          sublabel={backupSublabel}
          // A full bar in the result's colour: green for OK, red for Failed.
          percent={
            backup.state === "ok" || backup.state === "failed" ? 100 : null
          }
          thresholds={
            backup.state === "failed"
              ? { warn: 101, danger: 101 }
              : { warn: 0, danger: 0 }
          }
          higherIsBetter={true}
          description={PROXMOX_METRIC_DESCRIPTIONS.guestLastBackup}
        />
      </div>

      <ResourcePartOpenEventsCard
        testId="proxmox-guest-open"
        title="Open on this guest"
        description="Unresolved incidents and alerts about this guest, incidents first."
        resourceRelation="proxmoxClusters"
        resourceId={props.clusterId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isProxmoxIssueAbout(record, row);
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartAlertsCard
        testId="proxmox-guest-alerts"
        title="Guest alerts"
        description="The cluster's alerts that watch every guest, this one included: each is one monitor that fires for any guest that crosses it."
        resourceType={MonitorRecommendationResourceType.Proxmox}
        templateIds={getProxmoxGuestAlertTemplateIds(row)}
        resourceId={props.clusterId}
        resourceIdentifier={props.clusterName}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="proxmox-guest-details"
        description="What Proxmox VE reports about this guest."
        rows={detailRows}
      />

      {props.footer}
    </div>
  );
};

export default ProxmoxGuestOverview;
