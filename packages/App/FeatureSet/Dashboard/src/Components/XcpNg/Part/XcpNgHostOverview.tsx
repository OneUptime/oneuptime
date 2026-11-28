import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import {
  ResourcePartAttention,
  ResourcePartStatus,
} from "../../ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/XcpNgMetricDescriptions";
import { XCP_NG_PAGE_DESCRIPTIONS } from "../XcpNgPageDescriptions";
import XcpNgBusiestCard, { XCP_NG_BUSIEST_SHOWN } from "../XcpNgBusiestCard";
import { isXcpNgIssueAbout } from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XCP_NG_HOST_ALERT_TEMPLATE_IDS,
  XcpNgBusyPart,
  XcpNgVmSummary,
  getXcpNgBusiestParts,
  getXcpNgHostStatus,
  getXcpNgMemoryPercent,
  parseXcpNgTags,
  summarizeXcpNgVms,
} from "../../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  XCP_NG_METRIC_STALE_MS,
  formatXcpNgLoad,
  formatXcpNgPercent,
  formatXcpNgUptime,
  formatXcpNgWatts,
  getXcpNgDisplayName,
  toXcpNgDate,
  toXcpNgNumber,
} from "../../../Pages/XcpNg/Utils/XcpNgResourceUtils";
import { XcpNgPartRoutes } from "./XcpNgPartRoutes";

/*
 * An XCP-ng host's Overview: what on it needs attention (the host, the VMs
 * it runs and its local storage repositories, by the pool's own rules), how
 * busy it is, what is open on it, which VMs keep it busy, whether anyone
 * will hear when it is in trouble, and what Xen Orchestra reports about it.
 *
 * The tiles are the host's latest report, as a part's own page always shows
 * it: the last value Xen Orchestra sent, however old - the hero says when.
 */

export interface ComponentProps {
  poolId: ObjectID;
  poolName: string;
  poolIdentifier: string;
  externalId: string;
  row: XcpNgResource | null;
  // What the host holds: its VMs (its control domain included) and its storage.
  hostRows: Array<XcpNgResource>;
  attention: ResourcePartAttention;
  routes: XcpNgPartRoutes;
  onShowVms: () => void;
  now: Date;
  refreshToken?: number | undefined;
}

