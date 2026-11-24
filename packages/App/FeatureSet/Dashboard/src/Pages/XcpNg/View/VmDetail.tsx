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
import XcpNgVmOverview from "../../../Components/XcpNg/Part/XcpNgVmOverview";
import XcpNgPartReadError from "../../../Components/XcpNg/Part/XcpNgPartReadError";
import {
  XcpNgPartRoutes,
  getXcpNgPartRoutes,
} from "../../../Components/XcpNg/Part/XcpNgPartRoutes";
import {
  XcpNgPartCharts,
  getXcpNgVmCharts,
} from "../../../Components/XcpNg/XcpNgPartCharts";
import {
  externalIdFromRouteParam,
  fetchXcpNgInventoryRow,
  fetchXcpNgVirtualDisks,
  getXcpNgDisplayName,
} from "../Utils/XcpNgResourceUtils";
import { getXcpNgPartAttention } from "../Utils/XcpNgPartAttention";

/*
 * An XCP-ng VM inside its pool: the hero says which VM it is, the host it
 * runs on (or last ran on), its state - grey when someone chose it, amber
 * when it stopped after running - its vCPUs, memory and tags; the Overview
 * what about it needs attention, its load, its virtual disks and the
 * storage repository each is on, what is open on it, its alerts and what
 * Xen Orchestra reports about it; Metrics its charts.
 */

export const XCP_NG_VM_TAB_OVERVIEW: string = "Overview";
export const XCP_NG_VM_TAB_METRICS: string = "Metrics";

const XcpNgPoolVmDetail: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  /*
   * Route shape: .../xcp-ng/:modelId/vms/:subModelId - subModelId is the
   * VM's XAPI UUID, not a database id.
   */
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(2);
  const externalId: string = externalIdFromRouteParam(
    Navigation.getLastParamAsString(),
  );

  const [pool, setPool] = useState<XcpNgPool | null>(null);
  const [row, setRow] = useState<XcpNgResource | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isLoadingRow, setIsLoadingRow] = useState<boolean>(true);
  /*
   * Why the VM's inventory could not be read: its Overview says so, with
   * Try again, instead of "not reported" about a pool that may be read fine.
   */
  const [rowError, setRowError] = useState<string>("");
  const [error, setError] = useState<string>("");
  const [disks, setDisks] = useState<Array<XcpNgResource>>([]);
  const [isLoadingDisks, setIsLoadingDisks] = useState<boolean>(true);
  const [disksError, setDisksError] = useState<string>("");

  // The VM's own row: who it is and how it is doing.
  const fetchRow: PromiseVoidFunction = async (): Promise<void> => {
    try {
      const inventoryRow: XcpNgResource | null = await fetchXcpNgInventoryRow({
        xcpNgPoolId: modelId,
        kind: XcpNgResourceKind.VM,
        externalId: externalId,
      });
      setRow(inventoryRow);
      setRowError("");
    } catch (err) {
      setRowError(API.getFriendlyMessage(err));
    }
    setIsLoadingRow(false);
  };

  // Its virtual disks, each with the storage repository it is on.
  const fetchDisks: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoadingDisks(true);
    try {
      setDisks(
        await fetchXcpNgVirtualDisks({
          xcpNgPoolId: modelId,
          vmExternalId: externalId,
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
  const vmName: string = getXcpNgDisplayName(row, externalId);
  // Read once: the Overview's card lists it, the hero's state opens it.
  const attention: ResourcePartAttention = getXcpNgPartAttention({
    kind: "VM",
    externalId: externalId,
    row: row,
    routeFor: routes.getPartRoute,
    now: now,
  });
  const charts: XcpNgPartCharts = getXcpNgVmCharts({
    poolIdentifier: poolIdentifier,
    vmExternalId: externalId,
    translator: translator,
  });

  const tabs: Array<Tab> = [
    {
      name: XCP_NG_VM_TAB_OVERVIEW,
      children: isLoadingRow ? (
        <PageSkeleton />
      ) : rowError ? (
        <XcpNgPartReadError kind="VM" message={rowError} onRetry={retryRow} />
      ) : (
        <XcpNgVmOverview
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
          now={now}
        />
      ),
    },
    {
      name: XCP_NG_VM_TAB_METRICS,
      children: (
        <Card
          title={translator.translateTemplate("VM Metrics: {{vmName}}", {
            vmName: vmName,
          })}
          description="CPU, CPU contention, memory, network per virtual interface and disk I/O per device for this VM over the selected time range."
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
    <div data-testid="xcp-ng-vm-page">
      <XcpNgPartHero
        kind="VM"
        row={row}
        externalId={externalId}
        poolName={poolName}
        routes={routes}
        attention={attention}
        now={now}
      />
      <Tabs label="VM" tabs={tabs} wrap={true} onTabChange={() => {}} />
    </div>
  );
};

export default XcpNgPoolVmDetail;
