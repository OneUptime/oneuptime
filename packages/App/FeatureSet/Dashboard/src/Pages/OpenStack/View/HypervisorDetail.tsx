import PageComponentProps from "../../PageComponentProps";
import Host from "Common/Models/DatabaseModels/Host";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import {
  OPENSTACK_HYPERVISOR_ATTRIBUTE,
  OpenStackHypervisorMetric,
} from "Common/Types/OpenStack/OpenStackInstanceMetrics";
import {
  OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
  OpenStackResourceKind,
} from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import Link from "Common/UI/Components/Link/Link";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import GoldenMetricTile, {
  GoldenMetricTileProps,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import { OpenStackInstanceList } from "../../../Components/OpenStack/OpenStackLists";
import {
  formatOpenStackAmount,
  formatOpenStackBytes,
  formatOpenStackChartBytes,
  formatOpenStackCount,
  formatOpenStackPercent,
} from "../../../Components/OpenStack/OpenStackResourceList";
import OpenStackBlastRadiusCard from "../../../Components/OpenStack/Part/OpenStackBlastRadiusCard";
import OpenStackPlannedWorkCard from "../../../Components/OpenStack/Part/OpenStackPlannedWorkCard";
import { OpenStackMaintenancePartKind } from "Common/Types/OpenStack/OpenStackMaintenancePart";
import { isOpenStackAdminDisabled } from "Common/Types/OpenStack/OpenStackHealthRules";
import OpenStackHostThroughput from "../../../Components/OpenStack/Part/OpenStackHostThroughput";
import OpenStackHypervisorUsage from "../../../Components/OpenStack/Part/OpenStackHypervisorUsage";
import {
  OpenStackPartAlerts,
  OpenStackPartOpenEvents,
} from "../../../Components/OpenStack/Part/OpenStackPartActivity";
import { getOpenStackMetricQuery } from "../../../Components/OpenStack/Part/OpenStackMetricQueries";
import OpenStackPartNotice from "../../../Components/OpenStack/Part/OpenStackPartNotice";
import OpenStackPartPage from "../../../Components/OpenStack/Part/OpenStackPartPage";
import useOpenStackPart, {
  OpenStackPart,
} from "../../../Components/OpenStack/Part/UseOpenStackPart";
import useOpenStackRead, {
  OpenStackRead,
} from "../../../Components/OpenStack/Part/UseOpenStackRead";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import { ResourceAttentionItem } from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartDetailsCard, {
  ResourcePartDetailRow,
} from "../../../Components/ResourcePart/ResourcePartDetailsCard";
import { ResourcePartBadge } from "../../../Components/ResourcePart/ResourcePartTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import { getOpenStackAttentionItems } from "../Utils/OpenStackHealth";
import {
  OpenStackHostUsage,
  fetchOpenStackComputeServiceOf,
  fetchOpenStackHostOf,
  fetchOpenStackHostUsage,
  fetchOpenStackRows,
} from "../Utils/OpenStackPartData";
import {
  OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS,
  OpenStackAllocationKey,
  OpenStackAllocationLine,
  formatOpenStackAllocationRatio,
  getOpenStackAllocationLines,
  getOpenStackHostGroupId,
  getOpenStackTimeInState,
  isOpenStackHypervisorLost,
  parseOpenStackAggregates,
} from "../Utils/OpenStackPartFacts";
import { fetchOpenStackHypervisorReports } from "../Utils/OpenStackUsageReads";

/*
 * A compute host: whether Nova can reach it, what is promised on it out of what Placement
 * allows, how much of that is really in use when the Host product can say, what runs on it,
 * and whose those are.
 *
 * What is promised is not load, so nothing here says CPU beside an allocation. A host Nova
 * lost says so before anything else, because its numbers keep coming as the last it had,
 * and on their own would read as a host with room to spare.
 */

const LOST_NOTICE: string = translationKey(
  "Nova has lost this hypervisor: its nova-compute is down. Its numbers are last known and not current, so they are not room to place anything, and its instances may or may not still be running.",
);

const NOT_REPORTED: string = translationKey("Not reported");

function formatPercentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function formatLine(line: OpenStackAllocationLine, value: number): string {
  return line.key === "vcpu"
    ? formatOpenStackCount(value)
    : formatOpenStackBytes(value);
}

const HypervisorOverview: FunctionComponent<{
  part: OpenStackPart;
  row: OpenStackResource;
}> = (props: { part: OpenStackPart; row: OpenStackResource }): ReactElement => {
  const translator: Translator = useTranslator();
  const { part, row } = props;
  const hypervisorName: string = row.hypervisorName || row.name || "";
  const isLost: boolean = isOpenStackHypervisorLost(row);
  const now: Date = OneUptimeDate.getCurrentDate();

  /*
   * Its nova-compute, which is what says it is down, and the instances on it that may need
   * someone. Asked for by the words the rules read, so a host with thousands of instances
   * answers as quickly as one with none.
   */
  const around: OpenStackRead<Array<OpenStackResource>> = useOpenStackRead<
    Array<OpenStackResource>
  >(async () => {
    const [service, instances]: [
      OpenStackResource | null,
      Array<OpenStackResource>,
    ] = await Promise.all([
      fetchOpenStackComputeServiceOf({
        openStackCloudId: part.openStackCloudId,
        hypervisorName,
        regionName: row.regionName,
      }),
      fetchOpenStackRows({
        openStackCloudId: part.openStackCloudId,
        kind: OpenStackResourceKind.Instance,
        query: {
          hypervisorName: hypervisorName,
          ...(row.regionName ? { regionName: row.regionName } : {}),
          status: new Includes([
            "ERROR",
            ...OPENSTACK_INSTANCE_TRANSITIONAL_STATUSES,
          ]),
        },
        limit: 100,
      }),
    ]);
    return [...(service ? [service] : []), ...instances];
  }, [part.externalId, part.refreshToken]);

  const host: OpenStackRead<{
    host: Host;
    usage: OpenStackHostUsage;
  } | null> = useOpenStackRead(async () => {
    const found: Host | null = await fetchOpenStackHostOf({
      openStackCloudId: part.openStackCloudId,
      machineName: hypervisorName,
    });
    if (!found?.hostIdentifier) {
      return null;
    }
    return {
      host: found,
      usage: await fetchOpenStackHostUsage(found.hostIdentifier),
    };
  }, [part.openStackCloudId.toString(), hypervisorName]);

  const attention: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: [row, ...(around.data || [])],
    now,
    routeFor: part.routes.routeFor,
  });

  const lines: Array<OpenStackAllocationLine> =
    getOpenStackAllocationLines(row);

  /*
   * What a tile of what is allocated reads now. Always allocated, never CPU, because this
   * is what is promised and not load. Each tile's title and words are written out on the
   * tile itself, where the string extract reads them.
   */
  const getAllocationReading: (
    key: OpenStackAllocationKey,
  ) => Pick<
    GoldenMetricTileProps,
    "value" | "sublabel" | "percent" | "tone"
  > = (
    key: OpenStackAllocationKey,
  ): Pick<GoldenMetricTileProps, "value" | "sublabel" | "percent" | "tone"> => {
    const line: OpenStackAllocationLine = lines.find(
      (candidate: OpenStackAllocationLine): boolean => {
        return candidate.key === key;
      },
    ) as OpenStackAllocationLine;
    /*
     * Drawn in the page's direction with each value set apart: a Persian
     * tile reads "۴۸۰ GiB از ۱٫۰ TiB" from the right, each size with its
     * number before its unit (issue #7191).
     */
    const amount: string = formatOpenStackAmount({
      taken: line.taken,
      capacity: line.capacity,
      format: (value: number): string => {
        return formatLine(line, value);
      },
      setsValuesApart: true,
    });
    const ratio: string = formatOpenStackAllocationRatio(line.ratio);

    return {
      value:
        line.percent === null
          ? "—"
          : formatOpenStackPercent(line.percent, {
              language: translator.language,
            }),
      sublabel: !amount
        ? NOT_REPORTED
        : line.isLastKnown
          ? translator.translateTemplate(
              "{{amount}}, last known",
              { amount },
              { setsValuesApart: true },
            )
          : ratio
            ? translator.translateTemplate(
                "{{amount}}, ratio {{ratio}}",
                {
                  amount,
                  ratio,
                },
                { setsValuesApart: true },
              )
            : amount,
      // A last known number is not a gauge of what is left: no bar.
      percent: line.isLastKnown ? null : line.percent,
      tone: line.isLastKnown
        ? undefined
        : line.isOverLine
          ? "warning"
          : "positive",
    };
  };
  const zone: string = row.availabilityZone || "";
  const aggregates: Array<string> = parseOpenStackAggregates(row);

  const detailRows: Array<ResourcePartDetailRow> = [
    {
      key: "name",
      label: "Hypervisor",
      value: hypervisorName,
      copyText: hypervisorName,
    },
  ];
  if (row.regionName) {
    detailRows.push({
      key: "region",
      label: "Region",
      value: row.regionName,
    });
  }
  if (zone) {
    detailRows.push({
      key: "zone",
      label: "Availability Zone",
      value: (
        <Link
          to={part.routes.getZoneRoute(
            getOpenStackHostGroupId(row.regionName, zone),
          )}
          className="text-indigo-600 hover:text-indigo-700 hover:underline"
        >
          <bdi>{zone}</bdi>
        </Link>
      ),
    });
  }
  if (aggregates.length > 0) {
    detailRows.push({
      key: "aggregates",
      label: "Aggregates",
      value: (
        <span className="flex flex-wrap gap-x-2">
          {aggregates.map((aggregate: string): ReactElement => {
            return (
              <Link
                key={aggregate}
                to={part.routes.getAggregateRoute(
                  getOpenStackHostGroupId(row.regionName, aggregate),
                )}
                className="text-indigo-600 hover:text-indigo-700 hover:underline"
              >
                <bdi>{aggregate}</bdi>
              </Link>
            );
          })}
        </span>
      ),
    });
  }
  if (row.status) {
    detailRows.push({
      key: "nova-compute",
      label: "nova-compute",
      value: row.status,
      description:
        "Whether this host's nova-compute is up, in Nova's own word. The hypervisor's state is its nova-compute's.",
    });
  }
  if (row.adminState) {
    detailRows.push({
      key: "admin-state",
      label: "Admin State",
      value: row.adminState,
      description:
        "What an operator set. A disabled host takes no new instances, and that is planned work rather than a failure.",
    });
  }
  if (row.disabledReason) {
    detailRows.push({
      key: "disabled-reason",
      label: "Disabled because",
      value: row.disabledReason,
    });
  }
  const timeInState: string = getOpenStackTimeInState(row, now);
  if (timeInState) {
    detailRows.push({
      key: "in-state-for",
      label: "In state for",
      value: timeInState,
    });
  }
  detailRows.push({
    key: "id",
    label: "OpenStack ID",
    value: part.externalId,
    mono: true,
    copyText: part.externalId,
  });

  return (
    <div data-testid="openstack-hypervisor-overview">
      {isLost ? (
        <OpenStackPartNotice
          testId="openstack-hypervisor-lost"
          tone="warning"
          text={LOST_NOTICE}
        />
      ) : (
        <></>
      )}

      <NeedsAttentionCard
        testId="openstack-hypervisor-attention"
        items={attention}
        current={{
          key: `${OpenStackResourceKind.Hypervisor}/${part.externalId}`,
          label: translationKey("This hypervisor"),
        }}
        description="What on this hypervisor is broken or needs a look, the most urgent first."
        error={around.error}
        onRetry={around.reload}
      />

      <div
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
        data-testid="openstack-hypervisor-tiles"
      >
        <GoldenMetricTile
          title="vCPUs allocated"
          icon={IconProp.ChartBar}
          iconColor="blue"
          description="vCPUs Placement has promised to instances here, out of what it will promise: (total - reserved) x allocation ratio. This is what is promised, not how busy the host is."
          {...getAllocationReading("vcpu")}
        />
        <GoldenMetricTile
          title="Memory allocated"
          icon={IconProp.SquareStack}
          iconColor="violet"
          description="Memory Placement has promised to instances here, out of what it will promise: (total - reserved) x allocation ratio. An instance holds its flavor's memory whether it uses it or not."
          {...getAllocationReading("memory")}
        />
        <GoldenMetricTile
          title="Local disk allocated"
          icon={IconProp.Database}
          iconColor="amber"
          description="Local disk Placement has promised to instances here, out of what it will promise: (total - reserved) x allocation ratio. An instance holds its flavor's disk whether it fills it or not."
          {...getAllocationReading("disk")}
        />
        <GoldenMetricTile
          title="Instances"
          icon={IconProp.Cube}
          iconColor="sky"
          value={
            row.instanceCount === null || row.instanceCount === undefined
              ? "—"
              : translator.formatNumber(row.instanceCount)
          }
          sublabel={
            row.instanceCount === null || row.instanceCount === undefined
              ? NOT_REPORTED
              : isLost
                ? "last known"
                : "running"
          }
          description="How many instances Nova says this host runs."
        />
      </div>

      {host.data ? (
        <div
          className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2"
          data-testid="openstack-hypervisor-host-usage"
        >
          <GoldenMetricTile
            title="CPU in use"
            icon={IconProp.CPUChip}
            iconColor="blue"
            value={
              host.data.usage.cpuPercent === null
                ? "—"
                : `${Math.round(host.data.usage.cpuPercent)}%`
            }
            sublabel={
              host.data.usage.cpuPercent === null
                ? NOT_REPORTED
                : "from the host's own agent"
            }
            percent={host.data.usage.cpuPercent}
            description="What this machine's CPU is really doing, from OneUptime's agent on it. Not what Nova has promised."
          />
          <GoldenMetricTile
            title="Memory in use"
            icon={IconProp.SquareStack}
            iconColor="violet"
            value={
              host.data.usage.memoryPercent === null
                ? "—"
                : `${Math.round(host.data.usage.memoryPercent)}%`
            }
            sublabel={
              host.data.usage.memoryPercent === null
                ? NOT_REPORTED
                : "from the host's own agent"
            }
            percent={host.data.usage.memoryPercent}
            description="What this machine's memory is really doing, from OneUptime's agent on it. Not what Nova has promised."
          />
        </div>
      ) : (
        <></>
      )}

      {host.data?.host.hostIdentifier ? (
        <OpenStackHostThroughput
          hostIdentifier={host.data.host.hostIdentifier}
        />
      ) : (
        <></>
      )}

      {host.data ? (
        <div className="mb-6">
          <Card
            title="Linked Host"
            description="OneUptime's agent runs on this machine, so its real load is known."
          >
            <div className="text-sm">
              <Link
                to={
                  RouteUtil.populateRouteParams(
                    RouteMap[PageMap.HOST_VIEW] as Route,
                    { modelId: new ObjectID(host.data.host._id!.toString()) },
                  ) as Route
                }
                className="font-medium text-indigo-600 hover:text-indigo-700 hover:underline"
                dataTestId="openstack-hypervisor-host-link"
              >
                <bdi>
                  {host.data.host.name || host.data.host.hostIdentifier}
                </bdi>
              </Link>
            </div>
          </Card>
        </div>
      ) : (
        <></>
      )}

      <OpenStackHypervisorUsage
        part={part}
        row={row}
        hasHostAgent={Boolean(host.data)}
        hostCpuPercent={host.data?.usage.cpuPercent}
        hostMemoryPercent={host.data?.usage.memoryPercent}
      />

      <OpenStackPartOpenEvents
        testId="openstack-hypervisor-open"
        title="Open on this hypervisor"
        description="Unresolved incidents and alerts about this hypervisor, incidents first."
        part={part}
        row={row}
      />

      <OpenStackBlastRadiusCard
        testId="openstack-hypervisor-blast"
        openStackCloudId={part.openStackCloudId}
        kind={OpenStackResourceKind.Hypervisor}
        externalId={part.externalId}
        routes={part.routes}
        description="The instances on this hypervisor, and the projects they belong to. If it fails, these fail with it."
        refreshToken={part.refreshToken}
      />

      <div className="mb-6">
        <OpenStackPlannedWorkCard
          testId="openstack-hypervisor-planned-work"
          openStackCloudId={part.openStackCloudId}
          kind={OpenStackMaintenancePartKind.Hypervisor}
          name={hypervisorName}
          regionName={row.regionName || null}
          isDisabled={isOpenStackAdminDisabled(row.adminState)}
        />
      </div>

      <OpenStackPartAlerts
        testId="openstack-hypervisor-alerts"
        title="Hypervisor alerts"
        description="The cloud's alerts that watch every hypervisor, this one included: each is one monitor that fires for any hypervisor that crosses it."
        templateIds={OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS}
        part={part}
      />

      <ResourcePartDetailsCard
        testId="openstack-hypervisor-details"
        description="What Nova and Placement report about this hypervisor."
        rows={detailRows}
      />
    </div>
  );
};

