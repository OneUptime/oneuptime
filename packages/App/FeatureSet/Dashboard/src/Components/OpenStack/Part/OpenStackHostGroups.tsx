import Route from "Common/Types/API/Route";
import Includes from "Common/Types/BaseDatabase/Includes";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import { OpenStackMaintenancePartKind } from "Common/Types/OpenStack/OpenStackMaintenancePart";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import { percentOf } from "Common/Types/OpenStack/OpenStackHealthRules";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useMemo } from "react";
import OpenStackPlannedWorkCard from "./OpenStackPlannedWorkCard";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../OpenStackRegionContext";
import {
  fetchOpenStackApiStates,
  fetchOpenStackAttentionRows,
} from "../../../Pages/OpenStack/Utils/OpenStackPartData";
import {
  OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS,
  OPENSTACK_SERVICE_OF_KIND,
  OpenStackApiState,
  OpenStackEmptyWords,
  OpenStackHostGroup,
  OpenStackHostGroupKind,
  getOpenStackEmptyWords,
  getOpenStackHostGroups,
  isOpenStackIssueAboutHosts,
} from "../../../Pages/OpenStack/Utils/OpenStackPartFacts";
import GoldenMetricTile from "../../Infrastructure/GoldenMetricTile";
import ResourceTable, {
  InfrastructureResource,
  ResourceColumn,
  ResourceStatusTone,
} from "../../Infrastructure/ResourceTable";
import NeedsAttentionCard from "../../ResourcePart/NeedsAttentionCard";
import {
  ResourceAttentionItem,
  ResourceAttentionText,
  ResourceHealth,
} from "../../ResourcePart/ResourceAttention";
import ResourcePartAlertsCard from "../../ResourcePart/ResourcePartAlertsCard";
import ResourcePartDetailsCard from "../../ResourcePart/ResourcePartDetailsCard";
import ResourcePartHero from "../../ResourcePart/ResourcePartHero";
import ResourcePartOpenEventsCard from "../../ResourcePart/ResourcePartOpenEventsCard";
import ResourcePartReadError from "../../ResourcePart/ResourcePartReadError";
import { OpenIssueRecord } from "../../ResourceTopology/ResourceTopologyIssues";
import { MonitorRecommendationResourceType } from "Common/Types/Monitor/Recommendation/MonitorRecommendationTypes";
import {
  OpenStackHypervisorList,
  OpenStackInstanceList,
} from "../OpenStackLists";
import {
  formatOpenStackBytes,
  formatOpenStackCount,
  formatOpenStackPercent,
} from "../OpenStackResourceList";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
  openStackIdFromRouteParam,
} from "./OpenStackPartRoutes";
import useIsOpenStackProbeCollected from "./UseIsOpenStackProbeCollected";
import useOpenStackRead, { OpenStackRead } from "./UseOpenStackRead";
import { joinList } from "Common/UI/Utils/ListSeparator";

/*
 * Availability zones and aggregates: hypervisors, what they can give, and how they are
 * doing, per zone and per aggregate. Neither has a row of its own, because a zone and an
 * aggregate are what hypervisors say about themselves, so a zone's page is its hypervisors
 * added up through the same rules every list reads.
 *
 * Nova's "internal" zone is where its own control services sit and no instance can go, so
 * it is never one anyone counts. Capacity counts only what can take instances: a host Nova
 * lost, or someone disabled, is not room.
 */

interface HostGroupWords {
  title: string;
  description: string;
  singularName: string;
  emptyMessage: string;
  notFound: string;
  groupLocation: string;
  thisGroup: string;
  hypervisorsTitle: string;
  instancesTitle: string;
  detailsDescription: string;
  readErrorTitle: string;
}

