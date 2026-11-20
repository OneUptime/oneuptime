import { getScheduleMaintenanceBreadcrumbs } from "../../../Utils/Breadcrumbs";
import { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "Common/UI/Components/Page/ModelPage";
import Navigation from "Common/UI/Utils/Navigation";
import ScheduledMaintenance from "Common/Models/DatabaseModels/ScheduledMaintenance";
import RecordAccessScopeProvider from "../../../Components/RecordAccess/RecordAccessScopeProvider";
import { RecordAccessKind } from "Common/Types/RecordAccess/RecordAccess";
import React, { FunctionComponent, ReactElement } from "react";
import { Outlet, useParams } from "react-router-dom";

const ScheduledMaintenanceViewLayout: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const { id } = useParams();
  const modelId: ObjectID = new ObjectID(id || "");
  const path: string = Navigation.getRoutePath(RouteUtil.getRoutes());
  return (
    <ModelPage
      title="Maintenance Event"
      modelType={ScheduledMaintenance}
      modelId={modelId}
      modelNameField="title"
      breadcrumbLinks={getScheduleMaintenanceBreadcrumbs(path)}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      {/*
       * What the server says the reader may do on this maintenance event
       * by its labels and its owners: every lock on its pages reads it
       * (RecordAccessScopeProvider, #10272).
       */}
      <RecordAccessScopeProvider
        kind={RecordAccessKind.ScheduledMaintenance}
        modelId={modelId}
      >
        <Outlet />
      </RecordAccessScopeProvider>
    </ModelPage>
  );
};

export default ScheduledMaintenanceViewLayout;
