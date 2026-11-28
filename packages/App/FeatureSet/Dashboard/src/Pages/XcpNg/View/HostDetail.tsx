import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import OneUptimeDate from "Common/Types/Date";
import XcpNgPool from "Common/Models/DatabaseModels/XcpNgPool";
import XcpNgResource from "Common/Models/DatabaseModels/XcpNgResource";
import XcpNgResourceKind from "Common/Types/XcpNg/XcpNgResourceKind";
import Card from "Common/UI/Components/Card/Card";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Route from "Common/Types/API/Route";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import XcpNgPartHero from "../../../Components/XcpNg/Part/XcpNgPartHero";
import XcpNgHostOverview from "../../../Components/XcpNg/Part/XcpNgHostOverview";
import XcpNgPartReadError from "../../../Components/XcpNg/Part/XcpNgPartReadError";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import {
  XcpNgPartCharts,
  getXcpNgHostCharts,
} from "../../../Components/XcpNg/XcpNgPartCharts";
import {
  XCP_NG_STORAGE_USAGE_COLUMNS,
  XCP_NG_VM_COLUMN_DESCRIPTIONS,
  getXcpNgStorageColumns,
  getXcpNgVmColumns,
  toXcpNgListResource,
} from "../../../Components/XcpNg/XcpNgResourceColumns";
import {
  externalIdFromRouteParam,
  getXcpNgDisplayName,
} from "../Utils/XcpNgResourceUtils";
import {
  fetchXcpNgInventoryRow,
  fetchXcpNgRowsOnHost,
} from "../../../Components/XcpNg/XcpNgInventoryReads";
import {
  XcpNgRowsOnHost,
  getXcpNgRowsOnHost,
  summarizeXcpNgVms,
} from "../Utils/XcpNgPartFacts";
import { getXcpNgPartAttention } from "../Utils/XcpNgPartAttention";

/*
 * An XCP-ng host inside its pool: the hero says which host it is, its state
 * (a disabled one in grey) and what it runs; the tabs hold its Overview
 * (what needs attention on it, its load, what is open on it, its busiest
 * VMs, its alerts and what Xen Orchestra reports about it), its VMs, its
 * local storage repositories and its charts.
 */

export const XCP_NG_HOST_TAB_OVERVIEW: string = "Overview";
export const XCP_NG_HOST_TAB_VMS: string = "VMs";
export const XCP_NG_HOST_TAB_STORAGE: string = "Storage";
export const XCP_NG_HOST_TAB_METRICS: string = "Metrics";

const XcpNgPoolHostDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Route shape: .../xcp-ng/:modelId/hosts/:subModelId - subModelId is the
   * host's XAPI UUID, not a database id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [row, setRow] = useState<XcpNgResource | null>(null);
  const [hostRows, setHostRows] = useState<Array<XcpNgResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  /*
   * Why the host's inventory could not be read, until a read succeeds: the
   * Overview and both lists say so, with a way to read again, instead of
   * "not reported" about a pool that may be read fine.
   */
  const [inventoryError, setInventoryError] = useState<string>("");
  const hasReadInventory: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  const [error, setError] = useState<string>("");
  const [refreshToken, setRefreshToken] = useState<number>(0);

  /*
   * "View all VMs" on the Overview opens the VMs tab: Tabs keeps its own
   * selection, so it is mounted again on that tab.
   */
  const [tabsKey, setTabsKey] = useState<number>(0);
  const [initialTabName, setInitialTabName] = useState<string>(
    XCP_NG_HOST_TAB_OVERVIEW,
  );

  // Only the newest inventory read may commit.
  const inventorySequence: React.MutableRefObject<number> = useRef<number>(0);

  const fetchInventory: PromiseVoidFunction = async (): Promise<void> => {
    const sequence: number = ++inventorySequence.current;
    try {
      const [inventoryRow, rowsOnHost]: [
        XcpNgResource | null,
        Array<XcpNgResource>,
      ] = await Promise.all([
        fetchXcpNgInventoryRow({
          xcpNgPoolId: modelId,
          kind: XcpNgResourceKind.Host,
          externalId: externalId,
          // The updates Xen Orchestra says it misses (#10997).
          extraSelect: { missingPatches: true },
        }),
        fetchXcpNgRowsOnHost({
          xcpNgPoolId: modelId,
          hostExternalId: externalId,
        }),
      ]);
      if (sequence !== inventorySequence.current) {
        return;
      }
      hasReadInventory.current = true;
      setRow(inventoryRow);
      setHostRows(rowsOnHost);
      setInventoryError("");
    } catch (err) {
      if (sequence !== inventorySequence.current) {
        return;
      }
      if (!hasReadInventory.current) {
        setInventoryError(API.getFriendlyMessage(err));
      }
    }
    setIsLoadingRow(false);
  };

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: XcpNgPool | null = await ModelAPI.getItem({
        modelType: XcpNgPool,
        id: modelId,
        select: {
          name: true,
          poolIdentifier: true,
          // Whether this host is the pool master, as a probe read it.
          masterHostExternalId: true,
        },
      });
      setPool(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);

    await fetchInventory();
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  const refresh: () => void = (): void => {
    setRefreshToken(Date.now());
    fetchInventory().catch(() => {
      // The page keeps what it showed; the next refresh tries again.
    });
  };

  // Refresh after a failed read: the loader while it reads again.
  const retryInventory: () => void = (): void => {
    setIsLoadingRow(true);
    refresh();
  };

  if (isLoading) {
    return <PageSkeleton />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!pool) {
    return <ErrorMessage message="Pool not found." />;
  }

  const poolName: string = pool.name || "";
  const poolIdentifier: string = pool.poolIdentifier || "";
  const routes: XcpNgPartRoutes = getXcpNgPartRoutes(modelId);
  const now: Date = OneUptimeDate.getCurrentDate();
  const hostName: string = getXcpNgDisplayName(row, externalId);

  // What the host holds: its VMs (control domain apart) and its storage.
  const onHost: XcpNgRowsOnHost = getXcpNgRowsOnHost(hostRows, externalId);
  /*
   * What needs attention on the host, its VMs and its storage, read once:
   * the Overview's card lists it, and the hero's state opens it.
   */
  const attention: ResourcePartAttention = getXcpNgPartAttention({
    kind: "Host",
    externalId: externalId,
    row: row,
    hostRows: [...onHost.vms, ...onHost.storageRepositories],
    routeFor: routes.getPartRoute,
    now: now,
  });
  const vmResources: Array<InfrastructureResource> = onHost.vms.map(
    (vm: XcpNgResource): InfrastructureResource => {
      return toXcpNgListResource(vm, { now: now, translator: translator });
    },
  );
  const storageResources: Array<InfrastructureResource> =
    onHost.storageRepositories.map(
      (repository: XcpNgResource): InfrastructureResource => {
        return toXcpNgListResource(repository, {
          now: now,
          translator: translator,
        });
      },
    );
  const charts: XcpNgPartCharts = getXcpNgHostCharts({
    poolIdentifier: poolIdentifier,
    hostExternalId: externalId,
    translator: translator,
  });

  const showVms: () => void = (): void => {
    setInitialTabName(XCP_NG_HOST_TAB_VMS);
    setTabsKey((key: number): number => {
      return key + 1;
    });
  };

  const tabs: Array<Tab> = [
    {
      name: XCP_NG_HOST_TAB_OVERVIEW,
      children: isLoadingRow ? (
        <PageSkeleton />
      ) : inventoryError ? (
        <XcpNgPartReadError
          kind="Host"
          message={inventoryError}
          onRetry={retryInventory}
        />
      ) : (
        <XcpNgHostOverview
          poolId={modelId}
          poolName={poolName}
          poolIdentifier={poolIdentifier}
          externalId={externalId}
          row={row}
          hostRows={hostRows}
          attention={attention}
          routes={routes}
          onShowVms={showVms}
          now={now}
          refreshToken={refreshToken}
          isPoolMaster={
            Boolean(pool.masterHostExternalId) &&
            (pool.masterHostExternalId || "").toLowerCase() ===
              externalId.toLowerCase()
          }
        />
      ),
    },
    {
      name: XCP_NG_HOST_TAB_VMS,
      countBadge: onHost.vms.length,
      children: (
        <ResourceTable
          onRefreshClick={refresh}
          title="VMs"
          description="The VMs this host runs, and the ones that last ran on it, with how busy each one is."
          resources={vmResources}
          isLoading={isLoadingRow}
          error={inventoryError}
          showGroupColumn={false}
          builtInColumnDescriptions={XCP_NG_VM_COLUMN_DESCRIPTIONS}
          metricThresholds={{
            cpu: { warning: 80, danger: 90 },
            memory: { warning: 85, danger: 95 },
          }}
          tableIdPrefix="xcp-ng-host-vms"
          emptyMessage="No VMs on this host yet."
          columns={getXcpNgVmColumns({ resources: vmResources })}
          getViewRoute={(resource: InfrastructureResource): Route => {
            return routes.getPartRoute(
              "VM",
              resource.additionalAttributes["externalId"] || "",
            );
          }}
        />
      ),
    },
    {
      name: XCP_NG_HOST_TAB_STORAGE,
      countBadge: onHost.storageRepositories.length,
      children: (
        <ResourceTable
          onRefreshClick={refresh}
          title="Local Storage Repositories"
          description="The storage repositories only this host can use, and how full each one is. The pool's shared storage repositories are on its Storage page."
          resources={storageResources}
          isLoading={isLoadingRow}
          error={inventoryError}
          showGroupColumn={false}
          showStatus={false}
          showResourceMetrics={false}
          tableIdPrefix="xcp-ng-host-storage"
          emptyMessage="No local storage repositories on this host yet."
          storageUsageColumns={XCP_NG_STORAGE_USAGE_COLUMNS}
          columns={getXcpNgStorageColumns({
            rows: hostRows,
            resources: storageResources,
            translator: translator,
            showVirtualDisks: false,
          })}
          getViewRoute={(resource: InfrastructureResource): Route => {
            return routes.getPartRoute(
              "StorageRepository",
              resource.additionalAttributes["externalId"] || "",
            );
          }}
        />
      ),
    },
    {
      name: XCP_NG_HOST_TAB_METRICS,
      children: (
        <Card
          title={translator.translateTemplate("Host Metrics: {{hostName}}", {
            hostName: hostName,
          })}
          description="CPU, load, memory, network per interface, disk I/O per storage repository and power for this host over the selected time range."
        >
          <ResourceMetricsTab
            queryConfigs={charts.queryConfigs}
            formulaConfigs={charts.formulaConfigs}
          />
        </Card>
      ),
    },
  ];

  return (
    <div data-testid="xcp-ng-host-page">
      <XcpNgPartHero
        kind="Host"
        row={row}
        externalId={externalId}
        poolName={poolName}
        routes={routes}
        vmSummary={summarizeXcpNgVms(onHost.vms)}
        attention={attention}
        now={now}
      />
      {/*
       * The tab row wraps on a phone, so Metrics is never out of sight past
       * the edge of the screen.
       */}
      <Tabs
        label="Host"
        key={tabsKey}
        tabs={tabs}
        initialTabName={initialTabName}
        wrap={true}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default XcpNgPoolHostDetail;
