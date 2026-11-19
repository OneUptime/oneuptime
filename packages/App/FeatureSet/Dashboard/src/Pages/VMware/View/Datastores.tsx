import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import ResourceTable, {
  InfrastructureResource,
} from "../../../Components/Infrastructure/ResourceTable";
import {
  VMwareResourceKind,
  fetchVMwareInventoryResources,
  routeParamFromExternalId,
} from "../Utils/VMwareResourceUtils";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import API from "Common/UI/Utils/API/API";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import { VMWARE_METRIC_DESCRIPTIONS } from "../../../Components/MetricDescriptions/VMwareMetricDescriptions";
import {
  StorageUsageThresholds,
  formatStorageBytes,
  getStorageUsage,
} from "Common/Utils/Storage/StorageUsage";
import {
  VMWARE_DATASTORE_CRITICAL_PERCENT,
  VMWARE_DATASTORE_WARNING_PERCENT,
} from "../Utils/VMwareHealth";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";

/*
 * Where a datastore's bar turns amber and red: the levels its alerts and
 * Needs attention flag it at, and that mark the vCenter Degraded and
 * Unhealthy (VMwareHealth).
 */
const VMWARE_DATASTORE_USAGE_THRESHOLDS: StorageUsageThresholds = {
  warningPercent: VMWARE_DATASTORE_WARNING_PERCENT,
  criticalPercent: VMWARE_DATASTORE_CRITICAL_PERCENT,
};

const DATASTORE_NOT_REPORTED: string = translationKey("Not reported");

/*
 * A datastore's used of its capacity, as vSphere last reported them, for
 * the shared Used and Free columns (ResourceTable's storageUsage).
 */
function withDatastoreUsage(
  resource: InfrastructureResource,
): InfrastructureResource {
  return {
    ...resource,
    storageUsage: {
      usage: getStorageUsage(
        {
          capacity: resource.additionalAttributes["maxDiskBytes"],
          used: resource.additionalAttributes["diskBytes"],
        },
        VMWARE_DATASTORE_USAGE_THRESHOLDS,
      ),
      noUsageText: DATASTORE_NOT_REPORTED,
    },
  };
}

const VMwareVCenterDatastores: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [resources, setResources] = useState<Array<InfrastructureResource>>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchData: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    setError("");
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

      setResources(datastoreList.map(withDatastoreUsage));
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
    return <PageSkeleton shape="table" />;
  }

  return (
    <ResourceTable
      error={error}
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
      /*
       * How full each datastore is (#9539): a bar and a percent that turn
       * amber at 80% and red at 90%, as its alerts do, and what is free,
       * where the list wrote "Used / Capacity" as English text.
       */
      storageUsageColumns={{
        usedDescription: VMWARE_METRIC_DESCRIPTIONS.datastoreListUsedCapacity,
        freeDescription: VMWARE_METRIC_DESCRIPTIONS.datastoreFree,
      }}
      columns={[
        {
          title: "Capacity",
          key: "maxDiskBytes",
          foldInto: "storageUsage",
          showTitleWhenFolded: true,
          getValue: (resource: InfrastructureResource): string => {
            const total: number = Number(
              resource.additionalAttributes["maxDiskBytes"] || "",
            );
            if (!Number.isFinite(total) || total <= 0) {
              return EMPTY_VALUE_MARK;
            }
            return formatStorageBytes(total, translator.language);
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
