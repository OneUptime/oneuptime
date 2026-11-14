import PageComponentProps from "../../PageComponentProps";
import ResourceAiAgentStatusSummaryCard from "../../../Components/ResourceAiAgent/ResourceAiAgentStatusSummaryCard";
import { getResourceAiAgentDescriptor } from "../../../Components/ResourceAiAgent/ResourceAiAgentDescriptors";
import AiResourceType from "Common/Types/ResourceAiAgent/AiResourceType";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "Common/Models/DatabaseModels/OpenStackResource";
import Route from "Common/Types/API/Route";
import OneUptimeDate from "Common/Types/Date";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import { SecurityConnectionKind } from "Common/Types/SecurityCase/SecurityConnection";
import { OpenStackBlastRadius } from "Common/Types/OpenStack/OpenStackBlastRadius";
import { isOpenStackServiceDown } from "Common/Types/OpenStack/OpenStackHealthRules";
import {
  OpenStackRegionSummary,
  OpenStackRowsLeftOut,
  OpenStackTopConsumers,
} from "Common/Types/OpenStack/OpenStackOverview";
import { OpenStackResourceKind } from "Common/Types/OpenStack/OpenStackResourceKind";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import Navigation from "Common/UI/Utils/Navigation";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  MutableRefObject,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import GoldenMetricTile, {
  GoldenMetricTileTone,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import { OPENSTACK_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/OpenStackMetricDescriptions";
import OpenStackDocumentationCard from "../../../Components/OpenStack/DocumentationCard";
import OpenStackAccessNotice from "../../../Components/OpenStack/OpenStackAccessNotice";
import OpenStackCollectionStatusCard from "../../../Components/OpenStack/OpenStackCollectionStatusCard";
import OpenStackControlPlaneCard from "../../../Components/OpenStack/OpenStackControlPlaneCard";
import { isOpenStackProbeCollected } from "../../../Components/OpenStack/OpenStackProbeCollectionView";
import {
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import OpenStackRegionsCard from "../../../Components/OpenStack/OpenStackRegionsCard";
import OpenStackServicesCard from "../../../Components/OpenStack/OpenStackServicesCard";
import OpenStackTopConsumersCard from "../../../Components/OpenStack/OpenStackTopConsumersCard";
import ResourceSecurityCard from "../../../Components/SecurityConnections/ResourceSecurityCard";
import {
  OpenStackPartRoutes,
  getOpenStackPartRoutes,
} from "../../../Components/OpenStack/Part/OpenStackPartRoutes";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import { getOpenStackCloudConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import { isResourceStatusConnected } from "../../../Components/ResourceConnection/ResourceConnectionState";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import {
  ResourceAttentionItem,
  ResourceHealth,
} from "../../../Components/ResourcePart/ResourceAttention";
import ResourcePartReadError from "../../../Components/ResourcePart/ResourcePartReadError";
import { getConfiguredOneUptimeUrl } from "../../../Components/SetupGuide/ConfiguredOneUptimeUrl";
import {
  getResourceConnectionLabel,
  getResourceHealthLabel,
} from "../../../Components/TelemetryResource/ResourceHeroStatus";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import {
  getOpenStackAttentionItems,
  getOpenStackHealth,
} from "../Utils/OpenStackHealth";
import {
  OpenStackAttentionAnswer,
  fetchOpenStackAttention,
  fetchOpenStackRegionSummaries,
  fetchOpenStackTopConsumers,
  mergeOpenStackAttention,
} from "../Utils/OpenStackOverviewReads";
import {
  fetchOpenStackBlastRadius,
  fetchOpenStackRows,
} from "../Utils/OpenStackPartData";
import { formatOpenStackBytes } from "../Utils/OpenStackFigures";
import { getOpenStackRegionRoute } from "../Utils/OpenStackRegion";
import {
  OpenStackInventorySummary,
  fetchOpenStackInventorySummary,
  getOpenStackPercent,
  isOpenStackInventoryEmpty,
} from "../Utils/OpenStackResourceUtils";
import {
  OpenStackAccessGap,
  OpenStackHypervisorCounts,
  OpenStackServiceGroup,
  OpenStackWorkerCounts,
  getOpenStackAccessGaps,
  getOpenStackRowsAsThisCredentialReadsThem,
  getOpenStackAttentionName,
  getOpenStackFullestPoolPercent,
  getOpenStackHypervisorCounts,
  getOpenStackPoolTone,
  getOpenStackServiceGroups,
  getOpenStackWorkerCounts,
  hasOpenStackHostPastAllocationLine,
  isOpenStackRowInRegion,
} from "../Utils/OpenStackServices";

/*
 * A cloud's Overview: before any chart, whether it is healthy and what needs someone
 * first, by name, most urgent first, one step from the part's page.
 *
 * Everything that judges anything here reads OpenStackHealth, whose lines are the alert
 * templates', so this page and an alert can't disagree about what is full. Three rules
 * this page keeps on top of that:
 *
 *  - It says nothing stale. A cloud whose agent has stopped has no current state: it asks
 *    for no attention rows at all, its health is unknown, and its tiles show nothing. What
 *    it last reported stays in the chips, marked as such.
 *  - It never reads what it could not read as nothing wrong. Each read says so in its own
 *    frame, with Try again, and the others carry on. A credential that can't list
 *    hypervisors reads as that, never as "0 hypervisors" or as Healthy.
 *  - Allocation is not usage. Nova and Placement report what is promised, so nothing here
 *    says CPU or memory in use, and a host Nova lost is never read as room to spare.
 *
 * A multi-region cloud reads one region or all of them, and the choice is in the address
 * (OpenStackRegionContext). Each region gets its own answer of what needs attention, so a
 * region's list is whole however much is wrong elsewhere, and each region's health on the
 * Regions card is its own.
 */

interface CountChip {
  key: string;
  icon: IconProp;
  label: string;
  // A list to open. Regions and availability zones have no list of their own.
  page?: PageMap | undefined;
  isDanger?: boolean | undefined;
}

const CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs font-medium text-gray-700";
const LINK_CHIP_CLASS_NAME: string = `${CHIP_CLASS_NAME} hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500`;
const DANGER_CHIP_CLASS_NAME: string =
  "inline-flex items-center gap-1.5 rounded-md border border-red-200 bg-red-50 px-2 py-1 text-xs font-medium text-red-700 hover:border-red-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500";

// A connected agent's data refreshes every couple of minutes, so a tab left open does too.
const REFRESH_EVERY_MS: number = 60 * 1000;

// How many lost hosts' blast radii one read of the page asks for.
const BLAST_RADIUS_READS: number = 10;

const NOT_REPORTED: string = translationKey("Not reported yet");
const NOT_CURRENT: string = translationKey("Nothing current");
const CANNOT_READ: string = translationKey("This credential can't read these");
// Not "not reported": the cloud may be reporting fine while OneUptime could not answer.
const READ_FAILED: string = translationKey("Couldn't read this");

/*
 * What a page of the kinds Needs attention caps a read of holds, for the line under it. A
 * cloud can have thousands of instances in ERROR, and a read of them all would be no
 * better an answer: this says how many there are, and where the rest are.
 */
interface CappedKind {
  kind: OpenStackResourceKind;
  page: PageMap;
  sentence: string;
}

interface CappedKindReading extends CappedKind {
  shown: number;
  total: number;
}

const CAPPED_KINDS: Array<CappedKind> = [
  {
    kind: OpenStackResourceKind.Instance,
    page: PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
    sentence: translationKey(
      "{{shown}} of {{total}} instances that may need someone are listed here.",
    ),
  },
  {
    kind: OpenStackResourceKind.Volume,
    page: PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
    sentence: translationKey(
      "{{shown}} of {{total}} volumes that may need someone are listed here.",
    ),
  },
  {
    kind: OpenStackResourceKind.Router,
    page: PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
    sentence: translationKey(
      "{{shown}} of {{total}} routers that may need someone are listed here.",
    ),
  },
  {
    kind: OpenStackResourceKind.FloatingIp,
    page: PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
    sentence: translationKey(
      "{{shown}} of {{total}} floating IPs that may need someone are listed here.",
    ),
  },
  {
    kind: OpenStackResourceKind.BareMetalNode,
    page: PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODES,
    sentence: translationKey(
      "{{shown}} of {{total}} bare metal nodes that may need someone are listed here.",
    ),
  },
];

/*
 * Only what the cloud reported: a kind with no rows has no chip, since a credential
 * that cannot list hypervisors has none to count, and "0 hypervisors" is not true.
 */
function getCountChips(
  summary: OpenStackInventorySummary,
  translator: Translator,
  isCurrent: boolean,
): Array<CountChip> {
  const chips: Array<CountChip> = [
    {
      key: "regions",
      icon: IconProp.Globe,
      label: translator.translatePlural(
        { one: "{{count}} region", other: "{{count}} regions" },
        summary.regionCount,
      ),
    },
    {
      key: "availability-zones",
      icon: IconProp.MapPin,
      label: translator.translatePlural(
        {
          one: "{{count}} availability zone",
          other: "{{count}} availability zones",
        },
        summary.availabilityZoneCount,
      ),
    },
    {
      key: "services",
      icon: IconProp.Activity,
      label: translator.translatePlural(
        { one: "{{count}} service", other: "{{count}} services" },
        summary.serviceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
    },
    {
      key: "hypervisors",
      icon: IconProp.ServerStack,
      label: translator.translatePlural(
        { one: "{{count}} hypervisor", other: "{{count}} hypervisors" },
        summary.hypervisorCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_HYPERVISORS,
    },
    {
      key: "instances",
      icon: IconProp.Cube,
      label: translator.translatePlural(
        { one: "{{count}} instance", other: "{{count}} instances" },
        summary.instanceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_INSTANCES,
    },
    {
      key: "networks",
      icon: IconProp.Globe,
      label: translator.translatePlural(
        { one: "{{count}} network", other: "{{count}} networks" },
        summary.networkCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_NETWORKS,
    },
    {
      key: "routers",
      icon: IconProp.Share,
      label: translator.translatePlural(
        { one: "{{count}} router", other: "{{count}} routers" },
        summary.routerCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_ROUTERS,
    },
    {
      key: "floating-ips",
      icon: IconProp.MapPin,
      label: translator.translatePlural(
        { one: "{{count}} floating IP", other: "{{count}} floating IPs" },
        summary.floatingIpCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_FLOATING_IPS,
    },
    {
      key: "volumes",
      icon: IconProp.Disc,
      label: translator.translatePlural(
        { one: "{{count}} volume", other: "{{count}} volumes" },
        summary.volumeCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_VOLUMES,
    },
    {
      key: "bare-metal-nodes",
      icon: IconProp.Server,
      label: translator.translatePlural(
        {
          one: "{{count}} bare metal node",
          other: "{{count}} bare metal nodes",
        },
        summary.bareMetalNodeCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_BARE_METAL_NODES,
    },
    {
      key: "projects",
      icon: IconProp.Folder,
      label: translator.translatePlural(
        { one: "{{count}} project", other: "{{count}} projects" },
        summary.projectCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_PROJECTS,
    },
    {
      key: "stacks",
      icon: IconProp.Layers,
      label: translator.translatePlural(
        { one: "{{count}} stack", other: "{{count}} stacks" },
        summary.stackCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_STACKS,
    },
    {
      key: "container-clusters",
      icon: IconProp.Kubernetes,
      label: translator.translatePlural(
        {
          one: "{{count}} Kubernetes cluster",
          other: "{{count}} Kubernetes clusters",
        },
        summary.containerClusterCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_CONTAINER_CLUSTERS,
    },
    {
      key: "shares",
      icon: IconProp.Folder,
      label: translator.translatePlural(
        { one: "{{count}} share", other: "{{count}} shares" },
        summary.shareCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_SHARES,
    },
    {
      key: "load-balancers",
      icon: IconProp.Globe,
      label: translator.translatePlural(
        {
          one: "{{count}} load balancer",
          other: "{{count}} load balancers",
        },
        summary.loadBalancerCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_LOAD_BALANCERS,
    },
    {
      key: "databases",
      icon: IconProp.Database,
      label: translator.translatePlural(
        { one: "{{count}} database", other: "{{count}} databases" },
        summary.databaseInstanceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_DATABASE_INSTANCES,
    },
    {
      key: "object-containers",
      icon: IconProp.Cube,
      label: translator.translatePlural(
        { one: "{{count}} container", other: "{{count}} containers" },
        summary.objectContainerCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_OBJECT_CONTAINERS,
    },
    {
      key: "dns-zones",
      icon: IconProp.Globe,
      label: translator.translatePlural(
        { one: "{{count}} DNS zone", other: "{{count}} DNS zones" },
        summary.dnsZoneCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_DNS_ZONES,
    },
  ];

  const counts: Record<string, number> = {
    regions: summary.regionCount,
    "availability-zones": summary.availabilityZoneCount,
    services: summary.serviceCount,
    hypervisors: summary.hypervisorCount,
    instances: summary.instanceCount,
    networks: summary.networkCount,
    routers: summary.routerCount,
    "floating-ips": summary.floatingIpCount,
    volumes: summary.volumeCount,
    "bare-metal-nodes": summary.bareMetalNodeCount,
    projects: summary.projectCount,
    stacks: summary.stackCount,
    "container-clusters": summary.containerClusterCount,
    shares: summary.shareCount,
    "load-balancers": summary.loadBalancerCount,
    databases: summary.databaseInstanceCount,
    "object-containers": summary.objectContainerCount,
    "dns-zones": summary.dnsZoneCount,
  };

  const reported: Array<CountChip> = chips.filter(
    (chip: CountChip): boolean => {
      return (counts[chip.key] || 0) > 0;
    },
  );

  /*
   * How many enabled services and agents are down is a count, not a verdict, and the one
   * a person opens this page for. One someone disabled is not counted, and a cloud that
   * has stopped reporting has no services down that anyone knows of.
   */
  if (isCurrent && summary.downServiceCount > 0) {
    reported.push({
      key: "services-down",
      icon: IconProp.ExclaimationCircle,
      label: translator.translatePlural(
        { one: "{{count}} service down", other: "{{count}} services down" },
        summary.downServiceCount,
      ),
      page: PageMap.OPENSTACK_CLOUD_VIEW_SERVICES,
      isDanger: true,
    });
  }

  return reported;
}

function formatPercent(percent: number | null, translator: Translator): string {
  return percent === null
    ? "—"
    : `${translator.formatNumber(Math.round(percent))}%`;
}

const HEALTH_CLASS_NAMES: Record<
  ResourceHealth,
  { pill: string; dot: string }
> = {
  Healthy: {
    pill: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  Degraded: {
    pill: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  Unhealthy: {
    pill: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
};

const UNKNOWN_HEALTH_CLASS_NAMES: { pill: string; dot: string } = {
  pill: "bg-gray-50 text-gray-600 ring-gray-200",
  dot: "bg-gray-400",
};

const OpenStackCloudOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();
  const { region }: OpenStackRegionState = useOpenStackRegion();

  const [cloud, setCloud] = useState<OpenStackCloud | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const [summary, setSummary] = useState<OpenStackInventorySummary | null>(
    null,
  );
  const [summaryError, setSummaryError] = useState<string>("");

  const [regionSummaries, setRegionSummaries] = useState<
    Array<OpenStackRegionSummary>
  >([]);
  const [regionsError, setRegionsError] = useState<string>("");

  // Null until read, and while the agent is disconnected: there is nothing to judge.
  const [attention, setAttention] = useState<OpenStackAttentionAnswer | null>(
    null,
  );
  // How many of each kind may need someone in each region, when each had its own read.
  const [totalsByRegion, setTotalsByRegion] = useState<
    Record<string, Record<string, number>>
  >({});
  const [apis, setApis] = useState<Array<OpenStackResource>>([]);
  const [attentionError, setAttentionError] = useState<string>("");

  const [consumers, setConsumers] = useState<OpenStackTopConsumers | null>(
    null,
  );
  const [consumersError, setConsumersError] = useState<string>("");

  // What a lost host takes with it, by its row's external id, once read.
  const [radii, setRadii] = useState<
    Record<string, { instanceCount: number; projectCount: number }>
  >({});

  const isConnectedRef: MutableRefObject<boolean> = useRef<boolean>(false);

  /*
   * Only the newest read of each kind may land: a slow answer for the region the reader
   * just left must not repaint the page.
   */
  const summarySequence: MutableRefObject<number> = useRef<number>(0);
  const consumersSequence: MutableRefObject<number> = useRef<number>(0);
  const healthSequence: MutableRefObject<number> = useRef<number>(0);
  const regionRef: MutableRefObject<string | null> = useRef<string | null>(
    region,
  );
  regionRef.current = region;

  const loadSummary: PromiseVoidFunction = async (): Promise<void> => {
    const sequence: number = ++summarySequence.current;
    let read: OpenStackInventorySummary | null = null;
    let failure: string = "";
    try {
      read = await fetchOpenStackInventorySummary(modelId, regionRef.current);
      if (!read) {
        failure =
          translator.translateText(
            "This cloud's inventory could not be read.",
          ) || "This cloud's inventory could not be read.";
      }
    } catch (err) {
      failure = API.getFriendlyMessage(err);
    }
    if (sequence !== summarySequence.current) {
      return;
    }
    setSummary(read);
    setSummaryError(failure);
  };

  const loadConsumers: PromiseVoidFunction = async (): Promise<void> => {
    const sequence: number = ++consumersSequence.current;
    try {
      const read: OpenStackTopConsumers = await fetchOpenStackTopConsumers({
        openStackCloudId: modelId,
        regionName: regionRef.current,
      });
      if (sequence === consumersSequence.current) {
        setConsumers(read);
        setConsumersError("");
      }
    } catch (err) {
      if (sequence === consumersSequence.current) {
        setConsumersError(API.getFriendlyMessage(err));
      }
    }
  };

  /*
   * What a lost host takes with it: "42 instances in 7 projects" is the first thing anyone
   * asks. Best effort, and few: a hypervisor's own count stands in for one that fails.
   */
  const loadRadii: (rows: Array<OpenStackResource>) => void = (
    rows: Array<OpenStackResource>,
  ): void => {
    const lost: Array<OpenStackResource> = rows
      .filter((row: OpenStackResource): boolean => {
        return (
          row.kind === OpenStackResourceKind.Service &&
          row.name === "nova-compute" &&
          Boolean(row.externalId) &&
          isOpenStackServiceDown({
            status: row.status,
            adminState: row.adminState,
          })
        );
      })
      .slice(0, BLAST_RADIUS_READS);

    for (const row of lost) {
      fetchOpenStackBlastRadius({
        openStackCloudId: modelId,
        kind: OpenStackResourceKind.Service,
        externalId: row.externalId as string,
      })
        .then((radius: OpenStackBlastRadius) => {
          if (radius.isKnown) {
            setRadii(
              (
                known: Record<
                  string,
                  { instanceCount: number; projectCount: number }
                >,
              ) => {
                return {
                  ...known,
                  [row.externalId as string]: {
                    instanceCount: radius.instanceCount,
                    projectCount: radius.projectCount,
                  },
                };
              },
            );
          }
        })
        .catch(() => {
          // Its row still says it is down, and how many its hypervisor last held.
        });
    }
  };

  /*
   * The regions, then what needs attention in each. Every region gets a read of its own
   * so that one with a thousand instances in ERROR leaves another's list whole.
   */
  const loadHealth: PromiseVoidFunction = async (): Promise<void> => {
    const sequence: number = ++healthSequence.current;

    let names: Array<string> = [];
    try {
      const regions: Array<OpenStackRegionSummary> =
        await fetchOpenStackRegionSummaries(modelId);
      if (sequence !== healthSequence.current) {
        return;
      }
      setRegionSummaries(regions);
      setRegionsError("");
      names = regions.map((one: OpenStackRegionSummary): string => {
        return one.regionName;
      });
    } catch (err) {
      if (sequence !== healthSequence.current) {
        return;
      }
      // The regions' card says so. What needs attention can still be read whole.
      setRegionsError(API.getFriendlyMessage(err));
    }

    try {
      const regionsToRead: Array<string | null> =
        names.length > 1 ? names : [null];
      const [answers, apiRows]: [
        Array<OpenStackAttentionAnswer>,
        Array<OpenStackResource>,
      ] = await Promise.all([
        Promise.all(
          regionsToRead.map(
            (regionName: string | null): Promise<OpenStackAttentionAnswer> => {
              return fetchOpenStackAttention({
                openStackCloudId: modelId,
                regionName: regionName,
              });
            },
          ),
        ),
        fetchOpenStackRows({
          openStackCloudId: modelId,
          kind: OpenStackResourceKind.Api,
          limit: 500,
        }),
      ]);
      if (sequence !== healthSequence.current) {
        return;
      }
      const merged: OpenStackAttentionAnswer = mergeOpenStackAttention(answers);
      setAttention(merged);
      const totals: Record<string, Record<string, number>> = {};
      regionsToRead.forEach(
        (regionName: string | null, index: number): void => {
          const answer: OpenStackAttentionAnswer | undefined = answers[index];
          if (regionName && answer) {
            totals[regionName] = answer.totalsByKind;
          }
        },
      );
      setTotalsByRegion(totals);
      setApis(apiRows);
      setAttentionError("");
      loadRadii(merged.rows);
    } catch (err) {
      if (sequence === healthSequence.current) {
        setAttention(null);
        setAttentionError(API.getFriendlyMessage(err));
      }
    }
  };

  /*
   * Reads what is current, when anything is. A cloud that has stopped reporting asks for
   * nothing to judge: anything it answered would be what it said days ago.
   */
  const loadReads: () => void = (): void => {
    if (!isConnectedRef.current) {
      healthSequence.current++;
      consumersSequence.current++;
      setAttention(null);
      setAttentionError("");
      setConsumers(null);
      setConsumersError("");
      return;
    }
    loadHealth().catch((err: Error) => {
      setAttentionError(API.getFriendlyMessage(err));
    });
    loadConsumers().catch((err: Error) => {
      setConsumersError(API.getFriendlyMessage(err));
    });
  };

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
    try {
      const [item]: [OpenStackCloud | null, void] = await Promise.all([
        ModelAPI.getItem<OpenStackCloud>({
          modelType: OpenStackCloud,
          id: modelId,
          select: {
            name: true,
            otelCollectorStatus: true,
            lastSeenAt: true,
            agentVersion: true,
            collectionMethod: true,
          },
        }),
        loadSummary(),
      ]);
      setCloud(item);
      isConnectedRef.current = isResourceStatusConnected(
        item?.otelCollectorStatus,
      );
      loadReads();
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  // A tab left open stays true, or says it has stopped being able to.
  const refreshCloud: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const item: OpenStackCloud | null =
        await ModelAPI.getItem<OpenStackCloud>({
          modelType: OpenStackCloud,
          id: modelId,
          select: {
            name: true,
            otelCollectorStatus: true,
            lastSeenAt: true,
            agentVersion: true,
            collectionMethod: true,
          },
        });
      if (item) {
        setCloud(item);
        isConnectedRef.current = isResourceStatusConnected(
          item.otelCollectorStatus,
        );
      }
    } catch {
      // The page keeps what it showed, and the next refresh tries again.
    }
    await loadSummary();
    loadReads();
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  // Another region: its counts and its consumers. What needs attention is held by region.
  const isFirstRegion: MutableRefObject<boolean> = useRef<boolean>(true);
  useEffect(() => {
    if (isFirstRegion.current) {
      isFirstRegion.current = false;
      return;
    }
    loadSummary().catch((err: Error) => {
      setSummaryError(API.getFriendlyMessage(err));
    });
    if (isConnectedRef.current) {
      loadConsumers().catch((err: Error) => {
        setConsumersError(API.getFriendlyMessage(err));
      });
    }
  }, [region]);

  useEffect(() => {
    const timer: ReturnType<typeof setInterval> = setInterval(() => {
      refreshCloud().catch(() => {
        // The next one tries again.
      });
    }, REFRESH_EVERY_MS);
    return () => {
      clearInterval(timer);
    };
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return (
      <ResourcePartReadError
        testId="openstack-overview-read-error"
        title="Couldn't load this cloud"
        message={error}
        onRetry={() => {
          fetchData().catch((err: Error) => {
            setError(API.getFriendlyMessage(err));
          });
        }}
      />
    );
  }

  if (!cloud) {
    return <ErrorMessage message="Cloud not found." />;
  }

  const hasReported: boolean =
    Boolean(cloud.lastSeenAt) ||
    Boolean(summary && !isOpenStackInventoryEmpty(summary));

  /*
   * Nothing reported yet, as far as anyone can tell. A summary that could not be read
   * says nothing either way, so it says so below rather than asking for an agent that may
   * be running fine.
   */
  if (!hasReported && !summaryError) {
    // A probe has no agent to install: how its collection is going is what there is to say.
    if (isOpenStackProbeCollected(cloud)) {
      return <OpenStackCollectionStatusCard modelId={modelId} />;
    }

    return (
      <OpenStackDocumentationCard
        cloudName={cloud.name || ""}
        title="Connect this cloud"
        description="Nothing has been reported yet. Say how you deploy OpenStack and follow the steps for it, and its services, hypervisors and instances appear here once data arrives."
      />
    );
  }

  const status: string = cloud.otelCollectorStatus || "";
  const isConnected: boolean = isResourceStatusConnected(status);
  const now: Date = OneUptimeDate.getCurrentDate();
  const routes: OpenStackPartRoutes = getOpenStackPartRoutes(modelId);

  const lastSeenText: string = cloud.lastSeenAt
    ? translator.translateTemplate("Last seen {{time}}", {
        time: OneUptimeDate.fromNow(cloud.lastSeenAt),
      })
    : translator.translateText("Never seen") || "Never seen";

  const documentationRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_DOCUMENTATION] as Route,
    { modelId: modelId },
  );
  const isProbeCollected: boolean = isOpenStackProbeCollected(cloud);
  const cloudRoute: Route = routes.cloudRoute;

  const inScope: (row: OpenStackResource) => boolean = (
    row: OpenStackResource,
  ): boolean => {
    return (
      !region ||
      isOpenStackRowInRegion({ row: row, regionName: region, now: now })
    );
  };

  /*
   * Only rows that were read can say a credential is closed to something: with its workers
   * unread, a stopped Placement stays a stopped Placement.
   */
  const asCredentialReadsThem: (
    read: Array<OpenStackResource>,
  ) => Array<OpenStackResource> = (
    read: Array<OpenStackResource>,
  ): Array<OpenStackResource> => {
    return attention
      ? getOpenStackRowsAsThisCredentialReadsThem({
          rows: read,
          apis: apis,
          workers: attention.rows.filter((row: OpenStackResource): boolean => {
            return row.kind === OpenStackResourceKind.Service;
          }),
        })
      : read;
  };
  const rows: Array<OpenStackResource> = asCredentialReadsThem(
    attention?.rows || [],
  ).filter(inScope);
  const apisInScope: Array<OpenStackResource> =
    asCredentialReadsThem(apis).filter(inScope);
  const hypervisors: Array<OpenStackResource> = rows.filter(
    (row: OpenStackResource): boolean => {
      return row.kind === OpenStackResourceKind.Hypervisor;
    },
  );
  const workers: Array<OpenStackResource> = rows.filter(
    (row: OpenStackResource): boolean => {
      return row.kind === OpenStackResourceKind.Service;
    },
  );

  const leftOut: Array<OpenStackRowsLeftOut> = (
    attention?.leftOut || []
  ).filter((group: OpenStackRowsLeftOut): boolean => {
    return !region || !group.regionName || group.regionName === region;
  });

  const items: Array<ResourceAttentionItem> = getOpenStackAttentionItems({
    rows: rows,
    now: now,
    routeFor: routes.routeFor,
    nameFor: getOpenStackAttentionName,
    blastRadiusFor: (
      row: OpenStackResource,
    ): { instanceCount: number; projectCount: number } | undefined => {
      return radii[row.externalId || ""];
    },
  });

  const accessGaps: Array<OpenStackAccessGap> =
    isConnected && attention
      ? getOpenStackAccessGaps({
          apis: apisInScope,
          workers: workers,
          hypervisors: hypervisors,
          leftOut: leftOut,
          hasStoragePools: Boolean(summary && summary.storageCapacityBytes > 0),
        })
      : [];
  const health: ResourceHealth = getOpenStackHealth(items);

  /*
   * Only a judgement of something current, read in full, can say Healthy: not a cloud that
   * has stopped reporting, not a read that failed, and not a credential that could not see
   * the services it would have to be down to say otherwise. What it did find wrong stands.
   */
  const isHealthKnown: boolean =
    isConnected &&
    attention !== null &&
    (health !== "Healthy" || accessGaps.length === 0);
  const healthClassNames: { pill: string; dot: string } = isHealthKnown
    ? HEALTH_CLASS_NAMES[health]
    : UNKNOWN_HEALTH_CLASS_NAMES;

  const groups: Array<OpenStackServiceGroup> = getOpenStackServiceGroups({
    apis: apisInScope,
    workers: workers,
    leftOut: leftOut,
    now: now,
  });

  const healthByRegion: Record<string, ResourceHealth> = {};
  if (isConnected && attention) {
    for (const one of regionSummaries) {
      // The same rows as reading this region, so its pill says what that page would.
      const regionRows: Array<OpenStackResource> = attention.rows.filter(
        (row: OpenStackResource): boolean => {
          return isOpenStackRowInRegion({
            row: row,
            regionName: one.regionName,
            now: now,
          });
        },
      );
      healthByRegion[one.regionName] = getOpenStackHealth(
        getOpenStackAttentionItems({ rows: regionRows, now: now }),
      );
    }
  }

  /*
   * The tiles. All of them read as nothing while the agent has stopped, because a number
   * days old beside a percentage reads as today's.
   */
  const apisUp: number = apisInScope.filter((row: OpenStackResource) => {
    return row.status === "up";
  }).length;
  const workerCounts: OpenStackWorkerCounts = getOpenStackWorkerCounts(
    workers,
    leftOut,
  );
  const hypervisorCounts: OpenStackHypervisorCounts =
    getOpenStackHypervisorCounts(hypervisors, leftOut);
  const isCurrent: boolean = isConnected && attention !== null;
  const hasAccessGap: (key: string) => boolean = (key: string): boolean => {
    return accessGaps.some((gap: OpenStackAccessGap): boolean => {
      return gap.key === key;
    });
  };

  const nothingCurrent: string =
    translator.translateText(NOT_CURRENT) || NOT_CURRENT;
  const readFailed: string =
    translator.translateText(READ_FAILED) || READ_FAILED;

  const vcpuPercent: number | null = summary
    ? getOpenStackPercent(summary.vcpuAllocated, summary.vcpuCapacity)
    : null;
  const memoryPercent: number | null = summary
    ? getOpenStackPercent(
        summary.memoryAllocatedBytes,
        summary.memoryCapacityBytes,
      )
    : null;
  const storagePercent: number | null = summary
    ? getOpenStackPercent(
        summary.storageUsedBytes,
        summary.storageCapacityBytes,
      )
    : null;
  const fullestPoolPercent: number | null =
    getOpenStackFullestPoolPercent(rows);

  const getAllocationTone: (kind: "vcpu" | "memory") => GoldenMetricTileTone = (
    kind: "vcpu" | "memory",
  ): GoldenMetricTileTone => {
    return hasOpenStackHostPastAllocationLine(rows, kind)
      ? "warning"
      : "positive";
  };

  const controlPlaneTone: GoldenMetricTileTone =
    apisUp < apisInScope.length || workerCounts.down > 0
      ? "danger"
      : "positive";

  const controlPlaneSublabel: string =
    workerCounts.down > 0
      ? translator.translatePlural(
          {
            one: "APIs up · {{count}} worker down",
            other: "APIs up · {{count}} workers down",
          },
          workerCounts.down,
        )
      : translator.translateText("APIs up") || "APIs up";

  const hypervisorSublabel: string =
    hypervisorCounts.lost > 0 && hypervisorCounts.disabled > 0
      ? translator.translateTemplate(
          "up · {{lost}} lost · {{disabled}} disabled",
          {
            lost: translator.formatNumber(hypervisorCounts.lost),
            disabled: translator.formatNumber(hypervisorCounts.disabled),
          },
        )
      : hypervisorCounts.lost > 0
        ? translator.translatePlural(
            { one: "up · {{count}} lost", other: "up · {{count}} lost" },
            hypervisorCounts.lost,
          )
        : hypervisorCounts.disabled > 0
          ? translator.translatePlural(
              {
                one: "up · {{count}} disabled",
                other: "up · {{count}} disabled",
              },
              hypervisorCounts.disabled,
            )
          : translator.translateText("up") || "up";

  /*
   * Drawn in the page's direction with each value set apart: a Persian tile
   * reads "۴۸۰ GiB از ۱٫۰ TiB" from the right, each size with its number
   * before its unit (issue #7191).
   */
  const amountSublabel: (used: string, total: string) => string = (
    used: string,
    total: string,
  ): string => {
    return translator.translateTemplate(
      "{{used}} of {{total}}",
      {
        used: used,
        total: total,
      },
      { setsValuesApart: true },
    );
  };

  // A size in the reader's digits: "۶٫۰ TiB".
  const formatSize: (bytes: number) => string = (bytes: number): string => {
    return formatOpenStackBytes(bytes, { language: translator.language });
  };

  /*
   * Of the region being read when it had a read of its own, and otherwise of the cloud,
   * which then has only the one region.
   */
  const attentionTotals: Record<string, number> =
    (region ? totalsByRegion[region] : undefined) ||
    attention?.totalsByKind ||
    {};
  const cappedKinds: Array<CappedKindReading> = [];
  if (attention) {
    for (const capped of CAPPED_KINDS) {
      const shown: number = rows.filter((row: OpenStackResource) => {
        return row.kind === capped.kind;
      }).length;
      const total: number = attentionTotals[capped.kind] || 0;
      if (total > shown) {
        cappedKinds.push({ ...capped, shown, total });
      }
    }
  }

  const chips: Array<CountChip> = summary
    ? getCountChips(summary, translator, isConnected)
    : [];

  return (
    <Fragment>
      {isOpenStackProbeCollected(cloud) ? (
        <OpenStackCollectionStatusCard modelId={modelId} />
      ) : (
        <ResourceConnectionGuideCard
          status={status}
          lastSeenAt={cloud.lastSeenAt}
          guide={getOpenStackCloudConnectionGuide(
            cloud.name || "",
            getConfiguredOneUptimeUrl(),
          )}
          documentationRoute={documentationRoute}
        />
      )}

      <div data-testid="openstack-overview-data-status">
        <Card
          title="Data status"
          description="Whether this cloud's data is reaching OneUptime, and what it has reported."
        >
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-1">
                <span
                  data-testid="openstack-overview-connection"
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${
                    isConnected
                      ? "bg-emerald-50 text-emerald-700 ring-emerald-200"
                      : "bg-amber-50 text-amber-700 ring-amber-200"
                  }`}
                >
                  <span
                    className={`inline-block h-1.5 w-1.5 rounded-full ${
                      isConnected ? "bg-emerald-500" : "bg-amber-500"
                    }`}
                  />
                  {getResourceConnectionLabel({
                    translator: translator,
                    isConnected: isConnected,
                    status: status,
                  })}
                </span>
                <InfoTooltip
                  label="Data status"
                  text={OPENSTACK_METRIC_DESCRIPTIONS.dataStatus}
                />
              </span>
              {/*
               * No pill until there is something to say, and a pill that admits it when
               * what there is to say can't be known.
               */}
              {!isConnected || attention || attentionError ? (
                <span className="inline-flex items-center gap-1">
                  <span
                    data-testid="openstack-overview-health"
                    data-health={isHealthKnown ? health : "Unknown"}
                    className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${healthClassNames.pill}`}
                  >
                    <span
                      className={`inline-block h-1.5 w-1.5 rounded-full ${healthClassNames.dot}`}
                    />
                    {getResourceHealthLabel({
                      translator: translator,
                      health: health,
                      isConnected: isHealthKnown,
                    })}
                  </span>
                  <InfoTooltip
                    label="Health"
                    text={OPENSTACK_METRIC_DESCRIPTIONS.health}
                  />
                </span>
              ) : (
                <></>
              )}
              <span className="text-sm text-gray-500">{lastSeenText}</span>
              <AgentVersion
                kind={AgentKind.OpenStackAgent}
                version={cloud.agentVersion}
                variant="chip"
              />
              {isOpenStackProbeCollected(cloud) ? (
                <></>
              ) : (
                <Link
                  to={documentationRoute}
                  className="text-sm font-medium text-indigo-600 hover:underline"
                >
                  {translator.translateText("Setup guide")}
                </Link>
              )}
            </div>
            {!isConnected && cloud.lastSeenAt ? (
              <p
                data-testid="openstack-overview-quiet"
                className="mt-3 rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-800"
              >
                {translator.translateText(
                  "Nothing here is current. These counts are what this cloud last reported.",
                )}
              </p>
            ) : (
              <></>
            )}
            {summaryError ? (
              <div className="mt-4">
                <ResourcePartReadError
                  testId="openstack-overview-summary-error"
                  title="Couldn't read this cloud's inventory"
                  message={summaryError}
                  onRetry={() => {
                    loadSummary().catch((err: Error) => {
                      setSummaryError(API.getFriendlyMessage(err));
                    });
                  }}
                />
              </div>
            ) : (
              <div
                data-testid="openstack-overview-counts"
                data-current={isConnected ? "true" : "false"}
                className="mt-4 flex flex-wrap items-center gap-1.5"
              >
                {chips.map((chip: CountChip): ReactElement => {
                  const content: ReactElement = (
                    <>
                      <Icon icon={chip.icon} className="h-3 w-3" />
                      <span>{chip.label}</span>
                    </>
                  );

                  if (!chip.page) {
                    return (
                      <span key={chip.key} className={CHIP_CLASS_NAME}>
                        {content}
                      </span>
                    );
                  }

                  return (
                    <Link
                      key={chip.key}
                      to={RouteUtil.populateRouteParams(
                        RouteMap[chip.page] as Route,
                        { modelId: modelId },
                      )}
                      className={
                        chip.isDanger
                          ? DANGER_CHIP_CLASS_NAME
                          : LINK_CHIP_CLASS_NAME
                      }
                    >
                      {content}
                    </Link>
                  );
                })}
              </div>
            )}
          </div>
        </Card>
      </div>

      <OpenStackAccessNotice
        gaps={accessGaps}
        documentationRoute={documentationRoute}
        settingsRouteOfProbeCloud={
          isProbeCollected
            ? RouteUtil.populateRouteParams(
                RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SETTINGS] as Route,
                { modelId: modelId },
              )
            : null
        }
      />

      {/*
       * What needs someone, most urgent first, while the cloud reports. A disconnected
       * cloud's last snapshot is no longer the truth, and its pill says Health Unknown.
       * A failed read says so in its own frame: an empty card would be an all-clear
       * nobody gave.
       */}
      {attentionError ? (
        <div className="mb-6">
          <ResourcePartReadError
            testId="openstack-needs-attention-error"
            title="Couldn't read what needs attention"
            message={attentionError}
            onRetry={() => {
              loadHealth().catch((err: Error) => {
                setAttentionError(API.getFriendlyMessage(err));
              });
            }}
          />
        </div>
      ) : isConnected && attention ? (
        <NeedsAttentionCard
          testId="openstack-needs-attention"
          items={items}
          description="What is broken or needs a look in this cloud, the most urgent first."
        />
      ) : (
        <></>
      )}

      {cappedKinds.length > 0 ? (
        <ul
          className="mb-6 space-y-1 text-sm text-gray-600"
          data-testid="openstack-needs-attention-capped"
        >
          {cappedKinds.map((capped: CappedKindReading): ReactElement => {
            return (
              <li key={capped.kind} data-key={capped.kind}>
                {translator.translateTemplate(capped.sentence, {
                  shown: translator.formatNumber(capped.shown),
                  total: translator.formatNumber(capped.total),
                })}{" "}
                <Link
                  to={RouteUtil.populateRouteParams(
                    RouteMap[capped.page] as Route,
                    { modelId: modelId },
                  )}
                  className="font-medium text-indigo-600 hover:underline"
                >
                  {translator.translateText("See them all")}
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <></>
      )}

      {/*
       * Nova and Placement report what is promised, so nothing here says CPU or usage,
       * and each bar's colour is the rules' own: a verdict from anywhere else would be a
       * page and an alert disagreeing.
       */}
      <div
        data-testid="openstack-overview-capacity"
        className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5"
      >
        <GoldenMetricTile
          title="Control plane"
          icon={IconProp.Activity}
          iconColor="emerald"
          value={
            isCurrent && apisInScope.length > 0
              ? `${translator.formatNumber(apisUp)}/${translator.formatNumber(apisInScope.length)}`
              : "—"
          }
          sublabel={
            !isConnected
              ? nothingCurrent
              : attentionError
                ? readFailed
                : isCurrent && apisInScope.length > 0
                  ? controlPlaneSublabel
                  : undefined
          }
          percent={
            isCurrent && apisInScope.length > 0
              ? (apisUp / apisInScope.length) * 100
              : null
          }
          tone={controlPlaneTone}
          description={OPENSTACK_METRIC_DESCRIPTIONS.controlPlane}
        />
        <GoldenMetricTile
          title="Hypervisors"
          icon={IconProp.ServerStack}
          iconColor="slate"
          value={
            isCurrent && hypervisorCounts.total > 0
              ? `${translator.formatNumber(hypervisorCounts.up)}/${translator.formatNumber(hypervisorCounts.total)}`
              : "—"
          }
          sublabel={
            !isConnected
              ? nothingCurrent
              : attentionError
                ? readFailed
                : hasAccessGap("hypervisors")
                  ? translator.translateText(CANNOT_READ) || CANNOT_READ
                  : isCurrent && hypervisorCounts.total > 0
                    ? hypervisorSublabel
                    : undefined
          }
          percent={
            isCurrent && hypervisorCounts.total > 0
              ? (hypervisorCounts.up / hypervisorCounts.total) * 100
              : null
          }
          tone={hypervisorCounts.lost > 0 ? "danger" : "positive"}
          description={OPENSTACK_METRIC_DESCRIPTIONS.hypervisors}
        />
        <GoldenMetricTile
          title="vCPUs allocated"
          icon={IconProp.ChartBar}
          iconColor="blue"
          value={isConnected ? formatPercent(vcpuPercent, translator) : "—"}
          sublabel={
            !isConnected
              ? nothingCurrent
              : summaryError
                ? readFailed
                : hasAccessGap("hypervisors")
                  ? translator.translateText(CANNOT_READ) || CANNOT_READ
                  : vcpuPercent === null || !summary
                    ? NOT_REPORTED
                    : amountSublabel(
                        translator.formatNumber(
                          Math.round(summary.vcpuAllocated),
                        ),
                        translator.formatNumber(
                          Math.round(summary.vcpuCapacity),
                        ),
                      )
          }
          percent={isConnected ? vcpuPercent : null}
          tone={getAllocationTone("vcpu")}
          description={OPENSTACK_METRIC_DESCRIPTIONS.vcpusAllocated}
        />
        <GoldenMetricTile
          title="Memory allocated"
          icon={IconProp.SquareStack}
          iconColor="violet"
          value={isConnected ? formatPercent(memoryPercent, translator) : "—"}
          sublabel={
            !isConnected
              ? nothingCurrent
              : summaryError
                ? readFailed
                : hasAccessGap("hypervisors")
                  ? translator.translateText(CANNOT_READ) || CANNOT_READ
                  : memoryPercent === null || !summary
                    ? NOT_REPORTED
                    : amountSublabel(
                        formatSize(summary.memoryAllocatedBytes),
                        formatSize(summary.memoryCapacityBytes),
                      )
          }
          percent={isConnected ? memoryPercent : null}
          tone={getAllocationTone("memory")}
          description={OPENSTACK_METRIC_DESCRIPTIONS.memoryAllocated}
        />
        <GoldenMetricTile
          title="Storage used"
          icon={IconProp.Database}
          iconColor="amber"
          value={isConnected ? formatPercent(storagePercent, translator) : "—"}
          sublabel={
            !isConnected
              ? nothingCurrent
              : summaryError
                ? readFailed
                : hasAccessGap("storage-pools")
                  ? translator.translateText(CANNOT_READ) || CANNOT_READ
                  : storagePercent === null || !summary
                    ? NOT_REPORTED
                    : fullestPoolPercent !== null
                      ? translator.translateTemplate(
                          "{{used}} of {{total}} · fullest pool {{percent}}",
                          {
                            used: formatSize(summary.storageUsedBytes),
                            total: formatSize(summary.storageCapacityBytes),
                            percent: formatPercent(
                              fullestPoolPercent,
                              translator,
                            ),
                          },
                          { setsValuesApart: true },
                        )
                      : amountSublabel(
                          formatSize(summary.storageUsedBytes),
                          formatSize(summary.storageCapacityBytes),
                        )
          }
          percent={isConnected ? storagePercent : null}
          tone={getOpenStackPoolTone(fullestPoolPercent)}
          description={OPENSTACK_METRIC_DESCRIPTIONS.storageUsed}
        />
      </div>

      {/*
       * A failed read of the regions only says so where there is a card it would have
       * filled: one region has none, and all of them failing has been said above.
       */}
      {isConnected && (!regionsError || (summary?.regionCount || 0) > 1) ? (
        <OpenStackRegionsCard
          regions={regionSummaries}
          healthByRegion={healthByRegion}
          selectedRegion={region}
          getRegionRoute={(regionName: string): Route => {
            return getOpenStackRegionRoute(cloudRoute, regionName);
          }}
          error={regionsError}
          onRetry={() => {
            loadHealth().catch((err: Error) => {
              setRegionsError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : (
        <></>
      )}

      {isCurrent ? (
        <OpenStackServicesCard
          groups={groups}
          servicesRoute={routes.getServicesRoute()}
          getRowRoute={routes.routeFor}
          showRegion={!region && regionSummaries.length > 1}
        />
      ) : (
        <></>
      )}

      {isCurrent ? (
        <OpenStackControlPlaneCard
          modelId={modelId}
          isProbeCollected={isProbeCollected}
          hidesWhenNothingIsWatched={isProbeCollected}
        />
      ) : (
        <></>
      )}

      {/*
       * What Security Events found about this cloud this week, for whoever may read it:
       * its audit trail, once the agent's logs profile sends one.
       */}
      {isConnected ? (
        <ResourceSecurityCard
          kind={SecurityConnectionKind.OpenStackCloud}
          modelId={modelId}
        />
      ) : (
        <></>
      )}

      {isConnected ? (
        <OpenStackTopConsumersCard
          consumers={consumers}
          rows={hypervisors}
          getProjectRoute={(projectId: string): Route | undefined => {
            return routes.getPartRoute(
              OpenStackResourceKind.Project,
              projectId,
            );
          }}
          getHypervisorRoute={routes.routeFor}
          error={consumersError}
          onRetry={() => {
            loadConsumers().catch((err: Error) => {
              setConsumersError(API.getFriendlyMessage(err));
            });
          }}
        />
      ) : (
        <></>
      )}

      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="openStackClouds"
        incidentsRoute={routes.incidentsRoute}
        alertsRoute={routes.alertsRoute}
        scheduledMaintenanceRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.OPENSTACK_CLOUD_VIEW_SCHEDULED_MAINTENANCE] as Route,
          { modelId: modelId },
        )}
      />

      {/*
       * Last on the page: the OpenStack AI agent's connection and whether AI may
       * investigate, linking to AI → AI agent.
       */}
      <ResourceAiAgentStatusSummaryCard
        descriptor={getResourceAiAgentDescriptor(AiResourceType.OpenStackCloud)}
        resourceId={modelId}
      />
    </Fragment>
  );
};

export default OpenStackCloudOverview;
