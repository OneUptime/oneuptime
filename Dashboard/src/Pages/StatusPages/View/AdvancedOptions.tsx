import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import PageComponentProps from "../../PageComponentProps";
import SideMenu from "./SideMenu";
import Route from "Common/Types/API/Route";
import ObjectID from "Common/Types/ObjectID";
import ModelPage from "CommonUI/src/Components/Page/ModelPage";
import Navigation from "CommonUI/src/Utils/Navigation";
import StatusPage from "Common/AppModels/Models/StatusPage";
import React, { FunctionComponent, ReactElement } from "react";

const StatusPageDelete: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  return (
    <ModelPage
      title="Status Page"
      modelType={StatusPage}
      modelId={modelId}
      modelNameField="name"
      breadcrumbLinks={[
        {
          title: "Project",
          to: RouteUtil.populateRouteParams(RouteMap[PageMap.HOME] as Route, {
            modelId,
          }),
        },
        {
          title: "Status Pages",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGES] as Route,
            { modelId },
          ),
        },
        {
          title: "View Status Page",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW] as Route,
            { modelId },
          ),
        },
        {
          title: "Advanced Settings",
          to: RouteUtil.populateRouteParams(
            RouteMap[PageMap.STATUS_PAGE_VIEW_ADVANCED_OPTIONS] as Route,
            { modelId },
          ),
        },
      ]}
      sideMenu={<SideMenu modelId={modelId} />}
    >
      <div></div>
    </ModelPage>
  );
};

export default StatusPageDelete;
