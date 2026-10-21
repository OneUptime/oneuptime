import { getStatusPagesBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import StatusPage from "Common/Models/DatabaseModels/StatusPage";
import ArchivedResourceBanner from "../../../Components/Archive/ArchivedResourceBanner";
import { STATUS_PAGE_ARCHIVE_COPY } from "../../../Components/Archive/ResourceArchiveCopy";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const StatusPageViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Status Page"
      modelType={StatusPage}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={getStatusPagesBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <ArchivedResourceBanner<StatusPage>
        modelType={StatusPage}
        modelId={modelId}
        copy={STATUS_PAGE_ARCHIVE_COPY}
      />
      <Outlet />
    </ModelPage>
  );
};

export default StatusPageViewLayout;