const XcpNgHostOverview: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };

  const row: XcpNgResource | null = props.row;

  if (!row) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid="xcp-ng-host-not-reported"
      >
        {tx(
          "Xen Orchestra does not report this host now. It may have left the pool, or the pool is not read: its Overview says which.",
        )}
      </p>
    );
  }

  const vms: Array<XcpNgResource> = props.hostRows.filter(
    (candidate: XcpNgResource): boolean => {
      return candidate.kind === XcpNgResourceKind.VM;
    },
  );
  const vmSummary: XcpNgVmSummary = summarizeXcpNgVms(vms);
  const busiestByCpu: Array<XcpNgBusyPart> = getXcpNgBusiestParts({
    rows: vms,
    kind: XcpNgResourceKind.VM,
    now: props.now,
    staleMs: XCP_NG_METRIC_STALE_MS,
    limit: XCP_NG_BUSIEST_SHOWN,
    rankBy: "cpu",
  });
  const busiestByMemory: Array<XcpNgBusyPart> = getXcpNgBusiestParts({
    rows: vms,
    kind: XcpNgResourceKind.VM,
    now: props.now,
    staleMs: XCP_NG_METRIC_STALE_MS,
    limit: XCP_NG_BUSIEST_SHOWN,
    rankBy: "memory",
  });

  const cpu: number | null = toXcpNgNumber(row.latestCpuPercent);
  const threads: number | null = toXcpNgNumber(row.cpuCount);
  const vcpus: number | null = toXcpNgNumber(row.runningVcpuCount);
  const memoryPercent: number | null = getXcpNgMemoryPercent(row);
  const memoryUsed: number | null = toXcpNgNumber(row.latestMemoryBytes);
  const memoryTotal: number | null = toXcpNgNumber(row.maxMemoryBytes);
  const watts: number | null = toXcpNgNumber(row.powerWatts);
  const load: number | null = toXcpNgNumber(row.loadAverage);
  const name: string = getXcpNgDisplayName(row, props.externalId);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Name",
      value: name,
      copyText: row.name || undefined,
    },
    {
      key: "pool",
      label: "XCP-ng Pool",
      value: (
        <Link
          to={props.routes.poolRoute}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {props.poolName}
        </Link>
      ),
    },
  ];
  const status: ResourcePartStatus | null = getXcpNgHostStatus(row);
  if (status) {
    detailRows.push({
      key: "state",
      label: "State",
      value: tx(status.label),
      description: XCP_NG_METRIC_DESCRIPTIONS.hostStatus,
    });
  }
  if (row.isEnabled !== null && row.isEnabled !== undefined) {
    detailRows.push({
      key: "enabled",
      label: "Enabled",
      value: row.isEnabled
        ? tx("Yes")
        : tx("No: in maintenance mode or being evacuated"),
      description: XCP_NG_METRIC_DESCRIPTIONS.hostEnabled,
    });
  }
  if (threads !== null && threads > 0) {
    detailRows.push({
      key: "threads",
      label: "CPU threads",
      value: translator.formatNumber(threads),
    });
  }
  if (vcpus !== null) {
    detailRows.push({
      key: "vcpus",
      label: "Running vCPUs",
      value: translator.formatNumber(vcpus),
      description: XCP_NG_METRIC_DESCRIPTIONS.hostRunningVcpus,
    });
  }
  if (memoryTotal !== null && memoryTotal > 0) {
    detailRows.push({
      key: "memory",
      label: "Memory",
      value: formatStorageBytes(memoryTotal, translator.language),
    });
  }
  const uptime: string =
    row.isUp === true ? formatXcpNgUptime(row.uptimeSeconds, translator) : "";
  if (uptime) {
    detailRows.push({
      key: "uptime",
      label: "Uptime",
      value: uptime,
      description: XCP_NG_METRIC_DESCRIPTIONS.hostUptime,
    });
  }
  if (load !== null) {
    detailRows.push({
      key: "load",
      label: "Control domain load",
      value: formatXcpNgLoad(load),
      description: XCP_NG_METRIC_DESCRIPTIONS.hostLoad,
    });
  }
  if (watts !== null) {
    detailRows.push({
      key: "power",
      label: "Power",
      value: formatXcpNgWatts(watts),
      description: XCP_NG_METRIC_DESCRIPTIONS.hostPower,
    });
  }
  const tags: Array<string> = parseXcpNgTags(row.tags);
  if (tags.length > 0) {
    detailRows.push({
      key: "tags",
      label: "Tags",
      value: tags.join(", "),
    });
  }
  detailRows.push({
    key: "uuid",
    label: "UUID",
    value: props.externalId,
    mono: true,
    copyText: props.externalId,
  });
  const lastReport: Date | null = toXcpNgDate(row.lastSeenAt);
  if (lastReport) {
    detailRows.push({
      key: "last-report",
      label: "Last report",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastReport),
    });
  }

  return (
    <div data-testid="xcp-ng-host-overview">
      <NeedsAttentionCard
        testId="xcp-ng-host-attention"
        items={props.attention.items}
        current={props.attention.current}
        description={props.attention.description}
      />

      <div
        className={`mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 ${
          watts !== null ? "xl:grid-cols-4" : "xl:grid-cols-3"
        }`}
        data-testid="xcp-ng-host-tiles"
      >
        <GoldenMetricTile
          title="CPU"
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={formatXcpNgPercent(cpu)}
          sublabel={
            cpu !== null && threads !== null && threads > 0
              ? translator.translatePlural(
                  { one: "of {{count}} thread", other: "of {{count}} threads" },
                  threads,
                )
              : undefined
          }
          percent={cpu}
          thresholds={{ warn: 80, danger: 90 }}
          description={XCP_NG_METRIC_DESCRIPTIONS.hostCpu}
        />
        <GoldenMetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={formatXcpNgPercent(memoryPercent)}
          sublabel={
            memoryUsed !== null && memoryTotal !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatStorageBytes(memoryUsed, translator.language),
                  total: formatStorageBytes(memoryTotal, translator.language),
                })
              : undefined
          }
          percent={memoryPercent}
          thresholds={{ warn: 85, danger: 95 }}
          description={XCP_NG_METRIC_DESCRIPTIONS.hostMemory}
        />
        <GoldenMetricTile
          title="VMs"
          icon={IconProp.Cube}
          iconColor="sky"
          value={
            vmSummary.total > 0
              ? // In the reader's digits, as the hero's chips write them.
                `${translator.formatNumber(vmSummary.running)}/${translator.formatNumber(vmSummary.total)}`
              : undefined
          }
          sublabel="running"
          description={XCP_NG_PAGE_DESCRIPTIONS.hostVms}
        />
        {watts !== null ? (
          <GoldenMetricTile
            title="Power"
            icon={IconProp.Bolt}
            iconColor="amber"
            value={formatXcpNgWatts(watts)}
            sublabel="from the host's power sensor"
            description={XCP_NG_METRIC_DESCRIPTIONS.hostPower}
          />
        ) : (
          <></>
        )}
      </div>

      <ResourcePartOpenEventsCard
        testId="xcp-ng-host-open"
        title="Open on this host"
        description="Unresolved incidents and alerts about this host, incidents first."
        resourceRelation="xcpNgPools"
        resourceId={props.poolId}
        isAbout={(record: OpenIssueRecord): boolean => {
          return isXcpNgIssueAbout(record, { externalId: props.externalId });
        }}
        getIncidentRoute={props.routes.getIncidentRoute}
        getAlertRoute={props.routes.getAlertRoute}
        incidentsRoute={props.routes.incidentsRoute}
        alertsRoute={props.routes.alertsRoute}
        refreshToken={props.refreshToken}
      />

      {vmSummary.running > 0 ? (
        <div className="mb-6">
          <XcpNgBusiestCard
            testId="xcp-ng-host-busiest-vms"
            title="Busiest VMs"
            description="The running VMs on this host using the most CPU, and the most memory, at their latest report."
            cpu={{
              title: "CPU Usage",
              description: XCP_NG_METRIC_DESCRIPTIONS.topVmsByCpu,
              subtitle: translator.translatePlural(
                {
                  one: "Top {{count}} VM by CPU",
                  other: "Top {{count}} VMs by CPU",
                },
                XCP_NG_BUSIEST_SHOWN,
              ),
              parts: busiestByCpu,
              emptyMessage:
                "No running VM on this host has reported its CPU in the last 15 minutes.",
            }}
            memory={{
              title: "Memory Usage",
              description: XCP_NG_METRIC_DESCRIPTIONS.topVmsByMemory,
              subtitle: translator.translatePlural(
                {
                  one: "Top {{count}} VM by memory",
                  other: "Top {{count}} VMs by memory",
                },
                XCP_NG_BUSIEST_SHOWN,
              ),
              parts: busiestByMemory,
              emptyMessage:
                "No running VM on this host reports the memory it uses: that needs its guest tools.",
            }}
            getRoute={(part: XcpNgBusyPart) => {
              return props.routes.getPartRoute("VM", part.row.externalId || "");
            }}
            allLabel={translator.translatePlural(
              { one: "View {{count}} VM", other: "View all {{count}} VMs" },
              vmSummary.total,
            )}
            onShowAll={props.onShowVms}
          />
        </div>
      ) : (
        <></>
      )}

      <ResourcePartAlertsCard
        testId="xcp-ng-host-alerts"
        title="Host alerts"
        description="The pool's alerts that watch every host, this one included: each is one monitor that fires for any host that crosses it."
        resourceType={MonitorRecommendationResourceType.XcpNg}
        templateIds={XCP_NG_HOST_ALERT_TEMPLATE_IDS}
        resourceId={props.poolId}
        resourceIdentifier={props.poolIdentifier}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="xcp-ng-host-details"
        description="What Xen Orchestra reports about this host."
        rows={detailRows}
      />
    </div>
  );
};

export default XcpNgHostOverview;