/*
 * What is promised on it, and what is really used of it where something says so. A chart of what
 * nothing reports would only be an empty frame, so those wait until something does.
 */
const HypervisorMetrics: FunctionComponent<{
  part: OpenStackPart;
  hypervisorName: string;
}> = (props: { part: OpenStackPart; hypervisorName: string }): ReactElement => {
  const { part, hypervisorName } = props;
  const reports: OpenStackRead<boolean> = useOpenStackRead<boolean>(() => {
    return fetchOpenStackHypervisorReports({
      cloudName: part.cloudName,
      hypervisorName,
    });
  }, [part.cloudName, hypervisorName, part.refreshToken]);

  if (reports.isLoading && reports.data === null) {
    return <></>;
  }

  const hostnameOnly: Record<string, string> = {
    [OPENSTACK_HYPERVISOR_ATTRIBUTE]: hypervisorName,
  };

  return (
    <ResourceMetricsTab
      queryConfigs={[
        ...(reports.data
          ? [
              getOpenStackMetricQuery({
                part,
                variable: "hypervisor_cpu_used",
                title: "CPU used by instances",
                description:
                  "What its instances really use, against the CPU threads it has before any allocation ratio. The host's own processes aren't in this.",
                metricName: OpenStackHypervisorMetric.InstancesCpuUtilization,
                legend: "CPU used",
                attributes: hostnameOnly,
                format: formatPercentage,
              }),
              getOpenStackMetricQuery({
                part,
                variable: "hypervisor_memory_held",
                title: "Memory held by instances",
                description:
                  "What its instances really hold of its memory, whatever they have been promised, against what it has before any allocation ratio.",
                metricName:
                  OpenStackHypervisorMetric.InstancesMemoryUtilization,
                legend: "Memory held",
                attributes: hostnameOnly,
                format: formatPercentage,
              }),
            ]
          : []),
        getOpenStackMetricQuery({
          part,
          variable: "hypervisor_vcpus_allocated",
          title: "vCPUs allocated",
          description:
            "vCPUs Placement has promised on this hypervisor. This is what is promised, not how busy it is.",
          metricName: "openstack_placement_resource_usage",
          legend: "vCPUs allocated",
          attributes: {
            hostname: hypervisorName,
            resourcetype: "VCPU",
          },
        }),
        getOpenStackMetricQuery({
          part,
          variable: "hypervisor_memory_allocated",
          title: "Memory allocated",
          description:
            "Memory Placement has promised on this hypervisor. This is what is promised, not what is in use.",
          metricName: "openstack_placement_resource_usage",
          legend: "Memory allocated",
          attributes: {
            hostname: hypervisorName,
            resourcetype: "MEMORY_MB",
          },
          transformValue: (value: number): number => {
            return value * 1024 * 1024;
          },
          // A chart's axis and tooltip keep Latin digits, as every chart does.
          format: formatOpenStackChartBytes,
        }),
        getOpenStackMetricQuery({
          part,
          variable: "hypervisor_disk_allocated",
          title: "Local disk allocated",
          description:
            "Local disk Placement has promised on this hypervisor. This is what is promised, not what is in use.",
          metricName: "openstack_placement_resource_usage",
          legend: "Local disk allocated",
          attributes: {
            hostname: hypervisorName,
            resourcetype: "DISK_GB",
          },
          transformValue: (value: number): number => {
            return value * 1024 * 1024 * 1024;
          },
          format: formatOpenStackChartBytes,
        }),
        getOpenStackMetricQuery({
          part,
          variable: "hypervisor_running_instances",
          title: "Running instances",
          description: "How many instances Nova says this host runs.",
          metricName: "openstack_nova_running_vms",
          legend: "Instances",
          attributes: { hostname: hypervisorName },
        }),
      ]}
    />
  );
};

const OpenStackCloudHypervisorDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const part: OpenStackPart = useOpenStackPart(
    OpenStackResourceKind.Hypervisor,
  );
  const row: OpenStackResource | null = part.row;

  const badges: Array<ResourcePartBadge> = [];
  if (row && isOpenStackHypervisorLost(row)) {
    badges.push({ key: "last-known", label: "Last known", tone: "warning" });
  }

  const hypervisorName: string =
    row?.hypervisorName || row?.name || part.externalId;

  return (
    <OpenStackPartPage
      part={part}
      hero={{
        badges,
        location: row?.availabilityZone ? (
          <TranslatedSentence
            template="In zone {{zone}} of region {{region}} of cloud {{cloud}}"
            slots={{
              zone: (
                <Link
                  to={part.routes.getZoneRoute(
                    getOpenStackHostGroupId(
                      row.regionName,
                      row.availabilityZone,
                    ),
                  )}
                  className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  <bdi>{row.availabilityZone}</bdi>
                </Link>
              ),
              region: <bdi>{row.regionName || ""}</bdi>,
              cloud: (
                <Link
                  to={part.routes.cloudRoute}
                  className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  {part.cloudName}
                </Link>
              ),
            }}
          />
        ) : undefined,
      }}
      overview={(overviewRow: OpenStackResource): ReactElement => {
        return <HypervisorOverview part={part} row={overviewRow} />;
      }}
      tabs={(tabRow: OpenStackResource): Array<Tab> => {
        return [
          {
            name: "Instances",
            countBadge: tabRow.instanceCount ?? undefined,
            children: (
              <OpenStackInstanceList
                openStackCloudId={part.openStackCloudId}
                query={{
                  hypervisorName: tabRow.hypervisorName || "",
                  ...(tabRow.regionName
                    ? { regionName: tabRow.regionName }
                    : {}),
                }}
                tableId="openstack-hypervisor-instances-table"
                title="Instances on this hypervisor"
                description="Every instance Nova has placed here, a page at a time."
                emptyTitle="No instances on this hypervisor"
                emptyDescription="Nova has placed nothing here."
              />
            ),
          },
          {
            name: "Metrics",
            children: (
              <Card
                title={translator.translateTemplate(
                  "Hypervisor Metrics: {{hypervisor}}",
                  { hypervisor: hypervisorName },
                )}
                description="What its instances really use, what Placement has promised on it, and what Nova says it runs, over the selected time range."
              >
                <HypervisorMetrics
                  part={part}
                  hypervisorName={hypervisorName}
                />
              </Card>
            ),
          },
        ];
      }}
    />
  );
};

export default OpenStackCloudHypervisorDetail;
