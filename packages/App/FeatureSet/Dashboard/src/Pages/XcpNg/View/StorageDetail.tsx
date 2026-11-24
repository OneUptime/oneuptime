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
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import ResourceMetricsTab from "../../../Components/Infrastructure/ResourceMetricsTab";
import { ResourcePartAttention } from "../../../Components/ResourcePart/ResourcePartTypes";
import XcpNgPartHero from "../../../Components/XcpNg/Part/XcpNgPartHero";
import XcpNgStorageOverview from "../../../Components/XcpNg/Part/XcpNgStorageOverview";
import XcpNgPartReadError from "../../../Components/XcpNg/Part/XcpNgPartReadError";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import {
  XcpNgPartCharts,
  getXcpNgStorageCharts,
} from "../../../Components/XcpNg/XcpNgPartCharts";
import {
  externalIdFromRouteParam,
  fetchXcpNgInventoryRow,
  fetchXcpNgVirtualDisks,
  getXcpNgDisplayName,
} from "../Utils/XcpNgResourceUtils";
import { getXcpNgPartAttention } from "../Utils/XcpNgPartAttention";

/*
 * An XCP-ng storage repository inside its pool: the hero says which one it
 * is, whether it is shared or local to a host, how full it is, its type and
 * what it holds; the Overview what about it needs attention, its fill bar,
 * what is allocated on it, its virtual disks and whose each one is, what is
 * open on it, its alerts and what Xen Orchestra reports about it; Metrics
 * its size and use over time, and what the pool's hosts see of it: how long
 * their requests to it take and how much they read and write.
 */

export const XCP_NG_SR_TAB_OVERVIEW: string = "Overview";
export const XCP_NG_SR_TAB_METRICS: string = "Metrics";

const XcpNgPoolStorageDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Route shape: .../xcp-ng/:modelId/storage/:subModelId - subModelId is
   * the storage repository's XAPI UUID, not a database id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [row, setRow] = useState<XcpNgResource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  const [rowError, setRowError] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [disks, setDisks] = useState<Array<XcpNgResource>>([]);
  const [isLoadingDisks, setIsLoadingDisks] = useState<boolean>(true);
  const [disksError, setDisksError] = useState<string>("");

  // The repository's own row: its size, its use and whose it is.
  const fetchRow: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const inventoryRow: XcpNgResource | null = await fetchXcpNgInventoryRow({
        xcpNgPoolId: modelId,
        kind: XcpNgResourceKind.StorageRepository,
        externalId: externalId,
      });
      setRow(inventoryRow);
      setRowError("");
    } catch (err) {
      setRowError(API.getFriendlyMessage(err));
    }
    setIsLoadingRow(false);
  };

  // The virtual disks it holds, each with the VM it belongs to.
  const fetchDisks: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingDisks(true);
    try {
      setDisks(
        await fetchXcpNgVirtualDisks({
          xcpNgPoolId: modelId,
          storageRepositoryExternalId: externalId,
        }),
      );
      setDisksError("");
    } catch (err) {
      setDisksError(API.getFriendlyMessage(err));
    }
    setIsLoadingDisks(false);
  };

  // Try again after a failed read: the loader while it reads again.
  const retryRow: () => void = (): void => {
    setIsLoadingRow(true);
    fetchRow().catch((err: Error) => {
      setRowError(API.getFriendlyMessage(err));
      setIsLoadingRow(false);
    });
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
        },
      });
      setPool(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);

    await Promise.all([fetchRow(), fetchDisks()]);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
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

  const poolName: string = pool.name || "";
  const poolIdentifier: string = pool.poolIdentifier || "";
  const routes: XcpNgPartRoutes = getXcpNgPartRoutes(modelId);
  const now: Date = OneUptimeDate.getCurrentDate();
  const repositoryName: string = getXcpNgDisplayName(row, externalId);
  // Read once: the Overview's card lists it, the hero's state opens it.
  const attention: ResourcePartAttention = getXcpNgPartAttention({
    kind: "StorageRepository",
    externalId: externalId,
    row: row,
    routeFor: routes.getPartRoute,
    now: now,
  });
  const charts: XcpNgPartCharts = getXcpNgStorageCharts({
    poolIdentifier: poolIdentifier,
    storageRepositoryExternalId: externalId,
    translator: translator,
  });

  const tabs: Array<Tab> = [
    {
      name: XCP_NG_SR_TAB_OVERVIEW,
      children: isLoadingRow ? (
        <PageSkeleton />
      ) : rowError ? (
        <XcpNgPartReadError
          kind="StorageRepository"
          message={rowError}
          onRetry={retryRow}
        />
      ) : (
        <XcpNgStorageOverview
          poolId={modelId}
          poolName={poolName}
          poolIdentifier={poolIdentifier}
          externalId={externalId}
          row={row}
          virtualDisks={disks}
          isLoadingVirtualDisks={isLoadingDisks}
          virtualDisksError={disksError}
          onRefreshVirtualDisks={() => {
            fetchDisks().catch(() => {
              // The card keeps what it showed.
            });
          }}
          attention={attention}
          routes={routes}
        />
      ),
    },
    {
      name: XCP_NG_SR_TAB_METRICS,
      children: (
        <Card
          title={translator.translateTemplate(
            "Storage Repository Metrics: {{storageRepositoryName}}",
            { storageRepositoryName: repositoryName },
          )}
          description="This storage repository's size, use and allocation, and how fast the pool's hosts read and write on it, over the selected time range."
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
    <div data-testid="xcp-ng-sr-page">
      <XcpNgPartHero
        kind="StorageRepository"
        row={row}
        externalId={externalId}
        poolName={poolName}
        routes={routes}
        virtualDiskCount={isLoadingDisks ? undefined : disks.length}
        attention={attention}
        now={now}
      />
      <Tabs
        label="Storage Repository"
        tabs={tabs}
        wrap={true}
        onTabChange={() => {}}
      />
    </div>
  );
};

export default XcpNgPoolStorageDetail;
