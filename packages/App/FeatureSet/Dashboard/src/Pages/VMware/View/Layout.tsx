import { getVMwareBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import VMwareVCenter from "Common/Models/DatabaseModels/VMwareVCenter";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";
import {
  VMwareInventorySummary,
  fetchVMwareInventorySummary,
} from "../Utils/VMwareResourceUtils";

const VMwareVCenterViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);

  useEffect(() => {
    const fetchCounts: () => Promise<void> = async (): Promise<void> => {
      try {
        /*
         * Reads counts from the VMwareResource inventory table — the
         * same source the overview page and the list pages use, so the
         * sidebar badges can never drift from them. The cached count
         * columns on the vCenter row (hostCount/vmCount/...) are
         * written by the ingest path from the SAME inventory buffer
         * (single-source rule), so no write-back is needed here.
         */
        const summary: VMwareInventorySummary | null =
          await fetchVMwareInventorySummary(modelId);

        if (!summary) {
          return;
        }

        setResourceCounts({
          hosts: summary.hostCount,
          // Non-template VMs — the same population the vCenter list counts.
          virtualMachines: summary.virtualMachineCount,
          datastores: summary.datastoreCount,
          clusters: summary.clusterCount,
          resourcePools: summary.resourcePoolCount,
        });
      } catch {
        // Counts are supplementary, don't fail the layout
      }
    };

    fetchCounts().catch(() => {});
  }, []);

  return (
    <ModelPage
      title="vCenter"
      modelType={VMwareVCenter}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getVMwareBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default VMwareVCenterViewLayout;
