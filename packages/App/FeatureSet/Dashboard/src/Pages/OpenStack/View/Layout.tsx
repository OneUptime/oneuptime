import { getOpenStackBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import {
  OpenStackInventorySummary,
  fetchOpenStackInventorySummary,
} from "../Utils/OpenStackResourceUtils";
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

const OpenStackCloudViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  const [resourceCounts, setResourceCounts] = useState<
    ResourceCounts | undefined
  >(undefined);

  useEffect(() => {
    /*
     * The same counts the Overview's chips read, from the same rows the lists
     * page through, so the side menu never disagrees with them. Supplementary:
     * no badge is better than no page when the read fails.
     */
    fetchOpenStackInventorySummary(modelId)
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
  }, []);

  return (
    <ModelPage
      title="OpenStack Cloud"
      modelType={OpenStackCloud}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getOpenStackBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} resourceCounts={resourceCounts} />}
    >
      <Outlet />
    </ModelPage>
  );
};

export default OpenStackCloudViewLayout;
