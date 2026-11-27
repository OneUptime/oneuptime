import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import XcpNgCollectionMethod from "Common/Types/XcpNg/XcpNgCollectionMethod";
import AppLink from "../../../Components/AppLink/AppLink";
import Includes from "Common/Types/BaseDatabase/Includes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import FieldType from "Common/UI/Components/Types/FieldType";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import OneUptimeDate from "Common/Types/Date";
import { AutoRefreshInterval } from "Common/Types/Dashboard/DashboardViewConfig";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import StatTilesSkeleton from "Common/UI/Components/Skeleton/StatTilesSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import EmptyState from "Common/UI/Components/EmptyState/EmptyState";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  StorageUsage,
  formatStorageBytes,
  formatStorageUsedPercent,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import AgentVersion from "../../../Components/AgentVersion/AgentVersion";
import { AgentKind } from "../../../Components/AgentVersion/AgentKind";
import ResourceRecordDetailsCard from "../../../Components/TelemetryResource/ResourceRecordDetailsCard";
import ResourceConnectionGuideCard from "../../../Components/ResourceConnection/ResourceConnectionGuideCard";
import XcpNgPoolProbeNotice from "../../../Components/XcpNg/XcpNgPoolProbeNotice";
import { getXcpNgPoolConnectionGuide } from "../../../Components/ResourceConnection/ResourceConnectionGuides";
import { ResourceConnectionState } from "../../../Components/ResourceConnection/ResourceConnectionState";
import { getConfiguredOneUptimeUrl } from "../../../Components/SetupGuide/ConfiguredOneUptimeUrl";
import ResourceActivityCards from "../../../Components/ResourceActivity/ResourceActivityCards";
import AutoRefreshControl from "../../../Components/TelemetryResource/AutoRefreshControl";
import useAutoRefresh, {
  UseAutoRefreshResult,
} from "../../../Components/TelemetryResource/useAutoRefresh";
import ResourceHeroDescription from "../../../Components/TelemetryResource/ResourceHeroDescription";
import {
  RESOURCE_HERO_CONTROLS_CLASS_NAME,
  RESOURCE_HERO_CONTROLS_TEST_ID,
  RESOURCE_HERO_IDENTITY_CLASS_NAME,
  RESOURCE_HERO_IDENTITY_TEST_ID,
  RESOURCE_HERO_TOP_ROW_CLASS_NAME,
  RESOURCE_HERO_TOP_ROW_TEST_ID,
} from "../../../Components/TelemetryResource/ResourceHeroLayout";
import { getResourceConnectionLabel } from "../../../Components/TelemetryResource/ResourceHeroStatus";
import ResourceHealthPill, {
  ResourceHealthDialogWords,
} from "../../../Components/ResourcePart/ResourceHealthPill";
import ResourceAttentionPill, {
  ComponentProps as ResourceAttentionPillProps,
} from "../../../Components/ResourcePart/ResourceAttentionPill";
import {
  ResourceAttentionItem,
  ResourceHealth,
} from "../../../Components/ResourcePart/ResourceAttention";
import NeedsAttentionCard from "../../../Components/ResourcePart/NeedsAttentionCard";
import GoldenMetricTile, {
  STORAGE_USAGE_TILE_TONES,
} from "../../../Components/Infrastructure/GoldenMetricTile";
import { XCP_NG_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/XcpNgMetricDescriptions";
import { XCP_NG_PAGE_DESCRIPTIONS } from "../../../Components/XcpNg/XcpNgPageDescriptions";
import XcpNgBusiestCard, {
  XCP_NG_BUSIEST_SHOWN,
} from "../../../Components/XcpNg/XcpNgBusiestCard";
import XcpNgHostsCard from "../../../Components/XcpNg/XcpNgHostsCard";
import XcpNgBackupsCard from "../../../Components/XcpNg/XcpNgBackupsCard";
import XcpNgHighAvailabilityCard from "../../../Components/XcpNg/XcpNgHighAvailabilityCard";
import XcpNgStorageRepositoriesCard from "../../../Components/XcpNg/XcpNgStorageRepositoriesCard";
import { getXcpNgProblemPill } from "../../../Components/XcpNg/XcpNgProblemPills";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import {
  XcpNgPoolConnection,
  getXcpNgPoolConnection,
} from "../Utils/XcpNgPoolConnection";
import {
  XCP_NG_STORAGE_USAGE_THRESHOLDS,
  XcpNgProblem,
  getXcpNgAttentionItems,
  getXcpNgPoolHealth,
  getXcpNgProblemItems,
} from "../Utils/XcpNgHealth";
import {
  XcpNgBusyPart,
  XcpNgHostSummary,
  XcpNgStorageSummary,
  XcpNgVmSummary,
  getXcpNgBusiestParts,
  summarizeXcpNgHosts,
  summarizeXcpNgStorage,
  summarizeXcpNgVms,
} from "../Utils/XcpNgPartFacts";
import {
  XCP_NG_INVENTORY_SELECT,
  XCP_NG_METRIC_STALE_MS,
  toXcpNgNumber,
} from "../Utils/XcpNgResourceUtils";
import { isXcpNgBackupsRead } from "../Utils/XcpNgEventFacts";

/*
 * AN XCP-NG POOL'S OVERVIEW: "what is this pool, and is it all right?"
 *
 * The hero says which pool it is, whether Xen Orchestra reports it (and
 * when it last did), its health - which opens what needs attention - its
 * hosts, VMs and storage repositories counted, each count of something
 * wrong a pill that opens which and why, and where the pool is read from:
 * the Xen Orchestra and the XCP-ng Agent. Under it: how to connect it while
 * it is not, what needs attention, three tiles (hosts running, VMs running,
 * the storage holding VM disks), the busiest VMs and hosts, every host and
 * every storage repository at a glance, what is open on the pool, and the
 * pool's details.
 *
 * Everything here is the pool's inventory as Xen Orchestra last reported it
 * (XcpNgResource): one read, no metric query, so the page is quick, and the
 * Resource Usage page draws the charts. While the pool is not read, its
 * last inventory is no longer the truth: the health says Health Unknown and
 * no count opens a part. A pool with nothing reported yet says so, and how
 * to connect it, rather than drawing a page of zeros.
 */

// What a Degraded or Unhealthy pool's pill opens (ResourceHealthPill).
export const XCP_NG_HEALTH_WORDS: ResourceHealthDialogWords = {
  degradedTitle: translationKey("Why this pool is Degraded"),
  unhealthyTitle: translationKey("Why this pool is Unhealthy"),
};

export const XCP_NG_OVERVIEW_REFRESH_STORAGE_KEY: string =
  "xcp-ng-overview-auto-refresh-interval";

// The tiles' grid: one on a phone, two, then all three.
const XCP_NG_TILES_GRID_CLASS_NAME: string =
  "grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3";

// The kinds the Overview reads: everything but the virtual disks.
const OVERVIEW_KINDS: Array<string> = [
  XcpNgResourceKind.Host,
  XcpNgResourceKind.VM,
  XcpNgResourceKind.StorageRepository,
];

interface CountChip {
  key: string;
  icon: IconProp;
  label: string;
  route: Route;
  // What is wrong among them, after the chip (#9594).
  problems: Array<ResourceAttentionPillProps>;
}

const XcpNgPoolOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const modelId: ObjectID = Navigation.getLastParamAsObjectID();

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");
  const [rows, setRows] = useState<Array<XcpNgResource> | null>(null);
  const [isInventoryLoading, setIsInventoryLoading] = useState<boolean>(true);
  const [inventoryError, setInventoryError] = useState<string>("");
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [lastRefreshedAt, setLastRefreshedAt] = useState<Date | null>(null);
  /*
   * Flipped on every refresh, so the details card reads the pool again
   * along with the rest of the page.
   */
  const [detailsRefresher, setDetailsRefresher] = useState<boolean>(false);

  // Only the newest read may commit: a slow one never paints over a newer.
  const readSequence: React.MutableRefObject<number> = useRef<number>(0);

  const fetchPool: () => Promise<XcpNgPool | null> =
    async (): Promise<XcpNgPool | null> => {
      return ModelAPI.getItem({
        modelType: XcpNgPool,
        id: modelId,
        select: {
          name: true,
          description: true,
          poolIdentifier: true,
          reportedName: true,
          xenOrchestraName: true,
          otelCollectorStatus: true,
          lastSeenAt: true,
          agentLastSeenAt: true,
          agentVersion: true,
          // A pool a probe reads names its connection (#10996, #10999).
          collectionMethod: true,
          xcpNgConnectionId: true,
          xcpNgConnection: {
            name: true,
          },
          hostCount: true,
          runningHostCount: true,
          disabledHostCount: true,
          vmCount: true,
          runningVmCount: true,
          storageRepositoryCount: true,
          storageCapacityBytes: true,
          storageUsedBytes: true,
          // What a probe reads beyond the metrics (#10997).
          isHaEnabled: true,
          haHostFailuresToTolerate: true,
          haPlanExistsFor: true,
          isHaOvercommitted: true,
          masterHostExternalId: true,
          eventsReadAt: true,
          backupsReadAt: true,
          eventReadStatus: true,
          backupJobs: true,
        },
      });
    };

  /*
   * The pool's inventory: its hosts, VMs and storage repositories, the
   * same rows its side menu's counts are recounted from.
   */
  const fetchInventory: () => Promise<Array<XcpNgResource>> = async (): Promise<
    Array<XcpNgResource>
  > => {
    const result: ListResult<XcpNgResource> =
      await ModelAPI.getList<XcpNgResource>({
        modelType: XcpNgResource,
        query: {
          xcpNgPoolId: modelId,
          kind: new Includes(OVERVIEW_KINDS),
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        select: XCP_NG_INVENTORY_SELECT,
        sort: {
          name: SortOrder.Ascending,
        },
      });
    return result.data;
  };

  const load: (isFirst: boolean) => Promise<void> = async (
    isFirst: boolean,
  ): Promise<void> => {
    const sequence: number = ++readSequence.current;
    setIsRefreshing(true);
    try {
      const item: XcpNgPool | null = await fetchPool();
      if (sequence !== readSequence.current) {
        return;
      }
      setPool(item);
      setError("");
    } catch (err) {
      if (sequence === readSequence.current && isFirst) {
        setError(API.getFriendlyMessage(err));
      }
    }
    if (isFirst) {
      setIsLoading(false);
    }

    try {
      const inventory: Array<XcpNgResource> = await fetchInventory();
      if (sequence !== readSequence.current) {
        return;
      }
      setRows(inventory);
      setInventoryError("");
    } catch (err) {
      /*
       * Say it, rather than drawing zeros that read as an empty pool; a
       * later failure leaves the last inventory on screen.
       */
      if (sequence === readSequence.current) {
        setInventoryError(API.getFriendlyMessage(err));
      }
    }
    if (sequence === readSequence.current) {
      setIsInventoryLoading(false);
      setIsRefreshing(false);
      setLastRefreshedAt(OneUptimeDate.getCurrentDate());
      setDetailsRefresher((previous: boolean): boolean => {
        return !previous;
      });
    }
  };

  const refresh: () => void = (): void => {
    load(false).catch(() => {
      // The page keeps what it showed; the next refresh tries again.
    });
  };

  const autoRefresh: UseAutoRefreshResult = useAutoRefresh({
    storageKey: XCP_NG_OVERVIEW_REFRESH_STORAGE_KEY,
    onRefresh: refresh,
    defaultInterval: AutoRefreshInterval.THIRTY_SECONDS,
  });

  useEffect(() => {
    load(true).catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
      setIsLoading(false);
    });
  }, []);

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!pool) {
    return <ErrorMessage message="Pool not found." />;
  }

  const now: Date = OneUptimeDate.getCurrentDate();
  const routes: XcpNgPartRoutes = getXcpNgPartRoutes(modelId);
  const inventory: Array<XcpNgResource> = rows || [];
  const hasInventory: boolean =
    !isInventoryLoading && !inventoryError && inventory.length > 0;

  /*
   * Where the pool stands with the Xen Orchestra it is read from: one
   * reading for the pill, the line under the name and the card under the
   * hero (getXcpNgPoolConnection).
   */
  const connection: XcpNgPoolConnection = getXcpNgPoolConnection({
    pool: pool,
    translator: translator,
    now: now,
  });
  const isConnected: boolean = connection.isConnected;

  /*
   * What needs attention, most urgent first (XcpNgHealth): the same rules
   * the part pages, the lists and the Topology use, so the health pill,
   * this list and a host's page can never disagree.
   */
  const attentionItems: Array<ResourceAttentionItem> = hasInventory
    ? getXcpNgAttentionItems({
        rows: inventory,
        routeFor: routes.getPartRoute,
        now: now,
        // HA, backup jobs and what a probe could not read: the pool's own.
        pool: pool,
        translator: translator,
      })
    : [];
  const poolHealth: ResourceHealth = getXcpNgPoolHealth(attentionItems);

  /*
   * The parts each count of what is wrong is about, while the pool is
   * read: a disconnected pool's last inventory is no longer the truth.
   */
  const problemPill: (
    problem: XcpNgProblem,
    testId: string,
  ) => ResourceAttentionPillProps | undefined = (
    problem: XcpNgProblem,
    testId: string,
  ): ResourceAttentionPillProps | undefined => {
    if (!hasInventory || !isConnected) {
      return undefined;
    }
    return getXcpNgProblemPill({
      problem: problem,
      items: getXcpNgProblemItems({
        rows: inventory,
        problem: problem,
        routeFor: routes.getPartRoute,
        now: now,
        staleMs: XCP_NG_METRIC_STALE_MS,
        translator: translator,
      }),
      translator: translator,
      testId: testId,
    });
  };

  const hostsOffline: ResourceAttentionPillProps | undefined = problemPill(
    { kind: "hostsOffline" },
    "xcp-ng-hosts-offline",
  );
  const hostsDisabled: ResourceAttentionPillProps | undefined = problemPill(
    { kind: "hostsDisabled" },
    "xcp-ng-hosts-disabled",
  );
  const vmsStopped: ResourceAttentionPillProps | undefined = problemPill(
    { kind: "vmsStopped" },
    "xcp-ng-vms-stopped",
  );
  const storageFull: ResourceAttentionPillProps | undefined = problemPill(
    { kind: "storageFull" },
    "xcp-ng-storage-full",
  );
  const storageOverAllocated: ResourceAttentionPillProps | undefined =
    problemPill({ kind: "storageOverAllocated" }, "xcp-ng-storage-over");

  /*
   * The pool's parts counted: from the inventory once it is read, from the
   * pool's own row (which the ingest recounts from the same rows) before.
   */
  const hostSummary: XcpNgHostSummary = hasInventory
    ? summarizeXcpNgHosts(inventory)
    : {
        total: toXcpNgNumber(pool.hostCount) || 0,
        running: toXcpNgNumber(pool.runningHostCount) || 0,
        offline: 0,
        disabled: toXcpNgNumber(pool.disabledHostCount) || 0,
      };
  const vmSummary: XcpNgVmSummary = hasInventory
    ? summarizeXcpNgVms(inventory)
    : {
        total: toXcpNgNumber(pool.vmCount) || 0,
        running: toXcpNgNumber(pool.runningVmCount) || 0,
        halted: 0,
        paused: 0,
        suspended: 0,
        controlDomains: 0,
      };
  const storageSummary: XcpNgStorageSummary = hasInventory
    ? summarizeXcpNgStorage(inventory)
    : {
        repositories: toXcpNgNumber(pool.storageRepositoryCount) || 0,
        vmDiskRepositories: 0,
        capacityBytes: toXcpNgNumber(pool.storageCapacityBytes) || 0,
        usedBytes: toXcpNgNumber(pool.storageUsedBytes) || 0,
      };
  const storageUsage: StorageUsage | null = getStorageUsage(
    {
      capacity: storageSummary.capacityBytes,
      used: storageSummary.usedBytes,
    },
    XCP_NG_STORAGE_USAGE_THRESHOLDS,
  );

  const renderRefreshControl: () => ReactElement = (): ReactElement => {
    return (
      <AutoRefreshControl
        autoRefreshInterval={autoRefresh.autoRefreshInterval}
        onAutoRefreshIntervalChange={autoRefresh.setAutoRefreshInterval}
        onManualRefresh={refresh}
        isRefreshing={isRefreshing}
        lastRefreshedAt={lastRefreshedAt}
      />
    );
  };

  const renderHero: () => ReactElement = (): ReactElement => {
    const lastSeenAt: Date | undefined = pool.lastSeenAt;
    /*
     * One whole sentence each: a pool Xen Orchestra stopped reporting while
     * its agent runs says so, which is what happened; an English "never"
     * in a translated "Last seen {{time}}" would read in two languages.
     */
    const lastSeenText: string = !lastSeenAt
      ? tx("Never seen")
      : connection.state === ResourceConnectionState.ReadingStopped
        ? translator.translateTemplate(
            "Xen Orchestra stopped reporting this pool {{time}}",
            { time: OneUptimeDate.fromNow(lastSeenAt) },
          )
        : translator.translateTemplate("Last seen {{time}}", {
            time: OneUptimeDate.fromNow(lastSeenAt),
          });

    const displayName: string =
      (pool.name as string | undefined) || tx("Untitled XCP-ng pool");

    const connectionLabel: string = getResourceConnectionLabel({
      translator: translator,
      isConnected: isConnected,
      status: pool.otelCollectorStatus as string | undefined,
      connectionState: connection.state,
    });

    /*
     * Where the pool is read from: the Xen Orchestra its agent reads, and
     * the agent's version (which says when it is outdated, and how to
     * upgrade it).
     */
    const xenOrchestraName: string = (pool.xenOrchestraName || "").trim();
    const hasAgentVersion: boolean = Boolean(pool.agentVersion);
    const xenOrchestraSlot: ReactElement = (
      <span className="font-medium text-gray-700">
        <bdi>{xenOrchestraName}</bdi>
      </span>
    );
    const agentSlot: ReactElement = (
      <AgentVersion
        kind={AgentKind.XcpNgAgent}
        version={pool.agentVersion}
        setupGuideRoute={routes.documentationRoute}
      />
    );
    const readByConnection: boolean =
      pool.collectionMethod === XcpNgCollectionMethod.Probe &&
      Boolean(pool.xcpNgConnectionId);
    const connectionSlot: ReactElement = (
      <AppLink
        to={RouteUtil.populateRouteParams(
          RouteMap[PageMap.XCP_NG_CONNECTION_VIEW] as Route,
          {
            modelId: new ObjectID(
              pool.xcpNgConnectionId ? pool.xcpNgConnectionId.toString() : "",
            ),
          },
        )}
        className="font-medium text-gray-700 hover:underline"
      >
        <bdi>
          {pool.xcpNgConnection?.name ||
            xenOrchestraName ||
            tx("its connection")}
        </bdi>
      </AppLink>
    );
    const provenance: ReactElement | null = readByConnection ? (
      <TranslatedSentence
        template="Read by a probe through {{connection}}"
        slots={{ connection: connectionSlot }}
      />
    ) : xenOrchestraName && hasAgentVersion ? (
      <TranslatedSentence
        template="Read from Xen Orchestra {{xenOrchestra}} by the XCP-ng Agent {{version}}"
        slots={{ xenOrchestra: xenOrchestraSlot, version: agentSlot }}
      />
    ) : xenOrchestraName ? (
      <TranslatedSentence
        template="Read from Xen Orchestra {{xenOrchestra}}"
        slots={{ xenOrchestra: xenOrchestraSlot }}
      />
    ) : hasAgentVersion ? (
      <TranslatedSentence
        template="Read by the XCP-ng Agent {{version}}"
        slots={{ version: agentSlot }}
      />
    ) : null;

    /*
     * The count chips open their list: the Overview's one step to the
     * hosts, the VMs and the storage (the side menu has the rest).
     */
    const chips: Array<CountChip> = [];
    if (hostSummary.total > 0) {
      chips.push({
        key: "hosts",
        icon: IconProp.ServerStack,
        route: routes.hostsRoute,
        label: translator.translatePlural(
          {
            one: "{{running}}/{{count}} host running",
            other: "{{running}}/{{count}} hosts running",
          },
          hostSummary.total,
          // In the reader's digits, as the count beside it is.
          { running: translator.formatNumber(hostSummary.running) },
        ),
        problems: [
          ...(hostsOffline
            ? [{ ...hostsOffline, testId: "xcp-ng-hero-hosts-offline" }]
            : []),
          ...(hostsDisabled
            ? [{ ...hostsDisabled, testId: "xcp-ng-hero-hosts-disabled" }]
            : []),
        ],
      });
    }
    if (vmSummary.total > 0) {
      chips.push({
        key: "vms",
        icon: IconProp.Cube,
        route: routes.vmsRoute,
        label: translator.translatePlural(
          {
            one: "{{running}}/{{count}} VM running",
            other: "{{running}}/{{count}} VMs running",
          },
          vmSummary.total,
          { running: translator.formatNumber(vmSummary.running) },
        ),
        problems: vmsStopped
          ? [{ ...vmsStopped, testId: "xcp-ng-hero-vms-stopped" }]
          : [],
      });
    }
    if (storageSummary.repositories > 0) {
      chips.push({
        key: "storage",
        icon: IconProp.Database,
        route: routes.storageRoute,
        label: translator.translatePlural(
          {
            one: "{{count}} storage repository",
            other: "{{count}} storage repositories",
          },
          storageSummary.repositories,
        ),
        problems: [
          ...(storageFull
            ? [{ ...storageFull, testId: "xcp-ng-hero-storage-full" }]
            : []),
          ...(storageOverAllocated
            ? [
                {
                  ...storageOverAllocated,
                  testId: "xcp-ng-hero-storage-over",
                },
              ]
            : []),
        ],
      });
    }

    return (
      <div className="relative mb-6 rounded-xl border border-gray-200 bg-white shadow-sm">
        {/*
         * `overflow-hidden` belongs on the gradient layer, not the card
         * itself: the agent version's dialog and the auto-refresh menu
         * open out of the hero and would be clipped by its rounded bounds.
         */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-xl">
          <div
            className="absolute inset-x-0 top-0 h-24 bg-gradient-to-br from-violet-50 via-white to-white"
            aria-hidden="true"
          />
        </div>
        <div className="relative">
          <div className="relative px-6 py-5">
            <div
              data-testid={RESOURCE_HERO_TOP_ROW_TEST_ID}
              className={RESOURCE_HERO_TOP_ROW_CLASS_NAME}
            >
              <div
                data-testid={RESOURCE_HERO_IDENTITY_TEST_ID}
                className={RESOURCE_HERO_IDENTITY_CLASS_NAME}
              >
                <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-lg bg-white shadow-sm ring-1 ring-inset ring-violet-200">
                  <Icon
                    icon={IconProp.XcpNg}
                    className="h-6 w-6 text-violet-600"
                  />
                </div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <h1 className="truncate text-xl font-semibold text-gray-900">
                      {displayName}
                    </h1>
                    <span className="inline-flex items-center gap-1">
                      <span
                        data-testid="xcp-ng-hero-connection"
                        data-state={connection.state}
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${connection.badgeClassName}`}
                      >
                        <span
                          className={`h-1.5 w-1.5 rounded-full ${connection.dotClassName}`}
                        />
                        {connectionLabel}
                      </span>
                      <InfoTooltip
                        label="Connection"
                        text={XCP_NG_PAGE_DESCRIPTIONS.connection}
                      />
                    </span>
                    {/*
                     * A pool that has reported no host, VM or storage
                     * repository yet has no health to tell: "Healthy" there
                     * would be a guess.
                     */}
                    {hasInventory ? (
                      <span className="inline-flex items-center gap-1">
                        {/*
                         * Health Unknown in grey while the pool is not read
                         * (its last inventory is stale); Degraded or
                         * Unhealthy opens why (ResourceHealthPill).
                         */}
                        <ResourceHealthPill
                          health={poolHealth}
                          isConnected={isConnected}
                          items={attentionItems}
                          testId="xcp-ng-hero-health"
                          words={XCP_NG_HEALTH_WORDS}
                        />
                        <InfoTooltip
                          label="Pool Health"
                          text={XCP_NG_PAGE_DESCRIPTIONS.poolHealth}
                        />
                      </span>
                    ) : (
                      <></>
                    )}
                  </div>
                  <ResourceHeroDescription
                    text={pool.description as string | undefined}
                  />
                  <div
                    className="mt-1 text-xs text-gray-500"
                    data-testid="xcp-ng-hero-last-seen"
                  >
                    {lastSeenText}
                  </div>
                  {provenance ? (
                    <div
                      className="mt-1 text-xs text-gray-500"
                      data-testid="xcp-ng-hero-provenance"
                    >
                      {provenance}
                    </div>
                  ) : (
                    <></>
                  )}
                </div>
              </div>
              <div
                data-testid={RESOURCE_HERO_CONTROLS_TEST_ID}
                className={RESOURCE_HERO_CONTROLS_CLASS_NAME}
              >
                {renderRefreshControl()}
              </div>
            </div>

            {chips.length > 0 ? (
              <div
                className="mt-4 flex flex-wrap items-center gap-1.5"
                data-testid="xcp-ng-hero-chips"
              >
                {chips.map((chip: CountChip): ReactElement => {
                  return (
                    <React.Fragment key={chip.key}>
                      <Link
                        to={chip.route}
                        dataTestId={`xcp-ng-hero-${chip.key}`}
                        className="inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-gray-50 px-2 py-1 text-xs text-gray-700 hover:border-indigo-300 hover:bg-indigo-50 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                      >
                        <Icon
                          icon={chip.icon}
                          className="h-3 w-3 text-gray-500"
                        />
                        <span className="font-medium">{chip.label}</span>
                      </Link>
                      {/* What is wrong among them: it opens which, and why. */}
                      {chip.problems.map(
                        (problem: ResourceAttentionPillProps): ReactElement => {
                          return (
                            <ResourceAttentionPill
                              key={problem.testId}
                              {...problem}
                            />
                          );
                        },
                      )}
                    </React.Fragment>
                  );
                })}
                <InfoTooltip
                  label="Pool inventory counts"
                  text={XCP_NG_METRIC_DESCRIPTIONS.poolInventoryCounts}
                />
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderTiles: () => ReactElement = (): ReactElement => {
    const hostsPercent: number | null =
      hostSummary.total > 0
        ? (hostSummary.running / hostSummary.total) * 100
        : null;
    const vmsPercent: number | null =
      vmSummary.total > 0 ? (vmSummary.running / vmSummary.total) * 100 : null;

    return (
      <div
        className={`mb-6 ${XCP_NG_TILES_GRID_CLASS_NAME}`}
        data-testid="xcp-ng-tiles"
      >
        <GoldenMetricTile
          title="Hosts"
          icon={IconProp.ServerStack}
          iconColor="violet"
          value={
            hostSummary.total > 0
              ? // In the reader's digits, as the hero's chips write them.
                `${translator.formatNumber(hostSummary.running)}/${translator.formatNumber(hostSummary.total)}`
              : undefined
          }
          sublabel={
            hostSummary.disabled > 0
              ? translator.translatePlural(
                  {
                    one: "running · {{count}} disabled",
                    other: "running · {{count}} disabled",
                  },
                  hostSummary.disabled,
                )
              : tx("running")
          }
          percent={hostsPercent}
          thresholds={{ warn: 99, danger: 51 }}
          higherIsBetter={true}
          description={XCP_NG_METRIC_DESCRIPTIONS.hostAvailability}
          // Which hosts are offline, else which are disabled, and why.
          attention={
            hostsOffline
              ? { ...hostsOffline, testId: "xcp-ng-tile-hosts-offline" }
              : hostsDisabled
                ? { ...hostsDisabled, testId: "xcp-ng-tile-hosts-disabled" }
                : undefined
          }
        />
        <GoldenMetricTile
          title="VMs"
          icon={IconProp.Cube}
          iconColor="sky"
          value={
            vmSummary.total > 0
              ? `${translator.formatNumber(vmSummary.running)}/${translator.formatNumber(vmSummary.total)}`
              : undefined
          }
          sublabel={tx("running")}
          percent={vmsPercent}
          /*
           * A VM halted on purpose is no problem: the bar turns amber only
           * while a VM stopped after running, as Needs attention says.
           */
          tone={
            vmsPercent === null
              ? undefined
              : vmsStopped
                ? "warning"
                : "positive"
          }
          description={XCP_NG_METRIC_DESCRIPTIONS.vmsRunning}
          attention={
            vmsStopped
              ? { ...vmsStopped, testId: "xcp-ng-tile-vms-stopped" }
              : undefined
          }
        />
        <GoldenMetricTile
          title="Storage"
          icon={IconProp.Database}
          iconColor="amber"
          value={
            storageUsage
              ? formatStorageUsedPercent(storageUsage, translator.language)
              : undefined
          }
          sublabel={
            storageUsage
              ? translator.translateTemplate("{{used}} of {{total}}", {
                  used: formatStorageBytes(
                    storageUsage.used,
                    translator.language,
                  ),
                  total: formatStorageBytes(
                    storageUsage.capacity,
                    translator.language,
                  ),
                })
              : tx("of the storage holding VM disks")
          }
          percent={storageUsage ? storageUsage.usedPercent : null}
          tone={
            storageUsage
              ? STORAGE_USAGE_TILE_TONES[storageUsage.level]
              : undefined
          }
          description={XCP_NG_METRIC_DESCRIPTIONS.storageUsed}
          attention={
            storageFull
              ? { ...storageFull, testId: "xcp-ng-tile-storage-full" }
              : undefined
          }
        />
      </div>
    );
  };

  const renderBusiest: () => ReactElement = (): ReactElement => {
    // Nothing runs: nothing to rank.
    if (vmSummary.running === 0 && hostSummary.running === 0) {
      return <></>;
    }

    const busiest: (
      kind: XcpNgResourceKind.Host | XcpNgResourceKind.VM,
      rankBy: "cpu" | "memory",
    ) => Array<XcpNgBusyPart> = (
      kind: XcpNgResourceKind.Host | XcpNgResourceKind.VM,
      rankBy: "cpu" | "memory",
    ): Array<XcpNgBusyPart> => {
      return getXcpNgBusiestParts({
        rows: inventory,
        kind: kind,
        now: now,
        staleMs: XCP_NG_METRIC_STALE_MS,
        limit: XCP_NG_BUSIEST_SHOWN,
        rankBy: rankBy,
      });
    };

    /*
     * Each card as wide as the page, its CPU and memory rankings side by
     * side, as a Proxmox cluster's top consumers are: two rankings in half
     * a page would leave a VM's name a few letters wide.
     */
    return (
      <div data-testid="xcp-ng-busiest">
        {vmSummary.running > 0 ? (
          <div className="mb-6">
            <XcpNgBusiestCard
              testId="xcp-ng-busiest-vms"
              title="Busiest VMs"
              description="The running VMs using the most CPU, and the most memory, at their latest report, with the host each one runs on."
              showHost={true}
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
                parts: busiest(XcpNgResourceKind.VM, "cpu"),
                emptyMessage:
                  "No running VM has reported its CPU in the last 15 minutes.",
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
                parts: busiest(XcpNgResourceKind.VM, "memory"),
                emptyMessage:
                  "No running VM reports the memory it uses: that needs its guest tools.",
              }}
              getRoute={(part: XcpNgBusyPart): Route => {
                return routes.getPartRoute("VM", part.row.externalId || "");
              }}
              allLabel={translator.translatePlural(
                { one: "View {{count}} VM", other: "View all {{count}} VMs" },
                vmSummary.total,
              )}
              allRoute={routes.vmsRoute}
            />
          </div>
        ) : (
          <></>
        )}
        {hostSummary.running > 0 ? (
          <div className="mb-6">
            <XcpNgBusiestCard
              testId="xcp-ng-busiest-hosts"
              title="Busiest Hosts"
              description="The running hosts using the most CPU, and the most memory, at their latest report."
              cpu={{
                title: "CPU Usage",
                description: XCP_NG_PAGE_DESCRIPTIONS.topHostsByCpu,
                subtitle: translator.translatePlural(
                  {
                    one: "Top {{count}} host by CPU",
                    other: "Top {{count}} hosts by CPU",
                  },
                  XCP_NG_BUSIEST_SHOWN,
                ),
                parts: busiest(XcpNgResourceKind.Host, "cpu"),
                emptyMessage:
                  "No running host has reported its CPU in the last 15 minutes.",
              }}
              memory={{
                title: "Memory Usage",
                description: XCP_NG_PAGE_DESCRIPTIONS.topHostsByMemory,
                subtitle: translator.translatePlural(
                  {
                    one: "Top {{count}} host by memory",
                    other: "Top {{count}} hosts by memory",
                  },
                  XCP_NG_BUSIEST_SHOWN,
                ),
                parts: busiest(XcpNgResourceKind.Host, "memory"),
                emptyMessage:
                  "No running host has reported its memory in the last 15 minutes.",
              }}
              getRoute={(part: XcpNgBusyPart): Route => {
                return routes.getPartRoute("Host", part.row.externalId || "");
              }}
              allLabel={translator.translatePlural(
                {
                  one: "View {{count}} host",
                  other: "View all {{count}} hosts",
                },
                hostSummary.total,
              )}
              allRoute={routes.hostsRoute}
            />
          </div>
        ) : (
          <></>
        )}
      </div>
    );
  };

  const isBackupsRead: boolean = isXcpNgBackupsRead(pool);

  const renderBackups: () => ReactElement = (): ReactElement => {
    return (
      <XcpNgBackupsCard
        pool={pool}
        rows={inventory}
        vmsRoute={routes.vmsRoute}
        setupRoute={routes.documentationRoute}
        routeFor={routes.getPartRoute}
        now={now}
      />
    );
  };

  /*
   * A pool Xen Orchestra reports with nothing in it yet - in the minute
   * after it was added - says what comes, rather than a page of zeros. A
   * pool that is not read has the card under the hero to say how to
   * connect it instead.
   */
  const isWaitingForInventory: boolean =
    !isInventoryLoading &&
    !inventoryError &&
    inventory.length === 0 &&
    isConnected;

  return (
    <div data-testid="xcp-ng-overview">
      {renderHero()}

      {/*
       * How to connect it, while it is not connected: the agent's guide, or
       * - for a pool a probe reads - its connection, whose page says why.
       */}
      {pool.collectionMethod === XcpNgCollectionMethod.Probe ? (
        <XcpNgPoolProbeNotice pool={pool} isConnected={isConnected} />
      ) : (
        <ResourceConnectionGuideCard
          status={pool.otelCollectorStatus as string | undefined}
          lastSeenAt={pool.lastSeenAt}
          agentLastSeenAt={pool.agentLastSeenAt}
          guide={getXcpNgPoolConnectionGuide(
            pool.poolIdentifier || "",
            getConfiguredOneUptimeUrl(),
          )}
          documentationRoute={routes.documentationRoute}
        />
      )}

      {/*
       * What needs someone, most urgent first - while the pool is read: a
       * disconnected pool's last inventory is no longer the truth, and the
       * hero says Health Unknown instead.
       */}
      {isConnected && hasInventory ? (
        <NeedsAttentionCard
          testId="xcp-ng-needs-attention"
          items={attentionItems}
        />
      ) : (
        <></>
      )}

      {inventoryError ? (
        <div className="mb-6">
          <ErrorMessage message={inventoryError} />
        </div>
      ) : (
        <></>
      )}

      {isWaitingForInventory ? (
        <div
          className="mb-6 rounded-xl border border-gray-200 bg-white shadow-sm"
          data-testid="xcp-ng-waiting-for-inventory"
        >
          <EmptyState
            id="xcp-ng-waiting-for-inventory"
            icon={IconProp.XcpNg}
            title="No hosts, VMs or storage repositories yet"
            description="Xen Orchestra reports this pool. Its hosts, VMs and storage repositories appear here within a minute or two of its next report."
          />
        </div>
      ) : (
        <></>
      )}

      {/* The tiles' shape while the inventory loads, so nothing jumps. */}
      {isInventoryLoading && !rows ? (
        <StatTilesSkeleton
          className="mb-6"
          count={3}
          kind="golden"
          gridClassName={XCP_NG_TILES_GRID_CLASS_NAME}
        />
      ) : (
        <></>
      )}

      {hasInventory ? (
        <>
          {renderTiles()}
          {/*
           * HA and backups a probe reads from Xen Orchestra (#10997), under
           * the tiles: is the pool safe from a host failure, and was it
           * backed up last night? A pool no probe reads backups for says
           * how to see them at the foot of the page instead.
           */}
          <XcpNgHighAvailabilityCard
            pool={pool}
            rows={inventory}
            getHostRoute={(externalId: string): Route => {
              return routes.getPartRoute("Host", externalId);
            }}
          />
          {isBackupsRead ? renderBackups() : <></>}
          {renderBusiest()}
          <XcpNgHostsCard
            rows={inventory}
            getHostRoute={(externalId: string): Route => {
              return routes.getPartRoute("Host", externalId);
            }}
            hostsRoute={routes.hostsRoute}
            now={now}
            masterHostExternalId={pool.masterHostExternalId || undefined}
          />
          <XcpNgStorageRepositoriesCard
            rows={inventory}
            getStorageRoute={(externalId: string): Route => {
              return routes.getPartRoute("StorageRepository", externalId);
            }}
            storageRoute={routes.storageRoute}
          />
          {isBackupsRead ? <></> : renderBackups()}
        </>
      ) : (
        <></>
      )}

      <ResourceActivityCards
        modelId={modelId}
        resourceQueryKey="xcpNgPools"
        refreshToken={lastRefreshedAt ? lastRefreshedAt.getTime() : undefined}
        incidentsRoute={routes.incidentsRoute}
        alertsRoute={routes.alertsRoute}
        scheduledMaintenanceRoute={routes.scheduledMaintenanceRoute}
      />

      {/*
       * What the pool's agent reported about it, and only that
       * (ResourceRecordDetailsCard): its name, description and when it was
       * last seen are the hero's. Edited on its Settings page, in the card
       * of the same title.
       */}
      <ResourceRecordDetailsCard<XcpNgPool>
        modelType={XcpNgPool}
        modelId={modelId}
        id="xcp-ng-pool-overview"
        title="Pool Details"
        refresher={detailsRefresher}
        settingsRoute={RouteUtil.populateRouteParams(
          RouteMap[PageMap.XCP_NG_POOL_VIEW_SETTINGS] as Route,
          { modelId: modelId },
        )}
        facts={[
          // The UUID its telemetry is matched by (resource.xcp_ng.pool.id).
          {
            field: {
              poolIdentifier: true,
            },
            title: "Pool UUID",
            fieldType: FieldType.Text,
          },
          {
            field: {
              xenOrchestraName: true,
            },
            title: "Xen Orchestra",
            fieldType: FieldType.Text,
          },
          {
            field: {
              reportedName: true,
            },
            title: "Name in Xen Orchestra",
            fieldType: FieldType.Text,
          },
          {
            field: {
              agentVersion: true,
            },
            title: "Agent Version",
            fieldType: FieldType.Element,
            getElement: (item: XcpNgPool): ReactElement => {
              return (
                <AgentVersion
                  kind={AgentKind.XcpNgAgent}
                  version={item.agentVersion}
                  setupGuideRoute={routes.documentationRoute}
                />
              );
            },
          },
        ]}
      />
    </div>
  );
};

export default XcpNgPoolOverview;