const WORDS: Record<OpenStackHostGroupKind, HostGroupWords> = {
  zone: {
    title: translationKey("Availability Zones"),
    description: translationKey(
      "Each availability zone's hypervisors, what they can give, and how they are doing. Allocated is what is promised, not how busy a host is.",
    ),
    singularName: translationKey("zone"),
    emptyMessage: translationKey(
      "No availability zones reported yet. Hypervisors say which zone they are in, and none has reported one.",
    ),
    notFound: translationKey(
      "This zone is not in this cloud's inventory. No hypervisor says it is in it.",
    ),
    groupLocation: translationKey(
      "Zone of region {{region}} of cloud {{cloud}}",
    ),
    thisGroup: translationKey("This zone"),
    hypervisorsTitle: translationKey("Hypervisors in this zone"),
    instancesTitle: translationKey("Instances in this zone"),
    detailsDescription: translationKey(
      "What this zone's hypervisors say about it. Nova's own internal zone is left out, because no instance can go there.",
    ),
    readErrorTitle: translationKey("Couldn't load this cloud's zones"),
  },
  aggregate: {
    title: translationKey("Aggregates"),
    description: translationKey(
      "Each host aggregate's hypervisors, what they can give, and how they are doing. Allocated is what is promised, not how busy a host is.",
    ),
    singularName: translationKey("aggregate"),
    emptyMessage: translationKey(
      "No host aggregates reported. Hypervisors say which aggregates they are in, and none here is, which is usual for a cloud that doesn't split its hosts.",
    ),
    notFound: translationKey(
      "This aggregate is not in this cloud's inventory. No hypervisor says it is in it.",
    ),
    groupLocation: translationKey(
      "Aggregate of region {{region}} of cloud {{cloud}}",
    ),
    thisGroup: translationKey("This aggregate"),
    hypervisorsTitle: translationKey("Hypervisors in this aggregate"),
    instancesTitle: translationKey("Instances in this aggregate"),
    detailsDescription: translationKey(
      "What this aggregate's hypervisors say about it.",
    ),
    readErrorTitle: translationKey("Couldn't load this cloud's aggregates"),
  },
};

const HEALTH_TONES: Record<ResourceHealth, ResourceStatusTone> = {
  Healthy: "positive",
  Degraded: "warning",
  Unhealthy: "danger",
};

function getCloudIdFromAddress(depth: number): ObjectID {
  return Navigation.getLastParamAsObjectID(depth);
}

function amountText(
  taken: number,
  capacity: number,
  format: (value: number) => string,
  translator: Translator,
): string {
  const percent: number | null = percentOf(taken, capacity);
  if (percent === null) {
    return translator.translateText("Not reported") || "Not reported";
  }
  /*
   * The share first and short: a list of zones has little room, and the page has the rest.
   * Only ever drawn (a cell, a tile), so each value is set apart: "۱٫۰ TiB" keeps its number
   * before its unit in a Persian sentence, both in the reader's digits (issue #7191).
   */
  return translator.translateTemplate(
    "{{percent}} of {{total}}",
    {
      total: format(capacity),
      percent: formatOpenStackPercent(percent, {
        language: translator.language,
      }),
    },
    { setsValuesApart: true },
  );
}

function hypervisorsText(
  group: OpenStackHostGroup,
  translator: Translator,
): string {
  const parts: Array<string> = [
    translator.translatePlural(
      { one: "{{count}} up", other: "{{count}} up" },
      group.up,
    ),
  ];
  if (group.lost > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} lost", other: "{{count}} lost" },
        group.lost,
      ),
    );
  }
  if (group.disabled > 0) {
    parts.push(
      translator.translatePlural(
        { one: "{{count}} disabled", other: "{{count}} disabled" },
        group.disabled,
      ),
    );
  }
  return joinList(parts);
}

function toResource(
  group: OpenStackHostGroup,
  translator: Translator,
): InfrastructureResource {
  return {
    name: group.name,
    namespace: "",
    cpuUtilization: null,
    memoryUsageBytes: null,
    memoryLimitBytes: null,
    status: group.health,
    statusTone: HEALTH_TONES[group.health],
    statusText: { text: group.health },
    statusReasons: group.attention
      .slice(0, 2)
      .flatMap((item: ResourceAttentionItem) => {
        return item.reasons.map((reason: ResourceAttentionText) => {
          return {
            text: "{{name}}: {{reason}}",
            values: {
              name: item.name,
              reason: translator.translateTemplate(
                reason.text,
                reason.values || {},
              ),
            },
          };
        });
      }),
    age: "",
    additionalAttributes: { id: group.id },
  };
}

