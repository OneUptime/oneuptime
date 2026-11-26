import React, { FunctionComponent, ReactElement } from "react";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OneUptimeDate from "Common/Types/Date";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import Link from "Common/UI/Components/Link/Link";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageUsage,
  formatStorageBytes,
} from "Common/Utils/Storage/StorageUsage";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import ResourceStorageCard from "../../ResourcePart/ResourceStorageCard";
import { ResourcePartAttention } from "../../ResourcePart/ResourcePartTypes";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../../MetricDescriptions/XcpNgMetricDescriptions";
import { XCP_NG_PAGE_DESCRIPTIONS } from "../XcpNgPageDescriptions";
import XcpNgVirtualDisksCard from "../XcpNgVirtualDisksCard";
import {
  getXcpNgAllocationPercent,
  getXcpNgStorageUsage,
  isXcpNgIssueAbout,
  isXcpNgStorageOverAllocated,
} from "../../../Pages/XcpNg/Utils/XcpNgHealth";
import {
  XCP_NG_STORAGE_ALERT_TEMPLATE_IDS,
  getXcpNgContentTypeWord,
  getXcpNgStorageTypeLabel,
} from "../../../Pages/XcpNg/Utils/XcpNgPartFacts";
import {
  formatXcpNgPercent,
  getXcpNgDisplayName,
  toXcpNgDate,
  toXcpNgNumber,
} from "../../../Pages/XcpNg/Utils/XcpNgResourceUtils";
import { XcpNgPartRoutes } from "./XcpNgPartRoutes";

