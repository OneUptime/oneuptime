import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { composedValue, Translator } from "Common/UI/Utils/TranslateTemplate";
import { formatStorageBytes } from "Common/Utils/Storage/StorageUsage";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import { formatRelativeTime } from "../../Home/HomeRelativeTime";
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
import XcpNgVirtualDisksCard from "../XcpNgVirtualDisksCard";
import {
  isXcpNgControlDomain,
  isXcpNgIssueAbout,
} from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XCP_NG_VM_ALERT_TEMPLATE_IDS,
  XcpNgVmMemory,
  getXcpNgVmMemory,
  getXcpNgVmStatus,
  parseXcpNgTags,
} from "../../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  formatXcpNgPercent,
  formatXcpNgUptime,
  formatXcpNgWatts,
  getXcpNgDisplayName,
  toXcpNgDate,
  toXcpNgNumber,
} from "../../../Pages/XcpNg/Utils/XcpNgResourceUtils";
import { XcpNgPartRoutes } from "./XcpNgPartRoutes";

/*
 * An XCP-ng VM's Overview: what about it needs attention, how busy it is,
 * how long it has run (or when it last ran), its virtual disks and the
 * storage repository each is on, what is open on it, whether anyone will
 * hear when it stops, and what Xen Orchestra reports about it.
 *
 * Its memory is in use only while its guest tools report what is free:
 * without them Xen Orchestra cannot see inside the VM, and the tile says the
 * memory it was given and how to see more - never a 100% that reads as full.
 */

export interface ComponentProps {
  poolId: ObjectID;
  poolName: string;
  poolIdentifier: string;
  externalId: string;
  row: XcpNgResource | null;
  virtualDisks: Array<XcpNgResource>;
  isLoadingVirtualDisks?: boolean | undefined;
  virtualDisksError?: string | undefined;
  onRefreshVirtualDisks?: (() => void) | undefined;
  attention: ResourcePartAttention;
  routes: XcpNgPartRoutes;
  now: Date;
  refreshToken?: number | undefined;
}

const XcpNgVmOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="xcp-ng-vm-not-reported"
      >
        {tx(
          "Xen Orchestra does not report this VM now. It may have been deleted, or the pool is not read: its Overview says which.",
        )}
      </p>
    );
  }

  const when: (date: Date) => ReturnType<typeof composedValue> = (
    date: Date,
  ): ReturnType<typeof composedValue> => {
    return composedValue((sentence: Translator): string => {
      return formatRelativeTime({
        date: date,
        now: props.now,
        language: sentence.language,
      });
    });
  };

  const isRunning: boolean = row.isUp === true;
  const isControlDomain: boolean = isXcpNgControlDomain(row);
  const cpu: number | null = toXcpNgNumber(row.latestCpuPercent);
  const vcpus: number | null = toXcpNgNumber(row.cpuCount);
  const memory: XcpNgVmMemory = getXcpNgVmMemory(row);
  const watts: number | null = toXcpNgNumber(row.powerWatts);
  const lastRunningAt: Date | null = toXcpNgDate(row.lastRunningAt);
  const uptime: string = isRunning
    ? formatXcpNgUptime(row.uptimeSeconds, translator)
    : "";
  const name: string = getXcpNgDisplayName(row, props.externalId);
  const status: ResourcePartStatus | null = getXcpNgVmStatus(row, props.now);

  // The Memory tile: in use while the guest tools say, else what it was given.
  const memoryTile: {
    value?: string | undefined;
    sublabel?: string | undefined;
  } =
    memory.inUseBytes !== null && memory.percent !== null
      ? {
          value: formatXcpNgPercent(memory.percent),
          sublabel:
            memory.givenBytes !== null
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatStorageBytes(
                    memory.inUseBytes,
                    translator.language,
                  ),
                  total: formatStorageBytes(
                    memory.givenBytes,
                    translator.language,
                  ),
                })
              : undefined,
        }
      : memory.givenBytes !== null
        ? {
            value: formatStorageBytes(memory.givenBytes, translator.language),
            sublabel: tx(
              "given; install the guest tools to see how much it uses",
            ),
          }
        : {};

  // The Uptime tile: how long it has run, or when it last did.
  const uptimeSublabel: string = isRunning
    ? tx("since it last started")
    : lastRunningAt
      ? translator.translateTemplate("last running {{time}}", {
          time: when(lastRunningAt),
        })
      : tx("not seen running");

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
  if (row.parentHostName && row.parentHostExternalId) {
    detailRows.push({
      key: "host",
      label: isRunning ? "Host" : "Last host",
      value: (
        <Link
          to={props.routes.getPartRoute("Host", row.parentHostExternalId)}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {row.parentHostName}
        </Link>
      ),
    });
  }
  if (status) {
    detailRows.push({
      key: "state",
      label: "State",
      value: status.values
        ? translator.translateTemplate(status.label, status.values)
        : tx(status.label),
      description: XCP_NG_METRIC_DESCRIPTIONS.vmStatus,
    });
  }
  if (isControlDomain) {
    detailRows.push({
      key: "control-domain",
      label: "Control domain",
      value: tx("Yes: its host's own (dom0)"),
    });
  }
  if (vcpus !== null && vcpus > 0) {
    detailRows.push({
      key: "vcpus",
      label: "vCPUs",
      value: translator.formatNumber(vcpus),
    });
  }
  if (memory.givenBytes !== null) {
    detailRows.push({
      key: "memory",
      label: "Memory given",
      value: formatStorageBytes(memory.givenBytes, translator.language),
    });
  }
  if (uptime) {
    detailRows.push({
      key: "uptime",
      label: "Uptime",
      value: uptime,
      description: XCP_NG_METRIC_DESCRIPTIONS.vmUptime,
    });
  }
  if (lastRunningAt) {
    detailRows.push({
      key: "last-running",
      label: "Last running",
      value: OneUptimeDate.getDateAsLocalFormattedString(lastRunningAt),
    });
  }
  if (watts !== null) {
    detailRows.push({
      key: "power",
      label: "Power (estimate)",
      value: formatXcpNgWatts(watts),
      description: XCP_NG_PAGE_DESCRIPTIONS.vmPower,
    });
  }
  const tags: Array<string> = parseXcpNgTags(row.tags);
  if (tags.length > 0) {
    detailRows.push({
      key: "tags",
      label: "Tags",
      value: tags.join(", "),
      description: XCP_NG_PAGE_DESCRIPTIONS.vmTags,
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
    <div data-testid="xcp-ng-vm-overview">
      <NeedsAttentionCard
        testId="xcp-ng-vm-attention"
        items={props.attention.items}
        current={props.attention.current}
        description={props.attention.description}
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3"
        data-testid="xcp-ng-vm-tiles"
      >
        <GoldenMetricTile
          title="CPU"
          icon={IconProp.CPUChip}
          iconColor="blue"
          value={isRunning ? formatXcpNgPercent(cpu) : undefined}
          sublabel={
            isRunning && cpu !== null && vcpus !== null && vcpus > 0
              ? translator.translatePlural(
                  { one: "of {{count}} vCPU", other: "of {{count}} vCPUs" },
                  vcpus,
                )
              : undefined
          }
          percent={isRunning ? cpu : null}
          thresholds={{ warn: 80, danger: 90 }}
          description={XCP_NG_METRIC_DESCRIPTIONS.vmCpu}
        />
        <GoldenMetricTile
          title="Memory"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={memoryTile.value}
          sublabel={memoryTile.sublabel}
          percent={memory.inUseBytes !== null ? memory.percent : null}
          thresholds={{ warn: 85, danger: 95 }}
          description={XCP_NG_METRIC_DESCRIPTIONS.vmMemory}
        />
        <GoldenMetricTile
          title="Uptime"
          icon={IconProp.Clock}
          iconColor="emerald"
          value={uptime || undefined}
          sublabel={uptimeSublabel}
          description={XCP_NG_METRIC_DESCRIPTIONS.vmUptime}
        />
      </div>

      <div className="mb-6">
        <XcpNgVirtualDisksCard
          testId="xcp-ng-vm-disks"
          of="VM"
          rows={props.virtualDisks}
          getPartRoute={props.routes.getPartRoute}
          isLoading={props.isLoadingVirtualDisks}
          error={props.virtualDisksError}
          onRefreshClick={props.onRefreshVirtualDisks}
        />
      </div>

      <ResourcePartOpenEventsCard
        testId="xcp-ng-vm-open"
        title="Open on this VM"
        description="Unresolved incidents and alerts about this VM, incidents first."
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

      {isControlDomain ? (
        <></>
      ) : (
        <ResourcePartAlertsCard
          testId="xcp-ng-vm-alerts"
          title="VM alerts"
          description="The pool's alerts that watch every VM, this one included: each is one monitor that fires for any VM that crosses it."
          resourceType={MonitorRecommendationResourceType.XcpNg}
          templateIds={XCP_NG_VM_ALERT_TEMPLATE_IDS}
          resourceId={props.poolId}
          resourceIdentifier={props.poolIdentifier}
          getRecommendationsRoute={props.routes.getRecommendationsRoute}
          getMonitorRoute={props.routes.getMonitorRoute}
          refreshToken={props.refreshToken}
        />
      )}

      <ResourcePartDetailsCard
        testId="xcp-ng-vm-details"
        description="What Xen Orchestra reports about this VM."
        rows={detailRows}
      />
    </div>
  );
};

export default XcpNgVmOverview;