export const OpenStackHostGroupList: FunctionComponent<{
  kind: OpenStackHostGroupKind;
}> = (props: { kind: OpenStackHostGroupKind }): ReactElement => {
  const translator: Translator = useTranslator();
  const openStackCloudId: ObjectID = getCloudIdFromAddress(1);
  const isProbeCollected: boolean =
    useIsOpenStackProbeCollected(openStackCloudId);
  const words: HostGroupWords = WORDS[props.kind];

  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(openStackCloudId);
  }, [openStackCloudId.toString()]);

  const { region }: OpenStackRegionState = useOpenStackRegion();

  const read: OpenStackRead<{
    groups: Array<OpenStackHostGroup>;
    hasHypervisors: boolean;
  }> = useOpenStackRead(async () => {
    const rows: Array<OpenStackResource> = await fetchOpenStackAttentionRows(
      openStackCloudId,
      region,
    );
    return {
      groups: getOpenStackHostGroups({
        rows,
        kind: props.kind,
        now: OneUptimeDate.getCurrentDate(),
        routeFor: routes.routeFor,
      }),
      hasHypervisors: rows.some((row: OpenStackResource): boolean => {
        return row.kind === OpenStackResourceKind.Hypervisor;
      }),
    };
  }, [openStackCloudId.toString(), props.kind, region]);

  const api: OpenStackRead<Record<string, OpenStackApiState>> =
    useOpenStackRead<Record<string, OpenStackApiState>>(() => {
      return fetchOpenStackApiStates(openStackCloudId);
    }, [openStackCloudId.toString()]);

  const groups: Array<OpenStackHostGroup> = read.data?.groups || [];

  const groupById: Map<string, OpenStackHostGroup> = new Map(
    groups.map((group: OpenStackHostGroup): [string, OpenStackHostGroup] => {
      return [group.id, group];
    }),
  );

  const of: (resource: InfrastructureResource) => OpenStackHostGroup = (
    resource: InfrastructureResource,
  ): OpenStackHostGroup => {
    return groupById.get(
      resource.additionalAttributes["id"] || "",
    ) as OpenStackHostGroup;
  };

  const columns: Array<ResourceColumn> = [
    {
      title: "Hypervisors",
      key: "hypervisors",
      getValue: (resource: InfrastructureResource): string => {
        return hypervisorsText(of(resource), translator);
      },
      getTone: (resource: InfrastructureResource) => {
        return of(resource).lost > 0 ? "danger" : undefined;
      },
    },
    {
      title: "vCPUs Allocated",
      key: "vcpus",
      description:
        "vCPUs promised to instances, out of what its hypervisors that can take instances will promise. This is what is promised, not how busy they are.",
      getValue: (resource: InfrastructureResource): string => {
        const group: OpenStackHostGroup = of(resource);
        return amountText(
          group.vcpuAllocated,
          group.vcpuCapacity,
          formatOpenStackCount,
          translator,
        );
      },
    },
    {
      title: "Memory Allocated",
      key: "memory",
      description:
        "Memory promised to instances, out of what its hypervisors that can take instances will promise. This is what is promised, not what is in use.",
      getValue: (resource: InfrastructureResource): string => {
        const group: OpenStackHostGroup = of(resource);
        return amountText(
          group.memoryAllocatedBytes,
          group.memoryCapacityBytes,
          formatOpenStackBytes,
          translator,
        );
      },
    },
    {
      title: "Instances",
      key: "instances",
      getValue: (resource: InfrastructureResource): string => {
        return translator.formatNumber(of(resource).instanceCount);
      },
    },
    {
      title: "Region",
      key: "region",
      getValue: (resource: InfrastructureResource): string => {
        return of(resource).regionName;
      },
    },
  ];

  const service: string | undefined =
    OPENSTACK_SERVICE_OF_KIND[OpenStackResourceKind.Hypervisor];
  // No groups beside hypervisors is a cloud that doesn't split them, not a credential's limit.
  const emptyWords: OpenStackEmptyWords | null = read.data?.hasHypervisors
    ? null
    : getOpenStackEmptyWords({
        kind: OpenStackResourceKind.Hypervisor,
        api: (service && api.data?.[service]) || "not-reported",
        isProbeCollected: isProbeCollected,
      });

  return (
    <div data-testid={`openstack-${props.kind}-list`}>
      <ResourceTable
        title={words.title}
        description={words.description}
        resources={groups.map((group: OpenStackHostGroup) => {
          return toResource(group, translator);
        })}
        columns={columns}
        showGroupColumn={false}
        showResourceMetrics={false}
        showAge={false}
        isLoading={read.isLoading}
        error={read.error}
        onRefreshClick={read.reload}
        tableIdPrefix={`openstack-${props.kind}`}
        emptyMessage={
          emptyWords
            ? `${emptyWords.title}. ${emptyWords.description}`
            : words.emptyMessage
        }
        getViewRoute={(resource: InfrastructureResource): Route => {
          const id: string = resource.additionalAttributes["id"] || "";
          return props.kind === "zone"
            ? routes.getZoneRoute(id)
            : routes.getAggregateRoute(id);
        }}
      />
    </div>
  );
};

