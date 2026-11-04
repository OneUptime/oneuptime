import { getOpenStackBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import {
  OpenStackInventorySummary,
  fetchOpenStackInventorySummary,
} from "../Utils/OpenStackResourceUtils";
import OpenStackRegionBar from "../../../Components/OpenStack/OpenStackRegionBar";
import {
  OpenStackRegionProvider,
  OpenStackRegionState,
  useOpenStackRegion,
} from "../../../Components/OpenStack/OpenStackRegionContext";
import SideMenu, { ResourceCounts } from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import OpenStackCloud from "Common/Models/DatabaseModels/OpenStackCloud";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import { Outlet, useParams } from "react-router-dom";

const OpenStackCloudViewBody: FunctionComponent<{
  modelId: ObjectID;
}> = (props: { modelId: ObjectID }): ReactElement => {
  const modelId: ObjectID = props.modelId;
  const { region }: OpenStackRegionState = useOpenStackRegion();
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);

  useEffect(() => {
    /*
     * The same counts the Overview's chips read, from the same rows the lists
     * page through, so the side menu never disagrees with them, in the region
     * they read. Supplementary: no badge is better than no page when the read
     * fails.
     */
    fetchOpenStackInventorySummary(modelId, region)
      .then((summary: OpenStackInventorySummary | null) => {
        if (!summary) {
          return;
        }

        setResourceCounts({
          services: summary.serviceCount,
          hypervisors: summary.hypervisorCount,
          instances: summary.instanceCount,
          networks: summary.networkCount,
          routers: summary.routerCount,
          floatingIps: summary.floatingIpCount,
          volumes: summary.volumeCount,
          projects: summary.projectCount,
        });
      })
      .catch(() => {});
  }, [region]);

  return (
    <ModelPage
      title="OpenStack Cloud"
      modelType={OpenStackCloud}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getOpenStackBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <OpenStackRegionBar openStackCloudId={modelId} />
      <Outlet />
    </ModelPage>
  );
};

const OpenStackCloudViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");

  return (
    <OpenStackRegionProvider openStackCloudId={modelId}>
      <OpenStackCloudViewBody modelId={modelId} />
    </OpenStackRegionProvider>
  );
};

export default OpenStackCloudViewLayout;
