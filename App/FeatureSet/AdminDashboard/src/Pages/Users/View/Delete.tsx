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
import User from "Common/Models/DatabaseModels/User";
import ModelPage from "Common/UI/Components/Page/ModelPage";

const DeletePage: FunctionComponent = (): ReactElement => {
  const { t } = useTranslation();
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelPage
      modelId={modelId}
      modelNameField="email"
      modelType={User}
      modelAPI={AdminModelAPI}
      title={t("pages.userView.title")}
      breadcrumbLinks={[
        {
          title: t("breadcrumbs.adminDashboard"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route),
        },
        {
          title: t("breadcrumbs.users"),
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.USERS] as Route),
        },
        {
          title: t("breadcrumbs.user"),
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.USER_VIEW] as Route,
          ),
        },
      ]}
      sideMenu={<SideMenuComponent modelId={modelId} />}
    >
      <ModelDelete
        modelType={User}
        modelId={modelId}
        modelAPI={AdminModelAPI}
        onDeleteSuccess={() => {
          Navigation.navigate(RouteMap[PageMap.USERS] as Route);
        }}
      />
    </ModelPage>
  );
};

export default DeletePage;