export const OpenStackHostGroupPage: FunctionComponent<{
  kind: OpenStackHostGroupKind;
}> = (props: { kind: OpenStackHostGroupKind }): ReactElement => {
  const translator: Translator = useTranslator();
  const openStackCloudId: ObjectID = getCloudIdFromAddress(2);
  const groupId: string = openStackIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );
  const words: HostGroupWords = WORDS[props.kind];

  const routes: OpenStackPartRoutes = useMemo(() => {
    return getOpenStackPartRoutes(openStackCloudId);
  }, [openStackCloudId.toString()]);

  const read: OpenStackRead<{
    cloudName: string;
    group: OpenStackHostGroup | null;
  }> = useOpenStackRead(async () => {
    const [cloud, rows]: [OpenStackCloud | null, Array<OpenStackResource>] =
      await Promise.all([
        ModelAPI.getItem<OpenStackCloud>({
          modelType: OpenStackCloud,
          id: openStackCloudId,
          select: { name: true },
        }),
        fetchOpenStackAttentionRows(openStackCloudId),
      ]);
    return {
      cloudName: cloud?.name || "",
      group:
        getOpenStackHostGroups({
          rows,
          kind: props.kind,
          now: OneUptimeDate.getCurrentDate(),
          routeFor: routes.routeFor,
        }).find((candidate: OpenStackHostGroup): boolean => {
          return candidate.id === groupId;
        }) || null,
    };
  }, [openStackCloudId.toString(), groupId, props.kind]);

  if (read.isLoading && !read.data) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error && !read.data) {
    return (
      <ResourcePartReadError
        testId="openstack-part-read-error"
        title={words.readErrorTitle}
        message={read.error}
        onRetry={read.reload}
      />
    );
  }

  const group: OpenStackHostGroup | null = read.data?.group || null;
  const cloudName: string = read.data?.cloudName || "";

  if (!group) {
    return (
      <p
        className="rounded-xl border border-gray-200 bg-white p-5 text-sm text-gray-500 shadow-sm"
        data-testid={`openstack-${props.kind}-not-reported`}
      >
        {translator.translateText(words.notFound) || words.notFound}
      </p>
    );
  }

  const hypervisorNames: Array<string> = group.hypervisors.map(
    (row: OpenStackResource): string => {
      return row.hypervisorName || "";
    },
  );

  // A zone is a column; an aggregate is only what its hypervisors hold, one fact each.
  const hypervisorQuery: Query<OpenStackResource> =
    props.kind === "zone"
      ? { availabilityZone: group.name, regionName: group.regionName }
      : {
          hypervisorName: new Includes(hypervisorNames),
          regionName: group.regionName,
        };
  const instanceQuery: Query<OpenStackResource> =
    props.kind === "zone"
      ? { availabilityZone: group.name, regionName: group.regionName }
      : {
          hypervisorName: new Includes(hypervisorNames),
          regionName: group.regionName,
        };

  const tabs: Array<Tab> = [
    {
      name: "Overview",
      children: (
        <div data-testid={`openstack-${props.kind}-overview`}>
          <NeedsAttentionCard
            testId={`openstack-${props.kind}-attention`}
            items={group.attention}
            description="What on these hypervisors is broken or needs a look, the most urgent first."
          />
          <div
            className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4"
            data-testid={`openstack-${props.kind}-tiles`}
          >
            <GoldenMetricTile
              title="Hypervisors"
              icon={IconProp.ServerStack}
              iconColor="sky"
              value={translator.formatNumber(group.total)}
              sublabel={hypervisorsText(group, translator)}
              description="How many hypervisors say they are here, and how many of them Nova can reach. A host Nova lost isn't counted in what can be given."
            />
            <GoldenMetricTile
              title="vCPUs allocated"
              icon={IconProp.ChartBar}
              iconColor="blue"
              value={amountText(
                group.vcpuAllocated,
                group.vcpuCapacity,
                formatOpenStackCount,
                translator,
              )}
              percent={percentOf(group.vcpuAllocated, group.vcpuCapacity)}
              description="vCPUs promised to instances, out of what its hypervisors that can take instances will promise. This is what is promised, not how busy they are."
            />
            <GoldenMetricTile
              title="Memory allocated"
              icon={IconProp.SquareStack}
              iconColor="violet"
              value={amountText(
                group.memoryAllocatedBytes,
                group.memoryCapacityBytes,
                formatOpenStackBytes,
                translator,
              )}
              percent={percentOf(
                group.memoryAllocatedBytes,
                group.memoryCapacityBytes,
              )}
              description="Memory promised to instances, out of what its hypervisors that can take instances will promise. This is what is promised, not what is in use."
            />
            <GoldenMetricTile
              title="Instances"
              icon={IconProp.Cube}
              iconColor="sky"
              value={translator.formatNumber(group.instanceCount)}
              sublabel="running, as Nova says"
              description="How many instances Nova says its hypervisors run. On a host Nova lost this is the last it knew."
            />
          </div>
          <ResourcePartOpenEventsCard
            testId={`openstack-${props.kind}-open`}
            title="Open here"
            description="Unresolved incidents and alerts about these hypervisors, incidents first."
            resourceRelation="openStackClouds"
            resourceId={openStackCloudId}
            isAbout={(record: OpenIssueRecord): boolean => {
              return isOpenStackIssueAboutHosts(record, group.hypervisors);
            }}
            getIncidentRoute={routes.getIncidentRoute}
            getAlertRoute={routes.getAlertRoute}
            incidentsRoute={routes.incidentsRoute}
            alertsRoute={routes.alertsRoute}
          />
          <ResourcePartAlertsCard
            testId={`openstack-${props.kind}-alerts`}
            title="Hypervisor alerts"
            description="The cloud's alerts that watch every hypervisor, these included: each is one monitor that fires for any hypervisor that crosses it."
            resourceType={MonitorRecommendationResourceType.OpenStack}
            templateIds={OPENSTACK_HYPERVISOR_ALERT_TEMPLATE_IDS}
            resourceId={openStackCloudId}
            resourceIdentifier={cloudName}
            getRecommendationsRoute={routes.getRecommendationsRoute}
            getMonitorRoute={routes.getMonitorRoute}
          />
          {props.kind === "zone" ? (
            <div className="mb-6">
              <OpenStackPlannedWorkCard
                testId="openstack-zone-planned-work"
                openStackCloudId={openStackCloudId}
                kind={OpenStackMaintenancePartKind.AvailabilityZone}
                name={group.name}
                regionName={group.regionName || null}
              />
            </div>
          ) : (
            <></>
          )}
          <ResourcePartDetailsCard
            testId={`openstack-${props.kind}-details`}
            description={words.detailsDescription}
            rows={[
              {
                key: "name",
                label: "Name",
                value: group.name,
                copyText: group.name,
              },
              ...(group.regionName
                ? [
                    {
                      key: "region",
                      label: "Region",
                      value: group.regionName,
                    },
                  ]
                : []),
            ]}
          />
        </div>
      ),
    },
    {
      name: "Hypervisors",
      countBadge: group.total,
      children: (
        <OpenStackHypervisorList
          openStackCloudId={openStackCloudId}
          query={hypervisorQuery}
          tableId={`openstack-${props.kind}-hypervisors-table`}
          title={words.hypervisorsTitle}
        />
      ),
    },
    {
      name: "Instances",
      children: (
        <OpenStackInstanceList
          openStackCloudId={openStackCloudId}
          query={instanceQuery}
          tableId={`openstack-${props.kind}-instances-table`}
          title={words.instancesTitle}
          description="Every instance here, a page at a time."
          emptyTitle="No instances here"
          emptyDescription="Nova has placed nothing here."
        />
      ),
    },
  ];

  return (
    <div data-testid={`openstack-${props.kind}-page`}>
      <ResourcePartHero
        testId={`openstack-${props.kind}-hero`}
        icon={props.kind === "zone" ? IconProp.MapPin : IconProp.RectangleStack}
        accent="orange"
        name={group.name}
        status={{ label: group.health, tone: HEALTH_TONES[group.health] }}
        location={
          <TranslatedSentence
            template={words.groupLocation}
            slots={{
              region: <bdi>{group.regionName}</bdi>,
              cloud: (
                <Link
                  to={routes.cloudRoute}
                  className="font-medium text-gray-700 hover:text-indigo-600 hover:underline"
                >
                  {cloudName}
                </Link>
              ),
            }}
          />
        }
      />
      <Tabs tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};
