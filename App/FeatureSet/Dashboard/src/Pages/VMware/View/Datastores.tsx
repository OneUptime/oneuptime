import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  VMwareResourceKind,
  fetchVMwareInventoryResources,
  formatBytes,
  routeParamFromExternalId,
} from "../Utils/VMwareResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";

const VMwareVCenterDatastores: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      /*
       * Postgres inventory read (VMwareResource, kind=Datastore). Used /
       * capacity ride additionalAttributes (diskBytes/maxDiskBytes) for
       * the custom column below; CPU/memory columns are hidden —
       * datastores have neither.
       */
      const datastoreList: Array<InfrastructureResource> =
        await fetchVMwareInventoryResources({
          vmwareVCenterId: modelId,
          kind: VMwareResourceKind.Datastore,
        });

      setResources(datastoreList);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchData().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  return (
    <ResourceTable
      onRefreshClick={() => {
        fetchData().catch(() => {});
      }}
      title="Datastores"
      description="Datastores (VMFS, NFS, vSAN, vVols) visible to this vCenter with their current usage against capacity."
      resources={resources}
      showGroupColumn={true}
      groupColumnTitle="Datacenter"
      showStatus={false}
      showResourceMetrics={false}
      tableIdPrefix="vmware"
      emptyMessage="No datastores reported yet. Make sure the VMware agent is sending metrics and that its read-only role is propagated to child objects."
      columns={[
        {
          title: "Used / Capacity",
          key: "diskBytes",
          getValue: (resource: InfrastructureResource): string => {
            const usedRaw: string =
              resource.additionalAttributes["diskBytes"] || "";
            const totalRaw: string =
              resource.additionalAttributes["maxDiskBytes"] || "";
            if (!usedRaw || !totalRaw) {
              return "N/A";
            }
            const used: number = Number(usedRaw);
            const total: number = Number(totalRaw);
            if (
              !Number.isFinite(used) ||
              !Number.isFinite(total) ||
              total <= 0
            ) {
              return "N/A";
            }
            /*
             * Prefer the receiver's own vcenter.datastore.disk.utilization
             * when present; fall back to used / (used + available).
             */
            const pctRaw: string =
              resource.additionalAttributes["diskPercent"] || "";
            const pct: number = pctRaw ? Number(pctRaw) : (used / total) * 100;
            return `${formatBytes(used)} / ${formatBytes(total)} (${pct.toFixed(1)}%)`;
          },
        },
      ]}
      getViewRoute={(resource: InfrastructureResource) => {
        return RouteUtil.populateRouteParams(
          RouteMap[PageMap.VMWARE_VCENTER_VIEW_DATASTORE_DETAIL] as Route,
          {
            modelId: modelId,
            subModelId: routeParamFromExternalId(
              resource.additionalAttributes["externalId"] || "",
            ),
          },
        );
      }}
    />
  );
};

export default VMwareVCenterDatastores;