/*
 * An XCP-ng storage repository's Overview: whether it needs attention, how
 * full it is (the shared storage bar, at the pool's lines), how much is
 * allocated on it against its size - thin provisioning can fill it as its
 * disks grow - the virtual disks it holds and whose they are, what is open
 * on it, whether anyone will hear when it fills or slows, and what Xen
 * Orchestra reports about it.
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
  refreshToken?: number | undefined;
}

const XcpNgStorageOverview: FunctionComponent<ComponentProps> = (
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
        data-testid="xcp-ng-sr-not-reported"
      >
        {tx(
          "Xen Orchestra does not report this storage repository now. It may have been removed from the pool, or the pool is not read: its Overview says which.",
        )}
      </p>
    );
  }

  const usage: StorageUsage | null = getXcpNgStorageUsage(row);
  const size: number | null = toXcpNgNumber(row.maxDiskBytes);
  const used: number | null = toXcpNgNumber(row.latestDiskBytes);
  const allocated: number | null = toXcpNgNumber(row.virtualAllocationBytes);
  const allocationPercent: number | null = getXcpNgAllocationPercent(row);
  const isOverAllocated: boolean = isXcpNgStorageOverAllocated(row);
  const attachedVms: number = new Set(
    props.virtualDisks
      .map((disk: XcpNgResource): string => {
        return disk.vmExternalId || "";
      })
      .filter(Boolean),
  ).size;
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
  if (row.isShared === true) {
    detailRows.push({
      key: "shared",
      label: "Host",
      value: tx("Shared by every host of the pool"),
      description: XCP_NG_METRIC_DESCRIPTIONS.storageRepositoryShared,
    });
  } else if (row.parentHostName && row.parentHostExternalId) {
    detailRows.push({
      key: "host",
      label: "Host",
      value: (
        <Link
          to={props.routes.getPartRoute("Host", row.parentHostExternalId)}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          {row.parentHostName}
        </Link>
      ),
      description: XCP_NG_METRIC_DESCRIPTIONS.storageRepositoryShared,
    });
  }
  if (row.srType) {
    detailRows.push({
      key: "type",
      label: "Type",
      // A storage technology's name, the same in every language.
      value: getXcpNgStorageTypeLabel(row.srType),
      description: XCP_NG_PAGE_DESCRIPTIONS.storageType,
    });
  }
  if (row.contentType) {
    detailRows.push({
      key: "content",
      label: "Content",
      value: tx(getXcpNgContentTypeWord(row.contentType)),
      description: XCP_NG_PAGE_DESCRIPTIONS.storageContent,
    });
  }
  if (size !== null && size > 0) {
    detailRows.push({
      key: "size",
      label: "Size",
      value: formatStorageBytes(size, translator.language),
    });
  }
  if (used !== null) {
    detailRows.push({
      key: "used",
      label: "Used",
      value: formatStorageBytes(used, translator.language),
      description: XCP_NG_METRIC_DESCRIPTIONS.storageRepositoryUsed,
    });
  }
  if (allocated !== null) {
    detailRows.push({
      key: "allocated",
      label: "Allocated",
      value: formatStorageBytes(allocated, translator.language),
      description: XCP_NG_METRIC_DESCRIPTIONS.storageRepositoryAllocated,
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
    <div data-testid="xcp-ng-sr-overview">
      <NeedsAttentionCard
        testId="xcp-ng-sr-attention"
        items={props.attention.items}
        current={props.attention.current}
        description={props.attention.description}
      />

      <div className="mb-6" data-testid="xcp-ng-sr-usage">
        <ResourceStorageCard
          testId="xcp-ng-sr-usage-bar"
          usage={usage}
          description="How full this storage repository is: the space used on it, what is left and its size, as XAPI reports them."
          noUsageText="This storage repository reports no size to fill."
          measuredAt={toXcpNgDate(row.metricsUpdatedAt) || undefined}
        />
      </div>

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
        data-testid="xcp-ng-sr-tiles"
      >
        <GoldenMetricTile
          title="Allocated"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={
            allocationPercent !== null
              ? formatXcpNgPercent(allocationPercent, 0)
              : undefined
          }
          sublabel={
            allocated !== null && size !== null && size > 0
              ? isOverAllocated
                ? translator.translateTemplate(
                    "{{allocated}} of {{size}}: over-provisioned",
                    {
                      allocated: formatStorageBytes(
                        allocated,
                        translator.language,
                      ),
                      size: formatStorageBytes(size, translator.language),
                    },
                  )
                : translator.translateTemplate(
                    "{{allocated}} of {{size}} allocated",
                    {
                      allocated: formatStorageBytes(
                        allocated,
                        translator.language,
                      ),
                      size: formatStorageBytes(size, translator.language),
                    },
                  )
              : undefined
          }
          percent={
            allocationPercent !== null ? Math.min(allocationPercent, 100) : null
          }
          tone={
            allocationPercent === null
              ? undefined
              : isOverAllocated
                ? "warning"
                : "positive"
          }
          description={XCP_NG_METRIC_DESCRIPTIONS.storageRepositoryAllocated}
        />
        <GoldenMetricTile
          title="Virtual Disks"
          icon={IconProp.Disc}
          iconColor="sky"
          value={translator.formatNumber(props.virtualDisks.length)}
          sublabel={translator.translatePlural(
            {
              one: "attached to {{count}} VM",
              other: "attached to {{count}} VMs",
            },
            attachedVms,
          )}
          description={XCP_NG_PAGE_DESCRIPTIONS.storageVirtualDisks}
        />
      </div>

      <div className="mb-6">
        <XcpNgVirtualDisksCard
          testId="xcp-ng-sr-disks"
          of="StorageRepository"
          rows={props.virtualDisks}
          getPartRoute={props.routes.getPartRoute}
          isLoading={props.isLoadingVirtualDisks}
          error={props.virtualDisksError}
          onRefreshClick={props.onRefreshVirtualDisks}
        />
      </div>

      <ResourcePartOpenEventsCard
        testId="xcp-ng-sr-open"
        title="Open on this storage repository"
        description="Unresolved incidents and alerts about this storage repository, incidents first."
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

      <ResourcePartAlertsCard
        testId="xcp-ng-sr-alerts"
        title="Storage repository alerts"
        description="The pool's alerts that watch every storage repository, this one included: each is one monitor that fires for any repository that crosses it."
        resourceType={MonitorRecommendationResourceType.XcpNg}
        templateIds={XCP_NG_STORAGE_ALERT_TEMPLATE_IDS}
        resourceId={props.poolId}
        resourceIdentifier={props.poolIdentifier}
        getRecommendationsRoute={props.routes.getRecommendationsRoute}
        getMonitorRoute={props.routes.getMonitorRoute}
        refreshToken={props.refreshToken}
      />

      <ResourcePartDetailsCard
        testId="xcp-ng-sr-details"
        description="What Xen Orchestra reports about this storage repository."
        rows={detailRows}
      />
    </div>
  );
};

export default XcpNgStorageOverview;
