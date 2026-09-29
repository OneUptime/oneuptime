import AdminModelAPI from "../../../Utils/ModelAPI";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelDelete from "Common/UI/Components/ModelDelete/ModelDelete";
import Navigation from "Common/UI/Utils/Navigation";
import React, { FunctionComponent, ReactElement } from "react";
import { useTranslation } from "react-i18next";
import SideMenuComponent from "./SideMenu";
import Project from "Common/Models/DatabaseModels/Project";
import ModelPage from "Common/UI/Components/Page/ModelPage";

const DeletePage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelPage<Project>
      modelId={modelId}
      modelNameField="name"
      modelType={Project}
      modelAPI={AdminModelAPI}
      title={t("pages.projectView.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.projects"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECTS] as Route,
          ),
        },
        {
          title: t("breadcrumbs.project"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.PROJECT_VIEW] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <ModelDelete
        modelType={Project}
        modelId={modelId}
        modelAPI={AdminModelAPI}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.PROJECTS] as Route);
        }}
      />
    </ModelPage>
  );
};

export default DeletePage;
