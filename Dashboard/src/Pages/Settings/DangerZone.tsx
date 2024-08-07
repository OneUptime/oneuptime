import DashboardNavigation from "../../Utils/Navigation";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import PageComponentProps from "../PageComponentProps";
import DashboardSideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import Alert, { AlertType } from "Common/UI/src/Components/Alerts/Alert";
import ModelDelete from "Common/UI/src/Components/ModelDelete/ModelDelete";
import Page from "Common/UI/src/Components/Page/Page";
import PermissionUtil from "Common/UI/src/Utils/Permission";
import ProjectUtil from "Common/UI/src/Utils/Project";
import Project from "Common/Models/DatabaseModels/Project";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps extends PageComponentProps {
  onProjectDeleted: () => void;
}

const Settings: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <Page
      title={"Project Settings"}
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: "Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS] as Route,
          ),
        },
        {
          title: "Danger Zone",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.SETTINGS_DANGERZONE] as Route,
          ),
        },
      ]}
      sideMenu={<DashboardSideMenu />}
    >
      <Alert
        type={AlertType.DANGER}
        strongTitle="DANGER ZONE"
        title="Deleting your project will delete it permanently and there is no way to recover. "
      />

      <ModelDelete
        modelType={Project}
        modelId={
          new ObjectID(DashboardNavigation.getProjectId()?.toString() || "")
        }
        onDeleteSuccess={() => {
          ProjectUtil.clearCurrentProject();
          PermissionUtil.clearProjectPermissions();
          props.onProjectDeleted();
        }}
      />
    </Page>
  );
};

export default Settings;
